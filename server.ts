import dotenv from 'dotenv';
dotenv.config({ quiet: true });

import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import type { GoogleGenAI } from '@google/genai';

process.on('uncaughtException', (err: any) => {
  const msg = String(err?.message || err || '');
  if (msg.includes('Port 24678') || msg.includes('WebSocket') || msg.includes('EADDRINUSE')) {
    console.warn('[server] Suppressed non-fatal server warning:', msg);
    return;
  }
  console.error('[server] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason: any) => {
  const msg = String(reason?.message || reason || '');
  if (msg.includes('Port 24678') || msg.includes('WebSocket') || msg.includes('EADDRINUSE')) {
    console.warn('[server] Suppressed non-fatal rejection:', msg);
    return;
  }
  console.error('[server] Unhandled Rejection:', reason);
});

import { INITIAL_AIRMEN } from './src/data/initialAirmen';
import { DUTY_TYPES } from './src/data/dutyTypes';
import { generateSeedAssignments, calculateDutyStats, detectConflicts } from './src/data/rosterGenerator';
import { generateOfficialMonthAssignments, getOfficialParadeStateDocument } from './src/data/officialJulyAugustData';
import { Airman, DutyAssignment, FlightName, ParadeShift, ActivityHistoryItem, DutyCategoryCode, IDAShift, ImportHistoryBatch } from './src/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'baf_unit_data.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'app_settings.json');


let cachedSettings: Record<string, { setting_key: string; setting_value: string; updated_at: string }> | null = null;

function loadAppSettings(): Record<string, { setting_key: string; setting_value: string; updated_at: string }> {
  if (cachedSettings) {
    return cachedSettings;
  }
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      cachedSettings = JSON.parse(raw);
      return cachedSettings || {};
    }
  } catch (err) {
    console.error('Error reading app_settings.json:', err);
  }
  cachedSettings = {};
  return cachedSettings;
}

function saveAppSettings(settings: Record<string, { setting_key: string; setting_value: string; updated_at: string }>) {
  try {
    cachedSettings = settings;
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save app_settings.json:', err);
  }
}


interface LocalDB {
  airmen: Airman[];
  assignments: Record<string, DutyAssignment[]>; // monthKey YYYY-MM -> DutyAssignment[]
  activityHistory?: ActivityHistoryItem[];
  adminPasscode?: string;
  importHistory?: ImportHistoryBatch[];
}

function normalizeFlightName(flight: string): FlightName {
  if (flight === 'Avionic Flight' || flight === 'Avionic') return 'Avionics';
  if (flight === 'Mech Flight' || flight === 'Mech') return 'Mechanics';
  if (flight === 'GCS Flight') return 'GCS';
  if (flight === 'Admin Flight') return 'Admin';
  if (flight === 'Avionics' || flight === 'Mechanics' || flight === 'GCS' || flight === 'Admin') {
    return flight as FlightName;
  }
  return 'Admin';
}

function isCorruptedAssignmentRecord(a: any): boolean {
  if (!a || typeof a !== 'object') return true;
  const idStr = String(a.id || '').trim();
  const airId = String(a.airmanId || '').trim();
  if (idStr === 'test' || airId === 'test') return true;
  const match = idStr.match(/^asn_.*?_(\d{4}-\d{2}-\d{2})_/);
  if (match && a.date && match[1] !== String(a.date).trim()) {
    return true;
  }
  return false;
}

let cachedDb: LocalDB | null = null;

// Ensure data file exists or seed it
function loadDatabase(): LocalDB {
  if (cachedDb) {
    return cachedDb;
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.airmen)) {
        let needsSave = false;
        // Preserve existing user modifications and custom airmen
        const existingMap = new Map<string, Airman>();
        parsed.airmen.forEach((a: Airman) => {
          if (a && a.id) existingMap.set(a.id, a);
          if (a && a.bdNo) existingMap.set(a.bdNo, a);
        });

        // Build lookup map from legacy airman-1..48 and BD_<digits> to canonical BD/<digits>
        const legacyIdToCanonical = new Map<string, string>();
        INITIAL_AIRMEN.forEach((initA) => {
          if (initA.serNo) {
            legacyIdToCanonical.set(`airman-${initA.serNo}`, initA.id);
          }
          const digits = String(initA.bdNo || initA.id || '').replace(/\D/g, '');
          if (digits) {
            legacyIdToCanonical.set(digits, initA.id);
            legacyIdToCanonical.set(`bd/${digits}`, initA.id);
            legacyIdToCanonical.set(`bd_${digits}`, initA.id);
            legacyIdToCanonical.set(`airman-${digits}`, initA.id);
          }
        });
        const normalizeAirId = (rawId: any): string => {
          if (!rawId) return '';
          const s = String(rawId).trim();
          const low = s.toLowerCase();
          if (legacyIdToCanonical.has(low)) return legacyIdToCanonical.get(low)!;
          const m = s.match(/^BD[_\/](\d+)$/i);
          if (m) return `BD/${m[1]}`;
          const d = s.replace(/\D/g, '');
          if (d.length >= 4) return `BD/${d}`;
          return s;
        };

        // Ensure baseline airmen exist while giving 100% priority to user's saved edits
        const finalAirmen: Airman[] = [];
        INITIAL_AIRMEN.forEach((initA) => {
          const existing = existingMap.get(initA.id) || existingMap.get(initA.bdNo);
          if (existing) {
            const mergedAirman: Airman = {
              ...initA,
              ...existing,
              id: initA.id,
              bdNo: existing.bdNo || initA.bdNo,
              serNo: existing.serNo || initA.serNo,
              code: existing.code || initA.code,
              addressBlock: existing.addressBlock || initA.addressBlock,
              mobileNo: existing.mobileNo || initA.mobileNo,
              permanentAddress: existing.permanentAddress || initA.permanentAddress,
              bloodGroup: existing.bloodGroup || initA.bloodGroup,
              fullName: (existing.fullName && existing.fullName !== existing.name) ? existing.fullName : (initA.fullName || existing.fullName || existing.name),
              flightName: existing.flightName || (existing as any).flight || (existing as any).Flight || initA.flightName || 'Admin',
              email: (existing as any).email || (existing as any).gmail || undefined,
            };
            if (!existing.mobileNo || !existing.addressBlock || !existing.serNo || existing.id !== initA.id) {
              needsSave = true;
            }
            finalAirmen.push(mergedAirman);
          } else {
            finalAirmen.push(initA);
            needsSave = true;
          }
        });

        // Add any newly created custom airmen that were not in INITIAL_AIRMEN
        parsed.airmen.forEach((a: Airman) => {
          if (a && !finalAirmen.some((f) => f.id === a.id || f.bdNo === a.bdNo)) {
            finalAirmen.push(a);
          }
        });

        parsed.airmen = finalAirmen.sort((a, b) => (a.serNo || 999) - (b.serNo || 999));
        if (!parsed.assignments || typeof parsed.assignments !== 'object') {
          parsed.assignments = {};
          needsSave = true;
        }
        if (!parsed.activityHistory || !Array.isArray(parsed.activityHistory)) {
          parsed.activityHistory = [];
          needsSave = true;
        } else {
          parsed.activityHistory.forEach((h: any) => {
            if (h && h.airmanId && h.airmanId !== 'ALL' && h.airmanId !== 'BULK_AIRMEN') {
              const norm = normalizeAirId(h.airmanId);
              if (norm && norm !== h.airmanId) {
                h.airmanId = norm;
                needsSave = true;
              }
            }
          });
        }
        if (!parsed.adminPasscode) {
          parsed.adminPasscode = '1124';
          needsSave = true;
        }
        if (!parsed.importHistory || !Array.isArray(parsed.importHistory)) {
          parsed.importHistory = [];
          needsSave = true;
        }
        if (!parsed.assignments['2026-07'] || parsed.assignments['2026-07'].length < 50) {
          parsed.assignments['2026-07'] = generateOfficialMonthAssignments(2026, 7);
          needsSave = true;
        }
        if (!parsed.assignments['2026-08'] || parsed.assignments['2026-08'].length < 50) {
          parsed.assignments['2026-08'] = generateOfficialMonthAssignments(2026, 8);
          needsSave = true;
        }
        // Clean corrupted records, normalize airmanId to BD/<bdNo>, deduplicate, and strip placeholder notes
        Object.keys(parsed.assignments || {}).forEach((k) => {
          if (Array.isArray(parsed.assignments[k])) {
            const seenKey = new Set<string>();
            const cleanedList: DutyAssignment[] = [];
            parsed.assignments[k].forEach((a: any) => {
              if (isCorruptedAssignmentRecord(a)) {
                needsSave = true;
                return;
              }
              const normId = normalizeAirId(a.airmanId);
              if (normId && normId !== a.airmanId) {
                a.airmanId = normId;
                needsSave = true;
              }
              if (a.notes && typeof a.notes === 'string' && a.notes.toLowerCase().includes('imported')) {
                a.notes = '';
                needsSave = true;
              }
              const shiftKey = a.idaShift || a.shift || 'n';
              const scopeKey = a.disposalScope || 'ALL';
              const dedupKey = `${a.airmanId}_${a.date}_${a.dutyCode}_${shiftKey}_${scopeKey}`;
              if (!seenKey.has(dedupKey)) {
                seenKey.add(dedupKey);
                cleanedList.push(a);
              } else {
                needsSave = true;
              }
            });
            parsed.assignments[k] = cleanedList;
          }
        });
        cachedDb = parsed as LocalDB;
        if (needsSave) {
          saveDatabase(cachedDb);
        }
        return cachedDb;
      }
    } catch (err) {
      console.error('Error reading DB_FILE, re-seeding:', err);
    }
  }

  // Generate clean initial database with official July and August rosters
  const db: LocalDB = {
    airmen: [...INITIAL_AIRMEN],
    assignments: {
      '2026-07': generateOfficialMonthAssignments(2026, 7),
      '2026-08': generateOfficialMonthAssignments(2026, 8),
    },
    activityHistory: [],
    adminPasscode: '1124',
    importHistory: [],
  };

  cachedDb = db;
  saveDatabase(db);
  return db;
}

const sseClients = new Set<express.Response>();

function broadcastRealtimeEvent(type: string = 'DATA_UPDATED', payload: any = {}) {
  const data = JSON.stringify({ type, payload, timestamp: Date.now() });
  for (const client of sseClients) {
    try {
      client.write(`data: ${data}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

function saveDatabase(db: LocalDB, eventType: string = 'DATA_UPDATED') {
  try {
    cachedDb = db;
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
    broadcastRealtimeEvent(eventType);
  } catch (err) {
    console.error('Failed to save database:', err);
  }
}

async function startServer() {
  const app = express();
  const portArgIdx = process.argv.indexOf('--port');
  const portFromArg = portArgIdx !== -1 && process.argv[portArgIdx + 1] ? parseInt(process.argv[portArgIdx + 1], 10) : NaN;
  const PORT = !isNaN(portFromArg) ? portFromArg : 3000;

  const hostArgIdx = process.argv.indexOf('--host');
  const HOST = hostArgIdx !== -1 && process.argv[hostArgIdx + 1] ? process.argv[hostArgIdx + 1] : (process.env.HOST || '0.0.0.0');

  let db = loadDatabase();


  app.all('/api/supabase/*', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    let targetUrl = '';
    function handleCanteenFallback(urlString: string, bodyData: any): boolean {
      try {
        const urlObj = new URL(urlString, 'http://localhost');
        const pathname = urlObj.pathname;

        // 1. APP_SETTINGS
        if (pathname.includes('/rest/v1/app_settings')) {
          const settings = loadAppSettings();
          if (req.method === 'GET') {
            let rows = Object.values(settings);
            const settingKeyParam = urlObj.searchParams.get('setting_key');
            if (settingKeyParam) {
              if (settingKeyParam.startsWith('like.')) {
                const prefix = settingKeyParam.slice(5).replace(/[%_]/g, '');
                rows = rows.filter(r => r.setting_key.startsWith(prefix));
              } else if (settingKeyParam.startsWith('eq.')) {
                const targetKey = settingKeyParam.slice(3);
                rows = rows.filter(r => r.setting_key === targetKey);
              }
            }
            res.setHeader('content-type', 'application/json');
            const accept = String(req.headers['accept'] || '');
            if (accept.includes('application/vnd.pgrst.object+json')) {
              res.status(200).send(JSON.stringify(rows[0] || null));
              return true;
            }
            res.status(200).send(JSON.stringify(rows));
            return true;
          } else if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            try {
              let parsedBody = bodyData;
              if (typeof parsedBody === 'string') {
                try { parsedBody = JSON.parse(parsedBody); } catch {}
              } else if (Buffer.isBuffer(parsedBody)) {
                try { parsedBody = JSON.parse(parsedBody.toString()); } catch {}
              }
              const items = Array.isArray(parsedBody) ? parsedBody : (parsedBody ? [parsedBody] : []);
              for (const it of items) {
                if (it && it.setting_key) {
                  settings[it.setting_key] = {
                    setting_key: it.setting_key,
                    setting_value: typeof it.setting_value === 'string' ? it.setting_value : JSON.stringify(it.setting_value),
                    updated_at: it.updated_at || new Date().toISOString()
                  };
                }
              }
              saveAppSettings(settings);
              res.setHeader('content-type', 'application/json');
              res.status(201).send(JSON.stringify(items));
              return true;
            } catch (pErr) {
              console.warn('[Proxy Fallback] Could not parse app_settings body:', pErr);
            }
          }
        }

        // 2. USER_PROFILES (Office App User Logins)
        if (pathname.includes('/rest/v1/user_profiles')) {
          const dbData = loadDatabase();
          let users: any[] = (dbData.airmen || []).map((a: any) => {
            const cleanBd = String(a.bdNo || '').replace(/^BD\/?/i, '').trim();
            const isOwner = cleanBd === '48456';
            return {
              'User ID': cleanBd,
              airman_id: a.id || `airman-${cleanBd}`,
              Name: a.fullName || a.name || 'Airman',
              'Full Name': a.fullName || a.name || 'Airman',
              fullName: a.fullName || a.name || 'Airman',
              Surname: a.name || a.fullName || 'Airman',
              Rank: a.rank || 'LAC',
              Flight: a.flightName || 'Admin',
              Trade: a.trade || 'General',
              Role: isOwner ? 'OWNER' : 'USER',
              'User Login PIN': Number(cleanBd) || null,
              'Admin Login PIN': isOwner ? 1124 : null,
              Status: 'ACTIVE',
              password: cleanBd
            };
          });

          if (req.method === 'GET') {
            const userIdParam = urlObj.searchParams.get('User ID');
            if (userIdParam && userIdParam.startsWith('eq.')) {
              const target = userIdParam.slice(3).replace(/^BD\/?/i, '').trim().toLowerCase();
              users = users.filter(u => String(u['User ID']).toLowerCase() === target);
            }
            res.setHeader('content-type', 'application/json');
            const accept = String(req.headers['accept'] || '');
            if (accept.includes('application/vnd.pgrst.object+json')) {
              res.status(200).send(JSON.stringify(users[0] || null));
              return true;
            }
            res.status(200).send(JSON.stringify(users));
            return true;
          } else if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            res.setHeader('content-type', 'application/json');
            res.status(200).send(JSON.stringify({ success: true }));
            return true;
          }
        }

        // 7. AIRMEN / BIODATA REGISTER
        if (pathname.includes('/rest/v1/airmen') || pathname.includes('/rest/v1/Biodata')) {
          const dbData = loadDatabase();
          if (req.method === 'GET') {
            const formatted = (dbData.airmen || []).map((a: any) => ({
              ...a,
              airman_id: a.id || a.airman_id,
              "BD No": a.bdNo || a["BD No"] || '',
              "Rank": a.rank || a.Rank || '',
              "Surname": a.name || a.Surname || '',
              "Full Name": a.fullName || a.name || '',
              "Flight": a.flightName || a.Flight || 'Admin',
              "Trade": a.trade || a.Trade || 'General',
              "Mobile No": a.mobileNo || a["Mobile No"] || '',
              "Present Address": a.addressBlock || a["Present Address"] || '',
              "Permanent Address": a.permanentAddress || a["Permanent Address"] || '',
              "Status": (a.active !== false) ? 'ACTIVE' : 'INACTIVE',
              "Seniority": a.seniority !== undefined ? a.seniority : (a.serNo || 1),
              active: a.active !== false,
              status: (a.active !== false) ? 'ACTIVE' : 'INACTIVE',
              flightName: a.flightName || a.Flight || 'Admin',
              name: a.name || a.Surname || '',
              rank: a.rank || a.Rank || '',
              trade: a.trade || a.Trade || 'General',
              bdNo: a.bdNo || a["BD No"] || ''
            }));
            res.setHeader('content-type', 'application/json');
            res.status(200).send(JSON.stringify(formatted));
            return true;
          }
        }

        // 8. DUTY_ROSTERS (Duty Assignments)
        if (pathname.includes('/rest/v1/duty_rosters')) {
          const dbData = loadDatabase();
          if (req.method === 'GET') {
            const allAssignments: any[] = [];
            Object.values(dbData.assignments || {}).forEach((arr: any) => {
              if (Array.isArray(arr)) {
                arr.forEach((a: any) => {
                  allAssignments.push({
                    id: a.id || `${a.airmanId}_${a.date}_${a.dutyCode}`,
                    airman_id: a.airmanId,
                    duty_date: a.date,
                    duty_type: a.dutyCode,
                    shift: a.idaShift || null,
                    notes: a.notes || null,
                    created_at: a.updatedAt || new Date().toISOString()
                  });
                });
              }
            });
            res.setHeader('content-type', 'application/json');
            res.status(200).send(JSON.stringify(allAssignments));
            return true;
          } else if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            res.setHeader('content-type', 'application/json');
            res.status(200).send(JSON.stringify({ success: true }));
            return true;
          }
        }

        // 9. PARADE_STATES
        if (pathname.includes('/rest/v1/parade_states')) {
          const dbData = loadDatabase();
          if (req.method === 'GET') {
            const history = (dbData.activityHistory || []).map((h: any, idx: number) => ({
              id: h.id || `parade_${idx}`,
              date: h.timestamp || h.date || new Date().toISOString(),
              type: h.actionType || h.type || 'PARADE_STATE',
              count: h.count || 0,
              notes: h.details || h.notes || '',
              details: typeof h.details === 'string' ? h.details : JSON.stringify(h.details || {})
            }));
            res.setHeader('content-type', 'application/json');
            res.status(200).send(JSON.stringify(history));
            return true;
          }
        }

        // 10. APP_SETTINGS
        if (pathname.includes('/rest/v1/app_settings')) {
          const settings = loadAppSettings();
          if (req.method === 'GET') {
            const list = Object.values(settings);
            res.setHeader('content-type', 'application/json');
            res.status(200).send(JSON.stringify(list));
            return true;
          }
        }
      } catch (fErr) {
        console.warn('[Proxy Fallback] Exception handling canteen fallback:', fErr);
      }
      return false;
    }

    targetUrl = req.originalUrl.replace('/api/supabase', '');
    if (handleCanteenFallback(targetUrl, req.body)) {
      return;
    }
    res.status(200).json({ success: true, message: 'Handled via local store' });
  });

  // Persistent + in-memory store for dynamically resized square PWA PNG icons (192x192, 512x512, maskable 512x512)
  const dynamicPwaIconStore = new Map<string, { icon192: Buffer; icon512: Buffer; maskable512: Buffer }>();
  const ACTIVE_PWA_STATE_FILE = path.join(DATA_DIR, 'active_pwa_office.json');

  interface ActivePwaOfficeState {
    officeName: string;
    officeCode: string;
    officeSlogan: string;
    is155Office: boolean;
    iconHash: string;
  }

  let activePwaOfficeState: ActivePwaOfficeState = {
    officeName: '155 UASU BAF',
    officeCode: '155-UASU',
    officeSlogan: 'Intel • Surveillance • Strike',
    is155Office: true,
    iconHash: '',
  };

  try {
    if (fs.existsSync(ACTIVE_PWA_STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(ACTIVE_PWA_STATE_FILE, 'utf-8'));
      if (saved && saved.officeName) {
        activePwaOfficeState = {
          officeName: String(saved.officeName || '155 UASU BAF'),
          officeCode: String(saved.officeCode || ''),
          officeSlogan: String(saved.officeSlogan || ''),
          is155Office: Boolean(saved.is155Office),
          iconHash: String(saved.iconHash || ''),
        };
        if (saved.iconHash && saved.icon192Base64 && saved.icon512Base64) {
          const b192 = Buffer.from(saved.icon192Base64, 'base64');
          const b512 = Buffer.from(saved.icon512Base64, 'base64');
          const bMask = saved.maskable512Base64 ? Buffer.from(saved.maskable512Base64, 'base64') : b512;
          dynamicPwaIconStore.set(saved.iconHash, { icon192: b192, icon512: b512, maskable512: bMask });
        }
      }
    }
  } catch {}

  const persistActivePwaState = (
    nextState: ActivePwaOfficeState,
    buffers?: { icon192: Buffer; icon512: Buffer; maskable512: Buffer }
  ) => {
    activePwaOfficeState = nextState;
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const payload: Record<string, any> = { ...nextState };
      if (buffers) {
        payload.icon192Base64 = buffers.icon192.toString('base64');
        payload.icon512Base64 = buffers.icon512.toString('base64');
        payload.maskable512Base64 = buffers.maskable512.toString('base64');
      }
      fs.writeFileSync(ACTIVE_PWA_STATE_FILE, JSON.stringify(payload), 'utf-8');
    } catch {}
  };

  app.post('/api/pwa-icon-upload', express.json({ limit: '15mb' }), (req, res) => {
    try {
      const {
        hash,
        iconHash,
        icon192,
        icon192DataUrl,
        icon512,
        icon512DataUrl,
        maskable512,
        maskable512DataUrl,
        officeName,
        officeCode,
        officeSlogan,
        is155Office,
      } = req.body || {};
      const resolvedHash = String(hash || iconHash || '').trim();
      const resolvedIcon192 = icon192 || icon192DataUrl;
      const resolvedIcon512 = icon512 || icon512DataUrl;
      const resolvedMaskable512 = maskable512 || maskable512DataUrl;
      const cleanName = String(officeName || '').trim();
      const isGeneric =
        !cleanName ||
        cleanName === 'Office Management' ||
        cleanName === 'Office Management Application' ||
        cleanName === 'Office Management System';

      let buffers: { icon192: Buffer; icon512: Buffer; maskable512: Buffer } | undefined;
      if (resolvedHash && resolvedIcon192 && resolvedIcon512) {
        const stripDataPrefix = (dataUrl: string) =>
          Buffer.from(String(dataUrl).replace(/^data:image\/\w+;base64,/, ''), 'base64');

        const buf192 = stripDataPrefix(resolvedIcon192);
        const buf512 = stripDataPrefix(resolvedIcon512);
        const bufMask = resolvedMaskable512 ? stripDataPrefix(resolvedMaskable512) : buf512;

        buffers = { icon192: buf192, icon512: buf512, maskable512: bufMask };
        dynamicPwaIconStore.set(resolvedHash, buffers);
      }

      if (!isGeneric) {
        const detected155 =
          Boolean(is155Office) ||
          cleanName.toUpperCase().includes('155') ||
          String(officeCode || '').toUpperCase().includes('155');
        persistActivePwaState(
          {
            officeName: cleanName,
            officeCode: String(officeCode || '').trim(),
            officeSlogan: String(officeSlogan || '').trim(),
            is155Office: detected155,
            iconHash: detected155 ? '' : String(resolvedHash || activePwaOfficeState.iconHash || ''),
          },
          buffers
        );
      }

      res.json({ success: true, hash: resolvedHash });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to store PWA icons' });
    }
  });

  const sendActiveOrFallbackPwaIcon = (
    res: express.Response,
    sizeType: '192' | '512' | 'maskable',
    _requestedHash?: string
  ) => {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    const fallbackFile =
      sizeType === '192'
        ? 'pwa-192x192-trans.png'
        : sizeType === 'maskable'
          ? 'pwa-512x512-full.png'
          : 'pwa-512x512-trans.png';
    const fallbackPath = path.join(process.cwd(), 'public', fallbackFile);
    if (fs.existsSync(fallbackPath)) {
      return res.sendFile(fallbackPath);
    }
    return res.redirect('/pwa-512x512-trans.png?v=25');
  };

  app.get('/api/pwa-icon/:hash/:file', (req, res) => {
    try {
      const { hash, file } = req.params;
      const sizeType: '192' | '512' | 'maskable' = file.includes('192')
        ? '192'
        : file.includes('maskable')
          ? 'maskable'
          : '512';
      return sendActiveOrFallbackPwaIcon(res, sizeType, hash);
    } catch {
      return res.redirect('/pwa-512x512-trans.png?v=25');
    }
  });

  app.get('/api/pwa-active-icon-192.png', (req, res) => {
    const hash = String(req.query.iconHash || '').trim();
    return sendActiveOrFallbackPwaIcon(res, '192', hash);
  });

  app.get('/api/pwa-active-icon-512.png', (req, res) => {
    const hash = String(req.query.iconHash || '').trim();
    return sendActiveOrFallbackPwaIcon(res, '512', hash);
  });

  app.get('/api/pwa-active-maskable-512.png', (req, res) => {
    const hash = String(req.query.iconHash || '').trim();
    return sendActiveOrFallbackPwaIcon(res, 'maskable', hash);
  });

  // Shared handler for both /manifest.json and /api/pwa-manifest so PWA ALWAYS uses the new BAF Logo
  const handlePwaManifestRequest = (req: express.Request, res: express.Response) => {
    try {
      const queryName = String(req.query.name || '').trim();
      const queryLogo = String(req.query.logo || '').trim();
      const queryCode = String(req.query.code || '').trim();
      const querySlogan = String(req.query.slogan || '').trim();

      const isQueryGeneric =
        !queryName ||
        queryName === 'Office Management' ||
        queryName === 'Office Management Application' ||
        queryName === 'Office Management System';

      const appName = !isQueryGeneric
        ? queryName
        : activePwaOfficeState.officeName || '155 UASU BAF';
      const rawCode = !isQueryGeneric ? queryCode : activePwaOfficeState.officeCode;
      const rawSlogan = !isQueryGeneric ? querySlogan : activePwaOfficeState.officeSlogan;

      const is155Office =
        appName.toUpperCase().includes('155') ||
        rawCode.toUpperCase().includes('155') ||
        queryLogo.includes('155-uasu-baf-logo');

      const shortName = appName.length <= 12 ? appName : appName.slice(0, 12).trim();

      const description = rawSlogan
        ? `${appName} — ${rawSlogan}`
        : `Official PWA for ${appName} duty register, parade state, and personnel management.`;

      const icon192Url = '/pwa-192x192-trans.png?v=25';
      const icon512Url = '/pwa-512x512-trans.png?v=25';
      const maskable192Url = '/pwa-192x192-full.png?v=25';
      const maskable512Url = '/pwa-512x512-full.png?v=25';

      const officeQuery = rawCode && !is155Office ? `?office=${encodeURIComponent(rawCode)}` : '';

      const manifestPayload = {
        id: '/',
        name: appName,
        short_name: shortName,
        description,
        start_url: `/${officeQuery}`,
        scope: '/',
        display: 'standalone',
        background_color: '#020617',
        theme_color: '#020617',
        orientation: 'any',
        icons: [
          {
            src: icon192Url,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: icon512Url,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: maskable192Url,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: maskable512Url,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      };

      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.status(200).send(JSON.stringify(manifestPayload, null, 2));
    } catch (err) {
      res.status(500).json({ error: 'Manifest generation error' });
    }
  };

  app.get('/manifest.json', handlePwaManifestRequest);
  app.get('/api/pwa-manifest', handlePwaManifestRequest);

  // Dedicated Office App Unit Data Endpoints
  app.get('/api/airmen', (req, res) => {
    const db = loadDatabase();
    res.json(db.airmen || []);
  });

  app.post('/api/airmen', express.json(), (req, res) => {
    const data = req.body || {};
    const db = loadDatabase();
    if (!Array.isArray(db.airmen)) db.airmen = [];
    const newId = data.id || `BD/${String(data.bdNo || Date.now()).replace(/^BD\/?/i, '')}`;
    const record = { ...data, id: newId, active: data.active !== false, updatedAt: new Date().toISOString() };
    const existingIdx = db.airmen.findIndex((a: any) => a.id === newId || (data.bdNo && a.bdNo === data.bdNo));
    if (existingIdx >= 0) {
      db.airmen[existingIdx] = { ...db.airmen[existingIdx], ...record };
    } else {
      db.airmen.push(record);
    }
    saveDatabase(db, 'DATABASE_UPDATED');
    res.status(201).json(record);
  });

  app.post('/api/airmen/bulk', express.json({ limit: '25mb' }), (req, res) => {
    const list = Array.isArray(req.body) ? req.body : req.body?.airmen;
    if (!Array.isArray(list)) {
      return res.status(400).json({ error: 'Expected array of airmen' });
    }
    const db = loadDatabase();
    if (!Array.isArray(db.airmen)) db.airmen = [];
    let addedCount = 0;
    for (const item of list) {
      if (!item) continue;
      const newId = item.id || `BD/${String(item.bdNo || Date.now()).replace(/^BD\/?/i, '')}`;
      const record = { ...item, id: newId, active: item.active !== false, updatedAt: new Date().toISOString() };
      const idx = db.airmen.findIndex((a: any) => a.id === newId || (item.bdNo && a.bdNo === item.bdNo));
      if (idx >= 0) {
        db.airmen[idx] = { ...db.airmen[idx], ...record };
      } else {
        db.airmen.push(record);
        addedCount++;
      }
    }
    saveDatabase(db, 'DATABASE_UPDATED');
    res.status(201).json({ success: true, addedCount, airmen: db.airmen });
  });

  app.put('/api/airmen/:id', express.json(), (req, res) => {
    const rawId = decodeURIComponent(req.params.id || '');
    const data = req.body || {};
    const db = loadDatabase();
    if (!Array.isArray(db.airmen)) db.airmen = [];
    const targetDigits = String(rawId).replace(/\D/g, '');
    const idx = db.airmen.findIndex((a: any) => {
      if (a.id === rawId || a.bdNo === rawId) return true;
      const d = String(a.bdNo || a.id || '').replace(/\D/g, '');
      return Boolean(targetDigits && d && d === targetDigits);
    });
    if (idx === -1) {
      const created = { ...data, id: data.id || rawId, updatedAt: new Date().toISOString() };
      db.airmen.push(created);
      saveDatabase(db, 'DATABASE_UPDATED');
      return res.json(created);
    }
    db.airmen[idx] = { ...db.airmen[idx], ...data, updatedAt: new Date().toISOString() };
    saveDatabase(db, 'DATABASE_UPDATED');
    res.json(db.airmen[idx]);
  });

  app.delete('/api/airmen/:id', (req, res) => {
    const rawId = decodeURIComponent(req.params.id || '');
    const targetDigits = String(rawId).replace(/\D/g, '');
    if (targetDigits === '48456') {
      return res.status(403).json({ error: 'Protected Master Owner record cannot be deleted' });
    }
    const db = loadDatabase();
    if (Array.isArray(db.airmen)) {
      db.airmen = db.airmen.filter((a: any) => {
        if (a.id === rawId || a.bdNo === rawId) return false;
        const d = String(a.bdNo || a.id || '').replace(/\D/g, '');
        return !(targetDigits && d && d === targetDigits);
      });
      saveDatabase(db, 'DATABASE_UPDATED');
    }
    res.json({ success: true });
  });

  app.get('/api/database', (req, res) => {
    const db = loadDatabase();
    res.json(db);
  });

  app.post('/api/database/save', express.json({ limit: '50mb' }), (req, res) => {
    try {
      const incomingDb = req.body;
      if (incomingDb && (incomingDb.airmen || incomingDb.assignments)) {
        // Strict deduplication by BD number digits before saving
        if (Array.isArray(incomingDb.airmen)) {
          const seen = new Set<string>();
          const cleanAirmen: any[] = [];
          incomingDb.airmen.forEach((a: any) => {
            const digits = String(a.bdNo || a.id || '').replace(/\D/g, '');
            const k = digits || a.id || a.bdNo;
            if (k && !seen.has(k)) {
              seen.add(k);
              cleanAirmen.push(a);
            }
          });
          incomingDb.airmen = cleanAirmen;
        }

        // Strict deduplication & sanitation of assignments
        if (incomingDb.assignments && typeof incomingDb.assignments === 'object') {
          Object.keys(incomingDb.assignments).forEach((m) => {
            const list = incomingDb.assignments[m] || [];
            const seen = new Set<string>();
            const cleanList: any[] = [];
            list.forEach((asn: any) => {
              if (isCorruptedAssignmentRecord(asn)) return;
              const airDigits = String(asn.airmanId || '').replace(/\D/g, '');
              const shift = asn.idaShift || asn.shift || 'n';
              const scope = asn.disposalScope || 'ALL';
              const k = `${airDigits}_${asn.date}_${asn.dutyCode}_${shift}_${scope}`;
              if (!seen.has(k)) {
                seen.add(k);
                cleanList.push(asn);
              }
            });
            incomingDb.assignments[m] = cleanList;
          });
        }

        saveDatabase(incomingDb, 'DATABASE_UPDATED');
        return res.json({ success: true, message: 'Database saved successfully' });
      }
      return res.status(400).json({ error: 'Invalid database payload' });
    } catch (err: any) {
      console.error('Error saving database via /api/database/save:', err);
      return res.status(500).json({ error: err.message || 'Failed to save database' });
    }
  });

  app.get('/api/full-system-backup', (req, res) => {
    try {
      const db = loadDatabase();
      const settings = Object.values(loadAppSettings());
      res.json({
        version: '3.0',
        app: '155 UASU BAF Office Management & Duty Register System',
        exportedAt: new Date().toISOString(),
        baf_unit_data: db,
        app_settings: settings,
        counts: {
          airmen: db.airmen?.length || 0,
          assignments: Object.values(db.assignments || {}).reduce((acc: number, list: any) => acc + (list?.length || 0), 0),
          settings: settings.length,
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to generate full system backup' });
    }
  });

  app.post('/api/full-system-restore', express.json({ limit: '50mb' }), (req, res) => {
    try {
      const { baf_unit_data, localSettings, dutySettings, app_settings } = req.body || {};
      let restoredAirmen = 0;
      let restoredAssignments = 0;
      const restoredMembers = 0;
      const restoredTxs = 0;
      let restoredSettings = 0;

      if (baf_unit_data && (baf_unit_data.airmen || baf_unit_data.assignments)) {
        saveDatabase(baf_unit_data, 'DATABASE_RESTORED');
        restoredAirmen = baf_unit_data.airmen?.length || 0;
        restoredAssignments = Number((Object.values(baf_unit_data.assignments || {}) as any[]).reduce((acc: number, list: any) => acc + (list?.length || 0), 0));
      }

      const currentSettings = loadAppSettings();
      let settingsModified = false;
      const nowIso = new Date().toISOString();
      const skipSettingKeys = new Set([
        'baf_local_storage_snapshot',
        'baf_drive_cloud_snapshot',
        'baf_backup_restore_history_v1',
        'baf_155_uasu_v2_db',
        'baf_database_v2',
      ]);

      const applySettingArray = (arr: any) => {
        if (!Array.isArray(arr)) return;
        for (const s of arr) {
          if (s && s.setting_key && s.setting_value !== undefined && !skipSettingKeys.has(s.setting_key) && !String(s.setting_key).startsWith('canteen_')) {
            currentSettings[s.setting_key] = {
              setting_key: s.setting_key,
              setting_value: typeof s.setting_value === 'string' ? s.setting_value : JSON.stringify(s.setting_value),
              updated_at: s.updated_at || nowIso
            };
            settingsModified = true;
            restoredSettings++;
          }
        }
      };

      if (app_settings) applySettingArray(app_settings);

      if (localSettings && typeof localSettings === 'object' && !Array.isArray(localSettings)) {
        for (const [k, v] of Object.entries(localSettings)) {
          if (k && v !== undefined && v !== null && !skipSettingKeys.has(k)) {
            currentSettings[k] = {
              setting_key: k,
              setting_value: typeof v === 'string' ? v : JSON.stringify(v),
              updated_at: nowIso
            };
            settingsModified = true;
            restoredSettings++;
          }
        }
      }

      if (dutySettings && typeof dutySettings === 'object') {
        const dutyKeyMap: Record<string, string> = {
          dutyMatrix: 'baf_official_duty_matrix_v4',
          dutyRatioHistory: 'baf_duty_ratio_history_v1',
          customDuties: 'baf_custom_duties_v1',
          distributionManpower: 'baf_duty_distribution_manpower',
          distributionDisposals: 'baf_duty_distribution_disposals_master',
          distributionTotalDuty: 'baf_duty_distribution_total_duty',
          distributionCustomFlt: 'baf_duty_distribution_custom_flt',
        };
        for (const [field, storageKey] of Object.entries(dutyKeyMap)) {
          if (dutySettings[field] !== undefined && dutySettings[field] !== null) {
            currentSettings[storageKey] = {
              setting_key: storageKey,
              setting_value: typeof dutySettings[field] === 'string' ? dutySettings[field] : JSON.stringify(dutySettings[field]),
              updated_at: nowIso
            };
            settingsModified = true;
            restoredSettings++;
          }
        }
      }

      if (settingsModified) {
        saveAppSettings(currentSettings);
      }

      broadcastRealtimeEvent('FULL_SYSTEM_RESTORED');
      res.json({
        success: true,
        restoredAirmen,
        restoredAssignments,
        restoredMembers,
        restoredTxs,
        restoredSettings,
      });
    } catch (err: any) {
      console.error('Full system restore error:', err);
      res.status(500).json({ error: err.message || 'Full system restore failed' });
    }
  });

  app.get('/api/duty-assignments', (req, res) => {
    const db = loadDatabase();
    res.json(db.assignments || {});
  });

  const appendHistoryLeaveTdyToList = (db: any, list: any[], validPrefixes: string[]) => {
    const history = Array.isArray(db?.activityHistory) ? db.activityHistory : [];
    if (history.length === 0) return list;
    const out = [...list];
    const cleanDigits = (id: any) => String(id || '').replace(/\D/g, '');
    const existingKeys = new Set(
      out.map((a: any) => `${cleanDigits(a.airmanId) || a.airmanId}_${a.date}_${String(a.dutyCode || '').toUpperCase()}`)
    );
    const clearRanges: Array<{ digits: string; from: string; to: string; ts: number }> = [];
    history.forEach((h: any) => {
      const act = String(h?.actionType || h?.type || '').toUpperCase();
      if (act === 'CLEAR_RANGE' || act === 'DELETE_RANGE') {
        const from = h.fromDate || h.from_date || h.date;
        const to = h.toDate || h.to_date || from;
        if (from && to) {
          clearRanges.push({
            digits: cleanDigits(h.airmanId || h.airman_id),
            from,
            to,
            ts: h.timestamp ? Date.parse(h.timestamp) || 0 : 0,
          });
        }
      }
    });

    history.forEach((h: any) => {
      if (!h) return;
      const scope = String(h.disposalScope || 'ALL').toUpperCase();
      if (scope !== 'ALL' && scope !== 'A') return;
      const act = String(h.actionType || h.type || '').toUpperCase();
      const rawCode = String(h.dutyCode || h.duty_code || '').toUpperCase();
      if (act !== 'GRANT_LEAVE' && rawCode !== 'LEAVE' && rawCode !== 'TDY') return;
      const airId = h.airmanId || h.airman_id;
      const from = h.fromDate || h.from_date || h.date;
      const to = h.toDate || h.to_date || from;
      if (!airId || !from || !to) return;

      const code = rawCode === 'TDY' ? 'TDY' : 'LEAVE';
      const digits = cleanDigits(airId);
      const hTs = h.timestamp ? Date.parse(h.timestamp) || 0 : 0;
      const dates = getDatesInRange(from, to);
      for (const dStr of dates) {
        if (!validPrefixes.some((p) => dStr.startsWith(p))) continue;
        const k = `${digits || airId}_${dStr}_${code}`;
        if (existingKeys.has(k)) continue;
        const clearedAfter = clearRanges.some(
          (c) => digits && c.digits === digits && c.from <= dStr && c.to >= dStr && c.ts > hTs
        );
        if (clearedAfter) continue;
        out.push({
          id: `asn_${String(airId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${dStr}_${code}_n_ALL`,
          airmanId: airId,
          date: dStr,
          dutyCode: code,
          dutyName: code,
          notes: h.notes || h.description || '',
          disposalScope: 'ALL',
          updatedAt: h.updatedAt || h.timestamp || new Date().toISOString(),
        });
        existingKeys.add(k);
      }
    });
    return out;
  };

  app.get('/api/parade-state', (req, res) => {
    const date = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const shift = (req.query.shift as string) || 'Morning';
    const flight = (req.query.flight as string) || 'Overall';
    const stateType = String(req.query.stateType || req.query.documentType || 'PARADE').toUpperCase();
    const isPT = stateType === 'PT' || shift === 'PT';
    const isNightCount = stateType === 'NIGHT_COUNT' || shift === 'Night';
    const isScopeApplicable = (scope?: string) => {
      const s = (scope || 'ALL').toUpperCase();
      if (stateType === 'DASHBOARD') return s === 'ALL' || s === 'A';
      if (s === 'ALL' || s === 'A') return true;
      return s === stateType;
    };
    const isExplicitStateScope = (scope?: string) => {
      const s = (scope || 'ALL').toUpperCase();
      return s === stateType && stateType !== 'ALL' && stateType !== 'DASHBOARD';
    };
    const db = loadDatabase();
    const allAirmen = (db.airmen || []).filter((a: any) => a.active !== false);
    const targetAirmen = flight === 'Overall' ? allAirmen : allAirmen.filter((a: any) => a.flightName === flight);
    const monthKey = date.slice(0, 7);
    const rawDateAssignments = (db.assignments?.[monthKey] || []).filter((a: any) => a.date === date && isScopeApplicable(a.disposalScope));
    const dateAssignments = appendHistoryLeaveTdyToList(db, rawDateAssignments, [date]);

    const [yr, mo, da] = date.split('-').map(Number);
    const yestObj = new Date(Date.UTC(yr, (mo || 1) - 1, da || 1));
    yestObj.setUTCDate(yestObj.getUTCDate() - 1);
    const yestStr = `${yestObj.getUTCFullYear()}-${String(yestObj.getUTCMonth() + 1).padStart(2, '0')}-${String(yestObj.getUTCDate()).padStart(2, '0')}`;
    const yestMonthKey = yestStr.slice(0, 7);
    const yestAssignments = (db.assignments?.[yestMonthKey] || []).filter((a: any) => a.date === yestStr && (!a.disposalScope || a.disposalScope === 'ALL' || a.disposalScope === 'A'));

    let onParade = 0;
    let onDuty = 0;
    let onLeave = 0;
    let tdy = 0;
    let otherOff = 0;

    const personnelStatusList = targetAirmen.map((airman: any) => {
      const airDigits = String(airman.bdNo || airman.id || '').replace(/\D/g, '');
      const matchAirman = (a: any) => {
        if (a.airmanId === airman.id || a.airmanId === airman.bdNo) return true;
        const aNorm = String(a.airmanId || '').replace(/[\/_]/g, '');
        const airNorm = String(airman.id || airman.bdNo || '').replace(/[\/_]/g, '');
        if (aNorm && airNorm && aNorm === airNorm) return true;
        const aDigits = String(a.airmanId || '').replace(/\D/g, '');
        return Boolean(airDigits && aDigits && aDigits === airDigits);
      };
      const matchesToday = dateAssignments.filter(matchAirman);
      const isRecIdacNt = (rec: any) => {
        const c = String(rec?.dutyCode || '').toUpperCase().trim();
        if (!['IDAC', 'IDA', 'IDA C', 'IDA_C'].includes(c)) return false;
        const sh = String(rec?.idaShift || rec?.shift || rec?.notes || '').toLowerCase();
        return sh.includes('night') || sh.includes('nt') || sh === 'c';
      };
      const explicitOverride = matchesToday.find((r: any) => isExplicitStateScope(r.disposalScope));
      const isDepRec = (r: any) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(String(r?.dutyCode || '').toUpperCase());
      const leaveRec = matchesToday.find((r: any) => String(r?.dutyCode || '').toUpperCase() === 'LEAVE');
      const tdyRec = matchesToday.find((r: any) => ['TDY', 'DETT'].includes(String(r?.dutyCode || '').toUpperCase()));
      let match = explicitOverride || leaveRec || tdyRec || matchesToday[0];
      if (!explicitOverride && !leaveRec && !tdyRec && matchesToday.length > 1) {
        if (isPT || isNightCount) {
          match =
            matchesToday.find(isRecIdacNt) ||
            matchesToday.find((r: any) => !isDepRec(r) && r.dutyCode !== 'ON_PARADE') ||
            matchesToday.find((r: any) => r.dutyCode !== 'ON_PARADE') ||
            matchesToday[0];
        } else {
          match =
            matchesToday.find((r: any) => !isRecIdacNt(r) && !isDepRec(r) && r.dutyCode !== 'ON_PARADE') ||
            matchesToday.find((r: any) => !isRecIdacNt(r) && r.dutyCode !== 'ON_PARADE') ||
            matchesToday[0];
        }
      }

      let dutyCode = String(match?.dutyCode || 'ON_PARADE').trim() || 'ON_PARADE';
      let codeUpper = dutyCode.toUpperCase();
      const isIdac = ['IDAC', 'IDA', 'IDA C', 'IDA_C'].includes(codeUpper);
      const isIdacNt = isIdac && isRecIdacNt(match);
      const isBaseParade = ['ON_PARADE', 'PT', 'PT_PARADE', 'P', 'PRESENT'].includes(codeUpper);

      let yestOffLabel = '';
      if (!explicitOverride && !isPT && !isNightCount && (isBaseParade || isIdacNt)) {
        const yestMatch = yestAssignments.find((a: any) => matchAirman(a) && !['ON_PARADE', 'PT', 'PT_PARADE'].includes(String(a.dutyCode || '').toUpperCase()));
        if (yestMatch) {
          const yCode = String(yestMatch.dutyCode || '').toUpperCase().trim();
          if (['GD', 'SY', 'SY_DUTY', 'SECURITY', 'GUARD_DUTY'].includes(yCode)) yestOffLabel = 'SY Off';
          else if (yCode === 'BTF') yestOffLabel = 'BTF Off';
          else if (yCode === 'NTF') yestOffLabel = 'NTF Off';
          else if (yCode === 'AIRPORT' || yCode === 'AIRFIELD') yestOffLabel = 'Airfield Off';
          else if (yCode === 'HALISHAHAR') yestOffLabel = 'Halishahar Off';
          else if (yCode === 'ESCORT' || yCode === 'ESC' || yCode === 'ESCT' || yCode.includes('1794394')) yestOffLabel = 'Esct Off';
          else if (isRecIdacNt(yestMatch)) yestOffLabel = 'IDAC Nt Off';
        }
      }

      if (yestOffLabel) {
        dutyCode = 'DUTY_OFF';
        codeUpper = 'DUTY_OFF';
      }

      const isGenuineDuty =
        ['GD', 'SY', 'SY_DUTY', 'SECURITY', 'GUARD_DUTY', 'BTF', 'NTF', 'HALISHAHAR', 'AIRPORT', 'AIRFIELD', 'AIR_FD', 'ESCORT', 'ESC', 'ESCT'].includes(codeUpper) ||
        codeUpper.startsWith('CUST_') ||
        isIdac;
      let statusCategory = 'PARADE';
      if (codeUpper === 'DUTY_OFF' || codeUpper === 'OFF') {
        otherOff++; statusCategory = 'OFF';
      } else if (isBaseParade || (!isPT && !isNightCount && isIdacNt)) {
        onParade++;
        statusCategory = 'PARADE';
      } else if (codeUpper === 'LEAVE') {
        onLeave++; statusCategory = 'LEAVE';
      } else if (['TDY', 'ATT', 'DETT'].includes(codeUpper)) {
        tdy++; statusCategory = 'TDY';
      } else if (['BAKE_N_BITE', 'CANTEEN', 'RECEPTION', 'GUARD_OF_HONOUR', 'SICK_REPORT', 'SICK', 'EX_PPGF', 'ED', 'CMH', 'BNS', 'BSH', 'ESSN', 'ADMIN_ORDER', 'CAT_C', 'DRILL_CAT_C', 'CLASS_TRG', 'GAMES', 'GH', 'ABSENT', 'AWL'].includes(codeUpper)) {
        otherOff++; statusCategory = codeUpper;
      } else if (isGenuineDuty) {
        onDuty++; statusCategory = 'DUTY';
      } else {
        otherOff++; statusCategory = 'OTHERS';
      }

      let dutyName = yestOffLabel || (dutyCode === 'ON_PARADE' ? (isPT ? 'On PT' : 'On Parade') : dutyCode);
      const isCustomCode = dutyCode.startsWith('CUST_') || dutyCode.startsWith('cust_') || dutyCode.includes('1794394');
      if (isCustomCode) {
        if ((match as any)?.dutyName && !(match as any).dutyName.startsWith('CUST_')) {
          dutyName = (match as any).dutyName;
        } else if (dutyCode.includes('1794394')) {
          dutyName = 'Escort Duty';
        } else {
          try {
            const settings = loadAppSettings();
            const rawCustom = settings?.['baf_custom_duties_v1']?.setting_value;
            if (rawCustom) {
              const parsed = JSON.parse(rawCustom);
              if (Array.isArray(parsed)) {
                const found = parsed.find((p: any) => p.code === dutyCode);
                if (found?.name) dutyName = found.name;
              }
            }
            if (dutyName === dutyCode) {
              const rawMatrix = settings?.['baf_official_duty_matrix_v4']?.setting_value;
              if (rawMatrix) {
                const parsed = JSON.parse(rawMatrix);
                if (Array.isArray(parsed)) {
                  const found = parsed.find((p: any) => p.id === dutyCode || p.dutyCode === dutyCode);
                  if (found?.title) dutyName = found.title;
                }
              }
            }
          } catch {}
          if (dutyName === dutyCode) {
            dutyName = 'Escort Duty';
          }
        }
      } else if (['IDAC', 'IDA', 'IDA C', 'IDA_C'].includes(dutyCode)) {
        const s = match?.idaShift || (match as any)?.shift || 'Morning';
        dutyName = `IDAC Duty (${s})`;
      } else if (dutyCode === 'LEAVE') {
        const notesLower = (match?.notes || '').toLowerCase();
        const rawDuty = (((match as any)?.dutyName || '') as string).toLowerCase();
        const comb = `${notesLower} ${rawDuty}`;
        if (comb.includes('recreation') || comb.includes('(rl)') || comb.includes(' rl') || comb.includes('rec leave') || comb.includes('rec.')) {
          dutyName = 'Recreation Leave (RL)';
        } else if (comb.includes('annual') || comb.includes('(al)') || comb.includes(' al')) {
          dutyName = 'Annual Leave (AL)';
        } else if (comb.includes('sick') || comb.includes('(sl)') || comb.includes(' sl')) {
          dutyName = 'Sick Leave (SL)';
        } else if (comb.includes('casual') || comb.includes('(cl)') || comb.includes(' cl')) {
          dutyName = 'Casual Leave (CL)';
        } else if ((match as any)?.dutyName && (match as any).dutyName !== 'LEAVE') {
          dutyName = (match as any).dutyName;
        } else if (match?.notes && !notesLower.includes('imported')) {
          dutyName = match.notes;
        } else {
          dutyName = 'Casual Leave (CL)';
        }
      }

      return {
        airman,
        dutyCode,
        dutyName,
        previousDutyName: yestOffLabel || undefined,
        idaShift: match?.idaShift || (match as any)?.shift,
        statusCategory,
        notes: yestOffLabel || match?.notes || ''
      };
    });

    res.json({
      date,
      shift,
      flight,
      summary: {
        totalStrength: targetAirmen.length,
        onParade,
        onDuty,
        onLeave,
        tdy,
        otherOff,
        bakeNBite: 0
      },
      flightBreakdown: {},
      personnelStatusList
    });
  });

  app.get('/api/analytics', (req, res) => {
    const db = loadDatabase();
    res.json({
      totalPersonnel: (db.airmen || []).filter((a: any) => a.active !== false).length,
      assignments: [],
      conflictAlerts: []
    });
  });


  app.get('/api/roster', (req, res) => {
    const month = (req.query.month as string) || `${new Date().getFullYear()}-${(new Date().getMonth() + 1).toString().padStart(2, '0')}`;
    const db = loadDatabase();
    const rawAssignments = ((db.assignments && db.assignments[month]) || []).filter(
      (a: any) => !a.disposalScope || a.disposalScope === 'ALL' || a.disposalScope === 'A'
    );
    const assignments = appendHistoryLeaveTdyToList(db, rawAssignments, [month]);
    res.json({ monthKey: month, assignments });
  });

  app.get('/api/roster/year', (req, res) => {
    const year = parseInt((req.query.year as string) || `${new Date().getFullYear()}`, 10);
    const db = loadDatabase();
    const prefix = `${year}-`;
    const rawAssignments: any[] = [];
    if (db.assignments) {
      Object.keys(db.assignments).forEach((mKey) => {
        if (mKey.startsWith(prefix)) {
          const monthAss = (db.assignments[mKey] || []).filter(
            (a: any) => !a.disposalScope || a.disposalScope === 'ALL' || a.disposalScope === 'A'
          );
          rawAssignments.push(...monthAss);
        }
      });
    }
    const assignments = appendHistoryLeaveTdyToList(db, rawAssignments, [prefix]);
    res.json({ year, assignments });
  });

  app.get('/api/server-history', (req, res) => {
    const db = loadDatabase();
    res.json({ history: db.activityHistory || [] });
  });

  app.get('/api/roster/server-history', (req, res) => {
    const db = loadDatabase();
    res.json({ history: db.activityHistory || [] });
  });

  app.get('/api/roster/history', (req, res) => {
    const db = loadDatabase();
    res.json({ history: db.activityHistory || [] });
  });

  app.post('/api/roster/delete-history-entry', express.json(), (req, res) => {
    const { historyId } = req.body || {};
    if (!historyId) return res.status(400).json({ error: 'Missing historyId' });
    const db = loadDatabase();
    if (db.activityHistory) {
      const idx = db.activityHistory.findIndex((h: any) => h.id === historyId);
      if (idx !== -1) {
        db.activityHistory.splice(idx, 1);
        saveDatabase(db, 'DATABASE_UPDATED');
      }
    }
    res.json({ success: true });
  });

  app.post('/api/roster/undo-history', express.json(), (req, res) => {
    const { historyId } = req.body || {};
    if (!historyId) return res.status(400).json({ error: 'Missing historyId' });
    const db = loadDatabase();
    if (Array.isArray(db.activityHistory)) {
      const idx = db.activityHistory.findIndex((h: any) => h.id === historyId);
      if (idx !== -1) {
        const item = db.activityHistory[idx];
        if (Array.isArray(item.previousAssignments)) {
          if (!db.assignments) db.assignments = {};
          for (const prev of item.previousAssignments) {
            if (!prev?.date || !prev?.airmanId) continue;
            const mKey = prev.date.slice(0, 7);
            if (!db.assignments[mKey]) db.assignments[mKey] = [];
            const list = db.assignments[mKey];
            const existingIdx = list.findIndex((a: any) => a.airmanId === prev.airmanId && a.date === prev.date);
            if (prev.dutyCode) {
              const restored = {
                airmanId: prev.airmanId,
                date: prev.date,
                dutyCode: prev.dutyCode,
                idaShift: prev.idaShift,
                notes: prev.notes || '',
                updatedAt: new Date().toISOString()
              };
              if (existingIdx >= 0) list[existingIdx] = restored;
              else list.push(restored);
            } else if (existingIdx >= 0) {
              list.splice(existingIdx, 1);
            }
          }
        }
        db.activityHistory.splice(idx, 1);
        saveDatabase(db, 'DATABASE_UPDATED');
      }
    }
    res.json({ success: true });
  });

  function getDatesInRange(fromDateStr: string, toDateStr: string): string[] {
    const dates: string[] = [];
    const [fY, fM, fD] = String(fromDateStr || '').split('-').map(Number);
    const [tY, tM, tD] = String(toDateStr || fromDateStr || '').split('-').map(Number);
    if (!fY || !fM || !fD || !tY || !tM || !tD) return fromDateStr ? [fromDateStr] : [];
    const current = new Date(Date.UTC(fY, fM - 1, fD));
    const end = new Date(Date.UTC(tY, tM - 1, tD));
    while (current <= end) {
      const y = current.getUTCFullYear();
      const m = String(current.getUTCMonth() + 1).padStart(2, '0');
      const d = String(current.getUTCDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  }

  app.post('/api/roster/assign-range', express.json(), (req, res) => {
    const { airmanId, dutyCode, idaShift, fromDate, toDate, notes, proxyForFlight, disposalScope } = req.body || {};
    if (!airmanId || !dutyCode || !fromDate) {
      return res.status(400).json({ error: 'Missing required parameters: airmanId, dutyCode, fromDate' });
    }
    const db = loadDatabase();
    if (!db.assignments) db.assignments = {};
    const dates = getDatesInRange(fromDate, toDate || fromDate);
    const airman = (db.airmen || []).find((a: any) => a.id === airmanId || a.bdNo === airmanId);

    for (const dateStr of dates) {
      const monthKey = dateStr.slice(0, 7);
      if (!db.assignments[monthKey]) db.assignments[monthKey] = [];
      const list = db.assignments[monthKey];

      const isIdac = ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCode);
      const isAirport = ['ATT', 'AIRPORT', 'AIRFIELD_DUTY'].includes(dutyCode);
      const scope = disposalScope || 'ALL';

      const cleanTargetDigits = String(airmanId).replace(/\D/g, '');
      const matchAirmanId = (itemAirmanId: any) => {
        if (itemAirmanId === airmanId) return true;
        const c = String(itemAirmanId || '').replace(/\D/g, '');
        return Boolean(cleanTargetDigits && c && c === cleanTargetDigits);
      };

      let index = -1;
      if (scope !== 'ALL') {
        index = list.findIndex((a: any) =>
          matchAirmanId(a.airmanId) && a.date === dateStr &&
          (a.disposalScope || 'ALL') === scope
        );
      } else if (isIdac) {
        const isDepCode = (code: any) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(String(code || ''));
        if (idaShift === 'Night') {
          index = list.findIndex((a: any) =>
            matchAirmanId(a.airmanId) && a.date === dateStr &&
            (a.disposalScope || 'ALL') === 'ALL' &&
            (a.dutyCode === 'ON_PARADE' ||
              ((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') &&
                (a.idaShift === 'Night' || a.shift === 'Night' || a.idaShift === 'Afternoon' || a.shift === 'Afternoon')))
          );
        } else if (idaShift === 'Afternoon') {
          index = list.findIndex((a: any) =>
            matchAirmanId(a.airmanId) && a.date === dateStr &&
            (a.disposalScope || 'ALL') === 'ALL' &&
            !isDepCode(a.dutyCode)
          );
        } else {
          index = list.findIndex((a: any) =>
            matchAirmanId(a.airmanId) && a.date === dateStr &&
            (a.disposalScope || 'ALL') === 'ALL' &&
            !isDepCode(a.dutyCode) &&
            !((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && (a.idaShift === 'Night' || a.shift === 'Night'))
          );
        }
      } else if (isAirport) {
        index = list.findIndex((a: any) =>
          matchAirmanId(a.airmanId) && a.date === dateStr &&
          (a.disposalScope || 'ALL') === 'ALL' &&
          (a.dutyCode === 'AIRPORT' || a.dutyCode === 'ATT' || a.dutyCode === 'AIRFIELD_DUTY')
        );
      } else {
        const isDepCode = (code: any) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(String(code || ''));
        index = list.findIndex((a: any) =>
          matchAirmanId(a.airmanId) && a.date === dateStr &&
          !((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && (a.idaShift === 'Night' || a.shift === 'Night')) &&
          isDepCode(a.dutyCode) === isDepCode(dutyCode) &&
          (a.disposalScope || 'ALL') === scope
        );
      }

      const assignmentObj: any = {
        id: `asn_${String(airmanId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${dateStr}_${dutyCode}_${idaShift || 'n'}_${scope}`,
        assignment_id: `asn_${String(airmanId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${dateStr}_${dutyCode}_${idaShift || 'n'}_${scope}`,
        airmanId,
        date: dateStr,
        dutyCode,
        dutyType: dutyCode,
        dutyName: dutyCode,
        idaShift: isIdac ? idaShift : undefined,
        shift: isIdac ? idaShift : undefined,
        notes: notes || '',
        proxyForFlight: proxyForFlight || undefined,
        disposalScope: scope,
        updatedAt: new Date().toISOString()
      };

      if (index >= 0) {
        list[index] = assignmentObj;
      } else {
        list.push(assignmentObj);
      }
    }

    const finalScope = disposalScope || 'ALL';
    if (finalScope === 'ALL') {
      if (!db.activityHistory) db.activityHistory = [];
      db.activityHistory.unshift({
        id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        actionType: dutyCode === 'LEAVE' ? 'GRANT_LEAVE' : 'ASSIGN_RANGE',
        type: dutyCode === 'LEAVE' ? 'GRANT_LEAVE' : 'ASSIGN_RANGE',
        airmanId,
        airmanName: airman ? `${airman.rank || ''} ${airman.name || ''}`.trim() : airmanId,
        airmanRank: airman?.rank || '',
        airmanTrade: airman?.trade || '',
        dutyCode,
        idaShift,
        fromDate,
        toDate: toDate || fromDate,
        notes: notes || ''
      });
      if (db.activityHistory.length > 250) db.activityHistory = db.activityHistory.slice(0, 250);
    }

    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true, count: dates.length, assignedDates: dates });
  });

  const handleDeleteRangeOrSingle = (req: any, res: any) => {
    const { airmanId, date, fromDate, toDate, dutyCode, idaShift, disposalScope } = req.body || {};
    const start = fromDate || date;
    if (!airmanId || !start) {
      return res.status(400).json({ error: 'Missing required parameters: airmanId, date/fromDate' });
    }
    const db = loadDatabase();
    if (!db.assignments) db.assignments = {};
    const dates = getDatesInRange(start, toDate || start);

    const cleanTargetDigits = String(airmanId).replace(/\D/g, '');
    const matchAirmanId = (itemAirmanId: any) => {
      if (itemAirmanId === airmanId) return true;
      const c = String(itemAirmanId || '').replace(/\D/g, '');
      return Boolean(cleanTargetDigits && c && c === cleanTargetDigits);
    };

    for (const dateStr of dates) {
      const monthKey = dateStr.slice(0, 7);
      if (!db.assignments[monthKey]) continue;
      db.assignments[monthKey] = db.assignments[monthKey].filter((a: any) => {
        if (!matchAirmanId(a.airmanId) || a.date !== dateStr) return true;
        if (disposalScope) {
          const aScope = a.disposalScope || 'ALL';
          if (aScope !== disposalScope) return true;
        }
        if (dutyCode) {
          const isAirport = ['ATT', 'AIRPORT', 'AIRFIELD_DUTY', 'AIRFIELD'].includes(dutyCode);
          if (isAirport) {
            return !['ATT', 'AIRPORT', 'AIRFIELD_DUTY', 'AIRFIELD'].includes(a.dutyCode);
          }
          const isGd = ['GD', 'BASE_SECURITY', 'SECURITY', 'BASE SECURITY DUTY'].includes(dutyCode);
          if (isGd) {
            return !['GD', 'BASE_SECURITY', 'SECURITY', 'BASE SECURITY DUTY'].includes(a.dutyCode) && !(a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'));
          }
          if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCode)) {
            const isIdacItem = ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(String(a.dutyCode || '').toUpperCase());
            if (!isIdacItem) return true;
            if (idaShift) {
              const rawS = a.idaShift || a.shift || (String(a.id || '').match(/_IDAC?_(Morning|Afternoon|Night)_/i)?.[1]) || 'Morning';
              return String(rawS).trim().toLowerCase() !== String(idaShift).trim().toLowerCase();
            }
            return false;
          }
          return a.dutyCode !== dutyCode;
        }
        return false;
      });
    }

    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true });
  };

  app.post('/api/roster/delete-range', express.json(), handleDeleteRangeOrSingle);
  app.post('/api/roster/delete-assignment', express.json(), handleDeleteRangeOrSingle);

  const handleSingleAssign = (req: any, res: any) => {
    const body = req.body || {};
    const assignment = body.assignment || (body.airmanId && body.date ? body : null);
    if (!assignment || !assignment.airmanId || !assignment.date) {
      return res.status(400).json({ error: 'Missing assignment details' });
    }
    const targetMonth = body.monthKey || String(assignment.date).slice(0, 7);
    const db = loadDatabase();
    if (!db.assignments) db.assignments = {};
    if (!db.assignments[targetMonth]) db.assignments[targetMonth] = [];

    const list = db.assignments[targetMonth];
    const scope = assignment.disposalScope || 'ALL';
    const idx = list.findIndex(
      (a: any) =>
        a.airmanId === assignment.airmanId &&
        a.date === assignment.date &&
        (a.disposalScope || 'ALL') === scope &&
        (scope !== 'ALL' || a.dutyCode === assignment.dutyCode)
    );
    const savedObj = {
      ...assignment,
      disposalScope: scope,
      updatedAt: new Date().toISOString()
    };
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...savedObj };
    } else {
      list.push(savedObj);
    }

    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true, assignment: savedObj });
  };

  app.post('/api/roster/assign', express.json(), handleSingleAssign);
  app.put('/api/roster/assign', express.json(), handleSingleAssign);

  const handleBatchOrBulkAssign = (req: any, res: any) => {
    const { assignments: batchList, fromDate, toDate, removedAirmanIds } = req.body || {};
    if (!Array.isArray(batchList)) {
      return res.status(400).json({ error: 'Expected assignments array' });
    }
    const db = loadDatabase();
    if (!db.assignments) db.assignments = {};
    const rangeDates = fromDate ? getDatesInRange(fromDate, toDate || fromDate) : [];
    const assignedDatesSet = new Set<string>(rangeDates);

    if (Array.isArray(removedAirmanIds) && removedAirmanIds.length > 0 && rangeDates.length > 0) {
      for (const dateStr of rangeDates) {
        const mKey = dateStr.slice(0, 7);
        if (db.assignments[mKey]) {
          db.assignments[mKey] = db.assignments[mKey].filter(
            (a: any) => !(removedAirmanIds.includes(a.airmanId) && a.date === dateStr)
          );
        }
      }
    }

    let count = 0;
    for (const item of batchList) {
      if (!item || !item.airmanId || !item.dutyCode) continue;
      const targetDates = item.date ? [item.date] : rangeDates;
      for (const dateStr of targetDates) {
        if (!dateStr) continue;
        assignedDatesSet.add(dateStr);
        const mKey = dateStr.slice(0, 7);
        if (!db.assignments[mKey]) db.assignments[mKey] = [];
        const list = db.assignments[mKey];
        const scope = item.disposalScope || 'ALL';
        const idx = list.findIndex(
          (a: any) =>
            a.airmanId === item.airmanId &&
            a.date === dateStr &&
            (a.disposalScope || 'ALL') === scope &&
            a.dutyCode === item.dutyCode
        );
        const entry = {
          ...item,
          date: dateStr,
          disposalScope: scope,
          updatedAt: new Date().toISOString()
        };
        if (idx >= 0) {
          list[idx] = { ...list[idx], ...entry };
        } else {
          list.push(entry);
        }
        count++;
      }
    }

    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true, count, assignedDates: Array.from(assignedDatesSet).sort() });
  };

  app.post('/api/roster/batch-assign', express.json(), handleBatchOrBulkAssign);
  app.post('/api/roster/bulk-assign', express.json(), handleBatchOrBulkAssign);

  app.post('/api/roster/restore-assignments', express.json(), (req, res) => {
    const { restoreItems } = req.body || {};
    const db = loadDatabase();
    if (!db.assignments) db.assignments = {};
    if (Array.isArray(restoreItems)) {
      for (const item of restoreItems) {
        if (!item?.airmanId || !item?.date) continue;
        const mKey = String(item.date).slice(0, 7);
        if (!db.assignments[mKey]) db.assignments[mKey] = [];
        if (item.assignment === null) {
          db.assignments[mKey] = db.assignments[mKey].filter(
            (a: any) => !(a.airmanId === item.airmanId && a.date === item.date)
          );
        } else if (item.assignment) {
          const list = db.assignments[mKey];
          const idx = list.findIndex((a: any) => a.airmanId === item.airmanId && a.date === item.date);
          const restored = { ...item.assignment, updatedAt: new Date().toISOString() };
          if (idx >= 0) list[idx] = restored;
          else list.push(restored);
        }
      }
      saveDatabase(db, 'DATABASE_UPDATED');
    }
    res.json({ success: true, count: Array.isArray(restoreItems) ? restoreItems.length : 0 });
  });

  app.post('/api/roster/clear-all', express.json(), (req, res) => {
    const db = loadDatabase();
    db.assignments = {};
    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true, message: 'All duties cleared' });
  });

  app.post('/api/roster/reset-official', express.json(), (req, res) => {
    const db = loadDatabase();
    db.assignments = {};
    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true, message: 'Reset to official parade state data' });
  });

  app.post('/api/roster/clear-month', express.json(), (req, res) => {
    const { monthKey } = req.body || {};
    if (!monthKey) return res.status(400).json({ error: 'Missing monthKey' });
    const db = loadDatabase();
    if (db.assignments && db.assignments[monthKey]) {
      db.assignments[monthKey] = [];
      saveDatabase(db, 'DATABASE_UPDATED');
    }
    res.json({ success: true, message: `Month ${monthKey} cleared` });
  });

  app.post('/api/system/log-action', express.json(), (req, res) => {
    const { airmanId, airmanName, notes } = req.body || {};
    const db = loadDatabase();
    if (!Array.isArray(db.activityHistory)) db.activityHistory = [];
    db.activityHistory.unshift({
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      actionType: 'SYSTEM_ACTION',
      airmanId: airmanId || 'SYSTEM',
      airmanName: airmanName || 'System Configuration',
      dutyCode: 'GD',
      fromDate: '',
      toDate: '',
      notes: notes || ''
    });
    saveDatabase(db, 'DATABASE_UPDATED');
    res.json({ success: true });
  });

  app.post('/api/auth/change-passcode', express.json(), (req, res) => {
    const { newPasscode } = req.body || {};
    if (newPasscode && String(newPasscode).length === 4) {
      const db = loadDatabase();
      db.adminPasscode = String(newPasscode);
      saveDatabase(db, 'DATABASE_UPDATED');
      return res.json({ success: true });
    }
    res.status(400).json({ error: 'Invalid passcode' });
  });

  // Dedicated App Settings Endpoints
  app.get('/api/canteen/all-settings', (req, res) => {
    const settings = loadAppSettings();
    res.json(Object.values(settings));
  });

  app.post('/api/canteen/save-setting', express.json({ limit: '50mb' }), (req, res) => {
    const { setting_key, setting_value } = req.body || {};
    if (!setting_key) {
      return res.status(400).json({ error: 'Missing setting_key' });
    }
    const settings = loadAppSettings();
    settings[setting_key] = {
      setting_key,
      setting_value: typeof setting_value === 'string' ? setting_value : JSON.stringify(setting_value),
      updated_at: new Date().toISOString()
    };
    saveAppSettings(settings);
    res.json({ success: true, setting_key });
  });

  // --- API ENDPOINTS ---

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', unit: '155 UASU BAF', personnelCount: db.airmen.length });
  });

  // Resolve external image URLs (Google Photos share links, Google Drive, etc.)
  app.get('/api/resolve-image-url', async (req, res) => {
    const rawUrl = (req.query.url as string || '').trim();
    if (!rawUrl) {
      return res.status(400).json({ error: 'Missing url parameter' });
    }

    try {
      // 1. Google Drive direct link conversion
      const driveMatch = rawUrl.match(/drive\.google\.com\/(?:file\/d\/([a-zA-Z0-9_-]+)|.*[?&]id=([a-zA-Z0-9_-]+))/);
      if (driveMatch) {
        const fileId = driveMatch[1] || driveMatch[2];
        return res.json({ resolvedUrl: `https://lh3.googleusercontent.com/d/${fileId}` });
      }

      // 2. Fetch the target URL (handles photos.app.goo.gl and web pages with og:image)
      const fetchRes = await fetch(rawUrl, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
      });

      const contentType = fetchRes.headers.get('content-type') || '';
      if (contentType.startsWith('image/')) {
        return res.json({ resolvedUrl: fetchRes.url || rawUrl });
      }

      const html = await fetchRes.text();
      const ogMatch = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i)
        || html.match(/<meta content=["']([^"']+)["'] property=["']og:image["']/i)
        || html.match(/<meta name=["']twitter:image["'] content=["']([^"']+)["']/i);

      if (ogMatch && ogMatch[1]) {
        let directUrl = ogMatch[1].replace(/&amp;/g, '&');
        // If it's a googleusercontent photo, optimize size parameter
        if (directUrl.includes('googleusercontent.com')) {
          directUrl = directUrl.replace(/=w\d+-h\d+.*$/, '=s800');
        }
        return res.json({ resolvedUrl: directUrl, originalUrl: rawUrl });
      }

      return res.json({ resolvedUrl: rawUrl, note: 'No og:image found' });
    } catch (err: any) {
      console.error('Error resolving image URL:', err);
      res.status(500).json({ error: err.message, resolvedUrl: rawUrl });
    }
  });

  // Real-time Event Stream (SSE) for instant synchronization across all clients
  app.get('/api/realtime/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Initial connection message
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);

    sseClients.add(res);

    // Keep-alive heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(res);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  });

  // 1. Airmen CRUD
  app.post('/api/sync-google-sheet', async (req, res) => {
    try {
      const defaultUrl = 'https://docs.google.com/spreadsheets/d/1tsmdZI55KL6IbPhPsRqBpGWR9uTIeDE474xF36g96nY/export?format=csv';
      const sheetUrl = req.body?.sheetUrl || defaultUrl;

      const response = await fetch(sheetUrl);
      if (!response.ok) {
        return res.status(400).json({ error: `Failed to fetch sheet: ${response.statusText}` });
      }

      const csvText = await response.text();
      const lines = csvText.split('\n');

      const newAirmen: Airman[] = [];
      let serCounter = 1;

      for (const line of lines) {
        // Look for lines containing airmen records: e.g. "1,470696,SWO,Moshiur,Cy Asst,..."
        const parts = line.split(',').map((p) => p.replace(/"/g, '').trim());
        if (parts.length >= 5) {
          const serNo = parseInt(parts[0], 10);
          const bdNoRaw = parts[1];
          const rankRaw = parts[2];
          const nameRaw = parts[3];
          const tradeRaw = parts[4];

          if (!isNaN(serNo) && bdNoRaw && rankRaw && nameRaw && tradeRaw) {
            const formattedBdNo = bdNoRaw.startsWith('BD/') ? bdNoRaw : `BD/${bdNoRaw}`;
            let flightName: FlightName;
            const nLower = nameRaw.toLowerCase();
            if (['jahid', 'mobarak', 'rubel', 'shishir', 'shihshir', 'harun', 'joy', 'zakirul', 'tusar', 'saidul', 'asad', 'shohel', 'akash', 'adnan'].some(n => nLower.includes(n))) {
              flightName = 'GCS';
            } else if (['fokrul', 'baten', 'lutfar', 'aminul', 'uzzal', 'riaz', 'mustakim', 'omar', 'rasel', 'rakib', 'nishad'].some(n => nLower.includes(n))) {
              flightName = 'Avionics';
            } else if (['ahsan', 'moshiur', 'shahin', 'ripon', 'nahid', 'ismail', 'maraz', 'shariful'].some(n => nLower.includes(n)) || ['Cy Asst', 'Sec Asst (GD)', 'Log Asst', 'Admin Clerk', 'ATCA'].includes(tradeRaw)) {
              flightName = 'Admin';
            } else {
              flightName = 'Mechanics';
            }

            newAirmen.push({
              id: `airman-gs-${serNo}`,
              serNo,
              code: `${rankRaw.toUpperCase().slice(0, 3)}-${nameRaw.toUpperCase().slice(0, 3)}`,
              bdNo: formattedBdNo,
              rank: (['SWO', 'WO', 'Sgt', 'Cpl', 'LAC'].includes(rankRaw) ? rankRaw : 'LAC') as any,
              name: nameRaw,
              trade: tradeRaw,
              addressBlock: `Barrack / Quarter ${serNo % 10 + 1}`,
              mobileNo: `01711${String(serNo).padStart(6, '0')}`,
              flightName,
              remarks: `Synced from 155 UASU BAF Google Sheet (Ser ${serNo})`,
              active: true,
            });
          }
        }
      }

      if (newAirmen.length === 0) {
        return res.status(400).json({ error: 'No valid airmen personnel rows found in Google Sheet' });
      }

      db.airmen = newAirmen;
      saveDatabase(db);

      res.json({
        success: true,
        count: db.airmen.length,
        message: `Successfully synced ${db.airmen.length} airmen from 155 UASU BAF Google Sheet`,
        airmen: newAirmen
      });
    } catch (err: any) {
      console.error('Error syncing Google Sheet:', err);
      res.status(500).json({ error: err.message || 'Internal server error while syncing Google Sheet' });
    }
  });

  // 7. Reset Database endpoint
  app.post('/api/seed/reset', (req, res) => {
    db = {
      airmen: [...INITIAL_AIRMEN],
      assignments: {},
      activityHistory: [],
      adminPasscode: db.adminPasscode || '1124',
      importHistory: [],
    };

    saveDatabase(db);
    res.json({ message: 'Database reset to clean format with default 48 BAF airmen and empty duty register.' });
  });

  // 8. AI PDF / Image / Document Duty Data Import Analyzer (Gemini Powered)
  let aiClient: GoogleGenAI | null = null;
  async function getGeminiAI(): Promise<GoogleGenAI | null> {
    if (!process.env.GEMINI_API_KEY) {
      return null;
    }
    if (!aiClient) {
      const { GoogleGenAI: GenAIClass } = await import('@google/genai');
      aiClient = new GenAIClass({
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return aiClient;
  }

  // Detect rank from text helper
  function detectRankFromText(rawText: string): string | null {
    if (!rawText || typeof rawText !== 'string') return null;
    const lower = rawText.toLowerCase().replace(/[\.]/g, '');
    if (/\b(?:mwo|master\s*warrant\s*officer|m\s*w\s*o)\b/i.test(lower)) return 'MWO';
    if (/\b(?:swo|senior\s*warrant\s*officer|s\s*w\s*o)\b/i.test(lower)) return 'SWO';
    if (/\b(?:flt\s*sgt|f\/sgt|flight\s*sergeant|fs)\b/i.test(lower)) return 'Flt Sgt';
    if (/\b(?:wo|warrant\s*officer|w\s*o)\b/i.test(lower)) return 'WO';
    if (/\b(?:sgt|sergeant)\b/i.test(lower)) return 'Sgt';
    if (/\b(?:cpl|corporal)\b/i.test(lower)) return 'Cpl';
    if (/\b(?:lac|leading\s*aircraftman|l\s*a\s*c)\b/i.test(lower)) return 'LAC';
    if (/\b(?:ac|aircraftman|a\s*c)\b/i.test(lower)) return 'AC';
    return null;
  }

  function cleanAirmanNameFromText(rawText: string): string {
    if (!rawText || typeof rawText !== 'string') return '';
    return rawText
      .replace(/^[0-9]+[.\-)]\s*/, '')
      .replace(/\b(?:bd\/?|)(\d{5,7})\b/gi, '')
      .replace(/\b(?:mwo|swo|flt\s*sgt|f\/sgt|wo|sgt|cpl|lac|ac)\b/gi, '')
      .replace(/\b(?:master\s*warrant\s*officer|senior\s*warrant\s*officer|flight\s*sergeant|warrant\s*officer|sergeant|corporal|leading\s*aircraftman|aircraftman)\b/gi, '')
      .replace(/\b(?:avi|mech|gcs|admin)\s*(?:flt|flight)?\b/gi, '')
      .replace(/\((?:Morning|Afternoon|Night|CL|AL|Leave|Off|GD|BTF|NTF|IDAC|TDY|Bakery|CMH|Airport)\)/gi, '')
      .replace(/^(?:Sy Duty|TF Duty|BTF|NTF|GD|IDAC|Leave|TDY)\s*[-:]\s*/gi, '')
      .replace(/[^a-zA-Z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeRank(rank: string): string {
    const r = rank.toUpperCase().replace(/[\.\s]/g, '');
    if (r === 'MWO' || r === 'MASTERWARRA') return 'MWO';
    if (r === 'SWO' || r === 'SENIORWARRA') return 'SWO';
    if (r === 'FLTSGT' || r === 'FS' || r === 'FLIGHTSERG') return 'FLT SGT';
    if (r === 'WO' || r === 'WARRANTOFF') return 'WO';
    if (r === 'SGT' || r === 'SERGEANT') return 'SGT';
    if (r === 'CPL' || r === 'CORPORAL') return 'CPL';
    if (r === 'LAC' || r === 'LEADINGAIR') return 'LAC';
    if (r === 'AC' || r === 'AIRCRAFTMA') return 'AC';
    return r;
  }

  // Fuzzy matcher to find the best matching airman for a given extracted text snippet (RANK FIRST)
  function findBestAirmanMatch(rawText: string, flightHint?: FlightName | 'Overall'): { airman: Airman | null; confidence: number } {
    if (!rawText || !rawText.trim() || !Array.isArray(db.airmen) || db.airmen.length === 0) {
      return { airman: null, confidence: 0 };
    }
    const rawTrimmed = rawText.trim();
    const cleaned = rawTrimmed.replace(/^[0-9]+[.\-)]\s*/, '').trim().toLowerCase();

    // 1. Direct BD No check
    const bdMatch = cleaned.match(/\b(?:bd\/?|)(\d{5,7})\b/i);
    if (bdMatch) {
      const found = db.airmen.find((a) => a.bdNo.includes(bdMatch[1]));
      if (found) return { airman: found, confidence: 0.99 };
    }

    // 2. Exact match on code (e.g. WO-BTN, SGT-UZL, LAC-RSB, etc.)
    const codeFound = db.airmen.find((a) => cleaned.includes(a.code.toLowerCase()));
    if (codeFound) return { airman: codeFound, confidence: 0.95 };

    // 3. Match by rank FIRST, then name
    const detectedRank = detectRankFromText(rawTrimmed);
    const cleanName = cleanAirmanNameFromText(rawTrimmed).toLowerCase();

    if (detectedRank) {
      const normDetectedRank = normalizeRank(detectedRank);
      const rankCandidates = db.airmen.filter((a) => normalizeRank(a.rank) === normDetectedRank);

      if (rankCandidates.length > 0) {
        let searchPool = rankCandidates;
        if (flightHint && flightHint !== 'Overall') {
          const flightRank = rankCandidates.filter((a) => a.flightName === flightHint);
          if (flightRank.length > 0) {
            searchPool = [...flightRank, ...rankCandidates.filter((a) => a.flightName !== flightHint)];
          }
        }

        // Exact name match in rank
        for (const a of searchPool) {
          const aName = a.name.toLowerCase();
          if (cleanName && cleanName === aName) {
            return { airman: a, confidence: 0.96 };
          }
        }

        // Substring match in rank
        for (const a of searchPool) {
          const aName = a.name.toLowerCase();
          if (cleanName.length >= 3 && (aName.includes(cleanName) || cleanName.includes(aName))) {
            return { airman: a, confidence: 0.94 };
          }
        }

        // Token match in rank
        const queryWords = cleanName.split(/\s+/).filter((w) => w.length >= 3);
        let bestRankMatch: Airman | null = null;
        let highestScore = 0;

        for (const a of searchPool) {
          const aWords = a.name.toLowerCase().split(/[\s,./-]+/).filter((w) => w.length >= 3);
          let score = 0;
          for (const qw of queryWords) {
            for (const aw of aWords) {
              if (qw === aw) score += 2;
              else if (aw.includes(qw) || qw.includes(aw)) score += 1;
            }
          }
          if (score > highestScore) {
            highestScore = score;
            bestRankMatch = a;
          }
        }

        if (bestRankMatch && highestScore > 0) {
          return { airman: bestRankMatch, confidence: 0.90 };
        }
      }
    }

    // 4. Fallback: match without rank constraint
    let candidatePool = db.airmen;
    if (flightHint && flightHint !== 'Overall') {
      const flightList = db.airmen.filter((a) => a.flightName === flightHint);
      if (flightList.length > 0) {
        candidatePool = [...flightList, ...db.airmen.filter((a) => a.flightName !== flightHint)];
      }
    }

    const searchName = (cleanName || cleaned).toLowerCase();
    for (const a of candidatePool) {
      const nameLower = a.name.toLowerCase();
      if (searchName.length >= 3 && (nameLower.includes(searchName) || searchName.includes(nameLower))) {
        return { airman: a, confidence: 0.88 };
      }
    }

    const words = searchName.split(/[\s,./-]+/).filter((w) => w.length >= 3);
    for (const a of candidatePool) {
      const aWords = a.name.toLowerCase().split(/[\s,./-]+/).filter((w) => w.length >= 3);
      for (const w of words) {
        if (aWords.some((aw) => aw.includes(w) || w.includes(aw))) {
          return { airman: a, confidence: 0.82 };
        }
      }
    }

    return { airman: null, confidence: 0 };
  }

  // Extract all text and pages from a PDF buffer using pdf-parse
  async function extractAllPagesFromPdf(buffer: Buffer): Promise<{ totalPages: number; pages: Array<{ pageNumber: number; text: string }>; fullText: string }> {
    try {
      const { default: pdfParsePkg } = await import('pdf-parse/lib/pdf-parse.js');
      const parsed = await pdfParsePkg(buffer);
      const totalPages = parsed.numpages || 1;
      const pages = [{
        pageNumber: 1,
        text: parsed.text || ''
      }];
      const fullText = pages.map((p) => `--- [PAGE ${p.pageNumber} OF ${totalPages}] ---\n${p.text}`).join('\n\n');
      return { totalPages, pages, fullText };
    } catch (err: any) {
      console.warn('PDFParse extraction note:', err?.message || err);
      // Fallback: extract binary text stream
      const rawStr = buffer.toString('binary');
      const textMatches = rawStr.match(/\(([^()]{2,100})\)\s*(?:Tj|TJ|'|")/g);
      let fallbackText = '';
      if (textMatches && textMatches.length > 5) {
        fallbackText = textMatches
          .map((m) => m.replace(/^\(|\)\s*(?:Tj|TJ|'|")$/g, '').trim())
          .filter((t) => t.length > 1)
          .join(' ');
      }
      return {
        totalPages: 1,
        pages: fallbackText ? [{ pageNumber: 1, text: fallbackText }] : [],
        fullText: fallbackText,
      };
    }
  }

  // Advanced Heuristic BAF Duty Table Parser (Supports table grids, section headers, multi-flight pages, and 20+ unlimited pages)
  function parseRosterTextHeuristically(
    rawInputText: string,
    targetYear: number,
    targetFlight: FlightName | 'Overall'
  ): any {
    const lines = rawInputText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    let defaultFlight: FlightName = targetFlight === 'Overall' ? 'Avionics' : targetFlight;
    let currentFlight: FlightName = defaultFlight;

    const monthMap: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', may_: '05', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };

    const dateMap = new Map<string, { date: string; day: string; assignments: any[] }>();
    const dateRegex = /(?:^|\b)(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+([A-Za-z]+))?/i;
    const numericDateRegex = /(?:^|\b)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})|(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/;

    let activeSectionDuty: DutyCategoryCode | null = null;
    let activeSectionDutyName = '';
    let activeSectionIdaShift: IDAShift | null = null;
    let currentDateStr = '';
    let currentDayName = '';

    // Detect section headers (e.g. "Sy Duty", "TF Duty", "IDAC Duty", "Leave")
    const detectSectionDuty = (line: string): { code: DutyCategoryCode; name: string; shift: IDAShift | null } | null => {
      const upper = line.toUpperCase().trim();
      if (upper === 'SY DUTY' || upper === 'SECURITY DUTY' || upper.startsWith('SY DUTY') || upper.startsWith('BASE SECURITY') || upper === 'GD') {
        return { code: 'GD', name: 'Base Security Duty', shift: null };
      }
      if (upper === 'TF DUTY' || upper === 'TASK FORCE DUTY' || upper.startsWith('TF DUTY') || upper.startsWith('TASK FORCE')) {
        return { code: 'BTF', name: 'Base Taskforce Duty', shift: null };
      }
      if (upper === 'NTF' || upper.includes('NAJIRPARA')) {
        return { code: 'NTF', name: 'Najirpara Taskforce Duty', shift: null };
      }
      if (upper.includes('HALISHAHAR') || upper === 'HALI DUTY') {
        return { code: 'HALISHAHAR', name: 'Halishahar Taskforce Duty', shift: null };
      }
      if (upper.includes('AIRFIELD') || upper.includes('AIRPORT')) {
        return { code: 'ATT', name: 'Airfield Duty', shift: null };
      }
      if (upper.includes('IDAC') || upper.includes('IDA CENTER')) {
        let shift: IDAShift = 'Morning';
        if (upper.includes('NIGHT')) shift = 'Night';
        else if (upper.includes('AFTERNOON') || upper.includes('AFT')) shift = 'Afternoon';
        return { code: 'IDAC', name: 'IDA Center Duty', shift };
      }
      if (upper === 'LEAVE' || upper.startsWith('LEAVE') || upper === 'CL' || upper === 'AL') {
        return { code: 'LEAVE', name: 'Leave (CL/AL)', shift: null };
      }
      if (upper.includes('BAKE N BITE') || upper.includes('BAKE & BITE')) {
        return { code: 'BAKE_N_BITE', name: 'Bake N Bite', shift: null };
      }
      if (upper === 'TDY' || upper.startsWith('TDY')) {
        return { code: 'TDY', name: 'TDY', shift: null };
      }
      return null;
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const upperLine = line.toUpperCase();

      // Check for page markers and flight headers
      if (upperLine.includes('AVI FLT') || upperLine.includes('AVIONIC')) {
        currentFlight = 'Avionics';
      } else if (upperLine.includes('MECH FLT') || upperLine.includes('MECHANIC')) {
        currentFlight = 'Mechanics';
      } else if (upperLine.includes('GCS FLT') || upperLine.includes('GCS')) {
        currentFlight = 'GCS';
      } else if (upperLine.includes('ADMIN FLT') || upperLine.includes('ADMIN')) {
        currentFlight = 'Admin';
      }

      // Check if line is a section header (e.g. "Sy Duty", "TF Duty")
      const sectionMatch = detectSectionDuty(line);
      if (sectionMatch && !line.match(dateRegex)) {
        activeSectionDuty = sectionMatch.code;
        activeSectionDutyName = sectionMatch.name;
        activeSectionIdaShift = sectionMatch.shift;
        continue;
      }

      let lineContent = line;

      const match = line.match(dateRegex);
      if (match) {
        const dayNum = match[1].padStart(2, '0');
        const monthStr = match[2].toLowerCase().slice(0, 3);
        const monthNum = monthMap[monthStr] || '08';
        currentDayName = match[3] || '';
        currentDateStr = `${targetYear}-${monthNum}-${dayNum}`;
        lineContent = line.slice(match.index! + match[0].length).replace(/^[\s:—|]+/, '').trim();
      } else {
        const numMatch = line.match(numericDateRegex);
        if (numMatch) {
          if (numMatch[1]) {
            currentDateStr = `${numMatch[1]}-${numMatch[2].padStart(2, '0')}-${numMatch[3].padStart(2, '0')}`;
          } else {
            const yr = numMatch[6].length === 2 ? `20${numMatch[6]}` : numMatch[6];
            currentDateStr = `${yr}-${numMatch[5].padStart(2, '0')}-${numMatch[4].padStart(2, '0')}`;
          }
          lineContent = line.slice(numMatch.index! + numMatch[0].length).replace(/^[\s:—|]+/, '').trim();
        }
      }

      if (currentDateStr) {
        if (!dateMap.has(currentDateStr)) {
          dateMap.set(currentDateStr, { date: currentDateStr, day: currentDayName, assignments: [] });
        }
        const entry = dateMap.get(currentDateStr)!;

        // Process tokens in lineContent
        const tokens = lineContent.split(/(?:[-—|•\t;]+|\s{2,})/);

        for (const token of tokens) {
          const cleanToken = token.trim();
          if (!cleanToken || cleanToken === '-' || cleanToken === '--' || cleanToken.length < 2) continue;

          // Split numbered items e.g., "1. WO Aminul 2. Sgt Uzzal" or comma-separated
          const subNames = cleanToken
            .split(/(?=\d+[.\-)])|,/)
            .map((s) => s.replace(/^\d+[.\-)]\s*/, '').trim())
            .filter((s) => s.length > 2);
          const namesToProcess = subNames.length > 0 ? subNames : [cleanToken];

          for (const item of namesToProcess) {
            let dutyCode: DutyCategoryCode = activeSectionDuty || 'GD';
            let dutyName = activeSectionDutyName || 'Base Security Duty';
            let idaShift: IDAShift | null = activeSectionIdaShift || null;

            const itemUpper = item.toUpperCase();
            const fullLineUpper = lineContent.toUpperCase();

            // Override with inline duty indicators if present
            if (itemUpper.includes('NTF') || itemUpper.includes('NAJIRPARA') || fullLineUpper.includes('NAJIRPARA')) {
              dutyCode = 'NTF';
              dutyName = 'Najirpara Taskforce Duty';
            } else if (itemUpper.includes('BTF') || fullLineUpper.includes('BASE TASKFORCE')) {
              dutyCode = 'BTF';
              dutyName = 'Base Taskforce Duty';
            } else if (itemUpper.includes('TF DUTY') || itemUpper.startsWith('TF -')) {
              dutyCode = 'BTF';
              dutyName = 'Base Taskforce Duty';
            } else if (itemUpper.includes('GD') || itemUpper.includes('SY DUTY') || fullLineUpper.includes('BASE SECURITY')) {
              dutyCode = 'GD';
              dutyName = 'Base Security Duty';
            } else if (itemUpper.includes('HALISHAHAR') || itemUpper.includes('HALI')) {
              dutyCode = 'HALISHAHAR';
              dutyName = 'Halishahar Taskforce Duty';
            } else if (itemUpper.includes('AIRFIELD') || itemUpper.includes('AIRPORT')) {
              dutyCode = 'ATT';
              dutyName = 'Airfield Duty';
            } else if (itemUpper.includes('LEAVE') || itemUpper.includes(' C/L') || itemUpper.includes(' A/L')) {
              dutyCode = 'LEAVE';
              dutyName = 'Leave (CL/AL)';
            } else if (itemUpper.includes('NIGHT') || itemUpper.includes('IDA NIGHT')) {
              dutyCode = 'IDAC';
              dutyName = 'IDA Center Duty';
              idaShift = 'Night';
            } else if (itemUpper.includes('AFTERNOON') || itemUpper.includes('IDA AFT')) {
              dutyCode = 'IDAC';
              dutyName = 'IDA Center Duty';
              idaShift = 'Afternoon';
            } else if (itemUpper.includes('MORNING') || itemUpper.includes('IDA MORN')) {
              dutyCode = 'IDAC';
              dutyName = 'IDA Center Duty';
              idaShift = 'Morning';
            } else if (itemUpper.includes('OFF') || itemUpper.includes('DUTY OFF')) {
              dutyCode = 'DUTY_OFF';
              dutyName = 'Duty Off';
            }

            // Clean duty prefix from name string (e.g., "LAC Rakib (Night)" -> "LAC Rakib")
            const cleanName = item
              .replace(/\((?:Morning|Afternoon|Night|CL|AL|Leave|Off)\)/gi, '')
              .replace(/^(?:Sy Duty|TF Duty|BTF|NTF|GD|IDAC|Leave|TDY)\s*[-:]\s*/gi, '')
              .trim();

            if (dutyCode === 'DUTY_OFF' || dutyCode === 'ON_PARADE') {
              continue;
            }

            const matched = findBestAirmanMatch(cleanName || item, currentFlight);
            if (matched.airman) {
              const alreadyExists = entry.assignments.some(
                (a) => a.matchedAirmanId === matched.airman!.id && a.dutyCode === dutyCode && (dutyCode !== 'IDAC' || a.idaShift === idaShift)
              );
              if (!alreadyExists) {
                entry.assignments.push({
                  rawText: cleanName || item,
                  dutyCode,
                  dutyName,
                  idaShift,
                  matchedAirmanId: matched.airman.id,
                  matchedAirmanName: matched.airman.name,
                  matchedAirmanRank: matched.airman.rank,
                  matchedAirmanFlight: matched.airman.flightName,
                  matchedAirmanBdNo: matched.airman.bdNo,
                  confidence: matched.confidence,
                });
              }
            } else if (cleanName.length > 2 && !['DUTY', 'PARADE', 'STATE', 'FLIGHT', 'TOTAL', 'OFF', 'PRESENT', 'LEAVE'].some((k) => itemUpper === k)) {
              const alreadyExists = entry.assignments.some((a) => a.rawText === (cleanName || item) && a.dutyCode === dutyCode);
              if (!alreadyExists) {
                entry.assignments.push({
                  rawText: cleanName || item,
                  dutyCode,
                  dutyName,
                  idaShift,
                  matchedAirmanId: null,
                  matchedAirmanName: cleanName || item,
                  confidence: 0,
                });
              }
            }
          }
        }
      }
    }

    const dates = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return {
      documentTitle: `PARADE STATE / DUTY ROSTER : ${currentFlight.toUpperCase()} FLT`,
      detectedFlight: currentFlight,
      year: targetYear,
      month: 8,
      totalDates: dates.length,
      dateRange: {
        start: dates[0]?.date || `${targetYear}-08-01`,
        end: dates[dates.length - 1]?.date || `${targetYear}-08-31`,
      },
      dates,
    };
  }

  
  app.post('/api/import/analyze-duty-doc', async (req, res) => {
    try {
      const { fileBase64, files, mimeType, textSnippet, targetYear = 2026, targetFlight = 'Overall' } = req.body || {};

      const fileList = [];
      if (Array.isArray(files) && files.length > 0) {
        for (const f of files) {
          if (f.fileBase64 || f.base64) {
            fileList.push({
              base64: f.fileBase64 || f.base64,
              mime: f.mimeType || f.mime || 'application/pdf',
              name: f.fileName || f.name || 'Document',
            });
          }
        }
      } else if (fileBase64) {
        fileList.push({
          base64: fileBase64,
          mime: mimeType || 'application/pdf',
          name: 'Document',
        });
      }

      if (fileList.length === 0 && !textSnippet) {
        return res.status(400).json({ error: 'No file data or text provided for analysis' });
      }

      let combinedText = textSnippet || '';
      const partsForGemini: any[] = [];

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const buffer = Buffer.from(file.base64.split(',').pop() || '', 'base64');
        
        partsForGemini.push({
          inlineData: {
            mimeType: file.mime === 'application/pdf' ? 'application/pdf' : file.mime,
            data: file.base64.split(',').pop() || ''
          }
        });
        
        try {
          if (file.mime === 'application/pdf') {
            try {
              const { default: pdfParsePkg } = await import('pdf-parse/lib/pdf-parse.js');
              const pdfData = await pdfParsePkg(buffer);
              combinedText += '\n--- PDF PAGE ---\n' + pdfData.text;
            } catch (pdfErr) {
              console.warn('PDF Parse error in /api/import/analyze-duty-doc:', pdfErr);
              // Fallback to binary stream extraction
              const { fullText } = await extractAllPagesFromPdf(buffer);
              combinedText += '\n--- PDF PAGE (Heuristic) ---\n' + fullText;
            }
          } else if (file.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.mime.includes('word')) {
            const { default: mammoth } = await import('mammoth');
            const result = await mammoth.extractRawText({ buffer });
            combinedText += '\n--- DOCX CONTENT ---\n' + result.value;
          } else if (file.mime.startsWith('image/')) {
            console.log("Running Tesseract OCR on image...");
            const { default: Tesseract } = await import('tesseract.js');
            const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
            combinedText += '\n--- OCR IMAGE CONTENT ---\n' + text;
          } else {
             combinedText += '\n' + buffer.toString('utf8');
          }
        } catch (e) {
          console.error("Error parsing file", file.name, e);
        }
      }

      const db = loadDatabase();
      const airmen = db.airmen;
      const dutyCodes = ['GD', 'BTF', 'NTF', 'HALISHAHAR', 'AIRFIELD_DUTY', 'LEAVE', 'IDAC', 'DUTY_OFF', 'ON_PARADE', 'BAKE_N_BITE', 'ESSN', 'CMH', 'SICK_REPORT', 'DRILL_CAT_C', 'RECEPTION', 'TDY', 'ADMIN_ORDER', 'CLASS_TRG', 'GAMES', 'ABSENT'];
      
      const lines = combinedText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let finalDates: any[] = [];
      let totalAssignmentsCount = 0;
      
      let heuristicFinalDates: any[] = [];
      let heuristicAssignmentsCount = 0;
      
      try {
        const heuristicResult = parseRosterTextHeuristically(combinedText, targetYear, targetFlight);
        if (heuristicResult && heuristicResult.dates) {
          for (const d of heuristicResult.dates) {
            const mappedAssignments = [];
            for (const a of d.assignments) {
              // Always include, even if matchedAirmanId is null (allows manual fixing in UI)
              mappedAssignments.push({
                rawText: a.rawText || a.matchedAirmanName || '',
                dutyCode: a.dutyCode,
                dutyName: a.dutyName || a.dutyCode,
                idaShift: a.idaShift,
                matchedAirmanId: a.matchedAirmanId || null,
                matchedAirmanName: a.matchedAirmanName || a.rawText,
                matchedAirmanRank: a.matchedAirmanRank,
                matchedAirmanFlight: a.matchedAirmanFlight,
                matchedAirmanBdNo: a.matchedAirmanBdNo,
                confidence: a.confidence || 0
              });
            }
            if (mappedAssignments.length > 0) {
              heuristicFinalDates.push({
                date: d.date,
                assignments: mappedAssignments
              });
              heuristicAssignmentsCount += mappedAssignments.length;
            }
          }
        }
      } catch (e) {
        console.warn("Heuristic parser error:", e);
      }

      try {
        const ai = await getGeminiAI();
        if (ai && process.env.GEMINI_API_KEY) {
          const prompt = `Extract duty roster assignments from the provided document(s) or text.
Return a JSON object with a "dates" array. Each date object should have a "date" (YYYY-MM-DD) and an "assignments" array.
To save space, each assignment in the array MUST be a single string in the format "Name, BD No, Duty Code, Shift".
- Duty Code MUST be one of: ${dutyCodes.join(', ')}
- Shift MUST be one of: Morning, Afternoon, Night, or null
- If BD No is not found, leave it empty (e.g. "Rakib, , GD, null")
- Make sure to extract ALL assignments for ALL dates. Do not skip any.
If text is provided below, analyze it as well:
${combinedText.substring(0, 30000)}
`;
          partsForGemini.push({ text: prompt });

          let response;
          let retries = 5;
          while (retries > 0) {
            try {
              const currentParts = retries <= 3 ? partsForGemini.filter(p => !p.inlineData) : partsForGemini;
              response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: currentParts }],
                config: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: 'OBJECT',
                    properties: {
                      dates: {
                        type: 'ARRAY',
                        items: {
                          type: 'OBJECT',
                          properties: {
                            date: { type: 'STRING', description: 'YYYY-MM-DD' },
                            assignments: {
                              type: 'ARRAY',
                              items: {
                                type: 'STRING',
                                description: 'Format: "Name, BDNo, DutyCode, Shift"'
                              }
                            }
                          },
                          required: ['date', 'assignments']
                        }
                      }
                    },
                    required: ['dates']
                  }
                }
              });
              break;
            } catch (err: any) {
              if (err?.status === 'UNAVAILABLE' || err?.status === 'RESOURCE_EXHAUSTED' || err?.code === 503 || err?.status === 503) {
                retries--;
                if (retries === 0) throw err;
                console.warn(`Gemini API 503 error, retrying... (${retries} retries left)`);
                await new Promise(r => setTimeout(r, 4000));
              } else {
                console.warn("AI Parsing failed, falling back to heuristic:", err);
                break; // Break the retry loop and fall back to heuristics
              }
            }
          }

          let aiData;
          try {
             aiData = JSON.parse(response?.text || '{}');
          } catch (jsonErr) {
             console.warn("JSON parsing failed exactly, attempting to fix truncated JSON...");
             let fixedText = response?.text || '';
             // Try to append closing brackets if truncated
             const openBraces = (fixedText.match(/\{/g) || []).length;
             const closeBraces = (fixedText.match(/\}/g) || []).length;
             const openBrackets = (fixedText.match(/\[/g) || []).length;
             const closeBrackets = (fixedText.match(/\]/g) || []).length;
             
             // Very basic fix for truncated string arrays at the end
             if (fixedText.lastIndexOf('"') > fixedText.lastIndexOf(',')) {
                fixedText += '"]}]}';
             }
             try {
                aiData = JSON.parse(fixedText);
             } catch (e2) {
                console.error("Could not recover JSON", e2);
             }
          }

          if (aiData && Array.isArray(aiData.dates) && aiData.dates.length > 0) {
            let aiAssignmentsCount = 0;
            const aiFinalDates = [];
            for (const d of aiData.dates) {
              const mappedAssignments = [];
              if (Array.isArray(d.assignments)) {
                for (const assignStr of d.assignments) {
                  if (typeof assignStr !== 'string') continue;
                  const parts = assignStr.split(',').map(s => s.trim());
                  const aiName = parts[0] || '';
                  const aiBdNo = parts[1] || '';
                  const aiDutyCode = parts[2] || 'GD';
                  const aiShiftStr = parts[3];
                  const aiShift = (aiShiftStr === 'Morning' || aiShiftStr === 'Afternoon' || aiShiftStr === 'Night') ? aiShiftStr : null;

                  let foundAirman = null;
                  for (const a of airmen) {
                    if ((aiBdNo && a.bdNo.includes(aiBdNo)) || 
                        (aiName && a.name.toLowerCase().includes(aiName.toLowerCase()))) {
                      foundAirman = a;
                      break;
                    }
                  }
                  if (!foundAirman && aiName) {
                     const matched = findBestAirmanMatch(aiName, targetFlight);
                     if (matched.airman && matched.confidence > 0.5) {
                        foundAirman = matched.airman;
                     }
                  }
                  
                  if (foundAirman) {
                    mappedAssignments.push({
                      rawText: assignStr,
                      dutyCode: aiDutyCode,
                      dutyName: aiDutyCode,
                      idaShift: aiShift,
                      matchedAirmanId: foundAirman.id,
                      matchedAirmanName: foundAirman.name,
                      matchedAirmanRank: foundAirman.rank,
                      matchedAirmanFlight: foundAirman.flightName,
                      matchedAirmanBdNo: foundAirman.bdNo,
                      confidence: 0.99
                    });
                  } else if (aiName && aiName.length > 2) {
                    mappedAssignments.push({
                      rawText: assignStr,
                      dutyCode: aiDutyCode,
                      dutyName: aiDutyCode,
                      idaShift: aiShift,
                      matchedAirmanId: null,
                      matchedAirmanName: aiName,
                      confidence: 0
                    });
                  }
                }
              }
              if (mappedAssignments.length > 0) {
                aiFinalDates.push({
                  date: d.date,
                  assignments: mappedAssignments
                });
                aiAssignmentsCount += mappedAssignments.length;
              }
            }
            
            // Check if AI performed well compared to Heuristic
            if (aiAssignmentsCount >= heuristicAssignmentsCount * 0.8 && aiAssignmentsCount > 0) {
               // AI did a good job (extracted at least 80% of what heuristic found, or more)
               // Let's merge them to ensure NO data is lost
               const mergedMap = new Map();
               
               // Add AI Data first
               for (const d of aiFinalDates) {
                  mergedMap.set(d.date, [...d.assignments]);
               }
               
               // Add missing from Heuristic
               for (const d of heuristicFinalDates) {
                  if (!mergedMap.has(d.date)) mergedMap.set(d.date, []);
                  const existingArr = mergedMap.get(d.date);
                  
                  for (const heuAssign of d.assignments) {
                     if (!existingArr.find((x: any) => x.matchedAirmanBdNo === heuAssign.matchedAirmanBdNo)) {
                        existingArr.push(heuAssign);
                     }
                  }
               }
               
               finalDates = Array.from(mergedMap.entries()).map(([date, assignments]) => ({ date, assignments }));
               finalDates.sort((a, b) => a.date.localeCompare(b.date));
               for (const d of finalDates) totalAssignmentsCount += d.assignments.length;
               
            } else {
               console.warn(`AI extracted ${aiAssignmentsCount} vs Heuristic ${heuristicAssignmentsCount}. Discarding AI results to prevent data loss.`);
               finalDates = heuristicFinalDates;
               totalAssignmentsCount = heuristicAssignmentsCount;
            }
          } else {
            console.warn(`AI did not return valid dates. Falling back to heuristic.`);
            finalDates = heuristicFinalDates;
            totalAssignmentsCount = heuristicAssignmentsCount;
          }
        } else {
           finalDates = heuristicFinalDates;
           totalAssignmentsCount = heuristicAssignmentsCount;
        }
      } catch (aiErr) {
        console.warn('AI Parsing failed, falling back to heuristic:', aiErr);
        finalDates = heuristicFinalDates;
        totalAssignmentsCount = heuristicAssignmentsCount;
      }

      if (finalDates.length === 0) {
         finalDates = heuristicFinalDates;
         totalAssignmentsCount = heuristicAssignmentsCount;
      }

      if (finalDates.length === 0 || totalAssignmentsCount === 0) {
         return res.status(400).json({ error: 'No dates or duty assignments could be detected in the document. Please verify the document format.' });
      }

      res.json({
        documentTitle: `OCR Extracted Duty Roster`,
        detectedFlight: targetFlight,
        year: targetYear,
        month: finalDates[0] ? parseInt(finalDates[0].date.split('-')[1], 10) : 8,
        totalDates: finalDates.length,
        totalPages: fileList.length || 1,
        totalFiles: fileList.length || 1,
        dateRange: {
          start: finalDates[0]?.date || `${targetYear}-08-01`,
          end: finalDates[finalDates.length - 1]?.date || `${targetYear}-08-31`,
        },
        dates: finalDates,
        totalAssignmentsCount,
        textExtracted: true,
        source: 'OCR_and_Text_Parser'
      });
      
    } catch (err) {
      console.error('Error in analyze-duty-doc:', err);
      res.status(500).json({ error: err.message || 'Failed to analyze duty document' });
    }
  });

// 8.1. Direct Load Official 155 UASU Parade State Roster (01 Jul - 31 Aug)
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Vite middleware in dev or static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Keep process alive indefinitely to prevent event-loop drain during server transitions
  setInterval(() => {}, 1000 * 60 * 60);

  const startListening = () => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`[155 UASU BAF] Duty Management Server running on http://${HOST}:${PORT}`);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[server] Port ${PORT} busy, retrying in 1000ms...`);
        setTimeout(startListening, 1000);
      } else {
        console.error('[server] Server error:', err);
      }
    });
  };

  startListening();
}

startServer().catch((err) => {
  console.error('[server] Failed to start server:', err);
});


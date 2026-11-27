import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore/lite';
import {
  auth,
  db,
  dbLite,
  firebaseConfig,
  isFirebaseConfigured,
  isFirestoreQuotaExceeded,
  isQuotaExceededError,
  setFirestoreQuotaExceeded,
  handleFirestoreError,
  OperationType,
  CLIENT_SESSION_ID,
  getOfficeScopedStorageKey,
  getOfficeFirestoreDocPrefix,
  isDefault155UasuOffice,
  IS_AI_STUDIO_PRACTICE_MODE,
} from '../firebase';
import { recordFirestoreQuotaUsage } from '../utils/firebaseQuotaTracker';

export interface FirebaseMigrationResult {
  success: boolean;
  airmenCount: number;
  dutyCount: number;
  paradeCount: number;
  usersCount: number;
  settingsCount: number;
  canteenMembersCount: number;
  canteenTxsCount: number;
  canteenExpensesCount: number;
  errors: string[];
}

export interface SyncManifest {
  id: string;
  revision: number;
  updatedAt: string;
  updatedBySessionId?: string;
  updatedByBdNo?: string;
  lastReason?: string;
  changedCollections?: string[];
  dataHash?: string;
  airmenCount?: number;
  assignmentsCount?: number;
}

export interface PendingAssignmentDelta {
  docId: string;
  updatedAt: string;
  isDeleted?: boolean;
  assignment?: any;
}

export interface PendingDeltaQueue {
  airmen: Record<string, string>; // key -> updatedAt
  assignments: Record<string, PendingAssignmentDelta>; // docId -> delta
  history: Record<string, string>; // id -> updatedAt
  users: Record<string, string>; // id -> updatedAt
  settings: Record<string, string>; // settingKey -> updatedAt
  canteenData: Record<string, string>; // docKey -> updatedAt
  canteenMembers: Record<string, string>; // airman_id -> updatedAt
  lastModifiedAt: string;
}

const PENDING_DELTA_QUEUE_KEY = 'baf_pending_delta_queue_v1';

// -------------------- Helpers --------------------

export function sanitizeDocId(raw: string): string {
  const s = String(raw || 'doc')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_');
  const trimmed = s || 'doc';
  if (trimmed.length <= 120) return trimmed;
  // Deterministic suffix hash for long keys
  let hash = 0;
  for (let i = 0; i < trimmed.length; i++) {
    hash = (hash * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  return `${trimmed.slice(0, 105)}_${hash.toString(36)}`;
}

function clampStr(val: any, maxLen: number): string | undefined {
  if (val === undefined || val === null) return undefined;
  const s = String(val);
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function toIsoString(val: any): string {
  if (typeof val === 'string' && val.trim()) {
    const t = Date.parse(val);
    if (!isNaN(t)) return new Date(t).toISOString();
  }
  if (typeof val === 'number' && !isNaN(val)) {
    return new Date(val).toISOString();
  }
  return new Date().toISOString();
}

function stripUndefinedDeep(obj: any): any {
  if (obj === undefined || obj === null) return null;
  if (Array.isArray(obj)) {
    return obj.map((v) => (v === undefined ? null : stripUndefinedDeep(v)));
  }
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out;
  }
  return obj;
}

function encodeNativeSettingValue(raw: any): any {
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'boolean' || typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length <= 4800) {
          const cleaned = stripUndefinedDeep(parsed);
          const checkLen = JSON.stringify(cleaned).length;
          if (checkLen <= 850000) return cleaned;
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          Object.keys(parsed).length <= 4800
        ) {
          const cleaned = stripUndefinedDeep(parsed);
          const checkLen = JSON.stringify(cleaned).length;
          if (checkLen <= 850000) return cleaned;
        }
      } catch {}
    }
    return raw.length > 890000 ? raw.slice(0, 890000) : raw;
  }
  if (Array.isArray(raw)) {
    if (raw.length <= 4800) {
      const cleaned = stripUndefinedDeep(raw);
      if (JSON.stringify(cleaned).length <= 850000) return cleaned;
    }
    const str = JSON.stringify(raw);
    return str.length > 890000 ? str.slice(0, 890000) : str;
  }
  if (typeof raw === 'object') {
    if (Object.keys(raw).length <= 4800) {
      const cleaned = stripUndefinedDeep(raw);
      if (JSON.stringify(cleaned).length <= 850000) return cleaned;
    }
    const str = JSON.stringify(raw);
    return str.length > 890000 ? str.slice(0, 890000) : str;
  }
  return String(raw);
}

export function decodeNativeValueToString(val: any): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  return JSON.stringify(val);
}

export function isCorruptedAssignmentRecord(a: any): boolean {
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

function stripActiveOfficePrefixFromRawId(raw: string): string {
  const s = String(raw || '').trim();
  if (!s) return s;
  const prefix = getOfficeFirestoreDocPrefix();
  if (prefix) {
    const altPrefix = prefix.replace(/__$/, '_');
    if (s.startsWith(prefix)) return s.slice(prefix.length);
    if (altPrefix && s.startsWith(altPrefix)) return s.slice(altPrefix.length);
  }
  return s;
}

export function getAssignmentDocId(a: any): string {
  const raw =
    stripActiveOfficePrefixFromRawId(a?.id) ||
    `asn_${a?.airmanId || 'u'}_${a?.date || '0000'}_${a?.dutyCode || 'ON_PARADE'}_${a?.idaShift || 'n'}_${a?.disposalScope || 'ALL'}`;
  return sanitizeDocId(raw);
}

export function getAirmanDocId(a: any): string {
  const cleanBd = String(a?.bdNo || '').replace(/\D/g, '');
  const raw = stripActiveOfficePrefixFromRawId(a?.id) || (cleanBd ? `BD_${cleanBd}` : `airman_${Date.now()}`);
  return sanitizeDocId(raw);
}

export function getUserProfileDocId(u: any): string {
  const cleanBd = clampStr(String(u?.userId || u?.bdNo || '').replace(/^BD\/?/i, '').trim() || 'unknown', 64) || 'unknown';
  return sanitizeDocId(stripActiveOfficePrefixFromRawId(u?.id) || `user_login_${cleanBd}`);
}

// -------------------- Pending Offline Delta Queue --------------------

function emptyQueue(): PendingDeltaQueue {
  return {
    airmen: {},
    assignments: {},
    history: {},
    users: {},
    settings: {},
    canteenData: {},
    canteenMembers: {},
    lastModifiedAt: new Date().toISOString(),
  };
}

export function getPendingDeltaQueue(): PendingDeltaQueue {
  if (typeof window === 'undefined') return emptyQueue();
  try {
    const key = getOfficeScopedStorageKey(PENDING_DELTA_QUEUE_KEY);
    const raw = window.localStorage.getItem(key);
    if (!raw) return emptyQueue();
    const p = JSON.parse(raw);
    return {
      airmen: p?.airmen || {},
      assignments: p?.assignments || {},
      history: p?.history || {},
      users: p?.users || {},
      settings: p?.settings || {},
      canteenData: p?.canteenData || {},
      canteenMembers: p?.canteenMembers || {},
      lastModifiedAt: p?.lastModifiedAt || new Date().toISOString(),
    };
  } catch {
    return emptyQueue();
  }
}

export function savePendingDeltaQueue(q: PendingDeltaQueue): void {
  if (typeof window === 'undefined') return;
  try {
    q.lastModifiedAt = new Date().toISOString();
    const key = getOfficeScopedStorageKey(PENDING_DELTA_QUEUE_KEY);
    window.localStorage.setItem(key, JSON.stringify(q));
    window.dispatchEvent(new CustomEvent('baf_pending_delta_updated', { detail: getPendingDeltaCount(q) }));
  } catch (e) {
    console.warn('[FirebaseService] Failed saving pending delta queue:', e);
  }
}

export function getPendingDeltaCount(q?: PendingDeltaQueue): number {
  const queue = q || getPendingDeltaQueue();
  return (
    Object.keys(queue.airmen).length +
    Object.keys(queue.assignments).length +
    Object.keys(queue.history).length +
    Object.keys(queue.users).length +
    Object.keys(queue.settings).length
  );
}

export function hasPendingDeltas(): boolean {
  return getPendingDeltaCount() > 0;
}

export function recordPendingDeltas(params: {
  airmen?: any[];
  assignments?: any[];
  deletedAssignments?: any[];
  history?: any[];
  users?: any[];
  settingKeys?: string[];
  canteenKeys?: string[];
  canteenMemberIds?: string[];
}) {
  const q = getPendingDeltaQueue();
  const now = new Date().toISOString();

  (params.airmen || []).forEach((a) => {
    const id = getAirmanDocId(a);
    q.airmen[id] = a?.updatedAt || now;
  });

  (params.assignments || []).forEach((a) => {
    const docId = getAssignmentDocId(a);
    q.assignments[docId] = {
      docId,
      updatedAt: a?.updatedAt || now,
      isDeleted: false,
      assignment: { ...a, updatedAt: a?.updatedAt || now },
    };
  });

  (params.deletedAssignments || []).forEach((a) => {
    const docId = getAssignmentDocId(a);
    q.assignments[docId] = {
      docId,
      updatedAt: now,
      isDeleted: true,
      assignment: { ...a, isDeleted: true, updatedAt: now },
    };
  });

  (params.history || []).forEach((h) => {
    if (h?.id) q.history[sanitizeDocId(h.id)] = h.updatedAt || h.timestamp || now;
  });

  (params.users || []).forEach((u) => {
    const id = getUserProfileDocId(u);
    q.users[id] = u?.updatedAt || now;
  });

  (params.settingKeys || []).forEach((k) => {
    if (k) q.settings[k] = now;
  });

  (params.canteenKeys || []).forEach((k) => {
    if (k) q.canteenData[k] = now;
  });

  (params.canteenMemberIds || []).forEach((id) => {
    if (id) q.canteenMembers[sanitizeDocId(id)] = now;
  });

  savePendingDeltaQueue(q);
}

export function clearPendingDeltas(partial?: {
  airmenIds?: string[];
  assignmentDocIds?: string[];
  historyIds?: string[];
  userIds?: string[];
  settingKeys?: string[];
  canteenKeys?: string[];
  canteenMemberIds?: string[];
  clearAll?: boolean;
}) {
  if (!partial || partial.clearAll) {
    savePendingDeltaQueue(emptyQueue());
    return;
  }
  const q = getPendingDeltaQueue();
  (partial.airmenIds || []).forEach((id) => delete q.airmen[id]);
  (partial.assignmentDocIds || []).forEach((id) => delete q.assignments[id]);
  (partial.historyIds || []).forEach((id) => delete q.history[id]);
  (partial.userIds || []).forEach((id) => delete q.users[id]);
  (partial.settingKeys || []).forEach((k) => delete q.settings[k]);
  (partial.canteenKeys || []).forEach((k) => delete q.canteenData[k]);
  (partial.canteenMemberIds || []).forEach((id) => delete q.canteenMembers[id]);
  savePendingDeltaQueue(q);
}

// -------------------- Health & Quota Probe --------------------

export async function probeFirebaseConnectionAndQuota(forceServerCheck = false): Promise<{
  ok: boolean;
  quotaExceeded: boolean;
  errorMsg?: string;
}> {
  if (IS_AI_STUDIO_PRACTICE_MODE || !isFirebaseConfigured || !dbLite) {
    return { ok: false, quotaExceeded: false, errorMsg: 'AI Studio Practice Mode (Cloud sync disabled)' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, quotaExceeded: false, errorMsg: 'Device is offline' };
  }
  if (!forceServerCheck && isFirestoreQuotaExceeded()) {
    return { ok: false, quotaExceeded: true, errorMsg: 'Firestore daily quota exceeded' };
  }
  try {
    recordFirestoreQuotaUsage({
      type: 'READ',
      count: 1,
      reason: 'Connection & Quota Health Probe',
      collection: 'test',
    });
    await withFirestoreTimeout(getDoc(doc(dbLite, 'test', 'connection')), 6000, 'probe:connection');
    if (isFirestoreQuotaExceeded()) {
      setFirestoreQuotaExceeded(false);
    }
    return { ok: true, quotaExceeded: false };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, msg);
      return { ok: false, quotaExceeded: true, errorMsg: msg };
    }
    try {
      const restOk = await probeFirestoreRestHealth(5000);
      if (restOk.ok) {
        if (isFirestoreQuotaExceeded()) {
          setFirestoreQuotaExceeded(false);
        }
        return { ok: true, quotaExceeded: false };
      }
      if (restOk.quotaExceeded) {
        setFirestoreQuotaExceeded(true, restOk.errorMsg || msg);
        return { ok: false, quotaExceeded: true, errorMsg: restOk.errorMsg || msg };
      }
    } catch {}
    return { ok: false, quotaExceeded: false, errorMsg: msg };
  }
}

export async function checkFirebaseHealth(): Promise<boolean> {
  const res = await probeFirebaseConnectionAndQuota(false);
  return res.ok;
}

// -------------------- Chunked Batch & Resilient Query Helpers --------------------

function withFirestoreTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Firestore ${label} timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function isPermissionDeniedError(err: unknown): boolean {
  if (!err) return false;
  const code = String((err as any)?.code || '').toLowerCase();
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    code.includes('permission-denied') ||
    msg.includes('missing or insufficient permissions') ||
    msg.includes('permission_denied') ||
    msg.includes('permission denied')
  );
}

function decodeFirestoreRestValue(val: any): any {
  if (!val || typeof val !== 'object') return undefined;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('integerValue' in val) {
    const n = Number(val.integerValue);
    return Number.isNaN(n) ? val.integerValue : n;
  }
  if ('doubleValue' in val) {
    const n = Number(val.doubleValue);
    return Number.isNaN(n) ? val.doubleValue : n;
  }
  if ('stringValue' in val) return String(val.stringValue);
  if ('timestampValue' in val) return String(val.timestampValue);
  if ('bytesValue' in val) return String(val.bytesValue);
  if ('referenceValue' in val) return String(val.referenceValue);
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('arrayValue' in val) {
    const values = val.arrayValue?.values;
    return Array.isArray(values) ? values.map((v: any) => decodeFirestoreRestValue(v)) : [];
  }
  if ('mapValue' in val) {
    return decodeFirestoreRestFields(val.mapValue?.fields);
  }
  return undefined;
}

function decodeFirestoreRestFields(fields?: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [key, rawVal] of Object.entries(fields)) {
    const decoded = decodeFirestoreRestValue(rawVal);
    if (decoded !== undefined) {
      out[key] = decoded;
    }
  }
  return out;
}

async function getOptionalAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    if (auth?.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

async function probeFirestoreRestHealth(timeoutMs = 5000): Promise<{
  ok: boolean;
  quotaExceeded: boolean;
  errorMsg?: string;
}> {
  if (IS_AI_STUDIO_PRACTICE_MODE || !isFirebaseConfigured || typeof fetch !== 'function') {
    return { ok: false, quotaExceeded: false };
  }
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(
    firebaseConfig.firestoreDatabaseId || '(default)'
  )}/documents/system_meta/sync_manifest?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = await getOptionalAuthHeaders();
    const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    if (res.ok || res.status === 404) {
      return { ok: true, quotaExceeded: false };
    }
    const text = await res.text().catch(() => '');
    if (res.status === 429 || text.toLowerCase().includes('resource_exhausted') || text.toLowerCase().includes('quota')) {
      return { ok: false, quotaExceeded: true, errorMsg: text || `HTTP ${res.status}` };
    }
    return { ok: false, quotaExceeded: false, errorMsg: text || `HTTP ${res.status}` };
  } finally {
    clearTimeout(timer);
  }
}

async function runQueryRestFallback(
  collectionId: string,
  sinceIso?: string,
  timeoutMs = 15000
): Promise<any[]> {
  if (IS_AI_STUDIO_PRACTICE_MODE || !isFirebaseConfigured || typeof fetch !== 'function') {
    return [];
  }
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(
    firebaseConfig.firestoreDatabaseId || '(default)'
  )}/documents:runQuery?key=${encodeURIComponent(firebaseConfig.apiKey)}`;

  const structuredQuery: Record<string, any> = {
    from: [{ collectionId }],
  };
  if (sinceIso) {
    structuredQuery.where = {
      fieldFilter: {
        field: { fieldPath: 'updatedAt' },
        op: 'GREATER_THAN',
        value: { stringValue: sinceIso },
      },
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = await getOptionalAuthHeaders();
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ structuredQuery }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      if (res.status === 429 || isQuotaExceededError(errText)) {
        setFirestoreQuotaExceeded(true, errText);
        throw new Error(errText);
      }
      if (res.status === 403 || isPermissionDeniedError(errText)) {
        handleFirestoreError(new Error('Missing or insufficient permissions'), OperationType.LIST, collectionId);
      }
      throw new Error(`Firestore REST list:${collectionId} failed (${res.status}): ${errText.slice(0, 200)}`);
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) {
      recordFirestoreQuotaUsage({
        type: 'READ',
        count: 1,
        reason: `REST Query (${collectionId})`,
        collection: collectionId,
      });
      return [];
    }
    const list: any[] = [];
    for (const row of rows) {
      if (row && row.document && row.document.fields) {
        const decoded = decodeFirestoreRestFields(row.document.fields);
        const docName = String(row.document.name || '');
        const lastSlash = docName.lastIndexOf('/');
        if (lastSlash >= 0 && lastSlash < docName.length - 1) {
          decoded.__firestoreDocId = docName.slice(lastSlash + 1);
        }
        list.push(decoded);
      }
    }
    recordFirestoreQuotaUsage({
      type: 'READ',
      count: Math.max(1, list.length),
      reason: sinceIso ? `REST Incremental Sync (${collectionId})` : `REST Collection Sync (${collectionId})`,
      collection: collectionId,
    });
    return list;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Firestore REST list:${collectionId} timeout after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function filterAndUnscopeOfficeDocs(docs: Array<{ docId?: string; data: any }>): any[] {
  const prefix = getOfficeFirestoreDocPrefix();
  const altPrefix = prefix ? prefix.replace(/__$/, '_') : '';
  const isDefault = isDefault155UasuOffice();
  const out: any[] = [];

  for (const item of docs) {
    const d = item.data;
    if (!d || typeof d !== 'object') continue;
    const rawDocId = String(item.docId || d.__firestoreDocId || d.id || d.settingKey || '');

    if (isDefault) {
      if (rawDocId.startsWith('off_') || String(d.id || '').startsWith('off_') || String(d.settingKey || '').startsWith('off_')) {
        continue;
      }
      const cleaned = { ...d };
      delete cleaned.__firestoreDocId;
      out.push(cleaned);
    } else {
      const matchesDocId =
        rawDocId.startsWith(prefix) || (altPrefix && rawDocId.startsWith(altPrefix));
      const dataIdStr = String(d.id || '');
      const matchesDataId =
        dataIdStr.startsWith(prefix) || (altPrefix && dataIdStr.startsWith(altPrefix));
      const settingKeyStr = String(d.settingKey || '');
      const matchesSettingKey =
        settingKeyStr.startsWith(prefix) || (altPrefix && settingKeyStr.startsWith(altPrefix));
      if (!matchesDocId && !matchesDataId && !matchesSettingKey) {
        continue;
      }
      const cloned = { ...d };
      delete cloned.__firestoreDocId;
      if (typeof cloned.id === 'string') {
        if (cloned.id.startsWith(prefix)) {
          cloned.id = cloned.id.slice(prefix.length);
        } else if (altPrefix && cloned.id.startsWith(altPrefix)) {
          cloned.id = cloned.id.slice(altPrefix.length);
        }
      }
      if (typeof cloned.settingKey === 'string') {
        if (cloned.settingKey.startsWith(prefix)) {
          cloned.settingKey = cloned.settingKey.slice(prefix.length);
        } else if (altPrefix && cloned.settingKey.startsWith(altPrefix)) {
          cloned.settingKey = cloned.settingKey.slice(altPrefix.length);
        }
      }
      out.push(cloned);
    }
  }
  return out;
}

function scopeWriteOpsForActiveOffice(
  ops: Array<{ path: string; docId: string; data: Record<string, any> }>
): Array<{ path: string; docId: string; data: Record<string, any> }> {
  const prefix = getOfficeFirestoreDocPrefix();
  if (!prefix) return ops;
  const altPrefix = prefix.replace(/__$/, '_');

  return ops.map((op) => {
    let baseDocId = op.docId;
    if (baseDocId.startsWith(prefix)) {
      baseDocId = baseDocId.slice(prefix.length);
    } else if (altPrefix && baseDocId.startsWith(altPrefix)) {
      baseDocId = baseDocId.slice(altPrefix.length);
    }
    const cleanBaseId = sanitizeDocId(baseDocId);
    const scopedDocId = `${prefix}${cleanBaseId}`.slice(0, 120);
    const scopedData: Record<string, any> = { ...op.data };
    if (typeof scopedData.id === 'string') {
      scopedData.id = clampStr(scopedDocId, 128) || scopedDocId;
    }
    if (typeof scopedData.settingKey === 'string') {
      let baseSettingKey = scopedData.settingKey;
      if (baseSettingKey.startsWith(prefix)) {
        baseSettingKey = baseSettingKey.slice(prefix.length);
      } else if (altPrefix && baseSettingKey.startsWith(altPrefix)) {
        baseSettingKey = baseSettingKey.slice(altPrefix.length);
      }
      scopedData.settingKey = clampStr(`${prefix}${baseSettingKey}`, 200) || scopedDocId;
    }
    return {
      path: op.path,
      docId: scopedDocId,
      data: scopedData,
    };
  });
}

async function queryCollectionDocs(
  collectionId: string,
  sinceIso?: string,
  sdkTimeoutMs = 10000,
  restTimeoutMs = 15000
): Promise<any[]> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Device offline while querying ${collectionId}`);
  }
  try {
    const colRef = collection(dbLite, collectionId);
    const q = sinceIso ? query(colRef, where('updatedAt', '>', sinceIso)) : colRef;
    const snap = await withFirestoreTimeout(getDocs(q), sdkTimeoutMs, `list:${collectionId}`);
    const list: Array<{ docId?: string; data: any }> = [];
    snap.forEach((docSnap) => {
      list.push({ docId: docSnap.id, data: docSnap.data() });
    });
    recordFirestoreQuotaUsage({
      type: 'READ',
      count: Math.max(1, list.length),
      reason: sinceIso ? `Incremental Sync (${collectionId})` : `Collection Sync (${collectionId})`,
      collection: collectionId,
    });
    return filterAndUnscopeOfficeDocs(list);
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, err?.message);
      throw err;
    }
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.LIST, collectionId);
    }
    console.warn(`[FirebaseService] SDK list:${collectionId} fell back to REST (${err?.message || err})`);
    const restRows = await runQueryRestFallback(collectionId, sinceIso, restTimeoutMs);
    return filterAndUnscopeOfficeDocs(restRows.map((d) => ({ docId: d?.id || d?.settingKey, data: d })));
  }
}

async function commitSetOps(
  rawOps: Array<{ path: string; docId: string; data: Record<string, any> }>,
  collectionLabel: string
): Promise<number> {
  const ops = scopeWriteOpsForActiveOffice(rawOps);
  if (!isFirebaseConfigured || !dbLite || ops.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;

  let written = 0;
  const CHUNK_SIZE = 350;
  const chunks: Array<Array<{ path: string; docId: string; data: Record<string, any> }>> = [];
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    chunks.push(ops.slice(i, i + CHUNK_SIZE));
  }

  const processChunk = async (chunk: Array<{ path: string; docId: string; data: Record<string, any> }>) => {
    if (isFirestoreQuotaExceeded()) return;
    try {
      const batch = writeBatch(dbLite);
      for (const op of chunk) {
        batch.set(doc(dbLite, op.path, op.docId), op.data, { merge: true });
      }
      await withFirestoreTimeout(batch.commit(), 15000, `batch:${collectionLabel}`);
      recordFirestoreQuotaUsage({
        type: 'WRITE',
        count: chunk.length,
        reason: `Batch Write (${collectionLabel})`,
        collection: collectionLabel,
      });
      written += chunk.length;
    } catch (err: any) {
      if (isQuotaExceededError(err)) {
        setFirestoreQuotaExceeded(true, err?.message || `Quota exceeded writing ${collectionLabel}`);
        throw err;
      }
      const MINI_SIZE = 20;
      let loggedOnce = false;
      for (let j = 0; j < chunk.length; j += MINI_SIZE) {
        if (isFirestoreQuotaExceeded()) break;
        const mini = chunk.slice(j, j + MINI_SIZE);
        const results = await Promise.allSettled(
          mini.map((op) =>
            withFirestoreTimeout(
              setDoc(doc(dbLite, op.path, op.docId), op.data, { merge: true }),
              8000,
              `setDoc:${op.path}/${op.docId}`
            )
          )
        );
        for (let k = 0; k < results.length; k++) {
          const r = results[k];
          if (r.status === 'fulfilled') {
            recordFirestoreQuotaUsage({
              type: 'WRITE',
              count: 1,
              reason: `Doc Write (${collectionLabel})`,
              collection: mini[k].path,
            });
            written++;
          } else {
            const singleErr: any = r.reason;
            if (isQuotaExceededError(singleErr)) {
              setFirestoreQuotaExceeded(true, singleErr?.message);
              throw singleErr;
            }
            if (!loggedOnce) {
              loggedOnce = true;
              console.warn(
                `[FirebaseService] Failed writing ${mini[k].path}/${mini[k].docId}:`,
                singleErr?.message || singleErr
              );
            }
          }
        }
      }
    }
  };

  // Run up to 3 batches in parallel so bulk writes complete 3x faster
  const PARALLEL_BATCHES = 3;
  for (let b = 0; b < chunks.length; b += PARALLEL_BATCHES) {
    if (isFirestoreQuotaExceeded()) break;
    await Promise.all(chunks.slice(b, b + PARALLEL_BATCHES).map(processChunk));
  }

  return written;
}

function getSyncManifestDocId(): string {
  const prefix = getOfficeFirestoreDocPrefix();
  return prefix ? sanitizeDocId(`${prefix}sync_manifest`) : 'sync_manifest';
}

let lastManifestFetchAt = 0;
let lastManifestFetchDocId = '';
let cachedManifestResult: SyncManifest | null = null;
let inFlightManifestPromise: Promise<SyncManifest | null> | null = null;

export async function fetchSyncManifestFromFirebase(force: boolean = false): Promise<SyncManifest | null> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return null;
  const manifestDocId = getSyncManifestDocId();
  const now = Date.now();
  if (
    !force &&
    manifestDocId === lastManifestFetchDocId &&
    now - lastManifestFetchAt < 60000 &&
    cachedManifestResult
  ) {
    return cachedManifestResult;
  }
  if (inFlightManifestPromise && manifestDocId === lastManifestFetchDocId) {
    return inFlightManifestPromise;
  }

  lastManifestFetchDocId = manifestDocId;
  inFlightManifestPromise = (async () => {
    try {
      recordFirestoreQuotaUsage({
        type: 'READ',
        count: 1,
        reason: 'Poll Sync Manifest Heartbeat',
        collection: 'system_meta',
      });
      const snap = await withFirestoreTimeout(
        getDoc(doc(dbLite, 'system_meta', manifestDocId)),
        6000,
        'get:sync_manifest'
      );
      lastManifestFetchAt = Date.now();
      if (!snap.exists()) {
        cachedManifestResult = null;
        return null;
      }
      cachedManifestResult = snap.data() as SyncManifest;
      return cachedManifestResult;
    } catch (err: any) {
      if (isQuotaExceededError(err)) {
        setFirestoreQuotaExceeded(true, err?.message);
        return null;
      }
      // REST fallback for sync_manifest if SDK read timed out
      if (typeof fetch === 'function') {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
            firebaseConfig.projectId
          )}/databases/${encodeURIComponent(
            firebaseConfig.firestoreDatabaseId || '(default)'
          )}/documents/system_meta/${encodeURIComponent(manifestDocId)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
          const headers = await getOptionalAuthHeaders();
          const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
          if (res.ok) {
            const docJson = await res.json();
            if (docJson?.fields) {
              lastManifestFetchAt = Date.now();
              cachedManifestResult = decodeFirestoreRestFields(docJson.fields) as SyncManifest;
              return cachedManifestResult;
            }
          } else {
            const errText = await res.text().catch(() => `HTTP ${res.status}`);
            if (res.status === 429 || isQuotaExceededError(errText)) {
              setFirestoreQuotaExceeded(true, errText);
              return null;
            }
          }
        } catch {} finally {
          clearTimeout(timer);
        }
      }
      return cachedManifestResult;
    }
  })().finally(() => {
    inFlightManifestPromise = null;
  });

  return inFlightManifestPromise;
}

// -------------------- Sync Manifest --------------------

function getCurrentBdNo(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.sessionStorage.getItem('baf_user_session');
    if (raw) {
      const parsed = JSON.parse(raw);
      return String(parsed?.bdNo || '').slice(0, 64);
    }
  } catch {}
  return '';
}

export function extractManifestDataHash(manifest?: SyncManifest | null): string {
  if (!manifest) return '';
  if (typeof manifest.dataHash === 'string' && manifest.dataHash.trim()) {
    return manifest.dataHash.trim();
  }
  const lr = String(manifest.lastReason || '');
  const m = lr.match(/\|h=([a-zA-Z0-9_-]+)/);
  return m && m[1] ? m[1] : '';
}

export function extractManifestChangedMonths(manifest?: SyncManifest | null): string[] {
  if (!manifest) return [];
  const lr = String(manifest.lastReason || '');
  const m = lr.match(/\|m=([0-9,-]+)/);
  if (!m || !m[1]) return [];
  const set = new Set<string>();
  m[1].split(',').forEach((part) => {
    const clean = part.trim();
    if (/^\d{4}-\d{2}$/.test(clean)) set.add(clean);
  });
  return Array.from(set);
}

export async function publishSyncManifest(
  changedCollections: string[],
  reason: string = 'delta_sync',
  extraMeta?: { dataHash?: string; airmenCount?: number; assignmentsCount?: number; changedMonths?: string[] }
): Promise<void> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  const manifestDocId = getSyncManifestDocId();
  const nowIso = new Date().toISOString();
  const safeCollections = changedCollections
    .filter((c) => typeof c === 'string' && c.trim().length > 0)
    .slice(0, 20);
  const effectiveHash =
    extraMeta?.dataHash || extractManifestDataHash(cachedManifestResult) || '';
  const baseReason =
    String(reason || 'delta_sync')
      .split('|h=')[0]
      .split('|m=')[0]
      .slice(0, 75) || 'delta_sync';
  const cleanMonths = Array.from(
    new Set(
      (extraMeta?.changedMonths || [])
        .map((m) => String(m || '').trim())
        .filter((m) => /^\d{4}-\d{2}$/.test(m))
    )
  ).slice(0, 4);
  const hashSuffix = effectiveHash ? `|h=${effectiveHash}` : '';
  const monthSuffix = cleanMonths.length > 0 ? `|m=${cleanMonths.join(',')}` : '';
  const encodedReason = clampStr(`${baseReason}${hashSuffix}${monthSuffix}`, 200) || 'delta_sync';

  const coreManifest: SyncManifest = {
    id: manifestDocId,
    revision: Date.now(),
    updatedAt: nowIso,
    updatedBySessionId: CLIENT_SESSION_ID.slice(0, 128),
    updatedByBdNo: getCurrentBdNo() || 'system',
    lastReason: encodedReason,
    changedCollections: safeCollections,
  };

  const nextManifest: SyncManifest = {
    ...coreManifest,
    ...(effectiveHash ? { dataHash: clampStr(effectiveHash, 128) } : {}),
    ...(typeof extraMeta?.airmenCount === 'number' ? { airmenCount: extraMeta.airmenCount } : {}),
    ...(typeof extraMeta?.assignmentsCount === 'number' ? { assignmentsCount: extraMeta.assignmentsCount } : {}),
  };

  try {
    recordFirestoreQuotaUsage({
      type: 'WRITE',
      count: 1,
      reason: `Publish Sync Manifest (${reason || 'update'})`,
      collection: 'system_meta',
    });
    await withFirestoreTimeout(
      setDoc(doc(dbLite, 'system_meta', manifestDocId), nextManifest, { merge: true }),
      8000,
      'set:sync_manifest'
    );
    lastManifestFetchAt = Date.now();
    lastManifestFetchDocId = manifestDocId;
    cachedManifestResult = nextManifest;
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, err?.message);
      return;
    }
    try {
      recordFirestoreQuotaUsage({
        type: 'WRITE',
        count: 1,
        reason: 'Publish Sync Manifest (Fallback)',
        collection: 'system_meta',
      });
      await withFirestoreTimeout(
        setDoc(doc(dbLite, 'system_meta', manifestDocId), coreManifest, { merge: true }),
        8000,
        'set:sync_manifest_core'
      );
      lastManifestFetchAt = Date.now();
      lastManifestFetchDocId = manifestDocId;
      cachedManifestResult = nextManifest;
    } catch (fallbackErr: any) {
      if (isQuotaExceededError(fallbackErr)) {
        setFirestoreQuotaExceeded(true, fallbackErr?.message);
      } else {
        console.warn('[FirebaseService] Manifest update notice:', fallbackErr?.message || err?.message);
      }
    }
  }
}

const manifestListeners = new Set<(manifest: SyncManifest) => void>();
let sharedManifestTimer: ReturnType<typeof setInterval> | null = null;
let sharedManifestOnlineBound = false;
let latestManifestSnapshot: SyncManifest | null = null;

async function pollSharedManifestOnce(force: boolean = false) {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  if (manifestListeners.size === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

  try {
    const data = await fetchSyncManifestFromFirebase(force);
    if (data && data.updatedAt) {
      const prevHash = extractManifestDataHash(latestManifestSnapshot);
      const nextHash = extractManifestDataHash(data);
      if (
        !latestManifestSnapshot ||
        latestManifestSnapshot.revision !== data.revision ||
        latestManifestSnapshot.updatedAt !== data.updatedAt ||
        (nextHash && prevHash !== nextHash)
      ) {
        latestManifestSnapshot = data;
        manifestListeners.forEach((cb) => {
          try {
            cb(data);
          } catch {}
        });
      }
    }
  } catch {}
}

function stopSharedManifestListener() {
  if (sharedManifestTimer) {
    clearInterval(sharedManifestTimer);
    sharedManifestTimer = null;
  }
}

function ensureSharedManifestListener() {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) {
    stopSharedManifestListener();
    return;
  }
  if (manifestListeners.size === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (sharedManifestTimer) return;

  void pollSharedManifestOnce(false);
  sharedManifestTimer = setInterval(() => {
    if (isFirestoreQuotaExceeded()) {
      stopSharedManifestListener();
      return;
    }
    void pollSharedManifestOnce(true);
  }, 120 * 1000); // 2 minutes background manifest poll to conserve Firestore free-tier read quota
}

export function subscribeToSyncManifest(
  callback: (manifest: SyncManifest) => void
): () => void {
  if (!isFirebaseConfigured || !dbLite) {
    return () => {};
  }

  manifestListeners.add(callback);
  if (latestManifestSnapshot) {
    try {
      callback(latestManifestSnapshot);
    } catch {}
  }

  if (typeof window !== 'undefined' && !sharedManifestOnlineBound) {
    sharedManifestOnlineBound = true;
    window.addEventListener('online', () => {
      if (manifestListeners.size > 0 && !isFirestoreQuotaExceeded()) {
        ensureSharedManifestListener();
        void pollSharedManifestOnce(false);
      }
    });
    window.addEventListener('focus', () => {
      if (manifestListeners.size > 0 && !isFirestoreQuotaExceeded()) {
        void pollSharedManifestOnce(false);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && manifestListeners.size > 0 && !isFirestoreQuotaExceeded()) {
        void pollSharedManifestOnce(false);
      }
    });
    window.addEventListener('baf_firebase_quota_status', (e: any) => {
      if (e?.detail?.exceeded) {
        stopSharedManifestListener();
      } else if (manifestListeners.size > 0) {
        ensureSharedManifestListener();
      }
    });
  }

  if (!isFirestoreQuotaExceeded()) {
    ensureSharedManifestListener();
  }

  return () => {
    manifestListeners.delete(callback);
    if (manifestListeners.size === 0) {
      stopSharedManifestListener();
    }
  };
}

// -------------------- 1. AIRMEN --------------------

function formatAirmanForFirestore(a: any, nowIso: string): { docId: string; data: Record<string, any> } {
  const docId = getAirmanDocId(a);
  const cleanBd = clampStr(a?.bdNo || a?.id || docId, 64) || docId;
  const payload: Record<string, any> = {
    id: clampStr(a?.id || docId, 128) || docId,
    bdNo: cleanBd,
    name: clampStr(a?.name || a?.fullName || 'Airman', 200) || 'Airman',
    updatedAt: toIsoString(a?.updatedAt || nowIso),
  };

  const optStrFields: Array<[string, any, number]> = [
    ['rank', a?.rank, 64],
    ['fullName', a?.fullName, 250],
    ['flightName', a?.flightName, 64],
    ['trade', a?.trade, 128],
    ['mobileNo', a?.mobileNo, 64],
    ['bloodGroup', a?.bloodGroup, 32],
    ['addressBlock', a?.addressBlock, 500],
    ['permanentAddress', a?.permanentAddress, 500],
    ['dateJoined', a?.dateJoined, 64],
    ['dateLeft', a?.dateLeft, 64],
    ['leaveReason', a?.leaveReason, 500],
    ['remarks', a?.remarks, 500],
    ['code', a?.code, 64],
    ['email', a?.email, 200],
  ];
  for (const [k, v, max] of optStrFields) {
    if (v !== undefined && v !== null) {
      const s = clampStr(v, max);
      if (s !== undefined) payload[k] = s;
    }
  }
  if (a?.seniority !== undefined && a?.seniority !== null && !isNaN(Number(a.seniority))) {
    payload.seniority = Number(a.seniority);
  }
  if (a?.serNo !== undefined && a?.serNo !== null && !isNaN(Number(a.serNo))) {
    payload.serNo = Number(a.serNo);
  }
  if (a?.active !== undefined) {
    payload.active = Boolean(a.active);
  }

  return { docId, data: payload };
}

export async function pushAirmenToFirebase(airmen: any[]): Promise<number> {
  if (!isFirebaseConfigured || !db || !Array.isArray(airmen) || airmen.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;
  const nowIso = new Date().toISOString();
  const ops = airmen.map((a) => {
    const formatted = formatAirmanForFirestore(a, nowIso);
    return { path: 'airmen', ...formatted };
  });
  return commitSetOps(ops, 'airmen');
}

export async function fetchAirmenFromFirebase(sinceIso?: string): Promise<any[]> {
  return queryCollectionDocs('airmen', sinceIso, 10000, 12000);
}

export async function deleteAirmanFromFirebase(airmanOrList: any | any[]): Promise<void> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  const list = (Array.isArray(airmanOrList) ? airmanOrList : [airmanOrList]).filter(Boolean);
  if (list.length === 0) return;
  const nowIso = new Date().toISOString();
  const tombstoneOps = list.map((a) => {
    const formatted = formatAirmanForFirestore({ ...a, remarks: '__DELETED__', active: false, updatedAt: nowIso }, nowIso);
    return { path: 'airmen', ...formatted };
  });
  try {
    await commitSetOps(tombstoneOps, 'airmen');
  } catch (err) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, (err as any)?.message);
      return;
    }
  }
  if (isFirestoreQuotaExceeded()) return;
  const scopedOps = scopeWriteOpsForActiveOffice(tombstoneOps);
  if (scopedOps.length > 0) {
    recordFirestoreQuotaUsage({
      type: 'DELETE',
      count: scopedOps.length,
      reason: 'Delete Airman Documents',
      collection: 'airmen',
    });
  }
  const delResults = await Promise.allSettled(
    scopedOps.map((op) => deleteDoc(doc(dbLite, op.path, op.docId)))
  );
  for (const r of delResults) {
    if (r.status === 'rejected' && isQuotaExceededError(r.reason)) {
      setFirestoreQuotaExceeded(true, (r.reason as any)?.message);
      break;
    }
  }
}

// -------------------- 2. DUTY ASSIGNMENTS --------------------

function formatDutyAssignmentForFirestore(
  a: any,
  nowIso: string,
  forceDelete?: boolean
): { docId: string; data: Record<string, any> } {
  const docId = getAssignmentDocId(a);
  const updatedAt = toIsoString(forceDelete ? nowIso : a?.updatedAt || nowIso);
  const rawDate = String(a?.date || nowIso.slice(0, 10)).trim();
  const safeDate = rawDate.length >= 4 ? (rawDate.length > 32 ? rawDate.slice(0, 32) : rawDate) : nowIso.slice(0, 10);
  const rawCode = String(a?.dutyCode || 'ON_PARADE').trim() || 'ON_PARADE';
  const safeCode = rawCode.length > 64 ? rawCode.slice(0, 64) : rawCode;
  const payload: Record<string, any> = {
    id: clampStr(docId, 128) || docId,
    airmanId: clampStr(a?.airmanId || 'unknown', 128) || 'unknown',
    date: safeDate,
    dutyCode: safeCode,
    updatedAt,
  };

  const optStr: Array<[string, any, number]> = [
    ['dutyName', a?.dutyName, 200],
    ['idaShift', a?.idaShift, 32],
    ['proxyForFlight', a?.proxyForFlight, 64],
    ['disposalScope', a?.disposalScope || 'ALL', 32],
    ['notes', a?.notes, 1000],
    ['location', a?.location, 200],
    ['updatedBy', a?.updatedBy || a?.assignedBy || getCurrentBdNo() || 'user', 128],
  ];
  for (const [k, v, max] of optStr) {
    if (v !== undefined && v !== null) {
      const s = clampStr(v, max);
      if (s !== undefined) payload[k] = s;
    }
  }

  payload.isOfficial = Boolean(a?.isOfficial);
  payload.isCompleted = Boolean(a?.isCompleted);
  payload.isDeleted = Boolean(forceDelete !== undefined ? forceDelete : a?.isDeleted);

  return { docId, data: payload };
}

export async function pushDutyAssignmentsToFirebase(assignments: any[]): Promise<number> {
  if (!isFirebaseConfigured || !db || !Array.isArray(assignments) || assignments.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;
  const nowIso = new Date().toISOString();
  const ops = assignments.map((a) => {
    const formatted = formatDutyAssignmentForFirestore(a, nowIso, Boolean(a?.isDeleted));
    return { path: 'duty_assignments', ...formatted };
  });
  return commitSetOps(ops, 'duty_assignments');
}

export async function softDeleteDutyAssignmentsInFirebase(assignments: any[]): Promise<number> {
  if (!isFirebaseConfigured || !db || !Array.isArray(assignments) || assignments.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;
  const nowIso = new Date().toISOString();
  const ops = assignments.map((a) => {
    const formatted = formatDutyAssignmentForFirestore(a, nowIso, true);
    return { path: 'duty_assignments', ...formatted };
  });
  return commitSetOps(ops, 'duty_assignments');
}

export async function fetchDutyAssignmentsFromFirebase(sinceIso?: string): Promise<any[]> {
  const docs = await queryCollectionDocs('duty_assignments', sinceIso, 20000, 25000);
  return docs.map((d) => (isCorruptedAssignmentRecord(d) ? { ...d, isDeleted: true } : d));
}

// -------------------- 3. PARADE STATES / ACTIVITY HISTORY --------------------

function formatParadeStateForFirestore(h: any, nowIso: string): { docId: string; data: Record<string, any> } {
  const docId = sanitizeDocId(h?.id || `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const timestamp = toIsoString(h?.timestamp || h?.created_at || h?.date || nowIso);
  const payload: Record<string, any> = {
    id: clampStr(h?.id || docId, 128) || docId,
    timestamp,
    updatedAt: toIsoString(h?.updatedAt || timestamp),
  };

  const optStr: Array<[string, any, number]> = [
    ['actionType', h?.actionType || h?.type, 64],
    ['airmanId', h?.airmanId, 128],
    ['airmanName', h?.airmanName, 200],
    ['airmanRank', h?.airmanRank, 64],
    ['airmanTrade', h?.airmanTrade, 128],
    ['dutyCode', h?.dutyCode, 64],
    ['idaShift', h?.idaShift, 32],
    ['fromDate', h?.fromDate || h?.date, 32],
    ['toDate', h?.toDate || h?.fromDate || h?.date, 32],
    ['notes', h?.notes, 1000],
    ['description', h?.description, 2000],
  ];
  for (const [k, v, max] of optStr) {
    if (v !== undefined && v !== null) {
      const s = clampStr(v, max);
      if (s !== undefined) payload[k] = s;
    }
  }
  return { docId, data: payload };
}

export async function pushParadeStatesToFirebase(states: any[]): Promise<number> {
  if (!isFirebaseConfigured || !db || !Array.isArray(states) || states.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;
  const nowIso = new Date().toISOString();
  const ops = states.map((h) => {
    const formatted = formatParadeStateForFirestore(h, nowIso);
    return { path: 'parade_states', ...formatted };
  });
  return commitSetOps(ops, 'parade_states');
}

export async function fetchParadeStatesFromFirebase(sinceIso?: string): Promise<any[]> {
  return queryCollectionDocs('parade_states', sinceIso, 10000, 12000);
}

// -------------------- 4. USER PROFILES --------------------

function formatUserProfileForFirestore(u: any, nowIso: string): { docId: string; data: Record<string, any> } {
  const cleanBd = clampStr(String(u?.userId || u?.bdNo || '').replace(/^BD\/?/i, '').trim() || 'unknown', 64) || 'unknown';
  const docId = getUserProfileDocId(u);
  const payload: Record<string, any> = {
    id: clampStr(u?.id || docId, 128) || docId,
    bdNo: cleanBd,
    updatedAt: toIsoString(u?.updatedAt || nowIso),
  };

  const optStr: Array<[string, any, number]> = [
    ['userId', u?.userId || cleanBd, 64],
    ['airmanId', u?.airmanId, 128],
    ['rank', u?.rank, 64],
    ['name', u?.name, 200],
    ['mobileNo', u?.mobileNo, 64],
    ['flightName', u?.flightName, 64],
    ['trade', u?.trade, 128],
    ['role', u?.role, 32],
    ['status', u?.status, 32],
    ['pin', u?.pin || u?.password, 128],
    ['password', u?.password || u?.pin, 128],
    ['adminPass', u?.adminPass, 128],
    ['ownerPass', u?.ownerPass, 128],
    ['detailOrder', u?.detailOrder, 128],
    ['detailedAt', u?.detailedAt, 64],
    ['detailedBy', u?.detailedBy, 128],
    ['remarks', u?.remarks, 500],
  ];
  for (const [k, v, max] of optStr) {
    if (v !== undefined && v !== null) {
      const s = clampStr(v, max);
      if (s !== undefined) payload[k] = s;
    }
  }
  if (u?.isProtected !== undefined) {
    payload.isProtected = Boolean(u.isProtected);
  }
  return { docId, data: payload };
}

export async function pushUserProfilesToFirebase(users: any[]): Promise<number> {
  if (!isFirebaseConfigured || !db || !Array.isArray(users) || users.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;
  const nowIso = new Date().toISOString();
  const validUsers = users.filter((u) => u && u.bdNo && String(u.bdNo).toLowerCase() !== 'deleted_admin');
  if (validUsers.length === 0) return 0;
  const ops = validUsers.map((u) => {
    const formatted = formatUserProfileForFirestore(u, nowIso);
    return { path: 'user_profiles', ...formatted };
  });
  return commitSetOps(ops, 'user_profiles');
}

export async function fetchUserProfilesFromFirebase(sinceIso?: string, timeoutMs = 10000): Promise<any[]> {
  return queryCollectionDocs('user_profiles', sinceIso, timeoutMs, Math.max(timeoutMs, 10000));
}

export async function deleteUserProfileFromFirebase(userOrList: any | any[]): Promise<void> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  const list = (Array.isArray(userOrList) ? userOrList : [userOrList]).filter(Boolean);
  if (list.length === 0) return;
  const nowIso = new Date().toISOString();
  const tombstoneOps = list.map((u) => {
    const formatted = formatUserProfileForFirestore({ ...u, remarks: '__DELETED__', status: 'DELETED', updatedAt: nowIso }, nowIso);
    return { path: 'user_profiles', ...formatted };
  });
  try {
    await commitSetOps(tombstoneOps, 'user_profiles');
  } catch (err) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, (err as any)?.message);
      return;
    }
  }
  if (isFirestoreQuotaExceeded()) return;
  const scopedOps = scopeWriteOpsForActiveOffice(tombstoneOps);
  if (scopedOps.length > 0) {
    recordFirestoreQuotaUsage({
      type: 'DELETE',
      count: scopedOps.length,
      reason: 'Delete User Profile Documents',
      collection: 'user_profiles',
    });
  }
  const delResults = await Promise.allSettled(
    scopedOps.map((op) => deleteDoc(doc(dbLite, op.path, op.docId)))
  );
  for (const r of delResults) {
    if (r.status === 'rejected' && isQuotaExceededError(r.reason)) {
      setFirestoreQuotaExceeded(true, (r.reason as any)?.message);
      break;
    }
  }
}

// -------------------- 5. APP SETTINGS --------------------

export interface AppSettingItemInput {
  settingKey: string;
  value: any;
  updatedAt?: string;
  updatedBy?: string;
}

export async function pushAppSettingsToFirebase(settings: AppSettingItemInput[]): Promise<number> {
  if (!isFirebaseConfigured || !db || !Array.isArray(settings) || settings.length === 0) return 0;
  if (isFirestoreQuotaExceeded()) return 0;
  const nowIso = new Date().toISOString();
  const updatedBy = getCurrentBdNo() || 'user';
  const ops = settings
    .filter((s) => s && s.settingKey)
    .map((s) => {
      const docId = sanitizeDocId(s.settingKey);
      return {
        path: 'app_settings',
        docId,
        data: {
          settingKey: clampStr(s.settingKey, 200) || docId,
          value: encodeNativeSettingValue(s.value),
          updatedAt: toIsoString(s.updatedAt || nowIso),
          updatedBy: clampStr(s.updatedBy || updatedBy, 128) || 'user',
        },
      };
    });
  return commitSetOps(ops, 'app_settings');
}

export async function fetchAppSettingsWithMetaFromFirebase(
  sinceIso?: string
): Promise<Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }>> {
  const docs = await queryCollectionDocs('app_settings', sinceIso, 10000, 12000);
  const result: Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }> = {};
  docs.forEach((d: any) => {
    if (d && d.settingKey) {
      const incomingTime = Date.parse(String(d.updatedAt || '')) || 0;
      const existing = result[d.settingKey];
      const existingTime = existing ? Date.parse(existing.updatedAt || '') || 0 : -1;
      if (!existing || incomingTime >= existingTime) {
        result[d.settingKey] = {
          valueStr: decodeNativeValueToString(d.value),
          rawValue: d.value,
          updatedAt: String(d.updatedAt || ''),
          updatedBy: d.updatedBy,
        };
      }
    }
  });
  return result;
}

export async function fetchAppSettingsFromFirebase(sinceIso?: string): Promise<Record<string, string>> {
  const withMeta = await fetchAppSettingsWithMetaFromFirebase(sinceIso);
  const out: Record<string, string> = {};
  Object.entries(withMeta).forEach(([k, info]) => {
    out[k] = info.valueStr;
  });
  return out;
}

// -------------------- 6. CANTEEN (REMOVED TO SAVE FIREBASE QUOTA) --------------------

export async function pushCanteenMembersToFirebase(_members: any[]): Promise<number> {
  return 0;
}

export async function fetchCanteenMembersFromFirebase(_sinceIso?: string, _timeoutMs = 10000): Promise<any[]> {
  return [];
}

export async function pushCanteenDataKeyToFirebase(
  _docKey: string,
  _value: any,
  _updatedAt?: string
): Promise<boolean> {
  return false;
}

export async function fetchCanteenDataFromFirebase(
  _sinceIso?: string
): Promise<Array<{ docKey: string; value: any; updatedAt: string; updatedBy?: string }>> {
  return [];
}

export async function fetchSingleCanteenDocFromFirebase(_docKey: string): Promise<any | null> {
  return null;
}

// -------------------- 8. FULL MIGRATION TO FIREBASE --------------------

export async function executeFullMigrationToFirebase(dbData?: any): Promise<FirebaseMigrationResult> {
  const result: FirebaseMigrationResult = {
    success: false,
    airmenCount: 0,
    dutyCount: 0,
    paradeCount: 0,
    usersCount: 0,
    settingsCount: 0,
    canteenMembersCount: 0,
    canteenTxsCount: 0,
    canteenExpensesCount: 0,
    errors: [],
  };

  if (!isFirebaseConfigured || !db) {
    result.errors.push('Firebase is not configured');
    return result;
  }
  if (isFirestoreQuotaExceeded()) {
    result.errors.push('Firebase daily quota exceeded');
    return result;
  }

  try {
    const data = dbData || {};
    if (Array.isArray(data.airmen) && data.airmen.length > 0) {
      result.airmenCount = await pushAirmenToFirebase(data.airmen);
    }

    const flatAssignments: any[] = [];
    if (data.assignments && typeof data.assignments === 'object') {
      Object.values(data.assignments).forEach((list: any) => {
        if (Array.isArray(list)) {
          list.forEach((a) => {
            if (a && a.airmanId && a.date && a.dutyCode) flatAssignments.push(a);
          });
        }
      });
    }
    if (flatAssignments.length > 0) {
      result.dutyCount = await pushDutyAssignmentsToFirebase(flatAssignments);
    }

    if (Array.isArray(data.activityHistory) && data.activityHistory.length > 0) {
      result.paradeCount = await pushParadeStatesToFirebase(data.activityHistory.slice(0, 300));
    }

    if (Array.isArray(data.detailedUsers) && data.detailedUsers.length > 0) {
      result.usersCount = await pushUserProfilesToFirebase(data.detailedUsers);
    }

    if (typeof window !== 'undefined') {
      // App settings (Office only)
      const isDefault = isDefault155UasuOffice();
      const officeSuffix = !isDefault
        ? getOfficeScopedStorageKey('__probe__').replace(/^__probe__/, '')
        : '';
      const settingItems: AppSettingItemInput[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const rawKey = window.localStorage.key(i);
        if (!rawKey) continue;
        if (isDefault && rawKey.includes('__office_')) continue;
        if (!isDefault && (!officeSuffix || !rawKey.endsWith(officeSuffix))) continue;
        const baseKey = !isDefault && officeSuffix ? rawKey.slice(0, -officeSuffix.length) : rawKey;
        if (
          !baseKey ||
          baseKey === 'baf_155_uasu_v2_db' ||
          baseKey === 'baf_database_v2' ||
          baseKey === PENDING_DELTA_QUEUE_KEY ||
          baseKey === 'custom_office_config' ||
          baseKey === 'baf_custom_office_firebase_config_v1'
        ) {
          continue;
        }
        if (baseKey.includes('canteen')) continue;
        if (
          baseKey.startsWith('baf_') ||
          baseKey.startsWith('savedDisposalKeys') ||
          baseKey.startsWith('parade_historical') ||
          baseKey.startsWith('flg_wg_')
        ) {
          const v = window.localStorage.getItem(baseKey);
          if (v !== null && v.length < 700000) {
            settingItems.push({ settingKey: baseKey, value: v });
          }
        }
      }
      if (settingItems.length > 0) {
        result.settingsCount = await pushAppSettingsToFirebase(settingItems);
      }
    }

    await publishSyncManifest(
      ['airmen', 'duty_assignments', 'parade_states', 'user_profiles', 'app_settings'],
      'full_migration'
    );
    result.success = true;
  } catch (err: any) {
    result.errors.push(err?.message || String(err));
  }

  return result;
}

// -------------------- 7B. BUNDLED CLOUD SYNC (99% QUOTA REDUCTION) --------------------

export const BUNDLE_INDEX_KEY = '__bundle_index_v1';
export const BUNDLE_AIRMEN_KEY = '__bundle_airmen_v1';
export const BUNDLE_USERS_KEY = '__bundle_users_v1';
export const BUNDLE_HISTORY_KEY = '__bundle_history_v1';
export const BUNDLE_SETTINGS_KEY = '__bundle_settings_v1';

export interface BundleIndex {
  version: number;
  months: string[];
  monthChunks?: Record<string, string[]>;
  overflowSettingKeys?: string[];
  rawIntegrityVerifiedV4?: boolean;
  updatedAt: string;
}

export function getMonthBundleKey(ym: string, partIdx: number = 1): string {
  const safeYm = String(ym || 'unknown').replace(/[^0-9-]/g, '_');
  return partIdx <= 1 ? `__bundle_asn_${safeYm}` : `__bundle_asn_${safeYm}_p${partIdx}`;
}

export function scopeAppSettingDocId(settingKey: string): string {
  const prefix = getOfficeFirestoreDocPrefix();
  if (!prefix) return sanitizeDocId(settingKey).slice(0, 120);
  const altPrefix = prefix.replace(/__$/, '_');
  let baseKey = String(settingKey || '');
  if (baseKey.startsWith(prefix)) {
    baseKey = baseKey.slice(prefix.length);
  } else if (altPrefix && baseKey.startsWith(altPrefix)) {
    baseKey = baseKey.slice(altPrefix.length);
  }
  const cleanBase = sanitizeDocId(baseKey);
  return `${prefix}${cleanBase}`.slice(0, 120);
}

export async function fetchSingleAppSettingDoc(settingKey: string, timeoutMs = 8000): Promise<any | null> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return null;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error(`Device offline while reading app_settings/${settingKey}`);
  }
  const scopedDocId = scopeAppSettingDocId(settingKey);
  try {
    recordFirestoreQuotaUsage({
      type: 'READ',
      count: 1,
      reason: `Fetch Bundle / Setting (${settingKey})`,
      collection: 'app_settings',
    });
    const snap = await withFirestoreTimeout(
      getDoc(doc(dbLite, 'app_settings', scopedDocId)),
      timeoutMs,
      `get:app_settings/${scopedDocId}`
    );
    return snap.exists() ? snap.data() : null;
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, err?.message);
      throw err;
    }
    if (isPermissionDeniedError(err)) {
      handleFirestoreError(err, OperationType.GET, `app_settings/${scopedDocId}`);
    }
    if (typeof fetch === 'function') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
          firebaseConfig.projectId
        )}/databases/${encodeURIComponent(
          firebaseConfig.firestoreDatabaseId || '(default)'
        )}/documents/app_settings/${encodeURIComponent(scopedDocId)}?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
        const headers = await getOptionalAuthHeaders();
        const res = await fetch(url, { method: 'GET', headers, signal: controller.signal });
        if (res.status === 404) return null;
        if (res.ok) {
          const docJson = await res.json();
          if (docJson?.fields) {
            return decodeFirestoreRestFields(docJson.fields);
          }
          return null;
        }
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        if (res.status === 429 || isQuotaExceededError(errText)) {
          setFirestoreQuotaExceeded(true, errText);
          throw new Error(errText);
        }
        if (res.status === 403 || isPermissionDeniedError(errText)) {
          handleFirestoreError(new Error('Missing or insufficient permissions'), OperationType.GET, `app_settings/${scopedDocId}`);
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw err;
  }
}

let cachedBundleIndexPrefix = '';
let cachedBundleIndexValue: BundleIndex | null = null;
let cachedBundleSettingsPrefix = '';
let cachedBundleSettingsEntries: Record<string, { value: any; updatedAt: string }> = {};

function syncBundleCachesPrefix(): string {
  const prefix = getOfficeFirestoreDocPrefix();
  if (prefix !== cachedBundleIndexPrefix) {
    cachedBundleIndexPrefix = prefix;
    cachedBundleIndexValue = null;
  }
  if (prefix !== cachedBundleSettingsPrefix) {
    cachedBundleSettingsPrefix = prefix;
    cachedBundleSettingsEntries = {};
  }
  return prefix;
}

function parseBundleObjectValue(rawVal: any): any {
  if (rawVal === undefined || rawVal === null) return null;
  if (typeof rawVal === 'string') {
    try {
      return JSON.parse(rawVal);
    } catch {
      return null;
    }
  }
  if (typeof rawVal === 'object') return rawVal;
  return null;
}

function extractItemsArrayFromBundleDoc(docData: any): any[] {
  if (!docData) return [];
  const parsed = parseBundleObjectValue(docData.value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  return [];
}

export async function fetchBundleIndexFromFirebase(): Promise<BundleIndex | null> {
  syncBundleCachesPrefix();
  const docData = await fetchSingleAppSettingDoc(BUNDLE_INDEX_KEY, 6000);
  if (!docData) return null;
  const val = parseBundleObjectValue(docData.value);
  if (!val || typeof val !== 'object' || !Array.isArray(val.months)) return null;
  const idx: BundleIndex = {
    version: Number(val.version) || 1,
    months: val.months.map((m: any) => String(m)).filter(Boolean),
    monthChunks: val.monthChunks && typeof val.monthChunks === 'object' ? val.monthChunks : {},
    overflowSettingKeys: Array.isArray(val.overflowSettingKeys)
      ? val.overflowSettingKeys.map((k: any) => String(k)).filter(Boolean)
      : [],
    rawIntegrityVerifiedV4: Boolean(val.rawIntegrityVerifiedV4),
    updatedAt: String(val.updatedAt || docData.updatedAt || ''),
  };
  cachedBundleIndexValue = idx;
  return idx;
}

function unpackSettingsBundleDoc(
  docData: any,
  out: Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }>
) {
  if (!docData) return;
  const val = parseBundleObjectValue(docData.value);
  if (!val || typeof val !== 'object') return;
  const entries = val.entries && typeof val.entries === 'object' ? val.entries : val;
  const docUpdatedAt = String(docData.updatedAt || '');
  const docUpdatedBy = docData.updatedBy;
  for (const [k, rawEntry] of Object.entries(entries)) {
    if (!k) continue;
    if (rawEntry && typeof rawEntry === 'object' && 'value' in (rawEntry as any)) {
      const entryObj = rawEntry as any;
      const entryUpdatedAt = String(entryObj.updatedAt || docUpdatedAt);
      out[k] = {
        valueStr: decodeNativeValueToString(entryObj.value),
        rawValue: entryObj.value,
        updatedAt: entryUpdatedAt,
        updatedBy: docUpdatedBy,
      };
      cachedBundleSettingsEntries[k] = { value: entryObj.value, updatedAt: entryUpdatedAt };
    } else if (rawEntry !== undefined) {
      out[k] = {
        valueStr: decodeNativeValueToString(rawEntry),
        rawValue: rawEntry,
        updatedAt: docUpdatedAt,
        updatedBy: docUpdatedBy,
      };
      cachedBundleSettingsEntries[k] = { value: rawEntry, updatedAt: docUpdatedAt };
    }
  }
}

export async function fetchSpecificBundlesFromFirebase(opts: {
  airmen?: boolean;
  users?: boolean;
  history?: boolean;
  settings?: boolean;
  months?: string[];
  index?: BundleIndex | null;
}): Promise<{
  index: BundleIndex | null;
  airmen: any[];
  assignments: any[];
  history: any[];
  users: any[];
  settingsMeta: Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }>;
  hasAirmenBundle: boolean;
  hasUsersBundle: boolean;
  hasHistoryBundle: boolean;
  hasSettingsBundle: boolean;
}> {
  syncBundleCachesPrefix();
  const index = opts.index !== undefined ? opts.index : await fetchBundleIndexFromFirebase();
  const airmenPromise = opts.airmen ? fetchSingleAppSettingDoc(BUNDLE_AIRMEN_KEY, 8000) : Promise.resolve(null);
  const usersPromise = opts.users ? fetchSingleAppSettingDoc(BUNDLE_USERS_KEY, 8000) : Promise.resolve(null);
  const historyPromise = opts.history ? fetchSingleAppSettingDoc(BUNDLE_HISTORY_KEY, 8000) : Promise.resolve(null);
  const settingsBundlePromise = opts.settings ? fetchSingleAppSettingDoc(BUNDLE_SETTINGS_KEY, 8000) : Promise.resolve(null);

  const overflowKeys = opts.settings && index?.overflowSettingKeys ? index.overflowSettingKeys : [];
  const overflowPromises = overflowKeys.map((k) => fetchSingleAppSettingDoc(k, 8000));

  const targetMonths = Array.from(new Set((opts.months || []).filter((m) => /^\d{4}-\d{2}$/.test(m))));
  const monthChunkKeys: string[] = [];
  targetMonths.forEach((ym) => {
    const chunks = index?.monthChunks?.[ym];
    if (Array.isArray(chunks) && chunks.length > 0) {
      chunks.forEach((cKey) => monthChunkKeys.push(cKey));
    } else {
      monthChunkKeys.push(getMonthBundleKey(ym, 1));
    }
  });
  const monthPromises = monthChunkKeys.map((ck) => fetchSingleAppSettingDoc(ck, 10000));

  const [airmenDoc, usersDoc, historyDoc, settingsBundleDoc, overflowDocs, monthDocs] = await Promise.all([
    airmenPromise,
    usersPromise,
    historyPromise,
    settingsBundlePromise,
    Promise.all(overflowPromises),
    Promise.all(monthPromises),
  ]);

  const airmen = extractItemsArrayFromBundleDoc(airmenDoc);
  const users = extractItemsArrayFromBundleDoc(usersDoc);
  const history = extractItemsArrayFromBundleDoc(historyDoc);
  const assignments: any[] = [];
  monthDocs.forEach((mDoc) => {
    const items = extractItemsArrayFromBundleDoc(mDoc);
    items.forEach((d) => {
      assignments.push(isCorruptedAssignmentRecord(d) ? { ...d, isDeleted: true } : d);
    });
  });

  const settingsMeta: Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }> = {};
  if (opts.settings) {
    unpackSettingsBundleDoc(settingsBundleDoc, settingsMeta);
    overflowDocs.forEach((d: any) => {
      if (!d) return;
      const rawKey = stripActiveOfficePrefixFromRawId(String(d.settingKey || ''));
      if (!rawKey) return;
      settingsMeta[rawKey] = {
        valueStr: decodeNativeValueToString(d.value),
        rawValue: d.value,
        updatedAt: String(d.updatedAt || ''),
        updatedBy: d.updatedBy,
      };
    });
  }

  return {
    index,
    airmen,
    assignments,
    history,
    users,
    settingsMeta,
    hasAirmenBundle: Boolean(airmenDoc),
    hasUsersBundle: Boolean(usersDoc),
    hasHistoryBundle: Boolean(historyDoc),
    hasSettingsBundle: Boolean(settingsBundleDoc),
  };
}

function getRollingDiscoveryMonthWindow(monthsBack: number = 12, monthsAhead: number = 2): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let offset = -monthsBack; offset <= monthsAhead; offset++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!out.includes(ym)) out.push(ym);
  }
  return out;
}

export async function fetchAllCollectionsViaBundles(): Promise<{
  exists: boolean;
  index?: BundleIndex;
  airmen: any[];
  assignments: any[];
  history: any[];
  users: any[];
  settingsMeta: Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }>;
  hasAirmenBundle: boolean;
  hasUsersBundle: boolean;
  hasHistoryBundle: boolean;
  hasSettingsBundle: boolean;
  repairedMonths: string[];
  rawIntegrityVerifiedV4: boolean;
}> {
  const index = await fetchBundleIndexFromFirebase();
  if (!index) {
    return {
      exists: false,
      airmen: [],
      assignments: [],
      history: [],
      users: [],
      settingsMeta: {},
      hasAirmenBundle: false,
      hasUsersBundle: false,
      hasHistoryBundle: false,
      hasSettingsBundle: false,
      repairedMonths: [],
      rawIntegrityVerifiedV4: false,
    };
  }

  // Always include BOTH index.months AND any keys listed in index.monthChunks
  const knownMonthsSet = new Set<string>([
    ...(index.months || []),
    ...Object.keys(index.monthChunks || {}),
  ].filter((m) => /^\d{4}-\d{2}$/.test(m)));

  const repairedMonths: string[] = [];
  Object.keys(index.monthChunks || {}).forEach((m) => {
    if (/^\d{4}-\d{2}$/.test(m) && !(index.months || []).includes(m)) {
      repairedMonths.push(m);
    }
  });

  const fetched = await fetchSpecificBundlesFromFirebase({
    airmen: true,
    users: true,
    history: true,
    settings: true,
    months: Array.from(knownMonthsSet).sort(),
    index,
  });

  // One-time v4 index rescue: recover any orphaned __bundle_asn_YYYY-MM docs dropped by earlier partial syncs
  if (!index.rawIntegrityVerifiedV4 && !isFirestoreQuotaExceeded()) {
    const missingCandidates = getRollingDiscoveryMonthWindow(18, 3).filter((ym) => !knownMonthsSet.has(ym));
    if (missingCandidates.length > 0) {
      const probedDocs = await Promise.all(
        missingCandidates.map((ym) =>
          fetchSingleAppSettingDoc(getMonthBundleKey(ym, 1), 5000).catch(() => null)
        )
      );
      probedDocs.forEach((mDoc, i) => {
        if (!mDoc) return;
        const ym = missingCandidates[i];
        const items = extractItemsArrayFromBundleDoc(mDoc);
        if (items.length > 0) {
          knownMonthsSet.add(ym);
          repairedMonths.push(ym);
          index.monthChunks = index.monthChunks || {};
          if (!Array.isArray(index.monthChunks[ym]) || index.monthChunks[ym].length === 0) {
            index.monthChunks[ym] = [getMonthBundleKey(ym, 1)];
          }
          items.forEach((d) => {
            fetched.assignments.push(isCorruptedAssignmentRecord(d) ? { ...d, isDeleted: true } : d);
          });
        }
      });
    }
  }

  index.months = Array.from(knownMonthsSet).sort();
  cachedBundleIndexValue = index;

  return {
    exists: true,
    index,
    airmen: fetched.airmen,
    assignments: fetched.assignments,
    history: fetched.history,
    users: fetched.users,
    settingsMeta: fetched.settingsMeta,
    hasAirmenBundle: fetched.hasAirmenBundle,
    hasUsersBundle: fetched.hasUsersBundle,
    hasHistoryBundle: fetched.hasHistoryBundle,
    hasSettingsBundle: fetched.hasSettingsBundle,
    repairedMonths: Array.from(new Set(repairedMonths)),
    rawIntegrityVerifiedV4: Boolean(index.rawIntegrityVerifiedV4),
  };
}

function buildAssignmentMonthChunks(ym: string, items: any[]): Array<{ key: string; items: any[] }> {
  if (!items || items.length === 0) return [];
  const MAX_ITEMS_PER_CHUNK = 1200;
  const MAX_JSON_BYTES = 540000;
  const chunks: Array<{ key: string; items: any[] }> = [];
  let current: any[] = [];
  let currentBytes = 32;
  let partIdx = 1;

  for (const item of items) {
    const cleanItem = stripUndefinedDeep(item);
    const itemStr = JSON.stringify(cleanItem);
    const itemBytes = itemStr.length + 2;
    if (
      current.length > 0 &&
      (current.length >= MAX_ITEMS_PER_CHUNK || currentBytes + itemBytes > MAX_JSON_BYTES)
    ) {
      chunks.push({ key: getMonthBundleKey(ym, partIdx), items: current });
      partIdx++;
      current = [];
      currentBytes = 32;
    }
    current.push(cleanItem);
    currentBytes += itemBytes;
  }

  if (current.length > 0) {
    chunks.push({ key: getMonthBundleKey(ym, partIdx), items: current });
  }
  return chunks;
}

export async function pushBundlesToFirebase(opts: {
  airmen?: any[];
  assignmentsByMonth?: Record<string, any[]>;
  touchedMonths?: string[];
  deletedAssignments?: any[];
  history?: any[];
  users?: any[];
  settingsMap?: Record<string, { value: any; updatedAt?: string }>;
  mergeExistingSettings?: boolean;
  allActiveMonths?: string[];
  updateIndex?: boolean;
  markIntegrityVerifiedV4?: boolean;
  reason?: string;
}): Promise<{ writtenOps: number; index: BundleIndex | null }> {
  syncBundleCachesPrefix();
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) {
    return { writtenOps: 0, index: cachedBundleIndexValue };
  }

  const nowIso = new Date().toISOString();
  const updatedBy = clampStr(getCurrentBdNo() || 'user', 128) || 'user';
  const ops: Array<{ path: string; docId: string; data: Record<string, any> }> = [];
  const deleteDocIds: string[] = [];

  let baseIndex: BundleIndex | null = cachedBundleIndexValue;
  const needsIndexUpdate =
    Boolean(opts.updateIndex) ||
    Boolean(opts.touchedMonths && opts.touchedMonths.length > 0) ||
    Boolean(opts.assignmentsByMonth) ||
    Boolean(opts.settingsMap) ||
    !baseIndex;

  if (needsIndexUpdate && !baseIndex) {
    baseIndex = await fetchBundleIndexFromFirebase().catch(() => null);
  }

  const nextMonthChunks: Record<string, string[]> = { ...(baseIndex?.monthChunks || {}) };
  // Always preserve existing cloud months + chunked months; NEVER drop months that weren't explicitly emptied
  const activeMonthsSet = new Set<string>(
    [
      ...(baseIndex?.months || []),
      ...Object.keys(nextMonthChunks),
      ...(opts.allActiveMonths || []),
    ].filter((m) => /^\d{4}-\d{2}$/.test(m))
  );
  let overflowKeysSet = new Set<string>(baseIndex?.overflowSettingKeys || []);

  if (Array.isArray(opts.airmen)) {
    const formattedAirmen = opts.airmen.map((a) => stripUndefinedDeep(formatAirmanForFirestore(a, nowIso).data));
    ops.push({
      path: 'app_settings',
      docId: sanitizeDocId(BUNDLE_AIRMEN_KEY),
      data: {
        settingKey: BUNDLE_AIRMEN_KEY,
        value: { items: formattedAirmen },
        updatedAt: nowIso,
        updatedBy,
      },
    });
  }

  if (Array.isArray(opts.users)) {
    const validUsers = opts.users.filter(
      (u) => u && u.bdNo && String(u.bdNo).toLowerCase() !== 'deleted_admin'
    );
    const formattedUsers = validUsers.map((u) =>
      stripUndefinedDeep(formatUserProfileForFirestore(u, nowIso).data)
    );
    ops.push({
      path: 'app_settings',
      docId: sanitizeDocId(BUNDLE_USERS_KEY),
      data: {
        settingKey: BUNDLE_USERS_KEY,
        value: { items: formattedUsers },
        updatedAt: nowIso,
        updatedBy,
      },
    });
  }

  if (Array.isArray(opts.history)) {
    const slicedHist = opts.history.slice(0, 300).map((h) =>
      stripUndefinedDeep(formatParadeStateForFirestore(h, nowIso).data)
    );
    // Safety trim to keep under 550KB
    const trimmedHist: any[] = [];
    let bytes = 32;
    for (const hItem of slicedHist) {
      const len = JSON.stringify(hItem).length + 2;
      if (trimmedHist.length > 0 && bytes + len > 540000) break;
      trimmedHist.push(hItem);
      bytes += len;
    }
    ops.push({
      path: 'app_settings',
      docId: sanitizeDocId(BUNDLE_HISTORY_KEY),
      data: {
        settingKey: BUNDLE_HISTORY_KEY,
        value: { items: trimmedHist },
        updatedAt: nowIso,
        updatedBy,
      },
    });
  }

  const deletedByMonth = new Map<string, any[]>();
  const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
  const nowMs = Date.now();
  (opts.deletedAssignments || []).forEach((delA) => {
    if (!delA) return;
    const ym = String(delA.date || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    const ts = delA.updatedAt ? Date.parse(String(delA.updatedAt)) : nowMs;
    if (ts && nowMs - ts > FOURTEEN_DAYS_MS) return;
    const formatted = stripUndefinedDeep(formatDutyAssignmentForFirestore(delA, nowIso, true).data);
    if (!deletedByMonth.has(ym)) deletedByMonth.set(ym, []);
    deletedByMonth.get(ym)!.push(formatted);
  });

  const monthsToWrite = opts.touchedMonths
    ? Array.from(new Set(opts.touchedMonths.filter((m) => /^\d{4}-\d{2}$/.test(m))))
    : opts.assignmentsByMonth
    ? Object.keys(opts.assignmentsByMonth).filter((m) => /^\d{4}-\d{2}$/.test(m))
    : [];

  for (const ym of monthsToWrite) {
    const rawList = (opts.assignmentsByMonth && opts.assignmentsByMonth[ym]) || [];
    const formattedActive: any[] = [];
    const activeIds = new Set<string>();
    rawList.forEach((a) => {
      if (!a || isCorruptedAssignmentRecord(a) || a.isDeleted) return;
      const f = formatDutyAssignmentForFirestore(a, nowIso, false);
      activeIds.add(f.docId);
      formattedActive.push(stripUndefinedDeep(f.data));
    });
    const delTombstones = (deletedByMonth.get(ym) || []).filter((d) => !activeIds.has(String(d.id || '')));
    const combinedItems = [...formattedActive, ...delTombstones];

    const prevChunks = Array.isArray(nextMonthChunks[ym]) ? nextMonthChunks[ym] : [getMonthBundleKey(ym, 1)];
    if (combinedItems.length === 0) {
      activeMonthsSet.delete(ym);
      delete nextMonthChunks[ym];
      prevChunks.forEach((ck) => deleteDocIds.push(ck));
      continue;
    }

    const chunks = buildAssignmentMonthChunks(ym, combinedItems);
    const newChunkKeys = chunks.map((c) => c.key);
    prevChunks.forEach((oldKey) => {
      if (!newChunkKeys.includes(oldKey)) {
        deleteDocIds.push(oldKey);
      }
    });

    if (formattedActive.length > 0 || delTombstones.length > 0) {
      activeMonthsSet.add(ym);
      nextMonthChunks[ym] = newChunkKeys;
    }
    chunks.forEach((chunk) => {
      ops.push({
        path: 'app_settings',
        docId: sanitizeDocId(chunk.key),
        data: {
          settingKey: chunk.key,
          value: { items: chunk.items },
          updatedAt: nowIso,
          updatedBy,
        },
      });
    });
  }

  if (opts.settingsMap && Object.keys(opts.settingsMap).length > 0) {
    let existingEntries: Record<string, { value: any; updatedAt: string }> = {
      ...cachedBundleSettingsEntries,
    };
    if (opts.mergeExistingSettings && Object.keys(existingEntries).length === 0) {
      const existingDoc = await fetchSingleAppSettingDoc(BUNDLE_SETTINGS_KEY, 6000).catch(() => null);
      if (existingDoc) {
        const tmpMeta: Record<string, { valueStr: string; rawValue: any; updatedAt: string; updatedBy?: string }> = {};
        unpackSettingsBundleDoc(existingDoc, tmpMeta);
        existingEntries = { ...cachedBundleSettingsEntries };
      }
    }

    for (const [k, item] of Object.entries(opts.settingsMap)) {
      if (!k) continue;
      const encodedVal = encodeNativeSettingValue(item.value);
      existingEntries[k] = {
        value: encodedVal,
        updatedAt: toIsoString(item.updatedAt || nowIso),
      };
    }

    const bundledEntries: Record<string, { value: any; updatedAt: string }> = {};
    const overflowList: Array<{ key: string; value: any; updatedAt: string }> = [];
    // Sort entries by JSON size ascending so small keys pack tightly into __bundle_settings_v1
    const sortedKeys = Object.keys(existingEntries).sort((a, b) => {
      const la = JSON.stringify(existingEntries[a]).length;
      const lb = JSON.stringify(existingEntries[b]).length;
      return la - lb;
    });

    let bundledBytes = 64;
    for (const k of sortedKeys) {
      const entry = existingEntries[k];
      const cleanedEntry = {
        value: stripUndefinedDeep(entry.value),
        updatedAt: entry.updatedAt,
      };
      const entryLen = k.length + JSON.stringify(cleanedEntry).length + 12;
      if (entryLen > 240000 || bundledBytes + entryLen > 540000) {
        overflowList.push({ key: k, value: cleanedEntry.value, updatedAt: cleanedEntry.updatedAt });
        overflowKeysSet.add(k);
      } else {
        bundledEntries[k] = cleanedEntry;
        bundledBytes += entryLen;
        overflowKeysSet.delete(k);
      }
    }

    ops.push({
      path: 'app_settings',
      docId: sanitizeDocId(BUNDLE_SETTINGS_KEY),
      data: {
        settingKey: BUNDLE_SETTINGS_KEY,
        value: { entries: bundledEntries },
        updatedAt: nowIso,
        updatedBy,
      },
    });

    overflowList.forEach((ov) => {
      const docId = sanitizeDocId(ov.key);
      ops.push({
        path: 'app_settings',
        docId,
        data: {
          settingKey: clampStr(ov.key, 200) || docId,
          value: encodeNativeSettingValue(ov.value),
          updatedAt: ov.updatedAt,
          updatedBy,
        },
      });
    });

    cachedBundleSettingsEntries = existingEntries;
  }

  const nextRawIntegrityVerifiedV4 =
    opts.markIntegrityVerifiedV4 !== undefined
      ? Boolean(opts.markIntegrityVerifiedV4)
      : Boolean(baseIndex?.rawIntegrityVerifiedV4);

  const nextIndex: BundleIndex = {
    version: 2,
    months: Array.from(activeMonthsSet).sort(),
    monthChunks: nextMonthChunks,
    overflowSettingKeys: Array.from(overflowKeysSet),
    rawIntegrityVerifiedV4: nextRawIntegrityVerifiedV4,
    updatedAt: nowIso,
  };

  if (needsIndexUpdate || ops.length > 0) {
    ops.push({
      path: 'app_settings',
      docId: sanitizeDocId(BUNDLE_INDEX_KEY),
      data: {
        settingKey: BUNDLE_INDEX_KEY,
        value: nextIndex,
        updatedAt: nowIso,
        updatedBy,
      },
    });
  }

  let writtenOps = 0;
  if (ops.length > 0) {
    writtenOps = await commitSetOps(ops, `bundles:${opts.reason || 'sync'}`);
    if (writtenOps > 0) {
      cachedBundleIndexValue = nextIndex;
    }
  }

  if (deleteDocIds.length > 0 && !isFirestoreQuotaExceeded()) {
    const scopedDels = scopeWriteOpsForActiveOffice(
      deleteDocIds.map((id) => ({ path: 'app_settings', docId: sanitizeDocId(id), data: {} }))
    );
    if (scopedDels.length > 0) {
      recordFirestoreQuotaUsage({
        type: 'DELETE',
        count: scopedDels.length,
        reason: 'Cleanup Legacy Settings/Bundle Docs',
        collection: 'app_settings',
      });
    }
    await Promise.allSettled(
      scopedDels.map((op) => deleteDoc(doc(dbLite!, 'app_settings', op.docId)))
    );
  }

  cachedBundleIndexValue = nextIndex;
  return { writtenOps, index: nextIndex };
}

/**
 * Purges all Firestore documents scoped to the active custom office prefix (`off_<CODE>__`)
 * so a newly added or reset custom office starts 100% brand new in Firestore.
 * Never touches 155 UASU BAF documents.
 */
export async function purgeActiveCustomOfficeCloudData(options?: {
  keepUserIds?: string[];
  onlySettingsAndLeakedUsers?: boolean;
  includeLegacyScan?: boolean;
}): Promise<void> {
  if (isDefault155UasuOffice()) return;
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  const prefix = getOfficeFirestoreDocPrefix();
  if (!prefix || !prefix.startsWith('off_')) return;

  // 1. Delete known bundle docs using 1 single index read instead of scanning 5 full collections
  try {
    const bundleIdx = await fetchBundleIndexFromFirebase().catch(() => null);
    const bundleKeysToDelete = new Set<string>();
    if (options?.onlySettingsAndLeakedUsers) {
      bundleKeysToDelete.add(BUNDLE_SETTINGS_KEY);
      (bundleIdx?.overflowSettingKeys || []).forEach((k) => bundleKeysToDelete.add(k));
      if (!options.keepUserIds || options.keepUserIds.length === 0) {
        bundleKeysToDelete.add(BUNDLE_USERS_KEY);
      }
    } else {
      bundleKeysToDelete.add(BUNDLE_INDEX_KEY);
      bundleKeysToDelete.add(BUNDLE_AIRMEN_KEY);
      bundleKeysToDelete.add(BUNDLE_USERS_KEY);
      bundleKeysToDelete.add(BUNDLE_HISTORY_KEY);
      bundleKeysToDelete.add(BUNDLE_SETTINGS_KEY);
      bundleKeysToDelete.add('__office_presence_v1');
      (bundleIdx?.overflowSettingKeys || []).forEach((k) => bundleKeysToDelete.add(k));
      (bundleIdx?.months || []).forEach((ym) => {
        const chunks = bundleIdx?.monthChunks?.[ym];
        if (Array.isArray(chunks) && chunks.length > 0) {
          chunks.forEach((ck) => bundleKeysToDelete.add(ck));
        } else {
          bundleKeysToDelete.add(getMonthBundleKey(ym, 1));
        }
      });
    }

    const scopedIds = Array.from(bundleKeysToDelete).map((k) => scopeAppSettingDocId(k));
    const CHUNK = 350;
    for (let i = 0; i < scopedIds.length; i += CHUNK) {
      if (isFirestoreQuotaExceeded()) break;
      const slice = scopedIds.slice(i, i + CHUNK);
      const batch = writeBatch(dbLite);
      slice.forEach((id) => batch.delete(doc(dbLite, 'app_settings', id)));
      await withFirestoreTimeout(batch.commit(), 12000, 'purgeBatch:bundles');
      recordFirestoreQuotaUsage({
        type: 'DELETE',
        count: slice.length,
        reason: 'Purge Custom Office Cloud Bundles',
        collection: 'app_settings',
      });
    }
    cachedBundleIndexValue = null;
    cachedBundleSettingsEntries = {};
  } catch (err) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, (err as any)?.message);
      return;
    }
  }

  // Only run legacy collection scans when explicitly requested
  if (!options?.includeLegacyScan) {
    return;
  }

  const collectionsToClean = options?.onlySettingsAndLeakedUsers
    ? ['user_profiles', 'app_settings']
    : ['airmen', 'duty_assignments', 'parade_states', 'user_profiles', 'app_settings'];

  const keepSet = new Set(
    (options?.keepUserIds || []).map((id) => sanitizeDocId(`${prefix}${id}`))
  );

  for (const colName of collectionsToClean) {
    if (isFirestoreQuotaExceeded()) break;
    try {
      const snap = await withFirestoreTimeout(
        getDocs(collection(dbLite, colName)),
        10000,
        `purgeList:${colName}`
      );
      recordFirestoreQuotaUsage({
        type: 'READ',
        count: Math.max(1, snap.size),
        reason: `Purge Scan (${colName})`,
        collection: colName,
      });
      const docIdsToDelete: string[] = [];
      snap.forEach((docSnap) => {
        const docId = docSnap.id;
        const d = docSnap.data() || {};
        const matchesPrefix =
          docId.startsWith(prefix) ||
          String(d.id || '').startsWith(prefix) ||
          String(d.settingKey || '').startsWith(prefix);
        if (!matchesPrefix) return;

        if (colName === 'user_profiles') {
          if (keepSet.has(docId)) return;
          if (options?.onlySettingsAndLeakedUsers) {
            const rawId = String(d.id || docId).slice(prefix.length);
            const rawBd = String(d.bdNo || d.userId || '').replace(/\D/g, '');
            const isMaster = rawBd === '48456' || d.role === 'master_owner' || d.isProtected === true;
            const isOfficeAdmin = rawId.startsWith('office-admin-');
            if (isMaster || isOfficeAdmin) return;
          }
        }
        docIdsToDelete.push(docId);
      });

      const CHUNK = 350;
      for (let i = 0; i < docIdsToDelete.length; i += CHUNK) {
        if (isFirestoreQuotaExceeded()) break;
        const slice = docIdsToDelete.slice(i, i + CHUNK);
        const batch = writeBatch(dbLite);
        slice.forEach((id) => batch.delete(doc(dbLite, colName, id)));
        await withFirestoreTimeout(batch.commit(), 12000, `purgeBatch:${colName}`);
        recordFirestoreQuotaUsage({
          type: 'DELETE',
          count: slice.length,
          reason: `Purge Legacy Docs (${colName})`,
          collection: colName,
        });
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        setFirestoreQuotaExceeded(true, (err as any)?.message);
        break;
      }
      console.warn(`[FirebaseService] purgeActiveCustomOfficeCloudData warning on ${colName}:`, err);
    }
  }
}


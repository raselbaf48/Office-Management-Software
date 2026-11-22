import {
  collection,
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

export function getAssignmentDocId(a: any): string {
  const raw =
    a?.id ||
    `asn_${a?.airmanId || 'u'}_${a?.date || '0000'}_${a?.dutyCode || 'ON_PARADE'}_${a?.idaShift || 'n'}_${a?.disposalScope || 'ALL'}`;
  return sanitizeDocId(raw);
}

export function getAirmanDocId(a: any): string {
  const cleanBd = String(a?.bdNo || '').replace(/\D/g, '');
  const raw = a?.id || (cleanBd ? `BD_${cleanBd}` : `airman_${Date.now()}`);
  return sanitizeDocId(raw);
}

export function getUserProfileDocId(u: any): string {
  const cleanBd = clampStr(String(u?.userId || u?.bdNo || '').replace(/^BD\/?/i, '').trim() || 'unknown', 64) || 'unknown';
  return sanitizeDocId(u?.id || `user_login_${cleanBd}`);
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
    if (!Array.isArray(rows)) return [];
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
      const matchesDocId = rawDocId.startsWith(prefix);
      const matchesDataId = String(d.id || '').startsWith(prefix);
      const matchesSettingKey = String(d.settingKey || '').startsWith(prefix);
      if (!matchesDocId && !matchesDataId && !matchesSettingKey) {
        continue;
      }
      const cloned = { ...d };
      delete cloned.__firestoreDocId;
      if (typeof cloned.id === 'string' && cloned.id.startsWith(prefix)) {
        cloned.id = cloned.id.slice(prefix.length);
      }
      if (typeof cloned.settingKey === 'string' && cloned.settingKey.startsWith(prefix)) {
        cloned.settingKey = cloned.settingKey.slice(prefix.length);
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

  return ops.map((op) => {
    const scopedDocId = op.docId.startsWith(prefix) ? op.docId : sanitizeDocId(`${prefix}${op.docId}`);
    const scopedData: Record<string, any> = { ...op.data };
    if (typeof scopedData.id === 'string' && !scopedData.id.startsWith(prefix)) {
      scopedData.id = clampStr(`${prefix}${scopedData.id}`, 128) || scopedDocId;
    }
    if (typeof scopedData.settingKey === 'string' && !scopedData.settingKey.startsWith(prefix)) {
      scopedData.settingKey = clampStr(`${prefix}${scopedData.settingKey}`, 200) || scopedDocId;
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

export async function publishSyncManifest(
  changedCollections: string[],
  reason: string = 'delta_sync',
  extraMeta?: { dataHash?: string; airmenCount?: number; assignmentsCount?: number }
): Promise<void> {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  const manifestDocId = getSyncManifestDocId();
  try {
    const nowIso = new Date().toISOString();
    const safeCollections = changedCollections
      .filter((c) => typeof c === 'string' && c.trim().length > 0)
      .slice(0, 20);
    const nextManifest: SyncManifest = {
      id: manifestDocId,
      revision: Date.now(),
      updatedAt: nowIso,
      updatedBySessionId: CLIENT_SESSION_ID.slice(0, 128),
      updatedByBdNo: getCurrentBdNo() || 'system',
      lastReason: clampStr(reason, 200) || 'delta_sync',
      changedCollections: safeCollections,
      ...(extraMeta?.dataHash ? { dataHash: clampStr(extraMeta.dataHash, 128) } : cachedManifestResult?.dataHash ? { dataHash: cachedManifestResult.dataHash } : {}),
      ...(typeof extraMeta?.airmenCount === 'number' ? { airmenCount: extraMeta.airmenCount } : {}),
      ...(typeof extraMeta?.assignmentsCount === 'number' ? { assignmentsCount: extraMeta.assignmentsCount } : {}),
    };
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
    } else {
      console.warn('[FirebaseService] Manifest update notice:', err?.message);
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
      if (
        !latestManifestSnapshot ||
        latestManifestSnapshot.revision !== data.revision ||
        latestManifestSnapshot.updatedAt !== data.updatedAt ||
        (data.dataHash && latestManifestSnapshot.dataHash !== data.dataHash)
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

function ensureSharedManifestListener() {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  if (manifestListeners.size === 0) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (sharedManifestTimer) return;

  void pollSharedManifestOnce();
  sharedManifestTimer = setInterval(() => {
    void pollSharedManifestOnce();
  }, 60 * 1000); // 60 seconds background manifest poll when active
}

export function subscribeToSyncManifest(
  callback: (manifest: SyncManifest) => void
): () => void {
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) {
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
      if (manifestListeners.size > 0) {
        ensureSharedManifestListener();
        void pollSharedManifestOnce(true);
      }
    });
    window.addEventListener('focus', () => {
      if (manifestListeners.size > 0) {
        void pollSharedManifestOnce(true);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && manifestListeners.size > 0) {
        void pollSharedManifestOnce(true);
      }
    });
  }

  ensureSharedManifestListener();

  return () => {
    manifestListeners.delete(callback);
    if (manifestListeners.size === 0 && sharedManifestTimer) {
      clearInterval(sharedManifestTimer);
      sharedManifestTimer = null;
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
      result[d.settingKey] = {
        valueStr: decodeNativeValueToString(d.value),
        rawValue: d.value,
        updatedAt: String(d.updatedAt || ''),
        updatedBy: d.updatedBy,
      };
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

/**
 * Purges all Firestore documents scoped to the active custom office prefix (`off_<CODE>__`)
 * so a newly added or reset custom office starts 100% brand new in Firestore.
 * Never touches 155 UASU BAF documents.
 */
export async function purgeActiveCustomOfficeCloudData(options?: {
  keepUserIds?: string[];
  onlySettingsAndLeakedUsers?: boolean;
}): Promise<void> {
  if (isDefault155UasuOffice()) return;
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  const prefix = getOfficeFirestoreDocPrefix();
  if (!prefix || !prefix.startsWith('off_')) return;

  const collectionsToClean = options?.onlySettingsAndLeakedUsers
    ? ['user_profiles', 'app_settings']
    : ['airmen', 'duty_assignments', 'parade_states', 'user_profiles', 'app_settings'];

  const keepSet = new Set(
    (options?.keepUserIds || []).map((id) => sanitizeDocId(`${prefix}${id}`))
  );

  for (const colName of collectionsToClean) {
    try {
      const snap = await withFirestoreTimeout(
        getDocs(collection(dbLite, colName)),
        10000,
        `purgeList:${colName}`
      );
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
        const slice = docIdsToDelete.slice(i, i + CHUNK);
        const batch = writeBatch(dbLite);
        slice.forEach((id) => batch.delete(doc(dbLite, colName, id)));
        await withFirestoreTimeout(batch.commit(), 12000, `purgeBatch:${colName}`);
      }
    } catch (err) {
      console.warn(`[FirebaseService] purgeActiveCustomOfficeCloudData warning on ${colName}:`, err);
    }
  }
}


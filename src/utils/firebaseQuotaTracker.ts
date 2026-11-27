// ============================================================================
// FIREBASE CLOUD DAILY QUOTA REAL-TIME TELEMETRY & DAILY AUTO-RESET TRACKER
// Tracks live Firestore Spark-tier daily quota usage (Reads, Writes, Deletes),
// detailed per-reason/collection consumption, and auto-resets every day at
// Midnight Pacific Time (America/Los_Angeles — Firebase's official daily reset).
// ============================================================================

export type QuotaOperationType = 'READ' | 'WRITE' | 'DELETE';

export const FIREBASE_DAILY_LIMITS = {
  READ: 50000,
  WRITE: 20000,
  DELETE: 20000,
} as const;

export interface QuotaReasonBreakdown {
  key: string;
  opType: QuotaOperationType;
  reason: string;
  collection: string;
  count: number;
  calls: number;
  lastAt: string;
  officeCode?: string;
}

export interface QuotaRecentEvent {
  id: string;
  at: string;
  opType: QuotaOperationType;
  count: number;
  reason: string;
  collection: string;
  officeCode?: string;
}

export interface FirebaseQuotaTelemetrySnapshot {
  quotaDatePt: string;
  reads: number;
  writes: number;
  deletes: number;
  readsPercent: number;
  writesPercent: number;
  deletesPercent: number;
  overallPercent: number;
  serverQuotaExhausted: boolean;
  serverQuotaErrorMsg: string;
  quotaExceededHits: number;
  lastUpdatedAt: string;
  nextResetAtIso: string;
  breakdown: QuotaReasonBreakdown[];
  recentEvents: QuotaRecentEvent[];
}

const TELEMETRY_STORAGE_KEY = 'baf_firebase_quota_telemetry_v1';
const QUOTA_TELEMETRY_EVENT = 'baf_firebase_quota_telemetry_updated';

interface StoredTelemetryState {
  quotaDatePt: string;
  reads: number;
  writes: number;
  deletes: number;
  quotaExceededHits: number;
  serverQuotaExhausted: boolean;
  serverQuotaErrorMsg: string;
  lastUpdatedAt: string;
  breakdownMap: Record<string, QuotaReasonBreakdown>;
  recentEvents: QuotaRecentEvent[];
}

export function getCurrentPacificQuotaDate(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Computes the next Midnight Pacific Time (America/Los_Angeles) UTC timestamp,
 * which is when Google Firebase resets daily Firestore Spark quotas.
 */
export function getNextPacificMidnightResetIso(now: Date = new Date()): string {
  try {
    const ptDateStr = getCurrentPacificQuotaDate(now);
    const [y, m, d] = ptDateStr.split('-').map(Number);
    // Walk hour-by-hour from current time up to +28h until PT date flips to next day
    const startMs = Math.floor(now.getTime() / 60000) * 60000;
    for (let mins = 1; mins <= 28 * 60; mins += 15) {
      const probe = new Date(startMs + mins * 60000);
      if (getCurrentPacificQuotaDate(probe) !== ptDateStr) {
        // Refine down to the exact minute
        for (let back = 14; back >= 0; back--) {
          const exact = new Date(probe.getTime() - back * 60000);
          if (getCurrentPacificQuotaDate(exact) !== ptDateStr) {
            exact.setUTCSeconds(0, 0);
            return exact.toISOString();
          }
        }
        return probe.toISOString();
      }
    }
    return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1, 8, 0, 0)).toISOString();
  } catch {
    return new Date(Date.now() + 12 * 3600 * 1000).toISOString();
  }
}

function createFreshState(ptDay: string = getCurrentPacificQuotaDate()): StoredTelemetryState {
  return {
    quotaDatePt: ptDay,
    reads: 0,
    writes: 0,
    deletes: 0,
    quotaExceededHits: 0,
    serverQuotaExhausted: false,
    serverQuotaErrorMsg: '',
    lastUpdatedAt: new Date().toISOString(),
    breakdownMap: {},
    recentEvents: [],
  };
}

let inMemoryState: StoredTelemetryState | null = null;
let autoResetTickerStarted = false;

function getActiveOfficeCodeSafe(): string {
  if (typeof window === 'undefined') return '155-UASU';
  try {
    const raw = window.localStorage.getItem('custom_office_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.officeCode) return String(parsed.officeCode).toUpperCase().trim();
      if (parsed?.firebaseConfig?.officeCode) {
        return String(parsed.firebaseConfig.officeCode).toUpperCase().trim();
      }
    }
  } catch {}
  return '155-UASU';
}

function loadRawState(): StoredTelemetryState {
  const currentPt = getCurrentPacificQuotaDate();
  if (inMemoryState && inMemoryState.quotaDatePt === currentPt) {
    return inMemoryState;
  }

  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const raw = window.localStorage.getItem(TELEMETRY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredTelemetryState;
        if (parsed && parsed.quotaDatePt === currentPt) {
          inMemoryState = {
            quotaDatePt: currentPt,
            reads: Number(parsed.reads) || 0,
            writes: Number(parsed.writes) || 0,
            deletes: Number(parsed.deletes) || 0,
            quotaExceededHits: Number(parsed.quotaExceededHits) || 0,
            serverQuotaExhausted: Boolean(parsed.serverQuotaExhausted),
            serverQuotaErrorMsg: String(parsed.serverQuotaErrorMsg || ''),
            lastUpdatedAt: String(parsed.lastUpdatedAt || new Date().toISOString()),
            breakdownMap: parsed.breakdownMap && typeof parsed.breakdownMap === 'object' ? parsed.breakdownMap : {},
            recentEvents: Array.isArray(parsed.recentEvents) ? parsed.recentEvents.slice(0, 30) : [],
          };
          return inMemoryState;
        }
      }
    } catch {}
  }

  // Daily reset when Pacific date changes or no prior state exists
  const fresh = createFreshState(currentPt);
  persistState(fresh, true);
  return fresh;
}

function persistState(state: StoredTelemetryState, clearLegacyQuotaFlagsOnReset: boolean = false): void {
  inMemoryState = state;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(state));
      if (clearLegacyQuotaFlagsOnReset) {
        window.localStorage.removeItem('baf_firebase_quota_exceeded_at');
        window.localStorage.removeItem('baf_firebase_quota_error_msg');
      }
    } catch {}
    window.dispatchEvent(
      new CustomEvent(QUOTA_TELEMETRY_EVENT, {
        detail: buildSnapshotFromState(state),
      })
    );
  }
}

function buildSnapshotFromState(state: StoredTelemetryState): FirebaseQuotaTelemetrySnapshot {
  const readsPercent = Math.min(100, Number(((state.reads / FIREBASE_DAILY_LIMITS.READ) * 100).toFixed(2)));
  const writesPercent = Math.min(100, Number(((state.writes / FIREBASE_DAILY_LIMITS.WRITE) * 100).toFixed(2)));
  const deletesPercent = Math.min(100, Number(((state.deletes / FIREBASE_DAILY_LIMITS.DELETE) * 100).toFixed(2)));

  let isLegacyQuotaExceeded = state.serverQuotaExhausted;
  if (!isLegacyQuotaExceeded && typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem('baf_firebase_quota_exceeded_at');
      if (saved) {
        const ts = Date.parse(saved);
        if (!isNaN(ts) && getCurrentPacificQuotaDate(new Date(ts)) === state.quotaDatePt) {
          isLegacyQuotaExceeded = true;
        }
      }
    } catch {}
  }

  const maxMetricPct = Math.max(readsPercent, writesPercent, deletesPercent);
  const overallPercent = isLegacyQuotaExceeded ? 100 : maxMetricPct;

  const breakdown = Object.values(state.breakdownMap).sort((a, b) => b.count - a.count);

  return {
    quotaDatePt: state.quotaDatePt,
    reads: state.reads,
    writes: state.writes,
    deletes: state.deletes,
    readsPercent,
    writesPercent,
    deletesPercent,
    overallPercent,
    serverQuotaExhausted: isLegacyQuotaExceeded,
    serverQuotaErrorMsg: state.serverQuotaErrorMsg,
    quotaExceededHits: state.quotaExceededHits,
    lastUpdatedAt: state.lastUpdatedAt,
    nextResetAtIso: getNextPacificMidnightResetIso(),
    breakdown,
    recentEvents: state.recentEvents,
  };
}

export function getFirebaseQuotaTelemetrySnapshot(): FirebaseQuotaTelemetrySnapshot {
  ensureQuotaAutoResetListeners();
  const state = loadRawState();
  return buildSnapshotFromState(state);
}

export function recordFirestoreQuotaUsage(params: {
  type: QuotaOperationType;
  count?: number;
  reason: string;
  collection?: string;
  officeCode?: string;
}): void {
  ensureQuotaAutoResetListeners();
  const units = Math.max(1, Math.round(Number(params.count) || 1));
  const reason = String(params.reason || 'Firestore Operation').trim().slice(0, 120);
  const collection = String(params.collection || 'firestore').trim().slice(0, 64);
  const officeCode = params.officeCode || getActiveOfficeCodeSafe();
  const nowIso = new Date().toISOString();

  const state = loadRawState();
  if (params.type === 'READ') state.reads += units;
  else if (params.type === 'WRITE') state.writes += units;
  else if (params.type === 'DELETE') state.deletes += units;

  state.lastUpdatedAt = nowIso;

  const bKey = `${params.type}::${reason}::${collection}`;
  const prev = state.breakdownMap[bKey];
  state.breakdownMap[bKey] = {
    key: bKey,
    opType: params.type,
    reason,
    collection,
    count: (prev?.count || 0) + units,
    calls: (prev?.calls || 0) + 1,
    lastAt: nowIso,
    officeCode,
  };

  // Prune breakdownMap if unusually large (keep top 60 entries)
  const keys = Object.keys(state.breakdownMap);
  if (keys.length > 80) {
    const sorted = Object.values(state.breakdownMap)
      .sort((a, b) => b.count - a.count)
      .slice(0, 60);
    const trimmed: Record<string, QuotaReasonBreakdown> = {};
    sorted.forEach((item) => {
      trimmed[item.key] = item;
    });
    state.breakdownMap = trimmed;
  }

  state.recentEvents = [
    {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      at: nowIso,
      opType: params.type,
      count: units,
      reason,
      collection,
      officeCode,
    },
    ...state.recentEvents,
  ].slice(0, 30);

  persistState(state, false);
}

export function markFirebaseQuotaExceededEvent(exceeded: boolean, errorMsg?: string): void {
  const state = loadRawState();
  state.lastUpdatedAt = new Date().toISOString();
  if (exceeded) {
    state.serverQuotaExhausted = true;
    state.serverQuotaErrorMsg = String(errorMsg || 'Firestore daily quota exceeded (429 RESOURCE_EXHAUSTED)');
    state.quotaExceededHits += 1;
  } else {
    state.serverQuotaExhausted = false;
    state.serverQuotaErrorMsg = '';
  }
  persistState(state, false);
}

export function resetFirebaseQuotaTelemetry(clearQuotaExceededFlag: boolean = true): FirebaseQuotaTelemetrySnapshot {
  const fresh = createFreshState(getCurrentPacificQuotaDate());
  persistState(fresh, clearQuotaExceededFlag);
  return buildSnapshotFromState(fresh);
}

export function ensureQuotaAutoResetListeners(): void {
  if (autoResetTickerStarted || typeof window === 'undefined') return;
  autoResetTickerStarted = true;

  // Check every 15 seconds if Pacific Time day rolled over -> auto-reset everything to 0
  setInterval(() => {
    const currentPt = getCurrentPacificQuotaDate();
    if (inMemoryState && inMemoryState.quotaDatePt !== currentPt) {
      const fresh = createFreshState(currentPt);
      persistState(fresh, true);
      window.dispatchEvent(new CustomEvent('baf_firebase_quota_recovered'));
      window.dispatchEvent(
        new CustomEvent('baf_firebase_quota_status', {
          detail: { exceeded: false, errorMsg: '' },
        })
      );
    } else {
      try {
        const raw = window.localStorage.getItem(TELEMETRY_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.quotaDatePt && parsed.quotaDatePt !== currentPt) {
            const fresh = createFreshState(currentPt);
            persistState(fresh, true);
            window.dispatchEvent(new CustomEvent('baf_firebase_quota_recovered'));
          }
        }
      } catch {}
    }
  }, 15000);

  window.addEventListener('storage', (e) => {
    if (e.key === TELEMETRY_STORAGE_KEY || e.key === 'baf_firebase_quota_exceeded_at') {
      inMemoryState = null;
      const snap = getFirebaseQuotaTelemetrySnapshot();
      window.dispatchEvent(new CustomEvent(QUOTA_TELEMETRY_EVENT, { detail: snap }));
    }
  });

  window.addEventListener('baf_firebase_quota_status', (e: any) => {
    const exceeded = Boolean(e?.detail?.exceeded);
    const msg = String(e?.detail?.errorMsg || '');
    const state = loadRawState();
    if (exceeded && !state.serverQuotaExhausted) {
      markFirebaseQuotaExceededEvent(true, msg);
    } else if (!exceeded && state.serverQuotaExhausted) {
      markFirebaseQuotaExceededEvent(false, '');
    }
  });
}

export function subscribeFirebaseQuotaTelemetry(
  callback: (snapshot: FirebaseQuotaTelemetrySnapshot) => void
): () => void {
  ensureQuotaAutoResetListeners();
  try {
    callback(getFirebaseQuotaTelemetrySnapshot());
  } catch {}

  if (typeof window === 'undefined') return () => {};

  const handler = (e: Event) => {
    const detail = (e as CustomEvent<FirebaseQuotaTelemetrySnapshot>).detail;
    callback(detail || getFirebaseQuotaTelemetrySnapshot());
  };

  window.addEventListener(QUOTA_TELEMETRY_EVENT, handler);
  return () => {
    window.removeEventListener(QUOTA_TELEMETRY_EVENT, handler);
  };
}

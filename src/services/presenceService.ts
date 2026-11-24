import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
} from 'firebase/firestore/lite';
import {
  db,
  dbLite,
  isFirebaseConfigured,
  isFirestoreQuotaExceeded,
  isQuotaExceededError,
  setFirestoreQuotaExceeded,
  CLIENT_SESSION_ID,
  getActiveOfficeCode,
  getOfficeScopedStorageKey,
  getOfficeFirestoreDocPrefix,
  isDefault155UasuOffice,
} from '../firebase';
import { Rank, FlightName } from '../types';

export interface UserPresence {
  bdNo: string;
  sessionId?: string;
  name: string;
  rank: Rank | string;
  flightName: FlightName | string;
  role?: string;
  lastActive?: string;
  status?: 'online' | 'offline' | string;
  deviceInfo?: string;
  page?: string;
  currentActivity?: string;
}

const BASE_PRESENCE_STORAGE_KEY = 'baf_presence';
const BASE_LOGIN_HISTORY_KEY = 'baf_user_login_history';
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes considered online

const getPresenceStorageKey = (): string => getOfficeScopedStorageKey(BASE_PRESENCE_STORAGE_KEY);
const getLoginHistoryStorageKey = (): string => getOfficeScopedStorageKey(BASE_LOGIN_HISTORY_KEY);
const getLoginHistoryDocId = (): string => {
  const prefix = getOfficeFirestoreDocPrefix();
  return prefix ? `${prefix}${BASE_LOGIN_HISTORY_KEY}` : BASE_LOGIN_HISTORY_KEY;
};

const sanitizeDocId = (raw: string): string => {
  const cleaned = String(raw || 'unknown')
    .replace(/^BD\/?/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return (cleaned || 'unknown').slice(0, 120);
};

const getPresenceDocId = (rawBdNo: string): string => {
  const cleanBd = sanitizeDocId(rawBdNo);
  const prefix = getOfficeFirestoreDocPrefix();
  return prefix ? `${prefix}${cleanBd}` : cleanBd;
};

const isPresenceDocForActiveOffice = (docId: string): boolean => {
  const prefix = getOfficeFirestoreDocPrefix();
  if (prefix) {
    return docId.startsWith(prefix);
  }
  return !docId.startsWith('off_');
};

const isMasterProtectedBdOrRole = (bdNo?: string | null, role?: string | null): boolean => {
  if (role === 'master_owner') return true;
  const digits = String(bdNo || '').replace(/\D/g, '');
  return digits === '48456';
};

let cachedPresenceOfficeCode: string = getActiveOfficeCode();
let cachedActiveUsers: UserPresence[] = (() => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getPresenceStorageKey());
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
})();

const syncCachedPresenceOffice = () => {
  const currentCode = getActiveOfficeCode();
  if (cachedPresenceOfficeCode !== currentCode) {
    cachedPresenceOfficeCode = currentCode;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(getPresenceStorageKey()) : null;
      cachedActiveUsers = raw ? JSON.parse(raw) : [];
    } catch {
      cachedActiveUsers = [];
    }
    lastBroadcastCount = -1;
    lastPresencePollAt = 0;
    lastLoginHistoryPollAt = 0;
  }
};

let currentLoggedBdNo: string | null = null;
let lastBroadcastCount: number = -1;
let firestorePresenceUnsub: (() => void) | null = null;
let activePresenceSubscribers = 0;
let lastPresenceWriteAt = 0;
let lastPresencePage = '';
let firestoreLoginHistoryUnsub: (() => void) | null = null;
let activeHistorySubscribers = 0;
let heartbeatTimer: any = null;
let cleanupTimer: any = null;

const PRESENCE_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PRESENCE_WRITE_THROTTLE_MS = 12 * 60 * 1000; // 12 minutes min between passive heartbeat writes
const PRESENCE_POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between background polls
const REALTIME_HISTORY_POLL_MS = 4000; // 4 seconds realtime refresh while Login History view is open
let lastPresencePollAt = 0;
let lastLoginHistoryPollAt = 0;

function filterRecentlyOnlineUsers(list: UserPresence[]): UserPresence[] {
  const now = Date.now();
  return (list || []).filter((u) => {
    if (!u || !u.bdNo) return false;
    if (isMasterProtectedBdOrRole(u.bdNo, u.role)) return false;
    if (u.status === 'offline') return false;
    const t = u.lastActive ? Date.parse(u.lastActive) : 0;
    if (!t || isNaN(t)) return false;
    return now - t <= ACTIVE_WINDOW_MS;
  });
}

function broadcastPresence(list: UserPresence[]) {
  syncCachedPresenceOffice();
  const onlineList = filterRecentlyOnlineUsers(list);
  cachedActiveUsers = onlineList;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getPresenceStorageKey(), JSON.stringify(onlineList));
    } catch {}
    window.dispatchEvent(new CustomEvent('baf_presence_updated', { detail: onlineList }));

    const uniqueOnlineCount = new Set(onlineList.map((u) => sanitizeDocId(u.bdNo).toLowerCase())).size;
    if (uniqueOnlineCount !== lastBroadcastCount) {
      lastBroadcastCount = uniqueOnlineCount;
      window.dispatchEvent(
        new CustomEvent('baf_active_users_changed', {
          detail: { count: uniqueOnlineCount, users: onlineList },
        })
      );
    }
  }
}

export function getActiveUsersCount(): number {
  syncCachedPresenceOffice();
  const online = filterRecentlyOnlineUsers(cachedActiveUsers);
  const uniqueIds = new Set(online.map((u) => sanitizeDocId(u.bdNo).toLowerCase()));
  return uniqueIds.size;
}

export function isMultiUserMode(): boolean {
  return getActiveUsersCount() >= 2;
}

export async function pollPresenceFromCloudOnce(force: boolean = false) {
  syncCachedPresenceOffice();
  if (typeof window === 'undefined') return;
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (!force && now - lastPresencePollAt < 5 * 60 * 1000 && cachedActiveUsers.length > 0) return;

  try {
    lastPresencePollAt = now;
    const activeCodeBefore = getActiveOfficeCode();
    const snap = await getDocs(collection(dbLite, 'presence'));
    if (getActiveOfficeCode() !== activeCodeBefore) return;
    const cloudUsers: UserPresence[] = [];
    snap.forEach((docSnap) => {
      if (!isPresenceDocForActiveOffice(docSnap.id)) return;
      const d = docSnap.data() as any;
      if (d && d.bdNo && !isMasterProtectedBdOrRole(d.bdNo, d.role)) {
        cloudUsers.push({
          bdNo: String(d.bdNo),
          sessionId: d.sessionId ? String(d.sessionId) : undefined,
          name: String(d.name || 'User'),
          rank: String(d.rank || ''),
          flightName: String(d.flightName || ''),
          role: d.role ? String(d.role) : 'USER',
          status: d.status === 'offline' ? 'offline' : 'online',
          page: d.page ? String(d.page) : '',
          deviceInfo: d.deviceInfo ? String(d.deviceInfo) : '',
          lastActive: String(d.lastActive || ''),
        });
      }
    });
    broadcastPresence(cloudUsers);
  } catch (err: any) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, err?.message || 'Quota exceeded in presence poll');
      stopPresenceRealtimeSubscription();
    }
  }
}

export const refreshPresenceNow = async (): Promise<UserPresence[]> => {
  await pollPresenceFromCloudOnce(true);
  return filterRecentlyOnlineUsers(cachedActiveUsers);
};

function ensurePresenceRealtimeSubscription() {
  if (typeof window === 'undefined') return;
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (firestorePresenceUnsub) return;

  void pollPresenceFromCloudOnce();
  const pollInterval = setInterval(() => {
    void pollPresenceFromCloudOnce();
  }, PRESENCE_POLL_INTERVAL_MS);

  firestorePresenceUnsub = () => {
    clearInterval(pollInterval);
  };

  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      broadcastPresence(cachedActiveUsers);
    }, 60 * 1000);
  }
}

export function stopPresenceRealtimeSubscription() {
  if (firestorePresenceUnsub) {
    try {
      firestorePresenceUnsub();
    } catch {}
    firestorePresenceUnsub = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

function startPresenceHeartbeat(_bdNo: string) {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (isFirestoreQuotaExceeded()) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (currentLoggedBdNo) {
      updatePresence(currentLoggedBdNo, false, '');
    }
  }, PRESENCE_HEARTBEAT_INTERVAL_MS);
}

export const logUserLogin = async (
  user: Omit<UserPresence, 'lastActive' | 'status' | 'deviceInfo'>
) => {
  try {
    syncCachedPresenceOffice();
    if (isMasterProtectedBdOrRole(user.bdNo, user.role)) return;
    const isMobile = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mobile');
    const cleanBd = sanitizeDocId(user.bdNo);
    currentLoggedBdNo = cleanBd;
    const nowIso = new Date().toISOString();

    const newPresence: UserPresence = {
      bdNo: cleanBd,
      sessionId: CLIENT_SESSION_ID,
      name: String(user.name || 'User').slice(0, 200),
      rank: String(user.rank || '').slice(0, 64),
      flightName: String(user.flightName || '').slice(0, 64),
      role: String(user.role || 'USER').slice(0, 32),
      lastActive: nowIso,
      status: 'online',
      page: 'Portal',
      deviceInfo: isMobile ? 'Mobile App' : 'Web Portal',
    };

    const existing = filterRecentlyOnlineUsers(cachedActiveUsers);
    const updated = [newPresence, ...existing.filter((p) => sanitizeDocId(p.bdNo) !== cleanBd)];
    broadcastPresence(updated);

    startPresenceHeartbeat(cleanBd);
    lastPresenceWriteAt = Date.now();
    lastPresencePage = newPresence.page || 'Portal';

    if (isFirebaseConfigured && dbLite && !isFirestoreQuotaExceeded()) {
      try {
        const presenceDocId = getPresenceDocId(cleanBd);
        await setDoc(doc(dbLite, 'presence', presenceDocId), {
          bdNo: newPresence.bdNo,
          sessionId: CLIENT_SESSION_ID,
          name: newPresence.name,
          rank: newPresence.rank,
          flightName: newPresence.flightName,
          role: newPresence.role,
          status: 'online',
          page: newPresence.page,
          deviceInfo: newPresence.deviceInfo,
          lastActive: nowIso,
        });
      } catch (fbErr) {
        if (isQuotaExceededError(fbErr)) {
          setFirestoreQuotaExceeded(true, (fbErr as any)?.message);
        }
      }
    }
  } catch (err) {
    console.error('Failed to log presence:', err);
  }
};

// Call periodically to keep last active fresh OR on logout / close
export const updatePresence = async (
  bdNo: string,
  isLogout: boolean = false,
  activity: string = ''
) => {
  try {
    syncCachedPresenceOffice();
    const cleanBd = sanitizeDocId(bdNo);
    if (!cleanBd || cleanBd === 'unknown' || isMasterProtectedBdOrRole(cleanBd)) return;
    const nowIso = new Date().toISOString();

    const existing = [...cachedActiveUsers];
    const idx = existing.findIndex((p) => sanitizeDocId(p.bdNo) === cleanBd);
    let targetRecord: UserPresence | null = idx !== -1 ? { ...existing[idx] } : null;

    if (isLogout) {
      if (idx !== -1) existing.splice(idx, 1);
      if (currentLoggedBdNo === cleanBd) {
        currentLoggedBdNo = null;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }
      broadcastPresence(existing);
    } else if (targetRecord) {
      targetRecord.lastActive = nowIso;
      targetRecord.status = 'online';
      if (activity) targetRecord.page = String(activity).slice(0, 128);
      existing[idx] = targetRecord;
      broadcastPresence(existing);
    }

    if (isFirebaseConfigured && dbLite && !isFirestoreQuotaExceeded()) {
      const nextPage = String(activity || targetRecord?.page || 'Portal').slice(0, 128);
      const nowMs = Date.now();
      const shouldSkipWrite =
        !isLogout &&
        nowMs - lastPresenceWriteAt < PRESENCE_WRITE_THROTTLE_MS &&
        (!activity || nextPage === lastPresencePage);

      if (!shouldSkipWrite) {
        lastPresenceWriteAt = nowMs;
        lastPresencePage = nextPage;
        try {
          const presenceDocId = getPresenceDocId(cleanBd);
          await setDoc(doc(dbLite, 'presence', presenceDocId), {
            bdNo: cleanBd,
            sessionId: CLIENT_SESSION_ID,
            name: String(targetRecord?.name || 'User').slice(0, 200),
            rank: String(targetRecord?.rank || '').slice(0, 64),
            flightName: String(targetRecord?.flightName || '').slice(0, 64),
            role: String(targetRecord?.role || 'USER').slice(0, 32),
            status: isLogout ? 'offline' : 'online',
            page: nextPage,
            deviceInfo: String(targetRecord?.deviceInfo || 'Web Portal').slice(0, 128),
            lastActive: nowIso,
          });
        } catch (fbErr) {
          if (isQuotaExceededError(fbErr)) {
            setFirestoreQuotaExceeded(true, (fbErr as any)?.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to update presence:', err);
  }
};

export const subscribeToActiveUsers = (callback: (users: any[]) => void) => {
  syncCachedPresenceOffice();
  activePresenceSubscribers += 1;
  const handleLocal = (e: any) => callback(filterRecentlyOnlineUsers(e.detail || cachedActiveUsers));
  window.addEventListener('baf_presence_updated', handleLocal);

  if (isFirebaseConfigured && db && !isFirestoreQuotaExceeded()) {
    ensurePresenceRealtimeSubscription();
  }

  callback(filterRecentlyOnlineUsers(cachedActiveUsers));

  return () => {
    window.removeEventListener('baf_presence_updated', handleLocal);
    activePresenceSubscribers = Math.max(0, activePresenceSubscribers - 1);
    if (activePresenceSubscribers === 0) {
      stopPresenceRealtimeSubscription();
    }
  };
};

const filterLogsForActiveOffice = (list: any[]): any[] => {
  const activeCode = getActiveOfficeCode();
  const isDefault155 = isDefault155UasuOffice();
  return (list || []).filter((item: any) => {
    if (!item || !item.bdNo) return false;
    if (isMasterProtectedBdOrRole(item.bdNo, item.role)) return false;
    const logOffice = String(item.officeCode || '').trim();
    if (logOffice) {
      return logOffice === activeCode;
    }
    return isDefault155;
  });
};

const getLocalLoginLogs = (): any[] => {
  try {
    const raw = localStorage.getItem(getLoginHistoryStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? filterLogsForActiveOffice(parsed) : [];
    }
  } catch {}
  return [];
};

const mergeCloudLoginLogs = (cloudLogs: any[]): any[] => {
  const local = getLocalLoginLogs();
  const scopedCloud = filterLogsForActiveOffice(cloudLogs);
  const map = new Map<string, any>();
  [...scopedCloud, ...local].forEach((item: any) => {
    if (item && item.id && !map.has(item.id)) {
      map.set(item.id, item);
    }
  });
  const merged = Array.from(map.values())
    .sort((a: any, b: any) => {
      const timeA = new Date(a.timestamp || 0).getTime();
      const timeB = new Date(b.timestamp || 0).getTime();
      return timeB - timeA;
    })
    .slice(0, 100);
  try {
    localStorage.setItem(getLoginHistoryStorageKey(), JSON.stringify(merged));
  } catch {}
  window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: merged }));
  return merged;
};

const extractCloudLogsFromDocData = (data: any): any[] | null => {
  if (!data || data.value === undefined) return null;
  if (Array.isArray(data.value)) return data.value;
  if (typeof data.value === 'string') {
    try {
      const parsed = JSON.parse(data.value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
};

function stopLoginHistoryRealtimeSubscription() {
  if (firestoreLoginHistoryUnsub) {
    try {
      firestoreLoginHistoryUnsub();
    } catch {}
    firestoreLoginHistoryUnsub = null;
  }
}

function ensureLoginHistoryRealtimeSubscription() {
  if (typeof window === 'undefined') return;
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (firestoreLoginHistoryUnsub) return;

  void refreshLoginHistoryFromCloud(true);
  void pollPresenceFromCloudOnce(true);

  const pollInterval = setInterval(() => {
    if (isFirestoreQuotaExceeded()) {
      stopLoginHistoryRealtimeSubscription();
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    void refreshLoginHistoryFromCloud(true);
    void pollPresenceFromCloudOnce(true);
  }, REALTIME_HISTORY_POLL_MS);

  firestoreLoginHistoryUnsub = () => {
    clearInterval(pollInterval);
  };
}

export const refreshLoginHistoryFromCloud = async (force: boolean = false): Promise<any[]> => {
  const local = getLocalLoginLogs();
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) {
    return local;
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return local;
  }
  const now = Date.now();
  if (!force && now - lastLoginHistoryPollAt < 60 * 1000 && local.length > 0) {
    return local;
  }
  lastLoginHistoryPollAt = now;
  const activeCodeBefore = getActiveOfficeCode();
  const docId = getLoginHistoryDocId();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snap = await Promise.race([
      getDoc(doc(dbLite, 'app_settings', docId)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Login history fetch timeout')), 6000);
      }),
    ]);
    if (getActiveOfficeCode() !== activeCodeBefore) {
      return getLocalLoginLogs();
    }
    if (snap.exists()) {
      const d = snap.data();
      const cloudLogs = extractCloudLogsFromDocData(d);
      if (cloudLogs) {
        const cloudUpdatedMs = d?.updatedAt ? Date.parse(String(d.updatedAt)) || 0 : 0;
        const newestLocalMs = local.reduce((mx: number, l: any) => Math.max(mx, Date.parse(String(l?.timestamp || 0)) || 0), 0);
        if (cloudLogs.length === 0 && (d?.clearedAt || cloudUpdatedMs >= newestLocalMs)) {
          try {
            localStorage.removeItem(getLoginHistoryStorageKey());
          } catch {}
          window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: [] }));
          return [];
        }
        return mergeCloudLoginLogs(cloudLogs);
      }
    }
  } catch (err) {
    if (isQuotaExceededError(err)) {
      setFirestoreQuotaExceeded(true, (err as any)?.message);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return local;
};

export const subscribeToLoginHistory = (callback: (logs: any[]) => void) => {
  activeHistorySubscribers += 1;

  const handleLocal = (e: any) => {
    if (e.detail && Array.isArray(e.detail)) {
      callback(filterLogsForActiveOffice(e.detail));
    } else {
      callback(getLocalLoginLogs());
    }
  };

  window.addEventListener('baf_login_history_updated', handleLocal);

  const initialLogs = getLocalLoginLogs();
  callback(initialLogs);

  // Realtime cloud polling while Login History UI subscriber is active
  if (isFirebaseConfigured && db && !isFirestoreQuotaExceeded()) {
    ensureLoginHistoryRealtimeSubscription();
  }

  return () => {
    window.removeEventListener('baf_login_history_updated', handleLocal);
    activeHistorySubscribers = Math.max(0, activeHistorySubscribers - 1);
    if (activeHistorySubscribers === 0) {
      stopLoginHistoryRealtimeSubscription();
    }
  };
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (isFirestoreQuotaExceeded()) return;
    if (activePresenceSubscribers > 0) {
      ensurePresenceRealtimeSubscription();
    }
    if (activeHistorySubscribers > 0) {
      ensureLoginHistoryRealtimeSubscription();
    }
  });

  window.addEventListener('baf_office_config_changed', () => {
    syncCachedPresenceOffice();
    broadcastPresence(cachedActiveUsers);
    window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: getLocalLoginLogs() }));
    if (activePresenceSubscribers > 0) {
      void pollPresenceFromCloudOnce(true);
    }
    if (activeHistorySubscribers > 0) {
      void refreshLoginHistoryFromCloud(true);
    }
  });

  window.addEventListener('storage', (e: StorageEvent) => {
    if (!e.key) return;
    if (e.key === getPresenceStorageKey()) {
      try {
        const parsed = e.newValue ? JSON.parse(e.newValue) : [];
        cachedActiveUsers = filterRecentlyOnlineUsers(Array.isArray(parsed) ? parsed : []);
        window.dispatchEvent(new CustomEvent('baf_presence_updated', { detail: cachedActiveUsers }));
      } catch {}
    } else if (e.key === getLoginHistoryStorageKey()) {
      window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: getLocalLoginLogs() }));
    }
  });

  window.addEventListener('baf_firebase_quota_status', (e: any) => {
    if (e?.detail?.exceeded) {
      stopPresenceRealtimeSubscription();
      stopLoginHistoryRealtimeSubscription();
    } else {
      if (activePresenceSubscribers > 0) {
        ensurePresenceRealtimeSubscription();
      }
      if (activeHistorySubscribers > 0) {
        ensureLoginHistoryRealtimeSubscription();
      }
    }
  });
}

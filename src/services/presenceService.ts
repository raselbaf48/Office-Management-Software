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

const PRESENCE_STORAGE_KEY = 'baf_presence';
const ACTIVE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes considered online

const sanitizeDocId = (raw: string): string => {
  const cleaned = String(raw || 'unknown')
    .replace(/^BD\/?/i, '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return (cleaned || 'unknown').slice(0, 120);
};

let cachedActiveUsers: UserPresence[] = (() => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRESENCE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
})();

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
const PRESENCE_POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between full presence collection polls
let lastPresencePollAt = 0;
let lastLoginHistoryPollAt = 0;

function filterRecentlyOnlineUsers(list: UserPresence[]): UserPresence[] {
  const now = Date.now();
  return (list || []).filter((u) => {
    if (!u || !u.bdNo) return false;
    if (u.status === 'offline') return false;
    const t = u.lastActive ? Date.parse(u.lastActive) : 0;
    if (!t || isNaN(t)) return false;
    return now - t <= ACTIVE_WINDOW_MS;
  });
}

function broadcastPresence(list: UserPresence[]) {
  const onlineList = filterRecentlyOnlineUsers(list);
  cachedActiveUsers = onlineList;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify(onlineList));
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
  const online = filterRecentlyOnlineUsers(cachedActiveUsers);
  const uniqueIds = new Set(online.map((u) => sanitizeDocId(u.bdNo).toLowerCase()));
  return uniqueIds.size;
}

export function isMultiUserMode(): boolean {
  return getActiveUsersCount() >= 2;
}

async function pollPresenceFromCloudOnce(force: boolean = false) {
  if (typeof window === 'undefined') return;
  if (!isFirebaseConfigured || !dbLite || isFirestoreQuotaExceeded()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  const now = Date.now();
  if (!force && now - lastPresencePollAt < 5 * 60 * 1000 && cachedActiveUsers.length > 0) return;

  try {
    lastPresencePollAt = now;
    const snap = await getDocs(collection(dbLite, 'presence'));
    const cloudUsers: UserPresence[] = [];
    snap.forEach((docSnap) => {
      const d = docSnap.data() as any;
      if (d && d.bdNo) {
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
        await setDoc(doc(dbLite, 'presence', cleanBd), {
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
    const cleanBd = sanitizeDocId(bdNo);
    if (!cleanBd || cleanBd === 'unknown') return;
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
          await setDoc(doc(dbLite, 'presence', cleanBd), {
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
  activePresenceSubscribers += 1;
  const handleLocal = (e: any) => callback(e.detail || []);
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

const getLocalLoginLogs = (): any[] => {
  try {
    const raw = localStorage.getItem('baf_user_login_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {}
  return [];
};

const mergeCloudLoginLogs = (cloudLogs: any[]): any[] => {
  const local = getLocalLoginLogs();
  const map = new Map<string, any>();
  [...cloudLogs, ...local].forEach((item: any) => {
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
    localStorage.setItem('baf_user_login_history', JSON.stringify(merged));
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

  void refreshLoginHistoryFromCloud();
  const pollInterval = setInterval(() => {
    if (isFirestoreQuotaExceeded()) {
      stopLoginHistoryRealtimeSubscription();
      return;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    void refreshLoginHistoryFromCloud();
  }, PRESENCE_POLL_INTERVAL_MS);

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const snap = await Promise.race([
      getDoc(doc(dbLite, 'app_settings', 'baf_user_login_history')),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Login history fetch timeout')), 6000);
      }),
    ]);
    if (snap.exists()) {
      const d = snap.data();
      const cloudLogs = extractCloudLogsFromDocData(d);
      if (cloudLogs) {
        const cloudUpdatedMs = d?.updatedAt ? Date.parse(String(d.updatedAt)) || 0 : 0;
        const newestLocalMs = local.reduce((mx: number, l: any) => Math.max(mx, Date.parse(String(l?.timestamp || 0)) || 0), 0);
        if (cloudLogs.length === 0 && (d?.clearedAt || cloudUpdatedMs >= newestLocalMs)) {
          try {
            localStorage.removeItem('baf_user_login_history');
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
      callback(e.detail);
    } else {
      callback(getLocalLoginLogs());
    }
  };

  window.addEventListener('baf_login_history_updated', handleLocal);

  const initialLogs = getLocalLoginLogs();
  callback(initialLogs);

  // Attach real-time Firestore snapshot listener ONLY while UI subscriber is active
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

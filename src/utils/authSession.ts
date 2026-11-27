import { doc, getDoc, setDoc } from 'firebase/firestore/lite';
import {
  dbLite as db,
  isFirebaseConfigured,
  isFirestoreQuotaExceeded,
  isQuotaExceededError,
  setFirestoreQuotaExceeded,
  MASTER_USER_ID,
  MASTER_USER_PIN,
  getMasterCredentials,
  getMasterUserId,
  getMasterUserPin,
  getMasterDisplayName,
  getMasterDisplayRank,
  isOfficeDisabled,
  getActiveOfficeCode,
  getOfficeScopedStorageKey,
  getOfficeFirestoreDocPrefix,
  isDefault155UasuOffice,
  registerUsersInGlobalOfficeDirectory,
  findOfficeByUserId,
  activateMatchedOfficeForUser,
} from '../firebase';
import { fetchUserProfilesFromFirebase, pushUserProfilesToFirebase } from '../services/firebaseFirestoreService';
import { localDb } from '../services/localDatabase';
import { logUserLogin, updatePresence } from '../services/presenceService';
import { recordFirestoreQuotaUsage } from './firebaseQuotaTracker';
import { Airman, DetailedUserLogin, UserLoginRole, UserLoginStatus } from '../types';

export interface UserLoginLog {
  id: string;
  bdNo: string;
  rank: string;
  name: string;
  flightName: string;
  timestamp: string;
  timeFormatted: string;
  role?: string;
  deviceInfo: string;
  officeCode?: string;
}

export interface UserSession {
  userId?: string;
  airmanId: string;
  bdNo: string;
  rank: string;
  name: string;
  flightName?: string;
  trade?: string;
  loginTimestamp: string;
  assignedRole?: string;
  systemRole?: string;
  adminPass?: string;
  ownerPass?: string;
  isProtected?: boolean;
}

const SESSION_KEY = 'baf_user_session';
const HISTORY_KEY = 'baf_user_login_history';
const DETAILED_USERS_KEY = 'baf_detailed_user_logins';

export function getDetailedUsersStorageKey(): string {
  return getOfficeScopedStorageKey(DETAILED_USERS_KEY);
}

export function getLoginHistoryStorageKey(): string {
  return getOfficeScopedStorageKey(HISTORY_KEY);
}

export const MASTER_OWNER_USER_ID = MASTER_USER_ID;

export function isMasterProtectedUser(
  idOrBd?: string | null,
  role?: string | null,
  isProtected?: boolean
): boolean {
  if (isProtected === true) return true;
  if (role === 'master_owner') return true;
  if (!idOrBd) return false;
  const clean = String(idOrBd).replace(/^BD\/?/i, '').replace(/\s+/g, '').trim().toLowerCase();
  const digits = clean.replace(/\D/g, '');
  const currentMasterId = getMasterUserId().toLowerCase();
  return (
    clean === '48456' ||
    digits === '48456' ||
    clean === currentMasterId ||
    digits === currentMasterId ||
    clean === 'user-login-48456' ||
    clean === 'airman-48456'
  );
}

export function isMasterPinMatch(providedPin: string, storedPin?: string): boolean {
  const cleanProvided = String(providedPin || '').trim();
  if (!cleanProvided) return false;
  const creds = getMasterCredentials();
  if (creds.isCustomPin) {
    return cleanProvided === creds.masterPin;
  }
  if (cleanProvided === creds.masterPin) return true;
  if (cleanProvided === MASTER_USER_PIN && MASTER_USER_PIN !== 'YOUR_MASTER_PIN') return true;
  if (storedPin && cleanProvided === String(storedPin).trim()) return true;
  if (cleanProvided === '48456' || cleanProvided === '1124') {
    return true;
  }
  return false;
}

export function buildMasterOwnerUserRecord(): DetailedUserLogin {
  const staticIso = '2026-01-01T00:00:00.000Z';
  const activeMasterId = getMasterUserId();
  const activeMasterPin = getMasterUserPin();
  const activeMasterName = getMasterDisplayName();
  const activeMasterRank = getMasterDisplayRank();
  return {
    id: 'user-login-48456',
    userId: activeMasterId,
    airmanId: 'airman-48456',
    bdNo: activeMasterId,
    rank: activeMasterRank,
    name: activeMasterName,
    flightName: 'Admin',
    trade: 'System Control',
    role: 'master_owner',
    pin: activeMasterPin,
    password: activeMasterPin,
    adminPass: '1124',
    ownerPass: '1124',
    isProtected: true,
    status: 'ACTIVE',
    detailOrder: 'MASTER-OWNER-PROTECTED',
    detailedAt: staticIso,
    detailedBy: 'System Auto-Provision',
    remarks: 'Protected System Master Owner Account',
    updatedAt: staticIso,
  };
}

// In-memory cache of login history (strictly scoped by active office)
let cachedLoginHistory: UserLoginLog[] = [];
let cachedLoginHistoryOfficeCode: string = '';

const isLoginLogForActiveOffice = (log: Partial<UserLoginLog> | null | undefined): boolean => {
  if (!log || !log.bdNo) return false;
  if (isMasterProtectedUser(log.bdNo, log.role)) return false;
  const activeCode = getActiveOfficeCode();
  const isDefault155 = isDefault155UasuOffice();
  const logOffice = String(log.officeCode || '').trim();
  if (logOffice) {
    return logOffice === activeCode;
  }
  return isDefault155;
};

if (typeof window !== 'undefined') {
  window.addEventListener('baf_office_config_changed', () => {
    cachedLoginHistory = [];
    cachedLoginHistoryOfficeCode = '';
  });
}

/**
 * Format timestamp nicely
 */
export const formatLogTime = (isoString: string): string => {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('en-GB', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return isoString;
  }
};

/**
 * Get current active user session (Client device local session)
 */
export const getCurrentUserSession = (): UserSession | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as UserSession;
    const cleanBd = (session.bdNo || session.userId || '').replace(/^BD\/?/i, '').trim();
    const activeMasterId = getMasterUserId();
    if (cleanBd === '48456' || cleanBd === activeMasterId || session.systemRole === 'master_owner') {
      if (session.assignedRole !== 'OWNER' && session.assignedRole !== 'master_owner') {
        session.assignedRole = 'OWNER';
      }
      session.systemRole = 'master_owner';
      session.isProtected = true;
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
    return session;
  } catch {
    return null;
  }
};

export const getDetailedUsers = (nominalAirmen: Airman[] = []): DetailedUserLogin[] => {
  const isDefault155 = isDefault155UasuOffice();
  const effectiveAirmen: Airman[] = isDefault155
    ? nominalAirmen
    : (() => {
        try {
          return localDb.getAirmen() || [];
        } catch {
          return [];
        }
      })();

  const validOfficeBdSet = new Set<string>(
    effectiveAirmen
      .map((a) => (a.bdNo || '').replace(/^BD\/?/i, '').trim().toLowerCase())
      .filter(Boolean)
  );

  let parsed: DetailedUserLogin[] = [];
  const storageKey = getDetailedUsersStorageKey();
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length > 0) {
        parsed = p.map((u) => ({
          ...u,
          status:
            u.status === 'SUSPENDED' &&
            effectiveAirmen.find(
              (a) => (a.bdNo || '').replace(/^BD\/?/i, '').trim().toLowerCase() === (u.bdNo || '').toLowerCase()
            )?.active !== false
              ? 'ACTIVE'
              : u.status,
        }));
      }
    }
  } catch (e) {
    console.warn('Failed to parse detailed user logins:', e);
  }

  let modified = false;

  // Remove legacy obsolete accounts and any leaked 155 UASU auto-synced users in custom offices
  const beforeCount = parsed.length;
  parsed = parsed.filter((u) => {
    if (u.bdNo === '53539919' || u.bdNo === 'deleted_admin') return false;
    if (!isDefault155) {
      const cleanBd = String(u.bdNo || u.userId || '').replace(/^BD\/?/i, '').trim().toLowerCase();
      if (isMasterProtectedUser(cleanBd, u.role, u.isProtected)) return true;
      if (String(u.id || '').startsWith('office-admin-')) return true;
      const isAutoSynced =
        u.remarks === 'Auto-synced from Nominal Roll' ||
        u.detailedBy === 'System Auto Sync';
      if (isAutoSynced && !validOfficeBdSet.has(cleanBd)) {
        return false;
      }
    }
    return true;
  });
  if (parsed.length !== beforeCount) {
    modified = true;
  }

  // Enforce protected Master Owner record
  const masterRecord = buildMasterOwnerUserRecord();
  const ownerIdx = parsed.findIndex((u) =>
    isMasterProtectedUser(u.userId || u.bdNo, u.role, u.isProtected)
  );
  if (ownerIdx >= 0) {
    const curr = parsed[ownerIdx];
    if (
      curr.role !== 'master_owner' ||
      curr.name !== masterRecord.name ||
      curr.rank !== masterRecord.rank ||
      curr.isProtected !== true ||
      curr.userId !== masterRecord.userId
    ) {
      parsed[ownerIdx] = {
        ...curr,
        ...masterRecord,
        pin: curr.pin && curr.pin !== '48456' ? curr.pin : masterRecord.pin,
        password: curr.password && curr.password !== '48456' ? curr.password : masterRecord.password,
      };
      modified = true;
    }
  } else {
    parsed.push(masterRecord);
    modified = true;
  }

  // Auto-sync Nominal Roll users into User Management (excluding 48456 so 48456 stays hidden from manpower)
  if (effectiveAirmen && effectiveAirmen.length > 0) {
    effectiveAirmen.forEach((a) => {
      const cleanBd = (a.bdNo || '').replace(/^BD\/?/i, '').trim();
      if (!cleanBd || isMasterProtectedUser(cleanBd, a.role, a.isProtected)) return;

      const idx = parsed.findIndex((u) => (u.bdNo || '').toLowerCase() === cleanBd.toLowerCase());
      if (idx === -1) {
        const syncedRole =
          (a as any).role === 'SUPER_ADMIN' || (a as any).role === 'ADMIN'
            ? (a as any).role
            : 'USER';
        parsed.push({
          id: `user-login-${cleanBd}`,
          userId: cleanBd,
          airmanId: a.id,
          bdNo: cleanBd,
          rank: a.rank,
          name: a.name,
          mobileNo: a.mobileNo,
          flightName: a.flightName,
          trade: a.trade,
          role: syncedRole,
          pin: cleanBd,
          password: cleanBd,
          adminPass: syncedRole === 'USER' ? '' : '1124',
          status: a.active === false ? 'SUSPENDED' : 'ACTIVE',
          detailOrder: 'DO-OFFICE/GEN/2026',
          detailedAt: '2026-01-01T00:00:00.000Z',
          detailedBy: 'System Auto Sync',
          remarks: 'Auto-synced from Nominal Roll',
        });
        modified = true;
      } else {
        let detailModified = false;
        if (!a.active && parsed[idx].status === 'ACTIVE') {
          parsed[idx].status = 'SUSPENDED';
          detailModified = true;
        } else if (a.active && parsed[idx].status === 'SUSPENDED') {
          parsed[idx].status = 'ACTIVE';
          detailModified = true;
        }
        if (detailModified) modified = true;
      }
    });
  }

  if (modified) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(parsed));
    } catch {}
  }

  return parsed.length > 0 ? parsed : [masterRecord];
};

export async function provisionMasterOwnerInOffice(nominalAirmen: Airman[] = []): Promise<DetailedUserLogin> {
  const masterUser = buildMasterOwnerUserRecord();
  const users = getDetailedUsers(nominalAirmen);
  const idx = users.findIndex((u) =>
    isMasterProtectedUser(u.userId || u.bdNo, u.role, u.isProtected)
  );
  if (idx >= 0) {
    const existing = users[idx];
    if (
      existing.role === 'master_owner' &&
      existing.pin === masterUser.pin &&
      existing.userId === masterUser.userId &&
      existing.name === masterUser.name &&
      existing.rank === masterUser.rank
    ) {
      return existing;
    }
    users[idx] = { ...existing, ...masterUser };
  } else {
    users.unshift(masterUser);
  }
  saveDetailedUsers(users, false);
  return masterUser;
}

export function loginAsMasterOwnerSession(): UserSession {
  const masterUser = buildMasterOwnerUserRecord();
  const masterRank = getMasterDisplayRank();
  const masterName = getMasterDisplayName();
  const masterAirman: Airman = {
    id: 'airman-48456',
    serNo: 0,
    code: 'MST-OWN',
    bdNo: getMasterUserId(),
    rank: masterRank as any,
    name: masterName,
    fullName: masterName,
    trade: 'Master Control',
    addressBlock: 'HQ',
    mobileNo: '',
    flightName: 'Admin',
    remarks: 'Protected Master Owner',
    active: false,
    isProtected: true,
    role: 'master_owner',
  };
  sessionStorage.setItem('baf_user_role', 'OWNER');
  return setUserSession(masterAirman, 'OWNER', masterUser);
}

/**
 * Save detailed user logins
 */
export const saveDetailedUsers = (users: DetailedUserLogin[], syncToCloud: boolean = true): void => {
  try {
    const storageKey = getDetailedUsersStorageKey();
    localStorage.setItem(storageKey, JSON.stringify(users));
    registerUsersInGlobalOfficeDirectory(users);
    window.dispatchEvent(new CustomEvent('baf_detailed_users_changed', { detail: users }));

    if (syncToCloud) {
      (localDb as any).db.detailedUsers = users;
      localDb.forceSave();
    }
  } catch (e) {
    console.error('Failed to save detailed user logins:', e);
  }
};

/**
 * Detail an individual airman for user login
 */
export const detailAirmanForLogin = (
  airman: Airman,
  role: UserLoginRole = 'USER',
  status: UserLoginStatus = 'ACTIVE',
  detailOrder: string = '',
  remarks: string = ''
): DetailedUserLogin => {
  const current = getDetailedUsers();
  const cleanBd = (airman.bdNo || "").replace(/^BD\/?/i, '').trim();

  const existingIndex = current.findIndex(
    (u) => u.bdNo.toLowerCase() === cleanBd.toLowerCase() || (u.airmanId && u.airmanId === airman.id)
  );

  const newEntry: DetailedUserLogin = {
    id: existingIndex >= 0 ? current[existingIndex].id : `user-login-${cleanBd}-${Date.now()}`,
    airmanId: airman.id,
    bdNo: cleanBd,
    rank: airman.rank,
    name: airman.name,
    flightName: airman.flightName,
    trade: airman.trade,
    role,
    status,
    detailOrder: detailOrder.trim() || `DO-155/DTL/${cleanBd}`,
    detailedAt: new Date().toISOString(),
    detailedBy: '155 UASU Admin',
    remarks: remarks.trim() || `Detailed from Nominal Roll (${airman.rank} ${airman.name})`,
    lastLoginAt: existingIndex >= 0 ? current[existingIndex].lastLoginAt : undefined,
  };

  if (existingIndex >= 0) {
    current[existingIndex] = newEntry;
  } else {
    current.unshift(newEntry);
  }

  saveDetailedUsers(current);
  return newEntry;
};

/**
 * Batch detail all airmen from nominal roll
 */
export const batchDetailAllAirmen = (airmen: Airman[]): DetailedUserLogin[] => {
  const current = getDetailedUsers();
  const updatedList: DetailedUserLogin[] = [...current];

  airmen.forEach((airman) => {
    const cleanBd = (airman.bdNo || "").replace(/^BD\/?/i, '').trim();
    const idx = updatedList.findIndex((u) => u.bdNo.toLowerCase() === cleanBd.toLowerCase());
    const isPrimary = cleanBd === '48456';

    const entry: DetailedUserLogin = {
      id: idx >= 0 ? updatedList[idx].id : `user-login-${cleanBd}`,
      airmanId: airman.id,
      bdNo: cleanBd,
      rank: airman.rank,
      name: airman.name,
      flightName: airman.flightName,
      trade: airman.trade,
      role: idx >= 0 ? updatedList[idx].role : (isPrimary ? 'OWNER' : 'USER'),
      password: idx >= 0 && updatedList[idx].password ? updatedList[idx].password : cleanBd,
      status: idx >= 0 ? updatedList[idx].status : 'ACTIVE',
      detailOrder: idx >= 0 && updatedList[idx].detailOrder ? updatedList[idx].detailOrder : `DO-155/NR/${cleanBd}`,
      detailedAt: idx >= 0 ? updatedList[idx].detailedAt : new Date().toISOString(),
      detailedBy: '155 UASU HQ Batch Detail',
      remarks: idx >= 0 && updatedList[idx].remarks ? updatedList[idx].remarks : `Detailed from Nominal Roll (${airman.flightName} Flight)`,
      lastLoginAt: idx >= 0 ? updatedList[idx].lastLoginAt : undefined,
    };

    if (idx >= 0) {
      updatedList[idx] = entry;
    } else {
      updatedList.push(entry);
    }
  });

  saveDetailedUsers(updatedList);
  return updatedList;
};

/**
 * Remove or Revoke login access for a BD number
 */
export const removeDetailedUser = (bdNo: string): void => {
  const clean = (bdNo || "").replace(/^BD\/?/i, '').trim().toLowerCase();
  if (isMasterProtectedUser(clean)) return; // Prevent deleting 48456
  const current = getDetailedUsers();
  const filtered = current.filter((u) => !isMasterProtectedUser(u.bdNo, u.role, u.isProtected) ? u.bdNo.toLowerCase() !== clean : true);
  saveDetailedUsers(filtered);
};

/**
 * Toggle active / suspended / disabled status
 */
export const toggleUserLoginStatus = (bdNo: string, newStatus: UserLoginStatus): DetailedUserLogin | null => {
  const clean = (bdNo || "").replace(/^BD\/?/i, '').trim().toLowerCase();
  if (isMasterProtectedUser(clean)) return null; // Prevent suspending/disabling 48456
  const current = getDetailedUsers();
  const idx = current.findIndex((u) => u.bdNo.toLowerCase() === clean);
  if (idx === -1) return null;

  current[idx].status = newStatus;
  saveDetailedUsers(current);
  return current[idx];
};

/**
 * Validate User Login Attempt
 */
export const validateUserLogin = async (
  bdInput: string,
  passwordInput: string,
  nominalAirmen: Airman[]
): Promise<{ success: boolean; airman?: Airman; detailedUser?: DetailedUserLogin; message: string }> => {
  const cleanInput = (bdInput || "").trim().replace(/^BD\/?/i, '').replace(/\s+/g, '').toLowerCase();
  const cleanDigits = cleanInput.replace(/\D/g, '');

  if (!cleanInput && !cleanDigits) {
    return { success: false, message: 'Please enter your User ID.' };
  }

  // Special Master Owner Login Check
  const activeMasterId = getMasterUserId().toLowerCase();
  if (cleanInput === activeMasterId || cleanDigits === activeMasterId) {
    const rawProvided = (passwordInput || '').trim();
    if (!rawProvided) {
      return { success: false, message: 'Please enter your PIN.' };
    }
    const detailedList = getDetailedUsers(nominalAirmen);
    const existingMaster = detailedList.find((u) => isMasterProtectedUser(u.userId || u.bdNo, u.role, u.isProtected));
    const storedPin = existingMaster?.pin || existingMaster?.password;

    if (isMasterPinMatch(rawProvided, storedPin)) {
      const masterDetail = buildMasterOwnerUserRecord();
      const masterRank = getMasterDisplayRank();
      const masterName = getMasterDisplayName();
      const masterAirman: Airman = {
        id: 'airman-48456',
        serNo: 0,
        code: 'MST-OWN',
        bdNo: getMasterUserId(),
        rank: masterRank as any,
        name: masterName,
        fullName: masterName,
        trade: 'System Control',
        addressBlock: 'HQ',
        mobileNo: '',
        flightName: 'Admin',
        remarks: 'Protected Master Owner',
        active: false,
        isProtected: true,
        role: 'master_owner',
      };
      return {
        success: true,
        airman: masterAirman,
        detailedUser: masterDetail,
        message: `Access granted for ${masterRank} ${masterName}`,
      };
    } else {
      return {
        success: false,
        message: 'Invalid Master Owner PIN.',
      };
    }
  }

  // 0. Multi-Office Directory Lookup: Match BD No to its Office and switch active workspace automatically
  const globalMatch = findOfficeByUserId(cleanInput, nominalAirmen);
  if (globalMatch && cleanInput !== activeMasterId && cleanDigits !== activeMasterId) {
    if (isOfficeDisabled(globalMatch.officeCode)) {
      return {
        success: false,
        message: `Access Denied: Office "${globalMatch.officeName}" is currently disabled by Master Admin.`,
      };
    }
    const switched = activateMatchedOfficeForUser(globalMatch);
    if (switched) {
      try {
        (localDb as any).switchActiveOfficeWorkspace?.(false);
      } catch {}
    }
  } else if (isOfficeDisabled(getActiveOfficeCode())) {
    return {
      success: false,
      message: 'Access Denied: This Office is currently disabled by Master Admin.',
    };
  }

  // 1. Instant Local Verification (Zero latency check)
  const detailedList = getDetailedUsers(nominalAirmen);
  let matchedDetail = detailedList.find((u) => {
    const uBd = (u.bdNo || '').trim().toLowerCase();
    const uBdClean = uBd.replace(/^BD\/?/i, '').replace(/\s+/g, '');
    const uDigits = uBd.replace(/\D/g, '');
    return uBd === cleanInput || uBdClean === cleanInput || (cleanDigits && uDigits === cleanDigits);
  });

  // Check Local Database airmen if not found yet
  if (!matchedDetail) {
    try {
      const allAirmen = (localDb as any)?.getAirmen ? (localDb as any).getAirmen() : [];
      const aMatch = allAirmen.find((a: any) => {
        const aBd = (a.bdNo || '').trim().toLowerCase();
        const aDigits = aBd.replace(/\D/g, '');
        return aBd === cleanInput || (cleanDigits && aDigits === cleanDigits);
      });
      if (aMatch) {
        const cleanBdNo = (aMatch.bdNo || cleanDigits || cleanInput).replace(/\D/g, '');
        matchedDetail = {
          id: `user-login-${cleanBdNo}`,
          airmanId: aMatch.id,
          bdNo: cleanBdNo,
          rank: aMatch.rank || 'LAC',
          name: aMatch.fullName || aMatch.name || 'Airman',
          fullName: aMatch.fullName || aMatch.name || 'Airman',
          mobileNo: aMatch.mobileNo || '',
          flightName: aMatch.flightName || 'Admin',
          trade: aMatch.trade || 'General',
          role: cleanBdNo === '48456' ? 'master_owner' : 'USER',
          password: cleanBdNo,
          status: 'ACTIVE',
          detailOrder: `DO-155/AIRMEN/${cleanBdNo}`,
          detailedAt: new Date().toISOString(),
          detailedBy: 'Local Database Sync',
          remarks: 'Auto-synced from Local Database Airmen',
        };
        detailedList.push(matchedDetail);
        saveDetailedUsers(detailedList);
      }
    } catch {}
  }

  // Also check globalMatch if the user was registered in the global office directory on another device
  if (!matchedDetail && globalMatch) {
    const cleanBdNo = globalMatch.bdNo;
    matchedDetail = {
      id: `user-login-${cleanBdNo}`,
      userId: cleanBdNo,
      airmanId: `airman-${cleanBdNo}`,
      bdNo: cleanBdNo,
      rank: (globalMatch.rank || 'LAC') as any,
      name: globalMatch.userName || 'Airman',
      fullName: globalMatch.userName || 'Airman',
      flightName: (globalMatch.flightName || 'Admin') as any,
      trade: globalMatch.trade || 'General',
      role: (globalMatch.role || 'USER') as any,
      pin: globalMatch.pin || cleanBdNo,
      password: globalMatch.pin || cleanBdNo,
      status: 'ACTIVE',
      detailOrder: `DO-${globalMatch.officeCode}/${cleanBdNo}`,
      detailedAt: globalMatch.updatedAt || new Date().toISOString(),
      detailedBy: 'Office Directory Sync',
    };
    detailedList.push(matchedDetail);
    saveDetailedUsers(detailedList);
  }

  if (matchedDetail) {
    const rawProvided = (passwordInput || '').trim();
    if (!rawProvided) {
      return { success: false, message: 'Please enter your PIN.' };
    }
    const expectedPassword = (matchedDetail.pin || matchedDetail.password || matchedDetail.bdNo || '').toString().trim();
    const cleanExpectedPassword = expectedPassword.replace(/^BD\/?/i, '').trim();
    const cleanExpectedDigits = expectedPassword.replace(/\D/g, '');
    const adminPass = (matchedDetail.adminPass || '1124').toString().trim();

    // In BAF system: PIN must be manually entered and must match
    const isMatch = 
      rawProvided === expectedPassword ||
      rawProvided.toLowerCase() === expectedPassword.toLowerCase() ||
      rawProvided === cleanExpectedPassword ||
      (cleanDigits && rawProvided === cleanDigits) ||
      (cleanExpectedDigits && rawProvided === cleanExpectedDigits) ||
      rawProvided === adminPass ||
      rawProvided === '1124'; // Universal unit master passcode

    if (isMatch) {
      if (matchedDetail.status === 'DISABLED') {
        return {
          success: false,
          message: 'You are not authorized to access the portal. User ID is disabled. Please contact administrator.',
        };
      }
      if (matchedDetail.status === 'SUSPENDED') {
        return {
          success: false,
          message: 'You are not authorized to access the portal. User ID is temporarily suspended.',
        };
      }

      // Find corresponding airman or construct one
      let airman = nominalAirmen.find(
        (a) => (a.bdNo || "").trim().replace(/^BD\/?/i, '').toLowerCase() === cleanInput || a.id === matchedDetail.airmanId
      );

      if (!airman) {
        airman = {
          id: (matchedDetail.airmanId && matchedDetail.airmanId !== "airman-undefined") ? matchedDetail.airmanId : `airman-${matchedDetail.bdNo && matchedDetail.bdNo !== "undefined" ? matchedDetail.bdNo : Math.random().toString(36).slice(2, 10)}`,
          serNo: 99,
          code: `${matchedDetail.rank}-${matchedDetail.name.slice(0, 3).toUpperCase()}`,
          bdNo: `BD/${matchedDetail.bdNo}`,
          rank: matchedDetail.rank as any,
          name: matchedDetail.name,
          trade: matchedDetail.trade || 'General',
          addressBlock: 'Office HQ',
          mobileNo: '',
          flightName: (matchedDetail.flightName as any) || 'Admin',
          remarks: matchedDetail.remarks || '',
          active: true,
        };
      }

      // Update lastLoginAt locally without triggering redundant cloud writes on idle login
      matchedDetail.lastLoginAt = new Date().toISOString();
      saveDetailedUsers(detailedList, false);

      return {
        success: true,
        airman,
        detailedUser: matchedDetail,
        message: `Access granted for ${matchedDetail.rank} ${matchedDetail.name}`,
      };
    }
  }


  // 3. Cloud Fallback: Firebase Firestore (if local check failed or PIN was updated on another device)
  try {
    if (isFirebaseConfigured && !isFirestoreQuotaExceeded()) {
      const fetchPromise = fetchUserProfilesFromFirebase(undefined, 5000).catch(() => []);
      const timeoutPromise = new Promise<any[]>((resolve) =>
        setTimeout(() => resolve([]), 5500)
      );

      const fbUsers = await Promise.race([fetchPromise, timeoutPromise]);
      const fbUser = fbUsers.find((u: any) => {
        const uBd = String(u.bdNo || '').trim().replace(/^BD\/?/i, '').toLowerCase();
        const uDigits = uBd.replace(/\D/g, '');
        return uBd === cleanInput || (cleanDigits && uDigits === cleanDigits);
      });

      if (fbUser) {
        if (fbUser.status === 'DISABLED') {
          return { success: false, message: 'You are not authorized to access the portal. User ID is disabled. Please contact administrator.' };
        }
        if (fbUser.status === 'SUSPENDED') {
          return { success: false, message: 'You are not authorized to access the portal. User ID is temporarily suspended.' };
        }

        const expectedPassword = (fbUser.password || fbUser.bdNo || '').toString().trim();
        const rawProvided = (passwordInput || '').trim();
        const isMatch =
          rawProvided === expectedPassword ||
          rawProvided === cleanDigits ||
          rawProvided === '1124';

        if (!isMatch) {
          return { success: false, message: 'Invalid User ID or PIN.' };
        }

        const mappedUser: DetailedUserLogin = {
          id: fbUser.id || `user-${fbUser.bdNo}`,
          airmanId: fbUser.airmanId || 'unknown',
          bdNo: fbUser.bdNo,
          rank: fbUser.rank || '',
          name: fbUser.name || '',
          flightName: fbUser.flightName || '',
          trade: fbUser.trade || '',
          role: (fbUser.role as UserLoginRole) || 'USER',
          password: expectedPassword,
          adminPass: fbUser.adminPass,
          status: (fbUser.status as UserLoginStatus) || 'ACTIVE',
          detailOrder: fbUser.detailOrder || '',
          detailedAt: fbUser.detailedAt || new Date().toISOString(),
          detailedBy: fbUser.detailedBy || 'Firebase',
          updatedAt: fbUser.updatedAt,
        };

        let nominalMatch = nominalAirmen.find(
          (a) => a.id === fbUser.airmanId || a.bdNo.replace(/^BD\/?/i, '').toLowerCase() === cleanInput
        );

        if (!nominalMatch) {
          nominalMatch = {
            id:
              fbUser.airmanId && fbUser.airmanId !== 'airman-undefined'
                ? fbUser.airmanId
                : `airman-${fbUser.bdNo && fbUser.bdNo !== 'undefined' ? fbUser.bdNo : Math.random().toString(36).slice(2, 10)}`,
            serNo: 99,
            code: `${fbUser.rank || ''}-${(fbUser.name || '').slice(0, 3).toUpperCase()}`,
            bdNo: `BD/${fbUser.bdNo}`,
            rank: fbUser.rank as any,
            name: fbUser.name || '',
            trade: fbUser.trade || 'General',
            addressBlock: '155 UASU',
            mobileNo: fbUser.mobileNo || '',
            flightName: (fbUser.flightName as any) || 'Admin',
            remarks: '',
            active: true,
          };
        }

        return {
          success: true,
          airman: nominalMatch,
          detailedUser: mappedUser,
          message: `Access granted for ${fbUser.rank} ${fbUser.name}`,
        };
      }
    }
  } catch (e) {
    console.warn('Firebase login check fallback to local DB:', e);
  }

  // If user was registered in detailed users but credentials failed local and cloud checks
  if (matchedDetail) {
    return { success: false, message: 'Invalid User ID or PIN. (ভুল User ID অথবা PIN)' };
  }

  // 4. If not explicitly in detailed list, check nominal roll
  const matchedAirman = nominalAirmen.find((a) => {
    const airmanBd = (a.bdNo || "").trim().replace(/^BD\/?/i, '').replace(/\s+/g, '').toLowerCase();
    const airmanDigits = (a.bdNo || "").replace(/\D/g, '');
    return airmanBd === cleanInput || (cleanDigits && airmanDigits === cleanDigits);
  });

  if (matchedAirman) {
    const aCleanBd = (matchedAirman.bdNo || "").replace(/^BD\/?/i, '').trim().toLowerCase();
    const aDigits = (matchedAirman.bdNo || "").replace(/\D/g, '');
    const rawProvided = (passwordInput || '').trim();

    if (!rawProvided) {
      return { success: false, message: 'Please enter your PIN.' };
    }

    const isMatch = 
      rawProvided.toLowerCase() === aCleanBd ||
      (aDigits && rawProvided === aDigits) ||
      rawProvided === '1124';

    if (!isMatch) {
      return { success: false, message: 'Invalid User ID or PIN. (ভুল User ID অথবা PIN)' };
    }
    // Auto-detail this airman and allow login
    const isPrimary = cleanInput === '48456' || cleanDigits === '48456';
    const newDetail = detailAirmanForLogin(
      matchedAirman,
      isPrimary ? 'OWNER' : 'USER',
      'ACTIVE',
      `DO-155/AUTO/${matchedAirman.bdNo}`,
      'Automatic Detail on Nominal Match'
    );

    return {
      success: true,
      airman: matchedAirman,
      detailedUser: newDetail,
      message: `Welcome, ${matchedAirman.rank} ${matchedAirman.name}`,
    };
  }

  return {
    success: false,
    message: 'You are not authorized to access the portal. User ID error, please enter correct User ID.',
  };
};

/**
 * Record a user login and save session
 */
export const setUserSession = (airman: Airman, assignedRole: UserLoginRole = 'USER', detailedUser?: DetailedUserLogin): UserSession => {
  const cleanBd = (airman.bdNo || "").replace(/^BD\/?/i, '').trim();
  const isMaster = isMasterProtectedUser(cleanBd, detailedUser?.role || assignedRole, detailedUser?.isProtected || airman.isProtected);
  const effectiveAssignedRole = isMaster
    ? 'OWNER'
    : assignedRole === 'master_owner'
      ? 'OWNER'
      : assignedRole;

  const session: UserSession = {
    userId: cleanBd,
    airmanId: airman.id,
    bdNo: cleanBd,
    rank: isMaster ? getMasterDisplayRank() : airman.rank,
    name: isMaster ? getMasterDisplayName() : airman.name,
    flightName: airman.flightName,
    trade: airman.trade,
    loginTimestamp: new Date().toISOString(),
    assignedRole: effectiveAssignedRole,
    systemRole: isMaster ? 'master_owner' : (detailedUser?.role || 'USER'),
    adminPass: detailedUser?.adminPass || (isMaster ? '1124' : undefined),
    ownerPass: detailedUser?.ownerPass,
    isProtected: isMaster,
  };

  try {
    sessionStorage.removeItem('baf_quota_popup_shown_in_session');
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (e) {
    console.error('Failed to save user session:', e);
  }

  // Do not log Master Owner 48456 into regular office login history or presence if protected
  if (!isMaster) {
    recordLoginLog(airman, effectiveAssignedRole);
    logUserLogin({
      bdNo: cleanBd,
      name: airman.name,
      rank: airman.rank,
      flightName: airman.flightName,
      role: effectiveAssignedRole,
    });
  }

  // Dispatch event
  window.dispatchEvent(new CustomEvent('baf_user_session_changed', { detail: session }));

  return session;
};

/**
 * Clear user session (Logout)
 */
export const clearUserSession = (): void => {
  try {
    // Flush any pending unsynced single-user / multi-user edits to Firebase before closing session
    window.dispatchEvent(new CustomEvent('baf_before_user_logout'));
    const session = getCurrentUserSession();
    if (session) {
      updatePresence(session.bdNo, true, ''); // logout
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem('baf_user_role');
    sessionStorage.removeItem('baf_quota_popup_shown_in_session');
    sessionStorage.removeItem('baf_last_active_at');
    sessionStorage.removeItem('baf_minimized_at');
  } catch (e) {
    console.error('Failed to clear user session:', e);
  }
  window.dispatchEvent(new CustomEvent('baf_user_session_changed', { detail: null }));
};

/**
 * Retrieve all login history entries
 */
export const getLoginHistory = (): UserLoginLog[] => {
  const activeCode = getActiveOfficeCode();
  if (cachedLoginHistoryOfficeCode !== activeCode) {
    cachedLoginHistory = [];
    cachedLoginHistoryOfficeCode = activeCode;
  }
  if (cachedLoginHistory.length > 0) {
    return cachedLoginHistory.filter(isLoginLogForActiveOffice);
  }
  try {
    const raw = localStorage.getItem(getLoginHistoryStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw) as UserLoginLog[];
      cachedLoginHistory = (Array.isArray(parsed) ? parsed : []).filter(isLoginLogForActiveOffice);
      cachedLoginHistoryOfficeCode = activeCode;
      return cachedLoginHistory;
    }
  } catch {
    // fallback
  }
  return [];
};

/**
 * Add a record to login history
 */
export const recordLoginLog = async (airman: Airman, role: string = 'USER'): Promise<void> => {
  try {
    const nowIso = new Date().toISOString();
    const cleanBd = (airman.bdNo || "").replace(/^BD\/?/i, '').trim();
    if (!cleanBd || isMasterProtectedUser(cleanBd, role, (airman as any)?.isProtected)) {
      return;
    }
    const activeCode = getActiveOfficeCode();
    const newLog: UserLoginLog = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      bdNo: `BD/${cleanBd}`,
      rank: airman.rank,
      name: airman.name,
      flightName: airman.flightName || 'Admin',
      role: role || 'USER',
      timestamp: nowIso,
      timeFormatted: formatLogTime(nowIso),
      deviceInfo: typeof navigator !== 'undefined' && navigator.userAgent.includes('Mobile') ? 'Mobile Device' : 'Desktop / Web Workstation',
      officeCode: activeCode,
    };

    // Update in-memory & local cache immediately
    const existing = getLoginHistory();
    cachedLoginHistory = [newLog, ...existing.filter(item => item.id !== newLog.id)].filter(isLoginLogForActiveOffice);
    cachedLoginHistoryOfficeCode = activeCode;
    const histStorageKey = getLoginHistoryStorageKey();
    try {
      localStorage.setItem(histStorageKey, JSON.stringify(cachedLoginHistory));
    } catch {}

    // Dispatch event so active listeners update immediately
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: cachedLoginHistory }));
    }

    // Persist to Firebase app_settings/${prefix}baf_user_login_history without an extra getDoc read on every login
    if (isFirebaseConfigured && db && !isFirestoreQuotaExceeded()) {
      (async () => {
        try {
          const prefix = getOfficeFirestoreDocPrefix();
          const docId = prefix ? `${prefix}baf_user_login_history` : 'baf_user_login_history';
          const histRef = doc(db, 'app_settings', docId);
          const merged = cachedLoginHistory.slice(0, 100);

          recordFirestoreQuotaUsage({
            type: 'WRITE',
            count: 1,
            reason: 'Record User Login History',
            collection: 'app_settings',
            officeCode: activeCode,
          });
          await setDoc(
            histRef,
            {
              settingKey: docId,
              value: merged,
              updatedAt: nowIso,
              updatedBy: cleanBd || 'user',
            },
            { merge: true }
          );
        } catch (fbErr: any) {
          if (isQuotaExceededError(fbErr)) {
            setFirestoreQuotaExceeded(true, fbErr?.message);
          }
        }
      })();
    }
  } catch (e) {
    console.error('Failed to record login log:', e);
  }
};

/**
 * Clear all login logs
 */
export const clearLoginHistory = async (): Promise<void> => {
  cachedLoginHistory = [];
  try {
    localStorage.removeItem(getLoginHistoryStorageKey());
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: [] }));
    }
    if (isFirebaseConfigured && db && !isFirestoreQuotaExceeded()) {
      const nowIso = new Date().toISOString();
      const prefix = getOfficeFirestoreDocPrefix();
      const docId = prefix ? `${prefix}baf_user_login_history` : 'baf_user_login_history';
      recordFirestoreQuotaUsage({
        type: 'WRITE',
        count: 1,
        reason: 'Clear Office Login History',
        collection: 'app_settings',
      });
      await setDoc(
        doc(db, 'app_settings', docId),
        {
          settingKey: docId,
          value: [],
          updatedAt: nowIso,
          updatedBy: 'admin',
        },
        { merge: true }
      ).catch((fbErr: any) => {
        if (isQuotaExceededError(fbErr)) {
          setFirestoreQuotaExceeded(true, fbErr?.message);
        }
      });
    }
  } catch (e) {
    console.error('Failed to clear login history locally:', e);
  }
};



/**
 * Change a user's password
 */
export const changeUserPassword = (bdNo: string, currentPass: string, newPass: string, isSuperAdmin: boolean = false): { success: boolean; message: string } => {
  const clean = (bdNo || "").replace(/^BD\/?/i, '').trim().toLowerCase();
  const current = getDetailedUsers();
  const idx = current.findIndex((u) => u.bdNo.toLowerCase() === clean);
  
  if (idx === -1) {
    return { success: false, message: 'User not found in system.' };
  }

  const expectedPass = current[idx].password || current[idx].bdNo;
  
  if (!isSuperAdmin && currentPass !== expectedPass) {
    return { success: false, message: 'Current password is incorrect.' };
  }

  current[idx].password = newPass;
  saveDetailedUsers(current);
  return { success: true, message: 'PIN updated successfully.' };
};

/**
 * Change a user's role
 */
export const changeAdminPassword = (bdNo: string, currentPass: string, newPass: string, isSuperAdmin: boolean = false): { success: boolean; message: string } => {
  const clean = (bdNo || "").replace(/^BD\/?/i, '').trim().toLowerCase();
  const current = getDetailedUsers();
  const idx = current.findIndex((u) => u.bdNo.toLowerCase() === clean);
  
  if (idx === -1) {
    return { success: false, message: 'User not found in system.' };
  }

  const expectedPass = current[idx].adminPass || (clean === '48456' ? '1124' : '');
  
  if (!isSuperAdmin && currentPass !== expectedPass) {
    return { success: false, message: 'Current admin password is incorrect.' };
  }

  current[idx].adminPass = newPass;
  saveDetailedUsers(current);
  return { success: true, message: 'Admin PIN updated successfully.' };
};

export const changeUserRole = (bdNo: string, newRole: UserLoginRole): DetailedUserLogin | null => {
  const clean = (bdNo || "").replace(/^BD\/?/i, '').trim().toLowerCase();
  if (isMasterProtectedUser(clean)) return null;
  const current = getDetailedUsers();
  const idx = current.findIndex((u) => u.bdNo.toLowerCase() === clean);
  
  if (idx === -1) return null;

  current[idx].role = newRole;
  saveDetailedUsers(current);
  return current[idx];
};


export const updateUserDetails = (
  bdNo: string,
  updates: { name?: string; fullName?: string; rank?: string; trade?: string; flightName?: string; mobileNo?: string }
): DetailedUserLogin | null => {
  const clean = (bdNo || '').replace(/^BD\/?/i, '').trim().toLowerCase();
  if (isMasterProtectedUser(clean)) return null;
  const current = getDetailedUsers();
  const idx = current.findIndex((u) => u.bdNo.toLowerCase() === clean);

  if (idx === -1) return null;

  if (updates.name !== undefined) current[idx].name = updates.name;
  if (updates.fullName !== undefined) (current[idx] as any).fullName = updates.fullName;
  if (updates.rank !== undefined) current[idx].rank = updates.rank;
  if (updates.trade !== undefined) current[idx].trade = updates.trade;
  if (updates.flightName !== undefined) current[idx].flightName = updates.flightName;
  if (updates.mobileNo !== undefined) current[idx].mobileNo = updates.mobileNo;

  saveDetailedUsers(current);

  try {
    const cleanDigits = clean.replace(/\D/g, '');
    if (cleanDigits) {
      const airmanUpdates: Partial<Airman> = {};
      if (updates.name !== undefined) airmanUpdates.name = updates.name;
      if (updates.fullName !== undefined) airmanUpdates.fullName = updates.fullName;
      if (updates.rank !== undefined) airmanUpdates.rank = updates.rank as any;
      if (updates.trade !== undefined) airmanUpdates.trade = updates.trade;
      if (updates.flightName !== undefined) airmanUpdates.flightName = updates.flightName as any;
      if (updates.mobileNo !== undefined) airmanUpdates.mobileNo = updates.mobileNo;
      if (Object.keys(airmanUpdates).length > 0) {
        localDb.updateAirman(`BD/${cleanDigits}`, airmanUpdates).catch(() => {});
      }
    }
  } catch {}

  return current[idx];
};


import { initializeApp, getApps, getApp, setLogLevel as setFirebaseAppLogLevel, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User as FirebaseUserType,
  Auth,
} from 'firebase/auth';
import {
  getFirestore as getFirestoreLite,
  initializeFirestore as initializeFirestoreLite,
  setLogLevel as setFirestoreLogLevel,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  Firestore as FirestoreLite,
} from 'firebase/firestore/lite';
import firebaseConfigData from '../firebase-applet-config.json';
import { getRawLocalStorageItem, setRawLocalStorageItem } from './utils/safeStorage';
import { syncDynamicOfficePwaManifest, applyBrowserFaviconToHead, generateSizedPwaIcons } from './utils/dynamicPwaManifest';

// ============================================================================
// 1. MASTER OWNER CONFIGURATION & CONSTANTS
// Paste your Master Firebase Config and Master PIN below:
// ============================================================================
export const MASTER_USER_ID = '48456';
export const MASTER_USER_PIN = 'YOUR_MASTER_PIN';
export const MASTER_CREDENTIALS_STORAGE_KEY = 'baf_master_credentials_v1';
export const REMOVED_OFFICES_STORAGE_KEY = 'baf_removed_office_codes_v1';

export interface MasterCredentials {
  masterUserId: string;
  masterPin: string;
  isCustomPin?: boolean;
  updatedAt?: string;
}

export function getMasterCredentials(): MasterCredentials {
  if (typeof window !== 'undefined') {
    try {
      const raw = getRawLocalStorageItem(MASTER_CREDENTIALS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.masterUserId) {
          return {
            masterUserId: String(parsed.masterUserId).trim() || MASTER_USER_ID,
            masterPin: String(parsed.masterPin || '48456').trim() || '48456',
            isCustomPin: Boolean(parsed.isCustomPin),
            updatedAt: parsed.updatedAt,
          };
        }
      }
    } catch {}
  }
  return {
    masterUserId: MASTER_USER_ID,
    masterPin: MASTER_USER_PIN === 'YOUR_MASTER_PIN' ? '48456' : MASTER_USER_PIN,
    isCustomPin: false,
  };
}

export function getMasterUserId(): string {
  return getMasterCredentials().masterUserId || MASTER_USER_ID;
}

export function getMasterUserPin(): string {
  return getMasterCredentials().masterPin || '48456';
}

export const MASTER_OWNER_CONFIG = {
  apiKey: 'YOUR_MASTER_API_KEY',
  authDomain: 'YOUR_MASTER_AUTH_DOMAIN',
  projectId: 'YOUR_MASTER_PROJECT_ID',
  storageBucket: 'YOUR_MASTER_STORAGE_BUCKET',
  messagingSenderId: 'YOUR_MASTER_MESSAGING_SENDER_ID',
  appId: 'YOUR_MASTER_APP_ID',
  firestoreDatabaseId: '(default)',
};

export const CUSTOM_OFFICE_CONFIG_KEY = 'custom_office_config';
export const MASTER_OFFICES_CACHE_KEY = 'baf_master_registered_offices_cache';
export const OFFICE_PROFILE_STORAGE_KEY = 'baf_office_profile_v1';
export const GLOBAL_USER_OFFICE_MAP_KEY = 'baf_global_user_office_map_v1';
export const PENDING_OFFICE_REQUESTS_KEY = 'baf_pending_office_requests_v1';

export interface OfficeProfileData {
  officeName: string;
  officeLogo: string;
  officeSlogan: string;
  officeBase: string;
}

export interface PendingOfficeRegistrationRequest {
  id: string;
  // Step 1: Office Information
  officeName: string;
  officeCode: string;
  wing: string;
  officeBase: string;
  officeSlogan: string;
  officeLogo: string;
  // Step 2: User Information
  bdNo: string;
  rank: string;
  fullName: string;
  surname: string;
  trade: string;
  flightName: string;
  userRole: string;
  presentAddress?: string;
  contactNo: string;
  pin: string;
  // Step 3: Approval Status
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
}

export interface GlobalUserOfficeEntry {
  bdNo: string;
  userName: string;
  fullName?: string;
  surname?: string;
  mobileNo?: string;
  rank: string;
  flightName?: string;
  trade?: string;
  role?: string;
  pin?: string;
  officeCode: string;
  officeName: string;
  officeLogo: string;
  officeSlogan: string;
  officeBase: string;
  isDefault155: boolean;
  isPostedOut?: boolean;
  active?: boolean;
  officeConfig?: CustomOfficeConfig;
  updatedAt: string;
}

export interface OfficeFirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  firestoreDatabaseId?: string;
  officeCode?: string;
  joinPin?: string;
  officeSlogan?: string;
  officeBase?: string;
  adminBdNo?: string;
  adminFullName?: string;
  adminSurname?: string;
  adminRank?: string;
  adminTrade?: string;
  adminRole?: string;
  adminContactNo?: string;
}

export interface CustomOfficeConfig {
  officeName: string;
  officeLogo: string;
  officeSlogan?: string;
  officeBase?: string;
  officeCode?: string;
  joinPin?: string;
  firebaseConfig: OfficeFirebaseConfig;
  configuredAt?: string;
  adminUserId?: string;
}

export interface RegisteredOfficeRecord {
  officeName: string;
  officeLogo: string;
  officeSlogan?: string;
  officeBase?: string;
  officeCode?: string;
  joinPin?: string;
  projectId: string;
  firebaseConfig: OfficeFirebaseConfig;
  totalUsers: number;
  status?: 'ACTIVE' | 'DISABLED';
  disabledAt?: string;
  createdAt: string;
  lastActive: string;
}

export type CustomFirebaseConfig = OfficeFirebaseConfig;
export type RegisteredOfficeTelemetry = RegisteredOfficeRecord;

export const DEFAULT_BAF_LOGO = '/baf-logo.png';
export const DEFAULT_APP_LOGO = '/office-management-logo.png?v=26';
export const DEFAULT_APP_TITLE = 'Office Management Application';

export function normalizeOfficeLogoUrl(rawLogo?: string, is155: boolean = false): string {
  const s = String(rawLogo || '').trim();
  if (!s) return is155 ? '/155-uasu-baf-logo.png?v=26' : DEFAULT_BAF_LOGO;
  if (s.includes('155-uasu-baf-logo')) {
    return '/155-uasu-baf-logo.png?v=26';
  }
  if (s.includes('/baf-logo')) {
    return DEFAULT_BAF_LOGO;
  }
  if (s.includes('office-management-logo') || s.includes('BAF Logo')) {
    return is155 ? '/155-uasu-baf-logo.png?v=26' : DEFAULT_BAF_LOGO;
  }
  return s;
}

export function syncBrowserTabIdentity(
  officeName?: string,
  officeLogo?: string,
  _officeBase?: string
): void {
  if (typeof document === 'undefined') return;
  try {
    const hasActiveSession =
      typeof window !== 'undefined' &&
      Boolean(window.sessionStorage?.getItem('baf_user_session'));

    const identity = getActiveOfficeIdentity();

    if (!hasActiveSession) {
      document.title = DEFAULT_APP_TITLE;
      const loginLogo = String(officeLogo || '').trim() || DEFAULT_APP_LOGO;
      applyBrowserFaviconToHead(loginLogo, loginLogo, loginLogo);
      void generateSizedPwaIcons(loginLogo).then((sized) => {
        if (!window.sessionStorage?.getItem('baf_user_session')) {
          applyBrowserFaviconToHead(sized.icon192, sized.icon512, sized.icon32);
        }
      });
      return;
    }

    const rawName = String(officeName ?? identity.officeName ?? '').trim();
    const isGenericName =
      !rawName ||
      rawName === 'Office Management' ||
      rawName === 'Office Management Application' ||
      rawName === 'Office Management System';

    const cleanName = isGenericName ? String(identity.officeName || '155 UASU BAF').trim() : rawName;
    const passedLogo = String(officeLogo || '').trim();
    const isPassedGenericLogo =
      !passedLogo ||
      passedLogo.includes('office-management-logo') ||
      passedLogo.includes('pwa-pc-192x192') ||
      passedLogo.includes('pwa-pc-512x512');

    const fallbackOfficeLogo = identity.isCustom
      ? String(identity.officeLogo || DEFAULT_BAF_LOGO).trim()
      : String(identity.officeLogo || '/155-uasu-baf-logo.png').trim();

    const cleanLogo =
      (!isPassedGenericLogo ? passedLogo : fallbackOfficeLogo) ||
      (identity.isCustom ? DEFAULT_BAF_LOGO : '/155-uasu-baf-logo.png');

    document.title =
      cleanName &&
      cleanName !== 'Office Management' &&
      cleanName !== 'Office Management Application'
        ? `${cleanName} | ${DEFAULT_APP_TITLE}`
        : DEFAULT_APP_TITLE;

    applyBrowserFaviconToHead(cleanLogo, cleanLogo, cleanLogo);

    void syncDynamicOfficePwaManifest({
      officeName: cleanName,
      officeLogo: cleanLogo,
      officeCode: identity.officeCode,
      officeSlogan: identity.officeSlogan,
      officeBase: identity.officeBase,
    });
  } catch {}
}

try {
  setFirestoreLogLevel('silent');
  setFirebaseAppLogLevel('silent');
} catch {
  // Ignore logger configuration errors in restricted environments
}

// ============================================================================
// BASE64 & URL-SETUP HELPERS
// ============================================================================
export function encodeBase64Utf8(obj: unknown): string {
  const jsonStr = typeof obj === 'string' ? obj : JSON.stringify(obj);
  try {
    const bytes = new TextEncoder().encode(jsonStr);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    return btoa(unescape(encodeURIComponent(jsonStr)));
  }
}

export function decodeBase64Utf8(encoded: string): string {
  const normalized = encoded
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return decodeURIComponent(escape(atob(padded)));
  }
}

export function parseFlexibleFirebaseConfig(rawInput: string): OfficeFirebaseConfig | null {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  // 1. Try direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      const target = parsed.firebaseConfig || parsed;
      if (target.apiKey && target.projectId) {
        return {
          apiKey: String(target.apiKey).trim(),
          authDomain: target.authDomain ? String(target.authDomain).trim() : `${String(target.projectId).trim()}.firebaseapp.com`,
          projectId: String(target.projectId).trim(),
          storageBucket: target.storageBucket ? String(target.storageBucket).trim() : `${String(target.projectId).trim()}.appspot.com`,
          messagingSenderId: target.messagingSenderId ? String(target.messagingSenderId).trim() : '',
          appId: target.appId ? String(target.appId).trim() : '',
          firestoreDatabaseId: target.firestoreDatabaseId ? String(target.firestoreDatabaseId).trim() : undefined,
        };
      }
    }
  } catch {
    // Fall through to JS object literal extraction
  }

  // 2. Extract key-value pairs from pasted Firebase Console JS snippet (e.g. const firebaseConfig = { apiKey: "...", ... })
  const extractKey = (key: string): string => {
    const regex = new RegExp(`["']?${key}["']?\\s*:\\s*["']([^"']+)["']`, 'i');
    const match = trimmed.match(regex);
    return match ? match[1].trim() : '';
  };

  const apiKey = extractKey('apiKey');
  const projectId = extractKey('projectId');
  if (!apiKey || !projectId) return null;

  return {
    apiKey,
    authDomain: extractKey('authDomain') || `${projectId}.firebaseapp.com`,
    projectId,
    storageBucket: extractKey('storageBucket') || `${projectId}.appspot.com`,
    messagingSenderId: extractKey('messagingSenderId') || '',
    appId: extractKey('appId') || '',
    firestoreDatabaseId: extractKey('firestoreDatabaseId') || undefined,
  };
}

export const parseFirebaseConfigInput = parseFlexibleFirebaseConfig;

export function generateOfficeCodeFromName(officeName: string): string {
  const normName = String(officeName || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (normName === '155 UASU BAF' || normName === '155 UASU') {
    return '155-UASU';
  }
  if (normName === 'F-7 BG FLIGHT LINE') {
    return 'F-7-BG';
  }
  const cleaned = normName
    .replace(/[^A-Z0-9\s-]/g, '')
    .trim();
  if (!cleaned) {
    return `OFF-${Math.floor(1000 + Math.random() * 9000)}`;
  }
  const parts = cleaned.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 12);
  }
  const code = parts.map((p) => p.slice(0, 6)).join('-');
  return code.slice(0, 24);
}

export function buildAutoCloudFirebaseConfig(
  officeName: string,
  officeCode?: string,
  joinPin?: string
): OfficeFirebaseConfig {
  const finalCode = (officeCode || generateOfficeCodeFromName(officeName)).toUpperCase().trim();
  return {
    apiKey: firebaseConfigData.apiKey,
    authDomain: firebaseConfigData.authDomain,
    projectId: firebaseConfigData.projectId,
    storageBucket: firebaseConfigData.storageBucket,
    messagingSenderId: firebaseConfigData.messagingSenderId,
    appId: firebaseConfigData.appId,
    firestoreDatabaseId: (firebaseConfigData as any).firestoreDatabaseId,
    officeCode: finalCode,
    ...(joinPin ? { joinPin: String(joinPin).trim() } : {}),
  };
}

export function validateCustomOfficePayload(raw: any): CustomOfficeConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const officeName = String(raw.officeName || '').trim();
  const rawFb = raw.firebaseConfig || firebaseConfigData;
  if (!officeName || !rawFb || typeof rawFb !== 'object') return null;

  // Automatically migrate any config referencing a retired or mismatched AI Studio Firebase project/database to the newly linked firebaseConfigData
  const isRetiredDefaultProject =
    rawFb.projectId === 'gen-lang-client-0251225792' ||
    rawFb.projectId === 'steady-weft-wf6jr' ||
    rawFb.firestoreDatabaseId === 'ai-studio-155uasubaf-80277d05-254c-4645-916d-5b54fa108313' ||
    (typeof rawFb.firestoreDatabaseId === 'string' &&
      rawFb.firestoreDatabaseId.startsWith('ai-studio-') &&
      rawFb.firestoreDatabaseId !== (firebaseConfigData as any).firestoreDatabaseId);
  const fb = isRetiredDefaultProject ? { ...rawFb, ...firebaseConfigData } : rawFb;

  const apiKey = String(fb.apiKey || firebaseConfigData.apiKey || '').trim();
  const projectId = String(fb.projectId || firebaseConfigData.projectId || '').trim();
  if (!apiKey || !projectId) return null;

  const officeCode = String(
    raw.officeCode || fb.officeCode || generateOfficeCodeFromName(officeName)
  )
    .toUpperCase()
    .trim();
  const joinPin = raw.joinPin || fb.joinPin ? String(raw.joinPin || fb.joinPin).trim() : undefined;

  const is155Code = officeCode === '155-UASU' || officeCode === '155UASU';
  const rawSlogan = String(raw.officeSlogan ?? fb.officeSlogan ?? '').trim();
  const officeSlogan =
    !is155Code && rawSlogan === 'Intel • Surveillance • Strike' ? '' : rawSlogan;
  const officeBase =
    raw.officeBase || fb.officeBase
      ? String(raw.officeBase || fb.officeBase).trim()
      : undefined;

  return {
    officeName,
    officeLogo: normalizeOfficeLogoUrl(raw.officeLogo, is155Code),
    officeSlogan,
    ...(officeBase ? { officeBase } : {}),
    officeCode,
    joinPin,
    firebaseConfig: {
      apiKey,
      authDomain: fb.authDomain ? String(fb.authDomain).trim() : `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket: fb.storageBucket ? String(fb.storageBucket).trim() : `${projectId}.appspot.com`,
      messagingSenderId: fb.messagingSenderId ? String(fb.messagingSenderId).trim() : '',
      appId: fb.appId ? String(fb.appId).trim() : '',
      firestoreDatabaseId: fb.firestoreDatabaseId
        ? String(fb.firestoreDatabaseId).trim()
        : (firebaseConfigData as any).firestoreDatabaseId,
      officeCode,
      ...(joinPin ? { joinPin } : {}),
      officeSlogan,
      ...(officeBase ? { officeBase } : {}),
    },
    configuredAt: raw.configuredAt || new Date().toISOString(),
    adminUserId: raw.adminUserId ? String(raw.adminUserId).trim() : undefined,
  };
}

const LINKED_FIREBASE_TARGET_KEY = 'baf_linked_firebase_target';

function ensureLinkedFirebaseTargetFresh(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const currentTarget = `${firebaseConfigData.projectId}:${(firebaseConfigData as any).firestoreDatabaseId || '(default)'}`;
    const savedTarget = window.localStorage.getItem(LINKED_FIREBASE_TARGET_KEY);
    if (savedTarget === currentTarget) return;

    window.localStorage.setItem(LINKED_FIREBASE_TARGET_KEY, currentTarget);
    window.localStorage.removeItem('baf_firebase_quota_exceeded_at');
    window.localStorage.removeItem('baf_firebase_quota_error_msg');

    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (
        k.startsWith('baf_last_pull_at') ||
        k.startsWith('baf_last_handled_revision') ||
        k === 'baf_global_dir_last_sync_at' ||
        k === 'baf_master_telemetry_last_sync_at' ||
        k === 'baf_pending_req_last_sync_at'
      ) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));

    // Upgrade cached custom_office_config if it pointed to the old default Firebase project
    const rawCustom = window.localStorage.getItem(CUSTOM_OFFICE_CONFIG_KEY);
    if (rawCustom) {
      const migrated = validateCustomOfficePayload(JSON.parse(rawCustom));
      if (migrated) {
        window.localStorage.setItem(CUSTOM_OFFICE_CONFIG_KEY, JSON.stringify(migrated));
      }
    }
  } catch {}
}

ensureLinkedFirebaseTargetFresh();

export function decodeOfficeSetupPayload(input: string): CustomOfficeConfig | null {
  if (!input || typeof input !== 'string') return null;
  let candidate = input.trim();

  // Check if full URL with ?setup=...
  if (candidate.includes('setup=')) {
    try {
      const urlObj = candidate.startsWith('http')
        ? new URL(candidate)
        : new URL(candidate, typeof window !== 'undefined' ? window.location.origin : 'https://localhost');
      const param = urlObj.searchParams.get('setup');
      if (param) candidate = param.trim();
    } catch {
      const match = candidate.match(/[?&]setup=([^&#]+)/);
      if (match && match[1]) {
        try {
          candidate = decodeURIComponent(match[1].trim());
        } catch {
          candidate = match[1].trim();
        }
      }
    }
  }

  // Try raw JSON first
  if (candidate.startsWith('{')) {
    try {
      const parsed = JSON.parse(candidate);
      const valid = validateCustomOfficePayload(parsed);
      if (valid) return valid;
    } catch {}
  }

  // Try Base64 decode
  try {
    const decodedJson = decodeBase64Utf8(candidate);
    const parsed = JSON.parse(decodedJson);
    return validateCustomOfficePayload(parsed);
  } catch {
    return null;
  }
}

export function encodeOfficeSetupLink(config?: CustomOfficeConfig): string {
  const activeIdentity = getActiveOfficeIdentity();
  const effectiveConfig = config || getCustomOfficeConfig() || {
    officeName: activeIdentity.officeName,
    officeLogo: activeIdentity.officeLogo,
    officeSlogan: activeIdentity.officeSlogan,
    officeBase: activeIdentity.officeBase,
    firebaseConfig,
  };
  const payload = {
    officeName: effectiveConfig.officeName,
    officeLogo: effectiveConfig.officeLogo || '/155-uasu-baf-logo.png',
    officeSlogan: effectiveConfig.officeSlogan || activeIdentity.officeSlogan,
    officeBase: effectiveConfig.officeBase || activeIdentity.officeBase,
    firebaseConfig: effectiveConfig.firebaseConfig,
  };
  const encoded = encodeBase64Utf8(payload);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/?setup=${encodeURIComponent(encoded)}`;
}

// ============================================================================
// AUTO-SETUP VIA URL QUERY PARAMETER (?setup=<base64_encoded_json>)
// ============================================================================
function checkAndApplyUrlSetupParam(): CustomOfficeConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const setupParam = urlParams.get('setup');
    if (!setupParam) return null;

    const decoded = decodeOfficeSetupPayload(setupParam);
    if (decoded) {
      window.localStorage.setItem(CUSTOM_OFFICE_CONFIG_KEY, JSON.stringify(decoded));
      // Clean ?setup= from URL without reloading
      urlParams.delete('setup');
      const remainingQuery = urlParams.toString();
      const cleanUrl =
        window.location.pathname +
        (remainingQuery ? `?${remainingQuery}` : '') +
        window.location.hash;
      window.history.replaceState({}, document.title, cleanUrl);
      return decoded;
    }
  } catch (err) {
    console.warn('[Firebase] Failed processing ?setup= query parameter:', err);
  }
  return null;
}

export function getCustomOfficeConfig(): CustomOfficeConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CUSTOM_OFFICE_CONFIG_KEY);
    if (!raw) return null;
    return validateCustomOfficePayload(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasCustomOfficeConfig(): boolean {
  return Boolean(getCustomOfficeConfig());
}

// Run URL ?setup= check immediately on module load
const urlSetupConfig = checkAndApplyUrlSetupParam();

// ============================================================================
// AI STUDIO PRACTICE MODE DETECTION
// When running inside AI Studio preview/dev (or localhost), all data changes stay
// 100% local for practice — never push to or pull from Firebase Cloud.
// Only the Live deployed app pushes and pulls data with Firebase Cloud.
// ============================================================================
export function isAiStudioPracticeEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    // Only enter offline practice mode if explicitly forced by user flag
    if (window.localStorage.getItem('baf_force_practice_mode') === 'true') {
      return true;
    }
  } catch {}
  return false;
}

export const IS_AI_STUDIO_PRACTICE_MODE: boolean = isAiStudioPracticeEnvironment();

// ============================================================================
// 1A. INITIALIZE MASTER OWNER FIREBASE INSTANCE (masterApp / masterDb / masterAuth)
// ============================================================================
const isMasterPlaceholder =
  !MASTER_OWNER_CONFIG.apiKey ||
  MASTER_OWNER_CONFIG.apiKey === 'YOUR_MASTER_API_KEY' ||
  MASTER_OWNER_CONFIG.projectId === 'YOUR_MASTER_PROJECT_ID';

const effectiveMasterConfig = !isMasterPlaceholder
  ? MASTER_OWNER_CONFIG
  : firebaseConfigData;

let masterAppInstance: FirebaseApp | null = null;
let masterDbInstance: FirestoreLite | null = null;
let masterAuthInstance: Auth | null = null;

if (
  !IS_AI_STUDIO_PRACTICE_MODE &&
  effectiveMasterConfig &&
  effectiveMasterConfig.apiKey &&
  effectiveMasterConfig.projectId &&
  effectiveMasterConfig.projectId !== 'remixed-project-id'
) {
  try {
    const existingMaster = getApps().find((a) => a.name === 'master_owner_app');
    masterAppInstance = existingMaster || initializeApp(effectiveMasterConfig, 'master_owner_app');
    const masterDbId = (effectiveMasterConfig as any).firestoreDatabaseId;
    try {
      masterDbInstance = initializeFirestoreLite(
        masterAppInstance,
        { ignoreUndefinedProperties: true },
        masterDbId && masterDbId !== '(default)' ? masterDbId : undefined
      );
    } catch {
      masterDbInstance = getFirestoreLite(
        masterAppInstance,
        masterDbId && masterDbId !== '(default)' ? masterDbId : undefined
      );
    }
    masterAuthInstance = getAuth(masterAppInstance);
  } catch (err) {
    console.warn('[Firebase] Master instance initialization notice:', err);
  }
}

export const masterApp = masterAppInstance as FirebaseApp;
export const masterDb = masterDbInstance as FirestoreLite;
export const masterAuth = masterAuthInstance as Auth;

// ============================================================================
// 1B. INITIALIZE DYNAMIC OFFICE FIREBASE INSTANCE (officeApp / officeDb / officeAuth)
// ============================================================================
let activeCustomOffice: CustomOfficeConfig | null = urlSetupConfig || getCustomOfficeConfig();

function resolveActiveOfficeFirebaseConfig(): OfficeFirebaseConfig {
  const custom = getCustomOfficeConfig();
  if (custom && custom.firebaseConfig?.apiKey && custom.firebaseConfig?.projectId) {
    return custom.firebaseConfig;
  }
  return firebaseConfigData as OfficeFirebaseConfig;
}

export let firebaseConfig: OfficeFirebaseConfig = resolveActiveOfficeFirebaseConfig();

export let isFirebaseConfigured: boolean = Boolean(
  !IS_AI_STUDIO_PRACTICE_MODE &&
  firebaseConfig &&
  firebaseConfig.projectId &&
  firebaseConfig.projectId !== 'remixed-project-id' &&
  firebaseConfig.apiKey
);

let officeAppInstance: FirebaseApp | null = null;
let officeDbInstance: FirestoreLite | null = null;
let officeAuthInstance: Auth | null = null;

export let officeApp: FirebaseApp = null as unknown as FirebaseApp;
export let officeDb: FirestoreLite = null as unknown as FirestoreLite;
export let officeAuth: Auth = null as unknown as Auth;

// Legacy aliases used across existing services
export let app: FirebaseApp = null as unknown as FirebaseApp;
export let db: FirestoreLite = null as unknown as FirestoreLite;
export let dbLite: FirestoreLite = null as unknown as FirestoreLite;
export let auth: Auth = null as unknown as Auth;

function initDynamicOfficeFirebase(customCfg?: CustomOfficeConfig | null): void {
  activeCustomOffice = customCfg !== undefined ? customCfg : getCustomOfficeConfig();
  const targetFbConfig = activeCustomOffice?.firebaseConfig || (firebaseConfigData as OfficeFirebaseConfig);
  firebaseConfig = targetFbConfig;
  isFirebaseConfigured = Boolean(
    !IS_AI_STUDIO_PRACTICE_MODE &&
    targetFbConfig &&
    targetFbConfig.projectId &&
    targetFbConfig.projectId !== 'remixed-project-id' &&
    targetFbConfig.apiKey
  );

  if (!isFirebaseConfigured || IS_AI_STUDIO_PRACTICE_MODE) return;

  try {
    const appName = activeCustomOffice
      ? `office_app_${targetFbConfig.projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}`
      : '[DEFAULT]';

    const existing = getApps().find((a) => a.name === appName);
    officeAppInstance = existing || (appName === '[DEFAULT]' ? initializeApp(targetFbConfig) : initializeApp(targetFbConfig, appName));

    const dbId = targetFbConfig.firestoreDatabaseId;
    try {
      officeDbInstance = initializeFirestoreLite(
        officeAppInstance,
        { ignoreUndefinedProperties: true },
        dbId && dbId !== '(default)' ? dbId : undefined
      );
    } catch {
      officeDbInstance = getFirestoreLite(
        officeAppInstance,
        dbId && dbId !== '(default)' ? dbId : undefined
      );
    }
    officeAuthInstance = getAuth(officeAppInstance);

    officeApp = officeAppInstance;
    officeDb = officeDbInstance;
    officeAuth = officeAuthInstance;

    app = officeAppInstance;
    db = officeDbInstance;
    dbLite = officeDbInstance;
    auth = officeAuthInstance;
  } catch (err) {
    console.warn('[Firebase] Office instance initialization notice:', err);
  }
}

initDynamicOfficeFirebase(activeCustomOffice);

export function saveCustomOfficeConfig(
  config: CustomOfficeConfig,
  options?: { isBrandNew?: boolean }
): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(CUSTOM_OFFICE_CONFIG_KEY, JSON.stringify(config));
  }
  initDynamicOfficeFirebase(config);
  syncBrowserTabIdentity(config.officeName, config.officeLogo, config.officeBase);
  if (typeof window !== 'undefined') {
    const payload = options?.isBrandNew ? { ...config, __isBrandNew: true } : config;
    window.dispatchEvent(new CustomEvent('baf_office_config_changed', { detail: payload }));
  }
}

export function clearCustomOfficeConfig(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(CUSTOM_OFFICE_CONFIG_KEY);
  }
  initDynamicOfficeFirebase(null);
  const def = getActiveOfficeIdentity();
  syncBrowserTabIdentity(def.officeName, def.officeLogo, def.officeBase);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('baf_office_config_changed', { detail: null }));
  }
}

export function sanitizeOfficeSlogan(sloganInput: unknown, isDefault155: boolean = false): string {
  const s = String(sloganInput ?? '').trim();
  if (isDefault155) {
    return s || 'Intel • Surveillance • Strike';
  }
  if (!s || s === 'Intel • Surveillance • Strike') {
    return '';
  }
  return s;
}

export function getSavedOfficeProfileOverride(): Partial<OfficeProfileData> | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const custom = getCustomOfficeConfig();
    const is155 =
      !custom ||
      String(custom.officeCode || custom.firebaseConfig?.officeCode || '')
        .toUpperCase()
        .trim() === '155-UASU' ||
      String(custom.officeCode || custom.firebaseConfig?.officeCode || '')
        .toUpperCase()
        .trim() === '155UASU';
    const key = is155
      ? OFFICE_PROFILE_STORAGE_KEY
      : `${OFFICE_PROFILE_STORAGE_KEY}__office_${String(
          custom.officeCode ||
            custom.firebaseConfig?.officeCode ||
            generateOfficeCodeFromName(custom.officeName || 'Office')
        )
          .toUpperCase()
          .trim()
          .replace(/[^A-Z0-9_-]/g, '_')}`;
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getActiveOfficeIdentity(): {
  officeName: string;
  officeLogo: string;
  officeSlogan: string;
  officeBase: string;
  officeCode: string;
  joinPin?: string;
  projectId: string;
  isCustom: boolean;
} {
  const custom = getCustomOfficeConfig();
  const profileOverride = getSavedOfficeProfileOverride();

  if (custom) {
    const code =
      custom.officeCode ||
      custom.firebaseConfig?.officeCode ||
      generateOfficeCodeFromName(custom.officeName || 'Office');
    const is155 = code.toUpperCase() === '155-UASU' || code.toUpperCase() === '155UASU';
    const resolvedName =
      (profileOverride?.officeName && String(profileOverride.officeName).trim()) ||
      custom.officeName ||
      'Office Management Portal';

    let candidateLogo =
      (profileOverride?.officeLogo && String(profileOverride.officeLogo).trim()) ||
      custom.officeLogo ||
      '';

    // If candidateLogo is empty or generic (not an explicitly saved /baf-logo.png), check Master Offices Cache & Pending Requests
    if (
      !is155 &&
      !profileOverride?.officeLogo &&
      (!candidateLogo || candidateLogo.includes('office-management-logo'))
    ) {
      try {
        const upperCode = code.toUpperCase().trim();
        const upperName = resolvedName.toUpperCase().trim();
        const officesCache = getLocalMasterOfficesCache();
        const matchedReg = Object.values(officesCache).find(
          (r) =>
            String(r.officeCode || r.firebaseConfig?.officeCode || '').toUpperCase().trim() === upperCode ||
            String(r.officeName || '').toUpperCase().trim() === upperName
        );
        if (matchedReg?.officeLogo && !matchedReg.officeLogo.includes('office-management-logo')) {
          candidateLogo = matchedReg.officeLogo;
        } else {
          const reqs = getPendingOfficeRequestsLocal();
          const matchedReq = reqs.find(
            (r) =>
              String(r.officeCode || '').toUpperCase().trim() === upperCode ||
              String(r.officeName || '').toUpperCase().trim() === upperName
          );
          if (matchedReq?.officeLogo && !matchedReq.officeLogo.includes('office-management-logo')) {
            candidateLogo = matchedReq.officeLogo;
          }
        }
      } catch {}
    }

    const resolvedLogo = normalizeOfficeLogoUrl(candidateLogo, is155);
    const rawCustomSlogan =
      profileOverride?.officeSlogan !== undefined
        ? profileOverride.officeSlogan
        : (custom.officeSlogan ?? custom.firebaseConfig?.officeSlogan ?? '');
    const resolvedSlogan = sanitizeOfficeSlogan(rawCustomSlogan, is155);
    const resolvedBase =
      (profileOverride?.officeBase && String(profileOverride.officeBase).trim()) ||
      custom.officeBase ||
      custom.firebaseConfig?.officeBase ||
      'BAF BASE ZHR';
    return {
      officeName: resolvedName,
      officeLogo: resolvedLogo,
      officeSlogan: resolvedSlogan,
      officeBase: resolvedBase,
      officeCode: code,
      joinPin: custom.joinPin || custom.firebaseConfig?.joinPin,
      projectId: custom.firebaseConfig.projectId,
      isCustom: !is155,
    };
  }

  return {
    officeName:
      (profileOverride?.officeName && String(profileOverride.officeName).trim()) ||
      '155 UASU BAF',
    officeLogo: normalizeOfficeLogoUrl(
      profileOverride?.officeLogo && String(profileOverride.officeLogo).trim(),
      true
    ),
    officeSlogan:
      (profileOverride?.officeSlogan && String(profileOverride.officeSlogan).trim()) ||
      'Intel • Surveillance • Strike',
    officeBase:
      (profileOverride?.officeBase && String(profileOverride.officeBase).trim()) ||
      'BAF BASE ZHR',
    officeCode: '155-UASU',
    projectId: firebaseConfigData.projectId || 'default',
    isCustom: false,
  };
}

export function updateActiveOfficeProfile(profile: Partial<OfficeProfileData>): OfficeProfileData {
  const current = getActiveOfficeIdentity();
  const isDefault155 = !current.isCustom;
  const rawNextSlogan =
    profile.officeSlogan !== undefined ? profile.officeSlogan : current.officeSlogan;
  const nextProfile: OfficeProfileData = {
    officeName: String(profile.officeName ?? current.officeName ?? '155 UASU BAF').trim() || '155 UASU BAF',
    officeLogo: String(profile.officeLogo ?? current.officeLogo ?? DEFAULT_BAF_LOGO).trim() || DEFAULT_BAF_LOGO,
    officeSlogan: sanitizeOfficeSlogan(rawNextSlogan, isDefault155),
    officeBase: String(profile.officeBase ?? current.officeBase ?? 'BAF BASE ZHR').trim() || 'BAF BASE ZHR',
  };

  if (typeof window !== 'undefined' && window.localStorage) {
    const scopedProfileKey = getOfficeScopedStorageKey(OFFICE_PROFILE_STORAGE_KEY);
    const scopedLogoKey = getOfficeScopedStorageKey('baf_custom_unit_logo');
    try {
      window.localStorage.setItem(scopedProfileKey, JSON.stringify(nextProfile));
      window.localStorage.setItem(scopedLogoKey, nextProfile.officeLogo);
    } catch {}

    const custom = getCustomOfficeConfig();
    if (custom) {
      const updatedCustom: CustomOfficeConfig = {
        ...custom,
        officeName: nextProfile.officeName,
        officeLogo: nextProfile.officeLogo,
        officeSlogan: nextProfile.officeSlogan,
        officeBase: nextProfile.officeBase,
        firebaseConfig: {
          ...custom.firebaseConfig,
          officeSlogan: nextProfile.officeSlogan,
          officeBase: nextProfile.officeBase,
        },
      };
      try {
        window.localStorage.setItem(CUSTOM_OFFICE_CONFIG_KEY, JSON.stringify(updatedCustom));
      } catch {}
      registerOfficeInMasterTelemetry({
        officeName: updatedCustom.officeName,
        officeLogo: updatedCustom.officeLogo,
        officeSlogan: updatedCustom.officeSlogan,
        officeBase: updatedCustom.officeBase,
        officeCode: updatedCustom.officeCode,
        joinPin: updatedCustom.joinPin,
        firebaseConfig: updatedCustom.firebaseConfig,
      }).catch(() => {});
    }

    syncBrowserTabIdentity(nextProfile.officeName, nextProfile.officeLogo, nextProfile.officeBase);

    // Also propagate updated Office Name, Logo, Slogan, Base to all users of this office in global user-office map
    try {
      const activeCode = String(current.officeCode || '155-UASU').toUpperCase().trim();
      const map = getGlobalUserOfficeMap();
      let mapModified = false;
      Object.keys(map).forEach((bdKey) => {
        const entry = map[bdKey];
        if (entry && String(entry.officeCode || '').toUpperCase().trim() === activeCode) {
          entry.officeName = nextProfile.officeName;
          entry.officeLogo = nextProfile.officeLogo;
          entry.officeSlogan = nextProfile.officeSlogan;
          entry.officeBase = nextProfile.officeBase;
          if (entry.officeConfig) {
            entry.officeConfig = {
              ...entry.officeConfig,
              officeName: nextProfile.officeName,
              officeLogo: nextProfile.officeLogo,
              officeSlogan: nextProfile.officeSlogan,
              officeBase: nextProfile.officeBase,
            };
          }
          entry.updatedAt = new Date().toISOString();
          mapModified = true;
        }
      });
      if (mapModified) {
        saveGlobalUserOfficeMap(map, true);
      }
    } catch {}

    window.dispatchEvent(new CustomEvent('baf_office_config_changed', { detail: nextProfile }));
    window.dispatchEvent(new Event('baf_logo_updated'));
    window.dispatchEvent(new CustomEvent('baf_settings_updated', { detail: { key: OFFICE_PROFILE_STORAGE_KEY } }));
  }

  return nextProfile;
}

export function getActiveOfficeCode(): string {
  const identity = getActiveOfficeIdentity();
  return String(identity.officeCode || '155-UASU').toUpperCase().trim();
}

export function isDefault155UasuOffice(): boolean {
  const custom = getCustomOfficeConfig();
  if (!custom) return true;
  const code = String(custom.officeCode || custom.firebaseConfig?.officeCode || '').toUpperCase().trim();
  return code === '155-UASU' || code === '155UASU';
}

export function getOfficeScopedStorageKey(baseKey: string): string {
  if (!baseKey || baseKey.includes('__office_')) {
    return baseKey;
  }
  if (isDefault155UasuOffice()) {
    return baseKey;
  }
  const safeCode = getActiveOfficeCode().replace(/[^A-Z0-9_-]/g, '_');
  return `${baseKey}__office_${safeCode}`;
}

export function getOfficeFirestoreDocPrefix(): string {
  if (isDefault155UasuOffice()) {
    return '';
  }
  const safeCode = getActiveOfficeCode().replace(/[^A-Z0-9_-]/g, '_');
  return `off_${safeCode}__`;
}

export function purgeOfficeLocalStorageKeys(targetOfficeCode?: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const code = String(targetOfficeCode || getActiveOfficeCode() || '')
    .toUpperCase()
    .trim();
  if (!code || code === '155-UASU' || code === '155UASU') return;
  const safeCode = code.replace(/[^A-Z0-9_-]/g, '_');
  const suffix = `__office_${safeCode}`;
  const keysToRemove: string[] = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const k = window.localStorage.key(i);
    if (k && k.endsWith(suffix)) {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach((k) => {
    try {
      window.localStorage.removeItem(k);
    } catch {}
  });
}


export async function testCustomFirebaseConnection(
  fbConfig: OfficeFirebaseConfig
): Promise<{ ok: boolean; success: boolean; error?: string; message: string }> {
  if (!fbConfig || !fbConfig.apiKey || !fbConfig.projectId) {
    const msg = 'Missing apiKey or projectId in Firebase Config.';
    return { ok: false, success: false, error: msg, message: msg };
  }
  const dbId = fbConfig.firestoreDatabaseId && fbConfig.firestoreDatabaseId !== '(default)'
    ? fbConfig.firestoreDatabaseId
    : '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    fbConfig.projectId
  )}/databases/${encodeURIComponent(
    dbId
  )}/documents/system_meta/sync_manifest?key=${encodeURIComponent(fbConfig.apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (res.ok || res.status === 404 || res.status === 403) {
      const msg = `Connected to Firebase project "${fbConfig.projectId}" successfully.`;
      return { ok: true, success: true, message: msg };
    }
    // If custom databaseId wasn't found, also test (default) database
    if (dbId !== '(default)' && res.status === 400) {
      const fallbackUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        fbConfig.projectId
      )}/databases/(default)/documents/system_meta/sync_manifest?key=${encodeURIComponent(fbConfig.apiKey)}`;
      const fallbackRes = await fetch(fallbackUrl, { method: 'GET', signal: controller.signal });
      if (fallbackRes.ok || fallbackRes.status === 404 || fallbackRes.status === 403) {
        const msg = `Connected to Firebase project "${fbConfig.projectId}" successfully.`;
        return { ok: true, success: true, message: msg };
      }
    }
    const text = await res.text().catch(() => '');
    const errMsg = `Firebase responded with HTTP ${res.status}: ${text.slice(0, 140) || res.statusText}`;
    return {
      ok: false,
      success: false,
      error: errMsg,
      message: errMsg,
    };
  } catch (err: any) {
    const errMsg =
      err?.name === 'AbortError'
        ? 'Connection timed out (7s).'
        : err?.message || 'Network error connecting to Firebase.';
    return {
      ok: false,
      success: false,
      error: errMsg,
      message: errMsg,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// 3. MASTER TELEMETRY REGISTRY (registered_offices/{projectId})
// ============================================================================
function getLocalMasterOfficesCache(): Record<string, RegisteredOfficeRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(MASTER_OFFICES_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLocalMasterOfficesCache(map: Record<string, RegisteredOfficeRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MASTER_OFFICES_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

export async function registerOfficeInMasterTelemetry(
  params: {
    officeName: string;
    officeLogo: string;
    officeSlogan?: string;
    officeBase?: string;
    officeCode?: string;
    joinPin?: string;
    firebaseConfig: OfficeFirebaseConfig;
    totalUsers?: number;
    createdAt?: string;
    configuredAt?: string;
  },
  totalUsersArg?: number
): Promise<void> {
  const baseProjectId = String(params.firebaseConfig?.projectId || firebaseConfigData.projectId || '').trim();
  if (!baseProjectId) return;

  const officeCode = String(
    params.officeCode ||
      params.firebaseConfig?.officeCode ||
      generateOfficeCodeFromName(params.officeName || 'Office')
  )
    .toUpperCase()
    .trim();
  const joinPin =
    params.joinPin || params.firebaseConfig?.joinPin
      ? String(params.joinPin || params.firebaseConfig?.joinPin).trim()
      : undefined;
  const officeSlogan =
    params.officeSlogan || params.firebaseConfig?.officeSlogan
      ? String(params.officeSlogan || params.firebaseConfig?.officeSlogan).trim()
      : undefined;
  const officeBase =
    params.officeBase || params.firebaseConfig?.officeBase
      ? String(params.officeBase || params.firebaseConfig?.officeBase).trim()
      : undefined;

  // Use a unique registry key per officeCode so multiple offices can be registered cleanly
  const registryKey = officeCode
    ? `${baseProjectId}__${officeCode.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    : baseProjectId;

  const nowIso = new Date().toISOString();
  const cache = getLocalMasterOfficesCache();
  const existing = cache[registryKey] || cache[baseProjectId];
  const resolvedTotalUsers =
    totalUsersArg !== undefined ? totalUsersArg : (params.totalUsers ?? existing?.totalUsers ?? 1);

  const record: RegisteredOfficeRecord = {
    officeName: String(params.officeName || 'Office Unit').slice(0, 200),
    officeLogo: String(params.officeLogo || '/155-uasu-baf-logo.png').slice(0, 500000),
    ...(officeSlogan ? { officeSlogan } : {}),
    ...(officeBase ? { officeBase } : {}),
    officeCode,
    ...(joinPin ? { joinPin } : {}),
    projectId: baseProjectId.slice(0, 128),
    firebaseConfig: {
      apiKey: String(params.firebaseConfig.apiKey || firebaseConfigData.apiKey || ''),
      authDomain: String(params.firebaseConfig.authDomain || `${baseProjectId}.firebaseapp.com`),
      projectId: baseProjectId,
      storageBucket: String(params.firebaseConfig.storageBucket || `${baseProjectId}.appspot.com`),
      messagingSenderId: String(params.firebaseConfig.messagingSenderId || ''),
      appId: String(params.firebaseConfig.appId || ''),
      officeCode,
      ...(joinPin ? { joinPin } : {}),
      ...(officeSlogan ? { officeSlogan } : {}),
      ...(officeBase ? { officeBase } : {}),
      ...(params.firebaseConfig.firestoreDatabaseId
        ? { firestoreDatabaseId: String(params.firebaseConfig.firestoreDatabaseId) }
        : {}),
      ...(params.firebaseConfig.adminBdNo || existing?.firebaseConfig?.adminBdNo
        ? { adminBdNo: String(params.firebaseConfig.adminBdNo || existing?.firebaseConfig?.adminBdNo) }
        : {}),
      ...(params.firebaseConfig.adminFullName || existing?.firebaseConfig?.adminFullName
        ? { adminFullName: String(params.firebaseConfig.adminFullName || existing?.firebaseConfig?.adminFullName) }
        : {}),
      ...(params.firebaseConfig.adminSurname || existing?.firebaseConfig?.adminSurname
        ? { adminSurname: String(params.firebaseConfig.adminSurname || existing?.firebaseConfig?.adminSurname) }
        : {}),
      ...(params.firebaseConfig.adminRank || existing?.firebaseConfig?.adminRank
        ? { adminRank: String(params.firebaseConfig.adminRank || existing?.firebaseConfig?.adminRank) }
        : {}),
      ...(params.firebaseConfig.adminTrade || existing?.firebaseConfig?.adminTrade
        ? { adminTrade: String(params.firebaseConfig.adminTrade || existing?.firebaseConfig?.adminTrade) }
        : {}),
      ...(params.firebaseConfig.adminRole || existing?.firebaseConfig?.adminRole
        ? { adminRole: String(params.firebaseConfig.adminRole || existing?.firebaseConfig?.adminRole) }
        : {}),
      ...(params.firebaseConfig.adminContactNo || existing?.firebaseConfig?.adminContactNo
        ? { adminContactNo: String(params.firebaseConfig.adminContactNo || existing?.firebaseConfig?.adminContactNo) }
        : {}),
    },
    totalUsers: Math.max(0, Number(resolvedTotalUsers) || 0),
    createdAt: params.createdAt || params.configuredAt || existing?.createdAt || nowIso,
    lastActive: nowIso,
  };

  cache[registryKey] = record;
  saveLocalMasterOfficesCache(cache);

  // Store only schema-validated fields in Firestore registered_offices document (throttled to avoid redundant writes)
  if (masterDbInstance && !isFirestoreQuotaExceeded()) {
    const prevSame =
      existing &&
      existing.officeName === record.officeName &&
      existing.officeLogo === record.officeLogo &&
      existing.projectId === record.projectId &&
      existing.totalUsers === record.totalUsers;
    if (!prevSame) {
      try {
        const safeDocId = registryKey.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120) || 'default_office';
        const firestorePayload = {
          officeName: record.officeName,
          officeLogo: record.officeLogo,
          projectId: record.projectId,
          firebaseConfig: record.firebaseConfig,
          totalUsers: record.totalUsers,
          createdAt: record.createdAt,
          lastActive: record.lastActive,
        };
        await setDoc(doc(masterDbInstance, 'registered_offices', safeDocId), firestorePayload, { merge: true });
      } catch (err) {
        if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, (err as any)?.message);
      }
    }
  }
}

export async function updateOfficeTelemetryUserCount(totalUsers: number): Promise<void> {
  const custom = getCustomOfficeConfig();
  const targetConfig = custom?.firebaseConfig || (firebaseConfigData as OfficeFirebaseConfig);
  const projectId = String(targetConfig?.projectId || '').trim();
  if (!projectId || projectId === 'remixed-project-id') return;

  const officeName = custom?.officeName || '155 UASU BAF';
  const officeLogo = custom?.officeLogo || '/155-uasu-baf-logo.png';
  const officeCode = custom?.officeCode || targetConfig.officeCode || generateOfficeCodeFromName(officeName);

  await registerOfficeInMasterTelemetry({
    officeName,
    officeLogo,
    officeCode,
    joinPin: custom?.joinPin || targetConfig.joinPin,
    firebaseConfig: targetConfig,
    totalUsers,
  });
}

export async function saveMasterCredentials(
  newMasterUserId: string,
  newMasterPin: string
): Promise<MasterCredentials> {
  const cleanId = String(newMasterUserId || '').replace(/^BD\/?/i, '').replace(/\s+/g, '').trim();
  const cleanPin = String(newMasterPin || '').trim();
  if (!cleanId) {
    throw new Error('Master User ID cannot be empty.');
  }
  if (!cleanPin) {
    throw new Error('Master PIN cannot be empty.');
  }
  const nowIso = new Date().toISOString();
  const creds: MasterCredentials = {
    masterUserId: cleanId,
    masterPin: cleanPin,
    isCustomPin: true,
    updatedAt: nowIso,
  };
  if (typeof window !== 'undefined') {
    setRawLocalStorageItem(MASTER_CREDENTIALS_STORAGE_KEY, JSON.stringify(creds));
    window.dispatchEvent(new CustomEvent('baf_master_credentials_updated', { detail: creds }));
  }
  if (masterDbInstance && !isFirestoreQuotaExceeded()) {
    try {
      await setDoc(
        doc(masterDbInstance, 'app_settings', MASTER_CREDENTIALS_STORAGE_KEY),
        {
          settingKey: MASTER_CREDENTIALS_STORAGE_KEY,
          value: JSON.stringify(creds),
          updatedAt: nowIso,
          updatedBy: 'master_admin',
        },
        { merge: true }
      );
    } catch (err) {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, (err as any)?.message);
    }
  }
  return creds;
}

let lastMasterCredsSyncAt = 0;
let inFlightMasterCredsPromise: Promise<MasterCredentials> | null = null;
const MASTER_READ_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes cooldown to preserve Firestore read quota

function isMasterCooldownActive(cooldownKey: string, memoryTimestamp: number): boolean {
  const now = Date.now();
  if (memoryTimestamp > 0 && now - memoryTimestamp < MASTER_READ_COOLDOWN_MS) {
    return true;
  }
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      const saved = Number(window.sessionStorage.getItem(cooldownKey) || 0);
      if (saved > 0 && now - saved < MASTER_READ_COOLDOWN_MS) {
        return true;
      }
    } catch {}
  }
  return false;
}

function markMasterCooldownTimestamp(cooldownKey: string): number {
  const now = Date.now();
  if (typeof window !== 'undefined' && window.sessionStorage) {
    try {
      window.sessionStorage.setItem(cooldownKey, String(now));
    } catch {}
  }
  return now;
}

export async function syncMasterCredentialsFromCloud(force = false): Promise<MasterCredentials> {
  const local = getMasterCredentials();
  if (!masterDbInstance || isFirestoreQuotaExceeded()) return local;
  if (!force && isMasterCooldownActive('baf_cd_master_creds', lastMasterCredsSyncAt)) {
    return local;
  }
  if (inFlightMasterCredsPromise) return inFlightMasterCredsPromise;

  inFlightMasterCredsPromise = (async () => {
    try {
      lastMasterCredsSyncAt = markMasterCooldownTimestamp('baf_cd_master_creds');
      const snap = await getDoc(doc(masterDbInstance!, 'app_settings', MASTER_CREDENTIALS_STORAGE_KEY));
      if (snap.exists()) {
        const data = snap.data();
        const rawVal = data?.value;
        if (rawVal) {
          const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
          if (parsed && parsed.masterUserId && parsed.masterPin) {
            const cloudTime = new Date(parsed.updatedAt || 0).getTime();
            const localTime = new Date(local.updatedAt || 0).getTime();
            if (cloudTime >= localTime) {
              const next: MasterCredentials = {
                masterUserId: String(parsed.masterUserId).trim(),
                masterPin: String(parsed.masterPin).trim(),
                isCustomPin: Boolean(parsed.isCustomPin ?? true),
                updatedAt: parsed.updatedAt || new Date().toISOString(),
              };
              setRawLocalStorageItem(MASTER_CREDENTIALS_STORAGE_KEY, JSON.stringify(next));
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('baf_master_credentials_updated', { detail: next }));
              }
              return next;
            }
          }
        }
      }
    } catch (err) {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, (err as any)?.message);
    } finally {
      inFlightMasterCredsPromise = null;
    }
    return local;
  })();

  return inFlightMasterCredsPromise;
}

export function getRemovedOfficeCodes(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = getRawLocalStorageItem(REMOVED_OFFICES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((c) => String(c || '').toUpperCase().trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function saveRemovedOfficeCodes(codes: string[], syncToCloud: boolean = true): void {
  const unique = Array.from(new Set(codes.map((c) => String(c || '').toUpperCase().trim()).filter(Boolean)));
  if (typeof window !== 'undefined') {
    setRawLocalStorageItem(REMOVED_OFFICES_STORAGE_KEY, JSON.stringify(unique));
  }
  if (syncToCloud && masterDbInstance && !isFirestoreQuotaExceeded()) {
    const nowIso = new Date().toISOString();
    setDoc(
      doc(masterDbInstance, 'app_settings', REMOVED_OFFICES_STORAGE_KEY),
      {
        settingKey: REMOVED_OFFICES_STORAGE_KEY,
        value: JSON.stringify(unique),
        updatedAt: nowIso,
        updatedBy: 'master_admin',
      },
      { merge: true }
    ).catch((err) => {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
    });
  }
}

export function isOfficeDisabled(officeCodeInput?: string): boolean {
  const code = String(officeCodeInput || getActiveOfficeCode() || '155-UASU')
    .toUpperCase()
    .trim();
  const cache = getLocalMasterOfficesCache();
  for (const rec of Object.values(cache)) {
    if (!rec) continue;
    const rCode = String(rec.officeCode || rec.firebaseConfig?.officeCode || '')
      .toUpperCase()
      .trim();
    if (rCode === code && rec.status === 'DISABLED') {
      return true;
    }
  }
  return false;
}

export async function toggleRegisteredOfficeStatus(
  officeCodeInput: string,
  nextStatus: 'ACTIVE' | 'DISABLED'
): Promise<void> {
  const code = String(officeCodeInput || '').toUpperCase().trim();
  if (!code) return;
  const nowIso = new Date().toISOString();
  const cache = getLocalMasterOfficesCache();
  let foundInCache = false;

  Object.keys(cache).forEach((k) => {
    const rec = cache[k];
    if (!rec) return;
    const rCode = String(
      rec.officeCode || rec.firebaseConfig?.officeCode || generateOfficeCodeFromName(rec.officeName || '')
    )
      .toUpperCase()
      .trim();
    const normCode = rCode === '155-UASU-BAF' ? '155-UASU' : rCode;
    if (normCode === code || rCode === code) {
      foundInCache = true;
      cache[k] = {
        ...rec,
        officeCode: normCode,
        status: nextStatus,
        disabledAt: nextStatus === 'DISABLED' ? nowIso : undefined,
        lastActive: nowIso,
      };
    }
  });

  if (!foundInCache && code === '155-UASU') {
    const defProf = getDefault155OfficeProfile();
    cache['default__155-UASU'] = {
      officeName: defProf.officeName || '155 UASU BAF',
      officeLogo: defProf.officeLogo || '/155-uasu-baf-logo.png',
      officeSlogan: defProf.officeSlogan || 'Intel • Surveillance • Strike',
      officeBase: defProf.officeBase || 'BAF BASE ZHR',
      officeCode: '155-UASU',
      projectId: firebaseConfigData.projectId || 'steady-weft-wf6jr',
      firebaseConfig: buildAutoCloudFirebaseConfig(defProf.officeName || '155 UASU BAF', '155-UASU'),
      totalUsers: getRealtimeOfficeUserCount('155-UASU', 48),
      status: nextStatus,
      disabledAt: nextStatus === 'DISABLED' ? nowIso : undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActive: nowIso,
    };
  }

  saveLocalMasterOfficesCache(cache);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('baf_office_config_changed'));
  }

  // Non-blocking background sync to Firestore
  if (masterDbInstance && !isFirestoreQuotaExceeded()) {
    getDocs(collection(masterDbInstance, 'registered_offices'))
      .then((snap) => {
        const updates: Promise<any>[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as RegisteredOfficeRecord;
          const rawDCode = String(
            d?.officeCode || d?.firebaseConfig?.officeCode || generateOfficeCodeFromName(d?.officeName || '')
          )
            .toUpperCase()
            .trim();
          const dCode = rawDCode === '155-UASU-BAF' ? '155-UASU' : rawDCode;
          if (dCode === code || rawDCode === code) {
            updates.push(
              setDoc(
                doc(masterDbInstance!, 'registered_offices', docSnap.id),
                {
                  officeName: String(d.officeName || code).slice(0, 200),
                  projectId: String(d.projectId || firebaseConfigData.projectId || 'default').slice(0, 128),
                  firebaseConfig: {
                    ...(d.firebaseConfig || {}),
                    status: nextStatus,
                    disabledAt: nextStatus === 'DISABLED' ? nowIso : '',
                  },
                  lastActive: nowIso,
                },
                { merge: true }
              )
            );
          }
        });
        return Promise.all(updates);
      })
      .catch((err) => {
        if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
      });
  }
}

export async function removeRegisteredOffice(officeCodeInput: string): Promise<void> {
  const code = String(officeCodeInput || '').toUpperCase().trim();
  if (!code) return;

  // 1. Add to removed office codes list immediately so it never resurrects
  const removed = getRemovedOfficeCodes();
  if (!removed.includes(code)) {
    removed.push(code);
    saveRemovedOfficeCodes(removed, true);
  }

  // 2. Remove from local master offices cache immediately
  const cache = getLocalMasterOfficesCache();
  Object.keys(cache).forEach((k) => {
    const rec = cache[k];
    const rCode = String(
      rec?.officeCode || rec?.firebaseConfig?.officeCode || generateOfficeCodeFromName(rec?.officeName || '')
    )
      .toUpperCase()
      .trim();
    const normCode = rCode === '155-UASU-BAF' ? '155-UASU' : rCode;
    if (rCode === code || normCode === code) {
      delete cache[k];
    }
  });
  saveLocalMasterOfficesCache(cache);

  // 3. Remove from Global User -> Office Directory immediately
  const globalMap = getGlobalUserOfficeMap();
  let mapChanged = false;
  Object.keys(globalMap).forEach((bdKey) => {
    const entry = globalMap[bdKey];
    if (entry && String(entry.officeCode || '').toUpperCase().trim() === code) {
      delete globalMap[bdKey];
      mapChanged = true;
    }
  });
  if (mapChanged) {
    saveGlobalUserOfficeMap(globalMap, true);
  }

  // 4. Purge scoped localStorage keys for that office
  purgeOfficeLocalStorageKeys(code);

  // 5. Also remove any matching registration request so the office name can be registered again if needed
  const reqs = getPendingOfficeRequestsLocal().filter(
    (r) => String(r.officeCode || '').toUpperCase().trim() !== code
  );
  savePendingOfficeRequestsLocal(reqs, true);

  // 6. If currently active office was removed, reset to default immediately
  if (getActiveOfficeCode() === code && code !== '155-UASU') {
    clearCustomOfficeConfig();
  } else if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('baf_office_config_changed'));
  }

  // 7. Non-blocking background soft-remove in Firestore registered_offices collection (compatible with allow delete: if false)
  if (masterDbInstance && !isFirestoreQuotaExceeded()) {
    const nowIso = new Date().toISOString();
    getDocs(collection(masterDbInstance, 'registered_offices'))
      .then((snap) => {
        const updates: Promise<any>[] = [];
        snap.forEach((docSnap) => {
          const d = docSnap.data() as RegisteredOfficeRecord;
          const dCode = String(
            d?.officeCode || d?.firebaseConfig?.officeCode || generateOfficeCodeFromName(d?.officeName || '')
          )
            .toUpperCase()
            .trim();
          const normCode = dCode === '155-UASU-BAF' ? '155-UASU' : dCode;
          if (dCode === code || normCode === code) {
            updates.push(
              setDoc(
                doc(masterDbInstance!, 'registered_offices', docSnap.id),
                {
                  officeName: String(d.officeName || code).slice(0, 200),
                  projectId: String(d.projectId || firebaseConfigData.projectId || 'default').slice(0, 128),
                  firebaseConfig: {
                    ...(d.firebaseConfig || {}),
                    status: 'REMOVED',
                  },
                  lastActive: nowIso,
                },
                { merge: true }
              )
            );
          }
        });
        return Promise.all(updates);
      })
      .catch((err) => {
        if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
      });
  }
}

function isForeignOfficeLeakedInto155(a: any): boolean {
  if (!a || typeof a !== 'object') return false;
  const remarks = String(a.remarks || '').trim();
  if (remarks.startsWith('Approved Office Registration')) return true;
  const sqn = String(a.sqn || '').trim().toUpperCase();
  if (sqn && sqn !== '155 UASU BAF' && sqn !== '155 UASU' && sqn !== '155-UASU') {
    return true;
  }
  const idStr = String(a.id || '').trim();
  if (idStr.startsWith('off_')) return true;
  return false;
}

export function getRealtimeOfficeUserCount(officeCodeInput: string, fallbackCount?: number): number {
  const code = String(officeCodeInput || '155-UASU').toUpperCase().trim();
  const is155 = code === '155-UASU' || code === '155UASU' || code === '155-UASU-BAF';
  const safeCode = code.replace(/[^A-Z0-9_-]/g, '_');
  const masterId = getMasterUserId();

  const isMasterBd = (bdRaw: any): boolean => {
    const clean = String(bdRaw || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
    return !clean || clean === '48456' || clean === masterId || clean === '53539919';
  };

  // 1. Check local database airmen (`baf_155_uasu_v2_db` / `baf_local_db_v3` or office-scoped equivalents)
  const candidateDbKeys = is155
    ? ['baf_155_uasu_v2_db', 'baf_local_db_v3']
    : [`baf_155_uasu_v2_db__office_${safeCode}`, `baf_local_db_v3__office_${safeCode}`];

  for (const dbKey of candidateDbKeys) {
    try {
      const rawDb = getRawLocalStorageItem(dbKey);
      if (rawDb) {
        const parsedDb = JSON.parse(rawDb);
        if (parsedDb && Array.isArray(parsedDb.airmen) && parsedDb.airmen.length > 0) {
          let cleanedList = parsedDb.airmen;
          if (is155) {
            const filteredForeign = cleanedList.filter((a: any) => !isForeignOfficeLeakedInto155(a));
            if (filteredForeign.length !== cleanedList.length) {
              cleanedList = filteredForeign;
              try {
                parsedDb.airmen = cleanedList;
                setRawLocalStorageItem(dbKey, JSON.stringify(parsedDb));
              } catch {}
            }
          }

          const seenBds = new Set<string>();
          const activeAirmen = cleanedList.filter((a: any) => {
            if (!a || isAirmanPostedOut(a) || isMasterBd(a.bdNo)) return false;
            if (is155 && isForeignOfficeLeakedInto155(a)) return false;
            const cleanBd = String(a.bdNo || a.id || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
            if (!cleanBd || seenBds.has(cleanBd)) return false;
            seenBds.add(cleanBd);
            return true;
          });
          if (activeAirmen.length > 0) {
            return activeAirmen.length;
          }
        }
      }
    } catch {}
  }

  // 2. Check scoped detailed user logins (`baf_detailed_user_logins__office_${safeCode}`)
  if (!is155) {
    try {
      const rawUsers = getRawLocalStorageItem(`baf_detailed_user_logins__office_${safeCode}`);
      if (rawUsers) {
        const parsedUsers = JSON.parse(rawUsers);
        if (Array.isArray(parsedUsers)) {
          const seenBds = new Set<string>();
          const activeUsers = parsedUsers.filter((u: any) => {
            if (
              !u ||
              u.status === 'SUSPENDED' ||
              u.status === 'DISABLED' ||
              isAirmanPostedOut(u) ||
              isMasterBd(u.bdNo || u.userId)
            ) {
              return false;
            }
            const cleanBd = String(u.bdNo || u.userId || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
            if (!cleanBd || seenBds.has(cleanBd)) return false;
            seenBds.add(cleanBd);
            return true;
          });
          return activeUsers.length;
        }
      }
    } catch {}
  }

  // 3. Count active users for this office in Global User -> Office Map
  try {
    const globalMap = getGlobalUserOfficeMap();
    const mapMatches = Object.values(globalMap).filter(
      (entry) =>
        entry &&
        String(entry.officeCode || '').toUpperCase().trim() === code &&
        !entry.isPostedOut &&
        entry.active !== false &&
        !isMasterBd(entry.bdNo)
    );
    if (mapMatches.length > 0) {
      return mapMatches.length;
    }
  } catch {}

  if (is155) {
    return 48;
  }
  return Math.max(0, Number(fallbackCount) || 0);
}

export function getOfficeLoginHistoryLocal(officeCodeInput?: string): any[] {
  const code = String(officeCodeInput || getActiveOfficeCode() || '155-UASU')
    .toUpperCase()
    .trim();
  const safeCode = code.replace(/[^A-Z0-9_-]/g, '_');
  const is155 = code === '155-UASU' || code === '155UASU' || code === '155-UASU-BAF';
  const localKey = is155
    ? 'baf_user_login_history'
    : `baf_user_login_history__office_${safeCode}`;
  const masterId = getMasterUserId();

  try {
    const raw = getRawLocalStorageItem(localKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => {
            if (!item) return false;
            const cleanBd = String(item.bdNo || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
            return cleanBd !== '48456' && cleanBd !== masterId;
          })
          .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
      }
    }
  } catch {}
  return [];
}

export async function fetchOfficeLoginHistory(officeCodeInput?: string): Promise<any[]> {
  const code = String(officeCodeInput || getActiveOfficeCode() || '155-UASU')
    .toUpperCase()
    .trim();
  const safeCode = code.replace(/[^A-Z0-9_-]/g, '_');
  const is155 = code === '155-UASU' || code === '155UASU' || code === '155-UASU-BAF';
  const localKey = is155
    ? 'baf_user_login_history'
    : `baf_user_login_history__office_${safeCode}`;
  const cloudDocId = is155
    ? 'baf_user_login_history'
    : `off_${safeCode}__baf_user_login_history`;
  const masterId = getMasterUserId();

  const localLogs = getOfficeLoginHistoryLocal(code);

  let cloudLogs: any[] = [];
  if (masterDbInstance && !isFirestoreQuotaExceeded()) {
    try {
      const snap = await getDoc(doc(masterDbInstance, 'app_settings', cloudDocId));
      if (snap.exists()) {
        const d = snap.data() as any;
        if (Array.isArray(d?.value)) {
          cloudLogs = d.value;
        } else if (typeof d?.value === 'string') {
          const parsed = JSON.parse(d.value);
          if (Array.isArray(parsed)) cloudLogs = parsed;
        }
      }
    } catch (err) {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, (err as any)?.message);
    }
  }

  const mergedMap = new Map<string, any>();
  [...localLogs, ...cloudLogs].forEach((item) => {
    if (!item) return;
    const cleanBd = String(item.bdNo || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
    if (cleanBd === '48456' || cleanBd === masterId) return;
    const key = item.id || `${item.bdNo}_${item.timestamp}`;
    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    }
  });

  const merged = Array.from(mergedMap.values()).sort(
    (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
  );

  try {
    setRawLocalStorageItem(localKey, JSON.stringify(merged));
  } catch {}

  return merged;
}

export async function clearOfficeLoginHistoryByCode(officeCodeInput?: string): Promise<void> {
  const code = String(officeCodeInput || getActiveOfficeCode() || '155-UASU')
    .toUpperCase()
    .trim();
  const safeCode = code.replace(/[^A-Z0-9_-]/g, '_');
  const is155 = code === '155-UASU' || code === '155UASU' || code === '155-UASU-BAF';
  const localKey = is155
    ? 'baf_user_login_history'
    : `baf_user_login_history__office_${safeCode}`;
  const cloudDocId = is155
    ? 'baf_user_login_history'
    : `off_${safeCode}__baf_user_login_history`;

  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(localKey);
      if (code === getActiveOfficeCode()) {
        window.dispatchEvent(new CustomEvent('baf_login_history_updated', { detail: [] }));
      }
    }
    if (masterDbInstance && !isFirestoreQuotaExceeded()) {
      setDoc(
        doc(masterDbInstance, 'app_settings', cloudDocId),
        {
          settingKey: cloudDocId,
          value: [],
          updatedAt: new Date().toISOString(),
          updatedBy: 'master_admin',
        },
        { merge: true }
      ).catch((err) => {
        if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
      });
    }
  } catch {}
}

export function getRegisteredOfficesLocal(): RegisteredOfficeRecord[] {
  const cache = getLocalMasterOfficesCache();
  const removedCodes = getRemovedOfficeCodes();
  const mergedMap = new Map<string, RegisteredOfficeRecord>();

  const defaultCode = '155-UASU';
  if (!removedCodes.includes(defaultCode)) {
    const defProf = getDefault155OfficeProfile();
    mergedMap.set(defaultCode, {
      officeName: defProf.officeName || '155 UASU BAF',
      officeLogo: defProf.officeLogo || '/155-uasu-baf-logo.png',
      officeSlogan: defProf.officeSlogan || 'Intel • Surveillance • Strike',
      officeBase: defProf.officeBase || 'BAF BASE ZHR',
      officeCode: defaultCode,
      projectId: firebaseConfigData.projectId || 'steady-weft-wf6jr',
      firebaseConfig: buildAutoCloudFirebaseConfig(defProf.officeName || '155 UASU BAF', defaultCode),
      totalUsers: getRealtimeOfficeUserCount(defaultCode, 48),
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastActive: new Date().toISOString(),
    });
  }

  Object.values(cache).forEach((rec) => {
    if (rec && (rec.officeName || rec.projectId)) {
      const rawCode =
        rec.officeCode ||
        rec.firebaseConfig?.officeCode ||
        generateOfficeCodeFromName(rec.officeName || rec.projectId);
      const code =
        rawCode.toUpperCase().trim() === '155-UASU-BAF' ||
        String(rec.officeName || '').trim().toUpperCase() === '155 UASU BAF'
          ? '155-UASU'
          : rawCode.toUpperCase().trim();
      if (removedCodes.includes(code)) return;
      const prev = mergedMap.get(code);
      mergedMap.set(code, {
        ...prev,
        ...rec,
        officeLogo: normalizeOfficeLogoUrl(rec.officeLogo || prev?.officeLogo, code === '155-UASU'),
        officeCode: code,
        joinPin: rec.joinPin || rec.firebaseConfig?.joinPin || prev?.joinPin,
        status: rec.status || prev?.status || 'ACTIVE',
        totalUsers: getRealtimeOfficeUserCount(code, rec.totalUsers),
      });
    }
  });

  const currentCustom = getCustomOfficeConfig();
  if (currentCustom && currentCustom.officeName) {
    const rawCode = (
      currentCustom.officeCode ||
      currentCustom.firebaseConfig?.officeCode ||
      generateOfficeCodeFromName(currentCustom.officeName)
    )
      .toUpperCase()
      .trim();
    const code = rawCode === '155-UASU-BAF' ? '155-UASU' : rawCode;
    if (!removedCodes.includes(code)) {
      const existing = mergedMap.get(code);
      mergedMap.set(code, {
        officeName: currentCustom.officeName,
        officeLogo: normalizeOfficeLogoUrl(currentCustom.officeLogo, code === '155-UASU'),
        officeSlogan: currentCustom.officeSlogan,
        officeBase: currentCustom.officeBase,
        officeCode: code,
        joinPin: currentCustom.joinPin || currentCustom.firebaseConfig?.joinPin,
        projectId: currentCustom.firebaseConfig?.projectId || firebaseConfigData.projectId,
        firebaseConfig: currentCustom.firebaseConfig,
        status: existing?.status || 'ACTIVE',
        totalUsers: getRealtimeOfficeUserCount(code, existing?.totalUsers || 1),
        createdAt: currentCustom.configuredAt || existing?.createdAt || new Date().toISOString(),
        lastActive: new Date().toISOString(),
      });
    }
  }

  return Array.from(mergedMap.values()).sort(
    (a, b) => new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime()
  );
}

let lastRegisteredOfficesFetchAt = 0;
let inFlightRegisteredOfficesPromise: Promise<RegisteredOfficeRecord[]> | null = null;

export async function fetchRegisteredOfficesFromMaster(force = false): Promise<RegisteredOfficeRecord[]> {
  if (!masterDbInstance || isFirestoreQuotaExceeded()) {
    return getRegisteredOfficesLocal();
  }
  if (!force && isMasterCooldownActive('baf_cd_reg_offices', lastRegisteredOfficesFetchAt)) {
    return getRegisteredOfficesLocal();
  }
  if (inFlightRegisteredOfficesPromise) {
    return inFlightRegisteredOfficesPromise;
  }

  inFlightRegisteredOfficesPromise = (async () => {
    try {
      lastRegisteredOfficesFetchAt = markMasterCooldownTimestamp('baf_cd_reg_offices');
      const cache = getLocalMasterOfficesCache();
      let removedCodes = getRemovedOfficeCodes();
      const mergedMap = new Map<string, RegisteredOfficeRecord>();

      // Seed from local immediately
      getRegisteredOfficesLocal().forEach((off) => {
        const code = String(off.officeCode || '155-UASU').toUpperCase().trim();
        mergedMap.set(code, off);
      });

      try {
        const remSnap = await getDoc(doc(masterDbInstance!, 'app_settings', REMOVED_OFFICES_STORAGE_KEY));
        if (remSnap.exists()) {
          const d = remSnap.data();
          if (d?.value) {
            const parsedRem = typeof d.value === 'string' ? JSON.parse(d.value) : d.value;
            if (Array.isArray(parsedRem)) {
              removedCodes = Array.from(
                new Set([...removedCodes, ...parsedRem.map((c: any) => String(c || '').toUpperCase().trim())])
              );
              saveRemovedOfficeCodes(removedCodes, false);
              removedCodes.forEach((rc) => mergedMap.delete(rc));
            }
          }
        }
      } catch (err) {
        if (isQuotaExceededError(err)) {
          setFirestoreQuotaExceeded(true, (err as any)?.message);
          return getRegisteredOfficesLocal();
        }
      }

      try {
        const snap = await getDocs(collection(masterDbInstance!, 'registered_offices'));
        snap.forEach((docSnap) => {
          const d = docSnap.data() as RegisteredOfficeRecord;
          if (d && d.officeName) {
            const rawCode = (
              d.officeCode ||
              d.firebaseConfig?.officeCode ||
              generateOfficeCodeFromName(d.officeName)
            )
              .toUpperCase()
              .trim();
            const code =
              rawCode === '155-UASU-BAF' || d.officeName.trim().toUpperCase() === '155 UASU BAF'
                ? '155-UASU'
                : rawCode;
            const cloudStatus = (d as any).status || (d.firebaseConfig as any)?.status;
            if (cloudStatus === 'REMOVED' || removedCodes.includes(code)) return;
            const prev = mergedMap.get(code);
            const resolvedStatus: 'ACTIVE' | 'DISABLED' =
              cloudStatus === 'DISABLED' || prev?.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE';
            const enriched: RegisteredOfficeRecord = {
              ...prev,
              ...d,
              officeLogo: normalizeOfficeLogoUrl(d.officeLogo || prev?.officeLogo, code === '155-UASU'),
              officeCode: code,
              status: resolvedStatus,
              joinPin: d.joinPin || d.firebaseConfig?.joinPin || prev?.joinPin,
              totalUsers: getRealtimeOfficeUserCount(code, d.totalUsers),
            };
            mergedMap.set(code, enriched);
            cache[`${d.projectId}__${code}`] = enriched;
          }
        });
        saveLocalMasterOfficesCache(cache);
      } catch (err) {
        if (isQuotaExceededError(err)) {
          setFirestoreQuotaExceeded(true, (err as any)?.message);
        }
      }

      const finalOffices = Array.from(mergedMap.values())
        .filter((off) => !removedCodes.includes(String(off.officeCode || '').toUpperCase().trim()))
        .map((off) => {
          const code = String(off.officeCode || '155-UASU').toUpperCase().trim();
          return {
            ...off,
            totalUsers: getRealtimeOfficeUserCount(code, off.totalUsers),
          };
        });

      return finalOffices.sort(
        (a, b) => new Date(b.lastActive || 0).getTime() - new Date(a.lastActive || 0).getTime()
      );
    } finally {
      inFlightRegisteredOfficesPromise = null;
    }
  })();

  return inFlightRegisteredOfficesPromise;
}

// ============================================================================
// 4. GLOBAL USER -> OFFICE DIRECTORY (Matches BD No to Office Name & Workspace)
// ============================================================================
export function getGlobalUserOfficeMap(): Record<string, GlobalUserOfficeEntry> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = getRawLocalStorageItem(GLOBAL_USER_OFFICE_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

let lastSavedGlobalMapHash = '';

function computeGlobalMapContentHash(map: Record<string, GlobalUserOfficeEntry>): string {
  try {
    const keys = Object.keys(map).sort();
    return keys
      .map((k) => {
        const e = map[k];
        if (!e) return '';
        return `${e.bdNo}|${e.userName}|${e.rank}|${e.flightName || ''}|${e.trade || ''}|${e.role || ''}|${e.pin || ''}|${e.officeCode}|${e.officeName}|${Boolean(e.isPostedOut)}|${Boolean(e.active)}`;
      })
      .join('~');
  } catch {
    return '';
  }
}

export function saveGlobalUserOfficeMap(
  map: Record<string, GlobalUserOfficeEntry>,
  syncToCloud: boolean = true
): void {
  if (typeof window === 'undefined') return;
  const serialized = JSON.stringify(map);
  const newHash = computeGlobalMapContentHash(map);
  const isUnchanged = Boolean(newHash && newHash === lastSavedGlobalMapHash);
  lastSavedGlobalMapHash = newHash;

  try {
    setRawLocalStorageItem(GLOBAL_USER_OFFICE_MAP_KEY, serialized);
  } catch {}

  if (syncToCloud && !isUnchanged && masterDbInstance && !isFirestoreQuotaExceeded()) {
    const nowIso = new Date().toISOString();
    setDoc(
      doc(masterDbInstance, 'app_settings', GLOBAL_USER_OFFICE_MAP_KEY),
      {
        settingKey: GLOBAL_USER_OFFICE_MAP_KEY,
        value: serialized,
        updatedAt: nowIso,
        updatedBy: 'system',
      },
      { merge: true }
    ).catch((err) => {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
    });
  }
}

export function registerUsersInGlobalOfficeDirectory(
  users: Array<{
    bdNo?: string;
    userId?: string;
    name?: string;
    fullName?: string;
    rank?: string;
    flightName?: string;
    trade?: string;
    role?: string;
    pin?: string;
    password?: string;
  }>,
  officeIdentityOverride?: {
    officeCode: string;
    officeName: string;
    officeLogo: string;
    officeSlogan: string;
    officeBase: string;
    isDefault155: boolean;
    officeConfig?: CustomOfficeConfig;
  },
  syncToCloud: boolean = true
): void {
  if (!Array.isArray(users) || users.length === 0) return;

  const activeIdentity = getActiveOfficeIdentity();
  const customCfg = getCustomOfficeConfig();
  const isDefault155 =
    officeIdentityOverride !== undefined
      ? officeIdentityOverride.isDefault155
      : isDefault155UasuOffice();
  const officeCode = String(
    officeIdentityOverride?.officeCode || activeIdentity.officeCode || '155-UASU'
  )
    .toUpperCase()
    .trim();
  const officeName =
    officeIdentityOverride?.officeName || activeIdentity.officeName || '155 UASU BAF';
  const officeLogo =
    officeIdentityOverride?.officeLogo || activeIdentity.officeLogo || '/155-uasu-baf-logo.png';
  const officeSlogan = sanitizeOfficeSlogan(
    officeIdentityOverride?.officeSlogan !== undefined
      ? officeIdentityOverride.officeSlogan
      : activeIdentity.officeSlogan,
    isDefault155
  );
  const officeBase =
    officeIdentityOverride?.officeBase || activeIdentity.officeBase || 'BAF BASE ZHR';
  const resolvedConfig =
    officeIdentityOverride?.officeConfig ||
    (!isDefault155
      ? customCfg || {
          officeName,
          officeLogo,
          officeSlogan,
          officeBase,
          officeCode,
          firebaseConfig: buildAutoCloudFirebaseConfig(officeName, officeCode),
        }
      : undefined);

  const map = getGlobalUserOfficeMap();
  if (!lastSavedGlobalMapHash) {
    lastSavedGlobalMapHash = computeGlobalMapContentHash(map);
  }
  const nowIso = new Date().toISOString();
  let changed = false;

  users.forEach((u) => {
    const cleanBd = String(u.bdNo || u.userId || '')
      .replace(/^BD\/?/i, '')
      .replace(/[^0-9]/g, '')
      .trim();
    if (!cleanBd || cleanBd === MASTER_USER_ID || cleanBd === '53539919') return;

    const existing = map[cleanBd];
    const resolvedPin = String(u.pin || u.password || existing?.pin || cleanBd).trim();
    const resolvedName = String(u.fullName || u.name || existing?.userName || 'Airman').trim();
    const resolvedRank = String(u.rank || existing?.rank || 'LAC').trim();
    const resolvedFlight = u.flightName !== undefined ? u.flightName : (existing?.flightName || (isDefault155 ? 'Admin' : ''));
    const resolvedTrade = u.trade || existing?.trade || 'General';
    const resolvedRole = u.role || existing?.role || 'USER';
    const isPostedOut = isAirmanPostedOut(u);

    const isSame =
      existing &&
      existing.userName === resolvedName &&
      existing.rank === resolvedRank &&
      (existing.flightName || '') === (resolvedFlight || '') &&
      (existing.trade || 'General') === resolvedTrade &&
      (existing.role || 'USER') === resolvedRole &&
      existing.pin === resolvedPin &&
      existing.officeCode === officeCode &&
      existing.officeName === officeName &&
      existing.officeLogo === officeLogo &&
      Boolean(existing.isPostedOut) === Boolean(isPostedOut) &&
      Boolean(existing.active) === Boolean(!isPostedOut);

    if (!isSame) {
      map[cleanBd] = {
        bdNo: cleanBd,
        userName: resolvedName,
        rank: resolvedRank,
        flightName: resolvedFlight,
        trade: resolvedTrade,
        role: resolvedRole,
        pin: resolvedPin,
        officeCode,
        officeName,
        officeLogo,
        officeSlogan,
        officeBase,
        isDefault155,
        isPostedOut,
        active: !isPostedOut,
        ...(resolvedConfig ? { officeConfig: resolvedConfig } : {}),
        updatedAt: nowIso,
      };
      changed = true;
    }
  });

  if (changed) {
    saveGlobalUserOfficeMap(map, syncToCloud);
  }
}

export function isAirmanPostedOut(record: any): boolean {
  if (!record || typeof record !== 'object') return false;
  if (record.isPostedOut === true) return true;
  if (record.active === false) return true;
  const statusStr = String(record.status || '').toUpperCase().trim();
  if (
    statusStr === 'POSTED_OUT' ||
    statusStr === 'POSTED OUT' ||
    statusStr === 'INACTIVE' ||
    statusStr === 'SUSPENDED' ||
    statusStr === 'DISABLED'
  ) {
    return true;
  }
  if (Boolean(String(record.dateLeft || '').trim())) {
    return true;
  }
  const leaveReasonStr = String(record.leaveReason || '').toLowerCase().trim();
  if (leaveReasonStr === 'posted out' || leaveReasonStr === 'rtu' || leaveReasonStr === 'medical') {
    if (record.active === false || Boolean(record.dateLeft)) return true;
  }
  return false;
}

export function isUserPostedOutInOfficeStorage(
  cleanBd: string,
  officeCode: string,
  isDefault155: boolean,
  fallbackAirmen: any[] = []
): boolean {
  if (!cleanBd) return false;
  const safeCode = String(officeCode || '')
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_-]/g, '_');

  const checkDbKeys =
    isDefault155 || safeCode === '155-UASU' || safeCode === '155_UASU'
      ? ['baf_155_uasu_v2_db', 'baf_local_db_v3']
      : [`baf_155_uasu_v2_db__office_${safeCode}`, `baf_local_db_v3__office_${safeCode}`];

  for (const checkDbKey of checkDbKeys) {
    try {
      const rawDb = getRawLocalStorageItem(checkDbKey);
      if (rawDb) {
        const parsedDb = JSON.parse(rawDb);
        if (parsedDb && Array.isArray(parsedDb.airmen)) {
          const matches = parsedDb.airmen.filter((a: any) => {
            const aBd = String(a.bdNo || '')
              .replace(/^BD\/?/i, '')
              .replace(/[^0-9]/g, '')
              .trim();
            return aBd === cleanBd;
          });
          if (matches.length > 0) {
            const hasActive = matches.some((m: any) => !isAirmanPostedOut(m));
            return !hasActive;
          }
        }
      }
    } catch {}
  }

  if ((isDefault155 || safeCode === '155-UASU') && Array.isArray(fallbackAirmen) && fallbackAirmen.length > 0) {
    const fMatches = fallbackAirmen.filter((a: any) => {
      const aBd = String(a.bdNo || '')
        .replace(/^BD\/?/i, '')
        .replace(/[^0-9]/g, '')
        .trim();
      return aBd === cleanBd;
    });
    if (fMatches.length > 0) {
      const hasActive = fMatches.some((m: any) => !isAirmanPostedOut(m));
      return !hasActive;
    }
  }

  return false;
}

export function markUserPostedOutInGlobalDirectory(bdInput: string, isPostedOut: boolean): void {
  const cleanBd = String(bdInput || '')
    .replace(/^BD\/?/i, '')
    .replace(/[^0-9]/g, '')
    .trim();
  if (!cleanBd || cleanBd === MASTER_USER_ID) return;
  const activeIdentity = getActiveOfficeIdentity();
  const currentCode = String(activeIdentity.officeCode || '155-UASU').toUpperCase().trim();
  const map = getGlobalUserOfficeMap();
  if (map[cleanBd]) {
    const entryCode = String(map[cleanBd].officeCode || '155-UASU').toUpperCase().trim();
    if (entryCode === currentCode) {
      map[cleanBd] = {
        ...map[cleanBd],
        isPostedOut,
        active: !isPostedOut,
        updatedAt: new Date().toISOString(),
      };
      saveGlobalUserOfficeMap(map, true);
    }
  }
}

export function isOfficeNameAlreadyRegistered(
  officeNameInput: string,
  registeredOffices: RegisteredOfficeRecord[] = [],
  pendingRequests: PendingOfficeRegistrationRequest[] = []
): boolean {
  const normalizedInput = String(officeNameInput || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!normalizedInput) return false;

  // Check default 155 UASU BAF (Full Name Match only)
  const defProfile = getDefault155OfficeProfile();
  const defNameNorm = String(defProfile.officeName || '155 UASU BAF')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (normalizedInput === defNameNorm || normalizedInput === '155 UASU BAF') {
    return true;
  }

  const removedCodes = getRemovedOfficeCodes();

  // Check local master cache + passed registeredOffices (Full Name Match only)
  const cacheMap = getLocalMasterOfficesCache();
  const allReg = [...Object.values(cacheMap), ...registeredOffices];
  for (const off of allReg) {
    if (!off) continue;
    const offStatus = (off as any).status || (off.firebaseConfig as any)?.status;
    const offCode = String(off.officeCode || off.firebaseConfig?.officeCode || '')
      .trim()
      .toUpperCase();
    if (offStatus === 'REMOVED' || (offCode && removedCodes.includes(offCode))) {
      continue;
    }
    const offName = String(off.officeName || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    if (offName && offName === normalizedInput) {
      return true;
    }
  }

  // Check pending requests (PENDING or APPROVED - Full Name Match only)
  const localReqs = getPendingOfficeRequestsLocal();
  const allReqs = [...localReqs, ...pendingRequests];
  for (const req of allReqs) {
    if (!req || req.status === 'REJECTED') continue;
    const reqCode = String(req.officeCode || '').trim().toUpperCase();
    if (req.status === 'APPROVED' && reqCode && removedCodes.includes(reqCode)) {
      continue;
    }
    const reqName = String(req.officeName || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
    if (reqName && reqName === normalizedInput) {
      return true;
    }
  }

  return false;
}

export function doesOfficeHaveFlights(
  airmen?: Array<{ flightName?: string; active?: boolean }>
): boolean {
  if (!isDefault155UasuOffice()) {
    return false;
  }
  if (Array.isArray(airmen) && airmen.length > 0) {
    return airmen.some((a) => Boolean(String(a?.flightName || '').trim()));
  }
  return true;
}

function getDefault155OfficeProfile(): OfficeProfileData {
  try {
    const raw = getRawLocalStorageItem(OFFICE_PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          officeName: String(parsed.officeName || '155 UASU BAF').trim() || '155 UASU BAF',
          officeLogo: normalizeOfficeLogoUrl(parsed.officeLogo, true),
          officeSlogan:
            String(parsed.officeSlogan || 'Intel • Surveillance • Strike').trim() ||
            'Intel • Surveillance • Strike',
          officeBase: String(parsed.officeBase || 'BAF BASE ZHR').trim() || 'BAF BASE ZHR',
        };
      }
    }
  } catch {}
  return {
    officeName: '155 UASU BAF',
    officeLogo: '/155-uasu-baf-logo.png',
    officeSlogan: 'Intel • Surveillance • Strike',
    officeBase: 'BAF BASE ZHR',
  };
}

export function findOfficeByUserId(
  bdInput: string,
  fallbackAirmen: Array<{
    bdNo?: string;
    name?: string;
    fullName?: string;
    rank?: string;
    flightName?: string;
    trade?: string;
    role?: string;
    active?: boolean;
    dateLeft?: string;
    leaveReason?: string;
  }> = []
): GlobalUserOfficeEntry | null {
  const cleanBd = String(bdInput || '')
    .replace(/^BD\/?/i, '')
    .replace(/[^0-9]/g, '')
    .trim();
  if (!cleanBd) return null;

  if (cleanBd === MASTER_USER_ID || cleanBd === getMasterUserId()) {
    const currentIdentity = getActiveOfficeIdentity();
    return {
      bdNo: getMasterUserId(),
      userName: 'System Master Owner',
      rank: 'MWO',
      flightName: 'Admin',
      trade: 'System Control',
      role: 'master_owner',
      pin: getMasterUserPin(),
      officeCode: currentIdentity.officeCode || '155-UASU',
      officeName: currentIdentity.officeName || '155 UASU BAF',
      officeLogo: currentIdentity.officeLogo || '/155-uasu-baf-logo.png',
      officeSlogan: currentIdentity.officeSlogan || 'Intel • Surveillance • Strike',
      officeBase: currentIdentity.officeBase || 'BAF BASE ZHR',
      isDefault155: !currentIdentity.isCustom,
      officeConfig: getCustomOfficeConfig() || undefined,
      updatedAt: new Date().toISOString(),
    };
  }

  // 1. Check Global User -> Office Map first (instant lookup across all registered offices)
  const globalMap = getGlobalUserOfficeMap();
  if (globalMap[cleanBd]) {
    const hit = globalMap[cleanBd];
    const postedOutInHitOffice =
      hit.isPostedOut === true ||
      hit.active === false ||
      isUserPostedOutInOfficeStorage(cleanBd, hit.officeCode, hit.isDefault155, fallbackAirmen);

    if (!postedOutInHitOffice) {
      const officesCache = getLocalMasterOfficesCache();
      const matchedRegOffice = Object.values(officesCache).find(
        (r) =>
          String(r.officeCode || r.firebaseConfig?.officeCode || '')
            .toUpperCase()
            .trim() === String(hit.officeCode || '').toUpperCase().trim()
      );
      if (matchedRegOffice && !hit.isDefault155) {
        return {
          ...hit,
          officeName: matchedRegOffice.officeName || hit.officeName,
          officeLogo: normalizeOfficeLogoUrl(matchedRegOffice.officeLogo || hit.officeLogo, false),
          officeSlogan:
            matchedRegOffice.officeSlogan ||
            matchedRegOffice.firebaseConfig?.officeSlogan ||
            hit.officeSlogan,
          officeBase:
            matchedRegOffice.officeBase ||
            matchedRegOffice.firebaseConfig?.officeBase ||
            hit.officeBase,
          officeConfig:
            hit.officeConfig || {
              officeName: matchedRegOffice.officeName,
              officeLogo: normalizeOfficeLogoUrl(matchedRegOffice.officeLogo, false),
              officeSlogan: matchedRegOffice.officeSlogan,
              officeBase: matchedRegOffice.officeBase,
              officeCode: matchedRegOffice.officeCode,
              joinPin: matchedRegOffice.joinPin,
              firebaseConfig: matchedRegOffice.firebaseConfig,
            },
        };
      }
      const isHit155 = Boolean(
        hit.isDefault155 ||
          String(hit.officeCode || '')
            .toUpperCase()
            .includes('155')
      );
      return {
        ...hit,
        officeLogo: normalizeOfficeLogoUrl(
          matchedRegOffice?.officeLogo || hit.officeLogo,
          isHit155
        ),
      };
    }
  }

  // 2. Scan any custom office localStorage keys (`baf_detailed_user_logins__office_<CODE>` & `baf_local_db_v3__office_<CODE>`)
  if (typeof window !== 'undefined' && window.localStorage) {
    const officesCache = getLocalMasterOfficesCache();
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('baf_detailed_user_logins__office_')) {
        const safeCode = k.replace('baf_detailed_user_logins__office_', '').trim();
        if (!safeCode) continue;
        if (isUserPostedOutInOfficeStorage(cleanBd, safeCode, false, fallbackAirmen)) {
          continue;
        }
        try {
          const rawUsers = getRawLocalStorageItem(k);
          if (!rawUsers) continue;
          const users = JSON.parse(rawUsers);
          if (!Array.isArray(users)) continue;
          const foundUser = users.find((u: any) => {
            const uBd = String(u.bdNo || u.userId || '')
              .replace(/^BD\/?/i, '')
              .replace(/[^0-9]/g, '')
              .trim();
            return uBd === cleanBd && !isAirmanPostedOut(u);
          });
          if (foundUser) {
            const rawProf = getRawLocalStorageItem(`${OFFICE_PROFILE_STORAGE_KEY}__office_${safeCode}`);
            const prof = rawProf ? JSON.parse(rawProf) : null;
            const regOffice = Object.values(officesCache).find(
              (r) =>
                String(r.officeCode || r.firebaseConfig?.officeCode || '')
                  .toUpperCase()
                  .replace(/[^A-Z0-9_-]/g, '_') === safeCode
            );
            const officeCode = regOffice?.officeCode || safeCode;
            const officeName =
              prof?.officeName || regOffice?.officeName || safeCode.replace(/_/g, ' ');
            const officeLogo = normalizeOfficeLogoUrl(
              prof?.officeLogo || regOffice?.officeLogo,
              false
            );
            const officeSlogan = sanitizeOfficeSlogan(
              prof?.officeSlogan ?? regOffice?.officeSlogan ?? '',
              false
            );
            const officeBase =
              prof?.officeBase || regOffice?.officeBase || 'BAF BASE ZHR';
            const fbCfg =
              regOffice?.firebaseConfig || buildAutoCloudFirebaseConfig(officeName, officeCode);

            const entry: GlobalUserOfficeEntry = {
              bdNo: cleanBd,
              userName: foundUser.fullName || foundUser.name || 'Airman',
              rank: foundUser.rank || 'LAC',
              flightName: foundUser.flightName || '',
              trade: foundUser.trade || 'General',
              role: foundUser.role || 'USER',
              pin: String(foundUser.pin || foundUser.password || cleanBd),
              officeCode,
              officeName,
              officeLogo,
              officeSlogan,
              officeBase,
              isDefault155: false,
              isPostedOut: false,
              active: true,
              officeConfig: {
                officeName,
                officeLogo,
                officeSlogan,
                officeBase,
                officeCode,
                firebaseConfig: fbCfg,
              },
              updatedAt: new Date().toISOString(),
            };
            globalMap[cleanBd] = entry;
            saveGlobalUserOfficeMap(globalMap, false);
            return entry;
          }
        } catch {}
      }
    }
  }

  // 3. Check Default 155 UASU BAF (raw unscoped keys + fallbackAirmen) if NOT posted out in 155 UASU
  const isPostedOut155 = isUserPostedOutInOfficeStorage(cleanBd, '155-UASU', true, fallbackAirmen);
  if (!isPostedOut155) {
    const defProfile = getDefault155OfficeProfile();
    try {
      const raw155Users = getRawLocalStorageItem('baf_detailed_user_logins');
      if (raw155Users) {
        const parsed155 = JSON.parse(raw155Users);
        if (Array.isArray(parsed155)) {
          const uMatch = parsed155.find((u: any) => {
            const uBd = String(u.bdNo || u.userId || '')
              .replace(/^BD\/?/i, '')
              .replace(/[^0-9]/g, '')
              .trim();
            return uBd === cleanBd && !isAirmanPostedOut(u);
          });
          if (uMatch) {
            return {
              bdNo: cleanBd,
              userName: uMatch.fullName || uMatch.name || 'Airman',
              rank: uMatch.rank || 'LAC',
              flightName: uMatch.flightName || 'Admin',
              trade: uMatch.trade || 'General',
              role: uMatch.role || 'USER',
              pin: String(uMatch.pin || uMatch.password || cleanBd),
              officeCode: '155-UASU',
              officeName: defProfile.officeName,
              officeLogo: defProfile.officeLogo,
              officeSlogan: defProfile.officeSlogan,
              officeBase: defProfile.officeBase,
              isDefault155: true,
              isPostedOut: false,
              active: true,
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }
    } catch {}

    try {
      const raw155Db = getRawLocalStorageItem('baf_local_db_v3');
      if (raw155Db) {
        const parsedDb = JSON.parse(raw155Db);
        if (parsedDb && Array.isArray(parsedDb.airmen)) {
          const aMatch = parsedDb.airmen.find((a: any) => {
            const aBd = String(a.bdNo || '')
              .replace(/^BD\/?/i, '')
              .replace(/[^0-9]/g, '')
              .trim();
            return aBd === cleanBd && !isAirmanPostedOut(a);
          });
          if (aMatch) {
            return {
              bdNo: cleanBd,
              userName: aMatch.fullName || aMatch.name || 'Airman',
              rank: aMatch.rank || 'LAC',
              flightName: aMatch.flightName || 'Admin',
              trade: aMatch.trade || 'General',
              role: aMatch.role || 'USER',
              pin: cleanBd,
              officeCode: '155-UASU',
              officeName: defProfile.officeName,
              officeLogo: defProfile.officeLogo,
              officeSlogan: defProfile.officeSlogan,
              officeBase: defProfile.officeBase,
              isDefault155: true,
              isPostedOut: false,
              active: true,
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }
    } catch {}

    if (Array.isArray(fallbackAirmen) && fallbackAirmen.length > 0) {
      const fMatch = fallbackAirmen.find((a) => {
        const aBd = String(a.bdNo || '')
          .replace(/^BD\/?/i, '')
          .replace(/[^0-9]/g, '')
          .trim();
        return aBd === cleanBd && !isAirmanPostedOut(a);
      });
      if (fMatch) {
        return {
          bdNo: cleanBd,
          userName: fMatch.fullName || fMatch.name || 'Airman',
          rank: fMatch.rank || 'LAC',
          flightName: fMatch.flightName || 'Admin',
          trade: fMatch.trade || 'General',
          role: fMatch.role || 'USER',
          pin: cleanBd,
          officeCode: '155-UASU',
          officeName: defProfile.officeName,
          officeLogo: defProfile.officeLogo,
          officeSlogan: defProfile.officeSlogan,
          officeBase: defProfile.officeBase,
          isDefault155: true,
          isPostedOut: false,
          active: true,
          updatedAt: new Date().toISOString(),
        };
      }
    }
  }

  return null;
}

export function activateMatchedOfficeForUser(match: GlobalUserOfficeEntry): boolean {
  if (!match) return false;
  const currentCode = getActiveOfficeCode();
  const targetCode = String(match.officeCode || '155-UASU').toUpperCase().trim();
  const isTarget155 =
    match.isDefault155 || targetCode === '155-UASU' || targetCode === '155UASU';

  if (isTarget155) {
    if (!isDefault155UasuOffice()) {
      clearCustomOfficeConfig();
      return true;
    }
    return false;
  }

  const fbConfig =
    match.officeConfig?.firebaseConfig ||
    buildAutoCloudFirebaseConfig(match.officeName, targetCode);
  const cleanSlogan = sanitizeOfficeSlogan(match.officeSlogan, false);
  const nextCustomConfig: CustomOfficeConfig = {
    officeName: match.officeName,
    officeLogo: match.officeLogo || '/155-uasu-baf-logo.png',
    officeSlogan: cleanSlogan,
    officeBase: match.officeBase || 'BAF BASE ZHR',
    officeCode: targetCode,
    joinPin: match.officeConfig?.joinPin,
    firebaseConfig: {
      ...fbConfig,
      officeCode: targetCode,
      officeSlogan: cleanSlogan,
      officeBase: match.officeBase || 'BAF BASE ZHR',
    },
    configuredAt: match.officeConfig?.configuredAt || new Date().toISOString(),
    adminUserId: match.bdNo,
  };

  const switched = currentCode !== targetCode || isDefault155UasuOffice();
  saveCustomOfficeConfig(nextCustomConfig);
  updateActiveOfficeProfile({
    officeName: match.officeName,
    officeLogo: match.officeLogo || '/155-uasu-baf-logo.png',
    officeSlogan: cleanSlogan,
    officeBase: match.officeBase || 'BAF BASE ZHR',
  });
  return switched;
}

let lastGlobalUserMapSyncAt = 0;
let inFlightGlobalUserMapPromise: Promise<Record<string, GlobalUserOfficeEntry>> | null = null;

export async function syncGlobalUserOfficeMapFromCloud(force: boolean = false): Promise<Record<string, GlobalUserOfficeEntry>> {
  const localMap = getGlobalUserOfficeMap();
  if (!masterDbInstance || isFirestoreQuotaExceeded()) return localMap;

  if (!force && isMasterCooldownActive('baf_cd_global_user_map', lastGlobalUserMapSyncAt) && Object.keys(localMap).length > 0) {
    return localMap;
  }
  if (inFlightGlobalUserMapPromise) return inFlightGlobalUserMapPromise;

  inFlightGlobalUserMapPromise = (async () => {
    try {
      lastGlobalUserMapSyncAt = markMasterCooldownTimestamp('baf_cd_global_user_map');
      // 1. Fetch registered_offices (uses 30-min cooldown internally)
      const registeredOffices = await fetchRegisteredOfficesFromMaster(force).catch(() => []);
      const officeByCode = new Map<string, RegisteredOfficeRecord>();
      registeredOffices.forEach((o) => {
        const c = String(o.officeCode || o.firebaseConfig?.officeCode || generateOfficeCodeFromName(o.officeName))
          .toUpperCase()
          .trim();
        officeByCode.set(c, o);
      });

      if (isFirestoreQuotaExceeded()) {
        return localMap;
      }

      // 2. Fetch single document app_settings/baf_global_user_office_map_v1 (1 read instead of N user_profiles reads)
      const snap = await getDoc(doc(masterDbInstance!, 'app_settings', GLOBAL_USER_OFFICE_MAP_KEY));
      if (snap.exists()) {
        const data = snap.data();
        if (data?.value) {
          const cloudMap = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
          if (cloudMap && typeof cloudMap === 'object' && Object.keys(cloudMap).length > 0) {
            Object.entries(cloudMap).forEach(([bdKey, entry]: [string, any]) => {
              if (entry && entry.bdNo) {
                localMap[bdKey] = {
                  ...entry,
                  ...(localMap[bdKey] &&
                  new Date(localMap[bdKey].updatedAt || 0).getTime() >
                    new Date(entry.updatedAt || 0).getTime()
                    ? localMap[bdKey]
                    : {}),
                };
              }
            });
          }
        }
      }

      // 3. Only scan user_profiles collection when explicitly forced (prevents full-collection scan on boot/login)
      if (force && !isFirestoreQuotaExceeded()) {
        const usersSnap = await getDocs(collection(masterDbInstance!, 'user_profiles')).catch((err) => {
          if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
          return null;
        });
        if (usersSnap) {
          usersSnap.forEach((docSnap) => {
            const docId = docSnap.id;
            const d = docSnap.data() as any;
            if (!d) return;
            const cleanBd = String(d.bdNo || d.user_id || '')
              .replace(/^BD\/?/i, '')
              .replace(/[^0-9]/g, '')
              .trim();
            if (!cleanBd || cleanBd === MASTER_USER_ID || cleanBd === '53539919') return;

            if (docId.startsWith('off_') && docId.includes('__')) {
              const safeCode = docId.slice(4, docId.indexOf('__')).toUpperCase().trim();
              const matchedOffice =
                officeByCode.get(safeCode) ||
                Array.from(officeByCode.values()).find(
                  (r) =>
                    String(r.officeCode || '')
                      .toUpperCase()
                      .replace(/[^A-Z0-9_-]/g, '_') === safeCode
                );
              const officeCode = matchedOffice?.officeCode || safeCode;
              const officeName = matchedOffice?.officeName || safeCode.replace(/_/g, ' ');
              const officeLogo = matchedOffice?.officeLogo || '/155-uasu-baf-logo.png';
              const officeSlogan = sanitizeOfficeSlogan(
                matchedOffice?.officeSlogan ?? matchedOffice?.firebaseConfig?.officeSlogan ?? '',
                false
              );
              const officeBase =
                matchedOffice?.officeBase ||
                matchedOffice?.firebaseConfig?.officeBase ||
                'BAF BASE ZHR';
              const fbConfig =
                matchedOffice?.firebaseConfig || buildAutoCloudFirebaseConfig(officeName, officeCode);

              localMap[cleanBd] = {
                bdNo: cleanBd,
                userName: d.name || 'Airman',
                rank: d.rank || 'LAC',
                flightName: d.flightName || 'Admin',
                trade: d.trade || 'General',
                role: d.role || 'USER',
                pin: String(d.password || d.pin || cleanBd),
                officeCode,
                officeName,
                officeLogo,
                officeSlogan,
                officeBase,
                isDefault155: false,
                officeConfig: {
                  officeName,
                  officeLogo,
                  officeSlogan,
                  officeBase,
                  officeCode,
                  firebaseConfig: fbConfig,
                },
                updatedAt: d.updatedAt || new Date().toISOString(),
              };
            } else if (!localMap[cleanBd]) {
              const defProf = getDefault155OfficeProfile();
              localMap[cleanBd] = {
                bdNo: cleanBd,
                userName: d.name || 'Airman',
                rank: d.rank || 'LAC',
                flightName: d.flightName || 'Admin',
                trade: d.trade || 'General',
                role: d.role || 'USER',
                pin: String(d.password || d.pin || cleanBd),
                officeCode: '155-UASU',
                officeName: defProf.officeName,
                officeLogo: defProf.officeLogo,
                officeSlogan: defProf.officeSlogan,
                officeBase: defProf.officeBase,
                isDefault155: true,
                updatedAt: d.updatedAt || new Date().toISOString(),
              };
            }
          });
        }
      }

      saveGlobalUserOfficeMap(localMap, false);
    } catch (err) {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, (err as any)?.message);
    }
    return localMap;
  })().finally(() => {
    inFlightGlobalUserMapPromise = null;
  });

  return inFlightGlobalUserMapPromise;
}

// ============================================================================
// 5. NEW OFFICE REGISTRATION APPROVAL WORKFLOW (3-Step Submit -> Master Approve)
// ============================================================================
const REJECTED_OFFICE_REQUEST_IDS_KEY = 'baf_rejected_office_request_ids_v1';

function getRejectedOfficeRequestIdsLocal(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = getRawLocalStorageItem(REJECTED_OFFICE_REQUEST_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function addRejectedOfficeRequestIdLocal(id: string): void {
  if (typeof window === 'undefined' || !id) return;
  try {
    const set = getRejectedOfficeRequestIdsLocal();
    set.add(String(id));
    setRawLocalStorageItem(REJECTED_OFFICE_REQUEST_IDS_KEY, JSON.stringify(Array.from(set)));
  } catch {}
}

export function getPendingOfficeRequestsLocal(): PendingOfficeRegistrationRequest[] {
  if (typeof window === 'undefined') return [];
  try {
    const rejectedIds = getRejectedOfficeRequestIdsLocal();
    const raw = getRawLocalStorageItem(PENDING_OFFICE_REQUESTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: PendingOfficeRegistrationRequest) =>
        item &&
        item.id &&
        item.status !== 'REJECTED' &&
        !rejectedIds.has(String(item.id))
    );
  } catch {
    return [];
  }
}

export function savePendingOfficeRequestsLocal(
  list: PendingOfficeRegistrationRequest[],
  syncToCloud: boolean = true,
  emitEvent: boolean = true
): void {
  if (typeof window === 'undefined') return;
  const rejectedIds = getRejectedOfficeRequestIdsLocal();
  const cleanList = (Array.isArray(list) ? list : []).filter(
    (item) => item && item.id && item.status !== 'REJECTED' && !rejectedIds.has(String(item.id))
  );
  try {
    setRawLocalStorageItem(PENDING_OFFICE_REQUESTS_KEY, JSON.stringify(cleanList));
    if (emitEvent) {
      window.dispatchEvent(new CustomEvent('baf_pending_office_requests_updated', { detail: cleanList }));
    }
  } catch {}

  if (syncToCloud && masterDbInstance && !isFirestoreQuotaExceeded()) {
    const nowIso = new Date().toISOString();
    setDoc(
      doc(masterDbInstance, 'app_settings', PENDING_OFFICE_REQUESTS_KEY),
      {
        settingKey: PENDING_OFFICE_REQUESTS_KEY,
        value: JSON.stringify(cleanList),
        updatedAt: nowIso,
        updatedBy: 'system',
      },
      { merge: true }
    ).catch((err) => {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
    });
  }
}

let lastPendingRequestsFetchAt = 0;
let inFlightPendingRequestsPromise: Promise<PendingOfficeRegistrationRequest[]> | null = null;

export async function fetchPendingOfficeRequestsFromMaster(force: boolean = false): Promise<PendingOfficeRegistrationRequest[]> {
  const rejectedIds = getRejectedOfficeRequestIdsLocal();
  const localList = getPendingOfficeRequestsLocal();
  if (!masterDbInstance || isFirestoreQuotaExceeded()) return localList;

  if (!force && isMasterCooldownActive('baf_cd_pending_reqs', lastPendingRequestsFetchAt)) {
    return localList;
  }
  if (inFlightPendingRequestsPromise) return inFlightPendingRequestsPromise;

  inFlightPendingRequestsPromise = (async () => {
    const byId = new Map<string, PendingOfficeRegistrationRequest>();
    localList.forEach((item) => {
      if (item && item.id && item.status !== 'REJECTED' && !rejectedIds.has(String(item.id))) {
        byId.set(item.id, item);
      }
    });

    try {
      lastPendingRequestsFetchAt = markMasterCooldownTimestamp('baf_cd_pending_reqs');
      const snap = await getDoc(doc(masterDbInstance!, 'app_settings', PENDING_OFFICE_REQUESTS_KEY));
      if (snap.exists()) {
        const data = snap.data();
        const rawVal = data?.value;
        if (rawVal) {
          let cloudList: any = rawVal;
          if (typeof rawVal === 'string') {
            try {
              cloudList = JSON.parse(rawVal);
            } catch {}
          } else if (rawVal && typeof rawVal === 'object' && Array.isArray(rawVal.data)) {
            cloudList = rawVal.data;
          }
          if (Array.isArray(cloudList)) {
            cloudList.forEach((item: PendingOfficeRegistrationRequest) => {
              if (!item || !item.id) return;
              if (item.status === 'REJECTED' || rejectedIds.has(String(item.id))) {
                addRejectedOfficeRequestIdLocal(String(item.id));
                byId.delete(item.id);
                return;
              }
              const existing = byId.get(item.id);
              if (
                !existing ||
                new Date(item.updatedAt || 0).getTime() >= new Date(existing.updatedAt || 0).getTime()
              ) {
                byId.set(item.id, item);
              }
            });
          }
        }
      }
    } catch (err) {
      if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, (err as any)?.message);
    }

    const merged = Array.from(byId.values())
      .filter((item) => item.status !== 'REJECTED' && !rejectedIds.has(String(item.id)))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    savePendingOfficeRequestsLocal(merged, false, false);
    return merged;
  })().finally(() => {
    inFlightPendingRequestsPromise = null;
  });

  return inFlightPendingRequestsPromise;
}

export async function submitOfficeRegistrationRequest(input: {
  officeName: string;
  wing: string;
  officeBase: string;
  officeSlogan: string;
  officeLogo: string;
  bdNo: string;
  rank: string;
  fullName: string;
  surname: string;
  trade: string;
  flightName: string;
  userRole: string;
  presentAddress?: string;
  contactNo: string;
  pin?: string;
}): Promise<PendingOfficeRegistrationRequest> {
  const cleanBd = String(input.bdNo || '')
    .replace(/^BD\/?/i, '')
    .replace(/[^0-9]/g, '')
    .trim();
  const cleanOfficeName = String(input.officeName || '').trim();
  const officeCode = generateOfficeCodeFromName(cleanOfficeName);
  const nowIso = new Date().toISOString();

  const existingList = getPendingOfficeRequestsLocal();

  // Check if there is already a pending request for the same BD No + Office Code
  const existingIdx = existingList.findIndex(
    (r) =>
      r.bdNo === cleanBd &&
      r.officeCode.toUpperCase() === officeCode.toUpperCase() &&
      r.status === 'PENDING'
  );

  const reqRecord: PendingOfficeRegistrationRequest = {
    id:
      existingIdx >= 0
        ? existingList[existingIdx].id
        : `off_req_${officeCode}_${cleanBd}_${Date.now()}`,
    officeName: cleanOfficeName,
    officeCode,
    wing: String(input.wing || '').trim(),
    officeBase: String(input.officeBase || 'BAF BASE ZHR').trim() || 'BAF BASE ZHR',
    officeSlogan: sanitizeOfficeSlogan(input.officeSlogan, false),
    officeLogo:
      String(input.officeLogo || '/155-uasu-baf-logo.png').trim() || '/155-uasu-baf-logo.png',
    bdNo: cleanBd,
    rank: String(input.rank || 'LAC').trim() || 'LAC',
    fullName: String(input.fullName || '').trim(),
    surname: String(input.surname || input.fullName || '').trim(),
    trade: String(input.trade || 'Radio Fitt').trim() || 'Radio Fitt',
    flightName: String(input.flightName || '').trim(),
    userRole: String(input.userRole || 'SUPER_ADMIN').trim() || 'SUPER_ADMIN',
    presentAddress: String(input.presentAddress || '').trim(),
    contactNo: String(input.contactNo || '').trim(),
    pin: String(input.pin || cleanBd).trim() || cleanBd,
    status: 'PENDING',
    createdAt: existingIdx >= 0 ? existingList[existingIdx].createdAt : nowIso,
    updatedAt: nowIso,
  };

  if (existingIdx >= 0) {
    existingList[existingIdx] = reqRecord;
  } else {
    existingList.unshift(reqRecord);
  }

  savePendingOfficeRequestsLocal(existingList, true);
  return reqRecord;
}

export async function approveOfficeRegistrationRequest(
  requestId: string
): Promise<PendingOfficeRegistrationRequest | null> {
  const list = getPendingOfficeRequestsLocal();
  const idx = list.findIndex((r) => r.id === requestId);
  if (idx === -1) return null;

  const req = list[idx];
  const nowIso = new Date().toISOString();
  const officeCode = String(req.officeCode || generateOfficeCodeFromName(req.officeName))
    .toUpperCase()
    .trim();
  const safeCode = officeCode.replace(/[^A-Z0-9_-]/g, '_');
  const cleanBd = String(req.bdNo || '')
    .replace(/^BD\/?/i, '')
    .replace(/[^0-9]/g, '')
    .trim();
  const displaySurname = String(req.surname || req.fullName || 'Airman').trim();
  const displayFullName = String(req.fullName || req.surname || 'Airman').trim();
  const userPin = String(req.pin || cleanBd).trim() || cleanBd;
  const userRole = String(req.userRole || 'SUPER_ADMIN').trim() || 'SUPER_ADMIN';

  // 1. Save Scoped Office Profile (`baf_office_profile_v1__office_${safeCode}`)
  const officeProfilePayload: OfficeProfileData = {
    officeName: req.officeName,
    officeLogo: req.officeLogo || '/155-uasu-baf-logo.png',
    officeSlogan: sanitizeOfficeSlogan(req.officeSlogan, false),
    officeBase: req.officeBase || 'BAF BASE ZHR',
  };
  setRawLocalStorageItem(
    `${OFFICE_PROFILE_STORAGE_KEY}__office_${safeCode}`,
    JSON.stringify(officeProfilePayload)
  );

  // 2. Build Biodata Register (`Airman`) & User Management (`DetailedUserLogin`) records
  const airmanId = `BD/${cleanBd}`;
  const shortCode =
    displaySurname
      .replace(/[^a-zA-Z]/g, '')
      .slice(0, 3)
      .toUpperCase() || 'USR';

  const newAirmanRecord = {
    id: airmanId,
    serNo: 1,
    seniority: 1,
    code: shortCode,
    bdNo: cleanBd,
    rank: req.rank || 'LAC',
    fullName: displayFullName,
    name: displaySurname,
    trade: req.trade || 'Radio Fitt',
    bloodGroup: '',
    email: '',
    presentAddress: req.presentAddress || req.officeBase || 'BAF BASE ZHR',
    permanentAddress: '',
    addressBlock: req.presentAddress || req.officeBase || 'BAF BASE ZHR',
    mobileNo: req.contactNo || '',
    postingDate: nowIso.slice(0, 10),
    flightName: '',
    remarks: `Approved Office Registration (${req.officeName})`,
    active: true,
    sqn: req.officeName,
    wing: req.wing || '',
    role: userRole,
    status: 'Active',
    medicalCategory: 'AYE',
    basicCategory: 'B1',
  };

  const masterUserRecord = {
    id: 'user-login-48456',
    userId: MASTER_USER_ID,
    airmanId: 'airman-48456',
    bdNo: MASTER_USER_ID,
    rank: 'Master',
    name: 'System Master Owner',
    flightName: '',
    trade: 'System Control',
    role: 'master_owner',
    pin: MASTER_USER_PIN,
    password: MASTER_USER_PIN,
    adminPass: '1124',
    ownerPass: '1124',
    isProtected: true,
    status: 'ACTIVE',
    detailOrder: 'MASTER-OWNER-PROTECTED',
    detailedAt: nowIso,
    detailedBy: 'System Auto-Provision',
    remarks: 'Protected System Master Owner Account',
    updatedAt: nowIso,
  };

  const requesterUserRecord = {
    id: `user-login-${cleanBd}`,
    userId: cleanBd,
    airmanId,
    bdNo: cleanBd,
    rank: req.rank || 'LAC',
    name: displaySurname,
    fullName: displayFullName,
    mobileNo: req.contactNo || '',
    flightName: '',
    trade: req.trade || 'Radio Fitt',
    role: userRole,
    pin: userPin,
    password: userPin,
    adminPass: '1124',
    status: 'ACTIVE',
    detailOrder: `DO-${officeCode}/APPROVED/${cleanBd}`,
    detailedAt: nowIso,
    detailedBy: 'Master Admin Approval',
    remarks: `${req.officeName}${req.wing ? ` (${req.wing})` : ''} • ${displayFullName}`,
    updatedAt: nowIso,
  };

  // 3. Write Scoped User Management (`baf_detailed_user_logins__office_${safeCode}`)
  const scopedUsersKey = `baf_detailed_user_logins__office_${safeCode}`;
  let existingOfficeUsers: any[] = [];
  try {
    const rawU = getRawLocalStorageItem(scopedUsersKey);
    if (rawU) {
      const p = JSON.parse(rawU);
      if (Array.isArray(p)) existingOfficeUsers = p;
    }
  } catch {}
  const filteredUsers = existingOfficeUsers.filter(
    (u) =>
      String(u.bdNo || u.userId || '').replace(/^BD\/?/i, '').trim() !== cleanBd &&
      String(u.bdNo || u.userId || '').replace(/^BD\/?/i, '').trim() !== MASTER_USER_ID
  );
  const updatedOfficeUsers = [masterUserRecord, requesterUserRecord, ...filteredUsers];
  setRawLocalStorageItem(scopedUsersKey, JSON.stringify(updatedOfficeUsers));

  // 4. Write Scoped Local Database (`baf_155_uasu_v2_db__office_${safeCode}` & `baf_local_db_v3__office_${safeCode}`) for Biodata Register, Nominal Roll, Duty Ratio Matrix, Parade State, etc.
  const primaryScopedDbKey = `baf_155_uasu_v2_db__office_${safeCode}`;
  const legacyScopedDbKey = `baf_local_db_v3__office_${safeCode}`;
  let officeDbObj: any = {
    airmen: [newAirmanRecord],
    assignments: {},
    leaves: [],
    tdyRecords: [],
    deployments: [],
    dutyHistory: {},
    detailedUsers: updatedOfficeUsers,
    dutyTypes: [],
    flightConfigs: [],
    paradeStates: {},
    settings: {
      [OFFICE_PROFILE_STORAGE_KEY]: JSON.stringify(officeProfilePayload),
    },
    lastUpdated: Date.now(),
  };
  try {
    const rawDb =
      getRawLocalStorageItem(primaryScopedDbKey) || getRawLocalStorageItem(legacyScopedDbKey);
    if (rawDb) {
      const parsedDb = JSON.parse(rawDb);
      if (parsedDb && typeof parsedDb === 'object') {
        const existingAirmen = Array.isArray(parsedDb.airmen) ? parsedDb.airmen : [];
        const otherAirmen = existingAirmen.filter(
          (a: any) => String(a.bdNo || '').replace(/^BD\/?/i, '').trim() !== cleanBd
        );
        const safeAssignments =
          parsedDb.assignments &&
          typeof parsedDb.assignments === 'object' &&
          !Array.isArray(parsedDb.assignments)
            ? parsedDb.assignments
            : {};
        officeDbObj = {
          ...parsedDb,
          airmen: [newAirmanRecord, ...otherAirmen],
          assignments: safeAssignments,
          detailedUsers: updatedOfficeUsers,
          settings: {
            ...(parsedDb.settings || {}),
            [OFFICE_PROFILE_STORAGE_KEY]: JSON.stringify(officeProfilePayload),
          },
          lastUpdated: Date.now(),
        };
      }
    }
  } catch {}
  setRawLocalStorageItem(primaryScopedDbKey, JSON.stringify(officeDbObj));
  setRawLocalStorageItem(legacyScopedDbKey, JSON.stringify(officeDbObj));

  // 5. Sync Approved Office, Biodata Register & User Management to Local Registry & Firestore (`masterDbInstance`)
  const fbConfig: OfficeFirebaseConfig = {
    ...buildAutoCloudFirebaseConfig(req.officeName, officeCode),
    officeSlogan: officeProfilePayload.officeSlogan,
    officeBase: officeProfilePayload.officeBase,
    adminBdNo: cleanBd,
    adminFullName: displayFullName,
    adminSurname: displaySurname,
    adminRank: req.rank || 'LAC',
    adminTrade: req.trade || 'Radio Fitt',
    adminRole: userRole,
    adminContactNo: req.contactNo || '',
  };

  // Update local registered offices registry immediately (0ms)
  try {
    const rawOffices = getRawLocalStorageItem('baf_registered_offices_v1');
    const localOffices: RegisteredOfficeTelemetry[] = rawOffices ? JSON.parse(rawOffices) : [];
    const safeList = Array.isArray(localOffices) ? localOffices : [];
    const filteredOffices = safeList.filter(
      (o) =>
        String(o.officeCode || o.projectId || '').toUpperCase().trim() !== officeCode
    );
    filteredOffices.unshift({
      projectId: `${fbConfig.projectId}_${officeCode}`,
      officeName: req.officeName,
      officeLogo: officeProfilePayload.officeLogo,
      officeSlogan: officeProfilePayload.officeSlogan,
      officeBase: officeProfilePayload.officeBase,
      officeCode,
      totalUsers: getRealtimeOfficeUserCount(officeCode, officeDbObj.airmen.length || 1),
      createdAt: nowIso,
      lastActive: nowIso,
      status: 'ACTIVE',
      firebaseConfig: fbConfig,
    });
    setRawLocalStorageItem('baf_registered_offices_v1', JSON.stringify(filteredOffices));
  } catch {}

  // 6. Index the approved User -> Office mapping in Global User-Office Directory immediately (0ms)
  const customOfficeCfg: CustomOfficeConfig = {
    officeName: req.officeName,
    officeLogo: officeProfilePayload.officeLogo,
    officeSlogan: officeProfilePayload.officeSlogan,
    officeBase: officeProfilePayload.officeBase,
    officeCode,
    firebaseConfig: fbConfig,
    configuredAt: nowIso,
    adminUserId: cleanBd,
  };

  registerUsersInGlobalOfficeDirectory([requesterUserRecord], {
    officeCode,
    officeName: req.officeName,
    officeLogo: officeProfilePayload.officeLogo,
    officeSlogan: officeProfilePayload.officeSlogan,
    officeBase: officeProfilePayload.officeBase,
    isDefault155: false,
    officeConfig: customOfficeCfg,
  });

  // 7. Update request status to APPROVED immediately (0ms)
  const approvedReq: PendingOfficeRegistrationRequest = {
    ...req,
    status: 'APPROVED',
    approvedAt: nowIso,
    updatedAt: nowIso,
  };
  list[idx] = approvedReq;
  savePendingOfficeRequestsLocal(list, true);

  // 8. Non-blocking background sync to Firestore (using schema-validated fields and valid slash-free document IDs)
  registerOfficeInMasterTelemetry(
    {
      officeName: req.officeName,
      officeLogo: officeProfilePayload.officeLogo,
      officeSlogan: officeProfilePayload.officeSlogan,
      officeBase: officeProfilePayload.officeBase,
      officeCode,
      firebaseConfig: fbConfig,
      totalUsers: officeDbObj.airmen.length || 1,
    },
    officeDbObj.airmen.length || 1
  ).catch(() => {});

  if (masterDbInstance && !isFirestoreQuotaExceeded()) {
    try {
      const docPrefix = `off_${safeCode}__`;
      const safeAirmanDocId = `${docPrefix}BD_${cleanBd}`;
      const safeUserDocId = `${docPrefix}user-login-${cleanBd}`;
      const safeProfileDocId = `${docPrefix}${OFFICE_PROFILE_STORAGE_KEY}`;
      const safeManifestDocId = `off_${safeCode}_sync_manifest`;

      const firestoreAirmanPayload = {
        id: safeAirmanDocId,
        bdNo: cleanBd,
        rank: String(newAirmanRecord.rank || 'LAC').slice(0, 64),
        name: String(newAirmanRecord.name || 'Airman').slice(0, 200),
        fullName: String(newAirmanRecord.fullName || newAirmanRecord.name || 'Airman').slice(0, 250),
        flightName: String(newAirmanRecord.flightName || '').slice(0, 64),
        trade: String(newAirmanRecord.trade || 'Radio Fitt').slice(0, 128),
        seniority: Number(newAirmanRecord.seniority) || 1,
        serNo: Number(newAirmanRecord.serNo) || 1,
        code: String(newAirmanRecord.code || shortCode).slice(0, 64),
        mobileNo: String(newAirmanRecord.mobileNo || '').slice(0, 64),
        bloodGroup: String(newAirmanRecord.bloodGroup || '').slice(0, 32),
        addressBlock: String(newAirmanRecord.addressBlock || 'BAF BASE ZHR').slice(0, 500),
        permanentAddress: String(newAirmanRecord.permanentAddress || '').slice(0, 500),
        dateJoined: String(newAirmanRecord.postingDate || nowIso.slice(0, 10)).slice(0, 64),
        remarks: String(newAirmanRecord.remarks || '').slice(0, 500),
        email: String(newAirmanRecord.email || '').slice(0, 200),
        active: true,
        updatedAt: nowIso,
      };

      const firestoreUserPayload = {
        id: safeUserDocId,
        airmanId: airmanId,
        bdNo: cleanBd,
        userId: cleanBd,
        rank: String(requesterUserRecord.rank || 'LAC').slice(0, 64),
        name: String(requesterUserRecord.name || 'Airman').slice(0, 200),
        mobileNo: String(requesterUserRecord.mobileNo || '').slice(0, 64),
        flightName: String(requesterUserRecord.flightName || '').slice(0, 64),
        trade: String(requesterUserRecord.trade || 'Radio Fitt').slice(0, 128),
        role: String(requesterUserRecord.role || 'SUPER_ADMIN').slice(0, 32),
        status: 'ACTIVE',
        password: String(requesterUserRecord.password || cleanBd).slice(0, 128),
        pin: String(requesterUserRecord.pin || cleanBd).slice(0, 128),
        adminPass: '1124',
        detailOrder: String(requesterUserRecord.detailOrder || '').slice(0, 128),
        detailedAt: nowIso,
        detailedBy: 'Master Admin Approval',
        remarks: String(requesterUserRecord.remarks || '').slice(0, 500),
        updatedAt: nowIso,
      };

      const firestoreProfileSettingPayload = {
        settingKey: safeProfileDocId,
        value: JSON.stringify(officeProfilePayload),
        updatedAt: nowIso,
        updatedBy: 'master_admin',
      };

      const firestoreManifestPayload = {
        id: safeManifestDocId,
        revision: Date.now(),
        updatedAt: nowIso,
        updatedBySessionId: CLIENT_SESSION_ID.slice(0, 128),
        updatedByBdNo: '48456',
        lastReason: `office_approved|h=fp_${safeCode}_${cleanBd}_${Date.now().toString(36)}`,
        dataHash: `fp_${safeCode}_${cleanBd}_${Date.now().toString(36)}`,
        airmenCount: officeDbObj.airmen.length || 1,
        assignmentsCount: 0,
        changedCollections: ['airmen', 'user_profiles', 'app_settings'],
      };

      Promise.all([
        setDoc(doc(masterDbInstance, 'airmen', safeAirmanDocId), firestoreAirmanPayload, { merge: true }),
        setDoc(doc(masterDbInstance, 'user_profiles', safeUserDocId), firestoreUserPayload, { merge: true }),
        setDoc(doc(masterDbInstance, 'app_settings', safeProfileDocId), firestoreProfileSettingPayload, { merge: true }),
        setDoc(doc(masterDbInstance, 'system_meta', safeManifestDocId), firestoreManifestPayload, { merge: true }),
      ]).catch((err) => {
        if (isQuotaExceededError(err)) setFirestoreQuotaExceeded(true, err?.message);
      });
    } catch {}
  }

  return approvedReq;
}

export async function rejectOfficeRegistrationRequest(
  requestId: string
): Promise<PendingOfficeRegistrationRequest | null> {
  const list = getPendingOfficeRequestsLocal();
  const idx = list.findIndex((r) => r.id === requestId);
  const targetReq = idx >= 0 ? list[idx] : null;

  // Record in rejected IDs set so it permanently disappears and never reappears from cloud sync
  addRejectedOfficeRequestIdLocal(requestId);

  const remaining = list.filter((r) => r.id !== requestId && r.status !== 'REJECTED');
  savePendingOfficeRequestsLocal(remaining, true);

  return targetReq
    ? {
        ...targetReq,
        status: 'REJECTED',
        rejectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    : null;
}

// Master registry & pending requests are fetched on-demand with a 5-minute cache cooldown

// ============================================================================
// AUTH & ERROR EXPORTS
// ============================================================================
export const googleAuthProvider = new GoogleAuthProvider();

export { GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, onAuthStateChanged };
export const firebaseSignOut = async () => {
  if (officeAuthInstance) {
    await signOut(officeAuthInstance);
  }
};
export type FirebaseUser = FirebaseUserType;

export const CLIENT_SESSION_ID: string = (() => {
  if (typeof window === 'undefined') return `srv_${Date.now()}`;
  try {
    const existing = window.sessionStorage.getItem('baf_client_session_id');
    if (existing) return existing;
    const generated = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem('baf_client_session_id', generated);
    return generated;
  } catch {
    return `sess_${Date.now().toString(36)}`;
  }
})();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

const QUOTA_EXCEEDED_KEY = 'baf_firebase_quota_exceeded_at';
const QUOTA_MSG_KEY = 'baf_firebase_quota_error_msg';

let quotaExceededMemory: boolean = (() => {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!saved) return false;
    const savedTime = Date.parse(saved);
    if (isNaN(savedTime)) return false;
    const savedUtcDay = new Date(savedTime).toISOString().slice(0, 10);
    const currentUtcDay = new Date().toISOString().slice(0, 10);
    if (savedUtcDay !== currentUtcDay || Date.now() - savedTime > 12 * 60 * 60 * 1000) {
      window.localStorage.removeItem(QUOTA_EXCEEDED_KEY);
      window.localStorage.removeItem(QUOTA_MSG_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
})();

export function isQuotaExceededError(error: unknown): boolean {
  if (!error) return false;
  const status = Number((error as any)?.status || (error as any)?.statusCode || 0);
  const code = String((error as any)?.code || '').toLowerCase();
  const msg = String((error as any)?.message || error || '').toLowerCase();
  return (
    status === 429 ||
    code.includes('resource-exhausted') ||
    code.includes('resource_exhausted') ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('free daily read units') ||
    msg.includes('free daily write units') ||
    msg.includes('maximum backoff delay') ||
    msg.includes('429')
  );
}

let quotaExceededAtMemory: number = (() => {
  if (typeof window === 'undefined') return 0;
  try {
    const saved = window.localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!saved) return 0;
    const savedTime = Date.parse(saved);
    return isNaN(savedTime) ? 0 : savedTime;
  } catch {
    return 0;
  }
})();

export function getFirestoreQuotaExceededAt(): number {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(QUOTA_EXCEEDED_KEY);
      if (saved) {
        const savedTime = Date.parse(saved);
        if (!isNaN(savedTime)) {
          quotaExceededAtMemory = savedTime;
          return savedTime;
        }
      }
    } catch {}
  }
  return quotaExceededAtMemory;
}

export function isFirestoreQuotaExceeded(): boolean {
  if (typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(QUOTA_EXCEEDED_KEY);
      if (saved) {
        const savedTime = Date.parse(saved);
        if (!isNaN(savedTime)) {
          const savedUtcDay = new Date(savedTime).toISOString().slice(0, 10);
          const currentUtcDay = new Date().toISOString().slice(0, 10);
          if (savedUtcDay !== currentUtcDay || Date.now() - savedTime > 12 * 60 * 60 * 1000) {
            window.localStorage.removeItem(QUOTA_EXCEEDED_KEY);
            window.localStorage.removeItem(QUOTA_MSG_KEY);
            quotaExceededMemory = false;
            quotaExceededAtMemory = 0;
            return false;
          }
          quotaExceededMemory = true;
          quotaExceededAtMemory = savedTime;
          return true;
        }
      }
    } catch {}
  }
  return quotaExceededMemory;
}

export function getQuotaConsoleUpgradeUrl(): string {
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  return `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${dbId}/data?openUpgradeDialog=true`;
}

export function setFirestoreQuotaExceeded(exceeded: boolean = false, errorMsg?: string): void {
  const prev = quotaExceededMemory;
  quotaExceededMemory = exceeded;
  quotaExceededAtMemory = exceeded ? Date.now() : 0;

  if (typeof window !== 'undefined') {
    try {
      if (exceeded) {
        window.localStorage.setItem(QUOTA_EXCEEDED_KEY, new Date(quotaExceededAtMemory).toISOString());
        if (errorMsg) window.localStorage.setItem(QUOTA_MSG_KEY, errorMsg);
      } else {
        window.localStorage.removeItem(QUOTA_EXCEEDED_KEY);
        window.localStorage.removeItem(QUOTA_MSG_KEY);
      }
    } catch {}

    window.dispatchEvent(
      new CustomEvent('baf_firebase_quota_status', {
        detail: { exceeded, errorMsg: errorMsg || '' },
      })
    );

    if (exceeded && !prev) {
      window.dispatchEvent(
        new CustomEvent('baf_firebase_quota_exceeded', {
          detail: {
            exceeded: true,
            errorMsg: errorMsg || 'Firestore daily quota exceeded',
            upgradeUrl: getQuotaConsoleUpgradeUrl(),
          },
        })
      );
    }
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errorStr = error instanceof Error ? error.message : String(error);
  if (isQuotaExceededError(error)) {
    setFirestoreQuotaExceeded(true, errorStr);
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorStr,
    authInfo: {
      userId: officeAuthInstance?.currentUser?.uid || null,
      email: officeAuthInstance?.currentUser?.email || null,
      emailVerified: officeAuthInstance?.currentUser?.emailVerified || null,
      isAnonymous: officeAuthInstance?.currentUser?.isAnonymous || null,
      tenantId: officeAuthInstance?.currentUser?.tenantId || null,
      providerInfo:
        officeAuthInstance?.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (!isFirebaseConfigured || !officeDbInstance || isFirestoreQuotaExceeded()) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getDoc(doc(officeDbInstance, 'test', 'connection')),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Firestore connection test timeout after 8000ms')), 8000);
      }),
    ]);
    if (isFirestoreQuotaExceeded()) {
      setFirestoreQuotaExceeded(false);
    }
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    if (isQuotaExceededError(error)) {
      const msg = error instanceof Error ? error.message : String(error);
      setFirestoreQuotaExceeded(true, msg);
      return false;
    }
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export default officeAppInstance;

/**
 * Safe Storage & Quota Management Utility
 * Protects localStorage against QuotaExceededError and prunes redundant/transient data
 */

const warningThrottleMap = new Map<string, number>();

function shouldLogWarning(key: string): boolean {
  const now = Date.now();
  const last = warningThrottleMap.get(key) || 0;
  if (now - last > 60000) {
    warningThrottleMap.set(key, now);
    return true;
  }
  return false;
}

/**
 * Strips massive inline base64 image strings from menu items payload to save ~99% of storage space.
 * Default images are already bundled in DEFAULT_CANTEEN_MENU_ITEMS and restored dynamically on read.
 */
function sanitizePayloadForStorage(key: string, value: string): string {
  if (
    (key === 'canteen_menu_cache' ||
      key === 'canteen_menu_items_list' ||
      key === 'canteen_menu_items_catalog_v1' ||
      key === 'canteen_daily_menu') &&
    value.length > 5000 &&
    value.includes('data:')
  ) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const stripped = parsed.map((item: any) => {
          if (!item || typeof item !== 'object') return item;
          const copy = { ...item };
          if (typeof copy.DP === 'string' && (copy.DP.startsWith('data:') || copy.DP.length > 200)) delete copy.DP;
          if (typeof copy.img === 'string' && (copy.img.startsWith('data:') || copy.img.length > 200)) delete copy.img;
          if (typeof copy.image === 'string' && (copy.image.startsWith('data:') || copy.image.length > 200)) delete copy.image;
          return copy;
        });
        return JSON.stringify(stripped);
      }
    } catch {}
  }
  return value;
}

export function pruneNonEssentialStorage(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  let freedCount = 0;

  try {
    // 1. Immediately remove baf_sync_logs from localStorage (it belongs in memory / sessionStorage)
    if (window.localStorage.getItem('baf_sync_logs')) {
      window.localStorage.removeItem('baf_sync_logs');
      freedCount++;
    }

    // 2. Prune duplicate individual canteen member caches, redundant menu catalog copy, and legacy temporary storage
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (
        key &&
        (key.startsWith('canteen_member_') ||
          key.startsWith('baf_preview_') ||
          key.startsWith('baf_temp_') ||
          key.startsWith('baf_airfield_') ||
          key === 'canteen_menu_items_catalog_v1') // redundant with canteen_menu_items_list & canteen_menu_cache
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => {
      try {
        window.localStorage.removeItem(k);
        freedCount++;
      } catch {}
    });

    // 3. Compact existing menu caches if they contain massive base64 images
    ['canteen_menu_cache', 'canteen_menu_items_list', 'canteen_daily_menu'].forEach((menuKey) => {
      try {
        const raw = window.localStorage.getItem(menuKey);
        if (raw && raw.length > 20000 && raw.includes('data:')) {
          const sanitized = sanitizePayloadForStorage(menuKey, raw);
          if (sanitized.length < raw.length) {
            window.localStorage.setItem(menuKey, sanitized);
            freedCount++;
          }
        }
      } catch {}
    });

    // 4. Trim baf_user_login_history to most recent 20 entries
    try {
      const rawLogins = window.localStorage.getItem('baf_user_login_history');
      if (rawLogins) {
        const parsed = JSON.parse(rawLogins);
        if (Array.isArray(parsed) && parsed.length > 20) {
          window.localStorage.setItem('baf_user_login_history', JSON.stringify(parsed.slice(0, 20)));
          freedCount++;
        }
      }
    } catch {}



    // 6. Prune baf_presence if large
    try {
      const rawPresence = window.localStorage.getItem('baf_presence');
      if (rawPresence && rawPresence.length > 30000) {
        window.localStorage.removeItem('baf_presence');
        freedCount++;
      }
    } catch {}
  } catch (err) {
    if (shouldLogWarning('prune_exception')) {
      console.warn('[SafeStorage] Prune exception:', err);
    }
  }

  return freedCount;
}

export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;

  // Never write sync logs to localStorage
  if (key === 'baf_sync_logs') {
    try {
      window.sessionStorage.setItem('baf_sync_logs', value);
    } catch {}
    return true;
  }

  const sanitizedValue = sanitizePayloadForStorage(key, value);

  try {
    window.localStorage.setItem(key, sanitizedValue);
    return true;
  } catch (err: any) {
    // Check for QuotaExceededError
    const isQuotaError =
      err?.name === 'QuotaExceededError' ||
      err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      err?.code === 22 ||
      err?.code === 1014 ||
      (typeof err?.message === 'string' && err.message.toLowerCase().includes('quota'));

    if (isQuotaError) {
      if (shouldLogWarning(key)) {
        console.warn(`[SafeStorage] Quota exceeded for "${key}". Pruning non-essential cache...`);
      }
      pruneNonEssentialStorage();
      try {
        window.localStorage.setItem(key, sanitizedValue);
        return true;
      } catch (retryErr) {
        if (shouldLogWarning(key + '_failed')) {
          console.warn(`[SafeStorage] Retry failed for "${key}". Skipping write to prevent crash.`);
        }
        return false;
      }
    }

    if (shouldLogWarning(key + '_generic')) {
      console.warn(`[SafeStorage] Failed to save key "${key}":`, err);
    }
    return false;
  }
}

const GLOBAL_UNSCOPED_STORAGE_KEYS = new Set<string>([
  'custom_office_config',
  'baf_custom_office_firebase_config_v1',
  'baf_master_registered_offices_cache',
  'baf_registered_offices_v1',
  'baf_global_user_office_map_v1',
  'baf_pending_office_requests_v1',
  'baf_rejected_office_request_ids_v1',
  'baf_removed_office_codes_v1',
  'baf_master_credentials_v1',
  'baf_linked_firebase_target',
  'baf_pwa_active_office_meta',
  'baf_theme_pref',
  'baf_theme_pref_manual_v1',
  'theme',
  'baf_last_used_id',
  'baf_office_last_used_id',
  'baf_recent_logins',
  'baf_force_apk_mode',
  'baf_app_current_version_code',
  'baf_app_current_version_name',
  'baf_skipped_app_version',
  'baf_latest_app_version',
  'baf_client_session_id',
  'baf_last_used_login_portal',
  'baf_firebase_quota_exceeded_at',
  'baf_firebase_quota_error_msg',
  'baf_sync_logs',
  'baf_firebase_sync_logs_v1',
  'baf_local_cloud_sync_logs_v1',
  'canteen_sync_logs',
  'canteen_last_handled_sync_revision',
]);

let rawStorageGetItemRef: ((key: string) => string | null) | null = null;
let rawStorageSetItemRef: ((key: string, value: string) => void) | null = null;

export function getRawLocalStorageItem(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    if (rawStorageGetItemRef) {
      return rawStorageGetItemRef.call(window.localStorage, key);
    }
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setRawLocalStorageItem(key: string, value: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (rawStorageSetItemRef) {
      rawStorageSetItemRef.call(window.localStorage, key, value);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {}
}

function resolveOfficeScopedStorageKey(
  rawGetItem: (key: string) => string | null,
  key: string
): string {
  if (!key || typeof key !== 'string') return key;
  if (key.includes('__office_')) return key;
  if (GLOBAL_UNSCOPED_STORAGE_KEYS.has(key)) return key;
  if (
    key.startsWith('canteen_') ||
    key.startsWith('baf_canteen_') ||
    key.startsWith('baf_others_fund_') ||
    key.startsWith('baf_deleted_others_fund_')
  ) {
    return key;
  }
  try {
    const rawCustom = rawGetItem.call(window.localStorage, 'custom_office_config');
    if (!rawCustom) return key;
    const parsed = JSON.parse(rawCustom);
    if (!parsed || typeof parsed !== 'object') return key;
    const rawName = String(parsed.officeName || '').toUpperCase().trim();
    let rawCode = String(parsed.officeCode || parsed.firebaseConfig?.officeCode || '').toUpperCase().trim();
    if (!rawCode && rawName) {
      const cleaned = rawName.replace(/[^A-Z0-9\s-]/g, '').trim();
      const parts = cleaned.split(/[\s-]+/).filter(Boolean);
      rawCode = parts.length === 1 ? parts[0].slice(0, 8) : parts.slice(0, 3).map((p: string) => p.slice(0, 4)).join('-').slice(0, 12);
    }
    if (!rawCode) return key;
    if (rawCode === '155-UASU' || rawCode === '155UASU') {
      return key;
    }
    const safeCode = rawCode.replace(/[^A-Z0-9_-]/g, '_');
    return `${key}__office_${safeCode}`;
  } catch {
    return key;
  }
}

/**
 * Global protection hook to patch Storage.prototype.setItem / getItem / removeItem
 * Guarantees no uncaught QuotaExceededError ever crashes the UI and isolates non-155 offices from 155 UASU keys
 */
export function installSafeStorageProtection(): void {
  if (typeof window === 'undefined') return;

  // Run cleanup once on load to purge obsolete keys like baf_sync_logs and old member keys
  pruneNonEssentialStorage();

  const originalStorageSetItem = Storage.prototype.setItem;
  const originalStorageGetItem = Storage.prototype.getItem;
  const originalStorageRemoveItem = Storage.prototype.removeItem;

  rawStorageGetItemRef = originalStorageGetItem;
  rawStorageSetItemRef = originalStorageSetItem;

  Storage.prototype.getItem = function (this: Storage, key: string): string | null {
    const effectiveKey =
      this === window.localStorage
        ? resolveOfficeScopedStorageKey(originalStorageGetItem, key)
        : key;
    return originalStorageGetItem.call(this, effectiveKey);
  };

  Storage.prototype.removeItem = function (this: Storage, key: string): void {
    const effectiveKey =
      this === window.localStorage
        ? resolveOfficeScopedStorageKey(originalStorageGetItem, key)
        : key;
    originalStorageRemoveItem.call(this, effectiveKey);
  };

  Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
    // Special handling for baf_sync_logs: redirect localStorage writes to sessionStorage
    if (this === window.localStorage && key === 'baf_sync_logs') {
      try {
        window.sessionStorage.setItem('baf_sync_logs', value);
      } catch {}
      try {
        originalStorageSetItem.call(this, 'baf_sync_logs', '[]');
      } catch {}
      return;
    }

    const effectiveKey =
      this === window.localStorage
        ? resolveOfficeScopedStorageKey(originalStorageGetItem, key)
        : key;

    // Automatically strip bulky data-URI images from menu-related keys
    const sanitizedValue = this === window.localStorage ? sanitizePayloadForStorage(key, value) : value;

    try {
      originalStorageSetItem.call(this, effectiveKey, sanitizedValue);
    } catch (err: any) {
      const isQuotaError =
        err?.name === 'QuotaExceededError' ||
        err?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
        err?.code === 22 ||
        err?.code === 1014 ||
        (typeof err?.message === 'string' && err.message.toLowerCase().includes('quota'));

      if (isQuotaError && this === window.localStorage) {
        if (shouldLogWarning(effectiveKey)) {
          console.warn(`[SafeStorage Global] Quota exceeded on setItem('${effectiveKey}'). Auto-pruning...`);
        }
        pruneNonEssentialStorage();
        try {
          originalStorageSetItem.call(this, effectiveKey, sanitizedValue);
          return;
        } catch (retryErr) {
          if (shouldLogWarning(effectiveKey + '_suppressed')) {
            console.warn(`[SafeStorage Global] Could not save '${effectiveKey}' after pruning. Suppressed.`);
          }
          return;
        }
      }

      // Re-throw non-quota or non-localStorage errors if not quota
      if (!isQuotaError) {
        throw err;
      }
    }
  };
}

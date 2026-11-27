import {
  getActiveOfficeCode,
  getActiveOfficeIdentity,
  isDefault155UasuOffice,
} from '../firebase';

/**
 * Keys that are global, multi-office, session/auth-specific, or raw database caches
 * and MUST NEVER be included in or overwritten by a single-office backup/restore.
 */
export const GLOBAL_NON_OFFICE_BACKUP_KEYS = new Set<string>([
  'baf_local_storage_snapshot',
  'baf_local_snapshot_time',
  'baf_drive_cloud_snapshot',
  'baf_backup_restore_history_v1',
  'baf_155_uasu_v2_db',
  'baf_database_v2',
  'canteen_members',
  'canteen_members_cache',
  'canteen_transactions',
  'canteen_txs',
  'canteen_sync_logs',
  'canteen_last_handled_sync_revision',
  // Multi-office registry & master owner keys (must NEVER leak across offices)
  'custom_office_config',
  'baf_custom_office_firebase_config_v1',
  'baf_master_registered_offices_cache',
  'baf_registered_offices_v1',
  'baf_master_portal_offices_local_v1',
  'baf_custom_office_clean_v3',
  'baf_pending_office_requests_v1',
  'baf_rejected_office_request_ids_v1',
  'baf_removed_office_codes_v1',
  'baf_master_credentials_v1',
  'baf_master_cloud_pool_v1',
  'baf_global_user_office_map_v1',
  'baf_pwa_active_office_meta',
  'baf_linked_firebase_target',
  // Session, login history, sync telemetry, Google Drive auth metadata
  'baf_last_used_login_portal',
  'baf_office_last_used_id',
  'baf_last_used_id',
  'baf_canteen_last_used_id',
  'baf_last_used_canteen_id',
  'baf_recent_logins',
  'baf_user_login_history',
  'baf_canteen_recent_logins',
  'baf_client_session_id',
  'baf_presence',
  'baf_drive_connected',
  'baf_drive_user_email',
  'baf_drive_user_name',
  'baf_drive_user_photo',
  'baf_drive_last_backup',
  'baf_gmail_user',
  'baf_firebase_quota_exceeded_at',
  'baf_firebase_quota_error_msg',
  'baf_cloud_connected',
  'baf_cloud_last_sync',
  'baf_last_firebase_pull_at',
  'baf_last_handled_sync_revision',
  'baf_last_synced_data_hash',
  'baf_pending_sync',
  'baf_pending_delta_queue_v1',
  'baf_sync_logs',
  'baf_firebase_sync_logs_v1',
  'baf_local_cloud_sync_logs_v1',
  'baf_force_apk_mode',
  'baf_app_current_version_code',
  'baf_app_current_version_name',
  'baf_skipped_app_version',
  'baf_latest_app_version',
  'baf_theme_pref',
]);

export function normalizeOfficeCodeForCompare(rawCode?: string | null): string {
  const clean = String(rawCode || '')
    .toUpperCase()
    .trim();
  if (!clean) return '';
  if (clean === '155-UASU' || clean === '155UASU' || clean === '155_UASU' || clean === '155_UASU_BAF') {
    return '155-UASU';
  }
  return clean.replace(/[^A-Z0-9_-]/g, '-');
}

/**
 * Strictly determines whether a localStorage key belongs ONLY to the currently active office
 * and is safe to export in or restore from a single-office backup.
 */
export function isStorageKeyAllowedForActiveOfficeBackup(key: string): boolean {
  if (!key || typeof key !== 'string') return false;

  const officeIdx = key.indexOf('__office_');
  const baseKey = officeIdx >= 0 ? key.slice(0, officeIdx) : key;

  // Never include global, multi-office, auth, cache, raw DB, or canteen keys
  if (
    GLOBAL_NON_OFFICE_BACKUP_KEYS.has(key) ||
    GLOBAL_NON_OFFICE_BACKUP_KEYS.has(baseKey) ||
    baseKey.endsWith('_db') ||
    baseKey.startsWith('baf_local_db_v3') ||
    baseKey.startsWith('canteen_')
  ) {
    return false;
  }

  const is155 = isDefault155UasuOffice();
  if (is155) {
    // 155 UASU uses unscoped keys; NEVER include any __office_<OTHER> key
    return officeIdx === -1;
  }

  // Custom office: ONLY include keys explicitly scoped to THIS active office
  const safeCode = getActiveOfficeCode().replace(/[^A-Z0-9_-]/g, '_');
  const requiredSuffix = `__office_${safeCode}`;
  return key.endsWith(requiredSuffix);
}

/**
 * Collects ONLY the localStorage settings belonging to the currently logged-in office.
 * Zero other-office caches or multi-office registries are ever included.
 */
export function collectStrictActiveOfficeLocalSettings(): Record<string, string> {
  const localSettings: Record<string, string> = {};
  if (typeof window === 'undefined' || !window.localStorage) return localSettings;

  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !isStorageKeyAllowedForActiveOfficeBackup(key)) continue;
      const val = window.localStorage.getItem(key);
      if (val !== null && val !== undefined) {
        localSettings[key] = val;
      }
    }
  } catch (err) {
    console.warn('Could not collect strict office localStorage settings:', err);
  }
  return localSettings;
}

export function getOfficeBackupFilePrefix(): string {
  if (isDefault155UasuOffice()) {
    return '155_UASU_BAF';
  }
  const code = getActiveOfficeCode().replace(/[^A-Za-z0-9_-]/g, '_');
  return code || 'OFFICE';
}

export interface BackupOfficeValidationResult {
  ok: boolean;
  error?: string;
  backupOfficeCode: string;
  backupOfficeName: string;
  activeOfficeCode: string;
  activeOfficeName: string;
}

export function extractBackupOfficeMeta(backupData: any): {
  officeCode: string;
  officeName: string;
  isDefault155: boolean;
} {
  if (!backupData || typeof backupData !== 'object') {
    return { officeCode: '', officeName: '', isDefault155: false };
  }

  const explicitCode = String(
    backupData.officeCode ||
      backupData.baf_unit_data?.officeCode ||
      backupData.meta?.officeCode ||
      ''
  ).trim();

  const explicitName = String(
    backupData.officeName ||
      backupData.baf_unit_data?.officeName ||
      backupData.meta?.officeName ||
      ''
  ).trim();

  if (explicitCode) {
    const normCode = normalizeOfficeCodeForCompare(explicitCode);
    return {
      officeCode: normCode,
      officeName: explicitName || (normCode === '155-UASU' ? '155 UASU BAF' : explicitCode),
      isDefault155: normCode === '155-UASU',
    };
  }

  // Legacy backup files created before explicit officeCode tagging
  const unitHint = String(backupData.unit || backupData.app || '').toUpperCase();
  if (unitHint.includes('155 UASU') || unitHint.includes('155-UASU')) {
    return {
      officeCode: '155-UASU',
      officeName: '155 UASU BAF',
      isDefault155: true,
    };
  }

  return { officeCode: '', officeName: '', isDefault155: false };
}

/**
 * Validates that a backup file belongs to the currently active office before restoring.
 */
export function validateBackupMatchesActiveOffice(backupData: any): BackupOfficeValidationResult {
  const activeIdentity = getActiveOfficeIdentity();
  const activeCode = normalizeOfficeCodeForCompare(activeIdentity.officeCode || getActiveOfficeCode());
  const activeName = activeIdentity.officeName || (isDefault155UasuOffice() ? '155 UASU BAF' : activeCode);

  const meta = extractBackupOfficeMeta(backupData);
  const backupCode = meta.officeCode;
  const backupName = meta.officeName || backupCode || 'Unknown Office';

  if (backupCode && activeCode && backupCode !== activeCode) {
    return {
      ok: false,
      backupOfficeCode: backupCode,
      backupOfficeName: backupName,
      activeOfficeCode: activeCode,
      activeOfficeName: activeName,
      error: `অফিস মেলেনি! এই ব্যাকআপ ফাইলটি "${backupName} (${backupCode})" অফিসের, কিন্তু আপনি বর্তমানে "${activeName} (${activeCode})" অফিসে লগইন আছেন। এক অফিসের ব্যাকআপ অন্য অফিসে ইমপোর্ট করা যাবে না।`,
    };
  }

  return {
    ok: true,
    backupOfficeCode: backupCode || activeCode,
    backupOfficeName: meta.officeName || activeName,
    activeOfficeCode: activeCode,
    activeOfficeName: activeName,
  };
}

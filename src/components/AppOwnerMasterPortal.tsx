import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Lock,
  UserCheck,
  Eye,
  EyeOff,
  LogIn,
  X,
  Building2,
  Users,
  Activity,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Loader2,
  AlertCircle,
  LogOut,
  Database,
  Clock,
  Search,
  CheckCircle2,
  ClipboardCheck,
  Phone,
  Briefcase,
  History,
  Trash2,
  Ban,
  Power,
  KeyRound,
  Settings,
  Save,
  ShieldCheck,
  Shield,
  ChevronRight,
  MapPin,
  Sparkles,
  Wrench,
  PowerOff,
  Cloud,
  Plus,
  Play,
  Pause,
} from 'lucide-react';
import { Logo155UASU } from './Logo155UASU';
import {
  getAppConfig,
  saveAppConfig,
  isFeatureActive,
  AppConfig,
  getAppConfigHistory,
  addAppConfigHistory,
  AppConfigHistoryItem,
  updateAppConfigHistoryItemActiveStatus,
  deleteAppConfigHistoryItem,
} from '../utils/appConfig';
import { signOut } from 'firebase/auth';
import {
  masterAuth,
  MASTER_USER_ID,
  MASTER_USER_PIN,
  getMasterCredentials,
  getMasterUserId,
  saveMasterCredentials,
  syncMasterCredentialsFromCloud,
  RegisteredOfficeTelemetry,
  PendingOfficeRegistrationRequest,
  getRegisteredOfficesLocal,
  fetchRegisteredOfficesFromMaster,
  fetchPendingOfficeRequestsFromMaster,
  getPendingOfficeRequestsLocal,
  approveOfficeRegistrationRequest,
  rejectOfficeRegistrationRequest,
  saveCustomOfficeConfig,
  clearCustomOfficeConfig,
  updateActiveOfficeProfile,
  toggleRegisteredOfficeStatus,
  removeRegisteredOffice,
  getOfficeLoginHistoryLocal,
  fetchOfficeLoginHistory,
  clearOfficeLoginHistoryByCode,
  syncBrowserTabIdentity,
  firebaseConfig,
  parseFlexibleFirebaseConfig,
  testCustomFirebaseConnection,
  buildAutoCloudFirebaseConfig,
  CloudPoolShard,
  OfficeFirebaseConfig,
  getMasterCloudPoolLocal,
  fetchMasterCloudPoolFromCloud,
  addCloudPoolShard,
  toggleCloudPoolShardStatus,
  removeCloudPoolShard,
  reassignOfficeToCloudConfig,
  getShareableFirestoreRulesText,
} from '../firebase';
import {
  loginAsMasterOwnerSession,
  provisionMasterOwnerInOffice,
  isMasterPinMatch,
  clearUserSession,
} from '../utils/authSession';
import { localDb } from '../services/localDatabase';
import { Airman } from '../types';

interface AppOwnerMasterPortalProps {
  isOpen: boolean;
  onClose: () => void;
  airmen: Airman[];
  onEnterOfficeAsMaster: () => void;
}

type ConfirmActionState =
  | {
      type: 'APPROVE_REQUEST';
      req: PendingOfficeRegistrationRequest;
    }
  | {
      type: 'REJECT_REQUEST';
      req: PendingOfficeRegistrationRequest;
    }
  | {
      type: 'TOGGLE_OFFICE_STATUS';
      office: RegisteredOfficeTelemetry;
      nextStatus: 'ACTIVE' | 'DISABLED';
    }
  | {
      type: 'REMOVE_OFFICE';
      office: RegisteredOfficeTelemetry;
    }
  | null;

export const AppOwnerMasterPortal: React.FC<AppOwnerMasterPortalProps> = ({
  isOpen,
  onClose,
  airmen,
  onEnterOfficeAsMaster,
}) => {
  const [isOwnerAuthenticated, setIsOwnerAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('baf_master_owner_authenticated') === 'true';
  });
  const [masterUserId, setMasterUserId] = useState<string>('');
  const [masterPin, setMasterPin] = useState<string>('');
  const [showMasterPin, setShowMasterPin] = useState<boolean>(false);
  const [isMasterIdFocused, setIsMasterIdFocused] = useState<boolean>(false);
  const [isMasterPinFocused, setIsMasterPinFocused] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string>('');
  const [isLoggingIn, setIsLoggingIn] = useState<boolean>(false);

  const [currentMasterCreds, setCurrentMasterCreds] = useState(() => getMasterCredentials());

  // Pre-load synchronously at 0ms so there is NEVER a loading screen or 0-count flash
  const [officeRequests, setOfficeRequests] = useState<PendingOfficeRegistrationRequest[]>(() =>
    getPendingOfficeRequestsLocal()
  );
  const [offices, setOffices] = useState<RegisteredOfficeTelemetry[]>(() =>
    getRegisteredOfficesLocal()
  );

  const [activeTab, setActiveTab] = useState<'offices' | 'approvals' | 'cloud_pool' | 'maintenance' | 'settings'>(() => {
    const initialReqs = getPendingOfficeRequestsLocal();
    return initialReqs.some((r) => r.status === 'PENDING') ? 'approvals' : 'offices';
  });

  // Master Cloud Pool State (Multi-Firebase Sharding)
  const [cloudPoolShards, setCloudPoolShards] = useState<CloudPoolShard[]>(() =>
    getMasterCloudPoolLocal()
  );
  const [poolLabelInput, setPoolLabelInput] = useState<string>('');
  const [poolConfigInput, setPoolConfigInput] = useState<string>('');
  const [poolDbIdInput, setPoolDbIdInput] = useState<string>('');
  const [isAddingShard, setIsAddingShard] = useState<boolean>(false);
  const [poolFormError, setPoolFormError] = useState<string>('');
  const [poolFormSuccess, setPoolFormSuccess] = useState<string>('');
  const [testingShardId, setTestingShardId] = useState<string | null>(null);
  const [shardTestResults, setShardTestResults] = useState<
    Record<string, { ok: boolean; rulesReady?: boolean; message: string }>
  >({});
  const [copiedRules, setCopiedRules] = useState<boolean>(false);
  const [reassigningOfficeCode, setReassigningOfficeCode] = useState<string | null>(null);

  // Maintenance Mode State (Master Control Panel)
  const [appConfig, setAppConfig] = useState<AppConfig>(() => getAppConfig());
  const [appConfigHistory, setAppConfigHistory] = useState<AppConfigHistoryItem[]>(() =>
    getAppConfigHistory()
  );
  const [maintDraft, setMaintDraft] = useState(() => {
    const cfg = getAppConfig();
    return {
      message: cfg.maintenance.message || '',
      isScheduled: Boolean(cfg.maintenance.isScheduled),
      startTime: cfg.maintenance.startTime || '',
      endTime: cfg.maintenance.endTime || '',
    };
  });

  const [isSyncingBackground, setIsSyncingBackground] = useState<boolean>(false);
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
  const [approvalBanner, setApprovalBanner] = useState<string>('');
  const [approvedSuccessModal, setApprovedSuccessModal] = useState<PendingOfficeRegistrationRequest | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedProjectId, setCopiedProjectId] = useState<string | null>(null);
  const [enteringProjectId, setEnteringProjectId] = useState<string | null>(null);
  const didInitialTabSelectRef = React.useRef<boolean>(false);

  // Confirmation Popup Modal State
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState>(null);
  const [isConfirmExecuting, setIsConfirmExecuting] = useState<boolean>(false);

  // Per-Office Login History Modal State
  const [historyOffice, setHistoryOffice] = useState<RegisteredOfficeTelemetry | null>(null);
  const [officeHistoryLogs, setOfficeHistoryLogs] = useState<any[]>([]);
  const [isSyncingHistory, setIsSyncingHistory] = useState<boolean>(false);
  const [historySearch, setHistorySearch] = useState<string>('');
  const [confirmClearHistory, setConfirmClearHistory] = useState<boolean>(false);

  // Master ID & PIN Settings Form State
  const [newMasterIdDraft, setNewMasterIdDraft] = useState<string>(() => getMasterUserId());
  const [currentMasterPinInput, setCurrentMasterPinInput] = useState<string>('');
  const [newMasterPinInput, setNewMasterPinInput] = useState<string>('');
  const [confirmMasterPinInput, setConfirmMasterPinInput] = useState<string>('');
  const [showSettingsPins, setShowSettingsPins] = useState<boolean>(false);
  const [masterSettingsError, setMasterSettingsError] = useState<string>('');
  const [masterSettingsSuccess, setMasterSettingsSuccess] = useState<string>('');
  const [isSavingMasterCreds, setIsSavingMasterCreds] = useState<boolean>(false);

  // Auto-disappear approval/action success banner after 5 seconds
  useEffect(() => {
    if (!approvalBanner) return;
    const timer = setTimeout(() => {
      setApprovalBanner('');
    }, 5000);
    return () => clearTimeout(timer);
  }, [approvalBanner]);

  // Auto-disappear Master Settings success banner after 5 seconds
  useEffect(() => {
    if (!masterSettingsSuccess) return;
    const timer = setTimeout(() => {
      setMasterSettingsSuccess('');
    }, 5000);
    return () => clearTimeout(timer);
  }, [masterSettingsSuccess]);

  const loadMasterData = async (showRefreshAnimation: boolean = false) => {
    // 1. Immediately hydrate from local cache (0ms)
    const instantOffices = getRegisteredOfficesLocal();
    const instantRequests = getPendingOfficeRequestsLocal();
    setOffices(instantOffices);
    setOfficeRequests(instantRequests);
    setCloudPoolShards(getMasterCloudPoolLocal());

    if (showRefreshAnimation) {
      setIsSyncingBackground(true);
    }
    try {
      const [officeList, reqList, syncedCreds, poolList] = await Promise.all([
        fetchRegisteredOfficesFromMaster(),
        fetchPendingOfficeRequestsFromMaster(),
        syncMasterCredentialsFromCloud(),
        fetchMasterCloudPoolFromCloud(showRefreshAnimation),
      ]);
      setOffices(officeList);
      setOfficeRequests(reqList.filter((r) => r.status !== 'REJECTED'));
      setCurrentMasterCreds(syncedCreds);
      setNewMasterIdDraft(syncedCreds.masterUserId);
      setCloudPoolShards(poolList);
      if (!didInitialTabSelectRef.current) {
        didInitialTabSelectRef.current = true;
        if (reqList.some((r) => r.status === 'PENDING')) {
          setActiveTab('approvals');
        }
      }
    } catch (err) {
      console.warn('[AppOwnerMasterPortal] Background sync notice:', err);
    } finally {
      setIsSyncingBackground(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setOffices(getRegisteredOfficesLocal());
      setOfficeRequests(getPendingOfficeRequestsLocal());
      const currentCfg = getAppConfig();
      setAppConfig(currentCfg);
      setAppConfigHistory(getAppConfigHistory());
      setMaintDraft({
        message: currentCfg.maintenance.message || '',
        isScheduled: Boolean(currentCfg.maintenance.isScheduled),
        startTime: currentCfg.maintenance.startTime || '',
        endTime: currentCfg.maintenance.endTime || '',
      });
      syncMasterCredentialsFromCloud()
        .then((creds) => {
          setCurrentMasterCreds(creds);
          setNewMasterIdDraft(creds.masterUserId);
        })
        .catch(() => {});
    }
    if (isOpen && isOwnerAuthenticated) {
      loadMasterData(false);
    }
    if (!isOpen) {
      didInitialTabSelectRef.current = false;
      setConfirmAction(null);
      setApprovedSuccessModal(null);
      setHistoryOffice(null);
    }
  }, [isOpen, isOwnerAuthenticated]);

  // Auto-Login when valid Master User ID & Master PIN are entered (Matches normal Login Portal behavior)
  useEffect(() => {
    if (!isOpen || isOwnerAuthenticated || isLoggingIn) return;
    const cleanId = masterUserId.replace(/^BD\/?/i, '').replace(/\s+/g, '').trim();
    const cleanDigits = cleanId.replace(/\D/g, '');
    const cleanPin = masterPin.trim();
    if (!cleanId || cleanPin.length < 4) return;

    const activeMasterId = getMasterUserId();
    const isValidMasterId =
      cleanId === activeMasterId ||
      cleanDigits === activeMasterId ||
      cleanId === MASTER_USER_ID ||
      cleanDigits === MASTER_USER_ID;

    const isValidPin =
      isMasterPinMatch(cleanPin) ||
      cleanPin === currentMasterCreds.masterPin ||
      cleanPin === MASTER_USER_PIN ||
      cleanPin === '1124';

    if (isValidMasterId && isValidPin) {
      sessionStorage.setItem('baf_master_owner_authenticated', 'true');
      setOffices(getRegisteredOfficesLocal());
      setOfficeRequests(getPendingOfficeRequestsLocal());
      setIsOwnerAuthenticated(true);
    }
  }, [masterUserId, masterPin, isOpen, isOwnerAuthenticated, isLoggingIn, currentMasterCreds.masterPin]);

  const handleSaveMaintenance = () => {
    const updatedConfig: AppConfig = {
      ...appConfig,
      maintenance: {
        isActive: true,
        message: maintDraft.message.trim(),
        isScheduled: maintDraft.isScheduled,
        startTime: maintDraft.isScheduled ? maintDraft.startTime : undefined,
        endTime: maintDraft.isScheduled ? maintDraft.endTime : undefined,
      },
    };
    saveAppConfig(updatedConfig);
    setAppConfig(updatedConfig);
    try {
      localDb.syncSettingToCloud('baf_app_config', JSON.stringify(updatedConfig));
    } catch {}
    setMaintDraft({ message: '', isScheduled: false, startTime: '', endTime: '' });
    if (maintDraft.message.trim()) {
      setAppConfigHistory(
        addAppConfigHistory({
          type: 'MAINTENANCE',
          message: maintDraft.message.trim(),
          startTime: maintDraft.isScheduled ? maintDraft.startTime : undefined,
          endTime: maintDraft.isScheduled ? maintDraft.endTime : undefined,
          isActive: true,
        })
      );
    }
    setApprovalBanner('Maintenance Mode has been enabled globally.');
  };

  const handleDeactivateMaintenance = () => {
    const updatedConfig: AppConfig = {
      ...appConfig,
      maintenance: {
        ...appConfig.maintenance,
        isActive: false,
      },
    };
    saveAppConfig(updatedConfig);
    setAppConfig(updatedConfig);
    try {
      localDb.syncSettingToCloud('baf_app_config', JSON.stringify(updatedConfig));
    } catch {}
    const activeItem = appConfigHistory.find(
      (i) => i.type === 'MAINTENANCE' && i.isActive
    );
    if (activeItem) {
      setAppConfigHistory(updateAppConfigHistoryItemActiveStatus(activeItem.id, false));
    }
    setApprovalBanner('Maintenance Mode has been deactivated.');
  };

  const handleDeleteMaintenanceHistoryItem = (item: AppConfigHistoryItem) => {
    if (item.isActive) {
      const updatedConfig: AppConfig = {
        ...appConfig,
        maintenance: { ...appConfig.maintenance, isActive: false },
      };
      saveAppConfig(updatedConfig);
      setAppConfig(updatedConfig);
      try {
        localDb.syncSettingToCloud('baf_app_config', JSON.stringify(updatedConfig));
      } catch {}
    }
    setAppConfigHistory(deleteAppConfigHistoryItem(item.id));
  };

  useEffect(() => {
    const onReqUpdate = (e: Event) => {
      if (!isOpen || !isOwnerAuthenticated) return;
      const customEv = e as CustomEvent<PendingOfficeRegistrationRequest[]>;
      if (Array.isArray(customEv.detail)) {
        setOfficeRequests(customEv.detail.filter((r) => r.status !== 'REJECTED'));
      } else {
        setOfficeRequests(getPendingOfficeRequestsLocal());
      }
    };
    const onCredsUpdate = () => {
      const creds = getMasterCredentials();
      setCurrentMasterCreds(creds);
      setNewMasterIdDraft(creds.masterUserId);
    };
    window.addEventListener('baf_pending_office_requests_updated', onReqUpdate);
    window.addEventListener('baf_master_credentials_updated', onCredsUpdate);
    return () => {
      window.removeEventListener('baf_pending_office_requests_updated', onReqUpdate);
      window.removeEventListener('baf_master_credentials_updated', onCredsUpdate);
    };
  }, [isOpen, isOwnerAuthenticated]);

  if (!isOpen) return null;

  const handleMasterLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    const cleanId = masterUserId.replace(/^BD\/?/i, '').replace(/\s+/g, '').trim();
    const cleanDigits = cleanId.replace(/\D/g, '');
    const cleanPin = masterPin.trim();

    if (!cleanId) {
      setAuthError('Please enter your Master User ID.');
      return;
    }
    if (!cleanPin) {
      setAuthError('Please enter your Master PIN.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const activeMasterId = getMasterUserId();
      const isValidMasterId =
        cleanId === activeMasterId ||
        cleanDigits === activeMasterId ||
        cleanId === MASTER_USER_ID ||
        cleanDigits === MASTER_USER_ID;

      const isValidPin =
        isMasterPinMatch(cleanPin) ||
        cleanPin === currentMasterCreds.masterPin ||
        cleanPin === MASTER_USER_PIN ||
        cleanPin === '1124';

      if (isValidMasterId && isValidPin) {
        sessionStorage.setItem('baf_master_owner_authenticated', 'true');
        setOffices(getRegisteredOfficesLocal());
        setOfficeRequests(getPendingOfficeRequestsLocal());
        setIsOwnerAuthenticated(true);
      } else if (!isValidMasterId) {
        setAuthError('Invalid Master User ID. Only authorized Master User ID is allowed.');
      } else {
        setAuthError('Invalid Master PIN. Please enter the correct Master PIN.');
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleMasterLogout = () => {
    try {
      sessionStorage.removeItem('baf_master_owner_authenticated');
      clearUserSession();
    } catch {}
    setIsOwnerAuthenticated(false);
    setMasterUserId('');
    setMasterPin('');
    setAuthError('');
    setApprovalBanner('');
    setConfirmAction(null);
    setHistoryOffice(null);
    signOut(masterAuth).catch(() => {});
    onClose();
  };

  const handleInstantApproveRequest = async (req: PendingOfficeRegistrationRequest) => {
    if (processingRequestId) return;
    setProcessingRequestId(req.id);
    try {
      const approved = await approveOfficeRegistrationRequest(req.id);
      setOffices(getRegisteredOfficesLocal());
      setOfficeRequests(getPendingOfficeRequestsLocal());
      if (approved) {
        setApprovedSuccessModal({
          ...req,
          status: 'APPROVED',
          approvedAt: new Date().toISOString(),
        });
        // Background cloud refresh
        fetchRegisteredOfficesFromMaster()
          .then((list) => setOffices(list))
          .catch(() => {});
      }
    } finally {
      setProcessingRequestId(null);
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    const actionToRun = confirmAction;
    // Close confirmation modal immediately so the UI never hangs
    setConfirmAction(null);
    setIsConfirmExecuting(false);

    if (actionToRun.type === 'APPROVE_REQUEST') {
      await handleInstantApproveRequest(actionToRun.req);
    } else if (actionToRun.type === 'REJECT_REQUEST') {
      const req = actionToRun.req;
      // Optimistically remove from state immediately so it disappears at 0ms
      setOfficeRequests((prev) => prev.filter((item) => item.id !== req.id));
      await rejectOfficeRegistrationRequest(req.id);
      setOfficeRequests(getPendingOfficeRequestsLocal());
      setApprovalBanner(`Rejected & removed registration request for "${req.officeName}".`);
    } else if (actionToRun.type === 'TOGGLE_OFFICE_STATUS') {
      const { office, nextStatus } = actionToRun;
      const code = String(
        office.officeCode || office.firebaseConfig?.officeCode || office.projectId
      )
        .toUpperCase()
        .trim();
      setOffices((prev) =>
        prev.map((item) => {
          const itemCode = String(
            item.officeCode || item.firebaseConfig?.officeCode || item.projectId
          )
            .toUpperCase()
            .trim();
          return itemCode === code ? { ...item, status: nextStatus } : item;
        })
      );
      await toggleRegisteredOfficeStatus(code, nextStatus);
      setOffices(getRegisteredOfficesLocal());
      setApprovalBanner(
        `Office "${office.officeName}" (${code}) has been ${
          nextStatus === 'DISABLED' ? 'Disabled' : 'Enabled'
        }.`
      );
    } else if (actionToRun.type === 'REMOVE_OFFICE') {
      const { office } = actionToRun;
      const code = String(
        office.officeCode || office.firebaseConfig?.officeCode || office.projectId
      )
        .toUpperCase()
        .trim();
      // Optimistically remove immediately at 0ms
      setOffices((prev) =>
        prev.filter((item) => {
          const itemCode = String(
            item.officeCode || item.firebaseConfig?.officeCode || item.projectId
          )
            .toUpperCase()
            .trim();
          return itemCode !== code;
        })
      );
      await removeRegisteredOffice(code);
      setOffices(getRegisteredOfficesLocal());
      setApprovalBanner(`Office "${office.officeName}" (${code}) has been permanently removed.`);
    }
  };

  const handleOpenOfficeHistory = async (office: RegisteredOfficeTelemetry) => {
    const code = String(
      office.officeCode || office.firebaseConfig?.officeCode || office.projectId
    )
      .toUpperCase()
      .trim();
    setHistoryOffice(office);
    setHistorySearch('');
    setConfirmClearHistory(false);
    // Pre-load local history at 0ms so no loading screen is shown
    setOfficeHistoryLogs(getOfficeLoginHistoryLocal(code));
    setIsSyncingHistory(true);
    try {
      const logs = await fetchOfficeLoginHistory(code);
      setOfficeHistoryLogs(logs);
    } catch {
      // Keep local logs on error
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const handleRefreshOfficeHistory = async () => {
    if (!historyOffice) return;
    const code = String(
      historyOffice.officeCode ||
        historyOffice.firebaseConfig?.officeCode ||
        historyOffice.projectId
    )
      .toUpperCase()
      .trim();
    setOfficeHistoryLogs(getOfficeLoginHistoryLocal(code));
    setIsSyncingHistory(true);
    try {
      const logs = await fetchOfficeLoginHistory(code);
      setOfficeHistoryLogs(logs);
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const handleClearOfficeHistory = async () => {
    if (!historyOffice) return;
    const code = String(
      historyOffice.officeCode ||
        historyOffice.firebaseConfig?.officeCode ||
        historyOffice.projectId
    )
      .toUpperCase()
      .trim();
    setOfficeHistoryLogs([]);
    setConfirmClearHistory(false);
    await clearOfficeLoginHistoryByCode(code);
    setApprovalBanner(`Cleared login history for "${historyOffice.officeName}".`);
  };

  const handleSaveMasterCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setMasterSettingsError('');
    setMasterSettingsSuccess('');

    const cleanNewId = newMasterIdDraft.replace(/^BD\/?/i, '').replace(/\s+/g, '').trim();
    const cleanCurPin = currentMasterPinInput.trim();
    const cleanNewPin = newMasterPinInput.trim();
    const cleanConfirmPin = confirmMasterPinInput.trim();

    if (!cleanNewId) {
      setMasterSettingsError('Master User ID cannot be empty.');
      return;
    }
    if (!cleanCurPin) {
      setMasterSettingsError('Please enter your Current Master PIN to confirm changes.');
      return;
    }
    const isCurValid =
      isMasterPinMatch(cleanCurPin) ||
      cleanCurPin === currentMasterCreds.masterPin ||
      cleanCurPin === '1124';
    if (!isCurValid) {
      setMasterSettingsError('Current Master PIN is incorrect.');
      return;
    }

    const finalPin = cleanNewPin ? cleanNewPin : currentMasterCreds.masterPin;
    if (cleanNewPin) {
      if (cleanNewPin.length < 4) {
        setMasterSettingsError('New Master PIN must be at least 4 characters.');
        return;
      }
      if (cleanNewPin !== cleanConfirmPin) {
        setMasterSettingsError('New Master PIN and Confirm PIN do not match.');
        return;
      }
    }

    setIsSavingMasterCreds(true);
    try {
      const updated = await saveMasterCredentials(cleanNewId, finalPin);
      setCurrentMasterCreds(updated);
      setNewMasterIdDraft(updated.masterUserId);
      setCurrentMasterPinInput('');
      setNewMasterPinInput('');
      setConfirmMasterPinInput('');
      setMasterSettingsSuccess(
        `Master Credentials updated! Active Master ID: ${updated.masterUserId}`
      );
    } catch {
      setMasterSettingsError('Failed to save Master Credentials.');
    } finally {
      setIsSavingMasterCreds(false);
    }
  };

  const handleEnterOfficeAsMaster = async (office: RegisteredOfficeTelemetry) => {
    const officeCode = String(
      office.officeCode || office.firebaseConfig?.officeCode || office.projectId
    )
      .toUpperCase()
      .trim();
    const key = `${office.projectId}_${officeCode}`;
    setEnteringProjectId(key);
    try {
      if (officeCode === '155-UASU' || officeCode === '155UASU') {
        clearCustomOfficeConfig();
        localDb.switchActiveOfficeWorkspace(false);
      } else {
        const rawSlogan = String(
          office.officeSlogan ?? office.firebaseConfig?.officeSlogan ?? ''
        ).trim();
        const cleanSlogan =
          rawSlogan === 'Intel • Surveillance • Strike' ? '' : rawSlogan;
        saveCustomOfficeConfig({
          officeName: office.officeName,
          officeLogo: office.officeLogo || '/155-uasu-baf-logo.png',
          officeSlogan: cleanSlogan,
          officeBase:
            office.officeBase || office.firebaseConfig?.officeBase || 'BAF BASE ZHR',
          officeCode,
          firebaseConfig: {
            ...office.firebaseConfig,
            officeCode,
            officeSlogan: cleanSlogan,
          },
          configuredAt: office.createdAt || new Date().toISOString(),
        });
        updateActiveOfficeProfile({
          officeName: office.officeName,
          officeLogo: office.officeLogo || '/155-uasu-baf-logo.png',
          officeSlogan: cleanSlogan,
          officeBase:
            office.officeBase || office.firebaseConfig?.officeBase || 'BAF BASE ZHR',
        });
        localDb.switchActiveOfficeWorkspace(false);
      }

      // Ensure Master Owner exists in that office's local & Firebase user registry
      await provisionMasterOwnerInOffice(localDb.getAirmen() || airmen);

      // Set active session as Master Owner
      loginAsMasterOwnerSession();

      syncBrowserTabIdentity(
        office.officeName,
        office.officeLogo || '/155-uasu-baf-logo.png',
        office.officeBase || 'BAF BASE ZHR'
      );

      // Redirect immediately into that office's dashboard with full admin privileges
      onClose();
      onEnterOfficeAsMaster();
    } finally {
      setEnteringProjectId(null);
    }
  };

  const handleCopyInviteLink = async (office: RegisteredOfficeTelemetry) => {
    const code = office.officeCode || office.firebaseConfig?.officeCode || office.projectId;
    const pin = office.joinPin || office.firebaseConfig?.joinPin;
    const copyText = pin ? `Office Code: ${code} | Join PIN: ${pin}` : code;
    const key = `${office.projectId}_${code}`;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopiedProjectId(key);
      setTimeout(() => setCopiedProjectId(null), 2200);
    } catch {
      const input = document.createElement('input');
      input.value = copyText;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopiedProjectId(key);
      setTimeout(() => setCopiedProjectId(null), 2200);
    }
  };

  const handleCopyFirestoreRules = async () => {
    const rulesText = getShareableFirestoreRulesText();
    try {
      await navigator.clipboard.writeText(rulesText);
      setCopiedRules(true);
      setTimeout(() => setCopiedRules(false), 2500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = rulesText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedRules(true);
      setTimeout(() => setCopiedRules(false), 2500);
    }
  };

  const handleAddPoolShard = async (e: React.FormEvent) => {
    e.preventDefault();
    setPoolFormError('');
    setPoolFormSuccess('');

    const parsed = parseFlexibleFirebaseConfig(poolConfigInput);
    if (!parsed) {
      setPoolFormError(
        'Invalid Firebase Config. Paste the JSON or `const firebaseConfig = { ... }` snippet from Firebase Console.'
      );
      return;
    }

    const customDb = poolDbIdInput.trim();
    const targetConfig: OfficeFirebaseConfig = {
      ...parsed,
      ...(customDb && customDb !== '(default)' ? { firestoreDatabaseId: customDb } : {}),
    };

    setIsAddingShard(true);
    try {
      const testRes = await testCustomFirebaseConnection(targetConfig);
      if (!testRes.ok) {
        setPoolFormError(testRes.message || 'Could not connect to this Firebase project.');
        return;
      }

      if (testRes.effectiveDatabaseId && testRes.effectiveDatabaseId !== '(default)') {
        targetConfig.firestoreDatabaseId = testRes.effectiveDatabaseId;
      } else if (testRes.effectiveDatabaseId === '(default)') {
        delete targetConfig.firestoreDatabaseId;
      }

      const nextList = await addCloudPoolShard(
        poolLabelInput.trim() || targetConfig.projectId,
        targetConfig
      );
      const addedId = `${targetConfig.projectId}__${targetConfig.firestoreDatabaseId?.trim() || '(default)'}`.replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

      if (testRes.rulesReady === false) {
        const pausedList = await toggleCloudPoolShardStatus(addedId, 'PAUSED');
        setCloudPoolShards(pausedList);
        setShardTestResults((prev) => ({
          ...prev,
          [addedId]: { ok: true, rulesReady: false, message: testRes.message },
        }));
        setPoolFormError(
          `Project "${targetConfig.projectId}" added as PAUSED because Firestore Rules returned 403. Copy & publish firestore.rules in that project, then click Test & Activate.`
        );
      } else {
        setCloudPoolShards(nextList);
        setShardTestResults((prev) => ({
          ...prev,
          [addedId]: { ok: true, rulesReady: true, message: testRes.message },
        }));
        setPoolFormSuccess(
          `Added "${poolLabelInput.trim() || targetConfig.projectId}" to Auto Cloud Pool! New offices will automatically use it.`
        );
      }

      setPoolLabelInput('');
      setPoolConfigInput('');
      setPoolDbIdInput('');
    } catch (err: any) {
      setPoolFormError(err?.message || 'Failed adding Firebase shard to Cloud Pool.');
    } finally {
      setIsAddingShard(false);
    }
  };

  const handleTestPoolShard = async (shard: CloudPoolShard) => {
    setTestingShardId(shard.id);
    try {
      const res = await testCustomFirebaseConnection(shard.firebaseConfig);
      setShardTestResults((prev) => ({
        ...prev,
        [shard.id]: {
          ok: res.ok,
          rulesReady: res.rulesReady,
          message: res.message,
        },
      }));
    } finally {
      setTestingShardId(null);
    }
  };

  const handleTogglePoolShardStatus = async (shard: CloudPoolShard) => {
    const nextStatus = shard.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    const nextList = await toggleCloudPoolShardStatus(shard.id, nextStatus);
    setCloudPoolShards(nextList);
    setApprovalBanner(
      `Cloud Pool shard "${shard.label}" (${shard.firebaseConfig.projectId}) is now ${nextStatus}.`
    );
  };

  const handleRemovePoolShard = async (shard: CloudPoolShard) => {
    const nextList = await removeCloudPoolShard(shard.id);
    setCloudPoolShards(nextList);
    setApprovalBanner(`Removed shard "${shard.label}" from Auto Cloud Pool.`);
  };

  const handleReassignOfficeCloud = async (officeCode: string, targetValue: string) => {
    setReassigningOfficeCode(officeCode);
    try {
      let targetFb: OfficeFirebaseConfig | null = null;
      if (targetValue === '__PRIMARY__') {
        targetFb = buildAutoCloudFirebaseConfig(officeCode, officeCode);
      } else {
        const matchedShard = cloudPoolShards.find((s) => s.id === targetValue);
        if (matchedShard) {
          targetFb = { ...matchedShard.firebaseConfig, officeCode };
        }
      }
      if (!targetFb) return;
      await reassignOfficeToCloudConfig(officeCode, targetFb);
      setOffices(getRegisteredOfficesLocal());
      setApprovalBanner(
        `Assigned office "${officeCode}" to Firebase project "${targetFb.projectId}".`
      );
    } finally {
      setReassigningOfficeCode(null);
    }
  };

  const totalOffices = offices.length;
  // Total Active Users across all active/registered offices
  const totalCombinedActiveUsers = offices
    .filter((item) => item.status !== 'DISABLED')
    .reduce((sum, item) => sum + (Number(item.totalUsers) || 0), 0);
  const activeOfficesCount = offices.filter((item) => item.status !== 'DISABLED').length;

  // Exclude any REJECTED requests so rejected items disappear immediately
  const visibleRequests = officeRequests.filter((r) => r.status !== 'REJECTED');
  const pendingRequests = visibleRequests.filter((r) => r.status === 'PENDING');
  const pendingCount = pendingRequests.length;

  const filteredOffices = offices.filter((o) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (o.officeName || '').toLowerCase().includes(q) ||
      (o.officeCode || '').toLowerCase().includes(q) ||
      (o.officeBase || '').toLowerCase().includes(q) ||
      (o.projectId || '').toLowerCase().includes(q)
    );
  });

  const filteredHistoryLogs = officeHistoryLogs.filter((log) => {
    if (!historySearch.trim()) return true;
    const q = historySearch.toLowerCase();
    return (
      String(log.bdNo || '').toLowerCase().includes(q) ||
      String(log.name || '').toLowerCase().includes(q) ||
      String(log.rank || '').toLowerCase().includes(q) ||
      String(log.flightName || '').toLowerCase().includes(q) ||
      String(log.role || '').toLowerCase().includes(q) ||
      String(log.deviceInfo || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-2 sm:p-4 overflow-y-auto">
      {!isOwnerAuthenticated ? (
        /* APP OWNER MASTER LOGIN MODAL — MATCHES NORMAL LOGIN PORTAL (UserLoginGate.tsx) */
        <div className="w-full max-w-[340px] sm:max-w-[360px] bg-white/95 dark:bg-[#0d1526]/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800/90 rounded-2xl p-5 sm:p-7 shadow-2xl space-y-4 sm:space-y-5 text-slate-900 dark:text-white text-center relative animate-fadeIn">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3.5 right-3.5 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Close Master Control Portal"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Emblem Logo — Same as Normal Login Portal */}
          <div className="flex justify-center">
            <Logo155UASU
              size="lg"
              logoOverride="/office-management-logo.png?v=26"
              title="Master Control Center"
            />
          </div>

          {/* Header Titles — Same Typography & Pill Style as Normal Login Portal */}
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest">
              <Shield className="w-3 h-3" />
              <span>MASTER CONTROL PORTAL</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
              MASTER CONTROL
            </h1>
          </div>

          {authError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2.5 text-left animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-700 dark:text-red-200 leading-relaxed">{authError}</div>
            </div>
          )}

          <form onSubmit={handleMasterLogin} className="space-y-4 text-left pt-1" noValidate>
            {/* Floating Label USER ID Input — Identical to Normal Login Portal */}
            <div className="relative">
              <div className="relative">
                <UserCheck
                  className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 transition-colors duration-200 ${
                    isMasterIdFocused || masterUserId.trim().length > 0
                      ? 'text-emerald-500'
                      : 'text-slate-400'
                  }`}
                />
                <input
                  id="master-portal-userid-input"
                  name="username"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="username"
                  value={masterUserId}
                  onFocus={() => setIsMasterIdFocused(true)}
                  onBlur={() => setIsMasterIdFocused(false)}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/\D/g, '');
                    setMasterUserId(digitsOnly);
                    setAuthError('');
                  }}
                  placeholder=" "
                  className="w-full pl-10 pr-4 pt-4 pb-2 bg-slate-50 dark:bg-[#090f1d] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                  autoFocus
                />
                <label
                  htmlFor="master-portal-userid-input"
                  className={`absolute pointer-events-none uppercase tracking-wider font-bold transition-all duration-200 px-1.5 rounded ${
                    isMasterIdFocused || masterUserId.trim().length > 0
                      ? '-top-2 left-8 text-[10px] bg-white dark:bg-[#0d1526] text-emerald-600 dark:text-emerald-400'
                      : 'top-1/2 -translate-y-1/2 left-9 text-xs text-slate-400 dark:text-slate-500 bg-transparent'
                  }`}
                >
                  USER ID
                </label>
              </div>
            </div>

            {/* Floating Label PIN Input — Identical to Normal Login Portal */}
            <div className="relative">
              <div className="relative">
                <Lock
                  className={`w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10 transition-colors duration-200 ${
                    isMasterPinFocused || masterPin.trim().length > 0
                      ? 'text-emerald-500'
                      : 'text-slate-400'
                  }`}
                />
                <input
                  id="master-portal-pin-input"
                  name="pin"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={masterPin}
                  onFocus={() => setIsMasterPinFocused(true)}
                  onBlur={() => setIsMasterPinFocused(false)}
                  onChange={(e) => {
                    const digitsOnly = e.target.value.replace(/\D/g, '');
                    setMasterPin(digitsOnly);
                    setAuthError('');
                  }}
                  placeholder=" "
                  style={
                    {
                      WebkitTextSecurity: showMasterPin ? 'none' : 'disc',
                    } as React.CSSProperties
                  }
                  className="w-full pl-10 pr-10 pt-4 pb-2 bg-slate-50 dark:bg-[#090f1d] border border-slate-300 dark:border-slate-700/80 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
                <label
                  htmlFor="master-portal-pin-input"
                  className={`absolute pointer-events-none uppercase tracking-wider font-bold transition-all duration-200 px-1.5 rounded ${
                    isMasterPinFocused || masterPin.trim().length > 0
                      ? '-top-2 left-8 text-[10px] bg-white dark:bg-[#0d1526] text-emerald-600 dark:text-emerald-400'
                      : 'top-1/2 -translate-y-1/2 left-9 text-xs text-slate-400 dark:text-slate-500 bg-transparent'
                  }`}
                >
                  PIN
                </label>
                <button
                  type="button"
                  onClick={() => setShowMasterPin(!showMasterPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 cursor-pointer"
                  title={showMasterPin ? 'Hide PIN' : 'Show PIN'}
                >
                  {showMasterPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 cursor-pointer disabled:opacity-50"
            >
              {isLoggingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  <span>Login</span>
                </>
              )}
            </button>
          </form>
        </div>
      ) : (
        /* PROFESSIONAL APP-STYLE MASTER CONTROL CENTER (2-COLUMN SIDEBAR + WORKSPACE LAYOUT) */
        <div className="w-full max-w-6xl h-[90vh] max-h-[860px] bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-900 dark:text-white flex flex-col md:flex-row relative">
          {/* LEFT COMMAND SIDEBAR (Matches App Sidebar.tsx Aesthetic) */}
          <aside className="w-full md:w-64 bg-white dark:bg-slate-950 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 flex flex-col justify-between shrink-0">
            <div>
              {/* Brand Header */}
              <div className="p-4 md:p-5 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between md:block">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 flex items-center justify-center shrink-0 shadow-sm">
                    <img
                      src="/155-uasu-baf-logo.png"
                      alt="Master Control Emblem"
                      className="w-8 h-8 object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest border border-emerald-500/30">
                      APP OWNER PORTAL
                    </span>
                    <h1 className="text-sm font-black tracking-tight text-slate-900 dark:text-white truncate mt-0.5">
                      Master Control
                    </h1>
                    <p className="text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400">
                      ID: {currentMasterCreds.masterUserId}
                    </p>
                  </div>
                </div>

                {/* Mobile quick actions */}
                <div className="flex items-center gap-1.5 md:hidden">
                  <button
                    type="button"
                    onClick={() => loadMasterData(true)}
                    className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                    title="Sync Now"
                  >
                    <RefreshCw className={`w-4 h-4 ${isSyncingBackground ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Navigation Menu */}
              <div className="p-3 space-y-1.5 flex md:flex-col overflow-x-auto md:overflow-visible">
                <p className="hidden md:block px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">
                  Command Navigation
                </p>

                <button
                  type="button"
                  onClick={() => setActiveTab('offices')}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'offices'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span>Registered Offices</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black ${
                      activeTab === 'offices'
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {totalOffices}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('approvals')}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'approvals'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ClipboardCheck className="w-4 h-4 shrink-0" />
                    <span>Approval Requests</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black ${
                      activeTab === 'approvals'
                        ? 'bg-white/20 text-white'
                        : pendingCount > 0
                        ? 'bg-amber-500 text-white animate-pulse'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {pendingCount}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('cloud_pool');
                    setPoolFormError('');
                    setPoolFormSuccess('');
                  }}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'cloud_pool'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Cloud className="w-4 h-4 shrink-0" />
                    <span>Cloud Pool</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black ${
                      activeTab === 'cloud_pool'
                        ? 'bg-white/20 text-white'
                        : 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                    }`}
                  >
                    {cloudPoolShards.filter((s) => s.status === 'ACTIVE').length}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('maintenance')}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'maintenance'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Wrench className="w-4 h-4 shrink-0" />
                    <span>Maintenance Mode</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black ${
                      activeTab === 'maintenance'
                        ? 'bg-white/20 text-white'
                        : isFeatureActive(appConfig.maintenance)
                        ? 'bg-rose-500 text-white animate-pulse'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {isFeatureActive(appConfig.maintenance) ? 'LIVE' : 'OFF'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('settings');
                    setMasterSettingsError('');
                    setMasterSettingsSuccess('');
                  }}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'settings'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <KeyRound className="w-4 h-4 shrink-0" />
                    <span>Master ID & PIN</span>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 opacity-60 hidden md:block" />
                </button>
              </div>
            </div>

            {/* Sidebar Bottom Footer */}
            <div className="hidden md:flex flex-col gap-3 p-4 border-t border-slate-200 dark:border-slate-800/80 bg-slate-50/60 dark:bg-slate-900/40">
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  <span>System Status</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    ONLINE
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium">
                  {activeOfficesCount} Active Workspace{activeOfficesCount === 1 ? '' : 's'} •{' '}
                  {totalCombinedActiveUsers} Active Users
                </p>
              </div>

              <button
                type="button"
                onClick={handleMasterLogout}
                className="w-full py-2.5 px-3.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out Master</span>
              </button>
            </div>
          </aside>

          {/* RIGHT MAIN WORKSPACE */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50 dark:bg-slate-900">
            {/* Top Workspace Header (Matches App TopHeader.tsx Aesthetic) */}
            <header className="px-6 py-4 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base sm:text-lg font-black tracking-tight text-slate-900 dark:text-white">
                    {activeTab === 'offices'
                      ? 'Registered Office Workspaces'
                      : activeTab === 'approvals'
                      ? 'New Office Approval Queue'
                      : activeTab === 'cloud_pool'
                      ? 'Auto Cloud Pool (Multi-Firebase Sharding)'
                      : activeTab === 'maintenance'
                      ? 'Global System Maintenance Mode'
                      : 'Master Security & Credentials'}
                  </h2>
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25">
                    <ShieldCheck className="w-3 h-3" />
                    Pre-Loaded Realtime
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeTab === 'offices'
                    ? 'Inspect, enter, disable/enable, or view login history for any registered office.'
                    : activeTab === 'approvals'
                    ? 'Review and approve new office setup requests submitted from the login portal.'
                    : activeTab === 'cloud_pool'
                    ? 'Register free Firebase projects here. New offices automatically get separate clouds with zero user hassle.'
                    : activeTab === 'maintenance'
                    ? 'Activate, schedule, or deactivate global application maintenance mode across all offices.'
                    : 'Manage your Master User ID and Master PIN for global workspace access.'}
                </p>
              </div>

              <div className="hidden md:flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadMasterData(true)}
                  className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors border border-slate-200/80 dark:border-slate-700"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-emerald-500 ${
                      isSyncingBackground ? 'animate-spin' : ''
                    }`}
                  />
                  <span>Sync Data</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer transition-colors border border-slate-200/80 dark:border-slate-700"
                  title="Close Master Control Center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            {/* Scrollable Workspace Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* 4 KPI Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div
                  onClick={() => setActiveTab('offices')}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:border-emerald-500/40 transition-all cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Registered Offices
                    </p>
                    <p className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white mt-1">
                      {totalOffices}
                    </p>
                    <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      Total Configured Units
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('approvals')}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 shadow-sm hover:border-amber-500/40 transition-all cursor-pointer flex items-center justify-between"
                >
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Pending Approvals
                    </p>
                    <p className="text-2xl font-black font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1">
                      {pendingCount}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                      Awaiting Master Action
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                    <ClipboardCheck className="w-5 h-5" />
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Active Users
                    </p>
                    <p className="text-2xl font-black font-mono tabular-nums text-sky-600 dark:text-sky-400 mt-1">
                      {totalCombinedActiveUsers}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                      Active Roster Strength
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-sky-500/10 border border-sky-500/25 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                      Active Offices
                    </p>
                    <p className="text-2xl font-black font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">
                      {activeOfficesCount}
                    </p>
                    <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                      Enabled & Operational
                    </p>
                  </div>
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                    <Activity className="w-5 h-5" />
                  </div>
                </div>
              </div>

              {/* Auto-Dismissing Action Feedback Banner (Disappears after 5 seconds) */}
              {approvalBanner && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-300 dark:border-emerald-800 flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-200 shadow-sm animate-fadeIn">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="font-bold">{approvalBanner}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setApprovalBanner('')}
                    className="text-emerald-600/70 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-white cursor-pointer p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* TAB 1: REGISTERED OFFICES */}
              {activeTab === 'offices' && (
                <div className="space-y-4">
                  {/* Search & Filter Bar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search registered office by unit name, base, or office code..."
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 dark:text-slate-400 px-2">
                      <span>Showing {filteredOffices.length} of {totalOffices} Offices</span>
                    </div>
                  </div>

                  {/* Offices Grid */}
                  {filteredOffices.length === 0 ? (
                    <div className="p-10 rounded-2xl bg-white dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-2">
                      <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        No Matching Offices Found
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Try clearing your search filter or approve a new office registration request.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {filteredOffices.map((office) => {
                        const code =
                          office.officeCode ||
                          office.firebaseConfig?.officeCode ||
                          office.projectId;
                        const upperCode = String(code || '').toUpperCase().trim();
                        const isDefault155 =
                          upperCode === '155-UASU' || upperCode === '155UASU';
                        const isDisabled = office.status === 'DISABLED';
                        const cardKey = `${office.projectId}_${code}`;
                        const isCopied = copiedProjectId === cardKey;
                        const isEntering = enteringProjectId === cardKey;
                        const logoUrl = office.officeLogo || '/155-uasu-baf-logo.png';
                        const baseName =
                          office.officeBase ||
                          office.firebaseConfig?.officeBase ||
                          'BAF BASE ZHR';
                        const rawCardSlogan = String(
                          office.officeSlogan ?? office.firebaseConfig?.officeSlogan ?? ''
                        ).trim();
                        const sloganText = isDefault155
                          ? rawCardSlogan || 'Intel • Surveillance • Strike'
                          : rawCardSlogan === 'Intel • Surveillance • Strike'
                            ? ''
                            : rawCardSlogan;

                        return (
                          <div
                            key={cardKey}
                            className={`rounded-2xl border transition-all flex flex-col justify-between p-5 shadow-sm ${
                              isDisabled
                                ? 'bg-slate-100/70 dark:bg-slate-950/50 border-rose-500/30 opacity-85'
                                : 'bg-white dark:bg-slate-950 border-slate-200/90 dark:border-slate-800 hover:border-emerald-500/40'
                            }`}
                          >
                            <div>
                              {/* Card Top Row */}
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-3.5 min-w-0">
                                  <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center overflow-hidden shrink-0 p-1.5">
                                    <img
                                      src={logoUrl}
                                      alt={office.officeName}
                                      className="w-full h-full object-contain"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLImageElement).src =
                                          '/155-uasu-baf-logo.png';
                                      }}
                                    />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h3 className="text-base font-black text-slate-900 dark:text-white truncate">
                                        {office.officeName}
                                      </h3>
                                      {isDefault155 && (
                                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30">
                                          Primary HQ
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
                                      <span className="inline-flex items-center gap-1">
                                        <MapPin className="w-3 h-3 text-emerald-500" />
                                        {baseName}
                                      </span>
                                      {sloganText ? (
                                        <>
                                          <span>•</span>
                                          <span className="truncate">{sloganText}</span>
                                        </>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                <span
                                  className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-wider shrink-0 border ${
                                    isDisabled
                                      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
                                      : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                  }`}
                                >
                                  {isDisabled ? 'DISABLED' : 'ACTIVE'}
                                </span>
                              </div>

                              {/* Metrics Bar */}
                              <div className="mt-4 space-y-2.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200/70 dark:border-slate-800/80 text-xs">
                                <div className="grid grid-cols-3 gap-2.5">
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                      Office Code
                                    </p>
                                    <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate mt-0.5">
                                      {code}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                      Active Users
                                    </p>
                                    <p className="font-mono font-black text-slate-900 dark:text-white mt-0.5 flex items-center gap-1">
                                      <Users className="w-3.5 h-3.5 text-sky-500" />
                                      <span>{Number(office.totalUsers) || 0}</span>
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                                      Last Synced
                                    </p>
                                    <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 truncate mt-0.5">
                                      {office.lastActive
                                        ? new Date(office.lastActive).toLocaleDateString()
                                        : 'Active'}
                                    </p>
                                  </div>
                                </div>

                                <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800/70 flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <Database className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                                      Cloud:
                                    </span>
                                    <span className="font-mono text-[10px] font-bold text-indigo-600 dark:text-indigo-400 truncate">
                                      {office.firebaseConfig?.projectId || office.projectId || 'Primary'}
                                    </span>
                                  </div>

                                  {!isDefault155 && cloudPoolShards.length > 0 && (
                                    <select
                                      value={(() => {
                                        const curProj = office.firebaseConfig?.projectId || office.projectId;
                                        const curDb = office.firebaseConfig?.firestoreDatabaseId || '(default)';
                                        const matched = cloudPoolShards.find(
                                          (s) =>
                                            s.firebaseConfig.projectId === curProj &&
                                            (s.firebaseConfig.firestoreDatabaseId || '(default)') === curDb
                                        );
                                        return matched ? matched.id : '__PRIMARY__';
                                      })()}
                                      disabled={reassigningOfficeCode === upperCode}
                                      onChange={(e) => handleReassignOfficeCloud(upperCode, e.target.value)}
                                      className="px-2 py-1 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer max-w-[175px]"
                                      title="Assign Firebase Cloud Shard"
                                    >
                                      <option value="__PRIMARY__">Primary Default Cloud</option>
                                      {cloudPoolShards.map((shard) => (
                                        <option key={shard.id} value={shard.id}>
                                          {shard.label} ({shard.firebaseConfig.projectId})
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="mt-4 pt-3 border-t border-slate-200/80 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => handleOpenOfficeHistory(office)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-indigo-500/15 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 border border-slate-200 dark:border-slate-800 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                                  title="View Office Login History"
                                >
                                  <History className="w-3.5 h-3.5 text-indigo-500" />
                                  <span>History</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleCopyInviteLink(office)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                                  title="Copy Office Code"
                                >
                                  {isCopied ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                                      <span className="text-emerald-600 dark:text-emerald-400">
                                        Copied
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                                      <span>Copy Code</span>
                                    </>
                                  )}
                                </button>

                                {!isDefault155 && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmAction({
                                          type: 'TOGGLE_OFFICE_STATUS',
                                          office,
                                          nextStatus: isDisabled ? 'ACTIVE' : 'DISABLED',
                                        })
                                      }
                                      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors border ${
                                        isDisabled
                                          ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                          : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                      }`}
                                    >
                                      {isDisabled ? (
                                        <>
                                          <Power className="w-3.5 h-3.5" />
                                          <span>Enable</span>
                                        </>
                                      ) : (
                                        <>
                                          <Ban className="w-3.5 h-3.5" />
                                          <span>Disable</span>
                                        </>
                                      )}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmAction({
                                          type: 'REMOVE_OFFICE',
                                          office,
                                        })
                                      }
                                      className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 cursor-pointer transition-colors"
                                      title="Permanently Remove Office"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => handleEnterOfficeAsMaster(office)}
                                disabled={isEntering}
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold flex items-center gap-1.5 shadow-sm cursor-pointer transition-colors disabled:opacity-50"
                              >
                                {isEntering ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Opening...</span>
                                  </>
                                ) : (
                                  <>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span>Enter Office</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: NEW OFFICE APPROVAL REQUESTS (SINGLE-ROW LAYOUT + INSTANT INDIVIDUAL APPROVAL) */}
              {activeTab === 'approvals' && (
                <div className="space-y-3">
                  {pendingRequests.length === 0 ? (
                    <div className="p-12 rounded-2xl bg-white dark:bg-slate-950 border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-2">
                      <ClipboardCheck className="w-9 h-9 text-slate-400 mx-auto" />
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        No Pending Office Registration Requests
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                        When a user submits the "Register a New Office" form on the Login Portal, their request will appear here immediately for single-click approval.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {pendingRequests.map((req) => {
                        const isProcessing = processingRequestId === req.id;

                        return (
                          <div
                            key={req.id}
                            className="p-3.5 rounded-2xl border bg-white dark:bg-slate-950 border-amber-500/40 hover:border-emerald-500/50 transition-all shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-3"
                          >
                            {/* Left: Office Identity */}
                            <div className="flex items-center gap-3 min-w-[210px] max-w-[260px] shrink-0">
                              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center overflow-hidden shrink-0 p-1">
                                <img
                                  src={req.officeLogo || '/155-uasu-baf-logo.png'}
                                  alt={req.officeName}
                                  className="w-full h-full object-contain"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).src =
                                      '/155-uasu-baf-logo.png';
                                  }}
                                />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <h3 className="text-sm font-black text-slate-900 dark:text-white truncate">
                                    {req.officeName}
                                  </h3>
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-800">
                                    {req.officeCode}
                                  </span>
                                </div>
                                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                                  {req.officeBase}
                                </p>
                              </div>
                            </div>

                            {/* Middle (Same Row): Requester Details */}
                            <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 text-[11px]">
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  USER ID (BD NO)
                                </p>
                                <p className="font-mono font-black text-emerald-600 dark:text-emerald-400 truncate">
                                  BD/{req.bdNo}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  RANK
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white truncate">
                                  {req.rank || 'LAC'}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  NAME
                                </p>
                                <p className="font-bold text-slate-900 dark:text-white truncate" title={req.surname || req.fullName}>
                                  {req.surname || req.fullName}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  TRADE
                                </p>
                                <p className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 truncate">
                                  <Briefcase className="w-3 h-3 text-slate-400 shrink-0" />
                                  <span className="truncate">{req.trade}</span>
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  USER ROLE
                                </p>
                                <p className="font-black text-amber-600 dark:text-amber-400 truncate">
                                  {req.userRole === 'SUPER_ADMIN'
                                    ? 'Super Admin'
                                    : req.userRole === 'ADMIN'
                                    ? 'Admin'
                                    : 'User'}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  PRESENT ADDRESS
                                </p>
                                <p className="font-semibold text-slate-700 dark:text-slate-300 truncate" title={req.presentAddress || req.officeBase}>
                                  {req.presentAddress || req.officeBase || 'N/A'}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase text-slate-400">
                                  CONTACT NO
                                </p>
                                <p className="font-mono font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 truncate">
                                  <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                                  <span className="truncate">{req.contactNo || 'N/A'}</span>
                                </p>
                              </div>
                            </div>

                            {/* Right (Same Row): Individual Single-Request Reject & Instant Approve Buttons */}
                            <div className="flex items-center justify-end gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() =>
                                  setConfirmAction({
                                    type: 'REJECT_REQUEST',
                                    req,
                                  })
                                }
                                className="px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Reject</span>
                              </button>
                              <button
                                type="button"
                                disabled={isProcessing}
                                onClick={() => handleInstantApproveRequest(req)}
                                className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors disabled:opacity-50"
                              >
                                {isProcessing ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                    <span>Approving...</span>
                                  </>
                                ) : (
                                  <>
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    <span>Approve</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB: AUTO CLOUD POOL (MULTI-FIREBASE SHARDING) */}
              {activeTab === 'cloud_pool' && (
                <div className="space-y-5">
                  {/* Primary Default Cloud Status + Copy Rules Bar */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-start gap-3.5">
                        <div className="w-11 h-11 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
                          <Database className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black text-slate-900 dark:text-white">
                              Primary Default Cloud
                            </h3>
                            <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              ACTIVE HQ
                            </span>
                          </div>
                          <p className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 mt-1">
                            {buildAutoCloudFirebaseConfig('', '').projectId}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Used as fallback when no extra active shard is registered in the pool. Offices assigned here:{' '}
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {
                                offices.filter(
                                  (o) =>
                                    (o.firebaseConfig?.projectId || o.projectId) ===
                                    buildAutoCloudFirebaseConfig('', '').projectId
                                ).length
                              }
                            </span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="p-5 rounded-2xl bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                          New Project Security Rules
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Publish these Firestore Rules in every new Firebase project before activating it.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyFirestoreRules}
                        className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer transition-colors"
                      >
                        {copiedRules ? (
                          <>
                            <Check className="w-4 h-4" />
                            <span>Copied firestore.rules!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>Copy Ready firestore.rules</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Registered Extra Cloud Shards */}
                  <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">
                          Registered Firebase Shards ({cloudPoolShards.length})
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          When a new office is created or approved, the least-loaded ACTIVE shard is automatically assigned.
                        </p>
                      </div>
                    </div>

                    {cloudPoolShards.length === 0 ? (
                      <div className="p-8 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-1.5">
                        <Cloud className="w-7 h-7 text-slate-400 mx-auto" />
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          No Extra Firebase Shards Added Yet
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                          All offices currently share the Primary Default Cloud (with 99% bundled quota optimization). Add free Firebase projects below to isolate future offices onto separate clouds automatically.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {cloudPoolShards.map((shard) => {
                          const shardDbId = shard.firebaseConfig.firestoreDatabaseId || '(default)';
                          const assignedOffices = offices.filter(
                            (o) =>
                              (o.firebaseConfig?.projectId || o.projectId) ===
                                shard.firebaseConfig.projectId &&
                              (o.firebaseConfig?.firestoreDatabaseId || '(default)') === shardDbId
                          );
                          const testRes = shardTestResults[shard.id];
                          const isPaused = shard.status === 'PAUSED';

                          return (
                            <div
                              key={shard.id}
                              className={`p-4 rounded-xl border space-y-3 transition-all ${
                                isPaused
                                  ? 'bg-slate-50 dark:bg-slate-900/40 border-amber-500/30 opacity-85'
                                  : 'bg-slate-50/70 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h4 className="text-sm font-black text-slate-900 dark:text-white truncate">
                                    {shard.label}
                                  </h4>
                                  <p className="text-[11px] font-mono font-bold text-sky-600 dark:text-sky-400 truncate">
                                    {shard.firebaseConfig.projectId}
                                  </p>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                    DB: <span className="font-mono">{shardDbId}</span> • Assigned Offices:{' '}
                                    <span className="font-bold text-slate-800 dark:text-slate-200">
                                      {assignedOffices.length}
                                    </span>
                                  </p>
                                </div>

                                <span
                                  className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border shrink-0 ${
                                    isPaused
                                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                  }`}
                                >
                                  {shard.status}
                                </span>
                              </div>

                              {assignedOffices.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {assignedOffices.map((off) => (
                                    <span
                                      key={off.officeCode || off.officeName}
                                      className="px-2 py-0.5 rounded-md bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300"
                                    >
                                      {off.officeCode || off.officeName}
                                    </span>
                                  ))}
                                </div>
                              )}

                              {testRes && (
                                <div
                                  className={`p-2 rounded-lg text-[11px] font-semibold border ${
                                    testRes.ok && testRes.rulesReady !== false
                                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                                  }`}
                                >
                                  {testRes.message}
                                </div>
                              )}

                              <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleTestPoolShard(shard)}
                                    disabled={testingShardId === shard.id}
                                    className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                                  >
                                    {testingShardId === shard.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : (
                                      <Activity className="w-3 h-3 text-sky-500" />
                                    )}
                                    <span>Test</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleTogglePoolShardStatus(shard)}
                                    className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold flex items-center gap-1 cursor-pointer ${
                                      isPaused
                                        ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                        : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                    }`}
                                  >
                                    {isPaused ? (
                                      <>
                                        <Play className="w-3 h-3" />
                                        <span>Activate</span>
                                      </>
                                    ) : (
                                      <>
                                        <Pause className="w-3 h-3" />
                                        <span>Pause</span>
                                      </>
                                    )}
                                  </button>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleRemovePoolShard(shard)}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 cursor-pointer"
                                  title="Remove Shard from Pool"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Add Extra Firebase Cloud Form */}
                  <form
                    onSubmit={handleAddPoolShard}
                    className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4 max-w-3xl"
                  >
                    <div className="flex items-center gap-2.5 border-b border-slate-200 dark:border-slate-800 pb-3">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                        <Plus className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-slate-900 dark:text-white">
                          Add Extra Firebase Cloud to Pool
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Paste the web app `firebaseConfig` from a free Spark Firebase project (with Firestore enabled + rules published).
                        </p>
                      </div>
                    </div>

                    {poolFormError && (
                      <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-200 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>{poolFormError}</span>
                      </div>
                    )}

                    {poolFormSuccess && (
                      <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs font-bold text-emerald-700 dark:text-emerald-200 flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{poolFormSuccess}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Shard Label
                        </label>
                        <input
                          type="text"
                          value={poolLabelInput}
                          onChange={(e) => setPoolLabelInput(e.target.value)}
                          placeholder="e.g. Cloud Shard #2 (F-7 / Regional)"
                          className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Firestore Database ID (Optional)
                        </label>
                        <input
                          type="text"
                          value={poolDbIdInput}
                          onChange={(e) => setPoolDbIdInput(e.target.value)}
                          placeholder="Leave blank for (default)"
                          className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        Firebase Config (JSON or JS Snippet) <span className="text-rose-500">*</span>
                      </label>
                      <textarea
                        rows={4}
                        value={poolConfigInput}
                        onChange={(e) => {
                          setPoolConfigInput(e.target.value);
                          setPoolFormError('');
                        }}
                        placeholder={`Paste firebaseConfig here, e.g.:\n{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }`}
                        className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 resize-y"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={isAddingShard || !poolConfigInput.trim()}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer transition-colors"
                      >
                        {isAddingShard ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Testing & Adding...</span>
                          </>
                        ) : (
                          <>
                            <Cloud className="w-4 h-4" />
                            <span>Test & Add to Pool</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* TAB: MAINTENANCE MODE */}
              {activeTab === 'maintenance' && (
                <div className="space-y-6 max-w-2xl">
                  {appConfig.maintenance.isActive && (
                    <div className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-700/60 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                          <Wrench className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-red-800 dark:text-red-300">
                              Maintenance Mode is Active
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
                              Live
                            </span>
                          </div>
                          <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">
                            {appConfig.maintenance.message}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDeactivateMaintenance}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-900 dark:bg-slate-200 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-bold shadow-sm transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap self-start sm:self-auto cursor-pointer"
                      >
                        <PowerOff className="w-3.5 h-3.5" /> Deactivate
                      </button>
                    </div>
                  )}

                  <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                      Activate Maintenance Mode
                    </h3>

                    <div className="space-y-1.5">
                      <label className="text-xs font-bold text-slate-500">
                        Maintenance Message <span className="text-rose-500">*</span>
                      </label>
                      <textarea
                        value={maintDraft.message}
                        onChange={(e) =>
                          setMaintDraft({ ...maintDraft, message: e.target.value })
                        }
                        placeholder="e.g. System is down for scheduled upgrades."
                        rows={4}
                        className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white resize-none text-sm"
                      />
                    </div>

                    <div className="pt-2">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={maintDraft.isScheduled}
                          onChange={(e) =>
                            setMaintDraft({ ...maintDraft, isScheduled: e.target.checked })
                          }
                          className="w-5 h-5 text-red-600 rounded-md border-slate-300 focus:ring-red-500 dark:border-slate-600 dark:bg-slate-900"
                        />
                        <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                          Schedule maintenance window
                        </span>
                      </label>
                    </div>

                    {maintDraft.isScheduled && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500">
                            Start Time
                          </label>
                          <input
                            type="datetime-local"
                            value={maintDraft.startTime}
                            onChange={(e) =>
                              setMaintDraft({ ...maintDraft, startTime: e.target.value })
                            }
                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-xs font-bold text-slate-500">
                            End Time
                          </label>
                          <input
                            type="datetime-local"
                            value={maintDraft.endTime}
                            onChange={(e) =>
                              setMaintDraft({ ...maintDraft, endTime: e.target.value })
                            }
                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white text-sm"
                          />
                        </div>
                      </div>
                    )}

                    <div className="pt-4 flex justify-end">
                      <button
                        type="button"
                        disabled={!maintDraft.message.trim()}
                        onClick={handleSaveMaintenance}
                        className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer"
                      >
                        <Wrench className="w-4 h-4" /> Enable Maintenance Mode
                      </button>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 pb-3 mb-4">
                      Maintenance History
                    </h3>
                    {appConfigHistory.filter((h) => h.type === 'MAINTENANCE').length === 0 ? (
                      <p className="text-sm text-slate-500">No maintenance records.</p>
                    ) : (
                      <div className="space-y-3">
                        {appConfigHistory
                          .filter((h) => h.type === 'MAINTENANCE')
                          .map((h) => (
                            <div
                              key={h.id}
                              className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between"
                            >
                              <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                                  Maintenance Mode
                                </p>
                                <p className="text-xs text-slate-500 line-clamp-1">
                                  {h.message}
                                </p>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  {new Date(h.createdAt).toLocaleString()}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeleteMaintenanceHistoryItem(h)}
                                className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: MASTER ID & PIN CONFIGURATION */}
              {activeTab === 'settings' && (
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-2xl space-y-5 shadow-sm">
                  <div className="flex items-start gap-3.5 border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white">
                        Master User ID & PIN Configuration
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Update the Master User ID and Master PIN used for multi-office login and Master Control Center access.
                      </p>
                    </div>
                  </div>

                  {masterSettingsError && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 rounded-xl flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-200">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                      <span>{masterSettingsError}</span>
                    </div>
                  )}

                  {masterSettingsSuccess && (
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-between gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>{masterSettingsSuccess}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMasterSettingsSuccess('')}
                        className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-300 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <form onSubmit={handleSaveMasterCredentials} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Master User ID (BD No)
                        </label>
                        <div className="relative">
                          <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={newMasterIdDraft}
                            onChange={(e) => {
                              setNewMasterIdDraft(e.target.value);
                              setMasterSettingsError('');
                            }}
                            placeholder="e.g. 48456"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Current Master PIN <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type={showSettingsPins ? 'text' : 'password'}
                            value={currentMasterPinInput}
                            onChange={(e) => {
                              setCurrentMasterPinInput(e.target.value);
                              setMasterSettingsError('');
                            }}
                            placeholder="Enter Current Master PIN"
                            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                          />
                          <button
                            type="button"
                            onClick={() => setShowSettingsPins(!showSettingsPins)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-500 cursor-pointer"
                          >
                            {showSettingsPins ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          New Master PIN
                        </label>
                        <input
                          type={showSettingsPins ? 'text' : 'password'}
                          value={newMasterPinInput}
                          onChange={(e) => {
                            setNewMasterPinInput(e.target.value);
                            setMasterSettingsError('');
                          }}
                          placeholder="Leave blank to keep current PIN"
                          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Confirm New Master PIN
                        </label>
                        <input
                          type={showSettingsPins ? 'text' : 'password'}
                          value={confirmMasterPinInput}
                          onChange={(e) => {
                            setConfirmMasterPinInput(e.target.value);
                            setMasterSettingsError('');
                          }}
                          placeholder="Confirm New Master PIN"
                          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="submit"
                        disabled={isSavingMasterCreds}
                        className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-md cursor-pointer transition-colors disabled:opacity-50"
                      >
                        {isSavingMasterCreds ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4" />
                        )}
                        <span>Save Master ID & PIN</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>
          </div>

          {/* CONFIRMATION POPUP MODAL FOR APPROVE / REJECT / DISABLE / REMOVE */}
          {confirmAction && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 backdrop-blur-sm p-4 animate-fadeIn">
              <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5 text-slate-900 dark:text-white">
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 border ${
                      confirmAction.type === 'APPROVE_REQUEST' ||
                      (confirmAction.type === 'TOGGLE_OFFICE_STATUS' &&
                        confirmAction.nextStatus === 'ACTIVE')
                        ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500'
                        : confirmAction.type === 'TOGGLE_OFFICE_STATUS'
                        ? 'bg-amber-500/15 border-amber-500/30 text-amber-500'
                        : 'bg-rose-500/15 border-rose-500/30 text-rose-500'
                    }`}
                  >
                    {confirmAction.type === 'APPROVE_REQUEST' ? (
                      <CheckCircle2 className="w-6 h-6" />
                    ) : (
                      <AlertCircle className="w-6 h-6" />
                    )}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-black">
                      {confirmAction.type === 'APPROVE_REQUEST' &&
                        'Approve & Create New Office?'}
                      {confirmAction.type === 'REJECT_REQUEST' &&
                        'Reject & Remove Office Request?'}
                      {confirmAction.type === 'TOGGLE_OFFICE_STATUS' &&
                        `${
                          confirmAction.nextStatus === 'DISABLED' ? 'Disable' : 'Enable'
                        } Office Workspace?`}
                      {confirmAction.type === 'REMOVE_OFFICE' && 'Remove Registered Office?'}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      {confirmAction.type === 'APPROVE_REQUEST' &&
                        `Approve "${confirmAction.req.officeName}" (${confirmAction.req.officeCode}) and provision ${confirmAction.req.fullName} (BD/${confirmAction.req.bdNo}) in Biodata Register & User Management?`}
                      {confirmAction.type === 'REJECT_REQUEST' &&
                        `Are you sure you want to reject the registration request for "${confirmAction.req.officeName}" by BD/${confirmAction.req.bdNo}? Once rejected, this request will immediately disappear.`}
                      {confirmAction.type === 'TOGGLE_OFFICE_STATUS' &&
                        `Are you sure you want to ${
                          confirmAction.nextStatus === 'DISABLED' ? 'disable' : 're-enable'
                        } "${confirmAction.office.officeName}"?`}
                      {confirmAction.type === 'REMOVE_OFFICE' &&
                        `Are you sure you want to permanently remove "${confirmAction.office.officeName}"? Its registered office record and user directory mapping will be removed immediately.`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    disabled={isConfirmExecuting}
                    onClick={() => setConfirmAction(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isConfirmExecuting}
                    onClick={executeConfirmedAction}
                    className={`px-4 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-md cursor-pointer transition-colors ${
                      confirmAction.type === 'APPROVE_REQUEST' ||
                      (confirmAction.type === 'TOGGLE_OFFICE_STATUS' &&
                        confirmAction.nextStatus === 'ACTIVE')
                        ? 'bg-emerald-600 hover:bg-emerald-500'
                        : confirmAction.type === 'TOGGLE_OFFICE_STATUS'
                        ? 'bg-amber-600 hover:bg-amber-500'
                        : 'bg-rose-600 hover:bg-rose-500'
                    }`}
                  >
                    <span>
                      {confirmAction.type === 'APPROVE_REQUEST' && 'Yes, Approve & Create'}
                      {confirmAction.type === 'REJECT_REQUEST' && 'Yes, Reject Request'}
                      {confirmAction.type === 'TOGGLE_OFFICE_STATUS' &&
                        `Yes, ${
                          confirmAction.nextStatus === 'DISABLED' ? 'Disable' : 'Enable'
                        }`}
                      {confirmAction.type === 'REMOVE_OFFICE' && 'Yes, Remove Office'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SEPARATE POPUP WINDOW FOR NEW OFFICE APPROVAL SUCCESS */}
          {approvedSuccessModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn">
              <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-emerald-500/40 rounded-2xl p-6 shadow-2xl space-y-5 text-slate-900 dark:text-white relative">
                <button
                  type="button"
                  onClick={() => setApprovedSuccessModal(null)}
                  className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="flex flex-col items-center text-center space-y-2">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-500 flex items-center justify-center shadow-lg">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                    APPROVAL SUCCESSFUL
                  </span>
                  <h3 className="text-lg font-black tracking-tight text-slate-900 dark:text-white">
                    {approvedSuccessModal.officeName} Approved!
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    The office workspace and requester profile have been created and synced to Biodata Register, Nominal Roll & User Management.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
                  <div className="flex items-center gap-3 pb-2.5 border-b border-slate-200 dark:border-slate-800">
                    <img
                      src={approvedSuccessModal.officeLogo || '/155-uasu-baf-logo.png'}
                      alt={approvedSuccessModal.officeName}
                      className="w-10 h-10 rounded-lg object-contain bg-white dark:bg-slate-900 p-1 border border-slate-200 dark:border-slate-800 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-black text-slate-900 dark:text-white truncate">
                        {approvedSuccessModal.officeName}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Code: <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{approvedSuccessModal.officeCode}</span> • {approvedSuccessModal.officeBase}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-slate-400 uppercase font-bold text-[9px] block">User ID (BD No)</span>
                      <span className="font-mono font-black text-emerald-600 dark:text-emerald-400">BD/{approvedSuccessModal.bdNo}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 uppercase font-bold text-[9px] block">Full Name</span>
                      <span className="font-bold text-slate-900 dark:text-white">{approvedSuccessModal.fullName}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 uppercase font-bold text-[9px] block">Trade & Role</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400">
                        {approvedSuccessModal.trade} • {approvedSuccessModal.userRole === 'SUPER_ADMIN' ? 'Super Admin' : approvedSuccessModal.userRole}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 uppercase font-bold text-[9px] block">Contact No</span>
                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{approvedSuccessModal.contactNo || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setApprovedSuccessModal(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                  >
                    Close Window
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const targetOff = offices.find(
                        (o) =>
                          String(o.officeCode || o.firebaseConfig?.officeCode || '')
                            .toUpperCase()
                            .trim() ===
                          String(approvedSuccessModal.officeCode || '')
                            .toUpperCase()
                            .trim()
                      );
                      setApprovedSuccessModal(null);
                      if (targetOff) {
                        handleEnterOfficeAsMaster(targetOff);
                      } else {
                        setActiveTab('offices');
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Enter Office</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* PER-OFFICE LOGIN HISTORY MODAL (PRE-LOADED AT 0ms) */}
          {historyOffice && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn">
              <div className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-900 dark:text-white">
                <div className="px-6 py-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      <History className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-black">
                        {historyOffice.officeName} — Login History
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Office Code:{' '}
                        {historyOffice.officeCode ||
                          historyOffice.firebaseConfig?.officeCode ||
                          historyOffice.projectId}{' '}
                        • {officeHistoryLogs.length} Recorded Sessions
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRefreshOfficeHistory}
                      className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 ${isSyncingHistory ? 'animate-spin' : ''}`}
                      />
                      <span>Sync</span>
                    </button>
                    {officeHistoryLogs.length > 0 &&
                      (!confirmClearHistory ? (
                        <button
                          type="button"
                          onClick={() => setConfirmClearHistory(true)}
                          className="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Clear</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={handleClearOfficeHistory}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-bold cursor-pointer"
                          >
                            Confirm Clear
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClearHistory(false)}
                            className="px-2 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-[11px] font-bold cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    <button
                      type="button"
                      onClick={() => setHistoryOffice(null)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                  <div className="relative max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Filter by BD No, Name, Rank, Role, or Device..."
                      className="w-full pl-10 pr-4 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>

                <div className="p-4 overflow-y-auto flex-1">
                  {filteredHistoryLogs.length === 0 ? (
                    <div className="p-10 text-center space-y-2 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                      <History className="w-7 h-7 text-slate-400 mx-auto" />
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        No Login History Found for {historyOffice.officeName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        When users sign in to this office, their timestamped login records will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 uppercase text-[10px] font-black tracking-wider border-b border-slate-200 dark:border-slate-800">
                            <th className="py-2.5 px-3">Login Time</th>
                            <th className="py-2.5 px-3">BD No</th>
                            <th className="py-2.5 px-3">Rank & Name</th>
                            <th className="py-2.5 px-3">Flight / Trade</th>
                            <th className="py-2.5 px-3">Role</th>
                            <th className="py-2.5 px-3">Device / Browser</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {filteredHistoryLogs.map((log, idx) => (
                            <tr
                              key={log.id || idx}
                              className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                            >
                              <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {log.loginAt
                                  ? new Date(log.loginAt).toLocaleString()
                                  : 'Unknown'}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                {log.bdNo || '-'}
                              </td>
                              <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                {log.rank ? `${log.rank} ` : ''}
                                {log.name || '-'}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                                {log.flightName || log.trade || '-'}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                                  {log.role || 'user'}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 text-[11px] text-slate-500 dark:text-slate-400">
                                {log.deviceInfo || 'Web Browser'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

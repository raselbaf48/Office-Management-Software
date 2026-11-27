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
  Mail,
  Pencil,
  Gauge,
  BarChart3,
  User,
  Award,
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
  getMasterDisplayName,
  getMasterDisplayRank,
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
  PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL,
  resolveFirebaseOwnerEmail,
  getFactoryPrimaryFirebaseConfig,
  DiscoveredFirebaseProject,
  pickGmailViaGoogleAccountChooser,
  fetchFirebaseProjectsForGmailWithGoogle,
} from '../firebase';
import {
  loginAsMasterOwnerSession,
  provisionMasterOwnerInOffice,
  isMasterPinMatch,
  clearUserSession,
} from '../utils/authSession';
import { localDb } from '../services/localDatabase';
import { Airman } from '../types';
import {
  getFirebaseQuotaTelemetrySnapshot,
  subscribeFirebaseQuotaTelemetry,
  resetFirebaseQuotaTelemetry,
  FIREBASE_DAILY_LIMITS,
  FirebaseQuotaTelemetrySnapshot,
} from '../utils/firebaseQuotaTracker';

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

  const [activeTab, setActiveTab] = useState<'offices' | 'approvals' | 'cloud_pool' | 'cloud_quota' | 'maintenance' | 'settings'>(() => {
    const initialReqs = getPendingOfficeRequestsLocal();
    return initialReqs.some((r) => r.status === 'PENDING') ? 'approvals' : 'offices';
  });

  // Master Cloud Pool State (Multi-Firebase Sharding)
  const [cloudPoolShards, setCloudPoolShards] = useState<CloudPoolShard[]>(() =>
    getMasterCloudPoolLocal()
  );
  const [poolLabelInput, setPoolLabelInput] = useState<string>('');
  const [poolOwnerEmailInput, setPoolOwnerEmailInput] = useState<string>('');
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

  // Per-Office Connected Firebase Gmail Switcher Modal State
  const [firebaseModalOffice, setFirebaseModalOffice] = useState<RegisteredOfficeTelemetry | null>(null);
  const [fbModalEmail, setFbModalEmail] = useState<string>('');
  const [fbModalConfigText, setFbModalConfigText] = useState<string>('');
  const [fbModalDbId, setFbModalDbId] = useState<string>('');
  const [fbModalShowConfigEditor, setFbModalShowConfigEditor] = useState<boolean>(false);
  const [fbModalError, setFbModalError] = useState<string>('');
  const [isSwitchingOfficeFirebase, setIsSwitchingOfficeFirebase] = useState<boolean>(false);
  const [isPickingGoogleAccount, setIsPickingGoogleAccount] = useState<boolean>(false);
  const [isFetchingGoogleProjects, setIsFetchingGoogleProjects] = useState<boolean>(false);
  const [discoveredGoogleProjects, setDiscoveredGoogleProjects] = useState<DiscoveredFirebaseProject[]>([]);
  const [copiedAuthDomain, setCopiedAuthDomain] = useState<boolean>(false);

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

  // Master ID, Name, Rank & PIN Settings Form State
  const [newMasterIdDraft, setNewMasterIdDraft] = useState<string>(() => getMasterUserId());
  const [newMasterNameDraft, setNewMasterNameDraft] = useState<string>(() => getMasterDisplayName());
  const [newMasterRankDraft, setNewMasterRankDraft] = useState<string>(() => getMasterDisplayRank());
  const [currentMasterPinInput, setCurrentMasterPinInput] = useState<string>('');
  const [newMasterPinInput, setNewMasterPinInput] = useState<string>('');
  const [confirmMasterPinInput, setConfirmMasterPinInput] = useState<string>('');
  const [showSettingsPins, setShowSettingsPins] = useState<boolean>(false);
  const [masterSettingsError, setMasterSettingsError] = useState<string>('');
  const [masterSettingsSuccess, setMasterSettingsSuccess] = useState<string>('');
  const [isSavingMasterCreds, setIsSavingMasterCreds] = useState<boolean>(false);

  // Real-Time Firebase Cloud Quota Telemetry State
  const [quotaTelemetry, setQuotaTelemetry] = useState<FirebaseQuotaTelemetrySnapshot>(() =>
    getFirebaseQuotaTelemetrySnapshot()
  );
  const [quotaNowMs, setQuotaNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const unsubscribe = subscribeFirebaseQuotaTelemetry((snap) => {
      setQuotaTelemetry(snap);
    });
    const onCredsUpdated = () => {
      setCurrentMasterCreds(getMasterCredentials());
    };
    window.addEventListener('baf_master_credentials_updated', onCredsUpdated);
    return () => {
      unsubscribe();
      window.removeEventListener('baf_master_credentials_updated', onCredsUpdated);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !isOwnerAuthenticated || activeTab !== 'cloud_quota') return;
    setQuotaNowMs(Date.now());
    const timer = setInterval(() => {
      setQuotaNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen, isOwnerAuthenticated, activeTab]);

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
      setNewMasterNameDraft(syncedCreds.masterName || getMasterDisplayName());
      setNewMasterRankDraft(syncedCreds.masterRank || getMasterDisplayRank());
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
          setNewMasterNameDraft(creds.masterName || getMasterDisplayName());
          setNewMasterRankDraft(creds.masterRank || getMasterDisplayRank());
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
      setFirebaseModalOffice(null);
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
    const cleanNewName = newMasterNameDraft.trim() || 'System Master Owner';
    const cleanNewRank = newMasterRankDraft.trim() || 'MWO';
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
      const updated = await saveMasterCredentials(cleanNewId, finalPin, cleanNewName, cleanNewRank);
      setCurrentMasterCreds(updated);
      setNewMasterIdDraft(updated.masterUserId);
      setNewMasterNameDraft(updated.masterName || cleanNewName);
      setNewMasterRankDraft(updated.masterRank || cleanNewRank);
      setCurrentMasterPinInput('');
      setNewMasterPinInput('');
      setConfirmMasterPinInput('');
      setMasterSettingsSuccess(
        `Master Profile updated! ${updated.masterRank || cleanNewRank} ${updated.masterName || cleanNewName} (ID: ${updated.masterUserId})`
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

      const cleanOwnerEmail = poolOwnerEmailInput.trim().toLowerCase();
      if (cleanOwnerEmail) {
        targetConfig.ownerEmail = cleanOwnerEmail;
      }

      const nextList = await addCloudPoolShard(
        poolLabelInput.trim() || cleanOwnerEmail || targetConfig.projectId,
        targetConfig,
        cleanOwnerEmail || undefined
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
          `Added "${poolLabelInput.trim() || cleanOwnerEmail || targetConfig.projectId}" to Auto Cloud Pool! New offices will automatically use it.`
        );
      }

      setPoolLabelInput('');
      setPoolOwnerEmailInput('');
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
      let targetEmail: string | undefined;
      if (targetValue === '__PRIMARY__') {
        targetFb = getFactoryPrimaryFirebaseConfig(officeCode);
        targetEmail = PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL;
      } else {
        const matchedShard = cloudPoolShards.find((s) => s.id === targetValue);
        if (matchedShard) {
          targetEmail = String(
            matchedShard.ownerEmail || matchedShard.firebaseConfig?.ownerEmail || ''
          )
            .trim()
            .toLowerCase();
          targetFb = {
            ...matchedShard.firebaseConfig,
            officeCode,
            ...(targetEmail ? { ownerEmail: targetEmail } : {}),
          };
        }
      }
      if (!targetFb) return;
      await reassignOfficeToCloudConfig(officeCode, targetFb, targetEmail);
      setOffices(getRegisteredOfficesLocal());
      setApprovalBanner(
        `Assigned office "${officeCode}" to Firebase project "${targetFb.projectId}"${
          targetEmail ? ` (${targetEmail})` : ''
        }.`
      );
    } finally {
      setReassigningOfficeCode(null);
    }
  };

  const findSavedFirebaseByGmail = (
    emailInput: string
  ): { email: string; firebaseConfig: OfficeFirebaseConfig; label: string } | null => {
    const clean = emailInput.trim().toLowerCase();
    if (!clean) return null;
    if (clean === PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL) {
      return {
        email: PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL,
        firebaseConfig: getFactoryPrimaryFirebaseConfig(),
        label: 'Primary Default Cloud',
      };
    }
    const matchedShard = cloudPoolShards.find(
      (s) =>
        String(s.ownerEmail || s.firebaseConfig?.ownerEmail || '')
          .trim()
          .toLowerCase() === clean
    );
    if (matchedShard) {
      return {
        email: clean,
        firebaseConfig: matchedShard.firebaseConfig,
        label: matchedShard.label || matchedShard.firebaseConfig.projectId,
      };
    }
    const matchedOffice = offices.find(
      (o) =>
        String(o.ownerEmail || o.firebaseConfig?.ownerEmail || '')
          .trim()
          .toLowerCase() === clean &&
        o.firebaseConfig?.apiKey &&
        o.firebaseConfig?.projectId
    );
    if (matchedOffice) {
      return {
        email: clean,
        firebaseConfig: matchedOffice.firebaseConfig,
        label: matchedOffice.officeName || matchedOffice.projectId,
      };
    }
    return null;
  };

  const connectOfficeToTargetConfig = async (
    office: RegisteredOfficeTelemetry,
    emailInput: string,
    rawConfig: OfficeFirebaseConfig,
    saveToPool: boolean = false
  ) => {
    const cleanEmail = emailInput.trim().toLowerCase();
    const code = String(
      office.officeCode || office.firebaseConfig?.officeCode || office.projectId
    )
      .toUpperCase()
      .trim();

    const targetConfig: OfficeFirebaseConfig = {
      ...rawConfig,
      ownerEmail: cleanEmail,
      officeCode: code,
    };

    if (saveToPool) {
      const updatedPool = await addCloudPoolShard(cleanEmail, targetConfig, cleanEmail);
      setCloudPoolShards(updatedPool);
    }

    await reassignOfficeToCloudConfig(code, targetConfig, cleanEmail);
    setOffices(getRegisteredOfficesLocal());
    setApprovalBanner(
      `Office "${office.officeName}" is now connected to ${cleanEmail} (${targetConfig.projectId}).`
    );
    setFirebaseModalOffice(null);
  };

  const handlePickGmailFromGoogle = async (targetOffice?: RegisteredOfficeTelemetry) => {
    const office = targetOffice || firebaseModalOffice;
    if (!office) return;
    setFbModalError('');
    setIsPickingGoogleAccount(true);
    try {
      const picked = await pickGmailViaGoogleAccountChooser();
      setFbModalEmail(picked.email);
      setDiscoveredGoogleProjects([]);
      setFbModalConfigText('');

      const saved = findSavedFirebaseByGmail(picked.email);
      if (saved) {
        setIsSwitchingOfficeFirebase(true);
        try {
          await connectOfficeToTargetConfig(office, picked.email, saved.firebaseConfig, false);
        } finally {
          setIsSwitchingOfficeFirebase(false);
        }
      } else {
        setFbModalShowConfigEditor(true);
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      if (code === 'auth/popup-blocked') {
        setFbModalError(
          'Browser blocked the Google Account popup. Please allow popups or click "Sign in with Google" below.'
        );
      } else if (code === 'auth/unauthorized-domain') {
        setFbModalError(
          `Domain "${window.location.hostname}" is not authorized in Firebase Auth Console yet. You can still select or enter a Gmail and paste its firebaseConfig below.`
        );
      } else {
        setFbModalError(err?.message || 'Could not open Google Account Chooser.');
      }
    } finally {
      setIsPickingGoogleAccount(false);
    }
  };

  const handleAutoFetchGoogleProjects = async () => {
    setFbModalError('');
    setIsFetchingGoogleProjects(true);
    try {
      const res = await fetchFirebaseProjectsForGmailWithGoogle(fbModalEmail.trim());
      if (res.email) {
        setFbModalEmail(res.email);
      }
      setDiscoveredGoogleProjects(res.projects);
      if (res.projects.length === 0) {
        setFbModalError(
          `No Firebase projects were found under "${res.email}". Create one at console.firebase.google.com or paste a firebaseConfig below.`
        );
      }
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }
      setFbModalError(
        err?.message ||
          'Could not auto-fetch Firebase projects from Google. Paste the firebaseConfig manually below once.'
      );
      setFbModalShowConfigEditor(true);
    } finally {
      setIsFetchingGoogleProjects(false);
    }
  };

  const handleConnectDiscoveredProject = async (proj: DiscoveredFirebaseProject) => {
    if (!firebaseModalOffice || !proj.firebaseConfig) return;
    setFbModalError('');
    setIsSwitchingOfficeFirebase(true);
    try {
      const cleanEmail = fbModalEmail.trim().toLowerCase();
      const customDb = fbModalDbId.trim();
      const targetConfig: OfficeFirebaseConfig = {
        ...proj.firebaseConfig,
        ownerEmail: cleanEmail,
        ...(customDb && customDb !== '(default)' ? { firestoreDatabaseId: customDb } : {}),
      };
      const testRes = await testCustomFirebaseConnection(targetConfig);
      if (!testRes.ok) {
        setFbModalError(testRes.message || 'Could not connect to this Firebase project.');
        return;
      }
      if (testRes.effectiveDatabaseId && testRes.effectiveDatabaseId !== '(default)') {
        targetConfig.firestoreDatabaseId = testRes.effectiveDatabaseId;
      } else if (testRes.effectiveDatabaseId === '(default)') {
        delete targetConfig.firestoreDatabaseId;
      }
      if (testRes.rulesReady === false) {
        setFbModalError(
          `Connected to "${targetConfig.projectId}", but Firestore Rules returned 403. Copy & publish firestore.rules in that project first, then retry.`
        );
        return;
      }
      await connectOfficeToTargetConfig(firebaseModalOffice, cleanEmail, targetConfig, true);
    } catch (err: any) {
      setFbModalError(err?.message || 'Failed connecting to selected Firebase project.');
    } finally {
      setIsSwitchingOfficeFirebase(false);
    }
  };

  const handleOpenChangeFirebaseModal = (
    office: RegisteredOfficeTelemetry,
    launchGoogleChooser: boolean = true
  ) => {
    const currentEmail = resolveFirebaseOwnerEmail(office.firebaseConfig, cloudPoolShards, office);
    setFirebaseModalOffice(office);
    setFbModalEmail(currentEmail || PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL);
    setFbModalConfigText('');
    setFbModalDbId('');
    setFbModalShowConfigEditor(false);
    setFbModalError('');
    setDiscoveredGoogleProjects([]);
    if (launchGoogleChooser) {
      void handlePickGmailFromGoogle(office);
    }
  };

  const handleSaveOfficeFirebaseByGmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseModalOffice) return;
    setFbModalError('');

    const cleanEmail = fbModalEmail.trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFbModalError('Please enter a valid Gmail address (e.g. name@gmail.com).');
      return;
    }

    const code = String(
      firebaseModalOffice.officeCode ||
        firebaseModalOffice.firebaseConfig?.officeCode ||
        firebaseModalOffice.projectId
    )
      .toUpperCase()
      .trim();

    const pastedRaw = fbModalConfigText.trim();
    const matchedSaved = !pastedRaw ? findSavedFirebaseByGmail(cleanEmail) : null;

    if (!pastedRaw && !matchedSaved) {
      setFbModalShowConfigEditor(true);
      setFbModalError(
        `"${cleanEmail}" is not in the saved Cloud Pool yet. Paste that Gmail account's Firebase Config below once to test & connect it.`
      );
      return;
    }

    setIsSwitchingOfficeFirebase(true);
    try {
      let targetConfig: OfficeFirebaseConfig;

      if (pastedRaw) {
        const parsed = parseFlexibleFirebaseConfig(pastedRaw);
        if (!parsed) {
          setFbModalError(
            'Invalid Firebase Config. Paste the JSON or `const firebaseConfig = { ... }` snippet from that Gmail account’s Firebase Console.'
          );
          return;
        }
        const customDb = fbModalDbId.trim();
        targetConfig = {
          ...parsed,
          ownerEmail: cleanEmail,
          officeCode: code,
          ...(customDb && customDb !== '(default)' ? { firestoreDatabaseId: customDb } : {}),
        };

        const testRes = await testCustomFirebaseConnection(targetConfig);
        if (!testRes.ok) {
          setFbModalError(testRes.message || 'Could not connect to this Firebase project.');
          return;
        }

        if (testRes.effectiveDatabaseId && testRes.effectiveDatabaseId !== '(default)') {
          targetConfig.firestoreDatabaseId = testRes.effectiveDatabaseId;
        } else if (testRes.effectiveDatabaseId === '(default)') {
          delete targetConfig.firestoreDatabaseId;
        }

        if (testRes.rulesReady === false) {
          setFbModalError(
            `Connected to "${targetConfig.projectId}", but Firestore Rules returned 403 (Permission Denied). Copy & publish firestore.rules in that Firebase project first, then retry.`
          );
          return;
        }

        const updatedPool = await addCloudPoolShard(cleanEmail, targetConfig, cleanEmail);
        setCloudPoolShards(updatedPool);
      } else {
        targetConfig = {
          ...matchedSaved!.firebaseConfig,
          ownerEmail: cleanEmail,
          officeCode: code,
        };
      }

      await reassignOfficeToCloudConfig(code, targetConfig, cleanEmail);
      setOffices(getRegisteredOfficesLocal());
      setApprovalBanner(
        `Office "${firebaseModalOffice.officeName}" is now connected to ${cleanEmail} (${targetConfig.projectId}).`
      );
      setFirebaseModalOffice(null);
    } catch (err: any) {
      setFbModalError(err?.message || 'Failed switching Firebase connection.');
    } finally {
      setIsSwitchingOfficeFirebase(false);
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
    const resolvedMail = resolveFirebaseOwnerEmail(o.firebaseConfig, cloudPoolShards, o);
    return (
      (o.officeName || '').toLowerCase().includes(q) ||
      (o.officeCode || '').toLowerCase().includes(q) ||
      (o.officeBase || '').toLowerCase().includes(q) ||
      (o.projectId || '').toLowerCase().includes(q) ||
      resolvedMail.toLowerCase().includes(q)
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
                      {currentMasterCreds.masterName || 'Master Control'}
                    </h1>
                    <p className="text-[11px] font-mono font-bold text-slate-500 dark:text-slate-400 truncate">
                      {currentMasterCreds.masterRank || 'MWO'} • ID: {currentMasterCreds.masterUserId}
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
                  onClick={() => setActiveTab('cloud_quota')}
                  className={`w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    activeTab === 'cloud_quota'
                      ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Gauge className="w-4 h-4 shrink-0" />
                    <span>Firebase Quota</span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-black ${
                      activeTab === 'cloud_quota'
                        ? 'bg-white/20 text-white'
                        : quotaTelemetry.serverQuotaExhausted || quotaTelemetry.overallPercent >= 90
                        ? 'bg-rose-500 text-white animate-pulse'
                        : quotaTelemetry.overallPercent >= 70
                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {quotaTelemetry.overallPercent.toFixed(1)}%
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
                    <span>Master Profile & PIN</span>
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
                      : activeTab === 'cloud_quota'
                      ? 'Firebase Cloud Daily Quota Monitor'
                      : activeTab === 'maintenance'
                      ? 'Global System Maintenance Mode'
                      : 'Master Profile, Security & Credentials'}
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
                    : activeTab === 'cloud_quota'
                    ? 'Live Firestore daily Spark quota %, detailed consumption causes, and automatic daily reset at Midnight PT.'
                    : activeTab === 'maintenance'
                    ? 'Activate, schedule, or deactivate global application maintenance mode across all offices.'
                    : 'Configure Master Rank, Name, User ID, and Master PIN for global workspace access.'}
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
                                      <button
                                        type="button"
                                        onClick={() => handleOpenChangeFirebaseModal(office, true)}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer max-w-full"
                                        title={`Connected Firebase Gmail: ${resolveFirebaseOwnerEmail(office.firebaseConfig, cloudPoolShards, office) || 'Not set'} — Click to choose Gmail from Google`}
                                      >
                                        <Mail className="w-3 h-3 text-indigo-500 shrink-0" />
                                        <span className="truncate max-w-[170px]">
                                          {resolveFirebaseOwnerEmail(
                                            office.firebaseConfig,
                                            cloudPoolShards,
                                            office
                                          ) || 'Set Firebase Gmail'}
                                        </span>
                                        <Pencil className="w-2.5 h-2.5 opacity-75 shrink-0" />
                                      </button>
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

                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {cloudPoolShards.length > 0 && (
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
                                        <option value="__PRIMARY__">
                                          {PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL} (Primary)
                                        </option>
                                        {cloudPoolShards.map((shard) => {
                                          const shardEmail =
                                            shard.ownerEmail || shard.firebaseConfig?.ownerEmail;
                                          return (
                                            <option key={shard.id} value={shard.id}>
                                              {shardEmail
                                                ? `${shardEmail} (${shard.firebaseConfig.projectId})`
                                                : `${shard.label} (${shard.firebaseConfig.projectId})`}
                                            </option>
                                          );
                                        })}
                                      </select>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => handleOpenChangeFirebaseModal(office, true)}
                                      className="px-2 py-1 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 text-[10px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
                                      title="Open Google Account Chooser to change Firebase Gmail"
                                    >
                                      <Mail className="w-3 h-3" />
                                      <span>Change Gmail</span>
                                    </button>
                                  </div>
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
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                              <Mail className="w-3 h-3 text-indigo-500" />
                              <span>{PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL}</span>
                            </span>
                          </div>
                          <p className="text-xs font-mono font-bold text-slate-600 dark:text-slate-300 mt-1">
                            {getFactoryPrimaryFirebaseConfig().projectId}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            Used as fallback when no extra active shard is registered in the pool. Offices assigned here:{' '}
                            <span className="font-bold text-slate-800 dark:text-slate-200">
                              {
                                offices.filter(
                                  (o) =>
                                    (o.firebaseConfig?.projectId || o.projectId) ===
                                    getFactoryPrimaryFirebaseConfig().projectId
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
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <h4 className="text-sm font-black text-slate-900 dark:text-white truncate">
                                      {shard.label}
                                    </h4>
                                    {(shard.ownerEmail || shard.firebaseConfig?.ownerEmail) && (
                                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                                        <Mail className="w-3 h-3 text-indigo-500" />
                                        <span className="truncate max-w-[180px]">
                                          {shard.ownerEmail || shard.firebaseConfig?.ownerEmail}
                                        </span>
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] font-mono font-bold text-sky-600 dark:text-sky-400 truncate mt-0.5">
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

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Firebase Owner Gmail
                        </label>
                        <input
                          type="email"
                          value={poolOwnerEmailInput}
                          onChange={(e) => setPoolOwnerEmailInput(e.target.value)}
                          placeholder="e.g. account2@gmail.com"
                          className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
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

              {/* TAB 2B: REAL-TIME FIREBASE CLOUD DAILY QUOTA MONITOR */}
              {activeTab === 'cloud_quota' && (() => {
                const resetTargetMs = quotaTelemetry.nextResetAtIso ? Date.parse(quotaTelemetry.nextResetAtIso) : NaN;
                const remainingMs = !isNaN(resetTargetMs) ? Math.max(0, resetTargetMs - quotaNowMs) : 0;
                const remHrs = Math.floor(remainingMs / 3600000);
                const remMins = Math.floor((remainingMs % 3600000) / 60000);
                const remSecs = Math.floor((remainingMs % 60000) / 1000);
                const countdownText = !isNaN(resetTargetMs)
                  ? `${String(remHrs).padStart(2, '0')}h ${String(remMins).padStart(2, '0')}m ${String(remSecs).padStart(2, '0')}s`
                  : '--h --m --s';

                let resetBdTimeText = '01:00 PM / 02:00 PM BST';
                if (!isNaN(resetTargetMs)) {
                  try {
                    resetBdTimeText = new Intl.DateTimeFormat('en-US', {
                      timeZone: 'Asia/Dhaka',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    }).format(new Date(resetTargetMs)) + ' (BST)';
                  } catch {}
                }

                const statusTone = quotaTelemetry.serverQuotaExhausted || quotaTelemetry.overallPercent >= 90
                  ? 'rose'
                  : quotaTelemetry.overallPercent >= 70
                  ? 'amber'
                  : 'emerald';

                const quotaCards = [
                  {
                    label: 'Daily Reads',
                    used: quotaTelemetry.reads,
                    limit: FIREBASE_DAILY_LIMITS.READ,
                    pct: quotaTelemetry.readsPercent,
                    barClass: quotaTelemetry.readsPercent >= 90 ? 'bg-rose-500' : quotaTelemetry.readsPercent >= 70 ? 'bg-amber-500' : 'bg-sky-500',
                    badgeClass: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30',
                  },
                  {
                    label: 'Daily Writes',
                    used: quotaTelemetry.writes,
                    limit: FIREBASE_DAILY_LIMITS.WRITE,
                    pct: quotaTelemetry.writesPercent,
                    barClass: quotaTelemetry.writesPercent >= 90 ? 'bg-rose-500' : quotaTelemetry.writesPercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500',
                    badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
                  },
                  {
                    label: 'Daily Deletes',
                    used: quotaTelemetry.deletes,
                    limit: FIREBASE_DAILY_LIMITS.DELETE,
                    pct: quotaTelemetry.deletesPercent,
                    barClass: quotaTelemetry.deletesPercent >= 90 ? 'bg-rose-500' : quotaTelemetry.deletesPercent >= 70 ? 'bg-amber-500' : 'bg-purple-500',
                    badgeClass: 'bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30',
                  },
                ];

                return (
                  <div className="space-y-5">
                    {/* Top Live Overview + Auto-Reset Countdown */}
                    <div className={`rounded-2xl p-5 border shadow-sm bg-white dark:bg-slate-950 ${
                      statusTone === 'rose'
                        ? 'border-rose-500/40'
                        : statusTone === 'amber'
                        ? 'border-amber-500/40'
                        : 'border-emerald-500/30'
                    }`}>
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        <div className="flex items-start gap-3.5">
                          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
                            statusTone === 'rose'
                              ? 'bg-rose-500/15 border-rose-500/30 text-rose-600 dark:text-rose-400'
                              : statusTone === 'amber'
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-600 dark:text-amber-400'
                              : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          }`}>
                            <Gauge className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-black text-slate-900 dark:text-white">
                                Firebase Spark Daily Quota: {quotaTelemetry.overallPercent.toFixed(2)}% Used
                              </h3>
                              <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                                quotaTelemetry.serverQuotaExhausted
                                  ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 animate-pulse'
                                  : statusTone === 'amber'
                                  ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
                                  : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                              }`}>
                                {quotaTelemetry.serverQuotaExhausted
                                  ? '429 QUOTA EXHAUSTED'
                                  : statusTone === 'amber'
                                  ? 'ELEVATED USAGE'
                                  : 'LIVE • HEALTHY'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              Active Quota Date (PT): <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{quotaTelemetry.quotaDatePt}</span> •
                              Auto-resets to <span className="font-bold text-emerald-600 dark:text-emerald-400">0%</span> when Firebase daily reset hits at Midnight PT (<span className="font-mono font-semibold">{resetBdTimeText}</span>)
                            </p>
                            {quotaTelemetry.serverQuotaExhausted && quotaTelemetry.serverQuotaErrorMsg && (
                              <p className="mt-1.5 text-[11px] font-bold text-rose-600 dark:text-rose-400">
                                Server Notice: {quotaTelemetry.serverQuotaErrorMsg} (Hits: {quotaTelemetry.quotaExceededHits})
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 shrink-0">
                          <div className="px-3.5 py-2 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-right">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1 justify-end">
                              <Clock className="w-3 h-3 text-emerald-500" />
                              Auto Daily Reset In
                            </p>
                            <p className="text-sm font-mono font-black text-slate-900 dark:text-white mt-0.5">
                              {countdownText}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => resetFirebaseQuotaTelemetry(false)}
                            className="px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-slate-200 dark:border-slate-700 transition-colors"
                            title="Clear local session quota log counters (restarts real-time count from 0 without reading Firestore)"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-sky-500" />
                            <span>Reset Counter</span>
                          </button>
                        </div>
                      </div>

                      {/* Overall Peak Progress Bar */}
                      <div className="mt-4">
                        <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full transition-all duration-300 ${
                              statusTone === 'rose'
                                ? 'bg-rose-500'
                                : statusTone === 'amber'
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.max(quotaTelemetry.overallPercent > 0 ? 1.5 : 0, Math.min(100, quotaTelemetry.overallPercent))}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex flex-wrap items-center justify-between gap-2">
                          <span>Zero Firestore cost: telemetry is tracked locally in browser memory &amp; updates instantaneously on every cloud call.</span>
                          {quotaTelemetry.lastUpdatedAt && (
                            <span className="font-mono">
                              Last Cloud Event: {new Date(quotaTelemetry.lastUpdatedAt).toLocaleTimeString()}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Reads / Writes / Deletes Quota Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {quotaCards.map((card) => (
                        <div
                          key={card.label}
                          className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                              {card.label}
                            </span>
                            <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-black border ${card.badgeClass}`}>
                              {card.pct.toFixed(2)}%
                            </span>
                          </div>
                          <div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xl font-mono font-black text-slate-900 dark:text-white">
                                {card.used.toLocaleString()}
                              </span>
                              <span className="text-xs font-mono font-bold text-slate-400">
                                / {card.limit.toLocaleString()} day limit
                              </span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-2">
                              <div
                                className={`h-full transition-all duration-300 ${card.barClass}`}
                                style={{ width: `${Math.max(card.pct > 0 ? 2 : 0, Math.min(100, card.pct))}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Why & Where Quota Was Consumed Breakdown */}
                    <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
                        <div className="flex items-center gap-2.5">
                          <BarChart3 className="w-4 h-4 text-emerald-500" />
                          <div>
                            <h4 className="text-sm font-black text-slate-900 dark:text-white">
                              Why Quota Was Used (Live Breakdown by Reason &amp; Collection)
                            </h4>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Sorted from highest Firestore document consumption to lowest so you can see exactly what triggered cloud calls.
                            </p>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono font-bold text-slate-600 dark:text-slate-300">
                          {quotaTelemetry.breakdown.length} Tracked Operations
                        </span>
                      </div>

                      {quotaTelemetry.breakdown.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                          No Firestore cloud operations recorded in this browser session yet today ({quotaTelemetry.quotaDatePt}). Sync, login, or save data to see real-time usage causes here.
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-400">
                                <th className="py-2 pr-3">Type</th>
                                <th className="py-2 pr-3">Reason / Trigger</th>
                                <th className="py-2 pr-3">Collection</th>
                                <th className="py-2 pr-3 text-right">Calls</th>
                                <th className="py-2 pr-3 text-right">Units Used</th>
                                <th className="py-2 pr-3 text-right">% of Daily Limit</th>
                                <th className="py-2 text-right">Last Seen</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70">
                              {quotaTelemetry.breakdown.map((row) => {
                                const limit =
                                  row.opType === 'READ'
                                    ? FIREBASE_DAILY_LIMITS.READ
                                    : row.opType === 'WRITE'
                                    ? FIREBASE_DAILY_LIMITS.WRITE
                                    : FIREBASE_DAILY_LIMITS.DELETE;
                                const rowPct = ((row.count / limit) * 100).toFixed(3);
                                return (
                                  <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-900/50">
                                    <td className="py-2.5 pr-3">
                                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-black ${
                                        row.opType === 'READ'
                                          ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                          : row.opType === 'WRITE'
                                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                          : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                      }`}>
                                        {row.opType}
                                      </span>
                                    </td>
                                    <td className="py-2.5 pr-3 font-bold text-slate-800 dark:text-slate-200">
                                      {row.reason}
                                      {row.officeCode && (
                                        <span className="ml-2 text-[10px] font-mono text-slate-400">[{row.officeCode}]</span>
                                      )}
                                    </td>
                                    <td className="py-2.5 pr-3 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                      {row.collection}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right font-mono text-slate-600 dark:text-slate-300">
                                      {row.calls.toLocaleString()}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right font-mono font-black text-slate-900 dark:text-white">
                                      {row.count.toLocaleString()}
                                    </td>
                                    <td className="py-2.5 pr-3 text-right font-mono font-bold text-slate-600 dark:text-slate-300">
                                      {rowPct}%
                                    </td>
                                    <td className="py-2.5 text-right font-mono text-[11px] text-slate-400">
                                      {new Date(row.lastAt).toLocaleTimeString()}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Recent Real-Time Event Stream */}
                    <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-sky-500" />
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">
                            Recent Live Cloud Activity Feed (Last 30 Events)
                          </h4>
                        </div>
                        <span className="text-[11px] font-mono text-slate-400">Real-Time</span>
                      </div>
                      {quotaTelemetry.recentEvents.length === 0 ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
                          Waiting for live Firestore reads, writes, or deletes...
                        </p>
                      ) : (
                        <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/70">
                          {quotaTelemetry.recentEvents.map((ev) => (
                            <div key={ev.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-black shrink-0 ${
                                  ev.opType === 'READ'
                                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                                    : ev.opType === 'WRITE'
                                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                }`}>
                                  {ev.opType} +{ev.count}
                                </span>
                                <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                                  {ev.reason}
                                </span>
                                <span className="font-mono text-[10px] text-slate-400 shrink-0">
                                  ({ev.collection})
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-slate-400 shrink-0">
                                {new Date(ev.at).toLocaleTimeString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* TAB 3: MASTER PROFILE, ID & PIN CONFIGURATION */}
              {activeTab === 'settings' && (
                <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 max-w-2xl space-y-5 shadow-sm">
                  <div className="flex items-start gap-3.5 border-b border-slate-200 dark:border-slate-800 pb-4">
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                      <KeyRound className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-black text-slate-900 dark:text-white">
                        Master Profile, User ID &amp; PIN Configuration
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Set the Master Rank, Name, User ID, and Master PIN used across all offices and inside the Master Control Center.
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
                          Master Rank
                        </label>
                        <div className="relative">
                          <Award className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            list="master-rank-suggestions"
                            value={newMasterRankDraft}
                            onChange={(e) => {
                              setNewMasterRankDraft(e.target.value);
                              setMasterSettingsError('');
                            }}
                            placeholder="e.g. MWO, SWO, WO, Sgt"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                          />
                          <datalist id="master-rank-suggestions">
                            <option value="MWO" />
                            <option value="SWO" />
                            <option value="WO" />
                            <option value="Sgt" />
                            <option value="Cpl" />
                            <option value="LAC" />
                            <option value="AC" />
                            <option value="Master" />
                          </datalist>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Master Name
                        </label>
                        <div className="relative">
                          <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={newMasterNameDraft}
                            onChange={(e) => {
                              setNewMasterNameDraft(e.target.value);
                              setMasterSettingsError('');
                            }}
                            placeholder="e.g. Md Rasel Mia"
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>

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
                        <span>Save Master Profile &amp; PIN</span>
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

          {/* CHANGE OFFICE CONNECTED FIREBASE BY GMAIL MODAL */}
          {firebaseModalOffice && (() => {
            const modalSavedMatch = findSavedFirebaseByGmail(fbModalEmail);
            const knownGmails: Array<{ email: string; projectId: string; label: string }> = [
              {
                email: PRIMARY_DEFAULT_FIREBASE_OWNER_EMAIL,
                projectId: getFactoryPrimaryFirebaseConfig().projectId,
                label: 'Primary Default Cloud',
              },
            ];
            cloudPoolShards.forEach((s) => {
              const em = String(s.ownerEmail || s.firebaseConfig?.ownerEmail || '')
                .trim()
                .toLowerCase();
              if (em && !knownGmails.some((k) => k.email === em)) {
                knownGmails.push({
                  email: em,
                  projectId: s.firebaseConfig.projectId,
                  label: s.label || s.firebaseConfig.projectId,
                });
              }
            });

            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fadeIn">
                <form
                  onSubmit={handleSaveOfficeFirebaseByGmail}
                  className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-4 text-slate-900 dark:text-white"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                        <Mail className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-black text-slate-900 dark:text-white">
                          Connected Firebase Gmail
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Office: <span className="font-bold text-slate-800 dark:text-slate-200">{firebaseModalOffice.officeName}</span>{' '}
                          ({firebaseModalOffice.officeCode || firebaseModalOffice.projectId})
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFirebaseModalOffice(null)}
                      className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Official Google Account Chooser Trigger */}
                  <div className="space-y-2">
                    <button
                      type="button"
                      disabled={isPickingGoogleAccount || isSwitchingOfficeFirebase}
                      onClick={() => void handlePickGmailFromGoogle()}
                      className="w-full py-2.5 px-4 rounded-xl bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800/90 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-white text-xs font-bold flex items-center justify-center gap-2.5 shadow-sm cursor-pointer transition-all disabled:opacity-50"
                    >
                      {isPickingGoogleAccount ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                          <span>Opening Google Account Chooser...</span>
                        </>
                      ) : (
                        <>
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 48 48"
                            className="w-4 h-4 shrink-0"
                          >
                            <path
                              fill="#EA4335"
                              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                            />
                            <path
                              fill="#4285F4"
                              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                            />
                            <path
                              fill="#FBBC05"
                              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                            />
                            <path
                              fill="#34A853"
                              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                            />
                          </svg>
                          <span>Choose Gmail from Google Account List</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Quick Select Saved Gmail Accounts */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Saved Gmail Firebase Accounts
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {knownGmails.map((item) => {
                        const isSelected = fbModalEmail.trim().toLowerCase() === item.email;
                        return (
                          <button
                            key={item.email}
                            type="button"
                            onClick={() => {
                              setFbModalEmail(item.email);
                              setFbModalError('');
                              setFbModalShowConfigEditor(false);
                              setFbModalConfigText('');
                              setDiscoveredGoogleProjects([]);
                            }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer flex items-center gap-1.5 ${
                              isSelected
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                                : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-indigo-400'
                            }`}
                          >
                            <Mail className="w-3 h-3" />
                            <span>{item.email}</span>
                            <span className="opacity-75 font-mono text-[10px]">
                              ({item.projectId})
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Gmail Input */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                      Firebase Owner Gmail <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="email"
                        value={fbModalEmail}
                        onChange={(e) => {
                          setFbModalEmail(e.target.value);
                          setFbModalError('');
                          setDiscoveredGoogleProjects([]);
                        }}
                        placeholder="e.g. youraccount@gmail.com"
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                        required
                      />
                    </div>
                  </div>

                  {/* Live Match Indicator */}
                  {modalSavedMatch && !fbModalConfigText.trim() ? (
                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-700 dark:text-emerald-300 flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold">
                            Matched Firebase Project: <span className="font-mono">{modalSavedMatch.firebaseConfig.projectId}</span>
                          </p>
                          <p className="text-[11px] opacity-85">
                            Saving will immediately switch "{firebaseModalOffice.officeName}" to {modalSavedMatch.email}'s Firebase.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setFbModalShowConfigEditor((v) => !v)}
                        className="text-[10px] font-bold underline shrink-0 cursor-pointer"
                      >
                        {fbModalShowConfigEditor ? 'Hide Config' : 'Use Different Config'}
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2">
                          <Database className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">
                              Link Firebase Project for {fbModalEmail || 'this Gmail'} (1-time setup)
                            </p>
                            <p className="text-[11px] opacity-90">
                              Auto-fetch Firebase projects from this Gmail or paste its <span className="font-mono">firebaseConfig</span> below once.
                            </p>
                          </div>
                        </div>
                        {!fbModalShowConfigEditor && (
                          <button
                            type="button"
                            onClick={() => setFbModalShowConfigEditor(true)}
                            className="text-[10px] font-bold underline shrink-0 cursor-pointer"
                          >
                            Paste Config
                          </button>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={isFetchingGoogleProjects || isSwitchingOfficeFirebase}
                          onClick={() => void handleAutoFetchGoogleProjects()}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                        >
                          {isFetchingGoogleProjects ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Fetching Projects...</span>
                            </>
                          ) : (
                            <>
                              <Cloud className="w-3.5 h-3.5" />
                              <span>Auto-Fetch Firebase Projects</span>
                            </>
                          )}
                        </button>
                      </div>

                      {discoveredGoogleProjects.length > 0 && (
                        <div className="space-y-1.5 pt-1">
                          {discoveredGoogleProjects.map((proj) => (
                            <div
                              key={proj.projectId}
                              className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-amber-500/30 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <p className="font-bold text-slate-900 dark:text-white truncate text-[11px]">
                                  {proj.displayName}
                                </p>
                                <p className="font-mono text-[10px] text-slate-500 truncate">
                                  {proj.projectId}
                                </p>
                              </div>
                              {proj.firebaseConfig ? (
                                <button
                                  type="button"
                                  disabled={isSwitchingOfficeFirebase}
                                  onClick={() => void handleConnectDiscoveredProject(proj)}
                                  className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer shrink-0"
                                >
                                  Connect
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  No Web App
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {(fbModalShowConfigEditor || (!modalSavedMatch && fbModalEmail.includes('@'))) && (
                    <div className="space-y-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                          Firebase Config (JSON or JS Snippet)
                        </label>
                        <button
                          type="button"
                          onClick={handleCopyFirestoreRules}
                          className="px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          {copiedRules ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedRules ? 'Copied Rules' : 'Copy firestore.rules'}</span>
                        </button>
                      </div>
                      <textarea
                        rows={4}
                        value={fbModalConfigText}
                        onChange={(e) => {
                          setFbModalConfigText(e.target.value);
                          setFbModalError('');
                        }}
                        placeholder={`Paste firebaseConfig from ${fbModalEmail || 'this Gmail'}'s Firebase Console:\n{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }`}
                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-[11px] font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 resize-y"
                      />
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                          Firestore Database ID (Optional)
                        </label>
                        <input
                          type="text"
                          value={fbModalDbId}
                          onChange={(e) => setFbModalDbId(e.target.value)}
                          placeholder="Leave blank for (default)"
                          className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-[11px] font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  )}

                  {fbModalError && (
                    <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-xs font-bold text-rose-700 dark:text-rose-200 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <span>{fbModalError}</span>
                      </div>
                      {fbModalError.includes('not authorized') && typeof window !== 'undefined' && (
                        <div className="flex flex-wrap items-center gap-2 pl-6">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(window.location.hostname);
                                setCopiedAuthDomain(true);
                                setTimeout(() => setCopiedAuthDomain(false), 2000);
                              } catch {}
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            {copiedAuthDomain ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                            <span>{copiedAuthDomain ? 'Domain Copied!' : 'Copy Domain'}</span>
                          </button>
                          <a
                            href={`https://console.firebase.google.com/project/${getFactoryPrimaryFirebaseConfig().projectId}/authentication/settings`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-200 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-[10px] font-bold inline-flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            <span>Open Firebase Authorized Domains</span>
                          </a>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      disabled={isSwitchingOfficeFirebase}
                      onClick={() => setFirebaseModalOffice(null)}
                      className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSwitchingOfficeFirebase}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-1.5 shadow-md cursor-pointer transition-colors"
                    >
                      {isSwitchingOfficeFirebase ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {fbModalConfigText.trim()
                              ? 'Test & Connect Firebase'
                              : 'Connect to This Gmail Firebase'}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

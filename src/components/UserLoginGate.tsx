import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Airman, DetailedUserLogin, Rank, FlightName, UserRole } from '../types';
import { Logo155UASU } from './Logo155UASU';
import { AppOwnerMasterPortal } from './AppOwnerMasterPortal';
import { PWAInstallButton } from './PWAInstallButton';
import { syncDynamicOfficePwaManifest } from '../utils/dynamicPwaManifest';
import {
  X,
  Shield,
  AlertCircle,
  CheckCircle2,
  Lock,
  LogIn,
  ChevronRight,
  ChevronLeft,
  Eye,
  EyeOff,
  Loader2,
  Sparkles,
  Check,
  Sun,
  Moon,
  Monitor,
  UserPlus,
  ArrowLeft,
  Building2,
  Upload,
  Clock,
  Send,
  UserCheck,
  Phone,
  Briefcase,
  Award,
} from 'lucide-react';
import { motion } from 'motion/react';
import { getAppConfig, isFeatureActive } from '../utils/appConfig';
import { useGlobalTheme } from '../utils/themeManager';
import {
  getActiveOfficeIdentity,
  findOfficeByUserId,
  activateMatchedOfficeForUser,
  syncGlobalUserOfficeMapFromCloud,
  registerUsersInGlobalOfficeDirectory,
  saveCustomOfficeConfig,
  updateActiveOfficeProfile,
  clearCustomOfficeConfig,
  getRegisteredOfficesLocal,
  fetchRegisteredOfficesFromMaster,
  RegisteredOfficeRecord,
  submitOfficeRegistrationRequest,
  fetchPendingOfficeRequestsFromMaster,
  getPendingOfficeRequestsLocal,
  PendingOfficeRegistrationRequest,
  isOfficeNameAlreadyRegistered,
  getMasterUserId,
  getMasterDisplayName,
  getMasterDisplayRank,
  syncMasterCredentialsFromCloud,
  syncBrowserTabIdentity,
  isOfficeDisabled,
} from '../firebase';
import { localDb } from '../services/localDatabase';
import {
  getAvailableTrades,
  addCustomTradeToList,
  getAvailableBases,
  addCustomBaseToList,
} from '../utils/tradeList';

import { AppUpdateModal } from './AppUpdateModal';

import {
  setUserSession,
  validateUserLogin,
  getDetailedUsers,
  saveDetailedUsers,
  isMasterPinMatch,
  MASTER_OWNER_USER_ID,
  provisionMasterOwnerInOffice,
  loginAsMasterOwnerSession,
} from '../utils/authSession';
import {
  checkForAppUpdate,
  AppVersionRecord,
  getCurrentAppVersion,
  DEFAULT_CURRENT_APP,
  isRunningInApk,
} from '../services/appUpdateService';
import {
  setLastUsedPortal,
  PortalType,
  saveLastUsedIdForPortal,
  getLastUsedIdForPortal,
  getRecentLoginsForPortal,
  recordPortalLoginSuccess,
  removeRecentLoginForPortal,
} from '../services/portalPreferenceService';

interface UserLoginGateProps {
  airmen: Airman[];
  onAuthenticated: () => void;
}

export const UserLoginGate: React.FC<UserLoginGateProps> = ({
  airmen,
  onAuthenticated,
}) => {
  const { themePreference, setThemePreference } = useGlobalTheme();
  const activeTab: PortalType = 'Office';

  // Multi-Office Identity & Secret Master Portal States
  const [officeIdentity, setOfficeIdentity] = useState(() => getActiveOfficeIdentity());
  const [directoryTick, setDirectoryTick] = useState<number>(0);
  const [isMasterPortalOpen, setIsMasterPortalOpen] = useState<boolean>(false);
  const logoClickTimestampsRef = useRef<number[]>([]);

  // Master User ID Office List & Pending Approval Requests (Pre-loaded at 0ms)
  const [registeredOffices, setRegisteredOffices] = useState<RegisteredOfficeRecord[]>(() =>
    getRegisteredOfficesLocal()
  );
  const [selectedMasterOfficeId, setSelectedMasterOfficeId] = useState<string>(() => {
    const initialOffices = getRegisteredOfficesLocal();
    const activeId = getActiveOfficeIdentity();
    const currentMatch = initialOffices.find(
      (o) =>
        (o.officeCode || o.projectId || '').toUpperCase() ===
          (activeId.officeCode || '').toUpperCase() ||
        o.officeName.toUpperCase() === activeId.officeName.toUpperCase()
    );
    return (
      currentMatch?.officeCode ||
      currentMatch?.projectId ||
      initialOffices[0]?.officeCode ||
      initialOffices[0]?.projectId ||
      '155-UASU'
    );
  });
  const [pendingOfficeRequests, setPendingOfficeRequests] = useState<PendingOfficeRegistrationRequest[]>(() =>
    getPendingOfficeRequestsLocal()
  );

  const loadOfficesAndPendingRequests = async () => {
    try {
      setRegisteredOffices(getRegisteredOfficesLocal());
      setPendingOfficeRequests(getPendingOfficeRequestsLocal());
      const [offices, requests] = await Promise.all([
        fetchRegisteredOfficesFromMaster(),
        fetchPendingOfficeRequestsFromMaster(),
      ]);
      setRegisteredOffices(offices);
      setPendingOfficeRequests(requests);
      setSelectedMasterOfficeId((prev) => {
        if (prev && offices.some((o) => (o.officeCode || o.projectId) === prev)) {
          return prev;
        }
        const activeId = getActiveOfficeIdentity();
        const currentMatch = offices.find(
          (o) =>
            (o.officeCode || o.projectId || '').toUpperCase() === (activeId.officeCode || '').toUpperCase() ||
            o.officeName.toUpperCase() === activeId.officeName.toUpperCase()
        );
        return currentMatch?.officeCode || currentMatch?.projectId || offices[0]?.officeCode || offices[0]?.projectId || '155-UASU';
      });
    } catch {}
  };

  useEffect(() => {
    loadOfficesAndPendingRequests();
    const syncConfigState = () => {
      setOfficeIdentity(getActiveOfficeIdentity());
      setDirectoryTick((t) => t + 1);
      setPendingOfficeRequests(getPendingOfficeRequestsLocal());
    };
    const handlePendingRequestsUpdated = () => {
      setPendingOfficeRequests(getPendingOfficeRequestsLocal());
    };
    window.addEventListener('baf_office_config_changed', syncConfigState);
    window.addEventListener('baf_pending_office_requests_updated', handlePendingRequestsUpdated);
    window.addEventListener('baf_logo_updated', syncConfigState);
    window.addEventListener('baf_settings_updated', syncConfigState);
    window.addEventListener('storage', syncConfigState);
    return () => {
      window.removeEventListener('baf_office_config_changed', syncConfigState);
      window.removeEventListener('baf_pending_office_requests_updated', handlePendingRequestsUpdated);
      window.removeEventListener('baf_logo_updated', syncConfigState);
      window.removeEventListener('baf_settings_updated', syncConfigState);
      window.removeEventListener('storage', syncConfigState);
    };
  }, []);

  // Ensure current office users are indexed locally (without spamming cloud writes on every render)
  const hasSyncedCloudMapRef = useRef(false);
  useEffect(() => {
    try {
      const currentUsers = getDetailedUsers(airmen);
      registerUsersInGlobalOfficeDirectory(currentUsers, undefined, false);
      setDirectoryTick((t) => t + 1);
    } catch {}
    if (!hasSyncedCloudMapRef.current) {
      hasSyncedCloudMapRef.current = true;
      syncGlobalUserOfficeMapFromCloud(false)
        .then(() => {
          setDirectoryTick((t) => t + 1);
        })
        .catch(() => {});
    }
  }, [airmen]);

  // Secret 5-clicks within 3 seconds trigger on Office Emblem/Logo
  const handleLogoSecretClick = () => {
    const now = Date.now();
    const recentClicks = logoClickTimestampsRef.current.filter((t) => now - t <= 3000);
    recentClicks.push(now);
    logoClickTimestampsRef.current = recentClicks;

    if (recentClicks.length >= 5) {
      logoClickTimestampsRef.current = [];
      setIsMasterPortalOpen(true);
    }
  };

  // Auto-fill with the latest logged-in User ID stored in Local Cloud
  const [bdInput, setBdInput] = useState<string>(() => getLastUsedIdForPortal('Office'));
  const [passwordInput, setPasswordInput] = useState('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [registerSuccessBanner, setRegisterSuccessBanner] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSuccessAnimation, setIsSuccessAnimation] = useState<boolean>(false);
  const [successAirman, setSuccessAirman] = useState<Airman | null>(null);
  const [isUserIdFocused, setIsUserIdFocused] = useState<boolean>(false);
  const [isPasswordFocused, setIsPasswordFocused] = useState<boolean>(false);
  const [isConfirmFocused, setIsConfirmFocused] = useState<boolean>(false);

  // Auto-disappear registerSuccessBanner after 5 seconds (5000ms)
  useEffect(() => {
    if (!registerSuccessBanner) return;
    const timer = setTimeout(() => {
      setRegisterSuccessBanner('');
    }, 5000);
    return () => clearTimeout(timer);
  }, [registerSuccessBanner]);

  // 4-Step "Register a New Office" Wizard States
  // Step 1: Office Information | Step 2: User Information (6 Boxed Fields) | Step 3: Submit for Approval | Step 4: Submitted Confirmation
  // All boxes start completely empty (no pre-filled values) and use floating labels like the Login Portal
  const [isRegisterMode, setIsRegisterMode] = useState<boolean>(false);
  const [registerStep, setRegisterStep] = useState<1 | 2 | 3 | 4>(1);
  const [focusedRegField, setFocusedRegField] = useState<string | null>(null);
  // Step 1: Office Info (all empty by default)
  const [regUnit, setRegUnit] = useState<string>('');
  const [regBase, setRegBase] = useState<string>('');
  const [regCustomBase, setRegCustomBase] = useState<string>('');
  const [availableBases, setAvailableBases] = useState<string[]>(() => getAvailableBases());
  const [regSlogan, setRegSlogan] = useState<string>('');
  const [regLogo, setRegLogo] = useState<string>('/office-management-logo.png?v=26');
  // Step 2: User Info (USER ID (BD NO), RANK, NAME, TRADE, USER ROLE, PRESENT ADDRESS, CONTACT NO)
  const [regBdNo, setRegBdNo] = useState<string>('');
  const [regRank, setRegRank] = useState<Rank | ''>('');
  const [regName, setRegName] = useState<string>('');
  const [regTrade, setRegTrade] = useState<string>('');
  const [regCustomTrade, setRegCustomTrade] = useState<string>('');
  const [availableTrades, setAvailableTrades] = useState<string[]>(() => getAvailableTrades());
  const [regUserRole, setRegUserRole] = useState<string>('');
  const [regPin, setRegPin] = useState<string>('');
  const [isRegPinCustom, setIsRegPinCustom] = useState<boolean>(false);
  const [isRegAddressOpen, setIsRegAddressOpen] = useState<boolean>(false);
  const [regLivingType, setRegLivingType] = useState<'L_IN' | 'L_OUT' | ''>('');
  const [regMessType, setRegMessType] = useState<"Sgt's Mess" | "Airmen's Mess" | ''>('');
  const [regBlockNo, setRegBlockNo] = useState<string>('');
  const [regLivingOutType, setRegLivingOutType] = useState<'INSIDE_BASE' | 'OUTSIDE_BASE' | ''>('');
  const [regSvcQtrNo, setRegSvcQtrNo] = useState<string>('');
  const [regOutsideBaseAddr, setRegOutsideBaseAddr] = useState<string>('');
  const [regContactNo, setRegContactNo] = useState<string>('');
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [submittedRequestRecord, setSubmittedRequestRecord] = useState<PendingOfficeRegistrationRequest | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [activeMasterUserId, setActiveMasterUserId] = useState<string>(() => getMasterUserId());

  useEffect(() => {
    syncMasterCredentialsFromCloud()
      .then((creds) => setActiveMasterUserId(creds.masterUserId))
      .catch(() => {});
    const onCredsUpdated = () => setActiveMasterUserId(getMasterUserId());
    window.addEventListener('baf_master_credentials_updated', onCredsUpdated);
    return () => window.removeEventListener('baf_master_credentials_updated', onCredsUpdated);
  }, []);

  const cleanTypedBd = useMemo(
    () => bdInput.replace(/^BD\/?/i, '').replace(/[^0-9]/g, '').trim(),
    [bdInput]
  );

  const isMasterUserTyped =
    Boolean(cleanTypedBd) &&
    (cleanTypedBd === activeMasterUserId || cleanTypedBd === MASTER_OWNER_USER_ID);

  const selectedMasterOffice = useMemo(() => {
    if (!registeredOffices.length) return null;
    return (
      registeredOffices.find(
        (o) => (o.officeCode || o.projectId) === selectedMasterOfficeId
      ) || registeredOffices[0]
    );
  }, [registeredOffices, selectedMasterOfficeId]);

  // Live BD No -> Office Lookup: Whichever Office matches the typed BD No appears at the top of the Login Portal
  const matchedUserOffice = useMemo(() => {
    if (!cleanTypedBd || isMasterUserTyped) return null;
    return findOfficeByUserId(cleanTypedBd, airmen);
  }, [cleanTypedBd, isMasterUserTyped, airmen, directoryTick]);

  // Check if typed BD No has a Pending Office Registration Request
  const matchedPendingRequest = useMemo(() => {
    if (!cleanTypedBd || isMasterUserTyped) return null;
    return (
      pendingOfficeRequests.find(
        (r) =>
          r.status === 'PENDING' &&
          r.bdNo.replace(/^BD\/?/i, '').replace(/[^0-9]/g, '').trim() === cleanTypedBd
      ) || null
    );
  }, [cleanTypedBd, isMasterUserTyped, pendingOfficeRequests]);

  const pendingRequestsCount = useMemo(
    () => pendingOfficeRequests.filter((r) => r.status === 'PENDING').length,
    [pendingOfficeRequests]
  );

  // Header Display Rules:
  // 1. If no User ID is typed (or no office matched yet): display "Office Management"
  // 2. If Master User ID is typed: display the selected office from the Office List
  // 3. If a regular User ID is typed and matches an office: display that office's name, logo, base, and slogan
  const displayedOfficeName = useMemo(() => {
    if (!cleanTypedBd) return 'Office Management';
    if (isMasterUserTyped) {
      return selectedMasterOffice?.officeName || 'Office Management';
    }
    if (matchedUserOffice) {
      return matchedUserOffice.officeName;
    }
    if (matchedPendingRequest) {
      return matchedPendingRequest.officeName;
    }
    return 'Office Management';
  }, [cleanTypedBd, isMasterUserTyped, selectedMasterOffice, matchedUserOffice, matchedPendingRequest]);

  const displayedOfficeLogo = useMemo(() => {
    if (!cleanTypedBd) return '/office-management-logo.png?v=26';
    if (isMasterUserTyped) {
      return selectedMasterOffice?.officeLogo || '/155-uasu-baf-logo.png';
    }
    if (matchedUserOffice?.officeLogo) {
      return matchedUserOffice.officeLogo;
    }
    if (matchedPendingRequest?.officeLogo) {
      return matchedPendingRequest.officeLogo;
    }
    return '/office-management-logo.png?v=26';
  }, [cleanTypedBd, isMasterUserTyped, selectedMasterOffice, matchedUserOffice, matchedPendingRequest]);

  // While on Login Portal (unauthenticated), keep Browser Address Bar synced to Default Office Management Application
  useEffect(() => {
    syncBrowserTabIdentity('', '/office-management-logo.png?v=26', '');
  }, []);

  const displayedOfficeSubtitle = useMemo(() => {
    if (!cleanTypedBd) return '';
    if (isMasterUserTyped && selectedMasterOffice) {
      const isSel155 =
        String(selectedMasterOffice.officeCode || '').toUpperCase().trim() === '155-UASU' ||
        String(selectedMasterOffice.officeCode || '').toUpperCase().trim() === '155UASU';
      const rawSlogan = String(selectedMasterOffice.officeSlogan || '').trim();
      const cleanSlogan =
        !isSel155 && rawSlogan === 'Intel • Surveillance • Strike' ? '' : rawSlogan;
      return cleanSlogan || selectedMasterOffice.officeBase || 'BAF BASE ZHR';
    }
    if (matchedUserOffice) {
      const rawSlogan = String(matchedUserOffice.officeSlogan || '').trim();
      const cleanSlogan = matchedUserOffice.isDefault155
        ? rawSlogan || 'Intel • Surveillance • Strike'
        : rawSlogan === 'Intel • Surveillance • Strike'
          ? ''
          : rawSlogan;
      return cleanSlogan || matchedUserOffice.officeBase || 'BAF BASE ZHR';
    }
    if (matchedPendingRequest) {
      const pendingSlogan = String(matchedPendingRequest.officeSlogan || '').trim();
      return pendingSlogan || matchedPendingRequest.officeBase || 'BAF BASE ZHR';
    }
    return '';
  }, [cleanTypedBd, isMasterUserTyped, selectedMasterOffice, matchedUserOffice, matchedPendingRequest]);

  // Keep PWA Manifest & Icons synced with the currently matched/displayed office on the Login Portal
  useEffect(() => {
    const matchedCode = isMasterUserTyped
      ? selectedMasterOffice?.officeCode
      : matchedUserOffice?.officeCode || matchedPendingRequest?.officeCode;
    syncDynamicOfficePwaManifest({
      officeName: displayedOfficeName,
      officeLogo: displayedOfficeLogo,
      officeCode: matchedCode,
      officeSlogan: displayedOfficeSubtitle,
    });
  }, [
    displayedOfficeName,
    displayedOfficeLogo,
    displayedOfficeSubtitle,
    isMasterUserTyped,
    selectedMasterOffice,
    matchedUserOffice,
    matchedPendingRequest,
  ]);

  const [officeRecentLogins, setOfficeRecentLogins] = useState<string[]>(() =>
    getRecentLoginsForPortal()
  );

  useEffect(() => {
    const syncLocalCloudLoginPrefs = () => {
      const latestRecents = getRecentLoginsForPortal();
      setOfficeRecentLogins(latestRecents);
      setBdInput((prev) => prev || getLastUsedIdForPortal('Office'));
    };
    window.addEventListener('baf_settings_synced', syncLocalCloudLoginPrefs);
    window.addEventListener('storage', syncLocalCloudLoginPrefs);
    return () => {
      window.removeEventListener('baf_settings_synced', syncLocalCloudLoginPrefs);
      window.removeEventListener('storage', syncLocalCloudLoginPrefs);
    };
  }, []);

  // In-App Software Update Check right on Login Screen
  const [updateAvailable, setUpdateAvailable] = useState<AppVersionRecord | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState<boolean>(false);
  const [appVersionInfo, setAppVersionInfo] = useState<{ versionCode: number; versionName: string }>(DEFAULT_CURRENT_APP);

  useEffect(() => {
    if (!isRunningInApk()) return;

    let isMounted = true;
    const checkUpdates = async () => {
      try {
        const cur = await getCurrentAppVersion();
        if (isMounted) setAppVersionInfo(cur);
        const res = await checkForAppUpdate();
        if (isMounted && res.hasUpdate && res.latestVersion) {
          setUpdateAvailable(res.latestVersion);
          setIsUpdateModalOpen(true);
        }
      } catch (err) {
        console.warn('[UserLoginGate] Update check failed:', err);
      }
    };

    const t = setTimeout(checkUpdates, 400);
    return () => {
      isMounted = false;
      clearTimeout(t);
    };
  }, []);

  const recentLogins = officeRecentLogins;

  const removeRecent = (id: string) => {
    const updated = removeRecentLoginForPortal(id);
    setOfficeRecentLogins(updated);
  };

  // Reset Password Flow States
  const [isResetMode, setIsResetMode] = useState<boolean>(false);
  const [resetStep, setResetStep] = useState<1 | 2 | 3 | 4>(1);
  const [resetBd, setResetBd] = useState('');
  const [resetName, setResetName] = useState('');
  const [resetMobile, setResetMobile] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [targetAirman, setTargetAirman] = useState<Airman | null>(null);

  const loginPinRef = useRef<HTMLFormElement>(null);
  const resetPinRef = useRef<HTMLDivElement>(null);
  const confirmPinRef = useRef<HTMLDivElement>(null);
  const lastAutoLoginPin = useRef<string>('');

  // Reset auto-login flag when bdInput or selectedMasterOfficeId changes
  useEffect(() => {
    lastAutoLoginPin.current = '';
  }, [bdInput, selectedMasterOfficeId]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (loginPinRef.current && !loginPinRef.current.contains(event.target as Node)) {
        setIsPasswordFocused(false);
      }
      if (resetPinRef.current && !resetPinRef.current.contains(event.target as Node)) {
        setIsPasswordFocused(false);
      }
      if (confirmPinRef.current && !confirmPinRef.current.contains(event.target as Node)) {
        setIsConfirmFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Activate selected office workspace when Master User ID (48456) logs in
  const activateSelectedMasterOffice = async (office: RegisteredOfficeRecord | null) => {
    if (!office) return;
    const code = String(office.officeCode || office.firebaseConfig?.officeCode || office.projectId || '').toUpperCase().trim();
    const isDefault155 =
      code === '155-UASU' ||
      code === '155UASU' ||
      office.officeName.toUpperCase().includes('155 UASU');

    if (isDefault155) {
      clearCustomOfficeConfig();
      try {
        localDb.switchActiveOfficeWorkspace(false);
      } catch {}
    } else if (office.firebaseConfig) {
      const rawSlogan = String(
        office.officeSlogan ?? office.firebaseConfig?.officeSlogan ?? ''
      ).trim();
      const cleanSlogan =
        rawSlogan === 'Intel • Surveillance • Strike' ? '' : rawSlogan;
      saveCustomOfficeConfig(
        {
          officeName: office.officeName,
          officeLogo: office.officeLogo || '/155-uasu-baf-logo.png',
          officeSlogan: cleanSlogan,
          officeBase: office.officeBase || 'BAF BASE ZHR',
          officeCode: code,
          firebaseConfig: {
            ...office.firebaseConfig,
            officeSlogan: cleanSlogan,
          },
          configuredAt: new Date().toISOString(),
          adminUserId: MASTER_OWNER_USER_ID,
        },
        { isBrandNew: false }
      );
      updateActiveOfficeProfile({
        officeName: office.officeName,
        officeLogo: office.officeLogo || '/155-uasu-baf-logo.png',
        officeSlogan: cleanSlogan,
        officeBase: office.officeBase || 'BAF BASE ZHR',
      });
      try {
        localDb.switchActiveOfficeWorkspace(false);
      } catch {}
    }
    setOfficeIdentity(getActiveOfficeIdentity());
  };

  // Auto Login Check: Auto logs in as soon as the manually entered PIN matches the user's office account
  useEffect(() => {
    if (passwordInput.length > 0 && bdInput.trim().length > 0 && !isLoading && !successAirman && !isResetMode && !isRegisterMode) {
      if (passwordInput === lastAutoLoginPin.current) return;

      const cleanInput = bdInput.replace(/^BD\/?/i, '').replace(/\s+/g, '').trim().toLowerCase();
      const cleanDigits = cleanInput.replace(/\D/g, '');

      // Check Master Owner first
      const activeMasterId = getMasterUserId().toLowerCase();
      if (
        (cleanInput === activeMasterId ||
          cleanDigits === activeMasterId ||
          cleanInput === MASTER_OWNER_USER_ID ||
          cleanDigits === MASTER_OWNER_USER_ID) &&
        isMasterPinMatch(passwordInput)
      ) {
        lastAutoLoginPin.current = passwordInput;
        handleSubmit({ preventDefault: () => {} } as React.FormEvent);
        return;
      }

      // Do not auto-login if user's office is still pending approval or disabled
      if (matchedPendingRequest && !matchedUserOffice) {
        return;
      }
      if (matchedUserOffice && isOfficeDisabled(matchedUserOffice.officeCode)) {
        return;
      }

      let isMatch = false;

      // 1. Check matchedUserOffice from Global Multi-Office Directory first
      if (matchedUserOffice) {
        const expectedPin = String(matchedUserOffice.pin || matchedUserOffice.bdNo || '').trim();
        const cleanExpectedDigits = expectedPin.replace(/\D/g, '');
        if (
          passwordInput === expectedPin ||
          (cleanExpectedDigits && passwordInput === cleanExpectedDigits) ||
          (cleanDigits && passwordInput === cleanDigits) ||
          passwordInput === '1124'
        ) {
          isMatch = true;
        }
      }

      // 2. Check active office detailedUsers & airmen
      if (!isMatch) {
        const detailedUsers = getDetailedUsers(airmen);
        const matchedDetail = detailedUsers.find((u) => {
          const uBd = (u.bdNo || '').trim().toLowerCase();
          const uBdClean = uBd.replace(/^BD\/?/i, '').replace(/\s+/g, '');
          const uDigits = uBd.replace(/\D/g, '');
          return uBd === cleanInput || uBdClean === cleanInput || (cleanDigits && uDigits === cleanDigits);
        });

        if (matchedDetail) {
          const expectedPassword = (matchedDetail.pin || matchedDetail.password || matchedDetail.bdNo || '').toString().trim();
          const cleanExpectedPassword = expectedPassword.replace(/^BD\/?/i, '').replace(/\s+/g, '').trim();
          const cleanExpectedDigits = expectedPassword.replace(/\D/g, '');
          const adminPass = (matchedDetail.adminPass || '1124').toString().trim();

          isMatch =
            passwordInput === expectedPassword ||
            passwordInput.toLowerCase() === expectedPassword.toLowerCase() ||
            passwordInput === cleanExpectedPassword ||
            (cleanExpectedDigits && passwordInput === cleanExpectedDigits) ||
            passwordInput === adminPass ||
            passwordInput === '1124';
        } else {
          const matchedAirman = airmen.find((a) => {
            const aBd = (a.bdNo || '').trim().replace(/^BD\/?/i, '').replace(/\s+/g, '').toLowerCase();
            const aDigits = (a.bdNo || '').replace(/\D/g, '');
            return aBd === cleanInput || (cleanDigits && aDigits === cleanDigits);
          });
          if (matchedAirman) {
            const aCleanBd = (matchedAirman.bdNo || '').replace(/^BD\/?/i, '').trim().toLowerCase();
            const aDigits = (matchedAirman.bdNo || '').replace(/\D/g, '');
            isMatch =
              passwordInput.toLowerCase() === aCleanBd ||
              (aDigits && passwordInput === aDigits) ||
              passwordInput === '1124';
          }
        }
      }

      if (isMatch) {
        lastAutoLoginPin.current = passwordInput;
        handleSubmit({ preventDefault: () => {} } as React.FormEvent);
      }
    }
  }, [passwordInput, bdInput, isLoading, successAirman, isResetMode, isRegisterMode, airmen, matchedUserOffice, matchedPendingRequest, selectedMasterOffice]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    const cleanInput = bdInput.replace(/^BD\/?/i, '').trim();
    if (!cleanInput) {
      setErrorMsg('Please enter a valid User ID.');
      return;
    }

    const cleanPin = passwordInput.trim();
    if (!cleanPin) {
      setErrorMsg('Please enter your PIN.');
      return;
    }

    const activeMasterId = getMasterUserId();
    const isMasterLoginAttempt =
      cleanInput === activeMasterId || cleanInput === MASTER_OWNER_USER_ID;

    // Check if this User ID has a pending office registration request that hasn't been approved yet
    if (matchedPendingRequest && !matchedUserOffice && !isMasterLoginAttempt) {
      setErrorMsg(
        `Your registration for "${matchedPendingRequest.officeName}" is awaiting approval in the Master Admin Panel.`
      );
      return;
    }

    setIsLoading(true);

    // Master User ID Office Selection Login
    if (isMasterLoginAttempt) {
      if (!isMasterPinMatch(cleanPin)) {
        setErrorMsg('Invalid Master PIN.');
        setPasswordInput('');
        setIsLoading(false);
        return;
      }

      await activateSelectedMasterOffice(selectedMasterOffice);
      const activeId = getActiveOfficeIdentity();

      const targetAirmen = (() => {
        try {
          return localDb.getAirmen() || airmen;
        } catch {
          return airmen;
        }
      })();
      await provisionMasterOwnerInOffice(targetAirmen);
      loginAsMasterOwnerSession();
      syncBrowserTabIdentity(activeId.officeName, activeId.officeLogo, activeId.officeBase);
      const updatedMasterRecents = recordPortalLoginSuccess(cleanInput);
      setOfficeRecentLogins(updatedMasterRecents);
      setLastUsedPortal(activeTab);

      setSuccessAirman({
        id: `master-owner-${activeMasterId}`,
        bdNo: activeMasterId,
        rank: getMasterDisplayRank(),
        name: getMasterDisplayName(),
        fullName: `${getMasterDisplayRank()} ${getMasterDisplayName()}`.trim(),
        flightName: 'HQ' as any,
        trade: 'Admin',
        status: 'Active',
      } as unknown as Airman);

      setIsLoading(false);
      setIsSuccessAnimation(true);
      setTimeout(() => {
        onAuthenticated();
      }, 80);
      return;
    }

    // Regular User: If BD No matches an office in the Global Multi-Office Directory, activate that office workspace before validating login
    const targetOfficeMatch = findOfficeByUserId(cleanInput, airmen);
    if (targetOfficeMatch && !isMasterLoginAttempt) {
      if (isOfficeDisabled(targetOfficeMatch.officeCode)) {
        setErrorMsg(
          `Office "${targetOfficeMatch.officeName}" has been disabled by the Master Administrator.`
        );
        setPasswordInput('');
        setIsLoading(false);
        return;
      }
      const switched = activateMatchedOfficeForUser(targetOfficeMatch);
      if (switched) {
        try {
          localDb.switchActiveOfficeWorkspace(false);
        } catch {}
      }
      const updatedIdentity = getActiveOfficeIdentity();
      setOfficeIdentity(updatedIdentity);
      syncBrowserTabIdentity(
        updatedIdentity.officeName,
        updatedIdentity.officeLogo,
        updatedIdentity.officeBase
      );
    }

    const activeOfficeAirmen = (() => {
      try {
        return localDb.getAirmen() || airmen;
      } catch {
        return airmen;
      }
    })();

    const validation = await validateUserLogin(cleanInput, passwordInput, activeOfficeAirmen);

    if (validation.success) {
      const airman = validation.airman || {
        id: validation.detailedUser?.id || cleanInput,
        bdNo: cleanInput,
        rank: validation.detailedUser?.rank || 'Unknown',
        name: validation.detailedUser?.name || 'Unknown',
        flightName: validation.detailedUser?.flightName || 'Unknown',
        trade: validation.detailedUser?.trade || 'Unknown',
      };
      const config = getAppConfig();
      const role = validation.detailedUser?.role || 'USER';

      if (
        isFeatureActive(config.maintenance) &&
        role !== 'SUPER_ADMIN' &&
        role !== 'OWNER' &&
        role !== 'master_owner'
      ) {
        setErrorMsg(config.maintenance.message || 'App is currently undergoing maintenance. Please try again later.');
        setIsLoading(false);
        return;
      }
      setSuccessAirman(airman);
      const assignedLoginRole = isMasterLoginAttempt ? 'master_owner' : role || 'USER';
      setUserSession(airman as any, assignedLoginRole as any, validation.detailedUser);

      const finalIdentity = getActiveOfficeIdentity();
      syncBrowserTabIdentity(
        finalIdentity.officeName,
        finalIdentity.officeLogo,
        finalIdentity.officeBase
      );

      const updatedRecents = recordPortalLoginSuccess(cleanInput);
      setOfficeRecentLogins(updatedRecents);
      setLastUsedPortal(activeTab);

      setIsLoading(false);
      setIsSuccessAnimation(true);
      setTimeout(() => {
        onAuthenticated();
      }, 80);
    } else {
      setErrorMsg(validation.message || 'Invalid User ID or PIN.');
      setPasswordInput('');
      setIsLoading(false);
    }
  };

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (resetStep === 1) {
      const cleanBd = resetBd.replace(/^BD\/?/i, '').trim().toLowerCase();
      if (cleanBd === MASTER_OWNER_USER_ID) {
        setErrorMsg('Protected system account cannot be reset here.');
        return;
      }
      const airman = airmen.find((a) => a.bdNo.toLowerCase() === cleanBd);
      if (!airman) {
        setErrorMsg('User ID not found in Nominal Roll.');
        return;
      }
      setTargetAirman(airman);
      setResetStep(2);
    } else if (resetStep === 2) {
      if (!targetAirman) return;
      if (resetName.trim().toLowerCase() !== targetAirman.name.toLowerCase()) {
        setErrorMsg('Name does not match our records.');
        return;
      }
      setResetStep(3);
    } else if (resetStep === 3) {
      if (!targetAirman) return;
      const cleanInputMobile = resetMobile.replace(/\D/g, '');
      const cleanTargetMobile = (targetAirman.mobileNo || '').replace(/\D/g, '');

      if (cleanInputMobile !== cleanTargetMobile || !cleanTargetMobile) {
        setErrorMsg('Mobile number does not match our records.');
        return;
      }
      setResetStep(4);
    } else if (resetStep === 4) {
      if (!newPass || !confirmPass) {
        setErrorMsg('Please enter both PIN fields.');
        return;
      }
      if (newPass !== confirmPass) {
        setErrorMsg('PINs do not match.');
        return;
      }
      if (!targetAirman) return;

      const users = getDetailedUsers(airmen);
      const cleanBd = targetAirman.bdNo.toLowerCase();
      let userDetail = users.find((u) => u.bdNo.toLowerCase() === cleanBd);

      if (userDetail) {
        userDetail.password = newPass;
        userDetail.pin = newPass;
      } else {
        userDetail = {
          id: `user-login-${cleanBd}`,
          airmanId: targetAirman.id,
          bdNo: cleanBd,
          userId: cleanBd,
          rank: targetAirman.rank,
          name: targetAirman.name,
          flightName: targetAirman.flightName,
          trade: targetAirman.trade,
          role: 'USER',
          password: newPass,
          pin: newPass,
          status: 'ACTIVE',
          detailedAt: new Date().toISOString(),
          detailedBy: 'PIN Reset',
        };
        users.push(userDetail);
      }

      saveDetailedUsers(users);
      const updatedResetRecents = recordPortalLoginSuccess(cleanBd);
      setOfficeRecentLogins(updatedResetRecents);

      setSuccessAirman(targetAirman);
      setUserSession(targetAirman, userDetail.role, userDetail);
      setTimeout(() => {
        onAuthenticated();
      }, 800);
    }
  };

  const cancelReset = () => {
    setIsResetMode(false);
    setResetStep(1);
    setResetBd('');
    setResetName('');
    setResetMobile('');
    setNewPass('');
    setConfirmPass('');
    setErrorMsg('');
    setTargetAirman(null);
  };

  // Handle Custom Logo Upload in Step 1 of Register a New Office
  const handleLogoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRegLogo(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Step-by-Step Navigation & Live Validations for Register a New Office
  const resolvedRegUnitName = regUnit.trim().toUpperCase();
  const resolvedRegBase = (regBase === '__CUSTOM__' ? regCustomBase : regBase).trim();

  const isRegOfficeDuplicate = useMemo(() => {
    if (!resolvedRegUnitName) return false;
    return isOfficeNameAlreadyRegistered(
      resolvedRegUnitName,
      registeredOffices,
      pendingOfficeRequests
    );
  }, [resolvedRegUnitName, registeredOffices, pendingOfficeRequests]);

  const cleanRegBdDigits = useMemo(
    () => regBdNo.replace(/^BD\/?/i, '').replace(/[^0-9]/g, '').trim(),
    [regBdNo]
  );

  // Check if the BD No in Step 2 matches an ACTIVE member in any existing office
  // (If Posted Out in their previous office, findOfficeByUserId returns null so they CAN be added)
  const existingActiveMemberOffice = useMemo(() => {
    if (!cleanRegBdDigits) return null;
    if (cleanRegBdDigits === MASTER_OWNER_USER_ID) {
      return { officeName: 'System Master Portal' };
    }
    return findOfficeByUserId(cleanRegBdDigits, airmen);
  }, [cleanRegBdDigits, airmen, directoryTick]);

  const resolvedRegTrade = (regTrade === '__CUSTOM__' ? regCustomTrade : regTrade).trim();
  const resolvedRegPin = (isRegPinCustom ? regPin : regPin || cleanRegBdDigits).trim();
  const isRegContactValid = /^01\d{9}$/.test(regContactNo.trim());
  const regRanksList: Rank[] = ['MWO', 'SWO', 'WO', 'Sgt', 'Cpl', 'LAC', 'AC-1', 'AC-2'];

  const resolvedRegPresentAddress = useMemo(() => {
    if (regLivingType === 'L_IN') {
      if (!regMessType) return '';
      const cleanBlk = regBlockNo.trim();
      return cleanBlk ? `${regMessType}, Block No: ${cleanBlk}` : regMessType;
    }
    if (regLivingType === 'L_OUT') {
      if (regLivingOutType === 'INSIDE_BASE') {
        const cleanQtr = regSvcQtrNo.trim();
        return cleanQtr ? `Svc Qtr No: ${cleanQtr}` : '';
      }
      if (regLivingOutType === 'OUTSIDE_BASE') {
        return regOutsideBaseAddr.trim();
      }
    }
    return '';
  }, [regLivingType, regMessType, regBlockNo, regLivingOutType, regSvcQtrNo, regOutsideBaseAddr]);

  const formatUserRoleLabel = (roleValue: string) => {
    if (roleValue === 'SUPER_ADMIN') return 'Super Admin';
    if (roleValue === 'ADMIN') return 'Admin';
    if (roleValue === 'USER') return 'User';
    return roleValue;
  };

  const handleRegisterStepNext = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (registerStep === 1) {
      if (!resolvedRegUnitName) {
        setErrorMsg('Please enter OFFICE NAME.');
        return;
      }
      if (isRegOfficeDuplicate) {
        setErrorMsg('Already Registered: This Office Name is already registered.');
        return;
      }
      if (!resolvedRegBase) {
        setErrorMsg(regBase === '__CUSTOM__' ? 'Please enter Custom Base name.' : 'Please select BASE.');
        return;
      }
      if (regBase === '__CUSTOM__' && regCustomBase.trim()) {
        const finalCustomBase = regCustomBase.trim().toUpperCase();
        const updatedBases = addCustomBaseToList(finalCustomBase);
        setAvailableBases(updatedBases);
        setRegBase(finalCustomBase);
        setRegCustomBase('');
      }
      setRegisterStep(2);
      return;
    }

    if (registerStep === 2) {
      if (!cleanRegBdDigits) {
        setErrorMsg('Please enter USER ID (BD NO).');
        return;
      }
      if (existingActiveMemberOffice) {
        setErrorMsg(
          `BD/${cleanRegBdDigits} is currently an Active member in "${existingActiveMemberOffice.officeName}". An active member cannot be in two offices unless Posted Out.`
        );
        return;
      }
      if (!regRank) {
        setErrorMsg('Please select RANK.');
        return;
      }
      if (!regName.trim()) {
        setErrorMsg('Please enter NAME.');
        return;
      }
      if (!resolvedRegTrade) {
        setErrorMsg(regTrade === '__CUSTOM__' ? 'Please enter Custom Trade name.' : 'Please select TRADE.');
        return;
      }
      if (!regUserRole.trim()) {
        setErrorMsg('Please select USER ROLE.');
        return;
      }
      if (!resolvedRegPin) {
        setErrorMsg('Please enter PIN.');
        return;
      }
      if (!isRegContactValid) {
        setErrorMsg('CONTACT NO must be 11 digits and start with 01.');
        return;
      }
      if (!regLivingType) {
        setErrorMsg('Please select PRESENT ADDRESS (Living In or Living Out).');
        setIsRegAddressOpen(true);
        return;
      }
      if (regLivingType === 'L_IN') {
        if (!regMessType) {
          setErrorMsg("Please select Sgt's Mess or Airmen's Mess under Living In.");
          setIsRegAddressOpen(true);
          return;
        }
        if (regMessType === "Airmen's Mess" && !regBlockNo.trim()) {
          setErrorMsg("Please enter Block No under Airmen's Mess.");
          setIsRegAddressOpen(true);
          return;
        }
      }
      if (regLivingType === 'L_OUT') {
        if (!regLivingOutType) {
          setErrorMsg('Please select Inside Base or Outside Base under Living Out.');
          setIsRegAddressOpen(true);
          return;
        }
        if (regLivingOutType === 'INSIDE_BASE' && !regSvcQtrNo.trim()) {
          setErrorMsg('Please enter Svc Qtr No under Inside Base.');
          setIsRegAddressOpen(true);
          return;
        }
        if (regLivingOutType === 'OUTSIDE_BASE' && !regOutsideBaseAddr.trim()) {
          setErrorMsg('Please enter Outside Base address.');
          setIsRegAddressOpen(true);
          return;
        }
      }

      // If a Custom Trade was entered, persist it to the end of the Trade list and select it
      if (regTrade === '__CUSTOM__' && regCustomTrade.trim()) {
        const finalCustomTrade = regCustomTrade.trim();
        const updatedList = addCustomTradeToList(finalCustomTrade);
        setAvailableTrades(updatedList);
        setRegTrade(finalCustomTrade);
        setRegCustomTrade('');
      }

      setRegisterStep(3);
      return;
    }
  };

  const handleSubmitOfficeForApproval = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    if (!resolvedRegUnitName || !cleanRegBdDigits) {
      setErrorMsg('Missing Office or User ID information.');
      return;
    }
    if (isRegOfficeDuplicate) {
      setErrorMsg('Already Registered: This Office Name is already registered.');
      return;
    }
    if (existingActiveMemberOffice) {
      setErrorMsg(
        `BD/${cleanRegBdDigits} is already an Active member in "${existingActiveMemberOffice.officeName}".`
      );
      return;
    }
    if (!isRegContactValid) {
      setErrorMsg('Contact No must be 11 digits and start with 01.');
      return;
    }

    setIsRegistering(true);
    try {
      const finalTrade = resolvedRegTrade || 'Radio Fitt';
      if (regTrade === '__CUSTOM__' && regCustomTrade.trim()) {
        const updatedList = addCustomTradeToList(finalTrade);
        setAvailableTrades(updatedList);
      }

      const cleanName = regName.trim();
      const finalBase = (resolvedRegBase || 'BAF BASE ZHR').toUpperCase();
      if (regBase === '__CUSTOM__' && regCustomBase.trim()) {
        const updatedBases = addCustomBaseToList(finalBase);
        setAvailableBases(updatedBases);
      }
      const request = await submitOfficeRegistrationRequest({
        officeName: resolvedRegUnitName,
        wing: '',
        officeBase: finalBase,
        officeSlogan: regSlogan.trim(),
        officeLogo: regLogo || '/office-management-logo.png?v=26',
        bdNo: cleanRegBdDigits,
        rank: (regRank || 'LAC') as Rank,
        fullName: cleanName,
        surname: cleanName,
        trade: finalTrade,
        flightName: '' as FlightName,
        userRole: (regUserRole.trim() || 'SUPER_ADMIN') as UserRole,
        presentAddress: resolvedRegPresentAddress || finalBase,
        contactNo: regContactNo.trim(),
        pin: resolvedRegPin || cleanRegBdDigits,
      });

      await loadOfficesAndPendingRequests();
      setSubmittedRequestRecord(request);
      setRegisterStep(4);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to submit registration request.');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-slate-50 dark:bg-[#070b14] print:bg-white p-4 print:p-0 select-none overflow-x-hidden print:overflow-visible justify-center transition-colors">
      <div className="fixed top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none z-0 print:hidden" />
      <div className="fixed bottom-10 right-10 w-72 h-72 bg-sky-500/10 rounded-full blur-3xl pointer-events-none z-0 print:hidden" />

      {/* Content Area */}
      <div
        className={`w-full ${
          isRegisterMode
            ? 'max-w-[520px]'
            : isMasterUserTyped
            ? 'max-w-[400px]'
            : 'max-w-[340px] sm:max-w-[360px]'
        } relative z-10 transition-all duration-200`}
      >
        {/* Theme selector moved inside Settings Modal */}

        <div className="bg-white/95 dark:bg-[#0d1526]/95 backdrop-blur-xl border border-slate-200 dark:border-slate-800/90 rounded-2xl p-5 sm:p-7 shadow-2xl space-y-4 sm:space-y-5 text-slate-900 dark:text-white text-center">
          {/* Header */}
          <div className="flex flex-col items-center space-y-2.5">
            <div className="flex items-center justify-center p-1">
              <Logo155UASU
                size="lg"
                logoOverride={isRegisterMode ? regLogo : displayedOfficeLogo}
                onClick={handleLogoSecretClick}
                title={isRegisterMode ? resolvedRegUnitName || 'New Office' : displayedOfficeName}
              />
            </div>
            <div>
              <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest mb-1.5">
                <Shield className="w-3 h-3" />
                <span>
                  {isRegisterMode
                    ? registerStep === 4
                      ? 'REGISTRATION SUBMITTED'
                      : `REGISTER A NEW OFFICE • STEP ${registerStep} OF 3`
                    : isResetMode
                    ? 'PASSWORD RECOVERY'
                    : isMasterUserTyped
                    ? 'MASTER OWNER PORTAL'
                    : 'USER LOGIN PORTAL'}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-black tracking-wide text-slate-900 dark:text-white flex items-center justify-center space-x-2 uppercase">
                <span>
                  {isRegisterMode
                    ? resolvedRegUnitName || 'REGISTER A NEW OFFICE'
                    : displayedOfficeName}
                </span>
              </h1>
              {(isRegisterMode || displayedOfficeSubtitle) && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5">
                  {isRegisterMode
                    ? registerStep === 1
                      ? 'Step 1: Office Information (Office Name, Base, Slogan & Logo)'
                      : registerStep === 2
                      ? 'Step 2: User Information (USER ID (BD NO), RANK, NAME, TRADE, USER ROLE, PIN, CONTACT NO, PRESENT ADDRESS)'
                      : registerStep === 3
                      ? 'Step 3: Review & Submit for Master Admin Approval'
                      : 'Registration Request Submitted for Approval'
                    : displayedOfficeSubtitle}
                </p>
              )}

              {/* Pending Approval Notice if User types BD No of an unapproved Office Request */}
              {!isRegisterMode && !isResetMode && matchedPendingRequest && !matchedUserOffice && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-300 text-[11px] font-bold mt-2">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {matchedPendingRequest.officeName} • Pending Master Admin Approval
                  </span>
                </div>
              )}

              {updateAvailable && !isRegisterMode && (
                <button
                  type="button"
                  onClick={() => setIsUpdateModalOpen(true)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-500/25 transition-all cursor-pointer animate-pulse mt-1"
                >
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>New Update v{updateAvailable.version_name} Available (Click to Update)</span>
                </button>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 rounded-xl flex items-start space-x-2 text-left text-xs text-red-700 dark:text-red-200 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {registerSuccessBanner && !isRegisterMode && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start space-x-2 text-left text-xs text-emerald-800 dark:text-emerald-200 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <span>{registerSuccessBanner}</span>
            </div>
          )}

          {successAirman && !isSuccessAnimation && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center justify-center space-x-2 text-xs text-emerald-800 dark:text-emerald-200 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Verified: {successAirman.rank} {successAirman.fullName || successAirman.name}</span>
            </div>
          )}

          {isSuccessAnimation ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 350, damping: 25 }}
              className="py-5 flex flex-col items-center justify-center space-y-3.5"
            >
              <div className="relative flex items-center justify-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0.6 }}
                  animate={{ scale: [1, 1.45, 1.2], opacity: [0.6, 0.25, 0] }}
                  transition={{ duration: 0.9, repeat: Infinity }}
                  className="absolute w-16 h-16 rounded-full bg-emerald-500/30 blur-md"
                />
                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 flex items-center justify-center shadow-xl shadow-emerald-500/25 border border-emerald-400/40 text-white">
                  <Check className="w-7 h-7 stroke-[3]" />
                </div>
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/90 border border-emerald-300 dark:border-emerald-500/40 text-emerald-700 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
                  <Sparkles className="w-3 h-3" />
                  <span>Access Granted</span>
                </div>
                <h2 className="text-lg font-black text-slate-900 dark:text-white">
                  {successAirman?.rank} {successAirman?.fullName || successAirman?.name}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  ID/{successAirman?.bdNo || bdInput} • {displayedOfficeName}
                </p>
              </div>

              <div className="w-40 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
                <motion.div
                  initial={{ width: '0%' }}
                  animate={{ width: '100%' }}
                  transition={{ duration: 0.45, ease: 'easeInOut' }}
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
                />
              </div>
            </motion.div>
          ) : isRegisterMode ? (
            /* 3-4 STEP REGISTER A NEW OFFICE WIZARD */
            <div className="space-y-4 pt-1 text-left animate-fadeIn">
              {/* Step Progress Bar */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { step: 1, title: '1. Office Info' },
                  { step: 2, title: '2. User Info' },
                  { step: 3, title: '3. Submit Approval' },
                ].map((item) => {
                  const isActive = registerStep === item.step;
                  const isDone = registerStep > item.step;
                  return (
                    <button
                      key={item.step}
                      type="button"
                      onClick={() => {
                        if (item.step < registerStep && registerStep !== 4) {
                          setRegisterStep(item.step as 1 | 2 | 3);
                          setErrorMsg('');
                        }
                      }}
                      className={`py-2 px-2.5 rounded-xl border text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all ${
                        isActive
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-600 dark:text-emerald-300 shadow-sm'
                          : isDone
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 cursor-pointer'
                          : 'bg-slate-100 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {isDone ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : null}
                      <span className="truncate">{item.title}</span>
                    </button>
                  );
                })}
              </div>

              {/* STEP 1: OFFICE INFORMATION (OFFICE NAME, BASE, OFFICE SLOGAN & LOGO) */}
              {registerStep === 1 && (
                <form onSubmit={handleRegisterStepNext} className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#070b14]/90 border border-slate-200 dark:border-slate-800 space-y-3.5">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      <Building2 className="w-4 h-4" />
                      <span>Step 1: Office Information</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                      {/* Box: OFFICE NAME (ALL CAPITAL LETTERS, Mandatory, Live Duplicate Check) */}
                      {(() => {
                        const isFocused = focusedRegField === 'regUnit';
                        const isFloating = isFocused || regUnit.trim().length > 0;
                        return (
                          <div className="space-y-1">
                            <div className="relative">
                              <input
                                id="reg-office-name"
                                type="text"
                                value={regUnit}
                                onChange={(e) => {
                                  setRegUnit(e.target.value.toUpperCase());
                                  setErrorMsg('');
                                }}
                                onFocus={() => setFocusedRegField('regUnit')}
                                onBlur={() => setFocusedRegField((prev) => (prev === 'regUnit' ? null : prev))}
                                placeholder=""
                                required
                                className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold uppercase text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                  isRegOfficeDuplicate
                                    ? 'border-red-500 ring-2 ring-red-500/20'
                                    : isFocused
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                              />
                              <label
                                htmlFor="reg-office-name"
                                className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                  isFloating
                                    ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                      (isRegOfficeDuplicate
                                        ? 'text-red-500 dark:text-red-400'
                                        : isFocused
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-slate-500 dark:text-slate-400')
                                    : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                                }`}
                              >
                                OFFICE NAME *
                              </label>
                            </div>
                            {isRegOfficeDuplicate && (
                              <div className="flex items-center gap-1 text-[11px] font-bold text-red-500 dark:text-red-400 px-1">
                                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>Already Registered</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Box: BASE (Dropdown List: BAF BASE AKR, BSR, ZHR, MTR, CXB, SMD + Custom) */}
                      {(() => {
                        const isFocused = focusedRegField === 'regBase';
                        const isFloating = isFocused || regBase.trim().length > 0;
                        return (
                          <div className="relative">
                            <select
                              id="reg-base"
                              value={regBase}
                              onChange={(e) => {
                                setRegBase(e.target.value);
                                setErrorMsg('');
                              }}
                              onFocus={() => setFocusedRegField('regBase')}
                              onBlur={() => setFocusedRegField((prev) => (prev === 'regBase' ? null : prev))}
                              required
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold outline-none transition-all duration-200 cursor-pointer ${
                                !regBase ? 'text-transparent' : 'text-slate-900 dark:text-white'
                              } ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            >
                              <option value="" disabled hidden></option>
                              {availableBases.map((b) => (
                                <option
                                  key={b}
                                  value={b}
                                  className="text-slate-900 dark:text-white bg-white dark:bg-slate-900"
                                >
                                  {b}
                                </option>
                              ))}
                              <option
                                value="__CUSTOM__"
                                className="text-emerald-600 dark:text-emerald-400 font-bold bg-white dark:bg-slate-900"
                              >
                                Custom
                              </option>
                            </select>
                            <label
                              htmlFor="reg-base"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              BASE *
                            </label>
                          </div>
                        );
                      })()}

                      {/* Custom Base Input (Appears when Custom is chosen in Base dropdown) */}
                      {regBase === '__CUSTOM__' &&
                        (() => {
                          const isFocused = focusedRegField === 'regCustomBase';
                          const isFloating = isFocused || regCustomBase.trim().length > 0;
                          return (
                            <div className="relative sm:col-span-2">
                              <input
                                id="reg-custom-base"
                                type="text"
                                value={regCustomBase}
                                onChange={(e) => {
                                  setRegCustomBase(e.target.value.toUpperCase());
                                  setErrorMsg('');
                                }}
                                onFocus={() => setFocusedRegField('regCustomBase')}
                                onBlur={() => {
                                  setFocusedRegField((prev) => (prev === 'regCustomBase' ? null : prev));
                                  if (regCustomBase.trim()) {
                                    const saved = regCustomBase.trim().toUpperCase();
                                    const nextBases = addCustomBaseToList(saved);
                                    setAvailableBases(nextBases);
                                    setRegBase(saved);
                                    setRegCustomBase('');
                                  }
                                }}
                                placeholder=""
                                required
                                className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold uppercase text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                  isFocused
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                              />
                              <label
                                htmlFor="reg-custom-base"
                                className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                  isFloating
                                    ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                      (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                    : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                                }`}
                              >
                                CUSTOM BASE *
                              </label>
                            </div>
                          );
                        })()}
                    </div>

                    {/* Box: OFFICE SLOGAN */}
                    <div className="pt-1">
                      {(() => {
                        const isFocused = focusedRegField === 'regSlogan';
                        const isFloating = isFocused || regSlogan.trim().length > 0;
                        return (
                          <div className="relative">
                            <input
                              id="reg-slogan"
                              type="text"
                              value={regSlogan}
                              onChange={(e) => setRegSlogan(e.target.value)}
                              onFocus={() => setFocusedRegField('regSlogan')}
                              onBlur={() => setFocusedRegField((prev) => (prev === 'regSlogan' ? null : prev))}
                              placeholder=""
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            />
                            <label
                              htmlFor="reg-slogan"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black uppercase tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              OFFICE SLOGAN
                            </label>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Office Logo Upload */}
                    <div className="pt-1 flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800">
                      <div className="flex items-center gap-2.5">
                        <img
                          src={regLogo || '/155-uasu-baf-logo.png'}
                          alt="Office Logo"
                          className="w-9 h-9 rounded-lg object-contain bg-slate-100 dark:bg-slate-800 p-1 border border-slate-200 dark:border-slate-700"
                        />
                        <div>
                          <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200">
                            Office Emblem / Logo
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            Default BAF Crest or Upload Custom PNG/JPG
                          </div>
                        </div>
                      </div>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoFileChange}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer shrink-0"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Upload</span>
                      </button>
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsRegisterMode(false);
                        setErrorMsg('');
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>Back to Login</span>
                    </button>
                    <button
                      type="submit"
                      disabled={isRegOfficeDuplicate}
                      className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-600/20"
                    >
                      <span>{isRegOfficeDuplicate ? 'Already Registered' : 'Next: User Info'}</span>
                      {!isRegOfficeDuplicate && <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 2: USER INFORMATION (ALL CAPITAL LETTER LABELS & PRESENT ADDRESS BUILDER) */}
              {registerStep === 2 && (
                <form onSubmit={handleRegisterStepNext} className="space-y-3.5">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#070b14]/90 border border-slate-200 dark:border-slate-800 space-y-3.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        <UserCheck className="w-4 h-4" />
                        <span>Step 2: User Information</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">
                        {resolvedRegUnitName}
                      </span>
                    </div>

                    {/* 7 Floating-Label Boxes (ALL CAPITAL LETTERS) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
                      {/* 1. USER ID (BD NO) */}
                      {(() => {
                        const isFocused = focusedRegField === 'regBdNo';
                        const isFloating = isFocused || regBdNo.trim().length > 0;
                        const hasActiveConflict = Boolean(existingActiveMemberOffice);
                        return (
                          <div className="space-y-1">
                            <div className="relative">
                              <input
                                id="reg-bd-no"
                                type="text"
                                inputMode="numeric"
                                value={regBdNo}
                                onChange={(e) => {
                                  const nextBd = e.target.value.replace(/[^0-9]/g, '');
                                  setRegBdNo(nextBd);
                                  if (!isRegPinCustom) {
                                    setRegPin(nextBd);
                                  }
                                  setErrorMsg('');
                                }}
                                onFocus={() => setFocusedRegField('regBdNo')}
                                onBlur={() => setFocusedRegField((prev) => (prev === 'regBdNo' ? null : prev))}
                                placeholder=""
                                required
                                className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                  hasActiveConflict
                                    ? 'border-red-500 ring-2 ring-red-500/20'
                                    : isFocused
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                              />
                              <label
                                htmlFor="reg-bd-no"
                                className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                  isFloating
                                    ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                      (hasActiveConflict
                                        ? 'text-red-500 dark:text-red-400'
                                        : isFocused
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-slate-500 dark:text-slate-400')
                                    : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                                }`}
                              >
                                USER ID (BD NO)
                              </label>
                            </div>
                            {hasActiveConflict && (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-red-500 dark:text-red-400 px-1">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span>Already Active in {existingActiveMemberOffice?.officeName}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* 2. RANK */}
                      {(() => {
                        const isFocused = focusedRegField === 'regRank';
                        const isFloating = isFocused || regRank.trim().length > 0;
                        return (
                          <div className="relative">
                            <select
                              id="reg-rank"
                              value={regRank}
                              onChange={(e) => {
                                const nextRank = e.target.value as Rank;
                                setRegRank(nextRank);
                                if (regLivingType === 'L_IN' && !regMessType) {
                                  setRegMessType(
                                    ['MWO', 'SWO', 'WO', 'Sgt'].includes(nextRank)
                                      ? "Sgt's Mess"
                                      : "Airmen's Mess"
                                  );
                                }
                                setErrorMsg('');
                              }}
                              onFocus={() => setFocusedRegField('regRank')}
                              onBlur={() => setFocusedRegField((prev) => (prev === 'regRank' ? null : prev))}
                              required
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold outline-none transition-all duration-200 cursor-pointer ${
                                !regRank ? 'text-transparent' : 'text-slate-900 dark:text-white'
                              } ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            >
                              <option value="" disabled hidden></option>
                              {regRanksList.map((r) => (
                                <option
                                  key={r}
                                  value={r}
                                  className="text-slate-900 dark:text-white bg-white dark:bg-slate-900"
                                >
                                  {r}
                                </option>
                              ))}
                            </select>
                            <label
                              htmlFor="reg-rank"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              RANK
                            </label>
                          </div>
                        );
                      })()}

                      {/* 3. NAME (Full Name removed as requested) */}
                      {(() => {
                        const isFocused = focusedRegField === 'regName';
                        const isFloating = isFocused || regName.trim().length > 0;
                        return (
                          <div className="relative">
                            <input
                              id="reg-name"
                              type="text"
                              value={regName}
                              onChange={(e) => {
                                setRegName(e.target.value);
                                setErrorMsg('');
                              }}
                              onFocus={() => setFocusedRegField('regName')}
                              onBlur={() => setFocusedRegField((prev) => (prev === 'regName' ? null : prev))}
                              placeholder=""
                              required
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            />
                            <label
                              htmlFor="reg-name"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              NAME
                            </label>
                          </div>
                        );
                      })()}

                      {/* 4. TRADE */}
                      {(() => {
                        const isFocused = focusedRegField === 'regTrade';
                        const isFloating = isFocused || regTrade.trim().length > 0;
                        return (
                          <div className="relative">
                            <select
                              id="reg-trade"
                              value={regTrade}
                              onChange={(e) => {
                                setRegTrade(e.target.value);
                                setErrorMsg('');
                              }}
                              onFocus={() => setFocusedRegField('regTrade')}
                              onBlur={() => setFocusedRegField((prev) => (prev === 'regTrade' ? null : prev))}
                              required
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold outline-none transition-all duration-200 cursor-pointer ${
                                !regTrade ? 'text-transparent' : 'text-slate-900 dark:text-white'
                              } ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            >
                              <option value="" disabled hidden></option>
                              {availableTrades.map((t) => (
                                <option
                                  key={t}
                                  value={t}
                                  className="text-slate-900 dark:text-white bg-white dark:bg-slate-900"
                                >
                                  {t}
                                </option>
                              ))}
                              <option
                                value="__CUSTOM__"
                                className="text-emerald-600 dark:text-emerald-400 font-bold bg-white dark:bg-slate-900"
                              >
                                Custom
                              </option>
                            </select>
                            <label
                              htmlFor="reg-trade"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              TRADE
                            </label>
                          </div>
                        );
                      })()}

                      {/* Custom Trade Input (Appears when Custom is chosen in Trade dropdown) */}
                      {regTrade === '__CUSTOM__' &&
                        (() => {
                          const isFocused = focusedRegField === 'regCustomTrade';
                          const isFloating = isFocused || regCustomTrade.trim().length > 0;
                          return (
                            <div className="relative sm:col-span-2">
                              <input
                                id="reg-custom-trade"
                                type="text"
                                value={regCustomTrade}
                                onChange={(e) => {
                                  setRegCustomTrade(e.target.value);
                                  setErrorMsg('');
                                }}
                                onFocus={() => setFocusedRegField('regCustomTrade')}
                                onBlur={() => {
                                  setFocusedRegField((prev) => (prev === 'regCustomTrade' ? null : prev));
                                  if (regCustomTrade.trim()) {
                                    const saved = regCustomTrade.trim();
                                    const nextTrades = addCustomTradeToList(saved);
                                    setAvailableTrades(nextTrades);
                                    setRegTrade(saved);
                                    setRegCustomTrade('');
                                  }
                                }}
                                placeholder=""
                                required
                                className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                  isFocused
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                              />
                              <label
                                htmlFor="reg-custom-trade"
                                className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                  isFloating
                                    ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                      (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                    : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                                }`}
                              >
                                CUSTOM TRADE NAME
                              </label>
                            </div>
                          );
                        })()}

                      {/* 5. USER ROLE */}
                      {(() => {
                        const isFocused = focusedRegField === 'regUserRole';
                        const isFloating = isFocused || regUserRole.trim().length > 0;
                        return (
                          <div className="relative">
                            <select
                              id="reg-user-role"
                              value={regUserRole}
                              onChange={(e) => {
                                const nextRole = e.target.value;
                                setRegUserRole(nextRole);
                                if (nextRole && !isRegPinCustom) {
                                  setRegPin(cleanRegBdDigits);
                                }
                                setErrorMsg('');
                              }}
                              onFocus={() => setFocusedRegField('regUserRole')}
                              onBlur={() => setFocusedRegField((prev) => (prev === 'regUserRole' ? null : prev))}
                              required
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold outline-none transition-all duration-200 cursor-pointer ${
                                !regUserRole ? 'text-transparent' : 'text-slate-900 dark:text-white'
                              } ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            >
                              <option value="" disabled hidden></option>
                              <option value="SUPER_ADMIN" className="text-slate-900 dark:text-white bg-white dark:bg-slate-900">Super Admin</option>
                              <option value="ADMIN" className="text-slate-900 dark:text-white bg-white dark:bg-slate-900">Admin</option>
                              <option value="USER" className="text-slate-900 dark:text-white bg-white dark:bg-slate-900">User</option>
                            </select>
                            <label
                              htmlFor="reg-user-role"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              USER ROLE
                            </label>
                          </div>
                        );
                      })()}

                      {/* 6. PIN (Appears after USER ROLE is set; default pre-filled with User's BD No) */}
                      {regUserRole.trim().length > 0 &&
                        (() => {
                          const isFocused = focusedRegField === 'regPin';
                          const currentPinValue = isRegPinCustom ? regPin : regPin || cleanRegBdDigits;
                          const isFloating = isFocused || currentPinValue.trim().length > 0;
                          return (
                            <div className="relative animate-fadeIn">
                              <input
                                id="reg-pin"
                                type="text"
                                value={currentPinValue}
                                onChange={(e) => {
                                  setIsRegPinCustom(true);
                                  setRegPin(e.target.value);
                                  setErrorMsg('');
                                }}
                                onFocus={() => setFocusedRegField('regPin')}
                                onBlur={() => setFocusedRegField((prev) => (prev === 'regPin' ? null : prev))}
                                placeholder=""
                                required
                                className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                  isFocused
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                              />
                              <label
                                htmlFor="reg-pin"
                                className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                  isFloating
                                    ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                      (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                    : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                                }`}
                              >
                                PIN
                              </label>
                            </div>
                          );
                        })()}

                      {/* 7. CONTACT NO (Above PRESENT ADDRESS; must be 11 digits starting with 01) */}
                      {(() => {
                        const isFocused = focusedRegField === 'regContactNo';
                        const isFloating = isFocused || regContactNo.trim().length > 0;
                        const hasContactError = regContactNo.length > 0 && !isRegContactValid;
                        return (
                          <div className={`space-y-1 ${regUserRole.trim().length > 0 ? 'sm:col-span-2' : ''}`}>
                            <div className="relative">
                              <input
                                id="reg-contact-no"
                                type="tel"
                                inputMode="numeric"
                                maxLength={11}
                                value={regContactNo}
                                onChange={(e) => {
                                  setRegContactNo(e.target.value.replace(/[^0-9]/g, '').slice(0, 11));
                                  setErrorMsg('');
                                }}
                                onFocus={() => setFocusedRegField('regContactNo')}
                                onBlur={() => setFocusedRegField((prev) => (prev === 'regContactNo' ? null : prev))}
                                placeholder=""
                                required
                                className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-mono font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                                  hasContactError
                                    ? 'border-red-500 ring-2 ring-red-500/20'
                                    : isFocused
                                    ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                                }`}
                              />
                              <label
                                htmlFor="reg-contact-no"
                                className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                  isFloating
                                    ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                      (hasContactError
                                        ? 'text-red-500 dark:text-red-400'
                                        : isFocused
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : 'text-slate-500 dark:text-slate-400')
                                    : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                                }`}
                              >
                                CONTACT NO
                              </label>
                            </div>
                            {hasContactError && (
                              <div className="flex items-center gap-1 text-[10px] font-bold text-red-500 dark:text-red-400 px-1">
                                <AlertCircle className="w-3 h-3 shrink-0" />
                                <span>Must be 11 digits starting with 01</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* 8. PRESENT ADDRESS (Below CONTACT NO; Trigger Box) */}
                      {(() => {
                        const isFocused = focusedRegField === 'regPresentAddress' || isRegAddressOpen;
                        const isFloating = isFocused || resolvedRegPresentAddress.length > 0 || regLivingType !== '';
                        return (
                          <div className="relative sm:col-span-2">
                            <button
                              id="reg-present-address"
                              type="button"
                              onClick={() => {
                                setIsRegAddressOpen((prev) => !prev);
                                setFocusedRegField('regPresentAddress');
                                setErrorMsg('');
                              }}
                              className={`w-full bg-white dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-xs font-bold text-left outline-none transition-all duration-200 flex items-center justify-between gap-2 cursor-pointer ${
                                isFocused
                                  ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                              }`}
                            >
                              <span
                                className={`truncate ${
                                  resolvedRegPresentAddress
                                    ? 'text-slate-900 dark:text-white'
                                    : regLivingType === 'L_IN'
                                    ? 'text-slate-500 dark:text-slate-400'
                                    : regLivingType === 'L_OUT'
                                    ? 'text-slate-500 dark:text-slate-400'
                                    : 'text-transparent'
                                }`}
                              >
                                {resolvedRegPresentAddress ||
                                  (regLivingType === 'L_IN'
                                    ? regMessType || 'Living In'
                                    : regLivingType === 'L_OUT'
                                    ? regLivingOutType === 'INSIDE_BASE'
                                      ? 'Inside Base'
                                      : regLivingOutType === 'OUTSIDE_BASE'
                                      ? 'Outside Base'
                                      : 'Living Out'
                                    : 'PRESENT ADDRESS')}
                              </span>
                              <ChevronRight
                                className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
                                  isRegAddressOpen ? 'rotate-90 text-emerald-500' : ''
                                }`}
                              />
                            </button>
                            <label
                              htmlFor="reg-present-address"
                              className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none uppercase ${
                                isFloating
                                  ? 'top-0 -translate-y-1/2 text-[10px] font-black tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                    (isFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                                  : 'top-1/2 -translate-y-1/2 text-xs font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                              }`}
                            >
                              PRESENT ADDRESS
                            </label>
                          </div>
                        );
                      })()}

                      {/* PRESENT ADDRESS EXPANDED PANEL (Living In / Living Out Options) */}
                      {(isRegAddressOpen || regLivingType !== '') && (
                        <div className="sm:col-span-2 p-3 rounded-xl bg-white dark:bg-slate-900/95 border border-emerald-500/40 space-y-2.5 animate-fadeIn">
                          {/* Level 1: Living In vs Living Out */}
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setRegLivingType('L_IN');
                                if (!regMessType) {
                                  setRegMessType(
                                    ['MWO', 'SWO', 'WO', 'Sgt'].includes(regRank as Rank)
                                      ? "Sgt's Mess"
                                      : "Airmen's Mess"
                                  );
                                }
                                setErrorMsg('');
                              }}
                              className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border ${
                                regLivingType === 'L_IN'
                                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                  : 'bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/50'
                              }`}
                            >
                              Living In
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRegLivingType('L_OUT');
                                if (!regLivingOutType) {
                                  setRegLivingOutType('INSIDE_BASE');
                                }
                                setErrorMsg('');
                              }}
                              className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer border ${
                                regLivingType === 'L_OUT'
                                  ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                  : 'bg-slate-100 dark:bg-slate-800/90 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/50'
                              }`}
                            >
                              Living Out
                            </button>
                          </div>

                          {/* Level 2A: Living In -> Sgt's Mess | Airmen's Mess -> Fixed "Block No:" input */}
                          {regLivingType === 'L_IN' && (
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRegMessType("Sgt's Mess");
                                    setErrorMsg('');
                                  }}
                                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                    regMessType === "Sgt's Mess"
                                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  Sgt's Mess
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRegMessType("Airmen's Mess");
                                    setErrorMsg('');
                                  }}
                                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                    regMessType === "Airmen's Mess"
                                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  Airmen's Mess
                                </button>
                              </div>

                              <div className="flex items-center w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
                                <span className="text-xs font-black text-slate-500 dark:text-slate-400 mr-2 whitespace-nowrap select-none">
                                  Block No:
                                </span>
                                <input
                                  type="text"
                                  value={regBlockNo}
                                  onChange={(e) => {
                                    setRegBlockNo(e.target.value);
                                    setErrorMsg('');
                                  }}
                                  placeholder="123/12"
                                  className="flex-1 bg-transparent text-xs font-bold text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                />
                              </div>
                            </div>
                          )}

                          {/* Level 2B: Living Out -> Inside Base (Fixed "Svc Qtr No:") | Outside Base ("Maizpara...") */}
                          {regLivingType === 'L_OUT' && (
                            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                              <div className="grid grid-cols-2 gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRegLivingOutType('INSIDE_BASE');
                                    setErrorMsg('');
                                  }}
                                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                    regLivingOutType === 'INSIDE_BASE'
                                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  Inside Base
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRegLivingOutType('OUTSIDE_BASE');
                                    setErrorMsg('');
                                  }}
                                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                                    regLivingOutType === 'OUTSIDE_BASE'
                                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-400'
                                  }`}
                                >
                                  Outside Base
                                </button>
                              </div>

                              {regLivingOutType === 'INSIDE_BASE' ? (
                                <div className="flex items-center w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
                                  <span className="text-xs font-black text-slate-500 dark:text-slate-400 mr-2 whitespace-nowrap select-none">
                                    Svc Qtr No:
                                  </span>
                                  <input
                                    type="text"
                                    value={regSvcQtrNo}
                                    onChange={(e) => {
                                      setRegSvcQtrNo(e.target.value);
                                      setErrorMsg('');
                                    }}
                                    placeholder="123/12"
                                    className="flex-1 bg-transparent text-xs font-bold text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                  />
                                </div>
                              ) : regLivingOutType === 'OUTSIDE_BASE' ? (
                                <div className="flex items-center w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20">
                                  <input
                                    type="text"
                                    value={regOutsideBaseAddr}
                                    onChange={(e) => {
                                      setRegOutsideBaseAddr(e.target.value);
                                      setErrorMsg('');
                                    }}
                                    placeholder="Maizpara..."
                                    className="w-full bg-transparent text-xs font-bold text-slate-900 dark:text-white outline-none placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                  />
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRegisterStep(1);
                        setErrorMsg('');
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back: Office Info</span>
                    </button>
                    <button
                      type="submit"
                      disabled={Boolean(existingActiveMemberOffice)}
                      className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-600/20"
                    >
                      <span>Next: Review & Submit</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 3: REVIEW & SUBMIT FOR APPROVAL */}
              {registerStep === 3 && (
                <form onSubmit={handleSubmitOfficeForApproval} className="space-y-3.5">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#070b14]/90 border border-slate-200 dark:border-slate-800 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      <Send className="w-4 h-4" />
                      <span>Step 3: Submit for Master Admin Approval</span>
                    </div>

                    {/* Office Summary Box */}
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center gap-3">
                      <img
                        src={regLogo || '/155-uasu-baf-logo.png'}
                        alt={resolvedRegUnitName}
                        className="w-11 h-11 rounded-xl object-contain bg-slate-100 dark:bg-slate-800 p-1.5 border border-slate-200 dark:border-slate-700 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                          1. Office Information
                        </div>
                        <div className="text-sm font-black text-slate-900 dark:text-white truncate">
                          {resolvedRegUnitName}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {resolvedRegBase} {regSlogan ? `• ${regSlogan}` : ''}
                        </div>
                      </div>
                    </div>

                    {/* User Summary Boxed Grid (7 Fields) */}
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                      <div className="text-[10px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400">
                        2. User Information (Biodata & User Management)
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">USER ID (BD NO)</div>
                          <div className="font-mono font-black text-emerald-600 dark:text-emerald-400">BD/{cleanRegBdDigits || regBdNo}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">RANK</div>
                          <div className="font-bold text-slate-900 dark:text-white truncate">
                            {regRank}
                          </div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">NAME</div>
                          <div className="font-bold text-slate-900 dark:text-white truncate">{regName}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">TRADE</div>
                          <div className="font-bold text-slate-900 dark:text-white truncate">{resolvedRegTrade}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">USER ROLE</div>
                          <div className="font-black text-amber-600 dark:text-amber-400 truncate">{formatUserRoleLabel(regUserRole)}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">PIN</div>
                          <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate">{resolvedRegPin || cleanRegBdDigits}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800">
                          <div className="text-[9px] uppercase font-bold text-slate-400">CONTACT NO</div>
                          <div className="font-mono font-bold text-slate-900 dark:text-white truncate">{regContactNo}</div>
                        </div>
                        <div className="p-2 rounded-lg bg-slate-50 dark:bg-[#070b14] border border-slate-200 dark:border-slate-800 col-span-2">
                          <div className="text-[9px] uppercase font-bold text-slate-400">PRESENT ADDRESS</div>
                          <div className="font-bold text-slate-900 dark:text-white truncate">{resolvedRegPresentAddress}</div>
                        </div>
                      </div>
                    </div>

                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300 font-medium leading-relaxed">
                      Upon clicking <strong>Submit for Approval</strong>, this request will be sent for approval. Once approved, the new office workspace will be created and your record will be automatically added to <strong>Biodata Register</strong> & <strong>User Management</strong>.
                    </div>
                  </div>

                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRegisterStep(2);
                        setErrorMsg('');
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Back: User Info</span>
                    </button>
                    <button
                      type="submit"
                      disabled={isRegistering}
                      className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                    >
                      {isRegistering ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>SUBMITTING...</span>
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          <span>Submit for Approval</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* STEP 4: SUBMITTED CONFIRMATION (NO MASTER ADMIN PANEL BUTTON) */}
              {registerStep === 4 && (
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-center space-y-3.5 animate-fadeIn">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-500 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-600 dark:text-amber-300 text-[10px] font-black uppercase tracking-wider">
                      <Clock className="w-3 h-3" />
                      <span>Pending Approval</span>
                    </div>
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      {submittedRequestRecord?.officeName || resolvedRegUnitName}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Requester: <strong>{submittedRequestRecord?.rank || regRank} {submittedRequestRecord?.surname || submittedRequestRecord?.fullName || regName}</strong> (BD/{submittedRequestRecord?.bdNo || regBdNo})
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed pt-1">
                      Your New Office registration request has been submitted for approval. Once approved, your New Office will be created and your profile will be updated in <strong>Biodata Register</strong> & <strong>User Management</strong>.
                    </p>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsRegisterMode(false);
                        setRegisterStep(1);
                        setBdInput('');
                        setPasswordInput('');
                        setRegisterSuccessBanner(
                          `Request for "${submittedRequestRecord?.officeName || resolvedRegUnitName}" has been submitted for approval!`
                        );
                      }}
                      className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Back to Login Portal</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : !isResetMode ? (
            <form onSubmit={handleSubmit} className="space-y-4 pt-1" ref={loginPinRef}>
              {(() => {
                const isUserIdFloating = isUserIdFocused || bdInput.trim().length > 0;
                const isPinFloating = isPasswordFocused || passwordInput.trim().length > 0;

                return (
                  <>
                    <div className="text-left relative pt-1">
                      <div className="relative">
                        <input
                          id="login-user-id"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={bdInput}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '');
                            setBdInput(val);
                            setErrorMsg('');
                            if (targetAirman) setTargetAirman(null);
                          }}
                          onKeyDown={(e) => {
                            if (
                              ['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                              e.ctrlKey || e.metaKey
                            ) {
                              return;
                            }
                            if (!/^[0-9]$/.test(e.key)) {
                              e.preventDefault();
                            }
                          }}
                          onPaste={(e) => {
                            e.preventDefault();
                            const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
                            if (pasted) {
                              setBdInput(pasted);
                              setErrorMsg('');
                            }
                          }}
                          onFocus={() => {
                            setIsUserIdFocused(true);
                            setIsPasswordFocused(false);
                          }}
                          onBlur={() => {
                            setTimeout(() => setIsUserIdFocused(false), 200);
                            const cleanInput = bdInput.replace(/^BD\/?/i, '').replace(/[^0-9]/g, '').trim();
                            if (cleanInput && cleanInput !== MASTER_OWNER_USER_ID) {
                              const found = airmen.find(
                                (a) => (a.bdNo || '').replace(/^BD\/?/i, '').replace(/[^0-9]/g, '').trim().toLowerCase() === cleanInput.toLowerCase()
                              );
                              setTargetAirman(found || null);
                            }
                          }}
                          className={`w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-3.5 py-3 text-sm font-mono font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                            isUserIdFocused
                              ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                              : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                          }`}
                          placeholder=""
                          autoComplete="username"
                        />
                        <label
                          htmlFor="login-user-id"
                          className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none ${
                            isUserIdFloating
                              ? 'top-0 -translate-y-1/2 text-[10px] font-black uppercase tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                (isUserIdFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                              : 'top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                          }`}
                        >
                          USER ID
                        </label>
                      </div>

                      {recentLogins.length > 0 && isUserIdFocused && (
                        <div className="mt-2 p-2 bg-slate-100 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 px-1">Recent Accounts</div>
                          {recentLogins.map((id) => (
                            <div key={id} className="flex items-center justify-between p-1.5 hover:bg-slate-200/70 dark:hover:bg-slate-700 rounded-lg group transition-colors">
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  const cleanSelected = id.replace(/[^0-9]/g, '');
                                  setBdInput(cleanSelected);
                                  setIsUserIdFocused(false);
                                  setIsPasswordFocused(true);
                                  saveLastUsedIdForPortal('Office', cleanSelected);
                                  const found = airmen.find((a) => a.bdNo === cleanSelected);
                                  setTargetAirman(found || null);
                                }}
                                className="flex-1 text-left font-mono text-xs text-slate-700 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white flex items-center space-x-2"
                              >
                                <Lock className="w-3 h-3 text-slate-400 dark:text-slate-500 group-hover:text-emerald-500 dark:group-hover:text-emerald-400" />
                                <span>{id}</span>
                              </button>
                              <button
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => removeRecent(id)}
                                className="p-1 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ml-2"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* MASTER USER ID (48456) OFFICE SELECTION LIST */}
                    {isMasterUserTyped && (
                      <div className="text-left p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 animate-fadeIn">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400">
                            <Building2 className="w-3.5 h-3.5" />
                            <span>Select Office to Login</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsMasterPortalOpen(true)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-700 dark:text-amber-300 text-[10px] font-black uppercase tracking-wider cursor-pointer transition-all"
                          >
                            <Shield className="w-3 h-3" />
                            <span>Master Panel</span>
                            {pendingRequestsCount > 0 && (
                              <span className="px-1.5 py-0.2 rounded-full bg-amber-500 text-slate-950 text-[9px] font-black">
                                {pendingRequestsCount}
                              </span>
                            )}
                          </button>
                        </div>

                        <div className="max-h-44 overflow-y-auto space-y-1.5 pr-0.5">
                          {registeredOffices.map((office) => {
                            const officeKey = office.officeCode || office.projectId;
                            const isSelected =
                              (selectedMasterOffice?.officeCode || selectedMasterOffice?.projectId) === officeKey;
                            return (
                              <button
                                key={officeKey}
                                type="button"
                                onClick={() => setSelectedMasterOfficeId(officeKey)}
                                className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2 cursor-pointer ${
                                  isSelected
                                    ? 'bg-emerald-600/15 border-emerald-500 text-slate-900 dark:text-white shadow-sm'
                                    : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-700'
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <img
                                    src={office.officeLogo || '/155-uasu-baf-logo.png'}
                                    alt={office.officeName}
                                    className="w-7 h-7 rounded-lg object-contain bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700 shrink-0"
                                  />
                                  <div className="min-w-0">
                                    <div className="text-xs font-black truncate">{office.officeName}</div>
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
                                      Code: {officeKey} • {office.totalUsers} Users
                                    </div>
                                  </div>
                                </div>
                                <div
                                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                    isSelected
                                      ? 'border-emerald-500 bg-emerald-500 text-white'
                                      : 'border-slate-400 dark:border-slate-600'
                                  }`}
                                >
                                  {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="text-left relative pt-1">
                      <div className="relative">
                        <input
                          id="login-pin"
                          type="text"
                          style={{ WebkitTextSecurity: showPin ? 'none' : 'disc' }}
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={passwordInput}
                          onChange={(e) => {
                            setPasswordInput(e.target.value.replace(/[^0-9]/g, ''));
                            setErrorMsg('');
                          }}
                          onKeyDown={(e) => {
                            if (
                              ['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                              e.ctrlKey || e.metaKey
                            ) {
                              return;
                            }
                            if (!/^[0-9]$/.test(e.key)) {
                              e.preventDefault();
                            }
                          }}
                          onPaste={(e) => {
                            e.preventDefault();
                            const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
                            if (pasted) {
                              setPasswordInput(pasted);
                              setErrorMsg('');
                            }
                          }}
                          onFocus={() => {
                            setIsPasswordFocused(true);
                            setIsUserIdFocused(false);
                          }}
                          onBlur={() => {
                            setIsPasswordFocused(false);
                          }}
                          className={`w-full bg-slate-50 dark:bg-slate-900 border rounded-xl px-3.5 py-3 pr-11 text-sm font-mono font-bold text-slate-900 dark:text-white outline-none transition-all duration-200 ${
                            isPasswordFocused
                              ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                              : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                          }`}
                          placeholder=""
                          autoComplete="current-password"
                        />
                        <label
                          htmlFor="login-pin"
                          className={`absolute left-3.5 pointer-events-none transition-all duration-200 ease-out select-none ${
                            isPinFloating
                              ? 'top-0 -translate-y-1/2 text-[10px] font-black uppercase tracking-wider px-1.5 bg-white dark:bg-slate-900 z-10 ' +
                                (isPasswordFocused ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')
                              : 'top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500 dark:text-slate-400 tracking-wider bg-transparent'
                          }`}
                        >
                          PIN
                        </label>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setShowPin(!showPin)}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer z-10"
                        >
                          {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                  </>
                );
              })()}

              <button
                type="submit"
                disabled={isLoading || !!successAirman}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold tracking-wide uppercase transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-lg disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-200" />
                    <span className="tracking-widest animate-pulse">VERIFYING PIN...</span>
                  </span>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    <span>
                      {isMasterUserTyped && selectedMasterOffice
                        ? `Login to ${selectedMasterOffice.officeName}`
                        : 'Login'}
                    </span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setRegisterSuccessBanner('');
                  setRegUnit('');
                  setRegBase('');
                  setRegCustomBase('');
                  setAvailableBases(getAvailableBases());
                  setRegSlogan('');
                  setRegBdNo('');
                  setRegRank('');
                  setRegName('');
                  setRegTrade('');
                  setRegCustomTrade('');
                  setAvailableTrades(getAvailableTrades());
                  setRegUserRole('');
                  setRegPin('');
                  setIsRegPinCustom(false);
                  setIsRegAddressOpen(false);
                  setRegLivingType('');
                  setRegMessType('');
                  setRegBlockNo('');
                  setRegLivingOutType('');
                  setRegSvcQtrNo('');
                  setRegOutsideBaseAddr('');
                  setRegContactNo('');
                  setFocusedRegField(null);
                  setRegisterStep(1);
                  setSubmittedRequestRecord(null);
                  setIsRegisterMode(true);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-black tracking-wider uppercase transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>Register a New Office</span>
              </button>

              <PWAInstallButton
                variant="login"
                officeName={displayedOfficeName}
                officeLogo={displayedOfficeLogo}
              />

              <div className="flex flex-col items-center space-y-2.5 mt-3">
                <button
                  type="button"
                  onClick={() => { setIsResetMode(true); setErrorMsg(''); }}
                  className="text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer underline"
                >
                  Forgot Login PIN?
                </button>
              </div>
            </form>
          ) : (
            /* PIN Reset Flow */
            <form onSubmit={handleNextStep} className="space-y-4 animate-fadeIn">
              {resetStep === 1 && (
                <div className="space-y-1.5 text-left">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Step 1: Enter User ID (User ID)</label>
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={resetBd}
                      onChange={(e) => setResetBd(e.target.value.replace(/[^0-9]/g, ''))}
                      onKeyDown={(e) => {
                        if (
                          ['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                          e.ctrlKey || e.metaKey
                        ) {
                          return;
                        }
                        if (!/^[0-9]$/.test(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
                        if (pasted) setResetBd(pasted);
                      }}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-all text-sm"
                      placeholder=""
                      required
                      autoFocus
                    />
                  </div>
                </div>
              )}

              {resetStep === 2 && (
                <div className="space-y-1.5 text-left">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Step 2: Enter Your Full Name</label>
                  <input
                    type="text"
                    value={resetName}
                    onChange={(e) => setResetName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-bold placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-all text-sm"
                    placeholder="e.g. Rasel"
                    required
                    autoFocus
                  />
                </div>
              )}

              {resetStep === 3 && (
                <div className="space-y-1.5 text-left">
                  <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Step 3: Enter Your Mobile Number</label>
                  <input
                    type="tel"
                    value={resetMobile}
                    onChange={(e) => setResetMobile(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-all text-sm"
                    placeholder="e.g. 01711223344"
                    required
                    autoFocus
                  />
                </div>
              )}

              {resetStep === 4 && (
                <div className="space-y-3.5 text-left">
                  <div className="space-y-1.5" ref={resetPinRef}>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Enter New PIN</label>
                    <input
                      type="text"
                      style={{ WebkitTextSecurity: 'disc' }}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={newPass}
                      onChange={(e) => { setNewPass(e.target.value.replace(/[^0-9]/g, '')); setErrorMsg(''); }}
                      onKeyDown={(e) => {
                        if (
                          ['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                          e.ctrlKey || e.metaKey
                        ) {
                          return;
                        }
                        if (!/^[0-9]$/.test(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
                        if (pasted) {
                          setNewPass(pasted);
                          setErrorMsg('');
                        }
                      }}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-all text-sm"
                      placeholder="Enter New PIN"
                      required
                    />
                  </div>
                  <div className="space-y-1.5" ref={confirmPinRef}>
                    <label className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">Confirm Your PIN</label>
                    <input
                      type="text"
                      style={{ WebkitTextSecurity: 'disc' }}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={confirmPass}
                      onChange={(e) => { setConfirmPass(e.target.value.replace(/[^0-9]/g, '')); setErrorMsg(''); }}
                      onKeyDown={(e) => {
                        if (
                          ['Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) ||
                          e.ctrlKey || e.metaKey
                        ) {
                          return;
                        }
                        if (!/^[0-9]$/.test(e.key)) {
                          e.preventDefault();
                        }
                      }}
                      onPaste={(e) => {
                        e.preventDefault();
                        const pasted = e.clipboardData.getData('text').replace(/[^0-9]/g, '');
                        if (pasted) {
                          setConfirmPass(pasted);
                          setErrorMsg('');
                        }
                      }}
                      className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-mono placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-all text-sm"
                      placeholder="Confirm New PIN"
                      required
                    />
                  </div>
                </div>
              )}

              <div className="flex space-x-2.5 pt-1">
                <button
                  type="button"
                  onClick={cancelReset}
                  className="flex-1 py-2.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-white rounded-xl font-bold transition-colors shadow-sm cursor-pointer text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-colors shadow-lg flex items-center justify-center space-x-1 cursor-pointer text-xs"
                >
                  <span>{resetStep === 4 ? 'Save PIN' : 'Next'}</span>
                  {resetStep < 4 && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Secret App Owner Master Portal Modal */}
      <AppOwnerMasterPortal
        isOpen={isMasterPortalOpen}
        onClose={() => {
          setIsMasterPortalOpen(false);
          loadOfficesAndPendingRequests();
          setDirectoryTick((t) => t + 1);
        }}
        airmen={airmen}
        onEnterOfficeAsMaster={onAuthenticated}
      />

      {/* In-App Software Update Modal on Login Screen - ONLY in APK */}
      {isRunningInApk() && (
        <AppUpdateModal
          isOpen={isUpdateModalOpen}
          onClose={() => setIsUpdateModalOpen(false)}
          latestVersion={updateAvailable}
          currentVersionCode={appVersionInfo.versionCode}
          currentVersionName={appVersionInfo.versionName}
        />
      )}
    </div>
  );
};



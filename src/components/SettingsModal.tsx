import { getAppConfig, saveAppConfig, AppConfig, getAppConfigHistory, addAppConfigHistory, AppConfigHistoryItem, updateAppConfigHistoryItemActiveStatus, deleteAppConfigHistoryItem, clearAppConfigHistory } from '../utils/appConfig';
import { Megaphone, Wrench, Clock, Trash2 as TrashIcon, Power, PowerOff } from 'lucide-react';

import React, { useState, useEffect } from 'react';
import {   
  X, 
  Settings, 
  KeyRound, 
  Download, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Lock,
  ChevronRight,
  ArrowLeft,
  Info,
  Image as ImageIcon,
  RotateCcw,
  History,
  Search,
  Trash2,
  ShieldCheck,
  Shield,
  Smartphone,
  Laptop,
  Globe,
  ExternalLink,
  Save,
  Activity,
  Flame,
  Check,
  Link2,
  Building2,
  Sun,
  Moon,
  Monitor,
  Palette,
} from 'lucide-react';
import { Logo155UASU } from './Logo155UASU';
import { PWAInstallButton } from './PWAInstallButton';
import { syncDynamicOfficePwaManifest } from '../utils/dynamicPwaManifest';
import { useGlobalTheme, THEME_STORAGE_KEY } from '../utils/themeManager';
import { UserManagementTab } from './UserManagementTab';
import { UserRole, DetailedUserLogin, UserLoginStatus, UserLoginRole, Rank, FlightName } from '../types';
import { getCustomDuties, saveCustomDuties, addCustomDuty, removeCustomDuty, CustomDutyConfig } from '../utils/customDuties';
import { subscribeToActiveUsers, subscribeToLoginHistory, refreshLoginHistoryFromCloud, refreshPresenceNow } from '../services/presenceService';
import { getLoginHistory, clearLoginHistory, recordLoginLog, UserLoginLog, getDetailedUsers, toggleUserLoginStatus, saveDetailedUsers, changeUserPassword, changeAdminPassword, changeUserRole, getCurrentUserSession, isMasterPinMatch, isMasterProtectedUser } from '../utils/authSession';
import { localDb } from '../services/localDatabase';
import {
  getActiveOfficeIdentity,
  getActiveOfficeCode,
  isDefault155UasuOffice,
  updateActiveOfficeProfile,
  OFFICE_PROFILE_STORAGE_KEY,
  getMasterCredentials,
  getMasterUserId,
  saveMasterCredentials,
} from '../firebase';

import { CustomDutiesTab } from './CustomDutiesTab';
import {
  checkForAppUpdate,
  fetchLatestAppVersion,
  getCurrentAppVersion,
  downloadAppUpdate,
  publishNewAppVersion,
  AppVersionRecord,
  DEFAULT_CURRENT_APP,
  isRunningInApk,
} from '../services/appUpdateService';
import { formatRank, formatAirmanName } from '../utils/rankFormatter';
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  role: UserRole;
  userFlight?: string;
  nominalAirmen: any[];
  onOpenAdminLogin: () => void;
  
  onOpenUserManagement?: () => void;
  onRosterUpdated?: () => void;
}

type SettingSection =
  | 'officeProfile'
  | 'appTheme'
  | 'appUpdate'
  | 'users'
  | 'security'
  | 'history'
  | 'appManagement'
  | 'appNotice'
  | 'maintenanceMode';

export 
const Countdown = ({ endTime }: { endTime: string }) => {
  const [timeLeft, setTimeLeft] = React.useState('');
  
  React.useEffect(() => {
    if (!endTime) return;
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(endTime).getTime();
      const distance = end - now;
      
      if (distance < 0) {
        setTimeLeft('Expired');
        clearInterval(interval);
        return;
      }
      
      const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);
      
      setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
    }, 1000);


  return () => clearInterval(interval);
  }, [endTime]);

  return <span className="ml-2 font-mono bg-emerald-200 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded text-[10px] text-emerald-800 dark:text-emerald-300">Remaining: {timeLeft || '...'}</span>;
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  nominalAirmen,
  onOpenUserManagement,
  isOpen,
  onClose,
  role,
  userFlight,
  onOpenAdminLogin,
  onRosterUpdated,
}) => {
  const { themePreference, setThemePreference } = useGlobalTheme();
  const [activeSection, setActiveSection] = useState<SettingSection | null>(null);
  const [appManagementTab, setAppManagementTab] = useState<'notice' | 'maintenance'>('notice');

  // Office Profile State
  const initialIdentity = getActiveOfficeIdentity();
  const [profileUnitName, setProfileUnitName] = useState(initialIdentity.officeName);
  const [profileLogo, setProfileLogo] = useState(initialIdentity.officeLogo);
  const [profileSlogan, setProfileSlogan] = useState(initialIdentity.officeSlogan);
  const [profileBase, setProfileBase] = useState(initialIdentity.officeBase);
  const [profileSavedMsg, setProfileSavedMsg] = useState('');
  const [profileLogoError, setProfileLogoError] = useState('');
  const profileLogoFileRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const id = getActiveOfficeIdentity();
      setProfileUnitName(id.officeName);
      setProfileLogo(id.officeLogo);
      setProfileSlogan(id.officeSlogan);
      setProfileBase(id.officeBase);
      setProfileSavedMsg('');
      setProfileLogoError('');
    }
  }, [isOpen]);

  const triggerRealtimePwaLogoSync = (nextLogo: string) => {
    const cleanLogo = String(nextLogo || '').trim() || '/baf-logo.png';
    const currentId = getActiveOfficeIdentity();
    void syncDynamicOfficePwaManifest({
      officeName: profileUnitName.trim() || currentId.officeName || '155 UASU BAF',
      officeLogo: cleanLogo,
      officeCode: currentId.officeCode,
      officeSlogan: profileSlogan.trim() || currentId.officeSlogan,
      officeBase: profileBase.trim() || currentId.officeBase || 'BAF BASE ZHR',
    });
  };

  const handleProfileLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setProfileLogoError('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileLogoError('Please select a valid image file (PNG, JPG, WebP, SVG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 512;
          let width = img.width;
          let height = img.height;
          if (width > height && width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          const finalLogo = ctx
            ? (() => {
                ctx.clearRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                return canvas.toDataURL('image/png', 0.9);
              })()
            : dataUrl;
          setProfileLogo(finalLogo);
          triggerRealtimePwaLogoSync(finalLogo);
        } catch {
          setProfileLogo(dataUrl);
          triggerRealtimePwaLogoSync(dataUrl);
        }
      };
      img.onerror = () => {
        setProfileLogo(dataUrl);
        triggerRealtimePwaLogoSync(dataUrl);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    // Reset input so re-selecting the same filename triggers onChange
    e.target.value = '';
  };

  const handleSaveOfficeProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const currentId = getActiveOfficeIdentity();
    const saved = updateActiveOfficeProfile({
      officeName: profileUnitName.trim() || currentId.officeName || '155 UASU BAF',
      officeLogo: profileLogo.trim() || '/baf-logo.png',
      officeSlogan: profileSlogan.trim(),
      officeBase: profileBase.trim() || 'BAF BASE ZHR',
    });
    setProfileUnitName(saved.officeName);
    setProfileLogo(saved.officeLogo);
    setProfileSlogan(saved.officeSlogan);
    setProfileBase(saved.officeBase);
    localDb.syncSettingToCloud(OFFICE_PROFILE_STORAGE_KEY, JSON.stringify(saved));
    void syncDynamicOfficePwaManifest({
      officeName: saved.officeName,
      officeLogo: saved.officeLogo,
      officeCode: currentId.officeCode,
      officeSlogan: saved.officeSlogan,
      officeBase: saved.officeBase,
    });
    setProfileSavedMsg('Office Profile & PWA Logo updated in realtime across all views, browser tab, headers, reports & exports!');
    if (onRosterUpdated) {
      onRosterUpdated();
    }
    setTimeout(() => setProfileSavedMsg(''), 5000);
  };

  // Security Tab State
  const [adminCurrentPasscode, setAdminCurrentPasscode] = useState('');
  const [adminNewPasscode, setAdminNewPasscode] = useState('');
  const [adminConfirmPasscode, setAdminConfirmPasscode] = useState('');
  const [adminPasscodeError, setAdminPasscodeError] = useState('');
  const [adminPasscodeSuccess, setAdminPasscodeSuccess] = useState('');
  const [isUpdatingAdminPasscode, setIsUpdatingAdminPasscode] = useState(false);
  const [currentPasscode, setCurrentPasscode] = useState('');
  const [newPasscode, setNewPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [passcodeSuccess, setPasscodeSuccess] = useState('');
  const [isUpdatingPasscode, setIsUpdatingPasscode] = useState(false);

  const isAdminRole =
    role === 'SUPER_ADMIN' ||
    role === 'OWNER' ||
    role === 'master_owner' ||
    role === 'ADMIN';

  // Login History State
  const [loginHistory, setLoginHistory] = useState<UserLoginLog[]>([]);
  
    const [appConfig, setAppConfig] = useState<AppConfig>(getAppConfig());
  const [appConfigHistory, setAppConfigHistory] = useState<AppConfigHistoryItem[]>([]);
  
  // Draft states for forms
  const formatDateForInput = (date: Date) => {
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  };
  
  const [noticeDraft, setNoticeDraft] = useState({
    heading: '',
    message: '',
    isScheduled: false,
    startTime: formatDateForInput(new Date()),
    endTime: ''
  });
  
  const [maintDraft, setMaintDraft] = useState({
    message: '',
    isScheduled: false,
    startTime: formatDateForInput(new Date()),
    endTime: ''
  });
  
  useEffect(() => {
    setAppConfigHistory(getAppConfigHistory());
  }, []);
  
  const applyTimePreset = (setter: any, currentDraft: any, minutes: number) => {
    const start = new Date();
    const end = new Date(start.getTime() + minutes * 60000);
    setter({
      ...currentDraft,
      isScheduled: true,
      startTime: formatDateForInput(start),
      endTime: formatDateForInput(end)
    });
  };
  
  const handleSaveNotice = () => {
    const updatedConfig = {
      ...appConfig,
      notice: {
        isActive: true,
        heading: noticeDraft.heading || 'Important Notice',
        message: noticeDraft.message,
        isScheduled: noticeDraft.isScheduled,
        startTime: noticeDraft.isScheduled ? noticeDraft.startTime : undefined,
        endTime: noticeDraft.isScheduled ? noticeDraft.endTime : undefined,
      }
    };
    saveAppConfig(updatedConfig);
    setAppConfig(updatedConfig);
    localStorage.removeItem('baf_dismissed_notice_sig');
    
    const history = addAppConfigHistory({
      type: 'NOTICE',
      heading: noticeDraft.heading || 'Important Notice',
      message: noticeDraft.message,
      startTime: noticeDraft.isScheduled ? noticeDraft.startTime : undefined,
      endTime: noticeDraft.isScheduled ? noticeDraft.endTime : undefined,
      isActive: true
    });
    setAppConfigHistory(history);
    
    // Reset draft
    setNoticeDraft({
      heading: '',
      message: '',
      isScheduled: false,
      startTime: formatDateForInput(new Date()),
      endTime: ''
    });
  };
  
  const handleSaveMaintenance = () => {
    const updatedConfig = {
      ...appConfig,
      maintenance: {
        isActive: true,
        message: maintDraft.message,
        isScheduled: maintDraft.isScheduled,
        startTime: maintDraft.isScheduled ? maintDraft.startTime : undefined,
        endTime: maintDraft.isScheduled ? maintDraft.endTime : undefined,
      }
    };
    saveAppConfig(updatedConfig);
    setAppConfig(updatedConfig);
    
    const history = addAppConfigHistory({
      type: 'MAINTENANCE',
      message: maintDraft.message,
      startTime: maintDraft.isScheduled ? maintDraft.startTime : undefined,
      endTime: maintDraft.isScheduled ? maintDraft.endTime : undefined,
      isActive: true
    });
    setAppConfigHistory(history);
    
    // Reset draft
    setMaintDraft({
      message: '',
      isScheduled: false,
      startTime: formatDateForInput(new Date()),
      endTime: ''
    });
  };
  
  const handleStopFeature = (type: 'NOTICE' | 'MAINTENANCE', historyId: string) => {
    if (type === 'NOTICE') {
      const updatedConfig = { ...appConfig, notice: { ...appConfig.notice, isActive: false } };
      saveAppConfig(updatedConfig);
      setAppConfig(updatedConfig);
    } else {
      const updatedConfig = { ...appConfig, maintenance: { ...appConfig.maintenance, isActive: false } };
      saveAppConfig(updatedConfig);
      setAppConfig(updatedConfig);
    }
    const history = updateAppConfigHistoryItemActiveStatus(historyId, false);
    setAppConfigHistory(history);
  };
  
  const confirmDeleteHistory = (id: string) => {
    const itemToDelete = appConfigHistory.find(item => item.id === id);
    if (itemToDelete) {
      if (itemToDelete.type === 'NOTICE' && appConfig.notice.isActive && appConfig.notice.message === itemToDelete.message) {
         const updatedConfig = { ...appConfig, notice: { ...appConfig.notice, isActive: false } };
         saveAppConfig(updatedConfig);
         setAppConfig(updatedConfig);
      }
      if (itemToDelete.type === 'MAINTENANCE' && appConfig.maintenance.isActive && appConfig.maintenance.message === itemToDelete.message) {
         const updatedConfig = { ...appConfig, maintenance: { ...appConfig.maintenance, isActive: false } };
         saveAppConfig(updatedConfig);
         setAppConfig(updatedConfig);
      }
    }
    const history = deleteAppConfigHistoryItem(id);
    setAppConfigHistory(history);
  };
  

  
  const [historySearch, setHistorySearch] = useState<string>('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [clearAllConfirmType, setClearAllConfirmType] = useState<'NOTICE' | 'MAINTENANCE' | null>(null);
  const [activeUsers, setActiveUsers] = useState<any[]>([]);
  const [realtimeHistory, setRealtimeHistory] = useState<any[]>([]);
  const [selectedHistoryUser, setSelectedHistoryUser] = useState<any>(null);

  // Detailed Users State
  const [detailedUsersList, setDetailedUsersList] = useState<DetailedUserLogin[]>([]);
  const [userSearch, setUserSearch] = useState<string>('');
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState<string>('');

  // Security credential editing state
  const [editingPasswordType, setEditingPasswordType] = useState<'portal' | 'admin' | 'master' | null>(null);
  const [masterIdDraft, setMasterIdDraft] = useState<string>(() => getMasterUserId());
  const [masterCurrentPin, setMasterCurrentPin] = useState<string>('');
  const [masterNewPin, setMasterNewPin] = useState<string>('');
  const [masterConfirmPin, setMasterConfirmPin] = useState<string>('');
  const [masterCredError, setMasterCredError] = useState<string>('');
  const [masterCredSuccess, setMasterCredSuccess] = useState<string>('');
  const [isUpdatingMasterCreds, setIsUpdatingMasterCreds] = useState<boolean>(false);

  const handleUpdateMasterCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setMasterCredError('');
    setMasterCredSuccess('');
    const creds = getMasterCredentials();
    const cleanNewId = masterIdDraft.replace(/^BD\/?/i, '').replace(/\s+/g, '').trim();
    if (!cleanNewId) {
      setMasterCredError('Master User ID cannot be empty.');
      return;
    }
    if (!masterCurrentPin.trim()) {
      setMasterCredError('Please enter your Current Master PIN.');
      return;
    }
    if (!isMasterPinMatch(masterCurrentPin.trim()) && masterCurrentPin.trim() !== creds.masterPin) {
      setMasterCredError('Current Master PIN is incorrect.');
      return;
    }
    const finalPin = masterNewPin.trim() ? masterNewPin.trim() : creds.masterPin;
    if (masterNewPin.trim()) {
      if (masterNewPin.trim().length < 4) {
        setMasterCredError('New Master PIN must be at least 4 characters.');
        return;
      }
      if (masterNewPin.trim() !== masterConfirmPin.trim()) {
        setMasterCredError('New Master PIN and Confirm PIN do not match.');
        return;
      }
    }
    setIsUpdatingMasterCreds(true);
    try {
      const saved = await saveMasterCredentials(cleanNewId, finalPin);
      setMasterIdDraft(saved.masterUserId);
      setMasterCurrentPin('');
      setMasterNewPin('');
      setMasterConfirmPin('');
      setMasterCredSuccess(`Master ID (${saved.masterUserId}) & PIN updated!`);
    } catch {
      setMasterCredError('Failed to update Master ID & PIN.');
    } finally {
      setIsUpdatingMasterCreds(false);
    }
  };

  // Auto-disappear any success messages after 5 seconds (5000ms)
  useEffect(() => {
    if (!masterCredSuccess && !passcodeSuccess && !adminPasscodeSuccess && !profileSavedMsg) return;
    const t = setTimeout(() => {
      if (masterCredSuccess) setMasterCredSuccess('');
      if (passcodeSuccess) setPasscodeSuccess('');
      if (adminPasscodeSuccess) setAdminPasscodeSuccess('');
      if (profileSavedMsg) setProfileSavedMsg('');
    }, 5000);
    return () => clearTimeout(t);
  }, [masterCredSuccess, passcodeSuccess, adminPasscodeSuccess, profileSavedMsg]);

  // In-App Software Update State (Capacitor + Supabase)
  const [currentAppVersion, setCurrentAppVersion] = useState<{ versionCode: number; versionName: string }>(DEFAULT_CURRENT_APP);
  const [latestRemoteVersion, setLatestRemoteVersion] = useState<AppVersionRecord | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [updateStatusMessage, setUpdateStatusMessage] = useState<string>('');
  
  // Publish new version draft (Admin)
  const [publishDraft, setPublishDraft] = useState({
    version_code: '',
    version_name: '',
    apk_url: '',
    release_notes: '',
  });
  const [isPublishingVersion, setIsPublishingVersion] = useState(false);
  const [publishMessage, setPublishMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadAppUpdateInfo = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatusMessage('Supabase app_versions টেবিল থেকে চেক করা হচ্ছে...');
    try {
      const cur = await getCurrentAppVersion();
      setCurrentAppVersion(cur);
      const res = await checkForAppUpdate({ ignoreSkipped: true });
      setLatestRemoteVersion(res.latestVersion);
      if (res.hasUpdate && res.latestVersion) {
        setUpdateStatusMessage(`নতুন আপডেট উপলব্ধ: v${res.latestVersion.version_name} (Build ${res.latestVersion.version_code})`);
      } else {
        setUpdateStatusMessage(`আপনার অ্যাপটি আপ-টু-ডেট আছে (v${cur.versionName}, Build ${cur.versionCode})`);
      }
    } catch (err: any) {
      setUpdateStatusMessage('আপডেট চেক ব্যর্থ হয়েছে: ' + (err.message || 'ত্রুটি'));
    } finally {
      setIsCheckingUpdate(false);
    }
  };


  const handlePublishVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    setPublishMessage(null);
    const vCode = parseInt(publishDraft.version_code, 10);
    if (isNaN(vCode) || vCode <= 0) {
      setPublishMessage({ type: 'error', text: 'একটি সঠিক সংখ্যার Version Code লিখুন (যেমন: 2)' });
      return;
    }
    if (!publishDraft.version_name.trim()) {
      setPublishMessage({ type: 'error', text: 'Version Name লিখুন (যেমন: 1.0.1)' });
      return;
    }
    if (!publishDraft.apk_url.trim()) {
      setPublishMessage({ type: 'error', text: 'APK Download URL প্রদান করুন' });
      return;
    }

    setIsPublishingVersion(true);
    try {
      const res = await publishNewAppVersion({
        version_code: vCode,
        version_name: publishDraft.version_name.trim(),
        apk_url: publishDraft.apk_url.trim(),
        release_notes: publishDraft.release_notes.trim() || undefined,
      });

      if (res.success) {
        setPublishMessage({ type: 'success', text: `সাফল্যের সাথে v${publishDraft.version_name} (Code ${vCode}) প্রকাশ করা হয়েছে!` });
        setPublishDraft({ version_code: '', version_name: '', apk_url: '', release_notes: '' });
        await loadAppUpdateInfo();
      } else {
        setPublishMessage({ type: 'error', text: res.error || 'পাবলিশ ব্যর্থ হয়েছে' });
      }
    } catch (err: any) {
      setPublishMessage({ type: 'error', text: err?.message || 'ত্রুটি হয়েছে' });
    } finally {
      setIsPublishingVersion(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const unsubUsers = subscribeToActiveUsers((users) => {
      setActiveUsers(users);
    });
    return () => {
      unsubUsers();
    };
  }, [isOpen, role]);

  useEffect(() => {
    if (!isOpen || activeSection !== 'history') return;
    const unsubHistory = subscribeToLoginHistory((logs) => {
      setRealtimeHistory(logs);
      setLoginHistory(logs);
    });
    refreshPresenceNow().then((users) => {
      setActiveUsers(users);
    }).catch(() => {});
    refreshLoginHistoryFromCloud(true).then((logs) => {
      setRealtimeHistory(logs);
      setLoginHistory(logs);
    }).catch(() => {});
    return () => {
      unsubHistory();
    };
  }, [isOpen, activeSection]);

  useEffect(() => {
    if (isOpen) {
      setPasscodeError('');
      setPasscodeSuccess('');
      setCurrentPasscode('');
      setNewPasscode('');
      setConfirmPasscode('');

      let logs = getLoginHistory();
      if (logs.length === 0) {
        const session = getCurrentUserSession();
        if (session && !isMasterProtectedUser(session.bdNo, session.systemRole || session.assignedRole, session.isProtected)) {
          recordLoginLog({
            id: session.airmanId,
            bdNo: session.bdNo,
            rank: session.rank,
            name: session.name,
            flightName: session.flightName,
            trade: session.trade
          } as any, session.assignedRole || session.systemRole || 'USER');
          logs = getLoginHistory();
        }
      }
      setLoginHistory(logs);
      setRealtimeHistory(logs);
      setDetailedUsersList(getDetailedUsers());
      setActiveSection(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (activeSection === 'history') {
      let logs = getLoginHistory();
      if (logs.length === 0) {
        const session = getCurrentUserSession();
        if (session && !isMasterProtectedUser(session.bdNo, session.systemRole || session.assignedRole, session.isProtected)) {
          recordLoginLog({
            id: session.airmanId,
            bdNo: session.bdNo,
            rank: session.rank,
            name: session.name,
            flightName: session.flightName,
            trade: session.trade
          } as any, session.assignedRole || session.systemRole || 'USER');
          logs = getLoginHistory();
        }
      }
      setLoginHistory(logs);
      setRealtimeHistory(logs);
    }
  }, [activeSection]);

  const handleUpdateAdminPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminPasscodeError('');
    setAdminPasscodeSuccess('');

    if (!adminCurrentPasscode) {
      setAdminPasscodeError('Please enter your current admin password.');
      return;
    }
    if (!adminNewPasscode) {
      setAdminPasscodeError('Please enter a new admin password.');
      return;
    }
    if (adminNewPasscode !== adminConfirmPasscode) {
      setAdminPasscodeError('New admin password and confirm password do not match.');
      return;
    }

    setIsUpdatingAdminPasscode(true);
    try {
      const session = getCurrentUserSession();
      if (!session) {
        setAdminPasscodeError('You are not logged in.');
        return;
      }
      
      const res = changeAdminPassword(session.bdNo, adminCurrentPasscode, adminNewPasscode, false);
      
      if (res.success) {
        setAdminPasscodeSuccess('Admin PIN successfully updated!');
        setAdminCurrentPasscode('');
        setAdminNewPasscode('');
        setAdminConfirmPasscode('');
        setTimeout(() => {
          onClose(); // Auto-close on success
        }, 1000);
      } else {
        setAdminPasscodeError(res.message);
      }
    } catch (err: any) {
      setAdminPasscodeError('Error updating admin password.');
    } finally {
      setIsUpdatingAdminPasscode(false);
    }
  };

  const handleUpdatePasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasscodeError('');
    setPasscodeSuccess('');

    if (!currentPasscode) {
      setPasscodeError('Please enter your current password.');
      return;
    }
    if (!newPasscode) {
      setPasscodeError('Please enter a new password.');
      return;
    }
    if (newPasscode !== confirmPasscode) {
      setPasscodeError('New password and confirm password do not match.');
      return;
    }

    setIsUpdatingPasscode(true);
    try {
      const session = getCurrentUserSession();
      if (!session) {
        setPasscodeError('You are not logged in.');
        return;
      }
      
      const res = changeUserPassword(session.bdNo, currentPasscode, newPasscode, false);
      
      if (res.success) {
        setPasscodeSuccess('Password successfully updated!');
        setCurrentPasscode('');
        setNewPasscode('');
        setConfirmPasscode('');
        setTimeout(() => {
          onClose();
        }, 1000);
      } else {
        setPasscodeError(res.message);
      }
    } catch (err: any) {
      setPasscodeError('Error updating password.');
    } finally {
      setIsUpdatingPasscode(false);
    }
  };


  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (deleteConfirmId || clearAllConfirmType) return;
      if (activeSection) {
        setActiveSection(null);
      } else {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeSection, deleteConfirmId, clearAllConfirmType, onClose]);

  if (!isOpen) return null;

  const sections: Array<{
    id: SettingSection;
    label: string;
    description: string;
    icon: React.ReactNode;
    color: string;
  }> = [
    {
      id: 'officeProfile',
      label: 'Office Profile',
      description: 'Unit name, crest logo, slogan & base details',
      icon: <Building2 className="w-5 h-5" />,
      color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/80 dark:text-emerald-400',
    },
    {
      id: 'appTheme',
      label: 'App Theme',
      description: 'Switch between System, Light & Dark appearance',
      icon: <Palette className="w-5 h-5" />,
      color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-950/80 dark:text-indigo-400',
    },
    ...(isRunningInApk()
      ? [{
          id: 'appUpdate' as SettingSection,
          label: 'In-App Update (APK)',
          description: 'Check & install the latest Android app build',
          icon: <Download className="w-5 h-5" />,
          color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/80 dark:text-emerald-400',
        }]
      : []),
    ...(isAdminRole
      ? [{
          id: 'appNotice' as SettingSection,
          label: 'App Notice',
          description: 'Publish live broadcast notices or maintenance alerts',
          icon: <Megaphone className="w-5 h-5" />,
          color: 'text-orange-600 bg-orange-100 dark:bg-orange-950/80 dark:text-orange-400',
        }]
      : []),
    ...(isAdminRole
      ? [{
          id: 'users' as SettingSection,
          label: 'User Management',
          description: 'Manage accounts, roles, permissions & PIN resets',
          icon: <ShieldCheck className="w-5 h-5" />,
          color: 'text-purple-600 bg-purple-100 dark:bg-purple-950/80 dark:text-purple-400',
        }]
      : []),
    {
      id: 'security',
      label: 'Security & Passcode',
      description: 'Update your login PIN and account security controls',
      icon: <Lock className="w-5 h-5" />,
      color: 'text-amber-600 bg-amber-100 dark:bg-amber-950/80 dark:text-amber-400',
    },
    ...(isAdminRole
      ? [{
          id: 'history' as SettingSection,
          label: 'Login History',
          description: 'Active sessions and recent user login activity logs',
          icon: <History className="w-5 h-5" />,
          color: 'text-sky-600 bg-sky-100 dark:bg-sky-950/80 dark:text-sky-400',
        }]
      : []),
  ];

  const displayedSection = activeSection;
  const activeSectionMeta = activeSection ? sections.find(s => s.id === activeSection) : null;

  const handleDeleteHistoryItem = (item: any) => {
    const updated = appConfigHistory.filter(h => h.id !== item.id);
    setAppConfigHistory(updated);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-md p-0 sm:p-8">
      {/* Two-step Single-Surface Settings Container (Options Hub -> Dedicated Option Interface) */}
      <div className="w-full max-w-4xl h-full sm:h-[85vh] bg-white dark:bg-[#1e293b] border-0 sm:border border-slate-200 dark:border-slate-700 sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden relative">
        {!activeSection ? (
          /* Step 1: Settings Options Hub */
          <div className="flex-1 w-full h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
            <div className="flex items-center justify-between px-5 sm:px-8 py-4 sm:py-5 border-b border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#1e293b] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Settings className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white leading-tight">
                    Settings
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {profileUnitName ? `${profileUnitName} • Choose an option to configure` : 'Choose an option to configure'}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer shrink-0"
                title="Close Settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 sm:p-7">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-3xl mx-auto">
                {sections.map(sec => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      if (sec.id === 'users' && onOpenUserManagement) {
                        onOpenUserManagement();
                      } else {
                        setActiveSection(sec.id);
                      }
                    }}
                    className="group w-full flex items-center gap-4 p-4 rounded-2xl bg-white dark:bg-[#1e293b] hover:bg-slate-50 dark:hover:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/70 hover:border-emerald-400/70 dark:hover:border-emerald-500/50 shadow-sm hover:shadow-md transition-all duration-150 cursor-pointer text-left active:scale-[0.99] touch-manipulation"
                  >
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${sec.color}`}>
                      {sec.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm sm:text-[15px] font-bold text-slate-900 dark:text-white truncate group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {sec.label}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                        {sec.description}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 group-hover:translate-x-0.5 transition-all shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Step 2: Dedicated Full-Width Interface for the Selected Option */
          <div className="flex-1 w-full h-full bg-white dark:bg-[#1e293b] flex flex-col relative overflow-hidden">
            {/* Header with always-visible Back button */}
            <div className="flex items-center justify-between gap-3 px-4 sm:px-7 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-700/60 bg-white dark:bg-[#1e293b] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setActiveSection(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold text-xs sm:text-sm transition-colors cursor-pointer shrink-0 active:scale-[0.98]"
                  title="Back to Settings options"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>Back</span>
                </button>
                <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 shrink-0 hidden sm:block" />
                {activeSectionMeta && (
                  <div className={`w-9 h-9 rounded-xl hidden sm:flex items-center justify-center shrink-0 ${activeSectionMeta.color}`}>
                    {activeSectionMeta.icon}
                  </div>
                )}
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate leading-tight">
                    {activeSectionMeta?.label || 'Settings'}
                  </h3>
                  {activeSectionMeta?.description && (
                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                      {activeSectionMeta.description}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer shrink-0"
                title="Close Settings"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

          {/* Main Content Area */}
          <div className="flex-1 h-full overflow-hidden flex flex-col bg-white dark:bg-[#1e293b]">
            {activeSection !== 'users' ? (
              <div className="flex-1 overflow-y-auto p-6 sm:p-8">
                <div className="max-w-3xl mx-auto space-y-8">
                  {/* App Theme Section */}
                  {displayedSection === 'appTheme' && (
                    <div className="space-y-6 animate-fadeIn">
                      <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl p-6 space-y-5">
                        <div className="flex items-center gap-3">
                          <div className="w-11 h-11 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
                            <Palette className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-slate-900 dark:text-white">
                              Appearance & Theme Mode
                            </h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Default is System theme. Any manual change is automatically saved to your Local Cloud.
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-2">
                          {(
                            [
                              {
                                id: 'system',
                                label: 'System (Default)',
                                subtitle: 'Matches device light/dark mode automatically',
                                icon: Monitor,
                              },
                              {
                                id: 'dark',
                                label: 'Dark Mode',
                                subtitle: 'Deep slate appearance for low-light environments',
                                icon: Moon,
                              },
                              {
                                id: 'light',
                                label: 'Light Mode',
                                subtitle: 'Crisp high-contrast daylight appearance',
                                icon: Sun,
                              },
                            ] as const
                          ).map((opt) => {
                            const Icon = opt.icon;
                            const isSelected = themePreference === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                onClick={() => {
                                  setThemePreference(opt.id);
                                  try {
                                    localDb.syncSettingToCloud(THEME_STORAGE_KEY, opt.id);
                                  } catch {}
                                }}
                                className={`flex flex-col items-start gap-3 p-4 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                                  isSelected
                                    ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30 shadow-md shadow-emerald-500/10'
                                    : 'border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-600'
                                }`}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <div
                                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                      isSelected
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    <Icon className="w-5 h-5" />
                                  </div>
                                  {isSelected && (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                      <Check className="w-3 h-3" /> Active
                                    </span>
                                  )}
                                </div>
                                <div>
                                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                                    {opt.label}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                                    {opt.subtitle}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Office Profile Section */}
                  {displayedSection === 'officeProfile' && (
                    <form onSubmit={handleSaveOfficeProfile} className="space-y-6 animate-fadeIn">
                      <PWAInstallButton
                        variant="settings"
                        officeName={profileUnitName}
                        officeLogo={profileLogo}
                      />
                      {/* Live Identity Preview Card */}
                      <div className="bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 border border-slate-700/80 rounded-2xl p-6 text-white shadow-xl">
                        <div className="flex flex-col sm:flex-row items-center gap-5">
                          <div className="w-20 h-20 rounded-2xl bg-slate-800/90 border border-emerald-500/40 p-2 flex items-center justify-center shrink-0 shadow-lg">
                            <img
                              src={profileLogo || '/baf-logo.png'}
                              alt="Office Crest"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = '/baf-logo.png';
                              }}
                              className="w-full h-full object-contain rounded-xl"
                            />
                          </div>
                          <div className="text-center sm:text-left flex-1 min-w-0">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-black uppercase tracking-widest mb-1.5">
                              <Building2 className="w-3 h-3" />
                              <span>{profileBase || 'BAF BASE ZHR'}</span>
                            </div>
                            <h4 className="text-xl sm:text-2xl font-black tracking-tight text-white truncate">
                              {profileUnitName || '155 UASU BAF'}
                            </h4>
                            {profileSlogan.trim() ? (
                              <p className="text-xs font-semibold text-emerald-400 tracking-wider uppercase mt-0.5">
                                {profileSlogan}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {profileSavedMsg && (
                        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center gap-2.5">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>{profileSavedMsg}</span>
                        </div>
                      )}

                      <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* UNIT / SQN */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider block">
                              UNIT / SQN Name *
                            </label>
                            <input
                              type="text"
                              value={profileUnitName}
                              onChange={(e) => setProfileUnitName(e.target.value)}
                              placeholder="e.g. 155 UASU BAF"
                              disabled={!isAdminRole}
                              required
                              className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                            />
                            <p className="text-[11px] text-slate-500 dark:text-slate-400">
                              Updates unit name across Sidebar, Login, Parade State, Night Count, Roster & Print/DOCX exports.
                            </p>
                          </div>

                          {/* Base */}
                          <div className="space-y-1.5">
                            <label className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider block">
                              Base Name *
                            </label>
                            <input
                              type="text"
                              value={profileBase}
                              onChange={(e) => setProfileBase(e.target.value)}
                              placeholder="e.g. BAF BASE ZHR"
                              disabled={!isAdminRole}
                              required
                              className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                            />
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {['BAF BASE ZHR', 'BAF BASE BSR', 'BAF BASE AKR', 'BAF BASE MTR', 'BAF BASE PKP', 'BAF BASE CXB', 'AIR HQ'].map((b) => (
                                <button
                                  key={b}
                                  type="button"
                                  disabled={!isAdminRole}
                                  onClick={() => setProfileBase(b)}
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-colors cursor-pointer disabled:opacity-50 ${
                                    profileBase.trim().toUpperCase() === b
                                      ? 'bg-emerald-600 text-white border-emerald-500'
                                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-emerald-500/50'
                                  }`}
                                >
                                  {b}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Slogan */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider block">
                            Unit Slogan / Motto
                          </label>
                          <input
                            type="text"
                            value={profileSlogan}
                            onChange={(e) => setProfileSlogan(e.target.value)}
                            placeholder="e.g. Intel • Surveillance • Strike"
                            disabled={!isAdminRole}
                            className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                          />
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Displayed under the unit name in the Sidebar, Navbar, and Login/Register portals.
                          </p>
                        </div>

                        {/* Logo */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider block">
                            Office Logo / Unit Crest
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2.5">
                            <input
                              type="text"
                              value={profileLogo}
                              onChange={(e) => {
                                const val = e.target.value;
                                setProfileLogo(val);
                                if (val.trim().startsWith('/') || val.trim().startsWith('http') || val.trim().startsWith('data:image/')) {
                                  triggerRealtimePwaLogoSync(val.trim());
                                }
                              }}
                              placeholder="Upload image or paste Logo URL"
                              disabled={!isAdminRole}
                              className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-emerald-500 disabled:opacity-60"
                            />
                            <input
                              ref={profileLogoFileRef}
                              type="file"
                              accept="image/*"
                              onChange={handleProfileLogoUpload}
                              className="hidden"
                            />
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={!isAdminRole}
                                onClick={() => profileLogoFileRef.current?.click()}
                                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                              >
                                <Upload className="w-4 h-4" />
                                <span>Upload Logo</span>
                              </button>
                              <button
                                type="button"
                                disabled={!isAdminRole}
                                onClick={() => {
                                  setProfileLogo('/baf-logo.png');
                                  triggerRealtimePwaLogoSync('/baf-logo.png');
                                }}
                                className="px-3 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                                title="Reset to default Bangladesh Air Force logo"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Default</span>
                              </button>
                            </div>
                          </div>
                          {profileLogoError && (
                            <p className="text-xs text-red-500 font-semibold">{profileLogoError}</p>
                          )}
                        </div>

                        {isAdminRole ? (
                          <div className="pt-2 flex justify-end">
                            <button
                              type="submit"
                              className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer transition-all active:scale-95"
                            >
                              <Save className="w-4 h-4" />
                              <span>Save Office Profile</span>
                            </button>
                          </div>
                        ) : (
                          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-800 dark:text-amber-300 font-medium">
                            Only Office Admins can modify the Office Profile settings.
                          </div>
                        )}
                      </div>
                    </form>
                  )}

                  {/* In-App Software Update Section (Rendered ONLY in APK) */}
                  {displayedSection === 'appUpdate' && isRunningInApk() && (
                    <div className="space-y-6 animate-fadeIn">
                      {/* Top Header Card */}
                      <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div className="flex items-center space-x-3.5">
                            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0">
                              <Download className="w-6 h-6" />
                            </div>
                            <div>
                              <h4 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                <span>ইন-অ্যাপ সফটওয়্যার আপডেট</span>
                                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                                  Native APK Release
                                </span>
                              </h4>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                নতুন ভার্সন কোড চেক করে সরাসরি APK ফাইল ডাউনলোড ও আপডেট।
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={isCheckingUpdate}
                            onClick={loadAppUpdateInfo}
                            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-900/30 transition-all cursor-pointer self-start sm:self-auto disabled:opacity-50"
                          >
                            <RefreshCw className={`w-4 h-4 ${isCheckingUpdate ? 'animate-spin' : ''}`} />
                            <span>{isCheckingUpdate ? 'চেক হচ্ছে...' : 'আপডেট চেক করুন'}</span>
                          </button>
                        </div>

                        {/* Current Status Box */}
                        <div className="mt-5 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">বর্তমান অ্যাপ ভার্সন:</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-sm">
                              v{currentAppVersion.versionName} <span className="text-slate-400 font-normal">(version_code: {currentAppVersion.versionCode})</span>
                            </span>
                          </div>

                          <div className="text-left sm:text-right">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">লেটেস্ট রিলিজ:</span>
                            {latestRemoteVersion ? (
                              <span className="font-mono font-bold text-emerald-500 dark:text-emerald-400 text-sm">
                                v{latestRemoteVersion.version_name} (code: {latestRemoteVersion.version_code})
                              </span>
                            ) : (
                              <span className="text-slate-400 font-mono">চেক করা হয়নি</span>
                            )}
                          </div>
                        </div>

                        {updateStatusMessage && (
                          <div className="mt-3 text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                            <Info className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>{updateStatusMessage}</span>
                          </div>
                        )}
                      </div>

                      {/* Latest Available APK Card */}
                      {latestRemoteVersion && (
                        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
                          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                            <div className="flex items-center space-x-2">
                              <ShieldCheck className="w-5 h-5 text-emerald-500" />
                              <h5 className="font-bold text-sm text-slate-900 dark:text-white">
                                সফটওয়্যার রিলিজ রেকর্ড
                              </h5>
                            </div>
                            <span className="text-[10px] font-mono text-slate-400">
                              ID: #{latestRemoteVersion.id || 1}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] text-slate-400 uppercase font-bold block">Version Code</span>
                              <span className="font-mono font-black text-slate-800 dark:text-slate-100 text-sm">
                                {latestRemoteVersion.version_code}
                              </span>
                            </div>
                            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                              <span className="text-[10px] text-slate-400 uppercase font-bold block">Version Name</span>
                              <span className="font-mono font-black text-slate-800 dark:text-slate-100 text-sm">
                                v{latestRemoteVersion.version_name}
                              </span>
                            </div>
                          </div>

                          {latestRemoteVersion.release_notes && (
                            <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-1">
                              <span className="text-[10px] text-slate-400 uppercase font-bold block">রিলিজ নোটস:</span>
                              <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-line">
                                {latestRemoteVersion.release_notes}
                              </p>
                            </div>
                          )}

                          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <span className="text-[10px] text-slate-400 uppercase font-bold block">APK Download URL:</span>
                              <p className="font-mono text-xs text-indigo-500 truncate" title={latestRemoteVersion.apk_url}>
                                {latestRemoteVersion.apk_url}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() => downloadAppUpdate(latestRemoteVersion.apk_url)}
                              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer shrink-0"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Capacitor Browser দিয়ে ওপেন</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Admin Form: Publish New Version */}
                      {(role === 'SUPER_ADMIN' || role === 'OWNER' || role === 'ADMIN') && (
                        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4">
                          <div className="border-b border-slate-200 dark:border-slate-700 pb-3">
                            <h5 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                              <Upload className="w-4 h-4 text-emerald-500" />
                              <span>নতুন ভার্সন প্রকাশ করুন (Publish to app_versions)</span>
                            </h5>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                              নতুন APK তৈরি করার পর এখানে version_code ও apk_url দিয়ে সাবমিট করলেই সকল ইউজার আপডেট নোটিফিকেশন পাবে।
                            </p>
                          </div>

                          {publishMessage && (
                            <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                              publishMessage.type === 'success'
                                ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
                            }`}>
                              {publishMessage.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                              <span>{publishMessage.text}</span>
                            </div>
                          )}

                          <form onSubmit={handlePublishVersion} className="space-y-3 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                  Version Code * (সংখ্যা)
                                </label>
                                <input
                                  type="number"
                                  required
                                  min="1"
                                  value={publishDraft.version_code}
                                  onChange={(e) => setPublishDraft({ ...publishDraft, version_code: e.target.value })}
                                  placeholder="e.g. 2"
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                              </div>

                              <div>
                                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                  Version Name * (নাম)
                                </label>
                                <input
                                  type="text"
                                  required
                                  value={publishDraft.version_name}
                                  onChange={(e) => setPublishDraft({ ...publishDraft, version_name: e.target.value })}
                                  placeholder="e.g. 1.0.1"
                                  className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono font-bold outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                APK Download URL *
                              </label>
                              <input
                                type="url"
                                required
                                value={publishDraft.apk_url}
                                onChange={(e) => setPublishDraft({ ...publishDraft, apk_url: e.target.value })}
                                placeholder="https://example.com/app-release.apk"
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white font-mono outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>

                            <div>
                              <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                রিলিজ নোটস / পরিবর্তনসমূহ (ঐচ্ছিক)
                              </label>
                              <textarea
                                rows={3}
                                value={publishDraft.release_notes}
                                onChange={(e) => setPublishDraft({ ...publishDraft, release_notes: e.target.value })}
                                placeholder="• নতুন ডিউটি রোটেশন ফিচার যুক্ত করা হয়েছে&#10;• নিরাপত্তা ত্রুটি সমাধান করা হয়েছে"
                                className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-2 text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={isPublishingVersion}
                              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                            >
                              <Upload className="w-4 h-4" />
                              <span>{isPublishingVersion ? 'পাবলিশ হচ্ছে...' : 'রিলিজ হিসেবে প্রকাশ করুন'}</span>
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  )}

                  {activeSection === 'appNotice' && isAdminRole && (
            <div className="space-y-6 animate-fadeIn max-w-2xl">
                    {appConfig.notice.isActive && (
                      <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-fadeIn">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 mt-0.5">
                            <Megaphone className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">Notice is Currently Live</span>
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
                                Active
                              </span>
                              {appConfig.notice.isScheduled && appConfig.notice.endTime && (
                                <Countdown endTime={appConfig.notice.endTime} />
                              )}
                            </div>
                            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-1">
                              {appConfig.notice.heading ? `${appConfig.notice.heading}: ` : ''}{appConfig.notice.message}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updatedConfig = { ...appConfig, notice: { ...appConfig.notice, isActive: false } };
                            saveAppConfig(updatedConfig);
                            setAppConfig(updatedConfig);
                            const activeItem = appConfigHistory.find(i => i.type === 'NOTICE' && i.isActive);
                            if (activeItem) {
                              setAppConfigHistory(updateAppConfigHistoryItemActiveStatus(activeItem.id, false));
                            }
                          }}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap self-start sm:self-auto"
                        >
                          <PowerOff className="w-3.5 h-3.5" /> Stop Notice
                        </button>
                      </div>
                    )}

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">Create New Notice</h3>
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500">Notice Heading</label>
                        <input type="text" value={noticeDraft.heading} onChange={(e) => setNoticeDraft({...noticeDraft, heading: e.target.value})} placeholder="e.g. Scheduled Maintenance" className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white" />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500">Notice Message <span className="text-rose-500">*</span></label>
                        <textarea value={noticeDraft.message} onChange={(e) => setNoticeDraft({...noticeDraft, message: e.target.value})} placeholder="Enter the detailed notice message here..." rows={4} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white resize-none" />
                      </div>

                      <div className="pt-2">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="checkbox" checked={noticeDraft.isScheduled} onChange={(e) => setNoticeDraft({...noticeDraft, isScheduled: e.target.checked})} className="w-5 h-5 text-emerald-600 rounded-md border-slate-300 focus:ring-emerald-500 dark:border-slate-600 dark:bg-slate-900" />
                          <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Schedule this notice (auto-expire)</span>
                        </label>
                      </div>

                      {noticeDraft.isScheduled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                           <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-500">Start Time</label>
                              <input type="datetime-local" value={noticeDraft.startTime} onChange={(e) => setNoticeDraft({...noticeDraft, startTime: e.target.value})} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white" />
                           </div>
                           <div className="space-y-1.5">
                              <label className="text-xs font-bold text-slate-500">End Time</label>
                              <input type="datetime-local" value={noticeDraft.endTime} onChange={(e) => setNoticeDraft({...noticeDraft, endTime: e.target.value})} className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 outline-none focus:border-emerald-500 text-slate-900 dark:text-white" />
                           </div>
                        </div>
                      )}

                      <div className="pt-4 flex justify-end">
                        <button disabled={!noticeDraft.message.trim()} onClick={handleSaveNotice} className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-bold transition-colors flex items-center gap-2">
                          <Megaphone className="w-4 h-4" /> Publish Notice
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm space-y-4">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider border-b border-slate-200 dark:border-slate-700 pb-3 mb-4">Notice History</h3>
                      {appConfigHistory.filter(h => h.type === 'NOTICE').length === 0 ? (
                        <p className="text-sm text-slate-500">No notices in history.</p>
                      ) : (
                        <div className="space-y-3">
                          {appConfigHistory.filter(h => h.type === 'NOTICE').map(h => (
                            <div key={h.id} className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between">
                              <div>
                                <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{h.heading || 'Notice'}</p>
                                <p className="text-xs text-slate-500 line-clamp-1">{h.message}</p>
                                <p className="text-[10px] text-slate-400 mt-1">{new Date(h.timestamp).toLocaleString()}</p>
                              </div>
                              <button onClick={() => handleDeleteHistoryItem(h)} className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>)}





        
        


              {displayedSection === 'security' && (
                <div className="space-y-6">
                  

                  {/* Passwords */}
                  <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden divide-y divide-slate-200 dark:divide-slate-700">
                    
                    {/* Portal PIN Item */}
                    <div className="p-5 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-xl shrink-0">
                          <KeyRound className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="text-base font-bold text-slate-900 dark:text-white">Portal Login Password</h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Used to access your account</p>
                        </div>
                      </div>
                      {editingPasswordType === 'portal' ? (
                        <form onSubmit={handleUpdatePasscode} className="flex flex-col gap-2 w-full sm:w-auto mt-4 sm:mt-0">
                          <input type="password" placeholder="Current Password" value={currentPasscode} onChange={e => setCurrentPasscode(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white" />
                          <input type="password" placeholder="New Password" value={newPasscode} onChange={e => setNewPasscode(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white" />
                          <input type="password" placeholder="Confirm Password" value={confirmPasscode} onChange={e => setConfirmPasscode(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white" />
                          {passcodeError && <span className="text-rose-500 text-xs">{passcodeError}</span>}
                          {passcodeSuccess && <span className="text-emerald-500 text-xs">{passcodeSuccess}</span>}
                          <div className="flex gap-2">
                            <button type="submit" disabled={isUpdatingPasscode} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg py-1.5 text-sm font-bold transition-colors disabled:opacity-50">Save</button>
                            <button type="button" onClick={() => setEditingPasswordType(null)} className="flex-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg py-1.5 text-sm font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <button onClick={() => setEditingPasswordType('portal')} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                          Update
                        </button>
                      )}
                    </div>

                    {/* Admin PIN Item */}
                    {isAdminRole && (
                      <div className="p-5 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-xl shrink-0">
                            <ShieldCheck className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-slate-900 dark:text-white">Admin Access Password</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Used for elevated operations</p>
                          </div>
                        </div>
                        {editingPasswordType === 'admin' ? (
                          <form onSubmit={handleUpdateAdminPasscode} className="flex flex-col gap-2 w-full sm:w-auto mt-4 sm:mt-0">
                            <input type="password" placeholder="Current Admin PIN" value={adminCurrentPasscode} onChange={e => setAdminCurrentPasscode(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white" />
                            <input type="password" placeholder="New Admin PIN" value={adminNewPasscode} onChange={e => setAdminNewPasscode(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white" />
                            <input type="password" placeholder="Confirm Admin PIN" value={adminConfirmPasscode} onChange={e => setAdminConfirmPasscode(e.target.value)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white" />
                            {adminPasscodeError && <span className="text-rose-500 text-xs">{adminPasscodeError}</span>}
                            {adminPasscodeSuccess && <span className="text-emerald-500 text-xs">{adminPasscodeSuccess}</span>}
                            <div className="flex gap-2">
                              <button type="submit" disabled={isUpdatingAdminPasscode} className="flex-1 bg-rose-500 hover:bg-rose-600 text-white rounded-lg py-1.5 text-sm font-bold transition-colors disabled:opacity-50">Save</button>
                              <button type="button" onClick={() => setEditingPasswordType(null)} className="flex-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg py-1.5 text-sm font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <button onClick={() => setEditingPasswordType('admin')} className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                            Update
                          </button>
                        )}
                      </div>
                    )}

                    {/* Master ID & PIN Item (Master Owner / Super Admin) */}
                    {(role === 'OWNER' || role === 'master_owner' || role === 'SUPER_ADMIN') && (
                      <div className="p-5 flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
                            <Shield className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="text-base font-bold text-slate-900 dark:text-white">Master User ID & PIN</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              Active Master ID: <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{masterIdDraft}</span> — Used for Multi-Office Master Login & Control Center
                            </p>
                          </div>
                        </div>
                        {editingPasswordType === 'master' ? (
                          <form onSubmit={handleUpdateMasterCredentials} className="flex flex-col gap-2 w-full sm:w-auto mt-4 sm:mt-0">
                            <input
                              type="text"
                              placeholder="Master User ID (e.g. 48456)"
                              value={masterIdDraft}
                              onChange={e => setMasterIdDraft(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm font-mono dark:text-white"
                            />
                            <input
                              type="password"
                              placeholder="Current Master PIN"
                              value={masterCurrentPin}
                              onChange={e => setMasterCurrentPin(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white"
                            />
                            <input
                              type="password"
                              placeholder="New Master PIN (optional)"
                              value={masterNewPin}
                              onChange={e => setMasterNewPin(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white"
                            />
                            <input
                              type="password"
                              placeholder="Confirm New Master PIN"
                              value={masterConfirmPin}
                              onChange={e => setMasterConfirmPin(e.target.value)}
                              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:text-white"
                            />
                            {masterCredError && <span className="text-rose-500 text-xs">{masterCredError}</span>}
                            {masterCredSuccess && <span className="text-emerald-500 text-xs">{masterCredSuccess}</span>}
                            <div className="flex gap-2">
                              <button type="submit" disabled={isUpdatingMasterCreds} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-1.5 text-sm font-bold transition-colors disabled:opacity-50">Save</button>
                              <button type="button" onClick={() => setEditingPasswordType(null)} className="flex-1 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg py-1.5 text-sm font-bold hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors">Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <button
                            onClick={() => {
                              setMasterIdDraft(getMasterUserId());
                              setMasterCredError('');
                              setMasterCredSuccess('');
                              setEditingPasswordType('master');
                            }}
                            className="px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-sm hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                          >
                            Update
                          </button>
                        )}
                      </div>
                    )}

                  </div>
                </div>
              )}

{activeSection === 'history' && isAdminRole && (
            <div className="space-y-6">
              
              {selectedHistoryUser ? (
                <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 animate-fadeIn">
                  <div className="flex items-center justify-between mb-6">
                    <button 
                      onClick={() => setSelectedHistoryUser(null)}
                      className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors text-slate-500"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">User Activity</h3>
                    <div className="w-9"></div>
                  </div>

                  <div className="flex items-center gap-4 mb-8 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                    <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                      <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                      <div className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                        {formatAirmanName(selectedHistoryUser.rank || '')} {selectedHistoryUser.name}
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 font-bold uppercase tracking-wider">
                          {selectedHistoryUser.role === 'OWNER' ? 'Owner' : selectedHistoryUser.role === 'SUPER_ADMIN' ? 'Super Admin' : selectedHistoryUser.role === 'ADMIN' ? 'Admin' : 'User'}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {selectedHistoryUser.bdNo} • {selectedHistoryUser.flightName || 'Flight'}
                      </div>
                      {selectedHistoryUser.deviceInfo && (
                        <div className="text-[11px] text-slate-400 mt-1 font-medium">
                          Device: {selectedHistoryUser.deviceInfo}
                        </div>
                      )}
                    </div>
                  </div>

                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Activity Timeline
                  </h4>
                  <div className="space-y-6">
                    <div className="relative pl-6 border-l-2 border-emerald-200 dark:border-emerald-900/50">
                      <div className="absolute w-3 h-3 bg-emerald-500 rounded-full -left-[7px] top-1 border-2 border-white dark:border-slate-800"></div>
                      <p className="text-sm font-black text-slate-900 dark:text-white">Logged In</p>
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">Authenticated to UASU Portal</p>
                      <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">
                        {selectedHistoryUser.timeFormatted || (selectedHistoryUser.timestamp ? new Date(selectedHistoryUser.timestamp).toLocaleString() : 'Recent')}
                      </p>
                    </div>
                    <div className="relative pl-6 border-l-2 border-slate-200 dark:border-slate-700">
                      <div className="absolute w-3 h-3 bg-slate-400 rounded-full -left-[7px] top-1 border-2 border-white dark:border-slate-800"></div>
                      <p className="text-sm font-black text-slate-900 dark:text-white">Active Session Access</p>
                      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-1">View & Update Duty / Nominal Roll</p>
                      <p className="text-xs font-medium text-slate-400 dark:text-slate-500 mt-0.5">
                        {selectedHistoryUser.timestamp ? new Date(new Date(selectedHistoryUser.timestamp).getTime() + 60000).toLocaleString() : 'Recent'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Active Users Section (Strictly Scoped to Current Office) */}
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm p-4">
                    <div className="flex items-center justify-between mb-3 gap-2">
                      <h3 className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                        Currently Active ({activeUsers.filter(u => !isMasterProtectedUser(u.bdNo, u.role)).length})
                      </h3>
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        Realtime • {getActiveOfficeIdentity().officeName}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {activeUsers.filter(u => !isMasterProtectedUser(u.bdNo, u.role)).length === 0 ? (
                        <span className="text-xs text-slate-500 italic">No other active users</span>
                      ) : (
                        activeUsers.filter(u => !isMasterProtectedUser(u.bdNo, u.role)).map(u => (
                          <div key={u.bdNo} className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg flex items-center gap-2">
                            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                              {formatAirmanName(u.rank)} {u.name} - ({u.page || 'Dashboard'}) - {u.role === 'OWNER' ? 'Owner' : u.role === 'SUPER_ADMIN' ? 'Super Admin' : u.role === 'ADMIN' ? 'Admin' : 'User'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Realtime Login History Toolbar */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 flex items-center bg-white dark:bg-slate-800 rounded-xl px-3 py-2 border border-slate-200 dark:border-slate-700 shadow-sm">
                      <Search className="w-4 h-4 text-slate-400 shrink-0" />
                      <input
                        type="text"
                        placeholder="Search logs by ID, Name, Rank, Flight, Role..."
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                        className="w-full bg-transparent border-none text-xs font-bold text-slate-900 dark:text-white px-2 py-1 outline-none placeholder:text-slate-400"
                      />
                    </div>
                    <button
                      onClick={() => {
                        refreshPresenceNow()
                          .then((users) => setActiveUsers(users))
                          .catch(() => {});
                        refreshLoginHistoryFromCloud(true)
                          .then((logs) => {
                            setLoginHistory(logs);
                            setRealtimeHistory(logs);
                          })
                          .catch(() => {
                            const logs = getLoginHistory();
                            setLoginHistory(logs);
                            setRealtimeHistory(logs);
                          });
                      }}
                      title="Refresh Login History"
                      className="p-2.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl transition-all shadow-sm flex items-center gap-1 text-xs font-bold cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4 text-slate-500" />
                    </button>
                    {isAdminRole && (
                      <button
                        onClick={async () => {
                          if (window.confirm('Are you sure you want to clear all login history logs?')) {
                            await clearLoginHistory();
                            setLoginHistory([]);
                            setRealtimeHistory([]);
                          }
                        }}
                        title="Clear All Login History"
                        className="p-2.5 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 border border-slate-200 dark:border-slate-700 rounded-xl transition-all shadow-sm flex items-center gap-1 text-xs font-bold cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden divide-y divide-slate-100 dark:divide-slate-700 max-h-[60vh] overflow-y-auto shadow-sm">
                    {(() => {
                      const activeCode = getActiveOfficeCode();
                      const isDefault155 = isDefault155UasuOffice();
                      const sourceList = (realtimeHistory && realtimeHistory.length > 0)
                        ? realtimeHistory
                        : (loginHistory && loginHistory.length > 0 ? loginHistory : getLoginHistory());

                      const filtered = sourceList.filter(log => {
                        if (isMasterProtectedUser(log.bdNo, log.role)) return false;
                        const logOffice = String(log.officeCode || '').trim();
                        if (logOffice ? logOffice !== activeCode : !isDefault155) return false;
                        if (!historySearch.trim()) return true;
                        const q = historySearch.toLowerCase();
                        return (
                          log.bdNo?.toLowerCase().includes(q) ||
                          log.name?.toLowerCase().includes(q) ||
                          log.rank?.toLowerCase().includes(q) ||
                          log.flightName?.toLowerCase().includes(q) ||
                          log.role?.toLowerCase().includes(q) ||
                          log.deviceInfo?.toLowerCase().includes(q)
                        );
                      });
                      if (filtered.length === 0) {
                        return (
                          <div className="p-8 text-center text-slate-500">
                            <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                            <p className="text-xs font-bold">No login history found</p>
                            <p className="text-[11px] text-slate-400 mt-1">Logs will appear automatically whenever users log in.</p>
                          </div>
                        );
                      }
                      return filtered.map(log => {
                        const formattedTime = log.timeFormatted || (log.timestamp ? new Date(log.timestamp).toLocaleString() : 'Recent');
                        return (
                          <div 
                            key={log.id || `${log.bdNo}-${log.timestamp}`} 
                            onClick={() => setSelectedHistoryUser(log)}
                            className="p-4 hover:bg-slate-50 dark:hover:bg-slate-700/60 transition-colors flex justify-between items-center cursor-pointer"
                          >
                            <div>
                              <div className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2">
                                {formatAirmanName(log.rank || '')} {log.name}
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 font-bold uppercase tracking-wider">
                                  {log.role === 'OWNER' ? 'Owner' : log.role === 'SUPER_ADMIN' ? 'Super Admin' : log.role === 'ADMIN' ? 'Admin' : 'User'}
                                </span>
                                {log.deviceInfo && (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 font-medium">
                                    {log.deviceInfo}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                                {log.bdNo} • {log.flightName || 'Flight'}
                              </div>
                              <div className="text-[10px] text-slate-400 mt-1 font-medium">
                                {formattedTime}
                              </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                          </div>
                        );
                      });
                    })()}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    ) : (
      <div className="flex-1 h-full overflow-hidden">
        {activeSection === "users" && isAdminRole && (
          <UserManagementTab nominalAirmen={nominalAirmen} userSessionRole={role} userFlight={userFlight} />
        )}
      </div>
    )}
  </div>
</div>
        )}
        {/* Modals */}
        
        {/* Delete Single History Item Confirmation Modal */}
        {deleteConfirmId && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700">
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">Delete Record?</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
                Are you sure you want to delete this record from history? If this notice or maintenance is currently live, it will also be stopped.
              </p>
              <div className="flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setDeleteConfirmId(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    confirmDeleteHistory(deleteConfirmId);
                    setDeleteConfirmId(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clear All Confirmation Modal */}
        {clearAllConfirmType && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
            <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 max-w-sm w-full shadow-2xl border border-slate-200 dark:border-slate-700">
              <h4 className="text-base font-bold text-slate-900 dark:text-white mb-2">
                Clear All {clearAllConfirmType === 'NOTICE' ? 'Notices' : 'Maintenance Records'}?
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-6">
                This will delete all {clearAllConfirmType === 'NOTICE' ? 'notice' : 'maintenance'} history items and immediately deactivate any live {clearAllConfirmType === 'NOTICE' ? 'notice' : 'maintenance'} popup.
              </p>
              <div className="flex justify-end gap-3">
                <button 
                  type="button"
                  onClick={() => setClearAllConfirmType(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    if (clearAllConfirmType === 'NOTICE') {
                      const updatedConfig = { ...appConfig, notice: { ...appConfig.notice, isActive: false, message: '' } };
                      saveAppConfig(updatedConfig);
                      setAppConfig(updatedConfig);
                    } else {
                      const updatedConfig = { ...appConfig, maintenance: { ...appConfig.maintenance, isActive: false, message: '' } };
                      saveAppConfig(updatedConfig);
                      setAppConfig(updatedConfig);
                    }
                    const remaining = appConfigHistory.filter(i => i.type !== clearAllConfirmType);
                    localStorage.setItem('baf_app_config_history', JSON.stringify(remaining));
                    setAppConfigHistory(remaining);
                    setClearAllConfirmType(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-colors"
                >
                  Clear All
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

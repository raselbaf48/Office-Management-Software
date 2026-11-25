/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, Component, ReactNode } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { AnimatePresence, motion } from 'motion/react';
import type { SidebarTab } from './components/Sidebar';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { DashboardParadeState } from './components/DashboardParadeState';
import { ParadeStateFormattedView } from './components/ParadeStateFormattedView';
import { updatePresence } from './services/presenceService';
import { getAppConfig, saveAppConfig, isFeatureActive, AppConfig } from './utils/appConfig';
import { UserLoginGate } from './components/UserLoginGate';
import { useGlobalTheme } from './utils/themeManager';

class TabErrorBoundary extends Component<{ children: ReactNode; tabKey: string }, { hasError: boolean }> {
  declare props: { children: ReactNode; tabKey: string };
  declare state: { hasError: boolean };
  declare setState: (nextState: { hasError: boolean }) => void;

  constructor(props: { children: ReactNode; tabKey: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps: { tabKey: string }) {
    if (prevProps.tabKey !== this.props.tabKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[40vh] flex flex-col items-center justify-center text-slate-600 dark:text-slate-400 gap-3 p-6 text-center">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-300">Failed to load view.</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import { NominalRoll } from './components/NominalRoll';
import { FlightsMiniView } from './components/FlightsMiniView';
import { LeaveRegisterView } from './components/LeaveRegisterView';
import { TdyRegisterView } from './components/TdyRegisterView';
import { DeploymentRegisterView } from './components/DeploymentRegisterView';
import { IdaCenterDutyView } from './components/IdaCenterDutyView';
import { MonthlyDutyRegister } from './components/MonthlyDutyRegister';
import { DutyRosterPeriodView } from './components/DutyRosterPeriodView';
import { DutyRatioMatrixView } from './components/DutyRatioMatrixViewV2';
import { DutyAnalytics } from './components/DutyAnalytics';
import { DutyConflictMonitor } from './components/DutyConflictMonitor';
import { AirmanProfileModal } from './components/AirmanProfileModal';
import { AddEditAirmanModal } from './components/AddEditAirmanModal';
import { PdfDutyImportModal } from './components/PdfDutyImportModal';
import { SettingsModal } from './components/SettingsModal';
import { AdminPasscodeModal } from './components/AdminPasscodeModal';
import { AppUpdateModal } from './components/AppUpdateModal';
import { StandaloneBackupPage } from './components/StandaloneBackupPage';
import { FirebaseQuotaPopupModal } from './components/FirebaseQuotaPopupModal';

import {
  checkForAppUpdate,
  AppVersionRecord,
  getCurrentAppVersion,
  DEFAULT_CURRENT_APP,
  isRunningInApk,
} from './services/appUpdateService';
import { Airman, FlightName, ParadeShift, UserRole, ThemePreference } from './types';
import { INITIAL_AIRMEN } from './data/initialAirmen';
import { Logo155UASU } from './components/Logo155UASU';
import { Shield, AlertCircle, X, Loader2 } from 'lucide-react';
import { getCurrentUserSession, clearUserSession, UserSession } from './utils/authSession';
import { localDb } from './services/localDatabase';
import {
  isFirebaseConfigured,
  getActiveOfficeIdentity,
  getOfficeScopedStorageKey,
  updateOfficeTelemetryUserCount,
  syncBrowserTabIdentity,
  isDefault155UasuOffice,
  isFirestoreQuotaExceeded,
} from './firebase';
import { setLastUsedPortal } from './services/portalPreferenceService';
import { initGoogleDriveAuth } from './services/googleDriveService';

const INACTIVITY_AUTO_LOGOUT_MS = 10 * 60 * 1000; // 10 minutes continuous minimize or inactivity
const LAST_ACTIVE_AT_KEY = 'baf_last_active_at';
const MINIMIZED_AT_KEY = 'baf_minimized_at';
const AUTO_LOGOUT_RESUME_CTX_KEY = 'baf_auto_logout_resume_ctx_v1';

export default function App() {
  const [activeTab, setActiveTab] = useState<SidebarTab>('overview');
  const [officeIdentity, setOfficeIdentity] = useState(() => getActiveOfficeIdentity());
  const [userSession, setUserSession] = useState<UserSession | null>(() => {
    clearUserSession();
    return null;
  });
  const [role, setRole] = useState<UserRole>('USER');
  const [justLoggedIn, setJustLoggedIn] = useState<boolean>(false);
  const [isQuotaPopupOpen, setIsQuotaPopupOpen] = useState<boolean>(false);
  const [standaloneView, setStandaloneView] = useState<'backup' | null>(null);

  // Sync Browser Tab Title & Favicon with logged-in Office Name & Logo (or Default App Identity when logged out)
  useEffect(() => {
    if (userSession) {
      const activeId = getActiveOfficeIdentity();
      syncBrowserTabIdentity(activeId.officeName, activeId.officeLogo, activeId.officeBase);
    } else {
      syncBrowserTabIdentity('', '/office-management-logo.png?v=26', '');
    }
  }, [userSession, officeIdentity]);

  useEffect(() => {
    const handleOpenStandalone = (e: any) => {
      if (e.detail === 'backup') {
        setStandaloneView(e.detail);
      }
    };
    const handleOfficeConfigChange = () => {
      const nextId = getActiveOfficeIdentity();
      setOfficeIdentity(nextId);
      if (getCurrentUserSession()) {
        syncBrowserTabIdentity(nextId.officeName, nextId.officeLogo, nextId.officeBase);
      }
      const currentAirmen = (localDb as any)?.getAirmen ? (localDb as any).getAirmen() : [];
      if (Array.isArray(currentAirmen)) {
        setAirmen([...currentAirmen]);
      }
      setConflictCount(0);
    };
    window.addEventListener('baf_open_standalone_view', handleOpenStandalone);
    window.addEventListener('baf_office_config_changed', handleOfficeConfigChange);
    window.addEventListener('storage', handleOfficeConfigChange);
    return () => {
      window.removeEventListener('baf_open_standalone_view', handleOpenStandalone);
      window.removeEventListener('baf_office_config_changed', handleOfficeConfigChange);
      window.removeEventListener('storage', handleOfficeConfigChange);
    };
  }, []);

  // Role-based & office-based tab security: if USER attempts to access admin-only tabs, or custom office accesses 155-only tab, redirect to overview
  useEffect(() => {
    const adminOnlyTabs: SidebarTab[] = ['biodata-register', 'duty-ratio', 'analytics', 'conflicts'];
    if (role === 'USER' && adminOnlyTabs.includes(activeTab)) {
      setActiveTab('overview');
    } else if ((activeTab === 'ida-center' || activeTab === 'attachment-register') && !isDefault155UasuOffice()) {
      setActiveTab('overview');
    }
  }, [role, activeTab, officeIdentity]);

  // Priority 1: Initialize Drive auth listener without flooding Firebase/Canteen reads before portal entry
  useEffect(() => {
    let unsubscribeDriveAuth: (() => void) | null = null;
    try {
      unsubscribeDriveAuth = initGoogleDriveAuth();
    } catch {}

    return () => {
      if (unsubscribeDriveAuth) unsubscribeDriveAuth();
    };
  }, []);

  // Global click handler: Clicking anywhere on a date input or its container opens the calendar
  useEffect(() => {
    const handleGlobalDateClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // If directly clicking an input[type="date"]
      if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'date') {
        const input = target as HTMLInputElement;
        if (typeof (input as any).showPicker === 'function') {
          try {
            (input as any).showPicker();
          } catch {}
        }
        return;
      }

      // Fast exit: Skip all buttons, links, inputs, and interactive controls to prevent any click lag
      if (target.closest('button, [role="button"], a, input, select, textarea, [data-prevent-date-click]')) {
        return;
      }

      // Only check dedicated date containers explicitly marked
      const container = target.closest('[data-date-box], .date-picker-wrapper, .date-input-container');
      if (container) {
        const input = container.querySelector('input[type="date"]') as HTMLInputElement | null;
        if (input && typeof (input as any).showPicker === 'function') {
          try {
            (input as any).showPicker();
          } catch {}
        }
      }
    };

    document.addEventListener('click', handleGlobalDateClick, { capture: false, passive: true });
    return () => document.removeEventListener('click', handleGlobalDateClick);
  }, []);

  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);
  const [hasSeenNotice, setHasSeenNotice] = useState<boolean>(false);

  // In-App Software Update (Capacitor + Supabase)
  const [updateAvailable, setUpdateAvailable] = useState<AppVersionRecord | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState<boolean>(false);
  const [appVersionInfo, setAppVersionInfo] = useState<{ versionCode: number; versionName: string }>(DEFAULT_CURRENT_APP);

  useEffect(() => {
    // Check for in-app updates via Supabase and Capacitor on app open (ONLY in APK)
    if (!isRunningInApk()) return;

    const checkUpdates = async () => {
      const current = await getCurrentAppVersion();
      setAppVersionInfo(current);
      const res = await checkForAppUpdate();
      if (res.hasUpdate && res.latestVersion) {
        setUpdateAvailable(res.latestVersion);
        setIsUpdateModalOpen(true);
      }
    };

    const timer = setTimeout(checkUpdates, 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleManualCheck = async () => {
      if (!isRunningInApk()) return;
      const current = await getCurrentAppVersion();
      setAppVersionInfo(current);
      const res = await checkForAppUpdate({ ignoreSkipped: true });
      if (res.hasUpdate && res.latestVersion) {
        setUpdateAvailable(res.latestVersion);
        setIsUpdateModalOpen(true);
      }
    };
    window.addEventListener('baf_check_app_update', handleManualCheck);
    return () => window.removeEventListener('baf_check_app_update', handleManualCheck);
  }, []);
  
  useEffect(() => {
    // One-time cleanup for old test notice "Gg" or empty notices
    if (!localStorage.getItem('baf_cleared_notices_v4')) {
      const cfg = getAppConfig();
      if (cfg.notice.message === 'Gg' || !cfg.notice.message || cfg.notice.message.trim() === 'Gg') {
        cfg.notice.isActive = false;
        cfg.notice.message = '';
        saveAppConfig(cfg);
      }
      localStorage.setItem('baf_cleared_notices_v4', 'true');
    }

    setAppConfig(getAppConfig());
    const handleConfigChange = (e: any) => setAppConfig(e.detail);
    window.addEventListener('baf_app_config_changed', handleConfigChange);
    return () => window.removeEventListener('baf_app_config_changed', handleConfigChange);
  }, []);

  const dismissNotice = () => {
    if (appConfig?.notice) {
      const sig = (appConfig.notice.heading || '') + '::' + (appConfig.notice.message || '');
      localStorage.setItem('baf_dismissed_notice_sig', sig);
    }
    setHasSeenNotice(true);
  };

  const renderNoticeModal = () => {
    if (!userSession || !appConfig || hasSeenNotice) return null;
    // Keep Quota Exceeded popup as the strict 1st popup after login/re-login
    if (isQuotaPopupOpen) return null;
    if (justLoggedIn && isFirestoreQuotaExceeded() && sessionStorage.getItem('baf_quota_popup_shown_in_session') !== 'true') {
      return null;
    }
    if (!isFeatureActive(appConfig.notice)) return null;
    if (!appConfig.notice.message || appConfig.notice.message.trim() === '' || appConfig.notice.message.trim() === 'Gg') return null;

    // Check if user already dismissed this specific notice
    const sig = (appConfig.notice.heading || '') + '::' + (appConfig.notice.message || '');
    if (localStorage.getItem('baf_dismissed_notice_sig') === sig) return null;

    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-700 relative">
          <button 
            onClick={dismissNotice} 
            className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
          
          <div className="flex flex-col items-center text-center space-y-4 mb-2">
            <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-500">
              <AlertCircle className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">{appConfig.notice.heading || "Important Notice"}</h2>
            <div className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto px-1">
              {appConfig.notice.message}
            </div>
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={dismissNotice}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
            >
              ঠিক আছে (Close Notice)
            </button>
          </div>
        </div>
      </div>
    );
  };

    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isAdminLoginModalOpen, setIsAdminLoginModalOpen] = useState<boolean>(false);
  const [isUserManagementOpen, setIsUserManagementOpen] = useState<boolean>(false);
  
  // Theme Preference State (Synced globally across Login Portal, Office, and Canteen)
  const { themePreference, isDark: darkMode, setThemePreference } = useGlobalTheme();

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    sessionStorage.setItem('baf_user_role', newRole);
    
  };

  const handleManualDarkModeToggle = (dark: boolean) => {
    setThemePreference(dark ? 'dark' : 'light');
  };

  // Sidebar Layout States
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  // Filters
  const todayStr = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [selectedShift, setSelectedShift] = useState<ParadeShift>('Morning');
  const [selectedFlight, setSelectedFlight] = useState<FlightName | 'Overall'>('Overall');

  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const selectedDateRef = useRef(selectedDate);
  selectedDateRef.current = selectedDate;
  const selectedFlightRef = useRef(selectedFlight);
  selectedFlightRef.current = selectedFlight;

  const lastActiveAtRef = useRef<number>(Date.now());
  const minimizedAtRef = useRef<number | null>(null);
  const isLoggingOutRef = useRef<boolean>(false);
  const internalUiPauseUntilRef = useRef<number>(0);

  const performLogout = async ({ isAutoLogout }: { isAutoLogout: boolean }) => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    try {
      // 1. Synchronously tell all active forms/modals (AssignDutyModal, DutyRatioMatrix, etc.) to save drafts
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('baf_prepare_auto_logout', { detail: { isAutoLogout } }));
        try {
          const ctxKey = getOfficeScopedStorageKey(AUTO_LOGOUT_RESUME_CTX_KEY);
          if (isAutoLogout) {
            window.localStorage.setItem(
              ctxKey,
              JSON.stringify({
                activeTab: activeTabRef.current,
                selectedDate: selectedDateRef.current,
                selectedFlight: selectedFlightRef.current,
                reopenAssignModal: Boolean((window as any).__bafAssignDutyModalOpen),
                savedAt: Date.now(),
              })
            );
          } else {
            window.localStorage.removeItem(ctxKey);
          }
        } catch {}
      }

      // 2. Flush local & Firebase deltas cleanly before detaching session
      await localDb.flushBeforeLogout(1800).catch(() => {});
    } finally {
      localDb.detachManifestListener();
      clearUserSession();
      setUserSession(null);
      setJustLoggedIn(false);
      setIsQuotaPopupOpen(false);
      setHasSeenNotice(false);
      handleRoleChange('USER');
      setLastUsedPortal('Office');
      syncBrowserTabIdentity('', '/office-management-logo.png?v=26', '');
      isLoggingOutRef.current = false;
    }
  };

  const handleUserLogout = () => {
    void performLogout({ isAutoLogout: false });
  };

  const autoLogoutRef = useRef<() => void>(() => {
    void performLogout({ isAutoLogout: true });
  });
  autoLogoutRef.current = () => {
    void performLogout({ isAutoLogout: true });
  };

  // Lifecycle & Inactivity Session Guard:
  // - Full close & reopen always requires re-login (via cold-start session clear + pagehide !persisted).
  // - Normal minimize/maximize (< 10 mins) keeps the user logged in without forcing re-login.
  // - Continuous 10 minutes minimized or inactive triggers auto-logout after flushing all unsaved drafts & deltas.
  useEffect(() => {
    if (!userSession) return;

    isLoggingOutRef.current = false;
    const initNow = Date.now();
    lastActiveAtRef.current = initNow;
    minimizedAtRef.current = null;
    try {
      sessionStorage.setItem(LAST_ACTIVE_AT_KEY, String(initNow));
      sessionStorage.removeItem(MINIMIZED_AT_KEY);
    } catch {}

    const markInternalUiPause = () => {
      internalUiPauseUntilRef.current = Date.now() + 60_000;
    };
    const clearInternalUiPauseSoon = () => {
      setTimeout(() => {
        internalUiPauseUntilRef.current = 0;
      }, 600);
    };

    let lastRecordedActivityWrite = initNow;
    const recordUserActivity = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      lastActiveAtRef.current = now;
      if (minimizedAtRef.current !== null) {
        minimizedAtRef.current = null;
        try {
          sessionStorage.removeItem(MINIMIZED_AT_KEY);
        } catch {}
      }
      if (now - lastRecordedActivityWrite >= 2000) {
        lastRecordedActivityWrite = now;
        try {
          sessionStorage.setItem(LAST_ACTIVE_AT_KEY, String(now));
        } catch {}
      }
    };

    const markMinimized = () => {
      const now = Date.now();
      if (minimizedAtRef.current === null) {
        minimizedAtRef.current = now;
        try {
          sessionStorage.setItem(MINIMIZED_AT_KEY, String(now));
        } catch {}
      }
      try {
        window.dispatchEvent(new CustomEvent('baf_prepare_auto_logout', { detail: { isAutoLogout: false } }));
      } catch {}
    };

    const checkInactivityTimeout = (): boolean => {
      if (isLoggingOutRef.current) return true;
      const now = Date.now();
      if (now <= internalUiPauseUntilRef.current) return false;

      let lastActive = lastActiveAtRef.current;
      try {
        const storedActive = Number(sessionStorage.getItem(LAST_ACTIVE_AT_KEY) || '0');
        if (storedActive > 0 && (!lastActive || storedActive < lastActive)) {
          lastActive = storedActive;
        }
      } catch {}

      let minAt = minimizedAtRef.current;
      try {
        const storedMin = Number(sessionStorage.getItem(MINIMIZED_AT_KEY) || '0');
        if (!minAt && storedMin > 0) minAt = storedMin;
      } catch {}

      const idleElapsed = now - lastActive;
      const minimizedElapsed = minAt ? now - minAt : 0;

      if (idleElapsed >= INACTIVITY_AUTO_LOGOUT_MS || minimizedElapsed >= INACTIVITY_AUTO_LOGOUT_MS) {
        autoLogoutRef.current();
        return true;
      }
      return false;
    };

    const handleResumeFromMinimizeOrFocus = () => {
      clearInternalUiPauseSoon();
      if (!getCurrentUserSession()) {
        autoLogoutRef.current();
        return;
      }
      if (checkInactivityTimeout()) {
        return;
      }
      // Returned within < 10 minutes -> stay logged in seamlessly and refresh activity clock
      const now = Date.now();
      minimizedAtRef.current = null;
      lastActiveAtRef.current = now;
      lastRecordedActivityWrite = now;
      try {
        sessionStorage.removeItem(MINIMIZED_AT_KEY);
        sessionStorage.setItem(LAST_ACTIVE_AT_KEY, String(now));
      } catch {}
    };

    const handleDocumentClick = (e: MouseEvent) => {
      recordUserActivity();
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'file') ||
        target.closest('label')?.querySelector('input[type="file"]')
      ) {
        markInternalUiPause();
      }
    };

    const handleBeforePrint = () => markInternalUiPause();
    const handleAfterPrint = () => clearInternalUiPauseSoon();

    const handleBeforeUnload = () => {
      try {
        window.dispatchEvent(new CustomEvent('baf_prepare_auto_logout', { detail: { isAutoLogout: false } }));
      } catch {}
    };

    const handlePageHide = (e: PageTransitionEvent) => {
      try {
        window.dispatchEvent(new CustomEvent('baf_prepare_auto_logout', { detail: { isAutoLogout: false } }));
      } catch {}
      if (e.persisted) {
        // Mobile browser/PWA put page in bfcache (minimize/switch app) -> do NOT clear session
        markMinimized();
      } else {
        // Actual page unload / app tab close -> require re-login next open
        clearUserSession();
      }
    };

    const handlePageShow = () => {
      handleResumeFromMinimizeOrFocus();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        markMinimized();
      } else if (document.visibilityState === 'visible') {
        handleResumeFromMinimizeOrFocus();
      }
    };

    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('pointerdown', recordUserActivity, { passive: true });
    document.addEventListener('keydown', recordUserActivity, { passive: true });
    document.addEventListener('touchstart', recordUserActivity, { passive: true });
    window.addEventListener('wheel', recordUserActivity, { passive: true });
    window.addEventListener('beforeprint', handleBeforePrint);
    window.addEventListener('afterprint', handleAfterPrint);
    window.addEventListener('focus', handleResumeFromMinimizeOrFocus);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const inactivityInterval = setInterval(() => {
      checkInactivityTimeout();
    }, 15_000);

    let capListenerHandle: { remove: () => Promise<void> } | null = null;
    if (isRunningInApk() && Capacitor.isPluginAvailable('App')) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) {
          markMinimized();
        } else {
          handleResumeFromMinimizeOrFocus();
        }
      })
        .then((handle) => {
          capListenerHandle = handle;
        })
        .catch(() => {});
    }

    return () => {
      clearInterval(inactivityInterval);
      document.removeEventListener('click', handleDocumentClick, true);
      document.removeEventListener('pointerdown', recordUserActivity);
      document.removeEventListener('keydown', recordUserActivity);
      document.removeEventListener('touchstart', recordUserActivity);
      window.removeEventListener('wheel', recordUserActivity);
      window.removeEventListener('beforeprint', handleBeforePrint);
      window.removeEventListener('afterprint', handleAfterPrint);
      window.removeEventListener('focus', handleResumeFromMinimizeOrFocus);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pageshow', handlePageShow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (capListenerHandle) {
        capListenerHandle.remove().catch(() => {});
      }
    };
  }, [userSession]);

  // Data
  const [airmen, setAirmen] = useState<Airman[]>(() => {
    try {
      const current = (localDb as any)?.getAirmen ? (localDb as any).getAirmen() : null;
      if (Array.isArray(current)) return current;
    } catch {}
    return [];
  });
  const [loadingAirmen, setLoadingAirmen] = useState<boolean>(false);
  const [conflictCount, setConflictCount] = useState<number>(0);

  // Modals
  const [selectedAirmanProfile, setSelectedAirmanProfile] = useState<{
    airman: Airman;
    initialTab?: 'profile' | 'history';
    initialCategory?: string;
    historyOnly?: boolean;
    allowEditDelete?: boolean;
    initialYear?: number;
  } | null>(null);
  const [isAddEditOpen, setIsAddEditOpen] = useState<boolean>(false);
  const [airmanToEdit, setAirmanToEdit] = useState<Airman | null>(null);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [isPdfImportModalOpen, setIsPdfImportModalOpen] = useState<boolean>(false);

  // Fetch airmen from backend API with graceful fallback (always excluding protected Master Owner 48456)
  const fetchAirmen = async () => {
    try {
      const res = await fetch('/api/airmen');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          const filtered = data.filter((a: any) => {
            const digits = String(a?.bdNo || a?.id || '').replace(/\D/g, '');
            return digits !== '48456' && a?.role !== 'master_owner' && a?.isProtected !== true;
          });
          setAirmen(filtered);
        }
      }
    } catch (err) {
      // Fallback already provided by localDb.getAirmen()
    } finally {
      setLoadingAirmen(false);
    }
  };

  useEffect(() => {
    fetchAirmen();
  }, []);

  useEffect(() => {
    const handleDbUpdated = () => {
      const currentAirmen = (localDb as any)?.getAirmen ? (localDb as any).getAirmen() : [];
      if (Array.isArray(currentAirmen)) {
        setAirmen((prev) => {
          if (prev.length === currentAirmen.length) {
            try {
              if (JSON.stringify(prev) === JSON.stringify(currentAirmen)) {
                return prev;
              }
            } catch {}
          }
          return [...currentAirmen];
        });
      }
    };
    window.addEventListener('baf_db_updated', handleDbUpdated);
    return () => window.removeEventListener('baf_db_updated', handleDbUpdated);
  }, []);



  useEffect(() => {
    const handleDetailedUsersChange = (e: any) => {
      const newUsers = e.detail;
      if (userSession && newUsers) {
        const myDetail = newUsers.find((u: any) => u.bdNo.toLowerCase() === userSession.bdNo.toLowerCase());
        if (myDetail) {
          if (myDetail.status !== 'ACTIVE') {
            handleUserLogout();
            console.warn('Your account has been suspended or disabled by admin.');
          } else {
            // Only demote if their current active role is higher than what's allowed in myDetail
            const roleHierarchy: Record<string, number> = {
              master_owner: 5,
              OWNER: 4,
              SUPER_ADMIN: 3,
              ADMIN: 2,
              USER: 1,
            };
            const currentActiveRole = sessionStorage.getItem('baf_user_role') || 'USER';
            if ((roleHierarchy[currentActiveRole] || 1) > (roleHierarchy[myDetail.role] || 1)) {
              handleRoleChange(myDetail.role);
              const updatedSession = { ...userSession, assignedRole: myDetail.role };
              setUserSession(updatedSession);
              sessionStorage.setItem('baf_user_session', JSON.stringify(updatedSession));
            }
          }
        }
      }
    };
    window.addEventListener('baf_detailed_users_changed', handleDetailedUsersChange);
    return () => window.removeEventListener('baf_detailed_users_changed', handleDetailedUsersChange);
  }, [userSession, handleRoleChange, handleUserLogout]);


  // Real-time EventSource Listener & Auto-sync across all clients
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let failureCount = 0;

    const connectSSE = () => {
      try {
        eventSource = new EventSource('/api/realtime/events');

        eventSource.onmessage = (event) => {
          failureCount = 0;
          try {
            const data = JSON.parse(event.data);
            if (
              data.type === 'DATA_UPDATED' ||
              data.type === 'ROSTER_UPDATED' ||
              data.type === 'AIRMEN_UPDATED' ||
              data.type === 'PARADE_UPDATED'
            ) {
              fetchAirmen();
              window.dispatchEvent(new CustomEvent('baf_state_updated', { detail: data }));
            }
          } catch {
            // Ignore parse errors on raw messages or pings
          }
        };

        eventSource.onerror = () => {
          failureCount++;
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          // On static hosting (like Cloudflare Pages), realtime events fall back to periodic polling
          if (failureCount < 3) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = setTimeout(connectSSE, 10000);
          }
        };
      } catch (err) {
        // SSE not supported or offline
      }
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      clearTimeout(reconnectTimeout);
    };
  }, []);

  // Fetch conflict count for sidebar indicator
  useEffect(() => {
    const fetchConflicts = async () => {
      try {
        const monthKey = selectedDate.slice(0, 7);
        const res = await fetch(`/api/analytics?month=${monthKey}`);
        if (res.ok) {
          const data = await res.json();
          setConflictCount((data.conflictAlerts || []).length);
        }
      } catch (err) {
        console.warn('Failed to fetch conflict count:', err);
      }
    };
    fetchConflicts();
    const handleGlobalUpdate = () => {
      fetchConflicts();
      fetchAirmen();
    };
    window.addEventListener('baf_state_updated', handleGlobalUpdate);
    return () => {
      window.removeEventListener('baf_state_updated', handleGlobalUpdate);
    };
  }, [selectedDate]);



  // Airman CRUD Handlers
  const handleSaveAirman = async (airmanData: Partial<Airman>) => {
    try {
      if (airmanToEdit) {
        const res = await fetch(`/api/airmen/${airmanToEdit.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(airmanData),
        });
        if (res.ok) {
          await fetchAirmen();
        }
      } else {
        const res = await fetch('/api/airmen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(airmanData),
        });
        if (res.ok) {
          await res.json().catch(() => null);
          await fetchAirmen();
          updateOfficeTelemetryUserCount(localDb.getAirmen().length).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Error saving airman:', err);
    } finally {
      setAirmanToEdit(null);
    }
  };

  const handleSyncGoogleSheet = async () => {
    const res = await fetch('/api/sync-google-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetUrl: 'https://docs.google.com/spreadsheets/d/1tsmdZI55KL6IbPhPsRqBpGWR9uTIeDE474xF36g96nY/export?format=csv',
      }),
    });
    if (!res.ok) {
      throw new Error('Failed to sync sheet');
    }
    await fetchAirmen();
  };

  const handleDeleteAirman = async (airmanId: string) => {
    if (String(airmanId).replace(/\D/g, '') === '48456') return;
    try {
      const res = await fetch(`/api/airmen/${airmanId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAirmen();
        updateOfficeTelemetryUserCount(localDb.getAirmen().length).catch(() => {});
        window.dispatchEvent(new CustomEvent('baf_state_updated'));
      }
    } catch (err) {
      console.warn('Error deleting airman:', err);
    }
  };

  // Standalone Full-Page Views (Offline Local Backup & Restore Center)
  if (standaloneView === 'backup') {
    return (
      <StandaloneBackupPage
        onBack={() => setStandaloneView(null)}
      />
    );
  }

  // User Login Gate: Only render login interface when not authenticated
  if (!userSession) {
    return (
      <div className={`min-h-screen transition-colors duration-200 ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
        <UserLoginGate
          airmen={airmen}
          onAuthenticated={() => {
            const sess = getCurrentUserSession();
            setJustLoggedIn(true);
            setUserSession(sess);
            if (sess?.assignedRole) {
              handleRoleChange(sess.assignedRole as any);
            } else {
              handleRoleChange('USER');
            }

            // Restore workspace tab, date, flight & open Assign Duty draft if user was auto-logged out due to 10-min timeout
            try {
              const ctxKey = getOfficeScopedStorageKey(AUTO_LOGOUT_RESUME_CTX_KEY);
              const rawCtx = window.localStorage.getItem(ctxKey);
              if (rawCtx) {
                window.localStorage.removeItem(ctxKey);
                const parsed = JSON.parse(rawCtx);
                if (parsed && parsed.savedAt && Date.now() - parsed.savedAt < 24 * 60 * 60 * 1000) {
                  if (parsed.selectedDate) setSelectedDate(parsed.selectedDate);
                  if (parsed.selectedFlight) setSelectedFlight(parsed.selectedFlight);
                  if (parsed.activeTab) setActiveTab(parsed.activeTab as SidebarTab);
                  const assignDraftRaw = window.localStorage.getItem(
                    getOfficeScopedStorageKey('baf_assign_duty_pending_draft_v1')
                  );
                  if (parsed.reopenAssignModal && assignDraftRaw) {
                    window.sessionStorage.setItem('baf_reopen_assign_after_login', 'true');
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('baf_reopen_assign_duty_modal'));
                    }, 120);
                  }
                }
              }
            } catch {}

            fetchAirmen();

            // Trigger instant data download from Firebase & attach live manifest listener after login
            localDb.attachManifestListener();
            localDb.syncFromFirebase({ isLoginSync: true });
          }}
        />

        {/* Capacitor In-App Update Modal on Login Screen (Rendered ONLY in APK) */}
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
  }

  const renderActiveTabContent = (tab: SidebarTab) => {
    // If regular USER attempts to view admin-only tab, or non-155 office views ida-center, gracefully fallback to overview
    if (
      (role === 'USER' && (tab === 'biodata-register' || tab === 'duty-ratio' || tab === 'analytics' || tab === 'conflicts')) ||
      ((tab === 'ida-center' || tab === 'attachment-register') && !isDefault155UasuOffice())
    ) {
      tab = 'overview';
    }
    switch (tab) {
      case "biodata-register":
        return (
          <NominalRoll
            variant="biodata"
            role={role}
            initialFlightFilter={selectedFlight === "Overall" || selectedFlight === "All" ? "All" : selectedFlight}
            airmen={airmen}
            userFlight={userSession?.flightName}
            onRefresh={fetchAirmen}
            onSyncGoogleSheet={handleSyncGoogleSheet}
            onAddAirman={() => {
              setAirmanToEdit(null);
              setIsAddEditOpen(true);
            }}
            onEditAirman={(a) => {
              if (a) {
                setAirmanToEdit(a);
                setIsAddEditOpen(true);
              }
            }}
            onDeleteAirman={handleDeleteAirman}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, allowEditDelete: true, ...config })}
          />
        );
      case "overview":
        return (
          <DashboardParadeState
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            selectedShift={selectedShift}
            setSelectedShift={setSelectedShift}
            selectedFlight={selectedFlight}
            setSelectedFlight={setSelectedFlight}
            onOpenPrintModal={() => setIsPrintModalOpen(true)}
            isPrintMode={isPrintModalOpen}
            onClosePrintMode={() => setIsPrintModalOpen(false)}
            onViewAirmanProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
            onOpenImportModal={() => setIsPdfImportModalOpen(true)}
          />
        );
      case "parade-state":
        return (
          <ParadeStateFormattedView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            initialDocumentType="PARADE"
            onOpenPrintModal={() => setIsPrintModalOpen(true)}
            isPrintMode={isPrintModalOpen}
            onClosePrintMode={() => setIsPrintModalOpen(false)}
            onViewAirmanProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
            onOpenImportModal={() => setIsPdfImportModalOpen(true)}
          />
        );
      case "pt-state":
        return (
          <ParadeStateFormattedView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            initialDocumentType="PT"
            onOpenPrintModal={() => setIsPrintModalOpen(true)}
            onViewAirmanProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
            onOpenImportModal={() => setIsPdfImportModalOpen(true)}
          />
        );
      case "others-state":
        return (
          <ParadeStateFormattedView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            initialDocumentType="OTHERS"
            onOpenPrintModal={() => setIsPrintModalOpen(true)}
            onViewAirmanProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
            onOpenImportModal={() => setIsPdfImportModalOpen(true)}
          />
        );
      case "nominal":
        return (
          <NominalRoll
            variant="nominal"
            initialFlightFilter={selectedFlight === "Overall" || selectedFlight === "All" ? "All" : selectedFlight}
            airmen={airmen}
            role={role}
            userFlight={userSession?.flightName}
            onRefresh={fetchAirmen}
            onSyncGoogleSheet={handleSyncGoogleSheet}
            onEditAirman={(a) => {
              if (a) {
                setAirmanToEdit(a);
                setIsAddEditOpen(true);
              }
            }}
            onDeleteAirman={handleDeleteAirman}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, allowEditDelete: false, ...config })}
          />
        );
      case "flights":
        return (
          <FlightsMiniView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            onSelectFlight={(fl) => {
              setSelectedFlight(fl);
              setActiveTab("nominal");
            }}
            onViewAirmanHistory={(a) => setSelectedAirmanProfile(a)}
          />
        );
      case "leave-register":
        return (
          <LeaveRegisterView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "tdy-register":
        return (
          <TdyRegisterView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "attachment-register":
        return (
          <DeploymentRegisterView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "ida-center":
        return (
          <IdaCenterDutyView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            selectedDate={selectedDate}
            onViewAirmanProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "register":
        return (
          <MonthlyDutyRegister
            airmen={airmen}
            role={role}
            userFlight={userSession?.flightName}
            conflictCount={conflictCount}
            setConflictCount={setConflictCount}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "duty-roster":
        return (
          <DutyRosterPeriodView
            role={role}
            userFlight={userSession?.flightName}
            airmen={airmen}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "duty-ratio":
        return (
          <DutyRatioMatrixView
            role={role}
            onConfirmNavigate={(nextTab) => setActiveTab(nextTab as SidebarTab)}
          />
        );
      case "analytics":
        return (
          <DutyAnalytics
            airmen={airmen}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
          />
        );
      case "conflicts":
        return (
          <DutyConflictMonitor
            airmen={airmen}
            onViewProfile={(a, config) => setSelectedAirmanProfile({ airman: a, ...config })}
            onNavigateToRegister={() => setActiveTab("register")}
          />
        );
      default:
        return null;
    }
  };

  const handleRequestTabChange = (nextTab: SidebarTab) => {
    if (
      activeTab === 'duty-ratio' &&
      nextTab !== 'duty-ratio' &&
      typeof window !== 'undefined' &&
      (window as any).__bafDutyRatioHasUnsavedChanges
    ) {
      window.dispatchEvent(
        new CustomEvent('baf_duty_ratio_request_leave', {
          detail: { targetTab: nextTab },
        })
      );
      return;
    }
    setActiveTab(nextTab);
  };

  return (
    <div className={`min-h-screen transition-colors duration-200 ${darkMode ? 'dark bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'}`}>
      <FirebaseQuotaPopupModal checkOnMount={justLoggedIn} onOpenChange={setIsQuotaPopupOpen} />
      {renderNoticeModal()}
      {/* Left Sidebar Navigation */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleRequestTabChange}
        role={role}
        userFlight={userSession?.flightName}
        conflictCount={conflictCount}
        collapsed={sidebarCollapsed}
        setCollapsed={setSidebarCollapsed}
        mobileOpen={mobileSidebarOpen}
        setMobileOpen={setMobileSidebarOpen}
        airmenCount={airmen.filter(a => a.active !== false).length}
        userSession={userSession}
        onOpenImportModal={() => {
          setMobileSidebarOpen(false);
          setIsPdfImportModalOpen(true);
        }}
        onLogoutUser={handleUserLogout}
        onOpenSettings={() => {
          setMobileSidebarOpen(false);
          setIsSettingsModalOpen(true);
        }}
        onOpenAdminLogin={() => {
          setMobileSidebarOpen(false);
          setIsAdminLoginModalOpen(true);
        }}
        onLogoutAdmin={() => {
          handleRoleChange('USER');
          if (userSession) {
            const updatedSession = { ...userSession, assignedRole: 'USER' };
            setUserSession(updatedSession);
            sessionStorage.setItem('baf_user_session', JSON.stringify(updatedSession));
          }
        }}
      />

      {/* Right Content Wrapper */}
      <div className={`flex flex-col min-h-screen transition-[padding] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] print:min-h-0 print:pl-0 print:p-0 print:bg-white ${sidebarCollapsed ? 'lg:pl-[72px]' : 'lg:pl-64'}`}>
        {/* Top Header Bar */}
        <TopHeader
          activeTab={activeTab}
          onOpenMobileSidebar={() => setMobileSidebarOpen(true)}
          role={role}
          userFlight={userSession?.flightName}
          userSession={userSession}
          onLogoutUser={handleUserLogout}
          onOpenAdminLogin={() => setIsAdminLoginModalOpen(true)}
          onLogoutAdmin={() => {
            handleRoleChange('USER');
            if (userSession) {
              const updatedSession = { ...userSession, assignedRole: 'USER' };
              setUserSession(updatedSession);
              sessionStorage.setItem('baf_user_session', JSON.stringify(updatedSession));
            }
          }}
        />

        {/* Main View Area (Mounts immediately on click with smooth entrance transition) */}
        <main className={`flex-1 ${activeTab === 'duty-ratio' ? 'px-1 sm:px-2 md:px-3 py-3 max-w-none' : activeTab === 'register' ? 'px-2 sm:px-4 lg:px-6 max-w-none' : 'px-4 sm:px-6 lg:px-8 max-w-[1600px]'} py-6 w-full mx-auto print:p-0 print:m-0 print:max-w-none print:w-full`}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="w-full relative"
          >
            <TabErrorBoundary tabKey={activeTab}>
              {renderActiveTabContent(activeTab)}
            </TabErrorBoundary>
          </motion.div>
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200 dark:border-slate-800/80 py-5 bg-white dark:bg-slate-900 text-center text-xs text-slate-500 dark:text-slate-400 mt-auto print:hidden">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center space-x-2.5">
              <Logo155UASU className="h-6 w-6" />
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {officeIdentity.officeName} • Office Management System
              </span>
            </div>
            <p>© 2026 {officeIdentity.officeName} • Confidential Personnel Duty Register</p>
          </div>
        </footer>

      </div>

      {/* Modals */}
      {selectedAirmanProfile && (
        <AirmanProfileModal
          airman={selectedAirmanProfile.airman}
          initialTab={selectedAirmanProfile.initialTab}
          initialCategory={selectedAirmanProfile.initialCategory}
          historyOnly={selectedAirmanProfile.historyOnly}
          allowEditDelete={selectedAirmanProfile.allowEditDelete}
          initialYear={selectedAirmanProfile.initialYear}
          onClose={() => setSelectedAirmanProfile(null)}
          onEditAirman={(a) => {
            setAirmanToEdit(a);
            setIsAddEditOpen(true);
          }}
          onRemoveAirman={handleDeleteAirman}
          role={role}
          variant={activeTab === "biodata-register" ? "biodata" : "nominal"}
        />
      )}

      {isAddEditOpen && (
        <AddEditAirmanModal
          key={airmanToEdit ? `edit-${airmanToEdit.id || airmanToEdit.bdNo}` : 'add-new'}
          variant={activeTab === 'biodata-register' ? 'biodata' : 'nominal'}
          airmanToEdit={airmanToEdit}
          existingAirmen={airmen}
          onSave={handleSaveAirman}
          onRemoveAirman={handleDeleteAirman}
          onClose={() => {
            setIsAddEditOpen(false);
            setAirmanToEdit(null);
          }}
        />
      )}

      {/* AI PDF / Image Duty Data Import Modal */}
      {isPdfImportModalOpen && (
        <PdfDutyImportModal
          isOpen={isPdfImportModalOpen}
          onClose={() => setIsPdfImportModalOpen(false)}
          airmen={airmen}
          onImportSuccess={(dates) => {
            if (dates && dates.length > 0) {
              setSelectedDate(dates[0]);
              window.dispatchEvent(new CustomEvent('baf_state_updated', { detail: { date: dates[0] } }));
            } else {
              window.dispatchEvent(new CustomEvent('baf_state_updated'));
            }
          }}
          onNavigateToTab={(tab, date) => {
            if (date) setSelectedDate(date);
            setActiveTab(tab);
          }}
        />
      )}

      {/* System Settings Modal (Theme, Passcode, Import History, Backup) */}
      {isAdminLoginModalOpen && (
        <AdminPasscodeModal
          isOpen={isAdminLoginModalOpen}
          airmen={airmen}
          onClose={() => setIsAdminLoginModalOpen(false)}
          onSuccess={(newRole) => {
            handleRoleChange(newRole);
            if (userSession) {
              const updatedSession = { ...userSession, assignedRole: newRole };
              setUserSession(updatedSession);
              sessionStorage.setItem('baf_user_session', JSON.stringify(updatedSession));
            }
            setIsAdminLoginModalOpen(false);
          }}
          assignedRole={userSession?.assignedRole || 'USER'}
          bdNo={userSession?.bdNo}
        />
      )}

      {isSettingsModalOpen && (
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          role={role}
          userFlight={userSession?.flightName}
          nominalAirmen={airmen}
          onOpenAdminLogin={() => setIsAdminLoginModalOpen(true)}
          onRosterUpdated={() => {
            fetchAirmen();
            window.dispatchEvent(new CustomEvent('baf_state_updated'));
          }}
        />
      )}

      {/* Capacitor In-App Update Modal (Rendered ONLY in APK) */}
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
}

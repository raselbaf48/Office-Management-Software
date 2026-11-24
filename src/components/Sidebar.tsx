import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Logo155UASU } from './Logo155UASU';
import { PWAInstallButton } from './PWAInstallButton';
import {
  LayoutDashboard,
  Users,
  Calendar,
  BarChart3,
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
  Layers,
  Building2,
  Clock,
  UserCheck,
  FileText,
  AlertTriangle,
  Sparkles,
  Award,
  CalendarDays,
  PanelLeftClose,
  PanelLeft,
  Sliders,
  Settings, 
  KeyRound,
  Lock,
  Unlock,
  LogOut,
  ClipboardList,
  Activity,
  UserCircle,
  User,
  X
} from 'lucide-react';
import { UserRole } from '../types';
import { UserSession } from '../utils/authSession';
import { getActiveOfficeIdentity, doesOfficeHaveFlights, isDefault155UasuOffice } from '../firebase';

export type SidebarTab =
  | 'overview'
  | 'nominal'
  | 'flights'
  | 'parade-state'
  | 'pt-state'
  | 'others-state'
  | 'biodata-register'
  | 'leave-register'
  | 'tdy-register'
  | 'attachment-register'
  | 'ida-center'
  | 'register'
  | 'duty-roster'
  | 'duty-ratio'
  | 'analytics'
  | 'conflicts';

interface SidebarProps {
  activeTab: SidebarTab;
  setActiveTab: (tab: SidebarTab) => void;
  role: UserRole;
  userFlight?: string;
  conflictCount: number;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  airmenCount: number;
  userSession?: UserSession | null;
  onOpenImportModal?: () => void;
  onOpenAdminLogin?: () => void;
  onLogoutAdmin?: () => void;
  onLogoutUser?: () => void;
  onOpenSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  role,
  conflictCount,
  collapsed,
  setCollapsed,
  mobileOpen,
  setMobileOpen,
  airmenCount,
  userSession,
  onLogoutUser,
  onOpenSettings,
}) => {
  // Accordion section open states
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    overview: true,
    orgStructure: true,
    workforce: true,
    schedule: true,
  });
  const [officeIdentity, setOfficeIdentity] = useState(() => getActiveOfficeIdentity());

  React.useEffect(() => {
    const syncIdentity = () => setOfficeIdentity(getActiveOfficeIdentity());
    window.addEventListener('baf_office_config_changed', syncIdentity);
    window.addEventListener('baf_logo_updated', syncIdentity);
    window.addEventListener('baf_settings_updated', syncIdentity);
    window.addEventListener('storage', syncIdentity);
    return () => {
      window.removeEventListener('baf_office_config_changed', syncIdentity);
      window.removeEventListener('baf_logo_updated', syncIdentity);
      window.removeEventListener('baf_settings_updated', syncIdentity);
      window.removeEventListener('storage', syncIdentity);
    };
  }, []);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSelectTab = (tab: SidebarTab) => {
    setActiveTab(tab);
    setMobileOpen(false);
    try {
      window.scrollTo({ top: 0 });
    } catch {}
  };

  const renderNavButton = (
    tab: SidebarTab,
    icon: React.ReactNode,
    label: string,
    title?: string,
    badge?: React.ReactNode,
    forceExpanded: boolean = false,
    hasDotAlert: boolean = false
  ) => {
    const isCollapsed = forceExpanded ? false : collapsed;
    const isActive = activeTab === tab;
    return (
      <button
        type="button"
        key={tab}
        onClick={() => handleSelectTab(tab)}
        className={`relative flex items-center ${
          isCollapsed ? 'w-10 h-10 mx-auto justify-center p-0' : 'w-full justify-between px-3 py-2.5'
        } rounded-xl text-xs font-bold transition-colors duration-150 active:scale-[0.98] cursor-pointer overflow-hidden ${
          isActive
            ? 'bg-gradient-to-r from-[#059669] to-[#0d9488] dark:from-emerald-500 dark:to-teal-600 text-white shadow-md shadow-emerald-600/25 dark:shadow-emerald-900/50 border border-emerald-500/40 dark:border-emerald-400/30'
            : 'bg-white dark:bg-[#084228]/50 text-slate-700 dark:text-emerald-100 hover:bg-emerald-50/80 dark:hover:bg-[#0b4a2d] hover:text-emerald-950 dark:hover:text-white border border-[#d6eadf] dark:border-[#0d5635]/50 hover:border-emerald-300 dark:hover:border-[#11643d] shadow-2xs dark:shadow-none'
        }`}
        title={title || label}
      >
        <div className={`relative z-10 flex items-center ${isCollapsed ? 'justify-center' : 'justify-between w-full'}`}>
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'min-w-0 truncate'}`}>
            <span
              className={`shrink-0 flex items-center justify-center ${
                isActive ? 'text-white drop-shadow-sm' : 'text-slate-600 dark:text-emerald-300'
              }`}
            >
              {icon}
            </span>
            {!isCollapsed && <span className="ml-3 truncate">{label}</span>}
          </div>
          {!isCollapsed && badge && <div className="shrink-0 ml-2">{badge}</div>}
          {isCollapsed && hasDotAlert && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-[#083822]" />
          )}
        </div>
      </button>
    );
  };

  const renderSidebarContent = (isMobileDrawer: boolean) => {
    const isCollapsed = isMobileDrawer ? false : collapsed;
    const isAdminOrSuper =
      role === 'ADMIN' ||
      role === 'SUPER_ADMIN' ||
      role === 'OWNER' ||
      role === 'master_owner';
    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Brand Header */}
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-2.5 py-3 px-2 bg-[#e4f3eb] dark:bg-[#052818] border-b border-[#cde7d8] dark:border-[#0d4f31] shrink-0 transition-colors duration-300">
            <div className="shrink-0 drop-shadow-sm">
              <Logo155UASU className="h-9 w-9" />
            </div>
            {!isMobileDrawer && (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                className="hidden lg:flex items-center justify-center w-10 h-10 rounded-xl bg-white dark:bg-[#0c4e2f]/70 text-slate-600 dark:text-emerald-200 hover:text-emerald-700 dark:hover:text-white hover:bg-emerald-50 dark:hover:bg-[#11643d] border border-[#d6eadf] dark:border-[#11643d] hover:border-emerald-300 shadow-2xs transition-all duration-300 cursor-pointer"
                title="Expand Sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between h-16 px-3.5 bg-[#e4f3eb] dark:bg-[#052818] border-b border-[#cde7d8] dark:border-[#0d4f31] shrink-0 transition-colors duration-300">
            <div className="flex items-center space-x-2.5 min-w-0 overflow-hidden">
              <div className="shrink-0 drop-shadow-sm">
                <Logo155UASU className="h-10 w-10" />
              </div>
              <div className="leading-tight truncate">
                <div className="font-black text-sm tracking-wide text-slate-900 dark:text-white truncate">
                  {officeIdentity.officeName}
                </div>
                {officeIdentity.officeSlogan ? (
                  <div className="text-[10px] font-bold text-[#059669] dark:text-amber-400 uppercase tracking-wider truncate">
                    {officeIdentity.officeSlogan}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Desktop Collapse Toggle */}
            {!isMobileDrawer && (
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                className="hidden lg:flex items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-white/90 dark:bg-transparent border border-[#d6eadf] dark:border-transparent text-slate-600 dark:text-emerald-200/70 hover:text-emerald-700 dark:hover:text-white hover:bg-white dark:hover:bg-[#0c4e2f] shadow-2xs dark:shadow-none transition-all duration-300 cursor-pointer"
                title="Collapse Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            )}

            {/* Mobile Close Button (X) */}
            {isMobileDrawer && (
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center shrink-0 w-8 h-8 rounded-lg bg-white/90 dark:bg-transparent border border-[#d6eadf] dark:border-transparent text-slate-600 dark:text-emerald-200 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-[#0c4e2f] transition-colors cursor-pointer"
                title="Close Menu"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Scrollable Navigation Items */}
        <div className={`flex-1 overflow-y-auto ${isCollapsed ? 'px-2 py-3 space-y-2.5' : 'px-3 py-4 space-y-4'}`}>
          {/* SECTION 1: OVERVIEW */}
          <div>
            {!isCollapsed && (
              <button
                type="button"
                onClick={() => toggleSection('overview')}
                className="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#059669] dark:text-emerald-200/55 hover:text-[#047857] dark:hover:text-emerald-100 transition-colors cursor-pointer"
              >
                <span>OVERVIEW</span>
                <motion.span
                  animate={{ rotate: openSections.overview ? 0 : -90 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.span>
              </button>
            )}

            <AnimatePresence initial={false}>
              {(isCollapsed || openSections.overview) && (
                <motion.div
                  initial={isCollapsed ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={isCollapsed ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                  className={isCollapsed ? 'space-y-1.5' : 'mt-1.5 space-y-1.5 overflow-hidden'}
                >
                  {renderNavButton('overview', <LayoutDashboard className="w-4 h-4 shrink-0" />, 'Dashboard', 'Dashboard & Strength Overview', undefined, isMobileDrawer)}
                  {renderNavButton('parade-state', <ClipboardList className="w-4 h-4 shrink-0" />, 'Parade State', 'Daily Parade State (Official BAF Format)', undefined, isMobileDrawer)}
                  {renderNavButton('pt-state', <Activity className="w-4 h-4 shrink-0" />, 'PT State', 'Daily PT State', undefined, isMobileDrawer)}
                  {renderNavButton('others-state', <FileText className="w-4 h-4 shrink-0" />, 'Others State', 'Daily Others State (Official BAF Format)', undefined, isMobileDrawer)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* SECTION 2: ORG STRUCTURE */}
          <div className={isCollapsed ? 'pt-2.5 border-t border-[#cde7d8] dark:border-[#0d4f31]/60' : 'pt-2 border-t border-[#cde7d8]/80 dark:border-[#0d4f31]/40'}>
            {!isCollapsed && (
              <button
                type="button"
                onClick={() => toggleSection('orgStructure')}
                className="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#059669] dark:text-emerald-200/55 hover:text-[#047857] dark:hover:text-emerald-100 transition-colors cursor-pointer"
              >
                <span>ORG STRUCTURE</span>
                <motion.span
                  animate={{ rotate: openSections.orgStructure ? 0 : -90 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.span>
              </button>
            )}

            <AnimatePresence initial={false}>
              {(isCollapsed || openSections.orgStructure) && (
                <motion.div
                  initial={isCollapsed ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={isCollapsed ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                  className={isCollapsed ? 'space-y-1.5' : 'mt-1.5 space-y-1.5 overflow-hidden'}
                >
                  {renderNavButton(
                    'nominal',
                    <Layers className="w-4 h-4 shrink-0" />,
                    'Nominal Roll (Airmen)',
                    `Nominal Roll (${airmenCount} Airmen)`,
                    <span
                      className={`px-2 py-0.5 text-[10px] rounded-full font-black ${
                        activeTab === 'nominal'
                          ? 'bg-white/25 text-white'
                          : 'bg-emerald-100 dark:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200'
                      }`}
                    >
                      {airmenCount}
                    </span>,
                    isMobileDrawer
                  )}

                  {doesOfficeHaveFlights() &&
                    renderNavButton(
                      'flights',
                      <Building2 className="w-4 h-4 shrink-0" />,
                      'Flights & Sections',
                      'Flight Structure (Avionics, Mechanics, GCS, Admin)',
                      undefined,
                      isMobileDrawer
                    )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* SECTION 3: REGISTERS */}
          <div className={isCollapsed ? 'pt-2.5 border-t border-[#cde7d8] dark:border-[#0d4f31]/60' : 'pt-2 border-t border-[#cde7d8]/80 dark:border-[#0d4f31]/40'}>
            {!isCollapsed && (
              <button
                type="button"
                onClick={() => toggleSection('workforce')}
                className="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#059669] dark:text-emerald-200/55 hover:text-[#047857] dark:hover:text-emerald-100 transition-colors cursor-pointer"
              >
                <span>REGISTERS</span>
                <motion.span
                  animate={{ rotate: openSections.workforce ? 0 : -90 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.span>
              </button>
            )}

            <AnimatePresence initial={false}>
              {(isCollapsed || openSections.workforce) && (
                <motion.div
                  initial={isCollapsed ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={isCollapsed ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                  className={isCollapsed ? 'space-y-1.5' : 'mt-1.5 space-y-1.5 overflow-hidden'}
                >
                  {isAdminOrSuper && renderNavButton('biodata-register', <UserCircle className="w-4 h-4 shrink-0" />, 'Biodata Register', 'Biodata Register', undefined, isMobileDrawer)}
                  {renderNavButton(
                    'register',
                    <Calendar className="w-4 h-4 shrink-0" />,
                    'Attendance Register',
                    'Attendance Register',
                    conflictCount > 0 ? (
                      <span className="w-5 h-5 bg-amber-500 text-slate-950 text-[10px] font-black rounded-full flex items-center justify-center shadow-xs animate-pulse">
                        {conflictCount}
                      </span>
                    ) : undefined,
                    isMobileDrawer,
                    conflictCount > 0
                  )}
                  {renderNavButton('leave-register', <Users className="w-4 h-4 shrink-0" />, 'Leave Register', 'Leave Register (Casual & Annual Leave)', undefined, isMobileDrawer)}
                  {renderNavButton('tdy-register', <FileText className="w-4 h-4 shrink-0" />, 'TDY Register', 'TDY Register (Temporary Duty Outstation)', undefined, isMobileDrawer)}
                  {isDefault155UasuOffice() &&
                    renderNavButton('attachment-register', <FileText className="w-4 h-4 shrink-0" />, 'Deployment Register', 'Deployment Register (Bake & Bite, Canteen, Custom)', undefined, isMobileDrawer)}
                  {isAdminOrSuper && renderNavButton('duty-ratio', <Sliders className="w-4 h-4 shrink-0" />, 'Duty Ratio Matrix', 'Duty Ratio Matrix', undefined, isMobileDrawer)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* SECTION 4: ROSTER */}
          <div className={isCollapsed ? 'pt-2.5 border-t border-[#cde7d8] dark:border-[#0d4f31]/60' : 'pt-2 border-t border-[#cde7d8]/80 dark:border-[#0d4f31]/40'}>
            {!isCollapsed && (
              <button
                type="button"
                onClick={() => toggleSection('schedule')}
                className="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#059669] dark:text-emerald-200/55 hover:text-[#047857] dark:hover:text-emerald-100 transition-colors cursor-pointer"
              >
                <span>ROSTER</span>
                <motion.span
                  animate={{ rotate: openSections.schedule ? 0 : -90 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </motion.span>
              </button>
            )}

            <AnimatePresence initial={false}>
              {(isCollapsed || openSections.schedule) && (
                <motion.div
                  initial={isCollapsed ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={isCollapsed ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                  className={isCollapsed ? 'space-y-1.5' : 'mt-1.5 space-y-1.5 overflow-hidden'}
                >
                  {isDefault155UasuOffice() &&
                    renderNavButton('ida-center', <Clock className="w-4 h-4 shrink-0" />, 'IDA Center Duty', 'IDA Center Duty (Morning / Afternoon / Night)', undefined, isMobileDrawer)}
                  {renderNavButton('duty-roster', <FileText className="w-4 h-4 shrink-0" />, 'Duty Roster', 'Duty Roster Period & Export', undefined, isMobileDrawer)}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* SECTION 5: ANALYSIS & CONFLICTS (Admin & Super Admin only) */}
          {isAdminOrSuper && (
            <div className={isCollapsed ? 'pt-2.5 border-t border-[#cde7d8] dark:border-[#0d4f31]/60' : 'pt-2 border-t border-[#cde7d8]/80 dark:border-[#0d4f31]/40'}>
              {!isCollapsed && (
                <div className="w-full flex items-center justify-between px-1.5 py-1 text-[11px] font-black uppercase tracking-widest text-[#059669] dark:text-emerald-200/55">
                  <span>ANALYSIS</span>
                </div>
              )}
              <div className={isCollapsed ? 'space-y-1.5' : 'mt-1.5 space-y-1.5'}>
                {renderNavButton('analytics', <BarChart3 className="w-4 h-4 shrink-0" />, 'Duty Analysis', 'Duty Analytics & Load Balance', undefined, isMobileDrawer)}
                {renderNavButton(
                  'conflicts',
                  <ShieldAlert className="w-4 h-4 shrink-0" />,
                  'Conflict Monitor',
                  'Conflict Monitor & Rules',
                  conflictCount > 0 && !isCollapsed ? (
                    <span className="px-1.5 py-0.5 text-[9px] bg-red-600 text-white rounded-md font-bold">
                      {conflictCount} Alert
                    </span>
                  ) : undefined,
                  isMobileDrawer,
                  conflictCount > 0
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Session Profile (Expanded) */}
        {userSession && !isCollapsed && (
          <div className="px-3 py-2 border-t border-[#cde7d8] dark:border-[#0d4f31] bg-[#e4f3eb]/60 dark:bg-[#052818] shrink-0">
            <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-white dark:bg-[#083822]/70 border border-[#d6eadf] dark:border-[#0d5635]/60 shadow-2xs">
              <div className="flex items-center space-x-2.5 truncate">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-700/60 text-emerald-700 dark:text-emerald-200 flex items-center justify-center font-bold text-xs shrink-0">
                  <User className="w-3.5 h-3.5" />
                </div>
                <div className="truncate text-left leading-tight">
                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                    {userSession.rank} {userSession.name}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-emerald-300/80 truncate">
                    {userSession.bdNo}
                    {doesOfficeHaveFlights() && userSession.flightName
                      ? ` • ${userSession.flightName}`
                      : userSession.trade
                      ? ` • ${userSession.trade}`
                      : ''}
                  </div>
                </div>
              </div>

              {onLogoutUser && (
                <button
                  type="button"
                  onClick={onLogoutUser}
                  className="p-1.5 rounded-lg bg-slate-50 dark:bg-[#0c4e2f]/70 border border-slate-200 dark:border-[#11643d] text-slate-500 dark:text-emerald-300/80 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-[#0c4e2f] transition-colors cursor-pointer shrink-0 ml-2"
                  title="Logout User Session"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Settings & Install PWA Buttons in Sidebar Bottom */}
        <div className={`${isCollapsed ? 'px-2 py-2.5 space-y-2' : 'px-3 py-2 space-y-2'} border-t border-[#cde7d8] dark:border-[#0d4f31] bg-[#e4f3eb]/60 dark:bg-transparent shrink-0`}>
          <PWAInstallButton
            variant="sidebar"
            collapsed={isCollapsed}
            officeName={officeIdentity.officeName}
            officeLogo={officeIdentity.officeLogo}
          />
          {onOpenSettings && (
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onOpenSettings();
              }}
              className={`flex items-center ${
                isCollapsed ? 'w-10 h-10 mx-auto justify-center p-0' : 'w-full justify-start px-3 py-2.5 space-x-2.5'
              } rounded-xl bg-white dark:bg-[#084228]/50 border border-[#d6eadf] dark:border-[#0d5635]/50 text-slate-700 dark:text-emerald-100/90 hover:text-emerald-950 dark:hover:text-white hover:bg-emerald-50 dark:hover:bg-[#0c4e2f] hover:border-emerald-300 shadow-2xs text-xs font-bold transition-colors duration-150 active:scale-[0.98] cursor-pointer`}
              title="Settings"
            >
              <Settings className="w-4 h-4 text-slate-600 dark:text-emerald-300 shrink-0" />
              {!isCollapsed && <span>Settings</span>}
            </button>
          )}
        </div>

        {/* Footer Role & Unit Info (Shown cleanly when expanded) */}
        {!isCollapsed && (
          <div className="px-3 py-2 bg-[#dff0e7] dark:bg-[#042013] border-t border-[#cde7d8] dark:border-[#093c24] shrink-0">
            <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-emerald-300/60">
              <span className="font-semibold truncate">{officeIdentity.officeName}</span>
              <span className="text-[10px] text-[#059669] dark:text-emerald-400/70 font-mono font-bold">v2.5</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar (Permanent left sidebar for large screens) */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 hidden lg:flex flex-col bg-[#ebf7f1] dark:bg-[#083822] text-slate-800 dark:text-white border-r border-[#cde7d8] dark:border-[#0d4f31] transition-[width,background-color] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] select-none print:hidden ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer (Visible, slow and smooth slide-in from left when hamburger clicked) */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="mobile-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: 'easeInOut' }}
            className="fixed inset-0 bg-slate-900/40 dark:bg-black/55 backdrop-blur-[2px] z-50 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}
        {mobileOpen && (
          <motion.aside
            key="mobile-drawer"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
            className="fixed top-0 bottom-0 left-0 z-[60] flex flex-col w-72 max-w-[85vw] bg-[#ebf7f1] dark:bg-[#083822] text-slate-800 dark:text-white border-r border-[#cde7d8] dark:border-[#0d4f31] shadow-[12px_0_40px_rgba(15,23,42,0.22)] dark:shadow-[12px_0_40px_rgba(0,0,0,0.65)] select-none lg:hidden"
          >
            {renderSidebarContent(true)}
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
};

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DutyRatioConfigPanel } from './DutyRatioConfigPanelV4';

import {
  DutyRatioTable,
  getStoredDutyMatrix,
  saveDutyMatrix,
  resetDutyMatrixToDefault,
  getDutyRatioVersionForDate,
  getDutyRatioHistory,
  DutyRatioVersion,
  saveDutyRatioVersion,
} from '../data/officialDutyRatioMatrix';
import { formatShortDate } from '../utils/csvExport';
import { calculateBalancedAutoTargets, autoAllocateDutyMatrix, getTableDayReqForIndex, DEFAULT_MANPOWER, AllocationMode } from '../utils/dutyDistribution';
import { FlightName, UserRole } from '../types';
import { pushDutyListToCloud } from '../utils/dutyCloudSync';
import {
  Save,
  RotateCcw,
  Check,
  Info,
  Settings,
  Upload,
  Lock,
  X,
  Shield,
  Layers,
  Printer,
  Search,
  Sparkles,
  Sliders,
  ArrowLeft,
  Calendar,
  Eye,
  CheckCircle2, Clock, History, AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react';
import { exportDutyRatioDocx } from '../utils/docxExport';
import { ImportDutyRatioModal } from './ImportDutyRatioModal';
import { FlightDutyCalendarModal } from './FlightDutyCalendarModal';
import { PrintableDutyRatioModal, formatDisplayDate } from "./PrintableDutyRatioModal";
import { AutoAllocateModal } from './AutoAllocateModal';
import { DateNavigator } from './DateNavigator';
import { RatioHistoryModal } from './RatioHistoryModal';
import { getActiveOfficeIdentity, doesOfficeHaveFlights, isDefault155UasuOffice, getOfficeScopedStorageKey } from '../firebase';
import { localDb } from '../services/localDatabase';
import { isHolidayDate } from '../utils/holidayUtils';

const DUTY_RATIO_UNSAVED_DRAFT_KEY = 'baf_duty_ratio_unsaved_draft_v1';

interface DutyRatioUnsavedDraft {
  matrix: DutyRatioTable[];
  draftDisposals: Record<string, string>;
  draftManpower?: any;
  targetDate?: string;
  savedAt: number;
}

const loadDutyRatioUnsavedDraft = (): DutyRatioUnsavedDraft | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getOfficeScopedStorageKey(DUTY_RATIO_UNSAVED_DRAFT_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DutyRatioUnsavedDraft;
    if (!parsed || !Array.isArray(parsed.matrix) || parsed.matrix.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

interface DutyRatioMatrixViewProps {
  role?: UserRole;
  onRequestAdminAccess?: () => void;
  onConfirmNavigate?: (targetTab: string) => void;
}

const loadStoredDisposals = (targetDate?: string): Record<string, string> => {
  try {
    const master = localStorage.getItem('baf_duty_distribution_disposals_master');
    if (master) return JSON.parse(master);
    const current = localStorage.getItem('baf_duty_distribution_disposals_' + (targetDate || 'default'));
    if (current) return JSON.parse(current);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('baf_duty_distribution_disposals_')) {
        const val = localStorage.getItem(k);
        if (val && val !== '{}') return JSON.parse(val);
      }
    }
  } catch {}
  return {};
};

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const hasDutyOrFlightRatioChanged = (prevMatrix: DutyRatioTable[], nextMatrix: DutyRatioTable[]): boolean => {
  if (!Array.isArray(prevMatrix) || !Array.isArray(nextMatrix)) return true;
  if (prevMatrix.length !== nextMatrix.length) return true;

  const prevById = new Map(prevMatrix.map((t) => [t.id, t]));
  for (let i = 0; i < nextMatrix.length; i++) {
    const nextT = nextMatrix[i];
    const prevT = prevById.get(nextT.id) || prevMatrix[i];
    if (!prevT || prevT.id !== nextT.id) return true;
    if (Boolean(prevT.isDisabled) !== Boolean(nextT.isDisabled)) return true;
    if ((prevT.totalRequiredMonth || 0) !== (nextT.totalRequiredMonth || 0)) return true;
    if ((prevT.totalRequiredDaily || 0) !== (nextT.totalRequiredDaily || 0)) return true;
    if ((prevT.allotmentType || 'ratio') !== (nextT.allotmentType || 'ratio')) return true;
    if (JSON.stringify(prevT.dailyRequirements || []) !== JSON.stringify(nextT.dailyRequirements || [])) return true;
    if (JSON.stringify(prevT.eligibleFlights || []) !== JSON.stringify(nextT.eligibleFlights || [])) return true;
    if (JSON.stringify(prevT.eligibleRanks || []) !== JSON.stringify(nextT.eligibleRanks || [])) return true;
    if (JSON.stringify(prevT.flightTargets || {}) !== JSON.stringify(nextT.flightTargets || {})) return true;
    if (JSON.stringify(prevT.weeklyFlightTargets || {}) !== JSON.stringify(nextT.weeklyFlightTargets || {})) return true;
    if (JSON.stringify(prevT.data || {}) !== JSON.stringify(nextT.data || {})) return true;
  }
  return false;
};

const resolveInitialApplyDate = (): string => {
  const history = getDutyRatioHistory();
  const saved = localStorage.getItem('baf_duty_distribution_target_date');
  if (saved) {
    if (history.some((v) => v.applyFromDate === saved)) {
      return saved;
    }
    const verForSaved = getDutyRatioVersionForDate(saved);
    if (verForSaved?.applyFromDate) {
      return verForSaved.applyFromDate;
    }
  }
  if (history.length > 0) {
    return history[history.length - 1].applyFromDate;
  }
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
};

export const DutyRatioMatrixView: React.FC<DutyRatioMatrixViewProps> = ({
  role = 'ADMIN',
  onRequestAdminAccess,
  onConfirmNavigate,
}) => {
  const initialApplyDate = useMemo(() => resolveInitialApplyDate(), []);
  const initialUnsavedDraft = useMemo(() => loadDutyRatioUnsavedDraft(), []);

  const [savedApplyDate, setSavedApplyDate] = useState<string>(() => initialApplyDate);
  const [targetDate, setTargetDate] = useState<string>(() => initialUnsavedDraft?.targetDate || initialApplyDate);
  const [applyDateGuardMsg, setApplyDateGuardMsg] = useState<string | null>(null);
  const [restoredDraftNotice, setRestoredDraftNotice] = useState<boolean>(() => Boolean(initialUnsavedDraft));

  const persistedBaselineMatrix = useMemo(() => {
    const ver = getDutyRatioVersionForDate(initialApplyDate);
    if (ver && ver.matrix && ver.matrix.length > 0) return ver.matrix;
    return getStoredDutyMatrix(initialApplyDate);
  }, [initialApplyDate]);

  const persistedBaselineDisposals = useMemo(() => loadStoredDisposals(initialApplyDate), [initialApplyDate]);

  const [matrix, setMatrix] = useState<DutyRatioTable[]>(
    () => (initialUnsavedDraft?.matrix && initialUnsavedDraft.matrix.length > 0 ? initialUnsavedDraft.matrix : persistedBaselineMatrix)
  );
  const [savedMatrixJson, setSavedMatrixJson] = useState<string>(() => JSON.stringify(persistedBaselineMatrix));

  const [draftDisposals, setDraftDisposals] = useState<Record<string, string>>(
    () => (initialUnsavedDraft?.draftDisposals ? initialUnsavedDraft.draftDisposals : persistedBaselineDisposals)
  );
  const [savedDisposalsJson, setSavedDisposalsJson] = useState<string>(() => JSON.stringify(persistedBaselineDisposals));

  const [draftManpower, setDraftManpower] = useState<any>(() => {
    if (initialUnsavedDraft?.draftManpower) return initialUnsavedDraft.draftManpower;
    try {
      const saved = localStorage.getItem('baf_duty_distribution_manpower');
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_MANPOWER;
  });

  const [isSaved, setIsSaved] = useState<boolean>(false);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [selectedFlightFilter, setSelectedFlightFilter] = useState<FlightName | 'Overall'>('Overall');
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);
  const [printModalMode, setPrintModalMode] = useState<'ALL' | 'DUTY_RATIO_ONLY' | 'MANPOWER_ONLY'>('ALL');
  const [showAllTableInfo, setShowAllTableInfo] = useState<boolean>(false);
  const [settingsTableIdx, setSettingsTableIdx] = useState<number | null>(null);
  const [resetConfirmTableIdx, setResetConfirmTableIdx] = useState<number | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [flightViewMode, setFlightViewMode] = useState<'SCHEDULE' | 'DUTY_CARDS'>('SCHEDULE');

  // Monthly (31 Days) vs Weekly (7 Days) mode
  const [ratioPeriodMode, setRatioPeriodMode] = useState<'MONTHLY' | 'WEEKLY'>(() => {
    try {
      const saved = sessionStorage.getItem('baf_duty_ratio_period_mode');
      if (saved === 'WEEKLY' || saved === 'MONTHLY') return saved;
    } catch {}
    return 'MONTHLY';
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('baf_duty_ratio_period_mode', ratioPeriodMode);
    } catch {}
  }, [ratioPeriodMode]);

  const [dutyCellInputMode, setDutyCellInputMode] = useState<'click' | 'stepper'>(() => {
    try {
      const saved = localStorage.getItem('baf_duty_matrix_cell_input_mode');
      if (saved === 'click' || saved === 'stepper') return saved;
    } catch {}
    return 'click';
  });

  const handleDutyCellInputModeChange = (nextMode: 'click' | 'stepper') => {
    setDutyCellInputMode(nextMode);
    try {
      localStorage.setItem('baf_duty_matrix_cell_input_mode', nextMode);
    } catch {}
  };

  const getRunningTodayISO = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  };

  const getDutyWeekRange = (refDateStr?: string, offsetWeeks: number = 0) => {
    const effectiveRefStr = refDateStr || getRunningTodayISO();
    const [y, m, d] = effectiveRefStr.split('-').map(Number);
    const ref = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
    const day = ref.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 5 = Fri, 6 = Sat
    const daysSinceFriday = (day + 2) % 7;

    const start = new Date(ref);
    start.setUTCDate(ref.getUTCDate() - daysSinceFriday + offsetWeeks * 7);

    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);

    const format = (dObj: Date) => {
      const yy = dObj.getUTCFullYear();
      const mm = String(dObj.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(dObj.getUTCDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };

    return {
      from: format(start),
      to: format(end),
    };
  };

  const initialThisWeek = getDutyWeekRange(getRunningTodayISO(), 0);
  const [weeklyStartDate, setWeeklyStartDate] = useState<string>(() => initialThisWeek.from);
  const [weeklyEndDate, setWeeklyEndDate] = useState<string>(() => initialThisWeek.to);
  const [weeklyPreset, setWeeklyPreset] = useState<'THIS_WEEK' | 'NEXT_WEEK' | 'CUSTOM'>('THIS_WEEK');

  const [viewMode, setViewMode] = useState<'DUTY_DISTRIBUTION' | 'DUTY_RATIO' | 'MANPOWER' | 'DUTY_LIST'>(() => {
    try {
      const saved = sessionStorage.getItem('baf_duty_matrix_view_mode');
      if (saved === 'DUTY_DISTRIBUTION' || saved === 'DUTY_RATIO' || saved === 'MANPOWER' || saved === 'DUTY_LIST') {
        return saved;
      }
    } catch {}
    return 'DUTY_RATIO';
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('baf_duty_matrix_view_mode', viewMode);
    } catch {}
  }, [viewMode]);

  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);

  // Track whether Duty / Flight / Trade-wise duties themselves changed
  const hasDutyRatioChanges = useMemo(() => {
    try {
      const savedParsed: DutyRatioTable[] = JSON.parse(savedMatrixJson);
      return hasDutyOrFlightRatioChanged(savedParsed, matrix);
    } catch {
      return JSON.stringify(matrix) !== savedMatrixJson;
    }
  }, [matrix, savedMatrixJson]);

  // Keep localStorage aligned with persisted Apply Date (never write un-saved date changes)
  useEffect(() => {
    if (savedApplyDate) {
      localStorage.setItem('baf_duty_distribution_target_date', savedApplyDate);
    }
  }, [savedApplyDate]);

  // If user reverted Duty/Flt/Trade changes back to original, revert temporary new targetDate too
  useEffect(() => {
    if (!hasDutyRatioChanges && targetDate !== savedApplyDate) {
      const history = getDutyRatioHistory();
      if (!history.some((v) => v.applyFromDate === targetDate)) {
        setTargetDate(savedApplyDate);
      }
    }
  }, [hasDutyRatioChanges, targetDate, savedApplyDate]);

  // Unsaved changes tracking & navigation guard popup state
  const hasUnsavedChanges = useMemo(() => {
    return JSON.stringify(matrix) !== savedMatrixJson || JSON.stringify(draftDisposals) !== savedDisposalsJson;
  }, [matrix, savedMatrixJson, draftDisposals, savedDisposalsJson]);

  const [unsavedPromptAction, setUnsavedPromptAction] = useState<
    | { type: 'NAVIGATE_TAB'; targetTab: string }
    | { type: 'CHANGE_DATE'; nextDate: string }
    | null
  >(null);

  const draftSnapshotRef = useRef<{
    hasUnsavedChanges: boolean;
    matrix: DutyRatioTable[];
    draftDisposals: Record<string, string>;
    draftManpower: any;
    targetDate: string;
  }>({
    hasUnsavedChanges,
    matrix,
    draftDisposals,
    draftManpower,
    targetDate,
  });
  draftSnapshotRef.current = {
    hasUnsavedChanges,
    matrix,
    draftDisposals,
    draftManpower,
    targetDate,
  };

  useEffect(() => {
    const storageKey = getOfficeScopedStorageKey(DUTY_RATIO_UNSAVED_DRAFT_KEY);
    const persistDraft = () => {
      try {
        const cur = draftSnapshotRef.current;
        if (cur.hasUnsavedChanges) {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({
              matrix: cur.matrix,
              draftDisposals: cur.draftDisposals,
              draftManpower: cur.draftManpower,
              targetDate: cur.targetDate,
              savedAt: Date.now(),
            } as DutyRatioUnsavedDraft)
          );
        } else {
          window.localStorage.removeItem(storageKey);
        }
      } catch {}
    };
    persistDraft();

    if (typeof window !== 'undefined') {
      (window as any).__bafDutyRatioHasUnsavedChanges = hasUnsavedChanges;
    }
    const handleBeforeLogout = () => persistDraft();
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      persistDraft();
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('baf_prepare_auto_logout', handleBeforeLogout);
    window.addEventListener('baf_before_user_logout', handleBeforeLogout);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('baf_prepare_auto_logout', handleBeforeLogout);
      window.removeEventListener('baf_before_user_logout', handleBeforeLogout);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, matrix, draftDisposals, draftManpower, targetDate]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        (window as any).__bafDutyRatioHasUnsavedChanges = false;
      }
    };
  }, []);

  useEffect(() => {
    const handleLeaveRequest = (e: any) => {
      const targetTab = e?.detail?.targetTab;
      if (targetTab) {
        setUnsavedPromptAction({ type: 'NAVIGATE_TAB', targetTab });
      }
    };
    window.addEventListener('baf_duty_ratio_request_leave', handleLeaveRequest);
    return () => window.removeEventListener('baf_duty_ratio_request_leave', handleLeaveRequest);
  }, []);

  const loadMatrixForDate = (dateStr: string) => {
    const ver = getDutyRatioVersionForDate(dateStr);
    const loadedMatrix = (ver && ver.matrix && ver.matrix.length > 0) ? ver.matrix : getStoredDutyMatrix(dateStr);
    setMatrix(loadedMatrix);
    setSavedMatrixJson(JSON.stringify(loadedMatrix));
    const loadedDisp = loadStoredDisposals(dateStr);
    setDraftDisposals(loadedDisp);
    setSavedDisposalsJson(JSON.stringify(loadedDisp));
  };

  const handleRequestDateChange = (nextDate: string) => {
    if (!nextDate || nextDate === targetDate) return;
    const history = getDutyRatioHistory();
    const existingVersion = history.find((v) => v.applyFromDate === nextDate);

    // If Duty / Flight / Trade-wise duty was NOT changed, do not allow setting a brand new Apply Date
    if (!hasDutyRatioChanges && !existingVersion) {
      setApplyDateGuardMsg(
        `Duty / Flight / Trade-wise duty change না করলে নতুন Apply Date সেট হবে না — আগের Apply Date (${formatShortDate(savedApplyDate)})-ই কার্যকর থাকবে।`
      );
      setTimeout(() => setApplyDateGuardMsg(null), 4500);
      return;
    }

    // When Duty / Flight / Trade-wise duty HAS changed, allow setting the new Apply Date without losing pending edits
    if (hasDutyRatioChanges) {
      setApplyDateGuardMsg(null);
      setTargetDate(nextDate);
      return;
    }

    // Switching to an existing saved ratio version when no duty ratio changes are pending
    if (hasUnsavedChanges) {
      setUnsavedPromptAction({ type: 'CHANGE_DATE', nextDate });
      return;
    }
    setTargetDate(nextDate);
    setSavedApplyDate(nextDate);
    loadMatrixForDate(nextDate);
  };

  const activeVersion = useMemo(() => {
    return getDutyRatioVersionForDate(savedApplyDate || targetDate);
  }, [savedApplyDate, targetDate, savedMatrixJson]);

  const [settingsTab, setSettingsTab] = useState<'Overall' | 'Mechanics' | 'Avionics' | 'GCS' | null>(null);
  const [editingCalendar, setEditingCalendar] = useState<{tableIdx: number, flight: FlightName} | null>(null);
  const [autoAllocateToast, setAutoAllocateToast] = useState<boolean>(false);
  const [isAutoAllocateModalOpen, setIsAutoAllocateModalOpen] = useState<boolean>(false);
  const [allocatedModeInfo, setAllocatedModeInfo] = useState<{ mode: string, desc: string }>({
    mode: 'Single',
    desc: 'Duties distributed with optimal gaps',
  });

  const handleTriggerAutoAllocate = (allocMode: AllocationMode = 'SINGLE') => {
    const activeManpower = draftManpower || DEFAULT_MANPOWER;
    const weeklyTargetsByTable: Record<string, Partial<Record<FlightName, number>>> = {};
    if (ratioPeriodMode === 'WEEKLY') {
      matrix.forEach((t) => {
        if (t.isDisabled) return;
        weeklyTargetsByTable[t.id] = {};
        flights.forEach((fl) => {
          weeklyTargetsByTable[t.id][fl] = getPeriodFlightTarget(t, fl);
        });
      });
    }
    const allocatedMatrix = autoAllocateDutyMatrix(matrix, activeManpower, allocMode, {
      periodMode: ratioPeriodMode,
      dayIndices: ratioPeriodMode === 'WEEKLY' ? activeColumns.map(c => c.dayIdx) : undefined,
      weekRangeKey: weekRangeKey || undefined,
      weeklyTargetsByTable: ratioPeriodMode === 'WEEKLY' ? weeklyTargetsByTable : undefined,
      flightKeys: flights,
    });
    handleRatioCalculated(allocatedMatrix);
    const periodPrefix = ratioPeriodMode === 'WEEKLY'
      ? `Weekly (${formatShortDate(weeklyStartDate)} – ${formatShortDate(weeklyEndDate)}) • `
      : '';
    setAllocatedModeInfo({
      mode: `${periodPrefix}${allocMode === 'PACKAGE' ? 'Package (2-3 Days Consecutive)' : 'Single (Gap System)'}`,
      desc: allocMode === 'PACKAGE'
        ? 'Duties grouped into 2 to 3 consecutive days per block. Click Save to apply.'
        : 'Duties spread out with optimal rest gaps between days. Click Save to apply.',
    });
    setIsAutoAllocateModalOpen(false);
    setAutoAllocateToast(true);
    setTimeout(() => setAutoAllocateToast(false), 4000);
  };

  const daysArray = Array.from({ length: 31 }, (_, i) => i + 1);

  const activeColumns = useMemo(() => {
    if (ratioPeriodMode === 'MONTHLY') {
      const [tY, tM] = (targetDate || '2026-11-01').split('-').map(Number);
      const daysInTargetMonth = new Date(Date.UTC(tY || 2026, tM || 11, 0)).getUTCDate();
      return Array.from({ length: 31 }, (_, i) => {
        const dayNum = i + 1;
        const isValidCalendarDay = dayNum <= daysInTargetMonth;
        const isoStr = isValidCalendarDay
          ? `${tY || 2026}-${String(tM || 11).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
          : '';
        const dt = isValidCalendarDay ? new Date(Date.UTC(tY || 2026, (tM || 11) - 1, dayNum)) : null;
        const dow = dt ? dt.getUTCDay() : -1;
        return {
          key: `m_${dayNum}`,
          dayNum,
          dayIdx: i,
          dateStr: isoStr,
          dateLabel: String(dayNum),
          fullDateLabel: `Day ${dayNum}`,
          dayName: dow >= 0 ? DAY_NAMES_FULL[dow] : '',
          dayShort: dow >= 0 ? DAY_NAMES_SHORT[dow] : '',
          isOffDay: isoStr ? isHolidayDate(isoStr) : false,
        };
      });
    }
    const [sY, sM, sD] = (weeklyStartDate || targetDate).split('-').map(Number);
    const [eY, eM, eD] = (weeklyEndDate || weeklyStartDate || targetDate).split('-').map(Number);
    const startDt = new Date(Date.UTC(sY || 2026, (sM || 1) - 1, sD || 1));
    const endDt = new Date(Date.UTC(eY || 2026, (eM || 1) - 1, eD || 1));
    const diffDays = Math.round((endDt.getTime() - startDt.getTime()) / (1000 * 3600 * 24)) + 1;
    const spanCount = diffDays >= 1 && diffDays <= 31 ? diffDays : 7;

    return Array.from({ length: spanCount }, (_, offset) => {
      const dt = new Date(startDt.getTime());
      dt.setUTCDate(dt.getUTCDate() + offset);
      const dayOfMonth = dt.getUTCDate();
      const monthIdx = dt.getUTCMonth();
      const yearShort = String(dt.getUTCFullYear()).slice(-2);
      const dow = dt.getUTCDay();
      const ddStr = String(dayOfMonth).padStart(2, '0');
      const monStr = MONTH_NAMES_SHORT[monthIdx] || '';
      const isoStr = `${dt.getUTCFullYear()}-${String(monthIdx + 1).padStart(2, '0')}-${ddStr}`;
      return {
        key: `w_${isoStr}`,
        dayNum: dayOfMonth,
        dayIdx: Math.max(0, Math.min(30, dayOfMonth - 1)),
        dateStr: isoStr,
        dateLabel: `${ddStr} ${monStr}`,
        fullDateLabel: `${ddStr} ${monStr} ${yearShort}`,
        dayName: DAY_NAMES_FULL[dow],
        dayShort: DAY_NAMES_SHORT[dow],
        isOffDay: isHolidayDate(isoStr),
      };
    });
  }, [ratioPeriodMode, weeklyStartDate, weeklyEndDate, targetDate]);
  const [officeAirmen, setOfficeAirmen] = useState(() => localDb.getAirmen());
  useEffect(() => {
    const refresh = () => setOfficeAirmen(localDb.getAirmen());
    window.addEventListener('baf_data_updated', refresh);
    return () => window.removeEventListener('baf_data_updated', refresh);
  }, []);

  const officeHasFlights = useMemo(() => doesOfficeHaveFlights(officeAirmen), [officeAirmen]);
  const flights: FlightName[] = useMemo(() => {
    if (officeHasFlights) return ['Mechanics', 'Avionics', 'GCS', 'Admin'];
    const sgtAndBelow = officeAirmen.filter(a => !['MWO', 'SWO', 'WO'].includes(a.rank));
    const distinctTrades = Array.from(
      new Set(
        sgtAndBelow
          .map(a => String(a.trade || '').trim())
          .filter(tr => tr && tr !== '-' && tr !== 'N/A')
      )
    );
    return (distinctTrades.length > 0 ? distinctTrades : ['General']) as FlightName[];
  }, [officeHasFlights, officeAirmen]);

  // Flight name short codes
  const flightShortMap: Record<string, string> = {
    Mechanics: 'Mech',
    Avionics: 'AVI',
    GCS: 'GCS',
    Admin: 'Admin',
  };

  const getCompactDutyTitle = (table: DutyRatioTable): string => {
    const t = (table.title || '').toUpperCase();
    if (t.includes('SECURITY')) return 'Base Sec';
    if (t.includes('BASE TASKFORCE') || t.includes('BASE TF')) return 'Base TF';
    if (t.includes('NAJIRPARA') || t.includes('NAZIRPARA')) return 'Najirpara';
    if (t.includes('IDAC') && t.includes('MORNING')) return 'IDAC (M)';
    if (t.includes('IDAC') && t.includes('AFTERNOON')) return 'IDAC (A)';
    if (t.includes('IDAC') && t.includes('NIGHT')) return 'IDAC (N)';
    if (t.includes('AIRFIELD') || t.includes('AIRPORT')) return 'Airfield';
    if (t.includes('RECEPTION') || t.includes('RECEIPTION')) return 'Reception';
    if (t.includes('HALISHAHAR')) return 'Halishahar';
    return table.dutyCode || table.title.slice(0, 10);
  };

  // Color schemes for each table matching official sheet colors
  const tableColorMap: Record<string, { header: string; badge: string; border: string }> = {
    security_duty: {
      header: 'bg-blue-700 text-white dark:bg-blue-900',
      badge: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
      border: 'border-blue-300 dark:border-blue-800',
    },
    nazirpara_tf: {
      header: 'bg-amber-500 text-slate-950 font-black dark:bg-amber-600',
      badge: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
      border: 'border-amber-300 dark:border-amber-800',
    },
    base_tf: {
      header: 'bg-sky-800 text-white dark:bg-sky-950',
      badge: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
      border: 'border-sky-300 dark:border-sky-800',
    },
    idac_mor: {
      header: 'bg-yellow-400 text-slate-950 font-black dark:bg-yellow-500',
      badge: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200',
      border: 'border-yellow-300 dark:border-yellow-700',
    },
    idac_an: {
      header: 'bg-slate-700 text-slate-100 dark:bg-emerald-800',
      badge: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
      border: 'border-emerald-300 dark:border-emerald-800',
    },
    idac_nt: {
      header: 'bg-red-600 text-white dark:bg-red-800',
      badge: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
      border: 'border-red-300 dark:border-red-800',
    },
    airport_duty: {
      header: 'bg-purple-700 text-white dark:bg-purple-900',
      badge: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200',
      border: 'border-purple-300 dark:border-purple-800',
    },
    halishahar_duty: {
      header: 'bg-teal-700 text-white dark:bg-teal-900',
      badge: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200',
      border: 'border-teal-300 dark:border-teal-800',
    },
  };

  const handleCellChange = (
    tableIndex: number,
    flight: FlightName,
    dayIndex: number,
    valStr: string
  ) => {
    const num = Math.max(0, parseInt(valStr, 10) || 0);
    const updated = [...matrix];
    const tableObj = { ...updated[tableIndex] };
    const flightData = { ...tableObj.data };
    const arr = [...(flightData[flight] || Array(31).fill(0))];
    arr[dayIndex] = num;
    flightData[flight] = arr;
    tableObj.data = flightData;
    updated[tableIndex] = tableObj;
    setMatrix(updated);
  };

  const handleToggleFlightDutyCell = (
    tableId: string,
    flight: FlightName,
    dayIndex: number,
    forceVal?: number
  ) => {
    const tableIndex = matrix.findIndex(t => t.id === tableId);
    if (tableIndex === -1) return;

    const currentVal = matrix[tableIndex].data[flight]?.[dayIndex] || 0;
    let nextVal = 0;
    if (forceVal !== undefined) {
      nextVal = forceVal;
    } else {
      nextVal = currentVal > 0 ? 0 : 1;
    }

    const updated = matrix.map((t, idx) => {
      if (idx !== tableIndex) return t;
      const flightData = { ...t.data };
      const arr = [...(flightData[flight] || Array(31).fill(0))];
      arr[dayIndex] = nextVal;
      flightData[flight] = arr;
      return {
        ...t,
        data: flightData,
      };
    });

    setMatrix(updated);
  };

  const handleResetTable = (tableIndex: number) => {
    setResetConfirmTableIdx(tableIndex);
  };

  const confirmResetTable = () => {
    if (resetConfirmTableIdx === null) return;
    const updated = [...matrix];
    const tableObj = { ...updated[resetConfirmTableIdx] };
    const flightData = { ...tableObj.data };
    if (ratioPeriodMode === 'WEEKLY') {
      flights.forEach(f => {
        const arr = [...(flightData[f] || new Array(31).fill(0))];
        activeColumns.forEach(col => {
          arr[col.dayIdx] = 0;
        });
        flightData[f] = arr;
      });
    } else {
      flights.forEach(f => {
        flightData[f] = new Array(31).fill(0);
      });
    }
    tableObj.data = flightData;
    updated[resetConfirmTableIdx] = tableObj;
    setMatrix(updated);
    setResetConfirmTableIdx(null);
  };

  const handleSave = () => {
    const effectiveApplyDate = hasDutyRatioChanges ? targetDate : savedApplyDate;

    // 1. Persist disposals & manpower if edited
    const valStr = JSON.stringify(draftDisposals);
    localStorage.setItem('baf_duty_distribution_disposals_master', valStr);
    const dateKey = effectiveApplyDate || 'default';
    const storageKey = 'baf_duty_distribution_disposals_' + dateKey;
    localStorage.setItem(storageKey, valStr);
    const pendingKey = 'baf_pending_disposals_sync_baf_duty_distribution_disposals_master';
    localStorage.setItem(pendingKey, String(Date.now()));
    localDb.syncSettingToCloud('baf_duty_distribution_disposals_master', valStr).then(() => {
      setTimeout(() => {
        localStorage.removeItem(pendingKey);
      }, 5000);
    });
    localDb.syncSettingToCloud(storageKey, valStr);

    if (draftManpower) {
      localStorage.setItem('baf_duty_distribution_manpower', JSON.stringify(draftManpower));
    }

    // 2. Only create/update an Apply Date ratio version if Duty / Flight / Trade-wise duty actually changed
    if (hasDutyRatioChanges) {
      saveDutyMatrix(matrix, { skipHistorySync: true, targetDate: effectiveApplyDate });
      const formatted = formatShortDate(effectiveApplyDate);
      const title = `All Duty Ratio (${formatted})`;
      saveDutyRatioVersion({
        applyFromDate: effectiveApplyDate,
        title,
        matrix,
        notes: `Saved for Apply From: ${effectiveApplyDate}`,
      });
      setSavedApplyDate(effectiveApplyDate);
      localStorage.setItem('baf_duty_distribution_target_date', effectiveApplyDate);
      pushDutyListToCloud(matrix).catch(err => console.warn('[DutyRatioMatrixViewV2] Cloud sync error:', err));
    } else {
      // Continue with previous Apply Date — do NOT advance Apply Date or create a new version
      if (targetDate !== savedApplyDate) {
        setTargetDate(savedApplyDate);
      }
      localStorage.setItem('baf_duty_distribution_target_date', savedApplyDate);
      if (JSON.stringify(matrix) !== savedMatrixJson) {
        saveDutyMatrix(matrix, { targetDate: savedApplyDate });
        pushDutyListToCloud(matrix).catch(err => console.warn('[DutyRatioMatrixViewV2] Cloud sync error:', err));
      }
    }

    // 4. Mark clean
    setSavedMatrixJson(JSON.stringify(matrix));
    setSavedDisposalsJson(valStr);
    setRestoredDraftNotice(false);
    try {
      window.localStorage.removeItem(getOfficeScopedStorageKey(DUTY_RATIO_UNSAVED_DRAFT_KEY));
    } catch {}
    if (typeof window !== 'undefined') {
      (window as any).__bafDutyRatioHasUnsavedChanges = false;
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleDiscardChanges = () => {
    try {
      setMatrix(JSON.parse(savedMatrixJson));
      setDraftDisposals(JSON.parse(savedDisposalsJson));
      setTargetDate(savedApplyDate);
      setApplyDateGuardMsg(null);
      setRestoredDraftNotice(false);
      window.localStorage.removeItem(getOfficeScopedStorageKey(DUTY_RATIO_UNSAVED_DRAFT_KEY));
      if (typeof window !== 'undefined') {
        (window as any).__bafDutyRatioHasUnsavedChanges = false;
      }
    } catch {}
  };

  const handleReset = () => {
    if (window.confirm(`Reset all duty ratios to the official ${getActiveOfficeIdentity().officeName} default template?`)) {
      const def = resetDutyMatrixToDefault();
      setMatrix(def);
    }
  };

  const handleImportRatioComplete = (newMatrix: DutyRatioTable[]) => {
    setMatrix(newMatrix);
  };

  const getTableDayRequirement = (table: DutyRatioTable, dayIdx: number): number => {
    return getTableDayReqForIndex(table, dayIdx);
  };

  const getPeriodTableTarget = (table: DutyRatioTable): number => {
    if (table.isDisabled) return 0;
    if (ratioPeriodMode === 'MONTHLY') {
      return table.totalRequiredMonth || 0;
    }
    return activeColumns.reduce((sum, col) => sum + getTableDayRequirement(table, col.dayIdx), 0);
  };

  const weekRangeKey = useMemo(() => {
    if (ratioPeriodMode !== 'WEEKLY') return '';
    return `${weeklyStartDate || targetDate || 'default'}_${weeklyEndDate || weeklyStartDate || targetDate || 'default'}`;
  }, [ratioPeriodMode, weeklyStartDate, weeklyEndDate, targetDate]);

  const periodDayIndices = useMemo(() => {
    return ratioPeriodMode === 'WEEKLY' ? activeColumns.map(c => c.dayIdx) : undefined;
  }, [ratioPeriodMode, activeColumns]);

  // Calculate Auto Targets with Cross-Duty Workload Balancing
  const currentManpower = draftManpower || DEFAULT_MANPOWER;
  const autoTargets = calculateBalancedAutoTargets(matrix, currentManpower, false);
  const weeklyAutoTargets = useMemo(() => {
    if (ratioPeriodMode !== 'WEEKLY') return null;
    return calculateBalancedAutoTargets(matrix, currentManpower, false, periodDayIndices);
  }, [ratioPeriodMode, matrix, currentManpower, periodDayIndices]);

  const getFlightTarget = (table: DutyRatioTable, fl: FlightName): number => {
    if (table.isDisabled) return 0;
    if (table.flightTargets && typeof (table.flightTargets as any)[fl] === 'number') {
      return (table.flightTargets as any)[fl]!;
    }
    if (!officeHasFlights) {
      const idx = flights.indexOf(fl);
      const mappedKey: FlightName = idx === 0 ? 'Mechanics' : idx === 1 ? 'Avionics' : idx === 2 ? 'GCS' : 'Admin';
      return autoTargets?.[mappedKey]?.[table.id] ?? 0;
    }
    return autoTargets?.[fl]?.[table.id] ?? 0;
  };

  const getPeriodFlightTarget = (table: DutyRatioTable, fl: FlightName): number => {
    if (table.isDisabled) return 0;
    if (ratioPeriodMode === 'MONTHLY') {
      return getFlightTarget(table, fl);
    }
    if (officeHasFlights && table.eligibleFlights && !table.eligibleFlights.includes(fl as any)) {
      return 0;
    }
    const weeklyManual = weekRangeKey ? table.weeklyFlightTargets?.[weekRangeKey]?.[fl] : undefined;
    if (typeof weeklyManual === 'number') {
      return weeklyManual;
    }
    if (!officeHasFlights) {
      const idx = flights.indexOf(fl);
      const mappedKey: FlightName = idx === 0 ? 'Mechanics' : idx === 1 ? 'Avionics' : idx === 2 ? 'GCS' : 'Admin';
      return weeklyAutoTargets?.[mappedKey]?.[table.id] ?? 0;
    }
    return weeklyAutoTargets?.[fl]?.[table.id] ?? 0;
  };

  // Grand totals calculation
  const totalSlotsOverall = matrix.filter(t => !t.isDisabled).reduce((sum, table) => {
    if (selectedFlightFilter === 'Overall') return sum + (table.totalRequiredMonth || 0);
    return sum + getFlightTarget(table, selectedFlightFilter as FlightName);
  }, 0);

  const periodTotalSlotsOverall = matrix.filter(t => !t.isDisabled).reduce((sum, table) => {
    if (selectedFlightFilter === 'Overall') return sum + getPeriodTableTarget(table);
    return sum + getPeriodFlightTarget(table, selectedFlightFilter as FlightName);
  }, 0);

  const flightTotalsOverall: Record<string, number> = {
    Mechanics: 0,
    Avionics: 0,
    GCS: 0,
    Admin: 0,
  };
  const periodFlightTotalsOverall: Record<string, number> = {
    Mechanics: 0,
    Avionics: 0,
    GCS: 0,
    Admin: 0,
  };
  flights.forEach(fl => {
    flightTotalsOverall[fl] = 0;
    periodFlightTotalsOverall[fl] = 0;
  });

  matrix.filter(t => !t.isDisabled).forEach((table) => {
    flights.forEach((fl) => {
      const arr = table.data?.[fl] || [];
      flightTotalsOverall[fl] = (flightTotalsOverall[fl] || 0) + arr.reduce((s, c) => s + (Number(c) || 0), 0);
      periodFlightTotalsOverall[fl] =
        (periodFlightTotalsOverall[fl] || 0) +
        (ratioPeriodMode === 'WEEKLY'
          ? activeColumns.reduce((acc, col) => acc + (Number(arr[col.dayIdx]) || 0), 0)
          : arr.reduce((s, c) => s + (Number(c) || 0), 0));
    });
  });

  const targetFlightTotal = selectedFlightFilter !== 'Overall'
    ? matrix.filter(t => !t.isDisabled).reduce((sum, t) => {
        return sum + getFlightTarget(t, selectedFlightFilter as FlightName);
      }, 0)
    : 0;

  const periodTargetFlightTotal = selectedFlightFilter !== 'Overall'
    ? matrix.filter(t => !t.isDisabled).reduce((sum, t) => {
        return sum + getPeriodFlightTarget(t, selectedFlightFilter as FlightName);
      }, 0)
    : 0;

  const handleRatioCalculated = (newMatrix: DutyRatioTable[]) => {
    setMatrix(newMatrix);
  };

  return (
    <div className="w-full flex flex-col bg-slate-50 dark:bg-slate-900 print:bg-white print:overflow-visible">
      <div className="w-full pt-2 px-1 sm:px-2 md:px-3 max-w-none mx-auto animate-fadeIn space-y-4 print:hidden">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center space-x-3.5">
          <div className="p-3 bg-slate-800 text-slate-100 rounded-2xl shadow-md">
            <Sliders className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                {getActiveOfficeIdentity().officeName} • Duty Ratio
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                Official Roster Scale
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isDefault155UasuOffice()
                ? 'Configured daily quota ratio for Security Duty, Nazirpara T/F, Base T/F, and IDAC Shifts (Days 1–31).'
                : 'Configured daily quota ratio for Base Security Duty, Base Taskforce Duty, Najirpara Taskforce Duty, Airfield Duty, and Halishahar Duty.'}
            </p>
        </div>

        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2 self-end md:self-auto">
          {isSaved && (
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center space-x-1.5 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Saved</span>
            </div>
          )}

          {(role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OWNER') ? (
            <>
              <button
                type="button"
                onClick={() => setIsHistoryModalOpen(true)}
                className="px-3 py-2 text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-xl transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
                title="View Ratio History"
              >
                <History className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>History</span>
              </button>

              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
                title="Import Duty Ratio Matrix from CSV / Excel"
              >
                <Upload className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                <span>Import Matrix</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPrintModalMode('ALL');
                  setIsPrintModalOpen(true);
                }}
                className="px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center space-x-1.5 shadow-xs cursor-pointer"
                title="Print Preview / Export"
              >
                <Printer className="w-4 h-4" />
                <span className="hidden sm:inline">Official Export/Print</span>
              </button>
            </>
          ) : (
          <button
            onClick={onRequestAdminAccess}
            className="px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors flex items-center space-x-2"
          >
            <Lock className="w-4 h-4 text-slate-500" />
            <span>Request Edit Access</span>
          </button>
        )}

        {/* Auto-saved instantly, button removed as requested */}
    </div>
    </div> {/* CLOSE Top Banner & Header */}

    {/* CONTROLS SECTION */}
    <div className="flex flex-col items-center justify-center space-y-4">
      {/* APPLY FROM DATE & SAVE BUTTON */}
      <div className="flex flex-col items-center justify-center mx-auto">
        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 flex items-center justify-center gap-1.5">
          <span>Apply From:</span>
          {hasUnsavedChanges && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700 text-[9px] font-black uppercase animate-pulse">
              Unsaved Changes
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <DateNavigator
            value={targetDate}
            onChange={(e) => handleRequestDateChange(e.target.value)}
            format="dd_mm_yy"
            className="px-3.5 py-1.5 font-bold text-indigo-700 dark:text-indigo-400 text-xs sm:text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-center shadow-xs hover:border-indigo-500 transition-colors flex items-center justify-center gap-2 min-w-[125px]"
          />
          <button
            type="button"
            onClick={handleSave}
            className={`px-4 py-1.5 active:scale-95 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1.5 cursor-pointer transition-all ${
              hasUnsavedChanges
                ? 'bg-amber-600 hover:bg-amber-700 ring-2 ring-amber-400/60 shadow-md'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
            title="Save and apply current duty ratio changes"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{hasUnsavedChanges ? 'Save & Apply' : 'Save'}</span>
          </button>
          {hasUnsavedChanges && (
            <button
              type="button"
              onClick={handleDiscardChanges}
              className="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-rose-100 dark:hover:bg-rose-950/50 text-slate-700 dark:text-slate-300 hover:text-rose-700 dark:hover:text-rose-300 border border-slate-300 dark:border-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
              title="Discard unsaved changes"
            >
              Discard
            </button>
          )}
        </div>
        {restoredDraftNotice && hasUnsavedChanges && (
          <div className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700/80 text-emerald-800 dark:text-emerald-300 text-[11px] font-semibold flex items-center gap-1.5 shadow-xs animate-fadeIn">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>পূর্ববর্তী সেশনের অসংরক্ষিত পরিবর্তনগুলো পুনরুদ্ধার করা হয়েছে — কার্যকর করতে Save &amp; Apply চাপুন।</span>
          </div>
        )}
        {applyDateGuardMsg && (
          <div className="mt-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-700/80 text-amber-800 dark:text-amber-300 text-[11px] font-semibold flex items-center gap-1.5 shadow-xs animate-fadeIn">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>{applyDateGuardMsg}</span>
          </div>
        )}
      </div>

      {/* MONTHLY (31 DAYS) vs WEEKLY (7 DAYS) TOP OPTION */}
      <div className="flex flex-col items-center justify-center gap-2 w-full">
        <div className="inline-flex items-center p-1 rounded-xl bg-slate-200/80 dark:bg-slate-800 border border-slate-300/70 dark:border-slate-700 shadow-xs">
          <button
            type="button"
            onClick={() => setRatioPeriodMode('MONTHLY')}
            className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              ratioPeriodMode === 'MONTHLY'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Monthly (31 Days)</span>
          </button>
          <button
            type="button"
            onClick={() => setRatioPeriodMode('WEEKLY')}
            className={`px-4 py-1.5 rounded-lg text-xs sm:text-sm font-black transition-all cursor-pointer flex items-center gap-1.5 ${
              ratioPeriodMode === 'WEEKLY'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Weekly (7 Days)</span>
          </button>
        </div>

        {ratioPeriodMode === 'WEEKLY' && (
          <div className="flex flex-col items-center justify-center gap-2 w-full">
            {/* Row 1: This Week (Fri – Thu) & Next Week (Fri – Thu) matching Pic 2 */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold space-x-1 shadow-2xs">
              <button
                type="button"
                onClick={() => {
                  const range = getDutyWeekRange(getRunningTodayISO(), 0);
                  setWeeklyStartDate(range.from);
                  setWeeklyEndDate(range.to);
                  setWeeklyPreset('THIS_WEEK');
                }}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  weeklyPreset === 'THIS_WEEK'
                    ? 'bg-emerald-600 text-white shadow-xs font-black'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
                }`}
              >
                This Week (Fri – Thu)
              </button>
              <button
                type="button"
                onClick={() => {
                  const range = getDutyWeekRange(getRunningTodayISO(), 1);
                  setWeeklyStartDate(range.from);
                  setWeeklyEndDate(range.to);
                  setWeeklyPreset('NEXT_WEEK');
                }}
                className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                  weeklyPreset === 'NEXT_WEEK'
                    ? 'bg-emerald-600 text-white shadow-xs font-black'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
                }`}
              >
                Next Week (Fri – Thu)
              </button>
            </div>

            {/* Row 2: From Date -> To Date matching Pic 2 */}
            <div className="flex flex-wrap items-center justify-center bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold gap-2 shadow-2xs">
              <span className="text-slate-500 dark:text-slate-400 font-semibold">From:</span>
              <DateNavigator
                value={weeklyStartDate || ''}
                onChange={(e) => {
                  const nextFrom = e.target.value;
                  if (nextFrom) {
                    setWeeklyStartDate(nextFrom);
                    const [y, m, d] = nextFrom.split('-').map(Number);
                    const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1));
                    dt.setUTCDate(dt.getUTCDate() + 6);
                    const nextTo = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
                    setWeeklyEndDate(nextTo);
                    setWeeklyPreset('CUSTOM');
                  }
                }}
                className="bg-transparent text-slate-900 dark:text-white font-black outline-none cursor-pointer"
              />
              <span className="text-slate-400 dark:text-slate-500 font-semibold">To:</span>
              <DateNavigator
                value={weeklyEndDate || ''}
                onChange={(e) => {
                  const nextTo = e.target.value;
                  if (nextTo) {
                    setWeeklyEndDate(nextTo);
                    if (nextTo < weeklyStartDate) {
                      setWeeklyStartDate(nextTo);
                    }
                    setWeeklyPreset('CUSTOM');
                  }
                }}
                className="bg-transparent text-slate-900 dark:text-white font-black outline-none cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>

      {/* TAB NAVIGATION */}
      <div className="flex flex-wrap space-x-1 sm:space-x-2 bg-slate-200/50 dark:bg-slate-800/50 p-1.5 rounded-xl w-full max-w-3xl mx-auto justify-center">
        <button 
          onClick={() => setViewMode('DUTY_LIST')}
          className={`flex-1 py-2 px-2 sm:px-4 text-xs sm:text-sm font-bold rounded-lg transition-colors ${viewMode === 'DUTY_LIST' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/50'}`}
        >Duty List</button>
        <button 
          onClick={() => setViewMode('MANPOWER')}
          className={`flex-1 py-2 px-2 sm:px-4 text-xs sm:text-sm font-bold rounded-lg transition-colors ${viewMode === 'MANPOWER' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/50'}`}
        >Manpower</button>
        <button 
          onClick={() => setViewMode('DUTY_DISTRIBUTION')}
          className={`flex-1 py-2 px-2 sm:px-4 text-xs sm:text-sm font-bold rounded-lg transition-colors ${viewMode === 'DUTY_DISTRIBUTION' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/50'}`}
        >Distribution</button>
        <button 
          onClick={() => setViewMode('DUTY_RATIO')}
          className={`flex-1 py-2 px-2 sm:px-4 text-xs sm:text-sm font-bold rounded-lg transition-colors ${viewMode === 'DUTY_RATIO' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700/50'}`}
        >Duty Ratio</button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-0 sm:p-1 md:p-2 scroll-smooth print:hidden">
      <div className="w-full max-w-none mx-auto space-y-6">
        
        {viewMode !== 'DUTY_RATIO' && (
          <DutyRatioConfigPanel
            activeTab={viewMode as any}
            matrix={matrix}
            onMatrixChange={handleRatioCalculated}
            targetDate={targetDate}
            disposalsProp={draftDisposals}
            onDisposalsChange={setDraftDisposals}
            onManpowerChange={setDraftManpower}
            ratioPeriodMode={ratioPeriodMode}
            weeklyStartDate={weeklyStartDate}
            weeklyEndDate={weeklyEndDate}
            activeColumns={activeColumns}
          />
        )}

                {viewMode === 'DUTY_RATIO' && (
          <>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 mb-6">
              <div className="flex items-center space-x-2 text-sm font-bold text-slate-700 dark:text-slate-300">
                <Layers className="w-4 h-4 text-indigo-500" />
                <span>{officeHasFlights ? 'Flight Filter:' : 'Trade Filter:'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {['Overall', ...flights].map((fl) => (
                  <button
                    key={fl}
                    onClick={() => setSelectedFlightFilter(fl as any)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      selectedFlightFilter === fl
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {fl}
                  </button>
                ))}
              </div>
            </div>

            {autoAllocateToast && (
              <div className="fixed top-20 right-4 z-50 bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-3 border border-emerald-400/40 animate-in fade-in slide-in-from-top-4">
                <Sparkles className="w-5 h-5 text-amber-300 shrink-0" />
                <div>
                  <div className="font-bold text-sm">{allocatedModeInfo.mode} Complete!</div>
                  <div className="text-xs text-emerald-100">{allocatedModeInfo.desc}</div>
                </div>
              </div>
            )}
            
            <div className="flex flex-col items-center justify-center gap-2 mb-6">
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => setShowAllTableInfo(!showAllTableInfo)}
                  className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold transition-all shadow-sm border ${showAllTableInfo ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  <Info className="w-4 h-4" />
                  <span>{showAllTableInfo ? 'Hide Info' : 'Show Info'}</span>
                </button>

                {(role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OWNER') ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsAutoAllocateModalOpen(true)}
                      className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-sm hover:shadow-md transition-all cursor-pointer"
                      title="Auto Allocate Daily Duties based on balanced manpower ratio"
                    >
                      <Sparkles className="w-4 h-4 text-amber-300 animate-pulse" />
                      <span>Auto Allocate</span>
                    </button>

                    {/* Manual Duty Cell Input Mode Toggle: Click System vs + / - System */}
                    <div className="inline-flex items-center bg-slate-200/80 dark:bg-slate-800 p-1 rounded-xl border border-slate-300/80 dark:border-slate-700 shadow-xs">
                      <button
                        type="button"
                        onClick={() => handleDutyCellInputModeChange('click')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          dutyCellInputMode === 'click'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                        title="Click cell for 1/0, right-click or double-click for 2"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${dutyCellInputMode === 'click' ? 'bg-emerald-300' : 'bg-slate-400 dark:bg-slate-600'}`} />
                        <span>Click System</span>
                        <span className={`text-[10px] px-1 py-0.2 rounded font-extrabold ${dutyCellInputMode === 'click' ? 'bg-white/20 text-white' : 'bg-slate-300/60 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                          {dutyCellInputMode === 'click' ? 'ON' : 'OFF'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDutyCellInputModeChange('stepper')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          dutyCellInputMode === 'stepper'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                        }`}
                        title="Use + / - buttons inside each cell to adjust duty count"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${dutyCellInputMode === 'stepper' ? 'bg-emerald-300' : 'bg-slate-400 dark:bg-slate-600'}`} />
                        <span>+ / - System</span>
                        <span className={`text-[10px] px-1 py-0.2 rounded font-extrabold ${dutyCellInputMode === 'stepper' ? 'bg-white/20 text-white' : 'bg-slate-300/60 dark:bg-slate-700 text-slate-500 dark:text-slate-400'}`}>
                          {dutyCellInputMode === 'stepper' ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={onRequestAdminAccess}
                    className="flex items-center space-x-2 px-4 py-2 rounded-xl text-sm font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 cursor-pointer"
                    title="Admin access required to Auto Allocate"
                  >
                    <Lock className="w-4 h-4 text-slate-400" />
                    <span>Auto Allocate</span>
                  </button>
                )}
              </div>
            </div>

            {showAllTableInfo && (
              <div className="bg-indigo-50/90 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl p-4 shadow-xs mb-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center space-x-2.5">
                    <Info className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <div>
                      <h4 className="font-black text-sm text-indigo-950 dark:text-indigo-200">
                        {selectedFlightFilter === 'Overall' ? 'Overall Unit Duty Ratio Matrix' : `${selectedFlightFilter} ${officeHasFlights ? 'Flight' : 'Trade'} Quota & Target Info`}
                      </h4>
                      <p className="text-xs text-indigo-700 dark:text-indigo-300">
                        {selectedFlightFilter === 'Overall'
                          ? `${ratioPeriodMode === 'WEEKLY' ? '7-Day Target' : 'Month Target'}: ${periodTotalSlotsOverall} slots distributed across all ${officeHasFlights ? 'flights' : 'trades'}`
                          : `Allocated Total: ${periodFlightTotalsOverall[selectedFlightFilter as FlightName] || 0} / Target Total: ${periodTargetFlightTotal}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
                    {selectedFlightFilter === 'Overall' ? (
                      <>
                        <span className="inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-md">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
                          <span>Target Matched</span>
                        </span>
                        <span className="inline-flex items-center space-x-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-400 px-2.5 py-1 rounded-md">
                          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
                          <span>Under Quota (Yellow Border)</span>
                        </span>
                        <span className="inline-flex items-center space-x-1.5 bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/30 px-2.5 py-1 rounded-md">
                          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                          <span>Quota Exceeded (Red Fill)</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center space-x-1.5 bg-slate-200/80 dark:bg-slate-700/80 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-600 px-2.5 py-1 rounded-md font-bold">
                          <span className="w-2 h-2 rounded-full bg-slate-500 inline-block"></span>
                          <span>Target Matched (±0)</span>
                        </span>
                        <span className="inline-flex items-center space-x-1.5 bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/40 px-2.5 py-1 rounded-md font-bold">
                          <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span>
                          <span>+1 Over (Red)</span>
                        </span>
                        <span className="inline-flex items-center space-x-1.5 bg-gradient-to-r from-pink-500/20 to-orange-500/20 text-pink-700 dark:text-orange-300 border border-pink-500/40 px-2.5 py-1 rounded-md font-bold">
                          <span className="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
                          <span>+2 Over (Pink/Orange)</span>
                        </span>
                        <span className="inline-flex items-center space-x-1.5 bg-sky-400/20 text-sky-700 dark:text-sky-300 border border-sky-400/50 px-2.5 py-1 rounded-md font-bold">
                          <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
                          <span>-1 Under (Light Blue)</span>
                        </span>
                        <span className="inline-flex items-center space-x-1.5 bg-blue-600/25 text-blue-800 dark:text-blue-200 border border-blue-600/50 px-2.5 py-1 rounded-md font-bold">
                          <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
                          <span>-2 Under (Dark Blue)</span>
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Existing Mapping for Overall Rendering */}
        {viewMode === 'DUTY_RATIO' && selectedFlightFilter === 'Overall' && matrix.filter(t => !t.isDisabled).map((table, tableIdx) => {
          const tableTotal = flights.reduce((sum, fl) => sum + (table.data?.[fl] || []).reduce((a,b) => a+b, 0), 0);
          const tableVisibleTotal = flights.reduce(
            (sum, fl) => sum + activeColumns.reduce((acc, col) => acc + (table.data?.[fl]?.[col.dayIdx] || 0), 0),
            0
          );
          // Keep specific styling for first tables
          let colors = {
            header: 'bg-slate-800 text-white',
          };
          if (table.id === 'security_duty') colors.header = 'bg-blue-900/90 text-white';
          if (table.id === 'nazirpara_tf') colors.header = 'bg-purple-900/90 text-white';
          if (table.id === 'base_tf') colors.header = 'bg-indigo-900/90 text-white';

          return (
            <div
              key={table.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden"
            >
              {/* Table Header Bar */}
              <div className={`px-4 py-3 flex items-center justify-between ${colors.header}`}>
                <div className="flex items-center space-x-3">
                  <span className="font-mono font-black text-sm tracking-wider">
                    {table.serNo !== undefined ? `${table.serNo}. ` : `${tableIdx + 1}. `}{table.title}
                  </span>
                </div>

                <div className="flex items-center space-x-2 sm:space-x-3">
                  {ratioPeriodMode === 'WEEKLY' ? (
                    <span className="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-lg">
                      7-Day Total: <strong className="font-mono">
                        {selectedFlightFilter === 'Overall'
                          ? getPeriodTableTarget(table)
                          : getPeriodFlightTarget(table, selectedFlightFilter as FlightName)}
                      </strong>
                    </span>
                  ) : (
                    <span className="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-lg">
                      Month Total: <strong className="font-mono">
                        {selectedFlightFilter === 'Overall' 
                          ? (table.totalRequiredMonth || 0) 
                          : getFlightTarget(table, selectedFlightFilter as FlightName)}
                      </strong>
                    </span>
                  )}
                  <button
                    onClick={() => handleResetTable(tableIdx)}
                    className="p-1.5 hover:bg-white/20 rounded-lg transition-colors group cursor-pointer"
                    title="Reset this duty table"
                  >
                    <RotateCcw className="w-4 h-4 text-white/70 group-hover:text-white" />
                  </button>
                </div>
              </div>
                {/* Table Body (Monthly 31 Days or Weekly 7 Days with Date + Day) */}
                <div className="w-full overflow-x-auto">
                  <table className={`w-full text-xs text-center border-collapse table-auto md:table-fixed ${ratioPeriodMode === 'WEEKLY' ? 'min-w-[660px]' : (dutyCellInputMode === 'stepper' ? 'min-w-[1860px]' : 'min-w-[940px]')}`}>
                    <colgroup>
                      <col className="w-24 sm:w-28 min-w-[90px]" />
                      {activeColumns.map((col) => (
                        <col
                          key={col.key}
                          className={
                            ratioPeriodMode === 'WEEKLY'
                              ? 'w-[84px] sm:w-[100px] min-w-[78px]'
                              : (dutyCellInputMode === 'stepper' ? 'w-[56px] sm:w-[60px] min-w-[54px]' : 'w-[26px] sm:w-[28px] min-w-[24px]')
                          }
                        />
                      ))}
                      <col className={(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? "w-[88px] sm:w-[96px] min-w-[84px]" : "w-[64px] sm:w-[72px] min-w-[58px]"} />
                    </colgroup>
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                        <th className="p-1.5 sm:p-2 text-center sticky left-0 bg-slate-100 dark:bg-slate-800 z-10 w-24 sm:w-28 min-w-[90px] border-r border-slate-200 dark:border-slate-700 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                          {ratioPeriodMode === 'WEEKLY' ? 'Date & Day' : 'Date'}
                        </th>
                        {activeColumns.map((col, colIdx) => (
                          <th
                            key={col.key}
                            className={`p-0.5 sm:p-1 font-mono text-[11px] text-center align-middle ${
                              col.isOffDay
                                ? 'bg-rose-100/90 dark:bg-rose-950/75 text-rose-700 dark:text-rose-300 border-x border-rose-300/80 dark:border-rose-800/80'
                                : colIdx % 2 === 1
                                ? 'bg-slate-200/70 dark:bg-slate-700/70'
                                : 'bg-slate-100/70 dark:bg-slate-800/70'
                            }`}
                            title={col.isOffDay ? `${col.dateLabel} (${col.dayName}) — Weekly / Govt Offday` : undefined}
                          >
                            {ratioPeriodMode === 'WEEKLY' ? (
                              <div className="flex flex-col items-center justify-center py-1 px-0.5 leading-tight">
                                <span className={`text-[11px] sm:text-xs font-black whitespace-nowrap ${
                                  col.isOffDay ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'
                                }`}>
                                  {col.dateLabel}
                                </span>
                                <span className={`text-[10px] sm:text-[11px] font-bold whitespace-nowrap mt-0.5 ${
                                  col.isOffDay
                                    ? 'text-rose-600 dark:text-rose-300 bg-rose-500/20 dark:bg-rose-500/30 px-1.5 py-0.2 rounded'
                                    : 'text-indigo-600 dark:text-indigo-400'
                                }`}>
                                  {col.dayShort}
                                </span>
                              </div>
                            ) : (
                              <span className={col.isOffDay ? 'text-rose-600 dark:text-rose-400 font-black' : ''}>
                                {col.dayNum}
                              </span>
                            )}
                          </th>
                        ))}
                        <th className="p-1 font-bold border-l border-slate-200 dark:border-slate-700 text-center align-middle bg-slate-100 dark:bg-slate-800/80">
                          {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? (
                            <div className="flex flex-col items-center justify-center leading-tight">
                              <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                                Total
                              </span>
                              <span className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                                / Target
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                              Total
                            </span>
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {flights
                        .filter((fl) => selectedFlightFilter === 'Overall' || selectedFlightFilter === fl)
                        .filter((fl) => !officeHasFlights || !table.eligibleFlights || table.eligibleFlights.includes(fl as any))
                        .map((flight, flightIdx) => {
                          const flightArr = table.data?.[flight] || Array(31).fill(0);
                          const rowSum = flightArr.reduce((a, b) => a + b, 0);
                          const visibleRowSum = activeColumns.reduce((sum, col) => sum + (flightArr[col.dayIdx] || 0), 0);
                          const isAltRow = flightIdx % 2 === 1;

                          return (
                            <tr
                              key={flight}
                              className={`transition-colors ${isAltRow ? 'bg-slate-50/80 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/60' : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/40'}`}
                            >
                              <td className={`p-1.5 sm:p-2 text-center font-bold text-slate-900 dark:text-white sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] ${isAltRow ? 'bg-slate-100/95 dark:bg-slate-800/95' : 'bg-white dark:bg-slate-900'}`}>
                                <div className="flex items-center justify-between gap-1">
                                  <span className="text-[11px] sm:text-xs font-bold truncate">{flight}</span>
                                  {(role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OWNER') ? (
                                    <button
                                      onClick={() => setEditingCalendar({ tableIdx: matrix.findIndex(x => x.id === table.id), flight })}
                                      className="p-1 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-indigo-500 transition-colors cursor-pointer shrink-0"
                                      title="Edit in Calendar"
                                    >
                                      <Calendar className="w-3.5 h-3.5" />
                                    </button>
                                  ) : (
                                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  )}
                                </div>
                              </td>

                              {activeColumns.map((col, colIdx) => {
                                const dayIdx = col.dayIdx;
                                const dayNum = col.dayNum;
                                const val = flightArr[dayIdx] || 0;
                                const isPositive = val > 0;
                                const isAltCol = colIdx % 2 === 1;

                                // Calculate daily quota for this specific duty across all flights on this day
                                const dutyDaySum = flights.reduce((sum, fl) => sum + (table.data?.[fl]?.[dayIdx] || 0), 0);
                                let dutyDayReq = table.dailyRequirements?.[dayIdx];
                                if (dutyDayReq === undefined) {
                                  if (table.totalRequiredDaily && (table.totalRequiredDaily * 31 === table.totalRequiredMonth)) {
                                    dutyDayReq = table.totalRequiredDaily;
                                  } else {
                                    dutyDayReq = flights.reduce((acc, fl) => acc + (table.data?.[fl as FlightName]?.[dayIdx] || 0), 0);
                                  }
                                }
                                const isDayExceeded = dutyDaySum > dutyDayReq;
                                const isDayShortage = dutyDaySum < dutyDayReq;

                                return (
                                  <td
                                    key={col.key}
                                    onClick={dutyCellInputMode === 'click' ? () => handleToggleFlightDutyCell(table.id, flight, dayIdx) : undefined}
                                    onContextMenu={dutyCellInputMode === 'click' ? (e) => {
                                      e.preventDefault();
                                      const cur = flightArr[dayIdx] || 0;
                                      handleToggleFlightDutyCell(table.id, flight, dayIdx, cur === 2 ? 0 : 2);
                                    } : undefined}
                                    onDoubleClick={dutyCellInputMode === 'click' ? (e) => {
                                      e.preventDefault();
                                      const cur = flightArr[dayIdx] || 0;
                                      handleToggleFlightDutyCell(table.id, flight, dayIdx, cur === 2 ? 0 : 2);
                                    } : undefined}
                                    title={`${ratioPeriodMode === 'WEEKLY' ? `${col.dateLabel} (${col.dayShort})` : `Date ${dayNum}`}${col.isOffDay ? ' [OFFDAY]' : ''} (${flight} - ${table.title}): Day Total ${dutyDaySum} / Required ${dutyDayReq}. ${dutyCellInputMode === 'stepper' ? 'Use - / + buttons to adjust' : 'Click for 1/0, Right-click or Double-click for 2'}`}
                                    className={`p-0.5 border text-center align-middle select-none transition-colors ${dutyCellInputMode === 'click' ? 'cursor-pointer hover:bg-indigo-500/10' : ''} ${
                                      col.isOffDay
                                        ? 'bg-rose-50/80 dark:bg-rose-950/35 border-rose-200/80 dark:border-rose-900/60'
                                        : isAltRow
                                          ? (isAltCol ? 'bg-slate-100/30 dark:bg-slate-800/25 border-slate-200/60 dark:border-slate-800/60' : 'bg-slate-50/20 dark:bg-slate-800/10 border-slate-200/60 dark:border-slate-800/60')
                                          : (isAltCol ? 'bg-slate-50/30 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60' : 'bg-white dark:bg-slate-900/20 border-slate-200/60 dark:border-slate-800/60')
                                    }`}
                                  >
                                    {dutyCellInputMode === 'stepper' ? (
                                      <div
                                        className="inline-flex items-center justify-center gap-0.5 mx-auto select-none"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          disabled={val <= 0}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleFlightDutyCell(table.id, flight, dayIdx, Math.max(0, val - 1));
                                          }}
                                          className="w-4 h-5 rounded flex items-center justify-center text-[11px] font-black bg-slate-200/80 dark:bg-slate-700/80 hover:bg-rose-500/20 hover:text-rose-600 dark:hover:text-rose-400 text-slate-600 dark:text-slate-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                                          title="Decrease (-1)"
                                        >
                                          -
                                        </button>
                                        <span
                                          className={`min-w-[18px] h-5 px-0.5 rounded flex items-center justify-center font-mono text-[11px] font-bold transition-all ${
                                            isDayExceeded
                                              ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-black'
                                              : isDayShortage
                                                ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400 font-bold'
                                                : isPositive
                                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                                  : 'text-slate-400 dark:text-slate-600'
                                          }`}
                                        >
                                          {val}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleToggleFlightDutyCell(table.id, flight, dayIdx, Math.min(9, val + 1));
                                          }}
                                          className="w-4 h-5 rounded flex items-center justify-center text-[11px] font-black bg-indigo-100 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-300 cursor-pointer transition-colors"
                                          title="Increase (+1)"
                                        >
                                          +
                                        </button>
                                      </div>
                                    ) : isPositive ? (
                                      <div
                                        className={`w-5.5 h-5.5 sm:w-6 sm:h-6 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold transition-all shadow-2xs ${
                                          isDayExceeded
                                            ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-black'
                                            : isDayShortage
                                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-1.5 border-amber-400 dark:border-amber-400 font-bold'
                                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                        }`}
                                      >
                                        {val}
                                      </div>
                                    ) : isDayExceeded ? (
                                      <div className="w-5.5 h-5.5 sm:w-6 sm:h-6 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40">
                                        -
                                      </div>
                                    ) : isDayShortage ? (
                                      <div className="w-5.5 h-5.5 sm:w-6 sm:h-6 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border-1.5 border-amber-400 dark:border-amber-400">
                                        -
                                      </div>
                                    ) : (
                                      <span className="inline-block w-5.5 h-5.5 sm:w-6 sm:h-6 leading-5 text-slate-300 dark:text-slate-700/60 font-mono text-xs select-none">
                                        -
                                      </span>
                                    )}
                                  </td>
                                );
                              })}

                              {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? (
                                <td className={`p-1 font-mono border-l border-slate-200 dark:border-slate-700 text-center align-middle ${
                                  isAltRow ? 'bg-slate-100/80 dark:bg-slate-800/80' : 'bg-slate-50/50 dark:bg-slate-800/40'
                                }`}>
                                  <div className="flex items-center justify-center">
                                    {(() => {
                                      const periodSum = ratioPeriodMode === 'WEEKLY' ? visibleRowSum : rowSum;
                                      const tgt = getPeriodFlightTarget(table, flight);
                                      return (
                                        <div className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-lg font-mono text-xs shadow-xs border transition-all ${
                                          periodSum > tgt
                                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 font-black'
                                            : periodSum < tgt
                                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/60 font-bold'
                                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-bold'
                                        }`}>
                                          <span className="font-black text-[11px] sm:text-[12px]">{periodSum}</span>
                                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">/</span>
                                          <span className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 font-semibold">
                                            {tgt}
                                          </span>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </td>
                              ) : (
                                <td className={`p-1 font-mono font-black text-slate-900 dark:text-white border-l border-slate-200 dark:border-slate-700 text-center align-middle ${
                                  isAltRow ? 'bg-slate-100/80 dark:bg-slate-800/80' : 'bg-slate-50/50 dark:bg-slate-800/40'
                                }`}>
                                  {rowSum}
                                </td>
                              )}
                            </tr>
                          );
                        })}

                      {/* Daily Total Row (Sum across all flights for each day) */}
                      <tr className="bg-slate-100/90 dark:bg-slate-800/90 font-bold border-t-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                        <td className="p-1.5 sm:p-2 text-center font-black sticky left-0 bg-slate-100 dark:bg-slate-800 z-10 w-24 sm:w-28 min-w-[90px] border-r border-slate-300 dark:border-slate-700 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)]">
                          <div className="flex flex-col items-center justify-center leading-tight">
                            <span className="uppercase text-[10px] sm:text-[11px] font-black tracking-wider text-slate-800 dark:text-slate-200">
                              {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? 'Total / Req' : 'Daily Total'}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-bold mt-0.5">
                              Unit Sum
                            </span>
                          </div>
                        </td>

                        {activeColumns.map((col) => {
                          const dayIdx = col.dayIdx;
                          const dayNum = col.dayNum;
                          const dailySum = flights.reduce(
                            (sum, fl) => sum + (table.data?.[fl]?.[dayIdx] || 0),
                            0
                          );
                          let dailyReq = table.dailyRequirements?.[dayIdx];
                          if (dailyReq === undefined) {
                              if (table.totalRequiredDaily && (table.totalRequiredDaily * 31 === table.totalRequiredMonth)) {
                                  dailyReq = table.totalRequiredDaily;
                              } else {
                                  dailyReq = flights.reduce((acc, fl) => acc + (table.data?.[fl as FlightName]?.[dayIdx] || 0), 0);
                              }
                          }
                          const isPositive = dailySum > 0;
                          const isDayExceeded = dailySum > dailyReq;
                          const isDayShortage = dailySum < dailyReq;

                          return (
                            <td
                              key={col.key}
                              className={`p-0.5 border text-center align-middle ${
                                col.isOffDay
                                  ? 'bg-rose-100/80 dark:bg-rose-950/55 border-rose-300/70 dark:border-rose-800/70'
                                  : 'border-slate-200/60 dark:border-slate-700/60'
                              }`}
                              title={`${ratioPeriodMode === 'WEEKLY' ? `${col.dateLabel} (${col.dayShort})` : `Date ${dayNum}`}${col.isOffDay ? ' [OFFDAY]' : ''}: Total ${dailySum} / Required ${dailyReq}`}
                            >
                              {showAllTableInfo ? (
                                <div className={`mx-auto rounded-md flex flex-col items-center justify-center font-mono py-0.5 px-0.5 min-w-[22px] sm:min-w-[24px] ${
                                  isDayExceeded
                                    ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-black'
                                    : isDayShortage
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400/60 font-bold'
                                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                }`}>
                                  <span className="text-[11px] leading-tight font-black">{dailySum}</span>
                                  <span className="text-[8px] leading-none opacity-80 font-bold">/{dailyReq}</span>
                                </div>
                              ) : isPositive || isDayShortage ? (
                                <span className={`inline-flex items-center justify-center w-5.5 h-5.5 sm:w-6 sm:h-6 rounded-md font-mono font-bold text-xs shadow-2xs ${
                                  isDayExceeded
                                    ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-black'
                                    : isDayShortage
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-1.5 border-amber-400 font-bold'
                                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                }`}>
                                  {dailySum}
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-600 font-mono text-xs">0</span>
                              )}
                            </td>
                          );
                        })}

                        {(() => {
                          const periodTableSum = ratioPeriodMode === 'WEEKLY' ? tableVisibleTotal : tableTotal;
                          const periodTableReq = getPeriodTableTarget(table);
                          const isTotalExceeded = periodTableSum > periodTableReq;
                          const isTotalShortage = periodTableSum < periodTableReq;

                          return (
                            <td className="p-1 font-mono font-bold bg-slate-200/60 dark:bg-slate-800/80 border-l border-slate-300 dark:border-slate-700 text-xs text-center align-middle">
                              {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? (
                                <div className="flex items-center justify-center">
                                  <div className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-lg font-mono text-xs shadow-xs border transition-all ${
                                    isTotalExceeded
                                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 font-black'
                                      : isTotalShortage
                                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/60 font-bold'
                                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-bold'
                                  }`}>
                                    <span className="font-black text-[11px] sm:text-[12px]">{periodTableSum}</span>
                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">/</span>
                                    <span className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 font-semibold">{periodTableReq}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="font-mono font-black text-slate-900 dark:text-white text-xs">{periodTableSum}</span>
                              )}
                            </td>
                          );
                        })()}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {/* Flight-wise / Trade-wise Total Duty Summary Card */}
          {viewMode === 'DUTY_RATIO' && selectedFlightFilter === 'Overall' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800 shadow-md overflow-hidden mt-6">
              <div className="px-4 py-3 flex items-center justify-between bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white">
                <div className="flex items-center space-x-2.5">
                  <Layers className="w-5 h-5 text-indigo-300" />
                  <span className="font-mono font-black text-sm tracking-wider uppercase">
                    {officeHasFlights ? 'Flight-Wise Total Duty Summary' : 'Trade-Wise Total Duty Summary'}
                  </span>
                </div>
                <div className="text-xs font-bold bg-white/20 px-3 py-1 rounded-lg font-mono">
                  Total Allocated: {flights.reduce((s, fl) => s + (periodFlightTotalsOverall[fl] || 0), 0)} / {periodTotalSlotsOverall}
                </div>
              </div>
              <div className="w-full overflow-x-auto">
                <table className="w-full text-xs text-center border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="p-2.5 text-left pl-4 font-bold">{officeHasFlights ? 'FLIGHT NAME' : 'TRADE NAME'}</th>
                      {matrix.filter(t => !t.isDisabled).map(t => (
                        <th key={t.id} className="p-2 text-center font-bold">{t.title}</th>
                      ))}
                      <th className="p-2.5 text-center font-black bg-indigo-100 dark:bg-indigo-900/60 text-indigo-950 dark:text-indigo-200">
                        {ratioPeriodMode === 'WEEKLY' ? '7-DAY TOTAL / TARGET' : 'TOTAL DUTY'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {flights.map(fl => {
                      const totalAllocated = periodFlightTotalsOverall[fl] || 0;
                      const totalTarget = matrix.filter(t => !t.isDisabled).reduce((s, t) => s + getPeriodFlightTarget(t, fl), 0);
                      return (
                        <tr key={fl} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="p-2.5 text-left pl-4 font-bold text-slate-900 dark:text-white">
                            {officeHasFlights ? `${fl} Flight` : fl}
                          </td>
                          {matrix.filter(t => !t.isDisabled).map(t => {
                            const val =
                              ratioPeriodMode === 'WEEKLY'
                                ? activeColumns.reduce((acc, col) => acc + (t.data?.[fl]?.[col.dayIdx] || 0), 0)
                                : (t.data?.[fl]?.reduce((a, b) => a + b, 0) ?? 0);
                            const tgt = getPeriodFlightTarget(t, fl);
                            return (
                              <td key={t.id} className="p-2 text-center font-mono font-bold">
                                {officeHasFlights && t.eligibleFlights && !t.eligibleFlights.includes(fl) ? (
                                  <span className="text-slate-400">N/A</span>
                                ) : (
                                  <span className={val === tgt ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}>
                                    {val}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="p-2.5 text-center font-mono font-black text-sm bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300">
                            {totalAllocated}
                            {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') && (
                              <span className="text-xs text-slate-400 ml-1">/ {totalTarget}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-slate-100 dark:bg-slate-800 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                      <td className="p-2.5 text-left pl-4 font-black">TOTAL</td>
                      {matrix.filter(t => !t.isDisabled).map(t => {
                        const sum = flights.reduce(
                          (s, fl) =>
                            s +
                            (ratioPeriodMode === 'WEEKLY'
                              ? activeColumns.reduce((acc, col) => acc + (t.data?.[fl]?.[col.dayIdx] || 0), 0)
                              : (t.data?.[fl]?.reduce((a, b) => a + b, 0) ?? 0)),
                          0
                        );
                        const req = getPeriodTableTarget(t);
                        return (
                          <td key={t.id} className="p-2 text-center font-mono font-black">
                            {sum}
                            {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') && (
                              <span className="text-xs text-slate-400 ml-1">/ {req}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="p-2.5 text-center font-mono font-black text-sm bg-indigo-200 dark:bg-indigo-900 text-indigo-950 dark:text-indigo-100">
                        {flights.reduce((s, fl) => s + (periodFlightTotalsOverall[fl] || 0), 0)}
                        {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') && (
                          <span className="text-xs text-indigo-700 dark:text-indigo-300 ml-1">/ {periodTotalSlotsOverall}</span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

        {viewMode === 'DUTY_RATIO' && selectedFlightFilter !== 'Overall' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden">
              <div className="px-4 py-3 flex items-center justify-between bg-slate-800 text-white">
                <div className="flex items-center space-x-3">
                  <span className="font-mono font-black text-sm tracking-wider">
                    {selectedFlightFilter} Duty Schedule {ratioPeriodMode === 'WEEKLY' ? '(Weekly 7 Days)' : '(Monthly 31 Days)'}
                  </span>
                </div>
                <div className="flex items-center space-x-2">
                  {ratioPeriodMode === 'WEEKLY' ? (
                    <div className="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-lg">
                      7-Day Total:{' '}
                      <strong className="font-mono">
                        {periodFlightTotalsOverall[selectedFlightFilter as FlightName] || 0}
                      </strong>
                      <span className="ml-1 text-white/80">
                        / {periodTargetFlightTotal}
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs font-bold bg-white/20 px-2.5 py-1 rounded-lg">
                      Month Total: <strong className="font-mono">{flightTotalsOverall[selectedFlightFilter as FlightName]}</strong>
                      {showAllTableInfo && (
                        <span className="ml-1 text-white/80">
                          / {targetFlightTotal}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="w-full overflow-x-auto">
                <table className={`w-full text-xs text-center border-collapse table-fixed ${ratioPeriodMode === 'WEEKLY' ? 'min-w-[660px]' : (dutyCellInputMode === 'stepper' ? 'min-w-[1860px]' : 'min-w-[760px] sm:min-w-[960px]')}`}>
                  <colgroup>
                    <col className="w-24 sm:w-40 max-w-[95px] sm:max-w-none" />
                    {activeColumns.map((col) => (
                      <col
                        key={col.key}
                        className={
                          ratioPeriodMode === 'WEEKLY'
                            ? 'w-[84px] sm:w-[100px]'
                            : (dutyCellInputMode === 'stepper' ? 'w-[56px] sm:w-[60px]' : 'w-[22px] sm:w-[26px]')
                        }
                      />
                    ))}
                    <col className={(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? "w-[76px] sm:w-[96px]" : "w-[56px] sm:w-[68px]"} />
                  </colgroup>
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-slate-700 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-slate-700">
                      <th className="p-1 sm:p-2 text-center sticky left-0 bg-slate-100 dark:bg-slate-800 z-10 w-24 sm:w-40 max-w-[95px] sm:max-w-none border-r border-slate-200 dark:border-slate-700 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] overflow-hidden">
                        <span className="sm:hidden text-[10px] font-black uppercase tracking-tight">
                          {ratioPeriodMode === 'WEEKLY' ? 'Duty / Day' : 'Duty'}
                        </span>
                        <span className="hidden sm:inline">
                          {ratioPeriodMode === 'WEEKLY' ? 'Duty Name / Date & Day' : 'Duty Name / Date'}
                        </span>
                      </th>
                      {activeColumns.map((col, colIdx) => (
                        <th
                          key={col.key}
                          className={`p-0.5 sm:p-1 font-mono text-[11px] align-middle ${
                            col.isOffDay
                              ? 'bg-rose-100/90 dark:bg-rose-950/75 text-rose-700 dark:text-rose-300 border-x border-rose-300/80 dark:border-rose-800/80'
                              : colIdx % 2 === 1
                              ? 'bg-slate-200/70 dark:bg-slate-700/70'
                              : 'bg-slate-100/70 dark:bg-slate-800/70'
                          }`}
                          title={col.isOffDay ? `${col.dateLabel} (${col.dayName}) — Weekly / Govt Offday` : undefined}
                        >
                          {ratioPeriodMode === 'WEEKLY' ? (
                            <div className="flex flex-col items-center justify-center py-1 px-0.5 leading-tight">
                              <span className={`text-[11px] sm:text-xs font-black whitespace-nowrap ${
                                col.isOffDay ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900 dark:text-slate-100'
                              }`}>
                                {col.dateLabel}
                              </span>
                              <span className={`text-[10px] sm:text-[11px] font-bold whitespace-nowrap mt-0.5 ${
                                col.isOffDay
                                  ? 'text-rose-600 dark:text-rose-300 bg-rose-500/20 dark:bg-rose-500/30 px-1.5 py-0.2 rounded'
                                  : 'text-indigo-600 dark:text-indigo-400'
                              }`}>
                                {col.dayShort}
                              </span>
                            </div>
                          ) : (
                            <span className={col.isOffDay ? 'text-rose-600 dark:text-rose-400 font-black' : ''}>
                              {col.dayNum}
                            </span>
                          )}
                        </th>
                      ))}
                      <th className="p-1 font-bold border-l border-slate-200 dark:border-slate-700 text-center align-middle bg-slate-100 dark:bg-slate-800/80">
                        {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? (
                          <div className="flex flex-col items-center justify-center leading-tight">
                            <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                              Total
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-bold">
                              / Target
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                            Total
                          </span>
                        )}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {matrix.filter(t => !t.isDisabled).map((table, tableIdx) => {
                      const rowData = table.data[selectedFlightFilter as FlightName] || Array(31).fill(0);
                      const rowSum = rowData.reduce((a, b) => a + b, 0);
                      const visibleRowSum = activeColumns.reduce((sum, col) => sum + (rowData[col.dayIdx] || 0), 0);
                      const periodRowSum = ratioPeriodMode === 'WEEKLY' ? visibleRowSum : rowSum;
                      const target = getPeriodFlightTarget(table, selectedFlightFilter as FlightName);
                      const isAltRow = tableIdx % 2 === 1;

                      const isExceeded = periodRowSum > target;
                      const isShortage = periodRowSum < target;

                      return (
                        <tr
                          key={table.id}
                          className={`transition-colors ${
                            isAltRow
                              ? 'bg-slate-50/80 dark:bg-slate-800/40 hover:bg-slate-100/70 dark:hover:bg-slate-800/60'
                              : 'bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <td className={`p-1 sm:p-2 text-center font-bold text-slate-900 dark:text-white sticky left-0 z-10 border-r border-slate-200 dark:border-slate-800 align-middle text-[11px] leading-tight shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] w-24 sm:w-40 max-w-[95px] sm:max-w-none overflow-hidden ${
                            isAltRow
                              ? 'bg-slate-100/95 dark:bg-slate-800/95'
                              : 'bg-white dark:bg-slate-900'
                          }`}>
                            <div className="flex items-center justify-between gap-0.5 overflow-hidden" title={table.title}>
                              <span className={`truncate text-left text-[10px] sm:text-[11px] leading-tight ${isExceeded ? 'text-red-600 dark:text-red-400 font-bold' : ''}`}>
                                <span className="sm:hidden font-black">
                                  {table.serNo !== undefined ? `${table.serNo}. ` : ''}{getCompactDutyTitle(table)}
                                </span>
                                <span className="hidden sm:inline font-bold">
                                  {table.serNo !== undefined ? `${table.serNo}. ` : ''}{table.title}
                                </span>
                              </span>
                              {(role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OWNER') ? (
                                <button
                                  onClick={() => setEditingCalendar({ tableIdx: matrix.findIndex(x => x.id === table.id), flight: selectedFlightFilter as FlightName })}
                                  className="p-0.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-indigo-500 transition-colors cursor-pointer shrink-0"
                                  title="Edit in Calendar"
                                >
                                  <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                </button>
                              ) : (
                                <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0" />
                              )}
                            </div>
                          </td>
                          {activeColumns.map((col, colIdx) => {
                            const dayIdx = col.dayIdx;
                            const dayNum = col.dayNum;
                            const val = rowData[dayIdx] || 0;
                            const isPositive = val > 0;
                            const isAltCol = colIdx % 2 === 1;

                            // Calculate daily quota for this specific duty across all flights on this day
                            const dutyDaySum = flights.reduce((sum, fl) => sum + (table.data[fl]?.[dayIdx] || 0), 0);
                            let dutyDayReq = table.dailyRequirements?.[dayIdx];
                            if (dutyDayReq === undefined) {
                              if (table.totalRequiredDaily && (table.totalRequiredDaily * 31 === table.totalRequiredMonth)) {
                                dutyDayReq = table.totalRequiredDaily;
                              } else {
                                dutyDayReq = ['Mechanics', 'Avionics', 'GCS', 'Admin'].reduce((acc, fl) => acc + (table.data[fl as FlightName]?.[dayIdx] || 0), 0);
                              }
                            }
                            const isDayExceeded = dutyDaySum > dutyDayReq;
                            const isDayShortage = dutyDaySum < dutyDayReq;

                            return (
                              <td
                                key={col.key}
                                onClick={dutyCellInputMode === 'click' ? () => handleToggleFlightDutyCell(table.id, selectedFlightFilter as FlightName, dayIdx) : undefined}
                                onContextMenu={dutyCellInputMode === 'click' ? (e) => {
                                  e.preventDefault();
                                  const cur = rowData[dayIdx] || 0;
                                  handleToggleFlightDutyCell(table.id, selectedFlightFilter as FlightName, dayIdx, cur === 2 ? 0 : 2);
                                } : undefined}
                                onDoubleClick={dutyCellInputMode === 'click' ? (e) => {
                                  e.preventDefault();
                                  const cur = rowData[dayIdx] || 0;
                                  handleToggleFlightDutyCell(table.id, selectedFlightFilter as FlightName, dayIdx, cur === 2 ? 0 : 2);
                                } : undefined}
                                title={`${ratioPeriodMode === 'WEEKLY' ? `${col.dateLabel} (${col.dayShort})` : `Date ${dayNum}`}${col.isOffDay ? ' [OFFDAY]' : ''} (${selectedFlightFilter} - ${table.title}): Day Total ${dutyDaySum} / Required ${dutyDayReq}. ${dutyCellInputMode === 'stepper' ? 'Use - / + buttons to adjust' : 'Click for 1/0, Right-click or Double-click for 2'}`}
                                className={`p-0.5 border text-center align-middle select-none transition-colors ${dutyCellInputMode === 'click' ? 'cursor-pointer hover:bg-indigo-500/10' : ''} ${
                                  col.isOffDay
                                    ? 'bg-rose-50/80 dark:bg-rose-950/35 border-rose-200/80 dark:border-rose-900/60'
                                    : isAltRow
                                      ? (isAltCol ? 'bg-slate-100/30 dark:bg-slate-800/25 border-slate-200/60 dark:border-slate-800/60' : 'bg-slate-50/20 dark:bg-slate-800/10 border-slate-200/60 dark:border-slate-800/60')
                                      : (isAltCol ? 'bg-slate-50/30 dark:bg-slate-900/40 border-slate-200/60 dark:border-slate-800/60' : 'bg-white dark:bg-slate-900/20 border-slate-200/60 dark:border-slate-800/60')
                                }`}
                              >
                                {dutyCellInputMode === 'stepper' ? (
                                  <div
                                    className="inline-flex items-center justify-center gap-0.5 mx-auto select-none"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      disabled={val <= 0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleFlightDutyCell(table.id, selectedFlightFilter as FlightName, dayIdx, Math.max(0, val - 1));
                                      }}
                                      className="w-4 h-5 rounded flex items-center justify-center text-[11px] font-black bg-slate-200/80 dark:bg-slate-700/80 hover:bg-rose-500/20 hover:text-rose-600 dark:hover:text-rose-400 text-slate-600 dark:text-slate-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                                      title="Decrease (-1)"
                                    >
                                      -
                                    </button>
                                    <span
                                      className={`min-w-[18px] h-5 px-0.5 rounded flex items-center justify-center font-mono text-[11px] font-bold transition-all ${
                                        isDayExceeded
                                          ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-black'
                                          : isDayShortage
                                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-400 font-bold'
                                            : isPositive
                                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                              : 'text-slate-400 dark:text-slate-600'
                                      }`}
                                    >
                                      {val}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleToggleFlightDutyCell(table.id, selectedFlightFilter as FlightName, dayIdx, Math.min(9, val + 1));
                                      }}
                                      className="w-4 h-5 rounded flex items-center justify-center text-[11px] font-black bg-indigo-100 dark:bg-indigo-900/50 hover:bg-indigo-200 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-300 cursor-pointer transition-colors"
                                      title="Increase (+1)"
                                    >
                                      +
                                    </button>
                                  </div>
                                ) : isPositive ? (
                                  <div
                                    className={`w-5.5 h-5.5 sm:w-6 sm:h-6 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold transition-all shadow-2xs ${
                                      isDayExceeded
                                        ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40 font-black'
                                        : isDayShortage
                                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-1.5 border-amber-400 dark:border-amber-400 font-bold'
                                          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                    }`}
                                  >
                                    {val}
                                  </div>
                                ) : isDayExceeded ? (
                                  <div className="w-5.5 h-5.5 sm:w-6 sm:h-6 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/40">
                                    -
                                  </div>
                                ) : isDayShortage ? (
                                  <div className="w-5.5 h-5.5 sm:w-6 sm:h-6 mx-auto rounded-md flex items-center justify-center font-mono text-[11px] font-bold bg-amber-500/15 text-amber-700 dark:text-amber-300 border-1.5 border-amber-400 dark:border-amber-400">
                                    -
                                  </div>
                                ) : (
                                  <span className="inline-block w-5.5 h-5.5 sm:w-6 sm:h-6 leading-5 text-slate-300 dark:text-slate-700/60 font-mono text-xs select-none">
                                    -
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? (
                            <td className={`p-1 font-mono border-l border-slate-200 dark:border-slate-700 text-center align-middle ${
                              isAltRow ? 'bg-slate-100/80 dark:bg-slate-800/80' : 'bg-slate-50/50 dark:bg-slate-800/40'
                            }`}>
                              <div className="flex items-center justify-center">
                                <div className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-lg font-mono text-xs shadow-xs border transition-all ${
                                  isExceeded
                                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 font-black'
                                    : isShortage
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/60 font-bold'
                                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-bold'
                                }`}>
                                  <span className="font-black text-[11px] sm:text-[12px]">{periodRowSum}</span>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">/</span>
                                  <span className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 font-semibold">{target}</span>
                                </div>
                              </div>
                            </td>
                          ) : (
                            <td className={`p-1 font-mono font-black border-l border-slate-200 dark:border-slate-700 align-middle text-center ${
                              isExceeded ? 'text-red-600 dark:text-red-400 font-black' : isShortage ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-white'
                            } ${isAltRow ? 'bg-slate-100/80 dark:bg-slate-800/80' : 'bg-slate-50/50 dark:bg-slate-800/40'}`}>
                              {periodRowSum}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {/* Daily Total Row */}
                    <tr className="bg-slate-100/90 dark:bg-slate-800/90 font-bold border-t-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                      <td className="p-1 sm:p-2 text-center font-black sticky left-0 bg-slate-100 dark:bg-slate-800 z-10 w-24 sm:w-40 max-w-[95px] sm:max-w-none border-r border-slate-300 dark:border-slate-700 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.1)] overflow-hidden">
                        <div className="flex flex-col items-center justify-center leading-tight">
                          <span className="uppercase text-[9px] sm:text-[11px] font-black tracking-tight text-slate-800 dark:text-slate-200">
                            {showAllTableInfo ? 'Total' : 'Daily'}
                          </span>
                          <span className="text-[8px] sm:text-[9px] uppercase tracking-tight text-indigo-600 dark:text-indigo-400 font-bold">
                            Sum
                          </span>
                        </div>
                      </td>
                      {(() => {
                        const activeDuties = matrix.filter(t => !t.isDisabled);
                        const flightTotal = ratioPeriodMode === 'WEEKLY'
                          ? (periodTargetFlightTotal > 0 ? periodTargetFlightTotal : (periodFlightTotalsOverall[selectedFlightFilter as FlightName] || 0))
                          : (targetFlightTotal > 0 ? targetFlightTotal : (flightTotalsOverall[selectedFlightFilter as FlightName] || 0));
                        const daysCount = ratioPeriodMode === 'WEEKLY' ? Math.max(1, activeColumns.length) : 31;
                        const baseDaily = Math.floor(flightTotal / daysCount);
                        const extraDays = flightTotal % daysCount;
                        const minAllowed = baseDaily;
                        const maxAllowed = extraDays > 0 ? baseDaily + 1 : baseDaily;

                        return activeColumns.map((col) => {
                          const dayIdx = col.dayIdx;
                          const dayNum = col.dayNum;
                          const dailySum = activeDuties.reduce((sum, table) => sum + (table.data[selectedFlightFilter as FlightName]?.[dayIdx] || 0), 0);
                          const isPositive = dailySum > 0;

                          let badgeClass = 'bg-slate-200/80 dark:bg-slate-700/80 text-slate-800 dark:text-slate-200 font-bold';
                          let diffDesc = `Balanced target (${dailySum})`;

                          if (flightTotal > 0) {
                            if (dailySum > maxAllowed) {
                              const diff = dailySum - maxAllowed;
                              if (diff >= 2) {
                                badgeClass = 'bg-gradient-to-br from-pink-500/25 to-orange-500/25 text-pink-700 dark:text-orange-300 border border-pink-500 dark:border-orange-400 font-black ring-1 ring-pink-400/50 shadow-xs';
                                diffDesc = `+${diff} above max target (${maxAllowed})`;
                              } else {
                                badgeClass = 'bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500 font-black ring-1 ring-rose-500/50 shadow-xs';
                                diffDesc = `+${diff} above max target (${maxAllowed})`;
                              }
                            } else if (dailySum < minAllowed) {
                              const diff = minAllowed - dailySum;
                              if (diff >= 2) {
                                badgeClass = 'bg-blue-600/30 text-blue-800 dark:text-blue-200 border border-blue-600 dark:border-blue-400 font-black ring-1 ring-blue-600/50 shadow-xs';
                                diffDesc = `-${diff} below min target (${minAllowed})`;
                              } else {
                                badgeClass = 'bg-sky-400/25 text-sky-700 dark:text-sky-300 border border-sky-400 dark:border-sky-400 font-bold ring-1 ring-sky-400/50 shadow-xs';
                                diffDesc = `-${diff} below min target (${minAllowed})`;
                              }
                            } else {
                              if (dailySum === minAllowed) {
                                badgeClass = 'bg-slate-200/80 dark:bg-slate-700/80 text-slate-800 dark:text-slate-200 font-bold';
                                diffDesc = `Balanced base target (${minAllowed})`;
                              } else {
                                badgeClass = 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-400/40 font-bold';
                                diffDesc = `Balanced target (+1 remainder day: ${dailySum})`;
                              }
                            }
                          }

                          return (
                            <td
                              key={col.key}
                              className={`p-0.5 border text-center align-middle ${
                                col.isOffDay
                                  ? 'bg-rose-100/80 dark:bg-rose-950/55 border-rose-300/70 dark:border-rose-800/70'
                                  : 'border-slate-200/60 dark:border-slate-700/60'
                              }`}
                              title={`${ratioPeriodMode === 'WEEKLY' ? `${col.dateLabel} (${col.dayShort})` : `Date ${dayNum}`}${col.isOffDay ? ' [OFFDAY]' : ''}: Flight Total ${dailySum} (Target range: ${minAllowed} - ${maxAllowed}) - ${diffDesc}`}
                            >
                              {isPositive ? (
                                <span className={`inline-flex items-center justify-center w-5.5 h-5.5 sm:w-6 sm:h-6 rounded-md font-mono text-xs transition-all ${badgeClass}`}>
                                  {dailySum}
                                </span>
                              ) : (
                                <span className="text-slate-400 dark:text-slate-600 font-mono text-xs">0</span>
                              )}
                            </td>
                          );
                        });
                      })()}
                      {(() => {
                        const periodFlightTotal = periodFlightTotalsOverall[selectedFlightFilter as FlightName] || 0;
                        const isTotalExceeded = periodFlightTotal > periodTargetFlightTotal;
                        const isTotalShortage = periodFlightTotal < periodTargetFlightTotal;

                        return (
                          <td className="p-1 font-mono font-bold bg-slate-200/60 dark:bg-slate-800/80 border-l border-slate-300 dark:border-slate-700 text-xs text-center align-middle">
                            {(showAllTableInfo || ratioPeriodMode === 'WEEKLY') ? (
                              <div className="flex items-center justify-center">
                                <div className={`inline-flex items-center justify-center gap-1 px-1.5 py-0.5 rounded-lg font-mono text-xs shadow-xs border transition-all ${
                                  isTotalExceeded
                                    ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/40 font-black'
                                    : isTotalShortage
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-400/60 font-bold'
                                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-bold'
                                }`}>
                                  <span className="font-black text-[11px] sm:text-[12px]">{periodFlightTotal}</span>
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold">/</span>
                                  <span className="text-[10px] sm:text-[11px] text-slate-600 dark:text-slate-300 font-semibold">{periodTargetFlightTotal}</span>
                                </div>
                              </div>
                            ) : (
                              <span className="font-mono font-black text-slate-900 dark:text-white text-xs">{periodFlightTotal}</span>
                            )}
                          </td>
                        );
                      })()}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
              </div>

      </div>
      

      
      {/* Settings Modal */}
      {settingsTableIdx !== null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-3xl border border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 rounded-t-2xl">
              <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center">
                <Settings className="w-5 h-5 mr-2 text-indigo-500" />
                Settings: {matrix[settingsTableIdx]?.title}
              </h3>
              <button
                onClick={() => setSettingsTableIdx(null)}
                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            
            <div className="p-4 overflow-y-auto space-y-6">
              <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 border border-indigo-100 dark:border-indigo-900/50">
                <h4 className="font-bold text-sm text-indigo-900 dark:text-indigo-300 mb-2">Daily Requirement Calendar</h4>
                <p className="text-xs text-indigo-700/80 dark:text-indigo-300/70 mb-4">
                  Set the required number of duties for each day of the month.
                </p>
                
                <div className="flex items-center space-x-3 mb-6 bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">Set default for all days:</label>
                  <input
                    type="number"
                    min="0"
                    id="globalReqInput"
                    className="w-20 px-2 py-1 text-sm bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md focus:ring-2 focus:ring-indigo-500"
                    defaultValue={matrix[settingsTableIdx]?.totalRequiredDaily || 0}
                  />
                  <button
                    onClick={() => {
                      const val = parseInt((document.getElementById('globalReqInput') as HTMLInputElement).value, 10);
                      if (isNaN(val)) return;
                      const updated = [...matrix];
                      updated[settingsTableIdx] = {
                        ...updated[settingsTableIdx],
                        dailyRequirements: new Array(31).fill(val),
                        totalRequiredDaily: val,
                      };
                      setMatrix(updated);
                    }}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                  >
                    Apply to All
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-2 sm:gap-3">
                  {(ratioPeriodMode === 'WEEKLY' ? activeColumns.slice(0, 7) : activeColumns).map((col, idx) => {
                    const dayIndex = col.dayIdx;
                    const req = matrix[settingsTableIdx]?.dailyRequirements?.[dayIndex] ?? (matrix[settingsTableIdx]?.totalRequiredDaily || 0);
                    return (
                      <div key={col.key} className="flex flex-col">
                        <label className="text-[10px] font-bold text-slate-500 mb-1 text-center">
                          {ratioPeriodMode === 'WEEKLY' ? `Day ${idx + 1} (${col.dateLabel})` : `Day ${col.dayNum}`}
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={req}
                          onChange={(e) => {
                            const val = parseInt(e.target.value, 10) || 0;
                            const updated = [...matrix];
                            const currentReqs = [...(updated[settingsTableIdx].dailyRequirements || new Array(31).fill(updated[settingsTableIdx].totalRequiredDaily || 0))];
                            currentReqs[dayIndex] = val;
                            updated[settingsTableIdx] = {
                              ...updated[settingsTableIdx],
                              dailyRequirements: currentReqs,
                            };
                            setMatrix(updated);
                          }}
                          className="w-full text-center px-1 py-1.5 text-sm font-mono font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                        />
                      </div>
                    );
                  })}
            </div>
            
            </div>
              </div>
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex justify-end space-x-3 bg-slate-50 dark:bg-slate-800/50 rounded-b-2xl">
              <button
                onClick={() => setSettingsTableIdx(null)}
                className="px-4 py-2 text-sm font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setSettingsTableIdx(null); }}
                className="px-4 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md rounded-xl transition-colors flex items-center space-x-2"
              >
                <Check className="w-4 h-4" />
                <span>Done</span>
              </button>
        </div>
          </div>
        </div>
      )}

      {/* Calendar Edit Modal */}
      {editingCalendar && (role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'OWNER') && (
        <FlightDutyCalendarModal
          table={matrix[editingCalendar.tableIdx]}
          matrix={matrix}
          flight={editingCalendar.flight}
          target={getPeriodFlightTarget(matrix[editingCalendar.tableIdx], editingCalendar.flight)}
          ratioPeriodMode={ratioPeriodMode}
          activeColumns={activeColumns}
          onClose={() => setEditingCalendar(null)}
          onSave={(newData) => {
            const updated = [...matrix];
            updated[editingCalendar.tableIdx] = {
              ...updated[editingCalendar.tableIdx],
              data: {
                ...updated[editingCalendar.tableIdx].data,
                [editingCalendar.flight]: newData,
              },
            };
            setMatrix(updated);
            setEditingCalendar(null);
          }}
        />
      )}

      {isPrintModalOpen && (
        <PrintableDutyRatioModal
          matrix={matrix}
          selectedFlightFilter={selectedFlightFilter}
          onClose={() => setIsPrintModalOpen(false)}
          exportMode={printModalMode}
          targetDate={targetDate}
        />
      )}

      {isImportModalOpen && (
        <ImportDutyRatioModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          currentMatrix={matrix}
          onImport={(newMatrix) => {
            setMatrix(newMatrix);
          }}
        />
      )}
      </div>
    
      {/* Reset Confirmation Modal */}
      {resetConfirmTableIdx !== null && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center border border-slate-200 dark:border-slate-800">
            <div className="w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mx-auto mb-4">
              <RotateCcw className="w-8 h-8 text-rose-600 dark:text-rose-400" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">Reset Duty Table?</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Are you sure you want to reset all flights for <strong className="text-slate-700 dark:text-slate-300">{matrix[resetConfirmTableIdx]?.title}</strong>? This action will set all values to 0.
            </p>
            <div className="flex space-x-3 justify-center">
              <button
                onClick={() => setResetConfirmTableIdx(null)}
                className="px-4 py-2 font-bold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmResetTable}
                className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 shadow-md rounded-xl transition-colors"
              >
                Reset Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto Allocate Mode Selection Modal (Single vs Package) */}
      <AutoAllocateModal
        isOpen={isAutoAllocateModalOpen}
        onClose={() => setIsAutoAllocateModalOpen(false)}
        onSelectMode={(mode) => handleTriggerAutoAllocate(mode)}
        ratioPeriodMode={ratioPeriodMode}
        weeklyRangeLabel={`${formatShortDate(weeklyStartDate)} – ${formatShortDate(weeklyEndDate)}`}
      />

      {/* Ratio History & Versioning Modal */}
      <RatioHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        targetDate={targetDate}
        currentMatrix={matrix}
        onSelectVersion={(selected) => {
          setTargetDate(selected.applyFromDate);
          setSavedApplyDate(selected.applyFromDate);
          localStorage.setItem('baf_duty_distribution_target_date', selected.applyFromDate);
          if (selected.matrix && selected.matrix.length > 0) {
            setMatrix(selected.matrix);
            setSavedMatrixJson(JSON.stringify(selected.matrix));
          }
        }}
      />

      {/* Unsaved Changes Confirmation Popup Modal */}
      {unsavedPromptAction !== null && (
        <div className="fixed inset-0 z-[120] bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-amber-300 dark:border-amber-700/80 overflow-hidden">
            <div className="px-5 py-4 bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800/70 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-slate-900 dark:text-white">
                  Unsaved Changes in Duty Ratio Matrix
                </h3>
                <p className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                  Save required to apply your changes
                </p>
              </div>
            </div>

            <div className="p-5 text-sm text-slate-600 dark:text-slate-300 space-y-2 leading-relaxed">
              <p>
                আপনি <strong>Duty Ratio Matrix</strong>-এ কিছু পরিবর্তন করেছেন কিন্তু এখনো <strong>Save</strong> করেননি।
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Save না করলে এই পরিবর্তনগুলো অ্যাপ্লাই হবে না। অন্য পেজে যাওয়ার আগে কি পরিবর্তনগুলো Save করতে চান?
              </p>
            </div>

            <div className="px-5 py-4 bg-slate-50 dark:bg-slate-800/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setUnsavedPromptAction(null)}
                className="px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                Cancel (Stay Here)
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = unsavedPromptAction;
                  setUnsavedPromptAction(null);
                  handleDiscardChanges();
                  if (action.type === 'NAVIGATE_TAB') {
                    onConfirmNavigate?.(action.targetTab);
                  } else if (action.type === 'CHANGE_DATE') {
                    setTargetDate(action.nextDate);
                    setSavedApplyDate(action.nextDate);
                    loadMatrixForDate(action.nextDate);
                  }
                }}
                className="px-3.5 py-2 text-xs font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-300 dark:border-rose-800 rounded-xl transition-colors cursor-pointer"
              >
                Don't Save
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = unsavedPromptAction;
                  setUnsavedPromptAction(null);
                  handleSave();
                  if (action.type === 'NAVIGATE_TAB') {
                    onConfirmNavigate?.(action.targetTab);
                  } else if (action.type === 'CHANGE_DATE') {
                    setTargetDate(action.nextDate);
                    setSavedApplyDate(action.nextDate);
                    loadMatrixForDate(action.nextDate);
                  }
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save & Continue</span>
              </button>
            </div>
          </div>
        </div>
      )}
</div>
  );
};

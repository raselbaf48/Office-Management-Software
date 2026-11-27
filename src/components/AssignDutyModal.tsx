import { DateNavigator } from './DateNavigator';
import { formatRank, formatAirmanName } from '../utils/rankFormatter';
import { isParadeOnlyDisposalRecord } from '../data/rosterGenerator';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Check,
  Search,
  RefreshCw,
  Calendar,
  Sliders,
  Eye,
  EyeOff,
  Shield,
  Layers,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Plane,
  Clock,
  Coffee,
  Building,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Lock,
  Unlock,
  Save,
  RotateCcw
} from 'lucide-react';
import {
  Airman,
  DutyCategoryCode,
  FlightName,
  IDAShift,
  DutyAssignment,
  UserRole
} from '../types';
import { DUTY_TYPES, DUTY_TYPE_MAP } from '../data/dutyTypes';
import { getCurrentUserSession } from '../utils/authSession';
import { checkDutyPermission } from '../utils/dutyPermissions';
import { getStoredDutyRatiosForDate } from '../data/dutyRatios';
import { getIdacShiftsForDateAndFlight, getFlightDutyQuotaForDate, getStoredDutyMatrix } from '../data/officialDutyRatioMatrix';
import { FlightDutyRatioModal } from './FlightDutyRatioModal';
import { AssignLeaveTab } from './AssignLeaveTab';
import { AssignTdyTab } from './AssignTdyTab';
import { AssignDeploymentTab } from './AssignDeploymentTab';
import { localDb, resolveCanonicalIdacShift } from '../services/localDatabase';
import { isHolidayDate, getWeekdayShort, getWeekdayFull } from '../utils/holidayUtils';
import { matchAirmanId } from '../utils/airmanDisposalHelper';
import { doesOfficeHaveFlights, isDefault155UasuOffice, getOfficeScopedStorageKey } from '../firebase';
import { getBiodataTrades } from '../utils/tradeList';

const ASSIGN_DUTY_DRAFT_KEY = 'baf_assign_duty_pending_draft_v1';

interface AssignDutyDraftPayload {
  pendingOps: PendingDutyOp[];
  fromDate?: string;
  toDate?: string;
  selectedPresetDays?: number | null;
  activeDutyCode?: DutyCategoryCode | '';
  activeFlight?: FlightName | 'All';
  activeIdaShift?: IDAShift;
  activeModalTab?: 'Duty' | 'Leave' | 'TDY' | 'Deployment';
  savedAt: number;
}

const loadAssignDutyDraft = (): AssignDutyDraftPayload | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getOfficeScopedStorageKey(ASSIGN_DUTY_DRAFT_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AssignDutyDraftPayload;
    if (!parsed || !Array.isArray(parsed.pendingOps) || parsed.pendingOps.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const isSameAirman = (id1?: string, id2?: string): boolean => {
  return matchAirmanId(id1, id2);
};


interface PendingDutyOp {
  id: string;
  type: 'assign' | 'unassign';
  airmanId: string;
  airmanName: string;
  dutyCode: DutyCategoryCode;
  idaShift?: IDAShift;
  fromDate: string;
  toDate: string;
  notes?: string;
  proxyForFlight?: FlightName;
  replacedAirmanId?: string;
}

type UnsavedLeaveAction =
  | { type: 'close' }
  | { type: 'switchTab'; tab: 'Duty' | 'Leave' | 'TDY' | 'Deployment' }
  | { type: 'discardOnly' };

interface AssignDutyModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string;
  setSelectedDate?: (date: string) => void;
  onRefreshParadeData?: () => void;
  airmen: Airman[];
  initialFlight?: FlightName | 'All';
  initialDutyCode?: DutyCategoryCode;
  onlyIdac?: boolean;
  onSuccess?: () => void;
}

export const AssignDutyModal: React.FC<AssignDutyModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  setSelectedDate,
  onRefreshParadeData,
  airmen,
  initialFlight = 'All',
  initialDutyCode,
  onlyIdac = false,
  onSuccess,
}) => {
  // Date Mode: Single Date vs Multi-Date Range
  const session = getCurrentUserSession();
  const isSuperAdmin = session?.assignedRole === 'SUPER_ADMIN' || session?.assignedRole === 'OWNER';
  const isAdmin = session?.assignedRole === 'ADMIN';
  const isUser = !isAdmin && !isSuperAdmin;
  const adminFlight = session?.flightName;
  const todayStr = new Date().toISOString().split('T')[0];
  const officeHasFlights = useMemo(() => doesOfficeHaveFlights(airmen), [airmen]);
  const is155Uasu = useMemo(() => isDefault155UasuOffice(), []);
  const unitGroupOptions = useMemo<FlightName[]>(() => {
    if (officeHasFlights) return ['Avionics', 'Mechanics', 'GCS', 'Admin'] as FlightName[];
    return getBiodataTrades(airmen) as unknown as FlightName[];
  }, [officeHasFlights, airmen]);
  const matchesAirmanGroup = (airman: Airman | undefined, grp: FlightName | 'All') => {
    if (!airman) return false;
    if (grp === 'All') return true;
    return officeHasFlights ? airman.flightName === grp : (airman.trade === grp || airman.flightName === grp);
  };

  const initialSavedDraft = useMemo(() => loadAssignDutyDraft(), []);

  const [selectedPresetDays, setSelectedPresetDays] = useState<number | null>(() => {
    if (initialSavedDraft && initialSavedDraft.selectedPresetDays !== undefined) {
      return initialSavedDraft.selectedPresetDays;
    }
    const init = selectedDate || todayStr;
    const effective = isAdmin && init < todayStr ? todayStr : init;
    return effective === todayStr ? 1 : -1;
  });
  const [singleDateBeforeMulti, setSingleDateBeforeMulti] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string>(() => {
    if (initialSavedDraft?.fromDate && !(isAdmin && initialSavedDraft.fromDate < todayStr)) {
      return initialSavedDraft.fromDate;
    }
    const init = selectedDate || todayStr;
    if (isAdmin && init < todayStr) return todayStr;
    return init;
  });

  const isPastDate = fromDate < todayStr;
  const isReadOnly = isUser || (isPastDate && !isSuperAdmin);
  const [toDate, setToDate] = useState<string>(() => {
    if (initialSavedDraft?.toDate && !(isAdmin && initialSavedDraft.toDate < todayStr)) {
      return initialSavedDraft.toDate;
    }
    const init = selectedDate || todayStr;
    if (isAdmin && init < todayStr) return todayStr;
    return init;
  });
  const isMultiDateMode = selectedPresetDays !== 1 && selectedPresetDays !== -1;

  // Active duty & flight filters
  const [activeDutyCode, setActiveDutyCode] = useState<DutyCategoryCode | ''>(() => {
    const candidate = onlyIdac ? 'IDAC' : (initialSavedDraft?.activeDutyCode || initialDutyCode || '');
    if (!is155Uasu && ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(String(candidate))) {
      return '';
    }
    return candidate as DutyCategoryCode | '';
  });
  const [selectionMode, setSelectionMode] = useState<'DutyFirst' | 'FlightFirst' | 'None'>(
    initialDutyCode ? 'DutyFirst' : (initialFlight !== 'All' ? 'FlightFirst' : 'None')
  );
  const [activeFlight, setActiveFlight] = useState<FlightName | 'All'>(() => {
    if (isAdmin && adminFlight) return adminFlight as FlightName;
    if (initialSavedDraft?.activeFlight) return initialSavedDraft.activeFlight;
    return initialFlight;
  });
  const [isFlightLocked, setIsFlightLocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem('baf_duty_flight_locked') === 'true';
    }
    return false;
  });
  const [isDutyLocked, setIsDutyLocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem('baf_duty_duty_locked') === 'true';
    }
    return false;
  });
  const [isAirmenLocked, setIsAirmenLocked] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.sessionStorage.getItem('baf_duty_airmen_locked') === 'true';
    }
    return false;
  });
  const [lockedAirmenIds, setLockedAirmenIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem('baf_duty_locked_airmen_ids');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      } catch {}
    }
    return [];
  });
  const [isApplyingMultiDates, setIsApplyingMultiDates] = useState<boolean>(false);

  const isAirmanLockedInSelection = (airmanId: string) =>
    lockedAirmenIds.some((id) => isSameAirman(id, airmanId));

  const persistLockedAirmen = (ids: string[]) => {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem('baf_duty_locked_airmen_ids', JSON.stringify(ids));
    }
  };
  const [activeIdaShift, setActiveIdaShift] = useState<IDAShift | undefined>(() => initialSavedDraft?.activeIdaShift);
  const [activeLeaveType, setActiveLeaveType] = useState<'Casual' | 'Annual' | 'Recreation'>('Casual');
  const [isProxyEnabled, setIsProxyEnabled] = useState<boolean>(false);
  const [proxyForFlight, setProxyForFlight] = useState<FlightName | ''>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterByRatio, setFilterByRatio] = useState<boolean>(true);
    const [activeModalTab, setActiveModalTab] = useState<'Duty' | 'Leave' | 'TDY' | 'Deployment'>(
      () => initialSavedDraft?.activeModalTab || 'Duty'
    );
  const [showRatioModal, setShowRatioModal] = useState<boolean>(false);

  // Raw server assignments for fromDate and previous day (staged draft ops are layered on top)
  const [rawServerAssignmentsList, setRawServerAssignmentsList] = useState<DutyAssignment[]>([]);
  const [rawPrevDayAssignmentsList, setRawPrevDayAssignmentsList] = useState<DutyAssignment[]>([]);
  const [pendingOps, setPendingOps] = useState<PendingDutyOp[]>(() => initialSavedDraft?.pendingOps || []);
  const [isApplyingPending, setIsApplyingPending] = useState<boolean>(false);
  const [unsavedPrompt, setUnsavedPrompt] = useState<{
    open: boolean;
    confirmDiscardStep: boolean;
    pendingAction: UnsavedLeaveAction | null;
  }>({
    open: false,
    confirmDiscardStep: false,
    pendingAction: null,
  });
  const [loadingInitial, setLoadingInitial] = useState<boolean>(false);
  const [loadedRosterDate, setLoadedRosterDate] = useState<string>('');
  const [processingAirmanId, setProcessingAirmanId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string>('');
  
  const userManuallySelectedDutyRef = useRef<boolean>(Boolean(initialSavedDraft?.activeDutyCode));
  const userManuallySelectedFlightRef = useRef<boolean>(Boolean(initialSavedDraft?.activeFlight));
  const userManuallySelectedShiftRef = useRef<boolean>(Boolean(initialSavedDraft?.activeIdaShift));
  const hasRestoredInitialDraftRef = useRef<boolean>(Boolean(initialSavedDraft?.pendingOps?.length));
  const pendingAutoSelectDateRef = useRef<string | null>(null);
  const lastAutoSelectedDateRef = useRef<string>('');
  const rosterFetchIdRef = useRef<number>(0);

  const getOrderedFlights = (): FlightName[] => {
    return unitGroupOptions.length > 0
      ? unitGroupOptions
      : (['Avionics', 'Mechanics', 'GCS', 'Admin'] as FlightName[]);
  };

  const isIdacDutyCode = (code?: DutyCategoryCode | string): boolean => {
    return ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(String(code || ''));
  };

  const doesAssignmentMatchDuty = (
    a: DutyAssignment,
    dutyCode: DutyCategoryCode,
    shift?: IDAShift
  ): boolean => {
    const codeStr = String(dutyCode || '');
    const asgnCodeStr = String(a.dutyCode || '');
    if (isIdacDutyCode(codeStr)) {
      if (asgnCodeStr !== 'IDAC' && asgnCodeStr !== 'IDA') return false;
      if (shift) {
        const aShift = resolveCanonicalIdacShift(a);
        return aShift.toLowerCase() === shift.toLowerCase();
      }
      return true;
    }
    if (codeStr === 'AIRPORT' || codeStr === 'AIRFIELD_DUTY') {
      return asgnCodeStr === 'AIRPORT' || asgnCodeStr === 'AIRFIELD_DUTY';
    }
    if (codeStr === 'RECEPTION' || codeStr === 'RECEIPTION') {
      return (
        asgnCodeStr === 'RECEPTION' ||
        asgnCodeStr === 'RECEIPTION' ||
        asgnCodeStr === 'RECEPTION_DUTY' ||
        asgnCodeStr === 'KO' ||
        asgnCodeStr === 'K/O'
      );
    }
    if (codeStr === 'GD' || codeStr === 'BASE_SECURITY') {
      return (
        asgnCodeStr === 'GD' ||
        asgnCodeStr === 'BASE_SECURITY' ||
        Boolean((a as any).dutyName && String((a as any).dutyName).toUpperCase().includes('SECURITY'))
      );
    }
    return asgnCodeStr === codeStr;
  };

  const applyPendingOpsToDateList = (
    baseList: DutyAssignment[],
    ops: PendingDutyOp[],
    dateStr: string
  ): DutyAssignment[] => {
    if (!dateStr || ops.length === 0) return baseList;
    const isDepCode = (code: any) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(String(code || ''));
    let result = [...baseList];

    for (const op of ops) {
      const endDate = op.toDate || op.fromDate;
      if (dateStr < op.fromDate || dateStr > endDate) continue;
      const opIsIdac = isIdacDutyCode(op.dutyCode);

      if (op.type === 'unassign') {
        result = result.filter((a) => {
          if (!isSameAirman(a.airmanId, op.airmanId)) return true;
          return !doesAssignmentMatchDuty(a, op.dutyCode, opIsIdac ? op.idaShift : undefined);
        });
      } else {
        if (op.replacedAirmanId) {
          result = result.filter((a) => {
            if (!isSameAirman(a.airmanId, op.replacedAirmanId!)) return true;
            if (isDepCode(a.dutyCode)) return true;
            return !doesAssignmentMatchDuty(a, op.dutyCode, opIsIdac ? op.idaShift : undefined);
          });
        }
        if (opIsIdac) {
          const targetShift = op.idaShift || 'Morning';
          result = result.filter((a) => {
            if (!isSameAirman(a.airmanId, op.airmanId)) return true;
            if (isDepCode(a.dutyCode)) return true;
            if (['IDAC', 'IDA'].includes(String(a.dutyCode || ''))) {
              const existingShift = resolveCanonicalIdacShift(a);
              if (
                (targetShift === 'Morning' && existingShift === 'Night') ||
                (targetShift === 'Night' && existingShift === 'Morning')
              ) {
                return true;
              }
              return false;
            }
            if (targetShift === 'Night' && !['DUTY', 'DUTY_ON', 'ON_PARADE'].includes(String(a.dutyCode || ''))) {
              return true;
            }
            return false;
          });
        } else {
          result = result.filter(
            (a) =>
              !isSameAirman(a.airmanId, op.airmanId) ||
              isDepCode(a.dutyCode) ||
              ((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && resolveCanonicalIdacShift(a) === 'Night')
          );
        }
        result.push({
          airmanId: op.airmanId,
          date: dateStr,
          dutyCode: op.dutyCode,
          idaShift: op.idaShift,
          notes: op.notes || '',
          proxyForFlight: op.proxyForFlight,
        });
      }
    }

    return result;
  };

  const prevDateStr = useMemo(() => {
    if (!fromDate) return '';
    const [fy, fm, fd] = fromDate.split('-').map(Number);
    if (!fy || !fm || !fd) return '';
    const prevDateObj = new Date(Date.UTC(fy, fm - 1, fd - 1));
    return prevDateObj.toISOString().split('T')[0];
  }, [fromDate]);

  // Effective live preview lists (server data + staged draft ops)
  const assignmentsList = useMemo(
    () => applyPendingOpsToDateList(rawServerAssignmentsList, pendingOps, fromDate),
    [rawServerAssignmentsList, pendingOps, fromDate]
  );

  const prevDayAssignmentsList = useMemo(
    () => applyPendingOpsToDateList(rawPrevDayAssignmentsList, pendingOps, prevDateStr),
    [rawPrevDayAssignmentsList, pendingOps, prevDateStr]
  );

  const hasUnsavedChanges = pendingOps.length > 0;

  const pendingAffectedDates = useMemo(() => {
    const dateSet = new Set<string>();
    pendingOps.forEach((op) => {
      if (op.fromDate) dateSet.add(op.fromDate);
      if (op.toDate && op.toDate !== op.fromDate) dateSet.add(op.toDate);
    });
    return Array.from(dateSet).sort();
  }, [pendingOps]);

  // Update dates & duty code when isOpen changes
  useEffect(() => {
    if (isOpen) {
      userManuallySelectedDutyRef.current = false;
      userManuallySelectedFlightRef.current = false;
      userManuallySelectedShiftRef.current = false;
      lastAutoSelectedDateRef.current = '';
      setPendingOps([]);
      setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null });
      if (selectedDate) {
        const dateToSet = (isAdmin && selectedDate < todayStr) ? todayStr : selectedDate;
        setFromDate(dateToSet);
        setToDate(dateToSet);
        setSelectedPresetDays(dateToSet === todayStr ? 1 : -1);
        setSingleDateBeforeMulti(null);
      }
      if (isAdmin && adminFlight) {
        setActiveFlight(adminFlight as FlightName);
      }
      if (onlyIdac && is155Uasu) {
        setActiveDutyCode('IDAC');
      } else if (initialDutyCode && (is155Uasu || !['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(String(initialDutyCode)))) {
        setActiveDutyCode(initialDutyCode);
      } else if (!is155Uasu && ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(String(activeDutyCode))) {
        setActiveDutyCode('');
      }
    } else {
      lastAutoSelectedDateRef.current = '';
      setLoadedRosterDate('');
      setPendingOps([]);
      setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null });
    }
  }, [isOpen, selectedDate, onlyIdac, initialDutyCode, isAdmin, adminFlight, todayStr]);

  // Dynamically compute available IDAC shifts based on ratio matrix for fromDate
  const availableIdaShifts = useMemo(() => {
    if (isFlightLocked && activeFlight !== 'All') {
      return getIdacShiftsForDateAndFlight(fromDate, activeFlight as FlightName);
    }
    return getIdacShiftsForDateAndFlight(fromDate, undefined);
  }, [fromDate, isFlightLocked, activeFlight]);

  // Map of airman ID to Airman object for fast lookup
  const airmanMap = useMemo(() => {
    const map = new Map<string, Airman>();
    airmen.forEach((a) => {
      map.set(a.id, a);
      if (a.serNo) {
        map.set(`airman-${a.serNo}`, a);
      }
      if (a.bdNo) {
        const cleanDigits = String(a.bdNo).replace(/\D/g, '');
        map.set(a.bdNo, a);
        map.set(`BD/${a.bdNo}`, a);
        map.set(`BD_${a.bdNo}`, a);
        map.set(`BD${a.bdNo}`, a);
        if (cleanDigits) {
          map.set(cleanDigits, a);
          map.set(`BD/${cleanDigits}`, a);
          map.set(`BD_${cleanDigits}`, a);
        }
      }
      const rawDigits = String(a.id).replace(/\D/g, '');
      if (rawDigits) {
        map.set(rawDigits, a);
        map.set(`BD/${rawDigits}`, a);
        map.set(`BD_${rawDigits}`, a);
      }
    });
    return map;
  }, [airmen]);

  const countAssignedForDutyFlightShift = (
    list: DutyAssignment[],
    dutyCode: DutyCategoryCode,
    flt: FlightName,
    shift?: IDAShift
  ): number => {
    const seen = new Set<string>();
    list.forEach((a) => {
      if (!doesAssignmentMatchDuty(a, dutyCode, shift)) return;
      let air = airmanMap.get(a.airmanId);
      if (!air) {
        const d = String(a.airmanId).replace(/\D/g, '');
        if (d) air = airmanMap.get(d);
      }
      const proxyFlt = (a as any).proxyForFlight as FlightName | undefined;
      if (proxyFlt) {
        if (proxyFlt !== flt) return;
      } else {
        if (!air || !matchesAirmanGroup(air, flt)) return;
      }
      const key = air ? air.id : String(a.airmanId);
      seen.add(key);
    });
    return seen.size;
  };

  // Count total unique airmen assigned to a duty (and optional IDAC shift), across all flights unless locked to one flight
  const countTotalAssignedForDutyShift = (
    list: DutyAssignment[],
    dutyCode: DutyCategoryCode,
    shift?: IDAShift,
    lockedFlight?: FlightName
  ): number => {
    if (lockedFlight) {
      return countAssignedForDutyFlightShift(list, dutyCode, lockedFlight, shift);
    }
    const seen = new Set<string>();
    list.forEach((a) => {
      if (!doesAssignmentMatchDuty(a, dutyCode, shift)) return;
      let air = airmanMap.get(a.airmanId);
      if (!air) {
        const d = String(a.airmanId).replace(/\D/g, '');
        if (d) air = airmanMap.get(d);
      }
      const key = air ? air.id : String(a.airmanId);
      seen.add(key);
    });
    return seen.size;
  };

  // Check whether a shift (IDAC) or duty still has remaining quota.
  // When Flight Lock is OFF, any airman assigned from any flight counts toward fulfilling that shift/duty's total quota.
  const getQuotaFulfillmentStatus = (
    dateStr: string,
    list: DutyAssignment[],
    dutyCode: DutyCategoryCode,
    shift?: IDAShift,
    lockedFlight?: FlightName
  ): { required: number; assigned: number; unfulfilled: boolean } => {
    if (lockedFlight) {
      const req = getFlightDutyQuotaForDate(dateStr, lockedFlight, dutyCode, shift);
      const assigned = countAssignedForDutyFlightShift(list, dutyCode, lockedFlight, shift);
      return { required: req, assigned, unfulfilled: req > 0 && assigned < req };
    }
    const allFlights = getOrderedFlights();
    const totalReq = allFlights.reduce(
      (sum, f) => sum + getFlightDutyQuotaForDate(dateStr, f, dutyCode, shift),
      0
    );
    const totalAssigned = countTotalAssignedForDutyShift(list, dutyCode, shift);
    return {
      required: totalReq,
      assigned: totalAssigned,
      unfulfilled: totalReq > 0 && totalAssigned < totalReq,
    };
  };

  const getActiveCountedDuties = () => {
    const _storedMatrix = getStoredDutyMatrix();
    return DUTY_TYPES.filter((dt) => {
      if (!dt.isCountedAsDuty) return false;
      if (!is155Uasu && (dt.code === 'IDAC' || dt.code === 'IDA' || dt.code === 'RECEPTION')) return false;
      const mEntries = _storedMatrix.filter((t) => t.dutyCode === dt.code);
      if (mEntries.length > 0 && mEntries.every((t) => t.isDisabled)) return false;
      return true;
    });
  };

  const findFirstUnfulfilledIdacSlot = (
    dateStr: string,
    list: DutyAssignment[],
    preferredShiftsOrder?: IDAShift[],
    preferredStartAfterFlight?: FlightName | 'All'
  ): { shift: IDAShift; flight: FlightName; isUnfulfilled: boolean } | null => {
    const baseShifts: IDAShift[] =
      availableIdaShifts.length > 0
        ? availableIdaShifts
        : (['Morning', 'Afternoon', 'Night'] as IDAShift[]);
    const shiftsToCheck = preferredShiftsOrder && preferredShiftsOrder.length > 0 ? preferredShiftsOrder : baseShifts;
    const lockedFlt: FlightName | undefined =
      isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : undefined;
    const flightsToCheck: FlightName[] = lockedFlt ? [lockedFlt] : getOrderedFlights();

    let firstWithQuota: { shift: IDAShift; flight: FlightName } | null = null;

    for (let sIdx = 0; sIdx < shiftsToCheck.length; sIdx++) {
      const sh = shiftsToCheck[sIdx];
      const shiftStatus = getQuotaFulfillmentStatus(dateStr, list, 'IDAC', sh, lockedFlt);
      if (shiftStatus.required <= 0) continue;

      let orderedFlts = flightsToCheck;
      if (
        sIdx === 0 &&
        preferredStartAfterFlight &&
        preferredStartAfterFlight !== 'All' &&
        flightsToCheck.length > 1
      ) {
        const fIdx = flightsToCheck.indexOf(preferredStartAfterFlight as FlightName);
        if (fIdx >= 0) {
          orderedFlts = [...flightsToCheck.slice(fIdx + 1), ...flightsToCheck.slice(0, fIdx + 1)];
        }
      }

      const firstQuotaFltForShift =
        orderedFlts.find((f) => getFlightDutyQuotaForDate(dateStr, f, 'IDAC', sh) > 0) ||
        flightsToCheck[0];

      if (!firstWithQuota && firstQuotaFltForShift) {
        firstWithQuota = { shift: sh, flight: firstQuotaFltForShift };
      }

      if (!shiftStatus.unfulfilled) {
        // Shift's total quota is already completely filled (even if covered by another flight) -> skip shift
        continue;
      }

      const unfulfilledFltForShift = orderedFlts.find((f) => {
        const req = getFlightDutyQuotaForDate(dateStr, f, 'IDAC', sh);
        return req > 0 && countAssignedForDutyFlightShift(list, 'IDAC', f, sh) < req;
      });

      return {
        shift: sh,
        flight: unfulfilledFltForShift || firstQuotaFltForShift,
        isUnfulfilled: true,
      };
    }

    if (firstWithQuota) {
      return { ...firstWithQuota, isUnfulfilled: false };
    }
    if (baseShifts.length > 0 && flightsToCheck.length > 0) {
      return { shift: baseShifts[0], flight: flightsToCheck[0], isUnfulfilled: false };
    }
    return null;
  };

  const findFirstUnfulfilledFlightForDuty = (
    dateStr: string,
    dutyCode: DutyCategoryCode,
    list: DutyAssignment[],
    startAfterFlight?: FlightName | 'All'
  ): { flight: FlightName | 'All'; isUnfulfilled: boolean } => {
    if (isFlightLocked && activeFlight !== 'All') {
      const flt = activeFlight as FlightName;
      const req = getFlightDutyQuotaForDate(dateStr, flt, dutyCode);
      const assigned = countAssignedForDutyFlightShift(list, dutyCode, flt);
      return { flight: flt, isUnfulfilled: req > 0 && assigned < req };
    }

    const baseFlights = getOrderedFlights();
    const dutyStatus = getQuotaFulfillmentStatus(dateStr, list, dutyCode);
    if (!dutyStatus.unfulfilled) {
      const firstQuotaFlt = baseFlights.find((f) => getFlightDutyQuotaForDate(dateStr, f, dutyCode) > 0);
      return { flight: firstQuotaFlt || 'All', isUnfulfilled: false };
    }

    let orderedFlights = baseFlights;
    if (startAfterFlight && startAfterFlight !== 'All') {
      const idx = baseFlights.indexOf(startAfterFlight as FlightName);
      if (idx >= 0) {
        orderedFlights = [...baseFlights.slice(idx + 1), ...baseFlights.slice(0, idx + 1)];
      }
    }

    for (const flt of orderedFlights) {
      const req = getFlightDutyQuotaForDate(dateStr, flt, dutyCode);
      if (req > 0) {
        const assigned = countAssignedForDutyFlightShift(list, dutyCode, flt);
        if (assigned < req) {
          return { flight: flt, isUnfulfilled: true };
        }
      }
    }

    const fallbackQuotaFlt = baseFlights.find((f) => getFlightDutyQuotaForDate(dateStr, f, dutyCode) > 0);
    return { flight: fallbackQuotaFlt || 'All', isUnfulfilled: dutyStatus.unfulfilled };
  };

  // Fetch current server roster data for fromDate and previous day (for Night-Off tracking)
  const fetchCurrentRoster = async () => {
    if (!isOpen || !fromDate) return;
    const reqId = ++rosterFetchIdRef.current;
    const targetDate = fromDate;
    setLoadingInitial(true);
    try {
      const monthKey = targetDate.slice(0, 7);
      
      // Calculate previous day date string safely in UTC
      const [fy, fm, fd] = targetDate.split('-').map(Number);
      const prevDateObj = new Date(Date.UTC(fy, (fm || 1) - 1, (fd || 1) - 1));
      const prevDateStr = prevDateObj.toISOString().split('T')[0];
      const prevMonthKey = prevDateStr.slice(0, 7);

      const resCurrent = await fetch(`/api/roster?month=${monthKey}`);
      let allAssignments: DutyAssignment[] = [];
      if (resCurrent.ok) {
        const data = await resCurrent.json();
        allAssignments = Array.isArray(data.assignments)
          ? data.assignments
          : Array.isArray(data)
          ? data
          : [];
      }

      let prevMonthAssignments: DutyAssignment[] = allAssignments;
      if (prevMonthKey !== monthKey) {
        const resPrev = await fetch(`/api/roster?month=${prevMonthKey}`);
        if (resPrev.ok) {
          const dataPrev = await resPrev.json();
          prevMonthAssignments = Array.isArray(dataPrev.assignments)
            ? dataPrev.assignments
            : Array.isArray(dataPrev)
            ? dataPrev
            : [];
        }
      }

      if (reqId !== rosterFetchIdRef.current) return;

      const isGlobalScope = (scope?: string) => {
        const s = String(scope || 'ALL').toUpperCase();
        return s === 'ALL' || s === 'A';
      };

      const dayAssignments = allAssignments.filter((a) => a.date === targetDate && isGlobalScope(a.disposalScope) && !isParadeOnlyDisposalRecord(a));
      setRawServerAssignmentsList(dayAssignments);

      const prevDayAssignments = prevMonthAssignments.filter((a) => a.date === prevDateStr && isGlobalScope(a.disposalScope) && !isParadeOnlyDisposalRecord(a));
      setRawPrevDayAssignmentsList(prevDayAssignments);
      setLoadedRosterDate(targetDate);

    } catch (err) {
      console.error('Failed to load roster for date:', targetDate, err);
    } finally {
      if (reqId === rosterFetchIdRef.current) {
        setLoadingInitial(false);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      userManuallySelectedDutyRef.current = false;
      userManuallySelectedShiftRef.current = false;
      userManuallySelectedFlightRef.current = false;
      fetchCurrentRoster();
    }
  }, [isOpen, fromDate]);

  // Helper: pick default duty box + shift + ratio flight for a given date according to priority:
  // 1) First duty box with unfilled quota (assigned < required)
  // 2) Else first duty box with exceeded quota (assigned > required)
  // 3) Else 1st visible duty box
  const pickDefaultSlotForDate = (
    dateStr: string,
    dayList: DutyAssignment[],
    lockedFlt?: FlightName
  ): { dutyCode: DutyCategoryCode; shift?: IDAShift; flight: FlightName | 'All' } | null => {
    const allDuties = getActiveCountedDuties();
    if (allDuties.length === 0) return null;

    const flightsToCheck: FlightName[] = lockedFlt ? [lockedFlt] : getOrderedFlights();
    const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];

    const getDutyReq = (code: DutyCategoryCode, shift?: IDAShift) => {
      if (isIdacDutyCode(code)) {
        if (shift) {
          return flightsToCheck.reduce((sum, f) => sum + getFlightDutyQuotaForDate(dateStr, f, 'IDAC', shift), 0);
        }
        return shifts.reduce(
          (sSum, sh) => sSum + flightsToCheck.reduce((fSum, f) => fSum + getFlightDutyQuotaForDate(dateStr, f, 'IDAC', sh), 0),
          0
        );
      }
      return flightsToCheck.reduce((sum, f) => sum + getFlightDutyQuotaForDate(dateStr, f, code), 0);
    };

    const getDutyAssignedCount = (code: DutyCategoryCode, shift?: IDAShift) =>
      countTotalAssignedForDutyShift(dayList, code, shift, lockedFlt);

    const visibleDuties = (() => {
      if (lockedFlt) {
        const fltDuties = allDuties.filter(
          (dt) => getDutyReq(dt.code) > 0 || getDutyAssignedCount(dt.code) > 0
        );
        return fltDuties.length > 0 ? fltDuties : allDuties;
      }
      if (filterByRatio) {
        const ratioDuties = allDuties.filter(
          (dt) => getDutyReq(dt.code) > 0 || getDutyAssignedCount(dt.code) > 0
        );
        return ratioDuties.length > 0 ? ratioDuties : allDuties;
      }
      return allDuties;
    })();

    const evaluated = visibleDuties.map((dt) => {
      const isIdacCard = isIdacDutyCode(dt.code);
      const req = getDutyReq(dt.code);
      const assigned = getDutyAssignedCount(dt.code);

      if (isIdacCard) {
        const hasUnfilled =
          (req > 0 && assigned < req) ||
          shifts.some((sh) => {
            const q = getDutyReq('IDAC', sh);
            const a = getDutyAssignedCount('IDAC', sh);
            return q > 0 && a < q;
          });
        const hasExceeded =
          (req > 0 && assigned > req) ||
          (req === 0 && assigned > 0) ||
          shifts.some((sh) => {
            const q = getDutyReq('IDAC', sh);
            const a = getDutyAssignedCount('IDAC', sh);
            return (q > 0 && a > q) || (q === 0 && a > 0);
          });
        return { dt, hasUnfilled, hasExceeded };
      }

      const hasUnfilled = req > 0 && assigned < req;
      const hasExceeded = (req > 0 && assigned > req) || (req === 0 && assigned > 0);
      return { dt, hasUnfilled, hasExceeded };
    });

    const chosenEntry =
      evaluated.find((e) => e.hasUnfilled) ||
      evaluated.find((e) => e.hasExceeded) ||
      evaluated[0];

    if (!chosenEntry) return null;
    const chosenCode = chosenEntry.dt.code;

    if (isIdacDutyCode(chosenCode)) {
      const pickFlightForIdacShift = (sh: IDAShift): FlightName | 'All' => {
        if (lockedFlt) return lockedFlt;
        const unfilledFlt = flightsToCheck.find((f) => {
          const q = getFlightDutyQuotaForDate(dateStr, f, 'IDAC', sh);
          return q > 0 && countAssignedForDutyFlightShift(dayList, 'IDAC', f, sh) < q;
        });
        if (unfilledFlt) return unfilledFlt;
        const firstQuotaFlt = flightsToCheck.find((f) => getFlightDutyQuotaForDate(dateStr, f, 'IDAC', sh) > 0);
        return firstQuotaFlt || 'All';
      };

      const unfilledShift = shifts.find((sh) => {
        const q = getDutyReq('IDAC', sh);
        const a = getDutyAssignedCount('IDAC', sh);
        return q > 0 && a < q;
      });
      const exceededShift = shifts.find((sh) => {
        const q = getDutyReq('IDAC', sh);
        const a = getDutyAssignedCount('IDAC', sh);
        return (q > 0 && a > q) || (q === 0 && a > 0);
      });
      const firstQuotaShift = shifts.find((sh) => getDutyReq('IDAC', sh) > 0) || 'Morning';
      const chosenShift = unfilledShift || exceededShift || firstQuotaShift;

      return {
        dutyCode: 'IDAC',
        shift: chosenShift,
        flight: pickFlightForIdacShift(chosenShift),
      };
    }

    const pickFlightForNonIdac = (): FlightName | 'All' => {
      if (lockedFlt) return lockedFlt;
      const unfilledFlt = flightsToCheck.find((f) => {
        const q = getFlightDutyQuotaForDate(dateStr, f, chosenCode);
        return q > 0 && countAssignedForDutyFlightShift(dayList, chosenCode, f) < q;
      });
      if (unfilledFlt) return unfilledFlt;
      const firstQuotaFlt = flightsToCheck.find((f) => getFlightDutyQuotaForDate(dateStr, f, chosenCode) > 0);
      return firstQuotaFlt || 'All';
    };

    return {
      dutyCode: chosenCode,
      shift: undefined,
      flight: pickFlightForNonIdac(),
    };
  };

  // Auto-select default duty box (unfilled -> exceeded -> 1st box), shift & ratio flight when opening or navigating to a date
  useEffect(() => {
    if (!isOpen || loadingInitial || loadedRosterDate !== fromDate) return;
    const currentDayAssignments = assignmentsList.filter((a) => !a.date || a.date === fromDate);
    const lockedFlt: FlightName | undefined =
      isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : undefined;

    // On every date open/change (or auto-advance to a new date), run the 3-tier priority auto-selection once for this date
    const isFreshDateLoad =
      lastAutoSelectedDateRef.current !== fromDate ||
      pendingAutoSelectDateRef.current === fromDate;

    if (isFreshDateLoad) {
      lastAutoSelectedDateRef.current = fromDate;
      pendingAutoSelectDateRef.current = null;
      if (hasRestoredInitialDraftRef.current) {
        hasRestoredInitialDraftRef.current = false;
        return;
      }
      userManuallySelectedDutyRef.current = false;
      userManuallySelectedShiftRef.current = false;
      userManuallySelectedFlightRef.current = false;

      if (!isDutyLocked && !onlyIdac) {
        const picked = pickDefaultSlotForDate(fromDate, currentDayAssignments, lockedFlt);
        if (picked) {
          setActiveDutyCode(picked.dutyCode);
          setActiveIdaShift(picked.shift);
          if (!isFlightLocked && !(isAdmin && adminFlight)) {
            setActiveFlight(picked.flight);
          }
          return;
        }
      }
    }

    if (!isIdacDutyCode(activeDutyCode)) {
      if (activeIdaShift !== undefined) {
        setActiveIdaShift(undefined);
      }
      if (!isFlightLocked && !(isAdmin && adminFlight) && !userManuallySelectedFlightRef.current && activeDutyCode) {
        const isMatrixTracked = getStoredDutyMatrix().some((t) => t.dutyCode === activeDutyCode);
        if (isMatrixTracked) {
          const res = findFirstUnfulfilledFlightForDuty(fromDate, activeDutyCode as DutyCategoryCode, currentDayAssignments);
          if (activeFlight !== res.flight) {
            setActiveFlight(res.flight);
          }
        }
      }
      return;
    }

    // Active duty is IDAC: ensure unfilled -> exceeded -> first ratio shift (and its ratio flight) is selected
    const shifts = availableIdaShifts.length > 0 ? availableIdaShifts : (['Morning', 'Afternoon', 'Night'] as IDAShift[]);
    const flightsToCheck: FlightName[] = lockedFlt ? [lockedFlt] : getOrderedFlights();

    if (activeIdaShift && shifts.includes(activeIdaShift)) {
      if (userManuallySelectedShiftRef.current) {
        if (!isFlightLocked && !(isAdmin && adminFlight) && !userManuallySelectedFlightRef.current) {
          let targetFlt: FlightName | null = null;
          let firstQuotaFlt: FlightName | null = null;
          for (const flt of flightsToCheck) {
            const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', activeIdaShift);
            if (req > 0) {
              if (!firstQuotaFlt) firstQuotaFlt = flt;
              const assigned = countAssignedForDutyFlightShift(currentDayAssignments, 'IDAC', flt, activeIdaShift);
              if (assigned < req) {
                targetFlt = flt;
                break;
              }
            }
          }
          const chosenFlt = targetFlt || firstQuotaFlt;
          if (chosenFlt && activeFlight !== chosenFlt) {
            setActiveFlight(chosenFlt);
          }
        }
        return;
      }

      const curShiftStatus = getQuotaFulfillmentStatus(fromDate, currentDayAssignments, 'IDAC', activeIdaShift, lockedFlt);
      if (curShiftStatus.unfulfilled) {
        if (!isFlightLocked && !(isAdmin && adminFlight) && !userManuallySelectedFlightRef.current) {
          const targetFlt =
            flightsToCheck.find((flt) => {
              const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', activeIdaShift);
              return req > 0 && countAssignedForDutyFlightShift(currentDayAssignments, 'IDAC', flt, activeIdaShift) < req;
            }) || flightsToCheck.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', activeIdaShift) > 0);
          if (targetFlt && activeFlight !== targetFlt) {
            setActiveFlight(targetFlt);
          }
        }
        return;
      }
    }

    // Find unfilled shift -> else exceeded shift -> else first ratio shift
    if (userManuallySelectedFlightRef.current) {
      return;
    }
    const slot = findFirstUnfulfilledIdacSlot(fromDate, currentDayAssignments);
    if (slot && slot.isUnfulfilled) {
      if (activeIdaShift !== slot.shift) {
        setActiveIdaShift(slot.shift);
      }
      if (!isFlightLocked && !(isAdmin && adminFlight) && !userManuallySelectedFlightRef.current && activeFlight !== slot.flight) {
        setActiveFlight(slot.flight);
      }
    } else {
      const exceededShift = shifts.find((sh) => {
        const st = getQuotaFulfillmentStatus(fromDate, currentDayAssignments, 'IDAC', sh, lockedFlt);
        return (st.required > 0 && st.assigned > st.required) || (st.required === 0 && st.assigned > 0);
      });
      const targetShift = exceededShift || slot?.shift || shifts[0];
      if (targetShift && activeIdaShift !== targetShift) {
        setActiveIdaShift(targetShift);
      }
      if (!isFlightLocked && !(isAdmin && adminFlight) && !userManuallySelectedFlightRef.current && targetShift) {
        const targetFlt =
          flightsToCheck.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', targetShift) > 0) || slot?.flight;
        if (targetFlt && activeFlight !== targetFlt) {
          setActiveFlight(targetFlt);
        }
      }
    }
  }, [isOpen, activeDutyCode, fromDate, loadedRosterDate, activeIdaShift, assignmentsList, airmanMap, isFlightLocked, isDutyLocked, availableIdaShifts, loadingInitial, filterByRatio]);

  // Auto-select duty for locked flight when flight lock is toggled or flight changes (respecting manual clicks)
  useEffect(() => {
    if (!isOpen || loadingInitial || loadedRosterDate !== fromDate) return;
    if (isFlightLocked && activeFlight !== 'All' && !isDutyLocked && !onlyIdac && !userManuallySelectedDutyRef.current) {
      const targetFlight = activeFlight as FlightName;
      const currentDayAssignments = assignmentsList.filter((a) => !a.date || a.date === fromDate);
      const picked = pickDefaultSlotForDate(fromDate, currentDayAssignments, targetFlight);
      if (picked) {
        if (activeDutyCode !== picked.dutyCode) setActiveDutyCode(picked.dutyCode);
        if (activeIdaShift !== picked.shift) setActiveIdaShift(picked.shift);
      }
    }
  }, [isOpen, isFlightLocked, isDutyLocked, activeFlight, fromDate, loadedRosterDate, loadingInitial]);

  // Helper to check if a given date has duty ratio quota > 0 for the specified flight and/or duty
  const hasDutyQuotaOnDate = (
    targetDateStr: string,
    flight: FlightName | 'All',
    dutyCode: DutyCategoryCode | ''
  ): boolean => {
    const flights: FlightName[] = getOrderedFlights();
    const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
    const checkFlights: FlightName[] = flight !== 'All' ? [flight as FlightName] : flights;

    if (!dutyCode) {
      const allDuties = getActiveCountedDuties();
      return allDuties.some((dt) => {
        if (isIdacDutyCode(dt.code)) {
          return shifts.some((sh) =>
            checkFlights.some((f) => getFlightDutyQuotaForDate(targetDateStr, f, 'IDAC', sh) > 0)
          );
        }
        return checkFlights.some((f) => getFlightDutyQuotaForDate(targetDateStr, f, dt.code) > 0);
      });
    }

    if (isIdacDutyCode(dutyCode)) {
      return shifts.some((sh) =>
        checkFlights.some((f) => getFlightDutyQuotaForDate(targetDateStr, f, 'IDAC', sh) > 0)
      );
    }

    return checkFlights.some((f) => getFlightDutyQuotaForDate(targetDateStr, f, dutyCode) > 0);
  };

  // Find the next (or previous) date where the given flight & duty have a scheduled quota > 0
  const findNextDateWithDutyQuota = (
    baseDateStr: string,
    flight: FlightName | 'All',
    dutyCode: DutyCategoryCode | '',
    direction: 1 | -1 = 1
  ): string => {
    for (let step = 1; step <= 60; step++) {
      const d = new Date(baseDateStr);
      d.setDate(d.getDate() + step * direction);
      const candStr = d.toISOString().split('T')[0];
      if (hasDutyQuotaOnDate(candStr, flight, dutyCode)) {
        return candStr;
      }
    }
    const fallback = new Date(baseDateStr);
    fallback.setDate(fallback.getDate() + direction);
    return fallback.toISOString().split('T')[0];
  };

  // Auto-select Flight and Shift when Duty is Locked
  useEffect(() => {
    if (loadingInitial) return;
    if (!isDutyLocked || !activeDutyCode) return;

    // If BOTH Flight and Duty are locked, and the current date has 0 quota for this flight & duty,
    // automatically jump to the next date where this flight has quota for this locked duty
    if (isFlightLocked && activeFlight !== 'All') {
      const targetFlight = activeFlight as FlightName;
      if (!hasDutyQuotaOnDate(fromDate, targetFlight, activeDutyCode)) {
        const nextScheduledDate = findNextDateWithDutyQuota(fromDate, targetFlight, activeDutyCode, 1);
        if (nextScheduledDate !== fromDate && hasDutyQuotaOnDate(nextScheduledDate, targetFlight, activeDutyCode)) {
          const dutyName = DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode;
          setToastMessage(`⏭️ No ${dutyName} for ${targetFlight} on ${fromDate}. Jumped to ${nextScheduledDate}`);
          setTimeout(() => setToastMessage(''), 2500);
          setFromDate(nextScheduledDate);
          setToDate(nextScheduledDate);
          setSelectedPresetDays(1);
          return;
        }
      }
    }

    const currentDayAssignments = assignmentsList.filter((a) => !a.date || a.date === fromDate);
    const lockedFlt: FlightName | undefined =
      isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : undefined;
    const orderedFlights: FlightName[] = lockedFlt ? [lockedFlt] : getOrderedFlights();

    if (isIdacDutyCode(activeDutyCode)) {
      // Respect user's manual Shift or Flight selection even when Duty is locked
      if (userManuallySelectedShiftRef.current || userManuallySelectedFlightRef.current) {
        return;
      }

      const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
      // If current shift still has unfulfilled total quota, keep it and only update flight if not manually selected
      if (activeIdaShift && shifts.includes(activeIdaShift)) {
        const curShiftStatus = getQuotaFulfillmentStatus(fromDate, currentDayAssignments, 'IDAC', activeIdaShift, lockedFlt);
        if (curShiftStatus.unfulfilled) {
          if (!isFlightLocked && !userManuallySelectedFlightRef.current) {
            const targetFlt =
              orderedFlights.find((flt) => {
                const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', activeIdaShift);
                return req > 0 && countAssignedForDutyFlightShift(currentDayAssignments, 'IDAC', flt, activeIdaShift) < req;
              }) || orderedFlights.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', activeIdaShift) > 0);
            if (targetFlt && activeFlight !== targetFlt) setActiveFlight(targetFlt);
          }
          return;
        }
      }

      for (const sh of shifts) {
        const shStatus = getQuotaFulfillmentStatus(fromDate, currentDayAssignments, 'IDAC', sh, lockedFlt);
        if (shStatus.unfulfilled) {
          const targetFlt =
            orderedFlights.find((flt) => {
              const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh);
              return req > 0 && countAssignedForDutyFlightShift(currentDayAssignments, 'IDAC', flt, sh) < req;
            }) || orderedFlights.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh) > 0);
          if (activeIdaShift !== sh) setActiveIdaShift(sh);
          if (!isFlightLocked && !userManuallySelectedFlightRef.current && targetFlt && activeFlight !== targetFlt) {
            setActiveFlight(targetFlt);
          }
          return;
        }
      }
      // If all shifts are fulfilled for this date, default to first shift/flight with quota only when not manually overridden
      for (const sh of shifts) {
        for (const flt of orderedFlights) {
          if (getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh) > 0) {
            if (!activeIdaShift) setActiveIdaShift(sh);
            if (!isFlightLocked && !userManuallySelectedFlightRef.current && activeFlight !== flt) setActiveFlight(flt);
            return;
          }
        }
      }
    } else {
      if (activeIdaShift !== undefined) setActiveIdaShift(undefined);
      // Respect user's manual Flight selection even when Duty is locked
      if ((isFlightLocked && activeFlight !== 'All') || userManuallySelectedFlightRef.current) return;

      const dutyStatus = getQuotaFulfillmentStatus(fromDate, currentDayAssignments, activeDutyCode);
      if (dutyStatus.unfulfilled) {
        for (const flt of orderedFlights) {
          const req = getFlightDutyQuotaForDate(fromDate, flt, activeDutyCode);
          if (req > 0) {
            const assignedCount = countAssignedForDutyFlightShift(currentDayAssignments, activeDutyCode, flt);
            if (assignedCount < req) {
              if (activeFlight !== flt) setActiveFlight(flt);
              return;
            }
          }
        }
      }
      const firstWithQuota = orderedFlights.find((f) => getFlightDutyQuotaForDate(fromDate, f, activeDutyCode) > 0);
      if (firstWithQuota && activeFlight !== firstWithQuota) {
        setActiveFlight(firstWithQuota);
      }
    }
  }, [isDutyLocked, isFlightLocked, activeFlight, activeDutyCode, fromDate, assignmentsList, airmanMap, loadingInitial]);


  // Helper to get required ratio count for duty
  const getRequiredCountForDuty = (dutyCode: DutyCategoryCode, shift?: IDAShift, specificFlight?: FlightName | 'All'): number => {
    const flights: FlightName[] = getOrderedFlights();
    const targetFlight = specificFlight !== undefined ? specificFlight : activeFlight;
    if (targetFlight === 'All') {
      if (isIdacDutyCode(dutyCode)) {
        if (shift) {
          return flights.reduce((sum, f) => sum + getFlightDutyQuotaForDate(fromDate, f, 'IDAC', shift), 0);
        }
        // Total IDAC across all 3 shifts (Morning 1 + Afternoon 1 + Night 2 = 4 daily total)
        const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
        return shifts.reduce((sSum, sh) => {
          return sSum + flights.reduce((fSum, f) => fSum + getFlightDutyQuotaForDate(fromDate, f, 'IDAC', sh), 0);
        }, 0);
      }
      return flights.reduce((sum, f) => sum + getFlightDutyQuotaForDate(fromDate, f, dutyCode), 0);
    }

    if (isIdacDutyCode(dutyCode)) {
      if (shift) {
        return getFlightDutyQuotaForDate(fromDate, targetFlight as FlightName, 'IDAC', shift);
      }
      const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
      return shifts.reduce((sSum, sh) => sSum + getFlightDutyQuotaForDate(fromDate, targetFlight as FlightName, 'IDAC', sh), 0);
    }
    return getFlightDutyQuotaForDate(fromDate, targetFlight as FlightName, dutyCode);
  };

  // Helper to check if an airman is assigned to a specific duty & shift
  const isAirmanAssignedToSpecificDuty = (airmanId: string, dutyCode?: DutyCategoryCode, shift?: IDAShift) => {
    const targetCode = dutyCode || activeDutyCode;
    const targetShift = shift || activeIdaShift;
    if (!targetCode) return false;
    return assignmentsList.some((a) => {
      if (!isSameAirman(a.airmanId, airmanId)) return false;
      return doesAssignmentMatchDuty(a, targetCode as DutyCategoryCode, isIdacDutyCode(targetCode) ? targetShift : undefined);
    });
  };

  // Helper to check if an airman is currently assigned to the active duty & shift
  const isAirmanAssignedToActiveDuty = (airmanId: string) => {
    return isAirmanAssignedToSpecificDuty(airmanId, activeDutyCode, activeIdaShift);
  };

  // Helper to get detailed list of assigned airmen for any duty code (and optional shift)
  const getAssignedAirmenForDuty = (dutyCode: DutyCategoryCode, shift?: IDAShift, specificFlight?: FlightName | 'All') => {
    const list: { airman: Airman; assignment: DutyAssignment }[] = [];
    const seenAirmen = new Set<string>();
    const targetFlight = specificFlight !== undefined ? specificFlight : activeFlight;

    assignmentsList.forEach((assignment) => {
      let airman = airmanMap.get(assignment.airmanId);
      if (!airman) {
        const d = String(assignment.airmanId).replace(/\D/g, '');
        if (d) airman = airmanMap.get(d);
      }
      if (!airman) return;
      if (targetFlight !== 'All') {
        const proxyFlt = (assignment as any).proxyForFlight as FlightName | undefined;
        if (proxyFlt) {
          if (proxyFlt !== targetFlight) return;
        } else if (!matchesAirmanGroup(airman, targetFlight)) {
          return;
        }
      }

      if (isIdacDutyCode(dutyCode)) {
        if (assignment.dutyCode !== 'IDAC' && assignment.dutyCode !== 'IDA') return;
        const aShift = resolveCanonicalIdacShift(assignment);
        if (shift) {
          if (aShift.toLowerCase() !== shift.toLowerCase()) return;
        }
        const dedupKey = shift ? airman.id : `${airman.id}_${aShift}`;
        if (seenAirmen.has(dedupKey)) return;
        seenAirmen.add(dedupKey);
        list.push({ airman, assignment: { ...assignment, idaShift: aShift } });
      } else {
        if (doesAssignmentMatchDuty(assignment, dutyCode)) {
          if (seenAirmen.has(airman.id)) return;
          seenAirmen.add(airman.id);
          list.push({ airman, assignment });
        }
      }
    });

    // Sort by seniority (serNo)
    return list.sort((a, b) => a.airman.serNo - b.airman.serNo);
  };

  // Helper to count currently assigned airmen for active duty (and shift if IDAC), or across all counted duties when no specific duty is selected
  const currentlyAssignedCount = useMemo(() => {
    if (!activeDutyCode) {
      const seen = new Set<string>();
      const nonDutyCodes = new Set(['LEAVE', 'TDY', 'DEPLOYMENT', 'CANTEEN', 'BAKE_N_BITE', 'ON_PARADE', 'DUTY_OFF', 'NIGHT_OFF', 'PT', 'PT_PARADE']);
      assignmentsList.forEach((assignment) => {
        if (!assignment.dutyCode || nonDutyCodes.has(assignment.dutyCode as string)) return;
        let airman = airmanMap.get(assignment.airmanId);
        if (!airman) {
          const d = String(assignment.airmanId).replace(/\D/g, '');
          if (d) airman = airmanMap.get(d);
        }
        if (!airman) return;
        if (activeFlight !== 'All' && !matchesAirmanGroup(airman, activeFlight)) return;
        seen.add(`${airman.id}_${assignment.dutyCode}_${assignment.idaShift || ''}`);
      });
      return seen.size;
    }
    return getAssignedAirmenForDuty(
      activeDutyCode,
      (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) ? activeIdaShift : undefined
    ).length;
  }, [assignmentsList, activeDutyCode, activeIdaShift, activeFlight, airmanMap]);

  // Required quota for currently selected duty & shift (or total across all duties if none selected)
  const currentRequiredQuota = useMemo(() => {
    if (!activeDutyCode) {
      const storedMatrix = getStoredDutyMatrix();
      const activeDuties = DUTY_TYPES.filter((dt) => {
        if (!dt.isCountedAsDuty) return false;
        if (!is155Uasu && (dt.code === 'IDAC' || dt.code === 'IDA' || dt.code === 'RECEPTION')) return false;
        const mEntries = storedMatrix.filter((t) => t.dutyCode === dt.code);
        if (mEntries.length > 0 && mEntries.every((t) => t.isDisabled)) return false;
        return true;
      });
      return activeDuties.reduce((sum, dt) => sum + getRequiredCountForDuty(dt.code), 0);
    }
    if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
      return getRequiredCountForDuty('IDAC', activeIdaShift);
    }
    return getRequiredCountForDuty(activeDutyCode);
  }, [activeDutyCode, activeIdaShift, activeFlight, fromDate]);


  
  const updatePresetBasedOnDates = (start: string, end: string) => {
    if (!start || !end) return;
    const diff = Math.round((new Date(end).getTime() - new Date(start).getTime()) / (1000 * 3600 * 24)) + 1;
    const todayStr = new Date().toISOString().split('T')[0];
    if (diff === 1) {
      setSingleDateBeforeMulti(null);
      if (start === todayStr) {
        setSelectedPresetDays(1);
      } else {
        setSelectedPresetDays(-1); // -1 means 1 day span but not today
      }
    } else if ([2, 3, 7, 15].includes(diff)) {
      setSelectedPresetDays(diff);
    } else {
      setSelectedPresetDays(null);
    }
  };

  const handleShiftDate = (days: number) => {
    if (!fromDate) return;
    let newDate: string;
    if (isFlightLocked && activeFlight !== 'All' && isDutyLocked && activeDutyCode && Math.abs(days) === 1) {
      newDate = findNextDateWithDutyQuota(fromDate, activeFlight, activeDutyCode, days > 0 ? 1 : -1);
    } else {
      const d = new Date(fromDate);
      d.setDate(d.getDate() + days);
      newDate = d.toISOString().split('T')[0];
    }
    if (days < 0 && !isSuperAdmin && newDate < todayStr) {
      alert("Admins cannot navigate to or modify duties for past dates.");
      return;
    }
    setFromDate(newDate);
    if (selectedPresetDays !== null) {
      const td = new Date(newDate);
      const spanDays = selectedPresetDays === -1 ? 1 : selectedPresetDays;
      td.setDate(td.getDate() + spanDays - 1);
      const newTo = td.toISOString().split('T')[0];
      setToDate(newTo);
      updatePresetBasedOnDates(newDate, newTo);
    } else {
      if (toDate < newDate) {
        setToDate(newDate);
        setSelectedPresetDays(1);
      } else {
        updatePresetBasedOnDates(newDate, toDate);
      }
    }
  };

  const executeLeaveAction = (action: UnsavedLeaveAction | null) => {
    if (!action || action.type === 'discardOnly') return;
    if (action.type === 'close') {
      onClose();
    } else if (action.type === 'switchTab') {
      setActiveModalTab(action.tab);
    }
  };

  const requestLeaveModal = (action: UnsavedLeaveAction) => {
    if (isApplyingPending) return;
    if (action.type === 'discardOnly') {
      if (!hasUnsavedChanges) return;
      setUnsavedPrompt({
        open: true,
        confirmDiscardStep: true,
        pendingAction: action,
      });
      return;
    }
    if (hasUnsavedChanges) {
      setUnsavedPrompt({
        open: true,
        confirmDiscardStep: false,
        pendingAction: action,
      });
    } else {
      executeLeaveAction(action);
    }
  };

  const handleConfirmDiscardPending = () => {
    const discardedCount = pendingOps.length;
    const actionToRun = unsavedPrompt.pendingAction;
    setPendingOps([]);
    try {
      window.localStorage.removeItem(getOfficeScopedStorageKey(ASSIGN_DUTY_DRAFT_KEY));
      window.dispatchEvent(new CustomEvent('baf_assign_draft_changed'));
    } catch {}
    setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null });
    if (actionToRun && actionToRun.type !== 'discardOnly') {
      executeLeaveAction(actionToRun);
    } else if (discardedCount > 0) {
      setToastMessage(`🗑️ Discarded ${discardedCount} unsaved duty change${discardedCount > 1 ? 's' : ''}.`);
      setTimeout(() => setToastMessage(''), 2500);
    }
  };

  const pendingDraftRef = useRef<AssignDutyDraftPayload>({
    pendingOps,
    fromDate,
    toDate,
    selectedPresetDays,
    activeDutyCode,
    activeFlight,
    activeIdaShift,
    activeModalTab,
    savedAt: Date.now(),
  });
  pendingDraftRef.current = {
    pendingOps,
    fromDate,
    toDate,
    selectedPresetDays,
    activeDutyCode,
    activeFlight,
    activeIdaShift,
    activeModalTab,
    savedAt: Date.now(),
  };

  // Track modal open flag & show restore banner if staged draft from before auto-logout/close was loaded
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__bafAssignDutyModalOpen = isOpen;
    }
    if (isOpen && initialSavedDraft?.pendingOps && initialSavedDraft.pendingOps.length > 0) {
      setToastMessage(
        `📝 পূর্ববর্তী অসংরক্ষিত ${initialSavedDraft.pendingOps.length}টি ডিউটি পরিবর্তন পুনরুদ্ধার হয়েছে — সংরক্ষণ করতে Apply চাপুন।`
      );
      const t = setTimeout(() => setToastMessage(''), 5000);
      return () => {
        clearTimeout(t);
        if (typeof window !== 'undefined') (window as any).__bafAssignDutyModalOpen = false;
      };
    }
    return () => {
      if (typeof window !== 'undefined') {
        (window as any).__bafAssignDutyModalOpen = false;
      }
    };
  }, [isOpen]);

  // Continuously persist staged pendingOps draft to office-scoped localStorage + flush on auto-logout/beforeunload
  useEffect(() => {
    const storageKey = getOfficeScopedStorageKey(ASSIGN_DUTY_DRAFT_KEY);
    const persistDraft = () => {
      try {
        const cur = pendingDraftRef.current;
        if (cur.pendingOps.length > 0) {
          window.localStorage.setItem(storageKey, JSON.stringify({ ...cur, savedAt: Date.now() }));
        } else {
          window.localStorage.removeItem(storageKey);
        }
        window.dispatchEvent(new CustomEvent('baf_assign_draft_changed'));
      } catch {}
    };
    persistDraft();

    const handleBeforeLogout = () => persistDraft();
    window.addEventListener('baf_prepare_auto_logout', handleBeforeLogout);
    window.addEventListener('baf_before_user_logout', handleBeforeLogout);
    return () => {
      window.removeEventListener('baf_prepare_auto_logout', handleBeforeLogout);
      window.removeEventListener('baf_before_user_logout', handleBeforeLogout);
    };
  }, [pendingOps, fromDate, toDate, selectedPresetDays, activeDutyCode, activeFlight, activeIdaShift, activeModalTab]);

  // Warn browser reload / tab close while unsaved duty changes exist
  useEffect(() => {
    if (!isOpen || !hasUnsavedChanges) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        const storageKey = getOfficeScopedStorageKey(ASSIGN_DUTY_DRAFT_KEY);
        if (pendingDraftRef.current.pendingOps.length > 0) {
          window.localStorage.setItem(
            storageKey,
            JSON.stringify({ ...pendingDraftRef.current, savedAt: Date.now() })
          );
        }
      } catch {}
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOpen, hasUnsavedChanges]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (unsavedPrompt.open) {
          e.preventDefault();
          if (unsavedPrompt.confirmDiscardStep && unsavedPrompt.pendingAction?.type !== 'discardOnly') {
            setUnsavedPrompt((prev) => ({ ...prev, confirmDiscardStep: false }));
          } else {
            setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null });
          }
          return;
        }
        if (showRatioModal) return;
        e.preventDefault();
        requestLeaveModal({ type: 'close' });
        return;
      }
      if (unsavedPrompt.open) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') {
        handleShiftDate(1);
      } else if (e.key === 'ArrowLeft') {
        handleShiftDate(-1);
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedPresetDays, fromDate, hasUnsavedChanges, unsavedPrompt, showRatioModal, isApplyingPending]);

  const getDatesInRange = (fromDateStr: string, toDateStr: string): string[] => {
    const dates: string[] = [];
    const [fY, fM, fD] = fromDateStr.split('-').map(Number);
    const [tY, tM, tD] = toDateStr.split('-').map(Number);
    if (!fY || !fM || !fD || !tY || !tM || !tD) return [fromDateStr];
    const current = new Date(Date.UTC(fY, fM - 1, fD));
    const end = new Date(Date.UTC(tY, tM - 1, tD));
    while (current <= end) {
      const y = current.getUTCFullYear();
      const m = String(current.getUTCMonth() + 1).padStart(2, '0');
      const d = String(current.getUTCDate()).padStart(2, '0');
      dates.push(`${y}-${m}-${d}`);
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return dates;
  };

  const handleToggleLockedAirman = (airman: Airman) => {
    setSearchQuery('');
    setLockedAirmenIds((prev) => {
      const exists = prev.some((id) => isSameAirman(id, airman.id));
      const next = exists
        ? prev.filter((id) => !isSameAirman(id, airman.id))
        : [...prev, airman.id];
      persistLockedAirmen(next);
      return next;
    });
  };

  const handleApplyLockedAirmenToDates = async (dates: string[]) => {
    if (!dates || dates.length === 0) return;
    if (lockedAirmenIds.length === 0) {
      setToastMessage('⚠️ Please select at least 1 airman in the locked list first.');
      setTimeout(() => setToastMessage(''), 3000);
      return;
    }
    if (!activeDutyCode) {
      setToastMessage('⚠️ Please select & lock a duty first before applying calendar dates.');
      setTimeout(() => setToastMessage(''), 3000);
      return;
    }

    const isIdac = ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string);
    const shiftToUse = isIdac ? activeIdaShift : undefined;
    if (isIdac && !shiftToUse) {
      setToastMessage('⚠️ Please select an IDAC Shift (Morning, Afternoon, or Night) first.');
      setTimeout(() => setToastMessage(''), 3000);
      return;
    }

    const targetAirmen = lockedAirmenIds
      .map((id) => airmanMap.get(id) || airmen.find((a) => isSameAirman(a.id, id)))
      .filter((a): a is Airman => Boolean(a));

    if (targetAirmen.length === 0) {
      setToastMessage('⚠️ No valid locked airmen found.');
      setTimeout(() => setToastMessage(''), 3000);
      return;
    }

    const notes = activeDutyCode === 'LEAVE' ? `${activeLeaveType} Leave` : '';
    const proxy = isProxyEnabled && proxyForFlight ? proxyForFlight : undefined;

    setIsApplyingMultiDates(true);
    const newOps: PendingDutyOp[] = [];
    let skippedPerm = 0;

    try {
      for (const dStr of dates) {
        for (const airman of targetAirmen) {
          const perm = checkDutyPermission(
            (session?.assignedRole as UserRole) || 'USER',
            airman.flightName,
            dStr,
            session?.flightName
          );
          if (!perm.canAssign) {
            skippedPerm++;
            continue;
          }

          newOps.push({
            id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            type: 'assign',
            airmanId: airman.id,
            airmanName: `${formatAirmanName(airman.rank)} ${airman.name}`,
            dutyCode: activeDutyCode,
            idaShift: shiftToUse,
            fromDate: dStr,
            toDate: dStr,
            notes,
            proxyForFlight: proxy,
          });
        }
      }

      if (newOps.length > 0) {
        setPendingOps((prev) => [...prev, ...newOps]);
        if (!dates.includes(fromDate) && dates.length > 0) {
          setFromDate(dates[0]);
          setToDate(dates[0]);
          setSelectedPresetDays(dates[0] === todayStr ? 1 : -1);
        }
      }

      const dtName = DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode;
      const shiftSuffix = isIdac && shiftToUse ? ` (${shiftToUse})` : '';
      if (newOps.length > 0) {
        setToastMessage(
          `📝 Staged ${targetAirmen.length} locked airman/airmen to ${dtName}${shiftSuffix} across ${dates.length} date(s)${skippedPerm > 0 ? ` (${skippedPerm} skipped)` : ''} — Click Apply to save`
        );
      } else if (skippedPerm > 0) {
        setToastMessage('⚠️ Permission denied for the selected dates or flight.');
      }
      setTimeout(() => setToastMessage(''), 3500);
    } finally {
      setIsApplyingMultiDates(false);
    }
  };

  // Commit all staged duty changes to server & localDb
  const handleApplyPendingChanges = async (afterApplyAction?: UnsavedLeaveAction | null) => {
    if (pendingOps.length === 0 || isApplyingPending) {
      if (afterApplyAction) executeLeaveAction(afterApplyAction);
      return;
    }

    setIsApplyingPending(true);
    const opsToApply = [...pendingOps];
    const isDepCode = (code: any) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(String(code || ''));
    let failedCount = 0;

    try {
      for (const op of opsToApply) {
        const opIsIdac = isIdacDutyCode(op.dutyCode);
        const endDate = op.toDate || op.fromDate;

        if (op.type === 'unassign') {
          const res = await fetch('/api/roster/delete-range', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              airmanId: op.airmanId,
              fromDate: op.fromDate,
              toDate: endDate,
              dutyCode: op.dutyCode,
              idaShift: opIsIdac ? op.idaShift : undefined,
            }),
          });

          if (res.ok) {
            try {
              const dates = getDatesInRange(op.fromDate, endDate);
              dates.forEach((dStr) => {
                localDb.deleteAssignment(op.airmanId, dStr, op.dutyCode, opIsIdac ? op.idaShift : undefined);
              });
            } catch (syncErr) {
              console.warn('localDb unassign sync warning:', syncErr);
            }
          } else {
            failedCount++;
          }
        } else {
          if (op.replacedAirmanId) {
            try {
              await fetch('/api/roster/delete-range', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  airmanId: op.replacedAirmanId,
                  fromDate: op.fromDate,
                  toDate: endDate,
                  dutyCode: op.dutyCode,
                  idaShift: opIsIdac ? op.idaShift : undefined,
                }),
              });
            } catch (delErr) {
              console.warn('Failed to unassign replaced airman on server:', delErr);
            }
          }

          const res = await fetch('/api/roster/assign-range', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              airmanId: op.airmanId,
              dutyCode: op.dutyCode,
              idaShift: op.idaShift,
              fromDate: op.fromDate,
              toDate: endDate,
              notes: op.notes || '',
              proxyForFlight: op.proxyForFlight,
            }),
          });

          if (res.ok) {
            try {
              const dates = getDatesInRange(op.fromDate, endDate);
              dates.forEach((dStr) => {
                const mKey = dStr.slice(0, 7);
                if (!localDb.db.assignments[mKey]) localDb.db.assignments[mKey] = [];
                let list = localDb.db.assignments[mKey];
                if (op.replacedAirmanId) {
                  list = list.filter((a) => {
                    if (!isSameAirman(a.airmanId, op.replacedAirmanId!) || a.date !== dStr) return true;
                    if (isDepCode(a.dutyCode)) return true;
                    return !doesAssignmentMatchDuty(a, op.dutyCode, opIsIdac ? op.idaShift : undefined);
                  });
                }
                if (opIsIdac) {
                  const targetShift = op.idaShift || 'Morning';
                  list = list.filter((a) => {
                    if (!isSameAirman(a.airmanId, op.airmanId) || a.date !== dStr) return true;
                    if (isDepCode(a.dutyCode)) return true;
                    if (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') {
                      const existingShift = resolveCanonicalIdacShift(a);
                      if (
                        (targetShift === 'Morning' && existingShift === 'Night') ||
                        (targetShift === 'Night' && existingShift === 'Morning')
                      ) {
                        return true;
                      }
                      return false;
                    }
                    if (targetShift === 'Night' && !['DUTY', 'DUTY_ON', 'ON_PARADE'].includes(String(a.dutyCode || ''))) {
                      return true;
                    }
                    return false;
                  });
                } else {
                  list = list.filter(
                    (a) =>
                      !(
                        isSameAirman(a.airmanId, op.airmanId) &&
                        a.date === dStr &&
                        !isDepCode(a.dutyCode) &&
                        !((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && resolveCanonicalIdacShift(a) === 'Night')
                      )
                  );
                }
                const alreadyInList = list.some(
                  (a) =>
                    isSameAirman(a.airmanId, op.airmanId) &&
                    a.date === dStr &&
                    doesAssignmentMatchDuty(a, op.dutyCode, opIsIdac ? op.idaShift : undefined) &&
                    (a.notes || '') === (op.notes || '') &&
                    (a.proxyForFlight || '') === (op.proxyForFlight || '')
                );
                if (!alreadyInList) {
                  list.push({
                    airmanId: op.airmanId,
                    date: dStr,
                    dutyCode: op.dutyCode,
                    idaShift: op.idaShift,
                    notes: op.notes || '',
                    proxyForFlight: op.proxyForFlight,
                    updatedAt: new Date().toISOString(),
                  });
                }
                localDb.db.assignments[mKey] = list;
              });
            } catch (syncErr) {
              console.warn('localDb assign sync warning:', syncErr);
            }
          } else {
            failedCount++;
          }
        }
      }

      try {
        localDb.saveToStorage(localDb.db, false, true, true);
      } catch (saveErr) {
        console.warn('localDb save warning:', saveErr);
      }

      setPendingOps([]);
      try {
        window.localStorage.removeItem(getOfficeScopedStorageKey(ASSIGN_DUTY_DRAFT_KEY));
        window.dispatchEvent(new CustomEvent('baf_assign_draft_changed'));
      } catch {}
      setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null });
      window.dispatchEvent(new CustomEvent('baf_state_updated'));
      if (onRefreshParadeData) onRefreshParadeData();
      if (onSuccess) onSuccess();
      await fetchCurrentRoster();

      if (failedCount > 0) {
        setToastMessage(`⚠️ Applied with ${failedCount} failed change(s). Please verify.`);
      } else {
        setToastMessage(`✅ Applied ${opsToApply.length} duty change${opsToApply.length > 1 ? 's' : ''} successfully!`);
      }
      setTimeout(() => setToastMessage(''), 3000);

      if (afterApplyAction && afterApplyAction.type !== 'discardOnly') {
        executeLeaveAction(afterApplyAction);
      }
    } catch (err: any) {
      console.error('Apply pending duty changes error:', err);
      setToastMessage(`❌ Failed to apply changes: ${err?.message || 'Network error'}`);
      setTimeout(() => setToastMessage(''), 3500);
    } finally {
      setIsApplyingPending(false);
    }
  };

  // Staged Click Assignment Action (Changes preview locally until Apply is clicked)
  const handleToggleAssignAirman = async (
    airman: Airman,
    forceAction?: 'assign' | 'unassign',
    explicitDutyCode?: DutyCategoryCode,
    explicitShift?: IDAShift
  ) => {
    const dutyCodeToUse = explicitDutyCode || activeDutyCode;
    if (!dutyCodeToUse) {
      setToastMessage('⚠️ Please select a duty first.');
      setTimeout(() => setToastMessage(''), 2500);
      return;
    }
    const isIdac = ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCodeToUse as string);
    const shiftToUse = isIdac ? (explicitShift || activeIdaShift) : undefined;
    if (isIdac && !shiftToUse && forceAction !== 'unassign') {
      setToastMessage('⚠️ Please select an IDAC Shift (Morning, Afternoon, or Night) first.');
      setTimeout(() => setToastMessage(''), 2500);
      return;
    }

    const isCurrentlyAssignedToThisDuty = isAirmanAssignedToSpecificDuty(airman.id, dutyCodeToUse, shiftToUse);
    const willUnassign = forceAction === 'unassign' || (forceAction !== 'assign' && isCurrentlyAssignedToThisDuty);

    // Permission check
    const perm = checkDutyPermission(
      (session?.assignedRole as UserRole) || 'USER',
      airman.flightName,
      fromDate,
      session?.flightName
    );
    if (willUnassign) {
      if (!perm.canDelete) {
        setToastMessage(`⚠️ ${perm.reason || 'You do not have permission to remove duties.'}`);
        setTimeout(() => setToastMessage(''), 3000);
        return;
      }
    } else {
      if (!perm.canAssign) {
        setToastMessage(`⚠️ ${perm.reason || 'You do not have permission to assign duties.'}`);
        setTimeout(() => setToastMessage(''), 3000);
        return;
      }
    }

    setSearchQuery('');
    const effectiveToDate = toDate || fromDate;

    if (willUnassign) {
      // If this exact non-replacing assign was staged locally and not on server, cleanly cancel that staged op
      const isOnServer = rawServerAssignmentsList.some(
        (a) =>
          isSameAirman(a.airmanId, airman.id) &&
          doesAssignmentMatchDuty(a, dutyCodeToUse, isIdac ? shiftToUse : undefined)
      );
      const matchingAssignIdx = !isOnServer
        ? [...pendingOps].reverse().findIndex(
            (op) =>
              op.type === 'assign' &&
              !op.replacedAirmanId &&
              isSameAirman(op.airmanId, airman.id) &&
              op.dutyCode === dutyCodeToUse &&
              (op.idaShift || '') === (shiftToUse || '') &&
              op.fromDate === fromDate &&
              (op.toDate || op.fromDate) === effectiveToDate
          )
        : -1;

      if (matchingAssignIdx !== -1) {
        const realIdx = pendingOps.length - 1 - matchingAssignIdx;
        setPendingOps((prev) => prev.filter((_, idx) => idx !== realIdx));
        setToastMessage(`📝 Reverted staged assignment for ${formatAirmanName(airman.rank)} ${airman.name}`);
      } else {
        const unassignOp: PendingDutyOp = {
          id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'unassign',
          airmanId: airman.id,
          airmanName: `${formatAirmanName(airman.rank)} ${airman.name}`,
          dutyCode: dutyCodeToUse,
          idaShift: isIdac ? shiftToUse : undefined,
          fromDate,
          toDate: effectiveToDate,
        };
        setPendingOps((prev) => [...prev, unassignOp]);
        setToastMessage(`📝 Staged removal: ${formatAirmanName(airman.rank)} ${airman.name} (Click Apply to save)`);
      }
      setTimeout(() => setToastMessage(''), 2500);
      return;
    }

    // Stage Assign Airman
    const targetFlight =
      proxyForFlight && isProxyEnabled
        ? proxyForFlight
        : activeFlight !== 'All'
        ? activeFlight
        : (officeHasFlights ? airman.flightName : ((airman.trade || airman.flightName) as FlightName));
    const flightQuota = getFlightDutyQuotaForDate(fromDate, targetFlight as FlightName, dutyCodeToUse, shiftToUse);

    // Allow manual extra duty assignments beyond quota (e.g. 3/2, 2/1) without auto-replacing already assigned airmen
    const replacedAirman: Airman | null = null;
    const replacedAirmanId: string | undefined = undefined;

    const notes = dutyCodeToUse === 'LEAVE' ? `${activeLeaveType} Leave` : '';
    const proxyFltVal = isProxyEnabled && proxyForFlight ? proxyForFlight : undefined;

    // Check if this simply cancels an existing staged unassign for the same server assignment
    const isOnServer = rawServerAssignmentsList.some(
      (a) =>
        isSameAirman(a.airmanId, airman.id) &&
        doesAssignmentMatchDuty(a, dutyCodeToUse, isIdac ? shiftToUse : undefined)
    );
    const matchingUnassignIdx =
      isOnServer && !replacedAirmanId
        ? [...pendingOps].reverse().findIndex(
            (op) =>
              op.type === 'unassign' &&
              isSameAirman(op.airmanId, airman.id) &&
              op.dutyCode === dutyCodeToUse &&
              (op.idaShift || '') === (shiftToUse || '') &&
              op.fromDate === fromDate &&
              (op.toDate || op.fromDate) === effectiveToDate
          )
        : -1;

    let nextPendingOps: PendingDutyOp[];
    if (matchingUnassignIdx !== -1) {
      const realIdx = pendingOps.length - 1 - matchingUnassignIdx;
      nextPendingOps = pendingOps.filter((_, idx) => idx !== realIdx);
    } else {
      const assignOp: PendingDutyOp = {
        id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'assign',
        airmanId: airman.id,
        airmanName: `${formatAirmanName(airman.rank)} ${airman.name}`,
        dutyCode: dutyCodeToUse,
        idaShift: shiftToUse,
        fromDate,
        toDate: effectiveToDate,
        notes,
        proxyForFlight: proxyFltVal,
        replacedAirmanId,
      };
      nextPendingOps = [...pendingOps, assignOp];
    }

    const nextAssignments = applyPendingOpsToDateList(rawServerAssignmentsList, nextPendingOps, fromDate);
    setPendingOps(nextPendingOps);

    const dtName = DUTY_TYPE_MAP.get(dutyCodeToUse as any)?.name || dutyCodeToUse;
    const shiftSuffix = isIdac ? ` (${shiftToUse})` : '';
    if (matchingUnassignIdx !== -1) {
      setToastMessage(`📝 Restored ${formatAirmanName(airman.rank)} ${airman.name} to ${dtName}${shiftSuffix}`);
    } else if (replacedAirman) {
      setToastMessage(
        `📝 Staged replace: ${formatAirmanName(replacedAirman.rank)} ${replacedAirman.name} ➔ ${formatAirmanName(airman.rank)} ${airman.name} (${dtName}${shiftSuffix}) — Click Apply`
      );
    } else {
      setToastMessage(
        `📝 Staged: ${formatAirmanName(airman.rank)} ${airman.name} ➔ ${dtName}${shiftSuffix} (Click Apply to save)`
      );
    }
    setTimeout(() => setToastMessage(''), 2500);

    // Unified Auto-Advance Workflow (uses staged nextAssignments):
    // 1. If the user is manually assigning an EXTRA duty beyond quota (already >= quota or 0 quota), do NOT jump away — stay on current Flight/Trade so they see e.g. 3/2 and can add more.
    // 2. If current Flight/Trade still has remaining quota (e.g. 1/2), stay on current Flight/Trade until its full quota (2/2) is filled.
    // 3. Once current Flight/Trade reaches its ratio quota (e.g. 2/2), auto-advance to the next eligible Flight/Trade with remaining quota, then next shift/duty/date when complete.
    if (dutyCodeToUse) {
      const hasSpecificScope = Boolean(targetFlight && targetFlight !== 'All');
      const scopeQuota = hasSpecificScope
        ? flightQuota
        : getRequiredCountForDuty(dutyCodeToUse, isIdac ? shiftToUse : undefined, 'All');
      const prevScopeAssigned = hasSpecificScope
        ? countAssignedForDutyFlightShift(assignmentsList, dutyCodeToUse, targetFlight as FlightName, isIdac ? shiftToUse : undefined)
        : countTotalAssignedForDutyShift(assignmentsList, dutyCodeToUse, isIdac ? shiftToUse : undefined);
      const nextScopeAssigned = hasSpecificScope
        ? countAssignedForDutyFlightShift(nextAssignments, dutyCodeToUse, targetFlight as FlightName, isIdac ? shiftToUse : undefined)
        : countTotalAssignedForDutyShift(nextAssignments, dutyCodeToUse, isIdac ? shiftToUse : undefined);

      const isManualExtraAssignment = scopeQuota <= 0 || prevScopeAssigned >= scopeQuota;
      const stillNeedsMoreInCurrentScope = scopeQuota > 0 && nextScopeAssigned < scopeQuota;

      if (isManualExtraAssignment) {
        // Stay right on the selected Flight/Trade when manually adding extra duties (e.g. 3/2)
        if (activeFlight !== 'All') {
          userManuallySelectedFlightRef.current = true;
        }
        return;
      }

      if (stillNeedsMoreInCurrentScope) {
        // Stay on the current Flight/Trade until all required airmen for its ratio (e.g. 2/2) are selected
        return;
      }

      userManuallySelectedDutyRef.current = false;
      userManuallySelectedShiftRef.current = false;
      userManuallySelectedFlightRef.current = false;

      const lockedFlt: FlightName | undefined =
        isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : undefined;
      const allowedFlights: FlightName[] = lockedFlt ? [lockedFlt] : getOrderedFlights();

      let advancedWithinCurrentDuty = false;

      if (isIdac) {
        const allShifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
        const currentShift: IDAShift = shiftToUse || activeIdaShift || 'Morning';

        const pickFlightForShift = (sh: IDAShift, preferAfter?: FlightName | 'All'): FlightName | undefined => {
          let ordered = allowedFlights;
          if (preferAfter && preferAfter !== 'All' && allowedFlights.length > 1) {
            const idx = allowedFlights.indexOf(preferAfter as FlightName);
            if (idx >= 0) {
              ordered = [...allowedFlights.slice(idx + 1), ...allowedFlights.slice(0, idx + 1)];
            }
          }
          return (
            ordered.find((flt) => {
              const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh);
              return req > 0 && countAssignedForDutyFlightShift(nextAssignments, 'IDAC', flt, sh) < req;
            }) || ordered.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh) > 0)
          );
        };

        const curShiftStatus = getQuotaFulfillmentStatus(fromDate, nextAssignments, 'IDAC', currentShift, lockedFlt);
        if (curShiftStatus.unfulfilled) {
          const nextFlt = pickFlightForShift(currentShift, targetFlight);
          setActiveIdaShift(currentShift);
          if (!isFlightLocked && !(isAdmin && adminFlight) && nextFlt) {
            setActiveFlight(nextFlt);
          }
          advancedWithinCurrentDuty = true;
        } else {
          const curShiftIdx = allShifts.indexOf(currentShift);
          const orderedNextShifts: IDAShift[] =
            curShiftIdx >= 0
              ? [...allShifts.slice(curShiftIdx + 1), ...allShifts.slice(0, curShiftIdx)]
              : allShifts;

          for (const sh of orderedNextShifts) {
            const shStatus = getQuotaFulfillmentStatus(fromDate, nextAssignments, 'IDAC', sh, lockedFlt);
            if (shStatus.unfulfilled) {
              const nextFlt = pickFlightForShift(sh);
              setActiveIdaShift(sh);
              if (!isFlightLocked && !(isAdmin && adminFlight) && nextFlt) {
                setActiveFlight(nextFlt);
              }
              advancedWithinCurrentDuty = true;
              break;
            }
          }
        }
      } else {
        const curDutyStatus = getQuotaFulfillmentStatus(fromDate, nextAssignments, dutyCodeToUse, undefined, lockedFlt);
        if (curDutyStatus.unfulfilled) {
          let ordered = allowedFlights;
          if (targetFlight && targetFlight !== 'All' && allowedFlights.length > 1) {
            const idx = allowedFlights.indexOf(targetFlight as FlightName);
            if (idx >= 0) {
              ordered = [...allowedFlights.slice(idx + 1), ...allowedFlights.slice(0, idx + 1)];
            }
          }
          const nextFlight =
            ordered.find((flt) => {
              const req = getFlightDutyQuotaForDate(fromDate, flt, dutyCodeToUse);
              return req > 0 && countAssignedForDutyFlightShift(nextAssignments, dutyCodeToUse, flt) < req;
            }) || ordered.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, dutyCodeToUse) > 0);

          if (nextFlight && !isFlightLocked && !(isAdmin && adminFlight)) {
            setActiveFlight(nextFlight);
          }
          advancedWithinCurrentDuty = true;
        }
      }

      if (!advancedWithinCurrentDuty) {
        const allActiveDuties = getActiveCountedDuties();
        const candidateDuties =
          isDutyLocked || onlyIdac
            ? allActiveDuties.filter((d) =>
                onlyIdac ? isIdacDutyCode(d.code) : d.code === dutyCodeToUse
              )
            : (() => {
                const curDutyIdx = allActiveDuties.findIndex((d) =>
                  isIdac ? isIdacDutyCode(d.code) : d.code === dutyCodeToUse
                );
                if (curDutyIdx >= 0) {
                  return [
                    ...allActiveDuties.slice(curDutyIdx + 1),
                    ...allActiveDuties.slice(0, curDutyIdx + 1),
                  ];
                }
                return allActiveDuties;
              })();

        interface DayQuotaSlot {
          dutyCode: DutyCategoryCode;
          shift?: IDAShift;
          flight: FlightName;
          unfulfilled: boolean;
          wasUnfulfilledBefore: boolean;
        }
        const allDaySlots: DayQuotaSlot[] = [];

        candidateDuties.forEach((dt) => {
          if (isIdacDutyCode(dt.code)) {
            const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
            shifts.forEach((sh) => {
              const shStatus = getQuotaFulfillmentStatus(fromDate, nextAssignments, 'IDAC', sh, lockedFlt);
              const prevShStatus = getQuotaFulfillmentStatus(fromDate, assignmentsList, 'IDAC', sh, lockedFlt);
              if (shStatus.required > 0) {
                const targetFlt =
                  allowedFlights.find((flt) => {
                    const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh);
                    return req > 0 && countAssignedForDutyFlightShift(nextAssignments, 'IDAC', flt, sh) < req;
                  }) ||
                  allowedFlights.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh) > 0) ||
                  allowedFlights[0];
                if (targetFlt) {
                  allDaySlots.push({
                    dutyCode: 'IDAC',
                    shift: sh,
                    flight: targetFlt,
                    unfulfilled: shStatus.unfulfilled,
                    wasUnfulfilledBefore: prevShStatus.unfulfilled,
                  });
                }
              }
            });
          } else {
            const dtStatus = getQuotaFulfillmentStatus(fromDate, nextAssignments, dt.code, undefined, lockedFlt);
            const prevDtStatus = getQuotaFulfillmentStatus(fromDate, assignmentsList, dt.code, undefined, lockedFlt);
            if (dtStatus.required > 0) {
              const targetFlt =
                allowedFlights.find((flt) => {
                  const req = getFlightDutyQuotaForDate(fromDate, flt, dt.code);
                  return req > 0 && countAssignedForDutyFlightShift(nextAssignments, dt.code, flt) < req;
                }) ||
                allowedFlights.find((flt) => getFlightDutyQuotaForDate(fromDate, flt, dt.code) > 0) ||
                allowedFlights[0];
              if (targetFlt) {
                allDaySlots.push({
                  dutyCode: dt.code,
                  shift: undefined,
                  flight: targetFlt,
                  unfulfilled: dtStatus.unfulfilled,
                  wasUnfulfilledBefore: prevDtStatus.unfulfilled,
                });
              }
            }
          }
        });

        const nextUnfulfilledOtherDuty = allDaySlots.find((s) => s.unfulfilled);
        const hadUnfulfilledBeforeThisAssign = allDaySlots.some((s) => s.wasUnfulfilledBefore);

        if (nextUnfulfilledOtherDuty) {
          setActiveDutyCode(nextUnfulfilledOtherDuty.dutyCode);
          setActiveIdaShift(nextUnfulfilledOtherDuty.shift);
          if (!isFlightLocked && !(isAdmin && adminFlight)) {
            setActiveFlight(nextUnfulfilledOtherDuty.flight);
          }
        } else if (allDaySlots.length > 0 && hadUnfulfilledBeforeThisAssign) {
          const lockDutyFilter =
            isDutyLocked || onlyIdac ? (isIdac ? 'IDAC' : dutyCodeToUse) : '';
          const lockFlightFilter = isFlightLocked ? activeFlight : 'All';
          const nextDateStr = findNextDateWithDutyQuota(
            fromDate,
            lockFlightFilter,
            lockDutyFilter,
            1
          );

          pendingAutoSelectDateRef.current = nextDateStr;
          setToastMessage(
            `📝 All quotas staged for ${fromDate}! Moving to ${nextDateStr} (Click Apply to save)...`
          );
          setTimeout(() => {
            setFromDate(nextDateStr);
            setToDate(nextDateStr);
            setSelectedPresetDays(1);
          }, 550);
        }
      }
    }
  };

  // Helper to format duty name badge on airman card and determine availability
  const getDutyStatusInfo = (airmanId: string) => {
    const targetDigits = String(airmanId || '').replace(/\D/g, '');
    const matchId = (id: any) => {
      if (id === airmanId) return true;
      const c = String(id || '').replace(/\D/g, '');
      return Boolean(targetDigits && c && c === targetDigits);
    };
    const airmanAssignments = assignmentsList.filter((a) => matchId(a.airmanId));
    const prevAssignments = prevDayAssignmentsList.filter((a) => matchId(a.airmanId));

    const isGenericStr = (s?: string) =>
      !s || ['DUTY', 'DUTY_ON', 'ON DUTY', 'DUTY ON', 'ON_PARADE', 'ON PARADE', 'PT', 'PT_PARADE', '-'].includes(s.toUpperCase().trim());
    const isDeploymentCode = (code?: string) =>
      ['DEPLOYMENT', 'CANTEEN', 'BAKE_N_BITE', 'ATT'].includes(String(code || '').toUpperCase().trim());

    // Helper to resolve yesterday's heavy duty off (ignoring baseline/deployment records if yesterday also had an active duty)
    const resolveYesterdayNightOff = (): { label: string; type: string; isFixed: boolean } | null => {
      if (prevAssignments.length === 0) return null;
      if (prevAssignments.some((a) => a.dutyCode === 'LEAVE')) return null;

      const yestAss =
        prevAssignments.find(
          (a) =>
            !isDeploymentCode(a.dutyCode) &&
            !isGenericStr(a.dutyCode) &&
            ((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') ? resolveCanonicalIdacShift(a) === 'Night' : true)
        ) ||
        prevAssignments.find((a) => !isDeploymentCode(a.dutyCode) && !isGenericStr(a.dutyCode)) ||
        prevAssignments[0];
      if (!yestAss || isDeploymentCode(yestAss.dutyCode)) return null;

      const isHeavy = (() => {
        try {
          const matrix = getStoredDutyMatrix(fromDate || selectedDate);
          const c = String(yestAss.dutyCode || '').toUpperCase();
          const s = (yestAss.idaShift || '').toLowerCase();
          const matched = matrix.find((t) => {
            if (['IDAC', 'IDA', 'IDA C', 'IDA_C'].includes(c) && ['IDAC', 'IDA'].includes(t.dutyCode)) {
              return t.shiftLabel && s ? t.shiftLabel.toLowerCase() === s : true;
            }
            return (
              t.dutyCode === c ||
              t.id === yestAss.dutyCode ||
              (t.title && t.title.toLowerCase() === String(yestAss.dutyName || yestAss.notes || '').toLowerCase())
            );
          });
          if (matched?.dutyOffNextDay !== undefined) {
            return matched.dutyOffNextDay;
          }
        } catch {}
        return (
          ['GD', 'BTF', 'NTF', 'AIRPORT', 'HALISHAHAR'].includes(yestAss.dutyCode) ||
          ((yestAss.dutyCode === 'IDAC' || yestAss.dutyCode === 'IDA') && yestAss.idaShift === 'Night') ||
          (yestAss.notes || '').toLowerCase().includes('idac') ||
          yestAss.dutyCode === 'ESCORT' ||
          yestAss.dutyCode === 'ESC' ||
          yestAss.dutyCode === 'ESCT' ||
          String(yestAss.dutyCode || '').includes('1794394') ||
          (yestAss.dutyName || '').toLowerCase().includes('escort') ||
          (yestAss.notes || '').toLowerCase().includes('escort')
        );
      })();

      if (!isHeavy) return null;

      let offShort = 'SY Off';
      if (
        yestAss.dutyCode === 'ESCORT' ||
        yestAss.dutyCode === 'ESC' ||
        yestAss.dutyCode === 'ESCT' ||
        String(yestAss.dutyCode || '').includes('1794394') ||
        (yestAss.dutyName || '').toLowerCase().includes('escort') ||
        (yestAss.notes || '').toLowerCase().includes('escort')
      )
        offShort = 'Esct Off';
      else if (yestAss.dutyCode === 'GD' || (yestAss.dutyCode as any) === 'SY') offShort = 'SY Off';
      else if (yestAss.dutyCode === 'BTF') offShort = 'BTF Off';
      else if (yestAss.dutyCode === 'NTF') offShort = 'NTF Off';
      else if (yestAss.dutyCode === 'AIRPORT') offShort = 'Airport Off';
      else if (yestAss.dutyCode === 'HALISHAHAR') offShort = 'Halishahar Off';
      else if ((yestAss.dutyCode === 'IDAC' || yestAss.dutyCode === 'IDA') && yestAss.idaShift === 'Night')
        offShort = 'IDAC Nt Off';
      else if ((yestAss.notes || '').toLowerCase().includes('idac')) offShort = 'IDAC Nt Off';

      return { label: offShort, type: 'NIGHT_OFF', isFixed: false };
    };

    // 1. Current Day Assignments: Check Leave & TDY FIRST (Highest Priority over Deployment & Duties)
    if (airmanAssignments.length > 0) {
      // 1A. Leave (Highest priority over Canteen, Bake & Bite, Deployment, and Duties)
      const leave = airmanAssignments.find((a) => {
        const c = String(a.dutyCode || '').toUpperCase().trim();
        return (
          c === 'LEAVE' ||
          c === 'RL' ||
          c === 'CL' ||
          c === 'AL' ||
          c === 'SL' ||
          c === 'SICK_LEAVE' ||
          c.includes('LEAVE')
        );
      });
      if (leave) {
        const textLower = `${leave.dutyCode || ''} ${leave.dutyName || ''} ${leave.notes || ''}`.toLowerCase();
        let lbl = 'Leave';
        if (textLower.includes('sick') || /\bsl\b/.test(textLower)) lbl = 'Sick Leave';
        else if (textLower.includes('recreation') || /\brl\b/.test(textLower) || textLower.includes('rec leave')) lbl = 'Leave (RL)';
        else if (textLower.includes('casual') || /\bcl\b/.test(textLower)) lbl = 'Leave (CL)';
        else if (textLower.includes('annual') || /\bal\b/.test(textLower)) lbl = 'Leave (AL)';
        return { label: lbl, type: 'LEAVE', isFixed: true };
      }

      // 1B. TDY / Detachment
      const tdy = airmanAssignments.find((a) => a.dutyCode === 'TDY' || a.dutyCode === 'DETT');
      if (tdy) return { label: 'TDY', type: 'TDY', isFixed: true };

      // 1C. IDAC Duties
      const idacAssignments = airmanAssignments.filter(
        (a) =>
          a.dutyCode === 'IDAC' ||
          a.dutyCode === 'IDA' ||
          (a.dutyName && a.dutyName.toUpperCase().includes('IDAC')) ||
          (a.notes && a.notes.toUpperCase().includes('IDAC'))
      );
      if (idacAssignments.length > 0) {
        const shifts = idacAssignments
          .map((a) => {
            const s =
              a.idaShift ||
              (a.notes?.toLowerCase().includes('night')
                ? 'Night'
                : a.notes?.toLowerCase().includes('afternoon')
                ? 'Afternoon'
                : 'Morning');
            return s === 'Morning' ? 'M' : s === 'Afternoon' ? 'A' : s === 'Night' ? 'Nt' : s;
          })
          .filter(Boolean)
          .join('+');
        return { label: shifts ? `IDAC (${shifts})` : 'IDAC', type: 'IDAC', isFixed: false };
      }

      // 1D. Fixed Task Forces & Operational Duties
      const btf = airmanAssignments.find((a) => a.dutyCode === 'BTF' || (a.dutyName && a.dutyName.toUpperCase().includes('BTF')));
      if (btf) return { label: 'BTF', type: 'BTF', isFixed: true };

      const ntf = airmanAssignments.find((a) => a.dutyCode === 'NTF' || (a.dutyName && a.dutyName.toUpperCase().includes('NTF')));
      if (ntf) return { label: 'NTF', type: 'NTF', isFixed: true };

      const halishahar = airmanAssignments.find((a) => a.dutyCode === 'HALISHAHAR');
      if (halishahar) return { label: 'Halishahar', type: 'HALISHAHAR', isFixed: true };

      const airport = airmanAssignments.find(
        (a) =>
          a.dutyCode === 'AIRPORT' ||
          (a.dutyCode as string) === 'AIRFIELD_DUTY' ||
          (a.dutyName && a.dutyName.toUpperCase().includes('AIRPORT')) ||
          (a.dutyName && a.dutyName.toUpperCase().includes('AIRFIELD'))
      );
      if (airport) return { label: 'Airport', type: 'AIRPORT', isFixed: false };

      const gd = airmanAssignments.find(
        (a) =>
          a.dutyCode === 'GD' ||
          (a.dutyCode as any) === 'SY' ||
          (a.dutyName && (a.dutyName.toUpperCase().includes('SECURITY') || /\b(GD|SY)\b/.test(a.dutyName.toUpperCase())))
      );
      if (gd) {
        return { label: 'Security (SY)', type: 'GD', isFixed: false };
      }

      // 1E. Any other explicit non-deployment operational duty today (e.g., Reception, Escort, custom duties)
      const otherOpDuty = airmanAssignments.find(
        (a) => !isDeploymentCode(a.dutyCode) && a.dutyCode !== 'DUTY_OFF' && !isGenericStr(a.dutyCode)
      );
      if (otherOpDuty) {
        const name =
          DUTY_TYPE_MAP.get(otherOpDuty.dutyCode as any)?.name ||
          (otherOpDuty.dutyName && !isGenericStr(otherOpDuty.dutyName) ? otherOpDuty.dutyName : '') ||
          (otherOpDuty.notes && !isGenericStr(otherOpDuty.notes) ? otherOpDuty.notes : '') ||
          otherOpDuty.dutyCode;
        if (!isGenericStr(name)) {
          return { label: name, type: otherOpDuty.dutyCode, isFixed: false };
        }
      }

      // Check generic dutyCode with specific dutyName/notes
      const genericWithSpecific = airmanAssignments.find(
        (a) =>
          isGenericStr(a.dutyCode) &&
          ((a.dutyName && !isGenericStr(a.dutyName)) || (a.notes && !isGenericStr(a.notes)))
      );
      if (genericWithSpecific) {
        const specificName =
          (!isGenericStr(genericWithSpecific.dutyName) ? genericWithSpecific.dutyName : '') ||
          (!isGenericStr(genericWithSpecific.notes) ? genericWithSpecific.notes : '');
        if (specificName) {
          return { label: specificName, type: genericWithSpecific.dutyCode, isFixed: false };
        }
      }

      // 1F. Explicit DUTY_OFF today
      const explicitOff = airmanAssignments.find((a) => a.dutyCode === 'DUTY_OFF');
      if (explicitOff) {
        const yestOff = resolveYesterdayNightOff();
        if (yestOff) return yestOff;
        const offName =
          explicitOff.previousDutyName?.toLowerCase().includes('escort') || explicitOff.notes?.toLowerCase().includes('escort')
            ? 'Esct Off'
            : explicitOff.previousDutyName || explicitOff.notes || 'SY Off';
        return { label: offName, type: 'DUTY_OFF', isFixed: false };
      }
    }

    // 2. Check if person performed Heavy/Night Duty yesterday (Night Off today takes priority over Deployment & On Parade)
    const yestNightOff = resolveYesterdayNightOff();
    if (yestNightOff) {
      return yestNightOff;
    }

    // 3. Deployment (Canteen / Bake & Bite / Custom Deployment) — airman is on deployment and eligible for duties
    if (airmanAssignments.length > 0) {
      const canteen = airmanAssignments.find(
        (a) => a.dutyCode === 'CANTEEN' || (isDeploymentCode(a.dutyCode) && (a.notes || '').toLowerCase().includes('canteen'))
      );
      if (canteen) return { label: 'Canteen', type: 'CANTEEN', isFixed: false };

      const bnb = airmanAssignments.find(
        (a) => a.dutyCode === 'BAKE_N_BITE' || (isDeploymentCode(a.dutyCode) && (a.notes || '').toLowerCase().includes('bake'))
      );
      if (bnb) return { label: 'Bake & Bite', type: 'BAKE_N_BITE', isFixed: false };

      const deployment = airmanAssignments.find((a) => a.dutyCode === 'DEPLOYMENT' || a.dutyCode === 'ATT');
      if (deployment) {
        let dest = (deployment.notes || 'Deployment').trim();
        if (dest.includes(' - ')) dest = dest.split(' - ')[0].trim();
        return { label: dest || 'Deployment', type: 'DEPLOYMENT', isFixed: false };
      }
    }

    // 4. Otherwise available on parade
    return { label: 'On Parade', type: 'ON_PARADE', isFixed: false };
  };

  // Filter candidates for the active duty and active flight
  const candidatePersonnel = useMemo(() => {
    const targetFlight = proxyForFlight && isProxyEnabled ? proxyForFlight : activeFlight;

    return airmen
      .filter((airman) => {
        // Admin restriction
        if (isAdmin && adminFlight && airman.flightName !== adminFlight) {
          return false;
        }
        // Exclude inactive / Posted Out / Retired / Dismissed airmen
        if (airman.active === false) return false;
        const leaveReasonLower = String((airman as any).leaveReason || (airman as any).status || '').toLowerCase().trim();
        if (['posted out', 'retired', 'dismissed', 'inactive'].includes(leaveReasonLower)) return false;
        // Active Date Filtering (ensure they exist in the unit on fromDate)
        if (airman.dateJoined && airman.dateJoined > fromDate) return false;
        if (airman.dateLeft && airman.dateLeft <= fromDate) return false;

        if (targetFlight !== 'All' && !matchesAirmanGroup(airman, targetFlight as FlightName)) return false;

        // If IDAC duty is selected but no shift is selected, show empty list
        if ((['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) && !activeIdaShift) {
           return false;
        }

        const isAssigned = isAirmanAssignedToActiveDuty(airman.id);
        if (isAssigned) return true;

        const dutyConfig = DUTY_TYPE_MAP.get(activeDutyCode as any);
        if (dutyConfig) {
          // If the duty has overridden eligible flights in the matrix, use those instead
          const matrixConfig = getStoredDutyMatrix().find(t => t.dutyCode === activeDutyCode);
          const eligibleFlights = matrixConfig?.eligibleFlights || (officeHasFlights ? dutyConfig.eligibleFlights : undefined);
          const eligibleRanks = matrixConfig?.eligibleRanks || dutyConfig.eligibleRanks;
          
          // Allow assigning from any manually selected flight outside the ratio/eligibleFlights list
          if (targetFlight === 'All' && eligibleFlights && eligibleFlights.length > 0) {
            const airmanGroup = officeHasFlights ? airman.flightName : (airman.trade || airman.flightName);
            if (!eligibleFlights.includes(airmanGroup as any)) return false;
          }
          if (eligibleRanks && eligibleRanks.length > 0) {
            if (!eligibleRanks.includes(airman.rank as any)) return false;
          }
          
          // Return true if it passed the specific configured filters.
          // This avoids the legacy hardcoded checks below overriding the matrix configuration.
          if (eligibleFlights?.length || eligibleRanks?.length || dutyConfig.isCustom) return true;
        }

        const rankLower = (airman.rank || '').toLowerCase();
        const isWO = ['wo', 'swo', 'mwo', 'w/o'].some((r) => rankLower.includes(r));

        // IDAC Duty: All ranks eligible (MWO, SWO, WO, Sgt, Cpl, LAC, AC) - no exclusions
        if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
          return true;
        }

        // For soldier duties (non-IDAC), exclude Warrant Officers
        if (['GD', 'AIRPORT', 'ATT', 'BTF', 'NTF', 'HALISHAHAR', 'BAKE_N_BITE'].includes(activeDutyCode)) {
          if (isWO) return false;
        }

        // Security Duty (GD) is strictly for Corporals & LACs/ACs
        if (activeDutyCode === 'GD') {
          const isCplOrBelow = ['cpl', 'lac', 'ac1', 'ac2', 'corporal'].some((r) => rankLower.includes(r));
          if (!isCplOrBelow) return false;
        }

        // Task Force duties (BTF, NTF, HALISHAHAR)
        if (['BTF', 'NTF', 'HALISHAHAR'].includes(activeDutyCode)) {
          const isEligible = ['sgt', 'cpl', 'lac', 'ac1', 'ac2', 'sergeant', 'corporal', 'aircraftman'].some((r) => rankLower.includes(r));
          if (!isEligible) return false;
        }

        return true;
      })
      .filter((airman) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          airman.name.toLowerCase().includes(q) ||
          airman.rank.toLowerCase().includes(q) ||
          airman.bdNo.toLowerCase().includes(q) ||
          airman.trade.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const isAInCurrent = isAirmanAssignedToActiveDuty(a.id);
        const isBInCurrent = isAirmanAssignedToActiveDuty(b.id);

        if (isAInCurrent && !isBInCurrent) return -1;
        if (!isAInCurrent && isBInCurrent) return 1;

        

        // Priority for Airport in Avionics: Sgt Mustakim
        if (activeDutyCode === 'ATT' || activeDutyCode === 'AIRPORT') {
          const isAMustakim = a.name.toLowerCase().includes('mustakim') || a.bdNo === '469598';
          const isBMustakim = b.name.toLowerCase().includes('mustakim') || b.bdNo === '469598';
          if (isAMustakim && !isBMustakim) return -1;
          if (!isAMustakim && isBMustakim) return 1;
        }

        return a.serNo - b.serNo;
      });
  }, [airmen, activeFlight, proxyForFlight, isProxyEnabled, activeDutyCode, activeIdaShift, searchQuery, assignmentsList, prevDayAssignmentsList]);

  const activeDateStr = fromDate || selectedDate;
  const isHoliday = isHolidayDate(activeDateStr);
  const weekdayShort = getWeekdayShort(activeDateStr);
  const weekdayFull = getWeekdayFull(activeDateStr);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && hasUnsavedChanges) {
          requestLeaveModal({ type: 'close' });
        }
      }}
      className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:pt-6 sm:pb-6 sm:px-5 overflow-y-auto bg-slate-950/75 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-white dark:bg-slate-900 rounded-none sm:rounded-2xl border-0 sm:border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full p-4 sm:p-5 space-y-3.5 relative overflow-hidden h-full sm:h-auto sm:max-h-[calc(100vh-3rem)] flex flex-col">
        {/* Floating Overlay Toast Notification (overlays box without altering modal shape or layout) */}
        {toastMessage && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-50 flex justify-center px-4">
            <div
              className={`pointer-events-auto max-w-xl w-fit px-3.5 py-2.5 text-white rounded-xl font-bold text-xs shadow-xl ring-1 ring-white/25 backdrop-blur-sm flex items-center space-x-2 animate-fadeIn ${
                toastMessage.startsWith('❌')
                  ? 'bg-rose-600/95'
                  : toastMessage.startsWith('⚠️')
                  ? 'bg-amber-600/95'
                  : toastMessage.startsWith('📝')
                  ? 'bg-sky-600/95'
                  : toastMessage.startsWith('🗑️')
                  ? 'bg-slate-700/95'
                  : 'bg-emerald-600/95'
              }`}
            >
              {toastMessage.startsWith('⚠️') || toastMessage.startsWith('❌') ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{toastMessage}</span>
            </div>
          </div>
        )}

        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl text-white shadow-md ${onlyIdac ? 'bg-teal-600' : 'bg-emerald-600'}`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">
                  {onlyIdac ? 'IDA Center Duty Assignment' : 'Assign Duty / Activity'}
                </h2>
                {hasUnsavedChanges ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black border bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                    Unsaved ({pendingOps.length})
                  </span>
                ) : (
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-black border ${
                    onlyIdac 
                      ? 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                      : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  }`}>
                    Apply to Save
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {onlyIdac
                  ? 'Click IDAC shift and airman below, then click Apply to save changes.'
                  : 'Select a tab below to assign Duty, Leave, TDY, or Deployment. Click Apply to save duty changes.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => requestLeaveModal({ type: 'close' })}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {(['Duty', 'Leave', 'TDY', 'Deployment'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                if (tab === activeModalTab) return;
                if (activeModalTab === 'Duty' && hasUnsavedChanges) {
                  requestLeaveModal({ type: 'switchTab', tab });
                } else {
                  setActiveModalTab(tab);
                }
              }}
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-lg transition-colors flex-1 text-center cursor-pointer ${activeModalTab === tab ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
            >
              {tab}
            </button>
          ))}
        </div>
        
        {activeModalTab === 'Leave' && (
          <AssignLeaveTab
            airmen={airmen}
            initialFromDate={fromDate}
            initialToDate={toDate}
            initialFlight={activeFlight !== 'All' ? activeFlight : undefined}
            onClose={onClose}
            onSuccess={() => { if(onSuccess) onSuccess(); else if (onRefreshParadeData) onRefreshParadeData(); onClose(); }}
          />
        )}
        {activeModalTab === 'TDY' && (
          <AssignTdyTab
            airmen={airmen}
            initialFromDate={fromDate}
            initialToDate={toDate}
            initialFlight={activeFlight !== 'All' ? activeFlight : undefined}
            onClose={onClose}
            onSuccess={() => { if(onSuccess) onSuccess(); else if (onRefreshParadeData) onRefreshParadeData(); onClose(); }}
          />
        )}
        {activeModalTab === 'Deployment' && (
          <AssignDeploymentTab
            airmen={airmen}
            initialFromDate={fromDate}
            initialToDate={toDate}
            initialFlight={activeFlight !== 'All' ? activeFlight : undefined}
            onClose={onClose}
            onSuccess={() => { if(onSuccess) onSuccess(); else if (onRefreshParadeData) onRefreshParadeData(); onClose(); }}
          />
        )}
        
        <div style={{ display: activeModalTab === 'Duty' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto space-y-3.5 pr-1">
          
          {/* 1. Date Selection Bar */}
          <div className="p-2.5 rounded-xl border bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 transition-colors">
            <div className="flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Assignment Date:
              </span>
              <div className="flex items-center space-x-1.5">
                {[{label: 'Today', val: 1}, {label: '2 Days', val: 2}, {label: '3 Days', val: 3}, {label: '7 Days', val: 7}, {label: '15 Days', val: 15}].map((opt) => {
                  const isFirstButton = opt.val === 1;
                  const showBackButton = isFirstButton && isMultiDateMode;
                  const isSelected = !showBackButton && selectedPresetDays === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      title={
                        showBackButton
                          ? `Back to single date (${singleDateBeforeMulti || fromDate})`
                          : undefined
                      }
                      onClick={() => {
                        if (isFirstButton) {
                          if (isMultiDateMode) {
                            const backDate = singleDateBeforeMulti || fromDate || todayStr;
                            setFromDate(backDate);
                            setToDate(backDate);
                            setSelectedPresetDays(backDate === todayStr ? 1 : -1);
                            setSingleDateBeforeMulti(null);
                          } else {
                            const currentTodayStr = new Date().toISOString().split('T')[0];
                            setFromDate(currentTodayStr);
                            setToDate(currentTodayStr);
                            setSelectedPresetDays(1);
                            setSingleDateBeforeMulti(null);
                          }
                        } else {
                          if (!isMultiDateMode && fromDate) {
                            setSingleDateBeforeMulti(fromDate);
                          }
                          setSelectedPresetDays(opt.val);
                          if (fromDate) {
                            const d = new Date(fromDate);
                            d.setDate(d.getDate() + opt.val - 1);
                            setToDate(d.toISOString().split('T')[0]);
                          }
                        }
                      }}
                      className={`px-2 py-1 text-[10px] font-black rounded-lg transition-all cursor-pointer shadow-2xs border inline-flex items-center gap-1 ${
                        showBackButton
                          ? 'bg-amber-500/15 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-400/60 dark:border-amber-500/50 hover:bg-amber-500 hover:text-white hover:border-amber-500'
                          : isSelected
                          ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-500/50 shadow-sm'
                          : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 dark:hover:text-emerald-300 hover:border-emerald-300'
                      }`}
                    >
                      {showBackButton ? (
                        <>
                          <ArrowLeft className="w-3 h-3" />
                          <span>Back</span>
                        </>
                      ) : (
                        opt.label
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {weekdayFull && (
                <span
                  className={`px-2.5 py-1 text-[11px] font-black rounded-md border shrink-0 transition-colors ${
                    isHoliday
                      ? 'bg-rose-600 text-white border-rose-500 shadow-xs ring-2 ring-rose-500/30'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-600'
                  }`}
                  title={isHoliday ? `${weekdayFull} (Holiday / Off Day)` : weekdayFull}
                >
                  {weekdayFull}
                </span>
              )}
              <button
                  type="button"
                  onClick={() => handleShiftDate(-1)}
                  className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs"
                  title="Previous Date (Left Arrow Key)"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              <DateNavigator
                hideArrows={true}
                format="dd_mm"
                value={fromDate || ''}
                multiSelectMode={isAirmenLocked && lockedAirmenIds.length > 0}
                onApplyMultipleDates={handleApplyLockedAirmenToDates}
                minDate={isAdmin && !isSuperAdmin ? todayStr : undefined}
                multiSelectSummary={`${lockedAirmenIds.length} Airmen Locked • ${
                  activeDutyCode ? (DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode) : 'Select Duty first'
                }${
                  ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string) && activeIdaShift
                    ? ` (${activeIdaShift})`
                    : ''
                }`}
                onChange={(e) => {
                  const val = e.target.value;
                  setFromDate(val);
                  
                  if (selectedPresetDays !== null) {
                    const d = new Date(val);
                    const spanDays = selectedPresetDays === -1 ? 1 : selectedPresetDays;
                    d.setDate(d.getDate() + spanDays - 1); 
                    const newTo = d.toISOString().split('T')[0];
                    setToDate(newTo);
                    updatePresetBasedOnDates(val, newTo);
                  } else {
                    if (toDate < val) {
                      setToDate(val);
                      setSelectedPresetDays(val === todayStr ? 1 : -1);
                      setSingleDateBeforeMulti(null);
                    } else {
                      updatePresetBasedOnDates(val, toDate);
                    }
                  }
                }}
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border outline-none cursor-pointer transition-all ${
                  isAirmenLocked && lockedAirmenIds.length > 0
                    ? 'border-amber-500 ring-2 ring-amber-400/40 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-100'
                    : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:border-emerald-500'
                }`}
              />
              {isApplyingMultiDates && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500 text-white text-[10px] font-black animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  Applying...
                </span>
              )}
              <button
                  type="button"
                  onClick={() => handleShiftDate(1)}
                  className="p-1 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer shrink-0 border border-slate-200 dark:border-slate-700 shadow-xs"
                  title="Next Date (Right Arrow Key)"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              {selectedPresetDays !== 1 && selectedPresetDays !== -1 && (
                <>
                  <span className="text-xs text-slate-400">to</span>
                  <DateNavigator
                    format="dd_mm"
                    value={toDate || ''}
                    min={fromDate}
                    onChange={(e) => {
                      const newTo = e.target.value;
                      setToDate(newTo);
                      updatePresetBasedOnDates(fromDate, newTo);
                    }}
                    className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500 cursor-pointer"
                  />
                </>
              )}
            </div>
          </div>

          {/* 2. Duty Category or IDAC Shift Selection */}
          {!onlyIdac && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-1.5 flex-wrap">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    1. Choose Duty:
                  </span>

                  {/* Duty Lock Toggle Button */}
                  <button
                    type="button"
                    onClick={() => {
                      const nextDutyLocked = !isDutyLocked;
                      setIsDutyLocked(nextDutyLocked);
                      if (nextDutyLocked) {
                        if (typeof window !== 'undefined') {
                          window.sessionStorage.setItem('baf_duty_duty_locked', 'true');
                        }
                        if (!activeDutyCode) {
                          const candidate = DUTY_TYPES.find(dt => dt.isCountedAsDuty && getRequiredCountForDuty(dt.code) > 0);
                          setActiveDutyCode(candidate ? candidate.code : 'GD');
                        }
                      } else {
                        if (typeof window !== 'undefined') {
                          window.sessionStorage.setItem('baf_duty_duty_locked', 'false');
                        }
                      }
                    }}
                    title={
                      isDutyLocked 
                        ? `Duty is locked to ${activeDutyCode || 'selected duty'}. Click to unlock.` 
                        : 'Click to lock this duty: Automatically selects flights by ratio quota, auto-advances through flights/shifts, and advances to next date when completed.'
                    }
                    className={`p-1.5 text-xs font-bold rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                      isDutyLocked
                        ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-400/40'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600'
                    }`}
                    aria-label={isDutyLocked ? 'Duty Locked' : 'Duty Unlocked'}
                  >
                    {isDutyLocked ? <Lock className="w-3.5 h-3.5 stroke-[2.5]" /> : <Unlock className="w-3.5 h-3.5" />}
                  </button>

                  <span className="hidden sm:inline text-[11px] text-slate-400 ml-1">
                    (Click duty, then click airman below to assign)
                  </span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setFilterByRatio(!filterByRatio)}
                    className="px-2 py-0.5 text-[10px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 flex items-center space-x-1 cursor-pointer"
                  >
                    {filterByRatio ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    <span>{filterByRatio ? 'Ratio Duties' : 'Show All'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRatioModal(true)}
                    className="px-2 py-0.5 text-[10px] font-bold rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 flex items-center space-x-1 cursor-pointer"
                    title="Configure Official Ratios"
                  >
                    <Sliders className="w-3 h-3" />
                    <span>Ratios</span>
                  </button>
                </div>
              </div>

              {/* Duty Category Cards with Detailed Airmen List */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {(() => {
                  const _storedMatrix = getStoredDutyMatrix();
                  const allDuties = getActiveCountedDuties();
                  const cardFlightScope: FlightName | 'All' =
                    isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : 'All';

                  const ratioFiltered = allDuties.filter((dt) => {
                    const req = getRequiredCountForDuty(dt.code, undefined, cardFlightScope);
                    const assignedCount = getAssignedAirmenForDuty(dt.code, undefined, cardFlightScope).length;
                    return req > 0 || assignedCount > 0;
                  });

                  // If duty is locked, show only the locked duty card; otherwise if flight is locked, show duties for that flight
                  const dutiesToRender = (() => {
                    if (isDutyLocked && activeDutyCode) {
                      const lockedOnly = allDuties.filter((dt) => dt.code === activeDutyCode);
                      if (lockedOnly.length > 0) return lockedOnly;
                    }
                    if (isFlightLocked && activeFlight !== 'All') {
                      return allDuties.filter((dt) => {
                        const fltQuota = getRequiredCountForDuty(dt.code, undefined, activeFlight as FlightName);
                        const fltAssigned = getAssignedAirmenForDuty(dt.code, undefined, activeFlight as FlightName).length;
                        return fltQuota > 0 || fltAssigned > 0;
                      });
                    }
                    return filterByRatio ? ratioFiltered : allDuties;
                  })();

                  if (dutiesToRender.length === 0) {
                    return (
                      <div className="col-span-full py-6 text-center text-sm font-bold text-slate-500 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
                        {isFlightLocked && activeFlight !== 'All' 
                          ? `No duties scheduled for ${activeFlight} Flight on ${fromDate}.` 
                          : 'No active duties scheduled in the Ratio Matrix for this date.'}
                      </div>
                    );
                  }

                  return dutiesToRender.map((dt) => {
                    const isSelected = activeDutyCode === dt.code;
                    const reqQuota = getRequiredCountForDuty(dt.code, undefined, cardFlightScope);
                    const assignedList = getAssignedAirmenForDuty(dt.code, undefined, cardFlightScope);
                    
                    let displayName = dt.name;
                    if (dt.code !== 'IDAC' && dt.code !== 'IDA') {
                      const mEntries = _storedMatrix.filter(t => t.dutyCode === dt.code);
                      if (mEntries.length > 0 && mEntries[0].title) {
                        displayName = mEntries[0].title;
                      }
                    }

                    const isIdacCard = dt.code === 'IDAC' || dt.code === 'IDA';
                    const isOverQuota = isIdacCard
                      ? (reqQuota > 0 && assignedList.length > reqQuota) ||
                        (reqQuota === 0 && assignedList.length > 0) ||
                        (['Morning', 'Afternoon', 'Night'] as IDAShift[]).some((sh) => {
                          const q = getRequiredCountForDuty('IDAC', sh, cardFlightScope);
                          const a = getAssignedAirmenForDuty('IDAC', sh, cardFlightScope).length;
                          return (q > 0 && a > q) || (q === 0 && a > 0);
                        })
                      : (reqQuota > 0 && assignedList.length > reqQuota) || (reqQuota === 0 && assignedList.length > 0);

                    const isUnderQuota =
                      !isOverQuota &&
                      (isIdacCard
                        ? (reqQuota > 0 && assignedList.length < reqQuota) ||
                          (['Morning', 'Afternoon', 'Night'] as IDAShift[]).some((sh) => {
                            const q = getRequiredCountForDuty('IDAC', sh, cardFlightScope);
                            const a = getAssignedAirmenForDuty('IDAC', sh, cardFlightScope).length;
                            return q > 0 && a < q;
                          })
                        : reqQuota > 0 && assignedList.length < reqQuota);

                    const quotaBorderAlertClass = isOverQuota
                      ? 'duty-box-over-quota'
                      : isUnderQuota
                      ? 'duty-box-under-quota'
                      : '';

                    return (
                      <div
                        key={dt.code}
                        onClick={() => {
                          userManuallySelectedDutyRef.current = true;
                          userManuallySelectedFlightRef.current = false;
                          userManuallySelectedShiftRef.current = false;
                          setActiveDutyCode(dt.code);
                          setSelectionMode('DutyFirst');

                          if (isIdacDutyCode(dt.code)) {
                            const lockedFltClick: FlightName | undefined =
                              isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : undefined;
                            const slot = findFirstUnfulfilledIdacSlot(fromDate, assignmentsList);
                            if (slot && slot.isUnfulfilled) {
                              setActiveIdaShift(slot.shift);
                              if (!isFlightLocked && !(isAdmin && adminFlight)) {
                                setActiveFlight(slot.flight);
                              }
                            } else {
                              const shiftsToPick: IDAShift[] =
                                availableIdaShifts.length > 0 ? availableIdaShifts : (['Morning', 'Afternoon', 'Night'] as IDAShift[]);
                              const exceededShift = shiftsToPick.find((sh) => {
                                const st = getQuotaFulfillmentStatus(fromDate, assignmentsList, 'IDAC', sh, lockedFltClick);
                                return (st.required > 0 && st.assigned > st.required) || (st.required === 0 && st.assigned > 0);
                              });
                              const chosenShift = exceededShift || slot?.shift || shiftsToPick[0];
                              setActiveIdaShift(chosenShift);
                              if (!isFlightLocked && !(isAdmin && adminFlight) && chosenShift) {
                                const orderedFlts = getOrderedFlights();
                                const targetFlt =
                                  orderedFlts.find((f) => getFlightDutyQuotaForDate(fromDate, f, 'IDAC', chosenShift) > 0) ||
                                  slot?.flight ||
                                  'All';
                                setActiveFlight(targetFlt);
                              }
                            }
                          } else {
                            setActiveIdaShift(undefined);
                            if (!isFlightLocked && !(isAdmin && adminFlight)) {
                              const fltRes = findFirstUnfulfilledFlightForDuty(fromDate, dt.code, assignmentsList);
                              setActiveFlight(fltRes.flight);
                            }
                          }
                        }}
                        className={`p-2 rounded-xl border text-left transition-all relative flex flex-col justify-start cursor-pointer ${
                          isSelected
                            ? 'bg-teal-600 dark:bg-teal-600 text-white border-white shadow-md duty-box-selected'
                            : 'bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700/80 hover:border-emerald-400 hover:shadow-xs'
                        } ${quotaBorderAlertClass}`}
                      >
                        {/* Header: Duty Name & Ratio Badge (e.g. 3/3) */}
                        <div className={`flex items-center justify-between gap-1 border-b pb-1.5 mb-1.5 ${
                          isSelected ? 'border-teal-400/50' : 'border-slate-100 dark:border-slate-700/60'
                        }`}>
                          <span className={`text-[11px] font-black truncate leading-tight flex items-center gap-1 ${isSelected ? 'text-white' : 'text-slate-900 dark:text-slate-100'}`} title={displayName}>
                            {isSelected && (
                              <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-white text-teal-700 shrink-0 shadow-2xs">
                                <Check className="w-2.5 h-2.5 stroke-[3.5]" />
                              </span>
                            )}
                            {isDutyLocked && isSelected && (
                              <Lock className="w-3 h-3 text-amber-300 stroke-[2.5] shrink-0" />
                            )}
                            <span className="truncate">{displayName}</span>
                          </span>
                          <div className="shrink-0">
                            {reqQuota > 0 ? (
                              <span
                                className={`text-[9.5px] font-black px-1.5 py-0.2 rounded-full ${
                                  isOverQuota
                                    ? 'bg-rose-600 text-white ring-1 ring-white/40'
                                    : isUnderQuota
                                    ? 'bg-amber-400 text-slate-950 ring-1 ring-white/40'
                                    : isSelected
                                    ? 'bg-white text-teal-900 shadow-2xs'
                                    : 'bg-emerald-600 text-white shadow-2xs'
                                }`}
                              >
                                {assignedList.length}/{reqQuota}
                              </span>
                            ) : (
                              <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-full ${
                                isOverQuota
                                  ? 'bg-rose-600 text-white'
                                  : isSelected
                                  ? 'bg-white text-teal-900'
                                  : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                              }`}>
                                {assignedList.length}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Detailed Airmen List */}
                        <div className="space-y-1">
                          {assignedList.length === 0 ? (
                            <p className={`text-[10px] italic py-0.5 ${isSelected ? 'text-teal-100' : 'text-slate-400 dark:text-slate-500'}`}>
                              — None
                            </p>
                          ) : (
                            assignedList.map((item, idx) => (
                              <div
                                key={`${item.airman.id}-${item.assignment.dutyCode}-${item.assignment.idaShift || ''}-${idx}`}
                                className={`text-[10.5px] leading-tight font-semibold truncate px-1.5 py-0.5 rounded border flex items-center justify-between group ${
                                  isSelected
                                    ? 'bg-teal-800/80 text-white border-teal-400/40'
                                    : 'text-slate-800 dark:text-slate-200 bg-slate-50/80 dark:bg-slate-900/60 border-slate-200/50 dark:border-slate-700/50'
                                }`}
                                title={`${formatAirmanName(item.airman.rank)} ${item.airman.name}`}
                              >
                                <div className="truncate flex items-center">
                                  <span className={`font-bold mr-1 ${isSelected ? 'text-teal-200' : 'text-slate-400 dark:text-slate-500'}`}>{idx + 1}.</span>
                                  <span className="truncate">{formatAirmanName(item.airman.rank)} {item.airman.name}</span>
                                  {(item.assignment.dutyCode === 'IDAC' || item.assignment.dutyCode === 'IDA') && item.assignment.idaShift && (
                                    <span className={`ml-1 text-[9.5px] font-bold ${isSelected ? 'text-amber-300' : 'text-teal-600 dark:text-teal-400'}`}>
                                      ({item.assignment.idaShift[0]})
                                    </span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveDutyCode(dt.code);
                                    const shiftForRemove = (dt.code === 'IDAC' || dt.code === 'IDA')
                                      ? resolveCanonicalIdacShift(item.assignment)
                                      : undefined;
                                    handleToggleAssignAirman(item.airman, 'unassign', dt.code, shiftForRemove);
                                  }}
                                  className={`ml-1 p-0.5 rounded transition-colors shrink-0 cursor-pointer ${
                                    isSelected
                                      ? 'text-teal-200 hover:text-white hover:bg-rose-500/80'
                                      : 'text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50'
                                  }`}
                                  title={`Deselect ${formatAirmanName(item.airman.rank)} ${item.airman.name}`}
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* IDAC Dynamic Shift Picker (Shows detailed airmen for each shift — 155 UASU only) */}
          {is155Uasu && (onlyIdac || ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) && (
            <div className="p-3 bg-teal-50/80 dark:bg-teal-950/40 rounded-xl border border-teal-200 dark:border-teal-800 space-y-2 animate-fadeIn">
              <div className="flex items-center justify-between">
                <label className="text-xs font-black text-teal-950 dark:text-teal-100 flex items-center space-x-1.5">
                  <Clock className="w-4 h-4 text-teal-600" />
                  <span>{onlyIdac ? '1. Select IDAC Shift Slot:' : 'Select IDAC Shift (Auto-filtered by Duty Ratio):'}</span>
                  {onlyIdac && (
                    <button
                      type="button"
                      onClick={() => {
                        const nextDutyLocked = !isDutyLocked;
                        setIsDutyLocked(nextDutyLocked);
                        if (nextDutyLocked) {
                          if (typeof window !== 'undefined') {
                            window.sessionStorage.setItem('baf_duty_duty_locked', 'true');
                          }
                          setActiveDutyCode('IDAC');
                        } else {
                          if (typeof window !== 'undefined') {
                            window.sessionStorage.setItem('baf_duty_duty_locked', 'false');
                          }
                        }
                      }}
                      title={isDutyLocked ? 'IDAC Duty is locked. Click to unlock.' : 'Click to lock IDAC duty'}
                      className={`ml-1.5 p-1 text-xs font-bold rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                        isDutyLocked
                          ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-400/40'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600'
                      }`}
                    >
                      {isDutyLocked ? <Lock className="w-3 h-3 stroke-[2.5]" /> : <Unlock className="w-3 h-3" />}
                    </button>
                  )}
                </label>
                <span className="text-xs text-teal-700 dark:text-teal-300 font-bold">
                  {activeFlight !== 'All' ? `${activeFlight} Flight` : 'All Flights'}
                </span>
              </div>
              {availableIdaShifts.length === 0 ? (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-900 text-center">
                  <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    No IDAC shift duty allocated for {activeFlight} Flight on this date.
                  </p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                    According to the Official Duty Ratio Matrix, quota is 0 for {activeFlight} Flight on {fromDate}.
                  </p>
                </div>
              ) : (
                <div className={`grid gap-2.5 ${availableIdaShifts.length === 1 ? 'grid-cols-1' : availableIdaShifts.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
                  {availableIdaShifts.map((s) => {
                    const shiftCardScope: FlightName | 'All' =
                      isFlightLocked && activeFlight !== 'All' ? (activeFlight as FlightName) : 'All';
                    const shiftQuota = getRequiredCountForDuty('IDAC', s, shiftCardScope);
                    const shiftAssigned = getAssignedAirmenForDuty('IDAC', s, shiftCardScope);
                    const allFlights: import('../types').FlightName[] =
                      isFlightLocked && activeFlight !== 'All'
                        ? [activeFlight as FlightName]
                        : getOrderedFlights();
                    const rawUnfulfilledFlights: import('../types').FlightName[] = [];
                    allFlights.forEach(flt => {
                      const fltQuota = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', s);
                      if (fltQuota > 0) {
                        const fltAssigned = countAssignedForDutyFlightShift(assignmentsList, 'IDAC', flt, s);
                        const remaining = fltQuota - fltAssigned;
                        for (let i = 0; i < remaining; i++) {
                           rawUnfulfilledFlights.push(flt);
                        }
                      }
                    });
                    const remainingOpenSlots = Math.max(0, shiftQuota - shiftAssigned.length);
                    const unfulfilledFlights = rawUnfulfilledFlights.slice(0, remainingOpenSlots);
                    const isShiftSelected = activeIdaShift === s;
                    const isShiftOver =
                      (shiftQuota > 0 && shiftAssigned.length > shiftQuota) ||
                      (shiftQuota === 0 && shiftAssigned.length > 0);
                    const isShiftUnder = !isShiftOver && shiftQuota > 0 && shiftAssigned.length < shiftQuota;
                    const shiftBorderAlertClass = isShiftOver
                      ? 'duty-box-over-quota'
                      : isShiftUnder
                      ? 'duty-box-under-quota'
                      : '';

                    return (
                      <div
                        key={s}
                        onClick={() => {
                          userManuallySelectedShiftRef.current = true;
                          userManuallySelectedFlightRef.current = false;
                          setActiveIdaShift(s);
                          if (!isFlightLocked) {
                            const flts = getOrderedFlights();
                            const unfulfilledFlt = flts.find((f) => {
                              const q = getFlightDutyQuotaForDate(fromDate, f, 'IDAC', s);
                              return q > 0 && countAssignedForDutyFlightShift(assignmentsList, 'IDAC', f, s) < q;
                            });
                            const firstQuotaFlt = flts.find((f) => getFlightDutyQuotaForDate(fromDate, f, 'IDAC', s) > 0);
                            const chosen = unfulfilledFlt || firstQuotaFlt;
                            if (chosen) {
                              setActiveFlight(chosen);
                            }
                          }
                        }}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-start ${
                          isShiftSelected
                            ? 'bg-teal-600 text-white border-white shadow-md duty-box-selected'
                            : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-teal-200 dark:border-teal-900/80 hover:border-teal-400'
                        } ${shiftBorderAlertClass}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-black text-xs flex items-center gap-1.5">
                            {isShiftSelected && (
                              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white text-teal-700 shrink-0 shadow-2xs">
                                <Check className="w-3 h-3 stroke-[3.5]" />
                              </span>
                            )}
                            {isDutyLocked && isShiftSelected && (
                              <Lock className="w-3 h-3 text-amber-300 stroke-[2.5] shrink-0" />
                            )}
                            <span>{s} Shift</span>
                          </span>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                              isShiftOver
                                ? 'bg-rose-600 text-white shadow-xs ring-1 ring-white/40'
                                : isShiftUnder
                                ? 'bg-amber-400 text-slate-950 shadow-xs ring-1 ring-white/40'
                                : isShiftSelected
                                ? 'bg-white text-teal-900'
                                : 'bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200'
                            }`}
                          >
                            {shiftAssigned.length}{shiftQuota > 0 ? `/${shiftQuota}` : ''}
                          </span>
                        </div>

                        <div className="space-y-1">
                          {shiftAssigned.length === 0 && unfulfilledFlights.length === 0 ? (
                            <span className={`text-[10.5px] italic ${isShiftSelected ? 'text-teal-100' : 'text-slate-400'}`}>
                              — None Assigned
                            </span>
                          ) : (
                            <>
                              {shiftAssigned.map((item, idx) => (
                                <div
                                  key={`${item.airman.id}-${s}-${idx}`}
                                  className={`text-[11px] px-2 py-1 rounded-lg font-bold truncate flex items-center justify-between group ${
                                    isShiftSelected ? 'bg-teal-700/90 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                  }`}
                                  title={`${formatAirmanName(item.airman.rank)} ${item.airman.name} (${item.airman.flightName})`}
                                >
                                  <div className="truncate flex items-center">
                                    <span className="opacity-70 mr-1.5">{idx + 1}.</span>
                                    <span className="truncate">{formatAirmanName(item.airman.rank)} {item.airman.name}</span>
                                    <span className="ml-1 opacity-75 font-normal text-[10px]">
                                      ({item.airman.flightName})
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      userManuallySelectedShiftRef.current = true;
                                      setActiveDutyCode('IDAC');
                                      setActiveIdaShift(s);
                                      handleToggleAssignAirman(item.airman, 'unassign', 'IDAC', s);
                                    }}
                                    className="text-teal-200 hover:text-white dark:hover:text-rose-300 ml-1 p-0.5 rounded hover:bg-teal-800/60 transition-colors shrink-0 cursor-pointer"
                                    title={`Deselect ${formatAirmanName(item.airman.rank)} ${item.airman.name}`}
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                              {unfulfilledFlights.map((flt, fltIdx) => (
                                <div
                                  key={`unfulfilled-${s}-${fltIdx}`}
                                  className={`text-[11px] px-2 py-1 rounded-lg font-bold truncate border border-dashed ${
                                    isShiftSelected ? 'bg-teal-800/40 text-teal-200 border-teal-500/50' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 border-slate-300 dark:border-slate-700'
                                  }`}
                                >
                                  <span className="opacity-70 mr-1.5">{shiftAssigned.length + fltIdx + 1}.</span>
                                  Not Assigned
                                  <span className="ml-1 opacity-75 font-normal text-[10px]">
                                    ({flt})
                                  </span>
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 3. Flight Filter & Candidate Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-200 dark:border-slate-800">
            {/* Flight / Trade Tabs */}
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
                2. {officeHasFlights ? 'Flight:' : 'Trade:'}
              </span>

              {/* Flight/Trade Lock Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  const nextLocked = !isFlightLocked;
                  setIsFlightLocked(nextLocked);
                  if (nextLocked) {
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.setItem('baf_duty_flight_locked', 'true');
                    }
                    if (activeFlight === 'All') {
                      setActiveFlight(unitGroupOptions[0] || ('Avionics' as FlightName));
                    }
                  } else {
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.setItem('baf_duty_flight_locked', 'false');
                    }
                  }
                }}
                title={
                  isFlightLocked 
                    ? `${officeHasFlights ? 'Flight' : 'Trade'} is locked to ${activeFlight}. Click to unlock.` 
                    : `Click to lock this ${officeHasFlights ? 'flight' : 'trade'}: Only shows duties for this ${officeHasFlights ? 'flight' : 'trade'}, auto-advances duty on assign, and auto-advances date when complete.`
                }
                className={`p-1.5 text-xs font-bold rounded-lg border flex items-center justify-center transition-all cursor-pointer ${
                  isFlightLocked
                    ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-400/40'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600'
                }`}
                aria-label={isFlightLocked ? 'Flight Locked' : 'Flight Unlocked'}
              >
                {isFlightLocked ? <Lock className="w-3.5 h-3.5 stroke-[2.5]" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>

              {(['All', ...unitGroupOptions] as Array<FlightName | 'All'>).filter(flt => {
                if (officeHasFlights && isAdmin && adminFlight) {
                  return flt === adminFlight;
                }
                return true;
              }).map((flt) => {
                const isDisabledFlt = flt !== 'All' && ((officeHasFlights && isAdmin && adminFlight && flt !== adminFlight) || (isPastDate && !isSuperAdmin));
                const isSelected = activeFlight === flt;
                const shiftFilter = activeDutyCode && isIdacDutyCode(activeDutyCode) ? activeIdaShift : undefined;
                const fltRatioQuota =
                  activeDutyCode
                    ? flt === 'All'
                      ? getRequiredCountForDuty(activeDutyCode, shiftFilter, 'All')
                      : getFlightDutyQuotaForDate(fromDate, flt, activeDutyCode, shiftFilter)
                    : 0;
                const fltAssignedCount =
                  activeDutyCode
                    ? flt === 'All'
                      ? getAssignedAirmenForDuty(activeDutyCode, shiftFilter, 'All').length
                      : countAssignedForDutyFlightShift(assignmentsList, activeDutyCode, flt, shiftFilter)
                    : 0;
                const showQuotaBadge = Boolean(activeDutyCode) && (fltRatioQuota > 0 || fltAssignedCount > 0);
                const isOverFltQuota = fltAssignedCount > fltRatioQuota;
                const isMatchedFltQuota = fltRatioQuota > 0 && fltAssignedCount === fltRatioQuota;
                const isRatioFlight = flt !== 'All' && fltRatioQuota > 0;
                return (
                <button
                  key={flt}
                  type="button"
                  onClick={() => {
                    if (!isDisabledFlt) {
                      if (activeFlight === flt) return; // Do not deselect on click
                      
                      const newFlt = flt;
                      userManuallySelectedFlightRef.current = true;
                      setActiveFlight(newFlt);
                      
                      // Only pick a default duty if NO duty is currently selected;
                      // otherwise keep the active duty/shift intact so user can manually assign outside the ratio!
                      if (newFlt !== 'All' && !activeDutyCode) {
                        setSelectionMode('FlightFirst');
                        const allDuties = getActiveCountedDuties();
                        const ratioFiltered = allDuties.filter((dt) => getRequiredCountForDuty(dt.code, undefined, newFlt as FlightName) > 0);
                        if (!isDutyLocked && ratioFiltered.length > 0) {
                          setActiveDutyCode(ratioFiltered[0].code);
                        }
                      } else if (newFlt === 'All' && !activeDutyCode) {
                        setSelectionMode('None');
                      }
                    }
                  }}
                  disabled={isDisabledFlt}
                  title={
                    showQuotaBadge
                      ? `${flt === 'All' ? 'Total' : flt}: ${fltAssignedCount}/${fltRatioQuota} assigned`
                      : flt === 'All'
                      ? 'Show airmen from all flights'
                      : `${flt} (manual override outside ratio)`
                  }
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all flex items-center gap-1.5 ${
                    isDisabledFlt ? 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-600 dark:border-slate-700' :
                    isSelected
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100 shadow-xs cursor-pointer'
                      : isRatioFlight
                      ? 'bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700/80 hover:border-emerald-400 cursor-pointer'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400 cursor-pointer'
                  }`}
                >
                  {isFlightLocked && isSelected && flt !== 'All' && (
                    <Lock className="w-3 h-3 text-amber-400 stroke-[2.5]" />
                  )}
                  <span>{flt}</span>
                  {showQuotaBadge && (
                    <span
                      className={`text-[10px] font-black px-1.5 py-0.2 rounded-full leading-tight shrink-0 ${
                        isOverFltQuota
                          ? 'bg-rose-600 text-white shadow-2xs'
                          : isMatchedFltQuota
                          ? 'bg-emerald-600 text-white shadow-2xs'
                          : isSelected
                          ? 'bg-amber-400 text-slate-950 shadow-2xs'
                          : 'bg-amber-100 dark:bg-amber-900/70 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700'
                      }`}
                    >
                      {fltAssignedCount}/{fltRatioQuota}
                    </span>
                  )}
                </button>
                );
              })}
            </div>

            {/* Currently Assigned Status Pill */}
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                Assigned: <strong className="text-emerald-600">{currentlyAssignedCount}</strong>
                {currentRequiredQuota > 0 && (
                  <span> / {currentRequiredQuota} Quota</span>
                )}
              </span>
            </div>
          </div>

          {/* 4. Personnel Candidate List */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {isAirmenLocked ? '3. Airmen List (Multi-Select Locked)' : '3. Airmen List (Click to Assign / Unassign)'}
                </span>

                {/* Airmen Selection Lock Toggle Button */}
                <button
                  type="button"
                  onClick={() => {
                    const nextLocked = !isAirmenLocked;
                    setIsAirmenLocked(nextLocked);
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.setItem('baf_duty_airmen_locked', nextLocked ? 'true' : 'false');
                    }
                    if (!nextLocked) {
                      setLockedAirmenIds([]);
                      persistLockedAirmen([]);
                    }
                  }}
                  title={
                    isAirmenLocked
                      ? `Airmen selection locked (${lockedAirmenIds.length} selected). Click to unlock & clear.`
                      : 'Lock Airmen Selection: Multi-select airmen, lock a duty, then click Date above to pick multiple calendar dates and Apply.'
                  }
                  className={`p-1.5 text-xs font-bold rounded-lg border flex items-center gap-1 justify-center transition-all cursor-pointer ${
                    isAirmenLocked
                      ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-sm ring-2 ring-amber-400/40'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:text-amber-600'
                  }`}
                  aria-label={isAirmenLocked ? 'Airmen Selection Locked' : 'Airmen Selection Unlocked'}
                >
                  {isAirmenLocked ? <Lock className="w-3.5 h-3.5 stroke-[2.5]" /> : <Unlock className="w-3.5 h-3.5" />}
                  {isAirmenLocked && (
                    <span className="text-[10px] font-black pr-0.5">
                      Locked ({lockedAirmenIds.length})
                    </span>
                  )}
                </button>

                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                  {candidatePersonnel.length} Airmen
                </span>
              </div>

              {isAirmenLocked && lockedAirmenIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setLockedAirmenIds([]);
                    persistLockedAirmen([]);
                  }}
                  className="text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  Clear Locked ({lockedAirmenIds.length})
                </button>
              )}
            </div>

            {/* Locked Airmen Multi-Select Summary Tray */}
            {isAirmenLocked && (
              <div className="p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/35 border border-amber-300 dark:border-amber-800/80 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="text-[11px] font-black text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>
                      {lockedAirmenIds.length === 0
                        ? 'Select multiple airmen below to lock them'
                        : !activeDutyCode
                        ? `${lockedAirmenIds.length} airman/airmen locked — now select & lock a duty above`
                        : `${lockedAirmenIds.length} airman/airmen locked — click Date box above to open Calendar & Apply`}
                    </span>
                  </span>
                </div>
                {lockedAirmenIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {lockedAirmenIds.map((id) => {
                      const found = airmanMap.get(id) || airmen.find((a) => isSameAirman(a.id, id));
                      if (!found) return null;
                      return (
                        <span
                          key={found.id}
                          onClick={() => handleToggleLockedAirman(found)}
                          title="Click to remove from locked selection"
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500 hover:bg-rose-600 text-white text-[10.5px] font-bold cursor-pointer transition-colors shadow-2xs"
                        >
                          <span>{formatAirmanName(found.rank)} {found.name}</span>
                          <X className="w-3 h-3" />
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Candidate Search input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery || ''}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, rank, BD no, trade..."
                className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  title="Clear search"
                  className="absolute right-2.5 top-2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Candidate Grid: Clean display showing strictly Rank & Name + Duty Badge */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto p-1 border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-50/50 dark:bg-slate-900/50">
              
              {isReadOnly && (
                <div className="col-span-full py-2 px-3 text-center text-xs font-bold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 rounded-xl border border-amber-300 dark:border-amber-800 flex items-center justify-center space-x-2">
                  <span>🔒</span>
                  <span>{isUser ? 'Read-Only Mode: Regular users cannot assign or change duties.' : 'Past Date (Read-Only): Admins cannot assign or change duties for past dates.'}</span>
                </div>
              )}
              {candidatePersonnel.length === 0 ? (
                <div className="col-span-full py-8 text-center text-xs text-slate-400">
                  No matching candidates found for this duty & flight.
                </div>
              ) : (
                candidatePersonnel.map((airman) => {
                  const isCurrentDutyAssigned = isAirmanAssignedToActiveDuty(airman.id);
                  const isMultiLockedSelected = isAirmenLocked && isAirmanLockedInSelection(airman.id);
                  const statusInfo = getDutyStatusInfo(airman.id);

                  // Disabled rules:
                  // User rule: "Sudhu Matro On Parade & Duty Off enable thakbe" + if assigning same active duty, allow unassigning
                  // Exception: For IDAC Night duty, someone who has IDAC Morning / Afternoon is eligible because Morning is regular office hours!
                  // Exception: For IDAC Morning/Afternoon duty, someone who has IDAC Night is eligible!
                  // For all other duties (e.g. Base Security GD, Airport, BTF, NTF, Halishahar, Leave, TDY):
                  // If an airman already has another duty (e.g. Airport) when assigning GD, they must NOT be selectable unless they are On Parade or Duty Off.
                  let isEligible = false;
                  if (isAirmenLocked) {
                    // In Airmen Selection Lock mode, any non-read-only airman can be multi-selected for calendar dates
                    isEligible = true;
                  } else if (isCurrentDutyAssigned) {
                    // Always allow clicking to unassign
                    isEligible = true;
                  } else if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
                    // User requirement: For IDAC Duty, all personnel in the flight are visible and eligible, even if on other disposal
                    isEligible = true;
                  } else if (
                    statusInfo.type === 'ON_PARADE' ||
                    statusInfo.type === 'NIGHT_OFF' ||
                    statusInfo.type === 'DUTY_OFF' ||
                    statusInfo.type === 'GD Off' ||
                    statusInfo.type === 'SY Off' ||
                    statusInfo.type === 'CANTEEN' ||
                    statusInfo.type === 'BAKE_N_BITE' ||
                    statusInfo.type === 'DEPLOYMENT' ||
                    statusInfo.type === 'ATT'
                  ) {
                    // On Parade, Duty Off, or any Deployment (Canteen, Bake & Bite, Custom Deployment) are always eligible for Duty
                    isEligible = true;
                  }

                  const isDisabled = isReadOnly || !isEligible;
                  const isProcessing = processingAirmanId === airman.id || isApplyingMultiDates || isApplyingPending;

                  return (
                    <button
                      key={airman.id}
                      type="button"
                      disabled={isDisabled || isProcessing}
                      onClick={() => {
                        if (isAirmenLocked) {
                          handleToggleLockedAirman(airman);
                          return;
                        }
                        if (isCurrentDutyAssigned) {
                          handleToggleAssignAirman(airman, 'unassign', activeDutyCode, activeIdaShift);
                        } else {
                          handleToggleAssignAirman(airman, 'assign', activeDutyCode, activeIdaShift);
                        }
                      }}
                      title={
                        isReadOnly
                          ? (isUser ? 'Read-only: Regular users cannot modify duties.' : 'Past dates cannot be modified by Admins.')
                          : isAirmenLocked
                          ? `Click to ${isMultiLockedSelected ? 'remove from' : 'add to'} locked airmen multi-selection`
                          : isDisabled
                          ? `${formatAirmanName(airman.rank)} ${airman.name} is on ${statusInfo.label} and is not eligible for ${DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode}.`
                          : undefined
                      }
                      className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                        isDisabled
                          ? 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700'
                          : isMultiLockedSelected
                          ? 'bg-amber-500 text-white border-amber-600 shadow-xs ring-2 ring-amber-400/50 cursor-pointer'
                          : !isAirmenLocked && isCurrentDutyAssigned
                          ? 'bg-emerald-600 text-white border-emerald-700 shadow-xs ring-2 ring-emerald-400/40 cursor-pointer'
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-emerald-400 cursor-pointer'
                      }`}
                    >
                      {/* Left: Pure Rank & Name */}
                      <div className="flex items-center space-x-2 truncate mr-2">
                        {isProcessing ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-500 shrink-0" />
                        ) : isMultiLockedSelected ? (
                          <div className="w-4 h-4 rounded-md bg-white text-amber-600 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : !isAirmenLocked && isCurrentDutyAssigned ? (
                          <div className="w-4 h-4 rounded-md bg-white text-emerald-700 flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3 stroke-[3]" />
                          </div>
                        ) : isDisabled ? (
                          <div className="w-4 h-4 rounded-md bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                            <div className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                          </div>
                        ) : (
                          <div className={`w-4 h-4 rounded-md border shrink-0 ${isAirmenLocked ? 'border-amber-400 dark:border-amber-600' : 'border-slate-300 dark:border-slate-600'}`} />
                        )}

                        <span
                          className={`font-bold text-xs truncate ${
                            isMultiLockedSelected || (!isAirmenLocked && isCurrentDutyAssigned)
                              ? 'text-white font-black'
                              : isDisabled
                              ? 'text-slate-600 dark:text-slate-400'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {formatAirmanName(airman.rank)} {airman.name}
                        </span>
                      </div>

                      {/* Right: Duty Status Name */}
                      <div className="shrink-0">
                        {isMultiLockedSelected ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-white/25 text-white inline-flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" />
                            Locked
                          </span>
                        ) : !isAirmenLocked && isCurrentDutyAssigned ? (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-md bg-white/20 text-white">
                            ✓ Assigned
                          </span>
                        ) : statusInfo.type === 'LEAVE' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                            - {statusInfo.label}
                          </span>
                        ) : statusInfo.type === 'TDY' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                            - TDY
                          </span>
                        ) : statusInfo.type === 'BTF' || statusInfo.type === 'NTF' || statusInfo.type === 'HALISHAHAR' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            - {statusInfo.label}
                          </span>
                        ) : statusInfo.type === 'IDAC' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-teal-100 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                            - {statusInfo.label}
                          </span>
                        ) : statusInfo.type === 'AIRPORT' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-sky-100 dark:bg-sky-950/60 text-sky-800 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
                            - Airport
                          </span>
                        ) : statusInfo.type === 'NIGHT_OFF' ? (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            - {statusInfo.label}
                          </span>
                        ) : statusInfo.type !== 'ON_PARADE' ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            - {statusInfo.label}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

          </div>


        </div>
        </div>

        {/* Modal Footer */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {activeModalTab === 'Duty' && hasUnsavedChanges ? (
              <span className="inline-flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {pendingOps.length} unsaved change{pendingOps.length > 1 ? 's' : ''}
                  {pendingAffectedDates.length > 1 ? ` across ${pendingAffectedDates.length} dates` : ''} • Click Apply to save.
                </span>
              </span>
            ) : (
              <span>
                Date: <strong>{fromDate}</strong>
                {selectedPresetDays !== 1 && fromDate !== toDate ? ` to ${toDate}` : ''} • Click Apply after changes to save.
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            {activeModalTab === 'Duty' && !isReadOnly && (
              <>
                {hasUnsavedChanges && (
                  <button
                    type="button"
                    disabled={isApplyingPending}
                    onClick={() => requestLeaveModal({ type: 'discardOnly' })}
                    className="px-3.5 py-2 text-xs font-bold rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Discard</span>
                  </button>
                )}
                <button
                  type="button"
                  disabled={!hasUnsavedChanges || isApplyingPending}
                  onClick={() => handleApplyPendingChanges()}
                  className={`px-4 py-2 text-xs font-black rounded-xl shadow-xs transition-all inline-flex items-center gap-1.5 ${
                    hasUnsavedChanges
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white ring-2 ring-emerald-500/30 cursor-pointer'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {isApplyingPending ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isApplyingPending
                      ? 'Applying...'
                      : hasUnsavedChanges
                      ? `Apply (${pendingOps.length})`
                      : 'Apply'}
                  </span>
                </button>
              </>
            )}

            <button
              type="button"
              disabled={isApplyingPending}
              onClick={() => requestLeaveModal({ type: 'close' })}
              className="px-4 py-2 text-xs font-black bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              Close
            </button>
          </div>
        </div>

      </div>

      {/* 2-Step Unsaved Changes & Confirm Discard Guard Popup */}
      {unsavedPrompt.open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-fadeIn"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl max-w-md w-full p-5 space-y-4">
            {!unsavedPrompt.confirmDiscardStep ? (
              <>
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-amber-100 dark:bg-amber-950/70 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-black text-slate-900 dark:text-slate-100">
                      Unsaved Duty Changes
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      You have <strong className="text-amber-600 dark:text-amber-400">{pendingOps.length} unsaved duty change{pendingOps.length > 1 ? 's' : ''}</strong>
                      {pendingAffectedDates.length > 1
                        ? ` across ${pendingAffectedDates.length} dates`
                        : pendingAffectedDates.length === 1
                        ? ` for ${pendingAffectedDates[0]}`
                        : ''}.
                      Changes will not take effect until you apply and save them.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    disabled={isApplyingPending}
                    onClick={() =>
                      setUnsavedPrompt((prev) => ({ ...prev, confirmDiscardStep: true }))
                    }
                    className="px-3.5 py-2 text-xs font-bold rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/60 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Don&apos;t Save / Discard
                  </button>
                  <button
                    type="button"
                    disabled={isApplyingPending}
                    onClick={() =>
                      setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null })
                    }
                    className="px-3.5 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Keep Editing
                  </button>
                  <button
                    type="button"
                    disabled={isApplyingPending}
                    onClick={() => handleApplyPendingChanges(unsavedPrompt.pendingAction)}
                    className="px-4 py-2 text-xs font-black rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60"
                  >
                    {isApplyingPending ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>{isApplyingPending ? 'Saving...' : 'Apply & Save'}</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-rose-100 dark:bg-rose-950/70 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 shrink-0">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-base font-black text-rose-700 dark:text-rose-400">
                      Confirm Discard Changes?
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      Are you sure you want to permanently discard all <strong className="text-rose-600 dark:text-rose-400">{pendingOps.length} unsaved duty change{pendingOps.length > 1 ? 's' : ''}</strong>? None of these duty changes will be saved or applied.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      if (unsavedPrompt.pendingAction?.type === 'discardOnly') {
                        setUnsavedPrompt({ open: false, confirmDiscardStep: false, pendingAction: null });
                      } else {
                        setUnsavedPrompt((prev) => ({ ...prev, confirmDiscardStep: false }));
                      }
                    }}
                    className="px-4 py-2 text-xs font-bold rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                  >
                    Go Back
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDiscardPending}
                    className="px-4 py-2 text-xs font-black rounded-xl bg-rose-600 hover:bg-rose-700 text-white shadow-sm transition-colors cursor-pointer"
                  >
                    Yes, Discard All
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Flight Duty Ratio Modal */}
      {showRatioModal && (
        <FlightDutyRatioModal
          airmen={airmen}
          isOpen={showRatioModal}
          onClose={() => setShowRatioModal(false)}
          selectedDate={fromDate}
          onRatioUpdated={() => {
            fetchCurrentRoster();
          }}
        />
      )}
    </div>
  );
};

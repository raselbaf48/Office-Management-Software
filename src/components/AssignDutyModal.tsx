import { DateNavigator } from './DateNavigator';
import { formatRank, formatAirmanName } from '../utils/rankFormatter';
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
  Lock,
  Unlock
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

export const isSameAirman = (id1?: string, id2?: string): boolean => {
  return matchAirmanId(id1, id2);
};


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

  const [selectedPresetDays, setSelectedPresetDays] = useState<number | null>(1);
  const [fromDate, setFromDate] = useState<string>(() => {
    const init = selectedDate || todayStr;
    if (isAdmin && init < todayStr) return todayStr;
    return init;
  });

  const isPastDate = fromDate < todayStr;
  const isReadOnly = isUser || (isPastDate && !isSuperAdmin);
  const [toDate, setToDate] = useState<string>(() => {
    const init = selectedDate || todayStr;
    if (isAdmin && init < todayStr) return todayStr;
    return init;
  });

  // Active duty & flight filters
  const [activeDutyCode, setActiveDutyCode] = useState<DutyCategoryCode | ''>(
    onlyIdac ? 'IDAC' : (initialDutyCode || '')
  );
  const [selectionMode, setSelectionMode] = useState<'DutyFirst' | 'FlightFirst' | 'None'>(
    initialDutyCode ? 'DutyFirst' : (initialFlight !== 'All' ? 'FlightFirst' : 'None')
  );
  const [activeFlight, setActiveFlight] = useState<FlightName | 'All'>(() => {
    if (isAdmin && adminFlight) return adminFlight as FlightName;
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
  const [activeIdaShift, setActiveIdaShift] = useState<IDAShift | undefined>(undefined);
  const [activeLeaveType, setActiveLeaveType] = useState<'Casual' | 'Annual' | 'Recreation'>('Casual');
  const [isProxyEnabled, setIsProxyEnabled] = useState<boolean>(false);
  const [proxyForFlight, setProxyForFlight] = useState<FlightName | ''>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterByRatio, setFilterByRatio] = useState<boolean>(true);
    const [activeModalTab, setActiveModalTab] = useState<'Duty' | 'Leave' | 'TDY' | 'Deployment'>('Duty');
  const [showRatioModal, setShowRatioModal] = useState<boolean>(false);

  // Live assignments map for fromDate (airmanId -> DutyAssignment[])
  const [assignmentsList, setAssignmentsList] = useState<DutyAssignment[]>([]);
  // Previous day assignments to detect Night Off (IDAC Night or GD Night)
  const [prevDayAssignmentsList, setPrevDayAssignmentsList] = useState<DutyAssignment[]>([]);
  const [loadingInitial, setLoadingInitial] = useState<boolean>(false);
  const [processingAirmanId, setProcessingAirmanId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string>('');
  
  const userManuallySelectedFlightRef = useRef<boolean>(false);

  // Update dates & duty code when isOpen changes
  useEffect(() => {
    if (isOpen) {
      if (selectedDate) {
        const dateToSet = (isAdmin && selectedDate < todayStr) ? todayStr : selectedDate;
        setFromDate(dateToSet);
        setToDate(dateToSet);
      }
      if (isAdmin && adminFlight) {
        setActiveFlight(adminFlight as FlightName);
      }
      if (onlyIdac) {
        setActiveDutyCode('IDAC');
      } else if (initialDutyCode) {
        setActiveDutyCode(initialDutyCode);
      }
    }
  }, [isOpen, selectedDate, onlyIdac, initialDutyCode, isAdmin, adminFlight, todayStr]);

  // Dynamically compute available IDAC shifts based on ratio matrix for fromDate
  const availableIdaShifts = useMemo(() => {
    if (isFlightLocked && activeFlight !== 'All') {
      return getIdacShiftsForDateAndFlight(fromDate, activeFlight as FlightName);
    }
    return getIdacShiftsForDateAndFlight(fromDate, undefined);
  }, [fromDate, isFlightLocked, activeFlight]);

  // Auto-select removed as requested by user.

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

  // Fetch current server roster data for fromDate and previous day (for Night-Off tracking)
  const fetchCurrentRoster = async () => {
    if (!isOpen || !fromDate) return;
    setLoadingInitial(true);
    try {
      const monthKey = fromDate.slice(0, 7);
      
      // Calculate previous day date string
      const currentDateObj = new Date(fromDate);
      const prevDateObj = new Date(currentDateObj);
      prevDateObj.setDate(currentDateObj.getDate() - 1);
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

      const dayAssignments = allAssignments.filter((a) => a.date === fromDate && (!a.disposalScope || a.disposalScope === 'ALL'));
      setAssignmentsList(dayAssignments);

      const prevDayAssignments = prevMonthAssignments.filter((a) => a.date === prevDateStr && (!a.disposalScope || a.disposalScope === 'ALL'));
      setPrevDayAssignmentsList(prevDayAssignments);

    } catch (err) {
      console.error('Failed to load roster for date:', fromDate, err);
    } finally {
      setLoadingInitial(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchCurrentRoster();
    }
  }, [isOpen, fromDate]);

  useEffect(() => {
    if (isFlightLocked || isDutyLocked) return;
    if (activeFlight !== 'All') {
      const dutyConfig = DUTY_TYPE_MAP.get(activeDutyCode as any);
      if (dutyConfig) {
        const matrixConfig = getStoredDutyMatrix().find(t => t.dutyCode === activeDutyCode);
        const eligibleFlights = matrixConfig?.eligibleFlights || dutyConfig.eligibleFlights;
        if (eligibleFlights && eligibleFlights.length > 0 && !eligibleFlights.includes(activeFlight)) {
           setActiveFlight('All');
           userManuallySelectedFlightRef.current = false;
        }
      }
    }
  }, [activeDutyCode, activeFlight, isFlightLocked, isDutyLocked]);

  // Reset or auto-select shift when duty config changes
  useEffect(() => {
    if (activeDutyCode !== 'IDAC' && activeDutyCode !== 'IDA') {
        setActiveIdaShift(undefined);
    } else {
        const shifts = availableIdaShifts;
        setActiveIdaShift(prev => {
          if (prev && shifts.includes(prev)) {
            return prev;
          }
          return shifts.length > 0 ? shifts[0] : undefined;
        });
    }
  }, [activeDutyCode, fromDate, activeFlight, availableIdaShifts]);

  // Auto-select flight for matrix-tracked duties based on quota and unfulfilled assignments
  useEffect(() => {
    if (isFlightLocked || isDutyLocked) return;
    if (userManuallySelectedFlightRef.current) return;
    const isMatrixTracked = getStoredDutyMatrix().some(t => t.dutyCode === activeDutyCode);
    if (isMatrixTracked) {
      const orderedFlights: FlightName[] = ["Avionics", "Mechanics", "GCS", "Admin"];
      let targetFlight: FlightName | "All" = "All";
      
      // Do not auto-select flight for IDAC until a shift is explicitly chosen
      if ((['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) && !activeIdaShift) {
         setActiveFlight("All");
         return;
      }

      for (const flt of orderedFlights) {
        const required = getFlightDutyQuotaForDate(
          fromDate, 
          flt, 
          activeDutyCode,
          (activeDutyCode === "IDAC" || activeDutyCode === "IDA") ? activeIdaShift : undefined
        );
        
        if (required > 0) {
          const assignedCount = assignmentsList.filter((a) => {
            const airman = airmanMap.get(a.airmanId);
            return airman && 
                   airman.flightName === flt && 
                   a.dutyCode === activeDutyCode &&
                   (a.dutyCode !== "IDAC" && a.dutyCode !== "IDA" || a.idaShift === activeIdaShift);
          }).length;
            
          if (assignedCount < required) {
            targetFlight = flt;
            break;
          }
        }
      }
        
      // If all quotas are fulfilled, targetFlight remains "All" 
      
      setActiveFlight(targetFlight);
    }
  }, [activeDutyCode, fromDate, activeIdaShift, assignmentsList, airmanMap, isFlightLocked]);

  // Auto-select duty for locked flight on date/flight/roster change (only when duty is NOT locked)
  useEffect(() => {
    if (isFlightLocked && activeFlight !== 'All' && !isDutyLocked) {
      const targetFlight = activeFlight as FlightName;
      const _storedMatrix = getStoredDutyMatrix();
      const allDuties = DUTY_TYPES.filter((dt) => {
        if (!dt.isCountedAsDuty) return false;
        const mEntries = _storedMatrix.filter(t => t.dutyCode === dt.code);
        if (mEntries.length > 0 && mEntries.every(t => t.isDisabled)) return false;
        return true;
      });

      const slots: Array<{ dutyCode: DutyCategoryCode; shift?: IDAShift; required: number; assigned: number }> = [];
      allDuties.forEach((dt) => {
        if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dt.code)) {
          const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
          shifts.forEach((sh) => {
            const req = getFlightDutyQuotaForDate(fromDate, targetFlight, 'IDAC', sh);
            if (req > 0) {
              const assigned = assignmentsList.filter((a) => {
                const air = airmanMap.get(a.airmanId);
                return air && air.flightName === targetFlight &&
                  (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') &&
                  a.idaShift === sh;
              }).length;
              slots.push({ dutyCode: 'IDAC', shift: sh, required: req, assigned });
            }
          });
        } else {
          const req = getFlightDutyQuotaForDate(fromDate, targetFlight, dt.code);
          if (req > 0) {
            const assigned = assignmentsList.filter((a) => {
              const air = airmanMap.get(a.airmanId);
              if (!air || air.flightName !== targetFlight) return false;
              if (dt.code === 'AIRPORT') return a.dutyCode === 'AIRPORT' || (a.dutyCode as string) === 'AIRFIELD_DUTY';
              return a.dutyCode === dt.code;
            }).length;
            slots.push({ dutyCode: dt.code, required: req, assigned });
          }
        }
      });

      if (slots.length > 0) {
        const currentSlot = slots.find(s => s.dutyCode === activeDutyCode && (!s.shift || s.shift === activeIdaShift));
        if (!currentSlot || currentSlot.assigned >= currentSlot.required) {
          const firstUnfulfilled = slots.find(s => s.assigned < s.required) || slots[0];
          setActiveDutyCode(firstUnfulfilled.dutyCode);
          setActiveIdaShift(firstUnfulfilled.shift);
        }
      }
    }
  }, [isFlightLocked, isDutyLocked, activeFlight, fromDate, assignmentsList]);

  // Helper to check if a given date has duty ratio quota > 0 for the specified flight and/or duty
  const hasDutyQuotaOnDate = (
    targetDateStr: string,
    flight: FlightName | 'All',
    dutyCode: DutyCategoryCode | ''
  ): boolean => {
    const flights: FlightName[] = ['Avionics', 'Mechanics', 'GCS', 'Admin'];
    const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
    const checkFlights: FlightName[] = flight !== 'All' ? [flight as FlightName] : flights;

    if (!dutyCode) {
      const _storedMatrix = getStoredDutyMatrix();
      const allDuties = DUTY_TYPES.filter((dt) => {
        if (!dt.isCountedAsDuty) return false;
        const mEntries = _storedMatrix.filter((t) => t.dutyCode === dt.code);
        if (mEntries.length > 0 && mEntries.every((t) => t.isDisabled)) return false;
        return true;
      });
      return allDuties.some((dt) => {
        if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dt.code)) {
          return shifts.some((sh) =>
            checkFlights.some((f) => getFlightDutyQuotaForDate(targetDateStr, f, 'IDAC', sh) > 0)
          );
        }
        return checkFlights.some((f) => getFlightDutyQuotaForDate(targetDateStr, f, dt.code) > 0);
      });
    }

    if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCode as string)) {
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

    const orderedFlights: FlightName[] = (isFlightLocked && activeFlight !== 'All')
      ? [activeFlight as FlightName]
      : ['Avionics', 'Mechanics', 'GCS', 'Admin'];

    if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
      const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
      for (const sh of shifts) {
        for (const flt of orderedFlights) {
          const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh);
          if (req > 0) {
            const assignedCount = assignmentsList.filter((a) => {
              const air = airmanMap.get(a.airmanId);
              return (
                air &&
                air.flightName === flt &&
                (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') &&
                (a.idaShift || a.shift || 'Morning').toLowerCase() === sh.toLowerCase()
              );
            }).length;
            if (assignedCount < req) {
              if (activeIdaShift !== sh) setActiveIdaShift(sh);
              if (!isFlightLocked && activeFlight !== flt) setActiveFlight(flt);
              return;
            }
          }
        }
      }
      // If all are fulfilled for this date, default to first shift/flight with quota
      for (const sh of shifts) {
        for (const flt of orderedFlights) {
          if (getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh) > 0) {
            if (activeIdaShift !== sh) setActiveIdaShift(sh);
            if (!isFlightLocked && activeFlight !== flt) setActiveFlight(flt);
            return;
          }
        }
      }
    } else {
      if (activeIdaShift !== undefined) setActiveIdaShift(undefined);
      if (isFlightLocked && activeFlight !== 'All') return;

      for (const flt of orderedFlights) {
        const req = getFlightDutyQuotaForDate(fromDate, flt, activeDutyCode);
        if (req > 0) {
          const assignedCount = assignmentsList.filter((a) => {
            const air = airmanMap.get(a.airmanId);
            if (!air || air.flightName !== flt) return false;
            if (activeDutyCode === 'AIRPORT' || activeDutyCode === 'AIRFIELD_DUTY') {
              return a.dutyCode === 'AIRPORT' || a.dutyCode === 'AIRFIELD_DUTY';
            }
            if (activeDutyCode === 'GD' || activeDutyCode === 'BASE_SECURITY') {
              return (
                a.dutyCode === 'GD' ||
                a.dutyCode === 'BASE_SECURITY' ||
                (a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'))
              );
            }
            if (activeDutyCode === 'RECEPTION' || activeDutyCode === 'RECEIPTION') {
              return a.dutyCode === 'RECEPTION' || a.dutyCode === 'RECEIPTION' || a.dutyCode === 'RECEPTION_DUTY' || a.dutyCode === 'KO' || a.dutyCode === 'K/O';
            }
            return a.dutyCode === activeDutyCode;
          }).length;
          if (assignedCount < req) {
            if (activeFlight !== flt) setActiveFlight(flt);
            return;
          }
        }
      }
      const firstWithQuota = orderedFlights.find((f) => getFlightDutyQuotaForDate(fromDate, f, activeDutyCode) > 0);
      if (firstWithQuota && activeFlight !== firstWithQuota) {
        setActiveFlight(firstWithQuota);
      }
    }
  }, [isDutyLocked, isFlightLocked, activeFlight, activeDutyCode, fromDate, assignmentsList, airmanMap]);


  // Helper to get required ratio count for duty
  const getRequiredCountForDuty = (dutyCode: DutyCategoryCode, shift?: IDAShift, specificFlight?: FlightName | 'All'): number => {
    const flights: FlightName[] = ['Mechanics', 'Avionics', 'GCS', 'Admin'];
    const targetFlight = specificFlight !== undefined ? specificFlight : activeFlight;
    if (targetFlight === 'All') {
      if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCode)) {
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

    if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCode)) {
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
    return assignmentsList.some((a) => {
      if (!isSameAirman(a.airmanId, airmanId)) return false;
      if (targetCode === 'AIRPORT' || (targetCode as string) === 'AIRFIELD_DUTY') {
        return a.dutyCode === 'AIRPORT' || (a.dutyCode as string) === 'AIRFIELD_DUTY';
      }
      if (targetCode === 'RECEPTION' || (targetCode as string) === 'RECEIPTION') {
        return a.dutyCode === 'RECEPTION' || (a.dutyCode as string) === 'RECEIPTION' || (a.dutyCode as string) === 'RECEPTION_DUTY' || a.dutyCode === 'KO' || a.dutyCode === 'K/O';
      }
      if (targetCode === 'GD' || (targetCode as string) === 'BASE_SECURITY') {
        return a.dutyCode === 'GD' || (a.dutyCode as string) === 'BASE_SECURITY' || (a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'));
      }
      if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(targetCode as string)) {
        const aShift = resolveCanonicalIdacShift(a);
        return (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && (!targetShift || aShift.toLowerCase() === targetShift.toLowerCase());
      }
      return a.dutyCode === targetCode;
    });
  };

  // Helper to check if an airman is currently assigned to the active duty & shift
  const isAirmanAssignedToActiveDuty = (airmanId: string) => {
    return isAirmanAssignedToSpecificDuty(airmanId, activeDutyCode, activeIdaShift);
  };

  // Helper to get detailed list of assigned airmen for any duty code (and optional shift)
  const getAssignedAirmenForDuty = (dutyCode: DutyCategoryCode, shift?: IDAShift) => {
    const list: { airman: Airman; assignment: DutyAssignment }[] = [];
    const seenAirmen = new Set<string>();

    assignmentsList.forEach((assignment) => {
      let airman = airmanMap.get(assignment.airmanId);
      if (!airman) {
        const d = String(assignment.airmanId).replace(/\D/g, '');
        if (d) airman = airmanMap.get(d);
      }
      if (!airman) return;
      if (activeFlight !== 'All' && airman.flightName !== activeFlight) return;

      if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCode)) {
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
        const codeStr = dutyCode as string;
        const asgnCodeStr = assignment.dutyCode as string;
        const isMatch =
          (codeStr === 'AIRPORT' || codeStr === 'AIRFIELD_DUTY')
            ? (asgnCodeStr === 'AIRPORT' || asgnCodeStr === 'AIRFIELD_DUTY')
            : (codeStr === 'RECEPTION' || codeStr === 'RECEIPTION')
            ? (asgnCodeStr === 'RECEPTION' || asgnCodeStr === 'RECEIPTION' || asgnCodeStr === 'RECEPTION_DUTY' || asgnCodeStr === 'KO' || asgnCodeStr === 'K/O')
            : (codeStr === 'GD' || codeStr === 'BASE_SECURITY')
            ? (asgnCodeStr === 'GD' || asgnCodeStr === 'BASE_SECURITY' || (assignment.dutyName && assignment.dutyName.toUpperCase().includes('SECURITY')))
            : asgnCodeStr === codeStr;
        if (isMatch) {
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
        if (activeFlight !== 'All' && airman.flightName !== activeFlight) return;
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [isOpen, selectedPresetDays, fromDate]);

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
    let successOps = 0;
    let skippedPerm = 0;
    let failedOps = 0;

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

          const res = await fetch('/api/roster/assign-range', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              airmanId: airman.id,
              dutyCode: activeDutyCode,
              idaShift: shiftToUse,
              fromDate: dStr,
              toDate: dStr,
              notes,
              proxyForFlight: proxy,
            }),
          });
          if (res.ok) {
            successOps++;
          } else {
            failedOps++;
          }
        }
      }

      if (successOps > 0) {
        if (!dates.includes(fromDate) && dates.length > 0) {
          setFromDate(dates[0]);
          setToDate(dates[0]);
          setSelectedPresetDays(dates[0] === todayStr ? 1 : -1);
        } else {
          fetchCurrentRoster();
        }
        window.dispatchEvent(new CustomEvent('baf_state_updated'));
        if (onRefreshParadeData) onRefreshParadeData();
        if (onSuccess) onSuccess();
      }

      const dtName = DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode;
      const shiftSuffix = isIdac && shiftToUse ? ` (${shiftToUse})` : '';
      if (successOps > 0) {
        setToastMessage(
          `✅ Assigned ${targetAirmen.length} locked airman/airmen to ${dtName}${shiftSuffix} across ${dates.length} date(s)${skippedPerm > 0 ? ` (${skippedPerm} skipped due to permission)` : ''}!`
        );
      } else if (skippedPerm > 0) {
        setToastMessage('⚠️ Permission denied for the selected dates or flight.');
      } else {
        setToastMessage(`❌ Failed to assign locked airmen (${failedOps} error).`);
      }
      setTimeout(() => setToastMessage(''), 4000);
    } catch (err: any) {
      console.error('Multi-date locked airmen assign error:', err);
      setToastMessage(`❌ Error: ${err?.message || 'Network error'}`);
      setTimeout(() => setToastMessage(''), 3500);
    } finally {
      setIsApplyingMultiDates(false);
    }
  };

  // Direct Click Assignment Action (No Draft System)
  const handleToggleAssignAirman = async (
    airman: Airman,
    forceAction?: 'assign' | 'unassign',
    explicitDutyCode?: DutyCategoryCode,
    explicitShift?: IDAShift
  ) => {
    const dutyCodeToUse = explicitDutyCode || activeDutyCode;
    if (!dutyCodeToUse) {
      alert("Please select a duty first.");
      return;
    }
    const isIdac = ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dutyCodeToUse as string);
    const shiftToUse = isIdac ? (explicitShift || activeIdaShift) : undefined;
    if (isIdac && !shiftToUse && forceAction !== 'unassign') {
      alert("Please select a shift first.");
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
        alert(perm.reason || "You do not have permission to remove duties.");
        return;
      }
    } else {
      if (!perm.canAssign) {
        alert(perm.reason || "You do not have permission to assign duties.");
        return;
      }
    }

    setProcessingAirmanId(airman.id);

    try {
      if (willUnassign) {
        // Unassign airman
        const res = await fetch('/api/roster/delete-range', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            airmanId: airman.id,
            fromDate,
            toDate,
            dutyCode: dutyCodeToUse,
            idaShift: isIdac ? shiftToUse : undefined,
          }),
        });

        if (res.ok) {
          setAssignmentsList((prev) => {
            return prev.filter((a) => {
              if (!isSameAirman(a.airmanId, airman.id)) return true;
              if (dutyCodeToUse === 'AIRPORT' || (dutyCodeToUse as string) === 'AIRFIELD_DUTY') {
                return a.dutyCode !== 'AIRPORT' && (a.dutyCode as string) !== 'AIRFIELD_DUTY';
              }
              if (dutyCodeToUse === 'GD' || (dutyCodeToUse as string) === 'BASE_SECURITY') {
                return a.dutyCode !== 'GD' && (a.dutyCode as string) !== 'BASE_SECURITY' && !(a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'));
              }
              if (isIdac) {
                const aShift = resolveCanonicalIdacShift(a);
                return !((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && (!shiftToUse || aShift.toLowerCase() === shiftToUse.toLowerCase()));
              }
              return a.dutyCode !== dutyCodeToUse;
            });
          });

          // Sync unassign directly to localDb
          try {
            const dates = getDatesInRange(fromDate, toDate || fromDate);
            dates.forEach((dStr) => {
              localDb.deleteAssignment(airman.id, dStr, dutyCodeToUse, isIdac ? shiftToUse : undefined);
            });
          } catch (syncErr) {
            console.warn('localDb unassign sync warning:', syncErr);
          }

          setToastMessage(`Removed ${formatAirmanName(airman.rank)} ${airman.name} from duty`);
          setTimeout(() => setToastMessage(''), 2500);
          window.dispatchEvent(new CustomEvent('baf_state_updated'));
          if (onRefreshParadeData) onRefreshParadeData();
          fetchCurrentRoster();
        } else {
          alert('Failed to remove assignment');
        }
        setProcessingAirmanId(null);
        return;
      } else {
        // Direct Assign Airman
        if (isIdac && !shiftToUse) {
          setToastMessage('⚠️ Please select an IDAC Shift (Morning, Afternoon, or Night) first.');
          setTimeout(() => setToastMessage(''), 2500);
          setProcessingAirmanId(null);
          return;
        }

        const targetFlight = proxyForFlight && isProxyEnabled ? proxyForFlight : (activeFlight !== 'All' ? activeFlight : airman.flightName);
        const flightQuota = getFlightDutyQuotaForDate(fromDate, targetFlight as FlightName, dutyCodeToUse, shiftToUse);

        // Find airmen from this targetFlight who already have this duty on this date
        const existingForFlight = assignmentsList.filter((a) => {
          let aAirman = airmanMap.get(a.airmanId);
          if (!aAirman) {
            const d = String(a.airmanId).replace(/\D/g, '');
            if (d) aAirman = airmanMap.get(d);
          }
          const aFlt = aAirman?.flightName || (a as any).proxyForFlight;
          if (aFlt !== targetFlight) return false;
          if (isSameAirman(a.airmanId, airman.id)) return false;

          if (activeDutyCode === 'AIRPORT' || activeDutyCode === 'AIRFIELD_DUTY') {
            return a.dutyCode === 'AIRPORT' || a.dutyCode === 'AIRFIELD_DUTY';
          }
          if (activeDutyCode === 'RECEPTION' || activeDutyCode === 'RECEIPTION') {
            return a.dutyCode === 'RECEPTION' || a.dutyCode === 'RECEIPTION' || a.dutyCode === 'RECEPTION_DUTY' || a.dutyCode === 'KO' || a.dutyCode === 'K/O';
          }
          if (activeDutyCode === 'GD' || activeDutyCode === 'BASE_SECURITY') {
            return a.dutyCode === 'GD' || a.dutyCode === 'BASE_SECURITY' || (a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'));
          }
          if (isIdac) {
            const aShift = resolveCanonicalIdacShift(a);
            return (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && (!shiftToUse || aShift.toLowerCase() === shiftToUse.toLowerCase());
          }
          return a.dutyCode === activeDutyCode;
        });

        let replacedAirman: Airman | null = null;
        // User rule: If flight ratio quota is 1 (or quota is reached), auto-deselect previous person so 2 people are not selected!
        if ((flightQuota === 1 && existingForFlight.length >= 1) || (flightQuota > 0 && existingForFlight.length >= flightQuota)) {
          const prevToReplace = existingForFlight[0];
          let foundPrev = airmanMap.get(prevToReplace.airmanId);
          if (!foundPrev) {
            const d = String(prevToReplace.airmanId).replace(/\D/g, '');
            if (d) foundPrev = airmanMap.get(d);
          }
          replacedAirman = foundPrev || null;

          try {
            await fetch('/api/roster/delete-range', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                airmanId: prevToReplace.airmanId,
                fromDate,
                toDate,
                dutyCode: activeDutyCode,
                idaShift: shiftToUse,
              }),
            });
          } catch (delErr) {
            console.warn('Failed to unassign replaced airman on server:', delErr);
          }
        }

        const notes = activeDutyCode === 'LEAVE' ? `${activeLeaveType} Leave` : '';
        const res = await fetch('/api/roster/assign-range', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            airmanId: airman.id,
            dutyCode: activeDutyCode,
            idaShift: shiftToUse,
            fromDate,
            toDate,
            notes,
            proxyForFlight: isProxyEnabled && proxyForFlight ? proxyForFlight : undefined,
          }),
        });

        if (res.ok) {
          const newAssignment: DutyAssignment = {
            airmanId: airman.id,
            date: fromDate,
            dutyCode: activeDutyCode,
            idaShift: shiftToUse,
            notes,
            proxyForFlight: isProxyEnabled && proxyForFlight ? proxyForFlight : undefined,
          };
          const isDepCode = (code: any) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(String(code || ''));
          setAssignmentsList((prev) => {
            const updated = prev || [];
            let filtered = updated;
            // 1. If an airman was replaced, remove them from assignmentsList (preserving any underlying deployment)
            if (replacedAirman) {
              filtered = filtered.filter((a) => {
                if (!isSameAirman(a.airmanId, replacedAirman!.id)) return true;
                if (isDepCode(a.dutyCode)) return true;
                if (activeDutyCode === 'AIRPORT' || (activeDutyCode as string) === 'AIRFIELD_DUTY') {
                  return a.dutyCode !== 'AIRPORT' && (a.dutyCode as string) !== 'AIRFIELD_DUTY';
                }
                if (activeDutyCode === 'GD' || (activeDutyCode as string) === 'BASE_SECURITY') {
                  return a.dutyCode !== 'GD' && (a.dutyCode as string) !== 'BASE_SECURITY' && !((a as any).dutyName && (a as any).dutyName.toUpperCase().includes('SECURITY'));
                }
                if (isIdac) {
                  return !((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && a.idaShift === shiftToUse);
                }
                return a.dutyCode !== activeDutyCode;
              });
            }
            // 2. Remove other non-deployment duties for the newly assigned airman on this date
            if (isIdac) {
              filtered = filtered.filter((a) => !(isSameAirman(a.airmanId, airman.id) && (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA' || a.dutyCode === 'DUTY' || a.dutyCode === 'DUTY_ON' || a.dutyCode === 'ON_PARADE')));
            } else {
              filtered = filtered.filter((a) => !isSameAirman(a.airmanId, airman.id) || isDepCode(a.dutyCode));
            }
            return [...filtered, newAssignment];
          });

          // Sync directly with localDb
          try {
            const dates = getDatesInRange(fromDate, toDate || fromDate);
            dates.forEach((dStr) => {
              const mKey = dStr.slice(0, 7);
              if (!localDb.db.assignments[mKey]) localDb.db.assignments[mKey] = [];
              let list = localDb.db.assignments[mKey];
              if (replacedAirman) {
                list = list.filter((a) => {
                  if (!isSameAirman(a.airmanId, replacedAirman!.id) || a.date !== dStr) return true;
                  if (isDepCode(a.dutyCode)) return true;
                  if (activeDutyCode === 'AIRPORT' || (activeDutyCode as string) === 'AIRFIELD_DUTY') {
                    return a.dutyCode !== 'AIRPORT' && (a.dutyCode as string) !== 'AIRFIELD_DUTY';
                  }
                  if (activeDutyCode === 'GD' || (activeDutyCode as string) === 'BASE_SECURITY') {
                    return a.dutyCode !== 'GD' && (a.dutyCode as string) !== 'BASE_SECURITY' && !((a as any).dutyName && (a as any).dutyName.toUpperCase().includes('SECURITY'));
                  }
                  if (isIdac) {
                    return !((a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') && a.idaShift === shiftToUse);
                  }
                  return a.dutyCode !== activeDutyCode;
                });
              }
              if (isIdac) {
                list = list.filter((a) => !(isSameAirman(a.airmanId, airman.id) && a.date === dStr && (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA')));
              } else {
                list = list.filter((a) => !(isSameAirman(a.airmanId, airman.id) && a.date === dStr && !isDepCode(a.dutyCode)));
              }
              list.push({ ...newAssignment, date: dStr });
              localDb.db.assignments[mKey] = list;
            });
            localDb.saveToStorage(localDb.db, false, false, false);
          } catch (syncErr) {
            console.warn('localDb assign sync warning:', syncErr);
          }

          const dtName = DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode;
          const shiftSuffix = isIdac ? ` (${activeIdaShift})` : '';
          if (replacedAirman) {
            setToastMessage(`🔄 Replaced ${formatAirmanName(replacedAirman.rank)} ${replacedAirman.name} ➔ Assigned ${formatAirmanName(airman.rank)} ${airman.name} to ${dtName}${shiftSuffix}`);
          } else {
            setToastMessage(`✅ ${formatAirmanName(airman.rank)} ${airman.name} assigned to ${dtName}${shiftSuffix}`);
          }
          setTimeout(() => setToastMessage(''), 2500);
          window.dispatchEvent(new CustomEvent('baf_state_updated'));
          if (onRefreshParadeData) onRefreshParadeData();
          if (onSuccess) onSuccess();
          fetchCurrentRoster();

          // Auto-advance logic when BOTH Flight AND Duty are Locked:
          // Keep Flight and Duty fixed; once the locked flight's quota for that locked duty on fromDate is fulfilled, advance to next date
          if (isFlightLocked && activeFlight !== 'All' && isDutyLocked && activeDutyCode) {
            const targetFlight = activeFlight as FlightName;
            let nextAssignments = assignmentsList;
            if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
              nextAssignments = [
                ...nextAssignments.filter(
                  (a) =>
                    !(
                      isSameAirman(a.airmanId, airman.id) &&
                      (a.dutyCode === 'IDAC' ||
                        a.dutyCode === 'IDA' ||
                        a.dutyCode === 'DUTY' ||
                        a.dutyCode === 'DUTY_ON' ||
                        a.dutyCode === 'ON_PARADE')
                    )
                ),
                newAssignment,
              ];
              const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
              const idacSlots: Array<{ shift: IDAShift; required: number; assigned: number }> = [];
              shifts.forEach((sh) => {
                const req = getFlightDutyQuotaForDate(fromDate, targetFlight, 'IDAC', sh);
                if (req > 0) {
                  const assigned = nextAssignments.filter((a) => {
                    const air = airmanMap.get(a.airmanId);
                    return (
                      air &&
                      air.flightName === targetFlight &&
                      (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') &&
                      (a.idaShift || a.shift || 'Morning').toLowerCase() === sh.toLowerCase()
                    );
                  }).length;
                  idacSlots.push({ shift: sh, required: req, assigned });
                }
              });

              const allFulfilled = idacSlots.length === 0 || idacSlots.every((s) => s.assigned >= s.required);
              if (allFulfilled) {
                const nextDateStr = findNextDateWithDutyQuota(fromDate, targetFlight, 'IDAC', 1);
                setToastMessage(`🎉 ${targetFlight} IDAC duty completed for ${fromDate}! Advancing to ${nextDateStr}...`);
                setTimeout(() => {
                  setFromDate(nextDateStr);
                  setToDate(nextDateStr);
                  setSelectedPresetDays(1);
                }, 500);
              } else {
                const currentIdx = idacSlots.findIndex((s) => s.shift === activeIdaShift);
                const nextSlot = idacSlots.slice(currentIdx + 1).find((s) => s.assigned < s.required) || idacSlots.find((s) => s.assigned < s.required);
                if (nextSlot) {
                  setActiveIdaShift(nextSlot.shift);
                }
              }
            } else {
              nextAssignments = [...nextAssignments.filter((a) => !isSameAirman(a.airmanId, airman.id) || isDepCode(a.dutyCode)), newAssignment];
              const req = getFlightDutyQuotaForDate(fromDate, targetFlight, activeDutyCode);
              const assigned = nextAssignments.filter((a) => {
                const air = airmanMap.get(a.airmanId);
                if (!air || air.flightName !== targetFlight) return false;
                if (activeDutyCode === 'AIRPORT' || activeDutyCode === 'AIRFIELD_DUTY') {
                  return a.dutyCode === 'AIRPORT' || a.dutyCode === 'AIRFIELD_DUTY';
                }
                if (activeDutyCode === 'GD' || activeDutyCode === 'BASE_SECURITY') {
                  return (
                    a.dutyCode === 'GD' ||
                    a.dutyCode === 'BASE_SECURITY' ||
                    (a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'))
                  );
                }
                if (activeDutyCode === 'RECEPTION' || activeDutyCode === 'RECEIPTION') {
                  return a.dutyCode === 'RECEPTION' || a.dutyCode === 'RECEIPTION' || a.dutyCode === 'RECEPTION_DUTY' || a.dutyCode === 'KO' || a.dutyCode === 'K/O';
                }
                return a.dutyCode === activeDutyCode;
              }).length;

              const targetQuota = Math.max(1, req);
              if (assigned >= targetQuota) {
                const nextDateStr = findNextDateWithDutyQuota(fromDate, targetFlight, activeDutyCode, 1);
                const dutyName = DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode;
                setToastMessage(`🎉 ${targetFlight} ${dutyName} completed for ${fromDate}! Advancing to ${nextDateStr}...`);
                setTimeout(() => {
                  setFromDate(nextDateStr);
                  setToDate(nextDateStr);
                  setSelectedPresetDays(1);
                }, 500);
              }
            }
          }
          // Auto-advance logic: Advance to next unfulfilled duty or next date when ONLY Flight is locked (or FlightFirst mode)
          else if ((isFlightLocked || (selectionMode === 'FlightFirst' && !isDutyLocked)) && !isDutyLocked && activeFlight !== 'All' && activeDutyCode) {
            const targetFlight = activeFlight as FlightName;
            const _storedMatrix = getStoredDutyMatrix();
            const allDuties = DUTY_TYPES.filter((dt) => {
              if (!dt.isCountedAsDuty) return false;
              const mEntries = _storedMatrix.filter(t => t.dutyCode === dt.code);
              if (mEntries.length > 0 && mEntries.every(t => t.isDisabled)) return false;
              return true;
            });

            // Construct next assignments state
            let nextAssignments = assignmentsList;
            if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
              nextAssignments = [...nextAssignments.filter((a) => !(isSameAirman(a.airmanId, airman.id) && (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA' || a.dutyCode === 'DUTY' || a.dutyCode === 'DUTY_ON' || a.dutyCode === 'ON_PARADE'))), newAssignment];
            } else {
              nextAssignments = [...nextAssignments.filter((a) => !isSameAirman(a.airmanId, airman.id) || isDepCode(a.dutyCode)), newAssignment];
            }

            interface DutySlot {
              dutyCode: DutyCategoryCode;
              shift?: IDAShift;
              required: number;
              assigned: number;
            }
            const slots: DutySlot[] = [];

            allDuties.forEach((dt) => {
              if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(dt.code)) {
                const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];
                shifts.forEach((sh) => {
                  const req = getFlightDutyQuotaForDate(fromDate, targetFlight, 'IDAC', sh);
                  if (req > 0) {
                    const assigned = nextAssignments.filter((a) => {
                      const air = airmanMap.get(a.airmanId);
                      return air && air.flightName === targetFlight &&
                        (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') &&
                        a.idaShift === sh;
                    }).length;
                    slots.push({ dutyCode: 'IDAC', shift: sh, required: req, assigned });
                  }
                });
              } else {
                const req = getFlightDutyQuotaForDate(fromDate, targetFlight, dt.code);
                if (req > 0) {
                  const assigned = nextAssignments.filter((a) => {
                    const air = airmanMap.get(a.airmanId);
                    if (!air || air.flightName !== targetFlight) return false;
                    if (dt.code === 'AIRPORT') return a.dutyCode === 'AIRPORT' || (a.dutyCode as string) === 'AIRFIELD_DUTY';
                    return a.dutyCode === dt.code;
                  }).length;
                  slots.push({ dutyCode: dt.code, required: req, assigned });
                }
              }
            });

            // Check if all duty slots for this locked flight on fromDate are now fulfilled
            const allFulfilled = slots.length > 0 && slots.every((s) => s.assigned >= s.required);

            if (allFulfilled && isFlightLocked) {
              const nextDateStr = findNextDateWithDutyQuota(fromDate, targetFlight, '', 1);
              
              setToastMessage(`🎉 All ${targetFlight} duties completed for ${fromDate}! Advancing to ${nextDateStr}...`);
              setTimeout(() => {
                setFromDate(nextDateStr);
                setToDate(nextDateStr);
                setSelectedPresetDays(1);
              }, 700);
            } else {
              // Auto-advance to next unfulfilled duty
              const currentSlotIdx = slots.findIndex(s => s.dutyCode === activeDutyCode && (!s.shift || s.shift === activeIdaShift));
              let nextSlot = slots.slice(currentSlotIdx + 1).find(s => s.assigned < s.required);
              if (!nextSlot) {
                nextSlot = slots.find(s => s.assigned < s.required);
              }
              if (nextSlot) {
                setActiveDutyCode(nextSlot.dutyCode);
                setActiveIdaShift(nextSlot.shift);
              }
            }
          }

          // Auto-advance logic when ONLY Duty is Locked (Flight is not locked)
          else if (isDutyLocked && !isFlightLocked && activeDutyCode) {
            // Construct next assignments state
            let nextAssignments = assignmentsList;
            if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
              nextAssignments = [
                ...nextAssignments.filter(
                  (a) =>
                    !(
                      isSameAirman(a.airmanId, airman.id) &&
                      (a.dutyCode === 'IDAC' ||
                        a.dutyCode === 'IDA' ||
                        a.dutyCode === 'DUTY' ||
                        a.dutyCode === 'DUTY_ON' ||
                        a.dutyCode === 'ON_PARADE')
                    )
                ),
                newAssignment,
              ];
            } else {
              nextAssignments = [...nextAssignments.filter((a) => !isSameAirman(a.airmanId, airman.id)), newAssignment];
            }

            const orderedFlights: FlightName[] = ['Avionics', 'Mechanics', 'GCS', 'Admin'];

            if (['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) {
              // IDAC shift-wise auto-advance: Morning -> Afternoon -> Night
              interface IdacSlot {
                shift: IDAShift;
                flight: FlightName;
                required: number;
                assigned: number;
              }
              const idacSlots: IdacSlot[] = [];
              const shifts: IDAShift[] = ['Morning', 'Afternoon', 'Night'];

              shifts.forEach((sh) => {
                orderedFlights.forEach((flt) => {
                  const req = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', sh);
                  if (req > 0) {
                    const assigned = nextAssignments.filter((a) => {
                      const air = airmanMap.get(a.airmanId);
                      return (
                        air &&
                        air.flightName === flt &&
                        (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA') &&
                        (a.idaShift || a.shift || 'Morning').toLowerCase() === sh.toLowerCase()
                      );
                    }).length;
                    idacSlots.push({ shift: sh, flight: flt, required: req, assigned });
                  }
                });
              });

              const allIdacFulfilled = idacSlots.length > 0 && idacSlots.every((s) => s.assigned >= s.required);

              if (allIdacFulfilled) {
                const nextDateStr = findNextDateWithDutyQuota(fromDate, 'All', 'IDAC', 1);

                setToastMessage(`🎉 All IDAC shifts completed for ${fromDate}! Advancing to ${nextDateStr}...`);
                setTimeout(() => {
                  setFromDate(nextDateStr);
                  setToDate(nextDateStr);
                  setSelectedPresetDays(1);
                }, 700);
              } else {
                // Find next unfulfilled slot in sequence
                const currentSlotIdx = idacSlots.findIndex(
                  (s) => s.shift === activeIdaShift && s.flight === activeFlight
                );
                let nextSlot = idacSlots.slice(currentSlotIdx + 1).find((s) => s.assigned < s.required);
                if (!nextSlot) {
                  nextSlot = idacSlots.find((s) => s.assigned < s.required);
                }
                if (nextSlot) {
                  setActiveIdaShift(nextSlot.shift);
                  setActiveFlight(nextSlot.flight);
                }
              }
            } else {
              // Non-IDAC standard duty auto-advance across flights
              interface DutyFlightSlot {
                flight: FlightName;
                required: number;
                assigned: number;
              }
              const flightSlots: DutyFlightSlot[] = [];

              orderedFlights.forEach((flt) => {
                const req = getFlightDutyQuotaForDate(fromDate, flt, activeDutyCode);
                if (req > 0) {
                  const assigned = nextAssignments.filter((a) => {
                    const air = airmanMap.get(a.airmanId);
                    if (!air || air.flightName !== flt) return false;
                    if (activeDutyCode === 'AIRPORT' || activeDutyCode === 'AIRFIELD_DUTY') {
                      return a.dutyCode === 'AIRPORT' || a.dutyCode === 'AIRFIELD_DUTY';
                    }
                    if (activeDutyCode === 'GD' || activeDutyCode === 'BASE_SECURITY') {
                      return (
                        a.dutyCode === 'GD' ||
                        a.dutyCode === 'BASE_SECURITY' ||
                        (a.dutyName && a.dutyName.toUpperCase().includes('SECURITY'))
                      );
                    }
                    if (activeDutyCode === 'RECEPTION' || activeDutyCode === 'RECEIPTION') {
                      return a.dutyCode === 'RECEPTION' || a.dutyCode === 'RECEIPTION' || a.dutyCode === 'RECEPTION_DUTY' || a.dutyCode === 'KO' || a.dutyCode === 'K/O';
                    }
                    return a.dutyCode === activeDutyCode;
                  }).length;
                  flightSlots.push({ flight: flt, required: req, assigned });
                }
              });

              const allDutyFulfilled = flightSlots.length > 0 && flightSlots.every((s) => s.assigned >= s.required);
              const dutyName = DUTY_TYPE_MAP.get(activeDutyCode as any)?.name || activeDutyCode;

              if (allDutyFulfilled) {
                const nextDateStr = findNextDateWithDutyQuota(fromDate, 'All', activeDutyCode, 1);

                setToastMessage(`🎉 All ${dutyName} duties completed for ${fromDate}! Advancing to ${nextDateStr}...`);
                setTimeout(() => {
                  setFromDate(nextDateStr);
                  setToDate(nextDateStr);
                  setSelectedPresetDays(1);
                }, 700);
              } else {
                // Advance to next unfulfilled flight
                const currentSlotIdx = flightSlots.findIndex((s) => s.flight === activeFlight);
                let nextSlot = flightSlots.slice(currentSlotIdx + 1).find((s) => s.assigned < s.required);
                if (!nextSlot) {
                  nextSlot = flightSlots.find((s) => s.assigned < s.required);
                }
                if (nextSlot) {
                  setActiveFlight(nextSlot.flight);
                }
              }
            }
          }
        } else {
          const data = await res.json().catch(() => ({}));
          alert(data.error || 'Failed to assign duty');
        }
      }
    } catch (err: any) {
      console.error('Direct assignment error:', err);
      alert(`Network error: ${err.message}`);
    } finally {
      setProcessingAirmanId(null);
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
        prevAssignments.find((a) => !isDeploymentCode(a.dutyCode) && !isGenericStr(a.dutyCode)) || prevAssignments[0];
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
      // 1A. Leave
      const leave = airmanAssignments.find((a) => a.dutyCode === 'LEAVE');
      if (leave) {
        const notesLower = (leave.notes || '').toLowerCase();
        let lbl = 'Leave';
        if (notesLower.includes('sick')) lbl = 'Sick Leave';
        else if (notesLower.includes('recreation') || notesLower.includes('rl') || notesLower.includes('rec leave')) lbl = 'Leave (RL)';
        else if (notesLower.includes('casual') || notesLower.includes('cl')) lbl = 'Leave (CL)';
        else if (notesLower.includes('annual') || notesLower.includes('al')) lbl = 'Leave (AL)';
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

        if (targetFlight !== 'All' && airman.flightName !== targetFlight) return false;

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
          const eligibleFlights = matrixConfig?.eligibleFlights || dutyConfig.eligibleFlights;
          const eligibleRanks = matrixConfig?.eligibleRanks || dutyConfig.eligibleRanks;
          
          if (eligibleFlights && eligibleFlights.length > 0) {
            if (!eligibleFlights.includes(airman.flightName as any)) return false;
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
    <div className="fixed inset-0 z-50 flex items-start justify-center p-0 sm:pt-6 sm:pb-6 sm:px-5 overflow-y-auto bg-slate-950/75 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-none sm:rounded-2xl border-0 sm:border border-slate-200 dark:border-slate-800 shadow-2xl max-w-4xl w-full p-4 sm:p-5 space-y-3.5 relative overflow-hidden h-full sm:h-auto sm:max-h-[calc(100vh-3rem)] flex flex-col">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-800 pb-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-xl text-white shadow-md ${onlyIdac ? 'bg-teal-600' : 'bg-emerald-600'}`}>
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">
                  {onlyIdac ? 'IDA Center Duty Assignment' : 'Assign Duty / Activity'}
                </h2>
                <span className={`px-2 py-0.5 rounded-full text-[11px] font-black border ${
                  onlyIdac 
                    ? 'bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-300 border-teal-200 dark:border-teal-800'
                    : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                }`}>
                  Instant Auto-Save
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {onlyIdac
                  ? 'Click IDAC shift and airman below to assign directly. Synchronized with Dashboard & Matrix.'
                  : 'Select a tab below to assign Duty, Leave, TDY, or Deployment.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {['Duty', 'Leave', 'TDY', 'Deployment'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveModalTab(tab as any)}
              className={`px-3 py-1.5 text-xs sm:text-sm font-bold rounded-lg transition-colors flex-1 text-center ${activeModalTab === tab ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm' : 'text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
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


        {/* Live Toast Notification */}
        {toastMessage && (
          <div className={`p-2.5 text-white rounded-xl font-bold text-xs shadow-md flex items-center space-x-2 animate-fadeIn shrink-0 ${
            toastMessage.startsWith('❌') ? 'bg-rose-600' : toastMessage.startsWith('⚠️') ? 'bg-amber-600' : 'bg-emerald-600'
          }`}>
            {toastMessage.startsWith('⚠️') || toastMessage.startsWith('❌') ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            )}
            <span>{toastMessage}</span>
          </div>
        )}

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
                  const isSelected = selectedPresetDays === opt.val;
                  return (
                    <button
                      key={opt.val}
                      type="button"
                      onClick={() => {
                        if (opt.val === 1) {
                          const todayStr = new Date().toISOString().split('T')[0];
                          setFromDate(todayStr);
                          setToDate(todayStr);
                          setSelectedPresetDays(1);
                        } else {
                          setSelectedPresetDays(opt.val);
                          if (fromDate) {
                            const d = new Date(fromDate);
                            d.setDate(d.getDate() + opt.val - 1);
                            setToDate(d.toISOString().split('T')[0]);
                          }
                        }
                      }}
                      className={`px-2 py-1 text-[10px] font-black rounded-lg transition-all cursor-pointer shadow-2xs border ${
                        isSelected
                          ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-500/50 shadow-sm'
                          : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 dark:hover:text-emerald-300 hover:border-emerald-300'
                      }`}
                    >
                      {opt.label}
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
                      setSelectedPresetDays(1);
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
                  const _storedMatrix = getStoredDutyMatrix(); const allDuties = DUTY_TYPES.filter((dt) => { if (!dt.isCountedAsDuty) return false; const mEntries = _storedMatrix.filter(t => t.dutyCode === dt.code); if (mEntries.length > 0 && mEntries.every(t => t.isDisabled)) return false; return true; });
                  const ratioFiltered = allDuties.filter((dt) => {
                    const req = getRequiredCountForDuty(dt.code);
                    const assignedCount = assignmentsList.filter(a => {
                      if (activeFlight !== 'All') {
                        const airman = airmanMap.get(a.airmanId);
                        if (airman && airman.flightName !== activeFlight) return false;
                      }
                      if (dt.code === 'AIRPORT') {
                        return a.dutyCode === 'AIRPORT' || (a.dutyCode as string) === 'AIRFIELD_DUTY';
                      }
                      if (dt.code === 'IDAC' || dt.code === 'IDA') {
                        return a.dutyCode === 'IDAC' || a.dutyCode === 'IDA';
                      }
                      return a.dutyCode === dt.code;
                    }).length;
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
                        const fltAssigned = assignmentsList.filter(a => {
                          const airman = airmanMap.get(a.airmanId);
                          if (!airman || airman.flightName !== activeFlight) return false;
                          if (dt.code === 'AIRPORT') return a.dutyCode === 'AIRPORT' || (a.dutyCode as string) === 'AIRFIELD_DUTY';
                          if (dt.code === 'IDAC' || dt.code === 'IDA') return a.dutyCode === 'IDAC' || a.dutyCode === 'IDA';
                          return a.dutyCode === dt.code;
                        }).length;
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
                    const reqQuota = getRequiredCountForDuty(dt.code);
                    const assignedList = getAssignedAirmenForDuty(dt.code);
                    
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
                          const q = getRequiredCountForDuty('IDAC', sh);
                          const a = getAssignedAirmenForDuty('IDAC', sh).length;
                          return (q > 0 && a > q) || (q === 0 && a > 0);
                        })
                      : (reqQuota > 0 && assignedList.length > reqQuota) || (reqQuota === 0 && assignedList.length > 0);

                    const isUnderQuota =
                      !isOverQuota &&
                      (isIdacCard
                        ? (reqQuota > 0 && assignedList.length < reqQuota) ||
                          (['Morning', 'Afternoon', 'Night'] as IDAShift[]).some((sh) => {
                            const q = getRequiredCountForDuty('IDAC', sh);
                            const a = getAssignedAirmenForDuty('IDAC', sh).length;
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
                          setActiveDutyCode(dt.code);
                          userManuallySelectedFlightRef.current = false;
                          if (activeFlight === 'All') {
                            setSelectionMode('DutyFirst');
                          }
                        }}
                        className={`p-2 rounded-xl border text-left transition-all relative flex flex-col justify-start cursor-pointer ${
                          isSelected
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-500 shadow-sm ring-2 ring-emerald-500/30'
                            : 'bg-white dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700/80 hover:border-emerald-400 hover:shadow-xs'
                        } ${quotaBorderAlertClass}`}
                      >
                        {/* Header: Duty Name & Ratio Badge (e.g. 3/3) */}
                        <div className="flex items-center justify-between gap-1 border-b border-slate-100 dark:border-slate-700/60 pb-1.5 mb-1.5">
                          <span className={`text-[11px] font-black truncate leading-tight flex items-center gap-1 ${isSelected ? 'text-emerald-950 dark:text-emerald-100' : 'text-slate-900 dark:text-slate-100'}`} title={displayName}>
                            {isDutyLocked && isSelected && (
                              <Lock className="w-3 h-3 text-amber-500 stroke-[2.5] shrink-0" />
                            )}
                            <span className="truncate">{displayName}</span>
                          </span>
                          <div className="shrink-0">
                            {reqQuota > 0 ? (
                              <span
                                className={`text-[9.5px] font-black px-1.5 py-0.2 rounded-full ${
                                  isOverQuota
                                    ? 'bg-rose-600 text-white'
                                    : isUnderQuota
                                    ? 'bg-amber-500 text-slate-950'
                                    : 'bg-emerald-600 text-white shadow-2xs'
                                }`}
                              >
                                {assignedList.length}/{reqQuota}
                              </span>
                            ) : (
                              <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded-full ${
                                isOverQuota ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                              }`}>
                                {assignedList.length}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Detailed Airmen List */}
                        <div className="space-y-1">
                          {assignedList.length === 0 ? (
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic py-0.5">
                              — None
                            </p>
                          ) : (
                            assignedList.map((item, idx) => (
                              <div
                                key={`${item.airman.id}-${item.assignment.dutyCode}-${item.assignment.idaShift || ''}-${idx}`}
                                className="text-[10.5px] leading-tight font-semibold text-slate-800 dark:text-slate-200 truncate bg-slate-50/80 dark:bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between group"
                                title={`${formatAirmanName(item.airman.rank)} ${item.airman.name}`}
                              >
                                <div className="truncate flex items-center">
                                  <span className="text-slate-400 dark:text-slate-500 font-bold mr-1">{idx + 1}.</span>
                                  <span className="truncate">{formatAirmanName(item.airman.rank)} {item.airman.name}</span>
                                  {(item.assignment.dutyCode === 'IDAC' || item.assignment.dutyCode === 'IDA') && item.assignment.idaShift && (
                                    <span className="ml-1 text-[9.5px] text-teal-600 dark:text-teal-400 font-bold">
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
                                  className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 ml-1 p-0.5 rounded hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors shrink-0 cursor-pointer"
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

          {/* IDAC Dynamic Shift Picker (Shows detailed airmen for each shift) */}
          {(onlyIdac || ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string)) && (
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
                <div className={`grid gap-2 ${availableIdaShifts.length === 1 ? 'grid-cols-1' : availableIdaShifts.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
                  {availableIdaShifts.map((s) => {
                    const shiftQuota = getRequiredCountForDuty('IDAC', s);
                    const shiftAssigned = getAssignedAirmenForDuty('IDAC', s);
                    const allFlights: import('../types').FlightName[] = ['Avionics', 'Mechanics', 'GCS', 'Admin'];
                    const unfulfilledFlights: import('../types').FlightName[] = [];
                    allFlights.forEach(flt => {
                      const fltQuota = getFlightDutyQuotaForDate(fromDate, flt, 'IDAC', s);
                      if (fltQuota > 0) {
                        const fltAssigned = shiftAssigned.filter(item => item.airman.flightName === flt).length;
                        const remaining = fltQuota - fltAssigned;
                        for (let i = 0; i < remaining; i++) {
                           unfulfilledFlights.push(flt);
                        }
                      }
                    });
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
                          setActiveIdaShift(s);
                          userManuallySelectedFlightRef.current = false;
                        }}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-start ${
                          isShiftSelected
                            ? 'bg-teal-600 text-white border-teal-700 shadow-md ring-2 ring-teal-400/40'
                            : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-teal-200 dark:border-teal-900/80 hover:border-teal-400'
                        } ${shiftBorderAlertClass}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-black text-xs flex items-center gap-1">
                            {isDutyLocked && isShiftSelected && (
                              <Lock className="w-3 h-3 text-amber-300 stroke-[2.5] shrink-0" />
                            )}
                            <span>{s} Shift</span>
                          </span>
                          <span
                            className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                              isShiftOver
                                ? 'bg-rose-600 text-white shadow-xs'
                                : isShiftUnder
                                ? 'bg-amber-400 text-slate-950 shadow-xs'
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
            {/* Flight Tabs */}
            <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
              <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
                2. Flight:
              </span>

              {/* Flight Lock Toggle Button */}
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
                      setActiveFlight('Avionics');
                    }
                  } else {
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.setItem('baf_duty_flight_locked', 'false');
                    }
                  }
                }}
                title={
                  isFlightLocked 
                    ? `Flight is locked to ${activeFlight}. Click to unlock.` 
                    : 'Click to lock this flight: Only shows duties for this flight, auto-advances duty on assign, and auto-advances date when complete.'
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

              {(['All', 'Avionics', 'Mechanics', 'GCS', 'Admin'] as Array<FlightName | 'All'>).filter(flt => {
                if (isAdmin && adminFlight) {
                  return flt === adminFlight;
                }
                if (flt === 'All') return true;
                if (isFlightLocked || isDutyLocked) return true; // Keep all flights visible when locked so user can switch
                const matrixConfig = getStoredDutyMatrix().find(t => t.dutyCode === activeDutyCode);
                
                if (matrixConfig) {
                  // For duties that are tracked in the matrix (GD, BTF, IDAC, etc), hide flights with 0 quota for that day.
                  const quota = getFlightDutyQuotaForDate(
                    fromDate, 
                    flt, 
                    activeDutyCode, 
                    ['IDAC', 'IDA', 'IDA C', 'IDA_C', 'IDAC CENTER', 'IDA CENTER'].includes(activeDutyCode as string) ? activeIdaShift : undefined
                  );
                  if (quota === 0) return false;
                } else {
                  // For duties without a matrix, use eligibleFlights if defined
                  const dutyConfig = DUTY_TYPE_MAP.get(activeDutyCode as any);
                  if (dutyConfig?.eligibleFlights && dutyConfig.eligibleFlights.length > 0) {
                    return dutyConfig.eligibleFlights.includes(flt);
                  }
                }
                
                // Also respect matrix eligibleFlights just in case
                if (matrixConfig?.eligibleFlights && matrixConfig.eligibleFlights.length > 0) {
                  return matrixConfig.eligibleFlights.includes(flt);
                }

                return true;
              }).map((flt) => {
                const isDisabledFlt = flt !== 'All' && ((isAdmin && adminFlight && flt !== adminFlight) || (isPastDate && !isSuperAdmin));
                const isSelected = activeFlight === flt;
                return (
                <button
                  key={flt}
                  type="button"
                  onClick={() => {
                    if (!isDisabledFlt) {
                      if (activeFlight === flt) return; // Do not deselect on click
                      
                      const newFlt = flt;
                      setActiveFlight(newFlt);
                      
                      if (newFlt !== 'All') {
                        userManuallySelectedFlightRef.current = true;
                        if (selectionMode === 'None' || !activeDutyCode) {
                          setSelectionMode('FlightFirst');
                        }
                        const _storedMatrix = getStoredDutyMatrix(); const allDuties = DUTY_TYPES.filter((dt) => { if (!dt.isCountedAsDuty) return false; const mEntries = _storedMatrix.filter(t => t.dutyCode === dt.code); if (mEntries.length > 0 && mEntries.every(t => t.isDisabled)) return false; return true; });
                        const ratioFiltered = allDuties.filter((dt) => getRequiredCountForDuty(dt.code, undefined, newFlt as FlightName) > 0);
                        if (!isDutyLocked && ratioFiltered.length > 0) {
                          if (!activeDutyCode || !ratioFiltered.some(d => d.code === activeDutyCode)) {
                            setActiveDutyCode(ratioFiltered[0].code);
                          }
                        }
                      } else {
                        userManuallySelectedFlightRef.current = true;
                        if (!activeDutyCode) {
                          setSelectionMode('None');
                        }
                      }
                    }
                  }}
                  disabled={isDisabledFlt}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg border transition-all flex items-center gap-1 ${
                    isDisabledFlt ? 'opacity-50 cursor-not-allowed bg-slate-100 text-slate-400 border-slate-200 dark:bg-slate-800 dark:text-slate-600 dark:border-slate-700' :
                    isSelected
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100 shadow-xs cursor-pointer'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400 cursor-pointer'
                  }`}
                >
                  {isFlightLocked && isSelected && flt !== 'All' && (
                    <Lock className="w-3 h-3 text-amber-400 stroke-[2.5]" />
                  )}
                  {flt}
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
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 outline-none focus:border-emerald-500"
              />
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
                  const isProcessing = processingAirmanId === airman.id || isApplyingMultiDates;

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
        <div className="flex items-center justify-between pt-2.5 border-t border-slate-200 dark:border-slate-800 shrink-0">
          <div className="text-xs text-slate-500">
            <span>
              Date: <strong>{fromDate}</strong>
              {selectedPresetDays !== 1 && fromDate !== toDate ? ` to ${toDate}` : ''} • Changes are applied directly.
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-xs font-black bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-all cursor-pointer"
            >
              Done / Close
            </button>
          </div>
        </div>

      </div>

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

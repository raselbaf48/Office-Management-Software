import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { PrintConfidentialShell } from './PrintConfidentialShell';
import { Airman, DutyAssignment } from '../types';
import { DUTY_TYPE_MAP } from '../data/dutyTypes';
import { resolveAirmanDutyForDate, addAssignmentToMap, calculateDutyStats } from '../data/rosterGenerator';
import { formatRank } from '../utils/rankFormatter';
import { Printer, FileSpreadsheet, X, Filter, ChevronLeft, ChevronRight, ArrowLeft, Calendar, Layers, Loader2 } from 'lucide-react';
import {
  exportMonthlyAttendanceRegisterExcel,
  exportMultiMonthAttendanceRegisterExcel,
  AttendanceMonthSpec,
  formatFlightFullName,
  getRankTier,
  getAirmanJoinDateISO,
  getAirmanLeftDateISO,
  isAirmanInUnitForMonth,
} from '../utils/csvExport';
import { getActiveOfficeIdentity, doesOfficeHaveFlights } from '../firebase';
import { localDb } from '../services/localDatabase';
import { getBiodataTrades } from '../utils/tradeList';

interface PrintableMonthlyAttendanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  airmen: Airman[];
  assignments: DutyAssignment[];
  year: number;
  month: number;
  flightFilter?: string;
  onMonthChange?: (year: number, month: number) => void;
}

export const PrintableMonthlyAttendanceModal: React.FC<PrintableMonthlyAttendanceModalProps> = ({
  isOpen,
  onClose,
  airmen,
  assignments,
  year,
  month,
  flightFilter = 'All',
  onMonthChange,
}) => {
  const officeHasFlights = useMemo(() => doesOfficeHaveFlights(airmen), [airmen]);
  const biodataTrades = useMemo(() => getBiodataTrades(airmen), [airmen]);
  const [selectedYear, setSelectedYear] = useState<number>(year);
  const [selectedMonth, setSelectedMonth] = useState<number>(month);
  const [selectedFlight, setSelectedFlight] = useState<string>(
    flightFilter === 'All' ? 'All' : (officeHasFlights ? formatFlightFullName(flightFilter) : flightFilter)
  );
  const [selectedRank, setSelectedRank] = useState<string>('All');
  const [dbRefreshTick, setDbRefreshTick] = useState<number>(0);

  // Dedicated full-screen Excel Export page state (Current Month, Full Year, or From Month -> To Month)
  const [showExcelMenu, setShowExcelMenu] = useState<boolean>(false);
  const [isExportingExcel, setIsExportingExcel] = useState<boolean>(false);
  const [exportFullYear, setExportFullYear] = useState<number>(year);
  const [rangeFromYear, setRangeFromYear] = useState<number>(year);
  const [rangeFromMonth, setRangeFromMonth] = useState<number>(1);
  const [rangeToYear, setRangeToYear] = useState<number>(year);
  const [rangeToMonth, setRangeToMonth] = useState<number>(month);

  useEffect(() => {
    setSelectedYear(year);
    setSelectedMonth(month);
    setExportFullYear(year);
    setRangeFromYear(year);
    setRangeFromMonth(1);
    setRangeToYear(year);
    setRangeToMonth(month);
  }, [year, month]);

  useEffect(() => {
    if (!isOpen) {
      setShowExcelMenu(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (flightFilter && flightFilter !== 'All') {
      setSelectedFlight(officeHasFlights ? formatFlightFullName(flightFilter) : flightFilter);
    } else if (flightFilter === 'All') {
      setSelectedFlight('All');
    }
  }, [flightFilter, officeHasFlights]);

  useEffect(() => {
    if (!isOpen) return;
    const handleUpdate = () => setDbRefreshTick((t) => t + 1);
    window.addEventListener('baf_state_updated', handleUpdate);
    window.addEventListener('baf_sync_status', handleUpdate);
    return () => {
      window.removeEventListener('baf_state_updated', handleUpdate);
      window.removeEventListener('baf_sync_status', handleUpdate);
    };
  }, [isOpen]);

  const handlePrevMonth = () => {
    const nextMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
    const nextYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;
    setSelectedMonth(nextMonth);
    setSelectedYear(nextYear);
    onMonthChange?.(nextYear, nextMonth);
  };

  const handleNextMonth = () => {
    const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
    const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    setSelectedMonth(nextMonth);
    setSelectedYear(nextYear);
    onMonthChange?.(nextYear, nextMonth);
  };

  const monthName = new Date(selectedYear, selectedMonth - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const daysInMonth = new Date(selectedYear, selectedMonth, 0).getDate();
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const monthKey = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;

  // Dynamically combine assignments from localDb for the active selectedYear & selectedMonth (plus adjacent months for Day 1 Duty Off & cross-month AL/CL leave streak detection)
  const effectiveAssignments = useMemo(() => {
    const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
    const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

    const nextYear = selectedMonth === 12 ? selectedYear + 1 : selectedYear;
    const nextMonth = selectedMonth === 12 ? 1 : selectedMonth + 1;
    const nextMonthKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

    const dedup = new Map<string, DutyAssignment>();
    const addItems = (list?: DutyAssignment[]) => {
      if (!Array.isArray(list)) return;
      list.forEach((a) => {
        if (!a || !a.date || (a as any).isDeleted) return;
        const dStr = String(a.date);
        if (!dStr.startsWith(monthKey) && !dStr.startsWith(prevMonthKey) && !dStr.startsWith(nextMonthKey)) return;
        const key = `${a.airmanId}_${dStr}_${a.dutyCode}_${a.idaShift || ''}_${a.disposalScope || 'ALL'}`;
        dedup.set(key, a);
      });
    };

    try {
      addItems(localDb.getRoster(monthKey).assignments);
      addItems(localDb.getRoster(prevMonthKey).assignments);
      addItems(localDb.getRoster(nextMonthKey).assignments);
    } catch {}
    addItems(assignments);

    return Array.from(dedup.values());
  }, [assignments, selectedYear, selectedMonth, monthKey, dbRefreshTick]);

  const availableRanks = useMemo(() => {
    const rankOrder = ['MWO', 'SWO', 'WO', 'Sgt', 'Cpl', 'LCpl', 'LAC', 'AC-1', 'AC-2', 'AC'];
    const presentRanks = new Set<string>(
      airmen
        .filter((a) => isAirmanInUnitForMonth(a, selectedYear, selectedMonth))
        .map((a) => formatRank(a.rank))
    );
    const ordered = rankOrder.filter((r) => presentRanks.has(r));
    presentRanks.forEach((r) => {
      if (!ordered.includes(r) && r) ordered.push(r);
    });
    return ordered;
  }, [airmen, selectedYear, selectedMonth]);

  // Filter airmen based on:
  // 1. Belonging to unit during selected month/year (joinDate <= monthEnd && leftDate >= monthStart && active status)
  // 2. Selected flight
  // 3. Selected rank (Rank & Below logic)
  const filteredAirmen = useMemo(() => {
    return airmen.filter((a) => {
      if (!isAirmanInUnitForMonth(a, selectedYear, selectedMonth)) {
        return false;
      }
      if (selectedFlight !== 'All') {
        if (officeHasFlights) {
          const fltFull = formatFlightFullName(a.flightName);
          if (fltFull !== selectedFlight && a.flightName !== selectedFlight) return false;
        } else {
          if (a.trade !== selectedFlight && a.flightName !== selectedFlight) return false;
        }
      }
      if (selectedRank !== 'All') {
        const selectedTier = getRankTier(selectedRank);
        const airmanTier = getRankTier(a.rank);
        if (airmanTier < selectedTier) return false;
      }
      return true;
    });
  }, [airmen, selectedFlight, selectedRank, selectedYear, selectedMonth, officeHasFlights]);

  const assignmentMap = useMemo(() => {
    const map = new Map<string, DutyAssignment>();
    effectiveAssignments.forEach((ass) => addAssignmentToMap(map, ass));
    return map;
  }, [effectiveAssignments]);

  const statsList = useMemo(() => {
    return calculateDutyStats(filteredAirmen, effectiveAssignments, selectedYear, selectedMonth);
  }, [filteredAirmen, effectiveAssignments, selectedYear, selectedMonth]);

  const statsMap = useMemo(() => {
    return new Map(statsList.map((s) => [s.airmanId, s]));
  }, [statsList]);

  // Helper to resolve specific duty off (e.g. NTF OFF), other disposal, or joining date status (matches MonthlyDutyRegister 100%)
  const resolveDutyLabel = (airman: Airman, day: number) => {
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    const dateStr = `${monthKey}-${dayStr}`;

    // If airman reported/joined unit after this date, they are NOT in unit yet -> show "-"
    const joinDate = getAirmanJoinDateISO(airman);
    if (joinDate && dateStr < joinDate) {
      return { label: '-', type: 'NOT_JOINED' };
    }
    // If airman left unit before this date -> show "-"
    const leftDate = getAirmanLeftDateISO(airman);
    if (leftDate && dateStr > leftDate) {
      return { label: '-', type: 'LEFT' };
    }

    const ass = resolveAirmanDutyForDate(airman.id, dateStr, assignmentMap);
    const dutyCode = ass?.dutyCode;
    const dutyType = DUTY_TYPE_MAP.get(dutyCode as any);
    const dutyCodeStr = String(dutyCode || '');
    const isOtherDisposal =
      dutyCodeStr.toUpperCase() === 'OTHERS' ||
      dutyCodeStr.toUpperCase() === 'OTHER' ||
      dutyCodeStr.startsWith('OTHERS_');

    if (dutyCode === 'ON_PARADE' || dutyType?.shortName === 'PRD' || dutyType?.shortName === 'P') {
      return { label: 'P', type: 'PRESENT' };
    }

    // Any Deployment (Canteen, Bake & Bite, or Custom Deployment) is counted as present (On Parade)
    if (
      dutyCode === 'CANTEEN' ||
      (dutyCode as string) === 'CTN' ||
      dutyType?.shortName === 'CTN' ||
      ((dutyCode === 'DEPLOYMENT' || dutyCode === 'ATT') && (ass?.notes || '').toLowerCase().includes('canteen'))
    ) {
      return { label: 'CTN', type: 'PRESENT' };
    }
    if (
      dutyCode === 'BAKE_N_BITE' ||
      (dutyCode as string) === 'BnB' ||
      dutyType?.shortName === 'BnB' ||
      ((dutyCode === 'DEPLOYMENT' || dutyCode === 'ATT') && (ass?.notes || '').toLowerCase().includes('bake'))
    ) {
      return { label: 'BnB', type: 'PRESENT' };
    }
    if (dutyCode === 'DEPLOYMENT' || dutyCode === 'ATT') {
      const cleanNote = (ass?.notes || '').trim();
      const dest =
        cleanNote && !cleanNote.toLowerCase().includes('imported')
          ? cleanNote.split(' - ')[0].trim().toUpperCase()
          : 'ATT';
      return { label: dest, type: 'PRESENT' };
    }

    if (dutyCode === 'DUTY_OFF' || (dutyCode as any) === 'OFF') {
      let offDuty = '';
      if (ass?.notes) {
        const match = ass.notes.match(/\b(NTF|GD|SY|BTF|IDAC|IDA|AIRPORT|APT|AFLD|HALISHAHAR|HAL|ESCT|ESC|ESCORT)\b/i);
        if (match) offDuty = match[1].toUpperCase();
      }
      if (!offDuty) {
        const yestDate = new Date(selectedYear, selectedMonth - 1, day - 1);
        const yDateStr = `${yestDate.getFullYear()}-${String(yestDate.getMonth() + 1).padStart(2, '0')}-${String(yestDate.getDate()).padStart(2, '0')}`;
        const yestAss = resolveAirmanDutyForDate(airman.id, yDateStr, assignmentMap);
        if (yestAss && yestAss.dutyCode && !['ON_PARADE', 'DUTY_OFF', 'OFF'].includes(yestAss.dutyCode as any)) {
          offDuty = yestAss.dutyCode === 'IDA' ? 'IDAC' : yestAss.dutyCode;
        }
      }
      if (offDuty === 'GD' || offDuty === 'SECURITY') offDuty = 'SY';
      if (offDuty === 'AIRPORT' || offDuty === 'AIRFIELD' || offDuty === 'APT') offDuty = 'AFLD';
      if (offDuty === 'ESCORT' || offDuty === 'ESC' || offDuty?.includes('1794394') || (ass?.notes || '').toLowerCase().includes('escort')) offDuty = 'ESCT';
      return { label: offDuty ? `${offDuty}\nOff` : 'Off', type: 'OFF' };
    }

    if (dutyCode === 'IDAC' || dutyCode === 'IDA') {
      if ((ass?.notes || '').includes('IDAC A+C')) {
        return { label: 'IDAC\n"A+C"', type: 'DUTY' };
      }
      const s = (ass?.idaShift || '').toLowerCase();
      const shiftCode = s.startsWith('m') ? 'IDAC\n"A"' : s.startsWith('a') ? 'IDAC\n"B"' : 'IDAC\n"C"';
      return { label: shiftCode, type: 'DUTY' };
    }

    if (dutyCode === 'LEAVE') {
      const combined = `${ass?.notes || ''} ${(ass as any)?.dutyName || ''}`.toLowerCase();
      if (combined.includes('recreation') || combined.includes('(rl)') || /\brl\b/.test(combined) || combined.includes('rec leave') || combined.includes('rec.')) {
        return { label: 'RL', type: 'LEAVE' };
      }
      if (combined.includes('sick') || combined.includes('(sl)') || /\bsl\b/.test(combined) || combined.includes('medical')) {
        return { label: 'SL', type: 'LEAVE' };
      }
      if (combined.includes('annual') || combined.includes('(al)') || /\bal\b/.test(combined)) {
        return { label: 'AL', type: 'LEAVE' };
      }
      if (combined.includes('casual') || combined.includes('(cl)') || /\bcl\b/.test(combined)) {
        return { label: 'CL', type: 'LEAVE' };
      }
      // Check contiguous leave streak length around this day across month boundaries (span > 7 days => AL)
      let streakLen = 1;
      const baseUtcMs = Date.UTC(selectedYear, selectedMonth - 1, day);
      const dayMs = 86400000;
      const formatUtc = (ms: number) => {
        const dt = new Date(ms);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      };
      for (let step = 1; step <= 60; step++) {
        const dStr = formatUtc(baseUtcMs - step * dayMs);
        if (resolveAirmanDutyForDate(airman.id, dStr, assignmentMap)?.dutyCode === 'LEAVE') streakLen++;
        else break;
      }
      for (let step = 1; step <= 60; step++) {
        const dStr = formatUtc(baseUtcMs + step * dayMs);
        if (resolveAirmanDutyForDate(airman.id, dStr, assignmentMap)?.dutyCode === 'LEAVE') streakLen++;
        else break;
      }
      return { label: streakLen > 7 ? 'AL' : 'CL', type: 'LEAVE' };
    }
    if (dutyCode === 'TDY') return { label: 'TDY', type: 'TDY' };
    if (
      (dutyCode as any) === 'ESCORT' ||
      (dutyCode as any) === 'ESC' ||
      (dutyCode as any) === 'ESCT' ||
      dutyCodeStr.includes('1794394') ||
      dutyType?.name === 'Escort Duty' ||
      (ass?.notes || '').toLowerCase().includes('escort') ||
      ((ass as any)?.dutyName || '').toLowerCase().includes('escort')
    ) {
      return { label: 'ESCT', type: 'DUTY' };
    }
    if (dutyCode === 'GD' || (dutyCode as any) === 'SECURITY') return { label: 'SY', type: 'DUTY' };
    if (dutyCode === 'AIRPORT' || (dutyCode as any) === 'APT' || (dutyCode as any) === 'AIRFIELD' || (dutyCode as any) === 'AFLD') return { label: 'AFLD', type: 'DUTY' };

    if (isOtherDisposal) {
      const cleanNote = ass?.notes?.trim();
      const fallbackName = (ass as any)?.dutyName || (ass as any)?.customTitle;
      let name = '';
      if (cleanNote && !['OTHER', 'OTHERS', 'OTHER DISPOSAL', 'CUSTOM DISPOSAL', 'CUSTOM'].includes(cleanNote.toUpperCase())) {
        name = cleanNote;
      } else if (fallbackName && !['OTHER', 'OTHERS', 'OTHER DISPOSAL', 'CUSTOM DISPOSAL', 'CUSTOM'].includes(String(fallbackName).toUpperCase())) {
        name = String(fallbackName);
      } else if (typeof dutyCode === 'string' && dutyCode.startsWith('OTHERS_')) {
        name = dutyCode.replace('OTHERS_', '');
      } else {
        name = 'Disposal';
      }
      if (name.includes(' - ')) {
        name = name.split(' - ')[0].trim();
      }
      const upperName = name.toUpperCase().trim();
      const words = upperName.split(/\s+/);
      if (words.length === 2) {
        return { label: `${words[0]}\n${words[1]}`, type: 'DUTY' };
      }
      return { label: upperName, type: 'DUTY' };
    }

    let label = dutyType?.shortName || dutyCode || '-';
    if (label === 'APT' || label === 'AIRPORT' || label === 'AIRFIELD') label = 'AFLD';
    if (label === 'GD') label = 'SY';
    if (label === 'IDAC Nt' || label === 'IDAC NT' || label.includes('IDAC Nt')) label = 'IDAC\n"C"';
    if (label.includes(' OFF') || label.includes(' Off')) {
      label = label.replace(/\s+off/gi, '\nOff');
    }
    if (label.startsWith('APT')) label = label.replace(/^APT/, 'AFLD');
    if (label.startsWith('GD')) label = label.replace(/^GD/, 'SY');
    if (label.includes('IDAC Nt')) label = label.replace(/IDAC Nt/g, 'IDAC\n"C"');
    if (label.includes(' ') && !label.includes('\n')) {
      const parts = label.trim().split(/\s+/);
      if (parts.length === 2) label = `${parts[0]}\n${parts[1]}`;
    }
    return { label, type: 'DUTY' };
  };

  // Present days count for each airman (P and CTN both count as present / On Parade)
  const presentMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredAirmen.forEach((airman) => {
      let pCount = 0;
      daysArray.forEach((day) => {
        const info = resolveDutyLabel(airman, day);
        if (info.label === 'P' || info.label === 'CTN' || info.type === 'PRESENT') pCount++;
      });
      map.set(airman.id, pCount);
    });
    return map;
  }, [filteredAirmen, daysArray, monthKey, assignmentMap]);

  // Duty OFF count for each airman
  const dutyOffMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredAirmen.forEach((airman) => {
      let offCount = 0;
      daysArray.forEach((day) => {
        const info = resolveDutyLabel(airman, day);
        if (info.type === 'OFF' || info.label.toUpperCase().includes('OFF')) {
          offCount++;
        }
      });
      map.set(airman.id, offCount);
    });
    return map;
  }, [filteredAirmen, daysArray, monthKey, assignmentMap]);

  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const SHORT_MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const yearOptions = useMemo(() => {
    const base = new Date().getFullYear();
    const minY = Math.min(base - 2, selectedYear - 2, 2024);
    const maxY = Math.max(base + 2, selectedYear + 2);
    const yrs: number[] = [];
    for (let y = minY; y <= maxY; y++) yrs.push(y);
    return yrs;
  }, [selectedYear]);

  const computedRangeMonths = useMemo<AttendanceMonthSpec[]>(() => {
    const startVal = rangeFromYear * 12 + (rangeFromMonth - 1);
    const endVal = rangeToYear * 12 + (rangeToMonth - 1);
    if (startVal > endVal) return [];
    const list: AttendanceMonthSpec[] = [];
    for (let v = startVal; v <= endVal && list.length < 36; v++) {
      list.push({ year: Math.floor(v / 12), month: (v % 12) + 1 });
    }
    return list;
  }, [rangeFromYear, rangeFromMonth, rangeToYear, rangeToMonth]);

  const fetchAssignmentsForMonths = async (monthsList: AttendanceMonthSpec[]): Promise<DutyAssignment[]> => {
    const yearsSet = new Set<number>();
    monthsList.forEach(({ year: y, month: m }) => {
      yearsSet.add(y);
      if (m === 1) yearsSet.add(y - 1);
    });

    const dedup = new Map<string, DutyAssignment>();
    const addItems = (list?: DutyAssignment[]) => {
      if (!Array.isArray(list)) return;
      list.forEach((a) => {
        if (!a || !a.date || (a as any).isDeleted) return;
        const dStr = String(a.date);
        const key = `${a.airmanId}_${dStr}_${a.dutyCode}_${a.idaShift || ''}_${a.disposalScope || 'ALL'}`;
        dedup.set(key, a);
      });
    };

    const years = Array.from(yearsSet).sort((a, b) => a - b);
    await Promise.all(
      years.map(async (y) => {
        try {
          const res = await fetch(`/api/roster/year?year=${y}`);
          if (res.ok) {
            const data = await res.json();
            addItems(Array.isArray(data?.assignments) ? data.assignments : Array.isArray(data) ? data : []);
          }
        } catch {}
        try {
          addItems(localDb.getRosterYear(y).assignments);
        } catch {}
      })
    );
    addItems(assignments);
    return Array.from(dedup.values());
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportCurrentMonthExcel = () => {
    exportMonthlyAttendanceRegisterExcel(
      airmen,
      effectiveAssignments,
      selectedYear,
      selectedMonth,
      selectedFlight,
      selectedRank,
      `155_UASU_Attendance_Register_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.xlsx`
    );
    setShowExcelMenu(false);
  };

  const handleExportFullYearExcel = async () => {
    setIsExportingExcel(true);
    try {
      const fullYearMonths: AttendanceMonthSpec[] = Array.from({ length: 12 }, (_, idx) => ({
        year: exportFullYear,
        month: idx + 1,
      }));
      const allAss = await fetchAssignmentsForMonths(fullYearMonths);
      exportMultiMonthAttendanceRegisterExcel(
        airmen,
        allAss,
        fullYearMonths,
        selectedFlight,
        selectedRank,
        `155_UASU_Attendance_Register_${exportFullYear}_Full_Year.xlsx`
      );
      setShowExcelMenu(false);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleExportMonthRangeExcel = async () => {
    if (computedRangeMonths.length === 0) return;
    setIsExportingExcel(true);
    try {
      const allAss = await fetchAssignmentsForMonths(computedRangeMonths);
      const first = computedRangeMonths[0];
      const last = computedRangeMonths[computedRangeMonths.length - 1];
      const fileName =
        computedRangeMonths.length === 1
          ? `155_UASU_Attendance_Register_${first.year}_${String(first.month).padStart(2, '0')}.xlsx`
          : `155_UASU_Attendance_Register_${first.year}_${String(first.month).padStart(2, '0')}_to_${last.year}_${String(last.month).padStart(2, '0')}.xlsx`;
      exportMultiMonthAttendanceRegisterExcel(
        airmen,
        allAss,
        computedRangeMonths,
        selectedFlight,
        selectedRank,
        fileName
      );
      setShowExcelMenu(false);
    } finally {
      setIsExportingExcel(false);
    }
  };

  if (!isOpen) return null;

  // Dedicated Full-Screen Excel Export Page (Mobile & Desktop optimized — nothing else visible behind it)
  if (showExcelMenu) {
    return createPortal(
      <div className="fixed inset-0 z-50 bg-slate-950 text-white overflow-y-auto flex flex-col print:hidden">
        {/* Sticky Top Bar */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 px-3 sm:px-6 py-3 flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowExcelMenu(false)}
            disabled={isExportingExcel}
            className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>

          <div className="flex items-center space-x-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-white truncate">Excel Export (.xlsx)</h2>
              <p className="text-[11px] text-slate-400 truncate">{getActiveOfficeIdentity().officeName} • Attendance Register</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowExcelMenu(false);
              onClose();
            }}
            disabled={isExportingExcel}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Centered Mobile-Optimized Content */}
        <div className="w-full max-w-lg mx-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 flex-1">
          {/* Active Export Filters (Editable right here on mobile) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 space-y-2.5">
            <div className="flex items-center space-x-2 text-xs font-bold text-slate-300">
              <Filter className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span>Export Scope Filters</span>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
                  {officeHasFlights ? 'Flight' : 'Trade'}
                </label>
                <select
                  value={selectedFlight}
                  onChange={(e) => setSelectedFlight(e.target.value)}
                  className="w-full bg-slate-950 text-xs font-bold text-white border border-slate-700 rounded-xl px-2.5 py-2.5 outline-hidden focus:border-emerald-500 cursor-pointer"
                >
                  <option value="All">{officeHasFlights ? 'All Flights' : 'All Trades'}</option>
                  {officeHasFlights ? (
                    <>
                      <option value="Admin">Admin</option>
                      <option value="Mechanics">Mechanics</option>
                      <option value="Avionics">Avionics</option>
                      <option value="GCS">GCS</option>
                    </>
                  ) : (
                    biodataTrades.map((tr) => (
                      <option key={tr} value={tr}>
                        {tr}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Rank</label>
                <select
                  value={selectedRank}
                  onChange={(e) => setSelectedRank(e.target.value)}
                  className="w-full bg-slate-950 text-xs font-bold text-white border border-slate-700 rounded-xl px-2.5 py-2.5 outline-hidden focus:border-emerald-500 cursor-pointer"
                >
                  <option value="All">All Ranks</option>
                  {availableRanks.map((rk) => (
                    <option key={rk} value={rk}>
                      {rk} & Below
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Option 1: Current Month Only */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0">
                  <Calendar className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">Current Month Only</h3>
                  <p className="text-xs text-slate-400">Single sheet • {monthName}</p>
                </div>
              </div>
              <span className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0">
                1 Sheet
              </span>
            </div>
            <button
              type="button"
              onClick={handleExportCurrentMonthExcel}
              disabled={isExportingExcel}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer shadow-md disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Export {monthName}</span>
            </button>
          </div>

          {/* Option 2: Full Year (12 Month-wise Sheets) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-400 flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-white">Full Year (Month-wise Sheets)</h3>
                  <p className="text-xs text-slate-400">Jan – Dec in 1 Excel file (12 separate sheets)</p>
                </div>
              </div>
              <span className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0">
                12 Sheets
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <select
                value={exportFullYear}
                onChange={(e) => setExportFullYear(Number(e.target.value))}
                className="sm:w-32 bg-slate-950 text-sm font-bold text-white border border-slate-700 rounded-xl px-3 py-2.5 outline-hidden focus:border-sky-500 cursor-pointer"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleExportFullYearExcel}
                disabled={isExportingExcel}
                className="flex-1 flex items-center justify-center space-x-2 px-4 py-3 bg-sky-600 hover:bg-sky-500 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer shadow-md disabled:opacity-50"
              >
                {isExportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                <span>Export Full Year ({exportFullYear})</span>
              </button>
            </div>
          </div>

          {/* Option 3: From Month to Month (Separate Sheet per Month) */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3.5">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">From Month to Month</h3>
                <p className="text-xs text-slate-400">Separate sheet for each month in 1 Excel file</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">From Month</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={rangeFromMonth}
                    onChange={(e) => setRangeFromMonth(Number(e.target.value))}
                    className="w-full bg-slate-950 text-xs sm:text-sm font-bold text-white border border-slate-700 rounded-xl px-2.5 py-2.5 outline-hidden focus:border-emerald-500 cursor-pointer"
                  >
                    {MONTH_LABELS.map((mName, idx) => (
                      <option key={mName} value={idx + 1}>{mName}</option>
                    ))}
                  </select>
                  <select
                    value={rangeFromYear}
                    onChange={(e) => setRangeFromYear(Number(e.target.value))}
                    className="w-full bg-slate-950 text-xs sm:text-sm font-bold text-white border border-slate-700 rounded-xl px-2.5 py-2.5 outline-hidden focus:border-emerald-500 cursor-pointer"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">To Month</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={rangeToMonth}
                    onChange={(e) => setRangeToMonth(Number(e.target.value))}
                    className="w-full bg-slate-950 text-xs sm:text-sm font-bold text-white border border-slate-700 rounded-xl px-2.5 py-2.5 outline-hidden focus:border-emerald-500 cursor-pointer"
                  >
                    {MONTH_LABELS.map((mName, idx) => (
                      <option key={mName} value={idx + 1}>{mName}</option>
                    ))}
                  </select>
                  <select
                    value={rangeToYear}
                    onChange={(e) => setRangeToYear(Number(e.target.value))}
                    className="w-full bg-slate-950 text-xs sm:text-sm font-bold text-white border border-slate-700 rounded-xl px-2.5 py-2.5 outline-hidden focus:border-emerald-500 cursor-pointer"
                  >
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {computedRangeMonths.length === 0 ? (
              <div className="text-xs font-bold text-rose-300 bg-rose-950/50 border border-rose-800/70 rounded-xl px-3 py-2">
                "From Month" must be earlier than or equal to "To Month".
              </div>
            ) : (
              <div className="text-xs font-semibold text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-3 py-2 flex items-center justify-between">
                <span>
                  {SHORT_MONTH_LABELS[computedRangeMonths[0].month - 1]} {computedRangeMonths[0].year}
                  {computedRangeMonths.length > 1
                    ? ` → ${SHORT_MONTH_LABELS[computedRangeMonths[computedRangeMonths.length - 1].month - 1]} ${computedRangeMonths[computedRangeMonths.length - 1].year}`
                    : ''}
                </span>
                <span className="font-black">
                  {computedRangeMonths.length} {computedRangeMonths.length === 1 ? 'Sheet' : 'Sheets'}
                </span>
              </div>
            )}

            <button
              type="button"
              onClick={handleExportMonthRangeExcel}
              disabled={isExportingExcel || computedRangeMonths.length === 0}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isExportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              <span>
                Export Month Range ({computedRangeMonths.length} {computedRangeMonths.length === 1 ? 'Sheet' : 'Sheets'})
              </span>
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-start p-2 sm:p-5 print:p-0 print:bg-white print:overflow-visible">
      {/* Top action toolbar (hidden on print) */}
      <div className="w-full max-w-[1350px] bg-slate-900 border border-slate-700/80 rounded-2xl px-3 sm:px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 text-white shadow-2xl shrink-0 print:hidden">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold shrink-0">
            <Printer className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-black text-white">
              {getActiveOfficeIdentity().officeName} • Attendance Register Preview
            </h2>
            <p className="text-xs text-slate-300 font-medium">
              {monthName} • {filteredAirmen.length} Airmen displayed
            </p>
          </div>
        </div>

        {/* Filter Controls: Month Navigator with Left/Right Arrows (Pic 2 style) + Flight & Rank */}
        <div className="w-full lg:w-auto flex flex-wrap items-center gap-2 sm:gap-3 bg-slate-800/80 p-2 px-3 rounded-xl border border-slate-700">
          <div className="flex items-center space-x-1.5 text-xs text-slate-300">
            <Filter className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold hidden lg:inline">Filters:</span>
          </div>

          {/* Month Navigator with Left/Right Arrows like Pic 2 */}
          <div className="flex items-center bg-slate-900 border border-slate-600 rounded-lg p-0.5 shadow-inner">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded-md transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2.5 text-xs font-black text-white whitespace-nowrap min-w-[115px] text-center select-none">
              {monthName}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded-md transition-colors cursor-pointer"
              title="Next Month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Flight/Trade Dropdown */}
          <div className="flex items-center space-x-1">
            <label className="text-[11px] text-slate-400 font-medium">{officeHasFlights ? 'Flt:' : 'Trade:'}</label>
            <select
              value={selectedFlight}
              onChange={(e) => setSelectedFlight(e.target.value)}
              className="bg-slate-900 text-xs font-bold text-white border border-slate-600 rounded-lg px-2 py-1 outline-hidden focus:border-emerald-500 cursor-pointer"
            >
              <option value="All">{officeHasFlights ? 'All Flights' : 'All Trades'}</option>
              {officeHasFlights ? (
                <>
                  <option value="Admin">Admin</option>
                  <option value="Mechanics">Mechanics</option>
                  <option value="Avionics">Avionics</option>
                  <option value="GCS">GCS</option>
                </>
              ) : (
                biodataTrades.map((tr) => (
                  <option key={tr} value={tr}>
                    {tr}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Rank Dropdown */}
          <div className="flex items-center space-x-1">
            <label className="text-[11px] text-slate-400 font-medium">Rank:</label>
            <select
              value={selectedRank}
              onChange={(e) => setSelectedRank(e.target.value)}
              className="bg-slate-900 text-xs font-bold text-white border border-slate-600 rounded-lg px-2 py-1 outline-hidden focus:border-emerald-500 cursor-pointer"
            >
              <option value="All">All Ranks</option>
              {availableRanks.map((rk) => (
                <option key={rk} value={rk}>
                  {rk} & Below
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowExcelMenu(true)}
            disabled={isExportingExcel}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white border border-emerald-500/50 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md disabled:opacity-60"
            title="Open Excel Export Options (.xlsx)"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={handlePrint}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-black transition-all cursor-pointer shadow-md"
            title="Print or Save as PDF"
          >
            <Printer className="w-4 h-4" />
            <span>Print / PDF</span>
          </button>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer shrink-0"
            title="Close Preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Printable Sheet (Standard clean white document landscape format, A4 fit) */}
      <div className="attendance-register-print w-full max-w-[1400px] bg-white text-slate-900 rounded-xl shadow-2xl p-3 sm:p-4 print:p-0 print:shadow-none print:w-full print:max-w-none print:rounded-none">
        <PrintConfidentialShell showOnScreen>
        {/* Document Header as requested:
            Heading: 155 UASU, BAF (BOLD)
            Attendance Register
            Month underneath */}
        <div className="text-center pb-1.5 mb-2 border-b-2 border-slate-900">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-slate-900 print:text-base">
            {getActiveOfficeIdentity().officeName}
          </h1>
          <h2 className="text-base sm:text-lg font-black uppercase underline underline-offset-4 tracking-wide text-slate-900 mt-0.5 print:text-xs">
            ATTENDANCE REGISTER
          </h2>
          <p className="text-sm font-bold text-slate-800 mt-0.5 print:text-[10px]">
            Month: {monthName}
          </p>
        </div>

        {/* Main Attendance Table (Clean styling: no alternating colors, black/gray borders, table-fixed for 1-page fit) */}
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[960px] print:min-w-0 border-collapse border border-slate-900 table-fixed text-[9px] print:text-[6px] print:leading-[7px]">
            <colgroup>
              <col style={{ width: '2.2%' }} />
              <col style={{ width: '4.8%' }} />
              <col style={{ width: '3.6%' }} />
              <col style={{ width: '7.4%' }} />
              <col style={{ width: '4.6%' }} />
              {daysArray.map((day) => (
                <col key={day} style={{ width: `${52.4 / daysInMonth}%` }} />
              ))}
              <col style={{ width: '2.8%' }} />
              <col style={{ width: '2.0%' }} />
              <col style={{ width: '2.0%' }} />
              <col style={{ width: '2.0%' }} />
              <col style={{ width: '2.0%' }} />
              <col style={{ width: '2.0%' }} />
              <col style={{ width: '2.2%' }} />
              <col style={{ width: '2.2%' }} />
              <col style={{ width: '2.2%' }} />
              <col style={{ width: '2.7%' }} />
              <col style={{ width: '2.9%' }} />
            </colgroup>
            <thead>
              <tr className="bg-slate-100 text-slate-900 font-bold border-b-2 border-slate-900 text-center">
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 print:p-0">SER</th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 print:p-0">BD NO</th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 print:p-0">RANK</th>
                <th className="border border-slate-900 py-1 px-1 text-left bg-slate-100 text-slate-900 print:p-0 truncate">NAME</th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 print:p-0">FLT</th>

                {/* Day Columns (No weekend coloring as requested) */}
                {daysArray.map((day) => {
                  const dObj = new Date(selectedYear, selectedMonth - 1, day);
                  const dayOfWeek = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dObj.getDay()];
                  return (
                    <th
                      key={day}
                      className="border border-slate-900 py-1 px-0 bg-slate-100 text-slate-900 font-bold print:p-0"
                    >
                      <div>{day}</div>
                      <div className="text-[7.5px] print:text-[5px] font-bold text-slate-600">{dayOfWeek}</div>
                    </th>
                  );
                })}

                {/* Summary Right Columns */}
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="On Parade">
                  On Parade
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Security Duty (SY)">
                  SY
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Base Taskforce (BTF)">
                  BTF
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Najirpara Taskforce (NTF)">
                  NTF
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Halishahar (HAL)">
                  HAL
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Airfield (AFLD)">
                  AFLD
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="IDAC Shift A">
                  IDAC "A"
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="IDAC Shift B">
                  IDAC "B"
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="IDAC Shift C">
                  IDAC "C"
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Duty OFF Count">
                  Duty OFF
                </th>
                <th className="border border-slate-900 py-1 px-0.5 bg-slate-100 text-slate-900 font-bold print:p-0 leading-tight" title="Total Duties Performed">
                  Total Duty
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAirmen.map((airman, idx) => {
                const stat = statsMap.get(airman.id);
                const pCount = presentMap.get(airman.id) ?? 0;
                const dutyOffCount = dutyOffMap.get(airman.id) ?? 0;

                return (
                  <tr key={`${airman.id}-${idx}`} className="border-b border-slate-900">
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {idx + 1}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold whitespace-nowrap bg-white text-slate-900 print:p-0">
                      {airman.bdNo}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-bold bg-white text-slate-900 print:p-0">
                      {formatRank(airman.rank)}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-1 font-bold text-left whitespace-nowrap truncate bg-white text-slate-900 print:p-0">
                      {airman.name || airman.fullName}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-bold whitespace-nowrap bg-white text-slate-900 print:p-0">
                      {formatFlightFullName(airman.flightName)}
                    </td>

                    {/* Day Cells (Clean white background, whitespace-pre-line so BTF\nOFF wraps) */}
                    {daysArray.map((day) => {
                      const info = resolveDutyLabel(airman, day);

                      return (
                        <td
                          key={day}
                          className="border border-slate-900 py-0.5 px-0 text-center font-mono font-bold leading-none bg-white text-slate-900 text-[8.5px] print:text-[5.5px] print:leading-[6.5px] whitespace-pre-line print:p-0"
                        >
                          {info.label}
                        </td>
                      );
                    })}

                    {/* Summary Counters */}
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {pCount}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalGD || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalBTF || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalNTF || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalHalishahar || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalAirport || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalIDACMorning || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalIDACAfternoon || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalIDACNight || 0}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {dutyOffCount}
                    </td>
                    <td className="border border-slate-900 py-0.5 px-0.5 text-center font-mono font-bold bg-white text-slate-900 print:p-0">
                      {stat?.totalDutyCount || 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </PrintConfidentialShell>
      </div>
    </div>,
    document.body
  );
};

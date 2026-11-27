import React, { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DutyRatioTable, getStoredDutyMatrix } from '../data/officialDutyRatioMatrix';
import { FlightName } from '../types';
import { X, Download, FileSpreadsheet, FileText, ChevronDown, CheckSquare, Square, Filter } from 'lucide-react';
import { exportDutyRatioMatrixExcel, exportManpowerAndNominalRollExcel, exportFlightDutyScheduleExcel } from '../utils/csvExport';
import { exportElementToPdf } from '../utils/pdfExport';
import { getMarginSpec } from '../utils/pageSetup';
import { PaginatedPaperPreview } from './PaginatedPaperPreview';
import { DUTY_TYPE_MAP } from '../data/dutyTypes';
import { localDb } from '../services/localDatabase';
import { calculateExactDutyRatios, roundDutyByRule } from '../utils/dutyDistribution';
import { getActiveOfficeIdentity } from '../firebase';
import { matchAirmanId } from '../utils/airmanDisposalHelper';

export function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${day} ${months[now.getMonth()]} ${String(now.getFullYear()).slice(-2)}`;
  }
  try {
    const trimmed = dateStr.trim();
    const parts = trimmed.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
      const year = parts[0].slice(-2);
      const monthNum = parseInt(parts[1], 10);
      const day = parts[2].padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthName = months[monthNum - 1] || parts[1];
      return `${day} ${monthName} ${year}`;
    }
    if (trimmed.includes('/') || (trimmed.includes('-') && trimmed.split('-')[0].length <= 2)) {
      const sep = trimmed.includes('/') ? '/' : '-';
      const p = trimmed.split(sep);
      if (p.length === 3) {
        const day = p[0].padStart(2, '0');
        const monthNum = parseInt(p[1], 10);
        const year = p[2].slice(-2);
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const monthName = months[monthNum - 1] || p[1];
        return `${day} ${monthName} ${year}`;
      }
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const day = String(d.getDate()).padStart(2, '0');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${day} ${months[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
    }
    return dateStr;
  } catch {
    return dateStr;
  }
}

const getMatrixCellBg = (rowIdx: number, dayNum: number, val?: number) => {
  const isRowAlt = rowIdx % 2 === 1;
  const isColAlt = dayNum % 2 === 0;
  if (val !== undefined && val > 0) {
    if (isRowAlt && isColAlt) return '#bbf7d0'; // emerald-200
    if (isRowAlt) return '#dcfce7'; // emerald-100
    if (isColAlt) return '#d1fae5'; // emerald-100 alt
    return '#ecfdf5'; // emerald-50
  }
  if (isRowAlt && isColAlt) return '#e2e8f0'; // row alt + col alt
  if (isRowAlt) return '#f1f5f9'; // row alt
  if (isColAlt) return '#f8fafc'; // col alt
  return '#ffffff'; // base
};

export function getEligibleRankDisplay(t: DutyRatioTable): string {
  const ranks = t.eligibleRanks || (t.dutyCode ? DUTY_TYPE_MAP.get(t.dutyCode as any)?.eligibleRanks : undefined);
  if (ranks && ranks.length > 0) {
    if (!ranks.includes('Sgt' as any) && (ranks.includes('Cpl' as any) || ranks.includes('LAC' as any))) {
      return 'Cpl & Below';
    }
    if (ranks.includes('Sgt' as any) && !ranks.includes('WO' as any) && !ranks.includes('MWO' as any)) {
      return 'Sgt & Below';
    }
    if (ranks.includes('MWO' as any) || ranks.includes('WO' as any)) {
      return 'All Ranks';
    }
    return ranks[0] + ' & Below';
  }
  return t.id === 'security_duty' ? 'Cpl & Below' : 'Sgt & Below';
}

export function getEligibleFlightDisplay(t: DutyRatioTable): string {
  const flts = t.eligibleFlights || (t.dutyCode ? DUTY_TYPE_MAP.get(t.dutyCode as any)?.eligibleFlights : undefined);
  if (!flts || flts.length === 0) return 'All Flt';
  const all: FlightName[] = ['Mechanics', 'Avionics', 'GCS', 'Admin'];
  if (all.every(f => flts.includes(f))) {
    return 'All Flt';
  }
  return flts.map(f => {
    if (f === 'Mechanics') return 'Mech';
    if (f === 'Avionics') return 'Avi';
    return f;
  }).join(', ');
}

interface PrintableDutyRatioModalProps {
  matrix: DutyRatioTable[];
  selectedFlightFilter: FlightName | 'Overall';
  onClose: () => void;
  exportMode?: 'ALL' | 'DUTY_RATIO_ONLY' | 'MANPOWER_ONLY';
  targetDate?: string;
}

export const PrintableDutyRatioModal: React.FC<PrintableDutyRatioModalProps> = ({
  matrix: rawMatrix,
  selectedFlightFilter,
  onClose,
  exportMode = 'ALL',
  targetDate,
}) => {
  // Completely filter out any disabled duties from Duty List so they never appear in print
  const matrix = useMemo(() => {
    const baseList = (rawMatrix && rawMatrix.length > 0) ? rawMatrix : getStoredDutyMatrix();
    
    // Cross-check localStorage metadata for any disabled duties
    const disabledKeys = new Set<string>();
    try {
      const metaRaw = localStorage.getItem('baf_duty_matrix_metadata');
      if (metaRaw) {
        const parsed = JSON.parse(metaRaw);
        if (Array.isArray(parsed)) {
          parsed.forEach((m: any) => {
            const isDis = m.isDisabled === true || String(m.isDisabled) === 'true' ||
              m.is_disabled === true || String(m.is_disabled) === 'true' ||
              String(m.status || '').toLowerCase() === 'disable' ||
              String(m.status || '').toLowerCase() === 'disabled';
            if (isDis) {
              if (m.id) disabledKeys.add(String(m.id).toLowerCase());
              if (m.dutyCode) disabledKeys.add(String(m.dutyCode).toLowerCase());
              if (m.title) disabledKeys.add(String(m.title).trim().toLowerCase());
            }
          });
        }
      }
    } catch {}

    return baseList.filter(t => {
      if (!t) return false;
      if (t.isDisabled === true || String(t.isDisabled) === 'true') return false;
      if ((t as any).is_disabled === true || String((t as any).is_disabled) === 'true') return false;
      const status = String((t as any).status || (t as any).Status || '').trim().toLowerCase();
      if (status === 'disable' || status === 'disabled' || status === 'inactive') return false;
      if ((t as any).active === false || String((t as any).active) === 'false') return false;
      
      const idKey = String(t.id || '').toLowerCase();
      const codeKey = String(t.dutyCode || '').toLowerCase();
      const titleKey = String(t.title || '').trim().toLowerCase();
      if (disabledKeys.has(idKey) || disabledKeys.has(codeKey) || disabledKeys.has(titleKey)) {
        return false;
      }
      return true;
    });
  }, [rawMatrix]);

  const daysArray = Array.from({ length: 31 }, (_, i) => i + 1);

  const [currentFlightFilter, setCurrentFlightFilter] = useState<FlightName | 'Overall'>(
    selectedFlightFilter || 'Overall'
  );

  // Default Page Setup orientation is Landscape for 31-day Duty Ratio Matrix
  const [pageOrientation, setPageOrientation] = useState<'portrait' | 'landscape'>('landscape');
  const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
  const isExportingRef = useRef<boolean>(false);
  const exportDropdownRef = useRef<HTMLDivElement | null>(null);
  const narrowMargin = getMarginSpec('narrow');

  useEffect(() => {
    if (!showExportMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowExportMenu(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showExportMenu]);

  useEffect(() => {
    return () => {
      const el = document.getElementById('baf-duty-ratio-print-page-style');
      if (el) el.remove();
    };
  }, []);

  useEffect(() => {
    setCurrentFlightFilter(selectedFlightFilter || 'Overall');
  }, [selectedFlightFilter]);

  const isFlightFiltered = Boolean(currentFlightFilter && currentFlightFilter !== 'Overall');

  // Section inclusion filter states
  const [showDutyRatio, setShowDutyRatio] = useState<boolean>(exportMode !== 'MANPOWER_ONLY');
  const [showManpower, setShowManpower] = useState<boolean>(exportMode === 'ALL' || exportMode === 'MANPOWER_ONLY');
  const [showDistribution, setShowDistribution] = useState<boolean>(exportMode === 'ALL');
  const [showTotalDuty, setShowTotalDuty] = useState<boolean>(exportMode === 'ALL');
  const [showNominalRoll, setShowNominalRoll] = useState<boolean>(exportMode === 'MANPOWER_ONLY');

  // Sync if exportMode prop changes externally
  useEffect(() => {
    if (exportMode === 'DUTY_RATIO_ONLY') {
      setShowDutyRatio(true);
      setShowManpower(false);
      setShowDistribution(false);
      setShowTotalDuty(false);
      setShowNominalRoll(false);
    } else if (exportMode === 'MANPOWER_ONLY') {
      setShowDutyRatio(false);
      setShowManpower(true);
      setShowDistribution(false);
      setShowTotalDuty(false);
      setShowNominalRoll(true);
    } else {
      setShowDutyRatio(true);
      setShowManpower(true);
      setShowDistribution(true);
      setShowTotalDuty(true);
      setShowNominalRoll(false);
    }
  }, [exportMode]);

  // Active preset computation
  const activePreset = useMemo(() => {
    if (showDutyRatio && !showManpower && !showDistribution && !showTotalDuty && !showNominalRoll) {
      return 'DUTY_RATIO';
    }
    if (!showDutyRatio && showManpower && !showDistribution && !showTotalDuty && showNominalRoll) {
      return 'MANPOWER';
    }
    if (showDutyRatio && showManpower && showDistribution && showTotalDuty && !showNominalRoll) {
      return 'ALL';
    }
    return 'CUSTOM';
  }, [showDutyRatio, showManpower, showDistribution, showTotalDuty, showNominalRoll]);

  const applyPreset = (preset: 'ALL' | 'DUTY_RATIO' | 'MANPOWER') => {
    if (preset === 'ALL') {
      setShowDutyRatio(true);
      setShowManpower(true);
      setShowDistribution(true);
      setShowTotalDuty(true);
      setShowNominalRoll(false);
    } else if (preset === 'DUTY_RATIO') {
      setShowDutyRatio(true);
      setShowManpower(false);
      setShowDistribution(false);
      setShowTotalDuty(false);
      setShowNominalRoll(false);
    } else if (preset === 'MANPOWER') {
      setShowDutyRatio(false);
      setShowManpower(true);
      setShowDistribution(false);
      setShowTotalDuty(false);
      setShowNominalRoll(true);
    }
  };

  const flightMonthTotal = useMemo(() => {
    if (!isFlightFiltered) return 0;
    return matrix
      .filter(t => !t.isDisabled)
      .reduce((total, table) => {
        const rowData = table.data[currentFlightFilter as FlightName] || [];
        return total + rowData.reduce((a, b) => a + b, 0);
      }, 0);
  }, [matrix, currentFlightFilter, isFlightFiltered]);

  const getPageMainTitle = () => {
    if (isFlightFiltered) {
      return `OFFICIAL ${currentFlightFilter.toUpperCase()} DUTY SCHEDULE`;
    }
    if (showDutyRatio && !showManpower && !showDistribution && !showTotalDuty) {
      return 'OFFICIAL DUTY RATIO MATRIX';
    }
    if (!showDutyRatio && (showManpower || showNominalRoll) && !showDistribution) {
      return 'OFFICIAL EFFECTIVE MANPOWER & NOMINAL ROLL';
    }
    if (showDutyRatio && showDistribution && !showManpower) {
      return 'OFFICIAL DUTY RATIO & DISTRIBUTION MATRIX';
    }
    return 'ALL DUTIES & DUTY RATIO';
  };

  const getPdfTitle = () => {
    const displayDt = formatDisplayDate(targetDate);
    return `Duty Ratio - ${getActiveOfficeIdentity().officeName} (Dt - ${displayDt})`;
  };

  const handleExportPdf = async () => {
    setShowExportMenu(false);
    if (isExportingRef.current) return;
    isExportingRef.current = true;
    try {
      const fileName = `${getPdfTitle()}.pdf`;
      await exportElementToPdf({
        elementId: 'print-duty-ratio-content',
        fileName,
        format: 'a4',
        orientation: pageOrientation,
        marginMm: narrowMargin.marginMm,
        preserveColors: true,
      });
    } catch (err) {
      console.error('Error generating Duty Ratio PDF:', err);
    } finally {
      isExportingRef.current = false;
    }
  };
  
  // Get manpower from local storage as calculated by the main view
  const currentManpowerStr = localStorage.getItem('baf_duty_distribution_manpower');
  const currentManpower = currentManpowerStr ? JSON.parse(currentManpowerStr) : {
    mechSgt: 5, mechCpl: 6,
    aviSgt: 4, aviCpl: 3,
    gcsSgt: 5, gcsCpl: 6,
    adminSgt: 0, adminCpl: 1,
  };
  
  const totalSgt = currentManpower.mechSgt + currentManpower.aviSgt + currentManpower.gcsSgt + currentManpower.adminSgt;
  const totalCpl = currentManpower.mechCpl + currentManpower.aviCpl + currentManpower.gcsCpl + currentManpower.adminCpl;
  const totalSgtAndBelow = totalSgt + totalCpl;

  // Load nominal roll airmen for manpower & nominal roll view
  const nominalRollAirmen = useMemo(() => {
    const allAirmen = localDb.getAirmen().filter(a => a.active);
    const sgtAndBelow = allAirmen.filter(a => !['MWO', 'SWO', 'WO'].includes(a.rank));

    const effectiveDate = targetDate || localStorage.getItem('baf_duty_distribution_target_date') || '';
    const savedDisposalsStr = localStorage.getItem('baf_duty_distribution_disposals_master') || localStorage.getItem('baf_duty_distribution_disposals_' + (effectiveDate || 'default'));
    const savedDisposals = savedDisposalsStr ? JSON.parse(savedDisposalsStr) : {};

    const assignments = effectiveDate ? (localDb.getRoster(effectiveDate.substring(0, 7)).assignments || []).filter(a => a.date === effectiveDate) : [];

    return sgtAndBelow.map((a, idx) => {
      let defaultDisp = '-';
      const myAssignments = assignments.filter(assign => matchAirmanId(assign.airmanId, a.id));
      if (myAssignments.some(assign => assign.dutyCode === 'BAKE_N_BITE')) {
        defaultDisp = 'Bake & Bite';
      } else if (myAssignments.some(assign => assign.dutyCode === 'CANTEEN')) {
        defaultDisp = 'Canteen';
      } else if (myAssignments.some(assign => assign.dutyCode === 'TDY')) {
        defaultDisp = 'TDY (Air HQ)';
      } else if (a.rank === 'Sgt' && (a.trade === 'Sec Asst GD' || (a.trade && a.trade.toLowerCase().includes('sec asst')))) {
        defaultDisp = 'Orderly Room';
      } else if (a.rank === 'Sgt' && (a.trade === 'Admin asst' || a.trade === 'Admin Asst' || (a.trade && a.trade.toLowerCase().includes('admin asst')))) {
        defaultDisp = 'UWO';
      }

      let currentDisp = (savedDisposals[a.id] !== undefined && savedDisposals[a.id] !== '') ? savedDisposals[a.id] : defaultDisp;
      if (currentDisp === 'Deployment' || currentDisp === 'Deployment (Bake & Bite)' || currentDisp === 'Deployment (Canteen)') {
        currentDisp = defaultDisp;
      }
      if (currentDisp === 'TDY') {
        currentDisp = 'TDY (Air HQ)';
      }
      if (!currentDisp || currentDisp.trim() === '') {
        currentDisp = '-';
      }

      return {
        id: a.id,
        serNo: idx + 1,
        rank: a.rank,
        name: a.name,
        trade: a.trade,
        flightName: a.flightName,
        disposal: currentDisp,
      };
    });
  }, [targetDate]);

  const calculatedMatrixDistributions = useMemo(() => {
    if (!matrix) return {};
    const exactRatios = calculateExactDutyRatios(matrix, currentManpower);
    const result: Record<string, Record<string, { autoVal: number, exactVal: number }>> = {};
    const flights = ['Mechanics', 'Avionics', 'GCS', 'Admin'];

    matrix.forEach(t => {
      result[t.id] = {};
      flights.forEach(fl => {
        const exactVal = exactRatios[t.id]?.[fl as FlightName] ?? 0;
        const autoVal = roundDutyByRule(exactVal);
        result[t.id][fl] = { autoVal, exactVal };
      });
    });
    
    return result;
  }, [matrix, currentManpower]);

  const handleExportExcel = () => {
    setShowExportMenu(false);
    const displayDt = formatDisplayDate(targetDate);
    const fileName = `Duty Ratio - ${getActiveOfficeIdentity().officeName} (Dt - ${displayDt}).xlsx`;
    if (isFlightFiltered) {
      exportFlightDutyScheduleExcel(
        matrix,
        currentFlightFilter,
        displayDt,
        fileName
      );
    } else if (!showDutyRatio && (showManpower || showNominalRoll)) {
      const targetRoll = isFlightFiltered ? nominalRollAirmen.filter(a => a.flightName === currentFlightFilter) : nominalRollAirmen;
      exportManpowerAndNominalRollExcel(
        currentManpower,
        targetRoll,
        fileName
      );
    } else {
      exportDutyRatioMatrixExcel(matrix, fileName, undefined, displayDt);
    }
  };

  const handleCloseModal = () => {
    const el = document.getElementById('baf-duty-ratio-print-page-style');
    if (el) el.remove();
    onClose();
  };

  return createPortal(
    <div className={`fixed inset-0 z-[100] flex flex-col bg-slate-100 print:bg-white animate-fadeIn overflow-hidden print:static print:h-auto print:w-full print:overflow-visible print:block text-black ${pageOrientation === 'landscape' ? 'duty-ratio-print-landscape' : 'duty-ratio-print-portrait'}`} style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
      
      {/* Top Header Controls (Hidden on Print) */}
      <div className="flex-none bg-slate-900 border-b border-slate-700 px-4 py-3 shadow-2xl print:hidden z-10 sticky top-0 space-y-2.5">
        
        {/* Row 1: Left Title, Presets, Flight Filter, Right Action Buttons */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3">
          
          {/* Title & Close */}
          <div className="flex items-center space-x-3 text-white">
            <button
              onClick={handleCloseModal}
              className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer text-slate-400 hover:text-white"
              title="Close Print Preview"
            >
              <X className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xs sm:text-sm font-black tracking-wider uppercase text-white">
                {getPageMainTitle()}
              </h1>
              <p className="text-[10px] text-slate-400 font-mono">
                Official Export & Print Preview
              </p>
            </div>
          </div>

          {/* Quick Presets & Flight Filter */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Quick Presets */}
            <div className="flex items-center bg-slate-800/90 border border-slate-700 p-0.5 rounded-xl">
              <span className="text-[10px] font-bold text-slate-400 px-2 uppercase tracking-wider">Mode:</span>
              <button
                type="button"
                onClick={() => applyPreset('ALL')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activePreset === 'ALL' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Include All Sections (Summary, Manpower, Distribution, Duty Ratio)"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => applyPreset('DUTY_RATIO')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activePreset === 'DUTY_RATIO' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Only Duty Ratio Matrices"
              >
                Duty Ratio
              </button>
              <button
                type="button"
                onClick={() => applyPreset('MANPOWER')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activePreset === 'MANPOWER' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Only Manpower & Nominal Roll"
              >
                Manpower
              </button>
            </div>

            {/* Flight Filter */}
            <div className="flex items-center bg-slate-800/90 border border-slate-700 p-0.5 rounded-xl">
              <span className="text-[10px] font-bold text-slate-400 px-2 uppercase tracking-wider">Flight:</span>
              {(['Overall', 'Mechanics', 'Avionics', 'GCS', 'Admin'] as const).map(fl => (
                <button
                  key={fl}
                  type="button"
                  onClick={() => setCurrentFlightFilter(fl)}
                  className={`px-2 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    currentFlightFilter === fl ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-300 hover:text-white hover:bg-slate-700'
                  }`}
                >
                  {fl}
                </button>
              ))}
            </div>

            {/* Page Setup Orientation (Default Portrait) */}
            <div className="flex items-center bg-slate-800/90 border border-slate-700 p-0.5 rounded-xl">
              <span className="text-[10px] font-bold text-slate-400 px-2 uppercase tracking-wider">Page:</span>
              <button
                type="button"
                onClick={() => setPageOrientation('portrait')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  pageOrientation === 'portrait' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Portrait Orientation (Default)"
              >
                Portrait
              </button>
              <button
                type="button"
                onClick={() => setPageOrientation('landscape')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  pageOrientation === 'landscape' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-300 hover:text-white hover:bg-slate-700'
                }`}
                title="Landscape Orientation"
              >
                Landscape
              </button>
            </div>
          </div>

          {/* Export Dropdown Button (Pdf / Excel Direct Download) */}
          <div className="relative" ref={exportDropdownRef}>
            <button
              type="button"
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="flex items-center space-x-1.5 px-5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-xs shadow-lg shadow-emerald-900/30 transition-all cursor-pointer"
              title="Export PDF or Excel"
            >
              <Download className="w-4 h-4" />
              <span>Export</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>

            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden py-1">
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="w-full flex items-center space-x-2.5 px-4 py-2.5 text-left text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>Pdf (.pdf)</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportExcel}
                  className="w-full flex items-center space-x-2.5 px-4 py-2.5 text-left text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer border-t border-slate-100 dark:border-slate-700/70"
                >
                  <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Excel (.xlsx)</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Section Inclusion Filters (Custom toggles) */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex items-center space-x-1.5 text-slate-400 font-bold text-[11px] uppercase tracking-wide mr-1">
            <Filter className="w-3.5 h-3.5 text-indigo-400" />
            <span>Include in Print:</span>
          </div>

          <button
            type="button"
            onClick={() => setShowDutyRatio(!showDutyRatio)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              showDutyRatio
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-300 opacity-60'
            }`}
            title="Toggle Duty Ratio matrices"
          >
            {showDutyRatio ? <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> : <Square className="w-3.5 h-3.5" />}
            <span>Duty Ratio</span>
          </button>

          <button
            type="button"
            onClick={() => setShowManpower(!showManpower)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              showManpower
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-300 opacity-60'
            }`}
            title="Toggle Effective Manpower table"
          >
            {showManpower ? <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> : <Square className="w-3.5 h-3.5" />}
            <span>Eff Manpower</span>
          </button>

          <button
            type="button"
            onClick={() => setShowDistribution(!showDistribution)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              showDistribution
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-300 opacity-60'
            }`}
            title="Toggle Distribution Per Person & Per Flight tables"
          >
            {showDistribution ? <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> : <Square className="w-3.5 h-3.5" />}
            <span>Distribution</span>
          </button>

          <button
            type="button"
            onClick={() => setShowTotalDuty(!showTotalDuty)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              showTotalDuty
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-300 opacity-60'
            }`}
            title="Toggle Total Duty Summary table"
          >
            {showTotalDuty ? <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> : <Square className="w-3.5 h-3.5" />}
            <span>Total Duty Summary</span>
          </button>

          <button
            type="button"
            onClick={() => setShowNominalRoll(!showNominalRoll)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              showNominalRoll
                ? 'bg-indigo-950/80 border-indigo-500 text-indigo-200'
                : 'bg-slate-800/60 border-slate-700/80 text-slate-400 hover:text-slate-300 opacity-60'
            }`}
            title="Toggle Nominal Roll table"
          >
            {showNominalRoll ? <CheckSquare className="w-3.5 h-3.5 text-indigo-400" /> : <Square className="w-3.5 h-3.5" />}
            <span>Nominal Roll</span>
          </button>
        </div>
      </div>

      {/* Printable Content Area with Real Scaled Portrait/Landscape & Multi-Page Preview */}
      <div className="flex-1 overflow-y-auto overflow-x-auto print:overflow-visible print:block print:w-full">
        <PaginatedPaperPreview
          elementId="print-duty-ratio-content"
          paperSize="a4"
          orientation={pageOrientation}
          marginType="narrow"
          marginMm={narrowMargin.marginMm}
          preserveColors={true}
          refreshKey={`${pageOrientation}-${currentFlightFilter}-${showDutyRatio}-${showManpower}-${showDistribution}-${showTotalDuty}-${showNominalRoll}-${matrix.length}-${targetDate || ''}`}
        >
        <div
          className={`duty-ratio-print-container w-full text-black bg-white ${pageOrientation === 'landscape' ? 'duty-ratio-print-landscape' : 'duty-ratio-print-portrait'}`}
        >
          <style>{`
            @media print {
              @page { 
                size: A4 ${pageOrientation} !important; 
                margin: 12.7mm !important; 
              }
              html, body { 
                 background: white !important; 
                 color: black !important; 
                 width: 100% !important;
                 max-width: 100% !important;
                 min-width: 100% !important;
                 margin: 0 !important;
                 padding: 0 !important;
                 overflow: visible !important;
                -webkit-print-color-adjust: exact !important; 
                 print-color-adjust: exact !important; 
               }
              
              /* Ensure the print container spans 100% of the page */
              #print-duty-ratio-content,
              .duty-ratio-print-container {
                width: 100% !important;
                max-width: 100% !important;
                min-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                display: block !important;
              }

              /* Ensure every table fits 100% width of the page */
              #print-duty-ratio-content table {
                width: 100% !important;
                max-width: 100% !important;
                min-width: 100% !important;
                table-layout: auto !important;
              }

              /* Allow multi-page tables like nominal roll to flow naturally while keeping rows intact */
              tr    { page-break-inside: avoid !important; break-inside: avoid !important; }
              thead { display: table-header-group !important; }
              tfoot { display: table-footer-group !important; }
              /* Force elements with these classes to avoid breaking */
              .print\\:break-inside-avoid, .break-inside-avoid {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }

              /* Side-by-side Top Summary (Total Duty & Effective Manpower) in print */
              .print-top-summary-container {
                display: flex !important;
                flex-direction: row !important;
                justify-content: space-between !important;
                align-items: flex-start !important;
                gap: 16px !important;
                width: 100% !important;
              }
              .print-top-total-duty {
                flex: 1 1 58% !important;
                max-width: 58% !important;
                width: 58% !important;
              }
              .print-top-manpower {
                flex: 1 1 40% !important;
                max-width: 40% !important;
                width: 40% !important;
              }

              /* Hide scrollbars during print */
              ::-webkit-scrollbar { display: none; }
              
              /* Hide main app, only show portal */
              #root {
                display: none !important;
              }
            }
          `}</style>

          {/* MAIN DOCUMENT HEADER */}
          <div data-pdf-repeat-header="true" className="text-center mb-5" style={{ fontFamily: 'Arial, sans-serif' }}>
            <h2 className="font-bold underline uppercase" style={{ fontSize: '12pt' }}>{getPageMainTitle()}</h2>
            <h3 className="font-bold uppercase mt-0.5" style={{ fontSize: '12pt' }}>{getActiveOfficeIdentity().officeName}</h3>
            {targetDate && <p className="font-bold text-black mt-0.5" style={{ fontSize: '12pt' }}>Date: {formatDisplayDate(targetDate)}</p>}
          </div>

          {/* FLIGHT WISE VIEW (When a flight is filtered: Mechanics, Avionics, GCS, Admin) */}
          {isFlightFiltered && (
            <div className="flex flex-col gap-6">
              
              {/* Consolidated Flight Duty Schedule Table */}
              {showDutyRatio && (
                <div data-pdf-keep-together="true" className="w-full mb-4 print:w-full" style={{ pageBreakInside: "avoid", breakInside: "avoid", fontFamily: 'Arial, sans-serif' }}>
                  <div className="flex justify-between items-center mb-1.5 w-full">
                    <div className="font-bold underline uppercase" style={{ fontSize: '12pt' }}>{currentFlightFilter} Duty Schedule</div>
                    <div className="flex items-stretch border border-black" style={{ fontSize: '12pt' }}>
                      <div className="px-2.5 py-0.5 border-r border-black flex items-center justify-center text-center" style={{ backgroundColor: '#ffffff' }}>Month Total</div>
                      <div className="px-3.5 py-0.5 font-bold flex items-center justify-center text-center" style={{ backgroundColor: '#ffffff' }}>{flightMonthTotal}</div>
                    </div>
                  </div>

                  <table className={`no-zebra w-full table-fixed border-collapse border border-black text-center ${pageOrientation === 'portrait' ? 'text-[9pt]' : 'text-[11pt]'} print:w-full print:min-w-0`}>
                    <colgroup>
                      <col style={{ width: pageOrientation === 'portrait' ? '92px' : '148px' }} />
                      {daysArray.map(d => (
                        <col key={d} />
                      ))}
                      <col style={{ width: pageOrientation === 'portrait' ? '34px' : '46px' }} />
                    </colgroup>
                    <thead>
                      <tr style={{ backgroundColor: '#ffffff' }}>
                        <th className="border border-black font-bold py-1 px-1 text-center align-middle" style={{ backgroundColor: '#f1f5f9' }}>Duty Name / Date</th>
                        {daysArray.map(d => (
                          <th key={d} className="border border-black font-bold py-1 px-0 text-center align-middle" style={{ backgroundColor: d % 2 === 0 ? '#e2e8f0' : '#f1f5f9' }}>{d}</th>
                        ))}
                        <th className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: '#e2e8f0' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matrix.filter(t => !t.isDisabled).map((table, rowIdx) => {
                        const rowData = table.data[currentFlightFilter as FlightName] || Array(31).fill(0);
                        const rowSum = rowData.reduce((a, b) => a + b, 0);
                        const dutyTitle = (table.serNo !== undefined ? `${table.serNo}. ` : `${rowIdx + 1}. `) + (table.title || '').replace(/\s*\(\d+\)$/, '').trim();

                        return (
                          <tr key={table.id}>
                            <td className="border border-black font-bold py-1 px-1.5 text-left align-middle" style={{ backgroundColor: rowIdx % 2 === 1 ? '#f1f5f9' : '#ffffff' }}>
                              {dutyTitle}
                            </td>
                            {daysArray.map(d => {
                              const dayIdx = d - 1;
                              const val = rowData[dayIdx];
                              return (
                                <td key={dayIdx} className="border border-black py-1 px-0 text-center align-middle font-semibold" style={{ backgroundColor: getMatrixCellBg(rowIdx, d, val) }}>
                                  {val > 0 ? val : ''}
                                </td>
                              );
                            })}
                            <td className="border border-black py-1 px-0.5 text-center align-middle font-bold" style={{ backgroundColor: rowIdx % 2 === 1 ? '#e2e8f0' : '#f1f5f9' }}>
                              {rowSum > 0 ? rowSum : ''}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Daily Total row */}
                      <tr style={{ backgroundColor: '#e2e8f0' }}>
                        <td className="border border-black font-bold py-1 px-1 text-center align-middle uppercase" style={{ backgroundColor: '#cbd5e1' }}>DAILY TOTAL</td>
                        {daysArray.map(d => {
                          const dayIdx = d - 1;
                          const daySum = matrix.filter(t => !t.isDisabled).reduce((sum, t) => sum + (t.data[currentFlightFilter as FlightName]?.[dayIdx] || 0), 0);
                          return (
                            <td key={dayIdx} className="border border-black py-1 px-0 text-center align-middle font-bold" style={{ backgroundColor: d % 2 === 0 ? '#cbd5e1' : '#e2e8f0' }}>
                              {daySum > 0 ? daySum : ''}
                            </td>
                          );
                        })}
                        <td className="border border-black py-1 px-0.5 text-center align-middle font-bold" style={{ backgroundColor: '#cbd5e1' }}>
                          {flightMonthTotal}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Effective Manpower for this flight */}
              {showManpower && (
                <div className="w-full flex flex-col items-center justify-center my-3 print:my-2" style={{ fontFamily: 'Arial, sans-serif', fontSize: '12pt' }}>
                  <div data-pdf-keep-together="true" className="w-full max-w-md mx-auto flex flex-col items-center" style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
                    <h4 className="font-bold underline text-center mb-2 uppercase" style={{ fontSize: '12pt' }}>EFFECTIVE MANPOWER</h4>
                    <table className="no-zebra border-collapse border border-black text-center bg-white text-black w-full print:min-w-0 mx-auto" style={{ fontSize: '12pt' }}>
                      <thead>
                        <tr className="bg-slate-100 print:bg-white">
                          <th className="border border-black p-1.5 w-28 text-center align-middle">Flight</th>
                          <th className="border border-black p-1.5 w-20 text-center align-middle">Sgt</th>
                          <th className="border border-black p-1.5 w-28 text-center align-middle">Cpl & Below</th>
                          <th className="border border-black p-1.5 w-20 text-center align-middle">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { name: 'Mech', sgt: currentManpower.mechSgt, cpl: currentManpower.mechCpl },
                          { name: 'Avi', sgt: currentManpower.aviSgt, cpl: currentManpower.aviCpl },
                          { name: 'GCS', sgt: currentManpower.gcsSgt, cpl: currentManpower.gcsCpl },
                          { name: 'Admin', sgt: currentManpower.adminSgt, cpl: currentManpower.adminCpl }
                        ].map(row => (
                          <tr key={row.name} className="even:bg-gray-100 print:even:bg-gray-100">
                            <td className="border border-black p-1.5 font-semibold text-center align-middle">{row.name}</td>
                            <td className="border border-black p-1.5 text-center align-middle">{row.sgt}</td>
                            <td className="border border-black p-1.5 text-center align-middle">{row.cpl}</td>
                            <td className="border border-black p-1.5 font-bold text-center align-middle">{row.sgt + row.cpl}</td>
                          </tr>
                        ))}
                        <tr className="font-bold bg-slate-100 print:bg-white">
                          <td className="border border-black p-1.5 text-center align-middle">Total</td>
                          <td className="border border-black p-1.5 text-center align-middle">{totalSgt}</td>
                          <td className="border border-black p-1.5 text-center align-middle">{totalCpl}</td>
                          <td className="border border-black p-1.5 text-center align-middle">{totalSgtAndBelow}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Nominal Roll filtered for this flight */}
              {showNominalRoll && (
                <div className="w-full mt-4 print:mt-3" style={{ pageBreakInside: "auto", breakInside: "auto", fontFamily: 'Arial, sans-serif', fontSize: '12pt' }}>
                  <div className="text-center mb-2">
                    <h4 className="font-bold underline text-center uppercase" style={{ fontSize: '12pt' }}>
                      NOMINAL ROLL ({currentFlightFilter.toUpperCase()})
                    </h4>
                    <p className="font-bold text-center text-black uppercase mt-0.5" style={{ fontSize: '12pt' }}>
                      Sgt & Below
                    </p>
                  </div>
                  <table className="no-zebra border-collapse border border-black bg-white text-black w-full print:min-w-0" style={{ pageBreakInside: "auto", breakInside: "auto", fontSize: '12pt' }}>
                    <thead>
                      <tr className="bg-slate-100 print:bg-white text-center">
                        <th className="border border-black p-1.5 w-[7%] text-center align-middle font-bold">Ser No</th>
                        <th className="border border-black p-1.5 w-[11%] text-center align-middle font-bold">Rank</th>
                        <th className="border border-black p-1.5 w-[26%] text-center align-middle font-bold">Name</th>
                        <th className="border border-black p-1.5 w-[18%] text-center align-middle font-bold">Trade</th>
                        <th className="border border-black p-1.5 w-[18%] text-center align-middle font-bold">Flight</th>
                        <th className="border border-black p-1.5 w-[20%] text-center align-middle font-bold">Disposal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nominalRollAirmen.filter(a => a.flightName === currentFlightFilter).map((a, idx) => (
                        <tr key={a.id} className="even:bg-gray-100 print:even:bg-gray-100">
                          <td className="border border-black p-1.5 text-center align-middle font-normal">{idx + 1}</td>
                          <td className="border border-black p-1.5 text-center align-middle font-semibold">{a.rank}</td>
                          <td className="border border-black p-1.5 px-3 text-left align-middle font-medium">{a.name}</td>
                          <td className="border border-black p-1.5 px-3 text-left align-middle">{a.trade}</td>
                          <td className="border border-black p-1.5 px-3 text-left align-middle">{a.flightName}</td>
                          <td className="border border-black p-1.5 px-2 text-center align-middle font-normal">{a.disposal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* OVERALL VIEW (When NOT flight filtered) */}
          {!isFlightFiltered && (
            <div className="flex flex-col gap-8 print:gap-4">
              
              {/* TOP SECTION: Total Duty Table & Effective Manpower Table */}
              {(showTotalDuty || showManpower) && (
                <div data-pdf-keep-together={pageOrientation === 'landscape' ? 'true' : undefined} className={`w-full flex ${showTotalDuty && showManpower ? (pageOrientation === 'landscape' ? 'flex-row justify-between items-start gap-6 print-top-summary-container print:gap-4' : 'flex-col items-center gap-5 print-top-summary-container print:gap-4') : 'flex-col items-center justify-center my-3 print:my-2 print:w-full'}`} style={{ fontFamily: 'Arial, sans-serif', fontSize: '12pt' }}>
                  
                  {/* TOTAL DUTY Table */}
                  {showTotalDuty && (
                    <div data-pdf-keep-together="true" className={`w-full ${showManpower ? (pageOrientation === 'landscape' ? 'flex-[1.4] w-auto print-top-total-duty print:max-w-none' : 'max-w-lg print-top-total-duty print:max-w-none') : 'w-full print:w-full print:max-w-none'}`} style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
                      <h4 className="font-bold underline text-center mb-2 uppercase" style={{ fontSize: '12pt' }}>TOTAL DUTY</h4>
                      <table className="no-zebra border-collapse border border-black text-center bg-white text-black w-full print:w-full print:min-w-0" style={{ fontSize: '12pt' }}>
                        <thead>
                          <tr className="bg-slate-100 print:bg-white text-center">
                            <th className="border border-black p-1.5 text-center align-middle font-bold">Duty Name</th>
                            <th className="border border-black p-1.5 text-center align-middle font-bold whitespace-nowrap">Eligible Flt</th>
                            <th className="border border-black p-1.5 text-center align-middle font-bold whitespace-nowrap">Eligible Rank</th>
                            <th className="border border-black p-1.5 text-center align-middle font-bold w-16">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matrix.filter(t => !t.isDisabled).map(t => (
                            <tr key={t.id} className="even:bg-gray-100 print:even:bg-gray-100">
                              <td className="border border-black p-1.5 text-left px-2.5 align-middle font-medium">{t.title.split('(')[0].trim()}</td>
                              <td className="border border-black p-1.5 text-center align-middle whitespace-nowrap">{getEligibleFlightDisplay(t)}</td>
                              <td className="border border-black p-1.5 text-center align-middle whitespace-nowrap">{getEligibleRankDisplay(t)}</td>
                              <td className="border border-black p-1.5 text-center align-middle font-bold">{t.totalRequiredMonth}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* EFFECTIVE MANPOWER Table */}
                  {showManpower && (
                    <div data-pdf-keep-together="true" className={`w-full ${showTotalDuty ? (pageOrientation === 'landscape' ? 'flex-1 w-auto print-top-manpower print:max-w-none' : 'max-w-md print-top-manpower print:max-w-none') : 'w-full print:w-full print:max-w-none'} flex flex-col items-center`} style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
                      <h4 className="font-bold underline text-center mb-2 uppercase" style={{ fontSize: '12pt' }}>EFFECTIVE MANPOWER</h4>
                      <table className="no-zebra border-collapse border border-black text-center bg-white text-black w-full print:w-full print:min-w-0 mx-auto" style={{ fontSize: '12pt' }}>
                        <thead>
                          <tr className="bg-slate-100 print:bg-white">
                            <th className="border border-black p-1.5 w-24 text-center align-middle">Flight</th>
                            <th className="border border-black p-1.5 w-16 text-center align-middle">Sgt</th>
                            <th className="border border-black p-1.5 w-28 text-center align-middle">Cpl & Below</th>
                            <th className="border border-black p-1.5 w-16 text-center align-middle">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { name: 'Mech', sgt: currentManpower.mechSgt, cpl: currentManpower.mechCpl },
                            { name: 'Avi', sgt: currentManpower.aviSgt, cpl: currentManpower.aviCpl },
                            { name: 'GCS', sgt: currentManpower.gcsSgt, cpl: currentManpower.gcsCpl },
                            { name: 'Admin', sgt: currentManpower.adminSgt, cpl: currentManpower.adminCpl }
                          ].map(row => (
                            <tr key={row.name} className="even:bg-gray-100 print:even:bg-gray-100">
                              <td className="border border-black p-1.5 text-center align-middle">{row.name}</td>
                              <td className="border border-black p-1.5 text-center align-middle">{row.sgt}</td>
                              <td className="border border-black p-1.5 text-center align-middle">{row.cpl}</td>
                              <td className="border border-black p-1.5 text-center align-middle">{row.sgt + row.cpl}</td>
                            </tr>
                          ))}
                          <tr className="font-bold bg-slate-100 print:bg-white">
                            <td className="border border-black p-1.5 text-center align-middle">Total</td>
                            <td className="border border-black p-1.5 text-center align-middle">{totalSgt}</td>
                            <td className="border border-black p-1.5 text-center align-middle">{totalCpl}</td>
                            <td className="border border-black p-1.5 text-center align-middle">{totalSgtAndBelow}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* DISTRIBUTION SECTION (Manpower formula & Flight formula) */}
              {showDistribution && (
                <div className="flex flex-col gap-8 print:gap-4 w-full print:w-full" style={{ fontFamily: 'Arial, sans-serif', fontSize: '12pt' }}>
                  {/* DISTRIBUTION AS PER MANPOWER Table */}
                  <div data-pdf-keep-together="true" className="w-full print:w-full print:mt-2 print:block print:overflow-visible" style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
                    <h4 className="font-bold underline text-center mb-2" style={{ fontSize: '12pt' }}>DISTRIBUTION AS PER MANPOWER</h4>
                    <div className="text-center font-bold underline mb-1" style={{ fontSize: '12pt' }}>FORMULA</div>
                    <table className="no-zebra border-collapse border border-black text-center bg-white text-black w-full print:w-full print:min-w-0" style={{ fontSize: '12pt' }}>
                      <thead>
                        <tr className="bg-slate-100 print:bg-white">
                          <th className="border border-black p-1.5 w-40 text-center align-middle" rowSpan={2}>DUTY PER PERSON</th>
                          {matrix.filter(t => !t.isDisabled).map(t => (
                            <th key={t.id} className="border border-black p-1 text-center align-middle">{t.title.split('(')[0].trim()}</th>
                          ))}
                        </tr>
                        <tr className="bg-slate-100 print:bg-white">
                          {matrix.filter(t => !t.isDisabled).map(t => {
                            const includesSgt = t.eligibleRanks ? t.eligibleRanks.includes('Sgt') : t.id !== 'security_duty';
                            const isCplOnly = !includesSgt;
                            return (
                              <td key={t.id} className="border border-black p-1 leading-tight text-black text-center align-middle" style={{ fontSize: '12pt' }}>
                                Total {t.title.split('(')[0].trim()} ÷<br/>
                                Total {isCplOnly ? 'Cpl & Below' : 'Sgt & Below'}
                              </td>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td className="border border-black p-1.5 font-bold text-center align-middle px-2">DUTY PER PERSON</td>
                          {matrix.filter(t => !t.isDisabled).map(t => {
                            const includesSgt = t.eligibleRanks ? t.eligibleRanks.includes('Sgt') : t.id !== 'security_duty';
                            const isCplOnly = !includesSgt;
                            const pool = isCplOnly ? totalCpl : totalSgtAndBelow;
                            return (
                              <td key={t.id} className="border border-black p-1.5 font-bold text-center align-middle">
                                {pool > 0 ? (t.totalRequiredMonth / pool).toFixed(2) : '0.00'}
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* DISTRIBUTION AS PER FLIGHT Table */}
                  <div data-pdf-keep-together="true" className="w-full print:w-full print:mt-2 print:block print:overflow-visible" style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
                    <h4 className="font-bold underline text-center mb-2" style={{ fontSize: '12pt' }}>DISTRIBUTION AS PER FLIGHT</h4>
                    <div className="text-center font-bold underline mb-1" style={{ fontSize: '12pt' }}>FORMULA</div>
                    <table className="no-zebra border-collapse border border-black text-center bg-white text-black w-full print:w-full print:min-w-0" style={{ fontSize: '12pt' }}>
                      <thead>
                        <tr className="bg-slate-100 print:bg-white">
                          <th className="border border-black p-1.5 w-40 text-center align-middle" rowSpan={2}>DUTY PER FLIGHT</th>
                          {matrix.filter(t => !t.isDisabled).map(t => (
                            <th key={t.id} className="border border-black p-1 text-center align-middle">{t.title.split('(')[0].trim()}</th>
                          ))}
                          <th className="border border-black p-1.5 w-24 font-bold text-center align-middle" rowSpan={2}>TOTAL DUTY</th>
                        </tr>
                        <tr className="bg-slate-100 print:bg-white">
                          {matrix.filter(t => !t.isDisabled).map(t => {
                            const includesSgt = t.eligibleRanks ? t.eligibleRanks.includes('Sgt') : t.id !== 'security_duty';
                            const isCplOnly = !includesSgt;
                            return (
                              <td key={`f-${t.id}`} className="border border-black p-1 leading-tight text-black text-center align-middle" style={{ fontSize: '12pt' }}>
                                Per Person {t.title.split('(')[0].trim()} x<br/>
                                Total {isCplOnly ? 'Cpl & Below' : 'Sgt & Below'} of Flight
                              </td>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {['Mechanics', 'Avionics', 'GCS', 'Admin'].map(fl => {
                          const displayFl = fl === 'Mechanics' ? 'MECHANICS FLT' : fl === 'Avionics' ? 'AVIONICS FLT' : fl === 'GCS' ? 'GCS FLT' : 'ADMIN FLT';
                          let flightSum = 0;
                          matrix.filter(t => !t.isDisabled).forEach(t => {
                            const val = t.flightTargets?.[fl as keyof typeof t.flightTargets] !== undefined
                              ? t.flightTargets[fl as keyof typeof t.flightTargets]
                              : (calculatedMatrixDistributions[t.id]?.[fl]?.autoVal || 0);
                            flightSum += val;
                          });
                          return (
                            <tr key={fl} className="even:bg-gray-100 print:even:bg-gray-100">
                              <td className="border border-black p-1 text-center align-middle px-2 font-bold">{displayFl}</td>
                              {matrix.filter(t => !t.isDisabled).map(t => {
                                const val = t.flightTargets?.[fl as keyof typeof t.flightTargets] !== undefined
                                  ? t.flightTargets[fl as keyof typeof t.flightTargets]
                                  : (calculatedMatrixDistributions[t.id]?.[fl]?.autoVal || 0);
                                return <td key={t.id} className="border border-black p-1 text-center align-middle">{val}</td>;
                              })}
                              <td className="border border-black p-1 font-bold text-center align-middle bg-slate-50 print:bg-white">{flightSum}</td>
                            </tr>
                          );
                        })}
                        <tr className="font-bold bg-slate-100 print:bg-white">
                          <td className="border border-black p-1.5 text-center align-middle px-2 uppercase">Total Duty</td>
                          {matrix.filter(t => !t.isDisabled).map(t => {
                            let colTotal = 0;
                            ['Mechanics', 'Avionics', 'GCS', 'Admin'].forEach(fl => {
                              const val = t.flightTargets?.[fl as keyof typeof t.flightTargets] !== undefined
                                ? t.flightTargets[fl as keyof typeof t.flightTargets]
                                : (calculatedMatrixDistributions[t.id]?.[fl]?.autoVal || 0);
                              colTotal += val;
                            });
                            const isMismatch = colTotal !== t.totalRequiredMonth;
                            return (
                              <td key={t.id} className={`border border-black p-1.5 text-center align-middle ${isMismatch ? 'text-red-600 font-black' : ''}`}>
                                {colTotal}
                              </td>
                            );
                          })}
                          <td className="border border-black p-1.5 font-bold text-center align-middle">
                            {(() => {
                              let totalAll = 0;
                              matrix.filter(t => !t.isDisabled).forEach(t => {
                                ['Mechanics', 'Avionics', 'GCS', 'Admin'].forEach(fl => {
                                  const val = t.flightTargets?.[fl as keyof typeof t.flightTargets] !== undefined
                                    ? t.flightTargets[fl as keyof typeof t.flightTargets]
                                    : (calculatedMatrixDistributions[t.id]?.[fl]?.autoVal || 0);
                                  totalAll += val;
                                });
                              });
                              return totalAll;
                            })()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              
              {/* DUTY RATIO MATRICES (Scale 1-31 for each duty) */}
              {showDutyRatio && (
                <div className="pt-2">
                  {matrix.filter(t => !t.isDisabled).map((table) => {
                    const cleanTitle = table.title.split('(')[0].trim();
                    
                    const MAX_COLS_PER_PAGE = 31;
                    const daysChunks = [];
                    for (let i = 0; i < 31; i += MAX_COLS_PER_PAGE) {
                      const daysArrayLocal = Array.from({ length: 31 }, (_, idx) => idx + 1);
                      daysChunks.push(daysArrayLocal.slice(i, i + MAX_COLS_PER_PAGE));
                    }

                    return daysChunks.map((chunk, chunkIdx) => {
                      return (
                        <div key={`${table.id}-${chunkIdx}`} data-pdf-keep-together="true" className="w-full mb-5 print:mb-4 print:w-full" style={{ pageBreakInside: "avoid", breakInside: "avoid", fontFamily: 'Arial, sans-serif' }}>
                          <div className="flex justify-between items-center mb-1.5 w-full">
                            <div className="font-bold underline uppercase" style={{ fontSize: '12pt' }}>{cleanTitle} {daysChunks.length > 1 ? ` (Part ${chunkIdx + 1})` : ''}</div>
                            <div className="flex items-stretch border border-black" style={{ fontSize: '12pt' }}>
                              <div className="px-2.5 py-0.5 border-r border-black flex items-center justify-center text-center" style={{ backgroundColor: '#ffffff' }}>Total Duty</div>
                              <div className="px-3.5 py-0.5 font-bold flex items-center justify-center text-center" style={{ backgroundColor: '#ffffff' }}>{table.totalRequiredMonth}</div>
                            </div>
                          </div>
                          
                          <table className="no-zebra w-full table-fixed border-collapse border border-black text-center print:w-full print:min-w-0" style={{ fontSize: pageOrientation === 'portrait' ? '9.5pt' : '11pt' }}>
                            <colgroup>
                              <col style={{ width: pageOrientation === 'portrait' ? '34px' : '44px' }} />
                              <col style={{ width: pageOrientation === 'portrait' ? '34px' : '44px' }} />
                              {chunk.map(d => (
                                <col key={d} />
                              ))}
                              <col style={{ width: pageOrientation === 'portrait' ? '36px' : '46px' }} />
                            </colgroup>
                            <thead>
                              <tr style={{ backgroundColor: '#ffffff' }}>
                                <th colSpan={2} className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: '#f1f5f9' }}>Date</th>
                                {chunk.map(d => (
                                  <th key={d} className="border border-black font-bold py-1 px-0 text-center align-middle" style={{ backgroundColor: d % 2 === 0 ? '#e2e8f0' : '#f1f5f9' }}>{d}</th>
                                ))}
                                <th className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: '#e2e8f0' }}>Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {['Mechanics', 'Avionics', 'GCS', 'Admin'].map((fl, i) => {
                                const flName = fl as FlightName;
                                const rowData = table.data[flName] || Array(31).fill(0);
                                const rowSum = rowData.reduce((a, b) => a + b, 0);
                                const displayFl = fl === 'Mechanics' ? 'Mech' : fl === 'Avionics' ? 'AVI' : fl;
                                
                                return (
                                  <tr key={fl}>
                                    <td colSpan={2} className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: i % 2 === 1 ? '#f1f5f9' : '#ffffff' }}>{displayFl}</td>
                                    {chunk.map(d => {
                                      const dayIdx = d - 1;
                                      const val = rowData[dayIdx];
                                      return (
                                        <td key={dayIdx} className="border border-black py-1 px-0 text-center align-middle font-semibold" style={{ backgroundColor: getMatrixCellBg(i, d, val) }}>
                                          {val > 0 ? val : ''}
                                        </td>
                                      );
                                    })}
                                    <td className="border border-black py-1 px-0.5 text-center align-middle font-bold" style={{ backgroundColor: i % 2 === 1 ? '#e2e8f0' : '#f1f5f9' }}>{rowSum > 0 ? rowSum : ''}</td>
                                  </tr>
                                );
                              })}
                              
                              <tr style={{ backgroundColor: '#e2e8f0' }}>
                                <td rowSpan={2} className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: '#cbd5e1' }}>Daily</td>
                                <td className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: '#cbd5e1' }}>Total</td>
                                {chunk.map((d) => {
                                  const i = d - 1;
                                  const sum = ['Mechanics', 'Avionics', 'GCS', 'Admin'].reduce((acc, fl) => {
                                    const val = table.data[fl as FlightName]?.[i] || 0;
                                    return acc + val;
                                  }, 0);
                                  return (
                                    <td key={i} className="border border-black py-1 px-0 text-center align-middle font-bold" style={{ backgroundColor: d % 2 === 0 ? '#cbd5e1' : '#e2e8f0' }}>
                                      {sum > 0 ? sum : ''}
                                    </td>
                                  );
                                })}
                                <td className="border border-black py-1 px-0.5 text-center align-middle font-bold" style={{ backgroundColor: '#cbd5e1' }}>
                                  {chunk.reduce((monthAcc, d) => {
                                    const i = d - 1;
                                    const dailySum = ['Mechanics', 'Avionics', 'GCS', 'Admin'].reduce((acc, fl) => {
                                      return acc + (table.data[fl as FlightName]?.[i] || 0);
                                    }, 0);
                                    return monthAcc + dailySum;
                                  }, 0)}
                                </td>
                              </tr>
                              <tr style={{ backgroundColor: '#f8fafc' }}>
                                <td className="border border-black font-bold py-1 px-0.5 text-center align-middle" style={{ backgroundColor: '#f1f5f9' }}>Req.</td>
                                {chunk.map((d) => {
                                  const i = d - 1;
                                  let req = table.dailyRequirements?.[i];
                                  if (req === undefined) {
                                      if (table.totalRequiredDaily && (table.totalRequiredDaily * 31 === table.totalRequiredMonth)) {
                                          req = table.totalRequiredDaily;
                                      } else {
                                          req = ['Mechanics', 'Avionics', 'GCS', 'Admin'].reduce((acc, fl) => acc + (table.data[fl as FlightName]?.[i] || 0), 0);
                                      }
                                  }
                                  return (
                                    <td key={i} className="border border-black py-1 px-0 text-center align-middle" style={{ backgroundColor: d % 2 === 0 ? '#e2e8f0' : '#f1f5f9' }}>
                                      {req > 0 ? req : ''}
                                    </td>
                                  );
                                })}
                                <td className="border border-black py-1 px-0.5 text-center align-middle font-bold" style={{ backgroundColor: '#e2e8f0' }}>{table.totalRequiredMonth}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      );
                    });
                  })}
                </div>
              )}

              {/* NOMINAL ROLL (if selected in overall view) */}
              {showNominalRoll && (
                <div className="w-full mt-4 print:mt-3" style={{ pageBreakInside: "auto", breakInside: "auto", fontFamily: 'Arial, sans-serif', fontSize: '12pt' }}>
                  <div className="text-center mb-2">
                    <h4 className="font-bold underline text-center uppercase" style={{ fontSize: '12pt' }}>
                      NOMINAL ROLL
                    </h4>
                    <p className="font-bold text-center text-black uppercase mt-0.5" style={{ fontSize: '12pt' }}>
                      Sgt & Below
                    </p>
                  </div>
                  <table className="no-zebra border-collapse border border-black bg-white text-black w-full print:min-w-0" style={{ pageBreakInside: "auto", breakInside: "auto", fontSize: '12pt' }}>
                    <thead>
                      <tr className="bg-slate-100 print:bg-white text-center">
                        <th className="border border-black p-1.5 w-[7%] text-center align-middle font-bold">Ser No</th>
                        <th className="border border-black p-1.5 w-[11%] text-center align-middle font-bold">Rank</th>
                        <th className="border border-black p-1.5 w-[26%] text-center align-middle font-bold">Name</th>
                        <th className="border border-black p-1.5 w-[18%] text-center align-middle font-bold">Trade</th>
                        <th className="border border-black p-1.5 w-[18%] text-center align-middle font-bold">Flight</th>
                        <th className="border border-black p-1.5 w-[20%] text-center align-middle font-bold">Disposal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {nominalRollAirmen.map((a, idx) => (
                        <tr key={a.id} className="even:bg-gray-100 print:even:bg-gray-100">
                          <td className="border border-black p-1.5 text-center align-middle font-normal">{idx + 1}</td>
                          <td className="border border-black p-1.5 text-center align-middle font-semibold">{a.rank}</td>
                          <td className="border border-black p-1.5 px-3 text-left align-middle font-medium">{a.name}</td>
                          <td className="border border-black p-1.5 px-3 text-left align-middle">{a.trade}</td>
                          <td className="border border-black p-1.5 px-3 text-left align-middle">{a.flightName}</td>
                          <td className="border border-black p-1.5 px-2 text-center align-middle font-normal">{a.disposal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

            </div>
          )}

          {/* Empty state if all sections are unchecked */}
          {!showDutyRatio && !showManpower && !showDistribution && !showTotalDuty && !showNominalRoll && (
            <div className="py-20 text-center text-slate-500 font-semibold text-sm">
              No sections selected for print. Please check at least one section in the "Include in Print" bar above.
            </div>
          )}

        </div>
        </PaginatedPaperPreview>
      </div>
    </div>
  , document.body);
};

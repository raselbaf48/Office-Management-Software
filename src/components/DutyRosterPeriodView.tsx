import { DateNavigator } from './DateNavigator';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Airman, DutyAssignment, UserRole, FlightName } from '../types';
import { INITIAL_AIRMEN } from '../data/initialAirmen';
import { getFlightDutyQuotaForDate, getStoredDutyMatrix } from '../data/officialDutyRatioMatrix';
import {
 exportDutyRosterDocx,
 exportIdacRosterDocx,
 RosterSectionData,
 RosterExportItem,
 formatRank,
 IdacRosterRow,
} from '../utils/docxExport';
import { exportElementToPdf } from '../utils/pdfExport';
import { PageSetupBar } from './PageSetupBar';
import { PageSetupConfig, getPageDimensions } from '../utils/pageSetup';
import {
 FileDown,
 Download,
 FileText,
 ChevronDown,
 Layers,
 Shield,
 Clock,
 ListFilter,
 ChevronLeft,
 ChevronRight,
 PenTool,
} from 'lucide-react';
import { Logo155UASU } from './Logo155UASU';
import { getActiveOfficeIdentity, doesOfficeHaveFlights, isDefault155UasuOffice } from '../firebase';
import { getBiodataTrades } from '../utils/tradeList';
import {
  IdacSignatureModal,
  IdacSignatureDetails,
  getSavedIdacSignature,
  saveIdacSignature,
} from './IdacSignatureModal';

interface DutyRosterPeriodViewProps {
 role: UserRole;
 airmen: Airman[];
 selectedDate?: string;
 onViewProfile?: (airman: Airman) => void;
}

export type RosterMode = 'BASE_DUTIES' | 'IDAC_DUTY';


const formatBlockName = (block: string | undefined) => {
  if (!block) return 'L/O';
  const raw = block.trim();
  const lower = raw.toLowerCase();
  if (!raw || raw === '-' || lower === 'n/a') return 'L/O';

  // Detect Living In (Mess / Block / Barrack / direct block number pattern like 123/08)
  const isLivingIn =
    lower.includes('mess') ||
    /\bblock\b/i.test(raw) ||
    lower.includes('barrack') ||
    lower === 'l/i' ||
    lower === 'li' ||
    lower === 'l/in' ||
    lower === 'live in' ||
    lower === 'living in' ||
    /^[a-zA-Z]?\s*\d+\s*\/\s*\d+[a-zA-Z]?$/.test(raw);

  if (!isLivingIn) {
    return 'L/O';
  }

  if (/^[a-zA-Z]?\s*\d+\s*\/\s*\d+[a-zA-Z]?$/.test(raw)) {
    return raw.replace(/\s+/g, '');
  }

  const blockMatch = raw.match(/Block\s*(?:No[:\s]*)?([^,]+)/i);
  if (blockMatch) {
    const cleaned = blockMatch[1].replace(/^[.\-\s:]+|[.\-\s:]+$/g, '').trim();
    if (cleaned) return cleaned;
  }

  const strippedMess = raw
    .replace(/Airmen's\s*Mess/gi, '')
    .replace(/Sgt's\s*Mess/gi, '')
    .replace(/Mess/gi, '')
    .replace(/^[,\s:.-]+|[,\s:.-]+$/g, '')
    .trim();

  if (strippedMess && !/^(l\/i|li|l\/in|live\s*in|living\s*in)$/i.test(strippedMess)) {
    return strippedMess;
  }

  if (lower.includes("airmen's mess")) return "Airmen's Mess";
  if (lower.includes("sgt's mess")) return "Sgt's Mess";
  return 'L/I';
};

export const DutyRosterPeriodView: React.FC<DutyRosterPeriodViewProps> = ({
 role,
 airmen,
 selectedDate = new Date().toISOString().split('T')[0],
 onViewProfile,
}) => {
 const [rosterMode, setRosterMode] = useState<RosterMode>('BASE_DUTIES');
 const [pageSetup, setPageSetup] = useState<PageSetupConfig>({
   paperSize: 'a4',
   orientation: 'portrait',
 });
 const [showExportMenu, setShowExportMenu] = useState<boolean>(false);
 const [matrixRevision, setMatrixRevision] = useState<number>(0);
 const isExportingRef = useRef<boolean>(false);
 const exportDropdownRef = useRef<HTMLDivElement | null>(null);
 const pageDims = getPageDimensions(pageSetup);

 useEffect(() => {
   const bumpMatrix = () => setMatrixRevision((prev) => prev + 1);
   window.addEventListener('baf_duty_ratio_updated', bumpMatrix);
   window.addEventListener('baf_duty_ratio_history_updated', bumpMatrix);
   window.addEventListener('baf_custom_duties_updated', bumpMatrix);
   window.addEventListener('baf_duty_distribution_updated', bumpMatrix);
   window.addEventListener('baf_state_updated', bumpMatrix);
   window.addEventListener('baf_settings_updated', bumpMatrix);
   window.addEventListener('storage', bumpMatrix);
   return () => {
     window.removeEventListener('baf_duty_ratio_updated', bumpMatrix);
     window.removeEventListener('baf_duty_ratio_history_updated', bumpMatrix);
     window.removeEventListener('baf_custom_duties_updated', bumpMatrix);
     window.removeEventListener('baf_duty_distribution_updated', bumpMatrix);
     window.removeEventListener('baf_state_updated', bumpMatrix);
     window.removeEventListener('baf_settings_updated', bumpMatrix);
     window.removeEventListener('storage', bumpMatrix);
   };
 }, []);

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

 // Helper to get Friday-to-Thursday week boundaries
 const getDutyWeekRange = (refDateStr: string, offsetWeeks: number = 0) => {
 const [y, m, d] = (refDateStr || '2026-08-14').split('-').map(Number);
 const ref = new Date(Date.UTC(y, m - 1, d));
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

 const initialThisWeek = getDutyWeekRange(selectedDate || '2026-08-14', 0);
 const [fromDate, setFromDate] = useState<string>(initialThisWeek.from);
 const [toDate, setToDate] = useState<string>(initialThisWeek.to);
 const [weekPreset, setWeekPreset] = useState<'THIS_WEEK' | 'NEXT_WEEK' | 'FULL_MONTH' | 'CUSTOM'>('THIS_WEEK');
 const [loading, setLoading] = useState<boolean>(false);
 const [assignments, setAssignments] = useState<DutyAssignment[]>([]);
 const officeHasFlights = useMemo(() => doesOfficeHaveFlights(airmen), [airmen]);
 const is155Uasu = useMemo(() => isDefault155UasuOffice(), []);
 const tradesList = useMemo(() => ['All', ...getBiodataTrades(airmen)], [airmen]);
 const flightsList: (FlightName | 'All')[] = ['All', 'Avionics', 'Mechanics', 'GCS', 'Admin'];
 const [flightFilter, setFlightFilter] = useState<FlightName | 'All'>('All');
 const [tradeFilter, setTradeFilter] = useState<string>('All');

 // Dedicated IDAC Duty Signature state (completely independent of Parade State)
 const [showIdacSignatureModal, setShowIdacSignatureModal] = useState<boolean>(false);
 const [idacSignature, setIdacSignature] = useState<IdacSignatureDetails>(getSavedIdacSignature);

 // Listen for IDAC-specific signature updates
 useEffect(() => {
   const handleIdacSigUpdated = () => {
     setIdacSignature(getSavedIdacSignature());
   };
   window.addEventListener('baf_idac_signature_updated', handleIdacSigUpdated);
   return () => window.removeEventListener('baf_idac_signature_updated', handleIdacSigUpdated);
 }, []);

 // Helper to format short month & year for signature footer: e.g. "Sep 26"
 const formatRosterMonthShort = (dateStr: string) => {
   if (!dateStr) return '';
   const [yStr, mStr] = dateStr.split('-');
   const y = parseInt(yStr, 10);
   const m = parseInt(mStr, 10) - 1;
   const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
   const monthName = months[m] || '';
   const shortYr = String(y).slice(-2);
   return `${monthName} ${shortYr}`;
 };

 // Helper to format full month display: e.g. "Month: November 26"
 const formatMonthNameDisplay = (dateStr: string) => {
   if (!dateStr) return '';
   const [yStr, mStr] = dateStr.split('-');
   const y = parseInt(yStr, 10);
   const m = parseInt(mStr, 10) - 1;
   const months = [
     'January', 'February', 'March', 'April', 'May', 'June',
     'July', 'August', 'September', 'October', 'November', 'December'
   ];
   const monthName = months[m] || '';
   const shortYr = String(y).slice(-2);
   return `Month: ${monthName} ${shortYr}`;
 };

 const setFullMonthRange = (year: number, monthIndex: number) => {
   const mm = String(monthIndex + 1).padStart(2, '0');
   const lastDay = new Date(year, monthIndex + 1, 0).getDate();
   setFromDate(`${year}-${mm}-01`);
   setToDate(`${year}-${mm}-${String(lastDay).padStart(2, '0')}`);
   setWeekPreset('FULL_MONTH');
 };

 const handlePrevMonth = () => {
   const base = fromDate || selectedDate || '2026-11-01';
   const [yStr, mStr] = base.split('-');
   let y = parseInt(yStr, 10);
   let m = parseInt(mStr, 10) - 1;
   m -= 1;
   if (m < 0) {
     m = 11;
     y -= 1;
   }
   setFullMonthRange(y, m);
 };

 const handleNextMonth = () => {
   const base = fromDate || selectedDate || '2026-11-01';
   const [yStr, mStr] = base.split('-');
   let y = parseInt(yStr, 10);
   let m = parseInt(mStr, 10) - 1;
   m += 1;
   if (m > 11) {
     m = 0;
     y += 1;
   }
   setFullMonthRange(y, m);
 };

 // Load assignments for months covered by fromDate and toDate
 const fetchRosterData = async () => {
 setLoading(true);
 try {
 const fromMonth = fromDate.slice(0, 7);
 const toMonth = toDate.slice(0, 7);
 const months = Array.from(new Set([fromMonth, toMonth]));

 const promises = months.map((mKey) =>
 fetch(`/api/roster?month=${mKey}`)
 .then(async (res) => {
 if (!res.ok) return [];
 const data = await res.json();
 if (data && Array.isArray(data.assignments)) {
 return data.assignments as DutyAssignment[];
 }
 if (Array.isArray(data)) {
 return data as DutyAssignment[];
 }
 return [];
 })
 .catch(() => [] as DutyAssignment[])
 );

 const results = await Promise.all(promises);
 const all = results.flat();
 setAssignments(all);
 } catch (err) {
 console.error('Failed to fetch period assignments:', err);
 } finally {
 setLoading(false);
 }
 };

 useEffect(() => {
 fetchRosterData();
 const handleGlobalUpdate = () => {
 fetchRosterData();
 };
 window.addEventListener('baf_state_updated', handleGlobalUpdate);
 return () => {
 window.removeEventListener('baf_state_updated', handleGlobalUpdate);
 };
 }, [fromDate, toDate]);

 // Format date range header: e.g. "14 Aug 26 – 20 Aug 26"
 const formatDateForHeader = (dateStr: string) => {
 if (!dateStr) return '';
 const [y, m, d] = dateStr.split('-').map(Number);
 const dateObj = new Date(Date.UTC(y, m - 1, d));
 const day = String(dateObj.getUTCDate()).padStart(2, '0');
 const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
 const month = months[dateObj.getUTCMonth()];
 const yr = String(dateObj.getUTCFullYear()).slice(-2);
 return `${day} ${month} ${yr}`;
 };

 const headerDateRange = `${formatDateForHeader(fromDate)} – ${formatDateForHeader(toDate)}`;

 // Generate date list in range
 const getDatesList = (startStr: string, endStr: string): string[] => {
 const list: string[] = [];
 try {
 const [sY, sM, sD] = startStr.split('-').map(Number);
 const [eY, eM, eD] = endStr.split('-').map(Number);
 const curr = new Date(Date.UTC(sY, sM - 1, sD));
 const end = new Date(Date.UTC(eY, eM - 1, eD));
 let limit = 0;
 while (curr <= end && limit < 65) {
 const yy = curr.getUTCFullYear();
 const mm = String(curr.getUTCMonth() + 1).padStart(2, '0');
 const dd = String(curr.getUTCDate()).padStart(2, '0');
 list.push(`${yy}-${mm}-${dd}`);
 curr.setUTCDate(curr.getUTCDate() + 1);
 limit++;
 }
 } catch (e) {
 // fallback
 }
 return list;
 };

 const activeDates = getDatesList(fromDate, toDate);

 // Helper to format list of consecutive day numbers into range string:
 // e.g. [1, 2, 3, 4] -> "1-4"
 // e.g. [1, 2, 3, 4, 10, 11] -> "1-4, 10-11"
 // e.g. [14, 15] -> "14-15"
 // e.g. [5] -> "5"
 const compressConsecutiveDays = (daysList: number[]): string => {
 if (!daysList || daysList.length === 0) return '';
 const sorted = Array.from(new Set(daysList)).sort((a, b) => a - b);
 const ranges: string[] = [];
 let start = sorted[0];
 let prev = sorted[0];

 for (let k = 1; k < sorted.length; k++) {
 const curr = sorted[k];
 if (curr === prev + 1) {
 prev = curr;
 } else {
 ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
 start = curr;
 prev = curr;
 }
 }
 ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
 return ranges.join(', ');
 };

 const airmanMap = useMemo(() => {
   const map = new Map<string, Airman>();
   airmen.forEach((a) => {
     map.set(a.id, a);
     if (a.serNo) {
       map.set(`airman-${a.serNo}`, a);
     }
     if (a.bdNo) {
       const d = String(a.bdNo).replace(/\D/g, '');
       map.set(a.bdNo, a);
       map.set(`BD/${a.bdNo}`, a);
       map.set(`BD_${a.bdNo}`, a);
       if (d) {
         map.set(d, a);
         map.set(`BD/${d}`, a);
         map.set(`BD_${d}`, a);
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

 // Build Option 1: Base Duty (Up to Najirpara Taskforce / NTF)
 // Sections:
 // 1. SY DUTY (Cpl & Below) (GD)
 // 2. BASE TASKFORCE (BTF)
 // 3. NAZIRPARA TASKFORCE (NTF)
 const buildSectionItems = (dutyFilter: (code: string) => boolean): RosterExportItem[] => {
 // Collect all duty assignments matching filter in the active dates
 const assignmentsByDate = new Map<string, DutyAssignment[]>();
 activeDates.forEach(dStr => {
 const dayAss = assignments.filter((a) => a.date === dStr && dutyFilter(a.dutyCode));
 assignmentsByDate.set(dStr, dayAss);
 });

 // Extract all unique airmen involved (by canonical airman.id), filtered by Flight or Trade
 const involvedAirmenMap = new Map<string, Airman>();
 assignmentsByDate.forEach(assList => {
 assList.forEach(a => {
   const resolved = airmanMap.get(a.airmanId);
   if (resolved) {
     if (officeHasFlights && flightFilter !== 'All' && resolved.flightName !== flightFilter) return;
     if (!officeHasFlights && tradeFilter !== 'All' && resolved.trade !== tradeFilter) return;
     involvedAirmenMap.set(resolved.id, resolved);
   }
 });
 });

 // Create blocks of consecutive duties for each airman
 interface DutyBlock {
 airman: Airman;
 startDate: string;
 endDate: string;
 dates: string[];
 }
 const allBlocks: DutyBlock[] = [];

 involvedAirmenMap.forEach((airman) => {
 // get dates this airman has duty, sorted chronologically
 const airmanDates = activeDates.filter(dStr => {
 const dayAss = assignmentsByDate.get(dStr);
 return dayAss && dayAss.some(a => airmanMap.get(a.airmanId)?.id === airman.id);
 });

 if (airmanDates.length === 0) return;

 let currentBlock: DutyBlock = { airman, startDate: airmanDates[0], endDate: airmanDates[0], dates: [airmanDates[0]] };
 
 for (let i = 1; i < airmanDates.length; i++) {
 const prevDate = new Date(airmanDates[i - 1]);
 const currDate = new Date(airmanDates[i]);
 const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 3600 * 24));
 
 if (diffDays === 1) {
 // Consecutive
 currentBlock.endDate = airmanDates[i];
 currentBlock.dates.push(airmanDates[i]);
 } else {
 // Break in sequence -> push old block, start new
 allBlocks.push(currentBlock);
 currentBlock = { airman, startDate: airmanDates[i], endDate: airmanDates[i], dates: [airmanDates[i]] };
 }
 }
 allBlocks.push(currentBlock);
 });

 // Sort all blocks primarily by start date, then by rank seniority
 allBlocks.sort((a, b) => {
 const dateCmp = a.startDate.localeCompare(b.startDate);
 if (dateCmp !== 0) return dateCmp;
 return (a.airman.serNo || 999) - (b.airman.serNo || 999);
 });

 const output: RosterExportItem[] = [];
 let serCounter = 1;

 allBlocks.forEach(block => {
 const getDayNum = (dStr: string) => parseInt(dStr.split('-')[2], 10);
 const startDay = getDayNum(block.startDate);
 const endDay = getDayNum(block.endDate);
 
 let dateRangeStr = `${startDay}`;
 if (startDay !== endDay) {
 dateRangeStr = `${startDay}-${endDay}`;
 }

 const initBaseline = INITIAL_AIRMEN.find(
   (i) => i.id === block.airman.id || i.bdNo === block.airman.bdNo
 );
 const rawBlock = block.airman.addressBlock || initBaseline?.addressBlock;
 const rawMobile = block.airman.mobileNo || initBaseline?.mobileNo;

 output.push({
 serNo: String(serCounter).padStart(2, '0'),
 bdNo: (block.airman.bdNo || '').replace('BD/', ''),
 rank: formatRank(block.airman.rank),
 name: block.airman.name,
 trade: block.airman.trade,
 block: formatBlockName(rawBlock),
 mobileNo: rawMobile || '-',
 dateStr: dateRangeStr,
 section: getActiveOfficeIdentity().officeName,
 });
 serCounter++;
 });

 return output;
 };

 const dutyMatrix = useMemo(() => {
   return getStoredDutyMatrix(fromDate);
 }, [fromDate, matrixRevision]);

 const baseDutiesSections: RosterSectionData[] = useMemo(() => {
   const excludedCodes = new Set([
     'IDAC',
     'IDA',
     'IDA C',
     'IDA_C',
     'IDAC CENTER',
     'IDA CENTER',
     'AIRPORT',
     'AIRFIELD',
     'RECEPTION',
     'ON_PARADE',
     'DUTY_OFF',
     'LEAVE',
     'TDY',
     'ATT',
     'DETT',
     'BAKE_N_BITE',
     'BAKE_BITE',
     'CANTEEN',
   ]);

   const builtSections: RosterSectionData[] = [];
   const handledCodes = new Set<string>();

   const sortedMatrix = [...dutyMatrix].sort(
     (a, b) => (Number(a.serNo) || 999) - (Number(b.serNo) || 999)
   );

   sortedMatrix.forEach((tbl) => {
     const codeUpper = String(tbl.dutyCode || '').trim().toUpperCase();
     const idLower = String(tbl.id || '').trim().toLowerCase();
     if (!codeUpper || excludedCodes.has(codeUpper) || idLower.startsWith('idac_')) return;
     if (handledCodes.has(codeUpper)) return;
     handledCodes.add(codeUpper);

     const isSecurityDuty = codeUpper === 'GD' || idLower === 'security_duty';
     const items = buildSectionItems((c) => {
       const cu = String(c || '').trim().toUpperCase();
       if (isSecurityDuty) {
         return cu === 'GD' || cu === 'SY' || cu === 'SY_DUTY' || cu === 'SECURITY';
       }
       return cu === codeUpper;
     });

     const fullTitle = (tbl.title || '').trim() || codeUpper;
     let subTitle: string | undefined;
     if (isSecurityDuty && Array.isArray(tbl.eligibleRanks) && tbl.eligibleRanks.length > 0) {
       const hasSenior = tbl.eligibleRanks.some((r) => ['MWO', 'SWO', 'WO', 'Sgt'].includes(r));
       if (!hasSenior) {
         subTitle = 'Cpl & Below';
       }
     }

     builtSections.push({
       title: fullTitle,
       ...(subTitle ? { subTitle } : {}),
       items,
     });
   });

   // Fallback for core Base Duties if matrix has no matching entries
   const fallbackDefs: Array<{
     code: string;
     match: (c: string) => boolean;
     title: string;
     subTitle?: string;
   }> = [
     { code: 'GD', match: (c) => c === 'GD' || c === 'SY', title: 'BASE SECURITY DUTY', subTitle: 'Cpl & Below' },
     { code: 'BTF', match: (c) => c === 'BTF', title: 'BASE TASKFORCE DUTY' },
     { code: 'NTF', match: (c) => c === 'NTF', title: 'NAJIRPARA TASKFORCE DUTY' },
     { code: 'HALISHAHAR', match: (c) => c === 'HALISHAHAR', title: 'HALISHAHAR TASKFORCE DUTY' },
   ];

   fallbackDefs.forEach((fb) => {
     if (!handledCodes.has(fb.code)) {
       builtSections.push({
         title: fb.title,
         ...(fb.subTitle ? { subTitle: fb.subTitle } : {}),
         items: buildSectionItems(fb.match),
       });
     }
   });

   return builtSections;
 }, [dutyMatrix, assignments, activeDates, airmanMap, officeHasFlights, flightFilter, tradeFilter]);

 // Format shift cell with proxy flight tag and flight placeholder fallback
 const formatShiftDutyDisplay = (
 dateStr: string,
 shift: 'Morning' | 'Afternoon' | 'Night',
 shiftAssignments: DutyAssignment[],
 airMap: Map<string, Airman>
 ): string => {
 const flightOrder: FlightName[] = (officeHasFlights && flightFilter !== 'All')
   ? [flightFilter]
   : ['Avionics', 'Mechanics', 'GCS', 'Admin'];
 const requiredFlightSlots: FlightName[] = [];
 if (!(!officeHasFlights && tradeFilter !== 'All')) {
   flightOrder.forEach((fl) => {
     const count = getFlightDutyQuotaForDate(dateStr, fl, 'IDAC', shift);
     for (let i = 0; i < count; i++) {
       requiredFlightSlots.push(fl);
     }
   });
 }

 const getFlightShort = (fl: string) => {
 if (!fl) return '';
 if (fl.toLowerCase().includes('av')) return 'Avi Flt';
 if (fl.toLowerCase().includes('mech')) return 'Mech Flt';
 if (fl.toLowerCase().includes('gcs')) return 'GCS Flt';
 if (fl.toLowerCase().includes('admin') || fl.toLowerCase().includes('admn')) return 'Admn Flt';
 return `${fl} Flt`;
 };

 const assignedParts: string[] = [];
 const fulfilledFlights: FlightName[] = [];

 // Deduplicate airmen within the same shift cell to prevent duplicate names
 const uniqueShiftAssignments: DutyAssignment[] = [];
 const seenAirmenInShift = new Set<string>();
 shiftAssignments.forEach((a) => {
 const rawId = (a.airmanId || '').replace(/^BD[_-]/, '');
 if (!seenAirmenInShift.has(rawId)) {
 seenAirmenInShift.add(rawId);
 uniqueShiftAssignments.push(a);
 }
 });

 uniqueShiftAssignments.forEach((a) => {
 const air = airMap.get(a.airmanId);
 if (!air) {
 if (officeHasFlights && flightFilter !== 'All') return;
 if (!officeHasFlights && tradeFilter !== 'All') return;
 assignedParts.push(a.notes || 'Duty Airman');
 return;
 }

 if (officeHasFlights && flightFilter !== 'All' && air.flightName !== flightFilter && a.proxyForFlight !== flightFilter) {
   return;
 }
 if (!officeHasFlights && tradeFilter !== 'All' && air.trade !== tradeFilter) {
   return;
 }

 const proxyFlight = a.proxyForFlight;
 const isProxy = proxyFlight && proxyFlight !== air.flightName;

 if (isProxy) {
 assignedParts.push(`${formatRank(air.rank)} ${air.name} (${getFlightShort(proxyFlight)})`);
 fulfilledFlights.push(proxyFlight);
 } else {
 assignedParts.push(`${formatRank(air.rank)} ${air.name}`);
 if (air.flightName) fulfilledFlights.push(air.flightName);
 }
 });

 // Calculate remaining unassigned flights from matrix quotas
 const remainingFlights = [...requiredFlightSlots];
 for (const ff of fulfilledFlights) {
 const idx = remainingFlights.indexOf(ff);
 if (idx !== -1) {
 remainingFlights.splice(idx, 1);
 } else if (remainingFlights.length > 0) {
 remainingFlights.shift();
 }
 }

 // Append flight placeholders for unfilled slots
 const placeholderParts = remainingFlights.map((rf) => getFlightShort(rf));
 const allParts = [...assignedParts, ...placeholderParts];

 if (allParts.length > 0) {
 return allParts.join(' & ');
 }

 return '-';
 };

 // Build Option 2: IDAC Center Duty Table Rows (Matching Attached BAF Format)
 // Format: Date | Day | Morning (0730F - 1430F) | Afternoon (1430F - 2100F) | Night (2100F - 0730F)

 const idacRosterRows: IdacRosterRow[] = activeDates.map((dateStr) => {
 const [y, m, d] = dateStr.split('-').map(Number);
 const dObj = new Date(Date.UTC(y, m - 1, d));
 const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dObj.getUTCDay()];
 const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
 const dateDisplay = `${d} ${months[dObj.getUTCMonth()]}`;

 const dateAss = assignments.filter((a) => a.date === dateStr && (a.dutyCode === 'IDAC' || a.dutyCode === 'IDA'));

 const getIdaShift = (a: any): 'Morning' | 'Afternoon' | 'Night' => {
 const raw = (a.idaShift || a.shift || a.notes || '').toString().trim();
 if (/night/i.test(raw) || raw === 'C' || raw === '3' || raw === 'I-N') return 'Night';
 if (/afternoon/i.test(raw) || raw === 'B' || raw === '2' || raw === 'I-A') return 'Afternoon';
 return 'Morning';
 };

 // Extract Morning, Afternoon, Night shift assignments
 const morningAss = dateAss.filter((a) => getIdaShift(a) === 'Morning');
 const afternoonAss = dateAss.filter((a) => getIdaShift(a) === 'Afternoon');
 const nightAss = dateAss.filter((a) => getIdaShift(a) === 'Night');

 const morningDisplay = formatShiftDutyDisplay(dateStr, 'Morning', morningAss, airmanMap);
 const afternoonDisplay = formatShiftDutyDisplay(dateStr, 'Afternoon', afternoonAss, airmanMap);
 const nightDisplay = formatShiftDutyDisplay(dateStr, 'Night', nightAss, airmanMap);

 return {
 dateDisplay,
 dayDisplay: dayName,
 morning: morningDisplay,
 afternoon: afternoonDisplay,
 night: nightDisplay,
 };
 });

 const getRosterBaseFileName = () => {
   const activeOfficeName = getActiveOfficeIdentity().officeName || '155 UASU BAF';
   const safeOffice = activeOfficeName.replace(/\s+/g, '_');
   if (rosterMode === 'BASE_DUTIES') {
     return `Base_Duties_Roster_${safeOffice}_${fromDate}_to_${toDate}`;
   }
   return `IDAC_Duty_Roster_${safeOffice}_${weekPreset === 'FULL_MONTH' ? fromDate.slice(0, 7) : `${fromDate}_to_${toDate}`}`;
 };

 // Handle Export PDF (.pdf)
 const handleExportPdf = async () => {
   setShowExportMenu(false);
   if (isExportingRef.current) return;
   isExportingRef.current = true;
   try {
     await exportElementToPdf({
       elementId: 'duty-roster-document',
       fileName: `${getRosterBaseFileName()}.pdf`,
       format: pageSetup.paperSize,
       orientation: pageSetup.orientation,
     });
   } catch (err) {
     console.error('Error generating pdf file:', err);
   } finally {
     isExportingRef.current = false;
   }
 };

 // Handle Export Word Document (.docx)
 const handleExportDocx = async () => {
   setShowExportMenu(false);
   if (isExportingRef.current) return;
   isExportingRef.current = true;
   try {
     const activeOfficeName = getActiveOfficeIdentity().officeName || '155 UASU BAF';
     if (rosterMode === 'BASE_DUTIES') {
       await exportDutyRosterDocx(
         activeOfficeName,
         headerDateRange,
         baseDutiesSections,
         `${getRosterBaseFileName()}.docx`,
         pageSetup
       );
     } else {
       const dateSub = weekPreset === 'FULL_MONTH' ? formatMonthNameDisplay(fromDate) : headerDateRange;
       await exportIdacRosterDocx(
         activeOfficeName,
         dateSub,
         idacRosterRows,
         `${getRosterBaseFileName()}.docx`,
         idacSignature,
         formatRosterMonthShort(fromDate),
         pageSetup
       );
     }
   } catch (err) {
     console.error('Error generating docx file:', err);
   } finally {
     isExportingRef.current = false;
   }
 };

 const topContent = (
 <>
 {/* Top Header & Option Selector Card */}
 <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 dark:border-slate-700 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
 <div>
 <div className="flex items-center space-x-2 text-emerald-700 dark:text-emerald-400 text-xs font-black uppercase tracking-wider">
 <Layers className="w-4 h-4" />
 <span>Official Duty Roster Generator • {getActiveOfficeIdentity().officeName}</span>
 </div>
 <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white mt-1">
 Duty Roster Formats
 </h1>
 <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
 Export and print standard {getActiveOfficeIdentity().officeName} duty roster formats and Word documents.
 </p>
 </div>

 {/* Date Filter & Export Buttons */}
 <div className="flex flex-wrap items-center gap-2.5 self-end md:self-auto">
 {/* Quick Week / Period Presets */}
 <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold space-x-1">
 <button
 onClick={() => {
 const range = getDutyWeekRange(selectedDate || '2026-08-14', 0);
 setFromDate(range.from);
 setToDate(range.to);
 setWeekPreset('THIS_WEEK');
 }}
 className={`px-3 py-1.5 rounded-lg transition-all ${
 weekPreset === 'THIS_WEEK'
 ? 'bg-emerald-600 text-white shadow-xs font-black'
 : 'text-slate-700 dark:text-slate-300 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
 }`}
 >
 This Week (Fri – Thu)
 </button>
 <button
 onClick={() => {
 const range = getDutyWeekRange(selectedDate || '2026-08-14', 1);
 setFromDate(range.from);
 setToDate(range.to);
 setWeekPreset('NEXT_WEEK');
 }}
 className={`px-3 py-1.5 rounded-lg transition-all ${
 weekPreset === 'NEXT_WEEK'
 ? 'bg-emerald-600 text-white shadow-xs font-black'
 : 'text-slate-700 dark:text-slate-300 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
 }`}
 >
 Next Week (Fri – Thu)
 </button>
 <button
 onClick={() => {
 const baseDate = fromDate || selectedDate || '2026-11-01';
 const [yStr, mStr] = baseDate.split('-');
 const y = parseInt(yStr, 10);
 const m = parseInt(mStr, 10) - 1;
 setFullMonthRange(y, m);
 }}
 className={`px-2.5 py-1.5 rounded-lg transition-all ${
 weekPreset === 'FULL_MONTH'
 ? 'bg-emerald-600 text-white shadow-xs font-black'
 : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
 }`}
 >
 Full Month
 </button>
 </div>

 {weekPreset === 'FULL_MONTH' ? (
 <div className="flex items-center bg-slate-100 dark:bg-slate-800 px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold space-x-1.5">
 <button
 type="button"
 onClick={handlePrevMonth}
 className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
 title="Previous Month"
 >
 <ChevronLeft className="w-4 h-4" />
 </button>
 <span className="text-slate-900 dark:text-white font-black px-2 select-none whitespace-nowrap">
 {formatMonthNameDisplay(fromDate)}
 </span>
 <button
 type="button"
 onClick={handleNextMonth}
 className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
 title="Next Month"
 >
 <ChevronRight className="w-4 h-4" />
 </button>
 </div>
 ) : (
 <div className="flex items-center bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold space-x-2">
 <span className="text-slate-500 font-semibold">From:</span>
 <DateNavigator
 value={fromDate || ''}
 onChange={(e) => {
 setFromDate(e.target.value);
 setWeekPreset('CUSTOM');
 }}
 className="bg-transparent text-slate-900 dark:text-white font-black outline-none cursor-pointer"
 />
 <span className="text-slate-400 font-semibold">To:</span>
 <DateNavigator
 value={toDate || ''}
 onChange={(e) => {
 setToDate(e.target.value);
 setWeekPreset('CUSTOM');
 }}
 className="bg-transparent text-slate-900 dark:text-white font-black outline-none cursor-pointer"
 />
 </div>
 )}

 {/* Signatures Settings Button (Only visible when IDAC Duty is selected) */}
 {rosterMode === 'IDAC_DUTY' && (
 <button
 type="button"
 onClick={() => setShowIdacSignatureModal(true)}
 className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-300 dark:border-slate-700 rounded-xl font-bold text-xs shadow-xs transition-colors cursor-pointer"
 title="IDAC Duty Signatures"
 >
 <PenTool className="w-4 h-4 text-blue-600 dark:text-blue-400" />
 <span>Signatures</span>
 </button>
 )}

 {/* Export Dropdown Button (PDF / DOCX Direct Download) */}
 <div className="relative" ref={exportDropdownRef}>
   <button
     type="button"
     onClick={() => setShowExportMenu((prev) => !prev)}
     className="flex items-center space-x-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-emerald-900/20 transition-all cursor-pointer"
     title="Export PDF or DOCX"
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
         onClick={handleExportDocx}
         className="w-full flex items-center space-x-2.5 px-4 py-2.5 text-left text-xs font-bold text-slate-800 dark:text-slate-100 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 hover:text-emerald-700 dark:hover:text-emerald-300 transition-colors cursor-pointer border-t border-slate-100 dark:border-slate-700/70"
       >
         <FileDown className="w-4 h-4 text-blue-500 shrink-0" />
         <span>Docx (.docx)</span>
       </button>
     </div>
   )}
 </div>
 </div>
 </div>

 {/* 2 OPTIONS / TABS SWITCHER + FLIGHT / TRADE FILTER */}
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 dark:border-slate-700 pb-3">
 <div className="flex items-center space-x-3">
 <button
 onClick={() => setRosterMode('BASE_DUTIES')}
 className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl font-black text-xs transition-all shadow-xs ${
 rosterMode === 'BASE_DUTIES'
 ? 'bg-emerald-600 text-white shadow-emerald-600/20'
 : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
 }`}
 >
 <Shield className="w-4 h-4" />
 <span>Base Duty</span>
 </button>

 {is155Uasu && (
 <button
 onClick={() => setRosterMode('IDAC_DUTY')}
 className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl font-black text-xs transition-all shadow-xs ${
 rosterMode === 'IDAC_DUTY'
 ? 'bg-blue-700 text-white shadow-blue-700/20'
 : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
 }`}
 >
 <Clock className="w-4 h-4" />
 <span>IDAC Duty</span>
 </button>
 )}
 </div>

 {/* Flight Filter (when office has flights) OR Trade Filter (when office has no flights) */}
 {officeHasFlights ? (
   <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
     <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 px-2 flex items-center gap-1">
       <ListFilter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
       <span>Flight:</span>
     </span>
     {flightsList.map((flt) => (
       <button
         key={flt}
         type="button"
         onClick={() => setFlightFilter(flt)}
         className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
           flightFilter === flt
             ? 'bg-emerald-600 text-white shadow-xs font-black'
             : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
         }`}
       >
         {flt === 'All' ? 'All Flights' : flt}
       </button>
     ))}
   </div>
 ) : (
   <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
     <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 px-2 flex items-center gap-1">
       <ListFilter className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
       <span>Trade:</span>
     </span>
     {tradesList.map((tr) => (
       <button
         key={tr}
         type="button"
         onClick={() => setTradeFilter(tr)}
         className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
           tradeFilter === tr
             ? 'bg-emerald-600 text-white shadow-xs font-black'
             : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
         }`}
       >
         {tr === 'All' ? 'All Trades' : tr}
       </button>
     ))}
   </div>
 )}
 </div>

 
    </>
  );

  const renderDocument = () => (
    <div className="space-y-4">
      {/* PAGE SETUP BAR DIRECTLY ABOVE PREVIEW */}
      <PageSetupBar
        value={pageSetup}
        onChange={setPageSetup}
        defaultLabel="Default: A4 Portrait"
      />

      {/* ACTUAL PRINTABLE WHITE PAPER PREVIEW IN SELECTED PAGE SETUP */}
      <div className="bg-slate-200/70 dark:bg-slate-950/60 border border-slate-300/70 dark:border-slate-800 rounded-2xl p-3 sm:p-5 overflow-x-auto print:bg-white print:border-none print:p-0">
        <div
          id="duty-roster-document"
          className="bg-white text-black border border-slate-300 rounded-2xl shadow-xl p-6 sm:p-10 mx-auto overflow-x-auto print:bg-white print:text-black print:border-none print:shadow-none print:p-0"
          style={{
            width: '100%',
            maxWidth: `${pageDims.widthPx}px`,
            minHeight: `${Math.round(pageDims.heightPx * 0.72)}px`,
          }}
        >
      {/* ========================================================================= */}
 {/* OPTION 1: BASE DUTY (Up to Najirpara Taskforce with Range 1-4 Format) */}
 {/* ========================================================================= */}
 {rosterMode === 'BASE_DUTIES' && (
 <div className="bg-white text-black font-sans">
 {/* Document Header */}
 <div data-pdf-repeat-header="true" className="text-center pb-4 border-b border-slate-300">
 <div className="flex justify-center mb-2">
 <Logo155UASU className="h-14 w-14" />
 </div>
 <h2 className="text-base sm:text-lg font-black uppercase tracking-wider underline text-black">
 BASE DUTY: AIRMEN
 </h2>
 <h3 className="text-sm font-bold text-black mt-0.5">
 ({getActiveOfficeIdentity().officeName})
 </h3>
 <p className="text-xs font-bold text-black mt-1">
 ({headerDateRange})
 </p>
 </div>

 {/* Section Tables */}
 <div className="mt-6 space-y-8">
 {baseDutiesSections.map((sec, sIdx) => {
 if (sec.items.length === 0) return null;

 return (
 <div key={sIdx} className="space-y-2">
 {/* Section Title */}
 <div data-pdf-section-heading="true" className="text-center">
 <h4 className="text-xs sm:text-sm font-black uppercase tracking-wider underline text-black">
 {sec.title}
 </h4>
 {sec.subTitle && (
 <div className="text-[11px] font-bold text-black">
 ({sec.subTitle})
 </div>
 )}
 </div>

 {/* Table */}
 <div className="overflow-x-auto">
 <table className="no-zebra w-full text-center border-collapse border border-black text-xs font-medium text-black">
 <thead>
 <tr className="pdf-thead-light bg-[#f8fafc] font-bold border-b border-black text-[11px] text-black">
 <th className="border border-black py-1.5 px-2 w-12">Ser No</th>
 <th className="border border-black py-1.5 px-2">BD No</th>
 <th className="border border-black py-1.5 px-2">Rank</th>
 <th className="border border-black py-1.5 px-3 text-center">Name</th>
 <th className="border border-black py-1.5 px-2">Trade</th>
 <th className="border border-black py-1.5 px-2">Block</th>
 <th className="border border-black py-1.5 px-2">Mobile No</th>
 <th className="border border-black py-1.5 px-2">Date</th>
 </tr>
 </thead>
 <tbody>
 {sec.items.map((item, idx) => (
 <tr key={idx} className={`border-b border-black ${idx % 2 === 1 ? 'pdf-alt-row bg-[#f8fafc]' : 'bg-white'}`}>
 <td className="border border-black py-1 px-2 font-mono">
 {item.serNo}
 </td>
 <td className="border border-black py-1 px-2 font-mono font-bold">
 {item.bdNo}
 </td>
 <td className="border border-black py-1 px-2 font-bold">
 {item.rank}
 </td>
 <td className="border border-black py-1 px-3 text-center font-bold">
 {item.name}
 </td>
 <td className="border border-black py-1 px-2">
 {item.trade}
 </td>
 <td className="border border-black py-1 px-2 font-mono">
 {item.block}
 </td>
 <td className="border border-black py-1 px-2 font-mono font-bold text-black">
 {item.mobileNo}
 </td>
 <td className="border border-black py-1 px-2 font-bold text-black">
 {item.dateStr}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 );
 })}

 {/* Empty notice if no duties in this period */}
 {baseDutiesSections.every((s) => s.items.length === 0) && (
 <div className="py-12 text-center text-slate-500">
 <p className="text-sm font-semibold">
 No base duties assigned for the period {headerDateRange}.
 </p>
 <p className="text-xs mt-1">
 Assign duties from the Duty Register or Overview to populate this roster.
 </p>
 </div>
 )}
 </div>
 </div>
 )}

 {/* ========================================================================= */}
 {/* OPTION 2: IDAC DUTY (IDA CENTER DUTY - Font 12 Arial, Bold Header, Normal Below) */}
 {/* ========================================================================= */}
 {rosterMode === 'IDAC_DUTY' && (
 <div
 id="idac-duty-roster-sheet"
 className="bg-white text-black font-[Arial,Helvetica,sans-serif]"
 style={{ fontFamily: 'Arial, sans-serif' }}
 >
 {/* Document Header */}
 <div data-pdf-repeat-header="true" className="text-center pb-5 border-b border-slate-300">
 <div className="flex justify-center mb-2">
 <Logo155UASU className="h-14 w-14" />
 </div>
 <h2 className="text-base sm:text-lg font-bold uppercase tracking-wide underline text-black">
 IDAC DUTY ROSTER : {getActiveOfficeIdentity().officeName}
 </h2>
 <p className="text-xs font-bold text-black mt-1">
 {weekPreset === 'FULL_MONTH' ? formatMonthNameDisplay(fromDate) : `(${headerDateRange})`}
 </p>
 </div>

 {/* IDA Center Duty Table */}
 <div className="mt-6 overflow-x-auto">
 <table
 className="no-zebra w-full text-center border-collapse border border-black text-black"
 style={{
 fontFamily: 'Arial, sans-serif',
 fontSize: '12pt',
 lineHeight: '1.4',
 }}
 >
 <thead>
 {/* Table Heading Row Bold */}
 <tr className="pdf-thead-light bg-[#f8fafc] font-bold border-b border-black text-black">
 <th className="border border-black py-2.5 px-3 font-bold w-24">Date</th>
 <th className="border border-black py-2.5 px-3 font-bold w-28">Day</th>
 <th className="border border-black py-2.5 px-4 font-bold">
 Morning
 <div className="text-[10pt] font-normal text-slate-700">(0730F - 1430F)</div>
 </th>
 <th className="border border-black py-2.5 px-4 font-bold">
 Afternoon
 <div className="text-[10pt] font-normal text-slate-700">(1430F - 2100F)</div>
 </th>
 <th className="border border-black py-2.5 px-4 font-bold">
 Night
 <div className="text-[10pt] font-normal text-slate-700">(2100F - 0730F)</div>
 </th>
 </tr>
 </thead>
 <tbody>
 {/* Data Rows: Normal Weight below heading */}
 {idacRosterRows.map((row, idx) => (
 <tr
 key={idx}
 className={`border-b border-black ${idx % 2 === 1 ? 'pdf-alt-row bg-[#f8fafc]' : 'bg-white'}`}
 >
 {/* Date */}
 <td className="border border-black py-2 px-3 font-normal text-black whitespace-nowrap">
 {row.dateDisplay}
 </td>

 {/* Day */}
 <td className="border border-black py-2 px-3 font-normal text-black whitespace-nowrap">
 {row.dayDisplay}
 </td>

 {/* Morning (0730F - 1430F) */}
 <td className="border border-black py-2 px-3 font-normal text-black">
 {row.morning}
 </td>

 {/* Afternoon (1430F - 2100F) */}
 <td className="border border-black py-2 px-3 font-normal text-black">
 {row.afternoon}
 </td>

 {/* Night (2100F - 0730F) */}
 <td className="border border-black py-2 px-3 font-normal text-black">
 {row.night}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>

 {/* Spacer to provide signature headroom */}
 <div className="w-full" style={{ height: '0.8in' }} />

 {/* Official Signature Footer (Right Side - Authorized By) */}
 <div
 data-pdf-keep-together="true"
 className="flex justify-end items-end pt-2 text-black text-xs"
 style={{ fontFamily: 'Arial, sans-serif' }}
 >
 <div
 onClick={() => setShowIdacSignatureModal(true)}
 className="text-left font-bold min-w-[210px] cursor-pointer group select-none"
 title="Click to configure IDAC Duty signature"
 >
 {idacSignature.signDigitally && (
 <div className="mb-1 text-left font-serif italic text-xs text-black select-none">
 <span className="font-bold underline">
 {idacSignature.digitalSignatureText || idacSignature.name}
 </span>
 <span className="block text-[8px] font-mono not-italic text-slate-600">
 [Digitally Signed • BAF Verified]
 </span>
 </div>
 )}
 <div className="border-t border-black pt-1.5 group-hover:border-blue-600 transition-colors">
 <div className="text-xs uppercase font-black">{idacSignature.name}</div>
 <div className="text-[11px] font-normal">{idacSignature.rank}</div>
 <div className="text-[11px] font-normal">{idacSignature.designation}</div>
 <div className="text-[10px] uppercase font-bold">{idacSignature.unit || getActiveOfficeIdentity().officeName}</div>
 <div className="text-[11px] font-normal text-black mt-0.5">
 {formatRosterMonthShort(fromDate)}
 </div>
 </div>
 </div>
 </div>
 </div>
 )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="duty-register-print space-y-6">
      {topContent}
      {renderDocument()}
      {/* Dedicated IDAC Signature Modal (100% independent of Parade State) */}
      <IdacSignatureModal
        isOpen={showIdacSignatureModal}
        onClose={() => setShowIdacSignatureModal(false)}
        rosterMonthDisplay={formatRosterMonthShort(fromDate)}
        onSignatureUpdated={(updated) => {
          setIdacSignature(updated);
        }}
      />
    </div>
  );
};

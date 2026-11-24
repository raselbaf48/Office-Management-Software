import React, { useState, useRef, useEffect } from 'react';
import { Airman, BiodataImportBatch, FlightName, Rank } from '../types';
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  RefreshCw,
  Users,
  Shield,
  History,
  Clock,
  ChevronDown,
  ChevronUp,
  Search,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { localDb } from '../services/localDatabase';
import { exportAirmenTemplateExcel, normalizeDateToISO } from '../utils/csvExport';
import { isJcoRank } from '../utils/seniority';
import { getCurrentUserSession } from '../utils/authSession';
import { formatRank } from '../utils/rankFormatter';

interface BulkImportAirmenModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingAirmen: Airman[];
  onImportComplete: () => void;
}

export interface ParsedAirmanRow {
  id: string;
  seniority?: number;
  rank: string;
  fullName?: string;
  name: string;
  bdNo: string;
  trade: string;
  flightName: string;
  bloodGroup?: string;
  addressBlock: string;
  permanentAddress?: string;
  mobileNo: string;
  dateJoined?: string;
  remarks: string;
  hadTradeValue?: boolean;
  importAction?: 'NEW' | 'UPDATE' | 'UNCHANGED';
  matchedExistingId?: string;
  changedFields?: string[];
  changedFieldKeys?: string[];
  updatePatch?: Partial<Airman>;
  errors: string[];
  warnings: string[];
}

const VALID_RANKS: Rank[] = ['MWO', 'SWO', 'WO', 'Sgt', 'Cpl', 'LAC', 'AC-1', 'AC-2'];
const VALID_FLIGHTS: FlightName[] = ['Avionics', 'Mechanics', 'GCS', 'Admin'];

export const BulkImportAirmenModal: React.FC<BulkImportAirmenModalProps> = ({
  isOpen,
  onClose,
  existingAirmen,
  onImportComplete,
}) => {
  const [rows, setRows] = useState<ParsedAirmanRow[]>([]);
  const [activeTab, setActiveTab] = useState<'FILE' | 'HISTORY'>('FILE');
  const [fileName, setFileName] = useState<string>('');
  const [sourceType, setSourceType] = useState<'EXCEL' | 'CSV'>('EXCEL');
  const [hasFlightColumn, setHasFlightColumn] = useState<boolean>(false);
  const [replaceExistingOnDuplicate, setReplaceExistingOnDuplicate] = useState<boolean>(true);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [rowFilter, setRowFilter] = useState<'ALL' | 'INVALID' | 'NEW' | 'UPDATE' | 'UNCHANGED'>('ALL');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import History / Log state
  const [historyBatches, setHistoryBatches] = useState<BiodataImportBatch[]>([]);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [historySearchByBatch, setHistorySearchByBatch] = useState<Record<string, string>>({});
  const [batchToRemove, setBatchToRemove] = useState<BiodataImportBatch | null>(null);
  const [singleItemToRemove, setSingleItemToRemove] = useState<{
    batchId: string;
    batchFileName: string;
    item: BiodataImportBatch['airmenSummary'][number];
  } | null>(null);
  const [isRemovingHistory, setIsRemovingHistory] = useState<boolean>(false);
  const [historyFeedback, setHistoryFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadImportHistory = () => {
    setHistoryBatches(localDb.getBiodataImportHistory());
  };

  useEffect(() => {
    if (isOpen) {
      loadImportHistory();
      setHistoryFeedback(null);
      setBatchToRemove(null);
      setSingleItemToRemove(null);
    }
  }, [isOpen, existingAirmen]);

  if (!isOpen) return null;

  const normalizeBd = (bd: string) => {
    return bd.trim().replace(/^BD\/?/i, '').replace(/\s+/g, '').toLowerCase();
  };

  const normalizeRank = (raw: string): { rank: Rank; valid: boolean } => {
    const trimmed = raw.trim().toUpperCase().replace(/\s+/g, ' ');
    const found = VALID_RANKS.find((r) => r.toUpperCase() === trimmed);
    if (found) return { rank: found, valid: true };
    if (trimmed === 'MWO' || trimmed === 'MASTER WARRANT OFFICER') return { rank: 'MWO', valid: true };
    if (trimmed === 'SWO' || trimmed === 'SENIOR WARRANT OFFICER') return { rank: 'SWO', valid: true };
    if (trimmed === 'WO' || trimmed === 'WARRANT OFFICER') return { rank: 'WO', valid: true };
    if (trimmed === 'SGT' || trimmed === 'SERGEANT') return { rank: 'Sgt', valid: true };
    if (trimmed === 'CPL' || trimmed === 'CORPORAL') return { rank: 'Cpl', valid: true };
    if (trimmed === 'LAC' || trimmed === 'LEADING AIRMAN' || trimmed === 'LEADING AIRCRAFTMAN') return { rank: 'LAC', valid: true };
    // AC & AC-1 are the exact same rank
    if (
      trimmed === 'AC' ||
      trimmed === 'AC-1' ||
      trimmed === 'AC 1' ||
      trimmed === 'AC1' ||
      trimmed === 'AC-I' ||
      trimmed === 'AC_1' ||
      trimmed === 'AC.1' ||
      trimmed === 'AIRCRAFTMAN' ||
      trimmed === 'AIRCRAFTMAN 1' ||
      trimmed === 'AIRCRAFTMAN-1'
    ) {
      return { rank: 'AC-1', valid: true };
    }
    if (
      trimmed === 'AC-2' ||
      trimmed === 'AC 2' ||
      trimmed === 'AC2' ||
      trimmed === 'AC-II' ||
      trimmed === 'AC_2' ||
      trimmed === 'AC.2' ||
      trimmed === 'AIRCRAFTMAN 2' ||
      trimmed === 'AIRCRAFTMAN-2'
    ) {
      return { rank: 'AC-2', valid: true };
    }
    return { rank: 'LAC', valid: false };
  };

  const isSgtOrAboveRank = (rankStr: string): boolean => {
    const norm = normalizeRank(rankStr);
    const r = norm.valid ? norm.rank : rankStr.trim();
    return ['MWO', 'SWO', 'WO', 'Sgt'].includes(r);
  };

  /**
   * Smart Address Parser for Biodata Import:
   * - L/O -> Living Out (Outside Base: "L/O")
   * - Block/Room pattern like "12/23" or "12/13" -> Living In:
   *   - Sgt & above -> "Sgt's Mess, Block No: 12/23"
   *   - Cpl & below -> "Airmen's Mess, Block No: 12/23"
   */
  const formatImportedAddress = (rawAddr: string, rankStr: string): string => {
    const trimmed = String(rawAddr || '').trim();
    if (!trimmed || trimmed === '-' || trimmed.toLowerCase() === 'n/a') return '';

    const messName = isSgtOrAboveRank(rankStr) ? "Sgt's Mess" : "Airmen's Mess";

    // 1. L/O -> Living Out, Outside Base = "L/O"
    if (/^(?:l\s*\/\s*o|lo|living\s*out|live\s*out|outside\s*base\s*[-:,(\s]*l\s*\/\s*o\)?)$/i.test(trimmed)) {
      return 'L/O';
    }

    // 2. Service Quarter
    if (/^(?:svc\s*)?(?:qtr|quarter)\b/i.test(trimmed)) {
      const cleanQ = trimmed
        .replace(/^svc\s*qtr\s*(?:no\.?\s*[:\-]?\s*)?/i, '')
        .replace(/^qtr\s*(?:no\.?\s*[:\-]?\s*)?/i, '')
        .replace(/^quarter\s*(?:no\.?\s*[:\-]?\s*)?/i, '')
        .trim();
      return cleanQ ? `Svc Qtr No: ${cleanQ}` : 'L/O';
    }

    // 3. Already contains Sgt's Mess / Airmen's Mess -> align Mess name with Rank
    if (/(?:sgt'?s?|airmen'?s?)\s*mess/i.test(trimmed)) {
      const blkMatch = trimmed.match(/block\s*(?:no\.?\s*[:\-]?\s*)?(.+)$/i);
      const cleanBlk = blkMatch ? blkMatch[1].replace(/^[.\-\s]+|[.\-\s]+$/g, '').trim() : '';
      return cleanBlk ? `${messName}, Block No: ${cleanBlk}` : messName;
    }

    // 4. Plain L/I -> Living In (Mess only)
    if (/^(?:l\s*\/\s*i|li|living\s*in|live\s*in)$/i.test(trimmed)) {
      return messName;
    }

    // 5. Block/Room pattern like "12/23", "12/13", "B-12/23", "L/I 12/23", "Block 12/23" -> Living In
    const blockSlashMatch = trimmed.match(
      /^(?:(?:l\s*\/\s*i|living\s*in|live\s*in)\s*[-:,]?\s*)?(?:block\s*(?:no\.?\s*[:\-]?\s*)?)?([a-zA-Z]?\s*\d+\s*\/\s*\d+[a-zA-Z]?)$/i
    );
    if (blockSlashMatch) {
      const cleanBlk = blockSlashMatch[1].replace(/\s+/g, '').trim();
      return `${messName}, Block No: ${cleanBlk}`;
    }

    // 6. Explicit "Block ..." prefix -> Living In
    const explicitBlockMatch = trimmed.match(/^block\s*(?:no\.?\s*[:\-]?\s*)?(.+)$/i);
    if (explicitBlockMatch) {
      const cleanBlk = explicitBlockMatch[1].replace(/^[.\-\s]+|[.\-\s]+$/g, '').trim();
      return cleanBlk ? `${messName}, Block No: ${cleanBlk}` : messName;
    }

    return trimmed;
  };

  const normalizeFlight = (raw: string): { flight: FlightName | ''; valid: boolean } => {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return { flight: '', valid: true };
    if (trimmed.includes('avionic') || trimmed === 'avi') return { flight: 'Avionics', valid: true };
    if (trimmed.includes('mechanic') || trimmed === 'mech') return { flight: 'Mechanics', valid: true };
    if (trimmed.includes('gcs')) return { flight: 'GCS', valid: true };
    if (trimmed.includes('admin') || trimmed === 'adm') return { flight: 'Admin', valid: true };
    return { flight: '', valid: false };
  };

  const computeDuplicateDiff = (
    row: ParsedAirmanRow,
    existingMatch: Airman
  ): {
    changedFields: string[];
    changedFieldKeys: string[];
    updatePatch: Partial<Airman>;
  } => {
    const changedFields: string[] = [];
    const changedFieldKeys: string[] = [];
    const updatePatch: Partial<Airman> = {};
    const clean = (v?: string | null) => String(v || '').trim();

    const rankCheck = normalizeRank(row.rank);
    const effectiveRank = rankCheck.valid ? rankCheck.rank : existingMatch.rank;

    // 1. Rank
    if (rankCheck.valid && rankCheck.rank !== existingMatch.rank) {
      changedFields.push(`Rank: ${formatRank(existingMatch.rank)} → ${formatRank(rankCheck.rank)}`);
      changedFieldKeys.push('rank');
      updatePatch.rank = rankCheck.rank;
    }

    // 2. Full Name
    const incomingFullName = clean(row.fullName);
    const existingFullName = clean(existingMatch.fullName || existingMatch.name);
    if (incomingFullName && incomingFullName !== existingFullName) {
      changedFields.push(`Full Name: ${existingFullName || '-'} → ${incomingFullName}`);
      changedFieldKeys.push('fullName');
      updatePatch.fullName = incomingFullName;
    }

    // 3. Surname / Short Name
    const incomingName = clean(row.name);
    const existingName = clean(existingMatch.name);
    if (incomingName && incomingName !== existingName) {
      changedFields.push(`Surname: ${existingName || '-'} → ${incomingName}`);
      changedFieldKeys.push('name');
      updatePatch.name = incomingName;
    }

    // Update code if rank or name changed
    if (updatePatch.rank || updatePatch.name) {
      const nextRank = updatePatch.rank || existingMatch.rank;
      const nextName = updatePatch.name || existingMatch.name;
      updatePatch.code = `${nextRank}-${nextName.slice(0, 3).toUpperCase()}`;
    }

    // 4. Trade (only overwrite when Trade actually came from file or user edit)
    const incomingTrade = clean(row.trade);
    const existingTrade = clean(existingMatch.trade);
    if (row.hadTradeValue !== false && incomingTrade && incomingTrade !== existingTrade) {
      changedFields.push(`Trade: ${existingTrade || '-'} → ${incomingTrade}`);
      changedFieldKeys.push('trade');
      updatePatch.trade = incomingTrade;
    }

    // 5. Flight (only overwrite if explicitly provided & valid)
    const incomingFlightRaw = clean(row.flightName);
    if (incomingFlightRaw) {
      const flightCheck = normalizeFlight(incomingFlightRaw);
      const existingFlight = clean(existingMatch.flightName);
      if (flightCheck.valid && flightCheck.flight && flightCheck.flight !== existingFlight) {
        changedFields.push(`Flight: ${existingFlight || '-'} → ${flightCheck.flight}`);
        changedFieldKeys.push('flightName');
        updatePatch.flightName = flightCheck.flight;
      }
    }

    // 6. Blood Group
    const incomingBlood = clean(row.bloodGroup);
    const existingBlood = clean(existingMatch.bloodGroup);
    if (incomingBlood && incomingBlood !== existingBlood) {
      changedFields.push(`Blood Group: ${existingBlood || '-'} → ${incomingBlood}`);
      changedFieldKeys.push('bloodGroup');
      updatePatch.bloodGroup = incomingBlood;
    }

    // 7. Present Address
    const incomingAddr = formatImportedAddress(clean(row.addressBlock), effectiveRank);
    const existingAddr = clean(existingMatch.addressBlock);
    if (incomingAddr && incomingAddr !== existingAddr) {
      changedFields.push(`Address: ${existingAddr || '-'} → ${incomingAddr}`);
      changedFieldKeys.push('addressBlock');
      updatePatch.addressBlock = incomingAddr;
    }

    // 8. Permanent Address
    const incomingPermAddr = clean(row.permanentAddress);
    const existingPermAddr = clean(existingMatch.permanentAddress);
    if (incomingPermAddr && incomingPermAddr !== existingPermAddr) {
      changedFields.push(`Perm. Address updated`);
      changedFieldKeys.push('permanentAddress');
      updatePatch.permanentAddress = incomingPermAddr;
    }

    // 9. Mobile No (never replace a real mobile number with placeholder 'N/A')
    const incomingMobile = clean(row.mobileNo);
    const existingMobile = clean(existingMatch.mobileNo);
    if (
      incomingMobile &&
      incomingMobile.toUpperCase() !== 'N/A' &&
      incomingMobile !== '-' &&
      incomingMobile !== existingMobile
    ) {
      changedFields.push(`Mobile: ${existingMobile || '-'} → ${incomingMobile}`);
      changedFieldKeys.push('mobileNo');
      updatePatch.mobileNo = incomingMobile;
    }

    // 10. Date of Posting
    const incomingDate = row.dateJoined ? normalizeDateToISO(clean(row.dateJoined)) : '';
    const existingDate = existingMatch.dateJoined ? normalizeDateToISO(clean(existingMatch.dateJoined)) : '';
    if (incomingDate && incomingDate !== existingDate) {
      changedFields.push(`Dt of Posting: ${existingDate || '-'} → ${incomingDate}`);
      changedFieldKeys.push('dateJoined');
      updatePatch.dateJoined = incomingDate;
    }

    // 11. Remarks
    const incomingRemarks = clean(row.remarks);
    const existingRemarks = clean(existingMatch.remarks);
    if (incomingRemarks && incomingRemarks !== existingRemarks) {
      changedFields.push(`Remarks updated`);
      changedFieldKeys.push('remarks');
      updatePatch.remarks = incomingRemarks;
    }

    // 12. Seniority (JCOs only)
    if (isJcoRank(effectiveRank) && row.seniority !== undefined && row.seniority !== existingMatch.seniority) {
      changedFields.push(`Seniority: ${existingMatch.seniority ?? '-'} → ${row.seniority}`);
      changedFieldKeys.push('seniority');
      updatePatch.seniority = row.seniority;
    }

    return { changedFields, changedFieldKeys, updatePatch };
  };

  const validateRows = (
    rawRows: ParsedAirmanRow[],
    existing: Airman[],
    allowReplaceExisting: boolean = replaceExistingOnDuplicate
  ): ParsedAirmanRow[] => {
    const existingByBd = new Map<string, Airman>();
    existing.forEach((a) => {
      const norm = normalizeBd(a.bdNo);
      if (norm) existingByBd.set(norm, a);
    });

    const fileBdCount: Record<string, number> = {};
    rawRows.forEach((r) => {
      const norm = normalizeBd(r.bdNo);
      if (norm) {
        fileBdCount[norm] = (fileBdCount[norm] || 0) + 1;
      }
    });

    return rawRows.map((row) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      let importAction: 'NEW' | 'UPDATE' | 'UNCHANGED' = 'NEW';
      let matchedExistingId: string | undefined = undefined;
      let changedFields: string[] = [];
      let changedFieldKeys: string[] = [];
      let updatePatch: Partial<Airman> | undefined = undefined;

      // Required Name
      if (!row.name.trim()) {
        errors.push('Name is required');
      }

      // Rank validation (AC & AC-1 are both accepted as AC-1)
      const rankCheck = normalizeRank(row.rank);
      if (!rankCheck.valid) {
        errors.push(`Invalid rank "${row.rank}". Allowed: MWO, SWO, WO, Sgt, Cpl, LAC, AC-1 (AC), AC-2`);
      }

      // Flight validation: ONLY validate if a flight value was explicitly provided (never require or auto-add Flight)
      if (row.flightName && row.flightName.trim()) {
        const flightCheck = normalizeFlight(row.flightName);
        if (!flightCheck.valid) {
          errors.push(`Invalid flight "${row.flightName}". Allowed: Avionics, Mechanics, GCS, Admin`);
        }
      }

      // Required BD No & duplicate handling
      const normBd = normalizeBd(row.bdNo);
      if (!row.bdNo.trim() || !normBd) {
        errors.push('BD Number is required');
      } else {
        const displayBd = row.bdNo.replace(/^BD\/?/i, '').trim();
        if (fileBdCount[normBd] > 1) {
          errors.push(`Duplicate BD No ${displayBd} appears multiple times in this file`);
        }
        const existingMatch = existingByBd.get(normBd);
        if (existingMatch) {
          matchedExistingId = existingMatch.id;
          if (!allowReplaceExisting) {
            errors.push(`BD No ${displayBd} already exists in Nominal Roll (${existingMatch.rank} ${existingMatch.name})`);
            importAction = 'UNCHANGED';
          } else {
            const diff = computeDuplicateDiff(row, existingMatch);
            if (diff.changedFields.length > 0) {
              importAction = 'UPDATE';
              changedFields = diff.changedFields;
              changedFieldKeys = diff.changedFieldKeys;
              updatePatch = diff.updatePatch;
            } else {
              importAction = 'UNCHANGED';
            }
          }
        }
      }

      return {
        ...row,
        importAction,
        matchedExistingId,
        changedFields,
        changedFieldKeys,
        updatePatch,
        errors,
        warnings,
      };
    });
  };

  const processData = (data: any[][], displayData?: any[][]) => {
    if (!data || data.length < 2) {
      alert('The file is empty or missing data rows.');
      return;
    }

    const headers = data[0].map((h: any) => String(h || '').trim().toLowerCase());

    const findCol = (keywords: string[]) => {
      // First exact match check
      const exact = headers.findIndex((h) => keywords.includes(h));
      if (exact >= 0) return exact;
      // Then substring match check
      return headers.findIndex((h) => keywords.some((k) => h.includes(k)));
    };

    // Columns matching exact Export CSV sequence:
    // Ser, BD No, Rank, Full Name, Surname, Trade, [Flight], Blood Group, Present Address, Permanent Address, Mobile No, Dt of Posting
    const seniorityIdx = findCol(['seniority', 'senior', 'জ্যেষ্ঠতা']);
    const bdIdx = findCol(['bd no', 'bdno', 'bd/', 'bd.', 'b.d', 'service no', 'svc no', 'bd', 'বিডি']);
    const rankIdx = findCol(['rank', 'পদবি']);
    const fullNameIdx = findCol(['full name', 'fullname', 'পুরো নাম', 'সম্পূর্ণ নাম']);
    const surnameIdx = findCol(['surname', 'short name', 'ডাক নাম']);
    const genericNameIdx = findCol(['name', 'নাম', 'airman']);
    const tradeIdx = findCol(['trade', 'ট্রেড']);
    const flightIdx = findCol(['flight', 'flt', 'section']);
    const bloodGroupIdx = findCol(['blood group', 'blood', 'bg', 'রক্তের গ্রুপ', 'রক্ত']);
    const presentAddressIdx = findCol(['present address', 'address block', 'address', 'living', 'block', 'quarter', 'qtr', 'mess', 'বর্তমান ঠিকানা']);
    const permanentAddressIdx = findCol(['permanent address', 'permanent', 'স্থায়ী ঠিকানা', 'home address']);
    const mobileIdx = findCol(['mobile no', 'mobile', 'phone', 'cell', 'contact', 'মোবাইল']);
    const postingDateIdx = findCol(['dt of posting', 'date of posting', 'posting date', 'joining date', 'date joined', 'যোগদানের তারিখ']);
    const remarksIdx = findCol(['remarks', 'remark', 'note', 'মন্তব্য']);

    const fileHasFlightCol = flightIdx >= 0;
    setHasFlightColumn(fileHasFlightCol);

    const parsed: ParsedAirmanRow[] = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const dispRow = displayData?.[i];
      if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === '')) {
        continue;
      }

      const getVal = (idx: number, fallback = '', preferDisplay = false) => {
        if (idx < 0) return fallback;
        if (preferDisplay && dispRow && dispRow[idx] !== undefined && dispRow[idx] !== null && String(dispRow[idx]).trim() !== '') {
          return String(dispRow[idx]).trim();
        }
        if (row[idx] === undefined || row[idx] === null) return fallback;
        const val = row[idx];
        if (val instanceof Date) {
          if (!isNaN(val.getTime())) {
            const year = val.getFullYear();
            const month = String(val.getMonth() + 1).padStart(2, '0');
            const day = String(val.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
        }
        return String(val).trim();
      };

      const rawRankStr = getVal(rankIdx, 'LAC');
      const normalizedRankObj = normalizeRank(rawRankStr);
      const effectiveRank = normalizedRankObj.valid ? normalizedRankObj.rank : rawRankStr;

      const rawFullName = getVal(fullNameIdx, '');
      const rawSurname = getVal(surnameIdx, '');
      const rawGenericName = getVal(genericNameIdx, '');
      
      // Effective surname (name) and full name
      const effectiveSurname = rawSurname || rawGenericName || rawFullName;
      const effectiveFullName = rawFullName || rawGenericName || rawSurname;

      let rawBd = getVal(bdIdx, '', true).replace(/^BD\/?/i, '').trim();
      const rawTradeFromFile = tradeIdx >= 0 ? getVal(tradeIdx, '') : '';
      const hadTradeValue = Boolean(rawTradeFromFile);
      const rawTrade = rawTradeFromFile || 'Afr Fitt';

      // NEVER auto-add Flight if Excel file has NO Flight column or cell is blank
      const rawFlightCell = fileHasFlightCol ? getVal(flightIdx, '') : '';
      const normalizedFlightObj = rawFlightCell ? normalizeFlight(rawFlightCell) : { flight: '', valid: true };
      const effectiveFlight = rawFlightCell
        ? (normalizedFlightObj.valid ? normalizedFlightObj.flight : rawFlightCell)
        : '';

      const rawBloodGroup = getVal(bloodGroupIdx, '');
      const rawPresentAddress = getVal(presentAddressIdx, '', true);
      const formattedPresentAddress = formatImportedAddress(rawPresentAddress, effectiveRank);
      const rawPermanentAddress = getVal(permanentAddressIdx, '');
      
      let rawMobile = getVal(mobileIdx, '', true);
      if (rawMobile.startsWith('="') && rawMobile.endsWith('"')) {
        rawMobile = rawMobile.slice(2, -1);
      } else if (rawMobile.startsWith('=')) {
        rawMobile = rawMobile.replace(/^=['"]?|['"]?$/g, '');
      } else if (rawMobile.startsWith("'")) {
        rawMobile = rawMobile.slice(1);
      }
      // If Excel or user stripped leading 0 from 11-digit BD mobile (e.g. 1712345678 -> 01712345678)
      const digitsOnly = rawMobile.replace(/\D/g, '');
      if (digitsOnly.length === 10 && digitsOnly.startsWith('1')) {
        rawMobile = `0${digitsOnly}`;
      } else if (!rawMobile) {
        rawMobile = 'N/A';
      }

      const rawPostingDate = getVal(postingDateIdx, '');
      const cleanPostingDate = normalizeDateToISO(rawPostingDate);
      const rawRemarks = getVal(remarksIdx, '');
      const rawSeniorityVal = getVal(seniorityIdx, '');
      const numSeniority = rawSeniorityVal && !isNaN(Number(rawSeniorityVal)) ? Number(rawSeniorityVal) : undefined;

      parsed.push({
        id: `row-${i}-${Date.now()}`,
        seniority: numSeniority,
        rank: effectiveRank,
        fullName: effectiveFullName,
        name: effectiveSurname,
        bdNo: rawBd,
        trade: rawTrade,
        hadTradeValue,
        flightName: effectiveFlight,
        bloodGroup: rawBloodGroup,
        addressBlock: formattedPresentAddress,
        permanentAddress: rawPermanentAddress,
        mobileNo: rawMobile,
        dateJoined: cleanPostingDate,
        remarks: rawRemarks,
        errors: [],
        warnings: [],
      });
    }

    const validated = validateRows(parsed, existingAirmen, replaceExistingOnDuplicate);
    setRowFilter('ALL');
    setRows(validated);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input value so re-uploading the same file triggers onChange again
    e.target.value = '';
    if (!file) return;
    setFileName(file.name);
    parseUploadedFile(file);
  };

  const parseUploadedFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      setSourceType('CSV');
      Papa.parse(file, {
        header: false,
        skipEmptyLines: true,
        complete: (results) => {
          processData(results.data as any[][]);
        },
        error: (err) => {
          alert(`CSV Parse Error: ${err.message}`);
        },
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      setSourceType('EXCEL');
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const bstr = evt.target?.result;
          const wb = XLSX.read(bstr, { type: 'binary', cellDates: true });
          const firstSheet = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as any[][];
          const displayData = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false }) as any[][];
          processData(data, displayData);
        } catch (err: any) {
          alert(`Excel Read Error: ${err.message}`);
        }
      };
      reader.readAsBinaryString(file);
    } else {
      alert('Please upload a valid .xlsx Excel file.');
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setFileName(file.name);
      parseUploadedFile(file);
    }
  };

  const handleToggleReplaceExisting = (nextValue: boolean) => {
    setReplaceExistingOnDuplicate(nextValue);
    setRowFilter('ALL');
    setRows((prev) => (prev.length > 0 ? validateRows(prev, existingAirmen, nextValue) : prev));
  };

  const handleRowChange = (id: string, field: keyof ParsedAirmanRow, value: string) => {
    setRows((prev) => {
      const updated = prev.map((r) => {
        if (r.id === id) {
          if (field === 'rank') {
            const nextAddress = formatImportedAddress(r.addressBlock, value);
            return { ...r, rank: value, addressBlock: nextAddress };
          }
          if (field === 'trade') {
            return { ...r, trade: value, hadTradeValue: Boolean(value.trim()) };
          }
          return { ...r, [field]: value };
        }
        return r;
      });
      return validateRows(updated, existingAirmen, replaceExistingOnDuplicate);
    });
  };

  const handleDeleteRow = (id: string) => {
    setRows((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      const revalidated = validateRows(filtered, existingAirmen, replaceExistingOnDuplicate);
      if (revalidated.length === 0) {
        setFileName('');
        setRowFilter('ALL');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      return revalidated;
    });
  };

  const handleRemoveAllInvalidRows = () => {
    setRows((prev) => {
      const onlyValid = prev.filter((r) => r.errors.length === 0);
      const revalidated = validateRows(onlyValid, existingAirmen, replaceExistingOnDuplicate);
      setRowFilter('ALL');
      if (revalidated.length === 0) {
        setFileName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      return revalidated;
    });
  };

  const handleClearAllRows = () => {
    setRows([]);
    setFileName('');
    setRowFilter('ALL');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDownloadExcelSample = () => {
    exportAirmenTemplateExcel();
  };

  // History / Log Helpers
  const currentAirmanIdSet = new Set(existingAirmen.map((a) => a.id));
  const currentAirmanBdSet = new Set(
    existingAirmen
      .map((a) => String(a.bdNo || a.id || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim())
      .filter(Boolean)
  );

  const isSummaryAirmanActive = (item: BiodataImportBatch['airmenSummary'][number]): boolean => {
    const bd = String(item.bdNo || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
    return currentAirmanIdSet.has(item.id) || Boolean(bd && currentAirmanBdSet.has(bd));
  };

  const countBatchStillPresent = (batch: BiodataImportBatch): number => {
    let count = 0;
    const seen = new Set<string>();
    (batch.airmenSummary || []).forEach((s) => {
      const bd = String(s.bdNo || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
      const key = bd || s.id;
      if (seen.has(key)) return;
      seen.add(key);
      if (isSummaryAirmanActive(s)) count++;
    });
    return count;
  };

  const formatHistoryTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return iso;
    }
  };

  const refreshAfterHistoryChange = () => {
    loadImportHistory();
    const latestAirmen = localDb.getAirmen();
    setRows((prev) => (prev.length > 0 ? validateRows(prev, latestAirmen) : prev));
    onImportComplete();
    window.dispatchEvent(new CustomEvent('baf_state_updated'));
  };

  const handleConfirmRemoveFullBatch = () => {
    if (!batchToRemove) return;
    setIsRemovingHistory(true);
    setHistoryFeedback(null);
    try {
      const res = localDb.removeBiodataImportBatch(batchToRemove.id);
      if (res.success) {
        setHistoryFeedback({
          type: 'success',
          text:
            res.removedCount > 0
              ? `"${batchToRemove.fileName}" থেকে ইমপোর্ট করা ${res.removedCount} জন এয়ারম্যান ও লগ সম্পূর্ণভাবে রিমুভ করা হয়েছে।`
              : `"${batchToRemove.fileName}" ইমপোর্ট লগটি সফলভাবে রিমুভ করা হয়েছে।`,
        });
        if (expandedBatchId === batchToRemove.id) setExpandedBatchId(null);
        setBatchToRemove(null);
        refreshAfterHistoryChange();
      } else {
        setHistoryFeedback({ type: 'error', text: 'ইমপোর্ট ব্যাচটি রিমুভ করা যায়নি।' });
        setBatchToRemove(null);
      }
    } catch (err: any) {
      setHistoryFeedback({ type: 'error', text: err?.message || 'Remove failed.' });
      setBatchToRemove(null);
    } finally {
      setIsRemovingHistory(false);
    }
  };

  const handleConfirmRemoveSingleItem = () => {
    if (!singleItemToRemove) return;
    setIsRemovingHistory(true);
    setHistoryFeedback(null);
    try {
      const { batchId, item } = singleItemToRemove;
      const res = localDb.removeSingleAirmanFromBiodataImportBatch(batchId, item.id, item.bdNo);
      if (res.protectedSkipped) {
        setHistoryFeedback({
          type: 'error',
          text: `${formatRank(item.rank)} ${item.name} (${item.bdNo}) একটি প্রটেক্টেড অ্যাকাউন্ট — রিমুভ করা যাবে না।`,
        });
      } else if (res.success) {
        setHistoryFeedback({
          type: 'success',
          text: res.removedFromRegister
            ? `${formatRank(item.rank)} ${item.fullName || item.name} (${item.bdNo}) Biodata Register এবং এই ইমপোর্ট লগ থেকে সফলভাবে রিমুভ করা হয়েছে।`
            : `${formatRank(item.rank)} ${item.fullName || item.name} (${item.bdNo}) ইমপোর্ট লগ থেকে মুছে ফেলা হয়েছে।`,
        });
        if (res.remainingInBatch === 0 && expandedBatchId === batchId) {
          setExpandedBatchId(null);
        }
        refreshAfterHistoryChange();
      } else {
        setHistoryFeedback({ type: 'error', text: 'এয়ারম্যানটি রিমুভ করা যায়নি।' });
      }
      setSingleItemToRemove(null);
    } catch (err: any) {
      setHistoryFeedback({ type: 'error', text: err?.message || 'Remove failed.' });
      setSingleItemToRemove(null);
    } finally {
      setIsRemovingHistory(false);
    }
  };

  const totalErrors = rows.reduce((sum, r) => sum + r.errors.length, 0);
  const invalidRowsCount = rows.filter((r) => r.errors.length > 0).length;
  const newRowsCount = rows.filter((r) => r.errors.length === 0 && (r.importAction || 'NEW') === 'NEW').length;
  const updateRowsCount = rows.filter((r) => r.errors.length === 0 && r.importAction === 'UPDATE').length;
  const unchangedRowsCount = rows.filter((r) => r.errors.length === 0 && r.importAction === 'UNCHANGED').length;
  const actionableRowsCount = newRowsCount + updateRowsCount;
  const canImport = actionableRowsCount > 0 && totalErrors === 0 && !isImporting;
  const showFlightCol = hasFlightColumn || rows.some((r) => Boolean(r.flightName && r.flightName.trim()));

  const effectiveFilter =
    (rowFilter === 'INVALID' && invalidRowsCount === 0) ||
    (rowFilter === 'NEW' && newRowsCount === 0) ||
    (rowFilter === 'UPDATE' && updateRowsCount === 0) ||
    (rowFilter === 'UNCHANGED' && unchangedRowsCount === 0)
      ? 'ALL'
      : rowFilter;

  const visibleRows = rows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .filter(({ row }) => {
      if (effectiveFilter === 'INVALID') return row.errors.length > 0;
      if (effectiveFilter === 'NEW') return row.errors.length === 0 && (row.importAction || 'NEW') === 'NEW';
      if (effectiveFilter === 'UPDATE') return row.errors.length === 0 && row.importAction === 'UPDATE';
      if (effectiveFilter === 'UNCHANGED') return row.errors.length === 0 && row.importAction === 'UNCHANGED';
      return true;
    });

  const getRowFieldErrorFlags = (row: ParsedAirmanRow) => {
    const joined = row.errors.join(' | ').toLowerCase();
    return {
      bdNo: joined.includes('bd no') || joined.includes('bd number'),
      name: joined.includes('name is required'),
      rank: joined.includes('invalid rank'),
      flight: joined.includes('invalid flight'),
    };
  };

  const getImportButtonLabel = () => {
    if (newRowsCount > 0 && updateRowsCount > 0) {
      return `Import ${newRowsCount} New & Update ${updateRowsCount}`;
    }
    if (updateRowsCount > 0) {
      return `Update ${updateRowsCount} Existing`;
    }
    if (newRowsCount > 0) {
      return `Import ${newRowsCount} Airmen`;
    }
    return rows.length > 0 && totalErrors === 0 ? 'No Changes to Apply' : 'Import 0 Airmen';
  };

  const handleImport = async () => {
    if (!canImport) return;
    setIsImporting(true);

    try {
      const session = getCurrentUserSession();
      const importedBy = session
        ? `${session.rank || ''} ${session.name || session.bdNo || 'Admin'}`.trim()
        : 'Admin';

      const newRows = rows.filter((r) => r.errors.length === 0 && (r.importAction || 'NEW') === 'NEW');
      const updateRows = rows.filter(
        (r) => r.errors.length === 0 && r.importAction === 'UPDATE' && r.matchedExistingId && r.updatePatch
      );

      // 1. Add brand-new airmen
      if (newRows.length > 0) {
        const airmenToImport = newRows.map((r) => {
          const rankObj = normalizeRank(r.rank);
          const flightObj = normalizeFlight(r.flightName);
          const cleanBd = r.bdNo.trim().replace(/^BD\/?/i, '').trim();
          const finalAddress = formatImportedAddress(r.addressBlock, rankObj.rank);
          return {
            rank: rankObj.rank,
            seniority: isJcoRank(rankObj.rank) && r.seniority !== undefined ? r.seniority : undefined,
            fullName: (r.fullName || r.name).trim(),
            name: r.name.trim(),
            bdNo: cleanBd,
            trade: r.trade.trim() || 'Afr Fitt',
            addressBlock: finalAddress,
            permanentAddress: r.permanentAddress?.trim() || '',
            bloodGroup: r.bloodGroup?.trim() || '',
            dateJoined: r.dateJoined?.trim() || '',
            mobileNo: r.mobileNo.trim() || '01700000000',
            flightName: (r.flightName.trim() ? flightObj.flight : '') as any,
            remarks: r.remarks.trim() || 'Bulk Imported',
            code: `${rankObj.rank}-${r.name.trim().slice(0, 3).toUpperCase()}`,
          };
        });

        localDb.bulkAddAirmen(airmenToImport, {
          fileName: fileName || 'Excel Import',
          sourceType,
          importedBy,
        });
      }

      // 2. Replace changed info for existing duplicate BD numbers
      if (updateRows.length > 0) {
        const updatePayloads = updateRows.map((r) => ({
          existingId: r.matchedExistingId!,
          bdNo: r.bdNo.trim().replace(/^BD\/?/i, '').trim(),
          patch: r.updatePatch!,
        }));

        localDb.bulkUpdateExistingAirmen(updatePayloads, {
          fileName: fileName || 'Excel Import',
          importedBy,
        });
      }

      setRows([]);
      setFileName('');
      loadImportHistory();
      onImportComplete();
      onClose();
    } catch (err: any) {
      alert(`Import failed: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-none sm:rounded-3xl border-0 sm:border border-slate-200 dark:border-slate-800 shadow-2xl max-w-5xl w-full my-0 sm:my-6 flex flex-col h-full sm:h-auto sm:max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="bg-linear-to-r from-slate-900 via-slate-800 to-emerald-950 text-white p-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center font-bold shadow-md">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-black tracking-tight text-white">
                  Bulk Import Airmen to Biodata Register
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-950 border border-emerald-500/40 text-emerald-400 uppercase">
                  Excel (.xlsx)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload an Excel spreadsheet (.xlsx) to batch-create airmen records with instant validation.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Tab Selector */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
            <button
              type="button"
              onClick={() => setActiveTab('FILE')}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'FILE'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Excel / CSV File</span>
            </button>

            <button
              type="button"
              onClick={() => {
                loadImportHistory();
                setHistoryFeedback(null);
                setActiveTab('HISTORY');
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'HISTORY'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>History / Log</span>
              {historyBatches.length > 0 && (
                <span
                  className={`ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-black ${
                    activeTab === 'HISTORY'
                      ? 'bg-white/20 text-white'
                      : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                  }`}
                >
                  {historyBatches.length}
                </span>
              )}
            </button>
          </div>

          {/* Upload Section + Template Download */}
          {activeTab === 'FILE' ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Drag and drop box */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`md:col-span-2 border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30 ring-4 ring-emerald-500/20'
                    : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  className="hidden"
                  onChange={handleFileChange}
                />
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mb-2 shadow-xs">
                  <Upload className="w-6 h-6" />
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">
                  {fileName ? `Selected: ${fileName}` : 'Click to select or drag & drop Excel (.xlsx) file'}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Supports Excel (.xlsx) spreadsheets
                </p>
                {fileName && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClearAllRows();
                    }}
                    className="mt-2.5 inline-flex items-center space-x-1 px-3 py-1 rounded-lg bg-red-100 dark:bg-red-950/70 hover:bg-red-200 dark:hover:bg-red-900/80 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700/70 text-[11px] font-bold transition-colors cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Clear Selected File</span>
                  </button>
                )}
              </div>

              {/* Template Card */}
              <div className="bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70 rounded-2xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center space-x-1.5 text-xs font-black text-emerald-900 dark:text-emerald-300 uppercase tracking-wide">
                    <Shield className="w-3.5 h-3.5" />
                    <span>Standard Excel Template</span>
                  </div>
                  <p className="text-xs text-emerald-800 dark:text-emerald-200/80 mt-1 leading-relaxed">
                    Download our pre-formatted Excel (.xlsx) spreadsheet template with official column headers, custom styling, and thin table grid borders.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadExcelSample}
                  className="mt-4 w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs flex items-center justify-center space-x-2 shadow-xs transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Download Template (.xlsx)</span>
                </button>
              </div>
            </div>
          ) : (
            /* Import History / Log View */
            <div className="space-y-4">
              {historyFeedback && (
                <div
                  className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center space-x-2.5 ${
                    historyFeedback.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
                  }`}
                >
                  {historyFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  )}
                  <span>{historyFeedback.text}</span>
                </div>
              )}

              {historyBatches.length === 0 ? (
                <div className="py-14 text-center space-y-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-200 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                    <History className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                      No Import History / Log Yet
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Excel বা CSV ফাইল ইমপোর্ট করলে প্রতিটি ইমপোর্টের লগ এখানে জমা থাকবে — যেখান থেকে পুরো ইমপোর্ট বা এক-একজন করে রিমুভ করা যাবে।
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyBatches.map((batch) => {
                    const isExpanded = expandedBatchId === batch.id;
                    const activeCount = countBatchStillPresent(batch);
                    const batchSearch = (historySearchByBatch[batch.id] || '').trim().toLowerCase();
                    const filteredSummary = (batch.airmenSummary || []).filter((item) => {
                      if (!batchSearch) return true;
                      return (
                        String(item.bdNo || '').toLowerCase().includes(batchSearch) ||
                        String(item.name || '').toLowerCase().includes(batchSearch) ||
                        String(item.fullName || '').toLowerCase().includes(batchSearch) ||
                        String(item.rank || '').toLowerCase().includes(batchSearch) ||
                        String(item.trade || '').toLowerCase().includes(batchSearch)
                      );
                    });

                    return (
                      <div
                        key={batch.id}
                        className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl overflow-hidden transition-all"
                      >
                        <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div
                            onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                            className="flex items-start space-x-3 min-w-0 flex-1 cursor-pointer group"
                          >
                            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                              <FileSpreadsheet className="w-5 h-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3
                                  className="text-sm font-black text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors truncate max-w-[260px] sm:max-w-sm"
                                  title={batch.fileName}
                                >
                                  {batch.fileName}
                                </h3>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                  {batch.sourceType}
                                </span>
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
                                  {batch.airmenCount} Imported
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                    activeCount > 0
                                      ? 'bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300'
                                      : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                                  }`}
                                >
                                  {activeCount} Active Now
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                                <span className="inline-flex items-center space-x-1">
                                  <Clock className="w-3 h-3" />
                                  <span>{formatHistoryTimestamp(batch.timestamp)}</span>
                                </span>
                                {batch.importedBy && (
                                  <span>
                                    By:{' '}
                                    <strong className="text-slate-700 dark:text-slate-300">
                                      {batch.importedBy}
                                    </strong>
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                            <button
                              type="button"
                              onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center space-x-1 transition-colors cursor-pointer"
                            >
                              <Users className="w-3.5 h-3.5" />
                              <span>{isExpanded ? 'Hide List' : 'View List'}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => setBatchToRemove(batch)}
                              className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
                              title="Remove entire imported batch from Biodata Register"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove Full Import</span>
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/90 p-3 space-y-2.5">
                            {(batch.airmenSummary || []).length > 5 && (
                              <div className="relative max-w-xs">
                                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                                <input
                                  type="text"
                                  value={historySearchByBatch[batch.id] || ''}
                                  onChange={(e) =>
                                    setHistorySearchByBatch((prev) => ({
                                      ...prev,
                                      [batch.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Search BD No, name, rank..."
                                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                />
                              </div>
                            )}

                            <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                              <table className="w-full text-[11px] text-left border-collapse">
                                <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 z-10">
                                  <tr className="text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 uppercase text-[10px]">
                                    <th className="py-2 px-2.5">#</th>
                                    <th className="py-2 px-2.5">BD No</th>
                                    <th className="py-2 px-2.5">Rank</th>
                                    <th className="py-2 px-2.5">Name</th>
                                    <th className="py-2 px-2.5">Trade</th>
                                    <th className="py-2 px-2.5">Flight</th>
                                    <th className="py-2 px-2.5">Status</th>
                                    <th className="py-2 px-2.5 text-right">Action</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {filteredSummary.length === 0 ? (
                                    <tr>
                                      <td colSpan={8} className="py-5 text-center text-slate-400">
                                        No matching airmen found in this import batch.
                                      </td>
                                    </tr>
                                  ) : (
                                    filteredSummary.map((item, i) => {
                                      const activeNow = isSummaryAirmanActive(item);
                                      return (
                                        <tr
                                          key={`${item.id}-${i}`}
                                          className="text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                                        >
                                          <td className="py-2 px-2.5 font-mono text-slate-400">{i + 1}</td>
                                          <td className="py-2 px-2.5 font-mono font-bold whitespace-nowrap">{item.bdNo}</td>
                                          <td className="py-2 px-2.5 font-bold whitespace-nowrap">{formatRank(item.rank)}</td>
                                          <td className="py-2 px-2.5 font-semibold">{item.fullName || item.name}</td>
                                          <td className="py-2 px-2.5 whitespace-nowrap">{item.trade || '-'}</td>
                                          <td className="py-2 px-2.5 whitespace-nowrap">{item.flightName || '-'}</td>
                                          <td className="py-2 px-2.5 whitespace-nowrap">
                                            {activeNow ? (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300">
                                                Active
                                              </span>
                                            ) : (
                                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                                                Already Removed
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-2 px-2.5 text-right whitespace-nowrap">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setSingleItemToRemove({
                                                  batchId: batch.id,
                                                  batchFileName: batch.fileName,
                                                  item,
                                                })
                                              }
                                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-600 text-rose-600 dark:text-rose-300 hover:text-white border border-rose-200 dark:border-rose-800/70 text-[11px] font-bold transition-colors cursor-pointer"
                                              title="Remove this single airman"
                                            >
                                              <Trash2 className="w-3 h-3" />
                                              <span>Remove</span>
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Duplicate Handling Option Card (Excel / CSV Tab Only) */}
          {activeTab === 'FILE' && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:px-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80">
              <div className="flex items-start space-x-3 min-w-0">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    replaceExistingOnDuplicate
                      ? 'bg-amber-100 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700/70'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm font-black text-slate-900 dark:text-white flex flex-wrap items-center gap-2">
                    <span>Duplicate BD No — Replace Changed Info</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                        replaceExistingOnDuplicate
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700/70'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {replaceExistingOnDuplicate ? 'ON • Auto Replace' : 'OFF • Block Duplicates'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {replaceExistingOnDuplicate
                      ? 'ডুপ্লিকেট BD No থাকলে নতুন ফাইলে যে তথ্য পরিবর্তন হয়েছে শুধু সেই তথ্য আগেরটার জায়গায় Replace হবে (কোনো পরিবর্তন না থাকলে Skip হবে)।'
                      : 'ডুপ্লিকেট BD No থাকলে লাল ইস্যু হিসেবে ব্লক হবে — আগের কোনো তথ্য পরিবর্তন করা হবে না।'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={replaceExistingOnDuplicate}
                onClick={() => handleToggleReplaceExisting(!replaceExistingOnDuplicate)}
                className={`relative inline-flex h-7 w-13 shrink-0 items-center rounded-full transition-colors cursor-pointer self-end sm:self-center ${
                  replaceExistingOnDuplicate ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'
                }`}
                title="Toggle replace changed info on duplicate BD No"
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                    replaceExistingOnDuplicate ? 'translate-x-7' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          )}

          {/* Parsed Rows Preview (Excel / CSV Tab Only) */}
          {activeTab === 'FILE' && rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-slate-900 dark:text-white">
                      Parsed Rows ({rows.length})
                    </span>
                    {totalErrors === 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {newRowsCount > 0 && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>{newRowsCount} New</span>
                          </span>
                        )}
                        {updateRowsCount > 0 && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 dark:bg-amber-950/90 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700/80">
                            <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                            <span>{updateRowsCount} Will Replace</span>
                          </span>
                        )}
                        {unchangedRowsCount > 0 && (
                          <span className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                            <span>{unchangedRowsCount} No Change (Skip)</span>
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 dark:bg-red-950/90 text-red-700 dark:text-red-200 border border-red-400 dark:border-red-600/80">
                        <AlertCircle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" />
                        <span>
                          {invalidRowsCount} {invalidRowsCount === 1 ? 'Row has' : 'Rows have'} Issues ({totalErrors} total) — Edit or Remove
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Quick Bulk Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {invalidRowsCount > 0 && (
                      <button
                        type="button"
                        onClick={handleRemoveAllInvalidRows}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-black shadow-sm shadow-red-600/30 transition-colors cursor-pointer active:scale-[0.98]"
                        title="Remove all rows highlighted in red"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove All Invalid ({invalidRowsCount})</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleClearAllRows}
                      className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Clear All</span>
                    </button>
                  </div>
                </div>

                {/* Filter Bar + Tip */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {(invalidRowsCount > 0 || updateRowsCount > 0 || unchangedRowsCount > 0) ? (
                    <div className="inline-flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl border border-slate-200 dark:border-slate-700/70">
                      <button
                        type="button"
                        onClick={() => setRowFilter('ALL')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                          effectiveFilter === 'ALL'
                            ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        All ({rows.length})
                      </button>
                      {invalidRowsCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setRowFilter('INVALID')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                            effectiveFilter === 'INVALID'
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'text-red-600 dark:text-red-400 hover:bg-red-100/70 dark:hover:bg-red-950/60'
                          }`}
                        >
                          Issues ({invalidRowsCount})
                        </button>
                      )}
                      {newRowsCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setRowFilter('NEW')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                            effectiveFilter === 'NEW'
                              ? 'bg-emerald-600 text-white shadow-xs'
                              : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100/70 dark:hover:bg-emerald-950/60'
                          }`}
                        >
                          New ({newRowsCount})
                        </button>
                      )}
                      {updateRowsCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setRowFilter('UPDATE')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                            effectiveFilter === 'UPDATE'
                              ? 'bg-amber-600 text-white shadow-xs'
                              : 'text-amber-700 dark:text-amber-400 hover:bg-amber-100/70 dark:hover:bg-amber-950/60'
                          }`}
                        >
                          Will Replace ({updateRowsCount})
                        </button>
                      )}
                      {unchangedRowsCount > 0 && (
                        <button
                          type="button"
                          onClick={() => setRowFilter('UNCHANGED')}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                            effectiveFilter === 'UNCHANGED'
                              ? 'bg-slate-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/60'
                          }`}
                        >
                          No Change ({unchangedRowsCount})
                        </button>
                      )}
                    </div>
                  ) : (
                    <div />
                  )}
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Red = Issue • Amber = Will replace changed info • Green = New
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="border border-slate-200 dark:border-slate-700/80 rounded-2xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto max-h-[380px]">
                  <table className="w-full text-xs text-center border-collapse">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold sticky top-0 z-20">
                      <tr>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">#</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700 text-left">Status / Changes</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">BD Number</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Rank</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Full Name</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Surname</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Trade</th>
                        {showFlightCol && (
                          <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Flight</th>
                        )}
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Address</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700">Mobile</th>
                        <th className="p-2.5 border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">Dt of Posting</th>
                        <th className="p-2.5 border-b border-l border-slate-200 dark:border-slate-700 text-center sticky right-0 bg-slate-100 dark:bg-slate-800 z-30">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 font-medium">
                      {visibleRows.map(({ row, originalIndex }) => {
                        const hasError = row.errors.length > 0;
                        const isUpdate = !hasError && row.importAction === 'UPDATE';
                        const isUnchanged = !hasError && row.importAction === 'UNCHANGED';
                        const changedKeys = new Set(row.changedFieldKeys || []);
                        const fieldErr = hasError ? getRowFieldErrorFlags(row) : { bdNo: false, name: false, rank: false, flight: false };

                        const inputClass = (isCellError = false, fieldKey?: string) => {
                          if (hasError) {
                            return `px-2 py-1 rounded-lg text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 ${
                              isCellError
                                ? 'bg-red-100 dark:bg-red-900/90 border-red-600 dark:border-red-400 text-red-950 dark:text-white ring-1 ring-red-500/70'
                                : 'bg-red-50/95 dark:bg-red-950/90 border-red-400/90 dark:border-red-600/80 text-red-950 dark:text-red-50'
                            }`;
                          }
                          if (isUpdate && fieldKey && changedKeys.has(fieldKey)) {
                            return 'px-2 py-1 rounded-lg text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 bg-amber-100/90 dark:bg-amber-900/70 border-amber-500 dark:border-amber-400 text-amber-950 dark:text-amber-50 ring-1 ring-amber-400/70';
                          }
                          if (isUpdate) {
                            return 'px-2 py-1 rounded-lg text-xs border transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 bg-amber-50/70 dark:bg-amber-950/50 border-amber-300/80 dark:border-amber-700/60 text-slate-900 dark:text-amber-50';
                          }
                          return 'px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';
                        };

                        return (
                          <tr
                            key={row.id}
                            className={`transition-colors ${
                              hasError
                                ? 'bg-red-100/95 dark:bg-red-950/80 hover:bg-red-200/75 dark:hover:bg-red-900/75 border-b border-red-300 dark:border-red-800/80'
                                : isUpdate
                                  ? 'bg-amber-50/90 dark:bg-amber-950/40 hover:bg-amber-100/80 dark:hover:bg-amber-950/60 border-b border-amber-200 dark:border-amber-800/60'
                                  : isUnchanged
                                    ? 'bg-slate-50/50 dark:bg-slate-900/60 opacity-75 hover:opacity-100'
                                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <td
                              className={`p-2.5 font-mono ${
                                hasError
                                  ? 'border-l-4 border-l-red-600 dark:border-l-red-500 text-red-700 dark:text-red-300 font-black'
                                  : isUpdate
                                    ? 'border-l-4 border-l-amber-500 dark:border-l-amber-400 text-amber-700 dark:text-amber-300 font-black'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {originalIndex + 1}
                            </td>
                            <td className="p-2.5 text-left min-w-[200px] max-w-[270px]">
                              {hasError ? (
                                <div
                                  className="flex items-start space-x-1.5 text-red-700 dark:text-red-200 font-bold leading-snug"
                                  title={row.errors.join(' • ')}
                                >
                                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                                  <span className="whitespace-normal break-words text-[11px]">
                                    {row.errors.join(' • ')}
                                  </span>
                                </div>
                              ) : isUpdate ? (
                                <div
                                  className="space-y-0.5 text-amber-800 dark:text-amber-200 leading-snug"
                                  title={(row.changedFields || []).join(' • ')}
                                >
                                  <div className="flex items-center space-x-1 font-black text-[11px] text-amber-700 dark:text-amber-300">
                                    <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                                    <span>Replace ({row.changedFields?.length || 0} changed)</span>
                                  </div>
                                  <div className="text-[10px] font-semibold text-amber-900/90 dark:text-amber-200/90 whitespace-normal break-words">
                                    {(row.changedFields || []).join(' • ')}
                                  </div>
                                </div>
                              ) : isUnchanged ? (
                                <div className="flex items-center space-x-1 text-slate-500 dark:text-slate-400 font-bold whitespace-nowrap">
                                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                  <span>No Change (Skip)</span>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1 text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap">
                                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                                  <span>New (Valid)</span>
                                </div>
                              )}
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.bdNo}
                                onChange={(e) => handleRowChange(row.id, 'bdNo', e.target.value)}
                                className={`w-28 font-mono font-bold ${inputClass(fieldErr.bdNo, 'bdNo')}`}
                              />
                            </td>
                            <td className="p-2">
                              <select
                                value={row.rank}
                                onChange={(e) => handleRowChange(row.id, 'rank', e.target.value)}
                                className={`font-bold ${inputClass(fieldErr.rank, 'rank')}`}
                              >
                                {!VALID_RANKS.includes(row.rank as Rank) && (
                                  <option value={row.rank}>{row.rank || 'Invalid'}</option>
                                )}
                                {VALID_RANKS.map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.fullName || row.name}
                                onChange={(e) => handleRowChange(row.id, 'fullName', e.target.value)}
                                className={`w-36 font-medium ${inputClass(false, 'fullName')}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.name}
                                onChange={(e) => handleRowChange(row.id, 'name', e.target.value)}
                                className={`w-28 font-semibold ${inputClass(fieldErr.name, 'name')}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                list="baf-trade-options"
                                value={row.trade}
                                onChange={(e) => handleRowChange(row.id, 'trade', e.target.value)}
                                className={`w-28 ${inputClass(false, 'trade')}`}
                              />
                            </td>
                            {showFlightCol && (
                              <td className="p-2">
                                <select
                                  value={row.flightName}
                                  onChange={(e) => handleRowChange(row.id, 'flightName', e.target.value)}
                                  className={`font-semibold ${inputClass(fieldErr.flight, 'flightName')}`}
                                >
                                  <option value="">— None —</option>
                                  {row.flightName && !VALID_FLIGHTS.includes(row.flightName as FlightName) && (
                                    <option value={row.flightName}>{row.flightName}</option>
                                  )}
                                  {VALID_FLIGHTS.map((f) => (
                                    <option key={f} value={f}>
                                      {f}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            )}
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.addressBlock}
                                onChange={(e) => handleRowChange(row.id, 'addressBlock', e.target.value)}
                                className={`w-36 ${inputClass(false, 'addressBlock')}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.mobileNo}
                                onChange={(e) => handleRowChange(row.id, 'mobileNo', e.target.value)}
                                className={`w-28 font-mono ${inputClass(false, 'mobileNo')}`}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="date"
                                value={row.dateJoined ? normalizeDateToISO(row.dateJoined) : ''}
                                onChange={(e) => handleRowChange(row.id, 'dateJoined', e.target.value)}
                                onDoubleClick={(e) => {
                                  try {
                                    if (typeof (e.currentTarget as any).showPicker === 'function') {
                                      (e.currentTarget as any).showPicker();
                                    }
                                  } catch (err) {}
                                }}
                                title="Double-click to open calendar (Short date format: dd mmm yy)"
                                className={`w-32 font-mono ${inputClass(false, 'dateJoined')}`}
                              />
                            </td>
                            <td
                              className={`p-2 text-center sticky right-0 z-10 border-l ${
                                hasError
                                  ? 'bg-red-100 dark:bg-[#3f1018] border-red-300 dark:border-red-800/80'
                                  : isUpdate
                                    ? 'bg-amber-50 dark:bg-[#2d2110] border-amber-200 dark:border-amber-800/60'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteRow(row.id);
                                }}
                                className={`inline-flex items-center space-x-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer active:scale-95 ${
                                  hasError
                                    ? 'bg-red-600 hover:bg-red-700 text-white shadow-xs'
                                    : 'text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/60'
                                }`}
                                title="Remove this row"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Remove</span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <datalist id="baf-trade-options">
          {['Afr Fitt', 'Eng Fitt', 'E&I Fitt', 'Radio Fitt', 'Armt Fitt', 'GS', 'Log Asst', 'Sec Asst (GD)', 'Sec Asst (Accts)', 'Admin Asst', 'ATCA', 'Cy Asst', 'IT Asst'].map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <div className="p-5 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
          {activeTab === 'HISTORY' ? (
            <>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                <strong>{historyBatches.length}</strong> import {historyBatches.length === 1 ? 'log' : 'logs'} saved for this office
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </>
          ) : (
            <>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {rows.length > 0 ? (
                  totalErrors === 0 ? (
                    <span className="font-semibold">
                      {newRowsCount > 0 && (
                        <strong className="text-emerald-600 dark:text-emerald-400">{newRowsCount} new</strong>
                      )}
                      {newRowsCount > 0 && updateRowsCount > 0 && ' • '}
                      {updateRowsCount > 0 && (
                        <strong className="text-amber-600 dark:text-amber-400">{updateRowsCount} will replace changed info</strong>
                      )}
                      {(newRowsCount > 0 || updateRowsCount > 0) && unchangedRowsCount > 0 && ' • '}
                      {unchangedRowsCount > 0 && (
                        <span className="text-slate-500 dark:text-slate-400">{unchangedRowsCount} unchanged (skip)</span>
                      )}
                      {actionableRowsCount === 0 && ' — All rows already match Biodata Register'}
                    </span>
                  ) : (
                    <span>
                      <strong className="text-emerald-600 dark:text-emerald-400">{actionableRowsCount}</strong> ready •{' '}
                      <strong className="text-red-600 dark:text-red-400">{invalidRowsCount} invalid rows</strong> ({totalErrors} issues to edit or remove)
                    </span>
                  )
                ) : (
                  <span>Please upload an Excel (.xlsx) spreadsheet to begin</span>
                )}
              </div>

              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!canImport}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl shadow-md flex items-center space-x-2 transition-all cursor-pointer"
                >
                  {isImporting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Applying...</span>
                    </>
                  ) : (
                    <>
                      <Users className="w-4 h-4" />
                      <span>{getImportButtonLabel()}</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Full Import Batch Remove Confirmation Popup */}
        {batchToRemove && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Remove Full Import?
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    আপনি কি নিশ্চিত যে এই পুরো ইমপোর্ট ব্যাচটি রিমুভ করতে চান? এতে এই ফাইল থেকে যুক্ত হওয়া সকল এয়ারম্যান Biodata Register থেকে স্থায়ীভাবে মুছে যাবে।
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">File:</span>
                  <span className="font-bold text-slate-900 dark:text-white truncate max-w-[220px]" title={batchToRemove.fileName}>
                    {batchToRemove.fileName}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Imported At:</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {formatHistoryTimestamp(batchToRemove.timestamp)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Airmen to Remove:</span>
                  <span className="font-black text-rose-600 dark:text-rose-400">
                    {countBatchStillPresent(batchToRemove)} of {batchToRemove.airmenCount} Airmen
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2.5 pt-1">
                <button
                  type="button"
                  disabled={isRemovingHistory}
                  onClick={() => setBatchToRemove(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRemovingHistory}
                  onClick={handleConfirmRemoveFullBatch}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black flex items-center space-x-1.5 shadow-md transition-colors cursor-pointer"
                >
                  {isRemovingHistory ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Removing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Yes, Remove Full Import</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Single Airman Remove Confirmation Popup */}
        {singleItemToRemove && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Remove Single Airman?
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    আপনি কি নিশ্চিত যে এই একজন এয়ারম্যানকে Biodata Register এবং এই ইমপোর্ট লগ থেকে রিমুভ করতে চান?
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Airman:</span>
                  <span className="font-black text-slate-900 dark:text-white">
                    {formatRank(singleItemToRemove.item.rank)} {singleItemToRemove.item.fullName || singleItemToRemove.item.name}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">BD No:</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                    {singleItemToRemove.item.bdNo}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">From Import:</span>
                  <span className="font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[210px]">
                    {singleItemToRemove.batchFileName}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2.5 pt-1">
                <button
                  type="button"
                  disabled={isRemovingHistory}
                  onClick={() => setSingleItemToRemove(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRemovingHistory}
                  onClick={handleConfirmRemoveSingleItem}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black flex items-center space-x-1.5 shadow-md transition-colors cursor-pointer"
                >
                  {isRemovingHistory ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Removing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Yes, Remove Airman</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

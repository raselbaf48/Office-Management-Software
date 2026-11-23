import { getCustomDutyName, getCustomDuties } from './customDuties';
import { DUTY_TYPE_MAP } from '../data/dutyTypes';
import { getStoredDutyMatrix, getDefaultDutyShortName, DutyRatioTable } from '../data/officialDutyRatioMatrix';

/**
 * Resolves the configured Short Name (from Duty Settings) for a duty if it exists in the Duty Matrix or Custom Duties.
 * Strips any trailing " Duty" or " Off" so callers can uniformly append " Duty" (when Duty On) or " Off" (when Duty Off).
 */
export function resolveConfiguredDutyBaseShortName(
  dutyCode?: string | null,
  idaShift?: string | null,
  notes?: string | null,
  dutyName?: string | null
): string | null {
  const code = String(dutyCode || '').toUpperCase().trim();
  const notesStr = String(notes || '').trim();
  const notesLower = notesStr.toLowerCase();
  const nameStr = String(dutyName || '').trim();
  const nameLower = nameStr.toLowerCase();
  const shiftLower = String(idaShift || '').toLowerCase().trim();

  let matrix: DutyRatioTable[] = [];
  try {
    matrix = getStoredDutyMatrix() || [];
  } catch {
    matrix = [];
  }

  const stripDutyOrOffSuffix = (raw: string): string => {
    const cleaned = raw.replace(/\s+(duty\s+off|duty|off)$/i, '').trim();
    return cleaned || raw.trim();
  };

  // Helper to check if a query matches a table
  const findTable = (predicate: (t: DutyRatioTable) => boolean): DutyRatioTable | undefined => {
    return matrix.find(predicate);
  };

  // 1. IDAC Duty with shifts
  if (
    code === 'IDAC' ||
    code === 'IDA' ||
    notesLower.includes('idac') ||
    notesLower.includes('ida center') ||
    nameLower.includes('idac') ||
    nameLower.includes('ida center')
  ) {
    let targetShift: 'morning' | 'afternoon' | 'night' = 'morning';
    if (
      shiftLower === 'night' ||
      shiftLower === 'nt' ||
      shiftLower === 'c' ||
      notesLower.includes('night') ||
      notesLower.includes('"nt"') ||
      notesLower.includes(' nt') ||
      notesLower.includes('shift c') ||
      notesLower.includes('"c"') ||
      nameLower.includes('night')
    ) {
      targetShift = 'night';
    } else if (
      shiftLower === 'afternoon' ||
      shiftLower === 'aft' ||
      shiftLower === 'b' ||
      notesLower.includes('afternoon') ||
      notesLower.includes('aft') ||
      notesLower.includes('"b"') ||
      notesLower.includes('shift b') ||
      nameLower.includes('afternoon')
    ) {
      targetShift = 'afternoon';
    }

    const matchedIdac = findTable((t) => {
      const tId = (t.id || '').toLowerCase();
      const tShift = (t.shiftLabel || '').toLowerCase();
      return (t.dutyCode === 'IDAC' || tId.includes('idac')) && (tId.includes(targetShift) || tShift.includes(targetShift));
    });
    if (matchedIdac) {
      return stripDutyOrOffSuffix(getDefaultDutyShortName(matchedIdac));
    }
    return targetShift === 'night' ? 'IDAC "C"' : targetShift === 'afternoon' ? 'IDAC "B"' : 'IDAC "A"';
  }

  // 2. Base Security / GD / Sy Duty
  if (
    code === 'GD' ||
    code === 'GUARD_DUTY' ||
    code === 'SECURITY' ||
    code === 'SY' ||
    code === 'SY_DUTY' ||
    notesLower.includes('base sec') ||
    notesLower.includes('guard duty') ||
    notesLower.includes('sy duty') ||
    notesLower.includes('sy on') ||
    notesLower.includes('security duty') ||
    /\bgd\b/i.test(notesLower) ||
    /\bsy\b/i.test(notesLower) ||
    nameLower.includes('security') ||
    nameLower.includes('guard duty') ||
    /\bgd\b/i.test(nameLower) ||
    /\bsy\b/i.test(nameLower) ||
    nameLower.includes('sy duty') ||
    nameLower.includes('sy on')
  ) {
    const matchedSy = findTable(
      (t) =>
        t.dutyCode === 'GD' ||
        (t.id || '').toLowerCase().includes('security') ||
        (t.title || '').toLowerCase().includes('security')
    );
    return stripDutyOrOffSuffix(matchedSy ? getDefaultDutyShortName(matchedSy) : 'Sy');
  }

  // 3. BTF (Base Taskforce)
  if (
    code === 'BTF' ||
    notesLower.includes('btf') ||
    notesLower.includes('base taskforce') ||
    nameLower.includes('btf') ||
    nameLower.includes('base taskforce')
  ) {
    const matchedBtf = findTable(
      (t) =>
        t.dutyCode === 'BTF' ||
        (t.id || '').toLowerCase().includes('base_tf') ||
        (t.title || '').toLowerCase().includes('base taskforce')
    );
    return stripDutyOrOffSuffix(matchedBtf ? getDefaultDutyShortName(matchedBtf) : 'BTF');
  }

  // 4. NTF (Najirpara Taskforce)
  if (
    code === 'NTF' ||
    notesLower.includes('ntf') ||
    notesLower.includes('najirpara') ||
    notesLower.includes('nazirpara') ||
    nameLower.includes('ntf') ||
    nameLower.includes('najirpara') ||
    nameLower.includes('nazirpara')
  ) {
    const matchedNtf = findTable(
      (t) =>
        t.dutyCode === 'NTF' ||
        (t.id || '').toLowerCase().includes('nazirpara') ||
        (t.title || '').toLowerCase().includes('najirpara') ||
        (t.title || '').toLowerCase().includes('nazirpara')
    );
    return stripDutyOrOffSuffix(matchedNtf ? getDefaultDutyShortName(matchedNtf) : 'NTF');
  }

  // 5. Airfield / Airport
  if (
    code === 'AIRPORT' ||
    code === 'AIRFIELD' ||
    code === 'AIR_FD' ||
    notesLower.includes('airfield') ||
    notesLower.includes('air fd') ||
    notesLower.includes('airport') ||
    nameLower.includes('airfield') ||
    nameLower.includes('air fd') ||
    nameLower.includes('airport')
  ) {
    const matchedAf = findTable(
      (t) =>
        t.dutyCode === 'AIRPORT' ||
        (t.id || '').toLowerCase().includes('airport') ||
        (t.id || '').toLowerCase().includes('airfield') ||
        (t.title || '').toLowerCase().includes('airfield') ||
        (t.title || '').toLowerCase().includes('airport')
    );
    return stripDutyOrOffSuffix(matchedAf ? getDefaultDutyShortName(matchedAf) : 'Airfield');
  }

  // 6. Halishahar
  if (
    code === 'HALISHAHAR' ||
    notesLower.includes('halishahar') ||
    notesLower.includes('hali duty') ||
    nameLower.includes('halishahar')
  ) {
    const matchedHali = findTable(
      (t) =>
        t.dutyCode === 'HALISHAHAR' ||
        (t.id || '').toLowerCase().includes('halishahar') ||
        (t.title || '').toLowerCase().includes('halishahar')
    );
    return stripDutyOrOffSuffix(matchedHali ? getDefaultDutyShortName(matchedHali) : 'Halishahar');
  }

  // 7. Escort Duty
  if (
    code === 'ESCORT' ||
    code === 'ESC' ||
    code === 'ESCT' ||
    code.includes('1794394') ||
    notesLower.includes('escort') ||
    nameLower.includes('escort')
  ) {
    const matchedEsc = findTable(
      (t) =>
        (t.dutyCode || '').toUpperCase().includes('1794394') ||
        (t.id || '').toLowerCase().includes('1794394') ||
        (t.title || '').toLowerCase().includes('escort')
    );
    return stripDutyOrOffSuffix(matchedEsc ? getDefaultDutyShortName(matchedEsc) : 'Esct');
  }

  // 8. Reception
  if (code === 'RECEPTION' || notesLower.includes('reception') || nameLower.includes('reception')) {
    const matchedRec = findTable(
      (t) =>
        t.dutyCode === 'RECEPTION' ||
        (t.id || '').toLowerCase().includes('reception') ||
        (t.title || '').toLowerCase().includes('reception')
    );
    return stripDutyOrOffSuffix(matchedRec ? getDefaultDutyShortName(matchedRec) : 'Reception');
  }

  // 9. Exact match against any custom / configured table in Duty Matrix
  const directMatch = findTable((t) => {
    const tCode = String(t.dutyCode || '').toUpperCase().trim();
    const tId = String(t.id || '').toUpperCase().trim();
    const tTitleLower = String(t.title || '').toLowerCase().trim();
    const tShortLower = String(t.shortName || '').toLowerCase().trim();
    return (
      (code && (tCode === code || tId === code)) ||
      (nameLower && (tTitleLower === nameLower || (tShortLower && tShortLower === nameLower))) ||
      (notesLower && (tTitleLower === notesLower || (tShortLower && tShortLower === notesLower)))
    );
  });
  if (directMatch) {
    return stripDutyOrOffSuffix(getDefaultDutyShortName(directMatch));
  }

  // 10. Check customDuties store
  try {
    const customs = getCustomDuties();
    const cMatch = customs.find((cd) => {
      const cdCode = String(cd.code || '').toUpperCase().trim();
      const cdNameLower = String(cd.name || '').toLowerCase().trim();
      const cdShortLower = String(cd.shortName || '').toLowerCase().trim();
      return (
        (code && cdCode === code) ||
        (nameLower && (cdNameLower === nameLower || cdShortLower === nameLower)) ||
        (notesLower && (cdNameLower === notesLower || cdShortLower === notesLower))
      );
    });
    if (cMatch) {
      return stripDutyOrOffSuffix(cMatch.shortName || cMatch.name);
    }
  } catch {}

  return null;
}

export function formatDutyOnShortName(
  dutyCode?: string | null,
  idaShift?: string | null,
  notes?: string | null,
  dutyName?: string | null
): string {
  const code = (dutyCode || '').toUpperCase().trim();
  const notesStr = (notes || '').trim();
  const notesLower = notesStr.toLowerCase();
  const nameStr = (dutyName || '').trim();
  const nameLower = nameStr.toLowerCase();

  // Check if this is a configured duty from Duty Settings (e.g. Sy, BTF, NTF, Airfield, Halishahar, Esct, custom duty)
  const configuredBaseShort = resolveConfiguredDutyBaseShortName(dutyCode, idaShift, notes, dutyName);
  if (configuredBaseShort) {
    // User rule: "State e Duty on thakle pase Duty lekha thakbe Sy Duty bt duty off thakle duty lekha thakbe na Sy Off"
    if (/duty$/i.test(configuredBaseShort)) {
      return configuredBaseShort;
    }
    return `${configuredBaseShort} Duty`;
  }

  // Non-duty disposals (Canteen, Orderly Room, UWO, Bake & Bite, TDY, Leave)
  if (code === 'CANTEEN' || notesLower.includes('canteen') || nameLower.includes('canteen')) {
    return 'Canteen';
  }
  if (code.includes('ORDERLY') || notesLower.includes('orderly') || nameLower.includes('orderly')) {
    return 'Orderly Room';
  }
  if (code === 'UWO' || notesLower.includes('uwo') || nameLower.includes('uwo')) {
    return 'UWO';
  }
  if (
    code === 'BAKE_BITE' ||
    code === 'BAKE_N_BITE' ||
    notesLower.includes('bake') ||
    nameLower.includes('bake')
  ) {
    return 'Bake & Bite';
  }
  if (
    code === 'TDY' ||
    code === 'ATT' ||
    code === 'DETT' ||
    notesLower.includes('tdy') ||
    notesLower.includes('attachment')
  ) {
    return 'TDY';
  }
  if (
    code === 'LEAVE' ||
    notesLower.includes('leave') ||
    notesLower.includes('cl') ||
    notesLower.includes('al')
  ) {
    if (notesLower.includes('casual') || notesLower.includes('cl')) return 'CL';
    if (notesLower.includes('annual') || notesLower.includes('al')) return 'AL';
    return 'Leave';
  }

  // Custom duty code resolution (handles CUST_..., timestamp codes, custom duties)
  const isRawCode = (str?: string | null) => Boolean(
    str && (
      str.toUpperCase().startsWith('CUST_') ||
      str.includes('1794394') ||
      /^[A-Z0-9_]{10,}$/.test(str.trim())
    )
  );
  const isGenericDuty = (str: string) => ['DUTY', 'DUTY_ON', 'ON DUTY', 'DUTY ON'].includes(str.toUpperCase().trim());

  if (isRawCode(code) || isRawCode(dutyName)) {
    const rawTarget = isRawCode(code) ? code : (dutyName || '');
    if (rawTarget.includes('1794394')) return 'Esct Duty';
    const customMatch = getCustomDuties().find(d => d.code === rawTarget);
    const resolvedName = customMatch?.shortName ||
      getCustomDutyName(rawTarget) ||
      DUTY_TYPE_MAP.get(rawTarget as any)?.name ||
      customMatch?.name;
    if (resolvedName && !isRawCode(resolvedName)) {
      if (resolvedName.toLowerCase().includes('escort')) return 'Esct Duty';
      const base = resolvedName.replace(/\s+(duty|off)$/i, '').trim() || resolvedName;
      return `${base} Duty`;
    }
  }

  // Custom fallback: clean any internal "imported" tag and avoid returning generic "DUTY" or raw codes
  if (dutyName && !isRawCode(dutyName) && !dutyName.toLowerCase().includes('imported') && !isGenericDuty(dutyName)) {
    if (dutyName.toLowerCase().includes('escort')) return 'Esct Duty';
    const base = dutyName.replace(/\s+(duty|off)$/i, '').trim() || dutyName;
    return `${base} Duty`;
  }
  if (notesStr && !isRawCode(notesStr) && !notesLower.includes('imported') && !isGenericDuty(notesStr)) {
    if (notesLower.includes('escort')) return 'Esct Duty';
    const base = notesStr.replace(/\s+(duty|off)$/i, '').trim() || notesStr;
    return `${base} Duty`;
  }

  if (isRawCode(code)) {
    return code.includes('1794394') ? 'Esct Duty' : 'Special Duty';
  }

  const isBaseline = ['ON_PARADE', 'PT', 'PT_PARADE', 'P', 'PRESENT'].includes(code);
  if (code && !isGenericDuty(code) && !isBaseline) {
    const base = code.replace(/\s+(duty|off)$/i, '').trim() || code;
    return `${base} Duty`;
  }
  return 'Sy Duty';
}

export function formatDutyOffShortName(
  previousDutyCode?: string | null,
  previousDutyName?: string | null,
  notes?: string | null
): string {
  // Strip any existing " Duty" or " Off" from the inputs before resolving the base short name
  const cleanName = (previousDutyName || '').replace(/\s+(duty\s+off|duty|off)$/i, '').trim();
  const cleanNotes = (notes || '').replace(/\s+(duty\s+off|duty|off)$/i, '').trim();

  const configuredBaseShort = resolveConfiguredDutyBaseShortName(
    previousDutyCode,
    undefined,
    cleanNotes || notes,
    cleanName || previousDutyName
  );
  if (configuredBaseShort) {
    let base = configuredBaseShort.replace(/\s+(duty\s+off|duty|off)$/i, '').trim() || configuredBaseShort;
    if (/^idac(\s+("a"|"b"|"c"|night|nt|morning|mor|afternoon|aft))?$/i.test(base)) {
      base = 'IDAC';
    }
    return `${base} Off`;
  }

  const code = String(previousDutyCode || '').toUpperCase();
  const name = String(previousDutyName || '').toLowerCase();
  const n = String(notes || '').toLowerCase();
  if (
    code.includes('1794394') ||
    code === 'ESCORT' ||
    code === 'ESC' ||
    code === 'ESCT' ||
    name.includes('escort') ||
    name.includes('esct') ||
    n.includes('escort') ||
    n.includes('esct')
  ) {
    return 'Esct Off';
  }

  const shortOn = formatDutyOnShortName(previousDutyCode, undefined, cleanNotes || notes, cleanName || previousDutyName);
  let baseShort = shortOn.replace(/\s+(duty\s+off|duty|off)$/i, '').trim();

  if (/^idac(\s+("a"|"b"|"c"|night|nt|morning|mor|afternoon|aft))?$/i.test(baseShort)) {
    return 'IDAC Off';
  }
  if (
    baseShort === 'ESC' ||
    baseShort === 'ESCT' ||
    baseShort.toLowerCase() === 'escort'
  ) {
    return 'Esct Off';
  }
  if (baseShort.toUpperCase() === 'SY' || baseShort.toUpperCase() === 'GD') {
    return 'Sy Off';
  }
  if (!baseShort || baseShort.toLowerCase() === 'duty') {
    return 'Sy Off';
  }
  return `${baseShort} Off`;
}

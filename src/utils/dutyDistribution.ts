/**
 * Universal Duty Distribution Engine with Cross-Duty Workload Balancing & Auto Allocate
 * 
 * 1. Airfield Duty (or similar duties) only has 3 capable flights (Mechanics, Avionics, GCS).
 *    Admin has NO Airfield duty.
 *    Therefore, Airfield Duty's workload balancing is contained strictly among the 3 capable flights.
 *    Admin is protected and unaffected by Airfield duty.
 * 
 * 2. Dynamic Manpower & Disposal Support:
 *    - When Manpower is at Default (11 Mech, 7 Avi, 11 GCS, 1 Admin):
 *      Uses the official baseline (Mech: 134, Avi: 100, GCS: 134, Admin: 30).
 *    - When Disposal or Manpower changes (Leave, TDY, Disposals, etc.):
 *      Dynamically recalculates each flight's exact mathematical ratio and integer targets.
 *    - When "Auto Allocate" is clicked:
 *      Immediately applies the new distribution from the active manpower and allocates
 *      all days (31 days in Monthly mode or selected 7 days in Weekly mode) with 100% precision,
 *      zero exceed, and balanced daily load.
 */

import { FlightName } from '../types';
import { DutyRatioTable } from '../data/officialDutyRatioMatrix';

export interface ManpowerState {
  mechSgt: number;
  mechCpl: number;
  aviSgt: number;
  aviCpl: number;
  gcsSgt: number;
  gcsCpl: number;
  adminSgt: number;
  adminCpl: number;
}

export const DEFAULT_MANPOWER: ManpowerState = {
  mechSgt: 5,
  mechCpl: 5,
  aviSgt: 4,
  aviCpl: 3,
  gcsSgt: 5,
  gcsCpl: 5,
  adminSgt: 0,
  adminCpl: 3,
};

export function isDefaultManpower(mp?: Partial<ManpowerState> | null): boolean {
  if (!mp) return true;
  return (
    (mp.mechSgt ?? 5) === 5 &&
    (mp.mechCpl ?? 5) === 5 &&
    (mp.aviSgt ?? 4) === 4 &&
    (mp.aviCpl ?? 3) === 3 &&
    (mp.gcsSgt ?? 5) === 5 &&
    (mp.gcsCpl ?? 5) === 5 &&
    (mp.adminSgt ?? 0) === 0 &&
    (mp.adminCpl ?? 3) === 3
  );
}

// Official UASU Target Baseline (Total duties: 398)
// Sum per table matches totalRequiredMonth 100%
// Sum per flight: Mech: 134, Avi: 100, GCS: 134, Admin: 30
export const OFFICIAL_TARGET_BASELINE: Record<string, Record<FlightName, number>> = {
  security_duty:   { Mechanics: 28, Avionics: 18, GCS: 28, Admin: 14 },
  base_tf:         { Mechanics: 8,  Avionics: 5,  GCS: 6,   Admin: 3 },
  nazirpara_tf:    { Mechanics: 14, Avionics: 9,  GCS: 14, Admin: 3 },
  idac_mor:        { Mechanics: 11, Avionics: 7,  GCS: 11, Admin: 2 },
  idac_an:         { Mechanics: 11, Avionics: 7,  GCS: 11, Admin: 2 },
  idac_nt:         { Mechanics: 21, Avionics: 15, GCS: 22, Admin: 4 },
  airport_duty:    { Mechanics: 31, Avionics: 31, GCS: 31, Admin: 0 },
  halishahar_duty: { Mechanics: 10, Avionics: 8,  GCS: 11, Admin: 2 },
};

export function isFixedEqualDuty(table: DutyRatioTable): boolean {
  if (!table || table.isDisabled) return false;

  // If only 1 flight is eligible, it MUST be One From Each Flt (equal)
  if (table.eligibleFlights && table.eligibleFlights.length === 1) {
    return true;
  }

  // 1. Explicit configuration takes highest precedence
  if (table.allotmentType === 'equal') return true;
  if (table.allotmentType === 'ratio') return false;

  // 2. Default fallback for legacy duties (Airfield duty defaults to equal)
  const title = (table.title || '').toUpperCase();
  const id = (table.id || '').toLowerCase();

  if (id === 'airport_duty' || title.includes('AIRFIELD') || title.includes('AIRPORT')) {
    return true;
  }

  return false;
}

/**
 * Checks if a duty has a static daily uniform requirement across all capable flights every day (e.g. Airfield Duty).
 */
export function isStaticDailyUniformDuty(table: Pick<DutyRatioTable, 'id' | 'title'>): boolean {
  const title = (table.title || '').toUpperCase();
  const id = (table.id || '').toLowerCase();
  if (id === 'airport_duty' || title.includes('AIRFIELD') || title.includes('AIRPORT')) {
    return true;
  }
  return false;
}

/**
 * Resolves the required number of duties on a specific day index (0..30) for a duty table.
 */
export function getTableDayReqForIndex(t: DutyRatioTable, dayIdx: number): number {
  if (!t || t.isDisabled) return 0;
  if (t.dailyRequirements && t.dailyRequirements[dayIdx] !== undefined && t.dailyRequirements[dayIdx] !== null) {
    return Number(t.dailyRequirements[dayIdx]) || 0;
  }
  if (t.totalRequiredDaily && (t.totalRequiredDaily * 31 === t.totalRequiredMonth)) {
    return t.totalRequiredDaily;
  }
  if (t.totalRequiredMonth && t.totalRequiredMonth > 0) {
    const base = Math.floor(t.totalRequiredMonth / 31);
    const rem = t.totalRequiredMonth % 31;
    return dayIdx < rem ? base + 1 : base;
  }
  const dataObj = t.data || ({} as Record<string, number[]>);
  const keys = Object.keys(dataObj);
  if (keys.length > 0) {
    return keys.reduce((acc, k) => acc + (Number(dataObj[k]?.[dayIdx]) || 0), 0);
  }
  return 0;
}

export function getFlightStrength(mp: ManpowerState, fl: FlightName, isSecurity: boolean): number {
  let cpl = 0, sgt = 0;
  if (fl === 'Mechanics') { cpl = mp.mechCpl; sgt = mp.mechSgt; }
  if (fl === 'Avionics') { cpl = mp.aviCpl; sgt = mp.aviSgt; }
  if (fl === 'GCS') { cpl = mp.gcsCpl; sgt = mp.gcsSgt; }
  if (fl === 'Admin') { cpl = mp.adminCpl; sgt = mp.adminSgt; }
  return isSecurity ? cpl : (cpl + sgt);
}

/**
 * Universal Duty Ratio Rounding Rule:
 * - Point er pore 50 ba tar kom thakle ager full number hbe (round down: floor)
 * - Point er pore 50 er beshi thakle porer full digit hbe (round up: floor + 1)
 */
export function roundDutyByRule(val: number): number {
  if (val <= 0 || isNaN(val)) return 0;
  const cleanVal = Number(val.toFixed(4));
  const floorVal = Math.floor(cleanVal);
  const frac = Number((cleanVal - floorVal).toFixed(4));

  if (frac > 0.5000) {
    return floorVal + 1;
  }
  return floorVal;
}

/**
 * Calculates auto targets using the user's specific rounding rule:
 * - Each flight gets roundDutyByRule(exactRatio).
 * - CRITICAL: Never automatically increase or decrease any flight's duty to reconcile/match table totals.
 *   Duties remain strictly as per Ratio. Any adjustments to match total required duties are done manually by user.
 */
export function calculateBalancedAutoTargets(
  matrix: DutyRatioTable[],
  manpowerInput?: Partial<ManpowerState> | null,
  reconcileTotals: boolean = false,
  dayIndices?: number[]
): Record<FlightName, Record<string, number>> {
  const flights: FlightName[] = ['Mechanics', 'Avionics', 'GCS', 'Admin'];
  const autoTargets: Record<FlightName, Record<string, number>> = {
    Mechanics: {},
    Avionics: {},
    GCS: {},
    Admin: {},
  };

  const exactRatios = calculateExactDutyRatios(matrix, manpowerInput, dayIndices);

  matrix.forEach((t) => {
    if (t.isDisabled) {
      flights.forEach((fl) => {
        autoTargets[fl][t.id] = 0;
      });
      return;
    }
    const elig = t.eligibleFlights && t.eligibleFlights.length > 0 ? t.eligibleFlights : flights;
    flights.forEach((fl) => {
      const exact = exactRatios[t.id]?.[fl] ?? 0;
      autoTargets[fl][t.id] = elig.includes(fl) ? roundDutyByRule(exact) : 0;
    });

    // NOTE: Strictly no auto-reconciliation of totals!
    // As per user rule: duties must strictly remain as per Ratio (roundDutyByRule).
    // If needed, the user will adjust flight quotas manually.
    void reconcileTotals;
  });

  return autoTargets;
}

/**
 * Calculates exact mathematical ratios (with decimals) for the Show/Hide Exact Ratio view.
 * When `dayIndices` is supplied (e.g. 7 days for Weekly mode), sums only those day indices.
 */
export function calculateExactDutyRatios(
  matrix: DutyRatioTable[],
  manpowerInput?: Partial<ManpowerState> | null,
  dayIndices?: number[]
): Record<string, Record<FlightName, number>> {
  const flights: FlightName[] = ['Mechanics', 'Avionics', 'GCS', 'Admin'];
  const result: Record<string, Record<FlightName, number>> = {};

  const mp: ManpowerState = {
    ...DEFAULT_MANPOWER,
    ...(manpowerInput || {}),
  };

  const getStrength = (fl: FlightName, isSec: boolean) => getFlightStrength(mp, fl, isSec);

  matrix.forEach((t) => {
    result[t.id] = { Mechanics: 0, Avionics: 0, GCS: 0, Admin: 0 };
    if (t.isDisabled) return;
    const isSecurity = t.id === 'security_duty';
    const isFixed = isFixedEqualDuty(t);
    const elig = t.eligibleFlights && t.eligibleFlights.length > 0 ? t.eligibleFlights : flights;
    const total = (dayIndices && dayIndices.length > 0)
      ? dayIndices.reduce((sum, dIdx) => sum + getTableDayReqForIndex(t, dIdx), 0)
      : ((t.dailyRequirements && t.dailyRequirements.length > 0)
          ? t.dailyRequirements.reduce((sum, v) => sum + (Number(v) || 0), 0)
          : (t.totalRequiredMonth || (t.totalRequiredDaily ? t.totalRequiredDaily * 31 : 0)));

    if (isFixed) {
      const per = elig.length > 0 ? total / elig.length : 0;
      flights.forEach((fl) => {
        result[t.id][fl] = elig.includes(fl) ? per : 0;
      });
      return;
    }

    const pool = elig.reduce((s, fl) => s + getStrength(fl, isSecurity), 0);
    flights.forEach((fl) => {
      if (elig.includes(fl)) {
        const st = getStrength(fl, isSecurity);
        result[t.id][fl] = pool > 0 ? (st / pool) * total : 0;
      } else {
        result[t.id][fl] = 0;
      }
    });
  });

  return result;
}

/**
 * Intelligent Matrix Auto Allocation Engine
 * - Supports both Monthly (31 days) and Weekly (7 selected days).
 * - Automatically recalculates targets based on active manpower / disposals.
 * - Strictly enforces that flight quota NEVER exceeds targets (Allocated Total === Target Total).
 * - Minimizes deviation from nearest independent integer:
 *   targetDaily = Math.round(flightTotal / numDays)
 * - Uses a post-allocation swap smoother to eliminate outliers and clusterings.
 */
export type AllocationMode = 'SINGLE' | 'PACKAGE';

export interface AutoAllocateOptions {
  periodMode?: 'MONTHLY' | 'WEEKLY';
  dayIndices?: number[];
  weekRangeKey?: string;
  weeklyTargetsByTable?: Record<string, Partial<Record<FlightName, number>>>;
  flightKeys?: FlightName[];
}

export function autoAllocateDutyMatrix(
  matrix: DutyRatioTable[],
  manpowerInput?: Partial<ManpowerState> | null,
  mode: AllocationMode = 'SINGLE',
  options?: AutoAllocateOptions
): DutyRatioTable[] {
  const isWeekly = options?.periodMode === 'WEEKLY' && Array.isArray(options?.dayIndices) && options!.dayIndices!.length > 0;
  const activeDayIndices = isWeekly
    ? options!.dayIndices!
    : Array.from({ length: 31 }, (_, i) => i);
  const numDays = Math.max(1, activeDayIndices.length);

  const flights: FlightName[] = (options?.flightKeys && options.flightKeys.length > 0)
    ? options.flightKeys
    : ['Mechanics', 'Avionics', 'GCS', 'Admin'];
  const standardFlights: FlightName[] = ['Mechanics', 'Avionics', 'GCS', 'Admin'];

  const mp: ManpowerState = {
    ...DEFAULT_MANPOWER,
    ...(manpowerInput || {}),
  };
  const getStrength = (fl: FlightName, isSec: boolean) => {
    const idx = flights.indexOf(fl);
    const mapped: FlightName = standardFlights.includes(fl)
      ? fl
      : (idx === 0 ? 'Mechanics' : idx === 1 ? 'Avionics' : idx === 2 ? 'GCS' : 'Admin');
    return getFlightStrength(mp, mapped, isSec);
  };
  const autoTargets = calculateBalancedAutoTargets(
    matrix,
    manpowerInput,
    true,
    isWeekly ? activeDayIndices : undefined
  );

  // Build working matrix using virtual length = numDays (0..numDays-1)
  const tableTargets: Record<string, Record<string, number>> = {};

  type WorkTable = Omit<DutyRatioTable, 'data'> & { data: Record<string, number[]> };

  const newMatrix: WorkTable[] = matrix.map((t) => {
    const emptyData: Record<string, number[]> = {};
    flights.forEach((fl) => {
      emptyData[fl] = new Array(numDays).fill(0);
    });
    standardFlights.forEach((fl) => {
      if (!emptyData[fl]) emptyData[fl] = new Array(numDays).fill(0);
    });

    if (t.isDisabled) {
      const zeroTargets: Record<string, number> = {};
      flights.forEach((fl) => { zeroTargets[fl] = 0; });
      tableTargets[t.id] = zeroTargets;
      return {
        ...t,
        totalRequiredMonth: isWeekly ? t.totalRequiredMonth : 0,
        flightTargets: t.flightTargets ? { ...t.flightTargets } : undefined,
        dailyRequirements: isWeekly
          ? (t.dailyRequirements ? [...t.dailyRequirements] : undefined)
          : new Array(31).fill(0),
        data: emptyData,
      };
    }

    const periodTotal = isWeekly
      ? activeDayIndices.reduce((sum, dIdx) => sum + getTableDayReqForIndex(t, dIdx), 0)
      : ((t.dailyRequirements && t.dailyRequirements.length > 0)
          ? t.dailyRequirements.reduce((sum, v) => sum + (Number(v) || 0), 0)
          : (t.totalRequiredMonth || (t.totalRequiredDaily ? t.totalRequiredDaily * 31 : 0)));

    const targets: Record<string, number> = {};
    flights.forEach((fl) => {
      const explicitWeekly = isWeekly
        ? (options?.weeklyTargetsByTable?.[t.id]?.[fl]
            ?? (options?.weekRangeKey ? t.weeklyFlightTargets?.[options.weekRangeKey]?.[fl] : undefined))
        : undefined;
      if (typeof explicitWeekly === 'number') {
        targets[fl] = explicitWeekly;
      } else if (!isWeekly && t.flightTargets && typeof (t.flightTargets as any)[fl] === 'number') {
        targets[fl] = (t.flightTargets as any)[fl];
      } else {
        const idx = flights.indexOf(fl);
        const mappedKey: FlightName = standardFlights.includes(fl)
          ? fl
          : (idx === 0 ? 'Mechanics' : idx === 1 ? 'Avionics' : idx === 2 ? 'GCS' : 'Admin');
        targets[fl] = autoTargets[mappedKey]?.[t.id] ?? 0;
      }
    });

    tableTargets[t.id] = targets;

    return {
      ...t,
      totalRequiredMonth: isWeekly ? t.totalRequiredMonth : periodTotal,
      flightTargets: t.flightTargets ? { ...t.flightTargets } : undefined,
      data: emptyData,
    };
  });

  // Track daily load for each flight on each virtual day (0..numDays-1)
  const dailyFlightLoad: Record<string, number[]> = {};
  const flightPeriodTotals: Record<string, number> = {};
  const flightDailyLimits: Record<string, { min: number; max: number; base: number; rem: number }> = {};
  const idealTargetToday: Record<string, number[]> = {};
  const dailyFlightHeavyLoad: Record<string, number[]> = {};
  const flightHeavyPeriodTotals: Record<string, number> = {};
  const flightHeavyDailyLimits: Record<string, { min: number; max: number }> = {};

  function isHeavyDuty(tableId: string, title?: string): boolean {
    if (tableId === 'security_duty' || tableId === 'base_tf' || tableId === 'nazirpara_tf') {
      return true;
    }
    const t = (title || '').toUpperCase();
    if (t.includes('SECURITY') && (t.includes('BASE') || t.includes('GD'))) return true;
    if (t.includes('BASE TASKFORCE') || t.includes('BASE TF')) return true;
    if (t.includes('NAJIRPARA') || t.includes('NAZIRPARA')) return true;
    return false;
  }

  function computeIdealExtraDays(rem: number, offset: number = 0): boolean[] {
    const result = new Array(numDays).fill(false);
    if (rem <= 0) return result;
    if (rem >= numDays) return new Array(numDays).fill(true);
    const step = numDays / rem;
    for (let k = 0; k < rem; k++) {
      const d = Math.floor(k * step + (offset * step) / Math.max(1, flights.length)) % numDays;
      result[d] = true;
    }
    let count = result.filter(Boolean).length;
    for (let d = 0; count < rem && d < numDays; d++) {
      if (!result[d]) {
        result[d] = true;
        count++;
      }
    }
    return result;
  }

  flights.forEach((fl, flIdx) => {
    dailyFlightLoad[fl] = new Array(numDays).fill(0);
    dailyFlightHeavyLoad[fl] = new Array(numDays).fill(0);

    const total = newMatrix
      .filter((t) => !t.isDisabled)
      .reduce((sum, t) => sum + (tableTargets[t.id]?.[fl] || 0), 0);
    flightPeriodTotals[fl] = total;

    const base = Math.floor(total / numDays);
    const rem = total % numDays;
    flightDailyLimits[fl] = {
      min: base,
      max: rem > 0 ? base + 1 : base,
      base,
      rem,
    };

    idealTargetToday[fl] = new Array(numDays).fill(0);
    const isExtra = computeIdealExtraDays(rem, flIdx);
    for (let d = 0; d < numDays; d++) {
      idealTargetToday[fl][d] = base + (isExtra[d] ? 1 : 0);
    }

    const heavyTotal = newMatrix
      .filter((t) => !t.isDisabled && isHeavyDuty(t.id, t.title))
      .reduce((sum, t) => sum + (tableTargets[t.id]?.[fl] || 0), 0);
    flightHeavyPeriodTotals[fl] = heavyTotal;

    const hBase = Math.floor(heavyTotal / numDays);
    const hRem = heavyTotal % numDays;
    flightHeavyDailyLimits[fl] = {
      min: hBase,
      max: hRem > 0 ? hBase + 1 : hBase,
    };
  });

  function evalDailyLoadCost(load: number, limits: { min: number; max: number }): number {
    if (load < limits.min) {
      return Math.pow(limits.min - load, 2) * 50000;
    }
    if (load > limits.max) {
      return Math.pow(load - limits.max, 2) * 50000;
    }
    return 0;
  }

  function evalHeavyDutyCost(count: number, limits: { min: number; max: number }): number {
    if (count > limits.max) {
      return Math.pow(count - limits.max, 2) * 200000;
    }
    if (count < limits.min) {
      return Math.pow(limits.min - count, 2) * 50000;
    }
    return 0;
  }

  function getEligibleForTable(t: WorkTable): FlightName[] {
    if (t.eligibleFlights && t.eligibleFlights.length > 0) {
      const matched = t.eligibleFlights.filter((f) => flights.includes(f));
      if (matched.length > 0) return matched;
    }
    return flights;
  }

  // Step 2: Fixed Duties (e.g. Airfield Duty: equal share among capable flights every day)
  newMatrix.filter((t) => !t.isDisabled && isStaticDailyUniformDuty(t)).forEach((t) => {
    const origTable = matrix.find((x) => x.id === t.id) || (t as unknown as DutyRatioTable);
    const rawElig = t.eligibleFlights && t.eligibleFlights.length > 0
      ? t.eligibleFlights.filter((f) => flights.includes(f))
      : [];
    const elig: FlightName[] = rawElig.length > 0
      ? rawElig
      : flights.filter((f) => f !== 'Admin');
    const safeElig = elig.length > 0 ? elig : flights;

    const reqSlots = new Array(numDays).fill(0);
    if (isWeekly) {
      for (let v = 0; v < numDays; v++) {
        reqSlots[v] = getTableDayReqForIndex(origTable, activeDayIndices[v]);
      }
    } else {
      const dailySum = (origTable.dailyRequirements || []).reduce((s, v) => s + (Number(v) || 0), 0);
      const expectedTotal = t.totalRequiredMonth || (origTable.totalRequiredDaily ? origTable.totalRequiredDaily * 31 : (safeElig.length * 31));
      if (origTable.dailyRequirements && origTable.dailyRequirements.length === 31 && dailySum === expectedTotal) {
        for (let d = 0; d < 31; d++) {
          reqSlots[d] = Number(origTable.dailyRequirements[d]) || 0;
        }
      } else {
        const base = Math.floor(expectedTotal / 31);
        const rem = expectedTotal % 31;
        const extraDays = computeIdealExtraDays(rem);
        for (let d = 0; d < 31; d++) {
          reqSlots[d] = base + (extraDays[d] ? 1 : 0);
        }
      }
      t.dailyRequirements = [...reqSlots];
    }

    for (let day = 0; day < numDays; day++) {
      const needed = reqSlots[day];
      if (needed <= 0) continue;
      const per = Math.floor(needed / safeElig.length);
      let rem = needed % safeElig.length;
      safeElig.forEach((fl) => {
        const c = per + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        t.data[fl][day] = c;
        dailyFlightLoad[fl][day] += c;
        if (isHeavyDuty(t.id, t.title)) {
          dailyFlightHeavyLoad[fl][day] += c;
        }
      });
    }

    flights.forEach((fl) => {
      const assignedCount = t.data[fl].reduce((a, b) => a + b, 0);
      if (tableTargets[t.id]) {
        tableTargets[t.id][fl] = assignedCount;
      }
    });
  });

  // Helper for gap rules & anti-consecutive limits
  function getDutyLimits(target: number) {
    if (target <= 0) return { maxOnStreak: 0, maxOffStreak: numDays, gaps: numDays };
    if (target >= numDays) return { maxOnStreak: numDays, maxOffStreak: 0, gaps: 0 };
    const gaps = numDays - target;
    let maxOnStreak = 1;

    if (target <= Math.ceil(numDays / 2)) {
      maxOnStreak = 1;
    } else {
      maxOnStreak = Math.max(1, Math.ceil(target / (gaps + 1)));
    }

    let maxOffStreak = 1;
    if (gaps <= Math.round((5 * numDays) / 31)) {
      maxOffStreak = 1;
    } else if (gaps <= Math.round((18 * numDays) / 31)) {
      maxOffStreak = 2;
    } else {
      maxOffStreak = Math.ceil(gaps / (target + 1)) + 1;
    }

    return { maxOnStreak, maxOffStreak, gaps };
  }

  function evalFlightStreakCost(arr: number[], rawTarget: number): number {
    const actualSum = arr.reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
    const target = actualSum > 0 ? actualSum : rawTarget;
    if (target <= 0 || target >= numDays) return 0;
    let cost = 0;
    let curOn = 0;
    let curOff = 0;

    if (mode === 'PACKAGE') {
      const gaps = Math.max(0, numDays - target);
      const canFit23 = target >= 2 && 3 * (gaps + 1) >= target;
      const minBlock = canFit23 ? 2 : Math.max(2, Math.floor(target / Math.max(1, gaps + 1)));
      const maxBlock = canFit23 ? 3 : Math.max(3, Math.ceil(target / Math.max(1, gaps + 1)));
      const maxOffPackage = Math.max(2, Math.ceil(gaps / Math.max(1, Math.floor(target / 2))) + 2);

      const scoreBlock = (len: number) => {
        if (len <= 0) return 0;
        if (target >= 2 && len === 1) return 120000;
        if (len < minBlock) return Math.pow(minBlock - len, 2) * 40000;
        if (len > maxBlock) return Math.pow(len - maxBlock, 2) * 160000;
        return 0;
      };

      for (let d = 0; d < numDays; d++) {
        if (arr[d] > 0) {
          if (curOff > maxOffPackage) {
            cost += Math.pow(curOff - maxOffPackage, 2) * 40;
          }
          curOff = 0;
          curOn++;
        } else {
          if (curOn > 0) {
            cost += scoreBlock(curOn);
            curOn = 0;
          }
          curOff++;
        }
      }
      if (curOn > 0) {
        cost += scoreBlock(curOn);
      }
      if (curOff > maxOffPackage) {
        cost += Math.pow(curOff - maxOffPackage, 2) * 40;
      }
      return cost;
    }

    // SINGLE MODE:
    const { maxOnStreak, maxOffStreak, gaps } = getDutyLimits(target);
    const noConsecCutoff = Math.ceil(numDays / 2);

    for (let d = 0; d < numDays; d++) {
      if (arr[d] > 0) {
        curOn++;
        if (curOff > 0) {
          if (curOff > maxOffStreak) {
            cost += Math.pow(curOff - maxOffStreak, 2) * 1500;
          }
          curOff = 0;
        }
        if (target <= noConsecCutoff) {
          if (curOn === 2) {
            cost += 60000;
          } else if (curOn >= 3) {
            cost += 200000 * Math.pow(curOn - 1, 2);
          }
        } else {
          if (curOn > maxOnStreak) {
            cost += 160000 * Math.pow(curOn - maxOnStreak, 2);
          } else if (curOn > 1) {
            cost += 300 * Math.pow(curOn - 1, 2);
          }
        }
      } else {
        curOff++;
        if (curOn > 0) {
          curOn = 0;
        }
      }
    }

    if (curOff > maxOffStreak) cost += Math.pow(curOff - maxOffStreak, 2) * 1500;
    if (gaps <= Math.round((5 * numDays) / 31) && curOff > 1) cost += 4000 * Math.pow(curOff - 1, 2);

    // In Monthly SINGLE mode: if a flight has off days (target < 31), heavily penalize working all 7 days of days 25-31
    if (!isWeekly && numDays === 31 && target < 31) {
      let endDuties = 0;
      for (let d = 24; d < 31; d++) {
        if (arr[d] > 0) endDuties++;
      }
      if (endDuties >= 7) {
        cost += 1000000;
      }
    }

    return cost;
  }

  // Helper for timeline balance across the period
  function evalFlightTimelineCost(arr: number[], target: number): number {
    if (target <= 0) return 0;
    let cost = 0;
    let cum = 0;
    for (let d = 0; d < numDays; d++) {
      cum += arr[d];
      const ideal = ((d + 1) * target) / numDays;
      cost += Math.pow(cum - ideal, 2);
    }
    const halfDays = Math.floor(numDays / 2);
    if (halfDays > 0) {
      let h1 = 0;
      for (let d = 0; d < halfDays; d++) h1 += arr[d];
      const idealH1 = (halfDays * target) / numDays;
      const diffH1 = Math.abs(h1 - idealH1);
      if (diffH1 > 1.0) {
        cost += Math.pow(diffH1 - 1.0, 2) * 50;
      }
    }
    return cost * 10;
  }

  // Helper for daily total load dispersion across the period
  function evalFlightDailyLoadDispersionCost(fl: string): number {
    const limits = flightDailyLimits[fl];
    const rem = limits.rem;
    if (rem <= 0 || rem >= numDays) return 0;

    let cost = 0;
    let extraCount = 0;
    for (let d = 0; d < numDays; d++) {
      if (dailyFlightLoad[fl][d] > limits.base) {
        extraCount++;
      }
      const idealExtra = ((d + 1) * rem) / numDays;
      cost += Math.pow(extraCount - idealExtra, 2);
    }

    const halfDays = Math.floor(numDays / 2);
    if (halfDays > 0) {
      let h1Extra = 0;
      for (let d = 0; d < halfDays; d++) {
        if (dailyFlightLoad[fl][d] > limits.base) h1Extra++;
      }
      const idealH1Extra = (halfDays * rem) / numDays;
      const diffH1 = Math.abs(h1Extra - idealH1Extra);
      if (diffH1 > 1.0) {
        cost += Math.pow(diffH1 - 1.0, 2) * 80;
      }
    }
    return cost * 15;
  }

  // Step 3: Open Duties Initial Allocation with Anti-Consecutive Scoring
  const openDuties = newMatrix
    .filter((t) => !t.isDisabled && !isStaticDailyUniformDuty(t))
    .sort((a, b) => (b.totalRequiredDaily || 1) - (a.totalRequiredDaily || 1));

  openDuties.forEach((table) => {
    const origTable = matrix.find((x) => x.id === table.id) || (table as unknown as DutyRatioTable);
    const isSecurity = table.id === 'security_duty';
    const elig = getEligibleForTable(table);

    const reqSlots = new Array(numDays).fill(0);
    if (isWeekly) {
      for (let v = 0; v < numDays; v++) {
        reqSlots[v] = getTableDayReqForIndex(origTable, activeDayIndices[v]);
      }
    } else {
      const dailySum = (origTable.dailyRequirements || []).reduce((s, v) => s + (Number(v) || 0), 0);
      if (origTable.dailyRequirements && origTable.dailyRequirements.length === 31 && dailySum === table.totalRequiredMonth) {
        for (let d = 0; d < 31; d++) {
          reqSlots[d] = Number(origTable.dailyRequirements[d]) || 0;
        }
      } else {
        const totalMonth = table.totalRequiredMonth || 0;
        const base = Math.floor(totalMonth / 31);
        const rem = totalMonth % 31;
        const extraDays = computeIdealExtraDays(rem);
        for (let d = 0; d < 31; d++) {
          reqSlots[d] = base + (extraDays[d] ? 1 : 0);
        }
      }
      table.dailyRequirements = [...reqSlots];
    }

    const q = tableTargets[table.id] || {};
    const isThisTableHeavy = isHeavyDuty(table.id, table.title);
    const noConsecCutoff = Math.ceil(numDays / 2);
    const offDaysPaceCutoff = Math.max(1, Math.round((6 * numDays) / 31));
    const hasSlotTomorrow = (dayIdx: number) => dayIdx + 1 < numDays && reqSlots[dayIdx + 1] > 0;
    const countRemainingSlotDaysAfter = (dayIdx: number) => {
      let c = 0;
      for (let k = dayIdx + 1; k < numDays; k++) {
        if (reqSlots[k] > 0) c++;
      }
      return c;
    };

    // Day by day allocation
    for (let d = 0; d < numDays; d++) {
      const needed = reqSlots[d];
      if (needed <= 0) continue;

      const futureSlotDays = countRemainingSlotDaysAfter(d);
      const futureReqDesc = reqSlots.slice(d + 1).filter((r) => r > 0).sort((a, b) => b - a);
      const futurePrefixSums: number[] = [];
      let futureTotalNeeded = 0;
      for (let k = 0; k < futureReqDesc.length; k++) {
        futureTotalNeeded += futureReqDesc[k];
        futurePrefixSums.push(futureTotalNeeded);
      }

      let remainingToAssign = needed;
      while (remainingToAssign > 0) {
        const currentRemWeights = elig.map((fl) => {
          const target = q[fl] || 0;
          const assigned = table.data[fl].reduce((a, b) => a + b, 0);
          return Math.max(0, target - assigned);
        });
        const dynamicTotalRem = currentRemWeights.reduce((s, r) => s + r, 0);

        const buildCandidate = (fl: FlightName) => {
          const target = q[fl] || 0;
          const assigned = table.data[fl].reduce((a, b) => a + b, 0);
          const rem = Math.max(0, target - assigned);
          const st = getStrength(fl, isSecurity);
          const daysLeft = numDays - d;
          let onStreak = 0;
          for (let prev = d - 1; prev >= 0 && table.data[fl][prev] > 0; prev--) onStreak++;
          let offStreak = 0;
          for (let prev = d - 1; prev >= 0 && table.data[fl][prev] === 0; prev--) offStreak++;
          const { maxOnStreak, maxOffStreak, gaps } = getDutyLimits(target);
          const maxAllowedToday = Math.max(1, Math.ceil(target / numDays));
          const canFit23 = target >= 2 && 3 * (gaps + 1) >= target;
          const maxPkgBlock = canFit23 ? 3 : Math.max(3, Math.ceil(target / Math.max(1, gaps + 1)));
          const lim = flightDailyLimits[fl];
          const hLim = flightHeavyDailyLimits[fl];
          const load = dailyFlightLoad[fl][d];
          const hasCapToday = load < lim.max && (!isThisTableHeavy || dailyFlightHeavyLoad[fl][d] < hLim.max);
          const hasCapTomorrow =
            hasSlotTomorrow(d) &&
            dailyFlightLoad[fl][d + 1] < lim.max &&
            (!isThisTableHeavy || dailyFlightHeavyLoad[fl][d + 1] < hLim.max);
          return {
            fl,
            target,
            assigned,
            rem,
            st,
            daysLeft,
            today: table.data[fl][d],
            maxAllowedToday,
            onStreak,
            offStreak,
            maxOnStreak,
            maxOffStreak,
            canFit23,
            maxPkgBlock,
            load,
            hasCapToday,
            hasCapTomorrow,
          };
        };

        const allCandidates = elig.map(buildCandidate);

        let available = allCandidates.filter((x) => {
          if (x.today >= x.maxAllowedToday) return false;
          if (dynamicTotalRem > 0 && x.rem <= 0) return false;

          if (mode === 'SINGLE') {
            if (x.onStreak >= x.maxOnStreak && x.rem < x.daysLeft && dynamicTotalRem > x.rem) return false;
            const xLim = flightDailyLimits[x.fl];
            if (x.load >= xLim.max) {
              const hasOtherWithCap = allCandidates.some((o) =>
                o.fl !== x.fl &&
                o.rem > 0 &&
                o.today < o.maxAllowedToday &&
                o.load < flightDailyLimits[o.fl].max &&
                !(o.onStreak >= o.maxOnStreak && o.rem < o.daysLeft)
              );
              if (hasOtherWithCap) return false;
            }
            return true;
          }

          // PACKAGE MODE filter:
          // Prevent exceeding maxPkgBlock when another eligible candidate is under maxPkgBlock
          if (x.onStreak >= x.maxPkgBlock && x.rem < x.daysLeft) {
            const hasOtherUnderPkgCap = allCandidates.some((o) =>
              o.fl !== x.fl &&
              (dynamicTotalRem === 0 || o.rem > 0) &&
              o.today < o.maxAllowedToday &&
              o.onStreak < o.maxPkgBlock
            );
            if (hasOtherUnderPkgCap) return false;
          }
          // Hold at 2 if rem === 2 (avoid 3 + 1 stranding) when enough future active slots remain
          if (x.onStreak === 2 && x.rem === 2 && futureSlotDays >= x.rem) {
            const hasOtherCandidate = allCandidates.some((o) =>
              o.fl !== x.fl &&
              o.rem > 0 &&
              o.today < o.maxAllowedToday &&
              o.onStreak < o.maxPkgBlock &&
              !(o.onStreak === 2 && o.rem === 2)
            );
            if (hasOtherCandidate) return false;
          }
          // Only respect dailyFlightLimits.max when NOT actively finishing a 1->2 or 2->3 block
          const xLim = flightDailyLimits[x.fl];
          const isCompletingPkg = x.onStreak === 1 || (x.onStreak === 2 && x.rem === 1);
          if (!isCompletingPkg && x.load >= xLim.max) {
            const hasOtherWithCap = allCandidates.some((o) =>
              o.fl !== x.fl &&
              o.rem > 0 &&
              o.today < o.maxAllowedToday &&
              o.load < flightDailyLimits[o.fl].max &&
              o.onStreak < o.maxPkgBlock
            );
            if (hasOtherWithCap) return false;
          }
          return true;
        });

        // Gale-Ryser exact future feasibility guard: never pick a candidate today that mathematically
        // strands remaining quotas or makes future days impossible to fill without >1 duty/day.
        const willPreserveFeasibility = (x: typeof allCandidates[number]): boolean => {
          if (dynamicTotalRem < remainingToAssign + futureTotalNeeded) return true;
          const remAfter = allCandidates.map((c) => ({
            fl: c.fl,
            today: c.fl === x.fl ? c.today + 1 : c.today,
            maxAllowedToday: c.maxAllowedToday,
            rem: c.fl === x.fl ? Math.max(0, c.rem - 1) : c.rem,
          }));
          let needRemToday = remainingToAssign - 1;
          const others = remAfter
            .filter((c) => c.fl !== x.fl && c.today < c.maxAllowedToday && c.rem > 0)
            .sort((a, b) => b.rem - a.rem);
          if (others.length < needRemToday) return false;
          for (let i = 0; i < needRemToday; i++) {
            others[i].rem -= 1;
          }
          for (let k = 1; k <= futurePrefixSums.length; k++) {
            let cap = 0;
            for (const c of remAfter) {
              cap += Math.min(c.rem, k);
            }
            if (cap < futurePrefixSums[k - 1]) return false;
          }
          return true;
        };

        if (available.length > 1 && dynamicTotalRem >= remainingToAssign + futureTotalNeeded) {
          const feasible = available.filter(willPreserveFeasibility);
          if (feasible.length > 0) {
            available = feasible;
          }
        }

        // Relaxed Tier 1 fallback: keep today < maxAllowedToday & rem > 0 (relax onStreak / load cap BEFORE ever hitting 2/day)
        if (available.length === 0) {
          available = allCandidates.filter((x) => x.today < x.maxAllowedToday && (dynamicTotalRem === 0 || x.rem > 0));
          if (available.length > 1 && dynamicTotalRem >= remainingToAssign + futureTotalNeeded) {
            const feasible = available.filter(willPreserveFeasibility);
            if (feasible.length > 0) available = feasible;
          }
        }
        // Relaxed Tier 2 fallback: when dynamicTotalRem === 0 or remaining quotas can't cover today without exceeding quota,
        // still NEVER assign 2/day to a flight when another eligible flight has today === 0!
        if (available.length === 0) {
          available = allCandidates.filter((x) => x.today < x.maxAllowedToday);
        }

        if (available.length === 0) {
          const anyElig = [...elig].sort((f1, f2) => {
            // Strictly prefer flights with fewer duties today first (never double-assign if avoidable)
            if (table.data[f1][d] !== table.data[f2][d]) {
              return table.data[f1][d] - table.data[f2][d];
            }
            const rem1 = Math.max(0, (q[f1] || 0) - table.data[f1].reduce((a, b) => a + b, 0));
            const rem2 = Math.max(0, (q[f2] || 0) - table.data[f2].reduce((a, b) => a + b, 0));
            if ((rem1 > 0) !== (rem2 > 0)) return rem1 > 0 ? -1 : 1;
            if (rem1 !== rem2) return rem2 - rem1;

            const lim1 = flightDailyLimits[f1];
            const lim2 = flightDailyLimits[f2];
            const under1 = dailyFlightLoad[f1][d] < lim1.base ? 1 : 0;
            const under2 = dailyFlightLoad[f2][d] < lim2.base ? 1 : 0;
            if (under1 !== under2) return under2 - under1;

            if (dailyFlightLoad[f1][d] !== dailyFlightLoad[f2][d]) {
              return dailyFlightLoad[f1][d] - dailyFlightLoad[f2][d];
            }

            if (isThisTableHeavy) {
              const h1 = dailyFlightHeavyLoad[f1][d] >= flightHeavyDailyLimits[f1].max ? 1 : 0;
              const h2 = dailyFlightHeavyLoad[f2][d] >= flightHeavyDailyLimits[f2].max ? 1 : 0;
              if (h1 !== h2) return h1 - h2;
              if (dailyFlightHeavyLoad[f1][d] !== dailyFlightHeavyLoad[f2][d]) {
                return dailyFlightHeavyLoad[f1][d] - dailyFlightHeavyLoad[f2][d];
              }
            }
            return 0;
          });
          const chosen = anyElig[0];
          table.data[chosen][d] += 1;
          dailyFlightLoad[chosen][d] += 1;
          if (isThisTableHeavy) {
            dailyFlightHeavyLoad[chosen][d] += 1;
          }
          remainingToAssign--;
          continue;
        }

        const getPkgTier = (x: ReturnType<typeof buildCandidate>): number => {
          if (x.rem >= x.daysLeft && x.rem > 0) return 0; // Must finish quota
          if (x.onStreak === 1 && x.rem >= 1) return 1; // Critical: complete 1 -> 2 block
          if (x.onStreak === 2 && (x.rem === 1 || x.rem === 3 || (!hasSlotTomorrow(d) && x.rem >= 1))) return 2; // Cleanly complete 2 -> 3
          if (x.onStreak === 0 && x.rem >= 2 && x.hasCapTomorrow && x.hasCapToday) return 3; // Start new >=2 block with d+1 capacity
          if (x.onStreak === 2 && x.rem >= 4 && x.hasCapToday) return 4; // Extend 2 -> 3 safely
          if (x.onStreak === 0 && x.rem >= 2 && hasSlotTomorrow(d)) return 5; // Start new block if tomorrow has slot
          if (x.onStreak === 2 && x.rem >= 4) return 6;
          if (x.onStreak === 0 && x.rem >= 2) return 7;
          if (x.onStreak === 2 && x.rem === 2) return 8; // Avoid 3+1 trap
          if (x.onStreak === 0 && x.rem === 1) return 9; // Avoid isolated 1
          if (x.onStreak >= 3 && x.onStreak < x.maxPkgBlock && x.rem >= 1) return 10;
          return 11;
        };

        available.sort((a, b) => {
          const aMust = a.rem >= a.daysLeft && a.rem > 0 ? 1 : 0;
          const bMust = b.rem >= b.daysLeft && b.rem > 0 ? 1 : 0;
          if (aMust !== bMust) return bMust - aMust;

          if (a.today !== b.today) return a.today - b.today;

          if (mode === 'PACKAGE') {
            const aTier = getPkgTier(a);
            const bTier = getPkgTier(b);
            if (aTier !== bTier) return aTier - bTier;

            // When both are starting a new block, slightly prefer the flight that rested longer or needs pace
            if (a.onStreak === 0 && b.onStreak === 0 && a.offStreak !== b.offStreak) {
              const aRemFrac = a.rem / Math.max(1, a.daysLeft);
              const bRemFrac = b.rem / Math.max(1, b.daysLeft);
              if (Math.abs(aRemFrac - bRemFrac) > 0.12) return bRemFrac - aRemFrac;
            }
          }

          if (mode === 'SINGLE') {
            // In SINGLE mode, rest gap comes BEFORE micro daily-load tiebreakers when target <= ceil(numDays/2)
            const aNeedRest = a.target <= noConsecCutoff && a.onStreak >= 1 ? 1 : 0;
            const bNeedRest = b.target <= noConsecCutoff && b.onStreak >= 1 ? 1 : 0;
            if (aNeedRest !== bNeedRest) return aNeedRest - bNeedRest;

            const aOverStreak = a.onStreak >= a.maxOnStreak ? 1 : 0;
            const bOverStreak = b.onStreak >= b.maxOnStreak ? 1 : 0;
            if (aOverStreak !== bOverStreak) return aOverStreak - bOverStreak;
          }

          if (isThisTableHeavy) {
            const aHeavy = dailyFlightHeavyLoad[a.fl][d];
            const bHeavy = dailyFlightHeavyLoad[b.fl][d];
            const aHLimits = flightHeavyDailyLimits[a.fl];
            const bHLimits = flightHeavyDailyLimits[b.fl];

            const aOverMax = aHeavy >= aHLimits.max ? 1 : 0;
            const bOverMax = bHeavy >= bHLimits.max ? 1 : 0;
            if (aOverMax !== bOverMax) return aOverMax - bOverMax;

            if (aHeavy !== bHeavy) return aHeavy - bHeavy;
          }

          const aLimits = flightDailyLimits[a.fl];
          const bLimits = flightDailyLimits[b.fl];
          const aAtOrOverMax = a.load >= aLimits.max ? 1 : 0;
          const bAtOrOverMax = b.load >= bLimits.max ? 1 : 0;
          if (aAtOrOverMax !== bAtOrOverMax) return aAtOrOverMax - bAtOrOverMax;

          const aUnderBase = a.load < aLimits.base ? 1 : 0;
          const bUnderBase = b.load < bLimits.base ? 1 : 0;
          if (aUnderBase !== bUnderBase) return bUnderBase - aUnderBase;

          const aAtOrOverIdeal = a.load >= idealTargetToday[a.fl][d] ? 1 : 0;
          const bAtOrOverIdeal = b.load >= idealTargetToday[b.fl][d] ? 1 : 0;
          if (aAtOrOverIdeal !== bAtOrOverIdeal) return aAtOrOverIdeal - bAtOrOverIdeal;

          if (a.load !== b.load) return a.load - b.load;

          if (mode === 'SINGLE') {
            const aRest = a.onStreak === 0 ? 1 : 0;
            const bRest = b.onStreak === 0 ? 1 : 0;
            if (aRest !== bRest) return bRest - aRest;

            if (a.onStreak !== b.onStreak) {
              return a.onStreak - b.onStreak;
            }

            const aTotalOff = numDays - a.target;
            const bTotalOff = numDays - b.target;
            if (aTotalOff > 0 && bTotalOff > 0 && (aTotalOff <= offDaysPaceCutoff || bTotalOff <= offDaysPaceCutoff)) {
              const aOffTaken = d - a.assigned;
              const bOffTaken = d - b.assigned;
              const aExpectedOff = ((d + 1) * aTotalOff) / numDays;
              const bExpectedOff = ((d + 1) * bTotalOff) / numDays;
              const aOffBurn = aOffTaken - aExpectedOff;
              const bOffBurn = bOffTaken - bExpectedOff;
              if (Math.abs(aOffBurn - bOffBurn) > 0.4) {
                return bOffBurn - aOffBurn;
              }
            }
          }

          const aIdeal = ((d + 1) * a.target) / numDays;
          const bIdeal = ((d + 1) * b.target) / numDays;
          const aAhead = a.assigned >= aIdeal ? 1 : 0;
          const bAhead = b.assigned >= bIdeal ? 1 : 0;
          if (aAhead !== bAhead) return aAhead - bAhead;

          const aPace = a.target > 0 ? (a.assigned / Math.max(0.1, aIdeal)) : 1;
          const bPace = b.target > 0 ? (b.assigned / Math.max(0.1, bIdeal)) : 1;
          if (Math.abs(aPace - bPace) > 0.15) return aPace - bPace;

          const aOffExceed = Math.max(0, a.offStreak - a.maxOffStreak);
          const bOffExceed = Math.max(0, b.offStreak - b.maxOffStreak);
          if (aOffExceed !== bOffExceed) return bOffExceed - aOffExceed;

          const totalSt = elig.reduce((s, fl) => s + getStrength(fl, isSecurity), 0);
          const aRatio = dynamicTotalRem > 0 ? (a.rem / dynamicTotalRem) : (a.st / (totalSt || 1));
          const bRatio = dynamicTotalRem > 0 ? (b.rem / dynamicTotalRem) : (b.st / (totalSt || 1));
          return bRatio - aRatio;
        });

        const chosen = available[0].fl;
        table.data[chosen][d] += 1;
        dailyFlightLoad[chosen][d] += 1;
        if (isThisTableHeavy) {
          dailyFlightHeavyLoad[chosen][d] += 1;
        }
        remainingToAssign--;
      }
    }

    // Step 4: Intra-table 2-opt Swap Optimizer (Phase 4A: strict load cap, Phase 4B: streak repair allowing +/-1 slack for Step 5 to rebalance)
    const runIntraTableOptimizer = (allowLoadSlack: boolean) => {
      const isTableHeavy = isHeavyDuty(table.id, table.title);
      for (let iter = 0; iter < 3000; iter++) {
        let improved = false;

        for (let d1 = 0; d1 < numDays; d1++) {
          for (let d2 = 0; d2 < numDays; d2++) {
            if (d1 === d2) continue;

            for (const f1 of elig) {
              if (table.data[f1][d1] < 1 || table.data[f1][d2] > 0) continue;

              for (const f2 of elig) {
                if (f1 === f2) continue;
                if (table.data[f2][d2] < 1 || table.data[f2][d1] > 0) continue;

                const target1 = q[f1] || 0;
                const target2 = q[f2] || 0;
                const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
                const maxF2 = Math.max(1, Math.ceil(target2 / numDays));
                if (table.data[f1][d2] + 1 > maxF1) continue;
                if (table.data[f2][d1] + 1 > maxF2) continue;

                const slack = allowLoadSlack ? 1 : 0;
                if (dailyFlightLoad[f1][d2] + 1 > flightDailyLimits[f1].max + slack) continue;
                if (dailyFlightLoad[f2][d1] + 1 > flightDailyLimits[f2].max + slack) continue;
                if (allowLoadSlack) {
                  if (dailyFlightLoad[f1][d1] - 1 < Math.max(0, flightDailyLimits[f1].min - 1)) continue;
                  if (dailyFlightLoad[f2][d2] - 1 < Math.max(0, flightDailyLimits[f2].min - 1)) continue;
                }
                if (isTableHeavy) {
                  if (dailyFlightHeavyLoad[f1][d2] + 1 > flightHeavyDailyLimits[f1].max) continue;
                  if (dailyFlightHeavyLoad[f2][d1] + 1 > flightHeavyDailyLimits[f2].max) continue;
                }

                const streakBefore =
                  evalFlightStreakCost(table.data[f1], target1) +
                  evalFlightStreakCost(table.data[f2], target2);

                const heavyCostBefore = isTableHeavy
                  ? evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d1], flightHeavyDailyLimits[f1]) +
                    evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d2], flightHeavyDailyLimits[f1]) +
                    evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d1], flightHeavyDailyLimits[f2]) +
                    evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d2], flightHeavyDailyLimits[f2])
                  : 0;

                const loadCostBefore =
                  evalDailyLoadCost(dailyFlightLoad[f1][d1], flightDailyLimits[f1]) +
                  evalDailyLoadCost(dailyFlightLoad[f1][d2], flightDailyLimits[f1]) +
                  evalDailyLoadCost(dailyFlightLoad[f2][d1], flightDailyLimits[f2]) +
                  evalDailyLoadCost(dailyFlightLoad[f2][d2], flightDailyLimits[f2]);

                const costBefore =
                  streakBefore +
                  evalFlightTimelineCost(table.data[f1], target1) +
                  evalFlightTimelineCost(table.data[f2], target2) +
                  evalFlightDailyLoadDispersionCost(f1) +
                  evalFlightDailyLoadDispersionCost(f2) +
                  heavyCostBefore +
                  (allowLoadSlack ? Math.round(loadCostBefore * 0.25) : loadCostBefore);

                table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                table.data[f2][d2] -= 1; table.data[f2][d1] += 1;
                dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
                dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d1] += 1;
                if (isTableHeavy) {
                  dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                  dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d1] += 1;
                }

                const streakAfter =
                  evalFlightStreakCost(table.data[f1], target1) +
                  evalFlightStreakCost(table.data[f2], target2);

                const heavyCostAfter = isTableHeavy
                  ? evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d1], flightHeavyDailyLimits[f1]) +
                    evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d2], flightHeavyDailyLimits[f1]) +
                    evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d1], flightHeavyDailyLimits[f2]) +
                    evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d2], flightHeavyDailyLimits[f2])
                  : 0;

                const loadCostAfter =
                  evalDailyLoadCost(dailyFlightLoad[f1][d1], flightDailyLimits[f1]) +
                  evalDailyLoadCost(dailyFlightLoad[f1][d2], flightDailyLimits[f1]) +
                  evalDailyLoadCost(dailyFlightLoad[f2][d1], flightDailyLimits[f2]) +
                  evalDailyLoadCost(dailyFlightLoad[f2][d2], flightDailyLimits[f2]);

                const costAfter =
                  streakAfter +
                  evalFlightTimelineCost(table.data[f1], target1) +
                  evalFlightTimelineCost(table.data[f2], target2) +
                  evalFlightDailyLoadDispersionCost(f1) +
                  evalFlightDailyLoadDispersionCost(f2) +
                  heavyCostAfter +
                  (allowLoadSlack ? Math.round(loadCostAfter * 0.25) : loadCostAfter);

                const accept = allowLoadSlack
                  ? streakAfter + 5000 < streakBefore
                  : costAfter < costBefore;

                if (accept) {
                  improved = true;
                  break;
                } else {
                  table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                  table.data[f2][d2] += 1; table.data[f2][d1] -= 1;
                  dailyFlightLoad[f1][d1] += 1; dailyFlightLoad[f1][d2] -= 1;
                  dailyFlightLoad[f2][d2] += 1; dailyFlightLoad[f2][d1] -= 1;
                  if (isTableHeavy) {
                    dailyFlightHeavyLoad[f1][d1] += 1; dailyFlightHeavyLoad[f1][d2] -= 1;
                    dailyFlightHeavyLoad[f2][d2] += 1; dailyFlightHeavyLoad[f2][d1] -= 1;
                  }
                }
              }
              if (improved) break;
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (!improved) break;
      }
    };

    runIntraTableOptimizer(false);
    // Run slack repair pass if any flight still has high streak violation
    const hasHighStreakPenalty = elig.some((fl) => evalFlightStreakCost(table.data[fl], q[fl] || 0) >= 40000);
    if (hasHighStreakPenalty) {
      runIntraTableOptimizer(true);
    }
  });

  // Sync tableTargets & flight daily/heavy limits to actual post-Step-3 allocated counts
  newMatrix.forEach((t) => {
    if (t.isDisabled) return;
    if (!tableTargets[t.id]) tableTargets[t.id] = {};
    flights.forEach((fl) => {
      tableTargets[t.id][fl] = (t.data[fl] || []).reduce((a, b) => a + b, 0);
    });
  });
  flights.forEach((fl, flIdx) => {
    const actualTotal = dailyFlightLoad[fl].reduce((a, b) => a + b, 0);
    flightPeriodTotals[fl] = actualTotal;
    const base = Math.floor(actualTotal / numDays);
    const rem = actualTotal % numDays;
    flightDailyLimits[fl] = {
      min: base,
      max: rem > 0 ? base + 1 : base,
      base,
      rem,
    };
    const isExtra = computeIdealExtraDays(rem, flIdx);
    for (let d = 0; d < numDays; d++) {
      idealTargetToday[fl][d] = base + (isExtra[d] ? 1 : 0);
    }

    const actualHeavyTotal = dailyFlightHeavyLoad[fl].reduce((a, b) => a + b, 0);
    flightHeavyPeriodTotals[fl] = actualHeavyTotal;
    const hBase = Math.floor(actualHeavyTotal / numDays);
    const hRem = actualHeavyTotal % numDays;
    flightHeavyDailyLimits[fl] = {
      min: hBase,
      max: hRem > 0 ? hBase + 1 : hBase,
    };
  });

  // Helper to check whether a table swap between (fl, dOut->dIn) and (f2, dIn->dOut) preserves or worsens streak cost
  const computeSwapStreakDelta = (t: WorkTable, fl: string, f2: string, dOut: number, dIn: number): number => {
    const tgt1 = tableTargets[t.id]?.[fl] ?? 0;
    const tgt2 = tableTargets[t.id]?.[f2] ?? 0;
    const before = evalFlightStreakCost(t.data[fl], tgt1) + evalFlightStreakCost(t.data[f2], tgt2);
    t.data[fl][dOut] -= 1; t.data[fl][dIn] += 1;
    t.data[f2][dIn] -= 1; t.data[f2][dOut] += 1;
    const after = evalFlightStreakCost(t.data[fl], tgt1) + evalFlightStreakCost(t.data[f2], tgt2);
    t.data[fl][dOut] += 1; t.data[fl][dIn] -= 1;
    t.data[f2][dIn] += 1; t.data[f2][dOut] -= 1;
    return after - before;
  };

  // Step 5: Global Multi-Table Daily Load Equalizer (Strict (B, B+1) Enforcement + Streak Preservation)
  // Pass 1 strictly forbids worsening streak cost (streakDelta <= 0); Pass 2 resolves any remaining out-of-bounds days.
  for (const strictStreakPass of [true, false]) {
    for (let round = 0; round < (strictStreakPass ? 20 : 15); round++) {
      let globalChange = false;

      for (const fl of flights) {
        const limits = flightDailyLimits[fl];

        // PART A: Eliminate any OVERLOADED days (load > limits.max)
        for (let dHigh = 0; dHigh < numDays; dHigh++) {
          if (dailyFlightLoad[fl][dHigh] <= limits.max) continue;

          let bestMove: { t: WorkTable; f2: FlightName; dLow: number; streakDelta: number } | null = null;
          for (let dLow = 0; dLow < numDays; dLow++) {
            if (dLow === dHigh) continue;
            if (dailyFlightLoad[fl][dLow] >= limits.max) continue;

            for (const t of newMatrix.filter((x) => !x.isDisabled)) {
              if (isStaticDailyUniformDuty(t)) continue;
              if (t.data[fl][dHigh] < 1) continue;

              const elig = getEligibleForTable(t);
              if (!elig.includes(fl)) continue;

              const isTHeavy = isHeavyDuty(t.id, t.title);
              if (isTHeavy && dailyFlightHeavyLoad[fl][dLow] + 1 > flightHeavyDailyLimits[fl].max) continue;

              const targetFl = tableTargets[t.id]?.[fl] ?? 0;
              const maxFl = Math.max(1, Math.ceil(targetFl / numDays));
              if (t.data[fl][dLow] + 1 > maxFl) continue;

              for (const f2 of elig) {
                if (f2 === fl) continue;
                if (t.data[f2][dLow] < 1) continue;
                if (isTHeavy && dailyFlightHeavyLoad[f2][dHigh] + 1 > flightHeavyDailyLimits[f2].max) continue;

                const targetF2 = tableTargets[t.id]?.[f2] ?? 0;
                const maxF2 = Math.max(1, Math.ceil(targetF2 / numDays));
                if (t.data[f2][dHigh] + 1 > maxF2) continue;

                const f2Limits = flightDailyLimits[f2];
                if (dailyFlightLoad[f2][dHigh] + 1 > f2Limits.max) continue;
                if (dailyFlightLoad[f2][dLow] - 1 < f2Limits.min) continue;
                if (dailyFlightLoad[fl][dLow] + 1 > limits.max) continue;

                const streakDelta = computeSwapStreakDelta(t, fl, f2, dHigh, dLow);
                if (strictStreakPass && streakDelta > 0) continue;
                if (!bestMove || streakDelta < bestMove.streakDelta) {
                  bestMove = { t, f2, dLow, streakDelta };
                }
              }
            }
          }

          if (bestMove) {
            const { t, f2, dLow } = bestMove;
            const isTHeavy = isHeavyDuty(t.id, t.title);
            t.data[fl][dHigh] -= 1; t.data[fl][dLow] += 1;
            t.data[f2][dLow] -= 1; t.data[f2][dHigh] += 1;
            dailyFlightLoad[fl][dHigh] -= 1; dailyFlightLoad[fl][dLow] += 1;
            dailyFlightLoad[f2][dLow] -= 1; dailyFlightLoad[f2][dHigh] += 1;
            if (isTHeavy) {
              dailyFlightHeavyLoad[fl][dHigh] -= 1; dailyFlightHeavyLoad[fl][dLow] += 1;
              dailyFlightHeavyLoad[f2][dLow] -= 1; dailyFlightHeavyLoad[f2][dHigh] += 1;
            }
            globalChange = true;
          }
        }

        // PART B: Eliminate any UNDERLOADED days (load < limits.min)
        for (let dLow = 0; dLow < numDays; dLow++) {
          if (dailyFlightLoad[fl][dLow] >= limits.min) continue;

          let bestMove: { t: WorkTable; f2: FlightName; dHigh: number; streakDelta: number } | null = null;
          for (let dHigh = 0; dHigh < numDays; dHigh++) {
            if (dLow === dHigh) continue;
            if (dailyFlightLoad[fl][dHigh] <= limits.min) continue;

            for (const t of newMatrix.filter((x) => !x.isDisabled)) {
              if (isStaticDailyUniformDuty(t)) continue;
              if (t.data[fl][dHigh] < 1) continue;

              const elig = getEligibleForTable(t);
              if (!elig.includes(fl)) continue;

              const isTHeavy = isHeavyDuty(t.id, t.title);
              if (isTHeavy && dailyFlightHeavyLoad[fl][dLow] + 1 > flightHeavyDailyLimits[fl].max) continue;

              const targetFl = tableTargets[t.id]?.[fl] ?? 0;
              const maxFl = Math.max(1, Math.ceil(targetFl / numDays));
              if (t.data[fl][dLow] + 1 > maxFl) continue;

              for (const f2 of elig) {
                if (f2 === fl) continue;
                if (t.data[f2][dLow] < 1) continue;
                if (isTHeavy && dailyFlightHeavyLoad[f2][dHigh] + 1 > flightHeavyDailyLimits[f2].max) continue;

                const targetF2 = tableTargets[t.id]?.[f2] ?? 0;
                const maxF2 = Math.max(1, Math.ceil(targetF2 / numDays));
                if (t.data[f2][dHigh] + 1 > maxF2) continue;

                const f2Limits = flightDailyLimits[f2];
                if (dailyFlightLoad[f2][dHigh] + 1 > f2Limits.max) continue;
                if (dailyFlightLoad[f2][dLow] - 1 < f2Limits.min) continue;
                if (dailyFlightLoad[fl][dLow] + 1 > limits.max) continue;
                if (dailyFlightLoad[fl][dHigh] - 1 < limits.min) continue;

                const streakDelta = computeSwapStreakDelta(t, fl, f2, dHigh, dLow);
                if (strictStreakPass && streakDelta > 0) continue;
                if (!bestMove || streakDelta < bestMove.streakDelta) {
                  bestMove = { t, f2, dHigh, streakDelta };
                }
              }
            }
          }

          if (!bestMove && !strictStreakPass && dailyFlightLoad[fl][dLow] === 0) {
            // If a flight is at 0 on a light day, allow borrowing 1 from a larger flight (>= 4 duties on dLow)
            let bestFallbackScore = Infinity;
            for (let dHigh = 0; dHigh < numDays; dHigh++) {
              if (dLow === dHigh || dailyFlightLoad[fl][dHigh] <= limits.min) continue;
              const flOverMaxOnHigh = dailyFlightLoad[fl][dHigh] > limits.max;
              for (const t of newMatrix.filter((x) => !x.isDisabled && !isStaticDailyUniformDuty(x))) {
                if (t.data[fl][dHigh] < 1) continue;
                const elig = getEligibleForTable(t);
                if (!elig.includes(fl)) continue;
                const isTHeavy = isHeavyDuty(t.id, t.title);
                if (isTHeavy && dailyFlightHeavyLoad[fl][dLow] + 1 > flightHeavyDailyLimits[fl].max) continue;
                const maxFl = Math.max(1, Math.ceil((tableTargets[t.id]?.[fl] ?? 0) / numDays));
                if (t.data[fl][dLow] + 1 > maxFl) continue;
                for (const f2 of elig) {
                  if (f2 === fl || t.data[f2][dLow] < 1) continue;
                  const f2Limits = flightDailyLimits[f2];
                  if (dailyFlightLoad[f2][dLow] < Math.max(4, f2Limits.min)) continue;
                  if (isTHeavy && dailyFlightHeavyLoad[f2][dHigh] + 1 > flightHeavyDailyLimits[f2].max) continue;
                  const maxF2 = Math.max(1, Math.ceil((tableTargets[t.id]?.[f2] ?? 0) / numDays));
                  if (t.data[f2][dHigh] + 1 > maxF2) continue;
                  const f2ExceedsMax = dailyFlightLoad[f2][dHigh] + 1 > f2Limits.max;
                  if (f2ExceedsMax && !(flOverMaxOnHigh && f2Limits.max >= 3 && dailyFlightLoad[f2][dHigh] + 1 <= f2Limits.max + 1)) {
                    continue;
                  }
                  const streakDelta = computeSwapStreakDelta(t, fl, f2, dHigh, dLow);
                  const score = (f2ExceedsMax ? 500000 : 0) + streakDelta;
                  if (score < bestFallbackScore) {
                    bestFallbackScore = score;
                    bestMove = { t, f2, dHigh, streakDelta };
                  }
                }
              }
            }
          }

          if (bestMove) {
            const { t, f2, dHigh } = bestMove;
            const isTHeavy = isHeavyDuty(t.id, t.title);
            t.data[fl][dHigh] -= 1; t.data[fl][dLow] += 1;
            t.data[f2][dLow] -= 1; t.data[f2][dHigh] += 1;
            dailyFlightLoad[fl][dHigh] -= 1; dailyFlightLoad[fl][dLow] += 1;
            dailyFlightLoad[f2][dLow] -= 1; dailyFlightLoad[f2][dHigh] += 1;
            if (isTHeavy) {
              dailyFlightHeavyLoad[fl][dHigh] -= 1; dailyFlightHeavyLoad[fl][dLow] += 1;
              dailyFlightHeavyLoad[f2][dLow] -= 1; dailyFlightHeavyLoad[f2][dHigh] += 1;
            }
            globalChange = true;
          } else if (!strictStreakPass && dailyFlightLoad[fl][dLow] < limits.min) {
            // 3-flight cycle repair for remaining underloaded day:
            // fl: dHigh -> dLow, fA: dLow -> dMid, fB: dMid -> dHigh
            let bestCycle: { t: WorkTable; fA: FlightName; fB: FlightName; dHigh: number; dMid: number; delta: number } | null = null;
            for (let dHigh = 0; dHigh < numDays; dHigh++) {
              if (dHigh === dLow || dailyFlightLoad[fl][dHigh] <= limits.min) continue;
              for (const t of newMatrix.filter((x) => !x.isDisabled && !isStaticDailyUniformDuty(x))) {
                if (t.data[fl][dHigh] < 1) continue;
                const elig = getEligibleForTable(t);
                if (!elig.includes(fl) || elig.length < 3) continue;
                const isTHeavy = isHeavyDuty(t.id, t.title);
                if (isTHeavy && dailyFlightHeavyLoad[fl][dLow] + 1 > flightHeavyDailyLimits[fl].max) continue;
                const maxFl = Math.max(1, Math.ceil((tableTargets[t.id]?.[fl] ?? 0) / numDays));
                if (t.data[fl][dLow] + 1 > maxFl) continue;

                for (const fA of elig) {
                  if (fA === fl || t.data[fA][dLow] < 1) continue;
                  const fALim = flightDailyLimits[fA];
                  if (dailyFlightLoad[fA][dLow] - 1 < fALim.min) continue;
                  const maxFA = Math.max(1, Math.ceil((tableTargets[t.id]?.[fA] ?? 0) / numDays));

                  for (const fB of elig) {
                    if (fB === fl || fB === fA || t.data[fB][dHigh] > 0) continue;
                    const fBLim = flightDailyLimits[fB];
                    if (dailyFlightLoad[fB][dHigh] + 1 > fBLim.max) continue;
                    if (isTHeavy && dailyFlightHeavyLoad[fB][dHigh] + 1 > flightHeavyDailyLimits[fB].max) continue;
                    const maxFB = Math.max(1, Math.ceil((tableTargets[t.id]?.[fB] ?? 0) / numDays));
                    if (t.data[fB][dHigh] + 1 > maxFB) continue;

                    for (let dMid = 0; dMid < numDays; dMid++) {
                      if (dMid === dLow || dMid === dHigh) continue;
                      if (t.data[fA][dMid] > 0 || t.data[fB][dMid] < 1) continue;
                      if (t.data[fA][dMid] + 1 > maxFA) continue;
                      if (dailyFlightLoad[fA][dMid] + 1 > fALim.max) continue;
                      if (dailyFlightLoad[fB][dMid] - 1 < fBLim.min) continue;
                      if (isTHeavy) {
                        if (dailyFlightHeavyLoad[fA][dMid] + 1 > flightHeavyDailyLimits[fA].max) continue;
                        if (dailyFlightHeavyLoad[fB][dMid] - 1 < flightHeavyDailyLimits[fB].min) continue;
                      }
                      const before =
                        evalFlightStreakCost(t.data[fl], tableTargets[t.id]?.[fl] ?? 0) +
                        evalFlightStreakCost(t.data[fA], tableTargets[t.id]?.[fA] ?? 0) +
                        evalFlightStreakCost(t.data[fB], tableTargets[t.id]?.[fB] ?? 0);
                      t.data[fl][dHigh] -= 1; t.data[fl][dLow] += 1;
                      t.data[fA][dLow] -= 1; t.data[fA][dMid] += 1;
                      t.data[fB][dMid] -= 1; t.data[fB][dHigh] += 1;
                      const after =
                        evalFlightStreakCost(t.data[fl], tableTargets[t.id]?.[fl] ?? 0) +
                        evalFlightStreakCost(t.data[fA], tableTargets[t.id]?.[fA] ?? 0) +
                        evalFlightStreakCost(t.data[fB], tableTargets[t.id]?.[fB] ?? 0);
                      t.data[fl][dHigh] += 1; t.data[fl][dLow] -= 1;
                      t.data[fA][dLow] += 1; t.data[fA][dMid] -= 1;
                      t.data[fB][dMid] += 1; t.data[fB][dHigh] -= 1;
                      const delta = after - before;
                      if (!bestCycle || delta < bestCycle.delta) {
                        bestCycle = { t, fA, fB, dHigh, dMid, delta };
                      }
                    }
                  }
                }
              }
            }
            if (bestCycle) {
              const { t, fA, fB, dHigh, dMid } = bestCycle;
              const isTHeavy = isHeavyDuty(t.id, t.title);
              t.data[fl][dHigh] -= 1; t.data[fl][dLow] += 1;
              t.data[fA][dLow] -= 1; t.data[fA][dMid] += 1;
              t.data[fB][dMid] -= 1; t.data[fB][dHigh] += 1;
              dailyFlightLoad[fl][dHigh] -= 1; dailyFlightLoad[fl][dLow] += 1;
              dailyFlightLoad[fA][dLow] -= 1; dailyFlightLoad[fA][dMid] += 1;
              dailyFlightLoad[fB][dMid] -= 1; dailyFlightLoad[fB][dHigh] += 1;
              if (isTHeavy) {
                dailyFlightHeavyLoad[fl][dHigh] -= 1; dailyFlightHeavyLoad[fl][dLow] += 1;
                dailyFlightHeavyLoad[fA][dLow] -= 1; dailyFlightHeavyLoad[fA][dMid] += 1;
                dailyFlightHeavyLoad[fB][dMid] -= 1; dailyFlightHeavyLoad[fB][dHigh] += 1;
              }
              globalChange = true;
            }
          }
        }

      // PART C: Eliminate clustering of (base + 1) duties ONLY if streak cost does NOT worsen
      if (limits.rem > 0) {
        for (let dHigh = 0; dHigh < numDays; dHigh++) {
          if (dailyFlightLoad[fl][dHigh] <= idealTargetToday[fl][dHigh]) continue;

          for (let dLow = 0; dLow < numDays; dLow++) {
            if (dLow === dHigh) continue;
            if (dailyFlightLoad[fl][dLow] >= idealTargetToday[fl][dLow]) continue;

            let swapped = false;
            for (const t of newMatrix.filter((x) => !x.isDisabled)) {
              if (isStaticDailyUniformDuty(t)) continue;
              if (t.data[fl][dHigh] < 1) continue;

              const elig = getEligibleForTable(t);
              if (!elig.includes(fl)) continue;

              const isTHeavy = isHeavyDuty(t.id, t.title);
              if (isTHeavy && dailyFlightHeavyLoad[fl][dLow] + 1 > flightHeavyDailyLimits[fl].max) continue;

              const targetFl = tableTargets[t.id]?.[fl] ?? 0;
              const maxFl = Math.max(1, Math.ceil(targetFl / numDays));
              if (t.data[fl][dLow] + 1 > maxFl) continue;

              for (const f2 of elig) {
                if (f2 === fl) continue;
                if (t.data[f2][dLow] < 1) continue;
                if (isTHeavy && dailyFlightHeavyLoad[f2][dHigh] + 1 > flightHeavyDailyLimits[f2].max) continue;

                const targetF2 = tableTargets[t.id]?.[f2] ?? 0;
                const maxF2 = Math.max(1, Math.ceil(targetF2 / numDays));
                if (t.data[f2][dHigh] + 1 > maxF2) continue;

                const f2Limits = flightDailyLimits[f2];
                if (dailyFlightLoad[fl][dLow] + 1 > limits.max) continue;
                if (dailyFlightLoad[fl][dHigh] - 1 < limits.min) continue;
                if (dailyFlightLoad[f2][dHigh] + 1 > f2Limits.max) continue;
                if (dailyFlightLoad[f2][dLow] - 1 < f2Limits.min) continue;

                // Never break SINGLE rest gaps or PACKAGE 2-3 day blocks for minor idealTargetToday smoothing
                if (computeSwapStreakDelta(t, fl, f2, dHigh, dLow) > 0) continue;

                const curDiff =
                  Math.pow(dailyFlightLoad[fl][dHigh] - idealTargetToday[fl][dHigh], 2) +
                  Math.pow(dailyFlightLoad[fl][dLow] - idealTargetToday[fl][dLow], 2) +
                  Math.pow(dailyFlightLoad[f2][dHigh] - idealTargetToday[f2][dHigh], 2) +
                  Math.pow(dailyFlightLoad[f2][dLow] - idealTargetToday[f2][dLow], 2);

                const nextDiff =
                  Math.pow((dailyFlightLoad[fl][dHigh] - 1) - idealTargetToday[fl][dHigh], 2) +
                  Math.pow((dailyFlightLoad[fl][dLow] + 1) - idealTargetToday[fl][dLow], 2) +
                  Math.pow((dailyFlightLoad[f2][dHigh] + 1) - idealTargetToday[f2][dHigh], 2) +
                  Math.pow((dailyFlightLoad[f2][dLow] - 1) - idealTargetToday[f2][dLow], 2);

                if (nextDiff < curDiff) {
                  t.data[fl][dHigh] -= 1; t.data[fl][dLow] += 1;
                  t.data[f2][dLow] -= 1; t.data[f2][dHigh] += 1;
                  dailyFlightLoad[fl][dHigh] -= 1; dailyFlightLoad[fl][dLow] += 1;
                  dailyFlightLoad[f2][dLow] -= 1; dailyFlightLoad[f2][dHigh] += 1;
                  if (isTHeavy) {
                    dailyFlightHeavyLoad[fl][dHigh] -= 1; dailyFlightHeavyLoad[fl][dLow] += 1;
                    dailyFlightHeavyLoad[f2][dLow] -= 1; dailyFlightHeavyLoad[f2][dHigh] += 1;
                  }
                  swapped = true;
                  globalChange = true;
                  break;
                }
              }
              if (swapped) break;
            }
            if (swapped) break;
          }
        }
      }
      }
      if (!globalChange) break;
    }
  }

  // Step 6: Heavy Duty Conflict Resolver (Pass 1 strictly preserves streak quality; Pass 2 resolves any remaining heavy clashes)
  for (const strictHeavyStreak of [true, false]) {
    for (let round = 0; round < 100; round++) {
      let resolvedAny = false;

      for (let d = 0; d < numDays; d++) {
        for (const fl of flights) {
          const heavyCount = dailyFlightHeavyLoad[fl][d];
          const flHLimits = flightHeavyDailyLimits[fl];
          if (heavyCount <= flHLimits.max) continue;

          const heavyTables = newMatrix.filter(
            (t) => !t.isDisabled && isHeavyDuty(t.id, t.title) && (t.data[fl]?.[d] || 0) > 0
          );

          let bestHeavyFix: {
            t: WorkTable;
            f2: FlightName;
            dOther: number;
            lightTable: WorkTable | null;
            streakDelta: number;
          } | null = null;

          for (const t of heavyTables) {
            if (isStaticDailyUniformDuty(t)) continue;
            const elig = getEligibleForTable(t);

            for (const f2 of elig) {
              if (f2 === fl) continue;
              const f2HLimits = flightHeavyDailyLimits[f2];
              if (dailyFlightHeavyLoad[f2][d] >= f2HLimits.max) continue;

              for (let dOther = 0; dOther < numDays; dOther++) {
                if (dOther === d) continue;
                if (t.data[f2][dOther] < 1 || t.data[fl][dOther] > 0) continue;
                if (dailyFlightHeavyLoad[fl][dOther] + 1 > flHLimits.max) continue;

                const flLimits = flightDailyLimits[fl];
                const f2Limits = flightDailyLimits[f2];
                const curLoadPen =
                  evalDailyLoadCost(dailyFlightLoad[fl][d], flLimits) +
                  evalDailyLoadCost(dailyFlightLoad[fl][dOther], flLimits) +
                  evalDailyLoadCost(dailyFlightLoad[f2][d], f2Limits) +
                  evalDailyLoadCost(dailyFlightLoad[f2][dOther], f2Limits);

                const nextLoadPen =
                  evalDailyLoadCost(dailyFlightLoad[fl][d] - 1, flLimits) +
                  evalDailyLoadCost(dailyFlightLoad[fl][dOther] + 1, flLimits) +
                  evalDailyLoadCost(dailyFlightLoad[f2][d] + 1, f2Limits) +
                  evalDailyLoadCost(dailyFlightLoad[f2][dOther] - 1, f2Limits);

                const maxFlDOther = Math.max(1, Math.ceil((tableTargets[t.id]?.[fl] || 0) / numDays));
                if (t.data[fl][dOther] + 1 > maxFlDOther) continue;
                const maxF2D = Math.max(1, Math.ceil((tableTargets[t.id]?.[f2] || 0) / numDays));
                if (t.data[f2][d] + 1 > maxF2D) continue;

                let lightTable: WorkTable | null = null;
                let bestLightDelta = Infinity;
                for (const tLight of newMatrix.filter((x) => !x.isDisabled && !isHeavyDuty(x.id, x.title) && !isStaticDailyUniformDuty(x))) {
                  if ((tLight.data[fl]?.[dOther] || 0) > 0 && (tLight.data[f2]?.[d] || 0) > 0) {
                    const maxLtFlD = Math.max(1, Math.ceil((tableTargets[tLight.id]?.[fl] || 0) / numDays));
                    if ((tLight.data[fl]?.[d] || 0) + 1 > maxLtFlD) continue;
                    const maxLtF2DOther = Math.max(1, Math.ceil((tableTargets[tLight.id]?.[f2] || 0) / numDays));
                    if ((tLight.data[f2]?.[dOther] || 0) + 1 > maxLtF2DOther) continue;
                    const lDelta = computeSwapStreakDelta(tLight, fl, f2, dOther, d);
                    if (lDelta < bestLightDelta) {
                      bestLightDelta = lDelta;
                      lightTable = tLight;
                    }
                  }
                }

                if (!lightTable) {
                  if (dailyFlightLoad[fl][dOther] + 1 > flLimits.max) continue;
                  if (dailyFlightLoad[f2][d] + 1 > f2Limits.max) continue;
                  if (dailyFlightLoad[fl][d] - 1 < flLimits.min) continue;
                  if (dailyFlightLoad[f2][dOther] - 1 < f2Limits.min) continue;
                }

                if (lightTable || heavyCount > flHLimits.max || nextLoadPen <= curLoadPen) {
                  const totalDelta = computeSwapStreakDelta(t, fl, f2, d, dOther) + (lightTable ? bestLightDelta : 0);
                  if (strictHeavyStreak && totalDelta > 0) continue;
                  if (!bestHeavyFix || totalDelta < bestHeavyFix.streakDelta) {
                    bestHeavyFix = { t, f2, dOther, lightTable, streakDelta: totalDelta };
                  }
                }
              }
            }
          }

          if (bestHeavyFix) {
            const { t, f2, dOther, lightTable } = bestHeavyFix;
            t.data[fl][d] -= 1; t.data[fl][dOther] += 1;
            t.data[f2][d] += 1; t.data[f2][dOther] -= 1;

            dailyFlightLoad[fl][d] -= 1; dailyFlightLoad[fl][dOther] += 1;
            dailyFlightLoad[f2][d] += 1; dailyFlightLoad[f2][dOther] -= 1;

            dailyFlightHeavyLoad[fl][d] -= 1; dailyFlightHeavyLoad[fl][dOther] += 1;
            dailyFlightHeavyLoad[f2][d] += 1; dailyFlightHeavyLoad[f2][dOther] -= 1;

            if (lightTable) {
              lightTable.data[fl][dOther] -= 1; lightTable.data[fl][d] += 1;
              lightTable.data[f2][d] -= 1; lightTable.data[f2][dOther] += 1;

              dailyFlightLoad[fl][dOther] -= 1; dailyFlightLoad[fl][d] += 1;
              dailyFlightLoad[f2][d] -= 1; dailyFlightLoad[f2][dOther] += 1;
            }

            resolvedAny = true;
          }
        }
      }
      if (!resolvedAny) break;
    }
  }

  // Step 7: Final Streak & Block Polish Pass (Single-table 2-opt + Cross-table Compensating Paired Swaps)
  const activeOpenTables = newMatrix.filter((t) => !t.isDisabled && !isStaticDailyUniformDuty(t));
  for (let pass = 0; pass < 4; pass++) {
    let anyPassImproved = false;

    // 7A: Single-table 2-opt within strict dailyFlightLimits & dailyFlightHeavyLimits
    activeOpenTables.forEach((table) => {
      const elig = getEligibleForTable(table);
      const q = tableTargets[table.id] || {};
      const isTableHeavy = isHeavyDuty(table.id, table.title);

      for (let iter = 0; iter < 1500; iter++) {
        let improved = false;
        for (let d1 = 0; d1 < numDays; d1++) {
          for (let d2 = 0; d2 < numDays; d2++) {
            if (d1 === d2) continue;
            for (const f1 of elig) {
              if (table.data[f1][d1] < 1 || table.data[f1][d2] > 0) continue;
              for (const f2 of elig) {
                if (f1 === f2) continue;
                if (table.data[f2][d2] < 1 || table.data[f2][d1] > 0) continue;

                const target1 = q[f1] || 0;
                const target2 = q[f2] || 0;
                const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
                const maxF2 = Math.max(1, Math.ceil(target2 / numDays));
                if (table.data[f1][d2] + 1 > maxF1) continue;
                if (table.data[f2][d1] + 1 > maxF2) continue;
                if (dailyFlightLoad[f1][d2] + 1 > flightDailyLimits[f1].max) continue;
                if (dailyFlightLoad[f2][d1] + 1 > flightDailyLimits[f2].max) continue;
                if (dailyFlightLoad[f1][d1] - 1 < flightDailyLimits[f1].min) continue;
                if (dailyFlightLoad[f2][d2] - 1 < flightDailyLimits[f2].min) continue;
                if (isTableHeavy) {
                  if (dailyFlightHeavyLoad[f1][d2] + 1 > flightHeavyDailyLimits[f1].max) continue;
                  if (dailyFlightHeavyLoad[f2][d1] + 1 > flightHeavyDailyLimits[f2].max) continue;
                  if (dailyFlightHeavyLoad[f1][d1] - 1 < flightHeavyDailyLimits[f1].min) continue;
                  if (dailyFlightHeavyLoad[f2][d2] - 1 < flightHeavyDailyLimits[f2].min) continue;
                }

                const streakBefore =
                  evalFlightStreakCost(table.data[f1], target1) +
                  evalFlightStreakCost(table.data[f2], target2);
                const costBefore =
                  streakBefore +
                  evalFlightTimelineCost(table.data[f1], target1) +
                  evalFlightTimelineCost(table.data[f2], target2);

                table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                table.data[f2][d2] -= 1; table.data[f2][d1] += 1;

                const streakAfter =
                  evalFlightStreakCost(table.data[f1], target1) +
                  evalFlightStreakCost(table.data[f2], target2);
                const costAfter =
                  streakAfter +
                  evalFlightTimelineCost(table.data[f1], target1) +
                  evalFlightTimelineCost(table.data[f2], target2);

                if (streakAfter < streakBefore || (streakAfter === streakBefore && costAfter < costBefore)) {
                  dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
                  dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d1] += 1;
                  if (isTableHeavy) {
                    dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                    dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d1] += 1;
                  }
                  improved = true;
                  anyPassImproved = true;
                  break;
                } else {
                  table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                  table.data[f2][d2] += 1; table.data[f2][d1] -= 1;
                }
              }
              if (improved) break;
            }
            if (improved) break;
          }
          if (improved) break;
        }
        if (!improved) break;
      }
    });

    // 7B: Cross-table Compensating Paired Swaps:
    // Swap (f1, d1)<->(f2, d2) in table1 AND reverse-swap (f1, d2)<->(f2, d1) in table2
    // so total dailyFlightLoad stays 100% invariant on every day while total streakCost strictly decreases.
    for (let iter = 0; iter < 800; iter++) {
      let pairedImproved = false;

      for (const t1 of activeOpenTables) {
        const elig1 = getEligibleForTable(t1);
        const q1 = tableTargets[t1.id] || {};
        const t1Heavy = isHeavyDuty(t1.id, t1.title);

        // Only spend work on tables/flights that still have room for streak improvement
        const flightsWithPenalty = elig1.filter((fl) => evalFlightStreakCost(t1.data[fl], q1[fl] || 0) > 0);
        if (flightsWithPenalty.length === 0) continue;

        for (const f1 of flightsWithPenalty) {
          for (let d1 = 0; d1 < numDays; d1++) {
            if (t1.data[f1][d1] < 1) continue;
            for (let d2 = 0; d2 < numDays; d2++) {
              if (d1 === d2 || t1.data[f1][d2] > 0) continue;

              const target1 = q1[f1] || 0;
              const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
              if (t1.data[f1][d2] + 1 > maxF1) continue;

              for (const f2 of elig1) {
                if (f1 === f2) continue;
                if (t1.data[f2][d2] < 1 || t1.data[f2][d1] > 0) continue;

                const target2 = q1[f2] || 0;
                const maxF2 = Math.max(1, Math.ceil(target2 / numDays));
                if (t1.data[f2][d1] + 1 > maxF2) continue;

                const t1Delta = computeSwapStreakDelta(t1, f1, f2, d1, d2);
                if (t1Delta >= 0) continue;

                // Find a compensating table t2 where (f1, d2)<->(f2, d1) is valid and keeps heavy limits valid
                for (const t2 of activeOpenTables) {
                  if (t2.id === t1.id) continue;
                  const elig2 = getEligibleForTable(t2);
                  if (!elig2.includes(f1) || !elig2.includes(f2)) continue;
                  if (t2.data[f1][d2] < 1 || t2.data[f1][d1] > 0) continue;
                  if (t2.data[f2][d1] < 1 || t2.data[f2][d2] > 0) continue;

                  const q2 = tableTargets[t2.id] || {};
                  if (t2.data[f1][d1] + 1 > Math.max(1, Math.ceil((q2[f1] || 0) / numDays))) continue;
                  if (t2.data[f2][d2] + 1 > Math.max(1, Math.ceil((q2[f2] || 0) / numDays))) continue;

                  const t2Heavy = isHeavyDuty(t2.id, t2.title);
                  if (t1Heavy !== t2Heavy) {
                    const hDelta1 = t1Heavy ? 1 : -1;
                    if (dailyFlightHeavyLoad[f1][d2] + hDelta1 > flightHeavyDailyLimits[f1].max) continue;
                    if (dailyFlightHeavyLoad[f1][d2] + hDelta1 < flightHeavyDailyLimits[f1].min) continue;
                    if (dailyFlightHeavyLoad[f1][d1] - hDelta1 > flightHeavyDailyLimits[f1].max) continue;
                    if (dailyFlightHeavyLoad[f1][d1] - hDelta1 < flightHeavyDailyLimits[f1].min) continue;
                    if (dailyFlightHeavyLoad[f2][d1] + hDelta1 > flightHeavyDailyLimits[f2].max) continue;
                    if (dailyFlightHeavyLoad[f2][d1] + hDelta1 < flightHeavyDailyLimits[f2].min) continue;
                    if (dailyFlightHeavyLoad[f2][d2] - hDelta1 > flightHeavyDailyLimits[f2].max) continue;
                    if (dailyFlightHeavyLoad[f2][d2] - hDelta1 < flightHeavyDailyLimits[f2].min) continue;
                  }

                  const t2Delta = computeSwapStreakDelta(t2, f1, f2, d2, d1);
                  if (t1Delta + t2Delta < 0) {
                    // Apply compensating paired swap (total dailyFlightLoad unchanged!)
                    t1.data[f1][d1] -= 1; t1.data[f1][d2] += 1;
                    t1.data[f2][d2] -= 1; t1.data[f2][d1] += 1;
                    t2.data[f1][d2] -= 1; t2.data[f1][d1] += 1;
                    t2.data[f2][d1] -= 1; t2.data[f2][d2] += 1;

                    if (t1Heavy !== t2Heavy) {
                      const hDelta1 = t1Heavy ? 1 : -1;
                      dailyFlightHeavyLoad[f1][d1] -= hDelta1;
                      dailyFlightHeavyLoad[f1][d2] += hDelta1;
                      dailyFlightHeavyLoad[f2][d2] -= hDelta1;
                      dailyFlightHeavyLoad[f2][d1] += hDelta1;
                    }

                    pairedImproved = true;
                    anyPassImproved = true;
                    break;
                  }
                }
                if (pairedImproved) break;
              }
              if (pairedImproved) break;
            }
            if (pairedImproved) break;
          }
          if (pairedImproved) break;
        }
        if (pairedImproved) break;
      }

      if (!pairedImproved) break;
    }

    // 7C: Targeted 3-Flight Intra-Table Cycle (f1: d1->d2, f2: d2->d3, f3: d3->d1) for remaining streak violations
    for (const table of activeOpenTables) {
      const elig = getEligibleForTable(table);
      if (elig.length < 3) continue;
      const q = tableTargets[table.id] || {};
      const isTableHeavy = isHeavyDuty(table.id, table.title);

      for (let iter = 0; iter < 200; iter++) {
        const badFlights = elig.filter((fl) => evalFlightStreakCost(table.data[fl], q[fl] || 0) >= 40000);
        if (badFlights.length === 0) break;

        let cycleApplied = false;
        for (const f1 of badFlights) {
          const target1 = q[f1] || 0;
          const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
          for (let d1 = 0; d1 < numDays; d1++) {
            if (table.data[f1][d1] < 1) continue;
            // Focus on days adjacent to gaps or isolated slots or streak edges
            for (let d2 = 0; d2 < numDays; d2++) {
              if (d2 === d1 || table.data[f1][d2] > 0) continue;
              if (table.data[f1][d2] + 1 > maxF1) continue;
              if (dailyFlightLoad[f1][d2] + 1 > flightDailyLimits[f1].max) continue;
              if (dailyFlightLoad[f1][d1] - 1 < flightDailyLimits[f1].min) continue;
              if (isTableHeavy) {
                if (dailyFlightHeavyLoad[f1][d2] + 1 > flightHeavyDailyLimits[f1].max) continue;
                if (dailyFlightHeavyLoad[f1][d1] - 1 < flightHeavyDailyLimits[f1].min) continue;
              }

              for (const f2 of elig) {
                if (f2 === f1 || table.data[f2][d2] < 1) continue;
                if (dailyFlightLoad[f2][d2] - 1 < flightDailyLimits[f2].min) continue;
                if (isTableHeavy && dailyFlightHeavyLoad[f2][d2] - 1 < flightHeavyDailyLimits[f2].min) continue;
                const target2 = q[f2] || 0;
                const maxF2 = Math.max(1, Math.ceil(target2 / numDays));

                for (const f3 of elig) {
                  if (f3 === f1 || f3 === f2 || table.data[f3][d1] > 0) continue;
                  const target3 = q[f3] || 0;
                  const maxF3 = Math.max(1, Math.ceil(target3 / numDays));
                  if (table.data[f3][d1] + 1 > maxF3) continue;
                  if (dailyFlightLoad[f3][d1] + 1 > flightDailyLimits[f3].max) continue;
                  if (isTableHeavy && dailyFlightHeavyLoad[f3][d1] + 1 > flightHeavyDailyLimits[f3].max) continue;

                  for (let d3 = 0; d3 < numDays; d3++) {
                    if (d3 === d1 || d3 === d2) continue;
                    if (table.data[f2][d3] > 0 || table.data[f3][d3] < 1) continue;
                    if (table.data[f2][d3] + 1 > maxF2) continue;
                    if (dailyFlightLoad[f2][d3] + 1 > flightDailyLimits[f2].max) continue;
                    if (dailyFlightLoad[f3][d3] - 1 < flightDailyLimits[f3].min) continue;
                    if (isTableHeavy) {
                      if (dailyFlightHeavyLoad[f2][d3] + 1 > flightHeavyDailyLimits[f2].max) continue;
                      if (dailyFlightHeavyLoad[f3][d3] - 1 < flightHeavyDailyLimits[f3].min) continue;
                    }

                    const sBefore =
                      evalFlightStreakCost(table.data[f1], target1) +
                      evalFlightStreakCost(table.data[f2], target2) +
                      evalFlightStreakCost(table.data[f3], target3);

                    table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                    table.data[f2][d2] -= 1; table.data[f2][d3] += 1;
                    table.data[f3][d3] -= 1; table.data[f3][d1] += 1;

                    const sAfter =
                      evalFlightStreakCost(table.data[f1], target1) +
                      evalFlightStreakCost(table.data[f2], target2) +
                      evalFlightStreakCost(table.data[f3], target3);

                    if (sAfter + 10000 < sBefore) {
                      dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
                      dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d3] += 1;
                      dailyFlightLoad[f3][d3] -= 1; dailyFlightLoad[f3][d1] += 1;
                      if (isTableHeavy) {
                        dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                        dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d3] += 1;
                        dailyFlightHeavyLoad[f3][d3] -= 1; dailyFlightHeavyLoad[f3][d1] += 1;
                      }
                      cycleApplied = true;
                      anyPassImproved = true;
                      break;
                    } else {
                      table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                      table.data[f2][d2] += 1; table.data[f2][d3] -= 1;
                      table.data[f3][d3] += 1; table.data[f3][d1] -= 1;
                    }
                  }
                  if (cycleApplied) break;
                }
                if (cycleApplied) break;
              }
              if (cycleApplied) break;
            }
            if (cycleApplied) break;
          }
          if (cycleApplied) break;
        }
        if (!cycleApplied) break;
      }
    }

    // 7D & 7E: Transactional Slack Repair + Strict-Streak Rebalance (with separate total & heavy bound checks)
    const getBoundViolations = () => {
      let totalViol = 0;
      let heavyViol = 0;
      for (const fl of flights) {
        const lim = flightDailyLimits[fl];
        const hLim = flightHeavyDailyLimits[fl];
        for (let d = 0; d < numDays; d++) {
          const ld = dailyFlightLoad[fl][d];
          if (ld > lim.max) totalViol += ld - lim.max;
          if (ld < lim.min) totalViol += lim.min - ld;
          const hLd = dailyFlightHeavyLoad[fl][d];
          if (hLd > hLim.max) heavyViol += hLd - hLim.max;
          if (hLd < hLim.min) heavyViol += hLim.min - hLd;
        }
      }
      return { totalViol, heavyViol };
    };

    const rebalanceWithoutBreakingStreaks = (protectedTableId: string) => {
      for (let r = 0; r < 14; r++) {
        let changed = false;
        for (const fl of flights) {
          const lim = flightDailyLimits[fl];
          const hLim = flightHeavyDailyLimits[fl];
          for (let dBad = 0; dBad < numDays; dBad++) {
            const overTotal = dailyFlightLoad[fl][dBad] > lim.max;
            const underTotal = dailyFlightLoad[fl][dBad] < lim.min;
            const overHeavy = dailyFlightHeavyLoad[fl][dBad] > hLim.max;
            const underHeavy = dailyFlightHeavyLoad[fl][dBad] < hLim.min;
            if (!overTotal && !underTotal && !overHeavy && !underHeavy) continue;

            const needOut = overTotal || (!underTotal && overHeavy);
            let fixed = false;

            // Single-table rebalance swap keeping streakDelta <= 0
            for (const t2 of activeOpenTables) {
              if (t2.id === protectedTableId && r === 0) continue;
              const isT2Heavy = isHeavyDuty(t2.id, t2.title);
              if ((overHeavy || underHeavy) && !overTotal && !underTotal && !isT2Heavy) continue;
              const elig2 = getEligibleForTable(t2);
              if (!elig2.includes(fl)) continue;
              const q2 = tableTargets[t2.id] || {};
              const maxFl = Math.max(1, Math.ceil((q2[fl] || 0) / numDays));

              for (let dGood = 0; dGood < numDays; dGood++) {
                if (dGood === dBad) continue;
                const dOut = needOut ? dBad : dGood;
                const dIn = needOut ? dGood : dBad;
                if (t2.data[fl][dOut] < 1 || t2.data[fl][dIn] > 0) continue;
                if (t2.data[fl][dIn] + 1 > maxFl) continue;
                if (dailyFlightLoad[fl][dIn] + 1 > lim.max) continue;
                if (dailyFlightLoad[fl][dOut] - 1 < lim.min) continue;
                if (isT2Heavy) {
                  if (dailyFlightHeavyLoad[fl][dIn] + 1 > hLim.max) continue;
                  if (dailyFlightHeavyLoad[fl][dOut] - 1 < hLim.min) continue;
                }

                for (const fOther of elig2) {
                  if (fOther === fl) continue;
                  if (t2.data[fOther][dIn] < 1 || t2.data[fOther][dOut] > 0) continue;
                  const maxFO = Math.max(1, Math.ceil((q2[fOther] || 0) / numDays));
                  if (t2.data[fOther][dOut] + 1 > maxFO) continue;
                  const oLim = flightDailyLimits[fOther];
                  const oHLim = flightHeavyDailyLimits[fOther];
                  if (dailyFlightLoad[fOther][dOut] + 1 > oLim.max) continue;
                  if (dailyFlightLoad[fOther][dIn] - 1 < oLim.min) continue;
                  if (isT2Heavy) {
                    if (dailyFlightHeavyLoad[fOther][dOut] + 1 > oHLim.max) continue;
                    if (dailyFlightHeavyLoad[fOther][dIn] - 1 < oHLim.min) continue;
                  }

                  if (computeSwapStreakDelta(t2, fl, fOther, dOut, dIn) > 0) continue;

                  t2.data[fl][dOut] -= 1; t2.data[fl][dIn] += 1;
                  t2.data[fOther][dIn] -= 1; t2.data[fOther][dOut] += 1;
                  dailyFlightLoad[fl][dOut] -= 1; dailyFlightLoad[fl][dIn] += 1;
                  dailyFlightLoad[fOther][dIn] -= 1; dailyFlightLoad[fOther][dOut] += 1;
                  if (isT2Heavy) {
                    dailyFlightHeavyLoad[fl][dOut] -= 1; dailyFlightHeavyLoad[fl][dIn] += 1;
                    dailyFlightHeavyLoad[fOther][dIn] -= 1; dailyFlightHeavyLoad[fOther][dOut] += 1;
                  }
                  fixed = true;
                  changed = true;
                  break;
                }
                if (fixed) break;
              }
              if (fixed) break;
            }

            // If still overHeavy/underHeavy without changing dailyFlightLoad, try paired heavy + light swap
            if (!fixed && (overHeavy || underHeavy)) {
              const heavyNeedOut = overHeavy;
              for (const t2 of activeOpenTables) {
                if (t2.id === protectedTableId && r === 0) continue;
                if (!isHeavyDuty(t2.id, t2.title)) continue;
                const elig2 = getEligibleForTable(t2);
                if (!elig2.includes(fl)) continue;
                const q2 = tableTargets[t2.id] || {};
                const maxFl = Math.max(1, Math.ceil((q2[fl] || 0) / numDays));

                for (let dGood = 0; dGood < numDays; dGood++) {
                  if (dGood === dBad) continue;
                  const dOut = heavyNeedOut ? dBad : dGood;
                  const dIn = heavyNeedOut ? dGood : dBad;
                  if (t2.data[fl][dOut] < 1 || t2.data[fl][dIn] > 0) continue;
                  if (t2.data[fl][dIn] + 1 > maxFl) continue;
                  if (dailyFlightHeavyLoad[fl][dIn] + 1 > hLim.max) continue;
                  if (dailyFlightHeavyLoad[fl][dOut] - 1 < hLim.min) continue;

                  for (const fOther of elig2) {
                    if (fOther === fl) continue;
                    if (t2.data[fOther][dIn] < 1 || t2.data[fOther][dOut] > 0) continue;
                    const maxFO = Math.max(1, Math.ceil((q2[fOther] || 0) / numDays));
                    if (t2.data[fOther][dOut] + 1 > maxFO) continue;
                    const oHLim = flightHeavyDailyLimits[fOther];
                    if (dailyFlightHeavyLoad[fOther][dOut] + 1 > oHLim.max) continue;
                    if (dailyFlightHeavyLoad[fOther][dIn] - 1 < oHLim.min) continue;
                    if (computeSwapStreakDelta(t2, fl, fOther, dOut, dIn) > 0) continue;

                    for (const tL of activeOpenTables) {
                      if (isHeavyDuty(tL.id, tL.title)) continue;
                      const eligL = getEligibleForTable(tL);
                      if (!eligL.includes(fl) || !eligL.includes(fOther)) continue;
                      if (tL.data[fl][dIn] < 1 || tL.data[fl][dOut] > 0) continue;
                      if (tL.data[fOther][dOut] < 1 || tL.data[fOther][dIn] > 0) continue;
                      const qL = tableTargets[tL.id] || {};
                      if (tL.data[fl][dOut] + 1 > Math.max(1, Math.ceil((qL[fl] || 0) / numDays))) continue;
                      if (tL.data[fOther][dIn] + 1 > Math.max(1, Math.ceil((qL[fOther] || 0) / numDays))) continue;
                      if (computeSwapStreakDelta(tL, fl, fOther, dIn, dOut) > 0) continue;

                      t2.data[fl][dOut] -= 1; t2.data[fl][dIn] += 1;
                      t2.data[fOther][dIn] -= 1; t2.data[fOther][dOut] += 1;
                      tL.data[fl][dIn] -= 1; tL.data[fl][dOut] += 1;
                      tL.data[fOther][dOut] -= 1; tL.data[fOther][dIn] += 1;
                      dailyFlightHeavyLoad[fl][dOut] -= 1; dailyFlightHeavyLoad[fl][dIn] += 1;
                      dailyFlightHeavyLoad[fOther][dIn] -= 1; dailyFlightHeavyLoad[fOther][dOut] += 1;
                      fixed = true;
                      changed = true;
                      break;
                    }
                    if (fixed) break;
                  }
                  if (fixed) break;
                }
                if (fixed) break;
              }
            }
          }
        }
        if (!changed) break;
      }
    };

    const snapshotState = () => {
      const snapTables = activeOpenTables.map((tb) => {
        const copy: Record<string, number[]> = {};
        flights.forEach((fl) => { copy[fl] = [...tb.data[fl]]; });
        return copy;
      });
      const snapLoad: Record<string, number[]> = {};
      const snapHeavy: Record<string, number[]> = {};
      flights.forEach((fl) => {
        snapLoad[fl] = [...dailyFlightLoad[fl]];
        snapHeavy[fl] = [...dailyFlightHeavyLoad[fl]];
      });
      return { snapTables, snapLoad, snapHeavy };
    };

    const restoreState = (snap: ReturnType<typeof snapshotState>) => {
      activeOpenTables.forEach((tb, idx) => {
        flights.forEach((fl) => { tb.data[fl] = snap.snapTables[idx][fl]; });
      });
      flights.forEach((fl) => {
        dailyFlightLoad[fl] = snap.snapLoad[fl];
        dailyFlightHeavyLoad[fl] = snap.snapHeavy[fl];
      });
    };

    // 7D: Transactional 2-flight swap + streak-safe rebalance
    for (let iter = 0; iter < 150; iter++) {
      let txImproved = false;
      const baseViol = getBoundViolations();

      for (const t1 of activeOpenTables) {
        const elig1 = getEligibleForTable(t1);
        const q1 = tableTargets[t1.id] || {};
        const t1Heavy = isHeavyDuty(t1.id, t1.title);
        const badFlights = elig1.filter((fl) => evalFlightStreakCost(t1.data[fl], q1[fl] || 0) >= 40000);
        if (badFlights.length === 0) continue;

        for (const f1 of badFlights) {
          const target1 = q1[f1] || 0;
          const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
          for (let d1 = 0; d1 < numDays; d1++) {
            if (t1.data[f1][d1] < 1) continue;
            for (let d2 = 0; d2 < numDays; d2++) {
              if (d1 === d2 || t1.data[f1][d2] > 0) continue;
              if (t1.data[f1][d2] + 1 > maxF1) continue;

              for (const f2 of elig1) {
                if (f1 === f2) continue;
                if (t1.data[f2][d2] < 1 || t1.data[f2][d1] > 0) continue;
                const target2 = q1[f2] || 0;
                const maxF2 = Math.max(1, Math.ceil(target2 / numDays));
                if (t1.data[f2][d1] + 1 > maxF2) continue;

                const delta = computeSwapStreakDelta(t1, f1, f2, d1, d2);
                if (delta > -40000) continue;

                const snap = snapshotState();
                t1.data[f1][d1] -= 1; t1.data[f1][d2] += 1;
                t1.data[f2][d2] -= 1; t1.data[f2][d1] += 1;
                dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
                dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d1] += 1;
                if (t1Heavy) {
                  dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                  dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d1] += 1;
                }

                rebalanceWithoutBreakingStreaks(t1.id);

                const afterViol = getBoundViolations();
                if (afterViol.totalViol <= baseViol.totalViol && afterViol.heavyViol <= baseViol.heavyViol) {
                  txImproved = true;
                  anyPassImproved = true;
                  break;
                } else {
                  restoreState(snap);
                }
              }
              if (txImproved) break;
            }
            if (txImproved) break;
          }
          if (txImproved) break;
        }
        if (txImproved) break;
      }

      if (!txImproved) break;
    }

    // 7E: Transactional 3-Flight Intra-Table Cycle + Streak-Safe Rebalance
    for (let iter = 0; iter < 25; iter++) {
      let txCycleImproved = false;
      const baseViol = getBoundViolations();

      for (const table of activeOpenTables) {
        const elig = getEligibleForTable(table);
        if (elig.length < 3) continue;
        const q = tableTargets[table.id] || {};
        const isTableHeavy = isHeavyDuty(table.id, table.title);
        const badFlights = elig.filter((fl) => evalFlightStreakCost(table.data[fl], q[fl] || 0) >= 40000);
        if (badFlights.length === 0) continue;

        let eRebalanceTries = 0;
        for (const f1 of badFlights) {
          const target1 = q[f1] || 0;
          const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
          for (let d1 = 0; d1 < numDays; d1++) {
            if (table.data[f1][d1] < 1) continue;
            const prevOn1 = d1 > 0 && table.data[f1][d1 - 1] > 0;
            const nextOn1 = d1 + 1 < numDays && table.data[f1][d1 + 1] > 0;
            if (prevOn1 && nextOn1) continue;
            for (let d2 = 0; d2 < numDays; d2++) {
              if (d2 === d1 || table.data[f1][d2] > 0) continue;
              if (table.data[f1][d2] + 1 > maxF1) continue;
              const adj2 = (d2 > 0 && table.data[f1][d2 - 1] > 0) || (d2 + 1 < numDays && table.data[f1][d2 + 1] > 0);
              if (mode === 'PACKAGE' && !adj2) continue;

              for (const f2 of elig) {
                if (f2 === f1 || table.data[f2][d2] < 1) continue;
                const target2 = q[f2] || 0;
                const maxF2 = Math.max(1, Math.ceil(target2 / numDays));

                for (const f3 of elig) {
                  if (f3 === f1 || f3 === f2 || table.data[f3][d1] > 0) continue;
                  const target3 = q[f3] || 0;
                  const maxF3 = Math.max(1, Math.ceil(target3 / numDays));
                  if (table.data[f3][d1] + 1 > maxF3) continue;

                  for (let d3 = 0; d3 < numDays; d3++) {
                    if (d3 === d1 || d3 === d2) continue;
                    if (table.data[f2][d3] > 0 || table.data[f3][d3] < 1) continue;
                    if (table.data[f2][d3] + 1 > maxF2) continue;

                    const sBefore =
                      evalFlightStreakCost(table.data[f1], target1) +
                      evalFlightStreakCost(table.data[f2], target2) +
                      evalFlightStreakCost(table.data[f3], target3);

                    table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                    table.data[f2][d2] -= 1; table.data[f2][d3] += 1;
                    table.data[f3][d3] -= 1; table.data[f3][d1] += 1;

                    const sAfter =
                      evalFlightStreakCost(table.data[f1], target1) +
                      evalFlightStreakCost(table.data[f2], target2) +
                      evalFlightStreakCost(table.data[f3], target3);

                    if (sAfter + 40000 <= sBefore && eRebalanceTries < 40) {
                      eRebalanceTries++;
                      table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                      table.data[f2][d2] += 1; table.data[f2][d3] -= 1;
                      table.data[f3][d3] += 1; table.data[f3][d1] -= 1;

                      const snap = snapshotState();
                      table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                      table.data[f2][d2] -= 1; table.data[f2][d3] += 1;
                      table.data[f3][d3] -= 1; table.data[f3][d1] += 1;
                      dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
                      dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d3] += 1;
                      dailyFlightLoad[f3][d3] -= 1; dailyFlightLoad[f3][d1] += 1;
                      if (isTableHeavy) {
                        dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                        dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d3] += 1;
                        dailyFlightHeavyLoad[f3][d3] -= 1; dailyFlightHeavyLoad[f3][d1] += 1;
                      }

                      rebalanceWithoutBreakingStreaks(table.id);

                      const afterViol = getBoundViolations();
                      if (afterViol.totalViol <= baseViol.totalViol && afterViol.heavyViol <= baseViol.heavyViol) {
                        txCycleImproved = true;
                        anyPassImproved = true;
                        break;
                      } else {
                        restoreState(snap);
                      }
                    } else {
                      table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                      table.data[f2][d2] += 1; table.data[f2][d3] -= 1;
                      table.data[f3][d3] += 1; table.data[f3][d1] -= 1;
                    }
                  }
                  if (txCycleImproved) break;
                }
                if (txCycleImproved) break;
              }
              if (txCycleImproved) break;
            }
            if (txCycleImproved) break;
          }
          if (txCycleImproved) break;
        }
        if (txCycleImproved) break;
      }

      if (!txCycleImproved) break;
    }

    // 7F: Transactional 2-Day Block Swap (PACKAGE) + Depth-2 Double-Swap Chain
    if (mode === 'PACKAGE') {
      for (let iter = 0; iter < 60; iter++) {
        let blockSwapped = false;
        const baseViol = getBoundViolations();

        for (const table of activeOpenTables) {
          const elig = getEligibleForTable(table);
          const q = tableTargets[table.id] || {};
          const isTableHeavy = isHeavyDuty(table.id, table.title);
          const badFlights = elig.filter((fl) => evalFlightStreakCost(table.data[fl], q[fl] || 0) >= 40000);
          if (badFlights.length === 0) continue;

          for (const f1 of badFlights) {
            const target1 = q[f1] || 0;
            const maxF1 = Math.max(1, Math.ceil(target1 / numDays));
            for (let dA = 0; dA + 1 < numDays; dA++) {
              if (table.data[f1][dA] < 1 || table.data[f1][dA + 1] < 1) continue;
              for (let dB = 0; dB + 1 < numDays; dB++) {
                if (Math.abs(dA - dB) <= 1) continue;
                if (table.data[f1][dB] > 0 || table.data[f1][dB + 1] > 0) continue;
                if (table.data[f1][dB] + 1 > maxF1 || table.data[f1][dB + 1] + 1 > maxF1) continue;

                for (const f2 of elig) {
                  if (f2 === f1) continue;
                  if (table.data[f2][dB] < 1 || table.data[f2][dB + 1] < 1) continue;
                  if (table.data[f2][dA] > 0 || table.data[f2][dA + 1] > 0) continue;
                  const target2 = q[f2] || 0;
                  const maxF2 = Math.max(1, Math.ceil(target2 / numDays));
                  if (table.data[f2][dA] + 1 > maxF2 || table.data[f2][dA + 1] + 1 > maxF2) continue;

                  const sBefore =
                    evalFlightStreakCost(table.data[f1], target1) +
                    evalFlightStreakCost(table.data[f2], target2);

                  table.data[f1][dA] -= 1; table.data[f1][dA + 1] -= 1;
                  table.data[f1][dB] += 1; table.data[f1][dB + 1] += 1;
                  table.data[f2][dB] -= 1; table.data[f2][dB + 1] -= 1;
                  table.data[f2][dA] += 1; table.data[f2][dA + 1] += 1;

                  const sAfter =
                    evalFlightStreakCost(table.data[f1], target1) +
                    evalFlightStreakCost(table.data[f2], target2);

                  table.data[f1][dA] += 1; table.data[f1][dA + 1] += 1;
                  table.data[f1][dB] -= 1; table.data[f1][dB + 1] -= 1;
                  table.data[f2][dB] += 1; table.data[f2][dB + 1] += 1;
                  table.data[f2][dA] -= 1; table.data[f2][dA + 1] -= 1;

                  if (sAfter + 40000 <= sBefore) {
                    const snap = snapshotState();
                    table.data[f1][dA] -= 1; table.data[f1][dA + 1] -= 1;
                    table.data[f1][dB] += 1; table.data[f1][dB + 1] += 1;
                    table.data[f2][dB] -= 1; table.data[f2][dB + 1] -= 1;
                    table.data[f2][dA] += 1; table.data[f2][dA + 1] += 1;
                    dailyFlightLoad[f1][dA] -= 1; dailyFlightLoad[f1][dA + 1] -= 1;
                    dailyFlightLoad[f1][dB] += 1; dailyFlightLoad[f1][dB + 1] += 1;
                    dailyFlightLoad[f2][dB] -= 1; dailyFlightLoad[f2][dB + 1] -= 1;
                    dailyFlightLoad[f2][dA] += 1; dailyFlightLoad[f2][dA + 1] += 1;
                    if (isTableHeavy) {
                      dailyFlightHeavyLoad[f1][dA] -= 1; dailyFlightHeavyLoad[f1][dA + 1] -= 1;
                      dailyFlightHeavyLoad[f1][dB] += 1; dailyFlightHeavyLoad[f1][dB + 1] += 1;
                      dailyFlightHeavyLoad[f2][dB] -= 1; dailyFlightHeavyLoad[f2][dB + 1] -= 1;
                      dailyFlightHeavyLoad[f2][dA] += 1; dailyFlightHeavyLoad[f2][dA + 1] += 1;
                    }

                    rebalanceWithoutBreakingStreaks(table.id);

                    const afterViol = getBoundViolations();
                    if (afterViol.totalViol <= baseViol.totalViol && afterViol.heavyViol <= baseViol.heavyViol) {
                      blockSwapped = true;
                      anyPassImproved = true;
                      break;
                    } else {
                      restoreState(snap);
                    }
                  }
                }
                if (blockSwapped) break;
              }
              if (blockSwapped) break;
            }
            if (blockSwapped) break;
          }
          if (blockSwapped) break;
        }
        if (!blockSwapped) break;
      }
    }

    // 7F-2: Transactional Depth-2 Swap Chain (allows Swap1 to break f2 temporarily so Swap2 heals f2)
    for (let iter = 0; iter < 15; iter++) {
      let chainImproved = false;
      const baseViol = getBoundViolations();

      for (const table of activeOpenTables) {
        const elig = getEligibleForTable(table);
        if (elig.length < 2) continue;
        const q = tableTargets[table.id] || {};
        const isTableHeavy = isHeavyDuty(table.id, table.title);
        const badFlights = elig.filter((fl) => evalFlightStreakCost(table.data[fl], q[fl] || 0) >= 40000);
        if (badFlights.length === 0) continue;

        let rebalanceTries = 0;
        const origTotal = elig.reduce((sum, fl) => sum + evalFlightStreakCost(table.data[fl], q[fl] || 0), 0);

        for (const f1 of badFlights) {
          const t1 = q[f1] || 0;
          const maxF1 = Math.max(1, Math.ceil(t1 / numDays));
          const d1Cands: number[] = [];
          for (let d = 0; d < numDays; d++) {
            if (table.data[f1][d] >= 1) {
              const prevOn = d > 0 && table.data[f1][d - 1] > 0;
              const nextOn = d + 1 < numDays && table.data[f1][d + 1] > 0;
              if (!prevOn || !nextOn) d1Cands.push(d);
            }
          }
          const d2Cands: number[] = [];
          for (let d = 0; d < numDays; d++) {
            if (table.data[f1][d] === 0 && 1 <= maxF1) {
              const adj = (d > 0 && table.data[f1][d - 1] > 0) || (d + 1 < numDays && table.data[f1][d + 1] > 0);
              if (mode === 'PACKAGE' ? adj : !adj) d2Cands.push(d);
            }
          }

          for (const d1 of d1Cands) {
            for (const d2 of d2Cands) {
              if (d1 === d2) continue;
              for (const f2 of elig) {
                if (f2 === f1 || table.data[f2][d2] < 1 || table.data[f2][d1] > 0) continue;
                const t2 = q[f2] || 0;
                const maxF2 = Math.max(1, Math.ceil(t2 / numDays));
                if (table.data[f2][d1] + 1 > maxF2) continue;

                const s1Before = evalFlightStreakCost(table.data[f1], t1);
                table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                table.data[f2][d2] -= 1; table.data[f2][d1] += 1;
                const s1After = evalFlightStreakCost(table.data[f1], t1);

                if (s1After < s1Before) {
                  let foundSecond = false;
                  const f2CostAfterSwap1 = evalFlightStreakCost(table.data[f2], t2);
                  if (f2CostAfterSwap1 >= 40000) {
                    const dACands: number[] = [];
                    for (let d = 0; d < numDays; d++) {
                      if (table.data[f2][d] >= 1) {
                        const p = d > 0 && table.data[f2][d - 1] > 0;
                        const n = d + 1 < numDays && table.data[f2][d + 1] > 0;
                        if (!p || !n) dACands.push(d);
                      }
                    }
                    const dBCands: number[] = [];
                    for (let d = 0; d < numDays; d++) {
                      if (table.data[f2][d] === 0 && 1 <= maxF2) {
                        const adj = (d > 0 && table.data[f2][d - 1] > 0) || (d + 1 < numDays && table.data[f2][d + 1] > 0);
                        if (mode === 'PACKAGE' ? adj : !adj) dBCands.push(d);
                      }
                    }

                    for (const dA of dACands) {
                      for (const dB of dBCands) {
                        if (dA === dB) continue;
                        for (const f3 of elig) {
                          if (f3 === f2 || table.data[f3][dB] < 1 || table.data[f3][dA] > 0) continue;
                          const t3 = q[f3] || 0;
                          if (table.data[f3][dA] + 1 > Math.max(1, Math.ceil(t3 / numDays))) continue;

                          table.data[f2][dA] -= 1; table.data[f2][dB] += 1;
                          table.data[f3][dB] -= 1; table.data[f3][dA] += 1;

                          const newTotal = elig.reduce((sum, fl) => sum + evalFlightStreakCost(table.data[fl], q[fl] || 0), 0);

                          if (newTotal + 40000 <= origTotal && rebalanceTries < 25) {
                            rebalanceTries++;
                            table.data[f2][dA] += 1; table.data[f2][dB] -= 1;
                            table.data[f3][dB] += 1; table.data[f3][dA] -= 1;
                            table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                            table.data[f2][d2] += 1; table.data[f2][d1] -= 1;

                            const snap = snapshotState();
                            table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                            table.data[f2][d2] -= 1; table.data[f2][d1] += 1;
                            table.data[f2][dA] -= 1; table.data[f2][dB] += 1;
                            table.data[f3][dB] -= 1; table.data[f3][dA] += 1;

                            dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
                            dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d1] += 1;
                            dailyFlightLoad[f2][dA] -= 1; dailyFlightLoad[f2][dB] += 1;
                            dailyFlightLoad[f3][dB] -= 1; dailyFlightLoad[f3][dA] += 1;
                            if (isTableHeavy) {
                              dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                              dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d1] += 1;
                              dailyFlightHeavyLoad[f2][dA] -= 1; dailyFlightHeavyLoad[f2][dB] += 1;
                              dailyFlightHeavyLoad[f3][dB] -= 1; dailyFlightHeavyLoad[f3][dA] += 1;
                            }

                            rebalanceWithoutBreakingStreaks(table.id);

                            const afterViol = getBoundViolations();
                            if (afterViol.totalViol <= baseViol.totalViol && afterViol.heavyViol <= baseViol.heavyViol) {
                              chainImproved = true;
                              anyPassImproved = true;
                              foundSecond = true;
                              break;
                            } else {
                              restoreState(snap);
                              table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
                              table.data[f2][d2] -= 1; table.data[f2][d1] += 1;
                            }
                          } else {
                            table.data[f2][dA] += 1; table.data[f2][dB] -= 1;
                            table.data[f3][dB] += 1; table.data[f3][dA] -= 1;
                          }
                        }
                        if (foundSecond) break;
                      }
                      if (foundSecond) break;
                    }
                  }
                }

                if (chainImproved) break;
                // Rollback Swap1 if Swap2 didn't commit
                table.data[f1][d1] += 1; table.data[f1][d2] -= 1;
                table.data[f2][d2] += 1; table.data[f2][d1] -= 1;
              }
              if (chainImproved) break;
            }
            if (chainImproved) break;
          }
          if (chainImproved) break;
        }
        if (chainImproved) break;
      }

      if (!chainImproved) break;
    }

    if (!anyPassImproved) break;
  }

  // Map virtual indices back onto 31-day matrix data (preserving days outside active week in Weekly mode)
  if (isWeekly) {
    return newMatrix.map((workTable, idx) => {
      const orig = matrix[idx];
      const finalData: Record<string, number[]> = {
        Mechanics: [...(orig.data?.Mechanics || new Array(31).fill(0))],
        Avionics: [...(orig.data?.Avionics || new Array(31).fill(0))],
        GCS: [...(orig.data?.GCS || new Array(31).fill(0))],
        Admin: [...(orig.data?.Admin || new Array(31).fill(0))],
      };
      flights.forEach((fl) => {
        const merged = [...(orig.data?.[fl] || new Array(31).fill(0))];
        while (merged.length < 31) merged.push(0);
        for (let v = 0; v < numDays; v++) {
          const targetDayIdx = activeDayIndices[v];
          if (targetDayIdx >= 0 && targetDayIdx < 31) {
            merged[targetDayIdx] = workTable.data[fl]?.[v] ?? 0;
          }
        }
        finalData[fl] = merged;
      });
      return {
        ...orig,
        data: finalData as DutyRatioTable['data'],
      };
    });
  }

  // Monthly mode: return full 31-day allocated matrix
  return newMatrix.map((workTable) => ({
    ...workTable,
    data: workTable.data as DutyRatioTable['data'],
  }));
}

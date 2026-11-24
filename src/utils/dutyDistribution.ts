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

    if (numDays === 31) {
      if (target <= 15) {
        maxOnStreak = 1;
      } else if (target <= 20) {
        maxOnStreak = 2;
      } else if (target <= 23) {
        maxOnStreak = 3;
      } else if (target <= 25) {
        maxOnStreak = 4;
      } else {
        maxOnStreak = Math.ceil(target / (gaps + 1));
      }
    } else {
      if (target <= Math.ceil(numDays / 2)) {
        maxOnStreak = 1;
      } else {
        maxOnStreak = Math.ceil(target / (gaps + 1));
      }
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

  function evalFlightStreakCost(arr: number[], target: number): number {
    if (target <= 0 || target >= numDays) return 0;
    let cost = 0;
    let curOn = 0;
    let curOff = 0;

    if (mode === 'PACKAGE') {
      for (let d = 0; d < numDays; d++) {
        if (arr[d] > 0) {
          curOn++;
          curOff = 0;
        } else {
          if (curOn > 0) {
            if (target >= 2 && curOn === 1) {
              cost += 2500;
            } else if (curOn > 3) {
              cost += Math.pow(curOn - 3, 2) * 6000;
            }
            curOn = 0;
          }
          curOff++;
        }
      }
      if (curOn > 0) {
        if (target >= 2 && curOn === 1) {
          cost += 2500;
        } else if (curOn > 3) {
          cost += Math.pow(curOn - 3, 2) * 6000;
        }
      }
      return cost;
    }

    // SINGLE MODE:
    const { maxOnStreak, maxOffStreak, gaps } = getDutyLimits(target);
    const moderateCutoff = Math.floor((16 * numDays) / 31);
    const streak3Cutoff = Math.floor((20 * numDays) / 31);
    const streak4Cutoff = Math.floor((24 * numDays) / 31);

    for (let d = 0; d < numDays; d++) {
      if (arr[d] > 0) {
        curOn++;
        if (curOff > 0) {
          if (curOff > maxOffStreak) {
            cost += Math.pow(curOff - maxOffStreak, 2) * 500;
          }
          curOff = 0;
        }
        if (curOn === 2) {
          cost += target <= moderateCutoff ? 5000 : 300;
        } else if (curOn === 3) {
          cost += target <= streak3Cutoff ? 50000 : 4000;
        } else if (curOn === 4) {
          cost += target <= streak4Cutoff ? 250000 : 12000;
        } else if (curOn > 4) {
          if (target <= streak4Cutoff) {
            cost += 500000 * Math.pow(curOn - 4, 2);
          } else if (curOn > maxOnStreak) {
            cost += 250000 * Math.pow(curOn - maxOnStreak, 2);
          }
        }
      } else {
        curOff++;
        if (curOn > 0) {
          curOn = 0;
        }
      }
    }

    if (curOff > maxOffStreak) cost += Math.pow(curOff - maxOffStreak, 2) * 500;
    if (gaps <= Math.round((5 * numDays) / 31) && curOff > 1) cost += 2000 * Math.pow(curOff - 1, 2);

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
    const pacingTargetCutoff = Math.floor((22 * numDays) / 31);
    const offDaysPaceCutoff = Math.max(1, Math.round((6 * numDays) / 31));

    // Day by day allocation
    for (let d = 0; d < numDays; d++) {
      const needed = reqSlots[d];
      if (needed <= 0) continue;

      let remainingToAssign = needed;
      while (remainingToAssign > 0) {
        const currentRemWeights = elig.map((fl) => {
          const target = q[fl] || 0;
          const assigned = table.data[fl].reduce((a, b) => a + b, 0);
          return Math.max(0, target - assigned);
        });
        const dynamicTotalRem = currentRemWeights.reduce((s, r) => s + r, 0);

        const available = elig.map((fl) => {
          const target = q[fl] || 0;
          const assigned = table.data[fl].reduce((a, b) => a + b, 0);
          const rem = Math.max(0, target - assigned);
          const st = getStrength(fl, isSecurity);
          const daysLeft = numDays - d;
          let onStreak = 0;
          for (let prev = d - 1; prev >= 0 && table.data[fl][prev] > 0; prev--) onStreak++;
          let offStreak = 0;
          for (let prev = d - 1; prev >= 0 && table.data[fl][prev] === 0; prev--) offStreak++;
          const { maxOnStreak, maxOffStreak } = getDutyLimits(target);
          const maxAllowedToday = Math.max(1, Math.ceil(target / numDays));
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
            load: dailyFlightLoad[fl][d],
          };
        }).filter((x) => {
          if (x.today >= x.maxAllowedToday) return false;
          const xLim = flightDailyLimits[x.fl];
          if (x.load >= xLim.max) {
            const hasOtherWithCap = elig.some((fOther) => {
              if (fOther === x.fl) return false;
              const remO = Math.max(0, (q[fOther] || 0) - table.data[fOther].reduce((a, b) => a + b, 0));
              const loadO = dailyFlightLoad[fOther][d];
              const maxTO = Math.max(1, Math.ceil((q[fOther] || 0) / numDays));
              return remO > 0 && loadO < flightDailyLimits[fOther].max && table.data[fOther][d] < maxTO;
            });
            if (hasOtherWithCap) return false;
          }
          if (mode === 'SINGLE' && x.onStreak >= x.maxOnStreak && x.rem < x.daysLeft && dynamicTotalRem > x.rem) return false;
          return dynamicTotalRem === 0 ? true : x.rem > 0;
        });

        if (available.length === 0) {
          const anyElig = [...elig].sort((f1, f2) => {
            const rem1 = Math.max(0, (q[f1] || 0) - table.data[f1].reduce((a, b) => a + b, 0));
            const rem2 = Math.max(0, (q[f2] || 0) - table.data[f2].reduce((a, b) => a + b, 0));
            if ((rem1 > 0) !== (rem2 > 0)) return rem1 > 0 ? -1 : 1;
            if (rem1 !== rem2) return rem2 - rem1;

            const max1 = Math.max(1, Math.ceil((q[f1] || 0) / numDays));
            const max2 = Math.max(1, Math.ceil((q[f2] || 0) / numDays));
            const full1 = table.data[f1][d] >= max1 ? 1 : 0;
            const full2 = table.data[f2][d] >= max2 ? 1 : 0;
            if (full1 !== full2) return full1 - full2;

            const lim1 = flightDailyLimits[f1];
            const lim2 = flightDailyLimits[f2];
            const under1 = dailyFlightLoad[f1][d] < lim1.base ? 1 : 0;
            const under2 = dailyFlightLoad[f2][d] < lim2.base ? 1 : 0;
            if (under1 !== under2) return under2 - under1;

            const overMax1 = dailyFlightLoad[f1][d] >= lim1.max ? 1 : 0;
            const overMax2 = dailyFlightLoad[f2][d] >= lim2.max ? 1 : 0;
            if (overMax1 !== overMax2) return overMax1 - overMax2;

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

        available.sort((a, b) => {
          const aMust = a.rem >= a.daysLeft ? 1 : 0;
          const bMust = b.rem >= b.daysLeft ? 1 : 0;
          if (aMust !== bMust) return bMust - aMust;

          if (a.today !== b.today) return a.today - b.today;

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
            const aIdealToday = ((d + 1) * a.target) / numDays;
            const bIdealToday = ((d + 1) * b.target) / numDays;
            const aPacedOut = a.target <= pacingTargetCutoff && a.assigned >= Math.round(aIdealToday) && a.rem < a.daysLeft;
            const bPacedOut = b.target <= pacingTargetCutoff && b.assigned >= Math.round(bIdealToday) && b.rem < b.daysLeft;
            if (aPacedOut !== bPacedOut) {
              return aPacedOut ? 1 : -1;
            }

            const aRest = a.onStreak === 0 ? 1 : 0;
            const bRest = b.onStreak === 0 ? 1 : 0;
            if (a.target <= pacingTargetCutoff || b.target <= pacingTargetCutoff) {
              if (aRest !== bRest) return bRest - aRest;
            }

            if (a.onStreak !== b.onStreak) {
              if (a.target <= pacingTargetCutoff && a.onStreak >= 2) return 1;
              if (b.target <= pacingTargetCutoff && b.onStreak >= 2) return -1;
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

          if (mode === 'PACKAGE') {
            const aIs1 = a.onStreak === 1 && a.rem > 0 ? 1 : 0;
            const bIs1 = b.onStreak === 1 && b.rem > 0 ? 1 : 0;
            if (aIs1 !== bIs1) return bIs1 - aIs1;

            const aIs2 = a.onStreak === 2 && a.rem > 0 ? 1 : 0;
            const bIs2 = b.onStreak === 2 && b.rem > 0 ? 1 : 0;
            if (aIs2 !== bIs2) return bIs2 - aIs2;

            const aExceed3 = a.onStreak >= 3 ? 1 : 0;
            const bExceed3 = b.onStreak >= 3 ? 1 : 0;
            if (aExceed3 !== bExceed3) return aExceed3 - bExceed3;
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

    // Step 4: Intra-table 2-opt Swap Optimizer with Gap and Anti-Streak Penalties
    for (let iter = 0; iter < 3000; iter++) {
      let improved = false;

      for (let d1 = 0; d1 < numDays; d1++) {
        for (let d2 = 0; d2 < numDays; d2++) {
          if (d1 === d2) continue;
          if (reqSlots[d1] !== reqSlots[d2]) continue;

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
              if (isHeavyDuty(table.id, table.title)) {
                if (dailyFlightHeavyLoad[f1][d2] + 1 > flightHeavyDailyLimits[f1].max) continue;
                if (dailyFlightHeavyLoad[f2][d1] + 1 > flightHeavyDailyLimits[f2].max) continue;
              }

              const isTableHeavy = isHeavyDuty(table.id, table.title);

              const heavyCostBefore = isTableHeavy
                ? evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d1], flightHeavyDailyLimits[f1]) +
                  evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d2], flightHeavyDailyLimits[f1]) +
                  evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d1], flightHeavyDailyLimits[f2]) +
                  evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d2], flightHeavyDailyLimits[f2])
                : 0;

              const costBefore =
                evalFlightStreakCost(table.data[f1], target1) +
                evalFlightStreakCost(table.data[f2], target2) +
                evalFlightTimelineCost(table.data[f1], target1) +
                evalFlightTimelineCost(table.data[f2], target2) +
                evalFlightDailyLoadDispersionCost(f1) +
                evalFlightDailyLoadDispersionCost(f2) +
                heavyCostBefore;

              table.data[f1][d1] -= 1; table.data[f1][d2] += 1;
              table.data[f2][d2] -= 1; table.data[f2][d1] += 1;
              dailyFlightLoad[f1][d1] -= 1; dailyFlightLoad[f1][d2] += 1;
              dailyFlightLoad[f2][d2] -= 1; dailyFlightLoad[f2][d1] += 1;
              if (isTableHeavy) {
                dailyFlightHeavyLoad[f1][d1] -= 1; dailyFlightHeavyLoad[f1][d2] += 1;
                dailyFlightHeavyLoad[f2][d2] -= 1; dailyFlightHeavyLoad[f2][d1] += 1;
              }

              const heavyCostAfter = isTableHeavy
                ? evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d1], flightHeavyDailyLimits[f1]) +
                  evalHeavyDutyCost(dailyFlightHeavyLoad[f1][d2], flightHeavyDailyLimits[f1]) +
                  evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d1], flightHeavyDailyLimits[f2]) +
                  evalHeavyDutyCost(dailyFlightHeavyLoad[f2][d2], flightHeavyDailyLimits[f2])
                : 0;

              const costAfter =
                evalFlightStreakCost(table.data[f1], target1) +
                evalFlightStreakCost(table.data[f2], target2) +
                evalFlightTimelineCost(table.data[f1], target1) +
                evalFlightTimelineCost(table.data[f2], target2) +
                evalFlightDailyLoadDispersionCost(f1) +
                evalFlightDailyLoadDispersionCost(f2) +
                heavyCostAfter;

              if (costAfter < costBefore) {
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
  });

  // Step 5: Global Multi-Table Daily Load Equalizer (Strict (B, B+1) Enforcement)
  for (let round = 0; round < 25; round++) {
    let globalChange = false;

    for (const fl of flights) {
      const limits = flightDailyLimits[fl];

      // PART A: Eliminate any OVERLOADED days (load > limits.max)
      for (let dHigh = 0; dHigh < numDays; dHigh++) {
        if (dailyFlightLoad[fl][dHigh] <= limits.max) continue;

        for (let dLow = 0; dLow < numDays; dLow++) {
          if (dLow === dHigh) continue;
          if (dailyFlightLoad[fl][dLow] >= limits.max) continue;

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
              if (dailyFlightLoad[f2][dHigh] + 1 > f2Limits.max) continue;
              if (dailyFlightLoad[f2][dLow] - 1 < f2Limits.min) continue;
              if (dailyFlightLoad[fl][dLow] + 1 > limits.max) continue;

              t.data[fl][dHigh] -= 1;
              t.data[fl][dLow] += 1;
              t.data[f2][dLow] -= 1;
              t.data[f2][dHigh] += 1;

              dailyFlightLoad[fl][dHigh] -= 1;
              dailyFlightLoad[fl][dLow] += 1;
              dailyFlightLoad[f2][dLow] -= 1;
              dailyFlightLoad[f2][dHigh] += 1;

              if (isTHeavy) {
                dailyFlightHeavyLoad[fl][dHigh] -= 1;
                dailyFlightHeavyLoad[fl][dLow] += 1;
                dailyFlightHeavyLoad[f2][dLow] -= 1;
                dailyFlightHeavyLoad[f2][dHigh] += 1;
              }

              swapped = true;
              globalChange = true;
              break;
            }
            if (swapped) break;
          }

          if (swapped) break;
        }
      }

      // PART B: Eliminate any UNDERLOADED days (load < limits.min)
      for (let dLow = 0; dLow < numDays; dLow++) {
        if (dailyFlightLoad[fl][dLow] >= limits.min) continue;

        for (let dHigh = 0; dHigh < numDays; dHigh++) {
          if (dLow === dHigh) continue;
          if (dailyFlightLoad[fl][dHigh] <= limits.min) continue;

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
              if (dailyFlightLoad[f2][dHigh] + 1 > f2Limits.max) continue;
              if (dailyFlightLoad[f2][dLow] - 1 < f2Limits.min) continue;
              if (dailyFlightLoad[fl][dLow] + 1 > limits.max) continue;
              if (dailyFlightLoad[fl][dHigh] - 1 < limits.min) continue;

              t.data[fl][dHigh] -= 1;
              t.data[fl][dLow] += 1;
              t.data[f2][dLow] -= 1;
              t.data[f2][dHigh] += 1;

              dailyFlightLoad[fl][dHigh] -= 1;
              dailyFlightLoad[fl][dLow] += 1;
              dailyFlightLoad[f2][dLow] -= 1;
              dailyFlightLoad[f2][dHigh] += 1;

              if (isTHeavy) {
                dailyFlightHeavyLoad[fl][dHigh] -= 1;
                dailyFlightHeavyLoad[fl][dLow] += 1;
                dailyFlightHeavyLoad[f2][dLow] -= 1;
                dailyFlightHeavyLoad[f2][dHigh] += 1;
              }

              swapped = true;
              globalChange = true;
              break;
            }
            if (swapped) break;
          }

          if (swapped) break;
        }
      }

      // PART C: Eliminate clustering of (base + 1) duties across the period
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

  // Step 6: Heavy Duty Conflict Resolver
  for (let round = 0; round < 150; round++) {
    let resolvedAny = false;

    for (let d = 0; d < numDays; d++) {
      for (const fl of flights) {
        const heavyCount = dailyFlightHeavyLoad[fl][d];
        const flHLimits = flightHeavyDailyLimits[fl];
        if (heavyCount <= flHLimits.max) continue;

        const heavyTables = newMatrix.filter(
          (t) => !t.isDisabled && isHeavyDuty(t.id, t.title) && (t.data[fl]?.[d] || 0) > 0
        );

        for (const t of heavyTables) {
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

              if (isStaticDailyUniformDuty(t)) continue;
              const maxFlDOther = Math.max(1, Math.ceil((tableTargets[t.id]?.[fl] || 0) / numDays));
              if (t.data[fl][dOther] + 1 > maxFlDOther) continue;
              const maxF2D = Math.max(1, Math.ceil((tableTargets[t.id]?.[f2] || 0) / numDays));
              if (t.data[f2][d] + 1 > maxF2D) continue;

              let lightTable: WorkTable | null = null;
              for (const tLight of newMatrix.filter((x) => !x.isDisabled && !isHeavyDuty(x.id, x.title) && !isStaticDailyUniformDuty(x))) {
                if ((tLight.data[fl]?.[dOther] || 0) > 0 && (tLight.data[f2]?.[d] || 0) > 0) {
                  const maxLtFlD = Math.max(1, Math.ceil((tableTargets[tLight.id]?.[fl] || 0) / numDays));
                  if ((tLight.data[fl]?.[d] || 0) + 1 > maxLtFlD) continue;
                  const maxLtF2DOther = Math.max(1, Math.ceil((tableTargets[tLight.id]?.[f2] || 0) / numDays));
                  if ((tLight.data[f2]?.[dOther] || 0) + 1 > maxLtF2DOther) continue;
                  lightTable = tLight;
                  break;
                }
              }

              if (!lightTable) {
                if (dailyFlightLoad[fl][dOther] + 1 > flLimits.max) continue;
                if (dailyFlightLoad[f2][d] + 1 > f2Limits.max) continue;
                if (dailyFlightLoad[fl][d] - 1 < flLimits.min) continue;
                if (dailyFlightLoad[f2][dOther] - 1 < f2Limits.min) continue;
              }

              if (lightTable || heavyCount > flHLimits.max || nextLoadPen <= curLoadPen) {
                t.data[fl][d] -= 1;
                t.data[fl][dOther] += 1;
                t.data[f2][d] += 1;
                t.data[f2][dOther] -= 1;

                dailyFlightLoad[fl][d] -= 1;
                dailyFlightLoad[fl][dOther] += 1;
                dailyFlightLoad[f2][d] += 1;
                dailyFlightLoad[f2][dOther] -= 1;

                dailyFlightHeavyLoad[fl][d] -= 1;
                dailyFlightHeavyLoad[fl][dOther] += 1;
                dailyFlightHeavyLoad[f2][d] += 1;
                dailyFlightHeavyLoad[f2][dOther] -= 1;

                if (lightTable) {
                  lightTable.data[fl][dOther] -= 1;
                  lightTable.data[fl][d] += 1;
                  lightTable.data[f2][d] -= 1;
                  lightTable.data[f2][dOther] += 1;

                  dailyFlightLoad[fl][dOther] -= 1;
                  dailyFlightLoad[fl][d] += 1;
                  dailyFlightLoad[f2][d] -= 1;
                  dailyFlightLoad[f2][dOther] += 1;
                }

                resolvedAny = true;
                break;
              }
            }
            if (resolvedAny) break;
          }
          if (resolvedAny) break;
        }
      }
    }
    if (!resolvedAny) break;
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

import { Airman, DutyAssignment, DutyCategoryCode, ConflictAlert, AirmanDutyStats } from '../types';
import { DUTY_TYPE_MAP } from './dutyTypes';
import { INITIAL_AIRMEN } from './initialAirmen';
import { generateOfficialMonthAssignments } from './officialJulyAugustData';

const SER_TO_DIGITS = new Map<string, string>();
const DIGITS_TO_SER = new Map<string, number>();
INITIAL_AIRMEN.forEach((a) => {
  const d = String(a.bdNo || a.id || '').replace(/\D/g, '');
  if (a.serNo && d) {
    SER_TO_DIGITS.set(`airman-${a.serNo}`, d);
    DIGITS_TO_SER.set(d, a.serNo);
  }
});

export function addAssignmentToMap(assignmentMap: Map<string, DutyAssignment>, ass: DutyAssignment) {
  const scope = ass.disposalScope || 'ALL';
  if (scope !== 'ALL') return; // We only build the map for the main roster
  
  const rawId = ass.airmanId || '';
  const digits = SER_TO_DIGITS.get(rawId.toLowerCase()) || String(rawId).replace(/\D/g, '');
  const serNo = digits ? DIGITS_TO_SER.get(digits) : undefined;
  const keys = [
    `${rawId}_${ass.date}`,
    rawId.includes('/') ? `${rawId.replace(/\//g, '_')}_${ass.date}` : '',
    rawId.includes('_') ? `${rawId.replace(/_/g, '/')}_${ass.date}` : '',
    digits ? `BD_${digits}_${ass.date}` : '',
    digits ? `BD/${digits}_${ass.date}` : '',
    digits ? `${digits}_${ass.date}` : '',
    serNo ? `airman-${serNo}_${ass.date}` : '',
  ].filter(Boolean);
  
  keys.forEach((key) => {
    const existing = assignmentMap.get(key);
    if (!existing) {
      assignmentMap.set(key, ass);
    } else {
      // Both exist. Determine priority.
      if (existing.dutyCode === 'LEAVE' && ass.dutyCode !== 'LEAVE') return;
      if (ass.dutyCode === 'LEAVE' && existing.dutyCode !== 'LEAVE') {
        assignmentMap.set(key, ass);
        return;
      }
      const isBase = (code: string) => !code || code === 'ON_PARADE' || code === 'PT' || code === 'PT_PARADE';
      const existingIsBase = isBase(existing.dutyCode);
      const newIsBase = isBase(ass.dutyCode);
      if (existingIsBase && !newIsBase) {
        assignmentMap.set(key, ass);
        return;
      }
      if (!existingIsBase && newIsBase) return;

      const isDeployment = (code: string) => ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(code);
      const existingIsDep = isDeployment(existing.dutyCode);
      const newIsDep = isDeployment(ass.dutyCode);
      
      const isIdacCode = (code: string) => ['IDAC', 'IDA', 'IDAC CENTER', 'IDA CENTER'].includes(String(code || '').toUpperCase().trim());
      if (isIdacCode(existing.dutyCode) && isIdacCode(ass.dutyCode)) {
        const s1 = (existing.idaShift || '').toLowerCase();
        const s2 = (ass.idaShift || '').toLowerCase();
        const hasMorning = s1 === 'morning' || s2 === 'morning' || !s1 || !s2 || (existing.notes || '').includes('IDAC A+C');
        const hasNight = s1 === 'night' || s2 === 'night' || (existing.notes || '').includes('IDAC A+C');
        if (hasMorning && hasNight && s1 !== s2) {
          assignmentMap.set(key, {
            ...ass,
            dutyCode: 'IDAC',
            idaShift: 'Night',
            notes: 'IDAC A+C',
          });
          return;
        }
      }

      // If the existing is a deployment and the new one is not, the new one overwrites it.
      if (existingIsDep && !newIsDep) {
        assignmentMap.set(key, ass);
      } 
      // If both are not deployments, or both are deployments, usually the latest assignment wins
      else if ((!existingIsDep && !newIsDep) || (existingIsDep && newIsDep)) {
        assignmentMap.set(key, ass);
      }
    }
  });
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function formatMonthKey(year: number, month: number): string {
  const m = month < 10 ? `0${month}` : `${month}`;
  return `${year}-${m}`;
}

export function generateSeedAssignments(airmen: Airman[], year: number, month: number): DutyAssignment[] {
  // Returns clean empty assignment register - ready for live user entry or PDF/document roster import
  return [];
}

export function resolveAirmanDutyForDate(
  airmanId: string,
  dateStr: string,
  assignmentMap: Map<string, DutyAssignment>
): DutyAssignment {
  const digits = String(airmanId || '').replace(/\D/g, '');
  const findAss = (d: string) => {
    if (assignmentMap.has(`${airmanId}_${d}`)) return assignmentMap.get(`${airmanId}_${d}`);
    if (airmanId.includes('/') && assignmentMap.has(`${airmanId.replace(/\//g, '_')}_${d}`)) return assignmentMap.get(`${airmanId.replace(/\//g, '_')}_${d}`);
    if (airmanId.includes('_') && assignmentMap.has(`${airmanId.replace(/_/g, '/')}_${d}`)) return assignmentMap.get(`${airmanId.replace(/_/g, '/')}_${d}`);
    if (digits) {
      return assignmentMap.get(`BD_${digits}_${d}`) || assignmentMap.get(`BD/${digits}_${d}`) || assignmentMap.get(`${digits}_${d}`);
    }
    return undefined;
  };

  const currentAss = findAss(dateStr);

  // Calculate previous date D-1 safely via UTC
  const [yr, mo, da] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(yr, (mo || 1) - 1, da || 1));
  d.setUTCDate(d.getUTCDate() - 1);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const yestStr = `${year}-${month}-${day}`;

  const yestAss = findAss(yestStr);
  const isEscort = yestAss ? (
    (yestAss.dutyCode as any) === 'ESCORT' ||
    (yestAss.dutyCode as any) === 'ESC' ||
    (yestAss.dutyCode as any) === 'ESCT' ||
    String(yestAss.dutyCode || '').includes('1794394') ||
    (yestAss.notes || '').toLowerCase().includes('escort') ||
    ((yestAss as any).dutyName || '').toLowerCase().includes('escort')
  ) : false;

  const isHeavyDuty = yestAss ? (
    ['GD', 'BTF', 'NTF', 'AIRPORT', 'HALISHAHAR'].includes(yestAss.dutyCode) ||
    ((yestAss.dutyCode === 'IDAC' || yestAss.dutyCode === 'IDA') && yestAss.idaShift === 'Night') ||
    (yestAss.notes || '').toLowerCase().includes('idac') ||
    isEscort
  ) : false;

  const isDeployment = currentAss && ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(currentAss.dutyCode);
  const isBaseToday = currentAss && ['ON_PARADE', 'PT', 'PT_PARADE'].includes(currentAss.dutyCode);

  if (!currentAss || isDeployment || isBaseToday) {
    if (isHeavyDuty) {
      let yCode = yestAss?.dutyCode === 'IDA' ? 'IDAC' : (yestAss?.dutyCode || 'DUTY');
      if (yCode === 'AIRPORT') yCode = 'APT';
      if (isEscort) yCode = 'ESCT';
      return {
        airmanId,
        date: dateStr,
        dutyCode: 'DUTY_OFF',
        notes: `${yCode} OFF`,
      };
    }
  }

  if (currentAss) {
    return currentAss;
  }

  // Default: On Parade
  return {
    airmanId,
    date: dateStr,
    dutyCode: 'ON_PARADE',
    notes: '',
  };
}

export function calculateDutyStats(
  airmen: Airman[],
  rawAssignments: DutyAssignment[],
  year?: number,
  month?: number
): AirmanDutyStats[] {
  const uniqueAss = new Map();
  rawAssignments.forEach(a => {
      const rawId = String(a.airmanId || '');
      const digits = SER_TO_DIGITS.get(rawId.toLowerCase()) || rawId.replace(/\D/g, '');
      const normKeyId = digits.length >= 4 ? `BD/${digits}` : rawId;
      const key = normKeyId + '-' + a.date + '-' + a.dutyCode + '-' + (a.idaShift || '');
      if (!uniqueAss.has(key)) uniqueAss.set(key, a);
  });
  const assignments = Array.from(uniqueAss.values());

  const statsList: AirmanDutyStats[] = [];
  const map = new Map<string, AirmanDutyStats>();

  airmen.forEach((a) => {
    const statObj: AirmanDutyStats = {
      airmanId: a.id,
      airmanName: a.name,
      rank: a.rank,
      bdNo: a.bdNo,
      flightName: a.flightName,
      totalGD: 0,
      totalBTF: 0,
      totalNTF: 0,
      totalHalishahar: 0,
      totalAirport: 0,
      totalIDAC: 0,
      totalIDACMorning: 0,
      totalIDACAfternoon: 0,
      totalIDACNight: 0,
      totalBakeNBite: 0,
      totalTDY: 0,
      totalLeave: 0,
      totalDutyOff: 0,
      totalDutyCount: 0,
    };
    statsList.push(statObj);
    map.set(a.id, statObj);
    if (a.serNo) map.set(`airman-${a.serNo}`, statObj);
    if (a.id.includes('_')) map.set(a.id.replace(/_/g, '/'), statObj);
    if (a.id.includes('/')) map.set(a.id.replace(/\//g, '_'), statObj);
    const digits = String(a.bdNo || a.id || '').replace(/\D/g, '');
    if (digits) {
      map.set(`BD_${digits}`, statObj);
      map.set(`BD/${digits}`, statObj);
      map.set(digits, statObj);
    }
  });

  const assignmentMap = new Map<string, DutyAssignment>();
  assignments.forEach((ass) => addAssignmentToMap(assignmentMap, ass));

  if (year && month) {
    const monthStr = month < 10 ? `0${month}` : `${month}`;
    const targetPrefix = `${year}-${monthStr}`;
    
    // First, process all explicit assignments for the given month
    assignments.forEach((ass) => {
      if ((ass.disposalScope || 'ALL') !== 'ALL') return;
      if (String(ass.date || '').startsWith(targetPrefix)) {
        const digits = SER_TO_DIGITS.get(String(ass.airmanId || '').toLowerCase()) || String(ass.airmanId || '').replace(/\D/g, '');
        const stat = map.get(ass.airmanId) || (digits ? map.get(digits) : undefined);
        if (!stat) return;
        const resolvedForDay =
          assignmentMap.get(`${ass.airmanId}_${ass.date}`) ||
          (digits ? assignmentMap.get(`BD/${digits}_${ass.date}`) || assignmentMap.get(`${digits}_${ass.date}`) : undefined);
        if (resolvedForDay && resolvedForDay.dutyCode === 'LEAVE' && ass.dutyCode !== 'LEAVE') return;
        if (resolvedForDay && !['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(resolvedForDay.dutyCode) && ['ATT', 'BAKE_N_BITE', 'CANTEEN', 'DEPLOYMENT'].includes(ass.dutyCode)) return;
        
        switch (ass.dutyCode) {
          case 'GD':
            stat.totalGD++;
            stat.totalDutyCount++;
            break;
          case 'BTF':
            stat.totalBTF++;
            stat.totalDutyCount++;
            break;
          case 'NTF':
            stat.totalNTF++;
            stat.totalDutyCount++;
            break;
          case 'HALISHAHAR':
            stat.totalHalishahar++;
            stat.totalDutyCount++;
            break;
          case 'AIRPORT':
            stat.totalAirport++;
            stat.totalDutyCount++;
            break;
          case 'IDAC':
          case 'IDA':
          case 'IDA C':
          case 'IDA_C':
          case 'IDAC CENTER':
          case 'IDA CENTER':
            stat.totalIDAC++;
            if (ass.idaShift === 'Morning') {
              stat.totalIDACMorning++;
            } else if (ass.idaShift === 'Afternoon') {
              stat.totalIDACAfternoon++;
            } else if (ass.idaShift === 'Night') {
              stat.totalIDACNight++;
            } else {
              stat.totalIDACMorning++;
            }
            stat.totalDutyCount++;
            break;
          case 'BAKE_N_BITE':
            stat.totalBakeNBite++;
            break;
          case 'TDY':
            stat.totalTDY++;
            break;
          case 'LEAVE':
            stat.totalLeave++;
            break;

          case 'DUTY_OFF':
            stat.totalDutyOff++;
            break;
        }
      }
    });
  } else {
    // Fallback if no specific year/month provided
    assignments.forEach((ass) => {
      if ((ass.disposalScope || 'ALL') !== 'ALL') return;
      const stat = map.get(ass.airmanId);
      if (!stat) return;

      switch (ass.dutyCode) {
        case 'GD':
          stat.totalGD++;
          stat.totalDutyCount++;
          break;
        case 'BTF':
          stat.totalBTF++;
          stat.totalDutyCount++;
          break;
        case 'NTF':
          stat.totalNTF++;
          stat.totalDutyCount++;
          break;
        case 'HALISHAHAR':
          stat.totalHalishahar++;
          stat.totalDutyCount++;
          break;
        case 'AIRPORT':
          stat.totalAirport++;
          stat.totalDutyCount++;
          break;
        case 'IDAC':
          case 'IDA':
          case 'IDA C':
          case 'IDA_C':
          case 'IDAC CENTER':
          case 'IDA CENTER':
          stat.totalIDAC++;
          if (ass.idaShift === 'Morning') {
            stat.totalIDACMorning++;
          } else if (ass.idaShift === 'Afternoon') {
            stat.totalIDACAfternoon++;
          } else if (ass.idaShift === 'Night') {
            stat.totalIDACNight++;
          } else {
            stat.totalIDACMorning++;
          }
          stat.totalDutyCount++;
          break;
        case 'BAKE_N_BITE':
          stat.totalBakeNBite++;
          break;
        case 'TDY':
          stat.totalTDY++;
          break;
        case 'LEAVE':
          stat.totalLeave++;
          break;
        case 'DUTY_OFF':
          stat.totalDutyOff++;
          break;
      }
    });
  }

  return statsList;
}

export function detectConflicts(airmen: Airman[], assignments: DutyAssignment[]): ConflictAlert[] {
  const alerts: ConflictAlert[] = [];
  const airmanMap = new Map<string, Airman>();
  airmen.forEach((a) => {
    airmanMap.set(a.id, a);
    if (a.serNo) airmanMap.set(`airman-${a.serNo}`, a);
    const digits = String(a.bdNo || a.id || '').replace(/\D/g, '');
    if (digits) {
      airmanMap.set(digits, a);
      airmanMap.set(`BD/${digits}`, a);
      airmanMap.set(`BD_${digits}`, a);
    }
  });

  // Only consider main roster (ALL) scope for conflicts
  const mainAssignments = assignments.filter((a) => (a.disposalScope || 'ALL') === 'ALL');

  // Group assignments by canonical airman id
  const byAirman = new Map<string, DutyAssignment[]>();
  mainAssignments.forEach((ass) => {
    const resolvedAir = airmanMap.get(ass.airmanId);
    const canonicalId = resolvedAir ? resolvedAir.id : ass.airmanId;
    const list = byAirman.get(canonicalId) || [];
    list.push(ass);
    byAirman.set(canonicalId, list);
  });

  byAirman.forEach((list, airmanId) => {
    const airman = airmanMap.get(airmanId);
    if (!airman) return;

    // Group assignments by date for this airman so each date is evaluated exactly once
    const byDate = new Map<string, DutyAssignment[]>();
    list.forEach((ass) => {
      const dateList = byDate.get(ass.date) || [];
      dateList.push(ass);
      byDate.set(ass.date, dateList);
    });

    byDate.forEach((dateAssignments, date) => {
      // 1. Check double assignment on same date with active duty + leave/tdy
      if (dateAssignments.length > 1) {
        const hasLeaveOrTdy = dateAssignments.some((a) => a.dutyCode === 'LEAVE' || a.dutyCode === 'TDY');
        const hasDuty = dateAssignments.some((a) => 
          ['GD', 'BTF', 'NTF', 'HALISHAHAR', 'AIRPORT', 'IDAC', 'IDA', 'BAKE_N_BITE'].includes(a.dutyCode)
        );
        if (hasLeaveOrTdy && hasDuty) {
          alerts.push({
            id: `conflict-leavetdy-${airmanId}-${date}`,
            airmanId,
            airmanName: `${airman.rank} ${airman.name}`,
            date,
            severity: 'error',
            message: `No active duty may be assigned during Leave or TDY deployment. ${airman.rank} ${airman.name} is on Leave/TDY on ${date} but has an active duty scheduled.`,
            ruleType: 'LEAVE_TDY_OVERLAP',
          });
        }
      }

      // 2. Check Guard / Security Duty (GD) rank limitation: Strictly Cpl & Below (Never Sgt, WO, SWO, MWO)
      const hasGD = dateAssignments.some((a) => a.dutyCode === 'GD');
      if (hasGD && ['MWO', 'SWO', 'WO', 'Sgt'].includes(airman.rank)) {
        alerts.push({
          id: `conflict-gd-rank-${airmanId}-${date}`,
          airmanId,
          airmanName: `${airman.rank} ${airman.name}`,
          date,
          severity: 'error',
          message: `Security Duty (GD) assignment violation: Sgt, WO, SWO, and MWO are strictly prohibited from Guard / Security Duty. GD is authorized only for Cpl and LAC ranks (${airman.rank} ${airman.name} on ${date}).`,
          ruleType: 'RANK_INELIGIBLE_GD',
        });
      }
    });
  });

  // Strict deduplication by alert id
  const seenIds = new Set<string>();
  const uniqueAlerts: ConflictAlert[] = [];
  for (const al of alerts) {
    if (!seenIds.has(al.id)) {
      seenIds.add(al.id);
      uniqueAlerts.push(al);
    }
  }

  return uniqueAlerts;
}

export function getAirmanShortCode(airman: Airman): string {
  if (!airman) return '';
  if (airman.code && !airman.code.includes('-')) return airman.code;
  const nameMap: Record<string, string> = {
    'Moshiur': 'MSR',
    'G. Mostafa': 'MGER',
    'Jahid': 'JHD',
    'Mojaffar': 'MJF',
    'A. Baten': 'BTN',
    'Shahin': 'SHN',
    'Lutfar': 'LPR',
    'Aminul': 'AMN',
    'Uzzal': 'UZL',
    'Riaz': 'RIAZ',
    'Mobarak': 'MBK',
    'Rubel': 'RBL',
    'Absar': 'ABSR',
    'Mahid': 'MAHD',
    'Asad': 'ASD',
    'Fokrul': 'FKL',
    'Shishir': 'SSR',
    'Mustakim': 'MKM',
    'Sojib': 'SSJB',
    'Mehedi': 'MHDE',
    'Ripon': 'RPN',
    'A. Gafur': 'GFR',
    'Shohel': 'SHL',
    'Imran': 'IMRN',
    'Nahid': 'NSD',
    'Harun': 'HRN',
    'Omar': 'OMR',
    'Ismail': 'ISM',
    'Ahsan': 'AHSN',
    'Koraishi': 'KORS',
    'Sajib': 'SIB',
    'Maraz': 'MRZ',
    'Shariful': 'SFL',
    'Akash': 'AKS',
    'Rasel': 'RSL',
    'Mahedi': 'MAHD',
    'Rakib': 'RKB',
    'Joy': 'JOY',
    'Ashraful': 'ASRF',
    'Hridoy': 'HDY',
    'Nishad': 'NSD',
    'Zakirul': 'ZKL',
    'Zubayer': 'ZBR',
    'Tusar': 'THN',
    'Adnan': 'ADN',
    'Rashed': 'RSD',
    'Saidul': 'SDL',
  };
  if (nameMap[airman.name]) return nameMap[airman.name];
  if (airman.code && airman.code.includes('-')) {
    const parts = airman.code.split('-');
    return parts[parts.length - 1];
  }
  return airman.name.substring(0, 4).toUpperCase();
}

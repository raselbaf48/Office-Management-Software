import XLSX from 'xlsx-js-style';
import { saveFileWithFeedback as saveAs } from './exportNotification';
import JSZip from 'jszip';
import { Airman, DutyAssignment } from '../types';
import { formatRank } from './rankFormatter';
import { DUTY_TYPE_MAP } from '../data/dutyTypes';
import { resolveAirmanDutyForDate, addAssignmentToMap, calculateDutyStats } from '../data/rosterGenerator';
import { getActiveOfficeIdentity, doesOfficeHaveFlights } from '../firebase';

export function normalizeDateToISO(val: any): string {
  if (!val) return '';
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return '';
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (!s || s === '-' || s === 'N/A') return '';
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const dMmmYRegex = /^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{2,4})$/;
  const dMmmMatch = s.match(dMmmYRegex);
  if (dMmmMatch) {
    const day = parseInt(dMmmMatch[1], 10);
    const monthStr = dMmmMatch[2].toLowerCase();
    let year = parseInt(dMmmMatch[3], 10);
    if (year < 100) {
      year += year >= 50 ? 1900 : 2000;
    }
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIdx = months.indexOf(monthStr);
    if (monthIdx >= 0) {
      return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const dmyMatch = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    let year = parseInt(dmyMatch[3], 10);
    if (year < 100) {
      year += year >= 50 ? 1900 : 2000;
    }
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return s;
}

export function formatShortDate(val?: string | null): string {
  if (!val || val === '-' || val === 'N/A') return '-';
  const iso = normalizeDateToISO(val);
  if (!iso) return val;
  const parts = iso.split('-');
  if (parts.length === 3) {
    const year = parts[0].slice(-2);
    const monthNum = parseInt(parts[1], 10);
    const day = parts[2].padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (monthNum >= 1 && monthNum <= 12) {
      return `${day} ${months[monthNum - 1]} ${year}`;
    }
  }
  return val;
}

async function applyExcelDateValidation(
  wbout: any,
  colLetter: string,
  startRow = 2,
  endRow = 2000
): Promise<Blob> {
  try {
    const zip = await JSZip.loadAsync(wbout);
    const sheetPath = 'xl/worksheets/sheet1.xml';
    const sheetFile = zip.file(sheetPath);
    if (!sheetFile) {
      return new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    let sheetXml = await sheetFile.async('text');
    const range = `${colLetter}${startRow}:${colLetter}${endRow}`;

    // OpenXML Data Validation with type="date" and input prompt for calendar / date picker
    const dvXml = `<dataValidations count="1"><dataValidation type="date" operator="between" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="Invalid Date" error="Please enter or select a date in format: dd mmm yy (e.g. 12 Jan 22)" promptTitle="Date of Posting" prompt="Double-click or enter date (Format: dd mmm yy)" sqref="${range}"><formula1>1</formula1><formula2>73050</formula2></dataValidation></dataValidations>`;

    if (sheetXml.includes('<ignoredErrors>')) {
      sheetXml = sheetXml.replace('<ignoredErrors>', dvXml + '<ignoredErrors>');
    } else if (sheetXml.includes('<pageMargins')) {
      sheetXml = sheetXml.replace('<pageMargins', dvXml + '<pageMargins');
    } else {
      sheetXml = sheetXml.replace('</worksheet>', dvXml + '</worksheet>');
    }

    zip.file(sheetPath, sheetXml);
    const modifiedArray = await zip.generateAsync({ type: 'arraybuffer' });
    return new Blob([modifiedArray], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } catch (err) {
    console.error('Failed to inject date validation, falling back to standard sheet:', err);
    return new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
}

export function exportTableToCSV(elementId: string, filename: string) {
  const el = document.getElementById(elementId);
  if (!el) {
    console.error(`Element with id ${elementId} not found`);
    return;
  }

  const tables = el.querySelectorAll('table');
  if (tables.length === 0) {
    console.error('No tables found to export');
    return;
  }

  let csvContent = '';

  tables.forEach((table, tableIndex) => {
    // If there are multiple tables, we might want to separate them.
    if (tableIndex > 0) {
      csvContent += '\n\n';
    }

    // Try to get a title preceding the table
    let previousNode = table.previousElementSibling;
    if (previousNode && previousNode.tagName.match(/^H[1-6]$/)) {
      csvContent += `"${previousNode.textContent?.trim()}"\n`;
    }

    const rows = table.querySelectorAll('tr');
    
    // Convert table data to CSV format
    // Because tables might have colspans/rowspans, a naive approach might misalign.
    // However, for basic export, simple iteration works as a fallback.
    // A robust approach creates a 2D array representing the table grid.
    
    // First pass: determine max rows and cols to initialize grid
    let maxCols = 0;
    for (let r = 0; r < rows.length; r++) {
      let cells = rows[r].querySelectorAll('td, th');
      let colsInRow = 0;
      cells.forEach(cell => {
        colsInRow += parseInt(cell.getAttribute('colspan') || '1', 10);
      });
      maxCols = Math.max(maxCols, colsInRow);
    }
    
    let grid: string[][] = Array(rows.length).fill(null).map(() => Array(maxCols).fill(''));
    
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].querySelectorAll('td, th');
      let c = 0; // Current column in grid
      
      cells.forEach(cell => {
        // Find next empty spot in the row
        while (c < maxCols && grid[r][c] !== '') {
          c++;
        }
        
        let text = (cell.textContent || '').replace(/(\r\n|\n|\r)/gm, ' ').trim();
        // Escape quotes
        text = text.replace(/"/g, '""');
        
        const rowspan = parseInt(cell.getAttribute('rowspan') || '1', 10);
        const colspan = parseInt(cell.getAttribute('colspan') || '1', 10);
        
        for (let i = 0; i < rowspan; i++) {
          for (let j = 0; j < colspan; j++) {
            if (r + i < rows.length && c + j < maxCols) {
               // Only put text in the top-left cell of the span, others get empty string (or we could duplicate)
               if (i === 0 && j === 0) {
                 grid[r + i][c + j] = `"${text}"`;
               } else {
                 grid[r + i][c + j] = '""';
               }
            }
          }
        }
        c += colspan;
      });
    }

    // Convert grid to CSV string
    grid.forEach(row => {
      csvContent += row.join(',') + '\n';
    });
  });

  // Use BOM for Excel compatibility with UTF-8
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/\.csv?$/, '') + '.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getExcelColName(colNumber: number): string {
  let colName = '';
  let dividend = colNumber;
  let modulo;
  while (dividend > 0) {
    modulo = (dividend - 1) % 26;
    colName = String.fromCharCode(65 + modulo) + colName;
    dividend = Math.floor((dividend - modulo) / 26);
  }
  return colName;
}

export function exportDutyRatioMatrixCSV(
  matrix: Array<{
    id?: string;
    title: string;
    data: Record<string, number[]>;
    dailyRequirement?: number;
    totalRequiredMonth?: number;
    isDisabled?: boolean;
    dailyRequirements?: number[];
    totalRequiredDaily?: number;
  }>,
  filename = 'BAF_155_UASU_Duty_Ratio_Template.csv'
) {
  const activeTables = matrix.filter((t) => !t.isDisabled);
  const rows: string[][] = [];

  // Top header comments matching user template structure
  const activeOfficeName = getActiveOfficeIdentity().officeName || '155 UASU BAF';
  rows.push([`# ${activeOfficeName} - OFFICIAL DUTY RATIO MATRIX`, ...Array(33).fill('')]);
  rows.push([
    '"# NOTE: ""Total"" column and ""Daily Total"" / ""Daily Req"" rows are auto-calculated. Only edit flight quotas for Day 1-31."',
    ...Array(33).fill(''),
  ]);
  rows.push(Array(34).fill(''));

  const flights: Array<{ key: string; label: string }> = [
    { key: 'Mechanics', label: 'Mechanics' },
    { key: 'Avionics', label: 'Avionics' },
    { key: 'GCS', label: 'GCS' },
    { key: 'Admin', label: 'Admin' },
  ];

  activeTables.forEach((table) => {
    const dutyName = (table.title || '').replace(/\s*\(\d+\)$/, '').trim();
    rows.push(['Duty Name', 'Flight/Date', ...Array.from({ length: 31 }, (_, i) => String(i + 1)), 'Total']);

    let tableGrandTotal = 0;

    // 1. Flight rows: In Total Col, output the exact sum of all dates (Day 1 - 31) for that flight
    flights.forEach(({ key, label }) => {
      const days = (table.data?.[key] || Array(31).fill(0)).map((d) => Number(d) || 0);
      const rowSum = days.reduce((sum, val) => sum + val, 0);
      tableGrandTotal += rowSum;

      rows.push([
        dutyName,
        label,
        ...days.map((d) => String(d)),
        String(rowSum),
      ]);
    });

    // 2. Daily Total row: In each date column (Day 1 - 31), output the sum of all flights on that date
    // In the Total column, output the sum of all dates for all flights (table grand total)
    const dailyTotals: number[] = [];
    for (let day = 0; day < 31; day++) {
      const daySum = flights.reduce((sum, f) => {
        const val = table.data?.[f.key]?.[day] ?? 0;
        return sum + (Number(val) || 0);
      }, 0);
      dailyTotals.push(daySum);
    }

    rows.push([
      'Daily ',
      'Total',
      ...dailyTotals.map((d) => String(d)),
      String(tableGrandTotal),
    ]);

    // 3. Daily Req row: configured requirements for each day and total monthly requirement
    const hasDailyReqs = table.dailyRequirements && Array.isArray(table.dailyRequirements) && table.dailyRequirements.length > 0;
    const defaultDailyReq = table.totalRequiredDaily ?? table.dailyRequirement ?? (table.totalRequiredMonth ? Math.round(table.totalRequiredMonth / 31) : 0);

    const reqDays = Array.from({ length: 31 }, (_, dayIdx) => {
      if (hasDailyReqs) {
        return Number(table.dailyRequirements![dayIdx]) || 0;
      }
      return defaultDailyReq;
    });
    const reqTotal = hasDailyReqs
      ? reqDays.reduce((a, b) => a + b, 0)
      : (table.totalRequiredMonth || (defaultDailyReq * 31));

    rows.push([
      'Daily ',
      'Req',
      ...reqDays.map((r) => String(r)),
      String(reqTotal),
    ]);

    // Blank line between duties matching template (33 commas / 34 empty fields)
    rows.push(Array(34).fill(''));
  });

  const csvContent = rows.map((r) => r.join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const cleanName = filename.replace(/\.(csv|xlsx)$/i, '') + '.csv';
  saveAs(blob, cleanName);
}

function formatDisplayDate(dateStr?: string): string {
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

export function exportDutyRatioMatrixExcel(
  matrix: Array<{
    id?: string;
    title: string;
    data: Record<string, number[]>;
    dailyRequirement?: number;
    totalRequiredMonth?: number;
    isDisabled?: boolean;
    dailyRequirements?: number[];
    totalRequiredDaily?: number;
  }>,
  filename = 'BAF_155_UASU_Duty_Ratio_Matrix.xlsx',
  flightFilter?: string,
  targetDate?: string
) {
  const activeTables = matrix.filter((t) => !t.isDisabled);
  const wb = XLSX.utils.book_new();
  const rows: any[][] = [];

  const allFlights: Array<{ key: string; label: string }> = [
    { key: 'Mechanics', label: 'Mechanics' },
    { key: 'Avionics', label: 'Avionics' },
    { key: 'GCS', label: 'GCS' },
    { key: 'Admin', label: 'Admin' },
  ];

  const flights = (flightFilter && flightFilter !== 'Overall')
    ? allFlights.filter(f => f.key === flightFilter)
    : allFlights;

  const tableRanges: Array<{ headerRow: number; startRow: number; endRow: number }> = [];

  activeTables.forEach((table, tIdx) => {
    const dutyName = (table.title || '').replace(/\s*\(\d+\)$/, '').trim();
    const headerRowIndex = rows.length;
    rows.push(['Duty Name', 'Flight/Date', ...Array.from({ length: 31 }, (_, i) => i + 1), 'Total']);

    const startRow = rows.length + 1; // 1-based row index in Excel sheet
    let tableGrandTotal = 0;

    flights.forEach(({ key, label }, fIdx) => {
      const days = (table.data?.[key] || Array(31).fill(0)).map((d) => Number(d) || 0);
      const rowSum = days.reduce((a, b) => a + b, 0);
      tableGrandTotal += rowSum;
      const currentRow = startRow + fIdx;
      rows.push([
        dutyName,
        label,
        ...days.map(d => (d > 0 ? d : '')),
        { f: `SUM(C${currentRow}:AG${currentRow})`, v: rowSum },
      ]);
    });

    const endRow = startRow + flights.length - 1;
    const dailyTotalCols: any[] = [];
    for (let d = 0; d < 31; d++) {
      const colLetter = XLSX.utils.encode_col(d + 2); // Col C = Day 1, Col AG = Day 31
      const daySum = flights.reduce((sum, f) => sum + (Number(table.data?.[f.key]?.[d]) || 0), 0);
      dailyTotalCols.push({
        f: `SUM(${colLetter}${startRow}:${colLetter}${endRow})`,
        v: daySum,
      });
    }

    const totalColLetter = XLSX.utils.encode_col(33); // AH = Total column
    rows.push([
      'Daily ',
      'Total',
      ...dailyTotalCols,
      { f: `SUM(${totalColLetter}${startRow}:${totalColLetter}${endRow})`, v: tableGrandTotal },
    ]);

    // Daily Req
    const hasDailyReqs = table.dailyRequirements && Array.isArray(table.dailyRequirements) && table.dailyRequirements.length > 0;
    const defaultDailyReq = table.totalRequiredDaily ?? table.dailyRequirement ?? (table.totalRequiredMonth ? Math.round(table.totalRequiredMonth / 31) : 0);
    const reqDays = Array.from({ length: 31 }, (_, dayIdx) => {
      if (hasDailyReqs) return Number(table.dailyRequirements![dayIdx]) || 0;
      return defaultDailyReq;
    });
    const reqTotal = hasDailyReqs ? reqDays.reduce((a, b) => a + b, 0) : (table.totalRequiredMonth || (defaultDailyReq * 31));

    rows.push(['Daily ', 'Req', ...reqDays, reqTotal]);

    const dailyReqRowIndex = rows.length - 1;
    tableRanges.push({
      headerRow: headerRowIndex,
      startRow: headerRowIndex,
      endRow: dailyReqRowIndex,
    });

    // Spacing row between tables (except after the last table)
    if (tIdx < activeTables.length - 1) {
      rows.push(Array(34).fill(''));
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Border and font styling:
  // "Duty Name Row ta Bold hbe"
  // "Duty Name theke Daily Req row porjonto ar Total Col porjonto Table Border thakbe"
  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  tableRanges.forEach(({ headerRow, startRow, endRow }) => {
    for (let r = startRow; r <= endRow; r++) {
      for (let c = 0; c <= 33; c++) {
        const cellAddress = XLSX.utils.encode_cell({ r, c });
        if (!ws[cellAddress]) {
          ws[cellAddress] = { t: 's', v: '' };
        }
        const cell = ws[cellAddress];
        const isHeader = r === headerRow;
        const isSummary = r >= endRow - 1; // Daily Total and Daily Req
        const isTotalCol = c === 33;
        const isDataRow = !isHeader && !isSummary;
        const isAltRow = isDataRow && (r - headerRow) % 2 === 0;
        const isAltCol = c >= 2 && c <= 32 && (c - 2 + 1) % 2 === 0;

        let fgColor = 'FFFFFF';
        if (isHeader) {
          fgColor = isAltCol ? 'E2E8F0' : 'F1F5F9';
        } else if (isSummary) {
          fgColor = isAltCol ? 'CBD5E1' : 'E2E8F0';
        } else if (isTotalCol) {
          fgColor = isAltRow ? 'E2E8F0' : 'F1F5F9';
        } else if (isAltRow && isAltCol) {
          fgColor = 'E2E8F0';
        } else if (isAltRow) {
          fgColor = 'F1F5F9';
        } else if (isAltCol) {
          fgColor = 'F8FAFC';
        }

        cell.s = {
          border: thinBorder,
          font: {
            name: 'Arial',
            sz: 12,
            bold: isHeader || isSummary || isTotalCol,
            color: { rgb: '000000' },
          },
          alignment: {
            vertical: 'center',
            horizontal: c === 0 || (c === 1 && !isHeader && !isSummary) ? 'left' : 'center',
            wrapText: false,
          },
          fill: { fgColor: { rgb: fgColor } },
        };
      }
    }
  });

  ws['!cols'] = [
    { wch: 26 }, // Duty Name
    { wch: 14 }, // Flight/Date
    ...Array(31).fill({ wch: 5 }), // Day 1-31
    { wch: 9 },  // Total
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Duty Ratio Matrix');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const cleanName = filename.replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  saveAs(blob, cleanName);
}

export function exportAirmenExcel(
  airmen: Airman[],
  variant: 'nominal' | 'biodata' | string = 'nominal',
  filename?: string
) {
  const wb = XLSX.utils.book_new();
  const officeHasFlights = doesOfficeHaveFlights(airmen);
  const headers = [
    'Ser',
    'BD No',
    'Rank',
    'Full Name',
    'Surname',
    'Trade',
    ...(officeHasFlights ? ['Flight'] : []),
  ];

  if (variant === 'biodata') {
    headers.push('Blood Group', 'Present Address', 'Permanent Address');
  } else {
    headers.push('Address');
  }

  headers.push('Mobile No');

  if (variant === 'biodata') {
    headers.push('Dt of Posting');
  }

  const rows: any[][] = [headers];

  airmen.forEach((a, index) => {
    const row: any[] = [
      index + 1,
      a.bdNo || '',
      a.rank || '',
      a.fullName || a.name || '',
      a.name || a.fullName || '',
      a.trade || '',
      ...(officeHasFlights ? [a.flightName || ''] : []),
    ];

    if (variant === 'biodata') {
      row.push(a.bloodGroup || '-');
      row.push(a.addressBlock || '-');
      row.push(a.permanentAddress || '-');
    } else {
      row.push(a.addressBlock || '-');
    }

    row.push(a.mobileNo ? String(a.mobileNo).trim() : '-');

    if (variant === 'biodata') {
      if (a.dateJoined) {
        const iso = normalizeDateToISO(a.dateJoined);
        if (iso) {
          const [y, m, d] = iso.split('-').map(Number);
          const excelDate = new Date(Date.UTC(y, m - 1, d));
          row.push(excelDate);
        } else {
          row.push('');
        }
      } else {
        row.push('');
      }
    }

    rows.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'dd mmm yy' });

  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  const colCount = headers.length;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < colCount; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellAddress]) {
        ws[cellAddress] = { t: 's', v: '' };
      }
      const cell = ws[cellAddress];
      const isHeader = r === 0;

      let hAlign = 'center';
      const colHeader = headers[c];
      if (
        colHeader === 'Full Name' ||
        colHeader === 'Surname' ||
        colHeader === 'Address' ||
        colHeader === 'Present Address' ||
        colHeader === 'Permanent Address'
      ) {
        hAlign = 'left';
      }

      // Explicit Excel cell formats requested:
      // Mobile No -> Text format (@)
      // Dt of Posting -> Date format (dd mmm yy)
      if (!isHeader) {
        if (colHeader === 'Mobile No' || colHeader === 'BD No') {
          cell.t = 's';
          cell.z = '@';
        } else if (colHeader === 'Dt of Posting') {
          cell.z = 'dd mmm yy';
          if (cell.v instanceof Date) {
            cell.t = 'd';
          }
        }
      }

      cell.s = {
        border: thinBorder,
        font: {
          name: 'Arial',
          sz: 12,
          bold: isHeader,
          color: { rgb: '000000' },
        },
        alignment: {
          vertical: 'center',
          horizontal: isHeader ? 'center' : hAlign,
          wrapText: false,
        },
        ...(isHeader ? { fill: { fgColor: { rgb: 'E2E8F0' } } } : {}),
        ...(!isHeader && colHeader === 'Dt of Posting' ? { numFmt: 'dd mmm yy' } : {}),
        ...(!isHeader && (colHeader === 'Mobile No' || colHeader === 'BD No') ? { numFmt: '@' } : {}),
      };
    }
  }

  ws['!cols'] = headers.map((h) => {
    switch (h) {
      case 'Ser':
        return { wch: 6 };
      case 'BD No':
        return { wch: 12 };
      case 'Rank':
        return { wch: 10 };
      case 'Full Name':
        return { wch: 25 };
      case 'Surname':
        return { wch: 16 };
      case 'Trade':
        return { wch: 15 };
      case 'Flight':
        return { wch: 14 };
      case 'Blood Group':
        return { wch: 12 };
      case 'Present Address':
      case 'Permanent Address':
      case 'Address':
        return { wch: 30 };
      case 'Mobile No':
        return { wch: 16 };
      case 'Dt of Posting':
        return { wch: 14 };
      default:
        return { wch: 12 };
    }
  });

  const sheetTitle = variant === 'biodata' ? 'Biodata Register' : 'Nominal Roll';
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle);

  const defaultFileName =
    variant === 'biodata'
      ? `Biodata_Register_${new Date().toISOString().split('T')[0]}.xlsx`
      : `Nominal_Roll_${new Date().toISOString().split('T')[0]}.xlsx`;

  const finalName = (filename || defaultFileName).replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  const postingColIdx = headers.indexOf('Dt of Posting');
  if (postingColIdx >= 0) {
    const colLetter = XLSX.utils.encode_col(postingColIdx);
    applyExcelDateValidation(wbout, colLetter, 2, Math.max(rows.length + 50, 1000)).then((blob) => {
      saveAs(blob, finalName);
    });
  } else {
    const blob = new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, finalName);
  }
}

export function exportAirmenTemplateExcel(
  filename?: string
) {
  const wb = XLSX.utils.book_new();
  const officeHasFlights = doesOfficeHaveFlights();
  const activeOfficeName = (getActiveOfficeIdentity().officeName || 'BAF_Office').replace(/[^a-zA-Z0-9_-]+/g, '_');
  const defaultTemplateFilename = officeHasFlights
    ? 'BAF_155_UASU_Airmen_Biodata_Template.xlsx'
    : `BAF_${activeOfficeName}_Airmen_Biodata_Template.xlsx`;
  const effectiveFilename = filename || defaultTemplateFilename;

  const headers = [
    'Ser',
    'BD No',
    'Rank',
    'Full Name',
    'Surname',
    'Trade',
    ...(officeHasFlights ? ['Flight'] : []),
    'Blood Group',
    'Present Address',
    'Permanent Address',
    'Mobile No',
    'Dt of Posting',
  ];

  const sampleRows: any[][] = officeHasFlights
    ? [
        ['1', '478546', 'Sgt', 'Md Sazzad Hossain', 'Sazzad', 'Afr Fitt', 'Mechanics', 'B+', "Sgt's Mess Block 05", 'Mirpur-10, Dhaka', '01712345678', new Date(Date.UTC(2022, 0, 12))],
        ['2', '489123', 'Cpl', 'Russel Ahmed', 'Russel', 'Eng Fitt', 'Mechanics', 'O+', "Airmen's Mess Block 08", 'Sadar, Bogura', '01812345678', new Date(Date.UTC(2023, 5, 15))],
        ['3', '495678', 'LAC', 'Md Anowar Hossain', 'Anowar', 'E&I Fitt', 'Avionics', 'A+', 'Svc Qtr D-14', 'Kotwali, Chattogram', '01912345678', new Date(Date.UTC(2023, 10, 1))],
        ['4', '498901', 'AC', 'Rakib Hasan', 'Rakib', 'Radio Fitt', 'Avionics', 'AB+', 'Outside Base: Agrabad', 'Gouripur, Mymensingh', '01612345678', new Date(Date.UTC(2024, 1, 10))],
        ['5', '499120', 'AC', 'Tanvir Ahmed', 'Tanvir', 'Armt Fitt', 'Mechanics', 'O+', "Airmen's Mess Block 02", 'Sadar, Jashore', '01798765432', new Date(Date.UTC(2024, 2, 18))],
      ]
    : [
        ['1', '478546', 'Sgt', 'Md Sazzad Hossain', 'Sazzad', 'Afr Fitt', 'B+', "Sgt's Mess Block 05", 'Mirpur-10, Dhaka', '01712345678', new Date(Date.UTC(2022, 0, 12))],
        ['2', '489123', 'Cpl', 'Russel Ahmed', 'Russel', 'Eng Fitt', 'O+', "Airmen's Mess Block 08", 'Sadar, Bogura', '01812345678', new Date(Date.UTC(2023, 5, 15))],
        ['3', '495678', 'LAC', 'Md Anowar Hossain', 'Anowar', 'E&I Fitt', 'A+', 'Svc Qtr D-14', 'Kotwali, Chattogram', '01912345678', new Date(Date.UTC(2023, 10, 1))],
        ['4', '498901', 'AC', 'Rakib Hasan', 'Rakib', 'Radio Fitt', 'AB+', 'Outside Base: Agrabad', 'Gouripur, Mymensingh', '01612345678', new Date(Date.UTC(2024, 1, 10))],
        ['5', '499120', 'AC', 'Tanvir Ahmed', 'Tanvir', 'Armt Fitt', 'O+', "Airmen's Mess Block 02", 'Sadar, Jashore', '01798765432', new Date(Date.UTC(2024, 2, 18))],
      ];

  // Provide blank pre-formatted rows for direct user entry
  const blankFieldCount = headers.length - 1;
  for (let b = 6; b <= 30; b++) {
    sampleRows.push([String(b), ...Array(blankFieldCount).fill('')]);
  }

  const rows: any[][] = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: 'dd mmm yy' });

  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const cellAddress = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellAddress]) {
        ws[cellAddress] = { t: 's', v: '' };
      }
      const cell = ws[cellAddress];
      const isHeader = r === 0;

      let hAlign = 'center';
      const colHeader = headers[c];
      if (
        colHeader === 'Full Name' ||
        colHeader === 'Surname' ||
        colHeader === 'Present Address' ||
        colHeader === 'Permanent Address'
      ) {
        hAlign = 'left';
      }

      // Explicit cell format requested:
      // Mobile No -> Text format (@)
      // Dt of Posting -> Date format (dd mmm yy)
      if (!isHeader) {
        if (colHeader === 'Mobile No' || colHeader === 'BD No') {
          cell.t = 's';
          cell.z = '@';
        } else if (colHeader === 'Dt of Posting') {
          cell.z = 'dd mmm yy';
          if (cell.v instanceof Date) {
            cell.t = 'd';
          }
        }
      }

      cell.s = {
        border: thinBorder,
        font: {
          name: 'Arial',
          sz: 12,
          bold: isHeader,
          color: { rgb: '000000' },
        },
        alignment: {
          vertical: 'center',
          horizontal: isHeader ? 'center' : hAlign,
          wrapText: false,
        },
        ...(isHeader ? { fill: { fgColor: { rgb: 'E2E8F0' } } } : {}),
        ...(!isHeader && colHeader === 'Dt of Posting' ? { numFmt: 'dd mmm yy' } : {}),
        ...(!isHeader && (colHeader === 'Mobile No' || colHeader === 'BD No') ? { numFmt: '@' } : {}),
      };
    }
  }

  ws['!cols'] = headers.map((h) => {
    switch (h) {
      case 'Ser':
        return { wch: 6 };
      case 'BD No':
        return { wch: 12 };
      case 'Rank':
        return { wch: 10 };
      case 'Full Name':
        return { wch: 25 };
      case 'Surname':
        return { wch: 16 };
      case 'Trade':
        return { wch: 15 };
      case 'Flight':
        return { wch: 14 };
      case 'Blood Group':
        return { wch: 12 };
      case 'Present Address':
      case 'Permanent Address':
        return { wch: 28 };
      case 'Mobile No':
        return { wch: 16 };
      case 'Dt of Posting':
        return { wch: 14 };
      default:
        return { wch: 12 };
    }
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Airmen Biodata Template');

  const finalName = effectiveFilename.replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  const postingColIdx = headers.indexOf('Dt of Posting');
  const colLetter = postingColIdx >= 0 ? XLSX.utils.encode_col(postingColIdx) : 'M';
  applyExcelDateValidation(wbout, colLetter, 2, 500).then((blob) => {
    saveAs(blob, finalName);
  });
}

export function exportManpowerAndNominalRollExcel(
  manpowerData: {
    mechSgt: number;
    mechCpl: number;
    aviSgt: number;
    aviCpl: number;
    gcsSgt: number;
    gcsCpl: number;
    adminSgt: number;
    adminCpl: number;
  },
  airmenList: Array<{
    rank: string;
    name: string;
    trade: string;
    flightName: string;
    disposal?: string;
  }>,
  filename = 'BAF_155_UASU_Effective_Manpower_Nominal_Roll.xlsx'
) {
  const wb = XLSX.utils.book_new();

  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  // Sheet 1: Effective Manpower
  const totalSgt = manpowerData.mechSgt + manpowerData.aviSgt + manpowerData.gcsSgt + manpowerData.adminSgt;
  const totalCpl = manpowerData.mechCpl + manpowerData.aviCpl + manpowerData.gcsCpl + manpowerData.adminCpl;
  const totalAll = totalSgt + totalCpl;

  const identity = getActiveOfficeIdentity();
  const mpRows = [
    [`${identity.officeName} • ${identity.officeBase}`],
    ['EFFECTIVE MANPOWER'],
    ['Flight', 'Sgt', 'Cpl & Below', 'Total'],
    ['Mech', manpowerData.mechSgt, manpowerData.mechCpl, manpowerData.mechSgt + manpowerData.mechCpl],
    ['Avi', manpowerData.aviSgt, manpowerData.aviCpl, manpowerData.aviSgt + manpowerData.aviCpl],
    ['GCS', manpowerData.gcsSgt, manpowerData.gcsCpl, manpowerData.gcsSgt + manpowerData.gcsCpl],
    ['Admin', manpowerData.adminSgt, manpowerData.adminCpl, manpowerData.adminSgt + manpowerData.adminCpl],
    ['Total', totalSgt, totalCpl, totalAll],
  ];

  const wsMp = XLSX.utils.aoa_to_sheet(mpRows);
  for (let r = 0; r <= 1; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (wsMp[addr]) {
      wsMp[addr].s = {
        font: { name: 'Arial', sz: 12, bold: true, underline: r === 1 },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }
  }
  wsMp['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } },
  ];
  for (let r = 2; r < mpRows.length; r++) {
    for (let c = 0; c < 4; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!wsMp[cellAddr]) wsMp[cellAddr] = { t: 's', v: '' };
      const isHeader = r === 2;
      const isTotal = r === mpRows.length - 1;
      wsMp[cellAddr].s = {
        border: thinBorder,
        font: { name: 'Arial', sz: 12, bold: isHeader || isTotal },
        alignment: { vertical: 'center', horizontal: 'center' },
        ...(isHeader ? { fill: { fgColor: { rgb: 'E2E8F0' } } } : {}),
      };
    }
  }
  wsMp['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsMp, 'Effective Manpower');

  // Sheet 2: Nominal Roll
  const nrRows: any[][] = [
    [`${identity.officeName} • ${identity.officeBase}`],
    ['NOMINAL ROLL'],
    ['Ser No', 'Rank', 'Name', 'Trade', 'Flight', 'Disposal'],
  ];

  airmenList.forEach((a, idx) => {
    nrRows.push([
      idx + 1,
      a.rank,
      a.name,
      a.trade,
      a.flightName,
      a.disposal || '-',
    ]);
  });

  const wsNr = XLSX.utils.aoa_to_sheet(nrRows);
  for (let r = 0; r <= 1; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (wsNr[addr]) {
      wsNr[addr].s = {
        font: { name: 'Arial', sz: 12, bold: true, underline: r === 1 },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }
  }
  wsNr['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
  ];
  for (let r = 2; r < nrRows.length; r++) {
    for (let c = 0; c < 6; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!wsNr[cellAddr]) wsNr[cellAddr] = { t: 's', v: '' };
      const isHeader = r === 2;
      wsNr[cellAddr].s = {
        border: thinBorder,
        font: { name: 'Arial', sz: 12, bold: isHeader },
        alignment: { vertical: 'center', horizontal: 'center' },
        ...(isHeader ? { fill: { fgColor: { rgb: 'E2E8F0' } } } : {}),
      };
    }
  }
  wsNr['!cols'] = [{ wch: 10 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 18 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsNr, 'Nominal Roll');

  const finalName = filename.replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  saveAs(blob, finalName);
}

export function exportFlightDutyScheduleExcel(
  matrix: Array<{
    id: string;
    serNo?: number;
    title: string;
    isDisabled?: boolean;
    data: Record<string, number[]>;
  }>,
  flightName: string,
  targetDate?: string,
  filename?: string
) {
  const activeTables = matrix.filter((t) => !t.isDisabled);
  const wb = XLSX.utils.book_new();
  const rows: any[][] = [];

  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  const formattedDate = targetDate || '';
  const identity = getActiveOfficeIdentity();
  rows.push([`${identity.officeName} • ${identity.officeBase}`]);
  rows.push([`${flightName.toUpperCase()} DUTY SCHEDULE (SCALE 1-31)` + (formattedDate ? ` - ${formattedDate}` : '')]);

  const headerRowIndex = rows.length;
  rows.push(['Duty Name / Date', ...Array.from({ length: 31 }, (_, i) => i + 1), 'Total']);

  const startDataRow = rows.length;
  let monthTotal = 0;

  activeTables.forEach((table, tIdx) => {
    const dutyTitle = (table.serNo !== undefined ? `${table.serNo}. ` : `${tIdx + 1}. `) + (table.title || '').replace(/\s*\(\d+\)$/, '').trim();
    const days = (table.data?.[flightName] || Array(31).fill(0)).map(d => Number(d) || 0);
    const rowSum = days.reduce((a, b) => a + b, 0);
    monthTotal += rowSum;
    rows.push([dutyTitle, ...days.map(d => (d > 0 ? d : '')), rowSum]);
  });

  // Daily Total row
  const dailyTotals = Array.from({ length: 31 }, (_, d) => {
    return activeTables.reduce((sum, table) => sum + (Number(table.data?.[flightName]?.[d]) || 0), 0);
  });
  rows.push(['DAILY TOTAL', ...dailyTotals.map(d => (d > 0 ? d : '')), monthTotal]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (let r = 0; r <= 1; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 0 });
    if (ws[addr]) {
      ws[addr].s = {
        font: { name: 'Arial', sz: 12, bold: true, underline: r === 1 },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }
  }
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 32 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 32 } },
  ];

  // Apply styling with alternating Col & Row wise colors
  for (let r = 2; r < rows.length; r++) {
    const isHeader = r === headerRowIndex;
    const isTotalRow = r === rows.length - 1;
    for (let c = 0; c < 33; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellAddr]) ws[cellAddr] = { t: 's', v: '' };

      const isFirstCol = c === 0;
      const isTotalCol = c === 32;
      const isAltRow = (r - startDataRow) % 2 === 1;
      const isAltCol = !isFirstCol && !isTotalCol && c % 2 === 0;

      let fgColor = 'FFFFFF';
      if (isHeader) {
        fgColor = isAltCol ? 'E2E8F0' : 'F1F5F9';
      } else if (isTotalRow) {
        fgColor = isAltCol ? 'CBD5E1' : 'E2E8F0';
      } else if (isTotalCol) {
        fgColor = 'F1F5F9';
      } else if (isAltRow && isAltCol) {
        fgColor = 'E2E8F0';
      } else if (isAltRow) {
        fgColor = 'F1F5F9';
      } else if (isAltCol) {
        fgColor = 'F8FAFC';
      }

      ws[cellAddr].s = {
        border: thinBorder,
        font: {
          name: 'Arial',
          sz: 12,
          bold: isHeader || isTotalRow || isFirstCol || isTotalCol,
        },
        alignment: {
          vertical: 'center',
          horizontal: isFirstCol ? 'left' : 'center',
        },
        fill: { fgColor: { rgb: fgColor } },
      };
    }
  }

  const colWidths = [{ wch: 34 }, ...Array.from({ length: 31 }, () => ({ wch: 5 })), { wch: 9 }];
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, `${flightName} Schedule`);

  const exportFilename = filename || `${flightName}_Duty_Schedule.xlsx`;
  const finalName = exportFilename.replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/octet-stream' });
  saveAs(blob, finalName);
}

export function formatFlightFullName(flight?: string): string {
  if (!flight) return '-';
  const f = flight.trim();
  if (/^adm/i.test(f)) return 'Admin';
  if (/^mec/i.test(f)) return 'Mechanics';
  if (/^avi/i.test(f)) return 'Avionics';
  if (/^gcs/i.test(f)) return 'GCS';
  return f;
}

export const RANK_ORDER: string[] = [
  'MWO',
  'SWO',
  'WO',
  'FLT SGT',
  'Sgt',
  'Cpl',
  'LCpl',
  'LAC',
  'AC-1',
  'AC-2',
  'AC',
];

export const getRankTier = (rankStr?: string): number => {
  if (!rankStr) return 999;
  const formatted = formatRank(rankStr);
  const idx = RANK_ORDER.findIndex((r) => r.toLowerCase() === formatted.toLowerCase());
  return idx !== -1 ? idx : 999;
};

export const getAirmanJoinDateISO = (airman?: Airman | null): string => {
  if (!airman) return '';
  const raw =
    airman.dateJoined ||
    (airman as any)['Dt of Posting'] ||
    (airman as any).dtOfPosting ||
    (airman as any).dateOfPosting ||
    (airman as any).postingDate;
  if (!raw) return '';
  return normalizeDateToISO(raw) || '';
};

export const getAirmanLeftDateISO = (airman?: Airman | null): string => {
  if (!airman) return '';
  const raw =
    airman.dateLeft ||
    (airman as any)['Unit Left date'] ||
    (airman as any).unitLeftDate;
  if (!raw) return '';
  return normalizeDateToISO(raw) || '';
};

export const isAirmanInUnitForMonth = (
  airman?: Airman | null,
  year?: number,
  month?: number
): boolean => {
  if (!airman) return false;

  // If year/month not provided, fallback to active status
  if (!year || !month) return airman.active !== false;

  const monthStartStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthEndStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  const joinDate = getAirmanJoinDateISO(airman);
  const leftDate = getAirmanLeftDateISO(airman);

  // 1. If airman joined AFTER the end of this month -> not reported to unit yet! Exclude!
  if (joinDate && joinDate > monthEndStr) {
    return false;
  }

  // 2. If airman left/posted out BEFORE the beginning of this month -> already left! Exclude!
  if (leftDate && leftDate < monthStartStr) {
    return false;
  }

  // 3. If airman is marked inactive or posted out and has NO explicit leftDate:
  // (e.g. Sgt Sojib who is posted out: active === false or status === 'POSTED_OUT' / 'INACTIVE' / 'DISPOSAL')
  if (airman.active === false && !leftDate) {
    return false;
  }

  const status = (airman as any).status;
  if (status && (status === 'POSTED_OUT' || status === 'INACTIVE' || status === 'DISPOSAL') && !leftDate) {
    return false;
  }

  return true;
};

export interface AttendanceMonthSpec {
  year: number;
  month: number; // 1..12
}

const EXCEL_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function buildMonthlyAttendanceWorksheet(
  airmen: Airman[],
  assignments: DutyAssignment[],
  year: number,
  month: number,
  selectedFlight: string = 'All',
  selectedRank: string = 'All'
) {
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const assignmentMap = new Map<string, DutyAssignment>();
  assignments.forEach((ass) => addAssignmentToMap(assignmentMap, ass));

  const statsList = calculateDutyStats(airmen, assignments, year, month);
  const statsMap = new Map(statsList.map((s) => [s.airmanId, s]));

  const resolveDutyLabel = (airman: Airman, day: number) => {
    const dayStr = day < 10 ? `0${day}` : `${day}`;
    const dateStr = `${monthKey}-${dayStr}`;

    const joinDate = getAirmanJoinDateISO(airman);
    if (joinDate && dateStr < joinDate) return '-';
    const leftDate = getAirmanLeftDateISO(airman);
    if (leftDate && dateStr > leftDate) return '-';

    const ass = resolveAirmanDutyForDate(airman.id, dateStr, assignmentMap);
    const dutyCode = ass?.dutyCode;
    const dutyType = DUTY_TYPE_MAP.get(dutyCode as any);
    const dutyCodeStr = String(dutyCode || '');
    const isOtherDisposal =
      dutyCodeStr.toUpperCase() === 'OTHERS' ||
      dutyCodeStr.toUpperCase() === 'OTHER' ||
      dutyCodeStr.startsWith('OTHERS_');

    if (dutyCode === 'ON_PARADE' || dutyType?.shortName === 'PRD' || dutyType?.shortName === 'P') {
      return 'P';
    }

    if (
      dutyCode === 'CANTEEN' ||
      (dutyCode as string) === 'CTN' ||
      dutyType?.shortName === 'CTN' ||
      ((dutyCode === 'DEPLOYMENT' || dutyCode === 'ATT') && (ass?.notes || '').toLowerCase().includes('canteen'))
    ) {
      return 'CTN';
    }

    if (
      dutyCode === 'BAKE_N_BITE' ||
      (dutyCode as string) === 'BnB' ||
      dutyType?.shortName === 'BnB' ||
      ((dutyCode === 'DEPLOYMENT' || dutyCode === 'ATT') && (ass?.notes || '').toLowerCase().includes('bake'))
    ) {
      return 'BnB';
    }

    if (dutyCode === 'DEPLOYMENT' || dutyCode === 'ATT') {
      const cleanNote = (ass?.notes || '').trim();
      return cleanNote && !cleanNote.toLowerCase().includes('imported')
        ? cleanNote.split(' - ')[0].trim().toUpperCase()
        : 'ATT';
    }

    if (dutyCode === 'DUTY_OFF' || (dutyCode as any) === 'OFF') {
      let offDuty = '';
      if (ass?.notes) {
        const match = ass.notes.match(/\b(NTF|GD|SY|BTF|IDAC|IDA|AIRPORT|APT|AFLD|HALISHAHAR|HAL|ESCT|ESC|ESCORT)\b/i);
        if (match) offDuty = match[1].toUpperCase();
      }
      if (!offDuty) {
        const yestDate = new Date(year, month - 1, day - 1);
        const yDateStr = `${yestDate.getFullYear()}-${String(yestDate.getMonth() + 1).padStart(2, '0')}-${String(yestDate.getDate()).padStart(2, '0')}`;
        const yestAss = resolveAirmanDutyForDate(airman.id, yDateStr, assignmentMap);
        if (yestAss && yestAss.dutyCode && !['ON_PARADE', 'DUTY_OFF', 'OFF'].includes(yestAss.dutyCode as any)) {
          offDuty = yestAss.dutyCode === 'IDA' ? 'IDAC' : yestAss.dutyCode;
        }
      }
      if (offDuty === 'AIRPORT' || offDuty === 'AIRFIELD' || offDuty === 'APT') offDuty = 'AFLD';
      if (offDuty === 'GD' || offDuty === 'SECURITY') offDuty = 'SY';
      if (offDuty === 'ESCORT' || offDuty === 'ESC' || offDuty?.includes('1794394') || (ass?.notes || '').toLowerCase().includes('escort')) offDuty = 'ESCT';
      return offDuty ? `${offDuty}\nOFF` : 'OFF';
    }

    if (dutyCode === 'IDAC' || dutyCode === 'IDA') {
      if ((ass?.notes || '').includes('IDAC A+C')) {
        return 'IDAC "A+C"';
      }
      const s = (ass?.idaShift || '').toLowerCase();
      return s.startsWith('m') ? 'IDAC "A"' : s.startsWith('a') ? 'IDAC "B"' : 'IDAC "C"';
    }

    if (dutyCode === 'LEAVE') {
      const combined = `${ass?.notes || ''} ${(ass as any)?.dutyName || ''}`.toLowerCase();
      if (combined.includes('recreation') || combined.includes('(rl)') || /\brl\b/.test(combined) || combined.includes('rec leave') || combined.includes('rec.')) return 'RL';
      if (combined.includes('sick') || combined.includes('(sl)') || /\bsl\b/.test(combined) || combined.includes('medical')) return 'SL';
      if (combined.includes('annual') || combined.includes('(al)') || /\bal\b/.test(combined)) return 'AL';
      if (combined.includes('casual') || combined.includes('(cl)') || /\bcl\b/.test(combined)) return 'CL';

      // Match Attendance Register UI & Print Preview: contiguous leave span > 7 days => AL, otherwise CL (never LV)
      let streakLen = 1;
      const baseUtcMs = Date.UTC(year, month - 1, day);
      const dayMs = 86400000;
      const formatUtc = (ms: number) => {
        const dt = new Date(ms);
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      };
      for (let step = 1; step <= 60; step++) {
        const prevStr = formatUtc(baseUtcMs - step * dayMs);
        if (resolveAirmanDutyForDate(airman.id, prevStr, assignmentMap)?.dutyCode === 'LEAVE') streakLen++;
        else break;
      }
      for (let step = 1; step <= 60; step++) {
        const nextStr = formatUtc(baseUtcMs + step * dayMs);
        if (resolveAirmanDutyForDate(airman.id, nextStr, assignmentMap)?.dutyCode === 'LEAVE') streakLen++;
        else break;
      }
      return streakLen > 7 ? 'AL' : 'CL';
    }
    if (dutyCode === 'TDY') return 'TDY';
    if ((dutyCode as any) === 'ESCORT' || (dutyCode as any) === 'ESC' || (dutyCode as any) === 'ESCT' || (dutyCode && String(dutyCode).includes('1794394')) || (ass?.notes || '').toLowerCase().includes('escort')) return 'ESCT';
    if (dutyCode === 'GD' || (dutyCode as any) === 'SECURITY') return 'SY';
    if (dutyCode === 'AIRPORT' || (dutyCode as any) === 'APT' || (dutyCode as any) === 'AIRFIELD' || (dutyCode as any) === 'AFLD') return 'AFLD';

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
      return name.toUpperCase();
    }

    let label = dutyType?.shortName || dutyCode || '-';
    if (label === 'APT' || label === 'AIRPORT' || label === 'AIRFIELD') label = 'AFLD';
    if (label === 'GD') label = 'SY';
    if (label === 'IDAC Nt' || label === 'IDAC NT' || label.includes('IDAC Nt')) label = 'IDAC "C"';
    if (label.includes(' OFF')) {
      label = label.replace(/ OFF/g, '\nOFF');
    }
    if (label.startsWith('APT')) label = label.replace(/^APT/, 'AFLD');
    if (label.startsWith('GD')) label = label.replace(/^GD/, 'SY');
    if (label.includes('IDAC Nt')) label = label.replace(/IDAC Nt/g, 'IDAC "C"');
    return label;
  };

  // Filter airmen based on:
  // 1. Belonging to unit in this month (join date <= monthEnd, left date >= monthStart, active)
  // 2. Selected flight / trade
  // 3. Selected rank (Rank & Below)
  const filteredAirmen = airmen.filter((a) => {
    if (!isAirmanInUnitForMonth(a, year, month)) return false;
    if (selectedFlight !== 'All') {
      const fltFull = formatFlightFullName(a.flightName);
      if (fltFull !== selectedFlight && a.flightName !== selectedFlight && a.trade !== selectedFlight) return false;
    }
    if (selectedRank !== 'All') {
      const selectedTier = getRankTier(selectedRank);
      const airmanTier = getRankTier(a.rank);
      if (airmanTier < selectedTier) return false;
    }
    return true;
  });

  const rows: any[][] = [];

  rows.push([getActiveOfficeIdentity().officeName || '155 UASU, BAF']);
  rows.push(['ATTENDANCE REGISTER']);
  rows.push([`Month: ${monthName}`]);
  rows.push([]); // blank spacing row

  const tableHeaderRowIndex = rows.length;
  const headers = [
    'SER',
    'BD NO',
    'RANK',
    'NAME',
    'FLT',
    ...daysArray.map((d) => String(d)),
    'On Parade',
    'SY',
    'BTF',
    'NTF',
    'HAL',
    'AFLD',
    'IDAC "A"',
    'IDAC "B"',
    'IDAC "C"',
    'Duty OFF',
    'Total Duty',
  ];
  rows.push(headers);

  filteredAirmen.forEach((airman, idx) => {
    const stat = statsMap.get(airman.id);
    let pCount = 0;
    let dutyOffCount = 0;
    const dayLabels: string[] = [];

    const presentLabelsSet = new Set<string>(['P', 'CTN', 'BnB']);
    daysArray.forEach((day) => {
      const dayStr = day < 10 ? `0${day}` : `${day}`;
      const dateStr = `${monthKey}-${dayStr}`;
      const ass = resolveAirmanDutyForDate(airman.id, dateStr, assignmentMap);
      const isDep = ass && ['CANTEEN', 'BAKE_N_BITE', 'DEPLOYMENT', 'ATT'].includes(ass.dutyCode);
      const label = resolveDutyLabel(airman, day);
      if (label === 'P' || label === 'CTN' || label === 'BnB' || (isDep && label !== '-')) {
        pCount++;
        presentLabelsSet.add(label);
      }
      if (label.includes('OFF')) dutyOffCount++;
      dayLabels.push(label);
    });

    // Row index in Excel (1-based)
    const excelRowNum = tableHeaderRowIndex + 1 + idx + 1;
    const dayStartCol = getExcelColName(6); // 'F'
    const dayEndCol = getExcelColName(5 + daysInMonth); // e.g. 'AJ' for 31 days
    const dateRange = `${dayStartCol}${excelRowNum}:${dayEndCol}${excelRowNum}`;

    const syColLetter = getExcelColName(7 + daysInMonth); // e.g. 'AL'
    const idacCColLetter = getExcelColName(14 + daysInMonth); // e.g. 'AS'
    const presentFormula = Array.from(presentLabelsSet)
      .map((lbl) => `COUNTIF(${dateRange}, "${lbl.replace(/"/g, '""')}")`)
      .join(' + ');

    const row: any[] = [
      idx + 1,
      String(airman.bdNo || ''),
      formatRank(airman.rank),
      airman.name || airman.fullName || '',
      formatFlightFullName(airman.flightName),
      ...dayLabels,
      { t: 'n', f: presentFormula, v: pCount },
      { t: 'n', f: `COUNTIF(${dateRange}, "SY") + COUNTIF(${dateRange}, "GD")`, v: stat?.totalGD || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "BTF")`, v: stat?.totalBTF || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "NTF")`, v: stat?.totalNTF || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "HAL")`, v: stat?.totalHalishahar || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "AFLD") + COUNTIF(${dateRange}, "APT") + COUNTIF(${dateRange}, "AIRPORT")`, v: stat?.totalAirport || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "*IDAC*A*")`, v: stat?.totalIDACMorning || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "*IDAC*B*")`, v: stat?.totalIDACAfternoon || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "*IDAC*C*") + COUNTIF(${dateRange}, "*IDAC*Nt*")`, v: stat?.totalIDACNight || 0 },
      { t: 'n', f: `COUNTIF(${dateRange}, "*OFF*")`, v: dutyOffCount },
      { t: 'n', f: `SUM(${syColLetter}${excelRowNum}:${idacCColLetter}${excelRowNum})`, v: stat?.totalDutyCount || 0 },
    ];

    rows.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(rows);

  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  const totalCols = headers.length;

  if (ws['A1']) {
    ws['A1'].s = {
      font: { name: 'Arial', sz: 12, bold: true, color: { rgb: '000000' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }
  if (ws['A2']) {
    ws['A2'].s = {
      font: { name: 'Arial', sz: 12, bold: true, underline: true, color: { rgb: '000000' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }
  if (ws['A3']) {
    ws['A3'].s = {
      font: { name: 'Arial', sz: 12, bold: true, color: { rgb: '000000' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },
  ];

  for (let r = tableHeaderRowIndex; r < rows.length; r++) {
    const isHeader = r === tableHeaderRowIndex;
    for (let c = 0; c < totalCols; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!ws[cellAddr]) ws[cellAddr] = { t: 's', v: '' };

      const isName = c === 3;
      const isBdNo = c === 1;

      if (!isHeader && isBdNo) {
        ws[cellAddr].t = 's';
        ws[cellAddr].z = '@';
      }

      ws[cellAddr].s = {
        border: thinBorder,
        font: {
          name: 'Arial',
          sz: 12,
          bold: isHeader || c === 0 || c >= totalCols - 11,
          color: { rgb: '000000' },
        },
        alignment: {
          vertical: 'center',
          horizontal: isName && !isHeader ? 'left' : 'center',
          wrapText: true,
        },
        fill: {
          fgColor: { rgb: isHeader ? 'F1F5F9' : 'FFFFFF' },
        },
      };
    }
  }

  const colWidths = [
    { wch: 6 },  // SER
    { wch: 12 }, // BD NO
    { wch: 10 }, // RANK
    { wch: 18 }, // NAME
    { wch: 14 }, // FLT
    ...Array.from({ length: daysInMonth }, () => ({ wch: 7 })), // Days
    { wch: 12 }, // On Parade
    { wch: 7 },  // SY
    { wch: 7 },  // BTF
    { wch: 7 },  // NTF
    { wch: 7 },  // HAL
    { wch: 7 },  // AFLD
    { wch: 9 },  // IDAC "A"
    { wch: 9 },  // IDAC "B"
    { wch: 9 },  // IDAC "C"
    { wch: 10 }, // Duty OFF
    { wch: 12 }, // Total Duty
  ];
  ws['!cols'] = colWidths;

  const rowHeights: Array<{ hpt: number }> = [];
  rowHeights[0] = { hpt: 22 };
  rowHeights[1] = { hpt: 20 };
  rowHeights[2] = { hpt: 18 };
  rowHeights[3] = { hpt: 10 };
  rowHeights[tableHeaderRowIndex] = { hpt: 28 };
  for (let r = tableHeaderRowIndex + 1; r < rows.length; r++) {
    rowHeights[r] = { hpt: 32 };
  }
  ws['!rows'] = rowHeights;

  ws['!freeze'] = { xSplit: 4, ySplit: 5, topLeftCell: 'E6', activePane: 'bottomRight', state: 'frozen' };
  ws['!views'] = [{ xSplit: 4, ySplit: 5, topLeftCell: 'E6', activePane: 'bottomRight', state: 'frozen' }];

  return ws;
}

export function exportMonthlyAttendanceRegisterExcel(
  airmen: Airman[],
  assignments: DutyAssignment[],
  year: number,
  month: number,
  selectedFlight: string = 'All',
  selectedRank: string = 'All',
  filename?: string
) {
  const wb = XLSX.utils.book_new();
  const ws = buildMonthlyAttendanceWorksheet(airmen, assignments, year, month, selectedFlight, selectedRank);
  const sheetTitle = `${EXCEL_SHORT_MONTHS[month - 1] || 'Month'} ${year}`;
  XLSX.utils.book_append_sheet(wb, ws, sheetTitle);

  const defaultName = `155_UASU_Attendance_Register_${year}_${String(month).padStart(2, '0')}.xlsx`;
  const cleanName = (filename || defaultName).replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  applyFreezePanesToWorkbook(wbout, 4, 5, 'E6')
    .then((blob) => {
      saveAs(blob, cleanName);
    })
    .catch((err) => {
      console.warn('Fallback saving without freeze pane injection:', err);
      const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, cleanName);
    });
}

export function exportMultiMonthAttendanceRegisterExcel(
  airmen: Airman[],
  assignments: DutyAssignment[],
  months: AttendanceMonthSpec[],
  selectedFlight: string = 'All',
  selectedRank: string = 'All',
  filename?: string
) {
  if (!months || months.length === 0) return;

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();

  months.forEach(({ year, month }) => {
    const ws = buildMonthlyAttendanceWorksheet(airmen, assignments, year, month, selectedFlight, selectedRank);
    let baseName = `${EXCEL_SHORT_MONTHS[month - 1] || `M${month}`} ${year}`.slice(0, 31);
    let sheetName = baseName;
    let suffix = 2;
    while (usedNames.has(sheetName)) {
      sheetName = `${baseName.slice(0, 27)} (${suffix++})`;
    }
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const first = months[0];
  const last = months[months.length - 1];
  const defaultName =
    months.length === 12 && first.month === 1 && last.month === 12 && first.year === last.year
      ? `155_UASU_Attendance_Register_${first.year}_Full_Year.xlsx`
      : `155_UASU_Attendance_Register_${first.year}_${String(first.month).padStart(2, '0')}_to_${last.year}_${String(last.month).padStart(2, '0')}.xlsx`;
  const cleanName = (filename || defaultName).replace(/\.(xlsx|csv)$/i, '') + '.xlsx';
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

  applyFreezePanesToWorkbook(wbout, 4, 5, 'E6')
    .then((blob) => {
      saveAs(blob, cleanName);
    })
    .catch((err) => {
      console.warn('Fallback saving without freeze pane injection:', err);
      const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      saveAs(blob, cleanName);
    });
}

async function applyFreezePanesToWorkbook(
  wbout: any,
  xSplit = 4,
  ySplit = 5,
  topLeftCell = 'E6'
): Promise<Blob> {
  try {
    const zip = await JSZip.loadAsync(wbout);
    const sheetPaths = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
    if (sheetPaths.length === 0) {
      return new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    const paneXml = `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="${topLeftCell}" sqref="${topLeftCell}"/>`;

    for (const sheetPath of sheetPaths) {
      const sheetFile = zip.file(sheetPath);
      if (!sheetFile) continue;
      let sheetXml = await sheetFile.async('text');
      const isFirstSheet = sheetPath === 'xl/worksheets/sheet1.xml';
      const tabAttr = isFirstSheet ? ' tabSelected="1"' : '';

      if (sheetXml.includes('<sheetView workbookViewId="0"/>')) {
        sheetXml = sheetXml.replace(
          '<sheetView workbookViewId="0"/>',
          `<sheetView${tabAttr} workbookViewId="0">${paneXml}</sheetView>`
        );
      } else if (sheetXml.includes('</sheetView>')) {
        sheetXml = sheetXml.replace('</sheetView>', `${paneXml}</sheetView>`);
      } else if (sheetXml.includes('<sheetViews>')) {
        sheetXml = sheetXml.replace(
          '<sheetViews>',
          `<sheetViews><sheetView${tabAttr} workbookViewId="0">${paneXml}</sheetView>`
        );
      } else if (sheetXml.includes('<sheetData')) {
        sheetXml = sheetXml.replace(
          '<sheetData',
          `<sheetViews><sheetView${tabAttr} workbookViewId="0">${paneXml}</sheetView></sheetViews><sheetData`
        );
      }

      zip.file(sheetPath, sheetXml);
    }

    const modifiedArray = await zip.generateAsync({ type: 'arraybuffer' });
    return new Blob([modifiedArray], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } catch (err) {
    console.error('Failed to inject freeze panes:', err);
    return new Blob([wbout], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }
}

export interface MultiParadeExcelParams {
  documentHeader: string;
  unitHeader: string;
  periodLabel: string;
  columns: Array<{
    key: string;
    label: string;
    group?: string;
  }>;
  rows: Array<{
    isWeekend?: boolean;
    values: string[];
  }>;
  fileName: string;
  orientation?: 'landscape' | 'portrait';
}

export function exportParadeStateMultiExcel({
  documentHeader,
  unitHeader,
  periodLabel,
  columns,
  rows,
  fileName,
  orientation = 'landscape',
}: MultiParadeExcelParams) {
  const wb = XLSX.utils.book_new();
  const totalCols = Math.max(columns.length, 3);

  const titleRow = [documentHeader, ...Array(totalCols - 1).fill('')];
  const unitRow = [unitHeader, ...Array(totalCols - 1).fill('')];
  const periodRow = [...Array(totalCols - 1).fill(''), periodLabel];

  const hasIdaGroup = columns.some((c) => c.group === 'IDA CENTER Duty');
  const headerRow1 = columns.map((c, idx) => {
    if (c.group === 'IDA CENTER Duty') {
      const firstIdaIdx = columns.findIndex((col) => col.group === 'IDA CENTER Duty');
      return idx === firstIdaIdx ? 'IDA CENTER Duty' : '';
    }
    return c.label;
  });

  const headerRow2 = columns.map((c) => {
    if (c.group === 'IDA CENTER Duty') {
      return c.label;
    }
    return '';
  });

  const aoa: any[][] = [titleRow, unitRow, periodRow, headerRow1];
  if (hasIdaGroup) {
    aoa.push(headerRow2);
  }
  const dataStartRow = aoa.length;
  rows.forEach((r) => {
    aoa.push(r.values.map((v) => (v && v.trim() !== '' ? v : '-')));
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
  ];

  if (totalCols >= 3) {
    merges.push({ s: { r: 2, c: totalCols - 3 }, e: { r: 2, c: totalCols - 1 } });
    // Put periodLabel in the first cell of the merged range on row 2
    const mergeCellAddr = XLSX.utils.encode_cell({ r: 2, c: totalCols - 3 });
    ws[mergeCellAddr] = { t: 's', v: periodLabel };
    const oldPeriodAddr = XLSX.utils.encode_cell({ r: 2, c: totalCols - 1 });
    if (oldPeriodAddr !== mergeCellAddr) {
      ws[oldPeriodAddr] = { t: 's', v: '' };
    }
  }

  if (hasIdaGroup) {
    const firstIdaIdx = columns.findIndex((c) => c.group === 'IDA CENTER Duty');
    let lastIdaIdx = firstIdaIdx;
    for (let i = firstIdaIdx; i < columns.length; i++) {
      if (columns[i].group === 'IDA CENTER Duty') lastIdaIdx = i;
    }
    if (lastIdaIdx > firstIdaIdx) {
      merges.push({ s: { r: 3, c: firstIdaIdx }, e: { r: 3, c: lastIdaIdx } });
    }
    columns.forEach((c, idx) => {
      if (c.group !== 'IDA CENTER Duty') {
        merges.push({ s: { r: 3, c: idx }, e: { r: 4, c: idx } });
      }
    });
  }
  ws['!merges'] = merges;

  const thinBorder = {
    top: { style: 'thin', color: { rgb: '000000' } },
    bottom: { style: 'thin', color: { rgb: '000000' } },
    left: { style: 'thin', color: { rgb: '000000' } },
    right: { style: 'thin', color: { rgb: '000000' } },
  };

  // Style Title, Unit & Period Rows
  for (let c = 0; c < totalCols; c++) {
    const tAddr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[tAddr]) {
      ws[tAddr].s = {
        font: { name: 'Arial', sz: 12, bold: true, underline: true, color: { rgb: '000000' } },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }
    const uAddr = XLSX.utils.encode_cell({ r: 1, c });
    if (ws[uAddr]) {
      ws[uAddr].s = {
        font: { name: 'Arial', sz: 12, bold: true, underline: true, color: { rgb: '000000' } },
        alignment: { vertical: 'center', horizontal: 'center' },
      };
    }
    const pAddr = XLSX.utils.encode_cell({ r: 2, c });
    if (ws[pAddr]) {
      ws[pAddr].s = {
        font: { name: 'Arial', sz: 12, bold: false, color: { rgb: '000000' } },
        alignment: { vertical: 'center', horizontal: 'right' },
      };
    }
  }

  // Style Table Headers
  for (let r = 3; r < dataStartRow; r++) {
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '' };
      ws[addr].s = {
        border: thinBorder,
        font: { name: 'Arial', sz: 12, bold: true, color: { rgb: '000000' } },
        alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
        fill: { fgColor: { rgb: 'E2E8F0' } },
      };
    }
  }

  // Style Data Rows
  const rowHeights: Array<{ hpt: number }> = [
    { hpt: 22 },
    { hpt: 22 },
    { hpt: 20 },
    { hpt: 30 },
    ...(hasIdaGroup ? [{ hpt: 24 }] : []),
  ];

  rows.forEach((rowObj, idx) => {
    const r = dataStartRow + idx;
    let maxLines = 1;
    for (let c = 0; c < totalCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) ws[addr] = { t: 's', v: '-' };
      const valStr = String(ws[addr].v || '-');
      const lines = valStr.split('\n').length;
      if (lines > maxLines) maxLines = lines;

      const isDateOrDay = c <= 1;
      const isEmptyDash = valStr.trim() === '-';
      const isSingleLine = lines === 1;
      ws[addr].s = {
        border: thinBorder,
        font: {
          name: 'Arial',
          sz: 12,
          bold: (c === 0) || Boolean(rowObj.isWeekend),
          color: { rgb: rowObj.isWeekend ? 'DC2626' : '000000' },
        },
        alignment: {
          vertical: 'center',
          horizontal: isDateOrDay || isEmptyDash || isSingleLine ? 'center' : 'left',
          wrapText: true,
        },
      };
    }
    rowHeights[r] = { hpt: Math.max(24, maxLines * 17 + 8) };
  });

  ws['!rows'] = rowHeights;
  ws['!cols'] = columns.map((col, idx) => {
    if (idx === 0) return { wch: 10 };
    if (idx === 1) return { wch: 12 };
    if (col.key === 'onParade') return { wch: 24 };
    if (col.key === 'dutyOff') return { wch: 24 };
    let maxLineLen = col.label.length + 2;
    rows.forEach((r) => {
      const cellStr = r.values[idx] || '';
      cellStr.split('\n').forEach((line) => {
        if (line.length + 2 > maxLineLen) maxLineLen = line.length + 2;
      });
    });
    return { wch: Math.min(32, Math.max(14, maxLineLen)) };
  });

  // Narrow Page Margins (0.5 in)
  ws['!margins'] = {
    left: 0.5,
    right: 0.5,
    top: 0.5,
    bottom: 0.5,
    header: 0.3,
    footer: 0.3,
  };
  ws['!pageSetup'] = {
    orientation,
    paperSize: 9, // A4
    fitToWidth: 1,
    fitToHeight: 0,
  };

  XLSX.utils.book_append_sheet(wb, ws, 'Parade State');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const cleanName = fileName.replace(/\.(xlsx|csv|pdf|docx)$/i, '') + '.xlsx';
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(blob, cleanName);
}


import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
  AlignmentType,
  WidthType,
  BorderStyle,
  PageOrientation,
  TextDirection,
  VerticalAlign,
  HeightRule,
  TableLayoutType,
} from 'docx';
import { addAssignmentToMap, resolveAirmanDutyForDate } from '../data/rosterGenerator';
import { saveFileWithFeedback as saveAs } from './exportNotification';
import { Airman, DutyAssignment, FlightName } from '../types';
import { DutyRatioTable } from '../data/officialDutyRatioMatrix';



import { formatRank } from './rankFormatter';
import { getActiveOfficeIdentity } from '../firebase';
import { PageSetupConfig, getDocxPageSize } from './pageSetup';
export { formatRank };

const formatRunningLetter = (text: string) => {
  if (!text) return '';
  return text.toLowerCase().split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
};

export interface RosterExportItem {
  serNo: string;
  bdNo: string;
  rank: string;
  name: string;
  trade: string;
  block: string;
  mobileNo: string;
  dateStr: string;
  section: string;
}

export interface RosterSectionData {
  title: string;
  subTitle?: string;
  items: RosterExportItem[];
}

const invisibleBorders = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

export async function exportDutyRosterDocx(
  unitHeader: string,
  dateRangeHeader: string,
  sections: RosterSectionData[],
  fileName: string = 'Duty_Roster_155_UASU.docx',
  pageSetup?: PageSetupConfig
) {
  const docChildren: any[] = [
    // Main Unit Header
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'BASE DUTIES: AIRMEN',
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `(${unitHeader})`,
          font: 'Arial',
          bold: true,
          size: 24,
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: `(${dateRangeHeader})`,
          font: 'Arial',
          bold: true,
          size: 24,
        }),
      ],
    }),
  ];

  // Add each section and its table
  for (const section of sections) {
    if (section.items.length === 0) continue;

    // Section Title
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 180, after: section.subTitle ? 40 : 100 },
        children: [
          new TextRun({
            text: section.title,
            font: 'Arial',
            bold: true,
            size: 24,
            underline: {},
          }),
        ],
      })
    );

    if (section.subTitle) {
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
          children: [
            new TextRun({
              text: `(${section.subTitle})`,
              font: 'Arial',
              bold: true,
              size: 24,
            }),
          ],
        })
      );
    }

    // Table Header Row
    const headerRow = new TableRow({ cantSplit: true,
      tableHeader: true,
      children: [
        createHeaderCell('Ser No', 800),
        createHeaderCell('BD No', 1100),
        createHeaderCell('Rank', 900),
        createHeaderCell('Name', 1400),
        createHeaderCell('Trade', 1300),
        createHeaderCell('Block', 1100),
        createHeaderCell('Mobile No', 1600),
        createHeaderCell('Date', 1000),

      ],
    });

    // Table Data Rows
    const dataRows = section.items.map((item, idx) => {
      const displaySer = String(idx + 1).padStart(2, '0');
      return new TableRow({ cantSplit: true,
        children: [
          createDataCell(item.serNo || displaySer, 800, AlignmentType.CENTER),
          createDataCell(item.bdNo, 1100, AlignmentType.CENTER),
          createDataCell(formatRank(item.rank), 900, AlignmentType.CENTER),
          createDataCell(formatRunningLetter(item.name), 1400, AlignmentType.LEFT),
          createDataCell(item.trade, 1300, AlignmentType.CENTER),
          createDataCell(item.block || 'L/O', 1100, AlignmentType.CENTER),
          createDataCell(item.mobileNo || '-', 1600, AlignmentType.CENTER),
          createDataCell(item.dateStr, 1000, AlignmentType.CENTER),

        ],
      });
    });

    const table = new Table({
    layout: TableLayoutType.AUTOFIT,
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows],
    });

    docChildren.push(table);
    docChildren.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
  }

  const rosterPageSize = getDocxPageSize(pageSetup, 'portrait');
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: rosterPageSize.width,
              height: rosterPageSize.height,
              orientation: rosterPageSize.orientation,
            },
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName);
}

export interface IdacRosterRow {
  dateDisplay: string;
  dayDisplay: string;
  morning: string;
  afternoon: string;
  night: string;
}

export async function exportIdacRosterDocx(
  unitHeader: string,
  dateRangeHeader: string,
  rows: IdacRosterRow[],
  fileName: string = 'IDAC_Duty_Roster_155_UASU.docx',
  authorizedBy?: {
    name: string;
    rank: string;
    designation: string;
    unit: string;
    signDigitally?: boolean;
    digitalSignatureText?: string;
  },
  rosterMonthShort?: string,
  pageSetup?: PageSetupConfig
) {
  const isMonthFormat = dateRangeHeader.startsWith('Month:');
  const docChildren: any[] = [
    // Main Title: IDAC DUTY ROSTER : 155 UASU BAF
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `IDAC DUTY ROSTER : ${unitHeader.toUpperCase()}`,
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: isMonthFormat ? dateRangeHeader : `(${dateRangeHeader})`,
          font: 'Arial',
          bold: true,
          size: 24,
        }),
      ],
    }),
  ];

  // Table Header Row
  const headerRow = new TableRow({ cantSplit: true,
    tableHeader: true,
    children: [
      createArialHeaderCell('Date', 1500),
      createArialHeaderCell('Day', 1700),
      createArialHeaderCell('Morning\n(0730F - 1430F)', 2400),
      createArialHeaderCell('Afternoon\n(1430F - 2100F)', 2400),
      createArialHeaderCell('Night\n(2100F - 0730F)', 2800),
    ],
  });

  // Table Data Rows
  const dataRows = rows.map((item) => {
    return new TableRow({ cantSplit: true,
      children: [
        createArialDataCell(item.dateDisplay, 1500, AlignmentType.CENTER),
        createArialDataCell(item.dayDisplay, 1700, AlignmentType.CENTER),
        createArialDataCell(item.morning || '-', 2400, AlignmentType.CENTER),
        createArialDataCell(item.afternoon || '-', 2400, AlignmentType.CENTER),
        createArialDataCell(item.night || '-', 2800, AlignmentType.CENTER),
      ],
    });
  });

  const table = new Table({
    layout: TableLayoutType.AUTOFIT,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  docChildren.push(table);

  if (authorizedBy) {
    docChildren.push(
      new Paragraph({ spacing: { before: 500 } }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 150, after: 30 },
        children: authorizedBy.signDigitally ? [
          new TextRun({
            text: authorizedBy.digitalSignatureText || authorizedBy.name,
            font: 'Arial',
            italics: true,
            bold: true,
            size: 24,
          }),
        ] : [],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: '____________________________',
            font: 'Arial',
            bold: true,
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: authorizedBy.name.toUpperCase(),
            font: 'Arial',
            bold: true,
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: authorizedBy.rank,
            font: 'Arial',
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: authorizedBy.designation,
            font: 'Arial',
            size: 24,
          }),
        ],
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: authorizedBy.unit || getActiveOfficeIdentity().officeName || '155 UASU BAF',
            font: 'Arial',
            bold: true,
            size: 24,
          }),
        ],
      }),
      ...(rosterMonthShort ? [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({
              text: rosterMonthShort,
              font: 'Arial',
              bold: true,
              size: 24,
            }),
          ],
        }),
      ] : [])
    );
  }

  const idacPageSize = getDocxPageSize(pageSetup, 'portrait');
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: idacPageSize.width,
              height: idacPageSize.height,
              orientation: idacPageSize.orientation,
            },
            margin: {
              top: 720,
              right: 720,
              bottom: 720,
              left: 720,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName);
}

// 3. NOMINAL ROLL DIRECTORY EXPORT
export async function exportNominalRollDocx(
  airmen: Airman[],
  fileName: string = 'Nominal_Roll_155_UASU_BAF.docx'
) {
  const docChildren: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'NOMINAL ROLL : AIRMEN',
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: getActiveOfficeIdentity().officeName || '155 UASU BAF',
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
  ];

  const headerRow = new TableRow({ cantSplit: true,
    tableHeader: true,
    children: [
      createArialHeaderCell('Ser', 700),
      createArialHeaderCell('BD No', 1400),
      createArialHeaderCell('Rank', 1000),
      createArialHeaderCell('Full Name', 2200),
      createArialHeaderCell('Trade', 1400),
      createArialHeaderCell('Flight', 1300),
      
    ],
  });

  const dataRows = airmen.map((a, idx) => {
    return new TableRow({ cantSplit: true,
      children: [
        createArialDataCell(String(idx + 1), 700, AlignmentType.CENTER),
        createArialDataCell((a.bdNo || "").replace(/^BD\//i, ''), 1400, AlignmentType.CENTER),
        createArialDataCell(formatRank(a.rank), 1000, AlignmentType.LEFT),
        createArialDataCell(formatRunningLetter(a.fullName || a.name), 2200, AlignmentType.LEFT),
        createArialDataCell(a.trade, 1400, AlignmentType.LEFT),
        createArialDataCell(a.flightName, 1300, AlignmentType.LEFT),
        createArialDataCell(a.addressBlock || '-', 1600, AlignmentType.LEFT),
        createArialDataCell(a.mobileNo || '-', 1500, AlignmentType.CENTER),
        createArialDataCell(a.active !== false ? 'Active' : (a.leaveReason || 'Inactive'), 1200, AlignmentType.CENTER),
      ],
    });
  });

  const table = new Table({
    layout: TableLayoutType.AUTOFIT,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  docChildren.push(table);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 400, right: 400, bottom: 400, left: 400 },
            size: { orientation: PageOrientation.PORTRAIT },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName);
}

// 4. DUTY RATIO MATRIX EXPORT
export async function exportDutyRatioDocx(
  matrix: DutyRatioTable[],
  fileName: string = 'Duty_Ratio_Matrix_155_UASU.docx'
) {
  const docChildren: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: `OFFICIAL DUTY RATIO & FLIGHT QUOTA MATRIX : ${(getActiveOfficeIdentity().officeName || '155 UASU BAF').toUpperCase()}`,
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 180 },
      children: [
        new TextRun({
          text: 'Flight-wise Personnel Allocation Guidelines & Daily Shift Quota',
          font: 'Arial',
          bold: false,
          size: 24,
        }),
      ],
    }),
  ];

  for (const tableData of matrix) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 140, after: 60 },
        children: [
          new TextRun({
            text: tableData.title,
            font: 'Arial',
            bold: true,
            size: 24,
          }),
        ],
      })
    );

    const flights: FlightName[] = ['Mechanics', 'Avionics', 'GCS', 'Admin'];
    const headerRow = new TableRow({ cantSplit: true,
      tableHeader: true,
      children: [
        createArialHeaderCell('Flight Name', 1800),
        ...Array.from({ length: 31 }, (_, i) =>
          createArialHeaderCell(String(i + 1), 240)
        ),
        createArialHeaderCell('Total Duty', 800),
      ],
    });

    const dailySums = Array.from({ length: 31 }, (_, dayIdx) =>
      flights.reduce((sum, fl) => sum + (tableData.data?.[fl]?.[dayIdx] || 0), 0)
    );
    const tableGrandTotal = flights.reduce((sum, fl) => {
      return sum + (tableData.data?.[fl]?.reduce((s, c) => s + c, 0) || 0);
    }, 0);

    const dataRows = flights.map((fl) => {
      const rowVals = tableData.data?.[fl] || [];
      const rowTotal = rowVals.reduce((s, c) => s + c, 0);
      return new TableRow({ cantSplit: true,
        children: [
          createArialDataCell(fl, 1800, AlignmentType.LEFT),
          ...Array.from({ length: 31 }, (_, i) => {
            const v = rowVals[i] !== undefined ? rowVals[i] : 0;
            return createArialDataCell(v > 0 ? String(v) : '-', 240, AlignmentType.CENTER);
          }),
          createArialDataCell(String(rowTotal), 800, AlignmentType.CENTER, true),
        ],
      });
    });

    const dailyTotalRow = new TableRow({ cantSplit: true,
      children: [
        createArialHeaderCell('Daily Total', 1800),
        ...dailySums.map((dSum) =>
          createArialDataCell(dSum > 0 ? String(dSum) : '-', 240, AlignmentType.CENTER, true)
        ),
        createArialDataCell(String(tableGrandTotal), 800, AlignmentType.CENTER, true),
      ],
    });

    const table = new Table({
    layout: TableLayoutType.AUTOFIT,
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [headerRow, ...dataRows, dailyTotalRow],
    });

    docChildren.push(table);
    docChildren.push(new Paragraph({ spacing: { after: 100 }, children: [] }));
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: { top: 500, right: 500, bottom: 500, left: 500 },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName);
}

// 5. SINGLE-DAY PARADE STATE EXPORT
export interface SingleParadeExportParams {
  documentType?: 'PARADE' | 'PT' | 'OTHERS';
  documentTitle?: string;
  dateStr: string;
  flight: string;
  stats: any;
  onParade: Airman[];
  leave: (Airman | { airman: Airman; note?: string })[];
  bakeBite: Airman[];
  tdy: Airman[];
  canteen?: Airman[];
  reception: Airman[];
  dutyOn: { airman: Airman; note?: string }[];
  dutyOff: { airman: Airman; note?: string }[];
  airFdDuty: Airman[];
  essn?: Airman[];
  cmh?: Airman[];
  sickReport?: Airman[];
  drillCatC?: Airman[];
  adminOrder?: Airman[];
  classTrg?: Airman[];
  games?: Airman[];
  absent?: Airman[];
  otherDisposals?: { title: string; airmen: Airman[] }[];
  leftSig?: { rank: string; name: string; desig: string };
  middleSig?: { rank: string; name: string; desig: string };
  rightSig?: { rank: string; name: string; desig: string };
  pageSetup?: PageSetupConfig;
}

export async function exportParadeStateSingleDocx(
  params: SingleParadeExportParams,
  fileName?: string
) {
  const {
    documentType = 'PARADE',
    documentTitle,
    dateStr,
    flight,
    stats,
    onParade,
    leave = [],
    bakeBite = [],
    tdy = [],
    reception = [],
    dutyOn = [],
    dutyOff = [],
    airFdDuty = [],
    essn = [],
    cmh = [],
    sickReport = [],
    drillCatC = [],
    adminOrder = [],
    classTrg = [],
    games = [],
    absent = [],
    otherDisposals = [],
    pageSetup,
  } = params;

  const singlePageSize = getDocxPageSize(pageSetup, 'landscape', 'normal');
  const usableDxa = singlePageSize.usableWidthDxa;

  const isPt = documentType === 'PT';
  const finalTitle = documentTitle || (isPt ? 'PT STATE : AIRMEN' : 'PARADE STATE : AIRMEN');

  const activeOfficeName = getActiveOfficeIdentity().officeName || '155 UASU BAF';
  const unitLabel =
    flight === 'Overall'
      ? activeOfficeName
      : (/\b(flt|flight)\b/i.test(flight) ? flight.toUpperCase() : `${flight.toUpperCase()} FLT`);

  const docChildren: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: finalTitle,
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: unitLabel,
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `Date: ${dateStr}`,
          font: 'Arial',
          bold: true,
          size: 24,
        }),
      ],
    }),
  ];

  // 1st Table: Summary Matrix Table (20 columns exact)
  const statHeaders = [
    'Unit',
    'Total\nstr',
    'Det/\nTdy',
    'Eff\nstr',
    'Leave',
    'Essn',
    'CMH/ BNS/ BSH',
    'Sick\nReport',
    'Drill\nCat-C',
    'Security Duty\nOn/Off',
    'Canteen',
    'Bake &\nBite',
    'K/O &\nReception',
    'Guard of\nHonour',
    isPt ? 'Total Out\nPT' : 'Total Out\nParade',
    isPt ? 'On PT' : 'On Parade',
    'Rmk',
  ];

  const headerRow = new TableRow({ cantSplit: true,
    tableHeader: true,
    height: { value: 1440, rule: HeightRule.ATLEAST },
    children: statHeaders.map((h, i) =>
      i === 0 ? createArialUnitHeaderCell(h, 1500) : createArialVerticalHeaderCell(h, 680)
    ),
  });

  const valOrDash = (v: number) => (v > 0 ? String(v) : '-');

  const dataRow = new TableRow({ cantSplit: true,
    children: [
      createArialDataCell(unitLabel, 1500, AlignmentType.CENTER),
      createArialDataCell(String(stats.totalStr), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.detTdyCount), 680, AlignmentType.CENTER),
      createArialDataCell(String(stats.effStr), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.leaveCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.essnCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.hospitalCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.sickExCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.drillCatCCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.guardDutyCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.canteenCount || 0), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.bakeBiteCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.koReceptionCount), 680, AlignmentType.CENTER),
      createArialDataCell(valOrDash(stats.gamesCount), 680, AlignmentType.CENTER),
      createArialDataCell(String(stats.totalOutPt), 680, AlignmentType.CENTER),
      createArialDataCell(String(stats.onPtParadeCount), 680, AlignmentType.CENTER),
      createArialDataCell('-', 680, AlignmentType.CENTER),
    ],
  });

  const matrixTable = new Table({
    layout: TableLayoutType.AUTOFIT,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, dataRow],
  });

  docChildren.push(matrixTable);

  // Spacing between 1st & 2nd table: Font size 1 (2 half-points) with 0 margin
  docChildren.push(
    new Paragraph({
      spacing: { before: 0, after: 20, line: 20 },
      children: [
        new TextRun({
          text: '',
          font: 'Arial',
          size: 2, // 1pt font size
        }),
      ],
    })
  );

  // Helper to build a disposal section only if it has personnel
  const buildDisposalSection = (title: string, list: { displayName: string }[], isFirst: boolean = false): Paragraph[] => {
    if (!list || list.length === 0) return [];
    return [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: isFirst ? 0 : 80, after: 30 },
        children: [
          new TextRun({
            text: title,
            font: 'Arial',
            bold: true,
            size: 24,
            underline: {},
          }),
        ],
      }),
      ...list.map((item, idx) =>
        new Paragraph({
          spacing: { after: 15, line: 240 },
          children: [
            new TextRun({
              text: `${idx + 1}. ${item.displayName}`,
              font: 'Arial',
              size: 24,
            }),
          ],
        })
      ),
    ];
  };

  // Format airman names
  const toDisplay = (airmenList: Airman[]) => airmenList.map((a) => ({ displayName: `${formatRank(a.rank)} ${formatRunningLetter(a.name)}` }));

  const toLeaveDisplay = (leaveItems: (Airman | { airman: Airman; note?: string })[]) =>
    leaveItems.map((item) => {
      const a = 'airman' in item ? item.airman : item;
      const note = 'airman' in item ? (item.note || '').trim() : '';
      const suffix = note ? ` - ${note}` : '';
      return { displayName: `${formatRank(a.rank)} ${formatRunningLetter(a.name)}${suffix}` };
    });

  // Format Duty Off as: `${rank} ${name} - ${duty} Off`
  const dutyOffDisplay = dutyOff.map((item) => {
    let dutyNote = item.note || 'Sy Off';
    if (dutyNote.toLowerCase().includes('imported')) dutyNote = 'Sy Off';
    if (dutyNote === 'GD Off' || dutyNote === 'GD' || dutyNote === 'SY Off' || dutyNote === 'SY') dutyNote = 'Sy Off';
    dutyNote = dutyNote.replace(/\s+Duty\s+Off$/i, ' Off');
    if (!dutyNote.toLowerCase().endsWith('off')) {
      dutyNote = `${dutyNote.replace(/\s+duty$/i, '').trim()} Off`;
    }
    return {
      displayName: `${formatRank(item.airman.rank)} ${formatRunningLetter(item.airman.name)} - ${dutyNote}`,
    };
  });

  const dutyOnDisplay = dutyOn.map((item) => {
    let dutyNote = item.note && !item.note.toLowerCase().includes('imported') ? item.note : 'Sy Duty';
    if (dutyNote === 'GD' || dutyNote === 'SY' || dutyNote === 'Sy') dutyNote = 'Sy Duty';
    if (!/^(sy\s+duty|office\s+duty|special\s+duty)$/i.test(dutyNote.trim())) {
      dutyNote = dutyNote.replace(/\s+duty$/i, '').trim();
    }
    return {
      displayName: `${formatRank(item.airman.rank)} ${formatRunningLetter(item.airman.name)} - ${dutyNote}`,
    };
  });

  // Col 1: On Parade up to 3 columns (1-15, 16-30, 31-45)
  const onParade1To15 = onParade.slice(0, 15);
  const onParade16To30 = onParade.slice(15, 30);
  const onParade31Plus = onParade.slice(30, 45);
  const numOnParadeCols = onParade.length > 30 ? 3 : onParade.length > 15 ? 2 : 1;

  const col1Children: (Paragraph | Table)[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: isPt ? 'On PT' : 'On Parade',
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
  ];

  if (onParade.length === 0) {
    col1Children.push(
      new Paragraph({
        children: [new TextRun({ text: 'Nil', font: 'Arial', bold: true, size: 24 })],
      })
    );
  } else if (onParade.length <= 15) {
    onParade.forEach((a, idx) => {
      col1Children.push(
        new Paragraph({
          spacing: { after: 15, line: 240 },
          children: [
            new TextRun({
              text: `${idx + 1}. ${formatRank(a.rank)} ${formatRunningLetter(a.name)}`,
              font: 'Arial',
              size: 24,
            }),
          ],
        })
      );
    });
  } else {
    const maxRows = Math.max(onParade1To15.length, onParade16To30.length, onParade31Plus.length);
    const innerRows: TableRow[] = [];
    const subColWidth = 2000;
    for (let i = 0; i < maxRows; i++) {
      const col1Item = onParade1To15[i];
      const col2Item = onParade16To30[i];
      const col3Item = onParade31Plus[i];

      const col1Text = col1Item ? `${i + 1}. ${formatRank(col1Item.rank)} ${formatRunningLetter(col1Item.name)}` : '';
      const col2Text = col2Item ? `${16 + i}. ${formatRank(col2Item.rank)} ${formatRunningLetter(col2Item.name)}` : '';
      const col3Text = col3Item ? `${31 + i}. ${formatRank(col3Item.rank)} ${formatRunningLetter(col3Item.name)}` : '';

      const rowCells: TableCell[] = [
        new TableCell({
          width: { size: subColWidth, type: WidthType.DXA },
          borders: invisibleBorders,
          margins: { top: 0, bottom: 20, left: 0, right: 160 },
          children: [
            new Paragraph({
              spacing: { after: 15, line: 240 },
              children: col1Text ? [new TextRun({ text: col1Text, font: 'Arial', size: 24 })] : [],
            }),
          ],
        }),
        new TableCell({
          width: { size: subColWidth, type: WidthType.DXA },
          borders: invisibleBorders,
          margins: { top: 0, bottom: 20, left: 40, right: 160 },
          children: [
            new Paragraph({
              spacing: { after: 15, line: 240 },
              children: col2Text ? [new TextRun({ text: col2Text, font: 'Arial', size: 24 })] : [],
            }),
          ],
        }),
      ];

      if (numOnParadeCols === 3) {
        rowCells.push(
          new TableCell({
            width: { size: subColWidth, type: WidthType.DXA },
            borders: invisibleBorders,
            margins: { top: 0, bottom: 20, left: 40, right: 160 },
            children: [
              new Paragraph({
                spacing: { after: 15, line: 240 },
                children: col3Text ? [new TextRun({ text: col3Text, font: 'Arial', size: 24 })] : [],
              }),
            ],
          })
        );
      }

      innerRows.push(
        new TableRow({
          cantSplit: true,
          children: rowCells,
        })
      );
    }
    const subColWidths = numOnParadeCols === 3 ? [subColWidth, subColWidth, subColWidth] : [subColWidth, subColWidth];
    const onParadeSubTable = new Table({
      layout: TableLayoutType.FIXED,
      width: { size: subColWidth * numOnParadeCols, type: WidthType.DXA },
      columnWidths: subColWidths,
      borders: invisibleBorders,
      rows: innerRows,
    });
    col1Children.push(onParadeSubTable);
  }

  const col1Width = numOnParadeCols === 3 ? 6040 : numOnParadeCols === 2 ? 4120 : 2200;
  const col1 = new TableCell({
    width: { size: col1Width, type: WidthType.DXA },
    borders: invisibleBorders,
    margins: { top: 40, bottom: 40, left: 40, right: 260 },
    children: col1Children,
  });

  // Col 2 Disposals: CANTEEN, LEAVE, BAKE & BITE, ESSN, CMH, SICK REPORT
  const col2Paragraphs: Paragraph[] = [];
  const secCanteen = buildDisposalSection('Canteen', toDisplay(params.canteen || []), col2Paragraphs.length === 0);
  if (secCanteen.length > 0) col2Paragraphs.push(...secCanteen);
  const secLeave = buildDisposalSection('Leave', toLeaveDisplay(leave), col2Paragraphs.length === 0);
  if (secLeave.length > 0) col2Paragraphs.push(...secLeave);

  const secBakeBite = buildDisposalSection('Bake & Bite', toDisplay(bakeBite), col2Paragraphs.length === 0);
  if (secBakeBite.length > 0) col2Paragraphs.push(...secBakeBite);

  const secEssn = buildDisposalSection('Essn', toDisplay(essn), col2Paragraphs.length === 0);
  if (secEssn.length > 0) col2Paragraphs.push(...secEssn);

  const secCmh = buildDisposalSection('Cmh / Bns / Bsh', toDisplay(cmh), col2Paragraphs.length === 0);
  if (secCmh.length > 0) col2Paragraphs.push(...secCmh);

  const secSick = buildDisposalSection('Sick Report', toDisplay(sickReport), col2Paragraphs.length === 0);
  if (secSick.length > 0) col2Paragraphs.push(...secSick);

  // Col 3 Disposals: ATT/TDY/DETT, RECEPTION, AIR FD DUTY, ADMIN ORDER, CLASS/TRG, DRILL CAT-C, GAMES, ABSENT, Other Disposals
  const col3Paragraphs: Paragraph[] = [];
  const secTdy = buildDisposalSection('Att/Tdy/Dett', toDisplay(tdy), col3Paragraphs.length === 0);
  if (secTdy.length > 0) col3Paragraphs.push(...secTdy);

  const secReception = buildDisposalSection('Reception / K/O', toDisplay(reception), col3Paragraphs.length === 0);
  if (secReception.length > 0) col3Paragraphs.push(...secReception);

  const secAirFd = buildDisposalSection('Air Fd Duty', toDisplay(airFdDuty), col3Paragraphs.length === 0);
  if (secAirFd.length > 0) col3Paragraphs.push(...secAirFd);

  const secAdmin = buildDisposalSection('Admin Order', toDisplay(adminOrder), col3Paragraphs.length === 0);
  if (secAdmin.length > 0) col3Paragraphs.push(...secAdmin);

  const secClass = buildDisposalSection('Class / Trg', toDisplay(classTrg), col3Paragraphs.length === 0);
  if (secClass.length > 0) col3Paragraphs.push(...secClass);

  const secDrill = buildDisposalSection('Drill Cat-C', toDisplay(drillCatC), col3Paragraphs.length === 0);
  if (secDrill.length > 0) col3Paragraphs.push(...secDrill);

  const secGames = buildDisposalSection('Games', toDisplay(games), col3Paragraphs.length === 0);
  if (secGames.length > 0) col3Paragraphs.push(...secGames);

  const secAbsent = buildDisposalSection('Absent', toDisplay(absent), col3Paragraphs.length === 0);
  if (secAbsent.length > 0) col3Paragraphs.push(...secAbsent);

  if (otherDisposals && otherDisposals.length > 0) {
    for (let odIdx = 0; odIdx < otherDisposals.length; odIdx++) {
      const secOther = buildDisposalSection(
        formatRunningLetter(otherDisposals[odIdx].title),
        toDisplay(otherDisposals[odIdx].airmen),
        col3Paragraphs.length === 0
      );
      if (secOther.length > 0) col3Paragraphs.push(...secOther);
    }
  }

  // Build active disposal cells dynamically so empty columns never create huge blank gaps
  const activeCells: TableCell[] = [col1];
  const activeColWidths: number[] = [col1Width];

  if (col2Paragraphs.length > 0) {
    const col2Width = 2150;
    activeCells.push(
      new TableCell({
        width: { size: col2Width, type: WidthType.DXA },
        borders: invisibleBorders,
        margins: { top: 40, bottom: 40, left: 100, right: 160 },
        children: col2Paragraphs,
      })
    );
    activeColWidths.push(col2Width);
  }

  if (col3Paragraphs.length > 0) {
    const col3Width = 2250;
    activeCells.push(
      new TableCell({
        width: { size: col3Width, type: WidthType.DXA },
        borders: invisibleBorders,
        margins: { top: 40, bottom: 40, left: 80, right: 160 },
        children: col3Paragraphs,
      })
    );
    activeColWidths.push(col3Width);
  }

  const hasDutyOn = dutyOnDisplay.length > 0;
  const hasDutyOff = !isPt && dutyOffDisplay.length > 0;
  const usedWidthSoFar = activeColWidths.reduce((sum, w) => sum + w, 0);
  const dutyOnColWidth = 3450;
  const dutyOffColWidth = 3100;

  // Place Duty Off beside Duty On if horizontal space allows (total width fits within ~15900 DXA landscape content width)
  const canPlaceDutyOffBeside = hasDutyOn && hasDutyOff && (usedWidthSoFar + dutyOnColWidth + dutyOffColWidth <= 15900);

  if (canPlaceDutyOffBeside) {
    const secDutyOnSide = buildDisposalSection('Duty On', dutyOnDisplay, true);
    const secDutyOffSide = buildDisposalSection('Duty Off', dutyOffDisplay, true);
    activeCells.push(
      new TableCell({
        width: { size: dutyOnColWidth, type: WidthType.DXA },
        borders: invisibleBorders,
        margins: { top: 40, bottom: 40, left: 80, right: 160 },
        children: secDutyOnSide,
      })
    );
    activeColWidths.push(dutyOnColWidth);

    activeCells.push(
      new TableCell({
        width: { size: dutyOffColWidth, type: WidthType.DXA },
        borders: invisibleBorders,
        margins: { top: 40, bottom: 40, left: 80, right: 40 },
        children: secDutyOffSide,
      })
    );
    activeColWidths.push(dutyOffColWidth);
  } else if (hasDutyOn || hasDutyOff) {
    // Fallback when horizontal space is full: stack Duty Off below Duty On in the same column
    const dutyParagraphs: Paragraph[] = [];
    if (hasDutyOn) {
      dutyParagraphs.push(...buildDisposalSection('Duty On', dutyOnDisplay, dutyParagraphs.length === 0));
    }
    if (hasDutyOff) {
      dutyParagraphs.push(...buildDisposalSection('Duty Off', dutyOffDisplay, dutyParagraphs.length === 0));
    }
    activeCells.push(
      new TableCell({
        width: { size: dutyOnColWidth, type: WidthType.DXA },
        borders: invisibleBorders,
        margins: { top: 40, bottom: 40, left: 80, right: 40 },
        children: dutyParagraphs,
      })
    );
    activeColWidths.push(dutyOnColWidth);
  }

  const rawTotalDisposalWidth = activeColWidths.reduce((sum, w) => sum + w, 0);
  const disposalScale = rawTotalDisposalWidth > usableDxa ? usableDxa / rawTotalDisposalWidth : 1;
  const scaledDisposalWidths = activeColWidths.map((w) => Math.floor(w * disposalScale));
  const totalDisposalWidth = scaledDisposalWidths.reduce((sum, w) => sum + w, 0);
  const disposalTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: totalDisposalWidth, type: WidthType.DXA },
    columnWidths: scaledDisposalWidths,
    borders: invisibleBorders,
    rows: [
      new TableRow({
        cantSplit: true,
        children: activeCells,
      }),
    ],
  });

  docChildren.push(disposalTable);

  // Spacer before Signature Table
  docChildren.push(
    new Paragraph({
      spacing: { before: 360, after: 120 },
      children: [],
    })
  );

  // Signature Table: 3 columns fit within usableDxa
  const leftSigName = params.leftSig?.name || 'MD NAHID HASAN KHAN';
  const leftSigRank = params.leftSig?.rank || 'Sgt';
  const leftSigDesig = params.leftSig?.desig || 'UWO';

  const midSigName = params.middleSig?.name || 'MD SHAHINUZZAMAN';
  const midSigRank = params.middleSig?.rank || 'WO';
  const midSigDesig = params.middleSig?.desig || 'Checked By';

  const rightSigName = params.rightSig?.name || 'MAHIM RAAD SADAT';
  const rightSigRank = params.rightSig?.rank || 'FLT LT';
  const rightSigDesig = params.rightSig?.desig || 'Adjutant';

  const sigTargetWidth = Math.min(15120, usableDxa);
  const sigCol1 = Math.floor(sigTargetWidth * (5040 / 15120));
  const sigCol2 = Math.floor(sigTargetWidth * (5880 / 15120));
  const sigCol3 = sigTargetWidth - sigCol1 - sigCol2;

  const signatureTable = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: sigTargetWidth, type: WidthType.DXA },
    columnWidths: [sigCol1, sigCol2, sigCol3],
    borders: invisibleBorders,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: 5040, type: WidthType.DXA },
            borders: invisibleBorders,
            margins: { top: 80, bottom: 40, left: 40, right: 40 },
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: leftSigName.toUpperCase(),
                    font: 'Arial',
                    bold: true,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: leftSigRank,
                    font: 'Arial',
                    bold: true,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: leftSigDesig,
                    font: 'Arial',
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: activeOfficeName,
                    font: 'Arial',
                    size: 24,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 5880, type: WidthType.DXA },
            borders: invisibleBorders,
            margins: { top: 80, bottom: 40, left: 600, right: 40 },
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: midSigName.toUpperCase(),
                    font: 'Arial',
                    bold: true,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: midSigRank,
                    font: 'Arial',
                    bold: true,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: midSigDesig,
                    font: 'Arial',
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: activeOfficeName,
                    font: 'Arial',
                    size: 24,
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: 4200, type: WidthType.DXA },
            borders: invisibleBorders,
            margins: { top: 80, bottom: 40, left: 40, right: 40 },
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: rightSigName.toUpperCase(),
                    font: 'Arial',
                    bold: true,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: rightSigRank,
                    font: 'Arial',
                    bold: true,
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { after: 15, line: 240 },
                children: [
                  new TextRun({
                    text: rightSigDesig,
                    font: 'Arial',
                    size: 24,
                  }),
                ],
              }),
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: activeOfficeName,
                    font: 'Arial',
                    size: 24,
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  if (flight === 'Overall') {
    docChildren.push(signatureTable);
  } else {
    // Remove extra signature spacer pushed above when signatures are omitted
    docChildren.pop();
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: singlePageSize.width,
              height: singlePageSize.height,
              orientation: singlePageSize.orientation,
            },
            margin: {
              top: singlePageSize.marginDxa,
              right: singlePageSize.marginDxa,
              bottom: singlePageSize.marginDxa,
              left: singlePageSize.marginDxa,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const targetFileName =
    fileName || `${isPt ? 'PT State' : 'Parade State'} - ${flight === 'Overall' ? activeOfficeName : flight + ' Flt'} (${dateStr}).docx`;
  const blob = await Packer.toBlob(doc);
  saveAs(blob, targetFileName);
}

// 6. MULTI-DAY PARADE STATE MATRIX EXPORT
export interface MultiParadeDayItem {
  dateDisplay: string;
  dayDisplay: string;
  baseSec: string;
  btf: string;
  ntf: string;
  airfield: string;
  halishahar: string;
  bakeBite: string;
  tdy: string;
  leave: string;
  idaMorning: string;
  idaAfternoon: string;
  idaNight: string;
  dutyOff: string;
  onParade: string;
}

export async function exportParadeStateMultiDocx(
  unitHeader: string,
  dateRangeHeader: string,
  rows: MultiParadeDayItem[],
  fileName: string = 'Multi_Day_Parade_State_155_UASU.docx',
  leftSig?: { rank: string; name: string; desig: string },
  rightSig?: { rank: string; name: string; desig: string },
  docTitle?: string,
  pageSetup?: PageSetupConfig
) {
  const docChildren: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: docTitle || 'PARADE STATE : AIRMEN',
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {
             type: 'single',
          },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: unitHeader,
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {
             type: 'single',
          },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 80 },
      children: [
        new TextRun({
          text: `Period: ${dateRangeHeader}`,
          font: 'Arial',
          size: 24,
        }),
      ],
    }),
  ];

  // Determine which columns to show
  const hasBaseSec = rows.some((r) => r.baseSec && r.baseSec !== '-');
  const hasBtf = rows.some((r) => r.btf && r.btf !== '-');
  const hasNtf = rows.some((r) => r.ntf && r.ntf !== '-');
  const hasAirfield = rows.some((r) => r.airfield && r.airfield !== '-');
  const hasHalishahar = rows.some((r) => r.halishahar && r.halishahar !== '-');
  const hasBakeBite = rows.some((r) => r.bakeBite && r.bakeBite !== '-');
  const hasTdy = rows.some((r) => r.tdy && r.tdy !== '-');
  const hasLeave = rows.some((r) => r.leave && r.leave !== '-');
  const hasIdaMorn = rows.some((r) => r.idaMorning && r.idaMorning !== '-');
  const hasIdaAft = rows.some((r) => r.idaAfternoon && r.idaAfternoon !== '-');
  const hasIdaNight = rows.some((r) => r.idaNight && r.idaNight !== '-');
  const hasAnyIda = hasIdaMorn || hasIdaAft || hasIdaNight;

  const createCell = (text: string, width: number, vMerge?: 'restart' | 'continue', colSpan: number = 1) => {
    return new TableCell({
      width: { size: width, type: WidthType.DXA },
      columnSpan: colSpan > 1 ? colSpan : undefined,
      verticalMerge: vMerge,
      shading: { fill: 'E2E8F0' },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 80, bottom: 80, left: 50, right: 50 },
      children: text ? text.split('\n').map((l) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: l, font: 'Arial', bold: true, size: 24 })] })) : [],
    });
  };

  // Build Header Row 1
  const h1Cells = [
    createCell('Date', 900, 'restart'),
    createCell('Day', 900, 'restart'),
  ];
  if (hasBaseSec) h1Cells.push(createCell('Base Security\nDuty', 1100, 'restart'));
  if (hasBtf) h1Cells.push(createCell('Base Taskforce\nDuty', 1100, 'restart'));
  if (hasNtf) h1Cells.push(createCell('Najirpara\nTF Duty', 1100, 'restart'));
  if (hasAirfield) h1Cells.push(createCell('Airfield\nDuty', 1000, 'restart'));
  if (hasHalishahar) h1Cells.push(createCell('Halishahar\nDuty', 1000, 'restart'));
  if (hasBakeBite) h1Cells.push(createCell('Bake N\nBite', 900, 'restart'));
  if (hasTdy) h1Cells.push(createCell('Tdy', 900, 'restart'));
  if (hasLeave) h1Cells.push(createCell('Leave', 900, 'restart'));
  
  if (hasAnyIda) {
    let span = 0;
    if (hasIdaMorn) span++;
    if (hasIdaAft) span++;
    if (hasIdaNight) span++;
    h1Cells.push(createCell('IDA CENTER Duty', 1100 * span, undefined, span));
  }
  
  h1Cells.push(createCell('Duty\nOff', 1100, 'restart'));
  h1Cells.push(createCell('On\nParade', 1800, 'restart'));

  const headerRow1 = new TableRow({ cantSplit: true, tableHeader: true, children: h1Cells });

  // Build Header Row 2
  const h2Cells = [
    createCell('', 900, 'continue'),
    createCell('', 900, 'continue'),
  ];
  if (hasBaseSec) h2Cells.push(createCell('', 1100, 'continue'));
  if (hasBtf) h2Cells.push(createCell('', 1100, 'continue'));
  if (hasNtf) h2Cells.push(createCell('', 1100, 'continue'));
  if (hasAirfield) h2Cells.push(createCell('', 1000, 'continue'));
  if (hasHalishahar) h2Cells.push(createCell('', 1000, 'continue'));
  if (hasBakeBite) h2Cells.push(createCell('', 900, 'continue'));
  if (hasTdy) h2Cells.push(createCell('', 900, 'continue'));
  if (hasLeave) h2Cells.push(createCell('', 900, 'continue'));
  
  if (hasAnyIda) {
    if (hasIdaMorn) h2Cells.push(createCell('Morning', 1100));
    if (hasIdaAft) h2Cells.push(createCell('Afternoon', 1100));
    if (hasIdaNight) h2Cells.push(createCell('Night', 1100));
  }
  
  h2Cells.push(createCell('', 1100, 'continue'));
  h2Cells.push(createCell('', 1800, 'continue'));

  const headerRow2 = new TableRow({ cantSplit: true, tableHeader: true, children: h2Cells });

  const dataRows = rows.map((r) => {
    const cells = [
      createArialDataCell(r.dateDisplay, 900, AlignmentType.CENTER),
      createArialDataCell(r.dayDisplay, 900, AlignmentType.CENTER),
    ];
    if (hasBaseSec) cells.push(createArialDataCell(r.baseSec || '-', 1100, AlignmentType.LEFT));
    if (hasBtf) cells.push(createArialDataCell(r.btf || '-', 1100, AlignmentType.LEFT));
    if (hasNtf) cells.push(createArialDataCell(r.ntf || '-', 1100, AlignmentType.LEFT));
    if (hasAirfield) cells.push(createArialDataCell(r.airfield || '-', 1000, AlignmentType.LEFT));
    if (hasHalishahar) cells.push(createArialDataCell(r.halishahar || '-', 1000, AlignmentType.LEFT));
    if (hasBakeBite) cells.push(createArialDataCell(r.bakeBite || '-', 900, AlignmentType.LEFT));
    if (hasTdy) cells.push(createArialDataCell(r.tdy || '-', 900, AlignmentType.LEFT));
    if (hasLeave) cells.push(createArialDataCell(r.leave || '-', 900, AlignmentType.LEFT));
    
    if (hasAnyIda) {
      if (hasIdaMorn) cells.push(createArialDataCell(r.idaMorning || '-', 1100, AlignmentType.LEFT));
      if (hasIdaAft) cells.push(createArialDataCell(r.idaAfternoon || '-', 1100, AlignmentType.LEFT));
      if (hasIdaNight) cells.push(createArialDataCell(r.idaNight || '-', 1100, AlignmentType.LEFT));
    }
    
    cells.push(createArialDataCell(r.dutyOff || '-', 1100, AlignmentType.LEFT));
    cells.push(createArialDataCell(r.onParade || '-', 1800, AlignmentType.LEFT));

    return new TableRow({ cantSplit: true, children: cells });
  });

  const table = new Table({
    layout: TableLayoutType.AUTOFIT,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow1, headerRow2, ...dataRows],
  });

  docChildren.push(table);

  const multiPageSize = getDocxPageSize(pageSetup, 'landscape', 'narrow');
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: multiPageSize.width,
              height: multiPageSize.height,
              orientation: multiPageSize.orientation,
            },
            margin: {
              top: multiPageSize.marginDxa,
              right: multiPageSize.marginDxa,
              bottom: multiPageSize.marginDxa,
              left: multiPageSize.marginDxa,
            },
          },
        },
        children: docChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName);
}

// 7. MONTHLY DUTY REGISTER MATRIX EXPORT
export async function exportMonthlyDutyRegisterDocx(
  airmen: Airman[],
  assignments: DutyAssignment[],
  year: number,
  month: number,
  flightFilter: string = 'All',
  fileName?: string
) {
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: '2-digit',
  });
  const daysInMonth = new Date(year, month, 0).getDate();

  const filteredAirmen =
    flightFilter === 'All'
      ? airmen
      : airmen.filter((a) => a.flightName === flightFilter);

  const assignmentMap = new Map<string, DutyAssignment>();
  assignments.forEach((ass) => addAssignmentToMap(assignmentMap, ass));

  const docChildren: any[] = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: `MONTHLY ATTENDANCE REGISTER : ${(getActiveOfficeIdentity().officeName || '155 UASU BAF').toUpperCase()}`,
          font: 'Arial',
          bold: true,
          size: 24,
          underline: {},
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({
          text: `Month: ${monthName} • Flight: ${flightFilter}`,
          font: 'Arial',
          bold: true,
          size: 24,
        }),
      ],
    }),
  ];

  const headerRow = new TableRow({ cantSplit: true,
    tableHeader: true,
    children: [
      createArialHeaderCell('Ser', 500),
      createArialHeaderCell('BD No', 1100),
      createArialHeaderCell('Rank', 800),
      createArialHeaderCell('Name', 1800),
      createArialHeaderCell('Flt', 700),
      ...Array.from({ length: daysInMonth }, (_, i) =>
        createArialHeaderCell(String(i + 1), 260)
      ),
      createArialHeaderCell('Present', 650),
      createArialHeaderCell('SY', 350),
      createArialHeaderCell('BTF', 350),
      createArialHeaderCell('NTF', 350),
      createArialHeaderCell('Total Duty', 650),
    ],
  });

  const dataRows = filteredAirmen.map((a, idx) => {
    let pCount = 0;
    let gdCount = 0;
    let btfCount = 0;
    let ntfCount = 0;
    let totalDutyCount = 0;

    const dayCells = Array.from({ length: daysInMonth }, (_, i) => {
      const dayNum = i + 1;
      const dStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const ass = assignmentMap.get(`${a.id}_${dStr}`);
      let codeDisplay = 'P';
      if (ass) {
        if (ass.dutyCode === 'GD' || (ass.dutyCode as any) === 'SY') { codeDisplay = 'SY'; gdCount++; totalDutyCount++; }
        else if (ass.dutyCode === 'BTF') { codeDisplay = 'BTF'; btfCount++; totalDutyCount++; }
        else if (ass.dutyCode === 'NTF') { codeDisplay = 'NTF'; ntfCount++; totalDutyCount++; }
        else if (ass.dutyCode === 'HALISHAHAR') { codeDisplay = 'HAL'; totalDutyCount++; }
        else if (ass.dutyCode === 'AIRPORT') { codeDisplay = 'APT'; totalDutyCount++; }
        else if (ass.dutyCode === 'IDAC' || ass.dutyCode === 'IDA') {
          const rawS = (ass.idaShift || (ass as any).shift || '').toString().trim();
          codeDisplay = (/night/i.test(rawS) || rawS === 'C') ? 'I-N' : (/afternoon/i.test(rawS) || rawS === 'B') ? 'I-A' : 'I-M';
          totalDutyCount++;
        } else if (ass.dutyCode === 'LEAVE') codeDisplay = 'L';
        else if (ass.dutyCode === 'TDY') codeDisplay = 'TDY';
        else if (ass.dutyCode === 'DUTY_OFF' || (ass.dutyCode as any) === 'OFF') {
          let offCode = '';
          if (ass.notes) {
            const m = ass.notes.match(/\b(NTF|GD|BTF|IDAC|IDA|AIRPORT|APT|HALISHAHAR|HAL|ESCT|ESC|ESCORT)\b/i);
            if (m) offCode = m[1].toUpperCase();
          }
          if (!offCode) {
            const prevDStr = `${year}-${String(month).padStart(2, '0')}-${String(dayNum - 1).padStart(2, '0')}`;
            const prevAss = assignmentMap.get(`${a.id}_${prevDStr}`);
            if (prevAss && prevAss.dutyCode && !['ON_PARADE', 'DUTY_OFF', 'OFF'].includes(prevAss.dutyCode as any)) {
              offCode = prevAss.dutyCode === 'IDA' ? 'IDAC' : prevAss.dutyCode;
            }
          }
          if (offCode === 'ESCORT' || offCode === 'ESC' || offCode?.includes('1794394')) offCode = 'ESCT';
          codeDisplay = offCode ? `${offCode} OFF` : 'OFF';
        } else if (
          (ass.dutyCode as any) === 'ESCORT' ||
          (ass.dutyCode as any) === 'ESC' ||
          (ass.dutyCode as any) === 'ESCT' ||
          String(ass.dutyCode || '').includes('1794394') ||
          (ass.notes || '').toLowerCase().includes('escort')
        ) {
          codeDisplay = 'ESCT';
        } else if (ass.dutyCode === 'ON_PARADE') {
          codeDisplay = 'P';
          pCount++;
        } else {
          codeDisplay = ass.dutyCode || 'P';
          if (codeDisplay === 'P') pCount++;
        }
      } else {
        codeDisplay = 'P';
        pCount++;
      }
      return createArialDataCell(codeDisplay, 260, AlignmentType.CENTER);
    });

    return new TableRow({ cantSplit: true,
      children: [
        createArialDataCell(String(idx + 1), 500, AlignmentType.CENTER),
        createArialDataCell(a.bdNo, 1100, AlignmentType.CENTER),
        createArialDataCell(formatRank(a.rank), 800, AlignmentType.CENTER),
        createArialDataCell(formatRunningLetter(a.name), 1800, AlignmentType.LEFT),
        createArialDataCell(a.flightName.slice(0, 3), 700, AlignmentType.CENTER),
        ...dayCells,
        createArialDataCell(String(pCount), 650, AlignmentType.CENTER),
        createArialDataCell(String(gdCount), 350, AlignmentType.CENTER),
        createArialDataCell(String(btfCount), 350, AlignmentType.CENTER),
        createArialDataCell(String(ntfCount), 350, AlignmentType.CENTER),
        createArialDataCell(String(totalDutyCount), 650, AlignmentType.CENTER),
      ],
    });
  });

  const table = new Table({
    layout: TableLayoutType.AUTOFIT,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  docChildren.push(table);

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 24,
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906,
              height: 16838,
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: { top: 400, right: 400, bottom: 400, left: 400 },
          },
        },
        children: docChildren,
      },
    ],
  });

  const targetName =
    fileName || `Duty_Register_${monthName.replace(/\s+/g, '_')}_${flightFilter}.docx`;
  const blob = await Packer.toBlob(doc);
  saveAs(blob, targetName);
}

// -------------------------------------------------------------
// Cell Formatting Helpers
// -------------------------------------------------------------
function createArialUnitHeaderCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 40, right: 40 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            font: 'Arial',
            bold: true,
            size: 24,
          }),
        ],
      }),
    ],
  });
}

function createArialVerticalHeaderCell(text: string, width: number) {
  const cleanText = text.replace(/\n/g, ' ');
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    textDirection: TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 30, right: 30 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: cleanText,
            font: 'Arial',
            bold: true,
            size: 24, // 12pt
          }),
        ],
      }),
    ],
  });
}

function createArialHeaderCell(text: string, width: number) {
  const lines = text.split('\n');
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: 'E2E8F0' },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 50, right: 50 },
    children: lines.map(
      (l) =>
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: l,
              font: 'Arial',
              bold: true,
              size: 24, // 12pt
            }),
          ],
        })
    ),
  });
}

function createArialDataCell(
  text: string,
  width: number,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType],
  bold: boolean = false
) {
  const lines = (text || '').split('\n');
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 50, right: 50 },
    children: lines.map(
      (l) =>
        new Paragraph({
          alignment,
          children: [
            new TextRun({
              text: l,
              font: 'Arial',
              bold: bold,
              size: 24, // 12pt
            }),
          ],
        })
    ),
  });
}

function createHeaderCell(text: string, width: number) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: { fill: 'E2E8F0' },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 80, bottom: 80, left: 60, right: 60 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text,
            font: 'Arial',
            bold: true,
            size: 24,
          }),
        ],
      }),
    ],
  });
}

function createDataCell(
  text: string,
  width: number,
  alignment: (typeof AlignmentType)[keyof typeof AlignmentType]
) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 60, bottom: 60, left: 60, right: 60 },
    children: [
      new Paragraph({
        alignment,
        children: [
          new TextRun({
            text: text || '',
            font: 'Arial',
            size: 24,
          }),
        ],
      }),
    ],
  });
}

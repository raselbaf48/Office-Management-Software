import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Airman } from '../types';
import { Printer, X, Download } from 'lucide-react';
import { exportHtmlToWord } from '../utils/htmlExport';
import { exportAirmenExcel, formatShortDate } from '../utils/csvExport';
import { FileSpreadsheet } from 'lucide-react';
import { getSavedPreparedBy, getSavedAuthorizedBy } from './SignatureConfigModal';
import { formatRank, formatAirmanName } from '../utils/rankFormatter';
import { getActiveOfficeIdentity, doesOfficeHaveFlights } from '../firebase';
interface PrintableNominalRollModalProps {
  airmen: Airman[];
  title?: string;
  variant?: 'nominal' | 'biodata';
  onClose: () => void;
}

export const PrintableNominalRollModal: React.FC<PrintableNominalRollModalProps> = ({
  airmen,
  title,
  variant = "nominal",
  onClose,
}) => {
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>(
    variant === 'biodata' ? 'landscape' : 'portrait'
  );

  const officeIdentity = getActiveOfficeIdentity();
  const officeHasFlights = doesOfficeHaveFlights(airmen);
  const safeOfficeFileCode = (officeIdentity.officeName || '155_UASU_BAF').replace(/[^a-zA-Z0-9_-]+/g, '_');

  const isBlankCell = (val?: string | null): boolean => {
    if (val === undefined || val === null) return true;
    const s = String(val).trim();
    if (!s) return true;
    const low = s.toLowerCase();
    return s === '-' || s === '—' || s === '--' || low === 'n/a' || low === 'na' || low === 'none';
  };

  const showTradeCol = airmen.some((a) => !isBlankCell(a.trade));
  const showFlightCol = officeHasFlights && airmen.some((a) => !isBlankCell(a.flightName));
  const showBloodGroupCol = variant === 'biodata' && airmen.some((a) => !isBlankCell(a.bloodGroup));
  const showPresentAddressCol = airmen.some((a) => !isBlankCell(a.addressBlock));
  const showPermanentAddressCol = variant === 'biodata' && airmen.some((a) => !isBlankCell(a.permanentAddress));
  const showMobileCol = airmen.some((a) => !isBlankCell(a.mobileNo));
  const showPostingDateCol =
    variant === 'biodata' &&
    airmen.some((a) => !isBlankCell(a.dateJoined) && !isBlankCell(formatShortDate(a.dateJoined)));

  const visibleColCount =
    4 + // Ser, BD No, Rank, Full Name
    (showTradeCol ? 1 : 0) +
    (showFlightCol ? 1 : 0) +
    (showBloodGroupCol ? 1 : 0) +
    (showPresentAddressCol ? 1 : 0) +
    (showPermanentAddressCol ? 1 : 0) +
    (showMobileCol ? 1 : 0) +
    (showPostingDateCol ? 1 : 0);

  const preparedBy = getSavedPreparedBy();
  const authorizedBy = getSavedAuthorizedBy();

  const docHeading = variant === 'biodata' ? 'BIODATA REGISTER : AIRMEN' : 'NOMINAL ROLL : AIRMEN';
  const modalHeading = variant === 'biodata' ? 'OFFICIAL BIODATA REGISTER PRINT PREVIEW' : 'OFFICIAL NOMINAL ROLL PRINT PREVIEW';
  const defaultDocName = variant === 'biodata' ? `Biodata_Register_${safeOfficeFileCode}` : `Nominal_Roll_${safeOfficeFileCode}`;

  const getPdfTitle = () => 
    variant === 'biodata'
      ? `Biodata_Register_${new Date().toISOString().split('T')[0]}`
      : `Nominal_Roll_${new Date().toISOString().split('T')[0]}`;

  const handleExportExcel = () => {
    const filename = variant === 'biodata' 
      ? `Biodata_Register_${new Date().toISOString().split('T')[0]}.xlsx`
      : `Nominal_Roll_${new Date().toISOString().split('T')[0]}.xlsx`;
    exportAirmenExcel(airmen, variant, filename);
  };

  const handlePrint = () => {
    document.title = getPdfTitle();
    setTimeout(() => {
      window.print();
    }, 100);
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-100 print:bg-white animate-fadeIn print:block print:static print:h-auto print:overflow-visible text-black">
      {/* Top Header Controls (Hidden on Print) */}
      <div className="flex-none bg-slate-900 border-b border-slate-700 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-0 shadow-2xl print:hidden z-10">
        <div className="flex items-center space-x-3 text-white">
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xs sm:text-sm font-black tracking-widest leading-tight">
              {modalHeading}
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">
              Use 'Save as PDF' or Print directly
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto justify-between sm:justify-start">
          {/* Page Orientation Selector */}
          <div className="flex items-center bg-slate-800/90 p-1 rounded-xl border border-slate-700">
            <button
              type="button"
              onClick={() => setOrientation('portrait')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                orientation === 'portrait'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Portrait mode"
            >
              Portrait
            </button>
            <button
              type="button"
              onClick={() => setOrientation('landscape')}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                orientation === 'landscape'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Landscape mode (Recommended for Biodata)"
            >
              Landscape
            </button>
          </div>

          <button
            onClick={() => exportHtmlToWord('print-nominal-roll-content', `${defaultDocName}.doc`, orientation)}
            className="flex items-center justify-center space-x-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer border border-slate-700"
          >
            <Download className="w-4 h-4" />
            <span className="text-center">Export Doc</span>
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center justify-center space-x-1.5 px-3 py-2 bg-emerald-800/80 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer border border-emerald-600/40"
            title="Export full register as formatted Excel spreadsheet"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-300" />
            <span className="text-center">Export Excel</span>
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center justify-center space-x-1.5 px-4 sm:px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-xs sm:text-sm shadow-lg shadow-emerald-900/20 transition-all cursor-pointer"
          >
            <Printer className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-center">Official Print</span>
          </button>
        </div>
      </div>

      {/* Printable Content Area */}
      <div className="flex-1 overflow-auto print:overflow-visible bg-slate-200/60 print:bg-white p-3 sm:p-6 print:p-0 flex justify-center print:block">
        <style type="text/css">
          {`
            @media print {
              @page { 
                size: ${orientation}; 
                margin: 6mm; 
              }
              body {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
          `}
        </style>
        <div 
          id="print-nominal-roll-content" 
          className={`mx-auto h-fit shrink-0 bg-white text-black print:shadow-none print:border-none border border-slate-300 shadow-2xl p-4 sm:p-8 print:p-0 print:m-0 transition-all ${
            orientation === 'landscape'
              ? 'w-full sm:w-[297mm] min-h-[210mm] print:w-full print:min-h-0'
              : 'w-full sm:w-[210mm] min-h-[297mm] print:w-full print:min-h-0'
          }`}
        >
          <div className="w-full">
            {/* Document Header */}
            <div className="text-center mb-5">
              <h1 className="text-sm sm:text-base font-black underline leading-snug tracking-wide">
                {docHeading}<br />
                {officeIdentity.officeName}
              </h1>
            </div>

            {/* Matrix Table */}
            <div className="w-full overflow-x-auto print:overflow-visible">
              <table 
                className={`no-zebra w-full text-center border-collapse border border-black font-sans ${
                  orientation === 'landscape' ? 'text-[11px]' : variant === 'biodata' ? 'text-[9.5px]' : 'text-[11px]'
                }`} 
                style={{ pageBreakInside: 'auto' }}
              >
                <thead className="bg-slate-100 print:bg-white text-black" style={{ backgroundColor: '#f1f5f9', color: '#000000', display: 'table-header-group' }}>
                  <tr>
                    <th className="p-1 sm:p-1.5 border border-black font-bold text-center w-7">Ser</th>
                    <th className="p-1 sm:p-1.5 border border-black font-bold text-center whitespace-nowrap">BD No</th>
                    <th className="p-1 sm:p-1.5 border border-black font-bold text-center whitespace-nowrap">Rank</th>
                    <th className="p-1 sm:p-1.5 border border-black font-bold text-left">Full Name</th>
                    {showTradeCol && <th className="p-1 sm:p-1.5 border border-black font-bold text-center">Trade</th>}
                    {showFlightCol && <th className="p-1 sm:p-1.5 border border-black font-bold text-center">Flight</th>}
                    {showBloodGroupCol && <th className="p-1 sm:p-1.5 border border-black font-bold text-center whitespace-nowrap">Blood Group</th>}
                    {showPresentAddressCol && (
                      <th className="p-1 sm:p-1.5 border border-black font-bold text-left">{variant === 'biodata' ? 'Present Address' : 'Address'}</th>
                    )}
                    {showPermanentAddressCol && <th className="p-1 sm:p-1.5 border border-black font-bold text-left">Permanent Address</th>}
                    {showMobileCol && <th className="p-1 sm:p-1.5 border border-black font-bold text-center whitespace-nowrap">Mobile No</th>}
                    {showPostingDateCol && <th className="p-1 sm:p-1.5 border border-black font-bold text-center whitespace-nowrap">Dt of Posting</th>}
                  </tr>
                </thead>
                <tbody style={{ display: 'table-row-group' }}>
                  {airmen.map((airman, idx) => (
                    <tr key={`${airman.id}-${idx}`} className="even:bg-gray-100 print:even:bg-gray-100" style={{ pageBreakInside: 'avoid', pageBreakAfter: 'auto' }}>
                      <td className="p-1 sm:p-1.5 border border-black text-center font-mono">
                        {idx + 1}
                      </td>
                      <td className="p-1 sm:p-1.5 border border-black text-center font-mono whitespace-nowrap">
                        {airman.bdNo.replace(/^BD\//i, '')}
                      </td>
                      <td className="p-1 sm:p-1.5 border border-black text-center whitespace-nowrap">
                        {formatAirmanName(airman.rank)}
                      </td>
                      <td className="p-1 sm:p-1.5 border border-black text-left font-semibold">
                        {airman.fullName || airman.name}
                      </td>
                      {showTradeCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-left whitespace-nowrap">
                          {airman.trade}
                        </td>
                      )}
                      {showFlightCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-left whitespace-nowrap">
                          {airman.flightName}
                        </td>
                      )}
                      {showBloodGroupCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-center whitespace-nowrap font-bold">
                          {airman.bloodGroup || '-'}
                        </td>
                      )}
                      {showPresentAddressCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-left">
                          <div className="leading-tight whitespace-normal min-w-[90px]">
                            {airman.addressBlock ? (
                              airman.addressBlock.includes("Mess, Block No:") ? (
                                (() => {
                                  const [messName, rawBlk] = airman.addressBlock.split(", Block No:");
                                  const cleanBlk = (rawBlk || '').replace(/^[.\-\s]+|[.\-\s]+$/g, '').trim();
                                  if (!cleanBlk) {
                                    return <span className="block">{messName}</span>;
                                  }
                                  return (
                                    <>
                                      <span className="block">{messName},</span>
                                      <span className="block text-[10px] text-slate-500 font-bold">Block No: {cleanBlk}</span>
                                    </>
                                  );
                                })()
                              ) : (
                                <span className="block">{airman.addressBlock}</span>
                              )
                            ) : '-'}
                          </div>
                        </td>
                      )}
                      {showPermanentAddressCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-left">
                          <div className="leading-tight whitespace-normal min-w-[100px]">
                            {airman.permanentAddress ? (
                              airman.permanentAddress.includes(';') ? (
                                (() => {
                                  const parts = airman.permanentAddress.split(';').map(x => x.trim()).filter(Boolean);
                                  const rows = [];
                                  for (let i = 0; i < parts.length; i += 2) {
                                    rows.push(parts.slice(i, i + 2).join('; '));
                                  }
                                  return rows.map((r, i) => <span key={i} className="block">{r}</span>);
                                })()
                              ) : (
                                <span className="block">{airman.permanentAddress}</span>
                              )
                            ) : '-'}
                          </div>
                        </td>
                      )}
                      {showMobileCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-center font-mono whitespace-nowrap">
                          {airman.mobileNo || '-'}
                        </td>
                      )}
                      {showPostingDateCol && (
                        <td className="p-1 sm:p-1.5 border border-black text-center whitespace-nowrap font-mono font-medium">
                          {formatShortDate(airman.dateJoined)}
                        </td>
                      )}
                    </tr>
                  ))}
                  {airmen.length === 0 && (
                    <tr>
                      <td colSpan={visibleColCount} className="p-4 text-center text-slate-500 font-medium">
                        No airmen found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
          </div>
        </div>
      </div>
    </div>
  , document.body);
};

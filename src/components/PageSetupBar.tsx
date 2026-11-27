import React from 'react';
import { Sliders, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { PAPER_SIZE_OPTIONS, PageSetupConfig, PaperSize, PageOrientationType } from '../utils/pageSetup';

interface PageSetupBarProps {
  value: PageSetupConfig;
  onChange: (next: PageSetupConfig) => void;
  defaultLabel?: string;
}

export const PageSetupBar: React.FC<PageSetupBarProps> = ({ value, onChange, defaultLabel }) => {
  const handlePaperChange = (paperSize: PaperSize) => {
    onChange({ ...value, paperSize });
  };

  const handleOrientationChange = (orientation: PageOrientationType) => {
    onChange({ ...value, orientation });
  };

  const activePaperLabel =
    PAPER_SIZE_OPTIONS.find((p) => p.value === value.paperSize)?.label || 'A4';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-2.5 shadow-xs print:hidden">
      <div className="flex items-center space-x-2">
        <Sliders className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        <span className="text-xs font-black text-slate-900 dark:text-white tracking-wide">
          Page Setup
        </span>
        <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          {activePaperLabel} • {value.orientation === 'landscape' ? 'Landscape' : 'Portrait'}
        </span>
        {defaultLabel && (
          <span className="hidden sm:inline text-[11px] font-medium text-slate-400 dark:text-slate-500">
            ({defaultLabel})
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {/* Paper Size Selector */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold space-x-1">
          <span className="px-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">Size:</span>
          {PAPER_SIZE_OPTIONS.map((opt) => {
            const active = value.paperSize === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePaperChange(opt.value)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  active
                    ? 'bg-emerald-600 text-white shadow-xs font-black'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Orientation Toggle (Landscape / Portrait) */}
        <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold space-x-1">
          <button
            type="button"
            onClick={() => handleOrientationChange('landscape')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
              value.orientation === 'landscape'
                ? 'bg-emerald-600 text-white shadow-xs font-black'
                : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <RectangleHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>Landscape</span>
          </button>
          <button
            type="button"
            onClick={() => handleOrientationChange('portrait')}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
              value.orientation === 'portrait'
                ? 'bg-emerald-600 text-white shadow-xs font-black'
                : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <RectangleVertical className="w-3.5 h-3.5 shrink-0" />
            <span>Portrait</span>
          </button>
        </div>
      </div>
    </div>
  );
};

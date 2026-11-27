import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, AlertCircle, X, Download } from 'lucide-react';
import { ExportFeedbackDetail } from '../utils/exportNotification';

export const ExportFeedbackPopup: React.FC = () => {
  const [feedback, setFeedback] = useState<ExportFeedbackDetail | null>(null);

  useEffect(() => {
    let dismissTimer: number | undefined;

    const handleEvent = (e: Event) => {
      const detail = (e as CustomEvent<ExportFeedbackDetail>).detail;
      if (!detail) return;
      if (dismissTimer) {
        window.clearTimeout(dismissTimer);
        dismissTimer = undefined;
      }
      setFeedback(detail);

      if (detail.status === 'success') {
        dismissTimer = window.setTimeout(() => {
          setFeedback((curr) => (curr && curr.id === detail.id ? null : curr));
        }, 3800);
      } else if (detail.status === 'error') {
        dismissTimer = window.setTimeout(() => {
          setFeedback((curr) => (curr && curr.id === detail.id ? null : curr));
        }, 5000);
      }
    };

    window.addEventListener('baf_export_feedback', handleEvent as EventListener);
    return () => {
      if (dismissTimer) window.clearTimeout(dismissTimer);
      window.removeEventListener('baf_export_feedback', handleEvent as EventListener);
    };
  }, []);

  if (!feedback || typeof document === 'undefined') return null;

  if (feedback.status === 'loading') {
    return createPortal(
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] print:hidden pointer-events-none">
        <div className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-slate-900/95 text-white border border-emerald-500/40 shadow-2xl backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-5 h-5 text-emerald-400 animate-spin shrink-0" />
          <div className="text-left">
            <div className="text-xs font-black tracking-wide uppercase text-emerald-300">
              Generating {feedback.formatLabel}...
            </div>
            <div className="text-[11px] text-slate-300 font-medium truncate max-w-[280px]">
              {feedback.fileName}
            </div>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  if (feedback.status === 'error') {
    return createPortal(
      <div className="fixed inset-0 z-[9999] print:hidden flex items-center justify-center bg-slate-950/40 backdrop-blur-[2px] p-4">
        <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-rose-500/40 rounded-2xl shadow-2xl p-5 text-center animate-in zoom-in-95">
          <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/70 flex items-center justify-center mb-3">
            <AlertCircle className="w-7 h-7 text-rose-600 dark:text-rose-400" />
          </div>
          <h3 className="text-base font-black text-slate-900 dark:text-white">
            Export Failed
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 break-words">
            {feedback.message}
          </p>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="mt-4 w-full py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] print:hidden flex items-center justify-center bg-slate-950/35 backdrop-blur-[2px] p-4"
      onClick={() => setFeedback(null)}
    >
      <div
        className="relative w-full max-w-sm bg-white dark:bg-slate-900 border-2 border-emerald-500/50 rounded-2xl shadow-2xl p-6 text-center animate-success-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setFeedback(null)}
          className="absolute top-3 right-3 p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mx-auto w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/70 flex items-center justify-center mb-3 ring-4 ring-emerald-500/20">
          <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
        </div>

        <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
          Download Successful!
        </h3>
        <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center justify-center gap-1">
          <Download className="w-3.5 h-3.5" />
          <span>{feedback.formatLabel} File Downloaded</span>
        </p>

        <div className="mt-3 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-[11px] font-mono text-slate-700 dark:text-slate-200 break-all">
          {feedback.fileName}
        </div>

        <button
          type="button"
          onClick={() => setFeedback(null)}
          className="mt-4 w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black shadow-md shadow-emerald-600/25 transition-all cursor-pointer"
        >
          OK
        </button>
      </div>
    </div>,
    document.body
  );
};

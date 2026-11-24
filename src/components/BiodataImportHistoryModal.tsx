import React, { useState, useEffect } from 'react';
import { Airman, BiodataImportBatch } from '../types';
import { localDb } from '../services/localDatabase';
import { formatRank } from '../utils/rankFormatter';
import {
  X,
  History,
  FileSpreadsheet,
  Clipboard,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Users,
  Clock,
  RefreshCw,
} from 'lucide-react';

interface BiodataImportHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentAirmen: Airman[];
  onDataChanged: () => void;
}

export const BiodataImportHistoryModal: React.FC<BiodataImportHistoryModalProps> = ({
  isOpen,
  onClose,
  currentAirmen,
  onDataChanged,
}) => {
  const [batches, setBatches] = useState<BiodataImportBatch[]>([]);
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [batchToRemove, setBatchToRemove] = useState<BiodataImportBatch | null>(null);
  const [singleItemToRemove, setSingleItemToRemove] = useState<{
    batchId: string;
    batchFileName: string;
    item: BiodataImportBatch['airmenSummary'][number];
  } | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadBatches = () => {
    setBatches(localDb.getBiodataImportHistory());
  };

  useEffect(() => {
    if (isOpen) {
      loadBatches();
      setFeedbackMsg(null);
      setBatchToRemove(null);
      setSingleItemToRemove(null);
    }
  }, [isOpen, currentAirmen]);

  if (!isOpen) return null;

  const currentIdSet = new Set(currentAirmen.map((a) => a.id));
  const currentBdSet = new Set(
    currentAirmen
      .map((a) => String(a.bdNo || a.id || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim())
      .filter(Boolean)
  );

  const countStillPresent = (batch: BiodataImportBatch): number => {
    let count = 0;
    const seen = new Set<string>();
    (batch.airmenSummary || []).forEach((s) => {
      const bd = String(s.bdNo || '').replace(/^BD\/?/i, '').replace(/\D/g, '').trim();
      const key = bd || s.id;
      if (seen.has(key)) return;
      seen.add(key);
      if (currentIdSet.has(s.id) || (bd && currentBdSet.has(bd))) {
        count++;
      }
    });
    return count;
  };

  const formatTimestamp = (iso: string) => {
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

  const handleConfirmRemove = async () => {
    if (!batchToRemove) return;
    setIsRemoving(true);
    setFeedbackMsg(null);

    try {
      const result = localDb.removeBiodataImportBatch(batchToRemove.id);
      if (result.success) {
        const msg =
          result.removedCount > 0
            ? `"${batchToRemove.fileName}" থেকে ইমপোর্ট করা ${result.removedCount} জন এয়ারম্যান সফলভাবে রিমুভ করা হয়েছে।`
            : `"${batchToRemove.fileName}" ইম্পোর্ট হিস্ট্রি সফলভাবে মুছে ফেলা হয়েছে।`;
        setFeedbackMsg({ type: 'success', text: msg });
        setBatchToRemove(null);
        loadBatches();
        onDataChanged();
        window.dispatchEvent(new CustomEvent('baf_state_updated'));
      } else {
        setFeedbackMsg({ type: 'error', text: 'ইম্পোর্ট ব্যাচটি পাওয়া যায়নি বা রিমুভ করা যায়নি।' });
        setBatchToRemove(null);
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Remove failed.' });
      setBatchToRemove(null);
    } finally {
      setIsRemoving(false);
    }
  };

  const handleConfirmRemoveSingle = async () => {
    if (!singleItemToRemove) return;
    setIsRemoving(true);
    setFeedbackMsg(null);

    try {
      const { batchId, item } = singleItemToRemove;
      const result = localDb.removeSingleAirmanFromBiodataImportBatch(batchId, item.id, item.bdNo);
      if (result.protectedSkipped) {
        setFeedbackMsg({
          type: 'error',
          text: `${formatRank(item.rank)} ${item.name} (${item.bdNo}) একটি প্রটেক্টেড অ্যাকাউন্ট — রিমুভ করা যাবে না।`,
        });
      } else if (result.success) {
        setFeedbackMsg({
          type: 'success',
          text: result.removedFromRegister
            ? `${formatRank(item.rank)} ${item.fullName || item.name} (${item.bdNo}) Biodata Register থেকে সফলভাবে রিমুভ করা হয়েছে।`
            : `${formatRank(item.rank)} ${item.fullName || item.name} (${item.bdNo}) ইমপোর্ট লগ থেকে মুছে ফেলা হয়েছে।`,
        });
        if (result.remainingInBatch === 0 && expandedBatchId === batchId) {
          setExpandedBatchId(null);
        }
        loadBatches();
        onDataChanged();
        window.dispatchEvent(new CustomEvent('baf_state_updated'));
      } else {
        setFeedbackMsg({ type: 'error', text: 'এয়ারম্যানটি রিমুভ করা যায়নি।' });
      }
      setSingleItemToRemove(null);
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err?.message || 'Remove failed.' });
      setSingleItemToRemove(null);
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 rounded-none sm:rounded-3xl border-0 sm:border border-slate-200 dark:border-slate-800 shadow-2xl max-w-3xl w-full my-0 sm:my-6 flex flex-col h-full sm:h-auto sm:max-h-[88vh] overflow-hidden relative">
        {/* Header */}
        <div className="bg-linear-to-r from-slate-900 via-slate-800 to-emerald-950 text-white p-5 flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base sm:text-lg font-black tracking-tight text-white">
                  Biodata Import History
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-950 border border-emerald-500/40 text-emerald-400">
                  {batches.length} {batches.length === 1 ? 'Batch' : 'Batches'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                ভুল করে কোনো ফাইল ইমপোর্ট করলে এখান থেকে কনফার্মেশন দিয়ে পুরো ব্যাচ রিমুভ করতে পারবেন।
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {feedbackMsg && (
            <div
              className={`p-3.5 rounded-2xl border text-xs font-bold flex items-center space-x-2.5 ${
                feedbackMsg.type === 'success'
                  ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              }`}
            >
              {feedbackMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              )}
              <span>{feedbackMsg.text}</span>
            </div>
          )}

          {batches.length === 0 ? (
            <div className="py-14 text-center space-y-3 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-200 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-black text-slate-700 dark:text-slate-200">
                  No Biodata Import History Yet
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Excel বা Copy-Paste দিয়ে এয়ারম্যান ইমপোর্ট করলে প্রতিটি ইমপোর্টের রেকর্ড এখানে সংরক্ষিত থাকবে।
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => {
                const isExpanded = expandedBatchId === batch.id;
                const activeCount = countStillPresent(batch);

                return (
                  <div
                    key={batch.id}
                    className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 rounded-2xl overflow-hidden transition-all"
                  >
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start space-x-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          {batch.sourceType === 'PASTE' ? (
                            <Clipboard className="w-5 h-5" />
                          ) : (
                            <FileSpreadsheet className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-black text-slate-900 dark:text-white truncate max-w-[260px] sm:max-w-xs" title={batch.fileName}>
                              {batch.fileName}
                            </h3>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                              {batch.sourceType}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
                              {batch.airmenCount} Imported
                            </span>
                            {activeCount < batch.airmenCount && (
                              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300">
                                {activeCount} Active Now
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                            <span className="inline-flex items-center space-x-1">
                              <Clock className="w-3 h-3" />
                              <span>{formatTimestamp(batch.timestamp)}</span>
                            </span>
                            {batch.importedBy && (
                              <span>By: <strong className="text-slate-700 dark:text-slate-300">{batch.importedBy}</strong></span>
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
                          <span>{isExpanded ? 'Hide' : 'View'}</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          type="button"
                          onClick={() => setBatchToRemove(batch)}
                          className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-black flex items-center space-x-1.5 shadow-xs transition-colors cursor-pointer"
                          title="Remove this imported batch from Biodata Register"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Remove</span>
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900/80 p-3 max-h-56 overflow-y-auto">
                        <table className="w-full text-[11px] text-left border-collapse">
                          <thead>
                            <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 uppercase text-[10px]">
                              <th className="py-1.5 px-2">#</th>
                              <th className="py-1.5 px-2">BD No</th>
                              <th className="py-1.5 px-2">Rank</th>
                              <th className="py-1.5 px-2">Name</th>
                              <th className="py-1.5 px-2">Trade</th>
                              <th className="py-1.5 px-2">Flight</th>
                              <th className="py-1.5 px-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {(batch.airmenSummary || []).map((item, i) => (
                              <tr key={`${item.id}-${i}`} className="text-slate-700 dark:text-slate-200">
                                <td className="py-1.5 px-2 font-mono text-slate-400">{i + 1}</td>
                                <td className="py-1.5 px-2 font-mono font-bold">{item.bdNo}</td>
                                <td className="py-1.5 px-2 font-bold">{formatRank(item.rank)}</td>
                                <td className="py-1.5 px-2 font-semibold">{item.fullName || item.name}</td>
                                <td className="py-1.5 px-2">{item.trade || '-'}</td>
                                <td className="py-1.5 px-2">{item.flightName || '-'}</td>
                                <td className="py-1.5 px-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setSingleItemToRemove({
                                        batchId: batch.id,
                                        batchFileName: batch.fileName,
                                        item,
                                      })
                                    }
                                    className="inline-flex items-center space-x-1 px-2 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-600 text-rose-600 dark:text-rose-300 hover:text-white border border-rose-200 dark:border-rose-800/70 text-[10px] font-bold transition-colors cursor-pointer"
                                    title="Remove this single airman"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Remove</span>
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-800/80 border-t border-slate-200 dark:border-slate-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

        {/* Remove Import Confirmation Popup */}
        {batchToRemove && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-2xl max-w-md w-full p-6 space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-11 h-11 rounded-2xl bg-rose-100 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Confirm Remove Import?
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    আপনি কি নিশ্চিত যে এই ইমপোর্ট ব্যাচটি রিমুভ করতে চান? এতে এই ফাইল থেকে যুক্ত হওয়া এয়ারম্যানরা Biodata Register থেকে স্থায়ীভাবে মুছে যাবে।
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">File / Source:</span>
                  <span className="font-bold text-slate-900 dark:text-white truncate max-w-[210px]" title={batchToRemove.fileName}>
                    {batchToRemove.fileName}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Imported At:</span>
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                    {formatTimestamp(batchToRemove.timestamp)}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500 dark:text-slate-400">Airmen to Remove:</span>
                  <span className="font-black text-rose-600 dark:text-rose-400">
                    {countStillPresent(batchToRemove)} of {batchToRemove.airmenCount} Airmen
                  </span>
                </div>
                {batchToRemove.airmenSummary?.length > 0 && (
                  <div className="pt-1.5 mt-1.5 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
                    <span className="font-bold">Included: </span>
                    {batchToRemove.airmenSummary
                      .slice(0, 4)
                      .map((s) => `${formatRank(s.rank)} ${s.name}`)
                      .join(', ')}
                    {batchToRemove.airmenSummary.length > 4
                      ? ` +${batchToRemove.airmenSummary.length - 4} more`
                      : ''}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end space-x-2.5 pt-1">
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={() => setBatchToRemove(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={handleConfirmRemove}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black flex items-center space-x-1.5 shadow-md transition-colors cursor-pointer"
                >
                  {isRemoving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Removing...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Yes, Remove Import</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Single Airman Remove Confirmation Popup */}
        {singleItemToRemove && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
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
                  disabled={isRemoving}
                  onClick={() => setSingleItemToRemove(null)}
                  className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isRemoving}
                  onClick={handleConfirmRemoveSingle}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-black flex items-center space-x-1.5 shadow-md transition-colors cursor-pointer"
                >
                  {isRemoving ? (
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

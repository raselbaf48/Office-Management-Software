import { saveAs } from 'file-saver';

export type ExportFeedbackStatus = 'loading' | 'success' | 'error';

export interface ExportFeedbackDetail {
  id: number;
  status: ExportFeedbackStatus;
  fileName: string;
  formatLabel: string;
  message?: string;
}

let eventSeq = 1;

function emitExportFeedback(detail: Omit<ExportFeedbackDetail, 'id'>) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ExportFeedbackDetail>('baf_export_feedback', {
      detail: {
        id: ++eventSeq,
        ...detail,
      },
    })
  );
}

export function inferFormatLabel(fileName: string, explicit?: string): string {
  if (explicit) return explicit;
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return 'PDF';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'Excel';
  if (lower.endsWith('.docx') || lower.endsWith('.doc')) return 'Word';
  if (lower.endsWith('.csv')) return 'CSV';
  return 'File';
}

export function notifyExportStart(fileName: string, formatLabel?: string) {
  emitExportFeedback({
    status: 'loading',
    fileName,
    formatLabel: inferFormatLabel(fileName, formatLabel),
  });
}

export function notifyExportSuccess(fileName: string, formatLabel?: string) {
  emitExportFeedback({
    status: 'success',
    fileName,
    formatLabel: inferFormatLabel(fileName, formatLabel),
  });
}

export function notifyExportError(fileName: string, message?: string, formatLabel?: string) {
  emitExportFeedback({
    status: 'error',
    fileName,
    formatLabel: inferFormatLabel(fileName, formatLabel),
    message: message || 'Export failed. Please try again.',
  });
}

export function saveFileWithFeedback(blob: Blob, fileName: string, formatLabel?: string) {
  saveAs(blob, fileName);
  notifyExportSuccess(fileName, formatLabel);
}

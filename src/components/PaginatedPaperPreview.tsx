import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { PaperSize, getPageDimensions, PageMarginType, getMarginSpec } from '../utils/pageSetup';
import {
  computePageSlices,
  measureDomLayoutGeometry,
  PageSliceSpec,
} from '../utils/paginationLayout';
import { FileText } from 'lucide-react';

interface PaginatedPaperPreviewProps {
  elementId: string;
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  marginType?: PageMarginType;
  marginMm?: number;
  preserveColors?: boolean;
  /** Any dependency key(s) that when changed should recompute page slices immediately */
  refreshKey?: string | number;
  children: React.ReactNode;
}

const INTERACTIVE_SELECTOR = 'button, a, [role="button"], li[title], div[title], td[title]';

function buildSyncedRepeatedThead(
  origTbl: HTMLTableElement,
  origThead: HTMLTableSectionElement,
  srcEl: HTMLElement
): HTMLDivElement {
  const srcRect = srcEl.getBoundingClientRect();
  const rectScaleX =
    srcEl.offsetWidth > 0 && srcRect.width > 0 ? srcRect.width / srcEl.offsetWidth : 1;
  const rectScaleY =
    srcEl.offsetHeight > 0 && srcRect.height > 0 ? srcRect.height / srcEl.offsetHeight : 1;

  const tblRect = origTbl.getBoundingClientRect();
  const tblLeftOffset = Math.max(0, (tblRect.left - srcRect.left) / rectScaleX);
  const tblWidth = Math.max(1, tblRect.width / rectScaleX);

  // Build 2D cell grid across all rows of origTbl to measure true column widths accurately
  const occupied: boolean[][] = [];
  let totalCols = 0;
  const colWidths: number[] = [];
  const allRows = Array.from(origTbl.rows);

  allRows.forEach((tr, rIdx) => {
    if (!occupied[rIdx]) occupied[rIdx] = [];
    let cIdx = 0;
    Array.from(tr.cells).forEach((cell) => {
      while (occupied[rIdx][cIdx]) cIdx++;
      const cs = Math.max(1, cell.colSpan || 1);
      const rs = Math.max(1, cell.rowSpan || 1);
      for (let r = rIdx; r < rIdx + rs; r++) {
        if (!occupied[r]) occupied[r] = [];
        for (let c = cIdx; c < cIdx + cs; c++) {
          occupied[r][c] = true;
        }
      }
      if (cs === 1 && !colWidths[cIdx]) {
        const cr = cell.getBoundingClientRect();
        if (cr.width > 0) {
          colWidths[cIdx] = cr.width / rectScaleX;
        }
      }
      totalCols = Math.max(totalCols, cIdx + cs);
      cIdx += cs;
    });
  });

  // Fallback pass if any column only appeared inside colSpan > 1 cells
  for (let c = 0; c < totalCols; c++) {
    if (!colWidths[c] || colWidths[c] <= 0) {
      colWidths[c] = tblWidth / Math.max(1, totalCols);
    }
  }

  // Normalize sum(colWidths) to exact rendered tblWidth to prevent cumulative border-collapse drift
  const sumW = colWidths.reduce((acc, w) => acc + w, 0);
  if (sumW > 0 && Math.abs(sumW - tblWidth) > 0.25) {
    const ratio = tblWidth / sumW;
    for (let c = 0; c < colWidths.length; c++) {
      colWidths[c] *= ratio;
    }
  }

  const tblWrap = document.createElement('div');
  tblWrap.style.width = `${tblWidth}px`;
  tblWrap.style.marginLeft = `${tblLeftOffset}px`;
  tblWrap.style.overflow = 'hidden';

  const clonedTbl = origTbl.cloneNode(false) as HTMLTableElement;
  clonedTbl.style.width = `${tblWidth}px`;
  clonedTbl.style.minWidth = `${tblWidth}px`;
  clonedTbl.style.maxWidth = `${tblWidth}px`;
  clonedTbl.style.tableLayout = 'fixed';
  clonedTbl.style.borderCollapse = 'collapse';
  clonedTbl.style.margin = '0';

  const colgroup = document.createElement('colgroup');
  for (let c = 0; c < totalCols; c++) {
    const col = document.createElement('col');
    const wStr = `${colWidths[c].toFixed(3)}px`;
    col.style.width = wStr;
    col.style.minWidth = wStr;
    col.style.maxWidth = wStr;
    colgroup.appendChild(col);
  }
  clonedTbl.appendChild(colgroup);

  const clonedThead = origThead.cloneNode(true) as HTMLTableSectionElement;
  const origHeadRows = Array.from(origThead.rows);
  const clonedHeadRows = Array.from(clonedThead.rows);
  origHeadRows.forEach((origRow, rIdx) => {
    const clonedRow = clonedHeadRows[rIdx];
    if (!clonedRow) return;
    const origRowH = origRow.getBoundingClientRect().height / rectScaleY;
    if (origRowH > 0) {
      clonedRow.style.height = `${origRowH.toFixed(2)}px`;
    }
    const origCells = Array.from(origRow.cells);
    const clonedCells = Array.from(clonedRow.cells);
    origCells.forEach((origCell, cellIdx) => {
      const clonedCell = clonedCells[cellIdx];
      if (!clonedCell) return;
      const cr = origCell.getBoundingClientRect();
      clonedCell.style.boxSizing = 'border-box';
      if ((origCell.colSpan || 1) === 1 && cr.width > 0) {
        clonedCell.style.width = `${(cr.width / rectScaleX).toFixed(3)}px`;
      }
      if (cr.height > 0) {
        clonedCell.style.height = `${(cr.height / rectScaleY).toFixed(2)}px`;
      }
    });
  });

  clonedTbl.appendChild(clonedThead);
  tblWrap.appendChild(clonedTbl);
  return tblWrap;
}

export const PaginatedPaperPreview: React.FC<PaginatedPaperPreviewProps> = ({
  elementId,
  paperSize,
  orientation,
  marginType = 'narrow',
  marginMm,
  preserveColors = false,
  refreshKey,
  children,
}) => {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const sourceRef = useRef<HTMLDivElement | null>(null);
  const cardBodySlotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [stageWidth, setStageWidth] = useState<number>(960);
  const [slices, setSlices] = useState<PageSliceSpec[]>([]);
  const [contentHeightPx, setContentHeightPx] = useState<number>(0);
  const [contentWidthPx, setContentWidthPx] = useState<number>(0);

  const resolvedMarginType: PageMarginType = marginType === 'normal' ? 'normal' : 'narrow';
  const marginSpec = getMarginSpec(resolvedMarginType);
  const effectiveMarginMm = marginMm ?? marginSpec.marginMm;
  const pageDims = getPageDimensions({ paperSize, orientation, margin: resolvedMarginType });

  const pageWidthPx = pageDims.widthPx;
  const pageHeightPx = pageDims.heightPx;
  const marginPx = Math.round((effectiveMarginMm / 25.4) * 96);
  const usableWidthPx = Math.max(340, pageWidthPx - marginPx * 2);
  const usableHeightPx = Math.max(340, pageHeightPx - marginPx * 2);

  const effectiveContentWidthPx = Math.max(usableWidthPx, contentWidthPx || usableWidthPx);
  const contentScale =
    effectiveContentWidthPx > usableWidthPx + 2 ? usableWidthPx / effectiveContentWidthPx : 1;

  // Measure outer stage width for crisp proportional Portrait vs Landscape scaling
  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const updateWidth = () => {
      const w = stageEl.clientWidth;
      if (w > 0) setStageWidth(w);
    };
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => updateWidth());
      ro.observe(stageEl);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  const recomputeSlices = useCallback(() => {
    const srcEl = sourceRef.current;
    if (!srcEl) return;

    const raw = measureDomLayoutGeometry(srcEl);
    const measuredMaxTableRight = raw.tables.reduce((mx, t) => Math.max(mx, Math.ceil(t.right)), 0);
    const nextContentWidth = Math.max(usableWidthPx, Math.ceil(srcEl.scrollWidth), measuredMaxTableRight);
    const nextContentScale = nextContentWidth > usableWidthPx + 2 ? usableWidthPx / nextContentWidth : 1;
    const nextEffectiveUsableHeight = Math.floor(usableHeightPx / nextContentScale);

    setContentHeightPx(raw.totalHeight);
    setContentWidthPx(nextContentWidth);
    const nextSlices = computePageSlices(
      raw,
      nextEffectiveUsableHeight,
      1,
      1,
      nextContentWidth
    );
    setSlices(nextSlices);
  }, [usableHeightPx, usableWidthPx]);

  // Recompute whenever content, orientation, paperSize, or refreshKey changes
  useLayoutEffect(() => {
    let rafId = 0;
    const schedule = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        recomputeSlices();
      });
    };

    schedule();

    const srcEl = sourceRef.current;
    let ro: ResizeObserver | undefined;
    if (srcEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => schedule());
      ro.observe(srcEl);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
    };
  }, [recomputeSlices, paperSize, orientation, effectiveMarginMm, refreshKey]);

  const totalPages = Math.max(1, slices.length);
  const isMultiPage = totalPages > 1;

  // Populate cloned page cards whenever multi-page slices update
  useLayoutEffect(() => {
    if (!isMultiPage) return;
    const srcEl = sourceRef.current;
    if (!srcEl) return;

    const sourceTables = Array.from(srcEl.querySelectorAll('table')) as HTMLTableElement[];
    const sourceInteractiveEls = Array.from(srcEl.querySelectorAll(INTERACTIVE_SELECTOR)) as HTMLElement[];

    slices.forEach((slice, idx) => {
      const slot = cardBodySlotRefs.current[idx];
      if (!slot) return;
      slot.innerHTML = '';

      const scaleHost = document.createElement('div');
      scaleHost.style.width = `${effectiveContentWidthPx}px`;
      scaleHost.style.position = 'relative';
      scaleHost.style.fontFamily = 'Arial, sans-serif';
      if (contentScale < 0.999) {
        scaleHost.style.transform = `scale(${contentScale})`;
        scaleHost.style.transformOrigin = 'top left';
      }

      const pageInner = document.createElement('div');
      pageInner.setAttribute('data-paginated-export-page', String(idx));
      pageInner.style.width = `${effectiveContentWidthPx}px`;
      pageInner.style.position = 'relative';
      pageInner.style.background = '#ffffff';
      pageInner.style.fontFamily = 'Arial, sans-serif';

      if (slice.activeTableAtStart) {
        const origTbl = sourceTables[slice.activeTableAtStart.tableIndex];
        const origThead = origTbl?.querySelector('thead');
        if (origTbl && origThead) {
          const tblWrap = buildSyncedRepeatedThead(origTbl, origThead, srcEl);
          pageInner.appendChild(tblWrap);
        }
      }

      const bodyViewport = document.createElement('div');
      bodyViewport.style.width = `${effectiveContentWidthPx}px`;
      bodyViewport.style.height = `${slice.bodySliceHeightPx}px`;
      bodyViewport.style.overflow = 'hidden';
      bodyViewport.style.position = 'relative';

      const bodyClone = srcEl.cloneNode(true) as HTMLElement;
      bodyClone.removeAttribute('id');
      bodyClone.style.width = `${usableWidthPx}px`;
      bodyClone.style.marginTop = `${-slice.sliceStartPx}px`;
      bodyClone.style.pointerEvents = 'auto';

      // Forward clicks on cloned interactive elements back to live React DOM
      const cloneInteractiveEls = Array.from(bodyClone.querySelectorAll(INTERACTIVE_SELECTOR)) as HTMLElement[];
      cloneInteractiveEls.forEach((el, elIdx) => {
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const targetLive = sourceInteractiveEls[elIdx];
          if (targetLive) targetLive.click();
        });
      });

      bodyViewport.appendChild(bodyClone);

      // Draw crisp horizontal border closures for tables cut at top or bottom of page
      for (const tb of slice.tableBorders) {
        const w = Math.max(1, tb.rightPx - tb.leftPx);
        const coveredByRepeatedThead =
          Boolean(slice.activeTableAtStart) &&
          Math.abs(tb.leftPx - (slice.activeTableAtStart?.leftPx ?? 0)) <= 8;
        if (tb.closeTop && !coveredByRepeatedThead) {
          const topLine = document.createElement('div');
          topLine.setAttribute('data-pdf-border-line', 'true');
          topLine.style.position = 'absolute';
          topLine.style.left = `${tb.leftPx}px`;
          topLine.style.top = '0px';
          topLine.style.width = `${w}px`;
          topLine.style.height = '1px';
          topLine.style.backgroundColor = '#000000';
          topLine.style.pointerEvents = 'none';
          bodyViewport.appendChild(topLine);
        }
        if (tb.closeBottom) {
          const botLine = document.createElement('div');
          botLine.setAttribute('data-pdf-border-line', 'true');
          botLine.style.position = 'absolute';
          botLine.style.left = `${tb.leftPx}px`;
          botLine.style.bottom = '0px';
          botLine.style.width = `${w}px`;
          botLine.style.height = '1px';
          botLine.style.backgroundColor = '#000000';
          botLine.style.pointerEvents = 'none';
          bodyViewport.appendChild(botLine);
        }
      }

      pageInner.appendChild(bodyViewport);
      scaleHost.appendChild(pageInner);
      slot.appendChild(scaleHost);
    });
  }, [isMultiPage, slices, usableWidthPx, effectiveContentWidthPx, contentScale, refreshKey]);

  const availableStageWidth = Math.max(300, stageWidth - 28);
  const fitScale = Math.min(1, Math.max(0.32, availableStageWidth / pageWidthPx));
  const scaledPageWidth = Math.round(pageWidthPx * fitScale);

  const singlePageScaledContentHeight = Math.ceil(contentHeightPx * contentScale);
  const singlePageSheetHeight = Math.max(pageHeightPx, singlePageScaledContentHeight + marginPx * 2);

  return (
    <div
      ref={stageRef}
      data-paginated-preview-for={elementId}
      data-paginated-content-width={effectiveContentWidthPx}
      data-paginated-usable-width={usableWidthPx}
      data-paginated-usable-height={usableHeightPx}
      data-paginated-preserve-colors={preserveColors ? 'true' : 'false'}
      className="bg-slate-200/80 dark:bg-slate-950/75 border border-slate-300/80 dark:border-slate-800 rounded-2xl p-3 sm:p-5 overflow-x-auto print:bg-white print:border-none print:p-0 print:overflow-visible"
    >
      <style>{`
        .paginated-preview-doc,
        .paginated-preview-doc * {
          font-family: Arial, sans-serif !important;
        }
        @media print {
          .paginated-offscreen-source {
            position: static !important;
            left: auto !important;
            top: auto !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            z-index: auto !important;
            pointer-events: auto !important;
          }
          .paginated-offscreen-source > div {
            width: 100% !important;
            max-width: 100% !important;
          }
        }
      `}</style>

      {/* Status pill showing active Page Count, Paper Size, Orientation & Margin */}
      <div className="flex items-center justify-center mb-3 print:hidden">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/95 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 shadow-xs text-[11px] font-bold text-slate-700 dark:text-slate-200">
          <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
          <span>
            {totalPages === 1 ? '1 Page Preview' : `${totalPages} Pages Preview`}
          </span>
          <span className="text-slate-400">•</span>
          <span className="uppercase">{pageDims.paperLabel} {orientation}</span>
          <span className="text-slate-400">•</span>
          <span>{marginSpec.label} Margin ({effectiveMarginMm}mm)</span>
        </div>
      </div>

      {/* Authoritative live source DOM:
          - If 1 page: rendered visibly inside the scaled Page 1 sheet.
          - If 2+ pages: kept in offscreen clipHost at exact unscaled usableWidthPx for 1:1 preview slicing & PDF capture. */}
      {!isMultiPage ? (
        <div className="flex flex-col items-center print:block">
          <div
            style={{
              width: `${scaledPageWidth}px`,
              height: `${Math.round(singlePageSheetHeight * fitScale)}px`,
            }}
            className="relative print:w-full! print:h-auto!"
          >
            <div
              className="bg-white text-black border border-slate-300 rounded-xl shadow-2xl origin-top-left print:transform-none! print:w-full! print:min-h-0! print:border-none print:shadow-none print:p-0!"
              style={{
                width: `${pageWidthPx}px`,
                minHeight: `${pageHeightPx}px`,
                padding: `${marginPx}px`,
                boxSizing: 'border-box',
                transform: fitScale < 0.999 ? `scale(${fitScale})` : undefined,
              }}
            >
              <div
                style={{
                  width: `${usableWidthPx}px`,
                  height: contentScale < 0.999 ? `${singlePageScaledContentHeight}px` : undefined,
                  overflow: contentScale < 0.999 ? 'hidden' : 'visible',
                }}
                className="print:w-full! print:h-auto! print:overflow-visible!"
              >
                <div
                  data-paginated-export-page="0"
                  style={{
                    width: `${effectiveContentWidthPx}px`,
                    transform: contentScale < 0.999 ? `scale(${contentScale})` : undefined,
                    transformOrigin: 'top left',
                    backgroundColor: '#ffffff',
                  }}
                  className="print:transform-none! print:w-full!"
                >
                  <div
                    ref={sourceRef}
                    id={elementId}
                    data-pdf-preserve-colors={preserveColors ? 'true' : undefined}
                    className="paginated-preview-doc bg-white text-black"
                    style={{
                      width: `${usableWidthPx}px`,
                      fontFamily: 'Arial, sans-serif',
                    }}
                  >
                    {children}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Hidden unscaled source (used by ResizeObserver & native print) */}
          <div
            className="paginated-offscreen-source"
            style={{
              position: 'fixed',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              overflow: 'hidden',
              pointerEvents: 'none',
              zIndex: -999,
            }}
          >
            <div
              ref={sourceRef}
              id={elementId}
              data-pdf-preserve-colors={preserveColors ? 'true' : undefined}
              className="paginated-preview-doc bg-white text-black"
              style={{
                width: `${usableWidthPx}px`,
                fontFamily: 'Arial, sans-serif',
              }}
            >
              {children}
            </div>
          </div>

          {/* Visible Multi-Page Paper Stack */}
          <div className="flex flex-col items-center gap-5 print:hidden">
            {slices.map((slice, idx) => (
              <div key={slice.pageIndex} className="flex flex-col items-center gap-1.5">
                <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-800/90 px-3 py-0.5 rounded-full border border-slate-300 dark:border-slate-700 shadow-2xs">
                  Page {idx + 1} of {totalPages}
                </div>
                <div
                  style={{
                    width: `${scaledPageWidth}px`,
                    height: `${Math.round(pageHeightPx * fitScale)}px`,
                  }}
                  className="relative"
                >
                  <div
                    className="bg-white text-black border border-slate-300 rounded-xl shadow-2xl origin-top-left overflow-hidden relative"
                    style={{
                      width: `${pageWidthPx}px`,
                      height: `${pageHeightPx}px`,
                      padding: `${marginPx}px`,
                      boxSizing: 'border-box',
                      transform: fitScale < 0.999 ? `scale(${fitScale})` : undefined,
                    }}
                  >
                    <div
                      ref={(el) => {
                        cardBodySlotRefs.current[idx] = el;
                      }}
                      className="paginated-preview-doc"
                      style={{
                        width: `${usableWidthPx}px`,
                        height: `${usableHeightPx}px`,
                        overflow: 'hidden',
                        fontFamily: 'Arial, sans-serif',
                      }}
                    />
                    <div
                      className="absolute bottom-2 right-4 text-[10px] font-semibold text-slate-400 select-none"
                      style={{ fontFamily: 'Arial, sans-serif' }}
                    >
                      Page {idx + 1} / {totalPages}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

import { toCanvas } from 'html-to-image';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { PaperSize, getPageDimensions } from './pageSetup';

export interface ExportElementToPdfOptions {
  elementId: string;
  fileName: string;
  format?: PaperSize;
  orientation?: 'landscape' | 'portrait';
  marginMm?: number;
  minRenderWidthPx?: number;
}

function hasNonWhiteInk(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(4, Math.floor(data.length / 4 / 8000) * 4);
  for (let i = 0; i < data.length; i += step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a > 10 && (r < 245 || g < 245 || b < 245)) {
      return true;
    }
  }
  return false;
}

async function captureWithSafeHtml2Canvas(
  renderSheet: HTMLElement,
  width: number,
  height: number,
  pixelRatio: number
): Promise<HTMLCanvasElement> {
  const allNodes = [renderSheet, ...Array.from(renderSheet.querySelectorAll<HTMLElement>('*'))];
  allNodes.forEach((node) => {
    const cs = window.getComputedStyle(node);
    const isRed = node.classList.contains('text-red-600') || Boolean(node.closest('tr.text-red-600'));
    const isLightRow =
      node.classList.contains('pdf-thead-light') ||
      node.classList.contains('pdf-alt-row') ||
      Boolean(node.closest('tr.pdf-thead-light')) ||
      Boolean(node.closest('tr.pdf-alt-row'));
    node.style.color = isRed ? '#dc2626' : '#000000';
    node.style.backgroundColor = node === renderSheet ? '#ffffff' : isLightRow ? '#f8fafc' : 'transparent';
    node.style.borderColor = '#000000';
    node.style.outlineColor = 'transparent';
    node.style.textDecorationColor = isRed ? '#dc2626' : '#000000';
    node.style.boxShadow = 'none';
    node.style.textShadow = 'none';
    node.style.filter = 'none';
    if (cs.borderTopWidth && cs.borderTopWidth !== '0px') node.style.borderTopColor = '#000000';
    if (cs.borderRightWidth && cs.borderRightWidth !== '0px') node.style.borderRightColor = '#000000';
    if (cs.borderBottomWidth && cs.borderBottomWidth !== '0px') node.style.borderBottomColor = '#000000';
    if (cs.borderLeftWidth && cs.borderLeftWidth !== '0px') node.style.borderLeftColor = '#000000';
  });

  return html2canvas(renderSheet, {
    scale: pixelRatio,
    backgroundColor: '#ffffff',
    width,
    height,
    windowWidth: width,
    windowHeight: height,
    useCORS: true,
    logging: false,
  });
}

interface BoxBoundsPx {
  topPx: number;
  bottomPx: number;
}

interface TableInfoPx {
  leftPx: number;
  rightPx: number;
  topPx: number;
  bottomPx: number;
  theadTopPx: number;
  theadBottomPx: number;
  theadHeightPx: number;
  tbodyTopPx: number;
  hasThead: boolean;
  rows: BoxBoundsPx[];
}

/**
 * Scans upwards from targetEndPx inside a narrow window to find a clean horizontal
 * pixel row with zero text glyphs (only vertical table borders if inside a table),
 * preventing lines of text from ever being sliced in half across PDF pages.
 */
function findCleanHorizontalCutY(
  canvas: HTMLCanvasElement,
  targetEndPx: number,
  minEndPx: number,
  scaleY: number,
  activeTable: TableInfoPx | null
): number {
  const safeTarget = Math.min(canvas.height - 1, Math.max(minEndPx, targetEndPx - Math.round(3 * scaleY)));
  const ctx = canvas.getContext('2d');
  if (!ctx) return safeTarget;

  const scanWindowPx = Math.round(64 * scaleY);
  const scanTop = Math.max(minEndPx, safeTarget - scanWindowPx);
  const scanHeight = safeTarget - scanTop + 1;
  if (scanHeight <= 2) return safeTarget;

  const xStart = activeTable ? Math.max(0, activeTable.leftPx) : 0;
  const xEnd = activeTable ? Math.min(canvas.width, activeTable.rightPx) : canvas.width;
  const scanWidth = Math.max(1, xEnd - xStart);

  const imgData = ctx.getImageData(xStart, scanTop, scanWidth, scanHeight).data;
  const darkCounts = new Int32Array(scanHeight);
  let minDark = Number.MAX_SAFE_INTEGER;

  for (let row = 0; row < scanHeight; row++) {
    let dark = 0;
    const rowOffset = row * scanWidth * 4;
    for (let col = 0; col < scanWidth; col += 2) {
      const idx = rowOffset + col * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const a = imgData[idx + 3];
      if (a > 20 && (r < 230 || g < 230 || b < 230)) {
        dark++;
      }
    }
    darkCounts[row] = dark;
    if (dark < minDark) minDark = dark;
  }

  // Prefer at least 2 consecutive rows matching minDark (+2px tolerance for anti-aliasing)
  for (let row = scanHeight - 2; row >= 1; row--) {
    if (darkCounts[row] <= minDark + 2 && darkCounts[row - 1] <= minDark + 2) {
      return scanTop + row;
    }
  }

  // Fallback: single cleanest row
  for (let row = scanHeight - 1; row >= 0; row--) {
    if (darkCounts[row] <= minDark + 2) {
      return scanTop + row;
    }
  }

  return safeTarget;
}

/**
 * Captures the exact on-screen preview element into a crisp, black-on-white PDF
 * matching the selected paper size & orientation, repeating headers/table theads
 * on every page and closing all table borders cleanly at page breaks.
 */
export async function exportElementToPdf({
  elementId,
  fileName,
  format = 'a4',
  orientation = 'landscape',
  marginMm = 8,
  minRenderWidthPx,
}: ExportElementToPdfOptions): Promise<void> {
  const sourceEl = document.getElementById(elementId);
  if (!sourceEl) {
    throw new Error(`Preview element #${elementId} not found`);
  }

  const safeFileName = fileName.toLowerCase().endsWith('.pdf')
    ? fileName
    : `${fileName}.pdf`;

  const defaultRenderWidth = getPageDimensions({ paperSize: format, orientation }).widthPx;
  const resolvedMinWidth = minRenderWidthPx ?? defaultRenderWidth;
  const sourceWidth = Math.max(resolvedMinWidth, sourceEl.clientWidth, sourceEl.scrollWidth);

  // Outer clip host hides offscreen render without using negative coordinates or opacity:0
  const clipHost = document.createElement('div');
  clipHost.style.position = 'fixed';
  clipHost.style.left = '0';
  clipHost.style.top = '0';
  clipHost.style.width = '0';
  clipHost.style.height = '0';
  clipHost.style.overflow = 'hidden';
  clipHost.style.pointerEvents = 'none';
  clipHost.style.zIndex = '-9999';

  // NOTE: Do NOT apply `width: 100% !important` to .pdf-export-sheet itself,
  // because clipHost has width: 0! renderSheet must keep its explicit pixel width.
  const renderSheet = document.createElement('div');
  renderSheet.className = 'pdf-export-sheet';
  renderSheet.style.position = 'static';
  renderSheet.style.display = 'block';
  renderSheet.style.background = '#ffffff';
  renderSheet.style.backgroundColor = '#ffffff';
  renderSheet.style.color = '#000000';
  renderSheet.style.padding = '16px';
  renderSheet.style.boxSizing = 'border-box';
  renderSheet.style.width = `${sourceWidth}px`;
  renderSheet.style.minWidth = `${sourceWidth}px`;
  renderSheet.style.maxWidth = `${sourceWidth}px`;
  renderSheet.style.fontFamily = 'Arial, sans-serif';

  const scopedStyle = document.createElement('style');
  scopedStyle.textContent = `
    .pdf-export-sheet {
      background: #ffffff !important;
      background-color: #ffffff !important;
      color: #000000 !important;
      font-family: Arial, sans-serif !important;
    }
    .pdf-export-sheet > .pdf-clone-root {
      background: #ffffff !important;
      background-color: #ffffff !important;
      color: #000000 !important;
      border: none !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      overflow: visible !important;
      padding: 0 !important;
      margin: 0 !important;
      width: 100% !important;
      max-width: none !important;
    }
    .pdf-export-sheet .overflow-x-auto {
      overflow: visible !important;
    }
    .pdf-export-sheet .print\\:hidden,
    .pdf-export-sheet [data-export-ignore="true"] {
      display: none !important;
    }
    .pdf-export-sheet h1,
    .pdf-export-sheet h2,
    .pdf-export-sheet h3,
    .pdf-export-sheet h4,
    .pdf-export-sheet th,
    .pdf-export-sheet td,
    .pdf-export-sheet li,
    .pdf-export-sheet div,
    .pdf-export-sheet span {
      color: #000000 !important;
      background-color: transparent !important;
    }
    .pdf-export-sheet thead tr.pdf-thead-light,
    .pdf-export-sheet thead tr.pdf-thead-light th,
    .pdf-export-sheet tr.pdf-alt-row,
    .pdf-export-sheet tr.pdf-alt-row td {
      background-color: #f8fafc !important;
    }
    .pdf-export-sheet tr.text-red-600,
    .pdf-export-sheet tr.text-red-600 td,
    .pdf-export-sheet tr.text-red-600 li,
    .pdf-export-sheet tr.text-red-600 div,
    .pdf-export-sheet tr.text-red-600 span {
      color: #dc2626 !important;
    }
    .pdf-export-sheet table,
    .pdf-export-sheet th,
    .pdf-export-sheet td {
      border-color: #000000 !important;
    }
  `;

  const cloneEl = sourceEl.cloneNode(true) as HTMLElement;
  cloneEl.removeAttribute('id');
  cloneEl.className = 'pdf-clone-root bg-white text-black p-0 m-0 w-full';

  // Synchronously inline already-loaded images as data URLs so html-to-image never stalls re-fetching them
  const sourceImgs = Array.from(sourceEl.querySelectorAll('img'));
  const cloneImgs = Array.from(cloneEl.querySelectorAll('img'));
  cloneImgs.forEach((cloneImg, idx) => {
    const srcImg = sourceImgs[idx];
    if (srcImg && srcImg.complete && srcImg.naturalWidth > 0) {
      try {
        const imgCanvas = document.createElement('canvas');
        imgCanvas.width = srcImg.naturalWidth;
        imgCanvas.height = srcImg.naturalHeight;
        const ictx = imgCanvas.getContext('2d');
        if (ictx) {
          ictx.drawImage(srcImg, 0, 0);
          cloneImg.src = imgCanvas.toDataURL('image/png');
        }
      } catch {
        // Keep original src if cross-origin canvas is tainted
      }
    }
  });

  renderSheet.appendChild(scopedStyle);
  renderSheet.appendChild(cloneEl);
  clipHost.appendChild(renderSheet);
  document.body.appendChild(clipHost);

  try {
    const tables = Array.from(cloneEl.querySelectorAll('table'));
    let widestTable = 0;
    tables.forEach((tbl) => {
      if (tbl.scrollWidth > widestTable) {
        widestTable = tbl.scrollWidth;
      }
    });
    const renderWidth = Math.max(sourceWidth, widestTable + 32);
    renderSheet.style.width = `${renderWidth}px`;
    renderSheet.style.minWidth = `${renderWidth}px`;
    renderSheet.style.maxWidth = `${renderWidth}px`;

    // Wait briefly (max 400ms) only for any unloaded non-data images
    const pendingImgs = Array.from(cloneEl.querySelectorAll('img')).filter(
      (img) => !img.complete && !img.src.startsWith('data:')
    );
    if (pendingImgs.length > 0) {
      await Promise.race([
        Promise.all(
          pendingImgs.map(
            (img) =>
              new Promise<void>((res) => {
                img.addEventListener('load', () => res(), { once: true });
                img.addEventListener('error', () => res(), { once: true });
              })
          )
        ),
        new Promise<void>((res) => setTimeout(res, 400)),
      ]);
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const renderHeight = Math.max(100, Math.ceil(renderSheet.scrollHeight));
    const rootRect = renderSheet.getBoundingClientRect();

    // Measure layout geometry in CSS px prior to rasterization
    const headerEl = cloneEl.querySelector<HTMLElement>('[data-pdf-repeat-header="true"]');
    const rawHeaderBounds = headerEl
      ? (() => {
          const r = headerEl.getBoundingClientRect();
          return {
            top: Math.max(0, r.top - rootRect.top),
            bottom: Math.max(0, r.bottom - rootRect.top),
          };
        })()
      : null;

    const rawTables = tables.map((tbl) => {
      const tr = tbl.getBoundingClientRect();
      const theadEl = tbl.querySelector('thead');
      const tbodyEl = tbl.querySelector('tbody');
      const theadRect = theadEl ? theadEl.getBoundingClientRect() : null;
      const tbodyRect = tbodyEl ? tbodyEl.getBoundingClientRect() : null;
      const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((row) => {
        const rr = row.getBoundingClientRect();
        return {
          top: rr.top - rootRect.top,
          bottom: rr.bottom - rootRect.top,
        };
      });
      return {
        left: tr.left - rootRect.left,
        right: tr.right - rootRect.left,
        top: tr.top - rootRect.top,
        bottom: tr.bottom - rootRect.top,
        theadTop: theadRect ? theadRect.top - rootRect.top : tr.top - rootRect.top,
        theadBottom: theadRect ? theadRect.bottom - rootRect.top : tr.top - rootRect.top,
        tbodyTop: tbodyRect
          ? tbodyRect.top - rootRect.top
          : theadRect
          ? theadRect.bottom - rootRect.top
          : tr.top - rootRect.top,
        hasThead: Boolean(theadRect && theadRect.height > 1),
        rows,
      };
    });

    const rawKeepTogether = Array.from(
      cloneEl.querySelectorAll<HTMLElement>('[data-pdf-keep-together="true"]')
    )
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - rootRect.top, bottom: r.bottom - rootRect.top };
      })
      .filter((b) => b.bottom > b.top + 4);

    const rawSectionHeadings = Array.from(
      cloneEl.querySelectorAll<HTMLElement>('[data-pdf-section-heading="true"]')
    )
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top - rootRect.top, bottom: r.bottom - rootRect.top };
      })
      .filter((b) => b.bottom > b.top + 2);

    const pixelRatio = 1.5;
    let canvas: HTMLCanvasElement;

    try {
      canvas = await Promise.race([
        toCanvas(renderSheet, {
          pixelRatio,
          width: renderWidth,
          height: renderHeight,
          backgroundColor: '#ffffff',
          skipFonts: true,
          cacheBust: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('toCanvas timeout')), 1200)
        ),
      ]);
      if (!hasNonWhiteInk(canvas)) {
        canvas = await captureWithSafeHtml2Canvas(renderSheet, renderWidth, renderHeight, pixelRatio);
      }
    } catch {
      canvas = await captureWithSafeHtml2Canvas(renderSheet, renderWidth, renderHeight, pixelRatio);
    }

    const scaleX = canvas.width / renderWidth;
    const scaleY = canvas.height / renderHeight;

    const docHeader: (BoxBoundsPx & { heightPx: number }) | null = rawHeaderBounds
      ? (() => {
          const topPx = Math.max(0, Math.floor(rawHeaderBounds.top * scaleY));
          const bottomPx = Math.min(canvas.height, Math.ceil((rawHeaderBounds.bottom + 2) * scaleY));
          const heightPx = Math.max(0, bottomPx - topPx);
          return heightPx > 4 ? { topPx, bottomPx, heightPx } : null;
        })()
      : null;

    const tableInfos: TableInfoPx[] = rawTables.map((t) => {
      const topPx = Math.max(0, Math.floor(t.top * scaleY));
      const bottomPx = Math.min(canvas.height, Math.ceil(t.bottom * scaleY));
      const theadTopPx = Math.max(0, Math.floor((t.theadTop - 1.5) * scaleY));
      const theadBottomPx = Math.min(canvas.height, Math.ceil((t.theadBottom + 1.5) * scaleY));
      return {
        leftPx: Math.max(0, Math.floor((t.left - 1) * scaleX)),
        rightPx: Math.min(canvas.width, Math.ceil((t.right + 1) * scaleX)),
        topPx,
        bottomPx,
        theadTopPx,
        theadBottomPx,
        theadHeightPx: Math.max(0, theadBottomPx - theadTopPx),
        tbodyTopPx: Math.max(theadBottomPx, Math.floor(t.tbodyTop * scaleY)),
        hasThead: t.hasThead,
        rows: t.rows.map((r) => ({
          topPx: Math.max(0, Math.floor(r.top * scaleY)),
          bottomPx: Math.min(canvas.height, Math.ceil(r.bottom * scaleY)),
        })),
      };
    });

    const keepTogetherBlocks: BoxBoundsPx[] = rawKeepTogether.map((b) => ({
      topPx: Math.max(0, Math.floor(b.top * scaleY)),
      bottomPx: Math.min(canvas.height, Math.ceil(b.bottom * scaleY)),
    }));

    const sectionHeadings: BoxBoundsPx[] = rawSectionHeadings.map((b) => ({
      topPx: Math.max(0, Math.floor(b.top * scaleY)),
      bottomPx: Math.min(canvas.height, Math.ceil(b.bottom * scaleY)),
    }));

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format,
      compress: true,
    });

    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const usableWidthMm = pageWidthMm - marginMm * 2;
    const usableHeightMm = pageHeightMm - marginMm * 2;

    const totalHeightMm = (canvas.height * usableWidthMm) / canvas.width;

    if (totalHeightMm <= usableHeightMm + 0.5) {
      pdf.addImage(
        canvas.toDataURL('image/png'),
        'PNG',
        marginMm,
        marginMm,
        usableWidthMm,
        totalHeightMm,
        undefined,
        'FAST'
      );
    } else {
      const maxPageContentPx = Math.floor((usableHeightMm / usableWidthMm) * canvas.width);
      const headerGapPx = Math.round(6 * scaleY);
      const borderThickness = Math.max(2, Math.round(1.5 * scaleY));
      const minProgressPx = Math.round(36 * scaleY);

      let sliceStartPx = 0;
      let pageIndex = 0;

      while (sliceStartPx < canvas.height - Math.round(3 * scaleY)) {
        // 1. Determine repeated header + active table <thead> for Page 2+
        let repeatDocHeader = false;
        let activeTableAtStart: TableInfoPx | null = null;
        let repeatedTopHeightPx = 0;

        if (pageIndex > 0) {
          if (docHeader && sliceStartPx >= docHeader.bottomPx - Math.round(4 * scaleY)) {
            if (docHeader.heightPx + headerGapPx < Math.floor(maxPageContentPx * 0.45)) {
              repeatDocHeader = true;
              repeatedTopHeightPx += docHeader.heightPx + headerGapPx;
            }
          }

          const continuedTable = tableInfos.find(
            (tbl) =>
              tbl.hasThead &&
              sliceStartPx >= tbl.tbodyTopPx - Math.round(2 * scaleY) &&
              sliceStartPx < tbl.bottomPx - Math.round(6 * scaleY)
          );

          if (
            continuedTable &&
            repeatedTopHeightPx + continuedTable.theadHeightPx < Math.floor(maxPageContentPx * 0.65)
          ) {
            activeTableAtStart = continuedTable;
            repeatedTopHeightPx += continuedTable.theadHeightPx;
          }
        }

        const availableBodyPx = Math.max(
          Math.round(80 * scaleY),
          maxPageContentPx - repeatedTopHeightPx
        );
        const targetEndPx = Math.min(sliceStartPx + availableBodyPx, canvas.height);

        // 2. Pick clean sliceEndPx
        let sliceEndPx = targetEndPx;
        let nextSliceStartPx: number | null = null;

        if (targetEndPx >= canvas.height - Math.round(2 * scaleY)) {
          sliceEndPx = canvas.height;
        } else {
          // Reserve room for closing border inside availableBodyPx
          const safeTargetEndPx = Math.max(
            sliceStartPx + minProgressPx,
            targetEndPx - borderThickness - Math.round(1 * scaleY)
          );

          // Check all table rows that end cleanly within this page
          let bestRowCut: { bottomPx: number; isLastRowOfTable: boolean; tableBottomPx: number } | null = null;
          for (const tbl of tableInfos) {
            for (let rIdx = 0; rIdx < tbl.rows.length; rIdx++) {
              const row = tbl.rows[rIdx];
              if (row.bottomPx > sliceStartPx + minProgressPx && row.bottomPx <= safeTargetEndPx) {
                if (!bestRowCut || row.bottomPx > bestRowCut.bottomPx) {
                  bestRowCut = {
                    bottomPx: row.bottomPx,
                    isLastRowOfTable: rIdx === tbl.rows.length - 1,
                    tableBottomPx: tbl.bottomPx,
                  };
                }
              }
            }
          }

          const minReasonableProgress = sliceStartPx + Math.floor(availableBodyPx * 0.35);

          if (bestRowCut && bestRowCut.bottomPx >= minReasonableProgress) {
            // If it's the final row of the table and full table border fits, keep whole table border intact
            if (
              bestRowCut.isLastRowOfTable &&
              bestRowCut.tableBottomPx + Math.round(2 * scaleY) <= targetEndPx
            ) {
              sliceEndPx = Math.min(targetEndPx, bestRowCut.tableBottomPx + Math.round(2 * scaleY));
            } else {
              sliceEndPx = bestRowCut.bottomPx;
              if (bestRowCut.isLastRowOfTable) {
                nextSliceStartPx = Math.max(sliceEndPx, bestRowCut.tableBottomPx + Math.round(1 * scaleY));
              }
            }
          } else {
            // Single oversized row or non-table area: cut cleanly between text lines
            const activeTableAtEnd =
              tableInfos.find(
                (tbl) => safeTargetEndPx > tbl.topPx && safeTargetEndPx < tbl.bottomPx
              ) || null;
            sliceEndPx = findCleanHorizontalCutY(
              canvas,
              safeTargetEndPx,
              sliceStartPx + minProgressPx,
              scaleY,
              activeTableAtEnd
            );
          }

          // Avoid splitting a keep-together block (e.g. Signature Footer)
          for (const block of keepTogetherBlocks) {
            const blockHeight = block.bottomPx - block.topPx;
            if (
              sliceEndPx > block.topPx + Math.round(4 * scaleY) &&
              sliceEndPx < block.bottomPx - Math.round(4 * scaleY) &&
              block.topPx > sliceStartPx + minProgressPx &&
              blockHeight <= availableBodyPx
            ) {
              sliceEndPx = Math.max(sliceStartPx + minProgressPx, block.topPx - Math.round(4 * scaleY));
              nextSliceStartPx = null;
              break;
            }
          }

          // Avoid orphaned section headings right above a table that wouldn't show its first row
          for (const heading of sectionHeadings) {
            const nextTable = tableInfos.find(
              (tbl) => tbl.topPx >= heading.bottomPx && tbl.topPx - heading.bottomPx < Math.round(35 * scaleY)
            );
            const firstRowBottom = nextTable?.rows[0]?.bottomPx ?? heading.bottomPx + Math.round(60 * scaleY);
            if (
              sliceEndPx > heading.topPx &&
              sliceEndPx < firstRowBottom &&
              heading.topPx > sliceStartPx + minProgressPx
            ) {
              sliceEndPx = Math.max(sliceStartPx + minProgressPx, heading.topPx - Math.round(4 * scaleY));
              nextSliceStartPx = null;
              break;
            }
          }
        }

        const bodySliceHeightPx = Math.max(1, sliceEndPx - sliceStartPx);
        const pageCanvasHeightPx = repeatedTopHeightPx + bodySliceHeightPx;

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = pageCanvasHeightPx;

        const ctx = pageCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          let cursorY = 0;

          if (repeatDocHeader && docHeader) {
            ctx.drawImage(
              canvas,
              0,
              docHeader.topPx,
              canvas.width,
              docHeader.heightPx,
              0,
              cursorY,
              canvas.width,
              docHeader.heightPx
            );
            cursorY += docHeader.heightPx + headerGapPx;
          }

          if (activeTableAtStart) {
            ctx.drawImage(
              canvas,
              0,
              activeTableAtStart.theadTopPx,
              canvas.width,
              activeTableAtStart.theadHeightPx,
              0,
              cursorY,
              canvas.width,
              activeTableAtStart.theadHeightPx
            );
            cursorY += activeTableAtStart.theadHeightPx;
          }

          const bodyTopYOnPage = cursorY;
          const bodyBottomYOnPage = bodyTopYOnPage + bodySliceHeightPx;

          ctx.drawImage(
            canvas,
            0,
            sliceStartPx,
            canvas.width,
            bodySliceHeightPx,
            0,
            bodyTopYOnPage,
            canvas.width,
            bodySliceHeightPx
          );

          // 3. Guarantee closed horizontal borders for any table crossing this page's boundaries
          ctx.fillStyle = '#000000';
          for (const tbl of tableInfos) {
            const overlapsPage =
              tbl.bottomPx > sliceStartPx + Math.round(4 * scaleY) &&
              tbl.topPx < sliceEndPx - Math.round(4 * scaleY);
            if (!overlapsPage) continue;

            const tableWidth = Math.max(1, tbl.rightPx - tbl.leftPx);

            // Top border closure on Page 2+ if table continued here
            if (pageIndex > 0 && sliceStartPx > tbl.topPx && sliceStartPx < tbl.bottomPx) {
              ctx.fillRect(tbl.leftPx, bodyTopYOnPage, tableWidth, Math.max(1, Math.round(1 * scaleY)));
            }

            // Bottom border closure whenever a table continues past the bottom of this page
            if (sliceEndPx < tbl.bottomPx - Math.round(2 * scaleY)) {
              ctx.fillRect(
                tbl.leftPx,
                Math.max(bodyTopYOnPage, bodyBottomYOnPage - borderThickness),
                tableWidth,
                borderThickness
              );
            }
          }
        }

        if (pageIndex > 0) {
          pdf.addPage();
        }

        const pageSliceHeightMm = (pageCanvasHeightPx * usableWidthMm) / canvas.width;
        pdf.addImage(
          pageCanvas.toDataURL('image/png'),
          'PNG',
          marginMm,
          marginMm,
          usableWidthMm,
          pageSliceHeightMm,
          undefined,
          'FAST'
        );

        sliceStartPx = nextSliceStartPx ?? sliceEndPx;
        pageIndex++;
      }
    }

    pdf.save(safeFileName);
  } finally {
    if (clipHost.parentNode) {
      clipHost.parentNode.removeChild(clipHost);
    }
  }
}

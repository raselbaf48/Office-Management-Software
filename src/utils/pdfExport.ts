import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { PaperSize, getPageDimensions } from './pageSetup';
import {
  computePageSlices,
  measureDomLayoutGeometry,
  TableInfoPx,
} from './paginationLayout';
import {
  notifyExportStart,
  notifyExportSuccess,
  notifyExportError,
} from './exportNotification';

export interface ExportElementToPdfOptions {
  elementId: string;
  fileName: string;
  format?: PaperSize;
  orientation?: 'landscape' | 'portrait';
  marginMm?: number;
  minRenderWidthPx?: number;
  preserveColors?: boolean;
}

let cachedSheetCount = -1;
let cachedCssText = '';
let cachedRootVarsCss = '';

function getSameOriginCssText(): string {
  const sheets = document.styleSheets;
  if (sheets.length === cachedSheetCount && cachedCssText) {
    return cachedCssText;
  }
  const chunks: string[] = [];
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (let r = 0; r < rules.length; r++) {
        chunks.push(rules[r].cssText);
      }
    } catch {
      // Skip cross-origin stylesheets (e.g., Google Fonts) safely
    }
  }
  cachedSheetCount = sheets.length;
  cachedCssText = chunks.join('\n');
  return cachedCssText;
}

function getRootCssVariablesCss(): string {
  if (cachedRootVarsCss) return cachedRootVarsCss;
  const computed = getComputedStyle(document.documentElement);
  const vars: string[] = ['--tw-border-style: solid;'];
  for (let i = 0; i < computed.length; i++) {
    const prop = computed[i];
    if (prop.startsWith('--')) {
      const val = computed.getPropertyValue(prop).trim();
      if (val) vars.push(`${prop}: ${val};`);
    }
  }
  const baseFontSize = computed.fontSize || '16px';
  const baseLineHeight = computed.lineHeight || '1.5';
  cachedRootVarsCss = `:root, html, body { ${vars.join(' ')} font-size: ${baseFontSize}; line-height: ${baseLineHeight}; }`;
  return cachedRootVarsCss;
}

function inlineLoadedImages(srcRoot: HTMLElement, cloneRoot: HTMLElement) {
  const sourceImgs = Array.from(srcRoot.querySelectorAll('img'));
  const cloneImgs = Array.from(cloneRoot.querySelectorAll('img'));
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
        // Keep original src
      }
    }
  });
}

function hasNonWhiteInk(canvas: HTMLCanvasElement): boolean {
  if (canvas.width === 0 || canvas.height === 0) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const step = Math.max(4, Math.floor(data.length / 4 / 6000) * 4);
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

/**
 * Renders the detached offscreen sheet using Chrome's native Blink engine via SVG <foreignObject>
 * inside a full <html xmlns="http://www.w3.org/1999/xhtml"> root with Tailwind v4 :root CSS variables
 * preserved verbatim, eliminating spacing/padding drift vs the live DOM.
 */
async function captureViaNativeForeignObject(
  renderSheet: HTMLElement,
  width: number,
  height: number,
  pixelRatio: number,
  extraCss: string
): Promise<HTMLCanvasElement> {
  const pageCss = getSameOriginCssText();
  const rootVarsCss = getRootCssVariablesCss();

  const xhtmlNs = 'http://www.w3.org/1999/xhtml';
  const htmlEl = document.createElementNS(xhtmlNs, 'html');
  htmlEl.setAttribute('xmlns', xhtmlNs);
  htmlEl.style.width = `${width}px`;
  htmlEl.style.height = `${height}px`;
  htmlEl.style.margin = '0';
  htmlEl.style.padding = '0';
  htmlEl.style.background = '#ffffff';

  const headEl = document.createElementNS(xhtmlNs, 'head');
  const styleNode = document.createElementNS(xhtmlNs, 'style');
  styleNode.textContent = `${pageCss}\n${rootVarsCss}\n${extraCss}`;
  headEl.appendChild(styleNode);
  htmlEl.appendChild(headEl);

  const bodyEl = document.createElementNS(xhtmlNs, 'body');
  bodyEl.style.width = `${width}px`;
  bodyEl.style.height = `${height}px`;
  bodyEl.style.margin = '0';
  bodyEl.style.padding = '0';
  bodyEl.style.overflow = 'hidden';
  bodyEl.style.background = '#ffffff';
  bodyEl.style.fontFamily = 'Arial, sans-serif';

  const sheetClone = renderSheet.cloneNode(true) as HTMLElement;
  bodyEl.appendChild(sheetClone);
  htmlEl.appendChild(bodyEl);

  const serializedHtml = new XMLSerializer().serializeToString(htmlEl);
  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject x="0" y="0" width="100%" height="100%">${serializedHtml}</foreignObject></svg>`;
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => reject(new Error('SVG rasterize timeout')), 3000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('SVG image decode failed'));
    };
    image.src = svgUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Verify canvas is not tainted and actually contains non-white content
  if (!hasNonWhiteInk(canvas)) {
    throw new Error('SVG canvas produced blank output');
  }
  return canvas;
}

function sanitizeDomStylesForHtml2Canvas(
  renderSheet: HTMLElement,
  preserveColors: boolean
) {
  const allNodes = [renderSheet, ...Array.from(renderSheet.querySelectorAll<HTMLElement>('*'))];
  for (let i = 0; i < allNodes.length; i++) {
    const node = allNodes[i];
    if (node.getAttribute('data-pdf-border-line') === 'true') {
      node.style.backgroundColor = '#000000';
      continue;
    }
    if (node.getAttribute('data-conf-banner') === 'true' || node.classList.contains('print-conf-banner')) {
      node.style.color = '#64748b';
      node.style.backgroundColor = 'transparent';
      continue;
    }
    const cl = node.classList;
    const isRed = cl.contains('text-red-600') || Boolean(node.closest('tr.text-red-600'));
    const isLightRow =
      cl.contains('pdf-thead-light') ||
      cl.contains('pdf-alt-row') ||
      Boolean(node.closest('tr.pdf-thead-light')) ||
      Boolean(node.closest('tr.pdf-alt-row'));

    if (preserveColors) {
      if (!node.style.color) {
        if (isRed) node.style.color = '#dc2626';
        else if (cl.contains('text-slate-400')) node.style.color = '#94a3b8';
        else if (cl.contains('text-slate-500') || cl.contains('text-slate-600')) node.style.color = '#475569';
        else if (cl.contains('text-slate-700') || cl.contains('text-gray-800')) node.style.color = '#1e293b';
        else node.style.color = '#000000';
      }
      if (!node.style.backgroundColor) {
        if (node === renderSheet || cl.contains('bg-white')) node.style.backgroundColor = '#ffffff';
        else if (isLightRow || cl.contains('bg-slate-50')) node.style.backgroundColor = '#f8fafc';
        else if (cl.contains('bg-slate-100') || cl.contains('bg-gray-100')) node.style.backgroundColor = '#f1f5f9';
        else if (cl.contains('bg-slate-200')) node.style.backgroundColor = '#e2e8f0';
        else node.style.backgroundColor = 'transparent';
      }
    } else {
      node.style.color = isRed ? '#dc2626' : '#000000';
      node.style.backgroundColor =
        node === renderSheet ? '#ffffff' : isLightRow ? '#f8fafc' : 'transparent';
    }

    node.style.borderColor = '#000000';
    node.style.outlineColor = 'transparent';
    node.style.textDecorationColor = isRed ? '#dc2626' : '#000000';
    node.style.boxShadow = 'none';
    node.style.textShadow = 'none';
    node.style.filter = 'none';
  }
}

function buildBaseCssRules(shouldPreserveColors: boolean): string {
  return shouldPreserveColors
    ? `
      .pdf-export-sheet, .pdf-export-sheet * {
        font-family: Arial, sans-serif !important;
      }
      .pdf-export-sheet {
        background: #ffffff !important;
        background-color: #ffffff !important;
        color: #000000 !important;
      }
      .pdf-export-sheet > .pdf-clone-root {
        background: #ffffff !important;
        background-color: #ffffff !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .pdf-export-sheet .overflow-x-auto {
        overflow: visible !important;
      }
      .pdf-export-sheet .print\\:hidden,
      .pdf-export-sheet [data-export-ignore="true"] {
        display: none !important;
      }
      .pdf-export-sheet [data-pdf-border-line="true"] {
        background-color: #000000 !important;
      }
      .pdf-export-sheet table {
        border-collapse: collapse !important;
      }
      .pdf-export-sheet table,
      .pdf-export-sheet th,
      .pdf-export-sheet td {
        border-color: #000000 !important;
        vertical-align: middle !important;
      }
    `
    : `
      .pdf-export-sheet, .pdf-export-sheet * {
        font-family: Arial, sans-serif !important;
      }
      .pdf-export-sheet {
        background: #ffffff !important;
        background-color: #ffffff !important;
        color: #000000 !important;
      }
      .pdf-export-sheet > .pdf-clone-root {
        background: #ffffff !important;
        background-color: #ffffff !important;
        color: #000000 !important;
        border: none !important;
        border-radius: 0 !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
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
      .pdf-export-sheet div:not([data-pdf-border-line="true"]):not([data-conf-banner="true"]):not(.print-conf-banner),
      .pdf-export-sheet span:not([data-conf-banner="true"]):not(.print-conf-banner) {
        color: #000000 !important;
        background-color: transparent !important;
      }
      .pdf-export-sheet [data-conf-banner="true"],
      .pdf-export-sheet .print-conf-banner {
        color: #64748b !important;
        background-color: transparent !important;
      }
      .pdf-export-sheet [data-pdf-border-line="true"] {
        background-color: #000000 !important;
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
      .pdf-export-sheet table {
        border-collapse: collapse !important;
      }
      .pdf-export-sheet table,
      .pdf-export-sheet th,
      .pdf-export-sheet td {
        border-color: #000000 !important;
        vertical-align: middle !important;
      }
    `;
}

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
      if (a > 20 && (r < 220 || g < 220 || b < 220)) {
        dark++;
      }
    }
    darkCounts[row] = dark;
    if (dark < minDark) minDark = dark;
  }

  for (let row = scanHeight - 2; row >= 1; row--) {
    if (darkCounts[row] <= minDark + 2 && darkCounts[row - 1] <= minDark + 2) {
      return scanTop + row;
    }
  }

  for (let row = scanHeight - 1; row >= 0; row--) {
    if (darkCounts[row] <= minDark + 2) {
      return scanTop + row;
    }
  }

  return safeTarget;
}

export async function exportElementToPdf({
  elementId,
  fileName,
  format = 'a4',
  orientation = 'landscape',
  marginMm = 12.7,
  minRenderWidthPx,
  preserveColors,
}: ExportElementToPdfOptions): Promise<void> {
  const sourceEl = document.getElementById(elementId);
  if (!sourceEl) {
    throw new Error(`Preview element #${elementId} not found`);
  }

  const safeFileName = fileName.toLowerCase().endsWith('.pdf')
    ? fileName
    : `${fileName}.pdf`;

  const shouldPreserveColors =
    preserveColors !== undefined
      ? preserveColors
      : sourceEl.getAttribute('data-pdf-preserve-colors') === 'true';

  notifyExportStart(safeFileName, 'PDF');

  // Yield 1 micro-frame so "Generating PDF..." popup renders cleanly before capture
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const baseCssRules = buildBaseCssRules(shouldPreserveColors);
  const clipHost = document.createElement('div');
  clipHost.style.position = 'fixed';
  clipHost.style.left = '0';
  clipHost.style.top = '0';
  clipHost.style.width = '0';
  clipHost.style.height = '0';
  clipHost.style.overflow = 'hidden';
  clipHost.style.pointerEvents = 'none';
  clipHost.style.zIndex = '-9999';
  document.body.appendChild(clipHost);

  try {
    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format,
      compress: true,
    });

    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const usableWidthMm = pageWidthMm - marginMm * 2;
    const pixelRatio = 2;

    // 1. Primary path: Capture discrete PaginatedPaperPreview page slots verbatim (1:1 Preview parity)
    const previewHost = document.querySelector<HTMLElement>(
      `[data-paginated-preview-for="${CSS.escape(elementId)}"]`
    );
    const previewPages = previewHost
      ? Array.from(previewHost.querySelectorAll<HTMLElement>('[data-paginated-export-page]')).sort(
          (a, b) =>
            Number(a.getAttribute('data-paginated-export-page') || 0) -
            Number(b.getAttribute('data-paginated-export-page') || 0)
        )
      : [];

    if (previewHost && previewPages.length > 0) {
      const verticalMarginMm =
        Number(previewHost.getAttribute('data-paginated-vertical-margin-mm')) ||
        Math.min(marginMm, 5);
      const usableHeightMm = pageHeightMm - verticalMarginMm * 2;
      const contentWidthPx =
        Number(previewHost.getAttribute('data-paginated-content-width')) ||
        Math.max(340, getPageDimensions({ paperSize: format, orientation }).widthPx - Math.round((marginMm / 25.4) * 96) * 2);

      for (let i = 0; i < previewPages.length; i++) {
        const pageSlotEl = previewPages[i];
        const pageW = Math.max(contentWidthPx, pageSlotEl.offsetWidth || contentWidthPx);
        const pageH = Math.max(40, pageSlotEl.offsetHeight || 0, pageSlotEl.scrollHeight || 0);

        const renderSheet = document.createElement('div');
        renderSheet.className = 'pdf-export-sheet';
        renderSheet.style.position = 'static';
        renderSheet.style.display = 'block';
        renderSheet.style.background = '#ffffff';
        renderSheet.style.backgroundColor = '#ffffff';
        renderSheet.style.color = '#000000';
        renderSheet.style.margin = '0';
        renderSheet.style.padding = '0';
        renderSheet.style.width = `${pageW}px`;
        renderSheet.style.height = `${pageH}px`;
        renderSheet.style.overflow = 'hidden';
        renderSheet.style.fontFamily = 'Arial, sans-serif';

        const scopedStyle = document.createElement('style');
        scopedStyle.textContent = baseCssRules;

        const pageClone = pageSlotEl.cloneNode(true) as HTMLElement;
        pageClone.classList.add('pdf-clone-root');
        pageClone.style.transform = 'none';
        pageClone.style.width = `${pageW}px`;
        pageClone.style.height = `${pageH}px`;
        pageClone.style.margin = '0';

        // Avoid duplicate elementId collisions in live document while measuring/rendering
        if (pageClone.id === elementId) pageClone.removeAttribute('id');
        pageClone.querySelectorAll(`[id="${CSS.escape(elementId)}"]`).forEach((n) => n.removeAttribute('id'));

        inlineLoadedImages(pageSlotEl, pageClone);

        renderSheet.appendChild(scopedStyle);
        renderSheet.appendChild(pageClone);
        clipHost.innerHTML = '';
        clipHost.appendChild(renderSheet);

        let pageCanvas: HTMLCanvasElement;
        try {
          pageCanvas = await captureViaNativeForeignObject(
            renderSheet,
            pageW,
            pageH,
            pixelRatio,
            baseCssRules
          );
        } catch {
          sanitizeDomStylesForHtml2Canvas(renderSheet, shouldPreserveColors);
          pageCanvas = await html2canvas(renderSheet, {
            scale: pixelRatio,
            backgroundColor: '#ffffff',
            width: pageW,
            height: pageH,
            windowWidth: pageW,
            windowHeight: pageH,
            useCORS: true,
            logging: false,
            removeContainer: true,
          });
        }

        if (i > 0) {
          pdf.addPage();
        }

        let drawWidthMm = usableWidthMm;
        let drawHeightMm = (pageCanvas.height * usableWidthMm) / pageCanvas.width;
        if (drawHeightMm > usableHeightMm) {
          const shrink = usableHeightMm / drawHeightMm;
          drawWidthMm *= shrink;
          drawHeightMm = usableHeightMm;
        }
        const offsetX = marginMm + Math.max(0, (usableWidthMm - drawWidthMm) / 2);

        pdf.addImage(
          pageCanvas.toDataURL('image/jpeg', 0.96),
          'JPEG',
          offsetX,
          verticalMarginMm,
          drawWidthMm,
          drawHeightMm,
          undefined,
          'FAST'
        );

        // Yield every 8 pages on massive multi-day exports so UI stays responsive
        if (i > 0 && i % 8 === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }

      pdf.save(safeFileName);
      notifyExportSuccess(safeFileName, 'PDF');
      return;
    }

    // 2. Fallback path: Standalone elements not wrapped inside PaginatedPaperPreview
    const fallbackVerticalMarginMm = Math.min(marginMm, 8);
    const stampConfidentialHeaderFooter = (pageNum: number) => {
      pdf.setPage(pageNum);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(100, 116, 139);
      pdf.text('CONFIDENTIAL', pageWidthMm / 2, 4.5, { align: 'center' });
      pdf.text('CONFIDENTIAL', pageWidthMm / 2, pageHeightMm - 2.5, { align: 'center' });
    };
    const usableHeightMm = pageHeightMm - fallbackVerticalMarginMm * 2;
    const pageDims = getPageDimensions({ paperSize: format, orientation });
    const marginPx = Math.round((marginMm / 25.4) * 96);
    const usablePaperWidthPx = Math.max(360, pageDims.widthPx - marginPx * 2);
    const resolvedMinWidth = minRenderWidthPx ?? usablePaperWidthPx;
    const sourceWidth = Math.max(resolvedMinWidth, sourceEl.clientWidth, sourceEl.scrollWidth);

    const renderSheet = document.createElement('div');
    renderSheet.className = 'pdf-export-sheet';
    renderSheet.style.position = 'static';
    renderSheet.style.display = 'block';
    renderSheet.style.background = '#ffffff';
    renderSheet.style.backgroundColor = '#ffffff';
    renderSheet.style.color = '#000000';
    renderSheet.style.padding = '0px';
    renderSheet.style.margin = '0px';
    renderSheet.style.boxSizing = 'border-box';
    renderSheet.style.width = `${sourceWidth}px`;
    renderSheet.style.minWidth = `${sourceWidth}px`;
    renderSheet.style.maxWidth = `${sourceWidth}px`;
    renderSheet.style.fontFamily = 'Arial, sans-serif';

    const scopedStyle = document.createElement('style');
    scopedStyle.textContent = baseCssRules;

    const cloneEl = sourceEl.cloneNode(true) as HTMLElement;
    cloneEl.removeAttribute('id');
    cloneEl.removeAttribute('style');
    cloneEl.className = 'pdf-clone-root bg-white text-black p-0 m-0 w-full';
    inlineLoadedImages(sourceEl, cloneEl);

    renderSheet.appendChild(scopedStyle);
    renderSheet.appendChild(cloneEl);
    clipHost.appendChild(renderSheet);

    const tables = Array.from(cloneEl.querySelectorAll('table'));
    let widestTable = 0;
    for (const tbl of tables) {
      if (tbl.scrollWidth > widestTable) {
        widestTable = tbl.scrollWidth;
      }
    }
    const renderWidth = Math.max(sourceWidth, widestTable);
    renderSheet.style.width = `${renderWidth}px`;
    renderSheet.style.minWidth = `${renderWidth}px`;
    renderSheet.style.maxWidth = `${renderWidth}px`;

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
        new Promise<void>((res) => setTimeout(res, 250)),
      ]);
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const rawLayout = measureDomLayoutGeometry(renderSheet);
    const renderHeight = rawLayout.totalHeight;

    let canvas: HTMLCanvasElement;
    try {
      canvas = await captureViaNativeForeignObject(
        renderSheet,
        renderWidth,
        renderHeight,
        pixelRatio,
        baseCssRules
      );
    } catch {
      sanitizeDomStylesForHtml2Canvas(renderSheet, shouldPreserveColors);
      canvas = await html2canvas(renderSheet, {
        scale: pixelRatio,
        backgroundColor: '#ffffff',
        width: renderWidth,
        height: renderHeight,
        windowWidth: renderWidth,
        windowHeight: renderHeight,
        useCORS: true,
        logging: false,
        removeContainer: true,
      });
    }

    const scaleX = canvas.width / renderWidth;
    const scaleY = canvas.height / renderHeight;
    const maxPageContentPx = Math.floor((usableHeightMm / usableWidthMm) * canvas.width);

    const slices = computePageSlices(
      rawLayout,
      maxPageContentPx,
      scaleX,
      scaleY,
      canvas.width,
      (targetEndPx, minEndPx, activeTable) =>
        findCleanHorizontalCutY(canvas, targetEndPx, minEndPx, scaleY, activeTable)
    );

    if (slices.length === 1 && slices[0].repeatedTopHeightPx === 0) {
      const totalHeightMm = (canvas.height * usableWidthMm) / canvas.width;
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.96),
        'JPEG',
        marginMm,
        fallbackVerticalMarginMm,
        usableWidthMm,
        totalHeightMm,
        undefined,
        'FAST'
      );
      stampConfidentialHeaderFooter(1);
    } else {
      const borderThickness = Math.max(2, Math.round(1.0 * scaleY));

      for (const slice of slices) {
        const pageCanvasHeightPx = slice.repeatedTopHeightPx + slice.bodySliceHeightPx;
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = pageCanvasHeightPx;

        const ctx = pageCanvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

          let cursorY = 0;

          if (slice.activeTableAtStart) {
            ctx.drawImage(
              canvas,
              0,
              slice.activeTableAtStart.theadTopPx,
              canvas.width,
              slice.activeTableAtStart.theadHeightPx,
              0,
              cursorY,
              canvas.width,
              slice.activeTableAtStart.theadHeightPx
            );
            cursorY += slice.activeTableAtStart.theadHeightPx;
          }

          const bodyTopYOnPage = cursorY;
          const bodyBottomYOnPage = bodyTopYOnPage + slice.bodySliceHeightPx;

          ctx.drawImage(
            canvas,
            0,
            slice.sliceStartPx,
            canvas.width,
            slice.bodySliceHeightPx,
            0,
            bodyTopYOnPage,
            canvas.width,
            slice.bodySliceHeightPx
          );

          ctx.fillStyle = '#000000';
          for (const tb of slice.tableBorders) {
            const tableWidth = Math.max(1, tb.rightPx - tb.leftPx);
            if (tb.closeTop) {
              ctx.fillRect(tb.leftPx, bodyTopYOnPage, tableWidth, Math.max(1, Math.round(1 * scaleY)));
            }
            if (tb.closeBottom) {
              ctx.fillRect(
                tb.leftPx,
                Math.max(bodyTopYOnPage, bodyBottomYOnPage - borderThickness),
                tableWidth,
                borderThickness
              );
            }
          }
        }

        if (slice.pageIndex > 0) {
          pdf.addPage();
        }

        const pageSliceHeightMm = (pageCanvasHeightPx * usableWidthMm) / canvas.width;
        pdf.addImage(
          pageCanvas.toDataURL('image/jpeg', 0.96),
          'JPEG',
          marginMm,
          fallbackVerticalMarginMm,
          usableWidthMm,
          pageSliceHeightMm,
          undefined,
          'FAST'
        );
        stampConfidentialHeaderFooter(slice.pageIndex + 1);
      }
    }

    pdf.save(safeFileName);
    notifyExportSuccess(safeFileName, 'PDF');
  } catch (err: any) {
    notifyExportError(safeFileName, err?.message || 'PDF generation failed', 'PDF');
    throw err;
  } finally {
    if (clipHost.parentNode) {
      clipHost.parentNode.removeChild(clipHost);
    }
  }
}

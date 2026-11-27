export interface BoxBoundsPx {
  topPx: number;
  bottomPx: number;
}

export interface TableInfoPx {
  tableIndex: number;
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

export interface RawLayoutGeometry {
  totalHeight: number;
  headerBounds: { top: number; bottom: number } | null;
  tables: Array<{
    tableIndex: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    theadTop: number;
    theadBottom: number;
    tbodyTop: number;
    hasThead: boolean;
    rows: Array<{ top: number; bottom: number }>;
  }>;
  keepTogether: Array<{ top: number; bottom: number }>;
  sectionHeadings: Array<{ top: number; bottom: number }>;
  lineItems: Array<{ top: number; bottom: number }>;
}

export interface PageSliceSpec {
  pageIndex: number;
  sliceStartPx: number;
  sliceEndPx: number;
  bodySliceHeightPx: number;
  repeatDocHeader: boolean;
  activeTableAtStart: TableInfoPx | null;
  repeatedTopHeightPx: number;
  headerGapPx: number;
  tableBorders: Array<{
    leftPx: number;
    rightPx: number;
    closeTop: boolean;
    closeBottom: boolean;
  }>;
}

export function measureDomLayoutGeometry(rootEl: HTMLElement): RawLayoutGeometry {
  const rootRect = rootEl.getBoundingClientRect();
  // Normalize against any ancestor CSS transform: scale(...) on the preview card
  const rectScaleX =
    rootEl.offsetWidth > 0 && rootRect.width > 0 ? rootRect.width / rootEl.offsetWidth : 1;
  const rectScaleY =
    rootEl.offsetHeight > 0 && rootRect.height > 0 ? rootRect.height / rootEl.offsetHeight : 1;

  const toLocalX = (clientX: number) => (clientX - rootRect.left) / rectScaleX;
  const toLocalY = (clientY: number) => (clientY - rootRect.top) / rectScaleY;

  const totalHeight = Math.max(100, Math.ceil(rootEl.scrollHeight));

  const headerEl = rootEl.querySelector<HTMLElement>('[data-pdf-repeat-header="true"]');
  const headerBounds = headerEl
    ? (() => {
        const r = headerEl.getBoundingClientRect();
        return {
          top: Math.max(0, toLocalY(r.top)),
          bottom: Math.max(0, toLocalY(r.bottom)),
        };
      })()
    : null;

  const tables = Array.from(rootEl.querySelectorAll('table')).map((tbl, tableIndex) => {
    const tr = tbl.getBoundingClientRect();
    const theadEl = tbl.querySelector('thead');
    const tbodyEl = tbl.querySelector('tbody');
    const theadRect = theadEl ? theadEl.getBoundingClientRect() : null;
    const tbodyRect = tbodyEl ? tbodyEl.getBoundingClientRect() : null;
    const rows = Array.from(tbl.querySelectorAll('tbody tr')).map((row) => {
      const rr = row.getBoundingClientRect();
      return {
        top: toLocalY(rr.top),
        bottom: toLocalY(rr.bottom),
      };
    });
    return {
      tableIndex,
      left: toLocalX(tr.left),
      right: toLocalX(tr.right),
      top: toLocalY(tr.top),
      bottom: toLocalY(tr.bottom),
      theadTop: theadRect ? toLocalY(theadRect.top) : toLocalY(tr.top),
      theadBottom: theadRect ? toLocalY(theadRect.bottom) : toLocalY(tr.top),
      tbodyTop: tbodyRect
        ? toLocalY(tbodyRect.top)
        : theadRect
        ? toLocalY(theadRect.bottom)
        : toLocalY(tr.top),
      hasThead: Boolean(theadRect && theadRect.height > 1),
      rows,
    };
  });

  const keepTogether = Array.from(
    rootEl.querySelectorAll<HTMLElement>('[data-pdf-keep-together="true"]')
  )
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { top: toLocalY(r.top), bottom: toLocalY(r.bottom) };
    })
    .filter((b) => b.bottom > b.top + 4);

  const sectionHeadings = Array.from(
    rootEl.querySelectorAll<HTMLElement>('[data-pdf-section-heading="true"]')
  )
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { top: toLocalY(r.top), bottom: toLocalY(r.bottom) };
    })
    .filter((b) => b.bottom > b.top + 2);

  const lineItems = Array.from(
    rootEl.querySelectorAll<HTMLElement>('li, p, [data-pdf-line-item="true"]')
  )
    .map((el) => {
      const r = el.getBoundingClientRect();
      const top = toLocalY(r.top);
      const bottom = toLocalY(r.bottom);
      return { top, bottom };
    })
    .filter((b) => b.bottom - b.top >= 4 && b.bottom - b.top <= 48)
    .sort((a, b) => a.top - b.top);

  return {
    totalHeight,
    headerBounds,
    tables,
    keepTogether,
    sectionHeadings,
    lineItems,
  };
}

export function computePageSlices(
  raw: RawLayoutGeometry,
  maxPageContentPx: number,
  scaleX: number = 1,
  scaleY: number = 1,
  maxWidthPx: number = Number.MAX_SAFE_INTEGER,
  refineCutY?: (targetEndPx: number, minEndPx: number, activeTable: TableInfoPx | null) => number
): PageSliceSpec[] {
  const totalHeightPx = Math.round(raw.totalHeight * scaleY);

  const docHeader: (BoxBoundsPx & { heightPx: number }) | null = raw.headerBounds
    ? (() => {
        const topPx = Math.max(0, Math.floor(raw.headerBounds.top * scaleY));
        const bottomPx = Math.min(totalHeightPx, Math.ceil((raw.headerBounds.bottom + 2) * scaleY));
        const heightPx = Math.max(0, bottomPx - topPx);
        return heightPx > 4 ? { topPx, bottomPx, heightPx } : null;
      })()
    : null;

  const tableInfos: TableInfoPx[] = raw.tables.map((t) => {
    const topPx = Math.max(0, Math.floor(t.top * scaleY));
    const bottomPx = Math.min(totalHeightPx, Math.ceil(t.bottom * scaleY));
    const theadTopPx = Math.max(0, Math.floor((t.theadTop - 1) * scaleY));
    const theadBottomPx = Math.min(totalHeightPx, Math.ceil((t.theadBottom + 1) * scaleY));
    return {
      tableIndex: t.tableIndex,
      leftPx: Math.max(0, Math.floor((t.left - 1) * scaleX)),
      rightPx: Math.min(maxWidthPx, Math.ceil((t.right + 1) * scaleX)),
      topPx,
      bottomPx,
      theadTopPx,
      theadBottomPx,
      theadHeightPx: Math.max(0, theadBottomPx - theadTopPx),
      tbodyTopPx: Math.max(theadBottomPx, Math.floor(t.tbodyTop * scaleY)),
      hasThead: t.hasThead,
      rows: t.rows.map((r) => ({
        topPx: Math.max(0, Math.floor(r.top * scaleY)),
        bottomPx: Math.min(totalHeightPx, Math.ceil(r.bottom * scaleY)),
      })),
    };
  });

  const keepTogetherBlocks: BoxBoundsPx[] = raw.keepTogether.map((b) => ({
    topPx: Math.max(0, Math.floor(b.top * scaleY)),
    bottomPx: Math.min(totalHeightPx, Math.ceil(b.bottom * scaleY)),
  }));

  const sectionHeadings: BoxBoundsPx[] = raw.sectionHeadings.map((b) => ({
    topPx: Math.max(0, Math.floor(b.top * scaleY)),
    bottomPx: Math.min(totalHeightPx, Math.ceil(b.bottom * scaleY)),
  }));

  const lineItems: BoxBoundsPx[] = (raw.lineItems || []).map((b) => ({
    topPx: Math.max(0, Math.floor(b.top * scaleY)),
    bottomPx: Math.min(totalHeightPx, Math.ceil(b.bottom * scaleY)),
  }));

  const snapBetweenLineItems = (targetY: number, minY: number): number | null => {
    if (lineItems.length === 0) return null;
    const minScanY = Math.max(minY, targetY - Math.round(64 * scaleY));
    // Search upward from targetY for the highest Y inside [minScanY..targetY] that doesn't slice any lineItem
    let bestY: number | null = null;
    for (let y = targetY; y >= minScanY; y -= 1) {
      let overlaps = false;
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        if (li.topPx >= y) break;
        if (li.bottomPx > y) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        bestY = y;
        break;
      }
    }
    if (bestY !== null) {
      // Nudge 1px away from immediate bottom of above lineItem if there is breathing room
      return bestY;
    }
    // Fallback: pick top of lowest conflicting lineItem inside window
    let lowestTop: number | null = null;
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i];
      if (li.topPx < targetY && li.bottomPx > targetY && li.topPx >= minScanY) {
        if (lowestTop === null || li.topPx < lowestTop) {
          lowestTop = li.topPx;
        }
      }
    }
    return lowestTop !== null ? Math.max(minY, lowestTop - Math.round(1 * scaleY)) : null;
  };

  if (totalHeightPx <= maxPageContentPx + Math.round(4 * scaleY)) {
    return [
      {
        pageIndex: 0,
        sliceStartPx: 0,
        sliceEndPx: totalHeightPx,
        bodySliceHeightPx: totalHeightPx,
        repeatDocHeader: false,
        activeTableAtStart: null,
        repeatedTopHeightPx: 0,
        headerGapPx: 0,
        tableBorders: [],
      },
    ];
  }

  const headerGapPx = Math.round(6 * scaleY);
  const borderThickness = Math.max(2, Math.round(1.5 * scaleY));
  const minProgressPx = Math.round(36 * scaleY);
  const minBlockLeadPx = Math.round(8 * scaleY);

  const slices: PageSliceSpec[] = [];
  let sliceStartPx = 0;
  let pageIndex = 0;

  while (sliceStartPx < totalHeightPx - Math.round(3 * scaleY) && pageIndex < 100) {
    let repeatDocHeader = false;
    let activeTableAtStart: TableInfoPx | null = null;
    let repeatedTopHeightPx = 0;

    if (pageIndex > 0) {
      // Document heading is rendered on 1st page only; Page 2+ repeats only continued table <thead>
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
    const targetEndPx = Math.min(sliceStartPx + availableBodyPx, totalHeightPx);

    let sliceEndPx = targetEndPx;
    let nextSliceStartPx: number | null = null;

    if (targetEndPx >= totalHeightPx - Math.round(2 * scaleY)) {
      sliceEndPx = totalHeightPx;
    } else {
      const safeTargetEndPx = Math.max(
        sliceStartPx + minProgressPx,
        targetEndPx - borderThickness - Math.round(1 * scaleY)
      );

      // First check if we are cutting inside a keep-together block whose top fits cleanly on next page
      let blockBoundaryApplied = false;
      for (const block of keepTogetherBlocks) {
        const blockHeight = block.bottomPx - block.topPx;
        if (
          safeTargetEndPx > block.topPx + Math.round(4 * scaleY) &&
          safeTargetEndPx < block.bottomPx - Math.round(2 * scaleY) &&
          block.topPx > sliceStartPx + minBlockLeadPx &&
          blockHeight <= maxPageContentPx - Math.round(4 * scaleY)
        ) {
          sliceEndPx = Math.max(sliceStartPx + Math.round(4 * scaleY), block.topPx - Math.round(4 * scaleY));
          nextSliceStartPx = Math.max(sliceEndPx, block.topPx - Math.round(2 * scaleY));
          blockBoundaryApplied = true;
          break;
        }
      }

      if (!blockBoundaryApplied) {
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
          const activeTableAtEnd =
            tableInfos.find(
              (tbl) => safeTargetEndPx > tbl.topPx && safeTargetEndPx < tbl.bottomPx
            ) || null;
          const snappedLineY = snapBetweenLineItems(safeTargetEndPx, sliceStartPx + minProgressPx);
          if (snappedLineY !== null) {
            sliceEndPx = snappedLineY;
          } else {
            sliceEndPx = refineCutY
              ? refineCutY(safeTargetEndPx, sliceStartPx + minProgressPx, activeTableAtEnd)
              : safeTargetEndPx;
          }
        }

        // Re-check keep-together & orphaned headings after row/line cut
        for (const block of keepTogetherBlocks) {
          const blockHeight = block.bottomPx - block.topPx;
          if (
            sliceEndPx > block.topPx + Math.round(4 * scaleY) &&
            sliceEndPx < block.bottomPx - Math.round(2 * scaleY) &&
            block.topPx > sliceStartPx + minBlockLeadPx &&
            blockHeight <= maxPageContentPx - Math.round(4 * scaleY)
          ) {
            sliceEndPx = Math.max(sliceStartPx + Math.round(4 * scaleY), block.topPx - Math.round(4 * scaleY));
            nextSliceStartPx = Math.max(sliceEndPx, block.topPx - Math.round(2 * scaleY));
            break;
          }
        }

        for (const heading of sectionHeadings) {
          const nextTable = tableInfos.find(
            (tbl) => tbl.topPx >= heading.bottomPx && tbl.topPx - heading.bottomPx < Math.round(35 * scaleY)
          );
          const firstRowBottom = nextTable?.rows[0]?.bottomPx ?? heading.bottomPx + Math.round(60 * scaleY);
          if (
            sliceEndPx > heading.topPx &&
            sliceEndPx < firstRowBottom &&
            heading.topPx > sliceStartPx + minBlockLeadPx
          ) {
            sliceEndPx = Math.max(sliceStartPx + Math.round(4 * scaleY), heading.topPx - Math.round(4 * scaleY));
            nextSliceStartPx = Math.max(sliceEndPx, heading.topPx - Math.round(2 * scaleY));
            break;
          }
        }

        // Prevent leaving an orphaned table <thead> at the bottom of a page without its first row
        for (const tbl of tableInfos) {
          const firstRowBottom = tbl.rows[0]?.bottomPx;
          if (
            tbl.hasThead &&
            firstRowBottom !== undefined &&
            sliceEndPx > tbl.topPx + Math.round(2 * scaleY) &&
            sliceEndPx < firstRowBottom &&
            tbl.topPx > sliceStartPx + minBlockLeadPx
          ) {
            sliceEndPx = Math.max(sliceStartPx + Math.round(4 * scaleY), tbl.topPx - Math.round(4 * scaleY));
            nextSliceStartPx = Math.max(sliceEndPx, tbl.topPx - Math.round(2 * scaleY));
            break;
          }
        }
      }
    }

    const bodySliceHeightPx = Math.max(1, sliceEndPx - sliceStartPx);
    const tableBorders: PageSliceSpec['tableBorders'] = [];
    for (const tbl of tableInfos) {
      const overlapsPage =
        tbl.bottomPx > sliceStartPx + Math.round(4 * scaleY) &&
        tbl.topPx < sliceEndPx - Math.round(4 * scaleY);
      if (!overlapsPage) continue;
      tableBorders.push({
        leftPx: tbl.leftPx,
        rightPx: tbl.rightPx,
        closeTop: pageIndex > 0 && sliceStartPx > tbl.topPx && sliceStartPx < tbl.bottomPx,
        closeBottom: sliceEndPx < tbl.bottomPx - Math.round(2 * scaleY),
      });
    }

    slices.push({
      pageIndex,
      sliceStartPx,
      sliceEndPx,
      bodySliceHeightPx,
      repeatDocHeader,
      activeTableAtStart,
      repeatedTopHeightPx,
      headerGapPx,
      tableBorders,
    });

    const nextStart = nextSliceStartPx ?? sliceEndPx;
    if (nextStart <= sliceStartPx) {
      sliceStartPx += minProgressPx;
    } else {
      sliceStartPx = nextStart;
    }
    pageIndex++;
  }

  return slices;
}

import { PageOrientation } from 'docx';

export type PaperSize = 'a4' | 'letter' | 'legal' | 'a3';
export type PageOrientationType = 'landscape' | 'portrait';

export interface PageSetupConfig {
  paperSize: PaperSize;
  orientation: PageOrientationType;
}

export const PAPER_SIZE_OPTIONS: { value: PaperSize; label: string }[] = [
  { value: 'a4', label: 'A4' },
  { value: 'legal', label: 'Legal' },
  { value: 'letter', label: 'Letter' },
  { value: 'a3', label: 'A3' },
];

const PAPER_SPECS: Record<
  PaperSize,
  {
    label: string;
    shortPxW: number;
    longPxH: number;
    shortDxaW: number;
    longDxaH: number;
  }
> = {
  a4: {
    label: 'A4',
    shortPxW: 794,
    longPxH: 1123,
    shortDxaW: 11906,
    longDxaH: 16838,
  },
  letter: {
    label: 'Letter',
    shortPxW: 816,
    longPxH: 1056,
    shortDxaW: 12240,
    longDxaH: 15840,
  },
  legal: {
    label: 'Legal',
    shortPxW: 816,
    longPxH: 1344,
    shortDxaW: 12240,
    longDxaH: 20160,
  },
  a3: {
    label: 'A3',
    shortPxW: 1123,
    longPxH: 1587,
    shortDxaW: 16838,
    longDxaH: 23811,
  },
};

export function getPageDimensions(setup?: Partial<PageSetupConfig>) {
  const paperSize: PaperSize = setup?.paperSize && PAPER_SPECS[setup.paperSize] ? setup.paperSize : 'a4';
  const orientation: PageOrientationType = setup?.orientation === 'portrait' ? 'portrait' : 'landscape';
  const spec = PAPER_SPECS[paperSize];

  const widthPx = orientation === 'landscape' ? spec.longPxH : spec.shortPxW;
  const heightPx = orientation === 'landscape' ? spec.shortPxW : spec.longPxH;
  const widthDxa = orientation === 'landscape' ? spec.longDxaH : spec.shortDxaW;
  const heightDxa = orientation === 'landscape' ? spec.shortDxaW : spec.longDxaH;

  return {
    paperSize,
    paperLabel: spec.label,
    orientation,
    widthPx,
    heightPx,
    widthDxa,
    heightDxa,
    portraitDxaW: spec.shortDxaW,
    portraitDxaH: spec.longDxaH,
  };
}

export function getDocxPageSize(
  setup?: Partial<PageSetupConfig>,
  defaultOrientation: PageOrientationType = 'landscape'
) {
  const paperSize: PaperSize = setup?.paperSize && PAPER_SPECS[setup.paperSize] ? setup.paperSize : 'a4';
  const orientation: PageOrientationType = setup?.orientation || defaultOrientation;
  const spec = PAPER_SPECS[paperSize];

  return {
    width: spec.shortDxaW,
    height: spec.longDxaH,
    orientation:
      orientation === 'landscape'
        ? PageOrientation.LANDSCAPE
        : PageOrientation.PORTRAIT,
    usableWidthDxa: (orientation === 'landscape' ? spec.longDxaH : spec.shortDxaW) - 800,
  };
}

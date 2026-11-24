export interface DynamicPWAOfficeIdentity {
  officeName: string;
  officeLogo: string;
  officeCode?: string;
  officeSlogan?: string;
  officeBase?: string;
}

const DEFAULT_OFFICE_NAME = '155 UASU BAF';
const PWA_ASSET_VERSION = '26';
const UASU_192_ICON = `/pwa-192x192-trans.png?v=${PWA_ASSET_VERSION}`;
const UASU_512_ICON = `/pwa-512x512-trans.png?v=${PWA_ASSET_VERSION}`;
const UASU_MASKABLE_192 = `/pwa-192x192-full.png?v=${PWA_ASSET_VERSION}`;
const UASU_MASKABLE_512 = `/pwa-512x512-full.png?v=${PWA_ASSET_VERSION}`;

let lastSyncedSignature = '';
const iconResizeCache = new Map<
  string,
  { icon32: string; icon192: string; icon512: string; maskable192: string; maskable512: string; hash: string }
>();

function computeSimpleHash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `pwa_${(h >>> 0).toString(16)}`;
}

function resolveAbsoluteUrl(src: string): string {
  if (!src) return `${window.location.origin}${UASU_192_ICON}`;
  if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('blob:')) {
    return src;
  }
  return `${window.location.origin}${src.startsWith('/') ? src : `/${src}`}`;
}

function isGenericAppLogoUrl(logoStr: string): boolean {
  const s = String(logoStr || '').toLowerCase();
  return (
    !s ||
    s.includes('office-management-logo') ||
    s.includes('pwa-pc-192x192') ||
    s.includes('pwa-pc-512x512')
  );
}

/**
 * Updates all <link rel="icon">, <link rel="shortcut icon">, and <link rel="apple-touch-icon">
 * tags in document.head so the browser tab & address bar always display the full-size logo immediately.
 */
export function applyBrowserFaviconToHead(
  icon192Src: string,
  icon512Src?: string,
  icon32Src?: string
): void {
  if (typeof document === 'undefined' || !document.head) return;
  const target192 = icon192Src || `/baf-logo.png?v=${PWA_ASSET_VERSION}`;
  const target512 = icon512Src || target192;
  const targetSmall = icon32Src || target192;

  const appleTouchIcons = document.head.querySelectorAll<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  if (appleTouchIcons.length > 0) {
    appleTouchIcons.forEach((linkEl) => {
      linkEl.href = target192;
    });
  } else {
    const appleIcon = document.createElement('link');
    appleIcon.rel = 'apple-touch-icon';
    appleIcon.sizes = '180x180';
    appleIcon.href = target192;
    document.head.appendChild(appleIcon);
  }

  const favicons = document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]');
  if (favicons.length > 0) {
    favicons.forEach((linkEl) => {
      const sz = String(linkEl.sizes?.value || '');
      if (sz === '512x512') {
        linkEl.href = target512;
      } else if (sz === '32x32' || sz === '48x48') {
        linkEl.href = targetSmall;
      } else {
        linkEl.href = target192;
      }
    });
  } else {
    const iconLink = document.createElement('link');
    iconLink.id = 'pwa-icon-192';
    iconLink.rel = 'icon';
    iconLink.type = 'image/png';
    iconLink.href = target192;
    document.head.appendChild(iconLink);
  }
}

/**
 * Scans an HTMLImageElement on an offscreen canvas to locate its tight non-transparent bounding box,
 * eliminating wasted empty margins so logos fill 100% of browser tab, address bar, and PWA app icons.
 */
function getTrimmedImageBounds(img: HTMLImageElement): { sx: number; sy: number; sw: number; sh: number } {
  const w = img.naturalWidth || img.width || 512;
  const h = img.naturalHeight || img.height || 512;
  const full = { sx: 0, sy: 0, sw: w, sh: h };
  try {
    // Downscale scan canvas for speed on very large source images while keeping exact proportional coordinates
    const maxScan = 512;
    const scale = Math.min(1, maxScan / Math.max(w, h));
    const swScan = Math.max(1, Math.round(w * scale));
    const shScan = Math.max(1, Math.round(h * scale));

    const scanCanvas = document.createElement('canvas');
    scanCanvas.width = swScan;
    scanCanvas.height = shScan;
    const sctx = scanCanvas.getContext('2d', { willReadFrequently: true });
    if (!sctx) return full;
    sctx.clearRect(0, 0, swScan, shScan);
    sctx.drawImage(img, 0, 0, swScan, shScan);

    const imgData = sctx.getImageData(0, 0, swScan, shScan).data;
    let minX = swScan;
    let minY = shScan;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < shScan; y++) {
      for (let x = 0; x < swScan; x++) {
        const alpha = imgData[(y * swScan + x) * 4 + 3];
        if (alpha > 12) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX <= minX || maxY <= minY) return full;

    const invScale = 1 / scale;
    const sx = Math.max(0, Math.floor(minX * invScale));
    const sy = Math.max(0, Math.floor(minY * invScale));
    const ex = Math.min(w, Math.ceil((maxX + 1) * invScale));
    const ey = Math.min(h, Math.ceil((maxY + 1) * invScale));
    const sw = ex - sx;
    const sh = ey - sy;

    if (sw <= 0 || sh <= 0) return full;
    return { sx, sy, sw, sh };
  } catch {
    return full;
  }
}

/**
 * Auto-trims transparent borders and renders any office logo (URL or Base64) onto full-bleed
 * 48x48, 192x192, and 512x512 square canvases so browser tabs, address bar, and PWA icons render at maximum size.
 */
export async function generateSizedPwaIcons(
  logoSrc: string
): Promise<{ icon32: string; icon192: string; icon512: string; maskable192: string; maskable512: string; hash: string }> {
  const absSrc = resolveAbsoluteUrl(logoSrc);
  const cached = iconResizeCache.get(absSrc);
  if (cached) return cached;

  const hash = computeSimpleHash(`${absSrc}_v${PWA_ASSET_VERSION}`);

  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const bounds = getTrimmedImageBounds(img);

          const renderToSize = (size: number, isMaskable: boolean): string => {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            if (!ctx) return absSrc;

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            if (isMaskable) {
              ctx.fillStyle = '#020617';
              ctx.fillRect(0, 0, size, size);
            } else {
              ctx.clearRect(0, 0, size, size);
            }

            // 0% padding for standard tab/address-bar/PWA icons (100% edge-to-edge max size)
            // 5% tight safe-zone padding (90% visual fill) for maskable launcher icons
            const paddingRatio = isMaskable ? 0.05 : 0;
            const pad = Math.round(size * paddingRatio);
            const availW = size - pad * 2;
            const availH = size - pad * 2;

            const scale = Math.min(availW / bounds.sw, availH / bounds.sh);
            const drawW = Math.round(bounds.sw * scale);
            const drawH = Math.round(bounds.sh * scale);
            const dx = Math.round((size - drawW) / 2);
            const dy = Math.round((size - drawH) / 2);

            ctx.drawImage(img, bounds.sx, bounds.sy, bounds.sw, bounds.sh, dx, dy, drawW, drawH);
            return canvas.toDataURL('image/png');
          };

          const result = {
            icon32: renderToSize(48, false),
            icon192: renderToSize(192, false),
            icon512: renderToSize(512, false),
            maskable192: renderToSize(192, true),
            maskable512: renderToSize(512, true),
            hash,
          };
          iconResizeCache.set(absSrc, result);
          resolve(result);
        } catch {
          resolve({
            icon32: absSrc,
            icon192: absSrc,
            icon512: absSrc,
            maskable192: absSrc,
            maskable512: absSrc,
            hash,
          });
        }
      };
      img.onerror = () => {
        resolve({
          icon32: absSrc,
          icon192: absSrc,
          icon512: absSrc,
          maskable192: absSrc,
          maskable512: absSrc,
          hash,
        });
      };
      img.src = absSrc;
    } catch {
      resolve({
        icon32: absSrc,
        icon192: absSrc,
        icon512: absSrc,
        maskable192: absSrc,
        maskable512: absSrc,
        hash,
      });
    }
  });
}

function buildShortName(officeName: string): string {
  const trimmed = officeName.trim() || DEFAULT_OFFICE_NAME;
  if (trimmed.length <= 12) return trimmed;
  return trimmed.slice(0, 12).trim();
}

function resolveFallbackOfficeFromStorage(): DynamicPWAOfficeIdentity {
  if (typeof window === 'undefined') {
    return { officeName: DEFAULT_OFFICE_NAME, officeLogo: `/155-uasu-baf-logo.png?v=${PWA_ASSET_VERSION}`, officeCode: '155-UASU' };
  }
  try {
    const customOfficeRaw =
      window.localStorage.getItem('custom_office_config') ||
      window.localStorage.getItem('baf_custom_office_config');
    if (customOfficeRaw) {
      const cfg = JSON.parse(customOfficeRaw);
      if (cfg && cfg.officeName) {
        return {
          officeName: cfg.officeName,
          officeLogo: cfg.officeLogo || `/baf-logo.png?v=${PWA_ASSET_VERSION}`,
          officeCode: cfg.officeCode || cfg.firebaseConfig?.officeCode || '',
          officeSlogan: cfg.officeSlogan || cfg.firebaseConfig?.officeSlogan || '',
        };
      }
    }
    const savedMetaRaw = window.localStorage.getItem('baf_pwa_active_office_meta');
    if (savedMetaRaw) {
      const parsed = JSON.parse(savedMetaRaw);
      if (parsed && parsed.officeName && parsed.officeName !== 'Office Management' && parsed.officeName !== 'Office Management Application') {
        return {
          officeName: parsed.officeName,
          officeLogo: parsed.rawLogo || `/155-uasu-baf-logo.png?v=${PWA_ASSET_VERSION}`,
          officeCode: parsed.officeCode || '',
          officeSlogan: parsed.officeSlogan || '',
        };
      }
    }
  } catch {}
  return {
    officeName: DEFAULT_OFFICE_NAME,
    officeLogo: `/155-uasu-baf-logo.png?v=${PWA_ASSET_VERSION}`,
    officeCode: '155-UASU',
    officeSlogan: 'Intel • Surveillance • Strike',
  };
}

function postOfficeIdentityToServiceWorker(payload: {
  manifestJson: Record<string, any>;
  icon192DataUrl?: string;
  icon512DataUrl?: string;
  maskable512DataUrl?: string;
  is155Office: boolean;
}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const msg = {
      type: 'SET_PWA_OFFICE_IDENTITY',
      ...payload,
    };
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        reg.active?.postMessage(msg);
      })
      .catch(() => {});
  } catch {}
}

/**
 * Dynamically updates `<link rel="icon">`, `<link rel="apple-touch-icon">`,
 * `<link rel="manifest">`, `<meta name="apple-mobile-web-app-title">`, Service Worker (`sw.js`), and `server.ts`
 * so the browser tab and PWA always display the logged-in office's Logo & Name.
 */
export async function syncDynamicOfficePwaManifest(
  identity: DynamicPWAOfficeIdentity
): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  try {
    const rawName = String(identity.officeName || '').trim();
    const isGeneric =
      !rawName ||
      rawName === 'Office Management' ||
      rawName === 'Office Management Application' ||
      rawName === 'Office Management System';

    const effectiveIdentity: DynamicPWAOfficeIdentity = isGeneric
      ? resolveFallbackOfficeFromStorage()
      : identity;

    const appName = String(effectiveIdentity.officeName || DEFAULT_OFFICE_NAME).trim() || DEFAULT_OFFICE_NAME;
    const shortName = buildShortName(appName);
    const officeCode = String(effectiveIdentity.officeCode || '').trim();
    const slogan = String(effectiveIdentity.officeSlogan || '').trim();

    const is155Office =
      officeCode.toUpperCase() === '155-UASU' ||
      officeCode.toUpperCase() === '155UASU' ||
      (!officeCode && appName.toUpperCase().includes('155'));

    let rawLogo = String(effectiveIdentity.officeLogo || '').trim();
    if (!rawLogo) {
      rawLogo = is155Office
        ? `/155-uasu-baf-logo.png?v=${PWA_ASSET_VERSION}`
        : `/baf-logo.png?v=${PWA_ASSET_VERSION}`;
    } else if (isGenericAppLogoUrl(rawLogo)) {
      rawLogo = is155Office
        ? `/155-uasu-baf-logo.png?v=${PWA_ASSET_VERSION}`
        : `/baf-logo.png?v=${PWA_ASSET_VERSION}`;
    } else if (rawLogo === '/155-uasu-baf-logo.png') {
      rawLogo = `/155-uasu-baf-logo.png?v=${PWA_ASSET_VERSION}`;
    } else if (rawLogo === '/baf-logo.png') {
      rawLogo = `/baf-logo.png?v=${PWA_ASSET_VERSION}`;
    }

    // 1. Immediately apply the active office's logo to the browser tab favicon
    applyBrowserFaviconToHead(rawLogo, rawLogo, rawLogo);

    // Also generate crisp auto-trimmed full-bleed 48x48, 192x192, and 512x512 square icons for tab, address bar & PWA
    const sizedCustomIcons = await generateSizedPwaIcons(rawLogo);
    const tabIcon32 = sizedCustomIcons?.icon32 || rawLogo;
    const tabIcon192 = sizedCustomIcons?.icon192 || rawLogo;
    const tabIcon512 = sizedCustomIcons?.icon512 || rawLogo;
    applyBrowserFaviconToHead(tabIcon192, tabIcon512, tabIcon32);

    const customIconHash = sizedCustomIcons?.hash || computeSimpleHash(rawLogo);
    const sig = `${appName}__${customIconHash}__${officeCode}__${slogan}__v${PWA_ASSET_VERSION}`;
    if (sig === lastSyncedSignature) return;
    lastSyncedSignature = sig;

    // 2. Update iOS & mobile web app title meta tags
    let appleTitleMeta = document.head.querySelector<HTMLMetaElement>(
      'meta[name="apple-mobile-web-app-title"]'
    );
    if (!appleTitleMeta) {
      appleTitleMeta = document.createElement('meta');
      appleTitleMeta.name = 'apple-mobile-web-app-title';
      document.head.appendChild(appleTitleMeta);
    }
    appleTitleMeta.content = appName;

    let appNameMeta = document.head.querySelector<HTMLMetaElement>(
      'meta[name="application-name"]'
    );
    if (!appNameMeta) {
      appNameMeta = document.createElement('meta');
      appNameMeta.name = 'application-name';
      document.head.appendChild(appNameMeta);
    }
    appNameMeta.content = appName;

    const hasSizedPngDataUrls =
      Boolean(sizedCustomIcons?.icon192?.startsWith('data:image/')) &&
      Boolean(sizedCustomIcons?.icon512?.startsWith('data:image/'));

    const manifestIcon192Url = hasSizedPngDataUrls
      ? `/api/pwa-icon/${customIconHash}/icon-192.png`
      : tabIcon192;
    const manifestIcon512Url = hasSizedPngDataUrls
      ? `/api/pwa-icon/${customIconHash}/icon-512.png`
      : tabIcon512;
    const manifestMaskable192Url = hasSizedPngDataUrls
      ? `/api/pwa-icon/${customIconHash}/maskable-192.png`
      : sizedCustomIcons?.maskable192 || UASU_MASKABLE_192;
    const manifestMaskable512Url = hasSizedPngDataUrls
      ? `/api/pwa-icon/${customIconHash}/maskable-512.png`
      : sizedCustomIcons?.maskable512 || UASU_MASKABLE_512;

    // Save active office PWA metadata to localStorage so index.html synchronous head script has it on reload
    try {
      window.localStorage.setItem(
        'baf_pwa_active_office_meta',
        JSON.stringify({
          officeName: appName,
          shortName,
          officeCode,
          officeSlogan: slogan,
          rawLogo,
          is155Office,
          iconHash: customIconHash,
          icon192Url: tabIcon192,
          icon512Url: tabIcon512,
        })
      );
    } catch {}

    // 3. Build manifest payload and push to Service Worker (sw.js) BEFORE refreshing <link rel="manifest">
    const officeQuery = officeCode && !is155Office ? `?office=${encodeURIComponent(officeCode)}` : '';
    const description = slogan
      ? `${appName} — ${slogan}`
      : `Official PWA for ${appName} duty register, parade state, and personnel management.`;

    const manifestPayload = {
      id: '/',
      name: appName,
      short_name: shortName,
      description,
      start_url: `/${officeQuery}`,
      scope: '/',
      display: 'standalone',
      background_color: '#020617',
      theme_color: '#020617',
      orientation: 'any',
      icons: [
        {
          src: manifestIcon192Url,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: manifestIcon512Url,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any',
        },
        {
          src: manifestMaskable192Url,
          sizes: '192x192',
          type: 'image/png',
          purpose: 'maskable',
        },
        {
          src: manifestMaskable512Url,
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    };

    postOfficeIdentityToServiceWorker({
      manifestJson: manifestPayload,
      icon192DataUrl: sizedCustomIcons?.icon192,
      icon512DataUrl: sizedCustomIcons?.icon512,
      maskable512DataUrl: sizedCustomIcons?.maskable512,
      is155Office,
    });

    // 4. Upload PNG icons to server BEFORE updating <link rel="manifest"> so server /api/pwa-manifest serves the exact new logo immediately
    try {
      await fetch('/api/pwa-icon-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeName: appName,
          officeCode: officeCode || (is155Office ? '155-UASU' : ''),
          officeSlogan: slogan || (is155Office ? 'Intel • Surveillance • Strike' : ''),
          is155Office,
          iconHash: customIconHash,
          icon192DataUrl: sizedCustomIcons?.icon192,
          icon512DataUrl: sizedCustomIcons?.icon512,
          maskable512DataUrl: sizedCustomIcons?.maskable512,
        }),
      });
    } catch {}

    // 5. Update <link rel="manifest"> in document.head with fresh iconHash so browser picks up the new PWA logo in realtime
    const params = new URLSearchParams();
    params.set('name', appName);
    if (!rawLogo.startsWith('data:')) {
      params.set('logo', rawLogo);
    }
    if (customIconHash) {
      params.set('iconHash', customIconHash);
    }
    if (officeCode) params.set('code', officeCode);
    if (slogan) params.set('slogan', slogan);
    params.set('v', PWA_ASSET_VERSION);
    const nextManifestHref = `/api/pwa-manifest?${params.toString()}`;

    let manifestLink = document.head.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = nextManifestHref;

    window.dispatchEvent(
      new CustomEvent('baf_pwa_identity_updated', {
        detail: {
          officeName: appName,
          shortName,
          officeLogo: tabIcon192,
          rawLogo,
          isGeneric: false,
        },
      })
    );
  } catch (err) {
    console.warn('[dynamicPwaManifest] Failed to sync dynamic manifest:', err);
  }
}

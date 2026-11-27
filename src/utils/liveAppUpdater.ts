// Real-Time Live App & PWA Auto-Updater
// Detects newly deployed versions via:
// 1. Service Worker updates (sw.js updateViaCache: 'none')
// 2. Production index.html bundle hash changes (works on Cloudflare Pages / static hosts & Cloud Run)
// 3. Server SSE buildId changes (/api/realtime/events & /api/app-build-version)

const RELOADED_SIG_SESSION_KEY = 'baf_live_reloaded_sig_v1';

let isInitialized = false;
let initialBuildId: string | null = null;
let initialBundleSig: string | null = null;
let reloadScheduled = false;

function extractProductionBundleSignature(htmlText: string): string | null {
  try {
    const matches = Array.from(
      htmlText.matchAll(/<(?:script|link)[^>]+(?:src|href)=["'](\/assets\/[^"']+)["']/gi)
    ).map((m) => m[1]);
    if (matches.length === 0) return null;
    return matches.sort().join('|');
  } catch {
    return null;
  }
}

function getCurrentDocumentBundleSignature(): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const urls: string[] = [];
    document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="modulepreload"][href]').forEach((el) => {
      const val = el.getAttribute('src') || el.getAttribute('href') || '';
      if (val.includes('/assets/')) {
        urls.push(val);
      }
    });
    if (urls.length === 0) return null;
    return urls.sort().join('|');
  } catch {
    return null;
  }
}

function showUpdatingToastAndReload(targetSig: string) {
  if (reloadScheduled) return;
  try {
    const lastReloaded = window.sessionStorage.getItem(RELOADED_SIG_SESSION_KEY);
    if (lastReloaded && lastReloaded === targetSig) {
      return;
    }
    window.sessionStorage.setItem(RELOADED_SIG_SESSION_KEY, targetSig);
  } catch {}

  reloadScheduled = true;

  try {
    window.dispatchEvent(new CustomEvent('baf_prepare_auto_logout', { detail: { isAutoLogout: false } }));
  } catch {}

  // Show a brief non-intrusive toast in the top corner so the user knows the latest update is applying
  try {
    const banner = document.createElement('div');
    banner.style.position = 'fixed';
    banner.style.top = '14px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '99999';
    banner.style.background = '#059669';
    banner.style.color = '#ffffff';
    banner.style.padding = '8px 16px';
    banner.style.borderRadius = '9999px';
    banner.style.fontSize = '12px';
    banner.style.fontWeight = '700';
    banner.style.boxShadow = '0 10px 25px rgba(0,0,0,0.35)';
    banner.textContent = 'New update deployed — refreshing app...';
    document.body?.appendChild(banner);
  } catch {}

  setTimeout(() => {
    window.location.reload();
  }, 500);
}

async function checkHtmlBundleUpdate(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  if (!initialBundleSig) return; // Skip in Vite dev mode where /assets/*.js doesn't exist

  try {
    const res = await fetch(`/?_live_v=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
    });
    if (!res.ok) return;
    const html = await res.text();
    const remoteSig = extractProductionBundleSignature(html);
    if (remoteSig && remoteSig !== initialBundleSig) {
      showUpdatingToastAndReload(`bundle:${remoteSig}`);
    }
  } catch {}
}

async function checkServerBuildVersion(): Promise<void> {
  if (typeof window === 'undefined' || !navigator.onLine) return;
  try {
    const res = await fetch(`/api/app-build-version?_t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return;
    const data = await res.json();
    const buildId = data?.buildId ? String(data.buildId) : '';
    if (!buildId) return;

    if (!initialBuildId) {
      initialBuildId = buildId;
      return;
    }
    if (buildId !== initialBuildId) {
      showUpdatingToastAndReload(`build:${buildId}`);
    }
  } catch {}
}

export function initLiveAppUpdater(): void {
  if (typeof window === 'undefined' || isInitialized) return;
  isInitialized = true;

  initialBundleSig = getCurrentDocumentBundleSignature();

  let swReg: ServiceWorkerRegistration | null = null;
  let initialSwControllerScript = navigator.serviceWorker?.controller?.scriptURL || null;

  // 1. Register / update Service Worker with updateViaCache: 'none'
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('/sw.js?v=28', { updateViaCache: 'none' })
      .then((reg) => {
        swReg = reg;
        reg.update().catch(() => {});

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch(() => {});

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const nextUrl = navigator.serviceWorker.controller?.scriptURL || 'updated';
      if (initialSwControllerScript && nextUrl !== initialSwControllerScript) {
        void checkHtmlBundleUpdate();
        void checkServerBuildVersion();
      }
      initialSwControllerScript = nextUrl;
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_UPDATED') {
        void checkHtmlBundleUpdate();
        void checkServerBuildVersion();
      }
    });
  }

  // 2. Listen to server SSE buildId changes so deploys reload Live App & PWA immediately
  const handleSseRealtimeEvent = (e: Event) => {
    const detail = (e as CustomEvent)?.detail;
    const nextBuildId = detail?.buildId ? String(detail.buildId) : '';
    if (!nextBuildId) return;
    if (!initialBuildId) {
      initialBuildId = nextBuildId;
      return;
    }
    if (nextBuildId !== initialBuildId) {
      showUpdatingToastAndReload(`build:${nextBuildId}`);
    }
  };
  window.addEventListener('baf_server_build_id', handleSseRealtimeEvent);

  const runUpdateChecks = () => {
    if (document.visibilityState === 'hidden') return;
    if (swReg) {
      swReg.update().catch(() => {});
    }
    void checkHtmlBundleUpdate();
    void checkServerBuildVersion();
  };

  // Initial baseline check
  void checkServerBuildVersion();

  // Check whenever user returns to the Live App or opens the installed PWA from background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runUpdateChecks();
    }
  });
  window.addEventListener('focus', runUpdateChecks);
  window.addEventListener('online', runUpdateChecks);

  // Periodic background check every 30 seconds while open
  setInterval(runUpdateChecks, 30_000);
}

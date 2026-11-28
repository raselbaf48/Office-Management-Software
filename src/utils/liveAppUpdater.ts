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

let activeBannerEl: HTMLDivElement | null = null;
let pendingUpdateSig: string | null = null;
let dismissedSig: string | null = null;

function applyPendingUpdate(targetSig: string) {
  if (reloadScheduled) return;
  reloadScheduled = true;

  try {
    window.sessionStorage.setItem(RELOADED_SIG_SESSION_KEY, targetSig);
  } catch {}

  try {
    window.dispatchEvent(new CustomEvent('baf_prepare_auto_logout', { detail: { isAutoLogout: false } }));
  } catch {}

  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then((reg) => {
        if (reg?.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
      }).catch(() => {});
    }
  } catch {}

  setTimeout(() => {
    window.location.reload();
  }, 150);
}

function showUpdatingToastAndReload(targetSig: string) {
  if (reloadScheduled) return;
  try {
    const lastReloaded = window.sessionStorage.getItem(RELOADED_SIG_SESSION_KEY);
    if (lastReloaded && lastReloaded === targetSig) {
      return;
    }
  } catch {}

  if (dismissedSig === targetSig) {
    return;
  }

  pendingUpdateSig = targetSig;

  // If the prompt banner is already rendered, just keep its latest targetSig updated
  if (activeBannerEl && document.body?.contains(activeBannerEl)) {
    return;
  }

  try {
    const banner = document.createElement('div');
    banner.id = 'baf-live-update-banner';
    banner.style.position = 'fixed';
    banner.style.top = '14px';
    banner.style.left = '50%';
    banner.style.transform = 'translateX(-50%)';
    banner.style.zIndex = '99999';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.gap = '10px';
    banner.style.background = '#0f172a';
    banner.style.color = '#f8fafc';
    banner.style.border = '1px solid rgba(16, 185, 129, 0.5)';
    banner.style.padding = '7px 10px 7px 14px';
    banner.style.borderRadius = '9999px';
    banner.style.fontSize = '12px';
    banner.style.fontWeight = '700';
    banner.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.45)';
    banner.style.maxWidth = 'calc(100vw - 24px)';
    banner.style.whiteSpace = 'nowrap';

    const dot = document.createElement('span');
    dot.style.width = '8px';
    dot.style.height = '8px';
    dot.style.borderRadius = '9999px';
    dot.style.background = '#10b981';
    dot.style.flexShrink = '0';

    const label = document.createElement('span');
    label.textContent = 'New Version Available';

    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.textContent = 'Update Now';
    updateBtn.style.background = '#059669';
    updateBtn.style.color = '#ffffff';
    updateBtn.style.border = 'none';
    updateBtn.style.padding = '5px 12px';
    updateBtn.style.borderRadius = '9999px';
    updateBtn.style.fontSize = '11px';
    updateBtn.style.fontWeight = '800';
    updateBtn.style.cursor = 'pointer';
    updateBtn.style.letterSpacing = '0.02em';
    updateBtn.onmouseenter = () => {
      updateBtn.style.background = '#10b981';
    };
    updateBtn.onmouseleave = () => {
      updateBtn.style.background = '#059669';
    };
    updateBtn.onclick = () => {
      updateBtn.disabled = true;
      updateBtn.textContent = 'Updating...';
      updateBtn.style.opacity = '0.8';
      applyPendingUpdate(pendingUpdateSig || targetSig);
    };

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.title = 'Later';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = '#94a3b8';
    closeBtn.style.border = 'none';
    closeBtn.style.padding = '0 4px';
    closeBtn.style.fontSize = '16px';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.cursor = 'pointer';
    closeBtn.onclick = () => {
      dismissedSig = pendingUpdateSig || targetSig;
      banner.remove();
      activeBannerEl = null;
    };

    banner.appendChild(dot);
    banner.appendChild(label);
    banner.appendChild(updateBtn);
    banner.appendChild(closeBtn);
    document.body?.appendChild(banner);
    activeBannerEl = banner;
  } catch {}
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

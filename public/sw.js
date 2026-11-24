const PWA_SW_VERSION = 'v27';
let activeOfficePwaData = null;

function dataUrlToUint8Array(dataUrl) {
  try {
    const parts = String(dataUrl || '').split(',');
    if (parts.length < 2) return null;
    const raw = atob(parts[1]);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      arr[i] = raw.charCodeAt(i);
    }
    return arr;
  } catch (e) {
    return null;
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'SET_PWA_OFFICE_IDENTITY') {
    activeOfficePwaData = {
      manifestJson: data.manifestJson || null,
      icon192Bytes: data.icon192DataUrl ? dataUrlToUint8Array(data.icon192DataUrl) : null,
      icon512Bytes: data.icon512DataUrl ? dataUrlToUint8Array(data.icon512DataUrl) : null,
      maskable512Bytes: data.maskable512DataUrl ? dataUrlToUint8Array(data.maskable512DataUrl) : null,
      is155Office: Boolean(data.is155Office),
    };
  }
});

self.addEventListener('fetch', (event) => {
  try {
    const url = new URL(event.request.url);
    const p = url.pathname;

    // 1. Intercept Web App Manifest requests (/manifest.json or /api/pwa-manifest)
    if (p === '/manifest.json' || p === '/api/pwa-manifest') {
      if (activeOfficePwaData && activeOfficePwaData.manifestJson) {
        event.respondWith(
          new Response(JSON.stringify(activeOfficePwaData.manifestJson), {
            status: 200,
            headers: {
              'Content-Type': 'application/manifest+json; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
          })
        );
        return;
      }
      event.respondWith(fetch(event.request, { cache: 'no-store' }));
      return;
    }

    // 2. Intercept Active Office 192x192 / 512x512 Icon requests for ALL offices
    if (
      p === '/api/pwa-active-icon-192.png' ||
      p === '/api/pwa-active-icon-512.png' ||
      p === '/api/pwa-active-maskable-512.png' ||
      p.startsWith('/api/pwa-icon/')
    ) {
      if (activeOfficePwaData) {
        const is192 = p.includes('192');
        const isMask = p.includes('maskable');
        const bytes = is192
          ? activeOfficePwaData.icon192Bytes
          : isMask
            ? activeOfficePwaData.maskable512Bytes || activeOfficePwaData.icon512Bytes
            : activeOfficePwaData.icon512Bytes;
        if (bytes) {
          event.respondWith(
            new Response(bytes, {
              status: 200,
              headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
              },
            })
          );
          return;
        }
      }
      event.respondWith(fetch(event.request, { cache: 'no-store' }));
      return;
    }
  } catch (e) {}
});


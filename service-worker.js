// Update this version whenever the admin app shell changes.
const CACHE_NAME = 'dfl-admin-pwa-20261008-4';
const SHELL = [
  '/',
  '/index.html',
  '/reset-password.html',
  '/css.css',
  '/js.js',
  '/manifest.json',
  '/favicons/android-chrome-192x192.png',
  '/favicons/android-chrome-512x512.png',
  '/favicons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async path => {
      try {
        const response = await fetch(new Request(path, { cache: 'no-store' }));
        if (response.ok) await cache.put(path, response);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('dfl-admin-pwa-') && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Always prefer the latest HTML, JavaScript and CSS. Cached shell is an offline fallback.
  if (request.mode === 'navigate' || request.destination === 'document' ||
      /\.(?:js|css|json|png|ico|svg|webp)$/.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(new Request(request, { cache: 'no-store' }));
        if (response.ok && url.pathname !== '/service-worker.js') {
          const cache = await caches.open(CACHE_NAME);
          cache.put(url.pathname, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        const cache = await caches.open(CACHE_NAME);
        const fallback = await cache.match(url.pathname) ||
          ((request.mode === 'navigate' || request.destination === 'document') ? await cache.match('/index.html') : null);
        if (fallback) return fallback;
        throw error;
      }
    })());
  }
});

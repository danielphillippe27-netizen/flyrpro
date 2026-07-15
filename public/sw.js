/**
 * Minimal offline fallback only. Do not precache HTML — after a deploy, a stale
 * cached document breaks Next.js chunk loading (client-side exception).
 */
const CACHE_NAME = 'wolfgrid-nav-fallback-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) return caches.delete(key);
          return undefined;
        })
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match('/');
      return fallback || Response.error();
    })
  );
});

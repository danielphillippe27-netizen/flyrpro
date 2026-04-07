self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('flyr-shell-v1').then((cache) => cache.addAll(['/']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open('flyr-shell-v1');
      const fallback = await cache.match('/');
      return fallback || Response.error();
    })
  );
});

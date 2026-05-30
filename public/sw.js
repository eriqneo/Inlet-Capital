const CACHE_NAME = 'inlet-v4';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/styles/index.css',
  '/src/app.js',
  '/src/core/db.js',
  '/src/core/schema.js',
  '/src/core/router.js',
  '/src/core/auth.js',
  '/src/core/numberGen.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Outfit:wght@500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then((networkResponse) => {
        // Check if we received a valid response
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        // Cache same-origin assets dynamically
        const url = new URL(event.request.url);
        if (url.origin === location.origin) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        
        return networkResponse;
      }).catch(() => {
        // Fallback for failed network requests when offline
        console.error('Fetch failed; returning offline page instead.', event.request.url);
      });
    })
  );
});

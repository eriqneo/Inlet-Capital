const CACHE_NAME = 'inlet-v6-swr';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/styles/index.css',
  '/src/app.js',
  '/src/core/router.js',
  '/src/core/utils.js',
  '/src/components/Layout.js',
  '/src/components/Sidebar.js',
  '/src/components/Header.js',
  '/src/components/Toast.js',
  '/src/components/Dialog.js',
  '/src/services/api.js',
  '/src/services/authService.js',
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

// Stale-While-Revalidate Strategy
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Don't cache API calls to PocketBase
  if (event.request.url.includes('pockethost.io')) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);
      
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          // Update the cache in the background
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      }).catch(() => {
        console.warn('Network request failed, relying on cache', event.request.url);
      });

      // Return the cached response immediately if available, otherwise wait for the network
      return cachedResponse || fetchPromise;
    })
  );
});

const CACHE_NAME = 'inlet-v10-permission-refresh';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
]; // Only cache the roots; we will let the browser cache hashed assets dynamically

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. STRICT EXCLUSIONS (Network Only)
  // Completely bypass caching for PocketHost API, WebSockets, or browser extensions
  if (
    url.hostname.includes('pockethost.io') ||
    url.protocol.startsWith('chrome-extension') ||
    url.pathname.startsWith('/api/') ||
    event.request.method !== 'GET'
  ) {
    return; // Will fall back to standard browser network request natively
  }

  // Always prefer the deployed app shell so permission and navigation fixes are not hidden by stale HTML.
  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => caches.match(event.request).then(response => response || caches.match('/index.html')))
    );
    return;
  }

  // 2. VITE HASHED ASSETS (Cache First, Fallback to Network)
  // If it's a built asset in the dist/assets folder, it has a hash and is immutable
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. DEFAULT (Stale-While-Revalidate / Network-First for HTML & dynamic imports)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for offline mode if both network and cache fail
        console.warn('Offline mode: Network request failed', url.href);
      });

      return cachedResponse || fetchPromise;
    })
  );
});

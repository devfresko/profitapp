// Fresko P&L — Service Worker v2.0
var CACHE_NAME = 'fresko-v2';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png'
];

// Install — cache app shell
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(SHELL);
    })
  );
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — serve from cache, pass through GAS/CDN calls
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always pass through to network:
  // - GAS API calls (script.google.com)
  // - Google APIs
  // - CDN resources (fonts, charts, sweetalert)
  if (
    url.indexOf('script.google.com') >= 0 ||
    url.indexOf('googleapis.com') >= 0 ||
    url.indexOf('fonts.gstatic.com') >= 0 ||
    url.indexOf('cdnjs.cloudflare.com') >= 0 ||
    url.indexOf('cdn.jsdelivr.net') >= 0
  ) {
    return; // let browser handle
  }

  // For app shell files: cache first, fallback to network
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      return cached || fetch(e.request).catch(function() {
        // Offline fallback: serve index.html
        return caches.match('./index.html');
      });
    })
  );
});

// Kudukka service worker: keeps the app shell available offline.
// Bump VERSION when files change so phones pick up the new version.
const VERSION = 'kudukka-v2';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/data.js',
  'js/calc.js',
  'js/pin.js',
  'js/icons.js',
  'js/firebase.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || url.hostname === 'www.gstatic.com' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com');
  if (!cacheable) return; // Firestore and sign-in traffic always goes to the network.

  // Network first, so updates show up straight away; fall back to the cache when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('index.html') : undefined))),
  );
});

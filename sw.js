// Offline-Fähigkeit: App-Dateien werden gecacht. Online wird immer zuerst
// das Netz gefragt (damit Updates sofort ankommen), offline der Cache.
const CACHE = 'time-tracker-v1';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/store.js',
  'js/dropbox.js',
  'js/pdf.js',
  'js/format.js',
  'js/config.js',
  'vendor/jspdf.umd.min.js',
  'assets/logo.png',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true })
        .then(hit => hit || (event.request.mode === 'navigate' ? caches.match('./') : undefined)))
  );
});

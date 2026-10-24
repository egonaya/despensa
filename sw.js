// Service worker: guarda la app para que abra sin conexión.
// Sube VERSION cada vez que cambies algún archivo para que los móviles se actualicen.
const VERSION = 'despensa-v6';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/off.js', 'js/scanner.js', 'js/util.js', 'js/foods.js',
  'js/recipes.js', 'js/planner.js', 'js/views/plan.js', 'js/views/more.js', 'js/views/ticket.js', 'js/ticket.js', 'vendor/zxing.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const IMAGES = 'despensa-images';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== IMAGES).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  // Fotos de productos: se guardan para verlas sin conexión.
  if (url.hostname === 'images.openfoodfacts.org') {
    e.respondWith(caches.open(IMAGES).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
      return res;
    }));
    return;
  }

  // Archivos de la app: primero red (para recibir cambios), si falla, caché.
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })));
  }
});

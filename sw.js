// Service worker: aplikasi tetap terbuka tanpa internet.
// Berkas aplikasi: ambil dari jaringan dulu (selalu terbaru), cadangan dari cache bila offline.
// Pustaka CDN (versi terkunci): ambil dari cache dulu.
const CACHE = 'kasirqr-v2';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/auth.js', './js/cart.js', './js/csv.js', './js/db.js', './js/dialogs.js', './js/format.js',
  './js/icons.js', './js/qr.js', './js/qrcode.js', './js/qrcard.js', './js/qris.js', './js/receipt.js', './js/scanner.js',
  './js/store.js', './js/ui.js', './js/catalog.js',
  './js/pages/beranda.js', './js/pages/kasir.js', './js/pages/cekharga.js', './js/pages/produk.js', './js/pages/label.js',
  './js/pages/pelanggan.js',
  './js/pages/riwayat.js', './js/pages/laporan.js', './js/pages/pengaturan.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];
const CDN = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    // cukup satu sumber pemindai yang tersimpan; sumber lain dicoba bila gagal
    for (const u of CDN) { try { await cache.add(u); break; } catch { /* coba berikutnya */ } }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN.includes(req.url)) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    } catch {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('./index.html');
      throw new Error('offline');
    }
  })());
});

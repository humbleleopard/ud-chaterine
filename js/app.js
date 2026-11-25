// Titik masuk aplikasi: memuat data, menggambar navigasi, dan mengatur rute halaman.
import * as store from './store.js';
import { icon } from './icons.js';
import { $, $$, toast, setBeep, openModal } from './ui.js';
import { esc } from './format.js';
import { isUnlocked, pinEnabled, requireUnlock, setUnlocked } from './auth.js';

const ROUTES = {
  '': () => import('./pages/beranda.js'),
  kasir: () => import('./pages/kasir.js'),
  'cek-harga': () => import('./pages/cekharga.js'),
  produk: () => import('./pages/produk.js'),
  pelanggan: () => import('./pages/pelanggan.js'),
  label: () => import('./pages/label.js'),
  riwayat: () => import('./pages/riwayat.js'),
  laporan: () => import('./pages/laporan.js'),
  pengaturan: () => import('./pages/pengaturan.js'),
};

const NAV = [
  { path: '', label: 'Beranda', icon: 'home' },
  { path: 'kasir', label: 'Kasir', icon: 'cart' },
  { path: 'cek-harga', label: 'Cek Harga', icon: 'scan' },
  { path: 'produk', label: 'Produk & Stok', short: 'Produk', icon: 'box', locked: true },
  { path: 'pelanggan', label: 'Pelanggan & Kasbon', short: 'Pelanggan', icon: 'users' },
  { path: 'riwayat', label: 'Riwayat', icon: 'clock', locked: true },
  { path: 'laporan', label: 'Laporan', icon: 'chart', locked: true },
  { path: 'label', label: 'Label QR', icon: 'qr', locked: true },
  { path: 'pengaturan', label: 'Pengaturan', icon: 'settings', locked: true },
];
const TABBAR = ['', 'kasir', 'cek-harga', 'produk'];
const TITLES = Object.fromEntries(NAV.map((n) => [n.path, n.label]));

let cleanup = null;
let navToken = 0;
let currentPath = null;

function renderShell() {
  const s = store.state.settings;
  const lockBtn = pinEnabled()
    ? `<button type="button" class="nav-lock" data-lock>${icon(isUnlocked() ? 'unlock' : 'lock')}<span>${isUnlocked() ? 'Kunci halaman pemilik' : 'Halaman pemilik terkunci'}</span></button>`
    : '';
  $('#sidebar').innerHTML = `
    <a class="brand" href="#/">
      <span class="brand-mark">${icon('leaf')}</span>
      <span class="brand-text"><strong>${esc(s.storeName)}</strong><small>${esc(s.tagline || 'Toko Pertanian')}</small></span>
    </a>
    <nav class="nav" aria-label="Menu utama">
      ${NAV.map((n) => `<a href="#/${n.path}" data-path="${n.path}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.locked && pinEnabled() && !isUnlocked() ? icon('lock', 'nav-lock-ic') : ''}</a>`).join('')}
    </nav>
    ${lockBtn}`;
  $('#tabbar').innerHTML = `
    ${TABBAR.map((p) => { const n = NAV.find((x) => x.path === p); return `<a href="#/${p}" data-path="${p}">${icon(n.icon)}<span>${esc(n.short || n.label)}</span></a>`; }).join('')}
    <button type="button" data-more>${icon('menu')}<span>Lainnya</span></button>`;
  $('#tabbar [data-more]').onclick = openMoreMenu;
  $('#sidebar [data-lock]')?.addEventListener('click', toggleLock);
  highlight();
}

async function toggleLock() {
  if (isUnlocked()) {
    setUnlocked(false);
    toast('Halaman pemilik dikunci');
    renderShell();
    if (NAV.find((n) => n.path === currentPath)?.locked) location.hash = '#/kasir';
  } else if (await requireUnlock()) {
    renderShell();
  }
}

function openMoreMenu() {
  const m = openModal({
    title: 'Menu',
    size: 'sm sheet',
    body: `<nav class="more-nav">${NAV.filter((n) => !TABBAR.includes(n.path)).map((n) => `<a href="#/${n.path}" data-close>${icon(n.icon)}<span>${esc(n.label)}</span>${icon('chevronRight', 'chev')}</a>`).join('')}
      ${pinEnabled() ? `<button type="button" class="more-lock" data-lock>${icon(isUnlocked() ? 'lock' : 'unlock')}<span>${isUnlocked() ? 'Kunci halaman pemilik' : 'Buka kunci halaman pemilik'}</span></button>` : ''}</nav>`,
  });
  m.$('[data-lock]')?.addEventListener('click', () => { m.close(); toggleLock(); });
}

function highlight() {
  $$('[data-path]').forEach((a) => a.classList.toggle('active', a.dataset.path === currentPath));
}

async function route() {
  const token = ++navToken;
  const hash = decodeURI(location.hash.replace(/^#\/?/, ''));
  const [rawPath, ...params] = hash.split('/');
  const [path, query = ''] = rawPath.split('?');
  const key = path in ROUTES ? path : '';
  const navItem = NAV.find((n) => n.path === key);

  if (navItem?.locked && !isUnlocked()) {
    const ok = await requireUnlock();
    if (token !== navToken) return;
    if (!ok) { if (currentPath === null) location.hash = '#/'; else history.back(); return; }
    renderShell();
  }

  if (cleanup) { const c = cleanup; cleanup = null; try { await c(); } catch (e) { console.error(e); } }
  if (token !== navToken) return;

  currentPath = key;
  highlight();
  document.body.dataset.page = key || 'beranda';
  document.title = `${TITLES[key] || 'Beranda'} · ${store.state.settings.storeName}`;
  const view = $('#view');
  view.innerHTML = '<div class="page-loading"><span class="spinner"></span></div>';
  try {
    const mod = await ROUTES[key]();
    if (token !== navToken) return;
    view.innerHTML = '';
    view.scrollTop = 0;
    window.scrollTo(0, 0);
    const c = await mod.render(view, { params: params.map(decodeURIComponent), query: new URLSearchParams(query) });
    if (token !== navToken) { try { await c?.(); } catch { /* abaikan */ } return; }
    cleanup = typeof c === 'function' ? c : null;
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="page"><div class="notice bad">${icon('alert')}<span>Halaman gagal dimuat: ${esc(err.message)}</span></div></div>`;
  }
}

async function main() {
  try {
    await store.init();
  } catch (err) {
    $('#view').innerHTML = `<div class="page"><div class="notice bad">${icon('alert')}<span>${esc(err.message || 'Database tidak bisa dibuka.')}</span></div></div>`;
    return;
  }
  setBeep(store.state.settings.beep);
  renderShell();
  store.subscribe((what) => {
    if (what === 'settings' || what === 'all') {
      setBeep(store.state.settings.beep);
      renderShell();
    }
  });
  window.addEventListener('hashchange', route);
  await route();

  // Minta browser tidak menghapus data toko saat penyimpanan hampir penuh
  try { await navigator.storage?.persist?.(); } catch { /* abaikan */ }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

main();

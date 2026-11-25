// Halaman Cek Harga: scan barang untuk melihat harga, stok, bahan aktif, dosis, dan kedaluwarsa.
import * as store from '../store.js';
import { CameraScanner, cameraPanelHTML, wireCameraPanel, cameraErrorMessage } from '../scanner.js';
import { toast, beep, isTouch, autoFocusOnType, thumb, productArt } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, fmtTime, fmtDate } from '../format.js';
import { addToSavedCart } from '../cart.js';
import { isUnlocked } from '../auth.js';
import { openStockDialog } from '../dialogs.js';
import { openQrDialog } from '../qrcard.js';

export function expiryText(p) {
  const d = store.daysToExpiry(p);
  if (d === null) return '';
  if (d < 0) return `Kedaluwarsa sejak ${fmtDate(p.expiry)}`;
  if (d === 0) return 'Kedaluwarsa hari ini';
  return `Kedaluwarsa ${fmtDate(p.expiry)} (${d} hari lagi)`;
}

export async function render(view) {
  let scanner = null;
  let current = null;
  let resetTimer = null;
  const recent = [];

  view.innerHTML = `
  <div class="page checker-page">
    <header class="page-head">
      <div><h1>Cek Harga</h1><p class="muted">Scan barcode atau QR barang untuk melihat harga, stok, dan cara pakai.</p></div>
    </header>
    <div class="checker">
      <div class="card checker-cam">
        ${cameraPanelHTML({ hint: 'Arahkan kamera ke barcode/QR. Bisa juga pakai scanner USB atau ketik kode.' })}
        <div class="checker-cam-actions"><button type="button" class="btn primary block" data-cam-toggle>${icon('camera')} <span>Nyalakan kamera</span></button></div>
        <form class="scan-input" data-form autocomplete="off">
          ${icon('search')}
          <input type="search" id="check-input" placeholder="Ketik kode, nama, atau bahan aktif" autocomplete="off" spellcheck="false" enterkeyhint="search">
        </form>
      </div>
      <div class="card checker-result" data-result aria-live="polite"></div>
    </div>
    <section class="card recent" data-recent hidden>
      <h2>Terakhir dicek</h2>
      <div class="recent-list" data-recent-list></div>
    </section>
  </div>`;

  const q = (s) => view.querySelector(s);
  const input = q('#check-input');
  const camBtn = q('[data-cam-toggle]');
  const frame = q('.cam-frame');

  function idle() {
    current = null;
    q('[data-result]').innerHTML = `<div class="checker-idle">${icon('scan')}<h2>Siap memindai</h2><p>Harga, stok, dan info barang akan muncul di sini.</p></div>`;
  }

  function show(p) {
    current = p;
    clearTimeout(resetTimer);
    const status = store.stockStatus(p);
    const stockText = status === 'habis' ? 'Stok habis' : status === 'menipis' ? `Stok menipis · sisa ${num(p.stock)} ${esc(p.unit)}` : `Stok tersedia · ${num(p.stock)} ${esc(p.unit)}`;
    const exp = store.expiryStatus(p);
    const admin = isUnlocked();
    const facts = [
      p.brand && p.brand !== 'Contoh' ? ['Merek', esc(p.brand)] : null,
      p.ingredient ? ['Bahan aktif', esc(p.ingredient)] : null,
      p.usage ? ['Kegunaan & dosis', esc(p.usage)] : null,
      p.expiry ? ['Kedaluwarsa', `<span class="${exp === 'lewat' ? 'neg' : exp === 'segera' ? 'warn-text' : ''}">${esc(expiryText(p))}</span>`] : null,
    ].filter(Boolean);
    q('[data-result]').innerHTML = `
      <div class="checker-card pop">
        <div class="checker-top">${productArt(p, 'checker-img')}<div class="checker-title"><p class="checker-cat">${esc(p.category || 'Tanpa kategori')}</p><h2 class="checker-name">${esc(p.name)}</h2><p class="mono muted small">${esc(p.code)}</p></div></div>
        <div class="price-big">${rp(p.sellPrice)}<small>/ ${esc(p.unit)}</small></div>
        ${p.tiers?.length ? `<div class="tier-hint">${icon('layers')}<span>Harga grosir: ${p.tiers.map((t) => `≥ ${num(t.min)} ${esc(p.unit)} <b>${rp(t.price)}</b>`).join(' · ')}</span></div>` : ''}
        <div class="pill-row">
          <span class="stock-pill ${status}">${icon(status === 'aman' ? 'check' : 'alert')}<span>${stockText}</span></span>
          ${exp === 'lewat' ? `<span class="stock-pill habis">${icon('calendar')}<span>Kedaluwarsa</span></span>` : exp === 'segera' ? `<span class="stock-pill menipis">${icon('calendar')}<span>Segera kedaluwarsa</span></span>` : ''}
        </div>
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
        <div class="checker-actions">
          <button type="button" class="btn primary" data-act="cart">${icon('cart')} Tambah ke kasir</button>
          <button type="button" class="btn" data-act="qr">${icon('qr')} QR</button>
          ${admin ? `<button type="button" class="btn" data-act="stock">${icon('box')} Atur stok</button><a class="btn ghost" href="#/produk/${p.id}">${icon('edit')} Ubah</a>` : ''}
        </div>
      </div>`;
    const i = recent.findIndex((r) => r.p.id === p.id);
    if (i >= 0) recent.splice(i, 1);
    recent.unshift({ p, at: new Date() });
    recent.length = Math.min(recent.length, 7);
    renderRecent();
    if (isTouch()) q('[data-result]').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function notFound(code) {
    current = null;
    const admin = isUnlocked();
    q('[data-result]').innerHTML = `
      <div class="checker-card notfound pop">
        <div class="checker-idle">${icon('alert')}<h2>Barang belum terdaftar</h2><p>Kode <b class="mono">${esc(code)}</b> tidak ada di daftar produk.</p></div>
        ${admin ? `<div class="checker-actions center"><a class="btn primary" href="#/produk/baru/${encodeURIComponent(code)}">${icon('plus')} Daftarkan barang ini</a></div>` : '<p class="muted center">Hubungi pemilik toko untuk mendaftarkan barang ini.</p>'}
      </div>`;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(idle, 10000);
  }

  function renderRecent() {
    q('[data-recent]').hidden = recent.length < 2;
    q('[data-recent-list]').innerHTML = recent.slice(1).map(({ p, at }) => `
      <button type="button" class="recent-item" data-pid="${p.id}">${thumb(p)}<span class="ri-name">${esc(p.name)}</span><span class="ri-price">${rp(p.sellPrice)}</span><span class="muted small">${fmtTime(at)}</span></button>`).join('');
  }

  function lookup(raw, fromCamera = false) {
    const text = String(raw || '').trim();
    if (!text) return;
    if (fromCamera && document.querySelector('dialog[open]')) return;
    let p = store.findByCode(text);
    if (!p && !fromCamera) p = store.searchProducts(text, { limit: 1 })[0] || null;
    if (p) { beep(true); show(p); }
    else { beep(false); notFound(text); }
  }

  async function startCamera() {
    const err = q('.cam-error');
    err.hidden = true;
    if (!scanner) {
      scanner = new CameraScanner(q('.cam-view'), (code) => lookup(code, true), { cooldown: 2500 });
      wireCameraPanel(view, scanner, toast);
    }
    try {
      await scanner.start();
      frame.classList.add('live');
      camBtn.innerHTML = `${icon('x')} <span>Matikan kamera</span>`;
      camBtn.classList.remove('primary');
    } catch (e) {
      err.textContent = cameraErrorMessage(e);
      err.hidden = false;
    }
  }
  async function stopCamera() {
    await scanner?.stop();
    frame.classList.remove('live');
    camBtn.innerHTML = `${icon('camera')} <span>Nyalakan kamera</span>`;
    camBtn.classList.add('primary');
  }

  camBtn.addEventListener('click', () => (scanner?.running ? stopCamera() : startCamera()));
  q('[data-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    lookup(input.value);
    input.value = '';
    if (isTouch()) input.blur();
  });
  q('[data-result]').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !current) return;
    const act = b.dataset.act;
    if (act === 'cart') {
      if (!store.state.settings.allowNegativeStock && current.stock <= 0) { toast(`${current.name} stoknya habis`, { type: 'bad' }); return; }
      addToSavedCart(current, 1);
      toast(`${current.name} masuk keranjang kasir`, { type: 'ok', action: () => { location.hash = '#/kasir'; }, actionLabel: 'Ke kasir' });
    } else if (act === 'qr') {
      openQrDialog(current);
    } else if (act === 'stock') {
      const updated = await openStockDialog(current);
      if (updated) show(updated);
    }
  });
  q('[data-recent-list]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pid]');
    const p = b && store.getProduct(b.dataset.pid);
    if (p) show(p);
  });

  const offType = autoFocusOnType(input);
  idle();
  if (!isTouch()) input.focus();
  if (isTouch()) startCamera();

  return async () => {
    offType();
    clearTimeout(resetTimer);
    await scanner?.stop();
  };
}

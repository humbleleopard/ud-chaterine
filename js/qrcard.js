// Kartu QR produk: tampilkan, simpan sebagai gambar PNG, bagikan, salin kode, dan cetak label.
import { state } from './store.js';
import { qrSvg, drawQR } from './qrcode.js';
import { openModal, toast, download, copyText } from './ui.js';
import { icon } from './icons.js';
import { esc, rp } from './format.js';
import { printHTML } from './receipt.js';

const BRAND = '#1f6b3a';
const GOLD = '#f2c14e';

const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'produk';

/** Label kecil untuk lembar cetak (dipakai halaman Label QR & tombol Cetak). */
export function labelHTML(p, opts = {}) {
  const o = { name: true, price: true, code: true, store: false, ...opts };
  return `<div class="qlabel">${qrSvg(p.code, { ecl: 'M', margin: 1, label: 'QR ' + p.code })}<div class="ql-text">
    ${o.store ? `<span class="ql-store">${esc(state.settings.storeName)}</span>` : ''}
    ${o.name ? `<span class="ql-name">${esc(p.name)}</span>` : ''}
    ${o.price ? `<span class="ql-price">${rp(p.sellPrice)}</span>` : ''}
    ${o.code ? `<span class="ql-code">${esc(p.code)}</span>` : ''}
  </div></div>`;
}

export function labelSheetHTML(items, opts = {}) {
  const size = opts.size || 'sedang';
  const html = [];
  for (const { product, count = 1 } of items) {
    const one = labelHTML(product, opts);
    for (let i = 0; i < count; i++) html.push(one);
  }
  return `<div class="labels-sheet size-${size}">${html.join('')}</div>`;
}

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines.slice(0, maxLines);
}

/** Gambar label QR siap simpan (PNG 800×1040). */
export function labelCanvas(p) {
  const W = 800, H = 1040;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const font = (w, s) => `${w} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  // pita atas: nama toko
  g.fillStyle = BRAND;
  g.fillRect(0, 0, W, 128);
  g.fillStyle = GOLD;
  g.fillRect(0, 128, W, 8);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.font = font(800, 46);
  g.fillText(state.settings.storeName || 'Toko', W / 2, 56, W - 80);
  g.font = font(600, 24);
  g.fillStyle = GOLD;
  g.fillText(state.settings.tagline || 'Toko Pertanian', W / 2, 100, W - 80);
  // QR
  drawQR(g, p.code, 130, 168, 540, { ecl: 'M', margin: 2 });
  // teks
  g.fillStyle = '#16210f';
  g.font = font(750, 40);
  const lines = wrapLines(g, p.name, W - 100, 2);
  lines.forEach((l, i) => g.fillText(l, W / 2, 755 + i * 50));
  const y = 755 + lines.length * 50 + 30;
  g.fillStyle = BRAND;
  g.font = font(850, 66);
  g.fillText(rp(p.sellPrice) + ' / ' + p.unit, W / 2, y, W - 60);
  g.fillStyle = '#5b6258';
  g.font = `500 28px ui-monospace, Consolas, monospace`;
  g.fillText(p.code, W / 2, y + 62);
  g.font = font(500, 22);
  g.fillStyle = '#8a9086';
  g.fillText('Scan QR untuk cek harga & stok', W / 2, H - 34);
  return c;
}

export const labelBlob = (p) => new Promise((resolve, reject) =>
  labelCanvas(p).toBlob((b) => (b ? resolve(b) : reject(new Error('Gambar QR gagal dibuat.'))), 'image/png'));

export const pngName = (p) => `QR-${slug(p.name)}-${p.code}.png`;

export async function saveQrPng(p) {
  const blob = await labelBlob(p);
  download(pngName(p), blob, 'image/png');
  toast('Gambar QR disimpan ke folder Unduhan', { type: 'ok' });
}

export async function shareQrPng(p) {
  const blob = await labelBlob(p);
  const file = new File([blob], pngName(p), { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: p.name, text: `${p.name} — ${rp(p.sellPrice)}` }); return; }
    catch (err) { if (err?.name === 'AbortError') return; }
  }
  download(file.name, blob, 'image/png');
  toast('Perangkat ini tidak mendukung bagikan langsung; gambar diunduh.', { type: 'info' });
}

export function printLabel(p, count = 1) {
  printHTML(labelSheetHTML([{ product: p, count }], { size: 'besar', store: true }), 'labels');
}

/** Jendela QR produk: tampil besar + simpan/bagikan/cetak. */
export function openQrDialog(p) {
  const canShare = typeof navigator.share === 'function';
  const m = openModal({
    title: 'QR barang',
    size: 'sm qr-dialog',
    body: `<div class="qr-card">
        <div class="qr-card-top"><strong>${esc(state.settings.storeName)}</strong><span>${esc(state.settings.tagline || '')}</span></div>
        <div class="qr-big">${qrSvg(p.code, { ecl: 'M', margin: 2, label: 'QR ' + p.code })}</div>
        <strong class="qr-name">${esc(p.name)}</strong>
        <span class="qr-price">${rp(p.sellPrice)} <small>/ ${esc(p.unit)}</small></span>
        <button type="button" class="qr-code mono" data-copy title="Salin kode">${esc(p.code)} ${icon('copy')}</button>
      </div>
      <p class="hint center">Scan QR ini di <b>Kasir</b> atau <b>Cek Harga</b>. Simpan gambarnya untuk dicetak di tempat lain atau dikirim lewat WhatsApp.</p>`,
    foot: `<button type="button" class="btn" data-print>${icon('printer')} Cetak</button>
      ${canShare ? `<button type="button" class="btn" data-share>${icon('share')} Bagikan</button>` : ''}
      <button type="button" class="btn primary" data-save>${icon('download')} Simpan gambar</button>`,
  });
  m.$('[data-save]').onclick = () => saveQrPng(p).catch((e) => toast(e.message, { type: 'bad' }));
  m.$('[data-share]')?.addEventListener('click', () => shareQrPng(p).catch((e) => toast(e.message, { type: 'bad' })));
  m.$('[data-print]').onclick = () => printLabel(p, 1);
  m.$('[data-copy]').onclick = async () => toast((await copyText(p.code)) ? 'Kode disalin' : 'Gagal menyalin', { type: 'ok', duration: 1500 });
  return m;
}

// Halaman Label QR: semua QR barang langsung tampil. Tiap label bisa disimpan (PNG) / dicetak,
// atau pilih beberapa sekaligus untuk dicetak di kertas A4.
import * as store from '../store.js';
import { toast, emptyState, thumb, openModal } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp } from '../format.js';
import { labelHTML, labelSheetHTML, saveQrPng, openQrDialog, printLabel } from '../qrcard.js';
import { printHTML } from '../receipt.js';

const OPT_KEY = 'kasirqr-label-opts';
const PAGE = 48;

export async function render(view, { params }) {
  const sel = new Map(); // id -> jumlah label
  if (params[0] && store.getProduct(params[0])) sel.set(params[0], 1);
  let text = '';
  let category = '';
  let limit = PAGE;
  let opts = { size: 'sedang', price: true, name: true, code: true, store: false };
  try { opts = { ...opts, ...JSON.parse(localStorage.getItem(OPT_KEY) || '{}') }; } catch { /* abaikan */ }
  const saveOpts = () => { try { localStorage.setItem(OPT_KEY, JSON.stringify(opts)); } catch { /* abaikan */ } };

  view.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><h1>Label QR</h1><p class="muted">QR semua barang. Simpan sebagai gambar, cetak satu, atau pilih banyak untuk dicetak sekaligus di kertas A4.</p></div>
      <div class="actions"><button type="button" class="btn" data-opts>${icon('settings')}<span>Atur label</span></button></div>
    </header>
    <div class="toolbar">
      <div class="scan-input grow">${icon('search')}<input type="search" data-search placeholder="Cari barang…" autocomplete="off"></div>
      <select class="input select" data-cat aria-label="Kategori"></select>
      <button type="button" class="btn" data-all>${icon('check')}<span>Pilih semua</span></button>
    </div>
    <div class="lgrid" data-grid></div>
    <div class="selbar" data-selbar hidden>
      <span data-seltext></span>
      <button type="button" class="btn ghost" data-none>Batal</button>
      <button type="button" class="btn primary" data-print>${icon('printer')} Cetak label</button>
    </div>
  </div>`;
  const q = (s) => view.querySelector(s);

  function filtered() {
    return store.searchProducts(text, { limit: 100000, category });
  }

  function drawGrid() {
    const cats = store.categories();
    q('[data-cat]').innerHTML = `<option value="">Semua kategori</option>${cats.map((c) => `<option ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
    const grid = q('[data-grid]');
    if (!store.state.products.length) {
      grid.innerHTML = emptyState('qr', 'Belum ada barang', 'Tambahkan barang dulu; label QR-nya otomatis muncul di sini.', `<a class="btn primary" href="#/produk/baru">${icon('plus')} Tambah produk</a>`);
      return;
    }
    const list = filtered();
    if (!list.length) { grid.innerHTML = '<p class="muted center pad">Tidak ada barang yang cocok.</p>'; return; }
    grid.innerHTML = list.slice(0, limit).map((p) => {
      const n = sel.get(p.id) || 0;
      return `<article class="lcard ${n ? 'on' : ''}" data-id="${p.id}">
        <button type="button" class="lcard-preview" data-open title="Perbesar QR">${labelHTML(p, { store: false })}</button>
        <div class="lcard-info">${thumb(p)}<span><strong>${esc(p.name)}</strong><small>${rp(p.sellPrice)} / ${esc(p.unit)}</small></span></div>
        <div class="lcard-actions">
          <button type="button" class="btn sm" data-save>${icon('download')} Simpan</button>
          <button type="button" class="btn sm" data-print1>${icon('printer')} Cetak</button>
          ${n ? `<div class="stepper sm"><button type="button" data-dec aria-label="Kurangi">${icon('minus')}</button><span class="stepper-val">${n}</span><button type="button" data-inc aria-label="Tambah">${icon('plus')}</button></div>`
            : `<button type="button" class="btn sm ghost" data-pick>${icon('plus')} Pilih</button>`}
        </div>
      </article>`;
    }).join('') + (list.length > limit ? `<button type="button" class="btn block ghost lmore" data-more>Tampilkan ${num(Math.min(PAGE, list.length - limit))} lagi (${num(list.length - limit)} tersisa)</button>` : '');
  }

  function drawSel() {
    const total = [...sel.values()].reduce((a, b) => a + b, 0);
    q('[data-selbar]').hidden = !total;
    q('[data-seltext]').innerHTML = `<b>${num(total)}</b> label dari ${num(sel.size)} barang`;
  }

  const redraw = () => { drawGrid(); drawSel(); };

  function openOptions() {
    {
      const m = openModal({
        title: 'Atur label cetak', size: 'sm',
        body: `<div class="field"><span>Ukuran label (kertas A4)</span>
            <div class="seg seg-3" data-size>
              <button type="button" data-v="kecil">Kecil<small>38×21 mm</small></button>
              <button type="button" data-v="sedang">Sedang<small>48×25 mm</small></button>
              <button type="button" data-v="besar">Besar<small>64×34 mm</small></button>
            </div></div>
          <div class="checks">
            <label class="check"><input type="checkbox" data-opt="name"><span>Nama barang</span></label>
            <label class="check"><input type="checkbox" data-opt="price"><span>Harga</span></label>
            <label class="check"><input type="checkbox" data-opt="code"><span>Kode</span></label>
            <label class="check"><input type="checkbox" data-opt="store"><span>Nama toko</span></label>
          </div>
          <div class="label-preview" data-prev></div>`,
        foot: `<button type="button" class="btn primary" data-close>Selesai</button>`,
      });
      const sample = store.state.products[0];
      const sync = () => {
        m.$$('[data-size] [data-v]').forEach((b) => b.classList.toggle('active', b.dataset.v === opts.size));
        m.$$('[data-opt]').forEach((c) => { c.checked = !!opts[c.dataset.opt]; });
        m.$('[data-prev]').innerHTML = sample ? labelSheetHTML([{ product: sample, count: 2 }], opts) : '';
      };
      m.$('[data-size]').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { opts.size = b.dataset.v; saveOpts(); sync(); } });
      m.$$('[data-opt]').forEach((c) => c.addEventListener('change', () => { opts[c.dataset.opt] = c.checked; saveOpts(); sync(); }));
      sync();
    }
  }

  q('[data-search]').addEventListener('input', (e) => { text = e.target.value; limit = PAGE; drawGrid(); });
  q('[data-cat]').addEventListener('change', (e) => { category = e.target.value; limit = PAGE; drawGrid(); });
  q('[data-all]').onclick = () => { filtered().forEach((p) => sel.set(p.id, sel.get(p.id) || 1)); redraw(); toast(`${sel.size} barang dipilih`); };
  q('[data-none]').onclick = () => { sel.clear(); redraw(); };
  q('[data-opts]').onclick = openOptions;
  q('[data-print]').onclick = () => {
    const items = [...sel].map(([id, count]) => ({ product: store.getProduct(id), count })).filter((x) => x.product);
    if (!items.length) return;
    printHTML(labelSheetHTML(items, opts), 'labels');
  };
  q('[data-grid]').addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += PAGE; drawGrid(); return; }
    const card = e.target.closest('[data-id]');
    const p = card && store.getProduct(card.dataset.id);
    if (!p) return;
    const n = sel.get(p.id) || 0;
    if (e.target.closest('[data-save]')) saveQrPng(p).catch((err) => toast(err.message, { type: 'bad' }));
    else if (e.target.closest('[data-print1]')) printLabel(p, 1);
    else if (e.target.closest('[data-open]')) openQrDialog(p);
    else if (e.target.closest('[data-pick]') || e.target.closest('[data-inc]')) { sel.set(p.id, Math.min(200, n + 1)); redraw(); }
    else if (e.target.closest('[data-dec]')) { if (n <= 1) sel.delete(p.id); else sel.set(p.id, n - 1); redraw(); }
  });

  redraw();
  const unsub = store.subscribe((w) => { if (w === 'products' || w === 'all' || w === 'settings') redraw(); });
  return () => unsub();
}

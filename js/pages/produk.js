// Halaman Produk & Stok: daftar, tambah/ubah produk (foto, bahan aktif, kedaluwarsa, harga grosir), QR, stok, impor/ekspor CSV.
import * as store from '../store.js';
import { scanOnce } from '../scanner.js';
import { toast, openModal, confirmDialog, bindMoney, thumb, stockBadge, emptyState, download, pickFile, pickImage, readText, resizeImage, isTouch } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, parseMoney, parseQty, fmtDateTime, isoDate } from '../format.js';
import { openStockDialog } from '../dialogs.js';
import { toCSV, parseCSV, rowsToProducts, PRODUCT_COLUMNS } from '../csv.js';
import { CATEGORY_PRESETS, UNIT_PRESETS, categoryMeta } from '../catalog.js';
import { openQrDialog, labelHTML, saveQrPng, printLabel } from '../qrcard.js';

export async function render(view, { params }) {
  if (params[0] === 'baru') return renderForm(view, null, params[1] || '');
  if (params[0]) {
    const p = store.getProduct(params[0]);
    if (!p) {
      view.innerHTML = `<div class="page">${emptyState('alert', 'Produk tidak ditemukan', 'Mungkin sudah dihapus.', `<a class="btn" href="#/produk">${icon('arrowLeft')} Kembali ke daftar</a>`)}</div>`;
      return null;
    }
    return renderForm(view, p);
  }
  return renderList(view);
}

function expiryBadge(p) {
  const s = store.expiryStatus(p);
  if (s === 'lewat') return `<span class="badge bad">${icon('calendar')} Kedaluwarsa</span>`;
  if (s === 'segera') return `<span class="badge warn">${icon('calendar')} ${store.daysToExpiry(p)} hari lagi</span>`;
  return '';
}

/* =================== DAFTAR =================== */
function renderList(view) {
  let filter = 'semua';
  let category = '';
  let text = '';
  let limit = 120;

  view.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><h1>Produk & Stok</h1><p class="muted" data-summary></p></div>
      <div class="actions">
        <button type="button" class="btn" data-scan>${icon('scan')}<span>Scan</span></button>
        <button type="button" class="btn" data-io>${icon('database')}<span>Impor/Ekspor</span></button>
        <a class="btn primary" href="#/produk/baru">${icon('plus')}<span>Tambah produk</span></a>
      </div>
    </header>
    <div class="toolbar">
      <div class="scan-input grow">${icon('search')}<input type="search" data-search placeholder="Cari nama, kode, merek, atau bahan aktif…" autocomplete="off"></div>
      <select class="input select" data-cat aria-label="Kategori"></select>
    </div>
    <div class="seg seg-auto filter-seg" data-filter role="tablist"></div>
    <div class="plist" data-list></div>
  </div>`;
  const q = (s) => view.querySelector(s);

  function counts() {
    let menipis = 0, habis = 0, exp = 0, modal = 0;
    for (const p of store.state.products) {
      const s = store.stockStatus(p);
      if (s === 'habis') habis++; else if (s === 'menipis') menipis++;
      if (['lewat', 'segera'].includes(store.expiryStatus(p))) exp++;
      modal += Math.max(0, Number(p.stock) || 0) * (p.buyPrice || 0);
    }
    return { menipis, habis, exp, modal };
  }

  function draw() {
    const c = counts();
    const total = store.state.products.length;
    q('[data-summary]').textContent = total ? `${num(total)} produk · nilai stok ${rp(c.modal)} (harga modal)` : 'Belum ada produk';
    const cats = store.categories();
    q('[data-cat]').innerHTML = `<option value="">Semua kategori</option>${cats.map((k) => `<option ${k === category ? 'selected' : ''}>${esc(k)}</option>`).join('')}`;
    q('[data-filter]').innerHTML = [
      ['semua', 'Semua', total, ''], ['menipis', 'Menipis', c.menipis, 'warn'], ['habis', 'Habis', c.habis, 'bad'], ['exp', 'Kedaluwarsa', c.exp, 'bad'],
    ].map(([k, l, n, tone]) => `<button type="button" data-f="${k}" class="${filter === k ? 'active' : ''}">${l} <span class="seg-n ${n ? tone : ''}">${n}</span></button>`).join('');

    let list = store.searchProducts(text, { limit: 100000, category });
    if (filter === 'menipis' || filter === 'habis') list = list.filter((p) => store.stockStatus(p) === filter);
    if (filter === 'exp') list = list.filter((p) => ['lewat', 'segera'].includes(store.expiryStatus(p))).sort((a, b) => store.daysToExpiry(a) - store.daysToExpiry(b));
    const el = q('[data-list]');
    if (!total) {
      el.innerHTML = emptyState('box', 'Belum ada produk', 'Tambahkan produk satu per satu, impor dari CSV/Excel, atau coba dengan data contoh toko pertanian.',
        `<a class="btn primary" href="#/produk/baru">${icon('plus')} Tambah produk</a><button type="button" class="btn" data-sample>${icon('sparkle')} Isi data contoh</button>`);
      el.querySelector('[data-sample]').onclick = async () => { const n = await store.loadSample(); toast(`${n} produk contoh ditambahkan`, { type: 'ok' }); };
      return;
    }
    if (!list.length) { el.innerHTML = `<p class="muted center pad">Tidak ada produk yang cocok.</p>`; return; }
    el.innerHTML = list.slice(0, limit).map((p) => {
      const eb = expiryBadge(p);
      return `
      <div class="prow" data-id="${p.id}">
        <a class="prow-main" href="#/produk/${p.id}">
          ${thumb(p)}
          <span class="prow-text"><span class="prow-name">${esc(p.name)}</span>
          <span class="prow-meta">${[p.category, p.ingredient].filter(Boolean).map(esc).join(' · ') || esc(p.code)}</span>
          ${eb ? `<span class="prow-badges">${eb}</span>` : ''}</span>
        </a>
        <span class="prow-price">${rp(p.sellPrice)}<small>/${esc(p.unit)}</small>${p.tiers?.length ? ` <span class="tag gold">Grosir</span>` : ''}</span>
        <span class="prow-stock">${stockBadge(p)}</span>
        <span class="prow-actions">
          <button type="button" class="icon-btn" data-qr title="Lihat & simpan QR" aria-label="QR ${esc(p.name)}">${icon('qr')}</button>
          <button type="button" class="icon-btn" data-stock title="Atur stok" aria-label="Atur stok ${esc(p.name)}">${icon('box')}</button>
        </span>
      </div>`;
    }).join('') + (list.length > limit ? `<button type="button" class="btn block ghost" data-more>Tampilkan lebih banyak (${num(list.length - limit)} lagi)</button>` : '');
  }

  q('[data-search]').addEventListener('input', (e) => { text = e.target.value; limit = 120; draw(); });
  q('[data-cat]').addEventListener('change', (e) => { category = e.target.value; draw(); });
  q('[data-filter]').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } });
  q('[data-list]').addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { limit += 200; draw(); return; }
    const row = e.target.closest('[data-id]');
    const p = row && store.getProduct(row.dataset.id);
    if (!p) return;
    if (e.target.closest('[data-stock]')) openStockDialog(p);
    else if (e.target.closest('[data-qr]')) openQrDialog(p);
  });
  q('[data-scan]').addEventListener('click', async () => {
    const code = await scanOnce({ title: 'Scan untuk mencari produk' });
    if (!code) return;
    const p = store.findByCode(code);
    if (p) location.hash = '#/produk/' + p.id;
    else toast(`Kode ${code} belum terdaftar`, { type: 'bad', action: () => { location.hash = '#/produk/baru/' + encodeURIComponent(code); }, actionLabel: 'Daftarkan' });
  });
  q('[data-io]').addEventListener('click', openImportExport);

  const unsub = store.subscribe((w) => { if (w === 'products' || w === 'all') draw(); });
  draw();
  if (!isTouch()) q('[data-search]').focus();
  return () => unsub();
}

function openImportExport() {
  const m = openModal({
    title: 'Impor / ekspor produk', size: 'md',
    body: `<div class="io-grid">
      <button type="button" class="io-card" data-export>${icon('download')}<strong>Ekspor CSV</strong><span>Unduh semua produk untuk dibuka di Excel / Google Sheets.</span></button>
      <button type="button" class="io-card" data-import>${icon('upload')}<strong>Impor CSV</strong><span>Tambah atau perbarui banyak produk sekaligus. Kode yang sama akan diperbarui.</span></button>
      <button type="button" class="io-card" data-template>${icon('inbox')}<strong>Template CSV</strong><span>Contoh kolom: kode, nama, kategori, merek, bahan_aktif, satuan, harga, stok, kedaluwarsa.</span></button>
    </div>
    <p class="hint">Kolom <b>kode</b> boleh kosong; aplikasi membuatkan kode internal. Harga ditulis tanpa “Rp”, mis. 15000. Tanggal kedaluwarsa format 2027-12-31. Foto ditambahkan lewat halaman produk.</p>`,
  });
  m.$('[data-export]').onclick = () => {
    download(`produk-${isoDate()}.csv`, toCSV(PRODUCT_COLUMNS, store.state.products), 'text/csv;charset=utf-8');
    toast('Berkas CSV diunduh', { type: 'ok' });
  };
  m.$('[data-template]').onclick = () => {
    const sample = [
      { code: '8990000000017', name: 'Fungisida Contoh 80 WP 500 g', category: 'Fungisida', brand: 'Merek A', ingredient: 'Mankozeb 80%', unit: 'bungkus', buyPrice: 40000, sellPrice: 50000, stock: 12, minStock: 3, expiry: '2027-06-30' },
      { code: '', name: 'Pupuk NPK Eceran', category: 'Pupuk', brand: '', ingredient: 'NPK 16-16-16', unit: 'kg', buyPrice: 15000, sellPrice: 18500, stock: 50.5, minStock: 10, expiry: '' },
    ];
    download('template-produk.csv', toCSV(PRODUCT_COLUMNS, sample), 'text/csv;charset=utf-8');
  };
  m.$('[data-import]').onclick = async () => {
    const file = await pickFile('.csv,text/csv,text/plain');
    if (!file) return;
    try {
      const rows = rowsToProducts(parseCSV(await readText(file)));
      const ok = await confirmDialog(`Impor ${rows.length} baris dari ${file.name}? Produk dengan kode yang sama akan diperbarui (termasuk stok bila ada kolom stok).`, { ok: 'Impor' });
      if (!ok) return;
      const r = await store.importProducts(rows);
      toast(`${r.added} produk baru, ${r.updated} diperbarui${r.skipped ? `, ${r.skipped} dilewati` : ''}`, { type: 'ok', duration: 5000 });
      m.close();
    } catch (err) { toast(err.message, { type: 'bad', duration: 5000 }); }
  };
}

/* =================== FORM TAMBAH / UBAH =================== */
function renderForm(view, product, presetCode = '') {
  const isNew = !product;
  const p = product || { code: presetCode, name: '', category: '', brand: '', ingredient: '', usage: '', unit: 'botol', buyPrice: 0, sellPrice: 0, tiers: [], stock: 0, minStock: 3, expiry: '', image: null };
  let image = p.image || null;
  let tiers = (p.tiers || []).map((t) => ({ ...t }));

  view.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><a class="back" href="#/produk">${icon('arrowLeft')} Produk</a><h1>${isNew ? 'Tambah produk' : esc(p.name)}</h1></div>
      ${isNew ? '' : `<div class="actions"><button type="button" class="btn" data-qr>${icon('qr')}<span>QR</span></button><button type="button" class="btn" data-adjust2>${icon('box')}<span>Atur stok</span></button></div>`}
    </header>
    <div class="product-layout">
      <form class="card form" data-form novalidate>
        <div class="form-top">
          <div class="photo-col">
            <div class="photo-drop" data-drop tabindex="0" role="button" aria-label="Foto produk: ketuk untuk memilih, atau seret gambar ke sini">
              <div class="photo" data-photo></div>
              <div class="photo-hint">${icon('image')}<span>Ketuk, seret, atau tempel gambar</span></div>
            </div>
            <div class="photo-actions">
              <button type="button" class="btn sm" data-photo-cam>${icon('camera')} Foto</button>
              <button type="button" class="btn sm" data-photo-pick>${icon('image')} Galeri</button>
              <button type="button" class="btn sm ghost danger-text" data-photo-del aria-label="Hapus foto">${icon('trash')}</button>
            </div>
          </div>
          <div class="form-grid grow">
            <label class="field span-2"><span>Nama barang *</span><input class="input strong" name="name" value="${esc(p.name)}" required autocomplete="off" placeholder="mis. Fungisida Mankozeb 80 WP 1 kg"></label>
            <label class="field span-2"><span>Kode barang (barcode / QR)</span>
              <div class="input-group">
                <input class="input mono" name="code" value="${esc(p.code)}" placeholder="Scan barcode kemasan, atau kosongkan" autocomplete="off" spellcheck="false">
                <button type="button" class="btn" data-scan-code title="Scan dengan kamera">${icon('camera')}<span>Scan</span></button>
                <button type="button" class="btn" data-gen title="Buat kode internal">${icon('sparkle')}<span>Buat kode</span></button>
              </div>
              <small class="hint">Pakai barcode kemasan bila ada. Untuk barang curah/eceran tanpa barcode, tekan “Buat kode” lalu cetak label QR-nya.</small>
            </label>
            <label class="field"><span>Kategori</span><input class="input" name="category" value="${esc(p.category)}" list="cat-list" autocomplete="off" placeholder="mis. Fungisida"></label>
            <label class="field"><span>Merek / produsen</span><input class="input" name="brand" value="${esc(p.brand || '')}" list="brand-list" autocomplete="off" placeholder="opsional"></label>
          </div>
        </div>
        <div class="chips cat-presets" data-cat-presets>${CATEGORY_PRESETS.map((c) => { const m = categoryMeta(c); return `<button type="button" class="chip cat-chip" data-cat="${esc(c)}" style="--c:${m.color};--s:${m.soft}">${icon(m.icon)}${esc(c)}</button>`; }).join('')}</div>

        <h2 class="section-title">${icon('tag')} Harga</h2>
        <div class="form-grid three">
          <label class="field"><span>Satuan jual</span><input class="input" name="unit" value="${esc(p.unit)}" list="unit-list" autocomplete="off"></label>
          <label class="field"><span>Harga beli / modal</span><input class="input" name="buyPrice" inputmode="numeric" value="${p.buyPrice ? num(p.buyPrice) : ''}" placeholder="0" autocomplete="off"></label>
          <label class="field"><span>Harga jual *</span><input class="input strong" name="sellPrice" inputmode="numeric" value="${p.sellPrice ? num(p.sellPrice) : ''}" placeholder="0" autocomplete="off"></label>
        </div>
        <p class="margin-info" data-margin></p>
        <div class="tiers">
          <div class="tiers-head"><span>${icon('layers')} Harga grosir <small class="muted">— otomatis dipakai di kasir bila jumlah beli mencapai minimal</small></span><button type="button" class="btn sm" data-tier-add>${icon('plus')} Tambah</button></div>
          <div data-tiers></div>
        </div>

        <h2 class="section-title">${icon('box')} Stok & kedaluwarsa</h2>
        <div class="form-grid three">
          ${isNew
            ? `<label class="field"><span>Stok awal</span><input class="input" name="stock" inputmode="decimal" value="" placeholder="0" autocomplete="off"></label>`
            : `<div class="field"><span>Stok sekarang</span><div class="stock-now"><strong data-stock-now>${num(p.stock)} ${esc(p.unit)}</strong><button type="button" class="btn sm" data-adjust>${icon('box')} Atur</button></div></div>`}
          <label class="field"><span>Peringatan stok bila ≤</span><input class="input" name="minStock" inputmode="decimal" value="${num(p.minStock)}" autocomplete="off"></label>
          <label class="field"><span>Tanggal kedaluwarsa</span><input class="input" type="date" name="expiry" value="${esc(p.expiry || '')}"></label>
        </div>

        <h2 class="section-title">${icon('info')} Info untuk pembeli</h2>
        <div class="form-grid">
          <label class="field span-2"><span>Bahan aktif / kandungan</span><input class="input" name="ingredient" value="${esc(p.ingredient || '')}" autocomplete="off" placeholder="mis. Mankozeb 80%, atau N 16% P 16% K 16%"></label>
          <label class="field span-2"><span>Kegunaan & dosis</span><textarea class="input" name="usage" rows="3" placeholder="mis. Bercak daun & busuk buah pada cabai. Dosis 2–3 g per liter air.">${esc(p.usage || '')}</textarea></label>
        </div>

        <datalist id="cat-list">${[...new Set([...CATEGORY_PRESETS, ...store.categories()])].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <datalist id="brand-list">${store.brands().map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        <datalist id="unit-list">${UNIT_PRESETS.map((u) => `<option value="${u}">`).join('')}</datalist>
        <div class="form-foot">
          ${isNew ? '' : `<button type="button" class="btn ghost danger-text" data-delete>${icon('trash')} Hapus produk</button>`}
          <span class="spacer"></span>
          ${isNew ? `<button type="button" class="btn" data-save-new>${icon('plus')} Simpan & tambah lagi</button>` : ''}
          <button type="submit" class="btn primary">${icon('check')} Simpan</button>
        </div>
      </form>
      <aside class="product-side">
        ${isNew ? `<div class="card side-tip">${icon('qr')}<div><strong>Label QR otomatis</strong><p class="muted small">Setelah disimpan, QR barang ini langsung muncul di sini dan bisa disimpan sebagai gambar atau dicetak.</p></div></div>`
          : `<div class="card qr-side">
              <h2 class="card-title">${icon('qr')} Label QR</h2>
              <div class="qr-side-label" data-qr-preview>${labelHTML(p, { store: true })}</div>
              <div class="qr-side-actions">
                <button type="button" class="btn primary" data-qr-save>${icon('download')} Simpan QR</button>
                <button type="button" class="btn" data-qr-print>${icon('printer')} Cetak</button>
                <button type="button" class="btn ghost" data-qr-open>${icon('qr')} Perbesar</button>
              </div>
            </div>
            <section class="card"><h2 class="card-title">${icon('clock')} Riwayat stok</h2><div data-moves><span class="spinner"></span></div></section>`}
      </aside>
    </div>
  </div>`;

  const q = (s) => view.querySelector(s);
  const f = q('[data-form]');
  const F = Object.fromEntries([...f.querySelectorAll('[name]')].map((el) => [el.name, el]));
  const buyVal = bindMoney(F.buyPrice);
  const sellVal = bindMoney(F.sellPrice);

  /* ----- foto ----- */
  const drawPhoto = () => {
    q('[data-photo]').innerHTML = image ? `<img src="${image}" alt="Foto ${esc(F.name.value)}">` : thumb({ name: F.name.value || '?', category: F.category.value }, 'xl');
    q('[data-photo-del]').hidden = !image;
    q('[data-drop]').classList.toggle('has', !!image);
  };
  const useFile = async (file) => {
    if (!file) return;
    try { image = await resizeImage(file); drawPhoto(); toast('Foto siap. Tekan Simpan untuk menyimpan.', { type: 'ok', duration: 2200 }); }
    catch (err) { toast(err.message, { type: 'bad' }); }
  };
  drawPhoto();
  q('[data-photo-cam]').onclick = async () => useFile(await pickImage({ camera: true }));
  q('[data-photo-pick]').onclick = async () => useFile(await pickImage());
  q('[data-photo-del]').onclick = () => { image = null; drawPhoto(); };
  const drop = q('[data-drop]');
  drop.addEventListener('click', async () => useFile(await pickImage()));
  drop.addEventListener('keydown', async (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useFile(await pickImage()); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); useFile(e.dataTransfer?.files?.[0]); });
  const onPaste = (e) => {
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile();
    if (file) { e.preventDefault(); useFile(file); }
  };
  document.addEventListener('paste', onPaste);

  /* ----- margin ----- */
  const drawMargin = () => {
    const b = buyVal(), s = sellVal();
    const el = q('[data-margin]');
    if (!b || !s) { el.textContent = ''; el.className = 'margin-info'; return; }
    const gain = s - b;
    el.className = 'margin-info ' + (gain < 0 ? 'neg' : '');
    el.textContent = gain < 0 ? `Rugi ${rp(-gain)} per ${F.unit.value || 'unit'} — harga jual di bawah modal.` : `Untung ${rp(gain)} per ${F.unit.value || 'unit'} (margin ${num(Math.round((gain / s) * 1000) / 10)}%).`;
  };

  /* ----- harga grosir ----- */
  function drawTiers(rebuild = true) {
    const box = q('[data-tiers]');
    const sell = sellVal();
    if (rebuild) {
      box.innerHTML = tiers.length ? tiers.map((t, i) => `
        <div class="tier-row" data-i="${i}">
          <label class="field"><span>Beli minimal (${esc(F.unit.value || 'unit')})</span><input class="input" data-tmin inputmode="decimal" value="${t.min ? num(t.min) : ''}" placeholder="mis. 10" autocomplete="off"></label>
          <label class="field"><span>Harga per ${esc(F.unit.value || 'unit')}</span><input class="input" data-tprice inputmode="numeric" value="${t.price ? num(t.price) : ''}" placeholder="0" autocomplete="off"></label>
          <button type="button" class="icon-btn" data-tdel aria-label="Hapus harga grosir">${icon('trash')}</button>
          <small class="tier-warn" data-twarn></small>
        </div>`).join('') : '<p class="muted small">Belum ada. Contoh: beli ≥ 10 sak, harga Rp 278.000 per sak.</p>';
      box.querySelectorAll('[data-tprice]').forEach((el) => bindMoney(el));
    }
    box.querySelectorAll('.tier-row').forEach((row) => {
      const t = tiers[Number(row.dataset.i)];
      row.querySelector('[data-twarn]').textContent = t.price && sell && t.price >= sell ? 'Harga grosir harus lebih murah dari harga jual.' : t.min && t.min <= 1 ? 'Minimal beli harus lebih dari 1.' : '';
    });
  }
  q('[data-tiers]').addEventListener('input', (e) => {
    const row = e.target.closest('.tier-row');
    if (!row) return;
    const t = tiers[Number(row.dataset.i)];
    if (e.target.matches('[data-tmin]')) t.min = parseQty(e.target.value);
    if (e.target.matches('[data-tprice]')) t.price = parseMoney(e.target.value);
    drawTiers(false);
  });
  q('[data-tiers]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tdel]');
    if (!b) return;
    tiers.splice(Number(b.closest('.tier-row').dataset.i), 1);
    drawTiers();
  });
  q('[data-tier-add]').onclick = () => {
    const last = tiers[tiers.length - 1];
    tiers.push({ min: last ? last.min * 2 : 10, price: 0 });
    drawTiers();
    q('.tier-row:last-child [data-tprice]')?.focus();
  };
  F.buyPrice.addEventListener('input', drawMargin);
  F.sellPrice.addEventListener('input', () => { drawMargin(); drawTiers(false); });
  F.unit.addEventListener('change', () => { drawTiers(); drawMargin(); });
  drawMargin();
  drawTiers();

  /* ----- kategori cepat ----- */
  const syncCatChips = () => q('[data-cat-presets]').querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('active', b.dataset.cat === F.category.value));
  q('[data-cat-presets]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    F.category.value = b.dataset.cat;
    syncCatChips();
    if (!image) drawPhoto();
  });
  F.category.addEventListener('input', () => { syncCatChips(); if (!image) drawPhoto(); });
  syncCatChips();

  /* ----- kode ----- */
  q('[data-scan-code]').onclick = async () => {
    const code = await scanOnce({ title: 'Scan barcode barang' });
    if (!code) return;
    const other = store.findByCode(code);
    if (other && other.id !== p.id) { toast(`Kode ini sudah dipakai "${other.name}"`, { type: 'bad' }); return; }
    F.code.value = code;
    toast('Kode terisi', { type: 'ok' });
    if (!F.name.value) F.name.focus();
  };
  q('[data-gen]').onclick = () => { F.code.value = store.generateCode(); };

  const collect = () => ({
    id: product?.id,
    code: F.code.value,
    name: F.name.value,
    category: F.category.value,
    brand: F.brand.value,
    ingredient: F.ingredient.value,
    usage: F.usage.value,
    unit: F.unit.value,
    buyPrice: buyVal(),
    sellPrice: sellVal(),
    tiers: tiers.filter((t) => t.min && t.price),
    minStock: parseQty(F.minStock.value),
    expiry: F.expiry.value,
    ...(isNew ? { stock: parseQty(F.stock.value) } : {}),
    image,
  });

  async function save(again = false) {
    const data = collect();
    if (!data.name.trim()) { toast('Nama barang wajib diisi', { type: 'bad' }); F.name.focus(); return; }
    if (data.tiers.some((t) => t.price >= data.sellPrice || t.min <= 1)) {
      toast('Periksa harga grosir: minimal beli lebih dari 1 dan harganya lebih murah dari harga jual.', { type: 'bad', duration: 4500 });
      return;
    }
    if (!data.sellPrice) {
      const ok = await confirmDialog('Harga jual masih Rp 0. Tetap simpan?', { ok: 'Tetap simpan' });
      if (!ok) { F.sellPrice.focus(); return; }
    }
    try {
      const saved = await store.saveProduct(data);
      toast(`${saved.name} disimpan`, { type: 'ok' });
      if (again) {
        f.reset(); F.code.value = ''; F.unit.value = data.unit; F.category.value = data.category; F.brand.value = data.brand; F.minStock.value = num(data.minStock);
        image = null; tiers = []; drawPhoto(); drawMargin(); drawTiers(); syncCatChips(); F.name.focus();
      } else if (isNew) {
        location.hash = '#/produk/' + saved.id;
      } else {
        const box = q('[data-qr-preview]');
        if (box) box.innerHTML = labelHTML(saved, { store: true });
        q('.page-head h1').textContent = saved.name;
      }
    } catch (err) { toast(err.message, { type: 'bad' }); }
  }
  f.addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  q('[data-save-new]')?.addEventListener('click', () => save(true));

  q('[data-delete]')?.addEventListener('click', async () => {
    const ok = await confirmDialog(`Hapus "${p.name}" dari daftar produk? Riwayat penjualan tetap tersimpan.`, { title: 'Hapus produk', ok: 'Hapus', danger: true });
    if (!ok) return;
    await store.deleteProduct(p.id);
    toast(`${p.name} dihapus`, { type: 'ok' });
    location.hash = '#/produk';
  });

  let unsub = () => {};
  if (!isNew) {
    const fresh = () => store.getProduct(p.id) || p;
    const drawMoves = async () => {
      const moves = await store.listMoves(p.id, 60);
      const LABEL = { awal: 'Stok awal', masuk: 'Barang masuk', keluar: 'Barang keluar', koreksi: 'Koreksi', jual: 'Terjual', batal: 'Batal jual' };
      const el = q('[data-moves]');
      if (!el) return;
      el.innerHTML = moves.length ? `<div class="moves">${moves.map((mv) => `
        <div class="move"><span class="move-qty ${mv.qty < 0 ? 'neg' : 'up'}">${mv.qty > 0 ? '+' : ''}${num(mv.qty)}</span>
        <span class="move-main"><strong>${LABEL[mv.type] || mv.type}</strong><small>${fmtDateTime(mv.createdAt)}${mv.note ? ' · ' + esc(mv.note) : ''}</small></span>
        <span class="move-after" title="Stok setelahnya">${num(mv.after)}</span></div>`).join('')}</div>` : '<p class="muted">Belum ada pergerakan stok.</p>';
    };
    const openAdj = () => openStockDialog(fresh());
    q('[data-adjust]').onclick = openAdj;
    q('[data-adjust2]').onclick = openAdj;
    q('[data-qr]').onclick = () => openQrDialog(fresh());
    q('[data-qr-open]').onclick = () => openQrDialog(fresh());
    q('[data-qr-save]').onclick = () => saveQrPng(fresh()).catch((e) => toast(e.message, { type: 'bad' }));
    q('[data-qr-print]').onclick = () => printLabel(fresh(), 1);
    unsub = store.subscribe((w) => {
      if (w !== 'products' && w !== 'all') return;
      const np = store.getProduct(p.id);
      if (np && q('[data-stock-now]')) {
        q('[data-stock-now]').textContent = `${num(np.stock)} ${np.unit}`;
        if (document.activeElement !== F.expiry) F.expiry.value = np.expiry || '';
        drawMoves();
      }
    });
    drawMoves();
  } else {
    setTimeout(() => F.name.focus(), 50);
  }
  return () => { unsub(); document.removeEventListener('paste', onPaste); };
}

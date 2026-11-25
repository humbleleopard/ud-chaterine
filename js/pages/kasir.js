// Halaman Kasir: scan barang → keranjang (harga grosir otomatis) → bayar (tunai / QRIS / transfer / kasbon) → struk.
import * as store from '../store.js';
import { loadCart, saveCart, addToCart, clearCart, cartTotals, reprice } from '../cart.js';
import { CameraScanner, cameraPanelHTML, wireCameraPanel, cameraErrorMessage } from '../scanner.js';
import { toast, beep, openModal, confirmDialog, bindMoney, isTouch, autoFocusOnType, productArt, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, parseMoney, parseQty, round3, fmtDate } from '../format.js';
import { openReceiptDialog, pickCustomer, avatar, defaultDueDate } from '../dialogs.js';
import { dynamicQris, inspectQris } from '../qris.js';
import { qrSvg } from '../qr.js';
import { isUnlocked } from '../auth.js';

const CAM_PREF = 'kasirqr-cam';
const pref = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };

export async function render(view) {
  const cart = loadCart();
  cart.items = cart.items.filter((i) => store.getProduct(i.productId));
  if (cart.customerId && !store.getCustomer(cart.customerId)) cart.customerId = '';
  saveCart(cart);
  let category = '';
  let hi = -1;
  let quick = [];
  let flashId = null;
  let scanner = null;

  view.innerHTML = `
  <div class="page pos-page">
    <div class="pos">
      <section class="pos-main">
        <div class="scanbar">
          <form class="scan-input" data-scan-form autocomplete="off">
            ${icon('scan')}
            <input id="scan" type="search" placeholder="Scan atau cari barang…" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="enter" aria-label="Kode atau nama barang">
          </form>
          <button type="button" class="btn cam-toggle" data-cam-toggle aria-pressed="false">${icon('camera')}<span>Kamera</span></button>
        </div>
        <div class="last-scan" data-last hidden></div>
        <div class="cam-panel card" data-cam-panel hidden>${cameraPanelHTML({ hint: 'Arahkan ke barcode/QR. Barang otomatis masuk keranjang; scan lagi untuk menambah jumlah.' })}</div>
        <div class="card quick">
          <div class="quick-head"><h2>Pilih barang</h2><span class="muted small" data-quick-info></span></div>
          <div class="chips" data-cats></div>
          <div class="quick-grid" data-quick></div>
        </div>
      </section>
      <aside class="pos-cart card" id="cart-panel">
        <header class="cart-head">
          <h2>${icon('cart')} Keranjang <span class="count" data-count>0</span></h2>
          <button type="button" class="btn sm ghost" data-clear>${icon('trash')}<span>Kosongkan</span></button>
        </header>
        <button type="button" class="cart-cust" data-cust></button>
        <div class="cart-list" data-cart></div>
        <div class="totals" data-totals></div>
        <button type="button" class="btn primary lg block pay-btn" data-pay>${icon('wallet')}<span>Bayar</span><strong data-pay-total></strong></button>
        <p class="kbd-tips"><kbd>F2</kbd> cari &nbsp;<kbd>F4</kbd> bayar &nbsp;<kbd>3*kode</kbd> isi jumlah</p>
      </aside>
    </div>
    <div class="paybar" data-paybar hidden>
      <button type="button" class="paybar-info" data-goto-cart><span data-pb-count></span><strong data-pb-total></strong></button>
      <button type="button" class="btn primary lg" data-pay>${icon('wallet')} Bayar</button>
    </div>
  </div>`;

  const q = (s) => view.querySelector(s);
  const input = q('#scan');
  const camPanel = q('[data-cam-panel]');
  const camBtn = q('[data-cam-toggle]');

  /* ---------- daftar barang cepat ---------- */
  function renderCats() {
    const cats = store.categories();
    q('[data-cats]').innerHTML = cats.length
      ? [`<button type="button" class="chip ${category === '' ? 'active' : ''}" data-cat="">Semua</button>`, ...cats.map((c) => `<button type="button" class="chip ${category === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)].join('')
      : '';
  }

  function renderQuick() {
    const text = input.value.trim().replace(/^\d+(?:[.,]\d+)?\s*(?:\*|x\s)\s*/i, '');
    quick = store.searchProducts(text, { limit: 60, category });
    if (hi >= quick.length) hi = quick.length - 1;
    const grid = q('[data-quick]');
    if (!store.state.products.length) {
      grid.innerHTML = emptyState('box', 'Belum ada produk', 'Daftarkan barang dulu supaya bisa dijual.',
        `<a class="btn primary" href="#/produk/baru">${icon('plus')} Tambah produk</a><a class="btn" href="#/pengaturan">${icon('sparkle')} Isi data contoh</a>`);
      q('[data-quick-info]').textContent = '';
      return;
    }
    grid.innerHTML = quick.length ? quick.map((p, i) => {
      const exp = store.expiryStatus(p);
      const badge = p.stock <= 0 ? '<span class="tile-badge bad">Habis</span>'
        : exp === 'lewat' ? '<span class="tile-badge bad">Kedaluwarsa</span>'
        : p.tiers?.length ? '<span class="tile-badge gold">Grosir</span>' : '';
      return `<button type="button" class="tile ${i === hi ? 'hi' : ''} ${p.stock <= 0 ? 'out' : ''}" data-pid="${p.id}">
        <span class="tile-img">${productArt(p)}${badge}</span>
        <span class="tile-body">
          <span class="tile-name">${esc(p.name)}</span>
          <span class="tile-price">${rp(p.sellPrice)}<small>/${esc(p.unit)}</small></span>
          <span class="tile-stock">${p.stock <= 0 ? 'Stok habis' : 'Stok ' + num(p.stock)}</span>
        </span>
      </button>`;
    }).join('') : `<p class="muted center pad">Tidak ada barang yang cocok dengan “${esc(text)}”.</p>`;
    q('[data-quick-info]').textContent = text ? `${quick.length} hasil` : 'Ketuk untuk menambah';
  }

  /* ---------- keranjang ---------- */
  function renderCustomer() {
    const c = cart.customerId ? store.getCustomer(cart.customerId) : null;
    q('[data-cust]').innerHTML = c
      ? `${avatar(c, 'sm')}<span class="cc-main"><strong>${esc(c.name)}</strong><small>${c.balance > 0 ? `Utang berjalan ${rp(c.balance)}` : esc(c.address || 'Pelanggan')}</small></span><span class="cc-act">Ganti</span>`
      : `<span class="avatar sm ghost">${icon('user')}</span><span class="cc-main"><strong>Pembeli umum</strong><small>Ketuk untuk pilih pelanggan (wajib untuk kasbon)</small></span><span class="cc-act">Pilih</span>`;
  }

  function renderCart() {
    const st = store.state.settings;
    const t = cartTotals(cart, st.taxPercent);
    q('[data-count]').textContent = num(t.count);
    q('[data-cart]').innerHTML = cart.items.length ? cart.items.map((l) => {
      const p = store.getProduct(l.productId);
      const over = p && l.qty > (Number(p.stock) || 0);
      const grosir = !l.manual && l.normalPrice && l.price < l.normalPrice;
      return `<div class="cart-line ${l.productId === flashId ? 'flash' : ''}" data-id="${l.productId}">
        <button type="button" class="cl-main" data-edit>
          <span class="cl-name">${esc(l.name)}</span>
          <span class="cl-sub">${rp(l.price)} / ${esc(l.unit)}${grosir ? ' <span class="tag gold">Grosir</span>' : ''}${l.manual ? ' <span class="tag">Harga diubah</span>' : ''}${over ? ` <span class="warn-text">· stok ${num(p.stock)}</span>` : ''}</span>
        </button>
        <div class="stepper">
          <button type="button" data-dec aria-label="Kurangi">${icon('minus')}</button>
          <button type="button" class="stepper-val" data-qty aria-label="Ubah jumlah">${num(l.qty)}</button>
          <button type="button" data-inc aria-label="Tambah">${icon('plus')}</button>
        </div>
        <div class="cl-total">${rp(Math.round(l.qty * l.price))}</div>
      </div>`;
    }).join('') : emptyState('cart', 'Keranjang kosong', 'Scan barcode/QR barang, ketik namanya, atau ketuk dari daftar.');
    const d = cart.discount || {};
    q('[data-totals]').innerHTML = `
      <div class="t-row"><span>Subtotal</span><span>${rp(t.subtotal)}</span></div>
      ${t.savings ? `<div class="t-row gold-text"><span>${icon('layers')} Hemat harga grosir</span><span>${rp(t.savings)}</span></div>` : ''}
      <div class="t-row"><button type="button" class="link" data-discount>${icon('percent')} ${t.discount ? `Diskon${d.type === 'pct' ? ' ' + num(d.value) + '%' : ''}` : 'Tambah diskon'}</button><span>${t.discount ? '-' + rp(t.discount) : ''}</span></div>
      ${t.tax ? `<div class="t-row"><span>Pajak ${num(st.taxPercent)}%</span><span>${rp(t.tax)}</span></div>` : ''}
      <div class="t-row t-total"><span>Total</span><span>${rp(t.total)}</span></div>`;
    q('[data-pay-total]').textContent = rp(t.total);
    q('[data-pb-count]').textContent = `${num(t.count)} barang`;
    q('[data-pb-total]').textContent = rp(t.total);
    q('[data-paybar]').hidden = !cart.items.length;
    view.querySelectorAll('[data-pay]').forEach((b) => (b.disabled = !cart.items.length));
    q('[data-clear]').hidden = !cart.items.length && !cart.customerId;
    renderCustomer();
    if (flashId) {
      q(`.cart-line[data-id="${CSS.escape(flashId)}"]`)?.scrollIntoView({ block: 'nearest' });
      flashId = null;
    }
  }

  function showLast(p, line) {
    const el = q('[data-last]');
    el.hidden = false;
    el.innerHTML = `${icon('check')}<span class="ls-name">${esc(p.name)}</span><span class="ls-qty">× ${num(line.qty)}</span><strong>${rp(line.price)}</strong>`;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  }

  function addProduct(p, qty = 1) {
    const st = store.state.settings;
    const inCart = cart.items.find((l) => l.productId === p.id)?.qty || 0;
    if (!st.allowNegativeStock && inCart + qty > (Number(p.stock) || 0)) {
      beep(false);
      toast(p.stock > 0 ? `Stok ${p.name} tinggal ${num(p.stock)} ${p.unit}` : `${p.name} stoknya habis`, {
        type: 'bad',
        ...(isUnlocked() ? { action: () => { location.hash = '#/produk/' + p.id; }, actionLabel: 'Atur stok' } : {}),
      });
      return false;
    }
    const line = addToCart(cart, p, qty);
    flashId = p.id;
    beep(true);
    showLast(p, line);
    renderCart();
    if (!inCart && store.expiryStatus(p) === 'lewat') {
      toast(`Perhatian: ${p.name} sudah kedaluwarsa (${fmtDate(p.expiry)})`, { type: 'bad', duration: 5000 });
    }
    return true;
  }

  function unknown(raw) {
    beep(false);
    const looksLikeCode = !/\s/.test(raw) && raw.length >= 3;
    if (looksLikeCode && isUnlocked()) {
      toast(`Kode ${raw} belum terdaftar`, { type: 'bad', action: () => { location.hash = '#/produk/baru/' + encodeURIComponent(raw); }, actionLabel: 'Daftarkan' });
    } else {
      toast(looksLikeCode ? `Kode ${raw} belum terdaftar` : `Barang “${raw}” tidak ditemukan`, { type: 'bad' });
    }
  }

  function handleCode(raw, fromCamera = false) {
    let text = String(raw || '').trim();
    if (!text) return false;
    if (fromCamera && document.querySelector('dialog[open]')) return false;
    let qty = 1;
    const m = text.match(/^(\d+(?:[.,]\d+)?)\s*(?:\*|x\s)\s*(.+)$/i);
    if (m) { qty = parseQty(m[1]) || 1; text = m[2].trim(); }
    const exact = store.findByCode(text);
    if (exact) { addProduct(exact, qty); return true; }
    if (fromCamera) { unknown(text); return false; }
    const list = store.searchProducts(text, { limit: 60, category });
    const pick = (hi >= 0 && quick[hi]) || (list.length === 1 ? list[0] : null);
    if (pick) { addProduct(pick, qty); return true; }
    unknown(text);
    return false;
  }

  /* ---------- ubah baris, diskon, pelanggan ---------- */
  function editLine(id) {
    const l = cart.items.find((x) => x.productId === id);
    if (!l) return;
    const p = store.getProduct(id);
    const tiers = p?.tiers || [];
    const m = openModal({
      title: l.name, size: 'sm',
      body: `<form data-form class="stack">
        <label class="field"><span>Jumlah (${esc(l.unit)})</span><input class="input xl" name="qty" inputmode="decimal" value="${esc(num(l.qty))}" autocomplete="off"></label>
        <label class="field"><span>Harga satuan</span><input class="input" name="price" inputmode="numeric" value="${esc(num(l.price))}" autocomplete="off"></label>
        ${tiers.length ? `<div class="tier-hint">${icon('layers')}<span>Harga grosir: ${tiers.map((t) => `≥ ${num(t.min)} ${esc(l.unit)} <b>${rp(t.price)}</b>`).join(' · ')}</span></div>` : ''}
        ${l.manual && p ? `<button type="button" class="link" data-reset-price>${icon('undo')} Pakai harga otomatis lagi</button>` : ''}
      </form>`,
      foot: `<button type="button" class="btn ghost danger-text" data-remove>${icon('trash')} Hapus</button><span class="spacer"></span><button type="button" class="btn primary" data-save>${icon('check')} Simpan</button>`,
    });
    const priceEl = m.$('[name=price]');
    const priceVal = bindMoney(priceEl);
    const startPrice = l.price;
    let resetManual = false;
    m.$('[data-reset-price]')?.addEventListener('click', () => {
      resetManual = true;
      priceEl.value = num(store.tierPrice(p, parseQty(m.$('[name=qty]').value) || l.qty));
    });
    const save = () => {
      const qty = parseQty(m.$('[name=qty]').value);
      if (!(qty > 0)) { m.$('[name=qty]').focus(); return; }
      const st = store.state.settings;
      if (p && !st.allowNegativeStock && qty > (Number(p.stock) || 0)) { toast(`Stok ${p.name} tinggal ${num(p.stock)}`, { type: 'bad' }); return; }
      l.qty = qty;
      const price = priceVal();
      if (resetManual) { l.manual = false; reprice(l, p); }
      else if (price !== startPrice) { l.manual = true; l.price = price; }
      else reprice(l, p);
      saveCart(cart); renderCart(); m.close();
    };
    m.$('[data-save]').onclick = save;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); save(); };
    m.$('[data-remove]').onclick = () => { removeLine(id); m.close(); };
    setTimeout(() => { m.$('[name=qty]').focus(); m.$('[name=qty]').select(); }, 30);
  }

  function removeLine(id) {
    const i = cart.items.findIndex((x) => x.productId === id);
    if (i < 0) return;
    const [removed] = cart.items.splice(i, 1);
    saveCart(cart); renderCart();
    toast(`${removed.name} dihapus`, { action: () => { cart.items.splice(i, 0, removed); saveCart(cart); renderCart(); }, actionLabel: 'Urungkan' });
  }

  function editDiscount() {
    const d = { type: 'rp', value: 0, ...(cart.discount || {}) };
    let type = d.type;
    const m = openModal({
      title: 'Diskon transaksi', size: 'sm',
      body: `<div class="seg seg-2"><button type="button" data-t="rp">Rupiah</button><button type="button" data-t="pct">Persen</button></div>
        <form data-form><label class="field"><span data-lbl></span><input class="input xl" name="v" autocomplete="off"></label></form>`,
      foot: `${d.value ? `<button type="button" class="btn ghost danger-text" data-del>Hapus diskon</button>` : ''}<span class="spacer"></span><button type="button" class="btn primary" data-save>Terapkan</button>`,
    });
    const inp = m.$('[name=v]');
    const sync = () => {
      m.$$('[data-t]').forEach((b) => b.classList.toggle('active', b.dataset.t === type));
      m.$('[data-lbl]').textContent = type === 'pct' ? 'Potongan (%)' : 'Potongan (Rp)';
      inp.inputMode = type === 'pct' ? 'decimal' : 'numeric';
    };
    inp.addEventListener('input', () => {
      if (type !== 'rp') return;
      const v = parseMoney(inp.value);
      inp.value = v ? num(v) : '';
    });
    m.$$('[data-t]').forEach((b) => (b.onclick = () => { type = b.dataset.t; sync(); inp.value = ''; inp.focus(); }));
    sync();
    inp.value = d.value ? num(d.value) : '';
    const save = () => {
      const value = type === 'pct' ? Math.min(100, parseQty(inp.value)) : parseMoney(inp.value);
      cart.discount = { type, value };
      saveCart(cart); renderCart(); m.close();
    };
    m.$('[data-save]').onclick = save;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); save(); };
    m.$('[data-del]')?.addEventListener('click', () => { cart.discount = { type: 'rp', value: 0 }; saveCart(cart); renderCart(); m.close(); });
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  }

  async function chooseCustomer() {
    const c = await pickCustomer({ current: cart.customerId });
    if (c === undefined) return null;
    cart.customerId = c ? c.id : '';
    saveCart(cart); renderCart();
    return c || null;
  }

  /* ---------- pembayaran ---------- */
  function cashSuggestions(total) {
    const set = new Set([total]);
    for (const step of [1000, 2000, 5000, 10000, 20000, 50000, 100000]) {
      const v = Math.ceil(total / step) * step;
      if (v > 0) set.add(v);
    }
    return [...set].sort((a, b) => a - b).slice(0, 6);
  }

  function openPayment() {
    if (!cart.items.length) { beep(false); toast('Keranjang masih kosong', { type: 'bad' }); return; }
    const st = store.state.settings;
    if (!st.allowNegativeStock) {
      for (const l of cart.items) {
        const p = store.getProduct(l.productId);
        if (p && l.qty > (Number(p.stock) || 0)) { toast(`Stok ${p.name} tinggal ${num(p.stock)} ${p.unit}`, { type: 'bad' }); return; }
      }
    }
    const t = cartTotals(cart, st.taxPercent);
    let method = 'tunai';
    let busy = false;
    let qrisReady = false;
    const m = openModal({
      title: 'Pembayaran', size: 'md pay-modal',
      body: `
        <div class="pay-total"><span>Total belanja · ${num(t.count)} barang</span><strong>${rp(t.total)}</strong></div>
        <div class="seg seg-4 pay-methods" role="tablist">
          <button type="button" data-m="tunai">${icon('wallet')}<span>Tunai</span></button>
          <button type="button" data-m="qris">${icon('qr')}<span>QRIS</span></button>
          <button type="button" data-m="transfer">${icon('card')}<span>Transfer</span></button>
          <button type="button" data-m="utang">${icon('book')}<span>Kasbon</span></button>
        </div>
        <section data-panel="tunai">
          <label class="field"><span>Uang diterima</span><input class="input xl money" data-paid inputmode="numeric" autocomplete="off" placeholder="0"></label>
          <div class="cash-chips">${cashSuggestions(t.total).map((v) => `<button type="button" class="chip" data-cash="${v}">${v === t.total ? 'Uang pas' : rp(v)}</button>`).join('')}</div>
          <div class="change-box" data-change-box><span>Kembalian</span><strong data-change>—</strong></div>
        </section>
        <section data-panel="qris" hidden>
          ${st.qris ? `<div class="qris-box">
              <div class="qris-code" data-qris-code><span class="spinner"></span></div>
              <div class="qris-info"><span class="qris-logo">QRIS</span><strong data-qris-merchant></strong><span class="qris-amount">${rp(t.total)}</span><span class="muted small">Pembeli scan dengan m-banking atau e-wallet apa saja. Nominal sudah terisi otomatis.</span></div>
            </div>
            <label class="check"><input type="checkbox" data-qris-ok><span>Dana sudah masuk (sudah dicek di aplikasi bank/e-wallet toko)</span></label>`
            : `<div class="notice">${icon('qr')}<span>QRIS toko belum diatur. Masukkan QRIS statis toko di <a href="#/pengaturan" data-close>Pengaturan → Pembayaran QRIS</a>.</span></div>`}
        </section>
        <section data-panel="transfer" hidden>
          <label class="field"><span>No. referensi / catatan (opsional)</span><input class="input" data-ref autocomplete="off" placeholder="mis. nama pengirim, 4 digit kartu"></label>
          <label class="check"><input type="checkbox" data-tf-ok><span>Pembayaran sudah diterima</span></label>
        </section>
        <section data-panel="utang" hidden>
          <div data-kasbon-cust></div>
          <div class="form-grid">
            <label class="field"><span>Uang muka / DP (boleh 0)</span><input class="input" data-dp inputmode="numeric" autocomplete="off" placeholder="0"></label>
            <label class="field"><span>Jatuh tempo</span><input class="input" type="date" data-due value="${defaultDueDate()}"></label>
          </div>
          <div class="change-box kasbon" data-kasbon-box><span>Dicatat sebagai utang</span><strong data-kasbon-amt>—</strong></div>
        </section>`,
      foot: `<button type="button" class="btn ghost" data-close>Kembali</button><button type="button" class="btn primary lg" data-done disabled>${icon('check')} Selesaikan</button>`,
      onClose: () => { if (!isTouch()) setTimeout(() => input.focus(), 50); },
    });
    const paidEl = m.$('[data-paid]');
    const paidVal = bindMoney(paidEl);
    const dpVal = bindMoney(m.$('[data-dp]'));
    const done = m.$('[data-done]');

    const drawKasbonCustomer = () => {
      const c = cart.customerId ? store.getCustomer(cart.customerId) : null;
      m.$('[data-kasbon-cust]').innerHTML = c
        ? `<button type="button" class="cart-cust in-modal" data-kc>${avatar(c, 'sm')}<span class="cc-main"><strong>${esc(c.name)}</strong><small>${c.balance > 0 ? `Utang sebelumnya ${rp(c.balance)}` : 'Belum ada utang'}</small></span><span class="cc-act">Ganti</span></button>`
        : `<button type="button" class="btn block" data-kc>${icon('user')} Pilih pelanggan untuk kasbon</button>`;
      m.$('[data-kc]').onclick = async () => { await chooseCustomer(); drawKasbonCustomer(); validate(); };
    };

    const validate = () => {
      let ok = false;
      if (method === 'tunai') {
        const change = paidVal() - t.total;
        const has = paidEl.value.trim() !== '';
        m.$('[data-change]').textContent = has ? (change >= 0 ? rp(change) : 'Kurang ' + rp(-change)) : '—';
        m.$('[data-change-box]').classList.toggle('neg', has && change < 0);
        ok = has && change >= 0;
      } else if (method === 'qris') {
        ok = qrisReady && !!m.$('[data-qris-ok]')?.checked;
      } else if (method === 'transfer') {
        ok = !!m.$('[data-tf-ok]')?.checked;
      } else {
        const dp = dpVal();
        const c = cart.customerId ? store.getCustomer(cart.customerId) : null;
        const debt = t.total - dp;
        m.$('[data-kasbon-amt]').textContent = debt > 0 ? rp(debt) + (c ? ` · total utang ${rp((c.balance || 0) + debt)}` : '') : 'DP sudah menutup total';
        m.$('[data-kasbon-box]').classList.toggle('neg', debt <= 0);
        ok = !!c && debt > 0;
      }
      done.disabled = !ok || busy;
    };

    const setMethod = async (mt) => {
      method = mt;
      m.$$('[data-m]').forEach((b) => b.classList.toggle('active', b.dataset.m === mt));
      m.$$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== mt));
      if (mt === 'utang') drawKasbonCustomer();
      validate();
      if (mt === 'tunai') paidEl.focus();
      if (mt === 'qris' && st.qris && !qrisReady) {
        const box = m.$('[data-qris-code]');
        try {
          const info = inspectQris(st.qris);
          m.$('[data-qris-merchant]').textContent = info.merchant || st.storeName;
          box.innerHTML = await qrSvg(dynamicQris(st.qris, t.total), { ecl: 'M', margin: 3 });
          qrisReady = true;
        } catch (err) {
          box.innerHTML = `<p class="field-error">${esc(err.message)}</p>`;
        }
        validate();
      }
    };

    m.$$('[data-m]').forEach((b) => (b.onclick = () => setMethod(b.dataset.m)));
    m.$$('[data-cash]').forEach((b) => (b.onclick = () => { paidEl.value = num(Number(b.dataset.cash)); validate(); done.focus(); }));
    paidEl.addEventListener('input', validate);
    m.$('[data-dp]').addEventListener('input', validate);
    paidEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!done.disabled) done.click(); } });
    m.el.addEventListener('change', validate);

    done.onclick = async () => {
      if (done.disabled) return;
      busy = true; validate();
      try {
        const sale = await store.checkout({
          items: cart.items,
          discount: t.discount,
          method,
          paid: method === 'tunai' ? paidVal() : method === 'utang' ? dpVal() : t.total,
          ref: m.$('[data-ref]')?.value || '',
          customerId: cart.customerId,
          dueDate: m.$('[data-due]')?.value || '',
        });
        clearCart(cart);
        renderCart();
        renderQuick();
        q('[data-last]').hidden = true;
        m.close();
        openReceiptDialog(sale, { afterCheckout: true });
      } catch (err) {
        busy = false; validate();
        beep(false);
        toast(err.message, { type: 'bad' });
      }
    };
    setMethod('tunai');
  }

  /* ---------- kamera ---------- */
  async function startCamera() {
    camPanel.hidden = false;
    camBtn.classList.add('active');
    camBtn.setAttribute('aria-pressed', 'true');
    const err = camPanel.querySelector('.cam-error');
    err.hidden = true;
    if (!scanner) {
      scanner = new CameraScanner(camPanel.querySelector('.cam-view'), (code) => handleCode(code, true), { cooldown: 1800 });
      wireCameraPanel(camPanel, scanner, toast);
    }
    try {
      await scanner.start();
      camPanel.querySelector('.cam-frame').classList.add('live');
      pref.set(CAM_PREF, '1');
    } catch (e) {
      err.textContent = cameraErrorMessage(e);
      err.hidden = false;
      camPanel.querySelector('.cam-frame').classList.remove('live');
    }
  }
  async function stopCamera() {
    await scanner?.stop();
    camPanel.hidden = true;
    camPanel.querySelector('.cam-frame').classList.remove('live');
    camBtn.classList.remove('active');
    camBtn.setAttribute('aria-pressed', 'false');
    pref.set(CAM_PREF, '0');
  }

  /* ---------- event ---------- */
  q('[data-scan-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    if (handleCode(input.value)) { input.value = ''; hi = -1; renderQuick(); }
    else input.select();
  });
  input.addEventListener('input', () => { hi = input.value.trim() ? 0 : -1; renderQuick(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!quick.length) return;
      e.preventDefault();
      hi = Math.max(0, Math.min(quick.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1)));
      renderQuick();
      q('.tile.hi')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape') {
      input.value = ''; hi = -1; renderQuick();
    }
  });
  camBtn.addEventListener('click', () => (scanner?.running ? stopCamera() : startCamera()));
  q('[data-cats]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    category = b.dataset.cat; hi = -1;
    renderCats(); renderQuick();
  });
  q('[data-quick]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pid]');
    if (!b) return;
    const p = store.getProduct(b.dataset.pid);
    if (p) addProduct(p, 1);
    if (!isTouch()) input.focus();
  });
  q('[data-cart]').addEventListener('click', (e) => {
    const line = e.target.closest('.cart-line');
    if (!line) return;
    const id = line.dataset.id;
    const l = cart.items.find((x) => x.productId === id);
    if (!l) return;
    const p = store.getProduct(id);
    if (e.target.closest('[data-inc]')) {
      if (p && !store.state.settings.allowNegativeStock && l.qty + 1 > (Number(p.stock) || 0)) { beep(false); toast(`Stok ${p.name} tinggal ${num(p.stock)}`, { type: 'bad' }); return; }
      l.qty = round3(l.qty + 1); reprice(l, p); saveCart(cart); renderCart();
    } else if (e.target.closest('[data-dec]')) {
      if (l.qty <= 1) removeLine(id);
      else { l.qty = round3(l.qty - 1); reprice(l, p); saveCart(cart); renderCart(); }
    } else if (e.target.closest('[data-qty]') || e.target.closest('[data-edit]')) {
      editLine(id);
    }
  });
  // dipasang di elemen halaman (bukan #view) supaya ikut hilang saat pindah halaman
  q('.pos-page').addEventListener('click', (e) => {
    if (e.target.closest('[data-discount]')) editDiscount();
    else if (e.target.closest('[data-pay]')) openPayment();
    else if (e.target.closest('[data-cust]')) chooseCustomer();
    else if (e.target.closest('[data-goto-cart]')) q('#cart-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  q('[data-clear]').addEventListener('click', async () => {
    if (!cart.items.length && !cart.customerId) return;
    if (await confirmDialog('Kosongkan keranjang dan pelanggan yang dipilih?', { ok: 'Kosongkan', danger: true })) {
      clearCart(cart); renderCart(); q('[data-last]').hidden = true;
    }
  });

  const onKey = (e) => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'F2') { e.preventDefault(); input.focus(); input.select(); }
    else if (e.key === 'F4') { e.preventDefault(); openPayment(); }
  };
  document.addEventListener('keydown', onKey);
  const offType = autoFocusOnType(input);
  const unsub = store.subscribe((what) => {
    if (what === 'products' || what === 'all') {
      cart.items.forEach((l) => { const p = store.getProduct(l.productId); if (p) { l.name = p.name; l.unit = p.unit; reprice(l, p); } });
      cart.items = cart.items.filter((l) => store.getProduct(l.productId));
      saveCart(cart);
      renderCats(); renderQuick(); renderCart();
    } else if (what === 'settings' || what === 'customers') renderCart();
  });

  renderCats();
  renderQuick();
  renderCart();
  if (!isTouch()) input.focus();
  if (pref.get(CAM_PREF) === '1') startCamera();

  return async () => {
    document.removeEventListener('keydown', onKey);
    offType();
    unsub();
    await scanner?.stop();
  };
}

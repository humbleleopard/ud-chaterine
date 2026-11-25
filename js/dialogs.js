// Dialog bersama: atur stok, struk/detail transaksi, PIN, pilih & ubah pelanggan, terima pembayaran utang.
import * as store from './store.js';
import { openModal, toast, confirmDialog, promptDialog, bindMoney, METHOD_LABEL, initials, waNumber } from './ui.js';
import { esc, num, parseQty, rp, fmtDateTime, fmtDate, isoDate } from './format.js';
import { icon } from './icons.js';
import { receiptHTML, printHTML, shareWhatsApp } from './receipt.js';

/** Atur stok: barang masuk, keluar/rusak, atau koreksi hasil hitung. */
export function openStockDialog(product, { mode: initialMode = 'masuk' } = {}) {
  return new Promise((resolve) => {
    let saved = null;
    let mode = initialMode;
    const p = product;
    const m = openModal({
      title: 'Atur stok',
      size: 'sm',
      body: `<div class="stock-head"><strong>${esc(p.name)}</strong><span class="muted">Stok sekarang: <b>${num(p.stock)} ${esc(p.unit)}</b></span></div>
        <div class="seg seg-3" role="tablist">
          <button type="button" data-mode="masuk">${icon('plus')} Masuk</button>
          <button type="button" data-mode="keluar">${icon('minus')} Keluar</button>
          <button type="button" data-mode="set">${icon('check')} Koreksi</button>
        </div>
        <form data-form class="stack">
          <label class="field"><span data-qty-label>Jumlah</span>
            <input class="input xl" name="qty" inputmode="decimal" autocomplete="off" placeholder="0" required></label>
          <div class="form-grid" data-in-only>
            <label class="field"><span>Harga beli baru (opsional)</span><input class="input" name="buy" inputmode="numeric" autocomplete="off" placeholder="${p.buyPrice ? num(p.buyPrice) : '0'}"></label>
            <label class="field"><span>Kedaluwarsa stok baru</span><input class="input" type="date" name="exp" value="${esc(p.expiry || '')}"></label>
          </div>
          <label class="field"><span>Catatan (opsional)</span>
            <input class="input" name="note" autocomplete="off" placeholder="mis. kiriman distributor, barang rusak, stok opname"></label>
          <p class="stock-preview" data-preview></p>
        </form>`,
      foot: `<button type="button" class="btn ghost" data-close>Batal</button><button type="button" class="btn primary" data-save>${icon('check')} Simpan</button>`,
      onClose: () => resolve(saved),
    });
    const qtyEl = m.$('[name=qty]');
    const buyVal = bindMoney(m.$('[name=buy]'));
    const labels = { masuk: 'Jumlah barang masuk', keluar: 'Jumlah barang keluar / rusak', set: 'Jumlah stok hasil hitung' };
    const update = () => {
      m.$$('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      m.$('[data-qty-label]').textContent = `${labels[mode]} (${p.unit})`;
      m.$('[data-in-only]').hidden = mode !== 'masuk';
      const q = parseQty(qtyEl.value);
      const before = Number(p.stock) || 0;
      const after = mode === 'masuk' ? before + q : mode === 'keluar' ? before - q : q;
      m.$('[data-preview]').innerHTML = qtyEl.value.trim()
        ? `Stok: ${num(before)} → <b class="${after < 0 ? 'neg' : ''}">${num(after)}</b> ${esc(p.unit)}`
        : '';
    };
    m.$$('[data-mode]').forEach((b) => (b.onclick = () => { mode = b.dataset.mode; update(); qtyEl.focus(); }));
    qtyEl.addEventListener('input', update);
    const save = async () => {
      if (!qtyEl.value.trim()) { qtyEl.focus(); return; }
      try {
        saved = await store.adjustStock(p.id, {
          mode, qty: parseQty(qtyEl.value), note: m.$('[name=note]').value,
          buyPrice: mode === 'masuk' ? buyVal() : 0,
          expiry: mode === 'masuk' && m.$('[name=exp]').value !== (p.expiry || '') ? m.$('[name=exp]').value : '',
        });
        toast(`Stok ${saved.name} sekarang ${num(saved.stock)} ${saved.unit}`, { type: 'ok' });
        m.close();
      } catch (err) { toast(err.message, { type: 'bad' }); }
    };
    m.$('[data-save]').onclick = save;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); save(); };
    update();
    setTimeout(() => qtyEl.focus(), 30);
  });
}

/** Tampilkan struk; dipakai setelah bayar dan dari Riwayat. */
export function openReceiptDialog(sale, { afterCheckout = false, allowVoid = false, onChange } = {}) {
  const st = store.state.settings;
  const headline = sale.method === 'tunai' ? `Kembalian ${rp(sale.change)}`
    : sale.method === 'utang' ? `Kasbon ${rp(sale.debt)}` : `Lunas ${rp(sale.total)}`;
  const m = openModal({
    title: afterCheckout ? 'Transaksi berhasil' : 'Detail transaksi',
    size: 'md',
    body: `${afterCheckout ? `<div class="success-banner">${icon('check')}<div><strong>${headline}</strong><span>${esc(METHOD_LABEL[sale.method])} · ${esc(sale.no)}${sale.customerName ? ' · ' + esc(sale.customerName) : ''}</span></div></div>` : ''}
      ${sale.status === 'batal' ? `<div class="notice bad">${icon('alert')}<span>Dibatalkan ${fmtDateTime(sale.voidedAt)}${sale.voidReason ? ' — ' + esc(sale.voidReason) : ''}. Stok${sale.debt ? ' dan utang' : ''} sudah dikembalikan.</span></div>` : ''}
      <div class="receipt-preview">${receiptHTML(sale, st)}</div>`,
    foot: `${allowVoid && sale.status !== 'batal' ? `<button type="button" class="btn ghost danger-text" data-void>${icon('undo')} Batalkan</button><span class="spacer"></span>` : ''}
      <button type="button" class="btn" data-wa>${icon('message')} WhatsApp</button>
      <button type="button" class="btn" data-print>${icon('printer')} Cetak</button>
      ${afterCheckout ? `<button type="button" class="btn primary" data-close>${icon('plus')} Transaksi baru</button>` : ''}`,
  });
  m.$('[data-print]').onclick = () => printHTML(receiptHTML(sale, st), 'receipt');
  m.$('[data-wa]').onclick = () => {
    const c = sale.customerId ? store.getCustomer(sale.customerId) : null;
    shareWhatsApp(sale, st, c?.phone);
  };
  m.$('[data-void]')?.addEventListener('click', async () => {
    const ok = await confirmDialog(`Batalkan ${sale.no} senilai ${rp(sale.total)}? Stok barang${sale.debt ? ' dan utang pelanggan' : ''} akan dikembalikan.`, { title: 'Batalkan transaksi', ok: 'Batalkan transaksi', danger: true });
    if (!ok) return;
    const reason = await promptDialog({ title: 'Alasan pembatalan', label: 'Alasan (opsional)', placeholder: 'mis. salah input, pembeli batal', ok: 'Simpan' });
    if (reason === null) return;
    try {
      const updated = await store.voidSale(sale.id, reason);
      toast(`${updated.no} dibatalkan`, { type: 'ok' });
      m.close();
      onChange?.(updated);
    } catch (err) { toast(err.message, { type: 'bad' }); }
  });
  if (afterCheckout && st.autoPrint) setTimeout(() => printHTML(receiptHTML(sale, st), 'receipt'), 200);
  return m;
}

/** Minta PIN pemilik. true bila benar. */
export function askPin({ title = 'Masukkan PIN pemilik', text = 'Halaman ini dikunci. Masukkan PIN untuk membuka.' } = {}) {
  return new Promise((resolve) => {
    let ok = false;
    const m = openModal({
      title, size: 'sm',
      body: `<p class="muted">${esc(text)}</p><form data-form><input class="input xl pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" placeholder="••••" aria-label="PIN"></form><p class="field-error" hidden>PIN salah.</p>`,
      foot: `<button type="button" class="btn ghost" data-close>Batal</button><button type="button" class="btn primary" data-ok>${icon('unlock')} Buka</button>`,
      onClose: () => resolve(ok),
    });
    const input = m.$('input');
    const go = async () => {
      const h = await store.hashPin(input.value);
      if (h === store.state.settings.pinHash) { ok = true; m.close(); }
      else { m.$('.field-error').hidden = false; input.select(); }
    };
    m.$('[data-ok]').onclick = go;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); go(); };
    setTimeout(() => input.focus(), 30);
  });
}

/* ================= Pelanggan ================= */

export function avatar(c, cls = '') {
  let h = 0; for (const ch of c.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hues = ['#1f6b3a', '#8a5a19', '#2a5d8a', '#7a3b6e', '#4d7c0f', '#9a3412'];
  return `<span class="avatar ${cls}" style="--c:${hues[h % hues.length]}">${esc(initials(c.name))}</span>`;
}

export const debtBadge = (c) => {
  const b = Math.round(c.balance || 0);
  if (b > 0) return `<span class="badge bad">Utang ${rp(b)}</span>`;
  if (b < 0) return `<span class="badge ok">Deposit ${rp(-b)}</span>`;
  return '<span class="badge">Lunas</span>';
};

/** Form tambah/ubah pelanggan. Mengembalikan pelanggan tersimpan atau null. */
export function openCustomerForm(customer = null, { presetName = '' } = {}) {
  return new Promise((resolve) => {
    let saved = null;
    const c = customer || { name: presetName, phone: '', address: '', note: '' };
    const m = openModal({
      title: customer ? 'Ubah pelanggan' : 'Pelanggan baru',
      size: 'sm',
      body: `<form data-form class="stack">
        <label class="field"><span>Nama *</span><input class="input" name="name" value="${esc(c.name)}" autocomplete="off" placeholder="mis. Pak Sutrisno"></label>
        <label class="field"><span>No. HP / WhatsApp</span><input class="input" name="phone" value="${esc(c.phone)}" inputmode="tel" autocomplete="off" placeholder="08…"></label>
        <label class="field"><span>Alamat / desa</span><input class="input" name="address" value="${esc(c.address)}" autocomplete="off" placeholder="mis. Desa Sukamaju"></label>
        <label class="field"><span>Catatan</span><input class="input" name="note" value="${esc(c.note)}" autocomplete="off" placeholder="mis. petani padi, bayar setelah panen"></label>
      </form>`,
      foot: `<button type="button" class="btn ghost" data-close>Batal</button><button type="button" class="btn primary" data-save>${icon('check')} Simpan</button>`,
      onClose: () => resolve(saved),
    });
    const f = (n) => m.$(`[name=${n}]`);
    const save = async () => {
      try {
        saved = await store.saveCustomer({ id: customer?.id, name: f('name').value, phone: f('phone').value, address: f('address').value, note: f('note').value });
        toast(`${saved.name} disimpan`, { type: 'ok' });
        m.close();
      } catch (err) { toast(err.message, { type: 'bad' }); f('name').focus(); }
    };
    m.$('[data-save]').onclick = save;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); save(); };
    setTimeout(() => f('name').focus(), 30);
  });
}

/**
 * Pilih pelanggan. Hasil: objek pelanggan, '' untuk "Umum" (tanpa pelanggan), atau undefined bila ditutup.
 */
export function pickCustomer({ current = '', allowNone = true, title = 'Pilih pelanggan' } = {}) {
  return new Promise((resolve) => {
    let result;
    const m = openModal({
      title, size: 'sm',
      body: `<div class="scan-input">${icon('search')}<input type="search" data-q placeholder="Cari nama, HP, atau desa…" autocomplete="off"></div>
        <div class="cust-list" data-list></div>`,
      foot: `${allowNone ? `<button type="button" class="btn ghost" data-none>Tanpa pelanggan</button>` : ''}<span class="spacer"></span><button type="button" class="btn primary" data-new>${icon('plus')} Pelanggan baru</button>`,
      onClose: () => resolve(result),
    });
    const q = m.$('[data-q]');
    const draw = () => {
      const list = store.searchCustomers(q.value, 80);
      m.$('[data-list]').innerHTML = list.length ? list.map((c) => `
        <button type="button" class="cust-row ${c.id === current ? 'on' : ''}" data-id="${c.id}">${avatar(c)}<span class="cust-main"><strong>${esc(c.name)}</strong><small>${esc([c.address, c.phone].filter(Boolean).join(' · ') || '—')}</small></span>${c.balance > 0 ? `<span class="cust-debt">${rp(c.balance)}</span>` : ''}</button>`).join('')
        : `<p class="muted center pad">${store.state.customers.length ? 'Tidak ditemukan.' : 'Belum ada pelanggan. Tambahkan pelanggan baru.'}</p>`;
    };
    q.addEventListener('input', draw);
    m.$('[data-list]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      result = store.getCustomer(b.dataset.id);
      m.close();
    });
    m.$('[data-none]')?.addEventListener('click', () => { result = ''; m.close(); });
    m.$('[data-new]').onclick = async () => {
      const c = await openCustomerForm(null, { presetName: q.value.trim() });
      if (c) { result = c; m.close(); }
    };
    draw();
    setTimeout(() => q.focus(), 30);
  });
}

/** Terima pembayaran utang (cicilan / pelunasan). */
export function openDebtPayment(customer) {
  return new Promise((resolve) => {
    let entry = null;
    const bal = Math.max(0, Math.round(customer.balance || 0));
    const m = openModal({
      title: 'Terima pembayaran utang',
      size: 'sm',
      body: `<div class="pay-total"><span>${esc(customer.name)} · sisa utang</span><strong>${rp(bal)}</strong></div>
        <form data-form class="stack">
          <label class="field"><span>Jumlah dibayar</span><input class="input xl" name="amt" inputmode="numeric" autocomplete="off" placeholder="0"></label>
          <div class="cash-chips"><button type="button" class="chip" data-full>Lunas ${rp(bal)}</button>${bal >= 100000 ? `<button type="button" class="chip" data-half>Setengah ${rp(Math.round(bal / 2))}</button>` : ''}</div>
          <div class="seg seg-3" data-method><button type="button" data-v="tunai" class="active">Tunai</button><button type="button" data-v="qris">QRIS</button><button type="button" data-v="transfer">Transfer</button></div>
          <label class="field"><span>Catatan (opsional)</span><input class="input" name="note" autocomplete="off" placeholder="mis. bayar setelah panen"></label>
          <p class="stock-preview" data-after></p>
        </form>`,
      foot: `<button type="button" class="btn ghost" data-close>Batal</button><button type="button" class="btn primary" data-save>${icon('check')} Simpan pembayaran</button>`,
      onClose: () => resolve(entry),
    });
    const amt = m.$('[name=amt]');
    const val = bindMoney(amt);
    let method = 'tunai';
    const upd = () => {
      const v = val();
      m.$('[data-after]').innerHTML = v ? (v > bal ? `<span class="neg">Melebihi sisa utang.</span>` : `Sisa utang setelah bayar: <b>${rp(bal - v)}</b>`) : '';
    };
    amt.addEventListener('input', upd);
    m.$('[data-full]').onclick = () => { amt.value = num(bal); upd(); };
    m.$('[data-half]')?.addEventListener('click', () => { amt.value = num(Math.round(bal / 2)); upd(); });
    m.$$('[data-method] [data-v]').forEach((b) => (b.onclick = () => { method = b.dataset.v; m.$$('[data-method] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); }));
    const save = async () => {
      try {
        entry = await store.receivePayment(customer.id, { amount: val(), method, note: m.$('[name=note]').value });
        toast(`Pembayaran ${rp(-entry.amount)} dicatat. Sisa utang ${rp(entry.balanceAfter)}`, { type: 'ok', duration: 4000 });
        m.close();
      } catch (err) { toast(err.message, { type: 'bad' }); amt.focus(); }
    };
    m.$('[data-save]').onclick = save;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); save(); };
    setTimeout(() => amt.focus(), 30);
  });
}

/** Pesan pengingat utang via WhatsApp. */
export function remindDebtWhatsApp(customer) {
  const st = store.state.settings;
  const text = `Halo ${customer.name}, kami dari *${st.storeName}*. Mengingatkan sisa pembayaran di toko kami sebesar *${rp(customer.balance)}*${customer.dueDate ? `, jatuh tempo ${fmtDate(customer.dueDate)}` : ''}. Terima kasih atas kepercayaannya 🙏`;
  const n = waNumber(customer.phone);
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

export const defaultDueDate = () => {
  const d = new Date();
  d.setDate(d.getDate() + (Number(store.state.settings.defaultDueDays) || 30));
  return isoDate(d);
};

// Beranda: ringkasan hari ini, pintasan, peringatan stok, kedaluwarsa, kasbon jatuh tempo, transaksi terakhir.
import * as store from '../store.js';
import { thumb, stockBadge, METHOD_LABEL } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, fmtTime, fmtDate, fmtDateLong, startOfDay, endOfDay, timeAgo, fromIsoDate } from '../format.js';
import { isUnlocked } from '../auth.js';
import { openReceiptDialog, avatar } from '../dialogs.js';

export async function render(view) {
  const draw = async () => {
    const st = store.state.settings;
    const sales = (await store.listSales(startOfDay(), endOfDay())).filter((s) => s.status !== 'batal');
    const omzet = sales.reduce((a, s) => a + s.total, 0);
    const cashIn = sales.reduce((a, s) => a + (s.method === 'utang' ? s.paid : s.total), 0);
    const items = sales.reduce((a, s) => a + s.items.reduce((b, i) => b + i.qty, 0), 0);
    const profit = sales.reduce((a, s) => a + (s.total - s.tax) - s.items.reduce((b, i) => b + i.qty * (i.buyPrice || 0), 0), 0);
    const low = store.state.products.filter((p) => store.stockStatus(p) !== 'aman').sort((a, b) => (a.stock || 0) - (b.stock || 0));
    const expiring = store.state.products.filter((p) => ['lewat', 'segera'].includes(store.expiryStatus(p))).sort((a, b) => store.daysToExpiry(a) - store.daysToExpiry(b));
    const today = startOfDay();
    const dueSoon = store.state.customers.filter((c) => c.balance > 0 && c.dueDate && (fromIsoDate(c.dueDate) - today) / 864e5 <= 7)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const admin = isUnlocked();
    const noProducts = !store.state.products.length;
    const daysSinceBackup = st.lastBackupAt ? (Date.now() - new Date(st.lastBackupAt)) / 864e5 : Infinity;
    const hour = new Date().getHours();
    const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 19 ? 'Selamat sore' : 'Selamat malam';

    view.innerHTML = `
    <div class="page">
      <header class="hero">
        <div class="hero-text">
          <p class="hero-date">${fmtDateLong(new Date())}</p>
          <h1>${greet}, ${esc(st.cashierName || 'Kasir')}</h1>
          <p class="hero-store">${icon('leaf')} ${esc(st.storeName)} · ${esc(st.tagline || 'Toko Pertanian')}</p>
        </div>
        <a class="btn lg hero-cta" href="#/kasir">${icon('cart')} Mulai kasir</a>
      </header>

      ${noProducts ? `<div class="notice info">${icon('sparkle')}<span><b>Mulai di sini:</b> daftarkan barang toko (scan barcode kemasannya, tambahkan foto), atau coba dulu dengan data contoh toko pertanian.</span>
        <a class="btn sm primary" href="#/produk/baru">Tambah produk</a><a class="btn sm" href="#/pengaturan">Data contoh</a></div>` : ''}
      ${!noProducts && admin && daysSinceBackup > 7 ? `<div class="notice warn">${icon('database')}<span>${st.lastBackupAt ? `Backup terakhir ${timeAgo(st.lastBackupAt)}.` : 'Data belum pernah di-backup.'} Data tersimpan di perangkat ini saja, jadi backup secara rutin.</span><a class="btn sm" href="#/pengaturan">Backup sekarang</a></div>` : ''}

      <section class="kpis">
        <div class="kpi"><span class="kpi-label">Penjualan hari ini</span><strong class="kpi-value">${rp(omzet)}</strong><span class="kpi-sub">${num(sales.length)} transaksi${omzet !== cashIn ? ` · uang masuk ${rp(cashIn)}` : ''}</span></div>
        <div class="kpi"><span class="kpi-label">Barang terjual</span><strong class="kpi-value">${num(items)}</strong><span class="kpi-sub">unit hari ini</span></div>
        ${admin ? `<div class="kpi"><span class="kpi-label">Laba kotor hari ini</span><strong class="kpi-value">${rp(profit)}</strong><span class="kpi-sub">penjualan − modal barang</span></div>` : ''}
        <div class="kpi"><span class="kpi-label">Kasbon pelanggan</span><strong class="kpi-value">${rp(store.totalReceivable())}</strong><span class="kpi-sub"><a href="#/pelanggan">${num(store.state.customers.filter((c) => c.balance > 0).length)} pelanggan</a></span></div>
      </section>

      <section class="shortcuts">
        <a class="shortcut" href="#/kasir">${icon('cart')}<strong>Kasir</strong><span>Scan & bayar</span></a>
        <a class="shortcut" href="#/cek-harga">${icon('scan')}<strong>Cek harga</strong><span>Harga, stok, dosis</span></a>
        <a class="shortcut" href="#/produk/baru">${icon('plus')}<strong>Tambah produk</strong><span>Dengan foto & QR</span></a>
        <a class="shortcut" href="#/label">${icon('qr')}<strong>Label QR</strong><span>Simpan & cetak QR</span></a>
        <a class="shortcut" href="#/pelanggan">${icon('book')}<strong>Kasbon</strong><span>Utang pelanggan</span></a>
      </section>

      <div class="grid-2">
        <section class="card">
          <h2 class="card-title">${icon('alert')} Stok menipis & habis ${low.length ? `<a class="card-link" href="#/produk">Lihat semua</a>` : ''}</h2>
          ${low.length ? `<div class="mini-list">${low.slice(0, 6).map((p) => `
            <a class="mini-row" href="#/produk/${p.id}">${thumb(p)}<span class="mini-name">${esc(p.name)}</span>${stockBadge(p)}</a>`).join('')}</div>`
            : `<p class="muted">${noProducts ? 'Belum ada produk.' : 'Semua stok aman.'}</p>`}
        </section>
        <section class="card">
          <h2 class="card-title">${icon('calendar')} Kedaluwarsa ≤ ${num(st.expiryWarnDays)} hari</h2>
          ${expiring.length ? `<div class="mini-list">${expiring.slice(0, 6).map((p) => {
            const d = store.daysToExpiry(p);
            return `<a class="mini-row" href="#/produk/${p.id}">${thumb(p)}<span class="mini-name">${esc(p.name)}<small>${fmtDate(p.expiry)} · stok ${num(p.stock)}</small></span><span class="badge ${d < 0 ? 'bad' : 'warn'}">${d < 0 ? 'Lewat' : d + ' hari'}</span></a>`;
          }).join('')}</div>` : '<p class="muted">Tidak ada barang yang mendekati kedaluwarsa.</p>'}
        </section>
        <section class="card">
          <h2 class="card-title">${icon('book')} Kasbon jatuh tempo (7 hari) ${dueSoon.length ? `<a class="card-link" href="#/pelanggan">Semua</a>` : ''}</h2>
          ${dueSoon.length ? `<div class="mini-list">${dueSoon.slice(0, 6).map((c) => {
            const d = Math.round((fromIsoDate(c.dueDate) - today) / 864e5);
            return `<a class="mini-row" href="#/pelanggan/${c.id}">${avatar(c, 'sm')}<span class="mini-name">${esc(c.name)}<small>${fmtDate(c.dueDate)} · ${d < 0 ? `lewat ${-d} hari` : d === 0 ? 'hari ini' : d + ' hari lagi'}</small></span><strong class="${d < 0 ? 'neg' : ''}">${rp(c.balance)}</strong></a>`;
          }).join('')}</div>` : '<p class="muted">Tidak ada kasbon yang jatuh tempo minggu ini.</p>'}
        </section>
        <section class="card">
          <h2 class="card-title">${icon('clock')} Transaksi terakhir ${admin && sales.length ? `<a class="card-link" href="#/riwayat">Riwayat</a>` : ''}</h2>
          ${sales.length ? `<div class="mini-list">${sales.slice(0, 6).map((s) => `
            <button type="button" class="mini-row" data-sale="${s.id}"><span class="mini-time">${fmtTime(s.createdAt)}</span><span class="mini-name">${esc(s.customerName || s.no)}<small>${s.items.length} jenis · ${esc(METHOD_LABEL[s.method] || s.method)}</small></span><strong>${rp(s.total)}</strong></button>`).join('')}</div>`
            : '<p class="muted">Belum ada transaksi hari ini.</p>'}
        </section>
      </div>
    </div>`;

    view.querySelectorAll('[data-sale]').forEach((b) => b.addEventListener('click', () => {
      const s = sales.find((x) => x.id === b.dataset.sale);
      if (s) openReceiptDialog(s, { allowVoid: admin, onChange: draw });
    }));
  };

  await draw();
  const unsub = store.subscribe((w) => { if (['products', 'sales', 'all', 'settings', 'customers'].includes(w)) draw(); });
  return () => unsub();
}

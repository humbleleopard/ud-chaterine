// Riwayat transaksi: filter tanggal, cari, lihat struk, cetak ulang, batalkan, ekspor CSV.
import * as store from '../store.js';
import { emptyState, download, METHOD_LABEL } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, fmtTime, fmtDate, startOfDay, endOfDay, addDays, isoDate, fromIsoDate, dayKey } from '../format.js';
import { openReceiptDialog } from '../dialogs.js';
import { toCSV } from '../csv.js';

const RANGES = [
  ['today', 'Hari ini'], ['yesterday', 'Kemarin'], ['7', '7 hari'], ['30', '30 hari'], ['custom', 'Pilih tanggal'],
];

export async function render(view) {
  let range = 'today';
  let from = isoDate(addDays(new Date(), -6));
  let to = isoDate();
  let text = '';
  let method = '';
  let sales = [];

  view.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><h1>Riwayat transaksi</h1><p class="muted" data-summary></p></div>
      <div class="actions"><button type="button" class="btn" data-export>${icon('download')}<span>Ekspor CSV</span></button></div>
    </header>
    <div class="toolbar">
      <div class="seg seg-auto" data-range>${RANGES.map(([k, l]) => `<button type="button" data-r="${k}">${l}</button>`).join('')}</div>
      <div class="date-range" data-custom hidden>
        <input type="date" class="input" data-from value="${from}" aria-label="Dari tanggal"><span>–</span><input type="date" class="input" data-to value="${to}" aria-label="Sampai tanggal">
      </div>
    </div>
    <div class="toolbar">
      <div class="scan-input grow">${icon('search')}<input type="search" data-search placeholder="Cari no. transaksi, pelanggan, atau barang…" autocomplete="off"></div>
      <select class="input select" data-method aria-label="Metode bayar"><option value="">Semua metode</option>${Object.entries(METHOD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    </div>
    <div class="sales-list" data-list></div>
  </div>`;
  const q = (s) => view.querySelector(s);

  function bounds() {
    const now = new Date();
    if (range === 'today') return [startOfDay(now), endOfDay(now)];
    if (range === 'yesterday') { const y = addDays(now, -1); return [startOfDay(y), endOfDay(y)]; }
    if (range === '7') return [startOfDay(addDays(now, -6)), endOfDay(now)];
    if (range === '30') return [startOfDay(addDays(now, -29)), endOfDay(now)];
    let a = fromIsoDate(from), b = fromIsoDate(to);
    if (a > b) [a, b] = [b, a];
    return [startOfDay(a), endOfDay(b)];
  }

  function filtered() {
    const t = text.trim().toLowerCase();
    return sales.filter((s) => (!method || s.method === method)
      && (!t || s.no.toLowerCase().includes(t) || (s.customerName || '').toLowerCase().includes(t) || s.items.some((i) => i.name.toLowerCase().includes(t))));
  }

  function draw() {
    view.querySelectorAll('[data-r]').forEach((b) => b.classList.toggle('active', b.dataset.r === range));
    q('[data-custom]').hidden = range !== 'custom';
    const list = filtered();
    const ok = list.filter((s) => s.status !== 'batal');
    const batal = list.length - ok.length;
    q('[data-summary]').textContent = `${num(ok.length)} transaksi · ${rp(ok.reduce((a, s) => a + s.total, 0))}${batal ? ` · ${batal} dibatalkan` : ''}`;
    const el = q('[data-list]');
    if (!list.length) { el.innerHTML = emptyState('inbox', 'Tidak ada transaksi', 'Coba ubah rentang tanggal atau kata pencarian.'); return; }
    let lastDay = '';
    el.innerHTML = list.map((s) => {
      const day = dayKey(s.createdAt);
      const head = day !== lastDay ? `<h3 class="day-head">${fmtDate(s.createdAt)}</h3>` : '';
      lastDay = day;
      return `${head}<button type="button" class="sale-row ${s.status === 'batal' ? 'void' : ''}" data-id="${s.id}">
        <span class="sale-time">${fmtTime(s.createdAt)}</span>
        <span class="sale-main"><span class="sale-no mono">${esc(s.no)}</span><span class="sale-items">${s.customerName ? `<b>${esc(s.customerName)}</b> · ` : ''}${esc(s.items.map((i) => i.name).slice(0, 3).join(', '))}${s.items.length > 3 ? ` +${s.items.length - 3}` : ''}</span></span>
        <span class="badge ${s.method}">${esc(METHOD_LABEL[s.method] || s.method)}</span>
        ${s.status === 'batal' ? '<span class="badge bad">Batal</span>' : ''}
        <strong class="sale-total">${rp(s.total)}</strong>
      </button>`;
    }).join('');
  }

  async function load() {
    const [a, b] = bounds();
    q('[data-list]').innerHTML = '<span class="spinner"></span>';
    sales = await store.listSales(a, b);
    draw();
  }

  q('[data-range]').addEventListener('click', (e) => { const b = e.target.closest('[data-r]'); if (b) { range = b.dataset.r; load(); } });
  q('[data-from]').addEventListener('change', (e) => { from = e.target.value || from; load(); });
  q('[data-to]').addEventListener('change', (e) => { to = e.target.value || to; load(); });
  q('[data-search]').addEventListener('input', (e) => { text = e.target.value; draw(); });
  q('[data-method]').addEventListener('change', (e) => { method = e.target.value; draw(); });
  q('[data-list]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    const s = b && sales.find((x) => x.id === b.dataset.id);
    if (s) openReceiptDialog(s, { allowVoid: true, onChange: load });
  });
  q('[data-export]').addEventListener('click', () => {
    const rows = [];
    for (const s of filtered()) for (const i of s.items) rows.push({ s, i });
    const csv = toCSV([
      { label: 'no_transaksi', get: (r) => r.s.no },
      { label: 'waktu', get: (r) => new Date(r.s.createdAt).toLocaleString('id-ID') },
      { label: 'status', get: (r) => r.s.status },
      { label: 'metode', get: (r) => METHOD_LABEL[r.s.method] || r.s.method },
      { label: 'kode', get: (r) => r.i.code },
      { label: 'barang', get: (r) => r.i.name },
      { label: 'jumlah', get: (r) => String(r.i.qty).replace('.', ',') },
      { label: 'harga', get: (r) => r.i.price },
      { label: 'subtotal', get: (r) => r.i.subtotal },
      { label: 'modal', get: (r) => Math.round(r.i.qty * (r.i.buyPrice || 0)) },
      { label: 'diskon_transaksi', get: (r) => r.s.discount },
      { label: 'total_transaksi', get: (r) => r.s.total },
      { label: 'pelanggan', get: (r) => r.s.customerName || '' },
      { label: 'kasbon', get: (r) => r.s.debt || 0 },
      { label: 'kasir', get: (r) => r.s.cashier },
    ], rows);
    const [a, b] = bounds();
    download(`transaksi-${isoDate(a)}_${isoDate(b)}.csv`, csv, 'text/csv;charset=utf-8');
  });

  const unsub = store.subscribe((w) => { if (w === 'sales' || w === 'all') load(); });
  await load();
  return () => unsub();
}

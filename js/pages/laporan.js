// Laporan: omzet, laba kotor, grafik penjualan, metode bayar, kategori, produk terlaris, nilai stok.
import * as store from '../store.js';
import { emptyState, METHOD_LABEL } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, rpShort, startOfDay, endOfDay, addDays, fmtDayMonth, fmtDate } from '../format.js';

const PERIODS = [['today', 'Hari ini'], ['7', '7 hari'], ['30', '30 hari'], ['month', 'Bulan ini'], ['lastmonth', 'Bulan lalu']];

function periodBounds(key) {
  const now = new Date();
  if (key === 'today') return [startOfDay(now), endOfDay(now)];
  if (key === '7') return [startOfDay(addDays(now, -6)), endOfDay(now)];
  if (key === '30') return [startOfDay(addDays(now, -29)), endOfDay(now)];
  if (key === 'month') return [new Date(now.getFullYear(), now.getMonth(), 1), endOfDay(now)];
  const a = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return [a, endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))];
}

function summarize(sales) {
  const ok = sales.filter((s) => s.status !== 'batal');
  let omzet = 0, cost = 0, tax = 0, items = 0, discount = 0;
  for (const s of ok) {
    omzet += s.total; tax += s.tax || 0; discount += s.discount || 0;
    for (const i of s.items) { cost += i.qty * (i.buyPrice || 0); items += i.qty; }
  }
  return { ok, omzet, profit: Math.round(omzet - tax - cost), count: ok.length, avg: ok.length ? Math.round(omzet / ok.length) : 0, items, discount };
}

function delta(cur, prev) {
  if (!prev) return '';
  const d = Math.round(((cur - prev) / prev) * 1000) / 10;
  const up = d >= 0;
  return `<span class="delta ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${num(Math.abs(d))}%</span>`;
}

/** Diagram batang satu seri, dengan tooltip saat disentuh/diarahkan. */
function drawBars(host, data, { valueLabel = 'Penjualan' } = {}) {
  const W = Math.max(280, host.clientWidth || 600);
  const H = 240, padL = 56, padR = 8, padT = 12, padB = 28;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - padL - padR, ih = H - padT - padB;
  const slot = iw / data.length;
  const gap = Math.max(2, slot * 0.28);
  const bw = Math.max(2, slot - gap);
  const y = (v) => padT + ih - (v / top) * ih;
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));
  let grid = '', bars = '', hits = '', labels = '';
  for (let t = 0; t <= top + 1e-9; t += step) {
    grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" class="ch-grid"/><text x="${padL - 8}" y="${y(t) + 4}" class="ch-axis" text-anchor="end">${t ? esc(rpShort(t).replace('Rp ', '')) : '0'}</text>`;
  }
  data.forEach((d, i) => {
    const x = padL + i * slot + gap / 2;
    const h = (d.value / top) * ih;
    if (d.value > 0) {
      const r = Math.min(4, bw / 2, h);
      const yb = padT + ih, yt = yb - h;
      bars += `<path class="ch-bar" data-i="${i}" d="M${x},${yb} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + bw - r} Q${x + bw},${yt} ${x + bw},${yt + r} V${yb} Z"/>`;
    }
    hits += `<rect class="ch-hit" data-i="${i}" x="${padL + i * slot}" y="${padT}" width="${slot}" height="${ih}"/>`;
    if (i % every === 0) labels += `<text x="${x + bw / 2}" y="${H - 8}" class="ch-axis" text-anchor="middle">${esc(d.label)}</text>`;
  });
  host.innerHTML = `<svg class="chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(valueLabel)}">${grid}<line x1="${padL}" x2="${W - padR}" y1="${padT + ih}" y2="${padT + ih}" class="ch-base"/>${bars}${labels}${hits}</svg><div class="ch-tip" hidden></div>`;
  const tip = host.querySelector('.ch-tip');
  const show = (i, evX) => {
    const d = data[i];
    host.querySelectorAll('.ch-bar').forEach((b) => b.classList.toggle('dim', b.dataset.i !== String(i)));
    tip.hidden = false;
    tip.innerHTML = `<strong>${esc(d.title)}</strong><span>${esc(valueLabel)}: <b>${rp(d.value)}</b></span><span>${num(d.count)} transaksi</span>`;
    const x = Math.min(Math.max(evX, 70), W - 70);
    tip.style.left = x + 'px';
  };
  const hide = () => { tip.hidden = true; host.querySelectorAll('.ch-bar').forEach((b) => b.classList.remove('dim')); };
  host.querySelectorAll('.ch-hit').forEach((r) => {
    const i = Number(r.dataset.i);
    const cx = padL + i * slot + slot / 2;
    r.addEventListener('pointerenter', () => show(i, cx));
    r.addEventListener('pointerdown', () => show(i, cx));
  });
  host.querySelector('svg').addEventListener('pointerleave', hide);
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function barList(rows, total) {
  if (!rows.length) return '<p class="muted">Belum ada data.</p>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="hbars">${rows.map((r) => `
    <div class="hbar"><div class="hbar-top"><span>${esc(r.label)}</span><span><b>${rp(r.value)}</b> <span class="muted">${total ? num(Math.round((r.value / total) * 1000) / 10) + '%' : ''}</span></span></div>
    <div class="hbar-track"><div class="hbar-fill" style="width:${(r.value / max) * 100}%"></div></div>
    ${r.sub ? `<span class="muted small">${esc(r.sub)}</span>` : ''}</div>`).join('')}</div>`;
}

export async function render(view) {
  let period = '7';
  let topBy = 'omzet';
  let series = [];
  let ro = null;

  view.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><h1>Laporan</h1><p class="muted" data-range-text></p></div>
    </header>
    <div class="toolbar"><div class="seg seg-auto" data-period>${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}">${l}</button>`).join('')}</div></div>
    <div data-body><span class="spinner"></span></div>
  </div>`;
  const q = (s) => view.querySelector(s);

  async function load() {
    view.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('active', b.dataset.p === period));
    const [a, b] = periodBounds(period);
    const span = b - a;
    const [cur, prev, ledger] = await Promise.all([store.listSales(a, b), store.listSales(new Date(a - span - 1), new Date(a - 1)), store.listLedgerRange(a, b)]);
    const debtIn = ledger.filter((l) => l.type === 'bayar').reduce((s, l) => s - l.amount, 0);
    const debtOut = cur.filter((s) => s.status !== 'batal').reduce((s, x) => s + (x.debt || 0), 0);
    q('[data-range-text]').textContent = period === 'today' ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`;
    const S = summarize(cur), P = summarize(prev);

    // seri grafik: per jam (hari ini) atau per hari
    series = [];
    if (period === 'today') {
      const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), title: `Pukul ${String(h).padStart(2, '0')}.00–${String(h).padStart(2, '0')}.59`, value: 0, count: 0 }));
      for (const s of S.ok) { const h = new Date(s.createdAt).getHours(); hours[h].value += s.total; hours[h].count++; }
      const used = hours.map((h, i) => (h.count ? i : -1)).filter((i) => i >= 0);
      const from = Math.min(6, ...(used.length ? used : [6])), to = Math.max(21, ...(used.length ? used : [21]));
      series = hours.slice(from, to + 1);
    } else {
      const map = new Map();
      for (let d = new Date(a); d <= b; d = addDays(d, 1)) {
        const k = d.toDateString();
        map.set(k, { label: fmtDayMonth(d), title: fmtDate(d), value: 0, count: 0 });
      }
      for (const s of S.ok) { const e = map.get(new Date(s.createdAt).toDateString()); if (e) { e.value += s.total; e.count++; } }
      series = [...map.values()];
    }

    const methods = Object.keys(METHOD_LABEL).map((k) => {
      const list = S.ok.filter((s) => s.method === k);
      return { label: METHOD_LABEL[k], value: list.reduce((x, s) => x + s.total, 0), sub: `${num(list.length)} transaksi` };
    }).filter((r) => r.value > 0).sort((x, y) => y.value - x.value);

    const prodMap = new Map(), catMap = new Map();
    for (const s of S.ok) for (const i of s.items) {
      const e = prodMap.get(i.productId) || { name: i.name, unit: i.unit, qty: 0, omzet: 0, profit: 0 };
      e.qty += i.qty; e.omzet += i.subtotal; e.profit += i.subtotal - i.qty * (i.buyPrice || 0);
      prodMap.set(i.productId, e);
      const cat = i.category || store.getProduct(i.productId)?.category || 'Tanpa kategori';
      catMap.set(cat, (catMap.get(cat) || 0) + i.subtotal);
    }
    const cats = [...catMap].map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value).slice(0, 8);
    const catTotal = [...catMap.values()].reduce((x, y) => x + y, 0);

    let stockModal = 0, stockJual = 0, low = 0;
    for (const p of store.state.products) {
      const st = Math.max(0, Number(p.stock) || 0);
      stockModal += st * (p.buyPrice || 0); stockJual += st * (p.sellPrice || 0);
      if (store.stockStatus(p) !== 'aman') low++;
    }

    const body = q('[data-body]');
    if (!S.count && !store.state.products.length) {
      body.innerHTML = emptyState('chart', 'Belum ada data', 'Laporan akan terisi setelah ada penjualan. Coba isi data contoh di Pengaturan.', `<a class="btn" href="#/pengaturan">${icon('settings')} Pengaturan</a>`);
      return;
    }
    body.innerHTML = `
      <section class="kpis">
        <div class="kpi"><span class="kpi-label">Omzet</span><strong class="kpi-value">${rp(S.omzet)}</strong><span class="kpi-sub">${delta(S.omzet, P.omzet)} vs periode sebelumnya</span></div>
        <div class="kpi"><span class="kpi-label">Laba kotor</span><strong class="kpi-value">${rp(S.profit)}</strong><span class="kpi-sub">${S.omzet ? `margin ${num(Math.round((S.profit / Math.max(1, S.omzet)) * 1000) / 10)}%` : '—'} ${delta(S.profit, P.profit)}</span></div>
        <div class="kpi"><span class="kpi-label">Transaksi</span><strong class="kpi-value">${num(S.count)}</strong><span class="kpi-sub">rata-rata ${rp(S.avg)} ${delta(S.count, P.count)}</span></div>
        <div class="kpi"><span class="kpi-label">Barang terjual</span><strong class="kpi-value">${num(S.items)}</strong><span class="kpi-sub">${S.discount ? `diskon diberikan ${rp(S.discount)}` : 'unit'}</span></div>
      </section>
      <section class="kpis">
        <div class="kpi"><span class="kpi-label">Kasbon baru (periode ini)</span><strong class="kpi-value">${rp(debtOut)}</strong><span class="kpi-sub">penjualan yang belum dibayar</span></div>
        <div class="kpi"><span class="kpi-label">Cicilan kasbon diterima</span><strong class="kpi-value">${rp(debtIn)}</strong><span class="kpi-sub">uang masuk dari pelanggan</span></div>
        <div class="kpi"><span class="kpi-label">Total piutang saat ini</span><strong class="kpi-value">${rp(store.totalReceivable())}</strong><span class="kpi-sub"><a href="#/pelanggan">Lihat pelanggan</a></span></div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('chart')} Penjualan ${period === 'today' ? 'per jam' : 'per hari'}</h2>
        <div class="chart-host" data-chart></div>
        <details class="table-toggle"><summary>Lihat sebagai tabel</summary>
          <div class="table-wrap"><table class="table"><thead><tr><th>${period === 'today' ? 'Jam' : 'Tanggal'}</th><th class="num">Transaksi</th><th class="num">Penjualan</th></tr></thead>
          <tbody>${series.filter((d) => d.count).map((d) => `<tr><td>${esc(d.title)}</td><td class="num">${num(d.count)}</td><td class="num">${rp(d.value)}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Tidak ada penjualan.</td></tr>'}</tbody></table></div>
        </details>
      </section>

      <div class="grid-2">
        <section class="card"><h2 class="card-title">${icon('wallet')} Metode pembayaran</h2>${barList(methods, S.omzet)}</section>
        <section class="card"><h2 class="card-title">${icon('tag')} Penjualan per kategori</h2>${barList(cats, catTotal)}</section>
      </div>

      <section class="card">
        <h2 class="card-title">${icon('sparkle')} Produk terlaris
          <span class="seg seg-auto sm" data-topby><button type="button" data-t="omzet">Omzet</button><button type="button" data-t="qty">Jumlah</button><button type="button" data-t="profit">Laba</button></span>
        </h2>
        <div data-top></div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('box')} Stok saat ini</h2>
        <div class="kpis inner">
          <div class="kpi"><span class="kpi-label">Nilai stok (modal)</span><strong class="kpi-value">${rp(stockModal)}</strong></div>
          <div class="kpi"><span class="kpi-label">Nilai stok (harga jual)</span><strong class="kpi-value">${rp(stockJual)}</strong></div>
          <div class="kpi"><span class="kpi-label">Jumlah produk</span><strong class="kpi-value">${num(store.state.products.length)}</strong></div>
          <div class="kpi"><span class="kpi-label">Menipis / habis</span><strong class="kpi-value ${low ? 'warn-text' : ''}">${num(low)}</strong><span class="kpi-sub"><a href="#/produk">Lihat produk</a></span></div>
        </div>
      </section>`;

    const drawTop = () => {
      const rows = [...prodMap.values()].sort((x, y) => y[topBy] - x[topBy]).slice(0, 10);
      view.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('active', b.dataset.t === topBy));
      q('[data-top]').innerHTML = rows.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th>Barang</th><th class="num">Terjual</th><th class="num">Omzet</th><th class="num">Laba</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(r.name)}</td><td class="num">${num(r.qty)} ${esc(r.unit || '')}</td><td class="num">${rp(r.omzet)}</td><td class="num ${r.profit < 0 ? 'neg' : ''}">${rp(r.profit)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">Belum ada penjualan di periode ini.</p>';
    };
    q('[data-topby]').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { topBy = b.dataset.t; drawTop(); } });
    drawTop();

    const host = q('[data-chart]');
    drawBars(host, series);
    ro?.disconnect();
    let lastW = host.clientWidth;
    ro = new ResizeObserver(() => { if (Math.abs(host.clientWidth - lastW) > 4) { lastW = host.clientWidth; drawBars(host, series); } });
    ro.observe(host);
  }

  q('[data-period]').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { period = b.dataset.p; load(); } });
  const unsub = store.subscribe((w) => { if (w === 'sales' || w === 'all') load(); });
  await load();
  return () => { unsub(); ro?.disconnect(); };
}

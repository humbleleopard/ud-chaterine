// Halaman Pelanggan & Kasbon: daftar pelanggan, sisa utang, jatuh tempo, terima cicilan, pengingat WhatsApp.
import * as store from '../store.js';
import { toast, confirmDialog, emptyState, METHOD_LABEL, isTouch, waNumber } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, rp, fmtDate, fmtDateTime, fromIsoDate, startOfDay } from '../format.js';
import { avatar, debtBadge, openCustomerForm, openDebtPayment, remindDebtWhatsApp, openReceiptDialog } from '../dialogs.js';
import { setSavedCartCustomer } from '../cart.js';

const daysLeft = (iso) => (iso ? Math.round((fromIsoDate(iso) - startOfDay()) / 864e5) : null);

function dueBadge(c) {
  if (!(c.balance > 0) || !c.dueDate) return '';
  const d = daysLeft(c.dueDate);
  if (d < 0) return `<span class="badge bad">${icon('calendar')} Lewat ${-d} hari</span>`;
  if (d <= 7) return `<span class="badge warn">${icon('calendar')} ${d === 0 ? 'Hari ini' : d + ' hari lagi'}</span>`;
  return `<span class="badge">${icon('calendar')} ${fmtDate(c.dueDate)}</span>`;
}

export async function render(view, { params }) {
  if (params[0]) {
    const c = store.getCustomer(params[0]);
    if (!c) {
      view.innerHTML = `<div class="page">${emptyState('alert', 'Pelanggan tidak ditemukan', '', `<a class="btn" href="#/pelanggan">${icon('arrowLeft')} Kembali</a>`)}</div>`;
      return null;
    }
    return renderDetail(view, c.id);
  }
  return renderList(view);
}

function renderList(view) {
  let text = '';
  let filter = 'semua';
  view.innerHTML = `
  <div class="page">
    <header class="page-head">
      <div><h1>Pelanggan & Kasbon</h1><p class="muted" data-summary></p></div>
      <div class="actions"><button type="button" class="btn primary" data-new>${icon('plus')}<span>Pelanggan baru</span></button></div>
    </header>
    <section class="kpis" data-kpis></section>
    <div class="toolbar">
      <div class="scan-input grow">${icon('search')}<input type="search" data-search placeholder="Cari nama, HP, atau desa…" autocomplete="off"></div>
      <div class="seg seg-auto" data-filter></div>
    </div>
    <div class="clist" data-list></div>
  </div>`;
  const q = (s) => view.querySelector(s);

  function draw() {
    const all = store.state.customers;
    const debtors = all.filter((c) => c.balance > 0);
    const overdue = debtors.filter((c) => c.dueDate && daysLeft(c.dueDate) < 0);
    const total = store.totalReceivable();
    q('[data-summary]').textContent = `${num(all.length)} pelanggan · ${num(debtors.length)} masih punya kasbon`;
    q('[data-kpis]').innerHTML = `
      <div class="kpi"><span class="kpi-label">Total piutang (kasbon)</span><strong class="kpi-value">${rp(total)}</strong><span class="kpi-sub">${num(debtors.length)} pelanggan</span></div>
      <div class="kpi"><span class="kpi-label">Lewat jatuh tempo</span><strong class="kpi-value ${overdue.length ? 'neg' : ''}">${rp(overdue.reduce((s, c) => s + c.balance, 0))}</strong><span class="kpi-sub">${num(overdue.length)} pelanggan</span></div>`;
    q('[data-filter]').innerHTML = [['semua', 'Semua', all.length], ['utang', 'Punya kasbon', debtors.length], ['lewat', 'Lewat tempo', overdue.length]]
      .map(([k, l, n]) => `<button type="button" data-f="${k}" class="${filter === k ? 'active' : ''}">${l} <span class="seg-n ${k === 'lewat' && n ? 'bad' : ''}">${n}</span></button>`).join('');
    let list = store.searchCustomers(text, 100000);
    if (filter === 'utang') list = list.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance);
    if (filter === 'lewat') list = list.filter((c) => c.balance > 0 && c.dueDate && daysLeft(c.dueDate) < 0).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const el = q('[data-list]');
    if (!all.length) {
      el.innerHTML = emptyState('users', 'Belum ada pelanggan', 'Simpan pelanggan langganan supaya bisa mencatat kasbon (bayar setelah panen) dan riwayat belanjanya.', `<button type="button" class="btn primary" data-new2>${icon('plus')} Pelanggan baru</button>`);
      el.querySelector('[data-new2]').onclick = addNew;
      return;
    }
    el.innerHTML = list.length ? list.map((c) => `
      <a class="crow" href="#/pelanggan/${c.id}">
        ${avatar(c)}
        <span class="crow-main"><strong>${esc(c.name)}</strong><small>${esc([c.address, c.phone].filter(Boolean).join(' · ') || 'Tanpa kontak')}</small></span>
        <span class="crow-badges">${dueBadge(c)}${debtBadge(c)}</span>
      </a>`).join('') : '<p class="muted center pad">Tidak ada pelanggan yang cocok.</p>';
  }

  async function addNew() {
    const c = await openCustomerForm();
    if (c) location.hash = '#/pelanggan/' + c.id;
  }

  q('[data-search]').addEventListener('input', (e) => { text = e.target.value; draw(); });
  q('[data-filter]').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { filter = b.dataset.f; draw(); } });
  q('[data-new]').onclick = addNew;
  const unsub = store.subscribe((w) => { if (w === 'customers' || w === 'all') draw(); });
  draw();
  if (!isTouch()) q('[data-search]').focus();
  return () => unsub();
}

function renderDetail(view, id) {
  const draw = async () => {
    const c = store.getCustomer(id);
    if (!c) { location.hash = '#/pelanggan'; return; }
    const [sales, ledger] = await Promise.all([store.listCustomerSales(id), store.listLedger(id)]);
    const ok = sales.filter((s) => s.status !== 'batal');
    const spent = ok.reduce((s, x) => s + x.total, 0);
    const paidDebt = ledger.filter((l) => l.type === 'bayar').reduce((s, l) => s - l.amount, 0);
    const timeline = [
      ...sales.map((s) => ({ at: s.createdAt, kind: 'sale', s })),
      ...ledger.filter((l) => l.type === 'bayar').map((l) => ({ at: l.createdAt, kind: 'pay', l })),
    ].sort((a, b) => b.at.localeCompare(a.at));

    view.innerHTML = `
    <div class="page narrow">
      <header class="page-head">
        <div><a class="back" href="#/pelanggan">${icon('arrowLeft')} Pelanggan</a>
          <div class="cust-head">${avatar(c, 'lg')}<div><h1>${esc(c.name)}</h1><p class="muted">${esc([c.address, c.phone].filter(Boolean).join(' · ') || 'Tanpa kontak')}</p>${c.note ? `<p class="small">${esc(c.note)}</p>` : ''}</div></div>
        </div>
        <div class="actions"><button type="button" class="btn" data-edit>${icon('edit')}<span>Ubah</span></button></div>
      </header>

      <section class="debt-card ${c.balance > 0 ? 'has' : ''}">
        <div><span>Sisa kasbon</span><strong>${rp(Math.max(0, c.balance))}</strong>${c.balance < 0 ? `<small>Kelebihan bayar ${rp(-c.balance)}</small>` : ''}${c.balance > 0 && c.dueDate ? `<small>Jatuh tempo ${fmtDate(c.dueDate)} ${daysLeft(c.dueDate) <= 7 ? dueBadge(c) : ''}</small>` : ''}</div>
        <div class="debt-actions">
          ${c.balance > 0 ? `<button type="button" class="btn primary lg" data-pay>${icon('coins')} Terima pembayaran</button>` : ''}
          ${c.balance > 0 && waNumber(c.phone) ? `<button type="button" class="btn" data-remind>${icon('message')} Ingatkan via WA</button>` : ''}
          <button type="button" class="btn" data-shop>${icon('cart')} Belanja di kasir</button>
        </div>
      </section>

      <section class="kpis">
        <div class="kpi"><span class="kpi-label">Total belanja</span><strong class="kpi-value">${rp(spent)}</strong><span class="kpi-sub">${num(ok.length)} transaksi</span></div>
        <div class="kpi"><span class="kpi-label">Cicilan diterima</span><strong class="kpi-value">${rp(paidDebt)}</strong><span class="kpi-sub">sepanjang waktu</span></div>
      </section>

      <section class="card">
        <h2 class="card-title">${icon('clock')} Riwayat</h2>
        ${timeline.length ? `<div class="timeline">${timeline.map((t) => t.kind === 'sale' ? `
          <button type="button" class="tl-row ${t.s.status === 'batal' ? 'void' : ''}" data-sale="${t.s.id}">
            <span class="tl-ic">${icon(t.s.method === 'utang' ? 'book' : 'cart')}</span>
            <span class="tl-main"><strong>${t.s.method === 'utang' ? 'Kasbon' : 'Belanja'} · ${esc(t.s.no)}</strong><small>${fmtDateTime(t.at)} · ${esc(t.s.items.map((i) => i.name).slice(0, 2).join(', '))}${t.s.items.length > 2 ? ` +${t.s.items.length - 2}` : ''}</small></span>
            <span class="tl-amt">${rp(t.s.total)}${t.s.debt ? `<small class="neg">+${rp(t.s.debt)} utang</small>` : `<small>${esc(METHOD_LABEL[t.s.method] || '')}</small>`}${t.s.status === 'batal' ? '<small class="badge bad">Batal</small>' : ''}</span>
          </button>` : `
          <div class="tl-row pay">
            <span class="tl-ic">${icon('coins')}</span>
            <span class="tl-main"><strong>Bayar kasbon</strong><small>${fmtDateTime(t.at)} · ${esc(METHOD_LABEL[t.l.method] || t.l.method)}${t.l.note ? ' · ' + esc(t.l.note) : ''}</small></span>
            <span class="tl-amt up">−${rp(-t.l.amount)}<small>sisa ${rp(t.l.balanceAfter)}</small></span>
          </div>`).join('')}</div>` : '<p class="muted">Belum ada transaksi.</p>'}
      </section>
      <p class="center"><button type="button" class="btn ghost danger-text" data-delete>${icon('trash')} Hapus pelanggan</button></p>
    </div>`;

    const q = (s) => view.querySelector(s);
    q('[data-edit]').onclick = () => openCustomerForm(c);
    q('[data-pay]')?.addEventListener('click', () => openDebtPayment(c));
    q('[data-remind]')?.addEventListener('click', () => remindDebtWhatsApp(c));
    q('[data-shop]').onclick = () => { setSavedCartCustomer(c.id); location.hash = '#/kasir'; };
    q('[data-delete]').onclick = async () => {
      if (!(await confirmDialog(`Hapus pelanggan ${c.name}? Riwayat transaksinya tetap tersimpan.`, { ok: 'Hapus', danger: true }))) return;
      try { await store.deleteCustomer(c.id); toast('Pelanggan dihapus', { type: 'ok' }); location.hash = '#/pelanggan'; }
      catch (err) { toast(err.message, { type: 'bad', duration: 4500 }); }
    };
    view.querySelectorAll('[data-sale]').forEach((b) => b.addEventListener('click', () => {
      const s = sales.find((x) => x.id === b.dataset.sale);
      if (s) openReceiptDialog(s, { allowVoid: true });
    }));
  };
  draw();
  const unsub = store.subscribe((w) => { if (['customers', 'sales', 'all'].includes(w)) draw(); });
  return () => unsub();
}

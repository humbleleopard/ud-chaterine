// Struk belanja: tampilan HTML untuk dicetak (printer thermal 58/80 mm) dan teks untuk WhatsApp.
import { esc, num, rp, fmtDateTime, fmtDate } from './format.js';
import { METHOD_LABEL, $, waNumber } from './ui.js';

export function receiptHTML(sale, st) {
  const row = (a, b, cls = '') => `<div class="r-row ${cls}"><span>${a}</span><span>${b}</span></div>`;
  return `<div class="receipt w${st.paper === '80' ? '80' : '58'}">
    <div class="r-center r-store">${esc(st.storeName)}</div>
    ${st.tagline ? `<div class="r-center r-small">${esc(st.tagline)}</div>` : ''}
    ${st.address ? `<div class="r-center r-small">${esc(st.address)}</div>` : ''}
    ${st.phone ? `<div class="r-center r-small">Telp/WA ${esc(st.phone)}</div>` : ''}
    <div class="r-sep"></div>
    ${row(esc(sale.no), '')}
    ${row(fmtDateTime(sale.createdAt), 'Kasir: ' + esc(sale.cashier || '-'))}
    ${sale.customerName ? row('Pelanggan', esc(sale.customerName)) : ''}
    <div class="r-sep"></div>
    ${sale.items.map((it) => `<div class="r-item">${esc(it.name)}</div>${row(`${num(it.qty)} ${esc(it.unit || '')} × ${num(it.price)}${it.normalPrice && it.price < it.normalPrice ? ' *' : ''}`, num(it.subtotal))}`).join('')}
    <div class="r-sep"></div>
    ${row('Subtotal', num(sale.subtotal))}
    ${sale.discount ? row('Diskon', '-' + num(sale.discount)) : ''}
    ${sale.tax ? row('Pajak', num(sale.tax)) : ''}
    ${row('TOTAL', rp(sale.total), 'r-total')}
    ${sale.method === 'utang'
      ? `${row('Uang muka', num(sale.paid))}${row('KASBON', rp(sale.debt), 'r-total')}${sale.dueDate ? row('Jatuh tempo', fmtDate(sale.dueDate)) : ''}${sale.customerBalance !== undefined ? row('Total utang', rp(sale.customerBalance)) : ''}`
      : row(METHOD_LABEL[sale.method] || sale.method, num(sale.paid))}
    ${sale.method === 'tunai' ? row('Kembali', num(sale.change)) : ''}
    ${sale.ref ? row('Ref', esc(sale.ref)) : ''}
    ${sale.items.some((it) => it.normalPrice && it.price < it.normalPrice) ? '<div class="r-small">* harga grosir</div>' : ''}
    ${sale.status === 'batal' ? `<div class="r-sep"></div><div class="r-center r-void">*** TRANSAKSI DIBATALKAN ***</div>` : ''}
    <div class="r-sep"></div>
    <div class="r-center r-small">${esc(st.footer || '')}</div>
  </div>`;
}

export function receiptText(sale, st) {
  const W = 32;
  const line = (a, b = '') => {
    a = String(a); b = String(b);
    const space = W - a.length - b.length;
    return space >= 1 ? a + ' '.repeat(space) + b : a + '\n' + ' '.repeat(Math.max(0, W - b.length)) + b;
  };
  const sep = '-'.repeat(W);
  const out = [`*${st.storeName}*`];
  if (st.address) out.push(st.address);
  out.push('```', sep, sale.no, fmtDateTime(sale.createdAt));
  if (sale.customerName) out.push('Pelanggan: ' + sale.customerName);
  out.push(sep);
  for (const it of sale.items) {
    out.push(it.name);
    out.push(line(`  ${num(it.qty)} x ${num(it.price)}`, num(it.subtotal)));
  }
  out.push(sep, line('Subtotal', num(sale.subtotal)));
  if (sale.discount) out.push(line('Diskon', '-' + num(sale.discount)));
  if (sale.tax) out.push(line('Pajak', num(sale.tax)));
  out.push(line('TOTAL', rp(sale.total)));
  if (sale.method === 'utang') {
    out.push(line('Uang muka', num(sale.paid)), line('KASBON', rp(sale.debt)));
    if (sale.dueDate) out.push(line('Jatuh tempo', fmtDate(sale.dueDate)));
  } else {
    out.push(line(METHOD_LABEL[sale.method] || sale.method, num(sale.paid)));
    if (sale.method === 'tunai') out.push(line('Kembali', num(sale.change)));
  }
  if (sale.status === 'batal') out.push('*** DIBATALKAN ***');
  out.push(sep, '```');
  if (st.footer) out.push(st.footer);
  return out.join('\n');
}

/** Cetak potongan HTML saja (struk atau label), lalu bersihkan. */
export function printHTML(html, kind = 'receipt') {
  const area = $('#print-area');
  let style = document.getElementById('print-page-style');
  if (!style) { style = document.createElement('style'); style.id = 'print-page-style'; document.head.append(style); }
  style.textContent = kind === 'labels' ? '@page { size: A4; margin: 8mm; }' : '@page { margin: 0; }';
  area.className = 'print-area ' + kind;
  area.innerHTML = html;
  const cleanup = () => { area.innerHTML = ''; window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 80);
}

export function shareWhatsApp(sale, st, phone = '') {
  const n = waNumber(phone);
  const url = `https://wa.me/${n}?text=` + encodeURIComponent(receiptText(sale, st));
  window.open(url, '_blank', 'noopener');
}

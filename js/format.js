// Format angka, uang, tanggal, dan escape HTML
const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const qf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 });

export const rp = (n) => 'Rp ' + nf.format(Math.round(Number(n) || 0));
export const rpShort = (n) => {
  const v = Math.round(Number(n) || 0), a = Math.abs(v);
  if (a >= 1e9) return 'Rp ' + qf.format(Math.round(v / 1e7) / 100) + ' M';
  if (a >= 1e6) return 'Rp ' + qf.format(Math.round(v / 1e4) / 100) + ' jt';
  if (a >= 1e4) return 'Rp ' + qf.format(Math.round(v / 100) / 10) + ' rb';
  return rp(v);
};
export const num = (n) => qf.format(Number(n) || 0);
export const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

export function parseMoney(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  return d ? Math.min(parseInt(d, 10), 999999999999) : 0;
}

export function parseQty(v) {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.000 = seribu
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? round3(n) : 0;
}

const dF = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
const dLongF = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const tF = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const dtF = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dmF = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' });

export const fmtDate = (d) => dF.format(new Date(d));
export const fmtDateLong = (d) => dLongF.format(new Date(d));
export const fmtTime = (d) => tF.format(new Date(d));
export const fmtDateTime = (d) => dtF.format(new Date(d));
export const fmtDayMonth = (d) => dmF.format(new Date(d));

export function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
export function endOfDay(d = new Date()) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const pad = (n) => String(n).padStart(2, '0');
export function dayKey(d = new Date()) { const x = new Date(d); return `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}`; }
export function isoDate(d = new Date()) { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; }
export function fromIsoDate(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }

export function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
  if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
  return Math.floor(s / 86400) + ' hari lalu';
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

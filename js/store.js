// Lapisan data: produk & pelanggan (di-cache di memori), penjualan, mutasi stok, buku utang, pengaturan.
import { tx, wrap, openDB, STORES } from './db.js';
import { dayKey, round3, num, rp, addDays, isoDate, fromIsoDate, startOfDay } from './format.js';

export const DEFAULT_SETTINGS = {
  storeName: 'UD CHATERINE',
  tagline: 'Toko Pertanian',
  address: '',
  phone: '',
  cashierName: 'Kasir',
  footer: 'Terima kasih. Semoga panen melimpah!',
  paper: '58',
  autoPrint: false,
  qris: '',
  taxPercent: 0,
  allowNegativeStock: false,
  beep: true,
  pinHash: '',
  lastBackupAt: '',
  expiryWarnDays: 60,
  defaultDueDays: 30,
};

export const state = { products: [], customers: [], settings: { ...DEFAULT_SETTINGS } };

let codeMap = new Map();
const listeners = new Set();
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const nowIso = () => new Date().toISOString();
const collator = new Intl.Collator('id', { sensitivity: 'base', numeric: true });

function reindex() {
  state.products.sort((a, b) => collator.compare(a.name, b.name));
  codeMap = new Map(state.products.map((p) => [p.code, p]));
}
function upsertCache(list, item) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
}
const sortCustomers = () => state.customers.sort((a, b) => collator.compare(a.name, b.name));

export async function init() {
  await openDB();
  const [products, customers, rows] = await tx(['products', 'customers', 'settings'], 'readonly', (s) =>
    Promise.all([wrap(s.products.getAll()), wrap(s.customers.getAll()), wrap(s.settings.getAll())]));
  state.products = products;
  state.customers = customers;
  reindex(); sortCustomers();
  state.settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (!r.key.startsWith('seq-')) state.settings[r.key] = r.value;
}

/* ================= Produk ================= */

export const normalizeCode = (raw) => String(raw ?? '').trim().replace(/\s+/g, '');

export function findByCode(raw) {
  const c = normalizeCode(raw);
  if (!c) return null;
  let p = codeMap.get(c);
  if (p) return p;
  const up = c.toUpperCase();
  p = state.products.find((x) => x.code.toUpperCase() === up);
  if (p) return p;
  if (/^\d+$/.test(c)) {
    // UPC-A (12 digit) kadang terbaca sebagai EAN-13 berawalan 0, dan sebaliknya
    if (c.length === 13 && c[0] === '0') return codeMap.get(c.slice(1)) || null;
    if (c.length === 12) return codeMap.get('0' + c) || null;
  }
  const m = c.match(/[?&#/](?:kode|code|p)=([^&#]+)/i);
  if (m) return findByCode(decodeURIComponent(m[1]));
  return null;
}

export const getProduct = (id) => state.products.find((p) => p.id === id) || null;

export function searchProducts(q, { limit = 60, category = '' } = {}) {
  const s = String(q || '').trim().toLowerCase();
  const list = category ? state.products.filter((p) => (p.category || '') === category) : state.products;
  if (!s) return list.slice(0, limit);
  const words = s.split(/\s+/);
  const starts = [], rest = [];
  for (const p of list) {
    const name = p.name.toLowerCase();
    const hay = [name, p.code, p.category, p.brand, p.ingredient].filter(Boolean).join(' ').toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    if (p.code.toLowerCase() === s || name.startsWith(s)) starts.push(p); else rest.push(p);
  }
  return starts.concat(rest).slice(0, limit);
}

export function categories() {
  return [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort(collator.compare);
}
export function brands() {
  return [...new Set(state.products.map((p) => p.brand).filter(Boolean))].sort(collator.compare);
}

export const stockStatus = (p) => {
  const st = Number(p.stock) || 0;
  if (st <= 0) return 'habis';
  if (st <= (Number(p.minStock) || 0)) return 'menipis';
  return 'aman';
};

/** Sisa hari sebelum kedaluwarsa (negatif = sudah lewat), atau null bila tidak diisi. */
export function daysToExpiry(p) {
  if (!p.expiry) return null;
  return Math.round((fromIsoDate(p.expiry) - startOfDay()) / 864e5);
}
export function expiryStatus(p) {
  const d = daysToExpiry(p);
  if (d === null) return '';
  if (d < 0) return 'lewat';
  if (d <= (Number(state.settings.expiryWarnDays) || 60)) return 'segera';
  return 'aman';
}

/** Harga sesuai jumlah beli (harga grosir bertingkat). */
export function tierPrice(p, qty) {
  const tiers = (p.tiers || []).filter((t) => t.min > 0 && t.price > 0).sort((a, b) => b.min - a.min);
  for (const t of tiers) if (qty >= t.min) return t.price;
  return p.sellPrice;
}

export function ean13Check(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10;
}

/** Kode internal toko berformat EAN-13 dengan awalan 20 (khusus pemakaian di dalam toko). */
export function generateCode() {
  for (;;) {
    let d = '20';
    for (let i = 0; i < 10; i++) d += Math.floor(Math.random() * 10);
    d += ean13Check(d);
    if (!codeMap.has(d)) return d;
  }
}

function cleanTiers(tiers, sellPrice) {
  const seen = new Set();
  return (Array.isArray(tiers) ? tiers : [])
    .map((t) => ({ min: round3(t.min), price: Math.max(0, Math.round(Number(t.price) || 0)) }))
    .filter((t) => t.min > 1 && t.price > 0 && t.price < sellPrice && !seen.has(t.min) && seen.add(t.min))
    .sort((a, b) => a.min - b.min);
}

function cleanProduct(input, prev) {
  const pick = (k, d = '') => (input[k] !== undefined ? input[k] : prev?.[k] ?? d);
  const name = String(pick('name')).trim();
  if (!name) throw new Error('Nama produk wajib diisi.');
  const code = normalizeCode(pick('code')) || generateCode();
  const other = codeMap.get(code);
  if (other && other.id !== (prev?.id || input.id)) throw new Error(`Kode ${code} sudah dipakai oleh "${other.name}".`);
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const sellPrice = Math.max(0, Math.round(n(pick('sellPrice', 0))));
  const expiry = String(pick('expiry')).trim();
  return {
    id: prev?.id || input.id || uid(),
    code,
    name,
    category: String(pick('category')).trim(),
    brand: String(pick('brand')).trim(),
    ingredient: String(pick('ingredient')).trim(),
    usage: String(pick('usage')).trim(),
    unit: String(pick('unit', 'pcs')).trim() || 'pcs',
    buyPrice: Math.max(0, Math.round(n(pick('buyPrice', 0)))),
    sellPrice,
    tiers: cleanTiers(pick('tiers', []), sellPrice),
    minStock: Math.max(0, round3(n(pick('minStock', 0)))),
    expiry: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : '',
    stock: prev ? prev.stock : round3(n(input.stock)),
    image: 'image' in input ? input.image : (prev?.image ?? null),
    createdAt: prev?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

export async function saveProduct(input) {
  const prev = input.id ? getProduct(input.id) : null;
  const p = cleanProduct(input, prev);
  await tx(['products', 'moves'], 'readwrite', async (s) => {
    await wrap(s.products.put(p));
    if (!prev && p.stock) {
      await wrap(s.moves.put({ id: uid(), productId: p.id, productName: p.name, type: 'awal', qty: p.stock, before: 0, after: p.stock, note: 'Stok awal', createdAt: p.createdAt }));
    }
  });
  upsertCache(state.products, p); reindex(); emit('products');
  return p;
}

export async function deleteProduct(id) {
  await tx('products', 'readwrite', (s) => wrap(s.products.delete(id)));
  state.products = state.products.filter((p) => p.id !== id);
  reindex(); emit('products');
}

/** mode: 'masuk' (tambah), 'keluar' (kurangi), 'set' (koreksi ke jumlah pasti). buyPrice opsional saat barang masuk. */
export async function adjustStock(id, { mode, qty, note = '', buyPrice, expiry }) {
  qty = round3(qty);
  if (!Number.isFinite(qty) || qty < 0 || (mode !== 'set' && qty === 0)) throw new Error('Jumlah tidak valid.');
  let updated;
  await tx(['products', 'moves'], 'readwrite', async (s) => {
    const p = await wrap(s.products.get(id));
    if (!p) throw new Error('Produk tidak ditemukan.');
    const before = Number(p.stock) || 0;
    const after = round3(mode === 'masuk' ? before + qty : mode === 'keluar' ? before - qty : qty);
    if (after < 0 && !state.settings.allowNegativeStock) throw new Error(`Stok tidak cukup. Sisa ${num(before)} ${p.unit}.`);
    p.stock = after; p.updatedAt = nowIso();
    if (mode === 'masuk' && buyPrice > 0) p.buyPrice = Math.round(buyPrice);
    if (mode === 'masuk' && /^\d{4}-\d{2}-\d{2}$/.test(expiry || '')) p.expiry = expiry;
    await wrap(s.products.put(p));
    await wrap(s.moves.put({ id: uid(), productId: id, productName: p.name, type: mode === 'set' ? 'koreksi' : mode, qty: round3(after - before), before, after, note: String(note || '').trim(), createdAt: nowIso() }));
    updated = p;
  });
  upsertCache(state.products, updated); reindex(); emit('products');
  return updated;
}

export async function listMoves(productId, limit = 100) {
  const rows = await tx('moves', 'readonly', (s) => wrap(s.moves.index('productId').getAll(productId)));
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

/* ================= Pelanggan & utang ================= */

export const getCustomer = (id) => state.customers.find((c) => c.id === id) || null;

export function searchCustomers(q, limit = 100) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return state.customers.slice(0, limit);
  return state.customers.filter((c) => [c.name, c.phone, c.address].filter(Boolean).join(' ').toLowerCase().includes(s)).slice(0, limit);
}

export const totalReceivable = () => state.customers.reduce((s, c) => s + Math.max(0, c.balance || 0), 0);

export async function saveCustomer(input) {
  const prev = input.id ? getCustomer(input.id) : null;
  const name = String(input.name ?? prev?.name ?? '').trim();
  if (!name) throw new Error('Nama pelanggan wajib diisi.');
  const c = {
    id: prev?.id || uid(),
    name,
    phone: String(input.phone ?? prev?.phone ?? '').trim(),
    address: String(input.address ?? prev?.address ?? '').trim(),
    note: String(input.note ?? prev?.note ?? '').trim(),
    balance: prev?.balance || 0,
    dueDate: prev?.dueDate || '',
    createdAt: prev?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  await tx('customers', 'readwrite', (s) => wrap(s.customers.put(c)));
  upsertCache(state.customers, c); sortCustomers(); emit('customers');
  return c;
}

export async function deleteCustomer(id) {
  const c = getCustomer(id);
  if (c && Math.round(c.balance || 0) !== 0) throw new Error('Pelanggan masih punya utang/kelebihan bayar. Lunasi dulu sebelum dihapus.');
  await tx('customers', 'readwrite', (s) => wrap(s.customers.delete(id)));
  state.customers = state.customers.filter((x) => x.id !== id);
  emit('customers');
}

/** Terima cicilan / pelunasan utang pelanggan. */
export async function receivePayment(customerId, { amount, method = 'tunai', note = '' }) {
  amount = Math.round(Number(amount) || 0);
  if (!(amount > 0)) throw new Error('Jumlah pembayaran tidak valid.');
  let updated, entry;
  await tx(['customers', 'ledger'], 'readwrite', async (s) => {
    const c = await wrap(s.customers.get(customerId));
    if (!c) throw new Error('Pelanggan tidak ditemukan.');
    if (amount > (c.balance || 0)) throw new Error(`Pembayaran melebihi sisa utang (${rp(c.balance || 0)}).`);
    c.balance = (c.balance || 0) - amount;
    if (c.balance <= 0) c.dueDate = '';
    c.updatedAt = nowIso();
    await wrap(s.customers.put(c));
    entry = { id: uid(), customerId, type: 'bayar', amount: -amount, balanceAfter: c.balance, method, note: String(note || '').trim(), createdAt: nowIso(), cashier: state.settings.cashierName || 'Kasir' };
    await wrap(s.ledger.put(entry));
    updated = c;
  });
  upsertCache(state.customers, updated); sortCustomers(); emit('customers');
  return entry;
}

export async function listLedger(customerId) {
  const rows = await tx('ledger', 'readonly', (s) => wrap(s.ledger.index('customerId').getAll(customerId)));
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function listLedgerRange(from, to) {
  const range = IDBKeyRange.bound(new Date(from).toISOString(), new Date(to).toISOString());
  return tx('ledger', 'readonly', (s) => wrap(s.ledger.index('createdAt').getAll(range)));
}
export async function listCustomerSales(customerId) {
  const rows = await tx('sales', 'readonly', (s) => wrap(s.sales.index('customerId').getAll(customerId)));
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ================= Penjualan ================= */

export function computeTotals(lines, discountAmount = 0, taxPercent = 0) {
  const subtotal = lines.reduce((s, i) => s + Math.round(i.qty * i.price), 0);
  const discount = Math.max(0, Math.min(subtotal, Math.round(discountAmount || 0)));
  const tax = Math.round((subtotal - discount) * (Number(taxPercent) || 0) / 100);
  return { subtotal, discount, tax, total: subtotal - discount + tax };
}

/**
 * method: 'tunai' | 'qris' | 'transfer' | 'utang'
 * Untuk 'utang' (kasbon): paid = uang muka (boleh 0), sisanya dicatat sebagai utang pelanggan.
 */
export async function checkout({ items, discount = 0, method = 'tunai', paid = 0, ref = '', customerId = '', dueDate = '' }) {
  if (!items?.length) throw new Error('Keranjang masih kosong.');
  if (method === 'utang' && !customerId) throw new Error('Pilih pelanggan untuk transaksi kasbon.');
  const createdAt = nowIso();
  const seqKey = 'seq-' + dayKey();
  const saleId = uid();
  const changed = [];
  let sale, customer = null;
  await tx(['products', 'sales', 'moves', 'settings', 'customers', 'ledger'], 'readwrite', async (s) => {
    if (customerId) {
      customer = await wrap(s.customers.get(customerId));
      if (!customer) throw new Error('Pelanggan tidak ditemukan.');
    }
    const lines = [];
    for (const it of items) {
      const qty = round3(it.qty);
      if (!(qty > 0)) continue;
      const p = await wrap(s.products.get(it.productId));
      if (!p) throw new Error(`Produk "${it.name}" sudah dihapus dari daftar.`);
      const before = Number(p.stock) || 0;
      const after = round3(before - qty);
      if (after < 0 && !state.settings.allowNegativeStock) {
        throw new Error(`Stok "${p.name}" tidak cukup (sisa ${num(before)} ${p.unit}).`);
      }
      p.stock = after; p.updatedAt = createdAt;
      await wrap(s.products.put(p));
      changed.push(p);
      const price = Math.max(0, Math.round(it.price));
      lines.push({ productId: p.id, code: p.code, name: p.name, unit: p.unit, category: p.category || '', qty, price, normalPrice: p.sellPrice, buyPrice: p.buyPrice || 0, subtotal: Math.round(qty * price) });
      await wrap(s.moves.put({ id: uid(), productId: p.id, productName: p.name, type: 'jual', qty: -qty, before, after, note: '', ref: saleId, createdAt }));
    }
    if (!lines.length) throw new Error('Keranjang masih kosong.');
    const t = computeTotals(lines, discount, state.settings.taxPercent);
    paid = Math.max(0, Math.round(paid || 0));
    if (method === 'tunai' && paid < t.total) throw new Error('Uang yang diterima kurang dari total.');
    if (method === 'utang' && paid >= t.total) throw new Error('Uang muka sudah menutup total. Pilih metode Tunai.');
    const seqRow = await wrap(s.settings.get(seqKey));
    const seq = (seqRow?.value || 0) + 1;
    await wrap(s.settings.put({ key: seqKey, value: seq }));
    const debt = method === 'utang' ? t.total - paid : 0;
    sale = {
      id: saleId,
      no: `INV-${dayKey()}-${String(seq).padStart(4, '0')}`,
      createdAt,
      items: lines,
      ...t,
      method,
      paid: method === 'tunai' || method === 'utang' ? paid : t.total,
      change: method === 'tunai' ? paid - t.total : 0,
      debt,
      dueDate: debt ? (/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : '') : '',
      ref: String(ref || '').trim(),
      cashier: state.settings.cashierName || 'Kasir',
      status: 'selesai',
      ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
    };
    if (customer && debt) {
      customer.balance = (customer.balance || 0) + debt;
      if (sale.dueDate && (!customer.dueDate || sale.dueDate < customer.dueDate)) customer.dueDate = sale.dueDate;
      customer.updatedAt = createdAt;
      await wrap(s.customers.put(customer));
      await wrap(s.ledger.put({ id: uid(), customerId: customer.id, type: 'utang', amount: debt, balanceAfter: customer.balance, saleId, saleNo: sale.no, note: sale.dueDate ? `Jatuh tempo ${sale.dueDate}` : '', createdAt, cashier: sale.cashier }));
      sale.customerBalance = customer.balance;
    }
    await wrap(s.sales.put(sale));
  });
  changed.forEach((p) => upsertCache(state.products, p)); reindex();
  if (customer) { upsertCache(state.customers, customer); sortCustomers(); emit('customers'); }
  emit('products'); emit('sales');
  return sale;
}

export async function voidSale(id, reason = '') {
  const changed = [];
  let sale, customer = null;
  await tx(['products', 'sales', 'moves', 'customers', 'ledger'], 'readwrite', async (s) => {
    sale = await wrap(s.sales.get(id));
    if (!sale) throw new Error('Transaksi tidak ditemukan.');
    if (sale.status === 'batal') throw new Error('Transaksi ini sudah dibatalkan.');
    const at = nowIso();
    for (const it of sale.items) {
      const p = await wrap(s.products.get(it.productId));
      if (!p) continue;
      const before = Number(p.stock) || 0;
      p.stock = round3(before + it.qty); p.updatedAt = at;
      await wrap(s.products.put(p));
      changed.push(p);
      await wrap(s.moves.put({ id: uid(), productId: p.id, productName: p.name, type: 'batal', qty: it.qty, before, after: p.stock, note: `Pembatalan ${sale.no}`, ref: sale.id, createdAt: at }));
    }
    if (sale.debt && sale.customerId) {
      customer = await wrap(s.customers.get(sale.customerId));
      if (customer) {
        customer.balance = (customer.balance || 0) - sale.debt;
        if (customer.balance <= 0) customer.dueDate = '';
        customer.updatedAt = at;
        await wrap(s.customers.put(customer));
        await wrap(s.ledger.put({ id: uid(), customerId: customer.id, type: 'batal', amount: -sale.debt, balanceAfter: customer.balance, saleId: sale.id, saleNo: sale.no, note: 'Transaksi kasbon dibatalkan', createdAt: at, cashier: state.settings.cashierName || 'Kasir' }));
      }
    }
    sale.status = 'batal'; sale.voidedAt = at; sale.voidReason = String(reason || '').trim();
    await wrap(s.sales.put(sale));
  });
  changed.forEach((p) => upsertCache(state.products, p)); reindex();
  if (customer) { upsertCache(state.customers, customer); sortCustomers(); emit('customers'); }
  emit('products'); emit('sales');
  return sale;
}

export async function listSales(from, to) {
  const range = IDBKeyRange.bound(new Date(from).toISOString(), new Date(to).toISOString());
  const rows = await tx('sales', 'readonly', (s) => wrap(s.sales.index('createdAt').getAll(range)));
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const getSale = (id) => tx('sales', 'readonly', (s) => wrap(s.sales.get(id)));

/* ================= Pengaturan ================= */

export async function saveSettings(patch) {
  await tx('settings', 'readwrite', async (s) => {
    for (const [key, value] of Object.entries(patch)) await wrap(s.settings.put({ key, value }));
  });
  Object.assign(state.settings, patch);
  emit('settings');
}

export async function hashPin(pin) {
  const data = new TextEncoder().encode('kasirqr:' + pin);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ================= Impor / ekspor ================= */

export async function exportData() {
  const all = await tx(STORES, 'readonly', (s) => Promise.all(STORES.map((n) => wrap(s[n].getAll()))));
  const out = { app: 'KasirQR', version: 2, exportedAt: nowIso() };
  STORES.forEach((n, i) => { out[n] = all[i]; });
  return out;
}

export async function importData(data) {
  if (!data || data.app !== 'KasirQR' || !Array.isArray(data.products)) {
    throw new Error('Berkas ini bukan cadangan aplikasi kasir ini.');
  }
  await tx(STORES, 'readwrite', async (s) => {
    for (const n of STORES) {
      await wrap(s[n].clear());
      for (const row of data[n] || []) await wrap(s[n].put(row));
    }
  });
  await init();
  emit('all');
}

export async function resetData() {
  await tx(STORES, 'readwrite', async (s) => { for (const n of STORES) await wrap(s[n].clear()); });
  await init();
  emit('all');
}

/** Upsert produk dari baris CSV (sudah dipetakan ke field). */
export async function importProducts(rows) {
  let added = 0, updated = 0, skipped = 0;
  const at = nowIso();
  const touched = [];
  const seen = new Set();
  await tx(['products', 'moves'], 'readwrite', async (s) => {
    for (const r of rows) {
      const name = String(r.name || '').trim();
      const code = normalizeCode(r.code);
      if (!name && !code) { skipped++; continue; }
      if (code && seen.has(code)) { skipped++; continue; }
      const prev = code ? codeMap.get(code) : null;
      if (!prev && !name) { skipped++; continue; }
      const input = { ...r };
      Object.keys(input).forEach((k) => input[k] === undefined && delete input[k]);
      const p = cleanProduct({ ...input, code: code || generateCode() }, prev ? { ...prev } : null);
      seen.add(p.code);
      const before = prev ? Number(prev.stock) || 0 : 0;
      const target = r.stock !== undefined ? round3(r.stock) : before;
      p.stock = target;
      await wrap(s.products.put(p));
      if (target !== before) {
        await wrap(s.moves.put({ id: uid(), productId: p.id, productName: p.name, type: prev ? 'koreksi' : 'awal', qty: round3(target - before), before, after: target, note: 'Impor CSV', createdAt: at }));
      }
      touched.push(p);
      if (prev) updated++; else added++;
    }
  });
  touched.forEach((p) => upsertCache(state.products, p)); reindex(); emit('products');
  return { added, updated, skipped };
}

/* ================= Data contoh (toko pertanian) ================= */

// [nama, kategori, satuan, beli, jual, stok, stokMin, bahan aktif, kegunaan, kedaluwarsa (hari dari sekarang), harga grosir]
const SAMPLE = [
  ['Insektisida Abamektin 18 EC 100 ml', 'Insektisida', 'botol', 28000, 35000, 24, 6, 'Abamektin 18 g/L', 'Thrips, tungau, dan ulat daun pada cabai & bawang. Dosis 0,5–1 ml per liter air.', 420, [{ min: 12, price: 33000 }]],
  ['Insektisida Imidakloprid 200 SL 100 ml', 'Insektisida', 'botol', 22000, 28000, 18, 5, 'Imidakloprid 200 g/L', 'Wereng dan kutu daun pada padi & sayuran. Dosis 0,5 ml per liter air.', 40],
  ['Insektisida Klorpirifos 200 EC 500 ml', 'Insektisida', 'botol', 52000, 65000, 3, 4, 'Klorpirifos 200 g/L', 'Penggerek batang padi dan ulat grayak. Dosis 2 ml per liter air.', 300],
  ['Fungisida Mankozeb 80 WP 1 kg', 'Fungisida', 'bungkus', 78000, 95000, 10, 3, 'Mankozeb 80%', 'Bercak daun, busuk buah, antraknosa. Dosis 2–3 g per liter air.', 520],
  ['Fungisida Difenokonazol 250 EC 100 ml', 'Fungisida', 'botol', 45000, 58000, 8, 3, 'Difenokonazol 250 g/L', 'Blas padi dan bercak ungu bawang. Dosis 0,5–1 ml per liter air.', -12],
  ['Herbisida Glifosat 486 SL 1 L', 'Herbisida', 'botol', 62000, 75000, 20, 5, 'Isopropilamina glifosat 486 g/L', 'Gulma total sebelum tanam. Dosis 5–8 ml per liter air.', 600, [{ min: 6, price: 72000 }]],
  ['Herbisida Parakuat 276 SL 1 L', 'Herbisida', 'botol', 58000, 70000, 0, 4, 'Parakuat diklorida 276 g/L', 'Gulma kontak pada lahan tanpa olah tanah. Dosis 3–6 ml per liter air.', 400],
  ['Pupuk Urea 50 kg', 'Pupuk', 'sak', 260000, 285000, 15, 5, 'Nitrogen 46%', 'Pupuk dasar dan susulan padi, jagung, sayuran.', null, [{ min: 10, price: 278000 }]],
  ['Pupuk NPK 16-16-16 (eceran)', 'Pupuk', 'kg', 15000, 18500, 120, 25, 'N 16%, P 16%, K 16%', 'Pupuk majemuk untuk sayur dan buah.', null, [{ min: 25, price: 17000 }, { min: 50, price: 16500 }]],
  ['Pupuk ZA 50 kg', 'Pupuk', 'sak', 145000, 165000, 9, 4, 'Amonium sulfat (N 21%, S 24%)', 'Pupuk susulan bawang merah dan tebu.', null],
  ['Pupuk KCl (eceran)', 'Pupuk', 'kg', 13000, 16000, 60, 15, 'Kalium 60%', 'Memperkuat batang dan meningkatkan mutu buah.', null],
  ['Pupuk Kompos Organik 25 kg', 'Pupuk Organik', 'karung', 30000, 40000, 25, 5, '', 'Memperbaiki struktur tanah. 1–2 ton per hektare.', null],
  ['Benih Padi Unggul 5 kg', 'Benih', 'bungkus', 60000, 75000, 30, 10, '', 'Varietas tahan wereng, umur panen ±115 hari.', 210],
  ['Benih Cabai Rawit Hibrida 10 g', 'Benih', 'sachet', 45000, 58000, 12, 4, '', 'Daya tumbuh tinggi, cocok dataran rendah–menengah.', 150],
  ['ZPT Perangsang Akar 100 ml', 'ZPT & Nutrisi', 'botol', 18000, 25000, 14, 4, 'Auksin & sitokinin', 'Rendam atau kocor bibit. Dosis 1–2 ml per liter air.', 90],
  ['Perekat Perata 500 ml', 'ZPT & Nutrisi', 'botol', 20000, 27000, 10, 3, 'Alkil aril poliglikol eter', 'Campurkan ke semprotan agar tidak luntur hujan. 0,5 ml per liter.', 700],
  ['Sprayer Elektrik 16 L', 'Sprayer & Suku Cadang', 'unit', 420000, 495000, 4, 2, '', 'Baterai isi ulang, tekanan stabil.', null],
  ['Nozel Sprayer Kuningan', 'Sprayer & Suku Cadang', 'pcs', 8000, 12000, 40, 10, '', 'Untuk sprayer punggung standar.', null],
  ['Cangkul Baja', 'Alat Pertanian', 'pcs', 65000, 85000, 7, 3, '', '', null],
  ['Sabit Rumput', 'Alat Pertanian', 'pcs', 30000, 40000, 2, 3, '', '', null],
  ['Selang Air 1/2 inci', 'Alat Pertanian', 'meter', 3500, 5000, 150, 30, '', 'Dijual per meter.', null, [{ min: 50, price: 4500 }]],
  ['Terpal Plastik 4×6 m', 'Alat Pertanian', 'pcs', 85000, 110000, 6, 2, '', 'Untuk jemur gabah.', null],
];

const SAMPLE_CUSTOMERS = [
  ['Pak Sutrisno', '081200000001', 'Desa Sukamaju', 'Petani padi, bayar setelah panen'],
  ['Bu Rahmawati', '081200000002', 'Dusun Sidorejo', 'Kebun cabai & bawang'],
  ['Pak Hendra Sinaga', '081200000003', 'Desa Lumban Tonga', ''],
  ['Kelompok Tani Makmur', '081200000004', 'Balai Desa Sukamaju', 'Pembelian kolektif'],
];

export async function loadSample({ withSales = true } = {}) {
  const made = [];
  for (const [name, category, unit, buyPrice, sellPrice, stock, minStock, ingredient, usage, exp, tiers] of SAMPLE) {
    if (state.products.some((p) => p.name === name)) continue;
    made.push(await saveProduct({
      name, category, unit, buyPrice, sellPrice, stock, minStock, ingredient, usage, tiers: tiers || [],
      brand: 'Contoh', expiry: exp === null || exp === undefined ? '' : isoDate(addDays(new Date(), exp)),
    }));
  }
  const custs = [];
  for (const [name, phone, address, note] of SAMPLE_CUSTOMERS) {
    if (state.customers.some((c) => c.name === name)) continue;
    custs.push(await saveCustomer({ name, phone, address, note }));
  }
  if (!withSales || !made.length) return made.length;

  // Penjualan contoh 14 hari terakhir (tidak mengubah stok) supaya laporan bisa dicoba
  const sales = [];
  const ledger = [];
  const balances = new Map();
  for (let d = 13; d >= 0; d--) {
    const day = addDays(new Date(), -d);
    const n = 4 + Math.floor(Math.random() * 7);
    for (let k = 0; k < n; k++) {
      const at = new Date(day);
      at.setHours(7 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60), 0, 0);
      if (at > new Date()) continue;
      const pick = [...made].sort(() => Math.random() - 0.5).slice(0, 1 + Math.floor(Math.random() * 3));
      const lines = pick.map((p) => {
        const qty = p.unit === 'kg' || p.unit === 'meter' ? 2 + Math.floor(Math.random() * 20) : 1 + Math.floor(Math.random() * 3);
        const price = tierPrice(p, qty);
        return { productId: p.id, code: p.code, name: p.name, unit: p.unit, category: p.category, qty, price, normalPrice: p.sellPrice, buyPrice: p.buyPrice, subtotal: qty * price };
      });
      const t = computeTotals(lines, 0, 0);
      const r = Math.random();
      const method = r < 0.55 ? 'tunai' : r < 0.75 ? 'qris' : r < 0.85 ? 'transfer' : 'utang';
      const cust = custs.length && (method === 'utang' || Math.random() < 0.2) ? custs[Math.floor(Math.random() * custs.length)] : null;
      const realMethod = method === 'utang' && !cust ? 'tunai' : method;
      const paid = realMethod === 'tunai' ? Math.ceil(t.total / 5000) * 5000 : realMethod === 'utang' ? 0 : t.total;
      const debt = realMethod === 'utang' ? t.total : 0;
      const id = uid();
      const sale = { id, createdAt: at.toISOString(), items: lines, ...t, method: realMethod, paid, change: realMethod === 'tunai' ? paid - t.total : 0, debt, dueDate: debt ? isoDate(addDays(at, 30)) : '', ref: '', cashier: 'Contoh', status: 'selesai', demo: true, ...(cust ? { customerId: cust.id, customerName: cust.name } : {}) };
      sales.push(sale);
      if (debt) {
        const bal = (balances.get(cust.id) || 0) + debt;
        balances.set(cust.id, bal);
        ledger.push({ id: uid(), customerId: cust.id, type: 'utang', amount: debt, balanceAfter: bal, saleId: id, note: `Jatuh tempo ${sale.dueDate}`, createdAt: sale.createdAt, cashier: 'Contoh' });
      }
    }
  }
  sales.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const perDay = {};
  for (const s of sales) {
    const k = dayKey(s.createdAt);
    perDay[k] = (perDay[k] || 0) + 1;
    s.no = `CTH-${k}-${String(perDay[k]).padStart(4, '0')}`;
    const l = ledger.find((x) => x.saleId === s.id);
    if (l) l.saleNo = s.no;
  }
  const custUpdates = custs.map((c) => {
    const bal = balances.get(c.id) || 0;
    const due = sales.filter((s) => s.customerId === c.id && s.debt).map((s) => s.dueDate).sort()[0] || '';
    return { ...c, balance: bal, dueDate: bal ? due : '' };
  });
  await tx(['sales', 'ledger', 'customers'], 'readwrite', async (s) => {
    for (const row of sales) await wrap(s.sales.put(row));
    for (const row of ledger) await wrap(s.ledger.put(row));
    for (const row of custUpdates) await wrap(s.customers.put(row));
  });
  custUpdates.forEach((c) => upsertCache(state.customers, c)); sortCustomers();
  emit('sales'); emit('customers');
  return made.length;
}

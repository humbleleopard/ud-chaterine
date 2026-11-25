// CSV dengan pemisah titik koma (cocok untuk Excel berbahasa Indonesia).
import { parseMoney, parseQty } from './format.js';

export function toCSV(headers, rows, sep = ';') {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[";,\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.map((h) => cell(h.label)).join(sep)];
  for (const r of rows) lines.push(headers.map((h) => cell(h.get ? h.get(r) : r[h.key])).join(sep));
  return '﻿' + lines.join('\r\n');
}

export function parseCSV(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => first.split(ch).length - 1;
  const sep = [';', ',', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export const PRODUCT_COLUMNS = [
  { key: 'code', label: 'kode', get: (p) => p.code },
  { key: 'name', label: 'nama', get: (p) => p.name },
  { key: 'category', label: 'kategori', get: (p) => p.category },
  { key: 'brand', label: 'merek', get: (p) => p.brand || '' },
  { key: 'ingredient', label: 'bahan_aktif', get: (p) => p.ingredient || '' },
  { key: 'usage', label: 'kegunaan_dosis', get: (p) => p.usage || '' },
  { key: 'unit', label: 'satuan', get: (p) => p.unit },
  { key: 'buyPrice', label: 'harga_beli', get: (p) => p.buyPrice },
  { key: 'sellPrice', label: 'harga_jual', get: (p) => p.sellPrice },
  { key: 'stock', label: 'stok', get: (p) => String(p.stock).replace('.', ',') },
  { key: 'minStock', label: 'stok_minimum', get: (p) => String(p.minStock).replace('.', ',') },
  { key: 'expiry', label: 'kedaluwarsa', get: (p) => p.expiry || '' },
];

const ALIASES = {
  code: ['kode', 'code', 'barcode', 'sku', 'kodebarang', 'plu'],
  name: ['nama', 'name', 'namabarang', 'produk', 'namaproduk', 'barang'],
  category: ['kategori', 'category', 'jenis', 'kelompok'],
  unit: ['satuan', 'unit'],
  brand: ['merek', 'merk', 'brand', 'produsen', 'pabrik'],
  ingredient: ['bahanaktif', 'bahan', 'kandungan', 'ingredient', 'zataktif'],
  usage: ['kegunaandosis', 'kegunaan', 'dosis', 'carapakai', 'keterangan', 'usage'],
  expiry: ['kedaluwarsa', 'kadaluarsa', 'kadaluwarsa', 'expired', 'expiry', 'ed', 'tglkedaluwarsa'],
  buyPrice: ['hargabeli', 'modal', 'hpp', 'buyprice', 'hargamodal', 'hargapokok'],
  sellPrice: ['hargajual', 'harga', 'price', 'sellprice', 'hargaecer'],
  stock: ['stok', 'stock', 'jumlah', 'qty'],
  minStock: ['stokminimum', 'minstok', 'stokmin', 'minstock', 'minimum'],
};

/** Terima 2027-12-31, 31/12/2027, atau 31-12-2027 → 2027-12-31. */
function normDate(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}

/** Ubah tabel CSV menjadi objek produk. Hanya kolom yang ada yang diisi. */
export function rowsToProducts(table) {
  if (table.length < 2) throw new Error('CSV kosong. Baris pertama harus judul kolom.');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const header = table[0].map(norm);
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const i = header.findIndex((h) => names.includes(h));
    if (i >= 0) map[field] = i;
  }
  if (map.name === undefined && map.code === undefined) {
    throw new Error('Kolom "nama" atau "kode" tidak ditemukan. Unduh template CSV untuk contoh.');
  }
  return table.slice(1).map((r) => {
    const o = {};
    const val = (f) => (map[f] !== undefined ? String(r[map[f]] ?? '').trim() : undefined);
    for (const f of ['code', 'name', 'category', 'unit', 'brand', 'ingredient', 'usage']) { const v = val(f); if (v !== undefined) o[f] = v; }
    { const v = val('expiry'); if (v !== undefined) o.expiry = normDate(v); }
    for (const f of ['buyPrice', 'sellPrice']) { const v = val(f); if (v !== undefined && v !== '') o[f] = parseMoney(v); }
    for (const f of ['stock', 'minStock']) { const v = val(f); if (v !== undefined && v !== '') o[f] = parseQty(v); }
    return o;
  });
}

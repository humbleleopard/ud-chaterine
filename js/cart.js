// Keranjang kasir, disimpan di localStorage agar tidak hilang saat halaman dimuat ulang.
import { round3 } from './format.js';
import { computeTotals, tierPrice, getProduct } from './store.js';

const KEY = 'kasirqr-cart';
const blank = () => ({ items: [], discount: { type: 'rp', value: 0 }, customerId: '' });

export function loadCart() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && Array.isArray(v.items)) return { ...blank(), ...v };
  } catch { /* abaikan */ }
  return blank();
}

export function saveCart(cart) {
  try { localStorage.setItem(KEY, JSON.stringify(cart)); } catch { /* abaikan */ }
}

export function clearCart(cart) {
  cart.items = [];
  cart.discount = { type: 'rp', value: 0 };
  cart.customerId = '';
  saveCart(cart);
}

/** Hitung ulang harga baris sesuai harga grosir, kecuali harga diubah manual oleh kasir. */
export function reprice(line, p = getProduct(line.productId)) {
  if (!p || line.manual) return line;
  line.price = tierPrice(p, line.qty);
  line.normalPrice = p.sellPrice;
  return line;
}

/** Tambah produk; baris yang baru diubah dipindah ke atas. */
export function addToCart(cart, p, qty = 1) {
  const i = cart.items.findIndex((x) => x.productId === p.id);
  let line;
  if (i >= 0) {
    line = cart.items.splice(i, 1)[0];
    line.qty = round3(line.qty + qty);
  } else {
    line = { productId: p.id, code: p.code, name: p.name, unit: p.unit, price: p.sellPrice, normalPrice: p.sellPrice, qty: round3(qty), manual: false };
  }
  reprice(line, p);
  cart.items.unshift(line);
  saveCart(cart);
  return line;
}

/** Tambah ke keranjang dari halaman lain (mis. Cek Harga). */
export function addToSavedCart(p, qty = 1) {
  const c = loadCart();
  addToCart(c, p, qty);
  return c;
}

export function setSavedCartCustomer(customerId) {
  const c = loadCart();
  c.customerId = customerId || '';
  saveCart(c);
}

export function discountAmount(cart) {
  const subtotal = cart.items.reduce((s, i) => s + Math.round(i.qty * i.price), 0);
  const d = cart.discount || {};
  if (d.type === 'pct') return Math.round(subtotal * Math.min(100, Math.max(0, d.value || 0)) / 100);
  return Math.min(subtotal, Math.max(0, d.value || 0));
}

export function cartTotals(cart, taxPercent = 0) {
  const t = computeTotals(cart.items, discountAmount(cart), taxPercent);
  t.count = round3(cart.items.reduce((s, i) => s + i.qty, 0));
  t.lines = cart.items.length;
  t.savings = cart.items.reduce((s, i) => s + Math.max(0, Math.round(i.qty * ((i.normalPrice || i.price) - i.price))), 0);
  return t;
}

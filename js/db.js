// Pembungkus kecil IndexedDB. Semua data toko disimpan di perangkat ini.
const DB_NAME = 'kasirqr';
const DB_VERSION = 2;
export const STORES = ['products', 'sales', 'moves', 'settings', 'customers', 'ledger'];

let dbPromise;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('Browser ini tidak mendukung penyimpanan IndexedDB.'));
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        const t = req.transaction;
        if (e.oldVersion < 1) {
          const products = db.createObjectStore('products', { keyPath: 'id' });
          products.createIndex('code', 'code', { unique: true });
          const sales = db.createObjectStore('sales', { keyPath: 'id' });
          sales.createIndex('createdAt', 'createdAt');
          const moves = db.createObjectStore('moves', { keyPath: 'id' });
          moves.createIndex('productId', 'productId');
          moves.createIndex('createdAt', 'createdAt');
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (e.oldVersion < 2) {
          // Versi 2: pelanggan & buku utang (kasbon)
          db.createObjectStore('customers', { keyPath: 'id' });
          const ledger = db.createObjectStore('ledger', { keyPath: 'id' });
          ledger.createIndex('customerId', 'customerId');
          ledger.createIndex('createdAt', 'createdAt');
          t.objectStore('sales').createIndex('customerId', 'customerId');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); location.reload(); };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => reject(new Error('Tutup tab aplikasi kasir lain yang masih terbuka, lalu muat ulang halaman.'));
    });
  }
  return dbPromise;
}

export const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/**
 * Jalankan fn di dalam satu transaksi. Di dalam fn hanya boleh menunggu
 * request IndexedDB (lewat wrap), supaya transaksi tidak tertutup otomatis.
 * Jika fn melempar error, seluruh perubahan dibatalkan.
 */
export async function tx(names, mode, fn) {
  const db = await openDB();
  const list = [].concat(names);
  return new Promise((resolve, reject) => {
    const t = db.transaction(list, mode);
    const stores = Object.fromEntries(list.map((n) => [n, t.objectStore(n)]));
    let result;
    let failed = null;
    Promise.resolve()
      .then(() => fn(stores, t))
      .then((r) => { result = r; }, (err) => {
        failed = err;
        try { t.abort(); } catch { /* sudah selesai */ }
        reject(friendly(err));
      });
    t.oncomplete = () => { if (!failed) resolve(result); };
    t.onabort = () => {
      if (failed) return;
      failed = t.error || new Error('Transaksi database dibatalkan.');
      reject(friendly(failed));
    };
  });
}

function friendly(err) {
  if (err && err.name === 'ConstraintError') return new Error('Kode barang sudah dipakai produk lain.');
  if (err && err.name === 'QuotaExceededError') return new Error('Penyimpanan perangkat penuh. Hapus beberapa foto produk atau kosongkan ruang.');
  return err;
}

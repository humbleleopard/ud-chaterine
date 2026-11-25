// Pengaturan: info toko, struk, QRIS, kasir, PIN pemilik, backup/restore data.
import * as store from '../store.js';
import { toast, confirmDialog, promptDialog, download, pickFile, readText } from '../ui.js';
import { icon } from '../icons.js';
import { esc, num, parseQty, isoDate, fmtDateTime, timeAgo } from '../format.js';
import { scanOnce, scanImageFile } from '../scanner.js';
import { inspectQris } from '../qris.js';
import { receiptHTML, printHTML } from '../receipt.js';
import { setUnlocked } from '../auth.js';

export async function render(view) {
  const draw = () => {
    const s = store.state.settings;
    view.innerHTML = `
    <div class="page narrow">
      <header class="page-head"><div><h1>Pengaturan</h1><p class="muted">Perubahan tersimpan otomatis.</p></div></header>

      <section class="card settings">
        <h2 class="card-title">${icon('store')} Toko</h2>
        <div class="form-grid">
          <label class="field"><span>Nama toko</span><input class="input" data-key="storeName" value="${esc(s.storeName)}" autocomplete="organization"></label>
          <label class="field"><span>Keterangan singkat</span><input class="input" data-key="tagline" value="${esc(s.tagline || '')}" placeholder="mis. Toko Pertanian"></label>
          <label class="field span-2"><span>Alamat (tampil di struk)</span><input class="input" data-key="address" value="${esc(s.address)}" autocomplete="street-address"></label>
          <label class="field"><span>No. telepon / WA</span><input class="input" data-key="phone" value="${esc(s.phone)}" inputmode="tel" autocomplete="tel"></label>
          <label class="field"><span>Nama kasir di perangkat ini</span><input class="input" data-key="cashierName" value="${esc(s.cashierName)}"></label>
        </div>
      </section>

      <section class="card settings">
        <h2 class="card-title">${icon('qr')} Pembayaran QRIS</h2>
        <p class="muted">Masukkan QRIS <b>statis</b> toko (dari bank/e-wallet merchant Anda). Saat bayar, aplikasi membuat QRIS dengan nominal belanja otomatis, jadi pembeli tidak perlu mengetik jumlah. Dana tetap masuk langsung ke rekening merchant Anda.</p>
        <div class="row gap-sm wrap">
          <button type="button" class="btn" data-qris-scan>${icon('camera')} Scan stiker QRIS</button>
          <button type="button" class="btn" data-qris-img>${icon('image')} Unggah gambar QRIS</button>
          ${s.qris ? `<button type="button" class="btn ghost danger-text" data-qris-del>${icon('trash')} Hapus</button>` : ''}
        </div>
        <label class="field"><span>Kode QRIS (teks)</span><textarea class="input mono" rows="3" data-qris placeholder="00020101021126…" spellcheck="false">${esc(s.qris)}</textarea></label>
        <div data-qris-status></div>
        <label class="field narrow-field"><span>Pajak / PPN (%) — isi 0 bila tidak dipakai</span><input class="input" data-key="taxPercent" data-type="num" value="${num(s.taxPercent)}" inputmode="decimal"></label>
      </section>

      <section class="card settings">
        <h2 class="card-title">${icon('printer')} Struk</h2>
        <div class="field"><span>Lebar kertas printer</span>
          <div class="seg seg-2" data-paper><button type="button" data-v="58">58 mm</button><button type="button" data-v="80">80 mm</button></div>
        </div>
        <label class="field"><span>Pesan di bawah struk</span><input class="input" data-key="footer" value="${esc(s.footer)}"></label>
        <label class="check"><input type="checkbox" data-key="autoPrint" ${s.autoPrint ? 'checked' : ''}><span>Langsung cetak struk setelah pembayaran</span></label>
        <div><button type="button" class="btn sm" data-test-print>${icon('printer')} Cetak struk percobaan</button></div>
      </section>

      <section class="card settings">
        <h2 class="card-title">${icon('cart')} Kasir</h2>
        <label class="check"><input type="checkbox" data-key="beep" ${s.beep ? 'checked' : ''}><span>Bunyi “bip” & getar saat barang terscan</span></label>
        <label class="check"><input type="checkbox" data-key="allowNegativeStock" ${s.allowNegativeStock ? 'checked' : ''}><span>Tetap boleh jual walau stok di aplikasi 0 (stok jadi minus)</span></label>
        <div class="form-grid">
          <label class="field"><span>Ingatkan kedaluwarsa (hari sebelumnya)</span><input class="input" data-key="expiryWarnDays" data-type="int" value="${num(s.expiryWarnDays)}" inputmode="numeric"></label>
          <label class="field"><span>Jatuh tempo kasbon bawaan (hari)</span><input class="input" data-key="defaultDueDays" data-type="int" value="${num(s.defaultDueDays)}" inputmode="numeric"></label>
        </div>
      </section>

      <section class="card settings">
        <h2 class="card-title">${icon('lock')} PIN pemilik</h2>
        <p class="muted">Bila diaktifkan, halaman Produk, Riwayat, Laporan, Label, dan Pengaturan butuh PIN. Karyawan tetap bisa memakai Kasir dan Cek Harga.</p>
        <div class="row gap-sm wrap">
          ${s.pinHash
            ? `<span class="badge ok">${icon('check')} PIN aktif</span><button type="button" class="btn sm" data-pin-set>Ganti PIN</button><button type="button" class="btn sm ghost danger-text" data-pin-del>Matikan PIN</button>`
            : `<button type="button" class="btn sm primary" data-pin-set>${icon('lock')} Pasang PIN</button>`}
        </div>
      </section>

      <section class="card settings">
        <h2 class="card-title">${icon('database')} Data & backup</h2>
        <p class="muted">Semua data tersimpan di browser perangkat ini (bisa dipakai tanpa internet). Lakukan backup rutin, dan gunakan berkas backup untuk memindahkan data ke perangkat lain.</p>
        <p class="small" data-storage></p>
        <div class="row gap-sm wrap">
          <button type="button" class="btn primary" data-backup>${icon('download')} Backup sekarang</button>
          <button type="button" class="btn" data-restore>${icon('upload')} Pulihkan dari backup</button>
        </div>
        <p class="muted small">${s.lastBackupAt ? `Backup terakhir: ${fmtDateTime(s.lastBackupAt)} (${timeAgo(s.lastBackupAt)})` : 'Belum pernah backup.'}</p>
        <hr>
        <div class="row gap-sm wrap">
          <button type="button" class="btn" data-sample>${icon('sparkle')} Isi data contoh</button>
          <button type="button" class="btn ghost danger-text" data-reset>${icon('trash')} Hapus semua data</button>
        </div>
      </section>
      <p class="muted center small">${esc(s.storeName)} · aplikasi kasir · data tidak dikirim ke server mana pun.</p>
    </div>`;
    wire();
  };

  const q = (sel) => view.querySelector(sel);

  async function save(patch, msg = 'Tersimpan') {
    try { await store.saveSettings(patch); toast(msg, { type: 'ok', duration: 1400 }); } catch (err) { toast(err.message, { type: 'bad' }); }
  }

  function qrisStatus() {
    const el = q('[data-qris-status]');
    const raw = q('[data-qris]').value.trim();
    if (!raw) { el.innerHTML = ''; return null; }
    try {
      const info = inspectQris(raw);
      el.innerHTML = `<div class="notice ok">${icon('check')}<span>QRIS valid · <b>${esc(info.merchant || '-')}</b>${info.city ? `, ${esc(info.city)}` : ''}${info.isStatic ? '' : ' · <em>QRIS ini dinamis; sebaiknya pakai QRIS statis.</em>'}</span></div>`;
      return info;
    } catch (err) {
      el.innerHTML = `<div class="notice bad">${icon('alert')}<span>${esc(err.message)}</span></div>`;
      return null;
    }
  }

  async function setQris(raw) {
    const ta = q('[data-qris]');
    ta.value = String(raw || '').trim();
    if (qrisStatus()) { await save({ qris: ta.value }, 'QRIS tersimpan'); draw(); }
  }

  function wire() {
    const s = store.state.settings;
    view.querySelectorAll('input[data-key]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const key = inp.dataset.key;
        let value = inp.type === 'checkbox' ? inp.checked : inp.value.trim();
        if (inp.dataset.type === 'num') value = Math.max(0, Math.min(100, parseQty(value)));
        if (inp.dataset.type === 'int') value = Math.max(1, Math.min(3650, Math.round(parseQty(value)) || 1));
        if (key === 'storeName' && !value) value = 'UD CHATERINE';
        save({ [key]: value });
      });
    });
    view.querySelectorAll('[data-paper] [data-v]').forEach((b) => {
      b.classList.toggle('active', b.dataset.v === s.paper);
      b.onclick = () => { save({ paper: b.dataset.v }); view.querySelectorAll('[data-paper] [data-v]').forEach((x) => x.classList.toggle('active', x === b)); };
    });
    const ta = q('[data-qris]');
    ta.addEventListener('input', qrisStatus);
    ta.addEventListener('change', () => { if (!ta.value.trim()) return; if (qrisStatus()) save({ qris: ta.value.trim() }, 'QRIS tersimpan'); });
    qrisStatus();
    q('[data-qris-scan]').onclick = async () => { const code = await scanOnce({ title: 'Scan stiker QRIS toko' }); if (code) setQris(code); };
    q('[data-qris-img]').onclick = async () => {
      const file = await pickFile('image/*');
      if (!file) return;
      try { setQris(await scanImageFile(file)); } catch (err) { toast(err.message, { type: 'bad' }); }
    };
    q('[data-qris-del]')?.addEventListener('click', async () => {
      if (await confirmDialog('Hapus QRIS toko dari aplikasi?', { ok: 'Hapus', danger: true })) { await save({ qris: '' }, 'QRIS dihapus'); draw(); }
    });

    q('[data-test-print]').onclick = () => {
      const st = store.state.settings;
      const demo = { no: 'INV-CONTOH-0001', createdAt: new Date().toISOString(), cashier: st.cashierName, items: [
        { name: 'Contoh Barang A', unit: 'pcs', qty: 2, price: 3500, subtotal: 7000 },
        { name: 'Contoh Barang B dengan nama panjang', unit: 'kg', qty: 1.5, price: 18000, subtotal: 27000 },
      ], subtotal: 34000, discount: 0, tax: 0, total: 34000, method: 'tunai', paid: 50000, change: 16000, status: 'selesai' };
      printHTML(receiptHTML(demo, st), 'receipt');
    };

    q('[data-pin-set]').onclick = async () => {
      const pin = await promptDialog({ title: 'PIN pemilik', label: 'PIN baru (4–12 angka)', type: 'password', inputmode: 'numeric', ok: 'Lanjut' });
      if (pin === null) return;
      if (!/^\d{4,12}$/.test(pin)) { toast('PIN harus 4–12 angka', { type: 'bad' }); return; }
      const again = await promptDialog({ title: 'Ulangi PIN', label: 'Ketik ulang PIN', type: 'password', inputmode: 'numeric', ok: 'Simpan PIN' });
      if (again === null) return;
      if (again !== pin) { toast('PIN tidak sama', { type: 'bad' }); return; }
      await store.saveSettings({ pinHash: await store.hashPin(pin) });
      setUnlocked(true);
      toast('PIN pemilik aktif. Simpan baik-baik; bila lupa, data harus dipulihkan dari backup.', { type: 'ok', duration: 5000 });
      draw();
    };
    q('[data-pin-del]')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Matikan PIN? Semua halaman bisa dibuka tanpa PIN.', { ok: 'Matikan PIN', danger: true }))) return;
      setUnlocked(false);
      await store.saveSettings({ pinHash: '' });
      toast('PIN dimatikan', { type: 'ok' });
      draw();
    });

    q('[data-backup]').onclick = async () => {
      const data = await store.exportData();
      const name = (store.state.settings.storeName || 'toko').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'toko';
      download(`backup-kasirqr-${name}-${isoDate()}.json`, JSON.stringify(data), 'application/json');
      await store.saveSettings({ lastBackupAt: new Date().toISOString() });
      toast(`Backup berisi ${num(data.products.length)} produk, ${num(data.sales.length)} transaksi, ${num(data.customers.length)} pelanggan diunduh`, { type: 'ok', duration: 4000 });
      draw();
    };
    q('[data-restore]').onclick = async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      let data;
      try { data = JSON.parse(await readText(file)); } catch { toast('Berkas backup tidak bisa dibaca', { type: 'bad' }); return; }
      if (data?.app !== 'KasirQR') { toast('Berkas ini bukan backup aplikasi kasir ini', { type: 'bad' }); return; }
      const ok = await confirmDialog(`Pulihkan backup ${data.exportedAt ? 'tanggal ' + fmtDateTime(data.exportedAt) : ''} (${num(data.products?.length || 0)} produk, ${num(data.sales?.length || 0)} transaksi)? Semua data di perangkat ini akan DIGANTI isi backup.`, { title: 'Pulihkan data', ok: 'Ganti dengan backup', danger: true });
      if (!ok) return;
      try { await store.importData(data); setUnlocked(true); toast('Data berhasil dipulihkan', { type: 'ok' }); draw(); } catch (err) { toast(err.message, { type: 'bad' }); }
    };
    q('[data-sample]').onclick = async () => {
      const ok = await confirmDialog('Tambahkan 22 produk contoh toko pertanian (pestisida, pupuk, benih, alat), 4 pelanggan, dan penjualan contoh 14 hari terakhir? Cocok untuk mencoba aplikasi. Hapus lewat “Hapus semua data” sebelum dipakai sungguhan.', { ok: 'Isi data contoh' });
      if (!ok) return;
      const n = await store.loadSample();
      toast(n ? `${n} produk contoh + penjualan contoh ditambahkan` : 'Data contoh sudah ada', { type: 'ok' });
    };
    q('[data-reset]').onclick = async () => {
      const ok = await confirmDialog('Hapus SEMUA produk, transaksi, pelanggan & kasbon, riwayat stok, dan pengaturan di perangkat ini? Tindakan ini tidak bisa dibatalkan. Backup dulu bila perlu.', { title: 'Hapus semua data', ok: 'Lanjut', danger: true });
      if (!ok) return;
      const word = await promptDialog({ title: 'Konfirmasi terakhir', label: 'Ketik HAPUS untuk melanjutkan', ok: 'Hapus semua' });
      if (word?.trim().toUpperCase() !== 'HAPUS') { if (word !== null) toast('Dibatalkan', { type: 'info' }); return; }
      await store.resetData();
      setUnlocked(false);
      toast('Semua data dihapus', { type: 'ok' });
      draw();
    };

    (async () => {
      const el = q('[data-storage]');
      try {
        const [est, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
        if (est) el.innerHTML = `${icon('database')} Terpakai ${num(Math.round((est.usage || 0) / 1024 / 10.24) / 100)} MB · ${persisted ? '<span class="text-ok">penyimpanan permanen aktif</span>' : '<span class="warn-text">browser bisa menghapus data bila memori penuh — pasang aplikasi ke layar utama & backup rutin</span>'}`;
      } catch { /* abaikan */ }
    })();
  }

  draw();
  const unsub = store.subscribe((w) => { if (w === 'all') draw(); });
  return () => unsub();
}

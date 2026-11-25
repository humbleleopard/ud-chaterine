# UD CHATERINE — Aplikasi Kasir Toko Pertanian

Aplikasi kasir web untuk toko obat tanaman, pupuk, benih, dan alat pertanian.

Cara kerjanya: barang di-scan (barcode kemasan atau label QR), harga langsung masuk ke keranjang, lalu pembeli membayar dengan tunai, QRIS, transfer, atau **kasbon** (bayar setelah panen). Stok berkurang otomatis.

Aplikasi ini berjalan langsung di browser, tanpa server dan tanpa biaya bulanan. Setelah dibuka sekali, aplikasi tetap bisa dipakai walau tidak ada internet.

## Fitur

| Halaman | Isi |
|---|---|
| **Beranda** | Ringkasan penjualan hari ini dan laba kotor. Ada pengingat stok menipis, barang yang mendekati **kedaluwarsa**, dan **kasbon yang jatuh tempo**. |
| **Kasir** | Scan dengan kamera HP/laptop atau scanner barcode USB, ketik nama/kode/**bahan aktif**, atau ketuk kartu barang yang berfoto. **Harga grosir** dipakai otomatis (mis. beli ≥ 10 sak). Ada diskon, dan transaksi bisa dikaitkan ke pelanggan. Pembayaran: tunai (kembalian dihitung otomatis), QRIS (nominal langsung tertanam), transfer, atau **kasbon dengan uang muka & jatuh tempo**. Struk bisa dicetak atau dikirim lewat WhatsApp. |
| **Cek Harga** | Scan barang, lalu tampil foto, harga besar, harga grosir, stok, bahan aktif, kegunaan & dosis, serta tanggal kedaluwarsa. |
| **Produk & Stok** | **Foto barang** (langsung dari kamera, dari galeri, seret gambar ke kotak foto, atau tempel dengan Ctrl+V). Isinya: merek, bahan aktif, kegunaan/dosis, satuan (botol, sak, kg, liter, dll.), harga modal & jual, harga grosir bertingkat, stok minimum, tanggal kedaluwarsa. Ada barang masuk (sekalian perbarui harga beli & kedaluwarsa), barang keluar, koreksi stok, riwayat stok, dan impor/ekspor CSV. |
| **Pelanggan & Kasbon** | Daftar petani/pelanggan beserta sisa utang dan jatuh tempo. Bisa terima cicilan atau pelunasan, kirim pengingat lewat WhatsApp, dan lihat riwayat belanja. |
| **Label QR** | QR semua barang langsung tampil. Tiap barang punya tombol **Simpan** (gambar PNG berisi QR, nama, dan harga) dan **Cetak**, atau beberapa barang bisa dipilih untuk dicetak sekaligus di kertas A4. |
| **Riwayat** | Daftar transaksi, cetak ulang struk, dan pembatalan (stok dan kasbon kembali otomatis). Bisa diekspor ke CSV. |
| **Laporan** | Omzet, laba kotor, grafik penjualan, metode bayar, penjualan per kategori, produk terlaris, kasbon baru, cicilan diterima, total piutang, dan nilai stok. |
| **Pengaturan** | Nama toko, QRIS, ukuran struk 58/80 mm, pajak, **PIN pemilik**, batas pengingat kedaluwarsa, jatuh tempo kasbon bawaan, backup/pulihkan data. |

Pintasan keyboard di Kasir: `F2` cari, `F4` bayar, `10*kode` untuk langsung mengisi jumlah 10.

## Mencoba di komputer

Aplikasi harus dibuka lewat server lokal; klik ganda `index.html` tidak akan berjalan. Dari folder ini, jalankan:

```powershell
npx serve -l 5173 .
```

Lalu buka http://localhost:5173. Untuk melihat contoh isinya, pilih **Pengaturan → Isi data contoh**: 22 produk pertanian, 4 pelanggan, dan penjualan 14 hari. Sebelum dipakai sungguhan, hapus data contoh lewat **Pengaturan → Hapus semua data**.

## Memakai di HP toko (kamera butuh HTTPS)

Browser hanya mengizinkan kamera di alamat **HTTPS**. Pilihan gratis:

1. **GitHub Pages**: unggah isi folder ini ke sebuah repositori GitHub, lalu buka *Settings → Pages → Deploy from branch → main / root*.
2. Atau **Netlify Drop** (app.netlify.com/drop): seret folder ini ke halaman itu.

Buka alamatnya di HP, lalu pilih **Tambahkan ke Layar Utama** / **Install app**. Setelah itu aplikasi muncul dengan ikon daun UD CHATERINE dan bisa dipakai offline.

## QR barang

- QR dibuat **di dalam aplikasi sendiri**, jadi selalu muncul walau tanpa internet.
- Di halaman produk ada kartu **Label QR** dengan tombol **Simpan QR**: gambarnya masuk folder Unduhan/Galeri dan bisa dicetak di tempat fotokopi atau dikirim lewat WA.
- Barang pabrikan biasanya sudah punya barcode. Cukup scan saat menambah produk, tidak perlu label lagi.
- Barang curah atau eceran tanpa barcode (pupuk per kg, selang per meter, dll.): tekan **Buat kode**, lalu cetak atau simpan label QR-nya.
- Format yang bisa di-scan: QR, EAN-13, EAN-8, UPC, Code 128, Code 39, ITF. Scanner USB/Bluetooth langsung bisa dipakai.

## QRIS dinamis

1. Di **Pengaturan → Pembayaran QRIS**, scan stiker QRIS **statis** toko atau unggah gambarnya.
2. Saat pembeli memilih QRIS, aplikasi membuat QR yang **nominalnya sudah terisi**.
3. Dana masuk **langsung ke rekening merchant toko**. Kasir tetap harus mengecek notifikasi dana masuk sebelum menekan **Selesaikan**, karena aplikasi ini tidak terhubung ke bank.

## Kasbon (utang pelanggan)

- Di Kasir, pilih pelanggan, lalu pilih metode **Kasbon**. Isi uang muka (boleh 0) dan tanggal jatuh tempo.
- Sisa utang tercatat di **Pelanggan & Kasbon**. Cicilan dicatat dengan **Terima pembayaran**, dan pengingat bisa dikirim lewat WhatsApp.
- Membatalkan transaksi kasbon otomatis mengurangi utang pelanggan.

## Data — penting

- Semua data (produk, foto, transaksi, kasbon) disimpan di **browser perangkat itu sendiri** dan tidak dikirim ke server mana pun.
- Data di HP dan di laptop **terpisah**. Untuk memindahkan data, pakai **Backup** lalu **Pulihkan** di perangkat lain.
- **Backup rutin.** Beranda akan mengingatkan bila sudah lebih dari 7 hari. Menghapus data browser akan ikut menghapus data toko.
- Bila beberapa kasir perlu memakai data yang sama secara bersamaan, aplikasi perlu ditambah database online. Ini bisa menjadi pengembangan berikutnya.

## Struktur berkas

```
index.html              kerangka halaman
css/app.css             tampilan (tema hijau-emas, terang & gelap, desktop & HP)
js/app.js               rute halaman & navigasi
js/db.js, js/store.js   database IndexedDB & logika (stok, penjualan, kasbon, backup)
js/catalog.js           kategori & satuan toko pertanian
js/qrcode.js            pembuat QR mandiri (tanpa internet)
js/qrcard.js            jendela QR, simpan PNG, cetak label
js/scanner.js           kamera & pemindai barcode/QR (html5-qrcode)
js/qris.js              QRIS statis → dinamis
js/receipt.js           struk cetak & WhatsApp
js/pages/*.js           tiap halaman
sw.js                   mode offline
```

Satu-satunya pustaka luar adalah pemindai kamera `html5-qrcode@2.3.8`. Pustaka ini dimuat dari CDN (unpkg, cadangan jsDelivr), lalu disimpan agar tetap bisa dipakai offline.

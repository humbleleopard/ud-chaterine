// Pemindai kamera untuk QR code dan barcode (EAN-13, EAN-8, UPC, Code 128, Code 39, ITF).
// Memakai pustaka html5-qrcode (memakai BarcodeDetector bawaan browser bila tersedia).
import { openModal, beep } from './ui.js';
import { esc } from './format.js';
import { icon } from './icons.js';

// Dua sumber CDN; bila satu diblokir/putus, coba sumber berikutnya. Setelah termuat sekali, disimpan untuk offline.
export const SCANNER_SOURCES = [
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
];
let libPromise;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => (window.Html5Qrcode ? resolve() : reject(new Error('kosong')));
    s.onerror = () => { s.remove(); reject(new Error('gagal')); };
    document.head.append(s);
  });
}

export function loadScannerLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  if (!libPromise) {
    libPromise = (async () => {
      for (const src of SCANNER_SOURCES) {
        try { await loadScript(src); return; } catch { /* coba sumber berikutnya */ }
      }
      libPromise = null;
      throw new Error('Pemindai kamera gagal dimuat. Sambungkan internet sekali, setelah itu bisa dipakai offline. Sementara itu, ketik kode barang atau pakai scanner USB.');
    })();
  }
  return libPromise;
}

export function cameraErrorMessage(err) {
  const msg = String(err?.message || err || '');
  const name = err?.name || '';
  if (!window.isSecureContext) return 'Kamera hanya bisa dipakai lewat alamat HTTPS atau localhost.';
  if (name === 'NotAllowedError' || /permission|denied|notallowed/i.test(msg)) return 'Izin kamera ditolak. Buka pengaturan situs di browser, izinkan Kamera, lalu coba lagi.';
  if (name === 'NotFoundError' || /notfound|no camera|requested device not found/i.test(msg)) return 'Kamera tidak ditemukan di perangkat ini. Pakai scanner USB atau ketik kode barang.';
  if (name === 'NotReadableError' || /notreadable|could not start|in use/i.test(msg)) return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi itu lalu coba lagi.';
  return msg || 'Kamera tidak bisa dibuka.';
}

let seq = 0;

export class CameraScanner {
  /**
   * @param {HTMLElement} el wadah video
   * @param {(code:string)=>void} onScan
   * @param {{cooldown?:number}} opts jeda (ms) sebelum kode yang sama diterima lagi
   */
  constructor(el, onScan, { cooldown = 1600 } = {}) {
    this.el = el;
    if (!el.id) el.id = 'cam-' + (++seq);
    this.onScan = onScan;
    this.cooldown = cooldown;
    this.last = '';
    this.lastAt = 0;
    this.h = null;
    this.cameras = null;
    this.camIndex = -1;
    this.torchOn = false;
  }

  get running() { return !!this.h; }

  async start(deviceId) {
    await loadScannerLib();
    await this.stop();
    const F = window.Html5QrcodeSupportedFormats;
    this.h = new window.Html5Qrcode(this.el.id, {
      verbose: false,
      formatsToSupport: [F.QR_CODE, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF],
      useBarCodeDetectorIfSupported: true,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    const video = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: 'environment' };
    try {
      await this.h.start(
        video,
        {
          fps: 12,
          disableFlip: true,
          qrbox: (w, h) => ({
            width: Math.max(80, Math.floor(w * 0.82)),
            height: Math.max(80, Math.floor(Math.min(h * 0.62, w * 0.55))),
          }),
          videoConstraints: { ...video, width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        (text) => this._hit(text),
        () => {},
      );
    } catch (err) {
      try { this.h.clear(); } catch { /* abaikan */ }
      this.h = null;
      throw err;
    }
    this.torchOn = false;
  }

  _hit(text) {
    const code = String(text || '').trim();
    if (!code) return;
    const now = Date.now();
    if (code === this.last && now - this.lastAt < this.cooldown) { this.lastAt = now; return; }
    if (now - this.lastAt < 450) return;
    this.last = code;
    this.lastAt = now;
    this.onScan(code);
  }

  async stop() {
    const h = this.h;
    this.h = null;
    if (!h) return;
    try { if (h.isScanning) await h.stop(); } catch { /* abaikan */ }
    try { h.clear(); } catch { /* abaikan */ }
  }

  async switchCamera() {
    if (!this.cameras) {
      try { this.cameras = await window.Html5Qrcode.getCameras(); } catch { this.cameras = []; }
    }
    if (!this.cameras || this.cameras.length < 2) throw new Error('Hanya ada satu kamera.');
    this.camIndex = (this.camIndex + 1) % this.cameras.length;
    await this.start(this.cameras[this.camIndex].id);
    return this.cameras[this.camIndex].label || `Kamera ${this.camIndex + 1}`;
  }

  async toggleTorch() {
    const caps = this.h?.getRunningTrackCameraCapabilities?.();
    const torch = caps?.torchFeature?.();
    if (!torch || !torch.isSupported()) throw new Error('Lampu kilat tidak didukung kamera ini.');
    this.torchOn = !this.torchOn;
    await torch.apply(this.torchOn);
    return this.torchOn;
  }
}

/** Kontrol kamera siap pakai: wadah video + tombol lampu/ganti kamera. */
export function cameraPanelHTML({ hint = 'Arahkan kamera ke barcode atau QR code barang.' } = {}) {
  return `<div class="cam-frame">
      <div class="cam-view"></div>
      <div class="cam-idle">${icon('camera')}<span>Kamera mati</span></div>
      <div class="cam-tools">
        <button type="button" class="icon-btn on-dark" data-cam="torch" title="Lampu kilat" aria-label="Lampu kilat">${icon('flash')}</button>
        <button type="button" class="icon-btn on-dark" data-cam="switch" title="Ganti kamera" aria-label="Ganti kamera">${icon('swap')}</button>
      </div>
    </div>
    <p class="cam-hint">${esc(hint)}</p>
    <p class="cam-error" hidden></p>`;
}

export function wireCameraPanel(root, scanner, toastFn) {
  root.querySelector('[data-cam="torch"]')?.addEventListener('click', async (e) => {
    try { const on = await scanner.toggleTorch(); e.currentTarget?.classList?.toggle('active', on); } catch (err) { toastFn(err.message, { type: 'bad' }); }
  });
  root.querySelector('[data-cam="switch"]')?.addEventListener('click', async () => {
    try { const label = await scanner.switchCamera(); toastFn('Memakai ' + label); } catch (err) { toastFn(err.message, { type: 'bad' }); }
  });
}

/** Buka modal kamera, kembalikan kode pertama yang terbaca (atau null bila ditutup). */
export function scanOnce({ title = 'Scan barcode / QR' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    let scanner = null;
    const m = openModal({
      title, size: 'md scan-modal',
      body: cameraPanelHTML() + `<form class="scan-manual" data-manual><input class="input" placeholder="…atau ketik kode lalu Enter" autocomplete="off"><button class="btn" type="submit">OK</button></form>`,
      onClose: () => { scanner?.stop(); resolve(result); },
    });
    const frame = m.$('.cam-frame');
    scanner = new CameraScanner(m.$('.cam-view'), (code) => { result = code; beep(); m.close(); }, { cooldown: 0 });
    wireCameraPanel(m.el, scanner, (msg) => { const e = m.$('.cam-error'); e.textContent = msg; e.hidden = false; });
    m.$('[data-manual]').onsubmit = (e) => {
      e.preventDefault();
      const v = m.$('[data-manual] input').value.trim();
      if (v) { result = v; m.close(); }
    };
    scanner.start().then(() => frame.classList.add('live')).catch((err) => {
      const e = m.$('.cam-error');
      e.textContent = cameraErrorMessage(err);
      e.hidden = false;
    });
  });
}

/** Baca QR / barcode dari berkas gambar (mis. gambar QRIS dari aplikasi bank). */
export async function scanImageFile(file) {
  await loadScannerLib();
  const holder = document.createElement('div');
  holder.id = 'scanfile-' + (++seq);
  holder.style.display = 'none';
  document.body.append(holder);
  const h = new window.Html5Qrcode(holder.id, { verbose: false });
  try {
    return await h.scanFile(file, false);
  } catch {
    throw new Error('Tidak ada QR code yang terbaca di gambar itu. Pakai gambar yang lebih jelas.');
  } finally {
    try { h.clear(); } catch { /* abaikan */ }
    holder.remove();
  }
}

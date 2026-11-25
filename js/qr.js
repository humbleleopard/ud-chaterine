// Pembuat QR (SVG) — memakai encoder lokal js/qrcode.js, jadi selalu muncul walau tanpa internet.
import { qrSvg as makeSvg } from './qrcode.js';

export const loadQrLib = () => Promise.resolve();

export function qrSvgSync(text, { ecl = 'M', margin = 2, cls = 'qr' } = {}) {
  return makeSvg(text, { ecl, margin, cls });
}

export async function qrSvg(text, opts) {
  return qrSvgSync(text, opts);
}

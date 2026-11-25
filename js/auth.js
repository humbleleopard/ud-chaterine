// Kunci PIN pemilik: halaman sensitif (produk, laporan, riwayat, pengaturan) perlu PIN bila diaktifkan.
import { state } from './store.js';
import { askPin } from './dialogs.js';

const KEY = 'kasirqr-unlocked';

export const pinEnabled = () => !!state.settings.pinHash;

export function isUnlocked() {
  if (!pinEnabled()) return true;
  try { return sessionStorage.getItem(KEY) === state.settings.pinHash; } catch { return false; }
}

export function setUnlocked(on) {
  try {
    if (on) sessionStorage.setItem(KEY, state.settings.pinHash);
    else sessionStorage.removeItem(KEY);
  } catch { /* abaikan */ }
}

export async function requireUnlock(opts) {
  if (isUnlocked()) return true;
  const ok = await askPin(opts);
  if (ok) setUnlocked(true);
  return ok;
}

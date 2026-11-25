// Komponen antarmuka bersama: toast, modal, dialog, input uang, bunyi, unduh/unggah.
import { icon } from './icons.js';
import { esc, num, parseMoney } from './format.js';
import { categoryMeta } from './catalog.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const isTouch = () => matchMedia('(pointer: coarse)').matches;

/* ---------- Toast ---------- */
export function toast(msg, { type = 'info', action, actionLabel = 'Buka', duration = 3000 } = {}) {
  const box = $('#toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.setAttribute('role', type === 'bad' ? 'alert' : 'status');
  const ic = type === 'ok' ? 'check' : type === 'bad' ? 'alert' : 'sparkle';
  t.innerHTML = `${icon(ic)}<span>${esc(msg)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.className = 'toast-btn';
    b.textContent = actionLabel;
    b.onclick = () => { action(); t.remove(); };
    t.append(b);
  }
  box.append(t);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 250); }, action ? duration + 3000 : duration);
}

/* ---------- Modal (bisa bertumpuk) ---------- */
export function openModal({ title, body = '', foot = '', size = '', onClose, dismissable = true } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = `modal ${size}`;
  dlg.innerHTML = `<div class="modal-box">
    <header class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Tutup">${icon('x')}</button></header>
    <div class="modal-body">${body}</div>
    ${foot ? `<footer class="modal-foot">${foot}</footer>` : ''}
  </div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) dlg.close();
    else if (e.target === dlg && dismissable) dlg.close();
  });
  dlg.addEventListener('cancel', (e) => { if (!dismissable) e.preventDefault(); });
  // Enter di kolom isian = simpan (juga untuk formulir dengan banyak kolom)
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented) return;
    const t = e.target;
    if (t.tagName !== 'INPUT' || ['checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type)) return;
    const form = t.closest('form');
    if (!form) return;
    e.preventDefault();
    form.requestSubmit();
  });
  dlg.addEventListener('close', () => { try { onClose?.(); } finally { dlg.remove(); } });
  dlg.showModal();
  return { el: dlg, close: () => dlg.open && dlg.close(), $: (s) => dlg.querySelector(s), $$: (s) => [...dlg.querySelectorAll(s)] };
}

export const anyModalOpen = () => !!document.querySelector('dialog[open]');

export function confirmDialog(message, { title = 'Konfirmasi', ok = 'Ya, lanjutkan', danger = false } = {}) {
  return new Promise((resolve) => {
    let res = false;
    const m = openModal({
      title, size: 'sm',
      body: `<p class="confirm-text">${esc(message)}</p>`,
      foot: `<button type="button" class="btn ghost" data-close>Batal</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onClose: () => resolve(res),
    });
    m.$('[data-ok]').onclick = () => { res = true; m.close(); };
    setTimeout(() => m.$('[data-ok]').focus(), 30);
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', inputmode = 'text', type = 'text', ok = 'Simpan', money = false, hint = '' }) {
  return new Promise((resolve) => {
    let res = null;
    const m = openModal({
      title, size: 'sm',
      body: `<form data-form><label class="field"><span>${esc(label)}</span>
        <input class="input" type="${type}" inputmode="${inputmode}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" ${money ? 'data-money' : ''}></label>
        ${hint ? `<p class="hint">${esc(hint)}</p>` : ''}</form>`,
      foot: `<button type="button" class="btn ghost" data-close>Batal</button><button type="button" class="btn primary" data-ok>${esc(ok)}</button>`,
      onClose: () => resolve(res),
    });
    const input = m.$('input');
    if (money) bindMoney(input);
    const submit = () => { res = input.value; m.close(); };
    m.$('[data-ok]').onclick = submit;
    m.$('[data-form]').onsubmit = (e) => { e.preventDefault(); submit(); };
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* ---------- Input uang: tampil 15.000, nilai dibaca dengan parseMoney ---------- */
export function bindMoney(input) {
  const fmt = () => {
    const v = parseMoney(input.value);
    input.value = v ? num(v) : '';
  };
  input.addEventListener('input', fmt);
  if (input.value) fmt();
  return () => parseMoney(input.value);
}

/* ---------- Bunyi & getar saat scan ---------- */
let audioCtx;
let beepOn = true;
export const setBeep = (on) => { beepOn = on !== false; };
export function beep(ok = true) {
  if (beepOn) {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = ok ? 1760 : 196;
      const t = audioCtx.currentTime, len = ok ? 0.09 : 0.28;
      g.gain.setValueAtTime(0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(audioCtx.destination);
      o.start(t); o.stop(t + len + 0.02);
    } catch { /* tanpa suara */ }
  }
  try { navigator.vibrate?.(ok ? 35 : [70, 50, 70]); } catch { /* abaikan */ }
}

/* ---------- Berkas ---------- */
export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept;
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

export const readText = (file) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file);
});

/**
 * Siapkan foto produk: potong bujur sangkar di tengah, kecilkan ke `size` px,
 * simpan sebagai data URL WebP/JPEG (±30–70 KB) supaya ringan disimpan di perangkat.
 */
export function resizeImage(file, size = 640) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type || 'image/')) { reject(new Error('Berkas itu bukan gambar.')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
      const out = Math.min(size, side);
      const c = document.createElement('canvas');
      c.width = out; c.height = out;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, out, out);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, side, side, 0, 0, out, out);
      URL.revokeObjectURL(url);
      let data = c.toDataURL('image/webp', 0.82);
      if (!data.startsWith('data:image/webp')) data = c.toDataURL('image/jpeg', 0.85);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak bisa dibaca. Coba format JPG atau PNG.')); };
    img.src = url;
  });
}

/** Pilih gambar dari galeri, atau langsung kamera bila camera=true (di HP). */
export function pickImage({ camera = false } = {}) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (camera) inp.setAttribute('capture', 'environment');
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.click();
  });
}

/* ---------- Potongan HTML umum ---------- */
export function stockBadge(p) {
  const st = Number(p.stock) || 0;
  if (st <= 0) return `<span class="badge bad">Habis</span>`;
  if (st <= (Number(p.minStock) || 0)) return `<span class="badge warn">Sisa ${num(st)} ${esc(p.unit)}</span>`;
  return `<span class="badge ok">${num(st)} ${esc(p.unit)}</span>`;
}

/** Gambar produk, atau ilustrasi ikon kategori bila belum ada foto. */
export function thumb(p, cls = '') {
  if (p.image) return `<img class="thumb ${cls}" src="${p.image}" alt="" loading="lazy" decoding="async">`;
  const m = categoryMeta(p.category);
  return `<span class="thumb art ${cls}" style="--c:${m.color};--s:${m.soft}" aria-hidden="true">${icon(m.icon)}</span>`;
}

/** Gambar besar untuk kartu (kasir, cek harga). */
export function productArt(p, cls = '') {
  if (p.image) return `<img class="p-img ${cls}" src="${p.image}" alt="${esc(p.name)}" loading="lazy" decoding="async">`;
  const m = categoryMeta(p.category);
  return `<span class="p-img art ${cls}" style="--c:${m.color};--s:${m.soft}" aria-hidden="true">${icon(m.icon)}</span>`;
}

export function initials(name) {
  const w = String(name || '?').replace(/^(pak|bu|bapak|ibu|mas|mbak|kak)\s+/i, '').split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}

export function emptyState(ic, title, text = '', actions = '') {
  return `<div class="empty">${icon(ic)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${actions ? `<div class="empty-actions">${actions}</div>` : ''}</div>`;
}

export const METHOD_LABEL = { tunai: 'Tunai', qris: 'QRIS', transfer: 'Transfer/Debit', utang: 'Kasbon' };

/** Nomor HP Indonesia → format wa.me (62…). */
export function waNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '62' + d.slice(1);
  else if (d.startsWith('8')) d = '62' + d;
  return d.length >= 10 ? d : '';
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* lanjut cara lama */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { /* abaikan */ }
  ta.remove();
  return ok;
}

/** Fokuskan input scan saat pengguna (atau scanner USB) mengetik di luar kolom isian. */
export function autoFocusOnType(input) {
  const h = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (anyModalOpen() || !input.isConnected) return;
    input.focus();
  };
  document.addEventListener('keydown', h, true);
  return () => document.removeEventListener('keydown', h, true);
}

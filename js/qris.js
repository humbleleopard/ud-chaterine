// QRIS: ubah QRIS statis toko menjadi QRIS dinamis yang sudah berisi nominal belanja.
// Format QRIS mengikuti standar EMVCo (TLV: 2 digit tag, 2 digit panjang, nilai).

export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function parseTLV(str) {
  const out = [];
  let i = 0;
  while (i < str.length) {
    const tag = str.slice(i, i + 2);
    const len = parseInt(str.slice(i + 2, i + 4), 10);
    if (!/^\d\d$/.test(tag) || !Number.isFinite(len)) throw new Error('Format QRIS tidak dikenali.');
    const value = str.slice(i + 4, i + 4 + len);
    if (value.length !== len) throw new Error('Data QRIS terpotong.');
    out.push({ tag, value });
    i += 4 + len;
  }
  return out;
}

const buildTLV = (items) => items.map(({ tag, value }) => tag + String(value.length).padStart(2, '0') + value).join('');

/** Periksa QRIS dan ambil info penting (nama merchant, kota, statis/dinamis). */
export function inspectQris(raw) {
  const str = String(raw || '').trim();
  if (!str.startsWith('000201')) throw new Error('Ini bukan kode QRIS. Kode QRIS selalu diawali 000201.');
  const items = parseTLV(str);
  const crcItem = items[items.length - 1];
  if (!crcItem || crcItem.tag !== '63') throw new Error('Kode QRIS tidak lengkap (CRC tidak ada).');
  const body = str.slice(0, -4);
  if (crc16(body) !== crcItem.value.toUpperCase()) throw new Error('Kode QRIS rusak (CRC tidak cocok). Salin ulang kodenya.');
  const get = (t) => items.find((x) => x.tag === t)?.value || '';
  if (get('58') && get('58') !== 'ID') throw new Error('QRIS ini bukan untuk Indonesia.');
  return {
    merchant: get('59'),
    city: get('60'),
    isStatic: get('01') !== '12',
    amount: get('54') ? Number(get('54')) : 0,
  };
}

/** Sisipkan nominal (rupiah) ke QRIS statis → QRIS dinamis siap dibayar. */
export function dynamicQris(staticQris, amount) {
  const str = String(staticQris || '').trim();
  inspectQris(str);
  const value = String(Math.round(amount));
  if (!(Math.round(amount) > 0) || value.length > 13) throw new Error('Nominal QRIS tidak valid.');
  let items = parseTLV(str).filter((x) => x.tag !== '63' && x.tag !== '54');
  items = items.map((x) => (x.tag === '01' ? { tag: '01', value: '12' } : x));
  if (!items.some((x) => x.tag === '01')) items.splice(1, 0, { tag: '01', value: '12' });
  let at = items.findIndex((x) => x.tag === '53');
  at = at >= 0 ? at + 1 : Math.max(0, items.findIndex((x) => x.tag === '58'));
  items.splice(at, 0, { tag: '54', value });
  const body = buildTLV(items) + '6304';
  return body + crc16(body);
}

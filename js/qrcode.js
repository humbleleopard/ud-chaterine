// Pembuat QR Code mandiri (tanpa internet). Standar ISO/IEC 18004, mode byte (UTF-8), versi 1–20.

const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
const EC_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

// Struktur blok Reed-Solomon per versi, urutan L, M, Q, H: [jumlah, total, data, (jumlah2, total2, data2)]
const RS_BLOCKS = [
  [[1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9]],
  [[1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16]],
  [[1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13]],
  [[1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9]],
  [[1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12]],
  [[2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15]],
  [[2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14]],
  [[2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15]],
  [[2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13]],
  [[2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16]],
  [[4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13]],
  [[2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15]],
  [[4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12]],
  [[3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13]],
  [[5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13]],
  [[5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16]],
  [[1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15]],
  [[5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15]],
  [[3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14]],
  [[3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16]],
];

const ALIGN = [
  [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
];

export const MAX_VERSION = RS_BLOCKS.length;

function blocksFor(version, ecl) {
  const e = RS_BLOCKS[version - 1][EC_INDEX[ecl]];
  const out = [];
  for (let i = 0; i < e.length; i += 3) for (let k = 0; k < e[i]; k++) out.push({ total: e[i + 1], data: e[i + 2] });
  return out;
}

export function dataCapacity(version, ecl) {
  return blocksFor(version, ecl).reduce((s, b) => s + b.data, 0);
}

/* ---------- Reed-Solomon GF(256), polinom 0x11D ---------- */
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}
function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}
function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

/* ---------- Bit BCH untuk info format & versi ---------- */
const bchDigit = (d) => { let n = 0; while (d !== 0) { n++; d >>>= 1; } return n; };
function bchFormat(data) {
  const G15 = 0x537, MASK = 0x5412;
  let d = data << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
  return ((data << 10) | d) ^ MASK;
}
function bchVersion(version) {
  const G18 = 0x1f25;
  let d = version << 12;
  while (bchDigit(d) - bchDigit(G18) >= 0) d ^= G18 << (bchDigit(d) - bchDigit(G18));
  return (version << 12) | d;
}

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

/* ---------- Penyusunan data ---------- */
function encodeData(bytes, version, ecl) {
  const blocks = blocksFor(version, ecl);
  const capacity = blocks.reduce((s, b) => s + b.data, 0);
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  if (bits.length > capacity * 8) return null;
  for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < capacity; pad ^= 0xec ^ 0x11) data.push(pad);

  // bagi ke blok, hitung kode koreksi, lalu selang-seling
  let offset = 0;
  const dc = [], ec = [];
  for (const b of blocks) {
    const part = data.slice(offset, offset + b.data);
    offset += b.data;
    dc.push(part);
    ec.push(rsRemainder(part, rsDivisor(b.total - b.data)));
  }
  const out = [];
  const maxDc = Math.max(...dc.map((d) => d.length));
  for (let i = 0; i < maxDc; i++) for (const d of dc) if (i < d.length) out.push(d[i]);
  const maxEc = Math.max(...ec.map((d) => d.length));
  for (let i = 0; i < maxEc; i++) for (const d of ec) if (i < d.length) out.push(d[i]);
  return out;
}

function buildMatrix(version, ecl, codewords, mask) {
  const n = version * 4 + 17;
  const m = Array.from({ length: n }, () => new Array(n).fill(null));

  const finder = (row, col) => {
    for (let r = -1; r <= 7; r++) {
      if (row + r < 0 || row + r >= n) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c < 0 || col + c >= n) continue;
        m[row + r][col + c] = (r >= 0 && r <= 6 && (c === 0 || c === 6))
          || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
      }
    }
  };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);

  const pos = ALIGN[version - 1];
  for (const row of pos) for (const col of pos) {
    if (m[row][col] !== null) continue;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
      m[row + r][col + c] = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
    }
  }

  for (let i = 8; i < n - 8; i++) {
    if (m[i][6] === null) m[i][6] = i % 2 === 0;
    if (m[6][i] === null) m[6][i] = i % 2 === 0;
  }

  const fmt = bchFormat((EC_BITS[ecl] << 3) | mask);
  for (let i = 0; i < 15; i++) {
    const bit = ((fmt >> i) & 1) === 1;
    if (i < 6) m[i][8] = bit; else if (i < 8) m[i + 1][8] = bit; else m[n - 15 + i][8] = bit;
    if (i < 8) m[8][n - i - 1] = bit; else if (i < 9) m[8][15 - i] = bit; else m[8][14 - i] = bit;
  }
  m[n - 8][8] = true;

  if (version >= 7) {
    const v = bchVersion(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >> i) & 1) === 1;
      m[Math.floor(i / 3)][(i % 3) + n - 11] = bit;
      m[(i % 3) + n - 11][Math.floor(i / 3)] = bit;
    }
  }

  const maskFn = MASKS[mask];
  let inc = -1, row = n - 1, bitIndex = 7, byteIndex = 0;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m[row][col - c] === null) {
          let dark = byteIndex < codewords.length && ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          if (maskFn(row, col - c)) dark = !dark;
          m[row][col - c] = dark;
          if (--bitIndex === -1) { byteIndex++; bitIndex = 7; }
        }
      }
      row += inc;
      if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
    }
  }
  return m;
}

function penalty(m) {
  const n = m.length;
  let score = 0;
  // N1: deret warna sama ≥ 5
  for (let i = 0; i < n; i++) {
    for (const horiz of [true, false]) {
      let run = 1;
      for (let j = 1; j < n; j++) {
        const a = horiz ? m[i][j] : m[j][i], b = horiz ? m[i][j - 1] : m[j - 1][i];
        if (a === b) run++;
        else { if (run >= 5) score += 3 + run - 5; run = 1; }
      }
      if (run >= 5) score += 3 + run - 5;
    }
  }
  // N2: blok 2×2
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < n - 1; j++) {
    const c = m[i][j];
    if (c === m[i][j + 1] && c === m[i + 1][j] && c === m[i + 1][j + 1]) score += 3;
  }
  // N3: pola mirip finder
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < n; i++) for (let j = 0; j + 11 <= n; j++) {
    for (const P of [P1, P2]) {
      let h = true, v = true;
      for (let k = 0; k < 11; k++) {
        if (+m[i][j + k] !== P[k]) h = false;
        if (+m[j + k][i] !== P[k]) v = false;
        if (!h && !v) break;
      }
      if (h) score += 40;
      if (v) score += 40;
    }
  }
  // N4: proporsi gelap
  let dark = 0;
  for (const r of m) for (const c of r) if (c) dark++;
  score += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
  return score;
}

/**
 * Buat matriks QR. Mengembalikan { size, modules: boolean[][] , version }.
 * ecl: 'L' | 'M' | 'Q' | 'H'
 */
export function makeQR(text, { ecl = 'M', minVersion = 1, mask: forcedMask } = {}) {
  const bytes = [...new TextEncoder().encode(String(text))];
  for (let v = minVersion; v <= MAX_VERSION; v++) {
    const cw = encodeData(bytes, v, ecl);
    if (!cw) continue;
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      if (forcedMask !== undefined && mask !== forcedMask) continue;
      const m = buildMatrix(v, ecl, cw, mask);
      const s = penalty(m);
      if (s < bestScore) { best = m; bestScore = s; }
    }
    return { size: best.length, modules: best, version: v };
  }
  if (ecl !== 'L') return makeQR(text, { ecl: ecl === 'H' ? 'Q' : ecl === 'Q' ? 'M' : 'L', minVersion });
  throw new Error('Teks terlalu panjang untuk QR code.');
}

/** SVG QR (skala bebas, tajam saat dicetak). */
export function qrSvg(text, { ecl = 'M', margin = 2, cls = 'qr', label = 'QR code' } = {}) {
  const { size, modules } = makeQR(text, { ecl });
  let d = '';
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!modules[r][c]) { c++; continue; }
      let run = 1;
      while (c + run < size && modules[r][c + run]) run++;
      d += `M${c + margin} ${r + margin}h${run}v1h-${run}z`;
      c += run;
    }
  }
  const s = size + margin * 2;
  return `<svg class="${cls}" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label.replace(/"/g, '')}"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Gambar QR ke canvas 2D pada posisi & ukuran tertentu (dipakai untuk simpan PNG). */
export function drawQR(ctx, text, x, y, px, { ecl = 'M', margin = 0 } = {}) {
  const { size, modules } = makeQR(text, { ecl });
  const total = size + margin * 2;
  const cell = px / total;
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    if (modules[r][c]) ctx.fillRect(Math.floor(x + (c + margin) * cell), Math.floor(y + (r + margin) * cell), Math.ceil(cell), Math.ceil(cell));
  }
}

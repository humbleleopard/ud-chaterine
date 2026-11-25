// Katalog khusus toko pertanian: kategori, satuan, ikon & warna kategori.
export const CATEGORY_PRESETS = [
  'Insektisida', 'Fungisida', 'Herbisida', 'Pupuk', 'Pupuk Organik', 'Benih',
  'ZPT & Nutrisi', 'Sprayer & Suku Cadang', 'Alat Pertanian', 'Lainnya',
];

export const UNIT_PRESETS = [
  'botol', 'bungkus', 'sachet', 'kg', 'gram', 'liter', 'ml', 'sak', 'karung', 'jeriken',
  'kaleng', 'pcs', 'unit', 'set', 'meter', 'roll', 'pack', 'dus',
];

const RULES = [
  [/insekt|akarisid|nematis|rodent|moluskis|hama/i, { icon: 'bug', color: '#b42318', soft: '#fdebe8' }],
  [/fungi|bakteris|jamur/i, { icon: 'flask', color: '#7e3aed', soft: '#f1eafe' }],
  [/herbi|gulma|rumput/i, { icon: 'grass', color: '#b45309', soft: '#fdf1e2' }],
  [/organik|kompos|kandang|hayati/i, { icon: 'sprout', color: '#7a5a2b', soft: '#f4eee3' }],
  [/pupuk|npk|urea|\bza\b|kcl|sp-?36|tsp|dolomit|kapur/i, { icon: 'sack', color: '#2f6b3d', soft: '#e5f1e7' }],
  [/benih|bibit|biji/i, { icon: 'seed', color: '#4d7c0f', soft: '#edf5de' }],
  [/zpt|nutrisi|hormon|perekat|perata|surfaktan|vitamin|pelengkap/i, { icon: 'droplet', color: '#0e7490', soft: '#e1f3f7' }],
  [/sprayer|semprot|nozel|nozzle|tangki/i, { icon: 'spray', color: '#1d4ed8', soft: '#e7eefd' }],
  [/alat|cangkul|sabit|parang|gunting|selang|terpal|karung|mesin|perlengkapan/i, { icon: 'tool', color: '#475569', soft: '#ebeff4' }],
];
const FALLBACK = { icon: 'leaf', color: '#3f6212', soft: '#eef4e2' };

export function categoryMeta(cat) {
  for (const [re, meta] of RULES) if (re.test(cat || '')) return meta;
  return FALLBACK;
}

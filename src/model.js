// Shared constants: the grid is LAYERS × ROWS × C, row 0 = C1, one row per semitone.
export const ROWS = 84;                 // C1 … B7
export const LAYERS = 6;
export const F0 = 32.70319566;          // C1 in Hz
export const COLS_PER_BEAT = 8;
export const COLS_PER_BAR = 32;

export const rowFreq = (r) => F0 * 2 ** (r / 12);

// Colour = timbre. Order must match the worklet's layer switch.
export const LAYER_DEFS = [
  { name: 'Glass',  color: '#ff4fd8', rgb: [255, 79, 216], desc: 'pure sine · clean, glassy' },
  { name: 'Prism',  color: '#2ee6ff', rgb: [46, 230, 255], desc: 'detuned saws · bright shimmer' },
  { name: 'Bell',   color: '#b6ff3b', rgb: [182, 255, 59], desc: 'FM bell · metallic, alien' },
  { name: 'Hollow', color: '#ffa62b', rgb: [255, 166, 43], desc: 'odd harmonics · woody, hollow' },
  { name: 'Breath', color: '#9b6bff', rgb: [155, 107, 255], desc: 'noise band · wind, sizzle' },
  { name: 'Pulse',  color: '#ff4646', rgb: [255, 70, 70],  desc: 'drums · low kick, mid snare, high hat' },
];
export const HIT_LAYER = 5;

export const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const noteName = (r) => NAMES[r % 12] + (1 + Math.floor(r / 12));

export const SCALES = {
  hijaz:     { name: 'Hijaz (phrygian dom.)', steps: [0, 1, 4, 5, 7, 8, 10] },
  minpent:   { name: 'Minor pentatonic',      steps: [0, 3, 5, 7, 10] },
  dorian:    { name: 'Dorian',                steps: [0, 2, 3, 5, 7, 9, 10] },
  wholetone: { name: 'Whole tone (dreamy)',   steps: [0, 2, 4, 6, 8, 10] },
  major:     { name: 'Major',                 steps: [0, 2, 4, 5, 7, 9, 11] },
  chromatic: { name: 'Chromatic (free)',      steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const inScale = (r, root, scale) =>
  SCALES[scale].steps.includes((((r - root) % 12) + 12) % 12);

// "Dream" generator: fills the grid with a playable psychedelic loop in the current scale.
import { ROWS, SCALES, NAMES, COLS_PER_BAR, PAD_LAYER, BASS_LAYER, HIT_LAYER, chordRows } from './model.js?v=5';

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

function tools(grid, C, root, scale) {
  grid.fill(0);
  const steps = SCALES[scale].steps, n = steps.length;
  const at = (l, r, c, v) => {
    if (r < 0 || r >= ROWS || v <= 0) return;
    c = ((c % C) + C) % C;
    const i = (l * ROWS + r) * C + c;
    grid[i] = Math.max(grid[i], Math.min(1, v));
  };
  // scale degree d in octave oct (0 = C1 octave) → row
  const deg = (d, oct) => root + 12 * (oct + Math.floor(d / n)) + steps[((d % n) + n) % n];
  return { steps, n, at, deg };
}

export function dreamPattern(grid, C, root, scale, seed = 7) {
  const R = rng(seed);
  const { steps, n, at, deg } = tools(grid, C, root, scale);
  const bars = C / COLS_PER_BAR;
  const TAU = Math.PI * 2;

  // Glass drone: root + fifth, slowly breathing
  const fifth = steps.includes(7) ? root + 12 * 2 + 7 : deg(3, 2);
  for (let c = 0; c < C; c++) {
    at(0, deg(0, 1), c, 0.45 + 0.15 * Math.sin((c / C) * TAU * 2));
    at(0, fifth, c, 0.22 + 0.2 * Math.sin((c / C) * TAU + 1));
  }

  // Prism arpeggio: a random walk over the scale that spirals up and back
  const arp = [];
  let d = 0;
  for (let k = 0; k < 12; k++) { arp.push(d); d = Math.max(0, Math.min(n + 3, d + [1, 2, -1, 3, -2][Math.floor(R() * 5)])); }
  for (let k = 0; k < C / 4; k++) {
    const lift = Math.floor(k / 16) % 2 ? 2 : 0;
    const r = deg(arp[k % arp.length] + lift, 3);
    for (let j = 0; j < 3; j++) at(1, r, k * 4 + j, 0.65 - j * 0.12);
  }

  // Bell sparkles high up
  for (let k = 0; k < C / 6; k++) {
    if (R() < 0.55) {
      const c = Math.floor(R() * C), r = deg(Math.floor(R() * (n + 2)), 5);
      at(2, r, c, 0.7); at(2, r, c + 1, 0.4);
    }
  }

  // Hollow bass line, one phrase per bar
  const bass = [0, 0, Math.min(n - 1, 5), Math.min(n - 1, 3)];
  for (let b = 0; b < bars; b++) {
    const r = deg(bass[b % 4], 1), c0 = b * COLS_PER_BAR;
    for (let j = 0; j < 6; j++) at(3, r, c0 + j, 0.8);
    for (let j = 12; j < 15; j++) at(3, r, c0 + j, 0.6);
    for (let j = 20; j < 26; j++) at(3, deg(bass[b % 4] + 1, 1), c0 + j, 0.65);
  }

  // Breath: a wind band that swells across the loop
  for (let c = 0; c < C; c++) {
    for (let r = 58; r <= 68; r++) {
      const v = 0.3 * (0.5 + 0.5 * Math.sin((c / C) * TAU + r * 0.35));
      if (v > 0.14) at(4, r, c, v);
    }
  }

  // Pulse: kick on every beat, snare on 2 & 4, hats on the off-beats + random 16ths
  for (let c = 0; c < C; c += 8) at(HIT_LAYER, 7, c, 0.95);
  for (let c = 8; c < C; c += 16) at(HIT_LAYER, 31, c, 0.8);
  for (let c = 4; c < C; c += 8) at(HIT_LAYER, 74, c, 0.5);
  for (let c = 0; c < C; c += 2) if (c % 4 && R() < 0.35) at(HIT_LAYER, 76, c, 0.25);
  for (let b = 1; b < bars; b += 2) at(HIT_LAYER, 7, b * COLS_PER_BAR + 28, 0.6);
}

// "Impala": Currents-style loop — wide pad chords, a busy fuzz bass, dry syncopated drums.
export function impalaPattern(grid, C, root, scale) {
  const { at, deg } = tools(grid, C, root, scale);
  const bars = C / COLS_PER_BAR;
  const prog = [0, 3, 6, 4];

  for (let b = 0; b < bars; b++) {
    const d = prog[b % 4], c0 = b * COLS_PER_BAR;
    for (const r of chordRows(deg(d, 2), root, scale)) {
      for (let c = 0; c < 30; c++) at(PAD_LAYER, r, c0 + c, c < 2 ? 0.35 : 0.5);
    }
    // bass: [start col, length, octave up]
    for (const [c, len, up] of [[0, 5, 0], [6, 2, 0], [10, 3, 1], [16, 5, 0], [22, 2, 0], [24, 3, 0], [28, 3, 1]]) {
      for (let j = 0; j < len; j++) at(BASS_LAYER, deg(d, 1 + up), c0 + c + j, 0.85);
    }
    // glassy chord-tone hook on every second bar
    if (b % 2) {
      [[4, 4], [8, 2], [12, 6], [20, 4]].forEach(([c, k]) => {
        for (let j = 0; j < 3; j++) at(0, deg(d + k, 4), c0 + c + j, 0.45);
      });
    }
    // drums
    for (const c of [0, 14, 16]) at(HIT_LAYER, 7, c0 + c, 0.95);
    if (b % 2) at(HIT_LAYER, 7, c0 + 30, 0.5);
    for (const c of [8, 24]) at(HIT_LAYER, 31, c0 + c, 0.85);
    for (let c = 0; c < 32; c += 4) at(HIT_LAYER, 74, c0 + c, c % 8 ? 0.5 : 0.3);
  }
  // reverse-cymbal swoosh into the loop point
  for (let c = C - 10; c < C; c++) {
    for (let r = 62; r <= 72; r++) at(4, r, c, 0.05 + ((c - (C - 10)) / 10) * 0.3);
  }
}

// "Arpeggio": a hand-drawn spectrogram. One chord per bar, arpeggiated in eighths (0.43 s apart at 70 BPM).
// Every note is a sine line plus its 2f…5f harmonics as their own rows: each harmonic is fainter
// than the one below and dies away faster, so a note rings 3–5 s and thins into a soft tail.
// Sparse melody (2–3 s notes) on top, a very faint root bass, a faint 2–4 kHz hiss band.
// ARP_RECIPE is the original Am–F–C–G piece; randomArp(seed) rolls a new one.
export const ARP_BPM = 70;
const HARM = [0, 12, 19, 24, 28];           // f, 2f, 3f, 4f, 5f in semitones

export const ARP_RECIPE = {
  bpm: ARP_BPM, root: 9, scale: 'minor',
  prog: [0, 5, 2, 6],                       // i–VI–III–VII: Am F C G
  sevenths: false,
  shape: [0, 1, 2, 1, 0, 1, 2, 1],          // chord-tone index per eighth; ≥ tones wraps up an octave
  shapeName: 'up-down',
  // per bar: [col, row, hold seconds] — A4=45 C5=48 E5=52
  melody: [[[0, 52, 2.6]], [[8, 48, 2.2], [24, 45, 2.0]], [[4, 52, 2.8]], [[8, 45, 2.4]]],
};

const PROGS = {
  minor: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 6, 5, 6], [0, 5, 3, 4], [0, 2, 6, 3], [0, 3, 0, 4], [0, 5, 0, 6]],
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [5, 3, 0, 4], [3, 4, 2, 5], [0, 3, 5, 4], [0, 2, 3, 4]],
};
const SHAPES = {
  'up-down': [0, 1, 2, 1, 0, 1, 2, 1],
  'up': [0, 1, 2, 0, 1, 2, 0, 1],
  'rolling': [0, 1, 2, 3, 2, 1, 2, 3],
  'alberti': [0, 2, 1, 2, 0, 2, 1, 2],
  'falling': [3, 2, 1, 2, 3, 2, 1, 0],
  'wide': [0, 2, 4, 2, 1, 3, 5, 3],
};

// chord on scale degree d: rows of root, third, fifth (and seventh), root placed in F3…E4
function chordAt(spec, d) {
  const steps = SCALES[spec.scale].steps, n = steps.length;
  const pc = (k) => (spec.root + steps[(d + k) % n]) % 12;
  const root = 29 + ((pc(0) - 29 % 12 + 12) % 12);
  const ks = spec.sevenths ? [0, 2, 4, 6] : [0, 2, 4];
  return ks.map((k) => root + ((pc(k) - pc(0) + 12) % 12));
}

export function chordName(rows) {
  const third = rows[1] - rows[0], fifth = rows[2] - rows[0];
  const q = fifth === 6 ? 'dim' : third === 3 ? 'm' : '';
  const sev = rows[3] === undefined ? '' : rows[3] - rows[0] === 11 ? 'maj7' : '7';
  return NAMES[rows[0] % 12] + (q === 'm' && sev === 'maj7' ? 'm(maj7)' : q + sev);
}

export function arpName(spec) {
  const chords = spec.prog.map((d) => chordName(chordAt(spec, d))).join('–');
  return `${NAMES[spec.root]} ${spec.scale} · ${chords} · ${spec.shapeName} · ${spec.bpm} BPM`;
}

export function randomArp(seed) {
  const R = rng(seed);
  const pick = (a) => a[Math.floor(R() * a.length)];
  const scale = R() < 0.6 ? 'minor' : 'major';
  const shapeName = pick(Object.keys(SHAPES));
  return {
    bpm: 62 + Math.floor(R() * 19), root: Math.floor(R() * 12), scale,
    prog: pick(PROGS[scale]), sevenths: R() < 0.3,
    shape: SHAPES[shapeName], shapeName, seed,
  };
}

// One note on the Glass layer: row r and its harmonics from column c0. `at` writes a cell (max-merge).
// hold: seconds at a slowly drooping full level, fade: seconds for the fundamental to die out.
export function harmonicNote(at, C, cps, r, c0, amp, fade, hold = 0) {
  const tau = fade / 3.5;                   // ≈ −30 dB after `fade` seconds
  for (let k = 1; k <= 5; k++) {
    const a = amp * k ** -1.2, p = k ** 0.7;     // fainter and faster-dying per harmonic
    for (let j = 0; j < C; j++) {
      const t = j / cps;
      const g = t < hold ? 1 - 0.3 * (t / hold) : (hold ? 0.7 : 1) * Math.exp(-(t - hold) / tau);
      const v = a * g ** p;
      if (v < 0.012) break;
      at(0, r + HARM[k - 1], c0 + j, v);
    }
  }
}

export function arpPattern(grid, C, spec = ARP_RECIPE) {
  const { at } = tools(grid, C, spec.root, spec.scale);
  const cps = (spec.bpm / 60) * 8;          // columns per second
  const bars = C / COLS_PER_BAR;
  const note = (r, c0, amp, fade, hold) => harmonicNote(at, C, cps, r, c0, amp, fade, hold);
  const R = rng(spec.seed || 1);

  for (let b = 0; b < bars; b++) {
    const i = b % spec.prog.length, c0 = b * COLS_PER_BAR;
    const tones = chordAt(spec, spec.prog[i]), n = tones.length;
    spec.shape.forEach((k, e) => {
      const r = tones[k % n] + 12 * Math.floor(k / n);
      note(r, c0 + e * 4, e === 0 ? 0.8 : 0.68, 3.2 + ((e * 7 + i * 3) % 5) * 0.35);
    });

    // melody: 1–2 long notes per bar on chord tones between G♯4 and G♯5
    let mel = spec.melody && spec.melody[b % spec.melody.length];
    if (!mel) {
      const high = [];
      for (let r = 44; r <= 56; r++) if (tones.some((t) => (r - t) % 12 === 0)) high.push(r);
      const pickRow = () => high[Math.floor(R() * high.length)];
      mel = [[[0, 4, 8][Math.floor(R() * 3)], pickRow(), 2 + R() * 0.8]];
      if (R() < 0.5) mel.push([[16, 20, 24][Math.floor(R() * 3)], pickRow(), 2 + R() * 0.6]);
    }
    for (const [c, r, hold] of mel) note(r, c0 + c, 0.95, 3.5, hold);

    // bass: plain sine an octave under the chord root, very faint, fading out under the next bar
    for (let j = 0; j < 44; j++) at(0, tones[0] - 12, c0 + j, j < 32 ? 0.24 - 0.004 * j : 0.11 * Math.exp(-(j - 32) / 5));
  }

  // hiss: a very faint, steady band from C7 (2.1 kHz) to the top of the grid
  for (let c = 0; c < C; c++) {
    for (let r = 72; r < ROWS; r++) at(4, r, c, 0.05 + 0.015 * Math.sin(c * 0.37 + r * 1.3));
  }
}

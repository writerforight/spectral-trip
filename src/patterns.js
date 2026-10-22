// "Dream" generator: fills the grid with a playable psychedelic loop in the current scale.
import { ROWS, SCALES, COLS_PER_BAR, PAD_LAYER, BASS_LAYER, HIT_LAYER, chordRows } from './model.js';

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

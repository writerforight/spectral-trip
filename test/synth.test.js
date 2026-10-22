// Headless check of the synth: mock the AudioWorklet globals, render the Dream loop.
import { readFileSync } from 'node:fs';
import { dreamPattern, impalaPattern, arpPattern, harmonicNote, ARP_BPM } from '../src/patterns.js';
import { ROWS, LAYERS, COLS_PER_BAR, HIT_LAYER, chordRows, rowFreq } from '../src/model.js';

let Proc;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
globalThis.registerProcessor = (_n, cls) => { Proc = cls; };
new Function(readFileSync(new URL('../src/synth-worklet.js', import.meta.url), 'utf8'))();

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };

function render(grid, C, seconds, opts = {}) {
  const p = new Proc({ processorOptions: { grid, C, bpm: 112, playing: true, ...opts } });
  const n = Math.ceil((seconds * sampleRate) / 128);
  const L = new Float32Array(n * 128), R = new Float32Array(n * 128), P = new Float32Array(n * 128);
  for (let b = 0; b < n; b++) {
    const l = new Float32Array(128), r = new Float32Array(128);
    const dl = new Float32Array(128), dr = new Float32Array(128), pp = new Float32Array(128);
    p.process([], [[l, r], [dl, dr], [pp]]);
    for (let k = 0; k < 128; k++) { l[k] += dl[k]; r[k] += dr[k]; }
    L.set(l, b * 128); R.set(r, b * 128); P.set(pp, b * 128);
  }
  return { L, R, P, p };
}
const stats = (x) => { let pk = 0, s = 0, bad = 0; for (const v of x) { if (!Number.isFinite(v)) bad++; pk = Math.max(pk, Math.abs(v)); s += v * v; } return { pk, rms: Math.sqrt(s / x.length), bad }; };

const C = 4 * COLS_PER_BAR;
const grid = new Float32Array(LAYERS * ROWS * C);
dreamPattern(grid, C, 2, 'hijaz', 7);
check(grid.some((v) => v > 0), 'dream pattern fills the grid');

const t0 = performance.now();
const { L, R } = render(grid, C, 8.6);
const ms = performance.now() - t0;
const sl = stats(L), sr = stats(R);
check(sl.bad === 0 && sr.bad === 0, 'no NaN/Inf');
check(sl.rms > 0.02, `audible (rms ${sl.rms.toFixed(3)})`);
check(sl.pk < 1.5, `pre-compressor peak sane (${sl.pk.toFixed(2)})`);
check(ms < 8600 * 0.5, `faster than realtime/2 (${ms.toFixed(0)} ms for 8.6 s)`);

// each layer alone makes sound, and silence stays silent
for (let l = 0; l < LAYERS; l++) {
  const g = new Float32Array(LAYERS * ROWS * C);
  for (let c = 0; c < C; c += l === HIT_LAYER ? 8 : 1) g[(l * ROWS + 40) * C + c] = 0.8;
  const s = stats(render(g, C, 1).L);
  check(s.rms > 0.005 && s.bad === 0, `layer ${l} sounds (rms ${s.rms.toFixed(4)}, peak ${s.pk.toFixed(2)})`);
}
check(stats(render(new Float32Array(LAYERS * ROWS * C), C, 1).L).pk === 0, 'empty grid is silent');

// Impala preset: in tune, loud enough, and the kick pumps the sidechain
const imp = new Float32Array(LAYERS * ROWS * C);
impalaPattern(imp, C, 9, 'dorian');
const ri = render(imp, C, 4, { pump: 0.65, bpm: 96 });
const si = stats(ri.L);
check(si.bad === 0 && si.rms > 0.02, `impala loop sounds (rms ${si.rms.toFixed(3)})`);
const pmin = ri.P.reduce((a, b) => Math.min(a, b)), pmax = ri.P.reduce((a, b) => Math.max(a, b));
check(pmin < 0.6 && pmax > 0.99, `pump dips on kicks (${pmin.toFixed(2)}..${pmax.toFixed(2)})`);
check(render(imp, C, 1, { pump: 0 }).P.every((v) => v === 1), 'pump 0 = flat gain');

// Arpeggio preset: harmonics fainter and shorter-lived the higher they go, nothing below 60 Hz
const arp = new Float32Array(LAYERS * ROWS * C);
arpPattern(arp, C);
// a lone note: f, 2f … 5f each fainter and shorter than the one below, the fundamental rings 3–5 s
const one = new Float32Array(ROWS * C);
harmonicNote((_l, r, c, v) => { one[r * C + c] = v; }, C, (ARP_BPM / 60) * 8, 33, 0, 0.6, 4);
const harm = [0, 12, 19, 24, 28];
const peaks = harm.map((h) => one[(33 + h) * C]);
const lives = harm.map((h) => one.subarray((33 + h) * C, (34 + h) * C).filter((v) => v > 0).length);
check(peaks.every((v, k) => k === 0 || v < peaks[k - 1]), `harmonics get fainter (${peaks.map((v) => v.toFixed(2)).join(' ')})`);
check(lives.every((v, k) => k === 0 || v < lives[k - 1]), `upper harmonics die sooner (${lives.join(' ')} cols)`);
const ring = lives[0] / ((ARP_BPM / 60) * 8);
check(ring >= 3 && ring <= 5, `fundamental rings ${ring.toFixed(1)} s`);
let low = 0;
for (let l = 0; l < LAYERS; l++) for (let r = 0; r < ROWS; r++) if (rowFreq(r) < 60) for (let c = 0; c < C; c++) low += arp[(l * ROWS + r) * C + c];
check(low === 0, 'arp: nothing below 60 Hz');
const sa = stats(render(arp, C, 6, { bpm: ARP_BPM, smear: 0.6 }).L);
check(sa.bad === 0 && sa.rms > 0.01 && sa.pk < 1.5, `arp loop sounds (rms ${sa.rms.toFixed(3)}, peak ${sa.pk.toFixed(2)})`);

// chords: A dorian on A3 → A C E G; chromatic → minor 7th
check(JSON.stringify(chordRows(33, 9, 'dorian')) === JSON.stringify([33, 36, 40, 43]), 'Am7 in A dorian');
check(JSON.stringify(chordRows(38, 9, 'dorian')) === JSON.stringify([38, 42, 45, 48]), 'D7 (IV) in A dorian');
check(JSON.stringify(chordRows(30, 0, 'chromatic')) === JSON.stringify([30, 33, 37, 40]), 'chromatic → m7');

// loops option stops playback
const { p } = render(grid, C, (C / 8) * (60 / 112) * 2 + 0.3, { loops: 2 });
check(p.playing === false, 'loops:2 stops after two passes');

// worst case: everything painted at full
const full = new Float32Array(LAYERS * ROWS * C).fill(1);
const t1 = performance.now();
const sf = stats(render(full, C, 1).L);
console.log(`     full grid: ${(performance.now() - t1).toFixed(0)} ms per 1 s audio, peak ${sf.pk.toFixed(2)}`);
check(sf.bad === 0, 'full grid finite');

console.log(fails ? `${fails} failing` : 'all passed');
process.exit(fails ? 1 : 0);

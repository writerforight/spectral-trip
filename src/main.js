import {
  ROWS, LAYERS, F0, COLS_PER_BEAT, COLS_PER_BAR, HIT_LAYER,
  LAYER_DEFS, NAMES, SCALES, noteName, inScale, chordRows, PAD_LAYER,
} from './model.js';
import { buildFX } from './fx.js';
import { dreamPattern, impalaPattern, arpPattern, ARP_BPM } from './patterns.js';
import { encodeWav } from './wav.js';

const $ = (id) => document.getElementById(id);
const WORKLET_URL = new URL('./synth-worklet.js', import.meta.url);
const STORE = 'spectral-trip-v1';

const S = {
  bars: 4,
  C: 4 * COLS_PER_BAR,
  bpm: 112,
  grid: null,
  layer: 1,
  eraser: false,
  shape: 'dot',
  size: 1,
  intensity: 0.8,
  mirrorX: false,
  mirrorY: false,
  repeat: 0,
  root: 2,
  scale: 'hijaz',
  snap: true,
  playing: false,
  fx: { smear: 0.2, swirl: 0.35, trip: 0.4, echo: 0.3, space: 0.45, pump: 0.35, wobble: 0.25, sweep: 0, volume: 0.8 },
};
S.grid = new Float32Array(LAYERS * ROWS * S.C);

const idx = (l, r, c) => (l * ROWS + r) * S.C + c;

// ---------------------------------------------------------------- persistence
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}
function save() {
  try {
    const q = new Uint8Array(S.grid.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(S.grid[i] * 255);
    let bin = '';
    for (let i = 0; i < q.length; i += 0x8000) bin += String.fromCharCode.apply(null, q.subarray(i, i + 0x8000));
    const { grid, playing, eraser, ...rest } = S;
    localStorage.setItem(STORE, JSON.stringify({ v: 2, ...rest, g: btoa(bin) }));
  } catch { /* storage unavailable: fine */ }
}
function load() {
  try {
    const j = JSON.parse(localStorage.getItem(STORE));
    if (!j || (j.v !== 1 && j.v !== 2)) return false;
    const bin = atob(j.g);
    const C = j.bars * COLS_PER_BAR;
    // v1 had 6 layers with the drums at index 5
    const map = j.v === 1 ? [0, 1, 2, 3, 4, HIT_LAYER] : null;
    const oldL = map ? map.length : LAYERS;
    if (bin.length !== oldL * ROWS * C) return false;
    if (map && j.layer !== undefined) j.layer = map[j.layer];
    for (const k of ['bars', 'bpm', 'layer', 'shape', 'size', 'intensity', 'mirrorX', 'mirrorY', 'repeat', 'root', 'scale', 'snap']) {
      if (j[k] !== undefined) S[k] = j[k];
    }
    if (!SCALES[S.scale]) S.scale = 'hijaz';
    Object.assign(S.fx, j.fx || {});
    S.C = C;
    S.grid = new Float32Array(LAYERS * ROWS * C);
    const plane = ROWS * C;
    for (let l = 0; l < oldL; l++) {
      const nl = map ? map[l] : l;
      for (let k = 0; k < plane; k++) S.grid[nl * plane + k] = bin.charCodeAt(l * plane + k) / 255;
    }
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- undo
const undoStack = [];
function pushUndo() {
  undoStack.push({ grid: S.grid.slice(), bars: S.bars });
  if (undoStack.length > 40) undoStack.shift();
}
function undo() {
  const u = undoStack.pop();
  if (!u) return;
  S.grid = u.grid;
  if (u.bars !== S.bars) { S.bars = u.bars; S.C = u.bars * COLS_PER_BAR; $('bars').value = S.bars; resizeSource(); }
  changed();
}

// ---------------------------------------------------------------- painting
function snapRow(r) {
  r = Math.max(0, Math.min(ROWS - 1, r));
  if (!S.snap) return r;
  for (let d = 0; d < 12; d++) {
    if (r - d >= 0 && inScale(r - d, S.root, S.scale)) return r - d;
    if (r + d < ROWS && inScale(r + d, S.root, S.scale)) return r + d;
  }
  return r;
}

let erasing = false;

function putCell(c, r, v) {
  if (r < 0 || r >= ROWS) return;
  c = ((c % S.C) + S.C) % S.C;
  if (erasing) {
    for (let l = 0; l < LAYERS; l++) {
      const i = idx(l, r, c);
      S.grid[i] = Math.max(0, S.grid[i] - v * 1.5);
    }
    return;
  }
  // Breath is noise: it may live between scale rows
  const rr = S.layer === 4 ? r : snapRow(r);
  const i = idx(S.layer, rr, c);
  S.grid[i] = Math.max(S.grid[i], v);
}

// one stamp, fanned out by symmetry + repeat
function stamp(c, r, v) {
  const cols = [c];
  if (S.mirrorX) cols.push(S.C - 1 - c);
  const rows = [r];
  if (S.mirrorY) rows.push(ROWS - 1 - r);
  const reps = S.repeat ? S.C / S.repeat : 1;
  for (const cc of cols) for (const rr of rows) for (let k = 0; k < reps; k++) putCell(cc + k * S.repeat, rr, v);
}

function dab(cx, cy, strength = 1) {
  const rad = S.size;
  const v = S.intensity * strength;
  if (S.layer === HIT_LAYER && !erasing) {
    // drums: one hit per 16th, never a smear
    const c = Math.round(cx / 2) * 2;
    const rr = Math.floor(rad / 2);
    for (let dr = -rr; dr <= rr; dr++) stamp(c, Math.round(cy) + dr, v * (1 - Math.abs(dr) / (rr + 1)));
    return;
  }
  const R = Math.ceil(rad);
  if (S.shape === 'chord' && !erasing) {
    // size = length in time; the chord is stacked in thirds inside the scale
    const rows = chordRows(snapRow(Math.round(cy)), S.root, S.snap ? S.scale : 'chromatic');
    for (let dc = -R; dc <= R; dc++) for (const r of rows) stamp(Math.round(cx) + dc, r, v);
    return;
  }
  for (let dc = -R; dc <= R; dc++) {
    for (let dr = -R; dr <= R; dr++) {
      const d = Math.hypot(dc, dr) / (rad + 0.5);
      if (d > 1) continue;
      stamp(Math.round(cx) + dc, Math.round(cy) + dr, v * (1 - 0.6 * d * d));
    }
  }
}

function spray(p) {
  const n = 3 + S.size * 2, R = 1 + S.size * 1.6;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R;
    const c = p.c + Math.cos(a) * d, r = p.r + Math.sin(a) * d;
    stamp(Math.round(c), Math.round(r), S.intensity * (0.3 + 0.7 * Math.random()));
  }
}

let waveOrigin = 0;
function segment(a, b) {
  const steps = Math.ceil(Math.max(Math.abs(b.c - a.c), Math.abs(b.r - a.r)) * 1.5) + 1;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const c = a.c + (b.c - a.c) * t, r = a.r + (b.r - a.r) * t;
    if (S.shape === 'wave') {
      const A = 1 + S.size * 1.1;
      dab(c, r + A * Math.sin(((c - waveOrigin) / COLS_PER_BEAT) * Math.PI * 2));
    } else {
      dab(c, r);
    }
  }
}

// ---------------------------------------------------------------- canvases
const gridCan = $('grid'), keysCan = $('keys'), mirCan = $('mirror');
const g = gridCan.getContext('2d');
const kctx = keysCan.getContext('2d');
const mctx = mirCan.getContext('2d');
let src = document.createElement('canvas');
let sctx, img;
const glowCan = document.createElement('canvas');
const glctx = glowCan.getContext('2d');
let W = 800, H = 500, dpr = 1, KW = 44, MW = 120;
let imgDirty = true, audioDirty = true;

function resizeSource() {
  src.width = S.C; src.height = ROWS;
  sctx = src.getContext('2d');
  img = sctx.createImageData(S.C, ROWS);
}

function layout() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const wrap = $('wrap');
  const total = wrap.clientWidth;
  MW = total > 760 ? 120 : 0;
  KW = total > 500 ? 44 : 30;
  W = Math.max(200, total - KW - MW - (MW ? 1 : 0) - 1);
  const ideal = window.innerWidth > 900 ? window.innerHeight - 260 : ROWS * 5.5;
  H = Math.round(Math.max(ROWS * 4.5, Math.min(ROWS * 9, ideal)));
  for (const [cv, w] of [[gridCan, W], [keysCan, KW], [mirCan, MW]]) {
    cv.style.width = w + 'px';
    cv.style.height = H + 'px';
    cv.width = Math.max(1, Math.round(w * dpr));
    cv.height = Math.round(H * dpr);
  }
  mirCan.parentElement.style.display = MW ? '' : 'none';
  glowCan.width = gridCan.width; glowCan.height = gridCan.height;
  imgDirty = true;
  drawKeys();
}

function rebuildImage() {
  const d = img.data;
  d.fill(0);
  const C = S.C;
  for (let l = 0; l < LAYERS; l++) {
    const [cr, cg, cb] = LAYER_DEFS[l].rgb;
    for (let r = 0; r < ROWS; r++) {
      const base = (l * ROWS + r) * C, y = ROWS - 1 - r;
      for (let c = 0; c < C; c++) {
        const v = S.grid[base + c];
        if (v <= 0) continue;
        const p = (y * C + c) * 4;
        d[p] += cr * v; d[p + 1] += cg * v; d[p + 2] += cb * v;
        d[p + 3] = 255;
      }
    }
  }
  sctx.putImageData(img, 0, 0);
  glctx.setTransform(1, 0, 0, 1, 0, 0);
  glctx.clearRect(0, 0, glowCan.width, glowCan.height);
  glctx.filter = `blur(${Math.max(4, (H / ROWS) * 1.4 * dpr)}px)`;
  glctx.imageSmoothingEnabled = true;
  glctx.drawImage(src, 0, 0, glowCan.width, glowCan.height);
  glctx.filter = 'none';
}

function drawKeys() {
  const ch = H / ROWS;
  kctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  kctx.clearRect(0, 0, KW, H);
  kctx.font = `${Math.min(11, ch * 1.6)}px 'Space Grotesk', sans-serif`;
  kctx.textBaseline = 'middle';
  for (let r = 0; r < ROWS; r++) {
    const y = (ROWS - 1 - r) * ch;
    const black = NAMES[r % 12].includes('♯');
    kctx.fillStyle = black ? '#0b0712' : '#1a1328';
    kctx.fillRect(0, y, KW, ch);
    if (inScale(r, S.root, S.scale)) {
      const isRoot = (r - S.root) % 12 === 0;
      kctx.fillStyle = isRoot ? '#ff4fd8' : 'rgba(46,230,255,0.7)';
      kctx.fillRect(KW - 4, y + 0.5, 3, Math.max(1, ch - 1));
    }
    if (r % 12 === 0) {
      kctx.fillStyle = '#efe9ff';
      kctx.fillText(noteName(r), 4, y + ch / 2);
    }
  }
}

// playhead position, interpolated between worklet reports
let playPos = 0, playStamp = 0;
function currentPos(now) {
  if (!S.playing) return playPos;
  const cps = (S.bpm / 60) * COLS_PER_BEAT;
  return (((playPos + ((now - playStamp) / 1000) * cps) % S.C) + S.C) % S.C;
}

let hover = null, preview = null, level = 0;

function drawGrid(now) {
  const cw = W / S.C, ch = H / ROWS;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = '#06030b';
  g.fillRect(0, 0, W, H);

  // breathing colour field behind everything, pumped by the output level
  const t = now / 1000;
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 3; k++) {
    const x = W * (0.5 + 0.38 * Math.sin(t * 0.13 * (k + 1) + k * 2));
    const y = H * (0.5 + 0.35 * Math.cos(t * 0.11 * (k + 1.3) + k));
    const rad = Math.max(W, H) * (0.35 + 0.1 * Math.sin(t * 0.5 + k));
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const hue = (t * 12 + k * 120) % 360;
    grad.addColorStop(0, `hsla(${hue},100%,60%,${0.05 + level * 0.18})`);
    grad.addColorStop(1, 'hsla(0,0%,0%,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';

  for (let r = 0; r < ROWS; r++) {
    if (!inScale(r, S.root, S.scale)) continue;
    const isRoot = (r - S.root) % 12 === 0;
    g.fillStyle = isRoot ? 'rgba(255,79,216,0.07)' : 'rgba(255,255,255,0.03)';
    g.fillRect(0, (ROWS - 1 - r) * ch, W, ch);
  }
  for (let c = 0; c <= S.C; c += COLS_PER_BEAT / 2) {
    g.fillStyle = c % COLS_PER_BAR === 0 ? 'rgba(255,255,255,0.2)'
      : c % COLS_PER_BEAT === 0 ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
    g.fillRect(Math.round(c * cw), 0, 1, H);
  }

  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = 0.9;
  g.drawImage(glowCan, 0, 0, W, H);
  g.globalAlpha = 1;
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0, W, H);

  if (S.playing) {
    const pos = currentPos(now), col = Math.floor(pos);
    g.drawImage(src, col, 0, 1, ROWS, col * cw, 0, cw, H);
    g.drawImage(src, col, 0, 1, ROWS, col * cw, 0, cw, H);
    const x = pos * cw;
    const lg = g.createLinearGradient(x - 24, 0, x + 2, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = lg;
    g.fillRect(x - 24, 0, 26, H);
    g.fillStyle = '#fff';
    g.fillRect(x, 0, 1.5, H);
  }
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = true;

  const col = erasing || S.eraser ? '#ffffff' : LAYER_DEFS[S.layer].color;
  if (preview) {
    g.strokeStyle = col; g.lineWidth = Math.max(2, (S.size * 2 + 1) * ch); g.globalAlpha = 0.45; g.lineCap = 'round';
    g.beginPath();
    g.moveTo((preview[0].c + 0.5) * cw, (ROWS - 0.5 - preview[0].r) * ch);
    g.lineTo((preview[1].c + 0.5) * cw, (ROWS - 0.5 - preview[1].r) * ch);
    g.stroke();
    g.globalAlpha = 1;
  }
  if (hover) {
    g.strokeStyle = col; g.lineWidth = 1.5; g.globalAlpha = 0.8;
    g.beginPath();
    g.ellipse((hover.c + 0.5) * cw, (ROWS - 0.5 - hover.r) * ch, (S.size + 0.5) * cw, (S.size + 0.5) * ch, 0, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
  }
}

const freqBuf = new Uint8Array(4096);
function drawMirror(now) {
  if (!MW) return;
  const w = mirCan.width, h = mirCan.height;
  if (!analyser) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.fillStyle = '#06030b';
    mctx.fillRect(0, 0, w, h);
    return;
  }
  analyser.getByteFrequencyData(freqBuf);
  const bins = analyser.frequencyBinCount, nyq = actx.sampleRate / 2;
  const step = Math.max(1, Math.round(2 * dpr));
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.globalCompositeOperation = 'copy';
  mctx.drawImage(mirCan, -step, 0);
  mctx.globalCompositeOperation = 'source-over';
  mctx.fillStyle = '#06030b';
  mctx.fillRect(w - step, 0, step, h);
  let sum = 0;
  const hue0 = (now / 40) % 360;
  for (let y = 0; y < h; y += 2) {
    const rowf = ((h - y) / h) * ROWS - 0.5;
    const f = F0 * 2 ** (rowf / 12);
    const b = (f / nyq) * bins, b0 = Math.floor(b);
    if (b0 + 1 >= bins) continue;
    const v = (freqBuf[b0] + (freqBuf[b0 + 1] - freqBuf[b0]) * (b - b0)) / 255;
    sum += v;
    if (v < 0.25) continue;
    const e = (v - 0.25) / 0.75;
    mctx.fillStyle = `hsla(${(hue0 + rowf * 5) % 360},100%,${20 + e * 50}%,${e})`;
    mctx.fillRect(w - step, y, step, 2);
  }
  level += (Math.min(1, (sum / (h / 2)) * 3) - level) * 0.1;
}

function frame(now) {
  if (imgDirty) { rebuildImage(); imgDirty = false; }
  if (audioDirty && node) {
    node.port.postMessage({ type: 'grid', grid: S.grid.slice(), C: S.C });
    audioDirty = false;
  }
  drawGrid(now);
  drawMirror(now);
  requestAnimationFrame(frame);
}

function changed() {
  imgDirty = true;
  audioDirty = true;
  scheduleSave();
}

// ---------------------------------------------------------------- pointer
function cellAt(e) {
  const rect = gridCan.getBoundingClientRect();
  return {
    c: ((e.clientX - rect.left) / rect.width) * S.C - 0.5,
    r: (1 - (e.clientY - rect.top) / rect.height) * ROWS - 0.5,
  };
}
let drawing = false, last = null, start = null;

gridCan.addEventListener('contextmenu', (e) => e.preventDefault());
gridCan.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { gridCan.setPointerCapture(e.pointerId); } catch { /* synthetic or already-ended pointer */ }
  pushUndo();
  erasing = S.eraser || e.button === 2;
  const p = cellAt(e);
  drawing = true; last = p; start = p; waveOrigin = p.c;
  if (S.shape === 'line') preview = [p, p];
  else if (S.shape === 'spray') spray(p);
  else segment(p, p);
  changed();
});
gridCan.addEventListener('pointermove', (e) => {
  const p = cellAt(e);
  hover = { c: Math.round(p.c), r: Math.round(p.r) };
  showHover(hover);
  if (!drawing) return;
  if (S.shape === 'line') preview[1] = p;
  else if (S.shape === 'spray') spray(p);
  else segment(last, p);
  last = p;
  if (S.shape !== 'line') changed();
});
function endStroke(e) {
  if (!drawing) return;
  if (S.shape === 'line' && preview) { segment(start, cellAt(e)); changed(); }
  preview = null; drawing = false; erasing = false;
}
gridCan.addEventListener('pointerup', endStroke);
gridCan.addEventListener('pointercancel', endStroke);
gridCan.addEventListener('pointerleave', () => { if (!drawing) hover = null; });

function showHover(h) {
  if (h.r < 0 || h.r >= ROWS || h.c < 0 || h.c >= S.C) return;
  const bar = Math.floor(h.c / COLS_PER_BAR) + 1;
  const beat = Math.floor((h.c % COLS_PER_BAR) / COLS_PER_BEAT) + 1;
  const sub = (h.c % COLS_PER_BEAT) + 1;
  const f = F0 * 2 ** (h.r / 12);
  $('hover').textContent = `${noteName(h.r)} · ${f.toFixed(1)} Hz · bar ${bar} beat ${beat}.${sub}`;
}

// ---------------------------------------------------------------- audio
let actx = null, node = null, fx = null, analyser = null, audioInit = null;

function fxParams() { return { ...S.fx, bpm: S.bpm }; }

function makeSynth(ctx, extra) {
  return new AudioWorkletNode(ctx, 'spectral-synth', {
    numberOfInputs: 0,
    numberOfOutputs: 3,
    outputChannelCount: [2, 2, 1],
    processorOptions: {
      grid: S.grid.slice(), C: S.C, bpm: S.bpm,
      smear: S.fx.smear, swirl: S.fx.swirl, pump: S.fx.pump, ...extra,
    },
  });
}
function wire(n, f, ctx) {
  n.connect(f.input, 0);
  n.connect(f.drums, 1);
  n.connect(f.pump, 2);
  f.output.connect(ctx.destination);
}

function initAudio() {
  if (audioInit) return audioInit;
  audioInit = (async () => {
    await actx.audioWorklet.addModule(WORKLET_URL);
    node = makeSynth(actx, {});
    fx = buildFX(actx);
    fx.set(fxParams(), true);
    wire(node, fx, actx);
    analyser = fx.analyser;
    node.port.onmessage = (e) => {
      if (e.data.pos === undefined) return;
      playPos = e.data.pos;
      playStamp = performance.now();
    };
  })();
  return audioInit;
}

function sendParams() {
  if (node) node.port.postMessage({ type: 'params', bpm: S.bpm, smear: S.fx.smear, swirl: S.fx.swirl, pump: S.fx.pump });
  if (fx) fx.set(fxParams());
  scheduleSave();
}

async function togglePlay() {
  // iOS Safari only unlocks audio inside the tap itself: create + resume before any await
  if (!actx) {
    // play through the ringer/silent switch on iPhone
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  }
  const resumed = actx.state === 'suspended' ? actx.resume() : null;
  try {
    await initAudio();
  } catch (err) {
    $('hover').textContent = 'Audio could not start in this browser: ' + err.message;
    return;
  }
  if (resumed) await resumed;
  S.playing = !S.playing;
  node.port.postMessage({ type: S.playing ? 'play' : 'stop', pos: 0 });
  playPos = 0; playStamp = performance.now();
  $('play').textContent = S.playing ? '■ Stop' : '▶ Play';
  $('play').classList.toggle('on', S.playing);
}

async function exportWav() {
  const btn = $('wav');
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    const sr = 44100;
    const loopSec = (S.C / COLS_PER_BEAT) * (60 / S.bpm);
    const oc = new OfflineAudioContext(2, Math.ceil(sr * (loopSec * 2 + 3)), sr);
    await oc.audioWorklet.addModule(WORKLET_URL);
    const n = makeSynth(oc, { playing: true, loops: 2 });
    const f = buildFX(oc);
    f.set(fxParams(), true);
    wire(n, f, oc);
    const buf = await oc.startRendering();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(encodeWav(buf));
    a.download = `spectral-trip-${S.bpm}bpm.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch (err) {
    $('hover').textContent = 'Export failed: ' + err.message;
  }
  btn.disabled = false;
  btn.textContent = '⤓ WAV';
}

// ---------------------------------------------------------------- controls
function buildUI() {
  const pal = $('palette');
  LAYER_DEFS.forEach((L, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.setProperty('--c', L.color);
    b.innerHTML = `<span class="dot"></span><span><span class="nm">${L.name}</span><span class="ds">${L.desc}</span></span><kbd>${i + 1}</kbd>`;
    b.addEventListener('click', () => selectLayer(i));
    pal.appendChild(b);
  });
  selectLayer(S.layer);

  $('eraser').addEventListener('click', () => setEraser(!S.eraser));

  for (const b of $('shapes').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.shape === S.shape);
    b.addEventListener('click', () => {
      S.shape = b.dataset.shape;
      for (const o of $('shapes').querySelectorAll('button')) o.classList.toggle('on', o === b);
      scheduleSave();
    });
  }

  const bindRange = (id, key) => {
    const el = $(id), out = el.nextElementSibling;
    el.value = S[key];
    out.textContent = el.value;
    el.addEventListener('input', () => { S[key] = +el.value; out.textContent = el.value; scheduleSave(); });
  };
  bindRange('size', 'size');
  bindRange('intensity', 'intensity');

  for (const id of ['mirrorX', 'mirrorY', 'snap']) {
    $(id).checked = S[id];
    $(id).addEventListener('change', () => { S[id] = $(id).checked; scheduleSave(); });
  }
  $('repeat').value = S.repeat;
  $('repeat').addEventListener('change', () => { S.repeat = +$('repeat').value; scheduleSave(); });

  NAMES.forEach((nm, i) => $('root').add(new Option(nm, i)));
  for (const [k, sc] of Object.entries(SCALES)) $('scale').add(new Option(sc.name, k));
  $('root').value = S.root;
  $('scale').value = S.scale;
  const scaleChanged = () => { S.root = +$('root').value; S.scale = $('scale').value; drawKeys(); scheduleSave(); };
  $('root').addEventListener('change', scaleChanged);
  $('scale').addEventListener('change', scaleChanged);

  $('bpm').value = S.bpm;
  $('bpm').addEventListener('change', () => {
    S.bpm = Math.max(50, Math.min(200, +$('bpm').value || 112));
    $('bpm').value = S.bpm;
    sendParams();
  });
  $('bars').value = S.bars;
  $('bars').addEventListener('change', () => setBars(+$('bars').value));

  for (const el of document.querySelectorAll('[data-fx]')) {
    el.value = S.fx[el.dataset.fx];
    el.addEventListener('input', () => { S.fx[el.dataset.fx] = +el.value; sendParams(); });
  }

  $('play').addEventListener('click', togglePlay);
  $('undo').addEventListener('click', undo);
  $('clear').addEventListener('click', () => { pushUndo(); S.grid.fill(0); changed(); });
  $('dream').addEventListener('click', () => {
    pushUndo();
    dreamPattern(S.grid, S.C, S.root, S.scale, (Math.random() * 2 ** 31) | 0);
    changed();
  });
  $('wav').addEventListener('click', exportWav);
  $('impala').addEventListener('click', () => {
    pushUndo();
    Object.assign(S, { bpm: 96, root: 9, scale: 'dorian', snap: true });
    Object.assign(S.fx, { smear: 0.45, swirl: 0.4, trip: 0.55, echo: 0.3, space: 0.5, pump: 0.65, wobble: 0.45, sweep: 0.45 });
    impalaPattern(S.grid, S.C, S.root, S.scale);
    syncControls();
    selectLayer(PAD_LAYER);
    sendParams();
    drawKeys();
    changed();
  });
  $('arp').addEventListener('click', () => {
    // one chord per bar: needs at least the four bars of Am–F–C–G
    if (S.bars < 4) { setBars(4); $('bars').value = 4; } else pushUndo();
    Object.assign(S, { bpm: ARP_BPM, root: 9, scale: 'minor', snap: true });
    Object.assign(S.fx, { smear: 0.6, swirl: 0.25, trip: 0, echo: 0.2, space: 0.8, pump: 0, wobble: 0.1, sweep: 0 });
    arpPattern(S.grid, S.C, S.bpm);
    syncControls();
    selectLayer(0);
    sendParams();
    drawKeys();
    changed();
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); }
    else if (e.key === 'e' || e.key === 'E') setEraser(!S.eraser);
    else if (e.key >= '1' && e.key <= String(LAYERS)) selectLayer(+e.key - 1);
  });
  window.addEventListener('resize', layout);
}

// reflect S in the form controls after a preset changes it
function syncControls() {
  $('bpm').value = S.bpm;
  $('root').value = S.root;
  $('scale').value = S.scale;
  $('snap').checked = S.snap;
  for (const el of document.querySelectorAll('[data-fx]')) el.value = S.fx[el.dataset.fx];
}

function selectLayer(i) {
  S.layer = i;
  setEraser(false);
  $('palette').querySelectorAll('.swatch').forEach((b, k) => b.classList.toggle('on', k === i));
  scheduleSave();
}
function setEraser(on) {
  S.eraser = on;
  $('eraser').classList.toggle('on', on);
}

function setBars(bars) {
  pushUndo();
  const oldC = S.C, old = S.grid, C = bars * COLS_PER_BAR;
  const grid = new Float32Array(LAYERS * ROWS * C);
  for (let v = 0; v < LAYERS * ROWS; v++) {
    for (let c = 0; c < C; c++) grid[v * C + c] = old[v * oldC + (c % oldC)];
  }
  S.bars = bars; S.C = C; S.grid = grid;
  resizeSource();
  changed();
}

// ---------------------------------------------------------------- boot
if (!load()) dreamPattern(S.grid, S.C, S.root, S.scale, 7);
resizeSource();
buildUI();
layout();
requestAnimationFrame(frame);

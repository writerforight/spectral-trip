// Spectral synth: reads the painted grid column by column and turns every lit cell
// into a voice. Layer = timbre, row = semitone, cell value = loudness.
// Runs in an AudioWorklet (live) and in an OfflineAudioContext (WAV export).
// Outputs: 0 = melodic voices (stereo), 1 = drums (stereo), 2 = sidechain "pump" gain (mono).

const ROWS = 84, LAYERS = 8, F0 = 32.70319566, HIT = 7;
const COLS_PER_BEAT = 8;
const TBL = 2048;
const LAYER_GAIN = [0.8, 0.9, 0.75, 0.7, 1.0, 0.6, 0.9];

function table(fn) {
  const t = new Float32Array(TBL + 1);
  for (let i = 0; i <= TBL; i++) t[i] = fn((i / TBL) * 2 * Math.PI);
  return t;
}
function additive(n, oddOnly) {
  const t = table((x) => {
    let s = 0;
    for (let k = 1; k <= n; k++) if (!oddOnly || k % 2) s += Math.sin(k * x) / k;
    return s;
  });
  let m = 0;
  for (let i = 0; i <= TBL; i++) m = Math.max(m, Math.abs(t[i]));
  for (let i = 0; i <= TBL; i++) t[i] *= 0.8 / m;
  return t;
}
const SIN = table(Math.sin);

// phase in cycles, must be in [0, 1)
function lk(T, p) {
  const x = p * TBL, j = x | 0;
  return T[j] + (T[j + 1] - T[j]) * (x - j);
}

class SpectralSynth extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const sr = sampleRate;
    this.C = o.C || 128;
    this.grid = o.grid || new Float32Array(LAYERS * ROWS * this.C);
    this.bpm = o.bpm || 112;
    this.smear = o.smear ?? 0.2;
    this.swirl = o.swirl ?? 0.3;
    this.playing = !!o.playing;
    this.loopsLeft = o.loops || 0;
    this.pos = 0;
    this.lastCol = -1;
    this.slew = 1 - Math.exp(-1 / (0.003 * sr));

    this.freq = new Float64Array(ROWS);
    this.inc = new Float64Array(ROWS);
    this.rowGain = new Float32Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      const f = F0 * 2 ** (r / 12);
      this.freq[r] = f;
      this.inc[r] = f / sr;
      this.rowGain[r] = Math.min(1.25, (300 / f) ** 0.22);
    }

    // band-limited saw / square tables, one per octave
    this.saw = []; this.sq = [];
    for (let oc = 0; oc < 7; oc++) {
      const fmax = F0 * 2 ** ((12 * oc + 11) / 12) * 1.01;
      const n = Math.max(1, Math.min(40, Math.floor((sr * 0.45) / fmax)));
      this.saw.push(additive(n, false));
      this.sq.push(additive(n, true));
    }

    // Breath: constant-peak band-pass per row, gain-normalised for white noise
    this.bpB0 = new Float64Array(ROWS); this.bpA1 = new Float64Array(ROWS);
    this.bpA2 = new Float64Array(ROWS); this.bpG = new Float64Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      const w = (2 * Math.PI * this.freq[r]) / sr, Q = 14;
      const alpha = Math.sin(w) / (2 * Q), a0 = 1 + alpha;
      this.bpB0[r] = alpha / a0;
      this.bpA1[r] = (-2 * Math.cos(w)) / a0;
      this.bpA2[r] = (1 - alpha) / a0;
      this.bpG[r] = Math.min(80, 0.4 / Math.sqrt(w / (6 * Q)));
    }
    this.bx1 = new Float64Array(ROWS); this.bx2 = new Float64Array(ROWS);
    this.by1 = new Float64Array(ROWS); this.by2 = new Float64Array(ROWS);

    const N = LAYERS * ROWS;
    this.ph = new Float64Array(N);
    this.ph2 = new Float64Array(N);
    this.amp = new Float32Array(N);
    this.env = new Float32Array(128);
    this.ph3 = new Float64Array(N);
    this.lpL = new Float32Array(N);
    this.lpR = new Float32Array(N);
    this.pump = o.pump ?? 0;
    this.pumpT = 9;

    // percussion state per row
    this.hT = new Float32Array(ROWS).fill(9);
    this.hA = new Float32Array(ROWS);
    this.hPh = new Float64Array(ROWS);
    this.hN = new Float32Array(ROWS);

    this.rng = 0x2545f491;
    this.lfo = 0;
    this.norm = 1;
    this.weight = 0;
    this.postCount = 0;
    this.port.onmessage = (e) => this.onMsg(e.data);
  }

  noise() {
    let x = this.rng;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rng = x | 0;
    return this.rng / 2147483648;
  }

  onMsg(d) {
    if (d.type === 'grid') {
      this.grid = d.grid;
      if (d.C !== this.C) { this.C = d.C; this.pos %= this.C; this.lastCol = -1; }
    } else if (d.type === 'params') {
      if (d.bpm) this.bpm = d.bpm;
      if (d.smear !== undefined) this.smear = d.smear;
      if (d.swirl !== undefined) this.swirl = d.swirl;
      if (d.pump !== undefined) this.pump = d.pump;
    } else if (d.type === 'play') {
      this.playing = true; this.pos = d.pos || 0; this.lastCol = -1;
    } else if (d.type === 'stop') {
      this.playing = false;
    }
  }

  // entering a column: fire drum hits whose cell starts here
  onColumn(col) {
    const C = this.C, G = this.grid, prev = (col - 1 + C) % C;
    for (let r = 0; r < ROWS; r++) {
      const b = (HIT * ROWS + r) * C;
      const a = G[b + col];
      if (a > 0.01 && G[b + prev] < 0.01) {
        this.hT[r] = 0; this.hA[r] = a; this.hPh[r] = 0;
        if (r < 24) this.pumpT = 0;     // kicks drive the sidechain
      }
    }
  }

  renderVoice(l, r, i, len, a0, a1, frac, dfr, e, L, R) {
    const vi = l * ROWS + r, env = this.env, slew = this.slew;
    let amp = this.amp[vi], fr = frac;
    for (let k = 0; k < len; k++) {
      let t = (fr - (1 - e)) / e;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      amp += (a0 + (a1 - a0) * t - amp) * slew;
      env[k] = amp;
      fr += dfr;
    }
    this.amp[vi] = amp < 1e-6 ? 0 : amp;

    const pan = Math.sin(r * 0.73 + l * 2.1 + this.lfo) * this.swirl * 0.9;
    const th = ((pan + 1) * Math.PI) / 4;
    const g = 0.11 * this.rowGain[r] * LAYER_GAIN[l] * this.norm;
    const gl = Math.cos(th) * g, gr = Math.sin(th) * g;
    const inc = this.inc[r];
    let ph = this.ph[vi], ph2 = this.ph2[vi];

    if (l === 0) {
      for (let k = 0; k < len; k++) {
        const s = lk(SIN, ph) * env[k];
        ph += inc; if (ph >= 1) ph -= 1;
        L[i + k] += s * gl; R[i + k] += s * gr;
      }
    } else if (l === 1) {
      const T = this.saw[Math.min(6, (r / 12) | 0)];
      const i1 = inc * 1.006, i2 = inc * 0.994;
      for (let k = 0; k < len; k++) {
        const s = (lk(T, ph) + lk(T, ph2)) * 0.5 * env[k];
        ph += i1; if (ph >= 1) ph -= 1;
        ph2 += i2; if (ph2 >= 1) ph2 -= 1;
        L[i + k] += s * gl; R[i + k] += s * gr;
      }
    } else if (l === 2) {
      const im = inc * 3.5;
      const idx = Math.min(1, 900 / this.freq[r]) / (2 * Math.PI);
      for (let k = 0; k < len; k++) {
        const ev = env[k];
        let a = ph + (1.2 + 1.8 * ev) * idx * lk(SIN, ph2);
        a -= Math.floor(a);
        const s = lk(SIN, a) * ev;
        ph += inc; if (ph >= 1) ph -= 1;
        ph2 += im; if (ph2 >= 1) ph2 -= 1;
        L[i + k] += s * gl; R[i + k] += s * gr;
      }
    } else if (l === 3) {
      const T = this.sq[Math.min(6, (r / 12) | 0)];
      for (let k = 0; k < len; k++) {
        const s = lk(T, ph) * env[k];
        ph += inc; if (ph >= 1) ph -= 1;
        L[i + k] += s * gl; R[i + k] += s * gr;
      }
    } else if (l === 5) {
      // Pad: three detuned saws spread L/C/R, softened by a one-pole low-pass (Juno-ish)
      const T = this.saw[Math.min(6, (r / 12) | 0)];
      const i1 = inc * 1.0045, i2 = inc * 0.9955;
      const a = 1 - Math.exp((-2 * Math.PI * Math.min(this.freq[r] * 5, 3200)) / sampleRate);
      let ph3 = this.ph3[vi], yl = this.lpL[vi], yr = this.lpR[vi];
      const k2 = Math.SQRT2;
      for (let k = 0; k < len; k++) {
        const c = lk(T, ph3) * 0.6;
        yl += (lk(T, ph) + c - yl) * a;
        yr += (lk(T, ph2) + c - yr) * a;
        ph += i1; if (ph >= 1) ph -= 1;
        ph2 += i2; if (ph2 >= 1) ph2 -= 1;
        ph3 += inc; if (ph3 >= 1) ph3 -= 1;
        L[i + k] += yl * env[k] * g * k2 * 0.7;
        R[i + k] += yr * env[k] * g * k2 * 0.7;
      }
      this.ph3[vi] = ph3; this.lpL[vi] = yl; this.lpR[vi] = yr;
    } else if (l === 6) {
      // Fuzz bass: driven sine + a bit of square, tanh, then rounded off
      const T = this.sq[Math.min(6, (r / 12) | 0)];
      const a = 1 - Math.exp((-2 * Math.PI * Math.min(this.freq[r] * 6, 1100)) / sampleRate);
      let y = this.lpL[vi];
      const gc = g * 1.3;
      for (let k = 0; k < len; k++) {
        const ev = env[k];
        const x = (lk(SIN, ph) * 2.2 + lk(T, ph) * 0.5) * (0.6 + ev);
        y += (Math.tanh(x) * 0.75 - y) * a;
        ph += inc; if (ph >= 1) ph -= 1;
        L[i + k] += y * ev * gc; R[i + k] += y * ev * gc;
      }
      this.lpL[vi] = y;
    } else {
      const b0 = this.bpB0[r], a1c = this.bpA1[r], a2c = this.bpA2[r], G = this.bpG[r];
      let x1 = this.bx1[r], x2 = this.bx2[r], y1 = this.by1[r], y2 = this.by2[r];
      for (let k = 0; k < len; k++) {
        const x = this.noise();
        const y = b0 * x - b0 * x2 - a1c * y1 - a2c * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const s = y * G * env[k];
        L[i + k] += s * gl; R[i + k] += s * gr;
      }
      this.bx1[r] = x1; this.bx2[r] = x2; this.by1[r] = y1; this.by2[r] = y2;
    }
    this.ph[vi] = ph; this.ph2[vi] = ph2;
  }

  renderHit(r, i, len, L, R) {
    const sr = sampleRate, dt = 1 / sr, f = this.freq[r];
    const A = this.hA[r] * 0.38;
    const pan = (r / ROWS - 0.5) * 0.5;
    const th = ((pan + 1) * Math.PI) / 4, gl = Math.cos(th) * A, gr = Math.sin(th) * A;
    let t = this.hT[r], ph = this.hPh[r], prev = this.hN[r];
    for (let k = 0; k < len; k++) {
      let s;
      if (r < 24) {                       // kick
        ph += (f * (1 + 6 * Math.exp(-t * 30))) / sr; ph -= Math.floor(ph);
        s = lk(SIN, ph) * Math.exp(-t * 7) * 1.4 + this.noise() * Math.exp(-t * 400) * 0.3;
      } else if (r < 48) {                // snare / tom
        ph += (f * (1 + 0.6 * Math.exp(-t * 40))) / sr; ph -= Math.floor(ph);
        const n = this.noise(), hp = n - prev; prev = n;
        s = lk(SIN, ph) * Math.exp(-t * 18) * 0.6 + hp * Math.exp(-t * (14 + (r - 24) * 0.4)) * 0.35;
      } else {                            // hat
        ph += (f * 1.47) / sr; ph -= Math.floor(ph);
        const n = this.noise(), hp = n - prev; prev = n;
        const d = Math.exp(-t * (30 + (r - 48) * 1.5));
        s = hp * d * 0.4 + (lk(SIN, ph) > 0 ? 0.06 : -0.06) * d;
      }
      L[i + k] += s * gl; R[i + k] += s * gr;
      t += dt;
    }
    this.hT[r] = t > 1.6 ? 9 : t; this.hPh[r] = ph; this.hN[r] = prev;
  }

  process(_inputs, outputs) {
    const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
    const dOut = outputs[1] || out, DL = dOut[0], DR = dOut[1] || dOut[0];
    const P = outputs[2] && outputs[2][0];
    const C = this.C, G = this.grid;
    const spc = (sampleRate * 60) / this.bpm / COLS_PER_BEAT;
    const e = Math.max(0.02, this.smear), dfr = 1 / spc;
    this.lfo += (n / sampleRate) * (0.05 + this.swirl * 0.6) * 2 * Math.PI;
    if (this.lfo > 1e4) this.lfo -= 2 * Math.PI * 1000;

    let i = 0;
    while (i < n) {
      const playing = this.playing;
      let col = 0, frac = 0, len = n - i;
      if (playing) {
        if (this.pos >= C) this.pos %= C;
        col = Math.floor(this.pos);
        frac = this.pos - col;
        len = Math.min(n - i, Math.max(1, Math.ceil((col + 1 - this.pos) * spc - 1e-9)));
        if (col !== this.lastCol) { this.onColumn(col); this.lastCol = col; }
      }
      const c1 = (col + 1) % C;
      let weight = 0;

      for (let l = 0; l < HIT; l++) {
        for (let r = 0; r < ROWS; r++) {
          const vi = l * ROWS + r, base = vi * C;
          const a0 = playing ? G[base + col] : 0, a1 = playing ? G[base + c1] : 0;
          if (a0 === 0 && a1 === 0 && this.amp[vi] < 1e-5) { this.amp[vi] = 0; continue; }
          weight += Math.max(a0, a1) * LAYER_GAIN[l];
          this.renderVoice(l, r, i, len, a0, a1, frac, dfr, e, L, R);
        }
      }
      for (let r = 0; r < ROWS; r++) if (this.hT[r] < 2) this.renderHit(r, i, len, DL, DR);

      // loudness normaliser: many voices → each a bit quieter
      const target = 1 / Math.sqrt(Math.max(1, weight / 4));
      this.norm += (target - this.norm) * 0.15;

      if (playing) {
        this.pos += len / spc;
        if (this.pos >= C - 1e-9) {
          this.pos -= C;
          if (this.loopsLeft > 0 && --this.loopsLeft === 0) this.playing = false;
        }
      }
      i += len;
    }

    // sidechain: dip right after each kick, swell back over ~half a beat
    if (P) {
      const pump = this.pump, rel = (60 / this.bpm) * 0.2, dt = 1 / sampleRate;
      let t = this.pumpT;
      for (let k = 0; k < n; k++) {
        const d = t < 0.004 ? t / 0.004 : Math.exp(-(t - 0.004) / rel);
        P[k] = 1 - pump * 0.85 * d;
        t += dt;
      }
      this.pumpT = Math.min(t, 9);
    }

    this.postCount += n;
    if (this.postCount >= 512) {
      this.postCount = 0;
      this.port.postMessage({ pos: this.pos, playing: this.playing });
    }
    return true;
  }
}

registerProcessor('spectral-synth', SpectralSynth);

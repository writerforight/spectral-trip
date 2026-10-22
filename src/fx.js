// Master chain.
// melodic: phaser (Trip) → ping-pong echo (Echo) → reverb (Space) → filter sweep (Sweep)
//          → tape wobble + flanger (Wobble) → sidechain gain (Pump, driven by the worklet)
// drums:   saturation → glue compressor (kept dry so they punch through)
// both → compressor → volume → analyser

function makeIR(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / ctx.sampleRate;
      lp += (Math.random() * 2 - 1 - lp) * (0.35 + 0.6 * Math.exp(-t * 2));
      d[i] = lp * Math.exp((-6.9 * t) / seconds) * (i < 200 ? i / 200 : 1);
    }
  }
  return buf;
}

function lfo(ctx, hz) {
  const o = ctx.createOscillator(), depth = ctx.createGain();
  o.frequency.value = hz;
  depth.gain.value = 0;
  o.connect(depth);
  o.start();
  return { osc: o, depth };
}

const TAPE = 0.02; // wobble's base delay; drums get the same delay to stay in sync

export function buildFX(ctx) {
  const input = ctx.createGain();
  const drums = ctx.createGain();

  // phaser: allpass chain swept by an LFO
  const dry = ctx.createGain(), wet = ctx.createGain();
  const ph = lfo(ctx, 0.2);
  let last = input;
  for (let k = 0; k < 6; k++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 1200 + k * 150;
    ap.Q.value = 0.8;
    ph.depth.connect(ap.frequency);
    last.connect(ap);
    last = ap;
  }
  last.connect(wet);
  input.connect(dry);
  const pre = ctx.createGain();
  dry.connect(pre); wet.connect(pre);

  // ping-pong echo with a darkening feedback loop
  const echoIn = ctx.createGain(), dL = ctx.createDelay(3), dR = ctx.createDelay(3);
  const fb = ctx.createGain(), tone = ctx.createBiquadFilter(), merger = ctx.createChannelMerger(2);
  const echoOut = ctx.createGain();
  tone.type = 'lowpass'; tone.frequency.value = 3800;
  pre.connect(echoIn); echoIn.connect(dL); dL.connect(dR); dR.connect(fb);
  fb.connect(tone); tone.connect(dL);
  dL.connect(merger, 0, 0); dR.connect(merger, 0, 1); merger.connect(echoOut);

  // reverb (drums send a little too)
  const revSend = ctx.createGain(), conv = ctx.createConvolver(), revOut = ctx.createGain();
  const drumRev = ctx.createGain();
  drumRev.gain.value = 0.12;
  conv.buffer = makeIR(ctx, 3.4);
  pre.connect(revSend); echoOut.connect(revSend); revSend.connect(conv); conv.connect(revOut);
  drums.connect(drumRev); drumRev.connect(conv);

  const mel = ctx.createGain();
  pre.connect(mel); echoOut.connect(mel); revOut.connect(mel);

  // sweep: resonant low-pass, swept exponentially through its detune (cents)
  const sweep = ctx.createBiquadFilter();
  sweep.type = 'lowpass';
  const sw = lfo(ctx, 0.1);
  sw.depth.connect(sweep.detune);
  mel.connect(sweep);

  // wobble: tape wow/flutter (fully wet modulated delay) then a flanger
  const tape = ctx.createDelay(0.1);
  tape.delayTime.value = TAPE;
  const wow = lfo(ctx, 0.55), flutter = lfo(ctx, 6.3);
  wow.depth.connect(tape.delayTime); flutter.depth.connect(tape.delayTime);
  sweep.connect(tape);
  const fl = ctx.createDelay(0.05), flFb = ctx.createGain(), flWet = ctx.createGain();
  fl.delayTime.value = 0.0025;
  const flL = lfo(ctx, 0.11);
  flL.depth.connect(fl.delayTime);
  tape.connect(fl); fl.connect(flFb); flFb.connect(fl); fl.connect(flWet);

  // pump: gain driven sample-accurately by the worklet's third output
  const pump = ctx.createGain();
  pump.gain.value = 0;
  tape.connect(pump); flWet.connect(pump);

  // drums: delayed like the tape, a touch of saturation, glued
  const drumDelay = ctx.createDelay(0.1);
  drumDelay.delayTime.value = TAPE;
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(2.2 * x) / Math.tanh(2.2); }
  shaper.curve = curve;
  const drumComp = ctx.createDynamicsCompressor();
  drumComp.threshold.value = -18; drumComp.ratio.value = 3; drumComp.attack.value = 0.01; drumComp.release.value = 0.12;
  const drumOut = ctx.createGain();
  drumOut.gain.value = 0.75;
  drums.connect(drumDelay); drumDelay.connect(shaper); shaper.connect(drumComp); drumComp.connect(drumOut);

  const sum = ctx.createGain();
  // make-up gain: the melodic chain loses ~5 dB on the way
  const melOut = ctx.createGain();
  melOut.gain.value = 1.7;
  pump.connect(melOut); melOut.connect(sum); drumOut.connect(sum);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
  const master = ctx.createGain();
  sum.connect(comp); comp.connect(master);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0.5;
  master.connect(analyser);

  function to(param, v, instant) {
    if (instant) param.value = v;
    else param.setTargetAtTime(v, ctx.currentTime, 0.05);
  }

  function set(p, instant = false) {
    const beat = 60 / p.bpm;
    to(wet.gain, p.trip * 0.9, instant);
    to(dry.gain, 1 - p.trip * 0.45, instant);
    to(ph.osc.frequency, 0.05 + p.trip * 0.45, instant);
    to(ph.depth.gain, 200 + p.trip * 900, instant);
    to(echoIn.gain, p.echo * 0.7, instant);
    to(fb.gain, 0.2 + p.echo * 0.55, instant);
    to(dL.delayTime, beat * 0.75, instant);
    to(dR.delayTime, beat * 0.75, instant);
    to(revSend.gain, p.space * 0.8, instant);

    // one sweep every two bars
    const s = p.sweep;
    to(sweep.frequency, s > 0.01 ? 2200 * 2 ** ((1 - s) * 3) : 20000, instant);
    to(sweep.Q, 0.7 + s * 6, instant);
    to(sw.osc.frequency, 1 / (beat * 8), instant);
    to(sw.depth.gain, s * 2400, instant);

    const w = p.wobble;
    to(wow.depth.gain, w * 0.0035, instant);
    to(flutter.depth.gain, w * 0.0004, instant);
    to(flL.depth.gain, w * 0.0018, instant);
    to(flFb.gain, w * 0.55, instant);
    to(flWet.gain, w * 0.6, instant);

    to(master.gain, p.volume, instant);
  }

  return { input, drums, pump: pump.gain, output: master, analyser, set };
}

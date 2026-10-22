// Master chain: phaser (Trip) → ping-pong echo (Echo) → reverb (Space) → compressor → volume.

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

export function buildFX(ctx) {
  const input = ctx.createGain();

  // phaser: allpass chain swept by an LFO
  const dry = ctx.createGain(), wet = ctx.createGain();
  const lfo = ctx.createOscillator(), lfoDepth = ctx.createGain();
  lfo.connect(lfoDepth);
  let last = input;
  for (let k = 0; k < 6; k++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 1200 + k * 150;
    ap.Q.value = 0.8;
    lfoDepth.connect(ap.frequency);
    last.connect(ap);
    last = ap;
  }
  last.connect(wet);
  input.connect(dry);
  lfo.start();
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

  // reverb
  const revSend = ctx.createGain(), conv = ctx.createConvolver(), revOut = ctx.createGain();
  conv.buffer = makeIR(ctx, 3.4);
  pre.connect(revSend); echoOut.connect(revSend); revSend.connect(conv); conv.connect(revOut);

  const sum = ctx.createGain();
  pre.connect(sum); echoOut.connect(sum); revOut.connect(sum);
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
    to(lfo.frequency, 0.05 + p.trip * 0.45, instant);
    to(lfoDepth.gain, 200 + p.trip * 900, instant);
    to(echoIn.gain, p.echo * 0.7, instant);
    to(fb.gain, 0.2 + p.echo * 0.55, instant);
    to(dL.delayTime, beat * 0.75, instant);
    to(dR.delayTime, beat * 0.75, instant);
    to(revSend.gain, p.space * 0.8, instant);
    to(master.gain, p.volume, instant);
  }

  return { input, output: master, analyser, set };
}

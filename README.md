# Spectral Trip

A psychedelic sound lab in the browser: **paint colours onto a spectrogram and the loop plays what you drew.**

**▶ Live: https://writerforight.github.io/spectral-trip/**

- **Vertical = pitch** (one row per semitone, C1–B7). **Horizontal = time** (a loop of 1–8 bars).
- **Colour = timbre.** Each colour is its own instrument:

| Colour | Timbre |
|---|---|
| Glass (pink) | pure sine, clean and glassy |
| Prism (cyan) | two detuned saws, bright shimmer |
| Bell (lime) | FM bell, metallic and inharmonic |
| Hollow (orange) | odd harmonics, woody |
| Breath (violet) | band of noise: wind, sizzle |
| Pad (gold) | Juno-style pad: three detuned saws, warm and wide |
| Bass (blue) | fuzz bass: driven sine, round |
| Pulse (red) | drums: low rows kick, middle snare, high hats |

- **Brightness = loudness.** Overlapping colours add up, visually and sonically.
- Brushes: dot, line, wave (vibrato squiggles), spray, chord (a 7th chord stacked inside the scale). Symmetry: mirror time, mirror pitch, repeat every beat/bar.
- Scale snapping (Hijaz, minor pentatonic, dorian, whole tone, major, natural minor, chromatic) keeps everything in tune.
- FX: Smear (gated ↔ swelling notes), Swirl (rotating stereo), Trip (phaser), Echo (ping-pong), Space (reverb),
  Pump (everything ducks on the kick), Wobble (tape wow/flutter + flanger), Sweep (resonant filter, one sweep per two bars).
- ◐ Impala loads a Currents-style loop: 96 BPM, A dorian, pad chords, busy fuzz bass, pumping drums, wobble and sweep on.
- ☾ Arpeggio loads a drawn-spectrogram loop: every note a sine plus its 2f–5f harmonics (each fainter and shorter-lived), one chord per bar
  arpeggiated in eighths, sparse long melody notes, a very faint root bass and a faint 2–4 kHz hiss band, big reverb.
  The first click plays Am–F–C–G at 70 BPM; every click after rolls a new piece (key, progression, arpeggio shape, sevenths, tempo).
- **Bars**: the strip under the canvas selects a bar (`←` `→`). Copy / Paste (`Ctrl/⌘ C` / `V`) a bar onto another, Duplicate, Delete,
  + Bar (up to 16), transpose with ▲ ▼ (`↑` `↓`, Shift = octave), or pick ✥ Move and drag a bar up or down in pitch. Drums never transpose.
- ✺ Dream generates a fresh loop in the current scale. ⤓ WAV renders two loops to a file.
- The right-hand strip is the **live output spectrogram** on the same pitch axis as the canvas.

Keys: `Space` play/stop · `1`–`8` colour · `E` eraser · `Z` undo · right-drag erases · `←` `→` bar · `↑` `↓` transpose bar.

Everything is synthesised live in an AudioWorklet; no samples, no build step, no dependencies.
Your last pattern is kept in the browser's local storage.

## Run locally

```
python3 -m http.server
# open http://localhost:8000
node test/synth.test.js   # headless check of the synth
```

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
| Pulse (red) | drums: low rows kick, middle snare, high hats |

- **Brightness = loudness.** Overlapping colours add up, visually and sonically.
- Brushes: dot, line, wave (vibrato squiggles), spray. Symmetry: mirror time, mirror pitch, repeat every beat/bar.
- Scale snapping (Hijaz, minor pentatonic, dorian, whole tone, major, chromatic) keeps everything in tune.
- FX: Smear (gated ↔ swelling notes), Swirl (rotating stereo), Trip (phaser), Echo (ping-pong), Space (reverb).
- ✺ Dream generates a fresh loop in the current scale. ⤓ WAV renders two loops to a file.
- The right-hand strip is the **live output spectrogram** on the same pitch axis as the canvas.

Keys: `Space` play/stop · `1`–`6` colour · `E` eraser · `Z` undo · right-drag erases.

Everything is synthesised live in an AudioWorklet; no samples, no build step, no dependencies.
Your last pattern is kept in the browser's local storage.

## Run locally

```
python3 -m http.server
# open http://localhost:8000
node test/synth.test.js   # headless check of the synth
```

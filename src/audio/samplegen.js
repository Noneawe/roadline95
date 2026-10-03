// Procedural PCM samples (22 050 Hz, mono, Float32Array): engine loops per car (rpm ranges x load),
// tyres, surfaces, impacts, turbo, gear shift, crowd, rain, start beeps, drums and tracker instruments.
// Pure data, no AudioContext: testable in Node. Deterministic for a seed.
import { makeRng, hashString } from '../engine/rng.js';

export const SAMPLE_RATE = 22050;
const R = SAMPLE_RATE, TAU = Math.PI * 2;

/**
 * @typedef {object} Sample
 * @property {string} name
 * @property {Float32Array} data
 * @property {boolean} loop whole sample loops (loopStart..end)
 * @property {number} [loopStart] first looped sample (default 0)
 * @property {number} [baseFreq] pitch of the recording (Hz): instruments
 * @property {number} [baseRpm] engine speed of the recording: engine loops
 */

// ---- small DSP helpers -----------------------------------------------------------

function normalize(d, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / m;
  return d;
}

// One-pole low-pass in place (cut-off in Hz).
function lowpass(d, hz) {
  const a = 1 - Math.exp((-TAU * hz) / R);
  let y = 0;
  for (let i = 0; i < d.length; i++) { y += a * (d[i] - y); d[i] = y; }
  return d;
}

function highpass(d, hz) {
  const a = 1 - Math.exp((-TAU * hz) / R);
  let y = 0;
  for (let i = 0; i < d.length; i++) { y += a * (d[i] - y); d[i] -= y; }
  return d;
}

// Resonant band-pass (state-variable filter), q ~ 0.5..10.
function bandpass(d, hz, q) {
  const f = 2 * Math.sin((Math.PI * Math.min(hz, R / 6)) / R), damp = 1 / q;
  let lo = 0, bp = 0;
  for (let i = 0; i < d.length; i++) {
    const hi = d[i] - lo - damp * bp;
    bp += f * hi;
    lo += f * bp;
    d[i] = bp;
  }
  return d;
}

// Makes a buffer loop without a click: the tail is cross-faded into the head (length shrinks by `fade`).
function seamless(d, fade) {
  const n = d.length - fade, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = d[i];
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    out[i] = d[i] * t + d[n + i] * (1 - t);
  }
  return out;
}

// Filters a looping buffer as if it repeated forever (no start-up transient at the loop point).
function cyclic(d, filter) {
  const n = d.length, two = new Float32Array(n * 2);
  two.set(d);
  two.set(d, n);
  filter(two);
  return two.slice(n);
}

const noise = (rng, n) => Float32Array.from({ length: n }, () => rng() * 2 - 1);
const env = (i, n, attack, release) => Math.min(1, i / Math.max(1, attack)) * Math.min(1, (n - i) / Math.max(1, release));

// ---- engine ---------------------------------------------------------------------

/**
 * Engine loop recorded at about `rpm`: one exhaust pulse per firing (cylinders / 2 per revolution),
 * each a pair of decaying resonances plus a noise burst. The loop holds a whole number of firings, so
 * it repeats without a seam; `baseRpm` is the exact recorded speed.
 * @param {() => number} rng @param {{ cylinders: number, resonance: number[], rough: number, burble: number }} snd
 * @param {number} rpm @param {boolean} load on throttle (bright) or overrun (muffled, popping)
 * @returns {{ data: Float32Array, baseRpm: number }}
 */
export function engineLoop(rng, snd, rpm, load) {
  const fire = (rpm / 60) * (snd.cylinders / 2), P = Math.max(8, Math.round(R / fire)), cycles = 2 * Math.max(2, Math.round(0.225 * (R / P))); // even: the half-rate crank tone repeats too
  const d = new Float32Array(P * cycles), [r1, r2] = snd.resonance;
  const decay = load ? 0.004 : 0.0025;
  for (let c = 0; c < cycles; c++) {
    const amp = (load ? 1 : 0.45) * (1 + (rng() - 0.5) * snd.rough * 0.8) * (c % 2 ? 1 - snd.rough * 0.25 : 1);
    const pop = !load && rng() < snd.burble * 0.15 ? 1.6 : 1;
    for (let k = 0; k < P * 2 && k < d.length; k++) {
      const t = k / R, e = Math.exp(-t / decay) * amp * pop;
      const v = e * (Math.sin(TAU * r1 * t) + 0.5 * Math.sin(TAU * r2 * t)) + e * 0.6 * snd.rough * (rng() * 2 - 1);
      d[(c * P + k) % d.length] += v;
    }
  }
  // Crank and intake tones at the firing frequency (periodic over the loop by construction).
  const f = R / P;
  for (let i = 0; i < d.length; i++) d[i] += (load ? 0.35 : 0.2) * Math.sin((TAU * f * i) / R) + 0.15 * Math.sin((TAU * 0.5 * f * i) / R);
  const out = cyclic(d, (x) => { if (!load) lowpass(x, 900); highpass(x, 30); });
  return { data: normalize(out, load ? 0.9 : 0.7), baseRpm: (f * 120) / snd.cylinders };
}

/**
 * Recording speeds of a car's engine loops: low, mid and high range (crossfaded by engine-sound.js).
 * @param {object} spec car spec @returns {number[]}
 */
export function engineRanges(spec) {
  const e = spec.engine;
  return [e.idle * 1.4, (e.idle + e.redline) * 0.5, e.redline * 0.92];
}

// ---- effects ----------------------------------------------------------------------

function squeal(rng) {
  const n = Math.round(R * 1.2), d = new Float32Array(n);
  let ph1 = 0, ph2 = 0, wob = 0;
  for (let i = 0; i < n; i++) {
    wob += (rng() - 0.5) * 0.02;
    wob *= 0.999;
    ph1 += (TAU * (1150 + 60 * Math.sin((TAU * 3.1 * i) / R) + wob * 400)) / R;
    ph2 += (TAU * 1730) / R;
    d[i] = Math.sin(ph1) * 0.6 + Math.sin(ph2) * 0.15;
  }
  const hiss = bandpass(noise(rng, n), 2200, 2);
  for (let i = 0; i < n; i++) d[i] += hiss[i] * 0.5;
  return normalize(seamless(d, 2000), 0.8);
}

// Loose surface: crunchy random grains over a low rumble.
function grains(rng, density, tone) {
  const n = R, d = new Float32Array(n + 1500);
  for (let g = 0; g < n * density; g++) {
    const at = Math.floor(rng() * n), len = 30 + Math.floor(rng() * 120), a = 0.3 + rng() * 0.7;
    for (let k = 0; k < len; k++) d[at + k] += a * (rng() * 2 - 1) * (1 - k / len);
  }
  bandpass(d, tone, 1.2);
  const rumble = lowpass(noise(rng, d.length), 120);
  for (let i = 0; i < d.length; i++) d[i] += rumble[i] * 2.5;
  return normalize(seamless(d, 1500), 0.8);
}

// Kerb rumble: one thump per kerb stripe, looped; playbackRate follows the speed.
function kerb() {
  const P = Math.round(R / 20), d = new Float32Array(P * 8);
  for (let c = 0; c < 8; c++) for (let k = 0; k < P; k++) d[c * P + k] = Math.sin((TAU * 55 * k) / R) * Math.exp(-k / (P * 0.3));
  return normalize(d, 0.8);
}

function impact(rng, metal) {
  const n = Math.round(R * (metal ? 0.6 : 0.35)), d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    d[i] = Math.sin(TAU * (80 - 40 * t) * t) * Math.exp(-t / 0.06) + (rng() * 2 - 1) * Math.exp(-t / 0.02) * 0.8;
    if (metal) d[i] += 0.35 * Math.exp(-t / 0.15) * (Math.sin(TAU * 523 * t) + Math.sin(TAU * 1187 * t) + 0.6 * Math.sin(TAU * 1913 * t));
  }
  return normalize(d);
}

function scrape(rng) {
  const d = bandpass(noise(rng, R), 1800, 3);
  for (let i = 0; i < d.length; i++) d[i] *= 0.6 + 0.4 * Math.sin((TAU * 13 * i) / R) ** 2;
  return normalize(seamless(d, 1500), 0.7);
}

function turboWhistle(rng) {
  const P = Math.round(R / 2756), d = new Float32Array(P * 400);
  for (let i = 0; i < d.length; i++) d[i] = Math.sin((TAU * i) / P) * 0.7;
  const air = seamless(bandpass(noise(rng, d.length + 1000), 4000, 1.5), 1000);
  for (let i = 0; i < d.length; i++) d[i] += air[i] * 0.4;
  return normalize(d, 0.6);
}

function blowOff(rng) {
  const n = Math.round(R * 0.45), d = bandpass(noise(rng, n), 3000, 1.2);
  for (let i = 0; i < n; i++) d[i] *= Math.exp(-i / (R * 0.12)) * Math.min(1, i / 200);
  return normalize(d, 0.8);
}

function gearShift(rng) {
  const n = Math.round(R * 0.12), d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    d[i] = (Math.sin(TAU * 140 * t) * 0.6 + (rng() * 2 - 1) * 0.5) * Math.exp(-t / 0.018);
  }
  return normalize(d, 0.7);
}

// Crowd murmur with occasional cheering swells.
function crowd(rng) {
  const n = R * 3, d = new Float32Array(n);
  for (let v = 0; v < 24; v++) {
    const f = 180 + rng() * 420, a = 0.3 + rng() * 0.7, ph = rng() * TAU;
    let p = 0;
    for (let i = 0; i < n; i++) {
      p += (TAU * f * (1 + 0.04 * Math.sin((TAU * (0.7 + v * 0.13) * i) / R + ph))) / R;
      d[i] += a * Math.sin(p) * (0.5 + 0.5 * Math.sin((TAU * (1.5 + rng() * 0.01) * i) / R + v)) ** 2;
    }
  }
  const air = bandpass(noise(rng, n), 900, 0.8);
  for (let i = 0; i < n; i++) d[i] = d[i] * 0.05 + air[i] * 0.6;
  return normalize(seamless(d, 4000), 0.7);
}

function rain(rng) {
  const d = highpass(noise(rng, R * 2), 600);
  for (let drop = 0; drop < 900; drop++) {
    const at = Math.floor(rng() * (d.length - 200));
    for (let k = 0; k < 120; k++) d[at + k] += (rng() * 2 - 1) * Math.exp(-k / 25) * 1.5;
  }
  return normalize(seamless(lowpass(d, 5000), 3000), 0.6);
}

function wind(rng) {
  return normalize(seamless(lowpass(bandpass(noise(rng, R * 2), 400, 0.7), 1500), 3000), 0.6);
}

// Synthesised start signal (no speech): square beep.
function beep(freq, seconds) {
  const n = Math.round(R * seconds), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = (Math.sin((TAU * freq * i) / R) > 0 ? 0.5 : -0.5) * env(i, n, 40, 400);
  return lowpass(d, 3000);
}

// ---- drums and instruments --------------------------------------------------------------

function kick(rng) {
  const n = Math.round(R * 0.35), d = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / R;
    ph += (TAU * (45 + 120 * Math.exp(-t / 0.03))) / R;
    d[i] = Math.sin(ph) * Math.exp(-t / 0.12) + (i < 60 ? (rng() * 2 - 1) * 0.5 : 0);
  }
  return normalize(d);
}

function snare(rng) {
  const n = Math.round(R * 0.25), body = bandpass(noise(rng, n), 3500, 0.9), d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / R;
    d[i] = body[i] * Math.exp(-t / 0.07) * 1.4 + Math.sin(TAU * 185 * t) * Math.exp(-t / 0.04);
  }
  return normalize(d);
}

function hat(rng, seconds) {
  const n = Math.round(R * seconds), d = highpass(highpass(noise(rng, n), 6000), 6000);
  for (let i = 0; i < n; i++) d[i] *= Math.exp(-i / (n * 0.25));
  return normalize(d, 0.7);
}

function crash(rng) {
  const n = Math.round(R * 1.4), d = highpass(noise(rng, n), 3000);
  for (let i = 0; i < n; i++) d[i] *= Math.exp(-i / (R * 0.4));
  return normalize(d, 0.7);
}

// Periodic waveform sustained from loopStart: `period` samples per cycle (exact base frequency).
function tone(period, cycles, attackCycles, wave) {
  const n = period * cycles, d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = wave((i % period) / period) * Math.min(1, i / (period * attackCycles));
  return d;
}

const saw = (x) => 2 * x - 1;
const pulse = (w) => (x) => (x < w ? 0.7 : -0.7);

// Band-limited-ish saw (sum of harmonics) for basses and pads.
const softSaw = (h) => (x) => { let v = 0; for (let k = 1; k <= h; k++) v += Math.sin(TAU * k * x) / k; return v * 0.55; };

function instrument(name, midi, build) {
  const P = Math.round(R / (440 * 2 ** ((midi - 69) / 12)));
  const { data, loopStart } = build(P);
  return { name, data: normalize(data, 0.85), loop: loopStart !== undefined, loopStart: loopStart ?? 0, baseFreq: R / P };
}

// Plucked string (Karplus-Strong), no loop.
function pluck(rng, P, seconds, damp) {
  const n = Math.round(R * seconds), d = new Float32Array(n), buf = noise(rng, P);
  for (let i = 0; i < n; i++) {
    const j = i % P, next = buf[(j + 1) % P];
    d[i] = buf[j];
    buf[j] = (buf[j] + next) * 0.5 * damp;
  }
  return d;
}

// Distorted power chord (root, fifth, octave) for rock rhythm parts, palm-muted decay.
function powerChord(P) {
  const n = Math.round(R * 0.9), d = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / P, v = saw(x % 1) + saw((x * 1.4983) % 1) * 0.8 + saw((x * 2) % 1) * 0.5;
    d[i] = Math.tanh(v * 2.5) * Math.exp(-i / (R * 0.35));
  }
  return lowpass(d, 2800);
}

function instruments(rng) {
  return [
    instrument('bass', 36, (P) => ({ data: lowpass(tone(P, 160, 2, softSaw(12)), 1400), loopStart: P * 40 })),
    instrument('lead', 60, (P) => ({ data: tone(P, 120, 1, pulse(0.3)), loopStart: P * 20 })),
    instrument('pad', 60, (P) => ({ data: lowpass(tone(P, 200, 60, softSaw(10)), 2000), loopStart: P * 100 })),
    instrument('organ', 60, (P) => ({ data: tone(P, 100, 3, (x) => Math.sin(TAU * x) + 0.5 * Math.sin(TAU * 2 * x) + 0.3 * Math.sin(TAU * 4 * x)), loopStart: P * 20 })),
    instrument('guitar', 40, (P) => ({ data: powerChord(P) })),
    instrument('pluck', 60, (P) => ({ data: pluck(rng, P, 1.4, 0.996) })),
    instrument('stab', 60, (P) => {
      const d = tone(P, Math.round(0.4 * R / P), 1, softSaw(16));
      for (let i = 0; i < d.length; i++) d[i] *= Math.exp(-i / (R * 0.12));
      return { data: lowpass(d, 3500) };
    }),
  ];
}

/**
 * Generates every sample of the game.
 * @param {object[]} cars car specs (engine loops per car) @param {number} seed
 * @returns {Map<string, Sample>} keys: engine:<carId>:<range 0..2>:<on|off>, effects, drums, instruments
 */
export function generateSamples(cars, seed) {
  const out = new Map();
  const rngFor = (name) => makeRng((seed ^ hashString(name)) >>> 0);
  const add = (name, data, extra = {}) => out.set(name, { name, data, loop: false, ...extra });
  for (const spec of cars) {
    engineRanges(spec).forEach((rpm, k) => {
      for (const load of [true, false]) {
        const name = `engine:${spec.id}:${k}:${load ? 'on' : 'off'}`, e = engineLoop(rngFor(name), spec.sound, rpm, load);
        add(name, e.data, { loop: true, baseRpm: e.baseRpm });
      }
    });
  }
  add('squeal', squeal(rngFor('squeal')), { loop: true });
  add('gravel', grains(rngFor('gravel'), 0.03, 1500), { loop: true });
  add('grass', grains(rngFor('grass'), 0.012, 500), { loop: true });
  add('kerb', kerb(), { loop: true });
  add('scrape', scrape(rngFor('scrape')), { loop: true });
  add('impact', impact(rngFor('impact'), false));
  add('impactMetal', impact(rngFor('impactMetal'), true));
  add('turbo', turboWhistle(rngFor('turbo')), { loop: true });
  add('blowoff', blowOff(rngFor('blowoff')));
  add('shift', gearShift(rngFor('shift')));
  add('crowd', crowd(rngFor('crowd')), { loop: true });
  add('rain', rain(rngFor('rain')), { loop: true });
  add('wind', wind(rngFor('wind')), { loop: true });
  add('beepLow', beep(660, 0.25));
  add('beepHigh', beep(1320, 0.6));
  add('kick', kick(rngFor('kick')));
  add('snare', snare(rngFor('snare')));
  add('hat', hat(rngFor('hat'), 0.06));
  add('hatOpen', hat(rngFor('hatOpen'), 0.3));
  add('crash', crash(rngFor('crash')));
  for (const s of instruments(rngFor('instruments'))) out.set(s.name, s);
  return out;
}

/**
 * Impulse response for the tunnel reverb (ConvolverNode): dense decaying noise with early echoes.
 * A ConvolverNode needs the context's own sample rate, so the rate is a parameter.
 * @param {number} seed @param {number} rate sample rate (Hz) @param {number} [seconds]
 * @returns {Float32Array}
 */
export function tunnelImpulse(seed, rate, seconds = 1.6) {
  const rng = makeRng((seed ^ hashString('tunnelIR')) >>> 0), n = Math.round(rate * seconds), d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = (rng() * 2 - 1) * Math.exp(-i / (rate * 0.35));
  for (const [ms, a] of [[23, 0.7], [41, 0.5], [67, 0.4], [97, 0.3]]) d[Math.round((rate * ms) / 1000)] += a;
  // One-pole low-pass at ~3.5 kHz for this rate.
  const k = 1 - Math.exp((-TAU * 3500) / rate);
  let y = 0;
  for (let i = 0; i < n; i++) { y += k * (d[i] - y); d[i] = y; }
  return normalize(d, 0.9);
}

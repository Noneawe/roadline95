// Engine sound from sample loops: the player's car crossfades 3 rpm ranges x 2 loads (on throttle /
// overrun) with playbackRate following the revs, limiter stutter, turbo whistle and blow-off, gear
// change clunk. Rivals: the 3 nearest cars get a simplified voice with distance gain, panning and Doppler.
import { engineRanges } from './samplegen.js';

const SOUND_SPEED = 343;

/**
 * Crossfade weights of the recordings for an engine speed (linear in log rpm between neighbours).
 * @param {number} rpm @param {number[]} ranges recording rpms, ascending @param {number[]} out
 * @returns {number[]} out, sums to 1
 */
export function rangeWeights(rpm, ranges, out) {
  out.fill(0);
  if (rpm <= ranges[0]) { out[0] = 1; return out; }
  for (let k = 1; k < ranges.length; k++) {
    if (rpm <= ranges[k]) {
      const t = Math.log(rpm / ranges[k - 1]) / Math.log(ranges[k] / ranges[k - 1]);
      out[k - 1] = 1 - t;
      out[k] = t;
      return out;
    }
  }
  out[ranges.length - 1] = 1;
  return out;
}

/**
 * Doppler pitch factor for a source approaching the listener at `closing` m/s (negative = receding).
 * @param {number} closing @returns {number}
 */
export function doppler(closing) {
  return Math.max(0.7, Math.min(1.4, SOUND_SPEED / (SOUND_SPEED - Math.max(-150, Math.min(150, closing)))));
}

export class EngineSound {
  /**
   * @param {import('./mixer.js').Mixer} mixer @param {object} spec car spec
   * @param {{ gain: number, pan?: number }} cfg pan: stereo position (split screen)
   */
  constructor(mixer, spec, cfg) {
    this.mixer = mixer;
    this.cfg = cfg;
    this.ranges = engineRanges(spec);
    this.voices = [];
    for (let k = 0; k < 3; k++) {
      for (const load of ['on', 'off']) {
        const name = `engine:${spec.id}:${k}:${load}`, v = mixer.loop(name, 'engine');
        if (v) this.voices.push({ v, k, on: load === 'on', base: mixer.samples.get(name).baseRpm });
      }
    }
    this.turbo = spec.turbo ? mixer.loop('turbo', 'engine') : null;
    this.w = [0, 0, 0];
    this.load = 0;
    this.gear = 1;
    this.lastThrottle = 0;
  }

  /** @param {import('../vehicle/physics.js').Car} car @param {number} dt */
  update(car, dt) {
    const d = car.dt, g = this.cfg.gain;
    this.load += (car.throttleEff - this.load) * Math.min(1, dt * 10);
    const rpm = Math.max(300, d.rpm), cut = d.cut ? 0.35 : 1;
    rangeWeights(rpm, this.ranges, this.w);
    for (const x of this.voices) {
      const loadMix = x.on ? 0.25 + 0.75 * this.load : 0.75 * (1 - this.load);
      x.v.set(g * this.w[x.k] * loadMix * cut, rpm / x.base, this.cfg.pan || 0);
    }
    if (this.turbo) this.turbo.set(g * 0.3 * d.boost * this.load, 0.7 + 0.8 * d.boost, this.cfg.pan || 0);
    if (this.turbo && this.lastThrottle > 0.6 && car.throttleEff < 0.2 && d.boost > 0.4) this.mixer.play('blowoff', { bus: 'engine', gain: 0.5 * g, pan: this.cfg.pan });
    if (d.gear !== this.gear) {
      if (d.gear > 0 && this.gear > 0) this.mixer.play('shift', { bus: 'engine', gain: 0.4 * g, pan: this.cfg.pan });
      this.gear = d.gear;
    }
    this.lastThrottle = car.throttleEff;
  }

  /** Silences the voices (replay), keeping them alive. */
  mute() {
    for (const x of this.voices) x.v.set(0, x.v.rate);
    if (this.turbo) this.turbo.set(0, this.turbo.rate);
  }

  stop() {
    for (const x of this.voices) x.v.stop();
    if (this.turbo) this.turbo.stop();
  }
}

/** Simplified engines of the nearest rivals (pool of voices, mid-range on-load loop of each car). */
export class RivalEngines {
  /** @param {import('./mixer.js').Mixer} mixer @param {{ voices: number, range: number, gain: number }} cfg */
  constructor(mixer, cfg) {
    this.mixer = mixer;
    this.cfg = cfg;
    this.pool = [];
    for (let i = 0; i < cfg.voices; i++) {
      const v = mixer.loop('engine:vektorGT2:1:on', 'engine');
      if (v) this.pool.push({ v, car: null });
    }
    this.near = [];
  }

  /**
   * @param {{ car: object, audioLoop: string }[]} cars rivals (the player excluded; audioLoop = sample name)
   * @param {{ pos: number[], yaw: number }} listener camera @param {{ vx: number, vz: number }} lv listener velocity
   * @param {number} [rate] playback speed (replay; 0 = silent)
   */
  update(cars, listener, lv, rate = 1) {
    const { range, gain } = this.cfg, lx = listener.pos[0], lz = listener.pos[2];
    // Nearest cars within range, without allocating: insertion into a short sorted list.
    this.near.length = 0;
    for (const c of cars) {
      const d = Math.hypot(c.car.x - lx, c.car.z - lz);
      if (d > range) continue;
      c.audioDist = d;
      let i = this.near.length;
      if (i === this.pool.length && this.near[i - 1].audioDist <= d) continue;
      if (i < this.pool.length) this.near.push(c);
      else i--;
      while (i > 0 && this.near[i - 1].audioDist > d) { this.near[i] = this.near[i - 1]; i--; }
      this.near[i] = c;
    }
    for (const p of this.pool) if (p.car && this.near.indexOf(p.car) < 0) p.car = null;
    for (const c of this.near) {
      let have = false, free = null;
      for (const p of this.pool) { if (p.car === c) have = true; else if (!p.car && !free) free = p; }
      if (have || !free) continue;
      free.car = c;
      free.v.setSample(c.audioLoop);
    }
    const rx = Math.cos(listener.yaw), rz = Math.sin(listener.yaw);
    for (const p of this.pool) {
      if (!p.car) { p.v.set(0, p.v.rate); continue; }
      const car = p.car.car, dx = car.x - lx, dz = car.z - lz, d = Math.max(1, p.car.audioDist), ux = dx / d, uz = dz / d;
      const closing = -((car.vx - lv.vx) * ux + (car.vz - lv.vz) * uz);
      const base = this.mixer.samples.get(p.v.name).baseRpm, fade = (1 - d / range) ** 2;
      p.v.set(rate > 0 ? gain * fade * (0.5 + 0.5 * car.throttleEff) : 0, Math.max(0.05, (car.dt.rpm / base) * doppler(closing) * (rate || 1)), Math.max(-0.9, Math.min(0.9, ux * rx + uz * rz)));
    }
  }

  stop() {
    for (const p of this.pool) p.v.stop();
  }
}

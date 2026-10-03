// Sound effects of the player's car and its surroundings: tyre squeal, gravel/grass, kerb rumble, wall
// scrape, impacts, wind, crowd near grandstands, rain bed, start signals and the tunnel reverb amount.
// Driven by plain numbers each update (no game objects inside), so it stays reusable.
import { SURFACE } from '../vehicle/tyres.js';

/**
 * Squeal amount 0..1 from tyre slip angles beyond the peak, on paved surfaces only.
 * @param {ArrayLike<number>} slip slip angles (rad) @param {ArrayLike<number>} surface SURFACE per wheel
 * @param {number} peak tyre peak slip (rad) @param {number} speed m/s
 * @returns {number}
 */
export function squealAmount(slip, surface, peak, speed) {
  if (speed < 3) return 0;
  let s = 0;
  for (let i = 0; i < slip.length; i++) {
    if (surface[i] !== SURFACE.ASPHALT && surface[i] !== SURFACE.KERB) continue;
    s = Math.max(s, (Math.abs(slip[i]) / peak - 1.1) / 1.4);
  }
  return Math.max(0, Math.min(1, s)) * Math.min(1, speed / 12);
}

const CAR_LOOPS = ['squeal', 'gravel', 'grass', 'kerb', 'scrape', 'wind'];

export class Sfx {
  /**
   * @param {import('./mixer.js').Mixer} mixer @param {{ tyres: number, impacts: number, wind: number, crowd: number }} cfg
   * @param {{ pan?: number, ambient?: boolean }} [o] pan of this car's effects; ambient: also crowd/rain/reverb (one per race)
   */
  constructor(mixer, cfg, o = {}) {
    this.mixer = mixer;
    this.cfg = cfg;
    this.pan = o.pan || 0;
    this.ambient = o.ambient !== false;
    const L = (name, bus) => mixer.loop(name, bus);
    this.v = {
      squeal: L('squeal', 'sfx'), gravel: L('gravel', 'sfx'), grass: L('grass', 'sfx'), kerb: L('kerb', 'sfx'),
      scrape: L('scrape', 'sfx'), wind: L('wind', 'ambient'), crowd: L('crowd', 'ambient'), rain: L('rain', 'ambient'),
    };
    this.contact = 0;
    this.squeal = 0;
    this.rainLevel = 0;
    this.lights = 0;
  }

  /**
   * @param {object} s per-update state
   * @param {number} s.dt @param {number} s.speed m/s @param {number} s.squeal 0..1 (squealAmount)
   * @param {ArrayLike<number>} s.surface per wheel @param {number} s.impact strongest impact this step (m/s)
   * @param {number} s.crowdDist distance to the nearest grandstand (m) @param {boolean} s.tunnel
   */
  update(s) {
    const c = this.cfg, v = this.v;
    let loose = 0, grass = 0, kerb = 0;
    for (let i = 0; i < 4; i++) {
      if (s.surface[i] === SURFACE.GRAVEL || s.surface[i] === SURFACE.DIRT) loose += 0.25;
      else if (s.surface[i] === SURFACE.GRASS) grass += 0.25;
      else if (s.surface[i] === SURFACE.KERB) kerb += 0.25;
    }
    const moving = Math.min(1, s.speed / 15);
    this.squeal += (s.squeal - this.squeal) * Math.min(1, s.dt * 12);
    const pan = this.pan;
    v.squeal?.set(c.tyres * this.squeal, 0.9 + 0.2 * this.squeal, pan);
    v.gravel?.set(c.tyres * loose * moving, 0.6 + s.speed / 60, pan);
    v.grass?.set(c.tyres * 0.8 * grass * moving, 0.6 + s.speed / 60, pan);
    v.kerb?.set(c.tyres * kerb * moving, Math.max(0.3, s.speed / 20), pan);
    // Impacts: one-shots by strength; continuous contact (sliding along a wall) feeds the scrape loop.
    if (s.impact > 2) this.mixer.play(s.impact > 8 ? 'impactMetal' : 'impact', { gain: c.impacts * Math.min(1, s.impact / 15), pan });
    this.contact = s.impact > 0.3 ? 1 : Math.max(0, this.contact - s.dt * 6);
    v.scrape?.set(c.impacts * 0.6 * this.contact * moving, 0.8 + s.speed / 80, pan);
    v.wind?.set(c.wind * Math.min(1, (s.speed / 70) ** 2), 0.7 + s.speed / 100, pan);
    if (!this.ambient) return;
    v.crowd?.set(c.crowd * Math.max(0, 1 - s.crowdDist / 120) ** 2, 1, 0, 0.3);
    v.rain?.set(c.wind * this.rainLevel, 1, 0, 0.3);
    this.mixer.setReverb(s.tunnel ? 1 : 0);
  }

  /** Rain bed level 0..1 (weather, stage 8). @param {number} level */
  setRain(level) {
    this.rainLevel = level;
  }

  /**
   * Start signals: a low beep for each red light, a high one at the start.
   * @param {number} lightsOn @param {boolean} go
   */
  startLights(lightsOn, go) {
    if (lightsOn > this.lights) this.mixer.play('beepLow', { bus: 'voice', gain: 0.6 });
    if (go && this.lights > 0) this.mixer.play('beepHigh', { bus: 'voice', gain: 0.7 });
    this.lights = go ? 0 : lightsOn;
  }

  /** Silences the car effects (replay); ambience stays. */
  mute() {
    for (const k of CAR_LOOPS) this.v[k]?.set(0, this.v[k].rate);
  }

  stop() {
    for (const k in this.v) this.v[k]?.stop();
  }
}

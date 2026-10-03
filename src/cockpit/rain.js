// Rain in the 2D overlay: falling streaks drawn as screen-door (every other pixel) lines, slanted by the
// car's speed; in the cockpit, drops gather on the windscreen and two wipers sweep them away. No
// semi-transparency: binary pixels only. Pre-allocated, no allocation per frame.
import { RAMP } from '../gfx/palette.js';
import { makeRng } from '../engine/rng.js';

const PIVOTS = [200, 420]; // wiper pivots (x at 640 px width), on the dashboard top at y = 330
const LIGHT = RAMP.CLOUD * 16 + 12, DROP = RAMP.CLOUD * 16 + 14, DROP_DARK = RAMP.SKY * 16 + 6, BLADE = RAMP.ASPHALT * 16 + 1;

export class RainFx {
  /**
   * @param {number} w @param {number} h overlay size @param {{ streaks: number, screenDrops: number, wiperPeriod: number }} cfg
   * @param {number} seed
   */
  constructor(w, h, cfg, seed) {
    this.w = w;
    this.h = h;
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.s = w / 640;
    this.streaks = new Float32Array(cfg.streaks * 3);
    for (let i = 0; i < cfg.streaks; i++) this.respawn(i, true);
    this.drops = new Float32Array(cfg.screenDrops * 3);
    this.dropCount = 0;
    this.wiper = 0;
    this.slant = 0;
  }

  respawn(i, anywhere) {
    const o = i * 3;
    this.streaks[o] = this.rng() * this.w * 1.4 - this.w * 0.2;
    this.streaks[o + 1] = anywhere ? this.rng() * this.h : -this.rng() * this.h * 0.2;
    this.streaks[o + 2] = (8 + this.rng() * 14) * this.s;
  }

  /** @param {number} dt @param {number} speed car speed (m/s) @param {boolean} inside cockpit view @param {number} level 0..1 */
  update(dt, speed, inside, level) {
    if (level <= 0) return;
    const fall = (this.h * 1.6 + speed * 6 * this.s) * dt;
    this.slant = Math.min(0.9, speed / 60);
    for (let i = 0; i < this.cfg.streaks; i++) {
      const o = i * 3;
      this.streaks[o + 1] += fall;
      this.streaks[o] -= fall * this.slant * 0.5;
      if (this.streaks[o + 1] > this.h) this.respawn(i, false);
    }
    if (!inside) return;
    // Windscreen drops appear at random and are wiped when a blade passes over them.
    const spawn = dt * (6 + speed * 0.3) * level;
    for (let k = 0; k < spawn * 4 && this.dropCount < this.cfg.screenDrops; k++) {
      if (this.rng() > 0.25) continue;
      const o = this.dropCount++ * 3;
      this.drops[o] = this.rng() * this.w;
      this.drops[o + 1] = (16 + this.rng() * 300) * this.s;
      this.drops[o + 2] = this.rng() < 0.3 ? 2 : 1;
    }
    const prev = this.wiper;
    this.wiper = (this.wiper + dt / this.cfg.wiperPeriod) % 2;
    for (let i = 0; i < this.dropCount; i++) {
      const o = i * 3;
      if (this.wiped(this.drops[o], this.drops[o + 1], prev)) {
        this.dropCount--;
        this.drops.copyWithin(o, this.dropCount * 3, this.dropCount * 3 + 3);
        i--;
      }
    }
  }

  // Wiper angle (rad from horizontal right): sweeps 0 -> pi -> 0 over two periods.
  angle(phase) {
    const t = phase < 1 ? phase : 2 - phase;
    return Math.PI * (0.08 + 0.84 * (0.5 - 0.5 * Math.cos(Math.PI * t)));
  }

  // True if a point lies in the sector swept by either blade since the previous phase.
  wiped(x, y, prevPhase) {
    const a0 = this.angle(prevPhase), a1 = this.angle(this.wiper), lo = Math.min(a0, a1) - 0.03, hi = Math.max(a0, a1) + 0.03;
    for (const px of PIVOTS) {
      const dx = x - px * this.s, dy = 330 * this.s - y, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
      if (r < 240 * this.s && a >= lo && a <= hi) return true;
    }
    return false;
  }

  /**
   * @param {import('../gfx/overlay.js').Overlay} ov @param {boolean} inside cockpit (drops and wipers)
   * @param {number} level 0..1
   */
  draw(ov, inside, level) {
    if (level <= 0) return;
    const d = ov.data, w = ov.w, h = ov.h, n = Math.round(this.cfg.streaks * level);
    for (let i = 0; i < n; i++) {
      const o = i * 3, x0 = this.streaks[o], y0 = this.streaks[o + 1], len = this.streaks[o + 2];
      for (let k = 0; k < len; k += 2) {
        const x = Math.round(x0 - k * this.slant * 0.5), y = Math.round(y0 - k);
        if (x >= 0 && x < w && y >= 0 && y < h && !d[y * w + x]) d[y * w + x] = LIGHT;
      }
    }
    if (!inside) return;
    for (let i = 0; i < this.dropCount; i++) {
      const o = i * 3, x = Math.round(this.drops[o]), y = Math.round(this.drops[o + 1]), r = this.drops[o + 2] * Math.max(1, Math.round(this.s));
      for (let yy = 0; yy <= r; yy++) for (let xx = 0; xx <= r; xx++) {
        const px = x + xx, py = y + yy;
        if (px >= 0 && px < w && py >= 0 && py < h && !d[py * w + px]) d[py * w + px] = yy === r ? DROP_DARK : DROP;
      }
    }
    const a = this.angle(this.wiper), t = Math.max(2, Math.round(3 * this.s));
    for (const px of PIVOTS) {
      const cx = px * this.s, cy = 330 * this.s, len = 230 * this.s, ux = Math.cos(a), uy = -Math.sin(a);
      for (let k = 0; k < len; k++) {
        const x = Math.round(cx + ux * k), y = Math.round(cy + uy * k);
        for (let j = 0; j < t; j++) if (x + j >= 0 && x + j < w && y >= 0 && y < h && !d[y * w + x + j]) d[y * w + x + j] = BLADE;
      }
    }
  }
}

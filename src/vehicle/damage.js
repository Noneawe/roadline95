// Visual damage (CLAUDE.md 10/12): impacts load four zones (front, rear, left, right); a car mesh copy is
// deformed (dents pushed inward, bounded, with per-vertex noise) and damaged faces switch to scratched
// paint or broken lights. Geometry stays valid: displacement is capped and only inward. Pure data.
import { VERTEX_WORDS } from '../models/loader.js';

export const ZONE = { FRONT: 0, REAR: 1, LEFT: 2, RIGHT: 3 };

export class Damage {
  /** @param {{ dentMax: number, threshold: number, scale: number, step: number }} cfg */
  constructor(cfg) {
    this.cfg = cfg;
    this.zones = new Float32Array(4);
    this.version = 0;
    this.shown = new Float32Array(4);
  }

  /**
   * Registers an impact. nx/nz: unit normal pointing from the obstacle into the car (world).
   * @param {number} heading car heading @param {number} speed impact speed (m/s) @param {number} nx @param {number} nz
   */
  hit(heading, speed, nx, nz) {
    const amount = (speed - this.cfg.threshold) * this.cfg.scale;
    if (amount <= 0) return;
    const fx = Math.sin(heading), fz = -Math.cos(heading);
    // Contact side in the car frame is opposite to the normal.
    const f = -(nx * fx + nz * fz), r = -(nx * -fz + nz * fx);
    const zone = Math.abs(f) >= Math.abs(r) ? (f > 0 ? ZONE.FRONT : ZONE.REAR) : (r > 0 ? ZONE.RIGHT : ZONE.LEFT);
    this.zones[zone] = Math.min(1, this.zones[zone] + amount);
    // Rebuild the mesh only when a zone grew by a visible step.
    if (this.zones[zone] - this.shown[zone] >= this.cfg.step || this.zones[zone] === 1 && this.shown[zone] < 1) {
      this.shown.set(this.zones);
      this.version++;
    }
  }

  /** Overall damage 0..1 (mean of zones). */
  get total() {
    return (this.zones[0] + this.zones[1] + this.zones[2] + this.zones[3]) / 4;
  }
}

/**
 * Writes a deformed copy of a car mesh into `out` (same layout as `base`).
 * @param {import('../models/loader.js').MeshData} base pristine mesh
 * @param {ArrayBuffer} out destination buffer (same size)
 * @param {Float32Array} zones damage 0..1 per ZONE
 * @param {{ zFront: number, zRear: number, half: number, dentMax: number }} shape car extents in model space
 * @param {{ body: number[], headlight: number, taillight: number, scratched: number, headBroken: number, tailBroken: number }} layers
 */
export function deformCar(base, out, zones, shape, layers) {
  const src = new Float32Array(base.buffer), su = new Uint32Array(base.buffer);
  const dst = new Float32Array(out), du = new Uint32Array(out);
  dst.set(src);
  const n = base.count;
  for (let t = 0; t < n; t += 3) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) {
      const o = (t + k) * VERTEX_WORDS;
      const w = weights(src[o], src[o + 2], shape);
      // Dent: inward, scaled by zone damage and a per-vertex pseudo-random factor; low parts dent more.
      const noise = 0.55 + 0.45 * hash(src[o] * 7.3 + src[o + 1] * 3.1 + src[o + 2] * 5.7);
      const h = Math.max(0.3, 1 - Math.max(0, src[o + 1] - 0.6));
      const d = shape.dentMax * noise * h;
      dst[o + 2] += d * (w[0] * zones[0] - w[1] * zones[1]);
      dst[o] += d * (w[2] * zones[2] - w[3] * zones[3]);
      cx += src[o] / 3; cz += src[o + 2] / 3;
    }
    // Texture swap per triangle (consistent for flat-varying layers).
    const w = weights(cx, cz, shape), o0 = t * VERTEX_WORDS, layer = su[o0 + 8];
    let swap = -1;
    const worst = Math.max(w[0] * zones[0], w[1] * zones[1], w[2] * zones[2], w[3] * zones[3]);
    if (layers.body.includes(layer) && worst > 0.35) swap = layers.scratched;
    if (layer === layers.headlight && w[0] * zones[0] > 0.45) swap = layers.headBroken;
    if (layer === layers.taillight && w[1] * zones[1] > 0.45) swap = layers.tailBroken;
    if (swap >= 0) for (let k = 0; k < 3; k++) du[(t + k) * VERTEX_WORDS + 8] = swap;
  }
}

// Zone weights of a model-space point: 1 at the bumper / side, fading over about a metre.
function weights(x, z, s) {
  return [
    Math.max(0, Math.min(1, (s.zFront + 1.2 - z) / 1.2)),
    Math.max(0, Math.min(1, (z - (s.zRear - 1.0)) / 1.0)),
    Math.max(0, Math.min(1, (-x - (s.half - 0.45)) / 0.45)),
    Math.max(0, Math.min(1, (x - (s.half - 0.45)) / 0.45)),
  ];
}

function hash(v) {
  const s = Math.sin(v * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

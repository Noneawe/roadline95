// Race replay: records the state of every car on every fixed step with delta compression (quantized
// integers; a keyframe each second or when a delta does not fit 16 bits) plus damage changes, and
// decodes any frame - or a fractional frame, interpolated - for playback, rewind and slow motion.
// Pure data, no DOM; buffers grow in large chunks (no allocation per step).

/** Fields per car and their quantization steps. */
const FIELDS = ['x', 'y', 'z', 'heading', 'n0', 'n1', 'n2', 'roll', 'pitch', 'rpm', 'throttle', 'speed', 'ghost'];
const STEP = [0.01, 0.01, 0.01, 1e-4, 1e-4, 1e-4, 1e-4, 0.01, 0.01, 1, 0.001, 0.01, 0.01];
const F = FIELDS.length;
export const KEY_EVERY = 60;
const CHUNK = 3600;

/**
 * @typedef {object} ReplayCar decoded car state (fields read by vehicle/pose.js, cameras and audio)
 * @property {number} x @property {number} y @property {number} z @property {number} heading
 * @property {number[]} groundNormal @property {number} ayLocal @property {number} latBoost @property {number} axLocal
 * @property {{ rpm: number }} dt @property {number} throttleEff @property {number} speed @property {number} vx @property {number} vz
 * @property {number} ghost @property {Uint8Array} surface
 */

export class Replay {
  /** @param {number} cars number of cars */
  constructor(cars) {
    this.n = cars;
    this.frames = 0;
    this.prev = new Int32Array(cars * F);
    this.cur = new Int32Array(cars * F);
    this.deltaChunks = [];
    this.keyChunks = [];
    this.keyFrames = [];
    this.damage = [];
    this.versions = new Int32Array(cars).fill(-1);
    this.scratch = [new Int32Array(cars * F), new Int32Array(cars * F)];
    this.vals = new Float64Array(F);
  }

  // Quantized state of car k into this.cur.
  quantize(k, c) {
    const car = c.car, v = this.vals, n = car.groundNormal;
    v[0] = car.x; v[1] = car.y; v[2] = car.z; v[3] = car.heading; v[4] = n[0]; v[5] = n[1]; v[6] = n[2];
    v[7] = car.ayLocal / car.latBoost; v[8] = car.axLocal; v[9] = car.dt.rpm; v[10] = car.throttleEff; v[11] = car.speed; v[12] = c.ghost || 0;
    for (let i = 0; i < F; i++) this.cur[k * F + i] = Math.round(v[i] / STEP[i]);
  }

  /**
   * Records one fixed step.
   * @param {{ car: import('../vehicle/physics.js').Car, ghost: number, damage: { version: number, zones: Float32Array } }[]} cars
   */
  record(cars) {
    for (let k = 0; k < this.n; k++) {
      this.quantize(k, cars[k]);
      const d = cars[k].damage;
      if (d && d.version !== this.versions[k]) {
        this.versions[k] = d.version;
        this.damage.push({ frame: this.frames, car: k, zones: Float32Array.from(d.zones) });
      }
    }
    const f = this.frames, slot = f % CHUNK;
    if (slot === 0) this.deltaChunks.push(new Int16Array(CHUNK * this.n * F));
    const deltas = this.deltaChunks[this.deltaChunks.length - 1];
    let key = f % KEY_EVERY === 0;
    if (!key) {
      for (let i = 0; i < this.cur.length; i++) {
        const dv = this.cur[i] - this.prev[i];
        if (dv > 32767 || dv < -32767) { key = true; break; }
      }
    }
    if (key) {
      const ks = this.keyFrames.length % 256;
      if (ks === 0) this.keyChunks.push(new Int32Array(256 * this.n * F));
      this.keyChunks[this.keyChunks.length - 1].set(this.cur, ks * this.n * F);
      this.keyFrames.push(f);
      deltas.fill(0, slot * this.n * F, (slot + 1) * this.n * F);
    } else {
      for (let i = 0; i < this.cur.length; i++) deltas[slot * this.n * F + i] = this.cur[i] - this.prev[i];
    }
    this.prev.set(this.cur);
    this.frames++;
  }

  /** @returns {number} recorded length in seconds at the given step */
  duration(step) {
    return this.frames * step;
  }

  // Quantized state at an integer frame into out (Int32Array n * F).
  decodeInt(frame, out) {
    const f = Math.max(0, Math.min(this.frames - 1, frame));
    let lo = 0, hi = this.keyFrames.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.keyFrames[mid] <= f) lo = mid; else hi = mid - 1; }
    const kf = this.keyFrames[lo], size = this.n * F;
    out.set(this.keyChunks[lo >> 8].subarray((lo & 255) * size, ((lo & 255) + 1) * size));
    for (let g = kf + 1; g <= f; g++) {
      const chunk = this.deltaChunks[Math.floor(g / CHUNK)], base = (g % CHUNK) * size;
      for (let i = 0; i < size; i++) out[i] += chunk[base + i];
    }
    return out;
  }

  /**
   * Decodes a (fractional) frame into car-like objects, interpolating between neighbouring frames.
   * @param {number} t frame position @param {ReplayCar[]} out one per car
   */
  decode(t, out) {
    const f0 = Math.floor(Math.max(0, t)), u = Math.min(1, Math.max(0, t - f0));
    const a = this.decodeInt(f0, this.scratch[0]), b = u > 0 ? this.decodeInt(f0 + 1, this.scratch[1]) : a;
    const v = this.vals;
    for (let k = 0; k < this.n; k++) {
      const o = k * F, c = out[k];
      for (let i = 0; i < F; i++) v[i] = (a[o + i] + (b[o + i] - a[o + i]) * u) * STEP[i];
      c.x = v[0]; c.y = v[1]; c.z = v[2];
      // Heading: interpolate the short way round (a reset may jump it).
      let dh = (b[o + 3] - a[o + 3]) * STEP[3];
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      c.heading = a[o + 3] * STEP[3] + dh * u;
      c.groundNormal[0] = v[4]; c.groundNormal[1] = v[5]; c.groundNormal[2] = v[6];
      c.ayLocal = v[7]; c.latBoost = 1; c.axLocal = v[8];
      c.dt.rpm = v[9]; c.throttleEff = v[10]; c.speed = v[11]; c.ghost = v[12];
      c.vx = Math.sin(c.heading) * c.speed; c.vz = -Math.cos(c.heading) * c.speed;
    }
    return out;
  }

  /**
   * Damage zones of a car at a frame (latest change at or before it), or null if undamaged.
   * @param {number} car @param {number} frame
   * @returns {Float32Array | null}
   */
  damageAt(car, frame) {
    let z = null;
    for (const e of this.damage) {
      if (e.frame > frame) break;
      if (e.car === car) z = e.zones;
    }
    return z;
  }

  /** @returns {number} bytes held by the recording */
  get bytes() {
    return this.deltaChunks.length * CHUNK * this.n * F * 2 + this.keyChunks.length * 256 * this.n * F * 4;
  }
}

/**
 * Car-like objects for decoding (one per car).
 * @param {object[]} specs car specs
 * @returns {ReplayCar[]}
 */
export function replayCars(specs) {
  return specs.map((spec) => ({
    spec, x: 0, y: 0, z: 0, heading: 0, groundNormal: [0, 1, 0], ayLocal: 0, latBoost: 1, axLocal: 0,
    dt: { rpm: 0 }, throttleEff: 0, speed: 0, vx: 0, vz: 0, ghost: 0, surface: new Uint8Array(4),
  }));
}

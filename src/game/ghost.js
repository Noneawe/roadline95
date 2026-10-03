// Time-trial ghost: records the player's car pose every fixed step of the current lap and keeps the
// best lap; playback by step index reproduces that lap exactly (fixed timestep). Pre-allocated buffers.

const F = 9; // x, y, z, heading, ground normal (3), roll input (ay / latBoost), pitch input (ax)

export class Ghost {
  /** @param {number} maxSteps longest recordable lap in fixed steps */
  constructor(maxSteps) {
    this.max = maxSteps;
    this.cur = new Float32Array(maxSteps * F);
    this.best = new Float32Array(maxSteps * F);
    this.n = 0;
    this.bestN = 0;
    this.bestTime = Infinity;
    this.overflow = false;
  }

  /** Starts recording a new lap (discarding the unfinished one). */
  restart() {
    this.n = 0;
    this.overflow = false;
  }

  /** @param {import('../vehicle/physics.js').Car} car */
  record(car) {
    if (this.n >= this.max) { this.overflow = true; return; }
    const o = this.n * F, b = this.cur, n = car.groundNormal;
    b[o] = car.x; b[o + 1] = car.y; b[o + 2] = car.z; b[o + 3] = car.heading;
    b[o + 4] = n[0]; b[o + 5] = n[1]; b[o + 6] = n[2];
    b[o + 7] = car.ayLocal / car.latBoost; b[o + 8] = car.axLocal;
    this.n++;
  }

  /**
   * Ends the lap: keeps it when it is the fastest complete recording. Starts the next one.
   * @param {number} time lap time (s) @returns {boolean} new best
   */
  lapDone(time) {
    const better = !this.overflow && this.n > 0 && time < this.bestTime;
    if (better) {
      [this.cur, this.best] = [this.best, this.cur];
      this.bestN = this.n;
      this.bestTime = time;
    }
    this.restart();
    return better;
  }

  /** @returns {boolean} a best lap exists */
  get ready() {
    return this.bestN > 0;
  }

  /**
   * Writes the pose of step i of the best lap into a car-like object (fields read by vehicle/pose.js).
   * @param {number} i @param {{ x: number, y: number, z: number, heading: number, groundNormal: number[],
   *   ayLocal: number, latBoost: number, axLocal: number }} out
   * @returns {boolean} false past the end of the best lap
   */
  sample(i, out) {
    if (!this.ready || i >= this.bestN) return false;
    const o = Math.max(0, i) * F, b = this.best;
    out.x = b[o]; out.y = b[o + 1]; out.z = b[o + 2]; out.heading = b[o + 3];
    out.groundNormal[0] = b[o + 4]; out.groundNormal[1] = b[o + 5]; out.groundNormal[2] = b[o + 6];
    out.ayLocal = b[o + 7]; out.latBoost = 1; out.axLocal = b[o + 8];
    return true;
  }
}

// TV broadcast cameras for replays: fixed points beside the track (from the track's `tv` data:
// spacing, offset, height, plus optional fixed points), kept clear of scenery and terrain; a director
// cuts to the camera the car approaches (with line of sight), zooms to keep the car framed and now and
// then switches to a helicopter shot circling above the car.
import { frameAt, SEG } from '../world/track.js';
import { SLOT } from '../world/ground.js';

/**
 * @typedef {{ s: number, x: number, y: number, z: number, tunnel: boolean }} TvCamera
 */

/**
 * Places the TV cameras of a track.
 * @param {import('../world/track.js').Track} track @param {import('../world/ground.js').GroundProbe} probe
 * @param {import('../game/collision.js').StaticColliders} colliders
 * @param {{ spacing: number, offset: number, height: number, tunnelHeight: number }} cfg defaults (CONFIG.tv)
 * @returns {TvCamera[]}
 */
export function buildTvCameras(track, probe, colliders, cfg) {
  const tv = { ...cfg, ...(track.def.tv || {}) }, cams = [], f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
  const hw = track.def.width / 2, from = track.closed ? 0 : track.startS - 50, to = track.closed ? track.length : track.length - 20;
  const points = tv.points || [];
  for (let s = from + tv.spacing / 2, k = 0; s < to; s += tv.spacing, k++) points.push({ s, side: k % 2 ? 1 : -1 });
  for (const p of points) {
    frameAt(track, p.s, f);
    const i = Math.min(track.segments - 1, Math.max(0, Math.floor(p.s / track.ds))), tunnel = (track.seg[i] & SEG.TUNNEL) !== 0;
    const rl = Math.hypot(f.right[0], f.right[2]), rx = f.right[0] / rl, rz = f.right[2] / rl;
    // First spot clear of scenery colliders (no camera inside a building or tree): the wanted offset,
    // farther out, closer in, then the other side; a place blocked everywhere gets no camera.
    const base = p.offset ?? tv.offset;
    let x = 0, z = 0, clear = false;
    for (const side of [p.side, -p.side]) {
      for (const off of tunnel ? [hw - 0.8] : [hw + base, hw + base + 5, hw + base + 10, hw + 6.5]) {
        x = f.pos[0] + rx * off * side; z = f.pos[2] + rz * off * side;
        clear = tunnel || !colliders.circle(x, z, 2.5);
        if (clear) break;
      }
      if (clear) break;
    }
    if (!clear) continue;
    probe.hints[SLOT.MISC] = -1;
    const ground = tunnel ? f.pos[1] : probe.heightAt(x, z, SLOT.MISC, false);
    cams.push({ s: p.s, x, y: ground + (tunnel ? tv.tunnelHeight : p.height ?? tv.height), z, tunnel });
  }
  return cams.sort((a, b) => a.s - b.s);
}

export class TvDirector {
  /**
   * @param {import('../world/track.js').Track} track @param {TvCamera[]} cams
   * @param {import('../world/ground.js').GroundProbe} probe
   * @param {{ maxDist: number, hold: number, heliEvery: number, heliFor: number, frame: number, heli: number[] }} cfg
   */
  constructor(track, cams, probe, cfg) {
    this.track = track;
    this.cams = cams;
    this.probe = probe;
    this.cfg = cfg;
    this.cur = -1;
    this.held = 0;
    this.clock = 0;
    this.fov = 40;
    this.heli = false;
    this.orbit = 0;
    this.pos = [0, 0, 0];
  }

  /** Forgets the current shot (after a seek). */
  cut() {
    this.cur = -1;
    this.held = 0;
  }

  // Signed distance along the track from the target to camera c (wraps on circuits).
  ahead(c, s) {
    const L = this.track.length;
    let d = c.s - s;
    if (this.track.closed) { if (d > L / 2) d -= L; if (d < -L / 2) d += L; }
    return d;
  }

  // Terrain between camera and target? (8 samples along the sight line)
  visible(c, t) {
    for (let k = 1; k < 8; k++) {
      const u = k / 8, x = c.x + (t.x - c.x) * u, z = c.z + (t.z - c.z) * u, y = c.y + (t.y + 1 - c.y) * u;
      if (this.probe.heightAt(x, z, SLOT.MISC, false) > y + 0.3) return false;
    }
    return true;
  }

  // The camera the car approaches next (closest ahead with line of sight), else the nearest visible.
  pick(t, s) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.cams.length; i++) {
      const c = this.cams[i], d = this.ahead(c, s);
      if (d < -25 || d > this.cfg.maxDist) continue;
      const score = d < 0 ? 1000 - d : d;
      if (score < bestD && this.visible(c, t)) { best = i; bestD = score; }
    }
    return best;
  }

  /**
   * @param {number} dt real seconds @param {{ x: number, y: number, z: number, heading: number }} t target car
   * @param {number} s target track distance @param {boolean} auto mix in helicopter shots
   */
  update(dt, t, s, auto) {
    this.clock += dt;
    this.held += dt;
    const C = this.cfg, cycle = this.clock % C.heliEvery;
    this.heli = auto && cycle > C.heliEvery - C.heliFor;
    if (this.heli) { this.orbit += dt * 0.25; return; }
    const c = this.cams[this.cur];
    const lost = !c || this.ahead(c, s) < -40 || Math.hypot(c.x - t.x, c.z - t.z) > C.maxDist || !this.visible(c, t);
    if (lost && (this.held > C.hold || !c)) {
      const next = this.pick(t, s);
      if (next >= 0 && next !== this.cur) { this.cur = next; this.held = 0; }
    }
  }

  /**
   * Writes camera position/orientation and returns the field of view (deg) for this shot.
   * @param {{ pos: number[], yaw: number, pitch: number, roll: number }} cam @param {{ x: number, y: number, z: number, heading: number }} t
   * @param {number} dt real seconds (zoom smoothing)
   * @returns {number} fovY
   */
  apply(cam, t, dt) {
    const C = this.cfg, p = this.pos;
    if (this.heli || this.cur < 0) {
      const a = t.heading + Math.PI * 0.75 + this.orbit, [dist, up] = C.heli;
      p[0] = t.x + Math.sin(a) * dist; p[2] = t.z - Math.cos(a) * dist;
      this.probe.hints[SLOT.MISC] = -1;
      p[1] = Math.max(t.y + up, this.probe.heightAt(p[0], p[2], SLOT.MISC, false) + 12);
    } else {
      const c = this.cams[this.cur];
      p[0] = c.x; p[1] = c.y; p[2] = c.z;
    }
    const dx = t.x - p[0], dz = t.z - p[2], dy = t.y + 0.8 - p[1], d = Math.hypot(dx, dy, dz);
    cam.pos[0] = p[0]; cam.pos[1] = p[1]; cam.pos[2] = p[2];
    cam.yaw = Math.atan2(dx, -dz);
    cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    cam.roll = 0;
    // Zoom: keep the car about `frame` metres tall in the picture (telephoto when far).
    const want = Math.max(6, Math.min(55, (2 * Math.atan(C.frame / Math.max(1, d)) * 180) / Math.PI));
    this.fov += (want - this.fov) * Math.min(1, dt * 3);
    if (this.held === 0 || Math.abs(want - this.fov) > 30) this.fov = want;
    return this.fov;
  }
}

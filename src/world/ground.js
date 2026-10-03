// Ground probe: maps a world (x, z) point to track coordinates (distance, lateral offset) and returns
// the surface height, normal, surface kind and lateral limits (walls, tunnel, bridge rails, end of the
// terrain ribbon). Keeps a per-slot hint so successive queries are local. No allocation per query.
import { SEG, sampleIndex } from './track.js';
import { SURFACE } from '../vehicle/tyres.js';

const MAX_WALK = 64;
/** Hint slots: cars use CAR_SLOTS each from 0, cameras/assists/scenery use the fixed slots below. */
export const SLOTS = 128;
export const CAR_SLOTS = 8;
export const SLOT = { CAM: 120, CAM_CAR: 121, CAM_TEST: 122, ASSIST: 123, SCENERY: 124, SCENERY_LINE: 125, MISC: 126 };

export class GroundProbe {
  /**
   * @param {import('./track.js').Track} track @param {import('./terrain.js').Terrain} terrain
   * @param {object} cfg CONFIG.track
   */
  constructor(track, terrain, cfg) {
    this.track = track;
    this.terrain = terrain;
    this.cfg = cfg;
    this.hints = new Int32Array(SLOTS).fill(-1);
    this.lineLeft = null;
    this.lineRight = null;
    this.lim = { limL: 0, limR: 0 };
    // Scratch results of locate().
    this.i = 0; this.t = 0; this.lat = 0; this.rx = 1; this.rz = 0; this.cx = 0; this.cz = 0;
  }

  /**
   * Fills `out` with ground data under (x, z).
   * @param {number} x @param {number} z @param {import('../vehicle/physics.js').GroundSample} out
   * @param {number} [slot=0] hint slot (one per wheel / camera)
   * @returns {typeof out}
   */
  sample(x, z, out, slot = 0) {
    this.locate(x, z, slot);
    const { track, terrain } = this, i = this.i, lat = this.lat;
    const y = this.height(this.solidLat());
    const e = 0.5;
    const yx = this.heightAt(x + e, z, slot), yz = this.heightAt(x, z + e, slot);
    this.locate(x, z, slot);
    let nx = -(yx - y) / e, nz = -(yz - y) / e;
    const nl = Math.hypot(nx, 1, nz);
    out.y = y; out.nx = nx / nl; out.ny = 1 / nl; out.nz = nz / nl;
    const seg = track.seg[this.segIndex(i)], hw = track.def.width / 2, al = Math.abs(lat);
    if (al <= hw) out.surface = SURFACE.ASPHALT;
    else if (al <= terrain.edgeLat) out.surface = seg & (lat < 0 ? SEG.KERB_L : SEG.KERB_R) ? SURFACE.KERB : SURFACE.ASPHALT;
    else out.surface = out.ny < 0.8 ? SURFACE.DIRT : SURFACE.GRASS;
    this.limits(out, seg);
    out.lat = lat; out.rx = this.rx; out.rz = this.rz; out.bounded = true;
    out.s = (i + this.t) * track.ds;
    out.tunnel = (seg & SEG.TUNNEL) !== 0;
    out.ceiling = this.height(0) + this.cfg.tunnelHeight;
    return out;
  }

  /** Height only (used for normals and camera clearance). */
  /**
   * Height only. `solid` (default) clamps to the drivable band like wheel contacts; false returns the
   * real terrain surface (scenery placement, camera clearance).
   * @param {number} x @param {number} z @param {number} [slot=0] @param {boolean} [solid=true]
   * @returns {number}
   */
  heightAt(x, z, slot = 0, solid = true) {
    this.locate(x, z, slot);
    return this.height(solid ? this.solidLat() : this.lat);
  }

  // Lateral offset clamped to the drivable band: a point beyond a wall, tunnel side, bridge rail or
  // steep bank takes the height at that limit (a wheel cannot stand on the far side of a wall).
  solidLat() {
    this.limits(this.lim, this.track.seg[this.segIndex(this.i)]);
    return Math.max(this.lim.limL, Math.min(this.lim.limR, this.lat));
  }

  segIndex(i) {
    const n = this.track.segments;
    return this.track.closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i));
  }

  /**
   * Extra lateral limits per segment from solid line strips (guardrails, fences, pit wall).
   * @param {{ left: Float32Array, right: Float32Array }} limits
   */
  setLineLimits(limits) {
    this.lineLeft = limits.left;
    this.lineRight = limits.right;
  }

  limits(out, seg) {
    const e = this.terrain.edgeLat, idx = sampleIndex(this.track, this.i);
    if (seg & (SEG.TUNNEL | SEG.BRIDGE)) { out.limL = -e; out.limR = e; return; }
    // Off-road limit: before the ribbon starts to dive under the base terrain (steep, not drivable).
    const last = this.terrain.dist.length - 1, dive = this.cfg.ribbonWidth > 20 ? 16 : 4;
    const te = this.terrain, idx2 = sampleIndex(this.track, this.i + 1);
    // The next sample counts too: no climbing half a segment up a bank (this also closes the segment
    // in front of a tunnel portal, where the cross wall collider sits).
    const reach = (side) => Math.min(Math.max(4, te.columnDist(idx, side, last) - dive), te.drivable(idx, side), te.drivable(idx2, side));
    out.limL = seg & SEG.WALL_L ? -(e + 0.3) : -(e + reach(-1));
    out.limR = seg & SEG.WALL_R ? e + 0.3 : e + reach(1);
    if (this.lineLeft) {
      const k = this.segIndex(this.i);
      out.limL = Math.max(out.limL, this.lineLeft[k]);
      out.limR = Math.min(out.limR, this.lineRight[k]);
    }
  }

  // Walks segments from the hint until (x, z) projects inside one; full search when lost.
  locate(x, z, slot) {
    const tr = this.track, P = tr.pos;
    let i = this.hints[slot];
    if (i < 0) i = this.nearest(x, z);
    let dir = 0;
    for (let k = 0; ; k++) {
      const a = sampleIndex(tr, i) * 3, b = sampleIndex(tr, i + 1) * 3;
      const sx = P[b] - P[a], sz = P[b + 2] - P[a + 2];
      const t = ((x - P[a]) * sx + (z - P[a + 2]) * sz) / (sx * sx + sz * sz);
      const step = t > 1 && (tr.closed || i < tr.segments - 1) ? 1 : t < 0 && (tr.closed || i > 0) ? -1 : 0;
      // Stop inside a segment, or when the walk reverses (point outside a polyline corner).
      if (step === 0 || step === -dir || k > 4 * MAX_WALK) { this.t = Math.min(1, Math.max(0, t)); break; }
      if (k === MAX_WALK) { i = this.nearest(x, z); dir = 0; continue; }
      dir = step;
      i += step;
    }
    if (tr.closed) i = ((i % tr.segments) + tr.segments) % tr.segments;
    this.hints[slot] = i;
    this.i = i;
    const a = sampleIndex(tr, i) * 3, b = sampleIndex(tr, i + 1) * 3, t = this.t, R = tr.right;
    this.cx = P[a] + (P[b] - P[a]) * t;
    this.cz = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
    let rx = R[a] + (R[b] - R[a]) * t, rz = R[a + 2] + (R[b + 2] - R[a + 2]) * t;
    const rl = Math.hypot(rx, rz);
    this.rx = rx / rl; this.rz = rz / rl;
    this.lat = (x - this.cx) * this.rx + (z - this.cz) * this.rz;
  }

  nearest(x, z) {
    const P = this.track.pos;
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.track.count; i++) {
      const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 2] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return Math.min(best, this.track.segments - 1);
  }

  // Surface height at lateral offset lat on the located segment.
  height(lat) {
    const tr = this.track, t = this.t;
    return this.columnHeight(sampleIndex(tr, this.i), lat) * (1 - t) + this.columnHeight(sampleIndex(tr, this.i + 1), lat) * t;
  }

  columnHeight(idx, lat) {
    const tr = this.track, te = this.terrain, k = idx * 3, e = te.edgeLat, al = Math.abs(lat);
    const rh = Math.hypot(tr.right[k], tr.right[k + 2]);
    if (al <= e) return tr.pos[k + 1] + (tr.right[k + 1] * lat) / rh;
    const side = lat < 0 ? -1 : 1, d = al - e, cols = te.dist.length;
    let j = 0;
    while (j < cols - 2 && te.columnDist(idx, side, j + 1) < d) j++;
    const d0 = te.columnDist(idx, side, j), d1 = te.columnDist(idx, side, j + 1);
    const u = Math.min(1, Math.max(0, (d - d0) / (d1 - d0)));
    return te.profileY(idx, side, j) * (1 - u) + te.profileY(idx, side, j + 1) * u;
  }
}

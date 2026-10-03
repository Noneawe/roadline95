// Racing line for AI: lateral offsets that minimise the curvature within the carriageway (fourth-difference
// relaxation, coarse then fine: wide entry, apex, wide exit), plus a speed profile from the available
// cornering grip with braking (backward) and acceleration (forward) passes. Pure data, no DOM/GL.
import { sampleIndex } from './track.js';

/**
 * @typedef {object} RacingLine
 * @property {Float32Array} offset lateral offset from the centreline per sample (m, + = right)
 * @property {Float32Array} speed target speed per sample (m/s)
 * @property {Float32Array} curvature line curvature per sample (1/m)
 * @property {Float32Array} x line point x per sample @property {Float32Array} z line point z per sample
 */

/**
 * Builds the racing line.
 * @param {import('./track.js').Track} track
 * @param {{ margin: number, iterations: number, coarse: number, grip: number, brake: number, accel: number, vmax: number,
 *   latBoost: (v: number) => number }} cfg
 * @returns {RacingLine}
 */
export function buildRacingLine(track, cfg) {
  const n = track.count, P = track.pos, R = track.right;
  const rx = new Float32Array(n), rz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = Math.hypot(R[i * 3], R[i * 3 + 2]);
    rx[i] = R[i * 3] / l; rz[i] = R[i * 3 + 2] / l;
  }
  const limit = track.def.width / 2 - cfg.margin;
  const off = new Float32Array(n), at = (i) => sampleIndex(track, i);
  const px = (i) => P[at(i) * 3] + rx[at(i)] * off[at(i)], pz = (i) => P[at(i) * 3 + 2] + rz[at(i)] * off[at(i)];
  // Minimum curvature (fourth-difference relaxation, the gradient of the summed squared curvature) on a
  // coarse grid first - it converges slowly on the full-resolution samples - then refined at full detail.
  // Sprint: coarse points include both ends, which stay fixed on the centreline.
  const coarse = Math.max(1, cfg.coarse), closed = track.closed;
  const m = closed ? Math.floor(n / coarse) : Math.floor((n - 1) / coarse) + 1;
  if (m >= 8) {
    const co = new Float32Array(m), cj = (j) => (closed ? ((j % m) + m) % m : Math.min(m - 1, Math.max(0, j))), ci = (j) => cj(j) * coarse;
    const cx = (j) => P[ci(j) * 3] + rx[ci(j)] * co[cj(j)], cz = (j) => P[ci(j) * 3 + 2] + rz[ci(j)] * co[cj(j)];
    for (let it = 0; it < cfg.iterations * 10; it++) {
      for (let j = 0; j < m; j++) {
        if (!closed && (j < 2 || j > m - 3)) continue;
        const tx = (-cx(j - 2) + 4 * cx(j - 1) + 4 * cx(j + 1) - cx(j + 2)) / 6;
        const tz = (-cz(j - 2) + 4 * cz(j - 1) + 4 * cz(j + 1) - cz(j + 2)) / 6, i = ci(j);
        const want = (tx - P[i * 3]) * rx[i] + (tz - P[i * 3 + 2]) * rz[i];
        co[j] = Math.max(-limit, Math.min(limit, co[j] + (want - co[j]) * 0.5));
      }
    }
    for (let i = 0; i < n; i++) {
      const f = i / coarse, j = Math.floor(f), u = f - j;
      off[i] = co[cj(j)] * (1 - u) + co[cj(j + 1)] * u;
    }
  }
  for (let it = 0; it < cfg.iterations; it++) {
    for (let i = 0; i < n; i++) {
      if (!track.closed && (i < 2 || i > n - 3)) continue;
      const tx = (-px(i - 2) + 4 * px(i - 1) + 4 * px(i + 1) - px(i + 2)) / 6;
      const tz = (-pz(i - 2) + 4 * pz(i - 1) + 4 * pz(i + 1) - pz(i + 2)) / 6;
      const want = (tx - P[i * 3]) * rx[i] + (tz - P[i * 3 + 2]) * rz[i];
      off[i] = Math.max(-limit, Math.min(limit, off[i] + (want - off[i]) * 0.5));
    }
  }
  // Clamping leaves small kinks where the line meets the edge: smooth the offsets themselves.
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -3; d <= 3; d++) sum += off[at(i + d)];
      tmp[i] = Math.max(-limit, Math.min(limit, sum / 7));
    }
    off.set(tmp);
  }
  const x = new Float32Array(n), z = new Float32Array(n), curvature = new Float32Array(n);
  for (let i = 0; i < n; i++) { x[i] = px(i); z[i] = pz(i); }
  for (let i = 0; i < n; i++) {
    const a = at(i - 2), b = at(i), c = at(i + 2);
    const ax = x[b] - x[a], az = z[b] - z[a], bx = x[c] - x[b], bz = z[c] - z[b];
    // Sprint ends: a clamped neighbour gives a zero-length chord (atan2(-0, -0) would be pi).
    const ang = a === b || b === c ? 0 : Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
    curvature[i] = ang / Math.max(0.5, (Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2);
  }
  const line = { offset: off, curvature, x, z, speed: null };
  line.speed = speedProfile(track, line, cfg);
  return line;
}

/**
 * Target speed along a racing line for given grip, braking, acceleration and top speed (per car).
 * @param {import('./track.js').Track} track @param {RacingLine} line
 * @param {{ grip: number, brake: number, accel: number, vmax: number, latBoost: (v: number) => number }} cfg
 * @returns {Float32Array}
 */
export function speedProfile(track, line, cfg) {
  const { curvature, x, z } = line;
  const n = track.count, v = new Float32Array(n), at = (i) => sampleIndex(track, i);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let d = -2; d <= 2; d++) k = Math.max(k, Math.abs(curvature[at(i + d)]));
    let s = cfg.vmax;
    for (let it = 0; it < 6; it++) s = Math.min(cfg.vmax, Math.sqrt((cfg.grip * cfg.latBoost(s)) / Math.max(k, 1e-5)));
    v[i] = s;
  }
  for (const h of track.def.aiHints || []) {
    for (let i = 0; i < n; i++) if (Math.abs(i * track.ds - h.pos) < 25) v[i] *= h.brake;
  }
  const seg = (i) => Math.hypot(x[at(i + 1)] - x[at(i)], z[at(i + 1)] - z[at(i)]);
  const passes = track.closed ? 2 : 1;
  for (let p = 0; p < passes; p++) {
    for (let i = n - 1; i >= 0; i--) {
      if (!track.closed && i === n - 1) continue;
      v[i] = Math.min(v[i], Math.sqrt(v[at(i + 1)] ** 2 + 2 * cfg.brake * seg(i)));
    }
    for (let i = 0; i < n; i++) {
      if (!track.closed && i === n - 1) continue;
      const j = at(i + 1), acc = cfg.accel * Math.max(0.15, 1 - v[i] / cfg.vmax);
      v[j] = Math.min(v[j], Math.sqrt(v[i] ** 2 + 2 * acc * seg(i)));
    }
  }
  return v;
}

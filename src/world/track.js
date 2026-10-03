// Track builder: validates a track definition (CLAUDE.md 11), integrates its pieces into evenly spaced
// centreline samples with banked frames and closes circuits by correcting the last piece.
// Pure data, no DOM/GL. Headings follow the camera convention: 0 = -Z, positive curve turns right.

/** Per-segment flags (segment i joins samples i and i+1). */
export const SEG = { TUNNEL: 1, BRIDGE: 2, WALL_L: 4, WALL_R: 8, KERB_L: 16, KERB_R: 32, START: 64, FINISH: 128 };

const SIDES = ['left', 'right', 'both'];
const FRAME_KEYS = ['pos', 'fwd', 'right', 'up'];
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Checks a track definition; returns a list of problems (empty = valid).
 * @param {object} def
 * @returns {string[]}
 */
export function validateTrack(def) {
  const err = [];
  if (typeof def.id !== 'string' || !def.id) err.push('id missing');
  if (def.type !== 'circuit' && def.type !== 'sprint') err.push(`type must be circuit|sprint, got ${def.type}`);
  if (!(def.width > 4)) err.push('width must be > 4 m');
  if (def.type === 'circuit' && def.closeLoop !== true) err.push('circuit needs closeLoop: true');
  if (!Array.isArray(def.pieces) || def.pieces.length < 2) err.push('at least 2 pieces required');
  (def.pieces || []).forEach((p, k) => {
    if (!(p.len > 0)) err.push(`piece ${k}: len must be > 0`);
    for (const key of ['curve', 'grade', 'bank']) {
      if (p[key] !== undefined && !Number.isFinite(p[key])) err.push(`piece ${k}: ${key} not a number`);
    }
    for (const key of ['walls', 'kerbs']) {
      if (p[key] !== undefined && !SIDES.includes(p[key])) err.push(`piece ${k}: ${key} must be left|right|both`);
    }
    if (p.tunnel && p.bridge) err.push(`piece ${k}: tunnel and bridge are exclusive`);
  });
  if ((def.pieces || []).filter((p) => p.startLine).length !== 1) err.push('exactly one piece needs startLine');
  if (def.type === 'sprint') {
    const s = (def.pieces || []).findIndex((p) => p.startLine), f = (def.pieces || []).findIndex((p) => p.finishLine);
    if ((def.pieces || []).filter((p) => p.finishLine).length !== 1 || f <= s) err.push('sprint needs one finishLine piece after the startLine piece');
  }
  (def.scenery || []).forEach((r, k) => err.push(...validateSceneryRule(r).map((e) => `scenery ${k}: ${e}`)));
  return err;
}

/**
 * Checks one scenery rule (track or zone); object/sprite names are checked when the scenery is built.
 * @param {object} r
 * @returns {string[]}
 */
export function validateSceneryRule(r) {
  const err = [];
  if (!['every', 'range', 'line'].includes(r.rule)) err.push(`rule must be every|range|line, got ${r.rule}`);
  if (!r.obj && !r.sprite) err.push('obj or sprite required');
  if (r.rule === 'line' && !r.obj) err.push('line rules need obj');
  if (r.side !== undefined && !SIDES.includes(r.side)) err.push('side must be left|right|both');
  const off = Array.isArray(r.offset) ? r.offset : [r.offset];
  if (!off.every((v) => Number.isFinite(v) && v >= 0) || (Array.isArray(r.offset) && r.offset.length !== 2)) err.push('offset must be m or [min, max]');
  if (r.spacing !== undefined && !(r.spacing > 0)) err.push('spacing must be > 0');
  if (r.from !== undefined && r.to !== undefined && !(r.to > r.from)) err.push('to must be > from');
  return err;
}

/**
 * @typedef {object} Track
 * @property {object} def
 * @property {boolean} closed
 * @property {number} length total length (m)
 * @property {number} ds sample spacing (m)
 * @property {number} count number of samples (closed: = segments, sprint: segments + 1)
 * @property {number} segments
 * @property {Float32Array} pos sample centre positions (xyz)
 * @property {Float32Array} fwd unit forward vectors
 * @property {Float32Array} right banked right vectors
 * @property {Float32Array} up banked up vectors
 * @property {Float32Array} curvature signed curvature (1/m) per sample
 * @property {Uint8Array} seg SEG flags per segment
 * @property {string[]} surface texture name per segment
 * @property {{ from: number, to: number }[]} tunnels distance ranges
 * @property {{ from: number, to: number }[]} bridges distance ranges
 * @property {number} startS distance of the start line
 * @property {number} finishS distance of the finish line (sprint; = startS on circuits)
 * @property {{ pos: number, heading: number, height: number, dx: number, dz: number }} closure error corrected on the last piece
 */

/**
 * Builds the sampled track.
 * @param {object} def track definition
 * @param {{ cell: number, blend: number, closeTol: { pos: number, height: number, headingDeg: number } }} cfg
 * @returns {Track}
 */
export function buildTrack(def, cfg) {
  const errors = validateTrack(def);
  if (errors.length) throw new Error(`Track ${def.id}: ${errors.join('; ')}`);
  const pieces = def.pieces, closed = def.type === 'circuit';
  const starts = [];
  let length = 0;
  for (const p of pieces) { starts.push(length); length += p.len; }
  const n = Math.max(8, Math.round(length / cfg.cell)), ds = length / n;
  const pieceAt = (s) => {
    let k = pieces.length - 1;
    while (k > 0 && starts[k] > s) k--;
    return k;
  };
  const param = (s, key) => {
    const k = pieceAt(s), prev = k > 0 ? pieces[k - 1] : closed ? pieces[pieces.length - 1] : pieces[0];
    const t = smoothstep(0, Math.min(cfg.blend, pieces[k].len / 2), s - starts[k]);
    return (prev[key] || 0) + ((pieces[k][key] || 0) - (prev[key] || 0)) * t;
  };

  // Heading (rad) and horizontal/vertical integration with midpoint rule.
  const h = new Float64Array(n + 1), grade = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const sm = (i + 0.5) * ds;
    h[i + 1] = h[i] + ((param(sm, 'curve') * Math.PI) / 180 / 100) * ds;
    grade[i] = param(sm, 'grade') / 100;
  }
  const lastStart = starts[starts.length - 1];
  const weight = (i) => (closed ? smoothstep(lastStart, length, i * ds) : 0);
  const closure = { pos: 0, heading: 0, height: 0, dx: 0, dz: 0 };
  if (closed) {
    const turns = Math.round(h[n] / (Math.PI * 2));
    if (turns === 0) throw new Error(`Track ${def.id}: circuit does not turn a full loop`);
    const eh = h[n] - turns * Math.PI * 2;
    closure.heading = (eh * 180) / Math.PI;
    if (Math.abs(closure.heading) > cfg.closeTol.headingDeg) throw new Error(`Track ${def.id}: heading misses by ${closure.heading.toFixed(1)} deg`);
    for (let i = 0; i <= n; i++) h[i] -= eh * weight(i);
  }
  const P = new Float64Array((n + 1) * 3);
  for (let i = 0; i < n; i++) {
    const hm = (h[i] + h[i + 1]) / 2, horiz = ds / Math.sqrt(1 + grade[i] * grade[i]);
    P[(i + 1) * 3] = P[i * 3] + Math.sin(hm) * horiz;
    P[(i + 1) * 3 + 1] = P[i * 3 + 1] + grade[i] * horiz;
    P[(i + 1) * 3 + 2] = P[i * 3 + 2] - Math.cos(hm) * horiz;
  }
  if (closed) {
    const ex = P[n * 3], ey = P[n * 3 + 1], ez = P[n * 3 + 2];
    closure.pos = Math.hypot(ex, ez);
    closure.dx = ex;
    closure.dz = ez;
    closure.height = ey;
    if (closure.pos > cfg.closeTol.pos || Math.abs(ey) > cfg.closeTol.height) {
      throw new Error(`Track ${def.id}: loop misses by ${closure.pos.toFixed(1)} m / ${ey.toFixed(1)} m height`);
    }
    for (let i = 0; i <= n; i++) {
      const w = weight(i);
      P[i * 3] -= ex * w; P[i * 3 + 1] -= ey * w; P[i * 3 + 2] -= ez * w;
    }
  }
  return frames(def, P, n, ds, closed, length, param, pieceAt, starts, closure);
}

function frames(def, P, n, ds, closed, length, param, pieceAt, starts, closure) {
  const count = closed ? n : n + 1;
  const pos = new Float32Array(count * 3), fwd = new Float32Array(count * 3);
  const right = new Float32Array(count * 3), up = new Float32Array(count * 3), curvature = new Float32Array(count);
  const at = (i, k) => P[(closed ? ((i % n) + n) % n : Math.min(n, Math.max(0, i))) * 3 + k];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) pos[i * 3 + k] = at(i, k);
    let fx = at(i + 1, 0) - at(i - 1, 0), fy = at(i + 1, 1) - at(i - 1, 1), fz = at(i + 1, 2) - at(i - 1, 2);
    const fl = Math.hypot(fx, fy, fz);
    fx /= fl; fy /= fl; fz /= fl;
    const rl = Math.hypot(fx, fz), rx = -fz / rl, rz = fx / rl;
    const ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // cross(right, fwd)
    const b = (param(i * ds, 'bank') * Math.PI) / 180, cb = Math.cos(b), sb = Math.sin(b);
    fwd.set([fx, fy, fz], i * 3);
    right.set([rx * cb - ux * sb, -uy * sb, rz * cb - uz * sb], i * 3);
    up.set([ux * cb + rx * sb, uy * cb, uz * cb + rz * sb], i * 3);
    curvature[i] = ((param(i * ds, 'curve') * Math.PI) / 180) / 100;
  }
  const seg = new Uint8Array(n), surface = [];
  const sideFlag = (v, l, r) => (v === 'left' ? l : v === 'right' ? r : v === 'both' ? l | r : 0);
  for (let i = 0; i < n; i++) {
    const k = pieceAt((i + 0.5) * ds), p = def.pieces[k];
    seg[i] = (p.tunnel ? SEG.TUNNEL : 0) | (p.bridge ? SEG.BRIDGE : 0)
      | sideFlag(p.walls, SEG.WALL_L, SEG.WALL_R) | sideFlag(p.kerbs, SEG.KERB_L, SEG.KERB_R)
      | (p.startLine && i === Math.round(starts[k] / ds) ? SEG.START : 0)
      | (p.finishLine && i === Math.round(starts[k] / ds) ? SEG.FINISH : 0);
    surface.push(p.surface || def.surface || 'asphalt0');
  }
  const ranges = (key) => def.pieces.map((p, k) => (p[key] ? { from: starts[k], to: starts[k] + p.len } : null)).filter(Boolean);
  const startS = starts[def.pieces.findIndex((p) => p.startLine)];
  const fin = def.pieces.findIndex((p) => p.finishLine), finishS = fin >= 0 ? starts[fin] : startS;
  return {
    def, closed, length, ds, count, segments: n, pos, fwd, right, up, curvature, seg, surface,
    tunnels: ranges('tunnel'), bridges: ranges('bridge'), startS, finishS, closure,
  };
}

/**
 * Wraps (circuit) or clamps (sprint) an unwrapped sample index.
 * @param {Track} track @param {number} i
 * @returns {number}
 */
export function sampleIndex(track, i) {
  return track.closed ? ((i % track.count) + track.count) % track.count : Math.min(track.count - 1, Math.max(0, i));
}

/**
 * Point at sample i offset laterally (banked right) and vertically (banked up).
 * @param {Track} track @param {number} i unwrapped sample index @param {number} lat @param {number} upOff
 * @returns {number[]}
 */
export function trackPoint(track, i, lat, upOff = 0) {
  const k = sampleIndex(track, i) * 3, { pos, right, up } = track;
  return [
    pos[k] + right[k] * lat + up[k] * upOff,
    pos[k + 1] + right[k + 1] * lat + up[k + 1] * upOff,
    pos[k + 2] + right[k + 2] * lat + up[k + 2] * upOff,
  ];
}

/**
 * Interpolated centreline frame at distance s (wraps on circuits). Writes into out (no allocation).
 * @param {Track} track @param {number} s
 * @param {{ pos: number[], fwd: number[], right: number[], up: number[] }} out
 * @returns {typeof out}
 */
export function frameAt(track, s, out) {
  const L = track.length;
  const ss = track.closed ? ((s % L) + L) % L : Math.min(L, Math.max(0, s));
  const f = ss / track.ds, i0 = Math.floor(f), t = f - i0;
  const a = sampleIndex(track, i0) * 3, b = sampleIndex(track, i0 + 1) * 3;
  for (const key of FRAME_KEYS) {
    const src = track[key], dst = out[key];
    for (let k = 0; k < 3; k++) dst[k] = src[a + k] + (src[b + k] - src[a + k]) * t;
  }
  return out;
}

/**
 * True if distance s lies in one of the ranges (circuit distances wrap).
 * @param {Track} track @param {{ from: number, to: number }[]} ranges @param {number} s
 * @returns {boolean}
 */
export function inRanges(track, ranges, s) {
  const L = track.length, ss = track.closed ? ((s % L) + L) % L : s;
  return ranges.some((r) => ss >= r.from - 1e-6 && ss <= r.to + 1e-6);
}

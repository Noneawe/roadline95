// Track chunks: builds static meshes (road, kerbs, centre line, start line, terrain ribbon, walls,
// tunnels, bridges) for consecutive runs of track segments. Every vertex comes from shared sample
// functions, so neighbouring chunks meet without cracks. Pure data, no DOM/GL.
import { SEG, trackPoint, sampleIndex } from './track.js';
import { MeshBuilder } from './meshbuild.js';
import { slopeY } from './terrain.js';
import { FLAGS } from '../gfx/shaders/world.js';

const { GOURAUD, CUTOUT, DOUBLE, DECAL } = FLAGS;
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const neg = (v) => [-v[0], -v[1], -v[2]];
const DEFAULT_GROUND = { flat: 'grass', mid: 'dirt', steep: 'rock' };

/**
 * Texture repeat length adjusted so a closed loop holds a whole number of repeats (no seam at the start).
 * @param {import('./track.js').Track} track @param {number} repeat
 * @returns {number}
 */
export function loopRepeat(track, repeat) {
  return track.closed ? track.length / Math.max(1, Math.round(track.length / repeat)) : repeat;
}

/**
 * Builds all track chunks.
 * @param {import('./track.js').Track} track @param {import('./terrain.js').Terrain} terrain
 * @param {object} cfg CONFIG.track @param {(tex: string) => number} layerOf
 * @param {{ flat: string, mid: string, steep: string }} [ground] zone terrain textures
 * @param {number} [rowStep] 2 builds the far LOD (every other sample row; chunk boundaries unchanged)
 * @returns {import('../models/loader.js').MeshData[]}
 */
export function buildChunks(track, terrain, cfg, layerOf, ground = DEFAULT_GROUND, rowStep = 1) {
  const per = Math.max(4, Math.round(cfg.chunkLen / track.ds));
  const ctx = makeContext(track, terrain, cfg, layerOf);
  ctx.ground = ground;
  ctx.rowStep = rowStep;
  const chunks = [];
  for (let i0 = 0; i0 < track.segments; i0 += per) {
    chunks.push(buildChunk(ctx, i0, Math.min(track.segments, i0 + per)));
  }
  return chunks;
}

function makeContext(track, terrain, cfg, layerOf) {
  const mats = new Map();
  const mat = (tex, flags = GOURAUD) => {
    const key = `${tex}:${flags}`;
    if (!mats.has(key)) {
      const layer = layerOf(tex);
      if (layer === undefined) throw new Error(`Track texture missing: ${tex}`);
      mats.set(key, { layer, flags });
    }
    return mats.get(key);
  };
  const hw = track.def.width / 2;
  const roadCols = Math.ceil(track.def.width / cfg.cell) + 1;
  const segOf = (r) => (track.closed ? ((r % track.segments) + track.segments) % track.segments : r);
  const rep = {
    road: loopRepeat(track, cfg.roadRepeat), kerb: loopRepeat(track, cfg.kerbRepeat),
    line: loopRepeat(track, cfg.lineRepeat), wall: loopRepeat(track, cfg.wallRepeat),
  };
  return { track, terrain, cfg, mat, hw, roadCols, segOf, rep, flag: (r, f) => (track.seg[segOf(r)] & f) !== 0 };
}

function buildChunk(ctx, i0, i1) {
  const { track, mat, hw, roadCols, segOf, rep, terrain } = ctx;
  const b = new MeshBuilder(ctx.rowStep);
  const ds = track.ds;
  // v measured from a whole number of repeats before the chunk start keeps float precision.
  const vOf = (r, repeat) => (r * ds - Math.floor((i0 * ds) / repeat) * repeat) / repeat;
  const lat = (c) => -hw + (track.def.width * c) / (roadCols - 1);

  b.grid({
    r0: i0, r1: i1, cols: roadCols,
    pos: (r, c) => trackPoint(track, r, lat(c)),
    uv: (r, c) => [c / (roadCols - 1), vOf(r, rep.road)],
    mat: (r) => mat(track.surface[segOf(r)]),
  });
  for (const side of [-1, 1]) {
    const e = terrain.edgeLat;
    b.grid({
      r0: i0, r1: i1, cols: 2,
      pos: (r, c) => trackPoint(track, r, side < 0 ? (c === 0 ? -e : -hw) : (c === 0 ? hw : e)),
      uv: (r, c) => [side < 0 ? 1 - c : c, vOf(r, rep.kerb)],
      mat: (r) => (ctx.flag(r, side < 0 ? SEG.KERB_L : SEG.KERB_R) ? mat('kerb') : mat('lineEdge')),
    });
    terrainSide(ctx, b, i0, i1, side);
  }
  b.grid({
    r0: i0, r1: i1, cols: 2,
    pos: (r, c) => trackPoint(track, r, c ? 0.12 : -0.12, 0.01),
    uv: (r, c) => [c, vOf(r, rep.line)],
    mat: () => mat('lineCenter', GOURAUD | CUTOUT | DECAL),
  });
  for (let r = i0; r < i1; r++) {
    if (!ctx.flag(r, SEG.START | SEG.FINISH)) continue;
    b.grid({
      r0: r, r1: r + 1, cols: roadCols,
      pos: (rr, c) => trackPoint(track, rr, lat(c), 0.01),
      uv: (rr, c) => [c / (roadCols - 1), rr - r],
      mat: () => mat('startLine', GOURAUD | DECAL),
    });
  }
  for (const [a, z] of runs(ctx, i0, i1, SEG.TUNNEL)) tunnel(ctx, b, a, z, vOf);
  for (const [a, z] of runs(ctx, i0, i1, SEG.BRIDGE)) bridge(ctx, b, a, z, vOf);
  for (const side of [-1, 1]) {
    for (const [a, z] of runs(ctx, i0, i1, side < 0 ? SEG.WALL_L : SEG.WALL_R)) wall(ctx, b, a, z, side, vOf);
  }
  return b.build();
}

// Maximal runs [a, z) of segments in [i0, i1) carrying flag f.
function runs(ctx, i0, i1, f) {
  const out = [];
  for (let r = i0; r < i1; r++) {
    if (!ctx.flag(r, f)) continue;
    let z = r;
    while (z < i1 && ctx.flag(z, f)) z++;
    out.push([r, z]);
    r = z;
  }
  return out;
}

function terrainSide(ctx, b, i0, i1, side) {
  const { terrain, mat, cfg, track } = ctx;
  const cols = terrain.dist.length, j = (c) => (side < 0 ? cols - 1 - c : c);
  b.grid({
    r0: i0, r1: i1, cols,
    pos: (r, c) => terrain.profilePoint(r, side, j(c)),
    uv: (r, c, p) => [p[0] / cfg.terrainRepeat, p[2] / cfg.terrainRepeat],
    mat: (r, c, q) => {
      const inner = side < 0 ? c === cols - 2 : c === 0;
      const g = ctx.ground;
      if (inner && !terrain.tunnel[sampleIndex(track, r)]) return mat(g.flat);
      const ny = slopeY(q);
      return ny < 0.6 ? mat(g.steep) : ny < 0.82 ? mat(g.mid) : mat(g.flat);
    },
  });
}

function tunnel(ctx, b, a, z, vOf) {
  const { track, terrain, mat, cfg, roadCols, rep } = ctx;
  const H = cfg.tunnelHeight, e = terrain.edgeLat;
  const lift = (p, h) => [p[0], p[1] + h, p[2]];
  const wallMat = mat('tunnelWall');
  for (const side of [-1, 1]) {
    b.grid({
      r0: a, r1: z, cols: 3, flip: side < 0,
      pos: (r, c) => lift(trackPoint(track, r, side * e), (H * c) / 2),
      uv: (r, c) => [vOf(r, rep.wall), ((2 - c) * H) / 2 / cfg.wallRepeat],
      mat: () => wallMat,
    });
  }
  const ceil = (r, c) => lerp3(lift(trackPoint(track, r, -e), H), lift(trackPoint(track, r, e), H), c / (roadCols - 1));
  const roof = (r, c) => lerp3(terrain.profilePoint(r, -1, 1), terrain.profilePoint(r, 1, 1), c / (roadCols - 1));
  const span = (2 * e) / cfg.wallRepeat;
  b.grid({ r0: a, r1: z, cols: roadCols, flip: true, pos: ceil, uv: (r, c) => [(c / (roadCols - 1)) * span, vOf(r, rep.wall)], mat: () => wallMat });
  b.grid({ r0: a, r1: z, cols: roadCols, pos: roof, uv: (r, c, p) => [p[0] / cfg.terrainRepeat, p[2] / cfg.terrainRepeat], mat: () => mat(ctx.ground.flat) });
  const portal = (r, want) => {
    for (let c = 0; c + 1 < roadCols; c++) {
      const pts = [ceil(r, c), ceil(r, c + 1), roof(r, c + 1), roof(r, c)];
      b.quad(pts, pts.map((p, k) => [(c + (k === 1 || k === 2 ? 1 : 0)) * 0.5, k < 2 ? 1 : 0]), mat('concrete'), want);
    }
  };
  const f = (r) => { const k = sampleIndex(track, r) * 3; return [track.fwd[k], track.fwd[k + 1], track.fwd[k + 2]]; };
  // Wing walls: the ribbon rises from road level to the wall top over the segment next to a portal;
  // close the vertical triangle under that slope on the road side.
  const wing = (outside, portalRow) => {
    for (const side of [-1, 1]) {
      const k = sampleIndex(track, portalRow) * 3, inward = [-side * track.right[k], 0, -side * track.right[k + 2]];
      const lo = trackPoint(track, outside, side * e), hi = lift(trackPoint(track, portalRow, side * e), H);
      b.tri([lo, trackPoint(track, portalRow, side * e), hi], [[0, 1.6], [0.7, 1.6], [0.7, 0]], mat('concrete'), inward);
    }
  };
  if (!ctx.flag(a - 1, SEG.TUNNEL)) { portal(a, neg(f(a))); wing(a - 1, a); }
  if (!ctx.flag(z, SEG.TUNNEL)) { portal(z, f(z)); wing(z + 1, z); }
}

function bridge(ctx, b, a, z, vOf) {
  const { track, terrain, mat, cfg, rep } = ctx;
  const e = terrain.edgeLat, concrete = mat('concrete');
  b.grid({
    r0: a, r1: z, cols: 2,
    pos: (r, c) => terrain.profilePoint(r, c ? 1 : -1, 0),
    uv: (r, c, p) => [p[0] / cfg.terrainRepeat, p[2] / cfg.terrainRepeat],
    mat: () => mat('water'),
  });
  b.grid({ r0: a, r1: z, cols: 2, flip: true, pos: (r, c) => trackPoint(track, r, c ? e : -e, -1), uv: (r, c) => [c * 3, vOf(r, rep.wall)], mat: () => concrete });
  for (const side of [-1, 1]) {
    b.grid({
      r0: a, r1: z, cols: 2, flip: side > 0,
      pos: (r, c) => trackPoint(track, r, side * e, c - 1),
      uv: (r, c) => [vOf(r, rep.wall), (1 - c) / cfg.wallRepeat],
      mat: () => concrete,
    });
    b.grid({
      r0: a, r1: z, cols: 2,
      pos: (r, c) => trackPoint(track, r, side * e, c * 1.0),
      uv: (r, c) => [vOf(r, rep.kerb), 1 - c],
      mat: () => mat('barrier', GOURAUD | CUTOUT | DOUBLE),
    });
  }
  const every = Math.max(1, Math.round(cfg.pillarSpacing / track.ds));
  for (let r = a; r <= z; r++) {
    const idx = sampleIndex(track, r);
    if (r % every || terrain.ground[idx] > -3) continue;
    pillar(ctx, b, r, terrain.profilePoint(r, -1, 0)[1] - 1, concrete);
  }
}

function pillar(ctx, b, r, bottom, m) {
  const { track } = ctx, k = sampleIndex(track, r) * 3;
  const R = [track.right[k], 0, track.right[k + 2]], F = [track.fwd[k], 0, track.fwd[k + 2]];
  const top = trackPoint(track, r, 0, -1)[1], c = trackPoint(track, r, 0);
  const corner = (sr, sf, y) => [c[0] + R[0] * sr * 0.8 + F[0] * sf * 0.8, y, c[2] + R[2] * sr * 0.8 + F[2] * sf * 0.8];
  const h = (top - bottom) / 4;
  for (const [s1, f1, s2, f2, want] of [[-1, -1, 1, -1, neg(F)], [1, -1, 1, 1, R], [1, 1, -1, 1, F], [-1, 1, -1, -1, neg(R)]]) {
    b.quad([corner(s1, f1, bottom), corner(s2, f2, bottom), corner(s2, f2, top), corner(s1, f1, top)],
      [[0, h], [0.4, h], [0.4, 0], [0, 0]], m, want);
  }
}

function wall(ctx, b, a, z, side, vOf) {
  const { track, terrain, mat, cfg, rep } = ctx;
  const m = mat('concrete', 0), lat = side * (terrain.edgeLat + 0.3), t = side * cfg.wallThick;
  const H = cfg.wallHeight, hv = H / cfg.wallRepeat;
  for (let r = a; r < z; r++) {
    if (ctx.flag(r, SEG.TUNNEL)) continue;
    const k = sampleIndex(track, r) * 3, R = [track.right[k] * side, 0, track.right[k + 2] * side];
    const base = (rr, off) => { const p = trackPoint(track, rr, lat + off); return p; };
    const up = (p) => [p[0], p[1] + H, p[2]];
    const i0 = base(r, 0), i1 = base(r + 1, 0), o0 = base(r, t), o1 = base(r + 1, t);
    const u0 = vOf(r, rep.wall), u1 = vOf(r + 1, rep.wall);
    b.quad([i0, i1, up(i1), up(i0)], [[u0, hv], [u1, hv], [u1, 0], [u0, 0]], m, neg(R));
    b.quad([o0, o1, up(o1), up(o0)], [[u0, hv], [u1, hv], [u1, 0], [u0, 0]], m, R);
    b.quad([up(i0), up(i1), up(o1), up(o0)], [[u0, 0.1], [u1, 0.1], [u1, 0], [u0, 0]], m, [0, 1, 0]);
  }
}

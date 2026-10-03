// Terrain fitted to the track: a ribbon beside the road that starts exactly at the road edge (no cracks)
// and dives under a coarse base heightfield further out. Tunnels raise a mountain, bridges cut a valley.
// Pure data, no DOM/GL.
import { makeRng, hashString } from '../engine/rng.js';
import { valueNoise } from '../texgen/noise.js';
import { SEG, sampleIndex, trackPoint } from './track.js';
import { MeshBuilder } from './meshbuild.js';
import { FLAGS } from '../gfx/shaders/world.js';

const WORLD_TILE = 4096;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * @typedef {object} Terrain
 * @property {Float32Array} ground per-sample ground offset (mountain > 0, valley < 0)
 * @property {Uint8Array} tunnel per-sample flag: sample touches a tunnel segment
 * @property {Uint8Array} bridge per-sample flag: sample touches a bridge segment
 * @property {number[]} dist ribbon column distances from the road edge (m)
 * @property {number} edgeLat lateral offset of the ribbon start (road half width + kerb)
 * @property {(i: number, side: number, j: number) => number[]} profilePoint ribbon vertex
 * @property {(idx: number, side: number, j: number) => number} profileY ribbon vertex height (wrapped sample index)
 * @property {(idx: number, side: number, j: number) => number} columnDist ribbon column distance from the edge
 * @property {(idx: number, side: number) => number} drivable distance from the edge before the terrain gets too high
 * @property {(x: number, z: number) => number} baseHeight base heightfield
 */

/**
 * Prepares terrain functions for a track.
 * @param {import('./track.js').Track} track
 * @param {object} cfg CONFIG.track
 * @param {number} seed
 * @returns {Terrain}
 */
export function createTerrain(track, cfg, seed) {
  const rng = makeRng((seed ^ hashString('terrain')) >>> 0);
  const hillA = valueNoise(rng, 64), hillB = valueNoise(rng, 128), farN = valueNoise(rng, 16);
  const hills = (x, z) => (hillA(x / WORLD_TILE, z / WORLD_TILE) + 0.5 * hillB(x / WORLD_TILE, z / WORLD_TILE)) / 1.5 - 0.5;
  const n = track.count, ds = track.ds, L = track.length;
  const ground = new Float32Array(n), tunnel = new Uint8Array(n), bridge = new Uint8Array(n);
  const segFlag = (i, f) => {
    if (!track.closed && (i < 0 || i >= track.segments)) return false;
    return (track.seg[((i % track.segments) + track.segments) % track.segments] & f) !== 0;
  };
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    let g = 0;
    for (const t of track.tunnels) {
      let d = Math.max(t.from - s, s - t.to, 0);
      if (track.closed) d = Math.min(d, Math.max(t.from - L - s, s - (t.to - L), 0), Math.max(t.from + L - s, s - (t.to + L), 0));
      g = Math.max(g, cfg.tunnelMountain * (1 - smoothstep(0, cfg.tunnelRamp, d)));
    }
    for (const b of track.bridges) {
      if (s < b.from || s > b.to) continue;
      const t = (s - b.from) / (b.to - b.from);
      g -= cfg.bridgeDepth * smoothstep(0, 0.25, t) * smoothstep(0, 0.25, 1 - t);
    }
    ground[i] = g;
    tunnel[i] = segFlag(i - 1, SEG.TUNNEL) || segFlag(i, SEG.TUNNEL) ? 1 : 0;
    bridge[i] = segFlag(i - 1, SEG.BRIDGE) || segFlag(i, SEG.BRIDGE) ? 1 : 0;
  }

  const edgeLat = track.def.width / 2 + cfg.kerbWidth;
  // Base heightfield: lowest nearby "ground" (road edge minus drop, valleys under bridges). It never rises
  // for tunnels: its 32 m cells would cut through the tunnel; the ribbon and the roof form the mountain.
  const sx = new Float32Array(n), sz = new Float32Array(n), sg = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = trackPoint(track, i, -edgeLat), r = trackPoint(track, i, edgeLat);
    sx[i] = track.pos[i * 3];
    sz[i] = track.pos[i * 3 + 2];
    sg[i] = Math.min(l[1], r[1]) + Math.min(0, ground[i]) - cfg.baseDrop;
  }
  const baseHeight = (x, z) => {
    let dmin = Infinity;
    for (let i = 0; i < n; i++) dmin = Math.min(dmin, (sx[i] - x) ** 2 + (sz[i] - z) ** 2);
    dmin = Math.sqrt(dmin);
    const lim = (dmin + 60) ** 2;
    let h = Infinity;
    for (let i = 0; i < n; i++) if ((sx[i] - x) ** 2 + (sz[i] - z) ** 2 <= lim && sg[i] < h) h = sg[i];
    return h + farN(x / WORLD_TILE, z / WORLD_TILE) * cfg.farHillAmp * smoothstep(80, 400, dmin);
  };

  const W = cfg.ribbonWidth, dist = [];
  for (let d = 0; d < W - 1e-6; d += cfg.cell) dist.push(d);
  dist.push(W);
  // Inner side of tight curves: shrink the ribbon so cross-sections do not fold over.
  const scaleAt = (idx, side) => {
    const k = track.curvature[idx];
    return side * k > 0 ? Math.min(1, (0.7 / Math.abs(k)) / W) : 1;
  };

  const computePoint = (i, side, j) => {
    const idx = sampleIndex(track, i), edge = trackPoint(track, i, side * edgeLat);
    const g = ground[idx], H = cfg.tunnelHeight;
    if (j === 0) {
      if (tunnel[idx]) return [edge[0], edge[1] + H, edge[2]];
      if (bridge[idx]) return [edge[0], edge[1] + g, edge[2]];
      return edge;
    }
    const rx = track.right[idx * 3], rz = track.right[idx * 3 + 2], rl = Math.hypot(rx, rz);
    const scale = scaleAt(idx, side), d = dist[j] * scale;
    const x = edge[0] + (rx / rl) * side * d, z = edge[2] + (rz / rl) * side * d;
    const ditch = d > cfg.shoulder ? -0.5 * Math.max(0, 1 - Math.abs(d - cfg.shoulder - 2) / 2) : 0;
    let y = edge[1] + ditch + hills(x, z) * cfg.hillAmp * smoothstep(8, 40, d);
    y += bridge[idx] ? g : g * smoothstep(2, 14, d);
    // Inside a tunnel the terrain sits at full mountain height right from the wall top, so the roof
    // (which joins the first ribbon columns) is flush with the mountain and leaves no notch over the portal.
    if (tunnel[idx]) y = Math.max(y, edge[1] + Math.max(g, H + cfg.tunnelCover));
    const dive = smoothstep(W * scale - 12, W * scale, d);
    if (dive > 0) y += (baseHeight(x, z) - 2.5 - y) * dive;
    return [x, y, z];
  };

  // Ribbon vertices are computed once per sample (the base-height dive is expensive) and shared by
  // chunk building and ground queries.
  const cols = dist.length, table = new Float32Array(n * 2 * cols * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      for (let j = 0; j < cols; j++) table.set(computePoint(i, k ? 1 : -1, j), ((i * 2 + k) * cols + j) * 3);
    }
  }
  const profilePoint = (i, side, j) => {
    const o = ((sampleIndex(track, i) * 2 + (side > 0 ? 1 : 0)) * cols + j) * 3;
    return [table[o], table[o + 1], table[o + 2]];
  };
  const profileY = (idx, side, j) => table[((idx * 2 + (side > 0 ? 1 : 0)) * cols + j) * 3 + 1];
  const columnDist = (idx, side, j) => dist[j] * scaleAt(idx, side);
  // Drivable width beside the road: up to where the terrain rises more than cfg.climbLimit above the
  // road edge (cuttings before tunnels, steep hills act like walls).
  const steep = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 2; k++) {
      const side = k ? 1 : -1, base = profileY(i, side, 0);
      let d = columnDist(i, side, cols - 1);
      for (let j = 1; j < cols; j++) {
        const rise = profileY(i, side, j) - base;
        if (rise > cfg.climbLimit) {
          const prev = profileY(i, side, j - 1) - base, d0 = columnDist(i, side, j - 1), d1 = columnDist(i, side, j);
          d = d0 + ((d1 - d0) * (cfg.climbLimit - prev)) / Math.max(1e-6, rise - prev);
          break;
        }
      }
      // Tunnel samples: the wall stands at the road edge (also closes the segment before a portal).
      steep[i * 2 + k] = tunnel[i] ? 0 : d;
    }
  }
  const drivable = (idx, side) => steep[idx * 2 + (side > 0 ? 1 : 0)];

  return { ground, tunnel, bridge, dist, edgeLat, profilePoint, profileY, columnDist, drivable, baseHeight };
}

/**
 * Base heightfield tiles around the track (coarse cells beyond the ribbon; hidden under it near the road).
 * @param {import('./track.js').Track} track @param {Terrain} terrain @param {object} cfg CONFIG.track
 * @param {(tex: string) => number} layerOf @param {{ flat: string, steep: string }} [ground] zone textures
 * @returns {import('../models/loader.js').MeshData[]}
 */
export function buildBaseTerrain(track, terrain, cfg, layerOf, ground = { flat: 'grass', steep: 'rock' }) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < track.count; i++) {
    x0 = Math.min(x0, track.pos[i * 3]); x1 = Math.max(x1, track.pos[i * 3]);
    z0 = Math.min(z0, track.pos[i * 3 + 2]); z1 = Math.max(z1, track.pos[i * 3 + 2]);
  }
  const cell = cfg.baseCell, m = cfg.baseMargin;
  x0 = Math.floor((x0 - m) / cell) * cell;
  z1 = Math.ceil((z1 + m) / cell) * cell;
  const cols = Math.ceil((x1 + m - x0) / cell) + 1, rows = Math.ceil((z1 - (z0 - m)) / cell) + 1;
  const heights = new Float32Array((rows + 2) * cols);
  for (let r = -1; r <= rows; r++) {
    for (let c = 0; c < cols; c++) heights[(r + 1) * cols + c] = terrain.baseHeight(x0 + c * cell, z1 - r * cell);
  }
  const grass = { layer: layerOf(ground.flat), flags: FLAGS.GOURAUD };
  const rock = { layer: layerOf(ground.steep), flags: FLAGS.GOURAUD };
  const tiles = [], T = cfg.baseTile;
  for (let tr = 0; tr < rows - 1; tr += T) {
    for (let tc = 0; tc < cols - 1; tc += T) {
      const b = new MeshBuilder(), cEnd = Math.min(cols - 1, tc + T);
      b.grid({
        r0: tr, r1: Math.min(rows - 1, tr + T), cols: cEnd - tc + 1,
        padCols: true,
        pos: (r, c) => {
          const rr = Math.max(-1, Math.min(rows, r)), cc = Math.max(0, Math.min(cols - 1, tc + c));
          return [x0 + cc * cell, heights[(rr + 1) * cols + cc], z1 - rr * cell];
        },
        uv: (r, c, p) => [p[0] / cfg.terrainRepeat, p[2] / cfg.terrainRepeat],
        mat: (r, c, q) => (slopeY(q) < 0.75 ? rock : grass),
      });
      tiles.push(b.build());
    }
  }
  return tiles;
}

/**
 * Y component of the unit normal of a quad (a, b, c, d).
 * @param {number[][]} q
 * @returns {number}
 */
export function slopeY(q) {
  const ax = q[2][0] - q[0][0], ay = q[2][1] - q[0][1], az = q[2][2] - q[0][2];
  const bx = q[3][0] - q[1][0], by = q[3][1] - q[1][1], bz = q[3][2] - q[1][2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  return Math.abs(ny) / (Math.hypot(nx, ny, nz) || 1);
}

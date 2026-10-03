// Scenery from rules (CLAUDE.md 11 `scenery`, plus zone rules): instanced objects and billboard sprites
// grouped per track chunk (culling units), continuous line strips (guardrails, fences, pit wall) and
// night light pools under street lamps. Deterministic (seeded RNG). Pure data, no DOM/GL.
//
// Rules: { rule: 'every' | 'range', spacing, from, to, obj | sprite, side: 'left'|'right'|'both',
//          offset: m | [min, max] (from the centreline), jitter, size: [w, h], scale: [min, max],
//          tex: 'adRandom', light: true (lamp pool) }  and  { rule: 'line', obj: 'guardrail'|'fence'|'pitwall', side, offset, from, to }
import { makeRng, hashString } from '../engine/rng.js';
import { SEG, sampleIndex, frameAt, trackPoint } from './track.js';
import { MeshBuilder } from './meshbuild.js';
import { FLAGS } from '../gfx/shaders/world.js';
import { SLOT } from './ground.js';

/** Default billboard sizes [width, height] (m) and animation frame counts. */
export const SPRITES = {
  treeDeciduous: { size: [6, 8] }, treeConifer: { size: [5, 9] }, palm: { size: [5, 8] }, bush: { size: [3, 2] },
  crowd0: { size: [8, 2.4], frames: 3 }, flag: { size: [2.4, 4] }, marshal: { size: [1.4, 3] },
};

/**
 * 2D collision boxes of scenery objects in model space: half extents (x, z) and box centre z.
 * Line strips become lateral limits instead (see `limits`).
 */
export const COLLIDERS = {
  grandstand: { hx: 12.5, hz: 2.9, cz: -2.3 },
  buildingLow: { hx: 7, hz: 6, cz: -6 },
  buildingMid: { hx: 9, hz: 7, cz: -7 },
  buildingTall: { hx: 8, hz: 8, cz: -8 },
  adBoard: { hx: 4, hz: 0.15, cz: -0.06 },
  tyreStack: { hx: 0.6, hz: 0.6, cz: 0 },
  lampPost: { hx: 0.15, hz: 0.15, cz: 0 },
  tree3d: { hx: 0.3, hz: 0.3, cz: 0 },
  conifer3d: { hx: 0.3, hz: 0.3, cz: 0 },
  boulder: { hx: 1.3, hz: 1.3, cz: 0 },
  pitGarage: { hx: 15, hz: 5, cz: -5 },
};

/** Billboards with a solid trunk (others such as bushes, flags and people are not solid). */
const TRUNKS = new Set(['treeDeciduous', 'treeConifer', 'palm']);

const LINES = {
  guardrail: { tex: 'barrier', height: 0.9, flags: FLAGS.CUTOUT | FLAGS.DOUBLE, repeat: 4 },
  fence: { tex: 'brick', height: 1.4, flags: FLAGS.DOUBLE, repeat: 4 },
  pitwall: { tex: 'concrete', height: 1.1, flags: FLAGS.DOUBLE, repeat: 4 },
};

const SPRITE_FLOATS = 8;

/**
 * @typedef {object} SceneryResult
 * @property {{ name: string, chunk: number, data: Float32Array, positions: number[][] }[]} objects instance matrices per model and chunk
 * @property {{ chunk: number, data: Float32Array }[]} sprites billboard instances per chunk
 * @property {(import('../models/loader.js').MeshData | null)[]} lines strip / light-pool geometry per chunk
 * @property {{ x: number, z: number, c: number, s: number, hx: number, hz: number }[]} colliders static boxes
 *   (centre, cos/sin of the yaw, half extents); local x axis = (c, -s), local z axis = (s, c) in world x/z
 * @property {{ left: Float32Array, right: Float32Array }} limits per-segment lateral limits from line strips
 */

/**
 * Places all scenery for a track.
 * @param {import('./track.js').Track} track @param {import('./terrain.js').Terrain} terrain
 * @param {import('./ground.js').GroundProbe} probe @param {object[]} rules
 * @param {{ cfg: object, seed: number, layerOf: (t: string) => number }} o
 * @returns {SceneryResult}
 */
export function buildScenery(track, terrain, probe, rules, o) {
  const per = Math.max(4, Math.round(o.cfg.chunkLen / track.ds));
  const chunks = Math.ceil(track.segments / per);
  const objects = new Map(), sprites = Array.from({ length: chunks }, () => []);
  const builders = Array.from({ length: chunks }, () => new MeshBuilder());
  const limits = { left: new Float32Array(track.segments).fill(-Infinity), right: new Float32Array(track.segments).fill(Infinity) };
  const ctx = { track, terrain, probe, o, per, chunks, objects, sprites, builders, f: frame(), info: {}, colliders: [], limits };
  rules.forEach((rule, k) => {
    const rng = makeRng((o.seed ^ hashString(`${track.def.id}:${k}:${rule.obj || rule.sprite}`)) >>> 0);
    if (rule.rule === 'line') line(ctx, rule);
    else place(ctx, rule, rng);
  });
  const objList = [];
  for (const [key, list] of objects) {
    const [name, chunk] = key.split('|');
    const data = new Float32Array(list.length * 16);
    list.forEach((m, i) => data.set(m.matrix, i * 16));
    objList.push({ name, chunk: Number(chunk), data, positions: list.map((m) => m.pos) });
  }
  return {
    objects: objList,
    sprites: sprites.map((list, chunk) => ({ chunk, data: Float32Array.from(list.flat()) })).filter((s) => s.data.length),
    lines: builders.map((b) => (b.tris.length ? b.build() : null)),
    colliders: ctx.colliders,
    limits,
  };
}

const frame = () => ({ pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] });

function sides(rule) {
  return rule.side === 'left' ? [-1] : rule.side === 'right' ? [1] : [-1, 1];
}

// Returns world position for (s, lateral) on flat ground, or null when the spot is unusable:
// tunnel/bridge, tunnel cutting, beyond the drivable ribbon, or on another part of the road.
function spot(ctx, s, lat) {
  const { track, terrain, probe, f, info } = ctx;
  const L = track.length, ss = track.closed ? ((s % L) + L) % L : s;
  if (ss < 0 || ss > L) return null;
  const i = Math.min(track.segments - 1, Math.floor(ss / track.ds)), idx = sampleIndex(track, i);
  if (track.seg[i] & (SEG.TUNNEL | SEG.BRIDGE) || Math.abs(terrain.ground[idx]) > 2) return null;
  const side = lat < 0 ? -1 : 1, reach = terrain.edgeLat + terrain.columnDist(idx, side, terrain.dist.length - 1) - 14;
  if (Math.abs(lat) > reach) return null;
  frameAt(track, ss, f);
  const rl = Math.hypot(f.right[0], f.right[2]);
  const x = f.pos[0] + (f.right[0] / rl) * lat, z = f.pos[2] + (f.right[2] / rl) * lat;
  probe.hints[SLOT.SCENERY] = -1;
  const g = probe.sample(x, z, info, SLOT.SCENERY);
  if (Math.abs(g.lat) < terrain.edgeLat + 2) return null;
  return { x, y: probe.heightAt(x, z, SLOT.SCENERY, false), z, s: ss, i, rx: f.right[0] / rl, rz: f.right[2] / rl };
}

function place(ctx, rule, rng) {
  const { track, o } = ctx;
  const from = rule.from ?? 0, to = rule.to ?? track.length;
  // Ambient (zone) scenery follows the density option; the track's own placements stay as designed.
  const spacing = rule.spacing ? (rule.ambient ? rule.spacing / (o.density || 1) : rule.spacing) : Math.max(1, to - from);
  const start = rule.rule === 'range' && !rule.spacing ? (from + to) / 2 : from;
  for (let s = start; s <= to; s += spacing) {
    for (const side of sides(rule)) {
      const off = Array.isArray(rule.offset) ? rule.offset[0] + rng() * (rule.offset[1] - rule.offset[0]) : rule.offset;
      const jitter = rule.jitter ? (rng() - 0.5) * 2 * rule.jitter : 0;
      const along = rule.rule === 'every' && rule.spacing ? (rng() - 0.5) * spacing * 0.3 : 0;
      const p = spot(ctx, s + along, side * (off + jitter));
      if (!p) continue;
      const chunk = Math.min(ctx.chunks - 1, Math.floor(p.i / ctx.per));
      if (rule.sprite) {
        addSprite(ctx, chunk, rule.sprite, p.x, p.y, p.z, rule.size, rng, o.layerOf);
        if (TRUNKS.has(rule.sprite)) ctx.colliders.push({ x: p.x, z: p.z, c: 1, s: 0, hx: 0.35, hz: 0.35 });
      }
      else addObject(ctx, chunk, rule, p, side, rng);
    }
  }
}

function addSprite(ctx, chunk, name, x, y, z, size, rng, layerOf) {
  const def = SPRITES[name], k = 0.85 + rng() * 0.3;
  const [w, h] = size || def.size;
  ctx.sprites[chunk].push([x, y - 0.1, z, w * k, h * k, layerOf(name), def.frames || 1, Math.floor(rng() * 8)]);
}

function addObject(ctx, chunk, rule, p, side, rng) {
  const key = `${rule.obj}|${chunk}`;
  if (!ctx.objects.has(key)) ctx.objects.set(key, []);
  // Model +Z faces the road: towards -side * right.
  const yaw = Math.atan2(-side * p.rx, -side * p.rz);
  const scale = rule.scale ? rule.scale[0] + rng() * (rule.scale[1] - rule.scale[0]) : 1;
  const texOffset = rule.tex === 'adRandom' ? Math.floor(rng() * 4) : 0;
  const c = Math.cos(yaw) * scale, sn = Math.sin(yaw) * scale;
  const matrix = [c, 0, -sn, texOffset, 0, scale, 0, 0, sn, 0, c, 0, p.x, p.y, p.z, 1];
  ctx.objects.get(key).push({ matrix, pos: [p.x, p.y, p.z, scale] });
  const col = COLLIDERS[rule.obj];
  if (col) {
    ctx.colliders.push({
      x: p.x + matrix[8] * col.cz, z: p.z + matrix[10] * col.cz,
      c: Math.cos(yaw), s: Math.sin(yaw), hx: col.hx * scale, hz: col.hz * scale,
    });
  }
  if (rule.obj === 'grandstand') crowd(ctx, chunk, matrix, rng);
  if (rule.light) lightPool(ctx, p, side);
}

// Animated crowd billboards on every other grandstand step (local model space -> world).
function crowd(ctx, chunk, m, rng) {
  for (const step of [0, 2, 4]) {
    for (const x of [-8, 0, 8]) {
      const lx = x, ly = 0.6 + step * 0.6, lz = -(step + 0.5) * 0.9;
      const wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12], wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
      const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
      ctx.sprites[chunk].push([wx, wy, wz, 8, 1.6, ctx.o.layerOf('crowd0'), 3, Math.floor(rng() * 3)]);
    }
  }
}

// Road-conforming decal patch under a lamp head (visible only at night).
function lightPool(ctx, p, side) {
  const { track, terrain, o } = ctx, R = 5;
  // Lamp head hangs 2.2 m towards the road from the pole; the pool sits a little further in.
  const center = side * Math.max(0, terrainLat(ctx, p) - 3.2);
  const lat0 = Math.max(-terrain.edgeLat, center - R), lat1 = Math.min(terrain.edgeLat, center + R);
  if (lat1 - lat0 < 1) return;
  const r0 = Math.floor((p.s - R) / track.ds), r1 = Math.ceil((p.s + R) / track.ds);
  const chunk = Math.min(ctx.chunks - 1, Math.floor(p.i / ctx.per)), cols = 5;
  const mat = { layer: o.layerOf('lampPool'), flags: FLAGS.CUTOUT | FLAGS.DECAL | FLAGS.EMIT | FLAGS.NIGHT_ONLY | FLAGS.DOUBLE };
  ctx.builders[chunk].grid({
    r0, r1, cols,
    pos: (r, c2) => trackPoint(track, r, lat0 + ((lat1 - lat0) * c2) / (cols - 1), 0.03),
    uv: (r, c2) => [(lat0 + ((lat1 - lat0) * c2) / (cols - 1) - (center - R)) / (2 * R), (r * track.ds - (p.s - R)) / (2 * R)],
    mat: () => mat,
  });
}

function terrainLat(ctx, p) {
  const { track, f } = ctx;
  frameAt(track, p.s, f);
  return Math.abs((p.x - f.pos[0]) * p.rx + (p.z - f.pos[2]) * p.rz);
}

function line(ctx, rule) {
  const { track, terrain, probe, o, per } = ctx, L = LINES[rule.obj];
  const mat = { layer: o.layerOf(L.tex), flags: L.flags };
  const from = Math.floor((rule.from ?? 0) / track.ds), to = Math.min(track.segments, Math.ceil((rule.to ?? track.length) / track.ds));
  for (const side of sides(rule)) {
    const lat = side * rule.offset;
    const pos = (r, c) => {
      const idx = sampleIndex(track, r), k = idx * 3, rl = Math.hypot(track.right[k], track.right[k + 2]);
      const x = track.pos[k] + (track.right[k] / rl) * lat, z = track.pos[k + 2] + (track.right[k + 2] / rl) * lat;
      probe.hints[SLOT.SCENERY_LINE] = idx;
      const y = probe.heightAt(x, z, SLOT.SCENERY_LINE, false);
      return [x, y + c * L.height, z];
    };
    for (let c0 = Math.floor(from / per) * per; c0 < to; c0 += per) {
      const r0 = Math.max(from, c0), r1 = Math.min(to, c0 + per);
      if (r1 <= r0) continue;
      ctx.builders[Math.floor(c0 / per)].grid({
        r0, r1, cols: 2, pos,
        uv: (r, c) => [(r * track.ds) / L.repeat, 1 - c],
        mat: (r) => (lineAt(track, terrain, r, side) ? mat : null),
      });
    }
    // The strip is solid: it becomes a lateral limit (0.2 m thickness) wherever it is drawn.
    for (let r = from; r < to; r++) {
      if (!lineAt(track, terrain, r, side)) continue;
      const seg = r % track.segments;
      if (side < 0) ctx.limits.left[seg] = Math.max(ctx.limits.left[seg], -(rule.offset - 0.2));
      else ctx.limits.right[seg] = Math.min(ctx.limits.right[seg], rule.offset - 0.2);
    }
  }
}

// A line strip exists on segment r unless a tunnel, bridge, wall or tunnel cutting is there.
function lineAt(track, terrain, r, side) {
  const idx = sampleIndex(track, r);
  return !(track.seg[idx % track.segments] & (SEG.TUNNEL | SEG.BRIDGE | (side < 0 ? SEG.WALL_L : SEG.WALL_R)))
    && Math.abs(terrain.ground[idx]) <= 2;
}

export { SPRITE_FLOATS, LINES };

// Procedural car model builder: lofted body from a cabin profile (hood, windscreen, roof, rear window,
// deck), glass band, lights, grill, rear wing and wheels, at three LODs (CLAUDE.md 10 budgets).
// Model space: origin at the rear axle centre on the ground, forward = -Z. Output: section 10 model format.
import { emptyModel, addPoly } from './primitives.js';
import { FLAGS } from '../gfx/shaders/world.js';

/** Car materials (texture names from the library; `livery` + the per-car VARIANT offset = that car's livery). */
export const CAR_MATERIALS = {
  body: { tex: 'livery', flags: FLAGS.GOURAUD | FLAGS.VARIANT },
  glass: { tex: 'glass', flags: 0 },
  headlight: { tex: 'headlight', flags: FLAGS.NIGHT_EMIT },
  taillight: { tex: 'taillight', flags: FLAGS.NIGHT_EMIT },
  grill: { tex: 'grill', flags: 0 },
  tyre: { tex: 'tyre', flags: FLAGS.GOURAUD },
  shadow: { tex: 'shadowBlob', flags: FLAGS.CUTOUT | FLAGS.DECAL | FLAGS.EMIT | FLAGS.DOUBLE },
};

const LODS = [
  { sections: 18, ring: [0, 1, 2, 3, 4, 5, 6, 7], wheelSeg: 12, lights: true, wing: true },
  { sections: 9, ring: [0, 1, 3, 4, 6, 7], wheelSeg: 6, lights: true, wing: false },
  { sections: 0, ring: [0, 2, 4, 7], wheelSeg: 4, lights: false, wing: false },
];

// Livery v (0..0.5) of each half-profile point: most texels go to the side panel and the top.
export const RING_V = [0, 0.03, 0.08, 0.27, 0.31, 0.37, 0.44, 0.5];
// Plain base-colour area of the livery (u, v rectangle, rows 43-46 at the tail end: no style band,
// number or label there) for the rear wing and the nose/tail caps.
const PLAIN_UV = [[1.9, 0.72], [1.97, 0.72], [1.97, 0.68], [1.9, 0.68]];

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Builds the car model at a LOD level.
 * @param {object} spec car spec (CARS entry) @param {number} lod 0..2
 * @returns {object} model { name, verts, uvs, faces, smooth }
 */
export function buildCarModel(spec, lod) {
  const L = LODS[lod], b = spec.body, m = emptyModel(`${spec.id}Lod${lod}`);
  m.smooth = ['body', 'tyre'];
  const shape = bodyShape(spec);
  const ts = sectionTimes(L.sections, b.cabin);
  const rings = ts.map((t) => ringPoints(shape, t, L.ring));
  const n = rings[0].length;
  // Livery layout (texgen/livery.js): u 0..2 nose to tail, v 0..1 right half bottom to roof centre, 1..2 left half.
  const ringV = (k) => 2 * (k <= L.ring.length - 1 ? RING_V[L.ring[k]] : 1 - RING_V[L.ring[n - k]]);
  rings.forEach((ring, s) => ring.forEach((p, k) => { m.verts.push(p); m.uvs.push([ts[s] * 2, ringV(k)]); }));
  for (let s = 0; s + 1 < rings.length; s++) {
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = s * n + k, bb = s * n + k1, c = (s + 1) * n + k1, d = (s + 1) * n + k;
      const uvB = k1 === 0 ? addUv(m, ts[s] * 2, 2) : bb, uvC = k1 === 0 ? addUv(m, ts[s + 1] * 2, 2) : c;
      const cf = (shape.cabin(ts[s]) + shape.cabin(ts[s + 1])) / 2;
      m.faces.push([[a, bb, c, d], [a, uvB, uvC, d], faceMaterial(L.ring, k, n, cf)]);
    }
  }
  const nose = Array.from({ length: n }, (_, k) => k), tail = nose.map((k) => (rings.length - 1) * n + k);
  const plain = addUv(m, 1.93, 0.7), caps = nose.map(() => plain);
  m.faces.push([nose.slice().reverse(), caps, 'body']);
  m.faces.push([tail, caps, 'body']);
  if (L.lights) lights(m, shape);
  if (L.wing && b.spoiler) wing(m, shape);
  const wx = b.width / 2 - b.wheelInset;
  for (const side of [-1, 1]) for (const z of [0, -spec.wheelbase]) wheel(m, side * wx, spec.wheelRadius, z, b.tyreWidth, L.wheelSeg);
  return m;
}

/**
 * Flat dithered "blob" shadow quad under the car (binary transparency only).
 * @param {object} spec
 * @returns {object} model
 */
export function buildShadowModel(spec) {
  const b = spec.body, m = emptyModel(`${spec.id}Shadow`), x = b.width / 2 + 0.1;
  const z0 = -(b.length - b.rearOverhang) - 0.15, z1 = b.rearOverhang + 0.15;
  addPoly(m, [[-x, 0.03, z1], [x, 0.03, z1], [x, 0.03, z0], [-x, 0.03, z0]], [[0, 1], [1, 1], [1, 0], [0, 0]], 'shadow');
  m.fixedNormal = [0, 1, 0];
  return m;
}

function bodyShape(spec) {
  const b = spec.body, [c0, c1, c2, c3] = b.cabin, W = b.width / 2;
  const zFront = -(b.length - b.rearOverhang);
  const top = (t) => {
    if (t < c0) return lerp(b.nose, b.hood, smooth(t / c0) * 0.6 + (t / c0) * 0.4);
    if (t < c1) return lerp(b.hood, b.roof, smooth((t - c0) / (c1 - c0)));
    if (t < c2) return b.roof + 0.03 * Math.sin((Math.PI * (t - c1)) / (c2 - c1));
    if (t < c3) return lerp(b.roof, b.tail, smooth((t - c2) / (c3 - c2)));
    return lerp(b.tail, b.tail - 0.05, (t - c3) / (1 - c3));
  };
  const cabin = (t) => (t < c0 || t > c3 ? 0 : t < c1 ? (t - c0) / (c1 - c0) : t < c2 ? 1 : 1 - (t - c2) / (c3 - c2));
  const half = (t) => W * (0.8 + 0.2 * smooth(t / 0.1)) * (0.9 + 0.1 * smooth((1 - t) / 0.08));
  return { b, zFront, top, cabin, half, z: (t) => zFront + t * b.length };
}

// Section positions: uniform steps plus the cabin breakpoints (crisp windscreen and roof lines).
function sectionTimes(count, cabin) {
  const ts = new Set([0, 1, ...cabin]);
  for (let i = 1; i < count; i++) ts.add(i / count);
  return [...ts].sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 0.02);
}

// Ring around the body cross-section at t: right half bottom->top, then the left half back down.
function ringPoints(shape, t, subset) {
  const { b } = shape, hw = shape.half(t), top = shape.top(t), cf = shape.cabin(t), z = shape.z(t);
  const belt = Math.min(b.belt, top - 0.03), clr = b.clearance;
  const half = [
    [0, clr], [hw * 0.9, clr], [hw, clr + 0.14], [hw, belt - 0.1], [hw * 0.98, belt],
    [lerp(hw * 0.93, hw * 0.9, cf), lerp(top, belt + 0.05, cf)],
    [lerp(hw * 0.6, hw * b.roofWidth, cf), top], [0, top],
  ];
  const sel = subset.map((k) => half[k]);
  const right = sel.map(([x, y]) => [x, y, z]);
  const left = sel.slice(1, -1).reverse().map(([x, y]) => [-x, y, z]);
  return [...right, ...left];
}

function faceMaterial(subset, k, n, cf) {
  // Band index on the half profile (mirrored for the left half).
  const half = subset.length - 1, band = k < half ? k : n - 1 - k;
  if (subset[band] >= 4 && subset[band + 1] <= 6 && cf > 0.6) return 'glass';
  if (subset[band + 1] === 7 && cf > 0.05 && cf < 0.95) return 'glass';
  return 'body';
}

function addUv(m, u, v) {
  m.uvs.push([u, v]);
  return m.uvs.length - 1;
}

function lights(m, shape) {
  const z0 = shape.zFront - 0.01, z1 = shape.z(1) + 0.01, h0 = shape.half(0), h1 = shape.half(1), b = shape.b;
  const nb = Math.min(b.belt, b.nose - 0.03), tb = Math.min(b.belt, b.tail - 0.03), uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
  const quad = (pts, mat, want) => { addPoly(m, pts, uv, mat); orient(m, m.faces[m.faces.length - 1], want); };
  for (const s of [-1, 1]) {
    const x0 = s * h0 * 0.42, x1 = s * h0 * 0.82, t0 = s * h1 * 0.45, t1 = s * h1 * 0.9;
    quad([[x1, nb - 0.17, z0], [x0, nb - 0.17, z0], [x0, nb - 0.05, z0], [x1, nb - 0.05, z0]], 'headlight', [0, 0, -1]);
    quad([[t0, tb - 0.2, z1], [t1, tb - 0.2, z1], [t1, tb - 0.07, z1], [t0, tb - 0.07, z1]], 'taillight', [0, 0, 1]);
  }
  const g = h0 * 0.36;
  quad([[g, nb - 0.3, z0], [-g, nb - 0.3, z0], [-g, nb - 0.19, z0], [g, nb - 0.19, z0]], 'grill', [0, 0, -1]);
}

function orient(m, f, want) {
  const [a, b, c] = f[0].slice(0, 3).map((i) => m.verts[i]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) { f[0].reverse(); f[1].reverse(); }
}

function box(m, x0, x1, y0, y1, z0, z1, mat, uv = [[0, 1], [1, 1], [1, 0], [0, 0]]) {
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[[4, 5, 6, 7], [0, 0, 1]], [[1, 0, 3, 2], [0, 0, -1]], [[5, 1, 2, 6], [1, 0, 0]], [[0, 4, 7, 3], [-1, 0, 0]], [[7, 6, 2, 3], [0, 1, 0]], [[0, 1, 5, 4], [0, -1, 0]]];
  for (const [idx, want] of faces) {
    addPoly(m, idx.map((i) => P[i]), uv, mat);
    orient(m, m.faces[m.faces.length - 1], want);
  }
}

function wing(m, shape) {
  const b = shape.b, zr = shape.z(1), y = b.tail - 0.04;
  for (const s of [-1, 1]) box(m, s * 0.62 - 0.03, s * 0.62 + 0.03, y, y + 0.2, zr - 0.3, zr - 0.22, 'body', PLAIN_UV);
  box(m, -b.width * 0.44, b.width * 0.44, y + 0.2, y + 0.25, zr - 0.42, zr - 0.08, 'body', PLAIN_UV);
}

function wheel(m, cx, r, cz, w, seg) {
  const x0 = cx - w / 2, x1 = cx + w / 2, base = m.verts.length, uv0 = m.uvs.length;
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * Math.PI * 2, y = r + r * Math.sin(a), z = cz + r * Math.cos(a);
    m.verts.push([x0, y, z], [x1, y, z]);
    m.uvs.push([0, (k / seg) * 2], [0.25, (k / seg) * 2]);
  }
  for (let k = 0; k < seg; k++) {
    const a = base + k * 2, u = uv0 + k * 2;
    m.faces.push([[a, a + 1, a + 3, a + 2], [u, u + 1, u + 3, u + 2], 'tyre']);
  }
  const ring = (start, off) => Array.from({ length: seg }, (_, k) => start + k * 2 + off);
  m.faces.push([ring(base, 1).reverse(), ring(uv0, 1).reverse(), 'tyre']);
  m.faces.push([ring(base, 0), ring(uv0, 0), 'tyre']);
}

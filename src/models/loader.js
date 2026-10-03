// Model loader (no GL): triangulates faces, computes face / smooth vertex normals, subdivides
// large faces (CONFIG.tess.maxEdge) and packs vertices in the world shader layout (CLAUDE.md 8.5).
import { FLAGS } from '../gfx/shaders/world.js';
import { vSub, vDot, vNormalize, vLength, vLerp } from '../engine/math3d.js';

/** Vertex layout: pos(3f) normal(3f) uv(2f) layer(u32) flags(u32) = 10 words, 40 bytes. */
export const VERTEX_WORDS = 10;
export const VERTEX_BYTES = VERTEX_WORDS * 4;
const STATE_MASK = FLAGS.DOUBLE | FLAGS.DECAL;

/**
 * @typedef {object} MeshData
 * @property {ArrayBuffer} buffer interleaved vertices
 * @property {number} count vertex count (triangles * 3)
 * @property {{ first: number, count: number, state: number }[]} groups draw ranges by DOUBLE/DECAL state
 * @property {number[]} center bounding sphere centre
 * @property {number} radius bounding sphere radius
 */

/**
 * Loads a model definition (CLAUDE.md section 10) into packed vertex data.
 * @param {object} model { verts, uvs, faces: [[vi], [ui], material], smooth?, fixedNormal? }
 * @param {Record<string, { tex: string, flags: number }>} materials
 * @param {(tex: string) => number} layerOf texture name -> near layer index
 * @param {{ maxEdge?: number, creaseDeg?: number }} [opts]
 * @returns {MeshData}
 */
export function loadModel(model, materials, layerOf, opts = {}) {
  const maxEdge = opts.maxEdge ?? Infinity;
  const cosCrease = Math.cos(((opts.creaseDeg ?? 50) * Math.PI) / 180);
  const smooth = new Set(model.smooth || []);
  const faceN = model.faces.map((f) => newellNormal(f[0].map((i) => model.verts[i])));
  const byVert = new Map();
  model.faces.forEach((f, fi) => {
    if (!smooth.has(f[2])) return;
    for (const v of f[0]) (byVert.get(v) || byVert.set(v, []).get(v)).push(fi);
  });
  const tris = [];
  model.faces.forEach((f, fi) => {
    const mat = materials[f[2]];
    if (!mat) throw new Error(`Model ${model.name}: unknown material ${f[2]}`);
    const layer = layerOf(mat.tex);
    if (layer === undefined) throw new Error(`Model ${model.name}: unknown texture ${mat.tex}`);
    const corners = f[0].map((v, k) => ({
      p: model.verts[v],
      uv: model.uvs[f[1][k]],
      n: model.fixedNormal || cornerNormal(fi, v, faceN, byVert, smooth.has(f[2]), cosCrease),
    }));
    const fan = [];
    for (let k = 1; k + 1 < corners.length; k++) fan.push([corners[0], corners[k], corners[k + 1]]);
    let longest = 0;
    for (const t of fan) for (let e = 0; e < 3; e++) longest = Math.max(longest, vLength(vSub(t[e].p, t[(e + 1) % 3].p)));
    const n = Math.max(1, Math.ceil(longest / maxEdge - 1e-6));
    for (const t of fan) subdivide(t, n, (a, b, c) => tris.push({ v: [a, b, c], layer, flags: mat.flags }));
  });
  return packTriangles(tris);
}

function newellNormal(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return vNormalize(n);
}

function cornerNormal(fi, v, faceN, byVert, isSmooth, cosCrease) {
  if (!isSmooth) return faceN[fi];
  const sum = [0, 0, 0];
  for (const gj of byVert.get(v)) {
    if (vDot(faceN[fi], faceN[gj]) < cosCrease) continue;
    for (let i = 0; i < 3; i++) sum[i] += faceN[gj][i];
  }
  return vNormalize(sum);
}

// Uniform barycentric subdivision into n^2 triangles (same winding as the input).
function subdivide(t, n, emit) {
  const at = (i, j) => {
    const lerp3 = (key) => {
      const ab = vLerp(t[0][key], t[1][key], i / n);
      return ab.map((v, k) => v + (t[2][key][k] - t[0][key][k]) * (j / n));
    };
    return { p: lerp3('p'), uv: lerp3('uv'), n: vNormalize(lerp3('n')) };
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i + j < n; i++) {
      emit(at(i, j), at(i + 1, j), at(i, j + 1));
      if (i + j + 2 <= n) emit(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
}

/**
 * Packs triangles into the interleaved vertex layout, grouped by DOUBLE/DECAL draw state.
 * @param {{ v: { p: number[], n: number[], uv: number[] }[], layer: number, flags: number }[]} tris
 * @returns {MeshData}
 */
export function packTriangles(tris) {
  tris.sort((a, b) => (a.flags & STATE_MASK) - (b.flags & STATE_MASK));
  const count = tris.length * 3;
  const buffer = new ArrayBuffer(count * VERTEX_BYTES);
  const f32 = new Float32Array(buffer), u32 = new Uint32Array(buffer);
  const groups = [], min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  tris.forEach((t, ti) => {
    const state = t.flags & STATE_MASK;
    const last = groups[groups.length - 1];
    if (last && last.state === state) last.count += 3;
    else groups.push({ first: ti * 3, count: 3, state });
    t.v.forEach((c, k) => {
      const o = (ti * 3 + k) * VERTEX_WORDS;
      f32.set(c.p, o); f32.set(c.n, o + 3); f32[o + 6] = c.uv[0]; f32[o + 7] = c.uv[1];
      u32[o + 8] = t.layer; u32[o + 9] = t.flags;
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], c.p[i]); max[i] = Math.max(max[i], c.p[i]); }
    });
  });
  const center = count ? min.map((v, i) => (v + max[i]) / 2) : [0, 0, 0];
  let radius = 0;
  for (let i = 0; i < count; i++) {
    const o = i * VERTEX_WORDS;
    radius = Math.max(radius, Math.hypot(f32[o] - center[0], f32[o + 1] - center[1], f32[o + 2] - center[2]));
  }
  return { buffer, count, groups, center, radius };
}


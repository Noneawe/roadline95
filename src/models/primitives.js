// Simple procedural models in the CLAUDE.md section 10 format: box, ground plane, wall panel, sprite quad.
// Faces are CCW seen from outside; UVs are in texture repeats with v growing downwards.

/**
 * Starts an empty model.
 * @param {string} name
 * @returns {{ name: string, verts: number[][], uvs: number[][], faces: any[], smooth: string[] }}
 */
export function emptyModel(name) {
  return { name, verts: [], uvs: [], faces: [], smooth: [] };
}

/**
 * Appends a polygon with its own vertices and UVs.
 * @param {object} model @param {number[][]} pts @param {number[][]} uvs @param {string} mat
 */
export function addPoly(model, pts, uvs, mat) {
  const v0 = model.verts.length, u0 = model.uvs.length;
  model.verts.push(...pts);
  model.uvs.push(...uvs);
  model.faces.push([pts.map((_, i) => v0 + i), uvs.map((_, i) => u0 + i), mat]);
}

/**
 * Box centred on X/Z with its base at y = 0.
 * @param {string} name @param {number[]} size [sx, sy, sz] @param {number} metersPerRepeat @param {string} mat
 */
export function boxModel(name, size, metersPerRepeat, mat) {
  const [x, h, z] = [size[0] / 2, size[1], size[2] / 2], s = metersPerRepeat;
  const P = [[-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z], [-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z]];
  const m = emptyModel(name);
  const faces = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
  for (const f of faces) {
    const pts = f.map((i) => P[i]);
    const w = Math.hypot(...pts[1].map((v, i) => v - pts[0][i])), hh = Math.hypot(...pts[3].map((v, i) => v - pts[0][i]));
    addPoly(m, pts, [[0, hh / s], [w / s, hh / s], [w / s, 0], [0, 0]], mat);
  }
  return m;
}

/**
 * Horizontal plane at y = 0, facing up, UV from world X/Z.
 * @param {string} name @param {number} w @param {number} d @param {number} metersPerRepeat @param {string} mat
 */
export function planeModel(name, w, d, metersPerRepeat, mat) {
  const m = emptyModel(name), x = w / 2, z = d / 2, s = metersPerRepeat;
  const pts = [[-x, 0, z], [x, 0, z], [x, 0, -z], [-x, 0, -z]];
  addPoly(m, pts, pts.map((p) => [p[0] / s, p[2] / s]), mat);
  return m;
}

/**
 * Vertical wall panel facing +Z from x0 to x1, height h, at depth z.
 * @param {string} name @param {number} x0 @param {number} x1 @param {number} h @param {number} z
 * @param {number} metersPerRepeat @param {string} mat
 */
export function wallModel(name, x0, x1, h, z, metersPerRepeat, mat) {
  const m = emptyModel(name), s = metersPerRepeat;
  const pts = [[x0, 0, z], [x1, 0, z], [x1, h, z], [x0, h, z]];
  addPoly(m, pts, pts.map((p) => [p[0] / s, (h - p[1]) / s]), mat);
  return m;
}

/**
 * Upright sprite quad in the XY plane facing +Z, base centred at the origin.
 * Uses a fixed up-normal so lighting does not change as the billboard turns.
 * @param {string} name @param {number} w @param {number} h @param {string} mat
 */
export function spriteModel(name, w, h, mat) {
  const m = emptyModel(name), x = w / 2, e = 0.002;
  addPoly(m, [[-x, 0, 0], [x, 0, 0], [x, h, 0], [-x, h, 0]], [[e, 1 - e], [1 - e, 1 - e], [1 - e, e], [e, e]], mat);
  m.fixedNormal = [0, 1, 0];
  return m;
}

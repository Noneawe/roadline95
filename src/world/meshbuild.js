// Mesh building helpers for world geometry (no GL): regular grids with smooth vertex normals
// from central differences, and flat quads oriented towards a wanted direction.
import { packTriangles } from '../models/loader.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * @typedef {{ layer: number, flags: number }} Mat
 */

export class MeshBuilder {
  /** @param {number} [rowStep] 2 = far LOD: grids keep their end rows and the even rows between */
  constructor(rowStep = 1) {
    this.tris = [];
    this.rowStep = rowStep;
  }

  /**
   * Emits a grid of rows r0..r1 (vertex rows) x cols columns. Columns must increase to the surface's
   * right when looking along increasing rows from above; `flip` reverses the facing.
   * pos() is also called for rows r0-1 and r1+1 (normals), so it must accept them.
   * @param {object} o
   * @param {number} o.r0 @param {number} o.r1 @param {number} o.cols
   * @param {(r: number, c: number) => number[]} o.pos
   * @param {(r: number, c: number, p: number[]) => number[]} o.uv
   * @param {(r: number, c: number, quad: number[][]) => Mat | null} o.mat cell material (null = skip)
   * @param {boolean} [o.flip]
   * @param {boolean} [o.padCols] pos() also valid at c = -1 and c = cols (normals continue across tiles)
   */
  grid({ r0, r1, cols, pos, uv, mat, flip = false, padCols = false }) {
    const P = [], c0 = padCols ? -1 : 0, c1 = padCols ? cols : cols - 1;
    for (let r = r0 - 1; r <= r1 + 1; r++) {
      const row = [];
      for (let c = c0; c <= c1; c++) row.push(pos(r, c));
      P.push(row);
    }
    const at = (r, c) => P[r - r0 + 1][Math.min(c1, Math.max(c0, c)) - c0];
    // Vertex rows: all of them, or (far LOD) the end rows plus even rows, so grids sharing an end row
    // (chunk boundaries) still meet exactly.
    const rows = [];
    for (let r = r0; r <= r1; r++) if (this.rowStep === 1 || r === r0 || r === r1 || r % this.rowStep === 0) rows.push(r);
    const V = [];
    for (const r of rows) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        const dr = sub(at(r + 1, c), at(r - 1, c));
        const dc = sub(at(r, c + 1), at(r, c - 1));
        let n = norm(cross(dc, dr));
        if (flip) n = [-n[0], -n[1], -n[2]];
        const p = at(r, c);
        row.push({ p, n, uv: uv(r, c, p) });
      }
      V.push(row);
    }
    for (let k = 0; k + 1 < rows.length; k++) {
      const r = rows[k];
      for (let c = 0; c + 1 < cols; c++) {
        const a = V[k][c], b = V[k][c + 1], cc = V[k + 1][c + 1], d = V[k + 1][c];
        const m = mat(r, c, [a.p, b.p, cc.p, d.p]);
        if (!m) continue;
        if (flip) this.tris.push({ v: [a, cc, b], ...m }, { v: [a, d, cc], ...m });
        else this.tris.push({ v: [a, b, cc], ...m }, { v: [a, cc, d], ...m });
      }
    }
  }

  /**
   * Flat quad; winding is chosen so the face normal points along `want`.
   * @param {number[][]} pts 4 corners in order around the quad @param {number[][]} uvs
   * @param {Mat} m @param {number[]} want
   */
  quad(pts, uvs, m, want) {
    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[1])));
    let order = [0, 1, 2, 3];
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      order = [0, 3, 2, 1];
      n = [-n[0], -n[1], -n[2]];
    }
    const v = order.map((i) => ({ p: pts[i], n, uv: uvs[i] }));
    this.tris.push({ v: [v[0], v[1], v[2]], ...m }, { v: [v[0], v[2], v[3]], ...m });
  }

  /**
   * Flat triangle; winding is chosen so the face normal points along `want`.
   * @param {number[][]} pts 3 corners @param {number[][]} uvs @param {Mat} m @param {number[]} want
   */
  tri(pts, uvs, m, want) {
    let n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[1])));
    let order = [0, 1, 2];
    if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      order = [0, 2, 1];
      n = [-n[0], -n[1], -n[2]];
    }
    this.tris.push({ v: order.map((i) => ({ p: pts[i], n, uv: uvs[i] })), ...m });
  }

  /** @returns {import('../models/loader.js').MeshData} */
  build() {
    return packTriangles(this.tris);
  }
}

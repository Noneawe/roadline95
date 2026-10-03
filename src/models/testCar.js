// Procedural test car for the stage 1 renderer scene: lofted wedge body with glass band and four wheels.
// Smooth (Gouraud) body and tyres; about 600 triangles. Not one of the six game cars.
import { emptyModel } from './primitives.js';

const SECTIONS = 14;
const RING = 16;
const WHEEL_SEG = 10;

/**
 * Builds the test car model (rear axle near z = 1.35, front towards -Z).
 * @returns {object} model in CLAUDE.md section 10 format
 */
export function testCarModel() {
  const m = emptyModel('testCar');
  m.smooth = ['body', 'tyre'];
  addBody(m);
  for (const sx of [-1, 1]) for (const z of [-1.35, 1.35]) addWheel(m, sx * 0.86, 0.33, z);
  return m;
}

function addBody(m) {
  const ringStart = [];
  for (let s = 0; s < SECTIONS; s++) {
    const t = s / (SECTIONS - 1), z = -2.2 + 4.4 * t;
    const nose = Math.min(1, t * 5, (1 - t) * 6);
    const width = 1.5 + 0.3 * Math.sqrt(nose);
    const top = 0.55 + 0.25 * nose + 0.45 * Math.max(0, Math.sin(Math.PI * (t - 0.25) / 0.6)) * (t > 0.25 && t < 0.85 ? 1 : 0);
    ringStart.push(m.verts.length);
    for (let k = 0; k < RING; k++) {
      const a = (k / RING) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const x = (width / 2) * Math.sign(c) * Math.abs(c) ** 0.5;
      const y = 0.25 + ((top - 0.25) / 2) * (1 + Math.sign(sn) * Math.abs(sn) ** 0.6);
      m.verts.push([x, y, z]);
      m.uvs.push([t * 3, (k / RING) * 2]);
    }
  }
  for (let s = 0; s + 1 < SECTIONS; s++) {
    const t = (s + 0.5) / (SECTIONS - 1), cabin = t > 0.3 && t < 0.75;
    for (let k = 0; k < RING; k++) {
      const k1 = (k + 1) % RING;
      const a = ringStart[s] + k, b = ringStart[s] + k1, c = ringStart[s + 1] + k1, d = ringStart[s + 1] + k;
      const glass = cabin && (k === 3 || k === 4 || k === 5);
      const uvB = k1 === 0 ? addUvCopy(m, b, (k + 1) / RING * 2) : b;
      const uvC = k1 === 0 ? addUvCopy(m, c, (k + 1) / RING * 2) : c;
      m.faces.push([[a, b, c, d], [a, uvB, uvC, d], glass ? 'glass' : 'body']);
    }
  }
  const front = ringStart[SECTIONS - 1], back = ringStart[0];
  const ring = (start) => Array.from({ length: RING }, (_, k) => start + k);
  m.faces.push([ring(front), ring(front), 'body']);
  m.faces.push([ring(back).reverse(), ring(back).reverse(), 'body']);
}

// Duplicates a vertex UV with a new v (seam where the ring wraps), returns the new UV index.
function addUvCopy(m, vi, v) {
  m.uvs.push([m.uvs[vi][0], v]);
  return m.uvs.length - 1;
}

function addWheel(m, cx, cy, cz) {
  const r = 0.33, x0 = cx - 0.13, x1 = cx + 0.13, base = m.verts.length, uvBase = m.uvs.length;
  for (let k = 0; k <= WHEEL_SEG; k++) {
    const a = (k / WHEEL_SEG) * Math.PI * 2;
    const y = cy + r * Math.sin(a), z = cz + r * Math.cos(a);
    m.verts.push([x0, y, z], [x1, y, z]);
    m.uvs.push([0, k / WHEEL_SEG * 2], [0.25, k / WHEEL_SEG * 2]);
  }
  for (let k = 0; k < WHEEL_SEG; k++) {
    const a = base + k * 2;
    m.faces.push([[a, a + 1, a + 3, a + 2], [uvBase + k * 2, uvBase + k * 2 + 1, uvBase + k * 2 + 3, uvBase + k * 2 + 2], 'tyre']);
  }
  const ringAt = (start, off) => Array.from({ length: WHEEL_SEG }, (_, k) => start + k * 2 + off);
  // Increasing angle winds towards -X; reverse for the +X cap.
  m.faces.push([ringAt(base, 1).reverse(), ringAt(uvBase, 1).reverse(), 'tyre']);
  m.faces.push([ringAt(base, 0), ringAt(uvBase, 0), 'tyre']);
}

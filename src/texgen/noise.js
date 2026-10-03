// Periodic (tileable) noise for the texture generator: value noise, Perlin gradient noise,
// fBm images and Voronoi cells. Pure functions without DOM/GL; integer periods wrap seamlessly.

const smooth = (t) => t * t * (3 - 2 * t);
const wrap = (v, p) => ((v % p) + p) % p;

/**
 * Periodic 2D value noise over the unit tile.
 * @param {() => number} rng
 * @param {number} period lattice cells per tile along X (integer)
 * @param {number} [periodY=period] lattice cells per tile along Y
 * @returns {(x: number, y: number) => number} sampler for x, y in tile units, result 0..1
 */
export function valueNoise(rng, period, periodY = period) {
  const lat = new Float32Array(period * periodY);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  return (x, y) => {
    const fx = x * period, fy = y * periodY;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const sx = smooth(fx - x0), sy = smooth(fy - y0);
    const i0 = wrap(x0, period), i1 = wrap(x0 + 1, period);
    const j0 = wrap(y0, periodY) * period, j1 = wrap(y0 + 1, periodY) * period;
    const a = lat[j0 + i0] + (lat[j0 + i1] - lat[j0 + i0]) * sx;
    const b = lat[j1 + i0] + (lat[j1 + i1] - lat[j1 + i0]) * sx;
    return a + (b - a) * sy;
  };
}

/**
 * Periodic 2D Perlin (gradient) noise over the unit tile.
 * @param {() => number} rng
 * @param {number} period lattice cells per tile (integer)
 * @returns {(x: number, y: number) => number} sampler, result roughly 0..1
 */
export function perlinNoise(rng, period) {
  const gx = new Float32Array(period * period), gy = new Float32Array(period * period);
  for (let i = 0; i < gx.length; i++) {
    const a = rng() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const dotGrid = (ix, iy, dx, dy) => {
    const k = wrap(iy, period) * period + wrap(ix, period);
    return gx[k] * dx + gy[k] * dy;
  };
  return (x, y) => {
    const fx = x * period, fy = y * period;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const sx = smooth(tx), sy = smooth(ty);
    const a = dotGrid(x0, y0, tx, ty) + (dotGrid(x0 + 1, y0, tx - 1, ty) - dotGrid(x0, y0, tx, ty)) * sx;
    const b = dotGrid(x0, y0 + 1, tx, ty - 1) + (dotGrid(x0 + 1, y0 + 1, tx - 1, ty - 1) - dotGrid(x0, y0 + 1, tx, ty - 1)) * sx;
    return (a + (b - a) * sy) * 0.7 + 0.5;
  };
}

/**
 * Tileable fBm image normalized to 0..1.
 * @param {() => number} rng
 * @param {number} size image size in pixels
 * @param {number} period base lattice period (X)
 * @param {number} octaves
 * @param {number} [gain=0.5] amplitude per octave
 * @param {{ periodY?: number, perlin?: boolean }} [opts] anisotropic Y period (value noise) or Perlin basis
 * @returns {Float32Array}
 */
export function fbmImage(rng, size, period, octaves, gain = 0.5, opts = {}) {
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    layers.push(opts.perlin ? perlinNoise(rng, period << o) : valueNoise(rng, period << o, (opts.periodY ?? period) << o));
  }
  const out = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0, amp = 1;
      for (const n of layers) { v += n(x / size, y / size) * amp; amp *= gain; }
      out[y * size + x] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const span = max - min || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / span;
  return out;
}

/**
 * Periodic Voronoi (Worley) cells: distance to nearest / second nearest feature point and cell id.
 * Distances are in units of the average cell spacing.
 * @param {() => number} rng
 * @param {number} size image size in pixels
 * @param {number} cells number of feature points
 * @returns {{ f1: Float32Array, f2: Float32Array, id: Int32Array }}
 */
export function voronoiImage(rng, size, cells) {
  const px = Float32Array.from({ length: cells }, () => rng() * size);
  const py = Float32Array.from({ length: cells }, () => rng() * size);
  const f1 = new Float32Array(size * size), f2 = new Float32Array(size * size), id = new Int32Array(size * size);
  const spacing = size / Math.sqrt(cells);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity, d2 = Infinity, best = 0;
      for (let c = 0; c < cells; c++) {
        let dx = Math.abs(x + 0.5 - px[c]), dy = Math.abs(y + 0.5 - py[c]);
        if (dx > size / 2) dx = size - dx;
        if (dy > size / 2) dy = size - dy;
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; best = c; } else if (d < d2) d2 = d;
      }
      const i = y * size + x;
      f1[i] = d1 / spacing;
      f2[i] = d2 / spacing;
      id[i] = best;
    }
  }
  return { f1, f2, id };
}

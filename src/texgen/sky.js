// Sky panoramas: cylindrical 512x128 indexed images (x = azimuth, wraps; y = elevation).
// Rows above SKY_HORIZON span 0..SKY_MAX_ELEV degrees; rows below hold the horizon/fog colour.
import { makeRng, hashString } from '../engine/rng.js';
import { RAMP as R } from '../gfx/palette.js';
import { valueNoise } from './noise.js';
import { BAYER4 } from './ops.js';

export const SKY_W = 512;
export const SKY_H = 128;
export const SKY_HORIZON = 112;
export const SKY_MAX_ELEV = 80;
export const SKY_KINDS = ['day', 'dusk', 'night', 'overcast'];

// Gradient stops [elevation 0..1, ramp, level] per kind, sampled with ordered dither.
const GRADIENTS = {
  day: [[0, R.SKY, 13], [0.35, R.SKY, 10], [1, R.SKY, 6]],
  dusk: [[0, R.LIGHT, 10], [0.2, R.SKIN, 9], [0.5, R.BRICK, 6], [1, R.PAINT2, 2]],
  night: [[0, R.SKY, 3], [0.4, R.SKY, 1.5], [1, R.SKY, 0]],
  overcast: [[0, R.CLOUD, 9], [1, R.CLOUD, 5]],
};

/**
 * Generates one sky panorama.
 * @param {string} kind one of SKY_KINDS
 * @param {number} seed
 * @param {number} horizonIndex palette index used at and below the horizon (fog colour)
 * @returns {Uint8Array} SKY_W * SKY_H palette indices, row 0 = top
 */
export function generateSky(kind, seed, horizonIndex) {
  const rng = makeRng((seed ^ hashString(`sky-${kind}`)) >>> 0);
  const grad = GRADIENTS[kind];
  const cloud = [valueNoise(rng, 8, 4), valueNoise(rng, 16, 8), valueNoise(rng, 32, 16)];
  const out = new Uint8Array(SKY_W * SKY_H);
  for (let y = 0; y < SKY_H; y++) {
    const e = Math.max(0, (SKY_HORIZON - y) / SKY_HORIZON);
    for (let x = 0; x < SKY_W; x++) {
      const i = y * SKY_W + x, d = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      if (y >= SKY_HORIZON || e < 0.06 * d) { out[i] = horizonIndex; continue; }
      // Clouds flatten towards the horizon (perspective): sample noise with stretched y.
      const v = 1 / (e + 0.2);
      let c = 0;
      cloud.forEach((n, o) => { c += n(x / SKY_W, (v / 5) % 1) * 0.5 ** o; });
      c = c / 1.75;
      out[i] = shade(kind, grad, e, c, d, rng);
    }
  }
  return out;
}

function shade(kind, grad, e, c, d, rng) {
  if (kind === 'night') {
    if (rng() < 0.004 * (0.3 + e)) return R.CLOUD * 16 + 11 + Math.floor(rng() * 5);
  } else if (kind === 'overcast') {
    return R.CLOUD * 16 + Math.round(5 + e * -2 + c * 5 + d - 0.5);
  } else if (c > (kind === 'dusk' ? 0.64 : 0.57) - e * 0.1) {
    const ramp = kind === 'dusk' ? R.BRICK : R.CLOUD;
    const lvl = kind === 'dusk' ? 3 + (c - 0.6) * 12 : 10 + (c - 0.55) * 18;
    return ramp * 16 + Math.min(15, Math.max(1, Math.round(lvl + d - 0.5)));
  }
  let k = 0;
  while (k < grad.length - 2 && e > grad[k + 1][0]) k++;
  const [e0, r0, l0] = grad[k], [e1, r1, l1] = grad[k + 1];
  const t = (e - e0) / (e1 - e0);
  if (r0 !== r1) {
    const [ramp, lvl] = t + d - 0.5 < 0.5 ? [r0, l0] : [r1, l1];
    return ramp * 16 + Math.round(lvl);
  }
  return r0 * 16 + Math.max(r0 === 0 ? 1 : 0, Math.min(15, Math.floor(l0 + (l1 - l0) * t + d)));
}

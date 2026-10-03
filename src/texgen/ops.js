// Texture ops: working images (ramp + fractional level per pixel), quantization to palette indices
// with optional ordered dither, and 2x LOD reduction. Ramp -1 marks a transparent (index 0) pixel.

import { glyph5x7 } from '../gfx/font.js';

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * @typedef {{ size: number, ramp: Int8Array, level: Float32Array }} TexImage
 */

/**
 * Creates a working image filled with ramp 0, level 0.
 * @param {number} size
 * @returns {TexImage}
 */
export function makeImage(size) {
  return { size, ramp: new Int8Array(size * size), level: new Float32Array(size * size) };
}

/**
 * Sets one pixel (coordinates wrap around the tile).
 * @param {TexImage} img @param {number} x @param {number} y @param {number} ramp @param {number} level
 */
export function setPixel(img, x, y, ramp, level) {
  const s = img.size, i = (((y % s) + s) % s) * s + (((x % s) + s) % s);
  img.ramp[i] = ramp;
  img.level[i] = level;
}

/**
 * Quantizes a working image to palette indices. Ramp 0 never uses level 0 (reserved index).
 * @param {TexImage} img @param {number} dither 0..1 strength of the 4x4 Bayer dither
 * @returns {Uint8Array}
 */
export function quantize(img, dither) {
  const s = img.size, out = new Uint8Array(s * s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = y * s + x, ramp = img.ramp[i];
      if (ramp < 0) continue;
      const d = dither * ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5);
      const lvl = Math.min(15, Math.max(ramp === 0 ? 1 : 0, Math.round(img.level[i] + d)));
      out[i] = ramp * 16 + lvl;
    }
  }
  return out;
}

/**
 * Halves image resolution: majority ramp of each 2x2 block, mean level; transparent if 2+ pixels are.
 * @param {TexImage} img
 * @returns {TexImage}
 */
export function downsample(img) {
  const s = img.size >> 1, out = makeImage(s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const idx = [(2 * y) * img.size + 2 * x, (2 * y) * img.size + 2 * x + 1,
        (2 * y + 1) * img.size + 2 * x, (2 * y + 1) * img.size + 2 * x + 1];
      const solid = idx.filter((i) => img.ramp[i] >= 0);
      const o = y * s + x;
      if (solid.length < 3) { out.ramp[o] = -1; continue; }
      let ramp = img.ramp[solid[0]], best = 0;
      for (const i of solid) {
        const n = solid.filter((j) => img.ramp[j] === img.ramp[i]).length;
        if (n > best) { best = n; ramp = img.ramp[i]; }
      }
      const same = solid.filter((i) => img.ramp[i] === ramp);
      out.ramp[o] = ramp;
      out.level[o] = same.reduce((a, i) => a + img.level[i], 0) / same.length;
    }
  }
  return out;
}

/**
 * Fills a rectangle (wrapping around the tile).
 * @param {TexImage} img @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} ramp @param {number} level
 */
export function fillRect(img, x, y, w, h, ramp, level) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(img, xx, yy, ramp, level);
}

/**
 * Draws text with the 5x7 font (6 px advance), clipped to the tile.
 * @param {TexImage} img @param {string} text @param {number} x @param {number} y
 * @param {number} ramp @param {number} level
 */
export function drawText5x7(img, text, x, y, ramp, level) {
  for (let i = 0; i < text.length; i++) {
    const cols = glyph5x7(text.charCodeAt(i));
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 7; r++) {
        const px = x + i * 6 + c, py = y + r;
        if (cols[c] & (1 << r) && px >= 0 && px < img.size && py >= 0 && py < img.size) setPixel(img, px, py, ramp, level);
      }
    }
  }
}

/**
 * Calls fn(x, y, i) for every pixel.
 * @param {TexImage} img @param {(x: number, y: number, i: number) => void} fn
 */
export function forEachPixel(img, fn) {
  for (let y = 0; y < img.size; y++) for (let x = 0; x < img.size; x++) fn(x, y, y * img.size + x);
}

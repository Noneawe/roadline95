// Colormap generation: 256x256 table where row = fog * 32 + light and column = texture index,
// value = resulting palette index (light multiply with saturation, then fog blend, then nearest colour).
import { nearestIndex } from './palette.js';

export const LIGHT_LEVELS = 32;
export const FOG_LEVELS = 8;

const cache = new Map();

/**
 * Builds a colormap for the given palette and fog colour.
 * @param {Uint8Array} pal RGBA palette
 * @param {number[]} fog RGB fog colour
 * @param {number} lightOne light level that equals factor 1.0
 * @returns {Uint8Array} 256 * 256 indices
 */
export function buildColormap(pal, fog, lightOne) {
  const out = new Uint8Array(256 * 256);
  const memo = new Map();
  for (let f = 0; f < FOG_LEVELS; f++) {
    const mix = f / (FOG_LEVELS - 1);
    for (let l = 0; l < LIGHT_LEVELS; l++) {
      const k = l / lightOne, row = (f * LIGHT_LEVELS + l) * 256;
      for (let i = 1; i < 256; i++) {
        let r = pal[i * 4] * k, g = pal[i * 4 + 1] * k, b = pal[i * 4 + 2] * k;
        const m = Math.max(r, g, b);
        if (m > 255) {
          // Over-bright: push towards white instead of clipping hue.
          const t = (m - 255) / m;
          r += (255 - r) * t; g += (255 - g) * t; b += (255 - b) * t;
        }
        r = Math.min(255, r) * (1 - mix) + fog[0] * mix;
        g = Math.min(255, g) * (1 - mix) + fog[1] * mix;
        b = Math.min(255, b) * (1 - mix) + fog[2] * mix;
        const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
        let idx = memo.get(key);
        if (idx === undefined) {
          idx = nearestIndex(pal, key >> 16, (key >> 8) & 255, key & 255);
          memo.set(key, idx);
        }
        out[row + i] = idx;
      }
    }
  }
  return out;
}

/**
 * Cached colormap per key (time of day x weather); built on first use.
 * @param {string} key @param {Uint8Array} pal @param {number[]} fog @param {number} lightOne
 * @returns {Uint8Array}
 */
export function getColormap(key, pal, fog, lightOne) {
  let cm = cache.get(key);
  if (!cm) {
    cm = buildColormap(pal, fog, lightOne);
    cache.set(key, cm);
  }
  return cm;
}

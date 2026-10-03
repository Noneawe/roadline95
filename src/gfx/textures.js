// Indexed texture array (TEXTURE_2D_ARRAY, R8UI, 128x128 layers) and the name -> layer registry.
// Texture i occupies layer 2i (64x64 tiled 2x2, or a 128x128 livery as is) and 2i+1 (32x32 LOD,
// point-upscaled to the same period).
// Layer data is built on the CPU and kept for re-upload after context loss.
import { nearestIndex } from './palette.js';
import { setNearest } from './targets.js';

export const LAYER_SIZE = 128;

/**
 * Name -> near layer index (far LOD layer is +1).
 * @param {{ name: string }[]} lib
 * @returns {Map<string, number>}
 */
export function assignLayers(lib) {
  return new Map(lib.map((t, i) => [t.name, i * 2]));
}

/**
 * Builds CPU layer data for the whole library.
 * @param {import('../texgen/library.js').Texture[]} lib
 * @param {Uint8Array} pal RGBA palette (for flat "notex" colours)
 * @param {boolean} notex replace every texture by its average colour (cutout shape kept)
 * @returns {Uint8Array} LAYER_SIZE^2 * lib.length * 2 bytes
 */
export function buildLayerData(lib, pal, notex) {
  const out = new Uint8Array(LAYER_SIZE * LAYER_SIZE * lib.length * 2);
  lib.forEach((t, i) => writeTextureLayers(out, i, t, notex ? pal : null));
  return out;
}

/**
 * Writes texture i (near and far LOD layers) into layer data.
 * @param {Uint8Array} out @param {number} i texture index @param {import('../texgen/library.js').Texture} t
 * @param {Uint8Array | null} flatPal palette for flat "notex" colours, or null for the texture itself
 */
export function writeTextureLayers(out, i, t, flatPal) {
  const layerBytes = LAYER_SIZE * LAYER_SIZE, flat = flatPal ? averageIndex(t.data, flatPal) : 0, size = t.size || 64;
  tileInto(out, layerBytes * i * 2, t.data, size, 1, flat);
  tileInto(out, layerBytes * (i * 2 + 1), t.lod, 32, size / 32, flat);
}

/**
 * Uploads layer data into a new R8UI texture array.
 * @param {WebGL2RenderingContext} gl @param {Uint8Array} data @param {number} layers
 * @returns {WebGLTexture}
 */
export function uploadTextureArray(gl, data, layers) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.R8UI, LAYER_SIZE, LAYER_SIZE, layers);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, LAYER_SIZE, LAYER_SIZE, layers,
    gl.RED_INTEGER, gl.UNSIGNED_BYTE, data);
  setNearest(gl, gl.TEXTURE_2D_ARRAY);
  return tex;
}

// Writes a size x size image scaled by `scale` and tiled to fill one 128x128 layer.
function tileInto(out, offset, src, size, scale, flat) {
  const span = size * scale;
  for (let y = 0; y < LAYER_SIZE; y++) {
    for (let x = 0; x < LAYER_SIZE; x++) {
      const v = src[(((y % span) / scale) | 0) * size + (((x % span) / scale) | 0)];
      out[offset + y * LAYER_SIZE + x] = flat && v ? flat : v;
    }
  }
}

function averageIndex(data, pal) {
  let r = 0, g = 0, b = 0, n = 0;
  for (const v of data) {
    if (!v) continue;
    r += pal[v * 4]; g += pal[v * 4 + 1]; b += pal[v * 4 + 2]; n++;
  }
  return n ? nearestIndex(pal, r / n, g / n, b / n) : 1;
}

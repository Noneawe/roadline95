// 8x16 VGA-style bitmap font (ASCII 32..126) drawn into the overlay.
// Glyphs are defined as a classic 5x7 column table and expanded to 8x16 cells (rows doubled).

// 5 column bytes per glyph, bit 0 = top row.
const GLYPHS_5X7 =
  '0000000000' + '00005f0000' + '0007000700' + '147f147f14' + '242a7f2a12' + '2313086462' + '3649552250' +
  '0005030000' + '001c224100' + '0041221c00' + '082a1c2a08' + '08083e0808' + '0050300000' + '0808080808' +
  '0060600000' + '2010080402' + '3e5149453e' + '00427f4000' + '4261514946' + '2141454b31' + '1814127f10' +
  '2745454539' + '3c4a494930' + '0171090503' + '3649494936' + '064949291e' + '0036360000' + '0056360000' +
  '0814224100' + '1414141414' + '0041221408' + '0201510906' + '324979413e' + '7e1111117e' + '7f49494936' +
  '3e41414122' + '7f4141221c' + '7f49494941' + '7f09090101' + '3e41415132' + '7f0808087f' + '00417f4100' +
  '2040413f01' + '7f08142241' + '7f40404040' + '7f0204027f' + '7f0408107f' + '3e4141413e' + '7f09090906' +
  '3e4151215e' + '7f09192946' + '4649494931' + '01017f0101' + '3f4040403f' + '1f2040201f' + '7f2018207f' +
  '6314081463' + '0304780403' + '6151494543' + '007f414100' + '0204081020' + '0041417f00' + '0402010204' +
  '4040404040' + '0001020400' + '2054545478' + '7f48444438' + '3844444420' + '384444487f' + '3854545418' +
  '087e090102' + '081454543c' + '7f08040478' + '00447d4000' + '2040443d00' + '007f102844' + '00417f4000' +
  '7c04180478' + '7c08040478' + '3844444438' + '7c14141408' + '081414187c' + '7c08040408' + '4854545420' +
  '043f444020' + '3c4040207c' + '1c2040201c' + '3c4030403c' + '4428102844' + '0c5050503c' + '4464544c44' +
  '0008364100' + '00007f0000' + '0041360800' + '0201020402';

/**
 * Column bytes of the 5x7 source glyph (bit 0 = top row); used by the texture generator for small text.
 * @param {number} code character code
 * @returns {number[]} 5 column masks
 */
export function glyph5x7(code) {
  const c = code >= 32 && code < 127 ? code - 32 : 31;
  return [0, 1, 2, 3, 4].map((col) => parseInt(GLYPHS_5X7.substr((c * 5 + col) * 2, 2), 16));
}

export const CHAR_W = 8;
export const CHAR_H = 16;

// rows[c * 16 + y] = 8-bit row mask (bit 7 = leftmost pixel)
const rows = new Uint8Array(95 * CHAR_H);
for (let c = 0; c < 95; c++) {
  for (let col = 0; col < 5; col++) {
    const bits = parseInt(GLYPHS_5X7.substr((c * 5 + col) * 2, 2), 16);
    for (let y = 0; y < 7; y++) {
      if (!(bits & (1 << y))) continue;
      const mask = 0x80 >> (col + 1);
      rows[c * CHAR_H + 1 + y * 2] |= mask;
      rows[c * CHAR_H + 2 + y * 2] |= mask;
    }
  }
}

/**
 * Draws text; characters outside ASCII 32..126 render as '?'. Optional 1 px drop shadow and integer scale.
 * @param {import('./overlay.js').Overlay} ov @param {string} text @param {number} x @param {number} y
 * @param {number} index @param {number} [shadow=0] shadow index, 0 = none @param {number} [scale=1]
 * @returns {number} x after the last character
 */
export function drawText(ov, text, x, y, index, shadow = 0, scale = 1) {
  for (let i = 0; i < text.length; i++) drawChar(ov, text.charCodeAt(i), x + i * CHAR_W * scale, y, index, shadow, scale);
  return x + text.length * CHAR_W * scale;
}

/**
 * Draws a non-negative integer right-aligned in `digits` cells without allocating strings.
 * @param {import('./overlay.js').Overlay} ov @param {number} value @param {number} digits @param {number} x
 * @param {number} y @param {number} index @param {number} [shadow=0] @param {number} [scale=1]
 */
export function drawNumber(ov, value, digits, x, y, index, shadow = 0, scale = 1) {
  let v = Math.max(0, Math.floor(value));
  for (let i = digits - 1; i >= 0; i--) {
    const code = v > 0 || i === digits - 1 ? 48 + (v % 10) : 32;
    drawChar(ov, code, x + i * CHAR_W * scale, y, index, shadow, scale);
    v = Math.floor(v / 10);
  }
}

/**
 * One character by code.
 * @param {import('./overlay.js').Overlay} ov @param {number} code @param {number} x @param {number} y
 * @param {number} index @param {number} [shadow=0] @param {number} [scale=1]
 */
export function drawChar(ov, code, x, y, index, shadow = 0, scale = 1) {
  let c = code - 32;
  if (c < 0 || c >= 95) c = 31;
  if (shadow) drawGlyph(ov, c, x + scale, y + scale, shadow, scale);
  drawGlyph(ov, c, x, y, index, scale);
}

function drawGlyph(ov, c, x, y, index, scale) {
  for (let gy = 0; gy < CHAR_H * scale; gy++) {
    const bits = rows[c * CHAR_H + Math.floor(gy / scale)], oy = y + gy;
    if (!bits || oy < 0 || oy >= ov.h) continue;
    for (let gx = 0; gx < CHAR_W * scale; gx++) {
      const ox = x + gx;
      if (bits & (0x80 >> Math.floor(gx / scale)) && ox >= 0 && ox < ov.w) ov.data[oy * ov.w + ox] = index;
    }
  }
}

/**
 * Draws a time as M:SS.hh without allocating strings.
 * @param {import('./overlay.js').Overlay} ov @param {number} t seconds @param {number} x @param {number} y
 * @param {number} index @param {number} [shadow=0] @param {number} [scale=1]
 * @returns {number} x after the text
 */
export function drawTime(ov, t, x, y, index, shadow = 0, scale = 1) {
  const cs = Math.max(0, Math.floor(t * 100)), m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, h = cs % 100, w = CHAR_W * scale;
  drawNumber(ov, m, 2, x, y, index, shadow, scale);
  drawChar(ov, 58, x + 2 * w, y, index, shadow, scale);
  drawChar(ov, 48 + Math.floor(sec / 10), x + 3 * w, y, index, shadow, scale);
  drawChar(ov, 48 + (sec % 10), x + 4 * w, y, index, shadow, scale);
  drawChar(ov, 46, x + 5 * w, y, index, shadow, scale);
  drawChar(ov, 48 + Math.floor(h / 10), x + 6 * w, y, index, shadow, scale);
  drawChar(ov, 48 + (h % 10), x + 7 * w, y, index, shadow, scale);
  return x + 8 * w;
}

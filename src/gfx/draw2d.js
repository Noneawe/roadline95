// 2D primitives on indexed 8-bit surfaces ({ w, h, data }: the overlay or a bitmap): clipped rectangles,
// lines, small 5x7 text and bitmap blits (0 = transparent).
import { glyph5x7 } from './font.js';

/**
 * @param {import('./overlay.js').Overlay} ov @param {number} x @param {number} y
 * @param {number} w @param {number} h @param {number} index
 */
export function fillRect(ov, x, y, w, h, index) {
  const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
  const x1 = Math.min(ov.w, (x + w) | 0), y1 = Math.min(ov.h, (y + h) | 0);
  for (let yy = y0; yy < y1; yy++) ov.data.fill(index, yy * ov.w + x0, yy * ov.w + x1);
}

/**
 * Rectangle outline, 1 px.
 * @param {import('./overlay.js').Overlay} ov @param {number} x @param {number} y
 * @param {number} w @param {number} h @param {number} index
 */
export function strokeRect(ov, x, y, w, h, index) {
  fillRect(ov, x, y, w, 1, index);
  fillRect(ov, x, y + h - 1, w, 1, index);
  fillRect(ov, x, y, 1, h, index);
  fillRect(ov, x + w - 1, y, 1, h, index);
}

/**
 * Copies an indexed bitmap, skipping index 0.
 * @param {import('./overlay.js').Overlay} ov
 * @param {{ w: number, h: number, data: Uint8Array }} bmp @param {number} x @param {number} y
 */
export function blit(ov, bmp, x, y) {
  for (let by = 0; by < bmp.h; by++) {
    const oy = y + by;
    if (oy < 0 || oy >= ov.h) continue;
    for (let bx = 0; bx < bmp.w; bx++) {
      const ox = x + bx, v = bmp.data[by * bmp.w + bx];
      if (v && ox >= 0 && ox < ov.w) ov.data[oy * ov.w + ox] = v;
    }
  }
}

/**
 * Line (Bresenham), optionally thick (square brush).
 * @param {{ w: number, h: number, data: Uint8Array }} ov @param {number} x0 @param {number} y0
 * @param {number} x1 @param {number} y1 @param {number} index @param {number} [thick=1]
 */
export function line(ov, x0, y0, x1, y1, index, thick = 1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (thick > 1) fillRect(ov, x0 - (thick >> 1), y0 - (thick >> 1), thick, thick, index);
    else if (x0 >= 0 && x0 < ov.w && y0 >= 0 && y0 < ov.h) ov.data[y0 * ov.w + x0] = index;
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/**
 * Small text with the 5x7 font (6 px advance); meant for static bitmaps.
 * @param {{ w: number, h: number, data: Uint8Array }} ov @param {string} text @param {number} x @param {number} y
 * @param {number} index
 */
export function smallText(ov, text, x, y, index) {
  for (let i = 0; i < text.length; i++) {
    const cols = glyph5x7(text.charCodeAt(i));
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 7; r++) {
        const px = x + i * 6 + c, py = y + r;
        if (cols[c] & (1 << r) && px >= 0 && px < ov.w && py >= 0 && py < ov.h) ov.data[py * ov.w + px] = index;
      }
    }
  }
}

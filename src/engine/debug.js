// Debug helpers: debugLog (only with ?debug=1), stats overlay text and the colormap preview (F5).
import { CONFIG } from '../config.js';
import { drawText } from '../gfx/font.js';
import { fillRect } from '../gfx/draw2d.js';

/** Logs only in debug mode. @param {...any} args */
export function debugLog(...args) {
  if (CONFIG.debug) console.log('[roadline]', ...args); // eslint-disable-line no-console
}

/**
 * Draws lines of debug text with a dark backdrop at the top-left.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {string[]} lines @param {number} fg @param {number} bg
 */
export function drawDebugLines(ov, lines, fg, bg) {
  let w = 0;
  for (const l of lines) w = Math.max(w, l.length);
  fillRect(ov, 0, 0, w * 8 + 4, lines.length * 16 + 4, bg);
  lines.forEach((l, i) => drawText(ov, l, 2, 2 + i * 16, fg));
}

/**
 * Colormap preview: 256 columns (texture index) x 256 rows (fog * 32 + light), scaled to fit.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {Uint8Array} cm
 */
export function drawColormapPreview(ov, cm) {
  const h = Math.min(256, ov.h - 8), w = Math.min(256, ov.w - 8);
  const x0 = (ov.w - w) >> 1, y0 = (ov.h - h) >> 1;
  for (let y = 0; y < h; y++) {
    const row = ((y * 256) / h) | 0;
    for (let x = 0; x < w; x++) {
      const v = cm[row * 256 + (((x * 256) / w) | 0)];
      ov.data[(y0 + y) * ov.w + x0 + x] = v || 1;
    }
  }
}

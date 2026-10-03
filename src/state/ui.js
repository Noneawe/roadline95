// Mid-90s menu widgets drawn into the indexed overlay: scrolling textured background, bevelled panels
// with drop shadows, buttons, choice rows, the colour-cycled logo, and the Menu (keyboard, pad, mouse
// and touch navigation through MenuInput nav events). No DOM; pure drawing and state.
import { RAMP } from '../gfx/palette.js';
import { fillRect } from '../gfx/draw2d.js';
import { drawText, CHAR_W, CHAR_H } from '../gfx/font.js';

const I = (r, l) => r * 16 + l;
export const UI = {
  text: I(RAMP.CLOUD, 15), dim: I(RAMP.CLOUD, 9), hi: I(RAMP.PAINT3, 13), red: I(RAMP.PAINT1, 10), green: I(RAMP.GRASS, 12),
  shadow: I(RAMP.ASPHALT, 1), panel: I(RAMP.PAINT2, 3), panelHi: I(RAMP.PAINT2, 7), panelLo: I(RAMP.PAINT2, 1),
  button: I(RAMP.ROCK, 5), buttonHi: I(RAMP.ROCK, 9), buttonLo: I(RAMP.ROCK, 2), focus: I(RAMP.PAINT1, 6), focusHi: I(RAMP.PAINT1, 10),
};

/** Text scale for the overlay size (2 at 640x480, 1 at 320x240). @param {{ w: number }} ov */
export const uiScale = (ov) => (ov.w >= 640 ? 2 : 1);

/**
 * Tiled, slowly scrolling, darkened texture (64x64 indexed) as the menu background.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {Uint8Array} tex 64x64 indices @param {number} t seconds
 */
export function drawBackground(ov, tex, t) {
  const d = ov.data, w = ov.w, sx = Math.floor(t * 8), sy = Math.floor(t * 5), dark = ov.w >= 640 ? 6 : 5;
  for (let y = 0; y < ov.h; y++) {
    const row = ((y + sy) & 63) * 64;
    for (let x = 0; x < w; x++) {
      const v = tex[row + ((x + sx) & 63)];
      d[y * w + x] = (v & 0xf0) | Math.max(1, (v & 15) - dark);
    }
  }
}

/**
 * Bevelled panel with a drop shadow.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [face] @param {number} [hi] @param {number} [lo]
 */
export function drawPanel(ov, x, y, w, h, face = UI.panel, hi = UI.panelHi, lo = UI.panelLo) {
  const s = uiScale(ov) * 2;
  fillRect(ov, x + s, y + s, w, h, UI.shadow);
  fillRect(ov, x, y, w, h, face);
  fillRect(ov, x, y, w, 2, hi);
  fillRect(ov, x, y, 2, h, hi);
  fillRect(ov, x, y + h - 2, w, 2, lo);
  fillRect(ov, x + w - 2, y, 2, h, lo);
}

/**
 * Text centred horizontally at y.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {string} text @param {number} y @param {number} index @param {number} [scale]
 */
export function centerText(ov, text, y, index, scale = 1) {
  drawText(ov, text, Math.round((ov.w - text.length * CHAR_W * scale) / 2), Math.round(y), index, UI.shadow, scale);
}

// Logo letters cycle through a fire gradient (yellow -> orange -> red), shifting every frame:
// the classic palette-cycling look, done by rotating the indices of the logo pixels.
const CYCLE = [I(RAMP.PAINT3, 15), I(RAMP.PAINT3, 13), I(RAMP.PAINT3, 11), I(RAMP.LIGHT, 4), I(RAMP.PAINT1, 11), I(RAMP.PAINT1, 9), I(RAMP.PAINT1, 7), I(RAMP.PAINT1, 9), I(RAMP.PAINT1, 11), I(RAMP.LIGHT, 4), I(RAMP.PAINT3, 11), I(RAMP.PAINT3, 13)];
const MARK = 255;

/**
 * "ROADLINE '95" logo with colour cycling.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {number} y top @param {number} t seconds
 * @param {number} [scale] letter scale (default: 3x the text scale) @param {boolean} [subtitle]
 */
export function drawLogo(ov, y, t, scale = uiScale(ov) * 3, subtitle = true) {
  const s = scale, text = "ROADLINE '95", w = text.length * CHAR_W * s, x = Math.round((ov.w - w) / 2);
  drawText(ov, text, x + s, y + s, UI.shadow, 0, s);
  drawText(ov, text, x, y, MARK, 0, s);
  const shift = Math.floor(t * 12), d = ov.data;
  for (let yy = y; yy < Math.min(ov.h, y + CHAR_H * s); yy++) {
    const c = CYCLE[(((yy - y) >> 1) + shift) % CYCLE.length];
    for (let xx = Math.max(0, x); xx < Math.min(ov.w, x + w); xx++) if (d[yy * ov.w + xx] === MARK) d[yy * ov.w + xx] = c;
  }
  if (subtitle) centerText(ov, 'GRAND TOUR RACING', y + CHAR_H * s + 4, UI.text, uiScale(ov));
}

/**
 * @typedef {object} MenuItem
 * @property {string} label
 * @property {() => string} [value] current value text (choice rows)
 * @property {(dir: number) => void} [change] cycle the value (-1 / +1)
 * @property {() => any} [act] action on confirm; the result is returned by Menu.handle
 * @property {() => boolean} [disabled]
 */

/**
 * @typedef {{ up: boolean, down: boolean, left: boolean, right: boolean, ok: boolean, back: boolean,
 *   px: number, py: number, moved: boolean, click: boolean }} Nav  pointer in overlay pixels
 */

export class Menu {
  /**
   * @param {string} title @param {MenuItem[]} items
   * @param {{ footer?: () => string, width?: number, bottom?: boolean }} [o] bottom: rows at the bottom of the screen (showroom)
   */
  constructor(title, items, o = {}) {
    this.bottom = !!o.bottom;
    this.title = title;
    this.items = items;
    this.footer = o.footer || null;
    this.width = o.width || 34;
    this.focus = items.findIndex((it) => !(it.disabled && it.disabled()));
    if (this.focus < 0) this.focus = 0;
    this.rects = items.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  }

  // Item rectangles for the overlay size (also used for pointer hits).
  layout(ov) {
    const s = uiScale(ov), rowH = CHAR_H * s * 0.75 + 6, w = Math.min(ov.w - 16, this.width * CHAR_W * (s === 2 ? 1.25 : 1)), x = Math.round((ov.w - w) / 2);
    const top = this.bottom ? ov.h - this.items.length * (rowH + 4) - CHAR_H - 8
      : Math.round(Math.max(CHAR_H * s + 24, (ov.h - this.items.length * (rowH + 4)) / 2 + 10));
    this.items.forEach((_, i) => { const r = this.rects[i]; r.x = x; r.y = top + i * (rowH + 4); r.w = w; r.h = rowH; });
    return { s, top };
  }

  move(dir) {
    for (let k = 0; k < this.items.length; k++) {
      this.focus = (this.focus + dir + this.items.length) % this.items.length;
      const it = this.items[this.focus];
      if (!(it.disabled && it.disabled())) return;
    }
  }

  /**
   * Applies navigation; returns the result of an activated item, 'back', 'change' or null.
   * @param {Nav} nav @param {{ w: number, h: number }} ov
   */
  handle(nav, ov) {
    this.layout(ov);
    if (nav.moved || nav.click) {
      const i = this.rects.findIndex((r) => nav.px >= r.x && nav.px < r.x + r.w && nav.py >= r.y && nav.py < r.y + r.h);
      if (i >= 0 && !(this.items[i].disabled && this.items[i].disabled())) {
        this.focus = i;
        if (nav.click) {
          const it = this.items[i], r = this.rects[i];
          if (it.change) { it.change(nav.px < r.x + r.w / 3 ? -1 : 1); return 'change'; }
          return it.act ? it.act() ?? 'act' : null;
        }
      }
    }
    if (nav.up) this.move(-1);
    if (nav.down) this.move(1);
    const it = this.items[this.focus];
    if (nav.back) return 'back';
    if (it && it.change && (nav.left || nav.right)) { it.change(nav.left ? -1 : 1); return 'change'; }
    if (it && nav.ok) {
      if (it.act) return it.act() ?? 'act';
      if (it.change) { it.change(1); return 'change'; }
    }
    return nav.up || nav.down ? 'move' : null;
  }

  /** @param {import('../gfx/overlay.js').Overlay} ov @param {number} t */
  draw(ov, t) {
    const { s, top } = this.layout(ov);
    const ts = this.bottom ? 1 : s;
    centerText(ov, this.title, top - CHAR_H * ts - (this.bottom ? 6 : 14), UI.hi, ts);
    this.items.forEach((it, i) => {
      const r = this.rects[i], f = i === this.focus, off = it.disabled && it.disabled();
      if (f) drawPanel(ov, r.x, r.y, r.w, r.h, UI.focus, UI.focusHi, UI.panelLo);
      else drawPanel(ov, r.x, r.y, r.w, r.h, UI.button, UI.buttonHi, UI.buttonLo);
      const ty = r.y + Math.round((r.h - CHAR_H) / 2), col = off ? UI.dim : f ? UI.hi : UI.text;
      drawText(ov, it.label, r.x + 10, ty, col, UI.shadow);
      if (it.value) {
        const v = it.value(), txt = it.change ? `< ${v} >` : v;
        drawText(ov, txt, r.x + r.w - 10 - txt.length * CHAR_W, ty, f ? UI.text : UI.dim, UI.shadow);
      }
    });
    if (this.footer) centerText(ov, this.footer(), ov.h - CHAR_H - 6, UI.dim);
    if (Math.floor(t * 2) % 2 === 0 && s === 2) fillRect(ov, this.rects[this.focus].x - 8, this.rects[this.focus].y + 6, 4, this.rects[this.focus].h - 12, UI.hi);
  }
}

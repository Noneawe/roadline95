// Touch controls for phones and tablets: on-screen buttons (steer left/right, throttle, brake, handbrake,
// camera, pause) in the overlay, or tilt steering from the device orientation (options). Shown after the
// first touch. Also asks for fullscreen and landscape lock on that touch (both may be refused).
import { CONFIG } from '../config.js';
import { fillRect, strokeRect } from '../gfx/draw2d.js';
import { drawText, CHAR_W } from '../gfx/font.js';
import { UI } from './ui.js';

const BUTTONS = ['left', 'right', 'brake', 'gas', 'hand', 'camera', 'pause'];
const LABELS = { left: '<', right: '>', brake: 'BRK', gas: 'GAS', hand: 'HB', camera: 'CAM', pause: 'II' };

export class TouchControls {
  /** @param {import('../engine/input.js').Pointer} pointer @param {EventTarget} win */
  constructor(pointer, win) {
    this.pointer = pointer;
    this.rects = Object.fromEntries(BUTTONS.map((b) => [b, { x: 0, y: 0, w: 0, h: 0 }]));
    this.down = Object.fromEntries(BUTTONS.map((b) => [b, false]));
    this.was = Object.fromEntries(BUTTONS.map((b) => [b, false]));
    this.tilt = 0;
    this.w = 0;
    this.h = 0;
    win.addEventListener?.('deviceorientation', (e) => {
      const angle = globalThis.screen?.orientation?.angle ?? globalThis.orientation ?? 0;
      // Landscape: turning the phone like a wheel changes beta (sign depends on which side is up).
      const a = angle === 90 ? e.beta : angle === 270 || angle === -90 ? -e.beta : e.gamma;
      this.tilt = Math.max(-1, Math.min(1, (a || 0) / CONFIG.input.tiltRange));
    });
  }

  /** Visible once the player has touched the screen. */
  get active() {
    return this.pointer.touched;
  }

  // Button rectangles for the overlay size: steering bottom-left, pedals bottom-right, small buttons on top.
  layout(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const b = Math.round(h * 0.2), m = Math.round(h * 0.03), y = h - b - m, R = this.rects;
    const set = (k, x, yy, ww, hh) => { R[k].x = x; R[k].y = yy; R[k].w = ww; R[k].h = hh; };
    set('left', m, y, b, b);
    set('right', m * 2 + b, y, b, b);
    set('gas', w - m - b, y - b * 0.5, b, b * 1.5);
    set('brake', w - 2 * m - 2 * b, y, b, b);
    set('hand', w - 2 * m - 2 * b, y - m - b * 0.6, b, b * 0.6);
    set('camera', w - m - b, m + b * 0.3, b, b * 0.5);
    set('pause', w - 2 * m - 2 * b, m + b * 0.3, b, b * 0.5);
  }

  /** Reads the touch points (call once per update). @param {number} w @param {number} h overlay size */
  update(w, h) {
    this.layout(w, h);
    for (const k of BUTTONS) { this.was[k] = this.down[k]; this.down[k] = false; }
    for (const t of this.pointer.touches.values()) {
      for (const k of BUTTONS) {
        const r = this.rects[k];
        if (t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h) this.down[k] = true;
      }
    }
  }

  /** Adds the touch actions to a player's actions (PlayerInput.poll). @param {import('../engine/input.js').Actions} s */
  merge(s) {
    if (!this.active) return;
    const d = this.down;
    if (CONFIG.input.tilt) { if (Math.abs(this.tilt) > 0.05) { s.steer = this.tilt; s.analog = true; } }
    else if (d.left !== d.right) s.steer = d.left ? -1 : 1;
    if (d.gas) s.throttle = 1;
    if (d.brake) s.brake = 1;
    s.handbrake ||= d.hand;
    s.camera ||= d.camera && !this.was.camera;
    s.pause ||= d.pause && !this.was.pause;
  }

  /** @param {import('../gfx/overlay.js').Overlay} ov */
  draw(ov) {
    if (!this.active) return;
    this.layout(ov.w, ov.h);
    for (const k of BUTTONS) {
      if (CONFIG.input.tilt && (k === 'left' || k === 'right')) continue;
      const r = this.rects[k], label = LABELS[k];
      // Binary "glass": a checkerboard of the button colour, solid while pressed.
      if (this.down[k]) fillRect(ov, r.x, r.y, r.w, r.h, UI.focus);
      else for (let y = r.y | 0; y < r.y + r.h && y < ov.h; y++) for (let x = (r.x | 0) + (y & 1); x < r.x + r.w && x < ov.w; x += 2) if (x >= 0 && y >= 0) ov.data[y * ov.w + x] = UI.button;
      strokeRect(ov, r.x, r.y, r.w, r.h, UI.text);
      drawText(ov, label, Math.round(r.x + (r.w - label.length * CHAR_W) / 2), Math.round(r.y + r.h / 2 - 8), UI.text, UI.shadow);
    }
  }
}

/**
 * On the first touch: fullscreen and landscape lock where the browser allows it (errors ignored).
 * @param {HTMLElement} el @param {() => boolean} wantTilt
 */
export function armMobile(el, wantTilt) {
  const once = () => {
    el.removeEventListener('touchend', once);
    try {
      const fs = document.documentElement.requestFullscreen?.();
      Promise.resolve(fs).then(() => globalThis.screen?.orientation?.lock?.('landscape')).catch(() => {});
      const DOE = globalThis.DeviceOrientationEvent;
      if (wantTilt() && DOE && typeof DOE.requestPermission === 'function') DOE.requestPermission().catch(() => {});
    } catch { /* not supported */ }
  };
  el.addEventListener('touchend', once);
}

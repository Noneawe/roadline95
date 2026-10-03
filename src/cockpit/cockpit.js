// Per-frame cockpit and HUD drawing into the overlay: static dashboard blit, gauge needles, digital
// speed, gear, shift lamp and the steering wheel (rotated with the steering angle); external-view HUD.
import { CONFIG } from '../config.js';
import { blit, line, fillRect } from '../gfx/draw2d.js';
import { drawNumber, drawChar, drawText } from '../gfx/font.js';
import { DASH_COLORS, gaugeAngle } from './dashboard.js';

const SPOKES = [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6];
const SPOKE_DIR = new Float64Array(6);

/**
 * Speed in the unit chosen in the options (km/h or mph).
 * @param {number} ms metres per second @returns {number}
 */
export function speedUnit(ms) {
  return CONFIG.units === 'mph' ? ms * 2.23694 : ms * 3.6;
}

/**
 * Gear as a character code: R, N or 1..9.
 * @param {number} gear
 * @returns {number}
 */
export function gearChar(gear) {
  return gear < 0 ? 82 : gear === 0 ? 78 : 48 + gear;
}

/**
 * Draws the cockpit view.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {{ bmp: object, layout: object }} dash
 * @param {import('../vehicle/physics.js').Car} car
 */
export function drawCockpit(ov, dash, car) {
  const L = dash.layout, C = DASH_COLORS, kmh = speedUnit(car.speed), s = L.s;
  blit(ov, dash.bmp, 0, 0);
  steeringWheel(ov, L.wheel, car.steer * CONFIG.cockpit.wheelRatio);
  needle(ov, L.tacho, car.dt.rpm / L.tacho.max, s);
  needle(ov, L.speedo, kmh / L.speedo.max, s);
  drawNumber(ov, kmh, 3, L.lcd.x + Math.round((L.lcd.w - 24) / 2), L.lcd.y + Math.round((L.lcd.h - 16) / 2), C.lcd);
  drawChar(ov, gearChar(car.dt.gear), L.gear.x + Math.round((L.gear.w - 8) / 2), L.gear.y + Math.round((L.gear.h - 16) / 2), C.lcd);
  if (car.dt.rpm > car.spec.gearbox.upRpm - 300 || car.dt.cut) {
    fillRect(ov, L.lamp.x - L.lamp.r, L.lamp.y - L.lamp.r, L.lamp.r * 2, L.lamp.r * 2, C.red);
  }
}

/**
 * Minimal HUD for external cameras: speed, gear and a rev bar (race HUD arrives in stage 5).
 * @param {import('../gfx/overlay.js').Overlay} ov @param {import('../vehicle/physics.js').Car} car
 * @param {number} [lift] pixels to raise it (above the on-screen touch pedals)
 */
export function drawHud(ov, car, lift = 0) {
  const C = DASH_COLORS, big = ov.w >= 640 ? 2 : 1, x = ov.w - 8 - 3 * 8 * big, y = ov.h - 8 - 16 * big - lift;
  drawNumber(ov, speedUnit(car.speed), 3, x, y, C.tick, C.dark, big);
  drawText(ov, CONFIG.units === 'mph' ? ' MPH' : 'KM/H', x - 40, y + 16 * big - 16, C.tick, C.dark);
  drawChar(ov, gearChar(car.dt.gear), x - 40 - 8 * 2 - 8 * big, y, C.needle, C.dark, big);
  const bw = Math.round(ov.w * 0.25), bx = ov.w - 8 - bw, by = y - 10;
  const f = Math.min(1, car.dt.rpm / car.spec.engine.limiter);
  fillRect(ov, bx - 1, by - 1, bw + 2, 6, C.dark);
  fillRect(ov, bx, by, Math.round(bw * f), 4, car.dt.rpm > car.spec.gearbox.upRpm - 300 ? C.red : C.lcd);
}

function needle(ov, g, v, s) {
  const a = gaugeAngle(v), r = g.r * 0.86;
  line(ov, g.x, g.y, g.x + Math.cos(a) * r, g.y - Math.sin(a) * r, DASH_COLORS.needle, s > 0.75 ? 2 : 1);
  fillRect(ov, g.x - 2, g.y - 2, 5, 5, DASH_COLORS.rim);
}

// Rim and three spokes, scanning only the part of the wheel inside the buffer.
function steeringWheel(ov, wh, angle) {
  const { w, h, data } = ov, R = wh.r, t = wh.t, C = DASH_COLORS;
  const y0 = Math.max(0, wh.y - R), x0 = Math.max(0, wh.x - R), x1 = Math.min(w - 1, wh.x + R);
  for (let k = 0; k < 3; k++) { SPOKE_DIR[k * 2] = Math.cos(SPOKES[k] - angle); SPOKE_DIR[k * 2 + 1] = Math.sin(SPOKES[k] - angle); }
  for (let y = y0; y < h; y++) {
    const dy = wh.y - y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - wh.x, d = Math.hypot(dx, dy);
      if (d > R) continue;
      let c = 0;
      if (d > R - t) c = dy > R - t * 1.6 ? C.wheelHi : C.wheel;
      else if (d < R * 0.16) c = C.wheel;
      else {
        for (let k = 0; k < 3; k++) {
          const ux = SPOKE_DIR[k * 2], uy = SPOKE_DIR[k * 2 + 1];
          if (dx * ux + dy * uy > 0 && Math.abs(dx * uy - dy * ux) < t * 0.55) { c = C.wheel; break; }
        }
      }
      if (c) data[y * w + x] = c;
    }
  }
}

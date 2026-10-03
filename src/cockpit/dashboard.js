// Static cockpit bitmap (indexed, generated in code): roof edge, A-pillars, mirror frame, dashboard panel
// textured with the 'dashboard' texture, gauge faces with ticks and labels, LCD and gear windows.
// Layout is designed for 640x480 and scaled to the index-buffer size. No DOM/GL.
import { RAMP } from '../gfx/palette.js';
import { fillRect, strokeRect, line, smallText } from '../gfx/draw2d.js';

const idx = (ramp, level) => ramp * 16 + level;
export const DASH_COLORS = {
  dark: idx(RAMP.ASPHALT, 1), mid: idx(RAMP.ASPHALT, 3), edge: idx(RAMP.ASPHALT, 5), rim: idx(RAMP.ROCK, 8),
  tick: idx(RAMP.CLOUD, 13), red: idx(RAMP.PAINT1, 9), needle: idx(RAMP.PAINT3, 13), lcdBg: idx(RAMP.GRASS, 1),
  lcd: idx(RAMP.GRASS, 12), lamp: idx(RAMP.LIGHT, 6), wheel: idx(RAMP.ASPHALT, 5), wheelHi: idx(RAMP.ASPHALT, 8),
};

/** Gauge sweep: value 0..1 maps from 225 deg to -45 deg (clockwise, y up). */
export function gaugeAngle(v) {
  return ((225 - 270 * Math.min(1.05, Math.max(0, v))) * Math.PI) / 180;
}

/**
 * Builds the static cockpit bitmap and the layout of the dynamic parts.
 * @param {number} w @param {number} h buffer size
 * @param {Uint8Array} dashTex 64x64 indices of the 'dashboard' texture
 * @param {object} spec car spec (rev range for the tachometer) @param {string} [units] 'kmh' | 'mph' speedometer scale
 */
export function buildDashboard(w, h, dashTex, spec, units = 'kmh') {
  const mph = units === 'mph';
  const s = w / 640, S = (v) => Math.round(v * s), C = DASH_COLORS;
  const bmp = { w, h, data: new Uint8Array(w * h) };
  const layout = {
    s,
    mirror: { x: S(225), y: S(18), w: S(190), h: S(44) },
    tacho: { x: S(172), y: S(372), r: S(50), max: 8000 },
    speedo: { x: S(296), y: S(372), r: S(50), max: mph ? 200 : 300 },
    lcd: { x: S(360), y: S(398), w: S(76), h: S(24) },
    gear: { x: S(214), y: S(404), w: S(26), h: S(24) },
    lamp: { x: S(226), y: S(334), r: Math.max(2, S(5)) },
    wheel: { x: S(234), y: S(560), r: S(150), t: Math.max(4, S(13)) },
  };
  // Roof edge and A-pillars.
  fillRect(bmp, 0, 0, w, S(12), C.dark);
  fillRect(bmp, 0, S(12), w, Math.max(1, S(2)), C.mid);
  for (let y = S(12); y < S(330); y++) {
    const pw = Math.max(0, S(38) - Math.round((y - S(12)) * 0.11));
    fillRect(bmp, 0, y, pw, 1, C.dark);
    fillRect(bmp, w - pw, y, pw, 1, C.dark);
  }
  // Mirror frame (inside stays transparent: the mirror view is rendered there).
  const m = layout.mirror, fw = Math.max(2, S(4));
  fillRect(bmp, m.x - fw, m.y - fw, m.w + 2 * fw, fw, C.mid);
  fillRect(bmp, m.x - fw, m.y + m.h, m.w + 2 * fw, fw, C.mid);
  fillRect(bmp, m.x - fw, m.y, fw, m.h, C.mid);
  fillRect(bmp, m.x + m.w, m.y, fw, m.h, C.mid);
  fillRect(bmp, S(318), S(12), S(4), m.y - S(12) - fw, C.dark);
  panel(bmp, layout, dashTex, S);
  gauge(bmp, layout.tacho, 8, spec.engine.redline / 8000, ['0', '1', '2', '3', '4', '5', '6', '7', '8'], s);
  if (mph) gauge(bmp, layout.speedo, 10, 2, ['0', '', '40', '', '80', '', '120', '', '160', '', '200'], s);
  else gauge(bmp, layout.speedo, 15, 2, ['0', '', '', '60', '', '', '120', '', '', '180', '', '', '240', '', '', '300'], s);
  for (const box of [layout.lcd, layout.gear]) {
    fillRect(bmp, box.x, box.y, box.w, box.h, C.lcdBg);
    strokeRect(bmp, box.x - 1, box.y - 1, box.w + 2, box.h + 2, C.edge);
  }
  // Unit labels sit in the empty bottom quadrant of each dial, below the 0 / max labels.
  smallText(bmp, 'RPM', layout.tacho.x - 8, layout.tacho.y + Math.round(layout.tacho.r * 0.56), C.tick);
  smallText(bmp, mph ? 'MPH' : 'KM/H', layout.speedo.x - 11, layout.speedo.y + Math.round(layout.speedo.r * 0.56), C.tick);
  return { bmp, layout };
}

// Panel top: gentle curve plus the binnacle hump over the gauges; filled with the dashboard texture.
function panel(bmp, layout, tex, S) {
  const { w, h } = bmp, s = layout.s, C = DASH_COLORS;
  for (let x = 0; x < w; x++) {
    const bx = x / s, hump = 62 * Math.max(0, 1 - ((bx - 234) / 165) ** 2);
    const top = Math.round((348 + 14 * ((bx - 320) / 320) ** 2 - hump) * s);
    for (let y = Math.max(0, top); y < h; y++) {
      const v = tex[((y & 63) << 6) | (x & 63)];
      bmp.data[y * w + x] = y - top < Math.max(1, S(2)) ? C.edge : v;
    }
  }
}

function gauge(bmp, g, ticks, red, labels, s) {
  const C = DASH_COLORS;
  for (let y = -g.r; y <= g.r; y++) {
    for (let x = -g.r; x <= g.r; x++) {
      const d = Math.hypot(x, y), px = g.x + x, py = g.y + y;
      if (d > g.r || px < 0 || py < 0 || px >= bmp.w || py >= bmp.h) continue;
      bmp.data[py * bmp.w + px] = d > g.r - Math.max(2, Math.round(3 * s)) ? C.rim : C.dark;
    }
  }
  for (let i = 0; i <= ticks; i++) {
    const v = i / ticks, a = gaugeAngle(v), c = Math.cos(a), sn = Math.sin(a);
    const r0 = g.r * (i % 2 === 0 || ticks <= 8 ? 0.72 : 0.8), r1 = g.r * 0.9;
    line(bmp, g.x + c * r0, g.y - sn * r0, g.x + c * r1, g.y - sn * r1, v >= red ? C.red : C.tick, s > 0.75 ? 2 : 1);
    const label = labels[i];
    if (label && s > 0.75) smallText(bmp, label, Math.round(g.x + c * g.r * 0.55 - label.length * 3), Math.round(g.y - sn * g.r * 0.55 - 3), C.tick);
  }
}

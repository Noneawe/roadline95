// Race HUD in the overlay: position, lap (or distance left on a sprint), lap times, track map with car
// dots, start lights, messages (false start, finish, pause, notices), the results table and the
// championship standings. Allocation-free per frame except the results and standings screens.
import { RAMP } from '../gfx/palette.js';
import { fillRect, line, blit, strokeRect } from '../gfx/draw2d.js';
import { drawText, drawNumber, drawTime, CHAR_W } from '../gfx/font.js';

const idx = (ramp, level) => ramp * 16 + level;
const C = {
  text: idx(RAMP.CLOUD, 15), dim: idx(RAMP.CLOUD, 10), shadow: idx(RAMP.ASPHALT, 1), back: idx(RAMP.ASPHALT, 1),
  yellow: idx(RAMP.PAINT3, 13), red: idx(RAMP.PAINT1, 9), redOff: idx(RAMP.PAINT1, 2), green: idx(RAMP.GRASS, 12),
  map: idx(RAMP.CLOUD, 12), mapBack: idx(RAMP.ASPHALT, 2),
};

/**
 * Pre-renders the track outline into a small bitmap.
 * @param {import('../world/track.js').Track} track @param {number} size bitmap size (px)
 */
export function buildTrackMap(track, size) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < track.count; i++) {
    x0 = Math.min(x0, track.pos[i * 3]); x1 = Math.max(x1, track.pos[i * 3]);
    z0 = Math.min(z0, track.pos[i * 3 + 2]); z1 = Math.max(z1, track.pos[i * 3 + 2]);
  }
  const scale = (size - 6) / Math.max(x1 - x0, z1 - z0), ox = (size - (x1 - x0) * scale) / 2, oz = (size - (z1 - z0) * scale) / 2;
  const bmp = { w: size, h: size, data: new Uint8Array(size * size) };
  const toX = (x) => Math.round(ox + (x - x0) * scale), toY = (z) => Math.round(oz + (z - z0) * scale);
  for (let i = 0; i < track.count; i++) {
    const j = (i + 1) % track.count;
    if (!track.closed && j === 0) break;
    line(bmp, toX(track.pos[i * 3]), toY(track.pos[i * 3 + 2]), toX(track.pos[j * 3]), toY(track.pos[j * 3 + 2]), C.map, 2);
  }
  return { bmp, toX, toY };
}

/**
 * Draws the in-race HUD for the player.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {import('../game/race.js').Race} race
 * @param {object} player race entry of the player @param {{ bmp: object, toX: Function, toY: Function }} map
 * @param {{ car: object, isPlayer: boolean }[]} cars @param {boolean} [timeTrial] no position, endless laps
 * @param {string} [notice] message shown during the countdown
 */
export function drawRaceHud(ov, race, player, map, cars, timeTrial = false, notice = '') {
  const big = ov.w >= 640 ? 2 : 1, x = 6, y = 4;
  if (timeTrial) drawText(ov, 'TIME TRIAL', x, y, C.yellow, C.shadow);
  else {
    drawText(ov, 'POS', x, y, C.dim, C.shadow);
    drawNumber(ov, player.position, 1, x + 4 * CHAR_W, y, C.yellow, C.shadow, big);
    drawText(ov, '/', x + 4 * CHAR_W + CHAR_W * big + 2, y, C.dim, C.shadow);
    drawNumber(ov, race.entries.length, 1, x + 6 * CHAR_W + CHAR_W * big, y, C.dim, C.shadow);
  }
  const ly = y + 16 * big + 2;
  if (race.sprint) {
    // Distance to the finish line in metres.
    drawText(ov, 'TO GO', x, ly, C.dim, C.shadow);
    drawNumber(ov, Math.max(0, Math.round(race.lapLength - Math.max(0, race.progress(player)))), 4, x + 6 * CHAR_W, ly, C.text, C.shadow);
  } else {
    drawText(ov, 'LAP', x, ly, C.dim, C.shadow);
    drawNumber(ov, timeTrial ? player.lap + 1 : Math.min(race.cfg.laps, player.lap + 1), 1, x + 4 * CHAR_W, ly, C.text, C.shadow);
    if (!timeTrial) {
      drawText(ov, '/', x + 5 * CHAR_W, ly, C.dim, C.shadow);
      drawNumber(ov, race.cfg.laps, 1, x + 6 * CHAR_W, ly, C.dim, C.shadow);
    }
  }
  const tx = ov.w - 8 * CHAR_W - 6;
  if (race.phase !== 'countdown') drawTime(ov, player.started && !player.finished ? race.time - player.lapStart : 0, tx, y, C.text, C.shadow);
  if (player.lapTimes.length) {
    drawText(ov, 'LAST', tx - 5 * CHAR_W, y + 16, C.dim, C.shadow);
    drawTime(ov, player.lapTimes[player.lapTimes.length - 1], tx, y + 16, C.dim, C.shadow);
    drawText(ov, 'BEST', tx - 5 * CHAR_W, y + 32, C.dim, C.shadow);
    drawTime(ov, player.best, tx, y + 32, C.yellow, C.shadow);
  }
  drawMap(ov, map, cars, ly + 22);
  if (race.phase === 'countdown') drawLights(ov, race.lightsOn, race.cfg.lights, false);
  else if (race.time < 1.2) drawLights(ov, 0, race.cfg.lights, true);
  if (player.falseStart && race.phase === 'countdown') centered(ov, 'FALSE START +5S', ov.h * 0.32, C.red);
  if (notice && race.phase === 'countdown') smallCentered(ov, notice, ov.h * 0.42, C.yellow);
  if (player.finished && race.phase !== 'finished') centered(ov, 'FINISH', ov.h * 0.3, C.yellow);
}

function drawMap(ov, map, cars, top) {
  const b = map.bmp, x = 6;
  fillRect(ov, x - 1, top - 1, b.w + 2, b.h + 2, C.mapBack);
  blit(ov, b, x, top);
  for (const c of cars) {
    const px = x + map.toX(c.car.x), py = top + map.toY(c.car.z), s = c.isPlayer ? 3 : 2;
    fillRect(ov, px - (s >> 1), py - (s >> 1), s, s, c.isPlayer ? C.yellow : C.red);
  }
}

function drawLights(ov, lit, count, green) {
  const r = ov.w >= 640 ? 10 : 6, gap = r * 3, x0 = (ov.w - (count - 1) * gap) / 2, y = Math.round(ov.h * 0.16);
  fillRect(ov, x0 - r * 2, y - r * 2, (count - 1) * gap + r * 4, r * 4, C.back);
  for (let i = 0; i < count; i++) {
    const cx = Math.round(x0 + i * gap), col = green ? C.green : i < lit ? C.red : C.redOff;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.round(Math.sqrt(r * r - dy * dy));
      fillRect(ov, cx - w, y + dy, w * 2 + 1, 1, col);
    }
  }
}

function smallCentered(ov, text, y, color) {
  drawText(ov, text, Math.round((ov.w - text.length * CHAR_W) / 2), Math.round(y), color, C.shadow);
}

/** Short centred message (radio song). @param {import('../gfx/overlay.js').Overlay} ov @param {string} text @param {number} y */
export function drawNotice(ov, text, y) {
  smallCentered(ov, text, y, C.yellow);
}

function centered(ov, text, y, color) {
  const big = ov.w >= 640 ? 2 : 1;
  drawText(ov, text, Math.round((ov.w - text.length * CHAR_W * big) / 2), Math.round(y), color, C.shadow, big);
}

/**
 * Results table (finish order, time or progress); in a time trial the lap times and the best.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {import('../game/race.js').Race} race
 * @param {boolean} [timeTrial]
 */
export function drawResults(ov, race, timeTrial = false) {
  if (timeTrial) { drawTrialResult(ov, race); return; }
  const rows = race.results(), w = Math.min(ov.w - 16, 36 * CHAR_W), h = 40 + rows.length * 17;
  const x = Math.round((ov.w - w) / 2), y = Math.round((ov.h - h) / 2);
  fillRect(ov, x, y, w, h, C.back);
  strokeRect(ov, x, y, w, h, C.dim);
  drawText(ov, 'RESULTS', x + 8, y + 3, C.yellow);
  rows.forEach((e, i) => {
    const ry = y + 20 + i * 17, col = e.isPlayer ? C.yellow : C.text;
    drawNumber(ov, i + 1, 1, x + 8, ry, col);
    drawText(ov, e.name, x + 3 * CHAR_W, ry, col);
    if (e.finished) drawTime(ov, e.finishTime, x + w - 9 * CHAR_W, ry, col);
    else drawText(ov, 'DNF', x + w - 4 * CHAR_W, ry, C.dim);
  });
  drawText(ov, 'ENTER - CONTINUE  SPACE - REPLAY', x + 8, y + h - 18, C.dim);
}

function drawTrialResult(ov, race) {
  const e = race.entries.find((r) => r.isPlayer), w = Math.min(ov.w - 16, 30 * CHAR_W), h = 76;
  const x = Math.round((ov.w - w) / 2), y = Math.round((ov.h - h) / 2);
  fillRect(ov, x, y, w, h, C.back);
  strokeRect(ov, x, y, w, h, C.dim);
  drawText(ov, 'RUN COMPLETE', x + 8, y + 3, C.yellow);
  drawText(ov, 'TIME', x + 8, y + 22, C.text);
  drawTime(ov, e.lapTimes[e.lapTimes.length - 1] || 0, x + w - 9 * CHAR_W, y + 22, C.yellow);
  drawText(ov, 'ENTER - GHOST  SPACE - REPLAY', x + 8, y + h - 18, C.dim);
}

/**
 * Championship standings after a round (or the final table).
 * @param {import('../gfx/overlay.js').Overlay} ov
 * @param {string} title @param {{ name: string, isPlayer: boolean, points: number, last: number }[]} rows
 * @param {string[]} footer extra lines (next round, unlocked car, key prompt)
 */
export function drawStandings(ov, title, rows, footer) {
  const w = Math.min(ov.w - 16, 38 * CHAR_W), h = 24 + rows.length * 17 + footer.length * 16 + 6;
  const x = Math.round((ov.w - w) / 2), y = Math.round((ov.h - h) / 2);
  fillRect(ov, x, y, w, h, C.back);
  strokeRect(ov, x, y, w, h, C.dim);
  drawText(ov, title, x + 8, y + 3, C.yellow);
  drawText(ov, 'PTS', x + w - 5 * CHAR_W, y + 3, C.dim);
  rows.forEach((r, i) => {
    const ry = y + 22 + i * 17, col = r.isPlayer ? C.yellow : C.text;
    drawNumber(ov, i + 1, 1, x + 8, ry, col);
    drawText(ov, r.name, x + 3 * CHAR_W, ry, col);
    drawText(ov, `P${r.last}`, x + w - 11 * CHAR_W, ry, C.dim);
    drawNumber(ov, r.points, 3, x + w - 5 * CHAR_W, ry, col);
  });
  footer.forEach((t, i) => drawText(ov, t, x + 8, y + 26 + rows.length * 17 + i * 16, i === footer.length - 1 ? C.dim : C.green));
}

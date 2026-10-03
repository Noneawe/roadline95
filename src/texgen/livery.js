// Car liveries (CLAUDE.md 9.3): 128x128 indexed paint jobs in the shared car UV layout
// (models/carBuilder.js: x = nose..tail, rows 0..63 = right side bottom..roof centre, 64..127 = left
// side roof centre..bottom). Layers: base colour, style stripes, number roundels, maker badge, sponsor, damage.
import { RAMP as R } from '../gfx/palette.js';
import { glyph5x7 } from '../gfx/font.js';
import { fbmImage } from './noise.js';
import { setPixel, forEachPixel } from './ops.js';

export const LIVERY_SIZE = 128;
const S = LIVERY_SIZE;
// Rows (right half) of the profile bands: sill top, side panel top (belt), roof centre.
const SILL = 10, BELT = 35, TOP = 64;
const WHITE = [R.CLOUD, 15], BLACK = [R.ASPHALT, 1];

/**
 * Livery of one race entry.
 * @typedef {{ car: number, set: number, number: number }} LiveryEntry
 */

/**
 * Paints a livery into a 128x128 working image.
 * @param {import('./ops.js').TexImage} img
 * @param {() => number} rng
 * @param {object} spec car spec (body.cabin, livery: style, maker, sponsor, sets)
 * @param {number} set colour set 0..2 @param {number} number race number 1..99 @param {boolean} scratched
 */
export function paintLivery(img, rng, spec, set, number, scratched) {
  const L = spec.livery, [br, bl, sr, sl] = L.sets[set % L.sets.length];
  const base = [R[br], bl], stripe = [R[sr], sl], noise = fbmImage(rng, S, 8, 2);
  forEachPixel(img, (x, y, i) => {
    const r = y < TOP ? y : S - 1 - y;
    setPixel(img, x, y, base[0], base[1] + (noise[i] - 0.5) * 1.2 - (r < SILL ? 3 : 0));
  });
  STYLES[L.style](img, base, stripe, spec);
  const [c0, c1, c2] = spec.body.cabin, door = Math.round(((c1 + c2) / 2) * S) - 4;
  roundel(img, door, 22, number);
  // Sponsor ink contrasts with the colour under the label (base or a style band).
  const sx = Math.min(S - 6 * L.sponsor.length - 4, door + 14), under = 17 * S + sx;
  const ink = img.level[under] >= 10 || img.ramp[under] === R.CLOUD ? BLACK : WHITE;
  label(img, L.sponsor, sx, 14, ink);
  // Maker badge on the hood front, across the centre line (seen from above).
  const bx = Math.round(c0 * S * 0.35);
  rect(img, bx, TOP - 5, 13, 10, ...BLACK);
  text(img, L.maker, bx + 1, TOP - 4, WHITE, false);
  if (scratched) scrapes(img, rng);
}

const STYLES = {
  // Two stripes over hood, roof and deck plus a thin side stripe.
  twin(img, base, stripe) {
    band(img, 0, S, TOP - 7, 4, stripe);
    band(img, 0, S, 30, 3, stripe);
  },
  // Rising side swoosh and a dark engine cover.
  wedge(img, base, stripe) {
    for (let x = 0; x < S; x++) band(img, x, 1, 14 + Math.round((x / S) * 18), 5, stripe);
    band(img, 70, S - 70, TOP - 4, 4, stripe);
  },
  // Lower body in the second colour with a thin dark divider.
  twoTone(img, base, stripe) {
    band(img, 0, S, 0, 24, stripe);
    band(img, 0, S, 24, 1, [base[0], Math.max(1, base[1] - 5)]);
  },
  // Big colour block around the doors and a wide centre stripe.
  rally(img, base, stripe, spec) {
    const [, c1, c2] = spec.body.cabin, x0 = Math.round(c1 * S) - 8, x1 = Math.round(c2 * S) + 8;
    band(img, x0, x1 - x0, SILL, BELT - SILL - 4, stripe);
    band(img, 0, S, TOP - 10, 10, stripe);
  },
  // Thin double pinstripe along the shoulder and one on the centre line.
  pinstripe(img, base, stripe) {
    band(img, 0, S, 31, 1, stripe);
    band(img, 0, S, 34, 1, stripe);
    band(img, 0, S, TOP - 1, 1, stripe);
  },
};

// Horizontal band on both sides: rows y..y+h of the right half and their mirror on the left half.
function band(img, x, w, y, h, [ramp, level]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      setPixel(img, xx, yy, ramp, level);
      setPixel(img, xx, S - 1 - yy, ramp, level);
    }
  }
}

function rect(img, x, y, w, h, ramp, level) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPixel(img, xx, yy, ramp, level);
}

// 5x7 text at (x, y) in image space; `flip` rotates it by 180 degrees around its box.
function text(img, str, x, y, [ramp, level], flip) {
  const w = str.length * 6 - 1;
  for (let i = 0; i < str.length; i++) {
    const cols = glyph5x7(str.charCodeAt(i));
    for (let c = 0; c < 5; c++) {
      for (let r = 0; r < 7; r++) {
        if (!(cols[c] & (1 << r))) continue;
        const px = i * 6 + c, py = r;
        setPixel(img, flip ? x + w - 1 - px : x + px, flip ? y + 6 - py : y + py, ramp, level);
      }
    }
  }
}

// Text on both sides, readable from outside: the right half is seen upside down and mirrored.
function label(img, str, x, y, ink) {
  text(img, str, x, y, ink, true);
  text(img, str, x, S - 7 - y, ink, false);
}

// White disc with a black race number on both doors.
function roundel(img, cx, cy, number) {
  for (const side of [0, 1]) {
    const yc = side ? S - 1 - cy : cy;
    for (let y = -9; y <= 9; y++) for (let x = -10; x <= 10; x++) if ((x * x) / 110 + (y * y) / 90 <= 1) setPixel(img, cx + x, yc + y, ...WHITE);
  }
  const str = String(number), w = str.length * 6 - 1;
  label(img, str, cx - (w >> 1), cy - 3, BLACK);
}

// Bare-metal scrapes for the damaged variant.
function scrapes(img, rng) {
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(rng() * S), y = Math.floor(rng() * S), len = 10 + Math.floor(rng() * 30), slope = rng() < 0.5 ? 0 : 1;
    for (let t = 0; t < len; t++) setPixel(img, x + t, y + (slope ? Math.floor(t / 5) : 0), R.ROCK, 9 + (t & 1));
  }
}

/**
 * Default entries: one per livery slot (cars in order, race numbers 1..8).
 * @param {number} count
 * @param {number} cars number of car specs
 * @returns {LiveryEntry[]}
 */
export function defaultLiveries(count, cars) {
  return Array.from({ length: count }, (_, k) => ({ car: k % cars, set: Math.floor(k / cars), number: k + 1 }));
}

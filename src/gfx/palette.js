// 256-colour palette: 16 ramps x 16 levels (index = ramp * 16 + level), plus nearest-colour search.
// Index 0 is reserved (transparent in textures and overlay) and never returned by nearestIndex.

/** Ramp numbers, shared by texture generator and colormap. */
export const RAMP = {
  ASPHALT: 0, CONCRETE: 1, GRASS: 2, LEAVES: 3, DIRT: 4, SAND: 5, ROCK: 6, BRICK: 7,
  WATER: 8, SKY: 9, CLOUD: 10, PAINT1: 11, PAINT2: 12, PAINT3: 13, SKIN: 14, LIGHT: 15,
};

// Colour stops per ramp, dark to bright; levels are interpolated evenly between stops.
const RAMP_STOPS = [
  [[0, 0, 0], [64, 64, 70], [204, 204, 210]],
  [[20, 18, 14], [110, 104, 92], [228, 220, 202]],
  [[6, 16, 4], [52, 104, 30], [176, 214, 96]],
  [[4, 14, 8], [30, 82, 40], [128, 176, 92]],
  [[18, 10, 4], [98, 66, 38], [206, 166, 116]],
  [[40, 30, 14], [176, 150, 96], [252, 238, 192]],
  [[14, 14, 16], [92, 88, 84], [200, 196, 184]],
  [[24, 6, 4], [142, 52, 34], [238, 152, 112]],
  [[2, 8, 24], [20, 70, 122], [124, 194, 232]],
  [[20, 40, 92], [82, 132, 202], [204, 228, 252]],
  [[60, 64, 78], [172, 174, 182], [255, 255, 255]],
  [[32, 2, 2], [182, 20, 16], [255, 176, 144]],
  [[2, 6, 38], [22, 52, 172], [154, 194, 255]],
  [[38, 26, 0], [212, 170, 10], [255, 250, 176]],
  [[32, 14, 8], [172, 112, 78], [252, 212, 172]],
  // Lights: levels 0-7 red (tail lights), 8-15 amber to white (headlights, lamps).
  [[60, 0, 0], [255, 40, 24], [150, 80, 0], [255, 255, 236]],
];

/**
 * Builds the RGBA palette (256 * 4 bytes).
 * @returns {Uint8Array}
 */
export function buildPalette() {
  const pal = new Uint8Array(256 * 4);
  for (let r = 0; r < 16; r++) {
    const stops = RAMP_STOPS[r];
    for (let l = 0; l < 16; l++) {
      let c;
      if (r === RAMP.LIGHT) {
        const seg = l < 8 ? 0 : 2, t = (l % 8) / 7;
        c = stops[seg].map((v, i) => v + (stops[seg + 1][i] - v) * t);
      } else {
        const pos = (l / 15) * (stops.length - 1), s = Math.min(Math.floor(pos), stops.length - 2), t = pos - s;
        c = stops[s].map((v, i) => v + (stops[s + 1][i] - v) * t);
      }
      const o = (r * 16 + l) * 4;
      pal[o] = Math.round(c[0]); pal[o + 1] = Math.round(c[1]); pal[o + 2] = Math.round(c[2]); pal[o + 3] = 255;
    }
  }
  pal[0] = pal[1] = pal[2] = 0; // reserved index 0
  return pal;
}

/**
 * Perceptually weighted ("redmean") squared colour distance.
 * @param {number} r1 @param {number} g1 @param {number} b1 @param {number} r2 @param {number} g2 @param {number} b2
 * @returns {number}
 */
export function colorDistance(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * Nearest palette index (1..255, never 0) to an RGB colour.
 * @param {Uint8Array} pal RGBA palette @param {number} r @param {number} g @param {number} b
 * @returns {number}
 */
export function nearestIndex(pal, r, g, b) {
  let best = 1, bestD = Infinity;
  for (let i = 1; i < 256; i++) {
    const d = colorDistance(r, g, b, pal[i * 4], pal[i * 4 + 1], pal[i * 4 + 2]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

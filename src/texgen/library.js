// Texture library: every indexed texture of the game (CLAUDE.md 9.2): 64x64 tiles and sprites plus the
// 128x128 car liveries of the current race entries (texgen/livery.js).
// Image row 0 is the top of the texture; model UVs use v growing downwards.
// 'tile' textures must wrap seamlessly; 'cutout' textures contain index 0 (transparent) pixels.
import { makeRng, hashString } from '../engine/rng.js';
import { RAMP as R } from '../gfx/palette.js';
import { fbmImage, voronoiImage, valueNoise } from './noise.js';
import { makeImage, setPixel, quantize, downsample, fillRect, drawText5x7, forEachPixel } from './ops.js';
import { paintLivery, defaultLiveries, LIVERY_SIZE } from './livery.js';
import { CARS } from '../vehicle/cars.js';

export const TEX_SIZE = 64;
const S = TEX_SIZE;
const TAU = Math.PI * 2;

/**
 * @typedef {object} TextureDef
 * @property {string} name
 * @property {boolean} tile seamless tiling texture
 * @property {boolean} [cutout] contains transparent pixels
 * @property {boolean} [wrapX] false for strips that only repeat along v (default true)
 * @property {number} dither ordered dither strength 0..1
 * @property {[number, number]} shades allowed number of distinct indices
 * @property {(rng: () => number, img: import('./ops.js').TexImage, seed: number) => void} gen
 */

const BAYER_DOT = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const tile = (name, shades, dither, gen) => ({ name, tile: true, cutout: false, shades, dither, gen });
const cutTile = (name, shades, dither, gen) => ({ name, tile: true, cutout: true, shades, dither, gen });
// Non-repeating opaque texture mapped once per face (e.g. broken lamps).
const single = (name, shades, dither, gen) => ({ name, tile: false, cutout: false, shades, dither, gen });
const sprite = (name, shades, dither, gen) => ({ name, tile: false, cutout: true, shades, dither, gen });

// ---- shared painters ------------------------------------------------------

function asphalt(rng, img, base) {
  const n = fbmImage(rng, S, 8, 3, 0.55), fine = fbmImage(rng, S, 32, 1);
  forEachPixel(img, (x, y, i) => {
    const l = base + n[i] * 2.2 + (fine[i] - 0.5) * 1.2 + (fine[i] > 0.86 ? 1.5 : 0);
    setPixel(img, x, y, R.ASPHALT, l);
  });
}

function tree(rng, img) {
  const n = fbmImage(rng, S, 8, 3);
  forEachPixel(img, (x, y, i) => {
    const dx = x - 32, dy = y - 24, d = Math.hypot(dx, dy), edge = 19 + (n[i] - 0.5) * 12;
    if (d < edge) setPixel(img, x, y, R.LEAVES, 1.5 + ((-dx - dy) / 44 + 0.5) * 3 + n[i] * 3 + (1 - d / edge) * 1.5);
    else if (y >= 36 && x >= 29 && x <= 34) setPixel(img, x, y, R.DIRT, (x === 29 || x === 34 ? 2 : 4) + n[i]);
    else setPixel(img, x, y, -1, 0);
  });
}

function clear(img) {
  forEachPixel(img, (x, y) => setPixel(img, x, y, -1, 0));
}

function person(img, x, y, shirt, arms, rng) {
  const skin = rng() < 0.5 ? 6 : 9;
  fillRect(img, x + 1, y, 4, 4, R.SKIN, skin);
  fillRect(img, x, y + 4, 6, 7, shirt[0], shirt[1]);
  fillRect(img, x, y + 4, 1, 7, shirt[0], shirt[1] - 2);
  fillRect(img, x + 1, y + 11, 2, 3, R.PAINT2, 3);
  fillRect(img, x + 3, y + 11, 2, 3, R.PAINT2, 3);
  if (arms === 1) { fillRect(img, x - 1, y - 3, 1, 6, R.SKIN, skin); fillRect(img, x + 6, y - 3, 1, 6, R.SKIN, skin); }
  if (arms === 2) fillRect(img, x + 6, y - 3, 1, 6, R.SKIN, skin);
}

const SHIRTS = [[R.PAINT1, 8], [R.PAINT2, 8], [R.PAINT3, 10], [R.CLOUD, 13], [R.GRASS, 8], [R.PAINT1, 11]];

function crowd(frame) {
  return (rng, img, seed) => {
    clear(img);
    const people = makeRng((seed ^ hashString('crowd')) >>> 0);
    for (let row = 0; row < 3; row++) {
      for (let k = 0; k < 8; k++) {
        const shirt = SHIRTS[Math.floor(people() * SHIRTS.length)], phase = Math.floor(people() * 3);
        const arms = (phase + frame) % 3 === 0 ? 1 : (phase + frame) % 3 === 1 ? 2 : 0;
        person(img, k * 8 + (row & 1) * 4 + 1, 6 + row * 20, shirt, arms, people);
      }
    }
  };
}

function ad(text, bg, fg, stripe) {
  return (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, bg[0], bg[1] + (n[i] - 0.5) * 0.8));
    fillRect(img, 0, 0, S, 3, R.ASPHALT, 2);
    fillRect(img, 0, S - 3, S, 3, R.ASPHALT, 2);
    fillRect(img, 0, 38, S, 3, stripe[0], stripe[1]);
    drawText5x7(img, text, Math.floor((S - text.length * 6 + 1) / 2), 24, fg[0], fg[1]);
  };
}

// [ramp, level, stripe ramp, stripe level] of the test car paint.
const PAINT_TEST = [R.PAINT1, 8, R.CLOUD, 13];
export const LIVERY_SLOTS = 8;

function liverySlots() {
  const slot = (k, scratched) => ({
    name: `livery${scratched ? 'Scratched' : ''}${k || ''}`, tile: false, cutout: false, size: LIVERY_SIZE,
    shades: [4, 30], dither: 0.5, livery: { slot: k, scratched },
  });
  return [...Array.from({ length: LIVERY_SLOTS }, (_, k) => slot(k, false)), ...Array.from({ length: LIVERY_SLOTS }, (_, k) => slot(k, true))];
}

// Body paint with a side stripe; `scratched` adds bare-metal scrapes and dents (damage).
function paint(ramp, level, stripeRamp, stripeLevel, scratched) {
  return (rng, img) => {
    const n = fbmImage(rng, S, 4, 2), dent = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      if (y >= 40 && y < 48) setPixel(img, x, y, stripeRamp, stripeLevel);
      else if (y === 39 || y === 48) setPixel(img, x, y, ramp, Math.max(1, level - 5));
      else setPixel(img, x, y, ramp, level + n[i] * 1.5 - (scratched ? (dent[i] > 0.6 ? 2.5 : 0) : 0));
    });
    if (!scratched) return;
    for (let k = 0; k < 9; k++) {
      const x = Math.floor(rng() * S), y = Math.floor(rng() * S);
      const len = 8 + Math.floor(rng() * 20), dy = rng() < 0.5 ? 0 : 1;
      for (let t = 0; t < len; t++) setPixel(img, x + t, y + (dy ? Math.floor(t / 4) : 0), R.ROCK, 9 + (t & 1));
    }
  };
}

// ---- definitions ------------------------------------------------------------

/** @type {TextureDef[]} */
export const TEXTURE_DEFS = [
  // Stage 1 test textures (render test scene).
  tile('checker', [2, 6], 1, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.CONCRETE, (((x >> 3) + (y >> 3)) & 1 ? 11 : 5) + (n[i] - 0.5) * 1.2));
  }),
  // Plain red paint with a side stripe (stage 1 test car in the render scene).
  tile('paint', [3, 8], 0.5, paint(...PAINT_TEST, false)),
  // Car liveries: placeholders replaced per race entry by generateLibrary (slots livery..livery7 and
  // liveryScratched..liveryScratched7 are consecutive, so the per-car VARIANT offset selects the entry).
  ...liverySlots(),

  // Road (u across the carriageway 0..1, v along the track).
  tile('asphalt0', [4, 8], 1, (rng, img) => asphalt(rng, img, 4.5)),
  tile('asphalt1', [4, 9], 1, (rng, img) => {
    asphalt(rng, img, 4.8);
    const streak = valueNoise(rng, 32, 2);
    forEachPixel(img, (x, y, i) => {
      const lane = Math.max(0, 1 - Math.min(Math.abs(x - 19), Math.abs(x - 45)) / 6);
      img.level[i] -= lane * (1.2 + streak(x / S, y / S));
    });
  }),
  tile('asphalt2', [4, 9], 1, (rng, img) => {
    asphalt(rng, img, 4.3);
    for (let k = 0; k < 3; k++) {
      const px = Math.floor(rng() * S), py = Math.floor(rng() * S), w = 10 + Math.floor(rng() * 14), h = 8 + Math.floor(rng() * 20);
      for (let y = py; y < py + h; y++) for (let x = px; x < px + w; x++) img.level[((y % S) * S) + (x % S)] += 1.3;
    }
    const v = voronoiImage(rng, S, 10);
    forEachPixel(img, (x, y, i) => { if (v.id[i] % 3 === 0 && v.f2[i] - v.f1[i] < 0.05) img.level[i] = 2; });
  }),
  tile('asphaltWet', [4, 9], 1, (rng, img) => {
    const n = fbmImage(rng, S, 8, 3), streak = fbmImage(rng, S, 16, 2, 0.5, { periodY: 2 });
    forEachPixel(img, (x, y, i) => {
      if (streak[i] > 0.68) setPixel(img, x, y, R.WATER, 3.5 + (streak[i] - 0.68) * 8);
      else setPixel(img, x, y, R.ASPHALT, 2.5 + n[i] * 2);
    });
  }),
  cutTile('lineCenter', [2, 4], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, y >= 20 && y < 44 ? R.CLOUD : -1, n[i] > 0.85 ? 10.5 : 13.5));
  }),
  { ...tile('lineEdge', [5, 10], 1, null), wrapX: false, gen: (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      if (x < 14) setPixel(img, x, y, R.CLOUD, n[i] > 0.85 ? 11 : 13.5);
      else if (x < 48 || n[i] > (x - 48) / 16) setPixel(img, x, y, R.ASPHALT, 4.5 + n[i] * 2);
      else setPixel(img, x, y, R.DIRT, 5 + n[i] * 2);
    });
  } },
  tile('kerb', [4, 10], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      const bevel = x < 3 || x > 60 ? -1.5 : 0;
      if ((y & 31) === 0) setPixel(img, x, y, R.ASPHALT, 3);
      else if (y < 32) setPixel(img, x, y, R.PAINT1, 8 + bevel + (n[i] - 0.5));
      else setPixel(img, x, y, R.CLOUD, 13 + bevel + (n[i] - 0.5));
    });
  }),
  tile('startLine', [3, 6], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => {
      const white = ((x >> 3) + (y >> 5)) & 1;
      setPixel(img, x, y, white ? R.CLOUD : R.ASPHALT, (white ? 13.5 : 2) + (n[i] > 0.8 ? -1.5 : 0));
    });
  }),
  tile('gravelRoad', [5, 10], 1, (rng, img) => {
    const n = fbmImage(rng, S, 8, 3), v = voronoiImage(rng, S, 60);
    forEachPixel(img, (x, y, i) => {
      if (v.f1[i] < 0.22 && v.id[i] % 2 === 0) setPixel(img, x, y, R.ROCK, 6 + (0.22 - v.f1[i]) * 14);
      else setPixel(img, x, y, R.SAND, 5 + n[i] * 3);
    });
  }),

  // Roadside (planar world UVs).
  tile('grass', [5, 9], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 4, 0.6), blades = fbmImage(rng, S, 32, 1, 0.5, { periodY: 8 });
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.GRASS, 3 + n[i] * 4.5 + (blades[i] > 0.7 ? 1.5 : 0)));
  }),
  tile('grassDry', [5, 10], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 4, 0.6), patch = fbmImage(rng, S, 4, 3);
    forEachPixel(img, (x, y, i) => {
      if (patch[i] > 0.6) setPixel(img, x, y, R.SAND, 5 + n[i] * 3);
      else setPixel(img, x, y, R.GRASS, 5.5 + n[i] * 3.5);
    });
  }),
  tile('sand', [4, 8], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 3);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.SAND, 7.5 + Math.sin((TAU * (2 * x + 5 * y)) / S + n[i] * 5) * 1.2 + n[i] * 1.5));
  }),
  tile('gravel', [5, 10], 0.5, (rng, img) => {
    const v = voronoiImage(rng, S, 48), tones = Float32Array.from({ length: 48 }, () => rng());
    forEachPixel(img, (x, y, i) => {
      if (v.f2[i] - v.f1[i] < 0.08) setPixel(img, x, y, R.ROCK, 2.5);
      else setPixel(img, x, y, R.ROCK, 5 + tones[v.id[i]] * 3 + (1 - v.f1[i]) * 2);
    });
  }),
  tile('dirt', [4, 9], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 4, 0.55), v = voronoiImage(rng, S, 24);
    forEachPixel(img, (x, y, i) => {
      if (v.f1[i] < 0.12) setPixel(img, x, y, R.ROCK, 7);
      else setPixel(img, x, y, R.DIRT, 3 + n[i] * 5);
    });
  }),

  // Structures.
  tile('concrete', [4, 8], 1, (rng, img) => {
    const n = fbmImage(rng, S, 16, 2), stain = fbmImage(rng, S, 4, 3);
    forEachPixel(img, (x, y, i) => {
      if ((y & 31) === 31 || (x & 31) === 31) setPixel(img, x, y, R.CONCRETE, 5);
      else setPixel(img, x, y, R.CONCRETE, 8 + n[i] * 2 - (stain[i] > 0.7 ? 1.5 : 0));
    });
  }),
  cutTile('barrier', [4, 10], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => {
      if (y >= 18 && y <= 45) {
        const edge = y === 18 || y === 45;
        setPixel(img, x, y, R.ROCK, edge ? 4 : 8 + 3 * Math.cos(((y - 18) / 27) * TAU * 2) + (n[i] - 0.5));
        if ((x === 30 || x === 33) && (y === 25 || y === 38)) setPixel(img, x, y, R.ROCK, 3);
      } else if (x >= 28 && x <= 35 && y > 45) {
        setPixel(img, x, y, R.ROCK, x === 28 || x === 35 ? 3 : 5);
      } else {
        setPixel(img, x, y, -1, 0);
      }
    });
  }),
  tile('tyreStack', [4, 7], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => {
      const row = y >> 4, cx = ((x - (row & 1) * 8) % 16 + 16) % 16 - 7.5, cy = (y & 15) - 7.5, d = Math.hypot(cx, cy);
      let l = 1;
      if (d < 7.5 && d >= 3) l = 3 + (-cx - cy > 4 ? 2 : 0) - (d > 6.5 ? 1 : 0);
      setPixel(img, x, y, R.ASPHALT, l + (n[i] - 0.5) * 0.8);
    });
  }),
  tile('ad0', [3, 8], 0, ad('VOLTRAX', [R.PAINT2, 6], [R.PAINT3, 14], [R.CLOUD, 14])),
  tile('ad1', [3, 8], 0, ad('ZEPTA OIL', [R.PAINT3, 10], [R.PAINT1, 4], [R.PAINT1, 7])),
  tile('ad2', [3, 8], 0, ad('GLIMMO', [R.CLOUD, 14], [R.PAINT1, 7], [R.PAINT2, 7])),
  tile('ad3', [3, 8], 0, ad('RAXTON', [R.PAINT1, 7], [R.CLOUD, 15], [R.PAINT3, 13])),
  tile('brick', [4, 10], 0.6, (rng, img) => {
    const n = fbmImage(rng, S, 8, 3), tones = Array.from({ length: 32 }, () => rng() * 3 - 1.5);
    forEachPixel(img, (x, y, i) => {
      const row = y >> 3, lx = (x + (row & 1) * 8) % S;
      if ((y & 7) === 7 || (lx & 15) === 15) setPixel(img, x, y, R.CONCRETE, 8 + n[i] * 2);
      else setPixel(img, x, y, R.BRICK, 5 + tones[row * 4 + (lx >> 4)] + n[i] * 3);
    });
  }),
  tile('tunnelWall', [4, 8], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 8, 3), dirty = Array.from({ length: 16 }, () => rng());
    forEachPixel(img, (x, y, i) => {
      if ((x & 15) === 0 || (y & 15) === 0) setPixel(img, x, y, R.CONCRETE, 2);
      else setPixel(img, x, y, R.CONCRETE, 5 + n[i] * 2 - (dirty[(y >> 4) * 4 + (x >> 4)] > 0.7 ? 1.5 : 0));
    });
  }),
  tile('roof', [4, 8], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      const row = y >> 3, edge = ((x + (row & 1) * 4) & 7) === 0;
      setPixel(img, x, y, R.BRICK, edge ? 2.5 : 3.5 + ((y & 7) / 7) * 3 + (n[i] - 0.5));
    });
  }),
  tile('windows', [5, 9], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      const cx = x & 15, cy = y & 15;
      if (cx >= 3 && cx <= 12 && cy >= 3 && cy <= 13) setPixel(img, x, y, R.SKY, 3 + (((x + y) & 15) < 4 ? 2 : 0));
      else if (cx >= 2 && cx <= 13 && cy >= 2 && cy <= 14) setPixel(img, x, y, R.CONCRETE, 5);
      else setPixel(img, x, y, R.CONCRETE, 9 + n[i]);
    });
  }),
  tile('windowsNight', [4, 9], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2), lit = Array.from({ length: 16 }, () => (rng() < 0.45 ? 9.5 + rng() * 2.5 : 0));
    forEachPixel(img, (x, y, i) => {
      const cx = x & 15, cy = y & 15, on = lit[(y >> 4) * 4 + (x >> 4)];
      if (cx >= 3 && cx <= 12 && cy >= 3 && cy <= 13) setPixel(img, x, y, on ? R.LIGHT : R.SKY, on || 1);
      else setPixel(img, x, y, R.CONCRETE, 1.5 + n[i] * 0.8);
    });
  }),

  // Nature.
  tile('rock', [5, 10], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 4, 0.55), v = voronoiImage(rng, S, 12), tones = Array.from({ length: 12 }, () => rng() * 2);
    forEachPixel(img, (x, y, i) => {
      if (v.f2[i] - v.f1[i] < 0.06) setPixel(img, x, y, R.ROCK, 2);
      else setPixel(img, x, y, R.ROCK, 4 + n[i] * 4 + tones[v.id[i]]);
    });
  }),
  tile('cliff', [5, 10], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 4, 0.55);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.ROCK, 4.5 + 2 * Math.sin((TAU * 3 * y) / S + n[i] * 4) + n[i] * 2.5));
  }),
  tile('water', [4, 8], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 3, 0.5, { perlin: true });
    forEachPixel(img, (x, y, i) => {
      const glint = Math.sin((TAU * (2 * x + 4 * y)) / S + n[i] * 7) > 0.88;
      setPixel(img, x, y, R.WATER, glint ? 10 : 4 + n[i] * 3);
    });
  }),
  cutTile('leaves', [4, 9], 0.5, (rng, img) => {
    const v = voronoiImage(rng, S, 30), n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      if (v.f1[i] < 0.45) setPixel(img, x, y, R.LEAVES, 3 + (1 - v.f1[i] / 0.45) * 3 + n[i] * 1.5);
      else setPixel(img, x, y, -1, 0);
    });
  }),
  tile('bark', [3, 7], 1, (rng, img) => {
    const n = fbmImage(rng, S, 16, 2, 0.5, { periodY: 2 });
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.DIRT, n[i] < 0.3 ? 1.5 : 3 + n[i] * 3));
  }),

  // Sprites (cutout billboards).
  sprite('treeDeciduous', [4, 12], 0.6, tree),
  sprite('treeConifer', [4, 10], 0.6, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => {
      let leaf = false;
      for (let k = 0; k < 4; k++) {
        const y0 = 2 + k * 12, t = (y - y0) / 18;
        if (t >= 0 && t <= 1 && Math.abs(x - 31.5) < t * (8 + k * 5) * (0.85 + 0.3 * n[i])) leaf = true;
      }
      if (leaf) setPixel(img, x, y, R.LEAVES, 1.5 + (x < 32 ? 1.5 : 0) + n[i] * 2.5);
      else if (y >= 52 && x >= 30 && x <= 33) setPixel(img, x, y, R.DIRT, 3);
      else setPixel(img, x, y, -1, 0);
    });
  }),
  sprite('palm', [4, 10], 0.4, (rng, img) => {
    clear(img);
    for (let y = 18; y < S; y++) {
      const cx = Math.round(32 + 6 * Math.sin((63 - y) / 40));
      for (let dx = -1; dx <= 1; dx++) setPixel(img, cx + dx, y, R.DIRT, (y & 3) === 0 ? 4 : 6 + dx);
    }
    const top = Math.round(32 + 6 * Math.sin(45 / 40));
    for (let f = 0; f < 7; f++) {
      const a = (f / 7) * TAU + rng() * 0.4;
      for (let t = 0; t <= 1; t += 0.02) {
        const px = Math.round(top + Math.cos(a) * t * 26), py = Math.round(18 + Math.sin(a) * t * 14 + t * t * 14);
        fillRect(img, px, py, t < 0.8 ? 2 : 1, 2, R.LEAVES, 3 + (1 - t) * 3 + (Math.sin(a) < 0 ? 1 : 0));
      }
    }
  }),
  sprite('bush', [4, 9], 0.6, (rng, img) => {
    const n = fbmImage(rng, S, 8, 3);
    forEachPixel(img, (x, y, i) => {
      const dx = (x - 32) / 29, dy = (y - 46) / 17, d = Math.hypot(dx, dy) - (n[i] - 0.5) * 0.35;
      if (d < 1 && y < 63) setPixel(img, x, y, R.LEAVES, 2 + (1 - dy) * 1.5 + n[i] * 3);
      else setPixel(img, x, y, -1, 0);
    });
  }),
  sprite('crowd0', [6, 16], 0, crowd(0)),
  sprite('crowd1', [6, 16], 0, crowd(1)),
  sprite('crowd2', [6, 16], 0, crowd(2)),
  sprite('flag', [4, 10], 0, (rng, img) => {
    clear(img);
    fillRect(img, 4, 0, 2, S, R.ROCK, 10);
    for (let x = 6; x < 52; x++) {
      const wave = Math.sin((TAU * x) / 40), off = Math.round(3 * wave);
      for (let y = 4; y < 31; y++) {
        const white = ((x - 6) >> 3) + ((y - 4) / 9 | 0) & 1;
        setPixel(img, x, y + off, white ? R.CLOUD : R.ASPHALT, (white ? 13 : 2) + (Math.cos((TAU * x) / 40) > 0 ? 1 : -1));
      }
    }
  }),
  // Spray behind wheels in the rain: a dithered (binary) mist blob, densest low in the middle.
  sprite('spray', [2, 6], 0, (rng, img) => {
    clear(img);
    forEachPixel(img, (x, y) => {
      const dx = (x - 32) / 30, dy = (y - 50) / 30, d = Math.hypot(dx, dy * 1.4);
      const density = Math.max(0, 1 - d) * (y > 58 ? 0.5 : 0.8) + (rng() - 0.5) * 0.15;
      if (y < 62 && density * 16 > BAYER_DOT[((y >> 1) & 3) * 4 + ((x >> 1) & 3)]) setPixel(img, x, y, R.CLOUD, 10 + density * 4);
    });
  }),
  sprite('marshal', [5, 12], 0, (rng, img) => {
    clear(img);
    fillRect(img, 27, 30, 4, 4, R.SKIN, 8);
    fillRect(img, 25, 34, 8, 12, R.PAINT3, 11);
    fillRect(img, 25, 34, 1, 12, R.PAINT3, 8);
    fillRect(img, 26, 46, 3, 14, R.PAINT2, 3);
    fillRect(img, 30, 46, 3, 14, R.PAINT2, 3);
    fillRect(img, 33, 22, 2, 14, R.SKIN, 8);
    fillRect(img, 34, 10, 1, 13, R.ROCK, 9);
    for (let y = 10; y < 20; y++) for (let x = 35; x < 48; x++) setPixel(img, x, y + Math.round(Math.sin((x - 35) / 3)), R.PAINT3, 13 - (x & 1));
  }),

  // Dithered blob shadow under cars: binary transparency, 50% checker of a near-black index.
  sprite('shadowBlob', [1, 1], 0, (rng, img) => {
    forEachPixel(img, (x, y) => {
      const d = Math.hypot((x - 31.5) / 31, (y - 31.5) / 31);
      setPixel(img, x, y, d < 1 && ((x + y) & 1) === 0 ? R.ASPHALT : -1, 1);
    });
  }),

  // Light pool of a street lamp on the road at night: dithered amber disc (NIGHT_ONLY decal).
  sprite('lampPool', [2, 4], 0, (rng, img) => {
    forEachPixel(img, (x, y) => {
      const d = Math.hypot(x - 31.5, y - 31.5) / 31, b = BAYER_DOT[(y & 3) * 4 + (x & 3)];
      const on = d < 1 && b > d * 15;
      setPixel(img, x, y, on ? R.LIGHT : -1, d < 0.45 ? 10 : 9);
    });
  }),

  // Car parts (liveries come in stage 6).
  tile('glass', [2, 6], 1, (rng, img) => {
    const n = fbmImage(rng, S, 4, 2);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.SKY, 1 + Math.abs((((x + y) / S) % 1) * 2 - 1) * 3 + n[i]));
  }),
  single('headlightBroken', [3, 8], 0.5, (rng, img) => {
    const v = voronoiImage(rng, S, 9);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, v.f2[i] - v.f1[i] < 0.05 ? R.CLOUD : R.ASPHALT, v.f2[i] - v.f1[i] < 0.05 ? 11 : 2 + (v.id[i] % 3)));
  }),
  single('taillightBroken', [3, 8], 0.5, (rng, img) => {
    const v = voronoiImage(rng, S, 9);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, v.f2[i] - v.f1[i] < 0.05 ? R.ROCK : R.LIGHT, v.f2[i] - v.f1[i] < 0.05 ? 6 : 1 + (v.id[i] % 2)));
  }),
  tile('headlight', [4, 8], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => {
      const d = Math.hypot((x & 15) - 7.5, (y & 15) - 7.5);
      setPixel(img, x, y, R.LIGHT, d > 7 ? 9 : 15 - d * 0.7 + (n[i] - 0.5));
    });
  }),
  tile('taillight', [3, 7], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.LIGHT,
      (x & 7) === 0 || (y & 7) === 0 ? 2 : 6 - Math.hypot((x & 7) - 4, (y & 7) - 4) * 0.5 + (n[i] - 0.5)));
  }),
  tile('tyre', [2, 6], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 8, 2);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.ASPHALT, 2 + ((y & 7) < 3 ? 2 : 0) + n[i]));
  }),
  tile('grill', [3, 6], 0.5, (rng, img) => {
    const n = fbmImage(rng, S, 16, 1);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.ASPHALT, (x & 15) === 0 ? 5 : y % 8 < 4 ? 1.5 : 4 + n[i]));
  }),
  tile('dashboard', [3, 5], 1, (rng, img) => {
    const n = fbmImage(rng, S, 32, 2);
    forEachPixel(img, (x, y, i) => setPixel(img, x, y, R.ASPHALT, 2.5 + n[i] * 1.6));
  }),
];

/**
 * @typedef {{ name: string, size: number, tile: boolean, wrapX: boolean, cutout: boolean, shades: [number, number], data: Uint8Array, lod: Uint8Array }} Texture
 */

/**
 * Generates all textures deterministically: 64x64 indices plus the 32x32 LOD variant.
 * Each texture gets its own RNG stream (seed ^ name hash), so adding textures does not change others.
 * @param {number} seed
 * @param {import('./livery.js').LiveryEntry[]} [liveries] one entry per livery slot (race grid order)
 * @returns {Texture[]}
 */
export function generateLibrary(seed, liveries = defaultLiveries(LIVERY_SLOTS, CARS.length)) {
  return TEXTURE_DEFS.map((def) => buildTexture(def, seed, liveries));
}

/**
 * Regenerates the two livery textures (clean and scratched) of one grid slot, e.g. after the player
 * picks another car or colour in the menu.
 * @param {number} seed @param {number} slot 0..7 @param {import('./livery.js').LiveryEntry} entry
 * @returns {Texture[]} [livery, scratched livery]
 */
export function generateLiverySlot(seed, slot, entry) {
  const liveries = [];
  liveries[slot] = entry;
  return TEXTURE_DEFS.filter((d) => d.livery && d.livery.slot === slot).map((def) => buildTexture(def, seed, liveries));
}

function buildTexture(def, seed, liveries) {
  const size = def.size || TEX_SIZE, img = makeImage(size), rng = makeRng((seed ^ hashString(def.name)) >>> 0);
  if (def.livery) {
    const e = liveries[def.livery.slot];
    paintLivery(img, rng, CARS[e.car], e.set, e.number, def.livery.scratched);
  } else def.gen(rng, img, seed);
  let far = downsample(img);
  while (far.size > 32) far = downsample(far);
  return {
    name: def.name, size, tile: def.tile, wrapX: def.wrapX !== false, cutout: def.cutout, shades: def.shades,
    data: quantize(img, def.dither), lod: quantize(far, def.dither),
  };
}

// Procedural scenery models (CLAUDE.md 10 format): grandstand, buildings, ad board, tyre stack, lamp post,
// 3D trees, boulder and pit garage. Fronts face +Z (towards the road after placement), base at y = 0.
// UVs are in texture repeats; v grows downwards.
import { emptyModel, addPoly } from './primitives.js';
import { FLAGS } from '../gfx/shaders/world.js';
import { makeRng } from '../engine/rng.js';

const { GOURAUD, CUTOUT, DOUBLE, NIGHT_EMIT, NIGHT_ALT, VARIANT } = FLAGS;

/** Materials of scenery models. 'ad' uses a per-instance texture offset (ad0..ad3). */
export const SCENERY_MATERIALS = {
  concrete: { tex: 'concrete', flags: 0 },
  roof: { tex: 'roof', flags: 0 },
  windows: { tex: 'windows', flags: NIGHT_ALT | NIGHT_EMIT },
  brick: { tex: 'brick', flags: 0 },
  ad: { tex: 'ad0', flags: VARIANT },
  tyres: { tex: 'tyreStack', flags: 0 },
  steel: { tex: 'concrete', flags: 0 },
  lamp: { tex: 'headlight', flags: NIGHT_EMIT },
  bark: { tex: 'bark', flags: GOURAUD },
  leaves: { tex: 'leaves', flags: GOURAUD | CUTOUT | DOUBLE },
  rock: { tex: 'rock', flags: GOURAUD },
  door: { tex: 'grill', flags: 0 },
};

// Axis-aligned box faces with per-face material; uv scale in repeats per metre.
function box(m, x0, x1, y0, y1, z0, z1, mats, uvScale = 0.25, skipBottom = true) {
  const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = { front: [4, 5, 6, 7], back: [1, 0, 3, 2], right: [5, 1, 2, 6], left: [0, 4, 7, 3], top: [7, 6, 2, 3], bottom: [0, 1, 5, 4] };
  for (const [name, idx] of Object.entries(faces)) {
    if (name === 'bottom' && skipBottom) continue;
    const mat = typeof mats === 'string' ? mats : mats[name] || mats.side;
    if (!mat) continue;
    const pts = idx.map((i) => P[i]);
    const w = Math.hypot(...pts[1].map((v, i) => v - pts[0][i])), h = Math.hypot(...pts[3].map((v, i) => v - pts[0][i]));
    const s = typeof uvScale === 'function' ? uvScale(name) : uvScale;
    addPoly(m, pts, [[0, h * s], [w * s, h * s], [w * s, 0], [0, 0]], mat);
  }
}

/** 24 m grandstand: five concrete steps rising away from the road, roof on posts. */
export function grandstandModel() {
  const m = emptyModel('grandstand'), L = 12;
  for (let i = 0; i < 5; i++) box(m, -L, L, 0, 0.6 + i * 0.6, -(i + 1) * 0.9, -i * 0.9, 'concrete', 0.25);
  box(m, -L, L, 0, 4.6, -5.0, -4.5, 'concrete', 0.25);
  for (const x of [-L, -4, 4, L - 0.3]) box(m, x, x + 0.3, 3, 6.2, -0.4, -0.1, 'concrete');
  box(m, -L - 0.5, L + 0.5, 6.2, 6.5, -5.2, 0.6, { top: 'roof', front: 'concrete', back: 'concrete', left: 'concrete', right: 'concrete', bottom: 'concrete' }, 0.25, false);
  return m;
}

/** Office / apartment block; windows light up at night (NIGHT_ALT + NIGHT_EMIT). */
export function buildingModel(w, d, h) {
  const m = emptyModel(`building${w}x${h}`);
  box(m, -w / 2, w / 2, 0, h, -d, 0, { top: 'roof', side: 'windows' }, (face) => (face === 'top' ? 0.1 : 1 / 12));
  return m;
}

/** 8 x 2.5 m advertising board on two posts. */
export function adBoardModel() {
  const m = emptyModel('adBoard');
  addPoly(m, [[-4, 0.6, 0], [4, 0.6, 0], [4, 3.1, 0], [-4, 3.1, 0]], [[0, 1], [3, 1], [3, 0], [0, 0]], 'ad');
  addPoly(m, [[4, 0.6, -0.12], [-4, 0.6, -0.12], [-4, 3.1, -0.12], [4, 3.1, -0.12]], [[0, 1], [2, 1], [2, 0], [0, 0]], 'concrete');
  box(m, -4, 4, 3.1, 3.2, -0.12, 0, 'concrete');
  for (const x of [-3.2, 3.0]) box(m, x, x + 0.2, 0, 0.6, -0.12, 0, 'concrete');
  return m;
}

/** Stack of tyres, 1.2 x 0.9 x 1.2 m. */
export function tyreStackModel() {
  const m = emptyModel('tyreStack');
  box(m, -0.6, 0.6, 0, 0.9, -0.6, 0.6, 'tyres', (face) => (face === 'top' ? 0.8 : 1.1));
  return m;
}

/** Street / pit lamp: pole, arm towards the road (+Z) and an emissive lamp head. */
export function lampPostModel() {
  const m = emptyModel('lampPost');
  box(m, -0.1, 0.1, 0, 7, -0.1, 0.1, 'steel', 0.5);
  box(m, -0.07, 0.07, 6.8, 6.95, 0, 2.2, 'steel', 0.5);
  box(m, -0.3, 0.3, 6.55, 6.8, 1.8, 2.6, { bottom: 'lamp', side: 'steel', top: 'steel' }, 0.5, false);
  return m;
}

/** Deciduous tree: trunk and a cutout leaf canopy (double cone). */
export function treeModel(seed) {
  const m = emptyModel('tree3d'), rng = makeRng(seed);
  box(m, -0.2, 0.2, 0, 2.6, -0.2, 0.2, 'bark', 0.5);
  const seg = 6, r = 2.4 + rng() * 0.4;
  const ring = Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2;
    return [Math.cos(a) * r, 4.2, Math.sin(a) * r];
  });
  for (let k = 0; k < seg; k++) {
    const a = ring[k], b = ring[(k + 1) % seg];
    addPoly(m, [a, b, [0, 6.8, 0]], [[0, 1], [1, 1], [0.5, 0]], 'leaves');
    addPoly(m, [b, a, [0, 2.2, 0]], [[0, 0], [1, 0], [0.5, 1]], 'leaves');
  }
  return m;
}

/** Conifer: trunk and two stacked leaf cones. */
export function coniferModel() {
  const m = emptyModel('conifer3d');
  box(m, -0.18, 0.18, 0, 1.6, -0.18, 0.18, 'bark', 0.5);
  const seg = 6;
  for (const [y0, y1, r] of [[1.2, 5.2, 2.4], [3.8, 8.0, 1.6]]) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
      addPoly(m, [p1, p0, [0, y1, 0]], [[1, 1], [0, 1], [0.5, 0]], 'leaves');
    }
  }
  return m;
}

/** Irregular boulder (low-poly), about 3 m across before instance scaling. */
export function boulderModel(seed) {
  const m = emptyModel('boulder'), rng = makeRng(seed);
  const seg = 7, rings = [[0, 1.0], [0.9, 1.15], [1.8, 0.75]];
  const pts = rings.map(([y, r]) => Array.from({ length: seg }, (_, k) => {
    const a = (k / seg) * Math.PI * 2, rr = r * (1.2 + rng() * 0.5);
    return [Math.cos(a) * rr, y * (0.8 + rng() * 0.3), Math.sin(a) * rr];
  }));
  m.verts.push(...pts.flat(), [0, 2.1, 0]);
  m.uvs.push(...pts.flat().map((p) => [p[0] / 2, p[2] / 2]), [0, 0]);
  const top = seg * 3;
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < seg; k++) {
      const a = r * seg + k, b = r * seg + ((k + 1) % seg), c = b + seg, d = a + seg;
      m.faces.push([[b, a, d, c], [b, a, d, c], 'rock']);
    }
  }
  for (let k = 0; k < seg; k++) {
    const a = 2 * seg + k, b = 2 * seg + ((k + 1) % seg);
    m.faces.push([[b, a, top], [b, a, top], 'rock']);
  }
  m.smooth = ['rock'];
  return m;
}

/** Pit garage block (30 m) with doors facing the road. */
export function pitGarageModel() {
  const m = emptyModel('pitGarage');
  box(m, -15, 15, 0, 5, -10, 0, { top: 'roof', front: 'brick', side: 'brick' }, (f) => (f === 'top' ? 0.1 : 0.25));
  for (let i = 0; i < 5; i++) {
    const x = -13 + i * 6;
    addPoly(m, [[x, 0, 0.02], [x + 4, 0, 0.02], [x + 4, 3.5, 0.02], [x, 3.5, 0.02]], [[0, 1.5], [2, 1.5], [2, 0], [0, 0]], 'door');
  }
  return m;
}

/** Scenery model builders by name (as used in track and zone rules). */
export const SCENERY_MODELS = {
  grandstand: () => grandstandModel(),
  buildingLow: () => buildingModel(14, 12, 9),
  buildingMid: () => buildingModel(18, 14, 18),
  buildingTall: () => buildingModel(16, 16, 30),
  adBoard: () => adBoardModel(),
  tyreStack: () => tyreStackModel(),
  lampPost: () => lampPostModel(),
  tree3d: () => treeModel(7),
  conifer3d: () => coniferModel(),
  boulder: () => boulderModel(3),
  pitGarage: () => pitGarageModel(),
};

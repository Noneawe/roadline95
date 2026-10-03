// Showroom: the selected car turns on a lit podium (studio spotlights through the headlight cones),
// with a spec card (power, mass, 0-100, top speed, drive) and the colour sets; the livery texture of
// the player's slot is regenerated live. Used from the main menu and to pick a car before a race.
import { CONFIG } from '../config.js';
import { CARS } from '../vehicle/cars.js';
import { carStats } from '../vehicle/stats.js';
import { SEASON } from '../data/championship.js';
import { carAvailable } from '../storage.js';
import { emptyModel, addPoly } from '../models/primitives.js';
import { loadModel } from '../models/loader.js';
import { Mesh } from '../gfx/mesh.js';
import { FLAGS } from '../gfx/shaders/world.js';
import { generateLiverySlot } from '../texgen/library.js';
import { loadCarModels, CarVisual } from './raceCar.js';
import { setupView } from './env.js';
import { Menu, drawPanel, UI, uiScale, centerText } from './ui.js';
import { drawText, CHAR_H } from '../gfx/font.js';

const BLURB = {
  vektorGT2: 'WEDGE COUPE - ALL-ROUNDER', auroraRS: 'MID-ENGINE - FASTEST, DEMANDING', breezeTurbo: 'LIGHT ROADSTER - TURBO LAG',
  kestrelST: '4X4 SEDAN - BEST IN THE RAIN', halcyonV12: 'HEAVY GT - HUGE TORQUE', mistralRally: 'RALLY HATCH - QUICK, LOW TOP SPEED',
};

// Podium (16-sided drum) and a large studio floor.
function studioModel() {
  const m = emptyModel('studio'), n = 16, R = 3.2, H = 0.35;
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const p0 = [Math.sin(a0) * R, 0, Math.cos(a0) * R], p1 = [Math.sin(a1) * R, 0, Math.cos(a1) * R];
    addPoly(m, [[p0[0], H, p0[2]], [p1[0], H, p1[2]], [0, H, 0]], [[p0[0] / 4, p0[2] / 4], [p1[0] / 4, p1[2] / 4], [0, 0]], 'top');
    addPoly(m, [[p1[0], 0, p1[2]], [p1[0], H, p1[2]], [p0[0], H, p0[2]], [p0[0], 0, p0[2]]], [[k + 1, 1], [k + 1, 0], [k, 0], [k, 1]], 'rim');
  }
  const F = 40;
  addPoly(m, [[-F, 0, -F], [-F, 0, F], [F, 0, F], [F, 0, -F]], [[0, 0], [0, 10], [10, 10], [10, 0]], 'floor');
  return m;
}
const STUDIO_MATS = { top: { tex: 'checker', flags: FLAGS.GOURAUD }, rim: { tex: 'barrier', flags: 0 }, floor: { tex: 'concrete', flags: 0 } };

/**
 * New livery for a grid slot: both textures (clean and scratched) replaced in the library and on the GPU.
 * @param {{ renderer: object, layers: Map<string, number>, lib: object[] }} ctx @param {number} slot
 * @param {import('../texgen/livery.js').LiveryEntry} entry
 */
export function applyLivery(ctx, slot, entry) {
  for (const tex of generateLiverySlot(CONFIG.seed, slot, entry)) {
    ctx.lib[ctx.lib.findIndex((x) => x.name === tex.name)] = tex;
    ctx.renderer.updateTexture(ctx.layers.get(tex.name), tex);
  }
}

/**
 * @param {object} ctx { renderer, pal, layers, lib, save }
 * @param {{ slot: number, car: number, set: number, title: string, onPick: (car: number, set: number) => void, onBack: () => void }} o
 */
export function createShowroom(ctx, o) {
  const { renderer, pal, layers, save } = ctx;
  renderer.clearMeshes();
  const view = setupView(renderer, pal, 'night', 'clear');
  // Studio light: brighter ambient and a key light from the front; spotlights through the cone lights.
  Object.assign(view.env, { ambient: 11, diffuse: 16, lightDir: [-0.4, -0.75, -0.55], sky: false, fogStart: 60, fogEnd: 200 });
  const layerOf = (t) => layers.get(t);
  const studio = renderer.addMesh(new Mesh(loadModel(studioModel(), STUDIO_MATS, layerOf, { maxEdge: 6, creaseDeg: 50 })));
  const items = [{ mesh: studio, model: null }];
  const visuals = CARS.map((spec) => {
    const v = new CarVisual(renderer, loadCarModels(renderer, spec, layerOf), o.slot);
    items.push(...v.items);
    return v;
  });
  const camera = { pos: [0, 3.4, 8.6], yaw: 0, pitch: -0.36, roll: 0 };
  const turn = { x: 0, y: 0.35, z: 0, heading: 0, groundNormal: [0, 1, 0], ayLocal: 0, latBoost: 1, axLocal: 0, spec: CARS[0] };
  let car = o.car, set = o.set, t = 0;

  const livery = () => applyLivery(ctx, o.slot, { car, set, number: o.slot === 7 ? 1 : 9 });
  livery();
  const locked = () => !carAvailable(CARS[car].id, SEASON.locked, save) && !CONFIG.debug;
  const menu = new Menu(o.title, [
    { label: 'CAR', value: () => CARS[car].name.toUpperCase(), change: (d) => { car = (car + d + CARS.length) % CARS.length; set = 0; livery(); } },
    { label: 'COLOURS', value: () => `${set + 1}/3`, change: (d) => { set = (set + d + 3) % 3; livery(); } },
    { label: 'SELECT', act: () => { o.onPick(car, set); return 'done'; }, disabled: locked },
    { label: 'BACK', act: () => { o.onBack(); return 'done'; } },
  ], { width: 30, bottom: true });

  return {
    view, camera, items, menu,
    /** @param {number} dt @param {import('./ui.js').Nav} nav @param {object} ov */
    update(dt, nav, ov) {
      t += dt;
      if (menu.handle(nav, ov) === 'back') o.onBack();
    },
    prepare(env) {
      turn.heading = t * 0.5;
      turn.spec = CARS[car];
      visuals.forEach((v, k) => v.update(turn, null, camera.pos, k === car));
      // Three spotlights above the podium aimed at the car (cone lights are active in night mode).
      const L = [[-4, 7, 3], [4, 7, 3], [0, 8, -4]];
      L.forEach((p, k) => {
        env.hlPos.set([p[0], p[1], p[2], 16], k * 4);
        const d = Math.hypot(p[0], p[1] - 0.6, p[2]);
        env.hlDir.set([-p[0] / d, -(p[1] - 0.6) / d, -p[2] / d, 0], k * 4);
      });
      env.hlCount = L.length;
    },
    /** @param {import('../gfx/overlay.js').Overlay} ov */
    drawOverlay(ov) {
      const s = uiScale(ov), spec = CARS[car], st = carStats(spec), mph = CONFIG.units === 'mph';
      const w = Math.round(ov.w * 0.42), x = ov.w - w - 8, y = 8, lh = CHAR_H + 2;
      drawPanel(ov, x, y, w, lh * 8 + 12);
      drawText(ov, spec.name.toUpperCase(), x + 8, y + 6, UI.hi, UI.shadow);
      const rows = [
        `POWER  ${st.hp} HP${st.turbo ? ' TURBO' : ''}`, `WEIGHT ${st.mass} KG`,
        `0-${mph ? '60 MPH' : '100 KM/H'} ${(mph ? st.zeroTo60 : st.zeroTo100).toFixed(1)} S`,
        `TOP    ${Math.round(st.vmax * (mph ? 2.23694 : 3.6))} ${mph ? 'MPH' : 'KM/H'}`, `DRIVE  ${st.drive}  ${st.gears} GEARS`,
      ];
      rows.forEach((r, i) => drawText(ov, r, x + 8, y + 8 + lh * (i + 1), UI.text, UI.shadow));
      drawText(ov, BLURB[spec.id] || '', x + 8, y + 8 + lh * 6.5, UI.dim, UI.shadow);
      if (locked()) centerText(ov, 'LOCKED - WIN THE CHAMPIONSHIP', ov.h * 0.5, UI.red, s);
      menu.draw(ov, t);
    },
  };
}

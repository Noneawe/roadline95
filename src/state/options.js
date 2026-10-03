// Game options (CLAUDE.md 15.1 and stage 10): detail, sound, controls and game settings. Each option is a
// list of values; apply() pushes the current choice into CONFIG, the renderer and the mixer at once, so
// changes take effect immediately (scenery density: from the next track load). Saved in storage.js.
import { CONFIG } from '../config.js';
import { buildLayerData } from '../gfx/textures.js';

const VOLUMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

/** Option definitions by group: id, label, values, default index. */
export const OPTION_GROUPS = [
  {
    id: 'detail', label: 'DETAIL', items: [
      { id: 'resolution', label: 'RESOLUTION', values: ['640X480', '320X240'], def: 0 },
      { id: 'textures', label: 'TEXTURES', values: ['ON', 'FLAT'], def: 0 },
      { id: 'perspective', label: 'PERSPECTIVE FIX', values: ['OFF', 'ON'], def: 0 },
      { id: 'distance', label: 'DRAW DISTANCE', values: ['SHORT', 'MEDIUM', 'FAR'], def: 2 },
      { id: 'density', label: 'SCENERY DENSITY', values: ['LOW', 'MEDIUM', 'HIGH'], def: 2 },
      { id: 'carDetail', label: 'DETAILED CARS', values: ['2', '4', 'ALL'], def: 2 },
      { id: 'mirror', label: 'MIRROR', values: ['ON', 'OFF'], def: 0 },
    ],
  },
  {
    id: 'sound', label: 'SOUND', items: [
      { id: 'music', label: 'MUSIC', values: VOLUMES, def: 7 },
      { id: 'sfx', label: 'EFFECTS', values: VOLUMES, def: 8 },
      { id: 'engine', label: 'ENGINES', values: VOLUMES, def: 8 },
      { id: 'mute', label: 'SOUND', values: ['ON', 'OFF'], def: 0 },
    ],
  },
  {
    id: 'controls', label: 'CONTROLS', items: [
      { id: 'gearbox', label: 'GEARBOX', values: ['AUTO', 'MANUAL'], def: 0 },
      { id: 'padSwap', label: 'PAD 1 PLAYS', values: ['PLAYER 1', 'PLAYER 2'], def: 0 },
      { id: 'touch', label: 'TOUCH STEERING', values: ['BUTTONS', 'TILT'], def: 0 },
    ],
  },
  {
    id: 'game', label: 'GAME', items: [
      { id: 'difficulty', label: 'DIFFICULTY', values: ['EASY', 'NORMAL', 'HARD'], def: 1 },
      { id: 'units', label: 'UNITS', values: ['KM/H', 'MPH'], def: 0 },
      { id: 'brakeAssist', label: 'BRAKE ASSIST', values: ['OFF', 'ON'], def: 0 },
      { id: 'traction', label: 'TRACTION CONTROL', values: ['ON', 'OFF'], def: 0 },
      { id: 'steerAssist', label: 'STEERING ASSIST', values: ['ON', 'OFF'], def: 0 },
      { id: 'abs', label: 'ABS', values: ['ON', 'OFF'], def: 0 },
    ],
  },
];

export const OPTION_DEFS = OPTION_GROUPS.flatMap((g) => g.items);

/**
 * Current options: saved choices over the defaults (invalid saved indices are ignored).
 * @param {Object<string, number>} saved @returns {Object<string, number>}
 */
export function resolveOptions(saved = {}) {
  const o = {};
  for (const d of OPTION_DEFS) o[d.id] = Number.isInteger(saved[d.id]) && saved[d.id] < d.values.length ? saved[d.id] : d.def;
  return o;
}

const DISTANCE = [{ far: 240, detail: 140 }, { far: 360, detail: 220 }, { far: Infinity, detail: Infinity }];
const DENSITY = [0.45, 0.7, 1];
const DETAIL_CARS = [2, 4, 99];
const DIFFICULTY = [0.94, 1, 1.035];

/**
 * Applies the options. Game-side settings go to CONFIG (read every step / at race start).
 * @param {Object<string, number>} o
 * @param {{ renderer?: import('../gfx/renderer.js').Renderer, mixer?: import('../audio/mixer.js').Mixer,
 *   lib?: object[], pal?: Uint8Array, resize?: (w: number, h: number) => void }} [ctx]
 */
export function applyOptions(o, ctx = {}) {
  const V = CONFIG.vehicle;
  CONFIG.render.detail = o.resolution ? 'low' : 'high';
  CONFIG.render.perspective = o.perspective === 1;
  CONFIG.render.notex = o.textures === 1;
  CONFIG.cockpit.mirror = o.mirror === 0;
  CONFIG.scenery.density = DENSITY[o.density];
  CONFIG.render.detailCars = DETAIL_CARS[o.carDetail];
  CONFIG.units = o.units ? 'mph' : 'kmh';
  CONFIG.ai.difficulty = DIFFICULTY[o.difficulty];
  V.autoGearbox = o.gearbox === 0;
  V.autoBrake = o.brakeAssist === 1;
  V.tractionControl = o.traction === 0;
  V.steerAssist = o.steerAssist === 0 ? 1.1 : 0;
  V.abs = o.abs === 0;
  CONFIG.input.padSwap = o.padSwap === 1;
  CONFIG.input.tilt = o.touch === 1;
  const r = ctx.renderer;
  if (r) {
    r.perspective = CONFIG.render.perspective;
    r.maxFar = DISTANCE[o.distance].far;
    r.maxDetailFar = DISTANCE[o.distance].detail;
    if (ctx.lib && r.notex !== CONFIG.render.notex) {
      r.notex = CONFIG.render.notex;
      r.setTextures(buildLayerData(ctx.lib, ctx.pal, r.notex), ctx.lib.length * 2);
    }
    const res = CONFIG.render[CONFIG.render.detail];
    if (ctx.resize && (res.w !== r.w || res.h !== r.h)) ctx.resize(res.w, res.h);
  }
  const m = ctx.mixer;
  if (m) {
    const A = CONFIG.audio.volume;
    m.setVolume('music', (A.music * o.music) / 10);
    m.setVolume('sfx', (A.sfx * o.sfx) / 10);
    m.setVolume('ambient', (A.ambient * o.sfx) / 10);
    m.setVolume('voice', (A.voice * o.sfx) / 10);
    m.setVolume('engine', (A.engine * o.engine) / 10);
    m.setMuted(o.mute === 1 || m.forceMute);
  }
}

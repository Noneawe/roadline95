// Front-end menus: main menu, race setups (single race, 2 players, time trial, championship), options
// groups, the pause menu, and the records / controls pages. Built from ui.js Menu objects; the app
// (state/app.js) supplies the actions through `app`.
import { CONFIG } from '../config.js';
import { TRACKS } from '../data/tracks/index.js';
import { SEASON } from '../data/championship.js';
import { CARS } from '../vehicle/cars.js';
import { OPTION_GROUPS } from './options.js';
import { Menu, drawPanel, centerText, UI, uiScale } from './ui.js';
import { drawText, CHAR_H, CHAR_W } from '../gfx/font.js';

export const TIMES = ['AUTO', 'DAY', 'DUSK', 'NIGHT'];
export const WEATHER = ['AUTO', 'CLEAR', 'RAIN', 'FOG'];
const cycle = (v, d, n) => (v + d + n) % n;

/** Race tracks shown in the menus (the stage 2 test loop only with ?debug=1). */
export const menuTracks = () => TRACKS.filter((t) => CONFIG.debug || t.id !== 'testLoop');

/**
 * "M:SS.hh" for records.
 * @param {number} t seconds @returns {string}
 */
export function formatTime(t) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

/** @param {object} app */
export function mainMenu(app) {
  return new Menu('MAIN MENU', [
    { label: 'SINGLE RACE', act: () => app.push(setupMenu(app, 'race')) },
    { label: 'CHAMPIONSHIP', act: () => app.push(setupMenu(app, 'champ')) },
    { label: 'TIME TRIAL', act: () => app.push(setupMenu(app, 'time')) },
    { label: '2 PLAYERS', act: () => app.push(setupMenu(app, 'split')) },
    { label: 'SHOWROOM', act: () => app.showroom(0, null) },
    { label: 'OPTIONS', act: () => app.push(optionsMenu(app)) },
    { label: 'RECORDS', act: () => app.page('records') },
  ], { footer: () => 'ARROWS / PAD / MOUSE / TOUCH  -  ENTER SELECT  -  ESC BACK' });
}

/**
 * Race setup. mode: 'race' | 'split' | 'time' | 'champ'.
 * @param {object} app @param {string} mode
 */
export function setupMenu(app, mode) {
  const s = app.setup, tracks = menuTracks(), items = [];
  const titles = { race: 'SINGLE RACE', split: '2 PLAYERS', time: 'TIME TRIAL', champ: 'CHAMPIONSHIP' };
  if (mode !== 'champ') {
    items.push({ label: 'TRACK', value: () => tracks[s.track % tracks.length].name.toUpperCase(), change: (d) => { s.track = cycle(s.track, d, tracks.length); } });
  }
  items.push({ label: mode === 'split' ? 'CAR PLAYER 1' : 'CAR', value: () => `${CARS[s.car].name.toUpperCase()} ${s.set + 1}`, act: () => app.showroom(0, mode) });
  if (mode === 'split') items.push({ label: 'CAR PLAYER 2', value: () => `${CARS[s.car2].name.toUpperCase()} ${s.set2 + 1}`, act: () => app.showroom(1, mode) });
  if (mode !== 'champ') {
    items.push({ label: 'TIME OF DAY', value: () => TIMES[s.time], change: (d) => { s.time = cycle(s.time, d, TIMES.length); } });
    items.push({ label: 'WEATHER', value: () => WEATHER[s.weather], change: (d) => { s.weather = cycle(s.weather, d, WEATHER.length); } });
  }
  if (mode === 'race' || mode === 'split') {
    items.push({ label: 'LAPS', value: () => (s.laps ? String(s.laps) : 'TRACK'), change: (d) => { s.laps = cycle(s.laps, d, 10); } });
    const max = mode === 'split' ? 6 : 7;
    items.push({ label: 'OPPONENTS', value: () => String(Math.min(s.ai, max)), change: (d) => { s.ai = cycle(Math.min(s.ai, max), d, max + 1); } });
  }
  items.push({ label: 'START', act: () => app.startRace(mode) });
  items.push({ label: 'BACK', act: () => 'back' });
  const footer = mode === 'champ'
    ? () => `${SEASON.rounds.length} ROUNDS  -  TITLES ${app.save.champ.titles} / SEASONS ${app.save.champ.seasons}`
    : mode === 'split' ? () => 'P1: ARROWS . , SPACE C   P2: WSAD E Q SHIFT 1' : null;
  return new Menu(titles[mode], items, { footer });
}

/** @param {object} app */
export function optionsMenu(app) {
  return new Menu('OPTIONS', [
    ...OPTION_GROUPS.map((g) => ({ label: g.label, act: () => app.push(groupMenu(app, g)) })),
    { label: 'KEYS', act: () => app.page('keys') },
    { label: 'BACK', act: () => 'back' },
  ]);
}

// One options group: every row cycles its values and applies them at once.
function groupMenu(app, g) {
  const note = { density: () => 'DENSITY: FROM THE NEXT TRACK' };
  return new Menu(g.label, [
    ...g.items.map((d) => ({
      label: d.label, value: () => d.values[app.options[d.id]],
      change: (dir) => { app.options[d.id] = cycle(app.options[d.id], dir, d.values.length); app.applyOptions(); },
    })),
    { label: 'BACK', act: () => 'back' },
  ], { footer: g.id === 'detail' ? note.density : null, width: 40 });
}

/** Pause menu over a race. @param {object} app */
export function pauseMenu(app) {
  return new Menu('PAUSE', [
    { label: 'CONTINUE', act: () => app.resume() },
    { label: 'RESTART', act: () => app.restart() },
    { label: 'OPTIONS', act: () => app.push(optionsMenu(app)) },
    { label: 'QUIT TO MENU', act: () => app.quit() },
  ]);
}

/**
 * Information pages: 'records' (best lap and race per track, championship history) and 'keys'.
 * @param {import('../gfx/overlay.js').Overlay} ov @param {string} kind @param {object} app
 */
export function drawPage(ov, kind, app) {
  const s = uiScale(ov), lh = CHAR_H + 2, w = Math.min(ov.w - 16, 76 * CHAR_W), x = Math.round((ov.w - w) / 2);
  const lines = kind === 'records' ? recordLines(app) : KEY_LINES;
  const h = lines.length * lh + 20, y = Math.max(CHAR_H * s + 20, Math.round((ov.h - h) / 2));
  centerText(ov, kind === 'records' ? 'RECORDS' : 'KEYS', y - CHAR_H * s - 10, UI.hi, s);
  drawPanel(ov, x, y, w, h);
  lines.forEach((l, i) => drawText(ov, l.slice(0, Math.floor((w - 16) / CHAR_W)), x + 8, y + 10 + i * lh, i === 0 ? UI.hi : UI.text, UI.shadow));
  centerText(ov, 'ENTER / ESC - BACK', ov.h - CHAR_H - 6, UI.dim);
}

function recordLines(app) {
  const pad = (t, n) => (t + ' '.repeat(n)).slice(0, n), carName = (id) => (CARS.find((c) => c.id === id) || { name: '?' }).name.toUpperCase();
  const out = [`${pad('TRACK', 18)}${pad('BEST LAP', 26)}BEST RACE`];
  for (const t of menuTracks()) {
    const r = app.save.records[t.id] || {};
    const lap = r.lap ? `${formatTime(r.lap.time)} ${carName(r.lap.car)}` : '-', race = r.race ? formatTime(r.race.time) : '-';
    out.push(`${pad(t.name.toUpperCase(), 18)}${pad(lap, 26)}${race}`);
  }
  const c = app.save.champ;
  out.push('', `CHAMPIONSHIP: ${c.seasons} SEASONS, ${c.titles} TITLES, BEST ${c.best ? `P${c.best}` : '-'}`);
  return out;
}

const KEY_LINES = [
  'ACTION        PLAYER 1        PLAYER 2      PAD',
  'THROTTLE      UP              W             RT',
  'BRAKE         DOWN            S             LT',
  'STEER         LEFT / RIGHT    A / D         STICK',
  'HANDBRAKE     SPACE           LEFT SHIFT    A',
  'GEAR UP/DOWN  . / ,           E / Q         RB / LB',
  'CAMERA        C               1             Y',
  'LOOK BACK     V               2             R3',
  'RADIO         R               -             SELECT',
  'PAUSE         ESC             ESC           START',
  '',
  'REPLAY: SPACE PAUSE, LEFT/RIGHT SEEK, DOWN SLOW, C CAMERA, F CAR',
  'TOUCH: ON-SCREEN BUTTONS OR TILT (OPTIONS / CONTROLS)',
];

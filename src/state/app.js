// Application flow: title (flyover + logo) -> menus (textured background) -> showroom / setup ->
// loading -> race session with a pause menu (continue, restart, options, quit) -> back to the menus.
// Presents the same scene interface as a race scene to main.js. Menus work with keyboard, gamepads,
// mouse and touch (MenuInput); options apply immediately and are saved.
import { CONFIG } from '../config.js';
import { TRACKS } from '../data/tracks/index.js';
import { SEASON } from '../data/championship.js';
import { CARS } from '../vehicle/cars.js';
import { DRIVERS, PLAYER_SLOT, PLAYER2_SLOT } from '../ai/opponent.js';
import { carAvailable, writeSave } from '../storage.js';
import { MenuInput } from '../engine/input.js';
import { createSession } from './session.js';
import { createTitle } from './title.js';
import { createShowroom, applyLivery } from './showroom.js';
import { createMusic } from './music.js';
import { resolveOptions, applyOptions } from './options.js';
import { mainMenu, pauseMenu, drawPage, menuTracks, TIMES, WEATHER } from './menu.js';
import { drawBackground, drawLogo, centerText, UI, uiScale } from './ui.js';
import { createEnv } from './env.js';
import { fillRect } from '../gfx/draw2d.js';

const MENU_TRACK = 1;
const STILL_CAMERA = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };

/**
 * @param {object} ctx renderer, pal, lib, layers, kb, mixer, save, pointer, touch, start (URL race options or null)
 */
export function createApp(ctx) {
  const { renderer, kb, save } = ctx;
  const music = createMusic(ctx.mixer), input = new MenuInput(kb, ctx.pointer);
  const options = resolveOptions(save.options);
  const bgTex = ctx.lib.find((t) => t.name === 'concrete').data;
  const menuView = { env: createEnv({ sky: false }), clearIndex: 1, colormap: null };
  const setup = { track: 0, car: 0, set: 0, car2: 3, set2: 1, time: 0, weather: 0, laps: 0, ai: 7 };
  let state = 'title', title = null, showroom = null, session = null, page = null, stack = [], t = 0, pending = null, pause = null, shown = false;

  const app = {
    setup, save, options,
    push(menu) { stack.push(menu); return 'push'; },
    page(kind) { page = kind; return 'page'; },
    applyOptions() {
      applyOptions(options, { renderer, mixer: ctx.mixer, lib: ctx.lib, pal: ctx.pal, resize });
      save.options = { ...options };
      writeSave(save);
    },
    // Car choice in the showroom: player 0/1; `mode` = setup to return to (null: browse from the main menu).
    showroom(player, mode) {
      const slot = player ? PLAYER2_SLOT : PLAYER_SLOT;
      showroom = createShowroom(ctx, {
        slot, car: player ? setup.car2 : setup.car, set: player ? setup.set2 : setup.set,
        title: mode ? `CHOOSE CAR - PLAYER ${player + 1}` : 'SHOWROOM',
        onPick: (car, set) => { if (player) { setup.car2 = car; setup.set2 = set; } else { setup.car = car; setup.set = set; } leaveShowroom(); },
        onBack: () => leaveShowroom(),
      });
      state = 'showroom';
      return 'showroom';
    },
    startRace(mode) { pending = mode; shown = false; state = 'loading'; return 'start'; },
    resume() { session.resume(); pause = null; stack = []; return 'resume'; },
    restart() { pause = null; stack = []; session.restart(); return 'restart'; },
    quit() { session.stop(); session = null; pause = null; toMenu(); return 'quit'; },
  };

  function resize(w, h) {
    renderer.resize(w, h);
    session?.relayout();
  }

  function leaveShowroom() {
    showroom = null;
    toMenu(false);
  }

  function toMenu(reset = true) {
    renderer.clearMeshes();
    if (reset) stack = [mainMenu(app)];
    state = 'menu';
  }

  // Liveries for the human slots before a race (slot 6 goes back to its rival when one player races).
  function liveries(split) {
    applyLivery(ctx, PLAYER_SLOT, { car: setup.car, set: setup.set, number: 1 });
    const d = DRIVERS[PLAYER2_SLOT];
    applyLivery(ctx, PLAYER2_SLOT, split ? { car: setup.car2, set: setup.set2, number: 9 } : { car: d.car, set: d.set, number: d.number });
  }

  function launch(mode) {
    const tracks = menuTracks(), available = (c) => CONFIG.debug || carAvailable(CARS[c].id, SEASON.locked, save);
    if (!available(setup.car)) setup.car = 0;
    if (!available(setup.car2)) setup.car2 = 0;
    liveries(mode === 'split');
    const def = tracks[setup.track % tracks.length];
    session = createSession({
      ...ctx, music, onExit: () => app.quit(),
      opts: {
        mode: mode === 'split' ? 'race' : mode, track: TRACKS.indexOf(def), car: setup.car, car2: setup.car2,
        players: mode === 'split' ? 2 : 1, time: setup.time ? TIMES[setup.time].toLowerCase() : null,
        weather: setup.weather ? WEATHER[setup.weather].toLowerCase() : null, zone: null,
        ai: mode === 'split' ? Math.min(6, setup.ai) : setup.ai, laps: setup.laps || undefined,
      },
    });
    state = 'race';
  }

  // Direct start from URL parameters (debug / tests), else the title screen.
  if (ctx.start) {
    Object.assign(setup, ctx.start.setup);
    launch(ctx.start.mode);
  } else {
    title = createTitle(renderer, ctx.layers, ctx.pal, TRACKS[MENU_TRACK]);
  }
  applyOptions(options, { renderer, mixer: ctx.mixer, lib: ctx.lib, pal: ctx.pal, resize });

  const current = () => (state === 'race' ? session : state === 'showroom' ? showroom : state === 'title' ? title : null);

  return {
    get view() { const c = current(); return c ? c.view : menuView; },
    get camera() { const c = current(); return c ? c.camera : STILL_CAMERA; },
    get items() { const c = current(); return c ? c.items : []; },
    get views() { return state === 'race' ? session.views : null; },
    /** Debug / test access: current screen, race scene and championship. */
    get state() { return state; },
    get scene() { return session ? session.scene : null; },
    get championship() { return session ? session.championship : null; },
    pause() { if (state === 'race') session.pause(); },
    /** @param {number} dt @param {import('../engine/input.js').Keyboard} keyboard */
    update(dt, keyboard) {
      t += dt;
      const nav = input.poll(dt), ov = { w: renderer.w, h: renderer.h };
      if (state !== 'race') music.want('menu');
      if (state === 'race') {
        if (!session.paused) { pause = null; session.update(dt, keyboard); }
        else if (page) { if (nav.ok || nav.back || nav.click) page = null; }
        else {
          if (!pause) { pause = pauseMenu(app); stack = [pause]; }
          const top = stack[stack.length - 1], r = top.handle(nav, ov);
          if (r === 'back') { if (stack.length > 1) stack.pop(); else app.resume(); }
        }
      } else if (state === 'title') {
        title.update(dt);
        if (nav.ok || nav.click || nav.back) { title = null; toMenu(); }
      } else if (state === 'showroom') {
        showroom.update(dt, nav, ov);
      } else if (state === 'loading') {
        // The LOADING frame is drawn first, then the track is built.
        if (pending && shown) { const m = pending; pending = null; launch(m); }
      } else if (page) {
        if (nav.ok || nav.back || nav.click) page = null;
      } else {
        const r = stack[stack.length - 1].handle(nav, ov);
        if (r === 'back') {
          if (stack.length > 1) stack.pop();
          else { title = createTitle(renderer, ctx.layers, ctx.pal, TRACKS[MENU_TRACK]); state = 'title'; }
        }
      }
      ctx.pointer?.endFrame();
      music.update();
    },
    prepare(env) { current()?.prepare(env); },
    renderExtra(r, clearIndex) { if (state === 'race' && !session.paused) session.renderExtra(r, clearIndex); },
    /** @param {import('../gfx/overlay.js').Overlay} ov */
    drawOverlay(ov) {
      if (state === 'title') { title.drawLogo(ov, true); return; }
      if (state === 'showroom') { showroom.drawOverlay(ov); return; }
      if (state === 'race') {
        session.drawOverlay(ov);
        if (session.paused && stack.length) {
          // Darken the race behind the pause menu with a binary checkerboard.
          for (let y = 0; y < ov.h; y++) for (let x = y & 1; x < ov.w; x += 2) if (!ov.data[y * ov.w + x]) ov.data[y * ov.w + x] = UI.shadow;
          if (page) drawPage(ov, page, app); else stack[stack.length - 1].draw(ov, t);
        }
        return;
      }
      drawBackground(ov, bgTex, t);
      if (state === 'loading') { centerText(ov, 'LOADING...', ov.h / 2 - 8, UI.hi, uiScale(ov)); shown = true; return; }
      if (page) { drawPage(ov, page, app); return; }
      if (stack.length === 1) drawLogo(ov, 6, t, uiScale(ov) * 2, false);
      stack[stack.length - 1].draw(ov, t);
      if (ctx.portrait && ctx.portrait()) { fillRect(ov, 0, ov.h / 2 - 20, ov.w, 40, UI.shadow); centerText(ov, 'ROTATE TO LANDSCAPE', ov.h / 2 - 8, UI.hi, 1); }
    },
    debugLine() {
      return state === 'race' ? session.debugLine() : `APP ${state}`;
    },
  };
}

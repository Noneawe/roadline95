// Entry point: loads the save and options, applies URL params, sets up WebGL2, palette, colormap,
// textures (with the liveries of the race grid), the game (title, menus, races) or a test scene and the
// debug keys (F1-F6), then runs the loop.
import { CONFIG } from './config.js';
import { createContext, watchContext, simulateContextLoss } from './gfx/gl.js';
import { buildPalette, nearestIndex } from './gfx/palette.js';
import { getColormap } from './gfx/colormap.js';
import { assignLayers, buildLayerData } from './gfx/textures.js';
import { Renderer } from './gfx/renderer.js';
import { Overlay } from './gfx/overlay.js';
import { generateLibrary } from './texgen/library.js';
import { Keyboard, Pointer } from './engine/input.js';
import { startLoop } from './engine/loop.js';
import { debugLog, drawDebugLines, drawColormapPreview } from './engine/debug.js';
import { createRenderScene } from './state/renderTest.js';
import { createTrackScene } from './state/trackTest.js';
import { createApp } from './state/app.js';
import { CARS } from './vehicle/cars.js';
import { gridLiveries } from './ai/opponent.js';
import { loadSave } from './storage.js';
import { resolveOptions, applyOptions } from './state/options.js';
import { menuTracks, TIMES, WEATHER } from './state/menu.js';
import { TouchControls, armMobile } from './state/touch.js';
import { Mixer } from './audio/mixer.js';
import { WEATHERS } from './game/weather.js';
import { createEnv } from './state/env.js';
import { generateSky } from './texgen/sky.js';
import { TRACKS } from './data/tracks/index.js';

const TEXT_FG = 175; // brightest cloud-ramp white
const TEXT_BG = 1;

function applyParams(p) {
  if (p.get('debug') === '1') CONFIG.debug = true;
  if (p.get('wire') === '1') CONFIG.render.wire = true;
  if (p.get('rawpal') === '1') CONFIG.render.rawpal = true;
  if (p.has('seed')) CONFIG.seed = Number.parseInt(p.get('seed'), 10) >>> 0;
  const pick = (key, count) => Math.max(0, Math.min(count - 1, Number(p.get(key)) || 0));
  const time = CONFIG.times[p.get('time')] ? p.get('time') : null;
  // Detail params override the saved options for this session.
  const overrides = {};
  if (p.get('detail') === 'low') overrides.resolution = 1;
  if (p.get('persp') === '1') overrides.perspective = 1;
  if (p.get('notex') === '1') overrides.textures = 1;
  // Any race parameter starts that race directly (debugging, tests); otherwise the title screen.
  const direct = ['mode', 'track', 'players', 'car', 'laps', 'ai', 'time', 'weather', 'zone'].some((k) => p.has(k));
  return {
    scene: p.get('scene') || 'game', direct, overrides, track: pick('track', TRACKS.length), car: pick('car', CARS.length),
    mode: ['race', 'champ', 'time'].includes(p.get('mode')) ? p.get('mode') : 'race', color: pick('color', 3),
    players: p.get('players') === '2' ? 2 : 1, car2: pick('car2', CARS.length), color2: pick('color2', 3),
    mute: p.get('mute') === '1', weather: WEATHERS.includes(p.get('weather')) ? p.get('weather') : null,
    time, zone: p.get('zone') || null,
    ai: p.has('ai') ? Math.max(0, Math.min(7, Number(p.get('ai')) || 0)) : 7,
    laps: p.has('laps') ? Math.max(1, Number(p.get('laps')) || 1) : undefined,
  };
}

function fail(msg) {
  const el = document.getElementById('err');
  el.textContent = msg;
  el.style.display = 'block';
}

// Direct race start from URL parameters (the menu setup fields).
function directStart(opts) {
  const setup = {
    track: Math.max(0, menuTracks().indexOf(TRACKS[opts.track])), car: opts.car, set: opts.color, car2: opts.car2, set2: opts.color2,
    time: opts.time ? TIMES.indexOf(opts.time.toUpperCase()) : 0, weather: opts.weather ? WEATHER.indexOf(opts.weather.toUpperCase()) : 0,
    laps: opts.laps || 0, ai: opts.ai,
  };
  return { mode: opts.players === 2 && opts.mode === 'race' ? 'split' : opts.mode, setup };
}

function boot() {
  const opts = applyParams(new URLSearchParams(location.search));
  const canvas = document.getElementById('screen');
  const gl = createContext(canvas);
  if (!gl) { fail("ROADLINE '95 requires a browser with WebGL2."); return; }
  const t0 = performance.now();
  const save = loadSave(), options = Object.assign(resolveOptions(save.options), opts.overrides);
  save.options = options;
  applyOptions(options);
  const res = CONFIG.render[CONFIG.render.detail];
  const pal = buildPalette();
  const time = 'day', tod = CONFIG.times[time];
  const cm = getColormap(`${time}-clear`, pal, tod.fog, CONFIG.colormap.lightOne);
  const lib = generateLibrary(CONFIG.seed, gridLiveries(opts.car, opts.color, opts.players === 2 ? opts.car2 : null, opts.color2));
  const layers = assignLayers(lib);
  const renderer = new Renderer(gl, res.w, res.h);
  renderer.wire = CONFIG.render.wire;
  renderer.rawpal = CONFIG.render.rawpal;
  renderer.timing = CONFIG.debug;
  renderer.notex = CONFIG.render.notex;
  renderer.setPalette(pal);
  renderer.setColormap(cm);
  renderer.setTextures(buildLayerData(lib, pal, CONFIG.render.notex), lib.length * 2);
  const clearIndex = nearestIndex(pal, ...tod.fog);
  const kb = new Keyboard(window);
  let scene;
  if (opts.scene === 'render') {
    scene = createRenderScene(renderer, layers);
    scene.setView('start');
  } else if (opts.scene === 'track') {
    renderer.setSky(generateSky(tod.sky, CONFIG.seed, clearIndex));
    scene = createTrackScene(renderer, layers, TRACKS[opts.track], opts.zone);
  } else {
    // Sound starts on the first key/touch (browser autoplay rules). The sample bank (~0.4 s of CPU) is
    // generated shortly after start, so it does not delay the first frame.
    const mixer = new Mixer({ muted: opts.mute, seed: CONFIG.seed });
    setTimeout(() => mixer.prepare(), 300);
    mixer.armOnGesture(window, () => debugLog('audio on'));
    document.addEventListener('visibilitychange', () => { if (document.hidden) mixer.setPaused(true); });
    const pointer = new Pointer(canvas, () => renderer);
    const touch = new TouchControls(pointer, window);
    armMobile(canvas, () => CONFIG.input.tilt);
    scene = createApp({
      renderer, pal, lib, layers, kb, mixer, save, pointer, touch, start: opts.direct ? directStart(opts) : null,
      portrait: () => pointer.touched && window.innerHeight > window.innerWidth,
    });
  }
  debugLog(`startup ${(performance.now() - t0).toFixed(0)} ms`);
  // Debug hook for test pages (scripted sessions); absent in normal play.
  if (CONFIG.debug) window.roadline = { scene, renderer };

  let overlay = new Overlay(res.w, res.h);
  const env = createEnv({ sky: opts.scene !== 'render', time: opts.scene === 'render' ? null : time });
  let clock = 0;
  // ?info=0 keeps the debug hooks but hides the overlay at start (screenshots).
  const ui = { debug: CONFIG.debug && new URLSearchParams(location.search).get('info') !== '0', preview: false, dump: false, lost: false, frames: 0, fpsTime: 0, fps: 0, cpuMs: 0, lines: [] };

  // Switching tabs pauses the race (the loop also stops while hidden).
  document.addEventListener('visibilitychange', () => { if (document.hidden && scene.pause) scene.pause(); });

  watchContext(canvas, () => { ui.lost = true; debugLog('context lost'); }, () => {
    try {
      renderer.init();
      ui.lost = false;
      debugLog('context restored');
    } catch (e) { fail(e.message); }
  });

  const update = (dt) => {
    if (kb.hit('F1')) ui.debug = !ui.debug;
    if (kb.hit('F2')) renderer.wire = !renderer.wire;
    if (kb.hit('F3')) renderer.perspective = !renderer.perspective;
    if (kb.hit('F4') && !ui.lost) simulateContextLoss(gl);
    if (kb.hit('F5')) ui.preview = !ui.preview;
    if (kb.hit('F6')) ui.dump = true;
    renderer.timing = ui.debug;
    scene.update(dt, kb);
    kb.endFrame();
  };

  const render = (alpha, frameSec) => {
    if (ui.lost) return;
    const t = performance.now();
    resizeCanvas(canvas);
    clock += frameSec;
    env.time = clock;
    const view = scene.view || { env, clearIndex, colormap: cm };
    view.env.time = clock;
    scene.prepare(view.env);
    renderer.beginFrame();
    // Split screen: one pass per viewport (own camera, culling and reduced-detail environment).
    const views = scene.views;
    if (views) for (const v of views) renderer.renderWorld(v.camera, scene.items, view.clearIndex, v.env, v.vp);
    else renderer.renderWorld(scene.camera, scene.items, view.clearIndex, view.env);
    if (scene.renderExtra) scene.renderExtra(renderer, view.clearIndex);
    if (ui.dump) { ui.dump = false; downloadIndexBuffer(renderer); }
    // Resolution option: the overlay follows the index buffer size.
    if (overlay.w !== renderer.w || overlay.h !== renderer.h) overlay = new Overlay(renderer.w, renderer.h);
    overlay.clear();
    if (scene.drawOverlay) scene.drawOverlay(overlay);
    if (ui.preview && view.colormap) drawColormapPreview(overlay, view.colormap);
    if (ui.debug) drawDebugLines(overlay, debugText(ui, renderer, scene, frameSec), TEXT_FG, TEXT_BG);
    renderer.present(overlay, canvas.width, canvas.height);
    ui.cpuMs = performance.now() - t;
  };

  startLoop(update, render, CONFIG.loop.step, CONFIG.loop.maxFrame);
}

// Refreshes the text 4x per second so the overlay does not allocate strings every frame.
function debugText(ui, renderer, scene, frameSec) {
  ui.frames++;
  ui.fpsTime += frameSec;
  if (ui.fpsTime < 0.25 && ui.lines.length) return ui.lines;
  ui.fps = ui.frames / ui.fpsTime;
  ui.frames = 0;
  ui.fpsTime = 0;
  const c = scene.camera, s = renderer.stats;
  ui.lines = [
    `FPS ${ui.fps.toFixed(0)}  CPU ${ui.cpuMs.toFixed(2)}ms  GPU ${s.gpuMs.toFixed(2)}ms`,
    `TRIS ${s.tris}  DRAWS ${s.draws}  ${renderer.w}x${renderer.h}`,
    `UV ${renderer.perspective ? 'PERSPECTIVE' : 'AFFINE'}${renderer.wire ? '  WIRE' : ''}`,
    `POS ${c.pos.map((v) => v.toFixed(1)).join(' ')}  YAW ${c.yaw.toFixed(2)}`,
  ];
  if (scene.debugLine) ui.lines.push(scene.debugLine());
  return ui.lines;
}

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

// F6: raw index buffer (rows bottom-up, same format as tools/golden/*.bin).
function downloadIndexBuffer(renderer) {
  const data = renderer.readIndexBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  a.download = `index-${renderer.w}x${renderer.h}.bin`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

try {
  boot();
} catch (e) {
  fail(`${e.message}\n\n${e.stack || ''}`);
}

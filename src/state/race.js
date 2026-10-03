// Race scene: one or two human players (split screen: two horizontal viewports in one index buffer,
// own cameras, HUD and overlays, reduced detail) and up to 7 AI rivals (each in its own car and livery),
// start lights, laps or a sprint, positions, collisions, damage, resets, pause (Esc, both players),
// cockpit/external cameras, track map, results and the TV replay. Time trial: no rivals, endless laps
// (one run on a sprint) and a screen-door ghost of the best lap. F7 (debug) toggles the free camera.
import { CONFIG } from '../config.js';
import { buildRacingLine } from '../world/racingline.js';
import { SLOT } from '../world/ground.js';
import { arcadeLatBoost } from '../vehicle/physics.js';
import { DRIVERS, PLAYER_SLOT } from '../ai/opponent.js';
import { RaceSim } from '../game/raceSim.js';
import { CARS } from '../vehicle/cars.js';
import { carPoint } from '../vehicle/pose.js';
import { safeSpeed, applyAutoBrake } from '../vehicle/assists.js';
import { PlayerInput } from '../engine/input.js';
import { CarCameras } from '../camera/carCams.js';
import { moveFreeCamera } from '../camera/free.js';
import { buildDashboard } from '../cockpit/dashboard.js';
import { drawCockpit, drawHud } from '../cockpit/cockpit.js';
import { buildTrackMap, drawRaceHud, drawResults, drawNotice } from '../cockpit/raceHud.js';
import { Overlay } from '../gfx/overlay.js';
import { fillRect } from '../gfx/draw2d.js';
import { createEnv } from './env.js';
import { weatherConditions } from '../game/weather.js';
import { buildTrackWorld } from './trackTest.js';
import { loadCarModels, CarVisual, SprayEmitter } from './raceCar.js';
import { RainFx } from '../cockpit/rain.js';
import { Replay } from '../game/replay.js';
import { ReplayView } from './replay.js';
import { buildTvCameras } from '../camera/tv.js';
import { RaceAudio } from './raceAudio.js';

const REPLAY_MAX = 60 * 60 * 30;
const DIVIDER = 1; // darkest asphalt index

/**
 * @param {import('../gfx/renderer.js').Renderer} renderer
 * @param {Map<string, number>} layers @param {import('../texgen/library.js').Texture[]} lib
 * @param {object} trackDef @param {number} carIndex
 * @param {import('../engine/input.js').Keyboard} kb
 * @param {{ zone?: string, time?: string, weather?: string, ai?: number, laps?: number,
 *   ghost?: import('../game/ghost.js').Ghost, notice?: string, mixer?: import('../audio/mixer.js').Mixer,
 *   onRadio?: () => string, split?: boolean, car2?: number, touch?: import('./touch.js').TouchControls }} [opts]
 *   ai: rivals (default 7, 6 with two players); ghost: time trial; mixer: race sound; onRadio: next song;
 *   split: second player (car2) on a split screen; touch: on-screen controls for player 1
 */
export function createRaceScene(renderer, layers, lib, trackDef, carIndex, kb, opts = {}) {
  const wc = weatherConditions(opts.time || 'day', opts.weather || 'clear');
  const world = buildTrackWorld(renderer, layers, trackDef, opts.zone, wc.wet >= 0.5);
  const { track, probe } = world;
  const layerOf = (t) => layers.get(t);
  const spec = CARS[Math.min(carIndex, CARS.length - 1)];
  const line = buildRacingLine(track, { ...CONFIG.ai.line, latBoost: arcadeLatBoost });
  const ghost = opts.ghost || null, split = !!opts.split && !ghost;
  const sim = new RaceSim({
    track, probe, colliders: world.colliders, line, spec, ai: ghost ? 0 : opts.ai ?? DRIVERS.length,
    laps: ghost ? 999 : opts.laps ?? trackDef.laps, seed: CONFIG.seed, wet: wc.wet,
    spec2: split ? CARS[Math.min(opts.car2 ?? 0, CARS.length - 1)] : undefined,
  });
  const { cars, race } = sim, nAi = sim.playerIndex;
  // Car models are shared by every car of the same spec; LOD0/1 copies per car carry the dents.
  const models = new Map();
  for (const c of cars) {
    if (!models.has(c.spec.id)) models.set(c.spec.id, loadCarModels(renderer, c.spec, layerOf));
    c.visual = new CarVisual(renderer, models.get(c.spec.id), c.variant);
  }
  // Time-trial ghost: a car-like pose source fed from the best lap.
  const ghostCar = ghost ? { x: 0, y: 0, z: 0, heading: 0, groundNormal: [0, 1, 0], ayLocal: 0, latBoost: 1, axLocal: 0, spec } : null;
  const ghostVisual = ghost ? new CarVisual(renderer, models.get(spec.id), PLAYER_SLOT, true) : null;
  let lapsSeen = 0, recording = false;
  const audio = opts.mixer ? new RaceAudio(opts.mixer, sim, world.crowd, opts.onRadio, wc.rain, split) : null;
  const carItems = [...cars.flatMap((c) => c.visual.items), ...(ghostVisual ? ghostVisual.items : [])];
  const spray = wc.rain > 0 ? new SprayEmitter(renderer, layerOf('spray'), cars.length) : null;
  const items = [...world.items, ...carItems, ...(spray ? [spray.item] : [])], mirrorItems = [...world.basic, ...carItems];
  // Replay: every car recorded each step until the race is over; TV cameras placed along the track.
  const replay = new Replay(cars.length), tvCams = buildTvCameras(track, probe, world.colliders, CONFIG.tv);
  let replayView = null;

  // One seat per human player: input, cameras, controls, viewport, environment, HUD overlay, rain.
  const seats = sim.players.map((pc, k) => makeSeat(k, pc));
  const P1 = seats[0], player = P1.pc, camera = P1.camera;
  if (opts.touch) P1.input.touch = opts.touch;
  const views = split ? seats.map((s) => ({ camera: s.camera, env: s.env, vp: null })) : null;
  let dash = null, map = null, mirrorVp = null, units = '';
  const dashTex = lib.find((t) => t.name === 'dashboard').data;
  layout();
  const mirrorEnv = { ...createEnv({ sky: true, time: opts.time, weather: opts.weather }), fovY: CONFIG.cockpit.mirrorFov, far: CONFIG.cockpit.mirrorFar };
  const mirrorCam = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };
  const lamp = [0, 0, 0], where = {};
  let free = false, paused = false, flash = 0, msg = '', msgTime = 0;
  const near = new Float64Array(cars.length), order = cars.map((_, k) => k), byNear = (a, b) => near[a] - near[b];

  // Size-dependent parts (resolution option): dashboard, map, viewports, HUD overlays, rain.
  function layout() {
    const h = split ? renderer.h / 2 : renderer.h;
    units = CONFIG.units;
    dash = buildDashboard(renderer.w, renderer.h, dashTex, spec, units);
    map = buildTrackMap(track, renderer.w >= 640 ? (split ? 60 : 84) : split ? 36 : 48);
    const m = dash.layout.mirror;
    mirrorVp = { x: m.x, y: renderer.h - m.y - m.h, w: m.w, h: m.h, mirror: true };
    for (const s of seats) {
      // Player 1 on top (GL viewport origin is bottom-left).
      s.vp = split ? { x: 0, y: s.k ? 0 : renderer.h - h, w: renderer.w, h } : null;
      s.ov = split ? new Overlay(renderer.w, h) : null;
      s.rain = wc.rain > 0 ? new RainFx(renderer.w, h, CONFIG.rain, CONFIG.seed + s.k) : null;
      if (views) views[s.k].vp = s.vp;
    }
  }

  function makeSeat(k, pc) {
    const S = CONFIG.split;
    const first = { throttle: 0, brake: 0, steer: 0, analog: false, handbrake: false, gearUp: false, gearDown: false };
    const seat = {
      k, pc, entry: race.entries[nAi + k], cams: new CarCameras(pc.spec, probe),
      input: new PlayerInput(kb, k, !split, CONFIG.input.deadzone), camera: { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 },
      first, rest: { ...first }, lookBack: false, rain: null, vp: null, ov: null,
      env: split ? { ...createEnv({ sky: true, time: opts.time, weather: opts.weather }), fovY: S.fovY, far: S.far, detailFar: S.detailFar, lodScale: S.lodScale } : null,
    };
    if (split) { seat.cams.allowInside = false; seat.cams.mode = 2; }
    return seat;
  }

  const inside = (s) => s.cams.inside && !s.lookBack;
  const rainLevel = (s) => (s.pc.info.tunnel ? 0 : wc.rain);

  function playerControls(s, a) {
    const { first, rest } = s, car = s.pc.car;
    first.throttle = rest.throttle = a.throttle;
    first.brake = rest.brake = a.brake;
    first.steer = rest.steer = a.steer;
    first.analog = rest.analog = a.analog;
    first.handbrake = rest.handbrake = a.handbrake;
    first.gearUp = a.gearUp;
    first.gearDown = a.gearDown;
    if (CONFIG.vehicle.autoBrake && car.dt.gear > 0) {
      probe.sample(car.x, car.z, where, SLOT.ASSIST);
      applyAutoBrake(first, car.speed, safeSpeed(track, where.s, CONFIG.vehicle.autoBrakeGrip));
      rest.throttle = first.throttle;
      rest.brake = first.brake;
    }
  }

  // Headlight cones of the cars nearest to a camera (2 per car, up to MAX_LIGHTS).
  function headlights(env, cam) {
    const H = CONFIG.headlights, max = env.hlPos.length / 8;
    let n = 0;
    flash++;
    for (let pass = 0; pass < cars.length && n < max * 2; pass++) {
      let best = null, bd = Infinity;
      for (const c of cars) {
        if (c.lit === flash) continue;
        const o = c.visual.pose.origin, d = (o[0] - cam.pos[0]) ** 2 + (o[2] - cam.pos[2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) break;
      best.lit = flash;
      const p = best.visual.pose, b = best.spec.body, zf = -(b.length - b.rearOverhang);
      for (let side = -1; side <= 1; side += 2) {
        carPoint(p, side * b.width * 0.32, H.height, zf, lamp);
        env.hlPos[n * 4] = lamp[0]; env.hlPos[n * 4 + 1] = lamp[1]; env.hlPos[n * 4 + 2] = lamp[2]; env.hlPos[n * 4 + 3] = H.range;
        env.hlDir[n * 4] = p.f[0]; env.hlDir[n * 4 + 1] = p.f[1] - 0.06; env.hlDir[n * 4 + 2] = p.f[2];
        n++;
      }
    }
    env.hlCount = n;
  }

  // Ghost recording: from the start-line crossing, one pose per fixed step; each completed lap may
  // become the new best (the sprint run counts as one lap).
  function recordGhost() {
    const e = race.entries[nAi];
    if (!e.started || e.finished && lapsSeen === e.lapTimes.length) return;
    if (!recording) { recording = true; ghost.restart(); }
    if (e.lapTimes.length !== lapsSeen) {
      lapsSeen = e.lapTimes.length;
      ghost.lapDone(e.lapTimes[lapsSeen - 1]);
      if (e.finished) return;
    }
    ghost.record(player.car);
  }

  // Car visuals: LOD from the nearest camera; a player's own car is hidden in its cockpit view. Only the
  // CONFIG.render.detailCars nearest cars get full detail (detail option), the rest their far LOD.
  function placeCars() {
    const P = P1.camera.pos;
    for (let k = 0; k < cars.length; k++) near[k] = (cars[k].car.x - P[0]) ** 2 + (cars[k].car.z - P[2]) ** 2;
    order.sort(byNear);
    for (let r = 0; r < order.length; r++) cars[order[r]].farOnly = r >= CONFIG.render.detailCars;
    for (const c of cars) {
      let eye = P1.camera.pos;
      if (split) {
        const q = seats[1].camera.pos, p = P1.camera.pos;
        if ((q[0] - c.car.x) ** 2 + (q[2] - c.car.z) ** 2 < (p[0] - c.car.x) ** 2 + (p[2] - c.car.z) ** 2) eye = q;
      }
      const ghostBlink = c.ghost > 0 && Math.floor(c.ghost * 10) % 2 === 0;
      const own = c.isPlayer && !free && inside(seats[c.playerNo]);
      c.visual.update(c.car, c.damage, eye, !ghostBlink && !own, c.farOnly);
    }
  }

  // Split screen: each player's HUD is drawn into its own half-height overlay, then copied in place.
  function drawSplit(ov) {
    for (const s of seats) {
      const o = s.ov;
      o.clear();
      s.rain?.draw(o, false, rainLevel(s));
      drawHud(o, s.pc.car, s.k === 0 && opts.touch?.active ? Math.round(o.h * 0.47) : 0);
      drawRaceHud(o, race, s.entry, map, cars, false, opts.notice);
      if (s.k === 0) opts.touch?.draw(o);
      ov.data.set(o.data, s.k * o.w * o.h);
    }
    fillRect(ov, 0, ov.h / 2 - 1, ov.w, 2, DIVIDER);
  }

  return {
    track, race, cars, line, sim, camera, items, cams: P1.cams, ghost, audio, replay, seats,
    get car() { return player.car; },
    /** Split screen: one view per player ({ camera, env, vp }); null for a single full-screen view. */
    get views() { return replayView ? null : views; },
    /** True while the replay is playing. */
    get inReplay() { return !!replayView; },
    /** True once the race is over (results on screen). */
    get finished() { return race.phase === 'finished' || (!!ghost && race.entries[nAi].finished); },
    get paused() { return paused; },
    pause() { paused = true; opts.mixer?.setPaused(true); },
    resume() { paused = false; opts.mixer?.setPaused(false); },
    /** Short centred message (records). @param {string} text */
    message(text) { msg = text; msgTime = 3; },
    /** Rebuilds the size-dependent parts after a resolution change. */
    relayout() { layout(); },
    /** Silences this race's voices (scene change). */
    stopAudio() { audio?.stop(); },
    /** @param {number} dt @param {import('../engine/input.js').Keyboard} keyboard */
    update(dt, keyboard) {
      if (replayView) {
        if (!replayView.update(dt, keyboard)) replayView = null;
        else audio?.updateReplay(replayView.views, camera, replayView.speed);
        P1.rain?.update(dt, 0, false, rainLevel(P1));
        return;
      }
      if (this.finished && keyboard.hit('Space') && replay.frames > 60) {
        replayView = new ReplayView({ replay, cars, focus: nAi, track, probe, tvCams });
        return;
      }
      if (paused) return;
      if (CONFIG.debug && keyboard.hit('F7')) free = !free;
      opts.touch?.update(renderer.w, split ? renderer.h / 2 : renderer.h);
      let pause = false, radio = false;
      for (const s of seats) { s.a = s.input.poll(); pause ||= s.a.pause; radio ||= s.a.radio; }
      // Esc / Start pauses both players; the pause menu (app) resumes.
      if (pause) { this.pause(); return; }
      msgTime = Math.max(0, msgTime - dt);
      if (units !== CONFIG.units) layout();
      for (const p of sim.players) p.car.autoGear = CONFIG.vehicle.autoGearbox;
      if (radio) audio?.radio();
      for (const s of seats) {
        if (free && s.k === 0) { camera.roll = 0; moveFreeCamera(camera, dt, keyboard); continue; }
        if (s.a.camera) s.cams.next();
        s.lookBack = s.a.lookBack;
        playerControls(s, s.a);
      }
      const P2 = seats[1];
      sim.step(dt, P1.first, P1.rest, P2 ? P2.first : P1.first, P2 ? P2.rest : P1.rest);
      if (!this.finished && replay.frames < REPLAY_MAX) replay.record(cars);
      if (ghost) recordGhost();
      for (const s of seats) {
        s.cams.update(dt, s.pc.car);
        s.rain?.update(dt, s.pc.car.speed, inside(s), rainLevel(s));
      }
      audio?.update(dt, camera);
    },
    /** @param {import('../gfx/renderer.js').Env} [env] receives the headlight cones */
    prepare(env) {
      if (replayView) {
        replayView.prepare(camera, env);
        if (ghostVisual) ghostVisual.update(ghostCar, null, camera.pos, false);
        spray?.update(replayView.views, camera.pos, wc.rain, CONFIG.rain.sprayFrom);
        if (env) headlights(env, camera);
        return;
      }
      if (env) env.fovY = CONFIG.render.fovY;
      placeCars();
      if (ghostVisual) {
        const on = recording && !race.entries[nAi].finished && ghost.sample(ghost.n - 1, ghostCar);
        ghostVisual.update(ghostCar, null, camera.pos, on);
      }
      for (const s of seats) if (!(free && s.k === 0)) s.cams.apply(s.camera, s.pc.visual.pose, s.pc.car, s.lookBack);
      spray?.update(cars, camera.pos, wc.rain, CONFIG.rain.sprayFrom);
      if (!env) return;
      if (split) {
        for (const s of seats) { s.env.time = env.time; headlights(s.env, s.camera); }
      } else {
        headlights(env, camera);
        mirrorEnv.hlCount = env.hlCount; mirrorEnv.hlPos.set(env.hlPos); mirrorEnv.hlDir.set(env.hlDir); mirrorEnv.time = env.time;
      }
    },
    /** Extra passes after the main view: the rear-view mirror in the cockpit (single player). */
    renderExtra(r, clearIndex) {
      if (replayView || split || free || !inside(P1) || !CONFIG.cockpit.mirror) return;
      mirrorCam.pos[0] = camera.pos[0]; mirrorCam.pos[1] = camera.pos[1]; mirrorCam.pos[2] = camera.pos[2];
      mirrorCam.yaw = camera.yaw + Math.PI;
      mirrorCam.pitch = -0.04;
      mirrorCam.roll = -camera.roll;
      r.renderWorld(mirrorCam, mirrorItems, clearIndex, mirrorEnv, mirrorVp);
    },
    /** @param {import('../gfx/overlay.js').Overlay} ov */
    drawOverlay(ov) {
      if (free) return;
      if (replayView) {
        P1.rain?.draw(ov, false, rainLevel(P1));
        replayView.drawOverlay(ov);
        return;
      }
      if (split) drawSplit(ov);
      else {
        // Rain first: the dashboard bitmap covers it below the windscreen.
        P1.rain?.draw(ov, inside(P1), rainLevel(P1));
        if (inside(P1)) drawCockpit(ov, dash, player.car);
        else drawHud(ov, player.car, opts.touch?.active ? Math.round(ov.h * 0.47) : 0);
        drawRaceHud(ov, race, P1.entry, map, cars, ghost, opts.notice);
        opts.touch?.draw(ov);
      }
      if (msgTime > 0) drawNotice(ov, msg, ov.h * 0.32);
      if (this.finished) drawResults(ov, race, ghost);
      if (audio && audio.labelTime > 0) drawNotice(ov, audio.label, ov.h * 0.24);

    },
    debugLine() {
      const e = race.entries[nAi];
      return `CAM ${P1.cams.name} ${race.phase} LAP ${e.lap} CP ${e.next}/${race.K} POS ${e.position} DMG ${player.damage.total.toFixed(2)}${free ? ' FREE' : ''}${split ? ' SPLIT' : ''}`;
    },
  };
}

/** Practice / test scene: the race scene without rivals (stage 3 behaviour). */
export function createDriveScene(renderer, layers, lib, trackDef, carIndex, kb, opts = {}) {
  return createRaceScene(renderer, layers, lib, trackDef, carIndex, kb, { ai: 0, ...opts });
}

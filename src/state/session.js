// Game session: runs one mode over race scenes and owns the per-track render setup (colormap, sky,
// environment). Modes: 'race' (single race, 1 or 2 players), 'champ' (season of data/championship.js,
// standings between rounds, car unlock for the title) and 'time' (time trial against the ghost of the
// best lap). Saves lap/race records and the season history; restart and quit come from the pause menu.
import { TRACKS } from '../data/tracks/index.js';
import { SEASON } from '../data/championship.js';
import { Championship } from '../game/championship.js';
import { Ghost } from '../game/ghost.js';
import { offerRecord, recordSeason } from '../game/records.js';
import { CARS } from '../vehicle/cars.js';
import { writeSave } from '../storage.js';
import { drawStandings } from '../cockpit/raceHud.js';
import { createRaceScene } from './race.js';
import { setupView } from './env.js';

const GHOST_STEPS = 60 * 60 * 10;

/**
 * @param {object} o
 * @param {import('../gfx/renderer.js').Renderer} o.renderer @param {Uint8Array} o.pal palette
 * @param {Map<string, number>} o.layers @param {object[]} o.lib @param {import('../engine/input.js').Keyboard} o.kb
 * @param {{ mode: string, track: number, car: number, car2?: number, players?: number, time: string | null,
 *   weather?: string | null, zone: string | null, ai: number, laps?: number, notice?: string }} o.opts
 * @param {import('../storage.js').Save} o.save @param {import('../audio/mixer.js').Mixer} [o.mixer]
 * @param {ReturnType<import('./music.js').createMusic>} o.music
 * @param {import('./touch.js').TouchControls} [o.touch] @param {() => void} o.onExit back to the menu
 */
export function createSession(o) {
  const { renderer, pal, layers, lib, kb, opts, save, mixer, music } = o;
  const mode = opts.mode, ghost = mode === 'time' ? new Ghost(GHOST_STEPS) : null;
  let scene = null, standings = null, champ = null, notice = opts.notice || '', current = null, scored = false;
  const view = { env: null, clearIndex: 1, colormap: null };
  const laps = [0, 0];

  // Builds a race scene on a track with its time of day and weather (colormap, sky, fog per race).
  function start(def, lapCount, roundWeather) {
    current = { def, lapCount, roundWeather };
    const time = opts.time || (def.timeOfDay || ['day'])[0], weather = opts.weather || roundWeather || 'clear';
    if (scene) scene.stopAudio();
    renderer.clearMeshes();
    Object.assign(view, setupView(renderer, pal, time, weather));
    scene = createRaceScene(renderer, layers, lib, def, opts.car, kb, {
      zone: opts.zone, time, weather, ai: opts.ai, laps: lapCount, ghost, notice, mixer, onRadio: music.radio,
      split: opts.players === 2, car2: opts.car2, touch: o.touch,
    });
    notice = '';
    standings = null;
    scored = false;
    laps[0] = laps[1] = 0;
  }

  const roundDef = (r) => TRACKS.find((t) => t.id === r.track);
  function startSeason() {
    champ = null;
    const r = SEASON.rounds[0];
    start(roundDef(r), r.laps, r.weather);
    champ = new Championship(SEASON, scene.race.entries.map((e) => ({ id: e.id, name: e.name, isPlayer: e.isPlayer })));
  }

  // New lap and race records of the human players (laps as they happen, the race at the finish).
  function records() {
    const race = scene.race, id = current.def.id;
    let broke = '';
    for (let k = 0; k < scene.sim.players.length; k++) {
      const p = scene.sim.players[k], e = race.entries[scene.sim.playerIndex + k], name = e.name;
      if (e.lapTimes.length > laps[k]) {
        laps[k] = e.lapTimes.length;
        if (offerRecord(save, id, { lap: e.lapTimes[laps[k] - 1], car: p.spec.id, name }).lap) broke = 'NEW LAP RECORD!';
      }
      const fullRace = race.sprint || current.lapCount === current.def.laps || current.lapCount === undefined;
      if (e.finished && !scored && !ghost && fullRace && offerRecord(save, id, { race: e.finishTime, car: p.spec.id, name }).race) broke = 'NEW TRACK RECORD!';
    }
    if (scene.finished) scored = true;
    if (broke) { scene.message(broke); writeSave(save); }
  }

  // Scores the finished round and prepares the standings screen.
  function endRound() {
    champ.addResult(scene.race.results().map((e) => e.id));
    const rows = champ.standings(), done = champ.finished, footer = [];
    if (done) {
      const won = champ.champion().isPlayer, car = CARS.find((c) => c.id === SEASON.unlock);
      recordSeason(save, rows.findIndex((r) => r.isPlayer) + 1);
      footer.push(won ? 'YOU ARE THE CHAMPION!' : `CHAMPION: ${champ.champion().name}`);
      if (won && !save.unlocked.includes(SEASON.unlock)) {
        save.unlocked.push(SEASON.unlock);
        footer.push(`NEW CAR UNLOCKED: ${car.name.toUpperCase()}`);
      }
      writeSave(save);
      footer.push('ENTER - MAIN MENU');
    } else {
      footer.push(`NEXT: ${roundDef(champ.current).name.toUpperCase()}`, 'ENTER - NEXT ROUND');
    }
    standings = { title: `${SEASON.name} ${done ? 'FINAL' : `ROUND ${champ.round}/${SEASON.rounds.length}`}`, rows, footer };
  }

  // Enter after the results: next round (championship), new run (time trial) or back to the menu.
  function next() {
    if (mode === 'champ') {
      if (!standings) { endRound(); return; }
      if (champ.finished) o.onExit();
      else { const r = champ.current; start(roundDef(r), r.laps, r.weather); }
    } else if (mode === 'time') start(current.def, current.lapCount, current.roundWeather);
    else o.onExit();
  }

  if (mode === 'champ') startSeason();
  else start(TRACKS[opts.track], opts.laps);

  return {
    view,
    get camera() { return scene.camera; },
    get items() { return scene.items; },
    get views() { return standings ? null : scene.views; },
    get scene() { return scene; },
    get championship() { return champ; },
    /** True while the race waits in the pause menu. */
    get paused() { return !standings && scene.paused; },
    pause() { scene.pause(); },
    resume() { scene.resume(); },
    /** Restarts the current race (championship: the current round). */
    restart() { start(current.def, current.lapCount, current.roundWeather); },
    stop() { scene.stopAudio(); },
    /** Re-lays out viewports and HUD after a resolution change. */
    relayout() { scene.relayout(); },
    /** @param {number} dt @param {import('../engine/input.js').Keyboard} keyboard */
    update(dt, keyboard) {
      music.want(standings ? 'menu' : scene.finished ? 'results' : 'race');
      if (standings) {
        if (keyboard.hit('Enter')) next();
        return;
      }
      // Enter leaving a replay must not also skip the results.
      const wasReplay = scene.inReplay;
      scene.update(dt, keyboard);
      if (!scene.paused) records();
      if (!wasReplay && !scene.inReplay && scene.finished && keyboard.hit('Enter')) next();
    },
    prepare(env) { scene.prepare(env); },
    renderExtra(r, clearIndex) { scene.renderExtra(r, clearIndex); },
    /** @param {import('../gfx/overlay.js').Overlay} ov */
    drawOverlay(ov) {
      if (standings) drawStandings(ov, standings.title, standings.rows, standings.footer);
      else scene.drawOverlay(ov);
    },
    debugLine() {
      return `${mode.toUpperCase()} ${scene.track.def.id} ${scene.debugLine()}`;
    },
  };
}

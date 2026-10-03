// Replay playback after a race: decodes the recording into the race's car visuals (dents included),
// films them with TV cameras (auto cuts, zoom, helicopter), chase or helicopter view, and draws the
// REPLAY banner. Keys: Space pause, Left/Right hold rewind / fast forward, Down slow motion,
// C camera, F followed car, Enter / Esc exit.
import { CONFIG } from '../config.js';
import { SLOT } from '../world/ground.js';
import { replayCars } from '../game/replay.js';
import { TvDirector } from '../camera/tv.js';
import { CarCameras } from '../camera/carCams.js';
import { RAMP } from '../gfx/palette.js';
import { drawText, drawTime, CHAR_W } from '../gfx/font.js';
import { fillRect } from '../gfx/draw2d.js';

const MODES = ['TV', 'CHASE', 'HELI'];
const RED = RAMP.PAINT1 * 16 + 10, WHITE = RAMP.CLOUD * 16 + 15, DIM = RAMP.CLOUD * 16 + 10, BACK = RAMP.ASPHALT * 16 + 1;

export class ReplayView {
  /**
   * @param {object} o
   * @param {import('../game/replay.js').Replay} o.replay @param {{ spec: object, visual: object, name: string }[]} o.cars
   * @param {number} o.focus index of the followed car @param {import('../world/track.js').Track} o.track
   * @param {import('../world/ground.js').GroundProbe} o.probe @param {import('../camera/tv.js').TvCamera[]} o.tvCams
   */
  constructor(o) {
    this.replay = o.replay;
    this.cars = o.cars;
    this.focus = o.focus;
    this.probe = o.probe;
    this.step = CONFIG.loop.step;
    this.objs = replayCars(o.cars.map((c) => c.spec));
    // Car-like views for audio and spray (same shape as race cars).
    this.views = o.cars.map((c, k) => ({ car: this.objs[k], spec: c.spec, visual: c.visual, audioLoop: c.audioLoop }));
    this.damage = o.cars.map(() => ({ version: 0, zones: new Float32Array(4), src: null }));
    this.director = new TvDirector(o.track, o.tvCams, o.probe, CONFIG.tv);
    this.chase = new CarCameras(o.cars[o.focus].spec, o.probe);
    this.info = {};
    this.t = 0;
    this.rate = 1;
    this.slow = false;
    this.paused = false;
    this.mode = 0;
    this.clock = 0;
    this.lastDt = 0;
    this.fov = CONFIG.render.fovY;
    this.label = '';
    this.state = '';
  }

  /** Playback speed factor this step (0 when paused). */
  get speed() {
    return this.rate;
  }

  /**
   * @param {number} dt @param {{ held: (c: string) => boolean, hit: (c: string) => boolean }} kb
   * @returns {boolean} false when the viewer leaves the replay
   */
  update(dt, kb) {
    if (kb.hit('Enter') || kb.hit('Escape')) return false;
    if (kb.hit('Space')) this.paused = !this.paused;
    if (kb.hit('ArrowDown')) this.slow = !this.slow;
    if (kb.hit('KeyC')) { this.mode = (this.mode + 1) % MODES.length; this.director.cut(); }
    if (kb.hit('KeyF')) { this.focus = (this.focus + 1) % this.cars.length; this.chase = new CarCameras(this.cars[this.focus].spec, this.probe); this.director.cut(); }
    const R = CONFIG.replay, back = kb.held('ArrowLeft'), fwd = kb.held('ArrowRight');
    this.rate = back ? -R.fast : fwd ? R.fast : this.paused ? 0 : this.slow ? R.slow : 1;
    const last = this.replay.frames - 1, before = this.t;
    this.t = Math.max(0, Math.min(last, this.t + (this.rate * dt) / this.step));
    if (this.t >= last && this.rate > 0) this.paused = true;
    if (Math.abs(this.t - before) > 30) this.director.cut();
    this.clock += dt;
    this.lastDt = dt;
    // Status line, rebuilt only when it changes.
    const state = this.rate === 0 ? 'PAUSE' : this.rate < 0 ? '<< REWIND' : this.rate > 1 ? 'FAST >>' : this.rate < 1 ? 'SLOW' : 'PLAY';
    if (state !== this.state || this.mode !== this.labelMode || this.focus !== this.labelFocus) {
      this.state = state; this.labelMode = this.mode; this.labelFocus = this.focus;
      this.label = `${state}  CAM ${MODES[this.mode]}  ${this.cars[this.focus].name}`;
    }
    // Decode now (update side) so cameras and audio follow the same state the frame will show.
    this.replay.decode(this.t, this.objs);
    const f = this.objs[this.focus];
    this.chase.update(dt * Math.abs(this.rate || 1), f);
    const g = this.probe.sample(f.x, f.z, this.info, SLOT.CAM_TEST);
    this.director.update(dt, f, g.s, this.mode === 0);
    return true;
  }

  /**
   * Places the car visuals and the camera for this frame; sets env.fovY for the shot.
   * @param {{ pos: number[], yaw: number, pitch: number, roll: number }} camera @param {object} env
   */
  prepare(camera, env) {
    const frame = Math.floor(this.t);
    for (let k = 0; k < this.objs.length; k++) {
      const c = this.objs[k], z = this.replay.damageAt(k, frame), d = this.damage[k];
      if (z !== d.src) { d.src = z; if (z) d.zones.set(z); else d.zones.fill(0); d.version++; }
      const blink = c.ghost > 0 && Math.floor(c.ghost * 10) % 2 === 0;
      this.cars[k].visual.update(c, d, camera.pos, !blink);
    }
    const f = this.objs[this.focus];
    if (this.mode === 1) {
      this.chase.apply(camera, this.cars[this.focus].visual.pose, f, false);
      this.fov = CONFIG.render.fovY;
    } else {
      this.director.heli = this.mode === 2 || this.director.heli;
      this.fov = this.director.apply(camera, f, this.lastDt);
    }
    env.fovY = this.fov;
  }

  /** @param {import('../gfx/overlay.js').Overlay} ov */
  drawOverlay(ov) {
    const big = ov.w >= 640 ? 2 : 1;
    if (Math.floor(this.clock * 2) % 2 === 0) drawText(ov, 'REPLAY', 8, 6, RED, BACK, big);
    drawTime(ov, this.t * this.step, ov.w - 8 * CHAR_W - 8, 6, WHITE, BACK);
    drawText(ov, this.label, 8, 8 + 16 * big, WHITE, BACK);
    fillRect(ov, 0, ov.h - 18, ov.w, 18, BACK);
    drawText(ov, ov.w >= 640 ? 'SPACE PAUSE  <> SEEK  DOWN SLOW  C CAMERA  F CAR  ENTER EXIT' : 'SPC <> DN C F ENTER', 8, ov.h - 17, DIM);
  }
}

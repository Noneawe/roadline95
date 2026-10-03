// Race sound: connects the race simulation to the audio modules - the players' engines and effects
// (two players: panned left/right like their viewports), nearest rivals, crowd near grandstands,
// start signals, tunnel reverb and the radio.
// Voices are created lazily once the mixer runs (audio starts on the first user gesture).
import { CONFIG } from '../config.js';
import { EngineSound, RivalEngines } from '../audio/engine-sound.js';
import { Sfx, squealAmount } from '../audio/sfx.js';

const STILL = { vx: 0, vz: 0 };

export class RaceAudio {
  /**
   * @param {import('../audio/mixer.js').Mixer} mixer @param {import('../game/raceSim.js').RaceSim} sim
   * @param {number[][]} crowd grandstand positions [x, y, z, ...]
   * @param {() => string} [onRadio] switches the radio song, returns its name @param {number} [rain] rain level 0..1
   * @param {boolean} [split] two players
   */
  constructor(mixer, sim, crowd, onRadio, rain = 0, split = false) {
    this.split = split;
    this.rain = rain;
    this.mixer = mixer;
    this.sim = sim;
    this.crowd = crowd;
    this.onRadio = onRadio;
    this.rivals = sim.cars.filter((c) => !c.isPlayer);
    for (const c of sim.cars) c.audioLoop = `engine:${c.spec.id}:1:on`;
    this.engine = null;
    this.players = [];
    this.label = '';
    this.labelTime = 0;
    this.state = { dt: 0, speed: 0, surface: null, impact: 0, crowdDist: 0, tunnel: false, squeal: 0 };
  }

  build() {
    const A = CONFIG.audio;
    this.players = this.sim.players.map((p, k) => {
      const pan = this.split ? (k ? 1 : -1) * CONFIG.split.pan : 0;
      const sfx = new Sfx(this.mixer, A.sfx, { pan, ambient: k === 0 });
      sfx.setRain(this.rain);
      return { p, engine: new EngineSound(this.mixer, p.spec, { ...A.engine, pan }), sfx };
    });
    this.engine = this.players[0].engine;
    this.sfx = this.players[0].sfx;
    this.rivalVoices = new RivalEngines(this.mixer, A.rivals);
  }

  /** Next radio song (R / Select). */
  radio() {
    if (!this.onRadio) return;
    this.label = `RADIO: ${this.onRadio()}`;
    this.labelTime = 2.5;
  }

  /** @param {number} dt @param {{ pos: number[], yaw: number }} listener camera */
  update(dt, listener) {
    this.labelTime = Math.max(0, this.labelTime - dt);
    if (!this.mixer.ctx) return;
    if (!this.engine) this.build();
    const race = this.sim.race;
    this.rivalVoices.update(this.rivals, listener, this.sim.player.car);
    let crowdDist = Infinity;
    for (const g of this.crowd) crowdDist = Math.min(crowdDist, Math.hypot(g[0] - listener.pos[0], g[2] - listener.pos[2]));
    let tunnel = false;
    for (const x of this.players) tunnel ||= !!x.p.info.tunnel;
    for (const x of this.players) {
      const p = x.p, car = p.car, s = this.state;
      x.engine.update(car, dt);
      s.dt = dt; s.speed = car.speed; s.surface = car.surface; s.impact = p.lastImpact; s.crowdDist = crowdDist;
      s.tunnel = tunnel; s.squeal = squealAmount(car.slip, car.surface, car.spec.tyres.peakSlip, car.speed);
      x.sfx.update(s);
    }
    this.sfx.startLights(race.lightsOn, race.phase !== 'countdown');
  }

  /**
   * Replay sound: every car (player included) through the rival voices, pitch scaled by the playback
   * speed; the player's own engine and effects are silent. Silent when paused.
   * @param {object[]} cars replay car views @param {{ pos: number[], yaw: number }} listener @param {number} rate
   */
  updateReplay(cars, listener, rate) {
    if (!this.mixer.ctx) return;
    if (!this.engine) this.build();
    for (const x of this.players) { x.engine.mute(); x.sfx.mute(); }
    this.rivalVoices.update(cars, listener, STILL, Math.abs(rate));
  }

  stop() {
    if (!this.engine) return;
    for (const x of this.players) { x.engine.stop(); x.sfx.stop(); }
    this.rivalVoices.stop();
  }
}

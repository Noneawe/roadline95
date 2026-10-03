// Race simulation core (no DOM/GL): grid, player and AI cars (each rival drives its own car model),
// fixed-step physics with substeps, car-scenery and car-car collisions, damage, reset of stuck cars,
// sprint run-out and the race logic. Deterministic for a given seed; shared by the race scene and tests.
import { CONFIG } from '../config.js';
import { frameAt } from '../world/track.js';
import { CAR_SLOTS } from '../world/ground.js';
import { Car, arcadeLatBoost } from '../vehicle/physics.js';
import { CARS } from '../vehicle/cars.js';
import { speedProfile } from '../world/racingline.js';
import { wetGripFactor } from './weather.js';
import { Damage } from '../vehicle/damage.js';
import { AIDriver, DRIVERS, PLAYER_SLOT, PLAYER2_SLOT } from '../ai/opponent.js';
import { Race } from './race.js';
import { collideCarStatic, collideCars } from './collision.js';
import { makeRng, hashString } from '../engine/rng.js';

const AUTOPILOT = { name: 'AUTO', skill: 0.88, aggression: 0.2, errors: 0, consistency: 1, variant: 0, autopilot: true };

export class RaceSim {
  /**
   * @param {object} o
   * @param {import('../world/track.js').Track} o.track @param {import('../world/ground.js').GroundProbe} o.probe
   * @param {import('./collision.js').StaticColliders} o.colliders @param {import('../world/racingline.js').RacingLine} o.line
   * @param {object} o.spec player car spec @param {number} o.ai rivals 0..7 @param {number} o.laps @param {number} o.seed
   * @param {boolean} [o.playerAi] the player car is driven by the autopilot (tests)
   * @param {object[]} [o.drivers] rival personalities in grid order (default: DRIVERS)
   * @param {number} [o.wet] road wetness 0..1 (weather): less grip for every car, slower AI targets
   * @param {object} [o.spec2] second human player's car spec (split screen): both players start last
   */
  constructor(o) {
    const { track, probe, line, spec } = o, R = CONFIG.race;
    this.track = track;
    this.probe = probe;
    this.colliders = o.colliders;
    this.playerAi = !!o.playerAi;
    // Two human players: at most 6 rivals (the 7th rival's livery slot goes to player 2).
    const humans = o.spec2 ? 2 : 1, drivers = o.drivers || DRIVERS, nAi = Math.max(0, Math.min(drivers.length - (humans - 1), o.ai));
    const seed = (o.seed ^ hashString(`race:${track.def.id}`)) >>> 0, rng = makeRng(seed);
    const f = (this.f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] });
    this.cars = [];
    this.line = line;
    this.wet = o.wet || 0;
    this.speeds = new Map();
    // Grid: rivals in pairs ahead, the human player(s) start last.
    for (let k = 0; k < nAi + humans; k++) {
      const isPlayer = k >= nAi, playerNo = k - nAi, persona = isPlayer ? null : drivers[k];
      const cs = isPlayer ? (playerNo ? o.spec2 : spec) : CARS[persona.car ?? -1] || spec, car = new Car(cs);
      car.wet = this.wet;
      car.slotBase = k * CAR_SLOTS;
      frameAt(track, track.startS - 12 - Math.floor(k / 2) * R.gridSpacing, f);
      const lat = (k % 2 ? 1 : -1) * R.gridLateral;
      car.reset(f.pos[0] + f.right[0] * lat, f.pos[1], f.pos[2] + f.right[2] * lat, Math.atan2(f.fwd[0], -f.fwd[2]));
      const aiRng = makeRng((seed ^ hashString(persona ? persona.name : 'player')) >>> 0);
      this.cars.push({
        car, spec: cs, isPlayer, playerNo: isPlayer ? playerNo : -1,
        name: isPlayer ? (humans > 1 ? `PLAYER ${playerNo + 1}` : 'PLAYER') : persona.name,
        variant: isPlayer ? (playerNo ? PLAYER2_SLOT : PLAYER_SLOT) : Math.max(0, DRIVERS.indexOf(persona)),
        ai: new AIDriver(car, track, line, persona || AUTOPILOT, aiRng, this.speedFor(cs)),
        damage: new Damage(CONFIG.damage), info: {}, pos: { s: 0, lat: 0, speed: 0, ghost: false },
        ghost: 0, stuck: 0, parked: false, lastImpact: 0,
      });
    }
    this.player = this.cars[nAi];
    this.playerIndex = nAi;
    this.players = this.cars.slice(nAi);
    this.race = new Race(track, this.cars.map((c, id) => ({ id, name: c.name, isPlayer: c.isPlayer })),
      { laps: o.laps, ...R, goDelay: R.goDelay[0] + rng() * (R.goDelay[1] - R.goDelay[0]) });
    this.positions = this.cars.map((c) => c.pos);
    this.sArr = new Float64Array(this.cars.length);
    this.ctrl = new Array(this.cars.length).fill(null);
    // Grid hold uses the handbrake: holding the brake at standstill would engage reverse (auto gearbox).
    this.hold = { throttle: 0, brake: 0, steer: 0, analog: true, handbrake: true, gearUp: false, gearDown: false };
    this.locate();
  }

  /**
   * Racing line target speeds for a car, cached per spec: cornering grip scaled by its tyres, straights
   * capped below its top speed (lower bound of its v-max range, so the driver's skill also shows on the straights).
   */
  speedFor(spec) {
    if (!this.speeds.has(spec.id)) {
      const c = CONFIG.ai.line, grip = (spec.tyres.mu / CARS[0].tyres.mu) * wetGripFactor(spec, this.wet), top = spec.expect.vmax[0] / 3.6;
      this.speeds.set(spec.id, speedProfile(this.track, this.line, {
        ...c, grip: c.grip * grip, brake: c.brake * grip, vmax: Math.min(c.vmax, top), latBoost: arcadeLatBoost,
      }));
    }
    return this.speeds.get(spec.id);
  }

  locate() {
    for (const c of this.cars) {
      const g = this.probe.sample(c.car.x, c.car.z, c.info, c.car.slotBase + 5);
      c.pos.s = g.s; c.pos.lat = g.lat; c.pos.speed = c.car.speed; c.pos.ghost = c.ghost > 0 || c.parked;
    }
  }

  /**
   * One fixed update. Player controls: `first` for the first substep (gear changes), `rest` afterwards;
   * first2/rest2 for the second human player.
   * @param {number} dt @param {object} first @param {object} rest @param {object} [first2] @param {object} [rest2]
   */
  step(dt, first, rest, first2 = first, rest2 = rest) {
    const race = this.race, sub = CONFIG.vehicle.substeps;
    // Catch-up reference: the leading human player.
    let pp = -Infinity;
    for (let k = this.playerIndex; k < this.cars.length; k++) pp = Math.max(pp, race.progress(race.entries[k]));
    for (let k = 0; k < this.cars.length; k++) this.ctrl[k] = this.controlsFor(this.cars[k], k, dt, pp);
    this.slipstream();
    for (let i = 0; i < sub; i++) {
      for (let k = 0; k < this.cars.length; k++) {
        const c = this.cars[k], own = this.ctrl[k] || (c.playerNo === 1 ? (i === 0 ? first2 : rest2) : i === 0 ? first : rest);
        c.car.step(dt / sub, own, this.probe);
        collideCarStatic(c.car, this.colliders);
      }
      collideCars(this.cars);
    }
    for (const c of this.cars) {
      c.lastImpact = c.car.impact;
      if (c.car.impact > 0) c.damage.hit(c.car.heading, c.car.impact, c.car.impactNx, c.car.impactNz);
      c.car.impact = 0;
      this.resetStuck(c, dt);
    }
    this.locate();
    for (let k = 0; k < this.cars.length; k++) this.sArr[k] = this.cars[k].pos.s;
    race.update(dt, this.sArr);
  }

  controlsFor(c, k, dt, playerProgress) {
    const race = this.race;
    if (race.phase === 'countdown') return c.isPlayer && !this.playerAi ? null : this.hold;
    const e = race.entries[k];
    if (c.isPlayer && !e.finished && !this.playerAi) return null;
    // After a sprint finish: slow down and stop before the end of the road, out of everyone's way.
    if (race.sprint && e.finished) {
      c.parked = true;
      c.ai.cap = Math.min(22, Math.sqrt(2 * 4 * Math.max(0, this.track.length - 60 - c.pos.s)));
      if (c.ai.cap < 3 && c.car.speed < 2) return this.hold;
    }
    const gap = Math.max(-1, Math.min(1, (playerProgress - race.progress(e)) / CONFIG.ai.catchupRange));
    return c.ai.think(dt, c.pos, this.positions, c.isPlayer ? 0 : gap);
  }

  // Slipstream: a car close behind another in the same lane has less drag (helps passing on straights).
  slipstream() {
    const D = CONFIG.race.draft, L = this.track.length;
    for (const c of this.cars) {
      let best = 0;
      for (const o of this.cars) {
        if (o === c || o.ghost > 0 || o.parked) continue;
        let gap = o.pos.s - c.pos.s;
        if (this.track.closed && gap < -L / 2) gap += L;
        if (gap > 2 && gap < D.range && Math.abs(o.pos.lat - c.pos.lat) < D.width) best = Math.max(best, D.max * (1 - gap / D.range));
      }
      c.car.draft = c.parked ? 0 : best;
    }
  }

  // Stuck cars (stopped off the road or facing the wrong way; AI: stopped anywhere) go back to the line.
  resetStuck(c, dt) {
    if (c.ghost > 0) c.ghost = Math.max(0, c.ghost - dt);
    if (this.race.phase !== 'running' || c.parked) return;
    const car = c.car, hw = this.track.def.width / 2, f = this.f, track = this.track;
    frameAt(track, c.pos.s, f);
    let rel = car.heading - Math.atan2(f.fwd[0], -f.fwd[2]);
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const bad = !c.isPlayer || this.playerAi || Math.abs(c.pos.lat) > hw || Math.abs(rel) > 1.7;
    c.stuck = car.speed < 1.5 && bad ? c.stuck + dt : 0;
    if (c.stuck < CONFIG.race.stuckTime) return;
    const s = c.pos.s - 10;
    frameAt(track, s, f);
    const off = c.ai.lineOffset(s), rl = Math.hypot(f.right[0], f.right[2]);
    car.reset(f.pos[0] + (f.right[0] / rl) * off, f.pos[1], f.pos[2] + (f.right[2] / rl) * off, Math.atan2(f.fwd[0], -f.fwd[2]));
    c.stuck = 0;
    c.ghost = CONFIG.race.ghostTime;
  }
}

// AI opponents: follow the racing line with the same car physics as the player. Personalities differ in
// skill (fraction of the line speed), aggression (overtaking, defending, gaps), mistakes (late braking,
// running wide) and consistency (pace noise). Mild catch-up towards the player. Deterministic (seeded).
import { CONFIG } from '../config.js';
import { frameAt, sampleIndex } from '../world/track.js';

/**
 * Seven fictional rivals: car (CARS index), livery colour set and race number; the livery slot is the
 * driver's index (the player uses slot 7). Faster drivers tend to get the less forgiving cars.
 */
export const DRIVERS = [
  { name: 'A. VARN', skill: 0.97, aggression: 0.8, errors: 0.010, consistency: 0.97, car: 3, set: 0, number: 2 },
  { name: 'B. KASTEN', skill: 0.955, aggression: 0.5, errors: 0.015, consistency: 0.98, car: 0, set: 1, number: 3 },
  { name: 'C. DORIN', skill: 0.945, aggression: 0.9, errors: 0.030, consistency: 0.93, car: 1, set: 0, number: 4 },
  { name: 'D. HALVIK', skill: 0.935, aggression: 0.3, errors: 0.010, consistency: 0.99, car: 4, set: 0, number: 5 },
  { name: 'E. MORRO', skill: 0.925, aggression: 0.7, errors: 0.035, consistency: 0.92, car: 5, set: 0, number: 6 },
  { name: 'F. TANSEL', skill: 0.915, aggression: 0.4, errors: 0.020, consistency: 0.96, car: 2, set: 0, number: 7 },
  { name: 'G. ORLAN', skill: 0.90, aggression: 0.6, errors: 0.040, consistency: 0.90, car: 0, set: 2, number: 8 },
];

/** Livery slots of the human players (rivals use their DRIVERS index; with two players the 7th rival sits out). */
export const PLAYER_SLOT = 7;
export const PLAYER2_SLOT = 6;

/**
 * Livery entries for the texture library: the rivals plus the players' cars and colour sets.
 * @param {number} playerCar @param {number} playerSet
 * @param {number | null} [player2Car] second player (split screen) @param {number} [player2Set]
 * @returns {import('../texgen/livery.js').LiveryEntry[]}
 */
export function gridLiveries(playerCar, playerSet, player2Car = null, player2Set = 0) {
  const slots = [...DRIVERS.map((d) => ({ car: d.car, set: d.set, number: d.number })), { car: playerCar, set: playerSet, number: 1 }];
  if (player2Car !== null) slots[PLAYER2_SLOT] = { car: player2Car, set: player2Set, number: 9 };
  return slots;
}

export class AIDriver {
  /**
   * @param {import('../vehicle/physics.js').Car} car @param {import('../world/track.js').Track} track
   * @param {import('../world/racingline.js').RacingLine} line @param {object} persona entry of DRIVERS
   * @param {() => number} rng @param {Float32Array} [speed] target speeds for this car (default: line.speed)
   */
  constructor(car, track, line, persona, rng, speed = line.speed) {
    this.car = car;
    this.track = track;
    this.line = line;
    this.speed = speed;
    // Extra speed limit set by the race (e.g. slowing down after a sprint finish).
    this.cap = Infinity;
    this.p = persona;
    this.rng = rng;
    this.bias = 0;
    this.biasTarget = 0;
    this.error = 0;
    this.errorKind = 0;
    this.noise = 1;
    this.noiseTimer = 0;
    this.followLimit = Infinity;
    this.emergency = false;
    this.desired = 0;
    this.dt = 0;
    this.passSide = 0;
    this.passTimer = 0;
    this.side = 0;
    this.sideBias = 0;
    this.frame = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
    this.controls = { throttle: 0, brake: 0, steer: 0, analog: true, handbrake: false, gearUp: false, gearDown: false };
  }

  /**
   * Computes controls for one fixed step.
   * @param {number} dt
   * @param {{ s: number, lat: number }} me own track position
   * @param {{ s: number, lat: number, speed: number, ghost: boolean }[]} others other cars (track positions)
   * @param {number} catchup -1..1 (behind the player > 0)
   * @returns {object} controls
   */
  think(dt, me, others, catchup) {
    const A = CONFIG.ai, car = this.car, v = car.speed, track = this.track;
    this.dt = dt;
    this.mistakes(dt, me.s);
    const diff = this.p.autopilot ? 1 : A.difficulty;
    this.desired = this.lineSpeed(me.s + v * 0.35) * this.p.skill * diff * this.noise * (1 + A.catchup * catchup);
    this.traffic(me, others);
    this.bias += (this.biasTarget + (this.errorKind === 2 ? 2.5 : 0) - this.bias) * Math.min(1, dt * (this.biasTarget ? 2.5 : 1.2));
    this.sideBias += (this.side - this.sideBias) * Math.min(1, dt * 4);
    // Steering towards a look-ahead point on the (biased) racing line.
    const look = me.s + A.lookAhead + v * A.lookAheadTime, f = frameAt(track, look, this.frame);
    const hw = track.def.width / 2 - 1.2;
    const lat = Math.max(-hw, Math.min(hw, this.lineOffset(look) + this.bias + this.sideBias)), rl = Math.hypot(f.right[0], f.right[2]);
    const tx = f.pos[0] + (f.right[0] / rl) * lat, tz = f.pos[2] + (f.right[2] / rl) * lat;
    let ang = Math.atan2(tx - car.x, -(tz - car.z)) - car.heading;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    const c = this.controls;
    c.steer = Math.max(-1, Math.min(1, ang * A.steerGain));
    // Pace: line speed a little ahead, personality, catch-up, noise and mistakes.
    let target = this.desired;
    if (this.errorKind === 1) target *= 1.12;
    target = Math.min(target, this.followLimit, this.cap);
    const err = target - v;
    c.throttle = err > 0 && !this.emergency ? Math.min(1, 0.35 + err * 0.4) : 0;
    c.brake = this.emergency ? 1 : err < -1.2 ? Math.min(1, -err * 0.22) : 0;
    return c;
  }

  lineOffset(s) {
    const t = this.track, f = (t.closed ? ((s % t.length) + t.length) % t.length : Math.max(0, s)) / t.ds, i = Math.floor(f), u = f - i;
    return this.line.offset[sampleIndex(t, i)] * (1 - u) + this.line.offset[sampleIndex(t, i + 1)] * u;
  }

  lineSpeed(s) {
    const t = this.track, i = Math.round((t.closed ? ((s % t.length) + t.length) % t.length : s) / t.ds);
    return this.speed[sampleIndex(t, i)];
  }

  // Occasional mistakes before corners (late braking or running wide) and slow pace drift.
  mistakes(dt, s) {
    this.noiseTimer -= dt;
    if (this.noiseTimer <= 0) {
      this.noiseTimer = 2 + this.rng() * 3;
      this.noise = 1 - (1 - this.p.consistency) * this.rng();
    }
    if (this.error > 0) {
      this.error -= dt;
      if (this.error <= 0) this.errorKind = 0;
      return;
    }
    const k = Math.abs(this.line.curvature[sampleIndex(this.track, Math.round((s + 40) / this.track.ds))]);
    if (k > 0.004 && this.rng() < this.p.errors * dt * 4) {
      this.error = CONFIG.ai.errorDuration;
      this.errorKind = this.rng() < 0.5 ? 1 : 2;
    }
  }

  // Traffic: hold a lane's width from a car alongside, follow the car ahead with a time gap (emergency
  // braking when closing fast), overtake on the side with more room when faster, aggressive drivers
  // defend against a close car behind; otherwise return to the racing line.
  traffic(me, others) {
    const A = CONFIG.ai, hw = this.track.def.width / 2 - 1.2, L = this.track.closed ? this.track.length : Infinity, v = this.car.speed;
    this.followLimit = Infinity;
    this.emergency = false;
    let ahead = null, aheadGap = Infinity, behind = null, behindGap = Infinity, block = null, blockGap = Infinity;
    let along = null, alongDl = 0, alongGap = 0;
    const overlap = this.car.spec.body.width + 0.3;
    for (const o of others) {
      if (o.ghost) continue;
      let gap = o.s - me.s;
      if (gap > L / 2) gap -= L;
      if (gap < -L / 2) gap += L;
      if (gap === 0 && o.lat === me.lat) continue;
      const dl = o.lat - me.lat;
      if (Math.abs(gap) < 6 && Math.abs(dl) < A.lane && (!along || Math.abs(dl) < Math.abs(alongDl))) { along = o; alongDl = dl; alongGap = gap; }
      if (gap > 0 && gap < aheadGap && Math.abs(dl) < A.lane) { ahead = o; aheadGap = gap; }
      if (gap > 0 && gap < blockGap && Math.abs(dl) < overlap) { block = o; blockGap = gap; }
      if (gap < 0 && -gap < behindGap) { behind = o; behindGap = -gap; }
    }
    const lineLat = this.lineOffset(me.s);
    let target = 0;
    this.passTimer = Math.max(0, this.passTimer - this.dt);
    if (ahead) {
      const closing = v - ahead.speed;
      const left = ahead.lat - A.lane, right = ahead.lat + A.lane, roomL = left > -hw, roomR = right < hw;
      // Pass when close behind and faster (closing in, or held up below our own pace); keep the chosen
      // side for a while instead of swapping as the car ahead crosses the track.
      const wants = closing > 0.5 || this.desired - ahead.speed > 0.8;
      if (wants && aheadGap < A.overtakeGap + v * A.overtakeTime && this.p.aggression > 0.25) {
        if (!this.passTimer || (this.passSide < 0 ? !roomL : !roomR)) {
          this.passSide = roomL && roomR ? (Math.abs(left - me.lat) < Math.abs(right - me.lat) ? -1 : 1) : roomL ? -1 : roomR ? 1 : 0;
          this.passTimer = this.passSide ? A.passCommit : 0;
        }
        if (this.passSide) target = (this.passSide < 0 ? left : right) - lineLat;
      }
    }
    // Only a car overlapping our lane blocks us (follow with a time gap, emergency braking).
    if (block) {
      const closing = v - block.speed, safe = 3 + v * A.followTime;
      if (blockGap < safe + Math.max(0, closing) * 1.2) this.followLimit = Math.max(3, block.speed + (blockGap - safe) * 0.5);
      if (blockGap < 3 + Math.max(0, closing) * 0.6 && closing > 1) this.emergency = true;
    }
    if (!ahead && behind && behindGap < 12 && this.p.aggression > 0.6) {
      target = Math.max(-1.5, Math.min(1.5, (behind.lat - lineLat) * 0.5));
    }
    this.biasTarget = Math.max(-hw - lineLat, Math.min(hw - lineLat, target));
    this.side = 0;
    // A car alongside: hold a full lane away from it; when squeezed against the edge, the car behind yields.
    if (along) {
      const dir = -Math.sign(alongDl || 1), want = along.lat + dir * A.lane, base = lineLat + this.biasTarget;
      this.side = Math.max(-hw, Math.min(hw, want)) - base;
      if (Math.abs(want) > hw && alongGap > 0) this.followLimit = Math.min(this.followLimit, Math.max(3, along.speed - 1.5));
    }
  }
}

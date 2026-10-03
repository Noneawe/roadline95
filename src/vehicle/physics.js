// Arcade-sim vehicle model (CLAUDE.md 12): planar rigid body with yaw, four tyres with slip curve,
// friction circle and load sensitivity, longitudinal/lateral weight transfer, aero drag/downforce,
// slope and bank from the ground normal, simple vertical motion (crests can lift the car).
// Fixed timestep, no allocation per step, no DOM. Heading 0 = -Z, positive turns right.
import { CONFIG } from '../config.js';
import { Drivetrain } from './drivetrain.js';
import { slipCurve, loadedMu, SURFACE_PROPS } from './tyres.js';

const G = 9.81;
const AIR = 1.2;

/**
 * @typedef {object} Controls
 * @property {number} throttle 0..1 @property {number} brake 0..1 @property {number} steer -1..1
 * @property {boolean} handbrake @property {boolean} gearUp @property {boolean} gearDown
 * @property {boolean} analog steer is analog (no keyboard ramp)
 */

/**
 * @typedef {object} GroundSample
 * @property {number} y @property {number} nx @property {number} ny @property {number} nz
 * @property {number} surface SURFACE value
 * @property {boolean} [bounded] lateral limits are valid
 * @property {number} [lat] lateral offset of the sample point @property {number} [limL] @property {number} [limR]
 * @property {number} [rx] @property {number} [rz] horizontal unit vector of increasing lat
 */

/**
 * @typedef {{ sample: (x: number, z: number, out: GroundSample, slot: number) => GroundSample }} Ground
 */

/**
 * Arcade layer: lateral grip multiplier growing with speed (feels like big downforce); longitudinal
 * grip is untouched. Also used by the racing line speed profile.
 * @param {number} speed m/s
 * @returns {number}
 */
export function arcadeLatBoost(speed) {
  const A = CONFIG.vehicle.arcade, sp = Math.min(1, Math.max(0, (speed - A.fromSpeed) / (A.toSpeed - A.fromSpeed)));
  return A.latGrip + (A.latGripFast - A.latGrip) * sp * sp * (3 - 2 * sp);
}

const newSample = () => ({ y: 0, nx: 0, ny: 1, nz: 0, surface: 0, bounded: false, lat: 0, limL: 0, limR: 0, rx: 1, rz: 0 });

export class Car {
  /** @param {object} spec entry of CARS */
  constructor(spec) {
    this.spec = spec;
    this.dt = new Drivetrain(spec);
    const a = spec.wheelbase - spec.cgFromRear, b = spec.cgFromRear, t = spec.trackWidth / 2;
    // Wheel offsets from the CG in the car frame (forward, right): FL, FR, RL, RR.
    this.wf = [a, a, -b, -b];
    this.wr = [-t, t, -t, t];
    this.load = new Float64Array(4);
    this.slip = new Float64Array(4);
    this.spin = new Float64Array(4);
    this.surface = new Uint8Array(4);
    this.ground = [newSample(), newSample(), newSample(), newSample(), newSample()];
    this.autoGear = true;
    /** First ground-probe hint slot of this car (CAR_SLOTS per car). */
    this.slotBase = 0;
    this.wet = 0;
    this.reset(0, 0, 0, 0);
  }

  /** Places the car at rest. @param {number} x @param {number} y @param {number} z @param {number} heading */
  reset(x, y, z, heading) {
    this.x = x; this.y = y; this.z = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.heading = heading;
    this.yawRate = 0;
    this.steer = 0;
    this.axLocal = 0;
    this.ayLocal = 0;
    this.throttleEff = 0;
    this.airborne = false;
    this.groundNormal = [0, 1, 0];
    this.slopeAcc = 0;
    this.latBoost = 1;
    /** Slipstream: fraction of aero drag removed by a car close ahead (set by the race simulation). */
    this.draft = 0;
    this.impact = 0;
    this.impactNx = 0;
    this.impactNz = 0;
    this.braking = false;
    this.spinning = false;
    this.dt.rpm = this.spec.engine.idle;
    this.dt.gear = this.dt.target = 1;
    this.dt.shiftTimer = 0;
  }

  /** @returns {number} forward speed (m/s, negative when reversing) */
  get forwardSpeed() {
    return this.vx * Math.sin(this.heading) - this.vz * Math.cos(this.heading);
  }

  /** @returns {number} ground speed (m/s) */
  get speed() {
    return Math.hypot(this.vx, this.vz);
  }

  /**
   * Advances the simulation by one fixed step.
   * @param {number} dt @param {Controls} c @param {Ground} ground
   */
  step(dt, c, ground) {
    const s = this.spec, C = CONFIG.vehicle;
    const fx = Math.sin(this.heading), fz = -Math.cos(this.heading), rx = -fz, rz = fx;
    let vf = this.vx * fx + this.vz * fz, vr = this.vx * rx + this.vz * rz;
    this.updateSteer(dt, c, vf, vr);

    // Controls through the gearbox (reverse swaps pedals in automatic mode).
    if (this.autoGear) this.dt.autoReverse(dt, vf, c.throttle, c.brake);
    const rev = this.autoGear && this.dt.gear < 0;
    const pedal = rev ? c.brake : c.throttle, brake = rev ? c.throttle : c.brake;
    this.throttleEff += ((C.tractionControl && this.spinning ? pedal * 0.4 : pedal) - this.throttleEff) * Math.min(1, dt * 12);
    const wheelTorque = this.dt.update(dt, { throttle: this.throttleEff, gearUp: c.gearUp, gearDown: c.gearDown }, vf, this.autoGear);

    // Ground under the wheels and the body.
    let gy = 0, nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 4; i++) {
      const g = ground.sample(this.x + fx * this.wf[i] + rx * this.wr[i], this.z + fz * this.wf[i] + rz * this.wr[i], this.ground[i], this.slotBase + i);
      this.surface[i] = g.surface;
      gy += g.y / 4; nx += g.nx / 4; ny += g.ny / 4; nz += g.nz / 4;
    }
    const nl = Math.hypot(nx, ny, nz);
    this.groundNormal[0] = nx / nl; this.groundNormal[1] = ny / nl; this.groundNormal[2] = nz / nl;
    this.vertical(dt, gy);
    this.slopeAcc = G * this.groundNormal[1] * Math.hypot(this.groundNormal[0], this.groundNormal[2]);
    this.braking = brake > 0.1 || c.handbrake;

    // Loads with weight transfer and downforce.
    const v2 = vf * vf, L = s.wheelbase, h = s.cgHeight;
    const down = this.airborne ? 0 : s.mass * G * this.groundNormal[1];
    const aeroF = 0.5 * AIR * s.aero.clFront * v2, aeroR = 0.5 * AIR * s.aero.clRear * v2;
    const longT = (s.mass * this.axLocal * h * C.arcade.pitchTransfer) / L;
    const front = this.airborne ? 0 : Math.max(0, (down * (s.cgFromRear / L)) - longT + aeroF);
    const rear = this.airborne ? 0 : Math.max(0, (down * ((L - s.cgFromRear) / L)) + longT + aeroR);
    // Arcade grip multiplies cornering g; weight transfer uses the "real" share so inner wheels keep load.
    const latT = (s.mass * (this.ayLocal / this.latBoost) * h) / s.trackWidth;
    this.load[0] = Math.max(0, front / 2 + latT * s.rollFront);
    this.load[1] = Math.max(0, front / 2 - latT * s.rollFront);
    this.load[2] = Math.max(0, rear / 2 + latT * (1 - s.rollFront));
    this.load[3] = Math.max(0, rear / 2 - latT * (1 - s.rollFront));

    // Tyre forces (car frame: F forward, R right) and yaw torque.
    let sumF = 0, sumR = 0, torque = 0, spinning = false;
    const nominal = (s.mass * G) / 4, wet = 1 - this.wet * (1 - (s.tyres.wetGrip ?? C.wetGrip));
    const latBoost = arcadeLatBoost(Math.abs(vf));
    this.latBoost = latBoost;
    const driveFront = s.drive.type === 'FWD' ? 1 : s.drive.type === 'AWD' ? s.drive.front : 0;
    for (let i = 0; i < 4; i++) {
      const isFront = i < 2, Fz = this.load[i];
      const pvf = vf - this.yawRate * this.wr[i], pvr = vr + this.yawRate * this.wf[i];
      const d = isFront ? this.steer : 0, cd = Math.cos(d), sd = Math.sin(d);
      const wvf = pvf * cd + pvr * sd, wvr = -pvf * sd + pvr * cd;
      const surf = SURFACE_PROPS[this.surface[i]];
      const axleGrip = isFront ? 1 : s.tyres.rearGrip;
      const maxF = loadedMu(s.tyres.mu * axleGrip * surf.grip * wet, Fz, nominal, s.tyres.loadSens) * Fz;
      const alpha = Math.atan2(wvr, Math.max(Math.abs(wvf), 2.5));
      this.slip[i] = alpha;
      let Fy = -maxF * latBoost * slipCurve(alpha, s.tyres.peakSlip, s.tyres.falloff);
      // Longitudinal: drive, brakes (ABS caps at the grip limit), rolling and surface drag.
      const share = isFront ? driveFront / 2 : (1 - driveFront) / 2;
      let Fx = (wheelTorque * share) / s.wheelRadius;
      // No engine braking while the brake pedal is pressed (clutch open); otherwise capped per wheel.
      if (Fx < 0 && wheelTorque * Math.sign(vf || 1) < 0) Fx = brake > 0.05 ? 0 : Math.max(Fx, -maxF * 0.3);
      let bf = brake * s.brakes.force * (isFront ? s.brakes.bias : 1 - s.brakes.bias) / 2;
      // ABS; the rear axle keeps a lateral reserve (brake force limited like an EBD valve).
      if (C.abs) bf = Math.min(bf, maxF * (isFront ? 0.97 : C.rearBrakeLimit));
      const locked = !isFront && c.handbrake;
      if (locked) bf = Math.max(bf, s.brakes.handbrake / 2);
      const dir = Math.max(-1, Math.min(1, wvf / 0.6));
      Fx -= bf * dir + (s.tyres.rollRes + surf.drag) * Fz * dir;
      if (locked && Math.abs(wvf) > 0.5) { Fx = -Math.sign(wvf) * maxF * 0.75; Fy *= 0.35; }
      this.spin[i] = maxF > 0 ? Math.abs(Fx) / maxF : 0;
      if (Math.abs(Fx) > maxF) {
        if (share > 0 && Math.abs(wheelTorque) > 0) spinning = true;
        Fx = Math.sign(Fx) * maxF;
      }
      // Traction control also reacts to a driven axle sliding sideways (power oversteer).
      if (share > 0 && wheelTorque > 0 && Math.abs(alpha) > s.tyres.peakSlip * 1.4) spinning = true;
      // Friction ellipse: longitudinal force uses up lateral grip only partly (C.frictionEllipse < 1).
      const used = (Fx * Fx) / (maxF * maxF || 1) * C.frictionEllipse;
      const latMax = maxF * latBoost * Math.max(0.25, Math.sqrt(Math.max(0, 1 - used)));
      Fy = Math.max(-latMax, Math.min(latMax, Fy));
      const cf = Fx * cd - Fy * sd, cr = Fx * sd + Fy * cd;
      sumF += cf; sumR += cr;
      torque += this.wf[i] * cr - this.wr[i] * cf;
    }
    this.spinning = spinning;

    // Aero drag and gravity along the ground plane.
    const v = Math.hypot(vf, vr), drag = 0.5 * AIR * s.aero.cdA * v * (1 - this.draft);
    sumF -= drag * vf; sumR -= drag * vr;
    if (!this.airborne) {
      const gx = s.mass * G * this.groundNormal[1] * this.groundNormal[0], gz = s.mass * G * this.groundNormal[1] * this.groundNormal[2];
      sumF += gx * fx + gz * fz; sumR += gx * rx + gz * rz;
    }
    torque += this.stability(vf, vr);
    this.integrate(dt, sumF, sumR, torque, fx, fz, rx, rz);
    this.bounds(ground);
  }

  // Steering with speed-dependent lock. With CONFIG.vehicle.steerAssist the wheel angle in the
  // input direction is capped so the front slip angle stays near the tyre's peak (full keyboard lock
  // would otherwise push the front far past the grip peak and the car would plough straight on).
  // Counter-steering into a slide stays possible because the cap follows the front axle's travel direction.
  // Stability assist (arcade): beyond a sideslip threshold a yaw torque turns the nose back along the
  // direction of travel, so braking or lifting mid-corner does not end in a spin.
  stability(vf, vr) {
    const k = CONFIG.vehicle.stability, speed = Math.abs(vf);
    if (!k || speed < 4) return 0;
    const beta = Math.atan2(vr, speed), over = Math.abs(beta) - CONFIG.vehicle.stabilityFrom;
    if (over <= 0) return 0;
    return Math.sign(beta) * over * k * this.spec.inertiaYaw;
  }

  updateSteer(dt, c, vf, vr) {
    const st = this.spec.steer, speed = Math.abs(vf);
    const lock = st.lock / (1 + speed / st.speedFalloff);
    let target = c.steer * lock;
    const assist = CONFIG.vehicle.steerAssist;
    if (assist > 0 && speed > 5 && c.steer !== 0) {
      const a = this.spec.wheelbase - this.spec.cgFromRear;
      const beta = Math.atan2(vr + this.yawRate * a, speed), limit = this.spec.tyres.peakSlip * assist;
      // Never steer harder than the lock, and counter-steer on its own by at most half the lock.
      target = c.steer > 0 ? Math.max(-lock * 0.5, Math.min(target, beta + limit)) : Math.min(lock * 0.5, Math.max(target, beta - limit));
    }
    if (c.analog) { this.steer += (target - this.steer) * Math.min(1, dt * 10); return; }
    const toward = Math.abs(target) < Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer);
    const rate = (toward ? st.returnRate : st.rate) * st.lock * dt;
    this.steer += Math.max(-rate, Math.min(rate, target - this.steer));
  }

  vertical(dt, groundY) {
    const prevGround = this.lastGroundY ?? groundY;
    this.lastGroundY = groundY;
    // Ground vertical speed, limited to what driving on a real slope can produce: sideways pushes from
    // walls/collisions or a jump between surfaces must not launch the car.
    const climb = Math.hypot(this.vx, this.vz) * CONFIG.vehicle.maxGroundSlope + 1;
    const gv = Math.max(-climb, Math.min(climb, (groundY - prevGround) / dt));
    if (this.airborne) {
      this.vy -= G * dt;
      this.y += this.vy * dt;
      if (this.y <= groundY) { this.y = groundY; this.vy = gv; this.airborne = false; }
      return;
    }
    // On the ground the body follows it; it takes off when the ground falls away faster than gravity.
    if (gv < this.vy - G * dt * 1.2 && this.vy - gv > 2.5) {
      this.airborne = true;
      this.vy -= G * dt;
      this.y += this.vy * dt;
      return;
    }
    this.vy = Math.min(gv, CONFIG.vehicle.maxClimbSpeed);
    this.y = groundY;
  }

  integrate(dt, F, R, torque, fx, fz, rx, rz) {
    const s = this.spec, m = s.mass;
    const aF = F / m, aR = R / m;
    // Smoothed local accelerations drive the weight transfer.
    const k = Math.min(1, dt / CONFIG.vehicle.transferLag);
    this.axLocal += (aF - this.axLocal) * k;
    this.ayLocal += (aR - this.ayLocal) * k;
    this.vx += (aF * fx + aR * rx) * dt;
    this.vz += (aF * fz + aR * rz) * dt;
    this.yawRate += (torque / (s.inertiaYaw * CONFIG.vehicle.arcade.yawInertia)) * dt;
    // Static friction at standstill: no creeping on flat ground or with the brakes held.
    if (Math.hypot(this.vx, this.vz) < 0.05 && this.throttleEff < 0.02 && (this.slopeAcc < 0.4 || this.braking)) {
      this.vx = 0; this.vz = 0; this.yawRate *= 0.5;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.heading += this.yawRate * dt;
  }

  // Lateral limits (walls, tunnel, bridge rails, end of terrain) from the ground probe; full
  // car-wall collision response comes in stage 5 (game/collision.js).
  bounds(ground) {
    const g = ground.sample(this.x, this.z, this.ground[4], this.slotBase + 4);
    if (!g.bounded) return;
    const half = this.spec.body.width / 2;
    let push = 0;
    if (g.lat - half < g.limL) push = g.limL - (g.lat - half);
    else if (g.lat + half > g.limR) push = g.limR - (g.lat + half);
    if (!push) return;
    this.x += g.rx * push;
    this.z += g.rz * push;
    const vn = this.vx * g.rx + this.vz * g.rz;
    if (vn * push < 0 && Math.abs(vn) > this.impact) {
      this.impact = Math.abs(vn);
      this.impactNx = Math.sign(push) * g.rx;
      this.impactNz = Math.sign(push) * g.rz;
    }
    if (vn * push < 0) {
      this.vx -= g.rx * vn * 1.3;
      this.vz -= g.rz * vn * 1.3;
      this.vx *= 0.97;
      this.vz *= 0.97;
      this.yawRate *= 0.6;
    }
  }
}

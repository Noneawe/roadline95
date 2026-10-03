// Car cameras: cockpit, bumper, chase and far chase (C cycles, V looks back). External cameras follow
// with a smoothed yaw and keep clear of the terrain and of tunnel ceilings/walls via the ground probe.
import { CONFIG } from '../config.js';
import { carPoint } from '../vehicle/pose.js';
import { SURFACE_PROPS } from '../vehicle/tyres.js';
import { SLOT } from '../world/ground.js';

export const CAMERA_MODES = ['cockpit', 'bumper', 'chase', 'far'];

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class CarCameras {
  /**
   * @param {object} spec car spec @param {import('../world/ground.js').GroundProbe | null} probe
   */
  constructor(spec, probe) {
    this.spec = spec;
    this.probe = probe;
    this.mode = 2;
    this.yaw = 0;
    this.time = 0;
    this.tmp = [0, 0, 0];
    this.info = {};
  }

  get name() {
    return CAMERA_MODES[this.mode];
  }

  /** True for views from inside the car (hide the own car model, show the dashboard). */
  get inside() {
    return this.mode === 0;
  }

  /** Next camera; the cockpit is skipped when `allowInside` is false (split screen). */
  next() {
    do this.mode = (this.mode + 1) % CAMERA_MODES.length;
    while (this.mode === 0 && this.allowInside === false);
  }

  /**
   * Fixed-step update of the smoothed follow yaw.
   * @param {number} dt @param {import('../vehicle/physics.js').Car} car
   */
  update(dt, car) {
    this.time += dt;
    const lag = this.mode === 3 ? CONFIG.cameras.far.lag : CONFIG.cameras.chase.lag;
    if (Math.abs(wrapAngle(car.heading - this.yaw)) > 2.5) this.yaw = car.heading;
    this.yaw += wrapAngle(car.heading - this.yaw) * Math.min(1, dt * lag);
  }

  /**
   * Writes the camera for the current mode.
   * @param {{ pos: number[], yaw: number, pitch: number }} cam @param {object} pose car pose
   * @param {import('../vehicle/physics.js').Car} car @param {boolean} lookBack
   */
  apply(cam, pose, car, lookBack) {
    const back = lookBack ? Math.PI : 0;
    if (this.mode <= 1) {
      const s = this.spec, B = CONFIG.cameras.bumper;
      const p = this.mode === 0
        ? carPoint(pose, s.seat.x, s.seat.y, s.seat.z, this.tmp)
        : carPoint(pose, 0, B.height, -(s.body.length - s.body.rearOverhang) - B.ahead, this.tmp);
      cam.pos[0] = p[0]; cam.pos[1] = p[1] + this.shake(car); cam.pos[2] = p[2];
      cam.yaw = Math.atan2(-pose.b[0], pose.b[2]) + back;
      cam.pitch = lookBack ? Math.asin(pose.b[1]) : -Math.asin(pose.b[1]);
      // Inside views roll with the body (looking back mirrors the roll).
      cam.roll = lookBack ? -Math.asin(pose.r[1]) : Math.asin(pose.r[1]);
      return;
    }
    const C = this.mode === 3 ? CONFIG.cameras.far : CONFIG.cameras.chase, yaw = this.yaw + back;
    const tx = car.x, ty = car.y + C.look, tz = car.z;
    cam.pos[0] = tx - Math.sin(yaw) * C.dist;
    cam.pos[2] = tz + Math.cos(yaw) * C.dist;
    cam.pos[1] = car.y + C.height;
    this.clear(cam, car);
    const dx = tx - cam.pos[0], dz = tz - cam.pos[2];
    cam.yaw = Math.atan2(dx, -dz);
    cam.pitch = Math.atan2(ty - cam.pos[1], Math.hypot(dx, dz));
    cam.roll = 0;
  }

  // Keeps external cameras above the ground, under tunnel ceilings and inside tunnel walls.
  clear(cam, car) {
    if (!this.probe) return;
    const g = this.probe.sample(cam.pos[0], cam.pos[2], this.info, SLOT.CAM), k = CONFIG.cameras.clearance;
    if (g.tunnel || this.probe.sample(car.x, car.z, this.info, SLOT.CAM_CAR).tunnel) {
      const c = this.probe.sample(cam.pos[0], cam.pos[2], this.info, SLOT.CAM), lim = c.limR - k;
      if (Math.abs(c.lat) > lim) {
        const push = Math.sign(c.lat) * (Math.abs(c.lat) - lim);
        cam.pos[0] -= c.rx * push;
        cam.pos[2] -= c.rz * push;
      }
      cam.pos[1] = Math.min(cam.pos[1], c.ceiling - k);
    }
    const y = this.probe.heightAt(cam.pos[0], cam.pos[2], SLOT.CAM, false);
    cam.pos[1] = Math.max(cam.pos[1], y + k);
  }

  // Small deterministic vertical shake on kerbs and rough surfaces (cockpit/bumper).
  shake(car) {
    let bump = 0;
    for (let i = 0; i < 4; i++) bump = Math.max(bump, SURFACE_PROPS[car.surface[i]].bump);
    const v = Math.min(1, car.speed / 30);
    return bump * v * CONFIG.cameras.shake * Math.sin(this.time * 61) * Math.sin(this.time * 23);
  }
}

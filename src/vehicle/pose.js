// Visual pose of a car from its physics state: ground-aligned basis, body roll/pitch from the
// weight transfer, model origin (rear axle centre) and points in car space. No allocation per call.
import { CONFIG } from '../config.js';

/** @returns {object} reusable pose buffers */
export function createPose() {
  return {
    r: [1, 0, 0], u: [0, 1, 0], b: [0, 0, 1], f: [0, 0, -1],
    gr: [1, 0, 0], gu: [0, 1, 0], gb: [0, 0, 1],
    origin: [0, 0, 0], ground: [0, 0, 0],
  };
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  v[0] /= l; v[1] /= l; v[2] /= l;
}

// right = forward x up, back = -forward
function basis(r, u, b, fx, fy, fz) {
  const d = fx * u[0] + fy * u[1] + fz * u[2];
  let ffx = fx - u[0] * d, ffy = fy - u[1] * d, ffz = fz - u[2] * d;
  const l = Math.hypot(ffx, ffy, ffz) || 1;
  ffx /= l; ffy /= l; ffz /= l;
  r[0] = ffy * u[2] - ffz * u[1]; r[1] = ffz * u[0] - ffx * u[2]; r[2] = ffx * u[1] - ffy * u[0];
  b[0] = -ffx; b[1] = -ffy; b[2] = -ffz;
}

/**
 * Updates the pose from a Car.
 * @param {import('./physics.js').Car} car @param {object} p pose from createPose()
 * @returns {object} p
 */
export function updatePose(car, p) {
  const n = car.groundNormal, fx = Math.sin(car.heading), fz = -Math.cos(car.heading);
  p.gu[0] = n[0]; p.gu[1] = n[1]; p.gu[2] = n[2];
  basis(p.gr, p.gu, p.gb, fx, 0, fz);
  // Body leans out of corners and pitches under braking/acceleration.
  const roll = -(car.ayLocal / car.latBoost) * CONFIG.vehicle.bodyRoll, pitch = car.axLocal * CONFIG.vehicle.bodyPitch;
  p.u[0] = p.gu[0] + p.gr[0] * roll + p.gb[0] * pitch;
  p.u[1] = p.gu[1] + p.gr[1] * roll + p.gb[1] * pitch;
  p.u[2] = p.gu[2] + p.gr[2] * roll + p.gb[2] * pitch;
  normalize(p.u);
  basis(p.r, p.u, p.b, -p.gb[0], -p.gb[1], -p.gb[2]);
  p.f[0] = -p.b[0]; p.f[1] = -p.b[1]; p.f[2] = -p.b[2];
  const back = car.spec.cgFromRear;
  p.ground[0] = car.x + p.gb[0] * back; p.ground[1] = car.y + p.gb[1] * back; p.ground[2] = car.z + p.gb[2] * back;
  p.origin[0] = p.ground[0]; p.origin[1] = p.ground[1]; p.origin[2] = p.ground[2];
  return p;
}

/**
 * World position of a point given in car model space (x right, y up, z back from the rear axle).
 * @param {object} p pose @param {number} x @param {number} y @param {number} z @param {number[]} out
 * @returns {number[]}
 */
export function carPoint(p, x, y, z, out) {
  for (let k = 0; k < 3; k++) out[k] = p.origin[k] + p.r[k] * x + p.u[k] * y + p.b[k] * z;
  return out;
}

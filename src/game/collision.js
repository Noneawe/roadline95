// Car vs static scenery collisions: oriented 2D boxes in a uniform spatial grid; the car is three
// circles along its axis. Response: push out, bounce (restitution), scrape friction and a yaw kick.
// Car-car collisions and damage come in stage 5. Pure logic, no DOM.
import { CONFIG } from '../config.js';

export class StaticColliders {
  /**
   * @param {{ x: number, z: number, c: number, s: number, hx: number, hz: number }[]} boxes
   * @param {number} [cell=16] grid cell size (m)
   */
  constructor(boxes, cell = 16) {
    this.boxes = boxes;
    this.cell = cell;
    this.grid = new Map();
    boxes.forEach((b, i) => {
      const r = Math.hypot(b.hx, b.hz);
      for (let gx = Math.floor((b.x - r) / cell); gx <= Math.floor((b.x + r) / cell); gx++) {
        for (let gz = Math.floor((b.z - r) / cell); gz <= Math.floor((b.z + r) / cell); gz++) {
          const key = gx * 73856093 ^ gz * 19349663;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(i);
        }
      }
    });
    this.hit = { nx: 0, nz: 0, pen: 0 };
  }

  /**
   * Deepest contact of a circle with the boxes in its grid cell, or null.
   * @param {number} x @param {number} z @param {number} r
   * @returns {{ nx: number, nz: number, pen: number } | null}
   */
  circle(x, z, r) {
    let best = 0;
    const c = this.cell;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++) {
      for (let gz = Math.floor((z - r) / c); gz <= Math.floor((z + r) / c); gz++) {
        const list = this.grid.get(gx * 73856093 ^ gz * 19349663);
        if (list) best = this.test(list, x, z, r, best);
      }
    }
    return best > 0 ? this.hit : null;
  }

  // Deepest penetration among the listed boxes (updates this.hit), starting from `best`.
  test(list, x, z, r, best) {
    for (const i of list) {
      const b = this.boxes[i], dx = x - b.x, dz = z - b.z;
      const lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c;
      const qx = Math.max(-b.hx, Math.min(b.hx, lx)), qz = Math.max(-b.hz, Math.min(b.hz, lz));
      const ex = lx - qx, ez = lz - qz, d = Math.hypot(ex, ez);
      let nlx, nlz, pen;
      if (d > 1e-6) {
        if (d >= r) continue;
        nlx = ex / d; nlz = ez / d; pen = r - d;
      } else {
        // Centre inside the box: leave along the shallowest axis.
        const px = b.hx - Math.abs(lx), pz = b.hz - Math.abs(lz);
        if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; pen = px + r; } else { nlx = 0; nlz = Math.sign(lz) || 1; pen = pz + r; }
      }
      if (pen > best) {
        best = pen;
        this.hit.nx = nlx * b.c + nlz * b.s;
        this.hit.nz = -nlx * b.s + nlz * b.c;
        this.hit.pen = pen;
      }
    }
    return best;
  }
}

const OFFSETS = [-1, 0, 1];

/**
 * Resolves the car against static boxes (call after each physics step). Raises car.impact (m/s) and
 * its normal (car.impactNx/Nz) to the strongest hit since the caller last reset car.impact.
 * @param {import('../vehicle/physics.js').Car} car @param {StaticColliders} world
 */
export function collideCarStatic(car, world) {
  const s = car.spec, r = s.body.width / 2, C = CONFIG.collision;
  const fx = Math.sin(car.heading), fz = -Math.cos(car.heading), rx = -fz, rz = fx;
  // Circle centres along the body: front and rear circles touch the bumpers.
  const front = s.body.length - s.body.rearOverhang - s.cgFromRear, back = s.body.rearOverhang + s.cgFromRear;
  for (const k of OFFSETS) {
    const off = k > 0 ? front - r : k < 0 ? -(back - r) : (front - back) / 2;
    const hit = world.circle(car.x + fx * off, car.z + fz * off, r);
    if (!hit) continue;
    car.x += hit.nx * hit.pen;
    car.z += hit.nz * hit.pen;
    const vn = car.vx * hit.nx + car.vz * hit.nz;
    if (vn >= 0) continue;
    const j = -(1 + C.restitution) * vn;
    car.vx += hit.nx * j;
    car.vz += hit.nz * j;
    // Scrape: lose some speed along the obstacle, more for harder hits.
    const keep = 1 - Math.min(C.maxScrape, C.scrape * j);
    car.vx *= keep;
    car.vz *= keep;
    // Off-centre hits turn the car (angular impulse = lever x impulse, scaled down for playability).
    const jr = j * (hit.nx * rx + hit.nz * rz);
    car.yawRate += (off * jr * s.mass * C.spin) / (s.inertiaYaw * CONFIG.vehicle.arcade.yawInertia);
    if (j > car.impact) { car.impact = j; car.impactNx = hit.nx; car.impactNz = hit.nz; }
  }
}

/**
 * Cross walls where the drivable width narrows abruptly (tunnel portals, bridge abutments, the ends of
 * side walls): boxes across the verge just outside the narrow section, so a car running along the
 * verge hits a face instead of being shoved sideways by the lateral limit. Sprints also get a wall
 * across each end of the road.
 * @param {import('../world/track.js').Track} track @param {import('../world/terrain.js').Terrain} terrain
 * @param {{ SEG: object, frameAt: Function }} world track helpers (passed in to keep this module data-only)
 * @returns {{ x: number, z: number, c: number, s: number, hx: number, hz: number }[]}
 */
export function narrowingWalls(track, terrain, { SEG, frameAt }) {
  const boxes = [], e = terrain.edgeLat, W = 12, f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
  // [flag, sides, inner lateral, shift]: tunnels narrow one segment early (the verge rises to the portal).
  const n = track.segments, kinds = [
    [SEG.TUNNEL, [-1, 1], e, 1],
    [SEG.BRIDGE, [-1, 1], e, 0],
    [SEG.WALL_L, [-1], e + 0.3, 0],
    [SEG.WALL_R, [1], e + 0.3, 0],
  ];
  for (const [flag, sides, inner, shift] of kinds) {
    for (let i = 0; i < n; i++) {
      const prev = track.closed ? (i + n - 1) % n : i - 1;
      if (prev < 0) continue;
      const a = (track.seg[prev] & flag) !== 0, b = (track.seg[i] & flag) !== 0;
      if (a === b) continue;
      // Boundary at sample i (moved `shift` segments outwards); the box sits on the open side of it.
      frameAt(track, (b ? i - shift : i + shift) * track.ds, f);
      const rl = Math.hypot(f.right[0], f.right[2]), rx = f.right[0] / rl, rz = f.right[2] / rl;
      const out = b ? -1 : 1;
      for (const side of sides) {
        const lat = side * (inner + W / 2);
        boxes.push({
          x: f.pos[0] + rx * lat - rz * out * 0.6, z: f.pos[2] + rz * lat + rx * out * 0.6,
          c: rx, s: -rz, hx: W / 2, hz: 0.6,
        });
      }
    }
  }
  // Sprint: walls across both ends of the road.
  if (!track.closed) {
    for (const s of [0.5, track.length - 0.5]) {
      frameAt(track, s, f);
      const rl = Math.hypot(f.right[0], f.right[2]), rx = f.right[0] / rl, rz = f.right[2] / rl, out = s < 1 ? -1 : 1;
      boxes.push({ x: f.pos[0] - rz * out * 0.6, z: f.pos[2] + rx * out * 0.6, c: rx, s: -rz, hx: e + W, hz: 0.6 });
    }
  }
  return boxes;
}

/**
 * Car vs car: three circles per car, separation by mass ratio (no overlap left), impulse along the
 * contact normal with restitution, friction and yaw kicks. `ghost` cars (just reset) and `parked` cars
 * (finished a sprint) are skipped.
 * Records the strongest impact per car and its direction (car.impact, car.impactNx/Nz) for damage.
 * @param {{ car: import('../vehicle/physics.js').Car, ghost: number, parked?: boolean }[]} cars
 */
export function collideCars(cars) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const A = cars[i], B = cars[j];
      if (A.ghost > 0 || B.ghost > 0 || A.parked || B.parked) continue;
      const a = A.car, b = B.car;
      if (Math.abs(a.x - b.x) > 7 || Math.abs(a.z - b.z) > 7) continue;
      pairContact(a, b);
    }
  }
}

const OFF_A = new Float64Array(3), OFF_B = new Float64Array(3);

function circles(car, out) {
  const s = car.spec, r = s.body.width / 2;
  const front = s.body.length - s.body.rearOverhang - s.cgFromRear, back = s.body.rearOverhang + s.cgFromRear;
  out[0] = -(back - r); out[1] = (front - back) / 2; out[2] = front - r;
  return r;
}

function pairContact(a, b) {
  const ra = circles(a, OFF_A), rb = circles(b, OFF_B), C = CONFIG.collision;
  const afx = Math.sin(a.heading), afz = -Math.cos(a.heading), bfx = Math.sin(b.heading), bfz = -Math.cos(b.heading);
  let best = 0, nx = 0, nz = 0, la = 0, lb = 0;
  for (let i = 0; i < 3; i++) {
    const ax = a.x + afx * OFF_A[i], az = a.z + afz * OFF_A[i];
    for (let k = 0; k < 3; k++) {
      const dx = ax - (b.x + bfx * OFF_B[k]), dz = az - (b.z + bfz * OFF_B[k]), d = Math.hypot(dx, dz);
      const pen = ra + rb - d;
      if (pen > best) { best = pen; nx = d > 1e-6 ? dx / d : 1; nz = d > 1e-6 ? dz / d : 0; la = OFF_A[i]; lb = OFF_B[k]; }
    }
  }
  if (best <= 0) return;
  const ma = a.spec.mass, mb = b.spec.mass, inv = 1 / ma + 1 / mb;
  a.x += nx * best * (1 / ma) / inv; a.z += nz * best * (1 / ma) / inv;
  b.x -= nx * best * (1 / mb) / inv; b.z -= nz * best * (1 / mb) / inv;
  const vn = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (vn >= 0) return;
  const j = (-(1 + C.carRestitution) * vn) / inv;
  a.vx += (nx * j) / ma; a.vz += (nz * j) / ma;
  b.vx -= (nx * j) / mb; b.vz -= (nz * j) / mb;
  // Side-swipe friction: equalise tangential speeds a little.
  const tx = -nz, tz = nx, vt = (a.vx - b.vx) * tx + (a.vz - b.vz) * tz, ft = Math.min(Math.abs(vt), (j / inv) * C.carFriction) * Math.sign(vt);
  a.vx -= (tx * ft) / (ma * inv); a.vz -= (tz * ft) / (ma * inv);
  b.vx += (tx * ft) / (mb * inv); b.vz += (tz * ft) / (mb * inv);
  const yawI = (car) => car.spec.inertiaYaw * CONFIG.vehicle.arcade.yawInertia;
  a.yawRate += (la * (j * (nx * -afz + nz * afx)) * C.spin) / yawI(a);
  b.yawRate -= (lb * (j * (nx * -bfz + nz * bfx)) * C.spin) / yawI(b);
  const dv = -vn;
  note(a, dv, nx, nz);
  note(b, dv, -nx, -nz);
}

// Remembers the strongest impact of the step; normal points from the obstacle into the car.
function note(car, speed, nx, nz) {
  if (speed > (car.impact || 0)) {
    car.impact = speed;
    car.impactNx = nx;
    car.impactNz = nz;
  }
}

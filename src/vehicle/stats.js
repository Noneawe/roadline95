// Showroom figures of a car: peak power (incl. turbo boost), mass, drive, gears and the measured
// 0-100 km/h and top speed from the physics model on flat asphalt (cached per car). Pure, no DOM.
import { Car } from './physics.js';
import { torqueAt } from './drivetrain.js';

const cache = new Map();
const DT = 1 / 120;
const FLAT = { sample: (x, z, o) => { o.y = 0; o.nx = 0; o.ny = 1; o.nz = 0; o.surface = 0; o.bounded = false; return o; } };

/**
 * @param {object} spec car spec
 * @returns {{ hp: number, kw: number, mass: number, drive: string, gears: number, turbo: boolean, zeroTo100: number,
 *   zeroTo60: number, vmax: number }} vmax in m/s; 0-100 km/h and 0-60 mph in s
 */
export function carStats(spec) {
  if (cache.has(spec.id)) return cache.get(spec.id);
  const e = spec.engine, boost = spec.turbo ? 1 + spec.turbo.gain : 1;
  let watts = 0;
  for (let rpm = e.idle; rpm <= e.limiter; rpm += 50) watts = Math.max(watts, torqueAt(e.torque, rpm) * boost * ((rpm * 2 * Math.PI) / 60));
  const car = new Car(spec), c = { throttle: 1, brake: 0, steer: 0, handbrake: false, gearUp: false, gearDown: false, analog: true };
  let t = 0, zeroTo100 = 0, zeroTo60 = 0;
  for (; t < 30 && !zeroTo100; t += DT) {
    car.step(DT, c, FLAT);
    if (!zeroTo60 && car.speed >= 60 / 2.23694) zeroTo60 = t;
    if (car.speed >= 100 / 3.6) zeroTo100 = t;
  }
  let last = 0;
  for (let k = 0; k < 120 / DT; k++) {
    car.step(DT, c, FLAT);
    if (k % 240 === 0) { if (Math.abs(car.speed - last) < 0.05) break; last = car.speed; }
  }
  const out = {
    hp: Math.round(watts / 745.7), kw: Math.round(watts / 1000), mass: spec.mass, drive: spec.drive.type,
    gears: spec.gearbox.ratios.length, turbo: !!spec.turbo, zeroTo100, zeroTo60, vmax: car.speed,
  };
  cache.set(spec.id, out);
  return out;
}

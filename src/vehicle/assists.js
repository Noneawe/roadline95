// Driving assists (CLAUDE.md 12): automatic braking before corners for beginners. Traction control lives
// in physics.js (throttle cut on wheelspin). Pure logic, no DOM.
import { CONFIG } from '../config.js';

/**
 * Safe speed (m/s) for the next stretch of track: min over sqrt(mu * g * R) with braking room.
 * @param {import('../world/track.js').Track} track @param {number} s distance along the track
 * @param {number} grip assumed lateral grip in m/s^2
 * @returns {number}
 */
export function safeSpeed(track, s, grip) {
  const look = CONFIG.vehicle.autoBrakeLook, decel = grip * 0.8;
  let v = Infinity;
  for (let d = 0; d <= look; d += 10) {
    const i = Math.round((((s + d) % track.length) + track.length) % track.length / track.ds) % track.count;
    const k = Math.abs(track.curvature[i]);
    if (k < 1e-5) continue;
    v = Math.min(v, Math.sqrt(grip / k + 2 * decel * d));
  }
  return v;
}

/**
 * Applies automatic braking to a controls object in place (cuts throttle, adds brake when too fast).
 * @param {{ throttle: number, brake: number }} c @param {number} speed current speed (m/s)
 * @param {number} target safe speed (m/s)
 */
export function applyAutoBrake(c, speed, target) {
  const over = speed - target;
  if (over <= 0) return;
  c.throttle = Math.min(c.throttle, Math.max(0, 1 - over / 3));
  c.brake = Math.max(c.brake, Math.min(1, over / 8));
}

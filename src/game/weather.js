// Weather (CLAUDE.md stage 8): rain and fog presets combined with the time of day into the render
// conditions (fog colour and range, light, sky panorama) and the gameplay effect (wet grip, rain level).
// Pure data, no DOM.
import { CONFIG } from '../config.js';

export const WEATHERS = ['clear', 'rain', 'fog'];

/**
 * Render and gameplay conditions for a time of day and weather.
 * @param {string} time key of CONFIG.times @param {string} weather 'clear' | 'rain' | 'fog'
 * @returns {{ fog: number[], fogStart: number, fogEnd: number, ambient: number, diffuse: number, sky: string,
 *   wet: number, rain: number, night: boolean, dir: number[] }}
 */
export function weatherConditions(time, weather) {
  const t = CONFIG.times[time] || CONFIG.times.day, w = CONFIG.weather[weather] || CONFIG.weather.clear;
  // Overcast fog: the time-of-day fog brightness, desaturated towards grey (tint) and darkened.
  const lum = 0.3 * t.fog[0] + 0.59 * t.fog[1] + 0.11 * t.fog[2];
  const fog = t.fog.map((c, k) => Math.round((c * (1 - w.desaturate) + lum * w.tint[k] * w.desaturate) * w.fogBright));
  return {
    fog, fogStart: Math.min(t.fogStart, w.fogStart ?? Infinity) * (w.fogScale ?? 1), fogEnd: Math.min(t.fogEnd, w.fogEnd ?? Infinity) * (w.fogScale ?? 1),
    ambient: t.ambient * w.ambient, diffuse: t.diffuse * w.diffuse, sky: w.overcast && !t.night ? 'overcast' : t.sky,
    wet: w.wet, rain: w.rain, night: t.night, dir: t.dir,
  };
}

/**
 * Grip factor of a car's tyres on a wet road (1 = dry).
 * @param {object} spec car spec @param {number} wet 0..1
 * @returns {number}
 */
export function wetGripFactor(spec, wet) {
  return 1 - wet * (1 - (spec.tyres.wetGrip ?? CONFIG.vehicle.wetGrip));
}

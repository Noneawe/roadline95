// World render environment (light, fog, LOD, projection) assembled from CONFIG for the renderer, and
// the per-scene view setup (colormap, sky panorama, clear colour) for a time of day and weather.
import { CONFIG } from '../config.js';
import { MAX_LIGHTS } from '../gfx/renderer.js';
import { weatherConditions } from '../game/weather.js';
import { getColormap } from '../gfx/colormap.js';
import { nearestIndex } from '../gfx/palette.js';
import { generateSky } from '../texgen/sky.js';

/**
 * @param {{ sky?: boolean, time?: string, weather?: string }} [opts] time: 'day' | 'dusk' | 'night' (CONFIG.times),
 *   default day; weather: 'clear' | 'rain' | 'fog' (game/weather.js)
 * @returns {import('../gfx/renderer.js').Env}
 */
export function createEnv(opts = {}) {
  const t = opts.time ? weatherConditions(opts.time, opts.weather || 'clear') : null;
  return {
    lightDir: t ? t.dir : CONFIG.light.dir, ambient: t ? t.ambient : CONFIG.light.ambient,
    diffuse: t ? t.diffuse : CONFIG.light.diffuse,
    fogStart: t ? t.fogStart : CONFIG.fog.start, fogEnd: t ? t.fogEnd : CONFIG.fog.end, lodTexels: CONFIG.tex.lodTexels,
    night: !!(t && t.night), sky: !!opts.sky,
    fovY: CONFIG.render.fovY, near: CONFIG.render.near, far: CONFIG.render.far, detailFar: CONFIG.render.detailFar,
    time: 0, hlCount: 0, hlPos: new Float32Array(MAX_LIGHTS * 4), hlDir: new Float32Array(MAX_LIGHTS * 4),
    hlShape: [Math.cos((CONFIG.headlights.outerDeg * Math.PI) / 180), Math.cos((CONFIG.headlights.innerDeg * Math.PI) / 180), CONFIG.headlights.gain],
  };
}

/**
 * Sets the renderer's colormap and sky for a time of day and weather; returns the view for main.js.
 * @param {import('../gfx/renderer.js').Renderer} renderer @param {Uint8Array} pal @param {string} time @param {string} weather
 * @returns {{ env: object, clearIndex: number, colormap: Uint8Array }}
 */
export function setupView(renderer, pal, time, weather) {
  const wc = weatherConditions(time, weather);
  const colormap = getColormap(`${time}-${weather}`, pal, wc.fog, CONFIG.colormap.lightOne);
  const clearIndex = nearestIndex(pal, ...wc.fog);
  renderer.setColormap(colormap);
  renderer.setSky(generateSky(wc.sky, CONFIG.seed, clearIndex));
  return { env: createEnv({ sky: true, time, weather }), clearIndex, colormap };
}

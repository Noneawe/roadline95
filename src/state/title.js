// Title screen: the game engine flies a camera over a track at dusk (high sweeping flyover) while the
// colour-cycled ROADLINE '95 logo and "PRESS ENTER OR TAP" sit in the overlay.
import { frameAt } from '../world/track.js';
import { SLOT } from '../world/ground.js';
import { buildTrackWorld } from './trackTest.js';
import { setupView } from './env.js';
import { drawLogo, centerText, UI, uiScale } from './ui.js';
import { CHAR_H } from '../gfx/font.js';

/**
 * @param {import('../gfx/renderer.js').Renderer} renderer @param {Map<string, number>} layers @param {Uint8Array} pal
 * @param {object} trackDef
 */
export function createTitle(renderer, layers, pal, trackDef) {
  renderer.clearMeshes();
  const view = setupView(renderer, pal, 'dusk', 'clear');
  const world = buildTrackWorld(renderer, layers, trackDef);
  const { track, probe } = world;
  const camera = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };
  const here = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] }, look = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
  let t = 0;
  return {
    view, camera, items: world.items, track,
    /** @param {number} dt */
    update(dt) { t += dt; },
    // Camera glides along the track 14-30 m up, swinging from side to side, looking ahead and down.
    prepare() {
      const s = 30 + t * 22, side = Math.sin(t * 0.13) * 26, up = 22 + Math.sin(t * 0.21) * 8;
      frameAt(track, s, here);
      frameAt(track, s + 70, look);
      const rl = Math.hypot(here.right[0], here.right[2]);
      camera.pos[0] = here.pos[0] + (here.right[0] / rl) * side;
      camera.pos[2] = here.pos[2] + (here.right[2] / rl) * side;
      probe.hints[SLOT.CAM] = -1;
      camera.pos[1] = Math.max(here.pos[1], probe.heightAt(camera.pos[0], camera.pos[2], SLOT.CAM, false)) + up;
      const dx = look.pos[0] - camera.pos[0], dz = look.pos[2] - camera.pos[2], dy = look.pos[1] - camera.pos[1];
      camera.yaw = Math.atan2(dx, -dz);
      camera.pitch = Math.atan2(dy, Math.hypot(dx, dz));
      camera.roll = Math.sin(t * 0.13) * 0.06;
    },
    /** Logo and prompt. @param {import('../gfx/overlay.js').Overlay} ov @param {boolean} prompt */
    drawLogo(ov, prompt) {
      drawLogo(ov, Math.round(ov.h * 0.18), t);
      if (prompt && Math.floor(t * 2) % 2 === 0) centerText(ov, 'PRESS ENTER OR TAP', ov.h * 0.72, UI.text, uiScale(ov));
      if (prompt) centerText(ov, '(C) 1995 ROADLINE TEAM', ov.h - CHAR_H - 6, UI.dim);
    },
  };
}

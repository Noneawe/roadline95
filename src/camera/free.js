// Free debug camera: arrows/WASD move and turn, Q/E strafe, R/F climb, PgUp/PgDn pitch, Shift = fast.
import { CONFIG } from '../config.js';

const KEYS = {
  right: ['ArrowRight', 'KeyD'], left: ['ArrowLeft', 'KeyA'], fwd: ['ArrowUp', 'KeyW'], back: ['ArrowDown', 'KeyS'],
  up: ['PageUp'], down: ['PageDown'], strafeR: ['KeyE'], strafeL: ['KeyQ'], climb: ['KeyR'], sink: ['KeyF'],
  fast: ['ShiftLeft', 'ShiftRight'],
};

/**
 * 1 if any of the key codes is held, else 0.
 * @param {import('../engine/input.js').Keyboard} kb @param {string[]} codes
 * @returns {number}
 */
export function anyHeld(kb, codes) {
  for (const c of codes) if (kb.held(c)) return 1;
  return 0;
}

/**
 * Moves a { pos, yaw, pitch } camera from held keys.
 * @param {{ pos: number[], yaw: number, pitch: number }} cam @param {number} dt
 * @param {import('../engine/input.js').Keyboard} kb
 */
export function moveFreeCamera(cam, dt, kb) {
  const C = CONFIG.camera;
  const fast = anyHeld(kb, KEYS.fast) ? C.fastFactor : 1;
  cam.yaw += (anyHeld(kb, KEYS.right) - anyHeld(kb, KEYS.left)) * C.turnSpeed * dt;
  const pitch = cam.pitch + (anyHeld(kb, KEYS.up) - anyHeld(kb, KEYS.down)) * C.turnSpeed * dt;
  cam.pitch = Math.max(-1.4, Math.min(1.4, pitch));
  const fwd = (anyHeld(kb, KEYS.fwd) - anyHeld(kb, KEYS.back)) * C.moveSpeed * fast * dt;
  const side = (anyHeld(kb, KEYS.strafeR) - anyHeld(kb, KEYS.strafeL)) * C.moveSpeed * fast * dt;
  cam.pos[0] += Math.sin(cam.yaw) * fwd + Math.cos(cam.yaw) * side;
  cam.pos[2] += -Math.cos(cam.yaw) * fwd + Math.sin(cam.yaw) * side;
  const climb = (anyHeld(kb, KEYS.climb) - anyHeld(kb, KEYS.sink)) * C.climbSpeed * fast * dt;
  cam.pos[1] = Math.max(0.3, cam.pos[1] + climb);
}

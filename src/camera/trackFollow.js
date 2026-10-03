// Track-following camera (stage 2 preview): drives along the centreline at adjustable speed and lateral
// offset, looking a few metres ahead. Up/Down = speed, Left/Right = lateral offset.
import { CONFIG } from '../config.js';
import { frameAt } from '../world/track.js';
import { anyHeld } from './free.js';

const KEYS = { faster: ['ArrowUp', 'KeyW'], slower: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'] };
const frame = () => ({ pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] });

export class TrackCamera {
  /** @param {import('../world/track.js').Track} track @param {number} s start distance */
  constructor(track, s) {
    this.track = track;
    this.s = track.closed ? ((s % track.length) + track.length) % track.length : s;
    this.speed = CONFIG.trackCam.speed;
    this.lateral = 0;
    this.here = frame();
    this.ahead = frame();
  }

  /** @param {number} dt @param {import('../engine/input.js').Keyboard} kb */
  update(dt, kb) {
    const C = CONFIG.trackCam, hw = this.track.def.width / 2 - 1;
    this.speed = Math.max(0, Math.min(C.maxSpeed, this.speed + (anyHeld(kb, KEYS.faster) - anyHeld(kb, KEYS.slower)) * C.accel * dt));
    this.lateral = Math.max(-hw, Math.min(hw, this.lateral + (anyHeld(kb, KEYS.right) - anyHeld(kb, KEYS.left)) * C.lateralSpeed * dt));
    this.s += this.speed * dt;
    if (this.track.closed) this.s = ((this.s % this.track.length) + this.track.length) % this.track.length;
    else this.s = Math.min(this.s, this.track.length);
  }

  /** Writes position and orientation into a { pos, yaw, pitch } camera. */
  apply(cam) {
    const C = CONFIG.trackCam, h = frameAt(this.track, this.s, this.here), a = frameAt(this.track, this.s + C.lookAhead, this.ahead);
    for (let k = 0; k < 3; k++) {
      cam.pos[k] = h.pos[k] + h.right[k] * this.lateral + h.up[k] * C.height;
    }
    const dx = a.pos[0] + a.right[0] * this.lateral - cam.pos[0];
    const dz = a.pos[2] + a.right[2] * this.lateral - cam.pos[2];
    const dy = a.pos[1] + a.up[1] * C.height * 0.8 - cam.pos[1];
    cam.yaw = Math.atan2(dx, -dz);
    cam.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
}

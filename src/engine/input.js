// Input: keyboard state tracker (held keys + per-frame presses by KeyboardEvent.code), per-player
// action mapping (CLAUDE.md 14) from keyboard, gamepads and touch controls, the pointer (mouse / touch,
// in overlay pixels) and menu navigation events.
import { CONFIG } from '../config.js';

// Keys whose browser default (help, reload, scrolling) must not fire during play.
const BLOCKED = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown']);

export class Keyboard {
  /** @param {EventTarget} target */
  constructor(target) {
    this.down = new Set();
    this.pressed = new Set();
    this.typed = new Set();
    target.addEventListener('keydown', (e) => {
      if (BLOCKED.has(e.code)) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.typed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.down.clear());
  }

  /** @param {string} code @returns {boolean} */
  held(code) {
    return this.down.has(code);
  }

  /** True once per physical press; cleared by endFrame(). @param {string} code @returns {boolean} */
  hit(code) {
    return this.pressed.has(code);
  }

  /** Press or auto-repeat (menu navigation). @param {string} code @returns {boolean} */
  typedKey(code) {
    return this.typed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.typed.clear();
  }
}

/** Keyboard layouts per player; `solo` keys are added when only one player is playing. */
const KEYMAP = [
  {
    throttle: ['ArrowUp'], brake: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], handbrake: ['Space'],
    gearUp: ['Period'], gearDown: ['Comma'], camera: ['KeyC'], lookBack: ['KeyV'], radio: ['KeyR'], pause: ['Escape'],
    solo: { throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'] },
  },
  {
    throttle: ['KeyW'], brake: ['KeyS'], left: ['KeyA'], right: ['KeyD'], handbrake: ['ShiftLeft'],
    gearUp: ['KeyE'], gearDown: ['KeyQ'], camera: ['Digit1'], lookBack: ['Digit2'], radio: [], pause: ['Escape'],
  },
];

// Standard gamepad mapping indices.
const PAD = { A: 0, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, R3: 11 };
const btn = (p, i) => (p.buttons[i] ? p.buttons[i].value : 0);

/**
 * @typedef {object} Actions
 * @property {number} throttle @property {number} brake @property {number} steer -1..1
 * @property {boolean} analog @property {boolean} handbrake @property {boolean} gearUp @property {boolean} gearDown
 * @property {boolean} camera @property {boolean} lookBack @property {boolean} radio @property {boolean} pause
 */

/** Actions of one player, refreshed by poll() once per fixed update. */
export class PlayerInput {
  /**
   * @param {Keyboard} kb @param {number} player 0 or 1 @param {boolean} solo single-player (adds WASD for player 1)
   * @param {number} deadzone analog stick dead zone
   */
  constructor(kb, player, solo, deadzone) {
    this.kb = kb;
    this.map = KEYMAP[player];
    this.solo = solo && player === 0;
    this.pad = player;
    this.deadzone = deadzone;
    this.prevButtons = new Uint8Array(17);
    /** @type {Actions} */
    this.state = {
      throttle: 0, brake: 0, steer: 0, analog: false, handbrake: false,
      gearUp: false, gearDown: false, camera: false, lookBack: false, radio: false, pause: false,
    };
  }

  /** Reads keyboard and gamepad into `state`. */
  poll() {
    const s = this.state;
    s.throttle = this.held('throttle') ? 1 : 0;
    s.brake = this.held('brake') ? 1 : 0;
    s.steer = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    s.analog = false;
    s.handbrake = this.held('handbrake');
    s.lookBack = this.held('lookBack');
    s.gearUp = this.hit('gearUp');
    s.gearDown = this.hit('gearDown');
    s.camera = this.hit('camera');
    s.radio = this.hit('radio');
    s.pause = this.hit('pause');
    this.pollPad(s);
    if (this.touch) this.touch.merge(s);
    return s;
  }

  pollPad(s) {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    const p = pads && pads[this.pad ^ (CONFIG.input.padSwap ? 1 : 0)];
    if (!p || !p.connected) return;
    const x = p.axes[0] || 0, dz = this.deadzone;
    const stick = Math.abs(x) < dz ? 0 : Math.sign(x) * ((Math.abs(x) - dz) / (1 - dz));
    if (stick) { s.steer = stick; s.analog = true; }
    s.throttle = Math.max(s.throttle, btn(p, PAD.RT));
    s.brake = Math.max(s.brake, btn(p, PAD.LT));
    s.handbrake ||= btn(p, PAD.A) > 0.5;
    s.lookBack ||= btn(p, PAD.R3) > 0.5;
    s.gearUp ||= this.edge(p, PAD.RB);
    s.gearDown ||= this.edge(p, PAD.LB);
    s.camera ||= this.edge(p, PAD.Y);
    s.radio ||= this.edge(p, PAD.SELECT);
    s.pause ||= this.edge(p, PAD.START);
  }

  // Button press edge (down this poll, up the previous one).
  edge(p, i) {
    const down = btn(p, i) > 0.5 ? 1 : 0, was = this.prevButtons[i];
    this.prevButtons[i] = down;
    return down === 1 && was === 0;
  }

  held(action) {
    for (const k of this.map[action]) if (this.kb.held(k)) return true;
    if (this.solo && this.map.solo[action]) for (const k of this.map.solo[action]) if (this.kb.held(k)) return true;
    return false;
  }

  hit(action) {
    for (const k of this.map[action]) if (this.kb.hit(k)) return true;
    return false;
  }
}

/**
 * Mouse and touch on the canvas, in overlay pixels (the 4:3 letterbox of the present pass). Keeps
 * the active touch points for the on-screen controls and a click edge for menus.
 */
export class Pointer {
  /** @param {HTMLElement} el canvas @param {() => { w: number, h: number }} size overlay size */
  constructor(el, size) {
    this.el = el;
    this.size = size;
    this.x = -1;
    this.y = -1;
    this.moved = false;
    this.clicked = false;
    this.touches = new Map();
    this.touched = false;
    const map = (e, out) => {
      const r = el.getBoundingClientRect(), sc = Math.min(r.width / 4, r.height / 3), vw = sc * 4, vh = sc * 3;
      const { w, h } = this.size();
      out.x = ((e.clientX - r.left - (r.width - vw) / 2) / vw) * w;
      out.y = ((e.clientY - r.top - (r.height - vh) / 2) / vh) * h;
      return out;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') { this.touched = true; this.touches.set(e.pointerId, map(e, { x: 0, y: 0 })); }
      map(e, this);
      this.clicked = true;
      this.moved = true;
    });
    el.addEventListener('pointermove', (e) => {
      if (this.touches.has(e.pointerId)) map(e, this.touches.get(e.pointerId));
      map(e, this);
      this.moved = true;
    });
    const up = (e) => this.touches.delete(e.pointerId);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Clears the per-frame edges. */
  endFrame() {
    this.clicked = false;
    this.moved = false;
  }
}

const NAV_KEYS = {
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  ok: ['Enter', 'NumpadEnter', 'Space'], back: ['Escape', 'Backspace'],
};
// Standard gamepad: A confirm, B back, Start confirm, d-pad 12..15.
const PAD_NAV = { ok: [0, 9], back: [1], up: [12], down: [13], left: [14], right: [15] };

/** Menu navigation from keyboard (with auto-repeat), every gamepad and the pointer. */
export class MenuInput {
  /** @param {Keyboard} kb @param {Pointer | null} pointer */
  constructor(kb, pointer) {
    this.kb = kb;
    this.pointer = pointer;
    this.prev = new Uint8Array(4 * 17);
    this.repeat = new Float32Array(4 * 4);
    this.held = new Uint8Array(4 * 4);
    /** @type {import('../state/ui.js').Nav} */
    this.nav = { up: false, down: false, left: false, right: false, ok: false, back: false, px: -1, py: -1, moved: false, click: false };
  }

  /** @param {number} dt @returns {import('../state/ui.js').Nav} */
  poll(dt) {
    const n = this.nav;
    for (const k in NAV_KEYS) n[k] = NAV_KEYS[k].some((c) => (k === 'ok' || k === 'back' ? this.kb.hit(c) : this.kb.typedKey(c)));
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < Math.min(4, pads.length); i++) {
      const p = pads[i];
      if (!p || !p.connected) continue;
      for (const k in PAD_NAV) for (const b of PAD_NAV[k]) if (this.edge(p, i, b)) n[k] = true;
      // Left stick with repeat while held.
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0, dirs = [ay < -0.6, ay > 0.6, ax < -0.6, ax > 0.6], keys = ['up', 'down', 'left', 'right'];
      for (let d = 0; d < 4; d++) {
        const r = i * 4 + d;
        if (!dirs[d]) { this.held[r] = 0; continue; }
        // First push fires at once; holding repeats after 0.4 s, then every 0.12 s.
        if (!this.held[r]) { n[keys[d]] = true; this.held[r] = 1; this.repeat[r] = 0.4; continue; }
        this.repeat[r] -= dt;
        if (this.repeat[r] <= 0) { n[keys[d]] = true; this.repeat[r] = 0.12; }
      }
    }
    const pt = this.pointer;
    n.moved = !!pt && pt.moved;
    n.click = !!pt && pt.clicked;
    n.px = pt ? pt.x : -1;
    n.py = pt ? pt.y : -1;
    return n;
  }

  edge(p, i, b) {
    const down = p.buttons[b] && p.buttons[b].pressed ? 1 : 0, k = i * 17 + b, was = this.prev[k];
    this.prev[k] = down;
    return down === 1 && was === 0;
  }
}

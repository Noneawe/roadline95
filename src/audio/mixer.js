// Audio mixer: one AudioContext created on the first user gesture, buses (music, sfx, engine, ambient,
// voice) into a master gain, a tunnel reverb send (ConvolverNode with a procedural impulse) and the
// sample bank converted to AudioBuffers. Every Web Audio call is guarded: audio errors never stop the game.
import { CONFIG } from '../config.js';
import { CARS } from '../vehicle/cars.js';
import { generateSamples, tunnelImpulse, SAMPLE_RATE } from './samplegen.js';

export const BUSES = ['music', 'sfx', 'engine', 'ambient', 'voice'];

export class Mixer {
  /** @param {{ muted: boolean, seed: number }} o */
  constructor(o) {
    this.muted = o.muted;
    this.seed = o.seed;
    this.ctx = null;
    this.samples = new Map();
    this.buffers = new Map();
    this.buses = new Map();
    this.listeners = [];
    this.reverbLevel = 0;
    // Bus volumes chosen in the options (kept until the context exists).
    this.levels = {};
    this.forceMute = o.muted;
  }

  /**
   * Waits for the first key/pointer/touch event, then starts audio (browsers require a gesture).
   * @param {EventTarget} target @param {() => void} onReady called once the context runs
   */
  armOnGesture(target, onReady) {
    const start = () => {
      for (const ev of ['keydown', 'pointerdown', 'touchstart']) target.removeEventListener(ev, start);
      if (this.init()) onReady();
    };
    for (const ev of ['keydown', 'pointerdown', 'touchstart']) target.addEventListener(ev, start);
  }

  /** Generates the sample bank (about 0.4 s of CPU; call when idle, before the first gesture). */
  prepare() {
    if (!this.samples.size) this.samples = generateSamples(CARS, this.seed);
  }

  /** Creates the context, buses and buffers. @returns {boolean} audio available */
  init() {
    if (this.ctx) return true;
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      const ctx = new AC(), A = CONFIG.audio;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : A.master;
      // Peak limiter on the output: engines, effects and music together never clip.
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -6;
      this.limiter.knee.value = 4;
      this.limiter.ratio.value = 12;
      this.limiter.attack.value = 0.003;
      this.limiter.release.value = 0.15;
      this.master.connect(this.limiter).connect(ctx.destination);
      // Reverb send for sfx and engine (tunnels); wet level follows setReverb().
      this.reverb = ctx.createConvolver();
      const ir = tunnelImpulse(this.seed, ctx.sampleRate), irBuf = ctx.createBuffer(1, ir.length, ctx.sampleRate);
      irBuf.copyToChannel(ir, 0);
      this.reverb.buffer = irBuf;
      this.wet = ctx.createGain();
      this.wet.gain.value = 0;
      this.reverb.connect(this.wet).connect(this.master);
      for (const name of BUSES) {
        const g = ctx.createGain();
        g.gain.value = this.levels[name] ?? A.volume[name];
        g.connect(this.master);
        if (name === 'sfx' || name === 'engine') g.connect(this.reverb);
        this.buses.set(name, g);
      }
      this.prepare();
      for (const [name, s] of this.samples) {
        const b = ctx.createBuffer(1, s.data.length, SAMPLE_RATE);
        b.copyToChannel(s.data, 0);
        this.buffers.set(name, b);
      }
      this.ctx = ctx;
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  /** @param {string} name @returns {AudioNode} */
  bus(name) {
    return this.buses.get(name);
  }

  /** Volume of a bus 0..1 (options). @param {string} name @param {number} v */
  setVolume(name, v) {
    this.levels[name] = v;
    if (!this.ctx) return;
    try { this.buses.get(name).gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); } catch { /* ignore */ }
  }

  /** @param {boolean} muted */
  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    try { this.master.gain.setTargetAtTime(muted ? 0 : CONFIG.audio.master, this.ctx.currentTime, 0.05); } catch { /* ignore */ }
  }

  /** Tunnel reverb amount 0..1 (smoothed). @param {number} level */
  setReverb(level) {
    if (!this.ctx || Math.abs(level - this.reverbLevel) < 0.01) return;
    this.reverbLevel = level;
    try { this.wet.gain.setTargetAtTime(level * CONFIG.audio.reverb, this.ctx.currentTime, 0.15); } catch { /* ignore */ }
  }

  /** Pauses or resumes all sound (game pause, hidden tab). @param {boolean} paused */
  setPaused(paused) {
    if (!this.ctx) return;
    try { if (paused) this.ctx.suspend(); else this.ctx.resume(); } catch { /* ignore */ }
  }

  /**
   * One-shot sample.
   * @param {string} name @param {{ bus?: string, gain?: number, rate?: number, pan?: number }} [o]
   */
  play(name, o = {}) {
    const ctx = this.ctx, buf = this.buffers.get(name);
    if (!ctx || !buf) return;
    try {
      const src = ctx.createBufferSource(), g = ctx.createGain();
      src.buffer = buf;
      src.playbackRate.value = o.rate ?? 1;
      g.gain.value = o.gain ?? 1;
      let out = g;
      if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = o.pan; g.connect(p); out = p; }
      src.connect(g);
      out.connect(this.bus(o.bus || 'sfx'));
      src.start();
    } catch { /* ignore */ }
  }

  /**
   * Looping voice with smoothed gain, rate and pan (engines, tyres, ambience). Starts silent.
   * @param {string} name @param {string} bus @returns {LoopVoice | null}
   */
  loop(name, bus) {
    if (!this.ctx || !this.buffers.has(name)) return null;
    try { return new LoopVoice(this, name, bus); } catch { return null; }
  }
}

/** A looping sample with gain, playback rate and pan controlled by setTargetAtTime (no clicks). */
export class LoopVoice {
  constructor(mixer, name, bus) {
    const ctx = mixer.ctx;
    this.ctx = ctx;
    this.mixer = mixer;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner();
    this.gain.connect(this.pan).connect(mixer.bus(bus));
    this.src = null;
    this.name = null;
    this.level = 0;
    this.rate = 1;
    this.panV = 0;
    this.setSample(name);
  }

  // (Re)starts the loop with another sample (rival voices change cars).
  setSample(name) {
    if (name === this.name) return;
    const s = this.mixer.samples.get(name), src = this.ctx.createBufferSource();
    src.buffer = this.mixer.buffers.get(name);
    src.loop = true;
    src.loopStart = (s.loopStart || 0) / SAMPLE_RATE;
    src.loopEnd = src.buffer.duration;
    src.playbackRate.value = this.rate;
    src.connect(this.gain);
    src.start();
    if (this.src) this.src.stop(this.ctx.currentTime + 0.05);
    this.src = src;
    this.name = name;
  }

  /** @param {number} gain @param {number} rate @param {number} [pan] @param {number} [tc] smoothing (s) */
  set(gain, rate, pan = 0, tc = 0.03) {
    try {
      const t = this.ctx.currentTime;
      if (Math.abs(gain - this.level) > 0.002) { this.gain.gain.setTargetAtTime(gain, t, tc); this.level = gain; }
      if (Math.abs(rate - this.rate) > 0.002) { this.src.playbackRate.setTargetAtTime(rate, t, tc); this.rate = rate; }
      if (Math.abs(pan - this.panV) > 0.01) { this.pan.pan.setTargetAtTime(pan, t, 0.05); this.panV = pan; }
    } catch { /* ignore */ }
  }

  stop() {
    try {
      this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      this.src.stop(this.ctx.currentTime + 0.2);
    } catch { /* ignore */ }
  }
}

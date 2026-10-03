// Module player in the style of MOD/S3M trackers: 8 channels, patterns of rows, an order list,
// tempo/speed timing (row = speed ticks of 2.5 / tempo s) and per-tick effects. TrackerCore is pure
// (events with times, testable in Node); TrackerPlayer schedules them on Web Audio with a lookahead.
//
// Effects (cell.fx, cell.param):
//   '0' xy arpeggio (+x, +y semitones)        '1' xx pitch slide up   '2' xx slide down (1/16 semitone per tick)
//   '3' xx tone portamento to the cell note   '4' xy vibrato (speed x, depth y/8 semitone)
//   'A' xy volume slide (+x / -y per tick)    'C' xx set volume (0..64)
//   'F' xx speed (< 32) or tempo (>= 32)      'R' xy retrigger the note every y ticks

export const CHANNELS = 8;
const MAX_EVENTS = 2048;

/**
 * @typedef {{ note: number | null, inst: number | null, vol: number | null, fx: string | null, param: number }} Cell
 * note: MIDI number, -1 = note off; inst: index into song.instruments.
 * @typedef {{ rows: number, cells: (Cell | null)[] }} Pattern  cells[row * CHANNELS + ch]
 * @typedef {{ id: string, name: string, tempo: number, speed: number, instruments: string[], pan: number[],
 *   order: number[], loop: number, patterns: Pattern[] }} Song
 * @typedef {{ t: number, ch: number, kind: 'note' | 'pitch' | 'vol' | 'off', inst: number, pitch: number, vol: number }} TrackerEvent
 */

/**
 * Seconds per row for a tempo (BPM in tracker units) and speed (ticks per row).
 * @param {number} tempo @param {number} speed
 * @returns {number}
 */
export function rowSeconds(tempo, speed) {
  return (speed * 2.5) / tempo;
}

export class TrackerCore {
  /** @param {Song} song */
  constructor(song) {
    this.song = song;
    this.events = Array.from({ length: MAX_EVENTS }, () => ({ t: 0, ch: 0, kind: 'note', inst: 0, pitch: 0, vol: 0 }));
    this.count = 0;
    this.ch = Array.from({ length: CHANNELS }, () => ({
      inst: 0, base: 60, pitch: 60, vol: 64, target: 60, vibPhase: 0, active: false, bent: false,
    }));
    this.reset();
  }

  reset() {
    this.order = 0;
    this.row = 0;
    this.time = 0;
    this.tempo = this.song.tempo;
    this.speed = this.song.speed;
  }

  emit(t, ch, kind, c) {
    if (this.count >= MAX_EVENTS) return;
    const e = this.events[this.count++];
    e.t = t; e.ch = ch; e.kind = kind; e.inst = c.inst; e.pitch = c.pitch; e.vol = c.vol;
  }

  /**
   * Processes one row: fills `events` (count) with times from the song start, advances position and time.
   * @returns {number} number of events
   */
  nextRow() {
    this.count = 0;
    const pat = this.song.patterns[this.song.order[this.order]], base = this.row * CHANNELS;
    // Speed/tempo commands act on the row they are on.
    for (let c = 0; c < CHANNELS; c++) {
      const cell = pat.cells[base + c];
      if (cell && cell.fx === 'F') {
        if (cell.param < 32) this.speed = Math.max(1, cell.param);
        else this.tempo = cell.param;
      }
    }
    const tick = 2.5 / this.tempo;
    for (let c = 0; c < CHANNELS; c++) this.rowStart(c, pat.cells[base + c]);
    for (let k = 1; k < this.speed; k++) {
      for (let c = 0; c < CHANNELS; c++) this.tickEffect(c, pat.cells[base + c], k, this.time + k * tick);
    }
    this.time += this.speed * tick;
    if (++this.row >= pat.rows) {
      this.row = 0;
      if (++this.order >= this.song.order.length) this.order = this.song.loop;
    }
    return this.count;
  }

  // Tick 0: new notes, volume, set-volume and tone-portamento targets.
  rowStart(c, cell) {
    const s = this.ch[c], t = this.time;
    if (!cell) {
      if (s.bent) { s.pitch = s.base; s.bent = false; this.emit(t, c, 'pitch', s); }
      return;
    }
    if (cell.inst !== null) s.inst = cell.inst;
    if (cell.vol !== null) s.vol = cell.vol;
    if (cell.fx === 'C') s.vol = Math.min(64, cell.param);
    if (cell.note === -1) { s.active = false; this.emit(t, c, 'off', s); return; }
    if (cell.note !== null && cell.fx === '3') s.target = cell.note;
    else if (cell.note !== null) {
      s.base = s.pitch = s.target = cell.note;
      s.vibPhase = 0;
      s.active = true;
      s.bent = false;
      this.emit(t, c, 'note', s);
      return;
    }
    if (s.bent && cell.fx !== '0' && cell.fx !== '4') { s.pitch = s.base; s.bent = false; this.emit(t, c, 'pitch', s); }
    if (cell.vol !== null || cell.fx === 'C') this.emit(t, c, 'vol', s);
  }

  // Ticks 1..speed-1: continuous effects.
  tickEffect(c, cell, k, t) {
    if (!cell || !cell.fx) return;
    const s = this.ch[c], x = cell.param >> 4, y = cell.param & 15;
    switch (cell.fx) {
      case '0':
        s.pitch = s.base + [0, x, y][k % 3]; s.bent = true; this.emit(t, c, 'pitch', s); break;
      case '1':
        s.base = s.pitch = s.base + cell.param / 16; this.emit(t, c, 'pitch', s); break;
      case '2':
        s.base = s.pitch = s.base - cell.param / 16; this.emit(t, c, 'pitch', s); break;
      case '3': {
        const d = s.target - s.base, step = Math.sign(d) * Math.min(Math.abs(d), cell.param / 16);
        s.base = s.pitch = s.base + step;
        this.emit(t, c, 'pitch', s);
        break;
      }
      case '4':
        s.vibPhase += x / 64;
        s.pitch = s.base + (y / 8) * Math.sin(s.vibPhase * Math.PI * 2); s.bent = true; this.emit(t, c, 'pitch', s); break;
      case 'A':
        s.vol = Math.max(0, Math.min(64, s.vol + x - y)); this.emit(t, c, 'vol', s); break;
      case 'R':
        if (y && k % y === 0 && s.active) this.emit(t, c, 'note', s);
        break;
      default:
    }
  }
}

/**
 * Plays songs through the mixer's music bus. Schedules rows ahead of audio time; never throws.
 */
export class TrackerPlayer {
  /** @param {import('./mixer.js').Mixer} mixer */
  constructor(mixer) {
    this.mixer = mixer;
    this.core = null;
    this.start = 0;
    this.voices = [];
    this.lookahead = 0.25;
  }

  /** @param {Song} song */
  play(song) {
    const ctx = this.mixer.ctx;
    if (!ctx) return;
    try {
      this.stop();
      this.core = new TrackerCore(song);
      this.start = ctx.currentTime + 0.1;
      this.voices = song.pan.map((p) => {
        const gain = ctx.createGain(), pan = ctx.createStereoPanner();
        pan.pan.value = p;
        gain.connect(pan).connect(this.mixer.bus('music'));
        return { gain, pan, src: null, env: null, inst: null };
      });
    } catch {
      this.core = null;
    }
  }

  stop() {
    const ctx = this.mixer.ctx;
    if (!ctx || !this.core) return;
    const t = ctx.currentTime;
    for (const v of this.voices) {
      try {
        v.gain.gain.setTargetAtTime(0, t, 0.05);
        if (v.src) v.src.stop(t + 0.3);
        setTimeout(() => v.pan.disconnect(), 500);
      } catch { /* already stopped */ }
    }
    this.core = null;
  }

  /** Schedules everything due within the lookahead. Call every frame. */
  update() {
    const ctx = this.mixer.ctx, core = this.core;
    if (!ctx || !core) return;
    try {
      // After a long stall (hidden tab) restart timing instead of firing a burst of old rows.
      if (this.start + core.time < ctx.currentTime - 0.5) this.start = ctx.currentTime - core.time + 0.05;
      while (this.start + core.time < ctx.currentTime + this.lookahead) {
        const n = core.nextRow();
        for (let i = 0; i < n; i++) this.apply(core.events[i]);
      }
    } catch {
      this.core = null;
    }
  }

  apply(e) {
    const ctx = this.mixer.ctx, v = this.voices[e.ch], t = this.start + e.t, inst = this.core.song.instruments[e.inst];
    const smp = this.mixer.samples.get(inst), buf = this.mixer.buffers.get(inst);
    if (!smp || !buf) return;
    const rate = smp.baseFreq ? (440 * 2 ** ((e.pitch - 69) / 12)) / smp.baseFreq : 2 ** ((e.pitch - 60) / 12);
    if (e.kind === 'note') {
      this.release(v, t);
      const src = ctx.createBufferSource(), env = ctx.createGain();
      src.buffer = buf;
      src.loop = smp.loop;
      if (smp.loop) { src.loopStart = smp.loopStart / buf.sampleRate; src.loopEnd = buf.duration; }
      src.playbackRate.setValueAtTime(rate, t);
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(1, t + 0.003);
      src.connect(env).connect(v.gain);
      v.gain.gain.setTargetAtTime(e.vol / 64, t, 0.002);
      src.start(t);
      if (!smp.loop) src.stop(t + buf.duration / rate + 0.05);
      v.src = src; v.env = env;
    } else if (e.kind === 'pitch' && v.src) {
      v.src.playbackRate.setValueAtTime(rate, t);
    } else if (e.kind === 'vol') {
      v.gain.gain.setTargetAtTime(e.vol / 64, t, 0.005);
    } else if (e.kind === 'off') {
      this.release(v, t);
    }
  }

  // Short fade of the sounding note (no click), then stop.
  release(v, t) {
    if (!v.src) return;
    v.env.gain.setTargetAtTime(0, t, 0.006);
    v.src.stop(t + 0.05);
    v.src = null;
  }
}

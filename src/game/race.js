// Race logic: start lights and false starts, checkpoints (corner cutting earns nothing), laps, lap
// times, live positions, finish order and results. Circuits count laps over the whole loop; a sprint
// is one "lap" from the start line to the finish line. Pure logic, no DOM; driven by track distances.

const MAX_STEP = 60;
const byScore = (a, b) => b.score - a.score;

/**
 * @typedef {object} Entry
 * @property {number} id @property {string} name @property {boolean} isPlayer
 * @property {boolean} started crossed the start line once (grid start)
 * @property {number} lap completed laps @property {number} next index of the next checkpoint
 * @property {boolean} finished @property {number} finishTime race time incl. penalties
 * @property {number} order finishing order (1..) @property {number[]} lapTimes @property {number} best
 * @property {number} penalty seconds @property {boolean} falseStart @property {number} position live position
 */

export class Race {
  /**
   * @param {import('../world/track.js').Track} track
   * @param {{ id: number, name: string, isPlayer: boolean }[]} entries
   * @param {{ laps: number, checkpointSpacing: number, lights: number, lightInterval: number,
   *   goDelay: number, falseStartPenalty: number, finishWait: number }} cfg goDelay: seconds after the last light
   */
  constructor(track, entries, cfg) {
    this.track = track;
    this.L = track.length;
    this.sprint = !track.closed;
    // Distance counted per lap: the loop, or start to finish on a sprint (raced once).
    this.lapLength = this.sprint ? track.finishS - track.startS : this.L;
    if (this.sprint) cfg = { ...cfg, laps: 1 };
    this.cfg = cfg;
    this.K = Math.max(3, Math.round(this.lapLength / cfg.checkpointSpacing));
    this.spacing = this.lapLength / this.K;
    this.entries = entries.map((e) => ({
      ...e, started: false, lap: 0, next: 0, lastRel: null, finished: false, finishTime: 0, order: 0,
      lapStart: 0, lapTimes: [], best: Infinity, penalty: 0, falseStart: false, gridRel: null, position: 0,
    }));
    this.phase = 'countdown';
    this.clock = 0;
    this.time = 0;
    this.goAt = cfg.lights * cfg.lightInterval + cfg.goDelay;
    this.finishCount = 0;
    this.playerFinishedAt = -1;
    this.players = this.entries.filter((e) => e.isPlayer);
    this.sorted = [...this.entries];
    this.rank();
  }

  /** Number of red lights currently lit (0 after the start). */
  get lightsOn() {
    if (this.phase !== 'countdown') return 0;
    return Math.min(this.cfg.lights, Math.floor(this.clock / this.cfg.lightInterval) + 1);
  }

  /** Distance from the start line along the track: 0..L on circuits, signed on a sprint. */
  rel(s) {
    if (this.sprint) return s - this.track.startS;
    const L = this.L, r = (s - this.track.startS) % L;
    return r < 0 ? r + L : r;
  }

  // Signed movement between two rel() values (circuits wrap).
  delta(from, to) {
    let d = to - from;
    if (this.sprint) return d;
    if (d < -this.L / 2) d += this.L;
    if (d > this.L / 2) d -= this.L;
    return d;
  }

  /**
   * Advances the race.
   * @param {number} dt @param {number[]} s current track distance of each entry (same order as entries)
   */
  update(dt, s) {
    if (this.phase === 'countdown') {
      this.clock += dt;
      this.entries.forEach((e, i) => { this.checkFalseStart(e, s[i]); e.lastRel = this.rel(s[i]); });
      this.rank();
      if (this.clock >= this.goAt) this.phase = 'running';
      return;
    }
    if (this.phase === 'finished') return;
    this.time += dt;
    this.entries.forEach((e, i) => { if (!e.finished) this.advance(e, s[i]); });
    this.rank();
    // The race ends when everyone is in, or finishWait after the last human player crossed the line.
    let allDone = true, playersDone = this.players.length > 0;
    for (const e of this.entries) {
      if (!e.finished) allDone = false;
      if (e.isPlayer && !e.finished) playersDone = false;
    }
    if (playersDone && this.playerFinishedAt < 0) this.playerFinishedAt = this.time;
    if (allDone || (this.playerFinishedAt >= 0 && this.time - this.playerFinishedAt > this.cfg.finishWait)) this.phase = 'finished';
  }

  checkFalseStart(e, s) {
    const r = this.rel(s);
    if (e.gridRel === null) { e.gridRel = r; return; }
    const d = this.delta(e.gridRel, r);
    if (e.isPlayer && !e.falseStart && d > 1) {
      e.falseStart = true;
      e.penalty += this.cfg.falseStartPenalty;
    }
  }

  // Checkpoints must be crossed in order while driving forward; jumps (resets, cuts) earn nothing.
  advance(e, s) {
    const r = this.rel(s);
    if (e.lastRel === null) { e.lastRel = r; return; }
    const d = this.delta(e.lastRel, r), from = e.lastRel;
    e.lastRel = r;
    if (d <= 0 || d > MAX_STEP) return;
    if (!e.started) {
      // Grid behind the line: start = crossing it (end of the loop on circuits, distance 0 on a sprint).
      if (this.sprint ? from < 0 && from + d >= 0 : from + d >= this.L) { e.started = true; e.next = 1; e.lapStart = this.time; }
      return;
    }
    const wrapped = from + d >= this.lapLength;
    if (e.next < this.K) {
      const c = e.next * this.spacing;
      if (from < c && from + d >= c) e.next++;
      return;
    }
    if (!wrapped) return;
    const lapTime = this.time - e.lapStart;
    e.lapTimes.push(lapTime);
    e.best = Math.min(e.best, lapTime);
    e.lapStart = this.time;
    e.lap++;
    e.next = 1;
    if (e.lap >= this.cfg.laps) {
      e.finished = true;
      e.order = ++this.finishCount;
      e.finishTime = this.time + e.penalty;
    }
  }

  /** Comparable race progress (finished cars by order; others by laps and validated distance). */
  progress(e) {
    if (e.finished) return 1e9 - e.order;
    const r = e.lastRel ?? 0;
    if (!e.started) return this.sprint ? Math.min(r, 0) : r > this.L / 2 ? r - this.L : r;
    // Distance is capped at the next checkpoint: skipping one does not gain places.
    return e.lap * this.lapLength + Math.min(r, e.next * this.spacing);
  }

  rank() {
    // In-place sort of a persistent array (no allocation per update).
    for (const e of this.sorted) e.score = this.progress(e);
    this.sorted.sort(byScore);
    for (let i = 0; i < this.sorted.length; i++) this.sorted[i].position = i + 1;
  }

  /** Final classification: finished cars by time, then the rest by progress. */
  results() {
    this.rank();
    const done = this.entries.filter((e) => e.finished).sort((a, b) => a.finishTime - b.finishTime);
    const rest = this.sorted.filter((e) => !e.finished);
    return [...done, ...rest];
  }
}

// Persistent player data (localStorage): unlocked cars, options, lap/track records and championship
// history. Storage errors (private mode, quota, no localStorage in Node) never break the game: reads
// fall back to defaults, writes are skipped. Unknown or damaged fields are dropped on load.

const KEY = 'roadline95';

/**
 * @typedef {{ time: number, car: string, name: string }} RecordEntry
 * @typedef {{ unlocked: string[], options: Object<string, number>, records: Object<string, { lap?: RecordEntry, race?: RecordEntry }>,
 *   champ: { seasons: number, titles: number, best: number } }} Save
 */

/** @returns {Save} */
export function emptySave() {
  return { unlocked: [], options: {}, records: {}, champ: { seasons: 0, titles: 0, best: 0 } };
}

const validEntry = (e) => e && Number.isFinite(e.time) && e.time > 0 && typeof e.car === 'string' && typeof e.name === 'string';

/**
 * Cleans loaded data (wrong types are dropped, so an old or edited save cannot break the game).
 * @param {object} data @returns {Save}
 */
export function sanitizeSave(data) {
  const s = emptySave();
  if (!data || typeof data !== 'object') return s;
  if (Array.isArray(data.unlocked)) s.unlocked = data.unlocked.filter((v) => typeof v === 'string');
  if (data.options && typeof data.options === 'object') {
    for (const [k, v] of Object.entries(data.options)) if (Number.isInteger(v) && v >= 0 && v < 100) s.options[k] = v;
  }
  if (data.records && typeof data.records === 'object') {
    for (const [track, r] of Object.entries(data.records)) {
      const out = {};
      if (validEntry(r?.lap)) out.lap = { time: r.lap.time, car: r.lap.car, name: r.lap.name };
      if (validEntry(r?.race)) out.race = { time: r.race.time, car: r.race.car, name: r.race.name };
      if (out.lap || out.race) s.records[track] = out;
    }
  }
  const c = data.champ;
  if (c && typeof c === 'object') {
    for (const k of ['seasons', 'titles', 'best']) if (Number.isInteger(c[k]) && c[k] >= 0) s.champ[k] = c[k];
  }
  return s;
}

/** @returns {Save} */
export function loadSave() {
  try {
    const raw = globalThis.localStorage && globalThis.localStorage.getItem(KEY);
    return sanitizeSave(raw ? JSON.parse(raw) : null);
  } catch {
    return emptySave();
  }
}

/** @param {Save} save */
export function writeSave(save) {
  try {
    if (globalThis.localStorage) globalThis.localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Storage unavailable: progress lasts for this session only.
  }
}

/**
 * True if a car may be chosen: not locked by the season data, or unlocked by the player.
 * @param {string} carId @param {string[]} locked @param {{ unlocked: string[] }} save
 */
export function carAvailable(carId, locked, save) {
  return !locked.includes(carId) || save.unlocked.includes(carId);
}

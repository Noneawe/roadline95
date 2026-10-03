// Records: best lap and best race (or sprint run) time per track, and the championship history.
// Pure logic on the save object (storage.js); callers write the save after a change.

/**
 * Offers a finished lap / race to the records. Returns which records were broken.
 * @param {import('../storage.js').Save} save @param {string} trackId
 * @param {{ lap?: number, race?: number, car: string, name: string }} r times in seconds
 * @returns {{ lap: boolean, race: boolean }}
 */
export function offerRecord(save, trackId, r) {
  const rec = save.records[trackId] || (save.records[trackId] = {}), out = { lap: false, race: false };
  for (const kind of ['lap', 'race']) {
    const t = r[kind];
    if (!(t > 0) || (rec[kind] && rec[kind].time <= t)) continue;
    rec[kind] = { time: t, car: r.car, name: r.name };
    out[kind] = true;
  }
  return out;
}

/**
 * Records a finished championship season.
 * @param {import('../storage.js').Save} save @param {number} place the player's final position (1 = champion)
 */
export function recordSeason(save, place) {
  const c = save.champ;
  c.seasons++;
  if (place === 1) c.titles++;
  c.best = c.best ? Math.min(c.best, place) : place;
}

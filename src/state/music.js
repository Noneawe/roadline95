// Music director: plays the tracker songs by situation (menu, race radio, results) through one
// TrackerPlayer; songs change only when the wanted one differs. Starts once audio runs.
import { TrackerPlayer } from '../audio/tracker.js';
import { SONGS, MUSIC } from '../audio/songs.js';

/** @param {import('../audio/mixer.js').Mixer | null} mixer */
export function createMusic(mixer) {
  const player = mixer ? new TrackerPlayer(mixer) : null;
  let current = null, radio = 0;
  const play = (id) => {
    if (!player || !mixer.ctx || current === id) return;
    current = id;
    player.play(SONGS.find((s) => s.id === id));
  };
  return {
    /** @param {'menu' | 'race' | 'results'} situation */
    want(situation) { play(situation === 'race' ? MUSIC.race[radio] : MUSIC[situation]); },
    /** Next radio song; returns its name. */
    radio() {
      radio = (radio + 1) % MUSIC.race.length;
      play(MUSIC.race[radio]);
      return SONGS.find((s) => s.id === MUSIC.race[radio]).name;
    },
    update() { player?.update(); },
  };
}

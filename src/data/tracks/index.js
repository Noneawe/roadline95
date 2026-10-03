// Track registry: ?track=N selects an entry (one track per file in this folder). The five race tracks
// come first (championship order in data/championship.js); the stage 2 test loop stays for tests.
import { TRACK_HARBOUR } from './harbour.js';
import { TRACK_RACEWAY } from './raceway.js';
import { TRACK_MOUNTAIN } from './mountain.js';
import { TRACK_DESERT } from './desert.js';
import { TRACK_COAST } from './coast.js';
import { TRACK_TEST_LOOP } from './testLoop.js';

export const TRACKS = [TRACK_HARBOUR, TRACK_RACEWAY, TRACK_MOUNTAIN, TRACK_DESERT, TRACK_COAST, TRACK_TEST_LOOP];

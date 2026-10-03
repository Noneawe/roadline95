// Song data: four original tracker tunes (menu, two race songs, results) in mid-90s rock/techno style,
// written as compact text bars and compiled to tracker patterns (audio/tracker.js format).
// Token per row: note (C4 = MIDI 60, sharps/flats: C#4, Bb3) or drum letter (k kick, s snare, h hat,
// o open hat, c crash), '.' empty, '^' note off; optional ':vol' (0..64) and '!' + effect + 2 hex digits.
import { CHANNELS } from './tracker.js';

const ROWS = 64;
const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DRUMS = { k: 'kick', s: 'snare', h: 'hat', o: 'hatOpen', c: 'crash' };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const TOKEN = /^([A-G][#b]?-?\d|[ksohc]|\.|\^)(?::(\d+))?(?:!([0-9A-Z])([0-9a-fA-F]{2}))?$/;

/**
 * MIDI number of a note name ('C4' = 60, 'F#3', 'Bb2').
 * @param {string} name @returns {number}
 */
export function midi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + STEPS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

const noteName = (n) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

// 'A3m' -> [57, 60, 64]; 'F3' -> major triad.
function chord(sym) {
  const minor = sym.endsWith('m'), root = midi(minor ? sym.slice(0, -1) : sym);
  return [root, root + (minor ? 3 : 4), root + 7];
}

const bar = (s) => {
  const t = s.trim().split(/\s+/);
  if (t.length !== 16) throw new Error(`bar needs 16 steps: ${s}`);
  return t;
};
const bars = (...list) => list.flatMap((b) => (Array.isArray(b) ? b : bar(b)));
const times = (n, ...list) => Array.from({ length: n }, () => bars(...list)).flat();

// Bass/guitar figure per chord: x root, o octave up, 5 fifth (suffixes such as ':30' kept), '.' rest, '^' off.
const figure = (chords, rhythm, octave = 0) => chords.flatMap((c) => {
  const [root] = chord(c), r = root + octave * 12;
  const step = { x: 0, o: 12, 5: 7 };
  return bar(rhythm).map((s) => (s[0] in step ? noteName(r + step[s[0]]) + s.slice(1) : s));
});

// Chord tone held for a bar (pad voice k = 0, 1, 2 of the triad).
const held = (chords, k, octave = 0, vol = 40) => chords.flatMap((c) => [`${noteName(chord(c)[k] + octave * 12)}:${vol}`, ...Array(15).fill('.')]);

// Arpeggiated chord tones in 16ths/8ths: pattern indexes 0..2 (triad) and 3 (octave), '.' rest.
const arp = (chords, pattern, octave = 0) => chords.flatMap((c) => {
  const t = chord(c);
  return bar(pattern).map((s) => (s === '.' ? '.' : noteName([t[0], t[1], t[2], t[0] + 12][Number(s)] + octave * 12)));
});

// Tracker arpeggio effect on the chord root, sustained over the bar.
const fxArp = (chords, octave = 0) => chords.flatMap((c) => {
  const [r, third] = chord(c), p = `0${third - r === 3 ? 37 : 47}`;
  return [`${noteName(r + octave * 12)}!${p}`, ...Array(15).fill(`.!${p}`)];
});

// Silent channel.
const rest = () => Array(ROWS).fill('.');

function parseCell(tok, inst, instIndex) {
  const m = TOKEN.exec(tok);
  if (!m) throw new Error(`bad token ${tok}`);
  const [, head, vol, fx, param] = m;
  const cell = { note: null, inst: null, vol: vol ? Math.min(64, Number(vol)) : null, fx: fx || null, param: param ? parseInt(param, 16) : 0 };
  if (head === '^') cell.note = -1;
  else if (DRUMS[head]) { cell.note = 60; cell.inst = instIndex(DRUMS[head]); }
  else if (head !== '.') { cell.note = midi(head); cell.inst = instIndex(inst); }
  return cell.note === null && cell.vol === null && !cell.fx ? null : cell;
}

/**
 * Compiles a song description into the tracker format.
 * @param {{ id: string, name: string, tempo: number, speed: number, channels: string[], pan: number[],
 *   patterns: Object<string, string[][]>, order: string, loop?: number }} def
 *   channels: instrument per channel ('drums' = letters); patterns: per name 8 token lists (64 rows each,
 *   shorter lists repeat; missing channels are silent)
 * @returns {import('./tracker.js').Song}
 */
export function compileSong(def) {
  const instruments = [], instIndex = (n) => { if (!instruments.includes(n)) instruments.push(n); return instruments.indexOf(n); };
  const names = Object.keys(def.patterns);
  const patterns = names.map((name) => {
    const cells = new Array(ROWS * CHANNELS).fill(null);
    def.patterns[name].forEach((tokens, ch) => {
      if (!tokens) return;
      if (ROWS % tokens.length) throw new Error(`${def.id}/${name} channel ${ch}: ${tokens.length} rows`);
      for (let r = 0; r < ROWS; r++) cells[r * CHANNELS + ch] = parseCell(tokens[r % tokens.length], def.channels[ch], instIndex);
    });
    return { rows: ROWS, cells };
  });
  const order = def.order.trim().split(/\s+/).map((n) => {
    if (!names.includes(n)) throw new Error(`${def.id}: unknown pattern ${n}`);
    return names.indexOf(n);
  });
  return { id: def.id, name: def.name, tempo: def.tempo, speed: def.speed, instruments, pan: def.pan, order, loop: def.loop ?? 0, patterns };
}

// ---- Redline Rock (race 1): A minor rock, 140 BPM ---------------------------------------
const R1_VERSE = ['A2m', 'F2', 'C3', 'G2'];
const R1_CHORUS_A = ['F2', 'G2', 'A2m', 'A2m'];
const R1_CHORUS_B = ['F2', 'G2', 'C3', 'E2'];
const ROCK = 'k . h . s . h . k k h . s . h .';
const ROCK_FILL = 'k . h . s . h . k . s s s . s s';

const REDLINE = {
  id: 'redline', name: 'REDLINE ROCK', tempo: 140, speed: 6,
  channels: ['drums', 'drums', 'bass', 'guitar', 'guitar', 'lead', 'pluck', 'pad'],
  pan: [0, 0.2, 0, -0.7, 0.7, 0.15, -0.4, 0.4],
  patterns: {
    intro: [
      bars('c . h . h . h . h . h . h . h .', 'h . h . h . h . h . h . h . h .', 'k . h . s . h . k . h . s . h .', ROCK_FILL),
      null,
      bars('. . . . . . . . . . . . . . . .', '. . . . . . . . . . . . . . . .', 'A1 . A1 . A1 . A1 . A1 . A1 . A1 . A1 .', 'A1 . A1 . A1 . A1 . G1 . G1 . G1 . G1 .'),
      figure(['A2m', 'A2m', 'A2m', 'G2'], 'x:30 x:30 x:30 x:30 x:30 x:30 x:30 x:30 x . x . x . x .'),
      null, null,
      arp(['A3m', 'A3m', 'A3m', 'G3'], '0 . 2 . 3 . 2 . 0 . 2 . 3 . 1 .'),
    ],
    verse: [
      times(3, ROCK).concat(bar(ROCK_FILL)), null,
      figure(R1_VERSE, 'x . x . x . x . x . o . x . 5 .', -1),
      figure(R1_VERSE, 'x . . x . . x . x . . x . . x .'),
      figure(R1_VERSE, 'x . . x . . x . x . . x . . x .'),
      null,
      arp(R1_VERSE, '0 . 1 . 2 . 3 . 2 . 1 . 0 . 1 .', 1),
    ],
    chorusA: [
      times(3, 'c . h . s . h . k k h . s . h .').concat(bar(ROCK_FILL)), null,
      figure(R1_CHORUS_A, 'x . x . x . x . x . x . o . x .', -1),
      figure(R1_CHORUS_A, 'x . x . x . x . x . x . x . x .'),
      figure(R1_CHORUS_A, 'x . x . x . x . x . x . x . x .'),
      bars('E5 . . . D5 . C5 . D5 . . . C5 . A4 .', 'B4 . . . G4 . . . B4 . C5 . D5 . . .',
        'E5 . . . . . . . .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444', 'C5 . B4 . A4 . . . .!444 .!444 .!444 .!444 ^ . . .'),
      null, held(R1_CHORUS_A, 1, 1, 24),
    ],
    chorusB: [
      times(3, 'c . h . s . h . k k h . s . h .').concat(bar('s s s s s s s s k . k . k . k .')), null,
      figure(R1_CHORUS_B, 'x . x . x . x . x . x . o . x .', -1),
      figure(R1_CHORUS_B, 'x . x . x . x . x . x . x . x .'),
      figure(R1_CHORUS_B, 'x . x . x . x . x . x . x . x .'),
      bars('A5 . . . G5 . F5 . E5 . . . D5 . C5 .', 'D5 . . . B4 . . . G4 . A4 . B4 . . .',
        'C5 . . . E5 . . . G5 . . . E5 . . .', 'G#5 . . . .!444 .!444 .!444 .!444 B5!444 .!444 .!444 .!444 .!444 .!444 ^ .'),
      null, held(R1_CHORUS_B, 1, 1, 24),
    ],
    solo: [
      times(4, ROCK), null,
      figure(R1_VERSE, 'x . x . x . x . x . o . x . 5 .', -1),
      figure(R1_VERSE, 'x . x . x . x . x . x . x . x .'),
      null,
      bars('A5!047 .!047 .!047 .!047 C6 . B5 . A5 . G5 . E5 . G5 .', 'F5!047 .!047 .!047 .!047 A5 . G5 . F5 . E5 . C5 . E5 .',
        'G5!037 .!037 .!037 .!037 E5 . G5 . C6 . . . B5 . G5 .', 'D5 .!201 .!201 .!201 .!201 .!201 .!201 .!201 G5 . . . .!444 .!444 .!444 .!444'),
      arp(R1_VERSE, '0 2 3 2 0 2 3 2 0 2 3 2 0 2 3 2', 1),
    ],
  },
  order: 'intro verse verse chorusA chorusB verse solo chorusA chorusB chorusB',
  loop: 1,
};

// ---- Night Circuit (race 2): D minor techno, 135 BPM ---------------------------------------
const R2 = ['D3m', 'Bb2', 'C3', 'A2m'];
const FLOOR = 'k . h . k . o . k . h . k . o h';
const CLAP = '. . . . s . . . . . . . s . . .';

const NIGHT = {
  id: 'night', name: 'NIGHT CIRCUIT', tempo: 135, speed: 6,
  channels: ['drums', 'drums', 'bass', 'pad', 'pad', 'lead', 'stab', 'organ'],
  pan: [0, 0.1, 0, -0.6, 0.6, 0.2, -0.3, 0.3],
  patterns: {
    build: [
      times(4, 'k . . . k . . . k . . . k . . .'), times(2, '. . . . . . . . . . . . . . . .').concat(times(2, CLAP)),
      figure(R2, '. . x . . . x . . . x . . . x .', -1),
      held(R2, 0, 1, 30), held(R2, 2, 1, 30),
      null, fxArp(R2, 1),
    ],
    groove: [
      times(4, FLOOR), times(3, CLAP).concat(bar('. . . . s . . s . . s . s s s s')),
      figure(R2, 'x . o . x . o x . x o . x . o .', -1),
      held(R2, 0, 1, 34), held(R2, 1, 1, 34),
      null, fxArp(R2, 1),
      arp(R2, '. . 0 . . . 2 . . . 0 . . . 3 .', 1),
    ],
    theme: [
      times(4, FLOOR), times(4, CLAP),
      figure(R2, 'x . o . x . o x . x o . x . o .', -1),
      held(R2, 0, 1, 30), held(R2, 2, 1, 30),
      bars('D5 . F5 . A5 . . . G5 . F5 . E5 . F5 .', 'D5 . . . .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 C5 . D5 .',
        'E5 . G5 . C6 . . . A5 . G5 . E5 . G5 .', 'A5 . . . .!444 .!444 .!444 .!444 E5 . . . .!444 .!444 ^ .'),
      fxArp(R2, 0),
    ],
    theme2: [
      times(4, FLOOR), times(3, CLAP).concat(bar('s . s . s . s . s s s s s s s s')),
      figure(R2, 'x . o . x . o x . x o . x . o .', -1),
      held(R2, 0, 1, 30), held(R2, 1, 1, 30),
      bars('F5 . E5 . D5 . A5 . . . G5 . F5 . E5 .', 'F5 . . . D5 . . . F5 . G5 . A5 . . .',
        'G5 . . . E5 . C5 . E5 . G5 . C6 . . .', 'A5!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!A04 .!A04 .!A04 ^'),
      fxArp(R2, 0),
      arp(R2, '0 . . 2 . . 3 . 0 . . 2 . . 3 .', 1),
    ],
  },
  order: 'build groove theme theme2 groove theme theme2 theme2',
  loop: 1,
};

// ---- Paddock (menu): E minor, relaxed synth groove, 125 BPM -----------------------------------
const M = ['E3m', 'C3', 'G3', 'D3'];
const PADDOCK = {
  id: 'paddock', name: 'PADDOCK', tempo: 125, speed: 6,
  channels: ['drums', 'drums', 'bass', 'pluck', 'pad', 'organ', 'pad', 'lead'],
  pan: [0, 0.2, 0, -0.5, -0.4, 0.3, 0.4, 0.1],
  patterns: {
    a: [
      times(4, 'k . h . . . h . k . h . . . h h'), times(4, '. . . . s:40 . . . . . . . s:40 . . .'),
      figure(M, 'x . . . . . x . . . x . . . 5 .', -1),
      arp(M, '0 . 1 . 2 . 3 . 2 . 1 . 0 . 2 .'),
      held(M, 0, 0, 26), null, held(M, 2, 0, 26),
    ],
    b: [
      times(4, 'k . h . . . h . k . h . . . h h'), times(3, '. . . . s:40 . . . . . . . s:40 . . .').concat(bar('. . . . s:40 . . . . . s:30 s:34 s:40 s:44 s:48 s:54')),
      figure(M, 'x . . . . . x . . . x . . . 5 .', -1),
      arp(M, '0 . 1 . 2 . 3 . 2 . 1 . 0 . 2 .'),
      held(M, 0, 0, 26),
      bars('B4 . . . . . . . G4 . A4 . B4 . . .', 'C5 . . . . . . . B4 . A4 . G4 . . .',
        'D5 . . . . . . . B4 . . . G4 . . .', 'A4 . . . .!443 .!443 .!443 .!443 .!443 .!443 .!443 .!443 ^ . . .'),
      held(M, 2, 0, 26),
    ],
  },
  order: 'a b a b',
  loop: 0,
};

// ---- Podium (results): C major, bright and slower, 100 BPM ------------------------------------
const P = ['C3', 'G2', 'A2m', 'F2'];
const PODIUM = {
  id: 'podium', name: 'PODIUM', tempo: 100, speed: 6,
  channels: ['drums', 'drums', 'bass', 'pluck', 'pad', 'pad', 'organ', 'lead'],
  pan: [0, 0.2, 0, -0.4, -0.5, 0.5, 0.3, 0],
  patterns: {
    a: [
      times(4, 'k . h . h . h . k k h . h . h .'), times(4, '. . . . s . . . . . . . s . . .'),
      figure(P, 'x . . . x . . . x . . . o . 5 .', -1),
      bars('E5 . . . D5 . C5 . D5 . E5 . . . G5 .', 'D5 . . . . . . . B4 . C5 . D5 . . .',
        'C5 . . . B4 . A4 . B4 . C5 . E5 . . .', 'A4 . . . . . . . . . . . . . . .'),
      held(P, 0, 1, 26), held(P, 2, 1, 26),
      arp(P, '0 . 1 . 2 . 1 . 0 . 1 . 2 . 3 .', 1),
    ],
    b: [
      times(3, 'k . h . h . h . k k h . h . h .').concat(bar('c . h . k . h . k . s . s s s s')), times(4, '. . . . s . . . . . . . s . . .'),
      figure(P, 'x . . . x . . . x . . . o . 5 .', -1),
      bars('G5 . . . F5 . E5 . F5 . G5 . . . C6 .', 'B5 . . . . . . . G5 . A5 . B5 . . .',
        'C6 . . . B5 . A5 . G5 . E5 . C5 . . .', 'F5!444 .!444 .!444 .!444 .!444 .!444 .!444 .!444 .!A03 .!A03 .!A03 .!A03 ^ . . .'),
      held(P, 0, 1, 26), held(P, 1, 1, 26),
      arp(P, '0 . 1 . 2 . 1 . 0 . 1 . 2 . 3 .', 1),
      held(P, 0, 2, 20),
    ],
  },
  order: 'a b a b',
  loop: 0,
};

/** All songs, compiled. `menu`, `results` and the race radio playlist refer to them by id. */
export const SONGS = [REDLINE, NIGHT, PADDOCK, PODIUM].map(compileSong);
export const MUSIC = { menu: 'paddock', results: 'podium', race: ['redline', 'night'] };

// Zones (CLAUDE.md stage 4): terrain texture sets and ambient scenery rules used by every track in the
// zone, in addition to the track's own rules. Rule format: CLAUDE.md section 11 (`scenery`), extended
// with `line` rules (continuous strips) - see world/scenery.js.

export const ZONES = {
  raceway: {
    name: 'Raceway',
    ground: { flat: 'grass', mid: 'gravel', steep: 'rock' },
    scenery: [
      { rule: 'every', spacing: 22, sprite: 'treeDeciduous', side: 'both', offset: [24, 40], size: [6, 8] },
      { rule: 'every', spacing: 70, obj: 'tree3d', side: 'both', offset: [20, 34] },
      { rule: 'every', spacing: 55, obj: 'adBoard', side: 'both', offset: 13, tex: 'adRandom' },
      { rule: 'every', spacing: 30, sprite: 'bush', side: 'both', offset: [16, 30], size: [3, 2] },
      { rule: 'line', obj: 'guardrail', side: 'both', offset: 11 },
    ],
  },
  coastCity: {
    name: 'Harbour City',
    ground: { flat: 'grassDry', mid: 'concrete', steep: 'rock' },
    scenery: [
      { rule: 'every', spacing: 34, obj: 'buildingMid', side: 'both', offset: 26, jitter: 4 },
      { rule: 'every', spacing: 51, obj: 'buildingTall', side: 'both', offset: 36, jitter: 6 },
      { rule: 'every', spacing: 29, obj: 'buildingLow', side: 'both', offset: 18, jitter: 3 },
      { rule: 'every', spacing: 18, sprite: 'palm', side: 'both', offset: [9, 12], size: [5, 8] },
      { rule: 'every', spacing: 36, obj: 'lampPost', side: 'both', offset: 8.5, light: true },
      { rule: 'every', spacing: 90, obj: 'adBoard', side: 'both', offset: 11, tex: 'adRandom' },
      { rule: 'line', obj: 'fence', side: 'both', offset: 10 },
    ],
  },
  mountains: {
    name: 'Mountains',
    ground: { flat: 'grass', mid: 'rock', steep: 'cliff' },
    scenery: [
      { rule: 'every', spacing: 9, sprite: 'treeConifer', side: 'both', offset: [14, 40], size: [5, 9] },
      { rule: 'every', spacing: 40, obj: 'conifer3d', side: 'both', offset: [12, 22] },
      { rule: 'every', spacing: 33, obj: 'boulder', side: 'both', offset: [12, 30], scale: [0.6, 1.6] },
      { rule: 'every', spacing: 140, obj: 'adBoard', side: 'left', offset: 12, tex: 'adRandom' },
      { rule: 'line', obj: 'guardrail', side: 'both', offset: 9 },
    ],
  },
  desert: {
    name: 'Desert',
    ground: { flat: 'sand', mid: 'sand', steep: 'rock' },
    scenery: [
      { rule: 'every', spacing: 27, obj: 'boulder', side: 'both', offset: [14, 40], scale: [0.5, 2.2] },
      { rule: 'every', spacing: 19, sprite: 'bush', side: 'both', offset: [12, 40], size: [2.5, 1.5] },
      { rule: 'every', spacing: 120, sprite: 'palm', side: 'both', offset: [16, 30], size: [5, 8] },
      { rule: 'every', spacing: 160, obj: 'adBoard', side: 'right', offset: 14, tex: 'adRandom' },
    ],
  },
  coast: {
    name: 'Coast',
    ground: { flat: 'sand', mid: 'grassDry', steep: 'cliff' },
    scenery: [
      { rule: 'every', spacing: 26, sprite: 'palm', side: 'both', offset: [12, 30], size: [5, 8] },
      { rule: 'every', spacing: 21, sprite: 'bush', side: 'both', offset: [11, 26], size: [2.5, 1.6] },
      { rule: 'every', spacing: 37, obj: 'boulder', side: 'both', offset: [14, 34], scale: [0.6, 1.8] },
      { rule: 'every', spacing: 110, obj: 'buildingLow', side: 'right', offset: 30, jitter: 6 },
      { rule: 'every', spacing: 120, obj: 'adBoard', side: 'left', offset: 11, tex: 'adRandom' },
      { rule: 'line', obj: 'guardrail', side: 'both', offset: 9.5 },
    ],
  },
  forest: {
    name: 'Forest',
    ground: { flat: 'grass', mid: 'dirt', steep: 'rock' },
    scenery: [
      { rule: 'every', spacing: 5, sprite: 'treeDeciduous', side: 'both', offset: [11, 38], size: [6, 9] },
      { rule: 'every', spacing: 7, sprite: 'treeConifer', side: 'both', offset: [12, 40], size: [5, 9] },
      { rule: 'every', spacing: 23, obj: 'tree3d', side: 'both', offset: [10, 18] },
      { rule: 'every', spacing: 31, obj: 'conifer3d', side: 'both', offset: [11, 20] },
      { rule: 'every', spacing: 12, sprite: 'bush', side: 'both', offset: [9, 14], size: [3, 2] },
    ],
  },
};

export const ZONE_IDS = Object.keys(ZONES);

// Logic tests (node:assert, no npm packages): math3d, texture generator, palette/colormap, model loader.
// Run: node tools/test.mjs
import assert from 'node:assert/strict';
import {
  mat4Identity, mat4Multiply, mat4Perspective, mat4View, mat4YawTranslate, transformPoint,
  frustumPlanes, sphereInFrustum,
} from '../src/engine/math3d.js';
import { hashBytes } from '../src/engine/rng.js';
import { buildPalette, nearestIndex, colorDistance } from '../src/gfx/palette.js';
import { buildColormap } from '../src/gfx/colormap.js';
import { assignLayers, buildLayerData, LAYER_SIZE } from '../src/gfx/textures.js';
import { generateLibrary } from '../src/texgen/library.js';
import { generateSky, SKY_KINDS, SKY_W, SKY_H } from '../src/texgen/sky.js';
import { loadModel, VERTEX_WORDS } from '../src/models/loader.js';
import { boxModel, planeModel } from '../src/models/primitives.js';
import { testCarModel } from '../src/models/testCar.js';
import { FLAGS } from '../src/gfx/shaders/world.js';
import { CONFIG } from '../src/config.js';
import { buildTrack, validateTrack, validateSceneryRule, trackPoint, SEG } from '../src/world/track.js';
import { createTerrain, buildBaseTerrain } from '../src/world/terrain.js';
import { buildChunks, loopRepeat } from '../src/world/chunks.js';
import { TRACKS } from '../src/data/tracks/index.js';
import { TRACK_TEST_LOOP } from '../src/data/tracks/testLoop.js';
import { Car } from '../src/vehicle/physics.js';
import { CARS } from '../src/vehicle/cars.js';
import { gearRatio, torqueAt } from '../src/vehicle/drivetrain.js';
import { GroundProbe } from '../src/world/ground.js';
import { frameAt } from '../src/world/track.js';
import { CarCameras } from '../src/camera/carCams.js';
import { createPose, updatePose } from '../src/vehicle/pose.js';
import { safeSpeed, applyAutoBrake } from '../src/vehicle/assists.js';
import { SCENERY_MATERIALS, SCENERY_MODELS } from '../src/models/scenery.js';
import { CAR_MATERIALS } from '../src/models/carBuilder.js';
import { LINES, SPRITES, COLLIDERS, buildScenery } from '../src/world/scenery.js';
import { StaticColliders, collideCarStatic, collideCars, narrowingWalls } from '../src/game/collision.js';
import { buildRacingLine } from '../src/world/racingline.js';
import { arcadeLatBoost } from '../src/vehicle/physics.js';
import { Race } from '../src/game/race.js';
import { RaceSim } from '../src/game/raceSim.js';
import { DRIVERS } from '../src/ai/opponent.js';
import { Damage, deformCar, ZONE } from '../src/vehicle/damage.js';
import { buildCarModel, CAR_MATERIALS as CAR_MATS } from '../src/models/carBuilder.js';
import { ZONES } from '../src/data/zones.js';
import { SURFACE, slipCurve } from '../src/vehicle/tyres.js';
import { gridLiveries, PLAYER_SLOT, PLAYER2_SLOT } from '../src/ai/opponent.js';
import { PlayerInput } from '../src/engine/input.js';
import { Championship } from '../src/game/championship.js';
import { SEASON } from '../src/data/championship.js';
import { Ghost } from '../src/game/ghost.js';
import { loadSave, writeSave, carAvailable, emptySave } from '../src/storage.js';
import { offerRecord, recordSeason } from '../src/game/records.js';
import { resolveOptions, applyOptions, OPTION_DEFS } from '../src/state/options.js';
import { Menu } from '../src/state/ui.js';
import { mainMenu, setupMenu, optionsMenu, formatTime } from '../src/state/menu.js';
import { Overlay } from '../src/gfx/overlay.js';
import { carStats } from '../src/vehicle/stats.js';
import { generateLiverySlot } from '../src/texgen/library.js';
import { buildDashboard } from '../src/cockpit/dashboard.js';
import { speedUnit } from '../src/cockpit/cockpit.js';
import { TouchControls } from '../src/state/touch.js';
import { generateSamples, engineRanges } from '../src/audio/samplegen.js';
import { TrackerCore, rowSeconds } from '../src/audio/tracker.js';
import { SONGS, MUSIC, compileSong } from '../src/audio/songs.js';
import { rangeWeights, doppler } from '../src/audio/engine-sound.js';
import { squealAmount } from '../src/audio/sfx.js';
import { Replay, replayCars } from '../src/game/replay.js';
import { buildTvCameras, TvDirector } from '../src/camera/tv.js';
import { weatherConditions, wetGripFactor } from '../src/game/weather.js';
import { RainFx } from '../src/cockpit/rain.js';
import { SLOT } from '../src/world/ground.js';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b} (eps ${eps})`);
const M = () => new Float32Array(16);

// ---- math3d ---------------------------------------------------------------
test('mat4: identity multiply', () => {
  const a = mat4YawTranslate(M(), 0.7, 1, 2, 3), out = mat4Multiply(M(), mat4Identity(M()), a);
  assert.deepEqual([...out], [...a]);
});

test('mat4: projection maps near/far planes to -1/+1', () => {
  const p = mat4Perspective(M(), Math.PI / 3, 4 / 3, 0.5, 100);
  near(transformPoint([], p, [0, 0, -0.5])[2], -1);
  near(transformPoint([], p, [0, 0, -100])[2], 1, 1e-3);
});

test('mat4: view looks down -Z at yaw 0 and +X at yaw pi/2', () => {
  const pv = (pos, yaw, pitch) => mat4Multiply(M(), mat4Perspective(M(), 1, 1, 0.1, 100), mat4View(M(), pos, yaw, pitch));
  let p = transformPoint([], pv([0, 0, 0], 0, 0), [0, 0, -5]);
  near(p[0], 0); near(p[1], 0);
  p = transformPoint([], pv([1, 2, 3], Math.PI / 2, 0), [6, 2, 3]);
  near(p[0], 0); near(p[1], 0);
  p = transformPoint([], pv([0, 0, 0], 0, 0), [1, 0, -5]);
  assert.ok(p[0] > 0, 'positive X appears on the right');
  p = transformPoint([], pv([0, 0, 0], 0, 0.3), [0, 0, -5]);
  assert.ok(p[1] < 0, 'pitching up moves the horizon down');
});

test('mat4: view roll tilts the image (right side up for positive roll)', () => {
  const pv = mat4Multiply(M(), mat4Perspective(M(), 1, 1, 0.1, 100), mat4View(M(), [0, 0, 0], 0, 0, 0.3));
  const p = transformPoint([], pv, [1, 0, -5]);
  assert.ok(p[1] < 0 && p[0] > 0, 'a point right of centre moves down when the camera rolls right side up');
  const flat = transformPoint([], mat4Multiply(M(), mat4Perspective(M(), 1, 1, 0.1, 100), mat4View(M(), [0, 0, 0], 0, 0)), [1, 0, -5]);
  near(flat[1], 0);
});

test('frustum: sphere culling', () => {
  const vp = mat4Multiply(M(), mat4Perspective(M(), 1, 4 / 3, 0.5, 100), mat4View(M(), [0, 0, 0], 0, 0));
  const pl = frustumPlanes(new Float32Array(24), vp);
  assert.ok(sphereInFrustum(pl, 0, 0, -10, 1));
  assert.ok(!sphereInFrustum(pl, 0, 0, 10, 1), 'behind camera');
  assert.ok(!sphereInFrustum(pl, 0, 0, -200, 1), 'beyond far plane');
  assert.ok(!sphereInFrustum(pl, 50, 0, -10, 1), 'far to the right');
  assert.ok(sphereInFrustum(pl, 0, 0, 1, 2), 'overlapping near plane');
});

// ---- texture generator ----------------------------------------------------
const pal = buildPalette();
const lib = generateLibrary(1995);
const rgb = (i) => [pal[i * 4], pal[i * 4 + 1], pal[i * 4 + 2]];

test('texgen: deterministic per seed, (mostly) different for other seed', () => {
  const again = generateLibrary(1995), other = generateLibrary(7);
  let seeded = 0;
  lib.forEach((t, i) => {
    assert.equal(hashBytes(t.data), hashBytes(again[i].data), `${t.name} not deterministic`);
    assert.equal(hashBytes(t.lod), hashBytes(again[i].lod), `${t.name} LOD not deterministic`);
    if (hashBytes(t.data) !== hashBytes(other[i].data)) seeded++;
  });
  // Flat designed textures (ad boards, shadow, light pool) may legitimately ignore the seed.
  assert.ok(seeded / lib.length >= 0.8, `only ${seeded}/${lib.length} textures depend on the seed`);
});

test('texgen: valid indices, index 0 only in cutout textures', () => {
  for (const t of lib) {
    assert.equal(t.data.length, t.size * t.size);
    assert.ok(t.size === 64 || (t.size === 128 && t.name.startsWith('livery')), `${t.name} size ${t.size}`);
    assert.equal(t.lod.length, 32 * 32);
    const zeros = t.data.filter((v) => v === 0).length;
    if (!t.cutout) assert.equal(zeros, 0, `${t.name} has transparent pixels`);
    else assert.ok(zeros > 0 && zeros < t.data.length, `${t.name} cutout shape`);
  }
});

test('texgen: shade count within range', () => {
  for (const t of lib) {
    const n = new Set(t.data.filter((v) => v)).size;
    assert.ok(n >= t.shades[0] && n <= t.shades[1], `${t.name}: ${n} shades, expected ${t.shades}`);
  }
});

test('texgen: tiling textures are seamless', () => {
  // The wrap-around boundary must look like an interior boundary: no worse than the worst interior boundary
  // (designed block patterns) or mean + 3 sigma (noise textures).
  const diff = (a, b) => Math.sqrt(colorDistance(...rgb(a), ...rgb(b)));
  for (const t of lib.filter((x) => x.tile)) {
    for (const [d, s] of [[t.data, 64], [t.lod, 32]]) {
      const colDiff = (x0, x1) => { let v = 0; for (let y = 0; y < s; y++) v += diff(d[y * s + x0], d[y * s + x1]); return v / s; };
      const rowDiff = (y0, y1) => { let v = 0; for (let x = 0; x < s; x++) v += diff(d[y0 * s + x], d[y1 * s + x]); return v / s; };
      const cols = [], rows = [];
      for (let i = 0; i < s - 1; i++) { cols.push(colDiff(i, i + 1)); rows.push(rowDiff(i, i + 1)); }
      const limit = (a) => { const m = a.reduce((x, y) => x + y) / a.length; return Math.max(Math.max(...a) * 1.25, m + 3 * Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length)) + 1; };
      const ec = colDiff(s - 1, 0), er = rowDiff(s - 1, 0), maxCol = limit(cols), maxRow = limit(rows);
      assert.ok(!t.wrapX || ec <= maxCol, `${t.name} ${s}px vertical seam ${ec.toFixed(1)} > ${maxCol.toFixed(1)}`);
      assert.ok(er <= maxRow, `${t.name} ${s}px horizontal seam ${er.toFixed(1)} > ${maxRow.toFixed(1)}`);
    }
  }
});

test('texgen: full library from CLAUDE.md 9.2 is present and generates fast', () => {
  const names = new Set(lib.map((t) => t.name));
  const required = ['asphalt0', 'asphalt1', 'asphalt2', 'asphaltWet', 'lineCenter', 'lineEdge', 'kerb', 'startLine', 'gravelRoad',
    'grass', 'grassDry', 'sand', 'gravel', 'dirt', 'concrete', 'barrier', 'tyreStack', 'ad0', 'brick', 'tunnelWall', 'roof',
    'windows', 'windowsNight', 'rock', 'cliff', 'water', 'leaves', 'bark', 'treeDeciduous', 'treeConifer', 'palm', 'bush',
    'crowd0', 'crowd1', 'crowd2', 'flag', 'marshal', 'glass', 'headlight', 'taillight', 'tyre', 'grill', 'dashboard'];
  for (const n of required) assert.ok(names.has(n), `missing ${n}`);
  const t0 = performance.now();
  generateLibrary(42);
  for (const k of SKY_KINDS) generateSky(k, 42, 100);
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `library + skies took ${ms.toFixed(0)} ms`);
});

test('sky: deterministic, valid indices, wraps horizontally', () => {
  for (const k of SKY_KINDS) {
    const a = generateSky(k, 1995, 100), b = generateSky(k, 1995, 100);
    assert.equal(a.length, SKY_W * SKY_H);
    assert.equal(hashBytes(a), hashBytes(b), `${k} not deterministic`);
    assert.ok(!a.includes(0), `${k} contains index 0`);
    assert.equal(a[(SKY_H - 1) * SKY_W], 100, `${k} horizon colour below horizon`);
    let edge = 0, inner = 0;
    const d = (p, q) => Math.sqrt(colorDistance(...rgb(p), ...rgb(q)));
    for (let y = 0; y < SKY_H; y++) {
      edge += d(a[y * SKY_W + SKY_W - 1], a[y * SKY_W]);
      for (let x = 0; x < SKY_W - 1; x++) inner += d(a[y * SKY_W + x], a[y * SKY_W + x + 1]);
    }
    assert.ok(edge / SKY_H <= (inner / (SKY_H * (SKY_W - 1))) * 3 + 2, `${k} seam`);
  }
});

test('textures: layer data tiles 64px 2x2 and LOD 32px upscaled', () => {
  const data = buildLayerData(lib, pal, false), L = LAYER_SIZE, t = lib[1];
  assert.equal(data.length, L * L * lib.length * 2);
  const base = L * L * 2;
  assert.equal(data[base + 70 * L + 100], t.data[6 * 64 + 36]);
  assert.equal(data[base + L * L + 70 * L + 100], t.lod[(6 >> 1) * 32 + (36 >> 1)]);
  assert.equal(assignLayers(lib).get(t.name), 2);
  const flat = buildLayerData(lib, pal, true);
  assert.equal(new Set(flat.subarray(base, base + L * L)).size, 1, 'notex gives one flat index');
});

// ---- palette & colormap ---------------------------------------------------
const FOG = [148, 164, 184];
const cm = buildColormap(pal, FOG, 31);

test('palette: 256 opaque entries, nearestIndex never returns 0', () => {
  assert.equal(pal.length, 1024);
  assert.equal(nearestIndex(pal, 0, 0, 0) !== 0, true);
  assert.equal(nearestIndex(pal, ...rgb(37)), 37);
});

test('colormap: light 31 without fog keeps the original colour', () => {
  for (let i = 1; i < 256; i++) assert.ok(colorDistance(...rgb(cm[31 * 256 + i]), ...rgb(i)) === 0, `index ${i}`);
});

test('colormap: light 0 is (near) black', () => {
  for (let i = 1; i < 256; i++) assert.ok(Math.max(...rgb(cm[i])) <= 12, `index ${i} -> ${rgb(cm[i])}`);
});

test('colormap: full fog equals best palette match of fog colour', () => {
  const fogIdx = nearestIndex(pal, ...FOG);
  for (let l = 0; l < 32; l++) for (let i = 1; i < 256; i++) assert.equal(cm[(7 * 32 + l) * 256 + i], fogIdx);
});

test('colormap: no index 0 except for input 0, monotonic-ish light', () => {
  for (let row = 0; row < 256; row++) {
    assert.equal(cm[row * 256], 0);
    for (let i = 1; i < 256; i++) assert.notEqual(cm[row * 256 + i], 0, `row ${row} col ${i}`);
  }
  const lum = (i) => { const c = rgb(i); return c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11; };
  for (let i = 1; i < 256; i++) assert.ok(lum(cm[8 * 256 + i]) <= lum(cm[24 * 256 + i]) + 3, `index ${i}: ${rgb(cm[8 * 256 + i])} vs ${rgb(cm[24 * 256 + i])}`);
});

// ---- model loader ---------------------------------------------------------
const MATS = { a: { tex: 'checker', flags: 0 }, s: { tex: 'checker', flags: FLAGS.GOURAUD }, d: { tex: 'treeDeciduous', flags: FLAGS.DOUBLE | FLAGS.CUTOUT } };
const layers = assignLayers(lib);
const layerOf = (t) => layers.get(t);
const verts = (mesh) => {
  const f = new Float32Array(mesh.buffer), u = new Uint32Array(mesh.buffer), out = [];
  for (let i = 0; i < mesh.count; i++) {
    const o = i * VERTEX_WORDS;
    out.push({ p: [...f.subarray(o, o + 3)], n: [...f.subarray(o + 3, o + 6)], uv: [f[o + 6], f[o + 7]], layer: u[o + 8], flags: u[o + 9] });
  }
  return out;
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test('loader: box triangulation, outward CCW faces and normals', () => {
  const mesh = loadModel(boxModel('b', [2, 2, 2], 1, 'a'), MATS, layerOf);
  assert.equal(mesh.count, 36);
  const v = verts(mesh);
  for (let t = 0; t < 12; t++) {
    const [a, b, c] = v.slice(t * 3, t * 3 + 3);
    const geo = cross(sub(b.p, a.p), sub(c.p, a.p)), centroid = [0, 1, 2].map((k) => (a.p[k] + b.p[k] + c.p[k]) / 3);
    const out = sub(centroid, [0, 1, 0]);
    assert.ok(dot(geo, out) > 0, `triangle ${t} winds inward`);
    near(dot(a.n, a.n), 1);
    assert.ok(dot(a.n, out) > 0, `normal ${t} points inward`);
    assert.equal(a.layer, layers.get('checker'));
  }
  assert.deepEqual(mesh.center, [0, 1, 0]);
  near(mesh.radius, Math.sqrt(3));
});

test('loader: subdivision honours maxEdge, keeps area and linear UV', () => {
  const mesh = loadModel(planeModel('p', 10, 10, 2, 'a'), MATS, layerOf, { maxEdge: 3 });
  const v = verts(mesh);
  let area = 0;
  for (let t = 0; t < mesh.count / 3; t++) {
    const [a, b, c] = v.slice(t * 3, t * 3 + 3);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) assert.ok(Math.hypot(...sub(p.p, q.p)) <= 3 + 1e-4);
    area += Math.hypot(...cross(sub(b.p, a.p), sub(c.p, a.p))) / 2;
    for (const x of [a, b, c]) { near(x.uv[0], x.p[0] / 2); near(x.uv[1], x.p[2] / 2); near(x.n[1], 1); }
  }
  near(area, 100, 1e-3);
  assert.equal(mesh.count / 3, 2 * 5 * 5);
});

test('loader: smooth normals respect crease angle; groups split by DOUBLE', () => {
  const box = boxModel('b', [2, 2, 2], 1, 's');
  box.smooth = ['s'];
  const v = verts(loadModel(box, MATS, layerOf, { creaseDeg: 50 }));
  for (const x of v) assert.ok(Math.max(...x.n.map(Math.abs)) > 0.999, 'box edges stay sharp');
  // Shared-vertex cube: corners blend once the crease angle exceeds 90 degrees.
  const P = [[-1, 0, -1], [1, 0, -1], [1, 2, -1], [-1, 2, -1], [-1, 0, 1], [1, 0, 1], [1, 2, 1], [-1, 2, 1]];
  const F = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
  const shared = { name: 'c', verts: P, uvs: P.map(() => [0, 0]), faces: F.map((f) => [f, f, 's']), smooth: ['s'] };
  const soft = verts(loadModel(shared, MATS, layerOf, { creaseDeg: 100 }));
  assert.ok(soft.some((x) => Math.abs(x.n[0]) > 0.5 && Math.abs(x.n[1]) > 0.5), 'beyond crease normals blend');
  const mixed = planeModel('m', 2, 2, 1, 'a');
  mixed.faces.push([[0, 1, 2], [0, 1, 2], 'd']);
  const mesh = loadModel(mixed, MATS, layerOf);
  assert.deepEqual(mesh.groups.map((g) => [g.state, g.count]), [[0, 6], [FLAGS.DOUBLE, 3]]);
});

test('test car: triangle budget and outward normals', () => {
  const mats = { body: { tex: 'paint', flags: FLAGS.GOURAUD }, glass: { tex: 'glass', flags: 0 }, tyre: { tex: 'tyre', flags: FLAGS.GOURAUD } };
  const mesh = loadModel(testCarModel(), mats, layerOf, { maxEdge: 6, creaseDeg: 50 });
  const tris = mesh.count / 3;
  assert.ok(tris >= 500 && tris <= 1200, `${tris} triangles`);
  const v = verts(mesh);
  let outward = 0;
  for (let t = 0; t < tris; t++) {
    const [a, b, c] = v.slice(t * 3, t * 3 + 3);
    const geo = cross(sub(b.p, a.p), sub(c.p, a.p));
    if (dot(geo, a.n) > 0) outward++;
  }
  assert.ok(outward / tris > 0.98, `winding agrees with normals for ${outward}/${tris}`);
});

// ---- track ----------------------------------------------------------------
const TC = CONFIG.track;
const trackDef = TRACK_TEST_LOOP;
const track = buildTrack(trackDef, TC);
const terrain = createTerrain(track, TC, 1995);
const chunks = buildChunks(track, terrain, TC, layerOf);
const chunkLen = Math.max(4, Math.round(TC.chunkLen / track.ds));

test('track: validator reports bad definitions', () => {
  assert.deepEqual(validateTrack(trackDef), []);
  const bad = { ...trackDef, pieces: [{ len: -5, walls: 'up' }, { len: 10, tunnel: true, bridge: true }] };
  const errors = validateTrack(bad).join(' | ');
  for (const part of ['len must be > 0', 'walls must be', 'exclusive', 'startLine']) assert.ok(errors.includes(part), part);
  const badScenery = validateTrack({ ...trackDef, scenery: [{ rule: 'often', side: 'up', offset: [3] }] }).join(' | ');
  for (const part of ['every|range|line', 'obj or sprite', 'side must', 'offset must']) assert.ok(badScenery.includes(part), part);
  for (const [id, z] of Object.entries(ZONES)) for (const r of z.scenery) assert.deepEqual(validateSceneryRule(r), [], `zone ${id}`);
  assert.throws(() => buildTrack({ ...trackDef, pieces: trackDef.pieces.slice(0, 6) }, TC), /does not turn|misses/);
});

test('track: test loop is ~3 km and closes (position, height, heading)', () => {
  assert.ok(track.length > 2500 && track.length < 3500, `length ${track.length}`);
  assert.ok(track.closure.pos < TC.closeTol.pos && Math.abs(track.closure.heading) < TC.closeTol.headingDeg);
  const n = track.count, a = trackPoint(track, n - 1, 0), b = trackPoint(track, 0, 0), c = trackPoint(track, 1, 0);
  near(Math.hypot(...sub(b, a)), track.ds, 0.05);
  near(Math.hypot(...sub(c, b)), track.ds, 0.05);
  const f0 = [...track.fwd.subarray(0, 3)], fl = [...track.fwd.subarray((n - 1) * 3, n * 3)];
  assert.ok(dot(f0, fl) > 0.995, 'heading continuous across the start');
  assert.ok(track.tunnels.length === 1 && track.bridges.length === 1);
});

test('track: closure error is corrected on the last piece only', () => {
  const longer = { ...trackDef, pieces: trackDef.pieces.map((p, k) => (k === 0 ? { ...p, len: p.len + 8 } : p)) };
  const t2 = buildTrack(longer, TC);
  assert.ok(t2.closure.pos > 5, 'error was introduced');
  const lastStart = longer.pieces.slice(0, -1).reduce((a, p) => a + p.len, 0);
  const open = longer.pieces.map((p, k) => (k === longer.pieces.length - 1 ? { ...p, finishLine: true } : p));
  const ref = buildTrack({ ...longer, pieces: open, type: 'sprint', closeLoop: false }, TC);
  const i = Math.floor((lastStart - 20) / t2.ds);
  near(Math.hypot(...sub(trackPoint(t2, i, 0), trackPoint(ref, i, 0))), 0, 0.5);
  near(Math.hypot(...sub(trackPoint(t2, t2.count - 1, 0), trackPoint(t2, 0, 0))), t2.ds, 0.1);
});

test('chunks: neighbouring chunks share boundary vertices exactly (no cracks), loop seam too', () => {
  const key = (p) => p.map((v) => Math.fround(v).toFixed(3)).join(',');
  const sets = chunks.map((c) => new Set(verts(c).map((v) => key(v.p))));
  const cells = Math.ceil(trackDef.width / TC.cell);
  for (let k = 0; k < chunks.length; k++) {
    const next = (k + 1) % chunks.length, boundary = Math.min(track.segments, (k + 1) * chunkLen);
    const pts = [];
    for (let c = 0; c <= cells; c++) pts.push(trackPoint(track, boundary, -trackDef.width / 2 + (trackDef.width * c) / cells));
    for (const side of [-1, 1]) for (let j = 0; j < terrain.dist.length; j++) pts.push(terrain.profilePoint(boundary, side, j));
    for (const p of pts) {
      assert.ok(sets[k].has(key(p)), `chunk ${k} lacks boundary vertex ${key(p)}`);
      assert.ok(sets[next].has(key(p)), `chunk ${next} lacks boundary vertex ${key(p)}`);
    }
  }
});

test('chunks: far LOD has about half the triangles and the same boundary vertices as the near LOD', () => {
  const far = buildChunks(track, terrain, TC, layerOf, undefined, 2);
  assert.equal(far.length, chunks.length);
  const key = (p) => p.map((v) => Math.fround(v).toFixed(3)).join(',');
  const cells = Math.ceil(trackDef.width / TC.cell);
  let nearTris = 0, farTris = 0;
  for (let k = 0; k < chunks.length; k++) {
    nearTris += chunks[k].count / 3; farTris += far[k].count / 3;
    const set = new Set(verts(far[k]).map((v) => key(v.p)));
    for (const boundary of [k * chunkLen, Math.min(track.segments, (k + 1) * chunkLen)]) {
      for (let c = 0; c <= cells; c++) {
        const p = trackPoint(track, boundary, -trackDef.width / 2 + (trackDef.width * c) / cells);
        assert.ok(set.has(key(p)), `far chunk ${k} lacks boundary vertex`);
      }
      for (const side of [-1, 1]) for (let j = 0; j < terrain.dist.length; j++) assert.ok(set.has(key(terrain.profilePoint(boundary, side, j))), `far chunk ${k} terrain boundary`);
    }
  }
  assert.ok(farTris < nearTris * 0.62, `far ${farTris} vs near ${nearTris}`);
});

test('chunks: no degenerate triangles, normals agree with winding', () => {
  let tris = 0, flipped = 0;
  for (const c of [...chunks, ...buildBaseTerrain(track, terrain, TC, layerOf)]) {
    const v = verts(c);
    for (let t = 0; t < c.count / 3; t++) {
      const [a, b, cc] = v.slice(t * 3, t * 3 + 3);
      const g = cross(sub(b.p, a.p), sub(cc.p, a.p)), area = Math.hypot(...g) / 2;
      assert.ok(area > 1e-5, `degenerate triangle area ${area}`);
      if (!(a.flags & FLAGS.DOUBLE) && dot(g, a.n) <= 0) flipped++;
      tris++;
    }
  }
  assert.ok(flipped / tris < 0.01, `${flipped}/${tris} triangles face against their normals`);
});

test('chunks: road UV continuous along the track (whole repeats at chunk joins and the loop seam)', () => {
  const rep = loopRepeat(track, TC.roadRepeat);
  near((track.length / rep) % 1, 0, 1e-6);
  const roadLayers = new Set(['asphalt0', 'asphalt1', 'asphalt2'].map(layerOf));
  const vAt = (chunk, p) => verts(chunk).filter((x) => roadLayers.has(x.layer) && Math.hypot(...sub(x.p, p)) < 1e-3).map((x) => x.uv[1]);
  for (let k = 0; k < chunks.length; k++) {
    const next = (k + 1) % chunks.length, boundary = Math.min(track.segments, (k + 1) * chunkLen);
    const p = trackPoint(track, boundary, -trackDef.width / 2);
    const a = vAt(chunks[k], p), b = vAt(chunks[next], p);
    assert.ok(a.length && b.length, `road vertex missing at chunk join ${k}`);
    const d = a[0] - b[0];
    near(d - Math.round(d), 0, 1e-3);
  }
  // Consecutive rows step by ds / repeat.
  const c0 = verts(chunks[0]).filter((x) => roadLayers.has(x.layer)).map((x) => x.uv[1]);
  const steps = [...new Set(c0.map((v) => v.toFixed(4)))].map(Number).sort((x, y) => x - y);
  near(steps[1] - steps[0], track.ds / rep, 1e-3);
});

test('terrain: base heightfield stays below the road in tunnels (no terrain inside the tunnel)', () => {
  for (let i = 0; i < track.count; i++) {
    if (!terrain.tunnel[i]) continue;
    for (const lat of [-6, 0, 6]) {
      const p = trackPoint(track, i, lat);
      assert.ok(terrain.baseHeight(p[0], p[2]) < p[1] - 1, `base terrain above road at sample ${i}`);
    }
  }
});

test('track: segment flags cover tunnel, bridge, kerbs, walls and one start segment', () => {
  const count = (f) => track.seg.reduce((n, v) => n + ((v & f) ? 1 : 0), 0);
  near(count(SEG.TUNNEL) * track.ds, 240, track.ds * 1.5);
  near(count(SEG.BRIDGE) * track.ds, 260, track.ds * 1.5);
  assert.equal(count(SEG.START), 1);
  assert.ok(count(SEG.KERB_L) > 0 && count(SEG.WALL_L) > 0 && count(SEG.WALL_R) > 0);
});

// ---- vehicle physics ---------------------------------------------------------
const PDT = 1 / 240;
const plane = (surface = SURFACE.ASPHALT, grade = 0) => {
  const l = Math.hypot(grade, 1);
  return { sample: (x, z, o) => { o.y = -z * grade; o.nx = 0; o.ny = 1 / l; o.nz = grade / l; o.surface = surface; o.bounded = false; return o; } };
};
const ctl = (o = {}) => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, gearUp: false, gearDown: false, analog: true, ...o });
const drive = (car, c, sec, ground = plane(), stop = null) => {
  for (let t = 0; t < sec; t += PDT) {
    car.step(PDT, c, ground);
    if (stop && stop(car)) return t;
  }
  return sec;
};
const gt2 = CARS[0];
const moving = (kmh, gear) => {
  const car = new Car(gt2);
  car.vz = -kmh / 3.6;
  car.dt.gear = car.dt.target = gear;
  return car;
};

test('physics: torque curve and gear ratios', () => {
  near(torqueAt(gt2.engine.torque, 4500), 382);
  near(torqueAt(gt2.engine.torque, 5000), 377);
  assert.ok(gearRatio(gt2.gearbox, -1) < 0 && gearRatio(gt2.gearbox, 0) === 0);
  near(slipCurve(gt2.tyres.peakSlip, gt2.tyres.peakSlip, 0.8), 1);
  assert.ok(slipCurve(0.6, 0.11, 0.8) < 0.85, 'grip falls off beyond the peak');
});

test('physics: 0-100 km/h, v-max and dry braking of every car within its cars.js ranges', () => {
  for (const spec of CARS) {
    const car = new Car(spec);
    const t = drive(car, ctl({ throttle: 1 }), 20, plane(), (c) => c.speed >= 100 / 3.6);
    assert.ok(t >= spec.expect.zeroTo100[0] && t <= spec.expect.zeroTo100[1], `${spec.id} 0-100 in ${t.toFixed(2)} s`);
    drive(car, ctl({ throttle: 1 }), 70);
    const vmax = car.speed * 3.6;
    assert.ok(vmax >= spec.expect.vmax[0] && vmax <= spec.expect.vmax[1], `${spec.id} v-max ${vmax.toFixed(1)} km/h`);
    const b = new Car(spec);
    b.vz = -100 / 3.6;
    b.dt.gear = b.dt.target = 4;
    drive(b, ctl({ brake: 1 }), 20, plane(), (c) => c.speed < 0.1);
    assert.ok(-b.z >= spec.expect.brake100Dry[0] && -b.z <= spec.expect.brake100Dry[1], `${spec.id} braking ${(-b.z).toFixed(1)} m`);
  }
});

test('physics: v-max per gear reaches the rev limiter in low gears', () => {
  for (let g = 1; g <= gt2.gearbox.ratios.length; g++) {
    const car = moving(0, g);
    car.autoGear = false;
    drive(car, ctl({ throttle: 1 }), 50);
    const theo = ((gt2.engine.limiter * 2 * Math.PI) / 60) * gt2.wheelRadius / gearRatio(gt2.gearbox, g);
    if (g <= 3) near(car.speed / theo, 1, 0.05);
    assert.ok(car.speed <= theo * 1.01, `gear ${g} exceeds the limiter`);
  }
});

test('physics: braking distance 100-0 dry in range, wet clearly longer', () => {
  const dist = (wet) => {
    const car = moving(100, 4);
    car.wet = wet;
    drive(car, ctl({ brake: 1 }), 20, plane(), (c) => c.speed < 0.1);
    return -car.z;
  };
  const dry = dist(0), wet = dist(1);
  assert.ok(dry >= gt2.expect.brake100Dry[0] && dry <= gt2.expect.brake100Dry[1], `dry ${dry.toFixed(1)} m`);
  assert.ok(wet > dry * 1.2, `wet ${wet.toFixed(1)} m vs dry ${dry.toFixed(1)} m`);
});

test('physics: too fast with full lock understeers (raw: front saturated; with steer assist: front held at peak)', () => {
  const run = (assist) => {
    const saved = CONFIG.vehicle.steerAssist;
    CONFIG.vehicle.steerAssist = assist;
    const car = moving(108, 4);
    drive(car, ctl({ throttle: 0.45, steer: 1 }), 3);
    CONFIG.vehicle.steerAssist = saved;
    return [Math.abs(car.slip[0] + car.slip[1]) / 2, Math.abs(car.slip[2] + car.slip[3]) / 2];
  };
  const [rawF, rawR] = run(0), [aF, aR] = run(1.1);
  assert.ok(rawF > gt2.tyres.peakSlip * 1.5 && rawF > rawR * 2.5, `raw front ${rawF.toFixed(3)} rear ${rawR.toFixed(3)}`);
  assert.ok(Math.abs(aF - gt2.tyres.peakSlip * 1.1) < 0.02 && aF > aR * 1.5, `assisted front ${aF.toFixed(3)} rear ${aR.toFixed(3)}`);
});

test('physics: keyboard full lock at 100 km/h turns steadily without spinning (assist + traction control)', () => {
  const car = moving(100, 4);
  drive(car, ctl({ throttle: 1, steer: 1, analog: false }), 3);
  const vx = car.vx * Math.sin(car.heading) - car.vz * Math.cos(car.heading);
  const vr = car.vx * Math.cos(car.heading) + car.vz * Math.sin(car.heading);
  const sideslip = Math.abs(Math.atan2(vr, vx));
  assert.ok(car.heading > 0.9, `turned only ${(car.heading * 57.3).toFixed(0)} deg in 3 s`);
  assert.ok(sideslip < 0.15, `sideslip ${sideslip.toFixed(2)} rad (spinning)`);
});

test('physics: lifting off mid-corner makes the rear step out (lift-off oversteer)', () => {
  const car = moving(90, 3);
  drive(car, ctl({ throttle: 0.5, steer: 0.55 }), 4);
  const ratio0 = Math.abs(car.slip[2] / car.slip[0]), yaw0 = Math.abs(car.yawRate);
  drive(car, ctl({ throttle: 0, steer: 0.55 }), 0.6);
  const ratio1 = Math.abs(car.slip[2] / car.slip[0]);
  // Arcade tuning (stability assist) keeps it mild: the tail steps out and the car tightens its line.
  assert.ok(ratio1 > ratio0 * 1.15 && Math.abs(car.yawRate) >= yaw0, `rear/front slip ${ratio0.toFixed(2)} -> ${ratio1.toFixed(2)}`);
});

test('physics: grass slows the car and gives less grip; slopes pull the car downhill', () => {
  const coast = (surface) => { const car = moving(100, 4); drive(car, ctl(), 5, plane(surface)); return car.speed; };
  assert.ok(coast(SURFACE.GRASS) < coast(SURFACE.ASPHALT) - 3, 'grass drag (m/s after 5 s coasting)');
  const grip = (surface) => { const car = moving(72, 3); drive(car, ctl({ throttle: 0.3, steer: 0.6 }), 3, plane(surface)); return Math.abs(car.yawRate * car.speed); };
  assert.ok(grip(SURFACE.GRASS) < grip(SURFACE.ASPHALT) * 0.75, 'lateral grip on grass');
  const roll = new Car(gt2);
  roll.dt.gear = roll.dt.target = 0;
  drive(roll, ctl(), 3, plane(SURFACE.ASPHALT, 0.1));
  assert.ok(roll.vz > 1, `rolls back down a 10% grade (vz ${roll.vz.toFixed(2)})`);
});

test('physics + ground: scripted driver laps the test track on the road (tunnel, bridge, banking)', () => {
  const probe = new GroundProbe(track, terrain, TC), car = new Car(gt2), info = {};
  const f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
  frameAt(track, 10, f);
  car.reset(f.pos[0], f.pos[1], f.pos[2], Math.atan2(f.fwd[0], -f.fwd[2]));
  let last = 10, dist = 0, maxLat = 0, t = 0, maxGap = 0;
  for (; t < 150 && dist < track.length; t += PDT) {
    probe.sample(car.x, car.z, info, 9);
    let ds = info.s - last;
    if (ds < -track.length / 2) ds += track.length;
    dist += ds; last = info.s;
    frameAt(track, info.s + 25 + car.speed * 0.6, f);
    let ang = Math.atan2(f.pos[0] - car.x, -(f.pos[2] - car.z)) - car.heading;
    ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    let vT = 70;
    for (let d = 0; d < 150; d += 5) {
      const k = Math.abs(track.curvature[Math.round(((info.s + d) % track.length) / track.ds) % track.count]);
      vT = Math.min(vT, Math.sqrt(7 / Math.max(k, 1e-4) + 16 * d));
    }
    car.step(PDT, ctl({ steer: Math.max(-1, Math.min(1, ang * 3)), throttle: car.speed < vT ? 1 : 0, brake: car.speed > vT + 3 ? 1 : 0 }), probe);
    maxLat = Math.max(maxLat, Math.abs(info.lat));
    maxGap = Math.max(maxGap, Math.abs(car.y - info.y));
    assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y), 'state finite');
  }
  assert.ok(dist >= track.length, `lap not completed (${dist.toFixed(0)} m in ${t.toFixed(0)} s)`);
  assert.ok(t > 55 && t < 110, `lap time ${t.toFixed(1)} s`);
  assert.ok(maxLat < trackDef.width / 2, `left the road (lat ${maxLat.toFixed(1)})`);
  assert.ok(maxGap < 0.5, `body ${maxGap.toFixed(2)} m off the ground`);
});

test('cameras: external views stay above terrain, under tunnel ceilings and inside tunnel walls', () => {
  const probe = new GroundProbe(track, terrain, TC), car = new Car(gt2), pose = createPose(), info = {};
  const cams = new CarCameras(gt2, probe), cam = { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  const f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
  const k = CONFIG.cameras.clearance;
  for (let s = 0; s < track.length; s += 7) {
    frameAt(track, s, f);
    car.reset(f.pos[0] + f.right[0] * 4, f.pos[1], f.pos[2] + f.right[2] * 4, Math.atan2(f.fwd[0], -f.fwd[2]) + 0.3);
    car.step(PDT, ctl(), probe);
    updatePose(car, pose);
    for (const mode of [2, 3]) {
      cams.mode = mode;
      cams.yaw = car.heading + 0.4;
      for (const back of [false, true]) {
        cams.apply(cam, pose, car, back);
        const g = probe.sample(cam.pos[0], cam.pos[2], info, 12);
        assert.ok(cam.pos[1] >= g.y + k - 1e-3, `camera below ground at s=${s}`);
        if (g.tunnel) {
          assert.ok(cam.pos[1] <= g.ceiling - k + 1e-3, `camera above tunnel ceiling at s=${s}`);
          assert.ok(Math.abs(g.lat) <= terrain.edgeLat - k + 0.05, `camera outside tunnel wall at s=${s} (lat ${g.lat.toFixed(2)})`);
        }
      }
    }
  }
});

test('assists: auto-brake slows for corners ahead, leaves straights alone', () => {
  const corner = track.def.pieces.slice(0, 1).reduce((a, p) => a + p.len, 0);
  const atCorner = safeSpeed(track, corner - 5, 8), longStraight = safeSpeed(track, 2600, 8);
  assert.ok(atCorner < 40 && longStraight > atCorner, `corner ${atCorner.toFixed(1)} straight ${longStraight.toFixed(1)}`);
  const c = { throttle: 1, brake: 0 };
  applyAutoBrake(c, atCorner + 10, atCorner);
  assert.ok(c.throttle === 0 && c.brake > 0.9);
  const d = { throttle: 1, brake: 0 };
  applyAutoBrake(d, atCorner - 1, atCorner);
  assert.deepEqual(d, { throttle: 1, brake: 0 });
});

test('cameras: cockpit camera rolls and pitches with the car body', () => {
  const car = new Car(gt2), pose = createPose(), cams = new CarCameras(gt2, null), cam = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };
  const bank = (x, z, o) => { o.y = x * 0.5; o.nx = -0.5 / Math.hypot(0.5, 1); o.ny = 1 / Math.hypot(0.5, 1); o.nz = 0; o.surface = 0; o.bounded = false; return o; };
  car.step(PDT, ctl(), { sample: bank });
  updatePose(car, pose);
  cams.mode = 0;
  cams.apply(cam, pose, car, false);
  near(cam.roll, Math.atan(0.5), 0.02);
  cams.apply(cam, pose, car, true);
  near(cam.roll, -Math.atan(0.5), 0.02);
});

test('physics: arcade handling turns hard at high speed (>= 1.8 g at 150 km/h on keyboard lock)', () => {
  const car = moving(150, 4);
  let lat = 0, n = 0;
  for (let t = 0; t < 4; t += PDT) {
    car.step(PDT, ctl({ throttle: car.speed < 150 / 3.6 ? 1 : 0.2, steer: 1, analog: false }), plane());
    if (t > 2) { lat += car.yawRate * car.speed; n++; }
  }
  const g = lat / n / 9.81, vr = car.vx * Math.cos(car.heading) + car.vz * Math.sin(car.heading);
  assert.ok(g >= 1.8, `only ${g.toFixed(2)} g`);
  assert.ok(Math.abs(Math.atan2(vr, car.forwardSpeed)) < 0.15, 'car spins');
});

test('physics: braking hard in a corner or with a steering flick does not spin the car', () => {
  const cases = [[150, () => 1], [200, (t) => (t > 0.3 && t < 0.5 ? 1 : 0)], [150, (t) => (t > 0.5 ? 1 : 0)]];
  for (const [kmh, steer] of cases) {
    const car = moving(kmh, kmh > 160 ? 5 : 4);
    for (let t = 0; t < 1.5; t += PDT) car.step(PDT, ctl({ throttle: car.speed < kmh / 3.6 ? 1 : 0.3, steer: steer(0), analog: false }), plane());
    let worst = 0;
    for (let t = 0; t < 3 && car.speed > 30 / 3.6; t += PDT) {
      car.step(PDT, ctl({ brake: 1, steer: steer(t), analog: false }), plane());
      const vr = car.vx * Math.cos(car.heading) + car.vz * Math.sin(car.heading);
      worst = Math.max(worst, Math.abs(Math.atan2(vr, Math.abs(car.forwardSpeed))));
    }
    assert.ok(worst < 0.2, `${kmh} km/h: sideslip ${worst.toFixed(2)} rad under braking`);
  }
});

test('physics: deterministic with identical inputs', () => {
  const runOnce = () => {
    const car = new Car(gt2);
    for (let i = 0; i < 2400; i++) car.step(PDT, ctl({ throttle: 1, steer: Math.sin(i / 200) }), plane());
    return [car.x, car.z, car.heading, car.dt.rpm];
  };
  assert.deepEqual(runOnce(), runOnce());
});

// ---- scenery & zones -----------------------------------------------------------
test('materials: textures with transparent pixels are only used with CUTOUT (no index 0 in the world)', () => {
  const byName = new Map(lib.map((t) => [t.name, t]));
  const check = (where, tex, flags, variants = 1) => {
    const i = lib.findIndex((t) => t.name === tex);
    assert.ok(i >= 0, `${where}: unknown texture ${tex}`);
    for (let v = 0; v < variants; v++) {
      const t = lib[i + v];
      assert.ok(t, `${where}: variant ${v} of ${tex} missing`);
      if (t.cutout) assert.ok(flags & FLAGS.CUTOUT, `${where}: ${t.name} has transparent pixels but no CUTOUT flag`);
    }
    if (flags & FLAGS.NIGHT_ALT) check(`${where} (night)`, lib[i + 1].name, flags & ~FLAGS.NIGHT_ALT);
  };
  for (const [n, m] of Object.entries(SCENERY_MATERIALS)) check(`scenery.${n}`, m.tex, m.flags, m.flags & FLAGS.VARIANT ? 4 : 1);
  for (const [n, m] of Object.entries(CAR_MATERIALS)) check(`car.${n}`, m.tex, m.flags);
  for (const [n, m] of Object.entries(LINES)) check(`line.${n}`, m.tex, m.flags);
  for (const n of Object.keys(SPRITES)) assert.ok(byName.get(n)?.cutout, `sprite ${n} must be a cutout texture`);
  assert.equal(lib[lib.findIndex((t) => t.name === 'windows') + 1].name, 'windowsNight', 'NIGHT_ALT relies on library order');
});

test('scenery: every zone builds on the test track; objects stay off the road, out of tunnels; deterministic', () => {
  const probe = new GroundProbe(track, terrain, TC), info = {};
  for (const [id, zone] of Object.entries(ZONES)) {
    for (const t of Object.values(zone.ground)) assert.ok(layers.has(t), `${id}: ground texture ${t}`);
    const rules = [...zone.scenery, ...(trackDef.scenery || [])];
    const a = buildScenery(track, terrain, probe, rules, { cfg: TC, seed: 1995, layerOf });
    const b = buildScenery(track, terrain, probe, rules, { cfg: TC, seed: 1995, layerOf });
    assert.equal(JSON.stringify(a.objects.map((o) => [...o.data])), JSON.stringify(b.objects.map((o) => [...o.data])), `${id} not deterministic`);
    assert.ok(a.objects.length > 0 && a.sprites.length > 0, `${id}: empty scenery`);
    for (const g of a.objects) {
      assert.ok(SCENERY_MODELS[g.name], `${id}: unknown object ${g.name}`);
      for (const p of g.positions) {
        probe.hints[0] = -1;
        const s = probe.sample(p[0], p[2], info, 0);
        assert.ok(Math.abs(s.lat) > terrain.edgeLat, `${id}: ${g.name} on the road`);
        assert.ok(!s.tunnel, `${id}: ${g.name} in a tunnel`);
      }
    }
  }
});

test('collisions: guardrails stop the car (lateral limit) and scenery objects are solid', () => {
  for (const name of Object.keys(SCENERY_MODELS)) assert.ok(COLLIDERS[name], `no collider for ${name}`);
  const probe = new GroundProbe(track, terrain, TC);
  const scenery = buildScenery(track, terrain, probe, [...ZONES.raceway.scenery, ...trackDef.scenery], { cfg: TC, seed: 1995, layerOf });
  probe.setLineLimits(scenery.limits);
  const world = new StaticColliders(scenery.colliders), info = {}, f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
  // Guardrail at 11 m on the straight (s 500-700): drive into it at 100 km/h, 25 degrees off.
  const car = new Car(gt2), half = gt2.body.width / 2;
  frameAt(track, 600, f);
  const h = Math.atan2(f.fwd[0], -f.fwd[2]) + 0.45;
  car.reset(f.pos[0], f.pos[1], f.pos[2], h);
  car.vx = Math.sin(h) * 27.8; car.vz = -Math.cos(h) * 27.8;
  let maxLat = 0;
  for (let t = 0; t < 2; t += PDT) {
    car.step(PDT, ctl(), probe);
    collideCarStatic(car, world);
    maxLat = Math.max(maxLat, probe.sample(car.x, car.z, info, 9).lat);
  }
  assert.ok(maxLat <= 11 - 0.2 - half + 0.05, `went through the guardrail (lat ${maxLat.toFixed(2)})`);
  // Tyre stack: aim straight at one at 60 km/h; the car must never overlap it.
  const stack = scenery.objects.find((o) => o.name === 'tyreStack').positions[0];
  const c2 = new Car(gt2);
  c2.reset(stack[0] + 18, stack[1], stack[2], -Math.PI / 2);
  c2.vx = -16.7;
  let worst = 0, impact = 0;
  for (let t = 0; t < 2.5; t += PDT) {
    c2.step(PDT, ctl(), { sample: (x, z, o) => { o.y = stack[1]; o.nx = 0; o.ny = 1; o.nz = 0; o.surface = 0; o.bounded = false; return o; } });
    collideCarStatic(c2, world);
    impact = Math.max(impact, c2.impact);
    for (const k of [-1.6, 0, 1.6]) {
      const hit = world.circle(c2.x + Math.sin(c2.heading) * k, c2.z - Math.cos(c2.heading) * k, half);
      if (hit) worst = Math.max(worst, hit.pen);
    }
  }
  assert.ok(worst < 0.1, `overlaps the tyre stack by ${worst.toFixed(2)} m`);
  assert.ok(impact > 5, `no impact registered (${impact.toFixed(1)} m/s)`);
});

test('collisions: hitting walls at tunnel portals, bridge ends and wall starts never launches the car', () => {
  const probe = new GroundProbe(track, terrain, TC);
  const scenery = buildScenery(track, terrain, probe, [...ZONES.raceway.scenery, ...trackDef.scenery], { cfg: TC, seed: 1995, layerOf });
  probe.setLineLimits(scenery.limits);
  const world = new StaticColliders([...scenery.colliders, ...narrowingWalls(track, terrain, { SEG, frameAt })]);
  const f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] }, info = {};
  const spots = [track.tunnels[0].from, track.tunnels[0].to, track.bridges[0].from, track.bridges[0].to];
  for (let i = 1; i < track.segments; i++) if ((track.seg[i] & (SEG.WALL_L | SEG.WALL_R)) && !(track.seg[i - 1] & (SEG.WALL_L | SEG.WALL_R))) spots.push(i * track.ds);
  let worst = 0, where = '';
  for (const at of spots) {
    for (const [back, side, ang] of [[40, 1, 0.35], [25, -1, 0.35], [12, 1, 0.5], [60, 1, 0.25], [8, -1, 0.6], [30, -1, 0.45]]) {
      frameAt(track, at - back, f);
      const h = Math.atan2(f.fwd[0], -f.fwd[2]) + side * ang, car = new Car(gt2);
      car.reset(f.pos[0], f.pos[1], f.pos[2], h);
      car.vx = Math.sin(h) * 28; car.vz = -Math.cos(h) * 28;
      for (let t = 0; t < 3; t += PDT) {
        car.step(PDT, ctl({ throttle: 0.5 }), probe);
        collideCarStatic(car, world);
        const up = car.y - probe.sample(car.x, car.z, info, 9).y;
        if (up > worst) { worst = up; where = `s=${at.toFixed(0)} back=${back} side=${side}`; }
      }
    }
  }
  assert.ok(worst < 0.3, `car lifted ${worst.toFixed(2)} m off the ground (${where})`);
});

// ---- stage 5: racing line, race logic, AI, collisions, damage -------------------
const raceWorld = (() => {
  const probe = new GroundProbe(track, terrain, TC);
  const sc = buildScenery(track, terrain, probe, [...ZONES.raceway.scenery, ...trackDef.scenery], { cfg: TC, seed: 1995, layerOf });
  probe.setLineLimits(sc.limits);
  const colliders = new StaticColliders([...sc.colliders, ...narrowingWalls(track, terrain, { SEG, frameAt })]);
  const line = buildRacingLine(track, { ...CONFIG.ai.line, latBoost: arcadeLatBoost });
  return { probe, colliders, line };
})();
const newSim = (o = {}) => new RaceSim({ track, probe: raceWorld.probe, colliders: raceWorld.colliders, line: raceWorld.line, spec: gt2, ai: 7, laps: 3, seed: 1995, playerAi: true, ...o });
const CTL = ctl();
const runSim = (sim, seconds, every) => {
  for (let i = 0; i < seconds * 60 && sim.race.phase !== 'finished'; i++) { sim.step(1 / 60, CTL, CTL); if (every) every(sim, i); }
  return sim;
};

test('racing line: inside the carriageway with margin, smoother than the centreline, consistent speeds', () => {
  const { line } = raceWorld, limit = trackDef.width / 2 - CONFIG.ai.line.margin;
  // Summed squared curvature (the minimised objective), measured the same way for line and centreline.
  const kappa = (X, Z, i) => {
    const n = track.count, a = (i - 2 + n) % n, c = (i + 2) % n;
    const ax = X(i) - X(a), az = Z(i) - Z(a), bx = X(c) - X(i), bz = Z(c) - Z(i);
    return Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz)) / ((Math.hypot(ax, az) + Math.hypot(bx, bz)) / 2);
  };
  let lineK = 0, centreK = 0;
  for (let i = 0; i < track.count; i++) {
    assert.ok(Math.abs(line.offset[i]) <= limit + 1e-6, `offset ${line.offset[i]} at ${i}`);
    lineK += kappa((k) => line.x[k], (k) => line.z[k], i) ** 2;
    centreK += kappa((k) => track.pos[k * 3], (k) => track.pos[k * 3 + 2], i) ** 2;
  }
  assert.ok(lineK < centreK * 0.85, `line sum k^2 ${lineK.toExponential(2)} vs centre ${centreK.toExponential(2)}`);
  assert.ok(Math.max(...line.offset.map(Math.abs)) > limit * 0.8, 'line uses the width (apexes)');
  for (let i = 0; i < track.count; i++) {
    const j = (i + 1) % track.count, ds = Math.hypot(line.x[j] - line.x[i], line.z[j] - line.z[i]);
    assert.ok(line.speed[i] > 10 && line.speed[i] <= Math.sqrt(line.speed[j] ** 2 + 2 * CONFIG.ai.line.brake * ds) + 1e-3, `speed profile at ${i}`);
  }
});

test('race logic: laps need all checkpoints in order (cutting / reversing earns nothing), positions, finish, false start', () => {
  const cfg = { laps: 2, ...CONFIG.race, goDelay: 0.5 };
  const race = new Race(track, [{ id: 0, name: 'A', isPlayer: true }, { id: 1, name: 'B', isPlayer: false }], cfg);
  const L = track.length, s = [L - 20, L - 28];
  // Countdown: the player creeps forward -> false start penalty.
  for (let t = 0; t < race.goAt + 0.1; t += 0.1) { if (t > 1) s[0] = L - 18; race.update(0.1, s); }
  assert.equal(race.phase, 'running');
  assert.ok(race.entries[0].falseStart && race.entries[0].penalty === cfg.falseStartPenalty);
  const drive = (k, to, step = 5) => { while (s[k] < to) { s[k] = Math.min(to, s[k] + step); race.update(0.1, s); } };
  // B drives a clean lap; A cuts: jumps 300 m forward in one go (no credit), then rejoins.
  drive(1, L + L + 10);
  assert.equal(race.entries[1].lap, 1, 'clean lap counted');
  drive(0, L + 200);
  s[0] = L + 500; race.update(0.1, s);
  drive(0, L + L + 10);
  assert.equal(race.entries[0].lap, 0, 'cut lap not counted');
  assert.equal(race.entries[1].position, 1);
  // Reversing over the line and crossing again does not count either.
  s[1] = L + L - 5; race.update(0.1, s); s[1] = L + L + 5; race.update(0.1, s);
  assert.equal(race.entries[1].lap, 1);
  drive(1, 3 * L + 10);
  assert.ok(race.entries[1].finished && race.entries[1].order === 1, 'B finished first');
  assert.equal(race.results()[0].name, 'B');
  assert.ok(race.entries[1].lapTimes.length === 2 && race.entries[1].best > 0);
});

test('race sim: deterministic with a seed (AI positions after 60 s)', () => {
  const snap = () => runSim(newSim(), 60).cars.map((c) => [c.car.x, c.car.z, c.car.heading]);
  assert.deepEqual(snap(), snap());
});

test('AI: overtakes slower cars without passing through them; drivers differ and make mistakes', () => {
  // Same car for everyone: this checks the driving and passing logic, not the car balance.
  const sim = newSim({ drivers: [...DRIVERS].reverse().map((d) => ({ ...d, car: 0 })) });
  let minDist = Infinity, errors = 0;
  const kinds = new Set();
  runSim(sim, 260, (s) => {
    if (s.race.phase !== 'running') return;
    for (const c of s.cars) if (c.ai.errorKind) kinds.add(`${c.name}:${c.ai.errorKind}`), errors++;
    for (let a = 0; a < s.cars.length; a++) {
      for (let b = a + 1; b < s.cars.length; b++) {
        if (s.cars[a].ghost > 0 || s.cars[b].ghost > 0) continue;
        minDist = Math.min(minDist, Math.hypot(s.cars[a].car.x - s.cars[b].car.x, s.cars[a].car.z - s.cars[b].car.z));
      }
    }
  });
  const res = sim.race.results();
  assert.equal(sim.race.phase, 'finished');
  assert.ok(res.every((e) => e.finished), 'everyone finishes');
  assert.notEqual(res[0].name, 'G. ORLAN', 'the slowest driver (pole) gets overtaken');
  assert.ok(res.findIndex((e) => e.name === 'G. ORLAN') >= 3, 'slowest driver drops back');
  assert.ok(minDist > 1.2, `cars overlapped (centres ${minDist.toFixed(2)} m apart)`);
  assert.ok(kinds.size >= 2 && errors > 0, 'AI makes mistakes');
  const bests = res.map((e) => e.best);
  assert.ok(Math.max(...bests) - Math.min(...bests) > 1, 'drivers differ in pace');
});

test('collisions: car-car contact separates the cars and exchanges momentum', () => {
  const a = new Car(gt2), b = new Car(gt2);
  a.reset(0, 0, 0, 0); b.reset(1.0, 0, -1.0, 0);
  a.vx = 10; b.vx = -10;
  const cars = [{ car: a, ghost: 0 }, { car: b, ghost: 0 }];
  collideCars(cars);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1.5, 'still overlapping');
  assert.ok(a.vx < 10 && b.vx > -10, 'velocities exchanged');
  near(a.vx * gt2.mass + b.vx * gt2.mass, 0, 1e-6);
  assert.ok(a.impact > 0 && b.impact > 0);
});

test('damage: impacts load the hit zone; dents are bounded, finite and swap textures', () => {
  const d = new Damage(CONFIG.damage);
  d.hit(0, 25, 0, 1);
  assert.ok(d.zones[ZONE.FRONT] > 0.5 && d.zones[ZONE.REAR] === 0 && d.version > 0, 'front hit');
  d.hit(0, 20, -1, 0);
  assert.ok(d.zones[ZONE.RIGHT] > 0.3, 'right side hit');
  d.hit(0, 3, 1, 0);
  assert.equal(d.zones[ZONE.LEFT], 0, 'light touches leave no mark');
  const base = loadModel(buildCarModel(gt2, 0), CAR_MATS, layerOf, { maxEdge: 4, creaseDeg: 50 });
  const out = base.buffer.slice(0), b = gt2.body;
  const shape = { zFront: -(b.length - b.rearOverhang), zRear: b.rearOverhang, half: b.width / 2, dentMax: CONFIG.damage.dentMax };
  const L5 = { body: [layerOf('livery')], scratched: layerOf('liveryScratched'), headlight: layerOf('headlight'), taillight: layerOf('taillight'), headBroken: layerOf('headlightBroken'), tailBroken: layerOf('taillightBroken') };
  deformCar(base, out, new Float32Array([1, 1, 1, 1]), shape, L5);
  const src = new Float32Array(base.buffer), dst = new Float32Array(out), u = new Uint32Array(out);
  let moved = 0, swapped = 0;
  for (let i = 0; i < base.count; i++) {
    const o = i * VERTEX_WORDS, dx = dst[o] - src[o], dz = dst[o + 2] - src[o + 2];
    assert.ok(Number.isFinite(dst[o]) && Math.hypot(dx, dz) <= Math.SQRT2 * CONFIG.damage.dentMax + 1e-6, 'dent bounded');
    assert.ok(Math.abs(dst[o]) <= Math.abs(src[o]) + 1e-6 || Math.abs(src[o]) < 0.3, 'dents only go inward (x)');
    if (Math.hypot(dx, dz) > 1e-4) moved++;
    if (u[o + 8] === L5.scratched || u[o + 8] === L5.headBroken || u[o + 8] === L5.tailBroken) swapped++;
  }
  assert.ok(moved > 50 && swapped > 30, `moved ${moved}, swapped ${swapped}`);
});

// ---- stage 6: cars, liveries, tracks, sprint, championship, ghost ---------------
test('cars: six distinct cars - drivetrains, turbo lag, wet grip, handling data', () => {
  assert.equal(CARS.length, 6);
  assert.equal(new Set(CARS.map((c) => c.id)).size, 6);
  assert.deepEqual([...new Set(CARS.map((c) => c.drive.type))].sort(), ['AWD', 'RWD']);
  // Turbo lag: boost builds up over about a second, not instantly.
  const breeze = CARS.find((c) => c.id === 'breezeTurbo'), car = new Car(breeze);
  car.vz = -20; car.dt.gear = car.dt.target = 3;
  drive(car, ctl({ throttle: 1 }), 0.3);
  const early = car.dt.boost;
  drive(car, ctl({ throttle: 1 }), 2);
  assert.ok(early < 0.5 && car.dt.boost > 0.8, `boost ${early.toFixed(2)} -> ${car.dt.boost.toFixed(2)}`);
  // The 4x4 sedan stops shortest in the wet.
  const wet = (spec) => { const c = new Car(spec); c.vz = -100 / 3.6; c.dt.gear = c.dt.target = 4; c.wet = 1; drive(c, ctl({ brake: 1 }), 20, plane(), (k) => k.speed < 0.1); return -c.z; };
  const kestrel = wet(CARS.find((c) => c.id === 'kestrelST'));
  for (const spec of CARS) if (spec.id !== 'kestrelST') assert.ok(kestrel < wet(spec), `${spec.id} brakes shorter in the wet`);
  const sig = (c) => [c.mass, c.engine.torque[3][1], c.steer.rate, c.tyres.mu, c.body.length].join();
  assert.equal(new Set(CARS.map(sig)).size, 6, 'handling data differs');
});

test('car models: every car within triangle budgets per LOD; livery UVs inside the 128 px layout', () => {
  for (const spec of CARS) {
    const tris = [0, 1, 2].map((l) => loadModel(buildCarModel(spec, l), CAR_MATS, layerOf, { maxEdge: 4, creaseDeg: 50 }).count / 3);
    assert.ok(tris[0] >= 500 && tris[0] <= 1200 && tris[1] <= 400 && tris[2] <= 120, `${spec.id} triangles ${tris}`);
    const m = buildCarModel(spec, 0);
    for (const f of m.faces) {
      if (f[2] !== 'body') continue;
      for (const k of f[1]) assert.ok(m.uvs[k].every((v) => v >= -1e-6 && v <= 2 + 1e-6), `${spec.id} body uv ${m.uvs[k]}`);
    }
  }
});

test('liveries: 128 px per grid slot, deterministic, differ by car/colour/number; scratched variants', () => {
  const liv = lib.filter((t) => t.name.startsWith('livery'));
  assert.equal(liv.length, 16);
  assert.ok(liv.every((t) => t.size === 128 && t.data.length === 128 * 128 && !t.cutout));
  assert.equal(new Set(liv.map((t) => hashBytes(t.data))).size, 16, 'every slot differs');
  const a = generateLibrary(1995, gridLiveries(2, 1)), b = generateLibrary(1995, gridLiveries(2, 1)), c = generateLibrary(1995, gridLiveries(2, 2));
  const slot = (l) => l.find((t) => t.name === `livery${PLAYER_SLOT}`);
  assert.equal(hashBytes(slot(a).data), hashBytes(slot(b).data));
  assert.notEqual(hashBytes(slot(a).data), hashBytes(slot(c).data), 'colour sets differ');
  // Layer data: a livery fills its near layer 1:1 (no 2x2 tiling).
  const data = buildLayerData(a, pal, false), i = a.indexOf(slot(a)), L = LAYER_SIZE, base = i * 2 * L * L;
  assert.equal(data[base + 100 * L + 90], slot(a).data[100 * 128 + 90]);
});

const RACE_TRACKS = TRACKS.filter((t) => t.id !== 'testLoop');
const builtTracks = RACE_TRACKS.map((def) => buildTrack(def, TC));

test('tracks: five valid tracks (4 circuits + 1 sprint), long, with tunnels, bridges and height changes', () => {
  assert.equal(RACE_TRACKS.length, 5);
  assert.equal(RACE_TRACKS.filter((t) => t.type === 'circuit').length, 4);
  assert.equal(RACE_TRACKS.filter((t) => t.type === 'sprint').length, 1);
  assert.equal(new Set(RACE_TRACKS.map((t) => t.zone)).size, 5, 'each track in its own zone');
  for (const [k, t] of builtTracks.entries()) {
    const def = RACE_TRACKS[k];
    assert.deepEqual(validateTrack(def), []);
    assert.ok(ZONES[def.zone], `${def.id} zone`);
    assert.ok(t.length > 3500, `${def.id} length ${t.length}`);
    assert.ok(t.tunnels.length + t.bridges.length >= 2, `${def.id} tunnels/bridges`);
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < t.count; i++) { y0 = Math.min(y0, t.pos[i * 3 + 1]); y1 = Math.max(y1, t.pos[i * 3 + 1]); }
    assert.ok(y1 - y0 > 8, `${def.id} height range ${(y1 - y0).toFixed(1)} m`);
    if (t.closed) assert.ok(t.closure.pos < 2 && Math.abs(t.closure.heading) < 0.5 && Math.abs(t.closure.height) < 1, `${def.id} closes as designed`);
  }
});

test('tracks: no part of a track comes near another part (separate terrain ribbons)', () => {
  for (const t of builtTracks) {
    const n = t.count, gap = Math.round(400 / t.ds);
    let min = Infinity;
    for (let i = 0; i < n; i += 2) {
      for (let j = i + gap; j < n; j += 2) {
        if (t.closed && n - (j - i) < gap) continue;
        min = Math.min(min, Math.hypot(t.pos[i * 3] - t.pos[j * 3], t.pos[i * 3 + 2] - t.pos[j * 3 + 2]));
      }
    }
    assert.ok(min > 2 * TC.ribbonWidth * 0.9, `${t.def.id} min distance ${min.toFixed(0)} m`);
  }
});

test('sprint: lead-in, finish line and run-out; racing line stays on the road; race ends at the finish', () => {
  const k = RACE_TRACKS.findIndex((t) => t.type === 'sprint'), t = builtTracks[k];
  assert.ok(t.startS >= 100 && t.finishS > t.startS + 3000 && t.length - t.finishS >= 200, 'lead-in / run-out');
  assert.equal(t.seg.reduce((n, v) => n + (v & SEG.FINISH ? 1 : 0), 0), 1);
  const line = buildRacingLine(t, { ...CONFIG.ai.line, latBoost: arcadeLatBoost }), limit = t.def.width / 2 - CONFIG.ai.line.margin;
  assert.ok(line.offset.every((v) => Math.abs(v) <= limit + 1e-6) && line.speed.every((v) => v > 5));
  const race = new Race(t, [{ id: 0, name: 'A', isPlayer: true }, { id: 1, name: 'B', isPlayer: false }], { ...CONFIG.race, laps: 3, goDelay: 0.5 });
  assert.equal(race.cfg.laps, 1, 'a sprint is one run');
  const s = [t.startS - 20, t.startS - 28];
  while (race.phase === 'countdown') race.update(0.1, s);
  const go = (i, to, step = 5) => { while (s[i] < to) { s[i] = Math.min(to, s[i] + step); race.update(0.1, s); } };
  go(1, t.startS + 1000);
  s[1] = t.startS + 1500; race.update(0.1, s); // jump: no credit
  go(1, t.finishS + 20);
  assert.ok(!race.entries[1].finished, 'skipped checkpoints');
  go(0, t.finishS + 20);
  assert.ok(race.entries[0].finished && race.entries[0].order === 1 && race.entries[0].lapTimes.length === 1);
  assert.equal(race.results()[0].name, 'A');
});

test('sprint race sim: every car finishes and stops before the end of the road', () => {
  const k = RACE_TRACKS.findIndex((t) => t.type === 'sprint'), t = builtTracks[k], def = RACE_TRACKS[k];
  const ter = createTerrain(t, TC, 1995), probe = new GroundProbe(t, ter, TC);
  const sc = buildScenery(t, ter, probe, [...ZONES[def.zone].scenery, ...def.scenery], { cfg: TC, seed: 1995, layerOf });
  probe.setLineLimits(sc.limits);
  const colliders = new StaticColliders([...sc.colliders, ...narrowingWalls(t, ter, { SEG, frameAt })]);
  const line = buildRacingLine(t, { ...CONFIG.ai.line, latBoost: arcadeLatBoost });
  const sim = new RaceSim({ track: t, probe, colliders, line, spec: gt2, ai: 7, laps: 1, seed: 1995, playerAi: true });
  runSim(sim, 200);
  assert.equal(sim.race.phase, 'finished');
  for (let i = 0; i < 60 * 15; i++) sim.step(1 / 60, CTL, CTL);
  for (const c of sim.cars) {
    assert.ok(c.pos.s < t.length - 20, `${c.name} ran off the end (${c.pos.s.toFixed(0)})`);
    assert.ok(c.car.speed < 2, `${c.name} still moving`);
  }
  assert.ok(new Set(sim.cars.map((c) => c.spec.id)).size >= 6, 'rivals drive different cars');
});

test('championship: points table, countback tie-break, latest result, champion', () => {
  const season = { rounds: [{}, {}, {}], points: [10, 8, 6, 5] };
  const ch = new Championship(season, [0, 1, 2, 3].map((id) => ({ id, name: `D${id}`, isPlayer: id === 3 })));
  ch.addResult([0, 1, 2, 3]);
  ch.addResult([1, 0, 3, 2]);
  assert.deepEqual(ch.standings().map((r) => r.points), [18, 18, 11, 11]);
  // 0 and 1 tie on points and wins; equal second places too -> better latest result (1 won round 2).
  assert.deepEqual(ch.standings().map((r) => r.id).slice(0, 2), [1, 0]);
  assert.deepEqual(ch.standings().map((r) => r.id).slice(2), [3, 2], 'latest result breaks a full countback tie');
  assert.ok(!ch.finished && ch.champion() === null);
  ch.addResult([3, 2, 1, 0]);
  assert.ok(ch.finished);
  assert.equal(ch.champion().id, 1);
  assert.deepEqual(ch.standings().find((r) => r.id === 3).places, [4, 3, 1]);
  assert.throws(() => ch.addResult([0, 1, 2, 3]));
  assert.ok(SEASON.rounds.every((r) => TRACKS.some((t) => t.id === r.track)) && SEASON.rounds.length === 5, 'season covers every track');
  assert.ok(CARS.some((c) => c.id === SEASON.unlock) && SEASON.locked.includes(SEASON.unlock));
});

test('storage: defaults without localStorage, round trip, damaged data dropped, locked cars', () => {
  assert.deepEqual(loadSave(), emptySave());
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  try {
    const save = emptySave();
    save.unlocked.push('auroraRS');
    save.options.units = 1;
    offerRecord(save, 'harbour', { lap: 62.5, race: 200, car: 'vektorGT2', name: 'PLAYER' });
    writeSave(save);
    assert.deepEqual(loadSave(), save);
    mem.set('roadline95', JSON.stringify({ unlocked: [3, 'x'], options: { units: 'a', mirror: 1 }, records: { a: { lap: { time: -1 } } }, champ: { titles: 2.5 } }));
    assert.deepEqual(loadSave(), { unlocked: ['x'], options: { mirror: 1 }, records: {}, champ: { seasons: 0, titles: 0, best: 0 } });
    mem.set('roadline95', '{broken');
    assert.deepEqual(loadSave(), emptySave());
  } finally {
    delete globalThis.localStorage;
  }
  const save = emptySave();
  assert.ok(!carAvailable('auroraRS', SEASON.locked, save) && carAvailable('vektorGT2', SEASON.locked, save));
  assert.ok(carAvailable('auroraRS', SEASON.locked, { unlocked: ['auroraRS'] }));
});

test('ghost: replays the best lap exactly, keeps it against slower laps', () => {
  const g = new Ghost(1000), car = new Car(gt2), out = { groundNormal: [0, 0, 0] };
  const lap = (n, speed) => { for (let i = 0; i < n; i++) { car.x = i * speed; car.z = -i; car.heading = i * 0.01; g.record(car); } };
  lap(100, 1); assert.ok(g.lapDone(50) && g.ready);
  lap(120, 2); assert.ok(!g.lapDone(60), 'slower lap ignored');
  assert.ok(g.sample(40, out) && out.x === 40 && out.z === -40 && near(out.heading, 0.4, 1e-6) === undefined);
  assert.ok(!g.sample(100, out), 'past the end of the best lap');
  lap(90, 3); assert.ok(g.lapDone(45));
  g.sample(10, out); assert.equal(out.x, 30);
  lap(1001, 1); assert.ok(!g.lapDone(1), 'overflowing lap is not kept');
});

// ---- stage 7: samples, tracker, songs, engine sound ------------------------------
const SAMPLES = generateSamples(CARS, 1995);

test('samplegen: deterministic, finite, within -1..1, every sound and every car engine present', () => {
  const again = generateSamples(CARS, 1995), other = generateSamples(CARS, 7);
  let differs = 0;
  for (const [name, s] of SAMPLES) {
    assert.ok(s.data.length > 100, `${name} length`);
    assert.ok(s.data.every((v) => Number.isFinite(v) && Math.abs(v) <= 1), `${name} range`);
    assert.equal(hashBytes(new Uint8Array(s.data.buffer)), hashBytes(new Uint8Array(again.get(name).data.buffer)), `${name} deterministic`);
    if (hashBytes(new Uint8Array(s.data.buffer)) !== hashBytes(new Uint8Array(other.get(name).data.buffer))) differs++;
  }
  assert.ok(differs > SAMPLES.size / 2, 'seed changes the sounds');
  for (const n of ['squeal', 'gravel', 'grass', 'kerb', 'scrape', 'impact', 'impactMetal', 'turbo', 'blowoff', 'shift', 'crowd', 'rain', 'wind',
    'beepLow', 'beepHigh', 'kick', 'snare', 'hat', 'hatOpen', 'crash', 'bass', 'lead', 'pad', 'organ', 'guitar', 'pluck', 'stab']) assert.ok(SAMPLES.has(n), `missing ${n}`);
  for (const c of CARS) for (let k = 0; k < 3; k++) for (const l of ['on', 'off']) assert.ok(SAMPLES.has(`engine:${c.id}:${k}:${l}`));
});

test('samplegen: engine loops at the requested revs, seamless; instruments tuned', () => {
  const rms = (d) => Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
  for (const c of CARS) {
    const ranges = engineRanges(c);
    ranges.forEach((rpm, k) => {
      const s = SAMPLES.get(`engine:${c.id}:${k}:on`), d = s.data;
      near(s.baseRpm / rpm, 1, 0.04);
      // The jump across the loop point is no bigger than ordinary sample-to-sample steps.
      let maxStep = 0;
      for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
      assert.ok(Math.abs(d[0] - d[d.length - 1]) <= maxStep, `${c.id} ${k} loop seam`);
      assert.ok(rms(d) > 0.05, `${c.id} ${k} audible`);
    });
  }
  // Different cars sound different (cylinders, resonances).
  assert.notEqual(SAMPLES.get('engine:vektorGT2:1:on').baseRpm.toFixed(0) + SAMPLES.get('engine:vektorGT2:1:on').data.length,
    SAMPLES.get('engine:halcyonV12:1:on').baseRpm.toFixed(0) + SAMPLES.get('engine:halcyonV12:1:on').data.length);
  for (const [name, midiNote] of [['bass', 36], ['lead', 60], ['pad', 60], ['pluck', 60], ['guitar', 40]]) {
    const s = SAMPLES.get(name);
    near(s.baseFreq / (440 * 2 ** ((midiNote - 69) / 12)), 1, 0.01);
    if (s.loop) assert.ok(s.loopStart > 0 && s.loopStart < s.data.length);
  }
  for (const n of ['squeal', 'gravel', 'grass', 'crowd', 'rain', 'wind', 'scrape', 'turbo', 'kerb']) {
    const d = SAMPLES.get(n).data;
    let maxStep = 0;
    for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
    assert.ok(Math.abs(d[0] - d[d.length - 1]) <= maxStep * 1.5, `${n} loop seam`);
  }
});

const tSong = (rows, o = {}) => {
  const cells = new Array(64 * 8).fill(null);
  rows.forEach(([r, ch, cell]) => { cells[r * 8 + ch] = { note: null, inst: 0, vol: null, fx: null, param: 0, ...cell }; });
  return { id: 't', name: 'T', tempo: 125, speed: 6, instruments: ['lead'], pan: Array(8).fill(0), order: [0, 0], loop: 1, patterns: [{ rows: 64, cells }], ...o };
};
const runRows = (core, n) => { const ev = []; for (let i = 0; i < n; i++) { const k = core.nextRow(); for (let j = 0; j < k; j++) ev.push({ ...core.events[j] }); } return ev; };

test('tracker: row timing for tempo and speed, speed/tempo commands, order loop', () => {
  near(rowSeconds(125, 6), 0.12, 1e-9);
  near(rowSeconds(150, 3), 0.05, 1e-9);
  const core = new TrackerCore(tSong([[0, 0, { note: 60 }], [4, 0, { fx: 'F', param: 3 }], [8, 0, { fx: 'F', param: 150 }]]));
  runRows(core, 4);
  near(core.time, 4 * 0.12, 1e-9);
  runRows(core, 4);
  near(core.time, 4 * 0.12 + 4 * rowSeconds(125, 3), 1e-9);
  runRows(core, 1);
  near(core.time, 4 * 0.12 + 4 * rowSeconds(125, 3) + rowSeconds(150, 3), 1e-9);
  runRows(core, 64 * 2 - 9);
  assert.equal(core.order, 1, 'loops to song.loop after the last order entry');
});

test('tracker: effects - arpeggio, slides, tone portamento, vibrato, volume slide, retrigger, note off', () => {
  const pitches = (ev, kind = 'pitch') => ev.filter((e) => e.kind === kind).map((e) => e.pitch);
  let ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60, fx: '0', param: 0x37 }]])), 1);
  assert.deepEqual(pitches(ev), [63, 67, 60, 63, 67]);
  ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60, fx: '1', param: 8 }]])), 1);
  assert.deepEqual(pitches(ev), [60.5, 61, 61.5, 62, 62.5]);
  ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60 }], [1, 0, { note: 62, fx: '3', param: 16 }], [2, 0, { fx: '3', param: 16 }]])), 3);
  const p = pitches(ev);
  assert.equal(p[p.length - 1], 62, 'portamento stops at the target');
  assert.ok(p.every((v, i) => i === 0 || v >= p[i - 1]), 'monotonic');
  assert.equal(ev.filter((e) => e.kind === 'note').length, 1, 'tone portamento does not retrigger');
  ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60, fx: '4', param: 0x88 }], [1, 0, { fx: '4', param: 0x88 }], [2, 0, {}]])), 3);
  const vib = pitches(ev);
  assert.ok(Math.max(...vib) > 60.5 && Math.min(...vib) < 59.5, 'vibrato swings both ways');
  assert.equal(vib[vib.length - 1], 60, 'pitch restored after vibrato');
  ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60, vol: 10, fx: 'A', param: 0x04 }]])), 1);
  assert.deepEqual(ev.filter((e) => e.kind === 'vol').map((e) => e.vol), [6, 2, 0, 0, 0]);
  ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60, fx: 'R', param: 2 }]])), 1);
  assert.equal(ev.filter((e) => e.kind === 'note').length, 3, 'note + retriggers on ticks 2 and 4');
  ev = runRows(new TrackerCore(tSong([[0, 0, { note: 60 }], [1, 0, { note: -1 }]])), 2);
  assert.equal(ev[ev.length - 1].kind, 'off');
});

test('songs: four original songs compile, use existing instruments, sensible length and range', () => {
  assert.equal(SONGS.length, 4);
  for (const id of [MUSIC.menu, MUSIC.results, ...MUSIC.race]) assert.ok(SONGS.some((s) => s.id === id), id);
  for (const s of SONGS) {
    assert.equal(s.pan.length, 8);
    for (const n of s.instruments) assert.ok(SAMPLES.has(n), `${s.id}: instrument ${n}`);
    const core = new TrackerCore(s);
    let notes = 0, melodic = new Set();
    for (let r = 0; r < s.order.length * 64; r++) {
      const k = core.nextRow();
      for (let j = 0; j < k; j++) {
        const e = core.events[j];
        assert.ok(e.pitch >= 21 && e.pitch <= 100 && e.vol >= 0 && e.vol <= 64, `${s.id} event`);
        if (e.kind === 'note') { notes++; if (SAMPLES.get(s.instruments[e.inst]).baseFreq) melodic.add(Math.round(e.pitch)); }
      }
    }
    assert.ok(core.time > 25, `${s.id} lasts ${core.time.toFixed(0)} s`);
    assert.ok(notes > 200 && melodic.size >= 8, `${s.id}: ${notes} notes, ${melodic.size} pitches`);
  }
  assert.throws(() => compileSong({ id: 'x', name: 'X', tempo: 125, speed: 6, channels: ['lead'], pan: [0], patterns: { a: [['Q9']] }, order: 'a' }));
});

test('engine sound: rpm crossfade weights, Doppler, squeal from slip on paved surfaces only', () => {
  const w = [0, 0, 0], ranges = [1000, 4000, 7000];
  for (const rpm of [500, 1000, 2000, 4000, 5500, 7000, 9000]) near(rangeWeights(rpm, ranges, w).reduce((a, b) => a + b), 1, 1e-9);
  assert.deepEqual(rangeWeights(4000, ranges, w), [0, 1, 0]);
  rangeWeights(2000, ranges, w);
  assert.ok(w[0] > 0 && w[1] > 0 && w[2] === 0);
  assert.ok(doppler(30) > 1 && doppler(-30) < 1 && doppler(0) === 1);
  const peak = 0.11;
  assert.equal(squealAmount([0.05, 0.05, 0.05, 0.05], [0, 0, 0, 0], peak, 30), 0);
  assert.ok(squealAmount([0.3, 0.3, 0.1, 0.1], [0, 0, 0, 0], peak, 30) > 0.5);
  assert.equal(squealAmount([0.3, 0.3, 0.3, 0.3], [2, 2, 3, 3], peak, 30), 0, 'no squeal on grass/gravel');
  assert.equal(squealAmount([0.3, 0.3, 0.3, 0.3], [0, 0, 0, 0], peak, 1), 0, 'not when nearly stopped');
});

// ---- stage 8: replay, TV cameras, weather ----------------------------------------
test('replay: decodes every recorded frame within quantization, keyframes on jumps, damage history, interpolation', () => {
  const sim = newSim({ ai: 3 }), rep = new Replay(sim.cars.length), states = [];
  for (let i = 0; i < 60 * 25; i++) {
    sim.step(1 / 60, CTL, CTL);
    if (i === 900) sim.cars[1].car.x += 400; // teleport: delta does not fit 16 bits
    if (i === 1000) { sim.cars[2].damage.hit(0, 25, 0, 1); }
    rep.record(sim.cars);
    if (i % 97 === 0 || i === 900 || i === 901) states.push([i, sim.cars.map((c) => [c.car.x, c.car.y, c.car.z, c.car.heading, c.car.speed, c.car.dt.rpm])]);
  }
  assert.equal(rep.frames, 1500);
  const out = replayCars(sim.cars.map((c) => c.spec));
  for (const [f, cars] of states) {
    rep.decode(f, out);
    cars.forEach(([x, y, z, h, v, rpm], k) => {
      const o = out[k];
      assert.ok(Math.abs(o.x - x) < 0.006 && Math.abs(o.y - y) < 0.006 && Math.abs(o.z - z) < 0.006, `frame ${f} car ${k} position`);
      assert.ok(Math.abs(Math.atan2(Math.sin(o.heading - h), Math.cos(o.heading - h))) < 1e-4 && Math.abs(o.speed - v) < 0.006 && Math.abs(o.dt.rpm - rpm) <= 0.5);
    });
  }
  assert.ok(rep.keyFrames.includes(900), 'keyframe at the jump');
  assert.ok(rep.damageAt(2, 999) === null || rep.damageAt(2, 999)[0] === 0);
  assert.ok(rep.damageAt(2, 1200)[0] > 0.5, 'damage history');
  // Fractional frames interpolate between neighbours.
  const a = replayCars(sim.cars.map((c) => c.spec)), b = replayCars(sim.cars.map((c) => c.spec));
  rep.decode(500, a); rep.decode(501, b); rep.decode(500.5, out);
  near(out[0].x, (a[0].x + b[0].x) / 2, 1e-6);
  // Storage: 16-bit deltas per field (8 cars x 5 min = 13 fields x 2 B x 8 x 18000 frames < 4 MB) plus 1 keyframe/s.
  assert.ok(rep.deltaChunks.every((c) => c instanceof Int16Array) && rep.keyFrames.length < 1500 / 60 + 3);
});

test('TV cameras: beside every track, off the road, clear of scenery, above ground; director keeps the car in view', () => {
  for (const [k, def] of RACE_TRACKS.entries()) {
    const t = builtTracks[k], ter = createTerrain(t, TC, 1995), probe = new GroundProbe(t, ter, TC);
    const sc = buildScenery(t, ter, probe, [...ZONES[def.zone].scenery, ...def.scenery], { cfg: TC, seed: 1995, layerOf });
    probe.setLineLimits(sc.limits);
    const colliders = new StaticColliders([...sc.colliders, ...narrowingWalls(t, ter, { SEG, frameAt })]);
    const cams = buildTvCameras(t, probe, colliders, CONFIG.tv), info = {};
    assert.ok(cams.length >= t.length / CONFIG.tv.spacing * 0.8, `${def.id}: ${cams.length} cameras`);
    for (const c of cams) {
      const g = probe.sample(c.x, c.z, info, SLOT.CAM_TEST);
      if (!c.tunnel) {
        assert.ok(Math.abs(g.lat) > def.width / 2 + 5, `${def.id} camera at s ${c.s.toFixed(0)} on the road`);
        assert.ok(!colliders.circle(c.x, c.z, 2), `${def.id} camera inside scenery`);
      }
      probe.hints[SLOT.CAM_TEST] = -1;
      const gy = probe.heightAt(c.x, c.z, SLOT.CAM_TEST, false);
      assert.ok(c.y > gy + 1, `${def.id} camera underground at s ${c.s.toFixed(0)}: ${c.y.toFixed(1)} vs ground ${gy.toFixed(1)}`);
    }
    // A car driving along the centre line: the director always finds a shot that sees it.
    const dir = new TvDirector(t, cams, probe, CONFIG.tv), f = { pos: [0, 0, 0], fwd: [0, 0, 0], right: [0, 0, 0], up: [0, 0, 0] };
    const cam = { pos: [0, 0, 0], yaw: 0, pitch: 0, roll: 0 };
    let seen = 0, total = 0;
    for (let s = t.closed ? 0 : t.startS; s < (t.closed ? t.length : t.finishS); s += 5) {
      frameAt(t, s, f);
      const target = { x: f.pos[0], y: f.pos[1], z: f.pos[2], heading: Math.atan2(f.fwd[0], -f.fwd[2]) };
      dir.update(0.1, target, s, false);
      const fov = dir.apply(cam, target, 0.1);
      assert.ok(fov >= 6 && fov <= 55);
      total++;
      if (dir.cur >= 0 && dir.visible(cams[dir.cur], target)) seen++;
    }
    assert.ok(seen / total > 0.9, `${def.id}: car visible in ${(100 * seen / total).toFixed(0)}% of shots`);
  }
});

test('weather: rain/fog darken and shorten the fog, rain is wet; wet grip slows braking and the AI', () => {
  const day = weatherConditions('day', 'clear'), rain = weatherConditions('day', 'rain'), fog = weatherConditions('day', 'fog'), nightRain = weatherConditions('night', 'rain');
  const lum = (c) => c[0] + c[1] + c[2];
  assert.ok(lum(rain.fog) < lum(day.fog) && rain.fogEnd < day.fogEnd && rain.diffuse < day.diffuse && rain.sky === 'overcast');
  assert.ok(fog.fogEnd <= 130 && fog.fogStart < day.fogStart);
  assert.ok(nightRain.sky === 'night' && lum(nightRain.fog) < lum(rain.fog));
  assert.ok(rain.wet === 1 && rain.rain === 1 && day.wet === 0 && fog.rain === 0);
  for (const spec of CARS) assert.ok(wetGripFactor(spec, 1) < 0.9 && wetGripFactor(spec, 0) === 1);
  const dry = newSim(), wet = newSim({ wet: 1 });
  assert.ok(wet.cars.every((c) => c.car.wet === 1));
  const sd = dry.speedFor(gt2), sw = wet.speedFor(gt2);
  assert.ok(sw.reduce((a, v) => a + v, 0) < sd.reduce((a, v) => a + v, 0) * 0.95, 'AI targets slower in the rain');
});

test('rain overlay: streaks fall, windscreen drops gather and the wipers clear them', () => {
  const fx = new RainFx(320, 240, { streaks: 50, screenDrops: 60, wiperPeriod: 1.4 }, 3);
  const y0 = fx.streaks[1];
  fx.update(0.05, 30, false, 1);
  assert.ok(fx.streaks[1] !== y0 && fx.dropCount === 0, 'no windscreen drops outside the cockpit');
  let maxDrops = 0;
  for (let i = 0; i < 400; i++) { fx.update(1 / 60, 30, true, 1); maxDrops = Math.max(maxDrops, fx.dropCount); }
  assert.ok(maxDrops > 10 && fx.dropCount < 60, `drops ${fx.dropCount} (max ${maxDrops})`);
  const ov = { w: 320, h: 240, data: new Uint8Array(320 * 240) };
  fx.draw(ov, true, 1);
  assert.ok(ov.data.some((v) => v), 'drawn');
});

// ---- stage 9: two players ----------------------------------------------------------
test('split screen: two human players start last with their own cars, controls and liveries; max 6 rivals', () => {
  const sim = newSim({ ai: 7, spec2: CARS[3] });
  assert.equal(sim.cars.length, 8, '6 rivals + 2 players');
  assert.deepEqual(sim.players.map((c) => [c.name, c.spec.id, c.variant]), [['PLAYER 1', 'vektorGT2', PLAYER_SLOT], ['PLAYER 2', 'kestrelST', PLAYER2_SLOT]]);
  const lv = gridLiveries(0, 0, 3, 2);
  assert.deepEqual(lv[PLAYER2_SLOT], { car: 3, set: 2, number: 9 });
  assert.equal(lv[PLAYER_SLOT].car, 0);
  // Player 2 accelerates, player 1 does not: the controls are independent.
  const s0 = sim.players.map((c) => [c.car.x, c.car.z]);
  const go = ctl({ throttle: 1 }), sim2 = new RaceSim({ track, probe: raceWorld.probe, colliders: raceWorld.colliders, line: raceWorld.line, spec: gt2, spec2: CARS[3], ai: 0, laps: 1, seed: 1995 });
  const start = sim2.players.map((c) => [c.car.x, c.car.z]);
  for (let i = 0; i < 60 * 9; i++) sim2.step(1 / 60, CTL, CTL, go, go);
  const moved = sim2.players.map((c, k) => Math.hypot(c.car.x - start[k][0], c.car.z - start[k][1]));
  assert.ok(moved[0] < 1 && moved[1] > 30, `moved ${moved.map((v) => v.toFixed(1))}`);
  assert.ok(s0.length === 2);
});

test('split screen: race ends when both players are in (or the wait after the last one)', () => {
  const cfg = { laps: 1, ...CONFIG.race, goDelay: 0.5 };
  const race = new Race(track, [{ id: 0, name: 'AI', isPlayer: false }, { id: 1, name: 'P1', isPlayer: true }, { id: 2, name: 'P2', isPlayer: true }], cfg);
  const L = track.length, s = [L - 20, L - 24, L - 28];
  while (race.phase === 'countdown') race.update(0.1, s);
  const drive = (k, to) => { while (s[k] < to) { s[k] = Math.min(to, s[k] + 5); race.update(0.1, s); } };
  drive(1, 2 * L + 10);
  assert.ok(race.entries[1].finished && race.phase === 'running', 'one player in: the race goes on');
  for (let t = 0; t < cfg.finishWait + 5; t += 0.1) race.update(0.1, s);
  assert.equal(race.phase, 'running', 'no timeout while a player is still racing');
  drive(2, 2 * L + 10);
  for (let t = 0; t < cfg.finishWait + 1; t += 0.1) race.update(0.1, s);
  assert.equal(race.phase, 'finished');
  assert.deepEqual(race.results().slice(0, 2).map((e) => e.name), ['P1', 'P2']);
});

test('input: players have disjoint keys in split screen (only Esc is shared); solo player 1 also uses WASD', () => {
  const held = new Set(), kb = { held: (c) => held.has(c), hit: () => false };
  const p1 = new PlayerInput(kb, 0, false, 0.15), p2 = new PlayerInput(kb, 1, false, 0.15), solo = new PlayerInput(kb, 0, true, 0.15);
  held.add('KeyW');
  assert.ok(p1.poll().throttle === 0 && p2.poll().throttle === 1 && solo.poll().throttle === 1);
  held.clear(); held.add('ArrowUp');
  assert.ok(p1.poll().throttle === 1 && p2.poll().throttle === 0);
  const keys = (m) => new Set(Object.entries(m).filter(([k]) => k !== 'solo').flatMap(([, v]) => v));
  const a = keys(p1.map), b = keys(p2.map);
  assert.deepEqual([...a].filter((k) => b.has(k)), ['Escape']);
  const cams = new CarCameras(gt2, null);
  cams.allowInside = false;
  for (let i = 0; i < 8; i++) { cams.next(); assert.notEqual(cams.mode, 0, 'no cockpit in split screen'); }
});

// ---- stage 10: records, options, menus, showroom, touch ----------------------------------
test('records: best lap and race per track kept, slower times ignored; championship history', () => {
  const save = emptySave();
  assert.deepEqual(offerRecord(save, 'desert', { lap: 90, race: 190, car: 'auroraRS', name: 'PLAYER' }), { lap: true, race: true });
  assert.deepEqual(offerRecord(save, 'desert', { lap: 91, race: 185, car: 'vektorGT2', name: 'PLAYER 2' }), { lap: false, race: true });
  assert.deepEqual(save.records.desert, { lap: { time: 90, car: 'auroraRS', name: 'PLAYER' }, race: { time: 185, car: 'vektorGT2', name: 'PLAYER 2' } });
  assert.deepEqual(offerRecord(save, 'coast', { lap: 0, car: 'x', name: 'P' }), { lap: false, race: false }, 'invalid times ignored');
  recordSeason(save, 3); recordSeason(save, 1); recordSeason(save, 2);
  assert.deepEqual(save.champ, { seasons: 3, titles: 1, best: 1 });
  assert.equal(formatTime(83.456), '1:23.46');
  assert.equal(formatTime(7.1), '0:07.10');
});

test('options: defaults, invalid saved values ignored, applied to CONFIG and renderer at once', () => {
  const o = resolveOptions({ units: 1, mirror: 7, nonsense: 2 });
  assert.equal(o.units, 1);
  assert.equal(o.mirror, 0, 'out-of-range saved index falls back to the default');
  assert.ok(!('nonsense' in o));
  const r = { perspective: false, maxFar: Infinity, maxDetailFar: Infinity, w: 640, h: 480 };
  let resized = null;
  applyOptions({ ...o, distance: 0, perspective: 1, difficulty: 2, gearbox: 1, traction: 1, density: 0, carDetail: 0, resolution: 1 }, { renderer: r, resize: (w, h) => { resized = [w, h]; } });
  try {
    assert.ok(r.maxFar < 300 && r.maxDetailFar < 200 && r.perspective);
    assert.deepEqual(resized, [320, 240]);
    assert.ok(CONFIG.ai.difficulty > 1 && !CONFIG.vehicle.autoGearbox && !CONFIG.vehicle.tractionControl && CONFIG.units === 'mph');
    assert.ok(CONFIG.scenery.density < 0.5 && CONFIG.render.detailCars === 2);
  } finally {
    applyOptions(resolveOptions({}));
  }
  assert.ok(CONFIG.ai.difficulty === 1 && CONFIG.vehicle.autoGearbox && CONFIG.units === 'kmh' && CONFIG.render.detail === 'high');
  assert.ok(OPTION_DEFS.every((d) => d.def < d.values.length) && new Set(OPTION_DEFS.map((d) => d.id)).size === OPTION_DEFS.length);
});

test('menu: keyboard/pad navigation skips disabled rows, choices cycle, pointer hover and click', () => {
  let v = 0, acted = 0;
  const m = new Menu('T', [
    { label: 'A', act: () => { acted++; return 'a'; } },
    { label: 'B', disabled: () => true },
    { label: 'C', value: () => String(v), change: (d) => { v += d; } },
  ]);
  const ov = { w: 640, h: 480 }, nav = (o) => ({ up: false, down: false, left: false, right: false, ok: false, back: false, px: -1, py: -1, moved: false, click: false, ...o });
  assert.equal(m.handle(nav({ ok: true }), ov), 'a');
  m.handle(nav({ down: true }), ov);
  assert.equal(m.focus, 2, 'disabled row skipped');
  m.handle(nav({ right: true }), ov); m.handle(nav({ right: true }), ov); m.handle(nav({ left: true }), ov);
  assert.equal(v, 1);
  assert.equal(m.handle(nav({ back: true }), ov), 'back');
  const r = m.rects[0];
  m.handle(nav({ moved: true, px: r.x + 5, py: r.y + 5 }), ov);
  assert.equal(m.focus, 0, 'hover focuses');
  assert.equal(m.handle(nav({ click: true, px: r.x + 5, py: r.y + 5 }), ov), 'a');
  const rc = m.rects[2];
  m.handle(nav({ click: true, px: rc.x + 2, py: rc.y + 2 }), ov);
  assert.equal(v, 0, 'click on the left third of a choice steps back');
  assert.equal(acted, 2);
  // Every menu builds for each mode (labels are uppercase: the font has no lower case).
  const app = { setup: { track: 0, car: 0, set: 0, car2: 1, set2: 0, time: 0, weather: 0, laps: 0, ai: 7 }, save: emptySave(), options: resolveOptions({}), push: () => 'push', page: () => 'page', showroom: () => 'x', startRace: () => 'x', applyOptions: () => {} };
  for (const menu of [mainMenu(app), ...['race', 'split', 'time', 'champ'].map((k) => setupMenu(app, k)), optionsMenu(app)]) {
    for (const it of menu.items) assert.equal(it.label, it.label.toUpperCase());
    menu.draw(new Overlay(320, 240), 0);
  }
});

test('showroom: figures for every car agree with cars.js ranges; livery slot regenerates exactly', () => {
  for (const spec of CARS) {
    const st = carStats(spec);
    assert.ok(st.hp > 150 && st.hp < 700 && st.mass === spec.mass && st.gears === spec.gearbox.ratios.length);
    assert.ok(st.zeroTo100 >= spec.expect.zeroTo100[0] && st.zeroTo100 <= spec.expect.zeroTo100[1], `${spec.id} 0-100 ${st.zeroTo100}`);
    assert.ok(st.zeroTo60 > 0 && st.zeroTo60 < st.zeroTo100);
    assert.ok(st.vmax * 3.6 >= spec.expect.vmax[0] - 3 && st.vmax * 3.6 <= spec.expect.vmax[1] + 3, `${spec.id} vmax ${(st.vmax * 3.6).toFixed(0)}`);
  }
  const entry = { car: 4, set: 2, number: 1 }, full = generateLibrary(1995, gridLiveries(4, 2)), slot = generateLiverySlot(1995, PLAYER_SLOT, entry);
  for (const t of slot) assert.equal(hashBytes(t.data), hashBytes(full.find((x) => x.name === t.name).data));
  assert.equal(slot.length, 2);
  // mph dashboard builds; speeds convert.
  buildDashboard(640, 480, lib.find((t) => t.name === 'dashboard').data, gt2, 'mph');
  CONFIG.units = 'mph'; near(speedUnit(10), 22.3694, 1e-3); CONFIG.units = 'kmh'; near(speedUnit(10), 36, 1e-9);
});

test('scenery density: fewer ambient objects at low density, track placements unchanged', () => {
  const count = (density) => {
    const probe = new GroundProbe(track, terrain, TC);
    const zone = ZONES.forest.scenery.map((r) => (r.rule === 'every' ? { ...r, ambient: true } : r));
    const sc = buildScenery(track, terrain, probe, [...zone, ...trackDef.scenery], { cfg: TC, seed: 1995, layerOf, density });
    const n = (name) => sc.objects.filter((g) => g.name === name).reduce((a, g) => a + g.positions.length, 0);
    return { trees: n('tree3d') + sc.sprites.reduce((a, s) => a + s.data.length, 0), garages: n('pitGarage') };
  };
  const hi = count(1), lo = count(0.45);
  assert.ok(lo.trees < hi.trees * 0.6, `${lo.trees} vs ${hi.trees}`);
  assert.equal(lo.garages, hi.garages);
});

test('touch controls: buttons from touch points, edges for camera/pause, tilt steering', () => {
  const pointer = { touches: new Map(), touched: true }, tc = new TouchControls(pointer, {});
  tc.update(640, 480);
  const at = (k) => ({ x: tc.rects[k].x + 2, y: tc.rects[k].y + 2 });
  pointer.touches.set(1, at('gas')); pointer.touches.set(2, at('left')); pointer.touches.set(3, at('pause'));
  tc.update(640, 480);
  const s = { throttle: 0, brake: 0, steer: 0, analog: false, handbrake: false, camera: false, pause: false };
  tc.merge(s);
  assert.ok(s.throttle === 1 && s.steer === -1 && s.pause && !s.brake);
  tc.update(640, 480);
  const s2 = { ...s, pause: false };
  tc.merge(s2);
  assert.ok(!s2.pause, 'pause fires once per press');
  CONFIG.input.tilt = true; tc.tilt = 0.5;
  const s3 = { ...s2, steer: 0 };
  tc.merge(s3);
  CONFIG.input.tilt = false;
  assert.ok(s3.steer === 0.5 && s3.analog);
});

// ---- runner ---------------------------------------------------------------
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    process.stdout.write(`ok   ${t.name}\n`);
  } catch (e) {
    failed++;
    process.stdout.write(`FAIL ${t.name}\n     ${e.message}\n`);
  }
}
process.stdout.write(`\n${tests.length - failed}/${tests.length} passed\n`);
process.exit(failed ? 1 : 0);

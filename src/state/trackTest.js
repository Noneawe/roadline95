// Track preview scene (stage 2, ?scene=track): test circuit with terrain, sky and fog; the camera drives
// along the centreline (Up/Down speed, Left/Right offset), C toggles the free camera. Also builds the
// track world shared with the driving scene.
import { CONFIG } from '../config.js';
import { buildTrack } from '../world/track.js';
import { createTerrain, buildBaseTerrain } from '../world/terrain.js';
import { buildChunks } from '../world/chunks.js';
import { Mesh, InstanceBuffer, SpriteBatch } from '../gfx/mesh.js';
import { GroundProbe } from '../world/ground.js';
import { buildScenery } from '../world/scenery.js';
import { loadModel } from '../models/loader.js';
import { SCENERY_MODELS, SCENERY_MATERIALS } from '../models/scenery.js';
import { ZONES } from '../data/zones.js';
import { StaticColliders, narrowingWalls } from '../game/collision.js';
import { SEG, frameAt } from '../world/track.js';
import { TrackCamera } from '../camera/trackFollow.js';
import { moveFreeCamera } from '../camera/free.js';

const WET_ROAD = new Set(['asphalt0', 'asphalt1', 'asphalt2']);

/**
 * Builds the track, its terrain, scenery and their meshes and registers them with the renderer.
 * Item order: opaque static meshes, instanced scenery, then sprite batches.
 * @param {import('../gfx/renderer.js').Renderer} renderer
 * @param {Map<string, number>} layers texture name -> layer
 * @param {object} def track definition
 * @param {string} [zoneId] overrides the track's zone @param {boolean} [wet] rain: wet asphalt texture
 */
export function buildTrackWorld(renderer, layers, def, zoneId, wet = false) {
  const layerOf = (t) => {
    const l = layers.get(wet && WET_ROAD.has(t) ? 'asphaltWet' : t);
    if (l === undefined) throw new Error(`Unknown texture ${t}`);
    return l;
  };
  const zone = ZONES[zoneId || def.zone] || ZONES.raceway;
  const track = buildTrack(def, CONFIG.track);
  const terrain = createTerrain(track, CONFIG.track, CONFIG.seed);
  const probe = new GroundProbe(track, terrain, CONFIG.track);
  // Track chunks in two LODs by distance (far: every other sample row), then the background terrain.
  const lodDist = CONFIG.track.chunkLodDist;
  const items = [
    ...buildChunks(track, terrain, CONFIG.track, layerOf, zone.ground).map((cpu) => ({ mesh: renderer.addMesh(new Mesh(cpu)), model: null, range: [0, lodDist] })),
    ...buildChunks(track, terrain, CONFIG.track, layerOf, zone.ground, 2).map((cpu) => ({ mesh: renderer.addMesh(new Mesh(cpu)), model: null, range: [lodDist, Infinity] })),
    ...buildBaseTerrain(track, terrain, CONFIG.track, layerOf, zone.ground).map((cpu) => ({ mesh: renderer.addMesh(new Mesh(cpu)), model: null, background: true })),
  ];
  const ambient = zone.scenery.map((r) => (r.rule === 'every' ? { ...r, ambient: true } : r));
  const scenery = buildScenery(track, terrain, probe, [...ambient, ...(def.scenery || [])], { cfg: CONFIG.track, seed: CONFIG.seed, layerOf, density: CONFIG.scenery.density });
  for (const cpu of scenery.lines) if (cpu) items.push({ mesh: renderer.addMesh(new Mesh(cpu)), model: null });
  const models = new Map(), opts = { maxEdge: CONFIG.tess.sceneryMaxEdge, creaseDeg: CONFIG.model.creaseDeg };
  // Near track geometry only (the rear-view mirror sees ~50 m: no scenery, no far LOD, no background).
  const basic = items.filter((it) => !it.background && !(it.range && it.range[0] > 0));
  for (const group of scenery.objects) {
    if (!SCENERY_MODELS[group.name]) throw new Error(`Unknown scenery object ${group.name}`);
    if (!models.has(group.name)) models.set(group.name, loadModel(SCENERY_MODELS[group.name](), SCENERY_MATERIALS, layerOf, opts));
    const cpu = models.get(group.name), inst = new InstanceBuffer(group.positions.length);
    inst.data.set(group.data);
    inst.count = group.positions.length;
    items.push({ mesh: renderer.addMesh(new Mesh(cpu, inst)), model: null, bounds: groupBounds(group.positions, cpu.radius), detail: true });
  }
  for (const group of scenery.sprites) items.push({ sprites: renderer.addMesh(new SpriteBatch(group.data)), detail: true });
  probe.setLineLimits(scenery.limits);
  const colliders = new StaticColliders([...scenery.colliders, ...narrowingWalls(track, terrain, { SEG, frameAt })]);
  // Grandstand positions (crowd ambience).
  const crowd = scenery.objects.filter((g) => g.name === 'grandstand').flatMap((g) => g.positions);
  return { track, terrain, probe, items, basic, zone, colliders, crowd };
}

// Bounding sphere around instance positions (+ scaled model radius).
function groupBounds(positions, radius) {
  const c = [0, 0, 0];
  for (const p of positions) for (let k = 0; k < 3; k++) c[k] += p[k] / positions.length;
  let r = 0;
  for (const p of positions) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) + radius * p[3] * 1.5);
  return [c[0], c[1], c[2], r];
}

/**
 * Track preview scene (camera flying along the centreline).
 * @param {import('../gfx/renderer.js').Renderer} renderer
 * @param {Map<string, number>} layers texture name -> layer
 * @param {object} def track definition
 */
export function createTrackScene(renderer, layers, def, zoneId) {
  const { track, items } = buildTrackWorld(renderer, layers, def, zoneId);
  const camera = { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  const follow = new TrackCamera(track, track.startS - 40);
  let free = false;
  follow.apply(camera);
  return {
    track,
    camera,
    items,
    follow,
    get free() { return free; },
    /** @param {number} dt @param {import('../engine/input.js').Keyboard} kb */
    update(dt, kb) {
      if (kb.hit('KeyC')) free = !free;
      if (free) moveFreeCamera(camera, dt, kb);
      else follow.update(dt, kb);
    },
    prepare() {
      if (!free) follow.apply(camera);
    },
    /** Places the follow camera at distance s with lateral offset (tests, presets). */
    setDistance(s, lateral = 0) {
      free = false;
      follow.s = s;
      follow.lateral = lateral;
      follow.apply(camera);
    },
    /** Switches to the free camera at a fixed pose (tests, presets). */
    setView(pos, yaw, pitch) {
      free = true;
      camera.pos[0] = pos[0]; camera.pos[1] = pos[1]; camera.pos[2] = pos[2];
      camera.yaw = yaw;
      camera.pitch = pitch;
    },
    debugLine() {
      return `S ${follow.s.toFixed(0)}/${track.length.toFixed(0)}m  ${(follow.speed * 3.6).toFixed(0)}km/h${free ? '  FREE' : ''}`;
    },
  };
}

// Renderer test scene (?scene=render): large affine floor, raw vs subdivided walls, textured boxes,
// Gouraud test car, cutout billboard trees and an instanced stress field (~60k triangles), free camera.
// Also used by tests/render.html with fixed camera views for golden index-buffer comparisons.
import { CONFIG } from '../config.js';
import { loadModel } from '../models/loader.js';
import { boxModel, planeModel, wallModel, spriteModel } from '../models/primitives.js';
import { testCarModel } from '../models/testCar.js';
import { Mesh, InstanceBuffer } from '../gfx/mesh.js';
import { FLAGS } from '../gfx/shaders/world.js';
import { mat4YawTranslate } from '../engine/math3d.js';
import { makeRng } from '../engine/rng.js';
import { moveFreeCamera } from '../camera/free.js';

const MATERIALS = {
  floor: { tex: 'checker', flags: 0 },
  brick: { tex: 'brick', flags: 0 },
  grass: { tex: 'grass', flags: 0 },
  ground: { tex: 'dirt', flags: 0 },
  body: { tex: 'paint', flags: FLAGS.GOURAUD },
  glass: { tex: 'glass', flags: 0 },
  tyre: { tex: 'tyre', flags: FLAGS.GOURAUD },
  tree: { tex: 'treeDeciduous', flags: FLAGS.CUTOUT | FLAGS.DOUBLE },
};

/** Fixed camera views (also the golden render test cases). */
export const VIEWS = {
  start: { pos: [0, 2.5, 18], yaw: 0, pitch: -0.08 },
  cube: { pos: [-10, 3, -4], yaw: 0, pitch: -0.3 },
  floor: { pos: [0, 1.6, 10], yaw: 0.6, pitch: -0.35 },
  walls: { pos: [0, 4, -16], yaw: 0, pitch: 0 },
  car: { pos: [4, 2.2, 5], yaw: -0.675, pitch: -0.25 },
  sprites: { pos: [0, 2, -6], yaw: 0, pitch: 0.05 },
  fog: { pos: [0, 6, 30], yaw: 0, pitch: -0.05 },
};

const TREES = 14;

/**
 * Builds the scene and registers its meshes with the renderer.
 * @param {import('../gfx/renderer.js').Renderer} renderer
 * @param {Map<string, number>} layers texture name -> layer
 * @param {{ stressCars?: number }} [opts]
 */
export function createRenderScene(renderer, layers, opts = {}) {
  const tess = { maxEdge: CONFIG.tess.maxEdge, creaseDeg: CONFIG.model.creaseDeg };
  const load = (model, o = tess) => loadModel(model, MATERIALS, (t) => layers.get(t), o);
  const items = [];
  const add = (cpu, model = null, inst = null) => {
    const item = { mesh: renderer.addMesh(new Mesh(cpu, inst)), model };
    items.push(item);
    return item;
  };
  const matrix = (yaw, x, y, z) => mat4YawTranslate(new Float32Array(16), yaw, x, y, z);

  add(load(planeModel('floor', 200, 200, 4, 'floor')));
  add(load(wallModel('wallRaw', -30, -6, 8, -30, 4, 'brick'), { ...tess, maxEdge: Infinity }));
  add(load(wallModel('wallTess', 6, 30, 8, -30, 4, 'brick')));
  const boxes = ['brick', 'grass', 'ground'].map((mat, i) =>
    add(load(boxModel(`box${i}`, [3, 3, 3], 1.5, mat)), matrix(i * 0.4, -10 + i * 10, 0, -12)));
  const carCpu = load(testCarModel());
  const car = add(carCpu, matrix(0.6, 0, 0, 0));

  const rng = makeRng(CONFIG.seed);
  const treePos = Array.from({ length: TREES }, (_, i) => [-42 + i * 6.5 + rng() * 2, -20 - rng() * 6]);
  const trees = new InstanceBuffer(TREES);
  trees.count = TREES;
  add(load(spriteModel('tree', 4, 6, 'tree')), null, trees);

  const stress = opts.stressCars ?? CONFIG.scene.stressCars;
  if (stress > 0) {
    const inst = new InstanceBuffer(stress);
    inst.count = stress;
    for (let i = 0; i < stress; i++) {
      mat4YawTranslate(inst.data, i * 0.7, -40 + (i % 10) * 9, 0, -70 - Math.floor(i / 10) * 10, i * 16);
    }
    add(carCpu, null, inst);
  }

  const camera = { pos: [0, 0, 0], yaw: 0, pitch: 0 };
  return {
    camera,
    items,
    time: 0,
    /** @param {keyof typeof VIEWS} name */
    setView(name) {
      const v = VIEWS[name];
      camera.pos[0] = v.pos[0]; camera.pos[1] = v.pos[1]; camera.pos[2] = v.pos[2];
      camera.yaw = v.yaw;
      camera.pitch = v.pitch;
    },
    /** Fixed-step update: time and free camera. @param {number} dt @param {import('../engine/input.js').Keyboard} kb */
    update(dt, kb) {
      this.time += dt;
      moveFreeCamera(camera, dt, kb);
    },
    /** Render-side matrices: spinning objects and Y-axis billboards facing the camera. */
    prepare() {
      mat4YawTranslate(boxes[1].model, 0.4 + this.time * 0.5, 0, 0, -12);
      mat4YawTranslate(car.model, 0.6 + this.time * 0.3, 0, 0, 0);
      for (let i = 0; i < TREES; i++) {
        const [x, z] = treePos[i];
        mat4YawTranslate(trees.data, Math.atan2(camera.pos[0] - x, camera.pos[2] - z), x, 0, z, i * 16);
      }
      trees.dirty = true;
    },
  };
}

// Render side of a race car: LOD meshes (LOD0/LOD1 per-car copies so dents are individual, LOD2 and
// the blob shadow shared), paint variant via the per-instance texture offset, damage rebuilds.
import { CONFIG } from '../config.js';
import { loadModel } from '../models/loader.js';
import { buildCarModel, buildShadowModel, CAR_MATERIALS } from '../models/carBuilder.js';
import { Mesh } from '../gfx/mesh.js';
import { mat4FromBasis } from '../engine/math3d.js';
import { createPose, updatePose } from '../vehicle/pose.js';
import { deformCar } from '../vehicle/damage.js';
import { SpriteBatch } from '../gfx/mesh.js';
import { carPoint } from '../vehicle/pose.js';

const SPRAY_FLOATS = 8;

/**
 * Rain spray behind the rear wheels of moving cars: one dynamic sprite batch (dithered binary mist),
 * refilled each frame for cars near the camera.
 */
export class SprayEmitter {
  /** @param {import('../gfx/renderer.js').Renderer} renderer @param {number} layer spray texture layer @param {number} maxCars */
  constructor(renderer, layer, maxCars) {
    this.renderer = renderer;
    this.layer = layer;
    this.batch = renderer.addMesh(new SpriteBatch(new Float32Array(maxCars * 2 * SPRAY_FLOATS), true));
    this.item = { sprites: this.batch };
    this.p = [0, 0, 0];
  }

  /**
   * @param {{ car: object, spec: object, visual: CarVisual }[]} cars @param {number[]} eye camera position
   * @param {number} level rain 0..1 @param {number} from minimum speed (m/s)
   */
  update(cars, eye, level, from) {
    const d = this.batch.data;
    let n = 0;
    if (level > 0) {
      for (const c of cars) {
        const v = c.car.speed;
        if (v < from || Math.hypot(c.car.x - eye[0], c.car.z - eye[2]) > 90 || (n + 2) * SPRAY_FLOATS > d.length) continue;
        const b = c.spec.body, k = Math.min(1, (v - from) / 40);
        for (const side of SIDES) {
          carPoint(c.visual.pose, side * (b.width / 2 - b.wheelInset), 0, 0.7 + k, this.p);
          const o = n++ * SPRAY_FLOATS;
          d[o] = this.p[0]; d[o + 1] = this.p[1]; d[o + 2] = this.p[2];
          d[o + 3] = (1.2 + 1.6 * k) * level; d[o + 4] = (0.5 + 1.0 * k) * level; d[o + 5] = this.layer; d[o + 6] = 1; d[o + 7] = 0;
        }
      }
    }
    this.batch.count = n;
    this.renderer.refreshSprites(this.batch);
  }
}

const SIDES = [-1, 1];

/**
 * Loads the car models once (shared by all cars of the same spec).
 * @param {import('../gfx/renderer.js').Renderer} renderer @param {object} spec @param {(t: string) => number} layerOf
 */
export function loadCarModels(renderer, spec, layerOf) {
  const opts = { maxEdge: CONFIG.tess.maxEdge, creaseDeg: CONFIG.model.creaseDeg };
  const lods = [0, 1, 2].map((l) => loadModel(buildCarModel(spec, l), CAR_MATERIALS, layerOf, opts));
  const b = spec.body;
  return {
    spec,
    lods,
    lod2: renderer.addMesh(new Mesh(lods[2])),
    shadow: renderer.addMesh(new Mesh(loadModel(buildShadowModel(spec), CAR_MATERIALS, layerOf, opts))),
    shape: { zFront: -(b.length - b.rearOverhang), zRear: b.rearOverhang, half: b.width / 2, dentMax: CONFIG.damage.dentMax },
    layers: {
      body: [layerOf('livery')], scratched: layerOf('liveryScratched'), headlight: layerOf('headlight'),
      taillight: layerOf('taillight'), headBroken: layerOf('headlightBroken'), tailBroken: layerOf('taillightBroken'),
    },
  };
}

export class CarVisual {
  /**
   * @param {import('../gfx/renderer.js').Renderer} renderer @param {object} models from loadCarModels
   * @param {number} variant livery slot 0..7 @param {boolean} [ghost] time-trial ghost: screen door, no shadow
   */
  constructor(renderer, models, variant, ghost = false) {
    this.ghost = ghost;
    this.renderer = renderer;
    this.models = models;
    this.matrix = new Float32Array(16);
    this.shadowMatrix = new Float32Array(16);
    this.pose = createPose();
    this.variant = variant;
    this.meshes = [0, 1].map((l) => {
      const base = models.lods[l], mesh = new Mesh({ ...base, buffer: base.buffer.slice(0) });
      mesh.dynamic = true;
      return renderer.addMesh(mesh);
    });
    this.lodItems = [...this.meshes, models.lod2].map((mesh) => ({ mesh, model: this.matrix, visible: false }));
    this.shadowItem = { mesh: models.shadow, model: this.shadowMatrix, visible: true };
    this.items = [this.shadowItem, ...this.lodItems];
    this.damageVersion = 0;
  }

  /**
   * Updates matrices, LOD and damage for this frame.
   * @param {import('../vehicle/physics.js').Car} car @param {import('../vehicle/damage.js').Damage} damage
   * @param {number[]} eye camera position @param {boolean} show @param {boolean} [farOnly] force the far LOD (detail option)
   */
  update(car, damage, eye, show, farOnly = false) {
    const p = updatePose(car, this.pose);
    mat4FromBasis(this.matrix, p.r, p.u, p.b, p.origin);
    this.matrix[3] = this.variant;
    this.matrix[7] = this.ghost ? 1 : 0;
    mat4FromBasis(this.shadowMatrix, p.gr, p.gu, p.gb, p.ground);
    const d = Math.hypot(eye[0] - car.x, eye[1] - car.y, eye[2] - car.z), L = CONFIG.vehicle.lodDist;
    const lod = farOnly ? 2 : d < L[0] ? 0 : d < L[1] ? 1 : 2;
    for (let i = 0; i < 3; i++) this.lodItems[i].visible = show && i === lod;
    this.shadowItem.visible = show && !this.ghost;
    if (damage && damage.version !== this.damageVersion) {
      this.damageVersion = damage.version;
      for (let l = 0; l < 2; l++) {
        deformCar(this.models.lods[l], this.meshes[l].cpu.buffer, damage.zones, this.models.shape, this.models.layers);
        this.renderer.updateMesh(this.meshes[l]);
      }
    }
  }
}

// GPU meshes: VBO + VAO from packed CPU vertex data, optional per-instance model matrices
// (attributes 5..8, divisor 1) and a lazily built wireframe edge buffer. Rebuildable after context loss.
import { VERTEX_BYTES, VERTEX_WORDS } from '../models/loader.js';

const INSTANCE_FLOATS = 16;

/** Per-instance model matrices kept on the CPU; `count` instances are drawn. */
export class InstanceBuffer {
  /** @param {number} max */
  constructor(max) {
    this.data = new Float32Array(max * INSTANCE_FLOATS);
    this.count = 0;
    this.dirty = true;
    this.buf = null;
  }

  /** @param {WebGL2RenderingContext} gl */
  upload(gl) {
    if (!this.buf) {
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
      this.dirty = true;
    }
    if (!this.dirty) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * INSTANCE_FLOATS);
    this.dirty = false;
  }

  /** @param {WebGL2RenderingContext} gl */
  release(gl) {
    if (this.buf) gl.deleteBuffer(this.buf);
    this.buf = null;
  }
}

export class Mesh {
  /**
   * @param {import('../models/loader.js').MeshData} cpu
   * @param {InstanceBuffer | null} [instances]
   */
  constructor(cpu, instances = null) {
    this.cpu = cpu;
    this.instances = instances;
    this.vao = null;
    this.vbo = null;
    this.dynamic = false;
    this.wireVao = null;
    this.wireBuf = null;
    this.wireCount = 0;
  }

  /** Creates GPU objects (call again after context restore). @param {WebGL2RenderingContext} gl */
  upload(gl) {
    this.wireVao = null;
    this.wireBuf = null;
    if (this.instances) this.instances.buf = null;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const vbo = gl.createBuffer();
    this.vbo = vbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.cpu.buffer, this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, VERTEX_BYTES, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, VERTEX_BYTES, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, VERTEX_BYTES, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribIPointer(3, 1, gl.UNSIGNED_INT, VERTEX_BYTES, 32);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 1, gl.UNSIGNED_INT, VERTEX_BYTES, 36);
    this.bindInstances(gl);
    gl.bindVertexArray(null);
  }

  /** Re-uploads changed CPU vertex data (same size), e.g. after damage deformation. @param {WebGL2RenderingContext} gl */
  updateData(gl) {
    if (!this.vbo) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Uint8Array(this.cpu.buffer));
    this.wireVao = null;
  }

  /** Builds the edge-list VAO for wireframe mode on first use. @param {WebGL2RenderingContext} gl */
  ensureWire(gl) {
    if (this.wireVao) return;
    const src = new Float32Array(this.cpu.buffer), tris = this.cpu.count / 3;
    const lines = new Float32Array(tris * 18);
    for (let t = 0; t < tris; t++) {
      for (let e = 0; e < 3; e++) {
        const a = (t * 3 + e) * VERTEX_WORDS, b = (t * 3 + ((e + 1) % 3)) * VERTEX_WORDS, o = t * 18 + e * 6;
        lines.set(src.subarray(a, a + 3), o);
        lines.set(src.subarray(b, b + 3), o + 3);
      }
    }
    if (this.wireBuf) gl.deleteBuffer(this.wireBuf);
    this.wireVao = gl.createVertexArray();
    gl.bindVertexArray(this.wireVao);
    this.wireBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    this.bindInstances(gl);
    gl.bindVertexArray(null);
    this.wireCount = tris * 6;
  }

  /** Deletes the GPU objects (scene change); the CPU data stays. @param {WebGL2RenderingContext} gl */
  release(gl) {
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.vbo);
    if (this.wireVao) gl.deleteVertexArray(this.wireVao);
    if (this.wireBuf) gl.deleteBuffer(this.wireBuf);
    if (this.instances) this.instances.release(gl);
    this.vao = this.vbo = this.wireVao = this.wireBuf = null;
  }

  bindInstances(gl) {
    if (!this.instances) return;
    this.instances.upload(gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instances.buf);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(5 + i);
      gl.vertexAttribPointer(5 + i, 4, gl.FLOAT, false, INSTANCE_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(5 + i, 1);
    }
  }
}

const SPRITE_FLOATS = 8;
// Two triangles of a unit billboard: x in -0.5..0.5, y in 0..1.
const SPRITE_CORNERS = new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]);

/**
 * Batch of instanced cylindrical billboards. Per sprite: x, y, z, width, height, layer, frames, phase.
 * `bounds` (centre + radius) is used for culling the whole batch.
 */
export class SpriteBatch {
  /**
   * @param {Float32Array} data SPRITE_FLOATS per sprite
   * @param {boolean} [dynamic] contents change every frame (spray): set `count`, then refresh(gl)
   */
  constructor(data, dynamic = false) {
    this.data = data;
    this.dynamic = dynamic;
    this.count = dynamic ? 0 : data.length / SPRITE_FLOATS;
    this.bounds = dynamic ? [0, 0, 0, 0] : spriteBounds(data);
    this.vao = null;
  }

  /** Uploads the first `count` sprites and recomputes the bounds in place (dynamic batches). @param {WebGL2RenderingContext} gl */
  refresh(gl) {
    const d = this.data, b = this.bounds;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity, r = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * SPRITE_FLOATS;
      x0 = Math.min(x0, d[o]); x1 = Math.max(x1, d[o]); y0 = Math.min(y0, d[o + 1]); y1 = Math.max(y1, d[o + 1] + d[o + 4]);
      z0 = Math.min(z0, d[o + 2]); z1 = Math.max(z1, d[o + 2]); r = Math.max(r, d[o + 3], d[o + 4]);
    }
    b[0] = (x0 + x1) / 2; b[1] = (y0 + y1) / 2; b[2] = (z0 + z1) / 2;
    b[3] = this.count ? Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + r : 0;
    if (!this.count || !this.bufs) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[1]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * SPRITE_FLOATS);
  }

  /** @param {WebGL2RenderingContext} gl */
  release(gl) {
    gl.deleteVertexArray(this.vao);
    for (const b of this.bufs || []) gl.deleteBuffer(b);
    this.vao = null;
    this.bufs = null;
  }

  /** @param {WebGL2RenderingContext} gl */
  upload(gl) {
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.bufs = [gl.createBuffer(), gl.createBuffer()];
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[0]);
    gl.bufferData(gl.ARRAY_BUFFER, SPRITE_CORNERS, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[1]);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, this.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    for (let i = 0; i < 2; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, SPRITE_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);
  }
}

/**
 * Bounding sphere of a sprite instance array.
 * @param {Float32Array} d
 * @returns {number[]} [x, y, z, r]
 */
export function spriteBounds(d) {
  const n = d.length / SPRITE_FLOATS;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const o = i * SPRITE_FLOATS, top = d[o + 1] + d[o + 4];
    x0 = Math.min(x0, d[o]); x1 = Math.max(x1, d[o]);
    y0 = Math.min(y0, d[o + 1]); y1 = Math.max(y1, top);
    z0 = Math.min(z0, d[o + 2]); z1 = Math.max(z1, d[o + 2]);
  }
  const c = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  let r = 0;
  for (let i = 0; i < n; i++) {
    const o = i * SPRITE_FLOATS;
    r = Math.max(r, Math.hypot(d[o] - c[0], d[o + 1] - c[1], d[o + 2] - c[2]) + Math.max(d[o + 3], d[o + 4]));
  }
  return [...c, r];
}

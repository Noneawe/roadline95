// Renderer: owns GL programs, the index target, palette/colormap/texture resources and meshes;
// runs the world pass into the R8UI index buffer and the present pass. Knows nothing about the game.
// Every GPU resource is rebuilt from CPU data in init(), so context restore just calls init() again.
import { createProgram } from './program.js';
import { createIndexTarget, clearIndexTarget, setNearest } from './targets.js';
import { uploadTextureArray, writeTextureLayers, LAYER_SIZE } from './textures.js';
import { FLAGS } from './shaders/world.js';
import * as worldSrc from './shaders/world.js';
import * as wireSrc from './shaders/wire.js';
import * as presentSrc from './shaders/present.js';
import * as skySrc from './shaders/sky.js';
import * as spriteSrc from './shaders/sprite.js';
import { SKY_W, SKY_H, SKY_HORIZON, SKY_MAX_ELEV } from '../texgen/sky.js';
import { mat4Perspective, mat4View, mat4Multiply, frustumPlanes, sphereInFrustum } from '../engine/math3d.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** Maximum headlight cones evaluated per vertex at night. */
export const MAX_LIGHTS = 8;

/**
 * @typedef {{ mesh?: import('./mesh.js').Mesh, sprites?: import('./mesh.js').SpriteBatch, model?: Float32Array | null,
 *   bounds?: number[], visible?: boolean, detail?: boolean, range?: number[] }} DrawItem
 *   (detail: scenery limited to env.detailFar; range: [near, far) camera distance of a LOD mesh)
 * @typedef {{ pos: number[], yaw: number, pitch: number, roll?: number }} Camera
 * @typedef {{ lightDir: number[], ambient: number, diffuse: number, fogStart: number, fogEnd: number,
 *   lodTexels: number, night: boolean, fovY: number, near: number, far: number, sky: boolean, time: number,
 *   hlCount: number, hlPos: Float32Array, hlDir: Float32Array, hlShape: number[] }} Env
 */

export class Renderer {
  /** @param {WebGL2RenderingContext} gl @param {number} w @param {number} h */
  constructor(gl, w, h) {
    this.gl = gl;
    this.w = w;
    this.h = h;
    this.perspective = false;
    this.wire = false;
    this.rawpal = false;
    this.meshes = [];
    this.palette = null;
    this.colormap = null;
    this.layerData = null;
    this.layerCount = 0;
    this.skyData = null;
    this.stats = { tris: 0, draws: 0, gpuMs: 0 };
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.viewProj = new Float32Array(16);
    this.planes = new Float32Array(24);
    this.vp = new Float32Array(4);
    this.timing = false;
    // Detail options: caps on the draw distance and the scenery distance of every environment.
    this.maxFar = Infinity;
    this.maxDetailFar = Infinity;
    this.timerExt = null;
    this.query = null;
    this.queryOpen = false;
    this.init();
  }

  /** (Re)creates every GPU resource from CPU-side data. */
  init() {
    const gl = this.gl;
    const tex = { TEX_BASE: '64.0', TEX_LAYER: LAYER_SIZE, MAX_LIGHTS };
    this.progAffine = createProgram(gl, worldSrc, { PERSP: 0, ...tex });
    this.progPersp = createProgram(gl, worldSrc, { PERSP: 1, ...tex });
    this.spriteAffine = createProgram(gl, spriteSrc, { PERSP: 0, ...tex });
    this.spritePersp = createProgram(gl, spriteSrc, { PERSP: 1, ...tex });
    this.progWire = createProgram(gl, wireSrc);
    this.progPresent = createProgram(gl, presentSrc);
    this.progSky = createProgram(gl, skySrc, {
      SKY_W: `${SKY_W}.0`, SKY_H: `${SKY_H}.0`, SKY_HORIZON: `${SKY_HORIZON}.0`, SKY_MAX_ELEV: `${(SKY_MAX_ELEV * Math.PI) / 180}`,
    });
    this.skyTex = makeTexture(gl, gl.R8UI, SKY_W, SKY_H);
    this.target = createIndexTarget(gl, this.w, this.h);
    this.overlayTex = makeTexture(gl, gl.R8UI, this.w, this.h);
    this.paletteTex = makeTexture(gl, gl.RGBA8, 256, 1);
    this.colormapTex = makeTexture(gl, gl.R8UI, 256, 256);
    this.emptyVao = gl.createVertexArray();
    this.textureArray = null;
    this.timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.query = null;
    this.queryOpen = false;
    if (this.palette) this.setPalette(this.palette);
    if (this.colormap) this.setColormap(this.colormap);
    if (this.layerData) this.setTextures(this.layerData, this.layerCount);
    if (this.skyData) this.setSky(this.skyData);
    for (const m of this.meshes) m.upload(gl);
  }

  /** @param {Uint8Array} rgba 256 * 4 */
  setPalette(rgba) {
    this.palette = rgba;
    upload2D(this.gl, this.paletteTex, 256, 1, this.gl.RGBA, this.gl.UNSIGNED_BYTE, rgba);
  }

  /** @param {Uint8Array} cm 256 * 256 */
  setColormap(cm) {
    this.colormap = cm;
    upload2D(this.gl, this.colormapTex, 256, 256, this.gl.RED_INTEGER, this.gl.UNSIGNED_BYTE, cm);
  }

  /** @param {Uint8Array} data from buildLayerData @param {number} layers */
  setTextures(data, layers) {
    this.layerData = data;
    this.layerCount = layers;
    if (this.textureArray) this.gl.deleteTexture(this.textureArray);
    this.textureArray = uploadTextureArray(this.gl, data, layers);
  }

  /** @param {Uint8Array} data SKY_W * SKY_H indices, row 0 = top */
  setSky(data) {
    this.skyData = data;
    upload2D(this.gl, this.skyTex, SKY_W, SKY_H, this.gl.RED_INTEGER, this.gl.UNSIGNED_BYTE, data);
  }

  /** Registers and uploads a mesh or sprite batch (anything with upload(gl)). @param {{ upload: Function }} mesh */
  addMesh(mesh) {
    this.meshes.push(mesh);
    mesh.upload(this.gl);
    return mesh;
  }

  /**
   * Changes the index-buffer resolution (detail option); the overlay texture follows.
   * @param {number} w @param {number} h
   */
  resize(w, h) {
    const gl = this.gl, t = this.target;
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.color);
    gl.deleteRenderbuffer(t.depth);
    gl.deleteTexture(this.overlayTex);
    this.w = w;
    this.h = h;
    this.target = createIndexTarget(gl, w, h);
    this.overlayTex = makeTexture(gl, gl.R8UI, w, h);
  }

  /**
   * Replaces one texture of the library (near + far LOD layers), e.g. a regenerated car livery.
   * @param {number} layer near layer index (from the name registry) @param {object} tex library texture
   */
  updateTexture(layer, tex) {
    const gl = this.gl, L = LAYER_SIZE * LAYER_SIZE;
    writeTextureLayers(this.layerData, layer / 2, tex, this.notex ? this.palette : null);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, LAYER_SIZE, LAYER_SIZE, 2, gl.RED_INTEGER, gl.UNSIGNED_BYTE,
      this.layerData, layer * L);
  }

  /** Deletes every registered mesh (scene change). */
  clearMeshes() {
    for (const m of this.meshes) m.release(this.gl);
    this.meshes.length = 0;
  }

  /** Starts a frame: resets statistics and the GPU timer. Call once before the first renderWorld. */
  beginFrame() {
    this.stats.tris = 0;
    this.stats.draws = 0;
    this.beginTimer();
  }

  /** Uploads a dynamic sprite batch after its CPU data changed. @param {import('./mesh.js').SpriteBatch} batch */
  refreshSprites(batch) {
    batch.refresh(this.gl);
  }

  /** Re-uploads a mesh whose CPU data changed. @param {import('./mesh.js').Mesh} mesh */
  updateMesh(mesh) {
    mesh.updateData(this.gl);
  }

  /**
   * Renders the world into the index buffer, optionally into a sub-viewport (e.g. the rear-view mirror).
   * Items with `visible === false` are skipped.
   * @param {Camera} cam @param {DrawItem[]} items @param {number} clearIndex @param {Env} env
   * @param {{ x: number, y: number, w: number, h: number, mirror?: boolean } | null} [vp] buffer pixels, y up
   */
  renderWorld(cam, items, clearIndex, env, vp = null) {
    const gl = this.gl;
    const x = vp ? vp.x : 0, y = vp ? vp.y : 0, w = vp ? vp.w : this.w, h = vp ? vp.h : this.h, mirror = !!(vp && vp.mirror);
    mat4Perspective(this.proj, (env.fovY * Math.PI) / 180, w / h, env.near, Math.min(env.far, this.maxFar));
    if (mirror) this.proj[0] = -this.proj[0];
    mat4View(this.view, cam.pos, cam.yaw, cam.pitch, cam.roll || 0);
    mat4Multiply(this.viewProj, this.proj, this.view);
    frustumPlanes(this.planes, this.viewProj);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.viewport(x, y, w, h);
    gl.disable(gl.BLEND);
    if (vp) { gl.enable(gl.SCISSOR_TEST); gl.scissor(x, y, w, h); } else gl.disable(gl.SCISSOR_TEST);
    clearIndexTarget(gl, clearIndex);
    if (env.sky && this.skyData && !this.wire) this.drawSky(env, x, y, w, h, mirror);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.frontFace(mirror ? gl.CW : gl.CCW);
    gl.cullFace(gl.BACK);
    const prog = this.wire ? this.progWire : this.perspective ? this.progPersp : this.progAffine;
    gl.useProgram(prog.program);
    this.setWorldUniforms(prog.u, cam, env);
    let state = -1;
    let sprites = false;
    for (const item of items) {
      if (item.visible === false) continue;
      if (item.sprites) { sprites = true; continue; }
      if (item.bounds && (!this.inView(item.bounds) || this.tooFar(item, cam, env))) continue;
      const mesh = item.mesh, c = mesh.cpu.center;
      if (!mesh.instances) {
        const m = item.model || IDENTITY;
        const cx = m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12];
        const cy = m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13];
        const cz = m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14];
        if (!sphereInFrustum(this.planes, cx, cy, cz, mesh.cpu.radius)) continue;
        // Distance LOD: exactly one of the complementary [near, far) ranges matches.
        if (item.range) {
          const d = Math.hypot(cx - cam.pos[0], cy - cam.pos[1], cz - cam.pos[2]) * (env.lodScale || 1);
          if (d < item.range[0] || d >= item.range[1]) continue;
        }
        for (let i = 0; i < 4; i++) gl.vertexAttrib4f(5 + i, m[i * 4], m[i * 4 + 1], m[i * 4 + 2], m[i * 4 + 3]);
      } else {
        if (!mesh.instances.count) continue;
        mesh.instances.upload(gl);
      }
      const n = mesh.instances ? mesh.instances.count : 1;
      if (this.wire) {
        mesh.ensureWire(gl);
        gl.bindVertexArray(mesh.wireVao);
        gl.drawArraysInstanced(gl.LINES, 0, mesh.wireCount, n);
        this.stats.draws++;
        this.stats.tris += (mesh.cpu.count / 3) * n;
        continue;
      }
      gl.bindVertexArray(mesh.vao);
      for (const g of mesh.cpu.groups) {
        if (g.state !== state) { applyState(gl, g.state); state = g.state; }
        gl.drawArraysInstanced(gl.TRIANGLES, g.first, g.count, n);
        this.stats.draws++;
        this.stats.tris += (g.count / 3) * n;
      }
    }
    if (sprites && !this.wire) this.drawSprites(cam, items, env);
    gl.bindVertexArray(null);
    applyState(gl, FLAGS.DOUBLE);
    gl.frontFace(gl.CCW);
    gl.disable(gl.SCISSOR_TEST);
  }

  inView(b) {
    return sphereInFrustum(this.planes, b[0], b[1], b[2], b[3]);
  }

  // Scenery detail (items marked `detail`) is drawn only up to env.detailFar (draw-distance option).
  tooFar(item, cam, env) {
    if (!item.detail) return false;
    const far = Math.min(env.detailFar || Infinity, this.maxDetailFar);
    if (far === Infinity) return false;
    const b = item.bounds || item.sprites.bounds, p = cam.pos;
    return Math.hypot(b[0] - p[0], b[1] - p[1], b[2] - p[2]) - b[3] > far;
  }

  // Instanced billboards after the opaque world (binary cutout + z-buffer: no sorting needed).
  drawSprites(cam, items, env) {
    const gl = this.gl, prog = this.perspective ? this.spritePersp : this.spriteAffine, v = this.view;
    gl.useProgram(prog.program);
    this.setWorldUniforms(prog.u, cam, env);
    const rl = Math.hypot(v[0], v[8]) || 1;
    gl.uniform3f(prog.u.u_camRight, v[0] / rl, 0, v[8] / rl);
    gl.uniform1f(prog.u.u_frame, env.time * 4);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    for (const item of items) {
      if (!item.sprites || item.visible === false || !item.sprites.count || !this.inView(item.sprites.bounds) || this.tooFar(item, cam, env)) continue;
      gl.bindVertexArray(item.sprites.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, item.sprites.count);
      this.stats.draws++;
      this.stats.tris += item.sprites.count * 2;
    }
  }

  // Sky first: no depth test or write, so the world simply overdraws it.
  drawSky(env, x, y, w, h, mirror) {
    const gl = this.gl, u = this.progSky.u, v = this.view;
    const ty = Math.tan((env.fovY * Math.PI) / 360);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.progSky.program);
    gl.uniform3f(u.u_right, v[0], v[4], v[8]);
    gl.uniform3f(u.u_up, v[1], v[5], v[9]);
    gl.uniform3f(u.u_fwd, -v[2], -v[6], -v[10]);
    gl.uniform2f(u.u_tan, ty * (w / h), ty);
    gl.uniform4f(u.u_vp, x, y, w, h);
    gl.uniform1f(u.u_flip, mirror ? -1 : 1);
    bindUnit(gl, 0, this.skyTex, u.u_sky);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stats.draws++;
  }

  setWorldUniforms(u, cam, env) {
    const gl = this.gl;
    gl.uniformMatrix4fv(u.u_viewProj, false, this.viewProj);
    if (this.wire) { gl.uniform1ui(u.u_index, 255); return; }
    gl.uniform3f(u.u_camPos, cam.pos[0], cam.pos[1], cam.pos[2]);
    const d = env.lightDir, len = Math.hypot(d[0], d[1], d[2]);
    gl.uniform3f(u.u_lightDir, d[0] / len, d[1] / len, d[2] / len);
    gl.uniform1f(u.u_ambient, env.ambient);
    gl.uniform1f(u.u_diffuse, env.diffuse);
    // A shorter draw distance (detail option) pulls the fog in, so the world fades instead of ending.
    const fogEnd = Math.min(env.fogEnd, this.maxFar * 0.95);
    gl.uniform2f(u.u_fogRange, Math.min(env.fogStart, fogEnd * 0.6), fogEnd);
    gl.uniform1i(u.u_night, env.night ? 1 : 0);
    gl.uniform1i(u.u_hlCount, env.night ? env.hlCount : 0);
    if (env.night && env.hlCount) {
      gl.uniform4fv(u.u_hlPos, env.hlPos);
      gl.uniform4fv(u.u_hlDir, env.hlDir);
      gl.uniform3f(u.u_hlShape, env.hlShape[0], env.hlShape[1], env.hlShape[2]);
    }
    gl.uniform1f(u.u_lodTexels2, env.lodTexels * env.lodTexels);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray);
    gl.uniform1i(u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.colormapTex);
    gl.uniform1i(u.u_colormap, 1);
  }

  /**
   * Uploads the overlay and draws the 4:3 letterboxed image to the canvas.
   * @param {import('./overlay.js').Overlay} overlay @param {number} cw canvas width @param {number} ch canvas height
   */
  present(overlay, cw, ch) {
    const gl = this.gl;
    upload2D(gl, this.overlayTex, this.w, this.h, gl.RED_INTEGER, gl.UNSIGNED_BYTE, overlay.data);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.DEPTH_TEST);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const scale = Math.min(cw / 4, ch / 3);
    const vw = Math.round(scale * 4), vh = Math.round(scale * 3);
    const vx = (cw - vw) >> 1, vy = (ch - vh) >> 1;
    gl.viewport(vx, vy, vw, vh);
    const p = this.progPresent;
    gl.useProgram(p.program);
    gl.uniform4f(p.u.u_vp, vx, vy, vw, vh);
    gl.uniform1i(p.u.u_rawpal, this.rawpal ? 1 : 0);
    bindUnit(gl, 0, this.target.color, p.u.u_world);
    bindUnit(gl, 1, this.overlayTex, p.u.u_overlay);
    bindUnit(gl, 2, this.paletteTex, p.u.u_palette);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    this.endTimer();
  }

  /**
   * Debug/test only (synchronous readPixels): index buffer, rows bottom-up.
   * @returns {Uint8Array}
   */
  readIndexBuffer() {
    const gl = this.gl, n = this.w * this.h, raw = new Uint32Array(n * 4), out = new Uint8Array(n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.fbo);
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA_INTEGER, gl.UNSIGNED_INT, raw);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let i = 0; i < n; i++) out[i] = raw[i * 4];
    return out;
  }

  // GPU time via async timer query: one query in flight, result picked up frames later.
  beginTimer() {
    const gl = this.gl, ext = this.timerExt;
    if (!ext || !this.timing) return;
    if (this.query) {
      if (!gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) this.stats.gpuMs = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
      gl.deleteQuery(this.query);
    }
    this.query = gl.createQuery();
    gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query);
    this.queryOpen = true;
  }

  endTimer() {
    if (!this.queryOpen) return;
    this.gl.endQuery(this.timerExt.TIME_ELAPSED_EXT);
    this.queryOpen = false;
  }
}

function applyState(gl, state) {
  if (state & FLAGS.DOUBLE) gl.disable(gl.CULL_FACE);
  else gl.enable(gl.CULL_FACE);
  if (state & FLAGS.DECAL) {
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -2);
  } else {
    gl.disable(gl.POLYGON_OFFSET_FILL);
  }
}

function makeTexture(gl, format, w, h) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
  setNearest(gl, gl.TEXTURE_2D);
  return t;
}

function upload2D(gl, tex, w, h, format, type, data) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, format, type, data);
}

function bindUnit(gl, unit, tex, loc) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc, unit);
}

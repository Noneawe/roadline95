// Render targets: R8UI palette-index colour buffer + DEPTH_COMPONENT24, sized by detail level.

/**
 * @typedef {{ fbo: WebGLFramebuffer, color: WebGLTexture, depth: WebGLRenderbuffer, w: number, h: number }} IndexTarget
 */

/**
 * @param {WebGL2RenderingContext} gl @param {number} w @param {number} h
 * @returns {IndexTarget}
 */
export function createIndexTarget(gl, w, h) {
  const color = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, color);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8UI, w, h);
  setNearest(gl, gl.TEXTURE_2D);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`Index framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return { fbo, color, depth, w, h };
}

const CLEAR_INDEX = new Uint32Array(4);
const CLEAR_DEPTH = new Float32Array([1]);

/**
 * Clears the bound index target to a palette index and depth 1.
 * @param {WebGL2RenderingContext} gl @param {number} index
 */
export function clearIndexTarget(gl, index) {
  CLEAR_INDEX[0] = index;
  gl.depthMask(true);
  gl.clearBufferuiv(gl.COLOR, 0, CLEAR_INDEX);
  gl.clearBufferfv(gl.DEPTH, 0, CLEAR_DEPTH);
}

/**
 * NEAREST filtering, no mipmaps, clamp (wrapping is done in shaders).
 * @param {WebGL2RenderingContext} gl @param {number} target
 */
export function setNearest(gl, target) {
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

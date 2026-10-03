// WebGL2 context creation with era-correct options and context loss/restore handling.

/**
 * Creates the WebGL2 context (no AA, no default depth, opaque).
 * @param {HTMLCanvasElement} canvas
 * @returns {WebGL2RenderingContext | null}
 */
export function createContext(canvas) {
  return canvas.getContext('webgl2', {
    antialias: false, depth: false, stencil: false, alpha: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance',
  });
}

/**
 * Hooks context loss events. All GL resources must be rebuilt from CPU data in onRestored.
 * @param {HTMLCanvasElement} canvas @param {() => void} onLost @param {() => void} onRestored
 */
export function watchContext(canvas, onLost, onRestored) {
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onLost(); });
  canvas.addEventListener('webglcontextrestored', onRestored);
}

/**
 * Debug helper: loses the context and restores it after a delay (F4).
 * @param {WebGL2RenderingContext} gl @param {number} [delayMs=1000]
 * @returns {boolean} false if the extension is unavailable
 */
export function simulateContextLoss(gl, delayMs = 1000) {
  const ext = gl.getExtension('WEBGL_lose_context');
  if (!ext) return false;
  ext.loseContext();
  setTimeout(() => ext.restoreContext(), delayMs);
  return true;
}

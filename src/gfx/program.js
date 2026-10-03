// Shader program compilation with injected #defines and line-numbered error reports.

/**
 * @typedef {{ program: WebGLProgram, u: Record<string, WebGLUniformLocation> }} Program
 */

/**
 * Compiles and links a program; defines are inserted right after the #version line.
 * @param {WebGL2RenderingContext} gl
 * @param {{ vs: string, fs: string }} src
 * @param {Record<string, string | number>} [defines]
 * @returns {Program}
 */
export function createProgram(gl, src, defines = {}) {
  const head = Object.entries(defines).map(([k, v]) => `#define ${k} ${v}`).join('\n');
  const inject = (s) => s.replace(/^(#version[^\n]*\n)/, `$1${head}\n`);
  const program = gl.createProgram();
  const shaders = [compile(gl, gl.VERTEX_SHADER, inject(src.vs)), compile(gl, gl.FRAGMENT_SHADER, inject(src.fs))];
  for (const s of shaders) gl.attachShader(program, s);
  gl.linkProgram(program);
  for (const s of shaders) gl.deleteShader(s);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader link error:\n${gl.getProgramInfoLog(program)}`);
  }
  const u = {};
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) || 0;
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(program, i).name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(program, name);
  }
  return { program, u };
}

function compile(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const numbered = source.split('\n').map((l, i) => `${String(i + 1).padStart(3)}: ${l}`).join('\n');
    throw new Error(`Shader compile error:\n${gl.getShaderInfoLog(s)}\n${numbered}`);
  }
  return s;
}

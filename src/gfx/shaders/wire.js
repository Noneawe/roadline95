// Wireframe shader: draws mesh edges (GL_LINES) into the index buffer with one palette index.
// In: a_pos, per-instance model matrix a_m0..a_m3. Out: uint palette index u_index.

export const vs = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 5) in vec4 a_m0;
layout(location = 6) in vec4 a_m1;
layout(location = 7) in vec4 a_m2;
layout(location = 8) in vec4 a_m3;
uniform mat4 u_viewProj;

void main() {
  gl_Position = u_viewProj * mat4(a_m0, a_m1, a_m2, a_m3) * vec4(a_pos, 1.0);
}
`;

export const fs = `#version 300 es
precision highp float;
precision highp int;
uniform uint u_index;
out uint o_index;

void main() {
  o_index = u_index;
}
`;

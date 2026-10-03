// Sprite shader: instanced cylindrical billboards (rotate only around Y, so they never tilt into the
// terrain). Per instance: position, width, height, texture layer, frame count and phase (frame
// animation, e.g. crowds). Lit per vertex like the world (sun + headlights); fragment stage is the
// world fragment shader (colormap, dither, cutout). In: a_corner, a_inst0, a_inst1. Out: uint index.
import { FLAGS, LIGHTING_GLSL, fs as worldFs } from './world.js';

export const vs = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_inst0;
layout(location = 2) in vec4 a_inst1;
uniform mat4 u_viewProj;
uniform vec3 u_camRight;
uniform float u_frame;
${LIGHTING_GLSL}
#if PERSP
out vec2 v_uv;
#else
out vec3 v_uvw;
#endif
out float v_light;
out float v_fog;
flat out uint v_layer;
flat out uint v_flags;

void main() {
  vec3 p = a_inst0.xyz + u_camRight * (a_corner.x * a_inst0.w) + vec3(0.0, a_corner.y * a_inst1.x, 0.0);
  vec4 clip = u_viewProj * vec4(p, 1.0);
  gl_Position = clip;
  vec3 toCam = u_camPos - p;
  vec3 face = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(0.0, 0.001, 0.0));
  float light = sunLight(vec3(0.0, 1.0, 0.0)) + (u_night != 0 ? headlights(p, face) : 0.0);
  v_light = clamp(light, 0.0, 31.0);
  v_fog = fogLevel(p);
  vec2 uv = vec2(a_corner.x * 0.996 + 0.5, 0.998 - a_corner.y * 0.996);
#if PERSP
  v_uv = uv;
#else
  v_uvw = vec3(uv * clip.w, clip.w);
#endif
  float frames = max(1.0, a_inst1.z);
  uint frame = uint(mod(floor(u_frame + a_inst1.w), frames));
  v_layer = uint(a_inst1.y + 0.5) + frame * 2u;
  v_flags = ${FLAGS.CUTOUT}u;
}
`;

export const fs = worldFs;

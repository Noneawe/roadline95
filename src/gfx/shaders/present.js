// Present shader: full-screen triangle that point-samples the index buffer and CPU overlay
// inside the 4:3 letterbox viewport and looks the result up in the palette.
// In: u_world (R8UI), u_overlay (R8UI, row 0 = top, 0 = transparent), u_palette (RGBA8 256x1). Out: RGBA.

export const vs = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));

void main() {
  gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
}
`;

export const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
uniform usampler2D u_world;
uniform usampler2D u_overlay;
uniform sampler2D u_palette;
uniform vec4 u_vp;
uniform int u_rawpal;
out vec4 o_color;

void main() {
  ivec2 size = textureSize(u_world, 0);
  vec2 rel = (gl_FragCoord.xy - u_vp.xy) / u_vp.zw;
  ivec2 p = clamp(ivec2(rel * vec2(size)), ivec2(0), size - 1);
  uint w = texelFetch(u_world, p, 0).r;
  uint o = texelFetch(u_overlay, ivec2(p.x, size.y - 1 - p.y), 0).r;
  uint idx = o != 0u ? o : w;
  o_color = u_rawpal != 0 ? vec4(vec3(float(idx) / 255.0), 1.0)
                          : texelFetch(u_palette, ivec2(int(idx), 0), 0);
}
`;

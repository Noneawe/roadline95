// Sky shader: full-screen pass drawn first; each index-buffer pixel looks up the cylindrical
// R8UI panorama by view-ray azimuth (scrolls with camera yaw) and elevation (moves with pitch).
// In: u_sky (512x128 indices), camera basis, tan of half FOV, viewport (u_vp) and mirror flip.
// Out: uint palette index (no fog/light).
// Defines: SKY_W, SKY_H, SKY_HORIZON, SKY_MAX_ELEV (radians).

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
uniform usampler2D u_sky;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_fwd;
uniform vec2 u_tan;
uniform vec4 u_vp;
uniform float u_flip;
out uint o_index;

void main() {
  vec2 ndc = (gl_FragCoord.xy - u_vp.xy) / u_vp.zw * 2.0 - 1.0;
  ndc.x *= u_flip;
  vec3 d = normalize(u_fwd + u_right * ndc.x * u_tan.x + u_up * ndc.y * u_tan.y);
  float az = atan(d.x, -d.z) / 6.28318530718;
  float el = asin(clamp(d.y, -1.0, 1.0));
  int x = int(floor(fract(az) * SKY_W)) & (int(SKY_W) - 1);
  int y = clamp(int(floor(SKY_HORIZON - el / SKY_MAX_ELEV * SKY_HORIZON)), 0, int(SKY_H) - 1);
  o_index = texelFetch(u_sky, ivec2(x, y), 0).r;
}
`;

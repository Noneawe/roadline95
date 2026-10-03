// World shader: textured geometry rendered into the R8UI palette-index buffer through the colormap.
// In: a_pos, a_normal, a_uv (repeats), a_layer, a_flags, per-instance model matrix a_m0..a_m3
// (generic attribute constant when not instanced; a_m0.w carries a per-instance texture offset,
// a_m1.w = 1 draws the instance with a checkerboard screen door).
// Lighting per vertex: sun (ambient + diffuse) plus night headlight cones (u_hl*). Out: uint palette index.
// Compile-time defines: PERSP (0 affine / 1 perspective-correct UV), TEX_BASE, TEX_LAYER, MAX_LIGHTS.

/**
 * Material flags stored per vertex in a_flags. NIGHT_ALT: at night use the next library texture
 * (e.g. windows -> windowsNight). NIGHT_ONLY: geometry exists only at night (light pools).
 * VARIANT: the per-instance texture offset (a_m0.w) applies to this material (e.g. ad0..ad3).
 * SCREEN_DOOR: set per instance (a_m1.w = 1, e.g. the time-trial ghost car): every other pixel is
 * discarded in a checkerboard on the index buffer (binary "transparency" of the era).
 */
export const FLAGS = {
  GOURAUD: 1, CUTOUT: 2, EMIT: 4, NIGHT_EMIT: 8, DOUBLE: 16, NOFOG: 32, DECAL: 64, NIGHT_ALT: 128, NIGHT_ONLY: 256,
  VARIANT: 512, SCREEN_DOOR: 1024,
};

/** Shared vertex-lighting GLSL (world and sprite shaders): sun plus headlight cones, in colormap levels. */
export const LIGHTING_GLSL = `
uniform vec3 u_lightDir;
uniform float u_ambient;
uniform float u_diffuse;
uniform vec2 u_fogRange;
uniform vec3 u_camPos;
uniform int u_night;
uniform int u_hlCount;
uniform vec4 u_hlPos[MAX_LIGHTS];
uniform vec4 u_hlDir[MAX_LIGHTS];
uniform vec3 u_hlShape;

// Headlights: cone between cos(outer) and cos(inner) (u_hlShape.xy), range in u_hlPos.w, gain u_hlShape.z.
float headlights(vec3 p, vec3 n) {
  float sum = 0.0;
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_hlCount) break;
    vec3 L = p - u_hlPos[i].xyz;
    float d = length(L);
    vec3 l = L / max(d, 0.001);
    float cone = smoothstep(u_hlShape.x, u_hlShape.y, dot(l, u_hlDir[i].xyz));
    float att = clamp(1.0 - d / u_hlPos[i].w, 0.0, 1.0);
    // Low-mounted lamps hit the road at a grazing angle: keep most of the light regardless of facing.
    float face = 0.7 + 0.3 * max(0.0, dot(n, -l));
    sum += cone * att * face;
  }
  return sum * u_hlShape.z;
}

float sunLight(vec3 n) {
  return u_ambient + u_diffuse * max(0.0, dot(n, -u_lightDir));
}

float fogLevel(vec3 p) {
  return clamp((distance(p, u_camPos) - u_fogRange.x) / (u_fogRange.y - u_fogRange.x), 0.0, 1.0) * 7.0;
}
`;

export const vs = `#version 300 es
precision highp float;
precision highp int;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in uint a_layer;
layout(location = 4) in uint a_flags;
layout(location = 5) in vec4 a_m0;
layout(location = 6) in vec4 a_m1;
layout(location = 7) in vec4 a_m2;
layout(location = 8) in vec4 a_m3;
uniform mat4 u_viewProj;
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
  mat4 model = mat4(vec4(a_m0.xyz, 0.0), vec4(a_m1.xyz, 0.0), vec4(a_m2.xyz, 0.0), a_m3);
  vec4 world = model * vec4(a_pos, 1.0);
  vec4 clip = u_viewProj * world;
  bool night = u_night != 0;
  // Night-only geometry is pushed outside the clip volume during the day.
  gl_Position = (a_flags & ${FLAGS.NIGHT_ONLY}u) != 0u && !night ? vec4(0.0, 0.0, 2.0, 1.0) : clip;
  vec3 n = normalize(mat3(model) * a_normal);
  bool emit = (a_flags & ${FLAGS.EMIT}u) != 0u || (night && (a_flags & ${FLAGS.NIGHT_EMIT}u) != 0u);
  float light = sunLight(n) + (night ? headlights(world.xyz, n) : 0.0);
  v_light = emit ? 31.0 : clamp(light, 0.0, 31.0);
  v_fog = (a_flags & ${FLAGS.NOFOG}u) != 0u ? 0.0 : fogLevel(world.xyz);
#if PERSP
  v_uv = a_uv;
#else
  // Hardware interpolation is perspective-correct; dividing (uv*w)/w in the fragment
  // shader cancels it and yields screen-linear (affine) UVs, like software rasterizers.
  v_uvw = vec3(a_uv * clip.w, clip.w);
#endif
  uint layer = a_layer + ((a_flags & ${FLAGS.VARIANT}u) != 0u ? uint(a_m0.w + 0.5) * 2u : 0u);
  if (night && (a_flags & ${FLAGS.NIGHT_ALT}u) != 0u) layer += 2u;
  v_layer = layer;
  v_flags = a_flags | (a_m1.w > 0.5 ? ${FLAGS.SCREEN_DOOR}u : 0u);
}
`;

export const fs = `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;
precision highp usampler2DArray;
uniform usampler2DArray u_tex;
uniform usampler2D u_colormap;
uniform float u_lodTexels2;
#if PERSP
in vec2 v_uv;
#else
in vec3 v_uvw;
#endif
in float v_light;
in float v_fog;
flat in uint v_layer;
flat in uint v_flags;
out uint o_index;

const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0,
                                  3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);

void main() {
#if PERSP
  vec2 uv = v_uv;
#else
  vec2 uv = v_uvw.xy / v_uvw.z;
#endif
  // Point-sampled LOD: the simplified 32x32 layer (right after the near one) is used where one
  // index-buffer pixel covers more than u_lodTexels texels. No filtering, no mipmaps.
  vec2 tc = uv * TEX_BASE;
  vec2 dx = dFdx(tc), dy = dFdy(tc);
  uint layer = v_layer + (max(dot(dx, dx), dot(dy, dy)) > u_lodTexels2 ? 1u : 0u);
  ivec2 t = ivec2(floor(tc)) & (TEX_LAYER - 1);
  uint texel = texelFetch(u_tex, ivec3(t, int(layer)), 0).r;
  if (texel == 0u && (v_flags & ${FLAGS.CUTOUT}u) != 0u) discard;
  if ((v_flags & ${FLAGS.SCREEN_DOOR}u) != 0u && ((int(gl_FragCoord.x) + int(gl_FragCoord.y)) & 1) == 0) discard;
  // Bayer threshold in index-buffer pixels (gl_FragCoord of the R8UI target).
  ivec2 p = ivec2(gl_FragCoord.xy) & 3;
  float dl = (BAYER[p.y * 4 + p.x] + 0.5) / 16.0;
  float df = (BAYER[p.x * 4 + p.y] + 0.5) / 16.0;
  int light = clamp(int(floor(v_light + dl)), 0, 31);
  int fog = clamp(int(floor(v_fog + df)), 0, 7);
  o_index = texelFetch(u_colormap, ivec2(int(texel), fog * 32 + light), 0).r;
}
`;

# CLAUDE.md – ROADLINE '95

This file is the main source of knowledge about the project. Read it in full before the first code change. If a user request contradicts this file, follow the request but point out the contradiction in the report.

---

## 1. About the project

**ROADLINE '95** (working title) is a browser racing game in the style of the racers of the mid-1990s: the first texture-mapped 3D worlds, SVGA 640×480 in 256 colors, Gouraud shading, sprite trees and spectators, tracker music. Rendering uses **WebGL2**, but the pipeline faithfully emulates the software engines of the time:

- rendering into a **640×480** (SVGA) or **320×240** (low detail) buffer where every pixel is an **index into a 256-color palette**,
- **indexed** textures (8-bit, one shared palette), point sampling, no filtering and no mipmaps,
- **affine texture mapping** (the characteristic "swimming"), limited by subdividing large polygons, with optional perspective correction,
- lighting and fog through a **colormap** (an index → index lookup table), as in the software engines of the era,
- Gouraud shading with dithered brightness levels.

The main features of the game:

- races against 7 AI rivals on closed circuits and one point-to-point track,
- modes: single race, championship, time trial, 2 players on a split screen,
- 6 fictional mid-90s sports cars presented in a 3D showroom,
- cockpit view, outside cameras, TV-style replays,
- times of day, rain, fog, night with headlights,
- tracker-style music (MOD/S3M-like modules) and sample-based sound.

Goal: a smooth (60 FPS) game faithful to the era, working offline, also on phones, easy to tune by editing data.

---

## 2. How we work

The project is built in 10 stages described in section 17. The user starts work with a command like **"Realizuj etap 3"** ("do stage 3"). Then:

1. Read the stage description and its acceptance criteria (Definition of Done).
2. Do only that stage. Do not implement features of later stages "on the way". If something from a later stage needs preparation now, add a minimal hook and describe it in the report.
3. Follow the workflow from section 18 and finish with the report from section 19.

The user may also ask for **"Kontrola"** ("review") – then do the review from section 18.4 without changing the code.

---

## 3. Overriding rules (never break them)

1. **Original content only.** Fictional cars with no names, logos or characteristic silhouettes of real brands. No names of existing games, publishers, series, circuits or sponsors in the code, UI, textures, comments or file names. Trackside ads only with invented brands. Original music.
2. **Zero runtime dependencies.** Plain JavaScript (ES2020+, ES modules), WebGL2, Web Audio API. No libraries, no GL helpers, no CDNs.
3. **The look of the era is mandatory.** The rules of section 8.1 apply: no linear filtering, mipmaps, MSAA, per-pixel lighting, normal maps, dynamic shadows, bloom, HDR or colors outside the palette. If an effect needs to break these rules, report it.
4. **Zero external assets.** Textures, models, sprites, the font, shaders, sound samples and music are generated or defined in code. No PNG, OBJ, GLSL, WAV, MOD or TTF files at runtime.
5. **Do not break what works.** Every change keeps the features of completed stages. A regression means the task is not finished.
6. **No placeholders.** Never leave `// ...rest unchanged`, empty functions pretending to be finished, or a `TODO` in place of existing logic.
7. **Parameters in CONFIG.** Numbers meant for tuning live in `src/config.js`; shaders get them through uniforms or `#define`s injected at compile time.
8. **Honesty.** Do not claim you tested something you did not. Do not hide known problems.

---

## 4. Stage status

Update after finishing a stage (`[ ]` → `[x]`) with the date. Tick a stage only when all of its criteria from section 17 are met.

- [ ] Stage 1 – renderer: index buffer, indexed textures, colormap (implemented 2026-10-01, awaiting manual acceptance of keys F1–F6 and 60 FPS in a window)
- [ ] Stage 2 – texture generator, test track, sky, fog (implemented 2026-10-01, awaiting acceptance: texture style and shimmering in motion)
- [ ] Stage 3 – car, physics, cockpit, cameras (implemented 2026-10-01, awaiting acceptance: handling on keyboard and gamepad)
- [ ] Stage 4 – scenery, sprites, zones, time of day, night (implemented 2026-10-01, awaiting acceptance: zones, night and sprite shimmering in motion)
- [ ] Stage 5 – AI rivals, race logic, collisions, visual damage (implemented 2026-10-01, awaiting acceptance: rival behaviour and racing in motion)
- [ ] Stage 6 – tracks, cars, championship (implemented 2026-10-02, awaiting acceptance: track character and handling differences in motion)
- [ ] Stage 7 – sound: samples, engine, tracker music (implemented 2026-10-02, awaiting acceptance: listening to engines, effects and music)
- [ ] Stage 8 – TV replays, weather (implemented 2026-10-02, awaiting acceptance: replays and driving in the rain)
- [ ] Stage 9 – split screen for 2 players (implemented 2026-10-02, awaiting acceptance: two players on keyboard and gamepads)
- [ ] Stage 10 – menus, showroom, detail options, records, mobile (implemented 2026-10-02, awaiting acceptance: phone and gamepad tests, menu review)

---

## 5. Commands

Requirements: a browser with WebGL2, Node.js 18+ (only for the build and the tests, no npm packages).

```bash
# Development
python3 -m http.server 8080
# game:           http://localhost:8080/index.html (title screen and menus; race parameters in the URL start a race directly)
# render tests:   http://localhost:8080/tests/render.html
# texture viewer: http://localhost:8080/tests/textures.html

# Single-file build
node tools/build.mjs
# output: dist/roadline95.html – works from file://

# Logic tests (node:assert)
node tools/test.mjs

# Render tests in headless Chrome/Chromium (SwiftShader); --update rewrites the goldens in tools/golden/
node tools/render-test.mjs [--update]
```

Do not add a `package.json` with dependencies. The tools in `tools/` use only built-in Node modules.

### URL parameters (debug)

| Parameter | Effect |
|---|---|
| `?debug=1` | debug overlay (FPS, CPU/GPU, triangles, draw calls, position, lap, AI); with `&info=0` the overlay starts hidden |
| `?scene=render` | stage 1 renderer test scene (`?scene=track` – stage 2 track preview; default: the game) |
| `?track=2` | track (0 harbour at night, 1 raceway, 2 mountain loop, 3 desert highway, 4 coast – sprint, 5 temporary stage 2 test track) |
| `?mode=champ` | mode: `race` (single race, default), `champ` (championship), `time` (time trial with a ghost); Enter after the results = continue |
| `?car=4` | car (0–5; cars locked in `data/championship.js` need a championship win, `?debug=1` skips the lock) |
| `?color=1` | player livery color set (0–2) |
| `?players=2` | split screen for 2 players (single race only; at most 6 rivals) |
| `?car2=3` / `?color2=1` | player 2 car and colors |
| `?ai=3` | number of rivals (0–7, default 7) |
| `?laps=2` | number of laps (default from the track) |
| `?time=night` | `day`, `dusk`, `night` (default: the first entry of the track's `timeOfDay`) |
| `?zone=forest` | replace the track's zone (`raceway`, `coastCity`, `mountains`, `desert`, `forest`, `coast`) |
| `?weather=rain` | `clear`, `rain`, `fog` |
| `?detail=low` | 320×240 and low detail |
| `?persp=1` | perspective-correct textures instead of affine mapping |
| `?seed=1234` | fixed RNG seed (also for the texture generator) |
| `?mute=1` | audio muted |
| `?god=1` | planned in the original specification (no collisions, no damage) – not implemented yet |
| `?wire=1` | wireframe |
| `?rawpal=1` | index buffer shown as grayscale |
| `?notex=1` | textures off (flat average texture colors) |

Debug keys: **F1** overlay, **F2** wireframe, **F3** affine/perspective toggle, **F4** WebGL context loss, **F5** colormap preview, **F6** index buffer dump. In the track preview (`?scene=track`): ↑/↓ camera speed, ←/→ lateral offset, **C** free camera. In the driving scene with `?debug=1`: **F7** free camera; `window.roadline` = `{ scene, renderer }` (hook for test pages).

---

## 6. Directory structure

```
/
├── CLAUDE.md
├── CHANGELOG.md
├── README.md, LICENSE
├── index.html
├── site/index.html        ← landing page of the GitHub Pages site (the game is published as play.html)
├── docs/screenshots/      ← screenshots for the README and the site
├── tests/
│   ├── render.html        ← render tests
│   └── textures.html      ← viewer of every generated texture
├── src/
│   ├── main.js
│   ├── config.js
│   ├── storage.js         ← save: unlocked cars, options, records, championship history (validated)
│   ├── state/             ← screens and game flow:
│   │     app (title → menus → showroom/setup → loading → race with a pause menu),
│   │     title (intro flyover and logo), menu (menu definitions and pages: records, keys),
│   │     ui (menu widgets: background, panels, buttons, logo, Menu), showroom (podium, spec card, colors, livery refresh),
│   │     options (options and applying them at once), touch (touch controls), music (music by situation),
│   │     session (race modes, scene switching, colormap and sky per track, records),
│   │     race (race scene for 1–2 players: "seats" with camera, input, viewport and overlay; rivals, HUD, ghost;
│   │           createDriveScene = no rivals),
│   │     raceAudio (race sound: engines, effects, start, tunnel, radio), replay (replay playback: controls, cameras, REPLAY banner),
│   │     raceCar (race car models: LOD, livery, damage, rain spray), env (world parameters for the renderer, view setup),
│   │     renderTest (?scene=render, stage 1), trackTest (track preview, stage 2; also builds the track world)
│   ├── engine/
│   │   ├── loop.js
│   │   ├── input.js       ← keyboard, 2 gamepads, touch → per-player actions; pointer; menu navigation
│   │   ├── rng.js
│   │   ├── math3d.js
│   │   └── debug.js       ← debugLog, debug overlay, colormap preview
│   ├── gfx/
│   │   ├── gl.js          ← context, context loss
│   │   ├── program.js
│   │   ├── targets.js     ← R8UI index buffer + depth, size by detail
│   │   ├── palette.js     ← 256-color palette, palette texture
│   │   ├── colormap.js    ← colormap generation (light × fog)
│   │   ├── textures.js    ← R8UI texture array, name → layer registry
│   │   ├── mesh.js        ← VBO/VAO, instancing, sprites
│   │   ├── renderer.js    ← passes, viewports, split screen, mirror, resize
│   │   ├── overlay.js     ← CPU 2D buffer
│   │   ├── draw2d.js      ← 2D primitives, indexed bitmap blit
│   │   ├── font.js        ← VGA-style 8×16 font + large HUD font
│   │   └── shaders/
│   │       ├── world.js   ← textured geometry → index
│   │       ├── sprite.js  ← billboards
│   │       ├── sky.js     ← sky panorama
│   │       ├── wire.js
│   │       └── present.js
│   ├── texgen/            ← procedural texture generator (no GL, testable)
│   │   ├── noise.js       ← value/Perlin noise, fBm, Voronoi
│   │   ├── ops.js         ← quantization to ramps, tiling, drawing
│   │   ├── library.js     ← all texture definitions
│   │   ├── sky.js         ← 512×128 sky panoramas
│   │   └── livery.js      ← 128×128 car liveries
│   ├── models/            ← loader.js (section 10 format), primitives.js, testCar.js, carBuilder.js (cars with LODs), scenery.js
│   ├── world/
│   │   ├── track.js       ← track mesh with UVs
│   │   ├── terrain.js
│   │   ├── scenery.js
│   │   ├── racingline.js  ← racing line for the AI
│   │   ├── ground.js      ← ground queries (height, normal, surface, limits)
│   │   ├── meshbuild.js   ← meshes (grids with Gouraud normals, flat quads)
│   │   └── chunks.js
│   ├── vehicle/
│   │   ├── physics.js
│   │   ├── tyres.js
│   │   ├── drivetrain.js
│   │   ├── damage.js      ← visual damage
│   │   ├── pose.js        ← visual car pose (roll, pitch)
│   │   ├── assists.js     ← braking assist
│   │   ├── stats.js       ← showroom figures (power, 0-100, top speed from the physics model)
│   │   └── cars.js
│   ├── ai/
│   │   └── opponent.js
│   ├── game/
│   │   ├── race.js        ← laps, positions, start, finish
│   │   ├── raceSim.js     ← DOM-free race simulation (cars, AI, collisions, damage, resets, slipstream, sprint run-out)
│   │   ├── ghost.js       ← time trial ghost
│   │   ├── championship.js← points and standings
│   │   ├── records.js     ← lap and track records, season history
│   │   ├── collision.js   ← car vs static objects (from stage 4, at the user's request), car vs car in stage 5
│   │   ├── replay.js      ← delta-compressed recording of car states, interpolated decoding
│   │   └── weather.js     ← weather presets → fog, light, sky, grip
│   ├── cockpit/           ← dashboard.js (static bitmap), cockpit.js (needles, wheel, HUD), raceHud.js (position, laps,
│   │                         times, map, lights, results, standings), rain.js (drops, windscreen, wipers)
│   ├── camera/            ← free.js (debug), trackFollow.js (track preview), carCams.js (cockpit, bumper, chase, far),
│   │                         tv.js (trackside TV cameras, shot director, helicopter)
│   ├── audio/
│   │   ├── mixer.js
│   │   ├── samplegen.js   ← procedural samples (engine, tyres, drums, instruments)
│   │   ├── tracker.js     ← module player (patterns, effects)
│   │   ├── songs.js       ← song data
│   │   ├── engine-sound.js← sample-based engine by rpm
│   │   └── sfx.js
│   └── data/
│       ├── tracks/        ← one track = one file, index.js = registry (?track=N)
│       ├── zones.js
│       └── championship.js← season: rounds, points, car to unlock
├── tools/
│   ├── build.mjs
│   ├── test.mjs
│   ├── render-test.mjs    ← tests/render.html in headless Chrome
│   └── golden/            ← reference index buffer dumps
├── .github/workflows/pages.yml ← tests, build and the GitHub Pages site
└── dist/
```

Rules:

- One module = one responsibility.
- `gfx/` knows nothing about the game.
- `render` does not change the game state, `update` does not draw.
- `engine/math3d.js`, `texgen/`, `models/`, `vehicle/`, `world/` (data building), `ai/`, `game/race.js`, `game/championship.js`, `audio/samplegen.js` and the validators do not touch `window`, `document`, WebGL or AudioContext – they are testable in Node.

---

## 7. Code conventions

- ES modules, `const`/`let`, no `var`. Plain objects and functions; classes for entities with a life cycle.
- Identifiers, comments, `CLAUDE.md` and `CHANGELOG.md` **in English** (the project is published as an English repository); reports to the user **in Polish**.
- `camelCase`, `PascalCase` for classes, `UPPER_SNAKE_CASE` for constants.
- Every file starts with a 1–3 sentence comment about its purpose.
- Exported functions have JSDoc with types.
- Functions up to about 60 lines.
- **No allocation in the hot loop.** Object pools, preallocated `Float32Array`s for uniforms.
- No `console.log` in production code; `debugLog()` only with `?debug=1`.
- Exceptions in audio and storage never stop the game loop.

### GLSL conventions

- `#version 300 es`, `precision highp float;`, `precision highp usampler2D;`, `precision highp usampler2DArray;`.
- Shaders as template strings in `gfx/shaders/*.js`, exporting `{ vs, fs }`.
- Attributes `a_`, uniforms `u_`, varyings `v_`.
- Header comment: inputs, outputs, purpose.
- Compile errors with line numbers, shown on screen in debug mode.

---

## 8. Renderer – specification

### 8.1 Rules of the era's look

- A **640×480** (high) or **320×240** (low) buffer, 4:3 aspect ratio, square pixels.
- The world renders **palette indices**.
- Indexed textures, **point sampling**, no filtering, no mipmaps. Shimmering of distant textures is part of the style; it is limited with simplified textures for the far LODs, not with filtering.
- **Affine mapping** by default. Large polygons (road, terrain, walls) are subdivided geometrically to limit the distortion – as the engines of the era did. Perspective correction is an option (F3, CONFIG).
- Lighting: flat or Gouraud per vertex, quantized to 32 levels, transitions with 4×4 Bayer dithering.
- Fog and fading through the colormap, with extra dithering at the edge of the range.
- Binary transparency only (index 0 = hole). No semi-transparency; glass, smoke and rain are done with dithering (a checkerboard pattern) or the overlay.
- None of: linear filtering, mipmaps, MSAA, per-pixel lighting, dynamic shadows (a flat "blob" shadow under the car is allowed), post-processing.

### 8.2 Render targets and GPU resources

- **Index buffer:** `R8UI` sized by the detail level + `DEPTH_COMPONENT24`.
- **Texture array:** `TEXTURE_2D_ARRAY`, `R8UI` format, **128×128** layers (64×64 textures tiled 2×2 on load). Every layer also has a simplified "far" variant reduced to 32×32 (point-upscaled) for the LOD. The LOD is chosen in the shader from UV derivatives (`dFdx/dFdy`): the far variant when one buffer pixel covers more than `CONFIG.tex.lodTexels` texels (point sampling, no filtering).
- **Sky:** a separate 512×128 `R8UI` texture (cylindrical panorama).
- **Palette:** `RGBA8` 256×1.
- **Colormap:** `R8UI` 256×256 – row = `fogLevel * 32 + lightLevel` (8 fog levels × 32 light levels), column = texture index, value = resulting index.
- **2D overlay:** a `Uint8Array` the size of the buffer, uploaded every frame, index 0 = transparent.
- All textures `NEAREST`, no mipmaps, read with `texelFetch`. Texture wrapping computed in the shader (`fract` / bit masks).

### 8.3 Palette and colormap

- 256-color palette: **16 ramps × 16 levels** (index = `ramp*16 + level`), ramps chosen for the textures: asphalt, concrete, grass, leaves, dirt, sand, rock, brick, water, sky, clouds, paint 1–3, skin/spectators, lights (emissive).
- Index 0 is reserved (transparency in textures and the overlay).
- The colormap is generated on the CPU in `colormap.js`: for every input index and light level the target color is computed (RGB multiply, saturating when brightening above 1.0), then mixed with the fog color by the fog level, then the nearest palette color is looked up (perceptually weighted distance).
- Colormaps for every time of day × weather combination are generated on demand (or lazily in a worker if it takes > 200 ms) and cached.
- Emissive colors (lights, ads lit at night) get light level 31 regardless of the lighting.

### 8.4 Passes per frame

For every viewport (1, or 2 with split screen):

1. Bind the index buffer, viewport/scissor, clear.
2. **Sky:** cylindrical panorama scrolled by the camera rotation, no depth write.
3. **Static world:** track and terrain chunks.
4. **Objects:** instanced models, vehicles, the "blob" shadow under the cars.
5. **Sprites:** cylindrical billboards (trees, spectators, flags) with `discard` for index 0.
6. **Mirror** (in the cockpit): a rectangle with its own viewport, lower LOD.

Then:

7. CPU overlay: cockpit, HUD, rain, upload.
8. **Present:** 4:3 letterbox, overlay over the world, palette lookup.

### 8.5 World shader

Per-vertex input:

- `a_pos` (vec3), `a_normal` (vec3, vertex normal for Gouraud or face normal for flat), `a_uv` (vec2, in repeat units), `a_layer` (uint, texture layer), `a_flags` (uint).
- Instancing: the model matrix as 4 × `vec4`, divisor 1.

Vertex shader:

- light: `ambient + diffuse * max(0, dot(n, -lightDir))` + the headlight contribution at night (a cone in front of the cars), result 0–31 as a float,
- fog: 0–7 as a float from the distance,
- **affine UVs:** output `v_uvw = vec3(uv * clip.w, clip.w)`; in the fragment shader `uv = v_uvw.xy / v_uvw.z` gives interpolation linear in screen space (affine mapping),
- with perspective correction: a plain `v_uv` varying.

Fragment shader:

- texel: `texelFetch(u_tex, ivec3(wrap(uv) * size, layer), 0).r`,
- index 0 → `discard` (only for materials with the `CUTOUT` flag),
- light and fog levels dithered with a Bayer matrix from `gl_FragCoord.xy` (the index buffer's pixel grid), rounded to integers,
- result: `texelFetch(u_colormap, ivec2(texel, fog*32 + light), 0).r`.

Material flags: `GOURAUD`, `CUTOUT`, `EMIT`, `NIGHT_EMIT`, `DOUBLE`, `NOFOG`, `DECAL` (with depth offset), `NIGHT_ALT` (at night the next library texture, e.g. `windows` → `windowsNight`), `NIGHT_ONLY` (geometry only at night, e.g. street lamp light pools), `VARIANT` (texture offset from the instance `a_m0.w`, e.g. `ad0..ad3`, car liveries), `SCREEN_DOOR` (from the instance `a_m1.w = 1`: every other index buffer pixel is discarded in a checkerboard – the time trial ghost). A texture with transparent pixels requires `CUTOUT` (checked by a test). Headlights: up to `MAX_LIGHTS` cones computed per vertex at night (`CONFIG.headlights`). Sprites: `shaders/sprite.js` (cylindrical billboards; instances: position, size, layer, frame count, phase).

### 8.6 Polygon subdivision (limiting affine distortion)

- Building the track and terrain meshes (in Node) subdivides surfaces so that no triangle exceeds `CONFIG.tess.maxEdge` metres (track and terrain strip grid: `CONFIG.track.cell` cells, diagonal ≤ maxEdge). Exception: the background terrain beyond the strip along the track (`CONFIG.track.baseCell`), seen only from far away and in the fog.
- Object faces larger than the threshold are subdivided when the model is loaded.
- The default value is chosen so that the "swimming" shows only on close, large surfaces – as in the games of the era.

### 8.7 Geometry organisation

- Chunks along the track (`CONFIG.track.chunkLen`), VBOs built once, in two LODs: near and far (every other sample row, shared end rows – no cracks), switched by the distance to the chunk centre (`CONFIG.track.chunkLodDist`, the `range` field of a draw item). Scenery objects and sprites (`detail`) are drawn up to `CONFIG.render.detailFar`. Mirror: only near chunks and the barrier strips.
- Instancing for repeated objects and sprites.
- Draw calls sorted by program, VAO, flags.
- Budget: **≤ 400 draw calls** per viewport.

### 8.8 WebGL context

- WebGL2 required; without it a screen with a message.
- Options: `antialias: false`, `depth: false`, `alpha: false`, `preserveDrawingBuffer: false`, `powerPreference: 'high-performance'`.
- Context loss and restore: every GL resource can be rebuilt from CPU data (textures from the generator or a CPU cache).

---

## 9. Texture generator

All textures come from `src/texgen/` with a seedable RNG. The same seed always gives identical textures (test in 16.1).

### 9.1 Rules

- The generator works on `Float32Array` buffers (values 0–1 or RGB) and at the end **quantizes to palette indices** of the given ramp or set of ramps, with optional dithering.
- Repeating textures must be **seamless** (periodic noise). Texture definition (`TEXTURE_DEFS`): `tile` (seamless), `cutout` (contains index 0), `wrapX: false` for strips repeated only along v (e.g. `lineEdge`), `shades` (allowed number of shades), `dither`.
- Style: clear, "hand-painted" pixel art of the era with a limited number of shades (usually 4–10 per texture), not photorealism.
- Every texture has a simplified 32×32 variant for the LOD.
- Generating the whole library takes < 1.5 s on a desktop; if more, generate in a Web Worker with a loading screen.

### 9.2 Library (minimum)

| Category | Textures |
|---|---|
| Road | asphalt (3 wear variants), wet asphalt, centre line, edge line, kerb, start/finish line, gravel |
| Verge | grass, dry grass, sand, gravel, dirt |
| Structures | concrete, steel barrier, tyre stacks, ad boards (fictional brands), brick, tunnel wall, roof, building windows (lit night variant) |
| Nature | rock, cliff, water, leaves (cutout), bark |
| Sprites | deciduous trees, conifers, palms, bushes, spectators (several animation frames), flags, flag marshal, rain spray |
| Sky | panoramas: day with clouds, sunset, night with stars, overcast |
| Cars | liveries of the 6 cars (body with stripes, race numbers, fictional logos), glass, lights, tyres, grille, dashboard (2D) |

### 9.3 Car liveries

- Car model UVs map onto one shared 128×128 layout (an exception to 64×64: a layer without 2×2 tiling): u = 0..2 from nose to tail, v = 0..1 right side from the bottom to the middle of the roof, 1..2 left side from the roof down (`RING_V` in `carBuilder.js` gives most texels to the sides and the roof); nose, tail and wing take one solid color from the `PLAIN_UV` area.
- `livery.js` composes a livery from layers: base color, stripes, number, fictional maker and sponsor logos, dirt (in the rain – not done yet).
- The library has 8 livery slots `livery`..`livery7` and scratched ones `liveryScratched`..`liveryScratched7` (contiguous order); the slot is chosen by a texture offset (`VARIANT` flag, `matrix[3]`). Slot = the driver's index in `DRIVERS` (car, color set, number), slot 7 = player, slot 6 = player 2 in split screen; liveries are made at start (`generateLibrary(seed, gridLiveries(car, color))`) and a slot is regenerated live from the menus (`generateLiverySlot`, `renderer.updateTexture`). Livery style, fictional maker badge and sponsor are in `cars.js` (`livery`).
- Every car has 3 color sets to choose from in the showroom.

---

## 10. Model format

```js
export const MODEL_GT_COUPE = {
  name: 'gtCoupe',
  verts: [[x, y, z], ...],          // metres, centre of the rear axle at y = 0
  uvs: [[u, v], ...],               // in texture units (1 = one repeat)
  faces: [
    // [CCW vertices], [uv per vertex], material
    [[0, 1, 2], [0, 1, 2], 'body'],
    [[2, 3, 4, 5], [3, 4, 5, 6], 'glass'],
    [[6, 7, 8], [7, 8, 9], 'lightFront'],
  ],
  smooth: ['body'],                 // Gouraud-shaded materials
  fixedNormal: [0, 1, 0],           // optional: one normal for the whole model (sprites)
  lod: [{ dist: 80, model: 'gtCoupeLod1' }, { dist: 200, model: 'gtCoupeLod2' }],
  collider: { type: 'box', size: [1.85, 1.25, 4.4] },
  damage: { zones: ['front', 'rear', 'left', 'right'] },
};

export const MATERIALS = {
  body: { tex: 'livery', flags: GOURAUD },
  glass: { tex: 'glassDark', flags: 0 },
  lightFront: { tex: 'headlight', flags: NIGHT_EMIT },
};
```

- The loader (no GL) triangulates, subdivides large faces (8.6), computes vertex normals for `smooth` materials (with a crease angle threshold) and face normals for the others, and builds vertex data matching 8.5 (layout: pos 3f, normal 3f, uv 2f, layer u32, flags u32 = 40 B; draw groups by the `DOUBLE`/`DECAL` flags). Texture number i in the registry takes layer `2i` (64×64 ×2×2), its 32×32 LOD variant layer `2i+1`.
- Triangle budgets (mid-90s style): player and rival cars **500–1200**, LOD1 ≤ 400, LOD2 ≤ 120; scenery objects 10–300; sprite = 2 triangles.
- **Visual damage:** zones with displaced vertices (dents) and texture swaps (scratches, broken lights).

### Cars (fictional)

| No. | Working name | Character |
|---|---|---|
| 0 | Vektor GT2 | successor of a wedge coupé, all-rounder |
| 1 | Aurora RS | mid-engine supercar, fastest, demanding |
| 2 | Breeze Turbo | light roadster with a turbo, boost lag |
| 3 | Kestrel ST | 4×4 sports sedan, best in the rain |
| 4 | Halcyon V12 | heavy GT, huge torque, poor agility |
| 5 | Mistral Rally | homologation hatchback, great acceleration, low top speed |

Names, silhouettes and liveries must stay original.

---

## 11. Track format

Each track lives in its own file `src/data/tracks/*.js`:

```js
export const TRACK_HARBOR = {
  id: 'harbor',
  name: 'Harbor Ring',
  type: 'circuit',                  // 'circuit' | 'sprint'
  laps: 3,
  zone: 'coastCity',
  timeOfDay: ['day', 'dusk', 'night'],
  width: 12,
  pieces: [
    // len: m, curve: deg/100 m, grade: %, bank: deg; optional surface, walls, tunnel, bridge, kerbs, startLine, finishLine
    { len: 300, curve: 0, grade: 0, bank: 0, startLine: true },
    { len: 180, curve: 35, grade: 1, bank: 6, kerbs: 'both' },
    { len: 220, curve: -20, grade: -4, bank: -3, walls: 'left' },
    { len: 400, curve: 0, grade: 0, bank: 0, tunnel: true },
  ],
  closeLoop: true,                  // the validator checks that the loop closes
  pitWall: { from: 0, to: 250 },
  scenery: [
    // rules: 'every' | 'range' | 'line' (strip: guardrail, fence, pitwall – also a lateral limit for cars);
    // fields: spacing, from, to, obj | sprite, side, offset (m or [min, max] from the centre line), jitter, size,
    // scale, tex: 'adRandom', light (light pool under a lamp); the zone (data/zones.js) adds its own rules
    { rule: 'every', spacing: 18, sprite: 'palm', side: 'both', offset: [9, 20] },
    { rule: 'range', from: 0, to: 300, obj: 'grandstand', side: 'right', offset: 14 },
    { rule: 'every', spacing: 60, obj: 'adBoard', side: 'left', offset: 8, tex: 'adRandom' },
  ],
  racingLine: 'auto',               // generated; optional manual corrections
  aiHints: [{ pos: 820, brake: 0.7 }],
  tv: { spacing: 170 },             // optional TV camera placement (replays)
};
```

### Rules

- The logic contains no conditions specific to particular tracks.
- Closed circuits must close (position, height, heading) within a CONFIG tolerance; the validator corrects the last piece or reports an error (heading and position errors are spread smoothly over the last piece). Conventions: `curve` > 0 = right turn, `bank` > 0 = right edge lower, heading 0 = the −Z axis. Texture repeat lengths are adjusted so the loop holds a whole number of repeats (no UV jump at the start). Terrain: the strip along the track starts exactly at the edge of the verge (shared vertices), then the background terrain; a tunnel raises a mountain over the track, a bridge lowers a valley with water.
- Sprint (`type: 'sprint'`, `closeLoop: false`): one `startLine` piece and a later `finishLine` piece (the finish at its start); a lead-in before the start (≥ 100 m for the grid), a run-out after the finish (≥ 200 m), cross walls at both ends of the road; after the finish cars slow down and stop (without collisions). Parts of a track never come closer to each other than about 2 terrain strip widths (test).
- TV cameras (replays): the track's `tv` field – `{ spacing, offset, height, points: [{ s, side, offset?, height? }] }`, defaults in `CONFIG.tv`; spots clear of scenery, inside tunnels next to the wall. Championship round weather is in `data/championship.js` (`weather`).
- The racing line is generated automatically (minimum curvature within the track width), with optional manual corrections.
- Road UVs: along the track in metres / texture repeat length, across 0–1 over the carriageway width.

---

## 12. Driving model

Mid-90s arcade-sim: more "physical" than the previous generation, still keyboard-friendly.

- **Engine:** torque curve, turbo with boost lag (car 2), rev limiter.
- **Gearbox:** 5–6 gears, automatic and manual.
- **Drive:** RWD, FWD, AWD with a torque split.
- **Tyres:** a simplified force-vs-slip curve (peak, then fall-off), per wheel; grip depends on the surface, the weather and the load.
- **Weight transfer:** longitudinal and lateral, affecting the wheel loads.
- **Aerodynamics:** drag and downforce (∝ v²).
- **Banking and grade** from the track geometry.
- **Car vs car collisions:** an impulse that accounts for the masses, no interpenetration.
- **Damage:** visual only by default; a "realistic" option in CONFIG would reduce power and grip with heavy damage (not implemented yet).
- **Assists** (options): automatic braking before corners for beginners, traction control.
- Implementation: physics in `CONFIG.vehicle.substeps` steps per loop step; ABS on by default (`CONFIG.vehicle.abs`); arcade handling at the user's request: `CONFIG.vehicle.arcade` (lateral grip rising with speed to about 2.2×, weight transfer computed without that multiplier, quicker turn-in), steering assist `steerAssist`, traction control, stability assist `stability` and a rear brake limit `rearBrakeLimit` on by default; the settings 1/1/1 and 0 restore the plain simulation. Car data, including the expected performance ranges for the tests (`expect`) and the body parameters for `models/carBuilder.js` (`body`), live in `vehicle/cars.js`; the car model origin is the centre of the rear axle on the ground, forward along −Z.

---

## 13. Audio

### 13.1 Samples

- `samplegen.js` generates PCM samples (22 050 Hz, mono, `Float32Array`) procedurally: engine sounds (several loops for rpm and load ranges, a character per car), tyre squeal, impacts, gravel, turbo, gear changes, crowd, rain, drums and instruments for the tracker.
- Samples are converted to `AudioBuffer`s at start (after a user gesture).
- Generation is testable in Node (no AudioContext).

### 13.2 Engine

- Crossfade of 3–4 loops by rpm and load, `playbackRate` from the rpm, smooth changes with `setTargetAtTime`.
- Rivals: simplified sound, volume and pan from their position, Doppler, at most the 3 nearest rivals heard at once.

### 13.3 Tracker music

- Implementation: 22 050 Hz samples generated after start (about 0.4 s of CPU, during the countdown); the `AudioContext` only after the first key/touch; a mixer with an output limiter and a tunnel reverb (`ConvolverNode`, impulse response at the context's sample rate); volumes and levels in `CONFIG.audio`; pause and hidden tabs suspend the context.
- `tracker.js`: a MOD/S3M-style module player – 8 channels, patterns, order list, tempo/speed, effects: arpeggio, portamento, vibrato, volume slide, retrigger, tempo change.
- Scheduling with a lookahead on `audioCtx.currentTime`.
- 4 original songs (menu, 2 race songs, results) in mid-90s rock/techno style as data in `songs.js`: text bars compiled into patterns (64 rows × 8 channels). One token per row: a note (`C4` = MIDI 60, `C#4`, `Bb3`) or drums (`k` kick, `s` snare, `h` hi-hat, `o` open hi-hat, `c` crash), `.` empty, `^` note off, optionally `:volume` (0–64) and `!` + effect + 2 hex digits. Effects: `0xy` arpeggio, `1xx`/`2xx` pitch slide up/down (1/16 semitone per tick), `3xx` portamento to the note, `4xy` vibrato, `Axy` volume slide, `Cxx` volume, `Fxx` speed (< 32) or tempo, `Rxy` retrigger. A row lasts `speed × 2.5 / tempo` s. The `TrackerCore` is pure (tests in Node), the `TrackerPlayer` schedules it on Web Audio 0.25 s ahead. Music: radio during the race, the results song after the finish, the menu song in the menus and on the championship standings.
- Radio during a race: a key changes the song.

### 13.4 Mixer

- Buses: `music`, `sfx`, `engine`, `ambient`, `voice` (start announcements as synthesized signals, no speech).
- Separate volumes, mute, start after a user gesture, `try/catch`.

---

## 14. Controls

Input is mapped to **per-player actions** (players 1 and 2).

| Action | Player 1 keyboard | Player 2 keyboard | Gamepad |
|---|---|---|---|
| `throttle` | ↑ | W | RT |
| `brake` | ↓ | S | LT |
| `steer` | ← → | A D | left stick |
| `handbrake` | Space | left Shift | A |
| `gearUp` / `gearDown` | . / , | E / Q | RB / LB |
| `camera` | C | 1 | Y |
| `lookBack` | V | 2 | R3 |
| `radio` | R | – | Select |
| `pause` | Esc | Esc | Start |

- In one-player mode player 1 also accepts WASD (not with 2 players; the key sets are disjoint, only Esc = pause for both is shared).
- Split screen: player 1 on top, player 2 at the bottom, no cockpit view or mirror (cameras: bumper, chase, far); reduced detail from `CONFIG.split` (field of view, draw distance, objects, chunk LOD); the players' engines and effects panned left/right.
- Replay (after a race: Space on the results screen): Space pause, ←/→ (hold) seek, ↓ slow motion, C camera (TV / chase / helicopter), F followed car, Enter/Esc exit.
- Gamepads are assigned to players in connection order, swappable in the options (PAD 1 PLAYS).
- Menus: arrows/WASD, Enter/Space, Esc/Backspace; gamepad: D-pad or left stick (with repeat), A/Start, B; mouse: hover and click (a click on the left third of a choice row = previous value); touch: tap.
- Analog steering with a dead zone; keyboard steering ramps up.
- Touch: on-screen buttons (steer, throttle, brake, handbrake, camera, pause) shown after the first touch, or tilt steering (DeviceOrientation, option); on the first touch the game tries fullscreen and a landscape orientation lock; in portrait a ROTATE TO LANDSCAPE message.

---

## 15. Performance

Budgets (per viewport):

- **Mid-range desktop:** 60 FPS at 640×480, also in split screen; CPU frame time < 8 ms.
- **Mid-range phone:** 60 FPS at 320×240, at least 30 FPS at 640×480.
- Up to **60 000 triangles** per frame (in total), **≤ 400 draw calls** per viewport.
- No GC pauses during a race.
- `dist/roadline95.html` < 2 MB (textures generated at start, not stored in the file).

Mandatory techniques:

- chunk VBOs built once, instancing, model and texture LODs,
- culling per chunk and object, separate for every viewport,
- sorted draw calls, minimal state changes,
- no `readPixels`, `getError` or synchronous queries in the loop,
- overlay upload without reallocating the texture.

### 15.1 Detail options (as in the games of the era)

Available in the menu (OPTIONS → DETAIL, also from the pause menu) and in CONFIG, saved in localStorage; they apply at once (scenery density – from the next track load; a shorter draw distance pulls the fog in):

- resolution: 320×240 / 640×480,
- textures: on / flat colors,
- perspective correction: off / on,
- draw distance: short / medium / far,
- density of objects and sprites,
- number of rivals shown in full detail (the others in LOD2),
- mirror: on / off.

Report measurements before and after for changes that affect performance.

---

## 16. Testing

### 16.1 Automated tests (`node tools/test.mjs`)

- 3D math: matrices, projection, frustum,
- texture generator: determinism (hash of every texture for a seed), seamlessness (edge comparison), only valid palette indices, number of shades within range,
- colormap: level 31 without fog ≈ original color, level 0 ≈ black, full fog ≈ fog color, no index 0 except for input 0,
- model loader: triangulation, subdivision of large faces, normals, UVs,
- track building: chunk continuity, loop closure, no degenerate triangles, UVs continuous along the track,
- racing line: within the track width with a margin,
- race logic: lap counting, positions, corner cutting (checkpoints), finish,
- championship: points, ties, order,
- physics: top speed per gear, 0–100 km/h within the ranges in `cars.js`, braking distance on dry and wet,
- tracker: correct row timing for tempo and speed, effects,
- determinism of a whole race with a seed (AI positions after 60 s).

### 16.2 Render tests (`tests/render.html`)

- Reference scenes: textured cube (affine and perspective), a piece of track, a Gouraud-shaded car, cutout sprites, sky, fog, night with headlights, cockpit, split screen.
- Reading the index buffer (`readPixels`, `RGBA_INTEGER`, `UNSIGNED_INT`), comparison with `tools/golden/`, tolerance **≤ 1% of pixels**.
- Checks: indices in the palette, no index 0 in the world area, histogram matching the reference.
- `tests/textures.html`: a grid of all textures with names, 3×3 tiling preview to judge seams.

### 16.3 Manual smoke test

1. From the menu to a race without console or GL errors.
2. A full lap: corners, tunnel, bridge, kerbs, going onto the grass.
3. A slide and a catch, the handbrake.
4. Collisions with rivals and walls, visual damage.
5. Start, positions, laps, finish, results.
6. Pause, switching tabs, context loss (F4).
7. Night, rain, fog (from stages 4 and 8).
8. Sound and music, radio (from stage 7).
9. Replay with TV cameras (from stage 8).
10. Split screen with two gamepads (from stage 9).
11. Detail options and their effect on FPS (from stage 10).
12. The build and `dist/` from `file://`.
13. Style check: sharp pixels, affine "swimming" visible only on close large surfaces, no colors outside the palette.

If you cannot run a browser, say so plainly and list the points for the user to verify.

---

## 17. Stages

### Stage 1 – renderer: index buffer, indexed textures, colormap

**Scope:**

- `gfx/gl.js`, `program.js`, `targets.js` (buffer by detail level), context loss handling.
- `palette.js` and `colormap.js` (generation, cache, F5 preview).
- `textures.js`: R8UI 128×128 texture array, name registry.
- Shaders `world.js` (affine UVs, optional perspective, Gouraud, dithered light and fog, colormap, cutout), `present.js`, `wire.js`.
- A few temporary test textures (checker, brick, noise) generated in `texgen/` – the full library comes in stage 2.
- `overlay.js`, `draw2d.js`, `font.js` (8×16), debug overlay.
- `math3d.js`, model loader with face subdivision, tests in Node.
- Scene `?scene=render`: textured objects, a floor of large triangles to judge the affine mapping, a Gouraud test car, cutout sprites, free camera.
- `tests/render.html` with the first goldens.

**Definition of Done:**

- sharp picture in both resolutions, correct 4:3,
- `?rawpal=1` confirms palette indices across the whole world,
- F3 clearly toggles affine/perspective, face subdivision limits the distortion as set in CONFIG,
- Gouraud dithering visible in the buffer's pixel grid, not the screen's,
- the colormap gives correct light and fog transitions (F5),
- context loss works, 60 FPS with 60 000 triangles,
- the Node tests and `tests/render.html` pass.

### Stage 2 – texture generator, test track, sky, fog

**Scope:**

- `texgen/`: periodic noise, operations, quantization to ramps, the full library of section 9.2 (without car liveries), LOD variants.
- `tests/textures.html`.
- `world/track.js`, `terrain.js`, `chunks.js`: track with UVs, kerbs, walls, tunnel, bridge, terrain fitted to the track, polygon subdivision.
- A temporary test track (a loop of about 3 km).
- Sky: a cylindrical panorama with clouds, scrolled by the camera rotation.
- Colormap fog with dithering at the edge of the range.
- A camera driving along the track line.

**Definition of Done:**

- seamless, deterministic textures in the style of the era (judged in `tests/textures.html`),
- the track closes without cracks, continuous UVs (no texture jumps at chunk joins),
- shimmering of distant textures limited by the LODs,
- 60 FPS at 640×480 over a full lap.

### Stage 3 – car, physics, cockpit, cameras

**Scope:**

- `vehicle/`: the driving model of section 12 for the Vektor GT2.
- A textured, Gouraud-shaded car model, LODs, a "blob" shadow.
- `camera/`: cockpit, bumper, chase, far chase.
- `cockpit/`: the dashboard in the overlay (an indexed bitmap generated in code), needle gauges, a digital speedometer, a rear-view mirror.
- `engine/input.js` for player 1.

**Definition of Done:**

- weight transfer and the tyre curve can be felt (understeer when entering too fast, oversteer when lifting off mid-corner),
- the car reacts believably to kerbs, grass and slopes,
- all cameras work without going through the terrain,
- the mirror fits the performance budget,
- the physics tests pass, stages 1–2 without regressions.

### Stage 4 – scenery, sprites, zones, time of day, night

**Scope:**

- Scenery models and sprites: grandstands, buildings, ad boards with fictional ads, tyres, barriers, trees (sprites and simple models), animated spectators, flags.
- `world/scenery.js` with rules from data, instancing.
- `data/zones.js`: harbour city, mountains, desert, forest, a race circuit with a paddock; each with its own set of textures and objects.
- Times of day: day, dusk, night – separate sky palettes and colormaps.
- Night: the headlights of the player and the rivals in the world shader (a light cone in colormap levels, dithered), emissive lights, lit building windows, street lamps.

**Definition of Done:**

- the zones clearly differ, sprites do not shimmer and sort correctly with the geometry (z-buffer + cutout),
- the night is playable and atmospheric, headlights with a dithered edge,
- 60 FPS in the densest zone at 640×480.

### Stage 5 – AI rivals, race logic, collisions, damage

**Scope:**

- `world/racingline.js`: racing line and speed profile generation.
- `ai/opponent.js`: 7 rivals with different cars and "personalities" (aggression, mistakes, consistency), overtaking, defending, collision avoidance, adjustable catch-up (CONFIG, mild by default).
- `game/race.js`: start procedure (lights, false start), checkpoints, laps, live positions, finish, results.
- `game/collision.js`: car vs car, car vs wall, car vs object.
- `vehicle/damage.js`: dents, scratches, broken lights.
- HUD: position, lap, lap times, best time, track map.
- Putting the car back on the track after leaving it.

**Definition of Done:**

- the rivals drive realistically, differ in style, make mistakes,
- overtaking without "ghosts" or interpenetration,
- positions and laps always correct (corner-cutting tests),
- damage visible without breaking the geometry.

### Stage 6 – tracks, cars, championship

**Scope:**

- 5 tracks: 4 circuits (harbour city at night, race circuit, mountain loop, desert highway) and 1 point-to-point sprint (coast); long, with tunnels, bridges and height changes.
- All 6 cars of section 10, with liveries (`texgen/livery.js`) and 3 color sets.
- `game/championship.js` and `data/championship.js`: a season on all tracks, points, standings, a car unlocked by winning.
- Time trial with the ghost of the best run.

**Definition of Done:**

- every track has its own character and is fun to drive,
- every car clearly handles differently,
- the championship works from start to end, correct standings,
- the ghost replays the best run faithfully.

### Stage 7 – sound: samples, engine, tracker music

**Scope:**

- `audio/samplegen.js`: all samples of section 13.1.
- `audio/engine-sound.js`: loop crossfade, a character per car, turbo, limiter, rivals with Doppler.
- `audio/tracker.js` and `songs.js`: the player and 4 original songs.
- Effects: tyres (asphalt/gravel/grass), collisions, kerbs, crowd, start signals, rain, tunnel (reverb with a `ConvolverNode` and a procedural impulse response).
- Radio, mixer, volume options.

**Definition of Done:**

- the engine sounds like an engine, smooth, no clicks on gear changes,
- the songs sound like tracker music of the era, with a clear melody,
- the tunnel audibly changes the acoustics,
- the tracker and sample generator tests pass.

### Stage 8 – TV replays, weather

**Scope:**

- `game/replay.js`: recording the whole race (states of all cars with delta compression), playback with pause, seeking, slow motion.
- TV cameras: trackside camera points from the track data, automatic switching, zoom, a helicopter camera, a "REPLAY" banner.
- `game/weather.js`: rain (drops in the overlay, darker palette and colormap, wet asphalt with another texture, dithered spray sprites from the wheels, wipers in the cockpit, less grip), fog (shorter range, denser colormap).

**Definition of Done:**

- the replay of the whole race is faithful and smooth,
- the TV cameras give a broadcast feel and do not go through objects,
- rain clearly changes the look and the handling.

### Stage 9 – split screen for 2 players

**Scope:**

- A horizontal split (top/bottom) with two viewports in one index buffer, separate cameras, HUD and overlays per player.
- Input per player (shared keyboard or 2 gamepads).
- Separate culling per viewport, automatic detail reduction (draw distance, sprite density) as set in CONFIG.
- A 2-player race with AI rivals (0–6), results for both players.
- Sound: the engines of both players, panned by viewport.

**Definition of Done:**

- 60 FPS in split screen at 640×480 on a desktop,
- independent controls for both players, no key conflicts,
- pause stops both players, correct results.

### Stage 10 – menus, showroom, detail options, records, mobile

**Scope:**

- Intro: an animated title screen rendered by the game engine (a camera flying over a track), a logo with color cycling.
- Mid-90s style menus: textured background, buttons with shadows, interface sounds, keyboard, gamepad, mouse and touch support.
- Showroom: a 3D car turning on a lit podium, a spec card (power, mass, 0–100, top speed, drive), color choice.
- Options: the details of section 15.1, sound, controls, units, assists, difficulty.
- Lap and track records, championship results in localStorage.
- Mobile: touch controls, landscape orientation, fullscreen.
- Optimisation according to section 15 and code cleanup, a CHANGELOG with known bugs.

**Definition of Done:**

- the whole menu works on keyboard, gamepad, mouse and touch,
- detail options apply immediately and really affect the FPS,
- records survive a reload,
- the budgets of section 15 are met on a desktop and a phone,
- the list of known problems is honest.

---

## 18. Workflow

### 18.1 Before a change

1. Read this file and `CHANGELOG.md`.
2. Read the modules involved and their dependencies.
3. Run `node tools/test.mjs` to know the starting state.
4. When an ambiguity changes the result, ask one concrete question; decide small matters yourself and describe them in the report.

### 18.2 During

- Small steps, tests after every larger step.
- Do not refactor code outside the scope; describe problems in the report.
- A change of a data format (vertices, models, textures, tracks, songs) requires updating this file and the validators.
- Check every new shader or pass with `?rawpal=1`, `?wire=1` and in both resolutions.
- Check new textures in `tests/textures.html`.

### 18.3 After

1. Logic tests green; render tests green or a note that the user needs to run them.
2. `node tools/build.mjs` without errors.
3. The smoke test of section 16.3, or a note that it was not done.
4. An entry in `CHANGELOG.md`.
5. Update section 4 if a stage is finished.
6. The report (section 19).

### 18.4 Review (on the "Kontrola" command)

Without changing the code, review the project and list:

- regressions of features from finished stages,
- allocations in the render and update loops,
- violations of the era's look (section 8.1): filtering, mipmaps, semi-transparency, colors outside the palette, effects outside the specification,
- textures with seams, too many shades or out of style,
- GL resources that cannot be rebuilt after a context loss,
- excessive draw calls, state changes, synchronous GL calls,
- non-determinism (texture generator, AI, replays),
- violations of the rules in section 3 and the conventions in section 7,
- differences between the code and this file.

---

## 19. Report format (in Polish)

```
## Podsumowanie
One or two sentences: what was done.

## Zmiany
- file: what and why

## Testy
- automated: result
- render: result (updated goldens and why, if any)
- manual: what was checked, what the user needs to verify

## Wydajność
- FPS / frame time / triangles / draw calls before and after (if relevant), at 320×240 and 640×480

## Decyzje projektowe
- decision: rationale

## Znane ograniczenia i ryzyka
- what does not work perfectly, what was not done, possible regressions

## Propozycje na kolejny krok
- at most 3 points
```

---

## 20. CHANGELOG.md

```
## [Stage N] YYYY-MM-DD – short title
### Added / Changed / Fixed / Known issues
```

Newest entries on top.

---

## 21. Known pitfalls

- **Blurry picture** – no `NEAREST`, or CSS scaling with smoothing; use `image-rendering: pixelated` and a present pass at the target size.
- **Window-dependent dithering** – the Bayer threshold computed in the screen framebuffer instead of the index buffer.
- **Black picture with R8UI** – use `usampler2D`/`usampler2DArray`, `texelFetch`, a `uint` output, `clearBufferuiv` instead of `clear`.
- **Affine UVs "explode" near the camera** – triangles crossing the near plane; subdivide the geometry and choose a suitable near plane.
- **Texture seams** – non-periodic noise or rounding of coordinates when tiling; wrap in the shader with a bit mask.
- **Road texture jumps between chunks** – UVs computed from the chunk start instead of the track start; on long tracks subtract a multiple of the repeat length to keep float precision.
- **Shimmering distant textures** – missing LOD variants; do not fix it with filtering.
- **Colormap with "holes"** – the nearest-color search may return index 0; exclude it.
- **Slow start** – texture generator and colormaps on the main thread; move them to a Worker and show a loading screen.
- **Sprites "cut" by geometry** – billboards placed at the terrain height and tilted; allow only rotation around the Y axis.
- **Z-fighting decals** (lines, kerbs, light pools) – the `DECAL` flag with `polygonOffset`.
- **Non-deterministic replays** – physics depending on the frame time or `Math.random`; only a fixed timestep and a seedable RNG.
- **Key conflicts in split screen** – keyboard hardware limits (ghosting); default mapping with keys far apart.
- **Audio clicks** – sudden `gain` and `playbackRate` changes; always use `setTargetAtTime` or ramps.
- **Context loss on mobile** – resources rebuildable from CPU data.
- **`getError` in the loop** – a GPU sync; debug only.
- **The build breaks shaders** – special characters in template strings; test `dist/` from `file://`.

---

## 22. Glossary

| Term | Meaning |
|---|---|
| SVGA | 640×480 mode in 256 colors, a mid-90s standard |
| Index buffer | an R8UI texture where every pixel is a palette color number |
| Indexed texture | a texture storing palette indices instead of colors |
| Colormap | table: (color index, light level, fog level) → resulting index |
| Affine mapping | UVs interpolated linearly in screen space, without perspective correction |
| Gouraud | brightness interpolated between the vertices of a triangle |
| Cutout | binary transparency through index 0 |
| Billboard / sprite | a flat textured rectangle turned towards the camera |
| LOD | a simplified model or texture for large distances |
| Chunk | a piece of the world with its own VBO, the culling unit |
| Racing line | the optimal path for the AI with a speed profile |
| Catch-up | adjusting the AI pace relative to the player |
| Tracker | a music player using patterns and samples (MOD/S3M style) |
| TV camera | a fixed trackside camera used in replays |
| Split screen | two views for two players on one screen |

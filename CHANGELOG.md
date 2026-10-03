# CHANGELOG – ROADLINE '95

## [Repository] 2026-10-03 – public release

### Added
- English `README.md` with screenshots (`docs/screenshots/`), `LICENSE` (GNU AGPL v3.0), `.gitignore`.
- GitHub Pages site: a 1995-style landing page (`site/index.html`) and the game as `play.html`, built and deployed by `.github/workflows/pages.yml` after the logic tests.
- `?info=0` URL parameter: debug hooks on, debug overlay hidden at start (used for the screenshots).

### Changed
- `CLAUDE.md` and `CHANGELOG.md` translated into English (the repository is English); reports to the user stay in Polish.

## [Stage 10] 2026-10-02 – menus, showroom, detail options, records, mobile

### Added
- Intro (`state/title.js`): a camera flyover of a track at dusk, rendered by the game engine, with the ROADLINE '95 logo in color cycling.
- Mid-90s style menus (`state/ui.js`, `state/menu.js`, `state/app.js`):
  - a textured, scrolling background, bevelled panels and buttons with shadows;
  - main menu: single race, championship, time trial, 2 players, showroom, options, records;
  - race setup: track, car, time of day, weather, laps, rivals;
  - a keys page;
  - keyboard (with auto-repeat), gamepad, mouse and touch support (`MenuInput`, `Pointer`).
- Showroom (`state/showroom.js`):
  - the car turns on a podium under studio spotlights;
  - spec card (power, mass, 0–100 km/h or 0–60 mph and top speed measured with the physics model – `vehicle/stats.js`, drive, gears, description);
  - 3 color sets, livery refreshed live (`generateLiverySlot`, `renderer.updateTexture`);
  - locked cars are marked.
- Pause menu: continue, restart, options, quit to menu.
- Options (`state/options.js`):
  - detail: resolution 640×480/320×240, textures/flat colors, perspective correction, draw distance (with fog), scenery density, number of cars in full detail, mirror;
  - sound: music, effects, engines, mute;
  - controls: automatic/manual gearbox, pad swap, touch: buttons/tilt;
  - game: difficulty, km/h or mph units (also the speedometer dial), assists;
  - changes apply at once, also during a race (a resolution change re-lays out the HUD and the viewports), and are saved.
- Records (`game/records.js`, `storage.js`):
  - best lap and best race/run per track (with car and player), a NEW LAP / TRACK RECORD message;
  - championship history (seasons, titles, best position);
  - saved in localStorage with validation (damaged data is dropped).
- Mobile (`state/touch.js`): on-screen buttons or tilt steering, fullscreen and landscape lock on the first touch, a message in portrait, a viewport meta without zoom.
- Tests (84): save (round trip, validation, broken JSON), records, options (defaults, applying, restoring), menu navigation (skipping disabled rows, choices, mouse), showroom figures agreeing with `cars.js`, livery refresh, scenery density, touch controls.

### Changed
- The game starts at the title screen. Race parameters in the URL (`?track=`, `?mode=` etc.) start a race directly (debugging, tests). `?detail`, `?persp`, `?notex` override the options.
- Esc in a race opens the pause menu (instead of toggling a pause).
- After a race Enter returns to the menu; in a time trial it starts a new run with the ghost; after the championship it returns to the menu.
- Renderer: `resize`, draw distance caps from the options, single texture update.
- HUD: the speed readout moves above the touch pedals when they are shown.

### Removed
- The pause banner in the HUD (replaced by the pause menu).

### Known issues
- Not tested on a real phone or gamepad. The phone budgets (60 FPS at 320×240) are unverified. Touch controls and menus were checked with pointer events in Chrome.
- Tilt: the direction depends on `screen.orientation.angle` and may need flipping on some devices. iOS asks for permission (on the first touch when tilt is enabled).
- Scenery density applies from the next track load, not in the current race.
- Menus and pages allocate small objects every frame (outside races).
- Ghost recordings are not saved (only the times).
- On the records page at 320×240 the columns are cut off.
- Occasional 17–21 ms frames (about 0.1–0.2%) on an Intel UHD 630.
- No dirt on the liveries in the rain (section 9.3).
- No cockpit view or mirror in split screen.

## [Stage 9] 2026-10-02 – split screen for 2 players

### Added
- A race for 2 players (`?players=2`, `?car2=`, `?color2=`):
  - two horizontal viewports in one index buffer (player 1 on top);
  - separate cameras, culling, HUD with a map and rain in each player's overlay;
  - a divider line.
- `RaceSim`: a second player (`spec2`) with its own controls (`step(dt, first, rest, first2, rest2)`). Both start at the back of the grid. Catch-up uses the leading player. At most 6 rivals (livery slot 6 goes to player 2, number 9).
- `Race`: the race ends when both players are in (or `finishWait` after the last one). The results show both (PLAYER 1 / PLAYER 2).
- Automatic detail reduction (`CONFIG.split`): 44° field of view, 360 m draw distance, objects and sprites up to 170 m, earlier far track LOD (`env.lodScale`).
- Sound: both players' engines and effects panned left/right, ambience once.
- Pause (Esc) stops both players. The players' keys are disjoint (only Esc is shared).
- Tests (78): two players in the simulation (independent controls, liveries, rival limit), race end with 2 players, disjoint keys, no cockpit in split screen. Render golden `split_grid`.

### Changed
- The race scene is built from player "seats". `main.js` draws a list of views (`scene.views`) when the scene provides one.
- `CarCameras.allowInside` (skips the cockpit).
- The race-end check in `Race` no longer allocates (`find`/`every` every step before).

### Known issues
- No cockpit view or mirror in split screen.
- Championship and time trial are single-player only.
- Gamepads are assigned by index (pad 0 = player 1, pad 1 = player 2); swapping came in stage 10.

## [Stage 8] 2026-10-02 – TV replays, weather

### Added
- Replays (`game/replay.js`):
  - the state of every car recorded every step: position, heading, body roll, rpm, throttle, speed, "ghost";
  - integers with 16-bit deltas, a keyframe every second or on a jump;
  - damage history;
  - decoding of any frame, also fractional (interpolation);
  - about 26 B per car per step.
- Playback (`state/replay.js`):
  - Space on the results screen after a race;
  - pause, rewind and fast forward, slow motion, camera and followed car choice;
  - REPLAY banner and timer;
  - dents reproduced faithfully;
  - sound: the cars' engines with pitch following the playback speed, silence while paused.
- TV cameras (`camera/tv.js`):
  - trackside points from the track data (`tv`, by default every 170 m alternating sides), off the road, clear of scenery, inside tunnels next to the wall;
  - the director cuts to the camera the car approaches, checking that the terrain does not hide it;
  - zoom keeping the car's size in the frame;
  - a helicopter shot circling above the car every 16 s.
- Weather (`game/weather.js`, `CONFIG.weather`):
  - **rain:** a darker, gray colormap and shorter fog, an overcast sky, wet asphalt (`asphaltWet`), less grip for every car (slower AI targets), rain streaks in the overlay (checkerboard, no semi-transparency), drops on the windscreen and wipers in the cockpit, dithered spray sprites from the wheels, rain sound, no rain inside tunnels;
  - **fog:** 12–130 m range, gray colormap.
  - `?weather=` parameter; championship: rain at the harbour, fog in the mountains.
- Dynamic sprite batches (`SpriteBatch` with `refresh`).
- Tests (75): replay (decoding accuracy, keyframe on a jump, damage, interpolation), TV cameras on every track (off the road, clear of objects, above ground, the car visible in over 90% of the shots), weather (conditions, grip, AI), rain overlay and wipers. New render goldens: `rain_chase`, `fog_mountains`.

### Changed
- Night headlights are chosen from the car pose (works in the replay too).
- Race cameras set `fovY` (the replay changes it for the zoom).

### Known issues
- The replay is available after a finished race; not in a time trial on a circuit (it never ends).
- The replay does not show the race HUD (positions, times), only the REPLAY banner and the time.
- The TV camera line of sight checks only the terrain, not buildings. The cameras stand clear of objects, but a building between camera and car can briefly block the shot.
- No dirt on the liveries in the rain (section 9.3).

## [Stage 7] 2026-10-02 – sound: samples, engine, tracker music

### Added
- `audio/samplegen.js`: procedural 22 050 Hz samples:
  - engine loops for every car: 3 rpm ranges × on throttle and overrun; exhaust pulses by the number of cylinders, resonances and roughness from `cars.js` (`sound`); seamless loops;
  - tyre squeal, gravel, grass, kerbs, wall scrape, impacts (soft and metallic), turbo whistle and blow-off, gear change, crowd, rain, wind;
  - start signals (synthesized, no speech);
  - drums and 7 tracker instruments (bass, lead, pad, organ, distorted guitar, Karplus-Strong string, stab);
  - the tunnel impulse response.
- `audio/mixer.js`:
  - the `AudioContext` after the first key/touch;
  - music/sfx/engine/ambient/voice buses, an output limiter, the tunnel reverb;
  - loops with smooth changes (`setTargetAtTime`), one-shot sounds;
  - everything in `try/catch`.
- `audio/engine-sound.js`:
  - crossfade of 6 loops by rpm and load, `playbackRate` from the rpm, stutter on the rev limiter;
  - turbo (whistle and blow-off), a gear change click;
  - the 3 nearest rivals with distance volume, pan and Doppler.
- `audio/sfx.js`: tyres by slip and surface, kerbs, gravel and grass, impacts and scraping, wind, crowd near grandstands, start light signals, tunnel reverb, a rain hook for stage 8 (`setRain`).
- `audio/tracker.js` + `audio/songs.js`: the module player (8 channels, patterns, order list, tempo/speed, arpeggio, portamento, vibrato, volume slide, retrigger, tempo change) and 4 original songs:
  - REDLINE ROCK – rock in A minor, 140 BPM;
  - NIGHT CIRCUIT – techno in D minor, 135 BPM;
  - PADDOCK – menu;
  - PODIUM – results.
- `state/raceAudio.js`: race sound. Radio with the R key (pad: Select) with the song name in the HUD. Results music after the finish, the menu song on the championship standings. Pause (Esc) and hidden tabs suspend the sound. `?mute=1` parameter.
- Tests (71): sample generator (determinism, range, tuning, seamless loops, every car's engine), tracker (row timing, speed/tempo, every effect, order loop), songs, crossfade and Doppler, tyre squeal.

### Changed
- `CONFIG.audio`: bus volumes, reverb, engine, rival and effect levels.
- RaceSim remembers the strongest impact of a step (`lastImpact`) for the sound.

### Known issues
- The sounds were judged only by measurements (levels, no NaN or clipping, no jumps at loop points); they need to be listened to.
- Rivals have no tyre squeal or impact sounds (only the engine).
- Every music note creates a new `AudioBufferSourceNode` (that is how Web Audio works); small allocations outside the physics loop.

## [Stage 6] 2026-10-02 – tracks, cars, championship

### Added
- Five tracks (`data/tracks/`):
  - Harbour Lights – harbour city at night, about 3.9 km;
  - Greywater Raceway – race circuit with a pit lane, about 4.6 km;
  - Highcrest Loop – mountain loop with switchbacks, about 4.2 km, 60 m of climb;
  - Mirage Highway – desert highway, about 5.8 km;
  - Cliffside Run – coastal sprint, 4.3 km from start to finish.
  Every track has tunnels and/or bridges and height changes. New `coast` zone.
- Sprint (point-to-point) tracks: a `finishLine` piece and a `SEG.FINISH` flag with a finish line. The race logic counts one run from start to finish with checkpoints. The HUD shows the distance to the finish. Walls at both ends of the road. After the finish cars slow down and stop without collisions.
- Six fictional cars (`vehicle/cars.js`), each with its own body, engine, gearbox, drive (RWD/AWD), turbo with boost lag, tyres (wet grip), brakes and steering.
- 128×128 liveries (`texgen/livery.js`): 5 styles, a race number in a roundel on the doors, a fictional maker badge and sponsor, 3 color sets per car, scratched versions for damage. `?color=` parameter.
- Rivals drive different cars (`car` field in `DRIVERS`). The racing line speed profile is computed for each car (tyre grip, top speed).
- Championship:
  - logic in `game/championship.js`: points 10-8-6-5-4-3-2-1, ties broken by the number of wins, then of further places, then by the latest round;
  - the season in `data/championship.js`: 5 rounds;
  - standings after every round;
  - winning the championship unlocks the Aurora RS, saved by `storage.js` (localStorage, safe without access).
- Time trial (`?mode=time`): no rivals, unlimited laps (one run on the sprint). The ghost of the best lap (`game/ghost.js`) records the pose every step and replays it exactly; it is drawn as a checkerboard (`SCREEN_DOOR` flag, no semi-transparency).
- Game session (`state/session.js`): `race`, `champ` and `time` modes (`?mode=`), Enter to continue, scene changes that release the GL resources (`renderer.clearMeshes`), a colormap and sky per track.
- Track chunk LOD: far chunks have every other sample row, chunk borders without cracks (`CONFIG.track.chunkLodDist`). Scenery draw distance: `CONFIG.render.detailFar`.
- Tests (65): performance of every car, car differences (turbo, wet surface), triangle budgets of every car, liveries, every track (closure, length, no parts too close), sprint (racing line, logic, simulation stopping before the end of the road), championship, save, ghost, far chunk LOD. New render goldens: `grid_harbour_night`, `grid_coast_sprint`.

### Changed
- The stage 2 test track is now `?track=5`; the tests use it directly.
- The `paint1..7` / `paintScratched*` textures were replaced by livery slots; `paint` stays only for the render scene's test car.
- The AI keeps a full lane away from a car alongside; when squeezed against the edge the car behind yields (before, two cars side by side could "stick" and lose speed).
- The mirror draws only near chunks and barriers, no far terrain.
- Render goldens updated (new car liveries, LOD differences below 0.25%).

### Fixed
- A car reset after getting stuck could stay a collision-free "ghost" forever (the counter went below zero and a negative value is truthy).
- Racing line curvature at the ends of an open track (atan2(-0, -0) = π gave a speed of 3 m/s).
- Scenery placed beyond the ends of an open track (an exception while building).

### Known issues
- No menus yet (stage 10): mode, track, car and color are chosen with URL parameters.
- Car balance was checked only with AI simulations. On the desert the fast cars (Aurora, Halcyon) have a big advantage, the Mistral is the slowest.
- With similar pace the rivals still often drive in a queue behind a slower car.
- The ghost record lives only in the current session (records came in stage 10).
- Occasional 17–21 ms frames (about 0.1%) on an Intel UHD 630 at 640×480.

## [Stage 5] 2026-10-01 – AI rivals, race logic, collisions, visual damage

### Added
- Racing line (`world/racingline.js`): minimum curvature by fourth-difference relaxation (coarse grid, then full) within the carriageway with a margin – wide entry, apex, wide exit; a speed profile from the grip (with the arcade multiplier), a backward braking pass and a forward acceleration pass, `aiHints` from the track data.
- Rivals (`ai/opponent.js`): 7 fictional drivers with different skill, aggression, number of mistakes and consistency; the same physics as the player; lateral spacing, following with a time gap and emergency braking, overtaking committed to the chosen side, defending, mistakes (late braking, running wide), a mild catch-up (`CONFIG.ai.catchup`).
- Race logic (`game/race.js`): start lights, false start (+5 s), checkpoints about every 100 m (cutting and reversing give neither a lap nor a position), laps, times, live positions, finish, classification.
- DOM-free race simulation (`game/raceSim.js`): grid, physics steps, car vs object and car vs car collisions (`collideCars`: separation by mass, impulse, friction, spin), damage, automatic reset of stuck cars (a brief collision-free "ghost"), slipstream (less drag behind another car), the player's autopilot after the finish.
- Visual damage (`vehicle/damage.js`): four zones, dents (up to 14 cm, inward only), scratched paint, broken headlights and tail lights; LOD0/LOD1 copies per car (`state/raceCar.js`).
- Race HUD (`cockpit/raceHud.js`): position, lap, lap time, last and best, track map with the cars, start lights, messages, results; pause (Esc, also on tab switch).
- Car colors: paint variants `paint`..`paint7` and scratched versions; broken light textures.
- URL parameters `?ai=` (default 7) and `?laps=`.
- Tests (54): racing line, race logic (laps, cutting, reversing, false start, finish), determinism of a whole race with a seed (60 s), overtaking without interpenetration and AI mistakes (reversed grid: the slowest driver from pole drops at least to 4th), car vs car collisions, damage; new render golden `race_grid`.

### Changed
- The default scene is the race (`state/race.js`); `state/driveTest.js` was replaced by `createDriveScene` (a race without rivals).
- Car LOD switching: 25 / 70 m; mirror up to 50 m.
- Ranking sorted in place (no allocation per step).

### Fixed
- Every car was drawn in LOD2 (the LOD choice got the camera object instead of its position).
- Rivals reversed during the countdown (holding the brake at a standstill engaged reverse) – they now hold the handbrake at the start.

### Known issues
- All rivals drive the same model (Vektor GT2) – other cars in stage 6.
- On the test track overtaking is moderate; with similar pace drivers often queue.
- In the densest zone (city at night, cockpit with mirror) the peak is about 60.6k triangles (1% over budget).
- Damage is visual only (the "realistic" option of section 12 is not done).

## [Stage 4] 2026-10-01 – scenery, sprites, zones, time of day, night

### Added
- Sprite shader (`gfx/shaders/sprite.js`): instanced cylindrical billboards (rotation around Y only), frame animation (spectators), lit like the world, the same fragment shader (colormap, dithering, cutout); sprite batches per chunk with culling.
- Scenery models (`models/scenery.js`): grandstand, three buildings (windows lit at night), ad board (4 fictional ads through a per-instance texture offset), tyre stack, street lamp, deciduous and conifer 3D trees, boulder, pit garages.
- Placement from rules (`world/scenery.js`): `every`, `range`, `line` (barrier, fence, pit wall), spectators on the grandstands, light pools of the lamps on the road at night; tunnels, bridges, tunnel approaches, steep terrain and other parts of the road are skipped; deterministic result.
- Zones (`data/zones.js`): race circuit, harbour city, mountains, desert, forest – their own terrain textures and object sets; `?zone=` parameter.
- Times of day (`CONFIG.times`): day, dusk, night – separate sky, sun, fog and colormap; `?time=` parameter.
- Night: the car's headlights as per-vertex light cones (with a dithered edge), glowing car lights, windows and lamps (`NIGHT_EMIT`, `NIGHT_ALT`), light pools (`NIGHT_ONLY`).
- Test track: grandstands, garages, pit wall, lamps on the start straight, tyre stacks in the corners, marshals, flags.
- Collisions of the car with static map elements (at the user's request during the stage, ahead of stage 5): barriers, fences and the wall as lateral limits; objects and tree trunks as rectangles in a spatial grid (`game/collision.js`), the car as three circles; push-out, bounce, friction, spin.
- Scenery rule validation in the track validator; tests: transparent textures only with `CUTOUT`, placement in every zone, collisions with a barrier and a tyre stack; 24 render goldens (night, headlights in a tunnel, dusk, every zone).

### Changed
- Track chunks are 75 m (finer culling, fewer triangles in view).
- The mirror draws no scenery objects or sprites, 60 m range.
- Scenery objects are subdivided into triangles up to 12 m (`CONFIG.tess.sceneryMaxEdge`).
- `tests/render.html`: index 0 shown in pink; goldens fetched at start with retries (single fetches sometimes failed in headless Chrome).

### Fixed
- Index 0 (holes) in the world: the instance texture offset applied to every ad board material (concrete got a texture with transparency) – now only materials with the `VARIANT` flag; the lamp posts had a texture with transparency without `CUTOUT`.
- Hitting the wall before a tunnel or the barrier before a bridge launched the car into the air (user report). Causes and fixes:
  - a wheel beyond a limit (wall, tunnel side, bridge barrier) got the terrain height behind it (wall top, valley floor) – the height under the wheels now comes from the edge of the drivable band (`GroundProbe.heightAt(..., solid)`); scenery and cameras still see the real terrain;
  - where the road narrows (barrier end → tunnel/bridge wall) the limit pushed the car sideways by several metres in one step – tunnel portals, bridge abutments and wall starts now have cross colliders (`narrowingWalls`);
  - the car could climb steep embankments next to the track – terrain rising more than 0.5 m above the road edge acts as a wall (`CONFIG.track.climbLimit`);
  - the vertical speed from the ground is limited by the slope (`CONFIG.vehicle.maxGroundSlope`) and to 1.5 m/s upwards (`maxClimbSpeed`).
  - New test: impacts at different angles at every portal, abutment and wall start – the car never leaves the ground by more than 0.3 m.

### Known issues
- Car vs car collisions and damage come in stage 5; impacts have no sound yet.
- Sprites without collisions: bushes, flags, marshals, spectators (on purpose).
- Flags do not wave (static sprite); lamps light nothing beyond the pool on the road.
- The lamp light pool is clipped to the carriageway and verge width.

## [Stage 3] 2026-10-01 – car, physics, cockpit, cameras

### Added
- Driving model (`vehicle/physics.js`, `tyres.js`, `drivetrain.js`): a planar body with yaw, four tyres with a lateral force curve (peak and fall-off), load sensitivity and a friction circle, longitudinal and lateral weight transfer, aerodynamic drag and downforce, grade and banking from the ground normal, a simple lift-off over crests, surfaces (asphalt, kerb, grass, gravel, dirt), wet surface, ABS, traction control, handbrake.
- Drivetrain: torque curve, rev limiter, turbo with boost lag (for car 2), automatic and manual gearbox, reverse (automatically after holding the brake), clutch slip when pulling away.
- Vektor GT2 (`vehicle/cars.js`): 0–100 km/h about 4.9 s, top speed about 259 km/h, braking from 100 km/h 36 m (wet 49 m).
- Track ground queries (`world/ground.js`): distance and lateral offset, height, normal, surface, limits (walls, tunnel, bridge barriers, end of the terrain strip).
- Procedural car model with three LODs (778/346/116 triangles), lights, grille, spoiler and a dithered shadow (`models/carBuilder.js`); a visual pose with body roll and pitch (`vehicle/pose.js`).
- Cameras: cockpit, bumper, chase, far; looking back; cameras kept above the terrain, under the ceiling and between the walls of tunnels (`camera/carCams.js`).
- Cockpit (`cockpit/`): a textured dashboard in the overlay, tachometer and speedometer with needles, digital speed, gear, shift light, a steering wheel turned with the wheels, pillars and a rear-view mirror rendered in its own viewport (mirrored, shorter range). HUD for the outside cameras.
- Player 1 input (`engine/input.js`): the section 14 mapping, WASD in one-player mode, gamepad (stick with a dead zone, triggers, buttons).
- Braking assist before corners (`vehicle/assists.js`, `CONFIG.vehicle.autoBrake`, off by default).
- Renderer: `beginFrame()`, drawing into a mirrored viewport, skipping items with `visible: false`.
- Tests: 39 logic tests (physics: 0–100, top speed and top speed per gear, braking distance dry/wet, understeer, lift-off oversteer, grass and slopes, determinism; a lap by a test driver; cameras in a tunnel; assist), 16 render goldens (new: car from outside, cockpit with mirror).

### Changed
- The default scene is driving; the stage 2 track preview is available with `?scene=track`.
- Free camera in the driving scene: F7 (only with `?debug=1`).

### Fixed (after the report: the car "slides like an ice cube", does not turn, the cockpit camera does not roll with the car)
- Full keyboard lock put the wheels far past the tyre grip peak (front slip 0.27 rad with the peak at 0.11), so the car went straight and then spun. A steering assist was added (`CONFIG.vehicle.steerAssist`): the wheel angle in the turning direction is limited so the front slip does not exceed the peak of the curve; countersteering is still possible.
- Full throttle in a corner caused a spin (power oversteer). The friction circle was replaced by an ellipse (`CONFIG.vehicle.frictionEllipse`), traction control is on by default and also reacts to the lateral slip of the driven axle.
- GT2 tyre grip raised from 1.08 to 1.2 (0–100 km/h 4.5 s, braking 35 m).
- After leaving the road the car could drive onto the steep end of the terrain strip (normal about 45°). The off-road limit now ends before that drop.
- The cockpit and bumper cameras roll with the body (rotation around the view axis in `mat4View`), the mirror too.
- New tests: keyboard steering at 100 km/h without a spin, cockpit camera roll on sloped ground, roll in the view matrix.

### Changed (after the report: the car turns too weakly at higher speeds, it should be more arcade)
- Arcade layer `CONFIG.vehicle.arcade`: lateral grip 1.25× at low speed, rising to 2.2× from 12 to 50 m/s; lateral weight transfer and body roll computed from the acceleration divided by that multiplier (inner wheels do not lose load), yaw inertia × 0.7.
- Cornering at full keyboard lock: 1.33 g at 60 km/h, 1.67 g at 100 km/h, 2.18 g at 150 km/h, 2.36 g at 200 km/h (before about 1.05 g at any speed). Acceleration and braking unchanged.
- New test: at least 1.8 g at 150 km/h without a spin.

### Fixed (after the report: braking makes the car lose grip and spin)
- Under braking the rear lost over 40% of its load yet still braked up to the ABS limit; automatic downshifts added engine braking on the rear. Now: rear brakes up to 60% of the rear grip (`CONFIG.vehicle.rearBrakeLimit`), no engine braking while the brake is pressed and a per-wheel engine braking limit, front–rear weight transfer × 0.6 (`arcade.pitchTransfer`).
- Stability assist (`CONFIG.vehicle.stability`): above 0.1 rad of sideslip a yaw torque steers the nose back towards the direction of travel.
- Braking in a corner at 150 km/h: sideslip at most 0.05 rad (a spin before); braking from 200 km/h with a short steering flick: 0.14 rad (a spin before). Braking distance from 100 km/h: 38 m dry, 53 m wet.
- Lift-off oversteer remains but is milder (the rear steps out, the car tightens its line, no spin). New test for braking without a spin.

### Known issues
- Collisions with walls, the tunnel and barriers are limits that push the car back for now; a full collision response comes in stage 5.
- The wheels do not spin or steer visually (they are part of the body).
- The camera does not roll with the car (no rotation around the view axis) – fixed later in this stage.
- In the cockpit, looking back hides the dashboard; the view does not show the car's interior.
- The car paint is a temporary `paint` texture (liveries in stage 6).

## [Stage 2] 2026-10-01 – texture generator, test track, sky, fog

### Added
- Periodic noise: value noise (also anisotropic), Perlin, fBm, Voronoi (`texgen/noise.js`); rectangles and 5×7 text in textures (`texgen/ops.js`).
- The full texture library of section 9.2 without car liveries: 49 textures of 64×64 with a 32×32 LOD variant, fictional ads (VOLTRAX, ZEPTA OIL, GLIMMO, RAXTON).
- 512×128 sky panoramas (day, dusk, night, overcast) and a sky pass in the renderer (`texgen/sky.js`, `gfx/shaders/sky.js`).
- `tests/textures.html`: every texture, LOD variants, 3×3 tiling, sky panoramas.
- Track building from pieces (`world/track.js`): validator, integration with smoothed transitions, loop closure by correcting the last piece, banked frames.
- Terrain (`world/terrain.js`): a strip along the track with a shared edge, ditches, hills, a mountain over the tunnel, a valley with a river under the bridge, background terrain with distant hills.
- Chunks every 150 m (`world/chunks.js`, `world/meshbuild.js`): carriageway, kerbs and edges, centre line and start line (decals), walls, a tunnel with portals, a bridge with barriers and pillars.
- A test track of about 2.85 km (`data/tracks/testLoop.js`) with a tunnel, a bridge, a chicane and height changes.
- A camera driving along the track (`camera/trackFollow.js`); the free camera moved to `camera/free.js` (C key).
- Tests: 27 logic tests (loop closure, no cracks between chunks, UV continuity, no degenerate triangles, …), 14 render goldens (7 of them for the track and the sky).

### Changed
- The texture LOD is chosen from UV derivatives instead of the distance (`CONFIG.tex.lodTexels`).
- Fog 80–380 m, far plane 480 m. The stage 1 scene uses the new textures (`dirt`, `treeDeciduous`). Render goldens regenerated.
- The default scene is the track preview; the stage 1 scene is available with `?scene=render`.

### Fixed
- Background terrain was visible inside the tunnel: its 32 m cells joined the mountain top with the terrain at the portal and cut through the tunnel. The background terrain no longer rises above tunnels; the mountain is made by the terrain strip along the track.
- A gap above the portal: the tunnel roof lay lower than the mountain at the sides. The roof and the terrain over the tunnel now have the full mountain height, and the portal covers the whole wall.
- Two vertical gaps at the sides of the tunnel entry and exit: walls were missing under the terrain ramp at the portal. Triangular wing walls were added.

### Known issues
- The tunnel interior is lit like the terrain outside (not darker).
- Above 80° of elevation the sky stretches radially (cylindrical panorama).
- The end of the terrain strip drops below the background terrain; from the free camera this shows as a step next to the track.
- Sprint tracks pass validation but were not checked visually (no such track in the data yet).

## [Stage 1] 2026-10-01 – renderer: index buffer, indexed textures, colormap

### Added
- A WebGL2 context with the era's options (`gfx/gl.js`), context loss and restore; every GL resource rebuilt from CPU data (`Renderer.init()`).
- Shader compilation with injected `#define`s and errors with line numbers (`gfx/program.js`); start-up errors shown on screen.
- An R8UI + `DEPTH_COMPONENT24` index buffer, 640×480 / 320×240 (`gfx/targets.js`).
- A palette of 16 ramps × 16 levels (`gfx/palette.js`), a colormap of 8 fog × 32 light levels with a cache (`gfx/colormap.js`); built in about 70 ms.
- An R8UI 128×128 texture array with a name registry and a 32×32 LOD variant in the next layer, `?notex=1` mode (`gfx/textures.js`).
- World shader: affine UVs (default) or perspective correction, Gouraud, 4×4 Bayer dithering of light and fog in the buffer's grid, colormap, cutout, `EMIT`/`NIGHT_EMIT`/`NOFOG`/`DOUBLE`/`DECAL` flags. Wireframe and present shaders (4:3 letterbox, `?rawpal=1`).
- Texture generator: periodic value noise and fBm, quantization to ramps with dithering, LOD reduction; temporary test textures (checker, brick, grass, dirt, paint, glass, tyre, cutout tree).
- A GL-free model loader: triangulation, face normals and smoothed normals with an angle threshold, subdivision of large faces by `CONFIG.tess.maxEdge`, bounding sphere; primitives and a test car (about 590 triangles).
- A CPU 2D overlay, 2D primitives, a VGA-style 8×16 font, a debug overlay (FPS, CPU, GPU through asynchronous timer queries, triangles, draw calls, UV mode, position).
- Scene `?scene=render`: a large floor, an unsubdivided wall next to a subdivided one, cubes, a Gouraud car, billboard trees, a field of 90 instanced cars (about 64k triangles), free camera.
- Debug keys F1–F6, URL parameters `debug`, `detail`, `persp`, `wire`, `rawpal`, `notex`, `seed`.
- Tests: `tools/test.mjs` (18 tests), `tests/render.html` with 7 goldens in `tools/golden/`, `tools/render-test.mjs` (headless Chrome), `tools/build.mjs` (one HTML file, 82 KiB).

### Known issues
- Face subdivision in the loader works per polygon; neighbouring faces with different subdivision can have T-junctions (single flickering pixels on edges). The track and terrain meshes (stage 2) have structural subdivision.
- The 8×16 font is made from a 5×7 table with doubled rows, so horizontal strokes are 2 px thick.
- The render goldens were made on SwiftShader; on another GPU the edge differences should stay within the 1% tolerance, but this has not been checked.

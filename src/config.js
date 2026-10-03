// Central tuning parameters for ROADLINE '95. Every number meant for tweaking lives here;
// URL debug params (see main.js) may override some of them at startup.

export const CONFIG = {
  seed: 1995,
  debug: false,
  render: {
    high: { w: 640, h: 480 },
    low: { w: 320, h: 240 },
    detail: 'high',
    fovY: 60,
    near: 0.5,
    far: 480,
    // Draw distance of scenery objects and sprites (m); the track and terrain use `far`.
    detailFar: 300,
    // Cars drawn with full detail (nearest first); the others use their far LOD (options).
    detailCars: 99,
    perspective: false,
    wire: false,
    rawpal: false,
    notex: false,
  },
  // Time-of-day presets (sky panorama, sun, fog colour/range, night lights). `light`/`fog` below are the day values.
  times: {
    day: { sky: 'day', ambient: 9, diffuse: 22, dir: [-0.45, -0.8, -0.4], fog: [148, 164, 184], fogStart: 80, fogEnd: 380, night: false },
    dusk: { sky: 'dusk', ambient: 7, diffuse: 17, dir: [0.85, -0.32, 0.4], fog: [150, 108, 96], fogStart: 70, fogEnd: 330, night: false },
    night: { sky: 'night', ambient: 5, diffuse: 3, dir: [0.3, -0.9, 0.2], fog: [12, 14, 32], fogStart: 35, fogEnd: 230, night: true },
  },
  light: {
    // Light is expressed in colormap levels 0..31 (31 = texture colour unchanged).
    ambient: 9,
    diffuse: 22,
    dir: [-0.45, -0.8, -0.4],
  },
  fog: {
    start: 80,
    end: 380,
    color: [148, 164, 184],
  },
  colormap: {
    // Light level that maps to factor 1.0; lower values make levels above it over-bright (saturating).
    lightOne: 31,
  },
  tex: {
    // Texels per screen pixel above which the simplified 32x32 LOD variant is sampled
    // (point-sampled LOD choice from UV derivatives; no filtering).
    lodTexels: 1.25,
  },
  tess: {
    // Max triangle edge (m) after subdividing large faces; limits affine texture swimming.
    maxEdge: 4,
    // Scenery objects stand 10+ m from the road: coarser subdivision keeps building triangle counts sane.
    sceneryMaxEdge: 12,
  },
  model: {
    // Smooth-shading crease angle (deg): sharper edges keep separate normals.
    creaseDeg: 50,
  },
  loop: {
    step: 1 / 60,
    maxFrame: 0.25,
  },
  camera: {
    moveSpeed: 14,
    fastFactor: 4,
    turnSpeed: 1.6,
    climbSpeed: 6,
  },
  track: {
    // Sample spacing along the track and max lateral grid cell (m); cell diagonals stay within tess.maxEdge.
    cell: 2.8,
    blend: 40,
    closeTol: { pos: 25, height: 6, headingDeg: 8 },
    kerbWidth: 1.2,
    shoulder: 2.5,
    ribbonWidth: 48,
    // Terrain rising more than this (m) above the road edge is not drivable (acts as a wall).
    climbLimit: 0.5,
    roadRepeat: 12,
    kerbRepeat: 4,
    lineRepeat: 12,
    terrainRepeat: 8,
    wallRepeat: 4,
    wallHeight: 1.1,
    wallThick: 0.4,
    tunnelHeight: 6.5,
    tunnelCover: 3,
    tunnelMountain: 18,
    tunnelRamp: 70,
    bridgeDepth: 14,
    pillarSpacing: 30,
    hillAmp: 10,
    farHillAmp: 60,
    baseDrop: 3,
    baseCell: 32,
    baseTile: 16,
    baseMargin: 600,
    chunkLen: 75,
    // Chunks farther than this (m, camera to chunk centre) use the far LOD (every other sample row).
    chunkLodDist: 160,
  },
  headlights: {
    // Cone half-angles (deg), range (m), gain (light levels at full strength), lamp height/ahead (m).
    outerDeg: 24,
    innerDeg: 10,
    range: 60,
    gain: 20,
    height: 0.7,
  },
  ai: {
    // Racing line: margin from the carriageway edge (m), smoothing iterations, cornering grip (m/s^2,
    // multiplied by the arcade boost), braking and acceleration used by the speed profile, top speed.
    line: { margin: 1.7, iterations: 150, coarse: 8, grip: 10.5, brake: 8.5, accel: 7, vmax: 88 },
    lookAhead: 7,
    lookAheadTime: 0.45,
    steerGain: 2.6,
    // Catch-up (rubber band): +/- fraction of target speed when far behind/ahead of the player.
    catchup: 0.03,
    catchupRange: 150,
    // Start a pass within overtakeGap + speed * overtakeTime (m); follow at 3 m + speed * followTime.
    overtakeGap: 14,
    overtakeTime: 0.25,
    followTime: 0.18,
    // Seconds an overtaking side is kept once chosen.
    passCommit: 3,
    lane: 3.2,
    errorDuration: 1.4,
    // Difficulty: rivals' pace factor (options: easy 0.94, normal 1, hard 1.035).
    difficulty: 1,
  },
  race: {
    checkpointSpacing: 100,
    lights: 5,
    lightInterval: 0.9,
    goDelay: [0.4, 1.4],
    falseStartPenalty: 5,
    gridSpacing: 8,
    gridLateral: 3,
    stuckTime: 4,
    ghostTime: 1.5,
    finishWait: 25,
    // Slipstream behind a car: max drag reduction, range (m), lateral window (m).
    draft: { max: 0.35, range: 20, width: 1.6 },
  },
  damage: {
    // Impacts below `threshold` (m/s) leave no mark; zone damage += (speed - threshold) * scale.
    threshold: 4,
    scale: 0.05,
    // Mesh rebuilt when a zone grows by `step`; maximum inward dent (m).
    step: 0.1,
    dentMax: 0.14,
  },
  collision: {
    // Car vs static scenery: bounce factor, speed lost per m/s of impact (capped) and yaw kick scale.
    restitution: 0.25,
    scrape: 0.02,
    maxScrape: 0.35,
    spin: 0.4,
    // Car vs car bounce factor and side-swipe friction.
    carRestitution: 0.3,
    carFriction: 0.4,
  },
  cameras: {
    chase: { dist: 6.2, height: 2.0, look: 1.0, lag: 5 },
    far: { dist: 12, height: 4.0, look: 1.2, lag: 3.5 },
    bumper: { height: 0.62, ahead: 0.15 },
    // Minimum clearance above the ground and below a tunnel ceiling (m).
    clearance: 0.45,
    shake: 1.0,
  },
  cockpit: {
    mirror: true,
    mirrorFar: 50,
    mirrorFov: 34,
    // Steering wheel turns this many times the road-wheel angle.
    wheelRatio: 9,
  },
  input: {
    deadzone: 0.15,
    // Options: gamepad 1 drives player 2 (and pad 2 player 1); tilt steering on touch devices.
    padSwap: false,
    tilt: false,
    // Tilt angle (deg) for full steering lock.
    tiltRange: 25,
  },
  vehicle: {
    // Physics runs at loop.step / substeps.
    substeps: 4,
    // Low-pass time constant (s) of accelerations feeding the weight transfer.
    transferLag: 0.08,
    wetGrip: 0.72,
    abs: true,
    // Arcade handling (1 / 1 / 1 = plain simulation): lateral grip multiplier at low speed and above
    // toSpeed (m/s, smooth blend from fromSpeed), and a yaw-inertia factor (< 1 = snappier turn-in).
    arcade: { latGrip: 1.25, latGripFast: 2.2, fromSpeed: 12, toSpeed: 50, yawInertia: 0.7, pitchTransfer: 0.6 },
    // Vertical motion: steepest ground slope (rise/run) that can lift the body, and max upward speed (m/s).
    maxGroundSlope: 0.35,
    maxClimbSpeed: 1.5,
    // Rear brake force cap as a fraction of rear grip (keeps lateral reserve under braking).
    rearBrakeLimit: 0.6,
    // Stability assist: yaw torque gain (1/s^2) per rad of sideslip beyond stabilityFrom (rad); 0 = off.
    stability: 60,
    stabilityFrom: 0.1,
    // Steering assist: cap the wheel angle at this multiple of the tyre peak slip (0 = off).
    steerAssist: 1.1,
    // Visual body roll / pitch (rad per m/s^2 of lateral / longitudinal acceleration).
    bodyRoll: 0.007,
    bodyPitch: 0.006,
    // Distances (m) switching to LOD1 and LOD2.
    lodDist: [25, 70],
    tractionControl: true,
    // 1 = friction circle, < 1 = ellipse (drive/brake force costs less lateral grip; more forgiving).
    frictionEllipse: 0.6,
    autoBrake: false,
    // Automatic gearbox for the human players (options); AI cars always shift automatically.
    autoGearbox: true,
    // Auto-brake: look-ahead distance (m) and assumed cornering grip (m/s^2).
    autoBrakeLook: 150,
    autoBrakeGrip: 8,
  },
  trackCam: {
    speed: 30,
    maxSpeed: 90,
    accel: 20,
    height: 1.3,
    lateralSpeed: 4,
    lookAhead: 12,
  },
  // Weather presets: light multipliers, fog (desaturate towards a grey tint, brightness, range limits or
  // scale), overcast sky, road wetness (grip) and rain amount (drops, spray, wipers, sound).
  weather: {
    clear: { ambient: 1, diffuse: 1, desaturate: 0, tint: [1, 1, 1], fogBright: 1, wet: 0, rain: 0, overcast: false },
    rain: { ambient: 0.85, diffuse: 0.35, desaturate: 0.8, tint: [0.92, 0.95, 1.02], fogBright: 0.72, fogScale: 0.55, wet: 1, rain: 1, overcast: true },
    fog: { ambient: 0.95, diffuse: 0.4, desaturate: 0.85, tint: [1, 1, 1.02], fogBright: 0.95, fogStart: 12, fogEnd: 130, wet: 0.3, rain: 0, overcast: true },
  },
  // Rain overlay: falling streaks, drops on the windscreen, wiper period (s); spray behind wheels.
  rain: { streaks: 160, screenDrops: 90, wiperPeriod: 1.4, sprayFrom: 8 },
  // TV cameras beside the track (replays): spacing along the track, distance beyond the road edge and
  // height (m); tracks may override them in `tv`. Director: max camera-car distance, minimum shot length,
  // helicopter shot every / for (s), framed car height (m) for the zoom, helicopter [distance, height].
  tv: { spacing: 170, offset: 14, height: 5, tunnelHeight: 4.5, maxDist: 170, hold: 2, heliEvery: 16, heliFor: 5, frame: 9, heli: [32, 30] },
  // Split screen (2 players): per-viewport field of view and automatic detail reduction - draw distance,
  // scenery/sprite distance, chunk LOD distance factor (> 1 = far LOD sooner) - and engine pan per side.
  split: { fovY: 44, far: 360, detailFar: 170, lodScale: 1.7, pan: 0.45 },
  // Replay playback: fast forward / rewind speed and slow motion factor.
  replay: { fast: 4, slow: 0.25 },
  // Scenery density 0..1 (options): ambient zone scenery spacing is divided by it at track load.
  scenery: { density: 1 },
  // Speed unit shown in HUD, cockpit and showroom: 'kmh' | 'mph' (options).
  units: 'kmh',
  audio: {
    // Bus volumes 0..1 (options in stage 10), master level and tunnel reverb wet level.
    master: 0.8,
    volume: { music: 0.45, sfx: 0.8, engine: 0.7, ambient: 0.5, voice: 0.7 },
    reverb: 0.6,
    engine: { gain: 0.8 },
    rivals: { voices: 3, range: 120, gain: 0.5 },
    sfx: { tyres: 0.6, impacts: 0.9, wind: 0.35, crowd: 0.6 },
  },
  scene: {
    // Instanced test cars in the render scene, sized to reach ~60k triangles per frame.
    stressCars: 90,
  },
};

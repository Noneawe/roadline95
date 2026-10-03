// Tyre model: simplified slip curve (rise to a peak, then fall off), load sensitivity and surface grip.
// Pure functions, no DOM.

/** Ground surface kinds reported by the ground probe. */
export const SURFACE = { ASPHALT: 0, KERB: 1, GRASS: 2, GRAVEL: 3, DIRT: 4 };

/**
 * Per-surface grip multiplier, extra rolling drag (fraction of load) and bump amplitude (m, visual/camera).
 * Indexed by SURFACE value.
 */
export const SURFACE_PROPS = [
  { name: 'asphalt', grip: 1.0, drag: 0, bump: 0 },
  { name: 'kerb', grip: 0.92, drag: 0.004, bump: 0.025 },
  { name: 'grass', grip: 0.55, drag: 0.1, bump: 0.02 },
  { name: 'gravel', grip: 0.5, drag: 0.16, bump: 0.03 },
  { name: 'dirt', grip: 0.62, drag: 0.05, bump: 0.02 },
];

/**
 * Normalized lateral force for a slip angle: rises to 1 at the peak, then falls to `falloff`.
 * @param {number} slip slip angle (rad, signed)
 * @param {number} peak slip angle of maximum force (rad)
 * @param {number} falloff force ratio far beyond the peak (0..1)
 * @returns {number} signed force factor -1..1
 */
export function slipCurve(slip, peak, falloff) {
  const x = Math.abs(slip) / peak;
  const f = x < 1 ? x * (2 - x) : 1 - (1 - falloff) * Math.min(1, (x - 1) / 3);
  return Math.sign(slip) * f;
}

/**
 * Friction coefficient with load sensitivity (heavily loaded tyres grip relatively less).
 * @param {number} mu base friction @param {number} load wheel load (N) @param {number} nominal static wheel load (N)
 * @param {number} sens sensitivity 0..0.3
 * @returns {number}
 */
export function loadedMu(mu, load, nominal, sens) {
  return mu * Math.max(0.5, 1 - sens * (load / nominal - 1));
}

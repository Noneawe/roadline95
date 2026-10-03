// Main loop: fixed-timestep updates (deterministic) and one render per animation frame.

/**
 * Starts the loop. `update(dt)` runs at a fixed step; `render(alpha)` once per frame.
 * @param {(dt: number) => void} update
 * @param {(alpha: number, frameSec: number) => void} render
 * @param {number} step seconds per update
 * @param {number} maxFrame clamp for long frames (tab switch, debugger)
 */
export function startLoop(update, render, step, maxFrame) {
  let last = -1, acc = 0;
  const frame = (tMs) => {
    const t = tMs / 1000;
    const dt = last < 0 ? step : Math.min(maxFrame, t - last);
    last = t;
    acc += dt;
    while (acc >= step) { update(step); acc -= step; }
    render(acc / step, dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

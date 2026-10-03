// Drivetrain: engine torque curve, rev limiter, turbo with boost lag, gearbox (auto/manual, reverse)
// and clutch slip at launch. Pure logic, no DOM.

/**
 * Engine torque at rpm from the spec curve (linear interpolation).
 * @param {[number, number][]} curve [rpm, Nm] points, rpm ascending
 * @param {number} rpm
 * @returns {number}
 */
export function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1], [r1, t1] = curve[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

/**
 * Overall ratio of a gear (engine revs per wheel rev); 0 in neutral, negative in reverse.
 * @param {object} gb gearbox spec @param {number} gear -1 = R, 0 = N, 1..n
 * @returns {number}
 */
export function gearRatio(gb, gear) {
  if (gear === 0) return 0;
  return (gear < 0 ? -gb.reverse : gb.ratios[gear - 1]) * gb.final;
}

export class Drivetrain {
  /** @param {object} spec car spec */
  constructor(spec) {
    this.spec = spec;
    this.rpm = spec.engine.idle;
    this.gear = 1;
    this.target = 1;
    this.shiftTimer = 0;
    this.boost = 0;
    this.cut = false;
    this.reverseTimer = 0;
  }

  /**
   * Updates gear selection, engine speed and returns the total drive torque at the driven wheels.
   * @param {number} dt
   * @param {{ throttle: number, gearUp: boolean, gearDown: boolean }} c effective controls
   * @param {number} wheelSpeed forward speed of the driven wheels (m/s)
   * @param {boolean} auto automatic gearbox
   * @returns {number} wheel torque (Nm, signed along the car's forward axis)
   */
  update(dt, c, wheelSpeed, auto) {
    const { engine, gearbox: gb, turbo } = this.spec;
    this.selectGear(dt, c, wheelSpeed, auto);
    const ratio = gearRatio(gb, this.gear);
    const wheelRpm = (wheelSpeed / this.spec.wheelRadius) * (60 / (2 * Math.PI));
    const free = engine.idle + c.throttle * (engine.redline - engine.idle);
    if (this.shiftTimer > 0 || ratio === 0) {
      this.rpm += (free - this.rpm) * Math.min(1, dt * 4);
    } else {
      const linked = Math.abs(wheelRpm * ratio);
      const slipRpm = engine.idle + c.throttle * (engine.launch - engine.idle);
      this.rpm = Math.max(linked, linked < slipRpm ? slipRpm : engine.idle);
    }
    if (this.rpm >= engine.limiter) this.cut = true;
    else if (this.rpm < engine.limiter - 250) this.cut = false;
    if (turbo) {
      const want = c.throttle * Math.min(1, Math.max(0, (this.rpm - turbo.rpm) / 1500));
      this.boost += (want - this.boost) * Math.min(1, dt / (want > this.boost ? turbo.lag : 0.25));
    }
    if (this.shiftTimer > 0 || ratio === 0) return 0;
    const drive = this.cut ? 0 : c.throttle * torqueAt(engine.torque, this.rpm) * (1 + (turbo ? this.boost * turbo.gain : 0));
    const brake = (1 - c.throttle) * engine.engineBrake * (this.rpm / engine.redline);
    return (drive - brake) * ratio * gb.efficiency;
  }

  selectGear(dt, c, speed, auto) {
    const gb = this.spec.gearbox, n = gb.ratios.length;
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      if (this.shiftTimer <= 0) this.gear = this.target;
      return;
    }
    let next = this.gear;
    if (!auto) {
      if (c.gearUp) next = Math.min(n, this.gear + 1);
      if (c.gearDown) next = Math.max(-1, this.gear - 1);
    } else if (this.gear > 0) {
      const rpmIn = (g) => Math.abs((speed / this.spec.wheelRadius) * (60 / (2 * Math.PI)) * gearRatio(gb, g));
      if (this.rpm > gb.upRpm && this.gear < n) next = this.gear + 1;
      else if (this.gear > 1 && this.rpm < gb.downRpm && rpmIn(this.gear - 1) < gb.upRpm - 400) next = this.gear - 1;
    }
    if (next !== this.gear) {
      this.target = next;
      this.shiftTimer = next === 0 || this.gear === 0 ? 0.01 : gb.shiftTime;
    }
  }

  /**
   * Automatic reverse: holding brake at standstill engages R; throttle at standstill returns to 1st.
   * @param {number} dt @param {number} speed forward speed @param {number} throttle @param {number} brake
   */
  autoReverse(dt, speed, throttle, brake) {
    const still = Math.abs(speed) < 0.8;
    const wantR = this.gear > 0 && still && brake > 0.5 && throttle < 0.1;
    const wantD = this.gear < 0 && still && throttle > 0.3;
    this.reverseTimer = wantR || wantD ? this.reverseTimer + dt : 0;
    if (this.reverseTimer > 0.35) {
      this.gear = this.target = wantR ? -1 : 1;
      this.reverseTimer = 0;
    }
  }
}

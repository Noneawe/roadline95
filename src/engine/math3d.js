// 3D math: column-major mat4 helpers with out-parameters (no allocation in hot paths),
// view/projection construction and frustum culling. Pure functions, usable in Node.

/**
 * @param {Float32Array} out
 * @returns {Float32Array}
 */
export function mat4Identity(out) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/**
 * out = a * b (out may alias a or b).
 * @param {Float32Array} out @param {Float32Array} a @param {Float32Array} b
 * @returns {Float32Array}
 */
export function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
    out[c * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
    out[c * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
    out[c * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
  }
  return out;
}

/**
 * OpenGL-style perspective projection (clip z in -w..w).
 * @param {Float32Array} out @param {number} fovY radians @param {number} aspect
 * @param {number} near @param {number} far
 * @returns {Float32Array}
 */
export function mat4Perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

/**
 * View matrix for a camera at pos with yaw (0 = looking -Z, positive turns right), pitch (positive up)
 * and roll around the view axis (positive raises the right side of the image, i.e. the camera's
 * right vector gets a +Y component of sin(roll)).
 * @param {Float32Array} out @param {ArrayLike<number>} pos @param {number} yaw @param {number} pitch
 * @param {number} [roll=0]
 * @returns {Float32Array}
 */
export function mat4View(out, pos, yaw, pitch, roll = 0) {
  const cp = Math.cos(pitch);
  const fx = Math.sin(yaw) * cp, fy = Math.sin(pitch), fz = -Math.cos(yaw) * cp;
  let rx = Math.cos(yaw), ry = 0, rz = Math.sin(yaw); // right = normalize(cross(f, up))
  let ux = -rz * fy, uy = rz * fx - rx * fz, uz = rx * fy; // up = cross(right, f)
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const nrx = rx * c + ux * s, nry = ry * c + uy * s, nrz = rz * c + uz * s;
    ux = ux * c - rx * s; uy = uy * c - ry * s; uz = uz * c - rz * s;
    rx = nrx; ry = nry; rz = nrz;
  }
  const px = pos[0], py = pos[1], pz = pos[2];
  out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * px + ry * py + rz * pz);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * px + uy * py + uz * pz);
  out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = fx * px + fy * py + fz * pz;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/**
 * Model matrix: rotation around Y by yaw, then translation.
 * @param {Float32Array} out @param {number} yaw @param {number} x @param {number} y @param {number} z
 * @param {number} [offset=0] write offset (for packed instance arrays)
 * @returns {Float32Array}
 */
export function mat4YawTranslate(out, yaw, x, y, z, offset = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw), o = offset;
  out[o] = c; out[o + 1] = 0; out[o + 2] = -s; out[o + 3] = 0;
  out[o + 4] = 0; out[o + 5] = 1; out[o + 6] = 0; out[o + 7] = 0;
  out[o + 8] = s; out[o + 9] = 0; out[o + 10] = c; out[o + 11] = 0;
  out[o + 12] = x; out[o + 13] = y; out[o + 14] = z; out[o + 15] = 1;
  return out;
}

/**
 * Model matrix from basis vectors (model X = right, Y = up, Z = back) and a translation.
 * @param {Float32Array} out @param {ArrayLike<number>} r @param {ArrayLike<number>} u @param {ArrayLike<number>} b
 * @param {ArrayLike<number>} t
 * @returns {Float32Array}
 */
export function mat4FromBasis(out, r, u, b, t) {
  out[0] = r[0]; out[1] = r[1]; out[2] = r[2]; out[3] = 0;
  out[4] = u[0]; out[5] = u[1]; out[6] = u[2]; out[7] = 0;
  out[8] = b[0]; out[9] = b[1]; out[10] = b[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}

/**
 * Transforms a point by a mat4 including perspective divide.
 * @param {number[]} out @param {Float32Array} m @param {ArrayLike<number>} p
 * @returns {number[]} out
 */
export function transformPoint(out, m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
  return out;
}

/**
 * Extracts 6 normalized frustum planes (a, b, c, d) from a view-projection matrix.
 * @param {Float32Array} out length 24 @param {Float32Array} m
 * @returns {Float32Array}
 */
export function frustumPlanes(out, m) {
  for (let p = 0; p < 6; p++) {
    const row = p >> 1, sign = p & 1 ? -1 : 1;
    let len = 0;
    for (let c = 0; c < 4; c++) {
      const v = m[c * 4 + 3] + sign * m[c * 4 + row];
      out[p * 4 + c] = v;
      if (c < 3) len += v * v;
    }
    len = Math.sqrt(len);
    for (let c = 0; c < 4; c++) out[p * 4 + c] /= len;
  }
  return out;
}

/**
 * True if the sphere is at least partially inside the frustum.
 * @param {Float32Array} planes from frustumPlanes
 * @param {number} x @param {number} y @param {number} z @param {number} r
 * @returns {boolean}
 */
export function sphereInFrustum(planes, x, y, z, r) {
  for (let p = 0; p < 24; p += 4) {
    if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -r) return false;
  }
  return true;
}

/** @param {number[]} a @param {number[]} b @returns {number[]} */
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @param {number[]} a @param {number[]} b @returns {number[]} */
export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @param {number[]} a @param {number} s @returns {number[]} */
export const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
/** @param {number[]} a @param {number[]} b @returns {number} */
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @param {number[]} a @param {number[]} b @returns {number[]} */
export const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** @param {number[]} a @returns {number} */
export const vLength = (a) => Math.hypot(a[0], a[1], a[2]);
/** @param {number[]} a @returns {number[]} */
export function vNormalize(a) {
  const l = vLength(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** @param {number[]} a @param {number[]} b @param {number} t @returns {number[]} */
export const vLerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

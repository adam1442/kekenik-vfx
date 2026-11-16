/**
 * Minimal 3D math on plain arrays (no dependency). World convention of Kekenik VFX (documented in CONTRACTS §13):
 * RIGHT-HANDED, **Z UP**, +X right, +Y forward (into the screen in the default front view). Angles in degrees at the
 * API boundary of nodes, radians inside this file unless the name says `Deg`. Quaternions are [x, y, z, w].
 * Matrices are column-major Float64Array(16) (same layout as three.js `Matrix4.elements`).
 */
export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float64Array;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const v3 = {
  add: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: ArrayLike<number>, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s],
  mul: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  dot: (a: ArrayLike<number>, b: ArrayLike<number>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: ArrayLike<number>, b: ArrayLike<number>): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a: ArrayLike<number>): number => Math.hypot(a[0], a[1], a[2]),
  norm(a: ArrayLike<number>): V3 {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-20 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 1];
  },
  lerp: (a: ArrayLike<number>, b: ArrayLike<number>, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

export const quatIdentity = (): Quat => [0, 0, 0, 1];
export function quatMul(a: ArrayLike<number>, b: ArrayLike<number>): Quat {
  const [ax, ay, az, aw] = [a[0], a[1], a[2], a[3]];
  const [bx, by, bz, bw] = [b[0], b[1], b[2], b[3]];
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export function quatNormalize(q: ArrayLike<number>): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-20 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}
export function quatAxisAngle(axis: ArrayLike<number>, angle: number): Quat {
  const a = v3.norm(axis);
  const s = Math.sin(angle / 2);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(angle / 2)];
}
/** Euler angles in DEGREES, rotation order X then Y then Z (q = qz * qy * qx). */
export function quatFromEulerDeg(rx: number, ry: number, rz: number): Quat {
  const qx = quatAxisAngle([1, 0, 0], rx * DEG2RAD);
  const qy = quatAxisAngle([0, 1, 0], ry * DEG2RAD);
  const qz = quatAxisAngle([0, 0, 1], rz * DEG2RAD);
  return quatMul(qz, quatMul(qy, qx));
}
export function quatToEulerDeg(q: ArrayLike<number>): V3 {
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
  // matches quatFromEulerDeg (R = Rz Ry Rx)
  const sinY = 2 * (w * y - z * x);
  const ry = Math.abs(sinY) >= 1 ? (Math.sign(sinY) * Math.PI) / 2 : Math.asin(sinY);
  const rx = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const rz = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return [rx * RAD2DEG, ry * RAD2DEG, rz * RAD2DEG];
}
export function quatRotate(q: ArrayLike<number>, v: ArrayLike<number>): V3 {
  const [qx, qy, qz, qw] = [q[0], q[1], q[2], q[3]];
  // v' = v + 2w(q x v) + 2 q x (q x v)
  const tx = 2 * (qy * v[2] - qz * v[1]);
  const ty = 2 * (qz * v[0] - qx * v[2]);
  const tz = 2 * (qx * v[1] - qy * v[0]);
  return [v[0] + qw * tx + (qy * tz - qz * ty), v[1] + qw * ty + (qz * tx - qx * tz), v[2] + qw * tz + (qx * ty - qy * tx)];
}
/** Shortest rotation taking unit vector `a` to unit vector `b`. */
export function quatFromTo(a: ArrayLike<number>, b: ArrayLike<number>): Quat {
  const u = v3.norm(a);
  const w = v3.norm(b);
  const d = v3.dot(u, w);
  if (d > 0.999999) return [0, 0, 0, 1];
  if (d < -0.999999) {
    // 180 degrees: any perpendicular axis
    const ax = Math.abs(u[0]) < 0.9 ? v3.cross(u, [1, 0, 0]) : v3.cross(u, [0, 1, 0]);
    return quatAxisAngle(ax, Math.PI);
  }
  const c = v3.cross(u, w);
  return quatNormalize([c[0], c[1], c[2], 1 + d]);
}
export function quatSlerp(a: ArrayLike<number>, b: ArrayLike<number>, t: number): Quat {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) return quatNormalize([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  const th = Math.acos(d);
  const s = Math.sin(th);
  const k0 = Math.sin((1 - t) * th) / s;
  const k1 = Math.sin(t * th) / s;
  return [a[0] * k0 + bx * k1, a[1] * k0 + by * k1, a[2] * k0 + bz * k1, a[3] * k0 + bw * k1];
}

export const mat4Identity = (): Mat4 => {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};
export function mat4Mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return o;
}
export function mat4Compose(t: ArrayLike<number>, q: ArrayLike<number>, s: ArrayLike<number>): Mat4 {
  const [x, y, z, w] = [q[0], q[1], q[2], q[3]];
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0];
  m[1] = 2 * (x * y + z * w) * s[0];
  m[2] = 2 * (x * z - y * w) * s[0];
  m[4] = 2 * (x * y - z * w) * s[1];
  m[5] = (1 - 2 * (x * x + z * z)) * s[1];
  m[6] = 2 * (y * z + x * w) * s[1];
  m[8] = 2 * (x * z + y * w) * s[2];
  m[9] = 2 * (y * z - x * w) * s[2];
  m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  m[15] = 1;
  return m;
}
export function mat4Translate(t: ArrayLike<number>): Mat4 {
  const m = mat4Identity();
  m[12] = t[0];
  m[13] = t[1];
  m[14] = t[2];
  return m;
}
/** General 4x4 inverse (cofactor expansion). Returns identity for singular matrices. */
export function mat4Invert(a: Mat4): Mat4 {
  const inv = new Float64Array(16);
  inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
  inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
  inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
  inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
  inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
  inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
  inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
  inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
  inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
  inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
  inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
  inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
  inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
  inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
  inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
  inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
  const det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
  if (Math.abs(det) < 1e-30) return mat4Identity();
  const id = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= id;
  return inv;
}
export const mat4Point = (m: Mat4, p: ArrayLike<number>): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
export const mat4Dir = (m: Mat4, p: ArrayLike<number>): V3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
/** Normal transform = inverse-transpose of the upper 3x3 (pass the INVERSE matrix: `mat4Invert(m)`). */
export const mat4NormalFromInverse = (inv: Mat4, n: ArrayLike<number>): V3 => [inv[0] * n[0] + inv[1] * n[1] + inv[2] * n[2], inv[4] * n[0] + inv[5] * n[1] + inv[6] * n[2], inv[8] * n[0] + inv[9] * n[1] + inv[10] * n[2]];
export const mat4Det3 = (m: Mat4): number => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

/** Deterministic PRNG (mulberry32) so node output depends only on its seed. */
export function rng(seed: number): () => number {
  let a = (seed | 0) ^ 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

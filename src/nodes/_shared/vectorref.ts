/**
 * CPU mirrors of the Vector nodes: the same formulas as the shaders (`vectorlib.wgsl`, `vector/adjust`, `vector/advect`,
 * `vector/motion_encode`). Used by tests/vector-ref.test.ts and the GPU known-answer self-test (`selftest/sim-vector.ts`).
 * Vectors are tile fractions / second, +x right, +y DOWN.
 */
import { perlin3, type Vec3T } from '../../engine/shaders/reference/noise';

export interface VecField { w: number; h: number; x: Float32Array; y: Float32Array }
export const makeField = (w: number, h: number, f: (u: number, v: number, ix: number, iy: number) => [number, number]): VecField => {
  const x = new Float32Array(w * h), y = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) [x[j * w + i], y[j * w + i]] = f((i + 0.5) / w, (j + 0.5) / h, i, j);
  return { w, h, x, y };
};

/** `vl_potential`: tileable fractal Perlin potential, `cells` lattice cells per axis (rounded), z in [0, 1) with `zc` periodic layers. */
export function potential(u: number, v: number, cells: [number, number], oct: number, rough: number, z: number, zc: number, seed: number, tile: [boolean, boolean]): number {
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (let o = 0; o < Math.min(6, oct); o++) {
    const cx = Math.round(cells[0] * freq), cy = Math.round(cells[1] * freq);
    const per: Vec3T = [tile[0] ? cx : 0, tile[1] ? cy : 0, zc];
    sum += amp * perlin3([u * cx, v * cy, z * zc], per, (seed + o * 7919) >>> 0);
    norm += amp;
    amp *= rough;
    freq *= 2;
  }
  return sum / Math.max(norm, 1e-6);
}

/** `vl_curl_noise`: divergence-free field = rotated gradient of the potential (central differences). */
export function curlNoise(u: number, v: number, cells: [number, number], oct: number, rough: number, z: number, zc: number, seed: number, tile: [boolean, boolean]): [number, number] {
  const e = 0.5 / (64 * Math.max(cells[0], cells[1]));
  const P = (a: number, b: number): number => potential(a, b, cells, oct, rough, z, zc, seed, tile);
  const px = P(u + e, v) - P(u - e, v);
  const py = P(u, v + e) - P(u, v - e);
  const k = 1 / (2 * e) / (Math.max(cells[0], cells[1]) * 4);
  return [py * k, -px * k];
}

export interface AdjustOptions { invertX: boolean; invertY: boolean; deadzone: number; power: number; reference: number; gain: number; normalize: boolean; length: number; minLen: number; maxLen: number }
export const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);
/** `vector.adjust` (Normalize / Clamp / Remap / Invert). */
export function adjustVector(x: number, y: number, o: AdjustOptions): [number, number] {
  if (o.invertX) x = -x;
  if (o.invertY) y = -y;
  let l = Math.hypot(x, y);
  if (l <= Math.max(o.deadzone, 1e-9)) return [0, 0];
  const dx = x / l, dy = y / l;
  if (o.power !== 1) l = Math.pow(l / Math.max(o.reference, 1e-6), o.power) * o.reference;
  l *= o.gain;
  if (o.normalize) l = o.length * sign(o.gain);
  l = Math.max(l, o.minLen * sign(o.gain));
  if (o.maxLen > 0) l = Math.min(o.maxLen, Math.max(-o.maxLen, l));
  return [dx * l, dy * l];
}

const texel = (f: VecField, i: number, j: number): number => ((((j % f.h) + f.h) % f.h) * f.w + (((i % f.w) + f.w) % f.w));
/** Bilinear periodic sample of a vector field at tile coordinates. */
export function sampleVec(f: VecField, u: number, v: number): [number, number] {
  const x = u * f.w - 0.5, y = v * f.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const s = (a: Float32Array): number => (a[texel(f, x0, y0)] * (1 - fx) + a[texel(f, x0 + 1, y0)] * fx) * (1 - fy) + (a[texel(f, x0, y0 + 1)] * (1 - fx) + a[texel(f, x0 + 1, y0 + 1)] * fx) * fy;
  return [s(f.x), s(f.y)];
}
export interface GrayField { w: number; h: number; d: Float32Array }
export function sampleGray(g: GrayField, u: number, v: number): number {
  const x = u * g.w - 0.5, y = v * g.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const at = (i: number, j: number): number => g.d[(((j % g.h) + g.h) % g.h) * g.w + (((i % g.w) + g.w) % g.w)];
  return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}
/** `vector.advect`, modes displace (steps = 1, RK1) and integrate (RK1 / RK2 / RK4): lookup position of one pixel, then the sample. */
export function advectStep(img: GrayField, vec: VecField, u: number, v: number, o: { strength: number; steps: number; method: 'rk1' | 'rk2' | 'rk4'; forward?: boolean }): number {
  const k = o.strength * (o.forward ? 1 : -1); // shader: sg = +1 forward / -1 backward (backward: content moves WITH the vectors)
  const n = Math.max(1, o.steps), h = k / n;
  let p: [number, number] = [u, v];
  for (let i = 0; i < n; i++) {
    const k1 = sampleVec(vec, p[0], p[1]);
    if (o.method === 'rk1') p = [p[0] + k1[0] * h, p[1] + k1[1] * h];
    else if (o.method === 'rk2') {
      const m = sampleVec(vec, p[0] + k1[0] * 0.5 * h, p[1] + k1[1] * 0.5 * h);
      p = [p[0] + m[0] * h, p[1] + m[1] * h];
    } else {
      const k2 = sampleVec(vec, p[0] + k1[0] * 0.5 * h, p[1] + k1[1] * 0.5 * h);
      const k3 = sampleVec(vec, p[0] + k2[0] * 0.5 * h, p[1] + k2[1] * 0.5 * h);
      const k4 = sampleVec(vec, p[0] + k3[0] * h, p[1] + k3[1] * h);
      p = [p[0] + ((k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * h) / 6, p[1] + ((k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * h) / 6];
    }
  }
  return sampleGray(img, p[0], p[1]);
}

export interface MotionEncoding { scale: number; flipY: boolean; signed: boolean; bits: 8 | 16 | 32 }
const quant = (x: number, bits: 8 | 16 | 32): number => (bits === 8 ? Math.round(x * 255) / 255 : bits === 16 ? Math.round(x * 65535) / 65535 : x);
/** `vector.motion_encode` OUT 0. */
export function encodeMotion(x: number, y: number, o: MotionEncoding): [number, number] {
  const s = Math.max(o.scale, 1e-6);
  let ex = x / s, ey = (o.flipY ? -y : y) / s;
  if (!o.signed) {
    ex = Math.min(1, Math.max(0, ex * 0.5 + 0.5));
    ey = Math.min(1, Math.max(0, ey * 0.5 + 0.5));
  }
  return [quant(ex, o.bits), quant(ey, o.bits)];
}
/** `vector.motion_encode` OUT 1. */
export function decodeMotion(r: number, g: number, o: MotionEncoding): [number, number] {
  const s = Math.max(o.scale, 1e-6);
  const dx = o.signed ? r : (r - 0.5) * 2, dy = o.signed ? g : (g - 0.5) * 2;
  return [dx * s, (o.flipY ? -dy : dy) * s];
}

/** Central-difference divergence of a periodic field (per second). */
export function divergence(f: VecField): Float32Array {
  const out = new Float32Array(f.w * f.h);
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) {
    out[j * f.w + i] = (f.x[texel(f, i + 1, j)] - f.x[texel(f, i - 1, j)]) * 0.5 * f.w + (f.y[texel(f, i, j + 1)] - f.y[texel(f, i, j - 1)]) * 0.5 * f.h;
  }
  return out;
}

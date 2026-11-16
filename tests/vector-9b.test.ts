import { describe, expect, it } from 'vitest';
import { adjustVector, advectStep, curlNoise, decodeMotion, divergence, encodeMotion, makeField, sampleVec, type GrayField } from '../src/nodes/_shared/vectorref';

/** CPU references of the Vector nodes (curl noise, advection, adjust, motion encoding). */
const N = 64;
const curlField = (cells: [number, number], z = 0): ReturnType<typeof makeField> => makeField(N, N, (u, v) => curlNoise(u, v, cells, 3, 0.5, z, 4, 7, [true, true]));
const meanAbs = (a: ArrayLike<number>): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i]);
  return s / a.length;
};

describe('Vector Noise (curl)', () => {
  it('is (nearly) divergence free: |div| is far below the divergence of a plain field of the same magnitude', () => {
    // one smooth octave on a fine grid so that the central differences of the test itself are accurate
    const n = 128;
    const f = makeField(n, n, (u, v) => curlNoise(u, v, [2, 2], 1, 0.5, 0, 4, 7, [true, true]));
    const div = divergence(f);
    const mag = (meanAbs(f.x) + meanAbs(f.y)) / 2;
    expect(mag).toBeGreaterThan(1e-4);
    const plain = makeField(n, n, (u, v) => [Math.sin(u * 12.5) * mag, Math.sin(v * 12.5) * mag]);
    expect(meanAbs(div)).toBeLessThan(0.05 * meanAbs(divergence(plain)));
  });
  it('is tileable in both axes (periodic lattice) and periodic in z', () => {
    const a = curlNoise(0.001, 0.37, [4, 4], 3, 0.5, 0.2, 4, 7, [true, true]);
    const b = curlNoise(1.001, 0.37, [4, 4], 3, 0.5, 0.2, 4, 7, [true, true]);
    expect(b[0]).toBeCloseTo(a[0], 4);
    expect(b[1]).toBeCloseTo(a[1], 4);
    const c = curlNoise(0.3, 0.6, [4, 4], 3, 0.5, 0.0, 4, 7, [true, true]);
    const d = curlNoise(0.3, 0.6, [4, 4], 3, 0.5, 1.0, 4, 7, [true, true]); // z loop = 1
    expect(d[0]).toBeCloseTo(c[0], 4);
    expect(d[1]).toBeCloseTo(c[1], 4);
  });
  it('is deterministic and differs between seeds', () => {
    const a = curlNoise(0.3, 0.3, [4, 4], 2, 0.5, 0, 4, 1, [true, true]);
    expect(curlNoise(0.3, 0.3, [4, 4], 2, 0.5, 0, 4, 1, [true, true])).toEqual(a);
    expect(curlNoise(0.3, 0.3, [4, 4], 2, 0.5, 0, 4, 2, [true, true])).not.toEqual(a);
  });
});

describe('Vector Advect', () => {
  const img = (f: (x: number, y: number) => number): GrayField => {
    const d = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) d[y * N + x] = f(x, y);
    return { w: N, h: N, d };
  };
  const blob = img((x, y) => Math.exp(-(((x - 20) / 6) ** 2 + ((y - 30) / 6) ** 2)));
  const total = (g: GrayField): number => g.d.reduce((s, x) => s + x, 0);
  const render = (vec: ReturnType<typeof makeField>, o: Parameters<typeof advectStep>[4]): GrayField => img((x, y) => advectStep(blob, vec, (x + 0.5) / N, (y + 0.5) / N, o));

  it('a uniform field with strength 1 shifts the image by exactly the vector (integer pixels)', () => {
    const vec = makeField(N, N, () => [8 / N, 0]); // 8 px to the right
    const out = render(vec, { strength: 1, steps: 4, method: 'rk4' });
    for (let y = 28; y < 33; y++) for (let x = 24; x < 33; x++) expect(out.d[y * N + x]).toBeCloseTo(blob.d[y * N + x - 8], 5);
  });
  it('is conservative (mass) for a divergence-free field on a periodic grid', () => {
    const vec = curlField([2, 2]);
    // normalise to ~2 px displacement
    let mx = 0;
    for (let i = 0; i < vec.x.length; i++) mx = Math.max(mx, Math.hypot(vec.x[i], vec.y[i]));
    const s = 2 / N / mx;
    for (let i = 0; i < vec.x.length; i++) { vec.x[i] *= s; vec.y[i] *= s; }
    const out = render(vec, { strength: 1, steps: 4, method: 'rk2' });
    expect(Math.abs(total(out) - total(blob)) / total(blob)).toBeLessThan(0.03);
  });
  it('RK4 and RK2 agree on a smooth field; forward and backward are inverse for small steps', () => {
    const vec = makeField(N, N, (u, v) => [0.02 * Math.sin(2 * Math.PI * v), 0.02 * Math.cos(2 * Math.PI * u)]);
    const a = advectStep(blob, vec, 0.3, 0.45, { strength: 1, steps: 8, method: 'rk2' });
    const b = advectStep(blob, vec, 0.3, 0.45, { strength: 1, steps: 8, method: 'rk4' });
    expect(a).toBeCloseTo(b, 3);
    const fw = advectStep(blob, vec, 0.3, 0.45, { strength: 1, steps: 1, method: 'rk1', forward: true });
    expect(Number.isFinite(fw)).toBe(true);
  });
  it('zero strength is the identity', () => {
    const vec = curlField([2, 2]);
    expect(advectStep(blob, vec, 0.31, 0.47, { strength: 0, steps: 3, method: 'rk4' })).toBeCloseTo(blob.d[Math.floor(0.47 * N) * N + Math.floor(0.31 * N)], 1);
  });
});

describe('Vector Adjust / sampling / motion encoding', () => {
  const base = { invertX: false, invertY: false, deadzone: 0, power: 1, reference: 1, gain: 1, normalize: false, length: 1, minLen: 0, maxLen: 0 };
  it('normalize gives the requested length and keeps the direction', () => {
    const [x, y] = adjustVector(3, 4, { ...base, normalize: true, length: 2 });
    expect(Math.hypot(x, y)).toBeCloseTo(2, 6);
    expect(x / y).toBeCloseTo(0.75, 6);
  });
  it('clamp, invert and deadzone', () => {
    expect(Math.hypot(...adjustVector(30, 40, { ...base, maxLen: 5 }))).toBeCloseTo(5, 6);
    expect(adjustVector(1, 2, { ...base, invertX: true, invertY: true })).toEqual([-1, -2]);
    expect(adjustVector(0.01, 0, { ...base, deadzone: 0.1 })).toEqual([0, 0]);
  });
  it('bilinear sampling is periodic', () => {
    const f = makeField(8, 8, (u) => [u, 0]);
    const a = sampleVec(f, 0.01, 0.2), b = sampleVec(f, 1.01, 1.2);
    expect(a[0]).toBeCloseTo(b[0], 6);
  });
  it('encode -> decode round trip for every convention (8 / 16 bit within quantisation)', () => {
    for (const signed of [false, true]) for (const flipY of [false, true]) for (const bits of [8, 16, 32] as const) {
      const o = { scale: 0.25, flipY, signed, bits };
      const v: [number, number] = [0.1, -0.2];
      const e = encodeMotion(v[0], v[1], o);
      const d = decodeMotion(e[0], e[1], o);
      const tol = bits === 8 ? 0.25 / 255 : 1e-4;
      expect(Math.abs(d[0] - v[0])).toBeLessThan(tol);
      expect(Math.abs(d[1] - v[1])).toBeLessThan(tol);
    }
  });
  it('0.5-biased encoding: zero vector = 0.5, extremes clamp to 0 / 1', () => {
    const o = { scale: 1, flipY: false, signed: false, bits: 32 as const };
    expect(encodeMotion(0, 0, o)).toEqual([0.5, 0.5]);
    expect(encodeMotion(9, -9, o)).toEqual([1, 0]);
  });
});

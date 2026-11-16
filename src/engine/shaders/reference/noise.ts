/**
 * CPU mirror of wgsl/hash.wgsl + wgsl/noise.wgsl. Used by vitest and by the GPU known-answer tests
 * (selftest compares GPU readback to these functions). Keep it line-by-line equivalent to the WGSL.
 */
import { lerp } from '../../../shared/util';
const imul = Math.imul;

export function pcg(v: number): number {
  const s = (imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

export function hashU(a: number, b: number, c: number, seed: number): number {
  return pcg((a + pcg((b + pcg((c + pcg(seed)) >>> 0)) >>> 0)) >>> 0);
}

export const u01 = (h: number): number => (h >>> 8) / 16777216;

export function wrapI(i: number, period: number): number {
  if (period <= 0) return i;
  const m = i % period;
  return m < 0 ? m + period : m;
}

export function latticeHash(ix: number, iy: number, iz: number, px: number, py: number, pz: number, seed: number): number {
  return hashU(wrapI(ix, px) >>> 0, wrapI(iy, py) >>> 0, wrapI(iz, pz) >>> 0, seed);
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

export type Vec3T = [number, number, number];

export function valueNoise3(p: Vec3T, period: Vec3T, seed: number): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const iz = Math.floor(p[2]);
  const ux = fade(p[0] - ix);
  const uy = fade(p[1] - iy);
  const uz = fade(p[2] - iz);
  const c = (dx: number, dy: number, dz: number): number => u01(latticeHash(ix + dx, iy + dy, iz + dz, period[0], period[1], period[2], seed));
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), ux);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), ux);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), ux);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

export function grad3(h: number): Vec3T {
  const g: Vec3T = [(h & 1) * 2 - 1, ((h >>> 1) & 1) * 2 - 1, ((h >>> 2) & 1) * 2 - 1];
  const k = (h >>> 3) % 3;
  g[k] = 0;
  return g;
}

export function perlin3(p: Vec3T, period: Vec3T, seed: number): number {
  const ix = Math.floor(p[0]);
  const iy = Math.floor(p[1]);
  const iz = Math.floor(p[2]);
  const fx = p[0] - ix;
  const fy = p[1] - iy;
  const fz = p[2] - iz;
  const corner = (ox: number, oy: number, oz: number): number => {
    const g = grad3(latticeHash(ix + ox, iy + oy, iz + oz, period[0], period[1], period[2], seed) >>> 4);
    return g[0] * (fx - ox) + g[1] * (fy - oy) + g[2] * (fz - oz);
  };
  const ux = fade(fx);
  const uy = fade(fy);
  const uz = fade(fz);
  const x00 = lerp(corner(0, 0, 0), corner(1, 0, 0), ux);
  const x10 = lerp(corner(0, 1, 0), corner(1, 1, 0), ux);
  const x01 = lerp(corner(0, 0, 1), corner(1, 0, 1), ux);
  const x11 = lerp(corner(0, 1, 1), corner(1, 1, 1), ux);
  return lerp(lerp(x00, x10, uy), lerp(x01, x11, uy), uz);
}

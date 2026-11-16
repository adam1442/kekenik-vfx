/* ------------------------------------------------------------------------------------------------
 * 3D / 4D coherent noise for mesh displacement. Deterministic by seed (seeded permutation table).
 *   perlin4(x,y,z,w, period): gradient noise with a PERIODIC 4th axis. With `period` = integer N the lattice repeats every N
 *   units of w, so animating w from 0..N loops exactly (the "animated 4th dimension with LOOPING support").
 *   simplex3(x,y,z): classic 3D simplex. Its loop is made by `fbm()` with a cross-fade of two time slices (exactly periodic).
 * Output range is roughly [-1, 1].
 * ---------------------------------------------------------------------------------------------- */
import { lerp } from '../../shared/util';

const permCache = new Map<number, Uint8Array>();
function perm(seed: number): Uint8Array {
  const s = seed | 0;
  let p = permCache.get(s);
  if (p) return p;
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let a = (s ^ 0x9e3779b9) | 0;
  const rnd = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  if (permCache.size > 64) permCache.clear();
  permCache.set(s, p);
  return p;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** 4D gradient: 32 directions (±1 on three of four axes). */
function grad4(h: number, x: number, y: number, z: number, w: number): number {
  const g = h & 31;
  const a = g >> 3; // which axis is zero
  const b = g & 7;
  const u = a === 0 ? y : x;
  const v = a === 1 || a === 0 ? z : y;
  const t = a === 3 ? z : w;
  return (b & 1 ? -u : u) + (b & 2 ? -v : v) + (b & 4 ? -t : t);
}

/** Perlin noise in 4D. `period` > 0 makes the w lattice periodic (integer period). */
export function perlin4(x: number, y: number, z: number, w: number, seed: number, period = 0): number {
  const p = perm(seed);
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z), fw = Math.floor(w);
  const rx = x - fx, ry = y - fy, rz = z - fz, rw = w - fw;
  const X = fx & 255, Y = fy & 255, Z = fz & 255;
  const wrapW = (i: number): number => (period > 0 ? ((i % period) + period) % period : i) & 255;
  const W0 = wrapW(fw), W1 = wrapW(fw + 1);
  const u = fade(rx), v = fade(ry), t = fade(rz), s = fade(rw);
  const h = (i: number, j: number, k: number, l: number): number => p[p[p[p[X + i] + Y + j] + Z + k] + l];
  const g = (i: number, j: number, k: number, l: number, W: number): number => grad4(h(i, j, k, W), rx - i, ry - j, rz - k, rw - l);
  const slice = (l: number, W: number): number =>
    lerp(
      lerp(lerp(g(0, 0, 0, l, W), g(1, 0, 0, l, W), u), lerp(g(0, 1, 0, l, W), g(1, 1, 0, l, W), u), v),
      lerp(lerp(g(0, 0, 1, l, W), g(1, 0, 1, l, W), u), lerp(g(0, 1, 1, l, W), g(1, 1, 1, l, W), u), v),
      t,
    );
  return lerp(slice(0, W0), slice(1, W1), s) * 0.62;
}

const G3 = [1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1];
/** Classic 3D simplex noise. */
export function simplex3(xin: number, yin: number, zin: number, seed: number): number {
  const p = perm(seed);
  const F3 = 1 / 3, G = 1 / 6;
  const s = (xin + yin + zin) * F3;
  const i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
  const t = (i + j + k) * G;
  const x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
  let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
  if (x0 >= y0) {
    if (y0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 1, 0];
    else if (x0 >= z0) [i1, j1, k1, i2, j2, k2] = [1, 0, 0, 1, 0, 1];
    else [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 1, 0, 1];
  } else if (y0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 0, 1, 0, 1, 1];
  else if (x0 < z0) [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 0, 1, 1];
  else [i1, j1, k1, i2, j2, k2] = [0, 1, 0, 1, 1, 0];
  const x1 = x0 - i1 + G, y1 = y0 - j1 + G, z1 = z0 - k1 + G;
  const x2 = x0 - i2 + 2 * G, y2 = y0 - j2 + 2 * G, z2 = z0 - k2 + 2 * G;
  const x3 = x0 - 1 + 3 * G, y3 = y0 - 1 + 3 * G, z3 = z0 - 1 + 3 * G;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const corner = (xx: number, yy: number, zz: number, gi: number): number => {
    let tt = 0.6 - xx * xx - yy * yy - zz * zz;
    if (tt < 0) return 0;
    tt *= tt;
    const gg = (gi % 12) * 3;
    return tt * tt * (G3[gg] * xx + G3[gg + 1] * yy + G3[gg + 2] * zz);
  };
  const n0 = corner(x0, y0, z0, p[ii + p[jj + p[kk]]]);
  const n1 = corner(x1, y1, z1, p[ii + i1 + p[jj + j1 + p[kk + k1]]]);
  const n2 = corner(x2, y2, z2, p[ii + i2 + p[jj + j2 + p[kk + k2]]]);
  const n3 = corner(x3, y3, z3, p[ii + 1 + p[jj + 1 + p[kk + 1]]]);
  return 32 * (n0 + n1 + n2 + n3);
}

export type NoiseKind = 'perlin' | 'simplex';
export interface FbmOpts {
  kind: NoiseKind;
  octaves: number;
  lacunarity: number;
  gain: number;
  seed: number;
  /** Time (the animated 4th axis). With `loopCycles` > 0, t in [0,1) is one exact loop. Otherwise t is in noise units. */
  t: number;
  /** Integer number of noise cycles per loop for the base octave (0 = not looping). */
  loopCycles: number;
}

/** Fractal Brownian motion, normalised to ~[-1, 1]. Every octave has an integer cycle count, so the loop stays exact. */
export function fbm(x: number, y: number, z: number, o: FbmOpts): number {
  let amp = 1, norm = 0, sum = 0, f = 1;
  const oct = Math.max(1, Math.min(10, Math.round(o.octaves)));
  for (let k = 0; k < oct; k++) {
    const sd = o.seed + k * 1013;
    let n: number;
    if (o.kind === 'perlin') {
      if (o.loopCycles > 0) {
        const per = Math.max(1, Math.round(o.loopCycles * Math.max(1, Math.round(f))));
        n = perlin4(x * f, y * f, z * f, o.t * per, sd, per);
      } else n = perlin4(x * f, y * f, z * f, o.t, sd, 0);
    } else if (o.loopCycles > 0) {
      // exact loop: cross-fade of the slice at t and the slice at t-1 (both shifted along a hidden axis)
      const K = o.loopCycles * 1.37 * Math.max(1, Math.round(f));
      const a = simplex3(x * f + 11.3, y * f, z * f + o.t * K, sd);
      const b = simplex3(x * f + 11.3, y * f, z * f + (o.t - 1) * K, sd);
      const s = o.t * o.t * (3 - 2 * o.t);
      n = a * (1 - s) + b * s;
    } else n = simplex3(x * f + 11.3, y * f, z * f + o.t, sd);
    sum += n * amp;
    norm += amp;
    amp *= o.gain;
    f *= o.lacunarity;
  }
  return Math.max(-1, Math.min(1, (sum / norm) * (o.kind === 'perlin' ? 1.6 : 1)));
}

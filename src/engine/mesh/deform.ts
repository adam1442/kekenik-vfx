import { computeNormalsAngle, pointAttr, pointNormals, pointUV } from './helpers';
import { MeshData, STD } from './mesh';
import { quatFromEulerDeg, quatRotate, type V3 } from './math3';
import { fbm, type NoiseKind } from './noise3';
import { sampleChannel, type CpuTexture } from './texsnap';

/* ------------------------------------------------------------------------------------------------
 * Deformers: noise displacement and Space Warp. Pure functions of a frozen input -> new mesh (unchanged arrays are
 * shared). Deterministic by seed. Per-point loops over typed arrays (about 1M points / 100s of ms; the documented CPU path).
 * ---------------------------------------------------------------------------------------------- */

const smooth = (a: number, b: number, x: number): number => {
  if (b <= a) return x >= b ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Spherical falloff region (gizmo: `falloff3d`): weight 1 inside `inner`, 0 beyond `outer`, smooth between. */
export interface Falloff {
  enabled: boolean;
  center: V3;
  inner: number;
  outer: number;
  invert: boolean;
}
export const noFalloff = (): Falloff => ({ enabled: false, center: [0, 0, 0], inner: 0.5, outer: 1.5, invert: false });
export function falloffWeight(f: Falloff, x: number, y: number, z: number): number {
  if (!f.enabled) return 1;
  const d = Math.hypot(x - f.center[0], y - f.center[1], z - f.center[2]);
  const w = 1 - smooth(f.inner, f.outer, d);
  return f.invert ? 1 - w : w;
}

/* ---------------------------------------------------------------------------------------------- noise */
export const NOISE_MASKS = ['none', 'cd_r', 'cd_g', 'cd_b', 'cd_a', 'attribute', 'texture'] as const;
export type NoiseMask = (typeof NOISE_MASKS)[number];
export const NOISE_MODES = ['normal', 'vector', 'axis'] as const;

export interface NoiseDisplaceParams {
  mode: (typeof NOISE_MODES)[number];
  axis: V3;
  kind: NoiseKind;
  frequency: number;
  /** Per-axis frequency multiplier (anisotropic noise, e.g. stretched along a beam). */
  freqScale: V3;
  amplitude: number;
  /** Added to the noise (-1..1) before scaling: 0 = displace both ways, 1 = push only outwards. */
  bias: number;
  offset: V3;
  octaves: number;
  lacunarity: number;
  gain: number;
  seed: number;
  /** The animated 4th axis: noise units, or 0..1 loop phase when `loopCycles` > 0. */
  t: number;
  loopCycles: number;
  mask: NoiseMask;
  maskAttr: string;
  maskInvert: boolean;
  maskTexture: CpuTexture | null;
  maskChannel: number;
  uvSet: number;
  falloff: Falloff;
  storeNoise: boolean;
  recomputeNormals: boolean;
}
export const defaultNoiseParams = (): NoiseDisplaceParams => ({
  mode: 'normal', axis: [0, 0, 1], kind: 'perlin', frequency: 2, freqScale: [1, 1, 1], amplitude: 0.1, bias: 0, offset: [0, 0, 0], octaves: 3, lacunarity: 2, gain: 0.5, seed: 1, t: 0, loopCycles: 0,
  mask: 'none', maskAttr: 'age', maskInvert: false, maskTexture: null, maskChannel: 4, uvSet: 0, falloff: noFalloff(), storeNoise: false, recomputeNormals: true,
});

/** Per-point mask 0..1 (1 = full effect). Returns null for 'none'. A texture mask without a ready snapshot gives null (neutral). */
export function pointMask(m: MeshData, mask: NoiseMask, attr: string, invert: boolean, tex: CpuTexture | null, channel: number, uvSet: number): Float32Array | null {
  if (mask === 'none') return null;
  const n = m.pointCount;
  const out = new Float32Array(n);
  if (mask === 'texture') {
    const uv = pointUV(m, uvSet);
    if (!tex || !uv) return null;
    for (let i = 0; i < n; i++) out[i] = sampleChannel(tex, uv[i * 2], uv[i * 2 + 1], channel, true);
  } else {
    const name = mask === 'attribute' ? attr : 'Cd';
    const a = pointAttr(m, name);
    if (!a) return null;
    const comp = mask === 'attribute' ? 0 : { cd_r: 0, cd_g: 1, cd_b: 2, cd_a: 3 }[mask as 'cd_r'];
    const c = Math.min(comp, a.size - 1);
    for (let i = 0; i < n; i++) out[i] = a.data[i * a.size + c];
  }
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, invert ? 1 - out[i] : out[i]));
  return out;
}

export function noiseDisplace(src: MeshData, p: NoiseDisplaceParams): MeshData {
  const n = src.pointCount;
  const out = src.clone();
  const P = out.writable('point', STD.P) as Float32Array;
  const N = p.mode === 'normal' ? pointNormals(src) : null;
  const mask = pointMask(src, p.mask, p.maskAttr, p.maskInvert, p.maskTexture, p.maskChannel, p.uvSet);
  const base = { kind: p.kind, octaves: p.octaves, lacunarity: p.lacunarity, gain: p.gain, t: p.t, loopCycles: p.loopCycles };
  const ax = p.axis;
  const al = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  const store = p.storeNoise ? new Float32Array(n) : null;
  const f = p.frequency;
  const src0 = src.positions;
  for (let i = 0; i < n; i++) {
    const x = src0[i * 3], y = src0[i * 3 + 1], z = src0[i * 3 + 2];
    let w = (mask ? mask[i] : 1) * falloffWeight(p.falloff, x, y, z);
    const sx = (x + p.offset[0]) * f * p.freqScale[0], sy = (y + p.offset[1]) * f * p.freqScale[1], sz = (z + p.offset[2]) * f * p.freqScale[2];
    if (w === 0 && !store) continue;
    if (p.mode === 'vector') {
      const nx = fbm(sx, sy, sz, { ...base, seed: p.seed }), ny = fbm(sx + 31.7, sy - 17.3, sz + 5.9, { ...base, seed: p.seed + 7 }), nz = fbm(sx - 9.1, sy + 23.3, sz - 41.2, { ...base, seed: p.seed + 13 });
      P[i * 3] += (nx + p.bias) * p.amplitude * w;
      P[i * 3 + 1] += (ny + p.bias) * p.amplitude * w;
      P[i * 3 + 2] += (nz + p.bias) * p.amplitude * w;
      if (store) store[i] = nx;
    } else {
      const v = fbm(sx, sy, sz, { ...base, seed: p.seed });
      if (store) store[i] = v;
      w *= (v + p.bias) * p.amplitude;
      if (p.mode === 'normal') {
        P[i * 3] += N![i * 3] * w;
        P[i * 3 + 1] += N![i * 3 + 1] * w;
        P[i * 3 + 2] += N![i * 3 + 2] * w;
      } else {
        P[i * 3] += (ax[0] / al) * w;
        P[i * 3 + 1] += (ax[1] / al) * w;
        P[i * 3 + 2] += (ax[2] / al) * w;
      }
    }
  }
  if (store) out.setAttr({ name: 'noise', element: 'point', size: 1, kind: 'f32', data: store });
  if (p.recomputeNormals && out.primCount > 0 && (out.has('point', STD.N) || out.has('vertex', STD.N))) {
    computeNormalsAngle(out, out.has('vertex', STD.N) && !out.has('point', STD.N) ? 'flat' : 'smooth');
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ space warp */
export const WARP_MODES = ['bend', 'twist', 'taper', 'stretch', 'spherify', 'wave', 'ripple', 'lattice', 'displace_texture'] as const;
export type WarpMode = (typeof WARP_MODES)[number];

export interface LatticeParams {
  res: number;
  boxPos: V3;
  boxSize: V3;
  /** Displacement of the 8 box corners (order: x fastest, then y, then z), trilinearly spread over the grid. */
  corners: V3[];
  /** Random per-control-point displacement amount and its seed. */
  jitter: number;
  seed: number;
}
export interface WarpParams {
  mode: WarpMode;
  axis: 'x' | 'y' | 'z';
  position: V3;
  rotation: V3;
  amount: number;
  length: number;
  frequency: number;
  phase: number;
  decay: number;
  radius: number;
  preserveVolume: boolean;
  falloff: Falloff;
  lattice: LatticeParams;
  texture: CpuTexture | null;
  textureChannel: number;
  textureMid: number;
  along: 'normal' | 'x' | 'y' | 'z';
  uvSet: number;
  recomputeNormals: boolean;
}
export const defaultWarpParams = (): WarpParams => ({
  mode: 'bend', axis: 'z', position: [0, 0, 0], rotation: [0, 0, 0], amount: 45, length: 2, frequency: 1, phase: 0, decay: 0, radius: 1, preserveVolume: true, falloff: noFalloff(),
  lattice: { res: 3, boxPos: [0, 0, 0], boxSize: [2, 2, 2], corners: Array.from({ length: 8 }, () => [0, 0, 0] as V3), jitter: 0, seed: 1 },
  texture: null, textureChannel: 4, textureMid: 0.5, along: 'normal', uvSet: 0, recomputeNormals: true,
});

const hash3 = (seed: number, i: number, j: number, k: number, c: number): number => {
  let h = (Math.imul(i + 1013, 0x27d4eb2d) ^ Math.imul(j + 7919, 0x165667b1) ^ Math.imul(k + 104729, 0x9e3779b1) ^ Math.imul(c + 31, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296 - 0.5;
};

/** Displacement of the lattice at normalised box coordinates (0..1)^3. */
export function latticeOffset(l: LatticeParams, u: number, v: number, w: number): V3 {
  const res = Math.max(2, Math.min(8, Math.round(l.res)));
  const gx = Math.min(1, Math.max(0, u)) * (res - 1), gy = Math.min(1, Math.max(0, v)) * (res - 1), gz = Math.min(1, Math.max(0, w)) * (res - 1);
  const i0 = Math.min(res - 2, Math.floor(gx)), j0 = Math.min(res - 2, Math.floor(gy)), k0 = Math.min(res - 2, Math.floor(gz));
  const fx = gx - i0, fy = gy - j0, fz = gz - k0;
  const ctrl = (i: number, j: number, k: number): V3 => {
    const cu = i / (res - 1), cv = j / (res - 1), cw = k / (res - 1);
    const o: V3 = [0, 0, 0];
    for (let c = 0; c < 8; c++) {
      const wx = c & 1 ? cu : 1 - cu, wy = c & 2 ? cv : 1 - cv, wz = c & 4 ? cw : 1 - cw;
      const q = l.corners[c] ?? [0, 0, 0];
      o[0] += q[0] * wx * wy * wz;
      o[1] += q[1] * wx * wy * wz;
      o[2] += q[2] * wx * wy * wz;
    }
    if (l.jitter !== 0) for (let a = 0; a < 3; a++) o[a] += hash3(l.seed, i, j, k, a) * 2 * l.jitter;
    return o;
  };
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const r: V3 = [0, 0, 0];
  for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
    const wgt = (di ? sx : 1 - sx) * (dj ? sy : 1 - sy) * (dk ? sz : 1 - sz);
    const q = ctrl(i0 + di, j0 + dj, k0 + dk);
    r[0] += q[0] * wgt;
    r[1] += q[1] * wgt;
    r[2] += q[2] * wgt;
  }
  return r;
}

export function spaceWarp(src: MeshData, p: WarpParams): MeshData {
  const n = src.pointCount;
  const out = src.clone();
  const P = out.writable('point', STD.P) as Float32Array;
  const q = quatFromEulerDeg(p.rotation[0], p.rotation[1], p.rotation[2]);
  const qi: [number, number, number, number] = [-q[0], -q[1], -q[2], q[3]];
  const len = Math.max(1e-6, p.length);
  const amt = p.amount;
  const rad = (amt * Math.PI) / 180;
  // axis permutation: local (x,y,z) -> (a,b,c) with a = along the axis
  const perm = p.axis === 'x' ? [0, 1, 2] : p.axis === 'y' ? [1, 2, 0] : [2, 0, 1];
  const N = p.mode === 'displace_texture' && p.along === 'normal' ? pointNormals(src) : null;
  const uv = p.mode === 'displace_texture' ? pointUV(src, p.uvSet) : null;
  const src0 = src.positions;
  const L = p.lattice;
  const lo: V3 = [L.boxPos[0] - L.boxSize[0] / 2, L.boxPos[1] - L.boxSize[1] / 2, L.boxPos[2] - L.boxSize[2] / 2];
  for (let i = 0; i < n; i++) {
    const wx = src0[i * 3], wy = src0[i * 3 + 1], wz = src0[i * 3 + 2];
    const w = falloffWeight(p.falloff, wx, wy, wz);
    if (w <= 0) continue;
    let nx = wx, ny = wy, nz = wz;
    if (p.mode === 'lattice') {
      const u = (wx - lo[0]) / (L.boxSize[0] || 1), v = (wy - lo[1]) / (L.boxSize[1] || 1), t = (wz - lo[2]) / (L.boxSize[2] || 1);
      const dx = Math.max(0, -u, u - 1), dy = Math.max(0, -v, v - 1), dz = Math.max(0, -t, t - 1);
      const fade = 1 - smooth(0, 0.15, Math.hypot(dx, dy, dz));
      if (fade > 0) {
        const o = latticeOffset(L, u, v, t);
        nx += o[0] * fade;
        ny += o[1] * fade;
        nz += o[2] * fade;
      }
    } else if (p.mode === 'displace_texture') {
      if (p.texture && uv) {
        const d = (sampleChannel(p.texture, uv[i * 2], uv[i * 2 + 1], p.textureChannel, true) - p.textureMid) * amt;
        if (N) {
          nx += N[i * 3] * d;
          ny += N[i * 3 + 1] * d;
          nz += N[i * 3 + 2] * d;
        } else if (p.along === 'x') nx += d;
        else if (p.along === 'y') ny += d;
        else nz += d;
      }
    } else {
      // into warp space
      const r = quatRotate(qi, [wx - p.position[0], wy - p.position[1], wz - p.position[2]]);
      let a = r[perm[0]], b = r[perm[1]], c = r[perm[2]];
      switch (p.mode) {
        case 'bend': {
          const k = rad / len;
          if (Math.abs(k) > 1e-7) {
            const rr = 1 / k, phi = a * k;
            const nb = rr - (rr - b) * Math.cos(phi);
            const na = (rr - b) * Math.sin(phi);
            a = na;
            b = nb;
          }
          break;
        }
        case 'twist': {
          const ang = (rad * a) / len, cs = Math.cos(ang), sn = Math.sin(ang);
          const nb2 = b * cs - c * sn;
          c = b * sn + c * cs;
          b = nb2;
          break;
        }
        case 'taper': {
          const s = Math.max(0, 1 + amt * (a / len));
          b *= s;
          c *= s;
          break;
        }
        case 'stretch': {
          const s = Math.max(0.001, 1 + amt);
          a *= s;
          if (p.preserveVolume) {
            const t = 1 / Math.sqrt(s);
            b *= t;
            c *= t;
          }
          break;
        }
        case 'spherify': {
          const l = Math.hypot(a, b, c);
          if (l > 1e-9) {
            const k = (p.radius / l - 1) * Math.min(1, Math.max(0, amt)) + 1;
            a *= k;
            b *= k;
            c *= k;
          }
          break;
        }
        case 'wave':
          a += amt * Math.sin((p.frequency * b + p.phase) * Math.PI * 2);
          break;
        case 'ripple': {
          const d = Math.hypot(b, c);
          a += amt * Math.sin((p.frequency * d - p.phase) * Math.PI * 2) * Math.exp(-p.decay * d);
          break;
        }
        default:
          break;
      }
      const loc: V3 = [0, 0, 0];
      loc[perm[0]] = a;
      loc[perm[1]] = b;
      loc[perm[2]] = c;
      const wp = quatRotate(q, loc);
      nx = wp[0] + p.position[0];
      ny = wp[1] + p.position[1];
      nz = wp[2] + p.position[2];
    }
    P[i * 3] = wx + (nx - wx) * w;
    P[i * 3 + 1] = wy + (ny - wy) * w;
    P[i * 3 + 2] = wz + (nz - wz) * w;
  }
  if (p.recomputeNormals && out.primCount > 0 && (out.has('point', STD.N) || out.has('vertex', STD.N))) {
    computeNormalsAngle(out, out.has('vertex', STD.N) && !out.has('point', STD.N) ? 'flat' : 'smooth');
  }
  return out;
}

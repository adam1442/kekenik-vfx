import { computeIslands, promoteAttr } from './builder';
import { pointAttr, pointUV } from './helpers';
import { checkMeshLimits, MeshData, STD, type AttrData, type AttrKind, type Element } from './mesh';
import { quatFromEulerDeg, quatMul, quatNormalize, type V3 } from './math3';
import { orientFromNormal } from './points';
import { fbm, type NoiseKind } from './noise3';
import { sampleChannel, sampleTex, type CpuTexture } from './texsnap';
import { evalCurve, evalGradient } from '../params/curve';
import type { CurveValue, GradientValue } from '../params/schema';
import type { RGBA } from '../../shared/util';

/* ------------------------------------------------------------------------------------------------
 * Attribute operations: Combine Color / Scale / Transform, Extract Points. Pure functions of a frozen mesh -> new
 * mesh (unchanged arrays shared). Deterministic by seed. Sources are evaluated per POINT (or per vertex for UV-driven colour).
 * ---------------------------------------------------------------------------------------------- */

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Integer hash -> 0..1 (deterministic per (seed, i)). */
export function hash01(seed: number, i: number): number {
  let h = (Math.imul(i + 0x9e3779b1, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface NoiseSource {
  kind: NoiseKind;
  frequency: number;
  octaves: number;
  seed: number;
  t: number;
  loopCycles: number;
}
const noise01 = (x: number, y: number, z: number, n: NoiseSource): number =>
  fbm(x * n.frequency, y * n.frequency, z * n.frequency, { kind: n.kind, octaves: n.octaves, lacunarity: 2, gain: 0.5, seed: n.seed, t: n.t, loopCycles: n.loopCycles }) * 0.5 + 0.5;

/**
 * Projection of a point on a gizmo axis (origin + direction + length, `axis3d` gizmo) as 0..1 (0 at the origin, 1 at `length`).
 * `length` <= 0 = auto: fit the extent of the mesh along the direction.
 */
export function axisProjector(m: MeshData, origin: V3, dir: V3, length: number): (x: number, y: number, z: number) => number {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d: V3 = [dir[0] / l, dir[1] / l, dir[2] / l];
  if (length > 0) return (x, y, z) => ((x - origin[0]) * d[0] + (y - origin[1]) * d[1] + (z - origin[2]) * d[2]) / length;
  const P = m.positions;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < m.pointCount; i++) {
    const v = P[i * 3] * d[0] + P[i * 3 + 1] * d[1] + P[i * 3 + 2] * d[2];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(hi > lo)) {
    lo = 0;
    hi = 1;
  }
  return (x, y, z) => (x * d[0] + y * d[1] + z * d[2] - lo) / (hi - lo);
}

/** Island id per primitive: the `island` attribute when present, otherwise connected components. */
export function primIslands(m: MeshData): { ids: Int32Array; count: number } {
  const a = m.attr('primitive', STD.island);
  if (a && a.data.length === m.primCount) {
    let mx = -1;
    for (let i = 0; i < a.data.length; i++) mx = Math.max(mx, a.data[i]);
    return { ids: Int32Array.from(a.data as ArrayLike<number>), count: mx + 1 };
  }
  return computeIslands(m);
}

/* ------------------------------------------------------------------------------------------- combine color */
export const COLOR_SOURCES = ['uniform', 'texture', 'gradient_axis', 'gradient_radial', 'gradient_length', 'noise', 'island'] as const;
export type ColorSource = (typeof COLOR_SOURCES)[number];
export const BLEND_MODES = ['copy', 'add', 'subtract', 'multiply', 'screen', 'max', 'min', 'overlay', 'difference'] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export function blendChannel(mode: BlendMode, b: number, s: number): number {
  switch (mode) {
    case 'add': return b + s;
    case 'subtract': return b - s;
    case 'multiply': return b * s;
    case 'screen': return 1 - (1 - b) * (1 - s);
    case 'max': return Math.max(b, s);
    case 'min': return Math.min(b, s);
    case 'overlay': return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s);
    case 'difference': return Math.abs(b - s);
    default: return s;
  }
}

export interface CombineColorParams {
  source: ColorSource;
  color: RGBA;
  texture: CpuTexture | null;
  /** Gray textures carry alpha 1; with this on, a 1-channel texture writes its VALUE into alpha (masks into the alpha channel). */
  grayToAlpha?: boolean;
  uvSet: number;
  origin: V3;
  direction: V3;
  length: number;
  rangeMin: number;
  rangeMax: number;
  lengthAttr: string;
  gradient: GradientValue;
  /** Remap of the 0..1 scalar before the gradient. */
  curve: CurveValue;
  noise: NoiseSource;
  seed: number;
  write: [boolean, boolean, boolean, boolean];
  blend: BlendMode;
  opacity: number;
  element: 'auto' | 'point' | 'vertex';
  attribute: string;
}
export const defaultCombineColorParams = (): CombineColorParams => ({
  source: 'gradient_axis', color: [1, 1, 1, 1], texture: null, uvSet: 0, origin: [0, 0, 0], direction: [0, 0, 1], length: 0, rangeMin: 0, rangeMax: 0, lengthAttr: 'age',
  gradient: { stops: [{ pos: 0, color: [0, 0, 0, 1] }, { pos: 1, color: [1, 1, 1, 1] }] }, curve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  noise: { kind: 'perlin', frequency: 2, octaves: 3, seed: 1, t: 0, loopCycles: 0 }, seed: 1, write: [true, true, true, true], blend: 'copy', opacity: 1, element: 'auto', attribute: 'Cd',
});

/** HSV (h 0..1) -> linear-ish RGB used for random island colours. */
export function hsv(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return ([[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6]) as [number, number, number];
}

export function combineColor(src: MeshData, p: CombineColorParams): MeshData {
  const out = src.clone();
  const hasPrims = src.primCount > 0;
  let el: 'point' | 'vertex' = 'point';
  if (hasPrims && (p.element === 'vertex' || (p.element === 'auto' && p.source === 'texture' && src.has('vertex', p.uvSet <= 0 ? 'uv' : `uv${p.uvSet}`)))) el = 'vertex';
  const n = el === 'point' ? src.pointCount : src.vertexCount;
  const vp = src.topology.vertPoint;
  const P = src.positions;
  const posOf = (i: number): number => (el === 'point' ? i : vp[i]) * 3;
  const S = new Float32Array(n * 4); // source colour per element
  const grad = (t: number): RGBA => evalGradient(p.gradient, clamp01(evalCurve(p.curve, clamp01(t))));
  switch (p.source) {
    case 'uniform':
      for (let i = 0; i < n; i++) S.set(p.color, i * 4);
      break;
    case 'texture': {
      if (!p.texture) {
        // snapshot not ready: neutral (no change) is signalled by opacity 0 below
        S.fill(0);
        break;
      }
      const name = p.uvSet <= 0 ? 'uv' : `uv${p.uvSet}`;
      const uvv = el === 'vertex' ? src.resolveToVertex(name) : null;
      const uvp = el === 'point' ? pointUV(src, p.uvSet) : null;
      const o = [0, 0, 0, 1];
      for (let i = 0; i < n; i++) {
        const u = uvv ? uvv.data[i * 2] : uvp ? uvp[i * 2] : 0;
        const v = uvv ? uvv.data[i * 2 + 1] : uvp ? uvp[i * 2 + 1] : 0;
        sampleTex(p.texture, u, v, true, o);
        // A Gray wire into the Color pin arrives as RGBA (g, g, g, 1): use the luminance for any channel count
        if (p.grayToAlpha) o[3] = p.texture.channels === 1 ? o[0] : 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2];
        S.set(o, i * 4);
      }
      break;
    }
    case 'gradient_axis': {
      const proj = axisProjector(src, p.origin, p.direction, p.length);
      for (let i = 0; i < n; i++) {
        const o = posOf(i);
        S.set(grad(proj(P[o], P[o + 1], P[o + 2])), i * 4);
      }
      break;
    }
    case 'gradient_radial': {
      // distance from the gizmo axis (origin + direction), 0 on the axis .. 1 at `length` (0 = farthest point)
      const l = Math.hypot(p.direction[0], p.direction[1], p.direction[2]) || 1;
      const d: V3 = [p.direction[0] / l, p.direction[1] / l, p.direction[2] / l];
      const dist = (o: number): number => {
        const vx = P[o] - p.origin[0], vy = P[o + 1] - p.origin[1], vz = P[o + 2] - p.origin[2];
        const along = vx * d[0] + vy * d[1] + vz * d[2];
        return Math.hypot(vx - d[0] * along, vy - d[1] * along, vz - d[2] * along);
      };
      let maxr = p.length;
      if (!(maxr > 0)) {
        maxr = 1e-9;
        for (let i = 0; i < src.pointCount; i++) maxr = Math.max(maxr, dist(i * 3));
      }
      for (let i = 0; i < n; i++) S.set(grad(dist(posOf(i)) / maxr), i * 4);
      break;
    }
    case 'gradient_length': {
      const a = pointAttr(src, p.lengthAttr);
      let lo = 0, hi = 1;
      if (a) {
        lo = Infinity;
        hi = -Infinity;
        for (let i = 0; i < src.pointCount; i++) {
          const x = a.data[i * a.size];
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
        if (p.rangeMin !== p.rangeMax) [lo, hi] = [p.rangeMin, p.rangeMax];
        if (!(hi > lo)) hi = lo + 1;
      }
      const np = Math.max(1, src.pointCount - 1);
      for (let i = 0; i < n; i++) {
        const pt = el === 'point' ? i : vp[i];
        const x = a ? a.data[pt * a.size] : pt / np;
        S.set(grad((x - lo) / (hi - lo)), i * 4);
      }
      break;
    }
    case 'noise':
      for (let i = 0; i < n; i++) {
        const o = posOf(i);
        S.set(grad(noise01(P[o], P[o + 1], P[o + 2], p.noise)), i * 4);
      }
      break;
    case 'island': {
      const isl = primIslands(src);
      const col = new Float32Array(Math.max(1, isl.count) * 3);
      for (let k = 0; k < isl.count; k++) col.set(hsv(hash01(p.seed, k), 0.55 + 0.4 * hash01(p.seed + 1, k), 0.65 + 0.35 * hash01(p.seed + 2, k)), k * 3);
      if (el === 'vertex') {
        const po = src.topology.vertexPrimitives();
        for (let i = 0; i < n; i++) {
          const k = Math.max(0, isl.ids[po[i]]);
          S.set([col[k * 3], col[k * 3 + 1], col[k * 3 + 2], 1], i * 4);
        }
      } else {
        const seen = new Uint8Array(n);
        const ps = src.topology.primStart;
        for (let q = 0; q < src.primCount; q++) {
          const k = Math.max(0, isl.ids[q]);
          for (let v = ps[q]; v < ps[q + 1]; v++) {
            const pt = vp[v];
            if (seen[pt]) continue;
            seen[pt] = 1;
            S.set([col[k * 3], col[k * 3 + 1], col[k * 3 + 2], 1], pt * 4);
          }
        }
        for (let i = 0; i < n; i++) if (!seen[i]) S.set([1, 1, 1, 1], i * 4);
      }
      break;
    }
  }
  // base colour at the target element (an existing attribute of either level is promoted / expanded)
  const white = p.attribute === 'Cd';
  const base = new Float32Array(n * 4);
  if (white) base.fill(1);
  const exist = el === 'vertex' ? src.resolveToVertex(p.attribute) : pointAttr(src, p.attribute);
  if (exist) for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) base[i * 4 + c] = c < exist.size ? exist.data[i * exist.size + c] : c === 3 ? 1 : 0;
  const k = p.source === 'texture' && !p.texture ? 0 : clamp01(p.opacity);
  const res = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 4; c++) {
      const b = base[i * 4 + c];
      res[i * 4 + c] = p.write[c] ? b + (blendChannel(p.blend, b, S[i * 4 + c]) - b) * k : b;
    }
  }
  if (k === 0) return src.clone(); // opacity 0 or the texture snapshot is still pending: nothing to write
  out.removeAttr(el === 'point' ? 'vertex' : 'point', p.attribute);
  out.setAttr({ name: p.attribute, element: el, size: 4, kind: 'f32', data: res });
  return out;
}

/* -------------------------------------------------------------------------------------------- combine scale */
export const SCALE_SOURCES = ['uniform', 'random', 'texture', 'attribute', 'gradient_axis', 'noise'] as const;
export type ScaleSource = (typeof SCALE_SOURCES)[number];
export interface CombineScaleParams {
  source: ScaleSource;
  value: number;
  min: number;
  max: number;
  seed: number;
  texture: CpuTexture | null;
  uvSet: number;
  textureChannel: number;
  attr: string;
  origin: V3;
  direction: V3;
  length: number;
  rangeMin: number;
  rangeMax: number;
  curve: CurveValue;
  useCurve: boolean;
  target: 'pscale' | 'scale' | 'both';
  /** Per-axis weight for the vec3 `scale` (0 = axis untouched, 1 = full). */
  axes: V3;
  multiply: boolean;
  noise: NoiseSource;
}
export const defaultCombineScaleParams = (): CombineScaleParams => ({
  source: 'random', value: 1, min: 0.5, max: 1.5, seed: 1, texture: null, uvSet: 0, textureChannel: 4, attr: 'age', origin: [0, 0, 0], direction: [0, 0, 1], length: 0, rangeMin: 0, rangeMax: 0,
  curve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, useCurve: false, target: 'pscale', axes: [1, 1, 1], multiply: true, noise: { kind: 'perlin', frequency: 2, octaves: 2, seed: 1, t: 0, loopCycles: 0 },
});

export function combineScale(src: MeshData, p: CombineScaleParams): MeshData {
  const n = src.pointCount;
  const P = src.positions;
  const val = new Float32Array(n);
  const attr = p.source === 'attribute' ? pointAttr(src, p.attr) : null;
  if (p.source === 'attribute' && !attr) throw new Error(`Combine Scale: no attribute "${p.attr}"`);
  const uv = p.source === 'texture' ? pointUV(src, p.uvSet) : null;
  const proj = p.source === 'gradient_axis' ? axisProjector(src, p.origin, p.direction, p.length) : null;
  let alo = 0, ahi = 1;
  if (attr) {
    alo = Infinity;
    ahi = -Infinity;
    for (let i = 0; i < n; i++) {
      alo = Math.min(alo, attr.data[i * attr.size]);
      ahi = Math.max(ahi, attr.data[i * attr.size]);
    }
    if (p.rangeMin !== p.rangeMax) [alo, ahi] = [p.rangeMin, p.rangeMax];
    if (!(ahi > alo)) ahi = alo + 1;
  }
  for (let i = 0; i < n; i++) {
    let t: number;
    switch (p.source) {
      case 'uniform': t = 1; break;
      case 'random': t = hash01(p.seed, i); break;
      case 'texture': t = p.texture && uv ? sampleChannel(p.texture, uv[i * 2], uv[i * 2 + 1], p.textureChannel, true) : 1; break;
      case 'attribute': t = (attr!.data[i * attr!.size] - alo) / (ahi - alo); break;
      case 'gradient_axis': t = proj!(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); break;
      default: t = noise01(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], p.noise);
    }
    t = clamp01(t);
    if (p.useCurve && p.source !== 'uniform') t = evalCurve(p.curve, t);
    val[i] = p.source === 'uniform' ? p.value : p.min + (p.max - p.min) * t;
  }
  const out = src.clone();
  if (p.target === 'pscale' || p.target === 'both') {
    const old = out.attr('point', STD.pscale);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = (p.multiply && old ? old.data[i] : 1) * val[i];
    out.setAttr({ name: STD.pscale, element: 'point', size: 1, kind: 'f32', data: d });
  }
  if (p.target === 'scale' || p.target === 'both') {
    const old = out.attr('point', STD.scale);
    const d = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) d[i * 3 + c] = (p.multiply && old ? old.data[i * 3 + c] : 1) * (1 + (val[i] - 1) * p.axes[c]);
    out.setAttr({ name: STD.scale, element: 'point', size: 3, kind: 'f32', data: d });
  }
  return out;
}

/* ---------------------------------------------------------------------------------------- combine transform */
export const TRANSFORM_DRIVERS = ['age', 'id', 'index', 'pscale', 'x', 'y', 'z', 'random', 'noise', 'attribute'] as const;
export type TransformDriver = (typeof TRANSFORM_DRIVERS)[number];
export interface CombineTransformParams {
  driver: TransformDriver;
  attr: string;
  inMin: number;
  inMax: number;
  curve: CurveValue;
  useCurve: boolean;
  /** Translation reached at driver value 1 (world units) and along the point normal. */
  translate: V3;
  alongNormal: number;
  /** Euler degrees reached at driver value 1. */
  rotate: V3;
  /** Scale reached at driver value 1 (lerped from 1). */
  scale: V3;
  applyToPosition: boolean;
  seed: number;
  noise: NoiseSource;
}
export const defaultCombineTransformParams = (): CombineTransformParams => ({
  driver: 'age', attr: 'age', inMin: 0, inMax: 1, curve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, useCurve: false, translate: [0, 0, 0], alongNormal: 0, rotate: [0, 0, 0], scale: [1, 1, 1], applyToPosition: true, seed: 1,
  noise: { kind: 'perlin', frequency: 2, octaves: 2, seed: 1, t: 0, loopCycles: 0 },
});

export function combineTransform(src: MeshData, p: CombineTransformParams): MeshData {
  const n = src.pointCount;
  const P0 = src.positions;
  const out = src.clone();
  const drv = p.driver === 'attribute' ? pointAttr(src, p.attr) : p.driver === 'id' ? pointAttr(src, STD.id) : p.driver === 'pscale' ? pointAttr(src, STD.pscale) : p.driver === 'age' ? pointAttr(src, STD.age) : null;
  if (p.driver === 'attribute' && !drv) throw new Error(`Combine Transform: no attribute "${p.attr}"`);
  const N = p.alongNormal !== 0 ? (src.attr('point', STD.N)?.data ?? pointAttr(src, STD.N)?.data ?? null) : null;
  const span = p.inMax === p.inMin ? 1 : p.inMax - p.inMin;
  const wantRot = p.rotate[0] !== 0 || p.rotate[1] !== 0 || p.rotate[2] !== 0;
  const wantScale = p.scale[0] !== 1 || p.scale[1] !== 1 || p.scale[2] !== 1;
  const P = p.applyToPosition ? (out.writable('point', STD.P) as Float32Array) : null;
  const Q = wantRot ? (out.has('point', STD.orient) ? (out.writable('point', STD.orient) as Float32Array) : (() => {
    const d = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) d[i * 4 + 3] = 1;
    out.setAttr({ name: STD.orient, element: 'point', size: 4, kind: 'f32', data: d });
    return d;
  })()) : null;
  const S = wantScale ? (out.has('point', STD.scale) ? (out.writable('point', STD.scale) as Float32Array) : (() => {
    const d = new Float32Array(n * 3).fill(1);
    out.setAttr({ name: STD.scale, element: 'point', size: 3, kind: 'f32', data: d });
    return d;
  })()) : null;
  for (let i = 0; i < n; i++) {
    let x: number;
    switch (p.driver) {
      case 'index': x = i / Math.max(1, n - 1); break;
      case 'x': x = P0[i * 3]; break;
      case 'y': x = P0[i * 3 + 1]; break;
      case 'z': x = P0[i * 3 + 2]; break;
      case 'random': x = hash01(p.seed, i); break;
      case 'noise': x = noise01(P0[i * 3], P0[i * 3 + 1], P0[i * 3 + 2], p.noise); break;
      default: x = drv ? drv.data[i * drv.size] : i / Math.max(1, n - 1);
    }
    let v = clamp01((x - p.inMin) / span);
    if (p.useCurve) v = evalCurve(p.curve, v);
    if (P) {
      P[i * 3] += p.translate[0] * v + (N ? N[i * 3] * p.alongNormal * v : 0);
      P[i * 3 + 1] += p.translate[1] * v + (N ? N[i * 3 + 1] * p.alongNormal * v : 0);
      P[i * 3 + 2] += p.translate[2] * v + (N ? N[i * 3 + 2] * p.alongNormal * v : 0);
    }
    if (Q) {
      const d = quatFromEulerDeg(p.rotate[0] * v, p.rotate[1] * v, p.rotate[2] * v);
      const r = quatNormalize(quatMul([Q[i * 4], Q[i * 4 + 1], Q[i * 4 + 2], Q[i * 4 + 3]], d));
      Q.set(r, i * 4);
    }
    if (S) for (let c = 0; c < 3; c++) S[i * 3 + c] *= 1 + (p.scale[c] - 1) * v;
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- extract points */
export const EXTRACT_MODES = ['points', 'vertices', 'primitives', 'islands'] as const;
export type ExtractMode = (typeof EXTRACT_MODES)[number];
export interface ExtractParams {
  mode: ExtractMode;
  islandCenter: 'centroid' | 'bounds' | 'base';
  /** Keep every n-th element. */
  stride: number;
  maxPoints: number;
  pscaleFrom: 'none' | 'size';
  orientFromNormal: boolean;
  keepAttributes: boolean;
}
export const defaultExtractParams = (): ExtractParams => ({ mode: 'points', islandCenter: 'bounds', stride: 1, maxPoints: 1_000_000, pscaleFrom: 'none', orientFromNormal: true, keepAttributes: true });

interface Grouped {
  count: number;
  /** For each output point the source element indices (points / vertices / primitives). */
  lists: number[][];
}

/** Mesh -> points. See ExtractParams. Output: P, N, orient, pscale, id, age, Cd, uv ... plus every kept attribute. */
export function extractPoints(src: MeshData, p: ExtractParams): MeshData {
  const stride = Math.max(1, Math.round(p.stride));
  const maxPts = Math.max(1, Math.round(p.maxPoints));
  const kinds = new Map<string, { kind: AttrKind; size: 1 | 2 | 3 | 4 }>();
  for (const a of src.list()) if (a.element !== 'detail' && !kinds.has(a.name) && a.size <= 4) kinds.set(a.name, { kind: a.kind, size: a.size });
  kinds.delete(STD.P);
  kinds.delete(STD.island);
  const P = src.positions;
  const vp = src.topology.vertPoint;
  const ps = src.topology.primStart;

  // ---- fast path: points (decimation only) -------------------------------------------------------------
  if (p.mode === 'points' || src.primCount === 0) {
    const idx: number[] = [];
    for (let i = 0; i < src.pointCount && idx.length < maxPts; i += stride) idx.push(i);
    checkMeshLimits(idx.length, 0, 0, 'Extract Points');
    const out = new MeshData(idx.length);
    const pos = new Float32Array(idx.length * 3);
    idx.forEach((s, j) => pos.set(P.subarray(s * 3, s * 3 + 3), j * 3));
    out.setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: pos });
    if (p.keepAttributes) {
      for (const [name, info] of kinds) {
        const a = pointAttr(src, name);
        if (!a) continue;
        const d: AttrData = info.kind === 'f32' ? new Float32Array(idx.length * info.size) : new Int32Array(idx.length * info.size);
        idx.forEach((s, j) => { for (let c = 0; c < info.size; c++) d[j * info.size + c] = a.data[s * a.size + c]; });
        out.setAttr({ name, element: 'point', size: info.size, kind: info.kind, data: d });
      }
    }
    finish(out, src, p, idx.map((s) => [s]), 'points');
    return out;
  }

  // ---- grouped modes ------------------------------------------------------------------------------------
  const g: Grouped = { count: 0, lists: [] };
  let getter: (name: string) => { data: AttrData; size: number } | null;
  const take = (l: number[]): void => {
    if (g.count % stride === 0 && g.lists.length < maxPts) g.lists.push(l);
    g.count++;
  };
  if (p.mode === 'vertices') {
    checkMeshLimits(src.vertexCount / stride, 0, 0, 'Extract Points');
    for (let v = 0; v < src.vertexCount; v++) take([v]);
    getter = (name) => src.resolveToVertex(name);
  } else if (p.mode === 'primitives') {
    for (let q = 0; q < src.primCount; q++) take([q]);
    getter = (name) => {
      const a = src.attr('primitive', name);
      if (a) return { data: a.data, size: a.size };
      for (const el of ['point', 'vertex'] as Element[]) if (src.has(el, name)) { const r = promoteAttr(src, name, el, 'primitive', 'average', true).attr('primitive', name)!; return { data: r.data, size: r.size }; }
      return null;
    };
  } else {
    const isl = primIslands(src);
    const lists: number[][] = Array.from({ length: isl.count }, () => []);
    for (let q = 0; q < src.primCount; q++) if (isl.ids[q] >= 0) lists[isl.ids[q]].push(q);
    for (const l of lists) take(l);
    getter = (name) => {
      const a = src.attr('primitive', name);
      if (a) return { data: a.data, size: a.size };
      for (const el of ['point', 'vertex'] as Element[]) if (src.has(el, name)) { const r = promoteAttr(src, name, el, 'primitive', 'average', true).attr('primitive', name)!; return { data: r.data, size: r.size }; }
      return null;
    };
  }
  const nOut = g.lists.length;
  checkMeshLimits(nOut, 0, 0, 'Extract Points');
  const out = new MeshData(nOut);
  const pos = new Float32Array(nOut * 3);
  const sizes = new Float32Array(nOut);
  const nrm = new Float32Array(nOut * 3);
  // helper: the points of one output group
  const ptsOf = (l: number[], f: (pt: number) => void): void => {
    if (p.mode === 'vertices') for (const v of l) f(vp[v]);
    else for (const q of l) for (let k = ps[q]; k < ps[q + 1]; k++) f(vp[k]);
  };
  for (let j = 0; j < nOut; j++) {
    const l = g.lists[j];
    let cx = 0, cy = 0, cz = 0, cnt = 0, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    ptsOf(l, (pt) => {
      const x = P[pt * 3], y = P[pt * 3 + 1], z = P[pt * 3 + 2];
      cx += x; cy += y; cz += z; cnt++;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); z0 = Math.min(z0, z); x1 = Math.max(x1, x); y1 = Math.max(y1, y); z1 = Math.max(z1, z);
    });
    if (cnt === 0) continue;
    let c: V3 = [cx / cnt, cy / cnt, cz / cnt];
    if (p.mode === 'islands' && p.islandCenter !== 'centroid') c = p.islandCenter === 'bounds' ? [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] : [(x0 + x1) / 2, (y0 + y1) / 2, z0];
    pos.set(c, j * 3);
    sizes[j] = Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2;
    // normal: sum of face normals (area weighted) of the primitives involved
    if (p.mode !== 'vertices') {
      let nx = 0, ny = 0, nz = 0;
      for (const q of l) {
        for (let k = ps[q]; k < ps[q + 1]; k++) {
          const a = vp[k] * 3, b = vp[k + 1 < ps[q + 1] ? k + 1 : ps[q]] * 3;
          nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
          ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
          nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
        }
      }
      const ln = Math.hypot(nx, ny, nz) || 1;
      nrm.set([nx / ln, ny / ln, nz / ln], j * 3);
      if (p.mode === 'primitives') sizes[j] = Math.sqrt(Math.hypot(nx, ny, nz) / 2);
    }
  }
  out.setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: pos });
  if (p.keepAttributes) {
    for (const [name, info] of kinds) {
      if (name === STD.N && p.mode !== 'vertices') continue;
      const a = getter(name);
      if (!a) continue;
      const d: AttrData = info.kind === 'f32' ? new Float32Array(nOut * info.size) : new Int32Array(nOut * info.size);
      for (let j = 0; j < nOut; j++) {
        const l = g.lists[j];
        for (let c = 0; c < info.size; c++) {
          if (info.kind === 'i32') d[j * info.size + c] = a.data[l[0] * a.size + c];
          else {
            let s = 0;
            for (const e of l) s += a.data[e * a.size + c];
            d[j * info.size + c] = s / l.length;
          }
        }
      }
      out.setAttr({ name, element: 'point', size: info.size, kind: info.kind, data: d });
    }
  }
  if (p.mode !== 'vertices') out.setAttr({ name: STD.N, element: 'point', size: 3, kind: 'f32', data: nrm });
  else if (!out.has('point', STD.N)) out.setAttr({ name: STD.N, element: 'point', size: 3, kind: 'f32', data: nrm });
  if (p.mode === 'islands') {
    const idd = new Int32Array(nOut);
    g.lists.forEach((_, j) => (idd[j] = j * stride));
    out.setAttr({ name: STD.id, element: 'point', size: 1, kind: 'i32', data: idd });
    const age = new Float32Array(nOut);
    for (let j = 0; j < nOut; j++) age[j] = nOut > 1 ? j / (nOut - 1) : 0;
    out.setAttr({ name: STD.age, element: 'point', size: 1, kind: 'f32', data: age });
  }
  if (p.pscaleFrom === 'size') {
    const d = new Float32Array(nOut);
    for (let j = 0; j < nOut; j++) d[j] = Math.max(1e-6, sizes[j]);
    out.setAttr({ name: STD.pscale, element: 'point', size: 1, kind: 'f32', data: d });
  }
  finish(out, src, p, g.lists, p.mode);
  return out;
}

/** Common post steps: id default, orient from N. */
function finish(out: MeshData, _src: MeshData, p: ExtractParams, lists: number[][], mode: ExtractMode): void {
  const n = out.pointCount;
  if (!out.has('point', STD.id)) {
    const d = new Int32Array(n);
    for (let i = 0; i < n; i++) d[i] = mode === 'points' ? lists[i][0] : i;
    out.setAttr({ name: STD.id, element: 'point', size: 1, kind: 'i32', data: d });
  }
  if (p.orientFromNormal && !out.has('point', STD.orient)) {
    const N = out.attr('point', STD.N);
    if (N && N.size === 3) {
      const q = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) q.set(orientFromNormal([N.data[i * 3], N.data[i * 3 + 1], N.data[i * 3 + 2]]), i * 4);
      out.setAttr({ name: STD.orient, element: 'point', size: 4, kind: 'f32', data: q });
    }
  }
}


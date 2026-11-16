/**
 * Particle attribute math. PURE CPU (typed arrays), unit-tested; used by the Point Attributes node and by the 2D
 * Render node's packer.
 *
 * Looping contract: everything that moves is a function of the LOOP PHASE (0..1), never of absolute time, and every periodic
 * ingredient is made integer-periodic: travel wraps inside a box (optionally snapped to whole box sizes), lifetimes complete an
 * integer number of cycles per loop, noise drift uses the periodic 4th lattice axis (perlin4 with `period`), spin is a whole
 * number of turns. Result: phase 0 == phase 1 exactly => seamless flipbooks.
 */
import { evalCurve, evalGradient } from '../params/curve';
import type { CurveValue, GradientValue } from '../params/schema';
import { hash01 } from '../mesh/attrs';
import { checkMeshLimits, MeshData, STD } from '../mesh/mesh';
import { perlin4 } from '../mesh/noise3';

type V3 = [number, number, number];
type RGBA = [number, number, number, number];

export interface PointAttrParams {
  /** Used when there is no input: number of points created inside the emission box. */
  count: number;
  seed: number;
  boxCenter: V3;
  boxSize: V3;
  /** 0..1 position in the loop. */
  phase: number;
  /** Displacement over one full loop (world units). */
  travel: V3;
  /** Wrap positions inside the emission box (needed for endless flow). */
  wrap: boolean;
  /** With wrap: round the travel of every axis to a whole number of box sizes so the loop is exactly periodic. */
  snapTravel: boolean;
  driftAmount: number;
  driftFreq: number;
  /** Noise cycles per loop (integer => exact loop). */
  driftCycles: number;
  /** Lifetimes per loop (0 = do not write `age`). */
  lifeCycles: number;
  /** 0..1: how much the starting age is randomised per particle. */
  ageRandom: number;
  size: number;
  sizeRandom: number;
  sizeCurve: CurveValue | null;
  rotation: number;
  rotationRandom: number;
  /** Turns per loop (integer => seamless). */
  spinTurns: number;
  color: RGBA;
  gradient: GradientValue | null;
  /** Gradient uses the particle age (otherwise a constant colour). */
  maxPoints: number;
}

export const defaultPointAttrParams = (): PointAttrParams => ({
  count: 64,
  seed: 1,
  boxCenter: [0, 0, 0],
  boxSize: [1, 1, 0],
  phase: 0,
  travel: [0, 0.5, 0],
  wrap: true,
  snapTravel: true,
  driftAmount: 0.05,
  driftFreq: 2,
  driftCycles: 1,
  lifeCycles: 1,
  ageRandom: 1,
  size: 0.06,
  sizeRandom: 0.5,
  sizeCurve: null,
  rotation: 0,
  rotationRandom: 0,
  spinTurns: 0,
  color: [1, 1, 1, 1],
  gradient: null,
  maxPoints: 500_000,
});

const fract = (x: number): number => x - Math.floor(x);
/** Wrap `x` into [center - size/2, center + size/2). */
export function wrapAxis(x: number, center: number, size: number): number {
  if (size <= 1e-9) return x;
  const h = size / 2;
  return center - h + ((((x - center + h) % size) + size) % size);
}
/** Round a per-loop travel to a whole number of box sizes (keeps the direction, never 0 for a non-zero travel). */
export function snapTravelAxis(travel: number, size: number): number {
  if (size <= 1e-9 || travel === 0) return travel;
  const n = Math.round(travel / size);
  return (n === 0 ? Math.sign(travel) : n) * size;
}

const unitQuat = (zAngle: number): [number, number, number, number] => [0, 0, Math.sin(zAngle / 2), Math.cos(zAngle / 2)];

/** Create (no input) or modify (input points) the particle attributes for the given loop phase. */
export function pointAttributes(src: MeshData | null, p: PointAttrParams): MeshData {
  let out: MeshData;
  let P0: Float32Array;
  let n: number;
  if (src) {
    n = src.pointCount;
    checkMeshLimits(n, 0, 0, 'Point Attributes');
    out = src.clone();
    P0 = src.positions;
  } else {
    n = Math.max(0, Math.min(Math.round(p.count), p.maxPoints));
    checkMeshLimits(n, 0, 0, 'Point Attributes');
    out = new MeshData(n);
    P0 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      P0[i * 3] = p.boxCenter[0] + (hash01(p.seed, i * 3) - 0.5) * p.boxSize[0];
      P0[i * 3 + 1] = p.boxCenter[1] + (hash01(p.seed, i * 3 + 1) - 0.5) * p.boxSize[1];
      P0[i * 3 + 2] = p.boxCenter[2] + (hash01(p.seed, i * 3 + 2) - 0.5) * p.boxSize[2];
    }
  }
  const phase = p.phase - Math.floor(p.phase);
  const travel: V3 = [0, 1, 2].map((a) => (p.wrap && p.snapTravel ? snapTravelAxis(p.travel[a], p.boxSize[a]) : p.travel[a])) as V3;
  const cyc = Math.max(1, Math.round(p.driftCycles));
  const drift = (i: number, ph: number, k: 0 | 1 | 2): number => {
    if (p.driftAmount === 0) return 0;
    const x = P0[i * 3] * p.driftFreq;
    const y = P0[i * 3 + 1] * p.driftFreq;
    const z = P0[i * 3 + 2] * p.driftFreq;
    return perlin4(x + k * 17.3, y + k * 5.1, z, ph * cyc, p.seed + k * 101, cyc) * p.driftAmount * 2;
  };
  /** Unwrapped displacement at a phase. */
  const disp = (i: number, ph: number, k: 0 | 1 | 2): number => travel[k] * ph + drift(i, ph, k);

  const P = new Float32Array(n * 3);
  const Vel = new Float32Array(n * 3);
  const eps = 1 / 256;
  for (let i = 0; i < n; i++) {
    for (const k of [0, 1, 2] as const) {
      const raw = P0[i * 3 + k] + disp(i, phase, k);
      P[i * 3 + k] = p.wrap ? wrapAxis(raw, p.boxCenter[k], p.boxSize[k]) : raw;
      // per-loop velocity (world units per loop) by central differences over the periodic motion
      Vel[i * 3 + k] = (disp(i, phase + eps, k) - disp(i, phase - eps, k)) / (2 * eps);
    }
  }
  out.setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: P });
  out.setAttr({ name: 'v', element: 'point', size: 3, kind: 'f32', data: Vel });

  // age
  const age = new Float32Array(n);
  const cycles = Math.max(0, Math.round(p.lifeCycles));
  if (cycles > 0) for (let i = 0; i < n; i++) age[i] = fract(hash01(p.seed + 7, i) * p.ageRandom + phase * cycles);
  else for (let i = 0; i < n; i++) age[i] = phase;
  out.setAttr({ name: STD.age, element: 'point', size: 1, kind: 'f32', data: age });

  // id
  if (!out.has('point', STD.id)) {
    const id = new Int32Array(n);
    for (let i = 0; i < n; i++) id[i] = i;
    out.setAttr({ name: STD.id, element: 'point', size: 1, kind: 'i32', data: id });
  }

  // size / rotation
  const ps = new Float32Array(n);
  const rot = new Float32Array(n);
  const Q = new Float32Array(n * 4);
  const spin = p.spinTurns * Math.PI * 2 * phase;
  for (let i = 0; i < n; i++) {
    const r = (hash01(p.seed + 11, i) - 0.5) * 2;
    let s = p.size * (1 + r * p.sizeRandom);
    if (p.sizeCurve) s *= evalCurve(p.sizeCurve, age[i]);
    ps[i] = Math.max(0, s);
    const a = (p.rotation * Math.PI) / 180 + (hash01(p.seed + 13, i) - 0.5) * 2 * Math.PI * p.rotationRandom + spin * (hash01(p.seed + 17, i) > 0.5 ? 1 : p.spinTurns < 0 ? 1 : 1);
    rot[i] = a;
    Q.set(unitQuat(a), i * 4);
  }
  out.setAttr({ name: STD.pscale, element: 'point', size: 1, kind: 'f32', data: ps });
  out.setAttr({ name: 'rot', element: 'point', size: 1, kind: 'f32', data: rot });
  out.setAttr({ name: STD.orient, element: 'point', size: 4, kind: 'f32', data: Q });

  // colour
  const Cd = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const g = p.gradient ? evalGradient(p.gradient, Math.min(1, Math.max(0, age[i]))) : [1, 1, 1, 1];
    Cd[i * 4] = p.color[0] * g[0];
    Cd[i * 4 + 1] = p.color[1] * g[1];
    Cd[i * 4 + 2] = p.color[2] * g[2];
    Cd[i * 4 + 3] = p.color[3] * g[3];
  }
  out.setAttr({ name: STD.Cd, element: 'point', size: 4, kind: 'f32', data: Cd });
  return out;
}

/* ------------------------------------------------------------------------------------------------ 2D render packing */

/** Floats per packed particle record (matches render_2d/shader.wgsl STRIDE). */
export const PARTICLE_STRIDE = 12;

export interface PackOptions {
  plane: 'xy' | 'xz' | 'yz';
  /** World coordinates (on the plane) of the image centre. */
  center: [number, number];
  /** World width covered by the image (height follows the aspect). */
  extent: number;
  /** Image width / height in pixels (aspect). */
  aspect: number;
  /** Multiplier on pscale. */
  sizeScale: number;
  maxCount: number;
  /** draw order. 'none' = point order (default, old behaviour); 'oldest_first' paints old particles first (young on top: alpha blending of smoke). */
  sort?: 'none' | 'oldest_first' | 'youngest_first';
}
export interface Packed {
  data: Float32Array;
  count: number;
  truncated: boolean;
}

/** Pack points into GPU records: [u, v, sizeU, rot, r,g,b,a, age, id, vu, vv] with uv in image space (v down). */
export function packParticles(m: MeshData, o: PackOptions): Packed {
  const total = m.pointCount;
  const count = Math.min(total, Math.max(0, Math.floor(o.maxCount)));
  const data = new Float32Array(count * PARTICLE_STRIDE);
  const P = m.positions;
  const ps = m.attr('point', STD.pscale)?.data;
  const rot = m.attr('point', 'rot')?.data;
  const q = m.attr('point', STD.orient)?.data;
  const cd = m.attr('point', STD.Cd);
  const age = m.attr('point', STD.age)?.data;
  const id = m.attr('point', STD.id)?.data;
  const v = m.attr('point', 'v')?.data;
  const ax = o.plane === 'yz' ? 1 : 0;
  const ay = o.plane === 'xy' ? 1 : 2;
  const ext = Math.max(1e-9, o.extent);
  const hInv = 1 / Math.max(1e-9, o.aspect); // height / width
  // Draw order: the first `count` records are written in the requested age order; stable for equal ages.
  let order: Uint32Array | null = null;
  if (o.sort && o.sort !== 'none' && age && count > 1) {
    const idx = Array.from({ length: Math.min(total, count) }, (_, k) => k);
    const sgn = o.sort === 'oldest_first' ? -1 : 1;
    idx.sort((a, b) => sgn * (age[a] - age[b]) || a - b);
    order = Uint32Array.from(idx);
  }
  for (let j = 0; j < count; j++) {
    const i = order ? order[j] : j;
    const b = j * PARTICLE_STRIDE;
    const a = P[i * 3 + ax];
    const c = P[i * 3 + ay];
    data[b] = (a - o.center[0]) / ext + 0.5;
    data[b + 1] = 0.5 - (c - o.center[1]) / (ext * hInv);
    data[b + 2] = ((ps ? ps[i] : 1) * o.sizeScale) / ext;
    data[b + 3] = rot ? rot[i] : q ? 2 * Math.atan2(q[i * 4 + 2], q[i * 4 + 3]) : 0;
    if (cd && cd.size === 4) data.set(cd.data.subarray(i * 4, i * 4 + 4), b + 4);
    else if (cd && cd.size === 3) data.set([cd.data[i * 3], cd.data[i * 3 + 1], cd.data[i * 3 + 2], 1], b + 4);
    else data.set([1, 1, 1, 1], b + 4);
    data[b + 8] = age ? age[i] : 0;
    data[b + 9] = id ? id[i] : i;
    data[b + 10] = v ? v[i * 3 + ax] / ext : 0;
    data[b + 11] = v ? -v[i * 3 + ay] / (ext * hInv) : 0;
  }
  return { data, count, truncated: count < total };
}

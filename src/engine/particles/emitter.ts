/**
 * Particle EMITTER math. PURE CPU (typed arrays), closed-form: any frame is evaluated directly from the loop phase, there is NO
 * simulation from frame 0. Cost = O(count) per evaluation.
 *
 *   birth offset o_i   one-shot: hash * min(spawnWindow, 1 - lifetime)  (everything is dead by phase 1 -> the last frame is empty)
 *                      loop:     hash                                   (births spread over the loop)
 *   age (0..1)         one-shot: (phase - o_i) / lifetime, particle dropped outside [0, 1]
 *                      loop:     fract(C * phase + o_i) with C = round(1 / lifetime) lifetimes per loop => exactly periodic in phase
 *   randomness         per particle AND per cycle (cycle index taken modulo C, so phase 0 == phase 1 stays exact)
 *   position(t)        x0 + v0 (1 - e^{-kt}) / k + (g / k) (t - (1 - e^{-kt}) / k) + turbulence(x0, age)   (drag k, gravity g; k -> 0 limit handled)
 *   velocity           central difference of position(t) (world units per loop)
 * Attributes written (same contract as Point Attributes, so 2D Render / Copy To Points work unchanged): P, v, age, id, pscale, rot, orient, Cd.
 */
import { evalCurve, evalGradient } from '../params/curve';
import type { CurveValue, GradientValue } from '../params/schema';
import { hash01 } from '../mesh/attrs';
import { checkMeshLimits, MeshData, STD } from '../mesh/mesh';
import { perlin4 } from '../mesh/noise3';

type V3 = [number, number, number];
type RGBA = [number, number, number, number];

export type EmitterShape = 'point' | 'disc' | 'ring' | 'box' | 'line';
export type EmitterPlane = 'xy' | 'xz' | 'yz';

export interface EmitterParams {
  mode: 'loop' | 'oneshot';
  count: number;
  seed: number;
  /** 0..1 loop phase. */
  phase: number;
  /** Fraction of the loop a particle lives. */
  lifetime: number;
  /** One-shot: births are spread over this fraction of the loop (0 = one burst at phase 0). */
  spawnWindow: number;
  shape: EmitterShape;
  plane: EmitterPlane;
  center: V3;
  size: V3;
  /** Degrees in the plane (0 = first plane axis). */
  direction: number;
  /** Cone angle in degrees (360 = all directions). */
  cone: number;
  /** Emit away from the emitter centre instead of along `direction`. */
  outward: boolean;
  /** World units per loop. */
  speed: number;
  speedRandom: number;
  /** World units per loop^2. */
  gravity: V3;
  /** Drag k (1/loop). */
  drag: number;
  turbulence: number;
  turbulenceFreq: number;
  pointSize: number;
  sizeRandom: number;
  sizeCurve: CurveValue | null;
  rotation: number;
  rotationRandom: number;
  spinTurns: number;
  color: RGBA;
  intensity: number;
  gradient: GradientValue | null;
  alphaCurve: CurveValue | null;
  maxPoints: number;
}

export const defaultEmitterParams = (): EmitterParams => ({
  mode: 'oneshot',
  count: 64,
  seed: 1,
  phase: 0,
  lifetime: 0.6,
  spawnWindow: 0.2,
  shape: 'point',
  plane: 'xy',
  center: [0, 0, 0],
  size: [0.2, 0.2, 0],
  direction: 90,
  cone: 360,
  outward: false,
  speed: 0.5,
  speedRandom: 0.5,
  gravity: [0, -0.5, 0],
  drag: 1,
  turbulence: 0,
  turbulenceFreq: 2,
  pointSize: 0.03,
  sizeRandom: 0.4,
  sizeCurve: null,
  rotation: 0,
  rotationRandom: 0,
  spinTurns: 0,
  color: [1, 1, 1, 1],
  intensity: 1,
  gradient: null,
  alphaCurve: null,
  maxPoints: 200_000,
});

const fract = (x: number): number => x - Math.floor(x);

/** Displacement caused by constant initial velocity `v0`, constant acceleration `g` and linear drag `k` after time `t` (loop units). */
export function ballistic(v0: number, g: number, k: number, t: number): number {
  if (k < 1e-4) return v0 * t + 0.5 * g * t * t; // k -> 0: free flight
  const e = 1 - Math.exp(-k * t);
  return (v0 * e) / k + (g / k) * (t - e / k);
}

/** Closed-form state of one particle (exported for tests). Returns null when the particle is not alive. */
export function particleAge(p: Pick<EmitterParams, 'mode' | 'phase' | 'lifetime' | 'spawnWindow'>, offset01: number): { age: number; cycle: number; cycles: number } | null {
  const life = Math.min(1, Math.max(0.01, p.lifetime));
  const phase = fract(p.phase);
  if (p.mode === 'loop') {
    const cycles = Math.max(1, Math.round(1 / life));
    const x = cycles * phase + offset01;
    const cycle = ((Math.floor(x) % cycles) + cycles) % cycles;
    return { age: fract(x), cycle, cycles };
  }
  const win = Math.max(0, Math.min(p.spawnWindow, 1 - life));
  const born = offset01 * win;
  const age = (phase - born) / life;
  if (age < 0 || age > 1) return null;
  return { age, cycle: 0, cycles: 1 };
}

export function emitParticles(src: MeshData | null, p: EmitterParams): MeshData {
  const life = Math.min(1, Math.max(0.01, p.lifetime));
  const total = src ? src.pointCount : Math.max(0, Math.min(Math.round(p.count), p.maxPoints));
  checkMeshLimits(total, 0, 0, 'Emitter');
  const ax = p.plane === 'yz' ? 1 : 0;
  const ay = p.plane === 'xy' ? 1 : 2;
  const az = 3 - ax - ay;

  const keep: number[] = [];
  const ages: number[] = [];
  const cyc: number[] = [];
  for (let i = 0; i < total; i++) {
    const a = particleAge(p, hash01(p.seed + 3, i));
    if (!a) continue;
    keep.push(i);
    ages.push(a.age);
    cyc.push(a.cycle);
  }
  const n = keep.length;
  const out = new MeshData(n);
  const P = new Float32Array(n * 3);
  const Vel = new Float32Array(n * 3);
  const age = Float32Array.from(ages);
  const ids = new Int32Array(n);
  const ps = new Float32Array(n);
  const rot = new Float32Array(n);
  const Q = new Float32Array(n * 4);
  const Cd = new Float32Array(n * 4);

  for (let j = 0; j < n; j++) {
    const i = keep[j];
    const s = p.seed * 131 + cyc[j] * 7919;
    const r = (k: number): number => hash01(s + k, i);
    // emission point (in the plane axes ax / ay; the third axis stays at the centre)
    const x0: V3 = [p.center[0], p.center[1], p.center[2]];
    if (src) {
      x0[0] = src.positions[i * 3];
      x0[1] = src.positions[i * 3 + 1];
      x0[2] = src.positions[i * 3 + 2];
    } else if (p.shape === 'disc') {
      const rr = Math.sqrt(r(1));
      const th = r(2) * Math.PI * 2;
      x0[ax] += Math.cos(th) * rr * p.size[ax] * 0.5;
      x0[ay] += Math.sin(th) * rr * p.size[ay] * 0.5;
    } else if (p.shape === 'ring') {
      const th = r(2) * Math.PI * 2;
      x0[ax] += Math.cos(th) * p.size[ax] * 0.5;
      x0[ay] += Math.sin(th) * p.size[ay] * 0.5;
    } else if (p.shape === 'box') {
      x0[ax] += (r(1) - 0.5) * p.size[ax];
      x0[ay] += (r(2) - 0.5) * p.size[ay];
      x0[az] += (r(8) - 0.5) * p.size[az];
    } else if (p.shape === 'line') {
      x0[ax] += (r(1) - 0.5) * p.size[ax];
    }
    // initial velocity
    let ang = (p.direction * Math.PI) / 180 + (r(4) - 0.5) * ((p.cone * Math.PI) / 180);
    if (p.outward) ang = Math.atan2(x0[ay] - p.center[ay], x0[ax] - p.center[ax]) + (r(4) - 0.5) * ((p.cone * Math.PI) / 180) * 0.25;
    const sp = p.speed * (1 + (r(5) - 0.5) * 2 * p.speedRandom);
    const v0: V3 = [0, 0, 0];
    v0[ax] = Math.cos(ang) * sp;
    v0[ay] = Math.sin(ang) * sp;
    const turbAxis = (k: 0 | 1 | 2, a: number): number =>
      p.turbulence === 0 ? 0 : perlin4(x0[0] * p.turbulenceFreq + k * 17.3, x0[1] * p.turbulenceFreq + k * 5.1, x0[2] * p.turbulenceFreq + r(6) * 50, a * 2, p.seed + k * 101) * p.turbulence * Math.min(1, a * 3);
    const pos = (a: number, k: 0 | 1 | 2): number => {
      const t = a * life;
      return x0[k] + ballistic(v0[k], p.gravity[k], p.drag, t) + turbAxis(k, a);
    };
    const e = 0.004;
    const a0 = Math.max(0, age[j] - e);
    const a1 = Math.min(1, age[j] + e);
    for (const k of [0, 1, 2] as const) {
      P[j * 3 + k] = pos(age[j], k);
      Vel[j * 3 + k] = (pos(a1, k) - pos(a0, k)) / Math.max(1e-6, (a1 - a0) * life);
    }
    ids[j] = i;
    let sz = p.pointSize * (1 + (r(7) - 0.5) * 2 * p.sizeRandom);
    if (p.sizeCurve) sz *= evalCurve(p.sizeCurve, age[j]);
    ps[j] = Math.max(0, sz);
    const spin = p.spinTurns * Math.PI * 2 * age[j] * (r(9) > 0.5 ? 1 : -1);
    const ra = (p.rotation * Math.PI) / 180 + (r(10) - 0.5) * 2 * Math.PI * p.rotationRandom + spin;
    rot[j] = ra;
    Q.set([0, 0, Math.sin(ra / 2), Math.cos(ra / 2)], j * 4);
    const g = p.gradient ? evalGradient(p.gradient, Math.min(1, Math.max(0, age[j]))) : [1, 1, 1, 1];
    const al = p.alphaCurve ? evalCurve(p.alphaCurve, age[j]) : 1;
    Cd[j * 4] = p.color[0] * g[0] * p.intensity;
    Cd[j * 4 + 1] = p.color[1] * g[1] * p.intensity;
    Cd[j * 4 + 2] = p.color[2] * g[2] * p.intensity;
    Cd[j * 4 + 3] = p.color[3] * g[3] * Math.max(0, al);
  }
  out.setAttr({ name: STD.P, element: 'point', size: 3, kind: 'f32', data: P });
  out.setAttr({ name: 'v', element: 'point', size: 3, kind: 'f32', data: Vel });
  out.setAttr({ name: STD.age, element: 'point', size: 1, kind: 'f32', data: age });
  out.setAttr({ name: STD.id, element: 'point', size: 1, kind: 'i32', data: ids });
  out.setAttr({ name: STD.pscale, element: 'point', size: 1, kind: 'f32', data: ps });
  out.setAttr({ name: 'rot', element: 'point', size: 1, kind: 'f32', data: rot });
  out.setAttr({ name: STD.orient, element: 'point', size: 4, kind: 'f32', data: Q });
  out.setAttr({ name: STD.Cd, element: 'point', size: 4, kind: 'f32', data: Cd });
  return out;
}

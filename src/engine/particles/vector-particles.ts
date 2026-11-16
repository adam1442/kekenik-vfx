/**
 * Vector Particles math. PURE CPU, deterministic, closed form in time: every particle is born at a seeded position and carried
 * along the CURRENT vector field (steady-field pathline, RK1 / RK2 / RK4) for `age * travel` seconds. No state from earlier frames is
 * needed, so scrubbing, loops and exports are exact and a loop of the Emitter life cycle (`particleAge`) repeats seamlessly.
 *
 * Why not the GPU SimulationNode framework: Points are CPU meshes (2D Render, Copy To Points) and the field only exists on the GPU; the
 * field is therefore read once through the async CPU texture snapshot (<= 512 px, never blocking) and the integration runs here.
 * The appearance (size / rotation / colour / alpha over life) is produced by the Emitter's own `emitParticles` so both nodes share it.
 *
 * Space: the field lives in tile space (u right, v DOWN, vectors in tile fractions per second). Output positions use the 2D Render view
 * mapping (`view.extent` world units across the image width, `view.center`, `plane`), so the Points line up with 2D Render.
 */
import { hash01 } from '../mesh/attrs';
import { STD, checkMeshLimits, MeshData } from '../mesh/mesh';
import { defaultEmitterParams, emitParticles, particleAge, type EmitterParams } from './emitter';

export interface VectorField {
  w: number;
  h: number;
  /** Interleaved samples, `channels` >= 2 (x, y). */
  data: ArrayLike<number>;
  channels: number;
  /** Multiplier from stored units to tile fractions per second (1 / vecScale). */
  perSecond: number;
}

export type IntegrationMethod = 'rk1' | 'rk2' | 'rk4';
export type SeedShape = 'random' | 'disc' | 'line' | 'points';
export type BoundsMode = 'wrap' | 'kill' | 'clamp';

/** Bilinear field sample at tile coordinates (texel centres at +0.5), wrap or clamp. Result in tile fractions per second. */
export function sampleField(f: VectorField, u: number, v: number, wrap: boolean, out: [number, number]): void {
  const x = u * f.w - 0.5;
  const y = v * f.h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ix = (i: number): number => (wrap ? ((i % f.w) + f.w) % f.w : Math.min(f.w - 1, Math.max(0, i)));
  const iy = (j: number): number => (wrap ? ((j % f.h) + f.h) % f.h : Math.min(f.h - 1, Math.max(0, j)));
  const xa = ix(x0), xb = ix(x0 + 1), ya = iy(y0), yb = iy(y0 + 1);
  const c = f.channels, d = f.data;
  for (let k = 0; k < 2; k++) {
    const a = d[(ya * f.w + xa) * c + k], b = d[(ya * f.w + xb) * c + k], e = d[(yb * f.w + xa) * c + k], g = d[(yb * f.w + xb) * c + k];
    out[k] = ((a + (b - a) * fx) * (1 - fy) + (e + (g - e) * fx) * fy) * f.perSecond;
  }
}

export interface PathOptions {
  method: IntegrationMethod;
  /** Preferred integration step in seconds. */
  stepSize: number;
  /** Hard cap of steps of one path (the step grows instead). */
  maxSteps: number;
  wrap: boolean;
  bounds: BoundsMode;
  /** Velocity multiplier. */
  speed: number;
}

/** Integrates one path from (u, v) for `seconds`; returns the end point, the end velocity and whether it left the tile (kill mode). */
export function integratePath(f: VectorField | null, u0: number, v0: number, seconds: number, o: PathOptions): { u: number; v: number; vx: number; vy: number; dead: boolean } {
  let u = u0, v = v0, dead = false;
  const s: [number, number] = [0, 0];
  const vel = (pu: number, pv: number): [number, number] => {
    if (!f) return [0, 0];
    sampleField(f, pu, pv, o.bounds === 'wrap', s);
    return [s[0] * o.speed, s[1] * o.speed];
  };
  const n = f && seconds > 0 ? Math.max(1, Math.min(Math.max(1, Math.round(o.maxSteps)), Math.ceil(Math.abs(seconds) / Math.max(1e-4, o.stepSize)))) : 0;
  const h = n ? seconds / n : 0;
  for (let i = 0; i < n; i++) {
    const k1 = vel(u, v);
    let dx = k1[0], dy = k1[1];
    if (o.method === 'rk2') {
      const k2 = vel(u + k1[0] * h * 0.5, v + k1[1] * h * 0.5);
      dx = k2[0];
      dy = k2[1];
    } else if (o.method === 'rk4') {
      const k2 = vel(u + k1[0] * h * 0.5, v + k1[1] * h * 0.5);
      const k3 = vel(u + k2[0] * h * 0.5, v + k2[1] * h * 0.5);
      const k4 = vel(u + k3[0] * h, v + k3[1] * h);
      dx = (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6;
      dy = (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6;
    }
    u += dx * h;
    v += dy * h;
    if (o.bounds === 'wrap') {
      u -= Math.floor(u);
      v -= Math.floor(v);
    } else if (u < 0 || u > 1 || v < 0 || v > 1) {
      if (o.bounds === 'kill') {
        dead = true;
        break;
      }
      u = Math.min(1, Math.max(0, u));
      v = Math.min(1, Math.max(0, v));
    }
  }
  const e = vel(u, v);
  return { u, v, vx: e[0], vy: e[1], dead };
}

export interface ViewMapping {
  plane: 'xy' | 'xz' | 'yz';
  center: [number, number];
  /** World units across the image width. */
  extent: number;
  /** Image width / height. */
  aspect: number;
}
const axes = (plane: ViewMapping['plane']): [number, number, number] => {
  const ax = plane === 'yz' ? 1 : 0;
  const ay = plane === 'xy' ? 1 : 2;
  return [ax, ay, 3 - ax - ay];
};
/** Tile (u, v down) -> world, the inverse of the 2D Render packing. */
export function uvToWorld(u: number, v: number, m: ViewMapping): [number, number] {
  return [(u - 0.5) * m.extent + m.center[0], (0.5 - v) * (m.extent / m.aspect) + m.center[1]];
}
export function worldToUv(a: number, c: number, m: ViewMapping): [number, number] {
  return [(a - m.center[0]) / m.extent + 0.5, 0.5 - (c - m.center[1]) / (m.extent / m.aspect)];
}

export interface VectorParticleParams {
  emitter: EmitterParams;
  field: VectorField | null;
  seedShape: SeedShape;
  /** Seed region: `a` (disc centre / line start), `b` (line end), `radius` (disc, fraction of the smaller side), tile space. */
  a: [number, number];
  b: [number, number];
  radius: number;
  /** Seconds of flow carried over one whole particle life. */
  travel: number;
  speed: number;
  /** Per-particle random speed variation 0..1. */
  speedRandom: number;
  method: IntegrationMethod;
  stepSize: number;
  /** Hard cap on steps of one path AND on the total work (count x steps). */
  maxSteps: number;
  bounds: BoundsMode;
  view: ViewMapping;
}
export const MAX_TOTAL_STEPS = 16_000_000;

/** Seed position (tile space) of particle `i` in life cycle `cycle`. */
export function seedPosition(p: Pick<VectorParticleParams, 'seedShape' | 'a' | 'b' | 'radius' | 'view'>, hseed: number, i: number, src: MeshData | null): [number, number] {
  const r = (k: number): number => hash01(hseed + k, i);
  if (src && p.seedShape === 'points') {
    const pa = src.attr('point', STD.P)?.data;
    if (pa) {
      const [ax, ay] = axes(p.view.plane);
      return worldToUv(pa[i * 3 + ax], pa[i * 3 + ay], p.view);
    }
  }
  if (p.seedShape === 'disc') {
    const rr = Math.sqrt(r(1)) * p.radius;
    const th = r(2) * Math.PI * 2;
    return [p.a[0] + Math.cos(th) * rr * Math.min(1, 1 / p.view.aspect), p.a[1] + Math.sin(th) * rr * Math.min(1, p.view.aspect)];
  }
  if (p.seedShape === 'line') {
    const t = r(1);
    return [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t];
  }
  return [r(1), r(2)];
}

/** Advects the particles; returns a Points mesh with the Emitter attribute contract (P, v, age, id, pscale, rot, orient, Cd). */
export function advectParticles(p: VectorParticleParams, src: MeshData | null): MeshData {
  const e = p.emitter;
  const total = src && p.seedShape === 'points' ? Math.min(src.pointCount, e.maxPoints) : Math.max(0, Math.min(Math.round(e.count), e.maxPoints));
  checkMeshLimits(total, 0, 0, 'Vector Particles');
  const [ax, ay, az] = axes(p.view.plane);
  const life = Math.min(1, Math.max(0.01, e.lifetime));
  // memory / time guard: the total number of field samples is bounded
  const maxSteps = Math.max(2, Math.min(Math.round(p.maxSteps), Math.floor(MAX_TOTAL_STEPS / Math.max(1, total) / (p.method === 'rk4' ? 4 : p.method === 'rk2' ? 2 : 1))));
  const path = { method: p.method, stepSize: p.stepSize, maxSteps, wrap: p.bounds === 'wrap', bounds: p.bounds, speed: p.speed };
  const pos = new Float32Array(total * 3);
  const vel = new Float32Array(total * 3);
  const dead = new Uint8Array(total);
  const hs = e.seed * 131;
  for (let i = 0; i < total; i++) {
    const a = particleAge(e, hash01(e.seed + 3, i));
    pos[i * 3 + az] = e.center[az];
    if (!a) continue;
    const s = hs + a.cycle * 7919;
    const [u0, v0] = seedPosition(p, s, i, src);
    const sp = 1 + (hash01(s + 5, i) - 0.5) * 2 * p.speedRandom;
    const end = integratePath(p.field, u0, v0, a.age * p.travel, { ...path, speed: p.speed * sp });
    const w = uvToWorld(end.u, end.v, p.view);
    pos[i * 3 + ax] = w[0];
    pos[i * 3 + ay] = w[1];
    // world units per loop: field velocity (tile / s) x travel seconds per life / life (fraction of the loop)
    const k = (p.travel * sp) / life;
    vel[i * 3 + ax] = end.vx * p.view.extent * k;
    vel[i * 3 + ay] = -end.vy * (p.view.extent / p.view.aspect) * k;
    dead[i] = end.dead ? 1 : 0;
  }
  const seeds = MeshData.fromPositions(pos);
  // appearance: the Emitter shares its closed form (speed 0, no gravity / drag / turbulence: the position stays the seed position)
  const out = emitParticles(seeds, { ...defaultEmitterParams(), ...e, plane: p.view.plane, shape: 'point', speed: 0, speedRandom: 0, gravity: [0, 0, 0], drag: 0, turbulence: 0, cone: 0 });
  const ids = out.attr('point', STD.id)?.data as Int32Array | undefined;
  const V = new Float32Array(out.pointCount * 3);
  const ps = out.attr('point', STD.pscale)?.data as Float32Array | undefined;
  const cd = out.attr('point', STD.Cd)?.data as Float32Array | undefined;
  for (let j = 0; j < out.pointCount; j++) {
    const i = ids ? ids[j] : j;
    V.set(vel.subarray(i * 3, i * 3 + 3), j * 3);
    if (dead[i]) {
      if (ps) ps[j] = 0;
      if (cd) cd[j * 4 + 3] = 0;
    }
  }
  out.setAttr({ name: 'v', element: 'point', size: 3, kind: 'f32', data: V });
  return out;
}

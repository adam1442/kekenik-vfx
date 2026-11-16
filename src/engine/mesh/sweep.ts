import { splineHandles3 } from '../../gizmos3d/models';
import { evalCurve, evalGradient } from '../params/curve';
import type { CurveValue, GradientValue, SplinePoint, SplineValue } from '../params/schema';
import { checkMeshLimits, STD, type MeshData } from './mesh';
import { computeNormals, MeshBuilder } from './builder';
import type { V3 } from './math3';
import { v3 } from './math3';

/* ------------------------------------------------------------------------------------------------
 * SWEEP: extrude a 2D profile along a 3D spline.
 *   spline (3D bezier, `attrs.z / scale / twist` per control point) -> arc-length resample -> frames (frenet | up vector |
 *   rotation minimising "minimal torsion") -> rings of profile points -> quads (+ optional caps).
 * Conventions: profile x -> binormal B = T x N, profile y -> normal N. Faces are wound so normals point OUTWARD for closed
 * profiles; an open ribbon faces +N (with up = +Z it faces up: a flat sword-swipe / shockwave strip).
 * UVs (v up): U around the profile (x u_tiling), V along the length (x v_tiling + v_offset; arc-length or index based).
 * Point attributes written: P, N, Cd (gradient along length), age (0..1 along length), pscale (profile scale at the ring).
 * ---------------------------------------------------------------------------------------------- */

export const PROFILES = ['circle', 'ribbon', 'star', 'custom'] as const;
export type SweepProfile = (typeof PROFILES)[number];
export const ORIENTATIONS = ['minimal_torsion', 'frenet', 'up_vector'] as const;
export type SweepOrientation = (typeof ORIENTATIONS)[number];

export interface SweepParams {
  spline: SplineValue;
  closed: boolean;
  segments: number;
  profile: SweepProfile;
  profileRes: number;
  profileSpline: SplineValue | null;
  width: number;
  height: number;
  starPoints: number;
  starInner: number;
  scaleCurve: CurveValue;
  twistCurve: CurveValue;
  /** Degrees reached where the twist curve is 1. */
  twistAmount: number;
  /** Constant roll in degrees. */
  rotation: number;
  taperStart: number;
  taperEnd: number;
  orientation: SweepOrientation;
  up: V3;
  capStart: boolean;
  capEnd: boolean;
  uTiling: number;
  vTiling: number;
  vOffset: number;
  vByLength: boolean;
  colorGradient: GradientValue;
  useGradient: boolean;
  normals: 'smooth' | 'flat';
  usePointAttrs: boolean;
}

export const defaultSweepSpline = (): SplineValue => ({
  closed: false,
  points: [
    { x: -1, y: 0, attrs: { z: 0, scale: 1, twist: 0 } },
    { x: -0.35, y: 0.25, attrs: { z: 0.25, scale: 1, twist: 0 } },
    { x: 0.35, y: -0.25, attrs: { z: 0.25, scale: 1, twist: 0 } },
    { x: 1, y: 0, attrs: { z: 0, scale: 1, twist: 0 } },
  ],
});

export const defaultSweepParams = (): SweepParams => ({
  spline: defaultSweepSpline(),
  closed: false,
  segments: 48,
  profile: 'circle',
  profileRes: 12,
  profileSpline: null,
  width: 0.2,
  height: 0.2,
  starPoints: 5,
  starInner: 0.45,
  scaleCurve: { keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
  twistCurve: { keys: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
  twistAmount: 360,
  rotation: 0,
  taperStart: 1,
  taperEnd: 1,
  orientation: 'minimal_torsion',
  up: [0, 0, 1],
  capStart: true,
  capEnd: true,
  uTiling: 1,
  vTiling: 1,
  vOffset: 0,
  vByLength: false,
  colorGradient: { stops: [{ pos: 0, color: [1, 1, 1, 1] }, { pos: 1, color: [1, 1, 1, 1] }] },
  useGradient: true,
  normals: 'smooth',
  usePointAttrs: true,
});

/* ----------------------------------------------------------------------------------------------- spline sampling */
const pos3 = (p: SplinePoint): V3 => [p.x, p.y, p.attrs?.z ?? 0];

interface Dense {
  p: V3[];
  /** Control parameter = segment index + t (for per-point attribute interpolation). */
  u: number[];
}
/** Dense bezier samples (same curve as the gizmo's `sampleSpline3`) that remember their control parameter. */
export function denseSpline(points: SplinePoint[], closed: boolean, perSeg: number): Dense {
  const n = points.length;
  const out: Dense = { p: [], u: [] };
  if (n === 0) return out;
  if (n === 1) return { p: [pos3(points[0])], u: [0] };
  const segs = closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const a = points[s], b = points[(s + 1) % n];
    const ha = splineHandles3(points, s, closed), hb = splineHandles3(points, (s + 1) % n, closed);
    const p0 = pos3(a), p3 = pos3(b), p1 = v3.add(p0, ha.hout), p2 = v3.add(p3, hb.hin);
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg, w = 1 - t;
      out.p.push([0, 1, 2].map((c) => w * w * w * p0[c] + 3 * w * w * t * p1[c] + 3 * w * t * t * p2[c] + t * t * t * p3[c]) as V3);
      out.u.push(s + t);
    }
  }
  out.p.push(pos3(points[closed ? 0 : n - 1]));
  out.u.push(closed ? n : n - 1);
  return out;
}

export interface Path {
  pos: V3[];
  /** Control parameter per sample. */
  u: number[];
  /** Normalised arc length 0..1 per sample (closed: sample i has i/n, the wrap row is 1). */
  s: number[];
  length: number;
  closed: boolean;
}

/** Arc-length resample into `rows` samples. Closed paths do not repeat the first sample (the wrap is implicit). */
export function resamplePath(points: SplinePoint[], closed: boolean, rows: number): Path {
  const perSeg = Math.max(8, Math.ceil((rows * 4) / Math.max(1, closed ? points.length : points.length - 1)));
  const d = denseSpline(points, closed, perSeg);
  const m = d.p.length;
  const cum = new Float64Array(m);
  for (let i = 1; i < m; i++) cum[i] = cum[i - 1] + v3.len(v3.sub(d.p[i], d.p[i - 1]));
  const total = cum[m - 1] || 1e-9;
  const pos: V3[] = [], u: number[] = [], s: number[] = [];
  let j = 0;
  for (let i = 0; i < rows; i++) {
    const f = closed ? i / rows : rows > 1 ? i / (rows - 1) : 0;
    const target = f * total;
    while (j < m - 2 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j];
    const t = span > 1e-12 ? Math.min(1, Math.max(0, (target - cum[j]) / span)) : 0;
    pos.push(v3.lerp(d.p[j], d.p[Math.min(m - 1, j + 1)], t));
    u.push(d.u[j] + (d.u[Math.min(m - 1, j + 1)] - d.u[j]) * t);
    s.push(f);
  }
  return { pos, u, s, length: total, closed };
}

/** Interpolate a control-point attribute at control parameter u. */
function attrAt(points: SplinePoint[], closed: boolean, key: 'scale' | 'twist', u: number, def: number): number {
  const n = points.length;
  if (n === 0) return def;
  const g = (i: number): number => points[closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))].attrs?.[key] ?? def;
  const i = Math.floor(u);
  const t = u - i;
  const a = g(i), b = g(i + 1);
  const e = t * t * (3 - 2 * t);
  return a + (b - a) * e;
}

/* ------------------------------------------------------------------------------------------------- frames */
function rotateAbout(v: V3, axis: V3, ang: number): V3 {
  const c = Math.cos(ang), s = Math.sin(ang);
  const k = v3.cross(axis, v);
  const d = v3.dot(axis, v) * (1 - c);
  return [v[0] * c + k[0] * s + axis[0] * d, v[1] * c + k[1] * s + axis[1] * d, v[2] * c + k[2] * s + axis[2] * d];
}
function perpTo(t: V3, ref: V3): V3 | null {
  const d = v3.dot(ref, t);
  const r: V3 = [ref[0] - t[0] * d, ref[1] - t[1] * d, ref[2] - t[2] * d];
  const l = v3.len(r);
  return l > 1e-5 ? [r[0] / l, r[1] / l, r[2] / l] : null;
}
function anyPerp(t: V3): V3 {
  const a: V3 = Math.abs(t[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return perpTo(t, a) ?? [0, 0, 1];
}

export interface Frames {
  T: V3[];
  N: V3[];
}
export function computeFrames(path: Path, mode: SweepOrientation, up: V3): Frames {
  const n = path.pos.length;
  const P = path.pos;
  const closed = path.closed;
  const T: V3[] = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? P[(i - 1 + n) % n] : P[Math.max(0, i - 1)];
    const b = closed ? P[(i + 1) % n] : P[Math.min(n - 1, i + 1)];
    T.push(v3.norm(v3.sub(b, a)));
    if (v3.len(v3.sub(b, a)) < 1e-12) T[i] = i > 0 ? T[i - 1] : [1, 0, 0];
  }
  const upN = v3.norm(up);
  const N: V3[] = new Array<V3>(n);
  if (mode === 'up_vector') {
    let prev: V3 = perpTo(T[0], upN) ?? anyPerp(T[0]);
    for (let i = 0; i < n; i++) N[i] = prev = perpTo(T[i], upN) ?? perpTo(T[i], prev) ?? anyPerp(T[i]);
  } else if (mode === 'frenet') {
    let prev: V3 = perpTo(T[0], upN) ?? anyPerp(T[0]);
    for (let i = 0; i < n; i++) {
      const a = closed ? T[(i - 1 + n) % n] : T[Math.max(0, i - 1)];
      const b = closed ? T[(i + 1) % n] : T[Math.min(n - 1, i + 1)];
      const k = v3.sub(b, a);
      N[i] = prev = perpTo(T[i], k) ?? perpTo(T[i], prev) ?? anyPerp(T[i]);
    }
  } else {
    // rotation-minimising frames (double reflection, Wang et al. 2008)
    N[0] = perpTo(T[0], upN) ?? anyPerp(T[0]);
    const step = (i: number, j: number, r: V3): V3 => {
      const x = v3.sub(P[j], P[i]);
      const c1 = v3.dot(x, x);
      if (c1 < 1e-18) return r;
      const rl = v3.sub(r, v3.scale(x, (2 / c1) * v3.dot(x, r)));
      const tl = v3.sub(T[i], v3.scale(x, (2 / c1) * v3.dot(x, T[i])));
      const w = v3.sub(T[j], tl);
      const c2 = v3.dot(w, w);
      return c2 < 1e-18 ? rl : v3.sub(rl, v3.scale(w, (2 / c2) * v3.dot(w, rl)));
    };
    for (let i = 0; i < n - 1; i++) N[i + 1] = step(i, i + 1, N[i]);
    if (closed && n > 2) {
      // transport once more around the seam and spread the residual twist evenly so the ring closes without a kink
      const wrap = step(n - 1, 0, N[n - 1]);
      const a = perpTo(T[0], wrap) ?? N[0];
      const cosv = Math.min(1, Math.max(-1, v3.dot(a, N[0])));
      let phi = Math.acos(cosv);
      if (v3.dot(v3.cross(a, N[0]), T[0]) < 0) phi = -phi;
      for (let i = 0; i < n; i++) N[i] = rotateAbout(N[i], T[i], (phi * i) / n);
    }
  }
  for (let i = 0; i < n; i++) N[i] = perpTo(T[i], N[i]) ?? anyPerp(T[i]);
  return { T, N };
}

/* ------------------------------------------------------------------------------------------------ profiles */
export interface ProfileShape {
  pts: [number, number][];
  closed: boolean;
}
export function makeProfile(p: Pick<SweepParams, 'profile' | 'profileRes' | 'profileSpline' | 'starPoints' | 'starInner'>): ProfileShape {
  const res = Math.max(3, Math.round(p.profileRes));
  if (p.profile === 'ribbon') return { pts: [[0.5, 0], [-0.5, 0]], closed: false };
  if (p.profile === 'star') {
    const k = Math.max(3, Math.round(p.starPoints));
    const pts: [number, number][] = [];
    for (let i = 0; i < k * 2; i++) {
      const a = (i / (k * 2)) * Math.PI * 2;
      const r = (i % 2 === 0 ? 0.5 : 0.5 * p.starInner);
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return { pts, closed: true };
  }
  if (p.profile === 'custom' && p.profileSpline && p.profileSpline.points.length >= 2) {
    const sp = p.profileSpline;
    const closed = !!sp.closed;
    const flat = sp.points.map((q) => ({ ...q, attrs: { ...(q.attrs ?? {}), z: 0 } }));
    const d = denseSpline(flat, closed, 24);
    const cum = [0];
    for (let i = 1; i < d.p.length; i++) cum.push(cum[i - 1] + v3.len(v3.sub(d.p[i], d.p[i - 1])));
    const total = cum[cum.length - 1] || 1e-9;
    const count = closed ? res : res;
    const pts: [number, number][] = [];
    let j = 0;
    for (let i = 0; i < count; i++) {
      const target = (closed ? i / count : i / (count - 1)) * total;
      while (j < d.p.length - 2 && cum[j + 1] < target) j++;
      const span = cum[j + 1] - cum[j];
      const t = span > 1e-12 ? Math.min(1, Math.max(0, (target - cum[j]) / span)) : 0;
      const q = v3.lerp(d.p[j], d.p[j + 1], t);
      pts.push([q[0] - 0.5, 0.5 - q[1]]); // UV space (y down) -> profile space, centred
    }
    return { pts, closed };
  }
  const pts: [number, number][] = [];
  for (let i = 0; i < res; i++) {
    const a = (i / res) * Math.PI * 2;
    pts.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
  }
  return { pts, closed: true };
}

/* ------------------------------------------------------------------------------------------------- sweep */
export interface SweepInfo {
  rows: number;
  ring: number;
  length: number;
}

export function sweep(p: SweepParams): MeshData {
  const points = p.spline.points;
  if (points.length < 2) throw new Error('Sweep needs a spline with at least 2 points');
  const closedLoop = p.closed || !!p.spline.closed;
  const prof = makeProfile(p);
  const R = prof.pts.length;
  const segs = Math.max(1, Math.min(8192, Math.round(p.segments)));
  const rows = closedLoop ? Math.max(3, segs) : segs + 1;
  const capPts = !closedLoop && prof.closed ? (p.capStart ? R + 1 : 0) + (p.capEnd ? R + 1 : 0) : 0;
  const quadRows = closedLoop ? rows : rows - 1;
  const quadsPerRow = prof.closed ? R : R - 1;
  checkMeshLimits(rows * R + capPts, quadRows * quadsPerRow * 4 + (capPts ? 2 * R : 0), quadRows * quadsPerRow + (capPts ? 2 : 0), 'Sweep');

  const path = resamplePath(points, closedLoop, rows);
  const fr = computeFrames(path, p.orientation, p.up);
  const b = new MeshBuilder('Sweep');

  const idx = new Int32Array(rows * R);
  const rowT = new Float32Array(rows); // 0..1 along the length (closed: i / rows)
  const rowScale = new Float32Array(rows);
  const ringPos: V3[][] = [];
  for (let i = 0; i < rows; i++) {
    const t = path.s[i];
    rowT[i] = t;
    let s = Math.max(0, evalCurve(p.scaleCurve, t)) * (p.taperStart + (p.taperEnd - p.taperStart) * t);
    let twist = evalCurve(p.twistCurve, t) * p.twistAmount + p.rotation;
    if (p.usePointAttrs) {
      s *= Math.max(0, attrAt(points, closedLoop, 'scale', path.u[i], 1));
      twist += attrAt(points, closedLoop, 'twist', path.u[i], 0);
    }
    rowScale[i] = s;
    const N = rotateAbout(fr.N[i], fr.T[i], (twist * Math.PI) / 180);
    const B = v3.cross(fr.T[i], N);
    const ring: V3[] = [];
    for (let k = 0; k < R; k++) {
      const x = prof.pts[k][0] * p.width * s, y = prof.pts[k][1] * p.height * s;
      const q: V3 = [path.pos[i][0] + B[0] * x + N[0] * y, path.pos[i][1] + B[1] * x + N[1] * y, path.pos[i][2] + B[2] * x + N[2] * y];
      idx[i * R + k] = b.addPoint(q[0], q[1], q[2]);
      ring.push(q);
    }
    ringPos.push(ring);
  }

  // UV helpers
  // V: normalised 0..1 along the length, or (vByLength) world distance so the texture density stays constant when the spline is stretched.
  const vOfRow = (i: number): number => {
    const t = i >= rows ? 1 : rowT[i];
    return t * (p.vByLength ? path.length : 1) * p.vTiling + p.vOffset;
  };
  const uOf = (k: number): number => (prof.closed ? k / R : k / (R - 1)) * p.uTiling;
  for (let i = 0; i < quadRows; i++) {
    const i2 = (i + 1) % rows;
    const vA = vOfRow(i), vB = vOfRow(i + 1);
    for (let k = 0; k < quadsPerRow; k++) {
      const k2 = (k + 1) % R;
      const uA = uOf(k), uB = uOf(k + 1);
      b.addPrim([idx[i * R + k], idx[i2 * R + k], idx[i2 * R + k2], idx[i * R + k2]], [uA, vA, uA, vB, uB, vB, uB, vA]);
    }
  }
  // caps (separate points so smooth normals stay crisp at the rim)
  const capPoints: { pt: number; row: number }[] = [];
  const addCap = (row: number, reverse: boolean): void => {
    const ring = ringPos[row];
    const cx = path.pos[row];
    const ci = b.addPoint(cx[0], cx[1], cx[2]);
    capPoints.push({ pt: ci, row });
    const ids: number[] = [];
    for (let k = 0; k < R; k++) {
      ids.push(b.addPoint(ring[k][0], ring[k][1], ring[k][2]));
      capPoints.push({ pt: ids[k], row });
    }
    const order = [...ids.keys()];
    if (reverse) order.reverse();
    const uvs: number[] = [];
    for (const k of order) uvs.push(prof.pts[k][0] + 0.5, prof.pts[k][1] + 0.5);
    b.addPrim(order.map((k) => ids[k]), uvs);
  };
  if (!closedLoop && prof.closed && R >= 3) {
    if (p.capStart) addCap(0, false);
    if (p.capEnd) addCap(rows - 1, true);
  }
  const m = b.build({ normals: false });
  computeNormals(m, p.normals);
  // point attributes: Cd gradient along the length, age, pscale
  const n = m.pointCount;
  const cd = new Float32Array(n * 4), age = new Float32Array(n), ps = new Float32Array(n);
  const fill = (pt: number, row: number): void => {
    const t = rowT[row];
    const c = p.useGradient ? evalGradient(p.colorGradient, t) : ([1, 1, 1, 1] as const);
    cd.set(c as ArrayLike<number>, pt * 4);
    age[pt] = t;
    ps[pt] = rowScale[row];
  };
  for (let i = 0; i < rows; i++) for (let k = 0; k < R; k++) fill(idx[i * R + k], i);
  for (const c of capPoints) fill(c.pt, c.row);
  m.setAttr({ name: STD.Cd, element: 'point', size: 4, kind: 'f32', data: cd });
  m.setAttr({ name: STD.age, element: 'point', size: 1, kind: 'f32', data: age });
  m.setAttr({ name: STD.pscale, element: 'point', size: 1, kind: 'f32', data: ps });
  return m;
}

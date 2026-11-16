import { cloneValue, type SplinePoint, type SplineValue } from '../engine/params/schema';
import { v2, type V2 } from './geom';

/** Pure spline maths (coordinates are whatever the caller uses: UV in values, ip when mapped). Cubic bezier segments. */
export type Bez = [V2, V2, V2, V2];

const pt = (p: SplinePoint): V2 => [p.x, p.y];
const nextIdx = (n: number, closed: boolean, i: number): number => (i + 1 < n ? i + 1 : closed ? 0 : -1);
const prevIdx = (n: number, closed: boolean, i: number): number => (i > 0 ? i - 1 : closed ? n - 1 : -1);

/** Relative in/out handle offsets of point i after resolving its mode ('auto' = Catmull-Rom from the neighbours). */
export function resolveHandles(sp: SplineValue, i: number): { hin: V2; hout: V2 } {
  const pts = sp.points;
  const p = pts[i];
  if (p.mode === 'corner') return { hin: [0, 0], hout: [0, 0] };
  if (p.mode === 'free') return { hin: p.hin ? [p.hin[0], p.hin[1]] : [0, 0], hout: p.hout ? [p.hout[0], p.hout[1]] : [0, 0] };
  const n = pts.length;
  const ni = nextIdx(n, sp.closed, i);
  const pi = prevIdx(n, sp.closed, i);
  const cur = pt(p);
  let out: V2;
  if (ni >= 0 && pi >= 0) out = v2.mul(v2.sub(pt(pts[ni]), pt(pts[pi])), 1 / 6);
  else if (ni >= 0) out = v2.mul(v2.sub(pt(pts[ni]), cur), 1 / 3);
  else if (pi >= 0) out = v2.mul(v2.sub(cur, pt(pts[pi])), 1 / 3);
  else out = [0, 0];
  return { hin: v2.mul(out, -1), hout: out };
}

export const segmentCount = (sp: SplineValue): number => (sp.points.length < 2 ? 0 : sp.closed ? sp.points.length : sp.points.length - 1);

export function segmentBezier(sp: SplineValue, i: number): Bez {
  const n = sp.points.length;
  const a = sp.points[i];
  const j = (i + 1) % n;
  const b = sp.points[j];
  const ha = resolveHandles(sp, i);
  const hb = resolveHandles(sp, j);
  const pa = pt(a);
  const pb = pt(b);
  return [pa, v2.add(pa, ha.hout), v2.add(pb, hb.hin), pb];
}

export function bezierAt(b: Bez, t: number): V2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [w0 * b[0][0] + w1 * b[1][0] + w2 * b[2][0] + w3 * b[3][0], w0 * b[0][1] + w1 * b[1][1] + w2 * b[2][1] + w3 * b[3][1]];
}
export function bezierTangent(b: Bez, t: number): V2 {
  const u = 1 - t;
  const d = (k: 0 | 1): number => 3 * u * u * (b[1][k] - b[0][k]) + 6 * u * t * (b[2][k] - b[1][k]) + 3 * t * t * (b[3][k] - b[2][k]);
  return [d(0), d(1)];
}

/** de Casteljau split at t. */
export function splitBezier(b: Bez, t: number): [Bez, Bez] {
  const l = (a: V2, c: V2): V2 => v2.lerp(a, c, t);
  const p01 = l(b[0], b[1]);
  const p12 = l(b[1], b[2]);
  const p23 = l(b[2], b[3]);
  const p012 = l(p01, p12);
  const p123 = l(p12, p23);
  const m = l(p012, p123);
  return [[b[0], p01, p012, m], [m, p123, p23, b[3]]];
}

/** Polyline samples of the whole spline: points + the (segment, t) each sample came from. */
export function sampleSpline(sp: SplineValue, perSeg = 20): { pts: V2[]; seg: number[]; t: number[] } {
  const out = { pts: [] as V2[], seg: [] as number[], t: [] as number[] };
  const ns = segmentCount(sp);
  for (let i = 0; i < ns; i++) {
    const b = segmentBezier(sp, i);
    for (let k = i === 0 ? 0 : 1; k <= perSeg; k++) {
      const t = k / perSeg;
      out.pts.push(bezierAt(b, t));
      out.seg.push(i);
      out.t.push(t);
    }
  }
  if (ns === 0 && sp.points.length === 1) {
    out.pts.push(pt(sp.points[0]));
    out.seg.push(0);
    out.t.push(0);
  }
  return out;
}

/** Make every point's handles explicit ('free') so geometry survives edits of neighbours. */
function materialise(sp: SplineValue, i: number): void {
  const p = sp.points[i];
  if (p.mode === 'free') return;
  const h = resolveHandles(sp, i);
  p.mode = 'free';
  p.hin = h.hin;
  p.hout = h.hout;
}

/** Insert a point on segment `seg` at parameter t, preserving the curve exactly. Returns a new value + the new index. */
export function insertPoint(sp: SplineValue, seg: number, t: number): { value: SplineValue; index: number } {
  const v = cloneValue(sp) as SplineValue;
  const n = v.points.length;
  const j = (seg + 1) % n;
  const bez = segmentBezier(sp, seg);
  const [l, r] = splitBezier(bez, t);
  const a = v.points[seg];
  const b = v.points[j];
  materialise(v, seg);
  materialise(v, j);
  a.hout = v2.sub(l[1], l[0]);
  b.hin = v2.sub(r[2], r[3]);
  const mid = l[3];
  const wa = a.w ?? 0;
  const wb = b.w ?? 0;
  const np: SplinePoint = { x: mid[0], y: mid[1], mode: 'free', hin: v2.sub(l[2], mid), hout: v2.sub(r[1], mid) };
  if (a.w !== undefined || b.w !== undefined) np.w = wa + (wb - wa) * t;
  if (a.attrs || b.attrs) {
    np.attrs = {};
    for (const k of new Set([...Object.keys(a.attrs ?? {}), ...Object.keys(b.attrs ?? {})])) np.attrs[k] = (a.attrs?.[k] ?? 0) + ((b.attrs?.[k] ?? 0) - (a.attrs?.[k] ?? 0)) * t;
  }
  v.points.splice(seg + 1, 0, np);
  return { value: v, index: seg + 1 };
}

export function deletePoint(sp: SplineValue, i: number, minPoints = 2): SplineValue {
  if (sp.points.length <= minPoints) return sp;
  const v = cloneValue(sp) as SplineValue;
  v.points.splice(i, 1);
  return v;
}

export function reverseSpline(sp: SplineValue): SplineValue {
  const v = cloneValue(sp) as SplineValue;
  v.points.reverse();
  for (const p of v.points) {
    const hin = p.hin;
    p.hin = p.hout;
    p.hout = hin;
  }
  return v;
}

/**
 * Spline data model operations. PURE (no DOM, no GPU): unit-tested in tests/spline-ops.test.ts.
 * A spline is the existing `SplineValue` (points with mode / handles / width `w` / `attrs`, closed flag). A `SplineSet` is what the
 * `spline` PIN carries: one or more splines. 2D splines live in UV space (0..1, y down); 3D paths keep z / scale / twist in `attrs`.
 */
import { v2, type V2 } from '../../gizmos/geom';
import { deletePoint, insertPoint, resolveHandles, reverseSpline, sampleSpline, segmentBezier, segmentCount, bezierAt } from '../../gizmos/spline';
import { cloneValue, type SplinePoint, type SplineValue } from '../params/schema';

export type TangentMode = 'auto' | 'corner' | 'free';
export interface SplineSet {
  splines: SplineValue[];
}
export const emptySet = (): SplineSet => ({ splines: [] });
export const setOf = (...s: SplineValue[]): SplineSet => ({ splines: s });
export const cloneSet = (s: SplineSet): SplineSet => ({ splines: s.splines.map((x) => cloneValue(x) as SplineValue) });

/* ----------------------------------------------------------------------------------------------- editing */
/** Insert a point on segment `seg` at parameter `t` (curve shape preserved exactly). */
export const insertAtParam = (sp: SplineValue, seg: number, t: number): { value: SplineValue; index: number } => insertPoint(sp, seg, Math.min(1, Math.max(0, t)));

/** Delete several points at once; never goes below `minPoints`. */
export function deletePoints(sp: SplineValue, indices: readonly number[], minPoints = 2): SplineValue {
  const drop = new Set(indices);
  const keep = sp.points.filter((_, i) => !drop.has(i));
  if (keep.length < minPoints || keep.length === sp.points.length) return indices.length === 1 ? deletePoint(sp, indices[0], minPoints) : sp;
  const v = cloneValue(sp) as SplineValue;
  v.points = v.points.filter((_, i) => !drop.has(i));
  return v;
}

/** Convert tangent mode of the given points. 'free' keeps the current look by materialising the automatic handles. */
export function convertMode(sp: SplineValue, indices: readonly number[], mode: TangentMode): SplineValue {
  const v = cloneValue(sp) as SplineValue;
  for (const i of indices) {
    const p = v.points[i];
    if (!p) continue;
    if (mode === 'free') {
      const h = resolveHandles(sp, i);
      p.mode = 'free';
      p.hin = h.hin;
      p.hout = h.hout;
    } else {
      p.mode = mode;
      delete p.hin;
      delete p.hout;
    }
  }
  return v;
}

export function setClosed(sp: SplineValue, closed: boolean): SplineValue {
  const v = cloneValue(sp) as SplineValue;
  v.closed = closed && v.points.length >= 3;
  return v;
}
export const flipDirection = reverseSpline;

/** Mirror about the line x = c (axis 'x') or y = c (axis 'y'); direction is reversed so winding stays meaningful for closed shapes. */
export function mirror(sp: SplineValue, axis: 'x' | 'y', c = 0.5): SplineValue {
  const v = cloneValue(sp) as SplineValue;
  for (const p of v.points) {
    if (axis === 'x') {
      p.x = 2 * c - p.x;
      if (p.hin) p.hin = [-p.hin[0], p.hin[1]];
      if (p.hout) p.hout = [-p.hout[0], p.hout[1]];
    } else {
      p.y = 2 * c - p.y;
      if (p.hin) p.hin = [p.hin[0], -p.hin[1]];
      if (p.hout) p.hout = [p.hout[0], -p.hout[1]];
    }
  }
  return reverseSpline(v);
}

/** Linear transform of every point + handle: scale about `pivot`, rotate (radians) then translate. */
export function transformSpline(sp: SplineValue, o: { tx?: number; ty?: number; rot?: number; sx?: number; sy?: number; pivot?: V2 }): SplineValue {
  const v = cloneValue(sp) as SplineValue;
  const [px, py] = o.pivot ?? [0.5, 0.5];
  const c = Math.cos(o.rot ?? 0);
  const s = Math.sin(o.rot ?? 0);
  const sx = o.sx ?? 1;
  const sy = o.sy ?? 1;
  const lin = (x: number, y: number): V2 => [(x * sx) * c - (y * sy) * s, (x * sx) * s + (y * sy) * c];
  for (const p of v.points) {
    const [x, y] = lin(p.x - px, p.y - py);
    p.x = x + px + (o.tx ?? 0);
    p.y = y + py + (o.ty ?? 0);
    if (p.hin) p.hin = lin(p.hin[0], p.hin[1]);
    if (p.hout) p.hout = lin(p.hout[0], p.hout[1]);
  }
  return v;
}

/* ----------------------------------------------------------------------------------------------- sampling */
export const toPolyline = (sp: SplineValue, perSeg = 16): V2[] => sampleSpline(sp, perSeg).pts;

export function polylineLength(pts: readonly V2[], closed = false): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += v2.len(v2.sub(pts[i], pts[i - 1]));
  if (closed && pts.length > 2) L += v2.len(v2.sub(pts[0], pts[pts.length - 1]));
  return L;
}

/** Signed area (shoelace). Positive = counter-clockwise in a y-UP coordinate system. */
export function signedArea(pts: readonly V2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Resample to `count` points equally spaced by arc length (smooth 'auto' points; closed splines wrap). */
export function resample(sp: SplineValue, count: number): SplineValue {
  const n = Math.max(2, Math.round(count));
  const dense = toPolyline(sp, 24);
  if (dense.length < 2) return cloneValue(sp) as SplineValue;
  const poly = sp.closed ? [...dense, dense[0]] : dense;
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + v2.len(v2.sub(poly[i], poly[i - 1])));
  const total = cum[cum.length - 1] || 1e-12;
  const out: SplinePoint[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const target = (sp.closed ? k / n : k / (n - 1)) * total;
    while (j < poly.length - 2 && cum[j + 1] < target) j++;
    const span = cum[j + 1] - cum[j];
    const t = span > 1e-12 ? Math.min(1, Math.max(0, (target - cum[j]) / span)) : 0;
    const q = v2.lerp(poly[j], poly[j + 1], t);
    out.push({ x: q[0], y: q[1], mode: 'auto' });
  }
  return { closed: sp.closed, points: out };
}

/** Smooth: resample then Chaikin-style average of neighbours (keeps ends of open splines). */
export function smooth(sp: SplineValue, iterations = 1): SplineValue {
  let v = cloneValue(sp) as SplineValue;
  for (let it = 0; it < iterations; it++) {
    const P = v.points;
    const n = P.length;
    v = {
      closed: v.closed,
      points: P.map((p, i) => {
        const open = !v.closed && (i === 0 || i === n - 1);
        if (open) return { ...p };
        const a = P[(i + n - 1) % n];
        const b = P[(i + 1) % n];
        return { ...p, x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 };
      }),
    };
  }
  return v;
}

/** Offset a polyline-ish spline along its normals (positive = left of the travel direction in y-down UV). */
export function offsetSpline(sp: SplineValue, d: number, samples = 24): SplineValue {
  const dense = resample(sp, Math.max(sp.points.length, samples));
  const P = dense.points;
  const n = P.length;
  return {
    closed: dense.closed,
    points: P.map((p, i) => {
      const a = P[Math.max(0, dense.closed ? (i + n - 1) % n : i - 1)];
      const b = P[Math.min(n - 1, dense.closed ? (i + 1) % n : i + 1)];
      const tg = v2.norm(v2.sub([b.x, b.y], [a.x, a.y]));
      const nm = v2.perp(tg);
      return { x: p.x + nm[0] * d, y: p.y + nm[1] * d, mode: 'auto' as const };
    }),
  };
}

/* ----------------------------------------------------------------------------------------------- profiles (Sweep) */
export type ProfileIssue = 'tooFewPoints' | 'degenerate' | 'selfIntersect';

function segIntersect(a: V2, b: V2, c: V2, d: V2): boolean {
  const o = (p: V2, q: V2, r: V2): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function validateProfile(sp: SplineValue): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  if (sp.points.length < 2) return ['tooFewPoints'];
  const poly = toPolyline(sp, 13); // odd: a crossing at exactly t = 0.5 of two segments must not land on shared vertices
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(ext > 1e-6)) issues.push('degenerate');
  const n = poly.length;
  const closed = sp.closed;
  outer: for (let i = 0; i < n - 1; i++) {
    for (let j = i + 2; j < n - 1; j++) {
      if (closed && i === 0 && j === n - 2) continue; // neighbours across the closing seam
      if (segIntersect(poly[i], poly[i + 1], poly[j], poly[j + 1])) {
        issues.push('selfIntersect');
        break outer;
      }
    }
  }
  return issues;
}

/**
 * Normalise a custom profile: centre the bounding box on (0.5, 0.5), scale the largest extent to `size` (unit size by default) and
 * fix the winding of CLOSED profiles so the sweep produces outward-facing faces (counter-clockwise in profile space, which is the
 * UV y-flip of the stored points). Open profiles keep their direction (ribbons).
 */
export function normalizeProfile(sp: SplineValue, size = 1): { value: SplineValue; issues: ProfileIssue[] } {
  const issues = validateProfile(sp);
  if (sp.points.length < 2) return { value: cloneValue(sp) as SplineValue, issues };
  const poly = toPolyline(sp, 12);
  const minX = Math.min(...poly.map((p) => p[0]));
  const maxX = Math.max(...poly.map((p) => p[0]));
  const minY = Math.min(...poly.map((p) => p[1]));
  const maxY = Math.max(...poly.map((p) => p[1]));
  const ext = Math.max(maxX - minX, maxY - minY);
  const k = ext > 1e-9 ? size / ext : 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let v = transformSpline(sp, { pivot: [cx, cy], sx: k, sy: k, tx: 0.5 - cx, ty: 0.5 - cy });
  if (v.closed) {
    const profile = toPolyline(v, 12).map((p): V2 => [p[0] - 0.5, 0.5 - p[1]]); // same mapping as engine/mesh/sweep.ts makeProfile
    if (signedArea(profile) < 0) v = reverseSpline(v);
  }
  return { value: v, issues };
}

/** Lift a 2D (UV) spline into a 3D sweep path: centred, y flipped, x2 so the unit square becomes [-1, 1]; z / scale / twist attrs added. */
export function liftTo3D(sp: SplineValue, z = 0): SplineValue {
  const v = cloneValue(sp) as SplineValue;
  for (const p of v.points) {
    p.x = (p.x - 0.5) * 2;
    p.y = (0.5 - p.y) * 2;
    if (p.hin) p.hin = [p.hin[0] * 2, -p.hin[1] * 2];
    if (p.hout) p.hout = [p.hout[0] * 2, -p.hout[1] * 2];
    p.attrs = { z, scale: 1, twist: 0, ...(p.attrs ?? {}) };
  }
  return v;
}

/* ----------------------------------------------------------------------------------------------- hit testing (tools) */
export type AddHit = { kind: 'point'; index: number; dist: number } | { kind: 'segment'; seg: number; t: number; point: V2; dist: number } | null;

/** Nearest anchor within `tol` (distance in the same units as the spline). Used by the Delete tool and for selection. */
export function hitPoint(sp: SplineValue, p: V2, tol: number): number {
  let best = -1;
  let bd = tol;
  sp.points.forEach((q, i) => {
    const d = v2.len(v2.sub([q.x, q.y], p));
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Add tool hit test: an anchor (select it) or the nearest segment parameter (insert there). `null` = empty space (append). */
export function hitTestAdd(sp: SplineValue, p: V2, tol: number): AddHit {
  const pi = hitPoint(sp, p, tol);
  if (pi >= 0) return { kind: 'point', index: pi, dist: v2.len(v2.sub([sp.points[pi].x, sp.points[pi].y], p)) };
  let best: AddHit = null;
  let bd = tol;
  for (let s = 0; s < segmentCount(sp); s++) {
    const bz = segmentBezier(sp, s);
    const N = 40;
    for (let k = 0; k < N; k++) {
      const a = bezierAt(bz, k / N);
      const b = bezierAt(bz, (k + 1) / N);
      const ab = v2.sub(b, a);
      const l2 = ab[0] * ab[0] + ab[1] * ab[1] || 1e-12;
      const u = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
      const q = v2.add(a, v2.mul(ab, u));
      const d = v2.len(v2.sub(q, p));
      if (d <= bd) {
        bd = d;
        best = { kind: 'segment', seg: s, t: (k + u) / N, point: q, dist: d };
      }
    }
  }
  return best;
}

/** Apply the Add tool at `p`: insert on a segment, or append a corner/auto point at the end. Returns the new value and the selected index. */
export function applyAddTool(sp: SplineValue, p: V2, tol: number): { value: SplineValue; index: number } {
  const hit = hitTestAdd(sp, p, tol);
  if (hit?.kind === 'point') return { value: sp, index: hit.index };
  if (hit?.kind === 'segment') return insertAtParam(sp, hit.seg, hit.t);
  const v = cloneValue(sp) as SplineValue;
  v.points.push({ x: p[0], y: p[1], mode: 'auto' });
  return { value: v, index: v.points.length - 1 };
}

/** Apply the Delete tool at `p` (removes the anchor under the cursor, respecting `minPoints`). */
export function applyDeleteTool(sp: SplineValue, p: V2, tol: number, minPoints = 2): SplineValue {
  const i = hitPoint(sp, p, tol);
  return i < 0 ? sp : deletePoints(sp, [i], minPoints);
}

/* ----------------------------------------------------------------------------------------------- presets */
export const SPLINE_PRESETS = ['line', 'arc', 'circle', 's_curve', 'spiral', 'star', 'rounded_rect', 'zigzag'] as const;
export type SplinePreset = (typeof SPLINE_PRESETS)[number];

const auto = (x: number, y: number): SplinePoint => ({ x, y, mode: 'auto' });
const corner = (x: number, y: number): SplinePoint => ({ x, y, mode: 'corner' });

/** Preset shapes in UV space (0..1). `cx, cy, r` place them. */
export function presetSpline(name: SplinePreset, cx = 0.5, cy = 0.5, r = 0.35): SplineValue {
  switch (name) {
    case 'line':
      return { closed: false, points: [corner(cx - r, cy), corner(cx + r, cy)] };
    case 'arc':
      return { closed: false, points: Array.from({ length: 6 }, (_, i) => {
        const a = Math.PI * (1.15 + (i / 5) * 0.7);
        return auto(cx + Math.cos(a) * r, cy + Math.sin(a) * r + r * 0.5);
      }) };
    case 'circle':
      return { closed: true, points: Array.from({ length: 8 }, (_, i) => auto(cx + Math.cos((i / 8) * Math.PI * 2) * r, cy + Math.sin((i / 8) * Math.PI * 2) * r)) };
    case 's_curve':
      return { closed: false, points: [auto(cx - r, cy + r * 0.6), auto(cx - r * 0.3, cy + r * 0.6), auto(cx + r * 0.3, cy - r * 0.6), auto(cx + r, cy - r * 0.6)] };
    case 'spiral':
      return { closed: false, points: Array.from({ length: 14 }, (_, i) => {
        const t = i / 13;
        const a = t * Math.PI * 4;
        return auto(cx + Math.cos(a) * r * (0.1 + 0.9 * t), cy + Math.sin(a) * r * (0.1 + 0.9 * t));
      }) };
    case 'star':
      return { closed: true, points: Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        return corner(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }) };
    case 'rounded_rect': {
      const w = r;
      const h = r * 0.7;
      const k = r * 0.28;
      // explicit 8-point rounded rectangle (straight edges, corner-cut by k)
      return { closed: true, points: [corner(cx - w + k, cy - h), corner(cx + w - k, cy - h), corner(cx + w, cy - h + k), corner(cx + w, cy + h - k), corner(cx + w - k, cy + h), corner(cx - w + k, cy + h), corner(cx - w, cy + h - k), corner(cx - w, cy - h + k)] };
    }
    case 'zigzag':
      return { closed: false, points: Array.from({ length: 9 }, (_, i) => corner(cx - r + (i / 8) * 2 * r, cy + (i % 2 === 0 ? -1 : 1) * r * 0.25)) };
  }
}

/** Convenience for nodes: first spline of a set (or undefined). */
export const firstSpline = (s: SplineSet | undefined): SplineValue | undefined => s?.splines[0];

import { evalCurve } from '../../../engine/params/curve';
import type { CurveValue, SplineValue } from '../../../engine/params/schema';
import { sampleSpline, segmentCount } from '../../../gizmos/spline';

/**
 * CPU side of grayscale.spline: turns up to four SplineValues into a flat polyline table for the shader.
 * Every sample = vec4(x, y, half width, t along the spline 0..1), x/y in UV, half width in "smaller image side" units.
 * Per spline the shader gets (start index, sample count, closed) and a UV bounding box (inflated by the largest half
 * width) which is used to skip tiled copies and pixels that cannot be touched by the stroke.
 */
export const MAX_SPLINES = 4;
export const MAX_SAMPLES = 64; // per spline
export const TABLE_VEC4 = MAX_SPLINES * MAX_SAMPLES;

export interface StrokeOptions {
  /** Default full width (UV) for points without their own `w`. */
  width: number;
  /** Multiplier of the width along the spline (x = 0..1 along the arc length). */
  widthCurve: CurveValue;
  tileX: boolean;
  tileY: boolean;
  /** Extra distance (UV) added to the bounding boxes (softness / antialiasing margin). */
  margin?: number;
}
export interface StrokeTable {
  samples: Float32Array; // 4 * TABLE_VEC4
  ranges: Float32Array; // 4 * MAX_SPLINES: start, count, closed, unused
  bbox: Float32Array; // 4 * MAX_SPLINES: x0, y0, x1, y1 (UV)
  /** Integer image offsets (tiled copies) that may touch [0,1]^2. */
  ox0: number;
  ox1: number;
  oy0: number;
  oy1: number;
  /** Number of splines that contribute geometry. */
  active: number;
  /** Total polyline samples written. */
  total: number;
}

export function buildStrokes(splines: SplineValue[], o: StrokeOptions): StrokeTable {
  const samples = new Float32Array(4 * TABLE_VEC4);
  const ranges = new Float32Array(4 * MAX_SPLINES);
  const bbox = new Float32Array(4 * MAX_SPLINES);
  let ox0 = 0;
  let ox1 = 0;
  let oy0 = 0;
  let oy1 = 0;
  let active = 0;
  let total = 0;
  const margin = o.margin ?? 0.01;
  for (let s = 0; s < Math.min(splines.length, MAX_SPLINES); s++) {
    const sp = splines[s];
    const n = sp?.points?.length ?? 0;
    if (!sp || n < 1) continue;
    const ns = segmentCount(sp);
    const perSeg = ns === 0 ? 1 : Math.max(1, Math.min(24, Math.floor((MAX_SAMPLES - 1) / Math.min(ns, MAX_SAMPLES - 1))));
    const sm = sampleSpline(sp, perSeg);
    let pts = sm.pts;
    let seg = sm.seg;
    let loc = sm.t;
    if (pts.length > MAX_SAMPLES) {
      pts = pts.slice(0, MAX_SAMPLES);
      seg = seg.slice(0, MAX_SAMPLES);
      loc = loc.slice(0, MAX_SAMPLES);
    }
    if (pts.length === 1) {
      pts = [pts[0], pts[0]];
      seg = [0, 0];
      loc = [0, 0];
    }
    // arc length parameter
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = Math.max(cum[cum.length - 1], 1e-9);
    const start = s * MAX_SAMPLES;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let maxHalf = 0;
    for (let i = 0; i < pts.length; i++) {
      const wa = sp.points[seg[i] % n]?.w ?? o.width;
      const wb = sp.points[(seg[i] + 1) % n]?.w ?? o.width;
      const t = cum[i] / L;
      const half = Math.max(0, 0.5 * (wa + (wb - wa) * loc[i]) * evalCurve(o.widthCurve, t));
      const k = (start + i) * 4;
      samples[k] = pts[i][0];
      samples[k + 1] = pts[i][1];
      samples[k + 2] = half;
      samples[k + 3] = t;
      x0 = Math.min(x0, pts[i][0]);
      y0 = Math.min(y0, pts[i][1]);
      x1 = Math.max(x1, pts[i][0]);
      y1 = Math.max(y1, pts[i][1]);
      maxHalf = Math.max(maxHalf, half);
    }
    const pad = maxHalf + margin;
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    ranges.set([start, pts.length, sp.closed && n >= 3 ? 1 : 0, 0], s * 4);
    bbox.set([x0, y0, x1, y1], s * 4);
    active++;
    total += pts.length;
    if (o.tileX) {
      ox0 = Math.min(ox0, Math.max(-2, Math.ceil(-x1)));
      ox1 = Math.max(ox1, Math.min(2, Math.floor(1 - x0)));
    }
    if (o.tileY) {
      oy0 = Math.min(oy0, Math.max(-2, Math.ceil(-y1)));
      oy1 = Math.max(oy1, Math.min(2, Math.floor(1 - y0)));
    }
  }
  return { samples, ranges, bbox, ox0: ox0 + 0, ox1: ox1 + 0, oy0: oy0 + 0, oy1: oy1 + 0, active, total };
}

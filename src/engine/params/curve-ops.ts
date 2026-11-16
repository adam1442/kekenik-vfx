import { clamp } from '../../shared/util';
import { autoTangent, evalCurve } from './curve';
import type { CurveKey, CurveValue } from './schema';

/**
 * Pure editing operations of the curve widget. Everything returns a NEW CurveValue; keys stay sorted by x.
 * Slopes (`tin` / `tout`) are dy/dx. Segment i (key i -> key i+1) uses key i's `mode`.
 */
export const cloneCurve = (c: CurveValue): CurveValue => JSON.parse(JSON.stringify(c)) as CurveValue;
export type KeyMode = NonNullable<CurveKey['mode']>;

export interface EditBounds {
  xRange: [number, number];
  yRange: [number, number];
}
export const UNIT_BOUNDS: EditBounds = { xRange: [0, 1], yRange: [0, 1] };

/** Effective incoming / outgoing slope of key i (explicit value or the automatic monotone tangent). */
export function keySlopes(c: CurveValue, i: number): { tin: number; tout: number } {
  const k = c.keys[i];
  const auto = autoTangent(c.keys, i);
  return { tin: k.tin ?? auto, tout: k.tout ?? auto };
}

export function snapTo(v: number, grid: number): number {
  return grid > 0 ? Math.round(v / grid) * grid : v;
}

/** Insert a key at x (y defaults to the curve value there). The new key inherits the mode of the segment it splits. */
export function addKey(c: CurveValue, x: number, y?: number): { curve: CurveValue; index: number } {
  const out = cloneCurve(c);
  const yy = y ?? evalCurve(c, x);
  let i = 0;
  while (i < out.keys.length && out.keys[i].x < x) i++;
  const prev = out.keys[i - 1];
  const key: CurveKey = { x, y: yy };
  if (prev?.mode) key.mode = prev.mode;
  // splitting a smooth segment: keep the shape by giving the new key the local slope
  if (prev && (prev.mode ?? 'smooth') === 'smooth' && out.keys[i]) {
    const e = 1e-3;
    const s = (evalCurve(c, Math.min(x + e, 1)) - evalCurve(c, Math.max(x - e, 0))) / (Math.min(x + e, 1) - Math.max(x - e, 0) || 1);
    if (Number.isFinite(s)) {
      key.tin = s;
      key.tout = s;
    }
  }
  out.keys.splice(i, 0, key);
  return { curve: out, index: i };
}

export function removeKey(c: CurveValue, i: number, minKeys = 2): CurveValue {
  if (c.keys.length <= minKeys || i < 0 || i >= c.keys.length) return c;
  const out = cloneCurve(c);
  out.keys.splice(i, 1);
  return out;
}

export interface MoveOpts {
  bounds: EditBounds;
  /** Keep the first / last key at the x limits (default true for 0..1 curves). */
  lockEnds: boolean;
  snap: number;
}
/** Move key i to (x, y): clamped to the bounds and kept between its neighbours. Returns the new curve and the new index (unchanged). */
export function moveKey(c: CurveValue, i: number, x: number, y: number, o: MoveOpts): CurveValue {
  const out = cloneCurve(c);
  const k = out.keys[i];
  const n = out.keys.length;
  const [x0, x1] = o.bounds.xRange;
  const [y0, y1] = o.bounds.yRange;
  const gap = 1e-3;
  const lo = i === 0 ? x0 : out.keys[i - 1].x + gap;
  const hi = i === n - 1 ? x1 : out.keys[i + 1].x - gap;
  k.y = clamp(snapTo(y, o.snap), y0, y1);
  if (!(o.lockEnds && (i === 0 || i === n - 1))) k.x = clamp(snapTo(x, o.snap), lo, hi);
  return out;
}

/** Set a handle slope. `side`: which tangent; `mirror`: write both (joined tangents). */
export function setSlope(c: CurveValue, i: number, side: 'in' | 'out', slope: number, mirror: boolean): CurveValue {
  const out = cloneCurve(c);
  const k = out.keys[i];
  const s = clamp(slope, -1e4, 1e4);
  if (side === 'in' || mirror) k.tin = s;
  if (side === 'out' || mirror) k.tout = s;
  // writing one side only must keep the other side at its current effective value
  if (!mirror) {
    const eff = keySlopes(c, i);
    if (side === 'in') k.tout = c.keys[i].tout ?? eff.tout;
    else k.tin = c.keys[i].tin ?? eff.tin;
  }
  return out;
}

export function setKeyMode(c: CurveValue, i: number, mode: KeyMode): CurveValue {
  const out = cloneCurve(c);
  out.keys[i].mode = mode;
  return out;
}
export function setAllModes(c: CurveValue, mode: KeyMode): CurveValue {
  const out = cloneCurve(c);
  for (const k of out.keys) k.mode = mode;
  return out;
}
/** Remove explicit tangents of key i (back to the automatic monotone tangent). */
export function resetTangents(c: CurveValue, i: number): CurveValue {
  const out = cloneCurve(c);
  delete out.keys[i].tin;
  delete out.keys[i].tout;
  return out;
}
export function flattenTangents(c: CurveValue, i: number): CurveValue {
  const out = cloneCurve(c);
  out.keys[i].tin = 0;
  out.keys[i].tout = 0;
  return out;
}

/** Mirror in x (x -> 1 - x). Segment modes and tangents are reversed accordingly. */
export function flipCurve(c: CurveValue, bounds: EditBounds = UNIT_BOUNDS): CurveValue {
  const [x0, x1] = bounds.xRange;
  const n = c.keys.length;
  const keys: CurveKey[] = c.keys
    .map((k, i) => {
      const nk: CurveKey = { x: x0 + x1 - k.x, y: k.y };
      const src = c.keys[i - 1]; // the segment that ENDS at this key becomes the one that starts at the mirrored key
      if (src?.mode) nk.mode = src.mode;
      if (k.tout !== undefined) nk.tin = -k.tout;
      if (k.tin !== undefined) nk.tout = -k.tin;
      return nk;
    })
    .reverse();
  void n;
  return { keys };
}

/** Mirror in y (y -> 1 - y); slopes change sign. */
export function invertCurve(c: CurveValue, bounds: EditBounds = UNIT_BOUNDS): CurveValue {
  const [y0, y1] = bounds.yRange;
  const out = cloneCurve(c);
  for (const k of out.keys) {
    k.y = y0 + y1 - k.y;
    if (k.tin !== undefined) k.tin = -k.tin;
    if (k.tout !== undefined) k.tout = -k.tout;
  }
  return out;
}

/** Scale keys so that the curve spans the full x and y ranges (min / max of the sampled curve). */
export function normalizeCurve(c: CurveValue, bounds: EditBounds = UNIT_BOUNDS): CurveValue {
  const [x0, x1] = bounds.xRange;
  const [y0, y1] = bounds.yRange;
  const out = cloneCurve(c);
  const kx0 = out.keys[0].x;
  const kx1 = out.keys[out.keys.length - 1].x;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i <= 128; i++) {
    const v = evalCurve(c, kx0 + ((kx1 - kx0) * i) / 128);
    mn = Math.min(mn, v);
    mx = Math.max(mx, v);
  }
  const sx = kx1 - kx0 > 1e-9 ? (x1 - x0) / (kx1 - kx0) : 1;
  const sy = mx - mn > 1e-9 ? (y1 - y0) / (mx - mn) : 1;
  for (const k of out.keys) {
    k.x = x0 + (k.x - kx0) * sx;
    k.y = y0 + (k.y - mn) * sy;
    if (k.tin !== undefined) k.tin = (k.tin * sy) / sx;
    if (k.tout !== undefined) k.tout = (k.tout * sy) / sx;
  }
  return out;
}

/** Clipboard text (JSON) for copy / paste between widgets and sessions. */
export function curveToText(c: CurveValue): string {
  return JSON.stringify({ format: 'kekenik-curve', version: 1, keys: c.keys });
}
export function parseCurveText(text: string): CurveValue | null {
  try {
    const o = JSON.parse(text) as { format?: string; keys?: unknown };
    if (o.format !== 'kekenik-curve' || !Array.isArray(o.keys) || o.keys.length < 1) return null;
    const keys: CurveKey[] = [];
    for (const raw of o.keys as Record<string, unknown>[]) {
      if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) return null;
      const k: CurveKey = { x: raw.x, y: raw.y };
      if (raw.mode === 'smooth' || raw.mode === 'linear' || raw.mode === 'step') k.mode = raw.mode;
      if (typeof raw.tin === 'number' && Number.isFinite(raw.tin)) k.tin = raw.tin;
      if (typeof raw.tout === 'number' && Number.isFinite(raw.tout)) k.tout = raw.tout;
      keys.push(k);
    }
    keys.sort((a, b) => a.x - b.x);
    return { keys };
  } catch {
    return null;
  }
}

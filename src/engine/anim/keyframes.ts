/**
 * Keyframe channel math. PURE: no DOM, no GPU. Everything here is unit-tested (tests/anim.test.ts).
 *
 * A Channel is one animated scalar: sorted keys (time in FRAMES, value) + pre/post extrapolation.
 * A key's `interp` describes the segment that STARTS at the key:
 *   constant  hold the key value until the next key
 *   linear    straight line to the next key
 *   bezier    cubic Hermite (== cubic bezier whose handles sit at 1/3 of the segment) using the resolved slopes
 * Tangent modes (slopes are value-per-frame):
 *   auto    clamped Catmull-Rom (no overshoot: local extrema become flat)
 *   smooth  Catmull-Rom (may overshoot)
 *   flat    zero slope
 *   free    explicit `tin` / `tout` (unified = both equal unless `broken`)
 * Channels are treated as IMMUTABLE by every editing helper (they return new objects) because slope resolution is cached
 * per channel object.
 */
import { lerp } from '../../shared/util';
export type Interp = 'constant' | 'linear' | 'bezier';
export type TangentMode = 'auto' | 'smooth' | 'flat' | 'free';
export type Extrapolation = 'constant' | 'linear' | 'cycle' | 'cycle_offset' | 'pingpong';

export const INTERPS: Interp[] = ['constant', 'linear', 'bezier'];
export const TANGENT_MODES: TangentMode[] = ['auto', 'smooth', 'flat', 'free'];
export const EXTRAPOLATIONS: Extrapolation[] = ['constant', 'linear', 'cycle', 'cycle_offset', 'pingpong'];

export interface Key {
  /** Time in frames (may be fractional). */
  t: number;
  v: number;
  interp: Interp;
  mode: TangentMode;
  /** Incoming / outgoing slopes (only used when mode === 'free'). */
  tin?: number;
  tout?: number;
  /** Free tangents are edited independently (otherwise editing one mirrors the other). */
  broken?: boolean;
}

export interface Channel {
  keys: Key[];
  pre: Extrapolation;
  post: Extrapolation;
}

export const newKey = (t: number, v: number, o: Partial<Key> = {}): Key => ({ t, v, interp: 'bezier', mode: 'auto', ...o });
export const emptyChannel = (): Channel => ({ keys: [], pre: 'constant', post: 'constant' });
export const channelOf = (keys: Key[], pre: Extrapolation = 'constant', post: Extrapolation = pre): Channel => ({ keys: sortKeys(keys), pre, post });

export function sortKeys(keys: Key[]): Key[] {
  return [...keys].sort((a, b) => a.t - b.t);
}

const isCycleLike = (e: Extrapolation): boolean => e === 'cycle' || e === 'cycle_offset';

/* ------------------------------------------------------------------------------------------------ slopes */

export interface ResolvedSlopes {
  tin: Float64Array;
  tout: Float64Array;
}
const slopeCache = new WeakMap<Channel, { sig: number; r: ResolvedSlopes }>();
const sigOf = (ch: Channel): number => {
  let s = ch.keys.length * 7919 + (isCycleLike(ch.pre) ? 3 : 0) + (isCycleLike(ch.post) ? 5 : 0);
  for (const k of ch.keys) s += k.t * 1.37 + k.v * 2.11 + (k.tin ?? 0) * 0.31 + (k.tout ?? 0) * 0.17 + (k.mode === 'auto' ? 1 : k.mode === 'smooth' ? 2 : k.mode === 'flat' ? 3 : 4);
  return s;
};

/** Resolve the in / out slope of every key (value per frame). Cached per channel object. */
export function resolveSlopes(ch: Channel): ResolvedSlopes {
  const hit = slopeCache.get(ch);
  const sig = sigOf(ch);
  if (hit && hit.sig === sig) return hit.r;
  const K = ch.keys;
  const n = K.length;
  const tin = new Float64Array(n);
  const tout = new Float64Array(n);
  const cyc = n >= 2 && isCycleLike(ch.pre) && isCycleLike(ch.post);
  const period = n >= 2 ? K[n - 1].t - K[0].t : 0;
  const off = cyc && ch.post === 'cycle_offset' ? K[n - 1].v - K[0].v : 0;
  /** Neighbour accessors that wrap around when the channel cycles. */
  const prevOf = (i: number): { t: number; v: number } | null => {
    if (i > 0) return K[i - 1];
    if (cyc && period > 0) return { t: K[n - 2].t - period, v: K[n - 2].v - off };
    return null;
  };
  const nextOf = (i: number): { t: number; v: number } | null => {
    if (i < n - 1) return K[i + 1];
    if (cyc && period > 0) return { t: K[1].t + period, v: K[1].v + off };
    return null;
  };
  for (let i = 0; i < n; i++) {
    const k = K[i];
    const p = prevOf(i);
    const q = nextOf(i);
    let s = 0;
    if (k.mode === 'flat') s = 0;
    else if (k.mode === 'free') {
      tin[i] = k.tin ?? 0;
      tout[i] = k.broken ? (k.tout ?? 0) : (k.tin ?? k.tout ?? 0);
      if (!k.broken && k.tout !== undefined && k.tin === undefined) tin[i] = k.tout;
      continue;
    } else {
      if (p && q) {
        s = (q.v - p.v) / Math.max(1e-9, q.t - p.t);
        if (k.mode === 'auto') {
          // clamped (monotone, Fritsch-Carlson) tangent: flat at local extrema, never steeper than 3x the shallower neighbour secant
          const dp = (k.v - p.v) / Math.max(1e-9, k.t - p.t);
          const dn = (q.v - k.v) / Math.max(1e-9, q.t - k.t);
          s = dp * dn <= 0 ? 0 : Math.sign(s) * Math.min(Math.abs(s), 3 * Math.min(Math.abs(dp), Math.abs(dn)));
        }
      } else if (q) s = k.mode === 'auto' ? 0 : (q.v - k.v) / Math.max(1e-9, q.t - k.t);
      else if (p) s = k.mode === 'auto' ? 0 : (k.v - p.v) / Math.max(1e-9, k.t - p.t);
    }
    tin[i] = s;
    tout[i] = s;
  }
  const r = { tin, tout };
  slopeCache.set(ch, { sig, r });
  return r;
}

/** Cubic Hermite on [t0,t1] with slopes m0 (out of key0) and m1 (into key1). */
export function hermite(t0: number, v0: number, m0: number, t1: number, v1: number, m1: number, t: number): number {
  const dt = t1 - t0;
  if (dt <= 1e-12) return v1;
  const u = (t - t0) / dt;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * dt * m0 + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * dt * m1;
}

/** Bezier handle points of the segment starting at key i (for the curve editor): [p0,c0,c1,p1] in (frame,value). */
export function segmentBezier(ch: Channel, i: number): [number, number][] | null {
  const K = ch.keys;
  if (i < 0 || i >= K.length - 1) return null;
  const s = resolveSlopes(ch);
  const a = K[i];
  const b = K[i + 1];
  const dt = b.t - a.t;
  return [
    [a.t, a.v],
    [a.t + dt / 3, a.v + (s.tout[i] * dt) / 3],
    [b.t - dt / 3, b.v - (s.tin[i + 1] * dt) / 3],
    [b.t, b.v],
  ];
}

/* ------------------------------------------------------------------------------------------------ evaluation */

function findSegment(K: Key[], t: number): number {
  let lo = 0;
  let hi = K.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (K[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

function evalInside(ch: Channel, t: number): number {
  const K = ch.keys;
  const i = findSegment(K, t);
  const a = K[i];
  const b = K[i + 1];
  if (!b) return a.v;
  if (t >= b.t) return b.v;
  switch (a.interp) {
    case 'constant':
      return a.v;
    case 'linear':
      return lerp(a.v, b.v, (t - a.t) / Math.max(1e-12, b.t - a.t));
    default: {
      const s = resolveSlopes(ch);
      return hermite(a.t, a.v, s.tout[i], b.t, b.v, s.tin[i + 1], t);
    }
  }
}

/** Slope used for linear extrapolation at an end of the channel. */
function endSlope(ch: Channel, last: boolean): number {
  const K = ch.keys;
  const n = K.length;
  if (n < 2) return 0;
  const s = resolveSlopes(ch);
  if (last) return K[n - 2].interp === 'bezier' ? s.tin[n - 1] : (K[n - 1].v - K[n - 2].v) / Math.max(1e-12, K[n - 1].t - K[n - 2].t);
  return K[0].interp === 'bezier' ? s.tout[0] : (K[1].v - K[0].v) / Math.max(1e-12, K[1].t - K[0].t);
}

const mod = (a: number, b: number): number => ((a % b) + b) % b;

/** Evaluate a channel at `t` (frames). Empty channel -> `fallback`. */
export function evalChannel(ch: Channel, t: number, fallback = 0): number {
  const K = ch.keys;
  const n = K.length;
  if (n === 0) return fallback;
  if (n === 1) return K[0].v;
  const t0 = K[0].t;
  const t1 = K[n - 1].t;
  if (t >= t0 && t <= t1) return evalInside(ch, t);
  const period = t1 - t0;
  const before = t < t0;
  const mode = before ? ch.pre : ch.post;
  if (period <= 1e-12) return before ? K[0].v : K[n - 1].v;
  switch (mode) {
    case 'constant':
      return before ? K[0].v : K[n - 1].v;
    case 'linear':
      return before ? K[0].v + endSlope(ch, false) * (t - t0) : K[n - 1].v + endSlope(ch, true) * (t - t1);
    case 'cycle': {
      return evalInside(ch, t0 + mod(t - t0, period));
    }
    case 'cycle_offset': {
      const cycles = Math.floor((t - t0) / period);
      return evalInside(ch, t0 + mod(t - t0, period)) + cycles * (K[n - 1].v - K[0].v);
    }
    case 'pingpong': {
      const m = mod(t - t0, 2 * period);
      return evalInside(ch, t0 + (m <= period ? m : 2 * period - m));
    }
  }
}

/* ------------------------------------------------------------------------------------------------ editing (immutable) */

export const EPS_T = 1e-4;
export const keyIndexAt = (ch: Channel, t: number, eps = EPS_T): number => ch.keys.findIndex((k) => Math.abs(k.t - t) <= eps);

/** Insert (or overwrite when a key exists at `t`) a key. New keys inherit interp / mode of the previous key. */
export function setKey(ch: Channel, t: number, v: number, o: Partial<Key> = {}): Channel {
  const i = keyIndexAt(ch, t);
  const keys = [...ch.keys];
  if (i >= 0) keys[i] = { ...keys[i], v, ...o };
  else {
    const prev = [...keys].reverse().find((k) => k.t < t) ?? keys[0];
    keys.push(newKey(t, v, { interp: prev?.interp ?? 'bezier', mode: prev?.mode === 'free' ? 'auto' : (prev?.mode ?? 'auto'), ...o }));
  }
  return { ...ch, keys: sortKeys(keys) };
}

export function removeKeys(ch: Channel, indices: Iterable<number>): Channel {
  const rm = new Set(indices);
  return { ...ch, keys: ch.keys.filter((_, i) => !rm.has(i)) };
}

/** Move the listed keys by (dt, dv). Keys that would land on an unselected key replace it. Returns the channel and the new indices. */
export function moveKeys(ch: Channel, indices: Iterable<number>, dt: number, dv: number): { channel: Channel; indices: number[] } {
  const sel = new Set(indices);
  const moved: Key[] = [];
  const kept: Key[] = [];
  ch.keys.forEach((k, i) => (sel.has(i) ? moved.push({ ...k, t: k.t + dt, v: k.v + dv }) : kept.push(k)));
  const merged = kept.filter((k) => !moved.some((m) => Math.abs(m.t - k.t) <= EPS_T));
  const keys = sortKeys([...merged, ...moved]);
  return { channel: { ...ch, keys }, indices: moved.map((m) => keys.indexOf(m)) };
}

/** Scale the time of the listed keys around `pivot` (frames). */
export function scaleKeysTime(ch: Channel, indices: Iterable<number>, pivot: number, factor: number): Channel {
  const sel = new Set(indices);
  const keys = ch.keys.map((k, i) => (sel.has(i) ? { ...k, t: pivot + (k.t - pivot) * factor } : k));
  return { ...ch, keys: sortKeys(keys) };
}

export const setInterp = (ch: Channel, indices: Iterable<number>, interp: Interp): Channel => {
  const sel = new Set(indices);
  return { ...ch, keys: ch.keys.map((k, i) => (sel.has(i) ? { ...k, interp } : k)) };
};

export function setTangentMode(ch: Channel, indices: Iterable<number>, mode: TangentMode, broken?: boolean): Channel {
  const sel = new Set(indices);
  const s = resolveSlopes(ch);
  return {
    ...ch,
    keys: ch.keys.map((k, i) => {
      if (!sel.has(i)) return k;
      const o: Key = { ...k, mode, interp: k.interp === 'constant' ? 'bezier' : k.interp };
      if (mode === 'free') {
        o.tin = k.mode === 'free' ? k.tin : s.tin[i];
        o.tout = k.mode === 'free' ? k.tout : s.tout[i];
      }
      if (broken !== undefined) o.broken = broken;
      return o;
    }),
  };
}

/** Free-tangent edit of one key (mirrors the other side unless the key is broken). */
export function setTangent(ch: Channel, index: number, side: 'in' | 'out', slope: number): Channel {
  const s = resolveSlopes(ch);
  return {
    ...ch,
    keys: ch.keys.map((k, i) => {
      if (i !== index) return k;
      const cur = { tin: k.mode === 'free' ? (k.tin ?? s.tin[i]) : s.tin[i], tout: k.mode === 'free' ? (k.tout ?? s.tout[i]) : s.tout[i] };
      const nx = { ...cur, ...(side === 'in' ? { tin: slope } : { tout: slope }) };
      if (!k.broken) nx.tin = nx.tout = slope;
      return { ...k, mode: 'free', interp: 'bezier', tin: nx.tin, tout: nx.tout };
    }),
  };
}

/** Flatten: zero slopes + bezier interpolation. */
export const flattenKeys = (ch: Channel, indices: Iterable<number>): Channel => setInterp(setTangentMode(ch, indices, 'flat'), indices, 'bezier');

/** Smooth: auto tangents (clamped Catmull-Rom). */
export const smoothKeys = (ch: Channel, indices: Iterable<number>): Channel => setInterp(setTangentMode(ch, indices, 'auto', false), indices, 'bezier');

/** Mirror values around `pivot` (value) or times around `pivot` (frame). */
export function mirrorKeys(ch: Channel, indices: Iterable<number>, axis: 'value' | 'time', pivot: number): Channel {
  const sel = new Set(indices);
  const s = resolveSlopes(ch);
  const keys = ch.keys.map((k, i) => {
    if (!sel.has(i)) return k;
    if (axis === 'value') return { ...k, v: 2 * pivot - k.v, mode: 'free' as const, tin: -s.tin[i], tout: -s.tout[i] };
    return { ...k, t: 2 * pivot - k.t, mode: 'free' as const, tin: -s.tout[i], tout: -s.tin[i] };
  });
  return { ...ch, keys: sortKeys(keys) };
}

/**
 * LOOP MATCH: make the last key equal the first (value + slopes) so that the cycle has no pop and no kink. Optionally
 * place the last key at `endFrame`. With `offset` the last value is kept (cycle_offset style) and only slopes are matched.
 * Extrapolation becomes `cycle` (or `cycle_offset` when `offset`).
 */
export function loopMatch(ch: Channel, endFrame?: number, offset = false): Channel {
  const K = ch.keys;
  if (K.length < 2) return ch;
  const s = resolveSlopes(ch);
  const first = K[0];
  const last = K[K.length - 1];
  const avg = (s.tout[0] + s.tin[K.length - 1]) / 2;
  const keys = K.map((k) => ({ ...k }));
  keys[0] = { ...first, mode: 'free', interp: first.interp === 'constant' ? 'constant' : 'bezier', tin: avg, tout: avg, broken: false };
  keys[K.length - 1] = {
    ...last,
    t: endFrame !== undefined && endFrame > first.t ? endFrame : last.t,
    v: offset ? last.v : first.v,
    mode: 'free',
    interp: last.interp,
    tin: avg,
    tout: avg,
    broken: false,
  };
  const x = offset ? 'cycle_offset' : 'cycle';
  return { keys: sortKeys(keys), pre: x, post: x };
}

/** Residual of a loop: |value jump| and |slope jump| between the end and the start of the cycle. */
export function loopError(ch: Channel): { value: number; slope: number } {
  const K = ch.keys;
  if (K.length < 2) return { value: 0, slope: 0 };
  const s = resolveSlopes(ch);
  return { value: Math.abs(K[K.length - 1].v - K[0].v), slope: Math.abs(s.tin[K.length - 1] - s.tout[0]) };
}

export const snapTime = (t: number, step = 1): number => Math.round(t / step) * step;

/** Value range [min,max] of a channel over [t0,t1] (sampled; includes the keys). */
export function channelRange(ch: Channel, t0: number, t1: number, samples = 64): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const v = evalChannel(ch, t0 + ((t1 - t0) * i) / samples);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  for (const k of ch.keys) {
    lo = Math.min(lo, k.v);
    hi = Math.max(hi, k.v);
  }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

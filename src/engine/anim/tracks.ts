/**
 * Animation TRACKS: how a parameter value maps to keyframe channels. PURE.
 *
 *   float / int / seed / bool / enum   1 channel  (bool / enum / seed are stepped: interp 'constant'; enum stores the option index)
 *   vec2 / vec3 / color                2 / 3 / 4 channels (one per component, edited separately in the curve editor)
 *   gradient / curve                   SNAPSHOT track: whole values at times, linear blend when the structure matches
 *                                      (same number of stops / keys), otherwise held (stepped). Covers "gradient stops" and
 *                                      "curve points" animation.
 * Tracks live in `NodeData.anim[paramId]` (JSON, saved with the project).
 */
import type { CurveValue, GradientValue, ParamDef, ParamValue } from '../params/schema';
import { cloneValue } from '../params/schema';
import { EPS_T, channelOf, evalChannel, keyIndexAt, newKey, removeKeys, setKey, sortKeys, type Channel, type Extrapolation, type Key } from './keyframes';

export interface NumTrack {
  kind: 'num';
  ch: Channel[];
}
export interface Snap {
  t: number;
  v: ParamValue;
  /** 'linear' blends towards the next snapshot (when compatible); 'constant' holds. */
  interp: 'constant' | 'linear';
}
export interface SnapTrack {
  kind: 'snap';
  snaps: Snap[];
  pre: Extrapolation;
  post: Extrapolation;
}
export type AnimTrack = NumTrack | SnapTrack;
export type NodeAnim = Record<string, AnimTrack>;

const NUM_TYPES = new Set(['float', 'int', 'seed', 'bool', 'enum', 'vec2', 'vec3', 'color']);

/** Can this parameter be keyframed? `animatable: false` opts out; the common Texture tab is never animated. */
export function isAnimatableDef(def: ParamDef): boolean {
  if (def.animatable === false) return false;
  if (def.id.startsWith('tex_')) return false;
  if (def.animatable === true) return NUM_TYPES.has(def.type) || def.type === 'gradient' || def.type === 'curve';
  return NUM_TYPES.has(def.type) || def.type === 'gradient' || def.type === 'curve';
}

export const trackKindOf = (def: ParamDef): 'num' | 'snap' => (def.type === 'gradient' || def.type === 'curve' ? 'snap' : 'num');
export const channelCountOf = (def: ParamDef): number => (def.type === 'vec2' ? 2 : def.type === 'vec3' ? 3 : def.type === 'color' ? 4 : 1);
export const isStepped = (def: ParamDef): boolean => def.type === 'bool' || def.type === 'enum' || def.type === 'seed';
export const channelLabels = (def: ParamDef): string[] => {
  switch (def.type) {
    case 'vec2':
      return ['X', 'Y'];
    case 'vec3':
      return ['X', 'Y', 'Z'];
    case 'color':
      return ['R', 'G', 'B', 'A'];
    default:
      return [''];
  }
};

/** Param value -> numbers (one per channel). */
export function toChannelValues(def: ParamDef, v: ParamValue): number[] {
  switch (def.type) {
    case 'bool':
      return [v ? 1 : 0];
    case 'enum':
      return [Math.max(0, def.options.findIndex((o) => o.value === v))];
    case 'vec2':
    case 'vec3':
    case 'color': {
      const n = channelCountOf(def);
      const a = Array.isArray(v) ? (v as number[]) : [];
      return Array.from({ length: n }, (_, i) => (typeof a[i] === 'number' ? a[i] : def.type === 'color' && i === 3 ? 1 : 0));
    }
    default:
      return [typeof v === 'number' ? v : 0];
  }
}

/** Numbers -> param value (callers still pass the result through coerceParam). */
export function fromChannelValues(def: ParamDef, nums: number[]): ParamValue {
  switch (def.type) {
    case 'bool':
      return nums[0] >= 0.5;
    case 'enum': {
      const i = Math.max(0, Math.min(def.options.length - 1, Math.round(nums[0])));
      return def.options[i]?.value ?? (def.default as string);
    }
    case 'int':
      return Math.round(nums[0]);
    case 'seed':
      return Math.max(0, Math.round(nums[0]));
    case 'vec2':
    case 'vec3':
    case 'color':
      return nums.slice();
    default:
      return nums[0];
  }
}

const defaultInterp = (def: ParamDef): Key['interp'] => (isStepped(def) ? 'constant' : def.type === 'int' ? 'linear' : 'bezier');

/* ------------------------------------------------------------------------------------------------ snapshots */

function lerpNum(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}
const isGradient = (v: ParamValue): v is GradientValue => !!v && typeof v === 'object' && 'stops' in (v as object);
const isCurve = (v: ParamValue): v is CurveValue => !!v && typeof v === 'object' && 'keys' in (v as object);

/** Blend two compatible gradient / curve values; null when the structures differ (caller holds). */
export function blendSnapshots(a: ParamValue, b: ParamValue, u: number): ParamValue | null {
  if (isGradient(a) && isGradient(b)) {
    if (a.stops.length !== b.stops.length) return null;
    return {
      ...a,
      stops: a.stops.map((s, i) => ({ pos: lerpNum(s.pos, b.stops[i].pos, u), color: s.color.map((c, k) => lerpNum(c, b.stops[i].color[k], u)) as typeof s.color })),
    };
  }
  if (isCurve(a) && isCurve(b)) {
    if (a.keys.length !== b.keys.length) return null;
    return {
      keys: a.keys.map((k, i) => {
        const o = b.keys[i];
        const r = { ...k, x: lerpNum(k.x, o.x, u), y: lerpNum(k.y, o.y, u) };
        if (k.tin !== undefined && o.tin !== undefined) r.tin = lerpNum(k.tin, o.tin, u);
        if (k.tout !== undefined && o.tout !== undefined) r.tout = lerpNum(k.tout, o.tout, u);
        return r;
      }),
    };
  }
  return null;
}

function evalSnap(tr: SnapTrack, frame: number): ParamValue | undefined {
  const S = tr.snaps;
  const n = S.length;
  if (n === 0) return undefined;
  if (n === 1) return S[0].v;
  const t0 = S[0].t;
  const t1 = S[n - 1].t;
  const period = t1 - t0;
  let t = frame;
  const mode = frame < t0 ? tr.pre : tr.post;
  if ((frame < t0 || frame > t1) && period > 1e-9) {
    if (mode === 'cycle' || mode === 'cycle_offset') t = t0 + ((((frame - t0) % period) + period) % period);
    else if (mode === 'pingpong') {
      const m = (((frame - t0) % (2 * period)) + 2 * period) % (2 * period);
      t = t0 + (m <= period ? m : 2 * period - m);
    }
  }
  if (t <= t0) return S[0].v;
  if (t >= t1) return S[n - 1].v;
  let i = 0;
  while (i < n - 2 && S[i + 1].t <= t) i++;
  const a = S[i];
  const b = S[i + 1];
  if (a.interp === 'linear') {
    const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
    return blendSnapshots(a.v, b.v, u) ?? a.v;
  }
  return a.v;
}

/* ------------------------------------------------------------------------------------------------ evaluation */

/** Value of a track at `frame`, or undefined when the track has no keys. */
export function evalTrack(track: AnimTrack, def: ParamDef, frame: number): ParamValue | undefined {
  if (track.kind === 'snap') return evalSnap(track, frame);
  if (track.ch.length === 0 || track.ch.every((c) => c.keys.length === 0)) return undefined;
  const fb = toChannelValues(def, def.default as ParamValue);
  return fromChannelValues(def, track.ch.map((c, i) => evalChannel(c, frame, fb[i] ?? 0)));
}

export function trackIsEmpty(t: AnimTrack | undefined): boolean {
  return !t || (t.kind === 'snap' ? t.snaps.length === 0 : t.ch.every((c) => c.keys.length === 0));
}

/** Sorted unique key frames across all channels (dopesheet row). */
export function trackKeyFrames(t: AnimTrack): number[] {
  const set: number[] = [];
  const add = (f: number): void => {
    if (!set.some((x) => Math.abs(x - f) <= EPS_T)) set.push(f);
  };
  if (t.kind === 'snap') t.snaps.forEach((s) => add(s.t));
  else t.ch.forEach((c) => c.keys.forEach((k) => add(k.t)));
  return set.sort((a, b) => a - b);
}

export const hasKeyAt = (t: AnimTrack | undefined, frame: number): boolean => !!t && trackKeyFrames(t).some((f) => Math.abs(f - frame) <= EPS_T);

/* ------------------------------------------------------------------------------------------------ editing (immutable) */

/** Insert / overwrite a key at `frame` holding `value` (creates the track when missing). */
export function setTrackKey(track: AnimTrack | undefined, def: ParamDef, frame: number, value: ParamValue): AnimTrack {
  if (trackKindOf(def) === 'snap') {
    const prev = track && track.kind === 'snap' ? track : ({ kind: 'snap', snaps: [], pre: 'constant', post: 'constant' } as SnapTrack);
    const snaps = prev.snaps.filter((s) => Math.abs(s.t - frame) > EPS_T);
    snaps.push({ t: frame, v: cloneValue(value), interp: 'linear' });
    snaps.sort((a, b) => a.t - b.t);
    return { ...prev, snaps };
  }
  const vals = toChannelValues(def, value);
  const n = channelCountOf(def);
  const prev = track && track.kind === 'num' && track.ch.length === n ? track : ({ kind: 'num', ch: Array.from({ length: n }, () => channelOf([])) } as NumTrack);
  const interp = defaultInterp(def);
  return { kind: 'num', ch: prev.ch.map((c, i) => setKey(c, frame, vals[i], keyIndexAt(c, frame) >= 0 ? {} : { interp })) };
}

/** Remove the key at `frame` from every channel. Returns undefined when nothing is left. */
export function removeTrackKey(track: AnimTrack, frame: number): AnimTrack | undefined {
  let out: AnimTrack;
  if (track.kind === 'snap') out = { ...track, snaps: track.snaps.filter((s) => Math.abs(s.t - frame) > EPS_T) };
  else out = { kind: 'num', ch: track.ch.map((c) => removeKeys(c, c.keys.map((k, i) => (Math.abs(k.t - frame) <= EPS_T ? i : -1)).filter((i) => i >= 0))) };
  return trackIsEmpty(out) ? undefined : out;
}

/** Move every key at one of `frames` by `dt` frames (all channels). */
export function moveTrackKeys(track: AnimTrack, frames: number[], dt: number): AnimTrack {
  const hit = (t: number): boolean => frames.some((f) => Math.abs(f - t) <= EPS_T);
  if (track.kind === 'snap') {
    const moved = track.snaps.map((s) => (hit(s.t) ? { ...s, t: s.t + dt } : s));
    // a moved key replaces an unmoved key at the same time
    const keep = moved.filter((s, i) => hit(track.snaps[i].t) || !moved.some((m, j) => hit(track.snaps[j].t) && j !== i && Math.abs(m.t - s.t) <= EPS_T));
    return { ...track, snaps: keep.sort((a, b) => a.t - b.t) };
  }
  return {
    kind: 'num',
    ch: track.ch.map((c) => {
      const moved: Key[] = [];
      const kept: Key[] = [];
      for (const k of c.keys) (hit(k.t) ? moved : kept).push(hit(k.t) ? { ...k, t: k.t + dt } : k);
      return { ...c, keys: sortKeys([...kept.filter((k) => !moved.some((m) => Math.abs(m.t - k.t) <= EPS_T)), ...moved]) };
    }),
  };
}

/** Scale key times around `pivot`. */
export function scaleTrackKeys(track: AnimTrack, frames: number[], pivot: number, factor: number): AnimTrack {
  const hit = (t: number): boolean => frames.some((f) => Math.abs(f - t) <= EPS_T);
  const map = (t: number): number => pivot + (t - pivot) * factor;
  if (track.kind === 'snap') return { ...track, snaps: track.snaps.map((s) => (hit(s.t) ? { ...s, t: map(s.t) } : s)).sort((a, b) => a.t - b.t) };
  return { kind: 'num', ch: track.ch.map((c) => ({ ...c, keys: sortKeys(c.keys.map((k) => (hit(k.t) ? { ...k, t: map(k.t) } : k))) })) };
}

/** Set pre / post extrapolation of every channel. */
export function setTrackExtrapolation(track: AnimTrack, pre: Extrapolation, post: Extrapolation = pre): AnimTrack {
  return track.kind === 'snap' ? { ...track, pre, post } : { kind: 'num', ch: track.ch.map((c) => ({ ...c, pre, post })) };
}

/** Samples of a track at the given frames (used by loop-match tests and the seam verifier). */
export const sampleTrack = (track: AnimTrack, def: ParamDef, frames: number[]): (ParamValue | undefined)[] => frames.map((f) => evalTrack(track, def, f));

export const newNumTrackFromKeys = (def: ParamDef, keys: { t: number; v: ParamValue }[]): AnimTrack => {
  let tr: AnimTrack | undefined;
  for (const k of keys) tr = setTrackKey(tr, def, k.t, k.v);
  return tr ?? { kind: 'num', ch: [] };
};
export { newKey };

/* ------------------------------------------------------------------------------------------------ persistence */

const cloneJson = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
export const cloneAnim = (a: NodeAnim | undefined): NodeAnim | undefined => (a ? cloneJson(a) : undefined);

const okNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validate untrusted JSON against the param defs; drops tracks for unknown / non-animatable params. */
export function sanitizeNodeAnim(raw: unknown, defs: ParamDef[]): { anim: NodeAnim | undefined; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') return { anim: undefined, warnings };
  const out: NodeAnim = {};
  for (const [pid, tr] of Object.entries(raw as Record<string, unknown>)) {
    const def = defs.find((d) => d.id === pid);
    if (!def || !isAnimatableDef(def)) {
      warnings.push(`animation of unknown / non-animatable param "${pid}" dropped`);
      continue;
    }
    const t = tr as Partial<AnimTrack> | null;
    if (!t || typeof t !== 'object') continue;
    if (trackKindOf(def) === 'snap') {
      if (t.kind !== 'snap' || !Array.isArray(t.snaps)) continue;
      const snaps = t.snaps.filter((s) => okNum(s?.t) && s.v !== undefined).map((s) => ({ t: s.t, v: s.v, interp: s.interp === 'constant' ? 'constant' : 'linear' }) as Snap);
      if (snaps.length) out[pid] = { kind: 'snap', snaps: snaps.sort((a, b) => a.t - b.t), pre: (t.pre ?? 'constant') as Extrapolation, post: (t.post ?? 'constant') as Extrapolation };
      continue;
    }
    if (t.kind !== 'num' || !Array.isArray(t.ch) || t.ch.length !== channelCountOf(def)) continue;
    const ch: Channel[] = t.ch.map((c) => ({
      keys: sortKeys((Array.isArray(c?.keys) ? c.keys : []).filter((k) => okNum(k?.t) && okNum(k?.v)).map((k) => ({ ...newKey(k.t, k.v), ...k }))),
      pre: (c?.pre ?? 'constant') as Extrapolation,
      post: (c?.post ?? 'constant') as Extrapolation,
    }));
    const tk: AnimTrack = { kind: 'num', ch };
    if (!trackIsEmpty(tk)) out[pid] = tk;
  }
  return { anim: Object.keys(out).length ? out : undefined, warnings };
}

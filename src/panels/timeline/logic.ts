/** Pure helpers of the timeline panel, kept out of panel.ts so they are unit-tested without a DOM. */
import { EPS_T, type Interp } from '../../engine/anim/keyframes';
import type { ParamValue } from '../../engine/params/schema';
import { removeTrackKey, trackKeyFrames, type AnimTrack } from '../../engine/anim/tracks';

/** Selection key of one key row / frame. */
export const selKey = (nodeId: string, paramId: string, frame: number): string => `${nodeId}\u0000${paramId}\u0000${Math.round(frame * 1000)}`;

export const rowFrames = (t: AnimTrack | undefined): number[] => (t ? trackKeyFrames(t) : []);
export const hasKey = (t: AnimTrack | undefined, frame: number): boolean => rowFrames(t).some((f) => Math.abs(f - frame) <= EPS_T);

/** Compact value text for the dopesheet label column. */
export function shortValue(v: ParamValue | undefined): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === 'boolean') return v ? 'on' : 'off';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((x) => (Number.isInteger(x) ? x : x.toFixed(2))).join(', ');
  return 'keyed';
}

/** Apply an interpolation change (or deletion) to the keys at `frames` of every channel / snapshot. */
export function mapTrackKeys(track: AnimTrack, frames: number[], op: Interp | 'delete'): AnimTrack | undefined {
  const hit = (t: number): boolean => frames.some((f) => Math.abs(f - t) <= EPS_T);
  if (op === 'delete') {
    let out: AnimTrack | undefined = track;
    for (const f of frames) out = out && removeTrackKey(out, f);
    return out;
  }
  if (track.kind === 'snap') return { ...track, snaps: track.snaps.map((s) => (hit(s.t) ? { ...s, interp: op === 'constant' ? 'constant' : 'linear' } : s)) };
  return { kind: 'num', ch: track.ch.map((c) => ({ ...c, keys: c.keys.map((k) => (hit(k.t) ? { ...k, interp: op, mode: op === 'bezier' && k.mode === 'free' ? 'auto' : k.mode } : k)) })) };
}

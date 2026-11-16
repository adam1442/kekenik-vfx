/**
 * AnimationEditor: THE API the Timeline, Curve Editor and Properties panel use to change animation. Every
 * mutation is a Command on the project's CommandStack, so it is undoable, coalesced while dragging, and marks the project dirty.
 */
import type { Command } from '../commands/command';
import type { GraphEditor } from '../commands/graph-commands';
import type { Graph } from '../graph/graph';
import { cloneValue, type ParamDef, type ParamValue } from '../params/schema';
import { valueAt } from './animator';
import { sanitizeTimeline, type TimelineSettings } from './timebase';
import { cloneAnim, isAnimatableDef, removeTrackKey, setTrackKey, trackIsEmpty, type AnimTrack } from './tracks';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Replace one track (before -> after). Merges while dragging (same mergeKey). */
export class SetTrackCommand implements Command {
  readonly mergeKey?: string;
  private before: AnimTrack | undefined;
  private after: AnimTrack | undefined;
  constructor(
    private g: Graph,
    private nodeId: string,
    private paramId: string,
    after: AnimTrack | undefined,
    readonly label: string,
    mergeKey?: string,
    /** Gesture commits: the track as it was BEFORE the live preview started. */
    explicitBefore?: { track: AnimTrack | undefined },
  ) {
    this.mergeKey = mergeKey ? `anim:${nodeId}:${paramId}:${mergeKey}` : undefined;
    this.before = explicitBefore ? (explicitBefore.track ? clone(explicitBefore.track) : undefined) : g.nodes.get(nodeId)?.anim?.[paramId] ? clone(g.nodes.get(nodeId)!.anim![paramId]) : undefined;
    this.after = after ? clone(after) : undefined;
  }
  do(): void {
    this.g.setNodeTrack(this.nodeId, this.paramId, this.after ? clone(this.after) : undefined);
  }
  undo(): void {
    this.g.setNodeTrack(this.nodeId, this.paramId, this.before ? clone(this.before) : undefined);
  }
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetTrackCommand) || next.mergeKey !== this.mergeKey) return false;
    this.after = next.after;
    return true;
  }
}

class SetTimelineCommand implements Command {
  readonly mergeKey?: string;
  private before: TimelineSettings;
  private after: TimelineSettings;
  constructor(
    private g: Graph,
    patch: Partial<TimelineSettings>,
    readonly label: string,
    mergeKey?: string,
  ) {
    this.before = clone(g.timeline);
    this.after = sanitizeTimeline({ ...g.timeline, ...patch });
    this.mergeKey = mergeKey ? `timeline:${mergeKey}` : undefined;
  }
  do(): void {
    this.g.setTimeline(clone(this.after));
  }
  undo(): void {
    this.g.setTimeline(clone(this.before));
  }
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetTimelineCommand) || next.mergeKey !== this.mergeKey) return false;
    this.after = next.after;
    return true;
  }
}

/** Clipboard of copied keys (module level: survives panel re-creation). frames are relative to the earliest copied key. */
export interface KeyClip {
  items: { paramId: string; track: AnimTrack }[];
  span: number;
}
let clip: KeyClip | null = null;
export const keyClipboard = (): KeyClip | null => clip;

export class AnimationEditor {
  constructor(private editor: GraphEditor) {}
  private get g(): Graph {
    return this.editor.graph;
  }

  def(nodeId: string, paramId: string): ParamDef | undefined {
    return this.g.expandedOf(nodeId)?.params.find((p) => p.id === paramId);
  }
  canAnimate(nodeId: string, paramId: string): boolean {
    const d = this.def(nodeId, paramId);
    return !!d && isAnimatableDef(d);
  }

  /** Replace a whole track (curve editor / dopesheet operations build the new track). */
  updateTrack(nodeId: string, paramId: string, track: AnimTrack | undefined, label: string, mergeKey?: string): void {
    const t = track && !trackIsEmpty(track) ? track : undefined;
    this.editor.stack.execute(new SetTrackCommand(this.g, nodeId, paramId, t, label, mergeKey));
  }

  /** Live preview of a gesture (drag): writes the track WITHOUT an undo entry. Finish with `commitGesture`. */
  preview(nodeId: string, paramId: string, track: AnimTrack | undefined): void {
    this.g.setNodeTrack(nodeId, paramId, track && !trackIsEmpty(track) ? clone(track) : undefined);
  }
  /** ONE undo step for a finished gesture: before -> after (`before` = the track when the gesture began). */
  commitGesture(nodeId: string, paramId: string, before: AnimTrack | undefined, after: AnimTrack | undefined, label: string): void {
    const a = after && !trackIsEmpty(after) ? after : undefined;
    this.editor.stack.execute(new SetTrackCommand(this.g, nodeId, paramId, a, label, undefined, { track: before }));
    this.editor.stack.sealTop();
  }

  /** Add / overwrite a key at `frame`. Without `value` the current (animated or static) value is keyed. */
  setKey(nodeId: string, paramId: string, frame: number, value?: ParamValue): void {
    const def = this.def(nodeId, paramId);
    if (!def || !isAnimatableDef(def)) return;
    const v = value ?? valueAt(this.g, nodeId, paramId, frame);
    if (v === undefined) return;
    const next = setTrackKey(this.g.nodes.get(nodeId)?.anim?.[paramId], def, frame, cloneValue(v));
    this.updateTrack(nodeId, paramId, next, `Key ${def.label}`, `key@${frame}`);
  }

  removeKey(nodeId: string, paramId: string, frame: number): void {
    const tr = this.g.nodes.get(nodeId)?.anim?.[paramId];
    if (!tr) return;
    this.updateTrack(nodeId, paramId, removeTrackKey(tr, frame), `Delete key ${this.def(nodeId, paramId)?.label ?? paramId}`);
  }

  /** Remove the whole animation of a param; the static value becomes the value at `frame` (nothing jumps). */
  resetAnimation(nodeId: string, paramId: string, frame: number): void {
    const def = this.def(nodeId, paramId);
    if (!def || !this.g.nodes.get(nodeId)?.anim?.[paramId]) return;
    const cur = valueAt(this.g, nodeId, paramId, frame);
    this.editor.stack.transaction(`Reset animation of ${def.label}`, () => {
      this.updateTrack(nodeId, paramId, undefined, 'Clear animation');
      if (cur !== undefined) this.editor.setParam(nodeId, paramId, cloneValue(cur));
    });
  }

  /**
   * Value edit of an animatable param (Properties panel, gizmos): keys it at `frame` when the param is animated or when
   * auto-key is on, otherwise writes the static value. Returns true when a key was written.
   */
  editValue(nodeId: string, paramId: string, frame: number, value: ParamValue, autoKey: boolean, drag = false): boolean {
    const def = this.def(nodeId, paramId);
    const animated = !!this.g.nodes.get(nodeId)?.anim?.[paramId];
    if (def && isAnimatableDef(def) && (animated || autoKey)) {
      const next = setTrackKey(this.g.nodes.get(nodeId)?.anim?.[paramId], def, frame, cloneValue(value));
      this.editor.stack.execute(new SetTrackCommand(this.g, nodeId, paramId, next, `Key ${def.label}`, drag ? 'drag' : `key@${frame}`));
      return true;
    }
    this.editor.setParam(nodeId, paramId, cloneValue(value));
    return false;
  }

  setTimeline(patch: Partial<TimelineSettings>, label = 'Timeline settings', mergeKey?: string): void {
    this.editor.stack.execute(new SetTimelineCommand(this.g, patch, label, mergeKey));
  }

  addMarker(frame: number, name = ''): void {
    const f = Math.round(frame);
    if (this.g.timeline.markers.some((m) => m.frame === f)) return;
    this.setTimeline({ markers: [...this.g.timeline.markers, { frame: f, name: name || `M${this.g.timeline.markers.length + 1}` }].sort((a, b) => a.frame - b.frame) }, 'Add marker');
  }
  removeMarker(frame: number): void {
    this.setTimeline({ markers: this.g.timeline.markers.filter((m) => m.frame !== frame) }, 'Delete marker');
  }

  /** Copy the keys of the given rows at the given frames. */
  copyKeys(rows: { nodeId: string; paramId: string; frames: number[] }[]): number {
    const items: KeyClip['items'] = [];
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const tr = this.g.nodes.get(r.nodeId)?.anim?.[r.paramId];
      if (!tr || !r.frames.length) continue;
      // keep only the selected keys: remove all others
      const keep = cloneAnim({ x: tr })!.x;
      const all = keep.kind === 'snap' ? keep.snaps.map((s) => s.t) : keep.ch.flatMap((c) => c.keys.map((k) => k.t));
      let only: AnimTrack | undefined = keep;
      for (const t of new Set(all)) if (!r.frames.some((f) => Math.abs(f - t) < 1e-4)) only = only && removeTrackKey(only, t);
      if (!only) continue;
      items.push({ paramId: `${r.nodeId}\u0000${r.paramId}`, track: only });
      for (const f of r.frames) {
        min = Math.min(min, f);
        max = Math.max(max, f);
      }
    }
    if (!items.length) return 0;
    // make times relative
    for (const it of items) {
      const tr = it.track;
      if (tr.kind === 'snap') tr.snaps.forEach((s) => (s.t -= min));
      else tr.ch.forEach((c) => c.keys.forEach((k) => (k.t -= min)));
    }
    clip = { items, span: max - min };
    return items.length;
  }

  /** Paste the clipboard at `frame` onto the same params of the same nodes (or `onto` for a single-row clip). */
  pasteKeys(frame: number, onto?: { nodeId: string; paramId: string }): number {
    if (!clip) return 0;
    let n = 0;
    this.editor.stack.transaction('Paste keys', () => {
      for (const it of clip!.items) {
        const [nodeId, paramId] = it.paramId.split('\u0000');
        const target = clip!.items.length === 1 && onto ? onto : { nodeId, paramId };
        const def = this.def(target.nodeId, target.paramId);
        const cur = this.g.nodes.get(target.nodeId)?.anim?.[target.paramId];
        if (!def) continue;
        const src = clone(it.track);
        const shifted: AnimTrack = src;
        if (shifted.kind === 'snap') shifted.snaps.forEach((s) => (s.t += frame));
        else shifted.ch.forEach((c) => c.keys.forEach((k) => (k.t += frame)));
        let merged: AnimTrack = shifted;
        if (cur && cur.kind === shifted.kind) {
          if (cur.kind === 'snap' && shifted.kind === 'snap') merged = { ...cur, snaps: [...cur.snaps.filter((s) => !shifted.snaps.some((x) => Math.abs(x.t - s.t) < 1e-4)), ...shifted.snaps].sort((a, b) => a.t - b.t) };
          else if (cur.kind === 'num' && shifted.kind === 'num' && cur.ch.length === shifted.ch.length)
            merged = { kind: 'num', ch: cur.ch.map((c, i) => ({ ...c, keys: [...c.keys.filter((k) => !shifted.ch[i].keys.some((x) => Math.abs(x.t - k.t) < 1e-4)), ...shifted.ch[i].keys].sort((a, b) => a.t - b.t) })) };
        }
        this.updateTrack(target.nodeId, target.paramId, merged, 'Paste keys');
        n++;
      }
    });
    return n;
  }
}

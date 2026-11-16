/**
 * PLAYBACK engine. Owns the playhead, transport state and frame pacing; drives `scheduler.setTime`.
 *
 * - The playhead advances from the WALL CLOCK (pacing.ts), not from evaluation completion. A heavy graph therefore drops
 *   frames instead of slowing the animation; dropped frames are counted by PacingMonitor and shown in the timeline.
 * - While playing, the scheduler is put in `playbackMode`: a new time does not cancel the evaluation in flight (otherwise a
 *   slow graph would be cancelled forever), and rendered frames go into the bounded frame cache for smooth loops.
 * - Time is quantized to whole frames while playing / stepping (strict pacing); scrubbing may use fractions when asked.
 */
import { Emitter } from '../../shared/emitter';
import type { Graph } from '../graph/graph';
import type { EvalScheduler } from '../graph/scheduler';
import { trackKeyFrames } from './tracks';
import { advanceFrame, displayFrame, PacingMonitor, type PacingStats } from './pacing';
import { animRange, workRange, type FrameRange, type LoopMode } from './timebase';

export interface PlaybackClock {
  now(): number;
  request(cb: () => void): number;
  cancel(id: number): void;
}
const browserClock = (): PlaybackClock => ({ now: () => performance.now(), request: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id) });

export class Playback {
  /** Fires on any transport / playhead / settings change that UIs should redraw for. */
  readonly onChange = new Emitter<void>();
  /** Fires when playback reached the end in 'once' mode. */
  readonly onEnded = new Emitter<void>();
  readonly monitor = new PacingMonitor();
  playing = false;
  /** Continuous playhead (frames). */
  frame = 0;
  private startWall = 0;
  private startFrame = 0;
  private raf = 0;
  private dir: 1 | -1 = 1;
  private unsub: Array<() => void> = [];
  /** Speed multiplier override (UI), applied on top of timeline.speed. */
  speedOverride: number | null = null;

  constructor(
    private scheduler: EvalScheduler,
    private clock: PlaybackClock = browserClock(),
  ) {
    this.unsub.push(
      scheduler.onResult.on(({ time }) => {
        if (!this.playing || time === undefined) return;
        const g = this.graph;
        if (!g) return;
        const r = this.range();
        this.monitor.onDelivered(Math.round(time * g.settings.fps), this.clock.now(), r.end - r.start, this.dir);
      }),
    );
  }

  get graph(): Graph | null {
    return this.scheduler.currentGraph;
  }
  get fps(): number {
    return this.graph?.settings.fps ?? 30;
  }
  get time(): number {
    return this.frame / this.fps;
  }
  get speed(): number {
    return this.speedOverride ?? this.graph?.timeline.speed ?? 1;
  }
  get loopMode(): LoopMode {
    return this.graph?.timeline.loop ?? 'loop';
  }
  /** Full animation range [start,end). */
  fullRange(): FrameRange {
    const g = this.graph;
    return g ? animRange(g.timeline, g.settings.loopLength) : { start: 0, end: 64 };
  }
  /** Playback range (work area). */
  range(): FrameRange {
    const g = this.graph;
    return g ? workRange(g.timeline, g.settings.loopLength) : { start: 0, end: 64 };
  }
  stats(): PacingStats {
    return this.monitor.stats(this.clock.now());
  }

  /** Move the playhead. `quantize` rounds to whole frames (default). */
  setFrame(frame: number, quantize = true): void {
    const f = quantize ? Math.round(frame) : frame;
    this.frame = f;
    this.scheduler.setTime(f / this.fps);
    this.onChange.emit();
  }
  setTime(seconds: number): void {
    this.setFrame(seconds * this.fps);
  }

  play(): void {
    if (this.playing) return;
    const r = this.range();
    if (this.loopMode === 'once' && this.speed > 0 && this.frame >= r.end - 1) this.frame = r.start;
    if (this.loopMode === 'once' && this.speed < 0 && this.frame <= r.start) this.frame = r.end - 1;
    this.playing = true;
    this.startWall = this.clock.now();
    this.startFrame = this.frame;
    this.dir = this.speed < 0 ? -1 : 1;
    this.monitor.reset();
    this.scheduler.playbackMode = true;
    this.onChange.emit();
    this.loop();
  }
  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.scheduler.playbackMode = false;
    if (this.raf) this.clock.cancel(this.raf);
    this.raf = 0;
    this.frame = displayFrame(this.frame);
    this.scheduler.setTime(this.frame / this.fps);
    this.onChange.emit();
  }
  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
  /** Stop and rewind to the start of the playback range. */
  stop(): void {
    this.pause();
    this.setFrame(this.range().start);
  }
  /** Re-anchor the wall clock (speed / range changed during playback). */
  reanchor(): void {
    if (!this.playing) return;
    this.startWall = this.clock.now();
    this.startFrame = this.frame;
    this.dir = this.speed < 0 ? -1 : 1;
    this.onChange.emit();
  }

  step(n: number): void {
    if (this.playing) this.pause();
    const r = this.range();
    const len = r.end - r.start;
    let f = Math.round(this.frame) + n;
    if (this.loopMode === 'loop' && f >= r.start - len && len > 0 && (f < r.start || f >= r.end)) f = r.start + ((((f - r.start) % len) + len) % len);
    this.setFrame(f);
  }
  goStart(): void {
    this.setFrame(this.range().start);
  }
  goEnd(): void {
    this.setFrame(this.range().end - 1);
  }

  /** Jump to the previous / next key of the given frames (sorted). Returns the frame or null. */
  jumpToKey(frames: number[], dir: 1 | -1): number | null {
    const cur = Math.round(this.frame * 1000) / 1000;
    const sorted = [...frames].sort((a, b) => a - b);
    const f = dir > 0 ? sorted.find((x) => x > cur + 1e-4) : [...sorted].reverse().find((x) => x < cur - 1e-4);
    if (f === undefined) return null;
    this.setFrame(f, false);
    return f;
  }
  /** All key frames of the given nodes (all params). */
  keyFramesOf(nodeIds: string[]): number[] {
    const g = this.graph;
    if (!g) return [];
    const set = new Set<number>();
    for (const id of nodeIds) {
      const a = g.nodes.get(id)?.anim;
      if (a) for (const t of Object.values(a)) for (const f of trackKeyFrames(t)) set.add(f);
    }
    return [...set];
  }

  private loop = (): void => {
    if (!this.playing) return;
    this.raf = this.clock.request(this.loop);
    const out = advanceFrame({ frame0: this.startFrame, elapsedMs: this.clock.now() - this.startWall, fps: this.fps, speed: this.speed, range: this.range(), mode: this.loopMode });
    this.dir = out.dir;
    this.frame = out.frame;
    this.scheduler.setTime(displayFrame(out.frame) / this.fps);
    this.onChange.emit();
    if (out.ended) {
      this.pause();
      this.onEnded.emit();
    }
  };

  dispose(): void {
    this.pause();
    this.unsub.forEach((u) => u());
    this.unsub = [];
    this.onChange.clear();
    this.onEnded.clear();
  }
}

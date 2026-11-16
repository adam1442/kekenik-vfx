/**
 * Frame pacing logic. PURE (injectable clock, no DOM) so it is unit-tested.
 *
 * Playback is driven by the WALL CLOCK, never by "one evaluation == one frame": position = f(elapsed time). When the graph
 * is heavier than real time the scheduler simply shows the newest frame it managed to compute and the skipped frames are
 * counted as DROPPED (indicator in the timeline). This keeps animation speed correct on slow machines.
 */
import type { FrameRange, LoopMode } from './timebase';

export interface AdvanceInput {
  /** Frame (float) at the moment playback (re)started. */
  frame0: number;
  elapsedMs: number;
  fps: number;
  /** Speed multiplier; negative = backwards. */
  speed: number;
  range: FrameRange;
  mode: LoopMode;
}
export interface AdvanceOutput {
  /** Continuous frame position inside [range.start, range.end). */
  frame: number;
  /** Only for mode 'once': the end was reached. */
  ended: boolean;
  /** Direction currently travelled (+1 / -1) - relevant for ping-pong. */
  dir: 1 | -1;
}

const mod = (a: number, b: number): number => ((a % b) + b) % b;

/** Map elapsed wall time to a timeline position. */
export function advanceFrame(i: AdvanceInput): AdvanceOutput {
  const len = Math.max(1, i.range.end - i.range.start);
  const raw = i.frame0 + (i.elapsedMs / 1000) * i.fps * i.speed;
  const sgn: 1 | -1 = i.speed < 0 ? -1 : 1;
  if (i.mode === 'loop') return { frame: i.range.start + mod(raw - i.range.start, len), ended: false, dir: sgn };
  if (i.mode === 'once') {
    const last = i.range.end - 1;
    if (raw >= last && sgn > 0) return { frame: last, ended: true, dir: 1 };
    if (raw <= i.range.start && sgn < 0) return { frame: i.range.start, ended: true, dir: -1 };
    return { frame: Math.min(last, Math.max(i.range.start, raw)), ended: false, dir: sgn };
  }
  // ping-pong between start and end-1 inclusive
  const span = Math.max(1, len - 1);
  const m = mod(raw - i.range.start, 2 * span);
  return { frame: i.range.start + (m <= span ? m : 2 * span - m), ended: false, dir: (m <= span ? sgn : -sgn) as 1 | -1 };
}

/** Integer frame shown for a continuous position (strict pacing: whole frames only). */
export const displayFrame = (frame: number): number => Math.floor(frame + 1e-6);

export interface PacingStats {
  delivered: number;
  dropped: number;
  /** Frames per second actually delivered (recent window). */
  actualFps: number;
  /** Fraction of frames dropped in the recent window (0..1). */
  dropRatio: number;
  /** true when playback cannot keep up (drop ratio above threshold). */
  behind: boolean;
}

/** Counts delivered / dropped frames. A drop = the shown frame jumped over >= 1 frame since the previous delivery. */
export class PacingMonitor {
  delivered = 0;
  dropped = 0;
  private last = Number.NaN;
  private window: { t: number; drop: number }[] = [];
  constructor(
    readonly windowMs = 1500,
    readonly behindThreshold = 0.08,
  ) {}

  reset(): void {
    this.delivered = 0;
    this.dropped = 0;
    this.last = Number.NaN;
    this.window = [];
  }

  /** Call with each frame that reached the screen. `rangeLen` is used to unwrap loops. */
  onDelivered(frame: number, nowMs: number, rangeLen: number, dir: 1 | -1 = 1): void {
    let drop = 0;
    if (!Number.isNaN(this.last) && frame !== this.last) {
      let step = (frame - this.last) * dir;
      if (step < 0) step += rangeLen; // wrapped around the loop
      if (step > 1.0001) drop = Math.round(step - 1);
    }
    this.last = frame;
    this.delivered++;
    this.dropped += drop;
    this.window.push({ t: nowMs, drop });
    while (this.window.length && nowMs - this.window[0].t > this.windowMs) this.window.shift();
  }

  stats(nowMs: number): PacingStats {
    while (this.window.length && nowMs - this.window[0].t > this.windowMs) this.window.shift();
    const n = this.window.length;
    const drops = this.window.reduce((a, w) => a + w.drop, 0);
    const spanS = n > 1 ? (this.window[n - 1].t - this.window[0].t) / 1000 : 0;
    const ratio = n + drops > 0 ? drops / (n + drops) : 0;
    return { delivered: this.delivered, dropped: this.dropped, actualFps: spanS > 0 ? (n - 1) / spanS : 0, dropRatio: ratio, behind: ratio > this.behindThreshold };
  }
}

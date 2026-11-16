import { AdaptiveResolution } from '../perf/adaptive';
import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import { FrameCache } from '../anim/frame-cache';
import { valueBytes } from '../resources/values';
import { targetKey, type CancelToken, type EvalResult, type EvalTarget, type Evaluator } from './evaluator';
import type { Graph } from './graph';

export interface SchedulerResult {
  result: EvalResult;
  /** Preview resolution factor used (1 = final quality). */
  scale: number;
  /** true when this is a full-resolution result (not a reduced interactive preview). */
  final: boolean;
  /** evaluation time (seconds) of this result and whether it came from the frame cache. */
  time?: number;
  fromCache?: boolean;
}

/** an EvalResult shared between the scheduler (latest) and the frame cache; released when the last holder lets go. */
export class SharedResult {
  refs = 1;
  constructor(readonly res: EvalResult) {}
  ref(): this {
    this.refs++;
    return this;
  }
  unref(): void {
    if (--this.refs === 0) this.res.release();
  }
}

/**
 * Coalesces evaluation requests: ONE evaluation per animation frame, only for the targets that currently need
 * pixels (viewports, visible thumbnails). Interactive parameter drags render at reduced resolution and refine to
 * full resolution shortly after the interaction ends. Stale work is cancelled when the graph changes.
 *
 * Owners register their targets with `setTargets(ownerId, targets)`; pass null/[] when the viewport hides.
 * Results are delivered through `onResult`; the scheduler keeps the latest result alive and releases the
 * previous one AFTER listeners drew it (draw commands are queued before the textures can be reused).
 *
 * additions: `playbackMode` (a new time never cancels the evaluation in flight, so heavy graphs still show frames),
 * a bounded FRAME CACHE of recent playback frames (hit = no evaluation at all), and `runExclusiveForce` for jobs that must own
 * the evaluator (flipbook baking, seam verification).
 */
export class EvalScheduler {
  readonly onResult = new Emitter<SchedulerResult>();
  private owners = new Map<string, EvalTarget[]>();
  private ownerScale = new Map<string, number>();
  private graph: Graph | null = null;
  private unsub: (() => void) | null = null;
  private dirty = true;
  private running = false;
  private token: CancelToken | null = null;
  private interacting = false;
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private latest: SharedResult | null = null;
  private exclusiveWaiters = 0;
  time = 0;
  interactionScale = 0.5;
  /** adaptive preview-resolution controller (optional). While dragging the effective scale is min(base, interactionScale, adaptive.scale). */
  adaptive?: AdaptiveResolution;
  refineDelayMs = 120;
  /** Playback in progress: do not cancel in-flight evaluations on time changes; cache frames. */
  playbackMode = false;
  /** Frame cache on/off (default on). Limits are set by the Engine from the memory budget. */
  cacheEnabled = true;
  readonly frameCache = new FrameCache<SharedResult>(
    () => 0,
    1024,
    (s) => s.unref(),
  );
  /** extra frame-cache signature (simulation epoch): frames cached while a simulation was still running must not be reused. */
  cacheSalt?: () => string;
  /** Injected for tests / non-DOM environments. */
  scheduleFrame: (cb: () => void) => number = (cb) => requestAnimationFrame(cb);
  cancelFrame: (id: number) => void = (id) => cancelAnimationFrame(id);

  constructor(private evaluator: Evaluator) {}

  get currentGraph(): Graph | null {
    return this.graph;
  }
  /** Playhead in frames (for cache eviction order). */
  get timeFrame(): number {
    return this.graph ? Math.round(this.time * (this.graph.settings?.fps ?? 30)) : 0;
  }

  /** True while an evaluation is in flight / pending / the user is dragging (low-priority work must wait). */
  get isBusy(): boolean {
    return this.running || (this.dirty && this.raf !== 0) || this.interacting || this.external;
  }
  get isInteracting(): boolean {
    return this.interacting;
  }
  private external = false;
  /**
   * Run low-priority work (graph thumbnails) that evaluates through the shared evaluator while the scheduler is
   * paused; the scheduler resumes right after. Returns null when the scheduler is busy (caller retries later).
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.isBusy) return null;
    this.external = true;
    try {
      return await fn();
    } finally {
      this.external = false;
    }
  }

  /**
   * like runExclusive but WAITS for the in-flight evaluation and holds back new ones until `fn` is done (baking N frames
   * of a graph needs the evaluator for itself: concurrent evaluations would share the uniform arena batch).
   */
  async runExclusiveForce<T>(fn: () => Promise<T>): Promise<T> {
    this.exclusiveWaiters++;
    try {
      while (this.running || this.external) await new Promise<void>((r) => setTimeout(r, 4));
      this.external = true;
      try {
        return await fn();
      } finally {
        this.external = false;
      }
    } finally {
      this.exclusiveWaiters--;
      this.dirty = true;
    }
  }

  attach(graph: Graph): void {
    this.unsub?.();
    this.frameCache.clearAll();
    this.graph = graph;
    this.unsub = graph.events.on((e) => {
      if (e.type !== 'meta') this.invalidate();
    });
    this.invalidate();
  }

  setTargets(ownerId: string, targets: EvalTarget[] | null): void {
    if (!targets || targets.length === 0) this.owners.delete(ownerId);
    else this.owners.set(ownerId, targets);
    this.invalidate();
  }

  /**
   * Preview resolution an owner needs (viewport zoom < 100% => fewer pixels are enough). The scheduler evaluates at
   * the MAX scale requested by the owners that currently have targets (default 1).
   */
  setOwnerScale(ownerId: string, scale: number): void {
    const s = Math.min(1, Math.max(1 / 16, scale));
    if (this.ownerScale.get(ownerId) === s) return;
    this.ownerScale.set(ownerId, s);
    this.invalidate();
  }
  clearOwner(ownerId: string): void {
    this.ownerScale.delete(ownerId);
    this.setTargets(ownerId, null);
  }

  setTime(t: number): void {
    if (t === this.time) return;
    this.time = t;
    if (this.playbackMode) this.dirty = true; // keep the evaluation in flight (frame dropping instead of starvation)
    else this.invalidate();
  }

  invalidate(): void {
    this.dirty = true;
    if (this.token) this.token.cancelled = true; // cancel stale work
  }

  beginInteraction(): void {
    this.interacting = true;
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = null;
  }
  endInteraction(): void {
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.refineTimer = setTimeout(() => {
      this.interacting = false;
      this.invalidate();
    }, this.refineDelayMs);
  }

  start(): void {
    if (this.raf) return;
    const tick = (): void => {
      this.raf = this.scheduleFrame(tick);
      if (this.dirty && !this.running && !this.external && this.exclusiveWaiters === 0) void this.run();
    };
    this.raf = this.scheduleFrame(tick);
  }
  stop(): void {
    if (this.raf) this.cancelFrame(this.raf);
    this.raf = 0;
  }

  /** Run one evaluation immediately (tests / explicit refresh); resolves when delivered. */
  async runOnce(): Promise<void> {
    await this.run();
  }

  /** Release every cached frame (device lost, project closed). */
  dropFrameCache(): void {
    this.frameCache.clearAll();
  }

  private deliver(shared: SharedResult, scale: number, base: number, time: number, fromCache: boolean): void {
    const prev = this.latest;
    this.latest = shared;
    this.onResult.emit({ result: shared.res, scale, final: scale >= base, time, fromCache });
    prev?.unref();
    if (scale < base && !this.interacting) this.dirty = true; // refine
  }

  private async run(): Promise<void> {
    const graph = this.graph;
    if (!graph) return;
    const seen = new Set<string>();
    const targets: EvalTarget[] = [];
    for (const list of this.owners.values()) {
      for (const t of list) {
        const k = targetKey(t);
        if (!seen.has(k)) {
          seen.add(k);
          targets.push(t);
        }
      }
    }
    this.dirty = false;
    if (targets.length === 0) return;
    let base = 0;
    for (const id of this.owners.keys()) base = Math.max(base, this.ownerScale.get(id) ?? 1);
    if (base === 0) base = 1;
    const scale = this.interacting ? Math.min(base, this.interactionScale, this.adaptive?.enabled ? this.adaptive.scale : 1) : base;
    const time = this.time;

    // Frame cache: signature = what makes a cached frame invalid; key = the time.
    const cacheOn = this.cacheEnabled && this.frameCache.maxBytes > 0;
    const frameNo = Math.round(time * (graph.settings?.fps ?? 30));
    const cacheKey = String(Math.round(time * 100000));
    if (cacheOn) {
      this.frameCache.setSignature(`${graph.id}|${graph.revision}|${[...seen].sort().join(',')}|${scale}|${this.cacheSalt?.() ?? ''}`);
      const hit = this.frameCache.get(cacheKey);
      if (hit) {
        this.deliver(hit.ref(), scale, base, time, true);
        return;
      }
    }

    this.running = true;
    const token: CancelToken = { cancelled: false };
    this.token = token;
    const compiled0 = this.evaluator.runner.pipelines.compiledCount;
    try {
      const res = await this.evaluator.evaluate(graph, targets, { time, scale, token, jobs: true });
      // feed the adaptive controller with evaluations that really did work and did not wait for shader compiles
      if (this.interacting && !res.cancelled && res.stats.nodesEvaluated > 0 && this.evaluator.runner.pipelines.compiledCount === compiled0) this.adaptive?.observe(res.stats.cpuMs, scale, 'cpu');
      if (res.cancelled || token.cancelled) {
        res.release();
      } else {
        const shared = new SharedResult(res);
        if (cacheOn && this.playbackMode && !this.interacting && scale >= base) {
          let bytes = 0;
          for (const v of res.values.values()) bytes += valueBytes(v);
          if (!this.frameCache.put(cacheKey, frameNo, shared.ref(), bytes)) shared.unref();
        }
        this.deliver(shared, scale, base, time, false);
      }
    } catch (e) {
      consoleBus.error(`Evaluation failed: ${(e as Error).message}`, { source: 'eval' });
    } finally {
      this.running = false;
      this.token = null;
    }
  }

  dispose(): void {
    this.stop();
    this.unsub?.();
    if (this.refineTimer) clearTimeout(this.refineTimer);
    this.frameCache.clearAll();
    this.latest?.unref();
    this.latest = null;
    this.onResult.clear();
  }
}

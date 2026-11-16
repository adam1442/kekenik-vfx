/**
 * SimulationService: the stateful half of the engine. Nodes stay pure functions of (params, inputs, time) for the
 * evaluator; a simulation node's `evaluate()` only ASKS this service for the snapshot of the frame it has to show.
 *
 *   evaluate() ──request(spec, frame)──▶ cache hit  -> view (ready)            cache miss -> last valid view + a job is queued
 *   job (async, exclusive chunks) ──▶ restore nearest checkpoint / reset + warm-up ──▶ step frame by frame ──▶ snapshot into SimCache
 *                                     └─ per frame: lazy inputs evaluated at the frame time, one command buffer, one tiny read-back
 *
 * Same pattern as the FlipbookBaker (lazy pins, `runExclusiveForce`, `scheduler.invalidate()` when something new is available).
 * Determinism: the step of frame k depends only on S(k-1) and the inputs / params AT frame k (never on wall-clock or UI state).
 * Memory: textures come from the pooled MemoryManager; the SimCache obeys the per-node byte budget; failures degrade to
 * "last valid frame or black" with an error badge, never an exception into the render loop.
 */
import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import { delay } from '../../shared/util';
import type { GpuContext } from '../gpu/device';
import type { PassRunner } from '../gpu/passes';
import { targetKey, type Evaluator } from '../graph/evaluator';
import type { Graph } from '../graph/graph';
import type { EvalScheduler } from '../graph/scheduler';
import { coerceParam, type ParamValues } from '../params/schema';
import { OutOfBudgetError, type GpuTexture, type MemoryManager } from '../resources/memory';
import { readTextureFloat32 } from '../resources/readback';
import { PipelinePending } from '../shaders/pipelines';
import { SimCache, forcingFrame, loopPlan, planInvalidation, requiredFrames, seamError, totalSimFrames, type CacheStats, type LoopMode, type LoopPlan, type SimStatus } from './core';

export type SimFrameInputs = Record<string, GpuTexture | null | undefined>;

/** What a simulation implementation (e.g. Fluid 2D) provides. All GPU memory must come from `deps.mm`. */
export interface SimulationBackend {
  readonly width: number;
  readonly height: number;
  /** Bytes of ONE full state (= one snapshot = one checkpoint). */
  readonly stateBytes: number;
  prewarm(): Promise<void>;
  /** Persistent state textures (what is snapshotted). */
  state(): GpuTexture[];
  reset(enc: GPUCommandEncoder, inputs: SimFrameInputs): void;
  /** Record ONE frame: `k` = simulated frame (negative during warm-up), `forcing` = frame the emitters / forces see. */
  step(enc: GPUCommandEncoder, k: number, forcing: number, inputs: SimFrameInputs): void;
  /** Async measurement after a frame / restore (CFL, residual). Must be a pure function of the state. */
  settle(): Promise<void>;
  copyState(enc: GPUCommandEncoder, from: GpuTexture[], to: GpuTexture[]): void;
  blend(enc: GPUCommandEncoder, a: GpuTexture[], b: GpuTexture[], w: number, out: GpuTexture[]): void;
  hud(): Record<string, number>;
  dispose(): void;
}

export interface SimConfig {
  fps: number;
  speed: number;
  warmup: number;
  loopMode: LoopMode;
  loopLength: number;
  blend: number;
  cacheBytes: number;
  /** Resolution of the evaluation of the lazy input pins (relative to the graph size). */
  inputScale: number;
  /** Max frames kept for loop mode None (the simulation itself is unbounded). */
  maxFrames: number;
}

export interface SimSpec {
  nodeId: string;
  nodeName: string;
  graph: Graph;
  /** Signature of everything that invalidates the cache (sim params, animation, upstream content). */
  key: string;
  /**
   * Optional (animated params): `staticKey` = everything in `key` EXCEPT the animation, `signatures()` = per simulated frame (from -warmup)
   * signature of the animated values (core.frameSignatures). When only the signatures changed, only frames from the first changed one
   * are invalidated (S(k) depends on frames <= k only). Evaluated lazily, only when a key change is being applied.
   */
  staticKey?: string;
  signatures?: () => Map<number, string> | null;
  cfg: SimConfig;
  /** Pin id -> producer of every connected lazy input pin. */
  lazy: Record<string, { nodeId: string; pin: string }>;
  create(deps: { gpu: GpuContext; mm: MemoryManager; runner: PassRunner; owner: { nodeId: string; nodeName: string } }): SimulationBackend;
  /** Optional: resolved width / height for the readout. */
  size: { w: number; h: number; note?: string };
}

export interface SimView {
  ready: boolean;
  /** Snapshot textures to render from (cache- or live-owned: valid during the current evaluation only). */
  a: GpuTexture[] | null;
  /** Second snapshot + weight when the output frame is a cross-fade of two simulated frames (already blended into `a` when `temp` is set). */
  frame: number;
  backend: SimulationBackend | null;
  status: SimStatus;
  stale: boolean;
}

export interface SimInfo {
  nodeId: string;
  nodeName: string;
  status: SimStatus;
  progress: number;
  cache: CacheStats;
  stateBytes: number;
  w: number;
  h: number;
  note?: string;
  hud: Record<string, number>;
  error?: string;
  resimulating: boolean;
  baked: boolean;
  paused: boolean;
  seam?: { error: number; ratio: number };
  frames: number;
  /** Simulation head: last simulated frame (-1 = initial state, -2 = no live state). */
  cursor: number;
  /** Wall time of one simulated frame (smoothed, ms; includes the CFL / residual measurement). */
  stepMs: number;
  /** Frames simulated since the node was created (warm-up included): shows what a partial invalidation saved. */
  stepsRun: number;
}

const FPS_EPS = 1e-6;

class Runtime {
  spec: SimSpec;
  key: string;
  /** Static key + animated-value signatures of the ACTIVE spec (what the cached frames were simulated with). */
  staticKey: string | undefined;
  sigs: Map<number, string> | null | undefined;
  backend: SimulationBackend | null = null;
  cache: SimCache<GpuTexture[]>;
  /** Frame index of the live backend state: -2 = no state, -1 = after reset + warm-up, k >= 0 = after frame k. */
  cursor = -2;
  needed: number[] = [];
  status: SimStatus = 'idle';
  progress = 0;
  error?: string;
  baked = false;
  paused = false;
  rev = 0;
  pending: SimSpec | null = null;
  changedAt = 0;
  queued = false;
  working = false;
  cancel = 0;
  lastView: { frames: number[]; plan: LoopPlan } | null = null;
  seam?: { error: number; ratio: number };
  lastUse = 0;
  bakeRequested = false;
  stepMs = 0;
  stepsRun = 0;
  constructor(spec: SimSpec, cache: SimCache<GpuTexture[]>) {
    this.spec = spec;
    this.key = spec.key;
    this.staticKey = spec.staticKey;
    this.cache = cache;
  }
}

const sims = new WeakMap<GpuContext, SimulationService>();
/** The simulation service that belongs to a GPU context (nodes find it through `ctx.gpu`). */
export const simFor = (gpu: GpuContext): SimulationService | undefined => sims.get(gpu);

export class SimulationService {
  readonly onChange = new Emitter<{ nodeId: string }>();
  private runtimes = new Map<string, Runtime>();
  private queue: Runtime[] = [];
  private looping = false;
  /** Deadline of one exclusive chunk (ms): short enough that the UI keeps evaluating between chunks. */
  chunkMs = 40;
  /** Debounce before a parameter change drops the cache (ms). */
  debounceMs = 250;
  /** Fraction of the global memory budget all simulation caches together may use. */
  budgetFraction = 0.3;
  epoch = 0;
  /** Idle housekeeping (see `trim`): a node nobody evaluates for this long releases its live solver state / is forgotten when deleted. */
  idleReleaseMs = 30000;
  idleBakedForgetMs = 300000;
  private trimTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private deps: { gpu: GpuContext; mm: MemoryManager; runner: PassRunner; evaluator: Evaluator; scheduler: EvalScheduler },
  ) {
    sims.set(deps.gpu, this);
    deps.mm.registerEvictor((need) => void this.evict(need));
  }

  /* ------------------------------------------------------------------ helpers for nodes */
  currentGraph(): Graph | null {
    return this.deps.scheduler.currentGraph;
  }
  memoryBudget(): number {
    return this.deps.mm.budgetBytes;
  }
  /** Resolved (animated + coerced) params of a node at a timeline frame; `fallback` when the node is not in `graph` (subgraph internals). */
  paramsAt(graph: Graph | null | undefined, nodeId: string, frame: number, fallback: ParamValues): ParamValues {
    const node = graph?.nodes.get(nodeId);
    const ex = graph?.expandedOf(nodeId);
    if (!graph || !node || !ex) return fallback;
    const fps = graph.settings.fps;
    const an = this.deps.evaluator.animator;
    const raw = an ? an(node, node.params, frame / fps, fps) : node.params;
    const out: ParamValues = {};
    for (const p of ex.params) out[p.id] = coerceParam(p, p.id in raw ? raw[p.id] : p.default);
    return out;
  }
  isPaused(nodeId: string): boolean {
    return !!this.runtimes.get(nodeId)?.paused;
  }

  /* ------------------------------------------------------------------ queries */
  /** Hash salt of a node: changes whenever something the node would show changed (see plan.ts `simSalt`). */
  salt(nodeId: string): string {
    const rt = this.runtimes.get(nodeId);
    return rt ? String(rt.rev) : '0';
  }
  has(nodeId: string): boolean {
    return this.runtimes.has(nodeId);
  }
  nodeIds(): string[] {
    return [...this.runtimes.keys()];
  }
  info(nodeId: string): SimInfo | null {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return null;
    const total = totalSimFrames(rt.spec.cfg.loopLength, rt.spec.cfg.blend, rt.spec.cfg.loopMode);
    return {
      nodeId,
      nodeName: rt.spec.nodeName,
      status: rt.baked ? 'baked' : rt.status,
      progress: rt.progress,
      cache: rt.cache.stats(),
      stateBytes: rt.backend?.stateBytes ?? 0,
      w: rt.spec.size.w,
      h: rt.spec.size.h,
      note: rt.spec.size.note,
      hud: rt.backend?.hud() ?? {},
      error: rt.error,
      resimulating: !!rt.pending && !rt.baked,
      baked: rt.baked,
      paused: rt.paused,
      seam: rt.seam,
      frames: total,
      cursor: rt.cursor,
      stepMs: rt.stepMs,
      stepsRun: rt.stepsRun,
    };
  }
  totalCacheBytes(): number {
    let n = 0;
    for (const rt of this.runtimes.values()) n += rt.cache.used;
    return n;
  }
  private budgetFor(spec: SimSpec): number {
    const cap = this.deps.mm.budgetBytes * this.budgetFraction;
    return Math.max(0, Math.min(spec.cfg.cacheBytes, cap));
  }
  private bump(rt: Runtime): void {
    rt.rev++;
    this.epoch++;
    this.onChange.emit({ nodeId: rt.spec.nodeId });
  }

  /* ------------------------------------------------------------------ evaluate()-side API */
  /**
   * Called from a node's evaluate(): returns the snapshot for output frame `frame` (cache / live / cross-faded) or the last valid one.
   * `enc` is the evaluation's command encoder (used to record the loop cross-fade blend).
   */
  request(spec: SimSpec, frame: number, enc: GPUCommandEncoder): SimView {
    let rt = this.runtimes.get(spec.nodeId);
    if (!rt) {
      const cache = new SimCache<GpuTexture[]>(this.budgetFor(spec), (p) => p.forEach((t) => t.release()));
      rt = new Runtime(spec, cache);
      this.runtimes.set(spec.nodeId, rt);
      this.applyCacheConfig(rt);
    }
    rt.lastUse = Date.now();
    this.startTrimTimer();
    if (spec.key !== rt.key) {
      if (rt.baked) {
        rt.spec = { ...rt.spec, graph: spec.graph, nodeName: spec.nodeName };
      } else if (!rt.pending || rt.pending.key !== spec.key) {
        rt.pending = spec;
        rt.changedAt = Date.now();
        rt.cache.hold.clear();
        this.bump(rt);
        this.schedule(rt);
      } else {
        rt.pending = spec;
        rt.changedAt = Date.now();
      }
    } else {
      rt.spec = spec;
    }
    const cfg = rt.spec.cfg;
    const plan = loopPlan(frame, cfg.loopLength, cfg.blend, cfg.loopMode);
    const need = requiredFrames(plan);
    rt.needed = need;
    rt.cache.protect = (k) => cfg.loopMode === 'crossfade' && k < Math.min(cfg.blend, cfg.loopLength);
    rt.cache.hold = new Set(need);
    const view = (a: GpuTexture[] | null, ready: boolean): SimView => ({ ready, a, frame, backend: rt!.backend, status: rt!.status, stale: !!rt!.pending || !ready });
    const tex = (k: number): GpuTexture[] | undefined => rt!.cache.get(k) ?? (rt!.cursor === k && rt!.backend ? rt!.backend.state() : undefined);
    const ta = tex(plan.a);
    const tb = plan.b !== null ? tex(plan.b) : undefined;
    if (ta && (plan.b === null || tb) && rt.backend) {
      rt.lastView = { frames: need, plan };
      if (plan.b === null || plan.w === 0) return view(ta, true);
      const blended = this.tempState(rt, ta);
      if (blended) {
        rt.backend.blend(enc, ta, tb!, plan.w, blended);
        return view(blended, true);
      }
      return view(ta, true);
    }
    // not ready: queue the job and show the last valid frame (if its snapshot is still there)
    if (!rt.paused) this.schedule(rt);
    const lv = rt.lastView;
    if (lv && rt.backend) {
      const la = tex(lv.plan.a);
      if (la && lv.plan.b === null) return view(la, false);
    }
    return view(null, false);
  }

  /** Temporary state-shaped textures (cross-fade output), released when the GPU batch that uses them is done. */
  private tempState(rt: Runtime, like: GpuTexture[]): GpuTexture[] | null {
    try {
      const out = like.map((t) => this.deps.mm.textures.acquire({ width: t.width, height: t.height, format: t.format, label: `sim blend ${rt.spec.nodeName}` }));
      this.deps.runner.arena.holdUntilBatchDone(() => out.forEach((t) => t.release()));
      return out;
    } catch {
      return null;
    }
  }

  private applyCacheConfig(rt: Runtime): void {
    const cfg = rt.spec.cfg;
    rt.cache.setBudget(this.budgetFor(rt.spec));
    rt.cache.configure(totalSimFrames(cfg.loopLength, cfg.blend, cfg.loopMode), rt.backend?.stateBytes ?? rt.spec.size.w * rt.spec.size.h * 16);
  }

  /* ------------------------------------------------------------------ idle housekeeping */
  private startTrimTimer(): void {
    if (this.trimTimer !== null || typeof setInterval === 'undefined') return;
    this.trimTimer = setInterval(() => this.trim(Date.now()), 10000);
  }

  /** Does the current graph still contain this simulation node (top level or inside a flattened subgraph instance, whose ids are prefixed)? */
  private nodeExists(nodeId: string): boolean {
    const g = this.deps.scheduler.currentGraph;
    if (!g) return true; // unknown: never drop anything
    if (g.nodes.has(nodeId)) return true;
    for (const k of g.nodes.keys()) if (nodeId.startsWith(k) && g.nodes.get(k)?.type.startsWith('subgraph.')) return true;
    return false;
  }

  /**
   * Memory hygiene without surprising the user (called every 10 s while simulations exist; exposed for tests):
   *  - a node that no longer exists in the graph is forgotten (cache + state released) after `idleReleaseMs` (baked ones after `idleBakedForgetMs`: undo window);
   *  - a node nobody has evaluated for `idleReleaseMs` releases its LIVE solver state (the cache and checkpoints stay): the next request
   *    restores the nearest cached frame and re-simulates deterministically, so nothing is lost but the GPU temporaries come back.
   * Nothing is ever simulated in the background here.
   */
  trim(now: number): void {
    for (const [id, rt] of [...this.runtimes]) {
      if (rt.working || rt.queued) continue;
      const idle = now - rt.lastUse;
      if (!this.nodeExists(id)) {
        if (idle >= (rt.baked ? this.idleBakedForgetMs : this.idleReleaseMs)) this.forget(id);
        continue;
      }
      if (idle >= this.idleReleaseMs && rt.backend && !rt.baked) {
        rt.backend.dispose();
        rt.backend = null;
        rt.cursor = -2;
        this.warmDone.delete(rt);
        this.bump(rt);
      }
    }
    if (!this.runtimes.size && this.trimTimer !== null) {
      clearInterval(this.trimTimer);
      this.trimTimer = null;
    }
  }

  /* ------------------------------------------------------------------ user commands */
  reset(nodeId: string): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return;
    rt.cancel++;
    rt.cache.locked = false;
    rt.baked = false;
    this.dropState(rt, true);
    rt.error = undefined;
    rt.seam = undefined;
    this.bump(rt);
    this.deps.scheduler.invalidate();
  }
  resimulate(nodeId: string): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return;
    this.reset(nodeId);
    this.schedule(rt);
  }
  setPaused(nodeId: string, paused: boolean): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return;
    rt.paused = paused;
    if (paused) rt.cancel++;
    else this.schedule(rt);
    this.bump(rt);
  }
  cancel(nodeId: string): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return;
    rt.cancel++;
    rt.status = 'idle';
    rt.progress = 0;
    this.bump(rt);
  }
  /** Simulate every frame of the loop and lock the cache: upstream edits no longer trigger a re-simulation. */
  bake(nodeId: string): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt || rt.baked) return;
    rt.bakeRequested = true;
    const cfg = rt.spec.cfg;
    const total = totalSimFrames(cfg.loopLength, cfg.blend, cfg.loopMode);
    const need = total * (rt.backend?.stateBytes ?? rt.spec.size.w * rt.spec.size.h * 16);
    const cap = this.deps.mm.budgetBytes * 0.6;
    if (need > cap) {
      rt.error = `Bake needs ${(need / 1048576).toFixed(0)} MB, more than the memory budget allows (${(cap / 1048576).toFixed(0)} MB). Lower the resolution or loop length.`;
      rt.status = 'over-budget';
      rt.bakeRequested = false;
      this.bump(rt);
      return;
    }
    rt.cache.setBudget(Math.max(rt.cache.budgetBytes, need));
    rt.cache.configure(total, rt.backend?.stateBytes ?? 1);
    this.schedule(rt);
    this.bump(rt);
  }
  unbake(nodeId: string): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return;
    rt.cache.locked = false;
    rt.baked = false;
    rt.bakeRequested = false;
    rt.cache.setBudget(this.budgetFor(rt.spec));
    this.bump(rt);
    this.deps.scheduler.invalidate();
  }
  /** Forget a node (deleted from the graph). */
  forget(nodeId: string): void {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return;
    rt.cancel++;
    this.dropState(rt, true);
    rt.cache.clear(true);
    this.runtimes.delete(nodeId);
  }
  /** Device lost / project closed: drop all GPU state, keep the specs (re-simulated on demand). */
  clear(): void {
    for (const rt of this.runtimes.values()) {
      rt.cancel++;
      rt.cache.locked = false;
      rt.baked = false;
      this.dropState(rt, true);
      rt.lastView = null;
      rt.rev++;
    }
    this.queue = [];
    this.epoch++;
  }

  /** Memory pressure callback: free evictable frames of all nodes. */
  private evict(need: number): number {
    let freed = 0;
    for (const rt of this.runtimes.values()) {
      if (freed >= need) break;
      freed += rt.cache.evictBytes(need - freed);
    }
    return freed;
  }

  /** Drop cached frames >= `from` (checkpoints before it stay); the live state is invalid when it is at / beyond `from`. */
  private invalidateTail(rt: Runtime, from: number): void {
    if (!isFinite(from)) return;
    rt.cache.invalidateFrom(from);
    if (rt.cursor >= from || rt.cursor < -1) {
      rt.cursor = -2; // live state is stale: the next job restores the nearest cached frame <= target (or resets)
      this.warmDone.delete(rt);
    }
    rt.status = 'idle';
    rt.progress = 0;
  }

  private dropState(rt: Runtime, clearCache: boolean): void {
    rt.backend?.dispose();
    rt.backend = null;
    rt.cursor = -2;
    if (clearCache) rt.cache.clear(true);
    rt.status = 'idle';
    rt.progress = 0;
  }

  /* ------------------------------------------------------------------ job loop */
  private schedule(rt: Runtime): void {
    if (rt.queued || rt.working) return;
    rt.queued = true;
    this.queue.push(rt);
    void this.loop();
  }

  private async loop(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      while (this.queue.length) {
        const rt = this.queue.shift()!;
        rt.queued = false;
        rt.working = true;
        try {
          await this.work(rt);
        } catch (e) {
          this.fail(rt, e);
        } finally {
          rt.working = false;
        }
        // something may have been requested meanwhile
        if (this.needsWork(rt) && !rt.queued && !rt.paused && rt.status !== 'error') this.schedule(rt);
      }
    } finally {
      this.looping = false;
    }
  }

  private fail(rt: Runtime, e: unknown): void {
    const msg = (e as Error).message ?? String(e);
    if (msg === 'cancelled') return;
    rt.error = msg;
    rt.status = e instanceof OutOfBudgetError ? 'over-budget' : 'error';
    consoleBus.error(`Simulation failed: ${msg}`, { source: 'eval', nodeId: rt.spec.nodeId, nodeName: rt.spec.nodeName });
    this.bump(rt);
    this.deps.scheduler.invalidate();
  }

  private missing(rt: Runtime): number[] {
    return rt.needed.filter((k) => !rt.cache.has(k) && rt.cursor !== k).sort((a, b) => a - b);
  }
  private needsWork(rt: Runtime): boolean {
    if (rt.paused || rt.baked) return !!rt.pending && !rt.baked;
    return !!rt.pending || this.missing(rt).length > 0 || (rt.bakeRequested && !this.bakeDone(rt));
  }
  private bakeDone(rt: Runtime): boolean {
    const c = rt.spec.cfg;
    const total = totalSimFrames(c.loopLength, c.blend, c.loopMode);
    for (let k = 0; k < total; k++) if (!rt.cache.has(k)) return false;
    return true;
  }

  /** Make the pending spec the active one and drop what it invalidates (everything, or only the frames from the first animated change). */
  private activatePending(rt: Runtime): void {
    const p = rt.pending;
    if (!p) return;
    rt.pending = null;
    const nu = p.signatures ? p.signatures() : null;
    // animated-only change: keep everything before the first frame whose animated values differ
    const plan = p.staticKey !== undefined && p.staticKey === rt.staticKey ? planInvalidation(rt.sigs, nu) : ({ kind: 'full' } as const);
    rt.spec = p;
    rt.key = p.key;
    rt.staticKey = p.staticKey;
    rt.sigs = nu;
    rt.cancel++;
    rt.error = undefined;
    rt.seam = undefined;
    if (plan.kind === 'full') this.dropState(rt, true);
    else this.invalidateTail(rt, plan.kind === 'none' ? Infinity : plan.frame);
    this.applyCacheConfig(rt);
    this.bump(rt);
    this.deps.scheduler.invalidate();
  }

  private async work(rt: Runtime): Promise<void> {
    const sch = this.deps.scheduler;
    // 1. debounced invalidation
    if (rt.pending && !rt.baked) {
      while (sch.isInteracting || Date.now() - rt.changedAt < this.debounceMs) await delay(40);
      this.activatePending(rt);
    } else if (rt.pending) rt.pending = null;
    else if (rt.sigs === undefined) rt.sigs = rt.spec.signatures ? rt.spec.signatures() : null; // first activation

    if (rt.paused) return;
    // never simulate for a node nobody asked for, unless it is being baked
    const token = ++rt.cancel;
    const cancelled = (): boolean => token !== rt.cancel;
    const cfg = rt.spec.cfg;
    const total = totalSimFrames(cfg.loopLength, cfg.blend, cfg.loopMode);
    for (let guard = 0; guard < 100000; guard++) {
      if (cancelled()) return;
      let todo = this.missing(rt);
      if (rt.bakeRequested && !rt.baked) {
        for (let k = 0; k < total; k++) if (!rt.cache.has(k) && rt.cursor !== k) { todo = [k, ...todo]; break; }
        todo.sort((a, b) => a - b);
      }
      if (!todo.length) break;
      const target = todo[0];
      rt.status = 'simulating';
      await sch.runExclusiveForce(() => this.advance(rt, target, this.chunkMs, cancelled));
      rt.progress = Math.max(0, Math.min(1, (rt.cursor + 1) / Math.max(1, rt.bakeRequested ? total : Math.max(...rt.needed, 0) + 1)));
      this.bump(rt);
      sch.invalidate();
      await delay(8); // let the scheduler evaluate / draw what we have so far
    }
    if (cancelled()) return;
    if (rt.status !== 'over-budget' && rt.status !== 'error') rt.status = 'idle';
    rt.progress = 1;
    if (rt.bakeRequested && this.bakeDone(rt)) {
      rt.cache.locked = true;
      rt.baked = true;
      rt.bakeRequested = false;
      rt.backend?.dispose(); // temporaries are not needed any more: only the cache stays (locked)
      rt.backend = null;
      rt.cursor = -2;
    }
    const cs = rt.cache.stats();
    consoleBus.info(`Simulation "${rt.spec.nodeName}": cache ${(cs.usedBytes / 1048576).toFixed(1)} / ${(cs.budgetBytes / 1048576).toFixed(1)} MB, ${cs.frames} frames (checkpoint every ${cs.interval}), ${cs.evictions} evictions`, { source: 'eval', nodeId: rt.spec.nodeId, nodeName: rt.spec.nodeName });
    this.bump(rt);
    sch.invalidate();
  }

  /* ------------------------------------------------------------------ stepping */
  private async ensureBackend(rt: Runtime): Promise<SimulationBackend> {
    if (rt.backend) return rt.backend;
    const { gpu, mm, runner } = this.deps;
    const b = rt.spec.create({ gpu, mm, runner, owner: { nodeId: rt.spec.nodeId, nodeName: rt.spec.nodeName } });
    rt.backend = b;
    this.applyCacheConfig(rt);
    await b.prewarm();
    return b;
  }

  private async record(make: () => GPUCommandBuffer, rollback?: () => void): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        this.deps.runner.submit([make()]);
        return;
      } catch (e) {
        rollback?.();
        if (e instanceof PipelinePending && attempt < 64) {
          await e.promise;
          continue;
        }
        throw e;
      }
    }
  }

  /** Evaluate the connected lazy input pins at the frame time. Returns textures valid until `release()`. */
  private async inputsAt(rt: Runtime, forcing: number): Promise<{ tex: SimFrameInputs; release: () => void }> {
    const pins = Object.entries(rt.spec.lazy);
    if (!pins.length) return { tex: {}, release: () => undefined };
    const g = rt.spec.graph;
    const targets = pins.map(([, p]) => ({ nodeId: p.nodeId, pinId: p.pin }));
    const gs = g.settings;
    const scale = Math.max(1 / 16, Math.min(1, rt.spec.cfg.inputScale));
    const res = await this.deps.evaluator.evaluate(g, targets, { time: Math.max(0, forcing) / Math.max(FPS_EPS, rt.spec.cfg.fps || gs.fps), scale });
    const tex: SimFrameInputs = {};
    for (const [pinId, p] of pins) {
      const v = res.values.get(targetKey({ nodeId: p.nodeId, pinId: p.pin }));
      if (res.errors.has(p.nodeId)) consoleBus.warn(`Simulation input "${pinId}" failed: ${res.errors.get(p.nodeId)}`, { source: 'eval', nodeId: rt.spec.nodeId, nodeName: rt.spec.nodeName });
      tex[pinId] = v && v.kind === 'texture' ? v.tex : null;
    }
    return { tex, release: () => res.release() };
  }

  private async stepOne(rt: Runtime, b: SimulationBackend, k: number): Promise<void> {
    const cfg = rt.spec.cfg;
    const forcing = forcingFrame(k, cfg.loopLength, cfg.loopMode);
    const t0 = performance.now();
    const inp = await this.inputsAt(rt, forcing);
    try {
      await this.record(() => {
        const enc = this.deps.gpu.device.createCommandEncoder({ label: `sim ${rt.spec.nodeName} frame ${k}` });
        b.step(enc, k, forcing, inp.tex);
        return enc.finish();
      });
    } finally {
      inp.release();
    }
    await b.settle();
    rt.stepsRun++;
    const ms = performance.now() - t0;
    rt.stepMs = rt.stepMs > 0 ? rt.stepMs * 0.8 + ms * 0.2 : ms;
  }

  private snapshot(rt: Runtime, b: SimulationBackend, k: number): void {
    if (rt.cache.budgetBytes < b.stateBytes) return;
    let copy: GpuTexture[];
    try {
      copy = b.state().map((t) => this.deps.mm.textures.acquire({ width: t.width, height: t.height, format: t.format, label: `sim snapshot ${k}` }));
    } catch (e) {
      if (e instanceof OutOfBudgetError) {
        rt.status = 'over-budget';
        rt.cache.setBudget(Math.floor(rt.cache.used * 0.9)); // memory is tight: stop growing the cache
        return;
      }
      throw e;
    }
    const enc = this.deps.gpu.device.createCommandEncoder({ label: `sim snapshot ${k}` });
    b.copyState(enc, b.state(), copy);
    this.deps.runner.submit([enc.finish()]);
    if (!rt.cache.put(k, copy, b.stateBytes)) {
      copy.forEach((t) => t.release());
      if (rt.cache.budgetBytes > 0) rt.status = 'over-budget';
    }
  }

  /**
   * Advance (or restore + advance) until frame `target` exists, for at most `chunkMs` of wall time (resumable: the cursor persists).
   * Runs inside an exclusive scheduler section (or by the caller when exclusive already).
   */
  private async advance(rt: Runtime, target: number, chunkMs: number, cancelled: () => boolean): Promise<void> {
    const b = await this.ensureBackend(rt);
    const t0 = performance.now();
    const cfg = rt.spec.cfg;
    const live = rt.cursor >= -1 && rt.cursor <= target;
    const best = rt.cache.nearestAtOrBefore(target);
    if (!live || (best !== undefined && best > rt.cursor)) {
      if (best !== undefined) {
        // restore the nearest checkpoint / cached frame
        const snap = rt.cache.get(best)!;
        const enc = this.deps.gpu.device.createCommandEncoder({ label: `sim restore ${best}` });
        b.copyState(enc, snap, b.state());
        this.deps.runner.submit([enc.finish()]);
        await b.settle();
        rt.cursor = best;
      } else {
        await this.resetAndWarm(rt, b, cancelled, t0, chunkMs);
        if (rt.cursor < -1) return; // chunk budget used up during warm-up: resume next time
      }
    }
    while (rt.cursor < target) {
      if (cancelled()) throw new Error('cancelled');
      if (performance.now() - t0 > chunkMs) return;
      const k = rt.cursor + 1;
      await this.stepOne(rt, b, k);
      rt.cursor = k;
      this.snapshot(rt, b, k);
    }
    void cfg;
  }

  private warmDone = new WeakMap<Runtime, number>();
  private async resetAndWarm(rt: Runtime, b: SimulationBackend, cancelled: () => boolean, t0: number, chunkMs: number): Promise<void> {
    const cfg = rt.spec.cfg;
    const startAt = this.warmDone.get(rt);
    if (startAt === undefined || rt.cursor === -2) {
      // reset: initial-state pins are evaluated at frame 0
      const inp = await this.inputsAt(rt, 0);
      try {
        await this.record(() => {
          const enc = this.deps.gpu.device.createCommandEncoder({ label: `sim reset ${rt.spec.nodeName}` });
          b.reset(enc, inp.tex);
          return enc.finish();
        });
      } finally {
        inp.release();
      }
      this.warmDone.set(rt, -cfg.warmup - 1);
      rt.cursor = -3 - 0; // marker: warming (distinct from "no state")
    }
    let w = this.warmDone.get(rt)!;
    while (w < -1) {
      if (cancelled()) throw new Error('cancelled');
      if (performance.now() - t0 > chunkMs) {
        this.warmDone.set(rt, w);
        return;
      }
      w++;
      await this.stepOne(rt, b, w);
    }
    this.warmDone.delete(rt);
    await b.settle();
    rt.cursor = -1;
    this.snapshot(rt, b, -1);
  }

  /* ------------------------------------------------------------------ export / flipbook hook */
  /** Does the graph contain a simulation node (directly, or possibly inside a subgraph instance)? Cheap pre-check for export loops. */
  usesSimulation(graph: Graph): boolean {
    for (const n of graph.nodes.values()) if (graph.registry.get(n.type)?.simulation || n.type.startsWith('subgraph.')) return true;
    return false;
  }

  /**
   * Export hook for EVERY export job (image / sequence / flipbook / viewport frames, all go through `renderNodeRows` or call this):
   * evaluate once so the simulation nodes register the requested frame, then advance them (frames are produced in order, snapshots obey
   * the cache budget), so the real evaluation that follows sees ready frames. No-op for graphs without simulation nodes.
   * Returns false when the job was cancelled meanwhile.
   */
  async prepareFrame(graph: Graph, targets: { nodeId: string; pinId?: string }[], time: number, opts: { scale?: number; token?: { cancelled: boolean } } = {}): Promise<boolean> {
    if (!this.usesSimulation(graph)) return true;
    const warm = await this.deps.evaluator.evaluate(graph, targets, { time, scale: opts.scale ?? 1, token: opts.token, useCache: false });
    warm.release();
    try {
      await this.settle(Math.round(time * graph.settings.fps), () => !!opts.token?.cancelled);
    } catch (e) {
      if ((e as Error).message === 'cancelled') return false;
      throw e;
    }
    return !opts.token?.cancelled;
  }

  /**
   * Export hook: make sure the simulated frames needed to show timeline frame `frame` exist, WITHOUT the scheduler (the caller already
   * owns the evaluator exclusively, as the FlipbookBaker does). Frames are produced in order; the cache budget is never exceeded
   * (checkpoint based). Returns true when work was done (the caller should evaluate the graph again).
   */
  async settle(frame: number, cancelled?: () => boolean): Promise<boolean> {
    let did = false;
    for (const rt of this.runtimes.values()) {
      if (rt.baked || rt.paused) continue;
      if (rt.pending) {
        this.activatePending(rt); // export: no debounce, the frames must belong to the project as it is now
        did = true;
      }
      const cfg = rt.spec.cfg;
      const need = requiredFrames(loopPlan(frame, cfg.loopLength, cfg.blend, cfg.loopMode));
      rt.needed = need;
      for (const k of need.sort((a, b) => a - b)) {
        if (rt.cache.has(k) || rt.cursor === k) continue;
        const token = ++rt.cancel;
        await this.advance(rt, k, Infinity, () => token !== rt.cancel || !!cancelled?.());
        did = true;
      }
      if (did) this.bump(rt);
    }
    return did;
  }

  /* ------------------------------------------------------------------ loop-seam verifier */
  /**
   * Loop seam error: mean |difference| between the last and the first output frame (density + velocity channels), and the same
   * measure between the last two frames (natural frame-to-frame change). ratio ~ 1 means the seam is as smooth as normal motion.
   */
  async verifySeam(nodeId: string): Promise<{ error: number; ratio: number } | null> {
    const rt = this.runtimes.get(nodeId);
    if (!rt) return null;
    const cfg = rt.spec.cfg;
    const L = cfg.loopLength;
    const frames = [L - 2, L - 1, loopPlan(0, L, cfg.blend, cfg.loopMode).a].map((k) => Math.max(0, k));
    const toRead: GpuTexture[][] = [];
    for (const k of frames) {
      rt.needed = [k];
      if (!rt.cache.has(k)) {
        this.schedule(rt);
        for (let i = 0; i < 4000 && !rt.cache.has(k) && !rt.paused; i++) await delay(50);
      }
      const t = rt.cache.peek(k);
      if (!t) return null;
      toRead.push(t);
    }
    const rd = async (t: GpuTexture): Promise<Float32Array> => readTextureFloat32(this.deps.gpu, this.deps.mm, t.texture, t.format, t.width, t.height);
    const [p, l, f] = await Promise.all(toRead.map((t) => rd(t[0])));
    const cmp = (a: Float32Array, b: Float32Array): number => {
      const ax: number[] = [];
      const bx: number[] = [];
      for (let i = 0; i < a.length; i += 4) {
        ax.push(a[i], a[i + 1], a[i + 2]);
        bx.push(b[i], b[i + 1], b[i + 2]);
      }
      return seamError(ax, bx);
    };
    const err = cmp(l, f);
    const nat = cmp(p, l);
    rt.seam = { error: err, ratio: nat > 1e-9 ? err / nat : err > 1e-9 ? Infinity : 1 };
    this.bump(rt);
    return rt.seam;
  }
}

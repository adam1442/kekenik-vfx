import { deriveLimits } from '../gpu/caps';
import { texSnaps, type CpuTexture } from '../mesh/texsnap';
import { Emitter } from '../../shared/emitter';
import { FusionRuntime, fuseIO, fuseView, specsFor } from '../fusion/runtime';
import { planFusion, type Segment } from '../fusion/planner';
import { MeshJobs } from '../../workers/mesh-jobs';
import { getPool } from '../../workers';
import { segmentSignature } from '../fusion/wgsl-gen';
import { consoleBus } from '../../shared/log';
import type { GpuContext } from '../gpu/device';
import type { ComputeBinding, ComputePassDesc, FrameParams, PassRunner } from '../gpu/passes';
import type { GpuProfiler } from '../gpu/profiler';
import { Params } from '../params/accessor';
import type { OutputCache } from '../resources/cache';
import { OutputCache as Cache } from '../resources/cache';
import { formatForPin } from '../resources/format';
import type { GpuTexture, MemoryManager } from '../resources/memory';
import type { PooledBuffer } from '../resources/memory';
import { OutOfBudgetError } from '../resources/memory';
import { releaseValue, retainValue, textureValue, type PinValue, type TextureValue } from '../resources/values';
import { BACKGROUND_BLEND, BACKGROUND_BLEND_LAYOUT, CONVERT_GRAY_COLOR } from '../shaders/builtin';
import { PipelinePending, ShaderCompileError } from '../shaders/pipelines';
import type { UniformLayout, UniformValue } from '../shaders/uniforms';
import { isTexturePin, type TexturePin } from '../types';
import type { Graph } from './graph';
import type { EvalContext, ModulationInput, NodeDefinition, NodePassDesc } from './node';
import { simFor } from '../sim/service';
import { buildPlan, type ParamAnimator, type PlanNode, type Region } from './plan';
import type { NodeRegistry } from './registry';

export interface EvalTarget {
  nodeId: string;
  /** Output pin id; default = the node's first output. */
  pinId?: string;
}
export const targetKey = (t: EvalTarget): string => `${t.nodeId}:${t.pinId ?? ''}`;

/** result of a graph pre-pass (subgraph flattening). Evaluated graph + mapping back to the user's node ids. */
export interface GraphPreprocess {
  graph: Graph;
  mapTarget(t: EvalTarget): EvalTarget;
  /** Top-level subgraph instance that owns a flattened inner node id (undefined for ordinary nodes). */
  rootOf(flatId: string): string | undefined;
}

export interface CancelToken {
  cancelled: boolean;
}

export interface EvalOptions {
  /** Seconds. */
  time?: number;
  /** Preview resolution factor, 1 = full. */
  scale?: number;
  /** Tiled rendering region (see TileScheduler / evaluateTiled). Disables the cache. */
  region?: Region;
  token?: CancelToken;
  /** Submit and validate every node separately (slower; attributes GPU validation errors to nodes). */
  isolate?: boolean;
  useCache?: boolean;
  /** allow CPU mesh nodes to run in workers (viewport / thumbnail evaluations). Export and tests leave it off: they always compute synchronously. */
  jobs?: boolean;
}

export type NodeStatus = 'ok' | 'cached' | 'error' | 'blocked' | 'bypassed';
export interface NodeStat {
  status: NodeStatus;
  cpuMs: number;
  /** Filled in asynchronously (timestamp queries) after the evaluation resolved. */
  gpuMs?: number;
  error?: string;
  hash: number;
  width: number;
  height: number;
  /** the node was rendered inside a fused pass (it has no cached output of its own unless it is the last node). */
  fused?: boolean;
}
export interface EvalStats {
  scale: number;
  isolated: boolean;
  cpuMs: number;
  /** Sum of node GPU times (async). */
  gpuMs?: number;
  nodesPlanned: number;
  nodesEvaluated: number;
  cacheHits: number;
  nodes: Map<string, NodeStat>;
}
export interface EvalResult {
  /** targetKey -> value. Valid until release(). */
  values: Map<string, PinValue>;
  errors: Map<string, string>;
  stats: EvalStats;
  cancelled: boolean;
  /** Releases the references the result holds. MUST be called when done (idempotent). */
  release(): void;
}

class CancelledError extends Error {}

/** everything NodeAttempt needs to record the single pass of a fused segment. */
interface FusedExec {
  seg: Segment;
  plan: { nodes: Map<string, PlanNode> };
  entry: ReturnType<FusionRuntime['moduleFor']>;
}

/**
 * Pull-based, cache-aware graph evaluator.
 *
 *  1. buildPlan(): order + hashes + frames (pure).
 *  2. Reverse pass: from the targets, a node whose outputs are all cache hits (same hash) is NOT evaluated and
 *     its inputs are not even visited ("target-driven partial evaluation").
 *  3. Forward pass: each node records its GPU work into its OWN command encoder (so a failed/retried node can be
 *     dropped cleanly); all command buffers are submitted ONCE (single batched submit) inside a validation error
 *     scope. If the batch fails validation we re-run in isolated mode to attribute the error to a node.
 *  4. Outputs are ref-counted: the evaluator drops its reference right after the last consumer ran; the output
 *     cache keeps one reference (LRU, evicted under memory pressure).
 */
export class Evaluator {
  readonly cache: OutputCache;
  animator?: ParamAnimator;
  /** optional graph pre-pass (subgraph flattening). Return null to evaluate the graph as is. */
  preprocess?: (graph: Graph) => GraphPreprocess | null;
  /** Fires when asynchronous GPU timings of the most recent evaluation arrive. */
  readonly onTiming = new Emitter<EvalStats>();
  private lastLogged = new Map<string, string>();
  /** number of node evaluations that were skipped because the node was an identity for its parameters. */
  identitySkips = 0;
  /** pixel pass fusion runtime (settings, module LRU, diagnostics). */
  readonly fusion = new FusionRuntime();
  /** CPU mesh jobs in workers (interactive evaluations only: `EvalOptions.jobs`). */
  readonly jobs: MeshJobs;

  constructor(
    readonly gpu: GpuContext,
    readonly mm: MemoryManager,
    readonly registry: NodeRegistry,
    readonly runner: PassRunner,
    readonly profiler: GpuProfiler,
  ) {
    this.cache = new Cache(Math.round(mm.budgetBytes * 0.5));
    mm.registerEvictor((need) => void this.cache.evict(need));
    this.jobs = new MeshJobs(typeof Worker !== 'undefined' ? getPool() : null, mm);
    // limit-aware fusion: textures per stage and uniform size come from the ACTUAL device limits
    const lim = deriveLimits(gpu.caps);
    this.fusion.limits.maxTextures = Math.max(2, Math.min(this.fusion.limits.maxTextures, lim.maxSampledTextures - 2));
    this.fusion.limits.maxUniformBytes = Math.min(this.fusion.limits.maxUniformBytes, gpu.caps.limits.maxUniformBufferBindingSize ?? 16384);
    this.fusion.onEvict = (shaderId) => void runner.pipelines.deleteMatching(`|${shaderId}|`);
  }

  async evaluate(graph: Graph, targets: EvalTarget[], opts: EvalOptions = {}): Promise<EvalResult> {
    const pre = this.preprocess?.(graph) ?? null;
    if (!pre) return this.evaluateFlat(graph, targets, opts);
    const mapped = targets.map((t) => pre.mapTarget(t));
    const res = await this.evaluateFlat(pre.graph, mapped, opts);
    targets.forEach((t, i) => {
      const v = res.values.get(targetKey(mapped[i]));
      if (v !== undefined) res.values.set(targetKey(t), v); // alias under the ORIGINAL target key
      if (t.nodeId !== mapped[i].nodeId) {
        const st = res.stats.nodes.get(mapped[i].nodeId);
        if (st && !res.stats.nodes.has(t.nodeId)) res.stats.nodes.set(t.nodeId, st);
      }
    });
    for (const [id, st] of [...res.stats.nodes]) {
      const root = pre.rootOf(id);
      if (!root || (st.status !== 'error' && st.status !== 'blocked')) continue;
      const cur = res.stats.nodes.get(root);
      if (!cur || cur.status === 'ok' || cur.status === 'cached') res.stats.nodes.set(root, { ...st, error: st.error ? `${st.error} (inside subgraph)` : st.error });
    }
    for (const [id, msg] of [...res.errors]) {
      const root = pre.rootOf(id);
      if (root && !res.errors.has(root)) res.errors.set(root, `${msg} (inside subgraph)`);
    }
    return res;
  }

  private async evaluateFlat(graph: Graph, targets: EvalTarget[], opts: EvalOptions = {}): Promise<EvalResult> {
    const startT = performance.now();
    const token = opts.token ?? { cancelled: false };
    const isolate = !!opts.isolate;
    const scale = opts.scale ?? 1;
    const dev = this.gpu.device;
    this.cache.maxBytes = Math.round(this.mm.budgetBytes * 0.5);

    const targetNodes = [...new Set(targets.filter((t) => graph.nodes.has(t.nodeId)).map((t) => t.nodeId))];
    const targetPins = new Map<string, Set<string>>();
    for (const t of targets) {
      let set = targetPins.get(t.nodeId);
      if (!set) targetPins.set(t.nodeId, (set = new Set()));
      const pn = graph.nodes.get(t.nodeId);
      const pid = t.pinId ?? (pn ? graph.expandedOf(t.nodeId)?.outputs[0]?.id : undefined);
      if (pid) set.add(pid);
    }
    const plan = buildPlan(graph, targetNodes, {
      time: opts.time ?? 0,
      scale,
      maxDim: this.gpu.caps.limits.maxTextureDimension2D ?? 8192,
      region: opts.region,
      animator: this.animator,
      jobReady: opts.jobs && this.jobs.available && !opts.region ? (k) => this.jobs.has(k) : undefined,
      simSalt: (nid) => simFor(this.gpu)?.salt(nid) ?? '',
      targetPins,
    });
    const useCache = opts.useCache !== false && !opts.region;
    const keyOf = (nodeId: string, pin: string): string => `${graph.id}:${nodeId}:${pin}`;

    /* ---- reverse pass: what must run? ---- */
    const need = new Set(targetNodes);
    const action = new Map<string, 'hit' | 'run' | 'error'>();
    for (let i = plan.order.length - 1; i >= 0; i--) {
      const id = plan.order[i];
      if (!need.has(id)) continue;
      const pn = plan.nodes.get(id)!;
      if (pn.error) {
        action.set(id, 'error');
        continue;
      }
      const outs = pn.expanded!.outputs.filter((o) => !pn.wanted || pn.wanted.has(o.id));
      const allHit = useCache && outs.length > 0 && outs.every((o) => this.cache.has(keyOf(id, o.id), pn.hash));
      if (allHit) action.set(id, 'hit');
      else {
        action.set(id, 'run');
        for (const inp of pn.inputs) if (inp.link && !inp.pin.lazy) need.add(inp.link.from.node);
      }
    }

    const stats: EvalStats = { scale, isolated: isolate, cpuMs: 0, nodesPlanned: need.size, nodesEvaluated: 0, cacheHits: 0, nodes: new Map() };
    const held = new Map<string, Map<string, PinValue>>();
    const failed = new Map<string, string>();
    const isTarget = new Set(targetNodes);

    /* ---- pixel pass fusion planning (pure planner over the nodes that will RUN) ---- */
    const consumersOf = new Map<string, number>();
    for (const l of graph.links.values()) consumersOf.set(l.from.node, (consumersOf.get(l.from.node) ?? 0) + 1);
    const runIds = plan.order.filter((id) => need.has(id) && action.get(id) === 'run');
    const fusionOn = this.fusion.enabled && !isolate && runIds.length > 1;
    const views = new Map<string, NonNullable<ReturnType<typeof fuseView>>>();
    if (fusionOn) for (const id of runIds) {
      const v = fuseView(plan, id, consumersOf.get(id) ?? 0);
      if (v) views.set(id, v);
    }
    const fplan = planFusion(runIds, (id) => views.get(id), isTarget, this.fusion.limits, fusionOn);
    if (fusionOn) this.fusion.record(fplan, (id) => plan.nodes.get(id)?.node.name ?? id, (id) => plan.nodes.get(id)?.node.type ?? id);
    /** Producers of the EXTERNAL inputs of a fused segment (seed + connected extras). */
    const externalsOf = (seg: Segment): string[] => {
      const out = new Set<string>();
      if (seg.seed) out.add(seg.seed.node);
      for (const id of seg.ids) {
        const pn = plan.nodes.get(id)!;
        for (const pinId of pn.expanded!.def.fusable!.extras ?? []) {
          const l = pn.inputs.find((i) => i.pin.id === pinId)?.link;
          if (l) out.add(l.from.node);
        }
      }
      return [...out];
    };
    const producersOf = (id: string): string[] => {
      const seg = fplan.byNode.get(id);
      if (seg) return id === seg.last ? externalsOf(seg) : [];
      return [...new Set(plan.nodes.get(id)!.inputs.filter((i) => i.link && !i.pin.lazy).map((i) => i.link!.from.node))];
    };
    const remaining = new Map<string, number>();
    for (const id of plan.order) {
      if (action.get(id) !== 'run') continue;
      for (const src of producersOf(id)) remaining.set(src, (remaining.get(src) ?? 0) + 1);
    }
    const dropPending = (): void => {
      for (const c of pendingCache) releaseValue(c.value);
      pendingCache.length = 0;
    };
    const releaseHeld = (id: string): void => {
      const m = held.get(id);
      if (!m) return;
      for (const v of m.values()) releaseValue(v);
      held.delete(id);
    };
    const cleanupAll = (): void => {
      for (const id of [...held.keys()]) releaseHeld(id);
    };

    const cbs: GPUCommandBuffer[] = [];
    const pendingCache: { key: string; hash: number; value: PinValue }[] = [];
    let cancelled = false;

    this.cache.pin(plan.order.flatMap((id) => (plan.nodes.get(id)!.expanded?.outputs ?? []).map((o) => keyOf(id, o.id))));
    if (isolate) this.profiler.suspend();
    else this.profiler.beginBatch();

    const fail = (pn: PlanNode, status: NodeStatus, message: string, cpuMs: number, quiet = false): void => {
      failed.set(pn.id, message);
      stats.nodes.set(pn.id, { status, cpuMs, error: message, hash: pn.hash, width: pn.frame.width, height: pn.frame.height });
      if (!quiet && status === 'error' && this.lastLogged.get(pn.id) !== message) {
        consoleBus.error(message, { source: 'eval', nodeId: pn.id, nodeName: pn.node.name });
      }
      if (status === 'error') this.lastLogged.set(pn.id, message);
    };

    /* ---- forward pass ---- */
    const releaseAfter = (producers: string[]): void => {
      for (const src of producers) {
        const c = (remaining.get(src) ?? 1) - 1;
        remaining.set(src, c);
        if (c <= 0 && !isTarget.has(src)) releaseHeld(src);
      }
    };
    /** Commit the recorded result of a node (or of the last node of a fused segment). Returns false when the node failed validation (isolated mode). */
    const commit = async (pn: PlanNode, r: { outputs: Record<string, PinValue>; cb?: GPUCommandBuffer }, t1: number, fused = false): Promise<void> => {
      stats.nodesEvaluated++;
      held.set(pn.id, new Map(Object.entries(r.outputs)));
      let ok = true;
      if (r.cb) {
        if (isolate) {
          const { error } = await this.gpu.scope('validation', () => this.runner.submit([r.cb!]));
          if (error) {
            ok = false;
            releaseHeld(pn.id);
            fail(pn, 'error', `GPU validation error: ${error.message}`, performance.now() - t1);
          }
        } else {
          cbs.push(r.cb);
        }
      }
      if (ok) {
        stats.nodes.set(pn.id, { status: pn.node.bypass ? 'bypassed' : 'ok', cpuMs: performance.now() - t1, hash: pn.hash, width: pn.frame.width, height: pn.frame.height, fused: fused || undefined });
        this.lastLogged.delete(pn.id);
        if (useCache) {
          for (const [pin, value] of Object.entries(r.outputs)) {
            if (isolate) this.cache.set(keyOf(pn.id, pin), pn.hash, value);
            else {
              retainValue(value); // keep alive until the batch is validated and committed to the cache
              pendingCache.push({ key: keyOf(pn.id, pin), hash: pn.hash, value });
            }
          }
        }
      }
    };
    /** Run `runNode` with the memory-pressure retry used for every node. */
    const runWithRetry = async (pn: PlanNode, fused?: FusedExec): Promise<{ outputs: Record<string, PinValue>; cb?: GPUCommandBuffer }> => {
      try {
        return await this.runNode(pn, held, token, fused);
      } catch (err) {
        // Memory pressure inside a batch: the references kept ONLY to commit outputs to the cache after the
        // submit pin every intermediate of a long chain. Give them up (those nodes simply are not cached; the
        // recorded passes stay valid because command buffers execute in order) and retry this node once.
        if (err instanceof OutOfBudgetError && pendingCache.length > 0) {
          dropPending();
          return await this.runNode(pn, held, token, fused);
        }
        throw err;
      }
    };
    /** Standard path of ONE node. Returns true when the evaluation was cancelled. */
    const execNode = async (id: string, releaseInputs: boolean): Promise<boolean> => {
      const pn = plan.nodes.get(id)!;
      const act = action.get(id)!;
      const t1 = performance.now();
      if (act === 'hit') {
        const vals = new Map<string, PinValue>();
        for (const o of pn.expanded!.outputs) {
          if (pn.wanted && !pn.wanted.has(o.id)) continue;
          const v = this.cache.get(keyOf(id, o.id), pn.hash)!;
          retainValue(v);
          vals.set(o.id, v);
        }
        held.set(id, vals);
        stats.cacheHits++;
        stats.nodes.set(id, { status: 'cached', cpuMs: 0, hash: pn.hash, width: pn.frame.width, height: pn.frame.height });
        return false;
      }
      if (act === 'error') {
        fail(pn, 'error', pn.error!, 0);
        return false;
      }
      const blockedBy = pn.inputs.find((i) => i.link && !i.pin.lazy && failed.has(i.link.from.node));
      if (blockedBy) {
        const up = plan.nodes.get(blockedBy.link!.from.node)!;
        fail(pn, 'blocked', `Upstream node "${up.node.name}" failed`, 0, true);
      } else {
        try {
          await commit(pn, await runWithRetry(pn), t1);
        } catch (e) {
          if (e instanceof CancelledError) return true;
          const quiet = e instanceof ShaderCompileError || (e as Error).name === 'PendingError'; // already logged (shader) / expected transient state (asset still decoding)
          fail(pn, 'error', (e as Error).message ?? String(e), performance.now() - t1, quiet);
        }
      }
      if (releaseInputs) releaseAfter(producersOf(id));
      return false;
    };
    /** Fused segment: ONE pass for the whole chain; on ANY failure the segment is evaluated node by node (the graph never dies). */
    const execSegment = async (seg: Segment): Promise<boolean> => {
      const last = plan.nodes.get(seg.last)!;
      const t1 = performance.now();
      const ext = externalsOf(seg);
      let done = false;
      if (!ext.some((x) => failed.has(x))) {
        const specs = specsFor(seg, plan);
        const sig = segmentSignature(specs, false);
        if (!this.fusion.broken.has(sig)) {
          try {
            const entry = this.fusion.moduleFor(specs);
            const r = await runWithRetry(last, { seg, plan, entry });
            await commit(last, r, t1, true);
            for (const id of seg.ids) if (id !== seg.last) stats.nodes.set(id, { status: 'ok', cpuMs: 0, hash: plan.nodes.get(id)!.hash, width: plan.nodes.get(id)!.frame.width, height: plan.nodes.get(id)!.frame.height, fused: true });
            for (const id of seg.skipped) stats.nodes.set(id, { status: 'ok', cpuMs: 0, hash: plan.nodes.get(id)!.hash, width: plan.nodes.get(id)!.frame.width, height: plan.nodes.get(id)!.frame.height, fused: true });
            this.fusion.fusedPasses++;
            done = true;
          } catch (e) {
            if (e instanceof CancelledError) return true;
            const mod = (() => {
              try {
                return this.fusion.moduleFor(specs).mod;
              } catch {
                return null;
              }
            })();
            if (mod) this.fusion.reportBroken(sig, e, mod, seg.ids.map((i) => ({ id: i, name: plan.nodes.get(i)!.node.name })));
            else {
              this.fusion.broken.add(sig);
              this.fusion.fallbacks++;
              consoleBus.warn(`Fused segment could not be generated (${(e as Error).message}); evaluating unfused.`, { source: 'fusion' });
            }
          }
        }
      }
      if (done) {
        releaseAfter(ext);
        return false;
      }
      // Fallback: ordinary node-by-node evaluation of every member (executed + skipped identity nodes) in topological order.
      const members = plan.order.filter((id) => fplan.byNode.get(id) === seg);
      for (const id of members) {
        if (await execNode(id, false)) return true;
        for (const src of new Set(plan.nodes.get(id)!.inputs.filter((i) => i.link).map((i) => i.link!.from.node))) if (members.includes(src)) releaseHeld(src);
      }
      releaseAfter(ext);
      return false;
    };

    for (const id of plan.order) {
      if (!need.has(id)) continue;
      if (token.cancelled) {
        cancelled = true;
        break;
      }
      const seg = action.get(id) === 'run' ? fplan.byNode.get(id) : undefined;
      if (seg) {
        if (id !== seg.last) continue; // rendered by the fused pass of the last node
        if (await execSegment(seg)) {
          cancelled = true;
          break;
        }
        continue;
      }
      if (await execNode(id, true)) {
        cancelled = true;
        break;
      }
    }

    /* ---- submit (single batch) ---- */
    let collect: (() => Promise<Map<string, number>>) | null = null;
    if (!cancelled && !isolate && cbs.length) {
      const enc = dev.createCommandEncoder({ label: 'profiler resolve' });
      collect = this.profiler.finish(enc);
      if (collect) cbs.push(enc.finish());
      dev.pushErrorScope('validation');
      this.runner.submit(cbs);
      const err = await dev.popErrorScope(); // no awaits between push and pop-call: scopes stay LIFO-consistent
      if (err) {
        consoleBus.error(`Batched GPU submit failed validation (${err.message}). Re-running in isolated mode to find the node.`, { source: 'eval' });
        dropPending();
        cleanupAll();
        this.cache.unpinAll();
        return this.evaluate(graph, targets, { ...opts, isolate: true });
      }
      for (const c of pendingCache) this.cache.set(c.key, c.hash, c.value);
      dropPending();
    } else if (cancelled || cbs.length === 0) {
      this.runner.arena.endBatch();
    }
    if (cancelled) {
      dropPending();
      cleanupAll();
      this.cache.unpinAll();
      stats.cpuMs = performance.now() - startT;
      return { values: new Map(), errors: new Map(), stats, cancelled: true, release: () => undefined };
    }
    this.cache.unpinAll();
    texSnaps.flush(this.gpu, this.mm); // readbacks requested by mesh nodes (their producers were submitted above)

    /* ---- result ---- */
    const values = new Map<string, PinValue>();
    const errors = new Map<string, string>();
    for (const t of targets) {
      const pn = plan.nodes.get(t.nodeId);
      if (!pn) continue;
      const pin = t.pinId ?? pn.expanded?.outputs[0]?.id;
      const v = pin ? held.get(t.nodeId)?.get(pin) : undefined;
      if (v) values.set(targetKey(t), v);
      const e = failed.get(t.nodeId);
      if (e) errors.set(t.nodeId, e);
    }
    for (const [id, e] of failed) errors.set(id, e);
    for (const id of [...held.keys()]) if (!isTarget.has(id)) releaseHeld(id);
    this.cache.enforce();

    stats.cpuMs = performance.now() - startT;
    if (collect) {
      void collect().then((map) => {
        let total = 0;
        for (const [id, ms] of map) {
          const s = stats.nodes.get(id);
          if (s) s.gpuMs = ms;
          total += ms;
        }
        stats.gpuMs = total;
        this.onTiming.emit(stats);
      });
    }
    let released = false;
    return {
      values,
      errors,
      stats,
      cancelled: false,
      release: () => {
        if (released) return;
        released = true;
        for (const id of [...held.keys()]) releaseHeld(id);
      },
    };
  }

  /** Record one node (with retry while its pipelines compile). */
  private async runNode(
    pn: PlanNode,
    held: Map<string, Map<string, PinValue>>,
    token: CancelToken,
    fused?: FusedExec,
  ): Promise<{ outputs: Record<string, PinValue>; cb?: GPUCommandBuffer }> {
    for (let attempt = 0; ; attempt++) {
      const a = new NodeAttempt(this, pn, held);
      try {
        return fused ? a.executeFused(fused) : a.execute();
      } catch (e) {
        a.abort();
        // Every retry resolves ONE pending pipeline (a node may need many: Islands Generate uses 8+ compute / render
        // pipelines, each discovered one attempt at a time), so the bound must be generous. It only guards against bugs.
        if (e instanceof PipelinePending && attempt < 64) {
          await e.promise;
          if (token.cancelled) throw new CancelledError();
          continue;
        }
        throw e;
      }
    }
  }

  /** Device lost: every cached GPU value is gone. */
  onDeviceRestored(): void {
    this.cache.forgetAll();
    this.lastLogged.clear();
  }
}

/** One recording attempt of one node. Owns the encoder, the allocations and the EvalContext. */
class NodeAttempt implements EvalContext {
  readonly gpu: GpuContext;
  readonly node: { id: string; name: string; type: string };
  readonly params: Params;
  readonly frame;
  readonly encoder: GPUCommandEncoder;
  inputs: Record<string, PinValue | undefined> = {};
  private allocs: GpuTexture[] = [];
  private bufAllocs: PooledBuffer[] = [];
  /** Early-freed temporaries waiting for reuse inside this node (never touch the shared pool mid-node: it may trim/destroy). */
  private freed: GpuTexture[] = [];
  private owner;
  private profMark: number;

  constructor(
    private ev: Evaluator,
    private pn: PlanNode,
    private held: Map<string, Map<string, PinValue>>,
  ) {
    this.gpu = ev.gpu;
    this.node = { id: pn.id, name: pn.node.name, type: pn.node.type };
    this.params = new Params(pn.expanded!.params, pn.params);
    this.frame = pn.frame;
    this.owner = { nodeId: pn.id, nodeName: pn.node.name };
    this.profMark = ev.profiler.mark();
    this.encoder = ev.gpu.device.createCommandEncoder({ label: `${pn.node.name} (${pn.id})` });
  }

  /* ----- EvalContext ----- */
  wants(pinId: string): boolean {
    return !this.pn.wanted || this.pn.wanted.has(pinId);
  }
  texInput(pinId: string): TextureValue | undefined {
    const v = this.inputs[pinId];
    return v && v.kind === 'texture' ? v : undefined;
  }
  cpuTexture(pinId: string): CpuTexture | null {
    const v = this.texInput(pinId);
    const key = this.pn.srcKeys?.[pinId];
    if (!v || !key) return null;
    const got = texSnaps.get(key);
    if (got) return got;
    texSnaps.request(key, v.tex);
    return null;
  }
  cpuTexturePending(pinId: string): boolean {
    const key = this.pn.srcKeys?.[pinId];
    return !!this.texInput(pinId) && !!key && !texSnaps.has(key);
  }
  mod(paramId: string): ModulationInput {
    const tex = this.texInput(`${paramId}_mod`);
    return { tex, k: tex ? this.params.num(`${paramId}_mod_k`) : 0 };
  }
  tex(pin: TexturePin, width?: number, height?: number): GpuTexture {
    const w = width ?? this.frame.width;
    const h = height ?? this.frame.height;
    const format = formatForPin(pin, this.frame.hq);
    const j = this.freed.findIndex((t) => t.width === w && t.height === h && t.format === format);
    if (j >= 0) {
      const [t] = this.freed.splice(j, 1);
      this.allocs.push(t);
      return t;
    }
    const t = this.ev.mm.textures.acquire({ width: w, height: h, format, label: `${this.node.name}:${pin}` });
    this.allocs.push(t);
    return t;
  }
  free(tex: GpuTexture): void {
    const i = this.allocs.indexOf(tex);
    if (i < 0) return; // not a node temporary (or already freed): ignore
    this.allocs.splice(i, 1);
    this.freed.push(tex);
  }
  lazyInput(pinId: string): { nodeId: string; pin: string; sig: string; graph: Graph } | null {
    return this.pn.lazy?.[pinId] ?? null;
  }
  uploadBuffer(data: ArrayBufferView): GPUBuffer {
    const size = Math.max(16, Math.ceil(data.byteLength / 4) * 4);
    const b = this.ev.mm.buffers.acquire({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: `${this.node.name}:upload` });
    this.ev.gpu.device.queue.writeBuffer(b.buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
    this.ev.runner.arena.holdUntilBatchDone(() => b.release());
    return b.buffer;
  }
  buffer(size: number): PooledBuffer {
    const b = this.ev.mm.buffers.acquire({ size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, label: `${this.node.name}:buffer` });
    this.bufAllocs.push(b);
    return b;
  }
  result(tex: GpuTexture, pin: TexturePin): TextureValue {
    return textureValue(tex, pin);
  }
  pass(desc: NodePassDesc): void {
    const t = desc.target;
    const f = this.frame;
    const same = t.width === f.width && t.height === f.height;
    const frame: FrameParams = {
      width: t.width,
      height: t.height,
      regionOrigin: same ? [f.originX, f.originY] : [0, 0],
      fullRes: same ? [f.fullWidth, f.fullHeight] : [t.width, t.height],
      time: f.time,
      loopPhase: f.loopPhase,
      tile: [f.tileX, f.tileY],
      seed: f.seed,
      ss: desc.ss ?? f.supersample,
      filter: f.filter,
      hq: f.hq,
      ...desc.frame,
    };
    this.ev.runner.fullscreen(this.encoder, { view: t.view, format: t.format, width: t.width, height: t.height }, frame, desc, this.owner, this.ev.profiler.writes(this.node.id));
  }
  compute(desc: ComputePassDesc): void {
    this.ev.runner.compute(this.encoder, desc, this.owner, this.ev.profiler.writes(this.node.id) as GPUComputePassTimestampWrites | undefined);
  }
  uniformBinding = (layout: UniformLayout, values: Record<string, UniformValue>): ComputeBinding => this.ev.runner.uniform(layout, values);

  job(task: 'mesh.noise', params: Parameters<NonNullable<EvalContext['job']>>[1], input: Parameters<NonNullable<EvalContext['job']>>[2]): ReturnType<NonNullable<EvalContext['job']>> {
    if (!this.pn.jobKey) return undefined;
    return this.ev.jobs.request(this.pn.id, this.pn.jobKey, task, params, input);
  }

  /* ----- engine side ----- */
  private convert(v: PinValue, to: string): PinValue {
    if (v.kind !== 'texture' || v.pin === to) return v;
    if (v.pin === 'gray' && to === 'color') {
      const dst = this.tex('color', v.width, v.height);
      this.pass({ target: dst, shader: CONVERT_GRAY_COLOR, textures: [v.tex], ss: 1 });
      return textureValue(dst, 'color');
    }
    throw new Error(`Cannot convert ${v.pin} to ${to}`);
  }

  private canSkipIdentity(pn: PlanNode, ex: NonNullable<PlanNode['expanded']>, def: NodeDefinition): boolean {
    if (!def.identity) return false;
    try {
      if (!def.identity(this.params.values)) return false;
    } catch {
      return false;
    }
    for (const p of ex.inputs) if ((p.role === 'modulation' || p.role === 'background') && this.inputs[p.id]) return false;
    for (const o of ex.outputs) {
      const src = ex.inputs.find((p) => p.type === o.type && p.role !== 'modulation' && p.role !== 'background' && this.inputs[p.id]);
      const v = src ? this.inputs[src.id] : undefined;
      if (!v || v.kind !== 'texture' || v.width !== pn.frame.width || v.height !== pn.frame.height) return false;
    }
    return true;
  }

  execute(): { outputs: Record<string, PinValue>; cb: GPUCommandBuffer } {
    const { pn } = this;
    const ex = pn.expanded!;
    const def = ex.def;
    const bypass = !!pn.node.bypass || !!def.passthrough;

    for (const i of pn.inputs) {
      if (!i.link) {
        if (!i.pin.optional && !bypass) throw new Error(`Required input "${i.pin.name}" is not connected`);
        continue;
      }
      if (i.pin.lazy) continue; // pulled by the node itself
      const v = this.held.get(i.link.from.node)?.get(i.link.from.pin);
      if (!v) throw new Error(`Upstream output "${i.link.from.pin}" is not available`);
      this.inputs[i.pin.id] = this.convert(v, i.pin.type);
    }

    // identity short-cut (see NodeDefinition.identity): forward the input, record no pass.
    const skip = !bypass && this.canSkipIdentity(pn, ex, def);
    let outputs: Record<string, PinValue>;
    if (bypass || skip) {
      if (skip) this.ev.identitySkips++;
      outputs = {};
      for (const o of ex.outputs) {
        const src = ex.inputs.find((p) => p.type === o.type && p.role !== 'modulation' && p.role !== 'background' && this.inputs[p.id]);
        if (!src) throw new Error(`Cannot bypass: no connected input of type ${o.type}`);
        outputs[o.id] = this.inputs[src.id]!;
      }
    } else {
      outputs = def.evaluate(this);
      for (const o of ex.outputs) {
        const v = outputs[o.id];
        if (!v && def.lazyOutputs && !this.wants(o.id)) continue;
        if (!v) throw new Error(`Node did not produce output "${o.id}"`);
        if (isTexturePin(o.type) ? v.kind !== 'texture' || v.pin !== o.type : v.kind !== 'data' || v.pin !== o.type) {
          throw new Error(`Output "${o.id}" has wrong type (expected ${o.type})`);
        }
      }
      const bg = this.inputs.background;
      if (ex.hasBlending && ex.primaryTexture && bg && bg.kind === 'texture') {
        const prim = ex.primaryTexture;
        const fg = outputs[prim.pinId] as TextureValue;
        const dst = this.tex(prim.type, fg.width, fg.height);
        this.pass({
          target: dst,
          shader: BACKGROUND_BLEND,
          defines: { GRAY: prim.type === 'gray' ? 1 : 0 },
          uniforms: {
            layout: BACKGROUND_BLEND_LAYOUT,
            values: { blend_mode: this.params.enumIndex('blend_mode'), cross_mix: this.params.num('blend_cross'), smoothness: this.params.num('blend_smooth') },
          },
          textures: [fg.tex, bg.tex],
          ss: 1,
        });
        outputs = { ...outputs, [prim.pinId]: textureValue(dst, prim.type) };
      }
    }
    return this.finish(outputs);
  }

  /** Retain outputs, hand temporaries back to the pool, close the encoder. */
  private finish(outputs: Record<string, PinValue>): { outputs: Record<string, PinValue>; cb: GPUCommandBuffer } {
    for (const v of Object.values(outputs)) retainValue(v);
    for (const t of this.allocs) t.release();
    this.allocs = [];
    for (const t of this.freed) t.release();
    this.freed = [];
    for (const b of this.bufAllocs) b.release();
    this.bufAllocs = [];
    return { outputs, cb: this.encoder.finish() };
  }

  /** record ONE pass for a whole fused segment (this attempt belongs to its LAST node). */
  executeFused(f: FusedExec): { outputs: Record<string, PinValue>; cb: GPUCommandBuffer } {
    const { seg, plan, entry } = f;
    const pns = seg.ids.map((id) => plan.nodes.get(id)!);
    const linkOf = (pn: PlanNode, pinId: string) => pn.inputs.find((i) => i.pin.id === pinId)?.link;
    const external = (from: { node: string; pin: string }, pinType: string): TextureValue => {
      const v = this.held.get(from.node)?.get(from.pin);
      if (!v) throw new Error(`Upstream output "${from.pin}" is not available`);
      const c = this.convert(v, pinType);
      if (c.kind !== 'texture') throw new Error('fused input is not a texture');
      return c;
    };
    const textures: (TextureValue | null)[] = [];
    for (const slot of entry.mod.slots) {
      if (slot.kind === 'dummy') textures.push(null);
      else if (slot.kind === 'seed') {
        const first = pns[0];
        const decl = first.expanded!.def.fusable!;
        const mainPin = first.expanded!.inputs.find((p) => p.id === (decl.main ?? 'input'))!;
        textures.push(external(seg.seed!, mainPin.type));
      } else {
        const pn = pns[slot.node!];
        const pinId = pn.expanded!.def.fusable!.extras![slot.extra!];
        const link = linkOf(pn, pinId)!;
        textures.push(external({ node: link.from.node, pin: link.from.pin }, pn.expanded!.inputs.find((p) => p.id === pinId)!.type));
      }
    }
    const values: Record<string, number | boolean | ArrayLike<number>> = {};
    pns.forEach((pn, i) => {
      const p = new Params(pn.expanded!.params, pn.params);
      const vals = pn.expanded!.def.fusable!.uniformValues(p, fuseIO(pn, p));
      for (const [k, v] of Object.entries(vals)) values[`n${i}_${k}`] = v;
    });
    const lastEx = this.pn.expanded!;
    const outDef = lastEx.outputs[0];
    const out = this.tex(outDef.type as TexturePin);
    this.pass({ label: `fused ×${pns.length}: ${pns.map((p) => p.node.name).join(' → ')}`.slice(0, 120), target: out, shader: entry.shader, uniforms: { layout: entry.mod.layout, values }, textures, ss: 1 });
    return this.finish({ [outDef.id]: textureValue(out, outDef.type as TexturePin) });
  }

  abort(): void {
    this.ev.profiler.abort(this.profMark);
    for (const t of this.allocs) t.release();
    this.allocs = [];
    for (const t of this.freed) t.release();
    this.freed = [];
    for (const b of this.bufAllocs) b.release();
    this.bufAllocs = [];
  }
}

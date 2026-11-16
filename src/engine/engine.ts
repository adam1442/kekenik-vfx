import { texSnaps } from './mesh/texsnap';
import { assets } from './io/assets';
import { flattenGraph } from './subgraph/flatten';
import { SubgraphLibrary } from './subgraph/library';
import { makeAnimator } from './anim/animator';
import { autoCacheBytes } from './anim/frame-cache';
import { Playback } from './anim/playback';
import { importHooks } from './anim/flipbook-import';
import { FlipbookBaker } from './anim/flipbook-bake';
import { SimulationService } from './sim/service';
import { Emitter } from '../shared/emitter';
import { UniformArena } from './gpu/arena';
import { GpuContext } from './gpu/device';
import { PassRunner } from './gpu/passes';
import { GpuProfiler } from './gpu/profiler';
import { Evaluator } from './graph/evaluator';
import { discoverNodes } from './graph/discover';
import { Graph, type GraphSettings } from './graph/graph';
import { nodeRegistry, type NodeRegistry } from './graph/registry';
import { EvalScheduler } from './graph/scheduler';
import { MemoryManager } from './resources/memory';
import { bindMeshAccounting } from './mesh/accounting';
import { PipelineCache } from './shaders/pipelines';
import { AdaptiveResolution } from './perf/adaptive';
import { PerfStats } from './perf/stats';

/**
 * Engine = every singleton the app needs, wired together, with device-lost recovery.
 * One Engine per app (the selftest creates extra, isolated ones with their own budgets).
 */
export class Engine {
  readonly mm: MemoryManager;
  readonly pipelines: PipelineCache;
  readonly arena: UniformArena;
  readonly runner: PassRunner;
  readonly profiler: GpuProfiler;
  readonly evaluator: Evaluator;
  readonly scheduler: EvalScheduler;
  /** playhead / transport / frame pacing. */
  readonly playback: Playback;
  /** Sheet Encode baking service. */
  readonly flipbooks: FlipbookBaker;
  /** stateful simulation framework (caches, checkpoints, bake, export hook). */
  readonly sims: SimulationService;
  /** shared subgraph definitions of the current project (mirrored into the registry; flattened before evaluation). */
  readonly subgraphs: SubgraphLibrary;
  /** profiling data collector (Profiler panel, HUD) and the adaptive drag-resolution controller. */
  readonly perf: PerfStats;
  readonly adaptive: AdaptiveResolution;
  /** Fires after the GPU device was recreated and all engine GPU state was rebuilt. */
  readonly onRestored = new Emitter<void>();

  constructor(
    readonly gpu: GpuContext,
    readonly registry: NodeRegistry = nodeRegistry,
    budgetBytes?: number,
  ) {
    this.mm = new MemoryManager(gpu, budgetBytes);
    bindMeshAccounting(this.mm); // mesh payloads are accounted in this budget
    this.pipelines = new PipelineCache(gpu);
    this.arena = new UniformArena(gpu, this.mm);
    this.runner = new PassRunner(gpu, this.pipelines, this.arena);
    this.profiler = new GpuProfiler(gpu);
    this.evaluator = new Evaluator(gpu, this.mm, registry, this.runner, this.profiler);
    this.scheduler = new EvalScheduler(this.evaluator);
    // a finished worker job re-evaluates the graph once (coalesced by the scheduler).
    this.evaluator.jobs.onReady.on(() => this.scheduler.invalidate());
    this.adaptive = new AdaptiveResolution();
    this.scheduler.adaptive = this.adaptive;
    this.perf = new PerfStats(this);
    this.perf.attach();
    // GPU timestamps are the better signal for the adaptive controller (CPU samples are ignored once one arrives)
    this.evaluator.onTiming.on((s) => {
      if (!s.isolated && s.gpuMs !== undefined && s.nodesEvaluated > 0 && this.scheduler.isInteracting) this.adaptive.observe(s.gpuMs, s.scale, 'gpu');
    });
    // animation hook, playback, frame cache sized from the memory budget (never unbounded) and evictable under pressure.
    this.evaluator.animator = makeAnimator(registry);
    this.subgraphs = new SubgraphLibrary(registry);
    this.evaluator.preprocess = (g) => flattenGraph(g, this.subgraphs);
    assets.onReady.on(() => this.scheduler.invalidate()); // an imported image / model finished decoding -> re-evaluate
    this.playback = new Playback(this.scheduler);
    importHooks.onReady = () => this.scheduler.invalidate();
    this.flipbooks = new FlipbookBaker({ gpu, mm: this.mm, runner: this.runner, evaluator: this.evaluator, scheduler: this.scheduler });
    this.sims = new SimulationService({ gpu, mm: this.mm, runner: this.runner, evaluator: this.evaluator, scheduler: this.scheduler });
    this.scheduler.cacheSalt = () => String(this.sims.epoch);
    this.flipbooks.sims = this.sims;
    this.scheduler.frameCache.maxBytesFn = () => autoCacheBytes(this.mm.budgetBytes, this.mm.usedBytes, 0.2);
    this.mm.registerEvictor((need) => void this.scheduler.frameCache.evictFor(need, this.scheduler.timeFrame));
    gpu.onRestored.on(() => this.handleRestored());
    texSnaps.onReady = () => this.scheduler.invalidate(); // a CPU texture snapshot arrived -> re-evaluate
  }

  static async create(opts: { budgetBytes?: number; registry?: NodeRegistry; gpu?: GpuContext } = {}): Promise<Engine> {
    const gpu = opts.gpu ?? (await GpuContext.create());
    const registry = opts.registry ?? nodeRegistry;
    if (registry === nodeRegistry) discoverNodes(registry);
    return new Engine(gpu, registry, opts.budgetBytes);
  }

  newGraph(settings?: Partial<GraphSettings>): Graph {
    return new Graph(this.registry, settings);
  }

  /** Device lost -> drop every GPU object we own, then let schedulers re-evaluate. CPU state (graphs) is untouched. */
  private handleRestored(): void {
    this.scheduler.dropFrameCache();
    this.sims.clear();
    this.flipbooks.clear();
    this.mm.reset();
    texSnaps.clear();
    this.pipelines.clear();
    this.arena.reset();
    this.runner.reset();
    this.profiler.reset();
    this.adaptive.reset();
    this.perf.clear();
    this.evaluator.onDeviceRestored();
    this.scheduler.invalidate();
    this.onRestored.emit();
  }
}

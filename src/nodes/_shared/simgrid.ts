/**
 * Grid simulation toolkit: everything the "one state texture" simulations (Reaction Diffusion, Wave, Diffusion / Heat,
 * Burn Front, Flow Advection, Vector Particles) share, on top of the 9A SimulationNode framework (`engine/sim/service.ts`):
 *  - `simCommonParams`  Simulation / Loop / Cache / Output parameter groups,
 *  - `resolveGridSetup` pure parameter -> setup (resolution limit by device + memory budget, loop config),
 *  - `GridBackend`      SimulationBackend: ONE persistent state texture (+ a ping-pong partner), fragment passes only,
 *                       cross-fade blend, snapshot copies, pipeline pre-warm, default WebGPU limits,
 *  - `requestSim`       the `evaluate()` boilerplate (lazy pins, keys, partial invalidation signatures, request),
 *  - `renderOutputs`    one shade pass per linked / targeted output pin.
 * A simulation only supplies WGSL (PASS defines), a uniform layout and `init` / `step` recorders.
 */
import { defineNode, type EvalContext, type GizmoDecl } from '../../engine/graph/node';
import { registerSimPresets, type SimPreset } from '../../engine/sim/presets';
import type { Graph } from '../../engine/graph/graph';
import type { PinDef } from '../../engine/graph/pins';
import type { GpuContext } from '../../engine/gpu/device';
import type { PassRunner } from '../../engine/gpu/passes';
import { P, type ParamSchema, type ParamValues } from '../../engine/params/schema';
import type { GpuTexture, MemoryManager } from '../../engine/resources/memory';
import type { TextureValue } from '../../engine/resources/values';
import { defineShader } from '../../engine/shaders/library';
import { PipelinePending, type ShaderOwner } from '../../engine/shaders/pipelines';
import { makeLayout, zeroUniforms, type UField, type UniformLayout, type UniformValue } from '../../engine/shaders/uniforms';
import { forcingFrame, frameSignatures, limitSimResolution, type LoopMode } from '../../engine/sim/core';
import { simFor, type SimFrameInputs, type SimSpec, type SimView, type SimulationBackend } from '../../engine/sim/service';
import type { TexturePin } from '../../engine/types';
import { hashString, stableStringify } from '../../shared/util';

/* ----------------------------------------------------------------------------------------------- parameters */
export const simCommonParams = (o: { boundary?: boolean; periodicDefault?: boolean; res?: number; substeps?: number; warmup?: number } = {}): ParamSchema => [
  P.int('sim_res', o.res ?? 256, { group: 'Simulation', label: 'Sim resolution', min: 16, max: 2048, softMin: 64, softMax: 1024, unit: 'cells', tooltip: 'Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory).' }),
  P.enum('precision', 'half', [{ value: 'half', label: 'Standard (16-bit)' }, { value: 'full', label: 'High (32-bit)' }], { group: 'Simulation', label: 'State precision' }),
  P.float('speed', 1, { group: 'Simulation', label: 'Speed', min: 0.05, max: 8, softMax: 3, step: 0.05, tooltip: 'Simulated seconds per real second.' }),
  P.int('substeps', o.substeps ?? 2, { group: 'Simulation', label: 'Sub-steps', min: 1, max: 32, softMax: 8, tooltip: 'Fixed sub-steps per frame (more = more accurate and slower).' }),
  ...(o.boundary ? [P.bool('periodic', o.periodicDefault ?? true, { group: 'Simulation', label: 'Periodic / tileable', tooltip: 'Wraps around the image edges: the result tiles seamlessly.' })] : []),
  P.seed('seed', 1, { group: 'Simulation', label: 'Seed' }),
  P.int('warmup', o.warmup ?? 0, { group: 'Simulation', label: 'Warm-up frames', min: 0, max: 600, softMax: 240, tooltip: 'Frames simulated before frame 0 (pre-roll, not shown).' }),
  P.enum('loop_mode', 'none', [{ value: 'none', label: 'None' }, { value: 'crossfade', label: 'Crossfade' }, { value: 'periodic', label: 'Periodic forcing' }], { group: 'Loop', label: 'Loop mode', tooltip: 'Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L.' }),
  P.int('loop_frames', 0, { group: 'Loop', label: 'Loop length (frames)', min: 0, max: 4096, softMax: 240, visibleIf: (v) => v.loop_mode !== 'none', tooltip: '0 = the graph loop length.' }),
  P.int('blend_frames', 16, { group: 'Loop', label: 'Blend length (frames)', min: 1, max: 1024, softMax: 64, visibleIf: (v) => v.loop_mode === 'crossfade' }),
  P.int('cache_mb', 64, { group: 'Cache', label: 'Cache budget (MB)', min: 1, max: 4096, softMax: 512, tooltip: 'Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget).' }),
  P.bool('paused', false, { group: 'Cache', label: 'Pause simulation', tooltip: 'Stop simulating new frames (cached frames stay available).' }),
  P.enum('out_filter', 'cubic', [{ value: 'cubic', label: 'Bicubic' }, { value: 'linear', label: 'Bilinear' }, { value: 'point', label: 'Point' }], { group: 'Output', label: 'Resample filter', tooltip: 'Quality filter used to resample the simulation grid to the graph resolution.' }),
];

export const isGridSimParam = (id: string): boolean => !(id.startsWith('out_') || id === 'cache_mb' || id === 'paused' || id.startsWith('tex_'));

export interface GridSetup {
  w: number;
  h: number;
  limited: boolean;
  fps: number;
  speed: number;
  warmup: number;
  loopMode: LoopMode;
  loopLength: number;
  blend: number;
  cacheBytes: number;
  substeps: number;
  precision: 'half' | 'full';
  periodic: boolean;
}
const num = (p: ParamValues, id: string, d: number): number => (typeof p[id] === 'number' && Number.isFinite(p[id] as number) ? (p[id] as number) : d);

/** Pure: parameters + graph settings + device limits -> simulation setup. */
export function resolveGridSetup(p: ParamValues, g: { fps: number; loopLength: number; width: number; height: number }, dev: { maxDim: number; budgetBytes: number }, o: { bytesPerCellFactor?: number } = {}): GridSetup {
  const precision = p.precision === 'full' ? 'full' : 'half';
  const bytesPerCell = (precision === 'full' ? 16 : 8) * (o.bytesPerCellFactor ?? 4);
  const dims = limitSimResolution(num(p, 'sim_res', 256), g.width / Math.max(1, g.height), { maxDim: dev.maxDim, budgetBytes: dev.budgetBytes, bytesPerCell });
  const loopMode = (['none', 'crossfade', 'periodic'].includes(String(p.loop_mode)) ? p.loop_mode : 'none') as LoopMode;
  const loopLength = Math.round(num(p, 'loop_frames', 0)) || g.loopLength;
  return {
    w: dims.w, h: dims.h, limited: dims.limited, fps: g.fps, speed: Math.max(0.01, num(p, 'speed', 1)), warmup: Math.max(0, Math.round(num(p, 'warmup', 0))),
    loopMode, loopLength: Math.max(1, loopLength), blend: Math.max(1, Math.round(num(p, 'blend_frames', 16))), cacheBytes: Math.max(1, Math.round(num(p, 'cache_mb', 64))) * 1048576,
    substeps: Math.max(1, Math.round(num(p, 'substeps', 2))), precision, periodic: p.boundary !== undefined ? p.boundary === 'periodic' : p.periodic !== false,
  };
}

/** Seconds of one fixed sub-step (same rule as the 9A `stepDt`: dt = (1 / fps) * speed / substeps). */
export const subDt = (s: Pick<GridSetup, 'fps' | 'speed' | 'substeps'>): number => (1 / Math.max(1, s.fps)) * s.speed / Math.max(1, s.substeps);

/* ----------------------------------------------------------------------------------------------- backend */
const BLEND_LAYOUT = makeLayout([{ name: 'w', type: 'f32' }]);
const BLEND_SHADER = defineShader(
  'sim_grid_blend.wgsl',
  `// loop cross-fade of two state snapshots (textureLoad only: works for every float format)
@fragment fn fs_main(in: VsOut) -> @location(0) vec4f {
  let c = vec2i(in.pos.xy);
  return mix(textureLoad(t0, c, 0), textureLoad(t1, c, 0), P.w);
}
`,
);

export interface GridRun {
  readonly enc: GPUCommandEncoder;
  readonly w: number;
  readonly h: number;
  /** The current state texture. */
  readonly cur: GpuTexture;
  /** Render pass `pass` (the `PASS` define) into `target`. */
  run(pass: number, target: GpuTexture, textures: (GpuTexture | null | undefined)[], u: Record<string, UniformValue>): void;
  /** `textures = [cur, ...extra]` -> the partner texture, then the two swap (the state advanced). */
  advance(pass: number, extra: (GpuTexture | null | undefined)[], u: Record<string, UniformValue>): void;
  /** Scratch texture of the state format (owned by the backend, valid until the next `scratch(n)` with the same n). */
  scratch(n: number): GpuTexture;
}

export interface GridHooks {
  shader: ReturnType<typeof defineShader>;
  layout: UniformLayout;
  /** Number of bound textures of every pass (unused slots are null). */
  texCount: number;
  /** All `PASS` ids used (pre-compiled before the first frame). */
  passes: number[];
  /** Number of scratch textures. */
  scratch?: number;
  init(g: GridRun, inputs: SimFrameInputs): void;
  step(g: GridRun, k: number, forcing: number, inputs: SimFrameInputs): void;
  hud?(): Record<string, number>;
  /** Called by `copyState`-based restores / after reset (CPU state of the hook that is a pure function of the state may be refreshed here). */
  settle?(be: GridBackend): Promise<void>;
}

export class GridBackend implements SimulationBackend {
  readonly width: number;
  readonly height: number;
  readonly stateBytes: number;
  readonly format: GPUTextureFormat;
  private A!: GpuTexture;
  private B!: GpuTexture;
  private extra: GpuTexture[] = [];
  private owned: GpuTexture[] = [];
  passCount = 0;
  constructor(
    readonly deps: { gpu: GpuContext; mm: MemoryManager; runner: PassRunner },
    readonly setup: GridSetup,
    private owner: ShaderOwner,
    private hooks: GridHooks,
  ) {
    this.width = setup.w;
    this.height = setup.h;
    this.format = setup.precision === 'full' ? 'rgba32float' : 'rgba16float';
    this.stateBytes = setup.w * setup.h * (setup.precision === 'full' ? 16 : 8);
    try {
      this.A = this.tex('A');
      this.B = this.tex('B');
      for (let i = 0; i < (hooks.scratch ?? 0); i++) this.extra.push(this.tex(`S${i}`));
    } catch (e) {
      this.dispose();
      throw e;
    }
  }
  private tex(label: string): GpuTexture {
    const t = this.deps.mm.textures.acquire({ width: this.width, height: this.height, format: this.format, label: `sim ${this.owner.nodeName} ${label}` });
    this.owned.push(t);
    return t;
  }
  state(): GpuTexture[] {
    return [this.A];
  }
  private pass(enc: GPUCommandEncoder, pass: number, target: GpuTexture, textures: (GpuTexture | null | undefined)[], u: Record<string, UniformValue>): void {
    const tl: (GpuTexture | null)[] = [];
    for (let i = 0; i < this.hooks.texCount; i++) tl.push(textures[i] ?? null);
    this.passCount++;
    this.deps.runner.fullscreen(
      enc,
      { view: target.view, format: target.format, width: target.width, height: target.height },
      { width: target.width, height: target.height, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: 0, hq: false },
      { label: `${this.owner.nodeName}:${pass}`, shader: this.hooks.shader, defines: { PASS: pass }, mode: 'raw', uniforms: { layout: this.hooks.layout, values: u }, textures: tl },
      this.owner,
    );
  }
  private runner(enc: GPUCommandEncoder): GridRun {
    const current = (): GpuTexture => this.A;
    return {
      enc,
      w: this.width,
      h: this.height,
      get cur() {
        return current();
      },
      run: (pass, target, textures, u) => this.pass(enc, pass, target, textures, u),
      advance: (pass, extra, u) => {
        this.pass(enc, pass, this.B, [this.A, ...extra], u);
        [this.A, this.B] = [this.B, this.A];
      },
      scratch: (n) => this.extra[n],
    };
  }
  async prewarm(): Promise<void> {
    const scratch = this.tex('warm');
    // every field of the layout must be present (packUniforms throws on a missing one): all-zero values compile the same pipelines
    const zero = zeroUniforms(this.hooks.layout);
    for (let round = 0; round < 40; round++) {
      const pending: Promise<void>[] = [];
      const enc = this.deps.gpu.device.createCommandEncoder({ label: 'sim grid prewarm' });
      for (const id of this.hooks.passes) {
        try {
          this.pass(enc, id, scratch, [], zero);
        } catch (e) {
          if (e instanceof PipelinePending) pending.push(e.promise);
          else throw e;
        }
      }
      try {
        this.deps.runner.fullscreen(
          enc,
          { view: scratch.view, format: scratch.format, width: scratch.width, height: scratch.height },
          { width: scratch.width, height: scratch.height, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: 0, hq: false },
          { label: 'blend warm', shader: BLEND_SHADER, mode: 'raw', uniforms: { layout: BLEND_LAYOUT, values: { w: 0 } }, textures: [null, null] },
          this.owner,
        );
      } catch (e) {
        if (e instanceof PipelinePending) pending.push(e.promise);
        else throw e;
      }
      if (!pending.length) break;
      await Promise.all(pending);
    }
    this.deps.runner.arena.endBatch();
  }
  reset(enc: GPUCommandEncoder, inputs: SimFrameInputs): void {
    this.hooks.init(this.runner(enc), inputs);
  }
  step(enc: GPUCommandEncoder, k: number, forcing: number, inputs: SimFrameInputs): void {
    this.hooks.step(this.runner(enc), k, forcing, inputs);
  }
  async settle(): Promise<void> {
    await this.hooks.settle?.(this);
  }
  copyState(enc: GPUCommandEncoder, from: GpuTexture[], to: GpuTexture[]): void {
    enc.copyTextureToTexture({ texture: from[0].texture }, { texture: to[0].texture }, { width: this.width, height: this.height });
  }
  blend(enc: GPUCommandEncoder, a: GpuTexture[], b: GpuTexture[], w: number, out: GpuTexture[]): void {
    this.passCount++;
    this.deps.runner.fullscreen(
      enc,
      { view: out[0].view, format: out[0].format, width: out[0].width, height: out[0].height },
      { width: out[0].width, height: out[0].height, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: 0, hq: false },
      { label: 'sim grid blend', shader: BLEND_SHADER, mode: 'raw', uniforms: { layout: BLEND_LAYOUT, values: { w } }, textures: [a[0], b[0]] },
      this.owner,
    );
  }
  hud(): Record<string, number> {
    return { substeps: this.setup.substeps, residual: 0, maxSpeed: 0, passes: this.passCount, ...(this.hooks.hud?.() ?? {}) };
  }
  dispose(): void {
    for (const t of this.owned) t.release();
    this.owned = [];
    this.extra = [];
  }
}

/* ----------------------------------------------------------------------------------------------- evaluate() boilerplate */
export interface SimRequestCfg<S extends GridSetup> {
  lazyPins: PinDef[];
  setup(raw: ParamValues, g: { fps: number; loopLength: number; width: number; height: number }, dev: { maxDim: number; budgetBytes: number }): S;
  create(deps: { gpu: GpuContext; mm: MemoryManager; runner: PassRunner }, setup: S, owner: { nodeId: string; nodeName: string }, paramsAt: (frame: number) => ParamValues): SimulationBackend;
  /** Extra data that invalidates the simulation (CPU inputs such as spline tables). */
  extraKey?: string;
}

export function requestSim<S extends GridSetup>(ctx: EvalContext, cfg: SimRequestCfg<S>): { view: SimView; setup: S; fps: number } {
  const svc = simFor(ctx.gpu);
  if (!svc) throw new Error('The simulation service is not available in this context.');
  const p = ctx.params;
  const id = ctx.node.id;
  const lazy: SimSpec['lazy'] = {};
  const sigs: string[] = [];
  let graph: Graph | null = null;
  for (const pin of cfg.lazyPins) {
    const lz = ctx.lazyInput?.(pin.id);
    if (!lz) continue;
    lazy[pin.id] = { nodeId: lz.nodeId, pin: lz.pin };
    sigs.push(`${pin.id}=${lz.nodeId}.${lz.pin}:${lz.sig}`);
    graph = graph ?? lz.graph;
  }
  graph = graph ?? svc.currentGraph();
  const nodeData = graph?.nodes.get(id);
  const gs = graph?.settings ?? { fps: 30, loopLength: 60, width: ctx.frame.fullWidth, height: ctx.frame.fullHeight };
  const rawParams = p.values;
  const setup = cfg.setup(rawParams, { fps: gs.fps, loopLength: gs.loopLength, width: ctx.frame.fullWidth, height: ctx.frame.fullHeight }, { maxDim: ctx.gpu.caps.limits.maxTextureDimension2D ?? 8192, budgetBytes: svc.memoryBudget() });
  const simParams: ParamValues = {};
  const src = nodeData ? { ...nodeData.params } : { ...rawParams };
  for (const k of Object.keys(src)) if (isGridSimParam(k)) simParams[k] = src[k];
  const common = { sigs, fps: gs.fps, loop: setup.loopLength, w: setup.w, h: setup.h, g: ctx.frame.fullWidth / Math.max(1, ctx.frame.fullHeight), x: cfg.extraKey ?? '', t: ctx.frame.tileX ? 1 : 0, u: ctx.frame.tileY ? 1 : 0 };
  const key = String(hashString(stableStringify({ simParams, anim: nodeData?.anim ?? null, ...common })));
  const animIds = Object.keys(nodeData?.anim ?? {}).filter(isGridSimParam).sort();
  const staticParams: ParamValues = { ...simParams };
  for (const k of animIds) delete staticParams[k];
  const staticKey = animIds.length ? String(hashString(stableStringify({ staticParams, animIds, ...common }))) : key;
  const owner = { nodeId: id, nodeName: ctx.node.name };
  const g = graph;
  const spec: SimSpec = {
    nodeId: id,
    nodeName: ctx.node.name,
    graph: g as Graph,
    key,
    staticKey,
    signatures: animIds.length
      ? () => frameSignatures((f) => stableStringify(animIds.map((k) => svc.paramsAt(g, id, f, rawParams)[k])), setup.warmup, setup.loopLength, setup.blend, setup.loopMode)
      : undefined,
    cfg: { fps: gs.fps, speed: setup.speed, warmup: setup.warmup, loopMode: setup.loopMode, loopLength: setup.loopLength, blend: setup.blend, cacheBytes: setup.cacheBytes, inputScale: Math.min(1, Math.max(setup.w, setup.h) / Math.max(ctx.frame.fullWidth, ctx.frame.fullHeight)), maxFrames: 100000 },
    lazy,
    size: { w: setup.w, h: setup.h, note: setup.limited ? 'limited' : undefined },
    create: (deps) => cfg.create(deps, setup, owner, (frame) => svc.paramsAt(g, id, forcingFrame(frame, setup.loopLength, setup.loopMode), rawParams)),
  };
  const frame = Math.max(0, Math.round(ctx.frame.time * gs.fps));
  const view = svc.request(spec, frame, ctx.encoder);
  if (svc.isPaused(id) !== p.bool('paused')) svc.setPaused(id, p.bool('paused'));
  return { view, setup, fps: gs.fps };
}

/* ----------------------------------------------------------------------------------------------- outputs */
export interface SimOut {
  id: string;
  name: string;
  type: TexturePin;
  /** `#define OUT` of the output shader. */
  code: number;
  tooltip?: string;
  /** Vector outputs: vecScale (default 1; motion = 1 / fps). */
  vecScale?: 'fps' | number;
}
/** Output layout fields every simulation output shader has (extend with `...extra`). */
export const outLayout = (extra: { name: string; type: 'f32' | 'u32' | 'i32' | 'vec2f' | 'vec4f' }[] = []): UniformLayout =>
  makeLayout([{ name: 'wrap', type: 'vec2u' }, { name: 'filt', type: 'u32' }, { name: 'sim_res', type: 'vec2f' }, { name: 'fps', type: 'f32' }, ...extra]);

export function renderOutputs(ctx: EvalContext, view: SimView, setup: GridSetup, fps: number, outs: SimOut[], shader: ReturnType<typeof defineShader>, layout: UniformLayout, values: (o: SimOut) => Record<string, UniformValue>): Record<string, TextureValue> {
  const p = ctx.params;
  const filt = p.str('out_filter') === 'point' ? 0 : p.str('out_filter') === 'linear' ? 1 : 2;
  const base = { wrap: setup.periodic ? [1, 1] : [0, 0], filt, sim_res: [setup.w, setup.h], fps: Math.max(1, fps) };
  const out: Record<string, TextureValue> = {};
  for (const o of outs) {
    if (!ctx.wants(o.id)) continue;
    const tex = ctx.tex(o.type);
    ctx.pass({ label: `sim out ${o.id}`, target: tex, shader, defines: { OUT: o.code }, uniforms: { layout, values: { ...base, ...values(o) } }, textures: [view.a ? view.a[0] : null], ss: 1 });
    const r = ctx.result(tex, o.type);
    if (o.type === 'vector') r.vecScale = o.vecScale === 'fps' ? 1 / Math.max(1, fps) : (o.vecScale ?? 1);
    out[o.id] = r;
  }
  return out;
}

/* ----------------------------------------------------------------------------------------------- node factory */
type UVals = Record<string, UniformValue>;
const SIM_ONLY_SKIP = new Set(['loop_mode', 'loop_frames', 'blend_frames', 'sim_res', 'precision', 'speed', 'substeps', 'warmup']);

/** Param values -> uniform values (the same mapping as `shaderNode`: float / int, bool 0|1, enum index, vec2 / vec3 / color, seed). */
export function paramUniforms(schema: ParamSchema, v: ParamValues, pick: (id: string) => boolean): UVals {
  const out: UVals = {};
  for (const d of schema) {
    if (!pick(d.id)) continue;
    const x = v[d.id];
    switch (d.type) {
      case 'float': case 'int': out[d.id] = typeof x === 'number' ? x : d.default; break;
      case 'bool': out[d.id] = (typeof x === 'boolean' ? x : d.default) ? 1 : 0; break;
      case 'enum': out[d.id] = Math.max(0, d.options.findIndex((o) => o.value === x)); break;
      case 'seed': out[d.id] = (typeof x === 'number' ? x : d.default) >>> 0; break;
      case 'vec2': case 'vec3': case 'color': out[d.id] = Array.isArray(x) ? (x as number[]) : (d.default as number[]); break;
      default: break;
    }
  }
  return out;
}
const fieldOf = (d: ParamSchema[number]): UField | null => {
  switch (d.type) {
    case 'float': return { name: d.id, type: 'f32' };
    case 'int': return { name: d.id, type: 'i32' };
    case 'bool': case 'enum': case 'seed': return { name: d.id, type: 'u32' };
    case 'vec2': return { name: d.id, type: 'vec2f' };
    case 'vec3': return { name: d.id, type: 'vec3f' };
    case 'color': return { name: d.id, type: 'vec4f' };
    default: return null;
  }
};

export interface GridSimSpec {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon?: string;
  /** Node specific parameters (ids starting with `out_` go to the output shader; `out_filter` is added automatically). */
  params: ParamSchema;
  boundary?: boolean;
  periodicDefault?: boolean;
  res?: number;
  substeps?: number;
  /** Default warm-up frames (a pre-rolled default state, e.g. a developed pattern in the Gallery thumbnail). */
  warmup?: number;
  lazyPins: PinDef[];
  outs: SimOut[];
  /** Simulation passes: `#define PASS n`, fragment `fs_main` per pass (raw mode). Built-in uniforms: seed, frame, k, dt, dt_frame, time, sim_res, periodic, has_<lazy pin>. */
  simSource: string;
  outSource: string;
  passes: number[];
  texCount?: number;
  scratch?: number;
  init(g: GridRun, u: UVals, inputs: SimFrameInputs, setup: GridSetup): void;
  step(g: GridRun, u: UVals, inputs: SimFrameInputs, setup: GridSetup): void;
  presets: SimPreset[];
  gizmos?: GizmoDecl[];
  cost?: { gpu: 'low' | 'medium' | 'high'; tiling: 'global'; temporaries?: number };
  extraKey?: (ctx: EvalContext) => string;
  /** Extra output-shader uniforms (e.g. the simulated time) computed from the context. */
  outExtra?: { fields: UField[]; values(ctx: EvalContext, view: SimView, setup: GridSetup, fps: number): UVals };
  /** Bytes per cell factor for the resolution limiter (state + scratch textures). */
  memFactor?: number;
}

export function gridSimNode(spec: GridSimSpec): ReturnType<typeof defineNode> {
  const params = [...spec.params, ...simCommonParams({ boundary: spec.boundary, periodicDefault: spec.periodicDefault, res: spec.res, substeps: spec.substeps, warmup: spec.warmup })];
  const isOut = (id: string): boolean => id.startsWith('out_') && id !== 'out_filter';
  const simPick = (id: string): boolean => !id.startsWith('out_') && !SIM_ONLY_SKIP.has(id);
  const builtin: UField[] = [
    { name: 'seed_b', type: 'u32' }, { name: 'frame', type: 'i32' }, { name: 'k', type: 'i32' }, { name: 'sub', type: 'i32' }, { name: 'nsub', type: 'i32' },
    { name: 'dt', type: 'f32' }, { name: 'dt_frame', type: 'f32' }, { name: 'time', type: 'f32' }, { name: 'periodic_b', type: 'u32' },
    { name: 'sim_res', type: 'vec2f' },
    ...spec.lazyPins.map((l): UField => ({ name: `has_${l.id}`, type: 'u32' })),
  ];
  const simFields = [...builtin, ...params.filter((d) => simPick(d.id)).map(fieldOf).filter((f): f is UField => !!f)];
  const simLayout = makeLayout(simFields);
  const outFields: UField[] = params.filter((d) => isOut(d.id)).map(fieldOf).filter((f): f is UField => !!f);
  const outL = outLayout([...outFields, ...(spec.outExtra?.fields ?? [])] as { name: string; type: 'f32' | 'u32' | 'i32' | 'vec2f' | 'vec4f' }[]);
  const simShader = defineShader(`sim_${spec.id.replace(/\./g, '_')}.wgsl`, spec.simSource);
  const outShader = defineShader(`sim_${spec.id.replace(/\./g, '_')}_out.wgsl`, spec.outSource);
  const texCount = spec.texCount ?? 5;
  const frameUniforms = (raw: ParamValues, setup: GridSetup, k: number, forcing: number, inputs: SimFrameInputs): UVals => {
    const dtFrame = (1 / Math.max(1, setup.fps)) * setup.speed;
    const hasFlags: UVals = {};
    for (const l of spec.lazyPins) hasFlags[`has_${l.id}`] = inputs[l.id] ? 1 : 0;
    return {
      ...paramUniforms(params, raw, simPick), ...hasFlags,
      seed_b: (typeof raw.seed === 'number' ? raw.seed : 1) >>> 0, frame: forcing, k, sub: 0, nsub: setup.substeps, dt: subDt(setup), dt_frame: dtFrame, time: forcing * dtFrame, periodic_b: setup.periodic ? 1 : 0, sim_res: [setup.w, setup.h],
    };
  };
  const presets = registerSimPresets(spec.id, spec.presets);
  return defineNode({
    id: spec.id,
    version: 1,
    category: 'simulation',
    title: spec.title,
    description: spec.description,
    keywords: [...spec.keywords, 'simulation', 'sim', 'loop', 'tileable'],
    icon: spec.icon ?? 'sim',
    inputs: spec.lazyPins,
    outputs: spec.outs.map((o) => ({ id: o.id, name: o.name, type: o.type, tooltip: o.tooltip })),
    params,
    common: { texture: true, blending: false },
    timeDependent: true,
    simulation: true,
    lazyOutputs: true,
    cost: spec.cost ?? { gpu: 'high', tiling: 'global', temporaries: 0 },
    shaders: [
      ...spec.passes.map((id) => ({ source: simShader, uniforms: simLayout, textures: texCount, mode: 'raw' as const, defines: { PASS: id } })),
      ...spec.outs.map((o) => ({ source: outShader, uniforms: outL, textures: 1, defines: { OUT: o.code } })),
    ],
    gizmos: spec.gizmos,
    gallery: presets.map((p) => ({ name: p.name.en, params: p.params })),
    evaluate(ctx) {
      const { view, setup, fps } = requestSim(ctx, {
        lazyPins: spec.lazyPins,
        extraKey: spec.extraKey?.(ctx),
        setup: (raw, g, dev) => resolveGridSetup(raw, g, dev, { bytesPerCellFactor: spec.memFactor }),
        create: (deps, setup, owner, paramsAt) =>
          new GridBackend(deps, setup, owner, {
            shader: simShader,
            layout: simLayout,
            texCount,
            passes: spec.passes,
            scratch: spec.scratch,
            init: (g, inputs) => spec.init(g, frameUniforms(paramsAt(0), setup, -1, 0, inputs), inputs, setup),
            step: (g, k, forcing, inputs) => spec.step(g, frameUniforms(paramsAt(forcing), setup, k, forcing, inputs), inputs, setup),
          }),
      });
      const raw = ctx.params.values;
      return renderOutputs(ctx, view, setup, fps, spec.outs, outShader, outL, () => ({ ...paramUniforms(params, raw, isOut), ...(spec.outExtra?.values(ctx, view, setup, fps) ?? {}) }));
    },
  });
}

/** Record the `substeps` fixed sub-steps of one frame: pass `pass` with `extra` textures (t1...), `sub` = index, `time` advanced per sub-step. */
export function advanceSubsteps(g: GridRun, u: Record<string, UniformValue>, pass: number, extra: (GpuTexture | null | undefined)[], per?: (s: number) => Record<string, UniformValue>): void {
  const n = Math.max(1, Number(u.nsub ?? 1));
  for (let s = 0; s < n; s++) g.advance(pass, extra, { ...u, sub: s, time: Number(u.time) + s * Number(u.dt), ...(per?.(s) ?? {}) });
}

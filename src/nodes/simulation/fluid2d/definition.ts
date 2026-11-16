import { defineNode, type ShaderDecl } from '../../../engine/graph/node';
import type { PinDef } from '../../../engine/graph/pins';
import type { Graph } from '../../../engine/graph/graph';
import { simFor, type SimFrameInputs, type SimSpec, type SimulationBackend } from '../../../engine/sim/service';
import { forcingFrame, frameSignatures } from '../../../engine/sim/core';
import type { ParamValues } from '../../../engine/params/schema';
import type { GpuTexture } from '../../../engine/resources/memory';
import type { TexturePin } from '../../../engine/types';
import type { TextureValue } from '../../../engine/resources/values';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { hashString, stableStringify } from '../../../shared/util';
import { FLUID_PARAMS, buildFluidFrame, isSimParam, resolveFluidConfig, type FluidSetup } from './params';
import { FLUID_LAYOUT, FLUID_SHADER, FluidSolver, PASS_DEFS, type FluidInputs } from './solver';
import { registerSimPresets } from '../../../engine/sim/presets';
import { FLUID_PRESETS } from './presets';
import outSrc from './outputs.wgsl?raw';

export const OUT_SHADER = defineShader('sim_fluid2d_out.wgsl', outSrc);
export const OUT_LAYOUT = makeLayout([
  { name: 'wrap', type: 'vec2u' },
  { name: 'filt', type: 'u32' },
  { name: 'sim_res', type: 'vec2f' },
  { name: 'gain', type: 'f32' },
  { name: 'fps', type: 'f32' },
  { name: 'opacity', type: 'f32' },
  { name: 'soot_dark', type: 'f32' },
  { name: 'temp_scale', type: 'f32' },
  { name: 'fire_gain', type: 'f32' },
  { name: 'fire_lo', type: 'f32' },
  { name: 'fire_hi', type: 'f32' },
  { name: 'smoke_color', type: 'vec4f' },
]);

/** Lazy input pins: evaluated by the simulation service at every simulated frame (animated masks / flipbooks work). */
export const SIM_INPUTS: PinDef[] = [
  { id: 'density_emit', name: 'Density emit', type: 'gray', optional: true, lazy: true, tooltip: 'Gray mask: density added per second (x gain), evaluated every frame.' },
  { id: 'temperature_emit', name: 'Temperature emit', type: 'gray', optional: true, lazy: true },
  { id: 'fuel_emit', name: 'Fuel emit', type: 'gray', optional: true, lazy: true },
  { id: 'velocity_emit', name: 'Velocity emit', type: 'vector', optional: true, lazy: true, tooltip: 'Vector field added as acceleration inside its support.' },
  { id: 'obstacle', name: 'Obstacle', type: 'gray', optional: true, lazy: true, tooltip: 'Solid mask (> 50%). Animate it for moving obstacles.' },
  { id: 'force_field', name: 'Force field', type: 'vector', optional: true, lazy: true, tooltip: 'Vector acceleration added at every step.' },
  { id: 'kill', name: 'Kill mask', type: 'gray', optional: true, lazy: true, tooltip: 'Removes density, temperature, fuel and soot where it is 1.' },
  { id: 'initial_density', name: 'Initial density', type: 'gray', optional: true, lazy: true },
  { id: 'initial_velocity', name: 'Initial velocity', type: 'vector', optional: true, lazy: true },
];

/** Output pins: code = `#define OUT` of outputs.wgsl. Only linked / targeted pins are produced (lazy outputs). */
export const SIM_OUTPUTS: { id: string; name: string; type: TexturePin; code: number; tooltip?: string }[] = [
  { id: 'density', name: 'Density', type: 'gray', code: 0 },
  { id: 'temperature', name: 'Temperature', type: 'gray', code: 1 },
  { id: 'fuel', name: 'Fuel', type: 'gray', code: 2 },
  { id: 'velocity', name: 'Velocity', type: 'vector', code: 3, tooltip: 'Tile fractions per second.' },
  { id: 'pressure', name: 'Pressure', type: 'gray', code: 4 },
  { id: 'divergence', name: 'Divergence', type: 'gray', code: 5 },
  { id: 'curl', name: 'Vorticity / Curl', type: 'gray', code: 6 },
  { id: 'smoke_color', name: 'Smoke color', type: 'color', code: 7, tooltip: 'Density + temperature through the internal smoke / black-body ramp.' },
  { id: 'fire_mask', name: 'Fire mask', type: 'gray', code: 8 },
  { id: 'motion', name: 'Motion vectors', type: 'vector', code: 9, tooltip: 'Displacement per frame in tile fractions (velocity / fps).' },
  { id: 'normal', name: 'Normal', type: 'normal', code: 10, tooltip: 'Normal of the density height field.' },
  { id: 'soot', name: 'Soot', type: 'gray', code: 11 },
];

/** Simulation backend: the Fluid 2D solver behind the generic `SimulationBackend` contract. */
class FluidBackend implements SimulationBackend {
  readonly solver: FluidSolver;
  constructor(
    deps: ConstructorParameters<typeof FluidSolver>[0],
    private setup: FluidSetup,
    owner: { nodeId: string; nodeName: string },
    private paramsAt: (frame: number) => ParamValues,
  ) {
    this.solver = new FluidSolver(deps, setup.cfg, owner);
  }
  get width(): number {
    return this.solver.w;
  }
  get height(): number {
    return this.solver.h;
  }
  get stateBytes(): number {
    return this.solver.stateBytes;
  }
  prewarm(): Promise<void> {
    return this.solver.prewarm();
  }
  state(): GpuTexture[] {
    return this.solver.state();
  }
  private inputs(i: SimFrameInputs): FluidInputs {
    return { dens: i.density_emit, temp: i.temperature_emit, fuel: i.fuel_emit, vel: i.velocity_emit, obst: i.obstacle, force: i.force_field, kill: i.kill, initDens: i.initial_density, initVel: i.initial_velocity };
  }
  reset(enc: GPUCommandEncoder, inputs: SimFrameInputs): void {
    const f = buildFluidFrame(this.paramsAt(0), 0, this.setup);
    this.solver.reset(enc, f, this.inputs(inputs));
  }
  step(enc: GPUCommandEncoder, _k: number, forcing: number, inputs: SimFrameInputs): void {
    const f = buildFluidFrame(this.paramsAt(forcing), forcing, this.setup);
    this.solver.stepFrame(enc, f, this.inputs(inputs), this.solver.plannedSubsteps(f.dtFrame));
  }
  settle(): Promise<void> {
    return this.solver.measure();
  }
  copyState(enc: GPUCommandEncoder, from: GpuTexture[], to: GpuTexture[]): void {
    this.solver.copyState(enc, from, to);
  }
  blend(enc: GPUCommandEncoder, a: GpuTexture[], b: GpuTexture[], w: number, out: GpuTexture[]): void {
    this.solver.blend(enc, a, b, w, out);
  }
  hud(): Record<string, number> {
    return { substeps: this.solver.substepsUsed, residual: this.solver.residual, maxSpeed: this.solver.maxSpeed, passes: this.solver.passCount };
  }
  dispose(): void {
    this.solver.dispose();
  }
}

const shaderDecls = (): ShaderDecl[] => [
  ...(Object.entries(PASS_DEFS) as [string, { id: number; t: number }][]).map(([, d]): ShaderDecl => ({ source: FLUID_SHADER, uniforms: FLUID_LAYOUT, textures: d.t, mode: 'raw', defines: { PASS: d.id } })),
  ...SIM_OUTPUTS.map((o): ShaderDecl => ({ source: OUT_SHADER, uniforms: OUT_LAYOUT, textures: 2, defines: { OUT: o.code } })),
];

/** sim.fluid2d: Eulerian incompressible smoke / fire / explosion solver (see docs/ARCHITECTURE.md "Fluid 2D"). */
export default defineNode({
  id: 'simulation.fluid2d',
  version: 1,
  category: 'simulation',
  title: 'Fluid 2D',
  description: 'GPU smoke, fire and explosion solver: MacCormack advection, multigrid / PCG pressure projection, buoyancy, vorticity, turbulence, combustion. Loopable and tileable.',
  keywords: ['fluid', 'smoke', 'fire', 'explosion', 'simulation', 'sim', 'flipbook', 'vector', 'velocity', 'tileable', 'loop'],
  icon: 'sim',
  inputs: SIM_INPUTS,
  outputs: SIM_OUTPUTS.map((o) => ({ id: o.id, name: o.name, type: o.type, tooltip: o.tooltip })),
  params: FLUID_PARAMS,
  common: { texture: true, blending: false },
  timeDependent: true,
  simulation: true,
  lazyOutputs: true,
  cost: { gpu: 'high', tiling: 'global', temporaries: 0 },
  shaders: shaderDecls(),
  gizmos: [
    { id: 'em1_circle', label: 'Emitter 1', type: 'circle', viewport: '2d', space: 'uv', center: 'em1_pos', radius: 'em1_radius', visibleIf: (v) => v.em1_on === true && v.em1_shape !== 'rect' },
    { id: 'em1_dir', label: 'Emitter 1 direction', type: 'angle', viewport: '2d', space: 'uv', center: 'em1_pos', angle: 'em1_dir', visibleIf: (v) => v.em1_on === true },
    { id: 'em1_end', label: 'Emitter 1 line end', type: 'point', viewport: '2d', space: 'uv', param: 'em1_pos2', visibleIf: (v) => v.em1_on === true && v.em1_shape === 'line' },
    { id: 'em1_rect', label: 'Emitter 1 rectangle', type: 'rect', viewport: '2d', space: 'uv', center: 'em1_pos', size: 'em1_size', visibleIf: (v) => v.em1_on === true && v.em1_shape === 'rect' },
    { id: 'em2_circle', label: 'Emitter 2', type: 'circle', viewport: '2d', space: 'uv', center: 'em2_pos', radius: 'em2_radius', visibleIf: (v) => v.em2_on === true && v.em2_shape !== 'rect' },
    { id: 'em2_dir', label: 'Emitter 2 direction', type: 'angle', viewport: '2d', space: 'uv', center: 'em2_pos', angle: 'em2_dir', visibleIf: (v) => v.em2_on === true },
    { id: 'em2_end', label: 'Emitter 2 line end', type: 'point', viewport: '2d', space: 'uv', param: 'em2_pos2', visibleIf: (v) => v.em2_on === true && v.em2_shape === 'line' },
    { id: 'em2_rect', label: 'Emitter 2 rectangle', type: 'rect', viewport: '2d', space: 'uv', center: 'em2_pos', size: 'em2_size', visibleIf: (v) => v.em2_on === true && v.em2_shape === 'rect' },
    { id: 'wind', label: 'Wind direction', type: 'angle', viewport: '2d', space: 'uv', angle: 'wind_angle' },
    { id: 'swirl', label: 'Swirl', type: 'circle', viewport: '2d', space: 'uv', center: 'swirl_pos', radius: 'swirl_radius' },
  ],
  gallery: registerSimPresets('simulation.fluid2d', FLUID_PRESETS).map((p) => ({ name: p.name.en, params: p.params })),
  evaluate(ctx) {
    const svc = simFor(ctx.gpu);
    if (!svc) throw new Error('The simulation service is not available in this context.');
    const p = ctx.params;
    const id = ctx.node.id;
    // lazy inputs: producers + content signatures (time independent: only real edits invalidate)
    const lazy: SimSpec['lazy'] = {};
    const sigs: string[] = [];
    let graph: Graph | null = null;
    for (const pin of SIM_INPUTS) {
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
    const setup = resolveFluidConfig(rawParams, { fps: gs.fps, loopLength: gs.loopLength, width: ctx.frame.fullWidth, height: ctx.frame.fullHeight }, { maxDim: ctx.gpu.caps.limits.maxTextureDimension2D ?? 8192, budgetBytes: svc.memoryBudget() });
    const simParams: ParamValues = {};
    const src = nodeData ? { ...nodeData.params } : { ...rawParams };
    for (const k of Object.keys(src)) if (isSimParam(k)) simParams[k] = src[k];
    const common = { sigs, fps: gs.fps, loop: setup.loopLength, w: setup.w, h: setup.h, g: ctx.frame.fullWidth / Math.max(1, ctx.frame.fullHeight) };
    const key = String(hashString(stableStringify({ simParams, anim: nodeData?.anim ?? null, ...common })));
    // animated simulation params: a keyframe edit only invalidates from the first frame whose animated values differ (partial invalidation)
    const animIds = Object.keys(nodeData?.anim ?? {}).filter(isSimParam).sort();
    const staticParams: ParamValues = { ...simParams };
    for (const k of animIds) delete staticParams[k];
    const staticKey = animIds.length ? String(hashString(stableStringify({ staticParams, animIds, ...common }))) : key;
    const cfgBase = { fps: gs.fps, speed: setup.speed, warmup: setup.warmup, loopMode: setup.loopMode, loopLength: setup.loopLength, blend: setup.blend, cacheBytes: setup.cacheBytes, inputScale: Math.min(1, Math.max(setup.w, setup.h) / Math.max(ctx.frame.fullWidth, ctx.frame.fullHeight)), maxFrames: 100000 };
    const owner = { nodeId: id, nodeName: ctx.node.name };
    const g = graph;
    const spec: SimSpec = {
      nodeId: id,
      nodeName: ctx.node.name,
      graph: g as Graph,
      key,
      staticKey,
      signatures: animIds.length
        ? () =>
            frameSignatures((f) => {
              const v = svc.paramsAt(g, id, f, rawParams);
              return stableStringify(animIds.map((k) => v[k]));
            }, setup.warmup, setup.loopLength, setup.blend, setup.loopMode)
        : undefined,
      cfg: cfgBase,
      lazy,
      size: { w: setup.w, h: setup.h, note: setup.limited ? 'limited' : undefined },
      create: (deps) => new FluidBackend(deps, setup, owner, (frame) => svc.paramsAt(g, id, forcingFrame(frame, setup.loopLength, setup.loopMode), rawParams)),
    };
    const fps = gs.fps;
    const frame = Math.max(0, Math.round(ctx.frame.time * fps));
    const view = svc.request(spec, frame, ctx.encoder);
    if (svc.isPaused(id) !== p.bool('paused')) svc.setPaused(id, p.bool('paused'));

    const wrap: [number, number] = setup.periodic ? [1, 1] : [0, 0];
    const filt = p.str('out_filter') === 'point' ? 0 : p.str('out_filter') === 'linear' ? 1 : 2;
    const base = {
      wrap,
      filt,
      sim_res: [setup.w, setup.h],
      gain: p.num('out_gain'),
      fps: Math.max(1, fps),
      opacity: p.num('out_opacity'),
      soot_dark: p.num('out_soot_dark'),
      temp_scale: p.num('out_temp_scale'),
      fire_gain: p.num('out_fire_gain'),
      fire_lo: p.num('out_fire_lo'),
      fire_hi: Math.max(p.num('out_fire_lo') + 1e-3, p.num('out_fire_hi')),
      smoke_color: p.rgba('out_smoke_color'),
    };
    const out: Record<string, TextureValue> = {};
    for (const o of SIM_OUTPUTS) {
      if (!ctx.wants(o.id)) continue;
      const tex = ctx.tex(o.type);
      ctx.pass({
        label: `fluid out ${o.id}`,
        target: tex,
        shader: OUT_SHADER,
        defines: { OUT: o.code },
        uniforms: { layout: OUT_LAYOUT, values: { ...base, gain: o.id === 'normal' ? p.num('out_normal_strength') : base.gain } },
        textures: [view.a ? view.a[0] : null, view.a ? view.a[1] : null],
        ss: 1,
      });
      const r = ctx.result(tex, o.type);
      if (o.type === 'vector') r.vecScale = o.id === 'motion' ? 1 / Math.max(1, fps) : 1;
      out[o.id] = r;
    }
    return out;
  },
});

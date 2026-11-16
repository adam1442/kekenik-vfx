import type { GpuContext } from '../gpu/device';
import type { ComputeBinding, ComputePassDesc, FrameParams, FullscreenPassDesc } from '../gpu/passes';
import type { Params } from '../params/accessor';
import type { ParamSchema, ParamValue, ParamValues } from '../params/schema';
import type { GpuTexture, PooledBuffer } from '../resources/memory';
import type { PinValue, TextureValue } from '../resources/values';
import type { Defines } from '../shaders/preprocess';
import type { ShaderSource } from '../shaders/library';
import type { UniformLayout } from '../shaders/uniforms';
import type { NodeCategory, TexturePin } from '../types';
import type { PinDef } from './pins';

import type { GizmoDecl } from './gizmo-decl';

/* ------------------------------------------------------------------------------------------------
 * NodeDefinition: THE contract every node implements. One node = one folder:
 *   src/nodes/<category>/<node>/{definition.ts, shader.wgsl, [gizmo.ts], <node>.test.ts}
 * definition.ts default-exports `defineNode({...})`; it is discovered automatically (import.meta.glob).
 * ---------------------------------------------------------------------------------------------- */

/** Gizmo declarations live in ./gizmo-decl.ts (framework: src/gizmos/); re-exported here for compatibility. */
export type { GizmoBase, GizmoDecl, ParamMap, ParamRef, GizmoUnit } from './gizmo-decl';

export interface CostHint {
  /** Rough GPU cost class (scheduler priority / thumbnails). */
  gpu: 'trivial' | 'low' | 'medium' | 'high';
  /**
   * Tiled evaluation (8K+): 'pixel' = output pixel depends only on same-position inputs (generators, per-pixel ops),
   * 'halo' = depends on a neighbourhood of `halo(params)` pixels, 'global' = needs the whole image (blur with huge
   * radius, distance fields, histograms): cannot be tiled, evaluated at full size or rejected.
   */
  tiling: 'pixel' | 'halo' | 'global';
  halo?: (params: ParamValues) => number;
  /** Extra full-size temporary textures the node allocates (for memory estimates). */
  temporaries?: number;
}

export interface NodeCommonOptions {
  /** Texture tab (size/filtering/tiling/HQ). Default: true when the node has a texture output. */
  texture?: boolean;
  /** Blending tab + automatic Background pin. Default false. Generators set it to true. */
  blending?: boolean;
}

/** Declares a shader the node uses, so tooling (unit tests, offline WGSL validation, selftest) can assemble it. */
export interface ShaderDecl {
  source: ShaderSource;
  uniforms?: UniformLayout;
  /** Number of bound textures (t0..). */
  textures?: number;
  /** Number of read-only storage buffers (s0..), . */
  storage?: number;
  mode?: 'shade' | 'raw';
  defines?: Defines;
  /** custom vertex entry point (instanced draws, `mode: 'raw'`); default `vs_main`. */
  vertexEntry?: string;
}

/** pin / param information the fused (and the standalone) path gives to `FusableDecl.uniformValues`. */
export interface FuseIO {
  /** Modulation intensity of a modulatable float param: 0 when its `<id>_mod` pin is not connected (same as `ctx.mod(id).k`). */
  modK(paramId: string): number;
  /** True when the (texture) input pin is connected. */
  has(pinId: string): boolean;
}

/**
 * "fusable" description of a PURE PER-PIXEL fullscreen node.
 *
 * The node's `shader.wgsl` is the single source of truth. It contains a region
 *     // @fuse-begin
 *     fn fuse(uv: vec2f, src: vec4f, P: Params, x0: texture_2d<f32>, x1: texture_2d<f32>, ...) -> vec4f { ... }
 *     // @fuse-end
 * (plus `#include`s anywhere in the file). `src` is the main input sampled at THIS pixel (or `vec4f(0)` for generator heads),
 * `x0..` are the `extras` textures (same uv only!). The function may read ONLY `uv`, `src`, `P`, its extras at `uv` and the global frame `F`;
 * no neighbourhood reads, no other bindings. The standalone shader is a thin `shade()` wrapper calling `fuse()`, the fused module inlines
 * the very same region (namespaced per instance) — behaviour cannot diverge. Nodes without this declaration are chain boundaries.
 */
export interface FusableDecl {
  source: ShaderSource;
  /** Layout of `P` (the same layout the standalone pass uses). */
  uniforms: UniformLayout;
  defines?: Defines;
  /** Main (chain) input pin id; default 'input'. `null` = generator head (no main input; `src` is vec4f(0)). */
  main?: string | null;
  /** Texture pins sampled at the same uv, in the order of `x0, x1, ...`. Unconnected ones are bound to a dummy texture. */
  extras?: string[];
  /** Output pin id; default 'output'. Fusable nodes have exactly ONE output. */
  output?: string;
  /** Optional per-parameter-set veto (e.g. Levels with Auto uses a GPU reduction buffer -> not fusable). */
  canFuse?(params: ParamValues): boolean;
  /** Pure: values for the uniform block `uniforms`. */
  uniformValues(p: Params, io: FuseIO): Record<string, number | boolean | ArrayLike<number>>;
}

export interface NodeDefinition {
  /** "<category>.<name>", lowercase, unique, STABLE (stored in project files). */
  id: string;
  /** Bump when params/pins change incompatibly; implement `migrateParams`. */
  version: number;
  category: NodeCategory;
  title: string;
  description: string;
  keywords?: string[];
  /** Icon id in the app icon registry. */
  icon: string;
  inputs: PinDef[];
  outputs: PinDef[];
  params: ParamSchema;
  common?: NodeCommonOptions;
  gizmos?: GizmoDecl[];
  /** Every fullscreen shader the node uses (for tests/tooling; mirror what evaluate() passes to ctx.pass). */
  shaders?: ShaderDecl[];
  /** True when the output depends on global time (not on an animated param). Propagates downstream. */
  timeDependent?: boolean | ((params: ParamValues) => boolean);
  cost?: CostHint;
  /**
   * Curated Node Gallery variants. Gallery variant v >= 1 uses
   * `gallery[v - 1]` (partial params over the defaults) before falling back to random variants.
   */
  gallery?: { name: string; params: Record<string, ParamValue> }[];
  /**
   * ids of TEXTURE input pins whose contents the node samples on the CPU through
   * `ctx.cpuTexture(pin)`. The plan hash then includes whether the snapshot is ready, so the node re-evaluates once it arrives.
   */
  cpuTextureInputs?: string[];
  /** the node always behaves as bypassed (outputs = the first compatible input, no copy). Used by subgraph Output boundary nodes. */
  passthrough?: boolean;
  /**
   * return true when, for these parameter values, the node returns its (single, connected)
   * main input UNCHANGED. The evaluator then forwards the input texture without recording any pass ("skip identity operations").
   * Only honoured when no Background / modulation pin is connected and the input already has the node's frame size.
   */
  identity?(params: ParamValues): boolean;
  /** per-pixel fusion declaration, see `FusableDecl`. */
  fusable?: FusableDecl;
  /** the node may run its CPU work in a worker through `ctx.job(workerTask, ...)` (see workers/mesh-jobs.ts). The plan hash then includes the readiness of the result. */
  workerTask?: 'mesh.noise';
  /** stateful simulation node (see engine/sim/service.ts). The plan hash follows the simulation state (`simSalt`). */
  simulation?: boolean;
  /** the node only produces outputs that are linked or targeted (`ctx.wants(pin)`); the others are not required in the result. */
  lazyOutputs?: boolean;
  /** Record GPU work and return ALL declared outputs. Synchronous. May throw (error badge, rest of graph unaffected). */
  evaluate(ctx: EvalContext): Record<string, PinValue>;
  migrateParams?(old: Record<string, unknown>, fromVersion: number): Record<string, unknown>;
}

export const defineNode = (def: NodeDefinition): NodeDefinition => def;

/** Resolved per-node frame: size, tiling, filtering, time. Computed by the engine (plan.ts) from the Texture tab. */
export interface NodeFrame {
  /** Pixel size of THIS node's output (already includes preview-resolution scaling). */
  width: number;
  height: number;
  /** Tiled rendering: size of the full image and pixel origin of this region. Equal to width/height / 0,0 normally. */
  fullWidth: number;
  fullHeight: number;
  originX: number;
  originY: number;
  tileX: boolean;
  tileY: boolean;
  /** 0 point, 1 linear, 2 cubic. */
  filter: 0 | 1 | 2;
  /** 32-bit float intermediates. */
  hq: boolean;
  /** HQ supersampling factor per axis (1 = off). */
  supersample: number;
  /** Seconds. */
  time: number;
  /** 0..1 position inside the graph loop. */
  loopPhase: number;
  /** Graph seed. */
  seed: number;
}

export interface NodePassDesc extends FullscreenPassDesc {
  target: GpuTexture;
  /** Override supersampling (default frame.supersample in 'shade' mode). */
  ss?: number;
  /** Override frame fields (rare). */
  frame?: Partial<FrameParams>;
}

export interface ModulationInput {
  /** The connected modulation texture (Gray) or undefined when not connected. */
  tex: TextureValue | undefined;
  /** Modulation intensity (-1..1). 0 when nothing is connected, so shaders can use it unconditionally. */
  k: number;
}

export interface EvalContext {
  readonly gpu: GpuContext;
  readonly node: { id: string; name: string; type: string };
  readonly params: Params;
  readonly frame: NodeFrame;
  /**
   * Inputs by pin id. Unconnected pins are `undefined`. Gray->Color is already converted: a 'color' input pin always
   * receives a color texture.
   */
  readonly inputs: Readonly<Record<string, PinValue | undefined>>;
  readonly encoder: GPUCommandEncoder;
  /** true when output pin `pinId` is linked or targeted (always true for nodes without `lazyOutputs`). */
  wants(pinId: string): boolean;
  /** Typed accessor for texture inputs. */
  texInput(pinId: string): TextureValue | undefined;
  /** Modulation texture + intensity for a modulatable float param. */
  mod(paramId: string): ModulationInput;
  /** Allocate an output-format texture (gray r16float, uv rg16float, color/normal rgba16float; 32-bit in HQ). Size defaults to frame size. Released automatically unless returned. */
  tex(pin: TexturePin, width?: number, height?: number): GpuTexture;
  /** Wrap an allocated texture as an output value. */
  result(tex: GpuTexture, pin: TexturePin): TextureValue;
  /**
   * release a temporary obtained from `tex()` EARLY (before the node finishes) so the
   * pool can hand it out again to a later pass of the same node. Never call it on a texture you return as a result.
   * The texture goes to a node-local reuse list (matching size / format) and returns to the shared pool when the node ends,
   * so the pool can never destroy it while commands that reference it are still unsubmitted.
   * Safe because all passes of a node are recorded in one ordered command encoder.
   */
  free(tex: GpuTexture): void;
  /**
   * pooled GPU buffer (usage STORAGE | COPY_DST | COPY_SRC) released automatically
   * when the node finishes (commands are already recorded). Contents are UNDEFINED: initialise in a compute pass.
   * Used for async GPU reductions (auto-levels, auto-crop) that never read back to the CPU.
   */
  buffer(size: number): PooledBuffer;
  /**
   * CPU snapshot (<= 512 px, v-up sampling helpers in mesh/texsnap.ts) of a connected
   * texture input. Returns null when the pin is unconnected OR the async readback has not finished yet (it is requested; the node
   * is re-evaluated automatically when it arrives). Only pins listed in `cpuTextureInputs` are supported.
   */
  cpuTexture?(pinId: string): import('../mesh/texsnap').CpuTexture | null;
  /** True when a connected texture pin is still waiting for its snapshot. */
  cpuTexturePending?(pinId: string): boolean;
  /** producer + time-independent signature of a connected LAZY input pin (null when unconnected). */
  lazyInput?(pinId: string): { nodeId: string; pin: string; sig: string; graph: import('./graph').Graph } | null;
  /**
   * upload CPU data into a pooled storage buffer that stays valid until the batch containing this node finished on the
   * GPU (then it is released automatically). Unlike `buffer()` it is safe to fill with queue.writeBuffer.
   */
  uploadBuffer?(data: ArrayBufferView): GPUBuffer;
  /**
   * run the node's pure CPU function in a worker. Returns undefined when jobs are not
   * available for this evaluation (export, tests, no Worker support): compute synchronously then. Otherwise `{mesh, pending}`: `mesh` is the
   * finished result or the last valid result (null when there is none yet); when `pending` the node is re-evaluated once the result arrives.
   */
  job?(task: 'mesh.noise', params: import('../mesh/deform').NoiseDisplaceParams, input: import('../mesh/mesh').MeshData): { mesh: import('../mesh/mesh').MeshData | null; pending: boolean } | undefined;
  /** Record a fullscreen pass. */
  pass(desc: NodePassDesc): void;
  /** Record a compute pass. */
  compute(desc: ComputePassDesc): void;
  /** Pack + upload a uniform block for a compute binding. */
  uniformBinding: (layout: UniformLayout, values: Record<string, number | boolean | ArrayLike<number>>) => ComputeBinding;
}

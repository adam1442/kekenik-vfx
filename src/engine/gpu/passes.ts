import { deriveLimits } from './caps';
import type { GpuTexture } from '../resources/memory';
import type { TextureValue } from '../resources/values';
import { wgslLibrary, type ShaderSource } from '../shaders/library';
import { preprocess, type Defines } from '../shaders/preprocess';
import type { AssembledShader, PipelineCache, ShaderOwner } from '../shaders/pipelines';
import { assembleFullscreenShader, FRAME_LAYOUT } from '../shaders/assemble';
import { packUniforms, type UniformLayout, type UniformValue } from '../shaders/uniforms';
import type { UniformArena, UniformSlice } from './arena';
import type { GpuContext } from './device';

/**
 * Standard pass helpers.
 *
 * FULLSCREEN pass bind group (group 0) — generated, never hand-written in node shaders:
 *   @binding(0)  var<uniform> F: Frame        (resolution, tiling flags, filter mode, time, seed, ss, region...)
 *   @binding(1)  var<uniform> P: Params       (only if `uniforms` is given; struct generated from the UniformLayout)
 *   @binding(2+) var t0, t1, ...: texture_2d<f32>      (unfilterable-float: use textureLoad / sampling.wgsl)
 *   then         var<storage, read> s0, s1...: array<f32>   (optional read-only storage buffers)
 * Shader entry: 'shade' mode (default): write `fn shade(uv: vec2f) -> vec4f`; the helper adds fs_main with HQ
 * supersampling. 'raw' mode: write `@fragment fn fs_main(in: VsOut) -> @location(0) vec4f` yourself.
 */

export { FRAME_LAYOUT };

export interface FrameParams {
  width: number;
  height: number;
  /** Pixel origin of the rendered region inside the full image (tiled rendering); default [0,0]. */
  regionOrigin?: [number, number];
  /** Full image resolution; default = width,height. */
  fullRes?: [number, number];
  time: number;
  /** Normalised loop phase 0..1. */
  loopPhase: number;
  tile: [boolean, boolean];
  seed: number;
  /** Supersampling factor per axis (1 = off). */
  ss: number;
  /** 0 point, 1 linear, 2 cubic. */
  filter: number;
  hq: boolean;
}

export interface PassTarget {
  view: GPUTextureView;
  format: GPUTextureFormat;
  width: number;
  height: number;
}

export type TextureArg = GpuTexture | TextureValue | null | undefined;

export interface FullscreenPassDesc {
  label?: string;
  shader: ShaderSource;
  defines?: Defines;
  uniforms?: { layout: UniformLayout; values: Record<string, UniformValue> };
  textures?: TextureArg[];
  storageBuffers?: GPUBuffer[];
  mode?: 'shade' | 'raw';
  loadOp?: 'clear' | 'load';
  blend?: GPUBlendState;
  /**
   * instanced / custom draw. Use with `mode: 'raw'`: the shader declares its own `@vertex` entry (`vertexEntry`) and
   * `fs_main`. Default draw = the fullscreen triangle (3 vertices, 1 instance).
   */
  draw?: { vertexCount: number; instanceCount: number; vertexEntry?: string };
}

export type ComputeBinding =
  | { kind: 'uniform'; slice: UniformSlice }
  | { kind: 'storage'; buffer: GPUBuffer; readOnly?: boolean }
  | { kind: 'texture'; tex: TextureArg }
  | { kind: 'storageTexture'; tex: GpuTexture };

export interface ComputePassDesc {
  label?: string;
  shader: ShaderSource;
  entry?: string;
  defines?: Defines;
  /** Binding i of group 0 = bindings[i]; the shader declares matching @group(0) @binding(i) variables itself. */
  bindings: ComputeBinding[];
  workgroups: [number, number?, number?];
}

const defKey = (d?: Defines): string =>
  d
    ? Object.keys(d)
        .sort()
        .map((k) => `${k}=${String(d[k])}`)
        .join(';')
    : '';

export class PassRunner {
  private dummy: GPUTexture | null = null;
  private dummyView: GPUTextureView | null = null;
  /** per-pass CPU recording time hook (Profiler). nodeId is undefined for passes without an owner node. */
  onPass?: (nodeId: string | undefined, label: string, kind: 'fs' | 'cs', ms: number) => void;
  /**
   * bind group cache. Uniform blocks are bound with DYNAMIC OFFSETS, so a bind group only depends on (layout, uniform
   * buffer, texture views, storage buffers) and can be reused every frame (the arena chunks and pooled texture views are stable).
   * Turn off with `?nobgcache` in the URL (or `runner.bindGroupCache = false`) if a driver misbehaves.
   */
  bindGroupCache = typeof location === 'undefined' || !/[?&]nobgcache\b/.test(location.search);
  bgHits = 0;
  bgMisses = 0;
  static BG_CACHE_MAX = 768;
  private bgCache = new Map<string, GPUBindGroup>();
  private objIds = new WeakMap<object, number>();
  private nextObjId = 1;
  private idOf(o: object): number {
    let id = this.objIds.get(o);
    if (!id) this.objIds.set(o, (id = this.nextObjId++));
    return id;
  }
  get bindGroupCacheSize(): number {
    return this.bgCache.size;
  }

  constructor(
    readonly gpu: GpuContext,
    readonly pipelines: PipelineCache,
    readonly arena: UniformArena,
  ) {}

  /** 1x1 transparent black texture bound for missing optional inputs. */
  private dummyTexture(): GPUTextureView {
    if (!this.dummy) {
      this.dummy = this.gpu.device.createTexture({
        size: [1, 1],
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
        label: 'dummy 1x1',
      });
      this.dummyView = this.dummy.createView();
    }
    return this.dummyView!;
  }

  private viewOf(t: TextureArg): GPUTextureView {
    if (!t) return this.dummyTexture();
    return 'tex' in t ? t.tex.view : t.view;
  }

  private writeFrame(f: FrameParams): UniformSlice {
    const buf = packUniforms(FRAME_LAYOUT, {
      res: [f.width, f.height],
      region_origin: f.regionOrigin ?? [0, 0],
      full_res: f.fullRes ?? [f.width, f.height],
      time: f.time,
      loop_phase: f.loopPhase,
      tile: [f.tile[0] ? 1 : 0, f.tile[1] ? 1 : 0],
      seed: f.seed >>> 0,
      ss: Math.max(1, Math.floor(f.ss)),
      filter_mode: f.filter,
      hq: f.hq ? 1 : 0,
    });
    return this.arena.alloc(buf);
  }

  /** Record one fullscreen pass into `enc`. Throws PipelinePending / ShaderCompileError (see PipelineCache). */
  fullscreen(
    enc: GPUCommandEncoder,
    target: PassTarget,
    frame: FrameParams,
    desc: FullscreenPassDesc,
    owner: ShaderOwner,
    timestampWrites?: GPURenderPassTimestampWrites,
  ): void {
    const dev = this.gpu.device;
    const textures = desc.textures ?? [];
    const storage = desc.storageBuffers ?? [];
    const mode = desc.mode ?? 'shade';
    const t0 = performance.now();
    const dyn = this.bindGroupCache;
    const layoutKey = `fs|${dyn ? 'd' : 's'}|${this.gpu.caps.compat ? 'c' : 'f'}|p${desc.uniforms ? 1 : 0}|t${textures.length}|s${storage.length}`;
    const entries: GPUBindGroupLayoutEntry[] = [{ binding: 0, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: dyn } }];
    if (desc.uniforms) entries.push({ binding: 1, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, buffer: { type: 'uniform', hasDynamicOffset: dyn } });
    textures.forEach((_, i) =>
      entries.push({ binding: 2 + i, visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX, texture: { sampleType: 'unfilterable-float' } }),
    );
    // Compatibility mode has maxStorageBuffersInVertexStage = 0: a layout that exposes storage buffers to the vertex stage is invalid there.
    const storageVis = deriveLimits(this.gpu.caps).storageInVertex ? GPUShaderStage.FRAGMENT | GPUShaderStage.VERTEX : GPUShaderStage.FRAGMENT;
    storage.forEach((_, i) => entries.push({ binding: 2 + textures.length + i, visibility: storageVis, buffer: { type: 'read-only-storage' } }));
    const { bgl, pl } = this.pipelines.layout(layoutKey, entries);

    const key = `fs|${desc.shader.id}|${defKey(desc.defines)}|${mode}|${layoutKey}|${desc.uniforms?.layout.key ?? ''}|${target.format}|${desc.blend ? JSON.stringify(desc.blend) : ''}|${desc.draw?.vertexEntry ?? ''}`;
    const pipeline = this.pipelines.getRender(key, {
      owner,
      vertexEntry: desc.draw?.vertexEntry,
      layout: pl,
      format: target.format,
      blend: desc.blend,
      assemble: (): AssembledShader =>
        assembleFullscreenShader({ shader: desc.shader, defines: desc.defines, uniforms: desc.uniforms?.layout, textures: textures.length, storage: storage.length, mode, label: desc.label }),
    });

    const frameSlice = this.writeFrame(frame);
    const uSlice = desc.uniforms ? this.arena.alloc(packUniforms(desc.uniforms.layout, desc.uniforms.values)) : null;
    const views = textures.map((t) => this.viewOf(t));
    const dynOffsets: number[] = dyn ? [frameSlice.offset, ...(uSlice ? [uSlice.offset] : [])] : [];
    const makeBindGroup = (): GPUBindGroup => {
      const bgEntries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: frameSlice.buffer, offset: dyn ? 0 : frameSlice.offset, size: FRAME_LAYOUT.size } }];
      if (desc.uniforms && uSlice) bgEntries.push({ binding: 1, resource: { buffer: uSlice.buffer, offset: dyn ? 0 : uSlice.offset, size: desc.uniforms.layout.size } });
      views.forEach((v, i) => bgEntries.push({ binding: 2 + i, resource: v }));
      storage.forEach((b, i) => bgEntries.push({ binding: 2 + textures.length + i, resource: { buffer: b } }));
      return dev.createBindGroup({ layout: bgl, entries: bgEntries, label: desc.label });
    };
    let bindGroup: GPUBindGroup;
    if (dyn) {
      const ck = `${layoutKey}|${this.idOf(frameSlice.buffer)}|${uSlice ? this.idOf(uSlice.buffer) : 0}|${desc.uniforms?.layout.size ?? 0}|${views.map((v) => this.idOf(v)).join(',')}|${storage.map((b) => this.idOf(b)).join(',')}`;
      const hit = this.bgCache.get(ck);
      if (hit) {
        this.bgHits++;
        bindGroup = hit;
      } else {
        this.bgMisses++;
        bindGroup = makeBindGroup();
        if (this.bgCache.size >= PassRunner.BG_CACHE_MAX) this.bgCache.delete(this.bgCache.keys().next().value as string);
        this.bgCache.set(ck, bindGroup);
      }
    } else bindGroup = makeBindGroup();

    const pass = enc.beginRenderPass({
      label: desc.label ?? desc.shader.name,
      colorAttachments: [
        {
          view: target.view,
          loadOp: desc.loadOp ?? 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        },
      ],
      timestampWrites,
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup, dynOffsets);
    pass.draw(desc.draw?.vertexCount ?? 3, desc.draw?.instanceCount ?? 1);
    pass.end();
    this.onPass?.(owner.nodeId, desc.label ?? desc.shader.name, 'fs', performance.now() - t0);
  }

  /** Allocate + fill a uniform slice for a compute binding. */
  uniform(layout: UniformLayout, values: Record<string, UniformValue>): ComputeBinding {
    return { kind: 'uniform', slice: this.arena.alloc(packUniforms(layout, values)) };
  }

  compute(enc: GPUCommandEncoder, desc: ComputePassDesc, owner: ShaderOwner, timestampWrites?: GPUComputePassTimestampWrites): void {
    const dev = this.gpu.device;
    const t0 = performance.now();
    const kinds = desc.bindings.map((b) => (b.kind === 'storage' ? (b.readOnly ? 'sr' : 'sw') : b.kind === 'uniform' ? 'u' : b.kind === 'texture' ? 't' : `st:${b.tex.format}`));
    const layoutKey = `cs|${kinds.join(',')}`;
    const entries: GPUBindGroupLayoutEntry[] = desc.bindings.map((b, i) => {
      const visibility = GPUShaderStage.COMPUTE;
      switch (b.kind) {
        case 'uniform':
          return { binding: i, visibility, buffer: { type: 'uniform' } };
        case 'storage':
          return { binding: i, visibility, buffer: { type: b.readOnly ? 'read-only-storage' : 'storage' } };
        case 'texture':
          return { binding: i, visibility, texture: { sampleType: 'unfilterable-float' } };
        case 'storageTexture':
          return { binding: i, visibility, storageTexture: { access: 'write-only', format: b.tex.format } };
      }
    });
    const { bgl, pl } = this.pipelines.layout(layoutKey, entries);
    const entry = desc.entry ?? 'main';
    const userName = `node:${desc.shader.name}`;
    const pipeline = this.pipelines.getCompute(`${layoutKey}|${desc.shader.id}|${defKey(desc.defines)}|${entry}`, {
      owner,
      layout: pl,
      entry,
      assemble: (): AssembledShader => {
        const files = { ...wgslLibrary, [userName]: desc.shader.code, __root__: `#include "${userName}"` };
        const r = preprocess('__root__', files, desc.defines);
        return { code: r.code, map: r.map, label: desc.label ?? desc.shader.name };
      },
    });
    const bg = dev.createBindGroup({
      layout: bgl,
      label: desc.label,
      entries: desc.bindings.map((b, i): GPUBindGroupEntry => {
        switch (b.kind) {
          case 'uniform':
            return { binding: i, resource: { buffer: b.slice.buffer, offset: b.slice.offset, size: b.slice.size } };
          case 'storage':
            return { binding: i, resource: { buffer: b.buffer } };
          case 'texture':
            return { binding: i, resource: this.viewOf(b.tex) };
          case 'storageTexture':
            return { binding: i, resource: b.tex.view };
        }
      }),
    });
    const pass = enc.beginComputePass({ label: desc.label ?? desc.shader.name, timestampWrites });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(desc.workgroups[0], desc.workgroups[1] ?? 1, desc.workgroups[2] ?? 1);
    pass.end();
    this.onPass?.(owner.nodeId, desc.label ?? desc.shader.name, 'cs', performance.now() - t0);
  }

  /** Submit helper that also recycles the uniform arena chunks. */
  submit(buffers: GPUCommandBuffer[]): void {
    this.gpu.device.queue.submit(buffers);
    this.arena.endBatch();
  }

  /** Device lost. */
  reset(): void {
    this.dummy = null;
    this.dummyView = null;
    this.bgCache.clear();
  }

  /** Drop cached bind groups (memory pressure / project close). */
  clearBindGroups(): void {
    this.bgCache.clear();
  }
}

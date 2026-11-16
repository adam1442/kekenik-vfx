import { isSafeMode } from '../../app/safe-mode';
import type { Engine } from '../../engine/engine';
import { targetKey, type EvalTarget } from '../../engine/graph/evaluator';
import type { Graph } from '../../engine/graph/graph';
import type { GpuTexture, PooledBuffer } from '../../engine/resources/memory';
import type { TextureValue } from '../../engine/resources/values';
import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';

/**
 * GRAPH THUMBNAILS. One shared 2048x2048 rgba8 ATLAS (256 slots of 128px, allocated through the MemoryManager) holds the
 * previews of all nodes that were recently visible. Everything is drawn by ONE instanced draw call into a WebGPU canvas
 * that sits BEHIND the 2D graph canvas (the 2D canvas punches transparent holes where thumbnails belong, so node
 * overlap / z-order is handled for free by painter's order).
 *
 * Evaluation is LOW PRIORITY: only visible nodes, small batches, at ~128px resolution (scale), only while the main
 * scheduler is idle (`runExclusive`) and never during a parameter drag. Results are blitted into the atlas and released
 * immediately, so no GPU memory is held beyond the atlas.
 */
export const TILE = 128;
const COLS = 16;
const ROWS = 16;
const MAX_INST = 1024;
const BATCH = 6;

export interface ThumbItem {
  nodeId: string;
  /** Device-pixel rectangle on the overlay canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  dim: number;
}
export interface NodeInfo {
  w: number;
  h: number;
}

const BLIT_WGSL = /* wgsl */ `
struct U { tile_origin: vec2f, tile_size: f32, aspect: f32, kind: u32, src_w: f32, src_h: f32, pad: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[i], 0.0, 1.0);
}
fn to_srgb(c: vec3f) -> vec3f {
  let x = clamp(c, vec3f(0.0), vec3f(1.0));
  return select(12.92 * x, 1.055 * pow(x, vec3f(1.0 / 2.4)) - vec3f(0.055), x > vec3f(0.0031308));
}
@fragment fn fs(@builtin(position) fp: vec4f) -> @location(0) vec4f {
  let local = (fp.xy - u.tile_origin) / u.tile_size;
  var cs = vec2f(1.0, 1.0);
  if (u.aspect >= 1.0) { cs.y = 1.0 / u.aspect; } else { cs.x = u.aspect; }
  let uv = (local - (vec2f(1.0, 1.0) - cs) * 0.5) / cs;
  let bg = vec3f(0.07, 0.07, 0.08);
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec4f(bg, 1.0); }
  let dims = vec2f(u.src_w, u.src_h);
  let ratio = dims / (u.tile_size * cs);
  let n = i32(clamp(ceil(max(ratio.x, ratio.y)), 1.0, 4.0));
  var acc = vec4f(0.0);
  for (var sy = 0; sy < n; sy = sy + 1) {
    for (var sx = 0; sx < n; sx = sx + 1) {
      let off = ((vec2f(f32(sx), f32(sy)) + vec2f(0.5, 0.5)) / f32(n) - vec2f(0.5, 0.5)) * ratio;
      let px = clamp(floor(uv * dims + off), vec2f(0.0), dims - vec2f(1.0));
      acc = acc + textureLoad(src, vec2i(px), 0);
    }
  }
  let c = acc / f32(n * n);
  var rgb = c.rgb;
  var a = 1.0;
  if (u.kind == 0u) { rgb = vec3f(c.r, c.r, c.r); }
  else if (u.kind == 1u) { rgb = vec3f(c.r, c.g, 0.0); }
  else if (u.kind == 2u) { rgb = to_srgb(c.rgb); a = clamp(c.a, 0.0, 1.0); }
  else { rgb = clamp(c.rgb, vec3f(0.0), vec3f(1.0)); }
  let chk = select(0.14, 0.22, ((i32(floor(fp.x / 6.0)) + i32(floor(fp.y / 6.0))) % 2) == 0);
  return vec4f(mix(vec3f(chk), clamp(rgb, vec3f(0.0), vec3f(1.0)), a), 1.0);
}
`;

const OVERLAY_WGSL = /* wgsl */ `
struct Inst { rect: vec4f, uvr: vec4f, dim: vec4f };
struct G { size: vec2f, pad: vec2f };
@group(0) @binding(0) var<uniform> g: G;
@group(0) @binding(1) var<storage, read> insts: array<Inst>;
@group(0) @binding(2) var atlas: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) dim: f32 };
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var c = array<vec2f, 6>(vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let q = c[vi];
  let it = insts[ii];
  let px = it.rect.xy + q * it.rect.zw;
  var o: VOut;
  o.pos = vec4f(px.x / g.size.x * 2.0 - 1.0, 1.0 - px.y / g.size.y * 2.0, 0.0, 1.0);
  o.uv = mix(it.uvr.xy, it.uvr.zw, q);
  o.dim = it.dim.x;
  return o;
}
@fragment fn fs(in: VOut) -> @location(0) vec4f {
  let c = textureSample(atlas, samp, in.uv);
  return vec4f(mix(vec3f(0.07, 0.07, 0.08), c.rgb, in.dim), 1.0);
}
`;

interface Slot {
  slot: number;
  aspect: number;
  used: number;
}

export class ThumbnailLayer {
  readonly onUpdated = new Emitter<void>();
  /** nodeId -> evaluation error message from thumbnail evaluations. */
  readonly errors = new Map<string, string>();
  readonly onErrors = new Emitter<void>();
  readonly info = new Map<string, NodeInfo>();
  ready = false;
  /** off in safe mode (?safe). */
  enabled = !isSafeMode();

  private gpuCtx!: GPUCanvasContext;
  private format!: GPUTextureFormat;
  private atlas: GpuTexture | null = null;
  private blit!: GPURenderPipeline;
  private overlay!: GPURenderPipeline;
  private sampler!: GPUSampler;
  private ubo: PooledBuffer | null = null;
  private instBuf: PooledBuffer | null = null;
  private gBuf: PooledBuffer | null = null;
  private slots = new Map<string, Slot>();
  private free: number[] = [];
  private stale = new Set<string>();
  private wanted: string[] = [];
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private graph: Graph | null = null;
  private unsubGraph: (() => void) | null = null;
  private lastTime = NaN;
  private tick_ = 0;
  private disposed = false;
  private unsubRestore: (() => void) | null = null;

  constructor(
    private engine: Engine,
    readonly canvas: HTMLCanvasElement,
  ) {
    try {
      this.init();
      this.ready = true;
    } catch (e) {
      consoleBus.warn(`Graph thumbnails disabled: ${(e as Error).message}`, { source: 'app' });
    }
    this.unsubRestore = engine.onRestored.on(() => {
      try {
        this.atlas = null; // pools were reset with the device
        this.ubo = this.instBuf = this.gBuf = null;
        this.init();
        this.stale = new Set(this.graph?.nodes.keys() ?? []);
      } catch (e) {
        this.ready = false;
        consoleBus.warn(`Graph thumbnails could not recover: ${(e as Error).message}`, { source: 'app' });
      }
    });
  }

  private init(): void {
    const dev = this.engine.gpu.device;
    const ctx = this.canvas.getContext('webgpu');
    if (!ctx) throw new Error('Canvas does not support WebGPU');
    this.gpuCtx = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: dev, format: this.format, alphaMode: 'opaque' });
    const mm = this.engine.mm;
    this.atlas = mm.textures.acquire({ width: TILE * COLS, height: TILE * ROWS, format: 'rgba8unorm', label: 'graph-thumb-atlas' });
    this.ubo = mm.buffers.acquire({ size: 256 * (BATCH + 2), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'graph-thumb-blit-ubo' });
    this.instBuf = mm.buffers.acquire({ size: 48 * MAX_INST, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: 'graph-thumb-instances' });
    this.gBuf = mm.buffers.acquire({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'graph-thumb-globals' });
    this.sampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const blitMod = dev.createShaderModule({ code: BLIT_WGSL, label: 'graph-thumb-blit' });
    this.blit = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitMod, entryPoint: 'vs' },
      fragment: { module: blitMod, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' },
    });
    const ovMod = dev.createShaderModule({ code: OVERLAY_WGSL, label: 'graph-thumb-overlay' });
    this.overlay = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: ovMod, entryPoint: 'vs' },
      fragment: { module: ovMod, entryPoint: 'fs', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list' },
    });
    this.slots.clear();
    this.free = Array.from({ length: COLS * ROWS }, (_, i) => COLS * ROWS - 1 - i);
  }

  /* ------------------------------------------------------------------ lifecycle */
  attach(graph: Graph): void {
    this.unsubGraph?.();
    this.graph = graph;
    this.stale = new Set(graph.nodes.keys());
    this.errors.clear();
    this.info.clear();
    this.unsubGraph = graph.events.on((e) => {
      if (e.type === 'meta') return;
      if (e.type === 'reset') {
        this.stale = new Set(graph.nodes.keys());
        this.errors.clear();
      } else for (const id of e.dirty) this.stale.add(id);
    });
    if (!this.timer) this.timer = setInterval(() => void this.tick(), 90);
  }
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubGraph?.();
    this.unsubRestore?.();
    this.atlas?.release();
    this.ubo?.release();
    this.instBuf?.release();
    this.gBuf?.release();
    this.atlas = null;
    try {
      this.gpuCtx?.unconfigure();
    } catch {
      /* ignore */
    }
  }

  /** Nodes the view currently shows with a visible thumbnail, most important first. */
  setWanted(ids: string[]): void {
    this.wanted = ids;
    for (const id of ids) {
      const s = this.slots.get(id);
      if (s) s.used = ++this.tick_;
    }
  }
  markStale(ids: Iterable<string>): void {
    for (const id of ids) this.stale.add(id);
  }
  hasThumb(id: string): boolean {
    return this.slots.has(id) && !this.stale.has(id);
  }
  hasAny(id: string): boolean {
    return this.slots.has(id);
  }
  get pending(): number {
    return this.wanted.filter((id) => this.stale.has(id)).length;
  }

  /* ------------------------------------------------------------------ evaluation */
  private async tick(): Promise<void> {
    if (this.busy || this.disposed || !this.ready || !this.enabled || !this.graph || !this.atlas) return;
    const g = this.graph;
    const sched = this.engine.scheduler;
    // time-dependent nodes: refresh when the timeline moved
    if (sched.time !== this.lastTime) {
      this.lastTime = sched.time;
      for (const id of this.wanted) {
        const n = g.nodes.get(id);
        const td = n ? this.engine.registry.get(n.type)?.timeDependent : false;
        if (td === true || (typeof td === 'function' && n && td(n.params))) this.stale.add(id);
      }
    }
    const batch: EvalTarget[] = [];
    for (const id of this.wanted) {
      if (batch.length >= BATCH) break;
      if (!this.stale.has(id)) continue;
      const n = g.nodes.get(id);
      const ex = n ? this.engine.registry.expanded(n.type) : undefined;
      if (!n || !ex?.primaryTexture) {
        this.stale.delete(id);
        continue;
      }
      batch.push({ nodeId: id, pinId: ex.primaryTexture.pinId });
    }
    if (!batch.length) return;
    this.busy = true;
    try {
      const scale = Math.min(1, TILE / Math.max(g.settings.width, g.settings.height));
      await sched.runExclusive(async () => {
        const res = await this.engine.evaluator.evaluate(g, batch, { time: sched.time, scale });
        try {
          if (res.cancelled || this.disposed || this.graph !== g) return;
          this.blitBatch(batch, res.values as Map<string, { kind: string }>, res.errors, res.stats.nodes);
        } finally {
          res.release();
        }
      });
    } catch (e) {
      for (const t of batch) this.stale.delete(t.nodeId);
      consoleBus.warn(`Thumbnail evaluation failed: ${(e as Error).message}`, { source: 'eval' });
    } finally {
      this.busy = false;
    }
  }

  private allocSlot(id: string): number {
    const ex = this.slots.get(id);
    if (ex) return ex.slot;
    let slot = this.free.pop();
    if (slot === undefined) {
      // evict the least recently used slot that is not wanted right now
      const want = new Set(this.wanted);
      let victim: string | null = null;
      let best = Infinity;
      for (const [k, s] of this.slots) if (!want.has(k) && s.used < best) { best = s.used; victim = k; }
      if (victim === null) for (const [k, s] of this.slots) if (s.used < best) { best = s.used; victim = k; }
      slot = this.slots.get(victim!)!.slot;
      this.slots.delete(victim!);
    }
    this.slots.set(id, { slot, aspect: 1, used: ++this.tick_ });
    return slot;
  }

  private blitBatch(batch: EvalTarget[], values: Map<string, { kind: string }>, errors: Map<string, string>, stats: Map<string, { width: number; height: number }>): void {
    const dev = this.engine.gpu.device;
    const enc = dev.createCommandEncoder({ label: 'graph-thumbs' });
    let n = 0;
    let errChanged = false;
    for (const t of batch) {
      this.stale.delete(t.nodeId);
      const err = errors.get(t.nodeId);
      if (err) {
        if (this.errors.get(t.nodeId) !== err) errChanged = true;
        this.errors.set(t.nodeId, err);
      } else if (this.errors.delete(t.nodeId)) errChanged = true;
      const st = stats.get(t.nodeId);
      if (st) this.info.set(t.nodeId, { w: st.width, h: st.height });
      const v = values.get(targetKey(t)) as TextureValue | undefined;
      if (!v || v.kind !== 'texture') continue;
      const slot = this.allocSlot(t.nodeId);
      const col = slot % COLS,
        row = Math.floor(slot / COLS);
      const aspect = v.width / Math.max(1, v.height);
      this.slots.get(t.nodeId)!.aspect = aspect;
      const kind = v.pin === 'gray' ? 0 : v.pin === 'uv' || v.pin === 'vector' ? 1 : v.pin === 'color' ? 2 : 3;
      const data = new ArrayBuffer(32);
      const f = new Float32Array(data);
      const u = new Uint32Array(data);
      f[0] = col * TILE;
      f[1] = row * TILE;
      f[2] = TILE;
      f[3] = aspect;
      u[4] = kind;
      f[5] = v.width;
      f[6] = v.height;
      dev.queue.writeBuffer(this.ubo!.buffer, n * 256, data);
      const bg = dev.createBindGroup({
        layout: this.blit.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.ubo!.buffer, offset: n * 256, size: 32 } },
          { binding: 1, resource: v.tex.view },
        ],
      });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.atlas!.view, loadOp: 'load', storeOp: 'store' }] });
      pass.setViewport(col * TILE, row * TILE, TILE, TILE, 0, 1);
      pass.setScissorRect(col * TILE, row * TILE, TILE, TILE);
      pass.setPipeline(this.blit);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
      n++;
      if (n >= BATCH) break;
    }
    dev.queue.submit([enc.finish()]);
    if (errChanged) this.onErrors.emit();
    this.onUpdated.emit();
  }

  /** Self-test hook: read the centre pixel (rgba8) of a node's atlas tile. Awaits the GPU: never call from the render path. */
  async readCentrePixel(nodeId: string): Promise<[number, number, number, number] | null> {
    const s = this.slots.get(nodeId);
    if (!s || !this.atlas) return null;
    const dev = this.engine.gpu.device;
    const buf = dev.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = dev.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this.atlas.texture, origin: { x: (s.slot % COLS) * TILE + TILE / 2, y: Math.floor(s.slot / COLS) * TILE + TILE / 2 } }, { buffer: buf, bytesPerRow: 256 }, { width: 1, height: 1 });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const d = new Uint8Array(buf.getMappedRange().slice(0, 4));
    buf.destroy();
    return [d[0], d[1], d[2], d[3]];
  }

  /* ------------------------------------------------------------------ drawing */
  /** Draw all thumbnails (device-pixel rects). Clears the canvas first. Safe to call every frame (1 draw call). */
  draw(items: ThumbItem[], width: number, height: number): void {
    if (!this.ready || !this.atlas || this.disposed) return;
    const dev = this.engine.gpu.device;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const inst = new Float32Array(12 * Math.min(items.length, MAX_INST));
    let k = 0;
    const AW = TILE * COLS,
      AH = TILE * ROWS;
    for (const it of items) {
      const s = this.slots.get(it.nodeId);
      if (!s || k >= MAX_INST) continue;
      const col = s.slot % COLS,
        row = Math.floor(s.slot / COLS);
      const o = k * 12;
      inst.set([it.x, it.y, it.w, it.h, (col * TILE + 0.5) / AW, (row * TILE + 0.5) / AH, ((col + 1) * TILE - 0.5) / AW, ((row + 1) * TILE - 0.5) / AH, it.dim, 0, 0, 0], o);
      k++;
    }
    try {
      const view = this.gpuCtx.getCurrentTexture().createView();
      const enc = dev.createCommandEncoder({ label: 'graph-thumb-overlay' });
      const pass = enc.beginRenderPass({ colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0.07, g: 0.07, b: 0.08, a: 1 } }] });
      if (k > 0) {
        dev.queue.writeBuffer(this.instBuf!.buffer, 0, inst.buffer, 0, k * 48);
        dev.queue.writeBuffer(this.gBuf!.buffer, 0, new Float32Array([width, height, 0, 0]));
        const bg = dev.createBindGroup({
          layout: this.overlay.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: this.gBuf!.buffer, size: 16 } },
            { binding: 1, resource: { buffer: this.instBuf!.buffer, size: k * 48 } },
            { binding: 2, resource: this.atlas.view },
            { binding: 3, resource: this.sampler },
          ],
        });
        pass.setPipeline(this.overlay);
        pass.setBindGroup(0, bg);
        pass.draw(6, k);
      }
      pass.end();
      dev.queue.submit([enc.finish()]);
    } catch (e) {
      consoleBus.warn(`Thumbnail overlay draw failed: ${(e as Error).message}`, { source: 'app' });
    }
  }
}

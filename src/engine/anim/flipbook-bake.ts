/**
 * FlipbookBaker: renders N frames of a graph branch into a sheet texture (Sheet Encode).
 *
 * Why a service: a node's evaluate() is synchronous and only sees its inputs at ONE time, but a flipbook needs the producer at N
 * different times. The Sheet Encode input pin is therefore LAZY (never evaluated by the engine); the node asks the baker for the
 * sheet by content key. If it is missing the baker queues a job that - while the scheduler is paused (`runExclusiveForce`) -
 * evaluates the producer once per frame through the normal evaluator (so caching, tiling, memory rules all apply), blits each
 * result into its cell (padding replicated), and finally re-invalidates the scheduler so the node shows the finished sheet.
 * Until then the node shows the previous (or partially filled) sheet - never a crash, never a blocked UI.
 *
 * Memory: the sheet is a pooled, budget-accounted texture; at most `maxSheets` baked sheets stay resident (LRU) and all but the
 * latest per node are evictable under memory pressure. Jobs are cancelled when superseded (new request for the same node).
 */
import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import { delay } from '../../shared/util';
import type { GpuContext } from '../gpu/device';
import type { PassRunner } from '../gpu/passes';
import { targetKey, type Evaluator } from '../graph/evaluator';
import type { Graph } from '../graph/graph';
import type { EvalScheduler } from '../graph/scheduler';
import type { GpuTexture, MemoryManager } from '../resources/memory';
import { defineShader } from '../shaders/library';
import { PipelinePending } from '../shaders/pipelines';
import { makeLayout } from '../shaders/uniforms';
import blitSrc from './blit.wgsl?raw';
import { cellRect, cellSize, crossfadeWeights, sampleFrame, type RowOrder, type SheetSpec } from './flipbook-layout';

export const BLIT_SHADER = defineShader('anim_blit.wgsl', blitSrc);
export const BLIT_LAYOUT = makeLayout([
  { name: 'pad', type: 'f32' },
  { name: 'w', type: 'f32' },
  { name: 'a_gray', type: 'u32' },
  { name: 'b_gray', type: 'u32' },
  { name: 'has_b', type: 'u32' },
]);

export interface BakeSpec {
  key: string;
  nodeId: string;
  nodeName: string;
  graph: Graph;
  source: { nodeId: string; pin: string };
  sheetW: number;
  sheetH: number;
  cols: number;
  rows: number;
  count: number;
  padding: number;
  rowOrder: RowOrder;
  /** Timeline frames [start,end) divided into `count` samples. */
  start: number;
  end: number;
  offset: number;
  reverse: boolean;
  crossfade: number;
}

interface Baked {
  key: string;
  nodeId: string;
  tex: GpuTexture;
  done: boolean;
  frames: number;
  total: number;
  used: number;
}

const bakers = new WeakMap<GpuContext, FlipbookBaker>();
/** The baker that belongs to a GPU context (nodes find it through `ctx.gpu`). */
export const bakerFor = (gpu: GpuContext): FlipbookBaker | undefined => bakers.get(gpu);

export class FlipbookBaker {
  readonly onChange = new Emitter<{ nodeId: string; done: boolean; frames: number; total: number }>();
  private baked = new Map<string, Baked>();
  private latest = new Map<string, string>(); // nodeId -> key
  private errors = new Map<string, string>();
  private queue = new Map<string, BakeSpec>(); // nodeId -> pending request (only the newest is kept)
  private running: { spec: BakeSpec; cancelled: boolean } | null = null;
  private pumping = false;
  /** simulations are settled (advanced in order, within their cache budget) before every sampled frame is evaluated. */
  sims?: { settle(frame: number): Promise<boolean> };
  maxSheets = 6;
  /** Fraction of the memory budget baked sheets may use. */
  budgetFraction = 0.35;
  private tick = 0;

  constructor(
    private deps: { gpu: GpuContext; mm: MemoryManager; runner: PassRunner; evaluator: Evaluator; scheduler: EvalScheduler },
  ) {
    bakers.set(deps.gpu, this);
    deps.mm.registerEvictor((need) => void this.evict(need));
  }

  get(key: string): GpuTexture | null {
    const b = this.baked.get(key);
    if (!b || !b.done) return null;
    b.used = ++this.tick;
    return b.tex;
  }
  /** Newest sheet of a node (finished, or the partially filled one being baked). */
  latestFor(nodeId: string): GpuTexture | null {
    const k = this.latest.get(nodeId);
    const b = k ? this.baked.get(k) : undefined;
    return b ? b.tex : null;
  }
  errorOf(key: string): string | undefined {
    return this.errors.get(key);
  }
  progressOf(nodeId: string): { done: boolean; frames: number; total: number } | null {
    const k = this.latest.get(nodeId);
    const b = k ? this.baked.get(k) : undefined;
    return b ? { done: b.done, frames: b.frames, total: b.total } : null;
  }
  isBusy(): boolean {
    return !!this.running || this.queue.size > 0;
  }

  /** Queue a bake unless the key exists / is running / failed before. */
  request(spec: BakeSpec): void {
    if (this.baked.has(spec.key) || this.errors.has(spec.key)) return;
    if (this.running && this.running.spec.key === spec.key) return;
    if (this.queue.get(spec.nodeId)?.key === spec.key) return;
    if (this.running && this.running.spec.nodeId === spec.nodeId) this.running.cancelled = true; // superseded
    this.queue.set(spec.nodeId, spec);
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.size > 0) {
        const [nodeId, spec] = this.queue.entries().next().value as [string, BakeSpec];
        this.queue.delete(nodeId);
        while (this.deps.scheduler.isInteracting) await delay(60); // never bake while the user drags
        if (this.queue.get(nodeId)) continue; // superseded while waiting
        await this.deps.scheduler.runExclusiveForce(() => this.bake(spec));
      }
    } finally {
      this.pumping = false;
    }
  }

  private budget(): number {
    return this.deps.mm.budgetBytes * this.budgetFraction;
  }

  private evict(need: number): number {
    let freed = 0;
    const protectedKeys = new Set([...this.latest.values()]);
    const order = [...this.baked.values()].filter((b) => b.done && !protectedKeys.has(b.key)).sort((a, b) => a.used - b.used);
    for (const b of order) {
      if (freed >= need) break;
      freed += b.tex.bytes;
      this.drop(b);
    }
    return freed;
  }
  private drop(b: Baked): void {
    this.baked.delete(b.key);
    b.tex.release();
  }
  private trim(): void {
    const keep = new Set([...this.latest.values()]);
    const bytes = (): number => [...this.baked.values()].reduce((a, b) => a + b.tex.bytes, 0);
    const order = [...this.baked.values()].filter((b) => b.done && !keep.has(b.key)).sort((a, b) => a.used - b.used);
    while ((this.baked.size > this.maxSheets || bytes() > this.budget()) && order.length) this.drop(order.shift()!);
  }

  /** Drop everything (device lost / project closed). */
  clear(): void {
    this.queue.clear();
    if (this.running) this.running.cancelled = true;
    for (const b of [...this.baked.values()]) this.drop(b);
    this.latest.clear();
    this.errors.clear();
  }

  /** One recording attempt with retry while pipelines compile. */
  private async record(make: () => GPUCommandBuffer): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        this.deps.runner.submit([make()]);
        return;
      } catch (e) {
        if (e instanceof PipelinePending && attempt < 16) {
          await e.promise;
          continue;
        }
        throw e;
      }
    }
  }

  private async bake(spec: BakeSpec): Promise<void> {
    const { gpu, mm, runner, evaluator } = this.deps;
    const job = { spec, cancelled: false };
    this.running = job;
    const dev = (): GPUDevice => gpu.device;
    const sheetSpec: SheetSpec = { sheetW: spec.sheetW, sheetH: spec.sheetH, cols: spec.cols, rows: spec.rows, count: spec.count, padding: spec.padding, rowOrder: spec.rowOrder };
    const cell = cellSize(sheetSpec);
    let tmp: GpuTexture | null = null;
    let entry: Baked | null = null;
    const owner = { nodeId: spec.nodeId, nodeName: spec.nodeName };
    try {
      const sheet = mm.textures.acquire({ width: spec.sheetW, height: spec.sheetH, format: 'rgba16float', label: `flipbook sheet ${spec.nodeName}` });
      entry = { key: spec.key, nodeId: spec.nodeId, tex: sheet, done: false, frames: 0, total: spec.count, used: ++this.tick };
      this.baked.set(spec.key, entry);
      this.latest.set(spec.nodeId, spec.key);
      tmp = mm.textures.acquire({ width: cell.w, height: cell.h, format: 'rgba16float', label: 'flipbook cell' });
      // clear the sheet (pooled textures may hold stale pixels)
      {
        const enc = dev().createCommandEncoder({ label: 'flipbook clear' });
        enc.beginRenderPass({ colorAttachments: [{ view: sheet.view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end();
        runner.submit([enc.finish()]);
      }
      const g = spec.graph;
      const fps = g.settings.fps;
      const span = spec.end - spec.start;
      const pad0 = Math.max(0, Math.min(spec.padding, Math.floor((Math.min(cell.w, cell.h) - 1) / 2)));
      const scale = Math.min(1, Math.max((cell.w - 2 * pad0) / g.settings.width, (cell.h - 2 * pad0) / g.settings.height));
      const fade = crossfadeWeights(spec.count, spec.crossfade);
      const target = { nodeId: spec.source.nodeId, pinId: spec.source.pin };
      for (let i = 0; i < spec.count; i++) {
        if (job.cancelled) throw new Error('cancelled');
        const f = sampleFrame(i, spec.count, spec.start, spec.end, spec.offset, spec.reverse);
        if (this.sims) {
          // first evaluation registers the simulation nodes, `settle` advances them, the real evaluation then sees ready frames
          const warm = await evaluator.evaluate(g, [target], { time: f / fps, scale, useCache: false });
          warm.release();
          await this.sims.settle(Math.round(f));
          if (fade[i] > 0) await this.sims.settle(Math.round(f - span));
        }
        const resA = await evaluator.evaluate(g, [target], { time: f / fps, scale });
        const resB = fade[i] > 0 ? await evaluator.evaluate(g, [target], { time: (f - span) / fps, scale }) : null;
        try {
          const err = resA.errors.get(spec.source.nodeId) ?? resB?.errors.get(spec.source.nodeId);
          const a = resA.values.get(targetKey(target));
          const b = resB?.values.get(targetKey(target));
          if (err) throw new Error(`Source node failed: ${err}`);
          if (!a || a.kind !== 'texture') throw new Error('The input of Sheet Encode is not a texture.');
          const bt = b && b.kind === 'texture' ? b : null;
          const rect = cellRect(sheetSpec, i);
          await this.record(() => {
            const enc = dev().createCommandEncoder({ label: `flipbook frame ${i}` });
            runner.fullscreen(
              enc,
              { view: tmp!.view, format: tmp!.format, width: cell.w, height: cell.h },
              { width: cell.w, height: cell.h, time: 0, loopPhase: 0, tile: [false, false], seed: 0, ss: 1, filter: 1, hq: false },
              {
                label: 'flipbook blit',
                shader: BLIT_SHADER,
                uniforms: { layout: BLIT_LAYOUT, values: { pad: pad0, w: fade[i], a_gray: a.pin === 'gray' ? 1 : 0, b_gray: bt?.pin === 'gray' ? 1 : 0, has_b: bt ? 1 : 0 } },
                textures: [a.tex, bt ? bt.tex : a.tex],
              },
              owner,
            );
            enc.copyTextureToTexture({ texture: tmp!.texture }, { texture: sheet.texture, origin: { x: rect.x, y: rect.y } }, { width: Math.min(cell.w, spec.sheetW - rect.x), height: Math.min(cell.h, spec.sheetH - rect.y) });
            return enc.finish();
          });
        } finally {
          resA.release();
          resB?.release();
        }
        entry.frames = i + 1;
        this.onChange.emit({ nodeId: spec.nodeId, done: false, frames: i + 1, total: spec.count });
        if (i % 4 === 3) this.deps.scheduler.invalidate(); // show the sheet filling up
      }
      entry.done = true;
      this.trim();
      this.onChange.emit({ nodeId: spec.nodeId, done: true, frames: spec.count, total: spec.count });
    } catch (e) {
      const msg = (e as Error).message;
      if (entry) {
        this.baked.delete(spec.key);
        if (this.latest.get(spec.nodeId) === spec.key) this.latest.delete(spec.nodeId);
        entry.tex.release();
      }
      if (msg !== 'cancelled') {
        this.errors.set(spec.key, msg);
        consoleBus.error(`Flipbook bake failed: ${msg}`, { source: 'eval', nodeId: spec.nodeId, nodeName: spec.nodeName });
      }
    } finally {
      tmp?.release();
      if (this.running === job) this.running = null;
      this.deps.scheduler.invalidate();
    }
  }
}

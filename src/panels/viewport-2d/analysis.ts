import type { Engine } from '../../engine/engine';
import type { PooledBuffer } from '../../engine/resources/memory';
import type { GpuTexture } from '../../engine/resources/memory';
import { readTextureFloat32 } from '../../engine/resources/readback';
import { defineShader } from '../../engine/shaders/library';
import { PipelinePending } from '../../engine/shaders/pipelines';
import { makeLayout } from '../../engine/shaders/uniforms';
import { consoleBus } from '../../shared/log';
import histSrc from './hist.wgsl?raw';
import statsSrc from './stats.wgsl?raw';
import type { PixelKind } from './display';

const HIST = defineShader('viewport2d_hist.wgsl', histSrc);
const STATS = defineShader('viewport2d_stats.wgsl', statsSrc);
const HIST_LAYOUT = makeLayout([
  { name: 'rect', type: 'vec4u' },
  { name: 'step', type: 'u32' },
  { name: 'kind', type: 'u32' },
]);
const STATS_LAYOUT = makeLayout([
  { name: 'rect', type: 'vec4u' },
  { name: 'step', type: 'u32' },
  { name: 'kind', type: 'u32' },
  { name: 'groups_x', type: 'u32' },
  { name: 'groups', type: 'u32' },
]);

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface AnalysisResult {
  /** R,G,B,A,Luma x 256 bins. */
  hist: Uint32Array;
  min: Float32Array;
  max: Float32Array;
  mean: Float32Array;
  count: number;
  step: number;
  region: Region;
}

const HIST_BYTES = 1280 * 4;
const MAX_SAMPLES_PER_AXIS = 2048;

/**
 * GPU analysis: histogram + min/max/mean of a region (compute), and a 1-pixel inspector read. Everything is
 * asynchronous (mapAsync); at most ONE analysis and ONE pixel read are in flight, newer requests replace queued
 * ones, so dragging the cursor never builds a backlog. Buffers come from the shared MemoryManager pools.
 */
/** Single-flight queue where a newer request replaces the waiting one (its `drop` releases held resources). */
class LatestQueue {
  private busy = false;
  private queued: { run: () => Promise<void>; drop: () => void } | null = null;
  submit(run: () => Promise<void>, drop: () => void): void {
    if (this.busy) {
      this.queued?.drop();
      this.queued = { run, drop };
      return;
    }
    void this.pump({ run, drop });
  }
  private async pump(j: { run: () => Promise<void>; drop: () => void }): Promise<void> {
    this.busy = true;
    try {
      await j.run();
    } finally {
      this.busy = false;
      const n = this.queued;
      this.queued = null;
      if (n) void this.pump(n);
    }
  }
}

export class Analyzer {
  private analysisQ = new LatestQueue();
  private pixelQ = new LatestQueue();

  constructor(private engine: Engine) {}

  /** Run (or queue; latest wins) an analysis. The texture is retained for the duration. */
  analyze(tex: GpuTexture, kind: PixelKind, region: Region | null, cb: (r: AnalysisResult) => void): void {
    tex.retain();
    this.analysisQ.submit(
      async () => {
        try {
          cb(await this.run(tex, kind, region ?? { x: 0, y: 0, w: tex.width, h: tex.height }));
        } catch (e) {
          consoleBus.warn(`Viewport analysis failed: ${(e as Error).message}`, { source: 'gpu' });
        } finally {
          tex.release();
        }
      },
      () => tex.release(),
    );
  }

  private async run(tex: GpuTexture, kind: PixelKind, region: Region): Promise<AnalysisResult> {
    const { gpu, mm, runner } = this.engine;
    const w = Math.max(1, Math.min(region.w, tex.width - region.x));
    const h = Math.max(1, Math.min(region.h, tex.height - region.y));
    const step = Math.max(1, Math.ceil(Math.max(w, h) / MAX_SAMPLES_PER_AXIS));
    const gx = Math.ceil(Math.ceil(w / step) / 8);
    const gy = Math.ceil(Math.ceil(h / step) / 8);
    const groups = gx * gy;
    const U = GPUBufferUsage;
    const bufs: PooledBuffer[] = [];
    try {
      const hist = mm.buffers.acquire({ size: HIST_BYTES, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST, label: 'viewport hist' });
      bufs.push(hist);
      const partial = mm.buffers.acquire({ size: Math.max(64, groups * 64), usage: U.STORAGE, label: 'viewport stats partial' });
      bufs.push(partial);
      const result = mm.buffers.acquire({ size: 64, usage: U.STORAGE | U.COPY_SRC, label: 'viewport stats result' });
      bufs.push(result);
      const staging = mm.buffers.acquire({ size: HIST_BYTES + 64, usage: U.MAP_READ | U.COPY_DST, label: 'viewport analysis staging' });
      bufs.push(staging);
      const rect = [region.x, region.y, w, h];
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const dev = gpu.device;
          const enc = dev.createCommandEncoder({ label: 'viewport analysis' });
          enc.clearBuffer(hist.buffer, 0, HIST_BYTES);
          const owner = { label: '2D viewport analysis' };
          runner.compute(enc, { label: 'hist', shader: HIST, bindings: [runner.uniform(HIST_LAYOUT, { rect, step, kind }), { kind: 'texture', tex }, { kind: 'storage', buffer: hist.buffer }], workgroups: [gx, gy] }, owner);
          const sb = (): import('../../engine/gpu/passes').ComputeBinding[] => [runner.uniform(STATS_LAYOUT, { rect, step, kind, groups_x: gx, groups }), { kind: 'texture', tex }, { kind: 'storage', buffer: partial.buffer }, { kind: 'storage', buffer: result.buffer }];
          runner.compute(enc, { label: 'stats partial', shader: STATS, entry: 'partial_main', bindings: sb(), workgroups: [gx, gy] }, owner);
          runner.compute(enc, { label: 'stats final', shader: STATS, entry: 'final_main', bindings: sb(), workgroups: [1] }, owner);
          enc.copyBufferToBuffer(hist.buffer, 0, staging.buffer, 0, HIST_BYTES);
          enc.copyBufferToBuffer(result.buffer, 0, staging.buffer, HIST_BYTES, 64);
          runner.submit([enc.finish()]);
          break;
        } catch (e) {
          if (e instanceof PipelinePending) await e.promise;
          else throw e;
          if (attempt === 3) throw new Error('shader compilation still pending after 4 attempts', { cause: e });
        }
      }
      await staging.buffer.mapAsync(GPUMapMode.READ, 0, HIST_BYTES + 64);
      const raw = staging.buffer.getMappedRange(0, HIST_BYTES + 64).slice(0);
      staging.buffer.unmap();
      const hv = new Uint32Array(raw, 0, 1280);
      const rv = new Float32Array(raw, HIST_BYTES, 16);
      return { hist: hv, min: rv.slice(0, 4), max: rv.slice(4, 8), mean: rv.slice(8, 12), count: rv[12], step, region: { x: region.x, y: region.y, w, h } };
    } finally {
      for (const b of bufs) b.release();
    }
  }

  /** Async 1-pixel float readback (never blocks; latest request wins). */
  readPixel(tex: GpuTexture, x: number, y: number, cb: (v: Float32Array | null) => void): void {
    if (x < 0 || y < 0 || x >= tex.width || y >= tex.height) return cb(null);
    tex.retain();
    this.pixelQ.submit(
      async () => {
        try {
          cb(await readTextureFloat32(this.engine.gpu, this.engine.mm, tex.texture, tex.format, tex.width, tex.height, { x, y, w: 1, h: 1 }));
        } catch {
          cb(null);
        } finally {
          tex.release();
        }
      },
      () => tex.release(),
    );
  }
}

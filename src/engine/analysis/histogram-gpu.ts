import type { Engine } from '../engine';
import { targetKey } from '../graph/evaluator';
import type { Graph } from '../graph/graph';
import { defineShader } from '../shaders/library';
import { makeLayout } from '../shaders/uniforms';
import type { GpuTexture } from '../resources/memory';
import { consoleBus } from '../../shared/log';
import { Emitter } from '../../shared/emitter';
import { autoRange, BINS, CHANNELS, MAX_SAMPLES, strideFor, type HistRange, type HistResult } from './histogram-core';
import histSrc from './histogram.wgsl?raw';

/**
 * GPU histogram service + per-widget client.
 *  - One compute pass over the texture (strided sampling, <= MAX_SAMPLES samples), results are read back ASYNCHRONOUSLY (mapAsync) from a
 *    pooled staging buffer (the pool is the ring: buffers are released right after the read). Nothing here ever blocks the render path.
 *  - `HistogramService.compute` runs at most ONE job at a time (queued jobs are replaced: latest wins).
 *  - `HistogramClient` belongs to one widget: throttled (<= 10 Hz while the graph changes, immediate on `flush()`), results cached by
 *    (producer version hash, kind, range), stops completely while the widget is hidden, evaluates its input as a UI-driven target at a
 *    reduced scale (outside the interactive frame budget).
 */
const SHADER = defineShader('histogram_gpu.wgsl', histSrc);
const LAYOUT = makeLayout([
  { name: 'size', type: 'vec2u' },
  { name: 'step', type: 'u32' },
  { name: 'kind', type: 'u32' },
  { name: 'lo', type: 'f32' },
  { name: 'hi', type: 'f32' },
]);
const WORDS = 1296;
const BYTES = WORDS * 4;

export class HistogramService {
  /** Test hook: number of jobs that finished / were dropped / currently hold GPU buffers. */
  done = 0;
  dropped = 0;
  active = 0;
  private busy = false;
  private queued: { tex: GpuTexture; kind: 'gray' | 'color'; range: HistRange; res: (r: HistResult) => void; rej: (e: Error) => void } | null = null;

  constructor(private readonly engine: Engine) {}

  compute(tex: GpuTexture, kind: 'gray' | 'color', range: HistRange): Promise<HistResult> {
    return new Promise((res, rej) => {
      if (this.queued) {
        this.dropped++;
        this.queued.rej(new Error('superseded'));
      }
      this.queued = { tex, kind, range, res, rej };
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queued) {
        const j = this.queued;
        this.queued = null;
        try {
          j.res(await this.run(j.tex, j.kind, j.range));
        } catch (e) {
          j.rej(e as Error);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async run(tex: GpuTexture, kind: 'gray' | 'color', range: HistRange): Promise<HistResult> {
    const { mm, runner, gpu } = this.engine;
    const U = GPUBufferUsage;
    const lo = range.min;
    const hi = range.max > range.min ? range.max : range.min + 1e-6;
    const step = strideFor(tex.width, tex.height, MAX_SAMPLES);
    const gx = Math.ceil(Math.ceil(tex.width / step) / 8);
    const gy = Math.ceil(Math.ceil(tex.height / step) / 8);
    const hist = mm.buffers.acquire({ size: BYTES, usage: U.STORAGE | U.COPY_SRC | U.COPY_DST, label: 'histogram bins' });
    const staging = mm.buffers.acquire({ size: BYTES, usage: U.MAP_READ | U.COPY_DST, label: 'histogram staging' });
    this.active++;
    try {
      const owner = { label: 'histogram' };
      for (let attempt = 0; ; attempt++) {
        try {
          const enc = gpu.device.createCommandEncoder({ label: 'histogram' });
          enc.clearBuffer(hist.buffer, 0, BYTES);
          runner.compute(enc, { label: 'histogram', shader: SHADER, bindings: [runner.uniform(LAYOUT, { size: [tex.width, tex.height], step, kind: kind === 'gray' ? 1 : 0, lo, hi }), { kind: 'texture', tex }, { kind: 'storage', buffer: hist.buffer }], workgroups: [gx, gy] }, owner);
          enc.copyBufferToBuffer(hist.buffer, 0, staging.buffer, 0, BYTES);
          runner.submit([enc.finish()]);
          break;
        } catch (e) {
          if ((e as Error).name === 'PipelinePending' && attempt < 8) {
            await (e as unknown as { promise: Promise<void> }).promise;
            continue;
          }
          throw e;
        }
      }
      await staging.buffer.mapAsync(GPUMapMode.READ, 0, BYTES);
      const raw = new Uint32Array(staging.buffer.getMappedRange(0, BYTES).slice(0));
      staging.buffer.unmap();
      const bins = new Float32Array(CHANNELS * BINS);
      for (let i = 0; i < CHANNELS * BINS; i++) bins[i] = raw[i];
      const overHi = new Float32Array(CHANNELS);
      const overLo = new Float32Array(CHANNELS);
      const max = new Float32Array(CHANNELS);
      const f = new Float32Array(raw.buffer);
      for (let c = 0; c < CHANNELS; c++) {
        overHi[c] = raw[1280 + c];
        overLo[c] = raw[1285 + c];
        max[c] = f[1290 + c];
      }
      this.done++;
      return { bins, overHi, overLo, max, samples: Math.ceil(tex.width / step) * Math.ceil(tex.height / step), range: { min: lo, max: hi } };
    } finally {
      this.active--;
      hist.release();
      staging.release();
    }
  }
}

export interface HistogramState {
  status: 'idle' | 'ok' | 'noinput' | 'unavailable';
  input?: HistResult;
  output?: HistResult;
  /** Kind of the analysed texture. */
  kind?: 'gray' | 'color';
}
export interface HistogramClientOptions {
  engine: Engine;
  graph: () => Graph;
  nodeId: () => string;
  /** Input pin id (default 'input'). */
  pin?: string;
  /** Also analyse the node's own OUTPUT (faint overlay in the Levels widget). */
  wantOutput?: () => boolean;
  hdr?: () => boolean;
  /** Minimum ms between two requests while the graph changes (default 100 = 10 Hz). */
  throttleMs?: number;
}

const services = new WeakMap<Engine, HistogramService>();
export const histogramService = (e: Engine): HistogramService => {
  let s = services.get(e);
  if (!s) services.set(e, (s = new HistogramService(e)));
  return s;
};

export class HistogramClient {
  readonly onState = new Emitter<HistogramState>();
  state: HistogramState = { status: 'idle' };
  private visible = true;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private last = 0;
  private running = false;
  private again = false;
  private cacheKey = '';
  private disposed = false;
  /** Statistics for tests / diagnostics. */
  runs = 0;
  cacheHits = 0;

  constructor(private readonly o: HistogramClientOptions) {}

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.request(true);
    else clearTimeout(this.timer);
  }

  /** Ask for a refresh (throttled; `immediate` for release / first show). */
  request(immediate = false): void {
    if (this.disposed || !this.visible) return;
    clearTimeout(this.timer);
    const wait = immediate ? 0 : Math.max(0, (this.o.throttleMs ?? 100) - (performance.now() - this.last));
    this.timer = setTimeout(() => void this.run(), wait);
  }

  invalidate(): void {
    this.cacheKey = '';
    this.request(true);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.onState.clear?.();
  }

  private emit(s: HistogramState): void {
    this.state = s;
    this.onState.emit(s);
  }

  private async run(): Promise<void> {
    if (this.disposed || !this.visible) return;
    if (this.running) {
      this.again = true; // at most one request in flight per widget; the newest one runs afterwards
      return;
    }
    this.running = true;
    this.last = performance.now();
    try {
      await this.once();
    } catch (e) {
      if ((e as Error).message !== 'superseded') {
        consoleBus.warn(`Histogram unavailable: ${(e as Error).message}`, { source: 'histogram' });
        this.emit({ status: 'unavailable' });
      }
    } finally {
      this.running = false;
      if (this.again) {
        this.again = false;
        this.request();
      }
    }
  }

  private async analyse(nodeId: string, pinId: string | undefined, hdr: boolean): Promise<{ r: HistResult; kind: 'gray' | 'color'; hash: number } | null> {
    const { engine } = this.o;
    const g = this.o.graph();
    const scale = Math.max(0.125, Math.min(1, 1024 / Math.max(g.settings.width, g.settings.height)));
    const res = await engine.evaluator.evaluate(g, [{ nodeId, pinId }], { scale });
    try {
      const v = res.values.get(targetKey({ nodeId, pinId }));
      if (!v || v.kind !== 'texture') return null;
      const kind: 'gray' | 'color' = v.pin === 'gray' ? 'gray' : 'color';
      const svc = histogramService(engine);
      let r = await svc.compute(v.tex, kind, { min: 0, max: 1 });
      if (hdr) {
        const m = Math.max(...r.max);
        if (m > 1) r = await svc.compute(v.tex, kind, autoRange(m));
      }
      return { r, kind, hash: res.stats.nodes.get(nodeId)?.hash ?? 0 };
    } finally {
      res.release();
    }
  }

  private async once(): Promise<void> {
    const g = this.o.graph();
    const id = this.o.nodeId();
    const pin = this.o.pin ?? 'input';
    const link = [...g.links.values()].find((l) => l.to.node === id && l.to.pin === pin);
    if (!link) {
      this.cacheKey = '';
      this.emit({ status: 'noinput' });
      return;
    }
    const hdr = this.o.hdr?.() ?? false;
    const inp = await this.analyse(link.from.node, link.from.pin, hdr);
    if (!inp) {
      this.emit({ status: 'unavailable' });
      return;
    }
    const wantOut = this.o.wantOutput?.() ?? false;
    const key = `${inp.hash}|${inp.kind}|${hdr ? 'hdr' : 'sdr'}`;
    if (!wantOut && key === this.cacheKey && this.state.status === 'ok') {
      this.cacheHits++;
      return;
    }
    let output: HistResult | undefined;
    if (wantOut) output = (await this.analyse(id, undefined, hdr))?.r;
    this.cacheKey = key;
    this.runs++;
    this.emit({ status: 'ok', input: inp.r, output, kind: inp.kind });
  }
}

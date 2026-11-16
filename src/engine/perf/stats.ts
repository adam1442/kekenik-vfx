import type { Engine } from '../engine';
import { Emitter } from '../../shared/emitter';

/**
 * PerfStats = the single collection point for everything the Profiler panel and the Performance HUD show:
 *  - per evaluation: CPU ms, GPU ms (timestamp queries when available), nodes run / cached, preview scale
 *  - per node: CPU + GPU ms and the passes it recorded (CPU recording time per pass)
 *  - memory timeline (used / live / idle / budget, sampled every 250 ms), pool hit rate, output-cache hit rate
 *  - pipeline compile times
 * Everything is bounded (ring buffers) and costs ~nothing when nobody looks (`enabled = false` stops the sampler).
 */
export class Ring<T> {
  private buf: T[] = [];
  private head = 0;
  constructor(readonly capacity: number) {}
  push(v: T): void {
    if (this.buf.length < this.capacity) this.buf.push(v);
    else {
      this.buf[this.head] = v;
      this.head = (this.head + 1) % this.capacity;
    }
  }
  get length(): number {
    return this.buf.length;
  }
  /** Oldest -> newest. */
  toArray(): T[] {
    return this.buf.length < this.capacity ? this.buf.slice() : [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }
  last(): T | undefined {
    if (!this.buf.length) return undefined;
    return this.buf.length < this.capacity ? this.buf[this.buf.length - 1] : this.buf[(this.head - 1 + this.capacity) % this.capacity];
  }
  clear(): void {
    this.buf = [];
    this.head = 0;
  }
}

export interface PassTiming {
  label: string;
  kind: 'fs' | 'cs';
  cpuMs: number;
}
export interface NodeTiming {
  id: string;
  name: string;
  type: string;
  cpuMs: number;
  gpuMs?: number;
  status: string;
  width: number;
  height: number;
  passes: PassTiming[];
}
export interface EvalSample {
  t: number;
  cpuMs: number;
  gpuMs?: number;
  ran: number;
  cached: number;
  planned: number;
  scale: number;
}
export interface MemSample {
  t: number;
  used: number;
  live: number;
  idle: number;
  budget: number;
  external: number;
  texHits: number;
  texMisses: number;
  cacheHits: number;
  cacheMisses: number;
}
export interface CompileRecord {
  label: string;
  ms: number;
  ok: boolean;
  t: number;
}

export const rate = (hits: number, misses: number): number | null => (hits + misses > 0 ? hits / (hits + misses) : null);

export class PerfStats {
  readonly onUpdate = new Emitter<void>();
  readonly evals = new Ring<EvalSample>(240);
  readonly mem = new Ring<MemSample>(480);
  readonly compiles: CompileRecord[] = [];
  nodes: NodeTiming[] = [];
  /** true once any GPU timestamp arrived. */
  hasGpuTimes = false;
  enabled = false;
  private passBuf = new Map<string, PassTiming[]>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubs: Array<() => void> = [];
  private lastStats: EvalSample | null = null;

  constructor(private engine: Engine) {}

  /** Wire the collectors. Idempotent. The cheap hooks stay on; the memory sampler only runs while `enabled`. */
  attach(): void {
    if (this.unsubs.length) return;
    const e = this.engine;
    e.runner.onPass = (nodeId, label, kind, ms) => {
      if (!this.enabled) return;
      const key = nodeId ?? '';
      let l = this.passBuf.get(key);
      if (!l) this.passBuf.set(key, (l = []));
      if (l.length < 64) l.push({ label, kind, cpuMs: ms });
    };
    this.unsubs.push(
      e.pipelines.onCompiled.on((c) => {
        this.compiles.push({ ...c, t: performance.now() });
        if (this.compiles.length > 400) this.compiles.splice(0, this.compiles.length - 400);
      }),
    );
    this.unsubs.push(
      e.scheduler.onResult.on(({ result, scale }) => {
        if (!this.enabled || result.stats.isolated) return;
        const s = result.stats;
        const sample: EvalSample = { t: performance.now(), cpuMs: s.cpuMs, gpuMs: s.gpuMs, ran: s.nodesEvaluated, cached: s.cacheHits, planned: s.nodesPlanned, scale };
        this.lastStats = sample;
        this.evals.push(sample);
        const graph = e.scheduler.currentGraph;
        const nodes: NodeTiming[] = [];
        for (const [id, st] of s.nodes) {
          const n = graph?.nodes.get(id);
          nodes.push({ id, name: n?.name ?? id, type: n?.type ?? '?', cpuMs: st.cpuMs, gpuMs: st.gpuMs, status: st.status, width: st.width, height: st.height, passes: this.passBuf.get(id) ?? [] });
        }
        this.passBuf = new Map();
        this.nodes = nodes;
        this.onUpdate.emit();
      }),
    );
    this.unsubs.push(
      e.evaluator.onTiming.on((s) => {
        if (!this.enabled || s.isolated) return;
        if (s.gpuMs !== undefined) this.hasGpuTimes = true;
        if (this.lastStats && Math.abs(this.lastStats.cpuMs - s.cpuMs) < 1e-6) this.lastStats.gpuMs = s.gpuMs;
        for (const n of this.nodes) {
          const st = s.nodes.get(n.id);
          if (st) n.gpuMs = st.gpuMs;
        }
        this.onUpdate.emit();
      }),
    );
  }

  private users = 0;
  /** Reference-counted enable: every viewer (Profiler panel, HUD) calls this and the returned release function. */
  acquire(): () => void {
    this.users++;
    this.setEnabled(true);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.users = Math.max(0, this.users - 1);
      if (this.users === 0) this.setEnabled(false);
    };
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    if (on) {
      this.sample();
      this.timer = setInterval(() => this.sample(), 250);
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private sample(): void {
    const m = this.engine.mm.stats();
    const c = this.engine.evaluator.cache;
    this.mem.push({
      t: performance.now(),
      used: m.usedBytes,
      live: m.textureLiveBytes + m.bufferLiveBytes,
      idle: m.textureIdleBytes + m.bufferIdleBytes,
      budget: m.budgetBytes,
      external: m.externalBytes,
      texHits: m.textureHits,
      texMisses: m.textureMisses,
      cacheHits: c.hits,
      cacheMisses: c.misses,
    });
    this.onUpdate.emit();
  }

  /** Hit rates over the last `windowSamples` memory samples (default 40 = 10 s); null when nothing happened. */
  hitRates(windowSamples = 40): { pool: number | null; cache: number | null } {
    const a = this.mem.toArray();
    if (a.length < 2) return { pool: null, cache: null };
    const first = a[Math.max(0, a.length - windowSamples)];
    const last = a[a.length - 1];
    return { pool: rate(last.texHits - first.texHits, last.texMisses - first.texMisses), cache: rate(last.cacheHits - first.cacheHits, last.cacheMisses - first.cacheMisses) };
  }

  /** Lifetime hit rates since the engine started. */
  lifetimeRates(): { pool: number | null; cache: number | null } {
    const m = this.engine.mm.stats();
    const c = this.engine.evaluator.cache;
    return { pool: rate(m.textureHits, m.textureMisses), cache: rate(c.hits, c.misses) };
  }

  clear(): void {
    this.evals.clear();
    this.mem.clear();
    this.compiles.length = 0;
    this.nodes = [];
    this.passBuf = new Map();
    this.onUpdate.emit();
  }

  dispose(): void {
    this.setEnabled(false);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.engine.runner.onPass = undefined;
  }
}

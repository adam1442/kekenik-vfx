import { consoleBus } from '../shared/log';

/**
 * worker POOL with a typed task protocol (one mechanism for every CPU-heavy job: mesh nodes, OBJ, JSON).
 *
 *   request  {taskId, task, params, inputs}            -> worker
 *   response {taskId, ok: true, outputs} | {taskId, ok: false, error}
 *
 *  - Pool size = clamp(hardwareConcurrency - 1, 1, 4); workers are created lazily and respawned after a crash / timeout.
 *  - Zero-copy: `transfer` lists buffers MOVED to the worker (only use for data nobody else needs). Without it the inputs are CLONED
 *    (copy-on-send): this is what mesh nodes use, because their input buffers stay alive in the output cache.
 *  - Latest wins per `key` (= node id): at most ONE in-flight task per key, a newer submit replaces the queued one (the older promise
 *    rejects with `Superseded`) and the result of a superseded in-flight task is discarded. The queue holds at most one job per key, so it
 *    is bounded by the number of nodes; `cancel(key)` drops everything of a key.
 *  - Crash / timeout: the worker is terminated and respawned, the job is run ONCE on the calling thread through `runSync` (same function,
 *    so same result) and the incident is reported in the Console. Without Worker support (`factory` null) every job runs through `runSync`.
 */
export interface WorkerLike {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}
export interface TaskRequest {
  taskId: number;
  task: string;
  params: unknown;
  inputs: unknown[];
}
export type TaskResponse = { taskId: number; ok: true; outputs: unknown } | { taskId: number; ok: false; error: string };

export class Superseded extends Error {
  constructor() {
    super('superseded');
    this.name = 'Superseded';
  }
}

export interface PoolOptions {
  size?: number;
  /** null = no Worker support: everything runs through `runSync`. */
  factory: (() => WorkerLike) | null;
  /** The SAME pure function the worker runs (main-thread path / crash fallback). */
  runSync: (task: string, params: unknown, inputs: unknown[]) => unknown;
  timeoutMs?: number;
}

interface Job {
  taskId: number;
  key: string;
  task: string;
  params: unknown;
  inputs: unknown[];
  transfer?: Transferable[];
  res: (o: unknown) => void;
  rej: (e: Error) => void;
  superseded: boolean;
}
interface Slot {
  worker: WorkerLike | null;
  job: Job | null;
  timer?: ReturnType<typeof setTimeout>;
}

export const defaultPoolSize = (hc: number | undefined = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 2): number => Math.max(1, Math.min(4, (hc ?? 2) - 1));

export class WorkerPool {
  private slots: Slot[];
  private queue: Job[] = [];
  private seq = 0;
  private anon = 0;
  private timeoutMs: number;
  /** Diagnostics / tests. */
  stats = { submitted: 0, completed: 0, superseded: 0, crashes: 0, fallbacks: 0, spawned: 0 };

  constructor(private readonly o: PoolOptions) {
    this.slots = Array.from({ length: o.size ?? defaultPoolSize() }, () => ({ worker: null, job: null }));
    this.timeoutMs = o.timeoutMs ?? 120_000;
  }

  get size(): number {
    return this.slots.length;
  }
  get queued(): number {
    return this.queue.length;
  }
  get inFlight(): number {
    return this.slots.filter((s) => s.job).length;
  }
  get workersAlive(): number {
    return this.slots.filter((s) => s.worker).length;
  }
  get available(): boolean {
    return !!this.o.factory;
  }

  submit(task: string, params: unknown, inputs: unknown[] = [], opts: { key?: string; transfer?: Transferable[] } = {}): Promise<unknown> {
    this.stats.submitted++;
    return new Promise<unknown>((res, rej) => {
      const key = opts.key ?? `#${this.anon++}`;
      const job: Job = { taskId: ++this.seq, key, task, params, inputs, transfer: opts.transfer, res, rej, superseded: false };
      // latest wins: replace a queued job of the same key, mark an in-flight one as superseded (its result is discarded)
      const qi = this.queue.findIndex((j) => j.key === key);
      if (qi >= 0) {
        this.stats.superseded++;
        this.queue[qi].rej(new Superseded());
        this.queue.splice(qi, 1);
      }
      for (const s of this.slots) if (s.job?.key === key) s.job.superseded = true;
      this.queue.push(job);
      this.pump();
    });
  }

  /** Drop everything of `key`: queued jobs reject, an in-flight result will be discarded. */
  cancel(key: string): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].key === key) {
        this.queue[i].rej(new Superseded());
        this.queue.splice(i, 1);
        this.stats.superseded++;
      }
    }
    for (const s of this.slots) if (s.job?.key === key) s.job.superseded = true;
  }

  dispose(): void {
    for (const j of this.queue) j.rej(new Superseded());
    this.queue = [];
    for (const s of this.slots) {
      clearTimeout(s.timer);
      s.worker?.terminate();
      s.worker = null;
      if (s.job) s.job.rej(new Superseded());
      s.job = null;
    }
  }

  private pump(): void {
    for (const slot of this.slots) {
      if (slot.job) continue;
      // first queued job whose key is not in flight (at most one in-flight task per key)
      const i = this.queue.findIndex((j) => !this.slots.some((s) => s.job?.key === j.key));
      if (i < 0) return;
      const [job] = this.queue.splice(i, 1);
      this.start(slot, job);
    }
  }

  private spawn(slot: Slot): WorkerLike | null {
    if (slot.worker) return slot.worker;
    if (!this.o.factory) return null;
    try {
      const w = this.o.factory();
      w.onmessage = (e) => this.onMessage(slot, e.data as TaskResponse);
      w.onerror = (e) => this.onCrash(slot, `worker error: ${(e as { message?: string })?.message ?? 'unknown'}`);
      slot.worker = w;
      this.stats.spawned++;
      return w;
    } catch (e) {
      consoleBus.warn(`Worker could not be created (${(e as Error).message}); CPU jobs run on the main thread.`, { source: 'worker' });
      return null;
    }
  }

  private start(slot: Slot, job: Job): void {
    const w = this.spawn(slot);
    if (!w) {
      slot.job = job;
      this.fallback(slot, job, null);
      return;
    }
    slot.job = job;
    slot.timer = setTimeout(() => this.onCrash(slot, `timeout after ${this.timeoutMs} ms`), this.timeoutMs);
    try {
      const req: TaskRequest = { taskId: job.taskId, task: job.task, params: job.params, inputs: job.inputs };
      w.postMessage(req, job.transfer);
    } catch (e) {
      this.onCrash(slot, `postMessage failed: ${(e as Error).message}`);
    }
  }

  private finish(slot: Slot): Job | null {
    clearTimeout(slot.timer);
    const job = slot.job;
    slot.job = null;
    return job;
  }

  private onMessage(slot: Slot, r: TaskResponse): void {
    if (!slot.job || slot.job.taskId !== r.taskId) return; // stale message (after a respawn)
    const job = this.finish(slot)!;
    if (job.superseded) {
      this.stats.superseded++;
      job.rej(new Superseded());
    } else if (r.ok) {
      this.stats.completed++;
      job.res(r.outputs);
    } else job.rej(new Error(r.error));
    this.pump();
  }

  private onCrash(slot: Slot, why: string): void {
    this.stats.crashes++;
    slot.worker?.terminate();
    slot.worker = null; // respawned lazily by the next job
    const job = this.finish(slot);
    consoleBus.error(`Worker task "${job?.task ?? '?'}" failed: ${why}. Respawning the worker and retrying once on the main thread.`, { source: 'worker' });
    if (job) {
      slot.job = job;
      this.fallback(slot, job, why);
    } else this.pump();
  }

  /** Run a job through the SAME pure function on the calling thread (deferred to a macrotask so awaiting callers never run inside submit()). */
  private fallback(slot: Slot, job: Job, why: string | null): void {
    if (why !== null) this.stats.fallbacks++;
    setTimeout(() => {
      if (slot.job === job) slot.job = null;
      if (job.superseded) {
        job.rej(new Superseded());
        this.stats.superseded++;
      } else {
        try {
          job.res(this.o.runSync(job.task, job.params, job.inputs));
          this.stats.completed++;
        } catch (e) {
          job.rej(e as Error);
        }
      }
      this.pump();
    }, 0);
  }
}

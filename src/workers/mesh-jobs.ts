import { Emitter } from '../shared/emitter';
import type { MemoryManager } from '../engine/resources/memory';
import type { MeshData } from '../engine/mesh/mesh';
import type { WorkerPool } from './pool';
import { decodeMesh, encodeMesh, type TaskMap, type WireMesh } from './tasks';

/**
 * evaluator-facing mesh job service (keeps the PULL model: `evaluate()` stays synchronous).
 *
 * A node with `workerTask` calls `ctx.job(task, params, inputMesh)`:
 *   - result ready  -> `{ mesh, pending: false }`
 *   - not ready     -> the job is submitted (latest wins per node) and `{ mesh: last valid result or null, pending: true }` is returned.
 * The plan hash contains whether the result is ready, so when it arrives `onReady` fires, the scheduler re-evaluates once (coalesced) and the
 * node then finds the result. Viewports keep showing the last valid result meanwhile. Results live in a byte-bounded LRU that is also counted
 * in the memory meter ('meshjobs'), so CPU buffers never grow without limit.
 */
export const WORKER_MIN_POINTS = 20_000;

interface Entry {
  mesh: MeshData;
  bytes: number;
}
export interface JobResult {
  mesh: MeshData | null;
  pending: boolean;
}

export class MeshJobs {
  readonly onReady = new Emitter<string>();
  readonly onChange = new Emitter<void>();
  maxBytes = 256 * 1024 * 1024;
  private results = new Map<string, Entry>();
  private last = new Map<string, MeshData>();
  private inflight = new Map<string, string>();
  private total = 0;
  /** nodes that currently wait for a worker result (progress indicator) */
  readonly pending = new Set<string>();
  errors = 0;

  constructor(
    private readonly pool: WorkerPool | null,
    private readonly mm?: MemoryManager,
  ) {}

  get available(): boolean {
    return !!this.pool;
  }
  get bytes(): number {
    return this.total;
  }
  get count(): number {
    return this.results.size;
  }
  has(key: string): boolean {
    return this.results.has(key);
  }

  request<K extends 'mesh.noise'>(nodeId: string, key: string, task: K, params: TaskMap[K]['params'], input: MeshData): JobResult | undefined {
    if (!this.pool) return undefined;
    const hit = this.results.get(key);
    if (hit) {
      this.results.delete(key);
      this.results.set(key, hit); // LRU touch
      this.last.set(nodeId, hit.mesh);
      return { mesh: hit.mesh, pending: false };
    }
    if (this.inflight.get(nodeId) !== key) {
      this.inflight.set(nodeId, key);
      this.pending.add(nodeId);
      this.onChange.emit();
      void this.pool.submit(task, params, [encodeMesh(input)] satisfies [WireMesh], { key: `job:${nodeId}` }).then(
        (out) => {
          if (this.inflight.get(nodeId) !== key) return; // superseded by a newer request of the same node
          this.inflight.delete(nodeId);
          this.pending.delete(nodeId);
          const mesh = decodeMesh((out as TaskMap[K]['out']).mesh);
          this.store(key, mesh);
          this.onChange.emit();
          this.onReady.emit(nodeId);
        },
        (e: Error) => {
          if (e.name === 'Superseded') return;
          if (this.inflight.get(nodeId) === key) {
            this.inflight.delete(nodeId);
            this.pending.delete(nodeId);
          }
          this.errors++;
          this.onChange.emit();
        },
      );
    }
    return { mesh: this.last.get(nodeId) ?? null, pending: true };
  }

  private store(key: string, mesh: MeshData): void {
    const bytes = mesh.bytes;
    this.results.set(key, { mesh, bytes });
    this.total += bytes;
    this.mm?.addExternal('meshjobs', bytes);
    while (this.total > this.maxBytes && this.results.size > 1) {
      const [k, v] = this.results.entries().next().value as [string, Entry];
      this.results.delete(k);
      this.total -= v.bytes;
      this.mm?.removeExternal('meshjobs', v.bytes);
    }
  }

  /** Forget a node (deleted from the graph) and everything cached. */
  clear(): void {
    for (const [nodeId] of this.inflight) this.pool?.cancel(`job:${nodeId}`);
    this.inflight.clear();
    this.pending.clear();
    this.last.clear();
    for (const v of this.results.values()) this.mm?.removeExternal('meshjobs', v.bytes);
    this.results.clear();
    this.total = 0;
    this.onChange.emit();
  }
}

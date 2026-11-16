import type { GpuContext } from './device';

/**
 * Per-node GPU timing through timestamp queries (when the 'timestamp-query' feature exists).
 * Every pass of a node takes a (begin,end) query pair labelled with the node id; results are summed per node.
 * Readback is asynchronous; while a readback is in flight new batches are simply not profiled.
 */
export class GpuProfiler {
  private qs: GPUQuerySet | null = null;
  private resolveBuf: GPUBuffer | null = null;
  private readBuf: GPUBuffer | null = null;
  private used = 0;
  private owners: string[] = [];
  /** valid[i] = pair i belongs to a node attempt that was kept (aborted attempts leave unwritten slots). */
  private valid: boolean[] = [];
  private busy = false;
  private active = false;
  readonly capacity = 512;
  enabled: boolean;

  constructor(private gpu: GpuContext) {
    this.enabled = gpu.caps.has.timestampQuery;
  }

  private ensure(): boolean {
    if (!this.enabled) return false;
    if (!this.qs) {
      const d = this.gpu.device;
      this.qs = d.createQuerySet({ type: 'timestamp', count: this.capacity, label: 'node timestamps' });
      this.resolveBuf = d.createBuffer({ size: this.capacity * 8, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC, label: 'ts resolve' });
      this.readBuf = d.createBuffer({ size: this.capacity * 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST, label: 'ts read' });
    }
    return true;
  }

  beginBatch(): void {
    this.active = false;
    if (this.busy || !this.ensure()) return;
    this.active = true;
    this.used = 0;
    this.owners = [];
    this.valid = [];
  }

  /** Stop profiling for the current batch (isolated runs). */
  suspend(): void {
    this.active = false;
  }

  /** Position marker: call before recording a node attempt. */
  mark(): number {
    return this.owners.length;
  }
  /** The attempt since `mark` was dropped (its encoder never submitted): its slots must not be trusted. */
  abort(mark: number): void {
    for (let i = mark; i < this.valid.length; i++) this.valid[i] = false;
  }

  /** timestampWrites for the next pass of `owner` (undefined when profiling is off / full). */
  writes(owner: string): GPURenderPassTimestampWrites | undefined {
    if (!this.active || !this.qs || this.used + 2 > this.capacity) return undefined;
    const w = { querySet: this.qs, beginningOfPassWriteIndex: this.used, endOfPassWriteIndex: this.used + 1 };
    this.used += 2;
    this.owners.push(owner);
    this.valid.push(true);
    return w;
  }

  /** Records the resolve+copy into `enc`; returns a collector to call AFTER submit (or null if nothing to read). */
  finish(enc: GPUCommandEncoder): (() => Promise<Map<string, number>>) | null {
    if (!this.active || !this.qs || this.used === 0) return null;
    const used = this.used;
    const owners = this.owners.map((o, i) => (this.valid[i] ? o : ''));
    // Slots of dropped attempts were never written: write them with empty passes so the resolve below is always valid.
    this.valid.forEach((ok, i) => {
      if (!ok) enc.beginComputePass({ timestampWrites: { querySet: this.qs!, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 } }).end();
    });
    enc.resolveQuerySet(this.qs, 0, used, this.resolveBuf!, 0);
    enc.copyBufferToBuffer(this.resolveBuf!, 0, this.readBuf!, 0, used * 8);
    this.busy = true;
    this.active = false;
    return async () => {
      const out = new Map<string, number>();
      try {
        await this.readBuf!.mapAsync(GPUMapMode.READ, 0, used * 8);
        const t = new BigUint64Array(this.readBuf!.getMappedRange(0, used * 8).slice(0));
        this.readBuf!.unmap();
        for (let i = 0; i < owners.length; i++) {
          const a = t[i * 2];
          const b = t[i * 2 + 1];
          if (owners[i] && b > a) out.set(owners[i], (out.get(owners[i]) ?? 0) + Number(b - a) / 1e6);
        }
      } catch {
        /* device lost or buffer destroyed: ignore */
      } finally {
        this.busy = false;
      }
      return out;
    };
  }

  reset(): void {
    this.qs = null;
    this.resolveBuf = null;
    this.readBuf = null;
    this.busy = false;
    this.active = false;
  }
}

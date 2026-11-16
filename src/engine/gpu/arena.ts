import type { MemoryManager, PooledBuffer } from '../resources/memory';
import type { GpuContext } from './device';

export interface UniformSlice {
  buffer: GPUBuffer;
  offset: number;
  size: number;
}

/**
 * Sub-allocator for small uniform blocks. Each pass writes its uniforms into a slice of a big chunk with
 * queue.writeBuffer (no per-pass buffer creation). Chunks of a batch are recycled only after the GPU finished
 * the batch (`endBatch()` is called right after queue.submit; it waits on onSubmittedWorkDone).
 */
export class UniformArena {
  static CHUNK = 256 * 1024;
  private current: { buf: PooledBuffer; used: number }[] = [];
  private freeChunks: PooledBuffer[] = [];
  private generation = 0;
  inflightChunks = 0;

  constructor(
    private gpu: GpuContext,
    private mm: MemoryManager,
  ) {}

  /**
   * Bytes of uniform chunks the arena keeps on purpose (current + in flight + the small free list). They are counted as
   * LIVE buffer bytes by the pool but are a bounded cache, not a leak; leak checks subtract this.
   */
  get heldBytes(): number {
    return (this.current.length + this.inflightChunks + this.freeChunks.length) * UniformArena.CHUNK;
  }

  alloc(data: ArrayBuffer): UniformSlice {
    const size = data.byteLength;
    if (size > UniformArena.CHUNK) throw new Error('Uniform block larger than arena chunk');
    const align = this.gpu.caps.limits.minUniformBufferOffsetAlignment ?? 256;
    let chunk = this.current[this.current.length - 1];
    let offset = chunk ? Math.ceil(chunk.used / align) * align : 0;
    if (!chunk || offset + size > UniformArena.CHUNK) {
      const buf =
        this.freeChunks.pop() ??
        this.mm.buffers.acquire({ size: UniformArena.CHUNK, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, label: 'uniform arena chunk' });
      chunk = { buf, used: 0 };
      this.current.push(chunk);
      offset = 0;
    }
    chunk.used = offset + size;
    this.gpu.device.queue.writeBuffer(chunk.buf.buffer, offset, data);
    return { buffer: chunk.buf.buffer, offset, size };
  }

  /** Call right after queue.submit() of everything that used slices allocated since the last call. */
  private holds: Array<() => void> = [];
  /** run `release` once the GPU finished the batch that is being recorded now (see EvalContext.uploadBuffer). */
  holdUntilBatchDone(release: () => void): void {
    this.holds.push(release);
  }

  endBatch(): void {
    if (this.holds.length) {
      const holds = this.holds;
      this.holds = [];
      const run = (): void => holds.forEach((f) => f());
      void this.gpu.device.queue.onSubmittedWorkDone().then(run, run);
    }
    if (this.current.length === 0) return;
    const chunks = this.current.map((c) => c.buf);
    this.current = [];
    this.inflightChunks += chunks.length;
    const gen = this.generation;
    void this.gpu.device.queue.onSubmittedWorkDone().then(
      () => {
        if (gen !== this.generation) return;
        this.inflightChunks -= chunks.length;
        for (const c of chunks) {
          if (this.freeChunks.length < 4) this.freeChunks.push(c);
          else c.release();
        }
      },
      () => undefined,
    );
  }

  reset(): void {
    this.generation++;
    this.current = [];
    this.freeChunks = [];
    this.inflightChunks = 0;
  }
}

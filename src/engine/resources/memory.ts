import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import { nextPow2 } from '../../shared/util';
import type { GpuContext } from '../gpu/device';
import { supportsStorage } from '../gpu/caps';
import { textureBytes } from './format';

/**
 * Memory safety core.
 *  - MemoryManager owns the byte accounting and the budget. EVERY GPU allocation of the engine goes through
 *    TexturePool / BufferPool, so `usedBytes` is exact (live + pooled-but-idle).
 *  - Over budget: (1) trim idle pooled resources, (2) ask evictors (the output LRU cache) to drop entries,
 *    (3) trim again, (4) throw OutOfBudgetError. Callers (the evaluator) turn that into a per-node error badge.
 *  - Hard caps come from device limits (maxTextureDimension2D, maxBufferSize).
 */

export class OutOfBudgetError extends Error {
  constructor(
    message: string,
    readonly requested: number,
    readonly used: number,
    readonly budget: number,
  ) {
    super(message);
    this.name = 'OutOfBudgetError';
  }
}
export class AllocationTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllocationTooLargeError';
  }
}

// Numeric WebGPU usage flags (literals so this module can be imported in GPU-less unit tests):
// COPY_SRC 0x01, COPY_DST 0x02, TEXTURE_BINDING 0x04, STORAGE_BINDING 0x08, RENDER_ATTACHMENT 0x10.
export const TEXTURE_USAGE_RT: GPUTextureUsageFlags = 0x04 | 0x10 | 0x01 | 0x02;
const USAGE_STORAGE_BINDING = 0x08;

export interface TextureDesc {
  width: number;
  height: number;
  format: GPUTextureFormat;
  /** Also request STORAGE_BINDING (only honoured when the format supports it; check supportsStorage first). */
  storage?: boolean;
  label?: string;
}

/** Anything with manual reference counting (textures; later meshes, flipbooks). */
export interface RefCounted {
  retain(): unknown;
  release(): void;
  readonly bytes: number;
  readonly refCount: number;
}

/**
 * Reference-counted GPU texture. Created with refCount 1 (the creator's reference).
 * When the count reaches 0 the texture returns to the pool (it is NOT destroyed immediately).
 */
export class GpuTexture implements RefCounted {
  private refs = 1;
  constructor(
    private pool: TexturePool,
    readonly texture: GPUTexture,
    readonly view: GPUTextureView,
    readonly width: number,
    readonly height: number,
    readonly format: GPUTextureFormat,
    readonly usage: GPUTextureUsageFlags,
    readonly bytes: number,
    readonly key: string,
    readonly generation: number,
  ) {}
  get refCount(): number {
    return this.refs;
  }
  retain(): this {
    if (this.refs <= 0) throw new Error('GpuTexture.retain after release (use-after-free)');
    this.refs++;
    return this;
  }
  release(): void {
    if (this.refs <= 0) {
      consoleBus.error('GpuTexture released more times than retained (double free ignored).', { source: 'gpu' });
      return;
    }
    if (--this.refs === 0) this.pool.recycle(this);
  }
}

interface FreeEntry {
  tex: GpuTexture;
  lastUsed: number;
}

export class TexturePool {
  private free = new Map<string, FreeEntry[]>();
  private generation = 0;
  liveBytes = 0;
  freeBytes = 0;
  liveCount = 0;
  freeCount = 0;
  hits = 0;
  misses = 0;
  /** lifetime GPU object counters (leak detection: created - destroyed == live + idle). */
  created = 0;
  destroyed = 0;
  /** Idle (pooled) memory above this fraction of the budget is destroyed eagerly. */
  idleFraction = 0.25;

  constructor(private mm: MemoryManager) {}

  acquire(desc: TextureDesc): GpuTexture {
    const gpu = this.mm.gpu;
    const { width, height, format } = desc;
    const maxDim = gpu.caps.limits.maxTextureDimension2D ?? 8192;
    if (!(width >= 1 && height >= 1) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new AllocationTooLargeError(`Invalid texture size ${width}x${height}`);
    }
    if (width > maxDim || height > maxDim) {
      throw new AllocationTooLargeError(`Texture ${width}x${height} exceeds device maxTextureDimension2D (${maxDim}).`);
    }
    const store = !!desc.storage && supportsStorage(gpu.caps, format);
    const usage = TEXTURE_USAGE_RT | (store ? USAGE_STORAGE_BINDING : 0);
    const key = `${width}x${height}:${format}:${usage}`;
    const bytes = textureBytes(width, height, format);
    const list = this.free.get(key);
    const entry = list?.pop();
    if (entry) {
      this.hits++;
      this.freeBytes -= bytes;
      this.freeCount--;
      this.liveBytes += bytes;
      this.liveCount++;
      const t = entry.tex;
      const out = new GpuTexture(this, t.texture, t.view, width, height, format, usage, bytes, key, this.generation);
      return out;
    }
    this.misses++;
    this.mm.ensureRoom(bytes, `texture ${width}x${height} ${format}`);
    const dev = gpu.device;
    dev.pushErrorScope('out-of-memory');
    const texture = dev.createTexture({ size: [width, height], format, usage, label: desc.label ?? `tex ${width}x${height} ${format}` });
    void dev.popErrorScope().then((err) => {
      if (err) this.mm.onDeviceOutOfMemory(bytes, err.message);
    });
    this.mm.addUsed(bytes);
    this.created++;
    this.liveBytes += bytes;
    this.liveCount++;
    return new GpuTexture(this, texture, texture.createView(), width, height, format, usage, bytes, key, this.generation);
  }

  /** Called by GpuTexture when its refcount hits zero. */
  recycle(t: GpuTexture): void {
    if (t.generation !== this.generation) return; // belongs to a lost device
    this.liveBytes -= t.bytes;
    this.liveCount--;
    let list = this.free.get(t.key);
    if (!list) this.free.set(t.key, (list = []));
    list.push({ tex: t, lastUsed: performance.now() });
    this.freeBytes += t.bytes;
    this.freeCount++;
    if (this.freeBytes > this.mm.budgetBytes * this.idleFraction) this.trim(this.freeBytes - this.mm.budgetBytes * this.idleFraction);
  }

  /** Destroy idle textures, oldest first, until at least `bytesNeeded` were freed. Returns bytes freed. */
  trim(bytesNeeded = Infinity): number {
    const all: [string, FreeEntry][] = [];
    for (const [k, l] of this.free) for (const e of l) all.push([k, e]);
    all.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let freed = 0;
    for (const [k, e] of all) {
      if (freed >= bytesNeeded) break;
      const list = this.free.get(k)!;
      list.splice(list.indexOf(e), 1);
      if (list.length === 0) this.free.delete(k);
      e.tex.texture.destroy();
      this.destroyed++;
      freed += e.tex.bytes;
      this.freeBytes -= e.tex.bytes;
      this.freeCount--;
      this.mm.removeUsed(e.tex.bytes);
    }
    return freed;
  }

  /** Device lost / shutdown: forget everything (GPU objects are already invalid). */
  reset(): void {
    this.generation++;
    this.free.clear();
    this.liveBytes = this.freeBytes = this.liveCount = this.freeCount = 0;
    this.created = this.destroyed = 0; // objects of the lost device are gone: restart the balance
  }
}

export interface BufferDesc {
  size: number;
  usage: GPUBufferUsageFlags;
  label?: string;
}

export class PooledBuffer {
  released = false;
  constructor(
    private pool: BufferPool,
    readonly buffer: GPUBuffer,
    /** Bucketed (actual) size, >= requested. */
    readonly size: number,
    readonly usage: GPUBufferUsageFlags,
    readonly key: string,
    readonly generation: number,
  ) {}
  release(): void {
    if (this.released) return;
    this.released = true;
    this.pool.recycle(this);
  }
}

export class BufferPool {
  private free = new Map<string, FreeBufEntry[]>();
  private generation = 0;
  liveBytes = 0;
  freeBytes = 0;
  liveCount = 0;
  freeCount = 0;
  created = 0;
  destroyed = 0;
  constructor(private mm: MemoryManager) {}

  /** Bucket sizes: pow2 below 1 MiB, multiples of 1 MiB above (limits fragmentation, bounded waste). */
  static bucket(size: number): number {
    const MB = 1 << 20;
    return size <= MB ? Math.max(256, nextPow2(size)) : Math.ceil(size / MB) * MB;
  }

  acquire(desc: BufferDesc): PooledBuffer {
    const maxSize = this.mm.gpu.caps.limits.maxBufferSize ?? 2 ** 28;
    const size = BufferPool.bucket(desc.size);
    if (size > maxSize) throw new AllocationTooLargeError(`Buffer of ${size} bytes exceeds maxBufferSize (${maxSize}).`);
    const key = `${size}:${desc.usage}`;
    const e = this.free.get(key)?.pop();
    if (e) {
      this.freeBytes -= size;
      this.freeCount--;
      this.liveBytes += size;
      this.liveCount++;
      return new PooledBuffer(this, e.buf.buffer, size, desc.usage, key, this.generation);
    }
    this.mm.ensureRoom(size, `buffer ${size}B`);
    const dev = this.mm.gpu.device;
    dev.pushErrorScope('out-of-memory');
    const buffer = dev.createBuffer({ size, usage: desc.usage, label: desc.label ?? `buf ${size}` });
    void dev.popErrorScope().then((err) => {
      if (err) this.mm.onDeviceOutOfMemory(size, err.message);
    });
    this.mm.addUsed(size);
    this.created++;
    this.liveBytes += size;
    this.liveCount++;
    return new PooledBuffer(this, buffer, size, desc.usage, key, this.generation);
  }

  recycle(b: PooledBuffer): void {
    if (b.generation !== this.generation) return;
    this.liveBytes -= b.size;
    this.liveCount--;
    let list = this.free.get(b.key);
    if (!list) this.free.set(b.key, (list = []));
    list.push({ buf: b, lastUsed: performance.now() });
    this.freeBytes += b.size;
    this.freeCount++;
    if (this.freeBytes > this.mm.budgetBytes * 0.1) this.trim(this.freeBytes - this.mm.budgetBytes * 0.1);
  }

  trim(bytesNeeded = Infinity): number {
    const all: [string, FreeBufEntry][] = [];
    for (const [k, l] of this.free) for (const e of l) all.push([k, e]);
    all.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let freed = 0;
    for (const [k, e] of all) {
      if (freed >= bytesNeeded) break;
      const list = this.free.get(k)!;
      list.splice(list.indexOf(e), 1);
      if (list.length === 0) this.free.delete(k);
      e.buf.buffer.destroy();
      this.destroyed++;
      this.freeCount--;
      freed += e.buf.size;
      this.freeBytes -= e.buf.size;
      this.mm.removeUsed(e.buf.size);
    }
    return freed;
  }

  reset(): void {
    this.generation++;
    this.free.clear();
    this.liveBytes = this.freeBytes = 0;
  }
}
interface FreeBufEntry {
  buf: PooledBuffer;
  lastUsed: number;
}

export interface LeakReport {
  liveTextures: number;
  idleTextures: number;
  liveBuffers: number;
  idleBuffers: number;
  texturesCreated: number;
  texturesDestroyed: number;
  buffersCreated: number;
  buffersDestroyed: number;
  textureLiveBytes: number;
  bufferLiveBytes: number;
  usedBytes: number;
  textureBalance: number;
  bufferBalance: number;
}

export interface MemoryStats {
  budgetBytes: number;
  usedBytes: number;
  peakBytes: number;
  textureLiveBytes: number;
  textureIdleBytes: number;
  bufferLiveBytes: number;
  bufferIdleBytes: number;
  textureHits: number;
  textureMisses: number;
  /** CPU-side payloads accounted in the same budget (meshes). Included in usedBytes. */
  externalBytes: number;
  externalByCategory: Record<string, number>;
}

export class MemoryManager {
  budgetBytes: number;
  usedBytes = 0;
  peakBytes = 0;
  readonly textures: TexturePool;
  readonly buffers: BufferPool;
  readonly onChange = new Emitter<void>();
  /** fired when an allocation could not be satisfied (budget) or the device reported out-of-memory. MemoryGuard listens. */
  readonly onPressure = new Emitter<{ kind: 'budget' | 'device-oom'; bytes: number }>();
  private evictors: Array<(needBytes: number) => void> = [];
  /** bytes held outside the pools (CPU mesh arrays), by category. Counted in `usedBytes` and the budget. */
  private external = new Map<string, number>();
  externalBytes = 0;

  constructor(
    readonly gpu: GpuContext,
    budgetBytes?: number,
  ) {
    this.budgetBytes = budgetBytes ?? gpu.caps.defaultBudgetBytes;
    this.textures = new TexturePool(this);
    this.buffers = new BufferPool(this);
  }

  setBudget(bytes: number): void {
    this.budgetBytes = Math.max(64 * 1024 ** 2, Math.floor(bytes));
    if (this.usedBytes > this.budgetBytes) this.reclaim(this.usedBytes - this.budgetBytes);
    this.onChange.emit();
  }

  /** Register a function that frees memory on demand (the output cache does). */
  registerEvictor(fn: (needBytes: number) => void): void {
    this.evictors.push(fn);
  }

  addUsed(b: number): void {
    this.usedBytes += b;
    if (this.usedBytes > this.peakBytes) this.peakBytes = this.usedBytes;
  }
  removeUsed(b: number): void {
    this.usedBytes = Math.max(0, this.usedBytes - b);
  }

  /** account CPU-side bytes (mesh attribute arrays) in the same budget. Never throws: call ensureRoom first. */
  addExternal(category: string, bytes: number): void {
    if (bytes <= 0) return;
    this.external.set(category, (this.external.get(category) ?? 0) + bytes);
    this.externalBytes += bytes;
    this.addUsed(bytes);
  }
  removeExternal(category: string, bytes: number): void {
    if (bytes <= 0) return;
    this.external.set(category, Math.max(0, (this.external.get(category) ?? 0) - bytes));
    this.externalBytes = Math.max(0, this.externalBytes - bytes);
    this.removeUsed(bytes);
  }

  /** Try to free `bytes` (idle pools first, then evictors, then idle pools again). */
  reclaim(bytes: number): void {
    let freed = this.textures.trim(bytes) + this.buffers.trim(bytes - 0);
    if (freed >= bytes) return;
    for (const ev of this.evictors) {
      ev(bytes - freed);
      freed += this.textures.trim(bytes - freed);
      if (freed >= bytes) return;
    }
    this.buffers.trim(bytes - freed);
  }

  /** Throws OutOfBudgetError when `bytes` cannot fit even after reclaiming everything reclaimable. */
  ensureRoom(bytes: number, what: string): void {
    if (bytes > this.budgetBytes) {
      this.onPressure.emit({ kind: 'budget', bytes });
      throw new AllocationTooLargeError(`${what} needs ${bytes} bytes, more than the whole memory budget (${this.budgetBytes}).`);
    }
    if (this.usedBytes + bytes <= this.budgetBytes) return;
    this.reclaim(this.usedBytes + bytes - this.budgetBytes);
    if (this.usedBytes + bytes > this.budgetBytes) {
      this.onPressure.emit({ kind: 'budget', bytes });
      throw new OutOfBudgetError(
        `Out of GPU memory budget allocating ${what} (used ${this.usedBytes}, requested ${bytes}, budget ${this.budgetBytes}).`,
        bytes,
        this.usedBytes,
        this.budgetBytes,
      );
    }
  }

  /** The device itself reported OOM: shrink the budget so we stop pushing it. */
  onDeviceOutOfMemory(bytes: number, message: string): void {
    this.budgetBytes = Math.max(64 * 1024 ** 2, Math.floor(this.usedBytes * 0.75));
    consoleBus.error(`GPU out-of-memory while allocating ${bytes} bytes (${message}). Budget lowered to ${this.budgetBytes}.`, { source: 'gpu' });
    this.reclaim(this.usedBytes - this.budgetBytes);
    this.onChange.emit();
    this.onPressure.emit({ kind: 'device-oom', bytes });
  }

  /**
   * object counters for leak checks. After everything was released and the pools were trimmed,
   * `liveTextures`, `idleTextures`, `liveBuffers`, `idleBuffers` must be back to their baseline.
   */
  leakReport(): LeakReport {
    const t = this.textures;
    const b = this.buffers;
    return {
      liveTextures: t.liveCount,
      idleTextures: t.freeCount,
      liveBuffers: b.liveCount,
      idleBuffers: b.freeCount,
      texturesCreated: t.created,
      texturesDestroyed: t.destroyed,
      buffersCreated: b.created,
      buffersDestroyed: b.destroyed,
      textureLiveBytes: t.liveBytes,
      bufferLiveBytes: b.liveBytes,
      usedBytes: this.usedBytes,
      // created - destroyed must equal live + idle, otherwise a GPU object escaped the accounting
      textureBalance: t.created - t.destroyed - t.liveCount - t.freeCount,
      bufferBalance: b.created - b.destroyed - b.liveCount - b.freeCount,
    };
  }

  /** Device lost: every GPU object is gone. */
  reset(): void {
    this.textures.reset();
    this.buffers.reset();
    // CPU-side mesh arrays survive a device loss: they stay accounted.
    this.usedBytes = this.externalBytes;
    this.onChange.emit();
  }

  stats(): MemoryStats {
    return {
      budgetBytes: this.budgetBytes,
      usedBytes: this.usedBytes,
      peakBytes: this.peakBytes,
      textureLiveBytes: this.textures.liveBytes,
      textureIdleBytes: this.textures.freeBytes,
      bufferLiveBytes: this.buffers.liveBytes,
      bufferIdleBytes: this.buffers.freeBytes,
      textureHits: this.textures.hits,
      textureMisses: this.textures.misses,
      externalBytes: this.externalBytes,
      externalByCategory: Object.fromEntries(this.external),
    };
  }
}

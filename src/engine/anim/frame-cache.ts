/**
 * Bounded frame cache for smooth loop playback. PURE bookkeeping: the stored values and their byte cost are
 * supplied by the caller (the scheduler stores retained EvalResults), `dispose` releases them.
 *
 * Policy (documented decision): a loop is replayed in the same order forever, so LRU / FIFO would evict exactly the frame
 * that is needed next once the cache is smaller than the loop (the classic loop-thrash). Therefore we NEVER evict to make
 * room for a new frame: once full, new frames are simply not cached, and the cache keeps the first frames of the loop.
 * Entries are only evicted (a) when the signature (graph revision / targets / scale) changes, (b) under memory pressure
 * (`evictFor`: furthest from the playhead first), (c) when the byte budget shrinks.
 * Capacity is AUTO-SIZED from the memory budget by `autoCacheBytes` and can never be unbounded.
 */
export interface CacheStats {
  entries: number;
  bytes: number;
  maxBytes: number;
  maxEntries: number;
  hits: number;
  misses: number;
  rejected: number;
}

interface Entry<T> {
  value: T;
  bytes: number;
  frame: number;
}

export class FrameCache<T> {
  private map = new Map<string, Entry<T>>();
  private sig = '';
  bytes = 0;
  hits = 0;
  misses = 0;
  rejected = 0;
  /** Keys that must not be evicted (the frame currently on screen). */
  private pinned = new Set<string>();

  constructor(
    /** Current byte limit (evaluated lazily: the memory budget can change). */
    public maxBytesFn: () => number,
    public maxEntries: number,
    private dispose: (v: T) => void,
  ) {}

  get size(): number {
    return this.map.size;
  }
  get maxBytes(): number {
    return Math.max(0, this.maxBytesFn());
  }
  get signature(): string {
    return this.sig;
  }

  /** A different signature invalidates everything (graph edit, other targets, other preview scale). */
  setSignature(sig: string): void {
    if (sig === this.sig) return;
    this.sig = sig;
    this.clear();
  }

  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (e) this.hits++;
    else this.misses++;
    return e?.value;
  }
  pin(keys: Iterable<string>): void {
    this.pinned = new Set(keys);
  }

  /** Try to store a frame. Returns false (and does NOT take ownership) when the cache is full / too small. */
  put(key: string, frame: number, value: T, bytes: number): boolean {
    if (this.map.has(key)) return true;
    if (this.maxEntries <= 0 || this.map.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.rejected++;
      return false;
    }
    this.map.set(key, { value, bytes, frame });
    this.bytes += bytes;
    return true;
  }

  /** Free at least `need` bytes, furthest frame from `current` first (never pinned entries). Returns freed bytes. */
  evictFor(need: number, current: number): number {
    const order = [...this.map.entries()].filter(([k]) => !this.pinned.has(k)).sort((a, b) => Math.abs(b[1].frame - current) - Math.abs(a[1].frame - current));
    let freed = 0;
    for (const [k, e] of order) {
      if (freed >= need) break;
      this.drop(k, e);
      freed += e.bytes;
    }
    return freed;
  }

  /** Shrink to the (possibly reduced) byte limit. */
  enforce(current: number): void {
    const over = this.bytes - this.maxBytes;
    if (over > 0) this.evictFor(over, current);
    while (this.map.size > this.maxEntries) {
      if (this.evictFor(1, current) === 0) break;
    }
  }

  private drop(k: string, e: Entry<T>): void {
    this.map.delete(k);
    this.bytes -= e.bytes;
    this.dispose(e.value);
  }

  clear(): void {
    for (const [k, e] of [...this.map]) {
      if (this.pinned.has(k)) continue; // still on screen; released by its owner on the next result
      this.drop(k, e);
    }
    this.hits = 0;
    this.misses = 0;
    this.rejected = 0;
  }

  /** Forcefully empty (device lost / dispose). */
  clearAll(): void {
    this.pinned.clear();
    this.clear();
  }

  stats(): CacheStats {
    return { entries: this.map.size, bytes: this.bytes, maxBytes: this.maxBytes, maxEntries: this.maxEntries, hits: this.hits, misses: this.misses, rejected: this.rejected };
  }
}

/**
 * Auto size: at most `fraction` of the total budget AND at most half of what is currently free, never negative.
 * (Evaluated lazily so that heavy graphs automatically get a smaller cache.)
 */
export function autoCacheBytes(budgetBytes: number, usedBytes: number, fraction = 0.25): number {
  const free = Math.max(0, budgetBytes - usedBytes);
  return Math.max(0, Math.min(budgetBytes * fraction, free * 0.5));
}

/** How many frames of `frameBytes` fit; capped by the loop length. */
export const cacheCapacityFrames = (maxBytes: number, frameBytes: number, loopFrames: number): number => (frameBytes <= 0 ? 0 : Math.max(0, Math.min(loopFrames, Math.floor(maxBytes / frameBytes))));

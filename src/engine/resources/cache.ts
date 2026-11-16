import { exclusiveBytes, releaseValue, retainValue, type PinValue } from './values';

interface Entry {
  key: string;
  hash: number;
  value: PinValue;
  lastUsed: number;
}

/**
 * LRU cache of node outputs keyed by "<graphId>:<nodeId>:<pinId>" and validated by a version hash.
 * The cache holds ONE reference to every cached resource. Eviction releases that reference; a texture is only
 * really freed when no evaluation still uses it (ref-counting makes eviction always safe).
 * Bounded by maxBytes (exclusive bytes) and by memory pressure (MemoryManager evictor).
 */
export class OutputCache {
  private map = new Map<string, Entry>();
  private clock = 0;
  hits = 0;
  misses = 0;
  /** Keys that must not be evicted right now (used by the in-flight evaluation). */
  private pinned = new Set<string>();

  constructor(public maxBytes = Infinity) {}

  /** Returns the cached value when the hash matches; does NOT retain (caller retains if it keeps it). */
  get(key: string, hash: number): PinValue | undefined {
    const e = this.map.get(key);
    if (!e || e.hash !== hash) {
      this.misses++;
      return undefined;
    }
    e.lastUsed = ++this.clock;
    this.hits++;
    return e.value;
  }

  /** Peek without touching LRU / stats. */
  has(key: string, hash: number): boolean {
    return this.map.get(key)?.hash === hash;
  }

  set(key: string, hash: number, value: PinValue): void {
    const old = this.map.get(key);
    if (old) releaseValue(old.value);
    retainValue(value);
    this.map.set(key, { key, hash, value, lastUsed: ++this.clock });
    this.enforceLimit();
  }

  pin(keys: Iterable<string>): void {
    this.pinned = new Set(keys);
  }
  unpinAll(): void {
    this.pinned.clear();
  }

  get size(): number {
    return this.map.size;
  }

  /** Bytes that eviction of the whole cache would free right now. */
  get exclusiveBytes(): number {
    let b = 0;
    for (const e of this.map.values()) b += exclusiveBytes(e.value);
    return b;
  }

  /** Evict LRU entries until `needBytes` of exclusive memory were released (or nothing evictable is left). */
  evict(needBytes: number): number {
    const order = [...this.map.values()].filter((e) => !this.pinned.has(e.key)).sort((a, b) => a.lastUsed - b.lastUsed);
    let freed = 0;
    for (const e of order) {
      if (freed >= needBytes) break;
      freed += exclusiveBytes(e.value);
      this.delete(e.key);
    }
    return freed;
  }

  /** Evict LRU entries while the cache's exclusive memory exceeds maxBytes (call after references were released). */
  enforce(): void {
    this.enforceLimit();
  }

  private enforceLimit(): void {
    if (this.maxBytes === Infinity) return;
    const over = this.exclusiveBytes - this.maxBytes;
    if (over > 0) this.evict(over);
  }

  delete(key: string): void {
    const e = this.map.get(key);
    if (!e) return;
    this.map.delete(key);
    releaseValue(e.value);
  }

  /** Drop every entry whose key starts with the prefix (e.g. a removed node or graph). */
  deletePrefix(prefix: string): void {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.delete(k);
  }

  clear(): void {
    for (const k of [...this.map.keys()]) this.delete(k);
  }

  /** Device lost: values are dead; forget them without touching (invalid) GPU objects. */
  forgetAll(): void {
    this.map.clear();
    this.pinned.clear();
  }
}

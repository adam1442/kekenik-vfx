/**
 * SIMULATION FRAMEWORK — pure logic. No GPU, no DOM: everything here is unit-tested (tests/sim-core.test.ts).
 *
 * Model
 *  - A simulation advances by FRAMES. State S(k) = state after simulating frame k (S(-1) = state after reset + warm-up).
 *  - Frame k needs `substeps` fixed steps of dt = (1 / fps) * speed / substeps. Seeded randomness only => deterministic.
 *  - A snapshot of S(k) is BOTH the output frame cache entry and a restart point ("checkpoint"): snapshot == full state.
 *    Entries whose index is a multiple of K (and index -1) are PINNED checkpoints, the rest are LRU output frames.
 *
 * Cache / eviction policy (documented in docs/CONTRACTS.md section 16)
 *  1. `usedBytes <= budgetBytes` ALWAYS (a put that cannot fit is refused: the node reports "Over budget").
 *  2. Over budget => evict unpinned, unprotected frames, least recently used first.
 *  3. Still over => evict unpinned protected frames (loop-blend frames), highest index first.
 *  4. Still over => thin the checkpoints: K doubles and pinned entries that are not multiples of the new K are dropped.
 *  5. Baked caches are LOCKED: nothing is evicted or invalidated; a put that does not fit is refused.
 */

export type LoopMode = 'none' | 'crossfade' | 'periodic';
export const LOOP_MODES: LoopMode[] = ['none', 'crossfade', 'periodic'];

export interface SimTiming {
  fps: number;
  speed: number;
  substeps: number;
}

/** Fixed time step of ONE sub-step (seconds). Independent of frame rate of the UI and of interaction. */
export const stepDt = (t: SimTiming): number => (1 / Math.max(1e-6, t.fps)) * t.speed / Math.max(1, Math.floor(t.substeps));

/** Frame index the emitters / forces see while simulating frame `k` (periodic forcing wraps with the loop length). */
export const forcingFrame = (k: number, loopLength: number, mode: LoopMode): number =>
  mode === 'periodic' && loopLength > 0 ? ((k % loopLength) + loopLength) % loopLength : k;

/** Number of frames that have to be simulated for a loop (0..L+B-1 for Crossfade, 0..L-1 otherwise). */
export const totalSimFrames = (loopLength: number, blend: number, mode: LoopMode): number => loopLength + (mode === 'crossfade' ? clampBlend(blend, loopLength) : 0);

export const clampBlend = (blend: number, loopLength: number): number => Math.max(0, Math.min(Math.floor(blend), Math.floor(loopLength / 2) > 0 ? Math.floor(loopLength) : 0));

/**
 * Which simulated frames make output frame `f` and with which weight.
 * Crossfade with loop length L and blend length B: out(t) = lerp(sim(L+t), sim(t), t/B) for t < B, sim(t) for B <= t < L.
 * `a` is the frame at weight (1-w), `b` at weight w (w = 0 => pure `a`). Output frames wrap with L when the loop is on.
 */
export interface LoopPlan {
  a: number;
  b: number | null;
  w: number;
}
export function loopPlan(f: number, loopLength: number, blend: number, mode: LoopMode): LoopPlan {
  const fi = Math.max(0, Math.round(f));
  if (mode === 'none' || loopLength <= 0) return { a: fi, b: null, w: 0 };
  const t = fi % loopLength;
  const B = clampBlend(blend, loopLength);
  if (mode === 'crossfade' && B > 0 && t < B) return { a: loopLength + t, b: t, w: t / B };
  return { a: t, b: null, w: 0 };
}

/** Frames that must exist in the cache to show output frame `f`. */
export const requiredFrames = (p: LoopPlan): number[] => (p.b === null ? [p.a] : [p.a, p.b]);

/** Scalar field blend. */
export const blendScalar = (a: number, b: number, w: number): number => a + (b - a) * w;

/**
 * Vector blend: direction of the linear mix, magnitude mixed separately (a plain lerp of opposite vectors would shrink to 0
 * and flicker at the seam). Falls back to the plain mix when the mix is (near) zero.
 */
export function blendVector(ax: number, ay: number, bx: number, by: number, w: number): [number, number] {
  const mx = ax + (bx - ax) * w;
  const my = ay + (by - ay) * w;
  const ml = Math.hypot(mx, my);
  const mag = blendScalar(Math.hypot(ax, ay), Math.hypot(bx, by), w);
  if (ml < 1e-9) return [mx, my];
  return [(mx / ml) * mag, (my / ml) * mag];
}

/**
 * Checkpoint spacing K from the state size and the cache budget: at most HALF the budget goes to pinned checkpoints.
 * K = 1 means every frame is a checkpoint (instant random access).
 */
export function chooseCheckpointInterval(totalFrames: number, stateBytes: number, budgetBytes: number): number {
  if (stateBytes <= 0 || totalFrames <= 0) return 1;
  const slots = Math.max(1, Math.floor((budgetBytes * 0.5) / stateBytes));
  return Math.max(1, Math.ceil(totalFrames / slots));
}

/**
 * CFL-limited adaptive sub-steps. `maxSpeed` = max |v| in tile fractions / second, `cells` = grid cells along the longer side.
 * The advection distance per sub-step (in cells) must stay <= `cfl`.
 */
export function cflSubsteps(maxSpeed: number, cells: number, dtFrame: number, cfl: number, minSub: number, maxSub: number): number {
  const lo = Math.max(1, Math.floor(minSub));
  const hi = Math.max(lo, Math.floor(maxSub));
  if (!(maxSpeed > 0) || !isFinite(maxSpeed)) return lo;
  const need = Math.ceil((maxSpeed * cells * dtFrame) / Math.max(1e-3, cfl));
  return Math.min(hi, Math.max(lo, need));
}

/** Snap a simulation resolution to a multiple of 16 (>= 16) so the multigrid hierarchy has >= 3 levels. */
export const snapSimRes = (n: number, maxDim: number): number => Math.max(16, Math.min(Math.floor(maxDim / 16) * 16, Math.round(n / 16) * 16));

/** Largest simulation edge allowed by device limits and memory: `stateBytesPerCell` for state + temporaries. */
export function limitSimResolution(wanted: number, aspect: number, opts: { maxDim: number; budgetBytes: number; bytesPerCell: number; fraction?: number }): { w: number; h: number; limited: boolean } {
  const frac = opts.fraction ?? 0.35;
  let w = snapSimRes(wanted, opts.maxDim);
  let h = snapSimRes(wanted / Math.max(aspect, 1e-3), opts.maxDim);
  const cost = (): number => w * h * opts.bytesPerCell;
  let limited = false;
  while (cost() > opts.budgetBytes * frac && w > 16 && h > 16) {
    w = snapSimRes(w / 1.25, opts.maxDim);
    h = snapSimRes(h / 1.25, opts.maxDim);
    limited = true;
  }
  return { w, h, limited };
}

export interface CacheStats {
  usedBytes: number;
  budgetBytes: number;
  frames: number;
  pinned: number;
  interval: number;
  evictions: number;
  locked: boolean;
}

interface Entry<T> {
  k: number;
  payload: T;
  bytes: number;
  used: number;
  pinned: boolean;
}

/** Bounded snapshot store (see the policy at the top of this file). `T` is the payload (GPU textures in the runtime, numbers in tests). */
export class SimCache<T> {
  private map = new Map<number, Entry<T>>();
  private tick = 0;
  private K = 1;
  used = 0;
  evictions = 0;
  locked = false;
  /** Frames that should survive LRU eviction as long as possible (loop-blend frames 0..B-1). */
  protect: (k: number) => boolean = () => false;
  /** Frames that must not be evicted right now (the frame on screen). */
  hold = new Set<number>();

  constructor(
    public budgetBytes: number,
    private release: (p: T) => void = () => undefined,
  ) {}

  get interval(): number {
    return this.K;
  }
  get size(): number {
    return this.map.size;
  }

  /** Re-derive K for a new sequence (call after clear / config change). */
  configure(totalFrames: number, stateBytes: number): void {
    this.K = chooseCheckpointInterval(totalFrames, stateBytes, this.budgetBytes);
  }
  isCheckpoint(k: number): boolean {
    return k < 0 || k % this.K === 0;
  }
  has(k: number): boolean {
    return this.map.has(k);
  }
  get(k: number): T | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    e.used = ++this.tick;
    return e.payload;
  }
  peek(k: number): T | undefined {
    return this.map.get(k)?.payload;
  }
  keys(): number[] {
    return [...this.map.keys()].sort((a, b) => a - b);
  }
  /** Greatest cached index <= k (any entry is a full state => a restart point), or undefined. */
  nearestAtOrBefore(k: number): number | undefined {
    let best: number | undefined;
    for (const i of this.map.keys()) if (i <= k && (best === undefined || i > best)) best = i;
    return best;
  }

  /** Store a snapshot. Returns false when it cannot fit (the payload is NOT released: the caller still owns it). */
  put(k: number, payload: T, bytes: number): boolean {
    const old = this.map.get(k);
    if (old) {
      if (old.payload === payload) return true;
      this.drop(old);
    }
    if (bytes > this.budgetBytes) return false;
    const ent: Entry<T> = { k, payload, bytes, used: ++this.tick, pinned: this.isCheckpoint(k) };
    this.map.set(k, ent);
    this.used += bytes;
    this.enforce(k);
    if (!this.map.has(k)) return false; // evicted immediately (locked / nothing else to drop): refuse
    return true;
  }

  private drop(e: Entry<T>): void {
    this.map.delete(e.k);
    this.used -= e.bytes;
    this.release(e.payload);
  }

  private enforce(justAdded: number): void {
    if (this.used <= this.budgetBytes) return;
    if (this.locked) {
      // baked: never evict, refuse the newcomer instead
      const e = this.map.get(justAdded);
      if (e) {
        this.map.delete(e.k);
        this.used -= e.bytes; // payload stays with the caller
      }
      return;
    }
    const cand = (pred: (e: Entry<T>) => boolean): Entry<T>[] => [...this.map.values()].filter((e) => e.k !== justAdded && !this.hold.has(e.k) && pred(e));
    // 2. plain LRU frames
    for (const e of cand((x) => !x.pinned && !this.protect(x.k)).sort((a, b) => a.used - b.used)) {
      if (this.used <= this.budgetBytes) return;
      this.evictions++;
      this.drop(e);
    }
    // 3. protected frames, highest index first
    for (const e of cand((x) => !x.pinned).sort((a, b) => b.k - a.k)) {
      if (this.used <= this.budgetBytes) return;
      this.evictions++;
      this.drop(e);
    }
    // 4. thin checkpoints
    while (this.used > this.budgetBytes && this.K < 1 << 20) {
      this.K *= 2;
      for (const e of cand((x) => x.pinned && x.k >= 0 && x.k % this.K !== 0)) {
        this.evictions++;
        this.drop(e);
      }
      for (const e of [...this.map.values()]) if (e.k % this.K !== 0 && e.k >= 0) e.pinned = false;
      if (this.used <= this.budgetBytes) return;
      if (cand(() => true).length === 0) break;
    }
    // last resort: refuse the newcomer
    if (this.used > this.budgetBytes) {
      const e = this.map.get(justAdded);
      if (e) {
        this.map.delete(e.k);
        this.used -= e.bytes;
      }
    }
  }

  /** Memory pressure: free at least `bytes` by dropping unpinned frames (LRU first). Never touches pinned checkpoints or locked caches. */
  evictBytes(bytes: number): number {
    if (this.locked) return 0;
    let freed = 0;
    for (const e of [...this.map.values()].filter((x) => !x.pinned && !this.hold.has(x.k)).sort((a, b) => a.used - b.used)) {
      if (freed >= bytes) break;
      freed += e.bytes;
      this.evictions++;
      this.drop(e);
    }
    return freed;
  }

  /** Invalidate every entry with index >= k (index -1 = the initial state is kept when k >= 0). Ignored while locked. */
  invalidateFrom(k: number): void {
    if (this.locked) return;
    for (const e of [...this.map.values()]) if (e.k >= k) this.drop(e);
  }
  clear(force = false): void {
    if (this.locked && !force) return;
    for (const e of [...this.map.values()]) this.drop(e);
    this.map.clear();
    this.used = 0;
  }
  setBudget(bytes: number): void {
    this.budgetBytes = bytes;
    if (!this.locked) this.enforce(Number.NaN);
  }
  stats(): CacheStats {
    return { usedBytes: this.used, budgetBytes: this.budgetBytes, frames: this.map.size, pinned: [...this.map.values()].filter((e) => e.pinned).length, interval: this.K, evictions: this.evictions, locked: this.locked };
  }
}

/** First frame at which two animated-parameter signatures differ (for partial invalidation); 0 when static params changed. */
export function firstChangedFrame(oldKeys: ReadonlyMap<number, string>, newKeys: ReadonlyMap<number, string>): number {
  let first = Infinity;
  for (const [k, v] of newKeys) if (oldKeys.get(k) !== v) first = Math.min(first, k);
  for (const k of oldKeys.keys()) if (!newKeys.has(k)) first = Math.min(first, k);
  return first === Infinity ? -1 : first;
}

/**
 * Per-simulated-frame signature of the ANIMATED parameter values: key k (from -warmup to totalFrames-1) -> `sigAt(forcingFrame(k))`.
 * `sigAt` hashes the resolved values of the animated simulation params at one forcing frame (periodic forcing repeats frames).
 */
export function frameSignatures(sigAt: (forcing: number) => string, warmup: number, loopLength: number, blend: number, mode: LoopMode): Map<number, string> {
  const total = totalSimFrames(loopLength, blend, mode);
  const memo = new Map<number, string>();
  const out = new Map<number, string>();
  for (let k = -Math.max(0, Math.floor(warmup)); k < total; k++) {
    const f = forcingFrame(k, loopLength, mode);
    let s = memo.get(f);
    if (s === undefined) {
      s = sigAt(f);
      memo.set(f, s);
    }
    out.set(k, s);
  }
  return out;
}

/** What a changed key invalidates: nothing (same values at every frame), frames >= `frame`, or everything. */
export type InvalidationPlan = { kind: 'none' } | { kind: 'from'; frame: number } | { kind: 'full' };

/**
 * Partial invalidation for animated params: S(k) depends only on frames <= k, so a keyframe edit that first changes the values at
 * frame f leaves S(-1..f-1) valid. A change inside the warm-up (k < 0) or a different frame layout invalidates everything.
 */
export function planInvalidation(oldSigs: ReadonlyMap<number, string> | null | undefined, newSigs: ReadonlyMap<number, string> | null | undefined): InvalidationPlan {
  if (!oldSigs || !newSigs || oldSigs.size !== newSigs.size) return { kind: 'full' };
  let first = Infinity; // not firstChangedFrame(): its -1 means "none" and k = -1 (last warm-up frame) is a valid index here
  for (const [k, v] of newSigs) if (oldSigs.get(k) !== v) first = Math.min(first, k);
  for (const k of oldSigs.keys()) if (!newSigs.has(k)) first = Math.min(first, k);
  if (first === Infinity) return { kind: 'none' };
  return first < 0 ? { kind: 'full' } : { kind: 'from', frame: first };
}

/** Loop seam error: mean absolute difference between the last and first output frame (arrays of equal length). */
export function seamError(last: ArrayLike<number>, first: ArrayLike<number>): number {
  const n = Math.min(last.length, first.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(last[i] - first[i]);
  return s / n;
}

export type SimStatus = 'idle' | 'simulating' | 'baked' | 'over-budget' | 'error' | 'paused';

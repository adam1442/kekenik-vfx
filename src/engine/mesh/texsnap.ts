import type { GpuContext } from '../gpu/device';
import type { GpuTexture, MemoryManager } from '../resources/memory';
import { readTextureFloat32 } from '../resources/readback';
import { consoleBus } from '../../shared/log';

/* ------------------------------------------------------------------------------------------------
 * CPU TEXTURE SNAPSHOTS.
 * Mesh operations are CPU TypedArray loops and `evaluate()` is synchronous, but several mesh nodes (Combine Color, Noise mask,
 * Space Warp displace, Bake) must SAMPLE a graph texture at mesh UVs. Texture contents only exist on the GPU, and a readback is
 * async, so the contract is:
 *   1. `ctx.cpuTexture(pin)` returns the snapshot if one is ready, else null and REQUESTS one (texture retained).
 *   2. The evaluator calls `flush()` after it submitted the batch; the readback (mapAsync, never blocking) fills the cache.
 *   3. When a snapshot becomes ready `onReady` fires (the scheduler invalidates) and the plan hash of every node that
 *      declared `cpuTextureInputs` changes (it contains `has(key)`), so the node re-runs with real data.
 * Snapshots are small by design (<= MAX_DIM per axis after a box downsample) and live in a byte-capped LRU.
 * ---------------------------------------------------------------------------------------------- */

export interface CpuTexture {
  width: number;
  height: number;
  /** 1 gray, 2 uv, 3 rgb, 4 rgba. */
  channels: number;
  data: Float32Array;
}

export const SNAPSHOT_MAX_DIM = 512;
const CACHE_BYTES = 64 * 1024 * 1024;

/** Box-downsample so that max(width,height) <= maxDim (integer factors). */
export function downsample(t: CpuTexture, maxDim = SNAPSHOT_MAX_DIM): CpuTexture {
  const f = Math.ceil(Math.max(t.width, t.height) / maxDim);
  if (f <= 1) return t;
  const w = Math.max(1, Math.floor(t.width / f));
  const h = Math.max(1, Math.floor(t.height / f));
  const c = t.channels;
  const out = new Float32Array(w * h * c);
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let k = 0; k < c; k++) {
        let s = 0;
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += t.data[((y * f + j) * t.width + (x * f + i)) * c + k];
        out[(y * w + x) * c + k] = s * inv;
      }
    }
  }
  return { width: w, height: h, channels: c, data: out };
}

/**
 * Bilinear RGBA sample at mesh UV (u, v) with v UP (graph textures are y-down: y = 1 - v). Wrapping repeats, else clamps.
 * Gray -> (g,g,g,1); 2 channels -> (r,g,0,1); 3 -> (r,g,b,1).
 */
export function sampleTex(t: CpuTexture, u: number, v: number, wrap: boolean, out: ArrayLike<number> & { [i: number]: number }): void {
  const w = t.width, h = t.height, c = t.channels, d = t.data;
  const x = u * w - 0.5;
  const y = (1 - v) * h - 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const ix = (i: number): number => (wrap ? ((i % w) + w) % w : Math.min(w - 1, Math.max(0, i)));
  const iy = (j: number): number => (wrap ? ((j % h) + h) % h : Math.min(h - 1, Math.max(0, j)));
  const xa = ix(x0), xb = ix(x0 + 1), ya = iy(y0), yb = iy(y0 + 1);
  const px = [0, 0, 0, 1];
  for (let k = 0; k < 4; k++) {
    const kk = c === 1 ? 0 : k;
    if (k >= c && c !== 1) {
      px[k] = k === 3 ? 1 : 0;
      continue;
    }
    if (c === 1 && k === 3) {
      px[k] = 1;
      continue;
    }
    const a = d[(ya * w + xa) * c + kk], b = d[(ya * w + xb) * c + kk], e = d[(yb * w + xa) * c + kk], f = d[(yb * w + xb) * c + kk];
    px[k] = (a + (b - a) * fx) * (1 - fy) + (e + (f - e) * fx) * fy;
  }
  out[0] = px[0];
  out[1] = px[1];
  out[2] = px[2];
  out[3] = px[3];
}

/** Scalar read: channel 0..3 or 4 = luminance. */
export function sampleChannel(t: CpuTexture, u: number, v: number, channel: number, wrap = true): number {
  const o = [0, 0, 0, 1];
  sampleTex(t, u, v, wrap, o);
  return channel === 4 ? 0.2126 * o[0] + 0.7152 * o[1] + 0.0722 * o[2] : o[Math.min(3, Math.max(0, channel))];
}

class TexSnapshots {
  private map = new Map<string, CpuTexture>();
  private bytes = 0;
  private pending = new Map<string, GpuTexture>();
  private inflight = 0;
  private idleWaiters: (() => void)[] = [];
  /** Fired when at least one new snapshot was stored (wire to the scheduler). */
  onReady: (() => void) | null = null;

  has(key: string): boolean {
    return this.map.has(key);
  }
  get(key: string): CpuTexture | null {
    const v = this.map.get(key);
    if (!v) return null;
    this.map.delete(key); // LRU touch
    this.map.set(key, v);
    return v;
  }
  /** Store directly (tests / CPU-only producers). */
  put(key: string, t: CpuTexture): void {
    const old = this.map.get(key);
    if (old) this.bytes -= old.data.byteLength;
    this.map.set(key, t);
    this.bytes += t.data.byteLength;
    while (this.bytes > CACHE_BYTES && this.map.size > 1) {
      const k = this.map.keys().next().value as string;
      this.bytes -= this.map.get(k)!.data.byteLength;
      this.map.delete(k);
    }
  }
  /** Ask for a snapshot of `tex` (retained until read). No-op when already cached / pending. */
  request(key: string, tex: GpuTexture): void {
    if (this.map.has(key) || this.pending.has(key)) return;
    this.pending.set(key, tex.retain());
  }
  /** Start the readbacks of everything requested. Call AFTER the commands that produce the textures were submitted. */
  flush(gpu: GpuContext, mm: MemoryManager | null): void {
    if (!this.pending.size) return;
    const jobs = [...this.pending.entries()];
    this.pending.clear();
    for (const [key, tex] of jobs) {
      this.inflight++;
      void (async () => {
        try {
          const data = await readTextureFloat32(gpu, mm, tex.texture, tex.format, tex.width, tex.height);
          const channels = Math.max(1, Math.round(data.length / (tex.width * tex.height)));
          this.put(key, downsample({ width: tex.width, height: tex.height, channels, data }));
          this.onReady?.();
        } catch (e) {
          consoleBus.warn(`Mesh texture snapshot failed: ${(e as Error).message}`, { source: 'gpu' });
        } finally {
          tex.release();
          if (--this.inflight === 0 && !this.pending.size) for (const w of this.idleWaiters.splice(0)) w();
        }
      })();
    }
  }
  /** Resolves when no readback is pending or running (Gallery thumbnails / tests). */
  whenIdle(): Promise<void> {
    if (this.inflight === 0 && !this.pending.size) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }
  /** Drop everything (device lost / tests). */
  clear(): void {
    this.map.clear();
    this.bytes = 0;
    for (const t of this.pending.values()) t.release();
    this.pending.clear();
  }
  get size(): number {
    return this.map.size;
  }
}

export const texSnaps = new TexSnapshots();

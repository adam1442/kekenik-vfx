import type { ComputeBinding } from '../../engine/gpu/passes';
import type { EvalContext } from '../../engine/graph/node';
import type { GpuTexture, PooledBuffer } from '../../engine/resources/memory';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout } from '../../engine/shaders/uniforms';
import { halfToFloat } from '../../engine/resources/half';
import cclSrc from './island_ccl.wgsl?raw';
import labelsSrc from './island_labels.wgsl?raw';
import mapsSrc from './island_maps.wgsl?raw';
import statsSrc from './island_stats.wgsl?raw';

/**
 * ISLAND DATA FORMAT
 *
 *  - Island Map (Color pin, rgba16float / rgba32float in HQ): rgba = (bbox min x, bbox min y, bbox width, bbox height) in UV
 *    units. Every pixel of an island holds the same value; width = height = 0 marks background. bbox min may be < 0 or > 1 for
 *    an island that wraps over the seam of a tiling graph. Local position of a pixel: island_local() in island.wgsl.
 *  - Island ID: islandHash() / island_hash() of the four Island Map values (+ seed) -> uniform random in [0,1). Identical
 *    on CPU, in every Islands node and in the `ID` output.
 *  - Labels (Color pin, exact): (xhi, xlo, yhi, ylo) of the island's ROOT = first pixel of the island in raster order
 *    (x = xhi * 1024 + xlo), -1 on background. Two pixels are in the same island iff their labels are equal. Use this
 *    (not the hash) when an exact partition matters (mesh pivots per island, readback grouping).
 *  - Centre output: UV field (absolute convention) holding the centre of mass of the island.
 *  - Size output: Gray, island pixel count / image pixels / `Size reference`, clamped to 0..1.
 */
export const CCL_SHADER = defineShader('islands_ccl.wgsl', cclSrc);
export const LABELS_SHADER = defineShader('islands_labels.wgsl', labelsSrc);
export const STATS_SHADER = defineShader('islands_stats.wgsl', statsSrc);
export const MAPS_SHADER = defineShader('islands_maps.wgsl', mapsSrc);
export const CCL_LAYOUT = makeLayout([
  { name: 'w', type: 'u32' },
  { name: 'h', type: 'u32' },
  { name: 'conn', type: 'u32' },
  { name: 'tile_x', type: 'u32' },
  { name: 'tile_y', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'threshold', type: 'f32' },
  { name: 'pad', type: 'u32' },
]);
export const STATS_LAYOUT = makeLayout([
  { name: 'w', type: 'u32' },
  { name: 'h', type: 'u32' },
  { name: 'cap_mask', type: 'u32' },
  { name: 'tile_x', type: 'u32' },
  { name: 'tile_y', type: 'u32' },
  { name: 'pad0', type: 'u32' },
  { name: 'pad1', type: 'u32' },
  { name: 'pad2', type: 'u32' },
]);
export const MAPS_LAYOUT = makeLayout([
  { name: 'cap_mask', type: 'u32' },
  { name: 'which', type: 'u32' },
  { name: 'seed', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
  { name: 'size_ref', type: 'f32' },
]);
export const STRIDE = 12;
export const MAX_PROBES = 64;
export const MAX_ISLAND_OPTIONS = [16384, 65536, 262144];

/** Hash table slots for `maxIslands` islands: power of two >= 2 x maxIslands (load factor <= 50%). */
export const islandSlots = (maxIslands: number): number => 2 ** Math.ceil(Math.log2(Math.max(2 * maxIslands, 64)));

/**
 * Hook + compress rounds of the union-find labelling for an image (measured on adversarial shapes in tests/islands.test.ts with
 * `cclModel`: serpentine / spiral / noise masks need 2-5 rounds, so log2(side) + 4 leaves a wide margin). Bounded: never more than 64 rounds.
 */
export function autoIterations(w: number, h: number): number {
  return Math.min(64, 4 + Math.ceil(Math.log2(Math.max(w, h, 2))));
}

/** Largest image the label buffer (4 bytes / pixel) can bind: device maxStorageBufferBindingSize. */
export function checkLabelBuffer(ctx: EvalContext, w: number, h: number): void {
  const lim = ctx.gpu.device.limits.maxStorageBufferBindingSize;
  if (w * h * 4 > lim) throw new Error(`Islands: ${w}x${h} needs a ${(w * h * 4) / 1048576} MB label buffer; the device limit is ${lim / 1048576} MB. Use a smaller Size on this node.`);
}

/**
 * Connected components on the GPU: union-find in compute shaders (hook = atomicMin of the larger root onto the smaller one over
 * every neighbour pair, compress = path compression), `rounds` times, then one fragment pass that packs the root coordinate
 * of every pixel into the exact label texture (xhi, xlo, yhi, ylo). The label of an island is its FIRST pixel in raster order.
 * Returns the label texture (ownership: the caller / node).
 */
export function recordLabels(ctx: EvalContext, src: GpuTexture, o: { threshold: number; invert: boolean; eight: boolean; rounds: number }): GpuTexture {
  const W = ctx.frame.width;
  const H = ctx.frame.height;
  checkLabelBuffer(ctx, W, H);
  const parent = ctx.buffer(W * H * 4);
  const u = ctx.uniformBinding(CCL_LAYOUT, { w: W, h: H, conn: o.eight ? 1 : 0, tile_x: ctx.frame.tileX, tile_y: ctx.frame.tileY, invert: o.invert, threshold: o.threshold, pad: 0 });
  const bindings = (): ComputeBinding[] => [u, { kind: 'texture', tex: src }, { kind: 'storage', buffer: parent.buffer }];
  const wg: [number, number] = [Math.ceil(W / 8), Math.ceil(H / 8)];
  ctx.compute({ label: 'islands ccl init', shader: CCL_SHADER, entry: 'init', bindings: bindings(), workgroups: wg });
  for (let i = 0; i < o.rounds; i++) {
    ctx.compute({ label: `islands hook ${i + 1}`, shader: CCL_SHADER, entry: 'hook', bindings: bindings(), workgroups: wg });
    ctx.compute({ label: `islands compress ${i + 1}`, shader: CCL_SHADER, entry: 'compress', bindings: bindings(), workgroups: wg });
  }
  const labels = ctx.tex('color');
  ctx.pass({ label: 'islands labels', target: labels, shader: LABELS_SHADER, textures: [], storageBuffers: [parent.buffer], ss: 1 });
  return labels;
}

/** Record the stats compute passes; returns the decoded f32 table (`s0` of MAPS_SHADER). */
export function recordStats(ctx: EvalContext, labels: GpuTexture, slots: number): PooledBuffer {
  const acc = ctx.buffer(slots * STRIDE * 4);
  const dec = ctx.buffer(slots * STRIDE * 4);
  const u = ctx.uniformBinding(STATS_LAYOUT, { w: labels.width, h: labels.height, cap_mask: slots - 1, tile_x: ctx.frame.tileX, tile_y: ctx.frame.tileY, pad0: 0, pad1: 0, pad2: 0 });
  const bindings = (): ComputeBinding[] => [u, { kind: 'texture', tex: labels }, { kind: 'storage', buffer: acc.buffer }, { kind: 'storage', buffer: dec.buffer }];
  const groups = Math.ceil(slots / 64);
  ctx.compute({ label: 'islands stats init', shader: STATS_SHADER, entry: 'init', bindings: bindings(), workgroups: [groups] });
  ctx.compute({ label: 'islands stats accumulate', shader: STATS_SHADER, entry: 'accumulate', bindings: bindings(), workgroups: [Math.ceil(labels.width / 8), Math.ceil(labels.height / 8)] });
  ctx.compute({ label: 'islands stats finalize', shader: STATS_SHADER, entry: 'finalize', bindings: bindings(), workgroups: [groups] });
  return dec;
}

/* ================================================================================================ CPU references */

export interface IslandLabels {
  /** Root index (y * w + x of the island's first pixel in raster order) per pixel, -1 on background. */
  labels: Int32Array;
  count: number;
}

/** Exact connected components by union-find (4 / 8 connectivity, wrap on tiling axes). Root = smallest raster index. */
export function labelIslands(mask: ArrayLike<number>, w: number, h: number, o: { tileX?: boolean; tileY?: boolean; eight?: boolean } = {}): IslandLabels {
  const parent = new Int32Array(w * h).map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  const on = (x: number, y: number): boolean => mask[y * w + x] > 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          if ((i === 0 && j === 0) || (!o.eight && i !== 0 && j !== 0)) continue;
          let nx = x + i;
          let ny = y + j;
          if (nx < 0 || nx >= w) {
            if (!o.tileX) continue;
            nx = (nx + w) % w;
          }
          if (ny < 0 || ny >= h) {
            if (!o.tileY) continue;
            ny = (ny + h) % h;
          }
          if (on(nx, ny)) union(y * w + x, ny * w + nx);
        }
    }
  const labels = new Int32Array(w * h).fill(-1);
  const roots = new Set<number>();
  for (let i = 0; i < w * h; i++)
    if (mask[i] > 0) {
      labels[i] = find(i);
      roots.add(labels[i]);
    }
  return { labels, count: roots.size };
}

/**
 * CPU model of the GPU union-find (island_ccl.wgsl) under a PESSIMISTIC schedule: in every hook pass all `find`s read the state
 * from the start of the pass and all atomicMins are applied afterwards (a real GPU interleaves them, which only helps).
 * Returns the labels (root index, -1 background) after `rounds` hook + compress rounds, and the number of rounds after which a
 * hook pass changed nothing (-1 when not converged).
 */
export function cclModel(mask: ArrayLike<number>, w: number, h: number, rounds: number, o: { tileX?: boolean; tileY?: boolean; eight?: boolean } = {}): { labels: Int32Array; converged: number } {
  const n = w * h;
  let parent = new Int32Array(n).map((_, i) => (mask[i] > 0 ? i : -1));
  const find = (par: Int32Array, i: number): number => {
    let x = i;
    for (let s = 0; s < 64; s++) {
      const p = par[x];
      if (p === x) break;
      x = p;
    }
    return x;
  };
  let converged = -1;
  for (let r = 1; r <= rounds; r++) {
    const snap = parent;
    const next = Int32Array.from(parent);
    let hooked = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (snap[i] < 0) continue;
        let ra = find(snap, i);
        for (let j = -1; j <= 1; j++)
          for (let k = -1; k <= 1; k++) {
            if ((j === 0 && k === 0) || (!o.eight && j !== 0 && k !== 0)) continue;
            let nx = x + k;
            let ny = y + j;
            if (nx < 0 || nx >= w) {
              if (!o.tileX) continue;
              nx = (nx + w) % w;
            }
            if (ny < 0 || ny >= h) {
              if (!o.tileY) continue;
              ny = (ny + h) % h;
            }
            const ni = ny * w + nx;
            if (snap[ni] < 0) continue;
            const rb = find(snap, ni);
            if (ra !== rb) {
              const hi = Math.max(ra, rb);
              const lo = Math.min(ra, rb);
              if (lo < next[hi]) {
                next[hi] = lo;
                hooked = true;
              }
              if (hi === ra) ra = lo;
            }
          }
      }
    const comp = Int32Array.from(next);
    for (let i = 0; i < n; i++) if (next[i] >= 0) comp[i] = find(next, i);
    parent = comp;
    if (!hooked) {
      converged = r - 1;
      break;
    }
  }
  return { labels: parent, converged };
}

export interface IslandStat {
  root: number;
  count: number;
  /** Bounding box (pixels) as the shader computes it: root + min / max offset (wrapped relative to the root). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Centre of mass in pixels (root-relative, not wrapped). */
  cx: number;
  cy: number;
}

/** Per-island statistics exactly like island_stats.wgsl (offsets relative to the root, minimum image on tiling axes). */
export function islandStats(lab: Int32Array, w: number, h: number, o: { tileX?: boolean; tileY?: boolean } = {}): Map<number, IslandStat> {
  const out = new Map<number, IslandStat>();
  for (let i = 0; i < w * h; i++) {
    const r = lab[i];
    if (r < 0) continue;
    const rx = r % w;
    const ry = Math.floor(r / w);
    let dx = (i % w) - rx;
    let dy = Math.floor(i / w) - ry;
    if (o.tileX) dx = dx * 2 > w ? dx - w : dx * 2 < -w ? dx + w : dx;
    if (o.tileY) dy = dy * 2 > h ? dy - h : dy * 2 < -h ? dy + h : dy;
    let s = out.get(r);
    if (!s) {
      s = { root: r, count: 0, minX: rx + dx, minY: ry + dy, maxX: rx + dx, maxY: ry + dy, cx: 0, cy: 0 };
      out.set(r, s);
    }
    s.count++;
    s.minX = Math.min(s.minX, rx + dx);
    s.maxX = Math.max(s.maxX, rx + dx);
    s.minY = Math.min(s.minY, ry + dy);
    s.maxY = Math.max(s.maxY, ry + dy);
    s.cx += rx + dx;
    s.cy += ry + dy;
  }
  for (const s of out.values()) {
    s.cx /= s.count;
    s.cy /= s.count;
  }
  return out;
}

/** Island Map value (UV units) for a stat, as float32 (before the half-float rounding of the texture). */
export const islandMapValue = (s: IslandStat, w: number, h: number): [number, number, number, number] => [s.minX / w, s.minY / h, (s.maxX - s.minX + 1) / w, (s.maxY - s.minY + 1) / h];

/* ---- hashing (CPU mirror of island.wgsl: pcg, u01, island_hash) ---- */
export function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}
const f32bits = (() => {
  const f = new Float32Array(1);
  const u = new Uint32Array(f.buffer);
  return (x: number): number => {
    f[0] = x;
    return u[0];
  };
})();
/** island_hash(): the four values must be the half-float-rounded numbers that the shader reads (use `fromHalf`). */
export function islandHash(m: ArrayLike<number>, seed = 0): number {
  const a = f32bits(m[0]);
  const b = f32bits(m[1]);
  const c = f32bits(m[2]);
  const d = f32bits(m[3]);
  return pcg((a ^ pcg((b + pcg((c ^ pcg((d + seed) >>> 0)) >>> 0)) >>> 0)) >>> 0);
}
export const islandRand = (m: ArrayLike<number>, seed = 0): number => (islandHash(m, seed) >>> 8) / 16777216;
/** Round a float32 to half precision and back (what an rgba16float texture stores). */
export function fromHalf(x: number): number {
  const f = new Float32Array(1);
  f[0] = x;
  const u = new Uint32Array(f.buffer)[0];
  const sign = (u >>> 16) & 0x8000;
  const e = ((u >>> 23) & 0xff) - 127 + 15;
  let m = u & 0x7fffff;
  let bits: number;
  if (e <= 0) {
    if (e < -10) bits = sign;
    else {
      m = (m | 0x800000) >> (1 - e);
      bits = sign | ((m + 0x1000) >> 13);
    }
  } else if (e >= 31) bits = sign | 0x7c00;
  else {
    bits = sign | (e << 10) | (m >> 13);
    if (m & 0x1000) bits++; // round to nearest (ties up; good enough for a mirror)
  }
  return halfToFloat(bits);
}
/** Local position (0..1) of a pixel centre uv inside an Island Map value (CPU mirror of island_local). */
export function islandLocal(m: ArrayLike<number>, uv: [number, number], tileX: boolean, tileY: boolean): [number, number] {
  let dx = uv[0] - m[0];
  let dy = uv[1] - m[1];
  if (tileX) dx -= Math.floor(dx);
  if (tileY) dy -= Math.floor(dy);
  const c = (v: number): number => Math.min(Math.max(v, 0), 1);
  return [c(dx / Math.max(m[2], 1e-6)), c(dy / Math.max(m[3], 1e-6))];
}

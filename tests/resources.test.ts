import { describe, expect, it } from 'vitest';
import { OutputCache } from '../src/engine/resources/cache';
import { floatToHalf, halfToFloat } from '../src/engine/resources/half';
import { AllocationTooLargeError, OutOfBudgetError } from '../src/engine/resources/memory';
import { textureValue } from '../src/engine/resources/values';
import { bytesPerPixel, formatForPin } from '../src/engine/resources/format';
import { pickTileSize, planTiles } from '../src/engine/resources/tiles';
import { consoleBus } from '../src/shared/log';
import { mockMemory } from './helpers';

const RGBA16 = { width: 256, height: 256, format: 'rgba16float' as const };
const BYTES = 256 * 256 * 8;

describe('TexturePool / MemoryManager accounting', () => {
  it('counts bytes exactly and reuses released textures', () => {
    const { mm, stats } = mockMemory();
    const a = mm.textures.acquire(RGBA16);
    expect(mm.usedBytes).toBe(BYTES);
    expect(mm.textures.liveBytes).toBe(BYTES);
    a.release();
    expect(mm.textures.liveBytes).toBe(0);
    expect(mm.textures.freeBytes).toBe(BYTES);
    expect(mm.usedBytes).toBe(BYTES); // idle pooled memory still counts
    const b = mm.textures.acquire(RGBA16);
    expect(stats.createdTextures).toBe(1);
    expect(mm.textures.hits).toBe(1);
    b.release();
    expect(mm.textures.trim()).toBe(BYTES);
    expect(mm.usedBytes).toBe(0);
    expect(stats.destroyedTextures).toBe(1);
  });
  it('ref counting: texture returns to the pool only after the last release', () => {
    const { mm } = mockMemory();
    const t = mm.textures.acquire(RGBA16);
    t.retain();
    t.release();
    expect(mm.textures.liveBytes).toBe(BYTES);
    t.release();
    expect(mm.textures.liveBytes).toBe(0);
    const before = consoleBus.entries.length;
    t.release(); // double free is reported, not thrown
    expect(consoleBus.entries.length).toBe(before + 1);
    expect(() => t.retain()).toThrow(/use-after-free/);
  });
  it('trims idle textures before refusing an allocation', () => {
    const { mm, stats } = mockMemory(BYTES * 2 + 100);
    const a = mm.textures.acquire(RGBA16);
    const b = mm.textures.acquire(RGBA16);
    a.release();
    // different size -> cannot reuse 'a', must trim it to fit
    const c = mm.textures.acquire({ width: 256, height: 255, format: 'rgba16float' });
    expect(stats.destroyedTextures).toBe(1);
    expect(mm.usedBytes).toBeLessThanOrEqual(mm.budgetBytes);
    b.release();
    c.release();
  });
  it('asks evictors (the cache) for memory, then throws OutOfBudgetError gracefully', () => {
    const { mm } = mockMemory(BYTES * 2 + 100);
    const cache = new OutputCache();
    mm.registerEvictor((n) => void cache.evict(n));
    const t1 = mm.textures.acquire(RGBA16);
    cache.set('k1', 1, textureValue(t1, 'color'));
    t1.release(); // cache is now the only holder
    const t2 = mm.textures.acquire(RGBA16);
    // third allocation: must evict k1 (LRU) to fit
    const t3 = mm.textures.acquire({ width: 256, height: 254, format: 'rgba16float' });
    expect(cache.size).toBe(0);
    // nothing evictable now: held by evaluators
    expect(() => mm.textures.acquire({ width: 300, height: 300, format: 'rgba16float' })).toThrow(OutOfBudgetError);
    t2.release();
    t3.release();
  });
  it('enforces hard caps', () => {
    const { mm } = mockMemory();
    expect(() => mm.textures.acquire({ width: 5000, height: 10, format: 'r16float' })).toThrow(AllocationTooLargeError);
    expect(() => mm.textures.acquire({ width: 0, height: 10, format: 'r16float' })).toThrow(AllocationTooLargeError);
    const small = mockMemory(1000);
    expect(() => small.mm.textures.acquire(RGBA16)).toThrow(AllocationTooLargeError);
  });
  it('device-lost reset forgets everything without touching dead objects', () => {
    const { mm, stats } = mockMemory();
    const t = mm.textures.acquire(RGBA16);
    mm.reset();
    expect(mm.usedBytes).toBe(0);
    t.release(); // stale generation: ignored
    expect(stats.destroyedTextures).toBe(0);
    expect(mm.textures.freeBytes).toBe(0);
  });
});

describe('OutputCache (LRU, ref-counted, hash-validated)', () => {
  it('hits only on matching hash and evicts least recently used first', () => {
    const { mm } = mockMemory();
    const cache = new OutputCache();
    const mk = () => textureValue(mm.textures.acquire(RGBA16), 'color');
    const [a, b, c] = [mk(), mk(), mk()];
    cache.set('a', 1, a);
    cache.set('b', 1, b);
    cache.set('c', 1, c);
    for (const v of [a, b, c]) v.tex.release(); // cache = sole owner
    expect(cache.get('a', 2)).toBeUndefined();
    expect(cache.get('a', 1)).toBe(a); // touch a -> b is now LRU
    cache.evict(BYTES);
    expect(cache.has('b', 1)).toBe(false);
    expect(cache.has('a', 1) && cache.has('c', 1)).toBe(true);
    cache.pin(['a']);
    cache.evict(Infinity);
    expect(cache.has('a', 1)).toBe(true); // pinned survives
    cache.unpinAll();
    cache.clear();
    expect(mm.textures.liveBytes).toBe(0);
  });
  it('does not count shared textures as freeable', () => {
    const { mm } = mockMemory();
    const cache = new OutputCache();
    const v = textureValue(mm.textures.acquire(RGBA16), 'color'); // still referenced by the "evaluator"
    cache.set('x', 1, v);
    expect(cache.exclusiveBytes).toBe(0);
    v.tex.release();
    expect(cache.exclusiveBytes).toBe(BYTES);
    cache.clear();
  });
  it('enforces maxBytes', () => {
    const { mm } = mockMemory();
    const cache = new OutputCache(BYTES);
    for (let i = 0; i < 3; i++) {
      const v = textureValue(mm.textures.acquire(RGBA16), 'color');
      cache.set(`k${i}`, 1, v);
      v.tex.release();
    }
    cache.enforce(); // evaluators released their references -> the cache is now over its limit
    expect(cache.size).toBe(1);
    expect(cache.has('k2', 1)).toBe(true);
  });
});

describe('formats, half floats, tiles', () => {
  it('maps pin types to intermediate formats', () => {
    expect(formatForPin('gray', false)).toBe('r16float');
    expect(formatForPin('uv', false)).toBe('rg16float');
    expect(formatForPin('normal', false)).toBe('rgba16float');
    expect(formatForPin('color', true)).toBe('rgba32float');
    expect(bytesPerPixel('rgba16float')).toBe(8);
  });
  it('round-trips half floats', () => {
    for (const v of [0, 1, -1, 0.5, 0.25, 65504, 1e-4, 3.140625]) {
      const back = halfToFloat(floatToHalf(v));
      expect(Math.abs(back - v)).toBeLessThanOrEqual(Math.abs(v) * 1e-3 + 1e-7);
    }
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
  });
  it('plans tiles covering the image exactly, with halo', () => {
    const tiles = planTiles(1000, 700, 256, 8);
    expect(tiles).toHaveLength(4 * 3);
    expect(tiles.reduce((a, t) => a + t.w * t.h, 0)).toBe(1000 * 700);
    const last = tiles[tiles.length - 1];
    expect(last).toMatchObject({ x: 768, y: 512, w: 232, h: 188, px: 760, pw: 248 });
    const count = new Uint8Array(1000 * 700);
    for (const t of tiles) for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) count[y * 1000 + x]++;
    expect(count.every((c) => c === 1)).toBe(true); // full coverage, no overlap
  });
  it('picks bounded power-of-two tile sizes', () => {
    const s = pickTileSize(16384, 16384, 256 * 1024 * 1024, 8, 6, 8192, 16);
    expect(s & (s - 1)).toBe(0);
    expect((s + 32) * (s + 32) * 8 * 6).toBeLessThanOrEqual(256 * 1024 * 1024);
    expect(pickTileSize(100, 100, 1e12, 8, 6, 8192)).toBe(64);
  });
});

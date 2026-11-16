import { beforeAll, describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import type { NodeRegistry } from '../src/engine/graph/registry';
import { OutputCache } from '../src/engine/resources/cache';
import { AllocationTooLargeError, OutOfBudgetError } from '../src/engine/resources/memory';
import { textureValue } from '../src/engine/resources/values';
import { makeRegistry, mockMemory } from './helpers';

/**
 * CPU-side stress / leak tests (the GPU variants live in the in-app self-test: src/selftest/stress.ts).
 * They run the REAL MemoryManager / pools / cache against a mocked device.
 */
let reg: NodeRegistry;
beforeAll(() => {
  reg = makeRegistry();
});
const RGBA16 = (w: number, h = w) => ({ width: w, height: h, format: 'rgba16float' as const });

describe('pool leak detection', () => {
  it('50k acquire / release cycles with mixed sizes return to the baseline and keep the books balanced', () => {
    const { mm } = mockMemory(256 * 1024 * 1024);
    const sizes = [64, 128, 256, 512, 1024];
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    const live: ReturnType<typeof mm.textures.acquire>[] = [];
    for (let i = 0; i < 50_000; i++) {
      if (live.length < 24 && rnd() < 0.55) live.push(mm.textures.acquire(RGBA16(sizes[Math.floor(rnd() * sizes.length)])));
      else if (live.length) live.splice(Math.floor(rnd() * live.length), 1)[0].release();
    }
    live.forEach((t) => t.release());
    let lk = mm.leakReport();
    expect(lk.liveTextures).toBe(0);
    expect(lk.textureLiveBytes).toBe(0);
    expect(lk.textureBalance).toBe(0);
    mm.textures.trim();
    lk = mm.leakReport();
    expect(lk.idleTextures).toBe(0);
    expect(lk.texturesCreated).toBe(lk.texturesDestroyed);
    expect(mm.usedBytes).toBe(0);
    expect(mm.textures.hits).toBeGreaterThan(mm.textures.misses); // the pool actually pools
  });
  it('buffer pool counters balance', () => {
    const { mm } = mockMemory();
    const bufs = Array.from({ length: 100 }, (_, i) => mm.buffers.acquire({ size: 1000 + i * 37, usage: 1 }));
    expect(mm.leakReport().liveBuffers).toBe(100);
    bufs.forEach((b) => b.release());
    mm.buffers.trim();
    const lk = mm.leakReport();
    expect(lk.liveBuffers + lk.idleBuffers).toBe(0);
    expect(lk.bufferBalance).toBe(0);
    expect(mm.usedBytes).toBe(0);
  });
  it('double release never corrupts the counters', () => {
    const { mm } = mockMemory();
    const t = mm.textures.acquire(RGBA16(64));
    t.release();
    try {
      t.release();
    } catch {
      /* use-after-free is reported by the pool; the books must still balance */
    }
    expect(mm.leakReport().textureBalance).toBe(0);
  });
});

describe('eviction under artificially low budgets', () => {
  it('never exceeds the budget; evicts the output cache LRU before failing', () => {
    const { mm } = mockMemory(8 * 1024 * 1024); // 8 MB = 16 textures of 256x256 rgba16
    const cache = new OutputCache();
    mm.registerEvictor((need) => void cache.evict(need));
    let evicted = 0;
    for (let i = 0; i < 200; i++) {
      const t = mm.textures.acquire(RGBA16(256));
      cache.set(`g:n${i}:out`, i, textureValue(t, 'color'));
      t.release(); // the cache holds the only reference
      expect(mm.usedBytes).toBeLessThanOrEqual(mm.budgetBytes);
      evicted = i;
    }
    expect(evicted).toBe(199);
    expect(mm.leakReport().textureBalance).toBe(0);
  });
  it('refuses oversize allocations with typed errors and emits pressure events', () => {
    const { mm } = mockMemory(1024 * 1024);
    const kinds: string[] = [];
    mm.onPressure.on((p) => kinds.push(p.kind));
    expect(() => mm.textures.acquire(RGBA16(1024))).toThrow(AllocationTooLargeError); // 8 MB > 1 MB budget
    const a = mm.textures.acquire(RGBA16(256)); // 512 KB
    const b = mm.textures.acquire(RGBA16(256));
    expect(() => mm.textures.acquire(RGBA16(256))).toThrow(OutOfBudgetError);
    expect(kinds).toEqual(['budget', 'budget']);
    a.release();
    b.release();
    expect(() => mm.textures.acquire(RGBA16(256))).not.toThrow(); // recovers after release
  });
  it('device out-of-memory lowers the budget and signals pressure', () => {
    const { mm } = mockMemory(64 * 1024 * 1024 * 4);
    const got: string[] = [];
    mm.onPressure.on((p) => got.push(p.kind));
    const t = mm.textures.acquire(RGBA16(1024));
    t.release();
    const before = mm.budgetBytes;
    mm.onDeviceOutOfMemory(1, 'simulated');
    expect(mm.budgetBytes).toBeLessThan(before);
    expect(got).toContain('device-oom');
  });
});

describe('repeated undo / redo and big graphs', () => {
  it('2000 undo/redo cycles keep the graph identical and the stack bounded', () => {
    const ed = new GraphEditor(new Graph(reg, { width: 64, height: 64 }));
    let t = 0;
    ed.stack.now = () => (t += 1000);
    const ids: string[] = [];
    for (let i = 0; i < 120; i++) ids.push(ed.addNode(i % 2 ? 'utils.levels' : 'grayscale.noise', { x: i * 10, y: 0 }));
    for (let i = 1; i < ids.length; i += 2) ed.connect({ node: ids[i - 1], pin: 'output' }, { node: ids[i], pin: 'input' });
    const snap = JSON.stringify(ed.graph.toData());
    const steps = Math.min(ed.stack.limit, 150);
    for (let c = 0; c < 2000 / steps; c++) {
      for (let i = 0; i < steps; i++) ed.stack.undo();
      for (let i = 0; i < steps; i++) ed.stack.redo();
    }
    expect(JSON.stringify(ed.graph.toData())).toBe(snap);
    expect(ed.graph.nodes.size).toBe(120);
  });
  it('a 300-node graph builds a plan quickly (planning is O(n))', async () => {
    const { buildPlan } = await import('../src/engine/graph/plan');
    const g = new Graph(reg, { width: 1024, height: 1024 });
    let prev = g.addNode('grayscale.noise').id;
    for (let i = 0; i < 300; i++) {
      const n = g.addNode(i % 3 === 0 ? 'utils.blur' : 'utils.levels');
      g.connect({ node: prev, pin: 'output' }, { node: n.id, pin: 'input' });
      prev = n.id;
    }
    const t0 = performance.now();
    const plan = buildPlan(g, [prev], { time: 0, scale: 1, maxDim: 16384 });
    const ms = performance.now() - t0;
    expect(plan.nodes.size).toBeGreaterThanOrEqual(301);
    expect(ms).toBeLessThan(500); // generous: CI machines vary; typical < 20 ms
  });
});

describe('subgraph nesting', () => {
  it('10 nested levels flatten to the inline graph (same hashes), quickly, and every level is one undo step', async () => {
    const { flattenGraph } = await import('../src/engine/subgraph/flatten');
    const { SubgraphLibrary } = await import('../src/engine/subgraph/library');
    const { buildMakeSubgraph } = await import('../src/engine/subgraph/make');
    const { buildPlan } = await import('../src/engine/graph/plan');
    const build = (): Graph => {
      const g = new Graph(reg, { width: 128, height: 128 });
      g.addNode('grayscale.noise', { id: 'noise' });
      g.addNode('grayscale.shape', { id: 'shape' });
      g.addNode('utils.blend', { id: 'blend', params: { blend_type: 'multiply' } });
      g.addNode('export.color', { id: 'out' });
      g.connect({ node: 'noise', pin: 'output' }, { node: 'blend', pin: 'foreground' });
      g.connect({ node: 'shape', pin: 'output' }, { node: 'blend', pin: 'background' });
      g.connect({ node: 'blend', pin: 'output' }, { node: 'out', pin: 'input' });
      return g;
    };
    const opts = { time: 0, scale: 1, maxDim: 4096 };
    const hashOf = (g: Graph): number | string => buildPlan(g, ['out'], opts).nodes.get('out')!.hash;
    const inlineHash = hashOf(build());
    const g = build();
    const lib = new SubgraphLibrary(reg);
    const ed = new GraphEditor(g);
    let inner = 'blend';
    const levels = 10;
    for (let i = 0; i < levels; i++) {
      const r = buildMakeSubgraph(g, lib, [inner], `Level ${i}`);
      if (typeof r === 'string') throw new Error(r);
      ed.stack.execute(r.command);
      inner = r.instanceId;
    }
    const t0 = performance.now();
    const flat = flattenGraph(g, lib)!;
    const ms = performance.now() - t0;
    expect(flat).not.toBeNull();
    expect(hashOf(flat.graph)).toBe(inlineHash);
    expect(ms).toBeLessThan(500);
    for (let i = 0; i < levels; i++) ed.stack.undo();
    expect(g.nodes.has('blend')).toBe(true);
    expect(g.nodes.size).toBe(build().nodes.size);
  });
});

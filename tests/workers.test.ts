import { describe, expect, it, vi } from 'vitest';
import { Graph } from '../src/engine/graph/graph';
import { buildPlan } from '../src/engine/graph/plan';
import { noiseDisplace, type NoiseDisplaceParams } from '../src/engine/mesh/deform';
import { MeshData } from '../src/engine/mesh/mesh';
import { MeshBuilder } from '../src/engine/mesh/builder';
import { MeshJobs } from '../src/workers/mesh-jobs';
import { defaultPoolSize, Superseded, WorkerPool, type TaskRequest, type TaskResponse, type WorkerLike } from '../src/workers/pool';
import { collectTransfers, decodeMesh, encodeMesh, runTask, type WireMesh } from '../src/workers/tasks';
import { makeRegistry } from './helpers';

/** In-process fake worker: structured-clones the request (like postMessage), runs the REAL task function, answers asynchronously. */
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminated = false;
  static mode: 'ok' | 'crash' | 'hang' | 'taskError' = 'ok';
  static delay = 1;
  static created = 0;
  constructor() {
    FakeWorker.created++;
  }
  postMessage(msg: unknown): void {
    const req = structuredClone(msg) as TaskRequest;
    const mode = FakeWorker.mode;
    if (mode === 'hang') return;
    setTimeout(() => {
      if (this.terminated) return;
      if (mode === 'crash') return void this.onerror?.({ message: 'boom' });
      let r: TaskResponse;
      try {
        r = { taskId: req.taskId, ok: true, outputs: structuredClone((runTask as (t: string, p: unknown, i: unknown[]) => unknown)(req.task, req.params, req.inputs)) };
      } catch (e) {
        r = { taskId: req.taskId, ok: false, error: (e as Error).message };
      }
      this.onmessage?.({ data: r });
    }, FakeWorker.delay);
  }
  terminate(): void {
    this.terminated = true;
  }
}
const runSync = (t: string, p: unknown, i: unknown[]): unknown => (runTask as (t: string, p: unknown, i: unknown[]) => unknown)(t, p, i);
const mkPool = (size = 2, timeoutMs?: number): WorkerPool => new WorkerPool({ size, factory: () => new FakeWorker(), runSync, timeoutMs });
const reset = (): void => {
  FakeWorker.mode = 'ok';
  FakeWorker.delay = 1;
  FakeWorker.created = 0;
};

const NOISE: NoiseDisplaceParams = {
  mode: 'normal',
  axis: [0, 0, 1],
  kind: 'perlin',
  frequency: 2.5,
  freqScale: [1, 1, 1],
  amplitude: 0.2,
  bias: 0,
  offset: [0.1, 0.2, 0.3],
  octaves: 3,
  lacunarity: 2,
  gain: 0.5,
  seed: 7,
  t: 0.25,
  loopCycles: 0,
  mask: 'none',
  maskAttr: 'age',
  maskInvert: false,
  maskTexture: null,
  maskChannel: 4,
  uvSet: 0,
  falloff: { enabled: false, center: [0, 0, 0], inner: 0.5, outer: 1.5, invert: false },
  storeNoise: true,
  recomputeNormals: true,
};
function grid(n: number): MeshData {
  const b = new MeshBuilder();
  const idx: number[] = [];
  for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) idx.push(b.addPoint(x / n - 0.5, y / n - 0.5, Math.sin(x * 0.3) * 0.1));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b.addPrim([idx[y * (n + 1) + x], idx[y * (n + 1) + x + 1], idx[(y + 1) * (n + 1) + x + 1], idx[(y + 1) * (n + 1) + x]]);
  return b.build();
}
/** Element-wise Object.is equality of every attribute + topology (distinguishes -0 / +0; NaN equals NaN): the "byte-equal" check for floats. */
const sameBytes = (a: MeshData, b: MeshData): boolean => {
  const names = (m: MeshData): string => m.list().map((q) => `${q.element}/${q.name}`).join(',');
  expect(names(a)).toBe(names(b));
  const eq = (x: ArrayLike<number>, y: ArrayLike<number>): boolean => {
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    return true;
  };
  for (const at of a.list()) if (!eq(at.data, b.attr(at.element, at.name)!.data)) return false;
  return eq(a.topology.vertPoint, b.topology.vertPoint) && eq(a.topology.primStart, b.topology.primStart);
};

describe('worker protocol + determinism', () => {
  it('mesh.noise through the (fake) worker is BYTE-EQUAL to the direct main-thread call', async () => {
    reset();
    const src = grid(40);
    const direct = noiseDisplace(src, NOISE);
    const pool = mkPool(1);
    const out = (await pool.submit('mesh.noise', NOISE, [encodeMesh(src)])) as { mesh: WireMesh };
    expect(sameBytes(decodeMesh(out.mesh), direct)).toBe(true);
    // the task function itself, called directly, is the same code
    expect(sameBytes(decodeMesh(runTask('mesh.noise', NOISE, [encodeMesh(src)]).mesh), direct)).toBe(true);
    expect(pool.stats.completed).toBe(1);
    pool.dispose();
  });

  it('unknown tasks and task errors come back as rejections (the pool survives)', async () => {
    reset();
    const pool = mkPool(1);
    await expect(pool.submit('nope', {}, [])).rejects.toThrow(/Unknown worker task/);
    const ok = (await pool.submit('json.parse', '{"a":1}')) as { ok: boolean; value: unknown };
    expect(ok).toEqual({ ok: true, value: { a: 1 } });
    pool.dispose();
  });

  it('collectTransfers lists each ArrayBuffer once', () => {
    const a = new Float32Array(4);
    const list = collectTransfers({ x: a, y: [a, new Uint32Array(2)], z: { deep: new Float32Array(a.buffer) } });
    expect(list).toHaveLength(2);
  });

  it('pool size = min(4, hardwareConcurrency - 1), at least 1', () => {
    expect(defaultPoolSize(1)).toBe(1);
    expect(defaultPoolSize(2)).toBe(1);
    expect(defaultPoolSize(4)).toBe(3);
    expect(defaultPoolSize(32)).toBe(4);
    vi.stubGlobal('navigator', {});
    expect(defaultPoolSize(undefined)).toBe(1);
    vi.unstubAllGlobals();
  });
});

describe('pool scheduling', () => {
  it('latest wins per key: queued older job is rejected, the newest result is delivered, one in flight per key', async () => {
    reset();
    FakeWorker.delay = 5;
    const pool = mkPool(2);
    const r1 = pool.submit('json.parse', '1', [], { key: 'n1' });
    const r2 = pool.submit('json.parse', '2', [], { key: 'n1' }); // r1 in flight -> superseded, r2 waits (one in flight per key)
    const r3 = pool.submit('json.parse', '3', [], { key: 'n1' }); // replaces queued r2
    expect(pool.inFlight).toBe(1);
    expect(pool.queued).toBe(1);
    const res = await Promise.allSettled([r1, r2, r3]);
    expect(res[0].status).toBe('rejected');
    expect((res[0] as PromiseRejectedResult).reason).toBeInstanceOf(Superseded);
    expect(res[1].status).toBe('rejected');
    expect(res[2].status).toBe('fulfilled');
    expect((res[2] as PromiseFulfilledResult<{ value: number }>).value.value).toBe(3);
    pool.dispose();
  });

  it('different keys run in parallel up to the pool size; the queue stays bounded by the number of keys', async () => {
    reset();
    FakeWorker.delay = 5;
    const pool = mkPool(2);
    const jobs = [0, 1, 2, 3].map((k) => pool.submit('json.parse', String(k), [], { key: `k${k}` }));
    expect(pool.inFlight).toBe(2);
    expect(pool.queued).toBe(2);
    for (let i = 0; i < 200; i++) void pool.submit('json.parse', '0', [], { key: 'spam' }).catch(() => undefined);
    expect(pool.queued).toBeLessThanOrEqual(3);
    await Promise.all(jobs);
    pool.dispose();
  });

  it('cancel(key) rejects queued work and discards an in-flight result', async () => {
    reset();
    FakeWorker.delay = 5;
    const pool = mkPool(1);
    const a = pool.submit('json.parse', '1', [], { key: 'a' });
    const b = pool.submit('json.parse', '2', [], { key: 'b' });
    pool.cancel('a');
    pool.cancel('b');
    const r = await Promise.allSettled([a, b]);
    expect(r.every((x) => x.status === 'rejected')).toBe(true);
    pool.dispose();
  });

  it('a crashing worker is respawned and the job completes ONCE on the main thread with the same result', async () => {
    reset();
    FakeWorker.mode = 'crash';
    const pool = mkPool(1);
    const src = grid(10);
    const out = (await pool.submit('mesh.noise', NOISE, [encodeMesh(src)])) as { mesh: WireMesh };
    expect(sameBytes(decodeMesh(out.mesh), noiseDisplace(src, NOISE))).toBe(true);
    expect(pool.stats.crashes).toBe(1);
    expect(pool.stats.fallbacks).toBe(1);
    expect(pool.workersAlive).toBe(0); // respawned lazily
    FakeWorker.mode = 'ok';
    await pool.submit('json.parse', '1');
    expect(pool.workersAlive).toBe(1);
    expect(FakeWorker.created).toBe(2);
    pool.dispose();
  });

  it('a hanging worker times out, is replaced and the job falls back', async () => {
    reset();
    FakeWorker.mode = 'hang';
    const pool = mkPool(1, 30);
    const out = (await pool.submit('json.parse', '[1,2]')) as { value: number[] };
    expect(out.value).toEqual([1, 2]);
    expect(pool.stats.crashes).toBe(1);
    pool.dispose();
  });

  it('without Worker support everything runs through the same function (factory = null)', async () => {
    const pool = new WorkerPool({ factory: null, runSync });
    expect(pool.available).toBe(false);
    const out = (await pool.submit('json.parse', '{"x":2}')) as { value: { x: number } };
    expect(out.value.x).toBe(2);
    pool.dispose();
  });
});

describe('mesh jobs (pull model, pending state, bounded LRU)', () => {
  it('pending -> ready: keeps the last valid result, fires onReady once, then serves from the cache', async () => {
    reset();
    FakeWorker.delay = 3;
    const pool = mkPool(1);
    const jobs = new MeshJobs(pool);
    const src = grid(20);
    let ready = 0;
    jobs.onReady.on(() => ready++);
    const a = jobs.request('n1', 'k1', 'mesh.noise', NOISE, src)!;
    expect(a).toEqual({ mesh: null, pending: true });
    expect(jobs.pending.has('n1')).toBe(true);
    expect(jobs.request('n1', 'k1', 'mesh.noise', NOISE, src)!.pending).toBe(true); // same key: no second submit
    await new Promise((r) => setTimeout(r, 40));
    expect(ready).toBe(1);
    expect(jobs.pending.size).toBe(0);
    const b = jobs.request('n1', 'k1', 'mesh.noise', NOISE, src)!;
    expect(b.pending).toBe(false);
    expect(sameBytes(b.mesh!, noiseDisplace(src, NOISE))).toBe(true);
    // a new key while the next is pending returns the last valid mesh
    const c = jobs.request('n1', 'k2', 'mesh.noise', { ...NOISE, amplitude: 0.5 }, src)!;
    expect(c.pending).toBe(true);
    expect(c.mesh).toBe(b.mesh);
    expect(pool.stats.submitted).toBe(2);
    pool.dispose();
  });

  it('a superseded job (newer key of the same node) never publishes its result', async () => {
    reset();
    FakeWorker.delay = 3;
    const pool = mkPool(1);
    const jobs = new MeshJobs(pool);
    const src = grid(8);
    jobs.request('n', 'old', 'mesh.noise', NOISE, src);
    jobs.request('n', 'new', 'mesh.noise', { ...NOISE, seed: 9 }, src);
    await new Promise((r) => setTimeout(r, 60));
    expect(jobs.has('old')).toBe(false);
    expect(jobs.has('new')).toBe(true);
    pool.dispose();
  });

  it('the result cache is a byte-bounded LRU', async () => {
    reset();
    const pool = mkPool(2);
    const jobs = new MeshJobs(pool);
    const src = grid(30);
    jobs.maxBytes = src.bytes * 2.5;
    for (let i = 0; i < 6; i++) {
      jobs.request(`n${i}`, `k${i}`, 'mesh.noise', { ...NOISE, seed: i }, src);
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(jobs.count).toBeLessThanOrEqual(3);
    expect(jobs.bytes).toBeLessThanOrEqual(jobs.maxBytes + src.bytes * 1.5);
    jobs.clear();
    expect(jobs.bytes).toBe(0);
    pool.dispose();
  });

  it('plan hash flips pending -> ready (one coalesced re-evaluation) and is unchanged for nodes without a worker', () => {
    const reg = makeRegistry();
    const g = new Graph(reg, { width: 32, height: 32 });
    const n = g.addNode('geometry.noise');
    const ready = new Set<string>();
    const plan = () => buildPlan(g, [n.id], { time: 0, scale: 1, maxDim: 4096, jobReady: (k) => ready.has(k) }).nodes.get(n.id)!;
    const p1 = plan();
    expect(p1.jobKey).toBeTruthy();
    ready.add(p1.jobKey!);
    const p2 = plan();
    expect(p2.jobKey).toBe(p1.jobKey);
    expect(p2.hash).not.toBe(p1.hash);
    const off = buildPlan(g, [n.id], { time: 0, scale: 1, maxDim: 4096 }).nodes.get(n.id)!;
    expect(off.jobKey).toBeUndefined();
    const u = g.addNode('grayscale.uniform');
    const a = buildPlan(g, [u.id], { time: 0, scale: 1, maxDim: 4096 }).nodes.get(u.id)!;
    const b = buildPlan(g, [u.id], { time: 0, scale: 1, maxDim: 4096, jobReady: () => true }).nodes.get(u.id)!;
    expect(a.hash).toBe(b.hash);
  });
});

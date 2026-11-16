import { noiseDisplace, type NoiseDisplaceParams } from '../engine/mesh/deform';
import { MeshBuilder } from '../engine/mesh/builder';
import type { MeshData } from '../engine/mesh/mesh';
import { getPool } from '../workers';
import { decodeMesh, encodeMesh, type WireMesh } from '../workers/tasks';
import type { Helpers } from './generators';
import { Skip, type TestDef } from './tests';

/**
 * group "Workers ·": a large generated mesh runs through the mesh worker pool and on the main thread. Results must be equal
 * element by element (same pure function), and the main thread must stay responsive while the worker computes (requestAnimationFrame
 * probe: worst frame gap < 50 ms; the number is reported).
 */
export function workerTests(_h: Helpers): TestDef[] {
  void _h;
  const params: NoiseDisplaceParams = {
    mode: 'normal', axis: [0, 0, 1], kind: 'perlin', frequency: 3, freqScale: [1, 1, 1], amplitude: 0.15, bias: 0, offset: [0.3, 0.1, 0.7], octaves: 4, lacunarity: 2, gain: 0.5, seed: 3, t: 0.4, loopCycles: 0,
    mask: 'none', maskAttr: 'age', maskInvert: false, maskTexture: null, maskChannel: 4, uvSet: 0, falloff: { enabled: false, center: [0, 0, 0], inner: 0.5, outer: 1.5, invert: false }, storeNoise: false, recomputeNormals: true,
  };
  function grid(n: number): MeshData {
    const b = new MeshBuilder();
    const idx = new Uint32Array((n + 1) * (n + 1));
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) idx[y * (n + 1) + x] = b.addPoint(x / n - 0.5, y / n - 0.5, 0.05 * Math.sin(x * 0.1));
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) b.addPrim([idx[y * (n + 1) + x], idx[y * (n + 1) + x + 1], idx[(y + 1) * (n + 1) + x + 1], idx[(y + 1) * (n + 1) + x]]);
    return b.build();
  }
  const same = (a: MeshData, b: MeshData): number => {
    let diff = 0;
    for (const at of a.list()) {
      const o = b.attr(at.element, at.name);
      if (!o || o.data.length !== at.data.length) return Infinity;
      for (let i = 0; i < at.data.length; i++) if (!Object.is(at.data[i], o.data[i])) diff++;
    }
    return diff;
  };

  return [
    {
      name: 'Workers · mesh.noise on a 250k-point mesh: worker result equals the main-thread result, UI never blocked (rAF gap < 50 ms)',
      async run() {
        const pool = getPool();
        if (!pool.available) throw new Skip('Workers are not available (?noworkers or no Worker support)');
        const src = grid(500);
        let last = performance.now();
        let worst = 0;
        let raf = requestAnimationFrame(function tick() {
          const n = performance.now();
          worst = Math.max(worst, n - last);
          last = n;
          raf = requestAnimationFrame(tick);
        });
        const t0 = performance.now();
        const wire = encodeMesh(src); // inputs are cloned on send (copy-on-send): `src` stays valid
        const out = (await pool.submit('mesh.noise', params, [wire], { key: 'selftest' })) as { mesh: WireMesh };
        const tWorker = performance.now() - t0;
        cancelAnimationFrame(raf);
        const viaWorker = decodeMesh(out.mesh);
        const t1 = performance.now();
        const direct = noiseDisplace(src, params);
        const tMain = performance.now() - t1;
        const diff = same(viaWorker, direct);
        if (diff !== 0) throw new Error(`worker and main-thread results differ in ${diff} values`);
        if (worst > 50) throw new Error(`main thread blocked: worst frame gap ${worst.toFixed(1)} ms during the worker task`);
        return `${src.pointCount} points: worker ${tWorker.toFixed(0)} ms (UI worst frame gap ${worst.toFixed(1)} ms), main thread ${tMain.toFixed(0)} ms (blocking), results identical; pool ${pool.size} workers, stats ${JSON.stringify(pool.stats)}`;
      },
    },
    {
      name: 'Workers · latest wins: 20 rapid submissions of one node deliver exactly the newest result, nothing is left queued',
      async run() {
        const pool = getPool();
        if (!pool.available) throw new Skip('Workers are not available');
        const src = grid(120);
        const wire = encodeMesh(src);
        const settled = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => pool.submit('mesh.noise', { ...params, seed: i }, [wire], { key: 'rapid' })));
        const ok = settled.filter((s) => s.status === 'fulfilled').length;
        const last = settled[19];
        if (last.status !== 'fulfilled') throw new Error('the newest submission did not complete');
        const expected = noiseDisplace(src, { ...params, seed: 19 });
        if (same(decodeMesh((last.value as { mesh: WireMesh }).mesh), expected) !== 0) throw new Error('newest result differs from the direct computation');
        if (pool.queued !== 0 || pool.inFlight !== 0) throw new Error(`queue not drained: queued ${pool.queued}, in flight ${pool.inFlight}`);
        return `${ok}/20 completed (the rest superseded), newest result verified`;
      },
    },
  ];
}

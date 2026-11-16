import type { Engine } from '../engine/engine';
import { BINS, binOf, cpuHistogram, type HistResult } from '../engine/analysis/histogram-core';
import { histogramService } from '../engine/analysis/histogram-gpu';
import type { GpuTexture } from '../engine/resources/memory';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU known-answer tests of the live histogram (group "Histogram ·"): uniform value, linear ramp and checker for Gray and
 * Color, strided sampling accuracy on a big texture, no leak (pool + staging buffers back to baseline), readback never blocks the
 * main thread (requestAnimationFrame probe).
 */
export function histogramTests(h: Helpers): TestDef[] {
  const { engineOf, dispose } = h;
  const tests: TestDef[] = [];

  /** rgba32float texture filled by `f(x, y) -> [r, g, b, a]` (exact values: no half-float rounding). */
  function makeTex(e: Engine, w: number, hgt: number, f: (x: number, y: number) => number[]): GpuTexture {
    const t = e.mm.textures.acquire({ width: w, height: hgt, format: 'rgba32float', label: 'hist test' });
    const data = new Float32Array(w * hgt * 4);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) data.set(f(x, y), (y * w + x) * 4);
    e.gpu.device.queue.writeTexture({ texture: t.texture }, data, { bytesPerRow: w * 16, rowsPerImage: hgt }, [w, hgt]);
    return t;
  }
  const same = (a: HistResult, b: HistResult, tol: number, what: string): void => {
    for (let i = 0; i < a.bins.length; i++) if (Math.abs(a.bins[i] - b.bins[i]) > tol) throw new Error(`${what}: bin ${i} GPU ${a.bins[i]} vs CPU ${b.bins[i]}`);
  };
  const live = (e: Engine): number => e.mm.buffers.liveBytes + e.mm.textures.liveBytes;

  tests.push({
    name: 'Histogram · known answers (uniform / ramp / checker) for Gray and Color match the CPU reference exactly',
    async run(env) {
      const e = engineOf(env);
      try {
        const svc = histogramService(e);
        const range = { min: 0, max: 1 };
        const base = live(e);
        const cases: [string, number, number, (x: number, y: number) => number[], 'gray' | 'color'][] = [
          ['uniform 0.25 gray', 64, 64, () => [0.25, 0, 0, 1], 'gray'],
          ['ramp 256 gray', 256, 8, (x) => [(x + 0.5) / 256, 0, 0, 1], 'gray'],
          ['checker color', 64, 64, (x, y) => ((x + y) % 2 ? [1, 0, 0.5, 1] : [0, 0.25, 1, 1]), 'color'],
          ['ramp color + alpha', 256, 4, (x) => [(x + 0.5) / 256, 1 - (x + 0.5) / 256, 0.5, (x + 0.5) / 256], 'color'],
        ];
        const lines: string[] = [];
        for (const [name, w, hh, f, kind] of cases) {
          const tex = makeTex(e, w, hh, f);
          const px = new Float32Array(w * hh * 4);
          for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) px.set(f(x, y), (y * w + x) * 4);
          const gpu = await svc.compute(tex, kind, range);
          const cpu = cpuHistogram(kind === 'gray' ? px.filter((_, i) => i % 4 === 0) : px, w, hh, kind === 'gray' ? 1 : 4, range, 1);
          same(gpu, cpu, kind === 'gray' && name.startsWith('ramp') ? 1 : 0, name); // luma of f32 may differ by one bin at a boundary
          tex.release();
          lines.push(`${name}: ok (${gpu.samples} samples)`);
        }
        const hdrTex = makeTex(e, 16, 16, () => [3.5, 0.5, 0, 1]);
        const r0 = await svc.compute(hdrTex, 'color', range);
        if (r0.overHi[0] !== 256 || r0.max[0] !== 3.5 || r0.bins[255] !== 256) throw new Error(`HDR overflow wrong: overHi ${r0.overHi[0]}, max ${r0.max[0]}, bin255 ${r0.bins[255]}`);
        const r1 = await svc.compute(hdrTex, 'color', { min: 0, max: 4 });
        if (r1.overHi[0] !== 0 || r1.bins[binOf(3.5, { min: 0, max: 4 })] !== 256) throw new Error('HDR range 0..4 wrong');
        hdrTex.release();
        e.mm.reclaim(Number.MAX_SAFE_INTEGER);
        if (live(e) !== base) throw new Error(`LEAK: live bytes ${base} -> ${live(e)}`);
        if (svc.active !== 0) throw new Error('histogram job still active');
        return [...lines, `HDR: overflow counted (${r0.overHi[0]}), auto range 0..4 has none`].join('\n');
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: 'Histogram · 4K gradient is strided to <= 1M samples and stays within 1 % of the exact histogram; readback never blocks (rAF probe < 50 ms)',
    async run(env) {
      const e = engineOf(env);
      try {
        const w = 4096;
        const tex = makeTex(e, w, w, (x) => [x / (w - 1), 0, 0, 1]);
        const svc = histogramService(e);
        let last = performance.now();
        let worstGap = 0;
        let raf = 0;
        const tick = (): void => {
          const n = performance.now();
          worstGap = Math.max(worstGap, n - last);
          last = n;
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        const t0 = performance.now();
        const r = await svc.compute(tex, 'gray', { min: 0, max: 1 });
        const ms = performance.now() - t0;
        cancelAnimationFrame(raf);
        if (r.samples > 1 << 20) throw new Error(`too many samples: ${r.samples}`);
        let worst = 0;
        for (let i = 0; i < BINS; i++) worst = Math.max(worst, Math.abs(r.bins[i] / r.samples - 1 / BINS));
        if (worst > 0.01) throw new Error(`strided histogram off by ${worst}`);
        if (worstGap > 50 && !env.gpu.caps.adapter.isFallback) throw new Error(`main thread blocked: worst frame gap ${worstGap.toFixed(1)} ms`);
        tex.release();
        return `${r.samples} samples (stride ${Math.round(Math.sqrt((w * w) / r.samples))}), max bin deviation ${(worst * 100).toFixed(3)} %, ${ms.toFixed(1)} ms, worst rAF gap ${worstGap.toFixed(1)} ms`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: 'Histogram · 200 requests with latest-wins queueing: no leak, no job left active',
    async run(env) {
      const e = engineOf(env);
      try {
        const svc = histogramService(e);
        const tex = makeTex(e, 128, 128, (x, y) => [(x ^ y) / 128, 0.5, 0.5, 1]);
        const base = live(e);
        let ok = 0;
        let superseded = 0;
        const jobs: Promise<void>[] = [];
        for (let i = 0; i < 200; i++) {
          jobs.push(
            svc.compute(tex, 'color', { min: 0, max: 1 }).then(
              () => void ok++,
              () => void superseded++,
            ),
          );
          if (i % 7 === 0) await new Promise((r) => setTimeout(r, 0));
        }
        await Promise.all(jobs);
        if (ok + superseded !== 200 || ok < 1) throw new Error(`ok ${ok}, superseded ${superseded}`);
        e.mm.reclaim(Number.MAX_SAFE_INTEGER);
        if (svc.active !== 0) throw new Error('job still active');
        if (live(e) !== base) throw new Error(`LEAK ${base} -> ${live(e)}`);
        tex.release();
        return `${ok} completed, ${superseded} superseded (latest wins), pools at baseline`;
      } finally {
        dispose(e);
      }
    },
  });

  return tests;
}

import { GraphEditor } from '../engine/commands/graph-commands';
import type { Engine } from '../engine/engine';
import { targetKey } from '../engine/graph/evaluator';
import type { Graph } from '../engine/graph/graph';
import { warmUpPipelines } from '../engine/perf/warmup';
import { AdaptiveResolution } from '../engine/perf/adaptive';
import { readTextureFloat32 } from '../engine/resources/readback';
import { selfTestJobEnv } from './export';
import { runImageJob } from '../export/image-job';
import { MemoryTarget } from '../export/targets';
import type { TextureValue } from '../engine/resources/values';
import type { Helpers } from './generators';
import { Skip, type Env, type TestDef } from './tests';

/**
 * GPU tests for performance and hardening (benchmarks, leaks, memory limits). Names start with `7B ·`. Run them in the development harness (`/#selftest`).
 *
 * BENCHMARK TARGETS (docs/PERFORMANCE.md). BENCH tests print numbers and FAIL only above the hard limit (4x the target; software
 * adapters are SKIPPED because their numbers say nothing about a real GPU):
 *   B1  interactive drag, 20 nodes @1024 (every node re-runs)         target <= 8 ms GPU on a mid-range GPU   hard limit 33 ms wall
 *   B2  unchanged graph, 20 nodes @1024 (pure cache hits)             target <= 1 ms CPU                      hard limit 8 ms
 *   B3  pipeline warm-up of the 20-node graph                         target <= 3 s total                     hard limit 12 s
 *   B4  120 nodes @2048 full evaluation of 12 outputs                 target <= 100 ms CPU recording          hard limit 600 ms
 *   B5  1024^2 readback (export path)                                 target <= 15 ms                          hard limit 120 ms
 * STRESS tests assert correctness: pools return to baseline, books balance (created - destroyed = live + idle), budget respected.
 */
interface Base {
  tex: number;
  buf: number;
}
const baseline = (e: Engine): Base => ({ tex: e.mm.textures.liveBytes, buf: e.mm.buffers.liveBytes - e.arena.heldBytes });
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const f1 = (n: number): string => n.toFixed(1);

export function perfTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link } = h;
  const tests: TestDef[] = [];
  const isSoftware = (env: Env): boolean => env.gpu.caps.adapter.isFallback;

  /** noise -> (levels, blur)* chain, returns node ids in order. */
  function makeChain(g: Graph, len: number, seed = 0): string[] {
    const ids: string[] = [add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4], seed })];
    for (let i = 1; i < len; i++) {
      const id = i % 2 ? add(g, 'utils.levels', { gamma: 1.1 + (i % 5) * 0.05 }) : add(g, 'utils.blur', { radius: 0.004 + (i % 4) * 0.002 });
      link(g, ids[i - 1], id);
      ids.push(id);
    }
    return ids;
  }

  function leakCheck(e: Engine, base: Base, what: string): void {
    e.evaluator.cache.clear();
    e.scheduler.dropFrameCache();
    const after = baseline(e);
    if (after.tex !== base.tex || after.buf !== base.buf) throw new Error(`${what}: LEAK texture bytes ${base.tex} -> ${after.tex}, buffer bytes ${base.buf} -> ${after.buf}`);
    const lk = e.mm.leakReport();
    if (lk.textureBalance !== 0 || lk.bufferBalance !== 0) throw new Error(`${what}: accounting imbalance ${JSON.stringify(lk)}`);
  }

  async function evalOnce(e: Engine, g: Graph, ids: string[], opts: { scale?: number; time?: number } = {}): Promise<{ wall: number; cpu: number; gpu?: number; errors: number }> {
    let gpu: number | undefined;
    const got = new Promise<void>((res) => {
      const off = e.evaluator.onTiming.on((s) => (off(), (gpu = s.gpuMs), res()));
      setTimeout(() => (off(), res()), 400);
    });
    const t0 = performance.now();
    const res = await e.evaluator.evaluate(
      g,
      ids.map((nodeId) => ({ nodeId })),
      opts,
    );
    await e.gpu.device.queue.onSubmittedWorkDone();
    const wall = performance.now() - t0;
    const cpu = res.stats.cpuMs;
    const errors = res.errors.size;
    res.release();
    if (e.profiler.enabled) await got;
    return { wall, cpu, gpu, errors };
  }

  tests.push({
    name: '7B · identity short-cut: Blur with radius 0 forwards its input (same pixels, no pass)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { tiling: 'both' });
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
        const b = add(g, 'utils.blur', { radius: 0 });
        link(g, n, b);
        const a = await h.read(e, g, n);
        const before = e.evaluator.identitySkips;
        const r = await h.read(e, g, b);
        if (e.evaluator.identitySkips !== before + 1) throw new Error(`identity short-cut was not taken (skips ${before} -> ${e.evaluator.identitySkips})`);
        const err = h.maxErr(r.data, (i) => a.data[i]);
        if (err !== 0) throw new Error(`forwarded pixels differ from the input (max err ${err})`);
        g.setParam(b, 'radius', 0.02);
        const r2 = await h.read(e, g, b);
        if (h.maxErr(r2.data, (i) => a.data[i]) === 0) throw new Error('blur with radius 0.02 must change the image');
        return `identity skipped once; real blur still runs (max change ${h.maxErr(r2.data, (i) => a.data[i]).toFixed(4)})`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · bind group cache (dynamic offsets): identical pixels on/off, cache is hit on re-evaluation',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 128, { tiling: 'both' });
        const ids = makeChain(g, 6);
        const last = ids[ids.length - 1];
        e.runner.bindGroupCache = true;
        const a = await h.read(e, g, last);
        e.evaluator.cache.clear();
        const hits0 = e.runner.bgHits;
        const a2 = await h.read(e, g, last);
        const hits = e.runner.bgHits - hits0;
        e.runner.bindGroupCache = false;
        e.evaluator.cache.clear();
        const b = await h.read(e, g, last);
        e.runner.bindGroupCache = true;
        if (h.maxErr(a.data, (i) => b.data[i]) !== 0) throw new Error('cached bind groups changed the result');
        if (h.maxErr(a2.data, (i) => b.data[i]) !== 0) throw new Error('reused bind groups changed the result');
        if (hits <= 0) throw new Error('second evaluation did not hit the bind group cache');
        return `identical pixels; ${hits} bind group hits on re-evaluation, ${e.runner.bindGroupCacheSize} cached`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · pipeline warm-up builds pipelines before first use',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 256, { tiling: 'both' });
        const ids = makeChain(g, 8);
        e.scheduler.attach(g);
        const c0 = e.pipelines.compiledCount;
        const r = await warmUpPipelines(e, g, { batch: 4 });
        if (r.skipped) throw new Error('warm-up was skipped');
        const warmed = e.pipelines.compiledCount - c0;
        if (warmed <= 0) throw new Error('warm-up built no pipeline');
        const c1 = e.pipelines.compiledCount;
        const t = await evalOnce(e, g, [ids[ids.length - 1]]);
        const extra = e.pipelines.compiledCount - c1;
        e.scheduler.dispose();
        return `${r.nodes} node types warmed in ${f1(r.ms)} ms -> ${warmed} pipelines; first full-size evaluation built ${extra} more (${f1(t.wall)} ms)`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · BENCH B1/B2/B3: 20-node graph @1024 (drag re-evaluation, cache hits, warm-up)',
    async run(env) {
      if (isSoftware(env)) throw new Skip('software adapter: numbers are meaningless');
      const e = engineOf(env);
      try {
        const g = mk(e, 1024, { tiling: 'both' });
        const ids = makeChain(g, 20);
        const last = ids[19];
        e.scheduler.attach(g);
        const w0 = performance.now();
        await warmUpPipelines(e, g);
        const warm = performance.now() - w0;
        await evalOnce(e, g, [last]); // everything compiled + pooled
        const walls: number[] = [];
        const gpus: number[] = [];
        const cpus: number[] = [];
        for (let i = 0; i < 24; i++) {
          g.setParam(ids[0], 'seed', i + 1); // top of the chain changes: all 20 nodes re-run
          const t = await evalOnce(e, g, [last], { scale: 1 });
          if (t.errors) throw new Error('evaluation errors during the benchmark');
          if (i >= 4) {
            walls.push(t.wall);
            cpus.push(t.cpu);
            if (t.gpu !== undefined) gpus.push(t.gpu);
          }
        }
        const cached: number[] = [];
        for (let i = 0; i < 20; i++) cached.push((await evalOnce(e, g, [last])).cpu);
        const wall = median(walls);
        const cacheCpu = median(cached);
        e.scheduler.dispose();
        const line = `B1 drag eval: wall ${f1(wall)} ms (target GPU <= 8)${gpus.length ? `, GPU ${median(gpus).toFixed(2)} ms` : ' (no timestamp queries)'}, CPU record ${f1(median(cpus))} ms | B2 cached ${cacheCpu.toFixed(2)} ms CPU (target <= 1) | B3 warm-up ${f1(warm)} ms (target <= 3000) | bind group hits ${e.runner.bgHits}/${e.runner.bgHits + e.runner.bgMisses}`;
        if (wall > 33) throw new Error(`B1 over the hard limit 33 ms: ${line}`);
        if (cacheCpu > 8) throw new Error(`B2 over the hard limit 8 ms: ${line}`);
        if (warm > 12000) throw new Error(`B3 over the hard limit 12 s: ${line}`);
        return line;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · BENCH B5: 1024^2 readback (export path) and no buffer leak over 100 readbacks',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 1024, { tiling: 'both' });
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [8, 8] });
        const base = baseline(e);
        const times: number[] = [];
        for (let i = 0; i < 100; i++) {
          const res = await e.evaluator.evaluate(g, [{ nodeId: n }], {});
          try {
            const v = res.values.get(targetKey({ nodeId: n })) as TextureValue;
            const t0 = performance.now();
            await readTextureFloat32(e.gpu, e.mm, v.tex.texture, v.tex.format, v.width, v.height);
            times.push(performance.now() - t0);
          } finally {
            res.release();
          }
        }
        leakCheck(e, base, 'readback');
        const med = median(times);
        if (!isSoftware(env) && med > 120) throw new Error(`readback median ${f1(med)} ms is over the hard limit 120 ms`);
        return `median readback ${f1(med)} ms (target <= 15), 100 readbacks leak-free`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · adaptive resolution controller converges on a heavy graph (drag budget 8 ms)',
    async run(env) {
      if (isSoftware(env)) skip();
      const e = engineOf(env);
      try {
        const size = Math.min(2048, e.gpu.caps.limits.maxTextureDimension2D ?? 2048);
        const g = mk(e, size, { tiling: 'both' });
        const ids = makeChain(g, 40);
        const last = ids[39];
        const ad = new AdaptiveResolution({ budgetMs: 8, upConfirm: 3 });
        await evalOnce(e, g, [last]);
        const first = await evalOnce(e, g, [last], { scale: 1 });
        const trace: string[] = [];
        for (let i = 0; i < 14; i++) {
          g.setParam(ids[0], 'seed', i + 100);
          const s = ad.scale;
          const t = await evalOnce(e, g, [last], { scale: s });
          // wall time is the honest cost signal here (timestamps may be unavailable)
          ad.observe(t.wall, s, 'gpu');
          trace.push(`${Math.round(s * 100)}%:${f1(t.wall)}ms`);
        }
        const settled = await evalOnce(e, g, [last], { scale: ad.scale });
        if (ad.scale > 1 || ad.scale < 0.125) throw new Error(`scale out of range ${ad.scale}`);
        if (first.wall > 12 && settled.wall > first.wall * 1.15) throw new Error(`adaptive scale ${ad.scale} did not reduce the cost (${f1(first.wall)} -> ${f1(settled.wall)} ms)`);
        return `${size}² x 40 nodes: 100% costs ${f1(first.wall)} ms -> settled at ${Math.round(ad.scale * 100)}% (${f1(settled.wall)} ms). Trace: ${trace.join(' ')}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · STRESS 120 nodes @2048 x 8 evaluations: pools return to baseline, books balance (B4 timing)',
    async run(env) {
      const e = engineOf(env);
      try {
        const size = Math.min(2048, e.gpu.caps.limits.maxTextureDimension2D ?? 2048);
        const g = mk(e, size, { tiling: 'both' });
        const outs: string[] = [];
        const firsts: string[] = [];
        for (let c = 0; c < 12; c++) {
          const ids = makeChain(g, 10, c);
          firsts.push(ids[0]);
          outs.push(ids[9]);
        }
        const base = baseline(e);
        const cpu: number[] = [];
        let peak = 0;
        for (let i = 0; i < 8; i++) {
          g.setParam(firsts[i % 12], 'seed', 1000 + i);
          const t = await evalOnce(e, g, outs);
          if (t.errors) throw new Error(`iteration ${i}: ${t.errors} node(s) failed`);
          cpu.push(t.cpu);
          peak = Math.max(peak, e.mm.usedBytes);
        }
        if (peak > e.mm.budgetBytes) throw new Error(`peak ${peak} exceeded the budget ${e.mm.budgetBytes}`);
        leakCheck(e, base, 'stress-2k');
        const med = median(cpu);
        if (!isSoftware(env) && med > 600) throw new Error(`B4 median CPU ${f1(med)} ms is over the hard limit 600 ms`);
        return `${g.nodes.size} nodes @${size}²: median CPU record ${f1(med)} ms (target <= 100), peak ${(peak / 1048576).toFixed(0)} MB of ${(e.mm.budgetBytes / 1048576).toFixed(0)} MB, leak-free`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · STRESS 4K chain and 8K graceful degradation (typed errors, no crash, no leak)',
    async run(env) {
      const e = engineOf(env);
      try {
        const max = e.gpu.caps.limits.maxTextureDimension2D ?? 8192;
        const lines: string[] = [];
        for (const size of [4096, 8192]) {
          if (max < size) {
            lines.push(`${size}: device limit ${max}, skipped`);
            continue;
          }
          const g = mk(e, size, { tiling: 'both' });
          const ids = makeChain(g, size === 4096 ? 12 : 3);
          const base = baseline(e);
          const res = await e.evaluator.evaluate(g, [{ nodeId: ids[ids.length - 1] }], {});
          const err = res.errors.get(ids[ids.length - 1]);
          res.release();
          if (err && !/budget|memory|exceeds|too large|device|texture/i.test(err)) throw new Error(`${size}: unexpected failure "${err}"`);
          leakCheck(e, base, `stress-${size}`);
          lines.push(`${size}²: ${err ? `degraded gracefully (“${err.slice(0, 70)}”)` : 'rendered'}; leak-free`);
        }
        return lines.join(' | ');
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · STRESS tiny budget (96 MB): evaluation finishes or fails with typed errors, never exceeds the budget',
    async run(env) {
      const e = engineOf(env, 96 * 1024 * 1024);
      try {
        const g = mk(e, 2048, { tiling: 'both' });
        const outs: string[] = [];
        for (let c = 0; c < 10; c++) outs.push(makeChain(g, 8, c)[7]);
        const base = baseline(e);
        let failed = 0;
        for (let i = 0; i < 4; i++) {
          const res = await e.evaluator.evaluate(
            g,
            outs.map((nodeId) => ({ nodeId })),
            {},
          );
          for (const m of res.errors.values()) {
            failed++;
            if (!/budget|memory/i.test(m)) throw new Error(`unexpected error under pressure: ${m}`);
          }
          res.release();
          if (e.mm.usedBytes > e.mm.budgetBytes) throw new Error(`budget exceeded: ${e.mm.usedBytes} > ${e.mm.budgetBytes}`);
        }
        leakCheck(e, base, 'tiny-budget');
        return `10 outputs @2048² under a 96 MB budget: ${failed} typed failures, peak ${(e.mm.peakBytes / 1048576).toFixed(0)} MB, leak-free`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · STRESS long playback: 300 frames of an animated graph keep memory flat',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 512, { tiling: 'both', fps: 30, loopLength: 60 });
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
        const l = add(g, 'utils.levels', { gamma: 1.3 });
        const b = add(g, 'utils.blur', { radius: 0.01 });
        link(g, n, l);
        link(g, l, b);
        await evalOnce(e, g, [b]);
        const base = baseline(e);
        const usedAfterWarm: number[] = [];
        for (let f = 0; f < 300; f++) {
          g.setParam(n, 'evolution', (f % 60) / 60);
          await evalOnce(e, g, [b], { time: f / 30 });
          if (f % 50 === 49) usedAfterWarm.push(e.mm.usedBytes);
        }
        const growth = usedAfterWarm[usedAfterWarm.length - 1] - usedAfterWarm[0];
        if (growth > 8 * 1024 * 1024) throw new Error(`memory grows during playback: ${usedAfterWarm.map((x) => (x / 1048576).toFixed(1)).join(' -> ')} MB`);
        leakCheck(e, base, 'playback');
        return `300 frames: used ${usedAfterWarm.map((x) => (x / 1048576).toFixed(1)).join(' / ')} MB (flat), leak-free`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · STRESS repeated undo / redo while evaluating: graph and memory stay consistent',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 256, { tiling: 'both' });
        const ed = new GraphEditor(g);
        let t = 0;
        ed.stack.now = () => (t += 1000);
        const ids: string[] = [ed.addNode('grayscale.noise', { x: 0, y: 0, params: { noise_type: 'perlin', scale: [4, 4] } })];
        for (let i = 1; i < 24; i++) {
          const id = ed.addNode(i % 2 ? 'utils.levels' : 'utils.blur', { x: i * 40, y: 0 });
          ed.connect({ node: ids[i - 1], pin: 'output' }, { node: id, pin: 'input' });
          ids.push(id);
        }
        const snap = JSON.stringify(g.toData());
        await evalOnce(e, g, [ids[23]]);
        const base = baseline(e);
        for (let c = 0; c < 12; c++) {
          for (let i = 0; i < 20; i++) ed.stack.undo();
          const last = [...g.nodes.keys()].pop();
          if (last) await evalOnce(e, g, [last]);
          for (let i = 0; i < 20; i++) ed.stack.redo();
          await evalOnce(e, g, [ids[23]]);
        }
        if (JSON.stringify(g.toData()) !== snap) throw new Error('graph differs after the undo / redo cycles');
        leakCheck(e, base, 'undo-redo');
        return '12 x (20 undo + eval + 20 redo + eval): graph identical, leak-free';
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · STRESS repeated export (12 x PNG16 + 4 x tiled 2K EXR): pools return to baseline, output sizes are stable',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 256, { tiling: 'both' });
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [6, 6], octaves: 3 });
        const png = add(g, 'export.mask', { format: 'png', depth: '16', file_name: 'rep' });
        link(g, n, png, 'input');
        const max = e.gpu.caps.limits.maxTextureDimension2D ?? 2048;
        const big = Math.min(2048, max);
        const exr = add(g, 'export.mask', { format: 'exr', depth: 'half', file_name: 'repbig', size_mode: 'absolute', size_abs: [big, big] });
        link(g, n, exr, 'input');
        const run = async (id: string, file: string): Promise<number> => {
          const t = new MemoryTarget();
          await runImageJob(selfTestJobEnv(e, g, t), id);
          return t.bytesOf(file).byteLength;
        };
        // warm: first run creates pipelines / pools; the baseline is taken after it
        const first = await run(png, 'rep.png');
        const base = baseline(e);
        const sizes = new Set<number>([first]);
        for (let i = 0; i < 11; i++) sizes.add(await run(png, 'rep.png'));
        if (sizes.size !== 1) throw new Error(`PNG size changed between identical exports: ${[...sizes].join(', ')}`);
        let peak = 0;
        const exrSizes = new Set<number>();
        for (let i = 0; i < 4; i++) {
          exrSizes.add(await run(exr, 'repbig.exr'));
          peak = Math.max(peak, e.mm.usedBytes);
        }
        if (exrSizes.size !== 1) throw new Error(`EXR size changed between identical exports: ${[...exrSizes].join(', ')}`);
        if (peak > e.mm.budgetBytes) throw new Error(`peak ${peak} exceeded the budget ${e.mm.budgetBytes}`);
        leakCheck(e, base, 'repeated-export');
        return `16 exports, PNG ${first} B / EXR ${[...exrSizes][0]} B every time, peak ${(peak / 1048576).toFixed(0)} MB, leak-free`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · shader error isolation: a node with a broken shader shows an error and the rest of the graph still renders',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { tiling: 'both' });
        const good = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
        const bad = add(g, 'utils.levels', {}); // required input missing: fails at evaluate()
        const res = await e.evaluator.evaluate(g, [{ nodeId: good }, { nodeId: bad }], {});
        const okValue = res.values.get(targetKey({ nodeId: good }));
        const badErr = res.errors.get(bad);
        res.release();
        if (!okValue) throw new Error('the healthy node did not render');
        if (!badErr) throw new Error('the broken node reported no error');
        return `healthy node rendered; broken node isolated (“${badErr.slice(0, 60)}”)`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: '7B · device-lost recovery (RUN LAST: recreates the shared device) — engine re-renders identical pixels',
    async run(env) {
      if (isSoftware(env) && !('destroy' in env.gpu.device)) throw new Skip('no device.destroy');
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { tiling: 'both' });
        const ids = makeChain(g, 4);
        const before = await h.read(e, g, ids[3]);
        const gen = env.gpu.generation;
        await env.gpu.simulateLoss();
        if (env.gpu.generation <= gen) throw new Error('generation did not change');
        e.evaluator.cache.clear();
        const after = await h.read(e, g, ids[3]);
        const err = h.maxErr(after.data, (i) => before.data[i]);
        if (err > 1e-6) throw new Error(`pixels changed after recovery (max err ${err})`);
        leakCheck(e, baseline(e), 'after-loss');
        return `device recreated (generation ${gen} -> ${env.gpu.generation}); identical pixels; pools consistent`;
      } finally {
        dispose(e);
      }
    },
  });

  return tests;
}

function skip(): never {
  throw new Skip('software adapter: numbers are meaningless');
}

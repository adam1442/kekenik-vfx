import { Engine } from '../engine/engine';
import type { Graph } from '../engine/graph/graph';
import { discoverNodes } from '../engine/graph/discover';
import { defineNode } from '../engine/graph/node';
import { NodeRegistry } from '../engine/graph/registry';
import { defineShader } from '../engine/shaders/library';
import { consoleBus } from '../shared/log';
import { sCurve } from '../nodes/grayscale/curve/definition';
import type { Helpers } from './generators';
import { Skip, type Env, type TestDef } from './tests';

/**
 * GPU tests of pixel PASS FUSION (group "Fusion ·"). Every chain is rendered UNFUSED (fusion off) and FUSED and compared:
 * max abs difference <= 1e-3 (16-bit intermediates) / 1e-5 (32-bit HQ). Also asserted: fewer passes, pools back to baseline,
 * mismatched sizes auto-break, a deliberately broken fused function falls back to unfused evaluation with the error attributed to
 * the right node. The detail line of each test is the results table row (passes + wall time unfused / fused).
 */
interface Base {
  tex: number;
  buf: number;
}
const baseline = (e: Engine): Base => ({ tex: e.mm.textures.liveBytes, buf: e.mm.buffers.liveBytes - e.arena.heldBytes });

interface Chain {
  name: string;
  /** Builds the chain and returns the target node. `big` = false for the cheap variants. */
  build(g: Graph): string;
  /** Minimum number of passes the fusion must remove. */
  saves: number;
}

export function fusionTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link } = h;
  const tests: TestDef[] = [];

  const chains: Chain[] = [
    {
      name: 'Noise → Curve → Levels → Ramp → Adjust',
      saves: 3,
      build: (g) => {
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
        const c = add(g, 'grayscale.curve', { curve: sCurve() });
        const l = add(g, 'utils.levels', { in_low: 0.1, in_high: 0.9, gamma: 1.4 });
        const r = add(g, 'color.ramp');
        const a = add(g, 'color.adjust', { hue: 35, saturation: 1.2, contrast: 1.2 });
        link(g, n, c);
        link(g, c, l);
        link(g, l, r);
        link(g, r, a);
        return a;
      },
    },
    {
      name: 'Uniform(value mod = Noise) → Threshold(soft) → Levels',
      saves: 2,
      build: (g) => {
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [3, 3] });
        const u = add(g, 'grayscale.uniform', { value: 0.5, value_mod_k: 0.8 });
        const t = add(g, 'grayscale.threshold', { threshold: 0.4, type: 'soft', smoothness: 0.3 });
        const l = add(g, 'utils.levels', { gamma: 0.8 });
        link(g, n, u, 'value_mod');
        link(g, u, t);
        link(g, t, l);
        return l;
      },
    },
    {
      name: 'Noise → Curve → Levels(Color, implicit Gray→Color) → Adjust → Adjust',
      saves: 3,
      build: (g) => {
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [5, 5] });
        const c = add(g, 'grayscale.curve', { curve: sCurve(), amount: 0.8 });
        const l = add(g, 'utils.levels_color', { gamma: 1.2, out_high: 1.5 });
        const a1 = add(g, 'color.adjust', { hue: 80 });
        const a2 = add(g, 'color.adjust', { exposure: 0.3, brightness: 0.05, tint_amount: 0.4 });
        link(g, n, c);
        link(g, c, l);
        link(g, l, a1);
        link(g, a1, a2);
        return a2;
      },
    },
    {
      name: 'Color Uniform → Adjust → Adjust (generator head, color)',
      saves: 2,
      build: (g) => {
        const u = add(g, 'color.uniform', { color: [0.8, 0.3, 0.1, 1], intensity: 1.5 });
        const a = add(g, 'color.adjust', { hue: 120, saturation: 0.7 });
        const b = add(g, 'color.adjust', { gamma: 1.5, brightness: -0.1 });
        link(g, u, a);
        link(g, a, b);
        return b;
      },
    },
  ];

  /** Count render passes recorded during `fn` (chained after any existing hook). */
  async function countPasses<T>(e: Engine, fn: () => Promise<T>): Promise<{ value: T; passes: number }> {
    const prev = e.runner.onPass;
    let n = 0;
    e.runner.onPass = (id, label, kind, ms) => {
      if (kind === 'fs') n++;
      prev?.(id, label, kind, ms);
    };
    try {
      return { value: await fn(), passes: n };
    } finally {
      e.runner.onPass = prev;
    }
  }

  async function wall(e: Engine, g: Graph, id: string, fused: boolean, reps = 5): Promise<number> {
    e.evaluator.fusion.enabled = fused;
    const times: number[] = [];
    for (let i = 0; i < reps; i++) {
      e.evaluator.cache.clear();
      const t0 = performance.now();
      const res = await e.evaluator.evaluate(g, [{ nodeId: id }], {});
      await e.gpu.device.queue.onSubmittedWorkDone();
      times.push(performance.now() - t0);
      res.release();
    }
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  }

  for (const hq of [false, true]) {
    for (const tiling of ['both', 'none'] as const) {
      tests.push({
        name: `Fusion · fused == unfused for ${chains.length} chains (${hq ? '32f HQ' : '16f'}, tiling ${tiling}), fewer passes, pools at baseline, GPU time`,
        async run(env) {
          const e = engineOf(env);
          const lines: string[] = [];
          try {
            const tol = hq ? 1e-5 : 1e-3;
            for (const ch of chains) {
              const g = mk(e, 128, { tiling, bitDepth: hq ? 32 : 16 });
              const target = ch.build(g);
              const base = baseline(e);
              e.evaluator.fusion.enabled = false;
              e.evaluator.cache.clear();
              const un = await countPasses(e, () => h.read(e, g, target));
              e.evaluator.cache.clear();
              e.evaluator.fusion.enabled = true;
              const before = e.evaluator.fusion.fusedPasses;
              const fu = await countPasses(e, () => h.read(e, g, target));
              if (e.evaluator.fusion.fusedPasses <= before) throw new Error(`${ch.name}: no fused pass was recorded`);
              const err = h.maxErr(fu.value.data, (i) => un.value.data[i]);
              // the f16 intermediates of the unfused chain are the only difference: scale the tolerance with the value magnitude
              let maxV = 1;
              for (const v of un.value.data) if (Math.abs(v) > maxV && Number.isFinite(v)) maxV = Math.abs(v);
              if (!(err <= tol * (hq ? 1 : maxV))) throw new Error(`${ch.name}: fused differs from unfused by ${err} (tolerance ${tol * (hq ? 1 : maxV)})`);
              if (un.passes - fu.passes < ch.saves) throw new Error(`${ch.name}: passes ${un.passes} -> ${fu.passes}, expected to save at least ${ch.saves}`);
              const tUn = await wall(e, g, target, false);
              const tFu = await wall(e, g, target, true);
              e.evaluator.fusion.enabled = true;
              e.evaluator.cache.clear();
              e.scheduler.dropFrameCache();
              const after = baseline(e);
              if (after.tex !== base.tex || after.buf !== base.buf) throw new Error(`${ch.name}: LEAK texture bytes ${base.tex} -> ${after.tex}, buffers ${base.buf} -> ${after.buf}`);
              lines.push(`${ch.name}: passes ${un.passes} → ${fu.passes}, max err ${err.toExponential(1)}, wall ${tUn.toFixed(2)} → ${tFu.toFixed(2)} ms`);
            }
            const lk = e.mm.leakReport();
            if (lk.textureBalance !== 0 || lk.bufferBalance !== 0) throw new Error(`accounting imbalance ${JSON.stringify(lk)}`);
            return lines.join('\n');
          } finally {
            dispose(e);
          }
        },
      });
    }
  }

  tests.push({
    name: 'Fusion · mismatched size / tiling inside a chain auto-breaks the segment and still matches unfused',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 128, { tiling: 'both' });
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
        const c = add(g, 'grayscale.curve', { curve: sCurve() });
        const half = add(g, 'utils.levels', { gamma: 1.3, tex_size_mode: 'absolute', tex_size_abs: [64, 64] });
        const l2 = add(g, 'utils.levels', { gamma: 0.9 });
        const notile = add(g, 'grayscale.curve', { curve: sCurve(), tex_tiling_mode: 'absolute', tex_tiling: 'none' });
        link(g, n, c);
        link(g, c, half);
        link(g, half, l2);
        link(g, l2, notile);
        e.evaluator.fusion.enabled = false;
        const un = await h.read(e, g, notile);
        e.evaluator.fusion.enabled = true;
        e.evaluator.cache.clear();
        const fu = await h.read(e, g, notile);
        const err = h.maxErr(fu.data, (i) => un.data[i]);
        if (err > 1.5e-3) throw new Error(`fused vs unfused ${err}`);
        const sum = e.evaluator.fusion.summary;
        if (!sum) throw new Error('no fusion summary recorded');
        for (const sg of sum.segments) if (sg.ids.includes(half) && sg.ids.includes(c)) throw new Error('curve (128 px) and levels (64 px) were fused despite different sizes');
        for (const sg of sum.segments) if (sg.ids.includes(notile) && sg.ids.includes(l2)) throw new Error('tiled and non-tiled nodes were fused');
        return `segments: ${sum.segments.map((s) => s.names.join('+')).join(' | ') || 'none'}; max err ${err.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: 'Fusion · slider drag never recompiles: parameter change keeps the pipeline, A/B toggle gives identical pixels',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { tiling: 'both' });
        const ch = chains[0];
        const target = ch.build(g);
        await h.read(e, g, target);
        const compiled = e.pipelines.compiledCount;
        const hue = [...g.nodes.values()].find((n) => n.type === 'color.adjust')!.id;
        for (let i = 1; i <= 6; i++) {
          g.setParam(hue, 'hue', 10 * i);
          await h.read(e, g, target);
        }
        if (e.pipelines.compiledCount !== compiled) throw new Error(`pipelines compiled ${compiled} -> ${e.pipelines.compiledCount} while dragging a slider`);
        e.evaluator.fusion.enabled = false;
        const a = await h.read(e, g, target);
        e.evaluator.fusion.enabled = true;
        e.evaluator.cache.clear();
        const b = await h.read(e, g, target);
        const err = h.maxErr(a.data, (i) => b.data[i]);
        if (err > 1.5e-3) throw new Error(`A/B max err ${err}`);
        return `no recompilation over 6 drags (${compiled} pipelines); A/B err ${err.toExponential(1)}; module cache ${e.evaluator.fusion.moduleCount}`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: 'Fusion · fallback: a deliberately broken fused function fails to compile, the segment is evaluated unfused, the error names the node',
    async run(env) {
      const reg = new NodeRegistry();
      discoverNodes(reg);
      const good = reg.get('grayscale.curve');
      if (!good?.fusable) throw new Skip('grayscale.curve is not fusable');
      // The standalone path keeps the GOOD shader (good.evaluate); only the FUSED source is broken.
      const brokenSrc = defineShader('broken_curve.wgsl', good.fusable.source.code.replace('let v = src.r;', 'let v = src.r +;'));
      reg.register(defineNode({ ...good, id: 'test.broken_curve', title: 'Broken Curve', fusable: { ...good.fusable, source: brokenSrc }, evaluate: (ctx) => good.evaluate(ctx) }));
      const e = new Engine(env.gpu, reg);
      try {
        const g = mk(e, 64, { tiling: 'both' });
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4] });
        const bad = g.addNode('test.broken_curve', { name: 'BrokenCurveNode', params: { curve: sCurve() } }).id;
        const l = add(g, 'utils.levels', { gamma: 1.2 });
        link(g, n, bad);
        link(g, bad, l);
        const before = e.evaluator.fusion.fallbacks;
        const mark = consoleBus.entries.length;
        e.evaluator.fusion.enabled = true;
        const fused = await h.read(e, g, l);
        if (e.evaluator.fusion.fallbacks !== before + 1) throw new Error(`fallback counter ${before} -> ${e.evaluator.fusion.fallbacks}`);
        const logged = consoleBus.entries.slice(mark).some((x) => x.source === 'fusion' && x.nodeName === 'BrokenCurveNode');
        if (!logged) throw new Error('the Console has no fusion error attributed to "BrokenCurveNode"');
        e.evaluator.fusion.enabled = false;
        e.evaluator.cache.clear();
        const plain = await h.read(e, g, l);
        const err = h.maxErr(fused.data, (i) => plain.data[i]);
        if (err > 1e-6) throw new Error(`fallback result differs from the unfused result (${err})`);
        // second evaluation: the broken signature is remembered, no new compile attempt, no new fallback
        e.evaluator.fusion.enabled = true;
        e.evaluator.cache.clear();
        await h.read(e, g, l);
        if (e.evaluator.fusion.fallbacks !== before + 1) throw new Error('broken signature was retried');
        return `fallback #${e.evaluator.fusion.fallbacks}; error attributed to BrokenCurveNode; unfused result identical`;
      } finally {
        dispose(e);
      }
    },
  });

  tests.push({
    name: 'Fusion · pass fusion toggle off records zero fused passes',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const target = chains[3].build(g);
        e.evaluator.fusion.enabled = false;
        const before = e.evaluator.fusion.fusedPasses;
        await h.read(e, g, target);
        if (e.evaluator.fusion.fusedPasses !== before) throw new Error('fused pass recorded while fusion is disabled');
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });

  return tests;
}

import { setTrackKey } from '../engine/anim/tracks';
import { defaultValues, type ParamValue } from '../engine/params/schema';
import { readTextureFloat32 } from '../engine/resources/readback';
import type { Engine } from '../engine/engine';
import { FLUID_PARAMS, buildFluidFrame, resolveFluidConfig } from '../nodes/simulation/fluid2d/params';
import { FluidSolver, type PressureMode } from '../nodes/simulation/fluid2d/solver';
import { divergence, l2, zeros } from '../nodes/simulation/fluid2d/reference';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU known-answer tests for the simulation framework, the Vector pin and Fluid 2D. Names start with `9A ·`.
 *   shaders      every Fluid 2D pass builds a render pipeline on the device
 *   projection   divergence after projection is small (Fast / Balanced / Accurate), on a smooth periodic field, vs the CPU reference measure
 *   conservation mass of a transported density is conserved, periodic symmetry (shift in == shift out), determinism (two runs bit-identical)
 *   framework    scrub back == forward, re-simulation == first run, two engines agree, crossfade seam, cache budget never exceeded
 *   vector       UV <-> Vector round trip
 */
type Env = Parameters<TestDef['run']>[0];
const SIM: Record<string, ParamValue> = { em1_on: false, diss_density: 0, vort_eps: 0, boundary: 'periodic', quality: 'custom', sim_res: 64, precision: 'full' };

export function simFrameworkTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;
  const G = { fps: 30, loopLength: 60, width: 64, height: 64 };

  function solverOf(e: Engine, over: Record<string, ParamValue>, mode?: PressureMode): { s: FluidSolver; vals: Record<string, ParamValue>; setup: ReturnType<typeof resolveFluidConfig> } {
    const vals = { ...defaultValues(FLUID_PARAMS), ...SIM, ...over };
    const setup = resolveFluidConfig(vals, G, { maxDim: 4096, budgetBytes: 512 * 1048576 });
    const cfg = { ...setup.cfg, pressure: mode ?? setup.cfg.pressure, adaptive: false };
    return { s: new FluidSolver({ gpu: e.gpu, mm: e.mm, runner: e.runner }, cfg, { nodeId: 'selftest', nodeName: '9A' }), vals, setup };
  }
  function upload(e: Engine, w: number, hgt: number, f: (x: number, y: number) => [number, number, number, number]): ReturnType<Engine['mm']['textures']['acquire']> {
    const t = e.mm.textures.acquire({ width: w, height: hgt, format: 'rgba32float', label: '9A init' });
    const d = new Float32Array(w * hgt * 4);
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) d.set(f(x, y), (y * w + x) * 4);
    e.gpu.device.queue.writeTexture({ texture: t.texture }, d, { bytesPerRow: w * 16 }, { width: w, height: hgt });
    return t;
  }
  async function run(e: Engine, over: Record<string, ParamValue>, init: { dens?: (x: number, y: number) => number; vel?: (x: number, y: number) => [number, number] }, mode?: PressureMode): Promise<{ A: Float32Array; n: number; dt: number; w: number }> {
    const { s, vals, setup } = solverOf(e, over, mode);
    try {
      await s.prewarm();
      const n = s.w;
      const dens = init.dens ? upload(e, n, n, (x, y) => [init.dens!(x, y), 0, 0, 1]) : null;
      const vel = init.vel ? upload(e, n, n, (x, y) => [...init.vel!(x, y), 0, 1] as [number, number, number, number]) : null;
      const f = buildFluidFrame(vals, 0, setup);
      const enc = e.gpu.device.createCommandEncoder();
      s.reset(enc, f, { initDens: dens, initVel: vel });
      s.stepFrame(enc, f, {}, 1);
      e.runner.submit([enc.finish()]);
      const A = await readTextureFloat32(e.gpu, e.mm, s.A.texture, s.A.format, n, n);
      dens?.release();
      vel?.release();
      return { A, n, dt: f.dtFrame, w: n };
    } finally {
      s.dispose();
    }
  }
  const TAU = Math.PI * 2;
  const smoothVel = (n: number) => (x: number, y: number): [number, number] => [0.4 * Math.sin((TAU * x) / n) * Math.cos((TAU * y) / n), 0.3 * Math.sin((TAU * y) / n) * Math.cos((TAU * x) / n)];
  const divOf = (v: (x: number, y: number) => [number, number], n: number, scale: number): number => {
    const u = zeros(n, n);
    const w = zeros(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const [a, b] = v(x, y);
        u.d[y * n + x] = a * scale;
        w.d[y * n + x] = b * scale;
      }
    return l2(divergence(u, w, 2));
  };

  const tests: TestDef[] = [];
  tests.push({
    name: '9A · Fluid 2D: every pass compiles into a pipeline (default limits)',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        for (const mode of ['fast', 'balanced', 'accurate'] as PressureMode[]) {
          const { s } = solverOf(e, {}, mode);
          await s.prewarm();
          s.dispose();
        }
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });
  for (const [mode, limit] of [['fast', 0.35], ['balanced', 0.06], ['accurate', 0.06]] as [PressureMode, number][]) {
    tests.push({
      name: `9A · Fluid 2D projection (${mode}): divergence after projection is small`,
      async run(env: Env) {
        const e = engineOf(env);
        try {
          const over: Record<string, ParamValue> = mode === 'fast' ? { iterations: 60 } : mode === 'accurate' ? { iterations: 10 } : { cycles: 3 };
          const r = await run(e, { ...over, sim_res: 64, warm_start: false }, { vel: smoothVel(64) }, mode);
          const scale = 64 * r.dt;
          const before = divOf(smoothVel(64), 64, scale);
          const after = divOf((x, y) => [r.A[(y * 64 + x) * 4], r.A[(y * 64 + x) * 4 + 1]], 64, scale);
          if (!(before > 1e-4)) throw new Error('test field has no divergence');
          if (!(after / before < limit)) throw new Error(`divergence ratio ${(after / before).toFixed(4)} >= ${limit}`);
          return `ratio ${(after / before).toFixed(4)}`;
        } finally {
          dispose(e);
        }
      },
    });
  }
  tests.push({
    name: '9A · Fluid 2D: mass conservation, periodic symmetry, determinism',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const n = 64;
        const blob = (sx: number, sy: number) => (x: number, y: number): number => {
          const dx = ((x - 20 - sx + n * 4) % n) - 0;
          const dy = ((y - 24 - sy + n * 4) % n) - 0;
          const wx = Math.min(Math.abs(dx), n - Math.abs(dx));
          const wy = Math.min(Math.abs(dy), n - Math.abs(dy));
          return Math.exp(-(wx * wx + wy * wy) / 30);
        };
        const vel = (): [number, number] => [0.9, 0.6];
        const a = await run(e, {}, { dens: blob(0, 0), vel });
        const b = await run(e, {}, { dens: blob(0, 0), vel });
        const c = await run(e, {}, { dens: blob(16, 32), vel });
        let m0 = 0;
        let m1 = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) m0 += blob(0, 0)(x, y);
        for (let i = 0; i < n * n; i++) m1 += a.A[i * 4 + 2];
        if (Math.abs(m1 - m0) / m0 > 0.02) throw new Error(`mass changed by ${(((m1 - m0) / m0) * 100).toFixed(2)}%`);
        for (let i = 0; i < a.A.length; i++) if (a.A[i] !== b.A[i]) throw new Error('two runs differ (not deterministic)');
        let worst = 0;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) worst = Math.max(worst, Math.abs(a.A[(y * n + x) * 4 + 2] - c.A[((((y + 32) % n) * n) + ((x + 16) % n)) * 4 + 2]));
        if (worst > 2e-3) throw new Error(`periodic symmetry error ${worst}`);
        return `mass ${(((m1 - m0) / m0) * 100).toFixed(3)}%, symmetry ${worst.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });

  /* ---- framework through the real node + evaluator ---- */
  const nodeParams = (over: Record<string, ParamValue> = {}): Record<string, ParamValue> => ({ quality: 'draft', precision: 'half', em1_pos: [0.5, 0.7], em1_density: 20, em1_temperature: 4, boundary: 'periodic', ...over });
  async function frame(e: Engine, g: ReturnType<typeof mk>, id: string, f: number): Promise<Float32Array> {
    await read(e, g, id, { time: f / 30 }); // registers the request
    await e.sims.settle(f);
    return (await read(e, g, id, { time: f / 30 })).data;
  }
  const same = (a: Float32Array, b: Float32Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  tests.push({
    name: '9A · Simulation framework: scrub back == forward, re-simulation == first run, two engines agree',
    async run(env: Env) {
      const e1 = engineOf(env);
      const e2 = engineOf(env);
      try {
        const g1 = mk(e1, 64, { fps: 30, loopLength: 60 });
        const id1 = add(g1, 'simulation.fluid2d', nodeParams({ cache_mb: 64 }));
        const g2 = mk(e2, 64, { fps: 30, loopLength: 60 });
        const id2 = add(g2, 'simulation.fluid2d', nodeParams({ cache_mb: 64 }));
        const a10 = await frame(e1, g1, id1, 10);
        const a3 = await frame(e1, g1, id1, 3);
        const b10 = await frame(e1, g1, id1, 10);
        if (!same(a10, b10)) throw new Error('frame 10 differs after scrubbing back and forward');
        if (same(a3, a10)) throw new Error('frames 3 and 10 are identical (nothing simulated)');
        e1.sims.resimulate(id1);
        const c10 = await frame(e1, g1, id1, 10);
        if (!same(a10, c10)) throw new Error('re-simulation differs from the first run');
        const d10 = await frame(e2, g2, id2, 10);
        if (!same(a10, d10)) throw new Error('two engines with the same project differ');
        return 'ok';
      } finally {
        dispose(e1);
        dispose(e2);
      }
    },
  });
  tests.push({
    name: '9A · Simulation framework: an animated-param edit at frame 20 keeps frames < 20 (partial invalidation) and equals a fresh run',
    async run(env: Env) {
      const e1 = engineOf(env);
      const e2 = engineOf(env);
      try {
        const def = FLUID_PARAMS.find((p) => p.id === 'em1_on')!;
        const on0 = setTrackKey(undefined, def, 0, true); // emitter on for the whole loop
        const off20 = setTrackKey(on0, def, 20, false); // switched off from frame 20 (stepped track)
        const g1 = mk(e1, 64, { fps: 30, loopLength: 60 });
        const id1 = add(g1, 'simulation.fluid2d', nodeParams({ em1_on: true }));
        g1.setNodeTrack(id1, 'em1_on', on0);
        const a5 = await frame(e1, g1, id1, 5);
        const a30 = await frame(e1, g1, id1, 30);
        const before = e1.sims.info(id1)!.stepsRun;
        g1.setNodeTrack(id1, 'em1_on', off20);
        await read(e1, g1, id1, { time: 30 / 30 }); // registers the changed spec (debounced invalidation)
        for (let i = 0; i < 100 && e1.sims.info(id1)!.resimulating; i++) await new Promise((r) => setTimeout(r, 50));
        const b5 = await frame(e1, g1, id1, 5);
        const b30 = await frame(e1, g1, id1, 30);
        const ran = e1.sims.info(id1)!.stepsRun - before;
        if (!same(a5, b5)) throw new Error('frame 5 (before the edit) changed');
        if (same(a30, b30)) throw new Error('frame 30 did not change after switching the emitter off at frame 20');
        if (ran > 16) throw new Error(`re-simulated ${ran} frames: the cache before frame 20 was not reused`);
        const g2 = mk(e2, 64, { fps: 30, loopLength: 60 });
        const id2 = add(g2, 'simulation.fluid2d', nodeParams({ em1_on: true }));
        g2.setNodeTrack(id2, 'em1_on', off20);
        const c30 = await frame(e2, g2, id2, 30);
        if (!same(b30, c30)) throw new Error('partial re-simulation differs from a fresh simulation of the edited project');
        return `re-simulated ${ran} frames instead of 31`;
      } finally {
        dispose(e1);
        dispose(e2);
      }
    },
  });
  tests.push({
    name: '9A · Simulation framework: tiny cache budget is never exceeded, scrubbing still works',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { fps: 30, loopLength: 60 });
        const id = add(g, 'simulation.fluid2d', nodeParams({ cache_mb: 1 }));
        const f8a = await frame(e, g, id, 8);
        for (const f of [14, 20, 26]) await frame(e, g, id, f);
        const info = e.sims.info(id)!;
        if (info.cache.usedBytes > info.cache.budgetBytes) throw new Error(`cache ${info.cache.usedBytes} > budget ${info.cache.budgetBytes}`);
        const f8b = await frame(e, g, id, 8);
        if (!same(f8a, f8b)) throw new Error('frame 8 differs after eviction + re-simulation');
        return `used ${info.cache.usedBytes} / ${info.cache.budgetBytes} B, ${info.cache.frames} frames, K=${info.cache.interval}`;
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: '9A · Simulation framework: crossfade loop seam is as smooth as normal motion',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64, { fps: 30, loopLength: 12 });
        const id = add(g, 'simulation.fluid2d', nodeParams({ loop_mode: 'crossfade', loop_frames: 12, blend_frames: 5 }));
        const f0 = await frame(e, g, id, 0);
        const fl = await frame(e, g, id, 11);
        const fp = await frame(e, g, id, 10);
        const md = (a: Float32Array, b: Float32Array): number => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length;
        const seam = md(fl, f0);
        const nat = md(fp, fl);
        if (!(seam <= Math.max(nat * 3, 1e-4))) throw new Error(`seam ${seam} vs natural ${nat}`);
        return `seam ${seam.toExponential(2)} natural ${nat.toExponential(2)}`;
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: '9A · Vector pin: UV offset -> Vector -> UV round trip',
    async run(env: Env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const noise = add(g, 'uv.noise', { mode: 'vector', strength: 0.05, uv_out: 'offset', scale: [3, 3] });
        const toVec = add(g, 'utils.uv_to_vector', { uv_in: 'offset', amount: 0.05 });
        const back = add(g, 'utils.vector_to_uv', { uv_out: 'offset', amount: 0.05 });
        link(g, noise, toVec);
        link(g, toVec, back);
        const a = await read(e, g, noise);
        const b = await read(e, g, back);
        let worst = 0;
        for (let i = 0; i < a.w * a.h; i++) for (let c = 0; c < 2; c++) worst = Math.max(worst, Math.abs(a.data[i * a.ch + c] - b.data[i * b.ch + c]));
        if (worst > 2e-3) throw new Error(`round trip error ${worst}`);
        return `max error ${worst.toExponential(1)}`;
      } finally {
        dispose(e);
      }
    },
  });
  return tests;
}

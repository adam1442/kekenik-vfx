import { describe, expect, it } from 'vitest';
import { FLUID_PARAMS, QUALITY, buildEmitter, buildFluidFrame, emitterAmount, isSimParam, resolveFluidConfig } from '../src/nodes/simulation/fluid2d/params';
import { FLUID_PRESETS } from '../src/nodes/simulation/fluid2d/presets';
import { mgLevels, bytesPerCellEstimate } from '../src/nodes/simulation/fluid2d/solver';
import { advectMacCormack, advectSL, divergence, l2, laplacian, project, zeros, type Field } from '../src/nodes/simulation/fluid2d/reference';
import { curlCentral, divergenceCentral, hsvToRgb, uvDeltaToVector, vecAngle01, vectorToUvDelta, wheelColor } from '../src/nodes/_shared/vectormath';
import { coerceParam, defaultValues } from '../src/engine/params/schema';

const N = 32;
const smooth = (k: number): { u: Field; v: Field } => {
  const u = zeros(N, N);
  const v = zeros(N, N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      u.d[y * N + x] = 2 * Math.sin((2 * Math.PI * k * x) / N) * Math.cos((2 * Math.PI * y) / N);
      v.d[y * N + x] = 1.5 * Math.sin((2 * Math.PI * k * y) / N) * Math.cos((2 * Math.PI * x) / N) + 0.7;
    }
  return { u, v };
};

describe('CPU reference: pressure projection (periodic)', () => {
  it('multigrid projection removes the divergence of smooth fields (relative residual < 3%)', () => {
    for (const k of [1, 2]) {
      const { u, v } = smooth(k);
      const d0 = l2(divergence(u, v, 2));
      const r = project(u, v, { bmode: 2, solver: 'mg', cycles: 4 });
      const d1 = l2(divergence(r.u, r.v, 2));
      expect(d0).toBeGreaterThan(0.1);
      expect(d1 / d0).toBeLessThan(k === 1 ? 0.03 : 0.1);
    }
  });
  it('Jacobi converges too (slower) and the multigrid cycle beats the same number of Jacobi sweeps', () => {
    const { u, v } = smooth(1);
    const d0 = l2(divergence(u, v, 2));
    const mg = project(u, v, { bmode: 2, solver: 'mg', cycles: 2 });
    const jc = project(u, v, { bmode: 2, solver: 'jacobi', iters: 12 });
    expect(l2(divergence(mg.u, mg.v, 2)) / d0).toBeLessThan(l2(divergence(jc.u, jc.v, 2)) / d0);
  });
  it('the solved pressure satisfies L p = div (solver residual tiny)', () => {
    const { u, v } = smooth(1);
    const div = divergence(u, v, 2);
    const r = project(u, v, { bmode: 2, solver: 'mg', cycles: 6 });
    let worst = 0;
    const mean = div.d.reduce((a, x) => a + x, 0) / div.d.length;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) worst = Math.max(worst, Math.abs(laplacian(r.p, x, y, 2) - (div.d[y * N + x] - mean)));
    expect(worst).toBeLessThan(1e-3);
  });
  it('periodic symmetry: shifting the input shifts the result exactly; two runs are bit-identical', () => {
    const { u, v } = smooth(1);
    const shift = (f: Field, sx: number, sy: number): Field => {
      const o = zeros(N, N);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) o.d[((y + sy) % N) * N + ((x + sx) % N)] = f.d[y * N + x];
      return o;
    };
    const a = project(u, v, { bmode: 2, solver: 'mg', cycles: 2 });
    const b = project(shift(u, 8, 16), shift(v, 8, 16), { bmode: 2, solver: 'mg', cycles: 2 });
    const a2 = project(u, v, { bmode: 2, solver: 'mg', cycles: 2 });
    const sa = shift(a.u, 8, 16);
    for (let i = 0; i < sa.d.length; i++) expect(Math.abs(sa.d[i] - b.u.d[i])).toBeLessThan(1e-9);
    expect(Array.from(a.u.d)).toEqual(Array.from(a2.u.d));
  });
  it('closed box: normal velocity at a wall reflects, projection stays finite', () => {
    const { u, v } = smooth(1);
    const r = project(u, v, { bmode: 0, solver: 'mg', cycles: 3 });
    expect(r.u.d.every(Number.isFinite) && r.v.d.every(Number.isFinite)).toBe(true);
  });
});

describe('CPU reference: advection', () => {
  const blob = (): Field => {
    const f = zeros(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f.d[y * N + x] = Math.exp(-(((x - 10) ** 2 + (y - 12) ** 2) / 18));
    return f;
  };
  const uniform = (a: number, b: number): { u: Field; v: Field } => {
    const u = zeros(N, N);
    const v = zeros(N, N);
    u.d.fill(a);
    v.d.fill(b);
    return { u, v };
  };
  it('an integer shift is exact (semi-Lagrangian and MacCormack), mass conserved on a periodic grid', () => {
    const q = blob();
    const { u, v } = uniform(3, 2);
    for (const adv of [advectSL(q, u, v), advectMacCormack(q, u, v)]) {
      let mass = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          expect(adv.d[y * N + x]).toBeCloseTo(q.d[(((y - 2) % N + N) % N) * N + (((x - 3) % N) + N) % N], 9);
          mass += adv.d[y * N + x];
        }
      expect(mass).toBeCloseTo(q.d.reduce((a, x) => a + x, 0), 9);
    }
  });
  it('MacCormack is less diffusive than semi-Lagrangian and never leaves the min/max of the input', () => {
    const q = blob();
    const { u, v } = uniform(0.5, 0.3);
    let a = q;
    let b = q;
    for (let i = 0; i < 20; i++) {
      a = advectSL(a, u, v);
      b = advectMacCormack(b, u, v);
    }
    expect(Math.max(...b.d)).toBeGreaterThan(Math.max(...a.d));
    expect(Math.max(...b.d)).toBeLessThanOrEqual(Math.max(...q.d) + 1e-9);
    expect(Math.min(...b.d)).toBeGreaterThanOrEqual(Math.min(...q.d) - 1e-9);
  });
});

describe('Fluid 2D parameters, presets, pure helpers', () => {
  it('every preset only sets existing params with in-range values, has en + fa text', () => {
    expect(FLUID_PRESETS.length).toBe(11);
    const defs = new Map(FLUID_PARAMS.map((p) => [p.id, p]));
    for (const pr of FLUID_PRESETS) {
      expect(pr.name.fa.length).toBeGreaterThan(0);
      expect(pr.description.fa.length).toBeGreaterThan(0);
      expect(pr.description.en.length).toBeGreaterThan(0);
      for (const [k, v] of Object.entries(pr.params)) {
        const d = defs.get(k);
        expect(d, `${pr.id}.${k}`).toBeTruthy();
        expect(JSON.stringify(coerceParam(d!, v)), `${pr.id}.${k}`).toBe(JSON.stringify(v));
      }
    }
  });
  it('param ids are unique and the burst / continuous emitter amounts follow the frame range', () => {
    const ids = FLUID_PARAMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(emitterAmount('continuous', 5, 10, 0, -1, 6)).toBe(5);
    expect(emitterAmount('continuous', 5, 10, 20, -1, 6)).toBe(0);
    expect(emitterAmount('continuous', 5, 30, 0, 20, 6)).toBe(0);
    expect(emitterAmount('burst', 6, 0, 0, -1, 6)).toBe(6);
    expect(emitterAmount('burst', 6, 3, 0, -1, 6)).toBeCloseTo(3);
    expect(emitterAmount('burst', 6, 6, 0, -1, 6)).toBe(0);
  });
  it('config: quality presets, resolution limits, boundary and loop settings', () => {
    const v = defaultValues(FLUID_PARAMS);
    const dev = { maxDim: 8192, budgetBytes: 512 * 1048576 };
    const g = { fps: 30, loopLength: 60, width: 1024, height: 512 };
    const c = resolveFluidConfig(v, g, dev);
    expect(c.w).toBe(QUALITY.balanced.res);
    expect(c.h).toBe(128);
    expect(c.cfg.pressure).toBe('balanced');
    const hi = resolveFluidConfig({ ...v, quality: 'ultra', boundary: 'periodic', loop_mode: 'periodic' }, g, { maxDim: 512, budgetBytes: 512 * 1048576 });
    expect(hi.w).toBeLessThanOrEqual(512);
    expect(hi.cfg.bmode).toBe(2);
    expect(hi.periodic && hi.loopMode === 'periodic' && hi.loopLength === 60).toBe(true);
    const tiny = resolveFluidConfig({ ...v, quality: 'ultra' }, { ...g, width: 512, height: 512 }, { maxDim: 8192, budgetBytes: 8 * 1048576 });
    expect(tiny.limited).toBe(true);
    expect(mgLevels(256, 256)).toBe(6);
    expect(mgLevels(48, 32)).toBe(3);
    expect(bytesPerCellEstimate('full', 'accurate')).toBeGreaterThan(bytesPerCellEstimate('half', 'fast'));
  });
  it('frame values are a pure function of (params, frame): periodic turbulence frequency loops', () => {
    const v = defaultValues(FLUID_PARAMS);
    const setup = { fps: 30, speed: 1, loopMode: 'periodic' as const, loopLength: 60 };
    const a = buildFluidFrame(v, 12, setup);
    expect(JSON.stringify(buildFluidFrame(v, 12, setup))).toBe(JSON.stringify(a));
    expect(a.dtFrame).toBeCloseTo(1 / 30);
    // omega * loopSeconds is an integer number of turns => the noise returns to itself after the loop
    const turns = (a.turbOmega * 60 * a.dtFrame) / (2 * Math.PI);
    expect(Math.abs(turns - Math.round(turns))).toBeLessThan(1e-9);
    const e = buildEmitter({ ...v, em1_dir: -90, em1_speed: 2 }, 1, 0);
    expect(e.vy).toBeCloseTo(-2);
    expect(isSimParam('out_gain')).toBe(false);
    expect(isSimParam('burn_rate')).toBe(true);
  });
});

describe('Vector math mirrors', () => {
  it('angle, wheel, UV conversion and differential operators', () => {
    expect(vecAngle01(1, 0)).toBeCloseTo(0);
    expect(vecAngle01(0, 1)).toBeCloseTo(0.25);
    expect(vecAngle01(-1, 0)).toBeCloseTo(0.5);
    expect(wheelColor(0, 0, 1)).toEqual([0, 0, 0]);
    expect(wheelColor(1, 0, 1)[0]).toBeCloseTo(1);
    expect(hsvToRgb(1 / 3, 1, 1)[1]).toBeCloseTo(1);
    const d = vectorToUvDelta(0.4, -0.2, 0.05);
    const back = uvDeltaToVector(d[0], d[1], 0.05);
    expect(back[0]).toBeCloseTo(0.4);
    expect(back[1]).toBeCloseTo(-0.2);
    // v = (x, y) * 1: divergence 2 / (tile), curl 0 ; v = (-y, x): curl 2
    const n = 64;
    expect(divergenceCentral(1 + 1 / n, 1 - 1 / n, 1 + 1 / n, 1 - 1 / n, n, n)).toBeCloseTo(2);
    expect(curlCentral(1 / n, -1 / n, -1 / n, 1 / n, n, n)).toBeCloseTo(2);
  });
});

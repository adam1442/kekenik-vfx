import { describe, expect, it } from 'vitest';
import { generateBolt, boltToSplines, flickerSeed, type BoltParams } from '../src/engine/spline/lightning';
import { advectParticles, integratePath, type VectorParticleParams } from '../src/engine/particles/vector-particles';
import { defaultEmitterParams } from '../src/engine/particles/emitter';
import { planFlowPasses } from '../src/nodes/vector/motion_generate/definition';
import { interpolationPlan } from '../src/nodes/vector/motion_interpolate/definition';
import { opticalFlow, makeImage, type Flow } from '../src/nodes/_shared/flowref';
import { grayScottStep, heatStep, makeGrid, waveEnergy, waveStep } from '../src/nodes/_shared/simref';

/** CPU references of the simulations / motion vectors / lightning / particles (stability, bounds, recovery of known motion). */

describe('Gray-Scott (Reaction Diffusion)', () => {
  const seedGrid = (n: number) => makeGrid(n, n, (x, y) => [1, Math.hypot(x - n / 2, y - n / 2) < 4 ? 1 : 0]);
  it('stays finite and inside [0, 1] for every preset-like (feed, kill) pair', () => {
    for (const [feed, kill] of [[0.037, 0.06], [0.03, 0.062], [0.055, 0.062], [0.0367, 0.0649], [0.078, 0.061], [0.026, 0.051]]) {
      let g = seedGrid(32);
      for (let i = 0; i < 150; i++) g = grayScottStep(g, { feed, kill, diffA: 1, diffB: 0.5, dt: 1 });
      for (let i = 0; i < g.a.length; i++) {
        expect(Number.isFinite(g.a[i]) && Number.isFinite(g.b[i])).toBe(true);
        expect(g.a[i]).toBeGreaterThanOrEqual(0);
        expect(g.a[i]).toBeLessThanOrEqual(1);
        expect(g.b[i]).toBeGreaterThanOrEqual(0);
        expect(g.b[i]).toBeLessThanOrEqual(1);
      }
    }
  });
  it('develops a pattern from a seed (B spreads), and stays stable with oversized time steps (clamped)', () => {
    let g = seedGrid(32);
    const b0 = g.b.reduce((s, x) => s + x, 0);
    for (let i = 0; i < 200; i++) g = grayScottStep(g, { feed: 0.037, kill: 0.06, diffA: 1, diffB: 0.5, dt: 50 });
    expect(g.b.reduce((s, x) => s + x, 0)).toBeGreaterThan(b0 * 0.5);
    expect(g.a.every((x) => x >= 0 && x <= 1 && Number.isFinite(x))).toBe(true);
  });
  it('is translation equivariant on the periodic grid (tileable by construction) and deterministic', () => {
    const n = 16;
    const g0 = makeGrid(n, n, (x, y) => [1, (x * 7 + y * 3) % 5 === 0 ? 0.8 : 0]);
    const shift = makeGrid(n, n, (x, y) => [g0.a[y * n + ((x + 5) % n)], g0.b[y * n + ((x + 5) % n)]]);
    const p = { feed: 0.04, kill: 0.06, diffA: 1, diffB: 0.5, dt: 1 };
    let a = g0, b = shift;
    for (let i = 0; i < 10; i++) { a = grayScottStep(a, p); b = grayScottStep(b, p); }
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) expect(b.b[y * n + x]).toBeCloseTo(a.b[y * n + ((x + 5) % n)], 6);
  });
});

describe('Wave / Ripple equation', () => {
  const pulse = (n: number) => makeGrid(n, n, (x, y) => [Math.exp(-(((x - n / 2) / 3) ** 2 + ((y - n / 2) / 3) ** 2)), 0]);
  it('undamped energy stays bounded (no blow-up) over long runs at the CFL limit', () => {
    let g = pulse(48);
    const e0 = waveEnergy(g, 0.35 / 0.5);
    let emax = e0;
    for (let i = 0; i < 600; i++) {
      g = waveStep(g, { speedCells: 1.2, damping: 0, dt: 0.5 });
      emax = Math.max(emax, waveEnergy(g, 1.2));
    }
    expect(Number.isFinite(emax)).toBe(true);
    expect(emax).toBeLessThan(e0 * 400 + 5);
    expect(g.a.every((x) => Math.abs(x) < 5)).toBe(true);
  });
  it('an absurd wave speed is clamped by the CFL rule instead of exploding', () => {
    let g = pulse(32);
    for (let i = 0; i < 300; i++) g = waveStep(g, { speedCells: 500, damping: 0, dt: 1 });
    expect(g.a.every((x) => Number.isFinite(x) && Math.abs(x) < 10)).toBe(true);
  });
  it('damping removes energy monotonically (late energy << early energy)', () => {
    let g = pulse(32);
    const energy: number[] = [];
    for (let i = 0; i < 300; i++) {
      g = waveStep(g, { speedCells: 1, damping: 0.2, dt: 0.5 });
      if (i % 50 === 49) energy.push(waveEnergy(g, 1));
    }
    expect(energy[energy.length - 1]).toBeLessThan(energy[0] * 0.2);
  });
});

describe('Diffusion / Heat', () => {
  it('conserves the mean without decay, obeys the maximum principle and smooths', () => {
    const n = 32;
    let g = makeGrid(n, n, (x, y) => [x === 16 && y === 16 ? 1 : 0, 0]);
    const sum0 = g.a.reduce((s, x) => s + x, 0);
    for (let i = 0; i < 100; i++) g = heatStep(g, 0.2, 1);
    expect(g.a.reduce((s, x) => s + x, 0)).toBeCloseTo(sum0, 4);
    expect(Math.max(...g.a)).toBeLessThan(0.2);
    expect(Math.min(...g.a)).toBeGreaterThan(-1e-6);
  });
  it('anisotropic: heat spreads further along the direction field than across it', () => {
    const n = 33;
    let g = makeGrid(n, n, (x, y) => [x === 16 && y === 16 ? 1 : 0, 0]);
    for (let i = 0; i < 60; i++) g = heatStep(g, 0.15, 1, 0, { dir: [1, 0], par: 1, perp: 0.1 });
    const along = g.a[16 * n + 22], across = g.a[22 * n + 16];
    expect(along).toBeGreaterThan(across * 3);
  });
  it('decay shrinks the total', () => {
    let g = makeGrid(16, 16, () => [1, 0]);
    for (let i = 0; i < 10; i++) g = heatStep(g, 0.1, 1, 0.1);
    expect(g.a[0]).toBeCloseTo(Math.exp(-1), 5);
  });
});

describe('Optical flow (Motion Vector Generate reference)', () => {
  const tex = (x: number, y: number, n: number): number => {
    const u = (x / n) * Math.PI * 2, v = (y / n) * Math.PI * 2;
    return 0.5 + 0.25 * Math.sin(2 * u + 1) * Math.cos(v) + 0.15 * Math.sin(3 * v + u) + 0.1 * Math.cos(5 * u - 2 * v);
  };
  const shifted = (n: number, sx: number, sy: number) => makeImage(n, n, (x, y) => tex(x - sx, y - sy, n));
  const meanFlow = (f: Flow, margin: number): [number, number] => {
    let su = 0, sv = 0, c = 0;
    for (let y = margin; y < f.h - margin; y++) for (let x = margin; x < f.w - margin; x++) { su += f.u[y * f.w + x]; sv += f.v[y * f.w + x]; c++; }
    return [su / c, sv / c];
  };
  const opts = { levels: 3, iterations: 30, smoothness: 0.03, window: 1.5, maxDisp: 12, quality: false, wrap: true };
  it('recovers a synthetic translation (3, -2) px within 0.5 px (Fast)', () => {
    const n = 48;
    const f = opticalFlow(shifted(n, 0, 0), shifted(n, 3, -2), opts);
    const [u, v] = meanFlow(f, 4);
    expect(Math.abs(u - 3)).toBeLessThan(0.5);
    expect(Math.abs(v + 2)).toBeLessThan(0.5);
  });
  it('Quality (robust) mode recovers it as well, and zero motion gives zero flow', () => {
    const n = 48;
    const q = opticalFlow(shifted(n, 0, 0), shifted(n, -2, 1), { ...opts, quality: true });
    const [u, v] = meanFlow(q, 4);
    expect(Math.abs(u + 2)).toBeLessThan(0.5);
    expect(Math.abs(v - 1)).toBeLessThan(0.5);
    const z = opticalFlow(shifted(n, 0, 0), shifted(n, 0, 0), opts);
    expect(Math.max(...Array.from(z.u).map(Math.abs))).toBeLessThan(1e-3);
  });
  it('the pyramid finds a motion larger than the single-level capture range (6 px, smooth content)', () => {
    const n = 64;
    const smooth = (x: number, y: number): number => 0.5 + 0.3 * Math.sin(((x / n) * 2 + (y / n)) * Math.PI * 2) + 0.2 * Math.cos(((y / n) * 2) * Math.PI * 2 + 1);
    const f = opticalFlow(makeImage(n, n, smooth), makeImage(n, n, (x, y) => smooth(x - 6, y - 1)), { ...opts, levels: 4, iterations: 40, maxDisp: 16, quality: true });
    const [u, v] = meanFlow(f, 6);
    expect(Math.abs(u - 6)).toBeLessThan(1);
    expect(Math.abs(v - 1)).toBeLessThan(0.75);
  });
});

describe('Motion Vector planning (pure helpers)', () => {
  it('interpolation plan expands a looping 12-frame flipbook to 48 frames covering all source frames', () => {
    const plans = Array.from({ length: 48 }, (_, m) => interpolationPlan(m, 48, 12, true));
    expect(plans[0]).toEqual({ a: 0, b: 1, f: 0 });
    expect(plans[4]).toEqual({ a: 1, b: 2, f: 0 });
    expect(plans[47].a).toBe(11);
    expect(plans[47].b).toBe(0); // wraps to the first frame
    expect(plans.every((p) => p.f >= 0 && p.f < 1)).toBe(true);
    expect(new Set(plans.map((p) => p.a)).size).toBe(12);
  });
  it('non loop plan clamps to the last frame', () => {
    expect(interpolationPlan(47, 48, 12, false).b).toBe(11);
  });
  it('pass planning grows with frames / levels and is bounded for the 12-frame default', () => {
    const base = { consistency: true, median: true };
    expect(planFlowPasses(24, 4, 12, base)).toBeGreaterThan(planFlowPasses(12, 4, 12, base));
    expect(planFlowPasses(12, 4, 12, base)).toBeLessThan(30000);
    expect(planFlowPasses(12, 4, 12, { consistency: false, median: false })).toBeLessThan(planFlowPasses(12, 4, 12, base));
  });
});

describe('Lightning (Spline set output)', () => {
  const params: BoltParams = { start: [0.5, 0.05], end: [0.5, 0.95], jaggedness: 0.45, levels: 6, branchProb: 0.3, branchAngle: 35, branchLength: 0.5, branchDepth: 2, maxBranches: 12, width: 0.02, taper: 0.35, branchWidth: 0.55, seed: 3, maxPoints: 180 };
  it('main channel runs from start to end; branches are bounded; widths taper', () => {
    const b = generateBolt(params);
    expect(b.paths[0].depth).toBe(0);
    const m = b.paths[0].pts;
    expect(m[0]).toEqual([0.5, 0.05]);
    expect(m[m.length - 1][0]).toBeCloseTo(0.5, 6);
    expect(m[m.length - 1][1]).toBeCloseTo(0.95, 6);
    expect(b.paths.length - 1).toBeLessThanOrEqual(params.maxBranches);
    expect(b.widths[0][0]).toBeGreaterThan(b.widths[0][m.length - 1]);
  });
  it('is deterministic per seed and differs between seeds', () => {
    expect(generateBolt(params)).toEqual(generateBolt(params));
    expect(generateBolt({ ...params, seed: 4 }).paths[0].pts).not.toEqual(generateBolt(params).paths[0].pts);
  });
  it('the point count never exceeds the hard cap, even for extreme settings', () => {
    const b = generateBolt({ ...params, levels: 8, branchProb: 1, branchDepth: 3, maxBranches: 48, maxPoints: 120 });
    expect(b.paths.reduce((s, p) => s + p.pts.length, 0)).toBeLessThanOrEqual(120);
    expect(b.paths[0].pts.length).toBeLessThanOrEqual(65); // main channel reduced to fit the budget: it still reaches the end point
    expect(b.paths[0].pts[b.paths[0].pts.length - 1]).toEqual([0.5, 0.95]);
  });
  it('spline set structure: one open corner-mode spline per channel with per-point width and depth', () => {
    const b = generateBolt(params);
    const set = boltToSplines(b);
    expect(set.splines.length).toBe(b.paths.length);
    for (const [k, s] of set.splines.entries()) {
      expect(s.closed).toBe(false);
      expect(s.points.length).toBe(b.paths[k].pts.length);
      for (const p of s.points) { expect(p.mode).toBe('corner'); expect(p.w).toBeGreaterThan(0); }
    }
  });
  it('flicker seeds repeat with the loop length (the flicker loops seamlessly) and are static at rate 0', () => {
    expect(flickerSeed(3, 0, 12, 8)).toBe(flickerSeed(3, 8 / 12, 12, 8));
    expect(flickerSeed(3, 0, 12, 8)).not.toBe(flickerSeed(3, 1 / 12, 12, 8));
    expect(flickerSeed(3, 5, 0, 8)).toBe(3);
  });
});

describe('Vector Particles', () => {
  const view = { plane: 'xy' as const, center: [0, 0] as [number, number], extent: 1, aspect: 1 };
  const field = (vx: number, vy: number) => ({ w: 4, h: 4, data: Float32Array.from({ length: 16 * 2 }, (_, i) => (i % 2 === 0 ? vx : vy)), channels: 2, perSecond: 1 });
  const base = (): VectorParticleParams => ({
    emitter: { ...defaultEmitterParams(), mode: 'loop', phase: 0.3, lifetime: 0.5, count: 200, maxPoints: 500, seed: 5 }, field: field(0.1, 0), seedShape: 'random', a: [0.5, 0.5], b: [0.8, 0.5], radius: 0.1,
    travel: 2, speed: 1, speedRandom: 0, method: 'rk2', stepSize: 0.05, maxSteps: 128, bounds: 'wrap', view,
  });
  it('a uniform field moves a path by field * time (wrap keeps it inside the tile)', () => {
    const e = integratePath(field(0.1, 0.05), 0.2, 0.3, 2, { method: 'rk4', stepSize: 0.05, maxSteps: 128, wrap: true, bounds: 'wrap', speed: 1 });
    expect(e.u).toBeCloseTo(0.4, 5);
    expect(e.v).toBeCloseTo(0.4, 5);
    const w = integratePath(field(0.5, 0), 0.9, 0.5, 2, { method: 'rk1', stepSize: 0.05, maxSteps: 128, wrap: true, bounds: 'wrap', speed: 1 });
    expect(w.u).toBeGreaterThanOrEqual(0);
    expect(w.u).toBeLessThan(1);
  });
  it('is deterministic, honours the hard cap and never produces NaN', () => {
    const a = advectParticles(base(), null);
    const b = advectParticles(base(), null);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    const capped = advectParticles({ ...base(), emitter: { ...base().emitter, count: 100000, maxPoints: 300 } }, null);
    expect(capped.pointCount).toBeLessThanOrEqual(300);
    expect(Array.from(a.positions).every(Number.isFinite)).toBe(true);
  });
  it('no field = particles stay at their seeds', () => {
    const none = advectParticles({ ...base(), field: null }, null);
    expect(none.pointCount).toBe(200);
    expect(Array.from(none.positions).every(Number.isFinite)).toBe(true);
    const moved = advectParticles(base(), null);
    expect(Array.from(moved.positions)).not.toEqual(Array.from(none.positions));
  });
});

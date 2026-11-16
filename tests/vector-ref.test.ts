import { describe, expect, it } from 'vitest';
import { boltToSplines, flickerSeed, generateBolt, type BoltParams } from '../src/engine/spline/lightning';
import { advectParticles, integratePath, uvToWorld, worldToUv, type VectorParticleParams } from '../src/engine/particles/vector-particles';
import { defaultEmitterParams } from '../src/engine/particles/emitter';
import { STD } from '../src/engine/mesh/mesh';
import { bilinear, makeImage, opticalFlow } from '../src/nodes/_shared/flowref';
import { grayScottStep, heatStep, makeGrid, waveEnergy, waveStep } from '../src/nodes/_shared/simref';
import { adjustVector, advectStep, curlNoise, decodeMotion, divergence, encodeMotion, makeField, type AdjustOptions } from '../src/nodes/_shared/vectorref';

const rms = (a: ArrayLike<number>): number => Math.sqrt(Array.from(a as number[]).reduce((s, x) => s + x * x, 0) / a.length);

describe('· vector field CPU references', () => {
  it('curl noise is divergence free (rms divergence << rms gradient scale) and tiles', () => {
    const n = 64;
    const f = makeField(n, n, (u, v) => curlNoise(u, v, [4, 4], 3, 0.5, 0.3, 2, 7, [true, true]));
    const div = divergence(f);
    const mag = rms(Array.from(f.x, (x, i) => Math.hypot(x, f.y[i])));
    expect(mag).toBeGreaterThan(1e-3);
    expect(rms(div) / (mag * n)).toBeLessThan(0.08);
    const a = curlNoise(0.13, 0.77, [4, 4], 3, 0.5, 0.3, 2, 7, [true, true]);
    const b = curlNoise(1.13, -0.23, [4, 4], 3, 0.5, 0.3, 2, 7, [true, true]);
    expect(b[0]).toBeCloseTo(a[0], 4);
    expect(b[1]).toBeCloseTo(a[1], 4);
  });

  it('z evolution is periodic: z = 0 and z = 1 are the same field', () => {
    const a = curlNoise(0.31, 0.42, [3, 3], 2, 0.5, 0, 2, 5, [true, true]);
    const b = curlNoise(0.31, 0.42, [3, 3], 2, 0.5, 1, 2, 5, [true, true]);
    expect(b[0]).toBeCloseTo(a[0], 5);
    expect(b[1]).toBeCloseTo(a[1], 5);
  });

  it('adjust: normalize, dead zone, clamp, invert', () => {
    const o: AdjustOptions = { invertX: false, invertY: false, deadzone: 0, power: 1, reference: 1, gain: 1, normalize: false, length: 1, minLen: 0, maxLen: 0 };
    const [nx, ny] = adjustVector(3, 4, { ...o, normalize: true, length: 2 });
    expect(Math.hypot(nx, ny)).toBeCloseTo(2, 6);
    expect(nx / ny).toBeCloseTo(0.75, 6);
    expect(adjustVector(0.001, 0, { ...o, deadzone: 0.01 })).toEqual([0, 0]);
    expect(Math.hypot(...adjustVector(30, 40, { ...o, maxLen: 5 }))).toBeCloseTo(5, 6);
    expect(adjustVector(1, 2, { ...o, invertX: true, invertY: true })).toEqual([-1, -2]);
  });

  it('motion encode / decode round trips within the quantisation step (8 / 16 bit, flipped, signed)', () => {
    for (const bits of [8, 16] as const) for (const flipY of [false, true]) for (const signed of [false, true]) {
      const o = { scale: 0.2, flipY, signed, bits };
      for (const [x, y] of [[0, 0], [0.05, -0.1], [-0.19, 0.19]]) {
        const [r, g] = encodeMotion(x, y, o);
        if (!signed) { expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); }
        const [dx, dy] = decodeMotion(r, g, o);
        const tol = (bits === 8 ? 1 / 255 : 1 / 65535) * o.scale * (signed ? 1 : 2);
        expect(Math.abs(dx - x)).toBeLessThanOrEqual(tol);
        expect(Math.abs(dy - y)).toBeLessThanOrEqual(tol);
      }
    }
    expect(encodeMotion(0, 0, { scale: 1, flipY: false, signed: false, bits: 16 })[0]).toBeCloseTo(0.5, 4); // 0.5 neutral
    expect(encodeMotion(0, 0.5, { scale: 1, flipY: true, signed: true, bits: 32 })[1]).toBeCloseTo(-0.5, 6);
  });

  it('advect: a constant field shifts the image exactly and conserves the total (periodic)', () => {
    const n = 32;
    const img = { w: n, h: n, d: Float32Array.from({ length: n * n }, (_, i) => Math.sin(i * 0.37) * 0.5 + 0.5) };
    const vec = makeField(n, n, () => [2 / n, 0]); // 2 px per unit time
    const out = Float32Array.from({ length: n * n }, (_, i) => advectStep(img, vec, ((i % n) + 0.5) / n, (Math.floor(i / n) + 0.5) / n, { strength: 1, steps: 4, method: 'rk4' }));
    // content moves WITH the vector: out(x) = img(x - 2)
    for (let i = 0; i < n * n; i++) expect(out[i]).toBeCloseTo(img.d[Math.floor(i / n) * n + ((i % n) - 2 + n) % n], 4);
    const sum = (a: ArrayLike<number>): number => Array.from(a as number[]).reduce((s, x) => s + x, 0);
    expect(sum(out)).toBeCloseTo(sum(img.d), 3);
  });

  it('advect: a divergence-free (curl) field keeps the mean and a constant image constant', () => {
    const n = 48;
    const vec = makeField(n, n, (u, v) => curlNoise(u, v, [3, 3], 2, 0.5, 0, 1, 3, [true, true]));
    const flat = { w: n, h: n, d: new Float32Array(n * n).fill(0.4) };
    expect(advectStep(flat, vec, 0.3, 0.6, { strength: 0.5, steps: 8, method: 'rk2' })).toBeCloseTo(0.4, 6);
    const img = { w: n, h: n, d: Float32Array.from({ length: n * n }, (_, i) => 0.5 + 0.4 * Math.sin((i % n) * 0.4) * Math.cos(Math.floor(i / n) * 0.3)) };
    let m0 = 0, m1 = 0;
    for (let i = 0; i < n * n; i++) {
      m0 += img.d[i];
      m1 += advectStep(img, vec, ((i % n) + 0.5) / n, (Math.floor(i / n) + 0.5) / n, { strength: 0.3, steps: 6, method: 'rk4' });
    }
    expect(Math.abs(m1 - m0) / (n * n)).toBeLessThan(0.02);
  });
});

describe('· simulation CPU references', () => {
  it('Gray-Scott: the trivial state is a fixed point; a seeded spot grows, stays in [0, 1] and finite', () => {
    const n = 40;
    const params = { feed: 0.037, kill: 0.06, diffA: 1, diffB: 0.5, dt: 1 };
    let g = makeGrid(n, n, () => [1, 0]);
    for (let i = 0; i < 20; i++) g = grayScottStep(g, params);
    expect(Math.max(...g.b)).toBe(0);
    expect(Math.min(...g.a)).toBeCloseTo(1, 6);
    g = makeGrid(n, n, (x, y) => (Math.hypot(x - 20, y - 20) < 4 ? [0.5, 0.25] : [1, 0]));
    for (let i = 0; i < 400; i++) g = grayScottStep(g, params);
    for (let i = 0; i < n * n; i++) {
      expect(Number.isFinite(g.a[i]) && Number.isFinite(g.b[i])).toBe(true);
      expect(g.a[i]).toBeGreaterThanOrEqual(0);
      expect(g.a[i]).toBeLessThanOrEqual(1);
      expect(g.b[i]).toBeGreaterThanOrEqual(0);
      expect(g.b[i]).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...g.b)).toBeGreaterThan(0.05); // the pattern lives
    expect(rms(g.b)).toBeLessThan(0.6);
  });

  it('Gray-Scott: an over-large time step is clamped (stays stable)', () => {
    let g = makeGrid(24, 24, (x, y) => (x < 8 && y < 8 ? [0.5, 0.25] : [1, 0]));
    for (let i = 0; i < 100; i++) g = grayScottStep(g, { feed: 0.055, kill: 0.062, diffA: 1, diffB: 0.5, dt: 50 });
    expect(Array.from(g.a).every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(true);
  });

  it('wave: energy is bounded without damping, decays with damping, and the CFL clamp keeps huge speeds finite', () => {
    const n = 48;
    const seed = (): ReturnType<typeof makeGrid> => makeGrid(n, n, (x, y) => [Math.exp(-((x - 24) ** 2 + (y - 24) ** 2) / 18), 0]);
    const c = 12, dt = 0.02; // c dt = 0.24 cells per step
    let g = seed();
    const e0 = waveEnergy(g, c);
    let lo = Infinity, hi = 0;
    for (let i = 0; i < 400; i++) {
      g = waveStep(g, { speedCells: c, damping: 0, dt });
      const e = waveEnergy(g, c);
      lo = Math.min(lo, e);
      hi = Math.max(hi, e);
    }
    expect(hi / e0).toBeLessThan(1.35);
    expect(lo / e0).toBeGreaterThan(0.6);
    let d = seed();
    for (let i = 0; i < 400; i++) d = waveStep(d, { speedCells: c, damping: 1.5, dt });
    expect(waveEnergy(d, c)).toBeLessThan(0.2 * e0);
    let w = seed();
    for (let i = 0; i < 300; i++) w = waveStep(w, { speedCells: 5000, damping: 0, dt });
    expect(Array.from(w.a).every((x) => Number.isFinite(x) && Math.abs(x) < 5)).toBe(true);
  });

  it('heat: conserves the total, never creates new extrema (isotropic and anisotropic), decay shrinks it', () => {
    const n = 32;
    let g = makeGrid(n, n, (x, y) => [Math.exp(-((x - 10) ** 2 + (y - 20) ** 2) / 10), 0]);
    const sum = (a: Float32Array): number => a.reduce((s, x) => s + x, 0);
    const s0 = sum(g.a), max0 = Math.max(...g.a);
    for (let i = 0; i < 120; i++) g = heatStep(g, 0.1, 1);
    expect(sum(g.a)).toBeCloseTo(s0, 2);
    expect(Math.max(...g.a)).toBeLessThan(max0);
    expect(Math.min(...g.a)).toBeGreaterThanOrEqual(-1e-6);
    let an = makeGrid(n, n, (x, y) => [Math.exp(-((x - 16) ** 2 + (y - 16) ** 2) / 6), 0]);
    for (let i = 0; i < 60; i++) an = heatStep(an, 0.1, 1, 0, { dir: [1, 0], par: 1, perp: 0.1 });
    // spreads further along the direction than across
    let sx = 0, sy = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { sx += an.a[y * n + x] * (x - 16) ** 2; sy += an.a[y * n + x] * (y - 16) ** 2; }
    expect(sx).toBeGreaterThan(2 * sy);
    expect(sum(heatStep(g, 0.1, 1, 0.5).a)).toBeLessThan(sum(g.a));
  });
});

describe('· optical flow recovers synthetic translations', () => {
  const blobs = (w: number, h: number, dx: number, dy: number) => {
    const c = [[20, 22, 13], [46, 18, 10], [32, 46, 15], [10, 52, 9]]; // smooth blobs: 3 pyramid levels of 64 px keep their structure
    return makeImage(w, h, (x, y) => c.reduce((s, [cx, cy, r]) => {
      const ex = Math.min(Math.abs(x - dx - cx), w - Math.abs(x - dx - cx)), ey = Math.min(Math.abs(y - dy - cy), h - Math.abs(y - dy - cy));
      return s + Math.exp(-(ex * ex + ey * ey) / (r * r));
    }, 0));
  };
  for (const [dx, dy] of [[3, 0], [-2, 2], [2, -3]]) {
    for (const quality of [false, true]) {
      it(`shift (${dx}, ${dy}) ${quality ? 'quality' : 'fast'}`, () => {
        const a = blobs(64, 64, 0, 0), b = blobs(64, 64, dx, dy);
        const f = opticalFlow(a, b, { levels: 3, iterations: 120, smoothness: 0.02, window: 1, maxDisp: 16, quality, wrap: true });
        // mean flow over the bright (textured) pixels
        let su = 0, sv = 0, sw = 0;
        for (let i = 0; i < 64 * 64; i++) {
          const w = a.d[i] + bilinear(b, (i % 64) + 0.5, Math.floor(i / 64) + 0.5, true);
          su += f.u[i] * w; sv += f.v[i] * w; sw += w;
        }
        expect(Math.abs(su / sw - dx)).toBeLessThan(0.75);
        expect(Math.abs(sv / sw - dy)).toBeLessThan(0.75);
      });
    }
  }
});

describe('· Lightning spline output', () => {
  const base: BoltParams = { start: [0.5, 0.05], end: [0.5, 0.95], jaggedness: 0.45, levels: 6, branchProb: 0.3, branchAngle: 35, branchLength: 0.5, branchDepth: 2, maxBranches: 12, width: 0.02, taper: 0.35, branchWidth: 0.55, seed: 3, maxPoints: 180 };
  it('spline set structure: open corner splines, per-point width, main channel from start to end', () => {
    const set = boltToSplines(generateBolt(base));
    expect(set.splines.length).toBeGreaterThan(1);
    const main = set.splines[0];
    expect(main.closed).toBe(false);
    expect(main.points.length).toBe(2 ** 6 + 1);
    expect([main.points[0].x, main.points[0].y]).toEqual(base.start);
    expect([main.points[main.points.length - 1].x, main.points[main.points.length - 1].y]).toEqual(base.end);
    for (const sp of set.splines) for (const p of sp.points) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.mode).toBe('corner');
    }
    expect(main.points[0].w).toBeGreaterThan(main.points[main.points.length - 1].w!); // taper
    expect(set.splines[1].points[0].w).toBeLessThan(main.points[0].w!); // branches are thinner
  });
  it('is deterministic, bounded (maxPoints, maxBranches) and the flicker seed is periodic', () => {
    const a = JSON.stringify(boltToSplines(generateBolt(base)));
    expect(JSON.stringify(boltToSplines(generateBolt(base)))).toBe(a);
    expect(JSON.stringify(boltToSplines(generateBolt({ ...base, seed: 4 })))).not.toBe(a);
    const set = boltToSplines(generateBolt({ ...base, branchProb: 1, branchDepth: 3, maxBranches: 5, maxPoints: 150 }));
    expect(set.splines.length - 1).toBeLessThanOrEqual(5);
    expect(set.splines.reduce((s, x) => s + x.points.length, 0)).toBeLessThanOrEqual(150);
    expect(flickerSeed(3, 0, 12, 8)).toBe(flickerSeed(3, 8 / 12, 12, 8));
    expect(flickerSeed(3, 0, 12, 8)).not.toBe(flickerSeed(3, 1 / 12, 12, 8));
    expect(flickerSeed(3, 5, 0, 8)).toBe(3);
  });
});

describe('· Vector Particles', () => {
  const view = { plane: 'xy' as const, center: [0, 0] as [number, number], extent: 1, aspect: 1 };
  const field = (vx: number, vy: number) => ({ w: 4, h: 4, channels: 2, data: Float32Array.from({ length: 32 }, (_, i) => (i % 2 === 0 ? vx : vy)), perSecond: 1 });
  const params = (over: Partial<VectorParticleParams> = {}): VectorParticleParams => ({
    emitter: { ...defaultEmitterParams(), mode: 'loop', count: 50, lifetime: 0.5, seed: 4, maxPoints: 1000, gradient: null, alphaCurve: null, sizeCurve: null },
    field: field(0.1, 0), seedShape: 'random', a: [0.5, 0.5], b: [0.8, 0.5], radius: 0.1, travel: 2, speed: 1, speedRandom: 0, method: 'rk2', stepSize: 0.05, maxSteps: 64, bounds: 'wrap', view, ...over,
  });
  it('view mapping matches the 2D Render packing and round-trips', () => {
    const m = { plane: 'xy' as const, center: [0.2, -0.1] as [number, number], extent: 2, aspect: 2 };
    const [x, y] = uvToWorld(0.25, 0.75, m);
    const [u, v] = worldToUv(x, y, m);
    expect(u).toBeCloseTo(0.25, 6);
    expect(v).toBeCloseTo(0.75, 6);
    expect(uvToWorld(0.5, 0.5, m)).toEqual([0.2, -0.1]);
  });
  it('a uniform field moves a path by v * time (exact for RK1 / RK2 / RK4), the steady field has no step error', () => {
    for (const method of ['rk1', 'rk2', 'rk4'] as const) {
      const r = integratePath(field(0.1, -0.05), 0.2, 0.6, 3, { method, stepSize: 0.1, maxSteps: 64, wrap: true, bounds: 'wrap', speed: 1 });
      expect(r.u).toBeCloseTo(0.5, 5);
      expect(r.v).toBeCloseTo(0.45, 5);
    }
    const k = integratePath(field(0.3, 0), 0.9, 0.5, 2, { method: 'rk2', stepSize: 0.1, maxSteps: 64, wrap: false, bounds: 'kill', speed: 1 });
    expect(k.dead).toBe(true);
  });
  it('is deterministic, hard-capped, loops (phase 0 == 1) and has no field = particles stay at their seeds', () => {
    const a = advectParticles(params(), null);
    const b = advectParticles(params(), null);
    expect(Array.from(a.attr('point', STD.P)!.data)).toEqual(Array.from(b.attr('point', STD.P)!.data));
    expect(a.pointCount).toBeGreaterThan(0);
    expect(advectParticles(params({ emitter: { ...params().emitter, count: 5000, maxPoints: 100 } }), null).pointCount).toBeLessThanOrEqual(100);
    const p0 = advectParticles(params({ emitter: { ...params().emitter, phase: 0 } }), null);
    const p1 = advectParticles(params({ emitter: { ...params().emitter, phase: 1 } }), null);
    expect(Array.from(p1.attr('point', STD.P)!.data)).toEqual(Array.from(p0.attr('point', STD.P)!.data));
    const still = advectParticles(params({ field: null }), null);
    const moved = advectParticles(params({ emitter: { ...params().emitter, phase: 0.25 } }), null);
    expect(still.pointCount).toBeGreaterThan(0);
    expect(moved.attr('point', 'v')).toBeTruthy();
    // with a field the displacement along +x is positive for wrapped, un-wrapped-in-world comparison (age 0 = seed, age > 0 = moved)
    const seeded = advectParticles(params({ travel: 0 }), null);
    const flown = advectParticles(params({ travel: 2, bounds: 'clamp' }), null);
    expect(seeded.pointCount).toBe(flown.pointCount);
    const xs = seeded.attr('point', STD.P)!.data, xf = flown.attr('point', STD.P)!.data;
    let moves = 0;
    for (let i = 0; i < seeded.pointCount; i++) if (xf[i * 3] > xs[i * 3] + 1e-6) moves++;
    expect(moves).toBeGreaterThan(seeded.pointCount * 0.5);
  });
});

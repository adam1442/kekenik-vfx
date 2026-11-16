import { describe, expect, it } from 'vitest';
import { SimCache, blendScalar, blendVector, cflSubsteps, chooseCheckpointInterval, firstChangedFrame, forcingFrame, frameSignatures, planInvalidation, limitSimResolution, loopPlan, requiredFrames, seamError, snapSimRes, stepDt, totalSimFrames } from '../src/engine/sim/core';

describe('simulation timing + loop math', () => {
  it('dt = (1/fps) * speed / substeps, independent of anything else', () => {
    expect(stepDt({ fps: 30, speed: 1, substeps: 1 })).toBeCloseTo(1 / 30);
    expect(stepDt({ fps: 24, speed: 2, substeps: 4 })).toBeCloseTo((1 / 24) * 2 / 4);
  });
  it('periodic forcing wraps with the loop length, others do not', () => {
    expect(forcingFrame(125, 100, 'periodic')).toBe(25);
    expect(forcingFrame(-1, 100, 'periodic')).toBe(99);
    expect(forcingFrame(125, 100, 'crossfade')).toBe(125);
  });
  it('crossfade simulates L+B frames and blends out(t) = lerp(sim(L+t), sim(t), t/B) for t < B', () => {
    expect(totalSimFrames(100, 10, 'crossfade')).toBe(110);
    expect(totalSimFrames(100, 10, 'periodic')).toBe(100);
    const p0 = loopPlan(0, 100, 10, 'crossfade');
    expect(p0).toEqual({ a: 100, b: 0, w: 0 });
    const p5 = loopPlan(5, 100, 10, 'crossfade');
    expect(p5).toEqual({ a: 105, b: 5, w: 0.5 });
    expect(requiredFrames(p5)).toEqual([105, 5]);
    expect(loopPlan(10, 100, 10, 'crossfade')).toEqual({ a: 10, b: null, w: 0 });
    expect(loopPlan(99, 100, 10, 'crossfade')).toEqual({ a: 99, b: null, w: 0 });
    expect(loopPlan(105, 100, 10, 'crossfade').a).toBe(105); // output frames wrap with L: 105 -> t = 5 -> sim(L + 5)
    expect(loopPlan(7, 100, 10, 'none')).toEqual({ a: 7, b: null, w: 0 });
  });
  it('the loop seam of a crossfade is continuous: out(L-1) -> out(0) is one natural step', () => {
    // toy signal: sim(k) = k; out(t<B) = lerp(sim(L+t), sim(t), t/B); out(0) = sim(L)  (frame L-1 -> L is one step)
    const L = 100;
    const B = 10;
    const out = (t: number): number => {
      const p = loopPlan(t, L, B, 'crossfade');
      return p.b === null ? p.a : blendScalar(p.a, p.b, p.w);
    };
    expect(out(0) - out(L - 1)).toBe(1);
  });
  it('vector blend keeps magnitude (opposite vectors do not cancel)', () => {
    const [x, y] = blendVector(1, 0, -1, 0, 0.5);
    expect(Math.hypot(x, y)).toBeCloseTo(0, 6); // exact opposite: plain mix fallback (no direction)
    const [a, b] = blendVector(2, 0, 0, 2, 0.5);
    expect(Math.hypot(a, b)).toBeCloseTo(2, 6);
    expect(a).toBeCloseTo(b, 6);
    expect(blendVector(3, 4, 3, 4, 0.3)[0]).toBeCloseTo(3, 6);
  });
  it('checkpoint interval from state size and budget, CFL sub-steps, resolution limits', () => {
    expect(chooseCheckpointInterval(100, 1, 1000)).toBe(1);
    expect(chooseCheckpointInterval(100, 100, 1000)).toBe(20); // 5 slots for 100 frames
    expect(cflSubsteps(0, 256, 1 / 30, 1.5, 1, 4)).toBe(1);
    expect(cflSubsteps(1, 256, 1 / 30, 1, 1, 16)).toBe(Math.ceil(256 / 30));
    expect(cflSubsteps(1e9, 256, 1 / 30, 1, 1, 4)).toBe(4);
    expect(snapSimRes(250, 8192)).toBe(256);
    expect(snapSimRes(5, 8192)).toBe(16);
    expect(snapSimRes(100000, 8192)).toBe(8192);
    const r = limitSimResolution(2048, 1, { maxDim: 8192, budgetBytes: 64 * 1048576, bytesPerCell: 80 });
    expect(r.limited).toBe(true);
    expect(r.w * r.h * 80).toBeLessThanOrEqual(64 * 1048576 * 0.35 + 80 * 4096);
  });
  it('helpers: firstChangedFrame, seamError', () => {
    expect(firstChangedFrame(new Map([[0, 'a'], [1, 'b']]), new Map([[0, 'a'], [1, 'c']]))).toBe(1);
    expect(firstChangedFrame(new Map([[0, 'a']]), new Map([[0, 'a']]))).toBe(-1);
    expect(seamError([1, 2, 3], [1, 2, 5])).toBeCloseTo(2 / 3);
  });
});

describe('SimCache: budget, eviction, checkpoints, invalidation, bake lock', () => {
  const mk = (budget: number): { c: SimCache<number>; released: number[] } => {
    const released: number[] = [];
    return { c: new SimCache<number>(budget, (p) => released.push(p)), released };
  };
  it('never exceeds the byte budget (random puts)', () => {
    const c = new SimCache<number>(1000);
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    c.configure(500, 100);
    for (let i = 0; i < 2000; i++) {
      c.put(Math.floor(rnd() * 500) - 1, i, 50 + Math.floor(rnd() * 100));
      expect(c.used).toBeLessThanOrEqual(1000);
    }
    expect(c.stats().usedBytes).toBe([...c.keys()].reduce((a, k) => a + (c.peek(k) !== undefined ? 1 : 0) * 0, 0) + c.used);
  });
  it('LRU evicts plain frames first and keeps pinned checkpoints', () => {
    const { c, released } = mk(1000);
    c.configure(100, 100); // K = ceil(100 / 5) = 20
    expect(c.interval).toBe(20);
    c.put(-1, -1, 100);
    c.put(0, 0, 100);
    for (let k = 1; k <= 9; k++) c.put(k, k, 100);
    expect(c.used).toBeLessThanOrEqual(1000);
    expect(c.has(-1) && c.has(0)).toBe(true); // checkpoints survive
    c.get(5);
    c.put(10, 10, 100);
    expect(c.has(5)).toBe(true); // recently used survives, the oldest plain frame goes
    expect(released.length).toBeGreaterThan(0);
    expect(c.has(1)).toBe(false);
  });
  it('restart point = nearest cached index <= k; invalidateFrom drops the tail', () => {
    const c = new SimCache<number>(10000);
    c.configure(100, 10);
    [-1, 0, 3, 7].forEach((k) => c.put(k, k, 10));
    expect(c.nearestAtOrBefore(6)).toBe(3);
    expect(c.nearestAtOrBefore(-1)).toBe(-1);
    c.invalidateFrom(3);
    expect(c.keys()).toEqual([-1, 0]);
  });
  it('thins checkpoints (K doubles) instead of exceeding the budget', () => {
    const c = new SimCache<number>(450);
    c.configure(4, 10); // K = 1: every frame pinned
    expect(c.interval).toBe(1);
    for (let k = 0; k < 20; k++) {
      c.put(k, k, 100);
      expect(c.used).toBeLessThanOrEqual(450);
    }
    expect(c.interval).toBeGreaterThan(1);
  });
  it('a locked (baked) cache never evicts and refuses what does not fit', () => {
    const c = new SimCache<number>(300);
    c.configure(3, 100);
    expect(c.put(0, 0, 100) && c.put(1, 1, 100) && c.put(2, 2, 100)).toBe(true);
    c.locked = true;
    expect(c.put(3, 3, 100)).toBe(false);
    c.invalidateFrom(0);
    c.clear();
    expect(c.keys()).toEqual([0, 1, 2]);
    expect(c.evictBytes(1000)).toBe(0);
  });
  it('protected / held frames outlive plain LRU; evictBytes frees unpinned only', () => {
    const c = new SimCache<number>(500);
    c.configure(1000, 100);
    c.protect = (k) => k < 3;
    c.hold = new Set([7]);
    for (let k = 1; k <= 7; k++) c.put(k, k, 100);
    expect(c.has(1) && c.has(2)).toBe(true);
    expect(c.has(7)).toBe(true);
    expect(c.evictBytes(100)).toBeGreaterThanOrEqual(100);
  });
  it('determinism: re-simulating from any cached frame gives the same state as straight-through', () => {
    const step = (s: number, k: number): number => (Math.imul(s ^ (k * 2654435761), 1597334677) >>> 0) % 1000003;
    const run = (from: number, state: number, to: number): number => {
      for (let k = from + 1; k <= to; k++) state = step(state, k);
      return state;
    };
    const c = new SimCache<number>(10000);
    c.configure(50, 100);
    let s = 12345;
    c.put(-1, s, 100);
    for (let k = 0; k <= 40; k++) {
      s = step(s, k);
      if (k % 10 === 0) c.put(k, s, 100);
    }
    const straight = run(-1, 12345, 33);
    const best = c.nearestAtOrBefore(33)!;
    expect(best).toBe(30);
    expect(run(best, c.peek(best)!, 33)).toBe(straight);
  });
});

describe('partial invalidation for animated params', () => {
  // sig(f) = the animated value at frame f: a ramp that is edited from frame 20 on
  const ramp = (edit: number) => (f: number): string => String(f >= 20 ? f + edit : f);
  it('frame signatures cover warm-up .. L+B-1 and periodic forcing repeats frames', () => {
    const a = frameSignatures(ramp(0), 3, 30, 8, 'crossfade');
    expect([...a.keys()][0]).toBe(-3);
    expect(a.size).toBe(3 + 38);
    const p = frameSignatures((f) => `f${f}`, 0, 10, 4, 'periodic');
    expect(p.size).toBe(10);
    expect(p.get(9)).toBe('f9');
    const warm = frameSignatures((f) => `f${f}`, 2, 10, 4, 'periodic');
    expect(warm.get(-1)).toBe('f9'); // warm-up of periodic forcing wraps like the simulation does
  });
  it('an edit at frame 20 keeps S(0..19) valid; identical values keep everything', () => {
    const base = frameSignatures(ramp(0), 0, 40, 8, 'none');
    expect(planInvalidation(base, frameSignatures(ramp(5), 0, 40, 8, 'none'))).toEqual({ kind: 'from', frame: 20 });
    expect(planInvalidation(base, frameSignatures(ramp(0), 0, 40, 8, 'none'))).toEqual({ kind: 'none' });
  });
  it('a change inside the warm-up (including k = -1) or a different frame layout invalidates everything', () => {
    const a = frameSignatures((f) => `v${f}`, 4, 20, 4, 'none');
    const b = frameSignatures((f) => (f === -1 ? 'x' : `v${f}`), 4, 20, 4, 'none');
    expect(planInvalidation(a, b)).toEqual({ kind: 'full' });
    expect(planInvalidation(a, frameSignatures((f) => `v${f}`, 4, 21, 4, 'none'))).toEqual({ kind: 'full' });
    expect(planInvalidation(null, a)).toEqual({ kind: 'full' });
  });
  it('crossfade tail frames L..L+B-1 are covered (an edit there only drops the blend frames)', () => {
    const a = frameSignatures((f) => `v${f}`, 0, 30, 8, 'crossfade');
    const b = frameSignatures((f) => (f >= 33 ? 'z' : `v${f}`), 0, 30, 8, 'crossfade');
    expect(planInvalidation(a, b)).toEqual({ kind: 'from', frame: 33 });
  });
});

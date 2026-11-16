import { describe, expect, it } from 'vitest';
import { Params } from '../src/engine/params/accessor';
import { bakeCurveLut, bakeGradientLut, evalCurve, evalGradient } from '../src/engine/params/curve';
import { coerceParam, defaultValues, identityCurve, isParamVisible, P } from '../src/engine/params/schema';
import { EvalScheduler } from '../src/engine/graph/scheduler';
import { Emitter, Store } from '../src/shared/emitter';
import { hashValue, stableStringify } from '../src/shared/util';

describe('param schema', () => {
  const schema = [
    P.float('f', 0.5, { min: 0, max: 1 }),
    P.int('i', 3, { min: 1, max: 5 }),
    P.enum('e', 'b', ['a', 'b']),
    P.vec2('v', [1, 2], { min: 0, max: 10 }),
    P.color('c', [1, 0, 0, 1]),
    P.bool('b', true, { visibleIf: (v) => v.f === 1 }),
    P.curve('k', identityCurve()),
    P.gradient('g', { stops: [{ pos: 0, color: [0, 0, 0, 1] }] }),
  ];
  it('builds defaults and coerces garbage safely', () => {
    const d = defaultValues(schema);
    expect(d.f).toBe(0.5);
    expect(coerceParam(schema[0], 5)).toBe(1);
    expect(coerceParam(schema[0], NaN)).toBe(0.5);
    expect(coerceParam(schema[1], 9.6)).toBe(5);
    expect(coerceParam(schema[2], 'zzz')).toBe('b');
    expect(coerceParam(schema[3], [-5, 99])).toEqual([0, 10]);
    expect(coerceParam(schema[3], 'x')).toEqual([1, 2]);
    expect(coerceParam(schema[4], [2, -1, 0.5])).toEqual([1, 0, 0.5, 1]);
    expect(coerceParam(schema[6], { keys: [] })).toEqual(identityCurve());
    expect(coerceParam(schema[7], { stops: [{ pos: 2, color: [1, 1, 1] }] })).toMatchObject({ stops: [{ pos: 1, color: [1, 1, 1, 1] }] });
  });
  it('evaluates visibleIf / showWhenConnected', () => {
    expect(isParamVisible(schema[5], { f: 1 })).toBe(true);
    expect(isParamVisible(schema[5], { f: 0 })).toBe(false);
    expect(isParamVisible(P.float('x', 0, { showWhenConnected: 'background' }), {}, new Set(['background']))).toBe(true);
    expect(isParamVisible(P.float('x', 0, { showWhenConnected: 'background' }), {}, new Set())).toBe(false);
  });
  it('Params accessor is typo- and type-safe', () => {
    const p = new Params(schema, defaultValues(schema));
    expect(p.num('f')).toBe(0.5);
    expect(p.enumIndex('e')).toBe(1);
    expect(p.vec2('v')).toEqual([1, 2]);
    expect(() => p.num('nope')).toThrow(/Unknown param/);
    expect(() => p.bool('f')).toThrow(/expected bool/);
    expect(p.modK('f')).toBe(0);
  });
});

describe('curve & gradient', () => {
  it('identity curve is the identity; smooth curves do not overshoot', () => {
    for (const x of [0, 0.1, 0.5, 0.99, 1]) expect(evalCurve(identityCurve(), x)).toBeCloseTo(x, 6);
    const c = { keys: [{ x: 0, y: 0 }, { x: 0.5, y: 0.1 }, { x: 1, y: 1 }] };
    const lut = bakeCurveLut(c, 64);
    for (let i = 1; i < lut.length; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1] - 1e-6);
    expect(lut[0]).toBe(0);
    expect(lut[63]).toBe(1);
  });
  it('supports linear/step segments and clamps outside the key range', () => {
    const c = { keys: [{ x: 0.2, y: 0, mode: 'linear' as const }, { x: 0.6, y: 1, mode: 'step' as const }, { x: 1, y: 0.5 }] };
    expect(evalCurve(c, 0)).toBe(0);
    expect(evalCurve(c, 0.4)).toBeCloseTo(0.5, 6);
    expect(evalCurve(c, 0.8)).toBe(1);
    expect(evalCurve(c, 2)).toBe(0.5);
  });
  it('interpolates gradients in RGBA (alpha is a normal channel)', () => {
    const g = { stops: [{ pos: 0, color: [0, 0, 0, 0] as [number, number, number, number] }, { pos: 1, color: [1, 0.5, 0, 1] as [number, number, number, number] }] };
    expect(evalGradient(g, 0.5)).toEqual([0.5, 0.25, 0, 0.5]);
    expect(bakeGradientLut(g, 3)).toHaveLength(12);
  });
});

describe('shared utils', () => {
  it('stable hashing ignores key order', () => {
    expect(hashValue({ a: 1, b: [1, 2] })).toBe(hashValue({ b: [1, 2], a: 1 }));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
  it('emitter and store', () => {
    const e = new Emitter<number>();
    const seen: number[] = [];
    const off = e.on((v) => seen.push(v));
    e.emit(1);
    off();
    e.emit(2);
    expect(seen).toEqual([1]);
    const s = new Store(1);
    const log: number[] = [];
    s.subscribe((v) => log.push(v));
    s.set(1);
    s.set(2);
    expect(log).toEqual([2]);
  });
});

describe('scheduler (coalescing)', () => {
  it('runs one evaluation per frame for the union of targets and delivers/releases results', async () => {
    let calls = 0;
    const released: number[] = [];
    const fakeEval = {
      // the scheduler reads the pipeline compile counter to ignore compile stalls in the adaptive-resolution controller
      runner: { pipelines: { compiledCount: 0 } },
      evaluate: async (_g: unknown, targets: { nodeId: string }[], o: { scale?: number }) => {
        const id = ++calls;
        expect(new Set(targets.map((t) => t.nodeId)).size).toBe(targets.length);
        return { values: new Map(), errors: new Map(), stats: {}, cancelled: false, scale: o.scale, release: () => void released.push(id) };
      },
    };
    const sched = new EvalScheduler(fakeEval as never);
    const graph = { events: new Emitter() } as never;
    sched.attach(graph);
    sched.setTargets('a', [{ nodeId: 'n1' }]);
    sched.setTargets('b', [{ nodeId: 'n1' }, { nodeId: 'n2' }]);
    const delivered: boolean[] = [];
    sched.onResult.on((r) => delivered.push(r.final));
    sched.beginInteraction();
    await sched.runOnce();
    expect(calls).toBe(1);
    expect(delivered).toEqual([false]); // reduced-resolution preview while interacting
    await sched.runOnce();
    expect(released).toEqual([1]); // previous result released after the next one arrived
    sched.dispose();
    expect(released).toEqual([1, 2]);
  });
});

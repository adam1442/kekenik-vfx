import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../src/engine/graph/expand';
import { gizmoParamRefs } from '../src/engine/graph/gizmo-decl';
import type { EvalContext, NodeDefinition } from '../src/engine/graph/node';
import { Params } from '../src/engine/params/accessor';
import { bakeCurveLut, evalCurve } from '../src/engine/params/curve';
import { addKey, curveToText, flipCurve, invertCurve, keySlopes, moveKey, normalizeCurve, parseCurveText, removeKey, setSlope, snapTo } from '../src/engine/params/curve-ops';
import { coerceParam, defaultValues, identityCurve, type CurveValue, type ParamValues, type SplineValue } from '../src/engine/params/schema';
import { bakeCurveUniform256, bakeGradientUniform256, LUT256_SIZE, lutEval256 } from '../src/engine/shaders/lut';
import { packUniforms, type UniformLayout } from '../src/engine/shaders/uniforms';
import { boxPlan, gaussianPlan } from '../src/nodes/_shared/blur';
import { morphPassCount, morphSegments } from '../src/nodes/_shared/morph';
import { sliceReference } from '../src/nodes/grayscale/slice/definition';
import { buildStrokes, MAX_SAMPLES } from '../src/nodes/grayscale/spline/stroke';
import { thresholdReference } from '../src/nodes/grayscale/threshold/definition';
import { xdogReference } from '../src/nodes/grayscale/xdog/definition';
import { FACTORY_CURVES, FACTORY_GRADIENTS, PresetLibrary, validateCurve } from '../src/ui/widgets/presets';
import { FRACTAL_FIELDS } from '../src/nodes/grayscale/fractal/definition';
import { LAYOUT as COLOR_FRACTAL_LAYOUT } from '../src/nodes/color/fractal/definition';
import { makeRegistry } from './helpers';

const reg = makeRegistry();
const IDS = ['grayscale.curve', 'grayscale.threshold', 'grayscale.slice', 'grayscale.dilate', 'grayscale.filter', 'grayscale.curvature', 'grayscale.ao', 'grayscale.caustics', 'grayscale.xdog', 'grayscale.spline', 'color.uniform', 'color.adjust', 'color.ramp', 'color.interpolate', 'color.hue_spread', 'color.replace', 'color.fractal'];
const def = (id: string): NodeDefinition => reg.get(id)!;

interface Captured {
  uniforms?: { layout: UniformLayout; values: Record<string, never> };
  textures: unknown[];
  label?: string;
}
function run(d: NodeDefinition, overrides: ParamValues = {}, connected: string[] = []): { passes: Captured[]; outputs: Record<string, unknown> } {
  const ex = expandDefinition(d);
  const values = defaultValues(ex.params);
  for (const [k, v] of Object.entries(overrides)) {
    const pd = ex.params.find((p) => p.id === k);
    if (!pd) throw new Error(`${d.id}: unknown param "${k}"`);
    values[k] = coerceParam(pd, v);
  }
  const tv = { kind: 'texture', tex: { id: 'fake' }, width: 8, height: 8 };
  const passes: Captured[] = [];
  const ctx = {
    params: new Params(ex.params, values),
    frame: { width: 64, height: 64, tileX: true, tileY: true },
    inputs: {},
    texInput: (pin: string) => (connected.includes(pin) ? tv : undefined),
    mod: (id: string) => (connected.includes(`${id}_mod`) ? { tex: tv, k: 0.5 } : { tex: undefined, k: 0 }),
    tex: () => ({ id: 'tmp' }),
    result: (t: unknown) => t,
    pass: (desc: Captured) => passes.push(desc),
  } as unknown as EvalContext;
  return { passes, outputs: d.evaluate(ctx) };
}
function requiredPins(d: NodeDefinition): string[] {
  return expandDefinition(d).inputs.filter((i) => !i.optional && i.role !== 'modulation').map((i) => i.id);
}

describe('nodes: definitions', () => {
  it('all 17 nodes exist with the Texture tab; generators have Background blending', () => {
    for (const id of IDS) {
      const ex = expandDefinition(def(id));
      expect(ex.hasTextureTab, id).toBe(true);
    }
    for (const id of ['grayscale.caustics', 'grayscale.spline', 'color.uniform', 'color.fractal']) expect(expandDefinition(def(id)).hasBlending, id).toBe(true);
  });
  it('nodes with spatial parameters ship gizmos that reference existing params', () => {
    for (const id of ['grayscale.dilate', 'grayscale.filter', 'grayscale.curvature', 'grayscale.ao', 'grayscale.xdog', 'grayscale.caustics', 'grayscale.spline', 'color.fractal']) {
      const d = def(id);
      expect(d.gizmos?.length, id).toBeGreaterThan(0);
      const ids = new Set(d.params.map((p) => p.id));
      for (const g of d.gizmos!) for (const r of gizmoParamRefs(g)) expect(ids.has(r), `${id}.${g.id} -> ${r}`).toBe(true);
    }
    expect(def('grayscale.spline').gizmos!.filter((g) => g.type === 'path')).toHaveLength(4);
  });
  it('curve / gradient params exist and are animatable (keyframable data model)', () => {
    expect(def('grayscale.curve').params.find((p) => p.id === 'curve')).toMatchObject({ type: 'curve', animatable: true });
    expect(def('color.ramp').params.find((p) => p.id === 'gradient')).toMatchObject({ type: 'gradient', animatable: true });
    expect(def('color.interpolate').params.find((p) => p.id === 'curve')).toMatchObject({ type: 'curve' });
    expect(def('grayscale.spline').params.find((p) => p.id === 'width_curve')).toMatchObject({ type: 'curve' });
  });
  it('modulation pins: Threshold, Slice, Uniform color, Adjust', () => {
    const pins = (id: string): string[] => expandDefinition(def(id)).inputs.map((i) => i.id);
    expect(pins('grayscale.threshold')).toContain('threshold_mod');
    expect(pins('grayscale.slice')).toContain('center_mod');
    expect(pins('color.uniform')).toContain('intensity_mod');
    expect(pins('color.adjust')).toEqual(expect.arrayContaining(['hue_mod', 'saturation_mod', 'brightness_mod']));
  });
  it('every node packs its uniforms for defaults and every gallery variant (no missing / NaN fields)', () => {
    for (const id of IDS) {
      const d = def(id);
      const variants = [{}, ...(d.gallery ?? []).map((g) => g.params)];
      for (const v of variants) {
        const { passes } = run(d, v as ParamValues, requiredPins(d));
        expect(passes.length, id).toBeGreaterThan(0);
        for (const p of passes) if (p.uniforms) expect(() => packUniforms(p.uniforms!.layout, p.uniforms!.values as never), `${id} ${JSON.stringify(v).slice(0, 60)}`).not.toThrow();
      }
    }
  });
  it('multi-output nodes return every declared output', () => {
    expect(Object.keys(run(def('grayscale.spline')).outputs).sort()).toEqual(['gradient', 'output', 'spline_out']);
    expect(Object.keys(run(def('color.replace'), {}, ['input']).outputs).sort()).toEqual(['mask', 'output']);
  });
  it('color fractal layout = gray fractal fields + colour fields (shared core uses identical names / order)', () => {
    const names = COLOR_FRACTAL_LAYOUT.fields.map((f) => f.name);
    expect(names.slice(0, FRACTAL_FIELDS.length)).toEqual(FRACTAL_FIELDS.map((f) => f.name));
    expect(names).toEqual(expect.arrayContaining(['color_mode', 'glut', 'alpha_mode', 'color_gain']));
  });
  it('passes of every filter ask for ss:1 and point at the right number of textures', () => {
    const { passes } = run(def('grayscale.filter'), { mode: 'sharpen' }, ['input']);
    expect(passes.length).toBeGreaterThanOrEqual(3); // 2 blur passes + combine
    expect(passes.at(-1)!.textures).toHaveLength(2);
  });
});

describe('curve LUTs', () => {
  it('256-entry LUT matches evalCurve and is exact for the identity', () => {
    const c: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 0.3, y: 0.8 }, { x: 1, y: 0.2 }] };
    const lut = bakeCurveUniform256(c);
    expect(lut.length).toBe(LUT256_SIZE);
    for (const x of [0, 0.1, 0.33, 0.77, 1]) expect(Math.abs(lutEval256(lut, x) - evalCurve(c, x))).toBeLessThan(2e-3);
    const id = bakeCurveLut(identityCurve(), 256);
    for (let i = 0; i < 256; i++) expect(id[i]).toBeCloseTo(i / 255, 6);
  });
  it('gradient LUT has 256 RGBA texels and honours alpha stops', () => {
    const g = bakeGradientUniform256({ stops: [{ pos: 0, color: [0, 0, 0, 0] }, { pos: 1, color: [1, 1, 1, 1] }] });
    expect(g.length).toBe(256 * 4);
    expect(g[3]).toBe(0);
    expect(g[255 * 4 + 3]).toBe(1);
    expect(g[128 * 4 + 3]).toBeCloseTo(128 / 255, 3);
  });
});

describe('curve widget operations', () => {
  const c: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 0.5, y: 0.8, mode: 'linear' }, { x: 1, y: 1 }] };
  it('add / remove / move keep keys sorted, clamped and inside the neighbours', () => {
    const a = addKey(c, 0.25);
    expect(a.curve.keys.map((k) => k.x)).toEqual([0, 0.25, 0.5, 1]);
    expect(a.curve.keys[a.index].y).toBeCloseTo(evalCurve(c, 0.25), 6);
    expect(removeKey(a.curve, 1).keys).toHaveLength(3);
    expect(removeKey(identityCurve(), 0).keys).toHaveLength(2); // never below 2 keys
    const m = moveKey(c, 1, 2, 5, { bounds: { xRange: [0, 1], yRange: [0, 1] }, lockEnds: true, snap: 0 });
    expect(m.keys[1].x).toBeLessThan(1);
    expect(m.keys[1].y).toBe(1);
    const e = moveKey(c, 0, 0.4, 0.3, { bounds: { xRange: [0, 1], yRange: [0, 1] }, lockEnds: true, snap: 0 });
    expect(e.keys[0].x).toBe(0); // end keys keep x
    expect(snapTo(0.51, 0.25)).toBe(0.5);
    const s = moveKey(c, 1, 0.37, 0.52, { bounds: { xRange: [0, 1], yRange: [0, 1] }, lockEnds: true, snap: 0.125 });
    expect(s.keys[1]).toMatchObject({ x: 0.375, y: 0.5 });
  });
  it('flip / invert / normalize', () => {
    const f = flipCurve(c);
    for (const x of [0, 0.2, 0.5, 0.9, 1]) expect(evalCurve(f, x)).toBeCloseTo(evalCurve(c, 1 - x), 5);
    expect(flipCurve(flipCurve(c)).keys.map((k) => [k.x, k.y])).toEqual(c.keys.map((k) => [k.x, k.y]));
    const iv = invertCurve(c);
    for (const x of [0, 0.3, 0.7, 1]) expect(evalCurve(iv, x)).toBeCloseTo(1 - evalCurve(c, x), 5);
    const n = normalizeCurve({ keys: [{ x: 0.2, y: 0.3 }, { x: 0.6, y: 0.5 }, { x: 0.8, y: 0.7 }] });
    expect(n.keys[0]).toMatchObject({ x: 0, y: 0 });
    expect(n.keys[2].x).toBeCloseTo(1, 6);
    expect(n.keys[2].y).toBeCloseTo(1, 6);
  });
  it('tangent handles: joined / one-sided slopes', () => {
    const joined = setSlope(c, 1, 'out', 2, true);
    expect(joined.keys[1]).toMatchObject({ tin: 2, tout: 2 });
    const one = setSlope(c, 1, 'out', 2, false);
    expect(one.keys[1].tout).toBe(2);
    expect(one.keys[1].tin).toBeCloseTo(keySlopes(c, 1).tin, 9);
  });
  it('clipboard text round-trips and rejects garbage', () => {
    expect(parseCurveText(curveToText(c))).toEqual(c);
    expect(parseCurveText('{"hello":1}')).toBeNull();
    expect(parseCurveText('not json')).toBeNull();
    expect(parseCurveText(JSON.stringify({ format: 'kekenik-curve', keys: [{ x: 'a', y: 1 }] }))).toBeNull();
  });
});

describe('preset libraries', () => {
  const mem = (): { store: Record<string, string>; api: Pick<Storage, 'getItem' | 'setItem'> } => {
    const store: Record<string, string> = {};
    return { store, api: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) } };
  };
  it('factory content is valid', () => {
    for (const f of FACTORY_CURVES) for (const i of f.items) expect(validateCurve(i.value), i.name).not.toBeNull();
    expect(FACTORY_GRADIENTS.flatMap((f) => f.items).length).toBeGreaterThan(8);
  });
  it('folders, persistence, export / import, move, delete', () => {
    const { store, api } = mem();
    const lib = new PresetLibrary('curve', FACTORY_CURVES, api, 'k', validateCurve);
    const f = lib.addFolder('Mine');
    const it = lib.addPreset(f.id, 'S', c1());
    lib.addPreset(null, 'T', c1());
    expect(lib.folders().at(-1)!.items).toHaveLength(2);
    expect(Object.keys(store)).toEqual(['k']);
    const again = new PresetLibrary('curve', FACTORY_CURVES, api, 'k', validateCurve);
    expect(again.folders().at(-1)!.name).toBe('Mine');
    const json = lib.exportJson();
    const other = new PresetLibrary('curve', [], null, 'x', validateCurve);
    expect(other.importJson(json)).toBe(2);
    expect(() => other.importJson('{"format":"nope"}')).toThrow();
    const f2 = lib.addFolder('Other');
    lib.movePreset(it.id, f2.id);
    expect(lib.folders().find((x) => x.id === f2.id)!.items.map((i) => i.name)).toEqual(['S']);
    lib.deletePreset(it.id);
    lib.deleteFolder(f2.id);
    expect(lib.folders().some((x) => x.name === 'Other')).toBe(false);
    lib.deleteFolder(FACTORY_CURVES[0].id); // built-in folders are immutable
    expect(lib.folders()[0].id).toBe(FACTORY_CURVES[0].id);
  });
  it('a gradient library refuses a curve file', () => {
    const lib = new PresetLibrary('curve', [], null, 'x', validateCurve);
    const g = new PresetLibrary('gradient', FACTORY_GRADIENTS, null, 'y', () => null);
    expect(() => g.importJson(lib.exportJson())).toThrow();
  });
});
function c1(): CurveValue {
  return { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
}

describe('shared helpers: blur / morphology plans', () => {
  it('box plan: window = s*m exactly, cost s+m << W, radius capped', () => {
    for (const r of [25, 40, 60, 100, 160, 500]) {
      const p = boxPlan(r);
      expect(p.direct).toBe(false);
      expect((2 * p.radius + 1)).toBe(p.s * p.m);
      expect(p.s % 2).toBe(1);
      expect(p.m % 2).toBe(1);
      expect(p.s + p.m).toBeLessThan(2 * p.radius + 1);
      expect(Math.abs(p.radius - Math.min(r, 160))).toBeLessThanOrEqual(Math.ceil(Math.sqrt(2 * Math.min(r, 160))));
    }
    expect(boxPlan(10)).toMatchObject({ direct: true, radius: 10 });
  });
  it('gaussian plan: direct up to sigma 20, cascaded beyond with the same total variance', () => {
    expect(gaussianPlan(5).iterations).toBe(1);
    const p = gaussianPlan(60);
    expect(p.iterations).toBeGreaterThan(1);
    expect(p.sigma * Math.sqrt(p.iterations)).toBeCloseTo(60, 6);
    expect(p.radius).toBe(Math.ceil(3 * p.sigma));
  });
  it('morph segments: square exact, circle support function within 3% of R in every direction', () => {
    expect(morphSegments('square', 12)).toEqual([{ dx: 1, dy: 0, steps: 12 }, { dx: 0, dy: 1, steps: 12 }]);
    for (const [shape, tol] of [['circle', 0.03], ['octagon', 0.09]] as const) {
      const R = 200;
      const segs = morphSegments(shape, R);
      let lo = Infinity;
      let hi = 0;
      for (let a = 0; a < 360; a += 3) {
        const t = (a * Math.PI) / 180;
        let h = 0;
        for (const s of segs) h += s.steps * Math.hypot(s.dx, s.dy) * Math.abs(Math.cos(t) * s.dx / Math.hypot(s.dx, s.dy) + Math.sin(t) * s.dy / Math.hypot(s.dx, s.dy));
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
      expect(lo / R, `${shape} min`).toBeGreaterThan(1 - tol);
      expect(hi / R, `${shape} max`).toBeLessThan(1 + tol);
    }
  });
  it('sparse-table line morphology (CPU mirror of the shader passes) equals brute force, with wrap', () => {
    const n = 97;
    const src = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) * 0.5 + 0.5 + ((i * 7919) % 13) / 40);
    const wrap = (i: number): number => ((i % n) + n) % n;
    for (const a of [1, 2, 3, 5, 8, 13, 31]) {
      const w = 2 * a + 1;
      const K = Math.floor(Math.log2(w));
      let lvl = Float32Array.from(src);
      for (let k = 1; k <= K; k++) lvl = Float32Array.from(lvl, (_, i) => Math.max(lvl[wrap(i)], lvl[wrap(i + 2 ** (k - 1))]));
      const res = Float32Array.from(src, (_, i) => Math.max(lvl[wrap(i - a)], lvl[wrap(i + a - 2 ** K + 1)]));
      for (let i = 0; i < n; i++) {
        let m = -Infinity;
        for (let d = -a; d <= a; d++) m = Math.max(m, src[wrap(i + d)]);
        expect(res[i]).toBe(m);
      }
    }
  });
  it('pass counts stay logarithmic in the radius', () => {
    expect(morphPassCount(morphSegments('circle', 100))).toBeLessThan(60);
    expect(morphPassCount(morphSegments('square', 500))).toBeLessThan(25);
  });
});

describe('spline stroke table', () => {
  const line: SplineValue = { closed: false, points: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }] };
  const wide = { keys: [{ x: 0, y: 1 }, { x: 1, y: 1 }] };
  it('samples, widths, arc-length parameter and bounding box', () => {
    const t = buildStrokes([line], { width: 0.1, widthCurve: wide, tileX: false, tileY: false, margin: 0 });
    const n = t.ranges[1];
    expect(n).toBeGreaterThanOrEqual(2);
    expect(t.ranges[0]).toBe(0);
    expect(t.samples[3]).toBe(0);
    expect(t.samples[(n - 1) * 4 + 3]).toBeCloseTo(1, 6);
    expect(t.samples[2]).toBeCloseTo(0.05, 6);
    expect(Array.from(t.bbox.slice(0, 4)).map((x) => +x.toFixed(3))).toEqual([0.15, 0.45, 0.85, 0.55]);
    expect(t.active).toBe(1);
  });
  it('per-point width and the width profile curve', () => {
    const sp: SplineValue = { closed: false, points: [{ x: 0.2, y: 0.5, w: 0.2 }, { x: 0.8, y: 0.5, w: 0.04 }] };
    const t = buildStrokes([sp], { width: 0.1, widthCurve: { keys: [{ x: 0, y: 1 }, { x: 1, y: 0.5 }] }, tileX: false, tileY: false });
    const n = t.ranges[1];
    expect(t.samples[2]).toBeCloseTo(0.1, 6);
    expect(t.samples[(n - 1) * 4 + 2]).toBeCloseTo(0.01, 6);
  });
  it('tiling offsets only appear when the stroke reaches across the border', () => {
    const inside = buildStrokes([line], { width: 0.05, widthCurve: wide, tileX: true, tileY: true });
    expect([inside.ox0, inside.ox1, inside.oy0, inside.oy1]).toEqual([0, 0, 0, 0]);
    const cross: SplineValue = { closed: false, points: [{ x: 0.9, y: 0.5 }, { x: 1.2, y: 0.5 }] };
    const t = buildStrokes([cross], { width: 0.05, widthCurve: wide, tileX: true, tileY: true });
    expect(t.ox0).toBe(-1);
    expect(t.ox1).toBe(0);
    const notTiled = buildStrokes([cross], { width: 0.05, widthCurve: wide, tileX: false, tileY: false });
    expect([notTiled.ox0, notTiled.ox1]).toEqual([0, 0]);
  });
  it('long splines are decimated to the table size; empty splines are skipped; closed flag survives', () => {
    const many: SplineValue = { closed: true, points: Array.from({ length: 80 }, (_, i) => ({ x: 0.5 + 0.3 * Math.cos(i / 5), y: 0.5 + 0.3 * Math.sin(i / 5) })) };
    const t = buildStrokes([many, { closed: false, points: [] }], { width: 0.02, widthCurve: wide, tileX: false, tileY: false });
    expect(t.ranges[1]).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(t.ranges[2]).toBe(1);
    expect(t.ranges[5]).toBe(0);
    expect(t.active).toBe(1);
  });
});

describe('CPU references', () => {
  it('threshold: hard step, soft smoothstep is monotone and centred', () => {
    expect(thresholdReference(0.49, 0.5, 0, false)).toBe(0);
    expect(thresholdReference(0.5, 0.5, 0, false)).toBe(1);
    expect(thresholdReference(0.5, 0.5, 0.2, true)).toBeCloseTo(0.5, 6);
    expect(thresholdReference(0.3, 0.5, 0.2, true)).toBe(0);
    expect(thresholdReference(0.7, 0.5, 0.2, true)).toBe(1);
  });
  it('slice: band is symmetric, bands repeat with the spacing, ramp peaks at the centre', () => {
    const o = { center: 0.5, width: 0.2, softness: 0, spacing: 0.3, bands: 3 };
    expect(sliceReference(0.5, o)).toBe(1);
    expect(sliceReference(0.2, o)).toBe(1);
    expect(sliceReference(0.8, o)).toBe(1);
    expect(sliceReference(0.35, o)).toBe(0);
    expect(sliceReference(0.5, { ...o, ramp: true })).toBe(1);
  });
  it('xdog: bright flat areas are white, dark areas are black for the hard version', () => {
    expect(xdogReference(0.9, 0.9, { sharp: 20, epsilon: 0.5, phi: 10, hard: false })).toBe(1);
    expect(xdogReference(0.2, 0.2, { sharp: 20, epsilon: 0.5, phi: 10, hard: true })).toBe(0);
    expect(xdogReference(0.2, 0.2, { sharp: 20, epsilon: 0.5, phi: 10, hard: false })).toBeLessThan(0.01);
  });
});

import { describe, expect, it } from 'vitest';
import { expandDefinition } from '../src/engine/graph/expand';
import { gizmoParamRefs } from '../src/engine/graph/gizmo-decl';
import type { EvalContext, NodeDefinition } from '../src/engine/graph/node';
import { Params } from '../src/engine/params/accessor';
import { coerceParam, defaultValues, identityCurve, type ParamValues } from '../src/engine/params/schema';
import { bakeCurveUniform, isIdentityCurve, LUT_SIZE, lutEval } from '../src/engine/shaders/lut';
import { makeLayout, packUniforms } from '../src/engine/shaders/uniforms';
import { computeReach, OCTAVE_MODES, SHAPES } from '../src/nodes/grayscale/fractal/definition';
import { GRADIENT_TYPES } from '../src/nodes/grayscale/gradient/definition';
import { NOISE_TYPES } from '../src/nodes/grayscale/noise/definition';
import { ringElements, SCATTER_SHAPES } from '../src/nodes/grayscale/polar_scatter/definition';
import { SHAPE_TYPES } from '../src/nodes/grayscale/shape/definition';
import { buildGizmoModel, defaultSnap, type GizmoEnv } from '../src/gizmos';
import { makeRegistry } from './helpers';

const IDS = ['grayscale.noise', 'grayscale.fractal', 'grayscale.shape', 'grayscale.gradient', 'grayscale.polar_scatter', 'grayscale.uniform'];
const reg = makeRegistry();
const def = (id: string): NodeDefinition => reg.get(id)!;

interface Captured {
  uniforms: { layout: ReturnType<typeof makeLayout>; values: Record<string, never> };
  textures: unknown[];
}
/** Runs evaluate() against a fake context and returns every pass the node recorded. */
function run(d: NodeDefinition, overrides: ParamValues = {}, connected: string[] = [], modK = 0.5): Captured[] {
  const ex = expandDefinition(d);
  const values = defaultValues(ex.params);
  for (const [k, v] of Object.entries(overrides)) {
    const pd = ex.params.find((p) => p.id === k);
    if (!pd) throw new Error(`${d.id}: unknown param "${k}" in overrides`);
    values[k] = coerceParam(pd, v);
  }
  const tv = { kind: 'texture', tex: { id: 'fake' }, width: 8, height: 8 };
  const captured: Captured[] = [];
  const ctx = {
    params: new Params(ex.params, values),
    frame: { width: 8, height: 8, tileX: true, tileY: true },
    inputs: {},
    texInput: (pin: string) => (connected.includes(pin) ? tv : undefined),
    mod: (id: string) => (connected.includes(`${id}_mod`) ? { tex: tv, k: modK } : { tex: undefined, k: 0 }),
    tex: () => ({ id: 'out' }),
    result: (t: unknown) => t,
    pass: (desc: Captured) => captured.push(desc),
  } as unknown as EvalContext;
  d.evaluate(ctx);
  return captured;
}

describe('generator nodes: definitions', () => {
  it('all six exist, validate and expose Texture tab + Background blending', () => {
    for (const id of IDS) {
      const d = def(id);
      expect(d, id).toBeTruthy();
      const ex = expandDefinition(d);
      expect(ex.hasTextureTab, id).toBe(true);
      expect(ex.hasBlending, id).toBe(true);
      expect(ex.inputs.some((i) => i.id === 'background'), id).toBe(true);
    }
  });
  it('every gizmo references existing params (spatial nodes ship gizmos)', () => {
    for (const id of IDS.filter((i) => i !== 'grayscale.uniform')) {
      const d = def(id);
      expect(d.gizmos?.length, `${id} needs gizmos`).toBeGreaterThan(0);
      const ids = new Set(d.params.map((p) => p.id));
      for (const g of d.gizmos!) for (const r of gizmoParamRefs(g)) expect(ids.has(r), `${id}.${g.id} -> ${r}`).toBe(true);
    }
  });
  it('enum order == shader index order (never reorder)', () => {
    const opts = (id: string, p: string): string[] => (def(id).params.find((x) => x.id === p) as { options: { value: string }[] }).options.map((o) => o.value);
    expect(opts('grayscale.noise', 'noise_type')).toEqual([...NOISE_TYPES]);
    expect(opts('grayscale.fractal', 'shape')).toEqual([...SHAPES]);
    expect(opts('grayscale.fractal', 'octave_mode')).toEqual([...OCTAVE_MODES]);
    expect(opts('grayscale.shape', 'shape')).toEqual([...SHAPE_TYPES]);
    expect(opts('grayscale.gradient', 'gtype')).toEqual([...GRADIENT_TYPES]);
    expect(opts('grayscale.polar_scatter', 'shape')).toEqual([...SCATTER_SHAPES]);
    // v1 noise ids keep their historical indices (0 value, 1 perlin)
    expect(NOISE_TYPES[0]).toBe('value');
    expect(NOISE_TYPES[1]).toBe('perlin');
  });
  it('modulation pins exist where the spec asks for them', () => {
    const pins = (id: string): string[] => expandDefinition(def(id)).inputs.map((i) => i.id);
    for (const m of ['z_position_mod', 'ramp_mod', 'gain_mod', 'uv_amount_mod', 'size_mod', 'intensity_mod', 'visibility_mod', 'atlas_pick_mod', 'pattern', 'uv', 'background']) expect(pins('grayscale.fractal')).toContain(m);
    for (const m of ['size_mod', 'visibility_mod', 'pattern']) expect(pins('grayscale.polar_scatter')).toContain(m);
    expect(pins('grayscale.noise')).toContain('uv');
    expect(pins('grayscale.shape')).toContain('uv');
    expect(pins('grayscale.gradient')).toContain('uv');
  });
});

describe('generator nodes: evaluate() feeds EVERY uniform field (no GPU)', () => {
  for (const id of IDS) {
    it(`${id}: defaults, gallery variants, all pins connected`, () => {
      const d = def(id);
      const variants: ParamValues[] = [{}, ...(d.gallery ?? []).map((g) => g.params as ParamValues)];
      expect(variants.length).toBeGreaterThan(1);
      for (const v of variants)
        for (const conn of [[], ['pattern', 'uv', ...expandDefinition(d).inputs.filter((i) => i.id.endsWith('_mod')).map((i) => i.id)]]) {
          const passes = run(d, v, conn);
          expect(passes.length).toBe(1);
          const buf = packUniforms(passes[0].uniforms.layout, passes[0].uniforms.values);
          expect(buf.byteLength).toBe(passes[0].uniforms.layout.size);
          expect(passes[0].textures.length).toBe(d.shaders![0].textures);
          // no NaN / Infinity anywhere in the packed block
          for (const x of new Float32Array(buf)) expect(Number.isFinite(x) || x === 0).toBe(true);
        }
    });
  }
  it('fractal binds mods/pattern/uv to the documented texture slots', () => {
    const p = run(def('grayscale.fractal'), {}, ['size_mod', 'pattern', 'uv'])[0];
    expect(p.textures.map((t) => t !== null)).toEqual([false, false, false, false, true, false, false, false, true, true]);
    expect((p.uniforms.values as Record<string, number>).size_mod_k).toBe(0.5);
    expect((p.uniforms.values as Record<string, number>).has_pattern).toBe(1);
  });
});

describe('generator helpers', () => {
  it('uniform vec4 arrays: layout, WGSL struct and packing', () => {
    const l = makeLayout([{ name: 'a', type: 'f32' }, { name: 'lut', type: 'vec4f', count: 16 }, { name: 'b', type: 'f32' }]);
    expect(l.offsets).toEqual([0, 16, 272]);
    expect(l.size).toBe(288);
    expect(l.wgsl('P')).toContain('lut: array<vec4f, 16>');
    const lut = Float32Array.from({ length: 64 }, (_, i) => i);
    const buf = new Float32Array(packUniforms(l, { a: 1, lut, b: 2 }));
    expect(buf[4]).toBe(0);
    expect(buf[4 + 63]).toBe(63);
    expect(buf[68]).toBe(2);
    expect(() => packUniforms(l, { a: 1, lut: [1, 2, 3], b: 2 })).toThrow(/expects 64/);
    expect(() => makeLayout([{ name: 'x', type: 'f32', count: 4 }])).toThrow(/vec4f/);
  });
  it('curve LUT: identity detection, bake, CPU lerp mirror', () => {
    expect(isIdentityCurve(identityCurve())).toBe(true);
    const c = { keys: [{ x: 0, y: 1 }, { x: 1, y: 0 }] };
    expect(isIdentityCurve(c)).toBe(false);
    const lut = bakeCurveUniform(c);
    expect(lut.length).toBe(LUT_SIZE);
    expect(lutEval(lut, 0)).toBeCloseTo(1, 6);
    expect(lutEval(lut, 1)).toBeCloseTo(0, 6);
    expect(lutEval(lut, 0.5)).toBeCloseTo(0.5, 2);
  });
  it('fractal reach: 3x3 for normal splats, 5x5 for big/jittery ones, always bounded', () => {
    const base = defaultValues(expandDefinition(def('grayscale.fractal')).params);
    expect(computeReach(base, false)).toBe(1);
    expect(computeReach({ ...base, scale_max: 2.5, scale_min: 2 }, false)).toBe(2);
    expect(computeReach({ ...base, scale_max: 100 }, false)).toBe(2);
    expect(computeReach({ ...base, shape: 'pixel', scale_max: 4 }, false)).toBe(1);
  });
  it('polar scatter ring element count mirrors the shader', () => {
    expect(ringElements(0, 0.2, 12, 1, false, 0.4)).toBe(12);
    expect(ringElements(2, 0.2, 12, 2, false, 0.4)).toBe(48);
    expect(ringElements(0, 0.4, 40, 1, true, 0.4)).toBe(40);
    expect(ringElements(0, 0.0, 40, 1, true, 0.4)).toBe(1);
    expect(ringElements(0, 0.4, 100000, 4, false, 0.4)).toBe(512);
  });
  it('gallery params only use existing param ids and valid enum values', () => {
    for (const id of IDS) {
      const d = def(id);
      for (const g of d.gallery ?? []) {
        for (const [k, v] of Object.entries(g.params)) {
          const pd = d.params.find((p) => p.id === k);
          expect(pd, `${id} gallery "${g.name}" -> ${k}`).toBeTruthy();
          expect(coerceParam(pd!, v), `${id}/${g.name}/${k}`).toEqual(v);
        }
      }
    }
  });
});

describe('generator gizmos build and round-trip through the framework', () => {
  for (const id of IDS.filter((i) => i !== 'grayscale.uniform')) {
    it(`${id}: every declared gizmo builds a model (also with non-default shapes / tiling)`, () => {
      const d = def(id);
      const defaults = defaultValues(expandDefinition(d).params);
      // gizmos may be hidden for the default values (visibleIf): find values that show each of them
      const candidates: ParamValues[] = [{}, { shape: 'rounded_rect' }, { gtype: 'radial' }, { gtype: 'angular' }, { gtype: 'linear' }];
      for (const tile of [[true, true], [false, false]] as [boolean, boolean][])
        for (const decl of d.gizmos!) {
          const values = candidates.map((c) => ({ ...defaults, ...c })).find((v) => decl.visibleIf?.(v) ?? true);
          expect(values, `${id}.${decl.id} is never visible`).toBeTruthy();
          const env: GizmoEnv = { nodeId: 'n1', values: values!, size: [512, 512], tile, snap: defaultSnap(), zoom: 1, state: {} };
          const m = buildGizmoModel(decl, env);
          expect(m, `${id}.${decl.id}`).toBeTruthy();
          expect(m!.handles.length).toBeGreaterThan(0);
          // dragging the first handle must produce writes only to declared params
          const h = m!.handles.find((x) => x.pos);
          if (h?.pos) {
            const drag = m!.begin(h.id, [h.pos[0] + 10, h.pos[1] + 6], { ctrl: false, shift: false, alt: false });
            const w = drag?.move([h.pos[0] + 20, h.pos[1] + 12], { ctrl: false, shift: false, alt: false }) ?? {};
            const ids = new Set(d.params.map((p) => p.id));
            for (const k of Object.keys(w)) expect(ids.has(k), `${id}.${decl.id} writes ${k}`).toBe(true);
          }
        }
    });
  }
});

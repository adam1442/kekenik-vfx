import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.math: per-pixel math on Gray. Result = op(A, B) where B is the optional second Gray input, or the constant
 * `value` when B is not connected. Ops: add, subtract, multiply, divide, pow, min, max, difference, lerp, mod, step, smoothstep,
 * remap (in range -> out range), clamp, abs, one_minus, gamma. `value` has a "<param> mod" pin (per-pixel multiplier).
 * Defaults (multiply by 1) are the identity. Limitations: Gray only (use Levels (Color) / Adjust for colour); values are not
 * clamped unless "Clamp result" is on (r16float keeps negatives and values above 1).
 */
export const SHADER = defineShader('utils_math.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'op', type: 'u32' },
  { name: 'value', type: 'f32' },
  { name: 'value_mod_k', type: 'f32' },
  { name: 'value2', type: 'f32' },
  { name: 'in_lo', type: 'f32' },
  { name: 'in_hi', type: 'f32' },
  { name: 'out_lo', type: 'f32' },
  { name: 'out_hi', type: 'f32' },
  { name: 'has_b', type: 'u32' },
  { name: 'clamp_out', type: 'u32' },
]);

export const MATH_OPS = ['add', 'subtract', 'multiply', 'divide', 'pow', 'min', 'max', 'difference', 'lerp', 'mod', 'step', 'smoothstep', 'remap', 'clamp', 'abs', 'one_minus', 'gamma'] as const;
export type MathOp = (typeof MATH_OPS)[number];

/** CPU reference of the shader (used by vitest and the GPU known-answer self-test). `b` = B texel or the constant value. */
export function mathOp(op: MathOp, a: number, b: number, v2: number, rng: { inLo: number; inHi: number; outLo: number; outHi: number } = { inLo: 0, inHi: 1, outLo: 0, outHi: 1 }): number {
  const sstep = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
    return t * t * (3 - 2 * t);
  };
  switch (op) {
    case 'add': return a + b;
    case 'subtract': return a - b;
    case 'multiply': return a * b;
    case 'divide': return Math.abs(b) < 1e-6 ? 0 : a / b;
    case 'pow': return Math.min(Math.pow(Math.max(a, 0), b), 1e4);
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'difference': return Math.abs(a - b);
    case 'lerp': return a + (b - a) * v2;
    case 'mod': return Math.abs(b) < 1e-6 ? 0 : a - b * Math.floor(a / b);
    case 'step': return a >= b ? 1 : 0;
    case 'smoothstep': return sstep(b, b + Math.max(v2, 1e-4), a);
    case 'remap': {
      const d = rng.inHi - rng.inLo;
      return rng.outLo + ((Math.abs(d) < 1e-6 ? 0 : (a - rng.inLo) / d) * (rng.outHi - rng.outLo));
    }
    case 'clamp': return Math.min(Math.max(a, Math.min(b, v2)), Math.max(b, v2));
    case 'abs': return Math.abs(a);
    case 'one_minus': return 1 - a;
    case 'gamma': return Math.min(Math.pow(Math.max(a, 0), 1 / Math.max(b, 1e-4)), 1e4);
  }
}

const uses2 = (...ops: MathOp[]) => (v: Record<string, unknown>) => ops.includes(v.op as MathOp);

export default defineNode({
  id: 'utils.math',
  version: 1,
  category: 'utils',
  title: 'Math',
  description: 'Per-pixel math on Gray: add, multiply, pow, min / max, lerp, step, smoothstep, remap range, clamp, gamma ... with a second Gray input or a constant. The workhorse for masks, envelopes and contrast.',
  keywords: ['math', 'multiply', 'add', 'subtract', 'pow', 'power', 'gamma', 'remap', 'range', 'clamp', 'lerp', 'smoothstep', 'step', 'abs', 'invert', 'one minus', 'mod'],
  icon: 'curve',
  inputs: [
    { id: 'a', name: 'A', type: 'gray', tooltip: 'First operand.' },
    { id: 'b', name: 'B', type: 'gray', optional: true, tooltip: 'Second operand. When not connected the constant Value is used.' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: false },
  params: [
    P.enum(
      'op',
      'multiply',
      [
        { value: 'add', label: 'Add', tooltip: 'A + B' },
        { value: 'subtract', label: 'Subtract', tooltip: 'A - B' },
        { value: 'multiply', label: 'Multiply', tooltip: 'A * B' },
        { value: 'divide', label: 'Divide', tooltip: 'A / B (0 when B is 0)' },
        { value: 'pow', label: 'Power', tooltip: 'A ^ B (A clamped to >= 0)' },
        { value: 'min', label: 'Min', tooltip: 'min(A, B)' },
        { value: 'max', label: 'Max', tooltip: 'max(A, B)' },
        { value: 'difference', label: 'Difference', tooltip: '|A - B|' },
        { value: 'lerp', label: 'Lerp', tooltip: 'mix(A, B, Value 2)' },
        { value: 'mod', label: 'Modulo', tooltip: 'A mod B (repeating ramps)' },
        { value: 'step', label: 'Step', tooltip: '1 where A >= B' },
        { value: 'smoothstep', label: 'Smoothstep', tooltip: 'smoothstep(B, B + Value 2, A): soft threshold, Value 2 = width' },
        { value: 'remap', label: 'Remap range', tooltip: 'Maps [In min, In max] to [Out min, Out max]' },
        { value: 'clamp', label: 'Clamp', tooltip: 'clamp(A, B, Value 2)' },
        { value: 'abs', label: 'Absolute', tooltip: '|A|' },
        { value: 'one_minus', label: 'One minus', tooltip: '1 - A' },
        { value: 'gamma', label: 'Gamma', tooltip: 'A ^ (1 / B)' },
      ],
      { group: 'Math', label: 'Operation' },
    ),
    P.float('value', 1, { group: 'Math', label: 'Value (B)', min: -100, max: 100, softMin: -2, softMax: 4, step: 0.01, animatable: true, modulatable: true, visibleIf: (v) => !uses2('abs', 'one_minus', 'remap')(v), tooltip: 'Constant used as B when the B input is not connected.' }),
    P.float('value2', 0.5, { group: 'Math', label: 'Value 2', min: -100, max: 100, softMin: -1, softMax: 2, step: 0.01, animatable: true, visibleIf: uses2('lerp', 'smoothstep', 'clamp'), tooltip: 'Lerp factor / smoothstep width / clamp maximum.' }),
    P.vec2('in_range', [0, 1], { group: 'Remap', label: 'In range', min: -100, max: 100, softMin: -1, softMax: 2, step: 0.01, animatable: true, visibleIf: uses2('remap') }),
    P.vec2('out_range', [0, 1], { group: 'Remap', label: 'Out range', min: -100, max: 100, softMin: -1, softMax: 8, step: 0.01, animatable: true, visibleIf: uses2('remap') }),
    P.bool('clamp_out', false, { group: 'Output', label: 'Clamp result 0..1' }),
  ],
  identity: (v) => v.op === 'multiply' && v.value === 1 && !v.clamp_out,
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [
    { name: 'Soft threshold', params: { op: 'smoothstep', value: 0.45, value2: 0.2 } },
    { name: 'Contrast (power)', params: { op: 'pow', value: 2.2 } },
  ],
  evaluate(ctx) {
    const a = ctx.texInput('a');
    if (!a) throw new Error('Math needs input A.');
    const b = ctx.texInput('b');
    const p = ctx.params;
    const m = ctx.mod('value');
    const out = ctx.tex('gray');
    const ir = p.vec2('in_range');
    const or = p.vec2('out_range');
    ctx.pass({
      label: 'math',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { op: p.enumIndex('op'), value: p.num('value'), value_mod_k: m.k, value2: p.num('value2'), in_lo: ir[0], in_hi: ir[1], out_lo: or[0], out_hi: or[1], has_b: b ? 1 : 0, clamp_out: p.bool('clamp_out') },
      },
      textures: [a.tex, b?.tex ?? null, m.tex?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});

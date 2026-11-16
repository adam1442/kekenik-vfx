import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl } from '../../../engine/graph/node';
import { identityCurve, P, type CurveValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeCurveUniform256, LUT256_VEC4 } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.curve — luminance remap with the curve widget (256-entry LUT). t0 = input. */
export const SHADER = defineShader('grayscale_curve.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'amount', type: 'f32' },
  { name: 'lut', type: 'vec4f', count: LUT256_VEC4 },
]);

const k = (x: number, y: number, mode?: 'smooth' | 'linear' | 'step'): CurveValue['keys'][number] => (mode ? { x, y, mode } : { x, y });
export const sCurve = (): CurveValue => ({ keys: [k(0, 0), k(0.25, 0.12), k(0.75, 0.88), k(1, 1)] });

/** fusable per-pixel declaration (see FusableDecl). */
export const FUSE: FusableDecl = {
  source: SHADER,
  uniforms: LAYOUT,
  uniformValues: (p) => ({ amount: p.num('amount'), lut: bakeCurveUniform256(p.curve('curve') ?? identityCurve()) }),
};

export default defineNode({
  id: 'grayscale.curve',
  version: 1,
  category: 'grayscale',
  title: 'Curve',
  description: 'Remaps luminance with an editable curve (bezier / linear / step keys, tangent handles, presets). Evaluated through a 256-entry LUT.',
  keywords: ['remap', 'contrast', 'tone', 'lut', 'levels', 'posterize', 'response'],
  icon: 'curve',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.curve('curve', sCurve(), { group: 'Curve', label: 'Curve', animatable: true, tooltip: 'Output value as a function of the input value (both 0..1; inputs outside are clamped).' }),
    P.float('amount', 1, { group: 'Curve', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true, tooltip: 'Mix between the unmodified input (0%) and the curve result (100%).' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Inverted', params: { curve: { keys: [k(0, 1, 'linear'), k(1, 0)] } } },
    { name: 'Posterize 4', params: { curve: { keys: [k(0, 0, 'step'), k(0.25, 0.333, 'step'), k(0.5, 0.666, 'step'), k(0.75, 1, 'step'), k(1, 1)] } } },
    { name: 'Hard contrast', params: { curve: { keys: [k(0, 0), k(0.4, 0.05), k(0.6, 0.95), k(1, 1)] } } },
    { name: 'Lift shadows', params: { curve: { keys: [k(0, 0), k(0.2, 0.5), k(1, 1)] } } },
    { name: 'Ridge', params: { curve: { keys: [k(0, 0, 'linear'), k(0.5, 1, 'linear'), k(1, 0)] } } },
  ],
  /** identity short-cut (the evaluator forwards the input, no pass recorded). */
  identity: (v) => v.amount === 0,
  fusable: FUSE,
  evaluate: (ctx) => runFusable(ctx, FUSE, 'gray', 'curve'),
});

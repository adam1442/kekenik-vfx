import { defineNode } from '../../../engine/graph/node';
import { identityCurve, P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeCurveUniform256, LUT256_VEC4 } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** color.interpolate — textures: t0 A, t1 B, t2 mask. */
export const SHADER = defineShader('color_interpolate.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'color_a', type: 'vec4f' },
  { name: 'color_b', type: 'vec4f' },
  { name: 'has_a', type: 'u32' },
  { name: 'has_b', type: 'u32' },
  { name: 'space', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'amount', type: 'f32' },
  { name: 'lut', type: 'vec4f', count: LUT256_VEC4 },
]);

export default defineNode({
  id: 'color.interpolate',
  version: 1,
  category: 'color',
  title: 'Interpolate',
  description: 'Mixes two colours or two Color textures (A, B) by a Gray mask. The mask can be remapped with a curve; mixing in linear RGB or OKLab.',
  keywords: ['mix', 'lerp', 'blend', 'mask', 'crossfade', 'interpolate', 'switch'],
  icon: 'blend',
  inputs: [
    { id: 'a', name: 'A', type: 'color', optional: true, tooltip: 'Colour at mask = 0. Unconnected: "Color A".' },
    { id: 'b', name: 'B', type: 'color', optional: true, tooltip: 'Colour at mask = 100%. Unconnected: "Color B".' },
    { id: 'mask', name: 'Mask', type: 'gray' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: [
    P.color('color_a', [0.02, 0.02, 0.1, 1], { group: 'Colors', label: 'Color A', hdr: true, animatable: true }),
    P.color('color_b', [1, 0.5, 0.05, 1], { group: 'Colors', label: 'Color B', hdr: true, animatable: true }),
    P.enum('space', 'linear', [{ value: 'linear', label: 'Linear RGB' }, { value: 'oklab', label: 'OKLab (perceptual)' }], { group: 'Mix', label: 'Mix space' }),
    P.curve('curve', identityCurve(), { group: 'Mix', label: 'Mask curve', animatable: true, tooltip: 'Remaps the mask before mixing.' }),
    P.float('amount', 1, { group: 'Mix', min: 0, max: 4, softMax: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Scales the mask.' }),
    P.bool('invert', false, { group: 'Mix', label: 'Invert mask' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [
    { name: 'OKLab mix', params: { space: 'oklab', color_a: [0, 0.2, 1, 1], color_b: [1, 0.9, 0, 1] } },
    { name: 'Hard-ish', params: { curve: { keys: [{ x: 0, y: 0 }, { x: 0.4, y: 0.02 }, { x: 0.6, y: 0.98 }, { x: 1, y: 1 }] } } },
    { name: 'Inverted', params: { invert: true } },
  ],
  evaluate(ctx) {
    const mask = ctx.texInput('mask');
    if (!mask) throw new Error('Interpolate needs a Gray mask');
    const a = ctx.texInput('a');
    const b = ctx.texInput('b');
    const p = ctx.params;
    const out = ctx.tex('color');
    ctx.pass({
      label: 'interpolate',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { color_a: p.rgba('color_a'), color_b: p.rgba('color_b'), has_a: a ? 1 : 0, has_b: b ? 1 : 0, space: p.enumIndex('space'), invert: p.bool('invert'), amount: p.num('amount'), lut: bakeCurveUniform256(p.curve('curve')) },
      },
      textures: [a?.tex ?? null, b?.tex ?? null, mask.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});

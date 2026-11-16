import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_rgb_to_grayscale.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'weights', type: 'vec3f' }, { name: 'mode', type: 'u32' }, { name: 'use_alpha', type: 'u32' }]);

const PRESETS: Record<string, [number, number, number]> = { rec709: [0.2126, 0.7152, 0.0722], rec601: [0.299, 0.587, 0.114], average: [1 / 3, 1 / 3, 1 / 3] };
/** Weights used for a mode (pure, tested). `custom` weights are normalised on request. */
export function grayWeights(mode: string, custom: number[], normalize: boolean): [number, number, number] {
  if (PRESETS[mode]) return PRESETS[mode];
  const s = custom[0] + custom[1] + custom[2];
  return normalize && Math.abs(s) > 1e-6 ? [custom[0] / s, custom[1] / s, custom[2] / s] : [custom[0], custom[1], custom[2]];
}

/** utils.rgb_to_grayscale — luminance (Rec.709 / 601), average, max, min or custom weights. */
export default defineNode({
  id: 'utils.rgb_to_grayscale',
  version: 1,
  category: 'utils',
  title: 'RGB to Grayscale',
  description: 'Converts a Color texture to Gray with luminance weights, average, max, min or custom weights.',
  keywords: ['luminance', 'desaturate', 'gray', 'grey', 'luma', 'convert', 'black and white'],
  icon: 'gray',
  inputs: [{ id: 'input', name: 'RGB Color', type: 'color' }],
  outputs: [{ id: 'output', name: 'Grayscale', type: 'gray' }],
  params: [
    P.enum('mode', 'rec709', [{ value: 'rec709', label: 'Luminance (Rec.709)' }, { value: 'rec601', label: 'Luma (Rec.601)' }, { value: 'average', label: 'Average' }, { value: 'max', label: 'Max' }, { value: 'min', label: 'Min' }, { value: 'custom', label: 'Custom weights' }], { group: 'Conversion' }),
    P.vec3('weights', [0.2126, 0.7152, 0.0722], { group: 'Conversion', min: -16, max: 16, softMin: -1, softMax: 2, step: 0.01, visibleIf: (v) => v.mode === 'custom' }),
    P.bool('normalize_weights', true, { group: 'Conversion', visibleIf: (v) => v.mode === 'custom' }),
    P.bool('use_alpha', false, { group: 'Conversion', label: 'Multiply by alpha' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Max', params: { mode: 'max' } }, { name: 'Average', params: { mode: 'average' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('RGB to Grayscale needs an input');
    const p = ctx.params;
    const mode = p.str('mode');
    const out = ctx.tex('gray');
    ctx.pass({ label: 'rgb to gray', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { weights: grayWeights(mode, p.vec3('weights'), p.bool('normalize_weights')), mode: mode === 'max' ? 1 : mode === 'min' ? 2 : 0, use_alpha: p.bool('use_alpha') } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'gray') };
  },
});

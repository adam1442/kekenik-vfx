import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** color.adjust — textures: t0 input, t1 hue mod, t2 saturation mod, t3 brightness mod, t4 mask. */
export const SHADER = defineShader('color_adjust.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'tint', type: 'vec4f' },
  { name: 'hue', type: 'f32' },
  { name: 'hue_mod_k', type: 'f32' },
  { name: 'saturation', type: 'f32' },
  { name: 'saturation_mod_k', type: 'f32' },
  { name: 'brightness', type: 'f32' },
  { name: 'brightness_mod_k', type: 'f32' },
  { name: 'value', type: 'f32' },
  { name: 'contrast', type: 'f32' },
  { name: 'gamma', type: 'f32' },
  { name: 'exposure', type: 'f32' },
  { name: 'tint_amount', type: 'f32' },
  { name: 'has_mask', type: 'u32' },
]);

/** fusable per-pixel declaration (see FusableDecl). */
export const FUSE: FusableDecl = {
  source: SHADER,
  uniforms: LAYOUT,
  extras: ['hue_mod', 'saturation_mod', 'brightness_mod', 'mask'],
  uniformValues: (p, io) => ({
    tint: p.rgba('tint'),
    hue: p.num('hue'),
    hue_mod_k: io.modK('hue'),
    saturation: p.num('saturation'),
    saturation_mod_k: io.modK('saturation'),
    brightness: p.num('brightness'),
    brightness_mod_k: io.modK('brightness'),
    value: p.num('value'),
    contrast: p.num('contrast'),
    gamma: p.num('gamma'),
    exposure: p.num('exposure'),
    tint_amount: p.num('tint_amount'),
    has_mask: io.has('mask') ? 1 : 0,
  }),
};

export default defineNode({
  id: 'color.adjust',
  version: 1,
  category: 'color',
  title: 'Adjust',
  description: 'Hue, saturation, value, brightness, contrast, gamma, exposure and tint of a Color. Hue / saturation work in OKLab (perceptual); everything is HDR safe and alpha is untouched. Optional Gray mask.',
  keywords: ['hue', 'saturation', 'value', 'brightness', 'contrast', 'exposure', 'tint', 'grade', 'correction'],
  icon: 'adjust',
  inputs: [
    { id: 'input', name: 'Input', type: 'color' },
    { id: 'mask', name: 'Mask', type: 'gray', optional: true, tooltip: 'Optional Gray mask: where it is 0 the colour stays unchanged.' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: [
    P.float('hue', 0, { group: 'Color', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, modulatable: true, tooltip: 'Rotates the hue (OKLab chroma plane).' }),
    P.float('saturation', 1, { group: 'Color', min: 0, max: 16, softMax: 2, step: 0.01, display: 'percent', animatable: true, modulatable: true }),
    P.float('value', 1, { group: 'Color', min: 0, max: 64, softMax: 2, step: 0.01, display: 'percent', animatable: true, tooltip: 'Multiplies the RGB values.' }),
    P.float('brightness', 0, { group: 'Tone', min: -16, max: 16, softMin: -1, softMax: 1, step: 0.005, animatable: true, modulatable: true, tooltip: 'Added to RGB.' }),
    P.float('contrast', 1, { group: 'Tone', min: 0, max: 8, softMax: 3, step: 0.01, animatable: true, tooltip: 'Power about 18% gray (linear).' }),
    P.float('gamma', 1, { group: 'Tone', min: 0.05, max: 8, softMin: 0.2, softMax: 4, step: 0.01, animatable: true }),
    P.float('exposure', 0, { group: 'Tone', min: -16, max: 16, softMin: -4, softMax: 4, step: 0.01, unit: 'EV', animatable: true, tooltip: 'Stops: RGB * 2^EV.' }),
    P.color('tint', [1, 0.6, 0.3, 1], { group: 'Tint', animatable: true, tooltip: 'RGB multiplier (alpha ignored).' }),
    P.float('tint_amount', 0, { group: 'Tint', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 5 }],
  gallery: [
    { name: 'Hue +120', params: { hue: 120 } },
    { name: 'Desaturated', params: { saturation: 0.15 } },
    { name: 'Punchy', params: { contrast: 1.5, saturation: 1.4 } },
    { name: 'Warm tint', params: { tint_amount: 0.7 } },
    { name: 'Exposure +1', params: { exposure: 1 } },
  ],
  /** identity short-cut (the evaluator forwards the input, no pass recorded). */
  identity: (v) => v.hue === 0 && v.saturation === 1 && v.value === 1 && v.brightness === 0 && v.contrast === 1 && v.gamma === 1 && v.exposure === 0 && v.tint_amount === 0,
  fusable: FUSE,
  evaluate: (ctx) => runFusable(ctx, FUSE, 'color', 'adjust'),
});

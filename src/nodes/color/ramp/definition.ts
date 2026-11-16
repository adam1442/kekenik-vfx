import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl } from '../../../engine/graph/node';
import { P, type GradientValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeGradientUniform256, GRAD_LUT_SIZE } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * color.ramp — gradient map. The gradient (LINEAR RGBA, alpha is a normal stop channel, interpolation linear / smooth /
 * OKLab / step stored in the value) is baked into a 256-texel LUT per evaluation, so stops/interp are keyframable.
 */
export const SHADER = defineShader('color_ramp.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'in_low', type: 'f32' },
  { name: 'in_high', type: 'f32' },
  { name: 'offset', type: 'f32' },
  { name: 'repeat', type: 'f32' },
  { name: 'wrap_mode', type: 'u32' },
  { name: 'intensity', type: 'f32' },
  { name: 'glut', type: 'vec4f', count: GRAD_LUT_SIZE },
]);

const g = (interp: GradientValue['interp'], ...stops: [number, number, number, number, number][]): GradientValue => ({ interp, stops: stops.map(([pos, r, gg, b, a]) => ({ pos, color: [r, gg, b, a] })) });
export const FIRE = (): GradientValue => g('oklab', [0, 0, 0, 0, 1], [0.25, 0.12, 0.005, 0, 1], [0.55, 1, 0.16, 0.004, 1], [0.8, 1, 0.65, 0.05, 1], [1, 1, 0.95, 0.6, 1]);
export const ICE = (): GradientValue => g('oklab', [0, 0, 0.01, 0.06, 1], [0.5, 0.02, 0.3, 0.9, 1], [1, 0.8, 0.95, 1, 1]);
export const TOXIC = (): GradientValue => g('oklab', [0, 0.02, 0, 0.05, 1], [0.5, 0.05, 0.7, 0.05, 1], [1, 0.9, 1, 0.2, 1]);
export const SMOKE_ALPHA = (): GradientValue => g('smooth', [0, 0.02, 0.02, 0.025, 0], [0.35, 0.1, 0.1, 0.11, 0.7], [1, 0.6, 0.6, 0.62, 1]);

/** fusable per-pixel declaration (see FusableDecl). */
export const FUSE: FusableDecl = {
  source: SHADER,
  uniforms: LAYOUT,
  uniformValues: (p) => ({ in_low: p.num('in_low'), in_high: p.num('in_high'), offset: p.num('offset'), repeat: p.num('repeat'), wrap_mode: p.enumIndex('wrap_mode'), intensity: p.num('intensity'), glut: bakeGradientUniform256(p.gradient('gradient')) }),
};

export default defineNode({
  id: 'color.ramp',
  version: 1,
  category: 'color',
  title: 'Ramp',
  description: 'Gradient map: converts a Gray input to Color through an editable gradient (linear / smooth / OKLab / step, alpha is a normal stop channel, preset library with folders).',
  keywords: ['gradient map', 'colorize', 'lut', 'palette', 'fire', 'color ramp', 'alpha ramp'],
  icon: 'ramp',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: [
    P.gradient('gradient', FIRE(), { group: 'Gradient', label: 'Gradient', animatable: true, tooltip: 'Linear RGBA stops. The preset button stores / loads gradients in shareable folders.' }),
    P.float('in_low', 0, { group: 'Input', label: 'Input low', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.float('in_high', 1, { group: 'Input', label: 'Input high', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.float('offset', 0, { group: 'Input', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Scrolls the gradient (loops every 100% with Repeat wrap).' }),
    P.float('repeat', 1, { group: 'Input', min: 0.01, max: 64, softMax: 8, step: 0.01, animatable: true }),
    P.enum('wrap_mode', 'clamp', [{ value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' }], { group: 'Input', label: 'Wrap' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 64, softMax: 4, step: 0.01, animatable: true, tooltip: 'Multiplier of RGB (HDR); alpha untouched.' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Ice', params: { gradient: ICE() } },
    { name: 'Toxic', params: { gradient: TOXIC() } },
    { name: 'Smoke (alpha)', params: { gradient: SMOKE_ALPHA() } },
    { name: 'Mirrored x3', params: { repeat: 3, wrap_mode: 'mirror' } },
    { name: 'HDR 3x', params: { intensity: 3 } },
  ],
  fusable: FUSE,
  evaluate: (ctx) => runFusable(ctx, FUSE, 'color', 'ramp'),
});

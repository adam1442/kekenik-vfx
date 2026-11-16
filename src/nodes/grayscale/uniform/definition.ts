import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * REFERENCE NODE (simplest generator): grayscale.uniform. Demonstrates the modulation pin (`value_mod` + intensity)
 * and the automatic Background blending.
 */
export const SHADER = defineShader('grayscale_uniform.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'value', type: 'f32' },
  { name: 'value_mod_k', type: 'f32' },
]);

/** fusable generator head (see FusableDecl). */
export const FUSE: FusableDecl = {
  source: SHADER,
  uniforms: LAYOUT,
  main: null,
  extras: ['value_mod'],
  uniformValues: (p, io) => ({ value: p.num('value'), value_mod_k: io.modK('value') }),
};

export default defineNode({
  id: 'grayscale.uniform',
  version: 1,
  category: 'grayscale',
  title: 'Uniform',
  description: 'A constant gray value (resolution, filtering and tiling come from the Texture tab). Connect a Gray texture to "Value mod" to modulate it per pixel; values above 100% are kept for HDR use.',
  keywords: ['constant', 'solid', 'flat', 'fill', 'value', 'gray'],
  icon: 'uniform',
  inputs: [],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [P.float('value', 0.5, { min: -16, max: 16, softMin: 0, softMax: 1, step: 0.01, animatable: true, modulatable: true })],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  gallery: [
    { name: '25%', params: { value: 0.25 } },
    { name: '75%', params: { value: 0.75 } },
    { name: 'White', params: { value: 1 } },
    { name: 'HDR 4x', params: { value: 4 } },
  ],
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  fusable: FUSE,
  evaluate: (ctx) => runFusable(ctx, FUSE, 'gray', 'uniform'),
});

import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** color.uniform — constant colour, HDR capable (RGB above 1 is kept), alpha is a normal channel. t0 = intensity modulation. */
export const SHADER = defineShader('color_uniform.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'color', type: 'vec4f' },
  { name: 'intensity', type: 'f32' },
  { name: 'intensity_mod_k', type: 'f32' },
]);

/** fusable generator head (see FusableDecl). */
export const FUSE: FusableDecl = {
  source: SHADER,
  uniforms: LAYOUT,
  main: null,
  extras: ['intensity_mod'],
  uniformValues: (p, io) => ({ color: p.rgba('color'), intensity: p.num('intensity'), intensity_mod_k: io.modK('intensity') }),
};

export default defineNode({
  id: 'color.uniform',
  version: 1,
  category: 'color',
  title: 'Uniform Color',
  description: 'A constant colour (linear, HDR capable: the colour picker has an intensity multiplier). Alpha is a normal channel. Resolution, filtering and tiling come from the Texture tab.',
  keywords: ['constant', 'solid', 'flat', 'fill', 'color', 'colour', 'hdr', 'tint'],
  icon: 'uniform',
  inputs: [],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: true },
  params: [
    P.color('color', [0.8, 0.35, 0.08, 1], { group: 'Color', hdr: true, animatable: true, tooltip: 'Linear RGBA. Use the picker\'s intensity for HDR values above 1.' }),
    P.float('intensity', 1, { group: 'Color', min: 0, max: 64, softMax: 4, step: 0.01, animatable: true, modulatable: true, tooltip: 'Multiplier of the RGB channels (not alpha).' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Cyan HDR 4x', params: { color: [0.05, 0.6, 1, 1], intensity: 4 } },
    { name: 'Magenta', params: { color: [1, 0.05, 0.5, 1] } },
    { name: 'Half alpha', params: { color: [1, 1, 1, 0.5] } },
  ],
  fusable: FUSE,
  evaluate: (ctx) => runFusable(ctx, FUSE, 'color', 'uniform color'),
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_identity.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'tiles', type: 'vec2f' },
  { name: 'uv_mode', type: 'u32' },
]);

/** uv.identity — the neutral field (absolute: own UV; offset: zero). Optional integer repeat keeps the field seamless when tiling. */
export default defineNode({
  id: 'uv.identity',
  version: 1,
  category: 'uv',
  title: 'UV Identity',
  description: 'The neutral UV field: sampling an image with it changes nothing. Use it as a base for UV Blend or as the starting point of a warp chain; the optional repeat tiles the image.',
  keywords: ['identity', 'neutral', 'base', 'uv', 'tile', 'repeat'],
  icon: 'warp',
  inputs: [],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [P.vec2('tiles', [1, 1], { group: 'Field', label: 'Repeat', min: 0.01, max: 64, softMin: 0.25, softMax: 8, step: 1, labels: ['X', 'Y'], linkable: true, animatable: true, tooltip: 'Image repeats across the tile (use whole numbers on tiling axes to stay seamless).' }), uvOutParam()],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT }],
  gallery: [{ name: '2 x 2 repeat', params: { tiles: [2, 2] } }, { name: 'Offset (zero)', params: { uv_out: 'offset' } }],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('uv');
    ctx.pass({ label: 'uv identity', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { tiles: p.vec2('tiles'), uv_mode: uvModeIndex(p.str('uv_out')) } }, textures: [], ss: 1 });
    return { output: ctx.result(out, 'uv') };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { CODEC_OPTIONS, FLOW_SIGN_OPTIONS } from '../color_to_uv/definition';
import { uvInParam, uvModeIndex } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_uv_to_color.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'codec', type: 'u32' },
  { name: 'range', type: 'f32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'flow', type: 'u32' },
  { name: 'uv_in', type: 'u32' },
]);

/** utils.uv_to_color — encodes a UV field as a Color texture; this is what Export > Warp (6B) reads. */
export default defineNode({
  id: 'utils.uv_to_color',
  version: 1,
  category: 'utils',
  title: 'UV to Color',
  description: 'Encodes a UV field into RG(B) of a Color texture: absolute coordinates, signed offsets, 0.5-biased flowmap (8/16-bit safe) or direction + speed.',
  keywords: ['uv', 'flowmap', 'encode', 'export', 'warp', 'distortion', 'uv to color'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'UV', type: 'uv' }],
  outputs: [{ id: 'output', name: 'Color', type: 'color' }],
  params: [
    uvInParam(),
    P.enum('codec', 'biased', CODEC_OPTIONS, { group: 'Encode', label: 'Encoding' }),
    P.float('range', 0.1, { group: 'Encode', min: 0.0001, max: 8, softMax: 1, step: 0.001, display: 'percent', animatable: true, visibleIf: (v) => v.codec === 'biased' || v.codec === 'direction', tooltip: 'Offset (tile space) that maps to a fully saturated channel (0 or 100%).' }),
    P.bool('flip_y', false, { group: 'Encode', label: 'Flip Y', tooltip: 'Mirror the vertical component (green) for bottom-up engines (Unity / OpenGL).' }),
    P.enum('flow_sign', 'flow', FLOW_SIGN_OPTIONS, { group: 'Encode', label: 'Vector means', visibleIf: (v) => v.codec === 'biased' || v.codec === 'direction' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Unreal flowmap', params: { codec: 'biased', range: 0.1 } }, { name: 'Float offsets', params: { codec: 'offset' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('UV to Color needs a UV input');
    const p = ctx.params;
    const out = ctx.tex('color');
    ctx.pass({
      label: 'uv to color',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { codec: p.enumIndex('codec'), range: p.num('range'), flip_y: p.bool('flip_y'), flow: p.str('flow_sign') === 'flow', uv_in: uvModeIndex(p.str('uv_in')) } },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});

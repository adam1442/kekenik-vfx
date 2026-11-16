import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_color_to_uv.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'codec', type: 'u32' },
  { name: 'range', type: 'f32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'flow', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);
export const FLOW_SIGN_OPTIONS = [
  { value: 'flow', label: 'Flow (content moves along the vector)', tooltip: 'Engine flowmap convention: shaders compute uv - flow * time.' },
  { value: 'lookup', label: 'Lookup offset (raw warp)' },
];
export const CODEC_OPTIONS = [
  { value: 'absolute', label: 'Absolute coordinates (RG)' },
  { value: 'offset', label: 'Signed offset (RG, float)' },
  { value: 'biased', label: 'Biased offset 0.5 = neutral (flowmap)' },
  { value: 'direction', label: 'Direction (RG) + speed (B)' },
];

/** utils.color_to_uv — interprets the RG(B) channels of a Color texture as a UV field (imported flowmaps, painted warps). */
export default defineNode({
  id: 'utils.color_to_uv',
  version: 1,
  category: 'utils',
  title: 'Color to UV',
  description: 'Decodes a Color texture into a UV field: absolute coordinates, signed offsets, 0.5-biased flowmaps (Unreal / Unity / Godot) or direction + speed.',
  keywords: ['uv', 'flowmap', 'warp', 'decode', 'import', 'distortion', 'color to uv'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Color', type: 'color' }],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.enum('codec', 'biased', CODEC_OPTIONS, { group: 'Decode', label: 'Encoding' }),
    P.float('range', 0.1, { group: 'Decode', min: 0.0001, max: 8, softMax: 1, step: 0.001, display: 'percent', animatable: true, visibleIf: (v) => v.codec === 'biased' || v.codec === 'direction', tooltip: 'Offset (tile space) that a fully saturated channel represents.' }),
    P.bool('flip_y', false, { group: 'Decode', label: 'Flip Y', tooltip: 'Mirror the vertical component (green) — Unity / OpenGL flowmaps are bottom-up.' }),
    P.enum('flow_sign', 'flow', FLOW_SIGN_OPTIONS, { group: 'Decode', label: 'Vector means', visibleIf: (v) => v.codec === 'biased' || v.codec === 'direction' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Unity flowmap', params: { codec: 'biased', flip_y: true } }, { name: 'Absolute lookup', params: { codec: 'absolute' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Color to UV needs an input');
    const p = ctx.params;
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'color to uv',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { codec: p.enumIndex('codec'), range: p.num('range'), flip_y: p.bool('flip_y'), flow: p.str('flow_sign') === 'flow', uv_mode: uvModeIndex(p.str('uv_out')) } },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

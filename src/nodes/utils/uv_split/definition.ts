import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { MERGE_SOURCES } from '../uv_merge/definition';
import { uvInParam, uvModeIndex } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_uv_split.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'ch', type: 'u32' },
  { name: 'output_kind', type: 'u32' },
  { name: 'range', type: 'f32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'uv_in', type: 'u32' },
]);

/** utils.uv_split — splits a UV field into U and V Gray textures (coordinate, signed offset or 50%-biased offset). */
export default defineNode({
  id: 'utils.uv_split',
  version: 1,
  category: 'utils',
  title: 'UV Split',
  description: 'Splits a UV field into two Gray textures (U and V) as absolute coordinates, signed offsets or 50%-biased offsets.',
  keywords: ['uv', 'split', 'separate', 'uv to gray', 'channels'],
  icon: 'split',
  inputs: [{ id: 'input', name: 'UV', type: 'uv' }],
  outputs: [
    { id: 'u', name: 'U', type: 'gray' },
    { id: 'v', name: 'V', type: 'gray' },
  ],
  params: [
    uvInParam(),
    P.enum('output', 'absolute', MERGE_SOURCES, { group: 'Split', label: 'Gray holds' }),
    P.float('range', 0.1, { group: 'Split', min: 0.0001, max: 8, softMax: 1, step: 0.001, display: 'percent', animatable: true, visibleIf: (v) => v.output === 'biased' }),
    P.bool('flip_y', false, { group: 'Split', label: 'Flip Y' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Biased offsets', params: { output: 'biased' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('UV Split needs a UV input');
    const p = ctx.params;
    const out: Record<string, ReturnType<typeof ctx.result>> = {};
    (['u', 'v'] as const).forEach((id, ch) => {
      const t = ctx.tex('gray');
      ctx.pass({
        label: `uv split ${id}`,
        target: t,
        shader: SHADER,
        uniforms: { layout: LAYOUT, values: { ch, output_kind: p.enumIndex('output'), range: p.num('range'), flip_y: p.bool('flip_y'), uv_in: uvModeIndex(p.str('uv_in')) } },
        textures: [src.tex],
        ss: 1,
      });
      out[id] = ctx.result(t, 'gray');
    });
    return out;
  },
});

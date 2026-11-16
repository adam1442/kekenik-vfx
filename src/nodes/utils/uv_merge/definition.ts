import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_uv_merge.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'source', type: 'u32' },
  { name: 'range', type: 'f32' },
  { name: 'has_u', type: 'u32' },
  { name: 'has_v', type: 'u32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);
export const MERGE_SOURCES = [
  { value: 'absolute', label: 'Absolute (gray = coordinate)' },
  { value: 'offset', label: 'Signed offset' },
  { value: 'biased', label: 'Biased offset (50% = neutral)' },
];

/** utils.uv_merge — builds a UV field from two Gray textures (U and V). Unconnected axes stay identity / neutral. */
export default defineNode({
  id: 'utils.uv_merge',
  version: 1,
  category: 'utils',
  title: 'UV Merge',
  description: 'Combines two Gray textures into a UV field (U and V). Gray can mean an absolute coordinate, a signed offset or a 50%-biased offset.',
  keywords: ['uv', 'merge', 'combine', 'gray to uv', 'warp'],
  icon: 'merge',
  inputs: [
    { id: 'u', name: 'U', type: 'gray', optional: true },
    { id: 'v', name: 'V', type: 'gray', optional: true },
  ],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.enum('source', 'biased', MERGE_SOURCES, { group: 'Merge', label: 'Gray means' }),
    P.float('range', 0.1, { group: 'Merge', min: 0.0001, max: 8, softMax: 1, step: 0.001, display: 'percent', animatable: true, visibleIf: (v) => v.source === 'biased', tooltip: 'Offset (tile space) at 0% / 100% gray.' }),
    P.bool('flip_y', false, { group: 'Merge', label: 'Flip Y' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [{ name: 'Absolute', params: { source: 'absolute' } }],
  evaluate(ctx) {
    const u = ctx.texInput('u');
    const v = ctx.texInput('v');
    const p = ctx.params;
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv merge',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { source: p.enumIndex('source'), range: p.num('range'), has_u: !!u, has_v: !!v, flip_y: p.bool('flip_y'), uv_mode: uvModeIndex(p.str('uv_out')) } },
      textures: [u?.tex ?? null, v?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

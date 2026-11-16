import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';
import { uvInParam, uvModeIndex } from '../../_shared/uvparams';
export const SHADER = defineShader('utils_uv_to_vector.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'uv_in', type: 'u32' }, { name: 'amount', type: 'f32' }]);

/** utils.uv_to_vector: stateless Vector utility. See CONTRACTS section 15. */
export default defineNode({
  id: 'utils.uv_to_vector',
  version: 1,
  category: 'utils',
  title: 'UV to Vector',
  description: 'Converts a UV warp to a Vector field: v = -delta / amount (the direction the content moves).',
  keywords: ['uv','vector','convert','flow'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'UV', type: 'uv' }],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  params: [
    uvInParam(),
    P.float('amount', 0.05, { group: 'Convert', label: 'Amount', min: 0.0001, max: 100, softMax: 1, step: 0.001, animatable: true, tooltip: 'Tile fractions of warp that correspond to a vector of length 1.' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'halo', halo: () => 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('UV to Vector needs an input');
    const p = ctx.params;
    const out = ctx.tex('vector');
    ctx.pass({ label: 'uv_to_vector', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { uv_in: uvModeIndex(p.str('uv_in')), amount: p.num('amount') } }, textures: [src.tex], ss: 1 });
    const r = ctx.result(out, 'vector');
    if (r.pin === 'vector') r.vecScale = src.vecScale;
    return { output: r };
  },
});

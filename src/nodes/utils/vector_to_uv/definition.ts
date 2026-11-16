import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';
import { uvOutParam, uvModeIndex } from '../../_shared/uvparams';
export const SHADER = defineShader('utils_vector_to_uv.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'uv_out', type: 'u32' }, { name: 'amount', type: 'f32' }]);

/** utils.vector_to_uv: stateless Vector utility. See CONTRACTS section 15. */
export default defineNode({
  id: 'utils.vector_to_uv',
  version: 1,
  category: 'utils',
  title: 'Vector to UV',
  description: 'Converts a Vector field to a UV warp: lookup delta = -v * amount (content moves along the vector), stored absolute or as an offset.',
  keywords: ['vector','uv','warp','convert','flow'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    uvOutParam(),
    P.float('amount', 0.05, { group: 'Convert', label: 'Amount', min: -100, max: 100, softMin: -1, softMax: 1, step: 0.001, animatable: true, tooltip: 'Tile fractions of warp per unit of vector (e.g. seconds of travel).' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'halo', halo: () => 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Vector to UV needs an input');
    const p = ctx.params;
    const out = ctx.tex('uv');
    ctx.pass({ label: 'vector_to_uv', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { uv_out: uvModeIndex(p.str('uv_out')), amount: p.num('amount') } }, textures: [src.tex], ss: 1 });
    const r = ctx.result(out, 'uv');
    if (r.pin === 'vector') r.vecScale = src.vecScale;
    return { output: r };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_vector_magnitude.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'scale', type: 'f32' }, { name: 'clamp_out', type: 'u32' }]);

/** utils.vector_magnitude: stateless Vector utility. See CONTRACTS section 15. */
export default defineNode({
  id: 'utils.vector_magnitude',
  version: 1,
  category: 'utils',
  title: 'Vector Magnitude',
  description: 'Length of a Vector field as a Gray texture (magnitude / scale).',
  keywords: ['vector','magnitude','length','speed'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  outputs: [{ id: 'output', name: 'Gray', type: 'gray' }],
  params: [
    P.float('scale', 1, { group: 'Vector', label: 'Scale', min: 0.0001, max: 1000, softMax: 10, step: 0.01, animatable: true, tooltip: 'Output = |v| / scale.' }),
    P.bool('clamp', false, { group: 'Vector', label: 'Clamp to 0..1' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'halo', halo: () => 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Vector Magnitude needs an input');
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({ label: 'vector_magnitude', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { scale: p.num('scale'), clamp_out: p.bool('clamp') } }, textures: [src.tex], ss: 1 });
    const r = ctx.result(out, 'gray');
    if (r.pin === 'vector') r.vecScale = src.vecScale;
    return { output: r };
  },
});

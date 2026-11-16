import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_curl.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'gain', type: 'f32' }]);

/** utils.curl: stateless Vector utility. See CONTRACTS section 15. */
export default defineNode({
  id: 'utils.curl',
  version: 1,
  category: 'utils',
  title: 'Curl',
  description: 'Curl (vorticity) of a Vector field, central differences, per second: sign = rotation direction.',
  keywords: ['curl','vorticity','vector','rotation'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  outputs: [{ id: 'output', name: 'Gray', type: 'gray' }],
  params: [
    P.float('gain', 1, { group: 'Vector', label: 'Gain', min: -1000, max: 1000, softMax: 10, step: 0.01, animatable: true }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'halo', halo: () => 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Curl needs an input');
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({ label: 'curl', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { gain: p.num('gain') } }, textures: [src.tex], ss: 1 });
    const r = ctx.result(out, 'gray');
    if (r.pin === 'vector') r.vecScale = src.vecScale;
    return { output: r };
  },
});

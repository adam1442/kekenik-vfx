import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_alpha_merge.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'default_alpha', type: 'f32' }, { name: 'has_alpha', type: 'u32' }, { name: 'premultiply', type: 'u32' }]);

/** utils.alpha_merge — Color RGB + Gray alpha -> Color. (Alpha is just the 4th channel; no special treatment elsewhere.) */
export default defineNode({
  id: 'utils.alpha_merge',
  version: 1,
  category: 'utils',
  title: 'Alpha Merge',
  description: 'Combines a Color input with a Gray alpha into one Color texture.',
  keywords: ['alpha', 'merge', 'combine', 'opacity', 'transparency'],
  icon: 'merge',
  inputs: [
    { id: 'color', name: 'Color', type: 'color' },
    { id: 'alpha', name: 'Alpha', type: 'gray', optional: true },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: [
    P.float('default_alpha', 1, { group: 'Alpha', label: 'Alpha when unconnected', min: 0, max: 16, softMax: 1, step: 0.01, animatable: true }),
    P.bool('premultiply', false, { group: 'Alpha', tooltip: 'Multiply RGB by the alpha.' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [{ name: 'Premultiplied', params: { premultiply: true } }],
  evaluate(ctx) {
    const c = ctx.texInput('color');
    if (!c) throw new Error('Alpha Merge needs a Color input');
    const a = ctx.texInput('alpha');
    const out = ctx.tex('color');
    ctx.pass({ label: 'alpha merge', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { default_alpha: ctx.params.num('default_alpha'), has_alpha: !!a, premultiply: ctx.params.bool('premultiply') } }, textures: [c.tex, a?.tex ?? null], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

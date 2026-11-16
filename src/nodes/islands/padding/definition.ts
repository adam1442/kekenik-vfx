import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { jfaSteps, STEP, STEP_LAYOUT } from '../../utils/distance/definition';
import initSrc from './init.wgsl?raw';
import resolveSrc from './resolve.wgsl?raw';

export const INIT = defineShader('islands_padding_init.wgsl', initSrc);
export const RESOLVE = defineShader('islands_padding_resolve.wgsl', resolveSrc);
export const RESOLVE_LAYOUT = makeLayout([
  { name: 'dist', type: 'f32' },
  { name: 'metric', type: 'u32' },
  { name: 'expand', type: 'u32' },
]);

/** islands.padding — grows islands outwards (jump flooding of the nearest island), keeping the Island Map consistent. */
export default defineNode({
  id: 'islands.padding',
  version: 1,
  category: 'islands',
  title: 'Islands Padding',
  description: 'Grows every island outwards by a distance (nearest island wins) and returns an Island Map in which the padded pixels belong to their island. Use before To Color / To UV to add bleed around shards.',
  keywords: ['islands', 'padding', 'grow', 'dilate', 'bleed', 'expand', 'margin', 'flood fill'],
  icon: 'islands',
  inputs: [{ id: 'islands', name: 'Island Map', type: 'color' }],
  outputs: [{ id: 'output', name: 'Island Map', type: 'color' }],
  params: [
    P.float('distance', 0.02, { group: 'Padding', min: 0, max: 0.5, softMax: 0.1, step: 0.001, display: 'percent', animatable: true, tooltip: 'Growth distance as a fraction of the smaller side.' }),
    P.enum('shape', 'euclidean', [{ value: 'euclidean', label: 'Round' }, { value: 'square', label: 'Square' }], { group: 'Padding' }),
    P.bool('expand_bounds', true, { group: 'Padding', label: 'Expand bounding boxes', tooltip: 'Grow the bounding box by the padding so local gradients / UVs cover the padded island.' }),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'distance', label: 'Padding distance', type: 'circle', viewport: '2d', space: 'uv', radius: 'distance' }],
  cost: { gpu: 'medium', tiling: 'global', temporaries: 3 },
  shaders: [
    { source: INIT, textures: 1 },
    { source: STEP, uniforms: STEP_LAYOUT, textures: 1 },
    { source: RESOLVE, uniforms: RESOLVE_LAYOUT, textures: 2 },
  ],
  gallery: [{ name: 'Square bleed', params: { shape: 'square', distance: 0.04 } }, { name: 'Keep boxes', params: { expand_bounds: false } }],
  evaluate(ctx) {
    const src = ctx.texInput('islands');
    if (!src) throw new Error('Islands Padding needs an Island Map');
    const p = ctx.params;
    const dist = p.num('distance');
    // JFA is only needed when something has to grow; the step list is bounded by the padding distance (+1 pass)
    const reach = Math.ceil(dist * Math.min(ctx.frame.width, ctx.frame.height)) + 1;
    const steps = jfaSteps(Math.min(reach * 2, Math.max(ctx.frame.width, ctx.frame.height)), 1);
    let cur = ctx.tex('color');
    ctx.pass({ label: 'padding init', target: cur, shader: INIT, textures: [src.tex], ss: 1 });
    for (const s of steps) {
      const nxt = ctx.tex('color');
      ctx.pass({ label: `padding jfa ${s}`, target: nxt, shader: STEP, uniforms: { layout: STEP_LAYOUT, values: { step: s } }, textures: [cur], ss: 1 });
      ctx.free(cur);
      cur = nxt;
    }
    const out = ctx.tex('color');
    ctx.pass({ label: 'padding resolve', target: out, shader: RESOLVE, uniforms: { layout: RESOLVE_LAYOUT, values: { dist, metric: p.str('shape') === 'square' ? 1 : 0, expand: p.bool('expand_bounds') } }, textures: [cur, src.tex], ss: 1 });
    ctx.free(cur);
    return { output: ctx.result(out, 'color') };
  },
});

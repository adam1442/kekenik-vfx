import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_rgba_merge.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'defaults', type: 'vec4f' }, { name: 'mask', type: 'u32' }]);

/** utils.rgba_merge — four Gray inputs into R, G, B, A (channel packing). Unconnected channels use constants. */
export default defineNode({
  id: 'utils.rgba_merge',
  version: 1,
  category: 'utils',
  title: 'RGBA Merge',
  description: 'Packs four Gray textures into the R, G, B and A channels of a Color texture.',
  keywords: ['pack', 'channel', 'merge', 'rgba', 'combine', 'orm', 'mask pack'],
  icon: 'merge',
  inputs: [
    { id: 'r', name: 'R', type: 'gray', optional: true },
    { id: 'g', name: 'G', type: 'gray', optional: true },
    { id: 'b', name: 'B', type: 'gray', optional: true },
    { id: 'a', name: 'A', type: 'gray', optional: true },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: ['r', 'g', 'b', 'a'].map((c) => P.float(`default_${c}`, c === 'a' ? 1 : 0, { group: 'Defaults', label: `${c.toUpperCase()} when unconnected`, min: -16, max: 16, softMin: 0, softMax: 1, step: 0.01, animatable: true })),
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 4 }],
  gallery: [{ name: 'Mid gray defaults', params: { default_r: 0.5, default_g: 0.5, default_b: 0.5 } }],
  evaluate(ctx) {
    const ids = ['r', 'g', 'b', 'a'];
    const t = ids.map((i) => ctx.texInput(i));
    if (!t.some(Boolean)) throw new Error('RGBA Merge needs at least one connected channel');
    let mask = 0;
    t.forEach((x, i) => {
      if (x) mask |= 1 << i;
    });
    const out = ctx.tex('color');
    ctx.pass({ label: 'rgba merge', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { defaults: ids.map((i) => ctx.params.num(`default_${i}`)), mask } }, textures: t.map((x) => x?.tex ?? null), ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { modOf, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_directional.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'angle', type: 'f32' },
  { name: 'angle_mod_k', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** uv.directional — uniform direction + strength warp (both modulatable). */
export default defineNode({
  id: 'uv.directional',
  version: 1,
  category: 'uv',
  title: 'UV Directional',
  description: 'Pushes content in one direction by a constant (or modulated) amount. The classic scrolling / flow direction field; modulate strength with a mask for local streaking.',
  keywords: ['uv', 'directional', 'push', 'direction', 'flow', 'wind', 'scroll'],
  icon: 'warp',
  inputs: [],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.float('angle', 0, { group: 'Direction', min: -36000, max: 36000, softMin: -180, softMax: 180, step: 0.5, display: 'angle', modulatable: true, animatable: true, tooltip: 'Direction content moves in (0 = right, 90 = down).' }),
    P.float('strength', 0.1, { group: 'Direction', min: -4, max: 4, softMin: -0.5, softMax: 0.5, step: 0.001, display: 'percent', modulatable: true, animatable: true, tooltip: 'Distance content moves, as a fraction of the smaller image side.' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'direction', label: 'Direction', type: 'angle', viewport: '2d', space: 'uv', angle: 'angle' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [{ name: 'Down', params: { angle: 90, strength: 0.15 } }, { name: 'Diagonal', params: { angle: 45, strength: 0.2 } }],
  evaluate(ctx) {
    const p = ctx.params;
    const ms = modOf(ctx, 'strength');
    const ma = modOf(ctx, 'angle');
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv directional',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { angle: (p.num('angle') * Math.PI) / 180, angle_mod_k: ma.k, strength: p.num('strength'), strength_mod_k: ms.k, uv_mode: uvModeIndex(p.str('uv_out')) } },
      textures: [ms.tex, ma.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

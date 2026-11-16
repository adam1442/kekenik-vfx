import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { modOf, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_radial.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'radius', type: 'f32' },
  { name: 'inner', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'falloff', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);
export const FALLOFF_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'gaussian', label: 'Gaussian' },
  { value: 'constant', label: 'Constant (hard edge)' },
  { value: 'ease', label: 'Ease out' },
];

/** uv.radial — push / pull from a centre. Circle gizmo (centre + radius). */
export default defineNode({
  id: 'uv.radial',
  version: 1,
  category: 'uv',
  title: 'UV Radial',
  description: 'Pushes content away from (or pulls it towards) a centre with a selectable falloff. Shockwave refraction, bulge and pinch fields.',
  keywords: ['uv', 'radial', 'push', 'pull', 'bulge', 'pinch', 'shockwave', 'explosion', 'refraction'],
  icon: 'warp',
  inputs: [],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.vec2('center', [0.5, 0.5], { group: 'Radial', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.float('radius', 0.4, { group: 'Radial', min: 0.001, max: 4, softMax: 1, step: 0.001, display: 'percent', animatable: true, tooltip: 'Extent of the effect (fraction of the smaller side).' }),
    P.float('strength', 0.1, { group: 'Radial', min: -4, max: 4, softMin: -0.5, softMax: 0.5, step: 0.001, display: 'percent', modulatable: true, animatable: true, tooltip: '+ pushes content outwards, - pulls it in.' }),
    P.enum('falloff', 'smooth', FALLOFF_OPTIONS, { group: 'Radial' }),
    P.float('inner', 0, { group: 'Radial', label: 'Inner radius', min: 0, max: 0.999, step: 0.01, display: 'percent', animatable: true, tooltip: 'Full strength inside this fraction of the radius.' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'radius', label: 'Radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Pinch', params: { strength: -0.15 } }, { name: 'Shockwave ring', params: { falloff: 'gaussian', inner: 0.5, strength: 0.2 } }],
  evaluate(ctx) {
    const p = ctx.params;
    const m = modOf(ctx, 'strength');
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv radial',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { center: p.vec2('center'), radius: p.num('radius'), inner: p.num('inner'), strength: p.num('strength'), strength_mod_k: m.k, falloff: p.enumIndex('falloff'), uv_mode: uvModeIndex(p.str('uv_out')) } },
      textures: [m.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

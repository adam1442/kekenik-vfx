import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { FALLOFF_OPTIONS } from '../radial/definition';
import { modOf, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_rotational.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'radius', type: 'f32' },
  { name: 'inner', type: 'f32' },
  { name: 'angle', type: 'f32' },
  { name: 'angle_mod_k', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'falloff', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** uv.rotational — swirl / vortex around a centre. Circle gizmo (centre + radius) and an angle gizmo. */
export default defineNode({
  id: 'uv.rotational',
  version: 1,
  category: 'uv',
  title: 'UV Rotational',
  description: 'Swirls content around a centre with a falloff: true rotation (twirl) or a tangential flow vector (vortex flowmap). Angle / strength accept modulation.',
  keywords: ['uv', 'swirl', 'twirl', 'vortex', 'rotate', 'spin', 'whirlpool', 'tornado'],
  icon: 'warp',
  inputs: [],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.vec2('center', [0.5, 0.5], { group: 'Swirl', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.float('radius', 0.4, { group: 'Swirl', min: 0.001, max: 4, softMax: 1, step: 0.001, display: 'percent', animatable: true }),
    P.enum('mode', 'swirl', [{ value: 'swirl', label: 'Swirl (rotate)' }, { value: 'tangent', label: 'Tangent flow (vortex)' }], { group: 'Swirl' }),
    P.float('angle', 90, { group: 'Swirl', min: -36000, max: 36000, softMin: -360, softMax: 360, step: 1, display: 'angle', modulatable: true, animatable: true, visibleIf: (v) => v.mode === 'swirl', tooltip: 'Rotation at full strength (centre). Positive = clockwise.' }),
    P.float('strength', 0.1, { group: 'Swirl', min: -4, max: 4, softMin: -0.5, softMax: 0.5, step: 0.001, display: 'percent', animatable: true, visibleIf: (v) => v.mode === 'tangent', tooltip: 'Distance content moves along the circle (fraction of the smaller side).' }),
    P.enum('falloff', 'smooth', FALLOFF_OPTIONS, { group: 'Swirl' }),
    P.float('inner', 0, { group: 'Swirl', label: 'Inner radius', min: 0, max: 0.999, step: 0.01, display: 'percent', animatable: true }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [
    { id: 'radius', label: 'Radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius' },
    { id: 'angle', label: 'Angle', type: 'angle', viewport: '2d', space: 'uv', center: 'center', angle: 'angle', visibleIf: (v) => v.mode === 'swirl' },
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Strong twirl', params: { angle: 270, falloff: 'linear' } }, { name: 'Vortex flow', params: { mode: 'tangent', strength: 0.15 } }],
  evaluate(ctx) {
    const p = ctx.params;
    const m = modOf(ctx, 'angle');
    const out = ctx.tex('uv');
    const swirl = p.str('mode') === 'swirl';
    ctx.pass({
      label: 'uv rotational',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { center: p.vec2('center'), radius: p.num('radius'), inner: p.num('inner'), angle: (p.num('angle') * Math.PI) / 180, angle_mod_k: m.k, strength: p.num('strength'), falloff: p.enumIndex('falloff'), mode: swirl ? 0 : 1, uv_mode: uvModeIndex(p.str('uv_out')) },
      },
      textures: [m.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

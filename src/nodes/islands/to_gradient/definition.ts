import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeCurveUniform256, LUT256_VEC4 } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('islands_to_gradient.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'angle', type: 'f32' },
  { name: 'angle_random', type: 'f32' },
  { name: 'repeat', type: 'f32' },
  { name: 'offset', type: 'f32' },
  { name: 'random_invert', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'keep_aspect', type: 'u32' },
  { name: 'wrap', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'lut', type: 'vec4f', count: LUT256_VEC4 },
]);

/** islands.to_gradient — per-island gradient (direction / from centre / angular / box) with random angle and a curve. */
export default defineNode({
  id: 'islands.to_gradient',
  version: 1,
  category: 'islands',
  title: 'Islands To Gradient',
  description: 'Draws a gradient inside every island, relative to its bounding box: directional, from the centre, angular or edge-to-centre, with per-island random direction / inversion, repeat and a remap curve.',
  keywords: ['islands', 'gradient', 'per element', 'bounding box', 'local gradient', 'flood fill', 'linear', 'radial', 'bevel'],
  icon: 'islands',
  inputs: [{ id: 'islands', name: 'Island Map', type: 'color' }],
  outputs: [{ id: 'output', name: 'Gradient', type: 'gray' }],
  params: [
    P.enum('mode', 'direction', [{ value: 'direction', label: 'Direction' }, { value: 'center', label: 'From centre' }, { value: 'angular', label: 'Angular' }, { value: 'box', label: 'Edge to centre (box)' }], { group: 'Gradient' }),
    P.float('angle', 0, { group: 'Gradient', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true, visibleIf: (v) => v.mode === 'direction' || v.mode === 'angular' }),
    P.float('angle_random', 0, { group: 'Gradient', label: 'Random angle', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, visibleIf: (v) => v.mode === 'direction' || v.mode === 'angular', tooltip: '100% = every island gets a random direction over the full circle.' }),
    P.bool('keep_aspect', true, { group: 'Gradient', label: 'Keep aspect', tooltip: 'On: isotropic (pixel) space. Off: every island box is stretched to a unit square.' }),
    P.float('repeat', 1, { group: 'Gradient', min: 0.01, max: 64, softMax: 8, step: 0.01, animatable: true }),
    P.float('offset', 0, { group: 'Gradient', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
    P.bool('wrap', false, { group: 'Gradient', label: 'Wrap (repeat / offset)', tooltip: 'Wrap the gradient instead of clamping it.' }),
    P.bool('invert', false, { group: 'Gradient' }),
    P.float('random_invert', 0, { group: 'Gradient', label: 'Random invert', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Probability that an island is inverted.' }),
    P.curve('curve', { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, { group: 'Remap', animatable: true }),
    P.seed('seed', 1, { group: 'Gradient' }),
  ],
  common: { texture: true, blending: true },
  gizmos: [{ id: 'angle', label: 'Direction', type: 'angle', viewport: '2d', space: 'uv', angle: 'angle', visibleIf: (v) => v.mode === 'direction' || v.mode === 'angular' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Random directions', params: { angle_random: 1 } },
    { name: 'Radial', params: { mode: 'center' } },
    { name: 'Bevel', params: { mode: 'box' } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('islands');
    if (!src) throw new Error('Islands To Gradient needs an Island Map');
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({
      label: 'islands to gradient',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { angle: (p.num('angle') * Math.PI) / 180, angle_random: p.num('angle_random'), repeat: p.num('repeat'), offset: p.num('offset'), random_invert: p.num('random_invert'), seed: p.seed('seed') >>> 0, mode: p.enumIndex('mode'), keep_aspect: p.bool('keep_aspect'), wrap: p.bool('wrap'), invert: p.bool('invert'), lut: bakeCurveUniform256(p.curve('curve')) } },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});

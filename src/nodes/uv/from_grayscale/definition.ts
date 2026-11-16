import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { modOf, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_from_grayscale.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'radius', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'rot', type: 'f32' },
  { name: 'flat_eps', type: 'f32' },
  { name: 'mode', type: 'u32' },
  { name: 'uphill', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** CPU mirror of the gradient (Sobel / 8, per radius step in pixels) at an interior pixel — used by tests. */
export function sobelGradient(h: (x: number, y: number) => number, x: number, y: number, e: number): [number, number] {
  const tl = h(x - e, y - e), tc = h(x, y - e), tr = h(x + e, y - e);
  const ml = h(x - e, y), mr = h(x + e, y);
  const bl = h(x - e, y + e), bc = h(x, y + e), br = h(x + e, y + e);
  return [(tr + 2 * mr + br - (tl + 2 * ml + bl)) * 0.125, (bl + 2 * bc + br - (tl + 2 * tc + tr)) * 0.125];
}

/** uv.from_grayscale — height gradient becomes a warp (water running downhill, refraction from a heightmap). */
export default defineNode({
  id: 'uv.from_grayscale',
  version: 1,
  category: 'uv',
  title: 'UV From Grayscale',
  description: 'Turns the gradient of a height map into a UV warp: refraction from bump heights, flow running down (or along) slopes. Slope-proportional or normalized direction.',
  keywords: ['uv', 'height', 'gradient', 'slope', 'refraction', 'downhill', 'flow', 'derivative', 'from gray'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Height', type: 'gray' }],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.enum('mode', 'slope', [{ value: 'slope', label: 'Slope (proportional)' }, { value: 'normalized', label: 'Normalized direction' }], { group: 'Gradient' }),
    P.float('radius', 0.004, { group: 'Gradient', label: 'Sample radius', min: 0.0002, max: 0.2, softMax: 0.05, step: 0.0005, display: 'percent', animatable: true, tooltip: 'Distance of the Sobel taps (fraction of the smaller side). Larger = smoother gradient.' }),
    P.float('strength', 0.01, { group: 'Gradient', min: -4, max: 4, softMin: -0.1, softMax: 0.1, step: 0.0005, display: 'percent', modulatable: true, animatable: true, tooltip: 'Slope mode: displacement per unit of slope (height per image width). Normalized mode: displacement in tile space.' }),
    P.enum('direction', 'downhill', [{ value: 'downhill', label: 'Downhill (content flows down)' }, { value: 'uphill', label: 'Uphill' }], { group: 'Gradient' }),
    P.float('rotate', 0, { group: 'Gradient', min: -360, max: 360, step: 1, display: 'angle', animatable: true, tooltip: '90 = flow along contour lines.' }),
    P.float('flat_threshold', 0.1, { group: 'Gradient', min: 0.0001, max: 4, softMax: 1, step: 0.01, visibleIf: (v) => v.mode === 'normalized', tooltip: 'Slopes below this fade out (avoids noisy directions on flat areas).' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'radius', label: 'Sample radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
  cost: { gpu: 'low', tiling: 'halo', halo: () => 24 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [{ name: 'Along contours', params: { rotate: 90 } }, { name: 'Normalized downhill', params: { mode: 'normalized', strength: 0.05 } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('UV From Grayscale needs a height input');
    const p = ctx.params;
    const m = modOf(ctx, 'strength');
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv from grayscale',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { radius: p.num('radius'), strength: p.num('strength'), strength_mod_k: m.k, rot: (p.num('rotate') * Math.PI) / 180, flat_eps: p.num('flat_threshold'), mode: p.enumIndex('mode'), uphill: p.str('direction') === 'uphill', uv_mode: uvModeIndex(p.str('uv_out')) } },
      textures: [src.tex, m.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

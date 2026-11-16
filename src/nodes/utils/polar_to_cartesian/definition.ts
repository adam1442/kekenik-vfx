import { defineNode } from '../../../engine/graph/node';
import { polarGizmos, polarParams, polarValues, POLAR_LAYOUT, POLAR_SHADER } from '../../_shared/polar';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';

/**
 * utils.polar_to_cartesian (+ _color) — exact inverse of Cartesian to Polar: the output's X axis is the angle, Y the
 * radius of a disc centred at Position on the input. Same parameter set (the Overlap group only exists on the
 * Cartesian -> Polar side: a disc sampled around a circle has no seam).
 */
export default variants((k) =>
  defineNode({
    id: idOf('utils.polar_to_cartesian', k),
    version: 1,
    category: 'utils',
    title: titleOf('Polar to Cartesian', k),
    description: 'Unwraps a radial image: angle becomes X, radius becomes Y (inverse of Cartesian to Polar). Turns shockwave rings and radial bursts into straight, scrollable textures.',
    keywords: ['polar', 'unwrap', 'unroll', 'radial', 'cartesian', 'ring to strip'],
    icon: 'warp',
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: polarParams('p2c'),
    common: { texture: true, blending: true },
    gizmos: polarGizmos,
    cost: { gpu: 'low', tiling: 'global' },
    shaders: [{ source: POLAR_SHADER, uniforms: POLAR_LAYOUT, textures: 1, defines: { MODE: 1, OUTPUT: 0 } }],
    gallery: [
      { name: 'Half circle', params: { angle: 180 } },
      { name: 'Square metric', params: { metric: 'chebyshev' } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Polar to Cartesian needs an input');
      const out = ctx.tex(pinOf(k));
      ctx.pass({ label: 'polar to cartesian', target: out, shader: POLAR_SHADER, defines: { MODE: 1, OUTPUT: 0 }, uniforms: { layout: POLAR_LAYOUT, values: polarValues(ctx.params, 'p2c') }, textures: [src.tex] });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);

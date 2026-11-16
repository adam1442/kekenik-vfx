import { defineNode } from '../../../engine/graph/node';
import { polarGizmos, polarParams, polarValues, POLAR_LAYOUT, POLAR_SHADER } from '../../_shared/polar';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';

/**
 * utils.cartesian_to_polar (+ _color) — the input's X axis becomes the ANGLE and its Y axis the RADIUS (horizontal
 * stripes -> rings, vertical stripes -> rays). Parameters follow the IlluGen set: Position / Rotation / Scale / Spiral,
 * Shape (distance metric, pinch, perspective), Aperture (angle, radial scaling / centering, out-of-range), Tiling
 * (angular / radial) and Overlap range / scale that cross-fade the seam of NON-tiling inputs. Math: _shared/polar.wgsl.
 */
export default variants((k) =>
  defineNode({
    id: idOf('utils.cartesian_to_polar', k),
    version: 1,
    category: 'utils',
    title: titleOf('Cartesian to Polar', k),
    description: 'Warps an image into polar space: X becomes angle, Y becomes radius. Square / squircle metrics, spiral, pinch, tunnel perspective, aperture, angular / radial tiling and a seam overlap for non-tiling inputs.',
    keywords: ['polar', 'radial', 'circular', 'tunnel', 'spiral', 'ring', 'shockwave', 'cartesian', 'unwrap'],
    icon: 'warp',
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: polarParams('c2p'),
    common: { texture: true, blending: true },
    gizmos: polarGizmos,
    cost: { gpu: 'low', tiling: 'global' },
    shaders: [{ source: POLAR_SHADER, uniforms: POLAR_LAYOUT, textures: 1, defines: { MODE: 0, OUTPUT: 0 } }],
    gallery: [
      { name: 'Square rings', params: { metric: 'chebyshev' } },
      { name: 'Tunnel', params: { perspective: 0.6, radial_tiling: 3, angular_tiling: 4 } },
      { name: 'Spiral', params: { spiral: 1, angular_tiling: 3 } },
      { name: 'Seamless seam (overlap)', params: { overlap_range: 0.2, out_of_range: 'clamp' } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Cartesian to Polar needs an input');
      const out = ctx.tex(pinOf(k));
      ctx.pass({ label: 'cartesian to polar', target: out, shader: POLAR_SHADER, defines: { MODE: 0, OUTPUT: 0 }, uniforms: { layout: POLAR_LAYOUT, values: polarValues(ctx.params, 'c2p') }, textures: [src.tex] });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);

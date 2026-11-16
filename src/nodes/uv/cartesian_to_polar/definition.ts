import { defineNode } from '../../../engine/graph/node';
import { polarGizmos, polarParams, polarValues, POLAR_LAYOUT, POLAR_SHADER } from '../../_shared/polar';
import { uvOutParam } from '../../_shared/uvparams';

/**
 * uv.cartesian_to_polar — the Cartesian -> Polar mapping as a UV warp field: sampling ANY image with this field
 * (Utils > Transform's UV pin, Noise UV pin, Directional Blur UV pin) equals running Cartesian to Polar on it. Same
 * parameters as the texture node (without the seam overlap, which needs two samples per pixel). Out of range is
 * always clamped / repeated (a field cannot carry alpha).
 */
export default defineNode({
  id: 'uv.cartesian_to_polar',
  version: 1,
  category: 'uv',
  title: 'Cartesian to Polar (UV)',
  description: 'UV warp field of the Cartesian-to-Polar mapping. Feed it to any node with a UV pin to polar-warp textures without resampling twice.',
  keywords: ['polar', 'radial', 'uv', 'warp', 'tunnel', 'spiral'],
  icon: 'warp',
  inputs: [],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [...polarParams('uv'), uvOutParam()],
  common: { texture: true, blending: false },
  gizmos: polarGizmos,
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: POLAR_SHADER, uniforms: POLAR_LAYOUT, textures: 1, defines: { MODE: 0, OUTPUT: 1 } }],
  gallery: [
    { name: 'Tunnel', params: { perspective: 0.6, radial_tiling: 3, angular_tiling: 4 } },
    { name: 'Offset output', params: { uv_out: 'offset' } },
  ],
  evaluate(ctx) {
    const out = ctx.tex('uv');
    ctx.pass({ label: 'cartesian to polar uv', target: out, shader: POLAR_SHADER, defines: { MODE: 0, OUTPUT: 1 }, uniforms: { layout: POLAR_LAYOUT, values: polarValues(ctx.params, 'uv') }, textures: [null], ss: 1 });
    return { output: ctx.result(out, 'uv') };
  },
});

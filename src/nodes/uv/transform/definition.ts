import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { uvInParam, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import { transformInverse } from '../../utils/transform/definition';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_transform.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'translate', type: 'vec2f' },
  { name: 'pivot', type: 'vec2f' },
  { name: 'minv', type: 'vec4f' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_in', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** uv.transform — affine warp field with the same Transform2D gizmo as Utils > Transform. */
export default defineNode({
  id: 'uv.transform',
  version: 1,
  category: 'uv',
  title: 'UV Transform',
  description: 'Translate / rotate / scale / skew as a UV field. Without an input it transforms the identity; with one it transforms the lookup coordinates of the connected field.',
  keywords: ['uv', 'transform', 'translate', 'rotate', 'scale', 'skew', 'move', 'pivot'],
  icon: 'transform',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true }],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.vec2('translate', [0, 0], { group: 'Transform', label: 'Position', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Content offset in UV units (1 = one image).' }),
    P.float('rotation', 0, { group: 'Transform', min: -36000, max: 36000, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true }),
    P.vec2('scale', [1, 1], { group: 'Transform', min: -64, max: 64, softMin: 0.1, softMax: 4, step: 0.01, labels: ['X', 'Y'], linkable: true, animatable: true }),
    P.vec2('skew', [0, 0], { group: 'Transform', min: -80, max: 80, softMin: -45, softMax: 45, step: 0.5, labels: ['X', 'Y'], animatable: true, tooltip: 'Shear in degrees.' }),
    P.vec2('pivot', [0.5, 0.5], { group: 'Transform', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    uvInParam(),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  gizmos: [{ id: 'transform', label: 'Transform', type: 'transform', viewport: '2d', space: 'uv', position: { param: 'translate', map: { offset: [0.5, 0.5] } }, rotation: 'rotation', scale: 'scale', pivot: 'pivot' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Rotated 45°', params: { rotation: 45 } }, { name: 'Zoom 2x', params: { scale: [2, 2] } }],
  evaluate(ctx) {
    const p = ctx.params;
    const uvIn = ctx.texInput('uv');
    const out = ctx.tex('uv');
    const [sx, sy] = p.vec2('scale');
    const [kx, ky] = p.vec2('skew');
    const rad = Math.PI / 180;
    const safe = (v: number): number => (Math.abs(v) < 1e-4 ? (v < 0 ? -1e-4 : 1e-4) : v);
    ctx.pass({
      label: 'uv transform',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { translate: p.vec2('translate'), pivot: p.vec2('pivot'), minv: transformInverse(p.num('rotation') * rad, [safe(sx), safe(sy)], [kx * rad, ky * rad]), has_uv: !!uvIn, uv_in: uvModeIndex(p.str('uv_in')), uv_mode: uvModeIndex(p.str('uv_out')) },
      },
      textures: [uvIn?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

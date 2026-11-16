import type { CurveValue } from '../../../engine/params/schema';
import { P } from '../../../engine/params/schema';
import { LUT256_VEC4, bakeCurveUniform256 } from '../../../engine/shaders/lut';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

const ramp: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };

/** vector.transform: rotate / scale / mirror the vectors, remap the magnitude by a curve, transform the domain, warp by another field. */
export default shaderNode({
  id: 'vector.transform',
  title: 'Vector Transform',
  description: 'Rotates, scales and mirrors the vectors, remaps their length with a curve, moves / repeats the field itself and can warp it by another vector field.',
  keywords: ['vector', 'transform', 'rotate', 'scale', 'mirror', 'remap', 'curve', 'warp', 'swap'],
  inputs: [
    { id: 'input', name: 'Vector', type: 'vector' },
    { id: 'warp', name: 'Warp field', type: 'vector', tooltip: 'Optional: the sampling position of the input is displaced by this field.' },
  ],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  extraFields: [{ name: 'lut', type: 'vec4f', count: LUT256_VEC4 }],
  extra: (ctx) => ({ lut: bakeCurveUniform256(ctx.params.curve('remap_curve')) }),
  params: [
    P.float('rotate', 0, { group: 'Vectors', label: 'Rotate', display: 'angle', min: -360, max: 360, step: 1, animatable: true }),
    P.vec2('scale', [1, 1], { group: 'Vectors', label: 'Scale', min: -100, max: 100, softMin: -4, softMax: 4, step: 0.01, linkable: true, labels: ['X', 'Y'], animatable: true }),
    P.bool('mirror_x', false, { group: 'Vectors', label: 'Mirror X', tooltip: 'Negates the X component.' }),
    P.bool('mirror_y', false, { group: 'Vectors', label: 'Mirror Y', tooltip: 'Negates the Y component.' }),
    P.bool('swap', false, { group: 'Vectors', label: 'Swap X / Y' }),
    P.bool('remap_on', false, { group: 'Remap', label: 'Remap length' }),
    P.float('remap_max', 1, { group: 'Remap', label: 'Curve input range', min: 0.001, max: 1000, softMax: 10, step: 0.01, visibleIf: (v) => v.remap_on === true, tooltip: 'Vector length that maps to the right edge of the curve.' }),
    P.curve('remap_curve', ramp, { group: 'Remap', label: 'Length curve', visibleIf: (v) => v.remap_on === true }),
    P.vec2('offset', [0, 0], { group: 'Domain', label: 'Offset', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Moves the field itself (tile space).' }),
    P.vec2('repeat', [1, 1], { group: 'Domain', label: 'Repeat', min: 0.1, max: 32, softMax: 8, step: 1, tooltip: 'Tiles the field (whole numbers keep it seamless).' }),
    P.float('warp_amount', 0.1, { group: 'Warp', label: 'Warp amount', min: -10, max: 10, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
  ],
  gizmos: [{ id: 'domain_offset', label: 'Offset', type: 'point', viewport: '2d', space: 'uv', param: 'offset' }],
  gallery: [{ name: 'Rotate 90', params: { rotate: 90 } }, { name: 'Mirror X', params: { mirror_x: true } }, { name: 'Double speed', params: { scale: [2, 2] } }],
  shader: src,
});

import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.from_normal: tangent-space normal -> slope vector (flow downhill) or raw XY. */
export default shaderNode({
  id: 'vector.from_normal',
  title: 'Vector From Normal',
  description: 'Converts a normal map into a vector field: the surface slope (water flows along it) or the raw tangent XY. Flip Y converts between OpenGL and DirectX normals.',
  keywords: ['vector', 'normal', 'slope', 'flow', 'tangent', 'water'],
  inputs: [{ id: 'input', name: 'Normal', type: 'normal' }],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  params: [
    P.enum('mode', 'slope', [{ value: 'slope', label: 'Slope (downhill)' }, { value: 'xy', label: 'Tangent XY' }], { group: 'Field', label: 'Mode' }),
    P.float('strength', 0.5, { group: 'Field', label: 'Strength', min: -1000, max: 1000, softMin: -4, softMax: 4, step: 0.01, animatable: true }),
    P.bool('flip_y', false, { group: 'Field', label: 'Flip Y' }),
    P.float('rotation', 0, { group: 'Field', label: 'Extra rotation', display: 'angle', min: -360, max: 360, step: 1, animatable: true }),
  ],
  gallery: [{ name: 'Downhill', params: { strength: 0.5 } }, { name: 'Uphill', params: { strength: -0.5 } }],
  shader: src,
});

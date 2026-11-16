import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.compose: X, Y Gray -> Vector. */
export default shaderNode({
  id: 'vector.compose',
  title: 'Vector Compose',
  description: 'Builds a vector field from two Gray textures (X and Y). Centered input treats 50% gray as zero.',
  keywords: ['vector', 'compose', 'merge', 'combine', 'x', 'y', 'components', 'channels'],
  inputs: [{ id: 'x', name: 'X', type: 'gray' }, { id: 'y', name: 'Y', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  params: [
    P.float('gain', 1, { group: 'Input', label: 'Gain', min: -1000, max: 1000, softMin: -10, softMax: 10, step: 0.01, animatable: true }),
    P.bool('centered', false, { group: 'Input', label: 'Centered (50% = 0)' }),
  ],
  gallery: [{ name: 'Signed', params: { centered: false } }, { name: 'Centered', params: { centered: true, gain: 0.5 } }],
  shader: src,
});

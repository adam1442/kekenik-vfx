import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.decompose: Vector -> X, Y (Gray, optionally biased) + length. */
export default shaderNode({
  id: 'vector.decompose',
  title: 'Vector Decompose',
  description: 'Splits a vector field into its X and Y components (and the length) as Gray textures. Centered output maps zero to 50% gray.',
  keywords: ['vector', 'decompose', 'split', 'x', 'y', 'components', 'channels'],
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  required: ['input'],
  outputs: [{ id: 'x', name: 'X', type: 'gray' }, { id: 'y', name: 'Y', type: 'gray' }, { id: 'length', name: 'Length', type: 'gray' }],
  params: [
    P.float('gain', 1, { group: 'Output', label: 'Gain', min: -1000, max: 1000, softMin: -10, softMax: 10, step: 0.01, animatable: true }),
    P.bool('centered', false, { group: 'Output', label: 'Centered (0 = 50%)', tooltip: 'Components are mapped to value * gain * 0.5 + 0.5.' }),
  ],
  gallery: [{ name: 'Signed', params: { centered: false } }, { name: 'Centered', params: { centered: true, gain: 2 } }],
  shader: src,
});

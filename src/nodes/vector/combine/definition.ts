import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.combine: add / subtract / multiply / blend / max-magnitude / min-magnitude of two fields, with a mask. */
export default shaderNode({
  id: 'vector.combine',
  title: 'Vector Combine',
  description: 'Combines two vector fields: add, subtract, multiply, blend, or pick the longer / shorter vector. An optional mask controls where B takes effect.',
  keywords: ['vector', 'combine', 'add', 'blend', 'multiply', 'max', 'merge', 'mix'],
  inputs: [
    { id: 'a', name: 'Vector A', type: 'vector' },
    { id: 'b', name: 'Vector B', type: 'vector' },
    { id: 'mask', name: 'Mask', type: 'gray', tooltip: 'Where B applies (1 = fully).' },
  ],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  params: [
    P.enum('mode', 'add', [{ value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }, { value: 'multiply', label: 'Multiply' }, { value: 'blend', label: 'Blend' }, { value: 'max', label: 'Max magnitude' }, { value: 'min', label: 'Min magnitude' }], { group: 'Combine', label: 'Mode' }),
    P.float('gain_a', 1, { group: 'Combine', label: 'Gain A', min: -100, max: 100, softMin: -4, softMax: 4, step: 0.01, animatable: true }),
    P.float('gain_b', 1, { group: 'Combine', label: 'Gain B', min: -100, max: 100, softMin: -4, softMax: 4, step: 0.01, animatable: true }),
    P.float('mix', 0.5, { group: 'Combine', label: 'Mix', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, visibleIf: (v) => v.mode === 'blend' }),
  ],
  gallery: [{ name: 'Sum', params: { mode: 'add' } }, { name: 'Blend 50%', params: { mode: 'blend', mix: 0.5 } }, { name: 'Strongest wins', params: { mode: 'max' } }],
  shader: src,
});

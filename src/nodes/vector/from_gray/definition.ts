import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.from_gray: gradient of a height field (downhill / uphill) or its rotation (perpendicular = contour-following flow). */
export default shaderNode({
  id: 'vector.from_gray',
  title: 'Vector From Gray',
  description: 'Turns a Gray height field into a vector field: the gradient (flow downhill / uphill) or the rotated gradient (flow along contours, curl-like). Slope limiting keeps steep edges tame.',
  keywords: ['vector', 'gray', 'gradient', 'height', 'slope', 'curl', 'perpendicular', 'contour'],
  inputs: [{ id: 'input', name: 'Gray', type: 'gray' }],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  params: [
    P.enum('mode', 'gradient', [{ value: 'gradient', label: 'Gradient (uphill)' }, { value: 'rotated', label: 'Rotated gradient (contours)' }], { group: 'Field', label: 'Mode' }),
    P.float('rotation', 0, { group: 'Field', label: 'Extra rotation', display: 'angle', min: -360, max: 360, step: 1, animatable: true, tooltip: 'Additional rotation of the vectors (degrees).' }),
    P.float('strength', 1, { group: 'Field', label: 'Strength', min: -1000, max: 1000, softMin: -5, softMax: 5, step: 0.01, animatable: true, tooltip: 'Negative values flow downhill.' }),
    P.float('smooth_px', 2, { group: 'Field', label: 'Sample distance', min: 0.5, max: 64, softMax: 16, step: 0.5, unit: 'px', tooltip: 'Half distance of the central difference: larger = smoother field.' }),
    P.float('slope_limit', 0, { group: 'Field', label: 'Slope limit', min: 0, max: 100, softMax: 2, step: 0.01, tooltip: 'Maximum vector length (0 = off).' }),
  ],
  gallery: [
    { name: 'Uphill', params: { strength: 1 } },
    { name: 'Contour flow', params: { mode: 'rotated', strength: 1 } },
    { name: 'Smooth + limited', params: { smooth_px: 8, slope_limit: 0.5 } },
  ],
  shader: src,
});

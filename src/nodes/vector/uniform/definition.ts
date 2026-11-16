import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.uniform: constant direction field (angle + strength), optional mask. */
export default shaderNode({
  id: 'vector.uniform',
  title: 'Vector Uniform',
  description: 'Constant directional vector field: angle and strength, or drag the line gizmo. An optional mask scales it per pixel.',
  keywords: ['vector', 'direction', 'directional', 'wind', 'uniform', 'constant', 'flow'],
  inputs: [{ id: 'mask', name: 'Mask', type: 'gray', tooltip: 'Optional Gray mask multiplying the strength.' }],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  params: [
    P.enum('mode', 'angle', [{ value: 'angle', label: 'Angle' }, { value: 'line', label: 'Line (gizmo)' }], { group: 'Direction', label: 'Direction from' }),
    P.float('angle', 0, { group: 'Direction', label: 'Angle', display: 'angle', min: -360, max: 360, step: 1, animatable: true, visibleIf: (v) => v.mode === 'angle', tooltip: 'Degrees, clockwise on screen (0 = right, 90 = down).' }),
    P.vec2('p_a', [0.3, 0.5], { group: 'Direction', label: 'Start', min: -1, max: 2, step: 0.005, animatable: true }),
    P.vec2('p_b', [0.7, 0.5], { group: 'Direction', label: 'End', min: -1, max: 2, step: 0.005, animatable: true, visibleIf: (v) => v.mode === 'line' }),
    P.float('strength', 0.2, { group: 'Direction', label: 'Strength', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.005, animatable: true, unit: 'tile/s', tooltip: 'Tile fractions per second.' }),
  ],
  gizmos: [
    { id: 'dir_line', label: 'Direction', type: 'line', viewport: '2d', space: 'uv', from: 'p_a', to: 'p_b', visibleIf: (v) => v.mode === 'line' },
    { id: 'dir_angle', label: 'Angle', type: 'angle', viewport: '2d', space: 'uv', center: 'p_a', angle: 'angle', visibleIf: (v) => v.mode === 'angle' },
  ],
  gallery: [
    { name: 'Wind right', params: { angle: 0, strength: 0.3 } },
    { name: 'Rising', params: { angle: -90, strength: 0.25 } },
    { name: 'Diagonal', params: { angle: 45, strength: 0.4 } },
  ],
  shader: src,
});

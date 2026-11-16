import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.lic: line integral convolution. */
export default shaderNode({
  id: 'vector.lic',
  title: 'LIC (Line Integral Convolution)',
  description: 'Streaks a noise texture along a vector field: hair, wind lines, brushed flow, fur. Kernel length, kernel shape, optional noise input, tileable, animatable ripple phase.',
  keywords: ['lic', 'line', 'integral', 'convolution', 'streak', 'hair', 'wind', 'flow', 'fur', 'brush'],
  inputs: [{ id: 'vector', name: 'Vector', type: 'vector' }, { id: 'noise', name: 'Noise', type: 'gray', tooltip: 'Optional texture to streak; default: tileable white noise.' }],
  required: ['vector'],
  outputs: [{ id: 'output', name: 'Gray', type: 'gray' }],
  cost: { gpu: 'high', tiling: 'global' },
  params: [
    P.float('length', 0.12, { group: 'Kernel', label: 'Length', min: 0.001, max: 2, softMax: 0.5, step: 0.002, animatable: true, tooltip: 'Total streak length (tile fractions).' }),
    P.int('steps', 24, { group: 'Kernel', label: 'Steps per side', min: 2, max: 64 }),
    P.enum('kernel', 'hann', [{ value: 'box', label: 'Box' }, { value: 'triangle', label: 'Triangle' }, { value: 'hann', label: 'Hann' }], { group: 'Kernel', label: 'Kernel' }),
    P.bool('constant_speed', true, { group: 'Kernel', label: 'Constant speed', tooltip: 'Step along the direction only (streak length independent of the vector length).' }),
    P.float('noise_cells', 0.5, { group: 'Noise', label: 'Noise density', min: 0.02, max: 2, step: 0.01, display: 'percent', tooltip: 'Cells of the built-in white noise as a fraction of the resolution.' }),
    P.seed('seed', 9, { group: 'Noise', label: 'Seed' }),
    P.float('contrast', 2, { group: 'Output', label: 'Contrast', min: 0, max: 16, softMax: 6, step: 0.05 }),
    P.float('ripple', 0, { group: 'Animation', label: 'Ripple frequency', min: 0, max: 16, softMax: 6, step: 0.1, tooltip: 'Moving ripples along the streaks (0 = static).' }),
    P.float('phase', 0, { group: 'Animation', label: 'Phase', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: '0 to 1 is one loop of the ripples.' }),
  ],
  gallery: [{ name: 'Hair', params: { length: 0.2, noise_cells: 0.6, contrast: 2.5 } }, { name: 'Wind lines', params: { length: 0.3, noise_cells: 0.15, steps: 32 } }, { name: 'Moving ripples', params: { ripple: 3, phase: 0.3 } }],
  shader: src,
});

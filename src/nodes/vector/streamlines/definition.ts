import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.streamlines: mask of streamlines traced from jittered seed points. */
export default shaderNode({
  id: 'vector.streamlines',
  title: 'Vector Streamlines',
  description: 'Draws streamlines of a vector field as a mask: jittered seed grid (density), line length, width and fade. Tileable.',
  keywords: ['vector', 'streamline', 'lines', 'flow', 'trace', 'wind', 'visualize', 'seeds'],
  inputs: [{ id: 'vector', name: 'Vector', type: 'vector' }],
  required: ['vector'],
  outputs: [{ id: 'output', name: 'Mask', type: 'gray' }],
  cost: { gpu: 'high', tiling: 'global' },
  params: [
    P.int('density', 24, { group: 'Seeds', label: 'Seed density', min: 2, max: 128, softMax: 64, tooltip: 'Seed cells per side (one jittered seed per cell).' }),
    P.float('jitter', 0.8, { group: 'Seeds', label: 'Jitter', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.seed('seed', 4, { group: 'Seeds', label: 'Seed' }),
    P.float('length', 0.25, { group: 'Lines', label: 'Length', min: 0.005, max: 2, softMax: 0.6, step: 0.005, animatable: true }),
    P.float('width', 0.004, { group: 'Lines', label: 'Width', min: 0.0005, max: 0.2, softMax: 0.03, step: 0.0005 }),
    P.float('fade', 1, { group: 'Lines', label: 'Fade', min: 0, max: 8, softMax: 4, step: 0.05, tooltip: 'Fade towards the ends (0 = none).' }),
    P.int('steps', 64, { group: 'Lines', label: 'Steps', min: 8, max: 128, softMax: 96 }),
  ],
  gallery: [{ name: 'Sparse', params: { density: 12, length: 0.35 } }, { name: 'Dense', params: { density: 48, length: 0.12, width: 0.002 } }],
  shader: src,
});

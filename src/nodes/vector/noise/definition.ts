import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.noise: divergence-free curl noise (default) or plain vector noise, tileable, loops in Z (evolution 0 -> 1). */
export default shaderNode({
  id: 'vector.noise',
  title: 'Vector Noise',
  description: 'Tileable vector noise. Curl mode is divergence-free (swirling, incompressible); Plain mode has independent X / Y noise. Animate Evolution 0 to 1 for a seamless loop.',
  keywords: ['vector', 'noise', 'curl', 'turbulence', 'flow', 'divergence-free', 'tileable', 'loop'],
  inputs: [{ id: 'mask', name: 'Mask', type: 'gray', tooltip: 'Optional Gray mask multiplying the strength.' }],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  timeDependent: false,
  params: [
    P.enum('kind', 'curl', [{ value: 'curl', label: 'Curl (divergence-free)' }, { value: 'plain', label: 'Plain vector noise' }], { group: 'Noise', label: 'Type' }),
    P.vec2('scale', [4, 4], { group: 'Noise', label: 'Scale', min: 1, max: 64, softMax: 16, step: 1, linkable: true, labels: ['X', 'Y'], animatable: true, tooltip: 'Noise cells across the image (whole numbers are used so the field tiles).' }),
    P.int('octaves', 3, { group: 'Noise', label: 'Octaves', min: 1, max: 6 }),
    P.float('roughness', 0.5, { group: 'Noise', label: 'Roughness', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('strength', 0.2, { group: 'Noise', label: 'Strength', min: -100, max: 100, softMin: 0, softMax: 2, step: 0.005, animatable: true, unit: 'tile/s' }),
    P.vec2('offset', [0, 0], { group: 'Noise', label: 'Offset', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
    P.float('evolution', 0, { group: 'Animation', label: 'Evolution', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: '0 to 1 is one seamless loop.' }),
    P.int('z_cells', 2, { group: 'Animation', label: 'Z layers', min: 1, max: 16 }),
    P.seed('seed', 7, { group: 'Noise', label: 'Seed' }),
  ],
  gizmos: [{ id: 'pattern', label: 'Noise offset', type: 'transform', viewport: '2d', space: 'uv', position: { param: 'offset', map: { scale: -1, offset: 0.5 } }, scale: { param: 'scale', map: { reciprocal: true } }, tilingSafe: true }],
  gallery: [
    { name: 'Gentle swirls', params: { scale: [3, 3], strength: 0.15 } },
    { name: 'Fine turbulence', params: { scale: [10, 10], octaves: 4, strength: 0.3 } },
    { name: 'Plain noise', params: { kind: 'plain', strength: 0.4 } },
  ],
  shader: src,
});

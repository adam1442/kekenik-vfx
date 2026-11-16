import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.noise_warp: warps the field's domain with curl noise and / or adds noise to the vectors. */
export default shaderNode({
  id: 'vector.noise_warp',
  title: 'Vector Noise Warp',
  description: 'Perturbs a vector field: the sampling position is displaced by tileable curl noise (organic wobble) and curl noise can be added to the vectors themselves.',
  keywords: ['vector', 'noise', 'warp', 'turbulence', 'perturb', 'distort', 'organic'],
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  params: [
    P.float('warp', 0.05, { group: 'Noise', label: 'Warp amount', min: -2, max: 2, softMin: 0, softMax: 0.3, step: 0.002, animatable: true, tooltip: 'Domain displacement (tile space).' }),
    P.float('add', 0, { group: 'Noise', label: 'Add to vectors', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.005, animatable: true, tooltip: 'Strength of divergence-free noise added to the field.' }),
    P.vec2('scale', [4, 4], { group: 'Noise', label: 'Scale', min: 1, max: 64, softMax: 16, step: 1, linkable: true, labels: ['X', 'Y'] }),
    P.int('octaves', 2, { group: 'Noise', label: 'Octaves', min: 1, max: 6 }),
    P.float('roughness', 0.5, { group: 'Noise', label: 'Roughness', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('evolution', 0, { group: 'Animation', label: 'Evolution', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: '0 to 1 is one seamless loop.' }),
    P.int('z_cells', 2, { group: 'Animation', label: 'Z layers', min: 1, max: 16 }),
    P.seed('seed', 11, { group: 'Noise', label: 'Seed' }),
  ],
  gallery: [{ name: 'Wobble', params: { warp: 0.05 } }, { name: 'Turbulent', params: { warp: 0.1, add: 0.3, octaves: 4 } }],
  shader: src,
});

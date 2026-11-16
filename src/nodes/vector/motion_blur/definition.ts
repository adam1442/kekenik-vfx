import { P } from '../../../engine/params/schema';
import { shaderNodeVariants } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.motion_blur: blur along the vector of each pixel. */
export default shaderNodeVariants({
  id: 'vector.motion_blur',
  title: 'Vector Motion Blur',
  description: 'Blurs an image along the vector of every pixel (per-pixel directional blur): length multiplier, sample count, shutter offset and jitter against banding.',
  keywords: ['vector', 'motion', 'blur', 'streak', 'directional', 'smear', 'shutter'],
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }, { id: 'vector', name: 'Vector', type: 'vector' }],
  imagePins: ['input', 'output'],
  required: ['input', 'vector'],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.float('length', 0.2, { group: 'Blur', label: 'Length', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.005, animatable: true, unit: 's', tooltip: 'Blur length = vector x length (tile fractions).' }),
    P.int('samples', 16, { group: 'Blur', label: 'Samples', min: 2, max: 64 }),
    P.float('shutter', 0.5, { group: 'Blur', label: 'Shutter offset', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: '0 = trailing blur, 50% = centred, 100% = leading.' }),
    P.float('jitter', 0.5, { group: 'Blur', label: 'Jitter', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Random sample offsets (hide banding).' }),
    P.seed('seed', 2, { group: 'Blur', label: 'Seed' }),
  ],
  gallery: [{ name: 'Speed streaks', params: { length: 0.3, samples: 24 } }, { name: 'Leading', params: { shutter: 1 } }],
  shader: src,
});

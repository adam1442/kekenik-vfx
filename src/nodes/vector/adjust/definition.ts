import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.adjust: Normalize / Clamp / Remap / Invert in one node. */
export default shaderNode({
  id: 'vector.adjust',
  title: 'Vector Adjust',
  description: 'Normalize, clamp, remap and invert vectors: unit-length output, minimum / maximum length, dead zone, power curve on the length, per-component inversion.',
  keywords: ['vector', 'normalize', 'clamp', 'remap', 'invert', 'adjust', 'limit', 'deadzone', 'gain'],
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  params: [
    P.bool('normalize', false, { group: 'Length', label: 'Normalize', tooltip: 'Every non-zero vector gets the length below.' }),
    P.float('length', 1, { group: 'Length', label: 'Normalized length', min: 0, max: 1000, softMax: 4, step: 0.01, animatable: true, visibleIf: (v) => v.normalize === true }),
    P.float('deadzone', 0, { group: 'Length', label: 'Dead zone', min: 0, max: 1000, softMax: 1, step: 0.001, tooltip: 'Vectors shorter than this become zero.' }),
    P.float('min_len', 0, { group: 'Length', label: 'Minimum length', min: 0, max: 1000, softMax: 2, step: 0.01 }),
    P.float('max_len', 0, { group: 'Length', label: 'Maximum length', min: 0, max: 1000, softMax: 2, step: 0.01, tooltip: '0 = no limit.' }),
    P.float('power', 1, { group: 'Length', label: 'Power', min: 0.1, max: 8, step: 0.01, tooltip: 'Length is remapped as (length / reference) ^ power * reference.' }),
    P.float('reference', 1, { group: 'Length', label: 'Reference length', min: 0.001, max: 1000, softMax: 4, step: 0.01 }),
    P.float('gain', 1, { group: 'Length', label: 'Gain', min: -1000, max: 1000, softMin: -4, softMax: 4, step: 0.01, animatable: true }),
    P.bool('invert_x', false, { group: 'Invert', label: 'Invert X' }),
    P.bool('invert_y', false, { group: 'Invert', label: 'Invert Y' }),
  ],
  gallery: [{ name: 'Unit vectors', params: { normalize: true } }, { name: 'Limit speed', params: { max_len: 0.3 } }, { name: 'Invert', params: { invert_x: true, invert_y: true } }],
  shader: src,
});

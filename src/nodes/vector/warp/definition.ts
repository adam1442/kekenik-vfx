import { P } from '../../../engine/params/schema';
import { shaderNodeVariants } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.warp: displace an image (and optionally output the UV warp) by a Vector with a scale. */
export default shaderNodeVariants({
  id: 'vector.warp',
  title: 'Vector Warp',
  description: 'Displaces an image by a vector field with a scale (vector length x scale = tile fraction). Optionally outputs the absolute UV warp for other nodes. The Color variant can split RGB (chromatic).',
  keywords: ['vector', 'warp', 'displace', 'distort', 'uv', 'offset'],
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }, { id: 'vector', name: 'Vector', type: 'vector' }],
  imagePins: ['input', 'output'],
  required: ['input', 'vector'],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }, { id: 'uv', name: 'UV', type: 'uv', tooltip: 'Absolute UV lookup of the warp.' }],
  params: [
    P.float('scale', 0.2, { group: 'Warp', label: 'Scale', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.005, animatable: true, tooltip: 'Tile fractions of displacement per unit of vector length.' }),
    P.bool('normalize', false, { group: 'Warp', label: 'Normalize vectors', tooltip: 'Use the direction only (constant displacement).' }),
    P.float('chroma', 0, { group: 'Warp', label: 'Chromatic split', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Color variant only: red / blue are displaced less / more than green.' }),
  ],
  gallery: [{ name: 'Light', params: { scale: 0.1 } }, { name: 'Heavy', params: { scale: 0.5 } }, { name: 'Chromatic', params: { scale: 0.2, chroma: 0.3 } }],
  shader: src,
});

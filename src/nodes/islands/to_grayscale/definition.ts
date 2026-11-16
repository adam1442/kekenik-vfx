import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('islands_to_grayscale.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'out_range', type: 'vec2f' },
  { name: 'bg', type: 'f32' },
  { name: 'size_ref', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'steps', type: 'i32' },
]);
export const GRAY_MODES = ['random', 'area', 'width', 'height', 'aspect', 'pos_x', 'pos_y', 'center_distance'] as const;

/** islands.to_grayscale — random or measured (size / position) gray per island, ranges and quantisation. */
export default defineNode({
  id: 'islands.to_grayscale',
  version: 1,
  category: 'islands',
  title: 'Islands To Grayscale',
  description: 'One gray value per island: random, or derived from the island (bounding box area, width, height, aspect, position, distance from the image centre), with output range and quantization.',
  keywords: ['islands', 'random gray', 'per element', 'id', 'flood fill', 'random value', 'size', 'position'],
  icon: 'islands',
  inputs: [{ id: 'islands', name: 'Island Map', type: 'color' }],
  outputs: [{ id: 'output', name: 'Gray', type: 'gray' }],
  params: [
    P.enum('mode', 'random', [{ value: 'random', label: 'Random' }, { value: 'area', label: 'Box area' }, { value: 'width', label: 'Box width' }, { value: 'height', label: 'Box height' }, { value: 'aspect', label: 'Aspect (wide = high)' }, { value: 'pos_x', label: 'Position X' }, { value: 'pos_y', label: 'Position Y' }, { value: 'center_distance', label: 'Distance from centre' }], { group: 'Gray' }),
    P.vec2('range', [0, 1], { group: 'Gray', label: 'Output range', min: -4, max: 4, softMin: 0, softMax: 1, step: 0.01, labels: ['Min', 'Max'], animatable: true }),
    P.int('steps', 0, { group: 'Gray', label: 'Quantize steps', min: 0, max: 256, softMax: 16, tooltip: '0 / 1 = continuous.' }),
    P.float('size_reference', 0.25, { group: 'Gray', label: 'Size reference', min: 0.0001, max: 1, softMax: 1, step: 0.001, display: 'percent', visibleIf: (v) => v.mode === 'area' || v.mode === 'width' || v.mode === 'height', tooltip: 'Box side (fraction of the image) that maps to white; area uses its square.' }),
    P.float('background', 0, { group: 'Gray', label: 'Outside islands', min: 0, max: 1, step: 0.01 }),
    P.seed('seed', 1, { group: 'Gray' }),
  ],
  common: { texture: true, blending: true },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Stepped (4 levels)', params: { steps: 4 } }, { name: 'By size', params: { mode: 'area' } }, { name: 'Dark range', params: { range: [0.1, 0.5] } }],
  evaluate(ctx) {
    const src = ctx.texInput('islands');
    if (!src) throw new Error('Islands To Grayscale needs an Island Map');
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({ label: 'islands to gray', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { out_range: p.vec2('range'), bg: p.num('background'), size_ref: p.num('size_reference'), seed: p.seed('seed') >>> 0, mode: p.enumIndex('mode'), steps: p.int('steps') } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'gray') };
  },
});

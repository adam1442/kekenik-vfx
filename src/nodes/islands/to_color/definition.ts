import { defineNode } from '../../../engine/graph/node';
import { P, type GradientValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeGradientUniform256, GRAD_LUT_SIZE } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('islands_to_color.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'bg', type: 'vec4f' },
  { name: 'hue_range', type: 'vec2f' },
  { name: 'sat_range', type: 'vec2f' },
  { name: 'val_range', type: 'vec2f' },
  { name: 'seed', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'glut', type: 'vec4f', count: GRAD_LUT_SIZE },
]);
const RAINBOW = (): GradientValue => ({
  interp: 'linear',
  stops: [
    { pos: 0, color: [0.9, 0.15, 0.15, 1] },
    { pos: 0.25, color: [0.95, 0.8, 0.15, 1] },
    { pos: 0.5, color: [0.2, 0.85, 0.35, 1] },
    { pos: 0.75, color: [0.2, 0.5, 0.95, 1] },
    { pos: 1, color: [0.75, 0.25, 0.9, 1] },
  ],
});

/** islands.to_color — random (HSV ranges), gradient-mapped or sampled colour per island. */
export default defineNode({
  id: 'islands.to_color',
  version: 1,
  category: 'islands',
  title: 'Islands To Color',
  description: 'Gives every island its own colour: random HSV within ranges, a lookup into a gradient by the island id, or the colour of an input image sampled at the island centre.',
  keywords: ['islands', 'random color', 'per element', 'id color', 'flood fill', 'color per island', 'tint variation'],
  icon: 'islands',
  inputs: [
    { id: 'islands', name: 'Island Map', type: 'color' },
    { id: 'color', name: 'Color', type: 'color', optional: true, tooltip: 'Source for the "Sample input" mode: read at the centre of each island.' },
  ],
  outputs: [{ id: 'output', name: 'Color', type: 'color' }],
  params: [
    P.enum('mode', 'random', [{ value: 'random', label: 'Random HSV' }, { value: 'gradient', label: 'Gradient by ID' }, { value: 'input', label: 'Sample input at centre' }], { group: 'Color' }),
    P.vec2('hue_range', [0, 1], { group: 'Color', label: 'Hue range', min: -4, max: 4, softMin: 0, softMax: 1, step: 0.01, labels: ['Min', 'Max'], visibleIf: (v) => v.mode === 'random' }),
    P.vec2('sat_range', [0.6, 0.9], { group: 'Color', label: 'Saturation range', min: 0, max: 1, step: 0.01, labels: ['Min', 'Max'], visibleIf: (v) => v.mode === 'random' }),
    P.vec2('val_range', [0.6, 1], { group: 'Color', label: 'Value range', min: 0, max: 4, softMax: 1, step: 0.01, labels: ['Min', 'Max'], visibleIf: (v) => v.mode === 'random' }),
    P.gradient('gradient', RAINBOW(), { group: 'Color', animatable: true, visibleIf: (v) => v.mode === 'gradient' }),
    P.color('background_color', [0, 0, 0, 0], { group: 'Color', label: 'Outside islands' }),
    P.seed('seed', 1, { group: 'Color' }),
  ],
  common: { texture: true, blending: true },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Pastel', params: { sat_range: [0.25, 0.45], val_range: [0.85, 1] } },
    { name: 'Warm hues', params: { hue_range: [0, 0.12] } },
    { name: 'Gradient by ID', params: { mode: 'gradient' } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('islands');
    if (!src) throw new Error('Islands To Color needs an Island Map');
    const col = ctx.texInput('color');
    const p = ctx.params;
    const mode = p.str('mode');
    if (mode === 'input' && !col) throw new Error('"Sample input" mode needs the Color input');
    const out = ctx.tex('color');
    ctx.pass({
      label: 'islands to color',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { bg: p.rgba('background_color'), hue_range: p.vec2('hue_range'), sat_range: p.vec2('sat_range'), val_range: p.vec2('val_range'), seed: p.seed('seed') >>> 0, mode: mode === 'random' ? 0 : mode === 'gradient' ? 1 : 2, glut: bakeGradientUniform256(p.gradient('gradient')) } },
      textures: [src.tex, col?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});

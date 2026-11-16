import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** color.hue_spread — textures: t0 input colour (optional), t1 id (Gray). */
export const SHADER = defineShader('color_hue_spread.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'base', type: 'vec4f' },
  { name: 'has_input', type: 'u32' },
  { name: 'mode', type: 'u32' },
  { name: 'hue_start', type: 'f32' },
  { name: 'hue_range', type: 'f32' },
  { name: 'quantize', type: 'i32' },
  { name: 'repeat', type: 'f32' },
  { name: 'saturation', type: 'f32' },
  { name: 'value', type: 'f32' },
]);

export default defineNode({
  id: 'color.hue_spread',
  version: 1,
  category: 'color',
  title: 'Hue Spread',
  description: 'Spreads hue across a range using a Gray id or pattern (e.g. Islands -> Gray). Shift mode rotates the input hue, Set mode assigns the hue. Optional quantisation and repeats.',
  keywords: ['hue', 'random color', 'id', 'rainbow', 'spread', 'variation', 'islands'],
  icon: 'hue',
  inputs: [
    { id: 'input', name: 'Input', type: 'color', optional: true, tooltip: 'Colour to shift. Unconnected: "Base color".' },
    { id: 'id', name: 'Id', type: 'gray', tooltip: 'Gray value 0..1 that selects the position inside the hue range.' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: [
    P.color('base', [0.9, 0.2, 0.1, 1], { group: 'Hue', label: 'Base color', animatable: true }),
    P.enum('mode', 'set', [{ value: 'shift', label: 'Shift input hue' }, { value: 'set', label: 'Set hue' }], { group: 'Hue' }),
    P.float('hue_start', 0, { group: 'Hue', min: -3600, max: 3600, softMin: -360, softMax: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Hue at id = 0.' }),
    P.float('hue_range', 360, { group: 'Hue', min: -3600, max: 3600, softMin: -360, softMax: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Hue distance covered when id goes from 0 to 100%.' }),
    P.int('quantize', 0, { group: 'Id', min: 0, max: 256, softMax: 32, tooltip: '0 = continuous; N = N discrete hues.' }),
    P.float('repeat', 1, { group: 'Id', min: 0.01, max: 256, softMax: 16, step: 0.01, animatable: true, tooltip: 'Repeats the id before mapping (> 1 wraps).' }),
    P.float('saturation', 1, { group: 'Output', min: 0, max: 4, softMax: 1.5, step: 0.01, display: 'percent', animatable: true, tooltip: 'Shift mode: multiplier. Set mode: absolute saturation.' }),
    P.float('value', 1, { group: 'Output', min: 0, max: 16, softMax: 2, step: 0.01, display: 'percent', animatable: true }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Quantized 6', params: { quantize: 6 } },
    { name: 'Warm range', params: { hue_start: -30, hue_range: 80 } },
    { name: 'Repeat x3', params: { repeat: 3 } },
  ],
  evaluate(ctx) {
    const id = ctx.texInput('id');
    if (!id) throw new Error('Hue Spread needs an Id input');
    const src = ctx.texInput('input');
    const p = ctx.params;
    const out = ctx.tex('color');
    ctx.pass({
      label: 'hue spread',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { base: p.rgba('base'), has_input: src ? 1 : 0, mode: p.enumIndex('mode'), hue_start: p.num('hue_start'), hue_range: p.num('hue_range'), quantize: p.int('quantize'), repeat: p.num('repeat'), saturation: p.num('saturation'), value: p.num('value') },
      },
      textures: [src?.tex ?? null, id.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});

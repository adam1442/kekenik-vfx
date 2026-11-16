import { defineNode } from '../../../engine/graph/node';
import { defineShader } from '../../../engine/shaders/library';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_rgba_to_hsva.wgsl', shaderSrc);

/** utils.rgba_to_hsva — packs hue, saturation, value and alpha into the R, G, B, A channels. */
export default defineNode({
  id: 'utils.rgba_to_hsva',
  version: 1,
  category: 'utils',
  title: 'RGBA to HSVA',
  description: 'Converts RGBA to hue, saturation, value, alpha stored in the four channels.',
  keywords: ['hsv', 'hsva', 'convert', 'hue', 'saturation', 'color space'],
  icon: 'hue',
  inputs: [{ id: 'input', name: 'RGBA', type: 'color' }],
  outputs: [{ id: 'output', name: 'HSVA', type: 'color' }],
  params: [],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('RGBA to HSVA needs an input');
    const out = ctx.tex('color');
    ctx.pass({ label: 'rgba to hsva', target: out, shader: SHADER, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

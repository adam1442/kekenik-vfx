import { defineNode } from '../../../engine/graph/node';
import { defineShader } from '../../../engine/shaders/library';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_hsva_to_rgba.wgsl', shaderSrc);

/** utils.hsva_to_rgba — treats R, G, B, A as H, S, V, A (hue wraps; value may exceed 1 for HDR). */
export default defineNode({
  id: 'utils.hsva_to_rgba',
  version: 1,
  category: 'utils',
  title: 'HSVA to RGBA',
  description: 'Interprets the channels as hue, saturation, value, alpha and converts to RGBA.',
  keywords: ['hsv', 'hsva', 'convert', 'hue', 'saturation', 'color space'],
  icon: 'hue',
  inputs: [{ id: 'input', name: 'HSVA', type: 'color' }],
  outputs: [{ id: 'output', name: 'RGBA', type: 'color' }],
  params: [],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('HSVA to RGBA needs an input');
    const out = ctx.tex('color');
    ctx.pass({ label: 'hsva to rgba', target: out, shader: SHADER, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

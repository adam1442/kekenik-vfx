import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_alpha_split.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'which', type: 'u32' }, { name: 'unpremultiply', type: 'u32' }]);

/** utils.alpha_split — Color -> Color (rgb, alpha = 1) + Gray alpha. */
export default defineNode({
  id: 'utils.alpha_split',
  version: 1,
  category: 'utils',
  title: 'Alpha Split',
  description: 'Splits a Color texture into RGB (alpha 1) and a Gray alpha.',
  keywords: ['alpha', 'split', 'extract', 'opacity', 'transparency'],
  icon: 'split',
  inputs: [{ id: 'input', name: 'Input', type: 'color' }],
  outputs: [
    { id: 'color', name: 'Color', type: 'color' },
    { id: 'alpha', name: 'Alpha', type: 'gray' },
  ],
  params: [P.bool('unpremultiply', false, { group: 'Alpha', tooltip: 'Divide RGB by alpha (undo premultiplication).' })],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Un-premultiplied', params: { unpremultiply: true } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Alpha Split needs an input');
    const run = (which: number, pin: 'color' | 'gray') => {
      const t = ctx.tex(pin);
      ctx.pass({ label: which ? 'alpha' : 'rgb', target: t, shader: SHADER, uniforms: { layout: LAYOUT, values: { which, unpremultiply: ctx.params.bool('unpremultiply') } }, textures: [src.tex], ss: 1 });
      return ctx.result(t, pin);
    };
    return { color: run(0, 'color'), alpha: run(1, 'gray') };
  },
});

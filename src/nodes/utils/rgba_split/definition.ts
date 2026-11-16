import { defineNode } from '../../../engine/graph/node';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_rgba_split.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'ch', type: 'u32' }]);

/** utils.rgba_split — Color -> four Gray textures (R, G, B, A). Four 1-tap passes. */
export default defineNode({
  id: 'utils.rgba_split',
  version: 1,
  category: 'utils',
  title: 'RGBA Split',
  description: 'Splits a Color texture into its R, G, B and A channels as Gray textures.',
  keywords: ['unpack', 'channel', 'split', 'rgba', 'extract', 'separate'],
  icon: 'split',
  inputs: [{ id: 'input', name: 'Input', type: 'color' }],
  outputs: ['r', 'g', 'b', 'a'].map((c) => ({ id: c, name: c.toUpperCase(), type: 'gray' as const })),
  params: [],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('RGBA Split needs an input');
    const out: Record<string, ReturnType<typeof ctx.result>> = {};
    ['r', 'g', 'b', 'a'].forEach((id, ch) => {
      const t = ctx.tex('gray');
      ctx.pass({ label: `channel ${id}`, target: t, shader: SHADER, uniforms: { layout: LAYOUT, values: { ch } }, textures: [src.tex], ss: 1 });
      out[id] = ctx.result(t, 'gray');
    });
    return out;
  },
});

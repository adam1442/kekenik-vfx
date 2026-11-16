import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('normal_split.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'ch', type: 'u32' },
  { name: 'format', type: 'u32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'do_normalize', type: 'u32' },
]);

/** normal.normal_split — splits a normal map into X, Y, Z Gray textures. */
export default defineNode({
  id: 'normal.normal_split',
  version: 1,
  category: 'normal',
  title: 'Normal Split',
  description: 'Splits a normal map into X, Y and Z Gray textures: encoded (50% = 0), magnitude or positive part; optional Y flip and normalization.',
  keywords: ['normal', 'split', 'channels', 'xyz', 'separate', 'extract'],
  icon: 'split',
  inputs: [{ id: 'input', name: 'Normal', type: 'normal' }],
  outputs: ['x', 'y', 'z'].map((c) => ({ id: c, name: c.toUpperCase(), type: 'gray' as const })),
  params: [
    P.enum('format', 'encoded', [{ value: 'encoded', label: 'Encoded (50% = 0)' }, { value: 'magnitude', label: 'Magnitude |n|' }, { value: 'positive', label: 'Positive part' }], { group: 'Split' }),
    P.bool('flip_y', false, { group: 'Split', label: 'Flip Y' }),
    P.bool('normalize', true, { group: 'Split' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Magnitude', params: { format: 'magnitude' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Normal Split needs an input');
    const p = ctx.params;
    const out: Record<string, ReturnType<typeof ctx.result>> = {};
    ['x', 'y', 'z'].forEach((id, ch) => {
      const t = ctx.tex('gray');
      ctx.pass({ label: `normal split ${id}`, target: t, shader: SHADER, uniforms: { layout: LAYOUT, values: { ch, format: p.enumIndex('format'), flip_y: p.bool('flip_y'), do_normalize: p.bool('normalize') } }, textures: [src.tex], ss: 1 });
      out[id] = ctx.result(t, 'gray');
    });
    return out;
  },
});

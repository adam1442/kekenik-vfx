import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('normal_normal_to_color.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'format', type: 'u32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'do_normalize', type: 'u32' },
]);

/** normal.normal_to_color — Normal -> Color for editing / packing / export (encoded, signed float, two channel, DXT5nm). */
export default defineNode({
  id: 'normal.normal_to_color',
  version: 1,
  category: 'normal',
  title: 'Normal to Color',
  description: 'Converts a normal map to a Color texture: encoded RGB, signed float vectors, two-channel RG or DXT5nm layout; optional Y flip (OpenGL <-> DirectX).',
  keywords: ['normal', 'normal to color', 'pack', 'export', 'dxt5nm', 'two channel', 'convert', 'flip green'],
  icon: 'mask',
  inputs: [{ id: 'input', name: 'Normal', type: 'normal' }],
  outputs: [{ id: 'output', name: 'Color', type: 'color' }],
  params: [
    P.enum('format', 'encoded', [{ value: 'encoded', label: 'Encoded RGB (0.5 neutral)' }, { value: 'signed', label: 'Signed vector (float)' }, { value: 'two_channel', label: 'Two channel RG' }, { value: 'dxt5nm', label: 'DXT5nm (A = X, G = Y)' }], { group: 'Convert' }),
    P.bool('flip_y', false, { group: 'Convert', label: 'Flip Y (green)' }),
    P.bool('normalize', true, { group: 'Convert' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Flip green (GL <-> DX)', params: { flip_y: true } }, { name: 'Two channel', params: { format: 'two_channel' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Normal to Color needs an input');
    const p = ctx.params;
    const out = ctx.tex('color');
    ctx.pass({ label: 'normal to color', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { format: p.enumIndex('format'), flip_y: p.bool('flip_y'), do_normalize: p.bool('normalize') } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

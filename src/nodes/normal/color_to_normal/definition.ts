import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('normal_color_to_normal.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'source', type: 'u32' },
  { name: 'flip_x', type: 'u32' },
  { name: 'flip_y', type: 'u32' },
  { name: 'do_normalize', type: 'u32' },
]);

/** normal.color_to_normal — reinterprets a Color texture as a normal map (imported / painted normals, two-channel formats). */
export default defineNode({
  id: 'normal.color_to_normal',
  version: 1,
  category: 'normal',
  title: 'Color to Normal',
  description: 'Interprets a Color texture as a normal map: RGB as stored, two-channel RG with reconstructed Z, or DXT5nm (X in alpha, Y in green). Optional axis flips and renormalization.',
  keywords: ['normal', 'color to normal', 'import', 'dxt5nm', 'two channel', 'reconstruct z', 'convert'],
  icon: 'mask',
  inputs: [{ id: 'input', name: 'Color', type: 'color' }],
  outputs: [{ id: 'output', name: 'Normal', type: 'normal' }],
  params: [
    P.enum('source', 'rgb', [{ value: 'rgb', label: 'RGB (as stored)' }, { value: 'rg', label: 'RG (reconstruct Z)' }, { value: 'dxt5nm', label: 'DXT5nm (A = X, G = Y)' }], { group: 'Convert' }),
    P.bool('flip_x', false, { group: 'Convert', label: 'Flip X (red)' }),
    P.bool('flip_y', false, { group: 'Convert', label: 'Flip Y (green)', tooltip: 'Converts between OpenGL and DirectX normal maps.' }),
    P.bool('normalize', true, { group: 'Convert', visibleIf: (v) => v.source === 'rgb' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [{ name: 'Two channel (BC5)', params: { source: 'rg' } }, { name: 'DXT5nm', params: { source: 'dxt5nm' } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Color to Normal needs an input');
    const p = ctx.params;
    const out = ctx.tex('normal');
    ctx.pass({ label: 'color to normal', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { source: p.enumIndex('source'), flip_x: p.bool('flip_x'), flip_y: p.bool('flip_y'), do_normalize: p.bool('normalize') } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'normal') };
  },
});

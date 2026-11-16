import { defineNode } from '../../../engine/graph/node';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { imageExportParams } from '../../_shared/exportparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('export_color.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'opaque', type: 'u32' }]);

/** export.color — Color texture export (PNG / TGA / EXR / HDR / DDS, flipbooks, sequences). Run it from the Export panel. */
export default defineNode({
  id: 'export.color',
  version: 1,
  category: 'export',
  title: 'Export Color',
  description: 'Writes a Color texture (RGBA) as PNG / TGA / EXR / HDR / DDS: sRGB or linear, 8 / 16-bit or float, optional premultiplied alpha, size override, image sequences and flipbook sheets with padding and JSON metadata. Use the Export panel to run it.',
  keywords: ['export', 'save', 'png', 'exr', 'tga', 'color', 'texture', 'flipbook', 'sequence', 'sheet', 'atlas', 'hdr'],
  icon: 'cat-export',
  inputs: [{ id: 'input', name: 'Color', type: 'color' }],
  outputs: [{ id: 'output', name: 'Export', type: 'color' }],
  params: imageExportParams('color', { format: 'png', depth: '8' }),
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Export Color needs a Color input');
    const out = ctx.tex('color');
    ctx.pass({ label: 'export color', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { opaque: ctx.params.bool('alpha') ? 0 : 1 } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

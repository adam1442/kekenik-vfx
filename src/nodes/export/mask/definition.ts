import { defineNode } from '../../../engine/graph/node';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { imageExportParams } from '../../_shared/exportparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('export_mask.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'unused', type: 'u32' }]);

/** export.mask — single-channel (Gray) export: 8 / 16-bit gray PNG, TGA, EXR (Y), HDR. */
export default defineNode({
  id: 'export.mask',
  version: 1,
  category: 'export',
  title: 'Export Mask',
  description: 'Writes a Gray texture as a single-channel image (gray PNG / TGA / EXR "Y" / HDR), linear by default. Same size, frame, sequence and flipbook options as Export Color.',
  keywords: ['export', 'mask', 'gray', 'single channel', 'png', 'exr', 'height', 'alpha mask'],
  icon: 'cat-export',
  inputs: [{ id: 'input', name: 'Gray', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Export', type: 'gray' }],
  params: imageExportParams('mask', { format: 'png', depth: '16', colorSpace: 'linear' }),
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Export Mask needs a Gray input');
    const out = ctx.tex('gray');
    ctx.pass({ label: 'export mask', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { unused: 0 } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'gray') };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { ENGINE_PRESETS, type EngineId } from '../../../export/engines';
import { imageExportParams } from '../../_shared/exportparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('export_normal.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'lay', type: 'u32' }, { name: 'dx', type: 'u32' }]);

/** export.normal — normal map export: OpenGL / DirectX Y, 8 / 16-bit, optional Z reconstruction or two-channel (BC5 style) layout. */
export default defineNode({
  id: 'export.normal',
  version: 1,
  category: 'export',
  title: 'Export Normal',
  description: 'Writes a normal map. Y convention OpenGL (Unity, Godot) or DirectX (Unreal) — "Engine" follows the engine preset. Layouts: full XYZ, XYZ with Z rebuilt from XY, or RG only (B = 0, for BC5 / two-channel imports). Always linear data.',
  keywords: ['export', 'normal', 'directx', 'opengl', 'bc5', 'tangent', 'png', 'unreal', 'unity'],
  icon: 'cat-export',
  inputs: [{ id: 'input', name: 'Normal', type: 'normal' }],
  outputs: [{ id: 'output', name: 'Export', type: 'normal' }],
  params: [
    P.enum('convention', 'engine', [{ value: 'engine', label: 'From engine preset' }, { value: 'opengl', label: 'OpenGL (Y+)' }, { value: 'directx', label: 'DirectX (Y−)' }], { tab: 'Export', group: 'Normal', label: 'Y convention' }),
    P.enum('normal_layout', 'xyz', [{ value: 'xyz', label: 'XYZ' }, { value: 'reconstruct', label: 'XYZ, Z reconstructed' }, { value: 'rg', label: 'RG only (BC5 style, B = 0)' }], { tab: 'Export', group: 'Normal', label: 'Layout' }),
    ...imageExportParams('normal', { format: 'png', depth: '16', colorSpace: 'linear' }),
  ],
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Export Normal needs a Normal input');
    const p = ctx.params;
    const conv = p.str('convention');
    const dx = (conv === 'engine' ? ENGINE_PRESETS[p.str('engine') as EngineId].normal : conv) === 'directx';
    const out = ctx.tex('normal');
    ctx.pass({ label: 'export normal', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { lay: p.enumIndex('normal_layout'), dx } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'normal') };
  },
});

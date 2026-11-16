import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { imageExportParams } from '../../_shared/exportparams';
import { MOTION_CONVENTIONS } from '../../vector/motion_encode/definition';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('export_motion_vector.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'scale', type: 'f32' }, { name: 'flip', type: 'u32' }, { name: 'signed_out', type: 'u32' }]);

/** export.motion_vector: exports a Vector (flipbook) sheet as PNG16 / EXR with a JSON sidecar (scale, grid, frame count, convention). */
export default defineNode({
  id: 'export.motion_vector',
  version: 1,
  category: 'export',
  title: 'Export Motion Vector',
  description: 'Writes a motion vector flipbook (Vector sheet) as 16-bit PNG or EXR, encoded for Unreal / Unity / Godot, plus a JSON sidecar with scale, grid, frame count and the convention.',
  keywords: ['export', 'motion', 'vector', 'flipbook', 'png', 'exr', 'unreal', 'unity', 'godot', 'sidecar'],
  icon: 'cat-export',
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  outputs: [{ id: 'output', name: 'Export', type: 'color' }],
  params: [
    ...imageExportParams('color', { format: 'png', depth: '16', colorSpace: 'linear' }),
    P.float('mv_scale', 0.1, { tab: 'Motion', group: 'Motion vectors', label: 'Scale', min: 0.0001, max: 100, softMax: 1, step: 0.001, precision: 4, tooltip: 'Vector length (tile fractions per frame) that maps to the full range; written to the sidecar.' }),
    P.enum('mv_convention', 'unreal', [{ value: 'unreal', label: 'Unreal' }, { value: 'unity', label: 'Unity' }, { value: 'godot', label: 'Godot' }, { value: 'custom', label: 'Custom' }], { tab: 'Motion', group: 'Motion vectors', label: 'Engine convention' }),
    P.bool('mv_flip_y', false, { tab: 'Motion', group: 'Motion vectors', label: 'Flip Y (custom)', visibleIf: (v) => v.mv_convention === 'custom' }),
    P.bool('mv_signed', false, { tab: 'Motion', group: 'Motion vectors', label: 'Signed float (no 0.5 bias)', tooltip: 'Use with EXR / float.' }),
    P.int('mv_cols', 0, { tab: 'Motion', group: 'Vector flipbook', label: 'Sheet columns', min: 0, max: 256, tooltip: 'Exporting a vector flipbook sheet (Motion Vector Generate output, Export tab: frame mode Single, size = the sheet size)? Enter its grid so the sidecar JSON carries it. 0 = plain image.' }),
    P.int('mv_rows', 0, { tab: 'Motion', group: 'Vector flipbook', label: 'Sheet rows', min: 0, max: 256, visibleIf: (v) => Number(v.mv_cols) > 0 }),
    P.int('mv_frames', 0, { tab: 'Motion', group: 'Vector flipbook', label: 'Sheet frames', min: 0, max: 65536, visibleIf: (v) => Number(v.mv_cols) > 0, tooltip: '0 = columns x rows.' }),
    P.float('mv_fps', 30, { tab: 'Motion', group: 'Vector flipbook', label: 'Sheet FPS', min: 1, max: 1000, softMax: 120, visibleIf: (v) => Number(v.mv_cols) > 0, tooltip: 'Playback rate of the flipbook the vectors belong to.' }),
  ],
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Export Motion Vector needs a Vector input');
    const p = ctx.params;
    const conv = p.str('mv_convention') as keyof typeof MOTION_CONVENTIONS;
    const out = ctx.tex('color');
    const flip = (conv === 'custom' ? p.bool('mv_flip_y') : MOTION_CONVENTIONS[conv]?.flipY) ? 1 : 0;
    ctx.pass({ label: 'export motion vector', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { scale: p.num('mv_scale'), flip, signed_out: p.bool('mv_signed') ? 1 : 0 } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

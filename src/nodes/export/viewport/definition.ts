import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { DEFAULT_TEMPLATE } from '../../../export/naming';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('export_viewport.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'has_tex', type: 'u32' }]);
const T = 'Export';
const is = (k: string, ...vals: unknown[]) => (v: Record<string, unknown>): boolean => vals.includes(v[k]);

/** export.viewport — 2D / 3D view export as image or image sequence (supersampling, transparency, 3x3 tiling preview, turntable). */
export default defineNode({
  id: 'export.viewport',
  version: 1,
  category: 'export',
  title: 'Export Viewport',
  description: '2D: the Color input as a picture (optional 3x3 tiling preview, safe frames, background). 3D: renders the Mesh input with the Camera input (or a turntable) through the 3D viewport renderer, optional Color texture as material. Image or sequence, supersampled, transparent background. Export formats: PNG / TGA (8-bit).',
  keywords: ['export', 'viewport', 'render', 'turntable', 'screenshot', 'sequence', 'camera', 'preview', '3x3', 'tiling'],
  icon: 'cat-export',
  inputs: [
    { id: 'color', name: 'Color', type: 'color', optional: true },
    { id: 'mesh', name: 'Mesh', type: 'mesh', optional: true },
    { id: 'camera', name: 'Camera', type: 'camera', optional: true },
  ],
  outputs: [{ id: 'output', name: 'View', type: 'color' }],
  params: [
    P.bool('enabled', true, { tab: T, group: 'Output', label: 'Include in "Export all"' }),
    P.string('file_name', `${DEFAULT_TEMPLATE}_{frame:4}`, { tab: T, group: 'Output', label: 'File name' }),
    P.enum('source', '3d', [{ value: '2d', label: '2D view (Color input)' }, { value: '3d', label: '3D view (Mesh input)' }], { tab: T, group: 'Output', label: 'View' }),
    P.enum('format', 'png', [{ value: 'png', label: 'PNG (8-bit)' }, { value: 'tga', label: 'TGA (8-bit)' }], { tab: T, group: 'Output' }),
    P.vec2('size', [1920, 1080], { tab: T, group: 'Output', label: 'Resolution (px)', min: 16, max: 16384, step: 1 }),
    P.enum('ss', '2', [{ value: '1', label: 'Off' }, { value: '2', label: '2x2' }, { value: '3', label: '3x3' }, { value: '4', label: '4x4' }], { tab: T, group: 'Quality', label: 'Supersampling', tooltip: 'Rendered at N times the resolution in tiles and box-filtered down: memory stays bounded.' }),
    P.bool('transparent', true, { tab: T, group: 'Quality', label: 'Transparent background' }),
    P.color('background', [0.08, 0.09, 0.1, 1], { tab: T, group: 'Quality', label: 'Background colour', visibleIf: (v) => !v.transparent }),
    P.bool('tile3x3', false, { tab: T, group: '2D', label: '3x3 tiling preview', visibleIf: is('source', '2d') }),
    P.bool('safe_frames', false, { tab: T, group: '2D', label: 'Safe frames overlay (90% / 80%)', visibleIf: is('source', '2d') }),
    P.enum('display', 'unlit', [{ value: 'matcap', label: 'Matcap' }, { value: 'pbr', label: 'PBR' }, { value: 'unlit', label: 'Unlit' }, { value: 'vertex_color', label: 'Vertex colour' }, { value: 'normals', label: 'Normals' }, { value: 'wireframe', label: 'Wireframe' }], { tab: T, group: '3D', label: 'Display', visibleIf: is('source', '3d') }),
    P.enum('blend', 'additive', [{ value: 'opaque', label: 'Opaque' }, { value: 'alpha', label: 'Alpha' }, { value: 'additive', label: 'Additive' }], { tab: T, group: '3D', label: 'Material blend', visibleIf: is('source', '3d'), tooltip: 'How the Color input is shown on the mesh.' }),
    P.enum('frame_mode', 'single', [{ value: 'single', label: 'Single image' }, { value: 'sequence', label: 'Sequence (timeline frames)' }, { value: 'turntable', label: 'Turntable sequence' }], { tab: T, group: 'Frames' }),
    P.int('frame_start', 0, { tab: T, group: 'Frames', label: 'First frame', min: -100000, max: 100000 }),
    P.int('frame_count', 0, { tab: T, group: 'Frames', label: 'Frame count (0 = graph loop)', min: 0, max: 4096, visibleIf: (v) => v.frame_mode !== 'single' }),
    P.float('turn_degrees', 360, { tab: T, group: 'Frames', label: 'Turntable degrees', min: -3600, max: 3600, softMin: -360, softMax: 360, visibleIf: is('frame_mode', 'turntable') }),
    P.float('turn_elevation', 0, { tab: T, group: 'Frames', label: 'Turntable elevation offset', min: -80, max: 80, display: 'angle', visibleIf: is('frame_mode', 'turntable') }),
  ],
  common: { texture: false, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('color');
    const out = ctx.tex('color');
    ctx.pass({ label: 'export viewport', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { has_tex: src ? 1 : 0 } }, textures: [src?.tex ?? null], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

import type { ParamValue } from '../engine/params/schema';

/**
 * Export presets for common game targets. A preset is a partial parameter set for one export node type; applying it
 * is one undo step (Export panel -> "Preset"). Ids are stable; values only use parameters defined by the Export nodes.
 */
export interface ExportPreset {
  id: string;
  label: string;
  group: string;
  types: string[];
  params: Record<string, ParamValue>;
}

const flip = (n: number, cols: number, rows: number, size: number, extra: Record<string, ParamValue> = {}): Record<string, ParamValue> => ({
  frame_mode: 'flipbook', frame_count: n, fb_cols: cols, fb_rows: rows, size_mode: 'absolute', size_abs: [size, size], fb_padding: 2, fb_json: true, ...extra,
});

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: 'ue-color', label: 'Unreal · Color texture (PNG 8, sRGB)', group: 'Unreal', types: ['export.color'], params: { engine: 'unreal', format: 'png', depth: '8', color_space: 'auto', alpha: true } },
  { id: 'ue-flipbook-8x8', label: 'Unreal · Flipbook 8×8, 2048 (PNG 8)', group: 'Unreal', types: ['export.color'], params: flip(64, 8, 8, 2048, { engine: 'unreal', format: 'png', depth: '8', color_space: 'auto' }) },
  { id: 'ue-flipbook-4x4-16', label: 'Unreal · Flipbook 4×4, 2048 (PNG 16-bit)', group: 'Unreal', types: ['export.color'], params: flip(16, 4, 4, 2048, { engine: 'unreal', format: 'png', depth: '16', color_space: 'auto' }) },
  { id: 'ue-pack', label: 'Unreal · Channel pack RGBA (PNG 8, linear)', group: 'Unreal', types: ['export.multimask'], params: { engine: 'unreal', format: 'png', depth: '8', color_space: 'linear', slots: 'rgba' } },
  { id: 'ue-normal', label: 'Unreal · Normal map (DirectX, PNG 16)', group: 'Unreal', types: ['export.normal'], params: { engine: 'unreal', convention: 'engine', format: 'png', depth: '16', normal_layout: 'xyz' } },
  { id: 'ue-flow', label: 'Unreal · Flowmap (PNG 16, biased)', group: 'Unreal', types: ['export.warp'], params: { engine: 'unreal', codec: 'biased', range: 0.1, flow_sign: 'flow', flip_y: 'engine', format: 'png', depth: '16' } },
  { id: 'ue-mesh', label: 'Unreal · Mesh (GLB, Z-up, cm)', group: 'Unreal', types: ['export.mesh'], params: { engine: 'unreal', mode: 'mesh', mesh_format: 'glb', axis: 'engine', unit_scale: 0 } },
  { id: 'ue-vat', label: 'Unreal · VAT soft body (EXR half)', group: 'Unreal', types: ['export.mesh'], params: { engine: 'unreal', mode: 'vat_soft', mesh_format: 'glb', vat_format: 'exr_half', vat_normals: true } },
  { id: 'unity-color', label: 'Unity · Color texture (PNG 8, sRGB)', group: 'Unity', types: ['export.color'], params: { engine: 'unity', format: 'png', depth: '8', color_space: 'auto', alpha: true } },
  { id: 'unity-flipbook-6x6', label: 'Unity · Flipbook 6×6, 2048 (PNG 8)', group: 'Unity', types: ['export.color'], params: flip(36, 6, 6, 2048, { engine: 'unity', format: 'png', depth: '8', color_space: 'auto' }) },
  { id: 'unity-normal', label: 'Unity · Normal map (OpenGL, PNG 16)', group: 'Unity', types: ['export.normal'], params: { engine: 'unity', convention: 'engine', format: 'png', depth: '16' } },
  { id: 'unity-flow', label: 'Unity · Flowmap (PNG 16, Flip Y)', group: 'Unity', types: ['export.warp'], params: { engine: 'unity', codec: 'biased', range: 0.1, flow_sign: 'flow', flip_y: 'engine', format: 'png', depth: '16' } },
  { id: 'unity-mesh', label: 'Unity · Mesh (GLB, Y-up left handed)', group: 'Unity', types: ['export.mesh'], params: { engine: 'unity', mode: 'mesh', mesh_format: 'glb', axis: 'engine', unit_scale: 0 } },
  { id: 'unity-vat', label: 'Unity · VAT soft body (PNG 16)', group: 'Unity', types: ['export.mesh'], params: { engine: 'unity', mode: 'vat_soft', mesh_format: 'glb', vat_format: 'png16' } },
  { id: 'godot-color', label: 'Godot · Color texture (PNG 8, sRGB)', group: 'Godot', types: ['export.color'], params: { engine: 'godot', format: 'png', depth: '8', color_space: 'auto', alpha: true } },
  { id: 'godot-normal', label: 'Godot · Normal map (OpenGL, PNG 8)', group: 'Godot', types: ['export.normal'], params: { engine: 'godot', convention: 'engine', format: 'png', depth: '8' } },
  { id: 'godot-flow', label: 'Godot · Flowmap (PNG 16, biased)', group: 'Godot', types: ['export.warp'], params: { engine: 'godot', codec: 'biased', range: 0.1, flow_sign: 'flow', format: 'png', depth: '16' } },
  { id: 'godot-mesh', label: 'Godot · Mesh (GLB, Y-up)', group: 'Godot', types: ['export.mesh'], params: { engine: 'godot', mode: 'mesh', mesh_format: 'glb', axis: 'engine' } },
  { id: 'flip-exr', label: 'Flipbook · EXR half float, 4×4, 2048', group: 'Generic', types: ['export.color'], params: flip(16, 4, 4, 2048, { engine: 'none', format: 'exr', depth: 'half', color_space: 'linear' }) },
  { id: 'seq-png16', label: 'Sequence · PNG 16-bit frames', group: 'Generic', types: ['export.color', 'export.mask'], params: { frame_mode: 'sequence', format: 'png', depth: '16' } },
  { id: 'hdr', label: 'Radiance HDR (RGB float)', group: 'Generic', types: ['export.color'], params: { format: 'hdr', depth: 'float', color_space: 'linear', alpha: false } },
  { id: 'mask16', label: 'Mask · 16-bit gray PNG (linear)', group: 'Generic', types: ['export.mask'], params: { format: 'png', depth: '16', color_space: 'linear' } },
  { id: 'pivot-uv', label: 'Pivot-baked mesh (GLB, pivots in UV)', group: 'Generic', types: ['export.mesh'], params: { mode: 'pivot', mesh_format: 'glb', pivot_encoding: 'uv' } },
  { id: 'rigid-vat', label: 'VAT rigid body (EXR half)', group: 'Generic', types: ['export.mesh'], params: { mode: 'vat_rigid', mesh_format: 'glb', vat_format: 'exr_half' } },
  { id: 'turntable-1080', label: 'Viewport · Turntable 120 frames, 1080p, 2× SSAA', group: 'Viewport', types: ['export.viewport'], params: { source: '3d', frame_mode: 'turntable', frame_count: 120, size: [1920, 1080], ss: '2', transparent: true } },
  { id: 'tile-3x3', label: 'Viewport · 3×3 tiling preview, 2048²', group: 'Viewport', types: ['export.viewport'], params: { source: '2d', tile3x3: true, size: [2046, 2046], frame_mode: 'single' } },
];

export const presetsFor = (type: string): ExportPreset[] => EXPORT_PRESETS.filter((p) => p.types.includes(type));


import { t } from '../shared/i18n';/**
 * Engine presets. A preset only supplies DEFAULTS for conventions the user left on "engine" / "auto"; explicit node
 * settings always win. Documented in docs/EXPORT_GUIDE.md.
 */
export type EngineId = 'none' | 'unreal' | 'unity' | 'godot';
export type MeshAxis = 'gltf' | 'zup' | 'unreal' | 'unity';

export interface EnginePreset {
  id: EngineId;
  label: string;
  /** Normal map Y convention: Unreal = DirectX (green down), Unity / Godot = OpenGL (green up). */
  normal: 'opengl' | 'directx';
  /** Warp / flowmap: mirror the vertical component (Unity textures are bottom-up). */
  warpFlipY: boolean;
  /** Warp default codec for 8 / 16-bit outputs. */
  warpCodec: 'biased' | 'offset';
  /** Colour textures are authored sRGB (all engines) and data textures linear (flag the import accordingly). */
  colorSrgb: boolean;
  /** Needs power-of-two textures for mips / streaming (warn otherwise). */
  pot: boolean;
  /** Block compression wants multiples of 4. */
  multipleOf4: boolean;
  /** Mesh coordinate system / unit scale used by the Mesh exporter. */
  meshAxis: MeshAxis;
  meshScale: number;
  /** Suggested channel packing note shown in the panel. */
  packing: string;
  /** Suggested default format for textures. */
  format: 'png' | 'tga' | 'exr';
}

export const ENGINE_PRESETS: Record<EngineId, EnginePreset> = {
  none: { id: 'none', label: t('engines.noneManual'), normal: 'opengl', warpFlipY: false, warpCodec: 'biased', colorSrgb: true, pot: false, multipleOf4: false, meshAxis: 'zup', meshScale: 1, packing: 'Manual', format: 'png' },
  unreal: { id: 'unreal', label: 'Unreal Engine', normal: 'directx', warpFlipY: false, warpCodec: 'biased', colorSrgb: true, pot: true, multipleOf4: true, meshAxis: 'unreal', meshScale: 100, packing: 'R = mask 1, G = mask 2, B = mask 3, A = mask 4 (import with sRGB OFF, Compression: Masks / Normalmap)', format: 'png' },
  unity: { id: 'unity', label: 'Unity', normal: 'opengl', warpFlipY: true, warpCodec: 'biased', colorSrgb: true, pot: false, multipleOf4: true, meshAxis: 'unity', meshScale: 1, packing: 'Unity masks: uncheck sRGB (Color Texture); flowmaps: uncheck sRGB, Flip Y on', format: 'png' },
  godot: { id: 'godot', label: 'Godot', normal: 'opengl', warpFlipY: false, warpCodec: 'biased', colorSrgb: true, pot: false, multipleOf4: true, meshAxis: 'gltf', meshScale: 1, packing: 'Import as Detect 3D: Normal Map / VRAM Compressed; masks: sRGB off', format: 'png' },
};
export const ENGINE_OPTIONS = (Object.values(ENGINE_PRESETS) as EnginePreset[]).map((p) => ({ value: p.id, label: p.label }));

/** 3x3 coordinate transforms (row-major) from the authoring space (Z up, +Y forward, right handed) to the target space. */
export const AXIS_MATRICES: Record<MeshAxis, number[]> = {
  zup: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  gltf: [1, 0, 0, 0, 0, 1, 0, -1, 0], // (x, y, z) -> (x, z, -y): Y up, right handed
  unity: [1, 0, 0, 0, 0, 1, 0, 1, 0], // (x, y, z) -> (x, z, y): Y up, LEFT handed
  unreal: [0, 1, 0, 1, 0, 0, 0, 0, 1], // (x, y, z) -> (y, x, z): X forward, Y right, Z up, LEFT handed
};
export const matDet3 = (m: number[]): number => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
export const AXIS_LABELS: Record<MeshAxis, string> = { zup: 'Z up, right handed (as authored)', gltf: 'glTF: Y up, right handed', unity: 'Unity: Y up, left handed', unreal: 'Unreal: Z up, left handed (X forward)' };

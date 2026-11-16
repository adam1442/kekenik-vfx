import type { ParamDef } from '../../engine/params/schema';
import { P } from '../../engine/params/schema';
import { ENGINE_OPTIONS } from '../../export/engines';
import { DEFAULT_TEMPLATE } from '../../export/naming';
import type { ImageKind } from '../../export/settings';

/**
 * Parameter schema shared by every Export node. The Export panel and the job runner read these params through
 * `resolveImageSettings` (src/export/settings.ts): param ids are persisted in project files, never rename.
 */
const is = (k: string, ...vals: unknown[]) => (v: Record<string, unknown>): boolean => vals.includes(v[k]);

export const FORMAT_OPTIONS = [
  { value: 'png', label: 'PNG' },
  { value: 'tga', label: 'TGA' },
  { value: 'exr', label: 'OpenEXR' },
  { value: 'hdr', label: 'Radiance HDR' },
  { value: 'dds', label: 'DDS (uncompressed)' },
];
export const DEPTH_OPTIONS = [
  { value: '8', label: '8-bit' },
  { value: '16', label: '16-bit' },
  { value: 'half', label: 'Half float (16f)' },
  { value: 'float', label: 'Float (32f)' },
];

/** Output / size / frames / flipbook tabs of an image export node. */
export function imageExportParams(kind: ImageKind, d: { format?: string; depth?: string; colorSpace?: string } = {}): ParamDef[] {
  const T = 'Export';
  return [
    P.bool('enabled', true, { tab: T, group: 'Output', label: 'Include in "Export all"' }),
    P.string('file_name', DEFAULT_TEMPLATE, { tab: T, group: 'Output', label: 'File name', tooltip: 'Tokens: {graph} {node} {frame} {frame:4} {w} {h} {date} {time} {engine} {format}. A "/" creates sub folders.' }),
    P.enum('engine', 'none', ENGINE_OPTIONS, { tab: T, group: 'Output', label: 'Engine preset', tooltip: 'Sets channel / normal / flow conventions and validation rules for Unreal, Unity or Godot.' }),
    P.enum('format', d.format ?? 'png', FORMAT_OPTIONS, { tab: T, group: 'Output' }),
    P.enum('depth', d.depth ?? '8', DEPTH_OPTIONS, { tab: T, group: 'Output', label: 'Bit depth', tooltip: 'PNG: 8 / 16. TGA: 8. EXR: half / float. HDR: float. Invalid combinations are corrected (and logged).' }),
    P.enum('color_space', d.colorSpace ?? 'auto', [{ value: 'auto', label: 'Auto (by kind / engine)' }, { value: 'srgb', label: 'sRGB' }, { value: 'linear', label: 'Linear' }], { tab: T, group: 'Output', label: 'Color space', tooltip: 'EXR / HDR are always linear. Data textures (masks, normals, warps) should be linear.' }),
    ...(kind === 'color' ? [P.bool('alpha', true, { tab: T, group: 'Output', label: 'Write alpha' }), P.bool('premultiply', false, { tab: T, group: 'Output', label: 'Premultiplied alpha', tooltip: 'RGB is multiplied by alpha in linear light before the colour space encoding.' })] : []),
    ...(kind === 'mask' ? [P.bool('as_rgb', false, { tab: T, group: 'Output', label: 'Store as RGB (gray replicated)' })] : []),
    P.enum('exr_compression', 'zip', [{ value: 'zip', label: 'ZIP (16 lines)' }, { value: 'none', label: 'None' }], { tab: T, group: 'Output', label: 'EXR compression', visibleIf: is('format', 'exr') }),
    P.enum('size_mode', 'graph', [{ value: 'graph', label: 'From graph' }, { value: 'multiplier', label: 'Multiplier' }, { value: 'absolute', label: 'Absolute (pixels)' }], { tab: T, group: 'Size' }),
    P.vec2('size_mul', [1, 1], { tab: T, group: 'Size', label: 'Width / height multiplier', min: 0.01, max: 64, step: 0.05, visibleIf: is('size_mode', 'multiplier') }),
    P.vec2('size_abs', [1024, 1024], { tab: T, group: 'Size', label: 'Width / height (px)', min: 1, max: 16384, step: 1, visibleIf: is('size_mode', 'absolute'), tooltip: 'Non-square and non-power-of-two sizes are allowed. Above the memory budget the export is rendered in tiles.' }),
    P.enum('frame_mode', 'single', [{ value: 'single', label: 'Single frame' }, { value: 'sequence', label: 'Image sequence' }, { value: 'flipbook', label: 'Flipbook sheet' }], { tab: T, group: 'Frames' }),
    P.int('frame_start', 0, { tab: T, group: 'Frames', label: 'First frame', min: -100000, max: 100000, step: 1 }),
    P.int('frame_count', 0, { tab: T, group: 'Frames', label: 'Frame count (0 = graph loop)', min: 0, max: 4096, step: 1, visibleIf: (v) => v.frame_mode !== 'single' }),
    P.int('fb_cols', 0, { tab: T, group: 'Flipbook', label: 'Columns (0 = auto)', min: 0, max: 256, visibleIf: is('frame_mode', 'flipbook') }),
    P.int('fb_rows', 0, { tab: T, group: 'Flipbook', label: 'Rows (0 = auto)', min: 0, max: 256, visibleIf: is('frame_mode', 'flipbook') }),
    P.int('fb_padding', 0, { tab: T, group: 'Flipbook', label: 'Cell edge padding (px)', min: 0, max: 64, visibleIf: is('frame_mode', 'flipbook'), tooltip: 'Replicates the edge pixels inside each cell (mip-safe). The frame is rendered smaller by 2 x padding.' }),
    P.enum('fb_row_order', 'top_down', [{ value: 'top_down', label: 'Top down' }, { value: 'bottom_up', label: 'Bottom up' }], { tab: T, group: 'Flipbook', label: 'Row order', visibleIf: is('frame_mode', 'flipbook') }),
    P.bool('fb_json', true, { tab: T, group: 'Flipbook', label: 'Write JSON metadata', visibleIf: is('frame_mode', 'flipbook') }),
    P.bool('fb_files', false, { tab: T, group: 'Flipbook', label: 'Also write every frame as a file', visibleIf: is('frame_mode', 'flipbook') }),
    ...(kind === 'color' || kind === 'multimask' ? [P.int('edge_padding', 0, { tab: T, group: 'Quality', label: 'Colour dilation (px)', min: 0, max: 64, visibleIf: (v) => v.alpha !== false, tooltip: 'Bleeds colour into fully transparent pixels (mip-safe edges). Needs alpha.' })] : []),
  ];
}

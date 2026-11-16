import { P, type EnumOption, type ParamDef } from '../params/schema';

/**
 * Common tabs added automatically by the engine.
 *
 * TEXTURE tab: Size / Filtering / Tiling each have a SOURCE (From Graph | From Parent | Absolute) and HQ supersampling.
 *   - From Graph:  size = graph size x multiplier;  filter/tiling = the graph's.
 *   - From Parent: size = first connected texture input's size x multiplier; filter/tiling = that node's.
 *                  Falls back to From Graph when the node has no connected texture input (generators).
 *   - Absolute:    size in pixels (scaled with the preview-resolution factor during interaction); explicit filter/tiling.
 *   Default is From Parent everywhere (so a Levels after a 256px noise stays 256px).
 * BLENDING tab: shown only while the 'background' pin is connected. The engine blends the node's result with the
 *   Background after evaluate(). Cross mix: 0% = background only, 50% = the pure blend result, 100% = foreground only.
 */

export const TEXTURE_TAB = 'Texture';
export const BLENDING_TAB = 'Blending';

/** Order == WGSL BM_* constants in blend.wgsl. */
export const BLEND_MODES: EnumOption[] = [
  { value: 'copy', label: 'Copy' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'max', label: 'Max (Lighten)' },
  { value: 'min', label: 'Min (Darken)' },
  { value: 'smooth_min', label: 'Smooth Min' },
  { value: 'smooth_max', label: 'Smooth Max' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'difference', label: 'Difference' },
  { value: 'divide', label: 'Divide' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'soft_light', label: 'Soft Light' },
  // appended (ids 14+ keep every stored project valid). 18..21 are non-separable (rgb) modes.
  { value: 'hard_light', label: 'Hard Light' },
  { value: 'color_dodge', label: 'Color Dodge' },
  { value: 'color_burn', label: 'Color Burn' },
  { value: 'linear_light', label: 'Linear Light' },
  { value: 'hue', label: 'Hue (Color)' },
  { value: 'saturation', label: 'Saturation (Color)' },
  { value: 'color', label: 'Color (Color)' },
  { value: 'luminosity', label: 'Luminosity (Color)' },
];

const SOURCES: EnumOption[] = [
  { value: 'from_graph', label: 'From Graph' },
  { value: 'from_parent', label: 'From Parent' },
  { value: 'absolute', label: 'Absolute' },
];

export const COMMON_PARAM_IDS = new Set([
  'tex_size_mode',
  'tex_size_mul',
  'tex_size_abs',
  'tex_filter_mode',
  'tex_filter',
  'tex_tiling_mode',
  'tex_tiling',
  'tex_ss',
  'blend_mode',
  'blend_cross',
  'blend_smooth',
]);

export function commonTextureParams(): ParamDef[] {
  const tab = TEXTURE_TAB;
  return [
    P.enum('tex_size_mode', 'from_parent', SOURCES, { tab, group: 'Size', label: 'Size source', tooltip: 'Where the output resolution comes from.' }),
    P.vec2('tex_size_mul', [1, 1], {
      tab,
      group: 'Size',
      label: 'Size multiplier',
      min: 1 / 64,
      max: 64,
      softMin: 0.125,
      softMax: 4,
      step: 0.125,
      labels: ['W', 'H'],
      linkable: true,
      tooltip: 'Width/height multipliers applied to the source size.',
      visibleIf: (v) => v.tex_size_mode !== 'absolute',
    }),
    P.vec2('tex_size_abs', [1024, 1024], {
      tab,
      group: 'Size',
      label: 'Size (px)',
      min: 1,
      max: 16384,
      softMin: 16,
      softMax: 4096,
      integer: true,
      unit: 'px',
      labels: ['W', 'H'],
      visibleIf: (v) => v.tex_size_mode === 'absolute',
    }),
    P.enum('tex_filter_mode', 'from_parent', SOURCES, { tab, group: 'Filtering', label: 'Filtering source' }),
    P.enum('tex_filter', 'linear', ['point', 'linear', 'cubic'], { tab, group: 'Filtering', label: 'Filtering', visibleIf: (v) => v.tex_filter_mode === 'absolute' }),
    P.enum('tex_tiling_mode', 'from_parent', SOURCES, { tab, group: 'Tiling', label: 'Tiling source' }),
    P.enum(
      'tex_tiling',
      'both',
      [
        { value: 'none', label: 'No tiling' },
        { value: 'both', label: 'Tiling' },
        { value: 'x', label: 'Horizontal only' },
        { value: 'y', label: 'Vertical only' },
      ],
      { tab, group: 'Tiling', label: 'Tiling', visibleIf: (v) => v.tex_tiling_mode === 'absolute' },
    ),
    P.int('tex_ss', 1, { tab, group: 'Quality', label: 'HQ supersampling', min: 1, max: 4, tooltip: '1 = off. N = N x N samples per pixel (antialiasing).' }),
  ];
}

export function commonBlendingParams(): ParamDef[] {
  const tab = BLENDING_TAB;
  const showWhenConnected = 'background';
  return [
    P.enum('blend_mode', 'max', BLEND_MODES, { tab, showWhenConnected, label: 'Blend type' }),
    P.float('blend_cross', 0.5, { tab, showWhenConnected, label: 'Cross mix', display: 'percent', min: 0, max: 1, step: 0.01, animatable: true, tooltip: '0% = background only, 50% = even blend, 100% = foreground only.' }),
    P.float('blend_smooth', 0.1, {
      tab,
      showWhenConnected,
      label: 'Smoothness',
      min: 0,
      max: 1,
      step: 0.01,
      visibleIf: (v) => v.blend_mode === 'smooth_min' || v.blend_mode === 'smooth_max',
    }),
  ];
}

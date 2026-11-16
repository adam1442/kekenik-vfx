import convertGrayColorSrc from './passes/convert_gray_color.wgsl?raw';
import backgroundBlendSrc from './passes/background_blend.wgsl?raw';
import presentSrc from './passes/present.wgsl?raw';
import { defineShader } from './library';
import { makeLayout } from './uniforms';

/** Engine-owned passes (not nodes). */
export const CONVERT_GRAY_COLOR = defineShader('convert_gray_color.wgsl', convertGrayColorSrc);
export const BACKGROUND_BLEND = defineShader('background_blend.wgsl', backgroundBlendSrc);
export const PRESENT = defineShader('present.wgsl', presentSrc);

export const BACKGROUND_BLEND_LAYOUT = makeLayout([
  { name: 'blend_mode', type: 'u32' },
  { name: 'cross_mix', type: 'f32' },
  { name: 'smoothness', type: 'f32' },
]);

export const PRESENT_LAYOUT = makeLayout([
  { name: 'tiles', type: 'f32' },
  { name: 'wrap', type: 'u32' },
  { name: 'channel', type: 'u32' },
  { name: 'exposure', type: 'f32' },
  { name: 'srgb', type: 'u32' },
  { name: 'is_gray', type: 'u32' },
  { name: 'is_uv', type: 'u32' },
  { name: 'filter_mode', type: 'u32' },
]);

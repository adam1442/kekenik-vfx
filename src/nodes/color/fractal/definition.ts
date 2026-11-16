import { defineNode } from '../../../engine/graph/node';
import { P, type GradientValue } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeGradientUniform256, GRAD_LUT_SIZE } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import gray, { FRACTAL_FIELDS, fractalPass } from '../../grayscale/fractal/definition';
import shaderSrc from './shader.wgsl?raw';

/**
 * color.fractal — Colour version of grayscale.fractal. Same parameters, pins, texture slots, gizmos and tiling / loop
 * behaviour (the shader is the shared `fractal_core` module), plus per-splat colour: gradient (random position per
 * splat), random hue, or gradient by splat profile. Output rgb = splat colour * coverage (HDR gain), alpha opaque or coverage.
 */
export const SHADER = defineShader('color_fractal.wgsl', shaderSrc);
export const DEFINES = { FRACTAL_COLOR: 1 };
export const LAYOUT = makeLayout([
  ...FRACTAL_FIELDS,
  { name: 'color_mode', type: 'u32' },
  { name: 'hue_min', type: 'f32' },
  { name: 'hue_max', type: 'f32' },
  { name: 'col_sat', type: 'f32' },
  { name: 'col_val', type: 'f32' },
  { name: 'color_gain', type: 'f32' },
  { name: 'alpha_mode', type: 'u32' },
  { name: 'glut', type: 'vec4f', count: GRAD_LUT_SIZE },
]);

const sparks = (): GradientValue => ({
  interp: 'oklab',
  stops: [
    { pos: 0, color: [1, 0.12, 0.02, 1] },
    { pos: 0.5, color: [1, 0.55, 0.05, 1] },
    { pos: 1, color: [0.2, 0.6, 1, 1] },
  ],
});
const colorMode = (v: Record<string, unknown>): boolean => v.color_mode !== 'hue';

export default defineNode({
  id: 'color.fractal',
  version: 1,
  category: 'color',
  title: 'Fractal (Color)',
  description: 'The splat Fractal with colour per splat: pick colours from a gradient (random or by splat profile) or random hues. Everything else (shapes, octaves, Z loop, UV, modulation pins, tiling) is identical to the Gray Fractal.',
  keywords: ['splat', 'confetti', 'sparks', 'stars', 'bokeh', 'dots', 'fractal', 'colored', 'random color'],
  icon: 'fractal',
  inputs: gray.inputs,
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: true },
  params: [
    ...gray.params,
    P.enum('color_mode', 'gradient', [
      { value: 'gradient', label: 'Gradient (random per splat)' },
      { value: 'hue', label: 'Random hue' },
      { value: 'profile', label: 'Gradient by splat profile', tooltip: 'Gradient position = the splat profile value: gives every splat its own glow ramp.' },
    ], { tab: 'Color', group: 'Splat color', label: 'Color source' }),
    P.gradient('color_gradient', sparks(), { tab: 'Color', group: 'Splat color', label: 'Gradient', visibleIf: colorMode, animatable: true }),
    P.float('hue_min', 0, { tab: 'Color', group: 'Splat color', label: 'Hue min', min: -4, max: 4, softMin: 0, softMax: 1, step: 0.005, display: 'percent', visibleIf: (v) => v.color_mode === 'hue', tooltip: '100% = a full turn of the colour wheel.' }),
    P.float('hue_max', 1, { tab: 'Color', group: 'Splat color', label: 'Hue max', min: -4, max: 4, softMin: 0, softMax: 1, step: 0.005, display: 'percent', visibleIf: (v) => v.color_mode === 'hue' }),
    P.float('col_sat', 0.85, { tab: 'Color', group: 'Splat color', label: 'Saturation', min: 0, max: 1, step: 0.01, display: 'percent', visibleIf: (v) => v.color_mode === 'hue' }),
    P.float('col_val', 1, { tab: 'Color', group: 'Splat color', label: 'Value', min: 0, max: 4, softMax: 1, step: 0.01, display: 'percent', visibleIf: (v) => v.color_mode === 'hue' }),
    P.float('color_gain', 1, { tab: 'Color', group: 'Output', label: 'Color gain (HDR)', min: 0, max: 64, softMax: 4, step: 0.01, animatable: true }),
    P.enum('alpha_mode', 'opaque', [{ value: 'opaque', label: 'Opaque (color on black)' }, { value: 'coverage', label: 'Coverage' }], { tab: 'Color', group: 'Output', label: 'Alpha' }),
  ],
  gizmos: gray.gizmos,
  cost: gray.cost,
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 10, defines: DEFINES }],
  gallery: [
    { name: 'Rainbow dots', params: { color_mode: 'hue', shape: 'cone', inner: 0.8, scale: [8, 8], octaves: 1, pos_random: 0.4, scale_min: 0.5, scale_max: 0.8 } },
    { name: 'Glowing blobs', params: { color_mode: 'profile', shape: 'cone', scale: [4, 4], octaves: 1, scale_min: 0.8, scale_max: 1.4 } },
    { name: 'Confetti stars', params: { shape: 'star', sides: 5, secondary: 0.4, scale: [7, 7], octaves: 2, rot_min: -90, rot_max: 90, inner: 0.9, octave_mode: 'max' } },
    { name: 'Pastel hex', params: { color_mode: 'hue', col_sat: 0.4, shape: 'polygon', sides: 6, inner: 0.9, scale: [6, 6], octaves: 1, pos_random: 0.2 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    return fractalPass(
      ctx,
      'color',
      SHADER,
      LAYOUT,
      {
        color_mode: p.enumIndex('color_mode'),
        hue_min: p.num('hue_min'),
        hue_max: p.num('hue_max'),
        col_sat: p.num('col_sat'),
        col_val: p.num('col_val'),
        color_gain: p.num('color_gain'),
        alpha_mode: p.enumIndex('alpha_mode'),
        glut: bakeGradientUniform256(p.gradient('color_gradient')),
      },
      DEFINES,
    );
  },
});

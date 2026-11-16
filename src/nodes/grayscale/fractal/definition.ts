import { defineNode } from '../../../engine/graph/node';
import { identityCurve, P, type ParamValues } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeCurveUniform, isIdentityCurve, LUT_VEC4 } from '../../../engine/shaders/lut';
import { makeLayout, type UField, type UniformLayout } from '../../../engine/shaders/uniforms';
import type { EvalContext } from '../../../engine/graph/node';
import type { ShaderSource } from '../../../engine/shaders/library';
import type { UniformValue } from '../../../engine/shaders/uniforms';
import { gizmos } from './gizmo';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.fractal — recursively splatted shapes on a jittered grid, octave by octave (see shader.wgsl for the algorithm).
 *
 * Texture slots (order == shader): t0 z_position mod, t1 ramp mod, t2 gain mod, t3 uv mod, t4 scale mod,
 * t5 intensity mod, t6 visibility mod, t7 atlas mod, t8 input pattern / atlas, t9 UV map.
 */
export const SHADER = defineShader('grayscale_fractal.wgsl', shaderSrc);

const f = (name: string) => ({ name, type: 'f32' as const });
const mk = (name: string) => ({ name, type: 'u32' as const });
const mi = (name: string) => ({ name, type: 'i32' as const });
export const FRACTAL_FIELDS: UField[] = [
  { name: 'scale', type: 'vec2f' },
  { name: 'position', type: 'vec2f' },
  f('rotation'),
  f('anisotropy'),
  mk('seed'),
  mk('add_z'),
  f('z_position'),
  f('z_position_mod_k'),
  mi('z_layers'),
  mk('shape'),
  mi('sides'),
  f('rounding'),
  f('secondary'),
  f('inner'),
  mi('atlas_cols'),
  mi('atlas_rows'),
  f('atlas_pick'),
  f('atlas_pick_mod_k'),
  mk('splat_blend'),
  f('max_smooth'),
  mi('octaves'),
  f('lacunarity'),
  mk('octave_mode'),
  f('ramp'),
  f('ramp_mod_k'),
  f('gain'),
  f('gain_mod_k'),
  mk('has_pattern'),
  mk('has_uv'),
  mk('uv_align'),
  f('uv_amount'),
  f('uv_amount_mod_k'),
  f('rot_min'),
  f('rot_max'),
  f('flip_h'),
  f('flip_v'),
  f('scale_min'),
  f('scale_max'),
  f('hscale_min'),
  f('hscale_max'),
  f('vscale_min'),
  f('vscale_max'),
  f('size'),
  f('size_mod_k'),
  f('pos_random'),
  { name: 'pos_scale', type: 'vec2f' },
  mk('quincunx'),
  f('int_min'),
  f('int_max'),
  f('intensity'),
  f('intensity_mod_k'),
  f('visibility'),
  f('visibility_mod_k'),
  f('vis_width'),
  mi('reach'),
  mk('shape_curve_on'),
  { name: 'shape_lut', type: 'vec4f', count: LUT_VEC4 },
];
export const LAYOUT = makeLayout(FRACTAL_FIELDS);

export const SHAPES = ['cone', 'pyramid', 'polygon', 'star', 'pixel'] as const;
export const OCTAVE_MODES = ['add', 'max', 'fbm', 'mix', 'multiply', 'screen'] as const;

/**
 * Number of neighbouring cells (each side) the shader visits per octave: 1 => 3x3, 2 => 5x5 (hard cap).
 * A splat of half extent H cells whose centre may be jittered by up to J cells can only reach pixels whose cell
 * is within ceil(H + J - 0.5) cells of its own, so large/very jittered splats need the larger window.
 */
export function computeReach(v: ParamValues, hasUv: boolean): number {
  const num = (id: string): number => v[id] as number;
  if (v.shape === 'pixel') return 1;
  const sizeMax = Math.max(num('scale_min'), num('scale_max')) * Math.max(num('hscale_min'), num('hscale_max'), num('vscale_min'), num('vscale_max')) * Math.max(num('size'), 1);
  const rotates = hasUv && v.uv_align === 'per_splat' ? true : num('rot_min') !== 0 || num('rot_max') !== 0;
  const half = 0.5 * sizeMax * (rotates ? Math.SQRT2 : 1);
  const ps = v.pos_scale as number[];
  const jitterHalf = 0.5 * num('pos_random') * Math.max(ps[0], ps[1]);
  const quin = v.quincunx === 'none' ? 0 : 0.5;
  return Math.min(2, Math.max(1, Math.ceil(half + jitterHalf + quin - 0.5 - 1e-6)));
}

const isMaxOctave = (v: ParamValues): boolean => v.octave_mode === 'max';
const usesRamp = (v: ParamValues): boolean => v.octave_mode === 'mix' || v.octave_mode === 'multiply' || v.octave_mode === 'screen';

export default defineNode({
  id: 'grayscale.fractal',
  version: 1,
  category: 'grayscale',
  title: 'Fractal',
  description: 'Layers recursively splatted shapes on a jittered grid, octave by octave: cones, pyramids, polygons, stars, single pixels or your own pattern / atlas. Tileable, loopable (Z layers), UV-alignable and modulatable per pixel.',
  keywords: ['splat', 'scatter', 'cellular', 'fractal', 'pattern', 'sparks', 'stars', 'bokeh', 'dots', 'atlas'],
  icon: 'fractal',
  inputs: [
    { id: 'pattern', name: 'Input Pattern', type: 'gray', optional: true, tooltip: 'Gray pattern splatted instead of the built-in shape. Set "Atlas size" above 1x1 to treat it as an atlas of elements.' },
    { id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: aligns / deforms the fractal (see the UV tab).' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    /* ------------------------------------------------------------- Main */
    P.vec2('position', [0, 0], { group: 'Main', softMin: -1, softMax: 1, step: 0.01, labels: ['X', 'Y'], tooltip: 'Moves the pattern. The pattern repeats every 100% translation.' }),
    P.vec2('scale', [4, 4], { group: 'Main', label: 'Grid scale', min: 1, max: 256, softMax: 32, step: 1, labels: ['X', 'Y'], linkable: true, tooltip: 'Grid cells across the image on the first octave. Rounded to whole numbers on tiling axes so the pattern wraps seamlessly.' }),
    P.seed('seed', 0, { group: 'Main' }),
    P.float('rotation', 0, { group: 'Main', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, tooltip: 'Rotates the grid. While the graph tiles it snaps to 90 degree steps.' }),
    P.float('anisotropy', 0, { group: 'Main', min: -1, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: '+ squeezes the pattern horizontally, - vertically. Ignored while the graph tiles (it would break seamlessness).' }),
    P.bool('add_z', false, { group: 'Z axis', label: 'Add Z axis', tooltip: 'Gives every splat a life along Z: its attributes are re-rolled per Z layer and interpolated between layers.' }),
    P.float('z_position', 0, { group: 'Z axis', label: 'Z position', min: -100, max: 100, softMin: 0, softMax: 1, step: 0.001, display: 'percent', animatable: true, modulatable: true, visibleIf: (v) => v.add_z === true, tooltip: '0% and 100% give the same pattern, so animating 0 -> 100% loops seamlessly.' }),
    P.int('z_layers', 3, { group: 'Z axis', label: 'Z layers', min: 1, max: 32, softMax: 12, visibleIf: (v) => v.add_z === true, tooltip: 'Number of independent slices along Z (interpolated). More layers = more change per loop.' }),

    /* ------------------------------------------------------------- Fractal tab */
    P.enum(
      'shape',
      'cone',
      [
        { value: 'cone', label: 'Cone', tooltip: '1 in the centre ramping to 0; "Inner filling" makes it cylinder-like.' },
        { value: 'pyramid', label: 'Pyramid', tooltip: 'Square pyramid using 100% of the cell.' },
        { value: 'polygon', label: 'Regular polygon' },
        { value: 'star', label: 'Regular star' },
        { value: 'pixel', label: 'Single pixel', tooltip: 'Always exactly one pixel. Feed it to the Distance node for animatable custom Voronoi.' },
      ],
      { tab: 'Fractal', group: 'Shape' },
    ),
    P.int('sides', 5, { tab: 'Fractal', group: 'Shape', min: 3, max: 32, softMax: 12, visibleIf: (v) => v.shape === 'polygon' || v.shape === 'star' }),
    P.float('rounding', 0, { tab: 'Fractal', group: 'Shape', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: (v) => v.shape === 'polygon' || v.shape === 'star' }),
    P.float('secondary', 0.4, { tab: 'Fractal', group: 'Shape', label: 'Secondary size', min: 0.02, max: 1, display: 'percent', step: 0.01, visibleIf: (v) => v.shape === 'star', tooltip: 'Inner radius of the star (pinching).' }),
    P.float('inner', 0, { tab: 'Fractal', group: 'Shape', label: 'Inner filling', min: 0, max: 0.99, display: 'percent', step: 0.01, visibleIf: (v) => v.shape !== 'pixel', tooltip: 'Flat plateau in the middle of the splat (0% = pointed).' }),
    P.vec2('atlas_size', [1, 1], { tab: 'Fractal', group: 'Atlas', label: 'Atlas size', min: 1, max: 16, step: 1, integer: true, labels: ['Columns', 'Rows'], showWhenConnected: 'pattern', tooltip: 'Elements of the input pattern when it is an atlas.' }),
    P.float('atlas_pick', 0, { tab: 'Fractal', group: 'Atlas', label: 'Atlas', min: 0, max: 1, display: 'percent', step: 0.01, modulatable: true, showWhenConnected: 'pattern', tooltip: 'Offset added to the element choice. Connect "Atlas mod": its intensity blends from a random element per splat (0%) to the element chosen by the texture (100%).' }),
    P.curve('shape_curve', identityCurve(), { tab: 'Fractal', group: 'Shape', label: 'Shape remap', tooltip: 'Luminance curve applied over the splat profile.' }),
    P.enum('splat_blend', 'max', [{ value: 'add', label: 'Add' }, { value: 'max', label: 'Max' }], { tab: 'Fractal', group: 'Splats', label: 'Splat blending', tooltip: 'How overlapping splats inside one octave combine.' }),
    P.float('max_smooth', 0, { tab: 'Fractal', group: 'Splats', label: 'Max smoothness', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: (v) => v.splat_blend === 'max' || isMaxOctave(v) }),
    P.int('octaves', 3, { tab: 'Fractal', group: 'Octaves', min: 1, max: 8, tooltip: 'Number of grid refinements.' }),
    P.float('lacunarity', 2, { tab: 'Fractal', group: 'Octaves', min: 1.1, max: 8, softMax: 4, step: 0.05, tooltip: 'Grid size ratio between octaves. While tiling only whole numbers keep the grid periodic (it is rounded).' }),
    P.enum(
      'octave_mode',
      'fbm',
      [
        { value: 'add', label: 'Add' },
        { value: 'max', label: 'Max' },
        { value: 'fbm', label: 'Fractional Brownian Motion', tooltip: 'Amplitude-normalised sum.' },
        { value: 'mix', label: 'Mix (ramp)', tooltip: 'Each octave is mixed over the previous result with weight ramp x amplitude.' },
        { value: 'multiply', label: 'Multiply (ramp)' },
        { value: 'screen', label: 'Screen (ramp)' },
      ],
      { tab: 'Fractal', group: 'Octaves', label: 'Octave blending' },
    ),
    P.float('ramp', 1, { tab: 'Fractal', group: 'Octaves', label: 'Blending ramp', min: 0, max: 1, display: 'percent', step: 0.01, modulatable: true, animatable: true, visibleIf: usesRamp, tooltip: 'Weight of the octave blend (Mix / Multiply / Screen). Unavailable for fBm and Max.' }),
    P.float('gain', 0.5, { tab: 'Fractal', group: 'Octaves', min: -2, max: 2, softMin: -1, softMax: 1, step: 0.01, display: 'percent', modulatable: true, animatable: true, tooltip: 'Amplitude change per octave. Negative values alternate / invert octaves.' }),

    /* ------------------------------------------------------------- UV tab */
    P.enum(
      'uv_align',
      'per_pixel',
      [
        { value: 'ignore', label: 'Ignore' },
        { value: 'per_splat', label: 'Per splat', tooltip: 'Rotates every splat by the local orientation of the UV map.' },
        { value: 'per_pixel', label: 'Per pixel', tooltip: 'Rotates and deforms: the lookup position goes through the UV map.' },
      ],
      { tab: 'UV', group: 'UV', label: 'Align to UVs', showWhenConnected: 'uv' },
    ),
    P.float('uv_amount', 1, { tab: 'UV', group: 'UV', label: 'UV', min: 0, max: 4, softMax: 1, display: 'percent', step: 0.01, modulatable: true, showWhenConnected: 'uv', tooltip: 'UV distortion amount for the whole texture.' }),

    /* ------------------------------------------------------------- Splats tab */
    P.float('rot_min', 0, { tab: 'Splats', group: 'Orientation', label: 'Rotation min', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle' }),
    P.float('rot_max', 0, { tab: 'Splats', group: 'Orientation', label: 'Rotation max', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle' }),
    P.float('flip_h', 0, { tab: 'Splats', group: 'Orientation', label: 'Flip horizontal', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Chance that a splat is mirrored horizontally.' }),
    P.float('flip_v', 0, { tab: 'Splats', group: 'Orientation', label: 'Flip vertical', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Chance that a splat is mirrored vertically.' }),
    P.float('scale_min', 0.6, { tab: 'Splats', group: 'Size', label: 'Scale min', min: 0, max: 4, softMax: 2, display: 'percent', step: 0.01, tooltip: '100% = the splat fills its cell.' }),
    P.float('scale_max', 1, { tab: 'Splats', group: 'Size', label: 'Scale max', min: 0, max: 4, softMax: 2, display: 'percent', step: 0.01 }),
    P.float('hscale_min', 1, { tab: 'Splats', group: 'Size', label: 'Horizontal scale min', min: 0.01, max: 4, softMax: 2, display: 'percent', step: 0.01 }),
    P.float('hscale_max', 1, { tab: 'Splats', group: 'Size', label: 'Horizontal scale max', min: 0.01, max: 4, softMax: 2, display: 'percent', step: 0.01 }),
    P.float('vscale_min', 1, { tab: 'Splats', group: 'Size', label: 'Vertical scale min', min: 0.01, max: 4, softMax: 2, display: 'percent', step: 0.01 }),
    P.float('vscale_max', 1, { tab: 'Splats', group: 'Size', label: 'Vertical scale max', min: 0.01, max: 4, softMax: 2, display: 'percent', step: 0.01 }),
    P.float('size', 1, { tab: 'Splats', group: 'Size', label: 'Scale', min: 0, max: 4, softMax: 2, display: 'percent', step: 0.01, modulatable: true, animatable: true, tooltip: 'Global splat scale multiplier (modulated at each splat centre).' }),
    P.float('pos_random', 1, { tab: 'Splats', group: 'Position', label: 'Position randomization', min: 0, max: 2, softMax: 1, display: 'percent', step: 0.01, tooltip: '0% = regular grid.' }),
    P.vec2('pos_scale', [1, 1], { tab: 'Splats', group: 'Position', label: 'H/V randomization scale', min: 0, max: 2, step: 0.01, labels: ['H', 'V'], linkable: true }),
    P.enum('quincunx', 'none', [{ value: 'none', label: 'Off' }, { value: 'rows', label: 'Offset rows' }, { value: 'columns', label: 'Offset columns' }], { tab: 'Splats', group: 'Position', tooltip: 'Offsets every other row / column by half a cell (bricks). Tiling rounds the grid to an even count on that axis.' }),
    P.float('int_min', 0.5, { tab: 'Splats', group: 'Visibility', label: 'Intensity min', min: -1, max: 4, softMax: 1, display: 'percent', step: 0.01 }),
    P.float('int_max', 1, { tab: 'Splats', group: 'Visibility', label: 'Intensity max', min: -1, max: 4, softMax: 1, display: 'percent', step: 0.01 }),
    P.float('intensity', 1, { tab: 'Splats', group: 'Visibility', min: 0, max: 4, softMax: 1, display: 'percent', step: 0.01, modulatable: true, animatable: true, tooltip: 'Global intensity multiplier (modulated at each splat centre).' }),
    P.float('visibility', 1, { tab: 'Splats', group: 'Visibility', label: 'Visibility', min: 0, max: 1, display: 'percent', step: 0.01, modulatable: true, animatable: true, tooltip: 'Overall chance that a splat is visible. With a modulation texture the intensity acts as a threshold.' }),
    P.float('vis_width', 0, { tab: 'Splats', group: 'Visibility', label: 'Visibility transition width', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Width of the fade between hidden and visible (0% = hard on/off).' }),
  ],
  gizmos,
  cost: { gpu: 'high', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 10 }],
  gallery: [
    { name: 'Stars', params: { shape: 'star', sides: 5, secondary: 0.35, scale: [6, 6], octaves: 2, rot_max: 72, rot_min: -72, octave_mode: 'max' } },
    { name: 'Pebbles', params: { shape: 'polygon', sides: 6, rounding: 0.6, inner: 0.7, scale: [5, 5], scale_min: 0.8, scale_max: 1, octaves: 1, pos_random: 0.3 } },
    { name: 'Bricks', params: { shape: 'pyramid', inner: 0.8, quincunx: 'rows', scale: [4, 8], pos_random: 0, scale_min: 0.9, scale_max: 0.9, octaves: 1, int_min: 1 } },
    { name: 'Sparks', params: { shape: 'cone', scale: [10, 10], octaves: 4, scale_min: 0.2, scale_max: 0.7, visibility: 0.35, octave_mode: 'add', gain: 0.8 } },
    { name: 'Streaks', params: { shape: 'cone', scale: [5, 5], anisotropy: 0.6, octaves: 3, rot_min: -10, rot_max: 10, scale_min: 0.8, scale_max: 1.6 } },
    { name: 'Dots', params: { shape: 'cone', inner: 0.9, scale: [8, 8], pos_random: 0, scale_min: 0.8, scale_max: 0.8, octaves: 1, int_min: 1 } },
  ],
  evaluate(ctx) {
    return fractalPass(ctx, 'gray', SHADER, LAYOUT, {});
  },
});

/**
 * Shared evaluation of the fractal (gray and colour node): same uniforms / texture slots, the colour node adds its
 * own uniform values through `extra` and uses a layout that contains FRACTAL_FIELDS + its extra fields.
 */
export function fractalPass(ctx: EvalContext, pin: 'gray' | 'color', shader: ShaderSource, layout: UniformLayout, extra: Record<string, UniformValue>, defines?: Record<string, number>) {
    const p = ctx.params;
    const v = p.values;
    const out = ctx.tex(pin);
    const pattern = ctx.texInput('pattern');
    const uvIn = ctx.texInput('uv');
    const mods = ['z_position', 'ramp', 'gain', 'uv_amount', 'size', 'intensity', 'visibility', 'atlas_pick'].map((id) => ctx.mod(id));
    const atlas = p.vec2('atlas_size');
    const curve = p.curve('shape_curve');
    const ps = p.vec2('pos_scale');
    const rotMin = p.num('rot_min');
    const rotMax = p.num('rot_max');
    const sMin = Math.min(p.num('scale_min'), p.num('scale_max'));
    const sMax = Math.max(p.num('scale_min'), p.num('scale_max'));
    ctx.pass({
      label: pin === 'gray' ? 'fractal' : 'fractal (color)',
      target: out,
      shader,
      defines,
      uniforms: {
        layout,
        values: {
          ...extra,
          scale: p.vec2('scale'),
          position: p.vec2('position'),
          rotation: p.num('rotation'),
          anisotropy: p.num('anisotropy'),
          seed: p.seed('seed'),
          add_z: p.bool('add_z'),
          z_position: p.num('z_position'),
          z_position_mod_k: mods[0].k,
          z_layers: p.int('z_layers'),
          shape: p.enumIndex('shape'),
          sides: p.int('sides'),
          rounding: p.num('rounding'),
          secondary: p.num('secondary'),
          inner: p.num('inner'),
          atlas_cols: pattern ? Math.max(1, Math.round(atlas[0])) : 1,
          atlas_rows: pattern ? Math.max(1, Math.round(atlas[1])) : 1,
          atlas_pick: p.num('atlas_pick'),
          atlas_pick_mod_k: mods[7].k,
          splat_blend: p.enumIndex('splat_blend'),
          max_smooth: p.num('max_smooth'),
          octaves: p.int('octaves'),
          lacunarity: p.num('lacunarity'),
          octave_mode: p.enumIndex('octave_mode'),
          ramp: p.num('ramp'),
          ramp_mod_k: mods[1].k,
          gain: p.num('gain'),
          gain_mod_k: mods[2].k,
          has_pattern: pattern ? 1 : 0,
          has_uv: uvIn ? 1 : 0,
          uv_align: uvIn ? p.enumIndex('uv_align') : 0,
          uv_amount: p.num('uv_amount'),
          uv_amount_mod_k: mods[3].k,
          rot_min: Math.min(rotMin, rotMax),
          rot_max: Math.max(rotMin, rotMax),
          flip_h: p.num('flip_h'),
          flip_v: p.num('flip_v'),
          scale_min: sMin,
          scale_max: sMax,
          hscale_min: Math.min(p.num('hscale_min'), p.num('hscale_max')),
          hscale_max: Math.max(p.num('hscale_min'), p.num('hscale_max')),
          vscale_min: Math.min(p.num('vscale_min'), p.num('vscale_max')),
          vscale_max: Math.max(p.num('vscale_min'), p.num('vscale_max')),
          size: p.num('size'),
          size_mod_k: mods[4].k,
          pos_random: p.num('pos_random'),
          pos_scale: ps,
          quincunx: p.enumIndex('quincunx'),
          int_min: Math.min(p.num('int_min'), p.num('int_max')),
          int_max: Math.max(p.num('int_min'), p.num('int_max')),
          intensity: p.num('intensity'),
          intensity_mod_k: mods[5].k,
          visibility: p.num('visibility'),
          visibility_mod_k: mods[6].k,
          vis_width: p.num('vis_width'),
          reach: computeReach(v, !!uvIn),
          shape_curve_on: isIdentityCurve(curve) ? 0 : 1,
          shape_lut: bakeCurveUniform(curve),
        },
      },
      textures: [...mods.slice(0, 8).map((m) => m.tex?.tex ?? null), pattern?.tex ?? null, uvIn?.tex ?? null],
    });
    return { output: ctx.result(out, pin) };
}

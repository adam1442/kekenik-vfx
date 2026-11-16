import { defineNode } from '../../../engine/graph/node';
import { identityCurve, P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeCurveUniform, LUT_VEC4 } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { gizmos } from './gizmo';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.shape — signed-distance-field primitives. Texture slot: t0 = optional UV map. */
export const SHADER = defineShader('grayscale_shape.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'shape', type: 'u32' },
  { name: 'size', type: 'vec2f' },
  { name: 'position', type: 'vec2f' },
  { name: 'rotation', type: 'f32' },
  { name: 'sides', type: 'i32' },
  { name: 'rounding', type: 'f32' },
  { name: 'pinch', type: 'f32' },
  { name: 'thickness', type: 'f32' },
  { name: 'aperture', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'bevel', type: 'f32' },
  { name: 'output_mode', type: 'u32' },
  { name: 'outline_width', type: 'f32' },
  { name: 'repeat', type: 'vec2f' },
  { name: 'invert', type: 'u32' },
  { name: 'intensity', type: 'f32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_amount', type: 'f32' },
  { name: 'profile_lut', type: 'vec4f', count: LUT_VEC4 },
]);

/** Enum order == `shape_sd` switch in shader.wgsl. NEVER reorder. */
export const SHAPE_TYPES = ['circle', 'ellipse', 'rounded_rect', 'polygon', 'star', 'ring', 'arc', 'pie', 'cross', 'line', 'heart', 'drop', 'bolt', 'crescent'] as const;
const is = (...t: string[]) => (v: Record<string, unknown>): boolean => t.includes(v.shape as string);

export default defineNode({
  id: 'grayscale.shape',
  version: 1,
  category: 'grayscale',
  title: 'Shape',
  description: 'Signed-distance-field shapes: circle, ellipse, rounded rectangle, polygon, star, ring, arc, pie, cross, line, heart, drop, lightning bolt and crescent, with soft edge, bevel profile, outlines and repeat.',
  keywords: ['circle', 'polygon', 'star', 'ring', 'arc', 'cross', 'heart', 'drop', 'bolt', 'lightning', 'crescent', 'sdf', 'mask', 'rectangle', 'capsule'],
  icon: 'shape',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the shape is looked up through it (warp / deform).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.enum(
      'shape',
      'circle',
      [
        { value: 'circle', label: 'Circle', tooltip: 'Radius = smaller half of Size.' },
        { value: 'ellipse', label: 'Ellipse' },
        { value: 'rounded_rect', label: 'Rounded rectangle' },
        { value: 'polygon', label: 'Polygon' },
        { value: 'star', label: 'Star' },
        { value: 'ring', label: 'Ring' },
        { value: 'arc', label: 'Arc' },
        { value: 'pie', label: 'Pie' },
        { value: 'cross', label: 'Cross' },
        { value: 'line', label: 'Line / capsule' },
        { value: 'heart', label: 'Heart' },
        { value: 'drop', label: 'Drop' },
        { value: 'bolt', label: 'Lightning bolt' },
        { value: 'crescent', label: 'Crescent' },
      ],
      { group: 'Shape' },
    ),
    P.vec2('size', [0.5, 0.5], { group: 'Shape', min: 0, max: 4, softMax: 1, step: 0.005, labels: ['W', 'H'], linkable: true, tooltip: 'Width and height as a fraction of the (repeat) cell.' }),
    P.vec2('position', [0.5, 0.5], { group: 'Shape', softMin: -0.5, softMax: 1.5, step: 0.005, labels: ['X', 'Y'], tooltip: 'Shape centre (UV). With Repeat it is the centre of one cell.' }),
    P.float('rotation', 0, { group: 'Shape', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
    P.int('sides', 5, { group: 'Shape', min: 3, max: 32, softMax: 12, visibleIf: is('polygon', 'star') }),
    P.float('rounding', 0, { group: 'Shape', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: is('rounded_rect', 'polygon', 'star', 'cross'), tooltip: 'Corner rounding (0% sharp, 100% fully round).' }),
    P.float('pinch', 0.35, { group: 'Shape', label: 'Star inner size', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: is('star'), tooltip: 'Pinching of the star: 100% = regular polygon, 0% = very thin spikes.' }),
    P.float('thickness', 0.3, { group: 'Shape', min: 0.02, max: 1, display: 'percent', step: 0.01, visibleIf: is('ring', 'arc', 'cross', 'crescent'), tooltip: 'Band / arm / crescent thickness.' }),
    P.float('aperture', 120, { group: 'Shape', min: 1, max: 359, step: 1, display: 'angle', animatable: true, visibleIf: is('arc', 'pie'), tooltip: 'Opening angle of the arc / pie.' }),
    P.vec2('repeat', [1, 1], { group: 'Repeat', min: 1, max: 64, softMax: 16, step: 1, integer: true, labels: ['X', 'Y'], tooltip: 'Whole number of repetitions. Repeats (and tiling) wrap seamlessly.' }),
    P.float('softness', 0, { group: 'Edge', min: 0, max: 1, display: 'percent', step: 0.005, animatable: true, tooltip: 'Edge falloff measured inward from the outline, relative to the shape size. The edge is always anti-aliased.' }),
    P.float('bevel', 0, { group: 'Edge', min: 0, max: 1, display: 'percent', step: 0.005, animatable: true, visibleIf: (v) => v.output_mode === 'fill', tooltip: 'Width of the inner profile ramp (0% = flat fill).' }),
    P.curve('profile', identityCurve(), { group: 'Edge', label: 'Bevel profile', visibleIf: (v) => v.output_mode === 'fill' && (v.bevel as number) > 0, tooltip: 'Curve over the bevel: left = shape edge, right = end of the bevel.' }),
    P.enum(
      'output_mode',
      'fill',
      [
        { value: 'fill', label: 'Fill' },
        { value: 'inner_outline', label: 'Inner outline' },
        { value: 'outer_outline', label: 'Outer outline' },
        { value: 'outline', label: 'Outline (centred)' },
      ],
      { group: 'Outline', label: 'Output' },
    ),
    P.float('outline_width', 0.1, { group: 'Outline', min: 0.001, max: 1, display: 'percent', step: 0.005, animatable: true, visibleIf: (v) => v.output_mode !== 'fill', tooltip: 'Outline width relative to the shape size.' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 4, softMax: 1, step: 0.01, display: 'percent', animatable: true }),
    P.bool('invert', false, { group: 'Output' }),
    P.float('uv_amount', 1, { group: 'UV', label: 'UV amount', min: 0, max: 1, display: 'percent', step: 0.01, showWhenConnected: 'uv' }),
  ],
  gizmos,
  cost: { gpu: 'low', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Star', params: { shape: 'star', sides: 5, pinch: 0.38, softness: 0.05 } },
    { name: 'Bolt', params: { shape: 'bolt', size: [0.35, 0.8], softness: 0.04 } },
    { name: 'Ring glow', params: { shape: 'ring', thickness: 0.25, softness: 0.6, size: [0.7, 0.7] } },
    { name: 'Heart bevel', params: { shape: 'heart', size: [0.7, 0.7], bevel: 0.5 } },
    { name: 'Crescent', params: { shape: 'crescent', size: [0.7, 0.7], thickness: 0.6, rotation: 20 } },
    { name: 'Hex grid', params: { shape: 'polygon', sides: 6, repeat: [4, 4], size: [0.9, 0.9], output_mode: 'outline', outline_width: 0.08 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const uvIn = ctx.texInput('uv');
    const rep = p.vec2('repeat');
    ctx.pass({
      label: 'shape',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          shape: p.enumIndex('shape'),
          size: p.vec2('size'),
          position: p.vec2('position'),
          rotation: p.num('rotation'),
          sides: p.int('sides'),
          rounding: p.num('rounding'),
          pinch: p.num('pinch'),
          thickness: p.num('thickness'),
          aperture: p.num('aperture'),
          softness: p.num('softness'),
          bevel: p.num('bevel'),
          output_mode: p.enumIndex('output_mode'),
          outline_width: p.num('outline_width'),
          repeat: [Math.max(1, Math.round(rep[0])), Math.max(1, Math.round(rep[1]))],
          invert: p.bool('invert'),
          intensity: p.num('intensity'),
          has_uv: uvIn ? 1 : 0,
          uv_amount: p.num('uv_amount'),
          profile_lut: bakeCurveUniform(p.curve('profile')),
        },
      },
      textures: [uvIn?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

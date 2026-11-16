import { defineNode } from '../../../engine/graph/node';
import { identityCurve, P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { bakeCurveUniform, isIdentityCurve, LUT_VEC4 } from '../../../engine/shaders/lut';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { gizmos } from './gizmo';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.gradient — texture slot t0 = optional UV map. */
export const SHADER = defineShader('grayscale_gradient.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'gtype', type: 'u32' },
  { name: 'start', type: 'vec2f' },
  { name: 'end', type: 'vec2f' },
  { name: 'center', type: 'vec2f' },
  { name: 'radius', type: 'f32' },
  { name: 'angle', type: 'f32' },
  { name: 'turns', type: 'f32' },
  { name: 'repeat', type: 'f32' },
  { name: 'offset', type: 'f32' },
  { name: 'wrap_mode', type: 'u32' },
  { name: 'curve_on', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_amount', type: 'f32' },
  { name: 'curve_lut', type: 'vec4f', count: LUT_VEC4 },
]);

/** Enum order == shader.wgsl. NEVER reorder. */
export const GRADIENT_TYPES = ['linear', 'radial', 'angular', 'diamond', 'square', 'reflected', 'spiral'] as const;
const is = (...t: string[]) => (v: Record<string, unknown>): boolean => t.includes(v.gtype as string);

export default defineNode({
  id: 'grayscale.gradient',
  version: 1,
  category: 'grayscale',
  title: 'Gradient',
  description: 'Linear, radial, angular, diamond, square, reflected and spiral gradients with repeat, offset, curve remap and an optional UV input.',
  keywords: ['ramp', 'linear', 'radial', 'angular', 'conic', 'diamond', 'square', 'reflected', 'spiral', 'falloff', 'mask'],
  icon: 'gradient',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the gradient is evaluated through it.' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.enum(
      'gtype',
      'linear',
      GRADIENT_TYPES.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) })),
      { group: 'Gradient', label: 'Type' },
    ),
    P.vec2('start', [0, 0.5], { group: 'Gradient', softMin: -0.5, softMax: 1.5, step: 0.005, labels: ['X', 'Y'], visibleIf: is('linear', 'reflected'), tooltip: 'Where the gradient is 0%.' }),
    P.vec2('end', [1, 0.5], { group: 'Gradient', softMin: -0.5, softMax: 1.5, step: 0.005, labels: ['X', 'Y'], visibleIf: is('linear', 'reflected'), tooltip: 'Where the gradient is 100%.' }),
    P.vec2('center', [0.5, 0.5], { group: 'Gradient', softMin: -0.5, softMax: 1.5, step: 0.005, labels: ['X', 'Y'], visibleIf: is('radial', 'angular', 'diamond', 'square', 'spiral') }),
    P.float('radius', 0.5, { group: 'Gradient', min: 0.001, max: 8, softMax: 1, step: 0.005, visibleIf: is('radial', 'diamond', 'square', 'spiral'), tooltip: 'Distance (as a fraction of the smaller image side) where the gradient reaches 100%.' }),
    P.float('angle', 0, { group: 'Gradient', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, visibleIf: is('angular', 'spiral'), tooltip: 'Start angle of the sweep (clockwise).' }),
    P.float('turns', 3, { group: 'Gradient', min: -32, max: 32, softMin: -8, softMax: 8, step: 0.1, animatable: true, visibleIf: is('spiral'), tooltip: 'Number of spiral turns from the centre to the radius.' }),
    P.float('repeat', 1, { group: 'Repeat', min: 0.01, max: 64, softMax: 8, step: 0.01, animatable: true, tooltip: 'Number of gradient cycles. While tiling, linear gradients snap to whole cycles.' }),
    P.float('offset', 0, { group: 'Repeat', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Shifts the gradient phase (loops every 100% when repeating).' }),
    P.enum('wrap_mode', 'clamp', [{ value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat (sawtooth)' }, { value: 'mirror', label: 'Mirror (triangle)' }], { group: 'Repeat', label: 'Wrap', tooltip: 'What happens beyond 0%..100%. While tiling, linear gradients always wrap.' }),
    P.curve('curve', identityCurve(), { group: 'Remap', label: 'Curve', tooltip: 'Luminance remap of the gradient.' }),
    P.bool('invert', false, { group: 'Remap' }),
    P.float('uv_amount', 1, { group: 'UV', label: 'UV amount', min: 0, max: 1, display: 'percent', step: 0.01, showWhenConnected: 'uv' }),
  ],
  gizmos,
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Radial falloff', params: { gtype: 'radial', radius: 0.5, invert: true } },
    { name: 'Angular sweep', params: { gtype: 'angular', repeat: 1 } },
    { name: 'Diamond', params: { gtype: 'diamond', radius: 0.5, invert: true, wrap_mode: 'mirror', repeat: 2 } },
    { name: 'Spiral', params: { gtype: 'spiral', turns: 2, repeat: 1 } },
    { name: 'Reflected beam', params: { gtype: 'reflected', start: [0.5, 0.5], end: [0.5, 0.9], invert: true } },
    { name: 'Square rings', params: { gtype: 'square', radius: 0.5, wrap_mode: 'mirror', repeat: 4 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const uvIn = ctx.texInput('uv');
    const curve = p.curve('curve');
    ctx.pass({
      label: 'gradient',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          gtype: p.enumIndex('gtype'),
          start: p.vec2('start'),
          end: p.vec2('end'),
          center: p.vec2('center'),
          radius: p.num('radius'),
          angle: p.num('angle'),
          turns: p.num('turns'),
          repeat: p.num('repeat'),
          offset: p.num('offset'),
          wrap_mode: p.enumIndex('wrap_mode'),
          curve_on: isIdentityCurve(curve) ? 0 : 1,
          invert: p.bool('invert'),
          has_uv: uvIn ? 1 : 0,
          uv_amount: p.num('uv_amount'),
          curve_lut: bakeCurveUniform(curve),
        },
      },
      textures: [uvIn?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

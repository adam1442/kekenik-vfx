import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.caustics — see shader.wgsl for the construction (exactly tileable + loopable). */
export const SHADER = defineShader('grayscale_caustics.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'scale', type: 'vec2f' },
  { name: 'offset', type: 'vec2f' },
  { name: 'evolution', type: 'f32' },
  { name: 'distortion', type: 'f32' },
  { name: 'focus', type: 'f32' },
  { name: 'sharpness', type: 'f32' },
  { name: 'brightness', type: 'f32' },
  { name: 'floor_level', type: 'f32' },
  { name: 'iterations', type: 'i32' },
  { name: 'speed', type: 'i32' },
  { name: 'invert', type: 'u32' },
]);
/** Gizmo: position <- offset (origin at uv 0.5 - offset, same convention as Noise), scale <- scale (cells across). */
export const gizmos: GizmoDecl[] = [
  {
    id: 'pattern',
    label: 'Caustics transform',
    type: 'transform',
    viewport: '2d',
    space: 'uv',
    position: { param: 'offset', map: { scale: -1, offset: 0.5 } },
    scale: { param: 'scale', map: { reciprocal: true } },
    tilingSafe: true,
  },
];

export default defineNode({
  id: 'grayscale.caustics',
  version: 1,
  category: 'grayscale',
  title: 'Caustics',
  description: 'Animated water caustic light patterns. Tileable (whole-number scale) and perfectly loopable: Evolution 0% == 100%, animate it from 0 to 100% for a seamless loop.',
  keywords: ['water', 'caustic', 'pool', 'light', 'refraction', 'ripple', 'animated', 'loop'],
  icon: 'noise',
  inputs: [],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.vec2('scale', [3, 3], { group: 'Pattern', min: 1, max: 64, softMax: 12, step: 1, labels: ['X', 'Y'], linkable: true, tooltip: 'Repeats across the image. Whole numbers while tiling.' }),
    P.vec2('offset', [0, 0], { group: 'Pattern', softMin: -1, softMax: 1, step: 0.01, labels: ['X', 'Y'] }),
    P.float('evolution', 0, { group: 'Animation', min: -64, max: 64, softMin: 0, softMax: 1, step: 0.005, display: 'percent', animatable: true, tooltip: '100% = exactly one seamless loop.' }),
    P.int('speed', 1, { group: 'Animation', min: 1, max: 8, tooltip: 'Whole loops per 100% Evolution (keeps the loop seamless).' }),
    P.int('iterations', 5, { group: 'Pattern', min: 2, max: 8, tooltip: 'More iterations = more intricate light network.' }),
    P.float('distortion', 1, { group: 'Pattern', min: 0, max: 3, softMax: 2, step: 0.01, animatable: true, tooltip: 'Strength of the warp between iterations.' }),
    P.float('focus', 0.8, { group: 'Look', min: 0.1, max: 3, step: 0.01, tooltip: 'Weight of each iteration in the light network.' }),
    P.float('sharpness', 6, { group: 'Look', min: 1, max: 40, softMax: 20, step: 0.1, tooltip: 'Exponent: higher = thinner, sharper caustic lines.' }),
    P.float('brightness', 1, { group: 'Look', min: 0, max: 8, softMax: 3, step: 0.01, animatable: true }),
    P.float('floor_level', 0.2, { group: 'Look', label: 'Black point', min: 0, max: 0.95, step: 0.005, display: 'percent', tooltip: 'Values below this become black.' }),
    P.bool('invert', false, { group: 'Look' }),
  ],
  gizmos,
  cost: { gpu: 'low', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 0 }],
  gallery: [
    { name: 'Fine', params: { scale: [6, 6], iterations: 6, sharpness: 12 } },
    { name: 'Soft', params: { sharpness: 4, floor_level: 0.1, distortion: 0.7 } },
    { name: 'Frame 50%', params: { evolution: 0.5 } },
    { name: 'Wide stretch', params: { scale: [2, 6], iterations: 4 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({
      label: 'caustics',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          scale: p.vec2('scale'),
          offset: p.vec2('offset'),
          evolution: p.num('evolution'),
          distortion: p.num('distortion'),
          focus: p.num('focus'),
          sharpness: p.num('sharpness'),
          brightness: p.num('brightness'),
          floor_level: p.num('floor_level'),
          iterations: p.int('iterations'),
          speed: p.int('speed'),
          invert: p.bool('invert'),
        },
      },
      textures: [],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

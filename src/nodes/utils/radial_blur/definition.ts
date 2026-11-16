import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.radial_blur: zoom / spin blur around a centre with a sharp inner zone, falloff weights and a
 * per-pixel modulatable amount. Gray + Color variants. Gizmo: the centre point.
 */
export const SHADER = defineShader('utils_radial_blur.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'amount', type: 'f32' },
  { name: 'amount_mod_k', type: 'f32' },
  { name: 'angle', type: 'f32' },
  { name: 'inner', type: 'f32' },
  { name: 'inner_soft', type: 'f32' },
  { name: 'samples', type: 'i32' },
  { name: 'mode', type: 'u32' },
  { name: 'falloff', type: 'u32' },
  { name: 'jitter', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.radial_blur', k),
    version: 1,
    category: 'utils',
    title: titleOf('Radial Blur', k),
    description: 'Zoom and / or spin blur around a centre. Streaks for flares, shockwaves, speed lines and light shafts.',
    keywords: ['radial', 'zoom', 'spin', 'rotational', 'streak', 'speed lines', 'god rays', 'flare', 'shockwave'],
    icon: 'blur',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.enum('mode', 'zoom', [{ value: 'zoom', label: 'Zoom' }, { value: 'spin', label: 'Spin' }, { value: 'both', label: 'Zoom + Spin' }], { group: 'Blur' }),
      P.vec2('center', [0.5, 0.5], { group: 'Blur', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
      P.float('amount', 0.25, { group: 'Blur', min: -1, max: 1, softMin: 0, softMax: 0.8, step: 0.005, display: 'percent', animatable: true, modulatable: true, tooltip: 'Zoom length: 100% pulls the outer taps all the way to the centre.' }),
      P.float('angle', 20, { group: 'Blur', min: -360, max: 360, softMin: -90, softMax: 90, step: 0.5, display: 'angle', animatable: true, tooltip: 'Total spin angle of the blur.' }),
      P.float('inner', 0, { group: 'Blur', label: 'Sharp radius', min: 0, max: 2, softMax: 0.5, step: 0.005, display: 'percent', animatable: true, tooltip: 'Pixels closer than this to the centre stay sharp.' }),
      P.float('inner_soft', 0.1, { group: 'Blur', label: 'Sharp transition', min: 0, max: 2, softMax: 0.5, step: 0.005, display: 'percent' }),
      P.enum('falloff', 'box', [{ value: 'box', label: 'Box' }, { value: 'trail', label: 'Trail (linear)' }, { value: 'gaussian', label: 'Gaussian' }], { group: 'Shape' }),
      P.int('samples', 32, { group: 'Quality', min: 2, max: 128, softMax: 64 }),
      P.bool('jitter', true, { group: 'Quality', tooltip: 'Per-pixel offset of the taps; trades banding for fine noise.' }),
    ],
    gizmos: [{ id: 'center', label: 'Blur centre', type: 'point', viewport: '2d', space: 'uv', param: 'center' }],
    cost: { gpu: 'medium', tiling: 'global', temporaries: 0 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
    gallery: [
      { name: 'Light shafts', params: { amount: 0.6, falloff: 'trail', inner: 0.05 } },
      { name: 'Spin streaks', params: { mode: 'spin', angle: 40 } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Radial Blur needs an input');
      const p = ctx.params;
      const ma = ctx.mod('amount');
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'radial blur',
        target: out,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: {
            center: p.vec2('center'),
            amount: p.num('amount'),
            amount_mod_k: ma.k,
            angle: p.num('angle'),
            inner: p.num('inner'),
            inner_soft: p.num('inner_soft'),
            samples: p.int('samples'),
            mode: p.enumIndex('mode'),
            falloff: p.enumIndex('falloff'),
            jitter: p.bool('jitter'),
          },
        },
        textures: [src.tex, ma.tex?.tex ?? null],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);

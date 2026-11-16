import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** utils.chromatic_aberration: spectral dispersion / colour fringing (radial or directional) with per-pixel amount. Color only. */
export const SHADER = defineShader('utils_chromatic_aberration.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'amount', type: 'f32' },
  { name: 'amount_mod_k', type: 'f32' },
  { name: 'angle', type: 'f32' },
  { name: 'falloff', type: 'f32' },
  { name: 'samples', type: 'i32' },
  { name: 'mode', type: 'u32' },
]);

export default defineNode({
  id: 'utils.chromatic_aberration',
  version: 1,
  category: 'utils',
  title: 'Chromatic Aberration',
  description: 'Spectral colour fringing: the image is integrated over a rainbow of offsets. Radial (lens, grows outward) or directional.',
  keywords: ['chromatic', 'aberration', 'dispersion', 'rainbow', 'fringe', 'prism', 'lens', 'rgb split', 'spectral'],
  icon: 'blur',
  common: { texture: true, blending: true },
  inputs: [{ id: 'input', name: 'Input', type: 'color' }],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  params: [
    P.enum('mode', 'radial', [{ value: 'radial', label: 'Radial (lens)' }, { value: 'directional', label: 'Directional' }], { group: 'Dispersion' }),
    P.float('amount', 0.04, { group: 'Dispersion', min: -1, max: 1, softMin: -0.2, softMax: 0.2, step: 0.001, display: 'percent', animatable: true, modulatable: true, tooltip: 'Total spread of the spectrum (UV fraction at the image edge for radial mode).' }),
    P.vec2('center', [0.5, 0.5], { group: 'Dispersion', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.float('angle', 0, { group: 'Dispersion', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true, tooltip: 'Direction of the split (directional mode).' }),
    P.float('falloff', 1.5, { group: 'Dispersion', min: 0, max: 6, softMax: 3, step: 0.05, tooltip: 'Radial mode: how quickly the fringing grows with the distance from the centre.' }),
    P.int('samples', 12, { group: 'Quality', min: 3, max: 32, tooltip: 'Spectral taps: more = smoother rainbow.' }),
  ],
  gizmos: [{ id: 'center', label: 'Lens centre', type: 'point', viewport: '2d', space: 'uv', param: 'center' }],
  cost: { gpu: 'medium', tiling: 'global', temporaries: 0 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Lens fringe', params: { amount: 0.05 } },
    { name: 'Prism split', params: { mode: 'directional', amount: 0.03, angle: 30 } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Chromatic Aberration needs an input');
    const p = ctx.params;
    const ma = ctx.mod('amount');
    const out = ctx.tex('color');
    ctx.pass({
      label: 'chromatic aberration',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          center: p.vec2('center'),
          amount: p.num('amount'),
          amount_mod_k: ma.k,
          angle: p.num('angle'),
          falloff: p.num('falloff'),
          samples: p.int('samples'),
          mode: p.enumIndex('mode'),
        },
      },
      textures: [src.tex, ma.tex?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});

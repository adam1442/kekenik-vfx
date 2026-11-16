import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, kindDefines, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/** utils.fxaa / utils.fxaa_color — post-process anti-aliasing (single pass, 9 taps). */
export const SHADER = defineShader('utils_fxaa.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'threshold', type: 'f32' },
  { name: 'min_threshold', type: 'f32' },
  { name: 'span', type: 'f32' },
  { name: 'reduce_mul', type: 'f32' },
  { name: 'strength', type: 'f32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.fxaa', k),
    version: 1,
    category: 'utils',
    title: titleOf('FXAA', k),
    description: 'Fast approximate anti-aliasing of hard edges (luma based).',
    keywords: ['antialias', 'aa', 'smooth edges', 'jaggies'],
    icon: 'filter',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('threshold', 0.125, { group: 'FXAA', min: 0, max: 1, step: 0.005, tooltip: 'Relative contrast needed to smooth an edge.' }),
      P.float('min_threshold', 0.03, { group: 'FXAA', min: 0, max: 1, step: 0.002, tooltip: 'Absolute contrast floor (skips dark noise).' }),
      P.float('span', 8, { group: 'FXAA', min: 1, max: 16, step: 0.5, tooltip: 'Maximum search distance in pixels.' }),
      P.float('reduce_mul', 0.125, { group: 'FXAA', min: 0.01, max: 1, step: 0.005, advanced: true }),
      P.float('strength', 1, { group: 'FXAA', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true }),
    ],
    cost: { gpu: 'low', tiling: 'halo', halo: () => 10 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1, defines: kindDefines(k) }],
    gallery: [{ name: 'Strong', params: { threshold: 0.03, min_threshold: 0.005, span: 16 } }],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('FXAA needs an input');
      const p = ctx.params;
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'fxaa',
        target: out,
        shader: SHADER,
        defines: kindDefines(k),
        uniforms: { layout: LAYOUT, values: { threshold: p.num('threshold'), min_threshold: p.num('min_threshold'), span: p.num('span'), reduce_mul: p.num('reduce_mul'), strength: p.num('strength') } },
        textures: [src.tex],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);

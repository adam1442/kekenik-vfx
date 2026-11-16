import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { copyTex } from '../../_shared/blur2';
import { idOf, kindDefines, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.denoise — edge-preserving denoise (non-local means). Cost per pixel: (2R+1)^2 candidates x 5 / 9 patch taps x 2.
 * Default R = 3: 49 x 5 x 2 ~ 490 loads, estimated ~ 6 ms at 2048^2; R = 6 is ~ 4x that. Iterations repeat the pass.
 */
export const SHADER = defineShader('utils_denoise.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'search', type: 'i32' },
  { name: 'patch_kind', type: 'u32' },
  { name: 'strength', type: 'f32' },
  { name: 'sigma', type: 'f32' },
  { name: 'amount', type: 'f32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.denoise', k),
    version: 1,
    category: 'utils',
    title: titleOf('Denoise', k),
    description: 'Non-local-means denoise: removes noise, keeps edges and structure.',
    keywords: ['denoise', 'noise removal', 'nlm', 'non local means', 'clean'],
    icon: 'filter',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('strength', 0.1, { group: 'Denoise', label: 'Filter strength', min: 0.001, max: 2, softMax: 0.5, step: 0.005, animatable: true, tooltip: 'Patch difference tolerance (h).' }),
      P.float('sigma', 0.02, { group: 'Denoise', label: 'Noise level', min: 0, max: 1, softMax: 0.2, step: 0.002, animatable: true, tooltip: 'Expected noise standard deviation (differences below it count as equal).' }),
      P.int('search', 3, { group: 'Denoise', label: 'Search radius', min: 1, max: 8, softMax: 6, tooltip: 'Search window radius in pixels (cost grows with its square).' }),
      P.enum('patch', 'cross', [{ value: 'cross', label: 'Cross (5 taps)' }, { value: 'square', label: 'Square (9 taps)' }], { group: 'Denoise' }),
      P.int('iterations', 1, { group: 'Denoise', min: 1, max: 4 }),
      P.float('amount', 1, { group: 'Denoise', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true, tooltip: 'Mix with the original (keeps detail).' }),
    ],
    cost: { gpu: 'high', tiling: 'halo', halo: (v) => ((v.search as number) + 1) * (v.iterations as number), temporaries: 2 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1, defines: kindDefines(k) }],
    gallery: [{ name: 'Strong', params: { strength: 0.3, search: 4, iterations: 2 } }, { name: 'Square patch', params: { patch: 'square' } }],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Denoise needs an input');
      const p = ctx.params;
      const pin = pinOf(k);
      let cur = src.tex;
      for (let i = 0; i < p.int('iterations'); i++) {
        const t = ctx.tex(pin);
        ctx.pass({
          label: 'denoise nlm',
          target: t,
          shader: SHADER,
          defines: kindDefines(k),
          uniforms: { layout: LAYOUT, values: { search: p.int('search'), patch_kind: p.enumIndex('patch'), strength: p.num('strength'), sigma: p.num('sigma'), amount: p.num('amount') } },
          textures: [cur],
          ss: 1,
        });
        if (cur !== src.tex) ctx.free(cur);
        cur = t;
      }
      return { output: ctx.result(cur === src.tex ? copyTex(ctx, src.tex, pin) : cur, pin) };
    },
  }),
);

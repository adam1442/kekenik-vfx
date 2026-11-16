import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { copyTex } from '../../_shared/blur2';
import { idOf, kindDefines, pinOf, RADIUS_TIP, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.bilateral — edge-preserving blur. Cost per pixel: (2T+1)^2 taps (exact 2D, T <= 12 -> up to 625) or 2 x (2T+1)
 * (separable approximation). Radii above 12 px use a tap stride (documented). Estimated 2048^2: exact T=4 ~ 2 ms,
 * T=12 ~ 12 ms; separable T=12 ~ 1 ms.
 */
export const SHADER = defineShader('utils_bilateral.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'taps', type: 'i32' },
  { name: 'stride', type: 'i32' },
  { name: 'sigma_s', type: 'f32' },
  { name: 'sigma_r', type: 'f32' },
  { name: 'dir_x', type: 'i32' },
  { name: 'dir_y', type: 'i32' },
  { name: 'mode', type: 'u32' },
]);
export const MAX_TAPS = 12;
/** taps / stride / spatial sigma (px) for a radius in pixels (pure, tested). */
export function bilateralPlan(radiusPx: number): { taps: number; stride: number; sigma: number } {
  const r = Math.max(radiusPx, 0);
  const stride = Math.max(1, Math.ceil(r / MAX_TAPS));
  return { taps: Math.max(1, Math.min(MAX_TAPS, Math.round(r / stride))), stride, sigma: Math.max(r / 2, 0.3) };
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.bilateral', k),
    version: 1,
    category: 'utils',
    title: titleOf('Bilateral Filter', k),
    description: 'Edge-preserving smoothing: blurs flat areas, keeps strong edges.',
    keywords: ['bilateral', 'edge preserving', 'smooth', 'denoise', 'cartoon'],
    icon: 'filter',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('radius', 0.006, { group: 'Filter', min: 0, max: 0.2, softMax: 0.03, step: 0.0005, display: 'percent', animatable: true, tooltip: RADIUS_TIP }),
      P.float('range', 0.15, { group: 'Filter', label: 'Edge range', min: 0.001, max: 4, softMax: 1, step: 0.005, animatable: true, tooltip: 'Value difference above which neighbours are ignored (smaller = more edges kept).' }),
      P.int('iterations', 1, { group: 'Filter', min: 1, max: 6, softMax: 4 }),
      P.enum('quality', 'exact', [{ value: 'exact', label: 'Exact (2D)' }, { value: 'separable', label: 'Separable (fast)' }], { group: 'Filter' }),
    ],
    gizmos: [{ id: 'radius', label: 'Filter radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
    cost: { gpu: 'high', tiling: 'halo', halo: (v) => Math.ceil((v.radius as number) * 8192 * (v.iterations as number)) + 2, temporaries: 2 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1, defines: kindDefines(k) }],
    gallery: [
      { name: 'Strong', params: { radius: 0.015, range: 0.3, iterations: 2 } },
      { name: 'Separable large', params: { radius: 0.03, quality: 'separable' } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Bilateral Filter needs an input');
      const p = ctx.params;
      const pin = pinOf(k);
      const plan = bilateralPlan(p.num('radius') * Math.min(ctx.frame.width, ctx.frame.height));
      const sep = p.str('quality') === 'separable';
      let cur = src.tex;
      const run = (dx: number, dy: number): void => {
        const t = ctx.tex(pin);
        ctx.pass({
          label: 'bilateral',
          target: t,
          shader: SHADER,
          defines: kindDefines(k),
          uniforms: { layout: LAYOUT, values: { taps: plan.taps, stride: plan.stride, sigma_s: plan.sigma, sigma_r: p.num('range'), dir_x: dx, dir_y: dy, mode: sep ? 1 : 0 } },
          textures: [cur],
          ss: 1,
        });
        if (cur !== src.tex) ctx.free(cur);
        cur = t;
      };
      for (let i = 0; i < p.int('iterations'); i++) {
        if (sep) {
          run(1, 0);
          run(0, 1);
        } else run(0, 0);
      }
      return { output: ctx.result(cur === src.tex ? copyTex(ctx, src.tex, pin) : cur, pin) };
    },
  }),
);

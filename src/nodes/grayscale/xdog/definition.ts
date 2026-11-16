import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { BLUR_DECL, gaussianBlur } from '../../_shared/blur';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.xdog — extended difference of gaussians (Winnemoeller 2012): ink / hatch / toon outlines. */
export const SHADER = defineShader('grayscale_xdog.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'sharp', type: 'f32' },
  { name: 'epsilon', type: 'f32' },
  { name: 'phi', type: 'f32' },
  { name: 'hard', type: 'u32' },
  { name: 'invert', type: 'u32' },
]);
export const gizmos: GizmoDecl[] = [{ id: 'radius', label: 'XDoG radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }];

/** CPU reference of the per-pixel combine step (for tests). */
export function xdogReference(g1: number, g2: number, o: { sharp: number; epsilon: number; phi: number; hard: boolean }): number {
  const s = (1 + o.sharp) * g1 - o.sharp * g2;
  if (s >= o.epsilon) return 1;
  return o.hard ? 0 : Math.min(Math.max(1 + Math.tanh(o.phi * (s - o.epsilon)), 0), 1);
}

export default defineNode({
  id: 'grayscale.xdog',
  version: 1,
  category: 'grayscale',
  title: 'XDoG',
  description: 'Extended difference of gaussians: turns any Gray image into ink lines, hatching or a toon threshold. Radius = detail size, Sharpness / Epsilon / Phi shape the result.',
  keywords: ['ink', 'hatch', 'toon', 'outline', 'difference of gaussians', 'dog', 'sketch', 'stylize'],
  icon: 'edge',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.float('radius', 0.004, { group: 'XDoG', min: 0.0005, max: 0.1, softMax: 0.02, step: 0.0005, display: 'percent', animatable: true, tooltip: 'Detail size (smaller gaussian sigma = radius / 2).' }),
    P.float('k', 1.6, { group: 'XDoG', label: 'Scale ratio (k)', min: 1.05, max: 8, softMax: 3, step: 0.01, tooltip: 'Ratio between the two gaussians.' }),
    P.float('sharpness', 20, { group: 'XDoG', min: 0, max: 200, softMax: 60, step: 0.1, animatable: true, tooltip: 'p: boosts the difference of gaussians.' }),
    P.float('epsilon', 0.5, { group: 'XDoG', min: -2, max: 2, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Threshold: values above stay white.' }),
    P.float('phi', 10, { group: 'XDoG', min: 0.1, max: 500, softMax: 100, step: 0.1, visibleIf: (v) => v.hard !== true, tooltip: 'Softness of the tanh ramp below the threshold (higher = harder).' }),
    P.bool('hard', false, { group: 'XDoG', label: 'Hard threshold' }),
    P.bool('invert', false, { group: 'XDoG' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'halo', halo: (v) => Math.ceil((v.radius as number) * 8192 * (v.k as number) * 2) + 2, temporaries: 3 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }, BLUR_DECL],
  gallery: [
    { name: 'Hard ink', params: { hard: true, epsilon: 0.45 } },
    { name: 'Bold outlines', params: { radius: 0.008, sharpness: 40, epsilon: 0.7 } },
    { name: 'Fine hatching', params: { radius: 0.002, k: 2.2, epsilon: 0.3, phi: 40 } },
    { name: 'Inverted', params: { invert: true } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('XDoG needs an input');
    const p = ctx.params;
    const sigma = Math.max((p.num('radius') * Math.min(ctx.frame.width, ctx.frame.height)) / 2, 0.3);
    const g1 = gaussianBlur(ctx, src.tex, 'gray', sigma);
    const g2 = gaussianBlur(ctx, src.tex, 'gray', sigma * p.num('k'));
    const out = ctx.tex('gray');
    ctx.pass({
      label: 'xdog',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { sharp: p.num('sharpness'), epsilon: p.num('epsilon'), phi: p.num('phi'), hard: p.bool('hard'), invert: p.bool('invert') } },
      textures: [g1, g2],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});

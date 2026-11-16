import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.threshold — t0 input, t1 threshold modulation. */
export const SHADER = defineShader('grayscale_threshold.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'threshold', type: 'f32' },
  { name: 'threshold_mod_k', type: 'f32' },
  { name: 'smoothness', type: 'f32' },
  { name: 'soft', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'low', type: 'f32' },
  { name: 'high', type: 'f32' },
]);

/** CPU reference (identical math) for tests. */
export function thresholdReference(v: number, thr: number, smooth: number, soft: boolean): number {
  if (soft && smooth > 1e-5) {
    const t = Math.min(Math.max((v - (thr - smooth)) / (2 * smooth), 0), 1);
    return t * t * (3 - 2 * t);
  }
  return v >= thr ? 1 : 0;
}

/** fusable per-pixel declaration (see FusableDecl). */
export const FUSE: FusableDecl = {
  source: SHADER,
  uniforms: LAYOUT,
  extras: ['threshold_mod'],
  uniformValues: (p, io) => ({ threshold: p.num('threshold'), threshold_mod_k: io.modK('threshold'), smoothness: p.num('smoothness'), soft: p.enumIndex('type'), invert: p.bool('invert'), low: p.num('low'), high: p.num('high') }),
};

export default defineNode({
  id: 'grayscale.threshold',
  version: 1,
  category: 'grayscale',
  title: 'Threshold',
  description: 'Hard or soft threshold of a Gray input. The threshold can be modulated per pixel by a Gray texture.',
  keywords: ['binary', 'cutoff', 'mask', 'step', 'smoothstep', 'clip'],
  icon: 'threshold',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.enum('type', 'hard', [{ value: 'hard', label: 'Hard' }, { value: 'soft', label: 'Soft' }], { group: 'Threshold', label: 'Type' }),
    P.float('threshold', 0.5, { group: 'Threshold', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true, modulatable: true, tooltip: 'Values at or above the threshold become the high level.' }),
    P.float('smoothness', 0.1, { group: 'Threshold', min: 0, max: 8, softMax: 0.5, step: 0.005, animatable: true, visibleIf: (v) => v.type === 'soft', tooltip: 'Half width of the soft transition around the threshold.' }),
    P.bool('invert', false, { group: 'Output' }),
    P.float('low', 0, { group: 'Output', label: 'Low level', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.01 }),
    P.float('high', 1, { group: 'Output', label: 'High level', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.01 }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Soft', params: { type: 'soft', smoothness: 0.15 } },
    { name: 'Hard 30%', params: { threshold: 0.3 } },
    { name: 'Inverted soft', params: { type: 'soft', smoothness: 0.05, invert: true, threshold: 0.6 } },
  ],
  fusable: FUSE,
  evaluate: (ctx) => runFusable(ctx, FUSE, 'gray', 'threshold'),
});

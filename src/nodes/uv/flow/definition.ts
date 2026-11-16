import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { modOf, uvInParam, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_flow.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'strength', type: 'f32' },
  { name: 'strength_mod_k', type: 'f32' },
  { name: 'phase', type: 'f32' },
  { name: 'noise_amount', type: 'f32' },
  { name: 'noise_cells', type: 'i32' },
  { name: 'cycles', type: 'i32' },
  { name: 'seed', type: 'u32' },
  { name: 'use_loop', type: 'u32' },
  { name: 'smooth_w', type: 'u32' },
  { name: 'has_flow', type: 'u32' },
  { name: 'has_src', type: 'u32' },
  { name: 'which', type: 'u32' },
  { name: 'uv_in', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);

/** Two-phase weight of phase A (pure mirror of the shader, tested): triangle wave, 0 exactly at the reset of A. */
export function flowPhases(t: number, smooth: boolean): { pa: number; pb: number; wa: number } {
  const fr = (x: number): number => x - Math.floor(x);
  const pa = fr(t);
  const pb = fr(t + 0.5);
  let wa = 1 - Math.abs(2 * pa - 1);
  if (smooth) wa = wa * wa * (3 - 2 * wa);
  return { pa, pb, wa };
}

/** uv.flow — flowmap generator with looping two-phase blending. Outputs two phase UV fields + weight + the advected result. */
export default defineNode({
  id: 'uv.flow',
  version: 1,
  category: 'uv',
  title: 'UV Flow',
  description: 'Flowmap advection with looping two-phase blending: outputs UV A, UV B and the blend weight (the exact setup engines use for flowmaps) plus the advected result of an optional source image. Loops seamlessly with the graph.',
  keywords: ['flow', 'flowmap', 'advect', 'two phase', 'loop', 'water', 'lava', 'distortion', 'uv'],
  icon: 'warp',
  inputs: [
    { id: 'flow', name: 'Flow', type: 'uv', optional: true, tooltip: 'Vector field (lookup delta; content moves along -delta). Chain UV Directional / Noise / Spline / From Grayscale.' },
    { id: 'source', name: 'Source', type: 'color', optional: true, tooltip: 'Optional image advected into the Result output.' },
  ],
  outputs: [
    { id: 'uv_a', name: 'UV A', type: 'uv' },
    { id: 'uv_b', name: 'UV B', type: 'uv' },
    { id: 'weight', name: 'Weight A', type: 'gray', tooltip: 'Blend weight of phase A (phase B = 1 - weight).' },
    { id: 'result', name: 'Result', type: 'color', tooltip: 'mix(source(UV B), source(UV A), weight).' },
  ],
  params: [
    uvInParam('uv_in', 'Flow field input'),
    P.float('strength', 0.1, { group: 'Flow', min: 0, max: 4, softMax: 0.5, step: 0.001, display: 'percent', modulatable: true, animatable: true, tooltip: 'Travel distance of one phase cycle (tile space, scales the flow vectors).' }),
    P.bool('use_loop', true, { group: 'Time', label: 'Follow graph loop', tooltip: 'Phase = graph loop phase x cycles + Phase offset.' }),
    P.float('phase', 0, { group: 'Time', label: 'Phase offset', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: 'With "Follow graph loop" off, animate this 0 -> N for N seamless cycles.' }),
    P.int('cycles', 1, { group: 'Time', min: 1, max: 16, visibleIf: (v) => v.use_loop === true, tooltip: 'Whole number of flow cycles per graph loop (keeps the loop seamless).' }),
    P.bool('smooth_weight', true, { group: 'Time', label: 'Smooth blend' }),
    P.float('phase_noise', 0.25, { group: 'Time', label: 'Phase randomness', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Per-pixel phase offset (tileable noise) that hides the pulsing of a global phase.' }),
    P.int('noise_cells', 4, { group: 'Time', label: 'Randomness cells', min: 1, max: 64, visibleIf: (v) => (v.phase_noise as number) > 0 }),
    P.seed('seed', 0, { group: 'Time' }),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  timeDependent: (v) => v.use_loop === true,
  cost: { gpu: 'low', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [{ name: 'Fast, no randomness', params: { cycles: 2, phase_noise: 0 } }, { name: 'Manual phase', params: { use_loop: false, phase: 0.3 } }],
  evaluate(ctx) {
    const p = ctx.params;
    const flow = ctx.texInput('flow');
    const src = ctx.texInput('source');
    const m = modOf(ctx, 'strength');
    const base = { strength: p.num('strength'), strength_mod_k: m.k, phase: p.num('phase'), noise_amount: p.num('phase_noise'), noise_cells: p.int('noise_cells'), cycles: p.int('cycles'), seed: p.seed('seed') >>> 0, use_loop: p.bool('use_loop'), smooth_w: p.bool('smooth_weight'), has_flow: !!flow, has_src: !!src, uv_in: uvModeIndex(p.str('uv_in')), uv_mode: uvModeIndex(p.str('uv_out')) };
    const run = (which: number, pin: 'uv' | 'gray' | 'color', label: string) => {
      const t = ctx.tex(pin);
      ctx.pass({ label: `flow ${label}`, target: t, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...base, which } }, textures: [flow?.tex ?? null, src?.tex ?? null, m.tex], ss: 1 });
      return ctx.result(t, pin);
    };
    return { uv_a: run(0, 'uv', 'uv a'), uv_b: run(1, 'uv', 'uv b'), weight: run(2, 'gray', 'weight'), result: run(3, 'color', 'result') };
  },
});

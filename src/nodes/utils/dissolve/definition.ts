import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.dissolve: "Dissolve / Erode over time" with burn edge. The dissolve ORDER field v = mix(Input, Noise, amount)
 * (Input = gradient / shape / distance, Noise = any gray noise); a front f sweeps over v as `progress` goes 0 -> 1:
 *   f = progress * (1 + soft + edge) - (soft + edge)          (so progress 0 shows everything, 1 shows nothing, edge is 0 at both ends)
 *   mask = smoothstep(f, f + soft, v)                         visible part
 *   edge = mask * (1 - smoothstep(f + edge, f + edge + soft, v))   burn band just inside the front
 *   heat = 1 - saturate((v - f) / (edge + soft))              1 at the front, 0 deep inside = "age since burning" for colour ramps
 * Outputs: Mask, Edge, Heat (all Gray). Parameters: progress (animate it, per-pixel modulation pin), softness, edge width,
 * noise amount / contrast, reverse (grow instead of dissolve). Per-pixel and tiling-safe; loops exactly when `progress` keys loop.
 */
export const SHADER = defineShader('utils_dissolve.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'progress', type: 'f32' },
  { name: 'progress_mod_k', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'edge_width', type: 'f32' },
  { name: 'noise_amount', type: 'f32' },
  { name: 'noise_contrast', type: 'f32' },
  { name: 'reverse', type: 'u32' },
  { name: 'has_noise', type: 'u32' },
  { name: 'which', type: 'u32' },
]);

/** CPU reference of the three outputs (vitest + GPU known-answer self-test). `v` = dissolve order value in 0..1. */
export function dissolveRef(v: number, progress: number, soft: number, edge: number): { mask: number; edge: number; heat: number } {
  const s = Math.max(soft, 1e-4);
  const f = progress * (1 + s + edge) - (s + edge);
  const ss = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const mask = ss(f, f + s, v);
  return { mask, edge: mask * (1 - ss(f + edge, f + edge + s, v)), heat: 1 - Math.min(1, Math.max(0, (v - f) / Math.max(edge + s, 1e-4))) };
}

export default defineNode({
  id: 'utils.dissolve',
  version: 1,
  category: 'utils',
  title: 'Dissolve Over Time',
  description: 'Animated threshold dissolve / erode with a burn edge. Input (gradient, shape or distance) + optional Noise give the dissolve order; animate Progress 0 to 100% for Mask, Edge-glow and Heat (age at the front) outputs.',
  keywords: ['dissolve', 'erode', 'burn', 'threshold', 'edge', 'reveal', 'wipe', 'disappear', 'appear', 'teleport', 'fade', 'over time'],
  icon: 'threshold',
  inputs: [
    { id: 'input', name: 'Input', type: 'gray', tooltip: 'Dissolve order: dark areas dissolve first. A gradient gives a wipe, a shape a radial erode.' },
    { id: 'noise', name: 'Noise', type: 'gray', optional: true, tooltip: 'Optional noise mixed into the order (breaks up the front).' },
  ],
  outputs: [
    { id: 'mask', name: 'Mask', type: 'gray', tooltip: 'Remaining (visible) part.' },
    { id: 'edge', name: 'Edge', type: 'gray', tooltip: 'Burn band just inside the dissolve front.' },
    { id: 'heat', name: 'Heat', type: 'gray', tooltip: '1 at the front fading to 0 inside: feed it to a Ramp / Blackbody for burn colours.' },
  ],
  common: { texture: true, blending: false },
  params: [
    P.float('progress', 0, { group: 'Dissolve', min: 0, max: 1, step: 0.005, display: 'percent', animatable: true, modulatable: true, tooltip: 'Animate 0 -> 100%: 0 shows everything, 100% nothing (Reverse: the opposite).' }),
    P.float('softness', 0.08, { group: 'Dissolve', min: 0.001, max: 1, softMax: 0.5, step: 0.005, display: 'percent', animatable: true, tooltip: 'Width of the soft transition at the front.' }),
    P.float('edge_width', 0.12, { group: 'Edge', min: 0, max: 1, softMax: 0.5, step: 0.005, display: 'percent', animatable: true, tooltip: 'Width of the burn band.' }),
    P.float('noise_amount', 0.5, { group: 'Order', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'How much the Noise input breaks up the order (needs the Noise pin).' }),
    P.float('noise_contrast', 1, { group: 'Order', min: 0.1, max: 4, softMax: 2, step: 0.01, tooltip: 'Power applied to the noise before mixing.' }),
    P.bool('reverse', false, { group: 'Dissolve', tooltip: 'Grow instead of dissolve (appear effect).' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [{ name: 'Half way', params: { progress: 0.5 } }, { name: 'Wide burn', params: { progress: 0.5, edge_width: 0.3 } }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Dissolve needs an Input.');
    const noise = ctx.texInput('noise');
    const p = ctx.params;
    const m = ctx.mod('progress');
    const draw = (which: number, label: string) => {
      const out = ctx.tex('gray');
      ctx.pass({
        label,
        target: out,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: {
            progress: p.num('progress'),
            progress_mod_k: m.k,
            softness: p.num('softness'),
            edge_width: p.num('edge_width'),
            noise_amount: p.num('noise_amount'),
            noise_contrast: p.num('noise_contrast'),
            reverse: p.bool('reverse'),
            has_noise: noise ? 1 : 0,
            which,
          },
        },
        textures: [src.tex, noise?.tex ?? null, m.tex?.tex ?? null],
        ss: 1,
      });
      return ctx.result(out, 'gray');
    };
    return { mask: draw(0, 'dissolve mask'), edge: draw(1, 'dissolve edge'), heat: draw(2, 'dissolve heat') };
  },
});

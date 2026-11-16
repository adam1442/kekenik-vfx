import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.ripple: ripple / shockwave PROFILE generator. A ring of radius R with an asymmetric profile: a sharp (or soft)
 * leading edge outside, a solid band `width`, then a long soft inner TAIL (the classic shockwave look). `count` ripples spaced by `spacing`
 * with amplitude `decay^i`, and an angular `wobble` (integer harmonics with integer-cycle `evolution`, so evolution 0 -> 1 loops seamlessly).
 * Animate `radius` for the expansion, `intensity` for the fade. Pixel units of the full image; tiling draws the periodic image nearest to the
 * centre. Limitations: circular rings only (use Transform for ellipses); rings larger than half the image are clipped when tiling.
 */
export const SHADER = defineShader('grayscale_ripple.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'radius', type: 'f32' },
  { name: 'width', type: 'f32' },
  { name: 'front', type: 'f32' },
  { name: 'tail', type: 'f32' },
  { name: 'count', type: 'i32' },
  { name: 'spacing', type: 'f32' },
  { name: 'decay', type: 'f32' },
  { name: 'wobble', type: 'f32' },
  { name: 'wobble_freq', type: 'f32' },
  { name: 'evolution', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'intensity_mod_k', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_amount', type: 'f32' },
]);

/** CPU reference of one ripple (wobble = 0): profile value at signed distance `d` (px, + outside) from the ring. */
export function rippleProfileRef(d: number, widthPx: number, front: number, tailPx: number): number {
  const w = Math.max(widthPx, 0.75);
  if (d >= 0) {
    const fs = Math.max(w * (1 - front), 0.5);
    const t = Math.min(1, Math.max(0, d / fs));
    return 1 - t * t * (3 - 2 * t);
  }
  const dd = -d;
  if (dd <= w) return 1;
  const t = Math.min(1, Math.max(0, (dd - w) / Math.max(tailPx, 0.5)));
  return (1 - t) * (1 - t);
}

export default defineNode({
  id: 'grayscale.ripple',
  version: 1,
  category: 'grayscale',
  title: 'Ripple / Shockwave',
  description: 'Shockwave and ripple profile: sharp leading edge, solid band and long soft inner tail, multiple decaying rings and an angular wobble. Animate Radius for the expansion.',
  keywords: ['ripple', 'shockwave', 'ring', 'wave', 'pulse', 'blast', 'impact', 'water', 'expanding', 'circle', 'nova'],
  icon: 'shape',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the ripple is looked up through it (warp / deform).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.vec2('center', [0.5, 0.5], { group: 'Ring', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Centre (UV, y down).' }),
    P.float('radius', 0.3, { group: 'Ring', min: 0, max: 4, softMax: 0.75, step: 0.005, display: 'percent', animatable: true, tooltip: 'Radius of the leading edge (fraction of the smaller image side). Animate 0 -> max for the expansion.' }),
    P.float('width', 0.03, { group: 'Ring', min: 0, max: 1, softMax: 0.2, step: 0.001, display: 'percent', animatable: true, tooltip: 'Solid band width behind the leading edge.' }),
    P.float('front', 0.85, { group: 'Profile', label: 'Front sharpness', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: '100% = razor sharp leading edge, 0% = soft as wide as the band.' }),
    P.float('tail', 0.35, { group: 'Profile', label: 'Tail length', min: 0, max: 4, softMax: 1.5, step: 0.01, display: 'percent', animatable: true, tooltip: 'Length of the soft inner tail relative to the radius.' }),
    P.int('count', 1, { group: 'Rings', min: 1, max: 12, softMax: 6, tooltip: 'Number of ripples.' }),
    P.float('spacing', 0.08, { group: 'Rings', min: 0, max: 1, softMax: 0.3, step: 0.002, display: 'percent', animatable: true, tooltip: 'Distance between ripples (fraction of the smaller side).' }),
    P.float('decay', 0.6, { group: 'Rings', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Amplitude multiplier per following ripple.' }),
    P.float('wobble', 0, { group: 'Wobble', min: 0, max: 1, softMax: 0.3, step: 0.005, display: 'percent', animatable: true, tooltip: 'Angular radius distortion (organic, splash-like rings).' }),
    P.float('wobble_freq', 5, { group: 'Wobble', label: 'Lobes', min: 1, max: 64, softMax: 16, step: 1 }),
    P.float('evolution', 0, { group: 'Wobble', min: -1000, max: 1000, softMin: 0, softMax: 4, step: 0.01, animatable: true, tooltip: 'Animates the wobble; every integer value returns to the same shape (loop).' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 4, softMax: 2, step: 0.01, animatable: true, modulatable: true }),
    P.seed('seed', 1, { group: 'Output' }),
    P.bool('invert', false, { group: 'Output' }),
    P.float('uv_amount', 1, { group: 'Output', label: 'UV amount', min: 0, max: 1, step: 0.01, showWhenConnected: 'uv' }),
  ],
  gizmos: [{ id: 'ring', label: 'Ripple centre / radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius' }],
  cost: { gpu: 'low', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Shockwave', params: { radius: 0.35, width: 0.02, front: 0.95, tail: 0.5 } },
    { name: 'Water ripples', params: { radius: 0.4, count: 4, spacing: 0.07, decay: 0.7, front: 0.2, tail: 0.05, width: 0.015 } },
    { name: 'Splash crown ring', params: { radius: 0.3, wobble: 0.15, wobble_freq: 9, width: 0.05 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const uvIn = ctx.texInput('uv');
    const m = ctx.mod('intensity');
    ctx.pass({
      label: 'ripple',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          center: p.vec2('center'),
          radius: p.num('radius'),
          width: p.num('width'),
          front: p.num('front'),
          tail: p.num('tail'),
          count: p.int('count'),
          spacing: p.num('spacing'),
          decay: p.num('decay'),
          wobble: p.num('wobble'),
          wobble_freq: p.num('wobble_freq'),
          evolution: p.num('evolution'),
          intensity: p.num('intensity'),
          intensity_mod_k: m.k,
          seed: p.seed('seed') >>> 0,
          invert: p.bool('invert'),
          has_uv: uvIn ? 1 : 0,
          uv_amount: p.num('uv_amount'),
        },
      },
      textures: [uvIn?.tex ?? null, m.tex?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

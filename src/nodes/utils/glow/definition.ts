import type { GpuTexture } from '../../../engine/resources/memory';
import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { BLUR_DECL } from '../../_shared/blur';
import { downsample2, gaussianAxes } from '../../_shared/blur2';
import { idOf, kindDefines, pinOf, titleOf, variants } from '../../_shared/variants';
import brightSrc from './bright.wgsl?raw';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.glow — multi-scale bloom. Soft-knee threshold -> pyramid of up to 6 half-resolution levels (exact 2x2 box
 * downsample, each level gets a small gaussian) -> weighted bicubic composite. Level i has an effective sigma of
 * ~2^(i+1) px; `radius` picks which scales contribute: w_i ~ 1 / (1 + (sigma_i / R)^4), normalised.
 * Pyramid depth is limited by the image size being divisible by 2 per level (non power of two sizes get fewer scales,
 * the largest radii then saturate). Cost ~ 1.4 x pixels of blur work: ~ 1.5 ms at 2048^2 estimated.
 */
export const BRIGHT_SHADER = defineShader('utils_glow_bright.wgsl', brightSrc);
export const SHADER = defineShader('utils_glow.wgsl', shaderSrc);
export const BRIGHT_LAYOUT = makeLayout([
  { name: 'threshold', type: 'f32' },
  { name: 'knee', type: 'f32' },
]);
export const LAYOUT = makeLayout([
  { name: 'w_a', type: 'vec4f' },
  { name: 'w_b', type: 'vec2f' },
  { name: 'intensity', type: 'f32' },
  { name: 'mode', type: 'u32' },
  { name: 'tint', type: 'vec3f' },
]);
export const MAX_LEVELS = 6;

/** Normalised per-level weights (pure, tested). `depth` = number of levels that really exist. */
export function glowWeights(radiusPx: number, scales: number, depth: number): number[] {
  const n = Math.min(scales, depth, MAX_LEVELS);
  const w: number[] = new Array(MAX_LEVELS).fill(0);
  let sum = 0;
  for (let i = 1; i <= n; i++) {
    const sigma = 2 ** i;
    const R = Math.max(radiusPx, 1);
    let v = 1 / (1 + (sigma / R) ** 4);
    // The last existing level also stands in for every larger scale that does not exist (non power-of-two sizes /
    // few scales): once the radius exceeds its sigma it ramps up to full weight so the energy never disappears.
    if (i === n && R > sigma) v = 0.5 + 0.5 * Math.min(R / sigma - 1, 1);
    w[i - 1] = v;
    sum += v;
  }
  return sum > 0 ? w.map((v) => v / sum) : w;
}
/** How many 2x levels the image supports (divisible sizes, min 8 px). */
export function glowDepth(w: number, h: number, maxLevels: number): number {
  let d = 0;
  let cw = w;
  let ch = h;
  while (d < maxLevels && cw % 2 === 0 && ch % 2 === 0 && cw >= 16 && ch >= 16) {
    cw /= 2;
    ch /= 2;
    d++;
  }
  return d;
}

export default variants((k) =>
  defineNode({
    id: idOf('utils.glow', k),
    version: 1,
    category: 'utils',
    title: titleOf('Glow', k),
    description: 'Multi-scale bloom with threshold, radius, intensity and tint.',
    keywords: ['bloom', 'glow', 'halo', 'light', 'neon'],
    icon: 'glow',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.float('threshold', 0.5, { group: 'Glow', min: 0, max: 16, softMax: 1, step: 0.005, animatable: true }),
      P.float('knee', 0.2, { group: 'Glow', min: 0, max: 4, softMax: 1, step: 0.005, tooltip: 'Softness of the threshold.' }),
      P.float('radius', 0.06, { group: 'Glow', min: 0.001, max: 1, softMax: 0.5, step: 0.001, display: 'percent', animatable: true, tooltip: 'Glow spread, fraction of the smaller side.' }),
      P.int('scales', 5, { group: 'Glow', label: 'Bloom scales', min: 1, max: MAX_LEVELS, tooltip: 'Number of pyramid levels (multi-scale bloom).' }),
      P.float('intensity', 1, { group: 'Glow', min: 0, max: 64, softMax: 8, step: 0.01, animatable: true }),
      ...(k === 'color' ? [P.color('tint', [1, 1, 1, 1], { group: 'Glow', tooltip: 'Glow colour multiplier.' })] : []),
      P.enum('mode', 'add', [{ value: 'add', label: 'Add to input' }, { value: 'glow_only', label: 'Glow only' }, { value: 'screen', label: 'Screen' }], { group: 'Output' }),
    ],
    gizmos: [{ id: 'radius', label: 'Glow radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }],
    cost: { gpu: 'medium', tiling: 'global', temporaries: 4 },
    shaders: [
      { source: BRIGHT_SHADER, uniforms: BRIGHT_LAYOUT, textures: 1, defines: kindDefines(k) },
      { source: SHADER, uniforms: LAYOUT, textures: 7, defines: kindDefines(k) },
      BLUR_DECL,
    ],
    gallery: [
      { name: 'Tight', params: { radius: 0.02, intensity: 2 } },
      { name: 'Wide soft', params: { radius: 0.3, threshold: 0.3, intensity: 2, scales: 6 } },
      { name: 'Glow only', params: { mode: 'glow_only' } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Glow needs an input');
      const p = ctx.params;
      const pin = pinOf(k);
      const side = Math.min(ctx.frame.width, ctx.frame.height);
      const depth = glowDepth(src.width, src.height, p.int('scales'));
      const levels: (GpuTexture | null)[] = [];
      if (depth > 0) {
        const bright = ctx.tex(pin);
        ctx.pass({ label: 'glow bright', target: bright, shader: BRIGHT_SHADER, defines: kindDefines(k), uniforms: { layout: BRIGHT_LAYOUT, values: { threshold: p.num('threshold'), knee: p.num('knee') } }, textures: [src.tex], ss: 1 });
        let cur = bright;
        for (let i = 1; i <= depth; i++) {
          const d = downsample2(ctx, cur, pin);
          if (i === 1) ctx.free(cur); // only the bright pass is temporary; blurred levels stay for the composite
          const b = gaussianAxes(ctx, d, pin, 2, 2);
          ctx.free(d);
          levels.push(b);
          cur = b;
          // `cur` stays alive as the next downsample source AND as a composite input; it is freed after the final pass.
        }
      }
      const w = glowWeights(p.num('radius') * side, p.int('scales'), depth);
      const out = ctx.tex(pin);
      const tint = k === 'color' ? p.rgba('tint') : [1, 1, 1, 1];
      ctx.pass({
        label: 'glow composite',
        target: out,
        shader: SHADER,
        defines: kindDefines(k),
        uniforms: { layout: LAYOUT, values: { w_a: [w[0], w[1], w[2], w[3]], w_b: [w[4], w[5]], intensity: p.num('intensity'), mode: p.enumIndex('mode'), tint: [tint[0], tint[1], tint[2]] } },
        textures: [src.tex, ...Array.from({ length: MAX_LEVELS }, (_, i) => levels[i] ?? null)],
        ss: 1,
      });
      for (const l of levels) if (l) ctx.free(l);
      return { output: ctx.result(out, pin) };
    },
  }),
);

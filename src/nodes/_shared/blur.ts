import type { EvalContext } from '../../engine/graph/node';
import type { GpuTexture } from '../../engine/resources/memory';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout } from '../../engine/shaders/uniforms';
import type { TexturePin } from '../../engine/types';
import blurSrc from './blur.wgsl?raw';

/**
 * Shared separable blur helpers used by Filter, Curvature, XDoG (and later by Blur/Glow/Denoise nodes).
 * Every helper allocates NEW textures through ctx.tex (auto-released unless returned) and returns the final one;
 * the input is never written. All passes are wrap-aware (they honour the node's Tiling).
 */
export const BLUR_SHADER = defineShader('shared_blur.wgsl', blurSrc);
export const BLUR_LAYOUT = makeLayout([
  { name: 'dir_x', type: 'i32' },
  { name: 'dir_y', type: 'i32' },
  { name: 'radius', type: 'i32' },
  { name: 'stride', type: 'i32' },
  { name: 'kind', type: 'u32' },
  { name: 'sigma', type: 'f32' },
]);
export const BLUR_DECL = { source: BLUR_SHADER, uniforms: BLUR_LAYOUT, textures: 1 };

/** Largest sigma (pixels) evaluated with a single direct gaussian (121 taps per axis); larger ones are cascaded. */
export const MAX_DIRECT_SIGMA = 20;
/** Largest box radius evaluated with direct taps; larger boxes use the exact two-stage strided decomposition. */
export const MAX_DIRECT_BOX = 24;
export const MAX_BOX_RADIUS = 160;

/** Plan of a gaussian blur: number of cascaded iterations and the per-iteration sigma / tap radius (pure, tested). */
export function gaussianPlan(sigmaPx: number): { iterations: number; sigma: number; radius: number } {
  const s = Math.max(0, sigmaPx);
  if (s < 0.15) return { iterations: 1, sigma: 0, radius: 0 };
  const iterations = s > MAX_DIRECT_SIGMA ? Math.min(Math.ceil((s / MAX_DIRECT_SIGMA) ** 2), 8) : 1;
  const sigma = s / Math.sqrt(iterations);
  return { iterations, sigma, radius: Math.max(1, Math.ceil(3 * sigma)) };
}

/**
 * Box blur decomposition. Width W = 2R+1 = s*m (s, m odd) is applied as a width-s box followed by m taps spaced by s:
 * mathematically identical to a W-wide box, but costs s+m taps instead of W.
 */
export function boxPlan(radiusPx: number): { direct: boolean; radius: number; s: number; m: number } {
  const r = Math.min(Math.round(Math.max(0, radiusPx)), MAX_BOX_RADIUS);
  if (r <= MAX_DIRECT_BOX) return { direct: true, radius: r, s: 1, m: 2 * r + 1 };
  const w = 2 * r + 1;
  const s = 2 * Math.floor((Math.sqrt(w) - 1) / 2) + 1;
  let m = Math.round(w / s);
  if (m % 2 === 0) m += 1;
  return { direct: false, radius: (s * m - 1) / 2, s, m };
}

export function blurPass(ctx: EvalContext, from: GpuTexture, to: GpuTexture, dx: number, dy: number, radius: number, stride: number, kind: 0 | 1, sigma: number): void {
  ctx.pass({
    label: kind === 1 ? 'gaussian' : 'box',
    target: to,
    shader: BLUR_SHADER,
    uniforms: { layout: BLUR_LAYOUT, values: { dir_x: dx, dir_y: dy, radius, stride, kind, sigma } },
    textures: [from],
    ss: 1,
  });
}

/** Gaussian blur with standard deviation `sigmaPx` pixels. */
export function gaussianBlur(ctx: EvalContext, src: GpuTexture, pin: TexturePin, sigmaPx: number): GpuTexture {
  const plan = gaussianPlan(sigmaPx);
  const a = ctx.tex(pin);
  const b = ctx.tex(pin);
  blurPass(ctx, src, a, 1, 0, plan.radius, 1, 1, plan.sigma);
  blurPass(ctx, a, b, 0, 1, plan.radius, 1, 1, plan.sigma);
  for (let i = 1; i < plan.iterations; i++) {
    blurPass(ctx, b, a, 1, 0, plan.radius, 1, 1, plan.sigma);
    blurPass(ctx, a, b, 0, 1, plan.radius, 1, 1, plan.sigma);
  }
  return b;
}

/** Box blur with radius `radiusPx` pixels (window 2R+1). */
export function boxBlur(ctx: EvalContext, src: GpuTexture, pin: TexturePin, radiusPx: number): GpuTexture {
  const plan = boxPlan(radiusPx);
  const a = ctx.tex(pin);
  const b = ctx.tex(pin);
  if (plan.direct) {
    blurPass(ctx, src, a, 1, 0, plan.radius, 1, 0, 1);
    blurPass(ctx, a, b, 0, 1, plan.radius, 1, 0, 1);
    return b;
  }
  const rs = (plan.s - 1) / 2;
  const rm = (plan.m - 1) / 2;
  blurPass(ctx, src, a, 1, 0, rs, 1, 0, 1);
  blurPass(ctx, a, b, 1, 0, rm, plan.s, 0, 1);
  blurPass(ctx, b, a, 0, 1, rs, 1, 0, 1);
  blurPass(ctx, a, b, 0, 1, rm, plan.s, 0, 1);
  return b;
}

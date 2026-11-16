import type { EvalContext } from '../../engine/graph/node';
import type { GpuTexture } from '../../engine/resources/memory';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout } from '../../engine/shaders/uniforms';
import type { TexturePin } from '../../engine/types';
import { blurPass, boxPlan, gaussianPlan, BLUR_DECL } from './blur';
import downSrc from './down.wgsl?raw';
import kawaseSrc from './kawase.wgsl?raw';
import upSrc from './up.wgsl?raw';

/**
 * Blur toolbox v2. Everything is wrap-aware and per-AXIS (rx != ry). Temporaries are released with
 * `ctx.free` as soon as their last pass was recorded, so peak memory stays at ~3 textures however long the chain is.
 *   - gaussianAxes : separable direct / cascaded gaussian (exact, <= 121 taps per axis and iteration)
 *   - boxAxes      : separable box, exact strided decomposition for big radii
 *   - blurFast     : PYRAMID HYBRID gaussian: box-downsample by 2^k, gaussian at low resolution, bicubic upsample.
 *                    Cost is independent of the radius (about 1.33 x the pixels of the image for the pyramid).
 *   - kawaseBlur   : N bilinear 4-tap passes with growing offsets (fast approximate gaussian, any radius)
 */
export const DOWN_SHADER = defineShader('shared_down.wgsl', downSrc);
export const UP_SHADER = defineShader('shared_up.wgsl', upSrc);
export const KAWASE_SHADER = defineShader('shared_kawase.wgsl', kawaseSrc);
export const KAWASE_LAYOUT = makeLayout([
  { name: 'off_x', type: 'f32' },
  { name: 'off_y', type: 'f32' },
]);
export const BLUR2_DECLS = [BLUR_DECL, { source: DOWN_SHADER, textures: 1 }, { source: UP_SHADER, textures: 1 }, { source: KAWASE_SHADER, uniforms: KAWASE_LAYOUT, textures: 1 }];

/** How many 2x downsamples the hybrid uses (pure, tested). Stops when sigma is small enough or sizes are odd / tiny. */
export function pyramidLevels(w: number, h: number, sigmaPx: number, maxLevels = 8, direct = 12): number {
  let k = 0;
  let cw = w;
  let ch = h;
  let s = sigmaPx;
  while (k < maxLevels && s > direct && cw % 2 === 0 && ch % 2 === 0 && cw >= 32 && ch >= 32) {
    cw /= 2;
    ch /= 2;
    s /= 2;
    k++;
  }
  return k;
}

/** Variance (full-res px^2) added by the 2^k box prefilter of the pyramid; the low-res sigma compensates for it. */
export const pyramidBoxVariance = (k: number): number => (4 ** k - 1) / 12;

const keep = (ctx: EvalContext, t: GpuTexture, src: GpuTexture): void => {
  if (t !== src) ctx.free(t);
};

/** Identity copy into a new texture (a node must never return its input texture as its own result). */
export function copyTex(ctx: EvalContext, src: GpuTexture, pin: TexturePin): GpuTexture {
  const out = ctx.tex(pin, src.width, src.height);
  blurPass(ctx, src, out, 1, 0, 0, 1, 0, 1);
  return out;
}

export function gaussianAxes(ctx: EvalContext, src: GpuTexture, pin: TexturePin, sx: number, sy: number): GpuTexture {
  let cur = src;
  const run = (dx: number, dy: number, sigma: number): void => {
    const plan = gaussianPlan(sigma);
    if (plan.radius === 0) return;
    for (let i = 0; i < plan.iterations; i++) {
      const t = ctx.tex(pin, src.width, src.height);
      blurPass(ctx, cur, t, dx, dy, plan.radius, 1, 1, plan.sigma);
      keep(ctx, cur, src);
      cur = t;
    }
  };
  run(1, 0, sx);
  run(0, 1, sy);
  return cur === src ? copyTex(ctx, src, pin) : cur;
}

export function boxAxes(ctx: EvalContext, src: GpuTexture, pin: TexturePin, rx: number, ry: number): GpuTexture {
  let cur = src;
  const stage = (dx: number, dy: number, radius: number, stride: number): void => {
    const t = ctx.tex(pin, src.width, src.height);
    blurPass(ctx, cur, t, dx, dy, radius, stride, 0, 1);
    keep(ctx, cur, src);
    cur = t;
  };
  const axis = (dx: number, dy: number, r: number): void => {
    const plan = boxPlan(r);
    if (plan.radius === 0) return;
    if (plan.direct) return stage(dx, dy, plan.radius, 1);
    stage(dx, dy, (plan.s - 1) / 2, 1);
    stage(dx, dy, (plan.m - 1) / 2, plan.s);
  };
  axis(1, 0, rx);
  axis(0, 1, ry);
  return cur === src ? copyTex(ctx, src, pin) : cur;
}

export function downsample2(ctx: EvalContext, src: GpuTexture, pin: TexturePin): GpuTexture {
  const out = ctx.tex(pin, src.width / 2, src.height / 2);
  ctx.pass({ label: 'downsample 2x', target: out, shader: DOWN_SHADER, textures: [src], ss: 1 });
  return out;
}
export function upsampleTo(ctx: EvalContext, src: GpuTexture, pin: TexturePin, w: number, h: number): GpuTexture {
  const out = ctx.tex(pin, w, h);
  ctx.pass({ label: 'upsample bicubic', target: out, shader: UP_SHADER, textures: [src], ss: 1 });
  return out;
}

/** Hybrid pyramid gaussian with per-axis sigma (pixels of `src`). */
export function blurFast(ctx: EvalContext, src: GpuTexture, pin: TexturePin, sx: number, sy: number): GpuTexture {
  const k = pyramidLevels(src.width, src.height, Math.max(sx, sy));
  if (k === 0) return gaussianAxes(ctx, src, pin, sx, sy);
  const comp = (s: number): number => Math.sqrt(Math.max(s * s - pyramidBoxVariance(k), 0)) / 2 ** k;
  let cur = src;
  for (let i = 0; i < k; i++) {
    const next = downsample2(ctx, cur, pin);
    keep(ctx, cur, src);
    cur = next;
  }
  const blurred = gaussianAxes(ctx, cur, pin, comp(sx), comp(sy));
  ctx.free(cur);
  const out = upsampleTo(ctx, blurred, pin, src.width, src.height);
  ctx.free(blurred);
  return out;
}

/** Kawase offsets (px) whose summed squares equal sigma^2, geometric growth; at most 8 passes (pure, tested). */
export function kawaseOffsets(sigma: number): number[] {
  if (sigma < 0.2) return [];
  const n = Math.min(8, Math.max(1, Math.ceil(Math.log2(Math.max(sigma, 1))) + 1));
  let norm = 0;
  for (let i = 0; i < n; i++) norm += 4 ** i;
  return Array.from({ length: n }, (_, i) => (sigma * 2 ** i) / Math.sqrt(norm));
}

export function kawaseBlur(ctx: EvalContext, src: GpuTexture, pin: TexturePin, sx: number, sy: number): GpuTexture {
  const s = Math.max(sx, sy, 1e-6);
  const offs = kawaseOffsets(s);
  if (offs.length === 0) return copyTex(ctx, src, pin);
  let cur = src;
  for (const o of offs) {
    const t = ctx.tex(pin, src.width, src.height);
    ctx.pass({ label: 'kawase', target: t, shader: KAWASE_SHADER, uniforms: { layout: KAWASE_LAYOUT, values: { off_x: (o * sx) / s, off_y: (o * sy) / s } }, textures: [cur], ss: 1 });
    keep(ctx, cur, src);
    cur = t;
  }
  return cur;
}

/** CPU reference: separable gaussian with wrap or clamp along one row (used by tests). */
export function gaussianKernel1D(sigma: number): number[] {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(w);
    sum += w;
  }
  return k.map((x) => x / sum);
}
export function blurReference(img: Float32Array, w: number, h: number, sx: number, sy: number, tileX: boolean, tileY: boolean, kind: 'gaussian' | 'box' = 'gaussian'): Float32Array {
  const kern = (s: number): number[] => {
    if (s <= 0) return [1];
    if (kind === 'gaussian') return gaussianKernel1D(s);
    const r = Math.round(s);
    return Array.from({ length: 2 * r + 1 }, () => 1 / (2 * r + 1));
  };
  const pass = (src: Float32Array, horizontal: boolean, s: number): Float32Array => {
    const k = kern(s);
    const r = (k.length - 1) / 2;
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let acc = 0;
        for (let i = -r; i <= r; i++) {
          let xx = x + (horizontal ? i : 0);
          let yy = y + (horizontal ? 0 : i);
          const tile = horizontal ? tileX : tileY;
          if (horizontal) xx = tile ? ((xx % w) + w) % w : Math.min(Math.max(xx, 0), w - 1);
          else yy = tile ? ((yy % h) + h) % h : Math.min(Math.max(yy, 0), h - 1);
          acc += src[yy * w + xx] * k[i + r];
        }
        out[y * w + x] = acc;
      }
    return out;
  };
  return pass(pass(img, true, sx), false, sy);
}

import type { EvalContext } from '../../engine/graph/node';
import type { GpuTexture } from '../../engine/resources/memory';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout } from '../../engine/shaders/uniforms';
import type { TexturePin } from '../../engine/types';
import discSrc from './morph_disc.wgsl?raw';
import lineSrc from './morph_line.wgsl?raw';

/**
 * Shared grayscale morphology: Dilate, Filter min/max.
 *
 * ALGORITHM. A flat structuring element that is the Minkowski sum of line segments (a zonogon) is applied segment
 * by segment (dilation by A (+) B == dilation by A then by B). One segment of half length `a` steps along (dx,dy) has
 * the window [p-a, p+a]; it is evaluated with a SPARSE TABLE: level k = max over 2^k consecutive samples,
 * built in K = floor(log2(2a+1)) cheap 2-tap passes, then ONE 2-tap pass combines two overlapping power-of-two windows.
 * Cost per segment: (K+1) passes x 2 taps  ->  O(log r), independent of the radius.
 *   square   = H + V lines                               (exact)
 *   diamond  = two diagonal lines                        (exact)
 *   octagon  = square (+) diamond with b = a/sqrt2       (regular octagon)
 *   circle   = 8 line families (0, 90, 45, 135, +-26.57, +-63.43 deg) with lengths proportional to the angular gap:
 *              a regular 16-gon (max radial error ~2%); radius <= CIRCLE_EXACT_PX uses an exact direct disc loop.
 * The input is never written; 3 temporaries are ping-ponged; the last written one is returned.
 */
export const MORPH_LINE_SHADER = defineShader('shared_morph_line.wgsl', lineSrc);
export const MORPH_LINE_LAYOUT = makeLayout([
  { name: 'dx', type: 'i32' },
  { name: 'dy', type: 'i32' },
  { name: 'off0', type: 'i32' },
  { name: 'off1', type: 'i32' },
  { name: 'is_max', type: 'u32' },
]);
export const MORPH_DISC_SHADER = defineShader('shared_morph_disc.wgsl', discSrc);
export const MORPH_DISC_LAYOUT = makeLayout([
  { name: 'radius', type: 'i32' },
  { name: 'r2', type: 'f32' },
  { name: 'is_max', type: 'u32' },
]);
export const MORPH_DECLS = [
  { source: MORPH_LINE_SHADER, uniforms: MORPH_LINE_LAYOUT, textures: 1 },
  { source: MORPH_DISC_SHADER, uniforms: MORPH_DISC_LAYOUT, textures: 1 },
];

export type MorphShape = 'circle' | 'square' | 'diamond' | 'octagon';
export const CIRCLE_EXACT_PX = 6;
export interface MorphSegment {
  dx: number;
  dy: number;
  /** Half length in steps of (dx,dy). The window is 2*steps+1 samples. */
  steps: number;
}

/** Line segments whose Minkowski sum approximates the shape of radius `rPx` (pure, unit-tested). */
export function morphSegments(shape: MorphShape, rPx: number): MorphSegment[] {
  const r = Math.max(0, rPx);
  const seg = (dx: number, dy: number, half: number): MorphSegment => ({ dx, dy, steps: Math.round(half / Math.hypot(dx, dy)) });
  let out: MorphSegment[];
  switch (shape) {
    case 'square':
      out = [seg(1, 0, r), seg(0, 1, r)];
      break;
    case 'diamond':
      out = [seg(1, 1, r / 2 * Math.SQRT2), seg(1, -1, r / 2 * Math.SQRT2)];
      break;
    case 'octagon': {
      const a = r / (1 + Math.SQRT2);
      const b = a / Math.SQRT2;
      out = [seg(1, 0, a), seg(0, 1, a), seg(1, 1, b * Math.SQRT2), seg(1, -1, b * Math.SQRT2)];
      break;
    }
    default: {
      // half length of each family = (R / 2) * (angular share in radians)
      out = [seg(1, 0, 0.2318 * r), seg(0, 1, 0.2318 * r), seg(1, 1, 0.1609 * r), seg(1, -1, 0.1609 * r), seg(2, 1, 0.1963 * r), seg(2, -1, 0.1963 * r), seg(1, 2, 0.1963 * r), seg(1, -2, 0.1963 * r)];
    }
  }
  return out.filter((s) => s.steps >= 1);
}

/** Number of fullscreen passes morphRun records for the segments (pure; used by cost estimates and tests). */
export function morphPassCount(segs: MorphSegment[]): number {
  let n = 0;
  for (const s of segs) n += Math.floor(Math.log2(2 * s.steps + 1)) + 1;
  return Math.max(n, 1);
}

/** Run the min (isMax=false) or max (isMax=true) morphology; returns a NEW texture. */
export function morphRun(ctx: EvalContext, src: GpuTexture, pin: TexturePin, shape: MorphShape, rPx: number, isMax: boolean): GpuTexture {
  const flag = isMax ? 1 : 0;
  const tmp: GpuTexture[] = [];
  const pick = (exclude: GpuTexture): GpuTexture => {
    for (const t of tmp) if (t !== exclude) return t;
    const t = ctx.tex(pin);
    tmp.push(t);
    return t;
  };
  const line = (from: GpuTexture, to: GpuTexture, dx: number, dy: number, off0: number, off1: number): void =>
    ctx.pass({ label: 'morph', target: to, shader: MORPH_LINE_SHADER, uniforms: { layout: MORPH_LINE_LAYOUT, values: { dx, dy, off0, off1, is_max: flag } }, textures: [from], ss: 1 });

  if (shape === 'circle' && rPx <= CIRCLE_EXACT_PX && rPx >= 0.5) {
    const out = ctx.tex(pin);
    ctx.pass({ label: 'morph disc', target: out, shader: MORPH_DISC_SHADER, uniforms: { layout: MORPH_DISC_LAYOUT, values: { radius: Math.ceil(rPx), r2: (rPx + 0.25) * (rPx + 0.25), is_max: flag } }, textures: [src], ss: 1 });
    return out;
  }
  let cur = src;
  for (const s of morphSegments(shape, rPx)) {
    const a = s.steps;
    const k = Math.floor(Math.log2(2 * a + 1));
    let prev = cur;
    for (let lv = 1; lv <= k; lv++) {
      const t = pick(prev);
      line(prev, t, s.dx, s.dy, 0, 2 ** (lv - 1));
      prev = t;
    }
    const res = pick(prev);
    line(prev, res, s.dx, s.dy, -a, a - 2 ** k + 1);
    cur = res;
  }
  if (cur === src) {
    // radius below one step: identity copy so the caller always gets an owned texture
    const res = pick(src);
    line(src, res, 0, 0, 0, 0);
    cur = res;
  }
  return cur;
}

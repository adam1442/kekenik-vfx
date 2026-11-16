import type { EvalContext } from '../../engine/graph/node';
import type { ComputeBinding } from '../../engine/gpu/passes';
import type { GpuTexture, PooledBuffer } from '../../engine/resources/memory';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout } from '../../engine/shaders/uniforms';
import reduceSrc from './reduce.wgsl?raw';

/**
 * Asynchronous GPU reduction (auto-levels, auto-crop). Records init + main + finalize compute passes into the node's
 * encoder and returns a pooled buffer holding 8 f32 values (layout documented in reduce.wgsl). The consumer binds it
 * through `storageBuffers: [buf.buffer]` (shader sees `s0: array<f32>`). NOTHING is ever read back to the CPU.
 */
export const REDUCE_SHADER = defineShader('shared_reduce.wgsl', reduceSrc);
export const REDUCE_LAYOUT = makeLayout([
  { name: 'threshold', type: 'f32' },
  { name: 'source', type: 'u32' },
  { name: 'use_threshold', type: 'u32' },
  { name: 'pad', type: 'u32' },
]);
export type ReduceSource = 'red' | 'luminance' | 'alpha' | 'any' | 'rgb_range';
export const REDUCE_SOURCES: ReduceSource[] = ['red', 'luminance', 'alpha', 'any', 'rgb_range'];

/** Indices in the result buffer. */
export const STAT = { xmin: 0, ymin: 1, xmax: 2, ymax: 3, vmin: 4, vmax: 5, count: 6, valid: 7 } as const;

export function reduceStats(ctx: EvalContext, tex: GpuTexture, source: ReduceSource, threshold: number | null): PooledBuffer {
  const buf = ctx.buffer(32);
  const u = ctx.uniformBinding(REDUCE_LAYOUT, { threshold: threshold ?? 0, source: REDUCE_SOURCES.indexOf(source), use_threshold: threshold === null ? 0 : 1, pad: 0 });
  const bindings = (): ComputeBinding[] => [u, { kind: 'texture', tex }, { kind: 'storage', buffer: buf.buffer }];
  ctx.compute({ label: 'reduce init', shader: REDUCE_SHADER, entry: 'init', bindings: bindings(), workgroups: [1] });
  ctx.compute({ label: 'reduce', shader: REDUCE_SHADER, entry: 'main', bindings: bindings(), workgroups: [Math.ceil(tex.width / 16), Math.ceil(tex.height / 16)] });
  ctx.compute({ label: 'reduce finalize', shader: REDUCE_SHADER, entry: 'finalize', bindings: bindings(), workgroups: [1] });
  return buf;
}

/** CPU mirror of the reduction (used by unit tests and the GPU known-answer self-test). */
export function reduceReference(data: ArrayLike<number>, w: number, h: number, channels: number, measure: (px: number[]) => [number, number], threshold: number | null): number[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, vmin = Infinity, vmax = -Infinity, cnt = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px: number[] = [];
      for (let c = 0; c < channels; c++) px.push(data[(y * w + x) * channels + c]);
      const [lo, hi] = measure(px);
      vmin = Math.min(vmin, lo);
      vmax = Math.max(vmax, hi);
      if (threshold === null || hi > threshold) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + 1); y1 = Math.max(y1, y + 1);
        cnt++;
      }
    }
  if (cnt === 0) return [0, 0, w, h, vmin, vmax, 0, 0];
  return [x0, y0, x1, y1, vmin, vmax, cnt, 1];
}

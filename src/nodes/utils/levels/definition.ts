import { runFusable } from '../../../engine/fusion/standalone';
import { defineNode, type FusableDecl, type ShaderDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { reduceStats } from '../../_shared/reduce';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.levels (Gray) / utils.levels_color (Color): input range, gamma, output range, plus AUTO LEVELS: min / max of the
 * input are found by an asynchronous GPU reduction (workgroup shared memory + atomics, see _shared/reduce.wgsl) and consumed
 * by the levels pass inside the same submit — no CPU readback, no stall. Color auto-levels use ONE range for all channels
 * (min / max over rgb) so the colour balance is preserved.
 * Cost @2048^2: levels ~ 0.1 ms, reduction ~ 0.15 ms.
 */
export const SHADER = defineShader('utils_levels.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'in_low', type: 'f32' },
  { name: 'in_high', type: 'f32' },
  { name: 'gamma', type: 'f32' },
  { name: 'out_low', type: 'f32' },
  { name: 'out_high', type: 'f32' },
  { name: 'clamp_output', type: 'u32' },
  { name: 'levels_alpha', type: 'u32' },
]);

/** CPU reference (identical math) for tests. */
export function levelsReference(v: number, p: { inLow: number; inHigh: number; gamma: number; outLow: number; outHigh: number; clamp: boolean }): number {
  const span = Math.max(Math.abs(p.inHigh - p.inLow), 1e-6) * (p.inHigh >= p.inLow ? 1 : -1);
  let x = Math.max((v - p.inLow) / span, 0);
  x = Math.pow(x, 1 / Math.max(p.gamma, 1e-4));
  let o = p.outLow + (p.outHigh - p.outLow) * x;
  if (p.clamp) o = Math.min(Math.max(o, Math.min(p.outLow, p.outHigh)), Math.max(p.outLow, p.outHigh));
  return o;
}

export default variants((k) => {
  const decls = (auto: boolean): ShaderDecl => ({ source: SHADER, uniforms: LAYOUT, textures: 1, storage: auto ? 1 : 0, defines: { COLOR: k === 'color' ? 1 : 0, AUTO: auto ? 1 : 0 } });
  const FUSE: FusableDecl = {
    source: SHADER,
    uniforms: LAYOUT,
    defines: { COLOR: k === 'color' ? 1 : 0 },
    canFuse: (v) => !v.auto,
    uniformValues: (p) => ({
      in_low: p.num('in_low'),
      in_high: p.num('in_high'),
      gamma: p.num('gamma'),
      out_low: p.num('out_low'),
      out_high: p.num('out_high'),
      clamp_output: p.bool('clamp_output'),
      levels_alpha: k === 'color' && p.bool('levels_alpha'),
    }),
  };
  return defineNode({
    id: idOf('utils.levels', k),
    version: 1,
    category: 'utils',
    title: titleOf('Levels', k),
    description: 'Remaps the input range, gamma and output range. Auto levels stretch the actual min / max to the full range (GPU reduction, no stall).',
    keywords: ['contrast', 'remap', 'gamma', 'histogram', 'range', 'auto levels', 'normalize'],
    icon: 'levels',
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.bool('auto', false, { group: 'Input', label: 'Auto levels', tooltip: 'Use the image minimum / maximum as input range (found on the GPU).' }),
      P.float('in_low', 0, { group: 'Input', label: 'Input low', softMin: 0, softMax: 1, min: -16, max: 16, step: 0.005, animatable: true, visibleIf: (v) => !v.auto }),
      P.float('in_high', 1, { group: 'Input', label: 'Input high', softMin: 0, softMax: 1, min: -16, max: 16, step: 0.005, animatable: true, visibleIf: (v) => !v.auto }),
      P.float('gamma', 1, { group: 'Input', min: 0.01, max: 10, softMin: 0.2, softMax: 5, step: 0.01, animatable: true, tooltip: '>1 brightens midtones, <1 darkens.' }),
      P.float('out_low', 0, { group: 'Output', label: 'Output low', softMin: 0, softMax: 1, min: -16, max: 16, step: 0.005, animatable: true }),
      P.float('out_high', 1, { group: 'Output', label: 'Output high', softMin: 0, softMax: 1, min: -16, max: 16, step: 0.005, animatable: true }),
      P.bool('clamp_output', true, { group: 'Output', label: 'Clamp output' }),
      ...(k === 'color' ? [P.bool('levels_alpha', false, { group: 'Output', label: 'Include alpha', tooltip: 'Alpha is an ordinary channel: tick to level it as well.' })] : []),
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    shaders: [decls(false), decls(true)],
    fusable: FUSE,
    gallery: [{ name: 'Auto', params: { auto: true } }, { name: 'Gamma 2', params: { gamma: 2 } }, { name: 'Inverted', params: { out_low: 1, out_high: 0 } }],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Levels needs an input');
      const p = ctx.params;
      const auto = p.bool('auto');
      if (!auto) return runFusable(ctx, FUSE, pinOf(k), 'levels');
      const out = ctx.tex(pinOf(k));
      const stats = auto ? reduceStats(ctx, src.tex, k === 'color' ? 'rgb_range' : 'red', null) : null;
      ctx.pass({
        label: auto ? 'levels (auto)' : 'levels',
        target: out,
        shader: SHADER,
        defines: { COLOR: k === 'color' ? 1 : 0, AUTO: auto ? 1 : 0 },
        uniforms: {
          layout: LAYOUT,
          values: {
            in_low: p.num('in_low'),
            in_high: p.num('in_high'),
            gamma: p.num('gamma'),
            out_low: p.num('out_low'),
            out_high: p.num('out_high'),
            clamp_output: p.bool('clamp_output'),
            levels_alpha: k === 'color' && p.bool('levels_alpha'),
          },
        },
        textures: [src.tex],
        storageBuffers: stats ? [stats.buffer] : undefined,
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  });
});

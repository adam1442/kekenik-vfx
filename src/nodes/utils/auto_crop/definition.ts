import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { reduceStats, type ReduceSource } from '../../_shared/reduce';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.auto_crop — finds the bounding box of the content (pixels above Threshold) with an ASYNCHRONOUS GPU REDUCTION
 * (16x16 workgroups reduce in shared memory, atomics merge, a finalize pass decodes; the crop pass reads the result as a
 * storage buffer inside the same submit). No mapAsync, no stall, no frame of latency. Then the bounds (+ padding) are
 * resampled over the full output, stretched or aspect-preserving; optionally the content range is normalised to 0..1.
 * Estimated 2048^2: reduction ~ 0.15 ms + crop 0.1 ms. Tiling: output is not tileable (bounds are not periodic).
 */
export const SHADER = defineShader('utils_auto_crop.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'padding', type: 'f32' },
  { name: 'fit', type: 'u32' },
  { name: 'norm_on', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.auto_crop', k),
    version: 1,
    category: 'utils',
    title: titleOf('Auto Crop', k),
    description: 'Crops to the content bounds (found on the GPU without stalls), with padding, aspect fit and optional normalisation.',
    keywords: ['crop', 'bounds', 'bounding box', 'trim', 'fit', 'normalize', 'sprite'],
    icon: 'transform',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      ...(k === 'color'
        ? [P.enum('source', 'alpha', [{ value: 'luminance', label: 'Luminance' }, { value: 'alpha', label: 'Alpha' }, { value: 'any', label: 'Any channel' }], { group: 'Crop', label: 'Detect by' })]
        : []),
      P.float('threshold', 0.01, { group: 'Crop', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Pixels above this value count as content.' }),
      P.float('padding', 0, { group: 'Crop', min: -0.4, max: 1, softMax: 0.25, step: 0.002, display: 'percent', animatable: true, tooltip: 'Extra border around the bounds (fraction of the smaller side).' }),
      P.enum('fit', 'keep_aspect', [{ value: 'stretch', label: 'Stretch to fill' }, { value: 'keep_aspect', label: 'Keep aspect' }], { group: 'Crop' }),
      P.bool('normalize', false, { group: 'Crop', tooltip: 'Remap the min..max of the detected channel to 0..1.' }),
    ],
    cost: { gpu: 'low', tiling: 'global', temporaries: 0 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1, storage: 1, defines: { COLOR: k === 'color' ? 1 : 0 } }],
    gallery: [{ name: 'Stretch', params: { fit: 'stretch' } }, { name: 'Normalized', params: { normalize: true, threshold: 0.3 } }],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Auto Crop needs an input');
      const p = ctx.params;
      const source: ReduceSource = k === 'gray' ? 'red' : (p.str('source') as ReduceSource);
      const stats = reduceStats(ctx, src.tex, source, p.num('threshold'));
      const out = ctx.tex(pinOf(k));
      ctx.pass({
        label: 'auto crop',
        target: out,
        shader: SHADER,
        defines: { COLOR: k === 'color' ? 1 : 0 },
        uniforms: { layout: LAYOUT, values: { padding: p.num('padding'), fit: p.enumIndex('fit'), norm_on: p.bool('normalize') } },
        textures: [src.tex],
        storageBuffers: [stats.buffer],
        ss: 1,
      });
      return { output: ctx.result(out, pinOf(k)) };
    },
  }),
);

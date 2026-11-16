import { P } from '../../../engine/params/schema';
import { shaderNode, shaderPass } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.blur: separable, tiling-aware gaussian / box smoothing of a vector field (two passes). */
export default shaderNode({
  id: 'vector.blur',
  title: 'Vector Blur / Smooth',
  description: 'Smooths a vector field with a separable gaussian or box blur. Wraps around when the graph tiles.',
  keywords: ['vector', 'blur', 'smooth', 'filter', 'denoise', 'gaussian'],
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  cost: { gpu: 'low', tiling: 'halo', halo: () => 64 },
  variantDefines: [{ DIR: 0 }, { DIR: 1 }],
  params: [
    P.float('radius', 0.02, { group: 'Blur', label: 'Radius', min: 0, max: 0.5, softMax: 0.1, step: 0.001, animatable: true, tooltip: 'Fraction of the smaller image side.' }),
    P.enum('kernel', 'gaussian', [{ value: 'gaussian', label: 'Gaussian' }, { value: 'box', label: 'Box' }], { group: 'Blur', label: 'Kernel' }),
    P.int('taps', 16, { group: 'Blur', label: 'Taps per side', min: 2, max: 48, tooltip: 'Samples on each side of the centre.' }),
  ],
  gallery: [{ name: 'Soft', params: { radius: 0.02 } }, { name: 'Heavy', params: { radius: 0.08, taps: 32 } }],
  shader: src,
  evaluate(ctx, rt) {
    const src0 = ctx.texInput('input');
    if (!src0) throw new Error('Vector Blur needs a Vector input.');
    const vals = rt.values(ctx);
    const mid = ctx.tex('vector');
    const out = ctx.tex('vector');
    shaderPass(ctx, rt, 'vector blur h', mid, [src0.tex], vals, { DIR: 0 });
    shaderPass(ctx, rt, 'vector blur v', out, [mid], vals, { DIR: 1 });
    const r = ctx.result(out, 'vector');
    r.vecScale = src0.vecScale ?? 1;
    return { output: r };
  },
});

import { P } from '../../../engine/params/schema';
import { shaderNode, shaderPass } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.stats: asynchronous GPU reduction (8x8 block chain, no read-back): mean vector, maximum length, normalized length. */
export default shaderNode({
  id: 'vector.stats',
  title: 'Vector Stats',
  description: 'Measures a vector field on the GPU without any read-back: mean vector, maximum length and the length normalized by the maximum (auto-range for Visualize / Advect).',
  keywords: ['vector', 'stats', 'statistics', 'max', 'mean', 'average', 'normalize', 'auto', 'range', 'reduction'],
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  required: ['input'],
  outputs: [{ id: 'mean', name: 'Mean vector', type: 'vector' }, { id: 'max', name: 'Max length', type: 'gray' }, { id: 'normalized', name: 'Normalized length', type: 'gray' }],
  params: [P.float('gain', 1, { group: 'Output', label: 'Gain', min: 0, max: 1000, softMax: 10, step: 0.01, tooltip: 'Multiplies the Max length output.' })],
  cost: { gpu: 'low', tiling: 'global' },
  variantDefines: [{ MODE: 0, TEX: 1 }, { MODE: 1, TEX: 1 }, { MODE: 2, TEX: 2, OUT: 0 }, { MODE: 2, TEX: 2, OUT: 1 }, { MODE: 2, TEX: 2, OUT: 2 }],
  gallery: [{ name: 'Default', params: {} }],
  shader: src,
  evaluate(ctx, rt) {
    const input = ctx.texInput('input');
    if (!input) throw new Error('Vector Stats needs a Vector input.');
    const vals = rt.values(ctx);
    // chain of 8x8 block reductions down to 1x1: (mean x, mean y, max length, 0)
    let cur = input.tex;
    let w = input.width;
    let h = input.height;
    let first = true;
    for (let guard = 0; guard < 8 && (w > 1 || h > 1 || first); guard++) {
      w = Math.max(1, Math.ceil(w / 8));
      h = Math.max(1, Math.ceil(h / 8));
      const next = ctx.tex('color', w, h);
      shaderPass(ctx, rt, 'vector stats reduce', next, [cur], vals, { MODE: first ? 0 : 1 });
      cur = next;
      first = false;
    }
    const res: Record<string, ReturnType<typeof ctx.result>> = {};
    for (const [pin, type, code] of [['mean', 'vector', 0], ['max', 'gray', 1], ['normalized', 'gray', 2]] as const) {
      if (!ctx.wants(pin)) continue;
      const out = ctx.tex(type);
      shaderPass(ctx, rt, `vector stats ${pin}`, out, [cur, input.tex], vals, { MODE: 2, OUT: code });
      const r = ctx.result(out, type);
      if (type === 'vector') r.vecScale = input.vecScale ?? 1;
      res[pin] = r;
    }
    return res;
  },
});

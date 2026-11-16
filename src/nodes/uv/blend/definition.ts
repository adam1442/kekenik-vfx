import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { uvInParam, uvModeIndex, uvOutParam } from '../../_shared/uvparams';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('uv_blend.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'scale_a', type: 'f32' },
  { name: 'scale_b', type: 'f32' },
  { name: 'opacity', type: 'f32' },
  { name: 'refv', type: 'f32' },
  { name: 'op', type: 'u32' },
  { name: 'has_b', type: 'u32' },
  { name: 'has_mask', type: 'u32' },
  { name: 'mode_a', type: 'u32' },
  { name: 'mode_b', type: 'u32' },
  { name: 'uv_mode', type: 'u32' },
]);
export const BLEND_OPS = ['mix', 'add', 'subtract', 'multiply', 'compose', 'max'] as const;

/** CPU mirror of the blend on deltas (used by tests). `dbAt` = B's delta sampled at uv + dA (compose only). */
export function blendDeltas(op: (typeof BLEND_OPS)[number], da: [number, number], db: [number, number], w: number, ref: number, dbAt?: [number, number]): [number, number] {
  let c: [number, number] = da;
  switch (op) {
    case 'mix':
      return [da[0] + (db[0] - da[0]) * w, da[1] + (db[1] - da[1]) * w];
    case 'add': c = [da[0] + db[0], da[1] + db[1]]; break;
    case 'subtract': c = [da[0] - db[0], da[1] - db[1]]; break;
    case 'multiply': c = [(da[0] * db[0]) / ref, (da[1] * db[1]) / ref]; break;
    case 'compose': c = dbAt ? [da[0] + dbAt[0], da[1] + dbAt[1]] : da; break;
    case 'max': c = db[0] * db[0] + db[1] * db[1] > da[0] * da[0] + da[1] * da[1] ? db : da; break;
  }
  return [da[0] + (c[0] - da[0]) * w, da[1] + (c[1] - da[1]) * w];
}

/** uv.blend — blend / add / multiply / compose two UV fields (on deltas, so it is mode independent). */
export default defineNode({
  id: 'uv.blend',
  version: 1,
  category: 'uv',
  title: 'UV Blend',
  description: 'Combines two UV fields: mix, add, subtract, multiply, compose (B applied after A) or strongest wins, with opacity and an optional Gray mask.',
  keywords: ['uv', 'blend', 'combine', 'add', 'multiply', 'compose', 'mix', 'merge warps'],
  icon: 'blend',
  inputs: [
    { id: 'a', name: 'A', type: 'uv' },
    { id: 'b', name: 'B', type: 'uv', optional: true },
    { id: 'mask', name: 'Mask', type: 'gray', optional: true },
  ],
  outputs: [{ id: 'output', name: 'UV', type: 'uv' }],
  params: [
    P.enum('op', 'add', BLEND_OPS.map((v) => ({ value: v, label: { mix: 'Mix', add: 'Add', subtract: 'Subtract', multiply: 'Multiply (A x B / reference)', compose: 'Compose (B after A)', max: 'Strongest wins' }[v] })), { group: 'Blend', label: 'Operation' }),
    P.float('opacity', 1, { group: 'Blend', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Mixes between A and the operation result.' }),
    P.float('scale_a', 1, { group: 'Blend', label: 'Scale A', min: -16, max: 16, softMin: -2, softMax: 2, step: 0.01, animatable: true }),
    P.float('scale_b', 1, { group: 'Blend', label: 'Scale B', min: -16, max: 16, softMin: -2, softMax: 2, step: 0.01, animatable: true }),
    P.float('reference', 0.1, { group: 'Blend', min: 0.0001, max: 4, softMax: 1, step: 0.001, display: 'percent', visibleIf: (v) => v.op === 'multiply', tooltip: 'Multiply: B offsets of this size leave A unchanged (x1).' }),
    uvInParam('uv_in_a', 'Input A mode'),
    uvInParam('uv_in_b', 'Input B mode'),
    uvOutParam(),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'global' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [{ name: 'Compose', params: { op: 'compose' } }, { name: 'Mix 50%', params: { op: 'mix', opacity: 0.5 } }],
  evaluate(ctx) {
    const a = ctx.texInput('a');
    if (!a) throw new Error('UV Blend needs input A');
    const b = ctx.texInput('b');
    const mask = ctx.texInput('mask');
    const p = ctx.params;
    const out = ctx.tex('uv');
    ctx.pass({
      label: 'uv blend',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { scale_a: p.num('scale_a'), scale_b: p.num('scale_b'), opacity: p.num('opacity'), refv: p.num('reference'), op: p.enumIndex('op'), has_b: !!b, has_mask: !!mask, mode_a: uvModeIndex(p.str('uv_in_a')), mode_b: uvModeIndex(p.str('uv_in_b')), uv_mode: uvModeIndex(p.str('uv_out')) } },
      textures: [a.tex, b?.tex ?? null, mask?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'uv') };
  },
});

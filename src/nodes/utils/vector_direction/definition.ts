import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_vector_direction.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'offset', type: 'f32' }, { name: 'unsigned_out', type: 'u32' }]);

/** utils.vector_direction: stateless Vector utility. See CONTRACTS section 15. */
export default defineNode({
  id: 'utils.vector_direction',
  version: 1,
  category: 'utils',
  title: 'Vector Direction',
  description: 'Angle of a Vector field as a Gray texture: atan2(y, x) mapped to 0..1 (turns), optionally offset and wrapped.',
  keywords: ['vector','direction','angle','atan'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  outputs: [{ id: 'output', name: 'Gray', type: 'gray' }],
  params: [
    P.float('offset', 0, { group: 'Vector', label: 'Offset', display: 'angle', min: -360, max: 360, step: 1, animatable: true, tooltip: 'Rotates the zero direction (degrees).' }),
    P.bool('unsigned', true, { group: 'Vector', label: 'Unsigned 0..1', tooltip: 'On: 0..1 turns. Off: -0.5..0.5.' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'halo', halo: () => 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Vector Direction needs an input');
    const p = ctx.params;
    const out = ctx.tex('gray');
    ctx.pass({ label: 'vector_direction', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { offset: p.num('offset') / 360, unsigned_out: p.bool('unsigned') } }, textures: [src.tex], ss: 1 });
    const r = ctx.result(out, 'gray');
    if (r.pin === 'vector') r.vecScale = src.vecScale;
    return { output: r };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_vector_visualize.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'mode', type: 'u32' }, { name: 'scale', type: 'f32' }]);

/** utils.vector_visualize: stateless Vector utility. See CONTRACTS section 15. */
export default defineNode({
  id: 'utils.vector_visualize',
  version: 1,
  category: 'utils',
  title: 'Vector Visualize',
  description: 'Vector field to Color for display / export: colour wheel (angle = hue, magnitude = value), signed red / green, or biased 0.5 encoding.',
  keywords: ['vector','visualize','wheel','flow','color'],
  icon: 'warp',
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  outputs: [{ id: 'output', name: 'Color', type: 'color' }],
  params: [
    P.enum('mode', 'wheel', [{ value: 'wheel', label: 'Color wheel' }, { value: 'signed', label: 'Signed R / G' }, { value: 'biased', label: 'Biased (0.5 = 0)' }], { group: 'Vector', label: 'Mode', tooltip: 'Wheel: angle = hue, magnitude = value. Biased: v / scale * 0.5 + 0.5.' }),
    P.float('scale', 1, { group: 'Vector', label: 'Scale', min: 0.0001, max: 1000, softMax: 10, step: 0.01, animatable: true, tooltip: 'Magnitude that maps to full brightness (tile fractions per second).' }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'halo', halo: () => 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Vector Visualize needs an input');
    const p = ctx.params;
    const out = ctx.tex('color');
    ctx.pass({ label: 'vector_visualize', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { mode: p.enumIndex('mode'), scale: p.num('scale') } }, textures: [src.tex], ss: 1 });
    const r = ctx.result(out, 'color');
    if (r.pin === 'vector') r.vecScale = src.vecScale;
    return { output: r };
  },
});

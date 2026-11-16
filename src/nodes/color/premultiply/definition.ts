import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * color.premultiply: alpha conventions in one node. Modes: premultiply (rgb *= a), unpremultiply (rgb /= a, safe where
 * a is tiny), additive (rgb *= a and a = 0: bake the opacity into the emission for additive engines) and opaque (a = 1, rgb kept).
 * HDR-safe (no clamping), per-pixel, tiling-safe. Use before export to choose premultiplied vs straight alpha deliberately.
 */
export const SHADER = defineShader('color_premultiply.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'mode', type: 'u32' },
  { name: 'epsilon', type: 'f32' },
]);

export const PREMULT_MODES = ['premultiply', 'unpremultiply', 'additive', 'opaque'] as const;
/** CPU reference: [r,g,b,a] -> [r,g,b,a]. */
export function premultRef(mode: (typeof PREMULT_MODES)[number], c: number[], epsilon = 1e-4): number[] {
  const [r, g, b, a] = c;
  switch (mode) {
    case 'premultiply': return [r * a, g * a, b * a, a];
    case 'unpremultiply': { const s = a > epsilon ? 1 / a : 0; return [r * s, g * s, b * s, a]; }
    case 'additive': return [r * a, g * a, b * a, 0];
    case 'opaque': return [r, g, b, 1];
  }
}

export default defineNode({
  id: 'color.premultiply',
  version: 1,
  category: 'color',
  title: 'Premultiply Alpha',
  description: 'Premultiply, unpremultiply, bake alpha into emission (additive) or force opaque: choose the alpha convention of an export deliberately. HDR-safe.',
  keywords: ['premultiply', 'unpremultiply', 'straight alpha', 'alpha', 'fringe', 'additive', 'emission', 'opaque'],
  icon: 'adjust',
  inputs: [{ id: 'input', name: 'Input', type: 'color' }],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: false },
  params: [
    P.enum(
      'mode',
      'premultiply',
      [
        { value: 'premultiply', label: 'Premultiply', tooltip: 'rgb = rgb * a' },
        { value: 'unpremultiply', label: 'Unpremultiply', tooltip: 'rgb = rgb / a (0 where a is tiny)' },
        { value: 'additive', label: 'Additive (bake alpha, a = 0)', tooltip: 'rgb = rgb * a, alpha = 0: pure emission for additive blending' },
        { value: 'opaque', label: 'Opaque (a = 1)', tooltip: 'Keeps rgb, alpha = 1' },
      ],
      { group: 'Alpha', label: 'Mode' },
    ),
    P.float('epsilon', 0.0001, { group: 'Alpha', min: 0, max: 0.1, step: 0.0001, advanced: true, visibleIf: (v) => v.mode === 'unpremultiply', tooltip: 'Alpha below this is treated as 0 when unpremultiplying.' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Premultiply Alpha needs an input.');
    const out = ctx.tex('color');
    ctx.pass({
      label: 'premultiply',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { mode: ctx.params.enumIndex('mode'), epsilon: ctx.params.num('epsilon') } },
      textures: [src.tex],
      ss: 1,
    });
    return { output: ctx.result(out, 'color') };
  },
});

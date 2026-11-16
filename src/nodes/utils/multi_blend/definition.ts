import { BLEND_MODES } from '../../../engine/graph/common-params';
import { defineNode } from '../../../engine/graph/node';
import { P, type ParamDef } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout, type UField } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.multi_blend — N layers (up to 8) with per-layer blend mode, opacity and enable flag, composited over an optional
 * Base. DYNAMIC PINS decision: the engine has fixed pin lists per definition, so the node exposes 8 optional layer pins
 * and the `Layers` count decides how many are used (unconnected or disabled layers cost nothing: one `layer_mask`
 * bit test). Bump the constant MAX_LAYERS + the unrolled WGSL if more are ever needed.
 */
export const MAX_LAYERS = 8;
export const SHADER = defineShader('utils_multi_blend.wgsl', shaderSrc);
const fields: UField[] = [{ name: 'layer_mask', type: 'u32' }, { name: 'has_base', type: 'u32' }, { name: 'smoothness', type: 'f32' }, { name: 'clamp_output', type: 'u32' }];
for (let i = 0; i < MAX_LAYERS; i++) fields.push({ name: `mode${i}`, type: 'u32' }, { name: `op${i}`, type: 'f32' });
export const LAYOUT = makeLayout(fields);

export default variants((k) => {
  const layerParams: ParamDef[] = [];
  for (let i = 1; i <= MAX_LAYERS; i++) {
    const g = `Layer ${i}`;
    const vis = (v: Record<string, unknown>): boolean => (v.layers as number) >= i;
    layerParams.push(
      P.bool(`enabled_${i}`, true, { group: g, label: 'Enabled', visibleIf: vis }),
      P.enum(`mode_${i}`, i === 1 ? 'copy' : 'add', BLEND_MODES, { group: g, label: 'Blend type', visibleIf: vis }),
      P.float(`opacity_${i}`, 1, { group: g, label: 'Opacity', display: 'percent', min: 0, max: 1, step: 0.01, animatable: true, visibleIf: vis }),
    );
  }
  return defineNode({
    id: idOf('utils.multi_blend', k),
    version: 1,
    category: 'utils',
    title: titleOf('Multi Blend', k),
    description: 'Composites up to 8 layers over a base, each with its own blend mode and opacity.',
    keywords: ['layers', 'stack', 'composite', 'merge', 'multi', 'blend'],
    icon: 'blend',
    inputs: [
      { id: 'base', name: 'Base', type: pinOf(k), optional: true },
      ...Array.from({ length: MAX_LAYERS }, (_, i) => ({ id: `layer_${i + 1}`, name: `Layer ${i + 1}`, type: pinOf(k), optional: true })),
    ],
    outputs: [{ id: 'output', name: 'Output', type: pinOf(k) }],
    params: [
      P.int('layers', 3, { group: 'Layers', min: 1, max: MAX_LAYERS, tooltip: 'Number of layers that take part (the pins stay visible; unused ones are ignored).' }),
      P.float('smoothness', 0.1, { group: 'Layers', min: 0, max: 1, step: 0.01, tooltip: 'Used by smooth min / max layers.' }),
      P.bool('clamp_output', false, { group: 'Layers', label: 'Clamp 0..1' }),
      ...layerParams,
    ],
    cost: { gpu: 'low', tiling: 'pixel' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 + MAX_LAYERS, defines: { GRAY: k === 'gray' ? 1 : 0 } }],
    gallery: [{ name: 'Add + multiply', params: { layers: 2, mode_1: 'add', mode_2: 'multiply' } }],
    evaluate(ctx) {
      const p = ctx.params;
      const base = ctx.texInput('base');
      const layers = p.int('layers');
      let mask = 0;
      const values: Record<string, number | boolean> = { has_base: !!base, smoothness: p.num('smoothness'), clamp_output: p.bool('clamp_output'), layer_mask: 0 };
      const textures = [base?.tex ?? null];
      for (let i = 1; i <= MAX_LAYERS; i++) {
        const t = ctx.texInput(`layer_${i}`);
        textures.push(t?.tex ?? null);
        if (t && i <= layers && p.bool(`enabled_${i}`)) mask |= 1 << (i - 1);
        values[`mode${i - 1}`] = p.enumIndex(`mode_${i}`);
        values[`op${i - 1}`] = p.num(`opacity_${i}`);
      }
      values.layer_mask = mask;
      const out = ctx.tex(pinOf(k));
      ctx.pass({ label: 'multi blend', target: out, shader: SHADER, defines: { GRAY: k === 'gray' ? 1 : 0 }, uniforms: { layout: LAYOUT, values }, textures, ss: 1 });
      return { output: ctx.result(out, pinOf(k)) };
    },
  });
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** color.replace — t0 input. Outputs: Color and the Gray replacement mask. */
export const SHADER = defineShader('color_replace.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'source', type: 'vec4f' },
  { name: 'repl', type: 'vec4f' },
  { name: 'tolerance', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'strength', type: 'f32' },
  { name: 'keep_lightness', type: 'f32' },
  { name: 'ignore_lum', type: 'u32' },
  { name: 'mode', type: 'u32' },
]);

export default defineNode({
  id: 'color.replace',
  version: 1,
  category: 'color',
  title: 'Replace Color',
  description: 'Replaces a source colour by a new colour. Tolerance and softness are OKLab distances; optionally keeps the lightness variation of the original. Second output: the replacement mask.',
  keywords: ['replace', 'swap', 'key', 'chroma', 'recolor', 'select color', 'mask'],
  icon: 'adjust',
  inputs: [{ id: 'input', name: 'Input', type: 'color' }],
  outputs: [
    { id: 'output', name: 'Output', type: 'color' },
    { id: 'mask', name: 'Mask', type: 'gray', tooltip: 'How strongly each pixel matched the source colour.' },
  ],
  params: [
    P.color('source', [0.8, 0.1, 0.05, 1], { group: 'Replace', label: 'Source color', hdr: true, animatable: true }),
    P.color('target', [0.05, 0.4, 1, 1], { group: 'Replace', label: 'New color', hdr: true, animatable: true }),
    P.float('tolerance', 0.12, { group: 'Match', min: 0, max: 2, softMax: 0.6, step: 0.005, animatable: true, tooltip: 'OKLab distance that is replaced completely.' }),
    P.float('softness', 0.12, { group: 'Match', min: 0, max: 2, softMax: 0.6, step: 0.005, animatable: true, tooltip: 'Extra distance over which the replacement fades out.' }),
    P.bool('ignore_lum', false, { group: 'Match', label: 'Ignore lightness', tooltip: 'Match hue / chroma only.' }),
    P.float('keep_lightness', 1, { group: 'Result', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Keeps the lightness difference between the pixel and the source colour.' }),
    P.float('strength', 1, { group: 'Result', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  gallery: [
    { name: 'Wide tolerance', params: { tolerance: 0.35, softness: 0.3 } },
    { name: 'Ignore lightness', params: { ignore_lum: true, tolerance: 0.15 } },
    { name: 'Flat result', params: { keep_lightness: 0 } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Replace Color needs a Color input');
    const p = ctx.params;
    const out = ctx.tex('color');
    const mask = ctx.tex('gray');
    const base = { source: p.rgba('source'), repl: p.rgba('target'), tolerance: p.num('tolerance'), softness: p.num('softness'), strength: p.num('strength'), keep_lightness: p.num('keep_lightness'), ignore_lum: p.bool('ignore_lum') };
    ctx.pass({ label: 'replace', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...base, mode: 0 } }, textures: [src.tex], ss: 1 });
    ctx.pass({ label: 'replace mask', target: mask, shader: SHADER, uniforms: { layout: LAYOUT, values: { ...base, mode: 1 } }, textures: [src.tex], ss: 1 });
    return { output: ctx.result(out, 'color'), mask: ctx.result(mask, 'gray') };
  },
});

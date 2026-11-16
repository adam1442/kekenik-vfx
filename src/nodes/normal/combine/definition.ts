import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('normal_combine.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'mode', type: 'u32' },
  { name: 'detail_strength', type: 'f32' },
  { name: 'opacity', type: 'f32' },
  { name: 'has_detail', type: 'u32' },
  { name: 'has_mask', type: 'u32' },
]);
export const COMBINE_MODES = ['reoriented', 'detail', 'whiteout', 'linear', 'partial'] as const;

type V3 = [number, number, number];
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** CPU mirror of the blend (decoded unit vectors in, unit vector out; no opacity). */
export function combineNormals(b: V3, dIn: V3, mode: (typeof COMBINE_MODES)[number], detailStrength = 1): V3 {
  const d = norm([dIn[0] * detailStrength, dIn[1] * detailStrength, dIn[2]]);
  switch (mode) {
    case 'reoriented': {
      const t: V3 = [b[0], b[1], b[2] + 1];
      const u: V3 = [-d[0], -d[1], d[2]];
      const k = (t[0] * u[0] + t[1] * u[1] + t[2] * u[2]) / t[2];
      return norm([t[0] * k - u[0], t[1] * k - u[1], t[2] * k - u[2]]);
    }
    case 'detail': return norm([b[0] + d[0], b[1] + d[1], b[2]]);
    case 'whiteout': return norm([b[0] + d[0], b[1] + d[1], b[2] * d[2]]);
    case 'linear': return norm([b[0] + d[0], b[1] + d[1], b[2] + d[2]]);
    case 'partial': return norm([b[0] * d[2] + d[0] * b[2], b[1] * d[2] + d[1] * b[2], b[2] * d[2]]);
  }
}

/** normal.combine — Reoriented Normal Mapping, UDN detail, whiteout, linear and partial-derivative blending. */
export default defineNode({
  id: 'normal.combine',
  version: 1,
  category: 'normal',
  title: 'Normal Combine',
  description: 'Blends a detail normal map onto a base normal map: reoriented normal mapping (RNM), UDN detail, whiteout, linear and partial derivative, with detail strength, opacity and a mask.',
  keywords: ['normal', 'combine', 'blend', 'rnm', 'reoriented', 'detail', 'whiteout', 'udn', 'merge'],
  icon: 'blend',
  inputs: [
    { id: 'base', name: 'Base', type: 'normal' },
    { id: 'detail', name: 'Detail', type: 'normal', optional: true },
    { id: 'mask', name: 'Mask', type: 'gray', optional: true },
  ],
  outputs: [{ id: 'output', name: 'Normal', type: 'normal' }],
  params: [
    P.enum('mode', 'reoriented', [{ value: 'reoriented', label: 'Reoriented (RNM)' }, { value: 'detail', label: 'Detail (UDN)' }, { value: 'whiteout', label: 'Whiteout' }, { value: 'linear', label: 'Linear' }, { value: 'partial', label: 'Partial derivative' }], { group: 'Combine', label: 'Blend mode' }),
    P.float('detail_strength', 1, { group: 'Combine', min: 0, max: 8, softMax: 2, step: 0.01, animatable: true, tooltip: 'Scales the slope of the detail normals.' }),
    P.float('opacity', 1, { group: 'Combine', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true }),
  ],
  common: { texture: true, blending: false },
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [{ name: 'UDN detail', params: { mode: 'detail' } }, { name: 'Strong detail', params: { detail_strength: 2 } }],
  evaluate(ctx) {
    const base = ctx.texInput('base');
    if (!base) throw new Error('Normal Combine needs a base normal map');
    const detail = ctx.texInput('detail');
    const mask = ctx.texInput('mask');
    const p = ctx.params;
    const out = ctx.tex('normal');
    ctx.pass({
      label: 'normal combine',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { mode: p.enumIndex('mode'), detail_strength: p.num('detail_strength'), opacity: p.num('opacity'), has_detail: !!detail, has_mask: !!mask } },
      textures: [base.tex, detail?.tex ?? null, mask?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'normal') };
  },
});

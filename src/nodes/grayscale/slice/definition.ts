import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.slice — t0 input, t1 centre modulation. */
export const SHADER = defineShader('grayscale_slice.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'f32' },
  { name: 'center_mod_k', type: 'f32' },
  { name: 'width', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'spacing', type: 'f32' },
  { name: 'bands', type: 'i32' },
  { name: 'profile', type: 'u32' },
  { name: 'invert', type: 'u32' },
]);

/** CPU reference of the band function for tests. */
export function sliceReference(v: number, o: { center: number; width: number; softness: number; spacing: number; bands: number; ramp?: boolean }): number {
  const nb = Math.max(o.bands, 1);
  const first = o.center - 0.5 * (nb - 1) * o.spacing;
  const idx = nb > 1 ? Math.min(Math.max(Math.round((v - first) / Math.max(Math.abs(o.spacing), 1e-5)), 0), nb - 1) : 0;
  const d = Math.abs(v - (first + idx * o.spacing));
  const hw = Math.max(0.5 * o.width, 1e-5);
  if (o.ramp) return 1 - Math.min(Math.max(d / hw, 0), 1);
  const e0 = hw * (1 - o.softness);
  const e1 = hw * (1 + o.softness) + 1e-6;
  const t = Math.min(Math.max((d - e0) / (e1 - e0), 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

export default defineNode({
  id: 'grayscale.slice',
  version: 1,
  category: 'grayscale',
  title: 'Slice',
  description: 'Extracts one or several iso-bands of a heightmap: everything within `width` of the band centre becomes white. Contour lines, terraces and rim masks.',
  keywords: ['iso', 'band', 'contour', 'isoline', 'range', 'window', 'terrace'],
  icon: 'slice',
  inputs: [{ id: 'input', name: 'Input', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.float('center', 0.5, { group: 'Band', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.005, animatable: true, modulatable: true, tooltip: 'Height of the (first) band centre.' }),
    P.float('width', 0.1, { group: 'Band', min: 0, max: 16, softMax: 1, step: 0.005, animatable: true, tooltip: 'Full width of a band.' }),
    P.float('softness', 0.2, { group: 'Band', min: 0, max: 1, display: 'percent', step: 0.01, animatable: true, visibleIf: (v) => v.profile === 'flat', tooltip: 'Soft edge as a fraction of the half width.' }),
    P.enum('profile', 'flat', [{ value: 'flat', label: 'Flat' }, { value: 'ramp', label: 'Ramp' }], { group: 'Band', tooltip: 'Flat = constant inside the band, Ramp = peak at the centre.' }),
    P.int('bands', 1, { group: 'Multiple bands', min: 1, max: 64, softMax: 16, tooltip: 'Number of bands (centred around "Center").' }),
    P.float('spacing', 0.2, { group: 'Multiple bands', min: 0, max: 16, softMax: 1, step: 0.005, animatable: true, visibleIf: (v) => (v.bands as number) > 1, tooltip: 'Distance between neighbouring band centres.' }),
    P.bool('invert', false, { group: 'Output' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Contours', params: { bands: 8, spacing: 0.1, width: 0.015, softness: 0.4, center: 0.5 } },
    { name: 'Wide band', params: { width: 0.35, softness: 0.6 } },
    { name: 'Ramp bands', params: { bands: 3, spacing: 0.25, width: 0.2, profile: 'ramp' } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Slice needs an input');
    const out = ctx.tex('gray');
    const p = ctx.params;
    const mod = ctx.mod('center');
    ctx.pass({
      label: 'slice',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: { center: p.num('center'), center_mod_k: mod.k, width: p.num('width'), softness: p.num('softness'), spacing: p.num('spacing'), bands: p.int('bands'), profile: p.enumIndex('profile'), invert: p.bool('invert') },
      },
      textures: [src.tex, mod.tex?.tex ?? null],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});

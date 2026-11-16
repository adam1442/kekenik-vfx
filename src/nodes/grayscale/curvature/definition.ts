import { defineNode, type GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { BLUR_DECL, gaussianBlur } from '../../_shared/blur';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.curvature — convex / concave / both from a heightmap, `radius` = scale of the feature (gaussian sigma = radius / 2). */
export const SHADER = defineShader('grayscale_curvature.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'kind', type: 'u32' },
  { name: 'gain', type: 'f32' },
  { name: 'invert', type: 'u32' },
]);
export const KINDS = ['convex', 'concave', 'both'] as const;
export const gizmos: GizmoDecl[] = [{ id: 'radius', label: 'Curvature radius', type: 'circle', viewport: '2d', space: 'uv', radius: 'radius' }];

export default defineNode({
  id: 'grayscale.curvature',
  version: 1,
  category: 'grayscale',
  title: 'Curvature',
  description: 'Detects convex (edges, ridges, hills) and concave (creases, pits) areas of a heightmap. The radius sets the feature size that is detected.',
  keywords: ['edge', 'convex', 'concave', 'cavity', 'wear', 'laplacian', 'ridge', 'height'],
  icon: 'edge',
  inputs: [{ id: 'input', name: 'Height', type: 'gray' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  params: [
    P.enum('kind', 'both', [{ value: 'convex', label: 'Convex' }, { value: 'concave', label: 'Concave' }, { value: 'both', label: 'Both (50% = flat)' }], { group: 'Curvature', label: 'Type' }),
    P.float('radius', 0.01, { group: 'Curvature', min: 0.0005, max: 0.2, softMax: 0.05, step: 0.0005, display: 'percent', animatable: true, tooltip: 'Feature scale as a fraction of the smaller image side.' }),
    P.float('intensity', 1, { group: 'Curvature', min: 0, max: 100, softMax: 8, step: 0.01, animatable: true, tooltip: 'Gain applied to the detected curvature.' }),
    P.bool('invert', false, { group: 'Curvature' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'halo', halo: (v) => Math.ceil((v.radius as number) * 8192 * 1.5) + 2, temporaries: 2 },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }, BLUR_DECL],
  gallery: [
    { name: 'Convex', params: { kind: 'convex', intensity: 4 } },
    { name: 'Concave', params: { kind: 'concave', intensity: 4 } },
    { name: 'Fine detail', params: { radius: 0.003, intensity: 3 } },
    { name: 'Broad', params: { radius: 0.04, intensity: 2 } },
  ],
  evaluate(ctx) {
    const src = ctx.texInput('input');
    if (!src) throw new Error('Curvature needs a height input');
    const p = ctx.params;
    const sigma = Math.max((p.num('radius') * Math.min(ctx.frame.width, ctx.frame.height)) / 2, 0.4);
    const blurred = gaussianBlur(ctx, src.tex, 'gray', sigma);
    const out = ctx.tex('gray');
    ctx.pass({
      label: 'curvature',
      target: out,
      shader: SHADER,
      uniforms: { layout: LAYOUT, values: { kind: p.enumIndex('kind'), gain: p.num('intensity') * 4, invert: p.bool('invert') } },
      textures: [src.tex, blurred],
      ss: 1,
    });
    return { output: ctx.result(out, 'gray') };
  },
});

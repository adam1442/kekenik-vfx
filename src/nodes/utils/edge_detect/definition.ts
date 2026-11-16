import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, kindDefines, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/** utils.edge_detect (Gray in) / utils.edge_detect_color (Color in, luminance) — both output Gray. */
export const SHADER = defineShader('utils_edge_detect.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'kind', type: 'u32' },
  { name: 'width', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'tolerance', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'invert', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.edge_detect', k),
    version: 1,
    category: 'utils',
    title: titleOf('Edge Detect', k),
    description: 'Sobel, Prewitt, Scharr or Laplacian edge detection with width, tolerance and invert. Output is Gray.',
    keywords: ['sobel', 'prewitt', 'laplacian', 'outline', 'edges', 'gradient magnitude'],
    icon: 'edge',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
    params: [
      P.enum('kind', 'sobel', ['sobel', 'prewitt', 'scharr', 'laplacian'], { group: 'Edges' }),
      P.float('width', 0.002, { group: 'Edges', min: 0, max: 0.1, softMax: 0.02, step: 0.0002, display: 'percent', animatable: true, tooltip: 'Tap distance as a fraction of the smaller side (fractional pixels are fine).' }),
      P.float('intensity', 4, { group: 'Edges', min: 0, max: 256, softMax: 16, step: 0.05, animatable: true }),
      P.float('tolerance', 0, { group: 'Edges', min: 0, max: 4, softMax: 1, step: 0.005, animatable: true, tooltip: 'Edges weaker than this are removed (0 = off).' }),
      P.float('softness', 0.1, { group: 'Edges', min: 0, max: 4, softMax: 1, step: 0.005, visibleIf: (v) => (v.tolerance as number) > 0 }),
      P.bool('invert', false, { group: 'Output' }),
    ],
    cost: { gpu: 'low', tiling: 'halo', halo: (v) => Math.ceil((v.width as number) * 8192) + 2 },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1, defines: kindDefines(k) }],
    gallery: [
      { name: 'Laplacian', params: { kind: 'laplacian', intensity: 6 } },
      { name: 'Thick inverted', params: { width: 0.008, invert: true } },
      { name: 'Thresholded', params: { tolerance: 0.5, softness: 0.05 } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Edge Detect needs an input');
      const p = ctx.params;
      const out = ctx.tex('gray');
      ctx.pass({
        label: 'edge detect',
        target: out,
        shader: SHADER,
        defines: kindDefines(k),
        uniforms: { layout: LAYOUT, values: { kind: p.enumIndex('kind'), width: p.num('width'), intensity: p.num('intensity'), tolerance: p.num('tolerance'), softness: p.num('softness'), invert: p.bool('invert') } },
        textures: [src.tex],
        ss: 1,
      });
      return { output: ctx.result(out, 'gray') };
    },
  }),
);

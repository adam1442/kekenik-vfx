import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.grid — generator: square grid, bricks and hex cells as lines, random per-cell values or both. Integer cell counts =>
 * always tileable; per-cell randomness hashes the wrapped cell id. Hex: (cells x, cells y) lattice cells fill the image; the
 * hexagons are regular when Y ~ X * 0.577 (X / Y = sqrt 3). Second output: random id per cell (Gray).
 */
export const SHADER = defineShader('utils_grid.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'cells', type: 'vec2i' },
  { name: 'offset', type: 'vec2f' },
  { name: 'line_width', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'random_amount', type: 'f32' },
  { name: 'line_level', type: 'f32' },
  { name: 'brick_offset', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'pattern', type: 'u32' },
  { name: 'output_kind', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'which', type: 'u32' },
]);

export default defineNode({
  id: 'utils.grid',
  version: 1,
  category: 'utils',
  title: 'Grid',
  description: 'Square grid, bricks or hex cells: lines, random per-cell values, or both. Tileable.',
  keywords: ['grid', 'bricks', 'hex', 'hexagon', 'cells', 'lines', 'checker', 'tiles', 'pattern', 'random per cell'],
  icon: 'grid',
  inputs: [],
  outputs: [
    { id: 'output', name: 'Output', type: 'gray' },
    { id: 'cell_id', name: 'Cell ID', type: 'gray' },
  ],
  common: { texture: true, blending: true },
  params: [
    P.enum('pattern', 'square', [{ value: 'square', label: 'Grid' }, { value: 'bricks', label: 'Bricks' }, { value: 'hex', label: 'Hex' }], { group: 'Grid' }),
    P.vec2('cells', [8, 8], { group: 'Grid', min: 1, max: 512, softMax: 32, step: 1, integer: true, labels: ['X', 'Y'], linkable: true, tooltip: 'Cell counts (whole numbers keep the pattern tileable).' }),
    P.vec2('offset', [0, 0], { group: 'Grid', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
    P.float('brick_offset', 0.5, { group: 'Grid', display: 'percent', min: 0, max: 1, step: 0.01, visibleIf: (v) => v.pattern === 'bricks', tooltip: 'Even row counts keep bricks seamless.' }),
    P.enum('output_kind', 'lines', [{ value: 'lines', label: 'Lines' }, { value: 'cells', label: 'Cells' }, { value: 'cells_lines', label: 'Cells + lines' }], { group: 'Output', label: 'Output' }),
    P.float('line_width', 0.1, { group: 'Lines', display: 'percent', min: 0, max: 1, step: 0.005, animatable: true, tooltip: 'Fraction of the smaller cell side.' }),
    P.float('softness', 0.1, { group: 'Lines', display: 'percent', min: 0, max: 1, step: 0.005, animatable: true }),
    P.float('line_level', 0, { group: 'Lines', min: 0, max: 1, step: 0.01, visibleIf: (v) => v.output_kind === 'cells_lines' }),
    P.float('random_amount', 0.5, { group: 'Cells', label: 'Random per cell', display: 'percent', min: 0, max: 1, step: 0.01, animatable: true, visibleIf: (v) => v.output_kind !== 'lines' }),
    P.seed('seed', 1, { group: 'Cells', visibleIf: (v) => v.output_kind !== 'lines' }),
    P.bool('invert', false, { group: 'Output' }),
  ],
  gizmos: [{ id: 'grid', label: 'Grid cells', type: 'grid', viewport: '2d', space: 'uv', cells: 'cells', offset: 'offset', tilingSafe: true }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT }],
  gallery: [
    { name: 'Bricks', params: { pattern: 'bricks', cells: [6, 12], output_kind: 'cells_lines', line_level: 0 } },
    { name: 'Hex cells', params: { pattern: 'hex', cells: [8, 5], output_kind: 'cells', random_amount: 1 } },
    { name: 'Hex lines', params: { pattern: 'hex', cells: [8, 5] } },
    { name: 'Random cells', params: { output_kind: 'cells', random_amount: 1 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const draw = (which: number) => {
      const t = ctx.tex('gray');
      const [cx, cy] = p.vec2('cells');
      const hex = p.str('pattern') === 'hex';
      ctx.pass({
        label: which ? 'grid cell id' : 'grid',
        target: t,
        shader: SHADER,
        uniforms: {
          layout: LAYOUT,
          values: {
            cells: [Math.max(1, Math.round(cx)), Math.max(1, Math.round(cy))],
            offset: p.vec2('offset'),
            line_width: p.num('line_width'),
            softness: p.num('softness'),
            random_amount: p.num('random_amount'),
            line_level: p.num('line_level'),
            brick_offset: p.num('brick_offset'),
            seed: p.seed('seed') >>> 0,
            pattern: hex ? 2 : p.enumIndex('pattern'),
            output_kind: p.enumIndex('output_kind'),
            invert: p.bool('invert'),
            which,
          },
        },
      });
      return ctx.result(t, 'gray');
    };
    return { output: draw(0), cell_id: draw(1) };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { idOf, pinOf, titleOf, variants } from '../../_shared/variants';
import shaderSrc from './shader.wgsl?raw';

/**
 * utils.tile — repeat the input N x M times. Mirror, brick-style row / column offsets, random offset / rotation / scale /
 * flip per tile (hash of the wrapped tile index => periodic), and a second output with a random id per tile (Gray).
 * With Tiling on, use EVEN counts together with row / column offsets or Mirror (odd counts cannot close the seam).
 */
export const SHADER = defineShader('utils_tile.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'tiles', type: 'vec2i' },
  { name: 'offset', type: 'vec2f' },
  { name: 'row_offset', type: 'f32' },
  { name: 'col_offset', type: 'f32' },
  { name: 'rand_offset', type: 'f32' },
  { name: 'rand_rot', type: 'f32' },
  { name: 'rand_scale', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'mirror', type: 'u32' },
  { name: 'rand_flip', type: 'u32' },
  { name: 'rot90', type: 'u32' },
  { name: 'fill', type: 'u32' },
  { name: 'which', type: 'u32' },
]);

export default variants((k) =>
  defineNode({
    id: idOf('utils.tile', k),
    version: 1,
    category: 'utils',
    title: titleOf('Tile', k),
    description: 'Repeats the input in a grid with mirror, brick offsets and per-tile random offset, rotation, scale and flips. Outputs a tile id.',
    keywords: ['repeat', 'tile', 'mirror', 'brick', 'array', 'pattern', 'random per tile', 'tile id'],
    icon: 'tile',
    common: { texture: true, blending: true },
    inputs: [{ id: 'input', name: 'Input', type: pinOf(k) }],
    outputs: [
      { id: 'output', name: 'Output', type: pinOf(k) },
      { id: 'tile_id', name: 'Tile ID', type: 'gray' },
    ],
    params: [
      P.vec2('tiles', [4, 4], { group: 'Tiles', label: 'Tiles', min: 1, max: 256, softMax: 16, step: 1, integer: true, labels: ['X', 'Y'], linkable: true }),
      P.vec2('offset', [0, 0], { group: 'Tiles', min: -64, max: 64, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
      P.bool('mirror', false, { group: 'Tiles', tooltip: 'Flip every second tile (even counts keep it seamless).' }),
      P.float('row_offset', 0, { group: 'Offsets', label: 'Row offset', min: -1, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Shifts every second row by this fraction of a tile (brick pattern at 50%).' }),
      P.float('col_offset', 0, { group: 'Offsets', label: 'Column offset', min: -1, max: 1, step: 0.01, display: 'percent', animatable: true }),
      P.float('rand_offset', 0, { group: 'Random per tile', label: 'Offset', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true }),
      P.float('rand_rot', 0, { group: 'Random per tile', label: 'Rotation', min: 0, max: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Maximum random rotation (+-).' }),
      P.bool('rot90', false, { group: 'Random per tile', label: 'Random 90° steps' }),
      P.float('rand_scale', 0, { group: 'Random per tile', label: 'Scale', min: 0, max: 0.95, step: 0.01, display: 'percent', animatable: true, tooltip: 'Random scale 1 +- amount.' }),
      P.bool('rand_flip', false, { group: 'Random per tile', label: 'Random flip' }),
      P.seed('seed', 1, { group: 'Random per tile' }),
      P.enum('fill', 'wrap', [{ value: 'wrap', label: 'Wrap (fill)' }, { value: 'empty', label: 'Empty gaps' }], { group: 'Random per tile', label: 'Outside tile', tooltip: 'What a rotated / scaled tile shows outside its own area.' }),
    ],
    gizmos: [{ id: 'grid', label: 'Tiles', type: 'grid', viewport: '2d', space: 'uv', cells: 'tiles', offset: 'offset', tilingSafe: true }],
    cost: { gpu: 'low', tiling: 'pixel' },
    shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
    gallery: [
      { name: 'Brick', params: { row_offset: 0.5, tiles: [4, 4] } },
      { name: 'Random rotation', params: { rand_rot: 180, rand_scale: 0.3, fill: 'empty' } },
      { name: 'Mirror', params: { mirror: true } },
    ],
    evaluate(ctx) {
      const src = ctx.texInput('input');
      if (!src) throw new Error('Tile needs an input');
      const p = ctx.params;
      const draw = (which: number, pin: 'gray' | 'color') => {
        const t = ctx.tex(pin);
        const [tx, ty] = p.vec2('tiles');
        ctx.pass({
          label: which ? 'tile id' : 'tile',
          target: t,
          shader: SHADER,
          uniforms: {
            layout: LAYOUT,
            values: {
              tiles: [Math.max(1, Math.round(tx)), Math.max(1, Math.round(ty))],
              offset: p.vec2('offset'),
              row_offset: p.num('row_offset'),
              col_offset: p.num('col_offset'),
              rand_offset: p.num('rand_offset'),
              rand_rot: (p.num('rand_rot') * Math.PI) / 180,
              rand_scale: p.num('rand_scale'),
              seed: p.seed('seed') >>> 0,
              mirror: p.bool('mirror'),
              rand_flip: p.bool('rand_flip'),
              rot90: p.bool('rot90'),
              fill: p.enumIndex('fill'),
              which,
            },
          },
          textures: [src.tex],
        });
        return ctx.result(t, pin);
      };
      return { output: draw(0, pinOf(k) as 'gray'), tile_id: draw(1, 'gray') };
    },
  }),
);

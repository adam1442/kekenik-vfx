import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

/**
 * grayscale.rune_ring: procedural glyph / rune ring. `count` glyphs around a circle; every glyph is a random set of `complexity`
 * line segments between the nodes of a `grid` x `grid` lattice (optionally mirrored about the radial axis and with a vertical stem), drawn as
 * round-capped strokes of `stroke` width. Optional inner / outer border circles, per-glyph brightness flicker and a `reveal` parameter
 * (0 -> 1) that draws the glyphs in one by one (build-up). Glyph shapes depend on seed + glyph index only, so they never change while you animate
 * `rotation` (loop: rotate by 360 or by a multiple of 360 / count degrees). Distances are measured in pixels of the full image; one glyph is
 * evaluated per pixel (cheap). Tiling: drawn in the periodic image nearest to the centre. Limitations: glyphs are abstract (no real alphabet).
 */
export const SHADER = defineShader('grayscale_rune_ring.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'radius', type: 'f32' },
  { name: 'glyph_height', type: 'f32' },
  { name: 'count', type: 'i32' },
  { name: 'gap', type: 'f32' },
  { name: 'stroke', type: 'f32' },
  { name: 'softness', type: 'f32' },
  { name: 'complexity', type: 'i32' },
  { name: 'grid', type: 'i32' },
  { name: 'stem', type: 'u32' },
  { name: 'mirror', type: 'u32' },
  { name: 'rotation', type: 'f32' },
  { name: 'ring_lines', type: 'u32' },
  { name: 'flicker', type: 'f32' },
  { name: 'reveal', type: 'f32' },
  { name: 'intensity', type: 'f32' },
  { name: 'intensity_mod_k', type: 'f32' },
  { name: 'seed', type: 'u32' },
  { name: 'invert', type: 'u32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'uv_amount', type: 'f32' },
]);

/** Lattice node (in units of the glyph box size `s`, centred) for node index `idx` of a g x g lattice. Shared by the shader logic and tests. */
export function glyphNode(idx: number, g: number): [number, number] {
  const den = Math.max(g - 1, 1);
  return [((idx % g) / den) - 0.5, (Math.floor(idx / g) / den) - 0.5];
}

export default defineNode({
  id: 'grayscale.rune_ring',
  version: 1,
  category: 'grayscale',
  title: 'Rune Ring',
  description: 'Procedural rune / glyph ring for magic circles: random stroke glyphs on a circle, optional border lines, flicker, rotation and a reveal that draws the runes in one by one.',
  keywords: ['rune', 'glyph', 'magic circle', 'symbol', 'ring', 'spell', 'sigil', 'alphabet', 'text', 'ritual', 'seal'],
  icon: 'polar',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the ring is looked up through it (warp / deform).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.vec2('center', [0.5, 0.5], { group: 'Ring', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true }),
    P.float('radius', 0.36, { group: 'Ring', min: 0.01, max: 4, softMax: 0.6, step: 0.002, display: 'percent', animatable: true, tooltip: 'Radius of the glyph band centre (fraction of the smaller side).' }),
    P.float('glyph_height', 0.1, { group: 'Ring', label: 'Glyph size', min: 0.004, max: 1, softMax: 0.3, step: 0.002, display: 'percent', animatable: true, tooltip: 'Radial size of the glyph box.' }),
    P.int('count', 24, { group: 'Ring', min: 1, max: 128, softMax: 48, tooltip: 'Glyphs around the circle.' }),
    P.float('gap', 0.3, { group: 'Ring', min: 0, max: 0.9, step: 0.01, display: 'percent', tooltip: 'Empty fraction of every glyph cell (spacing between neighbours).' }),
    P.float('rotation', 0, { group: 'Ring', min: -36000, max: 36000, softMin: -360, softMax: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Rotates the ring. Loop: 360 (or a multiple of 360 / count) per cycle.' }),
    P.float('stroke', 0.008, { group: 'Stroke', min: 0.0005, max: 0.2, softMax: 0.03, step: 0.0005, display: 'percent', animatable: true, tooltip: 'Stroke width (fraction of the smaller side).' }),
    P.float('softness', 0.4, { group: 'Stroke', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.int('complexity', 4, { group: 'Glyphs', label: 'Strokes per glyph', min: 1, max: 8 }),
    P.int('grid', 3, { group: 'Glyphs', label: 'Lattice', min: 2, max: 5, tooltip: 'Nodes per glyph axis (3 = 3x3 lattice).' }),
    P.bool('stem', true, { group: 'Glyphs', label: 'Vertical stem', tooltip: 'The first stroke is a vertical line through the glyph (rune look).' }),
    P.bool('mirror', true, { group: 'Glyphs', label: 'Mirror symmetric', tooltip: 'Mirror every stroke about the radial axis.' }),
    P.bool('ring_lines', true, { group: 'Glyphs', label: 'Border circles', tooltip: 'Thin circles inside and outside the glyph band.' }),
    P.float('flicker', 0.2, { group: 'Variation', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Random brightness reduction per glyph.' }),
    P.float('reveal', 1, { group: 'Variation', min: 0, max: 1, step: 0.005, display: 'percent', animatable: true, tooltip: 'Animate 0 -> 100% to draw the glyphs in one by one (build-up).' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 4, softMax: 2, step: 0.01, animatable: true, modulatable: true }),
    P.seed('seed', 1, { group: 'Output' }),
    P.bool('invert', false, { group: 'Output' }),
    P.float('uv_amount', 1, { group: 'Output', label: 'UV amount', min: 0, max: 1, step: 0.01, showWhenConnected: 'uv' }),
  ],
  gizmos: [{ id: 'ring', label: 'Rune ring centre / radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius' }],
  cost: { gpu: 'medium', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  gallery: [
    { name: 'Dense runes', params: { count: 40, glyph_height: 0.07, complexity: 5 } },
    { name: 'Bold sigils', params: { count: 12, glyph_height: 0.16, stroke: 0.014, grid: 4 } },
    { name: 'Half drawn', params: { reveal: 0.5 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const uvIn = ctx.texInput('uv');
    const m = ctx.mod('intensity');
    ctx.pass({
      label: 'rune ring',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          center: p.vec2('center'),
          radius: p.num('radius'),
          glyph_height: p.num('glyph_height'),
          count: p.int('count'),
          gap: p.num('gap'),
          stroke: p.num('stroke'),
          softness: p.num('softness'),
          complexity: p.int('complexity'),
          grid: p.int('grid'),
          stem: p.bool('stem'),
          mirror: p.bool('mirror'),
          rotation: p.num('rotation'),
          ring_lines: p.bool('ring_lines'),
          flicker: p.num('flicker'),
          reveal: p.num('reveal'),
          intensity: p.num('intensity'),
          intensity_mod_k: m.k,
          seed: p.seed('seed') >>> 0,
          invert: p.bool('invert'),
          has_uv: uvIn ? 1 : 0,
          uv_amount: p.num('uv_amount'),
        },
      },
      textures: [uvIn?.tex ?? null, m.tex?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

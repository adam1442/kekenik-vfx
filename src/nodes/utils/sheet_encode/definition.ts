import { bakerFor, type BakeSpec } from '../../../engine/anim/flipbook-bake';
import { autoGrid, cellSize, validateSheet, type RowOrder, type SheetSpec } from '../../../engine/anim/flipbook-layout';
import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { dataValue } from '../../../engine/resources/values';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { hashString } from '../../../shared/util';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_sheet_encode.wgsl', shaderSrc);
export const LAYOUT = makeLayout([{ name: 'has', type: 'u32' }]);

/** Resolved layout of a Sheet Encode node (pure, shared with tests and exports). */
export function resolveSheet(opts: { sheetW: number; sheetH: number; frames: number; autoGridOn: boolean; cols: number; rows: number; padding: number; rowOrder: RowOrder }): SheetSpec {
  const g = opts.autoGridOn ? autoGrid(opts.frames, opts.sheetW / Math.max(1, opts.sheetH)) : { cols: opts.cols, rows: opts.rows };
  return { sheetW: opts.sheetW, sheetH: opts.sheetH, cols: g.cols, rows: g.rows, count: opts.frames, padding: opts.padding, rowOrder: opts.rowOrder };
}

/**
 * utils.sheet_encode — frames over time -> grid sheet (flipbook). The input is LAZY: the FlipbookBaker evaluates the producer at
 * every frame time (the scheduler pauses while it works) and the finished sheet appears automatically.
 */
export default defineNode({
  id: 'utils.sheet_encode',
  version: 1,
  category: 'utils',
  title: 'Sheet Encode',
  description:
    'Bakes the animation of the connected node into a flipbook sheet: N frames sampled over the loop (or a custom range) are placed in a grid (non-square / non-power-of-two cells, edge padding, row order, reverse, loop cross-fade). The sheet size is the node size (Texture tab).',
  keywords: ['flipbook', 'sheet', 'atlas', 'frames', 'bake', 'animation', 'spritesheet', 'encode', 'loop'],
  icon: 'pin-flipbook',
  inputs: [{ id: 'input', name: 'Input', type: 'color', lazy: true, tooltip: 'Animated Gray or Color texture. Not evaluated per frame by the engine: the baker pulls it at every sample time.' }],
  outputs: [
    { id: 'sheet', name: 'Sheet', type: 'color' },
    { id: 'flipbook', name: 'Flipbook', type: 'flipbook' },
  ],
  common: { texture: true, blending: false },
  params: [
    P.int('frames', 16, { group: 'Frames', min: 1, max: 1024, softMax: 128, tooltip: 'Number of frames in the sheet.' }),
    P.enum('range', 'loop', [{ value: 'loop', label: 'Loop length' }, { value: 'custom', label: 'Custom' }], { group: 'Frames', tooltip: 'Loop length = frames 0 … loopLength of the graph (frame N == frame 0 for a seamless loop).' }),
    P.float('start', 0, { group: 'Frames', label: 'Start frame', softMin: 0, softMax: 256, step: 1, min: -100000, max: 100000, visibleIf: (v) => v.range === 'custom' }),
    P.float('end', 64, { group: 'Frames', label: 'End frame', softMin: 1, softMax: 256, step: 1, min: -100000, max: 100000, visibleIf: (v) => v.range === 'custom', tooltip: 'Exclusive: frames are sampled in [start, end).' }),
    P.float('frame_offset', 0, { group: 'Frames', label: 'Time offset (frames)', softMin: -32, softMax: 32, step: 0.1, min: -100000, max: 100000, animatable: true, tooltip: 'Shifts every sample in time (rotate the loop start).' }),
    P.bool('reverse', false, { group: 'Frames' }),
    P.int('loop_fade', 0, { group: 'Frames', label: 'Loop cross-fade frames', min: 0, max: 64, softMax: 16, tooltip: 'Blends the last N frames with the same frames one loop earlier so a NON-periodic animation still loops.' }),
    P.bool('auto_grid', true, { group: 'Grid', label: 'Automatic grid' }),
    P.int('cols', 4, { group: 'Grid', min: 1, max: 64, visibleIf: (v) => !v.auto_grid }),
    P.int('rows', 4, { group: 'Grid', min: 1, max: 64, visibleIf: (v) => !v.auto_grid }),
    P.enum('row_order', 'top_down', [{ value: 'top_down', label: 'Top to bottom' }, { value: 'bottom_up', label: 'Bottom to top' }], { group: 'Grid' }),
    P.int('padding', 0, { group: 'Grid', label: 'Edge padding (px)', min: 0, max: 64, softMax: 16, tooltip: 'Pixels per cell border that replicate the frame edge (mip-safe).' }),
  ],
  cost: { gpu: 'low', tiling: 'global' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const lz = ctx.lazyInput?.('input');
    if (!lz) throw new Error('Sheet Encode needs an input.');
    const baker = bakerFor(ctx.gpu);
    if (!baker) throw new Error('The flipbook baker is not available in this context.');
    const p = ctx.params;
    const g = lz.graph;
    const frames = p.int('frames');
    const spec = resolveSheet({
      sheetW: ctx.frame.width,
      sheetH: ctx.frame.height,
      frames,
      autoGridOn: p.bool('auto_grid'),
      cols: p.int('cols'),
      rows: p.int('rows'),
      padding: p.int('padding'),
      rowOrder: p.str('row_order') as RowOrder,
    });
    const bad = validateSheet(spec, ctx.gpu.caps.limits.maxTextureDimension2D ?? 8192);
    if (bad) throw new Error(bad);
    const custom = p.str('range') === 'custom';
    const start = custom ? p.num('start') : 0;
    const end = custom ? p.num('end') : g.settings.loopLength;
    if (end <= start) throw new Error('End frame must be greater than the start frame.');
    const offset = p.num('frame_offset');
    const reverse = p.bool('reverse');
    const fade = p.int('loop_fade');
    const key = `${ctx.node.id}:${hashString(JSON.stringify([spec, start, end, offset, reverse, fade, lz.nodeId, lz.pin, lz.sig]))}`;
    const bake: BakeSpec = { key, nodeId: ctx.node.id, nodeName: ctx.node.name, graph: g, source: { nodeId: lz.nodeId, pin: lz.pin }, ...spec, start, end, offset, reverse, crossfade: fade };
    const err = baker.errorOf(key);
    if (err) throw new Error(err);
    const done = baker.get(key);
    if (!done) baker.request(bake);
    const show = done ?? baker.latestFor(ctx.node.id);
    const out = ctx.tex('color');
    ctx.pass({ label: 'sheet encode', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { has: show ? 1 : 0 } }, textures: [show], ss: 1 });
    const c = cellSize(spec);
    const meta = { tex: out, cols: spec.cols, rows: spec.rows, frames, fps: g.settings.fps, cellW: c.w, cellH: c.h, padding: spec.padding, rowOrder: spec.rowOrder, loop: true, ready: !!done };
    return { sheet: ctx.result(out, 'color'), flipbook: dataValue('flipbook', meta, [out]) };
  },
});

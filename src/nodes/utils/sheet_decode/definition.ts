import { decodeFrame, frameUvRect, type DecodeMode, type RowOrder, type SheetSpec } from '../../../engine/anim/flipbook-layout';
import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import shaderSrc from './shader.wgsl?raw';

export const SHADER = defineShader('utils_sheet_decode.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'rect_a', type: 'vec4f' },
  { name: 'rect_b', type: 'vec4f' },
  { name: 'mix', type: 'f32' },
]);

interface FlipbookMeta {
  tex?: { width: number; height: number; texture?: unknown };
  cols?: number;
  rows?: number;
  frames?: number;
  padding?: number;
  rowOrder?: RowOrder;
}

/** Which frames / blend a decode shows (pure; tested). */
export function decodePlan(o: { time: number; mode: 'time' | 'manual'; manual: number; rate: number; offset: number; loop: DecodeMode; blend: boolean; count: number }): { a: number; b: number; mix: number } {
  const f = o.mode === 'time' ? o.time * o.rate + o.offset : o.manual;
  return decodeFrame(f, o.count, o.loop, o.blend);
}

/**
 * utils.sheet_decode — flipbook sheet -> one frame, driven by time (or a manual frame number) with frame blending.
 * Connect either a Color sheet texture (then set the grid here) or a Flipbook pin (grid / count / padding come from it).
 */
export default defineNode({
  id: 'utils.sheet_decode',
  version: 1,
  category: 'utils',
  title: 'Sheet Decode',
  description: 'Plays a flipbook sheet: picks the frame for the current time (or a manual frame), optionally cross-fading neighbouring frames, and outputs it as a normal texture.',
  keywords: ['flipbook', 'sheet', 'atlas', 'frames', 'decode', 'play', 'sprite', 'animation'],
  icon: 'pin-flipbook',
  inputs: [
    { id: 'sheet', name: 'Sheet', type: 'color', optional: true },
    { id: 'flipbook', name: 'Flipbook', type: 'flipbook', optional: true, tooltip: 'Overrides grid, frame count, padding and row order with the flipbook metadata.' },
  ],
  outputs: [{ id: 'output', name: 'Output', type: 'color' }],
  common: { texture: true, blending: true },
  timeDependent: (v) => v.mode === 'time',
  params: [
    P.enum('mode', 'time', [{ value: 'time', label: 'By time' }, { value: 'manual', label: 'Manual' }], { group: 'Playback' }),
    P.float('frame', 0, { group: 'Playback', label: 'Frame', min: -100000, max: 100000, softMin: 0, softMax: 63, step: 0.01, animatable: true, visibleIf: (v) => v.mode === 'manual', tooltip: 'Frame number (fractions blend when Blend frames is on).' }),
    P.float('rate', 30, { group: 'Playback', label: 'Rate (frames / s)', min: -1000, max: 1000, softMin: -60, softMax: 60, step: 0.5, animatable: true, visibleIf: (v) => v.mode === 'time' }),
    P.float('offset', 0, { group: 'Playback', label: 'Start offset (frames)', min: -100000, max: 100000, softMin: -64, softMax: 64, step: 0.5, animatable: true, visibleIf: (v) => v.mode === 'time' }),
    P.enum('loop_mode', 'loop', [{ value: 'loop', label: 'Loop' }, { value: 'once', label: 'Once' }, { value: 'pingpong', label: 'Ping-pong' }], { group: 'Playback' }),
    P.bool('blend', true, { group: 'Playback', label: 'Blend frames', tooltip: 'Cross-fade between two neighbouring frames (the last frame fades into the first when looping).' }),
    P.int('cols', 4, { group: 'Grid', min: 1, max: 256, tooltip: 'Used when no Flipbook pin is connected.' }),
    P.int('rows', 4, { group: 'Grid', min: 1, max: 256 }),
    P.int('frames', 16, { group: 'Grid', label: 'Frame count', min: 1, max: 65536 }),
    P.int('padding', 0, { group: 'Grid', min: 0, max: 64 }),
    P.enum('row_order', 'top_down', [{ value: 'top_down', label: 'Top to bottom' }, { value: 'bottom_up', label: 'Bottom to top' }], { group: 'Grid' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 1 }],
  evaluate(ctx) {
    const p = ctx.params;
    const fbIn = ctx.inputs.flipbook;
    const meta = fbIn && fbIn.kind === 'data' ? (fbIn.data as FlipbookMeta) : null;
    const sheetTex = meta?.tex && 'texture' in meta.tex ? (meta.tex as unknown as import('../../../engine/resources/memory').GpuTexture) : null;
    const tin = ctx.texInput('sheet');
    const tex = tin?.tex ?? sheetTex;
    if (!tex) throw new Error('Sheet Decode needs a Sheet texture or a Flipbook input.');
    const cols = meta?.cols ?? p.int('cols');
    const rows = meta?.rows ?? p.int('rows');
    const count = Math.max(1, Math.min(meta?.frames ?? p.int('frames'), cols * rows));
    const spec: SheetSpec = { sheetW: tex.width, sheetH: tex.height, cols, rows, count, padding: meta?.padding ?? p.int('padding'), rowOrder: (meta?.rowOrder ?? p.str('row_order')) as RowOrder };
    const d = decodePlan({ time: ctx.frame.time, mode: p.str('mode') as 'time' | 'manual', manual: p.num('frame'), rate: p.num('rate'), offset: p.num('offset'), loop: p.str('loop_mode') as DecodeMode, blend: p.bool('blend'), count });
    const out = ctx.tex('color');
    ctx.pass({ label: 'sheet decode', target: out, shader: SHADER, uniforms: { layout: LAYOUT, values: { rect_a: frameUvRect(spec, d.a), rect_b: frameUvRect(spec, d.b), mix: d.mix } }, textures: [tex], ss: 1 });
    return { output: ctx.result(out, 'color') };
  },
});

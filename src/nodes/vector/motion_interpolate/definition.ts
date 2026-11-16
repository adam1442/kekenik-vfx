import { autoGrid, cellRect, type SheetSpec } from '../../../engine/anim/flipbook-layout';
import { P } from '../../../engine/params/schema';
import type { GpuTexture } from '../../../engine/resources/memory';
import { dataValue } from '../../../engine/resources/values';
import { shaderNode, shaderPass } from '../../_shared/shadernode';
import { asFlipbook } from '../motion_generate/definition';
import src from './shader.wgsl?raw';

/** Source position of output frame `m` of `count` for `frames` source frames (pure; tested): frame a, frame b, weight f. */
export function interpolationPlan(m: number, count: number, frames: number, loop: boolean): { a: number; b: number; f: number } {
  const s = (m * frames) / Math.max(1, count);
  const a0 = Math.floor(s);
  const f = s - a0;
  const a = loop ? a0 % frames : Math.min(a0, frames - 1);
  const b = loop ? (a + 1) % frames : Math.min(a + 1, frames - 1);
  return { a, b, f: a === b ? 0 : f };
}

/** vector.motion_interpolate: expands a flipbook to more frames with its motion vectors. */
export default shaderNode({
  id: 'vector.motion_interpolate',
  title: 'Motion Vector Interpolate',
  description: 'Frame interpolation: for every in-between time t, frame A is warped forward by t x v and frame B backward by (1 - t) x v, blended with occlusion-aware weights (cross-fade where the consistency check failed). Output: a new Flipbook with more frames; Preview shows the A / B / warped difference.',
  keywords: ['motion', 'vector', 'interpolate', 'flipbook', 'frames', 'slow', 'smooth', 'retime', 'optical', 'flow', 'warp'],
  inputs: [
    { id: 'flipbook', name: 'Flipbook', type: 'flipbook', optional: false },
    { id: 'motion', name: 'Motion flipbook', type: 'flipbook', optional: false, tooltip: 'Motion Vector Generate output.' },
  ],
  outputs: [
    { id: 'sheet', name: 'Sheet', type: 'color' },
    { id: 'output', name: 'Flipbook', type: 'flipbook' },
    { id: 'preview', name: 'Preview', type: 'color', tooltip: 'R = |A - B|, G = |warped A - warped B| (should be lower), B = occlusion, at the chosen preview frame.' },
  ],
  extraFields: [{ name: 'rect_a', type: 'vec4f' }, { name: 'rect_b', type: 'vec4f' }, { name: 'dst', type: 'vec2f' }, { name: 'f', type: 'f32' }, { name: 'has_motion', type: 'u32' }, { name: 'has_occ', type: 'u32' }],
  extra: () => ({ rect_a: [0, 0, 1, 1], rect_b: [0, 0, 1, 1], dst: [1, 1], f: 0, has_motion: 1, has_occ: 0 }),
  cost: { gpu: 'medium', tiling: 'global' },
  variantDefines: [{ OUT: 0, TEX: 3 }, { OUT: 1, TEX: 3 }],
  params: [
    P.enum('mode', 'count', [{ value: 'count', label: 'Target frame count' }, { value: 'stretch', label: 'Time stretch factor' }], { group: 'Frames', label: 'Mode' }),
    P.int('count', 48, { group: 'Frames', label: 'Frame count', min: 2, max: 1024, softMax: 128, visibleIf: (v) => v.mode === 'count' }),
    P.float('stretch', 4, { group: 'Frames', label: 'Stretch factor', min: 1, max: 32, step: 0.25, visibleIf: (v) => v.mode === 'stretch', tooltip: 'Output frames = source frames x factor (the playback rate is divided by it).' }),
    P.bool('loop_wrap', true, { group: 'Frames', label: 'Loop', tooltip: 'The last frame interpolates towards the first.' }),
    P.float('fallback', 1, { group: 'Blend', label: 'Cross-fade fallback', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'How strongly occluded pixels fall back to a plain cross-fade.' }),
    P.bool('wrap_tile', false, { group: 'Blend', label: 'Tiling wrap' }),
    P.float('preview_pos', 0.5, { group: 'Preview', label: 'Preview position', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Position between the first two frames (0 = A, 100% = B).' }),
    P.float('gain', 4, { group: 'Preview', label: 'Difference gain', min: 0.1, max: 64, softMax: 16, step: 0.1 }),
  ],
  gallery: [{ name: '4x smoother', params: { mode: 'stretch', stretch: 4 } }, { name: '48 frames', params: { mode: 'count', count: 48 } }],
  shader: src,
  evaluate(ctx, rt) {
    const book = asFlipbook(ctx.inputs.flipbook);
    const mv = asFlipbook(ctx.inputs.motion);
    if (!book || !mv) throw new Error('Motion Vector Interpolate needs a Flipbook and a Motion flipbook.');
    const p = ctx.params;
    const frames = Math.max(1, book.frames);
    const count = Math.max(2, p.str('mode') === 'stretch' ? Math.round(frames * p.num('stretch')) : p.int('count'));
    const src0: SheetSpec = { sheetW: book.tex.width, sheetH: book.tex.height, cols: book.cols, rows: book.rows, count: frames, padding: book.padding ?? 0, rowOrder: book.rowOrder ?? 'top_down' };
    const c0 = cellRect(src0, 0);
    const cw = c0.iw, ch = c0.ih;
    const grid = autoGrid(count, cw / ch);
    const dstSpec: SheetSpec = { sheetW: grid.cols * cw, sheetH: grid.rows * ch, cols: grid.cols, rows: grid.rows, count, padding: 0, rowOrder: 'top_down' };
    const maxDim = ctx.gpu.caps.limits.maxTextureDimension2D ?? 8192;
    if (dstSpec.sheetW > maxDim || dstSpec.sheetH > maxDim) throw new Error(`The output sheet (${dstSpec.sheetW}x${dstSpec.sheetH}) exceeds the device texture limit ${maxDim}: reduce the frame count.`);
    const loop = p.bool('loop_wrap');
    const base = rt.values(ctx);
    const sheet = ctx.tex('color', dstSpec.sheetW, dstSpec.sheetH);
    const tmp = ctx.tex('color', cw, ch);
    const rectOf = (spec: SheetSpec, tex: GpuTexture, i: number): number[] => {
      const r = cellRect(spec, i);
      return [r.ix / tex.width, r.iy / tex.height, r.iw / tex.width, r.ih / tex.height];
    };
    const draw = (out: GpuTexture, plan: { a: number; b: number; f: number }, code: number): void =>
      shaderPass(ctx, rt, 'mv interpolate', out, [book.tex, mv.tex, mv.occ ?? null], { ...base, rect_a: rectOf(src0, book.tex, plan.a), rect_b: rectOf(src0, book.tex, plan.b), dst: [out.width, out.height], f: plan.f, has_motion: 1, has_occ: mv.occ ? 1 : 0 }, { OUT: code });
    // the motion sheet has the SAME size and cell grid as the colour sheet (Motion Vector Generate writes it so): rect_a addresses both
    for (let m = 0; m < count; m++) {
      draw(tmp, interpolationPlan(m, count, frames, loop), 0);
      const r = cellRect(dstSpec, m);
      ctx.encoder.copyTextureToTexture({ texture: tmp.texture }, { texture: sheet.texture, origin: { x: r.x, y: r.y } }, { width: cw, height: ch });
    }
    const a = Math.min(frames - 1, 0);
    const preview = ctx.tex('color', cw, ch);
    draw(preview, { a, b: Math.min(frames - 1, a + 1), f: p.num('preview_pos') }, 1);
    const meta = { tex: sheet, cols: grid.cols, rows: grid.rows, frames: count, fps: (book.fps ?? 30) * (count / frames), cellW: cw, cellH: ch, padding: 0, rowOrder: 'top_down', loop, ready: true };
    return { sheet: ctx.result(sheet, 'color'), output: dataValue('flipbook', meta, [sheet]), preview: ctx.result(preview, 'color') };
  },
});

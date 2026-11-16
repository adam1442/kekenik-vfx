import { cellRect, type RowOrder, type SheetSpec } from '../../../engine/anim/flipbook-layout';
import type { EvalContext } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import type { GpuTexture } from '../../../engine/resources/memory';
import { dataValue } from '../../../engine/resources/values';
import { shaderNode, shaderPass, type ShaderRuntime } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

export interface FlipbookMeta { tex: GpuTexture; cols: number; rows: number; frames: number; fps?: number; padding?: number; rowOrder?: RowOrder; cellW?: number; cellH?: number; loop?: boolean; ready?: boolean; motionScale?: number; occ?: GpuTexture | null; kind?: string }
export const MAX_FLOW_PASSES = 30000;

/** Number of GPU passes a generation records (pure; tested): guards against runaway settings. */
export function planFlowPasses(frames: number, levels: number, iterations: number, o: { consistency: boolean; median: boolean }): number {
  const solve = levels * iterations + (levels - 1) * 2 + (o.median ? levels : 0) + 1;
  const pair = 2 + 2 * (levels - 1) + solve * (o.consistency ? 2 : 1) + 1 + (o.consistency ? 1 : 0);
  return frames * pair + 1;
}
export const asFlipbook = (v: unknown): FlipbookMeta | null => {
  const x = v as { kind?: string; data?: FlipbookMeta } | undefined;
  return x && x.kind === 'data' && x.data && 'tex' in x.data ? x.data : null;
};

function generate(ctx: EvalContext, rt: ShaderRuntime) {
  const meta = asFlipbook(ctx.inputs.flipbook);
  if (!meta) throw new Error('Motion Vector Generate needs a Flipbook input (Sheet Encode).');
  const p = ctx.params;
  const sheet = meta.tex;
  const frames = Math.max(2, meta.frames);
  const spec: SheetSpec = { sheetW: sheet.width, sheetH: sheet.height, cols: meta.cols, rows: meta.rows, count: frames, padding: meta.padding ?? 0, rowOrder: meta.rowOrder ?? 'top_down' };
  const c0 = cellRect(spec, 0);
  const cw = Math.max(8, c0.iw), ch = Math.max(8, c0.ih);
  let levels = p.int('levels');
  while (levels > 1 && Math.min(cw, ch) >> (levels - 1) < 8) levels--;
  const iters = p.int('iterations');
  const consistency = p.bool('consistency');
  const median = p.bool('median');
  const loop = p.bool('loop_wrap');
  if (planFlowPasses(frames, levels, iters, { consistency, median }) > MAX_FLOW_PASSES) throw new Error('Too many GPU passes: reduce the frame count, pyramid levels or iterations.');
  const base = rt.values(ctx);
  const maxDisp = p.num('max_disp');
  const size = (l: number): [number, number] => [Math.max(1, Math.ceil(cw / 2 ** l)), Math.max(1, Math.ceil(ch / 2 ** l))];
  // bounded temporaries, reused for every frame pair (the encoder executes in order)
  const PA: GpuTexture[] = [], PB: GpuTexture[] = [], FL: GpuTexture[][] = [];
  for (let l = 0; l < levels; l++) {
    const [w, h] = size(l);
    PA.push(ctx.tex('gray', w, h));
    PB.push(ctx.tex('gray', w, h));
    FL.push([ctx.tex('uv', w, h), ctx.tex('uv', w, h)]);
  }
  const keep = ctx.tex('uv', cw, ch);
  const vecTmp = ctx.tex('vector', cw, ch);
  const occTmp = ctx.tex('gray', cw, ch);
  const outSheet = ctx.tex('vector', sheet.width, sheet.height);
  const occSheet = ctx.tex('gray', sheet.width, sheet.height);
  const pass = (label: string, target: GpuTexture, tex: (GpuTexture | null)[], mode: number, over: Record<string, number | number[]> = {}): void =>
    shaderPass(ctx, rt, label, target, tex, { ...base, dst: [target.width, target.height], ...over }, { MODE: mode });
  pass('mv zero', outSheet, [], 7);
  pass('mv zero occ', occSheet, [], 7);
  const prep = (pyr: GpuTexture[], frame: number): void => {
    const r = cellRect(spec, frame);
    pass('mv prep', pyr[0], [sheet], 0, { rect: [r.ix / sheet.width, r.iy / sheet.height, r.iw / sheet.width, r.ih / sheet.height] });
    for (let l = 1; l < levels; l++) pass('mv down', pyr[l], [pyr[l - 1]], 1);
  };
  const solve = (A: GpuTexture[], B: GpuTexture[]): GpuTexture => {
    const cur: number[] = new Array(levels).fill(0);
    for (let l = levels - 1; l >= 0; l--) {
      const lm = Math.max(1, maxDisp / 2 ** l);
      if (l === levels - 1) pass('mv flow init', FL[l][0], [], 7);
      else pass('mv up', FL[l][0], [FL[l + 1][cur[l + 1]]], 3);
      let c = 0;
      for (let it = 0; it < iters; it++) {
        pass('mv iterate', FL[l][1 - c], [A[l], B[l], FL[l][c]], 2, { lvl_max: lm });
        c = 1 - c;
      }
      if (median) {
        pass('mv median', FL[l][1 - c], [FL[l][c]], 4);
        c = 1 - c;
      }
      cur[l] = c;
    }
    return FL[0][cur[0]];
  };
  const origin = (frame: number): { x: number; y: number } => {
    const r = cellRect(spec, frame);
    return { x: r.ix, y: r.iy };
  };
  const copyTo = (src0: GpuTexture, dst: GpuTexture, frame: number): void => {
    const o = origin(frame);
    ctx.encoder.copyTextureToTexture({ texture: src0.texture }, { texture: dst.texture, origin: o }, { width: Math.min(cw, dst.width - o.x), height: Math.min(ch, dst.height - o.y) });
  };
  for (let i = 0; i < frames; i++) {
    const j = i + 1 < frames ? i + 1 : loop ? 0 : -1;
    if (j < 0) {
      // last frame of a non-looping book: repeat the previous vector (no frame to match against)
      copyTo(vecTmp, outSheet, i);
      if (consistency) copyTo(occTmp, occSheet, i);
      continue;
    }
    prep(PA, i);
    prep(PB, j);
    const fwd = solve(PA, PB);
    ctx.encoder.copyTextureToTexture({ texture: fwd.texture }, { texture: keep.texture }, { width: cw, height: ch });
    if (consistency) {
      const bwd = solve(PB, PA);
      pass('mv occlusion', occTmp, [keep, bwd], 6, { occ_thr: p.num('occ_thr') });
      copyTo(occTmp, occSheet, i);
    }
    pass('mv final', vecTmp, [keep], 5);
    copyTo(vecTmp, outSheet, i);
  }
  const fps = meta.fps ?? 30;
  const motionScale = maxDisp / Math.max(cw, ch);
  const out = { ...meta, tex: outSheet, motionScale, occ: consistency ? occSheet : null, kind: 'motion' };
  const rv = ctx.result(outSheet, 'vector');
  rv.vecScale = 1 / Math.max(1, fps);
  const res: Record<string, ReturnType<typeof ctx.result> | ReturnType<typeof dataValue>> = { sheet: rv, motion: dataValue('flipbook', out, [outSheet, occSheet]) };
  if (consistency) res.occlusion = ctx.result(occSheet, 'gray');
  return res as never;
}

/** vector.motion_generate: optical-flow motion vectors for a flipbook (frame i -> i + 1), pyramidal Horn-Schunck with warping. */
export default shaderNode({
  id: 'vector.motion_generate',
  title: 'Motion Vector Generate',
  description: 'GPU pyramidal optical flow between consecutive flipbook frames (Fast or Quality), with median filtering, forward / backward consistency check (occlusion mask), loop wrap and tiling. Output: a Flipbook of Vector (tile fractions per frame).',
  keywords: ['motion', 'vector', 'optical', 'flow', 'flipbook', 'interpolation', 'frames', 'horn', 'schunck', 'pyramid'],
  inputs: [{ id: 'flipbook', name: 'Flipbook', type: 'flipbook', optional: false, tooltip: 'Flipbook from Sheet Encode.' }],
  outputs: [{ id: 'sheet', name: 'Sheet', type: 'vector' }, { id: 'motion', name: 'Motion flipbook', type: 'flipbook' }, { id: 'occlusion', name: 'Occlusion', type: 'gray', tooltip: 'Where forward and backward flow disagree (needs the consistency check).' }],
  extraFields: [{ name: 'rect', type: 'vec4f' }, { name: 'dst', type: 'vec2f' }, { name: 'lvl_max', type: 'f32' }],
  extra: () => ({ rect: [0, 0, 1, 1], dst: [1, 1], lvl_max: 1e6 }),
  cost: { gpu: 'high', tiling: 'global' },
  variantDefines: [0, 1, 2, 3, 4, 5, 6, 7].map((m) => ({ MODE: m, TEX: m === 2 ? 3 : m === 6 ? 2 : 1 })),
  params: [
    P.enum('method', 'fast', [{ value: 'fast', label: 'Fast (Horn-Schunck)' }, { value: 'quality', label: 'Quality (robust, warping)' }], { group: 'Flow', label: 'Method', tooltip: 'Quality uses a robust (Charbonnier) data term: sharper motion boundaries.' }),
    P.int('levels', 4, { group: 'Flow', label: 'Pyramid levels', min: 3, max: 6 }),
    P.int('iterations', 12, { group: 'Flow', label: 'Iterations per level', min: 1, max: 60, softMax: 30 }),
    P.float('smoothness', 0.03, { group: 'Flow', label: 'Smoothness', min: 0.002, max: 1, step: 0.002, tooltip: 'Regularization: larger = smoother flow.' }),
    P.float('window', 1.5, { group: 'Flow', label: 'Window size', min: 1, max: 8, step: 0.5, unit: 'px', tooltip: 'Spacing of the gradient taps (larger = more robust, less detail).' }),
    P.float('max_disp', 32, { group: 'Flow', label: 'Max displacement', min: 1, max: 512, softMax: 128, unit: 'px', tooltip: 'Largest motion between two frames in pixels of one cell. Also defines the encoding scale (max displacement / cell size).' }),
    P.bool('median', true, { group: 'Filter', label: 'Median filter', tooltip: '3x3 median of the flow after every level (removes outliers).' }),
    P.float('pre_blur', 1, { group: 'Filter', label: 'Input pre-blur', min: 0, max: 8, step: 0.25, unit: 'px' }),
    P.enum('channel', 'luma', [{ value: 'luma', label: 'Luminance' }, { value: 'mean', label: 'RGB mean' }, { value: 'r', label: 'Red' }, { value: 'g', label: 'Green' }, { value: 'b', label: 'Blue' }, { value: 'a', label: 'Alpha' }], { group: 'Filter', label: 'Match channel' }),
    P.bool('consistency', true, { group: 'Consistency', label: 'Forward / backward check', tooltip: 'Also solves the backward flow (twice the cost) and writes an occlusion mask.' }),
    P.float('occ_thr', 1, { group: 'Consistency', label: 'Occlusion threshold', min: 0.1, max: 16, step: 0.1, unit: 'px', visibleIf: (v) => v.consistency === true }),
    P.bool('loop_wrap', true, { group: 'Frames', label: 'Loop wrap', tooltip: 'The last frame is matched with the first (looping flipbooks).' }),
    P.bool('wrap_tile', false, { group: 'Frames', label: 'Tiling wrap', tooltip: 'Image edges wrap around (tileable frames).' }),
  ],
  gallery: [{ name: 'Fast', params: { method: 'fast', iterations: 8 } }, { name: 'Quality', params: { method: 'quality', iterations: 20, levels: 5 } }],
  shader: src,
  evaluate: generate,
});

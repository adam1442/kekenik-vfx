import { cellRect, cellSize, frameUvRect, type SheetSpec } from '../engine/anim/flipbook-layout';
import { targetKey } from '../engine/graph/evaluator';
import { renderTiled } from '../engine/graph/tiled';
import { channelCount } from '../engine/resources/format';
import { decodeTexels, readTextureStrips } from '../engine/resources/readback';
import { planTiles } from '../engine/resources/tiles';
import { imageFormat, type ImageSpec, type RowEncoder } from './encoders';
import { ENGINE_PRESETS } from './engines';
import { CancelledExport, graphAtSize, releaseGraphCopy, resolveNodeParams, tilingNeeds, type JobEnv, type JobResult } from './job-env';
import { expandTemplate, uniquePaths } from './naming';
import { EdgePadder, convertPixels, isIntegerDepth } from './pixels';
import { estimateImageJob, planTiling, resolveImageSettings, type ImageExportSettings, type ImageKind } from './settings';

/**
 * IMAGE EXPORT JOB: Export Color / Mask / Multimask / Normal / Warp.
 *
 *  evaluate (graph clone at the export size) -> [tiles with halo] -> strips (mapAsync) -> convertPixels (premultiply, sRGB OETF,
 *  channel layout) -> [edge dilation] -> streaming encoder -> ByteSink (file / ZIP entry).
 * Peak memory: one GPU evaluation at the tile / frame size + one strip (single images) or one sheet band (flipbooks).
 */
export type RowsCallback = (y0: number, rows: number, data: Float32Array, channels: number) => Promise<void>;

export const KIND_OF: Record<string, ImageKind> = { 'export.color': 'color', 'export.mask': 'mask', 'export.multimask': 'multimask', 'export.normal': 'normal', 'export.warp': 'warp', 'export.motion_vector': 'color' };

/** Output file paths of a job (pure; also used by the panel to preview names). */
export function planImageFiles(s: ImageExportSettings, graphName: string, nodeName: string, now = new Date()): { frames: { frame: number; path: string }[]; sheet: string; json: string; warnings: string[] } {
  const fmt = imageFormat(s.format);
  const warnings: string[] = [];
  const ctx = { graph: graphName, node: nodeName, w: s.width, h: s.height, engine: s.engine, format: s.format, now };
  let template = s.template;
  if (s.frameMode === 'sequence' && !/\{frame/.test(template)) template = `${template}_{frame:4}`;
  const frames: { frame: number; path: string }[] = [];
  if (s.frameMode === 'sequence') {
    for (let i = 0; i < s.frameCount; i++) {
      const r = expandTemplate(template, { ...ctx, frame: s.frameStart + i, index: i });
      if (i === 0) for (const u of r.unknown) warnings.push(`Unknown token {${u}} in the file name template.`);
      frames.push({ frame: s.frameStart + i, path: `${r.path}.${fmt.ext}` });
    }
  } else {
    const r = expandTemplate(template.replace(/_?\{frame(:\d+)?\}/g, ''), { ...ctx, frame: s.frameStart });
    for (const u of r.unknown) warnings.push(`Unknown token {${u}} in the file name template.`);
    frames.push({ frame: s.frameStart, path: `${r.path}.${fmt.ext}` });
  }
  const uniq = uniquePaths(frames.map((f) => f.path));
  frames.forEach((f, i) => (f.path = uniq[i]));
  const base = frames[0].path.replace(/\.[^./]+$/, '');
  return { frames, sheet: frames[0].path, json: s.frameMode === 'flipbook' ? `${base}.flipbook.json` : `${base}.${s.kind}.json`, warnings };
}

/** Render a graph node at the graph's size, delivering row bands (full evaluation, or tiles with halo for big images). */
export async function renderNodeRows(env: JobEnv, graph: import('../engine/graph/graph').Graph, nodeId: string, time: number, plan: { tiled: boolean; tileSize: number }, onRows: RowsCallback, fraction: (f: number) => void): Promise<void> {
  const { engine, gate } = env;
  const { width: W, height: H } = graph.settings;
  const token = gate;
  // simulation nodes advance to this frame first (in order, cache-budget safe); no-op without simulation nodes
  if (!(await engine.sims.prepareFrame(graph, [{ nodeId }], time, { token: gate }))) throw new CancelledExport();
  if (!plan.tiled) {
    await gate.checkpoint();
    const res = await engine.evaluator.evaluate(graph, [{ nodeId }], { time, scale: 1, token, useCache: false });
    try {
      if (res.cancelled) throw new CancelledExport();
      const err = res.errors.get(nodeId) ?? [...res.errors.values()][0];
      if (err) throw new Error(err);
      const v = res.values.get(targetKey({ nodeId }));
      if (!v || v.kind !== 'texture') throw new Error('The export node did not produce a texture (is its input connected?)');
      const ch = channelCount(v.tex.format);
      await readTextureStrips(engine.gpu, engine.mm, v.tex.texture, v.tex.format, v.tex.width, v.tex.height, async (s) => {
        await gate.checkpoint();
        await onRows(s.y0, s.rows, decodeTexels(v.tex.format, s.data), ch);
        fraction((s.y0 + s.rows) / H);
      }, { maxStripBytes: 8 * 1024 * 1024, signal: gate });
    } finally {
      res.release();
    }
    return;
  }
  const needs = tilingNeeds(env, nodeId);
  if (needs.global.length) env.log('warn', `Nodes that need the whole image cannot be tiled: ${needs.global.join(', ')}. They are evaluated per tile (results may show seams).`);
  const tiles = planTiles(W, H, plan.tileSize, needs.halo);
  const cols = Math.ceil(W / plan.tileSize);
  let band: Float32Array | null = null;
  let bandCh = 0;
  await renderTiled(engine.gpu, engine.mm, engine.evaluator, graph, { nodeId }, {
    tileSize: plan.tileSize,
    halo: needs.halo,
    time,
    token,
    onTile: async (tile, data, ch) => {
      await gate.checkpoint();
      if (!band || tile.col === 0) {
        bandCh = ch;
        band = new Float32Array(W * tile.h * ch);
      }
      for (let y = 0; y < tile.h; y++) band.set(data.subarray(y * tile.w * ch, (y + 1) * tile.w * ch), (y * W + tile.x) * ch);
      if (tile.col === cols - 1) {
        await onRows(tile.y, tile.h, band, bandCh);
        fraction((tile.index + 1) / tiles.length);
      }
    },
  });
  void tiles;
  if (gate.cancelled) throw new CancelledExport();
}

function specOf(s: ImageExportSettings, w: number, h: number, comment?: string): ImageSpec {
  return { width: w, height: h, channels: s.channels, depth: s.depth, colorSpace: s.colorSpace, software: 'Kekenik VFX', comment };
}

export async function runImageJob(env: JobEnv, nodeId: string): Promise<JobResult> {
  const node = env.graph.nodes.get(nodeId);
  if (!node) throw new Error('Export node no longer exists');
  const kind = KIND_OF[node.type];
  if (!kind) throw new Error(`${node.type} is not an image export node`);
  const params = resolveNodeParams(env, nodeId);
  const s = resolveImageSettings(kind, params, env.graph.settings);
  const fmt = imageFormat(s.format);
  const gs = env.graph.settings;
  const mm = env.engine.mm;
  const maxDim = env.engine.gpu.caps.limits.maxTextureDimension2D ?? 8192;
  const estEnv = { maxDim, budgetBytes: mm.budgetBytes, hq: gs.bitDepth === 32 };
  const est = estimateImageJob(s, estEnv);
  const names = planImageFiles(s, env.graphName, node.name, env.now);
  for (const w of [...s.notes, ...names.warnings]) env.log('warn', w);
  if (est.cpuBytes > 1.5 * 1024 ** 3) throw new Error(`The export needs about ${(est.cpuBytes / 1048576).toFixed(0)} MB of RAM for one band: reduce the size.`);
  const flip = s.frameMode === 'flipbook';
  const files: string[] = [];
  let bytes = 0;
  const encOpts = { exrCompression: s.exrCompression, pngFilter: 'adaptive' as const };
  const conv = (src: Float32Array, pixels: number, sc: number, dst?: Float32Array): Float32Array =>
    convertPixels(src, pixels, { srcChannels: sc as 1 | 4, outChannels: s.channels, colorSpace: s.colorSpace, premultiply: s.premultiply, clamp01: isIntegerDepth(s.depth) }, dst);
  const dilate = s.edgePadding > 0 && s.channels === 4;
  const finishFile = (): void => {
    const rec = env.target.files[env.target.files.length - 1];
    if (rec) bytes += rec.bytes;
  };

  /* ----------------------------------------------------------------------------------------- single / sequence */
  if (!flip) {
    const tp = planTiling(s.width, s.height, estEnv);
    const g = graphAtSize(env, s.width, s.height);
    try {
      for (let i = 0; i < names.frames.length; i++) {
        await env.gate.checkpoint();
        const f = names.frames[i];
        const sink = await env.target.openFile(f.path, fmt.mime);
        let enc: RowEncoder | null = null;
        try {
          enc = await fmt.create(specOf(s, s.width, s.height), sink, encOpts);
          const pad = dilate ? new EdgePadder(s.width, s.height, s.edgePadding) : null;
          const emit = async (r: Float32Array, n: number): Promise<void> => (n ? enc!.writeRows(r, n) : undefined);
          await renderNodeRows(env, g.graph, nodeId, f.frame / gs.fps, tp, async (_y0, rows, data, ch) => {
            const c = conv(data, s.width * rows, ch);
            if (pad) await pad.push(c, rows, emit);
            else await enc!.writeRows(c, rows);
          }, (fr) => env.onProgress((i + fr) / names.frames.length, `frame ${f.frame}`));
          if (pad) await pad.flush(emit);
          await enc.finish();
        } catch (e) {
          await enc?.abort().catch(() => undefined);
          throw e;
        }
        files.push(f.path);
        finishFile();
        env.log('info', `wrote ${f.path} (${s.width}×${s.height}, ${s.channels} ch, ${String(s.depth)}${tp.tiled ? `, tiled ${tp.tileSize}px` : ''})`);
      }
    } finally {
      releaseGraphCopy(env, g);
    }
    if (kind === 'warp' && params.write_json !== false) {
      const jp = names.json;
      await env.target.writeFile(jp, JSON.stringify(warpMeta(s, params, names.frames.map((f) => f.path)), null, 2), 'application/json');
      files.push(jp);
    }
    if (node.type === 'export.motion_vector' && params.write_json !== false) {
      // single-image / sequence motion vectors get the same sidecar block the flipbook JSON carries
      const jp = names.json.replace(/\.color\.json$/, '.motion.json');
      await env.target.writeFile(jp, JSON.stringify({ format: 'kekenik-motion-vectors', version: 1, images: names.frames.map((f) => f.path), size: [s.width, s.height], depth: s.depth, ...motionVectorMeta(params), generator: 'Kekenik VFX' }, null, 2), 'application/json');
      files.push(jp);
    }
    return { files, bytes };
  }

  /* ----------------------------------------------------------------------------------------- flipbook sheet */
  const sheet: SheetSpec = { sheetW: s.width, sheetH: s.height, cols: s.fbCols, rows: s.fbRows, count: s.frameCount, padding: s.fbPadding, rowOrder: s.fbRowOrder };
  const cell = cellSize(sheet);
  const c0 = cellRect(sheet, 0);
  const iw = c0.iw, ih = c0.ih; // frame content size
  const tp = planTiling(iw, ih, estEnv);
  const g = graphAtSize(env, iw, ih);
  const sink = await env.target.openFile(names.sheet, fmt.mime);
  let enc: RowEncoder | null = null;
  try {
    enc = await fmt.create(specOf(s, s.width, s.height, `flipbook ${s.fbCols}x${s.fbRows}, ${s.frameCount} frames`), sink, encOpts);
    const oc = s.channels;
    const band = new Float32Array(s.width * cell.h * oc);
    let written = 0;
    for (let r = 0; r < s.fbRows; r++) {
      await env.gate.checkpoint();
      band.fill(0);
      if (oc === 4) for (let i = 3; i < band.length; i += 4) band[i] = 0;
      const floorIdx = s.fbRowOrder === 'top_down' ? r : s.fbRows - 1 - r;
      for (let col = 0; col < s.fbCols; col++) {
        const idx = floorIdx * s.fbCols + col;
        if (idx >= s.frameCount) continue;
        const frame = s.frameStart + idx;
        let cellBuf: Float32Array = new Float32Array(iw * ih * oc);
        await renderNodeRows(env, g.graph, nodeId, frame / gs.fps, tp, async (y0, rows, data, ch) => {
          cellBuf.set(conv(data, iw * rows, ch), y0 * iw * oc);
        }, (fr) => env.onProgress((idx + fr) / s.frameCount, `frame ${frame}`));
        if (dilate) cellBuf = await dilateWhole(cellBuf, iw, ih, s.edgePadding);
        if (s.fbFiles) await writeFrameFile(env, s, fmt, cellBuf, iw, ih, names, idx, encOpts, files);
        // place into the band with replicated edge padding
        const pad = c0.ix - c0.x;
        for (let y = 0; y < cell.h; y++) {
          const sy = Math.min(ih - 1, Math.max(0, y - pad));
          for (let x = 0; x < cell.w; x++) {
            const sx = Math.min(iw - 1, Math.max(0, x - pad));
            const so = (sy * iw + sx) * oc;
            const d = (y * s.width + col * cell.w + x) * oc;
            for (let c = 0; c < oc; c++) band[d + c] = cellBuf[so + c];
          }
        }
      }
      await enc.writeRows(band, cell.h);
      written += cell.h;
    }
    if (written < s.height) {
      const rest = s.height - written;
      const z = new Float32Array(s.width * Math.min(rest, 64) * oc);
      for (let left = rest; left > 0; ) {
        const n = Math.min(left, 64);
        await enc.writeRows(z.subarray(0, s.width * n * oc), n);
        left -= n;
      }
    }
    await enc.finish();
  } catch (e) {
    await enc?.abort().catch(() => undefined);
    throw e;
  } finally {
    releaseGraphCopy(env, g);
  }
  files.push(names.sheet);
  finishFile();
  if (s.fbJson) {
    const json = flipbookJson(s, sheet, names.sheet, params, kind);
    await env.target.writeFile(names.json, JSON.stringify(json, null, 2), 'application/json');
    files.push(names.json);
  }
  env.log('info', `wrote flipbook ${names.sheet}: ${s.width}×${s.height}, ${s.fbCols}×${s.fbRows} grid, cell ${cell.w}×${cell.h}, ${s.frameCount} frames`);
  return { files, bytes: env.target.files.reduce((n, f) => n + f.bytes, 0) };
}

async function dilateWhole(buf: Float32Array, w: number, h: number, r: number): Promise<Float32Array> {
  const pad = new EdgePadder(w, h, r, 0.001, h + r + 1);
  const out = new Float32Array(buf.length);
  let rows = 0;
  const emit = async (rr: Float32Array, n: number): Promise<void> => void (out.set(rr.subarray(0, n * w * 4), rows * w * 4), (rows += n));
  await pad.push(buf, h, emit);
  await pad.flush(emit);
  return out;
}

async function writeFrameFile(env: JobEnv, s: ImageExportSettings, fmt: ReturnType<typeof imageFormat>, cellBuf: Float32Array, iw: number, ih: number, names: ReturnType<typeof planImageFiles>, idx: number, encOpts: object, files: string[]): Promise<void> {
  const base = names.sheet.replace(/\.[^./]+$/, '');
  const path = `${base}_frames/${base.split('/').pop()}_${String(idx).padStart(4, '0')}.${fmt.ext}`;
  const sink = await env.target.openFile(path, fmt.mime);
  const enc = await fmt.create(specOf(s, iw, ih), sink, encOpts);
  await enc.writeRows(cellBuf, ih);
  await enc.finish();
  files.push(path);
}

function warpMeta(s: ImageExportSettings, p: Record<string, unknown>, files: string[]): Record<string, unknown> {
  const preset = ENGINE_PRESETS[s.engine];
  const fy = String(p.flip_y);
  return {
    format: 'kekenik-warp',
    version: 1,
    files,
    codec: p.codec,
    range: p.range,
    rangeNote: 'tile-space offset (1 = full image) that a fully saturated channel represents; neutral = 0.5 for biased / direction',
    vectorMeans: p.flow_sign,
    flipY: fy === 'on' || (fy === 'engine' && preset.warpFlipY),
    uvInput: p.uv_in,
    engine: s.engine,
    colorSpace: s.colorSpace,
    depth: s.depth,
    channels: s.channels,
    decode: { biased: 'delta = (texel * 2 - 1) * range', direction: 'dir = texel.rg * 2 - 1; speed = texel.b * range', offset: 'delta = texel.rg', absolute: 'lookup = texel.rg' }[String(p.codec)] ?? '',
    shader: 'uv_sample = uv - flow * time (flow = direction CONTENT moves)',
    import: 'linear (sRGB off), no mip bleeding, no compression for 8-bit',
  };
}

/** Sidecar block of exported motion vectors (shared by the single-image and the flipbook JSON; documented in docs/EXPORT_GUIDE.md). */
export function motionVectorMeta(p: Record<string, unknown>): { motionVectors: Record<string, unknown> } {
  const flipped = p.mv_convention === 'unreal' || (p.mv_convention === 'custom' && p.mv_flip_y === true);
  // a pre-baked vector flipbook sheet (single image): the sheet grid / frame count / rate typed into the node (0 = plain image)
  const cols = Math.max(0, Math.round(Number(p.mv_cols) || 0)), rows = Math.max(1, Math.round(Number(p.mv_rows) || 1));
  const sheet = cols > 0 ? { sheet: { grid: [cols, rows], frames: Math.round(Number(p.mv_frames) || 0) || cols * rows, fps: Number(p.mv_fps) || 30, loop: true, frameOrder: 'row-major, top-left first' } } : {};
  return { motionVectors: { ...sheet, scale: p.mv_scale, encoding: p.mv_signed === true ? 'signed' : 'neutral-0.5', convention: p.mv_convention ?? 'custom', yDown: !flipped, units: 'tile fractions of one cell per flipbook frame', channels: 'R = X, G = Y' } };
}

function flipbookJson(s: ImageExportSettings, sheet: SheetSpec, image: string, p: Record<string, unknown>, kind: string): Record<string, unknown> {
  const c = cellSize(sheet);
  const uv = Array.from({ length: s.frameCount }, (_, i) => frameUvRect(sheet, i).map((v) => +v.toFixed(8)));
  const mv = p.mv_scale !== undefined ? motionVectorMeta(p) : {};
  return {
    ...mv,
    format: 'kekenik-flipbook',
    version: 1,
    image,
    kind,
    sheet: [s.width, s.height],
    grid: [s.fbCols, s.fbRows],
    cell: [c.w, c.h],
    padding: s.fbPadding,
    frames: s.frameCount,
    firstFrame: s.frameStart,
    fps: s.fps,
    duration: s.frameCount / s.fps,
    loop: true,
    rowOrder: s.fbRowOrder,
    frameOrder: 'row-major; frame 0 = first cell of the first row (top-left for top_down, bottom-left for bottom_up)',
    uvOrigin: 'top-left, v down',
    uvRects: uv,
    uvRectNote: '[u0, v0, du, dv] of the frame content (padding excluded)',
    channels: s.channels,
    depth: s.depth,
    colorSpace: s.colorSpace,
    premultipliedAlpha: s.premultiply,
    engine: s.engine,
    ...(kind === 'warp' ? { warp: warpMeta(s, p, [image]) } : {}),
    generator: 'Kekenik VFX',
  };
}


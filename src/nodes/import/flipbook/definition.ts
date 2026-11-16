import { cellSize, validateSheet, type RowOrder } from '../../../engine/anim/flipbook-layout';
import { composeSheet, parseOrder, sheetPixels, sheetSpecOf, toHalfRGBA } from '../../../engine/anim/flipbook-import';
import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { dataValue } from '../../../engine/resources/values';

/**
 * import.flipbook — an existing flipbook / sprite sheet (PNG / JPG / WebP, drop or Flipbook Editor > Import) with per-frame editing:
 * `order` (reorder / delete / duplicate), painted / replaced frames (the edited sheet replaces `image`). Everything lives in the
 * project (the image is a data URL param), so edits are undoable and saved.
 */
export default defineNode({
  id: 'import.flipbook',
  version: 1,
  category: 'import',
  title: 'Flipbook (Import)',
  description:
    'Imports an existing flipbook sheet and lets you edit it per frame (select, paint over, replace, reorder, delete, duplicate) in the Flipbook Editor panel. Outputs the re-ordered sheet as a Color texture and as a Flipbook.',
  keywords: ['flipbook', 'import', 'sheet', 'sprite', 'atlas', 'texture', 'frames', 'edit', 'png'],
  icon: 'cat-import',
  inputs: [],
  outputs: [
    { id: 'output', name: 'Sheet', type: 'color' },
    { id: 'flipbook', name: 'Flipbook', type: 'flipbook' },
  ],
  common: { texture: false },
  params: [
    P.string('image', '', { group: 'Source', label: 'Image (data)', advanced: true, tooltip: 'PNG data URL stored in the project. Use the Flipbook Editor panel to import / edit.' }),
    P.string('name', '', { group: 'Source', label: 'File name' }),
    P.int('cols', 4, { group: 'Grid', min: 1, max: 256 }),
    P.int('rows', 4, { group: 'Grid', min: 1, max: 256 }),
    P.int('frames', 16, { group: 'Grid', label: 'Source frame count', min: 1, max: 65536 }),
    P.int('padding', 0, { group: 'Grid', min: 0, max: 64 }),
    P.enum('row_order', 'top_down', [{ value: 'top_down', label: 'Top to bottom' }, { value: 'bottom_up', label: 'Bottom to top' }], { group: 'Grid' }),
    P.string('order', '', { group: 'Edit', label: 'Frame order', advanced: true, tooltip: 'JSON list of source frame indices in playback order (edited by the Flipbook Editor).' }),
    P.bool('linearize', true, { group: 'Color', label: 'sRGB → linear', tooltip: 'Convert colours from sRGB (as stored in PNG files) to the linear space of the graph.' }),
  ],
  cost: { gpu: 'trivial', tiling: 'global' },
  evaluate(ctx) {
    const p = ctx.params;
    const url = p.str('image');
    const out0 = (w: number, h: number): ReturnType<typeof ctx.tex> => ctx.tex('color', w, h);
    if (!url) {
      throw new Error('No image yet: open the Flipbook Editor panel and import a sheet (or drop a PNG on the window).');
    }
    const px = sheetPixels(url);
    if (!px) {
      // still decoding: neutral output, the node re-evaluates itself when the decode finished
      const t = out0(Math.min(64, ctx.frame.width), Math.min(64, ctx.frame.height));
      return { output: ctx.result(t, 'color'), flipbook: dataValue('flipbook', { tex: t, cols: 1, rows: 1, frames: 1, fps: 30, ready: false }, [t]) };
    }
    const maxDim = ctx.gpu.caps.limits.maxTextureDimension2D ?? 8192;
    const spec = sheetSpecOf(px, p.int('cols'), p.int('rows'), p.int('frames'), p.int('padding'), p.str('row_order') as RowOrder);
    const bad = validateSheet(spec, maxDim);
    if (bad) throw new Error(bad);
    const order = parseOrder(p.str('order'), spec.count);
    const sheet = composeSheet(px, spec, order.length ? order : [0]);
    const tex = ctx.tex('color', px.w, px.h);
    const half = toHalfRGBA(sheet, p.bool('linearize'));
    ctx.gpu.device.queue.writeTexture({ texture: tex.texture }, half.buffer as ArrayBuffer, { offset: half.byteOffset, bytesPerRow: px.w * 8, rowsPerImage: px.h }, { width: px.w, height: px.h });
    const c = cellSize(spec);
    const meta = { tex, cols: spec.cols, rows: spec.rows, frames: Math.min(order.length, spec.cols * spec.rows), fps: 30, cellW: c.w, cellH: c.h, padding: spec.padding, rowOrder: spec.rowOrder, loop: true, ready: true };
    return { output: ctx.result(tex, 'color'), flipbook: dataValue('flipbook', meta, [tex]) };
  },
});

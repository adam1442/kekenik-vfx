import { cellRect, cellSize } from '../../engine/anim/flipbook-layout';
import { cachePixels, decodeSheetImage, encodeSheetImage, orderOps, paintDot, parseOrder, replaceFrame, sheetPixels, sheetSpecOf, stringifyOrder, type SheetPixels } from '../../engine/anim/flipbook-import';
import type { RowOrder } from '../../engine/anim/flipbook-layout';
import { autoGrid } from '../../engine/anim/flipbook-layout';
import { Disposer, h, pickFile } from '../../ui/core/dom';
import { toast } from '../../ui/core/overlay';
import { definePanelView } from '../../ui/dock/panel-lazy';

import { t as tt } from '../../shared/i18n';
/**
 * FLIPBOOK EDITOR: per-frame editing of an imported flipbook (`import.flipbook` node): select a frame, paint over it,
 * replace it from a file, reorder / duplicate / delete frames. All edits are ordinary param edits (undo / redo, saved with the project).
 */
export const { create } = definePanelView({
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    host.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:auto;padding:0.667rem;gap:0.667rem;font-size:0.917rem;';
    const graph = (): typeof app.project.graph => app.project.graph;
    const ed = (): typeof app.project.editor => app.project.editor;
    let nodeId: string | null = null;
    let work: SheetPixels | null = null; // source sheet (edited in place while painting)
    let workUrl = '';
    let sel = 0;
    const brush = { color: '#ff8a3c', size: 6, erase: false };
    let busy = false;

    const head = h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } });
    const strip = h('canvas', { style: { width: '100%', background: '#111', border: '1px solid #2c2e35', cursor: 'pointer' } }) as HTMLCanvasElement;
    const paint = h('canvas', { style: { width: '100%', maxHeight: '26.667rem', objectFit: 'contain', background: 'repeating-conic-gradient(#222 0% 25%, #2b2b2b 0% 50%) 50% / 1.333rem 1.333rem', border: '1px solid #2c2e35', touchAction: 'none', cursor: 'crosshair' } }) as HTMLCanvasElement;
    const tools = h('div', { style: { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } });
    const note = h('div', { class: 'k-dim' });
    host.append(head, note, strip, tools, paint);

    const btn = (t: string, tip: string, fn: () => void): HTMLButtonElement => h('button', { class: 'k-btn', tip, onclick: fn }, t);
    const num = (label: string, id: string, min = 1, max = 256): HTMLElement => {
      const i = h('input', { type: 'number', min: String(min), max: String(max), style: { width: '4.5rem' } }) as HTMLInputElement;
      i.value = String(graph().nodes.get(nodeId!)?.params[id] ?? '');
      i.addEventListener('keydown', (e) => e.stopPropagation());
      i.addEventListener('change', () => {
        const v = Math.max(min, Math.min(max, Math.round(+i.value || min)));
        ed().setParam(nodeId!, id, v);
      });
      return h('label', {}, `${label} `, i);
    };

    const params = (): Record<string, unknown> => (nodeId ? (graph().nodes.get(nodeId)?.params ?? {}) : {});
    const spec = (): ReturnType<typeof sheetSpecOf> | null => {
      if (!work) return null;
      const p = params();
      return sheetSpecOf(work, p.cols as number, p.rows as number, p.frames as number, p.padding as number, p.row_order as RowOrder);
    };
    const order = (): number[] => {
      const s = spec();
      return s ? parseOrder(String(params().order ?? ''), s.count) : [];
    };

    async function importFile(file: File): Promise<void> {
      busy = true;
      try {
        const px = await decodeSheetImage(file);
        const url = await encodeSheetImage(px);
        const id = nodeId ?? ed().addNode('import.flipbook', { x: 80, y: 80 });
        const g = autoGrid(Math.max(1, Math.round((px.w / px.h) * 4)), px.w / px.h);
        ed().stack.transaction('Import flipbook', () => {
          ed().setParam(id, 'image', url);
          ed().setParam(id, 'name', file.name);
          ed().setParam(id, 'cols', g.cols);
          ed().setParam(id, 'rows', g.rows);
          ed().setParam(id, 'frames', g.cols * g.rows);
          ed().setParam(id, 'order', '');
        });
        cachePixels(url, px);
        app.selection.set([id]);
        toast(tt('flipbookEditor.imported', { name: file.name, w: px.w, h: px.h }), { type: 'ok' });
      } catch (e) {
        toast((e as Error).message, { type: 'error', title: tt('common.importFailed') });
      } finally {
        busy = false;
        refresh();
      }
    }

    async function commit(label: string): Promise<void> {
      if (!work || !nodeId) return;
      try {
        const url = await encodeSheetImage(work);
        cachePixels(url, { w: work.w, h: work.h, data: new Uint8ClampedArray(work.data) });
        workUrl = url;
        ed().stack.transaction(label, () => ed().setParam(nodeId!, 'image', url));
      } catch (e) {
        toast((e as Error).message, { type: 'error', title: tt('flipbookEditor.cannotStoreTheEdit') });
      }
    }
    function setOrder(o: number[], label: string): void {
      ed().stack.transaction(label, () => ed().setParam(nodeId!, 'order', stringifyOrder(o)));
    }

    /* --------------------------------------------------------------------------- drawing */
    function drawStrip(): void {
      const s = spec();
      if (!s || !work) return;
      const o = order();
      const cs = cellSize(s);
      const thumb = 72;
      const per = Math.max(1, Math.floor((strip.parentElement?.clientWidth ?? 320) / (thumb + 4)));
      const rowsN = Math.ceil(o.length / per);
      strip.width = per * (thumb + 4);
      strip.height = Math.max(1, rowsN) * (thumb + 4);
      const c = strip.getContext('2d')!;
      c.fillStyle = '#111';
      c.fillRect(0, 0, strip.width, strip.height);
      const tmp = new OffscreenCanvas(cs.w, cs.h);
      const tc = tmp.getContext('2d')!;
      o.forEach((src, i) => {
        const r = cellRect(s, src);
        const id = new ImageData(new Uint8ClampedArray(r.iw * r.ih * 4), r.iw, r.ih);
        for (let y = 0; y < r.ih; y++) id.data.set(work!.data.subarray(((r.iy + y) * work!.w + r.ix) * 4, ((r.iy + y) * work!.w + r.ix + r.iw) * 4), y * r.iw * 4);
        tmp.width = r.iw;
        tmp.height = r.ih;
        tc.putImageData(id, 0, 0);
        const x = (i % per) * (thumb + 4) + 2;
        const y = Math.floor(i / per) * (thumb + 4) + 2;
        const k = Math.min(thumb / r.iw, thumb / r.ih);
        c.drawImage(tmp, x, y, r.iw * k, r.ih * k);
        c.strokeStyle = i === sel ? '#ffcf5a' : '#333';
        c.lineWidth = i === sel ? 2 : 1;
        c.strokeRect(x - 0.5, y - 0.5, thumb + 1, thumb + 1);
        c.fillStyle = '#fff9';
        c.font = '10px sans-serif';
        c.fillText(String(i), x + 3, y + 11);
      });
      (strip as HTMLCanvasElement & { _per?: number })._per = per;
    }
    function drawPaint(): void {
      const s = spec();
      if (!s || !work) return;
      const o = order();
      const src = o[Math.min(sel, o.length - 1)];
      if (src === undefined) return;
      const r = cellRect(s, src);
      paint.width = r.iw;
      paint.height = r.ih;
      const id = new ImageData(new Uint8ClampedArray(r.iw * r.ih * 4), r.iw, r.ih);
      for (let y = 0; y < r.ih; y++) id.data.set(work.data.subarray(((r.iy + y) * work.w + r.ix) * 4, ((r.iy + y) * work.w + r.ix + r.iw) * 4), y * r.iw * 4);
      paint.getContext('2d')!.putImageData(id, 0, 0);
    }

    /* --------------------------------------------------------------------------- UI state */
    function refresh(): void {
      const id = app.selection.primary;
      const n = id ? graph().nodes.get(id) : null;
      nodeId = n && n.type === 'import.flipbook' ? id : null;
      head.replaceChildren(btn(tt('flipbookEditor.importImage'), tt('flipbookEditor.importAPng'), () => void pickFile('image/*').then(([f]) => f && importFile(f))));
      tools.replaceChildren();
      if (!nodeId) {
        note.textContent = busy ? 'Working…' : 'Select a "Flipbook (Import)" node, or import an image to create one.';
        strip.style.display = 'none';
        paint.style.display = 'none';
        return;
      }
      strip.style.display = '';
      paint.style.display = '';
      const url = String(params().image ?? '');
      if (!url) {
        note.textContent = tt('flipbookEditor.thisNodeHasNo');
        work = null;
        return;
      }
      if (url !== workUrl) {
        const px = sheetPixels(url);
        if (!px) {
          note.textContent = tt('flipbookEditor.decoding');
          setTimeout(refresh, 120);
          return;
        }
        work = { w: px.w, h: px.h, data: new Uint8ClampedArray(px.data) };
        workUrl = url;
      }
      head.append(num('Columns', 'cols'), num('Rows', 'rows'), num('Frames', 'frames', 1, 65536), num('Padding', 'padding', 0, 64));
      const o = order();
      sel = Math.max(0, Math.min(sel, o.length - 1));
      note.textContent = `${String(params().name ?? 'sheet')} · ${work!.w}×${work!.h} · ${o.length} frame(s) in order. Painting changes the SOURCE frame (duplicates share it).`;
      const color = h('input', { type: 'color', value: brush.color }) as HTMLInputElement;
      color.addEventListener('input', () => (brush.color = color.value));
      const size = h('input', { type: 'range', min: '1', max: '64', value: String(brush.size) }) as HTMLInputElement;
      size.addEventListener('input', () => (brush.size = +size.value));
      const erase = h('input', { type: 'checkbox' }) as HTMLInputElement;
      erase.addEventListener('change', () => (brush.erase = erase.checked));
      tools.append(
        btn('◀', tt('flipbookEditor.moveFrameEarlier'), () => { setOrder(orderOps.move(o, sel, -1), 'Move frame'); sel = Math.max(0, sel - 1); }),
        btn('▶', tt('flipbookEditor.moveFrameLater'), () => { setOrder(orderOps.move(o, sel, 1), 'Move frame'); sel = Math.min(o.length - 1, sel + 1); }),
        btn('Duplicate', tt('flipbookEditor.duplicateTheFrame'), () => { setOrder(orderOps.duplicate(o, sel), 'Duplicate frame'); sel++; }),
        btn('Delete', tt('flipbookEditor.removeTheFrameFrom'), () => setOrder(orderOps.remove(o, sel), 'Delete frame')),
        btn(tt('flipbookEditor.replace'), tt('flipbookEditor.replaceTheFrameWith'), () => void pickFile('image/*').then(async ([f]) => {
          if (!f || !work) return;
          const s = spec()!;
          replaceFrame(work, s, o[sel], await decodeSheetImage(f));
          await commit('Replace frame');
        })),
        btn(tt('flipbookEditor.resetOrder'), tt('flipbookEditor.restoreTheOriginalFrame'), () => setOrder(Array.from({ length: spec()!.count }, (_, i) => i), 'Reset frame order')),
        h('label', {}, 'Brush ', color), size, h('label', {}, erase, ' erase'),
      );
      drawStrip();
      drawPaint();
    }

    strip.addEventListener('pointerdown', (e) => {
      const per = (strip as HTMLCanvasElement & { _per?: number })._per ?? 1;
      const r = strip.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * strip.width;
      const y = ((e.clientY - r.top) / r.height) * strip.height;
      const i = Math.floor(y / 76) * per + Math.floor(x / 76);
      if (i >= 0 && i < order().length) {
        sel = i;
        drawStrip();
        drawPaint();
      }
    });
    paint.addEventListener('pointerdown', (e) => {
      const s = spec();
      if (!s || !work) return;
      const o = order();
      const src = o[sel];
      if (src === undefined) return;
      paint.setPointerCapture(e.pointerId);
      const hex = brush.color;
      const rgba: [number, number, number, number] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
      const dab = (ev: PointerEvent): void => {
        const r = paint.getBoundingClientRect();
        const c = cellRect(s, src);
        const u = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
        const v = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
        paintDot(work!, s, src, u, v, (brush.size * c.iw) / Math.max(1, r.width) , rgba, brush.erase);
        drawPaint();
      };
      dab(e);
      const move = (ev: PointerEvent): void => dab(ev);
      const up = (): void => {
        paint.removeEventListener('pointermove', move);
        paint.removeEventListener('pointerup', up);
        drawStrip();
        void commit('Paint frame');
      };
      paint.addEventListener('pointermove', move);
      paint.addEventListener('pointerup', up);
    });

    dis.add(app.selection.onChange.on(refresh));
    dis.add(app.project.onChange.on(() => { workUrl = ''; refresh(); }));
    const unGraph = (): (() => void) => graph().events.on((ev) => { if (ev.type === 'param' || ev.type === 'reset' || ev.type === 'structure') { if (ev.type !== 'param') workUrl = ''; queueMicrotask(refresh); } });
    let off = unGraph();
    dis.add(app.project.onChange.on(() => { off(); off = unGraph(); }));
    dis.add(() => off());
    refresh();
    return { dispose: () => dis.dispose() };
  },
});


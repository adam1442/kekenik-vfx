import { tileRegion, type Rect, type TileDisplay, type V2, type ViewTransform } from '../../gizmos/geom';
import type { ViewportSettings } from './settings';

export const RULER = 18;
const ACCENT = '#9a8dff';

export interface OverlayInput {
  ctx: CanvasRenderingContext2D;
  view: ViewTransform;
  vw: number;
  vh: number;
  s: ViewportSettings;
  td: TileDisplay;
  /** Region selected with the region tool (image pixels). */
  region: Rect | null;
  /** Inspector texel marker (image pixels), drawn as a pixel outline when zoomed in. */
  marker: { x: number; y: number; w: number; h: number } | null;
  comparePx: number | null;
  compareLabels: [string, string] | null;
  /** Lit sphere inset rect (css px) for the drag-to-light affordance. */
  sphere: [number, number, number, number] | null;
}

const poly = (ctx: CanvasRenderingContext2D, pts: V2[], close = true): void => {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  if (close) ctx.closePath();
};
const rectPts = (v: ViewTransform, r: Rect): V2[] => [v.toScreen([r.x0, r.y0]), v.toScreen([r.x1, r.y0]), v.toScreen([r.x1, r.y1]), v.toScreen([r.x0, r.y1])];

/** Everything that is NOT a gizmo: image border, tile cells, guides, thirds, safe frame, rulers, compare, region. */
export function drawViewOverlay(o: OverlayInput): void {
  const { ctx, view, vw, vh, s } = o;
  const [W, H] = view.size;
  ctx.save();
  // image border (canonical tile) + tile cell lines
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  poly(ctx, rectPts(view, { x0: 0, y0: 0, x1: W, y1: H }));
  ctx.stroke();
  if (o.td.nx !== 1 || o.td.ny !== 1) {
    const reg = tileRegion(o.td, [W, H], view.visibleImageRect(vw, vh));
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.setLineDash([3, 4]);
    const x0 = Math.round(reg.x0 / W);
    const x1 = Math.round(reg.x1 / W);
    const y0 = Math.round(reg.y0 / H);
    const y1 = Math.round(reg.y1 / H);
    let n = 0;
    for (let i = x0; i <= x1 && n < 400; i++, n++) {
      poly(ctx, [view.toScreen([i * W, reg.y0]), view.toScreen([i * W, reg.y1])], false);
      ctx.stroke();
    }
    for (let j = y0; j <= y1 && n < 800; j++, n++) {
      poly(ctx, [view.toScreen([reg.x0, j * H]), view.toScreen([reg.x1, j * H])], false);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // composition helpers (relative to the canonical image)
  if (s.thirds) {
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    for (const f of [1 / 3, 2 / 3]) {
      poly(ctx, [view.toScreen([f * W, 0]), view.toScreen([f * W, H])], false);
      ctx.stroke();
      poly(ctx, [view.toScreen([0, f * H]), view.toScreen([W, f * H])], false);
      ctx.stroke();
    }
  }
  if (s.safe) {
    ctx.setLineDash([5, 4]);
    for (const [f, c] of [[0.9, 'rgba(255,205,90,0.7)'], [0.8, 'rgba(255,140,90,0.7)']] as [number, string][]) {
      ctx.strokeStyle = c;
      poly(ctx, rectPts(view, { x0: W * (1 - f) / 2, y0: H * (1 - f) / 2, x1: W * (1 + f) / 2, y1: H * (1 + f) / 2 }));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  // guides (uv)
  ctx.strokeStyle = 'rgba(0,214,214,0.85)';
  for (const u of s.guidesU) {
    poly(ctx, [view.toScreen([u * W, -1e5]), view.toScreen([u * W, 1e5])], false);
    ctx.stroke();
  }
  for (const v of s.guidesV) {
    poly(ctx, [view.toScreen([-1e5, v * H]), view.toScreen([1e5, v * H])], false);
    ctx.stroke();
  }
  // inspected texel
  if (o.marker && view.zoom >= 6) {
    const m = o.marker;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    poly(ctx, rectPts(view, { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h }));
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 0.75;
    poly(ctx, rectPts(view, { x0: m.x - 0.05, y0: m.y - 0.05, x1: m.x + m.w + 0.05, y1: m.y + m.h + 0.05 }));
    ctx.stroke();
  }
  // region
  if (o.region) {
    ctx.fillStyle = 'rgba(154,141,255,0.12)';
    ctx.strokeStyle = ACCENT;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.25;
    poly(ctx, rectPts(view, o.region));
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // A/B divider
  if (o.comparePx !== null) {
    const v = s.compareDir === 'v';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    poly(ctx, v ? [[o.comparePx, 0], [o.comparePx, vh]] : [[0, o.comparePx], [vw, o.comparePx]], false);
    ctx.stroke();
    const c: V2 = v ? [o.comparePx, vh / 2] : [vw / 2, o.comparePx];
    ctx.fillStyle = '#16181c';
    ctx.beginPath();
    ctx.arc(c[0], c[1], 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(v ? '↔' : '↕', c[0], c[1] + 3.5);
    if (o.compareLabels) {
      ctx.textAlign = v ? 'right' : 'left';
      ctx.font = '11px system-ui, sans-serif';
      const [a, b] = o.compareLabels;
      const tag = (t: string, x: number, y: number, al: CanvasTextAlign): void => {
        ctx.textAlign = al;
        const w = ctx.measureText(t).width + 10;
        ctx.fillStyle = 'rgba(10,11,14,0.8)';
        ctx.fillRect(al === 'right' ? x - w : x, y - 13, w, 18);
        ctx.fillStyle = '#fff';
        ctx.fillText(t, al === 'right' ? x - 5 : x + 5, y);
      };
      if (v) {
        tag(`A: ${a}`, o.comparePx - 8, vh - 14, 'right');
        tag(`B: ${b}`, o.comparePx + 8, vh - 14, 'left');
      } else {
        tag(`A: ${a}`, 10, o.comparePx - 8, 'left');
        tag(`B: ${b}`, 10, o.comparePx + 22, 'left');
      }
    }
    ctx.textAlign = 'left';
  }
  // light affordance on the lit sphere inset
  if (o.sphere) {
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(o.sphere[0] + 0.5, o.sphere[1] + 0.5, o.sphere[2], o.sphere[3]);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText('drag = light', o.sphere[0] + 4, o.sphere[1] + o.sphere[3] - 5);
  }
  if (s.rulers) drawRulers(ctx, view, vw, vh);
  ctx.restore();
}

function niceStep(minPx: number, zoom: number): number {
  const raw = minPx / zoom;
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function drawRulers(ctx: CanvasRenderingContext2D, view: ViewTransform, vw: number, vh: number): void {
  const axisX = view.s.rot % 2 === 1 ? 1 : 0; // image axis that runs along screen X
  const step = niceStep(56, view.zoom);
  ctx.fillStyle = 'rgba(22,24,28,0.94)';
  ctx.fillRect(0, 0, vw, RULER);
  ctx.fillRect(0, 0, RULER, vh);
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.moveTo(0, RULER + 0.5);
  ctx.lineTo(vw, RULER + 0.5);
  ctx.moveTo(RULER + 0.5, 0);
  ctx.lineTo(RULER + 0.5, vh);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '9px ui-monospace, monospace';
  const vis = view.visibleImageRect(vw, vh);
  for (const horizontal of [true, false]) {
    const axis = horizontal ? axisX : 1 - axisX;
    const lo = axis === 0 ? vis.x0 : vis.y0;
    const hi = axis === 0 ? vis.x1 : vis.y1;
    let n = 0;
    for (let t = Math.floor(lo / step) * step; t <= hi && n < 300; t += step, n++) {
      const sp = view.toScreen(axis === 0 ? [t, 0] : [0, t]);
      const pos = horizontal ? sp[0] : sp[1];
      if (pos < RULER || pos > (horizontal ? vw : vh)) continue;
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(pos + 0.5, RULER - 6);
        ctx.lineTo(pos + 0.5, RULER);
        ctx.stroke();
        ctx.fillText(String(Math.round(t * 100) / 100), pos + 3, 10);
      } else {
        ctx.moveTo(RULER - 6, pos + 0.5);
        ctx.lineTo(RULER, pos + 0.5);
        ctx.stroke();
        ctx.save();
        ctx.translate(10, pos + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(Math.round(t * 100) / 100), 0, 0);
        ctx.restore();
      }
    }
  }
}

export function distToGuide(view: ViewTransform, axis: 0 | 1, uv: number, sp: V2): number {
  const [W, H] = view.size;
  const a = view.toScreen(axis === 0 ? [uv * W, -1e5] : [-1e5, uv * H]);
  const b = view.toScreen(axis === 0 ? [uv * W, 1e5] : [1e5, uv * H]);
  const ab: V2 = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((sp[0] - a[0]) * ab[0] + (sp[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
  return Math.hypot(sp[0] - (a[0] + ab[0] * t), sp[1] - (a[1] + ab[1] * t));
}

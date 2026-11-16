import { px } from '../ui/theme/ui-store';
import { type V2, type ViewTransform } from './geom';
import type { GizmoModel, Handle, Shape } from './types';

export interface GizmoPaint {
  hover: { key: string; handleId: string; ghost: V2 } | null;
  active: { key: string; handleId: string } | null;
  accent: string;
  /** Overlay already has setTransform(dpr...) applied: all coordinates are CSS pixels. */
  readout?: string | null;
  hoverShapes?: { model: GizmoModel; shapes: Shape[] }[];
}

const AUX = 'rgba(255,255,255,0.45)';
const HALO = 'rgba(0,0,0,0.65)';

function path(ctx: CanvasRenderingContext2D, pts: V2[], view: ViewTransform, off: V2, closed: boolean): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const s = view.toScreen([pts[i][0] + off[0], pts[i][1] + off[1]]);
    if (i === 0) ctx.moveTo(s[0], s[1]);
    else ctx.lineTo(s[0], s[1]);
  }
  if (closed) ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, view: ViewTransform, off: V2, color: string, ghost: boolean): void {
  if (s.k === 'text') {
    const p = view.toScreen([s.p[0] + off[0], s.p[1] + off[1]]);
    ctx.font = `${px(11)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = HALO;
    ctx.fillStyle = '#fff';
    ctx.strokeText(s.text, p[0] + (s.dx ?? 10), p[1] + (s.dy ?? -8));
    ctx.fillText(s.text, p[0] + (s.dx ?? 10), p[1] + (s.dy ?? -8));
    return;
  }
  const strokes: [number, string][] =
    s.role === 'aux' ? [[1, AUX]] : s.role === 'fill' ? [[0, color]] : s.role === 'strong' ? [[3, HALO], [2, color]] : [[3.5, HALO], [1.75, color]];
  ctx.setLineDash(s.dash ? [6, 4] : []);
  for (const [w, c] of strokes) {
    ctx.lineWidth = w;
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    if (s.k === 'circle') {
      const c0 = view.toScreen([s.c[0] + off[0], s.c[1] + off[1]]);
      ctx.beginPath();
      ctx.arc(c0[0], c0[1], Math.max(0.5, s.r * view.zoom), 0, Math.PI * 2);
    } else path(ctx, s.pts, view, off, !!s.closed);
    if (s.role === 'fill') {
      ctx.globalAlpha *= 0.12;
      ctx.fill();
      ctx.globalAlpha /= 0.12;
    } else ctx.stroke();
  }
  ctx.setLineDash([]);
  void ghost;
}

function drawHandle(ctx: CanvasRenderingContext2D, h: Handle, view: ViewTransform, off: V2, color: string, hot: boolean, active: boolean): void {
  if (!h.pos || h.shape === 'none') return;
  const p = view.toScreen([h.pos[0] + off[0], h.pos[1] + off[1]]);
  const r = px((h.shape === 'diamond' ? 6 : 4.5) + (hot ? 1.5 : 0) + (h.active ? 1 : 0));
  ctx.beginPath();
  switch (h.shape) {
    case 'circle':
      ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
      break;
    case 'diamond':
      ctx.moveTo(p[0], p[1] - r);
      ctx.lineTo(p[0] + r, p[1]);
      ctx.lineTo(p[0], p[1] + r);
      ctx.lineTo(p[0] - r, p[1]);
      ctx.closePath();
      break;
    case 'ring':
      ctx.arc(p[0], p[1], r + px(2), 0, Math.PI * 2);
      break;
    default:
      ctx.rect(p[0] - r, p[1] - r, r * 2, r * 2);
  }
  ctx.fillStyle = active || h.active ? color : hot ? '#ffffff' : '#e9ecf1';
  ctx.fill();
  ctx.lineWidth = 1.25;
  ctx.strokeStyle = hot || active ? color : 'rgba(0,0,0,0.85)';
  ctx.stroke();
}

/**
 * Draws gizmos on the overlay canvas. Handles are constant screen size (drawn in screen space). With tiling, ghost
 * copies are drawn dimmed at every tile offset where the shape reaches the displayed region.
 */
export function drawGizmos(ctx: CanvasRenderingContext2D, view: ViewTransform, models: readonly GizmoModel[], ghostsOf: (m: GizmoModel) => V2[], paint: GizmoPaint): void {
  const size = view.size;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const m of models) {
    const color = m.color ?? paint.accent;
    const offsets: [V2, boolean][] = [...ghostsOf(m).map((g): [V2, boolean] => [[g[0] * size[0], g[1] * size[1]], true]), [[0, 0], false]];
    for (const [off, ghost] of offsets) {
      ctx.globalAlpha = ghost ? 0.38 : 1;
      for (const s of m.shapes) drawShape(ctx, s, view, off, color, ghost);
      const gOff: V2 = ghost ? [off[0] / size[0], off[1] / size[1]] : [0, 0];
      for (const h of m.handles) {
        const hot = !!paint.hover && paint.hover.key === m.key && paint.hover.handleId === h.id && paint.hover.ghost[0] === gOff[0] && paint.hover.ghost[1] === gOff[1];
        const act = !!paint.active && paint.active.key === m.key && paint.active.handleId === h.id && !ghost;
        drawHandle(ctx, h, view, off, color, hot, act);
      }
    }
    ctx.globalAlpha = 1;
  }
  for (const hs of paint.hoverShapes ?? []) for (const s of hs.shapes) drawShape(ctx, s, view, [0, 0], hs.model.color ?? paint.accent, false);
  if (paint.readout) {
    ctx.font = `${px(12)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const w = ctx.measureText(paint.readout).width + px(14);
    ctx.fillStyle = 'rgba(10,11,14,0.9)';
    ctx.fillRect(px(10), px(40), w, px(22));
    ctx.fillStyle = '#fff';
    ctx.fillText(paint.readout, px(17), px(55));
  }
  ctx.restore();
}

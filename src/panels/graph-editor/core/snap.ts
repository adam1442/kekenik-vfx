import type { Rect } from './geometry';

/**
 * Snapping while dragging: alignment guides against other nodes (edges + centres) take priority per axis, otherwise the
 * moving box snaps to the grid. Pure: returns the correction to add and the guide lines to draw (world coordinates).
 */
export interface Guide {
  axis: 'x' | 'y';
  /** World coordinate of the guide line. */
  pos: number;
  from: number;
  to: number;
}
export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

export function snapMove(box: Rect, others: Rect[], opts: { grid: number | null; threshold: number }): SnapResult {
  const th = opts.threshold;
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  let bestX: { d: number; pos: number; o: Rect } | null = null;
  let bestY: { d: number; pos: number; o: Rect } | null = null;
  for (const o of others) {
    const oxs = [o.x, o.x + o.w / 2, o.x + o.w];
    const oys = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const a of xs)
      for (const b of oxs) {
        const d = b - a;
        if (Math.abs(d) <= th && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: b, o };
      }
    for (const a of ys)
      for (const b of oys) {
        const d = b - a;
        if (Math.abs(d) <= th && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: b, o };
      }
  }
  let dx = 0,
    dy = 0;
  const guides: Guide[] = [];
  if (bestX) dx = bestX.d;
  else if (opts.grid) dx = Math.round(box.x / opts.grid) * opts.grid - box.x;
  if (bestY) dy = bestY.d;
  else if (opts.grid) dy = Math.round(box.y / opts.grid) * opts.grid - box.y;
  const moved: Rect = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  if (bestX) guides.push({ axis: 'x', pos: bestX.pos, from: Math.min(moved.y, bestX.o.y), to: Math.max(moved.y + moved.h, bestX.o.y + bestX.o.h) });
  if (bestY) guides.push({ axis: 'y', pos: bestY.pos, from: Math.min(moved.x, bestY.o.x), to: Math.max(moved.x + moved.w, bestY.o.x + bestY.o.w) });
  return { dx, dy, guides };
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';
/** Align/distribute on rects; returns new top-left per id. */
export function alignRects(items: { id: string; r: Rect }[], mode: AlignMode): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  if (items.length < 2) return out;
  const minX = Math.min(...items.map((i) => i.r.x)),
    maxX = Math.max(...items.map((i) => i.r.x + i.r.w)),
    minY = Math.min(...items.map((i) => i.r.y)),
    maxY = Math.max(...items.map((i) => i.r.y + i.r.h));
  for (const { id, r } of items) {
    let x = r.x,
      y = r.y;
    if (mode === 'left') x = minX;
    else if (mode === 'right') x = maxX - r.w;
    else if (mode === 'hcenter') x = (minX + maxX) / 2 - r.w / 2;
    else if (mode === 'top') y = minY;
    else if (mode === 'bottom') y = maxY - r.h;
    else y = (minY + maxY) / 2 - r.h / 2;
    out.set(id, [Math.round(x), Math.round(y)]);
  }
  return out;
}
export function distributeRects(items: { id: string; r: Rect }[], axis: 'x' | 'y'): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  if (items.length < 3) return out;
  const key = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'w' : 'h';
  const sorted = [...items].sort((a, b) => a.r[key] - b.r[key]);
  const first = sorted[0].r,
    last = sorted[sorted.length - 1].r;
  const total = last[key] + last[size] - first[key];
  const used = sorted.reduce((s, i) => s + i.r[size], 0);
  const gap = (total - used) / (sorted.length - 1);
  let cur = first[key];
  for (const { id, r } of sorted) {
    out.set(id, axis === 'x' ? [Math.round(cur), r.y] : [r.x, Math.round(cur)]);
    cur += r[size] + gap;
  }
  return out;
}

import type { Rect } from './geometry';

/**
 * Uniform grid spatial index: O(visible) viewport culling, point hit-testing and marquee queries for 500+ nodes.
 * Rebuilt in O(n) whenever positions change (cheap: ~0.05 ms for 500 nodes).
 */
export class SpatialGrid {
  private cells = new Map<number, string[]>();
  private rects = new Map<string, Rect>();
  constructor(private cell = 256) {}

  private key(cx: number, cy: number): number {
    return (cx + 32768) * 65536 + (cy + 32768);
  }
  clear(): void {
    this.cells.clear();
    this.rects.clear();
  }
  get size(): number {
    return this.rects.size;
  }
  rectOf(id: string): Rect | undefined {
    return this.rects.get(id);
  }
  insert(id: string, r: Rect): void {
    this.rects.set(id, r);
    const c = this.cell;
    const x0 = Math.floor(r.x / c),
      x1 = Math.floor((r.x + r.w) / c),
      y0 = Math.floor(r.y / c),
      y1 = Math.floor((r.y + r.h) / c);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const l = this.cells.get(k);
        if (l) l.push(id);
        else this.cells.set(k, [id]);
      }
  }
  /** Ids whose rect intersects `q` (each id once, unordered). */
  query(q: Rect): string[] {
    const c = this.cell;
    const seen = new Set<string>();
    const out: string[] = [];
    const x0 = Math.floor(q.x / c),
      x1 = Math.floor((q.x + q.w) / c),
      y0 = Math.floor(q.y / c),
      y1 = Math.floor((q.y + q.h) / c);
    // Huge queries (zoomed far out): scanning every rect is cheaper than walking empty cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > this.cells.size * 2 + 16) {
      for (const [id, r] of this.rects) if (r.x <= q.x + q.w && r.x + r.w >= q.x && r.y <= q.y + q.h && r.y + r.h >= q.y) out.push(id);
      return out;
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const l = this.cells.get(this.key(cx, cy));
        if (!l) continue;
        for (const id of l) {
          if (seen.has(id)) continue;
          seen.add(id);
          const r = this.rects.get(id)!;
          if (r.x <= q.x + q.w && r.x + r.w >= q.x && r.y <= q.y + q.h && r.y + r.h >= q.y) out.push(id);
        }
      }
    return out;
  }
  queryPoint(x: number, y: number, pad = 0): string[] {
    return this.query({ x: x - pad, y: y - pad, w: 2 * pad, h: 2 * pad });
  }
}

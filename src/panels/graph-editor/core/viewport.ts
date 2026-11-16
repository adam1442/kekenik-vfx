import type { Pt, Rect } from './geometry';

/** Camera of the infinite canvas: screen = world * zoom + (x, y). */
export interface View {
  x: number;
  y: number;
  zoom: number;
}
export const MIN_ZOOM = 0.04;
export const MAX_ZOOM = 3;
export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });
export const toWorld = (v: View, p: Pt): Pt => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });
export function visibleWorldRect(v: View, w: number, h: number, margin = 0): Rect {
  return { x: (-v.x - margin) / v.zoom, y: (-v.y - margin) / v.zoom, w: (w + 2 * margin) / v.zoom, h: (h + 2 * margin) / v.zoom };
}
/** Zoom keeping the world point under the screen position (sx, sy) fixed (zoom to cursor). */
export function zoomAt(v: View, sx: number, sy: number, zoom: number): View {
  const z = clampZoom(zoom);
  const wx = (sx - v.x) / v.zoom,
    wy = (sy - v.y) / v.zoom;
  return { zoom: z, x: sx - wx * z, y: sy - wy * z };
}
/** View that centres `r` in a w x h viewport with padding (screen px). Single nodes are not zoomed in beyond maxZoom. */
export function frameRect(r: Rect, w: number, h: number, pad = 60, maxZoom = 1.1): View {
  const aw = Math.max(1, w - 2 * pad),
    ah = Math.max(1, h - 2 * pad);
  const z = clampZoom(Math.min(maxZoom, aw / Math.max(1, r.w), ah / Math.max(1, r.h)));
  return { zoom: z, x: w / 2 - (r.x + r.w / 2) * z, y: h / 2 - (r.y + r.h / 2) * z };
}
export const viewCentre = (v: View, w: number, h: number): Pt => toWorld(v, { x: w / 2, y: h / 2 });
export const viewAtCentre = (c: Pt, zoom: number, w: number, h: number): View => ({ zoom, x: w / 2 - c.x * zoom, y: h / 2 - c.y * zoom });

/**
 * Smooth camera. Two modes: `focusTo` (animate centre + zoom: F / A / bookmarks) and `zoomTo` (animated zoom anchored on
 * a screen point: wheel). Frame-rate independent exponential smoothing; `step` returns true while still animating.
 */
export class ViewAnimator {
  view: View = { x: 0, y: 0, zoom: 1 };
  private mode: 'none' | 'focus' | 'anchor' = 'none';
  private tc: Pt = { x: 0, y: 0 };
  private tz = 1;
  private anchorS: Pt = { x: 0, y: 0 };
  private anchorW: Pt = { x: 0, y: 0 };
  /** Higher = snappier. */
  rate = 16;

  get animating(): boolean {
    return this.mode !== 'none';
  }
  set(v: View): void {
    this.view = { ...v };
    this.mode = 'none';
  }
  focusTo(target: View, w: number, h: number): void {
    this.tz = clampZoom(target.zoom);
    this.tc = viewCentre(target, w, h);
    this.mode = 'focus';
  }
  zoomTo(sx: number, sy: number, zoom: number): void {
    // Accumulate wheel notches on the existing target so fast scrolling keeps its momentum.
    if (this.mode !== 'anchor') {
      this.anchorS = { x: sx, y: sy };
      this.anchorW = toWorld(this.view, this.anchorS);
    } else if (Math.abs(sx - this.anchorS.x) > 1 || Math.abs(sy - this.anchorS.y) > 1) {
      this.anchorS = { x: sx, y: sy };
      this.anchorW = toWorld(this.view, this.anchorS);
    }
    this.tz = clampZoom(zoom);
    this.mode = 'anchor';
  }
  /** Target zoom while an anchored zoom is in flight (so consecutive wheel events compound). */
  get targetZoom(): number {
    return this.mode === 'anchor' ? this.tz : this.view.zoom;
  }
  step(dt: number, w: number, h: number): boolean {
    if (this.mode === 'none') return false;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * this.rate);
    const lz = Math.log(this.view.zoom);
    const nz = Math.exp(lz + (Math.log(this.tz) - lz) * k);
    const done = Math.abs(Math.log(this.tz) - Math.log(nz)) < 0.0015;
    const z = done ? this.tz : nz;
    if (this.mode === 'anchor') {
      this.view = { zoom: z, x: this.anchorS.x - this.anchorW.x * z, y: this.anchorS.y - this.anchorW.y * z };
      if (done) this.mode = 'none';
      return !done;
    }
    const c = viewCentre(this.view, w, h);
    const nc = { x: c.x + (this.tc.x - c.x) * k, y: c.y + (this.tc.y - c.y) * k };
    const close = done && Math.hypot(this.tc.x - nc.x, this.tc.y - nc.y) * z < 0.4;
    const cc = close ? this.tc : nc;
    this.view = viewAtCentre(cc, z, w, h);
    if (close) this.mode = 'none';
    return !close;
  }
}

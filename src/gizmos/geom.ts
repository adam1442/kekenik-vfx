/**
 * Gizmo geometry: 2D vector helpers, the view transform (image-pixel space <-> screen), tiling ghost logic.
 *
 * COORDINATE SPACES
 *   uv   : normalised image space, (0,0) top-left, y down. What params usually store.
 *   ip   : "image pixels" = uv * [W,H] of the reference image. ALL gizmo geometry lives here, because ip -> screen
 *          is a similarity transform (zoom + 90 degree rotation + flips), so circles stay circles on non-square images.
 *   sp   : screen (CSS) pixels relative to the viewport element.
 */
export type V2 = [number, number];
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const v2 = {
  add: (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]],
  sub: (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]],
  mul: (a: V2, k: number): V2 => [a[0] * k, a[1] * k],
  mulv: (a: V2, b: V2): V2 => [a[0] * b[0], a[1] * b[1]],
  divv: (a: V2, b: V2): V2 => [a[0] / b[0], a[1] / b[1]],
  dot: (a: V2, b: V2): number => a[0] * b[0] + a[1] * b[1],
  len: (a: V2): number => Math.hypot(a[0], a[1]),
  dist: (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]),
  lerp: (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  /** Rotate by `a` radians (positive = clockwise on a y-down screen). */
  rot: (a: V2, ang: number): V2 => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
  },
  angle: (a: V2): number => Math.atan2(a[1], a[0]),
  norm: (a: V2): V2 => {
    const l = Math.hypot(a[0], a[1]);
    return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
  },
  perp: (a: V2): V2 => [-a[1], a[0]],
  eq: (a: V2, b: V2, eps = 1e-9): boolean => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps,
};

export const DEG = Math.PI / 180;
export const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** Wrap an angle to (-PI, PI]. */
export const wrapAngle = (a: number): number => {
  const t = (((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return t - Math.PI;
};
/** Representative of `a` (mod 2PI) closest to `ref`: keeps angle drags continuous across the +-PI seam. */
export const unwrapNear = (a: number, ref: number): number => a + Math.round((ref - a) / (2 * Math.PI)) * 2 * Math.PI;

export const rectOf = (pts: V2[]): Rect => {
  const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of pts) {
    r.x0 = Math.min(r.x0, p[0]);
    r.y0 = Math.min(r.y0, p[1]);
    r.x1 = Math.max(r.x1, p[0]);
    r.y1 = Math.max(r.y1, p[1]);
  }
  return r;
};
export const rectUnion = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
export const rectIntersects = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
export const rectGrow = (r: Rect, m: number): Rect => ({ x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
export const rectShift = (r: Rect, d: V2): Rect => ({ x0: r.x0 + d[0], y0: r.y0 + d[1], x1: r.x1 + d[0], y1: r.y1 + d[1] });
export const circleRect = (c: V2, r: number): Rect => ({ x0: c[0] - r, y0: c[1] - r, x1: c[0] + r, y1: c[1] + r });

/* ------------------------------------------------------------------------------------------------ view */
export interface ViewState {
  /** CSS pixels per image pixel. */
  zoom: number;
  /** Screen position (CSS px) of the IMAGE CENTRE. */
  cx: number;
  cy: number;
  /** Quarter turns clockwise (0..3). */
  rot: 0 | 1 | 2 | 3;
  flipX: boolean;
  flipY: boolean;
  /** Reference image size in ip (full resolution, NOT the preview-scaled texture). */
  imgW: number;
  imgH: number;
}

export const defaultView = (imgW = 1024, imgH = 1024): ViewState => ({ zoom: 1, cx: 0, cy: 0, rot: 0, flipX: false, flipY: false, imgW, imgH });

const rotQ = (v: V2, k: number): V2 => {
  switch (((k % 4) + 4) % 4) {
    case 1:
      return [-v[1], v[0]];
    case 2:
      return [-v[0], -v[1]];
    case 3:
      return [v[1], -v[0]];
    default:
      return v;
  }
};

/** ip <-> screen. forward: q = ip - centre; flip; rotate k quarter turns clockwise; * zoom; + (cx,cy). */
export class ViewTransform {
  constructor(readonly s: ViewState) {}
  get zoom(): number {
    return this.s.zoom;
  }
  get size(): V2 {
    return [this.s.imgW, this.s.imgH];
  }
  toScreen(ip: V2): V2 {
    const s = this.s;
    let q: V2 = [ip[0] - s.imgW / 2, ip[1] - s.imgH / 2];
    if (s.flipX) q[0] = -q[0];
    if (s.flipY) q[1] = -q[1];
    q = rotQ(q, s.rot);
    return [s.cx + q[0] * s.zoom, s.cy + q[1] * s.zoom];
  }
  toImage(sp: V2): V2 {
    const s = this.s;
    let q: V2 = [(sp[0] - s.cx) / s.zoom, (sp[1] - s.cy) / s.zoom];
    q = rotQ(q, -s.rot);
    if (s.flipX) q[0] = -q[0];
    if (s.flipY) q[1] = -q[1];
    return [q[0] + s.imgW / 2, q[1] + s.imgH / 2];
  }
  toUv(sp: V2): V2 {
    const p = this.toImage(sp);
    return [p[0] / this.s.imgW, p[1] / this.s.imgH];
  }
  /** Row-major 2x2 [m00,m01,m10,m11] with q = M * ((screen - centre) / zoom) (what the display shader needs). */
  inverseMatrix(): [number, number, number, number] {
    const a = this.toImage([this.s.cx + 1 * this.s.zoom, this.s.cy]);
    const b = this.toImage([this.s.cx, this.s.cy + 1 * this.s.zoom]);
    const o = this.toImage([this.s.cx, this.s.cy]);
    return [a[0] - o[0], b[0] - o[0], a[1] - o[1], b[1] - o[1]];
  }
  /** Forward 2x2 (ip delta -> screen delta per unit zoom). */
  forwardMatrix(): [number, number, number, number] {
    const o = this.toScreen([this.s.imgW / 2, this.s.imgH / 2]);
    const a = this.toScreen([this.s.imgW / 2 + 1, this.s.imgH / 2]);
    const b = this.toScreen([this.s.imgW / 2, this.s.imgH / 2 + 1]);
    const z = this.s.zoom;
    return [(a[0] - o[0]) / z, (b[0] - o[0]) / z, (a[1] - o[1]) / z, (b[1] - o[1]) / z];
  }
  /** Image-pixel rectangle covered by a screen rectangle (axis aligned bounds, valid for any rotation). */
  visibleImageRect(viewW: number, viewH: number): Rect {
    return rectOf([this.toImage([0, 0]), this.toImage([viewW, 0]), this.toImage([0, viewH]), this.toImage([viewW, viewH])]);
  }
  /** Screen length -> image-pixel length (constant screen-size handles use this). */
  px(n: number): number {
    return n / this.s.zoom;
  }
}

/** View that fits the image inside the viewport with a margin (respects rotation). */
export function fitView(s: ViewState, viewW: number, viewH: number, margin = 24): ViewState {
  const quarter = s.rot % 2 === 1;
  const w = quarter ? s.imgH : s.imgW;
  const h = quarter ? s.imgW : s.imgH;
  const zoom = Math.max(0.01, Math.min((viewW - margin * 2) / w, (viewH - margin * 2) / h));
  return { ...s, zoom, cx: viewW / 2, cy: viewH / 2 };
}

/** Zoom keeping the image point under `sp` fixed (cursor-centred zoom). */
export function zoomAt(s: ViewState, sp: V2, factor: number, minZoom = 0.02, maxZoom = 256): ViewState {
  const before = new ViewTransform(s);
  const ip = before.toImage(sp);
  const zoom = clampN(s.zoom * factor, minZoom, maxZoom);
  const probe = new ViewTransform({ ...s, zoom, cx: 0, cy: 0 });
  const o = probe.toScreen(ip);
  return { ...s, zoom, cx: sp[0] - o[0], cy: sp[1] - o[1] };
}

/* ------------------------------------------------------------------------------------------------ tiling */
/** How many copies of the image the viewport displays per axis (1 = single image, 0 = infinite repeat). */
export interface TileDisplay {
  nx: number;
  ny: number;
}

/**
 * The region (ip) in which image copies are displayed. Finite N: copies 0..N-1 centred around the canonical tile
 * (index range [-floor((N-1)/2), +N)), infinite: the visible rectangle (+ one tile of slack).
 */
export function tileRegion(td: TileDisplay, size: V2, visible: Rect): Rect {
  const axis = (n: number, sz: number, v0: number, v1: number): [number, number] => {
    if (n === 0) return [Math.floor(v0 / sz) * sz, Math.ceil(v1 / sz) * sz];
    const lo = -Math.floor((n - 1) / 2) + 0; // (+0 normalises -0)
    return [lo * sz, (lo + n) * sz];
  };
  const [x0, x1] = axis(td.nx, size[0], visible.x0, visible.x1);
  const [y0, y1] = axis(td.ny, size[1], visible.y0, visible.y1);
  return { x0, y0, x1, y1 };
}

/** Shader-side region in UV (same maths as tileRegion, divided by the size). */
export const tileRegionUv = (td: TileDisplay, size: V2, visible: Rect): { lo: V2; hi: V2 } => {
  const r = tileRegion(td, size, visible);
  return { lo: [r.x0 / size[0], r.y0 / size[1]], hi: [r.x1 / size[0], r.y1 / size[1]] };
};

export const MAX_GHOSTS = 48;

/**
 * Integer tile offsets (i,j) != (0,0) at which a gizmo with image-pixel bounds `bounds` must be drawn again: the copies
 * of the shape that fall into the displayed `region`. Only axes that wrap are considered (`wrapX/Y`: the node tiles,
 * or the viewport displays repeated copies). Sorted by distance from the canonical tile; capped at MAX_GHOSTS.
 */
export function ghostOffsets(bounds: Rect, size: V2, region: Rect, wrapX: boolean, wrapY: boolean): V2[] {
  const rng = (b0: number, b1: number, r0: number, r1: number, sz: number, wrap: boolean): [number, number] => {
    if (!wrap) return [0, 0];
    // tile index i such that [b0 + i*sz, b1 + i*sz] overlaps [r0, r1]
    return [Math.floor((r0 - b1) / sz) + 1, Math.ceil((r1 - b0) / sz) - 1];
  };
  const [ix0, ix1] = rng(bounds.x0, bounds.x1, region.x0, region.x1, size[0], wrapX);
  const [iy0, iy1] = rng(bounds.y0, bounds.y1, region.y0, region.y1, size[1], wrapY);
  const out: V2[] = [];
  for (let j = iy0; j <= iy1; j++) for (let i = ix0; i <= ix1; i++) if (i !== 0 || j !== 0) out.push([i, j]);
  out.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - Math.abs(b[0]) - Math.abs(b[1]));
  return out.length > MAX_GHOSTS ? out.slice(0, MAX_GHOSTS) : out;
}

import type { ExpandedNode } from '../../../engine/graph/expand';
import type { NodeUi } from '../../../engine/graph/annotations';
import type { PinType } from '../../../engine/types';

/**
 * Pure geometry for the graph editor: node layout (pin positions, thumbnail rect), link routing, hit-testing helpers.
 * No DOM, no GPU: everything here is unit-tested (tests/graph-editor.test.ts). Units are WORLD units (1 = 1 CSS px at zoom 1).
 */
export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rectContains = (r: Rect, x: number, y: number): boolean => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
export const rectsIntersect = (a: Rect, b: Rect): boolean => a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const rectInflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
export const rectCenter = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export function rectUnion(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const rectFromPoints = (a: Pt, b: Pt): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/* ------------------------------------------------------------------------------------------ node layout */
export const NODE = {
  minW: 120,
  defaultW: 176,
  maxW: 560,
  headerH: 26,
  rowH: 19,
  padY: 6,
  thumbPad: 8,
  footerH: 17,
  pinHit: 9,
  gridSize: 20,
} as const;

export type PinShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'hex' | 'ring';
/** Pin dot shape by data type (colour comes from PIN_COLORS): readable even for colour-blind users. */
export const PIN_SHAPES: Record<PinType, PinShape> = {
  gray: 'circle',
  color: 'ring',
  normal: 'triangle',
  uv: 'square',
  mesh: 'hex',
  points: 'diamond',
  scalar: 'circle',
  vector: 'diamond',
  curve: 'square',
  gradient: 'ring',
  flipbook: 'hex', camera: 'triangle',
  spline: 'diamond',
};

export interface PinGeo {
  id: string;
  name: string;
  type: PinType;
  side: 'in' | 'out';
  /** Position relative to the node origin. */
  x: number;
  y: number;
  optional: boolean;
  isMod: boolean;
  role?: string;
  tooltip?: string;
}
export interface NodeLayout {
  w: number;
  h: number;
  collapsed: boolean;
  inputs: PinGeo[];
  outputs: PinGeo[];
  /** Thumbnail rectangle (local), null for nodes without a texture output or when collapsed. */
  thumb: Rect | null;
  footerY: number;
  /** Local rects of header buttons. */
  buttons: { collapse: Rect; bypass: Rect; view2d: Rect; view3d: Rect; lock: Rect; edit: Rect };
}

export const isModPin = (p: { id: string; role?: string }): boolean => p.role === 'modulation' || p.id.endsWith('_mod');

export function nodeWidth(ui: NodeUi | undefined): number {
  return Math.min(NODE.maxW, Math.max(NODE.minW, ui?.w ?? NODE.defaultW));
}

/**
 * Compute the local layout of a node. Modulation pins are hidden unless connected or `ui.showMods` (keeps nodes compact).
 * `ex` undefined = unknown node type (kept in the graph but cannot evaluate): drawn as a plain block.
 */
export function computeNodeLayout(ex: ExpandedNode | undefined, ui: NodeUi | undefined, connectedInputs: ReadonlySet<string>): NodeLayout {
  const w = nodeWidth(ui);
  const collapsed = !!ui?.collapsed;
  const H = NODE.headerH;
  const ins = (ex?.inputs ?? []).filter((p) => !isModPin(p) || connectedInputs.has(p.id) || !!ui?.showMods);
  const outs = ex?.outputs ?? [];
  const mk = (p: { id: string; name: string; type: PinType; optional?: boolean; role?: string; tooltip?: string }, side: 'in' | 'out', row: number): PinGeo => ({
    id: p.id,
    name: p.name,
    type: p.type,
    side,
    x: side === 'in' ? 0 : w,
    y: collapsed ? H / 2 : H + NODE.padY + row * NODE.rowH + NODE.rowH / 2,
    optional: !!p.optional,
    isMod: isModPin(p),
    role: p.role,
    tooltip: p.tooltip,
  });
  const inputs = ins.map((p, i) => mk(p, 'in', i));
  const outputs = outs.map((p, i) => mk(p, 'out', i));
  const btn = (i: number): Rect => ({ x: w - 18 - i * 17, y: 5, w: 15, h: 16 });
  const buttons = { collapse: btn(0), bypass: btn(1), view2d: btn(2), view3d: btn(3), lock: btn(4), edit: btn(5) };
  if (collapsed) return { w, h: H, collapsed, inputs, outputs, thumb: null, footerY: H, buttons };
  const rows = Math.max(inputs.length, outputs.length, 1);
  const hasThumb = !!ex?.primaryTexture;
  const rowsBottom = H + NODE.padY + rows * NODE.rowH;
  if (!hasThumb) return { w, h: rowsBottom + NODE.padY, collapsed, inputs, outputs, thumb: null, footerY: rowsBottom, buttons };
  const side = w - 2 * NODE.thumbPad;
  const thumb: Rect = { x: NODE.thumbPad, y: rowsBottom + 4, w: side, h: side };
  const footerY = thumb.y + side + 2;
  return { w, h: footerY + NODE.footerH, collapsed, inputs, outputs, thumb, footerY, buttons };
}

/* ------------------------------------------------------------------------------------------ links */
export type LinkStyle = 'bezier' | 'orthogonal' | 'straight';

export function bezierControls(a: Pt, b: Pt): [Pt, Pt] {
  const dx = b.x - a.x;
  const d = dx >= 0 ? Math.max(36, dx * 0.5) : Math.min(280, 56 + -dx * 0.5);
  return [
    { x: a.x + d, y: a.y },
    { x: b.x - d, y: b.y },
  ];
}

/** Vertices of the orthogonal route (a -> ... -> b). */
export function orthogonalPoints(a: Pt, b: Pt): Pt[] {
  const s = 22;
  if (b.x - a.x >= 2 * s) {
    const mx = Math.round((a.x + b.x) / 2);
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const my = (a.y + b.y) / 2 + (Math.abs(a.y - b.y) < 30 ? 60 : 0);
  return [a, { x: a.x + s, y: a.y }, { x: a.x + s, y: my }, { x: b.x - s, y: my }, { x: b.x - s, y: b.y }, b];
}

/** Sampled polyline of a link (hit-testing, cull boxes, link cutting). */
export function linkSamples(a: Pt, b: Pt, style: LinkStyle, n = 20): Pt[] {
  if (style === 'straight') return [a, b];
  if (style === 'orthogonal') return orthogonalPoints(a, b);
  const [c1, c2] = bezierControls(a, b);
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const k0 = u * u * u,
      k1 = 3 * u * u * t,
      k2 = 3 * u * t * t,
      k3 = t * t * t;
    pts.push({ x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x, y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y });
  }
  return pts;
}

/** Conservative bounding box of a link (control polygon) for viewport culling. */
export function linkBounds(a: Pt, b: Pt, style: LinkStyle): Rect {
  if (style === 'straight') return rectFromPoints(a, b);
  if (style === 'orthogonal') return rectUnion(orthogonalPoints(a, b).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
  const [c1, c2] = bezierControls(a, b);
  return rectUnion([a, c1, c2, b].map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x,
    vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
export function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, distToSegment(p, pts[i], pts[i + 1]));
  return best;
}
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c),
    d2 = o(a, b, d),
    d3 = o(c, d, a),
    d4 = o(c, d, b);
  // <= so a cutter passing exactly through a sampled vertex still counts; (0,0,..) = collinear overlap is ignored
  if (d1 === 0 && d2 === 0) return false;
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}
export function polylineIntersectsSegment(pts: Pt[], c: Pt, d: Pt): boolean {
  for (let i = 0; i < pts.length - 1; i++) if (segmentsIntersect(pts[i], pts[i + 1], c, d)) return true;
  return false;
}

/** Closest point parameter on a polyline: returns the segment index and the point (used to insert reroutes). */
export function closestOnPolyline(p: Pt, pts: Pt[]): { point: Pt; index: number; dist: number } {
  let best = { point: pts[0], index: 0, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i],
      b = pts[i + 1];
    const vx = b.x - a.x,
      vy = b.y - a.y;
    const l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
    const q = { x: a.x + t * vx, y: a.y + t * vy };
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best.dist) best = { point: q, index: i, dist: d };
  }
  return best;
}

export const snapToGrid = (v: number, g: number): number => Math.round(v / g) * g;

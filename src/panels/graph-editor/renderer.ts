import type { FrameData } from '../../engine/graph/annotations';
import { CATEGORIES } from '../../engine/graph/categories';
import { trNodeLabel, trTerm } from '../../shared/i18n';
import type { EvalTarget } from '../../engine/graph/evaluator';
import { canConnect, PIN_COLORS } from '../../engine/graph/pins';
import type { LinkData } from '../../engine/graph/graph';
import type { PinType } from '../../engine/types';
import { iconMarkup } from '../../ui/icons';
import { bezierControls, NODE, orthogonalPoints, PIN_SHAPES, rectsIntersect, type LinkStyle, type PinGeo, type PinShape, type Pt, type Rect } from './core/geometry';
import { FRAME_BAR_H, type GraphScene, type LinkSegment, type PinHit } from './core/scene';
import type { Guide } from './core/snap';
import { visibleWorldRect, type View } from './core/viewport';
import type { NodeInfo, ThumbItem, ThumbnailLayer } from './thumbnails';

/**
 * Canvas2D renderer of the graph: grid, frames, links, notes, nodes, reroutes, interaction overlays.
 * Only VISIBLE items are drawn (spatial index + link bbox culling) and the level of detail drops with zoom:
 *   zoom >= 0.55  full node (titles, pin labels, footer, buttons)
 *   0.30 - 0.55   header title + pin dots + thumbnail
 *   < 0.30        coloured block + thumbnail only (500 nodes stay at 60 fps)
 * Thumbnails are not drawn here: the renderer punches transparent holes (destination-out) and reports the device-pixel
 * rectangles; the WebGPU layer behind this canvas fills them (see thumbnails.ts).
 */
export const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface LinkDragView {
  /** Side of the pin the user holds: 'out' = dragging from an output (looking for inputs). */
  side: 'out' | 'in';
  anchor: PinHit;
  pointer: Pt;
  snap: PinHit | null;
  /** Node highlighted as a drop target (body drop). */
  dropNode: string | null;
  valid: boolean | null;
  /** Nodes that would create a cycle with the anchor (precomputed once per drag). */
  forbidden: ReadonlySet<string>;
  /** Extra anchors drawn as ghosts (ctrl-drag moving all links of a pin). */
  extra?: Pt[];
}

export interface RenderState {
  view: View;
  width: number;
  height: number;
  dpr: number;
  time: number;
  selNodes: ReadonlySet<string>;
  selFrames: ReadonlySet<string>;
  selNotes: ReadonlySet<string>;
  selReroutes: ReadonlySet<string>;
  selLinks: ReadonlySet<string>;
  hoverNode: string | null;
  hoverPin: { node: string; pin: string; side: 'in' | 'out' } | null;
  hoverButton: { node: string; button: string } | null;
  hoverLink: string | null;
  hoverFrame: string | null;
  hoverResize: string | null;
  errors: ReadonlyMap<string, string>;
  info: ReadonlyMap<string, NodeInfo>;
  active: EvalTarget | null;
  thumbs: ThumbnailLayer | null;
  linkDrag: LinkDragView | null;
  marquee: Rect | null;
  cutLine: [Pt, Pt] | null;
  guides: Guide[];
  flow: boolean;
  matches: ReadonlySet<string>;
  editingNode: string | null;
  linkStyle: LinkStyle;
  /** Global settings used for nominal resolution text. */
  nominal: { w: number; h: number; bits: 16 | 32 };
  showGrid: boolean;
}

export interface RenderOutput {
  thumbs: ThumbItem[];
  visibleNodes: string[];
  drawnLinks: number;
  drawnNodes: number;
}

/* ------------------------------------------------------------------------------------------ small helpers */
const hexCache = new Map<string, [number, number, number]>();
function parseColor(c: string): [number, number, number] {
  let v = hexCache.get(c);
  if (v) return v;
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m3 = /^#([0-9a-f]{3})$/i.exec(c);
    v = m3 ? [...m3[1]].map((x) => parseInt(x + x, 16)) as [number, number, number] : [128, 128, 128];
  }
  hexCache.set(c, v);
  return v;
}
export const rgba = (c: string, a: number): string => {
  const [r, g, b] = parseColor(c);
  return `rgba(${r},${g},${b},${a})`;
};
export const mixColor = (a: string, b: string, t: number): string => {
  const A = parseColor(a),
    B = parseColor(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
};

/** Rasterised icon cache: draws the app's SVG icon set into the canvas (images load async, then trigger a redraw). */
export class IconCache {
  private imgs = new Map<string, HTMLImageElement>();
  constructor(private onLoad: () => void) {}
  get(name: string, color: string): HTMLImageElement | null {
    const key = `${name}|${color}`;
    let img = this.imgs.get(key);
    if (!img) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(name).replace(/class="fill"/g, `fill="${color}" stroke="none"`)}</svg>`;
      img = new Image();
      img.onload = () => this.onLoad();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      this.imgs.set(key, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
}

function pinPath(ctx: CanvasRenderingContext2D, shape: PinShape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'square':
      ctx.rect(x - r * 0.88, y - r * 0.88, r * 1.76, r * 1.76);
      break;
    case 'diamond':
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r * 1.2, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r * 1.2, y);
      ctx.closePath();
      break;
    case 'triangle':
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r * 1.1, y + r * 0.9);
      ctx.lineTo(x - r * 1.1, y + r * 0.9);
      ctx.closePath();
      break;
    case 'hex':
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        const px = x + Math.cos(a) * r * 1.1,
          py = y + Math.sin(a) * r * 1.1;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

export class GraphRenderer {
  private textCache = new Map<string, string>();
  private wrapCache = new Map<string, string[]>();
  readonly icons: IconCache;
  /** Statistics of the last frame (stress page / diagnostics). */
  last: RenderOutput = { thumbs: [], visibleNodes: [], drawnLinks: 0, drawnNodes: 0 };

  constructor(
    private ctx: CanvasRenderingContext2D,
    private scene: GraphScene,
    onIconLoad: () => void,
  ) {
    this.icons = new IconCache(onIconLoad);
  }

  /* ---------------------------------------------------------------------------- text */
  private fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
    const key = `${ctx.font}|${maxW | 0}|${text}`;
    const c = this.textCache.get(key);
    if (c !== undefined) return c;
    let out = text;
    if (ctx.measureText(text).width > maxW) {
      let lo = 0,
        hi = text.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
        else hi = mid - 1;
      }
      out = text.slice(0, lo) + '…';
    }
    if (this.textCache.size > 3000) this.textCache.clear();
    this.textCache.set(key, out);
    return out;
  }
  private wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
    const key = `${ctx.font}|${maxW | 0}|${text}`;
    const c = this.wrapCache.get(key);
    if (c) return c;
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? `${line} ${word}` : word;
        if (line && ctx.measureText(t).width > maxW) {
          lines.push(line);
          line = word;
        } else line = t;
      }
      lines.push(line);
    }
    if (this.wrapCache.size > 400) this.wrapCache.clear();
    this.wrapCache.set(key, lines);
    return lines;
  }

  /* ---------------------------------------------------------------------------- main */
  draw(s: RenderState): RenderOutput {
    const ctx = this.ctx;
    const scene = this.scene;
    const g = scene.graph;
    scene.ensure();
    const { view, dpr } = s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, s.width, s.height);
    if (s.showGrid) this.drawGrid(ctx, s);

    const vis = visibleWorldRect(view, s.width, s.height, 40);
    const out: RenderOutput = { thumbs: [], visibleNodes: [], drawnLinks: 0, drawnNodes: 0 };
    const zoom = view.zoom;

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(zoom, zoom);

    // frames (bottom)
    for (const f of g.annotations.frames) if (rectsIntersect(scene.frameRect(f), vis)) this.drawFrame(ctx, f, s);

    // links
    const segs = scene.visibleSegments(vis);
    out.drawnLinks = segs.length;
    this.drawLinks(ctx, segs, s);

    // notes
    for (const n of g.annotations.notes) if (rectsIntersect({ x: n.x, y: n.y, w: n.w, h: n.h }, vis)) this.drawNote(ctx, n, s);

    // nodes
    const ids = scene.nodesInRect(vis).sort((a, b) => scene.zOf(a) - scene.zOf(b));
    out.visibleNodes = ids;
    const thumbs = s.thumbs;
    for (const id of ids) this.drawNode(ctx, id, s, out, thumbs);
    out.drawnNodes = ids.length;

    // reroutes
    this.drawReroutes(ctx, s, vis);

    // interaction overlays (world space)
    this.drawGuides(ctx, s);
    if (s.linkDrag) this.drawLinkDrag(ctx, s);
    ctx.restore();

    // screen-space overlays
    if (s.marquee) {
      const m = s.marquee;
      const x = m.x * zoom + view.x,
        y = m.y * zoom + view.y,
        w = m.w * zoom,
        h = m.h * zoom;
      ctx.fillStyle = 'rgba(124,108,240,0.10)';
      ctx.strokeStyle = 'rgba(154,141,255,0.9)';
      ctx.lineWidth = 1;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    }
    if (s.cutLine) {
      const [a, b] = s.cutLine;
      ctx.strokeStyle = 'rgba(255,90,90,0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x * zoom + view.x, a.y * zoom + view.y);
      ctx.lineTo(b.x * zoom + view.x, b.y * zoom + view.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.last = out;
    return out;
  }

  /* ---------------------------------------------------------------------------- grid */
  private drawGrid(ctx: CanvasRenderingContext2D, s: RenderState): void {
    const { view, width, height, dpr } = s;
    const z = view.zoom;
    const minor = NODE.gridSize;
    const px = minor * z;
    const snap = (v: number): number => Math.round(v * dpr) / dpr + 0.5 / dpr;
    const lines = (step: number, color: string): void => {
      const x0 = Math.floor(-view.x / z / step) * step,
        y0 = Math.floor(-view.y / z / step) * step;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1 / dpr;
      ctx.beginPath();
      for (let wx = x0; wx * z + view.x <= width; wx += step) {
        const sx = snap(wx * z + view.x);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, height);
      }
      for (let wy = y0; wy * z + view.y <= height; wy += step) {
        const sy = snap(wy * z + view.y);
        ctx.moveTo(0, sy);
        ctx.lineTo(width, sy);
      }
      ctx.stroke();
    };
    // fade levels in/out smoothly with zoom
    const fade = (p: number): number => Math.max(0, Math.min(1, (p - 6) / 10));
    const aMinor = fade(px);
    if (aMinor > 0.02) lines(minor, `rgba(255,255,255,${0.028 * aMinor})`);
    const major = minor * 5;
    const aMajor = fade(major * z * 0.6);
    if (aMajor > 0.02) lines(major, `rgba(255,255,255,${0.06 * aMajor})`);
    const huge = major * 5;
    if (major * z < 40) lines(huge, 'rgba(255,255,255,0.06)');
    // origin axes
    const ox = snap(view.x),
      oy = snap(view.y);
    ctx.strokeStyle = 'rgba(124,108,240,0.18)';
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    if (ox >= 0 && ox <= width) { ctx.moveTo(ox, 0); ctx.lineTo(ox, height); }
    if (oy >= 0 && oy <= height) { ctx.moveTo(0, oy); ctx.lineTo(width, oy); }
    ctx.stroke();
  }

  /* ---------------------------------------------------------------------------- frames & notes */
  private drawFrame(ctx: CanvasRenderingContext2D, f: FrameData, s: RenderState): void {
    const zoom = s.view.zoom;
    const sel = s.selFrames.has(f.id);
    const hov = s.hoverFrame === f.id;
    const h = f.collapsed ? FRAME_BAR_H : f.h;
    ctx.beginPath();
    ctx.roundRect(f.x, f.y, f.w, h, 8);
    ctx.fillStyle = rgba(f.color, f.collapsed ? 0.2 : 0.07);
    ctx.fill();
    ctx.lineWidth = (sel ? 2 : 1) / zoom;
    ctx.strokeStyle = sel ? '#b2a8ff' : rgba(f.color, hov ? 0.85 : 0.5);
    ctx.stroke();
    // title bar
    ctx.beginPath();
    ctx.roundRect(f.x, f.y, f.w, FRAME_BAR_H, f.collapsed ? 8 : [8, 8, 0, 0]);
    ctx.fillStyle = rgba(f.color, sel ? 0.42 : 0.28);
    ctx.fill();
    if (zoom > 0.22) {
      ctx.fillStyle = '#e8eaee';
      ctx.font = `600 13px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const chev = this.icons.get(f.collapsed ? 'chevron-right' : 'chevron-down', '#d8dbe0');
      if (chev) ctx.drawImage(chev, f.x + 7, f.y + 7, 14, 14);
      const label = f.collapsed && f.members?.length ? `${f.title}  ·  ${f.members.length} nodes` : f.title;
      ctx.fillText(this.fit(ctx, label, f.w - 40), f.x + 26, f.y + FRAME_BAR_H / 2 + 0.5);
    }
    if (!f.collapsed && (sel || hov)) {
      ctx.strokeStyle = rgba('#ffffff', 0.5);
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(f.x + f.w - 4, f.y + h - 14);
      ctx.lineTo(f.x + f.w - 14, f.y + h - 4);
      ctx.moveTo(f.x + f.w - 4, f.y + h - 8);
      ctx.lineTo(f.x + f.w - 8, f.y + h - 4);
      ctx.stroke();
    }
  }

  private drawNote(ctx: CanvasRenderingContext2D, n: { id: string; x: number; y: number; w: number; h: number; text: string; color: string }, s: RenderState): void {
    const zoom = s.view.zoom;
    const sel = s.selNotes.has(n.id);
    ctx.beginPath();
    ctx.roundRect(n.x, n.y, n.w, n.h, 4);
    ctx.fillStyle = mixColor(n.color, '#17191d', 0.8);
    ctx.fill();
    ctx.lineWidth = (sel ? 2 : 1) / zoom;
    ctx.strokeStyle = sel ? '#b2a8ff' : rgba(n.color, 0.7);
    ctx.stroke();
    ctx.fillStyle = rgba(n.color, 0.9);
    ctx.fillRect(n.x, n.y, n.w, 3);
    if (zoom > 0.35) {
      ctx.fillStyle = '#e6e2c8';
      ctx.font = `12px ${FONT}`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const lines = this.wrap(ctx, n.text || 'Double-click to edit…', n.w - 16);
      const maxLines = Math.floor((n.h - 14) / 16);
      ctx.globalAlpha = n.text ? 1 : 0.4;
      for (let i = 0; i < Math.min(lines.length, maxLines); i++) ctx.fillText(lines[i], n.x + 8, n.y + 9 + i * 16);
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------------------------------------------------------------------- links */
  private tracePath(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, style: LinkStyle): void {
    ctx.moveTo(a.x, a.y);
    if (style === 'straight') ctx.lineTo(b.x, b.y);
    else if (style === 'orthogonal') {
      const pts = orthogonalPoints(a, b);
      for (let i = 1; i < pts.length - 1; i++) ctx.arcTo(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, 10);
      ctx.lineTo(b.x, b.y);
    } else {
      const [c1, c2] = bezierControls(a, b);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
    }
  }

  private linkHot(l: LinkData, s: RenderState): number {
    if (s.selLinks.has(l.id) || s.hoverLink === l.id) return 2;
    if (s.selNodes.has(l.from.node) || s.selNodes.has(l.to.node)) return 1;
    return 0;
  }

  private drawLinks(ctx: CanvasRenderingContext2D, segs: LinkSegment[], s: RenderState): void {
    const zoom = s.view.zoom;
    const g = this.scene.graph;
    const style = s.linkStyle;
    const base = Math.max(1.1, 1.9 / Math.sqrt(Math.max(zoom, 0.3)));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const hot: { seg: LinkSegment; level: number }[] = [];
    const dragging = !!s.linkDrag;
    for (const seg of segs) {
      let level = 0;
      for (const id of seg.links) {
        const l = g.links.get(id);
        if (l) level = Math.max(level, this.linkHot(l, s));
      }
      if (level > 0) {
        hot.push({ seg, level });
        continue;
      }
      ctx.beginPath();
      this.tracePath(ctx, seg.a, seg.b, style);
      ctx.lineWidth = seg.links.length > 1 ? base * 1.35 : base;
      ctx.strokeStyle = rgba(seg.color, dragging ? 0.3 : 0.62);
      ctx.stroke();
    }
    for (const { seg, level } of hot) {
      // dark under-stroke for contrast, then the bright link, then optional flow dashes
      ctx.beginPath();
      this.tracePath(ctx, seg.a, seg.b, style);
      ctx.lineWidth = base * 2.6;
      ctx.strokeStyle = level === 2 ? rgba(seg.color, 0.28) : 'rgba(0,0,0,0.45)';
      ctx.stroke();
      ctx.beginPath();
      this.tracePath(ctx, seg.a, seg.b, style);
      ctx.lineWidth = base * (level === 2 ? 1.5 : 1.15);
      ctx.strokeStyle = level === 2 ? '#ffffff' : seg.color;
      ctx.stroke();
    }
    if (s.flow && zoom > 0.25) {
      ctx.setLineDash([2.5 / zoom ** 0.3, 14]);
      ctx.lineDashOffset = -(s.time * 38) % 1000;
      ctx.lineWidth = base * 1.2;
      const list = hot.length ? hot.map((h) => h.seg) : segs.length < 200 ? segs : [];
      for (const seg of list) {
        ctx.beginPath();
        this.tracePath(ctx, seg.a, seg.b, style);
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
  }

  private drawReroutes(ctx: CanvasRenderingContext2D, s: RenderState, vis: Rect): void {
    const g = this.scene.graph;
    const rs = g.annotations.reroutes;
    if (!rs.length) return;
    const types = new Map<string, PinType>();
    for (const [lid, via] of Object.entries(g.annotations.linkVia)) {
      const l = g.links.get(lid);
      if (!l) continue;
      const t = this.scene.pinTypeOf(l.from.node, l.from.pin, 'out');
      for (const r of via) if (!types.has(r)) types.set(r, t);
    }
    const zoom = s.view.zoom;
    for (const r of rs) {
      const t = types.get(r.id);
      if (!t || r.x < vis.x || r.y < vis.y || r.x > vis.x + vis.w || r.y > vis.y + vis.h) continue;
      const color = PIN_COLORS[t];
      const sel = s.selReroutes.has(r.id);
      ctx.beginPath();
      ctx.arc(r.x, r.y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1c1f25';
      ctx.fill();
      ctx.lineWidth = 2 / Math.sqrt(zoom);
      ctx.strokeStyle = sel ? '#ffffff' : color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (sel) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(178,168,255,0.5)';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();
      }
    }
  }

  /* ---------------------------------------------------------------------------- nodes */
  private pinMode(s: RenderState, nodeId: string, p: PinGeo): 'ok' | 'bad' | 'dim' | 'anchor' | null {
    const d = s.linkDrag;
    if (!d) return null;
    if (d.anchor.node === nodeId && d.anchor.pin === p.id && d.anchor.side === p.side) return 'anchor';
    const wantSide = d.side === 'out' ? 'in' : 'out';
    if (p.side !== wantSide) return 'dim';
    if (d.forbidden.has(nodeId)) return 'bad';
    const ok = d.side === 'out' ? canConnect(d.anchor.type, p.type) : canConnect(p.type, d.anchor.type);
    return ok ? 'ok' : 'bad';
  }

  private drawNode(ctx: CanvasRenderingContext2D, id: string, s: RenderState, out: RenderOutput, thumbs: ThumbnailLayer | null): void {
    const scene = this.scene;
    const g = scene.graph;
    const n = g.nodes.get(id)!;
    const l = scene.layoutOf(id);
    const ex = g.registry.expanded(n.type);
    const def = ex?.def;
    const ui = g.annotations.nodeUi[id];
    const zoom = s.view.zoom;
    const x = n.x,
      y = n.y,
      w = l.w,
      h = l.h;
    const cat = def ? CATEGORIES[def.category].color : '#6b7078';
    const sel = s.selNodes.has(id);
    const hov = s.hoverNode === id;
    const err = s.errors.get(id);
    const lod = zoom >= 0.55 ? 2 : zoom >= 0.3 ? 1 : 0;

    // --- far LOD: flat block
    if (lod === 0) {
      ctx.fillStyle = err ? '#3a1f22' : '#1f2329';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = ui?.color ?? cat;
      ctx.fillRect(x, y, w, Math.min(NODE.headerH, h));
      if (sel) {
        ctx.strokeStyle = '#b2a8ff';
        ctx.lineWidth = 2.5 / zoom;
        ctx.strokeRect(x, y, w, h);
      }
      this.thumbBlock(ctx, id, s, out, thumbs, l.thumb, n.bypass === true);
      return;
    }

    // --- shadow + body
    if (zoom >= 0.4) {
      ctx.fillStyle = 'rgba(0,0,0,0.20)';
      ctx.beginPath();
      ctx.roundRect(x - 2, y + 2, w + 4, h + 5, 9);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.beginPath();
      ctx.roundRect(x - 5, y + 4, w + 10, h + 11, 12);
      ctx.fill();
    }
    const isActive = s.active?.nodeId === id;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 7);
    ctx.fillStyle = n.bypass ? '#1a1d22' : hov ? '#23272e' : '#1d2026';
    ctx.fill();
    if (sel) {
      for (const [grow, a] of [[7, 0.07], [4.5, 0.12], [2.2, 0.2]] as const) {
        ctx.beginPath();
        ctx.roundRect(x - grow, y - grow, w + 2 * grow, h + 2 * grow, 7 + grow);
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = `rgba(154,141,255,${a})`;
        ctx.stroke();
      }
    }
    ctx.lineWidth = Math.max(1 / zoom, sel ? 1.6 : 1);
    ctx.strokeStyle = err ? '#e5534b' : sel ? '#a79bff' : s.matches.has(id) ? '#f2c94c' : hov ? '#4a505b' : '#323740';
    if (n.bypass) ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- header
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, NODE.headerH, l.collapsed ? 7 : [7, 7, 0, 0]);
    ctx.clip();
    ctx.fillStyle = mixColor(ui?.color ?? cat, '#1d2026', ui?.color ? 0.45 : 0.68);
    ctx.fillRect(x, y, w, NODE.headerH);
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, rgba(cat, 0.34));
    grad.addColorStop(1, rgba(cat, 0.04));
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, NODE.headerH);
    ctx.fillStyle = cat;
    ctx.fillRect(x, y, w, 2.2);
    if (ui?.color) {
      ctx.fillStyle = ui.color;
      ctx.fillRect(x, y + 2, 4, NODE.headerH - 2);
    }
    ctx.restore();
    if (!l.collapsed) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(x, y + NODE.headerH, w, 1 / zoom);
    }

    const showButtons = lod === 2 && (hov || sel);
    // icon + title
    const ic = this.icons.get(def?.icon ?? 'cube', '#e6e8ec');
    if (ic) ctx.drawImage(ic, x + 7, y + 6, 14, 14);
    let titleRight: number;
    // right-side widgets (from right to left): collapse, [bypass, 2d, 3d, lock], error badge
    const btnIcon = (name: string, key: string, r: Rect, active: boolean, color = '#aeb4be'): void => {
      const hovB = s.hoverButton?.node === id && s.hoverButton.button === key;
      if (hovB || active) {
        ctx.fillStyle = active ? 'rgba(124,108,240,0.35)' : 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.roundRect(x + r.x, y + r.y, r.w, r.h, 3);
        ctx.fill();
      }
      const im = this.icons.get(name, hovB || active ? '#ffffff' : color);
      if (im) ctx.drawImage(im, x + r.x + 1.5, y + r.y + 2, 12, 12);
    };
    if (lod === 2 || l.collapsed) btnIcon(l.collapsed ? 'chevron-right' : 'chevron-down', 'collapse', l.buttons.collapse, false);
    titleRight = x + l.buttons.collapse.x - 4;
    if (showButtons && !l.collapsed) {
      const hasTex = !!ex?.primaryTexture;
      if (hasTex || def?.category === 'geometry' || def?.category === 'camera') {
        btnIcon('bypass', 'bypass', l.buttons.bypass, !!n.bypass);
        btnIcon('panel-2d', 'view2d', l.buttons.view2d, isActive);
        btnIcon('panel-3d', 'view3d', l.buttons.view3d, false);
        btnIcon(ui?.locked ? 'lock' : 'unlock', 'lock', l.buttons.lock, !!ui?.locked);
        titleRight = x + l.buttons.lock.x - 4;
      }
      if (ex?.params.some((d) => d.type === 'spline' && d.id.includes('profile'))) {
        // Sweep: "Edit profile" opens the Profile Editor window
        btnIcon('spline', 'edit', l.buttons.edit, false);
        titleRight = Math.min(titleRight, x + l.buttons.edit.x - 4);
      }
    } else if (ui?.locked && lod === 2) {
      const im = this.icons.get('lock', '#8c939e');
      if (im) ctx.drawImage(im, x + l.buttons.bypass.x + 1.5, y + 7, 12, 12);
      titleRight = x + l.buttons.bypass.x - 4;
    }
    if (err) {
      ctx.beginPath();
      ctx.arc(titleRight - 7, y + NODE.headerH / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = '#e5534b';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', titleRight - 7, y + NODE.headerH / 2 + 0.5);
      titleRight -= 18;
    }
    if (s.editingNode !== id) {
      ctx.font = `600 12px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = n.bypass ? '#8c939e' : '#eceef2';
      ctx.fillText(this.fit(ctx, def && n.name === def.title ? trNodeLabel(n.type, n.name) : n.name, titleRight - (x + 26)), x + 26, y + NODE.headerH / 2 + 0.5);
    }

    // --- pins
    this.drawPins(ctx, id, l, s, lod);

    if (!l.collapsed) {
      // --- thumbnail
      this.thumbBlock(ctx, id, s, out, thumbs, l.thumb, n.bypass === true, err);
      // --- footer
      if (l.thumb && lod === 2) {
        const info = s.info.get(id);
        const bits = s.nominal.bits === 32 ? 'F32' : 'F16';
        const fmt = ex?.primaryTexture?.type === 'gray' ? `R${bits === 'F32' ? '32' : '16'}F` : ex?.primaryTexture?.type === 'uv' || ex?.primaryTexture?.type === 'vector' ? `RG${bits === 'F32' ? '32' : '16'}F` : `RGBA${bits === 'F32' ? '32' : '16'}F`;
        ctx.font = `10px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillStyle = info ? '#8c939e' : '#5d636d';
        ctx.fillText(`${info?.w ?? s.nominal.w}×${info?.h ?? s.nominal.h}  ·  ${fmt}`, x + NODE.thumbPad, y + l.footerY + NODE.footerH / 2 - 1);
        if (n.bypass) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#e0a23c';
          ctx.fillText('BYPASSED', x + w - NODE.thumbPad, y + l.footerY + NODE.footerH / 2 - 1);
        } else if (isActive) {
          ctx.textAlign = 'right';
          ctx.fillStyle = '#b2a8ff';
          ctx.fillText('● VIEWING', x + w - NODE.thumbPad, y + l.footerY + NODE.footerH / 2 - 1);
        }
      }
      // resize edge highlight
      if (s.hoverResize === id) {
        ctx.fillStyle = 'rgba(154,141,255,0.8)';
        ctx.fillRect(x + w - 1.5, y + NODE.headerH, 3, h - NODE.headerH - 4);
      }
    }
    if (isActive && lod >= 1) {
      // viewport marker on the output pin
      const op = l.outputs.find((p) => p.id === (s.active?.pinId ?? p.id)) ?? l.outputs[0];
      if (op) {
        ctx.beginPath();
        ctx.arc(x + op.x, y + op.y, 8.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#b2a8ff';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + op.x, y + op.y, 11.5, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(154,141,255,0.22)';
        ctx.stroke();
      }
    }
    if (lod === 2 && sel && !l.collapsed) {
      // resize grip
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x + w - 4, y + h - 10);
      ctx.lineTo(x + w - 10, y + h - 4);
      ctx.moveTo(x + w - 4, y + h - 6);
      ctx.lineTo(x + w - 6, y + h - 4);
      ctx.stroke();
    }
    if (s.linkDrag?.dropNode === id) {
      ctx.beginPath();
      ctx.roundRect(x - 2, y - 2, w + 4, h + 4, 9);
      ctx.lineWidth = 2;
      ctx.strokeStyle = s.linkDrag.valid === false ? '#e5534b' : '#4cc38a';
      ctx.stroke();
    }
  }

  private thumbBlock(ctx: CanvasRenderingContext2D, id: string, s: RenderState, out: RenderOutput, thumbs: ThumbnailLayer | null, t: Rect | null, bypass: boolean, err?: string): void {
    if (!t) return;
    const n = this.scene.graph.nodes.get(id)!;
    const zoom = s.view.zoom;
    const x = n.x + t.x,
      y = n.y + t.y;
    const sw = t.w * zoom;
    if (sw < 8) return;
    const have = !!thumbs && !err && thumbs.hasAny(id);
    if (have && thumbs) {
      // punch a hole: the WebGPU canvas underneath shows the thumbnail here
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, t.w, t.h);
      ctx.globalCompositeOperation = 'source-over';
      const dpr = s.dpr;
      out.thumbs.push({ nodeId: id, x: Math.round((x * zoom + s.view.x) * dpr), y: Math.round((y * zoom + s.view.y) * dpr), w: Math.round(t.w * zoom * dpr), h: Math.round(t.h * zoom * dpr), dim: bypass ? 0.35 : thumbs.hasThumb(id) ? 1 : 0.8 });
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1 / zoom;
      ctx.strokeRect(x, y, t.w, t.h);
      return;
    }
    // placeholder
    ctx.fillStyle = err ? '#2c1a1d' : '#121418';
    ctx.fillRect(x, y, t.w, t.h);
    ctx.strokeStyle = err ? 'rgba(229,83,75,0.5)' : 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(x, y, t.w, t.h);
    if (sw > 30) {
      const im = this.icons.get(err ? 'warning' : 'image', err ? '#e5534b' : '#3c424b');
      if (im) ctx.drawImage(im, x + t.w / 2 - 14, y + t.h / 2 - 14, 28, 28);
    }
  }

  private drawPins(ctx: CanvasRenderingContext2D, id: string, l: ReturnType<GraphScene['layoutOf']>, s: RenderState, lod: number): void {
    const n = this.scene.graph.nodes.get(id)!;
    const conn = this.scene.connectedPins(id);
    const draw = (p: PinGeo): void => {
      const mode = this.pinMode(s, id, p);
      const hov = s.hoverPin?.node === id && s.hoverPin.pin === p.id && s.hoverPin.side === p.side;
      const color = PIN_COLORS[p.type];
      const px = n.x + p.x,
        py = n.y + p.y;
      let r = 4.6;
      if (mode === 'ok') r = 5.6;
      if (hov || mode === 'anchor') r = 6;
      ctx.globalAlpha = mode === 'bad' || mode === 'dim' ? 0.22 : 1;
      if (mode === 'ok' || hov || mode === 'anchor') {
        ctx.beginPath();
        ctx.arc(px, py, r + 4, 0, Math.PI * 2);
        ctx.fillStyle = rgba(mode === 'bad' ? '#e5534b' : color, 0.22);
        ctx.fill();
      }
      pinPath(ctx, PIN_SHAPES[p.type], px, py, r);
      const connected = conn.has(`${p.side}:${p.id}`);
      ctx.fillStyle = connected || mode === 'ok' || hov ? color : '#14161a';
      ctx.fill();
      ctx.lineWidth = 1.7;
      ctx.strokeStyle = hov && mode === 'bad' ? '#e5534b' : color;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (lod === 2 && !l.collapsed) {
        ctx.font = `11px ${FONT}`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = mode === 'bad' || mode === 'dim' ? 'rgba(160,166,176,0.35)' : p.isMod ? '#7b828d' : p.optional ? '#a2a8b2' : '#cfd3da';
        if (p.side === 'in') {
          ctx.textAlign = 'left';
          ctx.fillText(this.fit(ctx, trTerm(p.name), l.w / 2 - 6), px + 11, py + 0.5);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(this.fit(ctx, trTerm(p.name), l.w / 2 - 6), px - 11, py + 0.5);
        }
      }
    };
    if (l.collapsed) {
      const i0 = l.inputs[0],
        o0 = l.outputs[0];
      if (i0) draw(i0);
      if (o0) draw(o0);
      return;
    }
    if (lod === 0) return;
    for (const p of l.inputs) draw(p);
    for (const p of l.outputs) draw(p);
  }

  /* ---------------------------------------------------------------------------- overlays */
  private drawGuides(ctx: CanvasRenderingContext2D, s: RenderState): void {
    if (!s.guides.length) return;
    ctx.strokeStyle = 'rgba(255,99,201,0.85)';
    ctx.lineWidth = 1 / s.view.zoom;
    ctx.beginPath();
    for (const g of s.guides) {
      if (g.axis === 'x') {
        ctx.moveTo(g.pos, g.from - 12);
        ctx.lineTo(g.pos, g.to + 12);
      } else {
        ctx.moveTo(g.from - 12, g.pos);
        ctx.lineTo(g.to + 12, g.pos);
      }
    }
    ctx.stroke();
  }

  private drawLinkDrag(ctx: CanvasRenderingContext2D, s: RenderState): void {
    const d = s.linkDrag!;
    const end = d.snap?.pos ?? d.pointer;
    const color = d.valid === false ? '#e5534b' : PIN_COLORS[d.anchor.type];
    const style = s.linkStyle;
    const anchors = [d.anchor.pos, ...(d.extra ?? [])];
    ctx.lineCap = 'round';
    for (const a of anchors) {
      ctx.beginPath();
      if (d.side === 'out') this.tracePath(ctx, a, end, style);
      else this.tracePath(ctx, end, a, style);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.stroke();
      ctx.beginPath();
      if (d.side === 'out') this.tracePath(ctx, a, end, style);
      else this.tracePath(ctx, end, a, style);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.setLineDash(d.valid === false ? [4, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.beginPath();
    ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (d.valid === false) {
      ctx.strokeStyle = '#e5534b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(end.x - 6, end.y - 6);
      ctx.lineTo(end.x + 6, end.y + 6);
      ctx.moveTo(end.x + 6, end.y - 6);
      ctx.lineTo(end.x - 6, end.y + 6);
      ctx.stroke();
    }
  }
}

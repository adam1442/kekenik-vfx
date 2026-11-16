import type { Graph, LinkData } from '../../../engine/graph/graph';
import type { FrameData } from '../../../engine/graph/annotations';
import { PIN_COLORS } from '../../../engine/graph/pins';
import type { PinType } from '../../../engine/types';
import { computeNodeLayout, linkBounds, rectContains, rectsIntersect, type LinkStyle, type NodeLayout, type PinGeo, type Pt, type Rect } from './geometry';
import { SpatialGrid } from './spatial';

export const FRAME_BAR_H = 28;
const EMPTY: ReadonlySet<string> = new Set();

/** One drawable piece of a link: a pin/reroute to a pin/reroute connection. Shared segments of a bundle are drawn once. */
export interface LinkSegment {
  key: string;
  a: Pt;
  b: Pt;
  type: PinType;
  color: string;
  links: string[];
}

export interface PinHit {
  node: string;
  pin: string;
  side: 'in' | 'out';
  type: PinType;
  pos: Pt;
}

/**
 * GraphScene = everything DERIVED from the graph model that rendering and interaction need: node layouts, the spatial
 * index, connection tables, reroute chains, frame membership. Rebuilt lazily (`ensure`) after invalidation, so a drag
 * only pays for what changed. Nothing here touches the DOM or the GPU.
 */
export class GraphScene {
  linkStyle: LinkStyle = 'bezier';
  readonly grid = new SpatialGrid(256);
  private layouts = new Map<string, { key: string; l: NodeLayout }>();
  private connected = new Map<string, Set<string>>();
  private pinConn = new Map<string, Set<string>>();
  /** nodeId -> id of the collapsed frame hiding it. */
  readonly hidden = new Map<string, string>();
  /** Links temporarily not drawn (being re-dragged). */
  hideLinks: ReadonlySet<string> = new Set();
  private structDirty = true;
  private posDirty = true;
  private z = new Map<string, number>();
  private zCounter = 0;

  constructor(public graph: Graph) {}

  setGraph(g: Graph): void {
    this.graph = g;
    this.layouts.clear();
    this.z.clear();
    this.structDirty = this.posDirty = true;
  }
  invalidate(kind: 'struct' | 'pos'): void {
    if (kind === 'struct') this.structDirty = true;
    this.posDirty = true;
  }

  /* ------------------------------------------------------------------ build */
  ensure(): void {
    if (!this.structDirty && !this.posDirty) return;
    const g = this.graph;
    if (this.structDirty) {
      this.connected.clear();
      this.pinConn.clear();
      const mark = (id: string, k: string): void => {
        let set = this.pinConn.get(id);
        if (!set) this.pinConn.set(id, (set = new Set()));
        set.add(k);
      };
      for (const l of g.links.values()) {
        mark(l.from.node, `out:${l.from.pin}`);
        mark(l.to.node, `in:${l.to.pin}`);
        let s = this.connected.get(l.to.node);
        if (!s) this.connected.set(l.to.node, (s = new Set()));
        s.add(l.to.pin);
      }
      for (const id of [...this.layouts.keys()]) if (!g.nodes.has(id)) this.layouts.delete(id);
      this.hidden.clear();
      for (const f of g.annotations.frames) if (f.collapsed && f.members) for (const m of f.members) this.hidden.set(m, f.id);
    }
    this.grid.clear();
    for (const n of g.nodes.values()) {
      if (this.hidden.has(n.id)) continue;
      const l = this.layoutOf(n.id);
      this.grid.insert(n.id, { x: n.x, y: n.y, w: l.w, h: l.h });
    }
    this.structDirty = this.posDirty = false;
  }

  /** Connected pins of a node as "in:<pin>" / "out:<pin>" keys. */
  connectedPins(id: string): ReadonlySet<string> {
    return this.pinConn.get(id) ?? EMPTY;
  }

  layoutOf(id: string): NodeLayout {
    const g = this.graph;
    const n = g.nodes.get(id)!;
    const ui = g.annotations.nodeUi[id];
    const conn = this.connected.get(id);
    const key = `${n.type}|${ui?.w ?? ''}|${ui?.collapsed ? 1 : 0}|${ui?.showMods ? 1 : 0}|${conn ? [...conn].sort().join(',') : ''}`;
    const c = this.layouts.get(id);
    if (c && c.key === key) return c.l;
    const l = computeNodeLayout(g.registry.expanded(n.type), ui, conn ?? new Set());
    this.layouts.set(id, { key, l });
    return l;
  }
  rectOf(id: string): Rect {
    const n = this.graph.nodes.get(id)!;
    const l = this.layoutOf(id);
    return { x: n.x, y: n.y, w: l.w, h: l.h };
  }
  /** Draw/hit order: lower first. Clicking a node brings it to the front (view-local, not persisted). */
  zOf(id: string): number {
    return this.z.get(id) ?? 0;
  }
  bringToFront(ids: Iterable<string>): void {
    for (const id of ids) this.z.set(id, ++this.zCounter);
  }
  frameOfHidden(nodeId: string): FrameData | undefined {
    const fid = this.hidden.get(nodeId);
    return fid ? this.graph.annotations.frames.find((f) => f.id === fid) : undefined;
  }

  /* ------------------------------------------------------------------ pins */
  findPin(nodeId: string, pinId: string, side?: 'in' | 'out'): PinGeo | undefined {
    if (!this.graph.nodes.has(nodeId)) return undefined;
    const l = this.layoutOf(nodeId);
    if (side !== 'out') {
      const p = l.inputs.find((x) => x.id === pinId);
      if (p) return p;
    }
    if (side !== 'in') return l.outputs.find((x) => x.id === pinId);
    return undefined;
  }
  /** World position of a pin. Hidden nodes (collapsed frame) attach to the frame's side; unknown pins to the node edge. */
  pinWorld(nodeId: string, pinId: string, side: 'in' | 'out'): Pt | null {
    const n = this.graph.nodes.get(nodeId);
    if (!n) return null;
    const hf = this.frameOfHidden(nodeId);
    if (hf) return { x: side === 'in' ? hf.x : hf.x + hf.w, y: hf.y + FRAME_BAR_H / 2 };
    const l = this.layoutOf(nodeId);
    const p = this.findPin(nodeId, pinId, side);
    if (p) return { x: n.x + p.x, y: n.y + p.y };
    return { x: n.x + (side === 'in' ? 0 : l.w), y: n.y + 13 };
  }
  pinTypeOf(nodeId: string, pinId: string, side: 'in' | 'out'): PinType {
    return this.findPin(nodeId, pinId, side)?.type ?? 'gray';
  }

  /** Pin under a WORLD point (radius in world units), topmost node first. */
  pinAt(x: number, y: number, radius: number): PinHit | null {
    this.ensure();
    const ids = this.grid.queryPoint(x, y, radius + 2).sort((a, b) => this.zOf(b) - this.zOf(a));
    for (const id of ids) {
      const n = this.graph.nodes.get(id)!;
      const l = this.layoutOf(id);
      const pins = l.collapsed ? [...(l.inputs.length ? [l.inputs[0]] : []), ...(l.outputs.length ? [l.outputs[0]] : [])] : [...l.inputs, ...l.outputs];
      let best: PinHit | null = null;
      let bd = radius;
      for (const p of pins) {
        const d = Math.hypot(n.x + p.x - x, n.y + p.y - y);
        if (d <= bd) {
          bd = d;
          best = { node: id, pin: p.id, side: p.side, type: p.type, pos: { x: n.x + p.x, y: n.y + p.y } };
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Topmost node whose rect contains the world point. */
  nodeAt(x: number, y: number): string | null {
    this.ensure();
    const ids = this.grid.queryPoint(x, y, 0).filter((id) => rectContains(this.grid.rectOf(id)!, x, y));
    if (!ids.length) return null;
    return ids.reduce((a, b) => (this.zOf(b) >= this.zOf(a) ? b : a));
  }
  nodesInRect(r: Rect): string[] {
    this.ensure();
    return this.grid.query(r);
  }

  /* ------------------------------------------------------------------ links */
  /** Reroute chain positions for a link (only existing reroutes). */
  chainOf(link: LinkData): { id: string; p: Pt }[] {
    const via = this.graph.annotations.linkVia[link.id];
    if (!via?.length) return [];
    const out: { id: string; p: Pt }[] = [];
    for (const rid of via) {
      const r = this.graph.annotations.reroutes.find((x) => x.id === rid);
      if (r) out.push({ id: rid, p: { x: r.x, y: r.y } });
    }
    return out;
  }

  /** Full polyline anchor list of a link: [outputPin, reroutes..., inputPin]. */
  anchorsOf(link: LinkData): Pt[] | null {
    const a = this.pinWorld(link.from.node, link.from.pin, 'out');
    const b = this.pinWorld(link.to.node, link.to.pin, 'in');
    if (!a || !b) return null;
    return [a, ...this.chainOf(link).map((c) => c.p), b];
  }

  /**
   * Visible link segments (culled to `view` world rect, shared bundle segments merged).
   * `segmentOf` maps link id -> its segments so hit-testing can address them.
   */
  visibleSegments(view: Rect): LinkSegment[] {
    this.ensure();
    const segs = new Map<string, LinkSegment>();
    for (const l of this.graph.links.values()) {
      if (this.hideLinks.has(l.id)) continue;
      const a = this.pinWorld(l.from.node, l.from.pin, 'out');
      const b = this.pinWorld(l.to.node, l.to.pin, 'in');
      if (!a || !b) continue;
      if (this.hidden.has(l.from.node) && this.hidden.get(l.from.node) === this.hidden.get(l.to.node)) continue; // inside one collapsed frame
      const chain = this.chainOf(l);
      const type = this.pinTypeOf(l.from.node, l.from.pin, 'out');
      const color = PIN_COLORS[type];
      const pts: { k: string; p: Pt }[] = [{ k: `p:${l.from.node}:${l.from.pin}`, p: a }, ...chain.map((c) => ({ k: `r:${c.id}`, p: c.p })), { k: `p:${l.to.node}:${l.to.pin}`, p: b }];
      for (let i = 0; i < pts.length - 1; i++) {
        const key = `${pts[i].k}>${pts[i + 1].k}`;
        const ex = segs.get(key);
        if (ex) {
          ex.links.push(l.id);
          continue;
        }
        const bb = linkBounds(pts[i].p, pts[i + 1].p, this.linkStyle);
        if (!rectsIntersect(bb, view)) continue;
        segs.set(key, { key, a: pts[i].p, b: pts[i + 1].p, type, color, links: [l.id] });
      }
    }
    return [...segs.values()];
  }

  /* ------------------------------------------------------------------ frames */
  /** Ids of everything a frame visually contains (node centre inside / fully inside for frames, reroutes, notes). */
  membersOf(f: FrameData): { nodes: string[]; notes: string[]; reroutes: string[]; frames: string[] } {
    this.ensure();
    const a = this.graph.annotations;
    if (f.collapsed && f.members) return { nodes: [...f.members], notes: [], reroutes: [], frames: [] };
    const r: Rect = { x: f.x, y: f.y, w: f.w, h: f.h };
    const nodes = this.grid.query(r).filter((id) => {
      const nr = this.grid.rectOf(id)!;
      return rectContains(r, nr.x + nr.w / 2, nr.y + nr.h / 2);
    });
    const notes = a.notes.filter((n) => rectContains(r, n.x + n.w / 2, n.y + n.h / 2)).map((n) => n.id);
    const reroutes = a.reroutes.filter((n) => rectContains(r, n.x, n.y)).map((n) => n.id);
    const frames = a.frames.filter((o) => o.id !== f.id && o.x >= f.x && o.y >= f.y && o.x + o.w <= f.x + f.w && o.y + o.h <= f.y + f.h && (o.w < f.w || o.h < f.h)).map((o) => o.id);
    return { nodes, notes, reroutes, frames };
  }
  frameRect(f: FrameData): Rect {
    return { x: f.x, y: f.y, w: f.w, h: f.collapsed ? FRAME_BAR_H : f.h };
  }
  /** Topmost frame whose TITLE BAR contains the point (frames are grabbed by their bar/border, bodies are click-through). */
  frameBarAt(x: number, y: number): FrameData | null {
    const fs = this.graph.annotations.frames;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      if (rectContains({ x: f.x, y: f.y, w: f.w, h: FRAME_BAR_H }, x, y)) return f;
    }
    return null;
  }
  /** Frame under the point on its body border (6px band) — second way to grab a frame. */
  frameBorderAt(x: number, y: number, band: number): FrameData | null {
    const fs = this.graph.annotations.frames;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      if (f.collapsed) continue;
      const outer = { x: f.x - band, y: f.y - band, w: f.w + 2 * band, h: f.h + 2 * band };
      const inner = { x: f.x + band, y: f.y + band, w: f.w - 2 * band, h: f.h - 2 * band };
      if (rectContains(outer, x, y) && !rectContains(inner, x, y)) return f;
    }
    return null;
  }

  /** Everything's bounding rect (for "frame all" and the minimap). */
  contentBounds(): Rect | null {
    this.ensure();
    const rs: Rect[] = [];
    for (const id of this.graph.nodes.keys()) if (!this.hidden.has(id)) rs.push(this.rectOf(id));
    for (const f of this.graph.annotations.frames) rs.push(this.frameRect(f));
    for (const n of this.graph.annotations.notes) rs.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    for (const r of this.graph.annotations.reroutes) rs.push({ x: r.x - 6, y: r.y - 6, w: 12, h: 12 });
    if (!rs.length) return null;
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const r of rs) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}

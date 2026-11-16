import type { GraphEditor } from '../../engine/commands/graph-commands';
import type { Engine } from '../../engine/engine';
import type { EvalTarget } from '../../engine/graph/evaluator';
import type { Graph, LinkData } from '../../engine/graph/graph';
import { canConnect, PIN_COLORS } from '../../engine/graph/pins';
import type { NodeRegistry } from '../../engine/graph/registry';
import { CATEGORIES } from '../../engine/graph/categories';
import type { Emitter, Store } from '../../shared/emitter';
import { deepClone } from '../../shared/util';
import { h } from '../../ui/core/dom';
import { showMenu, type MenuItem } from '../../ui/core/menu';
import { promptDialog, toast } from '../../ui/core/overlay';
import { icon } from '../../ui/icons';
import { iconButton } from '../../ui/widgets/controls';
import { buildClip, parseClip } from './core/clipboard';
import { closestOnPolyline, distToPolyline, linkSamples, NODE, polylineIntersectsSegment, rectContains, rectFromPoints, rectsIntersect, snapToGrid, type LinkStyle, type Pt, type Rect } from './core/geometry';
import { FRAME_BAR_H, GraphScene, type LinkSegment, type PinHit } from './core/scene';
import { snapMove, type AlignMode, type Guide } from './core/snap';
import { UsageStats } from './core/usage';
import { pickPin } from './core/validity';
import { onUiChange, uiState } from '../../ui/theme/ui-store';
import { clampZoom, frameRect, toScreen, toWorld, ViewAnimator, visibleWorldRect, zoomAt, type View } from './core/viewport';
import { Minimap } from './minimap';
import { graphNavigation } from './navigation';
import { graphExtensions } from './extensions';
import { FRAME_COLORS, GraphOps, NOTE_COLORS, TAG_COLORS, emptySel, selCount, type ItemSel } from './ops';
import { GraphRenderer, type LinkDragView, type RenderState } from './renderer';
import { openNodeSearch, usageContext, type SearchFilter } from './search-popup';
import { ThumbnailLayer, type NodeInfo } from './thumbnails';

import { t as tt } from '../../shared/i18n';
/* ============================================================================================ host & prefs */
export type NodeButton = 'collapse' | 'bypass' | 'view2d' | 'view3d' | 'lock' | 'edit';

export interface GraphHost {
  registry: NodeRegistry;
  engine: Engine | null;
  editor(): GraphEditor;
  selection: { get(): readonly string[]; set(ids: string[]): void; onChange: Emitter<void> };
  active: { get(): EvalTarget | null; pin(t: EvalTarget | null): void; onChange: Emitter<void> } | null;
  onProjectChange: Emitter<void> | null;
  visible?: Store<boolean>;
  openViewport?(kind: '2d' | '3d'): void;
  /** Open the Spline / Profile editor window for a spline param of a node (node-header "Edit profile" button). */
  editSpline?(nodeId: string, paramId: string): void;
  setHint?(text: string): void;
}

export interface GraphPrefs {
  linkStyle: LinkStyle;
  flow: boolean;
  snap: boolean;
  grid: boolean;
  minimap: boolean;
  nav: 'auto' | 'mouse' | 'trackpad';
}
const PREF_KEY = 'kk-graph-prefs';
export function loadPrefs(): GraphPrefs {
  const d: GraphPrefs = { linkStyle: 'bezier', flow: false, snap: true, grid: true, minimap: true, nav: 'auto' };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (raw) Object.assign(d, JSON.parse(raw) as Partial<GraphPrefs>);
  } catch {
    /* ignore */
  }
  return d;
}

/* ============================================================================================ hit testing */
type Hit =
  | { kind: 'pin'; pin: PinHit }
  | { kind: 'button'; node: string; button: NodeButton }
  | { kind: 'resize'; node: string }
  | { kind: 'node'; node: string; header: boolean }
  | { kind: 'reroute'; id: string; out: boolean }
  | { kind: 'note'; id: string; resize: boolean }
  | { kind: 'link'; seg: LinkSegment; link: string; index: number; at: Pt }
  | { kind: 'frame'; id: string; part: 'bar' | 'border' | 'resize' | 'chevron' }
  | { kind: 'none' };

interface MoveSet {
  nodes: Map<string, [number, number]>;
  frames: Map<string, [number, number]>;
  notes: Map<string, [number, number]>;
  reroutes: Map<string, [number, number]>;
}
type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'marquee'; start: Pt; additive: boolean; base: ItemSel }
  | { kind: 'move'; start: Pt; set: MoveSet; box: Rect | null; dx: number; dy: number; txn: boolean }
  | { kind: 'resizeNode'; id: string; startW: number; startX: number; w: number }
  | { kind: 'resizeRect'; what: 'frame' | 'note'; id: string; r: Rect; start: Pt; cur: Rect }
  | { kind: 'link'; v: LinkDragView; existing: LinkData | null; many: LinkData[] | null; via: string[]; manyVia: Map<string, string[]> }
  | { kind: 'cut'; a: Pt; b: Pt };

interface Press {
  hit: Hit;
  p: Pt;
  w: Pt;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  started: boolean;
  deferSelect: boolean;
}

const fmtOf = (type: string, bits: number): string => `${type === 'gray' ? 'r' : type === 'uv' || type === 'vector' ? 'rg' : 'rgba'}${bits}float`;

/**
 * GraphView: the interactive graph canvas. Owns the scene (derived layout data), renderer, thumbnail layer, camera,
 * selection (nodes/frames/notes/reroutes/links), all pointer & keyboard interaction, popups and the overlay UI.
 * All graph edits go through GraphOps -> GraphEditor (undo).
 */
export class GraphView {
  readonly root: HTMLDivElement;
  private gpuCanvas = h('canvas', { class: 'k-ge-canvas k-ge-gpu' });
  private canvas = h('canvas', { class: 'k-ge-canvas k-ge-main', tabindex: '0', 'aria-label': 'Node graph canvas' });
  private ctx: CanvasRenderingContext2D;
  readonly scene: GraphScene;
  readonly renderer: GraphRenderer;
  readonly animator = new ViewAnimator();
  readonly usage = new UsageStats();
  readonly ops: GraphOps;
  readonly thumbs: ThumbnailLayer | null = null;
  readonly minimap: Minimap;
  prefs: GraphPrefs = loadPrefs();
  sel: ItemSel = emptySel();

  private W = 800;
  private H = 600;
  private dpr = window.devicePixelRatio || 1;
  private raf = 0;
  private dirty = true;
  private lastT = 0;
  private time = 0;
  private disposed = false;
  private visible = true;
  private hostGraph: Graph;
  private unsubs: Array<() => void> = [];
  private graphUnsub: (() => void) | null = null;
  private drag: Drag | null = null;
  private press: Press | null = null;
  private pointers = new Map<number, Pt>();
  private pinch: { d: number; c: Pt } | null = null;
  private space = false;
  private mouse: Pt = { x: 0, y: 0 };
  private mouseIn = false;
  private pendingHover = false;
  private hoverHit: Hit = { kind: 'none' };
  private hoverNode: string | null = null;
  private hoverLink: string | null = null;
  private guides: Guide[] = [];
  private marquee: Rect | null = null;
  private cutLine: [Pt, Pt] | null = null;
  private matches = new Set<string>();
  private editingNode: string | null = null;
  private schedErrors = new Map<string, string>();
  private schedInfo = new Map<string, NodeInfo>();
  private errors = new Map<string, string>();
  private tip = h('div', { class: 'k-ge-tip' });
  private tipTimer: ReturnType<typeof setTimeout> | null = null;
  private popup: { close(): void } | null = null;
  private findBox: HTMLElement | null = null;
  private lastMinimap = 0;
  private syncing = false;
  private bar!: HTMLElement;
  private crumbs!: HTMLElement;
  private statusEl!: HTMLElement;
  private firstFit = true;
  readonly stats = { frames: 0, lastDrawMs: 0, maxDrawMs: 0 };
  /** Stress page: collects the CPU draw time (ms) of every rendered frame while non-null. */
  capture: number[] | null = null;
  /** Nodes/links drawn in the last frame (stress page). */
  get lastFrame(): { nodes: number; links: number } {
    return { nodes: this.renderer.last.drawnNodes, links: this.renderer.last.drawnLinks };
  }

  constructor(
    private host: GraphHost,
    container: HTMLElement,
    opts: { thumbnails?: boolean } = {},
  ) {
    this.hostGraph = host.editor().graph;
    this.scene = new GraphScene(this.hostGraph);
    this.scene.linkStyle = this.prefs.linkStyle;
    this.ctx = this.canvas.getContext('2d')!;
    this.renderer = new GraphRenderer(this.ctx, this.scene, () => this.requestDraw());
    this.ops = new GraphOps(() => host.editor(), this.scene, this.usage);
    this.minimap = new Minimap(this.scene, (c) => this.centreOn(c, false));
    this.minimap.visible = this.prefs.minimap;
    if (host.engine && opts.thumbnails !== false) {
      try {
        this.thumbs = new ThumbnailLayer(host.engine, this.gpuCanvas);
        if (!this.thumbs.ready) this.thumbs = null;
      } catch {
        this.thumbs = null;
      }
    }
    this.bar = this.buildToolbar();
    this.statusEl = h('div', { class: 'k-ge-status' });
    this.root = h('div', { class: 'k-ge', tabindex: '-1' }, this.gpuCanvas, this.canvas, this.bar, this.statusEl, this.minimap.el, this.tip);
    container.append(this.root);
    this.bindGraph();
    this.bindDom();
    this.bindHost();
    this.resize(container.clientWidth || 800, container.clientHeight || 600);
    this.requestDraw();
  }

  /* ============================================================================================ lifecycle */
  private get g(): Graph {
    return this.host.editor().graph;
  }
  private get ed(): GraphEditor {
    return this.host.editor();
  }

  private bindGraph(): void {
    const g = this.g;
    this.hostGraph = g;
    this.scene.setGraph(g);
    this.thumbs?.attach(g);
    this.graphUnsub = g.events.on((e) => {
      if (e.type === 'meta' && e.nodeId) this.scene.invalidate('pos');
      else if (e.type !== 'param' && e.type !== 'settings') this.scene.invalidate('struct');
      if (e.type === 'structure' || e.type === 'reset' || (e.type === 'meta' && !e.nodeId)) this.pruneSelection();
      this.requestDraw();
    });
  }
  private unbindGraph(): void {
    this.graphUnsub?.();
    this.graphUnsub = null;
  }

  private bindHost(): void {
    const h_ = this.host;
    const syncFromHost = (): void => {
      if (this.syncing) return;
      const ids = [...h_.selection.get()];
      const cur = [...this.sel.nodes];
      if (ids.length === cur.length && ids.every((i) => this.sel.nodes.has(i))) return;
      this.sel = { ...emptySel(), nodes: new Set(ids.filter((i) => this.g.nodes.has(i))) };
      this.requestDraw();
    };
    this.unsubs.push(h_.selection.onChange.on(syncFromHost));
    if (h_.active) this.unsubs.push(h_.active.onChange.on(() => this.requestDraw()));
    const onLocale = (): void => this.requestDraw(); // language switch: node titles / pin names are drawn on the canvas
    window.addEventListener('kk-locale', onLocale);
    this.unsubs.push(() => window.removeEventListener('kk-locale', onLocale));
    // UI scale / theme: canvas-drawn UI scales through the view zoom (same transform as hit-testing), colours come from the theme tokens
    let lastUiScale = uiState().scale;
    this.unsubs.push(
      onUiChange((st, changed) => {
        if (changed.includes('scale') && st.scale !== lastUiScale) {
          const k = st.scale / lastUiScale;
          lastUiScale = st.scale;
          this.animator.set(zoomAt(this.view, this.W / 2, this.H / 2, this.view.zoom * k));
        }
        this.requestDraw();
      }),
    );
    if (h_.onProjectChange) {
      this.unsubs.push(
        h_.onProjectChange.on(() => {
          this.unbindGraph();
          this.cancelDrag();
          this.sel = emptySel();
          this.schedErrors.clear();
          this.errors.clear();
          this.bindGraph();
          this.bindHost2();
          this.fitAll(false);
        }),
      );
    }
    if (h_.engine) {
      this.unsubs.push(
        h_.engine.scheduler.onResult.on(({ result }) => {
          this.schedErrors = new Map(result.errors);
          const info = new Map<string, NodeInfo>();
          for (const [id, st] of result.stats.nodes) if (st.width) info.set(id, { w: st.width, h: st.height });
          this.schedInfo = info;
          this.mergeErrors();
          this.requestDraw();
        }),
      );
    }
    if (this.thumbs) {
      this.unsubs.push(this.thumbs.onUpdated.on(() => this.requestDraw()));
      this.unsubs.push(
        this.thumbs.onErrors.on(() => {
          this.mergeErrors();
          this.requestDraw();
        }),
      );
    }
    if (h_.visible) {
      this.unsubs.push(
        h_.visible.subscribe((v) => {
          this.visible = v;
          if (this.thumbs) this.thumbs.enabled = v;
          if (v) this.requestDraw();
        }, true),
      );
    }
    this.unsubs.push(graphNavigation.onChange.on(() => this.renderCrumbs()));
  }
  private bindHost2(): void {
    /* project replaced: the host subscriptions above are still valid, only graph-bound ones were rebuilt */
  }
  private mergeErrors(): void {
    const m = new Map<string, string>(this.thumbs?.errors ?? []);
    for (const [k, v] of this.schedErrors) m.set(k, v);
    for (const k of [...m.keys()]) if (!this.g.nodes.has(k)) m.delete(k);
    this.errors = m;
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.unbindGraph();
    this.unsubs.forEach((u) => u());
    this.thumbs?.dispose();
    this.popup?.close();
    document.removeEventListener('copy', this.onCopy);
    document.removeEventListener('cut', this.onCut);
    document.removeEventListener('paste', this.onPaste);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.root.remove();
  }

  resize(w: number, h_: number): void {
    this.W = Math.max(50, Math.floor(w));
    this.H = Math.max(50, Math.floor(h_));
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.gpuCanvas]) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
      c.style.width = `${this.W}px`;
      c.style.height = `${this.H}px`;
    }
    if (this.firstFit && this.g.nodes.size) {
      this.firstFit = false;
      this.fitAll(false);
    }
    this.requestDraw();
  }

  /* ============================================================================================ camera */
  get view(): View {
    return this.animator.view;
  }
  setView(v: View): void {
    this.firstFit = false; // an explicit camera (restored workspace) wins over the initial fit
    this.animator.set(v);
    this.requestDraw();
  }
  fitAll(animate = true): void {
    const b = this.scene.contentBounds();
    this.focusRect(b ?? { x: -200, y: -150, w: 400, h: 300 }, animate);
  }
  fitSelection(): void {
    const rs = this.selectionRects();
    if (!rs.length) return this.fitAll();
    const x0 = Math.min(...rs.map((r) => r.x)),
      y0 = Math.min(...rs.map((r) => r.y)),
      x1 = Math.max(...rs.map((r) => r.x + r.w)),
      y1 = Math.max(...rs.map((r) => r.y + r.h));
    this.focusRect({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  }
  focusRect(r: Rect, animate = true): void {
    const v = frameRect(r, this.W, this.H, 70);
    if (animate) this.animator.focusTo(v, this.W, this.H);
    else this.animator.set(v);
    this.requestDraw();
  }
  centreOn(c: Pt, animate = true): void {
    const z = this.view.zoom;
    const v: View = { zoom: z, x: this.W / 2 - c.x * z, y: this.H / 2 - c.y * z };
    if (animate) this.animator.focusTo(v, this.W, this.H);
    else this.animator.set(v);
    this.requestDraw();
  }
  private selectionRects(): Rect[] {
    const g = this.g,
      a = g.annotations;
    const rs: Rect[] = [];
    for (const id of this.sel.nodes) if (g.nodes.has(id) && !this.scene.hidden.has(id)) rs.push(this.scene.rectOf(id));
    for (const f of a.frames) if (this.sel.frames.has(f.id)) rs.push(this.scene.frameRect(f));
    for (const n of a.notes) if (this.sel.notes.has(n.id)) rs.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    for (const r of a.reroutes) if (this.sel.reroutes.has(r.id)) rs.push({ x: r.x - 6, y: r.y - 6, w: 12, h: 12 });
    return rs;
  }
  /** A free spot in the visible area for nodes created from outside (library, palette). */
  nextNodePosition(fallback?: Pt): Pt {
    const c = toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
    let x = snapToGrid(c.x - NODE.defaultW / 2, NODE.gridSize),
      y = snapToGrid(c.y - 90, NODE.gridSize);
    if (!this.g.nodes.size && fallback) return fallback;
    for (let i = 0; i < 24; i++) {
      const r: Rect = { x: x - 8, y: y - 8, w: NODE.defaultW + 16, h: 200 };
      if (!this.scene.nodesInRect(r).length) break;
      x += 40;
      y += 30;
    }
    return { x, y };
  }

  /* ============================================================================================ selection */
  private pruneSelection(): void {
    const g = this.g,
      a = g.annotations;
    let changed = false;
    for (const id of [...this.sel.nodes]) if (!g.nodes.has(id)) { this.sel.nodes.delete(id); changed = true; }
    for (const id of [...this.sel.frames]) if (!a.frames.some((f) => f.id === id)) { this.sel.frames.delete(id); changed = true; }
    for (const id of [...this.sel.notes]) if (!a.notes.some((f) => f.id === id)) { this.sel.notes.delete(id); changed = true; }
    for (const id of [...this.sel.reroutes]) if (!a.reroutes.some((f) => f.id === id)) { this.sel.reroutes.delete(id); changed = true; }
    for (const id of [...this.sel.links]) if (!g.links.has(id)) { this.sel.links.delete(id); changed = true; }
    if (changed) this.syncHostSelection();
  }
  private syncHostSelection(): void {
    this.syncing = true;
    try {
      this.host.selection.set([...this.sel.nodes]);
    } finally {
      this.syncing = false;
    }
  }
  setSelection(s: ItemSel): void {
    this.sel = s;
    this.syncHostSelection();
    this.requestDraw();
  }
  selectNodes(ids: string[], additive = false): void {
    const s = additive ? this.sel : emptySel();
    ids.forEach((i) => s.nodes.add(i));
    this.setSelection(s);
  }
  selectAll(): void {
    const a = this.g.annotations;
    this.setSelection({ nodes: new Set(this.g.nodes.keys()), frames: new Set(a.frames.map((f) => f.id)), notes: new Set(a.notes.map((f) => f.id)), reroutes: new Set(), links: new Set() });
  }
  deselect(): void {
    this.setSelection(emptySel());
  }
  hasSelection(): boolean {
    return selCount(this.sel) > 0;
  }
  selectStream(dir: 'up' | 'down'): void {
    const ids = [...this.sel.nodes];
    if (!ids.length) return;
    const s = dir === 'up' ? this.g.upstream(ids) : this.g.downstream(ids);
    this.selectNodes([...s]);
  }
  private selectItem(kind: 'nodes' | 'frames' | 'notes' | 'reroutes' | 'links', id: string, additive: boolean, toggle: boolean): void {
    if (additive || toggle) {
      const set = this.sel[kind];
      if (set.has(id) && toggle) set.delete(id);
      else set.add(id);
      this.setSelection(this.sel);
    } else {
      const s = emptySel();
      s[kind].add(id);
      this.setSelection(s);
    }
  }

  /* ============================================================================================ hit test */
  private hitTest(w: Pt, e?: { shiftKey?: boolean }): Hit {
    void e;
    const z = this.view.zoom;
    const sc = this.scene;
    sc.ensure();
    const a = this.g.annotations;
    // reroutes first (small, on top of links)
    for (let i = a.reroutes.length - 1; i >= 0; i--) {
      const r = a.reroutes[i];
      if (!this.rerouteLive(r.id)) continue;
      const d = Math.hypot(r.x - w.x, r.y - w.y);
      if (d <= 10) return { kind: 'reroute', id: r.id, out: w.x - r.x > 5 };
    }
    const pin = sc.pinAt(w.x, w.y, NODE.pinHit / Math.min(1, Math.max(z, 0.6)) + (z < 0.55 ? 3 : 0));
    if (pin && z >= 0.3) return { kind: 'pin', pin };
    const id = sc.nodeAt(w.x, w.y);
    if (id) {
      const n = this.g.nodes.get(id)!;
      const l = sc.layoutOf(id);
      const lx = w.x - n.x,
        ly = w.y - n.y;
      if (ly <= NODE.headerH && z >= 0.55 && (this.sel.nodes.has(id) || this.hoverNode === id || l.collapsed)) {
        const hasEdit = !!this.profileParamOf(id);
        for (const k of ['collapse', 'bypass', 'view2d', 'view3d', 'lock', 'edit'] as const) {
          const r = l.buttons[k];
          if (k !== 'collapse' && l.collapsed) continue;
          if (k === 'edit' && !hasEdit) continue;
          if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return { kind: 'button', node: id, button: k };
        }
      }
      if (!l.collapsed && ly > NODE.headerH && lx >= l.w - 6 / z && z >= 0.45) return { kind: 'resize', node: id };
      return { kind: 'node', node: id, header: ly <= NODE.headerH };
    }
    for (let i = a.notes.length - 1; i >= 0; i--) {
      const n = a.notes[i];
      if (rectContains({ x: n.x, y: n.y, w: n.w, h: n.h }, w.x, w.y)) return { kind: 'note', id: n.id, resize: w.x > n.x + n.w - 14 && w.y > n.y + n.h - 14 };
    }
    // frame resize corner before links
    for (let i = a.frames.length - 1; i >= 0; i--) {
      const f = a.frames[i];
      if (!f.collapsed && w.x > f.x + f.w - 16 && w.x < f.x + f.w + 4 && w.y > f.y + f.h - 16 && w.y < f.y + f.h + 4) return { kind: 'frame', id: f.id, part: 'resize' };
    }
    const lk = this.linkAt(w);
    if (lk) return lk;
    const fb = sc.frameBarAt(w.x, w.y);
    if (fb) return { kind: 'frame', id: fb.id, part: w.x < fb.x + 24 ? 'chevron' : 'bar' };
    const fr = sc.frameBorderAt(w.x, w.y, 5 / z);
    if (fr) return { kind: 'frame', id: fr.id, part: 'border' };
    return { kind: 'none' };
  }
  private rerouteLive(id: string): boolean {
    const via = this.g.annotations.linkVia;
    for (const k in via) if (this.g.links.has(k) && via[k].includes(id)) return true;
    return false;
  }
  private linkAt(w: Pt): Hit | null {
    const z = this.view.zoom;
    const tol = 7 / z;
    const segs = this.scene.visibleSegments({ x: w.x - tol, y: w.y - tol, w: 2 * tol, h: 2 * tol });
    let best: { seg: LinkSegment; d: number; idx: number; at: Pt } | null = null;
    for (const seg of segs) {
      const pts = linkSamples(seg.a, seg.b, this.scene.linkStyle, 24);
      const c = closestOnPolyline(w, pts);
      if (c.dist <= tol && (!best || c.dist < best.d)) best = { seg, d: c.dist, idx: 0, at: c.point };
    }
    if (!best) return null;
    const lid = best.seg.links[0];
    const link = this.g.links.get(lid)!;
    // segment index within the link's anchor chain (for reroute insertion)
    const anchors = this.scene.anchorsOf(link) ?? [];
    let index = 0;
    for (let i = 0; i < anchors.length - 1; i++) if (anchors[i] === best.seg.a || (anchors[i].x === best.seg.a.x && anchors[i].y === best.seg.a.y)) index = i;
    return { kind: 'link', seg: best.seg, link: lid, index, at: best.at };
  }

  /* ============================================================================================ DOM events */
  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  isActive(): boolean {
    if (this.root.contains(document.activeElement) && document.activeElement !== document.body) return true;
    if (this.mouseIn) return true;
    return !!document.querySelector('.k-palette-back, .k-modal-back') && this.root.matches(':focus-within');
  }
  focus(): void {
    this.canvas.focus({ preventScroll: true });
  }

  private bindDom(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', this.onDown);
    c.addEventListener('pointermove', this.onMove);
    c.addEventListener('pointerup', this.onUp);
    c.addEventListener('pointercancel', this.onUp);
    c.addEventListener('lostpointercapture', () => void 0);
    c.addEventListener('wheel', this.onWheel, { passive: false });
    c.addEventListener('contextmenu', this.onContext);
    c.addEventListener('pointerenter', () => (this.mouseIn = true));
    c.addEventListener('pointerleave', () => {
      this.mouseIn = false;
      this.hideTip();
      if (!this.drag) this.setHover({ kind: 'none' });
    });
    c.addEventListener('keydown', this.onKeyDown);
    c.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('application/x-kekenik-node')) {
        e.preventDefault();
        this.root.classList.add('k-drop-hint');
      }
    });
    c.addEventListener('dragleave', () => this.root.classList.remove('k-drop-hint'));
    c.addEventListener('drop', (e) => {
      this.root.classList.remove('k-drop-hint');
      if (e.dataTransfer?.files?.length) graphExtensions.lastDrop = { world: toWorld(this.view, this.local(e)), t: performance.now() };
      const t = e.dataTransfer?.getData('application/x-kekenik-node');
      if (!t) return;
      e.preventDefault();
      const w = toWorld(this.view, this.local(e));
      const id = this.ops.addNode(t, { x: w.x - NODE.defaultW / 2, y: w.y - 14 });
      if (id) this.selectNodes([id]);
    });
    document.addEventListener('copy', this.onCopy);
    document.addEventListener('cut', this.onCut);
    document.addEventListener('paste', this.onPaste);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  private onBlur = (): void => {
    this.space = false;
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') {
      this.space = false;
      this.canvas.style.cursor = '';
    }
  };

  /* ---------------------------------------------------------------------------- wheel / touchpad / pinch */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const nav = this.prefs.nav;
    const small = e.deltaMode === 0 && Math.abs(e.deltaY) < 45 && Math.abs(e.deltaX) < 200;
    const trackpad = nav === 'trackpad' || (nav === 'auto' && (small || (e.deltaX !== 0 && e.deltaMode === 0)));
    if (e.ctrlKey || e.metaKey || !trackpad) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (e.ctrlKey && trackpad) {
        // pinch (ctrl+wheel with fine deltas): immediate, high frequency
        this.animator.set(zoomAt(this.view, p.x, p.y, this.view.zoom * Math.exp(-dy * 0.01)));
      } else {
        this.animator.zoomTo(p.x, p.y, this.animator.targetZoom * Math.exp(-Math.sign(dy) * Math.min(Math.abs(dy), 240) * 0.0016));
      }
    } else {
      const v = this.view;
      this.animator.set({ zoom: v.zoom, x: v.x - (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey && !e.deltaX ? 0 : e.deltaY) });
    }
    this.requestDraw();
  };

  /* ---------------------------------------------------------------------------- pointer down */
  private onDown = (e: PointerEvent): void => {
    this.focus();
    this.hideTip();
    this.closePopup();
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (e.pointerType === 'touch' && this.pointers.size === 2) {
      this.cancelDrag();
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (e.button === 1 || (e.button === 0 && this.space)) {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.animator.set(this.view);
      this.drag = { kind: 'pan', sx: p.x, sy: p.y, vx: this.view.x, vy: this.view.y };
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.animator.set(this.view); // stop camera animation under the cursor
    const w = toWorld(this.view, p);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (e.altKey) {
      const lk = this.linkAt(w);
      if (lk && lk.kind === 'link') {
        this.cutLinks(lk.seg.links);
        return;
      }
      this.drag = { kind: 'cut', a: w, b: w };
      this.cutLine = [w, w];
      return;
    }
    const hit = this.hitTest(w, e);
    if (e.detail >= 2 && this.onDouble(hit, w, p, e)) return;
    const press: Press = { hit, p, w, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, started: false, deferSelect: false };
    this.press = press;
    switch (hit.kind) {
      case 'node':
        this.scene.bringToFront([hit.node]);
        if (additive) this.selectItem('nodes', hit.node, false, true);
        else if (!this.sel.nodes.has(hit.node)) this.selectItem('nodes', hit.node, false, false);
        else press.deferSelect = true;
        break;
      case 'resize':
      case 'button':
        if (!this.sel.nodes.has(hit.node)) this.selectItem('nodes', hit.node, false, false);
        break;
      case 'pin':
        break;
      case 'note':
        if (additive) this.selectItem('notes', hit.id, false, true);
        else if (!this.sel.notes.has(hit.id)) this.selectItem('notes', hit.id, false, false);
        else press.deferSelect = true;
        break;
      case 'reroute':
        if (hit.out) break;
        if (additive) this.selectItem('reroutes', hit.id, false, true);
        else if (!this.sel.reroutes.has(hit.id)) this.selectItem('reroutes', hit.id, false, false);
        else press.deferSelect = true;
        break;
      case 'frame':
        if (hit.part === 'chevron') break;
        if (additive) this.selectItem('frames', hit.id, false, true);
        else if (!this.sel.frames.has(hit.id)) this.selectItem('frames', hit.id, false, false);
        else press.deferSelect = true;
        break;
      case 'link':
        this.selectItem('links', hit.link, additive, false);
        break;
      default:
        break;
    }
    this.requestDraw();
  };

  private onDouble(hit: Hit, w: Pt, p: Pt, e: PointerEvent): boolean {
    this.press = null;
    switch (hit.kind) {
      case 'node': {
        if (hit.header) {
          this.renameNode(hit.node);
          return true;
        }
        if (graphNavigation.canEnter(this.g, hit.node)) {
          graphNavigation.enter(this.g, hit.node);
          return true;
        }
        this.viewNode(hit.node, '2d');
        return true;
      }
      case 'link':
        this.ops.insertReroute(this.g.links.get(hit.link) ? hit.seg.links : [], hit.index, hit.at);
        return true;
      case 'note':
        this.editNote(hit.id);
        return true;
      case 'frame':
        if (hit.part === 'bar' || hit.part === 'chevron') {
          this.renameFrame(hit.id);
          return true;
        }
        return false;
      case 'reroute':
        this.ops.removeReroutes(new Set([hit.id]));
        return true;
      case 'none':
        this.openSearch(p, w);
        return true;
      default:
        void e;
        return false;
    }
  }

  /* ---------------------------------------------------------------------------- pointer move */
  private onMove = (e: PointerEvent): void => {
    const p = this.local(e);
    this.mouse = p;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let v = zoomAt(this.view, c.x, c.y, this.view.zoom * (d / Math.max(1, this.pinch.d)));
      v = { ...v, x: v.x + (c.x - this.pinch.c.x), y: v.y + (c.y - this.pinch.c.y) };
      this.pinch = { d, c };
      this.animator.set(v);
      this.requestDraw();
      return;
    }
    if (this.drag) {
      this.dragMove(e, p);
      return;
    }
    const pr = this.press;
    if (pr && !pr.started) {
      if (Math.hypot(p.x - pr.p.x, p.y - pr.p.y) < 4) return;
      pr.started = true;
      this.startDrag(pr, e);
      if (this.drag) this.dragMove(e, p);
      return;
    }
    if (e.buttons === 0) {
      this.pendingHover = true;
      this.requestDraw();
    }
  };

  private startDrag(pr: Press, e: PointerEvent): void {
    const hit = pr.hit;
    const w = pr.w;
    switch (hit.kind) {
      case 'pin':
        this.beginLinkFromPin(hit.pin, pr.ctrl, w);
        break;
      case 'reroute':
        if (hit.out) this.beginLinkFromReroute(hit.id, w);
        else this.beginMove(w);
        break;
      case 'node':
        this.beginMove(w);
        break;
      case 'note': {
        if (hit.resize) {
          const n = this.g.annotations.notes.find((x) => x.id === hit.id)!;
          this.drag = { kind: 'resizeRect', what: 'note', id: n.id, r: { x: n.x, y: n.y, w: n.w, h: n.h }, start: w, cur: { x: n.x, y: n.y, w: n.w, h: n.h } };
        } else this.beginMove(w);
        break;
      }
      case 'frame':
        if (hit.part === 'resize') {
          const f = this.g.annotations.frames.find((x) => x.id === hit.id)!;
          this.drag = { kind: 'resizeRect', what: 'frame', id: f.id, r: { x: f.x, y: f.y, w: f.w, h: f.h }, start: w, cur: { x: f.x, y: f.y, w: f.w, h: f.h } };
        } else if (hit.part !== 'chevron') this.beginMove(w);
        break;
      case 'resize': {
        const n = this.g.nodes.get(hit.node)!;
        if (this.ops.isLocked(hit.node)) break;
        this.drag = { kind: 'resizeNode', id: hit.node, startW: this.scene.layoutOf(hit.node).w, startX: w.x, w: this.scene.layoutOf(hit.node).w };
        void n;
        break;
      }
      case 'link': {
        // dragging a link creates a reroute at the pointer and drags it (one undo step, aborted on Esc)
        this.ed.stack.begin('Add reroute');
        const id = this.ops.insertReroute(hit.seg.links, hit.index, w);
        const s = emptySel();
        s.reroutes.add(id);
        this.setSelection(s);
        this.beginMove(w, true);
        break;
      }
      case 'none': {
        const additive = pr.shift || pr.ctrl;
        this.drag = { kind: 'marquee', start: w, additive, base: additive ? { nodes: new Set(this.sel.nodes), frames: new Set(this.sel.frames), notes: new Set(this.sel.notes), reroutes: new Set(this.sel.reroutes), links: new Set() } : emptySel() };
        if (!additive) this.setSelection(emptySel());
        break;
      }
      default:
        break;
    }
    void e;
  }

  private beginMove(start: Pt, txn = false): void {
    const g = this.g;
    const set: MoveSet = { nodes: new Map(), frames: new Map(), notes: new Map(), reroutes: new Map() };
    const nodeIds = new Set(this.sel.nodes);
    const frameIds = new Set(this.sel.frames);
    const noteIds = new Set(this.sel.notes);
    const rrIds = new Set(this.sel.reroutes);
    for (const fid of this.sel.frames) {
      const f = g.annotations.frames.find((x) => x.id === fid);
      if (!f) continue;
      const m = this.scene.membersOf(f);
      m.nodes.forEach((i) => nodeIds.add(i));
      m.notes.forEach((i) => noteIds.add(i));
      m.reroutes.forEach((i) => rrIds.add(i));
      m.frames.forEach((i) => frameIds.add(i));
    }
    for (const id of nodeIds) {
      const n = g.nodes.get(id);
      if (n && !this.ops.isLocked(id)) set.nodes.set(id, [n.x, n.y]);
    }
    for (const f of g.annotations.frames) if (frameIds.has(f.id)) set.frames.set(f.id, [f.x, f.y]);
    for (const n of g.annotations.notes) if (noteIds.has(n.id)) set.notes.set(n.id, [n.x, n.y]);
    for (const r of g.annotations.reroutes) if (rrIds.has(r.id)) set.reroutes.set(r.id, [r.x, r.y]);
    const rects: Rect[] = [...set.nodes.keys()].map((i) => this.scene.rectOf(i));
    for (const f of g.annotations.frames) if (set.frames.has(f.id)) rects.push(this.scene.frameRect(f));
    for (const n of g.annotations.notes) if (set.notes.has(n.id)) rects.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    for (const r of g.annotations.reroutes) if (set.reroutes.has(r.id)) rects.push({ x: r.x - 6, y: r.y - 6, w: 12, h: 12 });
    const box = rects.length
      ? { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)), w: Math.max(...rects.map((r) => r.x + r.w)) - Math.min(...rects.map((r) => r.x)), h: Math.max(...rects.map((r) => r.y + r.h)) - Math.min(...rects.map((r) => r.y)) }
      : null;
    this.drag = { kind: 'move', start, set, box, dx: 0, dy: 0, txn };
  }

  /* ---------------------------------------------------------------------------- link dragging */
  private makeLinkView(anchor: PinHit, side: 'out' | 'in', forbidden: ReadonlySet<string>, pointer: Pt): LinkDragView {
    return { side, anchor, pointer, snap: null, dropNode: null, valid: null, forbidden };
  }
  private beginLinkFromPin(pin: PinHit, ctrl: boolean, w: Pt): void {
    const g = this.g;
    if (pin.side === 'out') {
      const links = g.linksFrom(pin.node, pin.pin);
      if (ctrl && links.length) {
        // ctrl-drag: pick up ALL links of this output pin and drop them onto another output
        const anchorLink = links[0];
        const inPos = this.scene.pinWorld(anchorLink.to.node, anchorLink.to.pin, 'in')!;
        const anchor: PinHit = { node: anchorLink.to.node, pin: anchorLink.to.pin, side: 'in', type: this.scene.pinTypeOf(anchorLink.to.node, anchorLink.to.pin, 'in'), pos: inPos };
        const fb = new Set<string>();
        for (const l of links) g.downstream([l.to.node]).forEach((x) => fb.add(x));
        const v = this.makeLinkView(anchor, 'in', fb, w);
        v.extra = links.slice(1).map((l) => this.scene.pinWorld(l.to.node, l.to.pin, 'in')!);
        const manyVia = new Map(links.map((l) => [l.id, g.annotations.linkVia[l.id] ?? []] as const));
        this.scene.hideLinks = new Set(links.map((l) => l.id));
        this.drag = { kind: 'link', v, existing: null, many: links, via: [], manyVia };
        return;
      }
      const v = this.makeLinkView(pin, 'out', g.upstream([pin.node]), w);
      this.drag = { kind: 'link', v, existing: null, many: null, via: [], manyVia: new Map() };
      return;
    }
    const existing = g.inputLink(pin.node, pin.pin);
    if (existing) {
      // grab the link end: we now hold its SOURCE output
      const op = this.scene.pinWorld(existing.from.node, existing.from.pin, 'out')!;
      const anchor: PinHit = { node: existing.from.node, pin: existing.from.pin, side: 'out', type: this.scene.pinTypeOf(existing.from.node, existing.from.pin, 'out'), pos: op };
      const v = this.makeLinkView(anchor, 'out', g.upstream([existing.from.node]), w);
      this.scene.hideLinks = new Set([existing.id]);
      this.drag = { kind: 'link', v, existing, many: null, via: [], manyVia: new Map() };
      return;
    }
    const v = this.makeLinkView(pin, 'in', g.downstream([pin.node]), w);
    this.drag = { kind: 'link', v, existing: null, many: null, via: [], manyVia: new Map() };
  }
  private beginLinkFromReroute(id: string, w: Pt): void {
    const g = this.g;
    for (const [lid, via] of Object.entries(g.annotations.linkVia)) {
      const idx = via.indexOf(id);
      const l = g.links.get(lid);
      if (idx < 0 || !l) continue;
      const pos = this.scene.pinWorld(l.from.node, l.from.pin, 'out')!;
      const anchor: PinHit = { node: l.from.node, pin: l.from.pin, side: 'out', type: this.scene.pinTypeOf(l.from.node, l.from.pin, 'out'), pos };
      const v = this.makeLinkView(anchor, 'out', g.upstream([l.from.node]), w);
      const rr = g.annotations.reroutes.find((r) => r.id === id);
      if (rr) v.anchor = { ...anchor, pos: { x: rr.x, y: rr.y } };
      this.drag = { kind: 'link', v, existing: null, many: null, via: via.slice(0, idx + 1), manyVia: new Map() };
      return;
    }
  }

  private updateLinkDrag(d: Extract<Drag, { kind: 'link' }>, w: Pt): void {
    const v = d.v;
    v.pointer = w;
    const z = this.view.zoom;
    const want = v.side === 'out' ? 'in' : 'out';
    const radius = 28 / z;
    const exact = NODE.pinHit / Math.max(z, 0.6);
    const sc = this.scene;
    let best: PinHit | null = null;
    let bd = Infinity;
    let blocked: string | null = null;
    for (const id of sc.nodesInRect({ x: w.x - radius - 200, y: w.y - radius - 100, w: 2 * radius + 400, h: 2 * radius + 200 })) {
      if (id === v.anchor.node && !(d.existing || d.many)) continue;
      const n = this.g.nodes.get(id)!;
      const l = sc.layoutOf(id);
      for (const p of want === 'in' ? l.inputs : l.outputs) {
        const dist = Math.hypot(n.x + p.x - w.x, n.y + p.y - w.y);
        if (dist > radius) continue;
        const ok = (v.side === 'out' ? canConnect(v.anchor.type, p.type) : canConnect(p.type, v.anchor.type)) && !v.forbidden.has(id);
        if (!ok) {
          if (dist <= exact) blocked = v.forbidden.has(id) ? 'Would create a cycle' : `Cannot connect ${v.side === 'out' ? v.anchor.type : p.type} to ${v.side === 'out' ? p.type : v.anchor.type}`;
          continue;
        }
        if (dist < bd) {
          bd = dist;
          best = { node: id, pin: p.id, side: p.side, type: p.type, pos: { x: n.x + p.x, y: n.y + p.y } };
        }
      }
    }
    v.snap = best;
    v.dropNode = null;
    v.valid = best ? true : blocked ? false : null;
    if (!best) {
      const nid = sc.nodeAt(w.x, w.y);
      if (nid) {
        const ex = this.g.registry.expanded(this.g.nodes.get(nid)!.type);
        const pin = ex && !v.forbidden.has(nid) ? pickPin(ex, want === 'in' ? 'in' : 'out', v.anchor.type, sc.connectedPins(nid)) : undefined;
        if (pin) {
          v.dropNode = nid;
          v.valid = true;
        } else {
          v.dropNode = nid;
          v.valid = false;
          blocked = v.forbidden.has(nid) ? 'Would create a cycle' : 'No compatible pin on this node';
        }
      }
    }
    if (blocked || (v.dropNode && v.valid === false)) this.showTip(blocked ?? 'Incompatible', this.mouse, true);
    else this.hideTip();
  }

  private finishLink(d: Extract<Drag, { kind: 'link' }>, e: PointerEvent): void {
    const v = d.v;
    const ed = this.ed;
    const g = this.g;
    this.scene.hideLinks = new Set();
    const target = this.dropTarget(v);
    const wp = toWorld(this.view, this.local(e));
    if (target) {
      const outRef = v.side === 'out' ? { node: v.anchor.node, pin: v.anchor.pin } : { node: target.node, pin: target.pin };
      if (d.many) {
        ed.stack.transaction('Move links', () => {
          for (const l of d.many!) {
            if (!g.links.has(l.id)) continue;
            ed.disconnect(l.id);
            const nl = this.ops.safeConnect({ node: target.node, pin: target.pin }, l.to, d.manyVia.get(l.id));
            void nl;
          }
        });
      } else {
        const inRef = v.side === 'out' ? { node: target.node, pin: target.pin } : { node: v.anchor.node, pin: v.anchor.pin };
        ed.stack.transaction(d.existing ? 'Reconnect' : 'Connect', () => {
          if (d.existing && g.links.has(d.existing.id) && (d.existing.to.node !== inRef.node || d.existing.to.pin !== inRef.pin || d.existing.from.node !== outRef.node || d.existing.from.pin !== outRef.pin)) ed.disconnect(d.existing.id);
          else if (d.existing) return;
          this.ops.safeConnect(outRef, inRef, d.via);
        });
      }
      this.requestDraw();
      return;
    }
    // released on empty space
    if (d.existing) {
      ed.disconnect(d.existing.id);
      this.requestDraw();
      return;
    }
    if (d.many) return;
    if (v.dropNode && v.valid === false) return;
    const filter: SearchFilter = { dragSide: v.side, type: v.anchor.type };
    this.openSearch(this.local(e), wp, filter, { ref: { node: v.anchor.node, pin: v.anchor.pin }, side: v.side, type: v.anchor.type }, d.via);
  }

  /** Resolve where a link drag would connect right now (exact/magnet pin or best pin of the hovered node). */
  private dropTarget(v: LinkDragView): { node: string; pin: string } | null {
    if (v.snap) return { node: v.snap.node, pin: v.snap.pin };
    if (v.dropNode && v.valid) {
      const ex = this.g.registry.expanded(this.g.nodes.get(v.dropNode)!.type);
      const pin = ex ? pickPin(ex, v.side === 'out' ? 'in' : 'out', v.anchor.type, this.scene.connectedPins(v.dropNode)) : undefined;
      return pin ? { node: v.dropNode, pin: pin.id } : null;
    }
    return null;
  }

  /* ---------------------------------------------------------------------------- drag move */
  private dragMove(e: PointerEvent, p: Pt): void {
    const d = this.drag!;
    const w = toWorld(this.view, p);
    switch (d.kind) {
      case 'pan':
        this.animator.set({ zoom: this.view.zoom, x: d.vx + (p.x - d.sx), y: d.vy + (p.y - d.sy) });
        break;
      case 'marquee': {
        const r = rectFromPoints(d.start, w);
        this.marquee = r;
        const g = this.g,
          a = g.annotations;
        const s: ItemSel = d.additive ? { nodes: new Set(d.base.nodes), frames: new Set(d.base.frames), notes: new Set(d.base.notes), reroutes: new Set(d.base.reroutes), links: new Set() } : emptySel();
        for (const id of this.scene.nodesInRect(r)) s.nodes.add(id);
        for (const n of a.notes) if (rectsIntersect(r, { x: n.x, y: n.y, w: n.w, h: n.h })) s.notes.add(n.id);
        for (const f of a.frames) if (r.x <= f.x && r.y <= f.y && r.x + r.w >= f.x + f.w && r.y + r.h >= f.y + (f.collapsed ? FRAME_BAR_H : f.h)) s.frames.add(f.id);
        for (const rr of a.reroutes) if (rectContains(r, rr.x, rr.y) && this.rerouteLive(rr.id)) s.reroutes.add(rr.id);
        this.sel = s;
        this.syncHostSelection();
        break;
      }
      case 'move': {
        let dx = w.x - d.start.x,
          dy = w.y - d.start.y;
        this.guides = [];
        if (d.box && (this.prefs.snap || true) && !e.altKey) {
          const box = { x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h };
          const near = this.scene.nodesInRect({ x: box.x - 60, y: box.y - 60, w: box.w + 120, h: box.h + 120 }).filter((id) => !d.set.nodes.has(id)).map((id) => this.scene.rectOf(id));
          const sn = snapMove(box, near, { grid: this.prefs.snap ? NODE.gridSize : null, threshold: 7 / this.view.zoom });
          dx += sn.dx;
          dy += sn.dy;
          this.guides = sn.guides;
        }
        d.dx = dx;
        d.dy = dy;
        this.applyMove(d, dx, dy);
        break;
      }
      case 'resizeNode': {
        const nw = Math.round(Math.max(NODE.minW, Math.min(NODE.maxW, d.startW + (w.x - d.startX))) / (this.prefs.snap ? 10 : 1)) * (this.prefs.snap ? 10 : 1);
        d.w = nw;
        const a = this.g.annotations;
        a.nodeUi[d.id] = { ...(a.nodeUi[d.id] ?? {}), w: nw };
        this.scene.invalidate('struct');
        this.touchGraph();
        break;
      }
      case 'resizeRect': {
        let nw = Math.max(80, d.r.w + (w.x - d.start.x)),
          nh = Math.max(d.what === 'frame' ? 60 : 50, d.r.h + (w.y - d.start.y));
        if (this.prefs.snap) {
          nw = snapToGrid(nw, 10);
          nh = snapToGrid(nh, 10);
        }
        d.cur = { x: d.r.x, y: d.r.y, w: nw, h: nh };
        const a = this.g.annotations;
        const item = d.what === 'frame' ? a.frames.find((f) => f.id === d.id) : a.notes.find((f) => f.id === d.id);
        if (item) Object.assign(item, { w: nw, h: nh });
        this.scene.invalidate('struct');
        this.touchGraph();
        break;
      }
      case 'link':
        this.updateLinkDrag(d, w);
        break;
      case 'cut':
        d.b = w;
        this.cutLine = [d.a, w];
        break;
    }
    this.requestDraw();
  }

  /** Preview a move without touching the undo stack (committed as ONE command on pointer-up). */
  private applyMove(d: Extract<Drag, { kind: 'move' }>, dx: number, dy: number): void {
    const g = this.g;
    for (const [id, [x, y]] of d.set.nodes) {
      const n = g.nodes.get(id);
      if (n) {
        n.x = x + dx;
        n.y = y + dy;
      }
    }
    const a = g.annotations;
    for (const f of a.frames) {
      const o = d.set.frames.get(f.id);
      if (o) { f.x = o[0] + dx; f.y = o[1] + dy; }
    }
    for (const n of a.notes) {
      const o = d.set.notes.get(n.id);
      if (o) { n.x = o[0] + dx; n.y = o[1] + dy; }
    }
    for (const r of a.reroutes) {
      const o = d.set.reroutes.get(r.id);
      if (o) { r.x = o[0] + dx; r.y = o[1] + dy; }
    }
    this.scene.invalidate('pos');
    this.touchGraph();
  }
  private touchGraph(): void {
    this.g.events.emit({ type: 'meta', dirty: new Set(), nodeId: undefined });
  }

  /* ---------------------------------------------------------------------------- pointer up */
  private onUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
    const d = this.drag;
    const pr = this.press;
    this.press = null;
    this.drag = null;
    this.marquee = null;
    this.cutLine = null;
    this.guides = [];
    this.canvas.style.cursor = this.space ? 'grab' : '';
    const cancelled = e.type === 'pointercancel';
    if (d) this.endDrag(d, e, cancelled);
    else if (pr && !cancelled) this.click(pr, e);
    this.hideTip();
    this.requestDraw();
  };

  private endDrag(d: Drag, e: PointerEvent, cancelled: boolean): void {
    const ed = this.ed;
    const g = this.g;
    switch (d.kind) {
      case 'move': {
        const { dx, dy } = d;
        // restore originals, then commit ONE command
        this.applyMove(d, 0, 0);
        const moved = !cancelled && (dx !== 0 || dy !== 0);
        const run = (): void => {
          if (!moved) return;
          if (d.set.nodes.size) ed.moveNodes(new Map([...d.set.nodes].map(([id, [x, y]]) => [id, [x + dx, y + dy] as [number, number]])));
          if (d.set.frames.size || d.set.notes.size || d.set.reroutes.size)
            ed.annotate('Move', (a) => {
              for (const f of a.frames) {
                const o = d.set.frames.get(f.id);
                if (o) { f.x = o[0] + dx; f.y = o[1] + dy; }
              }
              for (const n of a.notes) {
                const o = d.set.notes.get(n.id);
                if (o) { n.x = o[0] + dx; n.y = o[1] + dy; }
              }
              for (const r of a.reroutes) {
                const o = d.set.reroutes.get(r.id);
                if (o) { r.x = o[0] + dx; r.y = o[1] + dy; }
              }
            });
        };
        if (d.txn) {
          if (moved) {
            run();
            ed.stack.commit();
          } else ed.stack.abort();
        } else if (moved) ed.stack.transaction(d.set.nodes.size && !d.set.frames.size && !d.set.notes.size && !d.set.reroutes.size ? (d.set.nodes.size === 1 ? 'Move node' : 'Move nodes') : 'Move', run);
        this.scene.invalidate('struct');
        break;
      }
      case 'resizeNode': {
        const a = g.annotations;
        const before = this.snapshotUiW(d.id, d.startW);
        a.nodeUi[d.id] = before;
        if (!cancelled && d.w !== d.startW) this.ops.resizeNode(d.id, d.w);
        else this.cleanUi(d.id);
        this.scene.invalidate('struct');
        this.touchGraph();
        ed.stack.sealTop();
        break;
      }
      case 'resizeRect': {
        const a = g.annotations;
        const item = d.what === 'frame' ? a.frames.find((f) => f.id === d.id) : a.notes.find((f) => f.id === d.id);
        if (item) Object.assign(item, { w: d.r.w, h: d.r.h });
        if (!cancelled && (d.cur.w !== d.r.w || d.cur.h !== d.r.h)) {
          if (d.what === 'frame') this.ops.patchFrame(d.id, { w: d.cur.w, h: d.cur.h }, 'Resize frame');
          else this.ops.patchNote(d.id, { w: d.cur.w, h: d.cur.h }, 'Resize note');
        }
        this.scene.invalidate('struct');
        this.touchGraph();
        break;
      }
      case 'link':
        if (cancelled) this.scene.hideLinks = new Set();
        else this.finishLink(d, e);
        this.scene.hideLinks = new Set();
        break;
      case 'cut': {
        if (cancelled) break;
        const hits = new Set<string>();
        const segs = this.scene.visibleSegments(rectFromPoints(d.a, d.b));
        for (const s of segs) if (polylineIntersectsSegment(linkSamples(s.a, s.b, this.scene.linkStyle, 24), d.a, d.b)) s.links.forEach((l) => hits.add(l));
        if (hits.size) this.cutLinks([...hits]);
        break;
      }
      default:
        break;
    }
  }
  private snapshotUiW(id: string, w: number): NonNullable<ReturnType<() => import('../../engine/graph/annotations').NodeUi>> {
    const u = { ...(this.g.annotations.nodeUi[id] ?? {}) };
    u.w = w;
    return u;
  }
  private cleanUi(id: string): void {
    const u = this.g.annotations.nodeUi[id];
    if (u && u.w === NODE.defaultW) delete u.w;
    if (u && !Object.keys(u).length) delete this.g.annotations.nodeUi[id];
  }

  private click(pr: Press, e: PointerEvent): void {
    const hit = pr.hit;
    const additive = pr.shift || pr.ctrl;
    switch (hit.kind) {
      case 'node':
      case 'note':
      case 'frame':
      case 'reroute':
        if (pr.deferSelect && !additive) {
          const kind = hit.kind === 'node' ? 'nodes' : hit.kind === 'note' ? 'notes' : hit.kind === 'frame' ? 'frames' : 'reroutes';
          this.selectItem(kind, (hit as { id?: string; node?: string }).id ?? (hit as { node: string }).node, false, false);
        }
        if (hit.kind === 'frame' && hit.part === 'chevron') this.ops.toggleFrameCollapse(hit.id);
        break;
      case 'button':
        this.buttonClick(hit.node, hit.button);
        break;
      case 'none':
        if (!additive) this.setSelection(emptySel());
        break;
      default:
        break;
    }
    void e;
  }

  private buttonClick(id: string, b: NodeButton): void {
    const ui = this.g.annotations.nodeUi[id];
    switch (b) {
      case 'collapse':
        this.ops.setUi([id], { collapsed: !ui?.collapsed }, ui?.collapsed ? 'Expand node' : 'Collapse node');
        break;
      case 'bypass':
        this.ops.toggleBypass([id]);
        break;
      case 'lock':
        this.ops.setUi([id], { locked: !ui?.locked }, ui?.locked ? 'Unlock node' : 'Lock node');
        break;
      case 'view2d':
        this.viewNode(id, '2d');
        break;
      case 'view3d':
        this.viewNode(id, '3d');
        break;
      case 'edit': {
        const pid = this.profileParamOf(id);
        if (pid) this.host.editSpline?.(id, pid);
        break;
      }
    }
  }

  /** Id of the node's Profile spline param (Sweep): the header shows an "Edit profile" button for nodes that have one. */
  private profileParamOf(id: string): string | undefined {
    const n = this.g.nodes.get(id);
    if (!n) return undefined;
    return this.g.registry.expanded(n.type)?.params.find((d) => d.type === 'spline' && d.id.includes('profile'))?.id;
  }

  viewNode(id: string, kind: '2d' | '3d'): void {
    const n = this.g.nodes.get(id);
    if (!n) return;
    const ex = this.g.registry.expanded(n.type);
    const pinId = ex?.primaryTexture?.pinId ?? ex?.outputs[0]?.id;
    this.host.active?.pin({ nodeId: id, pinId });
    this.host.openViewport?.(kind);
    this.requestDraw();
  }

  private cutLinks(ids: string[]): void {
    const live = ids.filter((i) => this.g.links.has(i));
    if (!live.length) return;
    this.ed.stack.transaction(live.length === 1 ? 'Cut link' : `Cut ${live.length} links`, () => live.forEach((i) => this.ed.disconnect(i)));
    this.requestDraw();
  }

  cancelDrag(): void {
    const d = this.drag;
    this.drag = null;
    this.press = null;
    this.marquee = null;
    this.cutLine = null;
    this.guides = [];
    this.scene.hideLinks = new Set();
    if (d) this.endDrag(d, new PointerEvent('pointercancel'), true);
    this.requestDraw();
  }

  /* ============================================================================================ hover / tooltips */
  private setHover(hit: Hit): void {
    this.hoverHit = hit;
    const node = hit.kind === 'node' || hit.kind === 'button' || hit.kind === 'resize' ? (hit as { node: string }).node : hit.kind === 'pin' ? hit.pin.node : null;
    const link = hit.kind === 'link' ? hit.link : null;
    if (node !== this.hoverNode || link !== this.hoverLink) {
      this.hoverNode = node;
      this.hoverLink = link;
    }
  }
  private updateHover(): void {
    this.pendingHover = false;
    if (this.drag || this.pinch) return;
    const w = toWorld(this.view, this.mouse);
    const prev = this.hoverHit;
    const hit = this.hitTest(w);
    // keep node hovered while the pointer is over its header buttons region
    this.setHover(hit);
    const key = (x: Hit): string => JSON.stringify(x, (k, v) => (k === 'seg' || k === 'at' ? undefined : v));
    if (key(prev) !== key(hit)) {
      this.hideTip();
      this.canvas.style.cursor = this.space ? 'grab' : hit.kind === 'pin' || (hit.kind === 'reroute' && hit.out) ? 'crosshair' : hit.kind === 'resize' ? 'ew-resize' : hit.kind === 'button' ? 'pointer' : hit.kind === 'link' ? 'pointer' : hit.kind === 'frame' && hit.part === 'resize' ? 'nwse-resize' : hit.kind === 'note' && hit.resize ? 'nwse-resize' : '';
      this.armTip(hit);
      this.requestDraw();
    }
  }
  private armTip(hit: Hit): void {
    if (this.tipTimer) clearTimeout(this.tipTimer);
    const text = this.tipText(hit);
    if (!text) return;
    this.tipTimer = setTimeout(() => this.showTip(text, this.mouse, false), hit.kind === 'pin' ? 350 : 500);
  }
  private tipText(hit: Hit): string | null {
    const g = this.g;
    if (hit.kind === 'pin') {
      const p = this.scene.findPin(hit.pin.node, hit.pin.pin, hit.pin.side);
      if (!p) return null;
      const lines = [`${p.name}  ·  ${p.type.toUpperCase()}${p.optional ? '  (optional)' : ''}`];
      if (p.role === 'background') lines.push('Background: blended with the node result (Blending tab).');
      if (p.isMod) lines.push('Modulation input: multiplies the parameter per pixel.');
      if (p.tooltip && !p.isMod && p.role !== 'background') lines.push(p.tooltip);
      if (p.side === 'out' && ['gray', 'color', 'normal', 'uv', 'vector'].includes(p.type)) {
        const info = this.info(hit.pin.node);
        lines.push(`${info?.w ?? g.settings.width}×${info?.h ?? g.settings.height}  ·  ${fmtOf(p.type, g.settings.bitDepth)}${info ? '' : '  (nominal)'}`);
      }
      if (p.side === 'in') {
        const l = g.inputLink(hit.pin.node, hit.pin.pin);
        if (l) lines.push(`← ${g.nodes.get(l.from.node)?.name ?? '?'}.${l.from.pin}${p.type === 'color' && this.scene.pinTypeOf(l.from.node, l.from.pin, 'out') === 'gray' ? '  (gray → color)' : ''}`);
      } else lines.push(`${g.linksFrom(hit.pin.node, hit.pin.pin).length} link(s)`);
      return lines.join('\n');
    }
    if (hit.kind === 'button') {
      return { collapse: 'Collapse / expand node', bypass: 'Bypass (pass the input through)', view2d: 'View in 2D viewport', view3d: 'View in 3D viewport', lock: 'Lock node (no move / delete / resize)', edit: tt('spline.profileEditor') }[hit.button];
    }
    if (hit.kind === 'node' && hit.header) {
      const e = this.errors.get(hit.node);
      if (e && this.mouse.x > 0) {
        const n = g.nodes.get(hit.node)!;
        const l = this.scene.layoutOf(hit.node);
        const sx = toScreen(this.view, { x: n.x + l.w - 60, y: n.y }).x;
        if (this.mouse.x > sx - 20) return `⚠ ${e}`;
      }
    }
    if (hit.kind === 'node' && this.errors.has(hit.node) && !hit.header) return `⚠ ${this.errors.get(hit.node)}`;
    if (hit.kind === 'link') {
      const l = g.links.get(hit.link);
      if (!l) return null;
      return `${g.nodes.get(l.from.node)?.name}.${l.from.pin} → ${g.nodes.get(l.to.node)?.name}.${l.to.pin}\nDrag: add reroute · Alt+click: cut · Del: delete`;
    }
    if (hit.kind === 'resize') return 'Drag to resize node';
    return null;
  }
  private showTip(text: string, at: Pt, danger: boolean): void {
    this.tip.textContent = text;
    this.tip.classList.toggle('danger', danger);
    this.tip.classList.add('on');
    const x = Math.min(this.W - 240, at.x + 16),
      y = Math.min(this.H - 70, at.y + 18);
    this.tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
  }
  private hideTip(): void {
    if (this.tipTimer) clearTimeout(this.tipTimer);
    this.tipTimer = null;
    this.tip.classList.remove('on');
  }
  private info(id: string): NodeInfo | undefined {
    return this.schedInfo.get(id) ?? this.thumbs?.info.get(id);
  }

  /* ============================================================================================ rendering loop */
  requestDraw(): void {
    this.dirty = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
  }
  private frame = (t: number): void => {
    this.raf = 0;
    if (this.disposed) return;
    const dt = this.lastT ? (t - this.lastT) / 1000 : 0.016;
    this.lastT = t;
    this.time = t / 1000;
    if (!this.visible) return;
    let more = false;
    if (this.animator.step(dt, this.W, this.H)) {
      more = true;
      this.dirty = true;
    }
    if (this.drag && this.drag.kind !== 'pan') {
      const m = this.mouse,
        edge = 36;
      let px = 0,
        py = 0;
      if (m.x < edge) px = (edge - m.x) * 0.5;
      else if (m.x > this.W - edge) px = -(m.x - (this.W - edge)) * 0.5;
      if (m.y < edge) py = (edge - m.y) * 0.5;
      else if (m.y > this.H - edge) py = -(m.y - (this.H - edge)) * 0.5;
      if ((px || py) && this.drag.kind !== 'cut') {
        const v = this.view;
        this.animator.set({ zoom: v.zoom, x: v.x + px, y: v.y + py });
        this.dragMove({ altKey: false } as PointerEvent, m);
      }
      more = true;
    }
    if (this.pendingHover) this.updateHover();
    if (this.prefs.flow && (this.sel.nodes.size || this.sel.links.size)) {
      more = true;
      this.dirty = true;
    }
    if (this.thumbs && (this.thumbs.pending > 0 || this.thumbsBusy())) more = more || false;
    if (this.dirty) {
      this.dirty = false;
      this.render();
    }
    if (more) this.requestDraw();
  };
  private thumbsBusy(): boolean {
    return false;
  }

  private render(): void {
    const t0 = performance.now();
    const g = this.g;
    const st = this.host.active?.get() ?? null;
    const hov = this.hoverHit;
    const s: RenderState = {
      view: this.view,
      width: this.W,
      height: this.H,
      dpr: this.dpr,
      time: this.time,
      selNodes: this.sel.nodes,
      selFrames: this.sel.frames,
      selNotes: this.sel.notes,
      selReroutes: this.sel.reroutes,
      selLinks: this.sel.links,
      hoverNode: this.hoverNode,
      hoverPin: hov.kind === 'pin' ? { node: hov.pin.node, pin: hov.pin.pin, side: hov.pin.side } : null,
      hoverButton: hov.kind === 'button' ? { node: hov.node, button: hov.button } : null,
      hoverLink: this.hoverLink,
      hoverFrame: hov.kind === 'frame' ? hov.id : null,
      hoverResize: hov.kind === 'resize' ? hov.node : null,
      errors: this.errors,
      info: new Map([...(this.thumbs?.info ?? []), ...this.schedInfo]),
      active: st,
      thumbs: this.thumbs,
      linkDrag: this.drag?.kind === 'link' ? this.drag.v : null,
      marquee: this.marquee,
      cutLine: this.cutLine,
      guides: this.guides,
      flow: this.prefs.flow,
      matches: this.matches,
      editingNode: this.editingNode,
      linkStyle: this.prefs.linkStyle,
      nominal: { w: g.settings.width, h: g.settings.height, bits: g.settings.bitDepth },
      showGrid: this.prefs.grid,
    };
    const out = this.renderer.draw(s);
    if (this.thumbs) {
      const c = toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
      const wanted = out.thumbs
        .map((t) => t.nodeId)
        .sort((a, b) => {
          const ra = this.scene.rectOf(a),
            rb = this.scene.rectOf(b);
          return Math.hypot(ra.x - c.x, ra.y - c.y) - Math.hypot(rb.x - c.x, rb.y - c.y);
        });
      // nodes without a thumbnail yet are not in out.thumbs: ask for every visible texture node
      const ask = new Set(wanted);
      for (const id of out.visibleNodes) if (!ask.has(id) && this.view.zoom * 100 > 14) wanted.push(id);
      this.thumbs.setWanted(wanted);
      this.thumbs.draw(out.thumbs, Math.round(this.W * this.dpr), Math.round(this.H * this.dpr));
    }
    const now = performance.now();
    if (now - this.lastMinimap > 60) {
      this.lastMinimap = now;
      this.minimap.draw(this.view, this.W, this.H, this.sel.nodes);
    }
    this.updateStatus();
    const ms = performance.now() - t0;
    this.stats.frames++;
    this.stats.lastDrawMs = ms;
    this.stats.maxDrawMs = Math.max(this.stats.maxDrawMs, ms);
    this.capture?.push(ms);
  }

  private updateStatus(): void {
    const g = this.g;
    const n = g.nodes.size,
      l = g.links.size;
    const sel = selCount(this.sel);
    const pend = this.thumbs?.pending ?? 0;
    const txt = `${n} nodes · ${l} links${sel ? ` · ${sel} selected` : ''} · ${(this.view.zoom * 100).toFixed(0)}%${pend ? ` · ${pend} previews…` : ''}`;
    if (this.statusEl.textContent !== txt) this.statusEl.textContent = txt;
  }

  /* ============================================================================================ keyboard */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Space' && !e.repeat) {
      this.space = true;
      this.canvas.style.cursor = 'grab';
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      if (this.drag) {
        this.cancelDrag();
        e.preventDefault();
      } else if (this.findBox) this.closeFind();
      else if (this.hasSelection()) this.deselect();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (e.key.startsWith('Arrow') && !e.altKey) {
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key] as [number, number];
      e.preventDefault();
      if (mod) this.traverse(dir);
      else this.nudge(dir[0] * (e.shiftKey ? 10 : 1), dir[1] * (e.shiftKey ? 10 : 1));
      return;
    }
    if (e.key === 'F2') {
      const id = [...this.sel.nodes].pop();
      if (id) {
        e.preventDefault();
        this.renameNode(id);
      }
      return;
    }
    if (e.key === 'Enter' && this.sel.nodes.size === 1 && !mod) {
      e.preventDefault();
      this.viewNode([...this.sel.nodes][0], '2d');
    }
  };

  nudge(dx: number, dy: number): void {
    const ids = [...this.sel.nodes].filter((i) => !this.ops.isLocked(i));
    const a = this.g.annotations;
    const step = this.prefs.snap ? NODE.gridSize / (Math.abs(dx) + Math.abs(dy) > 5 ? 2 : 4) : 1;
    const mx = dx * (Math.abs(dx) > 5 ? step / 5 : step),
      my = dy * (Math.abs(dy) > 5 ? step / 5 : step);
    this.ed.stack.transaction('Nudge', () => {
      if (ids.length) this.ed.moveNodes(new Map(ids.map((id) => [id, [this.g.nodes.get(id)!.x + mx, this.g.nodes.get(id)!.y + my] as [number, number]])));
      if (this.sel.frames.size || this.sel.notes.size || this.sel.reroutes.size)
        this.ed.annotate('Nudge', (an) => {
          for (const f of an.frames) if (this.sel.frames.has(f.id)) { f.x += mx; f.y += my; }
          for (const n of an.notes) if (this.sel.notes.has(n.id)) { n.x += mx; n.y += my; }
          for (const r of an.reroutes) if (this.sel.reroutes.has(r.id)) { r.x += mx; r.y += my; }
        });
    });
    this.ed.stack.sealTop();
    void a;
  }

  /** Keyboard traversal: Ctrl+Arrow selects the nearest node in that direction. */
  traverse(dir: [number, number]): void {
    const g = this.g;
    const cur = [...this.sel.nodes].pop();
    const ids = [...g.nodes.keys()].filter((i) => !this.scene.hidden.has(i));
    if (!ids.length) return;
    if (!cur) {
      const c = toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
      const nearest = ids.sort((a, b) => dist2(this.scene.rectOf(a), c) - dist2(this.scene.rectOf(b), c))[0];
      this.selectNodes([nearest]);
      return;
    }
    const rc = this.scene.rectOf(cur);
    const c0 = { x: rc.x + rc.w / 2, y: rc.y + rc.h / 2 };
    let best: string | null = null;
    let bs = Infinity;
    for (const id of ids) {
      if (id === cur) continue;
      const r = this.scene.rectOf(id);
      const vx = r.x + r.w / 2 - c0.x,
        vy = r.y + r.h / 2 - c0.y;
      const along = vx * dir[0] + vy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(vx * dir[1] - vy * dir[0]);
      const sc = along + across * 2.2;
      if (sc < bs) { bs = sc; best = id; }
    }
    if (best) {
      this.selectNodes([best]);
      const r = this.scene.rectOf(best);
      const sp = toScreen(this.view, { x: r.x, y: r.y });
      if (sp.x < 40 || sp.y < 40 || sp.x + r.w * this.view.zoom > this.W - 40 || sp.y + r.h * this.view.zoom > this.H - 40) this.centreOn({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    }
  }

  /* ---------------------------------------------------------------------------- clipboard (system clipboard text) */
  private typing(): boolean {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
  }
  private onCopy = (e: ClipboardEvent): void => {
    if (!this.isActive() || this.typing() || !this.hasSelection()) return;
    const clip = this.ops.copy(this.sel);
    if (!clip) return;
    e.clipboardData?.setData('text/plain', JSON.stringify(clip));
    e.preventDefault();
    toast(tt('graphEditor.copiedNodeS', { length: clip.nodes.length }), { type: 'info', timeout: 1200 });
  };
  private onCut = (e: ClipboardEvent): void => {
    if (!this.isActive() || this.typing() || !this.hasSelection()) return;
    this.onCopy(e);
    this.deleteSelection(false);
  };
  private onPaste = (e: ClipboardEvent): void => {
    if (!this.isActive() || this.typing()) return;
    const text = e.clipboardData?.getData('text/plain');
    const clip = text ? parseClip(text) : null;
    if (!clip) return;
    e.preventDefault();
    const at = this.mouseIn ? toWorld(this.view, this.mouse) : toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
    const s = this.ops.paste(clip, at);
    this.setSelection(s);
    toast(tt('graphEditor.pastedNodeS', { length: clip.nodes.length }), { type: 'info', timeout: 1200 });
  };
  /** Copy the selection to the clipboard from a menu/command (async clipboard API). */
  async copySelection(): Promise<void> {
    const clip = this.ops.copy(this.sel);
    if (!clip) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(clip));
      toast(tt('graphEditor.copiedNodeS', { length: clip.nodes.length }), { type: 'info', timeout: 1200 });
    } catch {
      toast(tt('graphEditor.clipboardAccessWasDenied'), { type: 'warn' });
    }
  }
  async pasteFromClipboard(at?: Pt): Promise<void> {
    try {
      const clip = parseClip(await navigator.clipboard.readText());
      if (!clip) return toast(tt('graphEditor.clipboardDoesNotContain'), { type: 'warn', timeout: 1800 });
      this.setSelection(this.ops.paste(clip, at ?? toWorld(this.view, this.mouse)));
    } catch {
      toast(tt('graphEditor.clipboardAccessWasDenied2'), { type: 'warn' });
    }
  }

  /* ============================================================================================ editing commands */
  deleteSelection(heal: boolean): void {
    const n = this.ops.deleteSelection(this.sel, heal);
    if (n) this.setSelection(emptySel());
    else if (this.sel.nodes.size) toast(tt('graphEditor.lockedNodesCannotBe'), { type: 'warn', timeout: 1500 });
  }
  duplicateSelection(): void {
    const s = this.ops.duplicate(this.sel);
    if (s) this.setSelection(s);
  }
  toggleBypass(): void {
    this.ops.toggleBypass([...this.sel.nodes]);
  }
  toggleCollapse(): void {
    const ids = [...this.sel.nodes];
    if (!ids.length) return;
    const to = !ids.every((i) => this.g.annotations.nodeUi[i]?.collapsed);
    this.ops.setUi(ids, { collapsed: to }, to ? 'Collapse nodes' : 'Expand nodes');
  }
  toggleLock(): void {
    const ids = [...this.sel.nodes];
    if (!ids.length) return;
    const to = !ids.every((i) => this.g.annotations.nodeUi[i]?.locked);
    this.ops.setUi(ids, { locked: to }, to ? 'Lock nodes' : 'Unlock nodes');
  }
  tagColor(color: string | undefined): void {
    this.ops.setUi([...this.sel.nodes], { color }, 'Set node colour');
  }
  align(mode: AlignMode): void {
    this.ops.align([...this.sel.nodes], mode);
  }
  distribute(axis: 'x' | 'y'): void {
    this.ops.distribute([...this.sel.nodes], axis);
  }
  autoLayout(): void {
    const n = this.ops.autoLayout([...this.sel.nodes]);
    if (n) setTimeout(() => (this.sel.nodes.size > 1 ? this.fitSelection() : this.fitAll()), 30);
  }
  addFrameForSelection(): void {
    let id = this.ops.frameAround(this.sel);
    if (!id) {
      const c = toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
      id = this.ops.addFrame({ x: snapToGrid(c.x - 200, 20), y: snapToGrid(c.y - 120, 20), w: 400, h: 240 });
    }
    const s = emptySel();
    s.frames.add(id);
    this.setSelection(s);
    setTimeout(() => this.renameFrame(id!), 30);
  }
  addNoteAt(at?: Pt): void {
    const c = at ?? toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
    const id = this.ops.addNote({ x: snapToGrid(c.x, 20), y: snapToGrid(c.y, 20) });
    const s = emptySel();
    s.notes.add(id);
    this.setSelection(s);
    setTimeout(() => this.editNote(id), 30);
  }
  setLinkStyle(s: LinkStyle): void {
    this.setPref('linkStyle', s);
    this.scene.linkStyle = s;
  }
  setPref<K extends keyof GraphPrefs>(k: K, v: GraphPrefs[K]): void {
    this.prefs[k] = v;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
    if (k === 'minimap') this.minimap.visible = v as boolean;
    this.requestDraw();
  }
  jumpBookmark(i: number): void {
    const b = this.g.annotations.bookmarks[i];
    if (!b) return;
    const v: View = { zoom: clampZoom(b.zoom), x: this.W / 2 - b.x * b.zoom, y: this.H / 2 - b.y * b.zoom };
    this.animator.focusTo(v, this.W, this.H);
    this.requestDraw();
  }
  setBookmarkHere(i: number): void {
    const c = toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
    this.ops.setBookmark(i, Math.round(c.x), Math.round(c.y), this.view.zoom);
    toast(`Bookmark ${i + 1} saved`, { type: 'ok', timeout: 1200 });
  }

  /* ============================================================================================ text editing overlays */
  private overlayInput(rect: { x: number; y: number; w: number; h: number }, value: string, multiline: boolean, done: (v: string | null) => void): void {
    const el = multiline ? h('textarea', { class: 'k-ge-edit', spellcheck: 'false' }) : h('input', { class: 'k-ge-edit', type: 'text', spellcheck: 'false' });
    el.value = value;
    Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${Math.max(90, rect.w)}px`, height: `${rect.h}px` });
    this.root.append(el);
    let finished = false;
    const finish = (commit: boolean): void => {
      if (finished) return;
      finished = true;
      const v = el.value;
      el.remove();
      this.editingNode = null;
      this.focus();
      done(commit ? v : null);
      this.requestDraw();
    };
    el.addEventListener('keydown', (ev: Event) => {
      const e = ev as KeyboardEvent;
      e.stopPropagation();
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(true);
      }
    });
    el.addEventListener('blur', () => finish(true));
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    requestAnimationFrame(() => {
      el.focus();
      el.select();
    });
  }
  renameNode(id: string): void {
    const n = this.g.nodes.get(id);
    if (!n || this.ops.isLocked(id)) return;
    const z = this.view.zoom;
    const sp = toScreen(this.view, { x: n.x + 24, y: n.y + 2 });
    this.editingNode = id;
    this.overlayInput({ x: sp.x, y: sp.y, w: (this.scene.layoutOf(id).w - 70) * z, h: 22 * z }, n.name, false, (v) => v !== null && this.ops.rename(id, v));
    this.requestDraw();
  }
  renameFrame(id: string): void {
    const f = this.g.annotations.frames.find((x) => x.id === id);
    if (!f) return;
    const sp = toScreen(this.view, { x: f.x + 24, y: f.y + 3 });
    this.overlayInput({ x: sp.x, y: sp.y, w: (f.w - 40) * this.view.zoom, h: 22 * this.view.zoom }, f.title, false, (v) => v !== null && v.trim() && this.ops.patchFrame(id, { title: v.trim() }, 'Rename frame'));
  }
  editNote(id: string): void {
    const n = this.g.annotations.notes.find((x) => x.id === id);
    if (!n) return;
    const sp = toScreen(this.view, { x: n.x + 4, y: n.y + 6 });
    this.overlayInput({ x: sp.x, y: sp.y, w: (n.w - 8) * this.view.zoom, h: (n.h - 10) * this.view.zoom }, n.text, true, (v) => v !== null && this.ops.patchNote(id, { text: v }, 'Edit note'));
  }

  /* ============================================================================================ search popups */
  closePopup(): void {
    this.popup?.close();
    this.popup = null;
  }
  openSearch(screen: Pt, world: Pt, filter?: SearchFilter, from?: { ref: { node: string; pin: string }; side: 'out' | 'in'; type: import('../../engine/types').PinType }, via: string[] = []): void {
    this.closePopup();
    this.popup = openNodeSearch(this.root, {
      registry: this.host.registry,
      usage: this.usage,
      filter,
      x: screen.x + 8,
      y: screen.y + 8,
      extras: filter ? undefined : (q) => graphExtensions.searchExtras?.(q) ?? [],
      onExtra: (x) => x.pick(world),
      onPick: (def) => {
        const id = this.ops.addNode(def.id, world, from, usageContext(filter));
        if (id) {
          if (from && via.length && from.side === 'out') {
            const l = [...this.g.links.values()].find((x) => x.from.node === from.ref.node && x.from.pin === from.ref.pin && x.to.node === id);
            if (l) this.ops.setVia([l.id], via);
          }
          this.selectNodes([id]);
        }
      },
      onClose: () => {
        this.popup = null;
        this.focus();
      },
    });
  }
  openSearchAtCursor(): void {
    const w = toWorld(this.view, this.mouseIn ? this.mouse : { x: this.W / 2, y: this.H / 2 });
    this.openSearch(this.mouseIn ? this.mouse : { x: this.W / 2 - 150, y: 80 }, w);
  }

  /** Find in graph (Ctrl+F). */
  openFind(): void {
    if (this.findBox) {
      (this.findBox.querySelector('input') as HTMLInputElement).focus();
      return;
    }
    const input = h('input', { class: 'k-ge-search-input', type: 'text', placeholder: tt('graphEditor.findNodeByName'), spellcheck: 'false' });
    const list = h('div', { class: 'k-ge-find-list' });
    const box = h('div', { class: 'k-ge-find' }, icon('search', 13), input, list);
    this.root.append(box);
    this.findBox = box;
    let results: string[] = [];
    let hot = 0;
    const render = (): void => {
      const q = input.value.trim().toLowerCase();
      results = q
        ? [...this.g.nodes.values()].filter((n) => `${n.name} ${n.type} ${n.comment ?? ''} ${this.g.registry.get(n.type)?.title ?? ''}`.toLowerCase().includes(q)).map((n) => n.id)
        : [];
      this.matches = new Set(results);
      list.replaceChildren(
        ...results.slice(0, 8).map((id, i) => {
          const n = this.g.nodes.get(id)!;
          const def = this.g.registry.get(n.type);
          const row = h('div', { class: `k-ge-find-row${i === hot ? ' hot' : ''}` }, h('span', { style: { color: def ? CATEGORIES[def.category].color : '#888' } }, icon(def?.icon ?? 'cube', 13)), n.name, h('span', { class: 'k-dim' }, def?.title ?? n.type));
          row.addEventListener('mousedown', (e) => {
            e.preventDefault();
            go(id);
          });
          return row;
        }),
      );
      if (q && !results.length) list.append(h('div', { class: 'k-ge-search-empty' }, tt('graphEditor.noMatch')));
      this.requestDraw();
    };
    const go = (id: string): void => {
      this.selectNodes([id]);
      const r = this.scene.rectOf(id);
      this.focusRect({ x: r.x - 100, y: r.y - 60, w: r.w + 200, h: r.h + 120 });
    };
    input.addEventListener('input', () => {
      hot = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closeFind();
      else if (e.key === 'ArrowDown') { hot = Math.min(hot + 1, Math.min(7, results.length - 1)); render(); }
      else if (e.key === 'ArrowUp') { hot = Math.max(0, hot - 1); render(); }
      else if (e.key === 'Enter' && results[hot]) {
        e.preventDefault();
        go(results[hot]);
      }
    });
    requestAnimationFrame(() => input.focus());
  }
  closeFind(): void {
    this.findBox?.remove();
    this.findBox = null;
    this.matches = new Set();
    this.focus();
    this.requestDraw();
  }

  /* ============================================================================================ menus */
  private onContext = (e: MouseEvent): void => {
    e.preventDefault();
    const p = this.local(e);
    const w = toWorld(this.view, p);
    const hit = this.hitTest(w);
    this.focus();
    if (hit.kind === 'node' || hit.kind === 'button' || hit.kind === 'resize') {
      const id = (hit as { node: string }).node;
      if (!this.sel.nodes.has(id)) this.selectItem('nodes', id, false, false);
    } else if (hit.kind === 'note' && !this.sel.notes.has(hit.id)) this.selectItem('notes', hit.id, false, false);
    else if (hit.kind === 'frame' && !this.sel.frames.has(hit.id)) this.selectItem('frames', hit.id, false, false);
    else if (hit.kind === 'reroute' && !this.sel.reroutes.has(hit.id)) this.selectItem('reroutes', hit.id, false, false);
    else if (hit.kind === 'link') this.selectItem('links', hit.link, false, false);
    showMenu(() => this.menuFor(hit, p, w), e.clientX, e.clientY);
  };

  private addMenu(world: Pt): MenuItem[] {
    const reg = this.host.registry;
    const items: MenuItem[] = [{ label: tt('graphEditor.searchNodes'), icon: 'search', shortcut: 'Tab', action: () => this.openSearch(this.mouse, world) }, { separator: true }];
    for (const [cat, defs] of reg.byCategory()) {
      const info = CATEGORIES[cat];
      items.push({
        label: info.label,
        icon: `cat-${cat}`,
        submenu: defs.map((d) => ({
          label: d.title,
          icon: d.icon,
          action: () => {
            const id = this.ops.addNode(d.id, world, undefined, 'any');
            if (id) this.selectNodes([id]);
          },
        })),
      });
    }
    return items;
  }

  private menuFor(hit: Hit, p: Pt, w: Pt): MenuItem[] {
    const sep: MenuItem = { separator: true };
    const g = this.g;
    const nodeSel = [...this.sel.nodes];
    if (hit.kind === 'node' || hit.kind === 'button' || hit.kind === 'resize' || hit.kind === 'pin') {
      const id = hit.kind === 'pin' ? hit.pin.node : (hit as { node: string }).node;
      const ui = g.annotations.nodeUi[id];
      const n = g.nodes.get(id);
      const multi = nodeSel.length > 1;
      return [
        ...(graphExtensions.nodeMenu?.(g, nodeSel) ?? []),
        { label: tt('graphEditor.viewIn2d'), icon: 'panel-2d', shortcut: 'Enter', action: () => this.viewNode(id, '2d') },
        { label: tt('graphEditor.viewIn3d'), icon: 'panel-3d', action: () => this.viewNode(id, '3d') },
        sep,
        { label: 'Rename', icon: 'rename', shortcut: 'F2', disabled: !!ui?.locked, action: () => this.renameNode(id) },
        { label: n?.bypass ? 'Remove bypass' : 'Bypass', icon: 'bypass', shortcut: 'B', action: () => this.toggleBypass() },
        { label: ui?.collapsed ? 'Expand' : 'Collapse', icon: 'chevron-down', shortcut: 'C', action: () => this.toggleCollapse() },
        { label: ui?.locked ? 'Unlock' : 'Lock', icon: ui?.locked ? 'unlock' : 'lock', shortcut: 'L', action: () => this.toggleLock() },
        { label: ui?.showMods ? 'Hide unused modulation pins' : 'Show modulation pins', icon: 'eye', action: () => this.ops.setUi(nodeSel, { showMods: !ui?.showMods }, 'Toggle modulation pins') },
        { label: tt('graphEditor.colourTag'), icon: 'tag', submenu: [...TAG_COLORS.map((c) => ({ label: colorName(c), icon: 'pin-gray', action: () => this.tagColor(c) })), { label: 'None', action: () => this.tagColor(undefined) }] },
        sep,
        { label: tt('graphEditor.selectUpstream'), shortcut: 'Alt+[', action: () => this.selectStream('up') },
        { label: tt('graphEditor.selectDownstream'), shortcut: 'Alt+]', action: () => this.selectStream('down') },
        sep,
        { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', action: () => void this.copySelection() },
        { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', action: () => this.duplicateSelection() },
        { label: tt('graphEditor.wrapInCommentFrame'), icon: 'tile', shortcut: 'Ctrl+Shift+G', action: () => this.addFrameForSelection() },
        { label: 'Arrange', icon: 'layout', disabled: !multi, submenu: this.arrangeMenu() },
        sep,
        { label: 'Delete', icon: 'delete', shortcut: 'Del', danger: true, action: () => this.deleteSelection(false) },
        { label: tt('graphEditor.deleteAndReconnect'), icon: 'delete', shortcut: 'Ctrl+Del', danger: true, action: () => this.deleteSelection(true) },
      ];
    }
    if (hit.kind === 'link') {
      const l = g.links.get(hit.link);
      return [
        { label: tt('graphEditor.addRerouteHere'), icon: 'plus', action: () => this.ops.insertReroute(hit.seg.links, hit.index, hit.at) },
        { label: tt('graphEditor.insertNode'), icon: 'search', disabled: !l, action: () => l && this.insertNodeOnLink(l, hit.at, p) },
        sep,
        { label: tt('graphEditor.cutLink'), icon: 'unlink', shortcut: 'Alt+Click', danger: true, action: () => this.cutLinks(hit.seg.links) },
      ];
    }
    if (hit.kind === 'reroute') return [{ label: tt('graphEditor.removeReroute'), icon: 'delete', action: () => this.ops.removeReroutes(new Set(this.sel.reroutes.size ? this.sel.reroutes : [hit.id])) }];
    if (hit.kind === 'frame') {
      const f = g.annotations.frames.find((x) => x.id === hit.id)!;
      return [
        { label: 'Rename', icon: 'rename', action: () => this.renameFrame(f.id) },
        { label: f.collapsed ? 'Expand' : 'Collapse', icon: 'chevron-down', action: () => this.ops.toggleFrameCollapse(f.id) },
        { label: tt('graphEditor.fitToContents'), icon: 'fit', disabled: !!f.collapsed, action: () => this.ops.fitFrameToContents(f.id) },
        { label: 'Colour', icon: 'tag', submenu: FRAME_COLORS.map((c) => ({ label: colorName(c), icon: 'pin-gray', checked: f.color === c, action: () => this.ops.patchFrame(f.id, { color: c }, 'Frame colour') })) },
        { label: tt('graphEditor.selectContents'), action: () => this.selectNodes(this.scene.membersOf(f).nodes) },
        sep,
        { label: tt('graphEditor.deleteFrame'), icon: 'delete', danger: true, action: () => this.ops.deleteSelection({ ...emptySel(), frames: new Set([f.id]) }, false) },
      ];
    }
    if (hit.kind === 'note') {
      const n = g.annotations.notes.find((x) => x.id === hit.id)!;
      return [
        { label: tt('graphEditor.editText'), icon: 'rename', action: () => this.editNote(n.id) },
        { label: 'Colour', icon: 'tag', submenu: NOTE_COLORS.map((c) => ({ label: colorName(c), icon: 'pin-gray', checked: n.color === c, action: () => this.ops.patchNote(n.id, { color: c }, 'Note colour') })) },
        sep,
        { label: tt('graphEditor.deleteNote'), icon: 'delete', danger: true, action: () => this.ops.deleteSelection({ ...emptySel(), notes: new Set([n.id]) }, false) },
      ];
    }
    return [
      { label: tt('graphEditor.addNode'), icon: 'plus', submenu: () => this.addMenu(w) },
      ...(graphExtensions.backgroundMenu?.(w) ?? []),
      { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', action: () => void this.pasteFromClipboard(w) },
      sep,
      { label: tt('graphEditor.addCommentFrame'), icon: 'tile', shortcut: 'Ctrl+Shift+G', action: () => this.addFrameForSelection() },
      { label: tt('graphEditor.addStickyNote'), icon: 'file', shortcut: 'Shift+N', action: () => this.addNoteAt(w) },
      sep,
      { label: tt('common.frameAll'), icon: 'fit', shortcut: 'A', action: () => this.fitAll() },
      { label: tt('graphEditor.autoLayout'), icon: 'layout', shortcut: 'Shift+L', action: () => this.autoLayout() },
      { label: tt('graphEditor.selectAll'), shortcut: 'Ctrl+A', action: () => this.selectAll() },
    ];
  }
  private insertNodeOnLink(l: LinkData, at: Pt, screen: Pt): void {
    this.closePopup();
    const type = this.scene.pinTypeOf(l.from.node, l.from.pin, 'out');
    this.popup = openNodeSearch(this.root, {
      registry: this.host.registry,
      usage: this.usage,
      filter: { dragSide: 'out', type },
      x: screen.x + 8,
      y: screen.y + 8,
      onPick: (def) => {
        const ex = this.g.registry.expanded(def.id);
        const inPin = ex ? pickPin(ex, 'in', type) : undefined;
        const outPin = ex ? pickPin(ex, 'out', this.scene.pinTypeOf(l.to.node, l.to.pin, 'in')) : undefined;
        this.ed.stack.transaction(`Insert ${def.title}`, () => {
          const id = this.ed.addNode(def.id, { x: snapToGrid(at.x, 20), y: snapToGrid(at.y - 40, 20) });
          if (inPin && outPin) {
            this.ed.disconnect(l.id);
            this.ops.safeConnect(l.from, { node: id, pin: inPin.id });
            this.ops.safeConnect({ node: id, pin: outPin.id }, l.to);
          }
          this.usage.record(def.id, 'any');
          this.selectNodes([id]);
        });
      },
      onClose: () => (this.popup = null),
    });
  }
  private arrangeMenu(): MenuItem[] {
    const a = (label: string, m: AlignMode): MenuItem => ({ label, action: () => this.align(m) });
    return [a('Align left', 'left'), a('Align right', 'right'), a('Align top', 'top'), a('Align bottom', 'bottom'), a('Align centres horizontally', 'hcenter'), a('Align centres vertically', 'vcenter'), { separator: true }, { label: tt('graphEditor.distributeHorizontally'), action: () => this.distribute('x') }, { label: tt('graphEditor.distributeVertically'), action: () => this.distribute('y') }, { separator: true }, { label: tt('graphEditor.autoLayoutSelection'), shortcut: 'Shift+L', action: () => this.autoLayout() }];
  }

  /* ============================================================================================ toolbar */
  private buildToolbar(): HTMLElement {
    this.crumbs = h('div', { class: 'k-ge-crumbs' });
    const menuBtn = (name: string, tip: string, items: () => MenuItem[]): HTMLButtonElement => {
      const b = iconButton(name, tip, () => {
        const r = b.getBoundingClientRect();
        showMenu(items, r.left, r.bottom + 2);
      });
      return b;
    };
    const tog = (label: string, key: 'flow' | 'snap' | 'grid' | 'minimap'): MenuItem => ({ label, checked: this.prefs[key], action: () => this.setPref(key, !this.prefs[key]) });
    const bar = h(
      'div',
      { class: 'k-ge-bar' },
      this.crumbs,
      h('span', { class: 'k-sp' }),
      iconButton('fit', tt('graphEditor.frameAllA'), () => this.fitAll()),
      iconButton('zoom-in', tt('graphEditor.frameSelectedF'), () => this.fitSelection()),
      iconButton('search', tt('graphEditor.findInGraphCtrlF'), () => this.openFind()),
      iconButton('plus', tt('graphEditor.addNodeTab'), () => this.openSearchAtCursor()),
      iconButton('layout', tt('graphEditor.autoLayoutShiftL'), () => this.autoLayout()),
      menuBtn('list', 'Align / distribute', () => this.arrangeMenu()),
      menuBtn('key', 'Bookmarks (Shift+1…9 jump · Ctrl+Shift+1…9 set)', () => {
        const bm = this.g.annotations.bookmarks;
        return [
          ...bm.map((b, i) => ({ label: `${i + 1}. ${b.name}`, icon: 'key', shortcut: i < 9 ? `Shift+${i + 1}` : '', action: () => this.jumpBookmark(i) })),
          ...(bm.length ? [{ separator: true } as MenuItem] : []),
          {
            label: tt('graphEditor.addBookmarkHere'),
            icon: 'plus',
            action: () => {
              void promptDialog(tt('graphEditor.newBookmark'), 'Name', `Bookmark ${bm.length + 1}`).then((name) => {
                if (!name) return;
                const c = toWorld(this.view, { x: this.W / 2, y: this.H / 2 });
                this.ops.addBookmark(name, Math.round(c.x), Math.round(c.y), this.view.zoom);
              });
            },
          },
          ...(bm.length ? [{ label: tt('graphEditor.removeBookmark'), icon: 'delete', submenu: bm.map((b) => ({ label: b.name, action: () => this.ops.removeBookmark(b.id) })) } as MenuItem] : []),
        ];
      }),
      menuBtn('settings', 'Graph display options', () => [
        { header: 'Links' },
        ...(['bezier', 'orthogonal', 'straight'] as LinkStyle[]).map((s): MenuItem => ({ label: s[0].toUpperCase() + s.slice(1), checked: this.prefs.linkStyle === s, action: () => this.setLinkStyle(s) })),
        { separator: true },
        tog('Animate data flow', 'flow'),
        tog('Snap to grid', 'snap'),
        tog('Show grid', 'grid'),
        tog('Show minimap', 'minimap'),
        { separator: true },
        { header: tt('graphEditor.navigationZoomPan') },
        ...(['auto', 'mouse', 'trackpad'] as const).map((m): MenuItem => ({ label: m === 'auto' ? 'Auto-detect wheel / touchpad' : m === 'mouse' ? 'Mouse: wheel zooms' : 'Touchpad: two-finger pans, pinch zooms', checked: this.prefs.nav === m, action: () => this.setPref('nav', m) })),
      ]),
    );
    this.renderCrumbs();
    return bar;
  }
  private renderCrumbs(): void {
    if (!this.crumbs) return;
    const path = graphNavigation.path;
    const parts: Array<Node | string> = [];
    path.forEach((c, i) => {
      if (i) parts.push(h('span', { class: 'sep' }, icon('chevron-right', 10)));
      const last = i === path.length - 1;
      const b = h('button', { class: `k-ge-crumb${last ? ' cur' : ''}`, tip: last ? 'Current graph' : 'Go up to this level', disabled: last, onclick: () => graphNavigation.exit(i) }, i === 0 ? icon('panel-graph', 12) : null, c.name);
      parts.push(b);
    });
    this.crumbs.replaceChildren(...parts);
  }
}

const dist2 = (r: Rect, c: Pt): number => (r.x + r.w / 2 - c.x) ** 2 + (r.y + r.h / 2 - c.y) ** 2;
const COLOR_NAMES: Record<string, string> = { '#e5534b': 'Red', '#e0a23c': 'Orange', '#e0c35a': 'Yellow', '#4cc38a': 'Green', '#35c2a1': 'Teal', '#5aa7e0': 'Blue', '#9a8dff': 'Violet', '#c586c0': 'Pink', '#8a94a6': 'Grey', '#7fd1a0': 'Mint', '#6fb1ff': 'Sky', '#f08fb0': 'Rose', '#c4a4ff': 'Lilac' };
const colorName = (c: string): string => COLOR_NAMES[c] ?? c;

// re-exports used by tests / other modules
export { buildClip, deepClone, visibleWorldRect, PIN_COLORS };
export type { Rect };
export { distToPolyline };

import type { GraphEditor } from '../../engine/commands/graph-commands';
import type { FrameData, GraphAnnotations, NodeUi } from '../../engine/graph/annotations';
import { canConnect } from '../../engine/graph/pins';
import type { LinkData } from '../../engine/graph/graph';
import type { PinRef, PinType } from '../../engine/types';
import { deepClone, uid } from '../../shared/util';
import { buildClip, clipIsEmpty, type GraphClip } from './core/clipboard';
import { computeNodeLayout, NODE, rectUnion, snapToGrid, type Pt, type Rect } from './core/geometry';
import { layeredLayout } from './core/layout';
import { FRAME_BAR_H, type GraphScene } from './core/scene';
import { alignRects, distributeRects, type AlignMode } from './core/snap';
import { pickPin } from './core/validity';
import type { UsageStats } from './core/usage';

import { t as tt } from '../../shared/i18n';
/** Selection of everything the editor can select (nodes also mirror into the app-wide SelectionService). */
export interface ItemSel {
  nodes: Set<string>;
  frames: Set<string>;
  notes: Set<string>;
  reroutes: Set<string>;
  links: Set<string>;
}
export const emptySel = (): ItemSel => ({ nodes: new Set(), frames: new Set(), notes: new Set(), reroutes: new Set(), links: new Set() });
export const selCount = (s: ItemSel): number => s.nodes.size + s.frames.size + s.notes.size + s.reroutes.size + s.links.size;

export const FRAME_COLORS = ['#5aa7e0', '#4cc38a', '#e0a23c', '#e5534b', '#c586c0', '#9a8dff', '#8a94a6'];
export const NOTE_COLORS = ['#e0c35a', '#7fd1a0', '#6fb1ff', '#f08fb0', '#c4a4ff'];
export const TAG_COLORS = ['#e5534b', '#e0a23c', '#e0c35a', '#4cc38a', '#35c2a1', '#5aa7e0', '#9a8dff', '#c586c0'];

/**
 * All graph-editing operations. Everything goes through GraphEditor (the command stack): one user gesture = one undo
 * step (transactions), drags coalesce through merge keys. No DOM here.
 */
export class GraphOps {
  constructor(
    private getEditor: () => GraphEditor,
    private scene: GraphScene,
    private usage: UsageStats | null,
  ) {}
  private get ed(): GraphEditor {
    return this.getEditor();
  }
  private get g() {
    return this.ed.graph;
  }
  isLocked(id: string): boolean {
    return !!this.g.annotations.nodeUi[id]?.locked;
  }

  /* ------------------------------------------------------------------ creation */
  /**
   * Add a node. With `from` the new node is auto-connected (and placed so the connecting pin lines up with the drop point).
   * `from.side` = side of the pin the user dragged from ('out' => the node's best input is connected).
   */
  addNode(type: string, at: Pt, from?: { ref: PinRef; side: 'out' | 'in'; type: PinType }, ctx = 'any'): string | null {
    const ex = this.g.registry.expanded(type);
    if (!ex) return null;
    let pin = undefined as ReturnType<typeof pickPin>;
    let x = at.x,
      y = at.y;
    if (from) {
      pin = pickPin(ex, from.side === 'out' ? 'in' : 'out', from.type);
      const lay = computeNodeLayout(ex, undefined, new Set(pin ? [pin.id] : []));
      const geo = [...lay.inputs, ...lay.outputs].find((p) => p.id === pin?.id && p.side === (from.side === 'out' ? 'in' : 'out'));
      if (geo) {
        x = from.side === 'out' ? at.x + 24 : at.x - lay.w - 24;
        y = at.y - geo.y;
      }
    }
    x = snapToGrid(x, NODE.gridSize);
    y = snapToGrid(y, NODE.gridSize);
    let id: string | null = null;
    this.ed.stack.transaction(`Add ${ex.def.title}`, () => {
      id = this.ed.addNode(type, { x, y });
      if (from && pin) {
        const a: PinRef = from.ref;
        const b: PinRef = { node: id, pin: pin.id };
        if (from.side === 'out') this.safeConnect(a, b);
        else this.safeConnect(b, a);
      }
    });
    this.usage?.record(type, ctx);
    return id;
  }

  /** Connect with engine validation; returns the new link or null (never throws into UI code). */
  safeConnect(from: PinRef, to: PinRef, via?: string[]): LinkData | null {
    if (this.g.checkConnection(from, to)) return null;
    this.ed.connect(from, to);
    const l = this.g.inputLink(to.node, to.pin) ?? null;
    if (l && via?.length) this.setVia([l.id], via);
    return l;
  }
  setVia(linkIds: string[], via: string[]): void {
    this.ed.annotate('Reroute', (a) => {
      for (const id of linkIds) {
        if (via.length) a.linkVia[id] = [...via];
        else delete a.linkVia[id];
      }
    });
  }

  /* ------------------------------------------------------------------ deletion */
  /** Delete the selection. `heal` reconnects each deleted node's upstream to its downstream (Ctrl+Delete). */
  deleteSelection(sel: ItemSel, heal: boolean): number {
    const ed = this.ed;
    const g = this.g;
    const nodes = [...sel.nodes].filter((id) => g.nodes.has(id) && !this.isLocked(id));
    const total = nodes.length + sel.frames.size + sel.notes.size + sel.reroutes.size + sel.links.size;
    if (!total) return 0;
    ed.stack.transaction(nodes.length === 1 && total === 1 ? `Delete ${g.nodes.get(nodes[0])?.name ?? 'node'}` : `Delete ${total} items`, () => {
      for (const lid of sel.links) if (g.links.has(lid)) ed.disconnect(lid);
      if (heal) for (const id of nodes) this.healAround(id);
      if (nodes.length) ed.removeNodes(nodes);
      if (sel.frames.size || sel.notes.size || sel.reroutes.size) {
        ed.annotate('Delete items', (a) => {
          a.frames = a.frames.filter((f) => !sel.frames.has(f.id));
          a.notes = a.notes.filter((n) => !sel.notes.has(n.id));
          if (sel.reroutes.size) this.dropReroutes(a, sel.reroutes);
        });
      }
    });
    return total;
  }
  private dropReroutes(a: GraphAnnotations, ids: ReadonlySet<string>): void {
    a.reroutes = a.reroutes.filter((r) => !ids.has(r.id));
    for (const [lid, via] of Object.entries(a.linkVia)) {
      const keep = via.filter((r) => !ids.has(r));
      if (keep.length) a.linkVia[lid] = keep;
      else delete a.linkVia[lid];
    }
  }
  removeReroutes(ids: Set<string>): void {
    this.ed.annotate('Remove reroute', (a) => this.dropReroutes(a, ids));
  }
  /** Bridge A -> N -> C into A -> C for every consumer of N, matching types. */
  private healAround(id: string): void {
    const g = this.g;
    const ins = g.linksTo(id);
    const outs = g.linksFrom(id);
    for (const o of outs) {
      const outType = this.scene.pinTypeOf(o.from.node, o.from.pin, 'out');
      const target = this.scene.pinTypeOf(o.to.node, o.to.pin, 'in');
      const cands = ins
        .map((i) => ({ i, t: this.scene.pinTypeOf(i.from.node, i.from.pin, 'out'), same: this.scene.pinTypeOf(i.to.node, i.to.pin, 'in') === outType }))
        .filter((c) => canConnect(c.t, target))
        .sort((a, b) => Number(b.same) - Number(a.same));
      if (cands.length) this.safeConnect(cands[0].i.from, o.to);
    }
  }

  /* ------------------------------------------------------------------ clipboard / duplicate */
  /** Selection expanded with what frames contain (copying a frame takes its nodes along). */
  private expand(sel: ItemSel): ItemSel {
    const out: ItemSel = { nodes: new Set(sel.nodes), frames: new Set(sel.frames), notes: new Set(sel.notes), reroutes: new Set(sel.reroutes), links: new Set() };
    for (const fid of sel.frames) {
      const f = this.g.annotations.frames.find((x) => x.id === fid);
      if (!f) continue;
      const m = this.scene.membersOf(f);
      m.nodes.forEach((n) => out.nodes.add(n));
      m.notes.forEach((n) => out.notes.add(n));
      m.frames.forEach((n) => out.frames.add(n));
    }
    return out;
  }
  copy(sel: ItemSel): GraphClip | null {
    const e = this.expand(sel);
    const clip = buildClip(this.g, { nodes: [...e.nodes], frames: [...e.frames], notes: [...e.notes], reroutes: [...e.reroutes] });
    return clipIsEmpty(clip) ? null : clip;
  }
  paste(clip: GraphClip, at: Pt, snap = true): ItemSel {
    const ed = this.ed;
    const g = this.g;
    const sel = emptySel();
    const dx = snap ? snapToGrid(at.x - clip.origin[0], NODE.gridSize) : at.x - clip.origin[0];
    const dy = snap ? snapToGrid(at.y - clip.origin[1], NODE.gridSize) : at.y - clip.origin[1];
    ed.stack.transaction('Paste', () => {
      const map = new Map<string, string>();
      for (const n of clip.nodes) {
        const ex = g.registry.expanded(n.type);
        if (!ex) continue; // unknown node type: cannot be created in this build
        const params: Record<string, never> = {};
        for (const p of ex.params) if (p.id in n.params) (params as Record<string, unknown>)[p.id] = n.params[p.id];
        try {
          const id = ed.addNode(n.type, { x: n.x + dx, y: n.y + dy, name: n.name, params });
          map.set(n.id, id);
          sel.nodes.add(id);
          if (n.bypass) ed.setNodeField(id, 'bypass', true);
        } catch {
          /* invalid node data: skip */
        }
      }
      const newVia: [string, string[]][] = [];
      for (const l of clip.links) {
        const a = map.get(l.from.node),
          b = map.get(l.to.node);
        if (!a || !b) continue;
        const nl = this.safeConnect({ node: a, pin: l.from.pin }, { node: b, pin: l.to.pin });
        if (nl && clip.linkVia[l.id]) newVia.push([nl.id, clip.linkVia[l.id]]);
      }
      const rmap = new Map<string, string>();
      ed.annotate('Paste', (a) => {
        for (const [oldId, ui] of Object.entries(clip.ui)) {
          const nid = map.get(oldId);
          if (nid) a.nodeUi[nid] = deepClone(ui);
        }
        for (const r of clip.reroutes) {
          const nid = uid('r');
          rmap.set(r.id, nid);
          a.reroutes.push({ id: nid, x: r.x + dx, y: r.y + dy });
          sel.reroutes.add(nid);
        }
        for (const f of clip.frames) {
          const nid = uid('f');
          a.frames.push({ ...deepClone(f), id: nid, x: f.x + dx, y: f.y + dy, members: f.members?.map((m) => map.get(m)).filter((m): m is string => !!m) });
          sel.frames.add(nid);
        }
        for (const n of clip.notes) {
          const nid = uid('s');
          a.notes.push({ ...deepClone(n), id: nid, x: n.x + dx, y: n.y + dy });
          sel.notes.add(nid);
        }
        for (const [lid, via] of newVia) {
          const v = via.map((r) => rmap.get(r)).filter((r): r is string => !!r);
          if (v.length) a.linkVia[lid] = v;
        }
      });
    });
    return sel;
  }
  duplicate(sel: ItemSel): ItemSel | null {
    const clip = this.copy(sel);
    if (!clip) return null;
    return this.paste(clip, { x: clip.origin[0] + 40, y: clip.origin[1] + 40 }, false);
  }

  /* ------------------------------------------------------------------ node state */
  setUi(ids: string[], patch: Partial<NodeUi>, label: string): void {
    if (!ids.length) return;
    this.ed.annotate(label, (a) => {
      for (const id of ids) {
        const u = { ...(a.nodeUi[id] ?? {}), ...patch };
        for (const k of Object.keys(u) as (keyof NodeUi)[]) if (u[k] === undefined || u[k] === false) delete u[k];
        if (Object.keys(u).length) a.nodeUi[id] = u;
        else delete a.nodeUi[id];
      }
    });
  }
  resizeNode(id: string, w: number): void {
    this.ed.annotate('Resize node', (a) => {
      a.nodeUi[id] = { ...(a.nodeUi[id] ?? {}), w: Math.round(w) };
    }, `resize:${id}`);
  }
  toggleBypass(ids: string[]): void {
    const g = this.g;
    const live = ids.filter((i) => g.nodes.has(i));
    if (!live.length) return;
    const to = !live.every((i) => g.nodes.get(i)!.bypass);
    this.ed.stack.transaction('Toggle bypass', () => live.forEach((i) => this.ed.setNodeField(i, 'bypass', to)));
  }
  rename(id: string, name: string): void {
    const n = this.g.nodes.get(id);
    if (!n || n.name === name || !name.trim()) return;
    this.ed.setNodeField(id, 'name', name.trim());
  }

  /* ------------------------------------------------------------------ frames & notes */
  addFrame(rect: Rect, title = 'Comment', color = FRAME_COLORS[0]): string {
    const id = uid('f');
    this.ed.annotate('Add comment frame', (a) => {
      a.frames.push({ id, x: rect.x, y: rect.y, w: rect.w, h: rect.h, title, color });
    });
    return id;
  }
  /** Ctrl+G: wrap the selected nodes (and notes) in a new comment frame. */
  frameAround(sel: ItemSel): string | null {
    const rects: Rect[] = [...sel.nodes].filter((id) => this.g.nodes.has(id)).map((id) => this.scene.rectOf(id));
    for (const n of this.g.annotations.notes) if (sel.notes.has(n.id)) rects.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    const u = rectUnion(rects);
    if (!u) return null;
    const pad = 28;
    return this.addFrame({ x: u.x - pad, y: u.y - pad - FRAME_BAR_H, w: u.w + 2 * pad, h: u.h + 2 * pad + FRAME_BAR_H }, 'Comment');
  }
  addNote(at: Pt, text = ''): string {
    const id = uid('s');
    this.ed.annotate('Add sticky note', (a) => {
      a.notes.push({ id, x: at.x, y: at.y, w: 220, h: 130, text, color: NOTE_COLORS[0] });
    });
    return id;
  }
  patchFrame(id: string, patch: Partial<FrameData>, label = tt('ops.editFrame'), mergeKey?: string): void {
    this.ed.annotate(label, (a) => {
      const f = a.frames.find((x) => x.id === id);
      if (f) Object.assign(f, patch);
    }, mergeKey);
  }
  patchNote(id: string, patch: { text?: string; color?: string; w?: number; h?: number }, label = tt('ops.editNote'), mergeKey?: string): void {
    this.ed.annotate(label, (a) => {
      const n = a.notes.find((x) => x.id === id);
      if (n) Object.assign(n, patch);
    }, mergeKey);
  }
  toggleFrameCollapse(id: string): void {
    const f = this.g.annotations.frames.find((x) => x.id === id);
    if (!f) return;
    if (f.collapsed) this.patchFrame(id, { collapsed: undefined, members: undefined, h: f.fullH ?? f.h, fullH: undefined }, 'Expand frame');
    else this.patchFrame(id, { collapsed: true, members: this.scene.membersOf(f).nodes, fullH: f.h }, 'Collapse frame');
  }
  fitFrameToContents(id: string): void {
    const f = this.g.annotations.frames.find((x) => x.id === id);
    if (!f) return;
    const m = this.scene.membersOf(f);
    const rects: Rect[] = m.nodes.map((n) => this.scene.rectOf(n));
    for (const n of this.g.annotations.notes) if (m.notes.includes(n.id)) rects.push({ x: n.x, y: n.y, w: n.w, h: n.h });
    const u = rectUnion(rects);
    if (!u) return;
    const pad = 28;
    this.patchFrame(id, { x: u.x - pad, y: u.y - pad - FRAME_BAR_H, w: u.w + 2 * pad, h: u.h + 2 * pad + FRAME_BAR_H }, 'Fit frame');
  }

  /* ------------------------------------------------------------------ reroutes */
  /**
   * Insert a new reroute at `p` into the given links at chain position `index` (index = segment index of the link).
   * Links sharing the segment (a bundle) all get the same reroute.
   */
  insertReroute(linkIds: string[], index: number, p: Pt): string {
    const id = uid('r');
    this.ed.annotate('Add reroute', (a) => {
      a.reroutes.push({ id, x: Math.round(p.x), y: Math.round(p.y) });
      for (const lid of linkIds) {
        const via = [...(a.linkVia[lid] ?? [])];
        via.splice(Math.min(index, via.length), 0, id);
        a.linkVia[lid] = via;
      }
    });
    return id;
  }

  /* ------------------------------------------------------------------ arrange */
  align(ids: string[], mode: AlignMode): void {
    const items = ids.filter((i) => this.g.nodes.has(i) && !this.isLocked(i)).map((id) => ({ id, r: this.scene.rectOf(id) }));
    const m = alignRects(items, mode);
    if (m.size) this.ed.moveNodes(m);
    this.ed.stack.sealTop();
  }
  distribute(ids: string[], axis: 'x' | 'y'): void {
    const items = ids.filter((i) => this.g.nodes.has(i) && !this.isLocked(i)).map((id) => ({ id, r: this.scene.rectOf(id) }));
    const m = distributeRects(items, axis);
    if (m.size) this.ed.moveNodes(m);
    this.ed.stack.sealTop();
  }
  autoLayout(ids: string[]): number {
    const g = this.g;
    const set = new Set((ids.length >= 2 ? ids : [...g.nodes.keys()]).filter((i) => g.nodes.has(i) && !this.isLocked(i)));
    const nodes = [...set].map((id) => {
      const r = this.scene.rectOf(id);
      return { id, x: r.x, y: r.y, w: r.w, h: r.h };
    });
    const m = layeredLayout(nodes, [...g.links.values()].map((l) => ({ from: l.from.node, to: l.to.node })));
    if (m.size) this.ed.moveNodes(m);
    this.ed.stack.sealTop();
    return m.size;
  }

  /* ------------------------------------------------------------------ bookmarks */
  addBookmark(name: string, x: number, y: number, zoom: number): void {
    this.ed.annotate('Add bookmark', (a) => {
      a.bookmarks.push({ id: uid('b'), name, x, y, zoom });
    });
  }
  setBookmark(index: number, x: number, y: number, zoom: number): void {
    this.ed.annotate('Set bookmark', (a) => {
      const b = a.bookmarks[index];
      if (b) Object.assign(b, { x, y, zoom });
      else a.bookmarks.push({ id: uid('b'), name: `Bookmark ${a.bookmarks.length + 1}`, x, y, zoom });
    });
  }
  removeBookmark(id: string): void {
    this.ed.annotate('Remove bookmark', (a) => {
      a.bookmarks = a.bookmarks.filter((b) => b.id !== id);
    });
  }
}

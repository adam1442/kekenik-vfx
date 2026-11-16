import { Emitter } from '../../shared/emitter';
import { clamp, deepClone, uid } from '../../shared/util';
import { coerceParam, defaultValues, type ParamValue, type ParamValues } from '../params/schema';
import type { FilterMode, PinRef, TilingMode } from '../types';
import type { ExpandedNode } from './expand';
import { emptyAnnotations, isEmptyAnnotations, pruneAnnotations, sanitizeAnnotations, type GraphAnnotations } from './annotations';
import { canConnect } from './pins';
import type { NodeRegistry } from './registry';

/* Serializable graph model. A node may own a `subgraph` (GraphData): subgraph-ready by design (makes the
 * evaluator recurse into it; the model, validation and serialization already support it). */

export interface GraphSettings {
  width: number;
  height: number;
  tiling: TilingMode;
  filtering: FilterMode;
  /** 16 = half-float intermediates, 32 = HQ float. */
  bitDepth: 16 | 32;
  fps: number;
  /** Loop length in frames. */
  loopLength: number;
  seed: number;
}

export const defaultGraphSettings = (): GraphSettings => ({
  width: 1024,
  height: 1024,
  tiling: 'both',
  filtering: 'linear',
  bitDepth: 16,
  fps: 30,
  loopLength: 64,
  seed: 0,
});

import { defaultTimeline, sanitizeTimeline, type TimelineSettings } from '../anim/timebase';
import { sanitizeNodeAnim, type AnimTrack, type NodeAnim } from '../anim/tracks';

export interface NodeData {
  /** keyframe tracks per param id (see anim/tracks.ts). Optional and backward compatible. */
  anim?: NodeAnim;
  id: string;
  /** NodeDefinition id. */
  type: string;
  /** Definition version this data was saved with (for migrateParams). */
  typeVersion: number;
  /** User-visible name (defaults to the definition title). */
  name: string;
  x: number;
  y: number;
  params: ParamValues;
  /** Bypass: pass the first compatible input through unchanged. */
  bypass?: boolean;
  comment?: string;
  subgraph?: GraphData;
}

export interface LinkData {
  id: string;
  from: PinRef;
  to: PinRef;
}

export interface GraphData {
  settings: GraphSettings;
  nodes: NodeData[];
  links: LinkData[];
  /** timeline settings (range, work area, loop mode, markers). Optional. */
  timeline?: TimelineSettings;
  /** Editor-only organisation data (frames, notes, reroutes, node UI state, bookmarks). Optional: added by . */
  annotations?: GraphAnnotations;
}

export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}

export type GraphEventType = 'structure' | 'param' | 'settings' | 'meta' | 'reset';
export interface GraphEvent {
  type: GraphEventType;
  /** Nodes whose OUTPUT may have changed (changed nodes + everything downstream). Empty for 'meta'. */
  dirty: ReadonlySet<string>;
  nodeId?: string;
}

export function clampSettings(s: Partial<GraphSettings>): GraphSettings {
  const d = defaultGraphSettings();
  const m = { ...d, ...s };
  return {
    width: clamp(Math.round(m.width) || d.width, 1, 16384),
    height: clamp(Math.round(m.height) || d.height, 1, 16384),
    tiling: (['none', 'both', 'x', 'y'] as const).includes(m.tiling) ? m.tiling : d.tiling,
    filtering: (['point', 'linear', 'cubic'] as const).includes(m.filtering) ? m.filtering : d.filtering,
    bitDepth: m.bitDepth === 32 ? 32 : 16,
    fps: clamp(Math.round(m.fps) || d.fps, 1, 240),
    loopLength: clamp(Math.round(m.loopLength) || d.loopLength, 1, 100000),
    seed: Math.round(m.seed) >>> 0,
  };
}

export class Graph {
  /** Unique per Graph instance; part of cache keys so two graphs never share cached outputs. */
  readonly id = uid('graph');
  settings: GraphSettings;
  readonly nodes = new Map<string, NodeData>();
  readonly links = new Map<string, LinkData>();
  /** Editor-only organisation data (see annotations.ts). Mutate via GraphEditor.annotate (undoable). */
  annotations: GraphAnnotations = emptyAnnotations();
  /** Increments on every change that can alter evaluation results (not on 'meta' like node moves). */
  revision = 0;
  readonly events = new Emitter<GraphEvent>();
  /** timeline settings (not part of any hash: they only steer playback / UI). */
  timeline: TimelineSettings = defaultTimeline();

  constructor(
    readonly registry: NodeRegistry,
    settings?: Partial<GraphSettings>,
  ) {
    this.settings = clampSettings(settings ?? {});
  }

  /* ---------- queries ---------- */

  expandedOf(nodeId: string): ExpandedNode | undefined {
    const n = this.nodes.get(nodeId);
    return n ? this.registry.expanded(n.type) : undefined;
  }
  inputLink(nodeId: string, pinId: string): LinkData | undefined {
    for (const l of this.links.values()) if (l.to.node === nodeId && l.to.pin === pinId) return l;
    return undefined;
  }
  linksFrom(nodeId: string, pinId?: string): LinkData[] {
    return [...this.links.values()].filter((l) => l.from.node === nodeId && (pinId === undefined || l.from.pin === pinId));
  }
  linksTo(nodeId: string): LinkData[] {
    return [...this.links.values()].filter((l) => l.to.node === nodeId);
  }
  connectedInputs(nodeId: string): Set<string> {
    return new Set(this.linksTo(nodeId).map((l) => l.to.pin));
  }

  /** `ids` plus everything reachable through outgoing links. */
  downstream(ids: Iterable<string>): Set<string> {
    const out = new Set<string>(ids);
    const stack = [...out];
    const adj = new Map<string, string[]>();
    for (const l of this.links.values()) {
      if (!adj.has(l.from.node)) adj.set(l.from.node, []);
      adj.get(l.from.node)!.push(l.to.node);
    }
    while (stack.length) {
      for (const n of adj.get(stack.pop()!) ?? []) if (!out.has(n)) {
          out.add(n);
          stack.push(n);
        }
    }
    return out;
  }
  upstream(ids: Iterable<string>): Set<string> {
    const out = new Set<string>(ids);
    const stack = [...out];
    const adj = new Map<string, string[]>();
    for (const l of this.links.values()) {
      if (!adj.has(l.to.node)) adj.set(l.to.node, []);
      adj.get(l.to.node)!.push(l.from.node);
    }
    while (stack.length) {
      for (const n of adj.get(stack.pop()!) ?? []) if (!out.has(n)) {
          out.add(n);
          stack.push(n);
        }
    }
    return out;
  }
  wouldCreateCycle(from: PinRef, to: PinRef): boolean {
    return from.node === to.node || this.downstream([to.node]).has(from.node);
  }

  /* ---------- mutation (low-level; Commands call these) ---------- */

  private emit(type: GraphEventType, changed: Iterable<string>, nodeId?: string): void {
    if (type !== 'meta') this.revision++;
    const dirty = type === 'meta' ? new Set<string>() : this.downstream(changed);
    this.events.emit({ type, dirty, nodeId });
  }

  addNode(type: string, opts: { id?: string; x?: number; y?: number; name?: string; params?: ParamValues } = {}): NodeData {
    const ex = this.registry.expanded(type);
    if (!ex) throw new GraphError(`Unknown node type "${type}"`);
    const id = opts.id ?? uid('n');
    if (this.nodes.has(id)) throw new GraphError(`Node id "${id}" already exists`);
    const params = defaultValues(ex.params);
    for (const [k, v] of Object.entries(opts.params ?? {})) {
      const def = ex.params.find((p) => p.id === k);
      if (!def) throw new GraphError(`Node "${type}" has no param "${k}"`);
      params[k] = coerceParam(def, v);
    }
    const node: NodeData = { id, type, typeVersion: ex.def.version, name: opts.name ?? ex.def.title, x: opts.x ?? 0, y: opts.y ?? 0, params };
    this.nodes.set(id, node);
    this.emit('structure', [id], id);
    return node;
  }

  /** Removes the node and its links; returns what is needed to restore it (undo). */
  removeNode(id: string): { node: NodeData; links: LinkData[] } {
    const node = this.nodes.get(id);
    if (!node) throw new GraphError(`No node "${id}"`);
    const links = [...this.links.values()].filter((l) => l.from.node === id || l.to.node === id);
    const affected = this.downstream(links.filter((l) => l.from.node === id).map((l) => l.to.node));
    for (const l of links) this.links.delete(l.id);
    this.nodes.delete(id);
    this.emit('structure', affected, id);
    return { node, links };
  }

  restoreNode(node: NodeData, links: LinkData[]): void {
    this.nodes.set(node.id, node);
    for (const l of links) this.links.set(l.id, l);
    this.emit('structure', [node.id], node.id);
  }

  setParam(nodeId: string, paramId: string, value: ParamValue): ParamValue {
    const node = this.nodes.get(nodeId);
    const ex = this.expandedOf(nodeId);
    if (!node || !ex) throw new GraphError(`No node "${nodeId}"`);
    const def = ex.params.find((p) => p.id === paramId);
    if (!def) throw new GraphError(`Node "${node.type}" has no param "${paramId}"`);
    const v = coerceParam(def, value);
    node.params[paramId] = v;
    this.emit('param', [nodeId], nodeId);
    return v;
  }

  setNodeField<K extends 'name' | 'bypass' | 'comment'>(nodeId: string, field: K, value: NodeData[K]): void {
    const n = this.nodes.get(nodeId);
    if (!n) throw new GraphError(`No node "${nodeId}"`);
    n[field] = value;
    this.emit(field === 'bypass' ? 'structure' : 'meta', [nodeId], nodeId);
  }
  moveNode(nodeId: string, x: number, y: number): void {
    const n = this.nodes.get(nodeId);
    if (!n) throw new GraphError(`No node "${nodeId}"`);
    n.x = x;
    n.y = y;
    this.emit('meta', [], nodeId);
  }

  /** Checks a prospective connection and returns an error message or null. */
  checkConnection(from: PinRef, to: PinRef): string | null {
    const fe = this.expandedOf(from.node);
    const te = this.expandedOf(to.node);
    if (!fe || !te) return 'Unknown node';
    const out = fe.outputs.find((p) => p.id === from.pin);
    const inp = te.inputs.find((p) => p.id === to.pin);
    if (!out) return `Node has no output "${from.pin}"`;
    if (!inp) return `Node has no input "${to.pin}"`;
    if (!canConnect(out.type, inp.type)) return `Cannot connect ${out.type} to ${inp.type} (only Gray -> Color is implicit)`;
    if (this.wouldCreateCycle(from, to)) return 'Connection would create a cycle';
    return null;
  }

  /** Connects; replaces an existing link on the same input pin and returns it (for undo). */
  connect(from: PinRef, to: PinRef, linkId?: string): { link: LinkData; replaced?: LinkData } {
    const err = this.checkConnection(from, to);
    if (err) throw new GraphError(err);
    const replaced = this.inputLink(to.node, to.pin);
    if (replaced) this.links.delete(replaced.id);
    const link: LinkData = { id: linkId ?? uid('l'), from: { ...from }, to: { ...to } };
    this.links.set(link.id, link);
    this.emit('structure', [to.node], to.node);
    return { link, replaced };
  }

  /** mark nodes (default: all) as changed without editing them, e.g. after a shared subgraph definition changed. */
  touch(ids?: Iterable<string>): void {
    this.emit('structure', ids ?? [...this.nodes.keys()]);
  }

  /** Re-insert a previously removed link verbatim (undo). */
  restoreLink(link: LinkData): void {
    this.links.set(link.id, link);
    this.emit('structure', [link.to.node], link.to.node);
  }

  disconnect(linkId: string): LinkData {
    const l = this.links.get(linkId);
    if (!l) throw new GraphError(`No link "${linkId}"`);
    this.links.delete(linkId);
    this.emit('structure', [l.to.node], l.to.node);
    return l;
  }

  /** Replace the annotations wholesale (undo/redo snapshots, load). Emits 'meta': never invalidates evaluation. */
  setAnnotations(a: GraphAnnotations): void {
    this.annotations = deepClone(a);
    this.emit('meta', [], undefined);
  }

  /** set / clear the keyframe track of one param (low level; AnimationEditor wraps it in commands). */
  setNodeTrack(nodeId: string, paramId: string, track: AnimTrack | undefined): void {
    const node = this.nodes.get(nodeId);
    if (!node) throw new GraphError(`No node "${nodeId}"`);
    if (track) node.anim = { ...(node.anim ?? {}), [paramId]: track };
    else if (node.anim) {
      const next = { ...node.anim };
      delete next[paramId];
      if (Object.keys(next).length) node.anim = next;
      else delete node.anim;
    }
    this.emit('param', [nodeId], nodeId);
  }

  /** replace the timeline settings ('meta' event: caches stay valid, UIs / autosave refresh). */
  setTimeline(tl: TimelineSettings): void {
    this.timeline = sanitizeTimeline(tl);
    this.emit('meta', [], undefined);
  }

  setSettings(patch: Partial<GraphSettings>): GraphSettings {
    const prev = this.settings;
    this.settings = clampSettings({ ...prev, ...patch });
    this.emit('settings', this.nodes.keys());
    return prev;
  }

  /* ---------- serialization ---------- */

  toData(): GraphData {
    const data: GraphData = deepClone({ settings: this.settings, nodes: [...this.nodes.values()], links: [...this.links.values()] });
    if (JSON.stringify(this.timeline) !== JSON.stringify(defaultTimeline())) data.timeline = deepClone(this.timeline);
    if (!isEmptyAnnotations(this.annotations)) {
      const pr = pruneAnnotations(this.annotations, new Set(this.nodes.keys()), new Set(this.links.keys()));
      if (!isEmptyAnnotations(pr)) data.annotations = pr;
    }
    return data;
  }

  /**
   * Rebuild a graph from data. Params are migrated (definition migrateParams) and coerced; unknown params dropped;
   * unknown node TYPES are kept (so no data is lost) and reported by `validateGraph`. Links to invalid pins are dropped
   * and reported in `warnings`.
   */
  static fromData(registry: NodeRegistry, data: GraphData): { graph: Graph; warnings: string[] } {
    const g = new Graph(registry, data.settings);
    const warnings: string[] = [];
    for (const raw of data.nodes) {
      const node = deepClone(raw);
      const ex = registry.expanded(node.type);
      if (ex) {
        let old: Record<string, unknown> = node.params;
        if (node.typeVersion < ex.def.version) {
          old = ex.def.migrateParams ? ex.def.migrateParams(old, node.typeVersion) : old;
          warnings.push(`Node "${node.name}" migrated ${node.type} v${node.typeVersion} -> v${ex.def.version}`);
        }
        const params = defaultValues(ex.params);
        for (const p of ex.params) if (p.id in old) params[p.id] = coerceParam(p, old[p.id]);
        for (const k of Object.keys(old)) if (!ex.params.some((p) => p.id === k)) warnings.push(`Node "${node.name}": dropped unknown param "${k}"`);
        node.params = params;
        node.typeVersion = ex.def.version;
        const sa = sanitizeNodeAnim(raw.anim, ex.params);
        if (sa.anim) node.anim = sa.anim;
        else delete node.anim;
        for (const w of sa.warnings) warnings.push(`Node "${node.name}": ${w}`);
      } else warnings.push(`Unknown node type "${node.type}" (node "${node.name}" kept but cannot evaluate)`);
      g.nodes.set(node.id, node);
    }
    for (const l of data.links) {
      const fromN = g.nodes.get(l.from.node);
      const toN = g.nodes.get(l.to.node);
      if (!fromN || !toN) {
        warnings.push(`Dropped link ${l.id}: missing node`);
        continue;
      }
      if (!registry.has(fromN.type) || !registry.has(toN.type)) {
        g.links.set(l.id, deepClone(l)); // keep for unknown types
        continue;
      }
      const err = g.checkConnection(l.from, l.to);
      if (err) warnings.push(`Dropped link ${l.id}: ${err}`);
      else g.links.set(l.id, deepClone(l));
    }
    if (data.annotations) g.annotations = sanitizeAnnotations(data.annotations);
    if (data.timeline) g.timeline = sanitizeTimeline(data.timeline);
    g.revision++;
    g.events.emit({ type: 'reset', dirty: new Set(g.nodes.keys()) });
    return { graph: g, warnings };
  }
}

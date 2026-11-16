import { deepClone } from '../../shared/util';
import type { GraphPreprocess, EvalTarget } from '../graph/evaluator';
import { Graph, type LinkData, type NodeData } from '../graph/graph';
import type { PinRef } from '../types';
import { SUBGRAPH_LIMITS, boundaryPins, instanceDefId, isBoundaryIn, isBoundaryOut, type SubgraphDefData } from './def';
import type { SubgraphLibrary } from './library';

/**
 * SUBGRAPH FLATTENING. Pure graph -> graph transform used by the Evaluator pre-pass:
 *   - every instance node is replaced by a clone of its definition's nodes (ids `<instance>~<inner>`, nested: `a~b~c`),
 *   - Input boundary nodes are elided: inner consumers link straight to whatever feeds the instance pin. An UNCONNECTED
 *     pin keeps the Input node (it evaluates its default constant),
 *   - Output boundary nodes are elided: consumers of an instance output link to the node that feeds the Output node,
 *   - exposed parameters (and their keyframes) of the instance are written onto the inner nodes,
 *   - ordinary nodes keep their ids, so the output cache and per-node hashes stay valid.
 * Hashes are content based (plan.ts), so the flattened graph of a collapsed subgraph hashes EXACTLY like the original
 * inline graph: caching is per instance and equivalence is unit-tested through `buildPlan`.
 * Recursion is cut (`stack` + `maxDepth`): the offending instance stays in the graph and reports a clear error.
 */

interface Scope {
  prefix: string;
  nodes: Map<string, NodeData>;
  links: readonly LinkData[];
  inLinks: Map<string, LinkData>;
  /** Instance scopes: boundary Input node id -> flat source (null = unconnected, keep the default node). */
  inputBind?: Map<string, PinRef | null>;
  instOut: Map<string, Map<string, PinRef | null>>;
  stack: string[];
  depth: number;
  root?: string;
  rootName?: string;
}

export interface FlattenResult extends GraphPreprocess {
  /** Number of instances expanded (diagnostics / tests). */
  expanded: number;
}

export function flattenData(src: { nodes: ReadonlyMap<string, NodeData>; links: Iterable<LinkData> }, lib: SubgraphLibrary): { nodes: Map<string, NodeData>; links: Map<string, LinkData>; rootMap: Map<string, string>; top: Scope; resolve: (s: Scope, nodeId: string, pin: string) => PinRef | null; expanded: number } {
  const outNodes = new Map<string, NodeData>();
  const outLinks = new Map<string, LinkData>();
  const rootMap = new Map<string, string>();
  let expanded = 0;

  const mkScope = (prefix: string, nodes: Map<string, NodeData>, links: readonly LinkData[], over: Partial<Scope>): Scope => {
    const inLinks = new Map<string, LinkData>();
    for (const l of links) inLinks.set(`${l.to.node}|${l.to.pin}`, l);
    return { prefix, nodes, links, inLinks, instOut: new Map(), stack: [], depth: 0, ...over };
  };

  const expandable = (s: Scope, n: NodeData): string | null => {
    const id = lib.isInstance(n.type);
    if (!id) return null;
    if (s.stack.includes(id) || s.depth >= SUBGRAPH_LIMITS.maxDepth) return null; // recursion: keep as an erroring node
    return id;
  };
  const elided = (s: Scope, n: NodeData): boolean => {
    if (!s.inputBind) return false;
    if (isBoundaryOut(n.type)) return true;
    return isBoundaryIn(n.type) && !!s.inputBind.get(n.id);
  };

  const resolve = (s: Scope, nodeId: string, pin: string): PinRef | null => {
    const n = s.nodes.get(nodeId);
    if (!n) return null;
    if (expandable(s, n)) return expandInstance(s, n).get(pin) ?? null;
    if (s.inputBind && isBoundaryIn(n.type)) {
      const b = s.inputBind.get(n.id);
      if (b) return b;
    }
    return { node: s.prefix + nodeId, pin };
  };

  const applyExposed = (clone: NodeData, def: SubgraphDefData, inst: NodeData): void => {
    for (const e of def.exposed) {
      if (e.node !== clone.id) continue;
      if (e.id in inst.params) clone.params[e.param] = deepClone(inst.params[e.id]);
      const tr = inst.anim?.[e.id];
      if (tr) clone.anim = { ...(clone.anim ?? {}), [e.param]: deepClone(tr) };
    }
  };

  function expandInstance(s: Scope, inst: NodeData): Map<string, PinRef | null> {
    const memo = s.instOut.get(inst.id);
    if (memo) return memo;
    const defId = lib.isInstance(inst.type)!;
    const def = lib.get(defId)!;
    const outs = new Map<string, PinRef | null>();
    s.instOut.set(inst.id, outs);
    expanded++;
    const innerNodes = new Map<string, NodeData>();
    for (const x of def.graph.nodes) {
      const c = deepClone(x);
      applyExposed(c, def, inst);
      innerNodes.set(c.id, c);
    }
    const inputBind = new Map<string, PinRef | null>();
    for (const b of boundaryPins(def.graph.nodes).inputs) {
      const l = s.inLinks.get(`${inst.id}|${b.id}`);
      inputBind.set(b.id, l ? resolve(s, l.from.node, l.from.pin) : null);
    }
    const inner = mkScope(`${s.prefix}${inst.id}~`, innerNodes, def.graph.links, {
      inputBind,
      stack: [...s.stack, defId],
      depth: s.depth + 1,
      root: s.root ?? inst.id,
      rootName: s.rootName ? `${s.rootName}/${inst.name}` : inst.name,
    });
    if (!s.rootName && !s.root) {
      inner.root = inst.id;
      inner.rootName = inst.name;
    }
    emit(inner);
    for (const o of boundaryPins(def.graph.nodes).outputs) {
      const l = inner.inLinks.get(`${o.id}|input`);
      outs.set(o.id, l ? resolve(inner, l.from.node, l.from.pin) : null);
    }
    return outs;
  }

  function emit(s: Scope): void {
    for (const n of s.nodes.values()) {
      if (expandable(s, n)) {
        expandInstance(s, n);
        continue;
      }
      if (elided(s, n)) continue;
      const flatId = s.prefix + n.id;
      const c = s.prefix ? deepClone(n) : n;
      if (s.prefix) {
        c.id = flatId;
        if (s.rootName) c.name = `${s.rootName}/${n.name}`;
      }
      outNodes.set(flatId, c);
      if (s.root) rootMap.set(flatId, s.root);
    }
    for (const l of s.links) {
      const to = s.nodes.get(l.to.node);
      if (!to || expandable(s, to) || elided(s, to)) continue;
      const from = resolve(s, l.from.node, l.from.pin);
      if (!from) continue;
      const id = s.prefix + l.id;
      outLinks.set(id, { id, from, to: { node: s.prefix + l.to.node, pin: l.to.pin } });
    }
  }

  const nodes = new Map<string, NodeData>();
  for (const [id, n] of src.nodes) nodes.set(id, n);
  const top = mkScope('', nodes, [...src.links], {});
  emit(top);
  return { nodes: outNodes, links: outLinks, rootMap, top, resolve, expanded };
}

const cache = new WeakMap<Graph, { rev: number; libRev: number; res: FlattenResult | null }>();

/** Evaluator pre-pass. Returns null when the graph has no (known) subgraph instances: zero overhead for plain graphs. */
export function flattenGraph(src: Graph, lib: SubgraphLibrary): FlattenResult | null {
  const hit = cache.get(src);
  if (hit && hit.rev === src.revision && hit.libRev === lib.revision) return hit.res;
  let any = false;
  for (const n of src.nodes.values()) {
    if (lib.isInstance(n.type)) {
      any = true;
      break;
    }
  }
  if (!any) {
    cache.set(src, { rev: src.revision, libRev: lib.revision, res: null });
    return null;
  }
  const f = flattenData({ nodes: src.nodes, links: src.links.values() }, lib);
  const flat = new Graph(src.registry, src.settings);
  Object.assign(flat, { id: `${src.id}~flat` });
  for (const [id, n] of f.nodes) flat.nodes.set(id, n);
  for (const [id, l] of f.links) flat.links.set(id, l);
  flat.revision = src.revision * 100000 + lib.revision; // stable for identical inputs, changes with either
  flat.timeline = src.timeline;
  const res: FlattenResult = {
    graph: flat,
    expanded: f.expanded,
    rootOf: (id) => f.rootMap.get(id),
    mapTarget(t: EvalTarget): EvalTarget {
      const n = src.nodes.get(t.nodeId);
      if (!n || !lib.isInstance(n.type)) return t;
      const ex = src.registry.expanded(n.type);
      const pin = t.pinId ?? ex?.outputs[0]?.id;
      if (!pin) return t;
      const ref = f.resolve(f.top, t.nodeId, pin);
      return ref ? { nodeId: ref.node, pinId: ref.pin } : t;
    },
  };
  cache.set(src, { rev: src.revision, libRev: lib.revision, res });
  return res;
}

/** Fully flattened copy of a graph as plain data (tests, "explode", export of a self-contained graph). */
export function flattenToData(src: Graph, lib: SubgraphLibrary): { nodes: NodeData[]; links: LinkData[] } {
  const f = flattenData({ nodes: src.nodes, links: src.links.values() }, lib);
  return { nodes: [...f.nodes.values()], links: [...f.links.values()] };
}

export { instanceDefId };

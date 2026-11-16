import { deepClone, uid } from '../../shared/util';
import type { Command } from '../commands/command';
import { Graph, type GraphData, type LinkData, type NodeData } from '../graph/graph';
import type { ParamValue } from '../params/schema';
import { defaultValues } from '../params/schema';
import type { PinRef, PinType } from '../types';
import { BOUNDARY_IN, BOUNDARY_OUT, BOUNDARY_TYPES, boundaryPins, defTypeId, innerParamDef, isBoundary, type ExposedParam, type SubgraphDefData } from './def';
import { newDefId, newExposedId, type SubgraphLibrary } from './library';

/* Operations that CREATE / EDIT subgraphs. Every graph change is a Command (undo friendly); definition edits go through the
 * library. All of this is pure engine code (no DOM) and is unit-tested with a fake registry-backed Graph. */

const uniqueName = (taken: Set<string>, base: string): string => {
  let n = base;
  let i = 2;
  while (taken.has(n)) n = `${base} ${i++}`;
  taken.add(n);
  return n;
};

function boundaryNode(graph: Graph, type: string, name: string, order: number, x: number, y: number): NodeData {
  const ex = graph.registry.expanded(type);
  if (!ex) throw new Error(`Boundary node type ${type} is not registered.`);
  const params = defaultValues(ex.params);
  params.name = name;
  params.order = order;
  return { id: uid('n'), type, typeVersion: ex.def.version, name, x, y, params };
}

export interface MakeResult {
  defId: string;
  instanceId: string;
  command: Command;
}

/**
 * "Make subgraph" (Ctrl+G). Exposed inputs / outputs are INFERRED from the links that cross the selection border:
 *   - one Input per distinct upstream pin (fan-out into several inner pins shares the Input),
 *   - one Output per inner output pin that feeds an outside node (none: the terminal nodes' first outputs).
 * Returns the (not yet executed) Command: the caller runs it through `editor.stack.execute` so it is ONE undo step.
 */
export function buildMakeSubgraph(graph: Graph, lib: SubgraphLibrary, ids: readonly string[], name = 'Subgraph'): MakeResult | string {
  const sel = new Set(ids.filter((i) => graph.nodes.has(i)));
  for (const i of [...sel]) {
    const n = graph.nodes.get(i)!;
    if (isBoundary(n.type)) sel.delete(i);
  }
  if (!sel.size) return 'Select at least one node.';
  const nodes = [...sel].map((i) => graph.nodes.get(i)!);
  const internal: LinkData[] = [];
  const incoming: LinkData[] = [];
  const outgoing: LinkData[] = [];
  for (const l of graph.links.values()) {
    const a = sel.has(l.from.node);
    const b = sel.has(l.to.node);
    if (a && b) internal.push(l);
    else if (!a && b) incoming.push(l);
    else if (a && !b) outgoing.push(l);
  }
  // layout: shift to a tidy origin
  const minX = Math.min(...nodes.map((n) => n.x));
  const minY = Math.min(...nodes.map((n) => n.y));
  const maxX = Math.max(...nodes.map((n) => n.x));
  const ox = 320 - minX;
  const oy = 80 - minY;
  const inner: GraphData = { settings: deepClone(graph.settings), nodes: nodes.map((n) => ({ ...deepClone(n), x: n.x + ox, y: n.y + oy })), links: deepClone(internal) };

  const pinType = (ref: PinRef, side: 'in' | 'out'): PinType | undefined => {
    const ex = graph.expandedOf(ref.node);
    return (side === 'in' ? ex?.inputs : ex?.outputs)?.find((p) => p.id === ref.pin)?.type;
  };
  const names = new Set<string>();
  const inputNodes: { node: NodeData; src: PinRef }[] = [];
  const bySrc = new Map<string, NodeData>();
  let order = 0;
  for (const l of incoming) {
    const key = `${l.from.node}|${l.from.pin}`;
    let b = bySrc.get(key);
    const srcType = pinType(l.from, 'out') ?? 'gray';
    const t = BOUNDARY_TYPES.includes(srcType) ? srcType : null;
    if (!t) return `Pins of type "${srcType}" cannot cross a subgraph border yet (camera / scalar pins).`;
    if (!b) {
      const label = graph.expandedOf(l.to.node)?.inputs.find((p) => p.id === l.to.pin)?.name ?? 'Input';
      const target = inner.nodes.find((n) => n.id === l.to.node)!;
      b = boundaryNode(graph, `${BOUNDARY_IN}${t}`, uniqueName(names, label), order++, target.x - 260, target.y);
      bySrc.set(key, b);
      inputNodes.push({ node: b, src: l.from });
    }
    inner.links.push({ id: uid('l'), from: { node: b.id, pin: 'output' }, to: { ...l.to } });
  }
  const outputNodes: { node: NodeData; from: PinRef }[] = [];
  const outBy = new Map<string, NodeData>();
  const addOut = (from: PinRef): NodeData | string => {
    const key = `${from.node}|${from.pin}`;
    const have = outBy.get(key);
    if (have) return have;
    const t = pinType(from, 'out') ?? 'gray';
    if (!BOUNDARY_TYPES.includes(t)) return `Pins of type "${t}" cannot cross a subgraph border yet.`;
    const label = graph.expandedOf(from.node)?.outputs.find((p) => p.id === from.pin)?.name ?? 'Output';
    const src = inner.nodes.find((n) => n.id === from.node)!;
    const o = boundaryNode(graph, `${BOUNDARY_OUT}${t}`, uniqueName(names, label), outputNodes.length, maxX + ox + 320, src.y);
    outBy.set(key, o);
    outputNodes.push({ node: o, from });
    inner.links.push({ id: uid('l'), from: { ...from }, to: { node: o.id, pin: 'input' } });
    return o;
  };
  for (const l of outgoing) {
    const r = addOut(l.from);
    if (typeof r === 'string') return r;
  }
  if (!outputNodes.length) {
    const feeding = new Set(internal.map((l) => l.from.node));
    for (const n of nodes) {
      if (feeding.has(n.id)) continue;
      const ex = graph.expandedOf(n.id);
      const o = ex?.outputs.find((p) => BOUNDARY_TYPES.includes(p.type));
      if (o && outputNodes.length < 4) {
        const r = addOut({ node: n.id, pin: o.id });
        if (typeof r === 'string') return r;
      }
    }
  }
  if (!outputNodes.length) return 'The selection has no output pin that can be exposed.';
  inner.nodes.push(...inputNodes.map((x) => x.node), ...outputNodes.map((x) => x.node));

  const now = new Date().toISOString();
  const def: SubgraphDefData = { format: 'kekenik-subgraph', id: newDefId(), name, version: 1, created: now, modified: now, graph: inner, exposed: [] };
  // register BEFORE the command runs (the command needs the node type); removed again by undo of nothing: an unused definition is harmless
  lib.put(def, { silent: true });

  const instanceId = uid('n');
  const cx = nodes.reduce((a, n) => a + n.x, 0) / nodes.length;
  const cy = nodes.reduce((a, n) => a + n.y, 0) / nodes.length;
  const newLinks: LinkData[] = [
    ...inputNodes.map((x) => ({ id: uid('l'), from: x.src, to: { node: instanceId, pin: x.node.id } })),
    ...outgoing.map((l) => ({ id: uid('l'), from: { node: instanceId, pin: outBy.get(`${l.from.node}|${l.from.pin}`)!.id }, to: { ...l.to } })),
  ];
  let removed: { node: NodeData; links: LinkData[] }[] = [];
  const command: Command = {
    label: 'Make subgraph',
    do() {
      removed = [...sel].map((i) => graph.removeNode(i));
      graph.addNode(defTypeId(def.id), { id: instanceId, x: cx, y: cy, name });
      for (const l of newLinks) graph.connect(l.from, l.to, l.id);
    },
    undo() {
      if (graph.nodes.has(instanceId)) graph.removeNode(instanceId);
      for (const r of removed) graph.restoreNode(r.node, r.links);
    },
  };
  return { defId: def.id, instanceId, command };
}

/** Promote an inner parameter to an exposed one. Returns the new exposed list (the caller commits it with `setExposedCommand`). */
export function promoteParam(lib: SubgraphLibrary, defId: string, nodeId: string, paramId: string, opts: { label?: string; group?: string; min?: number; max?: number; tooltip?: string } = {}): ExposedParam[] | string {
  const def = lib.get(defId);
  if (!def) return `No subgraph "${defId}"`;
  const n = def.graph.nodes.find((x) => x.id === nodeId);
  if (!n) return 'The node is not part of this subgraph.';
  if (isBoundary(n.type)) return 'Boundary nodes cannot be exposed.';
  const base = innerParamDef(def, { id: '', node: nodeId, param: paramId, label: '', group: '' }, lib.registry);
  if (!base) return `Node has no parameter "${paramId}".`;
  if (def.exposed.some((e) => e.node === nodeId && e.param === paramId)) return 'This parameter is already exposed.';
  const e: ExposedParam = {
    id: newExposedId(def.exposed),
    node: nodeId,
    param: paramId,
    label: opts.label ?? base.label,
    group: opts.group ?? n.name,
    min: opts.min,
    max: opts.max,
    tooltip: opts.tooltip,
    default: deepClone((n.params[paramId] ?? base.default) as ParamValue),
  };
  return [...def.exposed, e];
}

/** Undoable replacement of the exposed list (and refresh of every instance). */
export function setExposedCommand(lib: SubgraphLibrary, defId: string, next: ExposedParam[], label = 'Edit subgraph parameters'): Command {
  const prev = deepClone(lib.get(defId)?.exposed ?? []);
  const nx = deepClone(next);
  return {
    label,
    do: () => void lib.update(defId, { exposed: deepClone(nx) }),
    undo: () => void lib.update(defId, { exposed: deepClone(prev) }),
  };
}

/** "Unlink to unique": gives the instance a private copy of its definition (same pin / param ids, so links survive). */
export function buildUnlinkInstance(graph: Graph, lib: SubgraphLibrary, nodeId: string): { command: Command; defId: string } | string {
  const n = graph.nodes.get(nodeId);
  const id = n && lib.isInstance(n.type);
  if (!n || !id) return 'Not a subgraph instance.';
  const copy = lib.duplicate(id, `${lib.get(id)!.name} (unique)`);
  const oldType = n.type;
  const newType = defTypeId(copy.id);
  const retype = (type: string): void => {
    const node = graph.nodes.get(nodeId);
    if (!node) return;
    const links = graph.linksFrom(nodeId).concat(graph.linksTo(nodeId));
    const r = graph.removeNode(nodeId);
    graph.restoreNode({ ...r.node, type, name: node.name }, links.length ? r.links : []);
  };
  return { defId: copy.id, command: { label: 'Unlink subgraph to unique', do: () => retype(newType), undo: () => retype(oldType) } };
}

export { boundaryPins };

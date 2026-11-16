import type { Graph } from './graph';
import { canConnect } from './pins';

export interface GraphIssue {
  severity: 'error' | 'warning';
  nodeId?: string;
  linkId?: string;
  message: string;
}

/** Full-graph validation (used after load and in tests). Cheap enough to run on every structural change. */
export function validateGraph(graph: Graph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const n of graph.nodes.values()) {
    if (!graph.registry.has(n.type)) issues.push({ severity: 'error', nodeId: n.id, message: `Unknown node type "${n.type}"` });
  }
  const seenInputs = new Set<string>();
  for (const l of graph.links.values()) {
    const fe = graph.expandedOf(l.from.node);
    const te = graph.expandedOf(l.to.node);
    if (!graph.nodes.has(l.from.node) || !graph.nodes.has(l.to.node)) {
      issues.push({ severity: 'error', linkId: l.id, message: 'Link references a missing node' });
      continue;
    }
    if (!fe || !te) continue; // unknown types already reported
    const out = fe.outputs.find((p) => p.id === l.from.pin);
    const inp = te.inputs.find((p) => p.id === l.to.pin);
    if (!out || !inp) issues.push({ severity: 'error', linkId: l.id, message: 'Link references a missing pin' });
    else if (!canConnect(out.type, inp.type)) issues.push({ severity: 'error', linkId: l.id, message: `Type mismatch ${out.type} -> ${inp.type}` });
    const key = `${l.to.node}:${l.to.pin}`;
    if (seenInputs.has(key)) issues.push({ severity: 'error', linkId: l.id, nodeId: l.to.node, message: `Input "${l.to.pin}" has more than one link` });
    seenInputs.add(key);
  }
  // Cycle detection (Kahn).
  const indeg = new Map<string, number>();
  for (const id of graph.nodes.keys()) indeg.set(id, 0);
  for (const l of graph.links.values()) if (indeg.has(l.to.node) && graph.nodes.has(l.from.node)) indeg.set(l.to.node, indeg.get(l.to.node)! + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  let visited = 0;
  while (queue.length) {
    const id = queue.pop()!;
    visited++;
    for (const l of graph.linksFrom(id)) {
      const d = indeg.get(l.to.node);
      if (d === undefined) continue;
      indeg.set(l.to.node, d - 1);
      if (d - 1 === 0) queue.push(l.to.node);
    }
  }
  if (visited < graph.nodes.size) issues.push({ severity: 'error', message: 'Graph contains a cycle' });
  // Required inputs.
  for (const n of graph.nodes.values()) {
    const ex = graph.registry.expanded(n.type);
    if (!ex) continue;
    for (const p of ex.inputs) {
      if (!p.optional && !graph.inputLink(n.id, p.id)) issues.push({ severity: 'warning', nodeId: n.id, message: `Required input "${p.name}" is not connected` });
    }
  }
  return issues;
}

/**
 * Glue between the animation model and the evaluator.
 * `makeAnimator(registry)` is installed as `Evaluator.animator`: it overrides the animated params of a node for the
 * requested time. Nodes without animation return the SAME params object (zero cost: static subgraphs are never touched, and
 * their hashes never contain time). Animated values flow into the param hash, so only nodes whose inputs actually animate
 * are recomputed during playback.
 */
import type { Graph, NodeData } from '../graph/graph';
import type { ParamAnimator } from '../graph/plan';
import type { NodeRegistry } from '../graph/registry';
import type { ParamDef, ParamValue, ParamValues } from '../params/schema';
import { evalTrack, hasKeyAt, trackIsEmpty, type AnimTrack } from './tracks';

export function makeAnimator(registry: NodeRegistry): ParamAnimator {
  return (node: NodeData, values: ParamValues, time: number, fps = 30): ParamValues => {
    const anim = node.anim;
    if (!anim) return values;
    const ex = registry.expanded(node.type);
    if (!ex) return values;
    const frame = time * fps;
    let out: ParamValues | null = null;
    for (const pid of Object.keys(anim)) {
      const def = ex.params.find((p) => p.id === pid);
      const tr = anim[pid];
      if (!def || trackIsEmpty(tr)) continue;
      const v = evalTrack(tr, def, frame);
      if (v === undefined) continue;
      if (!out) out = { ...values };
      out[pid] = v;
    }
    return out ?? values;
  };
}

/** Animated (or static) value of a param at `frame`. */
export function valueAt(graph: Graph, nodeId: string, paramId: string, frame: number): ParamValue | undefined {
  const n = graph.nodes.get(nodeId);
  if (!n) return undefined;
  const tr = n.anim?.[paramId];
  const def = graph.expandedOf(nodeId)?.params.find((p) => p.id === paramId);
  if (tr && def) {
    const v = evalTrack(tr, def, frame);
    if (v !== undefined) return v;
  }
  return n.params[paramId];
}

export const trackOf = (graph: Graph, nodeId: string, paramId: string): AnimTrack | undefined => graph.nodes.get(nodeId)?.anim?.[paramId];
export const isAnimated = (graph: Graph, nodeId: string, paramId: string): boolean => !trackIsEmpty(trackOf(graph, nodeId, paramId));
export const hasKeyAtFrame = (graph: Graph, nodeId: string, paramId: string, frame: number): boolean => hasKeyAt(trackOf(graph, nodeId, paramId), frame);

/** Animated param defs of a node (dopesheet rows). */
export function animatedParams(graph: Graph, nodeId: string): { def: ParamDef; track: AnimTrack }[] {
  const n = graph.nodes.get(nodeId);
  const ex = graph.expandedOf(nodeId);
  if (!n?.anim || !ex) return [];
  const out: { def: ParamDef; track: AnimTrack }[] = [];
  for (const def of ex.params) {
    const track = n.anim[def.id];
    if (track && !trackIsEmpty(track)) out.push({ def, track });
  }
  return out;
}

export const graphHasAnimation = (graph: Graph): boolean => [...graph.nodes.values()].some((n) => n.anim && Object.values(n.anim).some((t) => !trackIsEmpty(t)));

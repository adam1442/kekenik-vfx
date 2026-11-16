import { deepClone } from '../../../shared/util';
import type { FrameData, NodeUi, NoteData, RerouteData } from '../../../engine/graph/annotations';
import type { Graph, LinkData, NodeData } from '../../../engine/graph/graph';

/**
 * JSON clipboard payload. It is placed on the SYSTEM clipboard as text (copy/paste events), so it works between
 * browser tabs and even as plain text in chat/bug reports.
 */
export const CLIP_FORMAT = 'kekenik-vfx-graph-clip';
export interface GraphClip {
  format: typeof CLIP_FORMAT;
  version: 1;
  nodes: NodeData[];
  links: LinkData[];
  ui: Record<string, NodeUi>;
  frames: FrameData[];
  notes: NoteData[];
  reroutes: RerouteData[];
  linkVia: Record<string, string[]>;
  /** Top-left of the copied selection (paste offsets relative to it). */
  origin: [number, number];
}

export interface ClipSelection {
  nodes: string[];
  frames: string[];
  notes: string[];
  reroutes: string[];
}

/** Node dimensions are needed for the origin; the caller supplies positions through the NodeData itself. */
export function buildClip(graph: Graph, sel: ClipSelection): GraphClip {
  const nodeSet = new Set(sel.nodes.filter((id) => graph.nodes.has(id)));
  const nodes = [...nodeSet].map((id) => deepClone(graph.nodes.get(id)!));
  const links = [...graph.links.values()].filter((l) => nodeSet.has(l.from.node) && nodeSet.has(l.to.node)).map((l) => deepClone(l));
  const a = graph.annotations;
  const ui: Record<string, NodeUi> = {};
  for (const id of nodeSet) if (a.nodeUi[id]) ui[id] = deepClone(a.nodeUi[id]);
  const linkVia: Record<string, string[]> = {};
  const usedReroutes = new Set<string>(sel.reroutes);
  for (const l of links) {
    const via = a.linkVia[l.id];
    if (via?.length) {
      linkVia[l.id] = [...via];
      via.forEach((r) => usedReroutes.add(r));
    }
  }
  const frames = a.frames.filter((f) => sel.frames.includes(f.id)).map((f) => deepClone(f));
  const notes = a.notes.filter((n) => sel.notes.includes(n.id)).map((n) => deepClone(n));
  const reroutes = a.reroutes.filter((r) => usedReroutes.has(r.id)).map((r) => deepClone(r));
  const xs = [...nodes.map((n) => n.x), ...frames.map((f) => f.x), ...notes.map((n) => n.x), ...reroutes.map((r) => r.x)];
  const ys = [...nodes.map((n) => n.y), ...frames.map((f) => f.y), ...notes.map((n) => n.y), ...reroutes.map((r) => r.y)];
  return { format: CLIP_FORMAT, version: 1, nodes, links, ui, frames, notes, reroutes, linkVia, origin: [xs.length ? Math.min(...xs) : 0, ys.length ? Math.min(...ys) : 0] };
}

export const clipIsEmpty = (c: GraphClip): boolean => !c.nodes.length && !c.frames.length && !c.notes.length && !c.reroutes.length;

/** Parse untrusted text. Returns null for anything that is not a graph clip. Never throws. */
export function parseClip(text: string): GraphClip | null {
  try {
    const j = JSON.parse(text) as Partial<GraphClip>;
    if (!j || j.format !== CLIP_FORMAT || !Array.isArray(j.nodes)) return null;
    const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
    const nodes = arr(j.nodes).filter((n) => n && typeof n.id === 'string' && typeof n.type === 'string');
    return {
      format: CLIP_FORMAT,
      version: 1,
      nodes,
      links: arr(j.links).filter((l) => l?.from && l?.to),
      ui: j.ui && typeof j.ui === 'object' ? j.ui : {},
      frames: arr(j.frames),
      notes: arr(j.notes),
      reroutes: arr(j.reroutes),
      linkVia: j.linkVia && typeof j.linkVia === 'object' ? j.linkVia : {},
      origin: Array.isArray(j.origin) && j.origin.length === 2 ? [Number(j.origin[0]) || 0, Number(j.origin[1]) || 0] : [0, 0],
    };
  } catch {
    return null;
  }
}

import { deepClone } from '../../shared/util';

/**
 * GRAPH ANNOTATIONS.
 *
 * Everything that is purely editor/organisation data lives here, NOT in NodeData, so the evaluator, cache hashing and
 * the node contracts are untouched:
 *   - nodeUi:    per-node UI state (collapsed, locked, colour tag, width, "show modulation pins")
 *   - frames:    comment frames (titled, coloured, collapsible, contain nodes geometrically / by `members` when collapsed)
 *   - notes:     sticky notes
 *   - reroutes:  reroute dots. A reroute is NOT an engine node: links stay real from->to links, and `linkVia[linkId]`
 *                lists the reroute ids the link visually passes through (a reroute shared by several links = a bundle).
 *   - bookmarks: saved camera positions (jump points)
 * Annotations serialize inside GraphData.annotations (optional field: old projects simply have none).
 */
export interface NodeUi {
  collapsed?: boolean;
  locked?: boolean;
  /** Colour tag (CSS colour). */
  color?: string;
  /** Node width in world units (resize). */
  w?: number;
  /** Show unconnected modulation (`*_mod`) input pins. */
  showMods?: boolean;
}

export interface FrameData {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  color: string;
  /** Collapsed: only the title bar is shown and `members` are hidden. */
  collapsed?: boolean;
  members?: string[];
  /** Height to restore when expanding. */
  fullH?: number;
}

export interface NoteData {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  color: string;
}

export interface RerouteData {
  id: string;
  x: number;
  y: number;
}

export interface BookmarkData {
  id: string;
  name: string;
  /** World coordinates of the view centre. */
  x: number;
  y: number;
  zoom: number;
}

export interface GraphAnnotations {
  nodeUi: Record<string, NodeUi>;
  frames: FrameData[];
  notes: NoteData[];
  reroutes: RerouteData[];
  linkVia: Record<string, string[]>;
  bookmarks: BookmarkData[];
}

export const emptyAnnotations = (): GraphAnnotations => ({ nodeUi: {}, frames: [], notes: [], reroutes: [], linkVia: {}, bookmarks: [] });

export const isEmptyAnnotations = (a: GraphAnnotations): boolean =>
  !Object.keys(a.nodeUi).length && !a.frames.length && !a.notes.length && !a.reroutes.length && !Object.keys(a.linkVia).length && !a.bookmarks.length;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string): string => (typeof v === 'string' ? v : d);

/** Defensive parse of untrusted JSON (project files, clipboard). Never throws; drops malformed entries. */
export function sanitizeAnnotations(raw: unknown): GraphAnnotations {
  const out = emptyAnnotations();
  if (!isObj(raw)) return out;
  if (isObj(raw.nodeUi)) {
    for (const [id, u] of Object.entries(raw.nodeUi)) {
      if (!isObj(u)) continue;
      const ui: NodeUi = {};
      if (u.collapsed === true) ui.collapsed = true;
      if (u.locked === true) ui.locked = true;
      if (u.showMods === true) ui.showMods = true;
      if (typeof u.color === 'string') ui.color = u.color;
      if (typeof u.w === 'number' && Number.isFinite(u.w)) ui.w = Math.min(640, Math.max(110, u.w));
      if (Object.keys(ui).length) out.nodeUi[id] = ui;
    }
  }
  const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
  for (const f of arr(raw.frames)) {
    if (typeof f.id !== 'string') continue;
    out.frames.push({
      id: f.id, x: num(f.x, 0), y: num(f.y, 0), w: Math.max(60, num(f.w, 300)), h: Math.max(40, num(f.h, 200)), title: str(f.title, 'Comment'), color: str(f.color, '#5aa7e0'),
      collapsed: f.collapsed === true ? true : undefined, members: Array.isArray(f.members) ? f.members.filter((m): m is string => typeof m === 'string') : undefined, fullH: typeof f.fullH === 'number' ? f.fullH : undefined,
    });
  }
  for (const n of arr(raw.notes)) if (typeof n.id === 'string') out.notes.push({ id: n.id, x: num(n.x, 0), y: num(n.y, 0), w: Math.max(80, num(n.w, 200)), h: Math.max(50, num(n.h, 120)), text: str(n.text, ''), color: str(n.color, '#e0c35a') });
  for (const r of arr(raw.reroutes)) if (typeof r.id === 'string') out.reroutes.push({ id: r.id, x: num(r.x, 0), y: num(r.y, 0) });
  for (const b of arr(raw.bookmarks)) if (typeof b.id === 'string') out.bookmarks.push({ id: b.id, name: str(b.name, 'Bookmark'), x: num(b.x, 0), y: num(b.y, 0), zoom: Math.min(4, Math.max(0.05, num(b.zoom, 1))) });
  if (isObj(raw.linkVia)) {
    for (const [lid, v] of Object.entries(raw.linkVia)) if (Array.isArray(v)) {
        const ids = v.filter((x): x is string => typeof x === 'string');
        if (ids.length) out.linkVia[lid] = ids;
      }
  }
  return out;
}

/**
 * Remove references to things that no longer exist (called when SERIALISING, never on live undoable state, because
 * undoing a node delete must find its UI state / reroutes again).
 */
export function pruneAnnotations(a: GraphAnnotations, nodeIds: ReadonlySet<string>, linkIds: ReadonlySet<string>): GraphAnnotations {
  const out = deepClone(a);
  for (const id of Object.keys(out.nodeUi)) if (!nodeIds.has(id)) delete out.nodeUi[id];
  const liveReroutes = new Set<string>();
  const rerouteIds = new Set(out.reroutes.map((r) => r.id));
  for (const [lid, via] of Object.entries(out.linkVia)) {
    if (!linkIds.has(lid)) {
      delete out.linkVia[lid];
      continue;
    }
    const keep = via.filter((r) => rerouteIds.has(r));
    if (keep.length) {
      out.linkVia[lid] = keep;
      keep.forEach((r) => liveReroutes.add(r));
    } else delete out.linkVia[lid];
  }
  out.reroutes = out.reroutes.filter((r) => liveReroutes.has(r.id));
  for (const f of out.frames) if (f.members) f.members = f.members.filter((m) => nodeIds.has(m));
  return out;
}

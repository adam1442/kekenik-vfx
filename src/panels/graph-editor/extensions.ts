import type { Graph } from '../../engine/graph/graph';
import type { MenuItem } from '../../ui/core/menu';
import type { Pt } from './core/geometry';

/**
 * Extension points of the graph editor so subgraphs / presets / imports plug in without the editor knowing them.
 * Set by app/library.ts at startup.
 */
export interface SearchExtra {
  title: string;
  subtitle: string;
  icon?: string;
  color?: string;
  thumb?: string;
  pick(world: Pt): void;
}
export interface GraphExtensions {
  /** Extra items at the top of the NODE context menu. */
  nodeMenu?: (graph: Graph, ids: string[]) => MenuItem[];
  /** Extra items in the background context menu. */
  backgroundMenu?: (world: Pt) => MenuItem[];
  /** Presets / library subgraphs offered by the node search popup. */
  searchExtras?: (query: string) => SearchExtra[];
  /** Where (graph world space) the last file was dropped on the canvas; consumed by the file importer. */
  lastDrop?: { world: Pt; t: number };
}
export const graphExtensions: GraphExtensions = {};

import type { Pt } from './core/geometry';

/**
 * Tiny registry so the rest of the app (commands, node library, palette) can talk to the graph editor without importing
 * its internals. The Graph Editor panel registers itself while it is open.
 */
export interface GraphViewApi {
  /** True when keyboard shortcuts should target the graph (pointer over it or focus inside, or a modal opened from it). */
  isActive(): boolean;
  /** A good empty spot for a node created from outside the graph (library double-click, palette). */
  nextNodePosition(fallback?: Pt): Pt;
  deleteSelection(heal: boolean): void;
  duplicateSelection(): void;
  selectAll(): void;
  deselect(): void;
  toggleBypass(): void;
  hasSelection(): boolean;
}

let active: GraphViewApi | null = null;
export const setActiveGraphView = (v: GraphViewApi | null): void => {
  active = v;
};
export const getActiveGraphView = (): GraphViewApi | null => active;
/** Position for a new node: the graph editor's free spot in view, else the given fallback. */
export const placeNewNode = (fallback: Pt): Pt => active?.nextNodePosition(fallback) ?? fallback;

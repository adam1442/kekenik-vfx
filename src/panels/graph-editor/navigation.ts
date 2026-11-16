import { Emitter } from '../../shared/emitter';
import type { Graph } from '../../engine/graph/graph';

/**
 * Subgraph-ready navigation hooks (breadcrumb bar + enter/exit API). implements subgraph creation and
 * evaluation and plugs in `enterHandler` / `exitHandler`, which actually switch the graph being edited (swap
 * `ProjectService.editor`/`graph` or a scoped editor) and return true on success. Until then double-clicking a node
 * without a `subgraph` does nothing and the breadcrumb shows only the root.
 */
export interface BreadcrumbItem {
  /** 'root' or the id of the subgraph node that was entered. */
  id: string;
  name: string;
}

export class GraphNavigation {
  readonly onChange = new Emitter<void>();
  private stack: BreadcrumbItem[] = [{ id: 'root', name: 'Graph' }];
  enterHandler: ((nodeId: string) => boolean) | null = null;
  exitHandler: ((toDepth: number) => boolean) | null = null;

  get path(): readonly BreadcrumbItem[] {
    return this.stack;
  }
  get depth(): number {
    return this.stack.length - 1;
  }
  /** instances of shared subgraph definitions have no inline `subgraph` data; this hook says whether a node can be entered. */
  canEnterHook: ((graph: Graph, nodeId: string) => boolean) | null = null;
  canEnter(graph: Graph, nodeId: string): boolean {
    return (!!graph.nodes.get(nodeId)?.subgraph || !!this.canEnterHook?.(graph, nodeId)) && !!this.enterHandler;
  }
  enter(graph: Graph, nodeId: string): boolean {
    const n = graph.nodes.get(nodeId);
    if (!n || !this.enterHandler || !this.enterHandler(nodeId)) return false;
    this.stack.push({ id: nodeId, name: n.name });
    this.onChange.emit();
    return true;
  }
  /** Go up so that `toDepth` items remain (0 = root). */
  exit(toDepth = this.stack.length - 2): boolean {
    const d = Math.max(0, Math.min(toDepth, this.stack.length - 1));
    if (d === this.stack.length - 1) return false;
    if (this.exitHandler && !this.exitHandler(d)) return false;
    this.stack.length = d + 1;
    this.onChange.emit();
    return true;
  }
  reset(): void {
    this.stack = [{ id: 'root', name: 'Graph' }];
    this.onChange.emit();
  }
}
export const graphNavigation = new GraphNavigation();

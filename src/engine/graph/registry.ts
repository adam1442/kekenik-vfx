import { CATEGORIES } from './categories';
const CATEGORY_ORDER = Object.keys(CATEGORIES);
import type { NodeCategory } from '../types';
import { expandDefinition, validateDefinition, type ExpandedNode } from './expand';
import type { NodeDefinition } from './node';

export class NodeRegistry {
  private defs = new Map<string, NodeDefinition>();
  private expandedCache = new Map<string, ExpandedNode>();

  /** Throws with a readable message when the definition is invalid (caught at discovery and in tests). */
  register(def: NodeDefinition): void {
    const errs = validateDefinition(def);
    if (errs.length) throw new Error(`Invalid node definition "${def.id}":\n - ${errs.join('\n - ')}`);
    if (this.defs.has(def.id)) throw new Error(`Duplicate node id "${def.id}"`);
    this.defs.set(def.id, def);
    this.expandedCache.set(def.id, expandDefinition(def));
  }

  /** runtime (un)registration for subgraph definitions. Built-in node ids are never removed by the app. */
  unregister(id: string): boolean {
    this.expandedCache.delete(id);
    return this.defs.delete(id);
  }
  /** register or replace a definition (validated like `register`). */
  replace(def: NodeDefinition): void {
    const errs = validateDefinition(def);
    if (errs.length) throw new Error(`Invalid node definition "${def.id}":\n - ${errs.join('\n - ')}`);
    this.defs.set(def.id, def);
    this.expandedCache.set(def.id, expandDefinition(def));
  }

  has(id: string): boolean {
    return this.defs.has(id);
  }
  get(id: string): NodeDefinition | undefined {
    return this.defs.get(id);
  }
  expanded(id: string): ExpandedNode | undefined {
    return this.expandedCache.get(id);
  }
  list(): NodeDefinition[] {
    return [...this.defs.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  byCategory(): Map<NodeCategory, NodeDefinition[]> {
    const m = new Map<NodeCategory, NodeDefinition[]>();
    for (const d of this.list()) {
      if (!m.has(d.category)) m.set(d.category, []);
      m.get(d.category)!.push(d);
    }
    return m;
  }
  /** Simple fuzzy search over title, id and keywords (node library / command palette). */
  search(query: string): NodeDefinition[] {
    const q = query.trim().toLowerCase();
    if (!q) return this.list();
    const score = (d: NodeDefinition): number => {
      const hay = [d.title, d.id, ...(d.keywords ?? [])].join(' ').toLowerCase();
      if (d.title.toLowerCase() === q) return 100;
      if (d.title.toLowerCase().startsWith(q)) return 80;
      if (hay.includes(q)) return 50;
      let i = 0;
      for (const ch of hay) if (ch === q[i]) i++;
      return i === q.length ? 10 : 0;
    };
    return this.list()
      .map((d) => [d, score(d)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1] || CATEGORY_ORDER.indexOf(a[0].category) - CATEGORY_ORDER.indexOf(b[0].category)) // ties: category order (grayscale first), then registration order
      .map(([d]) => d);
  }
}

/** The app-wide registry (tests create their own). */
export const nodeRegistry = new NodeRegistry();

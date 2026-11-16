import { Emitter } from '../../shared/emitter';
import { deepClone, uid } from '../../shared/util';
import type { GraphData } from '../graph/graph';
import type { NodeRegistry } from '../graph/registry';
import { defTypeId, instanceDefId, interfaceSignature, nodeDefinitionFor, sanitizeDef, SUBGRAPH_LIMITS, type ExposedParam, type SubgraphDefData } from './def';

export interface LibraryChange {
  ids: string[];
  /** Pins / params / title changed: UIs must rebuild nodes of these types. */
  interfaceChanged: boolean;
}

export interface SubgraphBundle {
  format: 'kekenik-subgraph';
  version: 1;
  /** Definition the user exported; the others are its (transitive) dependencies. */
  root: string;
  defs: SubgraphDefData[];
}

/**
 * The set of subgraph definitions of the CURRENT project, mirrored into the NodeRegistry (`subgraph.<id>` node types).
 * `revision` increases on every change and is part of the flatten cache key. The user library (IndexedDB) lives in
 * `app/library-store.ts`; this class is pure (no storage) and unit-tested.
 */
export class SubgraphLibrary {
  readonly onChange = new Emitter<LibraryChange>();
  revision = 0;
  private defs = new Map<string, SubgraphDefData>();
  private sigs = new Map<string, string>();

  constructor(readonly registry: NodeRegistry) {}

  has(id: string): boolean {
    return this.defs.has(id);
  }
  get(id: string): SubgraphDefData | undefined {
    return this.defs.get(id);
  }
  list(): SubgraphDefData[] {
    return [...this.defs.values()];
  }
  /** Is `type` an instance of a known definition? Returns the definition id. */
  isInstance(type: string): string | null {
    const id = instanceDefId(type);
    return id && this.defs.has(id) ? id : null;
  }

  private register(def: SubgraphDefData): boolean {
    const sig = interfaceSignature(def, this.registry);
    const changed = this.sigs.get(def.id) !== sig;
    if (changed || !this.registry.has(defTypeId(def.id))) {
      this.registry.replace(nodeDefinitionFor(def, this.registry));
      this.sigs.set(def.id, sig);
    }
    return changed;
  }

  /** Adds or replaces a definition (sanitised copy). */
  put(raw: SubgraphDefData, opts: { silent?: boolean } = {}): SubgraphDefData {
    const def = sanitizeDef(raw);
    if (!def) throw new Error('Invalid subgraph definition.');
    if (!this.defs.has(def.id) && this.defs.size >= SUBGRAPH_LIMITS.maxDefs) throw new Error(`Too many subgraph definitions (max ${SUBGRAPH_LIMITS.maxDefs}).`);
    this.defs.set(def.id, def);
    const changed = this.register(def);
    this.revision++;
    if (!opts.silent) this.onChange.emit({ ids: [def.id], interfaceChanged: changed });
    return def;
  }

  /** Edits a definition in place. `graph` replaces the inner graph; the version counter increases. */
  update(id: string, patch: Partial<Pick<SubgraphDefData, 'graph' | 'exposed' | 'name' | 'description' | 'tags' | 'folder'>>): SubgraphDefData {
    const cur = this.defs.get(id);
    if (!cur) throw new Error(`No subgraph "${id}"`);
    const next: SubgraphDefData = { ...cur, ...patch, version: cur.version + 1, modified: new Date().toISOString() };
    if (patch.graph) next.graph = patch.graph;
    this.defs.set(id, next);
    const changed = this.register(next);
    this.revision++;
    this.onChange.emit({ ids: [id], interfaceChanged: changed });
    return next;
  }

  remove(id: string): void {
    if (!this.defs.delete(id)) return;
    this.registry.unregister(defTypeId(id));
    this.sigs.delete(id);
    this.revision++;
    this.onChange.emit({ ids: [id], interfaceChanged: true });
  }

  /** Replaces the whole library (project load). Registration runs in passes so nested exposed params resolve. */
  load(raw: readonly unknown[] | undefined): string[] {
    const warnings: string[] = [];
    for (const id of [...this.defs.keys()]) {
      this.registry.unregister(defTypeId(id));
    }
    this.defs.clear();
    this.sigs.clear();
    for (const r of raw ?? []) {
      const d = sanitizeDef(r);
      if (!d) warnings.push('A subgraph definition in the project was invalid and was skipped.');
      else if (this.defs.size < SUBGRAPH_LIMITS.maxDefs) this.defs.set(d.id, d);
    }
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const d of this.defs.values()) changed = this.register(d) || changed;
      if (!changed && pass > 0) break;
    }
    this.revision++;
    this.onChange.emit({ ids: [...this.defs.keys()], interfaceChanged: true });
    return warnings;
  }

  toData(): SubgraphDefData[] {
    return this.list().map((d) => deepClone(d));
  }

  /** Definition ids directly instantiated inside a graph. */
  usedIn(graph: GraphData): Set<string> {
    const out = new Set<string>();
    for (const n of graph.nodes) {
      const id = instanceDefId(n.type);
      if (id) out.add(id);
    }
    return out;
  }

  /** Transitive dependencies of a definition (including itself). */
  closure(id: string): Set<string> {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (out.has(cur)) continue;
      out.add(cur);
      const d = this.defs.get(cur);
      if (d) for (const u of this.usedIn(d.graph)) stack.push(u);
    }
    return out;
  }

  /** Would instantiating `inner` inside `outer` create a cycle (outer -> ... -> inner -> ... -> outer)? */
  wouldRecurse(outer: string, inner: string): boolean {
    return outer === inner || this.closure(inner).has(outer);
  }

  /** "Unlink to unique": a private copy of a definition (new id). The caller retypes the instance. */
  duplicate(id: string, name?: string): SubgraphDefData {
    const src = this.defs.get(id);
    if (!src) throw new Error(`No subgraph "${id}"`);
    const now = new Date().toISOString();
    return this.put({ ...deepClone(src), id: newDefId(), name: name ?? `${src.name} (unique)`, version: 1, created: now, modified: now });
  }

  /** Single-file export: the definition plus everything it depends on. */
  exportBundle(id: string): SubgraphBundle {
    const ids = this.closure(id);
    return { format: 'kekenik-subgraph', version: 1, root: id, defs: [...ids].map((i) => this.defs.get(i)).filter((d): d is SubgraphDefData => !!d).map((d) => deepClone(d)) };
  }

  /**
   * Imports a bundle. Ids that already exist with identical content are reused; ids that collide with DIFFERENT content
   * get a fresh id and every nested instance is retyped. Returns the id of the root definition in this library.
   */
  importBundle(json: unknown): { root: string; warnings: string[] } {
    const b = json as Partial<SubgraphBundle> | null;
    if (!b || b.format !== 'kekenik-subgraph' || !Array.isArray(b.defs) || typeof b.root !== 'string') throw new Error('Not a Kekenik subgraph file.');
    const incoming = new Map<string, SubgraphDefData>();
    const warnings: string[] = [];
    for (const r of b.defs) {
      const d = sanitizeDef(r);
      if (d) incoming.set(d.id, d);
      else warnings.push('Skipped an invalid definition.');
    }
    if (!incoming.has(b.root)) throw new Error('The subgraph file does not contain its root definition.');
    const remap = new Map<string, string>();
    for (const d of incoming.values()) {
      const ex = this.defs.get(d.id);
      if (ex && JSON.stringify(ex.graph) !== JSON.stringify(d.graph)) remap.set(d.id, newDefId());
    }
    for (const d of incoming.values()) {
      if (!remap.size) break;
      for (const n of d.graph.nodes) {
        const inner = instanceDefId(n.type);
        if (inner && remap.has(inner)) n.type = defTypeId(remap.get(inner)!);
      }
    }
    for (const d of incoming.values()) {
      const nid = remap.get(d.id) ?? d.id;
      if (!this.defs.has(nid)) this.put({ ...d, id: nid }, { silent: true });
    }
    this.revision++;
    this.onChange.emit({ ids: [...incoming.keys()], interfaceChanged: true });
    return { root: remap.get(b.root) ?? b.root, warnings };
  }
}

export const newDefId = (): string => `sg_${uid('s').replace(/[^a-z0-9]/gi, '').toLowerCase()}`;

/** Convenience used by tests / UI: exposed param ids are unique per definition. */
export const newExposedId = (taken: readonly ExposedParam[]): string => {
  let i = taken.length + 1;
  const ids = new Set(taken.map((e) => e.id));
  while (ids.has(`x_${i}`)) i++;
  return `x_${i}`;
};

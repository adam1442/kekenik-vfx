import { Emitter } from '../../shared/emitter';
import { deepClone, uid } from '../../shared/util';
import type { GraphEditor } from '../commands/graph-commands';
import type { Graph } from '../graph/graph';
import type { NodeAnim } from '../anim/tracks';
import type { ParamValues } from '../params/schema';
import { coerceParam } from '../params/schema';
import { instanceDefId, sanitizeDef, type SubgraphDefData } from '../subgraph/def';
import type { SubgraphLibrary } from '../subgraph/library';

/**
 * Node PRESETS: any node (parameters + keyframes) saved with name, folder, tags and a thumbnail rendered from its
 * output. Searchable, favouritable, spawnable from the search popup / context menu / Presets panel, shareable as JSON bundles.
 * A preset of a SUBGRAPH INSTANCE embeds the definition so it can be spawned in any project.
 */
export interface NodePreset {
  id: string;
  name: string;
  folder: string;
  tags: string[];
  favorite?: boolean;
  nodeType: string;
  typeVersion: number;
  params: ParamValues;
  anim?: NodeAnim;
  /** PNG data URL (<= ~20 KB). */
  thumbnail?: string;
  /** Embedded definition when `nodeType` is a subgraph instance. */
  subgraph?: SubgraphDefData;
  builtin?: boolean;
  created: number;
}

export interface PresetBackend {
  all(): Promise<NodePreset[]>;
  put(p: NodePreset): Promise<void>;
  delete(id: string): Promise<void>;
}
export class MemoryPresetBackend implements PresetBackend {
  readonly data = new Map<string, NodePreset>();
  async all(): Promise<NodePreset[]> {
    return [...this.data.values()].map((p) => deepClone(p));
  }
  async put(p: NodePreset): Promise<void> {
    this.data.set(p.id, deepClone(p));
  }
  async delete(id: string): Promise<void> {
    this.data.delete(id);
  }
}

export const LIBRARY_FORMAT = 'kekenik-library';
export interface LibraryBundle {
  format: typeof LIBRARY_FORMAT;
  version: 1;
  presets: NodePreset[];
  subgraphs: SubgraphDefData[];
  /** Curve / gradient preset files of ui/widgets/presets.ts (opaque here). */
  curves?: unknown;
  gradients?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function sanitizePreset(raw: unknown): NodePreset | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || typeof raw.nodeType !== 'string' || !isObj(raw.params)) return null;
  const sg = raw.subgraph ? sanitizeDef(raw.subgraph) : null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : uid('pr'),
    name: raw.name.slice(0, 120),
    folder: typeof raw.folder === 'string' && raw.folder ? raw.folder.slice(0, 120) : 'My Presets',
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 24) : [],
    favorite: raw.favorite === true,
    nodeType: raw.nodeType,
    typeVersion: Number.isInteger(raw.typeVersion) ? (raw.typeVersion as number) : 1,
    params: deepClone(raw.params as ParamValues),
    anim: isObj(raw.anim) ? (deepClone(raw.anim) as NodeAnim) : undefined,
    thumbnail: typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:image/') && raw.thumbnail.length < 200_000 ? raw.thumbnail : undefined,
    subgraph: sg ?? undefined,
    created: typeof raw.created === 'number' ? raw.created : Date.now(),
  };
}

export function parseLibraryBundle(text: string): LibraryBundle {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`, { cause: e });
  }
  if (!isObj(j) || j.format !== LIBRARY_FORMAT) throw new Error('Not a Kekenik library bundle (format "kekenik-library").');
  if (j.version !== 1) throw new Error(`Unsupported library bundle version ${String(j.version)}.`);
  const presets = (Array.isArray(j.presets) ? j.presets : []).map(sanitizePreset).filter((p): p is NodePreset => !!p);
  const subgraphs = (Array.isArray(j.subgraphs) ? j.subgraphs : []).map(sanitizeDef).filter((d): d is SubgraphDefData => !!d);
  return { format: LIBRARY_FORMAT, version: 1, presets, subgraphs, curves: j.curves, gradients: j.gradients };
}

export class PresetStore {
  readonly onChange = new Emitter<void>();
  private user = new Map<string, NodePreset>();
  private factory: NodePreset[] = [];
  ready: Promise<void> = Promise.resolve();

  constructor(
    private backend: PresetBackend,
    factory: readonly Omit<NodePreset, 'created' | 'builtin' | 'id'>[] = [],
  ) {
    this.factory = factory.map((f, i) => ({ ...f, id: `factory:${f.folder}/${f.name}`.toLowerCase().replace(/\s+/g, '_'), builtin: true, created: i }));
  }

  /** Loads the user presets (call once; failures degrade to an empty library). */
  init(): Promise<void> {
    this.ready = this.backend
      .all()
      .then((all) => {
        this.user = new Map(all.map((p) => [p.id, p]));
        this.onChange.emit();
      })
      .catch(() => undefined);
    return this.ready;
  }

  all(): NodePreset[] {
    return [...this.factory, ...this.user.values()];
  }
  get(id: string): NodePreset | undefined {
    return this.user.get(id) ?? this.factory.find((f) => f.id === id);
  }
  folders(): string[] {
    return [...new Set(this.all().map((p) => p.folder))].sort((a, b) => a.localeCompare(b));
  }
  /** Fuzzy-ish search over name, tags, folder and node type; favourites first on ties. */
  search(query: string, o: { folder?: string; favoritesOnly?: boolean; limit?: number } = {}): NodePreset[] {
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const score = (p: NodePreset): number => {
      if (o.folder && p.folder !== o.folder) return -1;
      if (o.favoritesOnly && !p.favorite) return -1;
      if (!terms.length) return 1 + (p.favorite ? 1 : 0);
      const hay = `${p.name} ${p.folder} ${p.tags.join(' ')} ${p.nodeType}`.toLowerCase();
      let s = 0;
      for (const t of terms) {
        if (!hay.includes(t)) return -1;
        s += p.name.toLowerCase().startsWith(t) ? 6 : p.name.toLowerCase().includes(t) ? 4 : p.tags.some((x) => x.toLowerCase() === t) ? 3 : 1;
      }
      return s + (p.favorite ? 0.5 : 0);
    };
    return this.all()
      .map((p) => [p, score(p)] as const)
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1] || a[0].name.localeCompare(b[0].name))
      .slice(0, o.limit ?? 500)
      .map(([p]) => p);
  }

  async add(p: Omit<NodePreset, 'id' | 'created'> & { id?: string }): Promise<NodePreset> {
    const full: NodePreset = { ...deepClone(p), id: p.id ?? uid('pr'), created: Date.now(), builtin: undefined };
    this.user.set(full.id, full);
    await this.backend.put(full).catch(() => undefined);
    this.onChange.emit();
    return full;
  }
  async update(id: string, patch: Partial<Pick<NodePreset, 'name' | 'folder' | 'tags' | 'favorite' | 'thumbnail'>>): Promise<void> {
    const p = this.user.get(id);
    if (!p) throw new Error('Factory presets are read-only (duplicate it first).');
    Object.assign(p, patch);
    await this.backend.put(p).catch(() => undefined);
    this.onChange.emit();
  }
  /** Favourite flag works for factory presets too: it is stored as a tiny user override. */
  async toggleFavorite(id: string): Promise<void> {
    const f = this.factory.find((x) => x.id === id);
    if (f) {
      f.favorite = !f.favorite;
      this.onChange.emit();
      return;
    }
    const p = this.user.get(id);
    if (p) await this.update(id, { favorite: !p.favorite });
  }
  async remove(id: string): Promise<void> {
    if (!this.user.delete(id)) return;
    await this.backend.delete(id).catch(() => undefined);
    this.onChange.emit();
  }

  exportBundle(lib: SubgraphLibrary | null, o: { ids?: readonly string[]; curves?: unknown; gradients?: unknown } = {}): LibraryBundle {
    const ids = o.ids ? new Set(o.ids) : null;
    const presets = [...this.user.values()].filter((p) => !ids || ids.has(p.id)).map((p) => deepClone(p));
    const subs = new Map<string, SubgraphDefData>();
    for (const p of presets) if (p.subgraph) subs.set(p.subgraph.id, p.subgraph);
    return { format: LIBRARY_FORMAT, version: 1, presets, subgraphs: [...subs.values()].concat(lib && !ids ? lib.toData().filter((d) => !subs.has(d.id)) : []), curves: o.curves, gradients: o.gradients };
  }

  /** Merges a bundle: presets with new ids are added, existing ids are replaced when `overwrite`. Returns the count added / updated. */
  async importBundle(text: string, o: { overwrite?: boolean } = {}): Promise<{ presets: number; bundle: LibraryBundle }> {
    const bundle = parseLibraryBundle(text);
    let n = 0;
    for (const p of bundle.presets) {
      if (this.user.has(p.id) && !o.overwrite) continue;
      this.user.set(p.id, { ...p, builtin: undefined });
      await this.backend.put(p).catch(() => undefined);
      n++;
    }
    this.onChange.emit();
    return { presets: n, bundle };
  }
}

/** Snapshot a node as a preset (the caller adds the thumbnail). */
export function presetFromNode(graph: Graph, nodeId: string, lib: SubgraphLibrary | null, meta: { name: string; folder?: string; tags?: string[]; thumbnail?: string }): Omit<NodePreset, 'id' | 'created'> {
  const n = graph.nodes.get(nodeId);
  if (!n) throw new Error('No such node.');
  const defId = instanceDefId(n.type);
  const sg = defId && lib?.get(defId);
  return {
    name: meta.name,
    folder: meta.folder || 'My Presets',
    tags: meta.tags ?? [],
    nodeType: n.type,
    typeVersion: n.typeVersion,
    params: deepClone(n.params),
    anim: n.anim ? deepClone(n.anim) : undefined,
    thumbnail: meta.thumbnail,
    subgraph: sg ? deepClone(sg) : undefined,
  };
}

/** Creates a node from a preset in ONE undo step. Unknown params are dropped, values are coerced. */
export function spawnPreset(editor: GraphEditor, lib: SubgraphLibrary | null, preset: NodePreset, pos: { x: number; y: number }): string {
  const g = editor.graph;
  if (preset.subgraph && lib && !lib.has(preset.subgraph.id)) lib.put(preset.subgraph);
  const ex = g.registry.expanded(preset.nodeType);
  if (!ex) throw new Error(`This preset needs the node type "${preset.nodeType}", which is not available.`);
  const params: ParamValues = {};
  for (const [k, v] of Object.entries(preset.params)) {
    const def = ex.params.find((p) => p.id === k);
    if (def) params[k] = coerceParam(def, v);
  }
  return editor.stack.transaction(`Add preset “${preset.name}”`, () => {
    const id = editor.addNode(preset.nodeType, { x: pos.x, y: pos.y, name: preset.name, params });
    if (preset.anim) for (const [pid, tr] of Object.entries(preset.anim)) if (ex.params.some((p) => p.id === pid)) g.setNodeTrack(id, pid, deepClone(tr));
    return id;
  });
}

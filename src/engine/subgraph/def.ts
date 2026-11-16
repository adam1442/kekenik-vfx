import { deepClone } from '../../shared/util';
import type { GraphData, NodeData } from '../graph/graph';
import type { NodeDefinition } from '../graph/node';
import type { NodeRegistry } from '../graph/registry';
import type { PinDef } from '../graph/pins';
import type { ParamDef, ParamValue } from '../params/schema';
import type { PinType } from '../types';

/**
 * Subgraph DEFINITIONS.
 *
 * A definition is a normal graph (`graph`) that contains BOUNDARY nodes (`subgraph.in_<type>` / `subgraph.out_<type>`)
 * plus the list of EXPOSED parameters (promoted inner params). Every definition is registered in the NodeRegistry as a
 * real node type `subgraph.<id>` whose pins come from the boundary nodes and whose params are the exposed ones, so the
 * node library, search, Properties, undo, copy/paste and project IO treat an instance like any other node.
 * Instances SHARE the definition (by id); `utils: unlink to unique` clones it. Evaluation flattens instances (flatten.ts).
 */

export const SUBGRAPH_PREFIX = 'subgraph.';
export const BOUNDARY_IN = 'subgraph.in_';
export const BOUNDARY_OUT = 'subgraph.out_';
/** Pin types a subgraph interface can carry. */
export const BOUNDARY_TYPES: PinType[] = ['gray', 'color', 'normal', 'uv', 'mesh', 'points', 'spline'];
/** Hard limits: protect against pathological / recursive projects. */
export const SUBGRAPH_LIMITS = { maxDepth: 12, maxDefs: 2000 } as const;

export interface ExposedParam {
  /** Param id on the instance node. STABLE (stored in projects). */
  id: string;
  /** Inner node id + param id this value drives. */
  node: string;
  param: string;
  label: string;
  group: string;
  min?: number;
  max?: number;
  default?: ParamValue;
  tooltip?: string;
}

export interface SubgraphDefData {
  format?: 'kekenik-subgraph';
  /** `sg_<random>`; the registered node type is `subgraph.<id>`. */
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  /** Folder in the user library. */
  folder?: string;
  /** Counts edits of the definition (shown in the UI; instances always follow the latest). */
  version: number;
  created: string;
  modified: string;
  graph: GraphData;
  exposed: ExposedParam[];
}

export interface BoundaryPin {
  /** Boundary node id == the pin id on instances. */
  id: string;
  name: string;
  type: PinType;
  order: number;
}

export const defTypeId = (id: string): string => `${SUBGRAPH_PREFIX}${id}`;
export const instanceDefId = (type: string): string | null => (type.startsWith('subgraph.sg_') ? type.slice(SUBGRAPH_PREFIX.length) : null);
export const isBoundaryIn = (type: string): boolean => type.startsWith(BOUNDARY_IN);
export const isBoundaryOut = (type: string): boolean => type.startsWith(BOUNDARY_OUT);
export const isBoundary = (type: string): boolean => isBoundaryIn(type) || isBoundaryOut(type);
export const boundaryTypeOf = (type: string): PinType => type.slice(isBoundaryIn(type) ? BOUNDARY_IN.length : BOUNDARY_OUT.length) as PinType;

/** Interface of a graph: the boundary nodes sorted by their `order` param, then position. */
export function boundaryPins(nodes: readonly NodeData[]): { inputs: BoundaryPin[]; outputs: BoundaryPin[] } {
  const pick = (test: (t: string) => boolean): BoundaryPin[] =>
    nodes
      .filter((n) => test(n.type))
      .map((n) => ({
        id: n.id,
        name: typeof n.params.name === 'string' && n.params.name ? n.params.name : n.name,
        type: boundaryTypeOf(n.type),
        order: typeof n.params.order === 'number' ? n.params.order : 0,
        y: n.y,
      }))
      .sort((a, b) => a.order - b.order || a.y - b.y || a.id.localeCompare(b.id))
      .map(({ y: _y, ...rest }) => rest);
  return { inputs: pick(isBoundaryIn), outputs: pick(isBoundaryOut) };
}

/** Exposed ParamDef = the inner param definition re-labelled / re-ranged. */
export function exposedParamDef(base: ParamDef, e: ExposedParam): ParamDef {
  const d: Record<string, unknown> = { ...base, id: e.id, label: e.label || base.label, group: e.group || 'Exposed', tab: 'Main' };
  if (e.tooltip) d.tooltip = e.tooltip;
  delete d.visibleIf;
  delete d.showWhenConnected;
  delete d.modulatable;
  if (e.default !== undefined) d.default = deepClone(e.default);
  if (base.type === 'float' || base.type === 'int') {
    if (e.min !== undefined && Number.isFinite(e.min)) {
      d.min = e.min;
      d.softMin = e.min;
    }
    if (e.max !== undefined && Number.isFinite(e.max)) {
      d.max = e.max;
      d.softMax = e.max;
    }
  }
  return d as unknown as ParamDef;
}

/** Looks the inner ParamDef of an exposed param up (undefined when the inner node / param no longer exists). */
export function innerParamDef(def: SubgraphDefData, e: ExposedParam, registry: NodeRegistry): ParamDef | undefined {
  const n = def.graph.nodes.find((x) => x.id === e.node);
  return n ? registry.expanded(n.type)?.params.find((p) => p.id === e.param) : undefined;
}

/** The runtime node definition of a subgraph. Never evaluated directly: instances are flattened first (flatten.ts). */
export function nodeDefinitionFor(def: SubgraphDefData, registry: NodeRegistry): NodeDefinition {
  const { inputs, outputs } = boundaryPins(def.graph.nodes);
  const params: ParamDef[] = [];
  for (const e of def.exposed) {
    const base = innerParamDef(def, e, registry);
    if (base) params.push(exposedParamDef(base, e));
  }
  const pinIn: PinDef[] = inputs.map((p) => ({ id: p.id, name: p.name, type: p.type, optional: true, tooltip: `Subgraph input "${p.name}". Unconnected: the default constant of the Input node inside is used.` }));
  const pinOut: PinDef[] = outputs.map((p) => ({ id: p.id, name: p.name, type: p.type }));
  // A definition without Output nodes still needs one pin (registry rule); evaluation of such an instance reports a clear error.
  if (!pinOut.length) pinOut.push({ id: '__no_output', name: '(no output)', type: 'gray' });
  return {
    id: defTypeId(def.id),
    version: 1, // the registered version is constant: edits of the definition never trigger per-node param migrations
    category: 'subgraph',
    title: def.name || 'Subgraph',
    description: def.description || `Subgraph "${def.name}" (v${def.version}, ${def.graph.nodes.length} nodes). Double-click to enter.`,
    keywords: ['subgraph', 'group', ...(def.tags ?? [])],
    icon: 'cat-subgraph',
    inputs: pinIn,
    outputs: pinOut,
    params,
    common: { texture: false, blending: false },
    cost: { gpu: 'low', tiling: 'global' },
    evaluate() {
      throw new Error(outputs.length ? 'Subgraph instance reached the evaluator without being flattened (recursive subgraph?).' : 'This subgraph has no Output node.');
    },
    migrateParams: (old) => old,
  };
}

/** Structural signature of the interface: when it changes the registry definition must be rebuilt (pins / params). */
export function interfaceSignature(def: SubgraphDefData, registry: NodeRegistry): string {
  const d = nodeDefinitionFor(def, registry);
  return JSON.stringify([d.title, d.description, def.tags, d.inputs.map((p) => [p.id, p.name, p.type]), d.outputs.map((p) => [p.id, p.name, p.type]), d.params.map((p) => JSON.stringify(p))]);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Validates untrusted JSON (project file, library bundle). Returns null when unusable. */
export function sanitizeDef(raw: unknown): SubgraphDefData | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !/^sg_[a-z0-9_]+$/.test(raw.id)) return null;
  const g = raw.graph;
  if (!isObj(g) || !Array.isArray(g.nodes) || !Array.isArray(g.links) || !isObj(g.settings)) return null;
  const now = new Date().toISOString();
  const exposed: ExposedParam[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.exposed)) {
    for (const e of raw.exposed) {
      if (!isObj(e) || typeof e.id !== 'string' || typeof e.node !== 'string' || typeof e.param !== 'string' || seen.has(e.id)) continue;
      seen.add(e.id);
      exposed.push({
        id: e.id,
        node: e.node,
        param: e.param,
        label: typeof e.label === 'string' ? e.label : e.param,
        group: typeof e.group === 'string' ? e.group : 'Exposed',
        min: typeof e.min === 'number' ? e.min : undefined,
        max: typeof e.max === 'number' ? e.max : undefined,
        default: e.default as ParamValue | undefined,
        tooltip: typeof e.tooltip === 'string' ? e.tooltip : undefined,
      });
    }
  }
  return {
    format: 'kekenik-subgraph',
    id: raw.id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : 'Subgraph',
    description: typeof raw.description === 'string' ? raw.description : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').slice(0, 24) : undefined,
    folder: typeof raw.folder === 'string' ? raw.folder : undefined,
    version: Number.isInteger(raw.version) && (raw.version as number) >= 1 ? (raw.version as number) : 1,
    created: typeof raw.created === 'string' ? raw.created : now,
    modified: typeof raw.modified === 'string' ? raw.modified : now,
    graph: deepClone(g as unknown as GraphData),
    exposed,
  };
}

import { Graph, type GraphData } from '../graph/graph';
import type { SubgraphDefData } from '../subgraph/def';
import type { NodeRegistry } from '../graph/registry';

/**
 * Versioned project file (JSON). Asset blobs (imported textures/models) are stored beside it (IndexedDB / file
 * bundle) and referenced by id in `assets`; the JSON itself is always plain text.
 *
 * Migration: MIGRATIONS[n] upgrades a project from version n to n+1 (pure function on parsed JSON). Loading runs
 * them in sequence. Node PARAM migrations are separate (NodeDefinition.migrateParams, applied by Graph.fromData).
 */
export const PROJECT_FORMAT = 'kekenik-vfx';
export const PROJECT_VERSION = 2;

export interface AssetMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  app: { name: string; version: string };
  name: string;
  created: string;
  modified: string;
  graph: GraphData;
  assets: AssetMeta[];
  /** Workspace layout, viewport state, selection... owned by the UI; opaque to the engine. */
  ui?: Record<string, unknown>;
  /** Timeline / keyframes. Opaque to the engine for now. */
  animation?: unknown;
  /** v2: shared subgraph definitions used by the graph (instances reference them by id). */
  subgraphs?: SubgraphDefData[];
  /** v2: asset blobs embedded as base64 (self-contained project bundle); restored into the AssetStore on load. */
  assetBlobs?: Record<string, string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MIGRATIONS: Record<number, (p: any) => any> = {
  // v1 -> v2: subgraph library + embedded asset blobs.
  1: (p) => ({ ...p, subgraphs: Array.isArray(p.subgraphs) ? p.subgraphs : [], assets: Array.isArray(p.assets) ? p.assets : [] }),
};

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectError';
  }
}

export function migrateProject(json: unknown, migrations = MIGRATIONS, current = PROJECT_VERSION): { project: ProjectFile; migratedFrom?: number } {
  if (!json || typeof json !== 'object') throw new ProjectError('Not a project file (not an object).');
  let p = json as Record<string, unknown>;
  if (p.format !== PROJECT_FORMAT) throw new ProjectError(`Not a Kekenik project (format "${String(p.format)}").`);
  const from = Number(p.version);
  if (!Number.isInteger(from) || from < 1) throw new ProjectError('Invalid project version.');
  if (from > current) throw new ProjectError(`Project was saved by a newer version (v${from}); this app supports up to v${current}.`);
  let v = from;
  while (v < current) {
    const m = migrations[v];
    if (!m) throw new ProjectError(`No migration from project version ${v}.`);
    p = m(p) as Record<string, unknown>;
    v++;
    p.version = v;
  }
  const graph = p.graph as GraphData | undefined;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.links) || typeof graph.settings !== 'object') {
    throw new ProjectError('Project has no valid graph.');
  }
  const project = p as unknown as ProjectFile;
  project.assets ??= [];
  return { project, migratedFrom: from < current ? from : undefined };
}

export function serializeProject(graph: Graph, meta: { name?: string; created?: string; assets?: AssetMeta[]; ui?: Record<string, unknown>; animation?: unknown; subgraphs?: SubgraphDefData[]; assetBlobs?: Record<string, string> } = {}): ProjectFile {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    app: { name: 'Kekenik VFX', version: '0.1.0' },
    name: meta.name ?? 'Untitled',
    created: meta.created ?? now,
    modified: now,
    graph: graph.toData(),
    assets: meta.assets ?? [],
    ui: meta.ui,
    animation: meta.animation,
    subgraphs: meta.subgraphs?.length ? meta.subgraphs : undefined,
    assetBlobs: meta.assetBlobs && Object.keys(meta.assetBlobs).length ? meta.assetBlobs : undefined,
  };
}

/** `beforeGraph` runs after migration and BEFORE the graph is built: the place to register the project's subgraph definitions. */
export function deserializeProject(registry: NodeRegistry, json: unknown, beforeGraph?: (project: ProjectFile) => void): { graph: Graph; project: ProjectFile; warnings: string[]; migratedFrom?: number } {
  const { project, migratedFrom } = migrateProject(json);
  beforeGraph?.(project);
  const { graph, warnings } = Graph.fromData(registry, project.graph);
  return { graph, project, warnings, migratedFrom };
}

export const projectToJson = (p: ProjectFile): string => JSON.stringify(p);
export const projectFromJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new ProjectError(`Project file is not valid JSON: ${(e as Error).message}`);
  }
};

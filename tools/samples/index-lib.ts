import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NodeRegistry } from '../../src/engine/graph/registry';
import type { ProjectFile } from '../../src/engine/io/project';
import { hashString } from '../../src/shared/util';

/**
 * `samples/index.json` computation. The index is DERIVED data: nodes used, features, memory estimate and a content hash
 * are computed from `graph.kekenik.json` + `sample.json`; everything else is copied from `sample.json`.
 * Used by `npm run samples:gen` / `samples:index` (tests/samples-gen.test.ts) and verified by tests/samples-validate.test.ts.
 */
export const SAMPLES_DIR = join(process.cwd(), 'samples');
export const GRAPH_FILE = 'graph.kekenik.json';
export const META_FILE = 'sample.json';

export type { IndexEntry, SampleMeta } from '../../src/samples/types';
import type { IndexEntry, SampleMeta } from '../../src/samples/types';

const QUALITY_RES: Record<string, number> = { draft: 128, balanced: 256, high: 384, ultra: 512 };
const MB = 1024 * 1024;

/** Rough peak GPU memory (MB): live textures at 8 B/px (RGBA16F worst case) + simulation state + flipbook sheets. */
export function estimateMemoryMB(registry: NodeRegistry, project: ProjectFile): number {
  const { width: w, height: h } = project.graph.settings;
  const px = w * h * 8;
  let tex = 0;
  let extra = 0;
  for (const n of project.graph.nodes) {
    const def = registry.get(n.type);
    if (!def) continue;
    if (def.outputs.some((o) => o.type === 'gray' || o.type === 'color' || o.type === 'normal' || o.type === 'uv' || o.type === 'vector')) tex++;
    const p = n.params as Record<string, unknown>;
    if (def.simulation) {
      const res = p.quality && p.quality !== 'custom' ? (QUALITY_RES[String(p.quality)] ?? 256) : Number(p.sim_res ?? 256);
      extra += res * res * 8 * (n.type === 'simulation.fluid2d' ? 8 : 4) + Number(p.cache_mb ?? 64) * MB;
    }
    if (n.type === 'utils.sheet_encode') extra += Number(p.cols) * Number(p.rows) * px;
  }
  return Math.round(((px * (2 + tex * 0.25) + extra) / MB) * 10) / 10;
}

export function computeEntry(registry: NodeRegistry, folder: string, dir = SAMPLES_DIR): IndexEntry {
  const graphText = readFileSync(join(dir, folder, GRAPH_FILE), 'utf8');
  const meta = JSON.parse(readFileSync(join(dir, folder, META_FILE), 'utf8')) as SampleMeta;
  const project = JSON.parse(graphText) as ProjectFile;
  const types = [...new Set(project.graph.nodes.map((n) => n.type))].sort();
  const flip = project.graph.nodes.some((n) => n.type === 'utils.sheet_encode' || (n.type.startsWith('export.') && (n.params as Record<string, unknown>).frame_mode === 'flipbook'));
  return {
    id: meta.id,
    version: meta.version,
    folder,
    category: meta.category,
    tags: meta.tags,
    difficulty: meta.difficulty,
    features: {
      loops: meta.loops === true,
      tileable: project.graph.settings.tiling !== 'none',
      mesh: types.some((t) => registry.get(t)?.outputs.some((o) => o.type === 'mesh') === true),
      simulation: types.some((t) => registry.get(t)?.simulation === true),
      flipbook: flip,
      exportReady: project.graph.nodes.some((n) => n.type.startsWith('export.') && (n.params as Record<string, unknown>).enabled !== false),
    },
    nodesUsed: types,
    nodeCount: project.graph.nodes.length,
    resolution: [project.graph.settings.width, project.graph.settings.height],
    memoryMB: estimateMemoryMB(registry, project),
    hash: (hashString(graphText) >>> 0).toString(16) + (hashString(graphText, 7) >>> 0).toString(16),
    created: meta.created,
  };
}

export const sampleFolders = (dir = SAMPLES_DIR): string[] => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(dir, d.name, META_FILE))).map((d) => d.name).sort() : []);

export function buildIndex(registry: NodeRegistry, dir = SAMPLES_DIR): { version: number; samples: IndexEntry[] } {
  return { version: 1, samples: sampleFolders(dir).map((f) => computeEntry(registry, f, dir)) };
}
export const writeIndex = (registry: NodeRegistry, dir = SAMPLES_DIR): void => writeFileSync(join(dir, 'index.json'), JSON.stringify(buildIndex(registry, dir), null, 1) + '\n');

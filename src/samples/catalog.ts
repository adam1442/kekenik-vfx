import type { GraphData } from '../engine/graph/graph';
import { emptyAnnotations } from '../engine/graph/annotations';
import { localizeFrames, tourFrames } from './localize';
import type { IndexEntry, SampleIndex, SampleMeta } from './types';
import indexJson from '../../samples/index.json';

/**
 * File-based sample catalog. The tiny index (`samples/index.json`) is bundled; each sample's metadata and graph are
 * lazy chunks that are only fetched when the sample is shown / opened. Opening a sample only parses JSON: nothing is evaluated
 * until a node is viewed.
 */
const metaLoaders = import.meta.glob('../../samples/*/sample.json', { import: 'default' }) as Record<string, () => Promise<SampleMeta>>;
const graphLoaders = import.meta.glob('../../samples/*/graph.kekenik.json', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;

export const SAMPLE_INDEX: SampleIndex = indexJson as unknown as SampleIndex;
export const indexEntry = (id: string): IndexEntry | undefined => SAMPLE_INDEX.samples.find((s) => s.id === id);

const metaCache = new Map<string, SampleMeta>();
export async function loadMeta(id: string): Promise<SampleMeta> {
  const hit = metaCache.get(id);
  if (hit) return hit;
  const load = metaLoaders[`../../samples/${id}/sample.json`];
  if (!load) throw new Error(`Unknown sample "${id}"`);
  const m = await load();
  metaCache.set(id, m);
  return m;
}
export async function loadGraphText(id: string): Promise<string> {
  const load = graphLoaders[`../../samples/${id}/graph.kekenik.json`];
  if (!load) throw new Error(`Unknown sample "${id}"`);
  return load();
}

export interface PreparedSample {
  /** Project JSON ready for `project.loadText`. */
  text: string;
  meta: SampleMeta;
}
/** Builds the project text for opening: localized frame titles, optional tour frames, project name. */
export async function prepareSample(id: string, opts: { lang: string; name: string; tour: boolean; digits: (n: number) => string; tourColor: string }): Promise<PreparedSample> {
  const [meta, raw] = await Promise.all([loadMeta(id), loadGraphText(id)]);
  const project = JSON.parse(raw) as { name: string; graph: GraphData };
  localizeFrames(project.graph, meta, opts.lang);
  if (opts.tour) {
    const frames = tourFrames(project.graph, meta, opts.lang, opts.digits, opts.tourColor);
    const ann = project.graph.annotations ?? (project.graph.annotations = emptyAnnotations());
    ann.frames = [...ann.frames, ...frames];
  }
  project.name = opts.name;
  return { text: JSON.stringify(project), meta };
}

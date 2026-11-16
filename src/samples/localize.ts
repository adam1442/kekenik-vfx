import type { FrameData } from '../engine/graph/annotations';
import type { GraphData } from '../engine/graph/graph';
import type { SampleMeta, SampleTexts } from './types';

/**
 * Pure helpers (no DOM, no GPU) of the file-based samples: language selection, comment-frame titles and the numbered
 * "graph tour" frames. All human-readable text comes from the sample's own `sample.json` (i18n en + fa).
 */
export const textsOf = (meta: SampleMeta, lang: string): SampleTexts => (lang === 'fa' ? meta.i18n.fa : meta.i18n.en);

/** Applies the frame titles of `lang` to the graph data in place (frames without an entry keep their stored English title). */
export function localizeFrames(graph: GraphData, meta: SampleMeta, lang: string): void {
  const titles = textsOf(meta, lang).frames;
  for (const f of graph.annotations?.frames ?? []) if (titles[f.id]) f.title = titles[f.id];
}

/** Tour frame (numbered comment frame) around each key node, in the language of the UI. Added only on "Show in graph tour". */
export function tourFrames(graph: GraphData, meta: SampleMeta, lang: string, digits: (n: number) => string, color: string): FrameData[] {
  const texts = textsOf(meta, lang).tour;
  const out: FrameData[] = [];
  (meta.tour ?? []).forEach((step, i) => {
    const n = graph.nodes.find((x) => x.id === step.node);
    if (!n || !texts[step.key]) return;
    out.push({ id: `tour_${i + 1}`, x: n.x - 14, y: n.y - 44, w: 250, h: 220, title: `${digits(i + 1)} · ${texts[step.key]}`, color });
  });
  return out;
}

/** Search haystack of a sample (both languages, so an English query finds Persian-UI users' samples too). */
export const searchText = (meta: SampleMeta, nodes: string[]): string =>
  [meta.id, ...meta.tags, ...nodes, ...(['en', 'fa'] as const).flatMap((l) => [meta.i18n[l].name, ...Object.values(meta.i18n[l].tags)])].join(' ').toLowerCase();

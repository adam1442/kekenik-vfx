/** Data model of the file-based sample library (`samples/<id>/graph.kekenik.json` + `sample.json`, `samples/index.json`). . */
export const SAMPLE_CATEGORIES = ['fire', 'magic', 'energy', 'weapons', 'water', 'lightning', 'environment', 'tiling', 'flipbooks', 'meshes', 'simulation', 'beginner'] as const;
export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];
export const SAMPLE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const;
export type SampleDifficulty = (typeof SAMPLE_DIFFICULTIES)[number];
export const SAMPLE_LANGS = ['en', 'fa'] as const;

export interface SampleTexts {
  name: string;
  description: string;
  adapt: string;
  /** tag id -> display text */
  tags: Record<string, string>;
  /** comment frame id -> title */
  frames: Record<string, string>;
  /** tour step key -> explanation */
  tour: Record<string, string>;
}
export interface SampleMeta {
  id: string;
  version: number;
  category: string[];
  tags: string[];
  difficulty: SampleDifficulty;
  loops?: boolean;
  /** false: the graph has its own (tutorial) frames only. */
  roleFrames?: boolean;
  /** Node id shown first. */
  preview: string;
  /** Node / pin / frame used for the Home thumbnail. */
  thumb: { node: string; pin?: string; frame?: number };
  /** 3D viewport targets (node ids). */
  view?: { mesh?: string; material?: string; mat?: Record<string, unknown>; display?: string };
  tour?: { node: string; key: string }[];
  /** ISO date (YYYY-MM-DD), drives the "newest" sort. */
  created: string;
  i18n: Record<(typeof SAMPLE_LANGS)[number], SampleTexts>;
}
export interface IndexEntry {
  id: string;
  version: number;
  folder: string;
  category: string[];
  tags: string[];
  difficulty: SampleDifficulty;
  features: { loops: boolean; tileable: boolean; mesh: boolean; simulation: boolean; flipbook: boolean; exportReady: boolean };
  nodesUsed: string[];
  nodeCount: number;
  resolution: [number, number];
  memoryMB: number;
  /** Content hash of the graph file: part of the thumbnail cache key. */
  hash: string;
  created: string;
}
export interface SampleIndex {
  version: number;
  samples: IndexEntry[];
}

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { projectToJson, serializeProject } from '../src/engine/io/project';
import { MESH_SAMPLES } from '../tools/samples/s-mesh';
import { SIM_SAMPLES } from '../tools/samples/s-sim';
import { TEX_SAMPLES } from '../tools/samples/s-tex';
import { GRAPH_FILE, META_FILE, SAMPLES_DIR, writeIndex, type SampleMeta } from '../tools/samples/index-lib';
import { ROLES, S, TAGS, type SampleSpec } from '../tools/samples/kit';
import { makeRegistry } from './helpers';

/**
 * Sample generator: `npm run samples:gen` (GEN_SAMPLES=1) authors every sample in tools/samples/*.ts, writes
 * samples/<id>/graph.kekenik.json + sample.json and regenerates samples/index.json. `npm run samples:index` (GEN_SAMPLES=index)
 * only recomputes the index from the committed files. Without the variable this file does nothing (normal `npm test`).
 */
const MODE = process.env.GEN_SAMPLES;
const ALL: SampleSpec[] = [...SIM_SAMPLES, ...MESH_SAMPLES, ...TEX_SAMPLES];
const CREATED = '2026-02-01';
const STAMP = '2026-02-01T00:00:00.000Z';

it.skipIf(!MODE)('generate samples', () => {
  const registry = makeRegistry();
  if (MODE === '1') {
    for (const spec of ALL) {
      const s = new S(registry, spec);
      spec.build(s);
      const frames = s.finish();
      for (const k of [spec.preview, spec.thumb.node, ...(spec.tour ?? []).map((t) => t.node), ...Object.values(spec.view ?? {}).filter((v): v is string => typeof v === 'string' && !!s.g.nodes.size && !['unlit', 'pbr'].includes(v))]) {
        if (typeof k === 'string' && !s.g.nodes.has(k) && !['additive', 'alpha'].includes(k)) throw new Error(`[${spec.id}] unknown node key "${k}"`);
      }
      const project = serializeProject(s.g, { name: spec.name.en });
      project.created = STAMP;
      project.modified = STAMP;
      const dir = join(SAMPLES_DIR, spec.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, GRAPH_FILE), projectToJson(project));
      const tx = (lang: 'en' | 'fa'): SampleMeta['i18n']['en'] => ({
        name: spec.name[lang],
        description: spec.description[lang],
        adapt: spec.adapt[lang],
        tags: Object.fromEntries(spec.tags.map((t) => [t, TAGS[t][lang]])),
        frames: Object.fromEntries(
          frames.map((f) => {
            const role = f.id.slice(2) as keyof typeof ROLES;
            return [f.id, ROLES[role]?.title[lang] ?? spec.frames?.[role]?.[lang] ?? f.title];
          }),
        ),
        tour: Object.fromEntries((spec.tour ?? []).map((t, i) => [`step${i + 1}`, t.text[lang]])),
      });
      const meta: SampleMeta = {
        id: spec.id, version: 1, category: spec.category, tags: spec.tags, difficulty: spec.difficulty, loops: spec.loops, roleFrames: spec.roleFrames,
        preview: spec.preview, thumb: spec.thumb, view: spec.view, tour: (spec.tour ?? []).map((t, i) => ({ node: t.node, key: `step${i + 1}` })), created: CREATED,
        i18n: { en: tx('en'), fa: tx('fa') },
      };
      writeFileSync(join(dir, META_FILE), JSON.stringify(meta, null, 1) + '\n');
    }
  }
  writeIndex(registry);
});

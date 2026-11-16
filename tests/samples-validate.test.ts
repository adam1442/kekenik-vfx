import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { isAnimatableDef } from '../src/engine/anim/tracks';
import { buildPlan } from '../src/engine/graph/plan';
import { validateGraph } from '../src/engine/graph/validate';
import { PROJECT_VERSION, migrateProject, type ProjectFile } from '../src/engine/io/project';
import { loadProjectRobust } from '../src/engine/io/robust-load';
import { coerceParam } from '../src/engine/params/schema';
import type { NodeRegistry } from '../src/engine/graph/registry';
import { localizeFrames, textsOf, tourFrames } from '../src/samples/localize';
import { SAMPLE_CATEGORIES, SAMPLE_DIFFICULTIES, type IndexEntry, type SampleIndex, type SampleMeta } from '../src/samples/types';
import { GRAPH_FILE, META_FILE, SAMPLES_DIR, buildIndex, sampleFolders } from '../tools/samples/index-lib';
import { makeRegistry } from './helpers';

/**
 * CPU-side validation of EVERY file-based sample. No GPU: this proves that each sample is structurally sound — all node
 * types exist, links connect compatible pins, no cycles, params and keyframes lie inside their ranges, assets exist, settings are
 * sane, the project survives the migration pipeline, the registry is up to date and the metadata is complete in English and Persian.
 * The GPU part (evaluation, timing, memory) is the development GPU harness (`/#selftest` on `npm run dev`) -> "Evaluate all samples".
 */
const EXPECTED = [
  'campfire_loop', 'smoke_puff_loop', 'fireball_explosion', 'ink_in_water', 'wind_wisps', 'magic_vortex_portal', 'water_ripples_normal', 'alien_skin_tileable',
  'burn_dissolve_reveal', 'heat_haze_distortion', 'motion_vector_showcase', 'lightning_strike', 'energy_beam_mesh', 'sword_slash_arc', 'shockwave_ring', 'shield_bubble',
  'magic_rune_circle', 'tileable_lava_energy', 'sprite_pack', 'hit_impact_decals', 'hello_nodes', 'tiling_check_tutorial',
];
const ENGINES = new Set(['none', 'unreal', 'unity', 'godot']);
const PERSIAN = /[\u0600-\u06FF]/;
const read = <T>(f: string, file: string): T => JSON.parse(readFileSync(join(SAMPLES_DIR, f, file), 'utf8')) as T;

let registry: NodeRegistry;
let index: SampleIndex;
const folders = sampleFolders();
beforeAll(() => {
  registry = makeRegistry();
  index = JSON.parse(readFileSync(join(SAMPLES_DIR, 'index.json'), 'utf8')) as SampleIndex;
});

describe('sample library', () => {
  it('contains all 22 expected samples and nothing unregistered', () => {
    expect(folders).toEqual([...EXPECTED].sort());
    expect(index.samples.map((s) => s.id).sort()).toEqual([...EXPECTED].sort());
  });
  it('samples/index.json is up to date (run `npm run samples:index`)', () => {
    expect(index).toEqual(buildIndex(registry));
  });
  it('index entries are well-formed and bounded', () => {
    for (const e of index.samples) {
      expect(e.folder).toBe(e.id);
      expect(SAMPLE_DIFFICULTIES).toContain(e.difficulty);
      expect(e.category.length).toBeGreaterThan(0);
      for (const c of e.category) expect(SAMPLE_CATEGORIES as readonly string[]).toContain(c);
      expect(e.nodesUsed.length).toBeGreaterThan(0);
      for (const t of e.nodesUsed) expect(registry.has(t), `${e.id}: ${t}`).toBe(true);
      expect(e.memoryMB, `${e.id} memory estimate`).toBeLessThan(400);
      expect(e.hash).toMatch(/^[0-9a-f]+$/);
    }
  });
});

describe.each(folders)('sample %s', (id) => {
  const text = (): string => readFileSync(join(SAMPLES_DIR, id, GRAPH_FILE), 'utf8');
  const project = (): ProjectFile => JSON.parse(text()) as ProjectFile;
  const meta = (): SampleMeta => read<SampleMeta>(id, META_FILE);
  const entry = (): IndexEntry => index.samples.find((s) => s.id === id)!;

  it('loads through the migration pipeline without repairs or warnings', () => {
    const { project: p } = migrateProject(JSON.parse(text()));
    expect(p.version).toBe(PROJECT_VERSION);
    const r = loadProjectRobust(registry, text());
    expect(r.repairs).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.graph.nodes.size).toBe(project().graph.nodes.length);
    expect(r.graph.links.size).toBe(project().graph.links.length);
  });

  it('graph is valid: node types exist, links compatible, single link per input, no cycles, required inputs connected', () => {
    const r = loadProjectRobust(registry, text());
    expect(validateGraph(r.graph)).toEqual([]);
  });

  it('every parameter (and every keyframe) is inside its range and animatable where animated', () => {
    for (const n of project().graph.nodes) {
      const ex = registry.expanded(n.type)!;
      expect(n.typeVersion, `${n.id} typeVersion`).toBe(ex.def.version);
      for (const [k, v] of Object.entries(n.params)) {
        const def = ex.params.find((p) => p.id === k);
        expect(def, `${n.id}: unknown param ${k}`).toBeTruthy();
        if (['float', 'int', 'bool', 'enum', 'vec2', 'vec3', 'seed', 'color'].includes(def!.type)) expect(coerceParam(def!, v), `${n.id}.${k}`).toEqual(v);
      }
      for (const [k, track] of Object.entries(n.anim ?? {})) {
        const def = ex.params.find((p) => p.id === k);
        expect(def && isAnimatableDef(def), `${n.id}.${k} must be animatable`).toBe(true);
        if (track.kind !== 'num') continue;
        track.ch.forEach((ch, c) => {
          for (const key of ch.keys) {
            expect(Number.isFinite(key.v) && Number.isFinite(key.t) && key.t >= 0, `${n.id}.${k} key`).toBe(true);
            if (def!.type === 'float' || def!.type === 'int') {
              const d = def as { min?: number; max?: number };
              expect(key.v >= (d.min ?? -Infinity) && key.v <= (d.max ?? Infinity), `${n.id}.${k}[${c}] value ${key.v}`).toBe(true);
            }
          }
        });
      }
    }
  });

  it('the evaluation plan builds for every node at small and full size (deterministic hashes, no plan errors)', () => {
    const r = loadProjectRobust(registry, text());
    const ids = [...r.graph.nodes.keys()];
    for (const scale of [0.25, 1]) {
      const a = buildPlan(r.graph, ids, { time: 0, scale, maxDim: 8192 });
      const b = buildPlan(r.graph, ids, { time: 0, scale, maxDim: 8192 });
      expect(a.order.length).toBe(ids.length);
      for (const pn of a.nodes.values()) {
        expect(pn.error, `${pn.id} plan error`).toBeUndefined();
        expect(pn.frame.width).toBeGreaterThan(0);
        expect(pn.frame.height).toBeGreaterThan(0);
        expect(pn.hash).toBe(b.nodes.get(pn.id)!.hash);
      }
    }
  });

  it('graph settings are sane and fast to open', () => {
    const s = project().graph.settings;
    expect([256, 512, 1024]).toContain(s.width);
    expect(s.height).toBe(s.width);
    if (s.width === 1024) expect(['sprite_pack']).toContain(id); // 1024 only for texture-focused samples
    expect(s.bitDepth).toBe(16);
    expect(s.fps).toBeGreaterThanOrEqual(24);
    expect(s.fps).toBeLessThanOrEqual(60);
    expect(s.loopLength).toBeGreaterThanOrEqual(4);
    expect(s.loopLength).toBeLessThanOrEqual(240);
  });

  it('references only existing assets and embeds no heavy data', () => {
    const p = project();
    const assetIds = new Set((p.assets ?? []).map((a) => a.id));
    for (const n of p.graph.nodes) for (const v of Object.values(n.params)) if (v && typeof v === 'object' && 'assetId' in v) expect(assetIds.has((v as { assetId: string }).assetId), n.id).toBe(true);
    expect(p.assetBlobs ?? {}).toEqual({});
    expect(text().length).toBeLessThan(80_000);
  });

  it('simulation nodes use bounded quality; looping simulation samples loop with the timeline', () => {
    const p = project();
    const loopLength = p.graph.settings.loopLength;
    for (const n of p.graph.nodes) {
      if (!registry.get(n.type)?.simulation) continue;
      const q = n.params as Record<string, unknown>;
      if (n.type === 'simulation.fluid2d') expect(['draft', 'balanced'], `${n.id} quality`).toContain(q.quality);
      else expect(Number(q.sim_res)).toBeLessThanOrEqual(512);
      expect(Number(q.warmup)).toBeLessThanOrEqual(240);
      expect(Number(q.cache_mb)).toBeLessThanOrEqual(128);
      expect(q.paused).toBe(false);
      if (entry().features.loops && 'loop_mode' in q) {
        expect(['crossfade', 'periodic'], `${n.id} must loop`).toContain(q.loop_mode);
        expect(q.loop_frames, `${n.id} loop_frames`).toBe(loopLength);
      }
    }
  });

  it('tileable samples keep tiling on (only the tiling tutorial overrides it per node)', () => {
    const p = project();
    if (!entry().features.tileable) return;
    expect(p.graph.settings.tiling).toBe('both');
    for (const n of p.graph.nodes) {
      const q = n.params as Record<string, unknown>;
      if (q.tex_tiling_mode === 'absolute' && q.tex_tiling !== 'both') expect(id, `${n.id} overrides tiling`).toBe('tiling_check_tutorial');
      if (typeof q.periodic === 'boolean' && n.type === 'simulation.reaction_diffusion') expect(q.periodic).toBe(true);
    }
  });

  it('exports are preconfigured: enabled, connected, flipbook grids hold all frames, engine presets valid', () => {
    const r = loadProjectRobust(registry, text());
    const exports = [...r.graph.nodes.values()].filter((n) => n.type.startsWith('export.'));
    expect(exports.length).toBeGreaterThan(0);
    for (const n of exports) {
      const q = n.params as Record<string, unknown>;
      expect(q.enabled).not.toBe(false);
      if (n.type !== 'export.viewport') expect(r.graph.linksTo(n.id).length, `${n.id} connected`).toBeGreaterThan(0);
      if ('engine' in q) expect(ENGINES.has(String(q.engine))).toBe(true);
      if (q.frame_mode === 'flipbook') {
        expect(Number(q.frame_count)).toBeGreaterThan(0);
        expect(Number(q.fb_cols) * Number(q.fb_rows)).toBeGreaterThanOrEqual(Number(q.frame_count));
      }
      if (n.type === 'export.motion_vector') expect(Number(q.mv_cols) * Number(q.mv_rows)).toBeGreaterThanOrEqual(Number(q.mv_frames));
    }
    for (const n of r.graph.nodes.values()) if (n.type === 'utils.sheet_encode') expect(Number((n.params as Record<string, unknown>).cols) * Number((n.params as Record<string, unknown>).rows)).toBeGreaterThanOrEqual(Number((n.params as Record<string, unknown>).frames));
  });

  it('metadata: ids, node references, view hints, thumbnails, tour', () => {
    const m = meta();
    const p = project();
    const ids = new Set(p.graph.nodes.map((n) => n.id));
    expect(m.id).toBe(id);
    expect(ids.has(m.preview)).toBe(true);
    expect(ids.has(m.thumb.node)).toBe(true);
    for (const k of ['mesh', 'material'] as const) if (m.view?.[k]) expect(ids.has(m.view[k]!)).toBe(true);
    if (entry().features.mesh) expect(m.view?.mesh, 'mesh samples preset the 3D viewport').toBeTruthy();
    for (const s of m.tour ?? []) {
      expect(ids.has(s.node)).toBe(true);
      for (const l of ['en', 'fa'] as const) expect(m.i18n[l].tour[s.key], `${l} tour ${s.key}`).toBeTruthy();
    }
    expect(m.thumb.frame ?? 0).toBeLessThan(p.graph.settings.loopLength);
    expect(p.graph.annotations?.frames?.length, 'comment frames').toBeGreaterThan(0);
  });

  it('i18n: English + Persian name, description, how-to-adapt, tags and every comment frame', () => {
    const m = meta();
    const p = project();
    for (const l of ['en', 'fa'] as const) {
      const t = textsOf(m, l);
      for (const k of ['name', 'description', 'adapt'] as const) expect(t[k].trim().length, `${l}.${k}`).toBeGreaterThan(3);
      for (const tag of m.tags) expect(t.tags[tag], `${l} tag ${tag}`).toBeTruthy();
      for (const f of p.graph.annotations!.frames) expect(t.frames[f.id], `${l} frame ${f.id}`).toBeTruthy();
    }
    expect(PERSIAN.test(m.i18n.fa.name)).toBe(true);
    expect(PERSIAN.test(m.i18n.fa.description)).toBe(true);
    expect(PERSIAN.test(m.i18n.fa.adapt)).toBe(true);
    for (const f of p.graph.annotations!.frames) expect(PERSIAN.test(m.i18n.fa.frames[f.id])).toBe(true);
    expect(m.i18n.fa.name).not.toBe(m.i18n.en.name);
  });

  it('localizing frames and building tour frames works for both languages', () => {
    const m = meta();
    for (const l of ['en', 'fa']) {
      const g = project().graph;
      localizeFrames(g, m, l);
      for (const f of g.annotations!.frames) expect(f.title).toBe(textsOf(m, l).frames[f.id]);
      expect(tourFrames(g, m, l, String, '#e0c35a').length).toBe(m.tour?.length ?? 0);
    }
  });
});

describe('tutorials', () => {
  it('Hello Nodes is Noise -> Levels -> Ramp -> Export with four numbered frames', () => {
    const p = JSON.parse(readFileSync(join(SAMPLES_DIR, 'hello_nodes', GRAPH_FILE), 'utf8')) as ProjectFile;
    expect(p.graph.nodes.map((n) => n.type)).toEqual(['grayscale.noise', 'utils.levels', 'color.ramp', 'export.color']);
    expect(p.graph.annotations!.frames.length).toBe(4);
  });
  it('Tiling Check shows one 3x3 preview per tiling mode', () => {
    const p = JSON.parse(readFileSync(join(SAMPLES_DIR, 'tiling_check_tutorial', GRAPH_FILE), 'utf8')) as ProjectFile;
    expect(p.graph.nodes.filter((n) => n.type === 'utils.tile').length).toBe(3);
    expect(existsSync(join(SAMPLES_DIR, 'tiling_check_tutorial', META_FILE))).toBe(true);
  });
});

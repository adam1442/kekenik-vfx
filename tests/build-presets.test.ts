import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import { buildVfxPresets } from '../src/engine/presets/vfx-builder';
import { MemoryPresetBackend, PresetStore, spawnPreset } from '../src/engine/presets/presets';
import { SubgraphLibrary } from '../src/engine/subgraph/library';
import { flattenGraph } from '../src/engine/subgraph/flatten';
import { makeRegistry } from './helpers';

/**
 * Shared VFX subgraph presets: `GEN_PRESETS=1 npx vitest run tests/build-presets.test.ts` (re)writes
 * src/engine/presets/vfx-presets.generated.json; without the variable the committed file must equal the builder output (determinism)
 * and every preset must spawn on the real registry, flatten, expose >= 4 controls and have valid exposed params.
 */
const FILE = new URL('../src/engine/presets/vfx-presets.generated.json', import.meta.url);
const reg = makeRegistry();
const built = buildVfxPresets(reg);

describe('VFX preset library', () => {
  it('is deterministic and matches the committed JSON', () => {
    const json = JSON.stringify(built, null, 1) + '\n';
    expect(JSON.stringify(buildVfxPresets(reg), null, 1) + '\n').toBe(json);
    if (process.env.GEN_PRESETS) writeFileSync(FILE, json);
    expect(readFileSync(FILE, 'utf8')).toBe(json);
  });
  it('contains the presets relies on', () => {
    const names = built.map((p) => p.name);
    for (const n of ['Flow Advect Loop', 'Domain Warp', 'Dissolve Over Time', 'Fire Temperature Ramp', 'Soft Particle Mask', 'Lightning Bolt Core', 'Rune Ring', 'Smoke Puff Body', 'Slash Color Rig', 'Slash Color - Fire', 'Slash Color - Ice', 'Slash Color - Arcane']) expect(names, n).toContain(n);
  });
  it('every preset spawns, flattens and exposes valid controls', () => {
    const store = new PresetStore(new MemoryPresetBackend(), built);
    expect(store.all().length).toBe(built.length);
    for (const p of store.all()) {
      const g = new Graph(reg);
      const lib = new SubgraphLibrary(reg);
      const ed = new GraphEditor(g);
      const id = spawnPreset(ed, lib, p, { x: 0, y: 0 });
      expect(g.nodes.has(id), p.name).toBe(true);
      const def = p.subgraph!;
      expect(def.exposed.length, `${p.name} exposed controls`).toBeGreaterThanOrEqual(4);
      expect(new Set(def.exposed.map((e) => e.id)).size).toBe(def.exposed.length);
      for (const e of def.exposed) {
        const n = def.graph.nodes.find((x) => x.id === e.node)!;
        expect(reg.expanded(n.type)!.params.some((q) => q.id === e.param), `${p.name}.${e.param}`).toBe(true);
        expect(e.label.length).toBeGreaterThan(1);
      }
      expect(() => flattenGraph(g, lib)).not.toThrow();
    }
  });
});

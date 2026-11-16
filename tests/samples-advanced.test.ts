import { describe, expect, it } from 'vitest';
import { graphHasAnimation, makeAnimator, valueAt } from '../src/engine/anim/animator';
import { buildPlan } from '../src/engine/graph/plan';
import { SAMPLES, buildSample } from '../src/samples';
import { makeRegistry } from './helpers';

/**
 * Advanced sample set (7A+): every sample must be animated, reference only existing params, have keyframes with the right channel
 * count, produce different plan hashes at different frames, evaluate without plan errors and contain mesh / geometry nodes when it
 * promises a mesh. (GPU pixel checks are in the self-test: src/selftest/library.ts.)
 */
describe('advanced samples', () => {
  const reg = makeRegistry();
  const samples = SAMPLES.filter((s) => s.kind === 'sample');
  it('has the complete sample list', () => {
    expect(samples.map((s) => s.id).sort()).toEqual(
      ['blooming_flower', 'flame_torch', 'fluid_smoke_wisps', 'golden_snitch', 'hex_shield', 'neon_sign', 'portal_vortex', 'waterfall_flow', 'water_orb', 'energy_beam', 'fire_orb', 'glow_flare_pack', 'hit_impact_decal', 'lava_tile', 'lightning_strike', 'magic_circle', 'plasma_orb', 'shockwave_ring', 'smoke_flipbook', 'sword_swipe', 'tornado_vortex'].sort(),
    );
  });
  for (const s of samples) {
    describe(s.id, () => {
      const { graph, marks } = buildSample(reg, s);
      const nodes = [...graph.nodes.values()];
      it('is animated and has enough nodes', () => {
        expect(graphHasAnimation(graph)).toBe(true);
        expect(nodes.length).toBeGreaterThanOrEqual(14);
        const tracks = nodes.reduce((n, x) => n + Object.keys(x.anim ?? {}).length, 0);
        expect(tracks).toBeGreaterThanOrEqual(5);
      });
      it('references only existing params; tracks have the right channel counts', () => {
        for (const n of nodes) {
          const ex = reg.expanded(n.type);
          expect(ex, n.type).toBeTruthy();
          const ids = new Map(ex!.params.map((p) => [p.id, p]));
          for (const k of Object.keys(n.params)) expect(ids.has(k), `${s.id}/${n.name}: unknown param ${k}`).toBe(true);
          for (const [k, t] of Object.entries(n.anim ?? {})) {
            const def = ids.get(k);
            expect(def, `${s.id}/${n.name}: track on unknown param ${k}`).toBeTruthy();
            if (t.kind === 'num') {
              const want = def!.type === 'vec2' ? 2 : def!.type === 'vec3' ? 3 : def!.type === 'color' ? 4 : 1;
              expect(t.ch.length, `${s.id}/${n.name}.${k}`).toBe(want);
            }
          }
        }
      });
      it('plans at several frames without errors; animation changes the hashes', () => {
        const targets = nodes.filter((n) => n.type.startsWith('export.')).map((n) => n.id);
        expect(targets.length).toBeGreaterThan(0);
        const L = graph.settings.loopLength;
        const hashes = new Set<number>();
        for (const f of [0, Math.floor(L / 4), Math.floor(L / 2), L - 1]) {
          const plan = buildPlan(graph, targets, { time: f / graph.settings.fps, scale: 0.25, maxDim: 8192, animator: makeAnimator(reg) });
          for (const [id, pn] of plan.nodes) expect(pn.error, `${s.id}/${graph.nodes.get(id)!.name} @${f}`).toBeFalsy();
          hashes.add(plan.nodes.get(marks.get('main')!.node)!.hash);
        }
        expect(hashes.size, 'main output differs between frames').toBeGreaterThan(1);
      });
      it('keyframed values stay inside the hard ranges', () => {
        for (const n of nodes) {
          const ex = reg.expanded(n.type)!;
          for (const k of Object.keys(n.anim ?? {})) {
            const def = ex.params.find((p) => p.id === k)!;
            for (let f = 0; f <= graph.settings.loopLength; f += 4) {
              const v = valueAt(graph, n.id, k, f);
              expect(v, `${s.id}/${n.name}.${k}@${f}`).toBeDefined();
              const nums = Array.isArray(v) ? (v as number[]) : typeof v === 'number' ? [v] : [];
              const lo = (def as { min?: number }).min;
              const hi = (def as { max?: number }).max;
              for (const x of nums) {
                expect(Number.isFinite(x)).toBe(true);
                if (lo !== undefined && def.type !== 'enum') expect(x, `${s.id}/${n.name}.${k}@${f} below min`).toBeGreaterThanOrEqual(lo - 1e-6);
                if (hi !== undefined && def.type !== 'enum') expect(x, `${s.id}/${n.name}.${k}@${f} above max`).toBeLessThanOrEqual(hi + 1e-6);
              }
            }
          }
        }
      });
      it('has a mesh export and a view hint that points at existing marks', () => {
        if (s.view?.mesh) {
          expect(marks.has(s.view.mesh)).toBe(true);
          expect(nodes.some((n) => n.type === 'export.mesh')).toBe(true);
        }
        if (s.view?.material) expect(marks.has(s.view.material)).toBe(true);
      });
    });
  }
  it('every sample except the pure texture ones ships a mesh with a view hint', () => {
    const meshy = samples.filter((s) => s.view?.mesh).map((s) => s.id);
    expect(meshy.length).toBeGreaterThanOrEqual(10);
  });
});

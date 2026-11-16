import { describe, expect, it } from 'vitest';
import { simPresetsFor } from '../src/engine/sim/presets';
import { FA_NODE_DESC } from '../src/shared/i18n-fa-9b';
import { FA_TERMS } from '../src/shared/i18n-fa-terms';
import { motionVectorMeta } from '../src/export/image-job';
import { makeRegistry } from './helpers';

/** acceptance: every Vector / simulation / motion-vector node is in the library with i18n (en + fa), presets / gallery, gizmos for spatial parameters, animation support. */
const reg = makeRegistry();
const all = reg.list().filter((d) => d.category === 'vector' || d.category === 'simulation' || d.id === 'export.motion_vector');
const BY_9B = new Set([
  'vector.uniform', 'vector.noise', 'vector.radial', 'vector.vortex', 'vector.spline', 'vector.from_gray', 'vector.from_normal',
  'vector.combine', 'vector.transform', 'vector.adjust', 'vector.blur', 'vector.project', 'vector.noise_warp',
  'vector.decompose', 'vector.compose', 'vector.stats', 'vector.advect', 'vector.warp', 'vector.motion_blur', 'vector.lic', 'vector.streamlines', 'vector.particles',
  'vector.motion_generate', 'vector.motion_interpolate', 'vector.motion_encode', 'export.motion_vector',
  'simulation.reaction_diffusion', 'simulation.wave', 'simulation.diffusion', 'simulation.lightning', 'simulation.burn_front', 'simulation.flow_advect_sim',
]);

describe('node set', () => {
  it('every requested node is registered under Vector / Simulation (Export for the motion export)', () => {
    for (const id of BY_9B) expect(reg.has(id), id).toBe(true);
    for (const id of BY_9B) {
      const d = reg.get(id)!;
      expect(['vector', 'simulation', 'export'], id).toContain(d.category);
    }
  });
  it('Vector Stats and the analysis nodes of 9A exist (no duplicates are created by 9B)', () => {
    for (const id of ['utils.vector_magnitude', 'utils.vector_direction', 'utils.divergence', 'utils.curl', 'utils.vector_visualize']) expect(reg.has(id), id).toBe(true);
    expect(reg.has('vector.magnitude')).toBe(false);
    expect(reg.has('vector.divergence')).toBe(false);
  });
  it('param ids are unique per node and every node has a description, an icon and keywords', () => {
    for (const d of all) {
      const ids = (d.params ?? []).map((p) => p.id);
      expect(new Set(ids).size, d.id).toBe(ids.length);
      expect(d.description.length, d.id).toBeGreaterThan(20);
      expect(d.keywords?.length ?? 0, d.id).toBeGreaterThan(2);
    }
  });
  it('every 9B node has a Persian description and Persian titles / pin names / labels', () => {
    const missing: string[] = [];
    for (const d of all) {
      if (!BY_9B.has(d.id) && d.id !== 'simulation.fluid2d') continue;
      if (!FA_NODE_DESC[d.id]) missing.push(`${d.id}: description`);
      if (!FA_TERMS[d.title]) missing.push(`${d.id}: title "${d.title}"`);
      for (const p of d.params ?? []) if (p.label && !FA_TERMS[p.label]) missing.push(`${d.id}: label "${p.label}"`);
    }
    expect(missing).toEqual([]);
  });
  it('spatial (vec2) parameters are covered by gizmos or are pure size / scale values', () => {
    const exempt = new Set(['scale', 'offset', 'repeat', 'size_mul', 'size_abs', 'view_center', 'wind_dir', 'gravity']);
    const bad: string[] = [];
    for (const d of all) {
      const spatial = (d.params ?? []).filter((p) => p.type === 'vec2' && !exempt.has(p.id)).map((p) => p.id);
      if (!spatial.length) continue;
      const gz = JSON.stringify((d.gizmos ?? []).map((g) => g));
      for (const id of spatial) if (!gz.includes(`"${id}"`) && !d.params!.some((p) => p.id.startsWith(id.replace(/pos2?$/, '')) && gz.includes(p.id))) bad.push(`${d.id}.${id}`);
    }
    expect(bad).toEqual([]);
  });
  it('simulation nodes ship presets with en + fa names and descriptions; stateful nodes are flagged', () => {
    for (const id of ['simulation.reaction_diffusion', 'simulation.wave', 'simulation.diffusion', 'simulation.burn_front', 'simulation.flow_advect_sim', 'simulation.fluid2d']) {
      const d = reg.get(id)!;
      expect(d.simulation, id).toBe(true);
      const presets = simPresetsFor(id) ?? [];
      expect(presets.length, id).toBeGreaterThanOrEqual(3);
      for (const p of presets) {
        expect(p.name.en && p.name.fa, `${id}/${p.id}`).toBeTruthy();
        expect(p.description.en && p.description.fa, `${id}/${p.id}`).toBeTruthy();
      }
      expect(d.gallery?.length ?? 0, id).toBeGreaterThanOrEqual(3);
    }
    expect(reg.get('simulation.reaction_diffusion')!.params!.find((p) => p.id === 'warmup')!.default).toBeGreaterThan(0);
  });
  it('Reaction Diffusion has the presets of the spec, Lightning outputs Spline + Mask, Particles outputs Points', () => {
    const rd = (simPresetsFor('simulation.reaction_diffusion') ?? []).map((p) => p.name.en);
    for (const n of ['Spots', 'Stripes', 'Coral', 'Mitosis', 'Worms', 'Maze', 'Waves']) expect(rd).toContain(n);
    expect(reg.get('simulation.lightning')!.outputs.map((o) => `${o.id}:${o.type}`)).toEqual(['mask:gray', 'spline:spline']);
    expect(reg.get('vector.particles')!.outputs.map((o) => o.type)).toEqual(['points']);
    expect(reg.get('vector.motion_generate')!.outputs.map((o) => o.id)).toEqual(['sheet', 'motion', 'occlusion']);
  });
  it('stateless vector generators / operators with texture outputs support the Texture tab and animation', () => {
    for (const id of ['vector.uniform', 'vector.noise', 'vector.radial', 'vector.vortex', 'vector.spline', 'vector.from_gray']) {
      const d = reg.get(id)!;
      expect(d.common?.texture, id).toBe(true);
      expect((d.params ?? []).some((p) => (p as { animatable?: boolean }).animatable), id).toBe(true);
      expect(d.outputs[0].type, id).toBe('vector');
    }
  });
  it('Export Motion Vector sidecar: scale, convention, encoding and (for a vector flipbook sheet) grid / frame count / fps', () => {
    const plain = motionVectorMeta({ mv_scale: 0.1, mv_convention: 'unreal', mv_signed: false }).motionVectors;
    expect(plain.scale).toBe(0.1);
    expect(plain.convention).toBe('unreal');
    expect(plain.yDown).toBe(false);
    expect(plain.encoding).toBe('neutral-0.5');
    expect(plain.sheet).toBeUndefined();
    const sheet = motionVectorMeta({ mv_scale: 0.05, mv_convention: 'unity', mv_signed: true, mv_cols: 8, mv_rows: 6, mv_frames: 48, mv_fps: 60 }).motionVectors;
    expect(sheet.yDown).toBe(true);
    expect(sheet.encoding).toBe('signed');
    expect(sheet.sheet).toMatchObject({ grid: [8, 6], frames: 48, fps: 60 });
    expect((motionVectorMeta({ mv_scale: 1, mv_cols: 4, mv_rows: 3 }).motionVectors.sheet as { frames: number }).frames).toBe(12);
  });
});

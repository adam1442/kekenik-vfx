import type { NodeRegistry } from '../engine/graph/registry';
import { buildSampleGraph, type SampleDef } from './kit';
import { fireOrb, lightningStrike, shockwaveRing } from './vfx-a';
import { energyBeam, magicCircle, swordSwipe } from './vfx-b';
import { flarePack, hitImpact, lavaTile, smokeFlipbook } from './vfx-c';
import { plasmaOrb, tornadoVortex } from './vfx-d';
import { bloomingFlower, goldenSnitch, neonSign, waterfall } from './vfx-e';
import { fluidSmoke, flameTorch, hexShield, portalVortex, waterOrb } from './vfx-f';

export { Builder } from './kit';
export type { SampleDef, SampleProbe, SampleView } from './kit';

/**
 * SAMPLE PROJECTS + TEMPLATES. The samples live in vfx-a..d.ts and are built from real nodes,
 * with keyframe animation (looping or one-shot timelines) and mesh / geometry parts. Templates are small starting points.
 */
const TEMPLATES: SampleDef[] = [
  {
    id: 'tpl_blank',
    name: 'Blank',
    description: 'An empty 1024 × 1024 project.',
    kind: 'template',
    tags: ['blank'],
    build() {},
  },
  {
    id: 'tpl_flipbook',
    name: 'Flipbook',
    description: 'Looping noise → colour ramp → Sheet Encode (16 frames) → flipbook export. Replace the noise with your own animated graph.',
    kind: 'template',
    tags: ['flipbook', 'loop'],
    settings: { width: 512, height: 512, tiling: 'none', loopLength: 64, fps: 30 },
    build(b) {
      const n = b.n('grayscale.noise', 'Noise', 0, 0, { noise_type: 'perlin', scale: [4, 4], octaves: 4 });
      b.loopEvolution(n);
      const r = b.n('color.ramp', 'Ramp', 260, 0);
      const s = b.n('utils.sheet_encode', 'Sheet Encode', 520, 0, { frames: 16 });
      const o = b.n('export.color', 'Export Flipbook', 780, 0, { frame_mode: 'flipbook', frame_count: 16, fb_cols: 4, fb_rows: 4 });
      b.chain(n, r);
      b.l(r, `${s}.input`);
      b.l(r, o);
      b.mark('main', r);
    },
    probes: [{ mark: 'main', minMean: 0.001, maxMean: 0.95 }],
  },
  {
    id: 'tpl_mesh_vfx',
    name: 'Mesh VFX',
    description: 'Ring mesh with gradient vertex colour, a mask texture for it and a viewport export.',
    kind: 'template',
    tags: ['mesh', 'vfx'],
    settings: { width: 512, height: 512, tiling: 'x' },
    build(b) {
      const m = b.n('geometry.shapes', 'Ring', 0, 0, { shape: 'ring', radius: 1, inner_radius: 0.6, segments: 64, uv_mode: 'polar' });
      const c = b.n('geometry.combine_color', 'Vertex Colour', 260, 0, { source: 'gradient_radial' });
      const o = b.n('export.mesh', 'Export Mesh', 520, 0);
      b.l(`${m}.mesh`, `${c}.input`);
      b.l(c, `${o}.input`);
      const g = b.n('grayscale.gradient', 'Mask', 0, 220, { gtype: 'linear', start: [0, 0.5], end: [1, 0.5] });
      const t = b.n('export.mask', 'Export Mask', 260, 220);
      b.l(g, t);
      b.mark('main', g);
    },
    probes: [{ mark: 'main', minMean: 0.2, maxMean: 0.8 }],
  },
  {
    id: 'tpl_tiling',
    name: 'Tiling Texture',
    description: 'Seamless noise → levels → ramp with a normal map, tiling in both directions.',
    kind: 'template',
    tags: ['tiling', 'texture'],
    settings: { width: 1024, height: 1024, tiling: 'both' },
    build(b) {
      const n = b.n('grayscale.noise', 'Noise', 0, 0, { noise_type: 'perlin', scale: [4, 4], octaves: 5 });
      const lv = b.n('utils.levels', 'Levels', 260, 0);
      const r = b.n('color.ramp', 'Ramp', 520, 0);
      const o = b.n('export.color', 'Export Color', 780, 0);
      b.chain(n, lv, r, o);
      const nm = b.n('normal.create', 'Normal', 520, 220);
      const on = b.n('export.normal', 'Export Normal', 780, 220);
      b.l(lv, nm);
      b.l(nm, on);
      b.mark('main', r);
    },
    probes: [{ mark: 'main', minMean: 0.005, maxMean: 0.95 }],
  },
];

const THUMB_FRAMES: Record<string, number> = { fire_orb: 20, lightning_strike: 12, shockwave_ring: 18, sword_swipe: 14, hit_impact_decal: 10, smoke_flipbook: 24, tornado_vortex: 8, blooming_flower: 50, waterfall_flow: 20, neon_sign: 50, golden_snitch: 12, fluid_smoke_wisps: 40, hex_shield: 20, portal_vortex: 10, flame_torch: 20, water_orb: 20 };

const LIST: SampleDef[] = [
  fireOrb,
  lightningStrike,
  shockwaveRing,
  swordSwipe,
  energyBeam,
  hitImpact,
  magicCircle,
  tornadoVortex,
  plasmaOrb,
  smokeFlipbook,
  lavaTile,
  flarePack,
  bloomingFlower,
  waterfall,
  neonSign,
  goldenSnitch,
  fluidSmoke,
  hexShield,
  portalVortex,
  flameTorch,
  waterOrb,
  ...TEMPLATES,
];

export const SAMPLES: SampleDef[] = LIST.map((s) => (THUMB_FRAMES[s.id] !== undefined ? { ...s, thumbFrame: THUMB_FRAMES[s.id] } : s));

export const sampleById = (id: string): SampleDef | undefined => SAMPLES.find((s) => s.id === id);

/** Builds a sample into a fresh Graph (throws when a node / param / pin id is wrong). */
export function buildSample(registry: NodeRegistry, def: SampleDef) {
  return buildSampleGraph(registry, def);
}

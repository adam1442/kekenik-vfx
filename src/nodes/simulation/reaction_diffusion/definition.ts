import { P } from '../../../engine/params/schema';
import type { SimPreset } from '../../../engine/sim/presets';
import { advanceSubsteps, gridSimNode, type SimOut } from '../../_shared/simgrid';
import simSrc from './sim.wgsl?raw';
import outSrc from './out.wgsl?raw';

/** Gray-Scott (feed, kill) pairs of the classic parameter map (Pearson 1993 / Sims). */
export const RD_PRESETS: SimPreset[] = [
  ['spots', 'Spots', 'لکه‌ها', 0.03, 0.062, 'Isolated round spots.', 'لکه‌های گرد جدا از هم.'],
  ['stripes', 'Stripes', 'راه‌راه', 0.062, 0.0609, 'Fingerprint-like parallel stripes.', 'راه‌راه‌های موازی شبیه اثر انگشت.'],
  ['coral', 'Coral', 'مرجان', 0.0545, 0.062, 'Branching coral growth.', 'رشد شاخه‌ای شبیه مرجان.'],
  ['mitosis', 'Mitosis', 'میتوز', 0.0367, 0.0649, 'Spots that divide.', 'لکه‌هایی که تقسیم می‌شوند.'],
  ['worms', 'Worms', 'کرم‌ها', 0.078, 0.061, 'Wriggling worm-like lines.', 'خطوط کرم‌مانند.'],
  ['maze', 'Maze', 'هزارتو', 0.029, 0.057, 'Labyrinth walls.', 'دیواره‌های هزارتو.'],
  ['waves', 'Waves', 'موج‌ها', 0.014, 0.045, 'Soft travelling waves.', 'موج‌های نرم متحرک.'],
].map(([id, en, fa, f, k, de, df]) => ({ id: id as string, name: { en: en as string, fa: fa as string }, description: { en: de as string, fa: df as string }, params: { feed: f as number, kill: k as number, warmup: 120, substeps: 12 } }));

const outs: SimOut[] = [
  { id: 'a', name: 'A', type: 'gray', code: 0, tooltip: 'Chemical A (1 = empty).' },
  { id: 'b', name: 'B', type: 'gray', code: 1, tooltip: 'Chemical B (the visible pattern).' },
  { id: 'pattern', name: 'Pattern', type: 'gray', code: 2, tooltip: 'B normalized to 0..1 between the pattern range values.' },
  { id: 'normal', name: 'Normal', type: 'normal', code: 3, tooltip: 'Normal map of the Pattern height field.' },
];

/** simulation.reaction_diffusion: Gray-Scott on the GPU, periodic (tileable), loopable. */
export default gridSimNode({
  id: 'simulation.reaction_diffusion',
  title: 'Reaction Diffusion',
  description: 'Gray-Scott reaction-diffusion: organic spots, stripes, coral and worm patterns. Periodic boundary gives tileable skins; seed from noise, points, a mask or a disk. Loops with a crossfade.',
  keywords: ['reaction', 'diffusion', 'gray', 'scott', 'turing', 'organic', 'pattern', 'coral', 'spots', 'stripes', 'skin', 'worms'],
  boundary: true,
  substeps: 12,
  warmup: 24, // the default state (and the Gallery thumbnail) already shows a developed pattern
  res: 256,
  memFactor: 3,
  lazyPins: [
    { id: 'seed_mask', name: 'Seed mask', type: 'gray', optional: true, lazy: true, tooltip: 'Where chemical B is seeded (> 50%).' },
    { id: 'feed_map', name: 'Feed map', type: 'gray', optional: true, lazy: true, tooltip: 'Per-pixel feed offset (50% = no change).' },
    { id: 'kill_map', name: 'Kill map', type: 'gray', optional: true, lazy: true, tooltip: 'Per-pixel kill offset (50% = no change).' },
  ],
  outs,
  params: [
    P.float('feed', 0.055, { group: 'Reaction', label: 'Feed', min: 0, max: 0.12, step: 0.0005, precision: 4, animatable: true }),
    P.float('kill', 0.062, { group: 'Reaction', label: 'Kill', min: 0, max: 0.1, step: 0.0005, precision: 4, animatable: true }),
    P.float('diff_a', 1, { group: 'Reaction', label: 'Diffusion A', min: 0.05, max: 1.2, step: 0.01 }),
    P.float('diff_b', 0.5, { group: 'Reaction', label: 'Diffusion B', min: 0.02, max: 1, step: 0.01 }),
    P.float('step_size', 1, { group: 'Reaction', label: 'Time step', min: 0.1, max: 1.5, step: 0.05, tooltip: 'Clamped by the stability limit (dt x diffusion <= 1.2).' }),
    P.float('map_range', 0.02, { group: 'Reaction', label: 'Map range', min: 0, max: 0.1, step: 0.001, precision: 3, tooltip: 'Feed / kill change at 0% / 100% of the maps.' }),
    P.enum('seed_mode', 'noise', [{ value: 'noise', label: 'Noise' }, { value: 'center', label: 'Center disk' }, { value: 'points', label: 'Points grid' }, { value: 'mask', label: 'Mask only' }], { group: 'Seeding', label: 'Seed pattern' }),
    P.float('seed_density', 0.02, { group: 'Seeding', label: 'Seed density', min: 0, max: 1, step: 0.005, display: 'percent', visibleIf: (v) => v.seed_mode === 'noise' }),
    P.int('seed_cells', 4, { group: 'Seeding', label: 'Noise cell size', min: 1, max: 32, unit: 'px', visibleIf: (v) => v.seed_mode === 'noise' }),
    P.int('seed_points', 4, { group: 'Seeding', label: 'Points per side', min: 1, max: 32, visibleIf: (v) => v.seed_mode === 'points' }),
    P.vec2('seed_pos', [0.5, 0.5], { group: 'Seeding', label: 'Center', min: -1, max: 2, step: 0.005, visibleIf: (v) => v.seed_mode === 'center' }),
    P.float('seed_radius', 0.04, { group: 'Seeding', label: 'Seed radius', min: 0.002, max: 1, step: 0.002, visibleIf: (v) => v.seed_mode === 'center' || v.seed_mode === 'points' }),
    P.bool('mask_continuous', false, { group: 'Seeding', label: 'Keep seeding from mask', tooltip: 'Re-inject B under the mask every step (animated masks).' }),
    P.float('out_lo', 0.08, { group: 'Output', label: 'Pattern low', min: 0, max: 1, step: 0.005 }),
    P.float('out_hi', 0.35, { group: 'Output', label: 'Pattern high', min: 0, max: 1, step: 0.005 }),
    P.float('out_strength', 4, { group: 'Output', label: 'Normal strength', min: 0, max: 64, softMax: 16, step: 0.1 }),
  ],
  simSource: simSrc,
  outSource: outSrc,
  passes: [0, 1],
  init: (g, u, inputs) => g.run(0, g.cur, [null, inputs.seed_mask], u),
  step: (g, u, inputs) => advanceSubsteps(g, u, 1, [inputs.seed_mask, inputs.feed_map, inputs.kill_map]),
  presets: RD_PRESETS,
  gizmos: [{ id: 'seed_circle', label: 'Seed', type: 'circle', viewport: '2d', space: 'uv', center: 'seed_pos', radius: 'seed_radius', visibleIf: (v) => v.seed_mode === 'center' }],
});

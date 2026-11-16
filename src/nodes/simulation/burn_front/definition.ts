import { P } from '../../../engine/params/schema';
import type { SimPreset } from '../../../engine/sim/presets';
import { advanceSubsteps, gridSimNode, type SimOut } from '../../_shared/simgrid';
import simSrc from './sim.wgsl?raw';
import outSrc from './out.wgsl?raw';

const preset = (id: string, en: string, fa: string, de: string, df: string, params: SimPreset['params']): SimPreset => ({ id, name: { en, fa }, description: { en: de, fa: df }, params });
export const BURN_PRESETS: SimPreset[] = [
  preset('paper_burn', 'Paper burn', 'سوختن کاغذ', 'Ragged front from the centre, noise modulated.', 'جبهه ناصاف از مرکز با تغییر نویز.', { front_speed: 0.12, noise_influence: 0.8, ignite_pos: [0.5, 0.5], warmup: 20 }),
  preset('wind_swept', 'Wind-swept fire', 'آتش باد‌خورده', 'Front is faster along the wind.', 'جبهه در جهت باد سریع‌تر است.', { front_speed: 0.1, wind_gain: 1.5, wind_dir: [1, 0], ignite_pos: [0.2, 0.5], warmup: 20 }),
  preset('dissolve', 'Dissolve', 'حل‌شدن', 'Uniform dissolve front driven by the height input.', 'جبهه یکنواخت حل‌شدن که با ورودی ارتفاع هدایت می‌شود.', { front_speed: 0.2, height_influence: 0.9, warmup: 10 }),
];
const outs: SimOut[] = [
  { id: 'front', name: 'Front mask', type: 'gray', code: 0, tooltip: 'The burning edge.' },
  { id: 'burned', name: 'Burned mask', type: 'gray', code: 1, tooltip: '1 where the surface has ignited.' },
  { id: 'edge', name: 'Edge glow', type: 'gray', code: 2, tooltip: 'Glow gradient behind the front.' },
  { id: 'time', name: 'Time to burn', type: 'gray', code: 3, tooltip: 'Ignition time (0 = first, 1 = last / not yet): use as a threshold animation.' },
];

/** simulation.burn_front: cellular burn / dissolve front with noise and wind modulation. */
export default gridSimNode({
  id: 'simulation.burn_front',
  title: 'Dissolve / Burn Front',
  description: 'A burn or dissolve front that spreads across a surface: speed modulated by a height map, a noise field and a Vector wind. Outputs front, burned mask, edge glow and a time-to-burn map.',
  keywords: ['burn', 'dissolve', 'front', 'fire', 'paper', 'spread', 'ignite', 'edge', 'glow', 'threshold', 'simulation'],
  boundary: true,
  periodicDefault: false,
  substeps: 2,
  res: 256,
  memFactor: 3,
  lazyPins: [
    { id: 'ignite', name: 'Ignite', type: 'gray', optional: true, lazy: true, tooltip: 'Mask (> 50%) that sets cells on fire; animate it for moving ignition.' },
    { id: 'height', name: 'Height', type: 'gray', optional: true, lazy: true, tooltip: 'Burn resistance: bright areas burn later.' },
    { id: 'noise', name: 'Noise', type: 'gray', optional: true, lazy: true, tooltip: 'Speed modulation (50% = neutral).' },
    { id: 'wind', name: 'Wind', type: 'vector', optional: true, lazy: true, tooltip: 'Vector wind: the front is faster along it.' },
  ],
  outs,
  params: [
    P.float('front_speed', 0.15, { group: 'Front', label: 'Front speed', min: 0.001, max: 4, softMax: 1, step: 0.005, animatable: true, unit: 'tile/s' }),
    P.float('burn_duration', 2, { group: 'Front', label: 'Burn duration', min: 0.05, max: 100, softMax: 10, step: 0.05, unit: 's', tooltip: 'How long a cell keeps spreading fire.' }),
    P.float('height_influence', 0.5, { group: 'Front', label: 'Height influence', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('noise_influence', 0.5, { group: 'Front', label: 'Noise influence', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.float('wind_gain', 1, { group: 'Front', label: 'Wind influence', min: 0, max: 4, step: 0.05 }),
    P.vec2('wind_dir', [0, 0], { group: 'Front', label: 'Constant wind', min: -1, max: 1, step: 0.05, tooltip: 'Added to the Wind input (unit-less direction).' }),
    P.vec2('ignite_pos', [0.5, 0.5], { group: 'Ignition', label: 'Ignition point', min: -1, max: 2, step: 0.005 }),
    P.float('ignite_radius', 0.03, { group: 'Ignition', label: 'Ignition radius', min: 0, max: 1, softMax: 0.3, step: 0.002, tooltip: '0 = no built-in ignition (use the Ignite input).' }),
    P.float('out_front', 0.4, { group: 'Output', label: 'Front width', min: 0.02, max: 20, softMax: 4, step: 0.02, unit: 's' }),
    P.float('out_glow', 1.5, { group: 'Output', label: 'Glow length', min: 0.05, max: 40, softMax: 8, step: 0.05, unit: 's' }),
    P.float('out_range', 8, { group: 'Output', label: 'Time range', min: 0.1, max: 400, softMax: 30, step: 0.1, unit: 's', tooltip: 'Ignition time that maps to 1 in the Time to burn map.' }),
  ],
  simSource: simSrc,
  outSource: outSrc,
  passes: [0, 1],
  init: (g, u, inputs) => g.run(0, g.cur, [null, inputs.ignite], u),
  step: (g, u, inputs) => advanceSubsteps(g, u, 1, [inputs.ignite, inputs.height, inputs.noise, inputs.wind]),
  presets: BURN_PRESETS,
  outExtra: { fields: [{ name: 'sim_time', type: 'f32' }], values: (ctx, _v, setup, fps) => ({ sim_time: Math.max(0, Math.round(ctx.frame.time * fps)) * (setup.speed / Math.max(1, fps)) }) },
  gizmos: [{ id: 'ignite_circle', label: 'Ignition', type: 'circle', viewport: '2d', space: 'uv', center: 'ignite_pos', radius: 'ignite_radius' }],
});

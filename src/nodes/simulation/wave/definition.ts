import { P } from '../../../engine/params/schema';
import type { SimPreset } from '../../../engine/sim/presets';
import { advanceSubsteps, gridSimNode, type SimOut } from '../../_shared/simgrid';
import simSrc from './sim.wgsl?raw';
import outSrc from './out.wgsl?raw';

const preset = (id: string, en: string, fa: string, de: string, df: string, params: SimPreset['params']): SimPreset => ({ id, name: { en, fa }, description: { en: de, fa: df }, params });
export const WAVE_PRESETS: SimPreset[] = [
  preset('raindrops', 'Raindrops', 'قطرات باران', 'Pulses at two points; ripples fade out.', 'ضربه در دو نقطه؛ موج‌ها محو می‌شوند.', { em1_on: true, em2_on: true, em1_mode: 'pulse', em2_mode: 'pulse', em2_pos: [0.7, 0.3], damping: 0.6, warmup: 20 }),
  preset('pond', 'Calm pond', 'برکه آرام', 'A continuous source in a periodic pond.', 'یک منبع پیوسته در برکه دوره‌ای.', { em1_on: true, em1_mode: 'sine', em1_freq: 3, damping: 0.15, boundary: 'periodic', warmup: 30 }),
  preset('basin', 'Reflecting basin', 'حوضچه بازتابنده', 'Waves bounce off the walls.', 'امواج از دیواره‌ها بازمی‌تابند.', { boundary: 'reflect', damping: 0.05, em1_on: true, em1_mode: 'pulse', warmup: 20 }),
  preset('absorb', 'Open water', 'آب آزاد', 'Absorbing edges: waves leave the image.', 'لبه‌های جاذب: موج از تصویر خارج می‌شود.', { boundary: 'absorb', damping: 0.2, em1_on: true, em1_mode: 'sine', em1_freq: 2, warmup: 25 }),
];
const outs: SimOut[] = [
  { id: 'height', name: 'Height', type: 'gray', code: 0 },
  { id: 'velocity', name: 'Velocity', type: 'gray', code: 1 },
  { id: 'normal', name: 'Normal', type: 'normal', code: 2 },
];
const em = (n: 1 | 2, on: boolean, pos: [number, number]) => {
  const k = `em${n}_`;
  const g = `Emitter ${n}`;
  const shown = (v: Record<string, unknown>): boolean => v[`${k}on`] === true;
  return [
    P.bool(`${k}on`, on, { group: g, label: 'Enabled' }),
    P.vec2(`${k}pos`, pos, { group: g, label: 'Position', min: -1, max: 2, step: 0.005, animatable: true, visibleIf: shown }),
    P.float(`${k}radius`, 0.03, { group: g, label: 'Radius', min: 0.002, max: 1, softMax: 0.3, step: 0.002, animatable: true, visibleIf: shown }),
    P.float(`${k}amp`, 4, { group: g, label: 'Amplitude', min: -100, max: 100, softMin: -10, softMax: 10, step: 0.05, animatable: true, visibleIf: shown }),
    P.enum(`${k}mode`, 'sine', [{ value: 'sine', label: 'Sine' }, { value: 'pulse', label: 'Pulse' }], { group: g, label: 'Mode', visibleIf: shown }),
    P.float(`${k}freq`, 2, { group: g, label: 'Frequency', min: 0.05, max: 60, softMax: 12, step: 0.05, unit: 'Hz', visibleIf: shown }),
    P.int(`${k}pulse`, 3, { group: g, label: 'Pulse length (frames)', min: 1, max: 120, visibleIf: (v: Record<string, unknown>) => shown(v) && v[`${k}mode`] === 'pulse' }),
  ];
};

/** simulation.wave: 2D wave equation, semi-implicit damping, CFL-clamped speed. */
export default gridSimNode({
  id: 'simulation.wave',
  title: 'Wave Simulation',
  description: 'Two-dimensional wave equation: ripples from animated emitters and masks, obstacles, reflecting / absorbing / periodic boundaries. Outputs height, velocity and a ready normal map. Stable: speed is clamped to the CFL limit.',
  keywords: ['wave', 'ripple', 'water', 'pond', 'simulation', 'height', 'normal', 'caustic', 'shockwave'],
  boundary: false,
  substeps: 2,
  res: 256,
  memFactor: 3,
  lazyPins: [
    { id: 'impulse', name: 'Impulse', type: 'gray', optional: true, lazy: true, tooltip: 'Gray mask added to the height every frame (x gain).' },
    { id: 'obstacle', name: 'Obstacle', type: 'gray', optional: true, lazy: true, tooltip: 'Solid mask (> 50%): waves reflect.' },
    { id: 'initial', name: 'Initial height', type: 'gray', optional: true, lazy: true },
  ],
  outs,
  params: [
    P.float('wave_speed', 0.25, { group: 'Wave', label: 'Wave speed', min: 0.01, max: 4, softMax: 1, step: 0.005, animatable: true, unit: 'tile/s', tooltip: 'Clamped to the stability limit (CFL <= 0.7 cells per step).' }),
    P.float('damping', 0.3, { group: 'Wave', label: 'Damping', min: 0, max: 20, softMax: 3, step: 0.01, animatable: true, tooltip: 'Energy loss per second.' }),
    P.enum('boundary', 'reflect', [{ value: 'reflect', label: 'Reflect' }, { value: 'absorb', label: 'Absorb' }, { value: 'periodic', label: 'Periodic' }], { group: 'Wave', label: 'Boundary' }),
    P.float('sponge', 0.12, { group: 'Wave', label: 'Absorber width', min: 0.01, max: 0.5, step: 0.01, display: 'percent', visibleIf: (v) => v.boundary === 'absorb' }),
    P.float('impulse_gain', 20, { group: 'Wave', label: 'Impulse gain', min: -1000, max: 1000, softMin: -50, softMax: 50, step: 0.1, animatable: true }),
    P.float('init_scale', 1, { group: 'Wave', label: 'Initial height scale', min: -100, max: 100, softMin: -4, softMax: 4, step: 0.05 }),
    ...em(1, true, [0.5, 0.5]),
    ...em(2, false, [0.3, 0.7]),
    P.float('out_gain', 1, { group: 'Output', label: 'Height gain', min: 0, max: 1000, softMax: 8, step: 0.05 }),
    P.bool('out_centered', true, { group: 'Output', label: 'Centered (0 = 50%)', tooltip: 'Height output is height * gain * 0.5 + 0.5.' }),
    P.float('out_strength', 4, { group: 'Output', label: 'Normal strength', min: 0, max: 64, softMax: 16, step: 0.1 }),
  ],
  simSource: simSrc,
  outSource: outSrc,
  passes: [0, 1],
  init: (g, u, inputs) => g.run(0, g.cur, [null, inputs.initial], u),
  step: (g, u, inputs) => advanceSubsteps(g, u, 1, [inputs.obstacle, inputs.impulse]),
  presets: WAVE_PRESETS,
  gizmos: [1, 2].map((n) => ({ id: `em${n}_circle`, label: `Emitter ${n}`, type: 'circle' as const, viewport: '2d' as const, space: 'uv' as const, center: `em${n}_pos`, radius: `em${n}_radius`, visibleIf: (v: Record<string, unknown>) => v[`em${n}_on`] === true })),
});

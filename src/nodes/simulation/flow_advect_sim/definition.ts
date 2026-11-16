import { P } from '../../../engine/params/schema';
import type { SimPreset } from '../../../engine/sim/presets';
import { advanceSubsteps, gridSimNode, type SimOut } from '../../_shared/simgrid';
import simSrc from './sim.wgsl?raw';
import outSrc from './out.wgsl?raw';

const preset = (id: string, en: string, fa: string, de: string, df: string, params: SimPreset['params']): SimPreset => ({ id, name: { en, fa }, description: { en: de, fa: df }, params });
export const FLOWSIM_PRESETS: SimPreset[] = [
  preset('smoke_trails', 'Smoke trails', 'رد دود', 'Injected color streams along the field and dissipates.', 'رنگ تزریق‌شده در امتداد میدان جریان یافته و محو می‌شود.', { dissipation: 0.6, inject_gain: 6, vorticity: 0.4, warmup: 40 }),
  preset('ink', 'Ink in water', 'جوهر در آب', 'Long-lived ink with slight diffusion.', 'جوهر ماندگار با پخش اندک.', { dissipation: 0.1, diffuse: 0.05, inject_gain: 4, warmup: 40 }),
  preset('energy_flow', 'Energy flow', 'جریان انرژی', 'Fast fading trails for energy effects.', 'ردهای تند و زودگذر برای جلوه‌های انرژی.', { dissipation: 1.5, inject_gain: 10, vorticity: 0, warmup: 30 }),
];
const outs: SimOut[] = [
  { id: 'output', name: 'Result', type: 'color', code: 0 },
  { id: 'density', name: 'Density', type: 'gray', code: 1, tooltip: 'Average of the RGB channels.' },
];

/** simulation.flow_advect_sim: stateful advection / accumulation of a texture through a Vector field. */
export default gridSimNode({
  id: 'simulation.flow_advect_sim',
  title: 'Flow Advection Simulation',
  description: 'Continuously advects and accumulates a texture through a Vector field (for example Fluid 2D velocity): injection mask, dissipation, optional vorticity from the field. Smoke-like trails without the full fluid solver; loops with a crossfade.',
  keywords: ['flow', 'advect', 'advection', 'trails', 'smoke', 'ink', 'vector', 'accumulate', 'simulation', 'stateful'],
  boundary: true,
  periodicDefault: true,
  substeps: 1,
  res: 256,
  memFactor: 3,
  lazyPins: [
    { id: 'vector', name: 'Vector', type: 'vector', optional: true, lazy: true, tooltip: 'Velocity field (tile fractions per second).' },
    { id: 'inject', name: 'Inject', type: 'color', optional: true, lazy: true, tooltip: 'Texture added every frame (x gain).' },
    { id: 'initial', name: 'Initial', type: 'color', optional: true, lazy: true },
  ],
  outs,
  params: [
    P.float('flow_scale', 1, { group: 'Flow', label: 'Flow scale', min: -20, max: 20, softMin: -4, softMax: 4, step: 0.01, animatable: true, tooltip: 'Multiplies the vector field.' }),
    P.float('dissipation', 0.5, { group: 'Flow', label: 'Dissipation', min: 0, max: 20, softMax: 4, step: 0.01, animatable: true, tooltip: 'Exponential fade per second.' }),
    P.float('diffuse', 0, { group: 'Flow', label: 'Diffusion', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Softens the trails every step.' }),
    P.float('vorticity', 0, { group: 'Flow', label: 'Vorticity', min: 0, max: 10, softMax: 2, step: 0.01, animatable: true, tooltip: 'Confines the vorticity of the vector field (swirls stay lively).' }),
    P.float('inject_gain', 5, { group: 'Injection', label: 'Inject gain', min: 0, max: 1000, softMax: 30, step: 0.1, animatable: true, tooltip: 'Amount added per second.' }),
    P.float('max_value', 4, { group: 'Injection', label: 'Max value', min: 0.1, max: 100, softMax: 16, step: 0.1 }),
    P.float('out_gain', 1, { group: 'Output', label: 'Gain', min: 0, max: 100, softMax: 8, step: 0.05 }),
  ],
  simSource: simSrc,
  outSource: outSrc,
  passes: [0, 1],
  init: (g, u, inputs) => g.run(0, g.cur, [null, inputs.initial], u),
  step: (g, u, inputs) => advanceSubsteps(g, u, 1, [inputs.vector, inputs.inject]),
  presets: FLOWSIM_PRESETS,
});

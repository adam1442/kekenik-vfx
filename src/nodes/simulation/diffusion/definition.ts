import { P } from '../../../engine/params/schema';
import type { SimPreset } from '../../../engine/sim/presets';
import { gridSimNode, type SimOut } from '../../_shared/simgrid';
import simSrc from './sim.wgsl?raw';
import outSrc from './out.wgsl?raw';

const preset = (id: string, en: string, fa: string, de: string, df: string, params: SimPreset['params']): SimPreset => ({ id, name: { en, fa }, description: { en: de, fa: df }, params });
export const HEAT_PRESETS: SimPreset[] = [
  preset('glow_bleed', 'Glow bleed', 'نشت درخشش', 'Soft isotropic spreading of the input.', 'پخش نرم و همسانگرد ورودی.', { diffusion: 0.0008, decay: 0.2, warmup: 20 }),
  preset('burn_in', 'Burn-in', 'سوختگی', 'Source keeps heating, slow decay.', 'منبع مدام گرم می‌کند، زوال کند.', { diffusion: 0.0004, decay: 0.05, source_gain: 2, warmup: 30 }),
  preset('streaks', 'Streak diffusion', 'پخش رگه‌ای', 'Strongly anisotropic along the direction field.', 'پخش بسیار ناهمسانگرد در راستای میدان جهت.', { diffusion: 0.001, aniso_par: 4, aniso_perp: 0.1, warmup: 20 }),
];
const outs: SimOut[] = [
  { id: 'output', name: 'Result', type: 'gray', code: 0 },
  { id: 'flux', name: 'Heat flux', type: 'vector', code: 1, tooltip: 'Minus the gradient of the result (flows from hot to cold).' },
];

/** simulation.diffusion: isotropic / anisotropic heat equation with sources, sinks and decay. */
export default gridSimNode({
  id: 'simulation.diffusion',
  title: 'Diffusion / Heat',
  description: 'Heat equation on a grid: isotropic or anisotropic diffusion (direction from a Vector input), decay, sources and sinks, periodic option. Glow bleed, burn-in and dissolve maps. Sub-iterations keep it stable.',
  keywords: ['diffusion', 'heat', 'blur', 'glow', 'bleed', 'anisotropic', 'burn', 'dissolve', 'spread', 'simulation'],
  boundary: true,
  periodicDefault: false,
  substeps: 2,
  res: 256,
  memFactor: 3,
  lazyPins: [
    { id: 'source', name: 'Source', type: 'gray', optional: true, lazy: true, tooltip: 'Heat added per second (x gain).' },
    { id: 'sink', name: 'Sink', type: 'gray', optional: true, lazy: true, tooltip: 'Mask where the value is pulled to zero.' },
    { id: 'direction', name: 'Direction', type: 'vector', optional: true, lazy: true, tooltip: 'Vector field: diffusion is strong along it (anisotropic).' },
    { id: 'conductivity', name: 'Conductivity', type: 'gray', optional: true, lazy: true, tooltip: 'Per-pixel diffusion multiplier.' },
    { id: 'initial', name: 'Initial', type: 'gray', optional: true, lazy: true },
  ],
  outs,
  params: [
    P.float('diffusion', 0.0005, { group: 'Diffusion', label: 'Diffusion', min: 0, max: 0.05, softMax: 0.005, step: 0.0001, precision: 5, animatable: true, unit: 'tile\u00b2/s' }),
    P.float('aniso_par', 1, { group: 'Diffusion', label: 'Along direction', min: 0, max: 16, softMax: 6, step: 0.05, tooltip: 'Diffusion multiplier along the Direction vectors.' }),
    P.float('aniso_perp', 1, { group: 'Diffusion', label: 'Across direction', min: 0, max: 16, softMax: 6, step: 0.05, tooltip: 'Diffusion multiplier across the Direction vectors.' }),
    P.float('decay', 0, { group: 'Diffusion', label: 'Decay', min: 0, max: 20, softMax: 3, step: 0.01, animatable: true, tooltip: 'Exponential decay per second.' }),
    P.float('source_gain', 1, { group: 'Sources', label: 'Source gain', min: -1000, max: 1000, softMin: -10, softMax: 10, step: 0.05, animatable: true }),
    P.float('sink_rate', 4, { group: 'Sources', label: 'Sink rate', min: 0, max: 100, softMax: 20, step: 0.1 }),
    P.float('init_scale', 1, { group: 'Sources', label: 'Initial scale', min: -100, max: 100, softMin: -4, softMax: 4, step: 0.05 }),
    P.float('out_gain', 1, { group: 'Output', label: 'Gain', min: 0, max: 1000, softMax: 10, step: 0.05 }),
    P.float('out_flux', 1, { group: 'Output', label: 'Flux scale', min: 0, max: 1000, softMax: 10, step: 0.05 }),
  ],
  simSource: simSrc,
  outSource: outSrc,
  passes: [0, 1],
  init: (g, u, inputs) => g.run(0, g.cur, [null, inputs.initial], u),
  step: (g, u, inputs) => {
    // stability: explicit scheme needs D dt <= ~0.2 (cells); split every sub-step into n equal iterations
    const n = Math.max(Number(u.sim_res instanceof Array ? u.sim_res[0] : 256), Number(u.sim_res instanceof Array ? u.sim_res[1] : 256));
    const dmax = Number(u.diffusion) * n * n * Math.max(1, Number(u.aniso_par), Number(u.aniso_perp));
    const it = Math.max(1, Math.min(16, Math.ceil((dmax * Number(u.dt)) / 0.2)));
    const subs = Math.max(1, Number(u.nsub));
    for (let s = 0; s < subs; s++) {
      for (let i = 0; i < it; i++) g.advance(1, [inputs.source, inputs.sink, inputs.direction, inputs.conductivity], { ...u, sub: s, dt: Number(u.dt) / it });
    }
  },
  presets: HEAT_PRESETS,
});

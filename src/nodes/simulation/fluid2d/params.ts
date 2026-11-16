/**
 * Fluid 2D parameters + the pure (GPU-free) functions that turn them into solver configuration / per-frame values.
 * Param ids are stored in project files: never rename (bump `version` + `migrateParams`).
 */
import { P, type ParamSchema, type ParamValues } from '../../../engine/params/schema';
import { limitSimResolution, stepDt, type LoopMode } from '../../../engine/sim/core';
import { bytesPerCellEstimate, type FluidConfig, type FluidEmitterFrame, type FluidFrame, type PressureMode } from './solver';

export const QUALITY = {
  draft: { res: 128, maxSub: 2, pressure: 'fast', iters: 24, cycles: 1 },
  balanced: { res: 256, maxSub: 3, pressure: 'balanced', iters: 30, cycles: 2 },
  high: { res: 512, maxSub: 4, pressure: 'balanced', iters: 30, cycles: 3 },
  ultra: { res: 1024, maxSub: 6, pressure: 'accurate', iters: 8, cycles: 1 },
} as const;

const emitterParams = (n: 1 | 2, on: boolean, pos: [number, number]): ParamSchema => {
  const g = `Emitter ${n}`;
  const k = `em${n}_`;
  const shown = (v: ParamValues): boolean => v[`${k}on`] === true;
  return [
    P.bool(`${k}on`, on, { group: g, label: 'Enabled' }),
    P.enum(`${k}shape`, 'circle', [{ value: 'circle', label: 'Circle' }, { value: 'rect', label: 'Rectangle' }, { value: 'line', label: 'Line' }], { group: g, label: 'Shape', visibleIf: shown }),
    P.vec2(`${k}pos`, pos, { group: g, label: 'Position', min: -1, max: 2, step: 0.005, visibleIf: shown, tooltip: 'Centre in tile space (0..1, y down).' }),
    P.float(`${k}radius`, 0.06, { group: g, label: 'Radius', min: 0.002, max: 1, softMax: 0.4, step: 0.002, animatable: true, visibleIf: shown, tooltip: 'Circle radius / line thickness (fraction of the image height).' }),
    P.vec2(`${k}size`, [0.1, 0.04], { group: g, label: 'Half size', min: 0.002, max: 1, step: 0.002, visibleIf: (v) => shown(v) && v[`${k}shape`] === 'rect' }),
    P.vec2(`${k}pos2`, [pos[0] + 0.2, pos[1]], { group: g, label: 'Line end', min: -1, max: 2, step: 0.005, visibleIf: (v) => shown(v) && v[`${k}shape`] === 'line' }),
    P.float(`${k}soft`, 0.5, { group: g, label: 'Softness', min: 0.001, max: 1, step: 0.01, display: 'percent', visibleIf: shown }),
    P.float(`${k}density`, 6, { group: g, label: 'Density', min: 0, max: 200, softMax: 30, step: 0.1, animatable: true, visibleIf: shown, tooltip: 'Amount per second added inside the shape.' }),
    P.float(`${k}temperature`, 3, { group: g, label: 'Temperature', min: -50, max: 200, softMax: 30, step: 0.1, animatable: true, visibleIf: shown }),
    P.float(`${k}fuel`, 0, { group: g, label: 'Fuel', min: 0, max: 200, softMax: 30, step: 0.1, animatable: true, visibleIf: shown }),
    P.float(`${k}expand`, 0, { group: g, label: 'Expansion', min: -100, max: 400, softMax: 60, step: 0.1, animatable: true, visibleIf: shown, tooltip: 'Divergence source: pushes the gas outwards (explosions).' }),
    P.float(`${k}dir`, -90, { group: g, label: 'Direction', display: 'angle', min: -360, max: 360, step: 1, animatable: true, visibleIf: shown, tooltip: 'Emission direction (degrees, clockwise on screen; -90 = up).' }),
    P.float(`${k}speed`, 0, { group: g, label: 'Velocity', min: 0, max: 10, softMax: 2, step: 0.01, animatable: true, visibleIf: shown, unit: 'tile/s' }),
    P.enum(`${k}mode`, 'continuous', [{ value: 'continuous', label: 'Continuous' }, { value: 'burst', label: 'Burst' }], { group: g, label: 'Mode', visibleIf: shown }),
    P.int(`${k}burst`, 6, { group: g, label: 'Burst length (frames)', min: 1, max: 600, softMax: 60, visibleIf: (v) => shown(v) && v[`${k}mode`] === 'burst' }),
    P.int(`${k}start`, 0, { group: g, label: 'Start frame', min: 0, max: 100000, softMax: 200, visibleIf: shown }),
    P.int(`${k}end`, -1, { group: g, label: 'End frame', min: -1, max: 100000, softMax: 200, visibleIf: shown, tooltip: '-1 = never ends.' }),
    P.float(`${k}noise`, 0, { group: g, label: 'Noise modulation', min: 0, max: 1, step: 0.01, display: 'percent', visibleIf: shown }),
    P.int(`${k}noise_scale`, 4, { group: g, label: 'Noise scale', min: 1, max: 32, visibleIf: shown }),
  ];
};

export const FLUID_PARAMS: ParamSchema = [
  /* ---- simulation ---- */
  P.enum('quality', 'balanced', [{ value: 'draft', label: 'Draft' }, { value: 'balanced', label: 'Balanced' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }, { value: 'custom', label: 'Custom' }], { group: 'Simulation', label: 'Quality preset', tooltip: 'Draft 128, Balanced 256, High 512, Ultra 1024 cells; also sets sub-steps and the pressure solver. Custom uses the values below.' }),
  P.int('sim_res', 256, { group: 'Simulation', label: 'Sim resolution', min: 16, max: 2048, softMin: 64, softMax: 1024, unit: 'cells', visibleIf: (v) => v.quality === 'custom', tooltip: 'Cells along the longer side (rounded to a multiple of 16, limited by device limits and memory).' }),
  P.enum('precision', 'half', [{ value: 'half', label: 'Standard (16-bit)' }, { value: 'full', label: 'High (32-bit)' }], { group: 'Simulation', label: 'State precision', tooltip: 'High precision stores the state in 32-bit floats (twice the memory, sampled manually).' }),
  P.float('speed', 1, { group: 'Simulation', label: 'Speed', min: 0.05, max: 8, softMax: 3, step: 0.05, tooltip: 'Simulated seconds per real second. dt = (1/fps) * speed / sub-steps.' }),
  P.int('substeps', 1, { group: 'Simulation', label: 'Min sub-steps', min: 1, max: 8, visibleIf: (v) => v.quality === 'custom' }),
  P.int('max_substeps', 4, { group: 'Simulation', label: 'Max sub-steps', min: 1, max: 16, visibleIf: (v) => v.quality === 'custom', tooltip: 'Upper limit of the CFL-adaptive sub-step count.' }),
  P.bool('adaptive', true, { group: 'Simulation', label: 'Adaptive sub-steps', tooltip: 'More sub-steps when the flow is fast (CFL condition). Deterministic: a function of the state only.' }),
  P.float('cfl', 1.5, { group: 'Simulation', label: 'CFL limit', min: 0.25, max: 6, step: 0.05, advanced: true, tooltip: 'Maximum advection distance in cells per sub-step.' }),
  P.enum('boundary', 'open', [{ value: 'closed', label: 'Closed (walls)' }, { value: 'open', label: 'Open (outflow)' }, { value: 'periodic', label: 'Periodic / tileable' }], { group: 'Simulation', label: 'Boundary', tooltip: 'Periodic wraps in both directions: the result tiles seamlessly.' }),
  P.enum('advection', 'maccormack', [{ value: 'maccormack', label: 'MacCormack (clamped)' }, { value: 'semi', label: 'Semi-Lagrangian' }], { group: 'Numerics', label: 'Advection', tooltip: 'MacCormack is low-dissipation with min/max limiting; semi-Lagrangian is cheaper and smoother.' }),
  P.enum('backtrace', 'rk2', [{ value: 'rk1', label: 'Euler' }, { value: 'rk2', label: 'RK2' }, { value: 'rk3', label: 'RK3' }], { group: 'Numerics', label: 'Back-trace' }),
  P.enum('pressure', 'balanced', [{ value: 'fast', label: 'Fast (Jacobi)' }, { value: 'balanced', label: 'Balanced (multigrid)' }, { value: 'accurate', label: 'Accurate (PCG)' }], { group: 'Numerics', label: 'Pressure solver', visibleIf: (v) => v.quality === 'custom' }),
  P.int('iterations', 30, { group: 'Numerics', label: 'Iterations', min: 1, max: 200, softMax: 80, visibleIf: (v) => v.quality === 'custom' && v.pressure !== 'balanced', tooltip: 'Jacobi sweeps (Fast) or conjugate-gradient iterations (Accurate).' }),
  P.int('cycles', 2, { group: 'Numerics', label: 'V-cycles', min: 1, max: 6, visibleIf: (v) => v.quality === 'custom' && v.pressure === 'balanced' }),
  P.bool('warm_start', true, { group: 'Numerics', label: 'Warm start', tooltip: 'Start the pressure solve from the previous pressure.' }),
  P.float('viscosity', 0, { group: 'Numerics', label: 'Viscosity', min: 0, max: 0.1, softMax: 0.002, step: 0.00001, precision: 5, tooltip: 'Kinematic viscosity (tile^2 / s), Jacobi diffusion.' }),
  P.bool('noslip', false, { group: 'Numerics', label: 'No-slip obstacles', tooltip: 'Off = free-slip (flow slides along obstacles).' }),
  P.bool('obstacle_motion', true, { group: 'Numerics', label: 'Moving obstacles', tooltip: 'Obstacle velocity is estimated from the frame difference of the Obstacle mask.' }),
  P.seed('seed', 1, { group: 'Simulation', label: 'Seed' }),
  P.int('warmup', 0, { group: 'Simulation', label: 'Warm-up frames', min: 0, max: 600, softMax: 120, tooltip: 'Frames simulated before frame 0 (pre-roll, not shown).' }),
  /* ---- looping ---- */
  P.enum('loop_mode', 'none', [{ value: 'none', label: 'None' }, { value: 'crossfade', label: 'Crossfade' }, { value: 'periodic', label: 'Periodic forcing' }], { group: 'Loop', label: 'Loop mode', tooltip: 'Crossfade: simulates L+B frames and blends the first B output frames with the same frames one loop later. Periodic forcing: emitters and forces repeat with period L (use with a periodic boundary).' }),
  P.int('loop_frames', 0, { group: 'Loop', label: 'Loop length (frames)', min: 0, max: 4096, softMax: 240, visibleIf: (v) => v.loop_mode !== 'none', tooltip: '0 = the graph loop length.' }),
  P.int('blend_frames', 16, { group: 'Loop', label: 'Blend length (frames)', min: 1, max: 1024, softMax: 64, visibleIf: (v) => v.loop_mode === 'crossfade' }),
  /* ---- cache ---- */
  P.int('cache_mb', 64, { group: 'Cache', label: 'Cache budget (MB)', min: 1, max: 4096, softMax: 512, tooltip: 'Hard limit of the output frame cache + checkpoints of this node (also limited by the global memory budget).' }),
  P.bool('paused', false, { group: 'Cache', label: 'Pause simulation', tooltip: 'Stop simulating new frames (cached frames stay available).' }),
  /* ---- forces ---- */
  P.vec2('gravity', [0, 0], { group: 'Forces', label: 'Gravity', min: -20, max: 20, softMin: -3, softMax: 3, step: 0.01, unit: 'tile/s²' }),
  P.float('wind_angle', 0, { group: 'Forces', label: 'Wind direction', display: 'angle', min: -360, max: 360, step: 1, animatable: true }),
  P.float('wind_strength', 0, { group: 'Forces', label: 'Wind strength', min: 0, max: 20, softMax: 3, step: 0.01, animatable: true, unit: 'tile/s²', tooltip: 'Animate it for gusts.' }),
  P.float('buoy_density', 0, { group: 'Forces', label: 'Density weight', min: 0, max: 20, softMax: 3, step: 0.01, tooltip: 'Heavy smoke sinks (alpha).' }),
  P.float('buoy_temp', 1, { group: 'Forces', label: 'Temperature lift', min: 0, max: 20, softMax: 4, step: 0.01, tooltip: 'Hot gas rises (beta).' }),
  P.float('ambient', 0, { group: 'Forces', label: 'Ambient temperature', min: -10, max: 10, step: 0.05 }),
  P.float('vort_eps', 3, { group: 'Forces', label: 'Vorticity confinement', min: 0, max: 100, softMax: 20, step: 0.1, animatable: true }),
  P.float('vort_scale', 1, { group: 'Forces', label: 'Vorticity scale', min: 0.25, max: 8, step: 0.05, advanced: true, tooltip: 'Length scale in cells.' }),
  P.float('drag', 0, { group: 'Forces', label: 'Drag', min: 0, max: 20, softMax: 3, step: 0.01 }),
  P.float('damping', 0, { group: 'Forces', label: 'Velocity damping', min: 0, max: 20, softMax: 3, step: 0.01 }),
  P.float('turb_strength', 0, { group: 'Turbulence', label: 'Strength', min: 0, max: 20, softMax: 4, step: 0.01, animatable: true, tooltip: 'Curl-noise acceleration (divergence free).' }),
  P.int('turb_scale', 4, { group: 'Turbulence', label: 'Scale', min: 1, max: 32, tooltip: 'Wave number: features per tile (integer so the field tiles).' }),
  P.float('turb_speed', 1, { group: 'Turbulence', label: 'Speed', min: 0, max: 16, step: 0.05, tooltip: 'Cycles per loop with a loop mode (rounded to an integer so the noise loops in Z), cycles per second otherwise.' }),
  P.vec2('swirl_pos', [0.5, 0.5], { group: 'Swirl', label: 'Position', min: -1, max: 2, step: 0.005 }),
  P.float('swirl_radius', 0.15, { group: 'Swirl', label: 'Radius', min: 0.005, max: 1, step: 0.005 }),
  P.float('swirl_strength', 0, { group: 'Swirl', label: 'Strength', min: -50, max: 50, softMin: -10, softMax: 10, step: 0.01, animatable: true, tooltip: 'Tangential acceleration; the sign sets the direction.' }),
  /* ---- combustion ---- */
  P.float('ignition', 0.6, { group: 'Combustion', label: 'Ignition temperature', min: 0, max: 50, step: 0.05 }),
  P.float('burn_rate', 0, { group: 'Combustion', label: 'Burn rate', min: 0, max: 100, softMax: 20, step: 0.05, unit: '1/s', tooltip: '0 disables combustion (fuel is only advected).' }),
  P.float('heat_release', 4, { group: 'Combustion', label: 'Heat release', min: 0, max: 100, softMax: 20, step: 0.05 }),
  P.float('expansion', 0, { group: 'Combustion', label: 'Expansion', min: 0, max: 50, softMax: 10, step: 0.05, tooltip: 'Gas expansion of burning fuel (divergence source).' }),
  P.float('cooling', 1.2, { group: 'Combustion', label: 'Cooling rate', min: 0, max: 20, softMax: 5, step: 0.01, unit: '1/s' }),
  P.float('radiative', 0, { group: 'Combustion', label: 'Radiative cooling', min: 0, max: 5, step: 0.005, advanced: true }),
  P.float('smoke_gen', 0, { group: 'Combustion', label: 'Smoke from burning', min: 0, max: 20, softMax: 5, step: 0.01 }),
  P.float('soot_gen', 0, { group: 'Combustion', label: 'Soot from burning', min: 0, max: 20, softMax: 5, step: 0.01 }),
  P.float('soot_decay', 0.3, { group: 'Combustion', label: 'Soot decay', min: 0, max: 20, step: 0.01 }),
  /* ---- dissipation / clamps ---- */
  P.float('diss_density', 0.2, { group: 'Dissipation', label: 'Density', min: 0, max: 20, softMax: 3, step: 0.01, unit: '1/s' }),
  P.float('diss_temp', 0, { group: 'Dissipation', label: 'Temperature', min: 0, max: 20, softMax: 3, step: 0.01, unit: '1/s' }),
  P.float('diss_fuel', 0, { group: 'Dissipation', label: 'Fuel', min: 0, max: 20, softMax: 3, step: 0.01, unit: '1/s' }),
  P.float('diss_velocity', 0, { group: 'Dissipation', label: 'Velocity', min: 0, max: 20, softMax: 3, step: 0.01, unit: '1/s' }),
  P.float('max_density', 4, { group: 'Dissipation', label: 'Max density', min: 0.1, max: 100, softMax: 10, step: 0.1 }),
  P.float('max_temp', 8, { group: 'Dissipation', label: 'Max temperature', min: 0.1, max: 200, softMax: 30, step: 0.1 }),
  P.float('max_fuel', 4, { group: 'Dissipation', label: 'Max fuel', min: 0.1, max: 100, softMax: 10, step: 0.1 }),
  P.float('max_speed', 3, { group: 'Dissipation', label: 'Max speed', min: 0.1, max: 50, softMax: 10, step: 0.1, unit: 'tile/s', tooltip: 'Velocity limiter (deterministic stability guard).' }),
  /* ---- pins ---- */
  P.float('gain_density', 1, { group: 'Inputs', label: 'Density emit gain', min: 0, max: 100, softMax: 10, step: 0.1, animatable: true }),
  P.float('gain_temperature', 1, { group: 'Inputs', label: 'Temperature emit gain', min: 0, max: 100, softMax: 10, step: 0.1, animatable: true }),
  P.float('gain_fuel', 1, { group: 'Inputs', label: 'Fuel emit gain', min: 0, max: 100, softMax: 10, step: 0.1, animatable: true }),
  P.float('gain_velocity', 1, { group: 'Inputs', label: 'Velocity emit gain', min: 0, max: 100, softMax: 10, step: 0.1, animatable: true }),
  ...emitterParams(1, true, [0.5, 0.88]),
  ...emitterParams(2, false, [0.5, 0.5]),
  /* ---- outputs ---- */
  P.enum('out_filter', 'cubic', [{ value: 'cubic', label: 'Bicubic' }, { value: 'linear', label: 'Bilinear' }, { value: 'point', label: 'Point' }], { group: 'Output', label: 'Resample filter', tooltip: 'Quality filter used to resample the simulation grid to the graph resolution.' }),
  P.float('out_gain', 1, { group: 'Output', label: 'Gain', min: -100, max: 100, softMax: 10, step: 0.01, tooltip: 'Multiplies Density, Temperature, Fuel, Pressure, Divergence, Curl.' }),
  P.float('out_opacity', 2.5, { group: 'Output', label: 'Smoke opacity', min: 0, max: 40, softMax: 8, step: 0.05 }),
  P.color('out_smoke_color', [0.82, 0.82, 0.86, 1], { group: 'Output', label: 'Smoke colour' }),
  P.float('out_temp_scale', 0.3, { group: 'Output', label: 'Temperature scale', min: 0.01, max: 10, step: 0.01, tooltip: 'Temperature that maps to the white end of the black-body ramp is 1 / this.' }),
  P.float('out_fire_gain', 1, { group: 'Output', label: 'Fire intensity', min: 0, max: 20, softMax: 4, step: 0.05 }),
  P.float('out_soot_dark', 0.5, { group: 'Output', label: 'Soot darkening', min: 0, max: 10, step: 0.05 }),
  P.float('out_fire_lo', 0.15, { group: 'Output', label: 'Fire mask low', min: 0, max: 50, step: 0.01 }),
  P.float('out_fire_hi', 0.6, { group: 'Output', label: 'Fire mask high', min: 0.001, max: 50, step: 0.01 }),
  P.float('out_normal_strength', 6, { group: 'Output', label: 'Normal strength', min: 0, max: 100, softMax: 30, step: 0.1 }),
];

/* ------------------------------------------------------------------------------------------------ pure helpers */
const num = (v: ParamValues, id: string, d = 0): number => (typeof v[id] === 'number' ? (v[id] as number) : d);
const vec = (v: ParamValues, id: string, d: [number, number] = [0, 0]): [number, number] => (Array.isArray(v[id]) ? [Number((v[id] as number[])[0]), Number((v[id] as number[])[1])] : d);

export interface FluidSetup {
  cfg: FluidConfig;
  w: number;
  h: number;
  limited: boolean;
  fps: number;
  speed: number;
  warmup: number;
  loopMode: LoopMode;
  loopLength: number;
  blend: number;
  cacheBytes: number;
  periodic: boolean;
}

export function resolveFluidConfig(p: ParamValues, g: { fps: number; loopLength: number; width: number; height: number }, dev: { maxDim: number; budgetBytes: number }): FluidSetup {
  const q = String(p.quality ?? 'balanced') as keyof typeof QUALITY | 'custom';
  const preset = q === 'custom' ? null : QUALITY[q];
  const pressure = (preset ? preset.pressure : String(p.pressure ?? 'balanced')) as PressureMode;
  const wanted = preset ? preset.res : num(p, 'sim_res', 256);
  const precision = p.precision === 'full' ? 'full' : 'half';
  const dims = limitSimResolution(wanted, g.width / Math.max(1, g.height), { maxDim: dev.maxDim, budgetBytes: dev.budgetBytes, bytesPerCell: bytesPerCellEstimate(precision, pressure) });
  const bmode = p.boundary === 'closed' ? 0 : p.boundary === 'periodic' ? 2 : 1;
  const maxSub = preset ? preset.maxSub : Math.max(1, Math.round(num(p, 'max_substeps', 4)));
  const minSub = Math.min(maxSub, Math.max(1, Math.round(preset ? 1 : num(p, 'substeps', 1))));
  const loopMode = (['none', 'crossfade', 'periodic'].includes(String(p.loop_mode)) ? p.loop_mode : 'none') as LoopMode;
  const loopLength = Math.round(num(p, 'loop_frames', 0)) || g.loopLength;
  const cfg: FluidConfig = {
    w: dims.w,
    h: dims.h,
    precision,
    bmode: bmode as 0 | 1 | 2,
    pressure,
    iters: Math.max(1, Math.round(preset ? preset.iters : num(p, 'iterations', 30))),
    cycles: Math.max(1, Math.round(preset ? preset.cycles : num(p, 'cycles', 2))),
    warmStart: p.warm_start !== false,
    maccormack: p.advection !== 'semi',
    rk: p.backtrace === 'rk1' ? 1 : p.backtrace === 'rk3' ? 3 : 2,
    minSub,
    maxSub,
    cfl: num(p, 'cfl', 1.5),
    adaptive: p.adaptive !== false,
    noslip: p.noslip === true,
    viscIters: 6,
  };
  return {
    cfg, w: dims.w, h: dims.h, limited: dims.limited, fps: g.fps, speed: Math.max(0.01, num(p, 'speed', 1)), warmup: Math.max(0, Math.round(num(p, 'warmup', 0))),
    loopMode, loopLength: Math.max(1, loopLength), blend: Math.max(1, Math.round(num(p, 'blend_frames', 16))), cacheBytes: Math.max(1, Math.round(num(p, 'cache_mb', 64))) * 1048576, periodic: bmode === 2,
  };
}

/** Burst / continuous amount of an emitter at `frame` (0 outside the active frame range). */
export function emitterAmount(mode: string, strength: number, frame: number, start: number, end: number, burstLen: number): number {
  if (frame < start || (end >= 0 && frame > end)) return 0;
  if (mode === 'burst') {
    const t = (frame - start) / Math.max(1, burstLen);
    return t >= 1 ? 0 : strength * (1 - t);
  }
  return strength;
}

export function buildEmitter(p: ParamValues, n: 1 | 2, frame: number): FluidEmitterFrame {
  const k = `em${n}_`;
  const on = p[`${k}on`] === true;
  const mode = String(p[`${k}mode`] ?? 'continuous');
  const amt = (id: string): number => emitterAmount(mode, num(p, `${k}${id}`), frame, Math.round(num(p, `${k}start`)), Math.round(num(p, `${k}end`, -1)), Math.round(num(p, `${k}burst`, 6)));
  const shape = p[`${k}shape`] === 'rect' ? 1 : p[`${k}shape`] === 'line' ? 2 : 0;
  const pos = vec(p, `${k}pos`, [0.5, 0.5]);
  const pos2 = vec(p, `${k}pos2`, [0.7, 0.5]);
  const size = vec(p, `${k}size`, [0.1, 0.04]);
  const active = on && frame >= Math.round(num(p, `${k}start`)) && (num(p, `${k}end`, -1) < 0 || frame <= num(p, `${k}end`, -1));
  const a = (num(p, `${k}dir`, -90) * Math.PI) / 180;
  const sp = mode === 'burst' ? amt('speed') : num(p, `${k}speed`);
  return {
    shape, x: pos[0], y: pos[1], rx: shape === 1 ? size[0] : num(p, `${k}radius`, 0.06), ry: shape === 1 ? size[1] : num(p, `${k}radius`, 0.06), x2: pos2[0], y2: pos2[1],
    dens: amt('density'), temp: amt('temperature'), fuel: amt('fuel'), expand: amt('expand'), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
    noise: num(p, `${k}noise`), nscale: num(p, `${k}noise_scale`, 4), soft: num(p, `${k}soft`, 0.5), active,
  };
}

/** All per-frame values of the solver for the simulated frame `frame` (the forcing frame: periodic modes wrap it). */
export function buildFluidFrame(p: ParamValues, frame: number, setup: Pick<FluidSetup, 'fps' | 'speed' | 'loopMode' | 'loopLength'>): FluidFrame {
  const dtFrame = stepDt({ fps: setup.fps, speed: setup.speed, substeps: 1 });
  const loopSec = setup.loopLength * dtFrame;
  const cycles = Math.max(0, Math.round(num(p, 'turb_speed', 1)));
  const turbOmega = setup.loopMode === 'periodic' && loopSec > 0 ? (2 * Math.PI * cycles) / loopSec : 2 * Math.PI * num(p, 'turb_speed', 1);
  const wa = (num(p, 'wind_angle') * Math.PI) / 180;
  const ws = num(p, 'wind_strength');
  const gv = vec(p, 'gravity');
  const sw = vec(p, 'swirl_pos', [0.5, 0.5]);
  const gain = (id: string): number => num(p, id, 1);
  const em = [buildEmitter(p, 1, frame), buildEmitter(p, 2, frame)];
  return {
    time: frame * dtFrame,
    dtFrame,
    gravity: gv,
    wind: [Math.cos(wa) * ws, Math.sin(wa) * ws],
    buoy: [num(p, 'buoy_density'), num(p, 'buoy_temp', 1), num(p, 'ambient')],
    turb: [num(p, 'turb_strength'), Math.max(1, Math.round(num(p, 'turb_scale', 4)))],
    turbOmega,
    swirl: [sw[0], sw[1], Math.max(1e-3, num(p, 'swirl_radius', 0.15)), num(p, 'swirl_strength')],
    drag: num(p, 'drag'),
    damp: num(p, 'damping'),
    vortEps: num(p, 'vort_eps'),
    vortScale: num(p, 'vort_scale', 1),
    visc: num(p, 'viscosity'),
    diss: [num(p, 'diss_density'), num(p, 'diss_temp'), num(p, 'diss_fuel'), num(p, 'diss_velocity')],
    sootDecay: num(p, 'soot_decay'),
    comb: [num(p, 'ignition', 0.6), num(p, 'burn_rate'), num(p, 'heat_release', 4), num(p, 'expansion')],
    cool: [num(p, 'cooling', 1.2), num(p, 'smoke_gen'), num(p, 'radiative'), num(p, 'soot_gen')],
    cmax: [num(p, 'max_density', 4), num(p, 'max_temp', 8), num(p, 'max_fuel', 4), num(p, 'max_speed', 3)],
    gains: [gain('gain_density'), gain('gain_temperature'), gain('gain_fuel'), gain('gain_velocity')],
    emitters: em,
    seed: Math.max(0, Math.round(num(p, 'seed', 1))),
    obstMove: p.obstacle_motion !== false,
    vmax: Math.max(0.1, num(p, 'max_speed', 3)),
    initTemp: 0,
  };
}

/** Params that do NOT change the simulation state (output look, cache size, pause): excluded from the invalidation key. */
export const isSimParam = (id: string): boolean => !(id.startsWith('out_') || id === 'cache_mb' || id === 'paused' || id.startsWith('tex_'));

import { defineNode } from '../../../engine/graph/node';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { advectParticles, type BoundsMode, type IntegrationMethod, type SeedShape } from '../../../engine/particles/vector-particles';
import { P, type ParamSchema } from '../../../engine/params/schema';
import emitter, { readEmitterParams } from '../../particle/emitter/definition';

/** Emitter parameters that Vector Particles shares (timing, limits and the whole Look tab): reused, not redeclared. */
const SHARED = ['mode', 'count', 'lifetime', 'spawn_window', 'seed', 'max_points', 'size_pscale', 'size_random', 'size_over_life', 'size_curve', 'rotation', 'rotation_random', 'spin_turns', 'color', 'intensity', 'color_over_life', 'color_gradient', 'alpha_over_life', 'alpha_curve'];
const DEFAULTS: Record<string, number> = { max_points: 50_000, count: 2000, lifetime: 0.5 };
const shared: ParamSchema = (emitter.params ?? []).filter((d) => SHARED.includes(d.id)).map((d) => ((d.type === 'int' || d.type === 'float') && d.id in DEFAULTS ? { ...d, default: DEFAULTS[d.id] } : d));
const seedShape = (v: Record<string, unknown>): boolean => v.seed_shape === 'disc' || v.seed_shape === 'line';

/**
 * vector.particles: carries a deterministic particle set along a Vector field (RK1 / RK2 / RK4 pathlines of the current field) and outputs Points
 * for 2D Render / Copy To Points. Closed form in time (no state): loops, scrubbing and exports are exact. The field is read through the async CPU
 * snapshot (<= 512 px): until it arrives the particles stay at their seeds. Math + limits: engine/particles/vector-particles.ts.
 */
export default defineNode({
  id: 'vector.particles',
  version: 1,
  category: 'vector',
  title: 'Vector Particles',
  description: 'Advects a seeded particle set through a Vector field (Euler / RK2 / RK4) and outputs Points for 2D Render. Seed from the whole tile, a disc, a line or an input Points set. Deterministic, loops seamlessly, hard particle cap and a bounded integration budget.',
  keywords: ['vector', 'particles', 'advect', 'points', 'flow', 'wind', 'field', 'streak', 'sparks', 'dust', 'fluid'],
  icon: 'points-shape',
  inputs: [
    { id: 'vector', name: 'Vector', type: 'vector', tooltip: 'The flow field (tile fractions per second). Fluid 2D velocity, Vector Noise, Vortex ...' },
    { id: 'points', name: 'Points', type: 'points', optional: true, tooltip: 'Optional: seed the particles at these points (Seed from = Input points).' },
  ],
  outputs: [{ id: 'points', name: 'Points', type: 'points' }],
  cpuTextureInputs: ['vector'],
  timeDependent: true,
  cost: { gpu: 'trivial', tiling: 'global' },
  params: [
    ...shared,
    P.enum('seed_shape', 'random', [{ value: 'random', label: 'Whole tile' }, { value: 'disc', label: 'Disc' }, { value: 'line', label: 'Line' }, { value: 'points', label: 'Input points' }], { tab: 'Emission', group: 'Seeding', label: 'Seed from' }),
    P.vec2('p_a', [0.5, 0.5], { tab: 'Emission', group: 'Seeding', label: 'Start / centre', min: -1, max: 2, step: 0.005, animatable: true, visibleIf: seedShape, tooltip: 'Disc centre or line start (tile space, y down).' }),
    P.vec2('p_b', [0.8, 0.5], { tab: 'Emission', group: 'Seeding', label: 'End', min: -1, max: 2, step: 0.005, animatable: true, visibleIf: (v) => v.seed_shape === 'line' }),
    P.float('radius', 0.15, { tab: 'Emission', group: 'Seeding', label: 'Seed radius', min: 0, max: 2, softMax: 0.7, step: 0.005, animatable: true, visibleIf: (v) => v.seed_shape === 'disc', tooltip: 'Fraction of the smaller image side.' }),
    P.float('travel', 2, { tab: 'Flow', group: 'Advection', label: 'Travel time', min: 0, max: 1000, softMax: 20, step: 0.05, unit: 's', animatable: true, tooltip: 'Seconds of flow carried over one whole particle life.' }),
    P.float('flow_speed', 1, { tab: 'Flow', group: 'Advection', label: 'Speed', min: -100, max: 100, softMin: -4, softMax: 4, step: 0.01, animatable: true, tooltip: 'Multiplies the field (negative = against the flow).' }),
    P.float('speed_random', 0.25, { tab: 'Flow', group: 'Advection', label: 'Speed variation', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.enum('method', 'rk2', [{ value: 'rk1', label: 'Euler' }, { value: 'rk2', label: 'RK2' }, { value: 'rk4', label: 'RK4' }], { tab: 'Flow', group: 'Integration', label: 'Method' }),
    P.float('step', 0.05, { tab: 'Flow', group: 'Integration', label: 'Step size', min: 0.001, max: 5, softMax: 0.5, step: 0.005, unit: 's' }),
    P.int('max_steps', 128, { tab: 'Flow', group: 'Integration', label: 'Max steps per path', min: 2, max: 1024, softMax: 256, advanced: true, tooltip: 'The step grows when a path would need more; the total work (particles x steps) is capped as well.' }),
    P.enum('bounds', 'wrap', [{ value: 'wrap', label: 'Wrap (tileable)' }, { value: 'kill', label: 'Kill outside' }, { value: 'clamp', label: 'Clamp to edge' }], { tab: 'Flow', group: 'Integration', label: 'Boundary' }),
    P.enum('plane', 'xy', [{ value: 'xy', label: 'XY' }, { value: 'xz', label: 'XZ' }, { value: 'yz', label: 'YZ' }], { tab: 'Flow', group: 'View', tooltip: 'Match the 2D Render plane / view settings.' }),
    P.vec2('view_center', [0, 0], { tab: 'Flow', group: 'View', label: 'View center', step: 0.01, softMin: -2, softMax: 2 }),
    P.float('view_extent', 1, { tab: 'Flow', group: 'View', label: 'View width (world)', min: 0.001, max: 1000, softMax: 4, step: 0.01, tooltip: 'World units covered by the image width (same as 2D Render).' }),
  ],
  gizmos: [
    { id: 'seed_disc', label: 'Seed disc', type: 'circle', viewport: '2d', space: 'uv', center: 'p_a', radius: 'radius', visibleIf: (v) => v.seed_shape === 'disc' },
    { id: 'seed_line', label: 'Seed line', type: 'line', viewport: '2d', space: 'uv', from: 'p_a', to: 'p_b', visibleIf: (v) => v.seed_shape === 'line' },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const snap = ctx.cpuTexture?.('vector') ?? null;
    const input = ctx.texInput('vector');
    const vecScale = input?.vecScale && input.vecScale > 0 ? input.vecScale : 1;
    const view = { plane: p.str('plane') as 'xy', center: p.vec2('view_center') as [number, number], extent: Math.max(1e-6, p.num('view_extent')), aspect: Math.max(1e-6, ctx.frame.fullWidth / Math.max(1, ctx.frame.fullHeight)) };
    const pts = asMesh(ctx.inputs.points) ?? null;
    const shape = p.str('seed_shape') as SeedShape;
    const out = advectParticles(
      {
        emitter: readEmitterParams(p, ctx.frame.loopPhase),
        field: snap ? { w: snap.width, h: snap.height, data: snap.data, channels: snap.channels, perSecond: 1 / vecScale } : null,
        seedShape: shape === 'points' && !pts ? 'random' : shape,
        a: p.vec2('p_a') as [number, number], b: p.vec2('p_b') as [number, number], radius: p.num('radius'),
        travel: p.num('travel'), speed: p.num('flow_speed'), speedRandom: p.num('speed_random'),
        method: p.str('method') as IntegrationMethod, stepSize: p.num('step'), maxSteps: p.int('max_steps'), bounds: p.str('bounds') as BoundsMode, view,
      },
      pts,
    );
    return { points: meshValue(out, 'points') };
  },
});

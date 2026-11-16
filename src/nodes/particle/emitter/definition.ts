import { defaultEmitterParams, emitParticles, type EmitterParams } from '../../../engine/particles/emitter';
import { defineNode } from '../../../engine/graph/node';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { P, type CurveValue, type GradientValue } from '../../../engine/params/schema';

const FADE_IN_OUT: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 0.1, y: 1 }, { x: 0.7, y: 1 }, { x: 1, y: 0 }] };
const SHRINK: CurveValue = { keys: [{ x: 0, y: 1 }, { x: 1, y: 0 }] };
const EMBER: GradientValue = { stops: [{ pos: 0, color: [1, 0.85, 0.4, 1] }, { pos: 0.5, color: [1, 0.35, 0.05, 1] }, { pos: 1, color: [0.5, 0.05, 0, 1] }] };

type Acc = { num(id: string): number; int(id: string): number; bool(id: string): boolean; str(id: string): string; vec3(id: string): number[]; rgba(id: string): number[]; seed(id: string): number; curve(id: string): CurveValue; gradient(id: string): GradientValue };

/** Params -> engine parameters (pure; exported for tests). */
export function readEmitterParams(p: Acc, phase: number): EmitterParams {
  return {
    ...defaultEmitterParams(),
    mode: p.str('mode') as EmitterParams['mode'],
    count: p.int('count'),
    seed: p.seed('seed'),
    phase,
    lifetime: p.num('lifetime'),
    spawnWindow: p.num('spawn_window'),
    shape: p.str('shape') as EmitterParams['shape'],
    plane: p.str('plane') as EmitterParams['plane'],
    center: p.vec3('center') as EmitterParams['center'],
    size: p.vec3('size') as EmitterParams['size'],
    direction: p.num('direction'),
    cone: p.num('cone'),
    outward: p.bool('outward'),
    speed: p.num('speed'),
    speedRandom: p.num('speed_random'),
    gravity: p.vec3('gravity') as EmitterParams['gravity'],
    drag: p.num('drag'),
    turbulence: p.num('turbulence'),
    turbulenceFreq: p.num('turbulence_freq'),
    pointSize: p.num('size_pscale'),
    sizeRandom: p.num('size_random'),
    sizeCurve: p.bool('size_over_life') ? p.curve('size_curve') : null,
    rotation: p.num('rotation'),
    rotationRandom: p.num('rotation_random'),
    spinTurns: p.num('spin_turns'),
    color: p.rgba('color') as EmitterParams['color'],
    intensity: p.num('intensity'),
    gradient: p.bool('color_over_life') ? p.gradient('color_gradient') : null,
    alphaCurve: p.bool('alpha_over_life') ? p.curve('alpha_curve') : null,
    maxPoints: p.int('max_points'),
  };
}

/**
 * particle.emitter: deterministic, closed-form particle emitter. Burst or spread births (spawn window), lifetime, emission shape
 * (point / disc / ring / box / line or the points of an input), direction + cone (360 = everywhere) or outward, speed, gravity, drag,
 * turbulence, size / colour (HDR) / alpha over life. Every frame is evaluated directly from the loop phase (no simulation from frame 0).
 * Loop mode: C = round(1 / lifetime) lifetimes per loop => seamless; One-shot: all particles are dead by the end of the timeline.
 * Output Points feed 2D Render (velocity stretch via Trail), Copy To Points and Point Attributes. Limitations: no particle-particle
 * interaction, no collisions; turbulence is a displacement (not integrated flow).
 */
export default defineNode({
  id: 'particle.emitter',
  version: 1,
  category: 'particle',
  title: 'Emitter',
  description: 'Deterministic particle emitter: burst or continuous, cone / sphere / ring emission, speed, gravity, drag, turbulence and size / colour / alpha over life. Closed form, loops seamlessly. Feeds 2D Render and Copy To Points.',
  keywords: ['particles', 'emitter', 'burst', 'sparks', 'embers', 'debris', 'spawn', 'gravity', 'drag', 'turbulence', 'lifetime', 'cone', 'explosion', 'loop'],
  icon: 'points-shape',
  inputs: [{ id: 'points', name: 'Points', type: 'points', optional: true, tooltip: 'Optional: emit from the positions of these points (Count follows the input).' }],
  outputs: [{ id: 'points', name: 'Points', type: 'points' }],
  timeDependent: true,
  params: [
    P.enum('mode', 'oneshot', [{ value: 'oneshot', label: 'One-shot (burst)' }, { value: 'loop', label: 'Loop (continuous)' }], { tab: 'Emission', group: 'Timing', tooltip: 'One-shot: particles are born once and are all dead at the end of the timeline. Loop: C = round(1 / lifetime) lifetimes per loop, seamless.' }),
    P.int('count', 64, { tab: 'Emission', group: 'Timing', min: 0, max: 1_000_000, softMax: 500, tooltip: 'Particles per loop (loop mode: per lifetime cycle).' }),
    P.float('lifetime', 0.6, { tab: 'Emission', group: 'Timing', min: 0.01, max: 1, step: 0.005, display: 'percent', animatable: false, tooltip: 'Particle lifetime as a fraction of the loop / timeline.' }),
    P.float('spawn_window', 0.15, { tab: 'Emission', group: 'Timing', min: 0, max: 1, step: 0.005, display: 'percent', visibleIf: (v) => v.mode === 'oneshot', tooltip: 'One-shot: births are spread over this fraction of the timeline (0 = one burst at the start).' }),
    P.seed('seed', 1, { tab: 'Emission', group: 'Timing' }),
    P.enum('shape', 'point', [{ value: 'point', label: 'Point' }, { value: 'disc', label: 'Disc' }, { value: 'ring', label: 'Ring' }, { value: 'box', label: 'Box' }, { value: 'line', label: 'Line' }], { tab: 'Emission', group: 'Shape' }),
    P.enum('plane', 'xy', [{ value: 'xy', label: 'XY' }, { value: 'xz', label: 'XZ' }, { value: 'yz', label: 'YZ' }], { tab: 'Emission', group: 'Shape', tooltip: 'World plane of the emission shape and the velocity (match the 2D Render plane).' }),
    P.vec3('center', [0, 0, 0], { tab: 'Emission', group: 'Shape', step: 0.01, softMin: -2, softMax: 2, animatable: true }),
    P.vec3('size', [0.2, 0.2, 0], { tab: 'Emission', group: 'Shape', min: 0, max: 1000, step: 0.01, softMax: 2, animatable: true, tooltip: 'Extents of the emission shape (diameter for disc / ring).' }),
    P.int('max_points', 200_000, { tab: 'Emission', group: 'Limits', min: 1, max: 1_000_000, advanced: true, label: 'Hard cap' }),
    P.float('direction', 90, { tab: 'Motion', group: 'Velocity', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, tooltip: 'Emission direction in the plane (0 = +first axis, 90 = +second axis = up in XY).' }),
    P.float('cone', 360, { tab: 'Motion', group: 'Velocity', min: 0, max: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Cone angle around the direction (360 = every direction).' }),
    P.bool('outward', false, { tab: 'Motion', group: 'Velocity', tooltip: 'Emit away from the centre (explosions, rings).' }),
    P.float('speed', 0.5, { tab: 'Motion', group: 'Velocity', min: 0, max: 1000, softMax: 3, step: 0.01, animatable: true, tooltip: 'Initial speed (world units per loop).' }),
    P.float('speed_random', 0.5, { tab: 'Motion', group: 'Velocity', min: 0, max: 1, step: 0.01, display: 'percent' }),
    P.vec3('gravity', [0, -0.5, 0], { tab: 'Motion', group: 'Forces', step: 0.01, softMin: -4, softMax: 4, animatable: true, tooltip: 'Acceleration (world units per loop squared).' }),
    P.float('drag', 1, { tab: 'Motion', group: 'Forces', min: 0, max: 100, softMax: 8, step: 0.05, tooltip: 'Linear drag (1/loop): sparks decelerate.' }),
    P.float('turbulence', 0, { tab: 'Motion', group: 'Forces', min: 0, max: 10, softMax: 0.3, step: 0.005, animatable: true, tooltip: 'Noise displacement amplitude (world units), growing with age.' }),
    P.float('turbulence_freq', 2, { tab: 'Motion', group: 'Forces', min: 0, max: 64, softMax: 8, step: 0.05, visibleIf: (v) => (v.turbulence as number) > 0 }),
    P.float('size_pscale', 0.03, { tab: 'Look', group: 'Size', min: 0, max: 100, softMax: 0.5, step: 0.001, animatable: true, label: 'Size (pscale)' }),
    P.float('size_random', 0.4, { tab: 'Look', group: 'Size', min: 0, max: 1, display: 'percent', step: 0.01 }),
    P.bool('size_over_life', true, { tab: 'Look', group: 'Size' }),
    P.curve('size_curve', SHRINK, { tab: 'Look', group: 'Size', visibleIf: (v) => !!v.size_over_life, label: 'Size over life' }),
    P.float('rotation', 0, { tab: 'Look', group: 'Rotation', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle' }),
    P.float('rotation_random', 0, { tab: 'Look', group: 'Rotation', min: 0, max: 1, display: 'percent', step: 0.01 }),
    P.float('spin_turns', 0, { tab: 'Look', group: 'Rotation', min: -16, max: 16, softMin: -2, softMax: 2, step: 0.25, tooltip: 'Turns over the lifetime (random direction per particle).' }),
    P.color('color', [1, 1, 1, 1], { tab: 'Look', group: 'Color', hdr: true, animatable: true, label: 'Color (Cd)' }),
    P.float('intensity', 1, { tab: 'Look', group: 'Color', min: 0, max: 100, softMax: 8, step: 0.05, animatable: true, tooltip: 'HDR multiplier of the colour.' }),
    P.bool('color_over_life', true, { tab: 'Look', group: 'Color' }),
    P.gradient('color_gradient', EMBER, { tab: 'Look', group: 'Color', visibleIf: (v) => !!v.color_over_life, label: 'Color over life' }),
    P.bool('alpha_over_life', true, { tab: 'Look', group: 'Color' }),
    P.curve('alpha_curve', FADE_IN_OUT, { tab: 'Look', group: 'Color', visibleIf: (v) => !!v.alpha_over_life, label: 'Alpha over life' }),
  ],
  gizmos: [{ id: 'emitter', label: 'Emitter centre', type: 'point3d', viewport: '3d', space: 'world', param: 'center' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.points);
    const out = emitParticles(src ?? null, readEmitterParams(ctx.params, ctx.frame.loopPhase));
    return { points: meshValue(out, 'points') };
  },
});

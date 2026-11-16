import { defaultPointAttrParams, pointAttributes, type PointAttrParams } from '../../../engine/particles/attributes';
import { defineNode } from '../../../engine/graph/node';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { P, type CurveValue, type GradientValue } from '../../../engine/params/schema';

const FADE_OUT: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 0.15, y: 1 }, { x: 1, y: 0 }] };
const FIRE: GradientValue = { stops: [{ pos: 0, color: [1, 0.9, 0.5, 1] }, { pos: 0.5, color: [1, 0.35, 0.05, 1] }, { pos: 1, color: [0.2, 0.02, 0, 1] }] };

/** Params -> engine parameters (pure; exported for tests). */
export function readPointAttrParams(p: { num(id: string): number; int(id: string): number; bool(id: string): boolean; vec3(id: string): number[]; rgba(id: string): number[]; seed(id: string): number; curve(id: string): CurveValue; gradient(id: string): GradientValue }, phase: number): PointAttrParams {
  const d = defaultPointAttrParams();
  return {
    ...d,
    count: p.int('count'),
    seed: p.seed('seed'),
    boxCenter: p.vec3('box_center') as PointAttrParams['boxCenter'],
    boxSize: p.vec3('box_size') as PointAttrParams['boxSize'],
    phase,
    travel: p.vec3('travel') as PointAttrParams['travel'],
    wrap: p.bool('wrap'),
    snapTravel: p.bool('snap_travel'),
    driftAmount: p.num('drift_amount'),
    driftFreq: p.num('drift_freq'),
    driftCycles: p.int('drift_cycles'),
    lifeCycles: p.int('life_cycles'),
    ageRandom: p.num('age_random'),
    size: p.num('size'),
    sizeRandom: p.num('size_random'),
    sizeCurve: p.bool('size_over_age') ? p.curve('size_curve') : null,
    rotation: p.num('rotation'),
    rotationRandom: p.num('rotation_random'),
    spinTurns: p.num('spin_turns'),
    color: p.rgba('color') as PointAttrParams['color'],
    gradient: p.bool('color_over_age') ? p.gradient('color_gradient') : null,
    maxPoints: p.int('max_points'),
  };
}

/**
 * particle.point_attributes — creates (no input) or modifies (input) point attributes as a function of the loop phase:
 * position (travel per loop + periodic noise drift + wrap), velocity `v`, age (looping lifetimes), size (+ curve over age),
 * rotation / spin, colour (+ gradient over age) and id. Everything is seamlessly periodic by construction.
 */
export default defineNode({
  id: 'particle.point_attributes',
  version: 1,
  category: 'particle',
  title: 'Point Attributes',
  description:
    'Creates or modifies particle attributes over time. Position flows by a travel vector per loop (wrapped inside the emission box) with periodic noise drift; age loops N lifetimes per loop; size and colour can follow curves / gradients over age. All values are functions of the loop phase so the result loops exactly.',
  keywords: ['particles', 'points', 'emitter', 'age', 'velocity', 'drift', 'size', 'rotation', 'color', 'id'],
  icon: 'points-shape',
  inputs: [{ id: 'points', name: 'Points', type: 'points', optional: true, tooltip: 'Optional: modify these points instead of creating new ones.' }],
  outputs: [{ id: 'points', name: 'Points', type: 'points' }],
  common: { texture: false },
  timeDependent: true,
  params: [
    P.int('count', 64, { tab: 'Points', group: 'Emission', min: 1, max: 1_000_000, softMax: 1000, tooltip: 'Points created when no input is connected.' }),
    P.seed('seed', 1, { tab: 'Points', group: 'Emission' }),
    P.vec3('box_center', [0, 0, 0], { tab: 'Points', group: 'Emission', step: 0.01, softMin: -2, softMax: 2, animatable: true }),
    P.vec3('box_size', [1, 1, 0], { tab: 'Points', group: 'Emission', min: 0, max: 1000, step: 0.01, softMax: 2, animatable: true, tooltip: 'Emission and wrap box (world units). 1 × 1 covers the whole image of a 2D Render with extent 1.' }),
    P.int('max_points', 500_000, { tab: 'Points', group: 'Emission', min: 1, max: 1_000_000, advanced: true, label: 'Hard cap', tooltip: 'Safety cap on created points.' }),
    P.vec3('travel', [0, 0.5, 0], { tab: 'Motion', group: 'Flow', step: 0.01, softMin: -2, softMax: 2, animatable: true, tooltip: 'Displacement over one loop.' }),
    P.bool('wrap', true, { tab: 'Motion', group: 'Flow', tooltip: 'Wrap positions inside the box (endless flow).' }),
    P.bool('snap_travel', true, { tab: 'Motion', group: 'Flow', label: 'Snap travel to whole boxes', tooltip: 'With wrap: rounds the travel of every axis to a whole number of box sizes so the loop is exactly periodic.', visibleIf: (v) => !!v.wrap }),
    P.float('drift_amount', 0.05, { tab: 'Motion', group: 'Drift', min: 0, max: 10, softMax: 0.5, step: 0.005, animatable: true }),
    P.float('drift_freq', 2, { tab: 'Motion', group: 'Drift', min: 0, max: 64, softMax: 8, step: 0.05 }),
    P.int('drift_cycles', 1, { tab: 'Motion', group: 'Drift', min: 1, max: 16, tooltip: 'Noise cycles per loop (integer = seamless).' }),
    P.int('life_cycles', 1, { tab: 'Life', group: 'Age', min: 0, max: 16, tooltip: 'Lifetimes per loop (0 = age follows the loop phase).' }),
    P.float('age_random', 1, { tab: 'Life', group: 'Age', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Random starting age per particle.' }),
    P.float('size', 0.06, { tab: 'Look', group: 'Size', min: 0, max: 100, softMax: 0.5, step: 0.001, animatable: true, label: 'Size (pscale)' }),
    P.float('size_random', 0.5, { tab: 'Look', group: 'Size', min: 0, max: 1, display: 'percent', step: 0.01 }),
    P.bool('size_over_age', true, { tab: 'Look', group: 'Size' }),
    P.curve('size_curve', FADE_OUT, { tab: 'Look', group: 'Size', visibleIf: (v) => !!v.size_over_age, label: 'Size over age' }),
    P.float('rotation', 0, { tab: 'Look', group: 'Rotation', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
    P.float('rotation_random', 0, { tab: 'Look', group: 'Rotation', min: 0, max: 1, display: 'percent', step: 0.01 }),
    P.float('spin_turns', 0, { tab: 'Look', group: 'Rotation', min: -16, max: 16, softMin: -2, softMax: 2, step: 1, tooltip: 'Turns per loop (whole numbers loop seamlessly).' }),
    P.color('color', [1, 1, 1, 1], { tab: 'Look', group: 'Color', hdr: true, animatable: true, label: 'Color (Cd)' }),
    P.bool('color_over_age', true, { tab: 'Look', group: 'Color' }),
    P.gradient('color_gradient', FIRE, { tab: 'Look', group: 'Color', visibleIf: (v) => !!v.color_over_age, label: 'Color over age' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.points);
    const out = pointAttributes(src ?? null, readPointAttrParams(ctx.params, ctx.frame.loopPhase));
    return { points: meshValue(out, 'points') };
  },
});

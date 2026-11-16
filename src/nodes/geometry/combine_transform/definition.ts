import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { P, type CurveValue } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { combineTransform, TRANSFORM_DRIVERS, type TransformDriver } from '../../../engine/mesh/attrs';
import { meshIn, meshOut, noiseSourceOf, noiseSourceParams } from '../../_shared/meshnodes';

const ident: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };

/** Combine Transform: per-point position / orientation / scale as a curve-remapped function of an attribute. */
function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.combine_transform' : 'geometry.combine_transform_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Combine Transform' : 'Combine Transform (Points)',
    description:
      'Per-point transform driven by an attribute: a DRIVER (age, id, index, pscale, x / y / z, random, noise or any attribute) is normalised by the input range, remapped by a curve and then scales a translation (+ along the normal), an Euler rotation (composed into `orient`) and a scale (multiplied into `scale`). Use it before Copy To Points to fan, spiral or grow instances.',
    keywords: ['transform', 'orient', 'rotate', 'translate', 'scale', 'driver', 'curve', 'expression', 'spiral', 'fan', 'points'],
    icon: 'cat-geometry',
    inputs: [meshIn(pin)],
    outputs: [meshOut(pin)],
    common: { texture: false },
    timeDependent: (v) => v.driver === 'noise' && !!v.n_animate,
    params: [
      P.enum('driver', 'age', TRANSFORM_DRIVERS.map((m) => ({ value: m, label: m.replace(/^\w/, (c) => c.toUpperCase()) })), { tab: 'Driver' }),
      P.string('attr', 'age', { tab: 'Driver', label: 'Attribute', visibleIf: (v) => v.driver === 'attribute' }),
      P.float('in_min', 0, { tab: 'Driver', label: 'Input min', step: 0.01 }),
      P.float('in_max', 1, { tab: 'Driver', label: 'Input max', step: 0.01 }),
      P.seed('seed', 1, { tab: 'Driver', visibleIf: (v) => v.driver === 'random' }),
      ...noiseSourceParams('Driver', 'Noise', (v) => v.driver === 'noise'),
      P.bool('use_curve', false, { tab: 'Driver', label: 'Remap with curve' }),
      P.curve('curve', ident, { tab: 'Driver', label: 'Remap curve', visibleIf: (v) => !!v.use_curve }),
      P.bool('apply_to_position', true, { tab: 'Transform', label: 'Move points' }),
      P.vec3('translate', [0, 0, 0], { tab: 'Transform', label: 'Translate at 1', step: 0.01, softMin: -10, softMax: 10, animatable: true }),
      P.float('along_normal', 0, { tab: 'Transform', label: 'Along normal at 1', min: -1000, max: 1000, softMin: -2, softMax: 2, step: 0.01, animatable: true }),
      P.vec3('rotate', [0, 0, 0], { tab: 'Transform', label: 'Rotate at 1', step: 1, softMin: -360, softMax: 360, unit: '°', animatable: true }),
      P.vec3('scale', [1, 1, 1], { tab: 'Transform', label: 'Scale at 1', min: -1000, max: 1000, softMin: 0, softMax: 4, step: 0.01, animatable: true }),
    ],
    gizmos: [{ id: 'xf', type: 'transform3d', viewport: '3d', space: 'world', position: 'translate', rotation: 'rotate', scale: 'scale' }],
    gallery: [{ name: 'Grow along age', params: { driver: 'index', scale: [0.1, 0.1, 0.1], use_curve: true } }, { name: 'Spiral fan', params: { driver: 'index', rotate: [0, 0, 360] } }],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const src = asMesh(ctx.inputs.input);
      if (!src) throw new Error('Combine Transform needs an input');
      const p = ctx.params;
      const out = combineTransform(src, {
        driver: p.str('driver') as TransformDriver, attr: p.str('attr'), inMin: p.num('in_min'), inMax: p.num('in_max'), curve: p.curve('curve'), useCurve: p.bool('use_curve'), translate: p.vec3('translate'),
        alongNormal: p.num('along_normal'), rotate: p.vec3('rotate'), scale: p.vec3('scale'), applyToPosition: p.bool('apply_to_position'), seed: p.seed('seed'), noise: noiseSourceOf(p),
      });
      return { output: meshValue(out, pin) };
    },
  });
}
export default [make('mesh'), make('points')];

import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { P, type CurveValue } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { combineScale, SCALE_SOURCES, type ScaleSource } from '../../../engine/mesh/attrs';
import { CHANNELS, channelIndex, cpuTexOf, meshIn, meshOut, noiseSourceOf, noiseSourceParams } from '../../_shared/meshnodes';

const ident: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
const is = (...s: string[]) => (v: Record<string, unknown>): boolean => s.includes(v.source as string);
const LABEL: Record<string, string> = { uniform: 'Uniform value', random: 'Random per point', texture: 'Texture via UV', attribute: 'Attribute', gradient_axis: 'Gradient along axis', noise: '3D noise' };

/** Combine Scale: per-point `pscale` / `scale` from textures, curves, random, attributes or noise. */
function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.combine_scale' : 'geometry.combine_scale_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Combine Scale' : 'Combine Scale (Points)',
    description:
      'Writes the per-point scale used by Copy To Points: `pscale` (uniform) and / or `scale` (vec3, per-axis weights). The value comes from a constant, random numbers (deterministic by seed), a Gray texture through the UVs, any attribute (age, id, noise ...), a gradient along an axis (gizmo) or 3D noise, optionally remapped by a curve; it can multiply the existing scale.',
    keywords: ['scale', 'pscale', 'size', 'random', 'curve', 'scatter', 'variation', 'attribute'],
    icon: 'cat-geometry',
    inputs: [meshIn(pin), { id: 'texture', name: 'Texture', type: 'gray', optional: true, tooltip: 'Sampled at the point UVs when Source = Texture via UV.' }],
    outputs: [meshOut(pin)],
    common: { texture: false },
    cpuTextureInputs: ['texture'],
    params: [
      P.enum('source', 'random', SCALE_SOURCES.map((m) => ({ value: m, label: LABEL[m] })), { tab: 'Source' }),
      P.float('value', 1, { tab: 'Source', min: -1000, max: 1000, softMax: 4, step: 0.01, animatable: true, visibleIf: is('uniform') }),
      P.float('min', 0.5, { tab: 'Source', label: 'Min (source = 0)', min: -1000, max: 1000, softMax: 4, step: 0.01, animatable: true, visibleIf: (v) => v.source !== 'uniform' }),
      P.float('max', 1.5, { tab: 'Source', label: 'Max (source = 1)', min: -1000, max: 1000, softMax: 4, step: 0.01, animatable: true, visibleIf: (v) => v.source !== 'uniform' }),
      P.seed('seed', 1, { tab: 'Source', visibleIf: is('random') }),
      P.enum('channel', 'luma', CHANNELS, { tab: 'Source', label: 'Texture channel', visibleIf: is('texture') }),
      P.int('uv_set', 0, { tab: 'Source', label: 'UV set', min: 0, max: 7, visibleIf: is('texture') }),
      P.string('attr', 'age', { tab: 'Source', label: 'Attribute', visibleIf: is('attribute') }),
      P.float('range_min', 0, { tab: 'Source', label: 'Attribute range min', step: 0.01, visibleIf: is('attribute') }),
      P.float('range_max', 0, { tab: 'Source', label: 'Attribute range max', step: 0.01, tooltip: 'Equal min / max = automatic range.', visibleIf: is('attribute') }),
      P.vec3('origin', [0, 0, 0], { tab: 'Source', label: 'Gradient origin', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: is('gradient_axis') }),
      P.vec3('direction', [0, 0, 1], { tab: 'Source', label: 'Gradient direction', step: 0.01, softMin: -1, softMax: 1, animatable: true, visibleIf: is('gradient_axis') }),
      P.float('length', 0, { tab: 'Source', label: 'Gradient length', min: 0, max: 100000, softMax: 10, step: 0.01, tooltip: '0 = fit the mesh extent.', visibleIf: is('gradient_axis') }),
      ...noiseSourceParams('Source', 'Noise', is('noise')),
      P.bool('use_curve', false, { tab: 'Curve', label: 'Remap with curve', visibleIf: (v) => v.source !== 'uniform' }),
      P.curve('curve', ident, { tab: 'Curve', label: 'Remap curve', visibleIf: (v) => v.source !== 'uniform' && !!v.use_curve }),
      P.enum('target', 'pscale', [{ value: 'pscale', label: 'pscale (uniform)' }, { value: 'scale', label: 'scale (vec3)' }, { value: 'both', label: 'Both' }], { tab: 'Write' }),
      P.vec3('axes', [1, 1, 1], { tab: 'Write', label: 'Axis weights (scale)', min: 0, max: 1, step: 0.01, visibleIf: (v) => v.target !== 'pscale', tooltip: '0 leaves an axis untouched, 1 applies the full value.' }),
      P.bool('multiply', true, { tab: 'Write', label: 'Multiply existing scale' }),
    ],
    gizmos: [{ id: 'axis', type: 'axis3d', viewport: '3d', space: 'world', origin: 'origin', direction: 'direction', length: 1, visibleIf: (v) => v.source === 'gradient_axis' }],
    gallery: [{ name: 'Random size', params: { source: 'random', min: 0.4, max: 1.4 } }, { name: 'Height falloff', params: { source: 'gradient_axis', min: 1, max: 0.1 } }],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const src = asMesh(ctx.inputs.input);
      if (!src) throw new Error('Combine Scale needs an input');
      const p = ctx.params;
      const out = combineScale(src, {
        source: p.str('source') as ScaleSource, value: p.num('value'), min: p.num('min'), max: p.num('max'), seed: p.seed('seed'), texture: cpuTexOf(ctx, 'texture'), uvSet: p.int('uv_set'), textureChannel: channelIndex(p.str('channel')),
        attr: p.str('attr'), origin: p.vec3('origin'), direction: p.vec3('direction'), length: p.num('length'), rangeMin: p.num('range_min'), rangeMax: p.num('range_max'), curve: p.curve('curve'), useCurve: p.bool('use_curve'),
        target: p.str('target') as 'pscale', axes: p.vec3('axes'), multiply: p.bool('multiply'), noise: noiseSourceOf(p),
      });
      return { output: meshValue(out, pin) };
    },
  });
}
export default [make('mesh'), make('points')];

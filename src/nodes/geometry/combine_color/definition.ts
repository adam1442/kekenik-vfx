import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { P, type CurveValue } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { BLEND_MODES, COLOR_SOURCES, combineColor, type BlendMode, type ColorSource } from '../../../engine/mesh/attrs';
import { cpuTexOf, meshIn, meshOut, noiseSourceOf, noiseSourceParams } from '../../_shared/meshnodes';

const ident: CurveValue = { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
const is = (...s: string[]) => (v: Record<string, unknown>): boolean => s.includes(v.source as string);
const SRC_LABEL: Record<string, string> = { uniform: 'Uniform color', texture: 'Texture via UV', gradient_axis: 'Gradient along axis', gradient_radial: 'Radial gradient (around axis)', gradient_length: 'Gradient along attribute / length', noise: '3D noise', island: 'Random per island' };

/** Combine Color: write vertex / point colour (or any 4-component attribute) from textures, gradients, noise or island ids. */
function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.combine_color' : 'geometry.combine_color_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Combine Color' : 'Combine Color (Points)',
    description:
      'Writes vertex colour (Cd, or any named RGBA attribute) from a Gray / Color texture sampled through the UVs, a colour gradient along an axis (gizmo) or along an attribute such as Sweep\'s `age`, 3D noise, a random colour per island, or a uniform colour. Each RGBA channel has its own write mask, and the result can be blended with the existing colour (copy, add, multiply, screen, overlay ...).',
    keywords: ['vertex color', 'cd', 'combine', 'gradient', 'texture', 'island', 'colour', 'bake', 'rgba', 'channel'],
    icon: 'cat-geometry',
    inputs: [meshIn(pin), { id: 'texture', name: 'Texture', type: 'color', optional: true, tooltip: 'Sampled at the mesh UVs when Source = Texture via UV (Gray works too).' }],
    outputs: [meshOut(pin)],
    common: { texture: false },
    cpuTextureInputs: ['texture'],
    timeDependent: (v) => v.source === 'noise' && !!v.n_animate,
    params: [
      P.enum('source', 'gradient_axis', COLOR_SOURCES.map((m) => ({ value: m, label: SRC_LABEL[m] })), { tab: 'Source' }),
      P.color('color', [1, 1, 1, 1], { tab: 'Source', visibleIf: is('uniform') }),
      P.int('uv_set', 0, { tab: 'Source', label: 'UV set', min: 0, max: 7, visibleIf: is('texture') }),
      P.bool('gray_to_alpha', false, { tab: 'Source', label: 'Gray value -> alpha', visibleIf: is('texture'), tooltip: 'A Gray texture has alpha 1; turn this on to write its value into the alpha channel (masks).' }),
      P.vec3('origin', [0, 0, 0], { tab: 'Source', label: 'Gradient origin', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: is('gradient_axis', 'gradient_radial') }),
      P.vec3('direction', [0, 0, 1], { tab: 'Source', label: 'Gradient direction', step: 0.01, softMin: -1, softMax: 1, animatable: true, visibleIf: is('gradient_axis', 'gradient_radial') }),
      P.float('length', 0, { tab: 'Source', label: 'Gradient length', min: 0, max: 100000, softMax: 10, step: 0.01, animatable: true, tooltip: '0 = fit the mesh extent along the direction.', visibleIf: is('gradient_axis', 'gradient_radial') }),
      P.string('length_attr', 'age', { tab: 'Source', label: 'Attribute', visibleIf: is('gradient_length') }),
      P.float('range_min', 0, { tab: 'Source', label: 'Range min', step: 0.01, visibleIf: is('gradient_length') }),
      P.float('range_max', 0, { tab: 'Source', label: 'Range max', step: 0.01, tooltip: 'Equal min / max = automatic range.', visibleIf: is('gradient_length') }),
      ...noiseSourceParams('Source', 'Noise', is('noise')),
      P.seed('seed', 1, { tab: 'Source', label: 'Random seed', visibleIf: is('island') }),
      P.gradient('gradient', { stops: [{ pos: 0, color: [0, 0, 0, 1] }, { pos: 1, color: [1, 1, 1, 1] }] }, { tab: 'Source', label: 'Color ramp', visibleIf: is('gradient_axis', 'gradient_radial', 'gradient_length', 'noise') }),
      P.curve('curve', ident, { tab: 'Source', label: 'Remap curve', visibleIf: is('gradient_axis', 'gradient_radial', 'gradient_length', 'noise') }),
      P.bool('write_r', true, { tab: 'Write', label: 'Write R', group: 'Channels' }),
      P.bool('write_g', true, { tab: 'Write', label: 'Write G', group: 'Channels' }),
      P.bool('write_b', true, { tab: 'Write', label: 'Write B', group: 'Channels' }),
      P.bool('write_a', true, { tab: 'Write', label: 'Write A', group: 'Channels' }),
      P.enum('blend', 'copy', BLEND_MODES.map((m) => ({ value: m, label: m.replace(/^\w/, (c) => c.toUpperCase()) })), { tab: 'Write', label: 'Blend with existing' }),
      P.float('opacity', 1, { tab: 'Write', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true }),
      P.enum('element', 'auto', [{ value: 'auto', label: 'Auto (vertex for textures)' }, { value: 'point', label: 'Point' }, { value: 'vertex', label: 'Vertex' }], { tab: 'Write', label: 'Write to' }),
      P.string('attribute', 'Cd', { tab: 'Write', label: 'Attribute name' }),
    ],
    gizmos: [{ id: 'axis', type: 'axis3d', viewport: '3d', space: 'world', origin: 'origin', direction: 'direction', length: 1, visibleIf: (v) => v.source === 'gradient_axis' || v.source === 'gradient_radial' }],
    gallery: [
      { name: 'Height gradient', params: { source: 'gradient_axis', gradient: { stops: [{ pos: 0, color: [0.05, 0.1, 0.6, 1] }, { pos: 1, color: [1, 0.8, 0.2, 1] }] } } },
      { name: 'Noise tint', params: { source: 'noise', n_frequency: 3 } },
      { name: 'Island colors', params: { source: 'island' } },
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const src = asMesh(ctx.inputs.input);
      if (!src) throw new Error('Combine Color needs an input');
      const p = ctx.params;
      const out = combineColor(src, {
        source: p.str('source') as ColorSource, color: p.rgba('color'), texture: cpuTexOf(ctx, 'texture'), grayToAlpha: p.bool('gray_to_alpha'), uvSet: p.int('uv_set'), origin: p.vec3('origin'), direction: p.vec3('direction'), length: p.num('length'),
        rangeMin: p.num('range_min'), rangeMax: p.num('range_max'), lengthAttr: p.str('length_attr'), gradient: p.gradient('gradient'), curve: p.curve('curve'), noise: noiseSourceOf(p),
        seed: p.seed('seed'), write: [p.bool('write_r'), p.bool('write_g'), p.bool('write_b'), p.bool('write_a')], blend: p.str('blend') as BlendMode, opacity: p.num('opacity'), element: p.str('element') as 'auto', attribute: p.str('attribute') || 'Cd',
      });
      return { output: meshValue(out, pin) };
    },
  });
}
export default [make('mesh'), make('points')];

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { gizmos } from './gizmo';
import shaderSrc from './shader.wgsl?raw';

/** grayscale.polar_scatter — texture slots: t0 size mod, t1 visibility mod, t2 input pattern. */
export const SHADER = defineShader('grayscale_polar_scatter.wgsl', shaderSrc);
const f = (name: string) => ({ name, type: 'f32' as const });
const mk = (name: string) => ({ name, type: 'u32' as const });
const mi = (name: string) => ({ name, type: 'i32' as const });
export const LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  f('radius_min'),
  f('radius_max'),
  mi('ring_count'),
  mi('count'),
  mk('count_mode'),
  f('ring_growth'),
  f('angle_start'),
  f('angle_range'),
  f('spiral'),
  f('spin'),
  mk('spin_alternate'),
  f('phase'),
  mk('seed'),
  f('angle_jitter'),
  f('radius_jitter'),
  f('size_rand'),
  f('rot_random'),
  f('int_min'),
  f('int_max'),
  mk('shape'),
  mi('sides'),
  f('pinch'),
  f('thickness'),
  f('size'),
  f('size_mod_k'),
  f('stretch'),
  f('ring_scale'),
  f('softness'),
  mk('align_radial'),
  f('rotation'),
  f('rot_per_ring'),
  mk('blend'),
  f('intensity'),
  f('visibility'),
  f('visibility_mod_k'),
  mk('has_pattern'),
]);

export const SCATTER_SHAPES = ['circle', 'square', 'polygon', 'star', 'ring', 'cross'] as const;
const is = (...t: string[]) => (v: Record<string, unknown>): boolean => t.includes(v.shape as string);

/** Elements per ring (CPU mirror of ring_elements() in shader.wgsl; used by tests). */
export function ringElements(i: number, ri: number, count: number, growth: number, proportional: boolean, rmax: number): number {
  let n = count * Math.pow(Math.max(growth, 0.01), i);
  if (proportional) n = (n * ri) / Math.max(rmax, 1e-4);
  return Math.min(512, Math.max(1, Math.round(n)));
}

export default defineNode({
  id: 'grayscale.polar_scatter',
  version: 1,
  category: 'grayscale',
  title: 'Polar Scatter',
  description: 'Scatters a shape or an input pattern in rings and radial arrays: count per ring, ring count, radius range, spiral, angle / radius jitter, per-ring and per-element scale and rotation, spin animation.',
  keywords: ['radial', 'ring', 'circle', 'array', 'sunburst', 'rays', 'spokes', 'polar', 'scatter', 'mandala', 'orbit', 'sparks'],
  icon: 'polar_scatter',
  inputs: [{ id: 'pattern', name: 'Input Pattern', type: 'gray', optional: true, tooltip: 'Gray pattern scattered instead of the built-in shape (fills the element footprint box).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.vec2('center', [0.5, 0.5], { group: 'Layout', softMin: -0.5, softMax: 1.5, step: 0.005, labels: ['X', 'Y'], tooltip: 'Centre of the radial array (UV). While tiling, elements wrap across the borders.' }),
    P.float('radius_min', 0.15, { group: 'Layout', label: 'First ring radius', min: 0, max: 2, softMax: 1, step: 0.005, tooltip: 'Radius of the innermost ring (fraction of the smaller image side).' }),
    P.float('radius_max', 0.4, { group: 'Layout', label: 'Last ring radius', min: 0, max: 2, softMax: 1, step: 0.005, tooltip: 'Radius of the outermost ring.' }),
    P.int('ring_count', 3, { group: 'Layout', label: 'Ring count', min: 1, max: 64, softMax: 16 }),
    P.int('count', 12, { group: 'Layout', label: 'Elements per ring', min: 1, max: 512, softMax: 64 }),
    P.enum('count_mode', 'constant', [{ value: 'constant', label: 'Constant' }, { value: 'proportional', label: 'Proportional to radius', tooltip: 'Keeps the spacing between elements even: count grows with the ring radius.' }], { group: 'Layout', label: 'Count mode' }),
    P.float('ring_growth', 1, { group: 'Layout', label: 'Count growth per ring', min: 0.1, max: 4, softMax: 2, step: 0.01 }),
    P.float('angle_start', 0, { group: 'Angle', label: 'Start angle', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
    P.float('angle_range', 360, { group: 'Angle', label: 'Angle range', min: 1, max: 360, step: 1, display: 'angle', animatable: true, tooltip: '360 = full circle, less = an arc / fan.' }),
    P.float('spiral', 0, { group: 'Angle', label: 'Spiral (angle per ring)', min: -360, max: 360, softMin: -90, softMax: 90, step: 0.5, display: 'angle', animatable: true }),
    P.float('phase', 0, { group: 'Angle', min: -100, max: 100, softMin: 0, softMax: 1, step: 0.001, display: 'percent', animatable: true, tooltip: 'Animation phase: 0 -> 100% rotates every ring by "Spin" turns. Whole numbers of turns loop seamlessly.' }),
    P.float('spin', 1, { group: 'Angle', label: 'Spin (turns per loop)', min: -32, max: 32, softMin: -4, softMax: 4, step: 0.1 }),
    P.bool('spin_alternate', false, { group: 'Angle', label: 'Alternate spin direction', tooltip: 'Every other ring turns the opposite way.' }),
    P.seed('seed', 0, { group: 'Randomness' }),
    P.float('angle_jitter', 0, { group: 'Randomness', label: 'Angle jitter', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Random angular offset as a fraction of the element spacing.' }),
    P.float('radius_jitter', 0, { group: 'Randomness', label: 'Radius jitter', min: 0, max: 2, softMax: 1, display: 'percent', step: 0.01, tooltip: 'Random radial offset as a fraction of the ring spacing.' }),
    P.float('size_rand', 0, { group: 'Randomness', label: 'Size randomness', min: 0, max: 1, display: 'percent', step: 0.01 }),
    P.float('rot_random', 0, { group: 'Randomness', label: 'Rotation randomness', min: 0, max: 360, step: 1, display: 'angle', tooltip: 'Each element is rotated by a random angle in +-this range.' }),
    P.float('int_min', 1, { group: 'Randomness', label: 'Intensity min', min: 0, max: 4, softMax: 1, display: 'percent', step: 0.01 }),
    P.float('int_max', 1, { group: 'Randomness', label: 'Intensity max', min: 0, max: 4, softMax: 1, display: 'percent', step: 0.01 }),
    P.enum(
      'shape',
      'circle',
      [
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'polygon', label: 'Polygon' },
        { value: 'star', label: 'Star' },
        { value: 'ring', label: 'Ring' },
        { value: 'cross', label: 'Cross' },
      ],
      { group: 'Element' },
    ),
    P.int('sides', 5, { group: 'Element', min: 3, max: 32, softMax: 12, visibleIf: is('polygon', 'star') }),
    P.float('pinch', 0.35, { group: 'Element', label: 'Star inner size', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: is('star') }),
    P.float('thickness', 0.3, { group: 'Element', min: 0.02, max: 1, display: 'percent', step: 0.01, visibleIf: is('ring', 'cross') }),
    P.float('size', 0.08, { group: 'Element', label: 'Scale', min: 0, max: 2, softMax: 0.5, step: 0.001, modulatable: true, animatable: true, tooltip: 'Element size (fraction of the smaller image side).' }),
    P.float('stretch', 1, { group: 'Element', label: 'Stretch', min: 0.1, max: 16, softMax: 6, step: 0.05, tooltip: 'Elongates the element along its local X axis (spokes / rays with radial alignment).' }),
    P.float('ring_scale', 1, { group: 'Element', label: 'Scale at last ring', min: 0, max: 4, softMax: 2, display: 'percent', step: 0.01, tooltip: 'Size multiplier of the outermost ring relative to the innermost (interpolated per ring).' }),
    P.float('softness', 0, { group: 'Element', min: 0, max: 1, display: 'percent', step: 0.01 }),
    P.bool('align_radial', true, { group: 'Orientation', label: 'Align to radius', tooltip: 'Rotates every element so its local X axis points away from the centre.' }),
    P.float('rotation', 0, { group: 'Orientation', label: 'Rotation offset', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
    P.float('rot_per_ring', 0, { group: 'Orientation', label: 'Rotation per ring', min: -360, max: 360, softMin: -90, softMax: 90, step: 0.5, display: 'angle' }),
    P.enum('blend', 'max', [{ value: 'add', label: 'Add' }, { value: 'max', label: 'Max' }], { group: 'Output', label: 'Overlap blending' }),
    P.float('intensity', 1, { group: 'Output', min: 0, max: 4, softMax: 1, display: 'percent', step: 0.01, animatable: true }),
    P.float('visibility', 1, { group: 'Output', min: 0, max: 1, display: 'percent', step: 0.01, modulatable: true, animatable: true, tooltip: 'Chance that an element is visible. Connect a modulation texture to cull elements by position.' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 3 }],
  gallery: [
    { name: 'Sunburst', params: { shape: 'cross', thickness: 0.15, stretch: 1, ring_count: 1, count: 24, radius_min: 0.3, radius_max: 0.3, size: 0.5, softness: 0.3 } },
    { name: 'Dotted rings', params: { shape: 'circle', ring_count: 5, count_mode: 'proportional', count: 40, radius_min: 0.08, radius_max: 0.42, size: 0.03 } },
    { name: 'Spokes', params: { shape: 'square', stretch: 6, ring_count: 1, count: 18, radius_min: 0.3, radius_max: 0.3, size: 0.1, softness: 0.2 } },
    { name: 'Spiral stars', params: { shape: 'star', ring_count: 14, count: 6, radius_min: 0.05, radius_max: 0.42, spiral: 25, size: 0.06, ring_scale: 1.6, align_radial: false } },
    { name: 'Scattered', params: { shape: 'polygon', sides: 6, ring_count: 6, count: 14, angle_jitter: 0.8, radius_jitter: 0.8, size_rand: 0.7, rot_random: 180, size: 0.08, seed: 3 } },
    { name: 'Fan arc', params: { shape: 'star', angle_range: 160, angle_start: 190, ring_count: 3, count: 7, size: 0.1, radius_min: 0.25, radius_max: 0.45 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const sizeMod = ctx.mod('size');
    const visMod = ctx.mod('visibility');
    const pattern = ctx.texInput('pattern');
    ctx.pass({
      label: 'polar_scatter',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          center: p.vec2('center'),
          radius_min: Math.min(p.num('radius_min'), p.num('radius_max')),
          radius_max: Math.max(p.num('radius_min'), p.num('radius_max')),
          ring_count: p.int('ring_count'),
          count: p.int('count'),
          count_mode: p.enumIndex('count_mode'),
          ring_growth: p.num('ring_growth'),
          angle_start: p.num('angle_start'),
          angle_range: p.num('angle_range'),
          spiral: p.num('spiral'),
          spin: p.num('spin'),
          spin_alternate: p.bool('spin_alternate'),
          phase: p.num('phase'),
          seed: p.seed('seed'),
          angle_jitter: p.num('angle_jitter'),
          radius_jitter: p.num('radius_jitter'),
          size_rand: p.num('size_rand'),
          rot_random: p.num('rot_random'),
          int_min: Math.min(p.num('int_min'), p.num('int_max')),
          int_max: Math.max(p.num('int_min'), p.num('int_max')),
          shape: p.enumIndex('shape'),
          sides: p.int('sides'),
          pinch: p.num('pinch'),
          thickness: p.num('thickness'),
          size: p.num('size'),
          size_mod_k: sizeMod.k,
          stretch: p.num('stretch'),
          ring_scale: p.num('ring_scale'),
          softness: p.num('softness'),
          align_radial: p.bool('align_radial'),
          rotation: p.num('rotation'),
          rot_per_ring: p.num('rot_per_ring'),
          blend: p.enumIndex('blend'),
          intensity: p.num('intensity'),
          visibility: p.num('visibility'),
          visibility_mod_k: visMod.k,
          has_pattern: pattern ? 1 : 0,
        },
      },
      textures: [sizeMod.tex?.tex ?? null, visMod.tex?.tex ?? null, pattern?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

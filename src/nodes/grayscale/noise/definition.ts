import { defineNode } from '../../../engine/graph/node';
import { P, type ParamValues } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import { gizmos } from './gizmo';
import shaderSrc from './shader.wgsl?raw';

/**
 * REFERENCE NODE (generator): grayscale.noise
 * Shows the full pattern: schema (modulatable param, animatable param, seed), common tabs, tileable/loopable shader,
 * gizmo declaration, shader declaration for tooling. Copy this folder as a starting point for new generators.
 */
export const SHADER = defineShader('grayscale_noise.wgsl', shaderSrc);
export const LAYOUT = makeLayout([
  { name: 'noise_type', type: 'u32' },
  { name: 'scale', type: 'vec2f' },
  { name: 'octaves', type: 'i32' },
  { name: 'lacunarity', type: 'i32' },
  { name: 'roughness', type: 'f32' },
  { name: 'offset', type: 'vec2f' },
  { name: 'rotation', type: 'f32' },
  { name: 'evolution', type: 'f32' },
  { name: 'z_cells', type: 'i32' },
  { name: 'seed', type: 'u32' },
  { name: 'contrast', type: 'f32' },
  { name: 'contrast_mod_k', type: 'f32' },
  { name: 'brightness', type: 'f32' },
  { name: 'invert', type: 'u32' },
  // v2 additions (appended: the first 14 fields are unchanged)
  { name: 'metric', type: 'u32' },
  { name: 'jitter', type: 'f32' },
  { name: 'edge_width', type: 'f32' },
  { name: 'octave_rotation', type: 'f32' },
  { name: 'anisotropy', type: 'f32' },
  { name: 'warp_amount', type: 'f32' },
  { name: 'warp_freq', type: 'i32' },
  { name: 'uv_amount', type: 'f32' },
  { name: 'has_uv', type: 'u32' },
  { name: 'remap_lo', type: 'f32' },
  { name: 'remap_hi', type: 'f32' },
  { name: 'bias', type: 'f32' },
  { name: 'gabor_freq', type: 'f32' },
  { name: 'gabor_angle', type: 'f32' },
  { name: 'gabor_spread', type: 'f32' },
]);

/** Enum order == the `ty` switch in shader.wgsl. NEVER reorder (ids are stored; the shader receives the index). */
export const NOISE_TYPES = ['value', 'perlin', 'simplex', 'cubic', 'billow', 'ridged', 'gabor', 'worley_f1', 'worley_f2', 'worley_f2f1', 'cracks', 'cell_id', 'voronoi'] as const;
const isCellular = (v: ParamValues): boolean => ['worley_f1', 'worley_f2', 'worley_f2f1', 'cracks', 'cell_id', 'voronoi'].includes(v.noise_type as string);

export default defineNode({
  id: 'grayscale.noise',
  version: 2,
  category: 'grayscale',
  title: 'Noise',
  description: 'Tileable, loopable fractal noise: Perlin, Simplex, Value, Cubic, Billow, Ridged, Gabor, Worley/Cellular (F1, F2, F2-F1, cracks, cell id) and Voronoi borders, with fBm, domain warp, anisotropy and remap. Evolution animates the pattern; one full cycle (0 to 1) loops seamlessly.',
  keywords: ['perlin', 'simplex', 'value', 'worley', 'cellular', 'voronoi', 'gabor', 'billow', 'ridged', 'cubic', 'cracks', 'fbm', 'clouds', 'procedural', 'random'],
  icon: 'noise',
  inputs: [{ id: 'uv', name: 'UV', type: 'uv', optional: true, tooltip: 'Optional UV map: the pattern is looked up through it (domain warp / deformation).' }],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  common: { texture: true, blending: true },
  params: [
    P.enum(
      'noise_type',
      'perlin',
      [
        { value: 'value', label: 'Value' },
        { value: 'perlin', label: 'Perlin' },
        { value: 'simplex', label: 'Simplex', tooltip: 'Gradient noise on a triangle lattice (periodic: rows are rounded to an even count when tiling).' },
        { value: 'cubic', label: 'Cubic', tooltip: 'Value noise with cubic B-spline interpolation: very smooth, no lattice artefacts.' },
        { value: 'billow', label: 'Billow', tooltip: 'Absolute-value Perlin: puffy, cloud-like.' },
        { value: 'ridged', label: 'Ridged', tooltip: 'Inverted absolute-value Perlin: sharp crests, mountains, lightning.' },
        { value: 'gabor', label: 'Gabor', tooltip: 'Sparse-convolution noise with controllable orientation and frequency (wood grain, brushed metal, streaks).' },
        { value: 'worley_f1', label: 'Worley F1', tooltip: 'Distance to the nearest feature point.' },
        { value: 'worley_f2', label: 'Worley F2', tooltip: 'Distance to the second nearest feature point.' },
        { value: 'worley_f2f1', label: 'Worley F2-F1', tooltip: 'Cell structure: dark on cell borders.' },
        { value: 'cracks', label: 'Cracks', tooltip: 'Thin bright cell borders (dried mud, cracked earth).' },
        { value: 'cell_id', label: 'Cell ID', tooltip: 'A random flat gray value per cell.' },
        { value: 'voronoi', label: 'Voronoi (border distance)', tooltip: 'Exact distance to the nearest cell border: 0 on borders, rising towards cell centres.' },
      ],
      { group: 'Noise', label: 'Type' },
    ),
    P.enum(
      'metric',
      'euclid',
      [
        { value: 'euclid', label: 'Euclidean' },
        { value: 'manhattan', label: 'Manhattan' },
        { value: 'chebyshev', label: 'Chebyshev' },
      ],
      { group: 'Cellular', label: 'Distance metric', visibleIf: (v) => isCellular(v) && v.noise_type !== 'voronoi' && v.noise_type !== 'cell_id' },
    ),
    P.float('jitter', 1, { group: 'Cellular', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: isCellular, tooltip: '0% = regular grid of feature points, 100% = fully random.' }),
    P.float('edge_width', 0.08, { group: 'Cellular', min: 0.001, max: 1, softMax: 0.5, step: 0.005, visibleIf: (v) => v.noise_type === 'cracks', tooltip: 'Width of the crack lines (in cell units).' }),
    P.float('gabor_freq', 3, { group: 'Gabor', min: 0.25, max: 16, softMax: 8, step: 0.05, visibleIf: (v) => v.noise_type === 'gabor', label: 'Kernel frequency', tooltip: 'Wave cycles per cell.' }),
    P.float('gabor_angle', 0, { group: 'Gabor', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true, visibleIf: (v) => v.noise_type === 'gabor', label: 'Kernel angle' }),
    P.float('gabor_spread', 1, { group: 'Gabor', min: 0, max: 1, display: 'percent', step: 0.01, visibleIf: (v) => v.noise_type === 'gabor', label: 'Orientation randomness', tooltip: '0% = every kernel points the same way (streaks), 100% = isotropic.' }),
    P.vec2('scale', [4, 4], {
      group: 'Noise',
      min: 1,
      max: 256,
      softMax: 32,
      step: 1,
      labels: ['X', 'Y'],
      linkable: true,
      tooltip: 'Lattice cells across the image. Rounded to whole numbers on tiling axes so the pattern wraps seamlessly.',
    }),
    P.int('octaves', 4, { group: 'fBm', min: 1, max: 8, tooltip: 'Number of fractal layers.' }),
    P.int('lacunarity', 2, { group: 'fBm', min: 2, max: 4, tooltip: 'Frequency multiplier per octave (whole numbers keep it tileable).' }),
    P.float('roughness', 0.5, { group: 'fBm', label: 'Gain (roughness)', min: 0, max: 1, display: 'percent', step: 0.01, tooltip: 'Amplitude kept per octave.' }),
    P.float('octave_rotation', 0, { group: 'fBm', min: -360, max: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Extra rotation added per octave. While the graph tiles it snaps to 90 degree steps (the lattice must stay axis aligned to remain periodic).' }),
    P.vec2('offset', [0, 0], { group: 'Transform', softMin: -1, softMax: 1, step: 0.01, labels: ['X', 'Y'], tooltip: 'Shifts the pattern (UV units). Integer offsets are identical when tiling.' }),
    P.float('rotation', 0, {
      group: 'Transform',
      min: -3600,
      max: 3600,
      softMin: -180,
      softMax: 180,
      step: 1,
      display: 'angle',
      animatable: true,
      tooltip: 'Rotates the pattern clockwise around the gizmo pivot. While the graph tiles it snaps to 90 degree steps so the result stays seamless.',
    }),
    P.float('anisotropy', 0, { group: 'Transform', min: -1, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: '+ squeezes the pattern horizontally (stretched vertical features), - vertically.' }),
    P.float('uv_amount', 1, { group: 'Warp', min: 0, max: 1, display: 'percent', step: 0.01, showWhenConnected: 'uv', label: 'UV amount', tooltip: 'How much the connected UV map distorts the pattern (0% = ignore).' }),
    P.float('warp_amount', 0, { group: 'Warp', min: 0, max: 1, softMax: 0.25, step: 0.001, display: 'percent', animatable: true, label: 'Domain warp', tooltip: 'Distorts the lookup position with a second, periodic noise (in image fractions).' }),
    P.int('warp_freq', 3, { group: 'Warp', min: 1, max: 32, softMax: 12, label: 'Warp frequency', visibleIf: (v) => (v.warp_amount as number) !== 0 }),
    P.float('evolution', 0, { group: 'Animation', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: 'Moves through the Z axis. 0 -> 1 is one seamless loop.' }),
    P.int('z_cells', 2, { group: 'Animation', label: 'Z layers', min: 1, max: 16, tooltip: 'Z lattice layers per loop: more = faster/more change per loop.' }),
    P.seed('seed', 0, { group: 'Noise' }),
    P.float('contrast', 1, { group: 'Levels', min: 0, max: 8, softMax: 3, step: 0.01, modulatable: true, animatable: true }),
    P.float('remap_lo', 0, { group: 'Levels', label: 'Remap in low', min: -2, max: 2, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: 'Input value mapped to black before contrast (stretch narrow noise like Perlin).' }),
    P.float('remap_hi', 1, { group: 'Levels', label: 'Remap in high', min: -2, max: 2, softMin: 0, softMax: 1, step: 0.01, animatable: true, tooltip: 'Input value mapped to white before contrast.' }),
    P.float('bias', 0.5, { group: 'Levels', min: 0.01, max: 0.99, step: 0.01, display: 'percent', animatable: true, tooltip: '50% = neutral. Higher = brighter mid-tones, lower = darker (Schlick bias).' }),
    P.float('brightness', 0, { group: 'Levels', min: -1, max: 1, step: 0.01, animatable: true }),
    P.bool('invert', false, { group: 'Levels' }),
  ],
  gizmos,
  cost: { gpu: 'medium', tiling: 'pixel' },
  shaders: [{ source: SHADER, uniforms: LAYOUT, textures: 2 }],
  migrateParams: (old) => old, // v1 -> v2 only ADDED params (defaults reproduce v1 output exactly)
  gallery: [
    { name: 'Clouds', params: { noise_type: 'billow', scale: [3, 3], octaves: 6, roughness: 0.55 } },
    { name: 'Cracks', params: { noise_type: 'cracks', scale: [6, 6], octaves: 2, edge_width: 0.06, seed: 4 } },
    { name: 'Marble warp', params: { noise_type: 'ridged', scale: [3, 3], octaves: 5, warp_amount: 0.08, warp_freq: 2 } },
    { name: 'Streaks (Gabor)', params: { noise_type: 'gabor', scale: [8, 8], octaves: 2, gabor_spread: 0.05, gabor_angle: 35, gabor_freq: 4, anisotropy: 0.3 } },
    { name: 'Voronoi borders', params: { noise_type: 'voronoi', scale: [7, 7], octaves: 1, jitter: 0.9 } },
    { name: 'Simplex', params: { noise_type: 'simplex', scale: [4, 4], octaves: 5 } },
  ],
  evaluate(ctx) {
    const p = ctx.params;
    const out = ctx.tex('gray');
    const mod = ctx.mod('contrast');
    const scale = p.vec2('scale');
    const offset = p.vec2('offset');
    const uvIn = ctx.texInput('uv');
    ctx.pass({
      label: 'noise',
      target: out,
      shader: SHADER,
      uniforms: {
        layout: LAYOUT,
        values: {
          noise_type: p.enumIndex('noise_type'),
          scale,
          octaves: p.int('octaves'),
          lacunarity: p.int('lacunarity'),
          roughness: p.num('roughness'),
          offset,
          rotation: p.num('rotation'),
          evolution: p.num('evolution'),
          z_cells: p.int('z_cells'),
          seed: p.seed('seed'),
          contrast: p.num('contrast'),
          contrast_mod_k: mod.k,
          brightness: p.num('brightness'),
          invert: p.bool('invert'),
          metric: p.enumIndex('metric'),
          jitter: p.num('jitter'),
          edge_width: p.num('edge_width'),
          octave_rotation: p.num('octave_rotation'),
          anisotropy: p.num('anisotropy'),
          warp_amount: p.num('warp_amount'),
          warp_freq: p.int('warp_freq'),
          uv_amount: p.num('uv_amount'),
          has_uv: uvIn ? 1 : 0,
          remap_lo: p.num('remap_lo'),
          remap_hi: p.num('remap_hi'),
          bias: p.num('bias'),
          gabor_freq: p.num('gabor_freq'),
          gabor_angle: p.num('gabor_angle'),
          gabor_spread: p.num('gabor_spread'),
        },
      },
      textures: [mod.tex?.tex ?? null, uvIn?.tex ?? null],
    });
    return { output: ctx.result(out, 'gray') };
  },
});

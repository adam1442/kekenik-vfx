import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { WORKER_MIN_POINTS } from '../../../workers/mesh-jobs';
import { noiseDisplace, NOISE_MODES, type NoiseDisplaceParams, type NoiseMask } from '../../../engine/mesh/deform';
import type { NoiseKind } from '../../../engine/mesh/noise3';
import { CHANNELS, channelIndex, cpuTexOf, falloffGizmo, falloffOf, falloffParams, meshIn, meshOut } from '../../_shared/meshnodes';

const MASKS = [
  { value: 'none', label: 'None' },
  { value: 'cd_r', label: 'Vertex color R' },
  { value: 'cd_g', label: 'Vertex color G' },
  { value: 'cd_b', label: 'Vertex color B' },
  { value: 'cd_a', label: 'Vertex color A' },
  { value: 'attribute', label: 'Attribute (name)' },
  { value: 'texture', label: 'Gray texture via UV' },
];

/** Mesh + Points variants of the 3D noise displacement. */
function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.noise' : 'geometry.noise_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Noise' : 'Noise (Points)',
    description:
      'Displaces points along the normal, a fixed axis or a noise vector with 3D fBm (Perlin 4D or simplex). The 4th dimension animates the noise; with Loop on, exactly `cycles` noise cycles fit into the graph loop so animations repeat seamlessly. Mask by vertex colour, an attribute (e.g. `age` from Sweep) or a Gray texture sampled through the mesh UVs, and limit the effect to a spherical falloff region. Deterministic by seed.',
    keywords: ['noise', 'displace', 'wobble', 'jitter', 'turbulence', 'perlin', 'simplex', 'loop', 'animate', 'mask'],
    icon: 'cat-geometry',
    inputs: [meshIn(pin), { id: 'mask', name: 'Mask', type: 'gray', optional: true, role: 'mask', tooltip: 'Gray texture sampled at the mesh UVs when Mask = Gray texture.' }],
    outputs: [meshOut(pin)],
    common: { texture: false },
    cpuTextureInputs: ['mask'],
    workerTask: 'mesh.noise',
    timeDependent: (v) => !!v.animate,
    params: [
      P.enum('mode', 'normal', NOISE_MODES.map((m) => ({ value: m, label: { normal: 'Along normal', vector: 'Noise vector', axis: 'Along axis' }[m] })), { tab: 'Noise' }),
      P.vec3('axis', [0, 0, 1], { tab: 'Noise', step: 0.01, softMin: -1, softMax: 1, visibleIf: (v) => v.mode === 'axis' }),
      P.enum('kind', 'perlin', [{ value: 'perlin', label: 'Perlin (4D, exact loop)' }, { value: 'simplex', label: 'Simplex (loop by cross-fade)' }], { tab: 'Noise', label: 'Noise type' }),
      P.float('amplitude', 0.1, { tab: 'Noise', min: -1000, max: 1000, softMin: -1, softMax: 1, step: 0.005, animatable: true }),
      P.float('bias', 0, { tab: 'Noise', min: -2, max: 2, step: 0.01, tooltip: '0 displaces both ways, 1 only outwards.' }),
      P.float('frequency', 2, { tab: 'Noise', min: 0.001, max: 500, softMax: 20, step: 0.05, animatable: true }),
      P.vec3('freq_scale', [1, 1, 1], { tab: 'Noise', label: 'Frequency scale (per axis)', min: 0, max: 100, step: 0.01, tooltip: 'Stretch the noise: e.g. (1, 1, 0.2) for long streaks along Z.' }),
      P.vec3('offset', [0, 0, 0], { tab: 'Noise', step: 0.01, softMin: -10, softMax: 10, animatable: true, tooltip: 'Noise origin (gizmo). Animate it to scroll the noise.' }),
      P.int('octaves', 3, { tab: 'Noise', group: 'Fractal', min: 1, max: 8 }),
      P.float('lacunarity', 2, { tab: 'Noise', group: 'Fractal', min: 1, max: 4, step: 0.01 }),
      P.float('gain', 0.5, { tab: 'Noise', group: 'Fractal', min: 0, max: 1, step: 0.01 }),
      P.seed('seed', 1, { tab: 'Noise', group: 'Fractal' }),
      P.bool('animate', false, { tab: 'Animation', label: 'Animate (4th dimension)' }),
      P.bool('loop', true, { tab: 'Animation', label: 'Loop with graph', visibleIf: (v) => !!v.animate, tooltip: 'One graph loop = `cycles` noise cycles (seamless).' }),
      P.int('loop_cycles', 1, { tab: 'Animation', label: 'Cycles per loop', min: 1, max: 16, visibleIf: (v) => !!v.animate && !!v.loop }),
      P.float('speed', 1, { tab: 'Animation', label: 'Speed (noise units / s)', min: -100, max: 100, softMin: -5, softMax: 5, step: 0.01, visibleIf: (v) => !!v.animate && !v.loop }),
      P.enum('mask', 'none', MASKS, { tab: 'Mask', label: 'Mask source' }),
      P.string('mask_attr', 'age', { tab: 'Mask', label: 'Attribute', visibleIf: (v) => v.mask === 'attribute' }),
      P.enum('mask_channel', 'luma', CHANNELS, { tab: 'Mask', label: 'Texture channel', visibleIf: (v) => v.mask === 'texture' }),
      P.int('uv_set', 0, { tab: 'Mask', label: 'UV set', min: 0, max: 7, visibleIf: (v) => v.mask === 'texture' }),
      P.bool('mask_invert', false, { tab: 'Mask', label: 'Invert mask', visibleIf: (v) => v.mask !== 'none' }),
      ...falloffParams(),
      P.bool('store_noise', false, { tab: 'Output', label: 'Write `noise` attribute', tooltip: 'Point attribute with the raw noise value (-1..1): drive Combine Color / Scale from it.' }),
      P.bool('recompute_normals', true, { tab: 'Output', label: 'Recompute normals (angle weighted)' }),
    ],
    gizmos: [{ id: 'origin', type: 'point3d', viewport: '3d', space: 'world', param: 'offset' }, falloffGizmo()],
    gallery: [
      { name: 'Rough surface', params: { amplitude: 0.08, frequency: 6, octaves: 4 } },
      { name: 'Wobble (loops)', params: { animate: true, loop: true, amplitude: 0.15, frequency: 1.2 } },
      { name: 'Vector jitter', params: { mode: 'vector', amplitude: 0.12, frequency: 3 } },
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const src = asMesh(ctx.inputs.input);
      if (!src) throw new Error('Noise needs an input');
      const p = ctx.params;
      const animate = p.bool('animate');
      const loop = animate && p.bool('loop');
      const t = !animate ? 0 : loop ? ctx.frame.loopPhase : ctx.frame.time * p.num('speed');
      const np: NoiseDisplaceParams = {
        mode: p.str('mode') as 'normal', axis: p.vec3('axis'), kind: p.str('kind') as NoiseKind, frequency: p.num('frequency'), freqScale: p.vec3('freq_scale'), amplitude: p.num('amplitude'), bias: p.num('bias'), offset: p.vec3('offset'),
        octaves: p.int('octaves'), lacunarity: p.num('lacunarity'), gain: p.num('gain'), seed: p.seed('seed'), t, loopCycles: loop ? p.int('loop_cycles') : 0,
        mask: p.str('mask') as NoiseMask, maskAttr: p.str('mask_attr'), maskInvert: p.bool('mask_invert'), maskTexture: cpuTexOf(ctx, 'mask'), maskChannel: channelIndex(p.str('mask_channel')), uvSet: p.int('uv_set'),
        falloff: falloffOf(p), storeNoise: p.bool('store_noise'), recomputeNormals: p.bool('recompute_normals'),
      };
      // big inputs run in a worker (same pure function); the node keeps its last valid result meanwhile.
      const job = src.pointCount >= WORKER_MIN_POINTS ? ctx.job?.('mesh.noise', np, src) : undefined;
      const out = job ? (job.mesh ?? src) : noiseDisplace(src, np);
      return { output: meshValue(out, pin) };
    },
  });
}
export default [make('mesh'), make('points')];

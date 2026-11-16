import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { spaceWarp, WARP_MODES, type WarpMode } from '../../../engine/mesh/deform';
import type { V3 } from '../../../engine/mesh/math3';
import { CHANNELS, channelIndex, cpuTexOf, falloffGizmo, falloffOf, falloffParams, meshIn, meshOut } from '../../_shared/meshnodes';

const LABEL: Record<WarpMode, string> = { bend: 'Bend', twist: 'Twist', taper: 'Taper', stretch: 'Stretch', spherify: 'Spherify', wave: 'Wave', ripple: 'Ripple', lattice: 'Lattice (free-form)', displace_texture: 'Displace by texture' };
const isAxial = (v: Record<string, unknown>): boolean => v.mode !== 'lattice' && v.mode !== 'displace_texture';
const corner = (i: number): string => `lat_c${i}`;

function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.space_warp' : 'geometry.space_warp_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Space Warp' : 'Space Warp (Points)',
    description:
      'Deforms points in a warp space you place with the gizmo: Bend, Twist, Taper, Stretch (volume preserving), Spherify, Wave, Ripple, Lattice free-form deform (box with 8 corner offsets + jitter) and Displace by texture (Gray texture through the mesh UVs). A spherical falloff region (gizmo) limits the effect. Normals are recomputed with angle weighting.',
    keywords: ['warp', 'bend', 'twist', 'taper', 'stretch', 'spherify', 'wave', 'ripple', 'lattice', 'ffd', 'displace', 'deform'],
    icon: 'cat-geometry',
    inputs: [meshIn(pin), { id: 'texture', name: 'Texture', type: 'gray', optional: true, tooltip: 'Gray texture for Displace by texture (sampled at the mesh UVs).' }],
    outputs: [meshOut(pin)],
    common: { texture: false },
    cpuTextureInputs: ['texture'],
    params: [
      P.enum('mode', 'bend', WARP_MODES.map((m) => ({ value: m, label: LABEL[m] })), { tab: 'Warp' }),
      P.enum('axis', 'z', ['x', 'y', 'z'], { tab: 'Warp', label: 'Axis', visibleIf: isAxial, tooltip: 'Bend / twist / taper / stretch run along this local axis; wave and ripple displace along it.' }),
      P.float('amount', 45, { tab: 'Warp', min: -100000, max: 100000, softMin: -180, softMax: 180, step: 0.01, animatable: true, tooltip: 'Bend / twist: degrees over `length`. Taper / stretch: factor. Spherify: 0..1. Wave / ripple / displace: distance.' }),
      P.float('length', 2, { tab: 'Warp', min: 0.0001, max: 100000, softMax: 20, step: 0.01, animatable: true, visibleIf: (v) => v.mode === 'bend' || v.mode === 'twist' || v.mode === 'taper' }),
      P.float('radius', 1, { tab: 'Warp', min: 0, max: 100000, softMax: 10, step: 0.01, animatable: true, visibleIf: (v) => v.mode === 'spherify' }),
      P.bool('preserve_volume', true, { tab: 'Warp', visibleIf: (v) => v.mode === 'stretch' }),
      P.float('frequency', 1, { tab: 'Warp', min: 0, max: 1000, softMax: 10, step: 0.01, visibleIf: (v) => v.mode === 'wave' || v.mode === 'ripple' }),
      P.float('phase', 0, { tab: 'Warp', min: -100000, max: 100000, softMin: -2, softMax: 2, step: 0.01, animatable: true, visibleIf: (v) => v.mode === 'wave' || v.mode === 'ripple', tooltip: 'Animate over a whole number of cycles for a seamless loop.' }),
      P.float('decay', 0, { tab: 'Warp', min: 0, max: 100, softMax: 5, step: 0.01, visibleIf: (v) => v.mode === 'ripple' }),
      P.vec3('position', [0, 0, 0], { tab: 'Space', label: 'Warp space position', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: isAxial }),
      P.vec3('rotation', [0, 0, 0], { tab: 'Space', label: 'Warp space rotation', step: 1, softMin: -360, softMax: 360, unit: '°', animatable: true, visibleIf: isAxial }),
      P.vec3('box_pos', [0, 0, 0], { tab: 'Lattice', label: 'Lattice box center', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: (v) => v.mode === 'lattice' }),
      P.vec3('box_size', [2, 2, 2], { tab: 'Lattice', label: 'Lattice box size', min: 0.0001, max: 1000, step: 0.01, softMax: 10, animatable: true, visibleIf: (v) => v.mode === 'lattice' }),
      P.int('lat_res', 3, { tab: 'Lattice', label: 'Grid resolution', min: 2, max: 8, visibleIf: (v) => v.mode === 'lattice' }),
      ...Array.from({ length: 8 }, (_, i) => P.vec3(corner(i), [0, 0, 0], { tab: 'Lattice', group: 'Corner offsets', label: `Corner ${i} (${i & 1 ? '+' : '-'}x ${i & 2 ? '+' : '-'}y ${i & 4 ? '+' : '-'}z)`, step: 0.01, softMin: -2, softMax: 2, animatable: true, visibleIf: (v) => v.mode === 'lattice' })),
      P.float('lat_jitter', 0, { tab: 'Lattice', label: 'Random jitter', min: 0, max: 10, softMax: 1, step: 0.01, animatable: true, visibleIf: (v) => v.mode === 'lattice' }),
      P.seed('lat_seed', 1, { tab: 'Lattice', label: 'Jitter seed', visibleIf: (v) => v.mode === 'lattice' }),
      P.enum('along', 'normal', ['normal', 'x', 'y', 'z'], { tab: 'Texture', label: 'Displace along', visibleIf: (v) => v.mode === 'displace_texture' }),
      P.enum('channel', 'luma', CHANNELS, { tab: 'Texture', label: 'Channel', visibleIf: (v) => v.mode === 'displace_texture' }),
      P.float('mid', 0.5, { tab: 'Texture', label: 'Neutral value', min: 0, max: 1, step: 0.01, visibleIf: (v) => v.mode === 'displace_texture' }),
      P.int('uv_set', 0, { tab: 'Texture', label: 'UV set', min: 0, max: 7, visibleIf: (v) => v.mode === 'displace_texture' }),
      ...falloffParams(),
      P.bool('recompute_normals', true, { tab: 'Output', label: 'Recompute normals (angle weighted)' }),
    ],
    gizmos: [
      { id: 'space', type: 'transform3d', viewport: '3d', space: 'world', position: 'position', rotation: 'rotation', visibleIf: isAxial },
      { id: 'lattice', type: 'box3d', viewport: '3d', space: 'world', position: 'box_pos', size: 'box_size', visibleIf: (v) => v.mode === 'lattice' },
      falloffGizmo(),
    ],
    gallery: [
      { name: 'Bend', params: { mode: 'bend', amount: 90 } },
      { name: 'Twist', params: { mode: 'twist', amount: 270 } },
      { name: 'Ripple', params: { mode: 'ripple', amount: 0.12, frequency: 3, decay: 0.6 } },
      { name: 'Lattice', params: { mode: 'lattice', lat_jitter: 0.3 } },
    ],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const src = asMesh(ctx.inputs.input);
      if (!src) throw new Error('Space Warp needs an input');
      const p = ctx.params;
      const out = spaceWarp(src, {
        mode: p.str('mode') as WarpMode, axis: p.str('axis') as 'x', position: p.vec3('position'), rotation: p.vec3('rotation'), amount: p.num('amount'), length: p.num('length'), frequency: p.num('frequency'), phase: p.num('phase'), decay: p.num('decay'),
        radius: p.num('radius'), preserveVolume: p.bool('preserve_volume'), falloff: falloffOf(p),
        lattice: { res: p.int('lat_res'), boxPos: p.vec3('box_pos'), boxSize: p.vec3('box_size'), corners: Array.from({ length: 8 }, (_, i) => p.vec3(corner(i)) as V3), jitter: p.num('lat_jitter'), seed: p.seed('lat_seed') },
        texture: cpuTexOf(ctx, 'texture'), textureChannel: channelIndex(p.str('channel')), textureMid: p.num('mid'), along: p.str('along') as 'normal', uvSet: p.int('uv_set'), recomputeNormals: p.bool('recompute_normals'),
      });
      return { output: meshValue(out, pin) };
    },
  });
}
export default [make('mesh'), make('points')];

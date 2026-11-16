import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { computeNormalsAngle, computeTangents, boundsBox, deletePrimitives, fusePoints, subdivide, triangulateMesh } from '../../../engine/mesh/helpers';
import { pointMask, type NoiseMask } from '../../../engine/mesh/deform';
import { STD } from '../../../engine/mesh/mesh';
import { CHANNELS, channelIndex, cpuTexOf } from '../../_shared/meshnodes';

const base = { category: 'geometry' as const, version: 1, icon: 'cat-geometry', common: { texture: false }, cost: { gpu: 'trivial' as const, tiling: 'pixel' as const } };
const mIn = [{ id: 'input', name: 'Mesh', type: 'mesh' as const }];
const mOut = [{ id: 'output', name: 'Mesh', type: 'mesh' as const }];

/** Small mesh utility nodes: Normals, Triangulate, Subdivide, Delete By Mask, Fuse, Bounds. */
const normals = defineNode({
  ...base,
  id: 'geometry.normals',
  title: 'Normals',
  description: 'Recomputes normals weighted by the corner angle of every face (independent of how a surface is triangulated). Smooth = point normals, Flat = per-vertex face normals. Optionally writes per-vertex `tangent` (xyz + handedness) from a UV set.',
  keywords: ['normals', 'smooth', 'flat', 'tangent', 'recompute', 'angle weighted', 'shading'],
  inputs: mIn,
  outputs: mOut,
  params: [
    P.enum('mode', 'smooth', ['smooth', 'flat'], { tab: 'Normals' }),
    P.bool('tangents', false, { tab: 'Normals', label: 'Write tangents' }),
    P.int('uv_set', 0, { tab: 'Normals', label: 'Tangent UV set', min: 0, max: 7, visibleIf: (v) => !!v.tangents }),
    P.bool('flip', false, { tab: 'Normals', label: 'Flip normals' }),
  ],
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Normals needs a mesh');
    const out = src.clone();
    if (out.primCount === 0) throw new Error('Normals needs primitives (this is a point cloud)');
    computeNormalsAngle(out, ctx.params.str('mode') as 'smooth');
    if (ctx.params.bool('flip')) for (const el of ['point', 'vertex'] as const) if (out.has(el, STD.N)) { const d = out.writable(el, STD.N); for (let i = 0; i < d.length; i++) d[i] = -d[i]; }
    if (ctx.params.bool('tangents')) computeTangents(out, ctx.params.int('uv_set'));
    return { output: meshValue(out, 'mesh') };
  },
});

const triangulate = defineNode({
  ...base,
  id: 'geometry.triangulate',
  title: 'Triangulate',
  description: 'Splits every polygon into triangles (fan triangulation, exact for convex polygons). Vertex attributes follow, primitive attributes are copied to each triangle.',
  keywords: ['triangulate', 'triangles', 'quads', 'split', 'tris'],
  inputs: mIn,
  outputs: mOut,
  params: [],
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Triangulate needs a mesh');
    return { output: meshValue(triangulateMesh(src), 'mesh') };
  },
});

const subdiv = defineNode({
  ...base,
  id: 'geometry.subdivide',
  title: 'Subdivide',
  description: 'Simple tessellation: triangles become 4 triangles, polygons with 4+ corners become quads around their centre. New points interpolate every attribute (UV, colour, custom); positions are not smoothed, so combine it with Noise or Space Warp. Guarded by the mesh caps.',
  keywords: ['subdivide', 'tessellate', 'refine', 'density', 'smooth'],
  inputs: mIn,
  outputs: mOut,
  params: [P.int('iterations', 1, { tab: 'Subdivide', min: 0, max: 5, tooltip: 'Each iteration multiplies the primitive count by 4 (triangles) or the corner count (n-gons).' })],
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Subdivide needs a mesh');
    return { output: meshValue(subdivide(src, ctx.params.int('iterations')), 'mesh') };
  },
});

const MASKS = [
  { value: 'cd_r', label: 'Vertex color R' }, { value: 'cd_g', label: 'Vertex color G' }, { value: 'cd_b', label: 'Vertex color B' }, { value: 'cd_a', label: 'Vertex color A' },
  { value: 'attribute', label: 'Attribute (name)' }, { value: 'texture', label: 'Gray texture via UV' }, { value: 'box', label: 'Inside box' },
];
const deleteMask = defineNode({
  ...base,
  id: 'geometry.delete_mask',
  title: 'Delete By Mask',
  description: 'Deletes primitives by a mask: vertex colour channel, an attribute, a Gray texture sampled at the UVs, or a box region (gizmo). A primitive is kept when the average mask of its points is >= the threshold (Invert flips; the box keeps what is inside). Unused points can be removed.',
  keywords: ['delete', 'mask', 'cut', 'remove', 'clip', 'dissolve', 'box'],
  inputs: [...mIn, { id: 'mask', name: 'Mask', type: 'gray' as const, optional: true, role: 'mask' as const }],
  outputs: mOut,
  cpuTextureInputs: ['mask'],
  params: [
    P.enum('source', 'cd_a', MASKS, { tab: 'Mask' }),
    P.string('attr', 'age', { tab: 'Mask', label: 'Attribute', visibleIf: (v) => v.source === 'attribute' }),
    P.enum('channel', 'luma', CHANNELS, { tab: 'Mask', label: 'Texture channel', visibleIf: (v) => v.source === 'texture' }),
    P.int('uv_set', 0, { tab: 'Mask', label: 'UV set', min: 0, max: 7, visibleIf: (v) => v.source === 'texture' }),
    P.float('threshold', 0.5, { tab: 'Mask', min: 0, max: 1, step: 0.01, animatable: true, visibleIf: (v) => v.source !== 'box' }),
    P.vec3('box_pos', [0, 0, 0], { tab: 'Mask', label: 'Box center', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: (v) => v.source === 'box' }),
    P.vec3('box_size', [1, 1, 1], { tab: 'Mask', label: 'Box size', min: 0.0001, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: (v) => v.source === 'box' }),
    P.bool('invert', false, { tab: 'Mask' }),
    P.bool('remove_unused', true, { tab: 'Mask', label: 'Remove unused points' }),
  ],
  gizmos: [{ id: 'box', type: 'box3d', viewport: '3d', space: 'world', position: 'box_pos', size: 'box_size', visibleIf: (v) => v.source === 'box' }],
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Delete By Mask needs a mesh');
    if (src.primCount === 0) throw new Error('Delete By Mask needs primitives');
    const p = ctx.params;
    const topo = src.topology;
    const n = src.pointCount;
    let per: Float32Array | null;
    if (p.str('source') === 'box') {
      per = new Float32Array(n);
      const c = p.vec3('box_pos'), s = p.vec3('box_size'), P0 = src.positions;
      for (let i = 0; i < n; i++) per[i] = Math.abs(P0[i * 3] - c[0]) <= s[0] / 2 && Math.abs(P0[i * 3 + 1] - c[1]) <= s[1] / 2 && Math.abs(P0[i * 3 + 2] - c[2]) <= s[2] / 2 ? 1 : 0;
    } else {
      const tex = cpuTexOf(ctx, 'mask');
      per = pointMask(src, p.str('source') as NoiseMask, p.str('attr'), false, tex, channelIndex(p.str('channel')), p.int('uv_set'));
      if (!per) return { output: meshValue(src.clone(), 'mesh') }; // texture still pending / attribute missing: neutral
    }
    const thr = p.str('source') === 'box' ? 0.5 : p.num('threshold');
    const keep = new Uint8Array(topo.primCount);
    for (let q = 0; q < topo.primCount; q++) {
      let s = 0;
      const a = topo.primStart[q], b = topo.primStart[q + 1];
      for (let k = a; k < b; k++) s += per[topo.vertPoint[k]];
      const v = b > a ? s / (b - a) : 0;
      keep[q] = (v >= thr) !== p.bool('invert') ? 1 : 0;
    }
    return { output: meshValue(deletePrimitives(src, keep, p.bool('remove_unused')), 'mesh') };
  },
});

const fuse = defineNode({
  ...base,
  id: 'geometry.fuse',
  title: 'Merge Vertices',
  description: 'Merges points closer than the distance (spatial hash, the first point wins) and removes primitives that collapse below 3 distinct points. Welds seams and duplicate cap points; note that smooth normals then average across the weld.',
  keywords: ['fuse', 'weld', 'merge vertices', 'merge points', 'distance', 'clean', 'seam'],
  inputs: mIn,
  outputs: mOut,
  params: [P.float('distance', 0.0001, { tab: 'Merge', min: 0, max: 100, softMax: 0.1, step: 0.0001 })],
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Merge Vertices needs a mesh');
    return { output: meshValue(fusePoints(src, ctx.params.num('distance')), 'mesh') };
  },
});

const bounds = defineNode({
  ...base,
  id: 'geometry.bounds',
  title: 'Bounds',
  description: 'Outputs the axis-aligned bounding box of the input as a box mesh (padding adds margin): a proxy for collision shapes, VAT bounds checks or fitting other nodes.',
  keywords: ['bounds', 'bounding box', 'aabb', 'box', 'proxy', 'extent'],
  inputs: mIn,
  outputs: mOut,
  params: [P.float('padding', 0, { tab: 'Bounds', min: -100, max: 100, softMin: -1, softMax: 1, step: 0.01, animatable: true })],
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Bounds needs a mesh');
    return { output: meshValue(boundsBox(src, ctx.params.num('padding')), 'mesh') };
  },
});

export default [normals, triangulate, subdiv, deleteMask, fuse, bounds];

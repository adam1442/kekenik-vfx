import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { projectUV, UV_MODES, type UvMode } from '../../../engine/mesh/ops';

/** geometry.uv — planar / cylindrical / spherical / box / per-island UV projection with a transformable projection volume. */
export default defineNode({
  id: 'geometry.uv',
  version: 1,
  category: 'geometry',
  title: 'UV',
  description: 'Writes per-vertex UVs (v up). Planar, cylindrical, spherical and box projections work inside a projection volume you move / rotate / scale with the gizmo; Island projects every connected island along its own dominant normal and packs them on a grid (layout tool, not an unwrapper). A post transform (scale / offset / rotation) is applied about the UV centre.',
  keywords: ['uv', 'projection', 'planar', 'cylindrical', 'spherical', 'box', 'island', 'unwrap', 'texture coordinates'],
  icon: 'cat-geometry',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.enum('mode', 'planar', UV_MODES.map((m) => ({ value: m, label: m.replace(/^\w/, (c) => c.toUpperCase()) })), { tab: 'UV', group: 'Projection' }),
    P.enum('axis', 'z', ['x', 'y', 'z'], { tab: 'UV', group: 'Projection', label: 'Planar axis', visibleIf: (v) => v.mode === 'planar' }),
    P.int('uv_set', 0, { tab: 'UV', group: 'Projection', min: 0, max: 7, label: 'UV set', tooltip: '0 writes "uv", n writes "uv<n>".' }),
    P.vec3('position', [0, 0, 0], { tab: 'UV', group: 'Projection volume', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: (v) => v.mode !== 'island' }),
    P.vec3('rotation', [0, 0, 0], { tab: 'UV', group: 'Projection volume', step: 1, softMin: -360, softMax: 360, unit: '°', animatable: true, visibleIf: (v) => v.mode !== 'island' }),
    P.vec3('size', [1, 1, 1], { tab: 'UV', group: 'Projection volume', min: 0.0001, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: (v) => v.mode !== 'island' }),
    P.float('margin', 0.05, { tab: 'UV', group: 'Island packing', min: 0, max: 0.45, step: 0.005, display: 'percent', visibleIf: (v) => v.mode === 'island' }),
    P.vec2('uv_scale', [1, 1], { tab: 'UV', group: 'UV transform', step: 0.01, softMin: -8, softMax: 8, linkable: true, animatable: true }),
    P.vec2('uv_offset', [0, 0], { tab: 'UV', group: 'UV transform', step: 0.01, softMin: -1, softMax: 1, animatable: true }),
    P.float('uv_rotation', 0, { tab: 'UV', group: 'UV transform', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 1, display: 'angle', animatable: true }),
  ],
  gizmos: [{ id: 'volume', type: 'transform3d', viewport: '3d', space: 'world', position: 'position', rotation: 'rotation', scale: 'size', visibleIf: (v) => v.mode !== 'island' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('UV needs a mesh');
    if (src.primCount === 0) throw new Error('UV needs primitives (this is a point cloud)');
    const p = ctx.params;
    const out = projectUV(src, { mode: p.str('mode') as UvMode, axis: p.str('axis') as 'x' | 'y' | 'z', position: p.vec3('position'), rotation: p.vec3('rotation'), size: p.vec3('size'), uv_set: p.int('uv_set'), uv_scale: p.vec2('uv_scale'), uv_offset: p.vec2('uv_offset'), uv_rotation: p.num('uv_rotation'), margin: p.num('margin') });
    return { output: meshValue(out, 'mesh') };
  },
});

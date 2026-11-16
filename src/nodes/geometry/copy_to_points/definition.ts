import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { copyToPoints } from '../../../engine/mesh/ops';

/** geometry.copy_to_points — instance a mesh on every point (orient / N, pscale, scale, Cd). */
export default defineNode({
  id: 'geometry.copy_to_points',
  version: 1,
  category: 'geometry',
  title: 'Copy To Points',
  description: 'Instances the mesh on every point. Each copy is rotated by the point `orient` (or aligned to `N`), scaled by `pscale` x `scale` x the global scale, and its colour is multiplied by the point `Cd`. Point attributes (id, age, custom) are written onto the copied points; `pivot` = the copy origin (pivot-baked meshes / VAT).',
  keywords: ['instance', 'copy', 'points', 'scatter', 'duplicate', 'orient', 'pscale'],
  icon: 'cat-geometry',
  inputs: [
    { id: 'mesh', name: 'Mesh', type: 'mesh' },
    { id: 'points', name: 'Points', type: 'points' },
  ],
  outputs: [{ id: 'mesh', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.bool('use_orient', true, { tab: 'Copy', label: 'Use orient', tooltip: 'Rotate each copy by the point orient quaternion.' }),
    P.bool('align_normal', true, { tab: 'Copy', label: 'Align to normal (if no orient)' }),
    P.bool('use_pscale', true, { tab: 'Copy', label: 'Use pscale' }),
    P.bool('use_scale', true, { tab: 'Copy', label: 'Use scale (vec3)' }),
    P.bool('use_color', true, { tab: 'Copy', label: 'Multiply by point color' }),
    P.float('scale', 1, { tab: 'Copy', label: 'Scale', min: 0, max: 1000, softMax: 4, step: 0.01, animatable: true }),
    P.vec3('rotate', [0, 0, 0], { tab: 'Copy', label: 'Rotate offset', step: 1, softMin: -360, softMax: 360, unit: '°', animatable: true, tooltip: 'Extra local rotation applied before the point orientation.' }),
  ],
  gizmos: [{ id: 'xf', type: 'transform3d', viewport: '3d', space: 'world', rotation: 'rotate', uniform: 'scale' }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.mesh);
    const pts = asMesh(ctx.inputs.points);
    if (!src || !pts) throw new Error('Copy To Points needs a Mesh and Points');
    const p = ctx.params;
    const out = copyToPoints(src, pts, { use_orient: p.bool('use_orient'), align_normal: p.bool('align_normal'), use_pscale: p.bool('use_pscale'), use_scale: p.bool('use_scale'), use_color: p.bool('use_color'), scale: p.num('scale'), rotate: p.vec3('rotate') });
    return { mesh: meshValue(out, 'mesh') };
  },
});

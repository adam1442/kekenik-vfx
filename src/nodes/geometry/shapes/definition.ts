import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { meshValue } from '../../../engine/mesh/accounting';
import { makeShape, SHAPE_KINDS, type ShapeKind } from '../../../engine/mesh/shapes';

const RADIAL: ShapeKind[] = ['disc', 'ring', 'cylinder', 'cone', 'tube', 'sphere', 'hemisphere', 'torus', 'arc_strip', 'spiral', 'crater'];
const BOXY: ShapeKind[] = ['plane', 'grid', 'quad', 'cube', 'cross_plane', 'arc_strip', 'spiral', 'cylinder', 'cone', 'tube'];
const is = (...k: ShapeKind[]) => (v: Record<string, unknown>) => k.includes(v.shape as ShapeKind);

/** geometry.shapes — parametric VFX primitives (plane/grid, disc, ring, cylinder, cone, sphere, hemisphere, cube, torus, arc strip, spiral, quad, cross-plane, crater/bowl, tube). */
export default defineNode({
  id: 'geometry.shapes',
  version: 1,
  category: 'geometry',
  title: 'Shapes',
  description: 'Parametric meshes for VFX: plane / grid, disc, ring (shockwave), cylinder, cone, tube, sphere, hemisphere, cube, torus, arc strip (sword swipe), spiral ribbon, quad, cross-plane, crater / bowl. Z up, UVs v-up, smooth normals with hard caps.',
  keywords: ['plane', 'grid', 'disc', 'ring', 'cylinder', 'cone', 'sphere', 'hemisphere', 'cube', 'box', 'torus', 'arc', 'swipe', 'spiral', 'crater', 'bowl', 'tube', 'primitive', 'mesh'],
  icon: 'cat-geometry',
  inputs: [],
  outputs: [{ id: 'mesh', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.enum('shape', 'plane', SHAPE_KINDS.map((s) => ({ value: s, label: s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) })), { tab: 'Geometry', group: 'Shape' }),
    P.vec3('center', [0, 0, 0], { tab: 'Geometry', group: 'Shape', step: 0.01, softMin: -10, softMax: 10, tooltip: 'Offset of the shape (world units).', animatable: true }),
    P.enum('pivot', 'center', [{ value: 'center', label: 'Center' }, { value: 'base', label: 'Base (min Z at 0)' }], { tab: 'Geometry', group: 'Shape' }),
    P.vec3('size', [1, 1, 1], { tab: 'Geometry', group: 'Size', min: 0.0001, max: 1000, softMax: 10, step: 0.01, animatable: true, tooltip: 'Plane / cube extents. Strips: X = width, Z = rise. Cylinder family: Z = height.', visibleIf: is(...BOXY) }),
    P.float('radius', 0.5, { tab: 'Geometry', group: 'Size', min: 0.0001, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: is(...RADIAL) }),
    P.float('inner_radius', 0.25, { tab: 'Geometry', group: 'Size', min: 0, max: 1000, softMax: 10, step: 0.01, animatable: true, tooltip: 'Ring / tube inner radius, torus tube radius, spiral start radius.', visibleIf: is('ring', 'tube', 'torus', 'spiral') }),
    P.float('taper', 1, { tab: 'Geometry', group: 'Size', min: 0, max: 8, softMax: 2, step: 0.01, animatable: true, tooltip: 'Cylinder top radius / strip end width multiplier.', visibleIf: is('cylinder', 'arc_strip', 'spiral') }),
    P.float('sweep', 360, { tab: 'Geometry', group: 'Size', min: 1, max: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Arc length in degrees.', visibleIf: is('disc', 'ring', 'arc_strip') }),
    P.float('turns', 2, { tab: 'Geometry', group: 'Size', min: 0.05, max: 32, softMax: 8, step: 0.05, animatable: true, visibleIf: is('spiral') }),
    P.float('depth', 0.25, { tab: 'Geometry', group: 'Size', min: 0, max: 100, softMax: 2, step: 0.01, animatable: true, visibleIf: is('crater') }),
    P.float('rim', 0.08, { tab: 'Geometry', group: 'Size', min: 0, max: 100, softMax: 1, step: 0.01, animatable: true, visibleIf: is('crater') }),
    P.int('segments', 32, { tab: 'Geometry', group: 'Subdivision', min: 3, max: 1024, softMax: 128, tooltip: 'Divisions around the axis / along strips.', visibleIf: is(...RADIAL) }),
    P.int('rings', 8, { tab: 'Geometry', group: 'Subdivision', min: 1, max: 512, softMax: 64, tooltip: 'Radial / height divisions (sphere and torus use twice this many).', visibleIf: is('disc', 'ring', 'cylinder', 'cone', 'tube', 'sphere', 'hemisphere', 'torus', 'crater') }),
    P.int('cols', 1, { tab: 'Geometry', group: 'Subdivision', min: 1, max: 1024, softMax: 64, label: 'Columns', visibleIf: is('plane', 'grid', 'cube', 'cross_plane') }),
    P.int('rows', 1, { tab: 'Geometry', group: 'Subdivision', min: 1, max: 1024, softMax: 64, label: 'Rows', tooltip: 'Strips: divisions across the width.', visibleIf: is('plane', 'grid', 'cube', 'cross_plane', 'arc_strip', 'spiral') }),
    P.int('count', 2, { tab: 'Geometry', group: 'Subdivision', min: 1, max: 64, softMax: 8, label: 'Planes', visibleIf: is('cross_plane') }),
    P.bool('caps', true, { tab: 'Geometry', group: 'Subdivision', visibleIf: is('cylinder', 'cone', 'tube', 'hemisphere') }),
    P.enum('uv_mode', 'polar', ['polar', 'planar'], { tab: 'Geometry', group: 'UV', tooltip: 'Polar: u = angle, v = radius (shockwave textures). Planar: top view.', visibleIf: is('disc', 'ring', 'crater') }),
  ],
  gizmos: [
    { id: 'center', type: 'point3d', viewport: '3d', space: 'world', param: 'center', label: 'Center' },
    { id: 'radius', type: 'radius3d', viewport: '3d', space: 'world', center: 'center', radius: 'radius', visibleIf: (v) => RADIAL.includes(v.shape as ShapeKind) },
    { id: 'size', type: 'box3d', viewport: '3d', space: 'world', position: 'center', size: 'size', visibleIf: (v) => BOXY.includes(v.shape as ShapeKind) && !RADIAL.includes(v.shape as ShapeKind) },
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const p = ctx.params;
    const mesh = makeShape({
      shape: p.str('shape') as ShapeKind,
      size: p.vec3('size'),
      radius: p.num('radius'),
      inner_radius: p.num('inner_radius'),
      taper: p.num('taper'),
      cols: p.int('cols'),
      rows: p.int('rows'),
      segments: p.int('segments'),
      rings: p.int('rings'),
      sweep: p.num('sweep'),
      turns: p.num('turns'),
      count: p.int('count'),
      caps: p.bool('caps'),
      depth: p.num('depth'),
      rim: p.num('rim'),
      uv_mode: p.str('uv_mode') as 'polar' | 'planar',
      pivot: p.str('pivot') as 'center' | 'base',
      center: p.vec3('center'),
    });
    return { mesh: meshValue(mesh, 'mesh') };
  },
});

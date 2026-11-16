import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { EXTRACT_MODES, extractPoints, type ExtractMode } from '../../../engine/mesh/attrs';

/** geometry.extract_points — mesh to points (points, vertices, primitive centres or island centres). */
export default defineNode({
  id: 'geometry.extract_points',
  version: 1,
  category: 'geometry',
  title: 'Extract Points',
  description:
    'Converts a mesh into a point cloud: one point per mesh point, vertex, primitive (centroid + normal) or per connected island (centroid / bounds centre / base centre, id = island, optional pscale from the island size). Attributes are kept (vertex and primitive values are averaged onto the points), `orient` is built from the normal and `id` is added when missing, so the result feeds Copy To Points directly.',
  keywords: ['extract', 'points', 'mesh to points', 'island', 'centers', 'centroid', 'vertices', 'scatter', 'instance'],
  icon: 'cat-geometry',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }],
  outputs: [{ id: 'output', name: 'Points', type: 'points' }],
  common: { texture: false },
  params: [
    P.enum('mode', 'points', EXTRACT_MODES.map((m) => ({ value: m, label: { points: 'Points', vertices: 'Vertices', primitives: 'Primitive centers', islands: 'Island centers' }[m] })), { tab: 'Extract' }),
    P.enum('island_center', 'bounds', [{ value: 'centroid', label: 'Centroid' }, { value: 'bounds', label: 'Bounds center' }, { value: 'base', label: 'Bounds base (min Z)' }], { tab: 'Extract', label: 'Island center', visibleIf: (v) => v.mode === 'islands' }),
    P.int('stride', 1, { tab: 'Extract', label: 'Keep every n-th', min: 1, max: 100000, softMax: 32 }),
    P.int('max_points', 1000000, { tab: 'Extract', label: 'Max points', min: 1, max: 4000000, softMax: 100000, tooltip: 'Hard guard against huge point clouds.' }),
    P.enum('pscale_from', 'none', [{ value: 'none', label: 'Keep existing' }, { value: 'size', label: 'From element size' }], { tab: 'Attributes', label: 'pscale' }),
    P.bool('orient_from_normal', true, { tab: 'Attributes', label: 'Build orient from N' }),
    P.bool('keep_attributes', true, { tab: 'Attributes', label: 'Keep attributes' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Extract Points needs a mesh');
    const p = ctx.params;
    const out = extractPoints(src, { mode: p.str('mode') as ExtractMode, islandCenter: p.str('island_center') as 'bounds', stride: p.int('stride'), maxPoints: p.int('max_points'), pscaleFrom: p.str('pscale_from') as 'none', orientFromNormal: p.bool('orient_from_normal'), keepAttributes: p.bool('keep_attributes') });
    return { output: meshValue(out, 'points') };
  },
});

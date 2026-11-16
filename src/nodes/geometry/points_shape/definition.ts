import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { makePoints, POINT_MODES, type PointMode } from '../../../engine/mesh/points';

const is = (...k: PointMode[]) => (v: Record<string, unknown>) => k.includes(v.mode as PointMode);

/** geometry.points_shape — point clouds: line, circle, grid, sphere, along a mesh surface, random scatter. */
export default defineNode({
  id: 'geometry.points_shape',
  version: 1,
  category: 'geometry',
  title: 'Points Shape',
  description: 'Generates points with position, normal, orient, pscale, id, age and color: on a line, circle / arc, grid, sphere (Fibonacci), area-weighted on the surface of a connected mesh, or randomly in a box (seeded). Feed them to Copy To Points.',
  keywords: ['points', 'scatter', 'line', 'circle', 'grid', 'sphere', 'surface', 'random', 'distribute'],
  icon: 'cat-geometry',
  inputs: [{ id: 'mesh', name: 'Surface', type: 'mesh', optional: true, tooltip: 'Surface mode scatters points on this mesh.' }],
  outputs: [{ id: 'points', name: 'Points', type: 'points' }],
  common: { texture: false },
  params: [
    P.enum('mode', 'circle', POINT_MODES.map((m) => ({ value: m, label: m.replace(/^\w/, (c) => c.toUpperCase()) })), { tab: 'Points', group: 'Distribution' }),
    P.int('count', 16, { tab: 'Points', group: 'Distribution', min: 1, max: 1_000_000, softMax: 1000, animatable: true, visibleIf: (v) => v.mode !== 'grid' }),
    P.vec2('grid', [4, 4], { tab: 'Points', group: 'Distribution', integer: true, min: 1, max: 1000, softMax: 64, label: 'Grid divisions', visibleIf: is('grid') }),
    P.vec3('start', [-1, 0, 0], { tab: 'Points', group: 'Transform', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: is('line') }),
    P.vec3('end', [1, 0, 0], { tab: 'Points', group: 'Transform', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: is('line') }),
    P.vec3('center', [0, 0, 0], { tab: 'Points', group: 'Transform', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: is('circle', 'grid', 'sphere', 'random') }),
    P.float('radius', 1, { tab: 'Points', group: 'Transform', min: 0, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: is('circle', 'sphere') }),
    P.float('sweep', 360, { tab: 'Points', group: 'Transform', min: 1, max: 360, step: 1, display: 'angle', animatable: true, visibleIf: is('circle') }),
    P.vec3('size', [2, 2, 0], { tab: 'Points', group: 'Transform', min: 0, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: is('grid', 'random') }),
    P.seed('seed', 1, { tab: 'Points', group: 'Attributes', visibleIf: is('surface', 'random') }),
    P.float('pscale', 1, { tab: 'Points', group: 'Attributes', min: 0, max: 1000, softMax: 4, step: 0.01, animatable: true }),
    P.bool('align', true, { tab: 'Points', group: 'Attributes', label: 'Orient to normal', tooltip: 'orient = rotation of local +Z onto the point normal.' }),
    P.bool('random_orient', false, { tab: 'Points', group: 'Attributes', label: 'Random orientation' }),
    P.color('color', [1, 1, 1, 1], { tab: 'Points', group: 'Attributes', hdr: true, label: 'Color (Cd)' }),
  ],
  gizmos: [
    { id: 'center', type: 'point3d', viewport: '3d', space: 'world', param: 'center', visibleIf: (v) => ['circle', 'grid', 'sphere', 'random'].includes(v.mode as string) },
    { id: 'radius', type: 'radius3d', viewport: '3d', space: 'world', center: 'center', radius: 'radius', visibleIf: (v) => v.mode === 'circle' || v.mode === 'sphere' },
    { id: 'box', type: 'box3d', viewport: '3d', space: 'world', position: 'center', size: 'size', visibleIf: (v) => v.mode === 'grid' || v.mode === 'random' },
    { id: 'start', type: 'point3d', viewport: '3d', space: 'world', param: 'start', label: 'Start', visibleIf: (v) => v.mode === 'line' },
    { id: 'end', type: 'point3d', viewport: '3d', space: 'world', param: 'end', label: 'End', visibleIf: (v) => v.mode === 'line' },
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const p = ctx.params;
    const mode = p.str('mode') as PointMode;
    const surface = asMesh(ctx.inputs.mesh);
    if (mode === 'surface' && !surface) throw new Error('Surface mode: connect a mesh to the Surface input.');
    const g = p.vec2('grid');
    const pts = makePoints(
      { mode, count: p.int('count'), start: p.vec3('start'), end: p.vec3('end'), center: p.vec3('center'), radius: p.num('radius'), size: p.vec3('size'), sweep: p.num('sweep'), grid: [g[0], g[1]], seed: p.seed('seed'), pscale: p.num('pscale'), align: p.bool('align'), color: p.rgba('color'), random_orient: p.bool('random_orient') },
      surface,
    );
    return { points: meshValue(pts, 'points') };
  },
});

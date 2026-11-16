import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { transformMesh } from '../../../engine/mesh/ops';

/** Mesh + Points variants of Transform (pin types are static in this engine; same factory pattern as the 4A filters). */
function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.transform' : 'geometry.transform_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Transform' : 'Transform (Points)',
    description: 'Translate, rotate (Euler XYZ degrees) and scale about a pivot. Normals use the inverse transpose, orient / scale / pscale / pivot attributes follow, mirroring flips the winding. Unchanged attributes are shared (copy-on-write).',
    keywords: ['move', 'translate', 'rotate', 'scale', 'pivot', 'transform', 'gizmo'],
    icon: 'cat-geometry',
    inputs: [{ id: 'input', name: pin === 'mesh' ? 'Mesh' : 'Points', type: pin }],
    outputs: [{ id: 'output', name: pin === 'mesh' ? 'Mesh' : 'Points', type: pin }],
    common: { texture: false },
    params: [
      P.vec3('translate', [0, 0, 0], { tab: 'Transform', step: 0.01, softMin: -10, softMax: 10, animatable: true }),
      P.vec3('rotate', [0, 0, 0], { tab: 'Transform', step: 1, softMin: -360, softMax: 360, unit: '°', animatable: true, tooltip: 'Euler angles in degrees, applied X then Y then Z.' }),
      P.vec3('scale', [1, 1, 1], { tab: 'Transform', step: 0.01, softMin: -4, softMax: 4, animatable: true }),
      P.float('uniform', 1, { tab: 'Transform', label: 'Uniform scale', min: -1000, max: 1000, softMin: 0.01, softMax: 4, step: 0.01, animatable: true }),
      P.vec3('pivot', [0, 0, 0], { tab: 'Transform', step: 0.01, softMin: -10, softMax: 10, animatable: true, tooltip: 'Rotation / scale centre (before the translation).' }),
    ],
    gizmos: [{ id: 'xf', type: 'transform3d', viewport: '3d', space: 'world', position: 'translate', rotation: 'rotate', scale: 'scale', uniform: 'uniform', pivot: 'pivot' }],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const src = asMesh(ctx.inputs.input);
      if (!src) throw new Error('Transform needs an input');
      const p = ctx.params;
      return { output: meshValue(transformMesh(src, { translate: p.vec3('translate'), rotate: p.vec3('rotate'), scale: p.vec3('scale'), uniform: p.num('uniform'), pivot: p.vec3('pivot') }), pin) };
    },
  });
}
export default [make('mesh'), make('points')];

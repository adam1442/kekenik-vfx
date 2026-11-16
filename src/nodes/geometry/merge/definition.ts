import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { mergeMeshes } from '../../../engine/mesh/ops';
import type { MeshData } from '../../../engine/mesh/mesh';

const SLOTS = 6;
function make(pin: 'mesh' | 'points'): NodeDefinition {
  return defineNode({
    id: pin === 'mesh' ? 'geometry.merge' : 'geometry.merge_points',
    version: 1,
    category: 'geometry',
    title: pin === 'mesh' ? 'Merge' : 'Merge (Points)',
    description: 'Concatenates up to six inputs. Attributes are united; missing values get defaults (orient identity, scale / pscale 1, Cd white). Empty slots are ignored.',
    keywords: ['merge', 'combine', 'append', 'join', 'union'],
    icon: 'cat-geometry',
    inputs: Array.from({ length: SLOTS }, (_, i) => ({ id: `in${i + 1}`, name: `${pin === 'mesh' ? 'Mesh' : 'Points'} ${i + 1}`, type: pin, optional: true })),
    outputs: [{ id: 'output', name: pin === 'mesh' ? 'Mesh' : 'Points', type: pin }],
    common: { texture: false },
    params: [],
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate(ctx) {
      const list: MeshData[] = [];
      for (let i = 1; i <= SLOTS; i++) {
        const m = asMesh(ctx.inputs[`in${i}`]);
        if (m) list.push(m);
      }
      if (!list.length) throw new Error('Merge needs at least one input');
      return { output: meshValue(mergeMeshes(list), pin) };
    },
  });
}
export default [make('mesh'), make('points')];

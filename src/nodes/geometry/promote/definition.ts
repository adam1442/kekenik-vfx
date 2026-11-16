import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh, meshValue } from '../../../engine/mesh/accounting';
import { promoteAttr, type PromoteMode } from '../../../engine/mesh/builder';
import type { Element } from '../../../engine/mesh/mesh';

const ELEMENTS = [{ value: 'point', label: 'Point' }, { value: 'vertex', label: 'Vertex' }, { value: 'primitive', label: 'Primitive' }, { value: 'detail', label: 'Detail' }];

/** geometry.promote — move an attribute between point / vertex / primitive / detail with a reduction mode. */
export default defineNode({
  id: 'geometry.promote',
  version: 1,
  category: 'geometry',
  title: 'Promote',
  description:
    'Moves an attribute between elements (point <-> vertex <-> primitive <-> detail). Going to a coarser element reduces the values with the chosen mode (average, sum, min, max, first); going to a finer one copies them. Example: promote vertex `Cd` to points before Extract Points, or a primitive `island` id to points.',
  keywords: ['promote', 'attribute', 'point', 'vertex', 'primitive', 'detail', 'average', 'convert', 'reduce'],
  icon: 'cat-geometry',
  inputs: [{ id: 'input', name: 'Mesh', type: 'mesh' }],
  outputs: [{ id: 'output', name: 'Mesh', type: 'mesh' }],
  common: { texture: false },
  params: [
    P.string('attribute', 'Cd', { tab: 'Promote', label: 'Attribute', tooltip: 'Name of the attribute (Cd, N, uv, age, id, island, custom ...).' }),
    P.enum('from', 'vertex', ELEMENTS, { tab: 'Promote', label: 'From' }),
    P.enum('to', 'point', ELEMENTS, { tab: 'Promote', label: 'To' }),
    P.enum('mode', 'average', ['average', 'sum', 'min', 'max', 'first'], { tab: 'Promote', label: 'Reduction' }),
    P.bool('keep_original', false, { tab: 'Promote', label: 'Keep original' }),
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const src = asMesh(ctx.inputs.input);
    if (!src) throw new Error('Promote needs a mesh');
    const p = ctx.params;
    const name = p.str('attribute');
    const from = p.str('from') as Element;
    const to = p.str('to') as Element;
    if (!src.has(from, name)) throw new Error(`Promote: the mesh has no ${from} attribute "${name}"`);
    return { output: meshValue(promoteAttr(src, name, from, to, p.str('mode') as PromoteMode, p.bool('keep_original')), 'mesh') };
  },
});

import { defineNode, type NodeDefinition } from '../../../engine/graph/node';
import type { PinDef } from '../../../engine/graph/pins';
import { MeshData } from '../../../engine/mesh/mesh';
import { meshValue } from '../../../engine/mesh/accounting';
import { P, type ParamDef } from '../../../engine/params/schema';
import { defineShader } from '../../../engine/shaders/library';
import { makeLayout } from '../../../engine/shaders/uniforms';
import type { PinType, TexturePin } from '../../../engine/types';
import shaderSrc from './const.wgsl?raw';

/**
 * Subgraph boundary nodes. They exist INSIDE a subgraph definition and define its interface:
 *   Input  (`subgraph.in_<type>`)  : no inputs; evaluates to its default constant when the instance pin is unconnected
 *                                   (and when the subgraph is opened for editing). Params: name, order, default value.
 *   Output (`subgraph.out_<type>`) : pass-through (`passthrough: true`), so previews work inside the subgraph.
 * Pin id on the instance == the boundary node id (stable under renames).
 */
const SHADER = defineShader('subgraph_const.wgsl', shaderSrc);
const LAYOUT = makeLayout([
  { name: 'c', type: 'vec4f' },
  { name: 'mode', type: 'f32' },
]);

const TYPES: PinType[] = ['gray', 'color', 'normal', 'uv', 'mesh', 'points'];
const TITLES: Record<string, string> = { gray: 'Gray', color: 'Color', normal: 'Normal', uv: 'UV', mesh: 'Mesh', points: 'Points' };

const common = (): ParamDef[] => [
  P.string('name', 'Input', { label: 'Pin name', group: 'Interface', tooltip: 'Name of the pin on the subgraph node.' }),
  P.int('order', 0, { label: 'Order', group: 'Interface', min: -1000, max: 1000, tooltip: 'Pins are sorted by this value (then by position).' }),
];

function inputDef(t: PinType): NodeDefinition {
  const isTex = t === 'gray' || t === 'color' || t === 'normal' || t === 'uv';
  const params: ParamDef[] = common();
  if (t === 'gray') params.push(P.float('value', 0, { group: 'Default', min: -16, max: 16, softMin: 0, softMax: 1, step: 0.01, label: 'Default value', tooltip: 'Used when the pin is not connected.' }));
  if (t === 'color') params.push(P.color('color', [0, 0, 0, 1], { group: 'Default', hdr: true, label: 'Default color' }));
  const out: PinDef = { id: 'output', name: 'Output', type: t };
  return defineNode({
    id: `subgraph.in_${t}`,
    version: 1,
    category: 'subgraph',
    title: `Input (${TITLES[t]})`,
    description: `Interface input of a subgraph (${TITLES[t]}). Unconnected on the instance: this node's default is used.`,
    keywords: ['subgraph', 'input', 'interface', 'pin', t],
    icon: 'cat-subgraph',
    inputs: [],
    outputs: [out],
    params,
    common: { texture: isTex, blending: false },
    cost: { gpu: 'trivial', tiling: 'pixel' },
    shaders: isTex ? [{ source: SHADER, uniforms: LAYOUT, textures: 0 }] : undefined,
    evaluate(ctx) {
      if (t === 'mesh' || t === 'points') return { output: meshValue(MeshData.fromPositions(new Float32Array(0)), t) };
      const tp = t as TexturePin;
      const tex = ctx.tex(tp);
      const c = t === 'gray' ? [ctx.params.num('value'), 0, 0, 1] : t === 'color' ? ctx.params.rgba('color') : t === 'normal' ? [0.5, 0.5, 1, 1] : [0, 0, 0, 1];
      ctx.pass({ label: 'subgraph input', target: tex, shader: SHADER, uniforms: { layout: LAYOUT, values: { c: c as number[], mode: t === 'uv' ? 1 : 0 } }, textures: [], ss: 1 });
      return { output: ctx.result(tex, tp) };
    },
  });
}

function outputDef(t: PinType): NodeDefinition {
  const pin: PinDef = { id: 'output', name: 'Output', type: t };
  return defineNode({
    id: `subgraph.out_${t}`,
    version: 1,
    category: 'subgraph',
    title: `Output (${TITLES[t]})`,
    description: `Interface output of a subgraph (${TITLES[t]}). Connect the result you want to expose.`,
    keywords: ['subgraph', 'output', 'interface', 'pin', t],
    icon: 'cat-subgraph',
    inputs: [{ id: 'input', name: 'Input', type: t }],
    outputs: [pin],
    params: common().map((p) => (p.id === 'name' ? { ...p, default: 'Output' } : p)) as ParamDef[],
    common: { texture: false, blending: false },
    passthrough: true,
    cost: { gpu: 'trivial', tiling: 'pixel' },
    evaluate() {
      throw new Error('Output boundary nodes are pass-through.');
    },
  });
}

export default [...TYPES.map(inputDef), ...TYPES.map(outputDef)];

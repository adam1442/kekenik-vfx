import { describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import { buildPlan } from '../src/engine/graph/plan';
import { flattenGraph, flattenToData } from '../src/engine/subgraph/flatten';
import { SubgraphLibrary } from '../src/engine/subgraph/library';
import { buildMakeSubgraph, buildUnlinkInstance, promoteParam, setExposedCommand } from '../src/engine/subgraph/make';
import { defTypeId } from '../src/engine/subgraph/def';
import { makeRegistry } from './helpers';

const opts = { time: 0, scale: 1, maxDim: 4096 };
function beamGraph() {
  const reg = makeRegistry();
  const g = new Graph(reg, { width: 256, height: 256 });
  const noise = g.addNode('grayscale.noise', { id: 'noise', name: 'Noise', params: { scale: [2, 8] } }).id;
  const shape = g.addNode('grayscale.shape', { id: 'shape', name: 'Shape', params: { shape: 'rounded_rect' } }).id;
  const blend = g.addNode('utils.blend', { id: 'blend', name: 'Blend', params: { blend_type: 'multiply' } }).id;
  const ramp = g.addNode('color.ramp', { id: 'ramp', name: 'Ramp' }).id;
  const out = g.addNode('export.color', { id: 'out', name: 'Out' }).id;
  g.connect({ node: noise, pin: 'output' }, { node: blend, pin: 'foreground' });
  g.connect({ node: shape, pin: 'output' }, { node: blend, pin: 'background' });
  g.connect({ node: blend, pin: 'output' }, { node: ramp, pin: 'input' });
  g.connect({ node: ramp, pin: 'output' }, { node: out, pin: 'input' });
  return { reg, g, lib: new SubgraphLibrary(reg) };
}
const hashOf = (g: Graph, node: string) => buildPlan(g, [node], opts).nodes.get(node)!.hash;

describe('subgraphs', () => {
  it('Make subgraph infers inputs / outputs from cut links and is one undo step', () => {
    const { g, lib } = beamGraph();
    const ed = new GraphEditor(g);
    const r = buildMakeSubgraph(g, lib, ['blend', 'ramp'], 'Beam');
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    ed.stack.execute(r.command);
    expect(g.nodes.has('blend')).toBe(false);
    const inst = g.nodes.get(r.instanceId)!;
    expect(inst.type).toBe(defTypeId(r.defId));
    const ex = g.registry.expanded(inst.type)!;
    expect(ex.inputs.map((p) => p.type)).toEqual(['gray', 'gray']); // two cut links -> two Inputs
    expect(ex.outputs.map((p) => p.type)).toEqual(['color']);
    expect(g.linksTo('out')).toHaveLength(1);
    ed.stack.undo();
    expect(g.nodes.has('blend')).toBe(true);
    expect(g.nodes.has(r.instanceId)).toBe(false);
    expect(g.linksTo('out')[0].from.node).toBe('ramp');
    ed.stack.redo();
    expect(g.nodes.has(r.instanceId)).toBe(true);
  });

  it('flattened graph evaluates (hashes) exactly like the inline graph', () => {
    const { g: inline } = beamGraph();
    const before = hashOf(inline, 'out');
    const { g, lib } = beamGraph();
    const ed = new GraphEditor(g);
    const r = buildMakeSubgraph(g, lib, ['blend', 'ramp'], 'Beam');
    if (typeof r === 'string') throw new Error(r);
    ed.stack.execute(r.command);
    const flat = flattenGraph(g, lib)!;
    expect(flat).not.toBeNull();
    expect(hashOf(flat.graph, 'out')).toBe(before);
    // target mapping: the instance's output resolves to the inner ramp node
    const t = flat.mapTarget({ nodeId: r.instanceId });
    expect(t.nodeId).toContain('~');
    expect(flat.rootOf(t.nodeId)).toBe(r.instanceId);
    // plain graphs are untouched (zero overhead)
    expect(flattenGraph(inline, lib)).toBeNull();
  });

  it('promoted parameters drive the inner node and invalidate the hash', () => {
    const { g, lib } = beamGraph();
    const ed = new GraphEditor(g);
    const r = buildMakeSubgraph(g, lib, ['blend', 'ramp'], 'Beam');
    if (typeof r === 'string') throw new Error(r);
    ed.stack.execute(r.command);
    const exposed = promoteParam(lib, r.defId, 'blend', 'cross_mix', { label: 'Mix', group: 'Beam', min: 0, max: 1 });
    expect(typeof exposed).not.toBe('string');
    const inner = ed.stack;
    inner.execute(setExposedCommand(lib, r.defId, exposed as never));
    const ex = g.registry.expanded(defTypeId(r.defId))!;
    const pdef = ex.params.find((p) => p.id === 'x_1')!;
    expect(pdef.label).toBe('Mix');
    expect(promoteParam(lib, r.defId, 'blend', 'cross_mix')).toBe('This parameter is already exposed.');
    const h0 = hashOf(flattenGraph(g, lib)!.graph, 'out');
    g.setParam(r.instanceId, 'x_1', 0.9);
    const flat = flattenGraph(g, lib)!;
    expect(flat.graph.nodes.get(`${r.instanceId}~blend`)!.params.cross_mix).toBe(0.9);
    expect(hashOf(flat.graph, 'out')).not.toBe(h0);
    // undo restores the old exposed list (pins / params follow)
    inner.undo();
    expect(g.registry.expanded(defTypeId(r.defId))!.params.some((p) => p.id === 'x_1')).toBe(false);
  });

  it('two instances share the definition but cache per instance; unlink makes it unique', () => {
    const { g, lib } = beamGraph();
    const ed = new GraphEditor(g);
    const r = buildMakeSubgraph(g, lib, ['blend', 'ramp'], 'Beam');
    if (typeof r === 'string') throw new Error(r);
    ed.stack.execute(r.command);
    const n2 = g.addNode(defTypeId(r.defId), { id: 'inst2', name: 'Beam 2' }).id;
    const flat = flattenGraph(g, lib)!;
    expect(flat.graph.nodes.has(`${r.instanceId}~ramp`)).toBe(true);
    expect(flat.graph.nodes.has(`${n2}~ramp`)).toBe(true);
    const u = buildUnlinkInstance(g, lib, n2);
    if (typeof u === 'string') throw new Error(u);
    ed.stack.execute(u.command);
    expect(g.nodes.get(n2)!.type).toBe(defTypeId(u.defId));
    expect(u.defId).not.toBe(r.defId);
    ed.stack.undo();
    expect(g.nodes.get(n2)!.type).toBe(defTypeId(r.defId));
  });

  it('nested subgraphs flatten recursively; recursion is cut and reported', () => {
    const { g, lib } = beamGraph();
    const ed = new GraphEditor(g);
    const r1 = buildMakeSubgraph(g, lib, ['blend'], 'Inner');
    if (typeof r1 === 'string') throw new Error(r1);
    ed.stack.execute(r1.command);
    const r2 = buildMakeSubgraph(g, lib, [r1.instanceId, 'ramp'], 'Outer');
    if (typeof r2 === 'string') throw new Error(r2);
    ed.stack.execute(r2.command);
    const { g: inline } = beamGraph();
    expect(hashOf(flattenGraph(g, lib)!.graph, 'out')).toBe(hashOf(inline, 'out'));
    expect(flattenToData(g, lib).nodes.some((n) => n.id.split('~').length === 3)).toBe(true);
    // recursion: put an instance of Outer inside Outer
    const outer = lib.get(r2.defId)!;
    outer.graph.nodes.push({ id: 'loop', type: defTypeId(r2.defId), typeVersion: 1, name: 'Loop', x: 0, y: 0, params: {} });
    lib.put(outer);
    expect(lib.wouldRecurse(r2.defId, r2.defId)).toBe(true);
    const flat = flattenGraph(g, lib)!;
    expect([...flat.graph.nodes.values()].some((n) => n.type === defTypeId(r2.defId))).toBe(true); // kept as an erroring node, no infinite loop
  });

  it('library export / import round-trips and remaps colliding ids', () => {
    const { g, lib } = beamGraph();
    const ed = new GraphEditor(g);
    const r = buildMakeSubgraph(g, lib, ['blend', 'ramp'], 'Beam');
    if (typeof r === 'string') throw new Error(r);
    ed.stack.execute(r.command);
    const bundle = JSON.parse(JSON.stringify(lib.exportBundle(r.defId)));
    const lib2 = new SubgraphLibrary(makeRegistry());
    expect(lib2.importBundle(bundle).root).toBe(r.defId);
    expect(lib2.registry.has(defTypeId(r.defId))).toBe(true);
    // same id, different content -> new id
    const changed = JSON.parse(JSON.stringify(bundle));
    changed.defs[0].graph.nodes[0].name = 'changed';
    expect(lib2.importBundle(changed).root).not.toBe(r.defId);
    expect(() => lib2.importBundle({ format: 'nope' })).toThrow();
    // project (de)serialization keeps definitions
    const lib3 = new SubgraphLibrary(makeRegistry());
    lib3.load(JSON.parse(JSON.stringify(lib.toData())));
    expect(lib3.has(r.defId)).toBe(true);
  });
});

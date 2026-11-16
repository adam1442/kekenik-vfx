import { beforeAll, describe, expect, it } from 'vitest';
import { Graph, GraphError } from '../src/engine/graph/graph';
import { buildPlan, topoOrder } from '../src/engine/graph/plan';
import { validateGraph } from '../src/engine/graph/validate';
import { expandDefinition, validateDefinition } from '../src/engine/graph/expand';
import { defineNode } from '../src/engine/graph/node';
import { canConnect } from '../src/engine/graph/pins';
import { NodeRegistry } from '../src/engine/graph/registry';
import { makeRegistry } from './helpers';

let reg: NodeRegistry;
beforeAll(() => {
  reg = makeRegistry();
});
const planOpts = { time: 0, scale: 1, maxDim: 16384 };

/** noise -> levels -> blend(fg), uniform -> blend(bg) */
function demoGraph() {
  const g = new Graph(reg, { width: 256, height: 256 });
  const noise = g.addNode('grayscale.noise', { id: 'noise' }).id;
  const levels = g.addNode('utils.levels', { id: 'levels' }).id;
  const uni = g.addNode('grayscale.uniform', { id: 'uni' }).id;
  const blend = g.addNode('utils.blend', { id: 'blend' }).id;
  g.connect({ node: noise, pin: 'output' }, { node: levels, pin: 'input' });
  g.connect({ node: levels, pin: 'output' }, { node: blend, pin: 'foreground' });
  g.connect({ node: uni, pin: 'output' }, { node: blend, pin: 'background' });
  return g;
}

describe('node registry & definitions', () => {
  it('auto-discovers the reference nodes', () => {
    for (const id of ['grayscale.uniform', 'grayscale.noise', 'utils.levels', 'utils.blend']) expect(reg.has(id), id).toBe(true);
  });
  it('expands modulation pins/params, background pin and common tabs', () => {
    const e = reg.expanded('grayscale.uniform')!;
    expect(e.inputs.map((p) => p.id)).toEqual(['value_mod', 'background']);
    expect(e.params.map((p) => p.id)).toContain('value_mod_k');
    expect(e.params.map((p) => p.id)).toContain('blend_mode');
    expect(e.tabs).toEqual(['Main', 'Texture', 'Blending']);
    const lv = reg.expanded('utils.levels')!;
    expect(lv.inputs.map((p) => p.id)).toEqual(['input']);
    expect(lv.tabs).toEqual(['Main', 'Texture']);
  });
  it('rejects invalid definitions', () => {
    const bad = defineNode({ id: 'Bad', version: 0, category: 'utils', title: '', description: '', icon: '', inputs: [], outputs: [], params: [], evaluate: () => ({}) });
    expect(validateDefinition(bad).length).toBeGreaterThan(2);
    const clash = defineNode({
      id: 'utils.clash',
      version: 1,
      category: 'utils',
      title: 'x',
      description: '',
      icon: '',
      inputs: [],
      outputs: [{ id: 'o', name: 'o', type: 'gray' }],
      params: [{ type: 'float', id: 'tex_ss', label: 'x', default: 0 }],
      evaluate: () => ({}),
    });
    expect(validateDefinition(clash).join()).toMatch(/reserved/);
    expect(() => new NodeRegistry().register(bad)).toThrow();
    expect(expandDefinition(reg.get('utils.blend')!).inputs.map((p) => p.id)).toEqual(['foreground', 'background', 'mask']);
  });
  it('searches by title/keyword', () => {
    expect(reg.search('perlin')[0].id).toBe('grayscale.noise');
    expect(reg.search('gamma')[0].id).toBe('utils.levels');
  });
});

describe('graph model', () => {
  it('connects with type rules; Gray->Color implicit only', () => {
    expect(canConnect('gray', 'color')).toBe(true);
    expect(canConnect('color', 'gray')).toBe(false);
    expect(canConnect('uv', 'gray')).toBe(false);
  });
  it('prevents cycles and bad pins', () => {
    const g = demoGraph();
    expect(() => g.connect({ node: 'blend', pin: 'output' }, { node: 'levels', pin: 'input' })).toThrow(GraphError);
    expect(() => g.connect({ node: 'blend', pin: 'output' }, { node: 'blend', pin: 'mask' })).toThrow(/cycle/);
    expect(() => g.connect({ node: 'noise', pin: 'nope' }, { node: 'levels', pin: 'input' })).toThrow(/no output/);
  });
  it('replaces the link on an occupied input and reports it', () => {
    const g = demoGraph();
    const r = g.connect({ node: 'uni', pin: 'output' }, { node: 'levels', pin: 'input' });
    expect(r.replaced?.from.node).toBe('noise');
    expect(g.linksTo('levels')).toHaveLength(1);
  });
  it('clamps params against the schema', () => {
    const g = demoGraph();
    expect(g.setParam('noise', 'octaves', 99)).toBe(8);
    expect(g.setParam('noise', 'noise_type', 'garbage')).toBe('perlin');
    expect(g.setParam('noise', 'scale', [0, 1000])).toEqual([1, 256]);
    expect(() => g.setParam('noise', 'nope', 1)).toThrow(GraphError);
  });
  it('dirty propagation: events carry the downstream closure', () => {
    const g = demoGraph();
    let dirty: string[] = [];
    g.events.on((e) => (dirty = [...e.dirty].sort()));
    g.setParam('noise', 'roughness', 0.7);
    expect(dirty).toEqual(['blend', 'levels', 'noise']);
    g.setParam('uni', 'value', 0.1);
    expect(dirty).toEqual(['blend', 'uni']);
    const rev = g.revision;
    g.moveNode('noise', 10, 10); // meta: no evaluation impact
    expect(g.revision).toBe(rev);
  });
  it('validates a full graph', () => {
    const g = demoGraph();
    expect(validateGraph(g).filter((i) => i.severity === 'error')).toEqual([]);
    g.addNode('utils.levels', { id: 'lonely' });
    expect(validateGraph(g).some((i) => i.nodeId === 'lonely')).toBe(true);
  });
  it('round-trips through toData/fromData and keeps unknown node types', () => {
    const g = demoGraph();
    g.setParam('noise', 'seed', 7);
    const data = g.toData();
    data.nodes.push({ id: 'ghost', type: 'future.thing', typeVersion: 1, name: 'Ghost', x: 0, y: 0, params: { a: 1 } });
    const { graph, warnings } = Graph.fromData(reg, data);
    expect(graph.nodes.get('noise')!.params.seed).toBe(7);
    expect(graph.nodes.has('ghost')).toBe(true);
    expect(warnings.join()).toMatch(/Unknown node type/);
    expect(graph.links.size).toBe(3);
  });
  it('runs migrateParams when the stored version is older', () => {
    const r = new NodeRegistry();
    r.register(
      defineNode({
        id: 'utils.mig',
        version: 2,
        category: 'utils',
        title: 'Mig',
        description: '',
        icon: '',
        inputs: [],
        outputs: [{ id: 'o', name: 'o', type: 'gray' }],
        params: [{ type: 'float', id: 'amount', label: 'Amount', default: 0 }],
        migrateParams: (old) => ({ amount: Number(old.legacy_amount) * 2 }),
        evaluate: () => ({}),
      }),
    );
    const data = { settings: new Graph(r).settings, nodes: [{ id: 'm', type: 'utils.mig', typeVersion: 1, name: 'm', x: 0, y: 0, params: { legacy_amount: 2 } }], links: [] };
    expect(Graph.fromData(r, data).graph.nodes.get('m')!.params.amount).toBe(4);
  });
});

describe('plan: order, frames, hashing (version-hash caching)', () => {
  it('orders only what the target needs', () => {
    const g = demoGraph();
    expect(topoOrder(g, ['levels'])).toEqual(['noise', 'levels']);
    const o = topoOrder(g, ['blend']);
    expect(o.indexOf('noise')).toBeLessThan(o.indexOf('levels'));
    expect(o.indexOf('levels')).toBeLessThan(o.indexOf('blend'));
    expect(o).toHaveLength(4);
  });
  it('hash changes only for the edited node and its downstream', () => {
    const g = demoGraph();
    const a = buildPlan(g, ['blend'], planOpts);
    g.setParam('noise', 'roughness', 0.9);
    const b = buildPlan(g, ['blend'], planOpts);
    const same = (id: string) => a.nodes.get(id)!.hash === b.nodes.get(id)!.hash;
    expect(same('uni')).toBe(true);
    expect(same('noise')).toBe(false);
    expect(same('levels')).toBe(false);
    expect(same('blend')).toBe(false);
  });
  it('identical graphs produce identical hashes; param order does not matter', () => {
    const a = buildPlan(demoGraph(), ['blend'], planOpts);
    const b = buildPlan(demoGraph(), ['blend'], planOpts);
    for (const id of a.order) expect(a.nodes.get(id)!.hash).toBe(b.nodes.get(id)!.hash);
  });
  it('resolves size/tiling/filtering sources (From Graph | From Parent | Absolute)', () => {
    const g = demoGraph();
    g.setParam('noise', 'tex_size_mode', 'absolute');
    g.setParam('noise', 'tex_size_abs', [128, 64]);
    g.setParam('noise', 'tex_tiling_mode', 'absolute');
    g.setParam('noise', 'tex_tiling', 'x');
    let p = buildPlan(g, ['levels'], planOpts);
    expect(p.nodes.get('noise')!.frame).toMatchObject({ width: 128, height: 64, tileX: true, tileY: false });
    // levels is From Parent by default -> inherits size and tiling from noise
    expect(p.nodes.get('levels')!.frame).toMatchObject({ width: 128, height: 64, tileX: true, tileY: false });
    g.setParam('levels', 'tex_size_mode', 'from_graph');
    g.setParam('levels', 'tex_size_mul', [0.5, 2]);
    p = buildPlan(g, ['levels'], planOpts);
    expect(p.nodes.get('levels')!.frame).toMatchObject({ width: 128, height: 512 });
    // generator with no parent falls back to the graph
    g.setParam('uni', 'tex_size_mode', 'from_parent');
    expect(buildPlan(g, ['uni'], planOpts).nodes.get('uni')!.frame).toMatchObject({ width: 256, height: 256, tileX: true, tileY: true });
  });
  it('preview scale shrinks sizes and changes hashes; clamps to maxDim', () => {
    const g = demoGraph();
    const full = buildPlan(g, ['levels'], planOpts);
    const half = buildPlan(g, ['levels'], { ...planOpts, scale: 0.5 });
    expect(half.nodes.get('levels')!.frame.width).toBe(128);
    expect(half.nodes.get('levels')!.hash).not.toBe(full.nodes.get('levels')!.hash);
    expect(buildPlan(g, ['levels'], { ...planOpts, maxDim: 100 }).nodes.get('levels')!.frame.width).toBe(100);
  });
  it('applies the param animator and the HQ flag', () => {
    const g = demoGraph();
    const p = buildPlan(g, ['noise'], { ...planOpts, animator: (_n, v, t) => ({ ...v, evolution: t }), time: 0.5 });
    expect(p.nodes.get('noise')!.params.evolution).toBe(0.5);
    g.setSettings({ bitDepth: 32 });
    expect(buildPlan(g, ['noise'], planOpts).nodes.get('noise')!.frame.hq).toBe(true);
  });
  it('tiled (region) planning uses region size and rejects non-graph-sized nodes', () => {
    const g = demoGraph();
    const region = { px: -8, py: 256, pw: 80, ph: 80 };
    const p = buildPlan(g, ['levels'], { ...planOpts, region });
    expect(p.nodes.get('levels')!.frame).toMatchObject({ width: 80, height: 80, fullWidth: 256, originX: -8, originY: 256 });
    g.setParam('noise', 'tex_size_mode', 'absolute');
    expect(buildPlan(g, ['noise'], { ...planOpts, region }).nodes.get('noise')!.error).toMatch(/Tiled/);
  });
  it('expands the unknown-type case into a plan error instead of throwing', () => {
    const { graph } = Graph.fromData(reg, { settings: new Graph(reg).settings, nodes: [{ id: 'g', type: 'x.y', typeVersion: 1, name: 'g', x: 0, y: 0, params: {} }], links: [] });
    expect(buildPlan(graph, ['g'], planOpts).nodes.get('g')!.error).toMatch(/Unknown node type/);
  });
});

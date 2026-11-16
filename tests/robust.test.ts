import { beforeAll, describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph, defaultGraphSettings } from '../src/engine/graph/graph';
import type { NodeRegistry } from '../src/engine/graph/registry';
import { Autosaver, MemoryAutosave, loadAutosaveSafe } from '../src/engine/io/autosave';
import { fnv1a, unwrapIntegrity, wrapIntegrity } from '../src/engine/io/integrity';
import { projectToJson, serializeProject } from '../src/engine/io/project';
import { loadProjectRobust } from '../src/engine/io/robust-load';
import { salvageGraphData, salvageTruncatedJson } from '../src/engine/io/salvage';
import { makeRegistry } from './helpers';

let reg: NodeRegistry;
beforeAll(() => {
  reg = makeRegistry();
});

function sampleProject(): string {
  const ed = new GraphEditor(new Graph(reg, { width: 64, height: 64 }));
  const a = ed.addNode('grayscale.noise', { x: 0, y: 0 });
  const b = ed.addNode('utils.levels', { x: 200, y: 0 });
  ed.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
  return projectToJson(serializeProject(ed.graph, { name: 'Robust' }));
}

describe('integrity envelope', () => {
  it('round-trips and detects truncation / bit flips; plain JSON passes unchecked', () => {
    const json = sampleProject();
    const w = wrapIntegrity(json);
    expect(unwrapIntegrity(w)).toMatchObject({ ok: true, wrapped: true, json });
    expect(unwrapIntegrity(w.slice(0, w.length - 10)).ok).toBe(false);
    const flipped = w.slice(0, w.length - 20) + (w[w.length - 20] === 'a' ? 'b' : 'a') + w.slice(w.length - 19);
    expect(unwrapIntegrity(flipped).ok).toBe(false);
    expect(unwrapIntegrity(json)).toMatchObject({ ok: true, wrapped: false });
    expect(unwrapIntegrity('KKI1 deadbeef')).toMatchObject({ ok: false });
    expect(fnv1a('')).toBe('811c9dc5');
  });
});

describe('autosave with backup slot', () => {
  it('keeps the previous good copy and falls back to it when the newest is damaged', async () => {
    const backend = new MemoryAutosave();
    let n = 0;
    const saver = new Autosaver(backend, () => wrapIntegrity(JSON.stringify({ n: ++n })), 'autosave', 1);
    await saver.flush();
    await saver.flush();
    expect(backend.data.has('autosave.prev')).toBe(true);
    expect(await loadAutosaveSafe(backend, 'autosave')).toMatchObject({ source: 'primary' });
    // simulate a write killed half way
    const cur = backend.data.get('autosave')!;
    backend.data.set('autosave', { ...cur, json: cur.json.slice(0, cur.json.length - 3) });
    const r = await loadAutosaveSafe(backend, 'autosave');
    expect(r?.source).toBe('backup');
    backend.data.set('autosave.prev', { ...cur, json: 'garbage' });
    expect(await loadAutosaveSafe(backend, 'autosave')).toBeNull();
  });
});

describe('corrupted project recovery', () => {
  it('healthy files load without repairs', () => {
    const r = loadProjectRobust(reg, sampleProject());
    expect(r.repairs).toEqual([]);
    expect(r.graph.nodes.size).toBe(2);
  });
  it('drops broken nodes / links and still loads the rest', () => {
    const p = JSON.parse(sampleProject());
    p.graph.nodes.push(null, { type: 5 }, { id: p.graph.nodes[0].id, type: 'grayscale.noise', params: { scale: Infinity } });
    p.graph.links.push({ id: 'x', from: { node: 'ghost', pin: 'o' }, to: { node: p.graph.nodes[0].id, pin: 'input' } }, 42);
    p.graph.settings = null;
    const r = loadProjectRobust(reg, JSON.stringify(p));
    expect(r.graph.nodes.size).toBe(3); // 2 good + the duplicate (renamed)
    expect(r.graph.links.size).toBe(1);
    expect(r.repairs.length).toBeGreaterThan(0);
  });
  it('recovers a truncated file', () => {
    const json = sampleProject();
    const cut = json.slice(0, Math.floor(json.length * 0.8));
    const r = loadProjectRobust(reg, cut);
    expect(r.repairs.join(' ')).toMatch(/truncated/);
    expect(r.graph.nodes.size).toBeGreaterThanOrEqual(1);
  });
  it('recovers a damaged integrity envelope, rejects foreign files and newer versions', () => {
    const w = wrapIntegrity(sampleProject());
    const damaged = w.replace(/"Robust"/, '"Robust2"');
    const r = loadProjectRobust(reg, damaged);
    expect(r.repairs.join(' ')).toMatch(/integrity/);
    expect(() => loadProjectRobust(reg, '{"hello":1}')).toThrow();
    expect(() => loadProjectRobust(reg, 'not json at all')).toThrow();
    const newer = JSON.parse(sampleProject());
    newer.version = 999;
    expect(() => loadProjectRobust(reg, JSON.stringify(newer))).toThrow(/newer/);
  });
  it('salvageGraphData never throws and always yields a loadable graph', () => {
    for (const junk of [null, 5, 'x', [], { nodes: 3, links: {} }, { nodes: [{}], links: [{}] }]) {
      const { data } = salvageGraphData(junk, defaultGraphSettings());
      expect(() => Graph.fromData(reg, data)).not.toThrow();
    }
    expect(salvageTruncatedJson('[1,2')).toBeNull();
    expect(salvageTruncatedJson('{"a":[1,2,{"b":')).toEqual({ a: [1, 2] });
  });
});

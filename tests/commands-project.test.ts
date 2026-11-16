import { beforeAll, describe, expect, it } from 'vitest';
import { CommandStack } from '../src/engine/commands/command';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import type { NodeRegistry } from '../src/engine/graph/registry';
import { Autosaver, MemoryAutosave } from '../src/engine/io/autosave';
import { deserializeProject, migrateProject, ProjectError, projectFromJson, projectToJson, serializeProject } from '../src/engine/io/project';
import { makeRegistry } from './helpers';

let reg: NodeRegistry;
beforeAll(() => {
  reg = makeRegistry();
});
const snapshot = (g: Graph) => {
  const d = g.toData();
  d.nodes.sort((a, b) => a.id.localeCompare(b.id));
  d.links.sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify(d);
};

function editor() {
  const ed = new GraphEditor(new Graph(reg, { width: 128, height: 128 }));
  let t = 0;
  ed.stack.now = () => t;
  return { ed, tick: (ms: number) => (t += ms) };
}

describe('commands: undo/redo', () => {
  it('undoes add/connect/remove exactly (including links and replaced links)', () => {
    const { ed } = editor();
    const a = ed.addNode('grayscale.noise');
    const b = ed.addNode('utils.levels');
    const c = ed.addNode('grayscale.uniform');
    ed.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
    const s1 = snapshot(ed.graph);
    ed.connect({ node: c, pin: 'output' }, { node: b, pin: 'input' }); // replaces
    expect(ed.graph.linksTo(b)[0].from.node).toBe(c);
    ed.stack.undo();
    expect(snapshot(ed.graph)).toBe(s1);
    ed.removeNodes([b]);
    expect(ed.graph.nodes.has(b)).toBe(false);
    expect(ed.graph.links.size).toBe(0);
    ed.stack.undo();
    expect(snapshot(ed.graph)).toBe(s1);
    ed.stack.redo();
    expect(ed.graph.nodes.has(b)).toBe(false);
  });
  it('coalesces slider drags into one undo step; a pause or seal starts a new one', () => {
    const { ed, tick } = editor();
    const n = ed.addNode('grayscale.noise');
    for (let i = 1; i <= 20; i++) {
      ed.setParam(n, 'roughness', i / 20);
      tick(16);
    }
    expect(ed.graph.nodes.get(n)!.params.roughness).toBe(1);
    ed.stack.undo();
    expect(ed.graph.nodes.get(n)!.params.roughness).toBe(0.5); // back to the original in ONE step
    ed.stack.redo();
    expect(ed.graph.nodes.get(n)!.params.roughness).toBe(1);
    ed.setParam(n, 'roughness', 0.2);
    tick(2000); // long pause: separate step
    ed.setParam(n, 'roughness', 0.3);
    ed.stack.undo();
    expect(ed.graph.nodes.get(n)!.params.roughness).toBe(0.2);
    ed.stack.sealTop();
    ed.setParam(n, 'roughness', 0.9);
    ed.stack.undo();
    expect(ed.graph.nodes.get(n)!.params.roughness).toBe(0.2);
  });
  it('transactions group commands and roll back on error', () => {
    const { ed } = editor();
    const before = snapshot(ed.graph);
    const ids = ed.stack.transaction('Build', () => {
      const a = ed.addNode('grayscale.noise');
      const b = ed.addNode('utils.levels');
      ed.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
      return [a, b];
    });
    expect(ids).toHaveLength(2);
    ed.stack.undo();
    expect(snapshot(ed.graph)).toBe(before);
    expect(() =>
      ed.stack.transaction('Fail', () => {
        ed.addNode('grayscale.noise');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(ed.graph.nodes.size).toBe(0);
    expect(ed.stack.canUndo).toBe(false);
  });
  it('duplicate is one undo step and keeps internal links', () => {
    const { ed } = editor();
    const a = ed.addNode('grayscale.noise');
    const b = ed.addNode('utils.levels');
    ed.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
    const dup = ed.duplicate([a, b]);
    expect(ed.graph.nodes.size).toBe(4);
    expect(ed.graph.links.size).toBe(2);
    expect(ed.graph.inputLink(dup[1], 'input')!.from.node).toBe(dup[0]);
    ed.stack.undo();
    expect(ed.graph.nodes.size).toBe(2);
  });
  it('tracks the dirty state against the saved point and clears redo on new edits', () => {
    const s = new CommandStack();
    const { ed } = editor();
    expect(s.isDirty).toBe(false);
    ed.addNode('grayscale.noise');
    ed.stack.markSaved();
    expect(ed.stack.isDirty).toBe(false);
    ed.setParam(ed.graph.nodes.keys().next().value as string, 'seed', 3);
    expect(ed.stack.isDirty).toBe(true);
    ed.stack.undo();
    expect(ed.stack.isDirty).toBe(false);
    ed.stack.undo();
    expect(ed.stack.canRedo).toBe(true);
    ed.addNode('utils.levels');
    expect(ed.stack.canRedo).toBe(false);
  });
});

describe('project file', () => {
  it('serializes and restores a graph (JSON round trip)', () => {
    const { ed } = editor();
    const a = ed.addNode('grayscale.noise', { params: { seed: 5 } });
    const b = ed.addNode('utils.levels');
    ed.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
    const json = projectToJson(serializeProject(ed.graph, { name: 'T' }));
    const { graph, project, warnings } = deserializeProject(reg, projectFromJson(json));
    expect(project.name).toBe('T');
    expect(warnings).toEqual([]);
    expect(JSON.stringify(graph.toData())).toBe(JSON.stringify(ed.graph.toData()));
  });
  it('runs migrations in order and rejects newer / foreign files', () => {
    const base = { format: 'kekenik-vfx', version: 1, graph: { settings: {}, nodes: [], links: [] } };
    const migrations = {
      1: (p: Record<string, unknown>) => ({ ...p, a: 1 }),
      2: (p: Record<string, unknown>) => ({ ...p, b: (p.a as number) + 1 }),
    };
    const r = migrateProject(base, migrations, 3);
    expect((r.project as unknown as Record<string, number>).b).toBe(2);
    expect(r.project.version).toBe(3);
    expect(r.migratedFrom).toBe(1);
    expect(() => migrateProject({ ...base, version: 9 })).toThrow(ProjectError);
    expect(() => migrateProject({ format: 'other', version: 1 })).toThrow(/Not a Kekenik/);
    expect(() => migrateProject({ ...base, graph: null })).toThrow(/no valid graph/);
    expect(() => projectFromJson('{nope')).toThrow(ProjectError);
  });
  it('autosaves debounced to the backend', async () => {
    const backend = new MemoryAutosave();
    let n = 0;
    const as = new Autosaver(backend, () => `v${++n}`, 'slot', 5);
    as.notifyChanged();
    as.notifyChanged();
    await new Promise((r) => setTimeout(r, 40));
    expect(n).toBe(1);
    expect(await backend.load('slot')).toBe('v1');
    await as.flush();
    expect(await backend.load('slot')).toBe('v2');
    expect((await backend.list())[0].slot).toBe('slot');
  });
});

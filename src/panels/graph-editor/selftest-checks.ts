import { GraphEditor } from '../../engine/commands/graph-commands';
import { Graph, type GraphData } from '../../engine/graph/graph';
import type { NodeRegistry } from '../../engine/graph/registry';
import { CATEGORIES } from '../../engine/graph/categories';
import { computeNodeLayout, distToPolyline, linkSamples, NODE, polylineIntersectsSegment, rectsIntersect, type Pt, type Rect } from './core/geometry';
import { layeredLayout } from './core/layout';
import { GraphScene } from './core/scene';
import { alignRects, distributeRects, snapMove } from './core/snap';
import { SpatialGrid } from './core/spatial';
import { UsageStats } from './core/usage';
import { checkLink, compatibleDefs, pickPin } from './core/validity';
import { frameRect, toScreen, toWorld, ViewAnimator, visibleWorldRect, zoomAt } from './core/viewport';
import { parseClip } from './core/clipboard';
import { GraphOps, emptySel } from './ops';

/**
 * GPU-free graph-editor checks, shared by vitest (tests/graph-editor.test.ts) AND the in-app self-test page, so the user can
 * confirm the same logic inside the real browser. Each check throws on failure and may return a detail string.
 */
export interface EditorCheck {
  name: string;
  run(): string | void;
}
const ok = (c: unknown, m: string): void => {
  if (!c) throw new Error(m);
};
const near = (a: number, b: number, tol: number, m: string): void => {
  if (Math.abs(a - b) > tol) throw new Error(`${m}: ${a} vs ${b}`);
};

/** Layered DAG of uniforms (col 0) and blends (3 inputs each) — ~`cols*rows` nodes, ~3 links per blend. */
export function buildDag(reg: NodeRegistry, cols: number, rows: number): Graph {
  const g = new Graph(reg, { width: 256, height: 256 });
  const ids: string[][] = [];
  let seed = 12345;
  const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let c = 0; c < cols; c++) {
    ids.push([]);
    for (let r = 0; r < rows; r++) {
      const n = g.addNode(c === 0 ? 'grayscale.uniform' : 'utils.blend', { x: c * 240, y: r * 250 });
      ids[c].push(n.id);
      if (c > 0) {
        for (const pin of ['foreground', 'background', 'mask']) {
          const src = ids[c - 1][Math.floor(rnd() * rows)];
          g.connect({ node: src, pin: 'output' }, { node: n.id, pin });
        }
      }
    }
  }
  return g;
}

export function graphEditorChecks(getRegistry: () => NodeRegistry): EditorCheck[] {
  const mk = (): { g: Graph; ed: GraphEditor; scene: GraphScene; ops: GraphOps } => {
    const g = new Graph(getRegistry());
    const ed = new GraphEditor(g);
    const scene = new GraphScene(g);
    return { g, ed, scene, ops: new GraphOps(() => ed, scene, null) };
  };
  return [
    {
      name: 'Graph editor: layered auto-layout is left-to-right, overlap-free and deterministic',
      run() {
        const nodes = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, x: i * 3, y: i * 7, w: 160, h: 120 }));
        const links = [
          { from: 'a', to: 'c' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'd' },
          { from: 'c', to: 'e' },
        ];
        const m1 = layeredLayout(nodes, links);
        const m2 = layeredLayout(nodes, links);
        ok(JSON.stringify([...m1]) === JSON.stringify([...m2]), 'not deterministic');
        const x = (id: string): number => m1.get(id)![0];
        ok(x('a') < x('c') && x('b') < x('c') && x('c') < x('d') && x('c') < x('e'), 'edges must point right');
        const rs = nodes.map((n) => ({ id: n.id, r: { x: m1.get(n.id)![0], y: m1.get(n.id)![1], w: n.w, h: n.h } }));
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) ok(!rectsIntersect({ ...rs[i].r, w: rs[i].r.w - 1, h: rs[i].r.h - 1 }, rs[j].r) || rs[i].r.x === rs[j].r.x && false, `overlap ${rs[i].id}/${rs[j].id}`);
        ok(layeredLayout([], []).size === 0, 'empty');
      },
    },
    {
      name: 'Graph editor: spatial grid culling == brute force (500 rects)',
      run() {
        const grid = new SpatialGrid(256);
        const rects: Rect[] = [];
        let s = 7;
        const rnd = (): number => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
        for (let i = 0; i < 500; i++) {
          const r = { x: rnd() * 8000 - 1000, y: rnd() * 6000 - 500, w: 100 + rnd() * 120, h: 80 + rnd() * 200 };
          rects.push(r);
          grid.insert(`n${i}`, r);
        }
        for (let k = 0; k < 40; k++) {
          const q = { x: rnd() * 7000, y: rnd() * 5000, w: 50 + rnd() * 2500, h: 50 + rnd() * 1800 };
          const want = rects.map((r, i) => (rectsIntersect(r, q) ? `n${i}` : null)).filter(Boolean).sort();
          const got = grid.query(q).sort();
          ok(JSON.stringify(want) === JSON.stringify(got), `query ${k} mismatch (${want.length} vs ${got.length})`);
        }
        const huge = grid.query({ x: -1e6, y: -1e6, w: 2e6, h: 2e6 });
        ok(huge.length === 500, 'huge query must return everything once');
      },
    },
    {
      name: 'Graph editor: pin / node / link hit-testing and layout',
      run() {
        const { g, scene } = mk();
        const u = g.addNode('grayscale.uniform', { x: 0, y: 0 }).id;
        const lv = g.addNode('utils.levels', { x: 400, y: 100 }).id;
        g.connect({ node: u, pin: 'output' }, { node: lv, pin: 'input' });
        scene.invalidate('struct');
        scene.ensure();
        const lay = scene.layoutOf(u);
        const out = scene.pinWorld(u, 'output', 'out')!;
        near(out.x, lay.w, 1e-6, 'output pin sits on the right edge');
        const hit = scene.pinAt(out.x + 2, out.y - 1, 9);
        ok(hit && hit.node === u && hit.pin === 'output' && hit.side === 'out', 'pinAt output');
        ok(scene.pinAt(out.x + 60, out.y, 9) === null, 'no pin far away');
        ok(scene.nodeAt(10, 10) === u && scene.nodeAt(-50, -50) === null, 'nodeAt');
        const segs = scene.visibleSegments({ x: -100, y: -100, w: 1000, h: 600 });
        ok(segs.length === 1 && segs[0].links.length === 1, 'one visible link segment');
        const pts = linkSamples(segs[0].a, segs[0].b, 'bezier', 24);
        near(distToPolyline({ x: (segs[0].a.x + segs[0].b.x) / 2, y: (segs[0].a.y + segs[0].b.y) / 2 }, pts), 0, 3, 'bezier passes through its midpoint');
        ok(!scene.visibleSegments({ x: 5000, y: 5000, w: 100, h: 100 }).length, 'culled link is not returned');
        const ex = g.registry.expanded('utils.levels')!;
        const l0 = computeNodeLayout(ex, undefined, new Set());
        const l1 = computeNodeLayout(ex, { collapsed: true }, new Set());
        ok(l1.h === NODE.headerH && l0.h > l1.h && l0.thumb && !l1.thumb, 'collapsed layout');
        ok(l0.inputs.every((p) => !p.isMod), 'modulation pins hidden unless connected');
      },
    },
    {
      name: 'Graph editor: link validity (types, cycles) and pin picking',
      run() {
        const { g } = mk();
        const a = g.addNode('grayscale.uniform').id;
        const b = g.addNode('utils.levels').id;
        const c = g.addNode('utils.levels').id;
        g.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
        g.connect({ node: b, pin: 'output' }, { node: c, pin: 'input' });
        ok(checkLink(g, { node: a, pin: 'output' }, { node: c, pin: 'input' }).ok, 'gray -> gray ok');
        const cyc = checkLink(g, { node: c, pin: 'output' }, { node: b, pin: 'input' });
        ok(!cyc.ok && cyc.reason === 'cycle', 'cycle detected');
        ok(checkLink(g, { node: a, pin: 'output' }, { node: a, pin: 'input' }).reason !== 'ok', 'self link rejected');
        const ex = g.registry.expanded('utils.blend')!;
        ok(pickPin(ex, 'in', 'gray')?.id === 'foreground', 'first free exact pin first');
        ok(pickPin(ex, 'in', 'gray', new Set(['foreground']))?.id === 'background', 'prefers unconnected pins');
        ok(pickPin(ex, 'in', 'mesh') === undefined, 'no pin for mesh');
        ok(compatibleDefs(g.registry, 'out', 'gray').some((d) => d.id === 'utils.levels') && compatibleDefs(g.registry, 'out', 'mesh').some((d) => d.id === 'geometry.transform'), 'compatibleDefs');
      },
    },
    {
      name: 'Graph editor: annotations — undo/redo, project round-trip, pruning, garbage input',
      run() {
        const { g, ed, ops } = mk();
        const n = ed.addNode('grayscale.uniform', { x: 10, y: 20 });
        ops.setUi([n], { collapsed: true, color: '#e5534b' }, 'Collapse');
        const fid = ops.addFrame({ x: 0, y: 0, w: 300, h: 200 }, 'Hello');
        ok(g.annotations.nodeUi[n].collapsed && g.annotations.frames.length === 1, 'applied');
        const data = g.toData();
        ok(data.annotations?.frames[0].id === fid, 'serialised');
        const back = Graph.fromData(getRegistry(), JSON.parse(JSON.stringify(data)) as GraphData).graph;
        ok(back.annotations.nodeUi[n].color === '#e5534b' && back.annotations.frames[0].title === 'Hello', 'round trip');
        ed.stack.undo();
        ok(g.annotations.frames.length === 0 && g.annotations.nodeUi[n].collapsed, 'undo frame');
        ed.stack.undo();
        ok(!g.annotations.nodeUi[n], 'undo ui');
        ed.stack.redo();
        ed.stack.redo();
        ok(g.annotations.frames.length === 1, 'redo');
        ed.removeNodes([n]);
        ok(!g.toData().annotations?.nodeUi[n], 'dead node ui pruned on save');
        ed.stack.undo();
        ok(g.annotations.nodeUi[n]?.collapsed, 'undo delete restores ui');
        const junk = Graph.fromData(getRegistry(), { settings: g.settings, nodes: [], links: [], annotations: { frames: [{ nope: 1 }, { id: 'f', x: 'x' }], nodeUi: 5, linkVia: { l: 'x' } } as never }).graph;
        ok(junk.annotations.frames.length === 1 && junk.annotations.frames[0].x === 0, 'sanitised');
      },
    },
    {
      name: 'Graph editor: reroutes, bundles, delete-with-heal, copy/paste (JSON) and duplicate, all undoable',
      run() {
        const { g, ed, ops } = mk();
        const a = ed.addNode('grayscale.uniform', { x: 0, y: 0 });
        const b = ed.addNode('utils.levels', { x: 300, y: 0 });
        const c = ed.addNode('utils.levels', { x: 600, y: 0 });
        ed.connect({ node: a, pin: 'output' }, { node: b, pin: 'input' });
        ed.connect({ node: b, pin: 'output' }, { node: c, pin: 'input' });
        const lAB = g.inputLink(b, 'input')!;
        const rr = ops.insertReroute([lAB.id], 0, { x: 150, y: 40 });
        ok(g.annotations.linkVia[lAB.id]?.[0] === rr, 'reroute attached to link');
        const scene = new GraphScene(g);
        ok(scene.anchorsOf(lAB)!.length === 3, 'anchors include the reroute');
        // heal
        ops.deleteSelection({ ...emptySel(), nodes: new Set([b]) }, true);
        ok(!g.nodes.has(b) && g.inputLink(c, 'input')?.from.node === a, 'delete + heal bridges A -> C');
        ed.stack.undo();
        ok(g.nodes.has(b) && g.inputLink(c, 'input')?.from.node === b, 'undo heal restores the chain');
        // copy / paste / duplicate
        const sel = { ...emptySel(), nodes: new Set([a, b]) };
        const clip = ops.copy(sel)!;
        ok(clip.nodes.length === 2 && clip.links.length === 1 && clip.reroutes.length === 1, 'clip content');
        const parsed = parseClip(JSON.stringify(clip));
        ok(parsed && parseClip('{"format":"nope"}') === null && parseClip('garbage') === null, 'parseClip');
        const before = g.nodes.size;
        const pasted = ops.paste(parsed!, { x: 100, y: 500 });
        ok(g.nodes.size === before + 2 && pasted.nodes.size === 2 && pasted.reroutes.size === 1, 'paste adds nodes + reroute');
        const newLinks = [...g.links.values()].filter((l) => pasted.nodes.has(l.from.node) && pasted.nodes.has(l.to.node));
        ok(newLinks.length === 1 && g.annotations.linkVia[newLinks[0].id]?.length === 1, 'pasted link keeps its reroute');
        ed.stack.undo();
        ok(g.nodes.size === before, 'paste is ONE undo step');
        const d = ops.duplicate({ ...emptySel(), nodes: new Set([c]) })!;
        ok(d.nodes.size === 1 && g.nodes.size === before + 1, 'duplicate');
      },
    },
    {
      name: 'Graph editor: node creation from a dragged pin connects and aligns the new node',
      run() {
        const { g, ops } = mk();
        const a = g.addNode('grayscale.uniform', { x: 0, y: 0 }).id;
        const id = ops.addNode('utils.levels', { x: 300, y: 100 }, { ref: { node: a, pin: 'output' }, side: 'out', type: 'gray' })!;
        ok(!!g.inputLink(id, 'input'), 'auto-connected');
        const n = g.nodes.get(id)!;
        ok(n.x >= 300 && n.x % NODE.gridSize === 0, 'placed to the right of the drop, grid-snapped');
      },
    },
    {
      name: 'Graph editor: snapping guides, align and distribute',
      run() {
        const r = snapMove({ x: 103, y: 50, w: 100, h: 60 }, [{ x: 100, y: 300, w: 200, h: 80 }], { grid: null, threshold: 6 });
        ok(r.dx === -3 && r.guides.some((g) => g.axis === 'x'), 'snaps left edges and reports a guide');
        const g2 = snapMove({ x: 13, y: 27, w: 50, h: 50 }, [], { grid: 20, threshold: 6 });
        ok(g2.dx === 7 && g2.dy === -7, 'grid snap');
        const items = [
          { id: 'a', r: { x: 0, y: 0, w: 10, h: 10 } },
          { id: 'b', r: { x: 50, y: 20, w: 10, h: 10 } },
          { id: 'c', r: { x: 200, y: 5, w: 10, h: 10 } },
        ];
        ok(alignRects(items, 'left').get('c')![0] === 0 && alignRects(items, 'bottom').get('a')![1] === 20, 'align');
        const d = distributeRects(items, 'x');
        ok(d.get('b')![0] === 100, 'distribute keeps outer nodes and equalises gaps');
      },
    },
    {
      name: 'Graph editor: camera math (zoom to cursor, framing, animation) and link cutting',
      run() {
        const v = { x: 30, y: -20, zoom: 0.8 };
        const p = { x: 400, y: 300 };
        const w0 = toWorld(v, p);
        const v2 = zoomAt(v, p.x, p.y, 1.7);
        const p2 = toScreen(v2, w0);
        near(p2.x, p.x, 1e-9, 'zoom anchor x');
        near(p2.y, p.y, 1e-9, 'zoom anchor y');
        const f = frameRect({ x: 0, y: 0, w: 1000, h: 500 }, 800, 600, 50);
        const vis = visibleWorldRect(f, 800, 600);
        ok(vis.x <= 0 && vis.y <= 0 && vis.x + vis.w >= 1000 && vis.y + vis.h >= 500, 'framed rect fully visible');
        const an = new ViewAnimator();
        an.set({ x: 0, y: 0, zoom: 1 });
        an.focusTo(f, 800, 600);
        let n = 0;
        while (an.step(1 / 60, 800, 600) && n++ < 600);
        ok(n < 600, 'animation converges');
        near(an.view.zoom, f.zoom, 1e-6, 'animation ends at target zoom');
        const pts: Pt[] = linkSamples({ x: 0, y: 0 }, { x: 300, y: 100 }, 'bezier', 24);
        ok(polylineIntersectsSegment(pts, { x: 150, y: -100 }, { x: 150, y: 300 }), 'cutter crosses the link');
        ok(!polylineIntersectsSegment(pts, { x: 150, y: 250 }, { x: 150, y: 300 }), 'cutter below does not');
      },
    },
    {
      name: 'Graph editor: usage statistics rank suggestions by context and persist',
      run() {
        const store = new Map<string, string>();
        const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
        const u = new UsageStats(storage);
        for (let i = 0; i < 5; i++) u.record('utils.levels', 'out:gray');
        u.record('utils.blend', 'out:gray');
        u.record('grayscale.noise', 'in:gray');
        const s = u.suggest(['grayscale.noise', 'utils.blend', 'utils.levels'], 'out:gray');
        ok(s[0] === 'utils.levels' && s.includes('utils.blend'), 'context ranking');
        const u2 = new UsageStats(storage);
        ok(u2.suggest(['utils.levels'], 'out:gray')[0] === 'utils.levels', 'persisted');
        ok(new UsageStats({ getItem: () => '{broken', setItem: () => undefined }).suggest(['x']).length === 0, 'corrupt storage tolerated');
      },
    },
    {
      name: 'Graph editor: 500 nodes / ~1000 links — scene build, culling and hit-testing cost',
      run() {
        const reg = getRegistry();
        const g = buildDag(reg, 25, 20);
        const scene = new GraphScene(g);
        const t0 = performance.now();
        scene.invalidate('struct');
        scene.ensure();
        const tBuild = performance.now() - t0;
        const view = { x: 0, y: 0, w: 1600, h: 900 };
        let tSeg = 0;
        let n = 0;
        for (let i = 0; i < 20; i++) {
          const t = performance.now();
          n = scene.visibleSegments({ x: i * 120, y: i * 80, w: view.w, h: view.h }).length;
          tSeg += performance.now() - t;
        }
        const t1 = performance.now();
        for (let i = 0; i < 200; i++) scene.pinAt(i * 25, i * 20, 9);
        const tPin = (performance.now() - t1) / 200;
        const cats = Object.keys(CATEGORIES).length;
        ok(g.nodes.size === 500 && g.links.size >= 900 && cats > 0, `graph size ${g.nodes.size}/${g.links.size}`);
        ok(tBuild < 150 && tSeg / 20 < 40 && tPin < 2, `too slow: build ${tBuild.toFixed(1)}ms, segments ${(tSeg / 20).toFixed(2)}ms, pinAt ${tPin.toFixed(3)}ms`);
        return `${g.nodes.size} nodes, ${g.links.size} links: build ${tBuild.toFixed(1)} ms, visibleSegments ${(tSeg / 20).toFixed(2)} ms (${n} visible), pinAt ${tPin.toFixed(3)} ms`;
      },
    },
  ];
}

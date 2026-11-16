import { describe, expect, it } from 'vitest';
import { GraphScene } from '../src/panels/graph-editor/core/scene';
import { GraphRenderer, type RenderState } from '../src/panels/graph-editor/renderer';
import { buildDag } from '../src/panels/graph-editor/selftest-checks';
import { emptySel } from '../src/panels/graph-editor/ops';
import { makeRegistry } from './helpers';

/** Canvas2D stand-in: records the number of calls so we can test culling/LOD without a browser. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: { n: number; fillText: number } } {
  const calls = { n: 0, fillText: 0 };
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6 });
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      return (...a: unknown[]) => {
        calls.n++;
        if (k === 'fillText') calls.fillText++;
        void a;
      };
    },
    set(t, k: string, v) {
      t[k] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
(globalThis as unknown as { Image: unknown }).Image = class {
  complete = false;
  naturalWidth = 0;
  onload: (() => void) | null = null;
  set src(_v: string) {}
};

const state = (over: Partial<RenderState> = {}): RenderState => ({
  view: { x: 0, y: 0, zoom: 1 }, width: 1600, height: 900, dpr: 1, time: 0,
  selNodes: new Set(), selFrames: new Set(), selNotes: new Set(), selReroutes: new Set(), selLinks: new Set(),
  hoverNode: null, hoverPin: null, hoverButton: null, hoverLink: null, hoverFrame: null, hoverResize: null,
  errors: new Map(), info: new Map(), active: null, thumbs: null, linkDrag: null, marquee: null, cutLine: null, guides: [],
  flow: false, matches: new Set(), editingNode: null, linkStyle: 'bezier', nominal: { w: 256, h: 256, bits: 16 }, showGrid: true, ...over,
});

describe('GraphRenderer (smoke, fake canvas)', () => {
  const reg = makeRegistry();
  const g = buildDag(reg, 25, 20);
  const scene = new GraphScene(g);
  const { ctx, calls } = fakeCtx();
  const r = new GraphRenderer(ctx, scene, () => undefined);

  it('draws only visible nodes and links (culling) at every LOD and link style', () => {
    for (const zoom of [1, 0.6, 0.4, 0.2, 0.06]) for (const linkStyle of ['bezier', 'orthogonal', 'straight'] as const) {
      const o = r.draw(state({ view: { x: -300, y: -200, zoom }, linkStyle }));
      expect(o.drawnNodes).toBeLessThanOrEqual(500);
      if (zoom === 1) expect(o.drawnNodes).toBeLessThan(60);
    }
    const all = r.draw(state({ view: { x: 10, y: 10, zoom: 0.06 } }));
    expect(all.drawnNodes).toBe(500);
  });

  it('text is skipped at far LOD (blocks only) but present when zoomed in', () => {
    calls.fillText = 0;
    r.draw(state({ view: { x: 0, y: 0, zoom: 0.2 } }));
    const far = calls.fillText;
    calls.fillText = 0;
    r.draw(state({ view: { x: 0, y: 0, zoom: 1 } }));
    expect(calls.fillText).toBeGreaterThan(far);
    expect(far).toBe(0);
  });

  it('survives every interaction overlay: selection, hover, errors, link drag, marquee, guides, reroutes, frames, notes', () => {
    const ids = [...g.nodes.keys()];
    const a = g.annotations;
    a.frames.push({ id: 'f1', x: 0, y: 0, w: 500, h: 300, title: 'Frame', color: '#5aa7e0' }, { id: 'f2', x: 600, y: 0, w: 300, h: 200, title: 'C', color: '#e0a23c', collapsed: true, members: [ids[1]] });
    a.notes.push({ id: 's1', x: 50, y: 400, w: 200, h: 100, text: 'Hello world, this is a sticky note with wrapping text', color: '#e0c35a' });
    const l = [...g.links.values()][0];
    a.reroutes.push({ id: 'r1', x: 400, y: 100 });
    a.linkVia[l.id] = ['r1'];
    a.nodeUi[ids[2]] = { collapsed: true, locked: true, color: '#e5534b' };
    a.nodeUi[ids[3]] = { w: 260, showMods: true };
    g.nodes.get(ids[4])!.bypass = true;
    scene.invalidate('struct');
    const pin = scene.pinAt(scene.pinWorld(ids[0], 'output', 'out')!.x, scene.pinWorld(ids[0], 'output', 'out')!.y, 9)!;
    const sel = emptySel();
    sel.nodes.add(ids[0]).add(ids[5]);
    sel.frames.add('f1');
    sel.notes.add('s1');
    sel.reroutes.add('r1');
    sel.links.add(l.id);
    const o = r.draw(state({
      selNodes: sel.nodes, selFrames: sel.frames, selNotes: sel.notes, selReroutes: sel.reroutes, selLinks: sel.links,
      hoverNode: ids[0], hoverPin: { node: ids[0], pin: 'output', side: 'out' }, hoverButton: { node: ids[0], button: 'bypass' }, hoverLink: l.id, hoverFrame: 'f1', hoverResize: ids[0],
      errors: new Map([[ids[0], 'boom']]), info: new Map([[ids[0], { w: 64, h: 64 }]]), active: { nodeId: ids[0] }, flow: true,
      linkDrag: { side: 'out', anchor: pin, pointer: { x: 100, y: 100 }, snap: null, dropNode: ids[1], valid: false, forbidden: new Set([ids[2]]), extra: [{ x: 5, y: 5 }] },
      marquee: { x: 10, y: 10, w: 100, h: 100 }, cutLine: [{ x: 0, y: 0 }, { x: 50, y: 50 }], guides: [{ axis: 'x', pos: 100, from: 0, to: 300 }, { axis: 'y', pos: 50, from: 0, to: 300 }],
      matches: new Set([ids[7]]), editingNode: ids[5],
    }));
    expect(o.drawnNodes).toBeGreaterThan(0);
    scene.hideLinks = new Set([l.id]);
    r.draw(state());
    scene.hideLinks = new Set();
  });

  it('collapsed frames hide their member nodes and attach links to the frame edge', () => {
    scene.invalidate('struct');
    scene.ensure();
    const hidden = g.annotations.frames.find((f) => f.collapsed)!.members![0];
    expect(scene.hidden.has(hidden)).toBe(true);
    expect(scene.grid.rectOf(hidden)).toBeUndefined();
    const p = scene.pinWorld(hidden, 'output', 'out')!;
    expect(p.x).toBe(600 + 300);
  });
});

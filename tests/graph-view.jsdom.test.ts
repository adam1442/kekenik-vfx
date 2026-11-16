// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import { Emitter } from '../src/shared/emitter';
import { SelectionService } from '../src/app/services';
import { GraphView, type GraphHost } from '../src/panels/graph-editor/view';
import { makeRegistry } from './helpers';

// DOM smoke test of the interactive view (opt-in: `npm i --no-save jsdom && KK_JSDOM=1 npx vitest run`).
const noop = (): void => undefined;
const ctxStub = new Proxy({} as Record<string, unknown>, {
  get: (t, k: string) => (k in t ? t[k] : k === 'measureText' ? (s: string) => ({ width: s.length * 6 }) : k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop),
  set: (t, k: string, v) => ((t[k] = v), true),
});
HTMLCanvasElement.prototype.getContext = (() => ctxStub) as never;
HTMLElement.prototype.setPointerCapture = noop;
Element.prototype.scrollIntoView = noop;
HTMLElement.prototype.releasePointerCapture = noop;
(globalThis as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe = noop; disconnect = noop; };
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0)) as never;
(globalThis as unknown as { Image: unknown }).Image = class { complete = false; naturalWidth = 0; set src(_v: string) {} };

describe('GraphView interaction smoke (jsdom)', () => {
  const reg = makeRegistry();
  const g = new Graph(reg, { width: 64, height: 64 });
  const editor = new GraphEditor(g);
  const selection = new SelectionService();
  selection.bind(g);
  const host: GraphHost = { registry: reg, engine: null, editor: () => editor, selection, active: null, onProjectChange: new Emitter<void>() };
  const box = document.createElement('div');
  document.body.append(box);
  const view = new GraphView(host, box);
  const canvas = view.root.querySelector('.k-ge-main') as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: noop }) as DOMRect;
  const ev = (type: string, x: number, y: number, extra: Partial<MouseEventInit> = {}): void => void canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...extra }));
  view.setView({ x: 0, y: 0, zoom: 1 });

  it('creates nodes via ops, drags a node (one undo step), and undoes it', () => {
    const a = view.ops.addNode('grayscale.uniform', { x: 100, y: 100 })!;
    const b = view.ops.addNode('utils.levels', { x: 400, y: 120 })!;
    view.scene.invalidate('struct');
    const na = g.nodes.get(a)!;
    const before = [na.x, na.y];
    const depth = editor.stack.undoLabel;
    ev('pointerdown', na.x + 60, na.y + 12);
    ev('pointermove', na.x + 90, na.y + 40);
    ev('pointermove', na.x + 130, na.y + 52);
    ev('pointerup', na.x + 130, na.y + 52);
    expect(g.nodes.get(a)!.x).not.toBe(before[0]);
    expect(editor.stack.undoLabel).toMatch(/Move/);
    editor.stack.undo();
    expect([g.nodes.get(a)!.x, g.nodes.get(a)!.y]).toEqual(before);
    expect(editor.stack.undoLabel).toBe(depth);
    expect(g.nodes.has(b)).toBe(true);
  });

  it('drags a link from an output pin onto a node body (auto-picks the best input) and cuts it with Alt+click', () => {
    const [a, b] = [...g.nodes.keys()];
    const out = view.scene.pinWorld(a, 'output', 'out')!;
    const nb = g.nodes.get(b)!;
    ev('pointerdown', out.x, out.y);
    ev('pointermove', out.x + 40, out.y + 10);
    ev('pointermove', nb.x + 60, nb.y + 60);
    ev('pointerup', nb.x + 60, nb.y + 60);
    expect(g.links.size).toBe(1);
    const l = [...g.links.values()][0];
    expect(l.from.node).toBe(a);
    const segs = view.scene.visibleSegments({ x: -1000, y: -1000, w: 3000, h: 3000 });
    const mid = { x: (segs[0].a.x + segs[0].b.x) / 2, y: (segs[0].a.y + segs[0].b.y) / 2 };
    ev('pointerdown', mid.x, mid.y, { altKey: true });
    ev('pointerup', mid.x, mid.y);
    expect(g.links.size).toBe(0);
    editor.stack.undo();
    expect(g.links.size).toBe(1);
  });

  it('marquee-selects, deletes, wheel-zooms, opens search and context menu without throwing', () => {
    ev('pointerdown', 5, 5);
    ev('pointermove', 700, 500);
    ev('pointerup', 700, 500);
    expect(view.sel.nodes.size).toBe(2);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 300, clientY: 300, cancelable: true }));
    canvas.dispatchEvent(new MouseEvent('contextmenu', { clientX: 300, clientY: 300, bubbles: true, cancelable: true }));
    view.openSearchAtCursor();
    expect(view.root.querySelector('.k-ge-search')).toBeTruthy();
    view.closePopup();
    view.addFrameForSelection();
    view.duplicateSelection();
    view.autoLayout();
    view.deleteSelection(true);
    expect(g.annotations.frames.length).toBe(1);
    editor.stack.undo();
    view.dispose();
  });
});

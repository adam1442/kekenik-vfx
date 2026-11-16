import { Keymap, eventToChord, normalizeChord } from '../app/keymap';
import {
  addInstance, clampRect, closeInstance, dockFloatBack, dockInstance, dockToRootEdge, emptyLayout, findGroupOf, floatInstance, layoutFromSpec, layoutShape,
  moveTab, normalize, parseLayout, rowSpec, colSpec, tabsSpec, serializeLayout, sizesSumToOne, snapRect, type LayoutState,
} from '../ui/dock/layout';

/**
 * GPU-free UI logic checks. Shared by vitest (tests/ui-logic.test.ts) AND the in-app self-test page, so the user can
 * confirm the same logic inside the real browser. Each check throws on failure and may return a detail string.
 */
export interface LogicCheck {
  name: string;
  run(): string | void;
}

const eq = (a: unknown, b: unknown, msg: string): void => {
  const x = JSON.stringify(a);
  const y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  expected ${y}\n  got      ${x}`);
};
const ok = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(msg);
};
const known = (): boolean => true;

function sample(): LayoutState {
  return layoutFromSpec(rowSpec([colSpec([tabsSpec(['a', 'b'], 0.7), tabsSpec(['c'], 0.3)], 0.4), tabsSpec(['d', 'e', 'f'], 0.6)]), known);
}
const instOf = (l: LayoutState, panelId: string): string => Object.keys(l.instances).find((k) => l.instances[k].panelId === panelId)!;

export const uiLogicChecks: LogicCheck[] = [
  {
    name: 'Layout: spec builder produces normalised tree',
    run() {
      const l = sample();
      eq(layoutShape(l.root, l), { row: [{ col: [['a', 'b'], ['c']], sizes: [0.7, 0.3] }, ['d', 'e', 'f']], sizes: [0.4, 0.6] }, 'shape');
      ok(sizesSumToOne(l.root), 'sizes sum to 1');
    },
  },
  {
    name: 'Layout: serialize -> parse round trip is lossless',
    run() {
      const l = sample();
      floatInstance(l, instOf(l, 'e'), { x: 30, y: 40, w: 300, h: 200 });
      const back = parseLayout(serializeLayout(l), known);
      ok(back, 'parse returned null');
      eq(back, l, 'round trip');
    },
  },
  {
    name: 'Layout: parseLayout rejects garbage and drops unknown panels',
    run() {
      eq(parseLayout('not json', known), null, 'garbage');
      eq(parseLayout({ version: 2 }, known), null, 'wrong version');
      const l = sample();
      const back = parseLayout(serializeLayout(l), (id) => id !== 'a' && id !== 'b');
      ok(back, 'still valid');
      ok(!Object.values(back!.instances).some((i) => i.panelId === 'a' || i.panelId === 'b'), 'unknown dropped');
      eq(layoutShape(back!.root, back!), { row: [['c'], ['d', 'e', 'f']], sizes: [0.4, 0.6] }, 'collapsed');
      eq(parseLayout({ version: 1, root: null, floating: [], instances: {} }, known), null, 'empty layout rejected');
    },
  },
  {
    name: 'Layout: dock to edge splits, centre merges tabs, empty groups collapse',
    run() {
      const l = sample();
      const e = instOf(l, 'e');
      const cGroup = findGroupOf(l, instOf(l, 'c'))!.group.id;
      ok(dockInstance(l, e, cGroup, 'right').ok, 'edge dock');
      eq(layoutShape(l.root, l), { row: [{ col: [['a', 'b'], { row: [['c'], ['e']], sizes: [0.5, 0.5] }], sizes: [0.7, 0.3] }, ['d', 'f']], sizes: [0.4, 0.6] }, 'after edge dock');
      const a = instOf(l, 'a');
      dockInstance(l, instOf(l, 'e'), findGroupOf(l, a)!.group.id, 'center', 1);
      eq(findGroupOf(l, a)!.group.tabs.map((t) => l.instances[t].panelId), ['a', 'e', 'b'], 'centre insert index');
      ok(sizesSumToOne(l.root), 'sizes sum to 1');
    },
  },
  {
    name: 'Layout: edge-dropping the only tab of its own group is a no-op',
    run() {
      const l = sample();
      const c = instOf(l, 'c');
      const g = findGroupOf(l, c)!.group.id;
      eq(dockInstance(l, c, g, 'left').ok, false, 'no-op');
      eq(layoutShape(l.root, l), layoutShape(sample().root, sample()), 'unchanged');
    },
  },
  {
    name: 'Layout: root-edge docking',
    run() {
      const l = sample();
      dockToRootEdge(l, instOf(l, 'c'), 'bottom');
      const shape = layoutShape(l.root, l) as { col: unknown[] };
      ok(Array.isArray(shape.col) && shape.col.length === 2, 'root became a column');
      eq(shape.col[1], ['c'], 'c at the bottom');
      ok(sizesSumToOne(l.root), 'sizes');
    },
  },
  {
    name: 'Layout: float, focus order, dock back, close',
    run() {
      const l = sample();
      const f = instOf(l, 'f');
      const fw = floatInstance(l, f, { x: 10, y: 10, w: 300, h: 200 })!;
      ok(l.floating.length === 1 && fw.group.tabs[0] === f, 'floated');
      const fw2 = floatInstance(l, instOf(l, 'd'), { x: 50, y: 50, w: 300, h: 200 })!;
      ok(fw2.z > fw.z, 'later window on top');
      dockFloatBack(l, fw.id);
      normalize(l);
      ok(l.floating.length === 1, 'one window left');
      ok(findGroupOf(l, f) && !findGroupOf(l, f)!.float, 'f docked again');
      closeInstance(l, f);
      ok(!l.instances[f], 'instance removed');
    },
  },
  {
    name: 'Layout: reorder tabs, closing last tab removes the group',
    run() {
      const l = sample();
      const d = instOf(l, 'd');
      moveTab(l, d, 2);
      eq(findGroupOf(l, d)!.group.tabs.map((t) => l.instances[t].panelId), ['e', 'f', 'd'], 'moved');
      closeInstance(l, instOf(l, 'c'));
      eq(layoutShape(l.root, l), { row: [['a', 'b'], ['e', 'f', 'd']], sizes: [0.4, 0.6] }, 'collapsed after close');
    },
  },
  {
    name: 'Layout: multiple instances of one panel get unique ids',
    run() {
      const l = emptyLayout();
      const a = addInstance(l, 'view2d');
      const b = addInstance(l, 'view2d');
      ok(a !== b && l.instances[a] && l.instances[b], 'unique');
      eq(b, 'view2d#2', 'second id');
    },
  },
  {
    name: 'Layout: floating rect snap + clamp',
    run() {
      eq(snapRect({ x: 5, y: 700, w: 300, h: 100 }, { w: 1000, h: 800 }), { x: 0, y: 700, w: 300, h: 100 }, 'snap left');
      eq(snapRect({ x: 692, y: 3, w: 300, h: 100 }, { w: 1000, h: 800 }), { x: 700, y: 0, w: 300, h: 100 }, 'snap right+top');
      const c = clampRect({ x: 5000, y: -50, w: 100, h: 50 }, { w: 1000, h: 800 });
      ok(c.x <= 1000 - 48 && c.y >= 0 && c.w >= 220 && c.h >= 90, 'clamped');
    },
  },
  {
    name: 'Keymap: chord normalisation and event conversion',
    run() {
      eq(normalizeChord('ctrl+shift+z', false), 'Ctrl+Shift+Z', 'order');
      eq(normalizeChord('Mod+K', false), 'Ctrl+K', 'mod win');
      eq(normalizeChord('Mod+K', true), 'Meta+K', 'mod mac');
      eq(normalizeChord('shift+ctrl+alt+Delete', false), 'Ctrl+Alt+Shift+Delete', 'full');
      eq(normalizeChord('ctrl', false), '', 'modifier only invalid');
      eq(eventToChord({ key: 'z', code: 'KeyZ', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }), 'Ctrl+Shift+Z', 'event');
      eq(eventToChord({ key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), '', 'modifier event');
    },
  },
  {
    name: 'Keymap: conflicts, rebinding, reset, persistence',
    run() {
      const k = new Keymap(false);
      k.setDefault('edit.undo', ['Ctrl+Z']);
      k.setDefault('edit.redo', ['Ctrl+Y', 'Ctrl+Shift+Z']);
      k.setDefault('view.fit', ['F']);
      eq(k.conflicts(), [], 'no conflicts');
      k.setChords('view.fit', ['ctrl+z']);
      eq(k.conflicts(), [{ chord: 'Ctrl+Z', commands: ['edit.undo', 'view.fit'] }], 'conflict detected');
      eq(k.conflictsWith('view.fit', 'Ctrl+Z'), ['edit.undo'], 'conflictsWith');
      const saved = JSON.parse(JSON.stringify(k.toJSON()));
      k.reset('view.fit');
      eq(k.chordsOf('view.fit'), ['F'], 'reset');
      const k2 = new Keymap(false);
      k2.setDefault('edit.undo', ['Ctrl+Z']);
      k2.setDefault('view.fit', ['F']);
      k2.load(saved);
      eq(k2.chordsOf('view.fit'), ['Ctrl+Z'], 'persisted override');
      ok(k2.isCustomized('view.fit') && !k2.isCustomized('edit.undo'), 'customized flags');
    },
  },
];

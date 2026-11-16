/* DOM smoke test of the whole shell (docking, widgets, panels, menus, palette) with a stub engine.
 * Run: npm i --no-save jsdom@26 && KK_JSDOM=1 npx vitest run tests/shell-smoke.jsdom.test.ts */
// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Store } from '../src/shared/emitter';

beforeAll(() => {
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  (document as any).elementsFromPoint = () => [];
  (Element.prototype as any).scrollIntoView = () => {};
  (HTMLCanvasElement.prototype as any).getContext = () => new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  (globalThis as any).requestAnimationFrame = (f: any) => setTimeout(f, 0);
});

describe('smoke', () => {
  it('widgets construct and operate', async () => {
    const { NumberField } = await import('../src/ui/widgets/number-field');
    const { createParamWidget } = await import('../src/ui/widgets/param-widget');
    const { P } = await import('../src/engine/params/schema');
    const defs = [
      P.float('a', 0.5, { min: 0, max: 1, display: 'percent', modulatable: true }), P.int('b', 3, { min: 0, max: 9 }), P.bool('c', true), P.enum('d', 'x', ['x', 'y']),
      P.enum('e', 'x', ['alpha_long', 'beta_long', 'gamma_long', 'delta_long']), P.vec2('f', [1, 2], { linkable: true }), P.vec3('g', [1, 2, 3]), P.color('h', [1, 0, 0, 1], { hdr: true }),
      P.seed('i', 4), P.curve('j', { keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }), P.gradient('k', { stops: [{ pos: 0, color: [0, 0, 0, 1] }, { pos: 1, color: [1, 1, 1, 1] }] }), P.string('l', 'hi'), P.asset('m', 'image'),
    ];
    let last: unknown;
    for (const d of defs) {
      const w = createParamWidget(d, d.default as any, { onInput: (v) => (last = v) });
      document.body.append(w.el);
      w.set(d.default as any); w.setMixed(true); w.setMixed(false); w.setDisabled(false); w.dispose();
    }
    const nf = new NumberField({ min: 0, max: 10, step: 1 }, { onInput: (v) => (last = v) });
    document.body.append(nf.el);
    nf.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    expect(last).toBe(1);
    nf.set(5); expect(nf.get()).toBe(5);
  });

  it('dock manager: open, float, dock, drag, close, serialize', async () => {
    const { registerPanel } = await import('../src/ui/dock/panel-registry');
    const { discoverPanels } = await import('../src/ui/dock/panel-discovery');
    expect(discoverPanels()).toBeGreaterThan(8);
    const { DockManager } = await import('../src/ui/dock/dock-manager');
    const { layoutFromSpec, rowSpec, colSpec, tabsSpec, parseLayout } = await import('../src/ui/dock/layout');
    const created: string[] = [];
    for (const id of ['pa', 'pb', 'pc', 'pd']) registerPanel({ id, title: id, icon: 'cube', multiple: id === 'pd', create(host) { created.push(id); host.textContent = id; return { dispose() {}, serialize: () => ({ x: 1 }) }; } });
    const root = document.createElement('div');
    Object.defineProperty(root, 'clientWidth', { value: 1000 }); Object.defineProperty(root, 'clientHeight', { value: 700 });
    document.body.append(root);
    const dm = new DockManager((p) => ({ ...p, engine: null, editor: null, scheduler: null, app: null } as any), root);
    const known = (id: string) => ['pa', 'pb', 'pc', 'pd'].includes(id);
    dm.setLayout(layoutFromSpec(rowSpec([colSpec([tabsSpec(['pa', 'pb']), tabsSpec(['pc'])]), tabsSpec(['pd'])]), known));
    expect(root.querySelectorAll('.k-pane').length).toBe(3);
    expect(root.querySelectorAll('.k-sash').length).toBe(2);
    expect(created.sort()).toEqual(['pa', 'pc', 'pd']);
    const hostA = root.querySelector('[data-inst="pa"].k-panel-host');
    dm.floatInstance('pa');
    expect(root.querySelectorAll('.k-float').length).toBe(1);
    expect(root.querySelector('[data-inst="pa"].k-panel-host')).toBe(hostA); // same element => GPU canvas state survives
    expect(created.filter((x) => x === 'pa').length).toBe(1);
    const fw = dm.getLayout().floating[0];
    dm.dockBack(fw.id);
    expect(root.querySelectorAll('.k-float').length).toBe(0);
    dm.openPanel('pd'); dm.openPanel('pd', { float: true });
    expect(dm.instancesOf('pd').length).toBe(3);
    dm.focusInstance('pb');
    dm.moveToRootEdge('pc', 'bottom');
    dm.closeInstance('pb');
    const l = dm.getLayout();
    expect(parseLayout(JSON.stringify(l), known)).not.toBeNull();
    expect(l.instances['pa'].state).toEqual({ x: 1 });
    dm.togglePanel('pa'); expect(dm.isOpen('pa')).toBe(false); dm.togglePanel('pa'); expect(dm.isOpen('pa')).toBe(true);
    void Store;
  });

  it('menus, modal, toast, palette fuzzy, tree, gradient editor', async () => {
    const { showMenu, closeAllMenus } = await import('../src/ui/core/menu');
    const { toast, showModal } = await import('../src/ui/core/overlay');
    const { Tree, Collapsible, SearchField, Segmented, ResizableList, Checkbox } = await import('../src/ui/widgets/controls');
    const { GradientEditor } = await import('../src/ui/widgets/gradient');
    const { ColorSwatch } = await import('../src/ui/widgets/color');
    let hit = 0;
    showMenu([{ label: 'A', action: () => hit++ }, { separator: true }, { label: 'B', submenu: [{ label: 'C' }] }], 10, 10);
    (document.querySelector('.k-mi') as HTMLElement).click();
    expect(hit).toBe(1); closeAllMenus();
    toast('hello'); void showModal({ title: 't', body: 'b' });
    const t = new Tree(() => [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B' }] }], {}, { expandAll: true });
    document.body.append(t.el, new Collapsible('g').el, new SearchField().el, new Segmented({ options: [{ value: 'a', label: 'A' }], value: 'a' }).el, new ResizableList({ items: ['x'], render: (s) => s }).el, new Checkbox().el);
    const g = new GradientEditor({ stops: [{ pos: 0, color: [0, 0, 0, 1] }, { pos: 1, color: [1, 1, 1, 1] }] });
    document.body.append(g.el);
    g.set({ stops: [{ pos: 0.2, color: [1, 0, 0, 0.5] }], interp: 'oklab' });
    expect(g.get().interp).toBe('oklab');
    const sw = new ColorSwatch({ value: [1, 0.5, 0.2, 1], hdr: true });
    document.body.append(sw.el); sw.el.click(); expect(document.querySelector('.k-picker')).not.toBeNull(); sw.dispose();
  });
});

describe('full shell with stub engine', () => {
  it('mounts, adds node, edits params with undo, switches workspaces', async () => {
    (globalThis as any).IntersectionObserver = class { observe() {} disconnect() {} unobserve() {} };
    const { Emitter } = await import('../src/shared/emitter');
    const { nodeRegistry } = await import('../src/engine/graph/registry');
    const { discoverNodes } = await import('../src/engine/graph/discover');
    const { Graph } = await import('../src/engine/graph/graph');
    discoverNodes(nodeRegistry);
    const sched = { attach() {}, setTargets() {}, onResult: new Emitter(), beginInteraction() {}, endInteraction() {}, start() {}, interactionScale: 0.5, setTime() {}, frameCache: { stats: () => ({ entries: 0, bytes: 0, maxBytes: 0 }) } };
    const { Playback } = await import('../src/engine/anim/playback');
    const { SubgraphLibrary } = await import('../src/engine/subgraph/library');
    const engine: any = {
      subgraphs: new SubgraphLibrary(nodeRegistry),
      playback: new Playback(sched as any, { now: () => 0, request: () => 0, cancel: () => {} }),
      registry: nodeRegistry, newGraph: (s: any) => new Graph(nodeRegistry, s), scheduler: sched, evaluator: { onTiming: new Emitter() }, onRestored: new Emitter(),
      mm: { stats: () => ({ budgetBytes: 1e9, usedBytes: 1e8, peakBytes: 2e8, textureLiveBytes: 5e7, textureIdleBytes: 5e7, bufferLiveBytes: 0, bufferIdleBytes: 0, textureHits: 3, textureMisses: 1 }), onChange: new Emitter(), setBudget() {}, reclaim() {} },
      gpu: { generation: 1, caps: { adapter: { vendor: 'v', architecture: 'a', description: '' }, defaultBudgetBytes: 1e9, limits: {}, features: [], has: {}, supported: true, diagnostics: [], preferredCanvasFormat: 'bgra8unorm', memoryEstimateBytes: 1e9 } },
    };
    const { createApp } = await import('../src/app/app');
    const { buildMenuBar, buildStatusBar, buildToolbar, registerBuiltinCommands, buildMenus } = await import('../src/app/chrome');
    const { discoverPanels } = await import('../src/ui/dock/panel-discovery');
    const { PRESET_NAMES } = await import('../src/app/workspaces');
    discoverPanels();
    const mk = () => { const d = document.createElement('div'); document.body.append(d); return d; };
    const [mb, tb, dk, sb] = [mk(), mk(), mk(), mk()];
    Object.defineProperty(dk, 'clientWidth', { value: 1400 }); Object.defineProperty(dk, 'clientHeight', { value: 800 });
    const app = createApp(engine, dk);
    registerBuiltinCommands(app);
    app.project.hooks = { collectUi: () => app.workspaces.collectUi(), applyUi: (u) => app.workspaces.applyUi(u) };
    buildMenuBar(app, mb); buildToolbar(app, tb); buildStatusBar(app, sb);
    app.workspaces.restore();
    for (const n of PRESET_NAMES) { app.workspaces.apply(n); expect(dk.querySelectorAll('.k-pane').length).toBeGreaterThan(2); }
    expect(dk.querySelector('.k-panel-error')).not.toBeNull(); // 2D view fails without WebGPU: isolated, shell keeps running
    app.workspaces.apply('Graph');
    // library double-click adds + selects
    const item = [...dk.querySelectorAll('.k-lib-item')].find((e) => e.getAttribute('data-node') === 'grayscale.noise') as HTMLElement;
    expect(item).toBeTruthy();
    item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(app.project.graph.nodes.size).toBe(1);
    const id = app.selection.primary!;
    expect(dk.querySelectorAll('.k-prow').length).toBeGreaterThan(2);
    // edit a param through the widget (typed value) => undoable
    const row = dk.querySelector('.k-prow .k-num') as HTMLElement;
    row.dispatchEvent(new MouseEvent('dblclick'));
    const inp = row.querySelector('input') as HTMLInputElement;
    inp.value = '7'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(app.project.editor.stack.canUndo).toBe(true);
    await app.commands.execute('edit.undo');
    expect(app.project.graph.nodes.has(id)).toBe(true);
    // menus + palette + keymap dialog
    for (const [name, fn] of Object.entries(buildMenus(app))) expect(fn().length, name).toBeGreaterThan(0);
    app.openPalette(); expect(document.querySelector('.k-palette')).not.toBeNull();
    app.openKeymapDialog(); expect(document.querySelectorAll('.k-modal').length).toBe(1);
    expect(app.keymap.conflicts()).toEqual([]);
    // tab switch inside console + gallery builds
    app.dock.openPanel('node-gallery'); // lazy panel (code-split): the chunk loads asynchronously
    await vi.waitFor(() => expect(dk.querySelectorAll('.k-gal-card').length).toBe(nodeRegistry.list().length + 1 /* +1: the "Mesh recipes" card */), { timeout: 5000 });
    app.dock.openPanel('console');
    window.dispatchEvent(new CustomEvent('kk-console-tab', { detail: 'Memory' })); expect(dk.querySelector('.k-bigmeter')).not.toBeNull();
    window.dispatchEvent(new CustomEvent('kk-console-tab', { detail: 'Capabilities' }));
    window.dispatchEvent(new CustomEvent('kk-console-tab', { detail: 'Evaluation' }));
    // project save snapshot includes layout
    expect((app.project.snapshot().ui as any).layout.version).toBe(1);
    // new project resets graph without throwing
    app.project.editor.stack.markSaved();
    await app.project.newProject();
    expect(app.project.graph.nodes.size).toBe(0);
  }, 40_000);
});

import { buildNodeReference, type RefNode } from '../../engine/docs/node-reference';
import { fuzzy } from '../../app/dialogs';
import { t, trNodeDesc } from '../../shared/i18n';
import { versionLabel } from '../../shared/version';
import { h } from '../../ui/core/dom';
import { definePanelView } from '../../ui/dock/panel-lazy';
import { SearchField, TabStrip } from '../../ui/widgets/controls';

/**
 * HELP PANEL: node reference (generated at runtime from the NodeDefinitions: always in sync with the app, same data as
 * docs/NODE_REFERENCE.md), keyboard shortcut list (from the live command registry, reflects user rebinding), quick start.
 */
const QUICK_START: [string, string][] = [
  ['1 · Add nodes', 'Press Space (or right-click) in the Graph Editor and type a node name. Connect pins by dragging; pin colours show the type (gray, color, normal, uv, mesh…).'],
  ['2 · Look at the result', 'Select a node: the 2D Viewport follows the selection. Double-click a node to pin it. Drag a parameter: the preview drops to a lower resolution and refines when you let go.'],
  ['3 · Tile and loop', 'Tiling and size are inherited from the graph (toolbar). Every generator wraps seamlessly when tiling is on. For loops: keep animated values periodic, use whole-number scroll offsets and the noise “evolution” parameter.'],
  ['4 · Animate', 'Right-click a parameter → Add keyframe. The Timeline holds keys; Curve Editor shapes the easing. Set the loop length in the graph settings.'],
  ['5 · Export', 'Add an Export node (Color, Mask, Normal, Multimask, Mesh, Viewport, Warp), pick an engine preset (Unreal / Unity / Godot) in the Export panel and run the job. Large exports are tiled automatically.'],
  ['Trouble?', 'Use Profiler to see which node is slow, Console for shader errors, Settings → Quality to lower the preview resolution or the memory budget. Start with “?safe” in the URL if the GPU misbehaves.'],
];

export const { create } = definePanelView({
  create(host, ctx) {
    const app = ctx.app;
    const nodes: RefNode[] = buildNodeReference(app.engine.registry);
    let tab = (ctx.initialState as { tab?: string } | undefined)?.tab ?? 'Nodes';
    let q = '';
    let sel: string | null = (ctx.initialState as { sel?: string } | undefined)?.sel ?? null;
    const body = h('div', { class: 'k-help-body' });
    const tabs = new TabStrip(['Nodes', 'Shortcuts', 'Quick start'], tab, (x) => ((tab = x), ctx.state.set({ tab, sel }), draw()));
    const search = new SearchField({ placeholder: t('help.search') }, { onInput: (v) => ((q = v), draw()) });
    host.append(h('div', { class: 'k-toolrow' }, tabs.el, h('span', { class: 'k-sp' }), search.el), body);

    function detail(n: RefNode): HTMLElement {
      const pins = (list: RefNode['inputs'], dir: string): HTMLElement[] => list.map((p) => h('div', { class: 'k-help-line' }, h('span', { class: 'k-dim' }, dir), ` ${p.name} `, h('code', {}, p.type), p.optional ? h('span', { class: 'k-dim' }, ' optional') : null, p.tooltip ? h('div', { class: 'k-dim' }, p.tooltip) : null));
      const groups = new Map<string, RefNode['params']>();
      for (const p of n.params) {
        const k = p.tab;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(p);
      }
      return h(
        'div',
        { class: 'k-help-detail' },
        h('h3', {}, n.title),
        h('div', { class: 'k-dim' }, `${n.id} · ${n.categoryLabel}${n.timeDependent ? ' · time dependent' : ''}`),
        h('p', {}, trNodeDesc(n.id, n.description)),
        n.gizmos.length ? h('p', {}, h('b', {}, 'Gizmos: '), n.gizmos.join('; ')) : null,
        h('h4', {}, t('help.pins')),
        ...pins(n.inputs, 'in'),
        ...pins(n.outputs, 'out'),
        h('h4', {}, t('help.params')),
        ...[...groups].flatMap(([tabName, list]) => [
          h('div', { class: 'k-help-tab' }, tabName),
          ...list.map((p) => h('div', { class: 'k-help-line' }, h('b', {}, p.label), ' ', h('code', {}, p.type), ` default ${p.default}`, p.range ? ` · ${p.range}` : '', p.options ? ` · ${p.options.join(' | ')}` : '', p.animatable ? ' · ●anim' : '', p.tooltip ? h('div', { class: 'k-dim' }, p.tooltip) : null)),
        ]),
        h('div', { class: 'k-toolrow' }, h('button', { onclick: () => app.commands.execute('help.palette') }, t('help.addThisNodeCtrlK'))),
      );
    }

    function draw(): void {
      if (tab === 'Quick start') {
        body.replaceChildren(h('div', { class: 'k-panel-scroll k-help-pad' }, h('h3', {}, `Kekenik VFX ${versionLabel()}`), ...QUICK_START.flatMap(([a, b]) => [h('h4', {}, a), h('p', {}, b)])));
        return;
      }
      if (tab === 'Shortcuts') {
        const rows = app.commands
          .list()
          .filter((c) => !c.hidden && app.commands.shortcutOf(c.id) && fuzzy(q, `${c.title} ${c.category}`) > 0)
          .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
        body.replaceChildren(h('div', { class: 'k-panel-scroll k-help-pad' }, ...rows.map((c) => h('div', { class: 'k-help-line' }, h('kbd', {}, app.commands.shortcutOf(c.id)), ` ${c.title} `, h('span', { class: 'k-dim' }, c.category))), rows.length ? null : h('div', { class: 'k-empty' }, t('help.empty')), h('div', { class: 'k-toolrow' }, h('button', { onclick: () => app.openKeymapDialog() }, t('settings.keymap.open')))));
        return;
      }
      const list = nodes.map((n) => ({ n, s: fuzzy(q, `${n.title} ${n.id} ${n.keywords.join(' ')} ${n.categoryLabel}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.n.title.localeCompare(b.n.title)).slice(0, 300);
      const cur = nodes.find((n) => n.id === sel) ?? list[0]?.n ?? null;
      const listEl = h('div', { class: 'k-panel-scroll k-help-list' }, ...list.map(({ n }) => h('div', { class: `k-help-item${cur?.id === n.id ? ' on' : ''}`, onclick: () => ((sel = n.id), ctx.state.set({ tab, sel }), draw()) }, n.title, h('span', { class: 'k-dim' }, ` ${n.categoryLabel}`))), list.length ? null : h('div', { class: 'k-empty' }, t('help.empty')));
      body.replaceChildren(listEl, h('div', { class: 'k-panel-scroll k-help-pane' }, cur ? detail(cur) : null));
    }
    // follow the selected graph node
    const unsub = app.selection.onChange.on(() => {
      const id = app.selection.primary;
      const n = id ? app.project.graph.nodes.get(id) : null;
      if (n && tab === 'Nodes' && nodes.some((x) => x.id === n.type) && ctx.visible.get()) {
        sel = n.type;
        draw();
      }
    });
    draw();
    return {
      serialize: () => ({ tab, sel }),
      dispose: () => unsub(),
    };
  },
});

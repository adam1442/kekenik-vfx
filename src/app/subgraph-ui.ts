import { PIN_COLORS } from '../engine/graph/pins';
import { boundaryPins, isBoundary, type ExposedParam } from '../engine/subgraph/def';
import { promoteParam, setExposedCommand } from '../engine/subgraph/make';
import { h } from '../ui/core/dom';
import { promptDialog, showModal, toast } from '../ui/core/overlay';
import type { AppServices } from './app';

import { t as tt } from '../shared/i18n';
/**
 * Subgraph interface editor: rename / reorder the pins (the boundary nodes' params), and promote, group,
 * rename, re-range and describe exposed parameters. Pin edits go through the inner editor (undoable); the exposed list is
 * one undoable Command on the same stack. Everything applies to the SHARED definition immediately (all instances follow).
 */
export function openInterfaceEditor(app: AppServices): void {
  const pj = app.project;
  const defId = pj.activeDefId;
  if (!defId) return void toast(tt('subgraphUi.openASubgraphFirst'), { type: 'info' });
  const lib = app.engine.subgraphs;
  const body = h('div', { class: 'k-sgi', style: { minWidth: '46.667rem', maxHeight: '70vh', overflow: 'auto' } });
  const apply = (next: ExposedParam[], label?: string): void => {
    pj.editor.stack.execute(setExposedCommand(lib, defId, next, label));
    render();
  };
  const inp = (value: string, on: (v: string) => void, w = '11.667rem', ph = ''): HTMLInputElement => {
    const i = h('input', { type: 'text', value, placeholder: ph, style: { width: w } }) as HTMLInputElement;
    i.addEventListener('change', () => on(i.value));
    i.addEventListener('keydown', (e) => e.stopPropagation());
    return i;
  };
  const num = (value: number | undefined, on: (v: number | undefined) => void): HTMLInputElement => {
    const i = h('input', { type: 'number', value: value ?? '', step: 'any', style: { width: '5.333rem' } }) as HTMLInputElement;
    i.addEventListener('change', () => on(i.value === '' ? undefined : Number(i.value)));
    i.addEventListener('keydown', (e) => e.stopPropagation());
    return i;
  };
  const btn = (t: string, on: () => void, tip?: string): HTMLElement => h('button', { class: 'k-btn sm', tip, onclick: on }, t);

  function render(): void {
    const def = lib.get(defId!);
    if (!def) return;
    const g = pj.graph;
    const ed = pj.editor;
    const { inputs, outputs } = boundaryPins([...g.nodes.values()]);
    const sec = (t: string): HTMLElement => h('div', { style: { margin: '1rem 0 0.333rem', fontWeight: '600', color: 'var(--accent)' } }, t);
    const swap = (pins: typeof inputs, i: number, d: number): void => {
      const j = i + d;
      if (j < 0 || j >= pins.length) return;
      ed.stack.transaction('Reorder subgraph pins', () => pins.forEach((p, k) => ed.setParam(p.id, 'order', k === i ? j : k === j ? i : k)));
      render();
    };
    const pinRows = (pins: typeof inputs): HTMLElement[] =>
      pins.length
        ? pins.map((p, i) => h('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.167rem 0' } }, h('span', { style: { width: '0.75rem', height: '0.75rem', borderRadius: '50%', background: PIN_COLORS[p.type] } }), inp(p.name, (v) => ed.setParam(p.id, 'name', v.trim() || p.name), '200px'), h('span', { class: 'k-dim' }, p.type), btn('↑', () => swap(pins, i, -1)), btn('↓', () => swap(pins, i, 1))))
        : [h('div', { class: 'k-dim' }, tt('subgraphUi.noneAddInput'))];
    const nodeName = (id: string): string => g.nodes.get(id)?.name ?? '(missing)';
    const rows = def.exposed.map((e, i) => {
      const base = g.registry.expanded(g.nodes.get(e.node)?.type ?? '')?.params.find((p) => p.id === e.param);
      const numeric = base?.type === 'float' || base?.type === 'int';
      const set = (patch: Partial<ExposedParam>): void => apply(def.exposed.map((x, k) => (k === i ? { ...x, ...patch } : x)), 'Edit exposed parameter');
      return h(
        'div',
        { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.25rem 0', flexWrap: 'wrap' } },
        h('span', { class: 'k-dim', style: { width: '10rem', overflow: 'hidden', textOverflow: 'ellipsis' }, tip: `${nodeName(e.node)} › ${e.param}` }, `${nodeName(e.node)} › ${e.param}`),
        inp(e.label, (v) => set({ label: v }), '9.167rem', 'Label'),
        inp(e.group, (v) => set({ group: v }), '7.5rem', 'Group'),
        numeric ? num(e.min, (v) => set({ min: v })) : h('span'),
        numeric ? num(e.max, (v) => set({ max: v })) : h('span'),
        inp(e.tooltip ?? '', (v) => set({ tooltip: v || undefined }), '12.5rem', 'Tooltip'),
        btn('↑', () => i > 0 && apply(swapArr(def.exposed, i, i - 1), 'Reorder exposed parameters')),
        btn('↓', () => i < def.exposed.length - 1 && apply(swapArr(def.exposed, i, i + 1), 'Reorder exposed parameters')),
        btn('✕', () => apply(def.exposed.filter((_, k) => k !== i), 'Remove exposed parameter')),
      );
    });
    const inner = [...g.nodes.values()].filter((n) => !isBoundary(n.type));
    const nodeSel = h('select', { style: { maxWidth: '14.167rem' } }, ...inner.map((n) => h('option', { value: n.id }, n.name))) as HTMLSelectElement;
    const paramSel = h('select', { style: { maxWidth: '15.833rem' } }) as HTMLSelectElement;
    const fill = (): void => {
      const n = g.nodes.get(nodeSel.value);
      const ps = (n && g.registry.expanded(n.type)?.params.filter((p) => !p.id.startsWith('tex_') && !p.id.startsWith('blend_') && !p.id.endsWith('_mod_k') && p.type !== 'spline' && p.type !== 'asset')) ?? [];
      paramSel.replaceChildren(...ps.map((p) => h('option', { value: p.id }, `${p.label} (${p.type})`)));
    };
    nodeSel.addEventListener('change', fill);
    fill();
    body.replaceChildren(
      h('div', { class: 'k-dim' }, tt('subgraphUi.subgraph', { name: def.name, version: def.version })),
      sec('Name'),
      inp(def.name, (v) => v.trim() && lib.update(defId!, { name: v.trim() }), '21.667rem'),
      sec('Inputs'),
      ...pinRows(inputs),
      sec('Outputs'),
      ...pinRows(outputs),
      sec('Exposed parameters  (label · group · min · max · tooltip)'),
      ...(rows.length ? rows : [h('div', { class: 'k-dim' }, tt('subgraphUi.noParametersExposedYet'))]),
      h('div', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.667rem' } }, h('span', { class: 'k-dim' }, 'Expose'), nodeSel, paramSel, btn('Add', () => {
        if (!nodeSel.value || !paramSel.value) return;
        const r = promoteParam(lib, defId!, nodeSel.value, paramSel.value);
        if (typeof r === 'string') return void toast(r, { type: 'warn' });
        apply(r, 'Expose parameter');
      })),
    );
  }
  render();
  void showModal({ title: tt('subgraphUi.subgraphInterface'), body, width: '60rem', buttons: [{ label: 'Close', value: 'ok', primary: true }] });
}

const swapArr = <T,>(a: T[], i: number, j: number): T[] => {
  const b = [...a];
  [b[i], b[j]] = [b[j], b[i]];
  return b;
};

/** Properties-panel context menu entry: promote one inner parameter (asks for a label). */
export async function exposeParamFlow(app: AppServices, arg: { node: string; param: string }): Promise<void> {
  const defId = app.project.activeDefId;
  if (!defId || !arg) return;
  const lib = app.engine.subgraphs;
  const n = app.project.graph.nodes.get(arg.node);
  const base = n && app.project.graph.registry.expanded(n.type)?.params.find((p) => p.id === arg.param);
  const label = await promptDialog(tt('subgraphUi.exposeParameter'), tt('subgraphUi.labelShownOnThe'), base?.label ?? arg.param);
  if (!label) return;
  const r = promoteParam(lib, defId, arg.node, arg.param, { label, group: n?.name });
  if (typeof r === 'string') return void toast(r, { type: 'warn' });
  app.project.editor.stack.execute(setExposedCommand(lib, defId, r, 'Expose parameter'));
  toast(tt('subgraphUi.isNow', { label }), { type: 'ok' });
}

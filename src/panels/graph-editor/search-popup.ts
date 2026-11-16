import { CATEGORIES } from '../../engine/graph/categories';
import type { NodeDefinition } from '../../engine/graph/node';
import { PIN_COLORS } from '../../engine/graph/pins';
import type { NodeRegistry } from '../../engine/graph/registry';
import type { PinType } from '../../engine/types';
import { trNodeDesc, trNodeLabel, trTerm, t } from '../../shared/i18n';
import { h } from '../../ui/core/dom';
import { icon } from '../../ui/icons';
import { compatibleDefs } from './core/validity';
import type { UsageStats } from './core/usage';
import type { SearchExtra } from './extensions';

/**
 * Node search popup (Tab / double-click / dragging a link off a pin and releasing on empty space).
 * With a `filter` only nodes that can connect to the dragged pin are listed, and the "Suggested" section is ranked by the
 * user's persisted usage in that context.
 */
export interface SearchFilter {
  /** Side of the pin the user holds ('out' = dragging from an output). */
  dragSide: 'out' | 'in';
  type: PinType;
}
export interface SearchOptions {
  registry: NodeRegistry;
  usage: UsageStats;
  filter?: SearchFilter;
  /** Screen position (px, relative to `container`). */
  x: number;
  y: number;
  onPick(def: NodeDefinition): void;
  /** presets / library subgraphs listed after the node results. */
  extras?: (query: string) => SearchExtra[];
  onExtra?(x: SearchExtra): void;
  onClose(): void;
}

export const usageContext = (f?: SearchFilter): string => (f ? `${f.dragSide}:${f.type}` : 'any');

export function openNodeSearch(container: HTMLElement, o: SearchOptions): { close(): void } {
  const ctxKey = usageContext(o.filter);
  const all = o.filter ? compatibleDefs(o.registry, o.filter.dragSide, o.filter.type) : o.registry.list();
  const allowed = new Set(all.map((d) => d.id));
  const input = h('input', { class: 'k-ge-search-input', type: 'text', placeholder: o.filter ? 'Search compatible nodes…' : 'Search nodes…', spellcheck: 'false', 'aria-label': 'Search nodes' });
  const list = h('div', { class: 'k-ge-search-list', role: 'listbox' });
  const chip = o.filter
    ? h('div', { class: 'k-ge-search-chip' }, h('span', { class: 'dot', style: { background: PIN_COLORS[o.filter.type] } }), o.filter.dragSide === 'out' ? `Accepts ${o.filter.type}` : `Produces ${o.filter.type}`)
    : null;
  const root = h('div', { class: 'k-ge-search', role: 'dialog', 'aria-label': 'Add node' }, h('div', { class: 'k-ge-search-head' }, icon('search', 13), input, chip), list, h('div', { class: 'k-ge-search-foot' }, t('searchPopup.navigateEnter')));
  container.append(root);
  const cw = container.clientWidth,
    ch = container.clientHeight;
  root.style.left = `${Math.max(6, Math.min(o.x, cw - 330))}px`;
  root.style.top = `${Math.max(6, Math.min(o.y, ch - 380))}px`;

  let rows: { def?: NodeDefinition; extra?: SearchExtra; el: HTMLElement }[] = [];
  let hot = 0;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener('pointerdown', outside, true);
    o.onClose();
  };
  const outside = (e: Event): void => {
    if (!root.contains(e.target as Node)) close();
  };
  const setHot = (i: number): void => {
    if (!rows.length) return;
    hot = (i + rows.length) % rows.length;
    rows.forEach((r, k) => r.el.classList.toggle('hot', k === hot));
    rows[hot].el.scrollIntoView({ block: 'nearest' });
  };
  const pick = (def: NodeDefinition): void => {
    closed = true;
    root.remove();
    document.removeEventListener('pointerdown', outside, true);
    o.onPick(def);
    o.onClose();
  };
  const row = (def: NodeDefinition, q: string): HTMLElement => {
    const cat = CATEGORIES[def.category];
    const el = h(
      'div',
      { class: 'k-ge-search-row', role: 'option', tip: trNodeDesc(def.id, def.description) },
      h('span', { class: 'ico', style: { color: cat.color } }, icon(def.icon ?? 'cube', 14)),
      h('span', { class: 'title' }, q ? highlight(def.title, q) : trNodeLabel(def.id, def.title)),
      h('span', { class: 'cat', style: { color: cat.color } }, trTerm(cat.label)),
    );
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', () => pick(def));
    return el;
  };
  const pickExtra = (x: SearchExtra): void => {
    closed = true;
    root.remove();
    document.removeEventListener('pointerdown', outside, true);
    o.onExtra?.(x);
    o.onClose();
  };
  const extraRow = (x: SearchExtra): HTMLElement => {
    const el = h('div', { class: 'k-ge-search-row', role: 'option', tip: x.subtitle }, h('span', { class: 'ico', style: { color: x.color ?? 'var(--accent)' } }, icon(x.icon ?? 'star', 14)), h('span', { class: 'title' }, x.title), h('span', { class: 'cat', style: { color: x.color ?? 'var(--accent)' } }, x.subtitle));
    el.addEventListener('pointerdown', (e) => e.preventDefault());
    el.addEventListener('click', () => pickExtra(x));
    return el;
  };
  const section = (title: string): HTMLElement => h('div', { class: 'k-ge-search-sec' }, title);
  const render = (): void => {
    const q = input.value.trim();
    rows = [];
    const parts: HTMLElement[] = [];
    const add = (defs: NodeDefinition[]): void => {
      for (const d of defs) {
        const el = row(d, q);
        rows.push({ def: d, el });
        parts.push(el);
      }
    };
    if (!q) {
      const sug = o.usage.suggest([...allowed], ctxKey, 6).map((id) => o.registry.get(id)!).filter(Boolean);
      if (sug.length) {
        parts.push(section(o.filter ? 'Suggested for this pin' : 'Suggested'));
        add(sug);
      }
      const sugIds = new Set(sug.map((d) => d.id));
      for (const c of Object.values(CATEGORIES).sort((a, b) => a.order - b.order)) {
        const defs = all.filter((d) => d.category === c.id && !sugIds.has(d.id));
        if (!defs.length) continue;
        parts.push(section(c.label));
        add(defs);
      }
    } else {
      const found = o.registry.search(q).filter((d) => allowed.has(d.id));
      // stable boost: previously used nodes win ties
      found.sort((a, b) => 0 * a.id.length + (o.usage.score(b.id, ctxKey) > 0 ? 1 : 0) - (o.usage.score(a.id, ctxKey) > 0 ? 1 : 0));
      add(found);
    }
    const ex = o.extras?.(q) ?? [];
    if (ex.length) {
      parts.push(section(q ? 'Presets & library' : 'Favorite presets'));
      for (const x of ex.slice(0, q ? 14 : 8)) {
        const el = extraRow(x);
        rows.push({ extra: x, el });
        parts.push(el);
      }
    }
    if (!rows.length) parts.push(h('div', { class: 'k-ge-search-empty' }, q ? `No ${o.filter ? 'compatible ' : ''}nodes match “${q}”.` : 'No compatible nodes.'));
    list.replaceChildren(...parts);
    hot = 0;
    setHot(0);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      setHot(hot + 1);
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      setHot(hot - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = rows[hot];
      if (r?.def) pick(r.def);
      else if (r?.extra) pickExtra(r.extra);
    }
  });
  document.addEventListener('pointerdown', outside, true);
  render();
  requestAnimationFrame(() => input.focus());
  return { close };
}

function highlight(text: string, q: string): Node {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return document.createTextNode(text);
  const f = document.createDocumentFragment();
  f.append(text.slice(0, i), h('b', {}, text.slice(i, i + q.length)), text.slice(i + q.length));
  return f;
}

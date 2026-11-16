import { clamp } from '../../shared/util';
import { dragPointer, h, type Child } from '../core/dom';
import { menuBelow, type MenuItem } from '../core/menu';
import { icon } from '../icons';
import type { Widget, WidgetCallbacks } from './types';

import { t as tt } from '../../shared/i18n';
/** Icon button: `iconButton('undo', 'Undo', fn)`. */
export function iconButton(name: string, tip: string, onClick: (e: MouseEvent) => void, opts: { size?: number; active?: boolean; cls?: string; key?: string } = {}): HTMLButtonElement {
  const b = h('button', { class: `k-ibtn ${opts.cls ?? ''}${opts.active ? ' active' : ''}`, tip, 'aria-label': tip, onclick: onClick as (e: Event) => void }, icon(name, opts.size ?? 14));
  if (opts.key) b.setAttribute('data-tip-key', opts.key);
  return b;
}

/* ------------------------------------------------------------------------------ checkbox */
export class Checkbox implements Widget<boolean> {
  readonly el: HTMLElement;
  private v: boolean;
  constructor(opts: { value?: boolean; label?: string; tip?: string } = {}, private cb: WidgetCallbacks<boolean> = {}) {
    this.v = !!opts.value;
    this.el = h('div', { class: 'k-check', role: 'checkbox', tabindex: 0, tip: opts.tip }, h('span', { class: 'box' }, icon('check', 11)), opts.label ? h('span', {}, opts.label) : null);
    this.el.addEventListener('click', () => this.toggle());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.toggle();
      }
    });
    this.render();
  }
  private toggle(): void {
    this.v = !this.v;
    this.render();
    this.cb.onInput?.(this.v);
  }
  private render(): void {
    this.el.classList.toggle('on', this.v);
    this.el.classList.remove('mixed');
    this.el.setAttribute('aria-checked', String(this.v));
  }
  get(): boolean {
    return this.v;
  }
  set(v: boolean): void {
    this.v = v;
    this.render();
  }
  setMixed(m: boolean): void {
    this.el.classList.toggle('mixed', m);
  }
  setDisabled(d: boolean): void {
    this.el.setAttribute('aria-disabled', String(d));
  }
  dispose(): void {}
}

/* ------------------------------------------------------------------------------ segmented control */
export class Segmented<T extends string> implements Widget<T> {
  readonly el: HTMLElement;
  private v: T;
  private btns = new Map<T, HTMLButtonElement>();
  constructor(opts: { options: { value: T; label?: string; icon?: string; tip?: string }[]; value: T }, private cb: WidgetCallbacks<T> = {}) {
    this.v = opts.value;
    this.el = h('div', { class: 'k-seg', role: 'radiogroup' });
    for (const o of opts.options) {
      const b = h('button', { tip: o.tip, role: 'radio', onclick: () => this.pick(o.value) }, o.icon ? icon(o.icon, 13) : null, o.label ?? null);
      this.btns.set(o.value, b);
      this.el.append(b);
    }
    this.render();
  }
  private pick(v: T): void {
    if (v === this.v) return;
    this.v = v;
    this.render();
    this.cb.onInput?.(v);
  }
  private render(): void {
    for (const [k, b] of this.btns) {
      b.classList.toggle('on', k === this.v);
      b.setAttribute('aria-checked', String(k === this.v));
    }
  }
  get(): T {
    return this.v;
  }
  set(v: T): void {
    this.v = v;
    this.render();
  }
  dispose(): void {}
}

/* ------------------------------------------------------------------------------ dropdown (enum) */
export interface DropdownOption {
  value: string;
  label: string;
  tooltip?: string;
  icon?: string;
}
export class Dropdown implements Widget<string> {
  readonly el: HTMLButtonElement;
  private lbl: HTMLElement;
  private v: string;
  private mixed = false;
  constructor(private opts: { options: DropdownOption[]; value: string; tip?: string }, private cb: WidgetCallbacks<string> = {}) {
    this.v = opts.value;
    this.lbl = h('span', { class: 'lbl' });
    this.el = h('button', { class: 'k-drop', tip: opts.tip, 'aria-haspopup': 'listbox' }, this.lbl, h('span', { class: 'car' }, icon('chevron-down', 10)));
    this.el.addEventListener('click', () => this.open());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const i = this.opts.options.findIndex((o) => o.value === this.v);
        const n = this.opts.options[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, this.opts.options.length - 1)];
        if (n && n.value !== this.v) this.pick(n.value);
        e.preventDefault();
      }
    });
    this.render();
  }
  setOptions(options: DropdownOption[]): void {
    this.opts.options = options;
    this.render();
  }
  private open(): void {
    this.el.classList.add('open');
    const items: MenuItem[] = this.opts.options.map((o) => ({ label: o.label, icon: o.icon, checked: !this.mixed && o.value === this.v, action: () => this.pick(o.value) }));
    menuBelow(this.el, items, { onClose: () => this.el.classList.remove('open') });
  }
  private pick(v: string): void {
    this.mixed = false;
    if (v === this.v) return this.render();
    this.v = v;
    this.render();
    this.cb.onInput?.(v);
  }
  private render(): void {
    this.lbl.textContent = this.mixed ? '—' : (this.opts.options.find((o) => o.value === this.v)?.label ?? this.v);
  }
  get(): string {
    return this.v;
  }
  set(v: string): void {
    this.v = v;
    this.mixed = false;
    this.render();
  }
  setMixed(m: boolean): void {
    this.mixed = m;
    this.render();
  }
  setDisabled(d: boolean): void {
    this.el.disabled = d;
  }
  dispose(): void {}
}

/* ------------------------------------------------------------------------------ search field */
export class SearchField implements Widget<string> {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  constructor(opts: { placeholder?: string; value?: string } = {}, private cb: { onInput?(v: string): void; onEnter?(v: string): void; onKey?(e: KeyboardEvent): void } = {}) {
    this.input = h('input', { type: 'search', placeholder: opts.placeholder ?? 'Search…', value: opts.value ?? '', spellcheck: 'false', 'aria-label': opts.placeholder ?? 'Search' });
    const x = h('button', { class: 'k-ibtn sm x', tip: 'Clear', style: { display: opts.value ? '' : 'none' }, onclick: () => this.setAndFire('') }, icon('close', 9));
    this.el = h('div', { class: 'k-search' }, h('span', { class: 'ic' }, icon('search', 12)), this.input, x);
    this.input.addEventListener('input', () => {
      x.style.display = this.input.value ? '' : 'none';
      this.cb.onInput?.(this.input.value);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.input.value) {
        this.setAndFire('');
        e.stopPropagation();
      }
      if (e.key === 'Enter') this.cb.onEnter?.(this.input.value);
      this.cb.onKey?.(e);
    });
  }
  private setAndFire(v: string): void {
    this.input.value = v;
    this.input.dispatchEvent(new Event('input'));
    this.input.focus();
  }
  get(): string {
    return this.input.value;
  }
  set(v: string): void {
    this.input.value = v;
  }
  focus(): void {
    this.input.focus();
  }
  dispose(): void {}
}

/* ------------------------------------------------------------------------------ collapsible group */
export class Collapsible {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  constructor(title: string, opts: { open?: boolean; onToggle?: (open: boolean) => void; right?: Child } = {}) {
    this.body = h('div', { class: 'k-group-body' });
    const hd = h('div', { class: 'k-group-hd', role: 'button', tabindex: 0, 'aria-expanded': String(opts.open !== false) }, h('span', { class: 'car' }, icon('chevron-down', 10)), h('span', {}, title), h('span', { class: 'k-sp' }), opts.right ?? null);
    this.el = h('div', { class: `k-group${opts.open === false ? ' k-collapsed' : ''}` }, hd, this.body);
    const toggle = (): void => {
      const c = this.el.classList.toggle('k-collapsed');
      hd.setAttribute('aria-expanded', String(!c));
      opts.onToggle?.(!c);
    };
    hd.addEventListener('click', toggle);
    hd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }
  get open(): boolean {
    return !this.el.classList.contains('k-collapsed');
  }
  set open(v: boolean) {
    this.el.classList.toggle('k-collapsed', !v);
  }
}

/* ------------------------------------------------------------------------------ tabs widget */
export class TabStrip {
  readonly el: HTMLElement;
  private btns = new Map<string, HTMLButtonElement>();
  constructor(tabs: string[], private active: string, private onChange: (tab: string) => void, label: (tab: string) => string = (x) => x) {
    this.el = h('div', { class: 'k-tabs', role: 'tablist' });
    for (const t of tabs) {
      const b = h('button', { role: 'tab', onclick: () => this.select(t, true) }, label(t));
      this.btns.set(t, b);
      this.el.append(b);
    }
    this.render();
  }
  select(t: string, fire = false): void {
    if (!this.btns.has(t)) return;
    this.active = t;
    this.render();
    if (fire) this.onChange(t);
  }
  private render(): void {
    for (const [k, b] of this.btns) {
      b.classList.toggle('on', k === this.active);
      b.setAttribute('aria-selected', String(k === this.active));
    }
  }
}

/* ------------------------------------------------------------------------------ tree */
export interface TreeNode {
  id: string;
  label: string;
  icon?: string;
  color?: string;
  children?: TreeNode[];
  data?: unknown;
}
export class Tree {
  readonly el: HTMLElement;
  private expanded = new Set<string>();
  private selected: string | null = null;
  constructor(
    private roots: () => TreeNode[],
    private cb: { onSelect?(n: TreeNode): void; onActivate?(n: TreeNode): void; onContext?(n: TreeNode, e: MouseEvent): void; render?(n: TreeNode, row: HTMLElement): void; draggable?(n: TreeNode): string | null } = {},
    opts: { expandAll?: boolean } = {},
  ) {
    this.el = h('div', { class: 'k-tree', role: 'tree', tabindex: 0 });
    if (opts.expandAll) this.walk(this.roots(), (n) => n.children && this.expanded.add(n.id));
    this.el.addEventListener('keydown', (e) => this.key(e));
    this.refresh();
  }
  private walk(ns: TreeNode[], fn: (n: TreeNode) => void): void {
    for (const n of ns) {
      fn(n);
      if (n.children) this.walk(n.children, fn);
    }
  }
  private visible(): { n: TreeNode; depth: number }[] {
    const out: { n: TreeNode; depth: number }[] = [];
    const rec = (ns: TreeNode[], d: number): void => {
      for (const n of ns) {
        out.push({ n, depth: d });
        if (n.children && this.expanded.has(n.id)) rec(n.children, d + 1);
      }
    };
    rec(this.roots(), 0);
    return out;
  }
  setExpanded(id: string, open: boolean): void {
    if (open) this.expanded.add(id);
    else this.expanded.delete(id);
    this.refresh();
  }
  select(id: string | null): void {
    this.selected = id;
    this.refresh();
  }
  refresh(): void {
    const rows = this.visible().map(({ n, depth }) => {
      const has = !!n.children?.length;
      const car = h('span', { class: `car${this.expanded.has(n.id) ? ' open' : ''}` }, has ? icon('chevron-right', 9) : null);
      const row = h('div', { class: `k-tree-row${this.selected === n.id ? ' sel' : ''}`, role: 'treeitem', style: { paddingInlineStart: `${0.4 + depth * 0.9}rem` } }, car, n.icon ? h('span', { style: n.color ? { color: n.color, display: 'flex' } : { display: 'flex' } }, icon(n.icon, 13)) : null, h('span', {}, n.label));
      this.cb.render?.(n, row);
      row.addEventListener('click', () => {
        if (has) this.setExpanded(n.id, !this.expanded.has(n.id));
        this.selected = n.id;
        this.cb.onSelect?.(n);
        this.refresh();
      });
      row.addEventListener('dblclick', () => this.cb.onActivate?.(n));
      row.addEventListener('contextmenu', (e) => this.cb.onContext?.(n, e));
      const dnd = this.cb.draggable?.(n);
      if (dnd) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          e.dataTransfer?.setData(dnd, n.id);
          e.dataTransfer?.setData('text/plain', n.label);
        });
      }
      return row;
    });
    this.el.replaceChildren(...rows);
  }
  private key(e: KeyboardEvent): void {
    const vis = this.visible();
    const i = vis.findIndex((v) => v.n.id === this.selected);
    const cur = vis[i]?.n;
    if (e.key === 'ArrowDown') this.selected = vis[Math.min(vis.length - 1, i + 1)]?.n.id ?? null;
    else if (e.key === 'ArrowUp') this.selected = vis[Math.max(0, i - 1)]?.n.id ?? null;
    else if (e.key === 'ArrowRight' && cur?.children) this.expanded.add(cur.id);
    else if (e.key === 'ArrowLeft' && cur?.children) this.expanded.delete(cur.id);
    else if (e.key === 'Enter' && cur) this.cb.onActivate?.(cur);
    else return;
    e.preventDefault();
    this.refresh();
    if (this.selected) {
      const n = this.visible().find((v) => v.n.id === this.selected)?.n;
      if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) this.cb.onSelect?.(n);
    }
  }
}

/* ------------------------------------------------------------------------------ resizable list */
export class ResizableList<T> {
  readonly el: HTMLElement;
  private items: HTMLElement;
  private sel = -1;
  constructor(private o: { items: T[]; render: (item: T) => Child; height?: number; onSelect?: (item: T, i: number) => void; onActivate?: (item: T, i: number) => void }) {
    this.items = h('div', { class: 'items', role: 'listbox' });
    const grip = h('div', { class: 'grip', tip: tt('controls.dragToResize') });
    this.el = h('div', { class: 'k-rlist', style: { height: `${(o.height ?? 140) / 12}rem` } }, this.items, grip);
    grip.addEventListener('pointerdown', (e) => {
      const h0 = this.el.getBoundingClientRect().height;
      dragPointer(e, (_dx, dy) => (this.el.style.height = `${Math.max(48, h0 + dy)}px`));
    });
    this.refresh();
  }
  setItems(items: T[]): void {
    this.o.items = items;
    this.refresh();
  }
  private refresh(): void {
    this.items.replaceChildren(
      ...this.o.items.map((it, i) => {
        const row = h('div', { class: `item${i === this.sel ? ' sel' : ''}`, role: 'option' }, this.o.render(it));
        row.addEventListener('click', () => {
          this.sel = i;
          this.refresh();
          this.o.onSelect?.(it, i);
        });
        row.addEventListener('dblclick', () => this.o.onActivate?.(it, i));
        return row;
      }),
    );
  }
}

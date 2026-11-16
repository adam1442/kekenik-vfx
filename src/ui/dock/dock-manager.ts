import { allowPanel, isPanelBlocked } from '../../app/safe-mode';
import { t, t as tt } from '../../shared/i18n';
import { guardInstance, showCrashOverlay } from './panel-guard';
import { Emitter, Store } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import { dragPointer, h, observeSize } from '../core/dom';
import { contextMenu, menuBelow, type MenuItem } from '../core/menu';
import { icon } from '../icons';
import {
  activate, addInstance, allGroups, clampRect, cloneLayout, closeInstance, dockFloatBack, dockInstance, dockToRootEdge, emptyLayout, findGroup, findGroupOf,
  floatInstance, focusFloat, moveTab, nextInstanceId, normalize, setSplitSizes, snapRect, type DockNode, type DropZone, type FloatWindow, type LayoutState, type Rect, type TabsNode,
} from './layout';
import { getPanel, isSingleton, type PanelContext, type PanelDefinition, type PanelInstance } from './panel-registry';

interface Live {
  instId: string;
  def: PanelDefinition;
  host: HTMLElement;
  api: PanelInstance | null;
  ctx: PanelContext;
  title: Store<string>;
  visible: Store<boolean>;
  state: Store<unknown>;
  tabLabel?: HTMLElement;
  unsubs: Array<() => void>;
}

export type ContextFactory = (parts: { instanceId: string; panelId: string; state: Store<unknown>; title: Store<string>; visible: Store<boolean>; initialState: unknown }) => PanelContext;

type DropTarget =
  | { kind: 'group'; groupId: string; zone: DropZone; index?: number; rect: Rect }
  | { kind: 'root'; zone: Exclude<DropZone, 'center'>; rect: Rect };

const MIN_CELL_PX = 80;

/**
 * DockManager: renders a LayoutState (see layout.ts) into split panes, tab groups and floating windows; implements
 * sashes, tab drag & drop with a live drop preview, window drag/resize/min/max/snap/z-order, keyboard access, and keeps
 * panel hosts ALIVE across layout changes (hosts are re-parented, never re-created: GPU canvases keep their state).
 */
export class DockManager {
  readonly root: HTMLElement;
  /** Fires after every user-driven layout change (persist the workspace here). */
  readonly onChange = new Emitter<void>();
  readonly onFocus = new Emitter<string | null>();
  private treeHost = h('div', { class: 'k-tree-host' });
  private floatLayer = h('div', { class: 'k-float-layer' });
  private layout: LayoutState = emptyLayout();
  private live = new Map<string, Live>();
  private floatEls = new Map<string, HTMLElement>();
  private tabEls = new Map<string, HTMLElement>();
  private focused: string | null = null;
  private preview: HTMLElement | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private makeContext: ContextFactory, container: HTMLElement) {
    this.root = container;
    this.root.classList.add('k-dock-root');
    this.root.append(this.treeHost, this.floatLayer);
    observeSize(this.root, () => this.clampFloats());
  }

  /* ------------------------------------------------------------------ public API */
  getLayout(): LayoutState {
    this.collectStates();
    return cloneLayout(this.layout);
  }
  setLayout(l: LayoutState): void {
    this.layout = normalize(cloneLayout(l));
    this.render();
    this.onChange.emit();
  }
  focusedInstance(): string | null {
    return this.focused;
  }
  isOpen(panelId: string): boolean {
    return Object.values(this.layout.instances).some((i) => i.panelId === panelId);
  }
  instancesOf(panelId: string): string[] {
    return Object.keys(this.layout.instances).filter((k) => this.layout.instances[k].panelId === panelId);
  }
  /** Open (or focus, for singletons) a panel. Returns the instance id. */
  openPanel(panelId: string, opts: { float?: boolean; groupId?: string; state?: unknown } = {}): string | null {
    const def = getPanel(panelId);
    if (!def) return null;
    if (isSingleton(def)) {
      const existing = this.instancesOf(panelId)[0];
      if (existing) {
        this.focusInstance(existing);
        return existing;
      }
    }
    const l = this.layout;
    const dd = def.defaultDock;
    const id = nextInstanceId(l, panelId);
    if (opts.float || dd?.zone === 'float' || !l.root) {
      if (!l.root && !opts.float && dd?.zone !== 'float') addInstance(l, panelId, { instId: id, state: opts.state });
      else {
        addInstance(l, panelId, { instId: id, state: opts.state });
        const b = this.root.getBoundingClientRect();
        floatInstance(l, id, { x: Math.max(20, b.width / 2 - 260), y: Math.max(20, b.height / 4), w: 520, h: 380 });
      }
    } else if (opts.groupId && findGroup(l, opts.groupId)) {
      addInstance(l, panelId, { instId: id, groupId: opts.groupId, state: opts.state });
    } else {
      addInstance(l, panelId, { instId: id, state: opts.state });
      const zone = (dd?.zone ?? 'center') as DropZone;
      if (zone !== 'center') {
        // move into a fresh edge group relative to the layout root
        dockToRootEdge(l, id, zone, undefined, Math.min(0.5, dd?.size ?? 0.25));
      }
    }
    normalize(l);
    this.render();
    this.focusInstance(id);
    this.onChange.emit();
    return id;
  }
  closeInstance(instId: string): void {
    this.disposeLive(instId);
    closeInstance(this.layout, instId);
    this.render();
    this.onChange.emit();
  }
  togglePanel(panelId: string): void {
    if (this.isOpen(panelId)) this.instancesOf(panelId).forEach((i) => this.closeInstance(i));
    else this.openPanel(panelId);
  }
  focusInstance(instId: string): void {
    const g = findGroupOf(this.layout, instId);
    if (!g) return;
    this.activateInPlace(instId);
    this.setFocused(instId);
    this.live.get(instId)?.api?.focus?.();
  }
  floatInstance(instId: string, rect?: Rect): void {
    const g = findGroupOf(this.layout, instId);
    if (!g) return;
    const b = this.root.getBoundingClientRect();
    const pane = this.root.querySelector(`[data-group="${g.group.id}"]`)?.getBoundingClientRect();
    const r = rect ?? { x: Math.max(10, (pane ? pane.left - b.left : 60) + 30), y: Math.max(10, (pane ? pane.top - b.top : 60) + 30), w: Math.max(320, Math.min(pane?.width ?? 480, 720)), h: Math.max(240, Math.min(pane?.height ?? 360, 600)) };
    floatInstance(this.layout, instId, clampRect(r, { w: b.width, h: b.height }));
    this.render();
    this.onChange.emit();
  }
  dockBack(floatId: string): void {
    dockFloatBack(this.layout, floatId);
    normalize(this.layout);
    this.render();
    this.onChange.emit();
  }
  /** Re-render when state changes externally. */
  refresh(): void {
    this.render();
  }

  /** Serialise panel state into the layout (called before saving). */
  collectStates(): void {
    for (const [id, lv] of this.live) {
      const s = lv.api?.serialize?.() ?? lv.state.get();
      if (s !== undefined && this.layout.instances[id]) this.layout.instances[id].state = s;
    }
  }

  /* ------------------------------------------------------------------ live panel instances */
  private ensureLive(instId: string): Live | null {
    let lv = this.live.get(instId);
    if (lv) return lv;
    const info = this.layout.instances[instId];
    const def = info ? getPanel(info.panelId) : undefined;
    if (!info || !def) return null;
    const host = h('div', { class: 'k-panel-host', 'data-inst': instId });
    const title = new Store<string>(def.title);
    const visible = new Store<boolean>(false);
    const state = new Store<unknown>(info.state);
    const ctx = this.makeContext({ instanceId: instId, panelId: def.id, state, title, visible, initialState: info.state });
    lv = { instId, def, host, api: null, ctx, title, visible, state, unsubs: [] };
    this.live.set(instId, lv);
    lv.unsubs.push(
      title.subscribe((t) => {
        if (lv!.tabLabel) lv!.tabLabel.textContent = t;
      }),
      state.subscribe(() => {
        clearTimeout(this.stateTimer);
        this.stateTimer = setTimeout(() => this.onChange.emit(), 400);
      }),
      observeSize(host, (w, hh) => {
        if (w > 0 && hh > 0) lv!.api?.resize?.(w, hh);
      }),
    );
    if (isPanelBlocked(def.id)) {
      // safe mode (?safe): heavy GPU panels start as a placeholder
      host.replaceChildren(
        h('div', { class: 'k-panel-error safe', role: 'status' }, h('strong', {}, `${def.title}: ${t('safe.panelDisabled')}`), h('div', { class: 'k-dim' }, t('safe.banner')), h('button', { onclick: () => (allowPanel(def.id), this.restartPanel(instId)) }, t('safe.enablePanel'))),
      );
      return lv;
    }
    try {
      lv.api = guardInstance(def.create(host, ctx), def.title);
    } catch (e) {
      const err = e as Error;
      consoleBus.error(`Panel "${def.title}" failed to start: ${err.message}`, { source: 'app', detail: err.stack });
      showCrashOverlay(host, def.title, err, () => this.restartPanel(instId));
    }
    return lv;
  }

  /** tear a panel down and build it again from scratch (crash overlay "Reload", safe-mode enable). */
  restartPanel(instId: string): void {
    if (!this.live.has(instId)) return;
    this.disposeLive(instId);
    this.render();
  }

  /** replace the body of a live panel by the crash overlay (error boundary tripped). */
  crashPanel(instId: string, error: Error): void {
    const lv = this.live.get(instId);
    if (!lv) return;
    try {
      lv.api?.dispose();
    } catch {
      /* already broken */
    }
    lv.api = null;
    showCrashOverlay(lv.host, lv.def.title, error, () => this.restartPanel(instId));
  }
  private disposeLive(instId: string): void {
    const lv = this.live.get(instId);
    if (!lv) return;
    this.live.delete(instId);
    lv.unsubs.forEach((u) => u());
    try {
      lv.api?.dispose();
    } catch (e) {
      consoleBus.error(`Panel "${lv.def.title}" dispose failed: ${(e as Error).message}`);
    }
    lv.host.remove();
  }
  private updateVisibility(): void {
    const activeVisible = new Set<string>();
    for (const g of allGroups(this.layout)) {
      if (g.group.active && !g.float?.minimized) activeVisible.add(g.group.active);
    }
    for (const [id, lv] of this.live) {
      lv.visible.set(activeVisible.has(id));
      lv.host.classList.toggle('hidden', !activeVisible.has(id));
    }
  }

  /* ------------------------------------------------------------------ rendering */
  private render(): void {
    const l = this.layout;
    // dispose instances that vanished from the layout
    for (const id of [...this.live.keys()]) if (!l.instances[id]) this.disposeLive(id);
    this.tabEls.clear();
    this.floatEls.clear();
    this.treeHost.replaceChildren();
    this.floatLayer.replaceChildren();
    if (l.root) this.treeHost.append(this.renderNode(l.root));
    else this.treeHost.append(h('div', { class: 'k-dock-empty' }, icon('layout', 28), h('div', {}, tt('dockManager.noPanelsOpen')), h('div', { class: 'k-dim' }, tt('dockManager.useTheWindowMenu'))));
    for (const f of l.floating) this.floatLayer.append(this.renderFloat(f));
    this.updateVisibility();
    if (this.focused && !l.instances[this.focused]) this.setFocused(null);
  }

  private renderNode(n: DockNode): HTMLElement {
    if (n.type === 'tabs') return this.renderGroup(n);
    const el = h('div', { class: `k-split ${n.dir}`, 'data-split': n.id });
    const cells: HTMLElement[] = [];
    n.children.forEach((c, i) => {
      const cell = h('div', { class: 'k-cell', style: { flex: `${n.sizes[i]} 1 0px` } }, this.renderNode(c));
      cells.push(cell);
      el.append(cell);
      if (i < n.children.length - 1) el.append(this.makeSash(n, i, cells, el));
    });
    return el;
  }

  private makeSash(split: Extract<DockNode, { type: 'split' }>, index: number, cells: HTMLElement[], container: HTMLElement): HTMLElement {
    const row = split.dir === 'row';
    const sash = h('div', { class: 'k-sash', role: 'separator', tabindex: 0, 'aria-orientation': row ? 'vertical' : 'horizontal' });
    const nCells = split.children.length;
    const apply = (sizes: number[]): void => {
      sizes.forEach((s, i) => ((container.children[i * 2] as HTMLElement).style.flex = `${s} 1 0px`));
      void cells;
    };
    const available = (): number => (row ? container.clientWidth : container.clientHeight) - (nCells - 1) * 4;
    const minFrac = (): number => Math.min(0.4, MIN_CELL_PX / Math.max(available(), 1));
    const resize = (base: number[], delta: number): number[] => {
      const d = delta / Math.max(available(), 1);
      const mf = minFrac();
      const a = Math.min(Math.max(base[index] + d, mf), base[index] + base[index + 1] - mf);
      const out = base.slice();
      out[index] = a;
      out[index + 1] = base[index] + base[index + 1] - a;
      return out;
    };
    sash.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const base = split.sizes.slice();
      sash.classList.add('drag');
      let cur = base;
      dragPointer(
        e,
        (dx, dy) => {
          cur = resize(base, row ? dx : dy);
          apply(cur);
        },
        () => {
          sash.classList.remove('drag');
          setSplitSizes(this.layout, split.id, cur);
          split.sizes = cur;
          this.onChange.emit();
        },
      );
    });
    sash.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.05 : 0.015;
      const keys = row ? { ArrowLeft: -1, ArrowRight: 1 } : { ArrowUp: -1, ArrowDown: 1 };
      const k = keys[e.key as keyof typeof keys];
      if (!k) return;
      e.preventDefault();
      const next = resize(split.sizes, k * step * available());
      split.sizes = next;
      setSplitSizes(this.layout, split.id, next);
      apply(next);
      this.onChange.emit();
    });
    sash.addEventListener('dblclick', () => {
      const t = (split.sizes[index] + split.sizes[index + 1]) / 2;
      const next = split.sizes.slice();
      next[index] = t;
      next[index + 1] = t;
      split.sizes = next;
      setSplitSizes(this.layout, split.id, next);
      apply(next);
      this.onChange.emit();
    });
    return sash;
  }

  private renderGroup(g: TabsNode, float?: FloatWindow): HTMLElement {
    const scroll = h('div', { class: 'k-tabs-scroll', role: 'tablist' });
    const bar = h('div', { class: 'k-tabbar' }, scroll, h('div', { class: 'k-tabbar-fill' }));
    const body = h('div', { class: 'k-pane-body' });
    const pane = h('div', { class: 'k-pane', 'data-group': g.id, tabindex: -1 }, bar, body);
    const btns = h('div', { class: 'k-tabbar-btns' });
    for (const id of g.tabs) {
      const lv = g.active === id ? this.ensureLive(id) : this.live.get(id) ?? null;
      const info = this.layout.instances[id];
      const def = info ? getPanel(info.panelId) : undefined;
      if (!def) continue;
      scroll.append(this.makeTab(id, def, lv, g, float));
      const host = this.live.get(id)?.host;
      if (host) body.append(host);
    }
    if (float) {
      btns.append(
        this.barBtn('minimize', float.minimized ? 'Restore' : 'Minimize', () => this.toggleMin(float)),
        this.barBtn(float.maximized ? 'restore' : 'maximize', float.maximized ? 'Restore size' : 'Maximize', () => this.toggleMax(float)),
        this.barBtn('dock', 'Dock back (double-click title)', () => this.dockBack(float.id)),
        this.barBtn('close', 'Close', () => g.active && this.closeInstance(g.active)),
      );
    } else {
      btns.append(this.barBtn('more', 'Panel menu', (e) => menuBelow(e.currentTarget as HTMLElement, () => this.tabMenu(g.active ?? g.tabs[0], g), { minWidth: 180 })));
    }
    bar.append(btns);
    pane.addEventListener('pointerdown', () => g.active && this.setFocused(g.active), true);
    return pane;
  }

  private barBtn(ic: string, tip: string, fn: (e: MouseEvent) => void): HTMLButtonElement {
    return h('button', { class: 'k-ibtn sm', tip, 'aria-label': tip, onclick: fn as (e: Event) => void }, icon(ic, 12));
  }

  private makeTab(instId: string, def: PanelDefinition, lv: Live | null, g: TabsNode, float?: FloatWindow): HTMLElement {
    const label = h('span', {}, lv?.title.get() ?? def.title);
    if (lv) lv.tabLabel = label;
    else {
      const l2 = this.live.get(instId);
      if (l2) l2.tabLabel = label;
    }
    const close = h('span', { class: 'k-tab-x', tip: 'Close', onclick: (e: Event) => (e.stopPropagation(), this.closeInstance(instId)), onpointerdown: (e: Event) => e.stopPropagation() }, icon('close', 9));
    const tab = h('div', { class: `k-tab${g.active === instId ? ' active' : ''}`, role: 'tab', tabindex: g.active === instId ? 0 : -1, 'aria-selected': String(g.active === instId), 'data-inst': instId }, icon(def.icon, 13), label, close);
    this.tabEls.set(instId, tab);
    tab.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.closeInstance(instId);
        return;
      }
      if (e.button !== 0) return;
      this.startTabDrag(e, instId, tab);
    });
    tab.addEventListener('dblclick', () => (float ? this.dockBack(float.id) : this.floatInstance(instId)));
    tab.addEventListener('contextmenu', (e) => contextMenu(e, () => this.tabMenu(instId, g)));
    tab.addEventListener('keydown', (e) => this.tabKey(e, instId, g, float));
    return tab;
  }

  private tabMenu(instId: string, g: TabsNode): MenuItem[] {
    const f = findGroupOf(this.layout, instId)?.float;
    const items: MenuItem[] = [];
    items.push(f ? { label: tt('dockManager.dockBack'), icon: 'dock', action: () => this.dockBack(f.id) } : { label: 'Float', icon: 'float', action: () => this.floatInstance(instId) });
    items.push({ separator: true }, { header: tt('dockManager.dockToWindowEdge') });
    for (const z of ['left', 'right', 'top', 'bottom'] as const) items.push({ label: z[0].toUpperCase() + z.slice(1), icon: 'dock', action: () => this.moveToRootEdge(instId, z) });
    const def = getPanel(this.layout.instances[instId]?.panelId ?? '');
    if (def && !isSingleton(def)) items.push({ separator: true }, { label: tt('dockManager.duplicatePanel'), icon: 'duplicate', action: () => void this.openPanel(def.id, { groupId: g.id }) });
    items.push({ separator: true }, { label: 'Close', icon: 'close', action: () => this.closeInstance(instId) });
    if (g.tabs.length > 1) items.push({ label: tt('dockManager.closeOthers'), action: () => g.tabs.filter((t) => t !== instId).forEach((t) => this.closeInstance(t)) });
    return items;
  }

  moveToRootEdge(instId: string, zone: Exclude<DropZone, 'center'>): void {
    dockToRootEdge(this.layout, instId, zone);
    this.render();
    this.onChange.emit();
  }

  private tabKey(e: KeyboardEvent, instId: string, g: TabsNode, float?: FloatWindow): void {
    const i = g.tabs.indexOf(instId);
    const go = (j: number): void => {
      const t = g.tabs[Math.max(0, Math.min(g.tabs.length - 1, j))];
      if (!t) return;
      this.activateInPlace(t);
      this.tabEls.get(t)?.focus();
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        moveTab(this.layout, instId, i + d);
        this.render();
        this.tabEls.get(instId)?.focus();
        this.onChange.emit();
      } else go(i + d);
    } else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(g.tabs.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') this.activateInPlace(instId);
    else if (e.key === 'Delete' || (e.key.toLowerCase() === 'w' && e.ctrlKey)) this.closeInstance(instId);
    else if (e.key === 'F10' && e.shiftKey) {
      const r = this.tabEls.get(instId)!.getBoundingClientRect();
      menuBelow(this.tabEls.get(instId)!, () => this.tabMenu(instId, g), { minWidth: Math.max(160, r.width) });
    } else if (e.key.toLowerCase() === 'f' && e.altKey) float ? this.dockBack(float.id) : this.floatInstance(instId);
    else return;
    e.preventDefault();
  }

  private setFocused(instId: string | null): void {
    if (this.focused === instId) return;
    this.focused = instId;
    this.root.querySelectorAll('.k-pane.focus, .k-float.focus').forEach((x) => x.classList.remove('focus'));
    if (instId) {
      const g = findGroupOf(this.layout, instId);
      if (g) {
        this.root.querySelector(`[data-group="${g.group.id}"]`)?.classList.add('focus');
        if (g.float) {
          this.floatEls.get(g.float.id)?.classList.add('focus');
          focusFloat(this.layout, g.float.id);
          const fe = this.floatEls.get(g.float.id);
          if (fe) fe.style.zIndex = String(g.float.z);
        }
      }
    }
    this.onFocus.emit(instId);
  }

  /** Switch the visible tab of a group without rebuilding the DOM. */
  private activateInPlace(instId: string): void {
    const g = findGroupOf(this.layout, instId);
    if (!g) return;
    activate(this.layout, instId);
    const pane = this.root.querySelector(`[data-group="${g.group.id}"]`) as HTMLElement | null;
    if (!pane) return this.render();
    const lv = this.ensureLive(instId);
    const body = pane.querySelector('.k-pane-body');
    if (lv && body && lv.host.parentElement !== body) body.append(lv.host);
    for (const t of g.group.tabs) {
      const el = this.tabEls.get(t);
      el?.classList.toggle('active', t === instId);
      el?.setAttribute('aria-selected', String(t === instId));
      el?.setAttribute('tabindex', t === instId ? '0' : '-1');
    }
    this.updateVisibility();
    this.onChange.emit();
  }

  /* ------------------------------------------------------------------ tab drag & drop */
  private startTabDrag(e: PointerEvent, instId: string, tab: HTMLElement): void {
    
    
    let dragging = false;
    let ghost: HTMLElement | null = null;
    let target: DropTarget | null = null;
    const def = getPanel(this.layout.instances[instId]?.panelId ?? '');
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') cancel = true;
    };
    let cancel = false;
    window.addEventListener('keydown', onKey, true);
    const cleanup = (): void => {
      window.removeEventListener('keydown', onKey, true);
      ghost?.remove();
      this.hidePreview();
      document.body.classList.remove('k-dragging');
      tab.classList.remove('dragging');
    };
    dragPointer(
      e,
      (dx, dy, ev) => {
        if (!dragging) {
          if (Math.hypot(dx, dy) < 6) return;
          dragging = true;
          document.body.classList.add('k-dragging');
          tab.classList.add('dragging');
          ghost = h('div', { class: 'k-drag-ghost' }, icon(def?.icon ?? 'cube', 13), def?.title ?? instId);
          document.body.append(ghost);
        }
        ghost!.style.left = `${ev.clientX + 12}px`;
        ghost!.style.top = `${ev.clientY + 8}px`;
        target = this.hitTest(ev.clientX, ev.clientY, instId);
        if (target) this.showPreview(target.rect);
        else this.hidePreview();
      },
      (cancelled, ev) => {
        const t = target;
        const wasDragging = dragging;
        cleanup();
        if (!wasDragging) {
          if (!cancelled) this.focusInstance(instId);
          return;
        }
        if (cancelled || cancel) return;
        this.dropTab(instId, t, ev.clientX, ev.clientY);
      },
    );
  }

  private hitTest(x: number, y: number, instId: string): DropTarget | null {
    const root = this.root.getBoundingClientRect();
    const rel = (r: DOMRect): Rect => ({ x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height });
    const stack = document.elementsFromPoint(x, y);
    const overFloat = stack.find((el) => el.classList?.contains('k-float')) as HTMLElement | undefined;
    const paneEl = stack.map((el) => (el as HTMLElement).closest?.('.k-pane') as HTMLElement | null).find((p) => !!p && this.root.contains(p));
    if (!overFloat) {
      const m = 22;
      const inside = x >= root.left && x <= root.right && y >= root.top && y <= root.bottom;
      if (inside) {
        const edge: Exclude<DropZone, 'center'> | null = x - root.left < m ? 'left' : root.right - x < m ? 'right' : y - root.top < m ? 'top' : root.bottom - y < m ? 'bottom' : null;
        if (edge) {
          const w = root.width * 0.25;
          const hh = root.height * 0.25;
          const r: Rect = edge === 'left' ? { x: 0, y: 0, w, h: root.height } : edge === 'right' ? { x: root.width - w, y: 0, w, h: root.height } : edge === 'top' ? { x: 0, y: 0, w: root.width, h: hh } : { x: 0, y: root.height - hh, w: root.width, h: hh };
          return { kind: 'root', zone: edge, rect: r };
        }
      }
    }
    if (!paneEl) return null;
    const groupId = paneEl.getAttribute('data-group')!;
    const found = findGroup(this.layout, groupId);
    if (!found) return null;
    const pr = paneEl.getBoundingClientRect();
    const bar = paneEl.querySelector('.k-tabbar')!.getBoundingClientRect();
    const full = rel(pr);
    if (y <= bar.bottom || found.float) {
      // over the tab strip: insertion index by tab midpoints
      const tabs = [...paneEl.querySelectorAll('.k-tab')] as HTMLElement[];
      let index = tabs.length;
      for (let i = 0; i < tabs.length; i++) {
        const tr = tabs[i].getBoundingClientRect();
        if (x < tr.left + tr.width / 2) {
          index = i;
          break;
        }
      }
      void instId;
      return { kind: 'group', groupId, zone: 'center', index, rect: full };
    }
    const fx = (x - pr.left) / pr.width;
    const fy = (y - bar.bottom) / Math.max(pr.bottom - bar.bottom, 1);
    if (fx > 0.28 && fx < 0.72 && fy > 0.28 && fy < 0.72) return { kind: 'group', groupId, zone: 'center', rect: full };
    const d = { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
    const zone = (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[a] <= d[b] ? a : b));
    const body = { x: full.x, y: bar.bottom - root.top, w: full.w, h: pr.bottom - bar.bottom };
    const r: Rect = zone === 'left' ? { ...body, w: body.w / 2 } : zone === 'right' ? { ...body, x: body.x + body.w / 2, w: body.w / 2 } : zone === 'top' ? { ...body, h: body.h / 2 } : { ...body, y: body.y + body.h / 2, h: body.h / 2 };
    return { kind: 'group', groupId, zone, rect: r };
  }

  private showPreview(r: Rect): void {
    if (!this.preview) {
      this.preview = h('div', { class: 'k-drop-preview' });
      this.root.append(this.preview);
    }
    Object.assign(this.preview.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, opacity: '1' });
  }
  private hidePreview(): void {
    this.preview?.remove();
    this.preview = null;
  }

  private dropTab(instId: string, t: DropTarget | null, x: number, y: number): void {
    const l = this.layout;
    if (t?.kind === 'group') {
      const src = findGroupOf(l, instId);
      let index = t.index;
      // reordering inside the same group: account for the removed tab
      if (src && src.group.id === t.groupId && index !== undefined && src.group.tabs.indexOf(instId) < index) index -= 1;
      dockInstance(l, instId, t.groupId, t.zone, index);
    } else if (t?.kind === 'root') dockToRootEdge(l, instId, t.zone);
    else {
      const b = this.root.getBoundingClientRect();
      const pane = this.tabEls.get(instId)?.closest('.k-pane')?.getBoundingClientRect();
      const w = Math.max(320, Math.min(pane?.width ?? 480, 720));
      const hh = Math.max(240, Math.min(pane?.height ?? 360, 600));
      floatInstance(l, instId, clampRect({ x: x - b.left - 60, y: y - b.top - 12, w, h: hh }, { w: b.width, h: b.height }));
    }
    this.render();
    this.setFocused(instId);
    this.onChange.emit();
  }

  /* ------------------------------------------------------------------ floating windows */
  private boundsNow(): { w: number; h: number } {
    return { w: this.root.clientWidth, h: this.root.clientHeight };
  }
  private applyRect(el: HTMLElement, f: FloatWindow): void {
    el.style.left = `${f.x}px`;
    el.style.top = `${f.y}px`;
    el.style.width = `${f.w}px`;
    el.style.height = `${f.h}px`;
  }
  private clampFloats(): void {
    const b = this.boundsNow();
    if (b.w === 0) return;
    for (const f of this.layout.floating) {
      const r = clampRect(f, b);
      if (r.x !== f.x || r.y !== f.y || r.w !== f.w || r.h !== f.h) {
        Object.assign(f, r);
        const el = this.floatEls.get(f.id);
        if (el) this.applyRect(el, f);
      }
    }
  }
  private toggleMin(f: FloatWindow): void {
    f.minimized = !f.minimized;
    this.floatEls.get(f.id)?.classList.toggle('minimized', f.minimized);
    this.render();
    this.onChange.emit();
  }
  private toggleMax(f: FloatWindow): void {
    if (!f.maximized) f.restore = { x: f.x, y: f.y, w: f.w, h: f.h };
    else if (f.restore) Object.assign(f, f.restore);
    f.maximized = !f.maximized;
    f.minimized = false;
    this.render();
    this.onChange.emit();
  }

  private renderFloat(f: FloatWindow): HTMLElement {
    const el = h('div', { class: `k-float${f.minimized ? ' minimized' : ''}${f.maximized ? ' maximized' : ''}`, style: { zIndex: String(f.z) }, 'data-float': f.id });
    this.applyRect(el, f);
    this.floatEls.set(f.id, el);
    const pane = this.renderGroup(f.group, f);
    el.append(pane);
    if (f.group.active && f.group.active === this.focused) el.classList.add('focus');
    const bar = pane.querySelector('.k-tabbar') as HTMLElement;
    el.addEventListener('pointerdown', () => {
      focusFloat(this.layout, f.id);
      el.style.zIndex = String(f.z);
      if (f.group.active) this.setFocused(f.group.active);
    }, true);
    // move window by dragging empty title-bar space
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('.k-tab, button')) return;
      if (f.maximized) return;
      const start = { x: f.x, y: f.y };
      const b = this.boundsNow();
      dragPointer(
        e,
        (dx, dy) => {
          const r = snapRect(clampRect({ x: start.x + dx, y: start.y + dy, w: f.w, h: f.h }, b), b);
          f.x = r.x;
          f.y = r.y;
          el.style.left = `${f.x}px`;
          el.style.top = `${f.y}px`;
        },
        () => this.onChange.emit(),
      );
    });
    bar.addEventListener('dblclick', (e) => {
      if (!(e.target as HTMLElement).closest('.k-tab, button')) this.dockBack(f.id);
    });
    // 8 resize handles
    for (const dir of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const rz = h('div', { class: `k-rz ${dir}` });
      rz.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        const s: Rect = { x: f.x, y: f.y, w: f.w, h: f.h };
        const b = this.boundsNow();
        const minW = 220;
        const minH = 120;
        dragPointer(
          e,
          (dx, dy) => {
            let { x, y, w, h: hh } = s;
            if (dir.includes('e')) w = Math.max(minW, Math.min(s.w + dx, b.w - s.x));
            if (dir.includes('s')) hh = Math.max(minH, Math.min(s.h + dy, b.h - s.y));
            if (dir.includes('w')) {
              const nx = Math.max(0, Math.min(s.x + dx, s.x + s.w - minW));
              w = s.w + (s.x - nx);
              x = nx;
            }
            if (dir.includes('n')) {
              const ny = Math.max(0, Math.min(s.y + dy, s.y + s.h - minH));
              hh = s.h + (s.y - ny);
              y = ny;
            }
            const r = snapRect({ x, y, w, h: hh }, b, 8);
            // snapping may only move edges that are being dragged; keep size consistent
            Object.assign(f, dir.length === 2 || dir === 'e' || dir === 's' ? { x, y, w, h: hh } : r);
            Object.assign(f, { x, y, w, h: hh });
            this.applyRect(el, f);
          },
          () => this.onChange.emit(),
        );
      });
      el.append(rz);
    }
    return el;
  }
}

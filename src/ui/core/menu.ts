import { h, listen } from './dom';
import { icon } from '../icons';

/** Shared menu component: menu bar drop-downs, context menus, dropdown widgets and tab menus all use it. */
export interface MenuItem {
  label?: string;
  icon?: string;
  /** Pre-formatted shortcut text. */
  shortcut?: string;
  action?: () => void;
  checked?: boolean;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
  /** Non-clickable section heading. */
  header?: string;
  submenu?: MenuItem[] | (() => MenuItem[]);
  /** Do not close the menu when clicked (toggles). */
  keepOpen?: boolean;
}

export interface MenuHandle {
  close(): void;
  readonly el: HTMLElement;
}

const openMenus: MenuHandle[] = [];
export const closeAllMenus = (): void => {
  for (const m of [...openMenus]) m.close();
};

export function showMenu(source: MenuItem[] | (() => MenuItem[]), x: number, y: number, opts: { onClose?: () => void; parent?: MenuHandle; minWidth?: number } = {}): MenuHandle {
  const items = typeof source === 'function' ? source() : source;
  const el = h('div', { class: 'k-menu', role: 'menu' });
  if (opts.minWidth) el.style.minWidth = `${opts.minWidth}px`;
  let hot = -1;
  let child: MenuHandle | null = null;
  let childTimer: ReturnType<typeof setTimeout> | undefined;
  const rows: { item: MenuItem; el: HTMLElement }[] = [];
  const offs: Array<() => void> = [];

  const closeChild = (): void => {
    child?.close();
    child = null;
  };
  const close = (): void => {
    const i = openMenus.indexOf(handle);
    if (i < 0) return;
    openMenus.splice(i, 1);
    closeChild();
    clearTimeout(childTimer);
    offs.forEach((o) => o());
    el.remove();
    opts.onClose?.();
  };
  const handle: MenuHandle = { close, el };

  const setHot = (i: number): void => {
    rows.forEach((r, j) => r.el.classList.toggle('hot', j === i));
    hot = i;
  };
  const openSub = (r: { item: MenuItem; el: HTMLElement }): void => {
    closeChild();
    if (!r.item.submenu) return;
    const b = r.el.getBoundingClientRect();
    child = showMenu(r.item.submenu, b.right - 2, b.top - 4, { parent: handle });
  };
  const activate = (r: { item: MenuItem; el: HTMLElement }): void => {
    if (r.item.disabled) return;
    if (r.item.submenu) return openSub(r);
    if (!r.item.keepOpen) {
      // close the whole chain
      const root: MenuHandle = handle;
      void root;
      closeAllMenus();
    }
    r.item.action?.();
  };

  for (const item of items) {
    if (item.separator) {
      el.append(h('div', { class: 'k-mi-sep' }));
      continue;
    }
    if (item.header) {
      el.append(h('div', { class: 'k-mi-head' }, item.header));
      continue;
    }
    const row = h(
      'div',
      { class: `k-mi${item.disabled ? ' disabled' : ''}${item.danger ? ' danger' : ''}`, role: 'menuitem' },
      h('span', { class: 'k-mi-ic' }, item.checked ? icon('check', 12) : item.icon ? icon(item.icon, 13) : null),
      h('span', {}, item.label ?? ''),
      item.shortcut ? h('span', { class: 'k-mi-sc' }, item.shortcut) : null,
      item.submenu ? h('span', { class: 'k-mi-sc' }, icon('chevron-right', 10)) : null,
    );
    const r = { item, el: row };
    rows.push(r);
    row.addEventListener('pointerenter', () => {
      setHot(rows.indexOf(r));
      clearTimeout(childTimer);
      if (item.submenu && !item.disabled) childTimer = setTimeout(() => openSub(r), 120);
      else childTimer = setTimeout(closeChild, 200);
    });
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      activate(r);
    });
    el.append(row);
  }

  document.body.append(el);
  // position (flip/clamp inside the viewport)
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let px = x;
  let py = y;
  if (px + w > vw - 4) px = opts.parent ? Math.max(4, x - w - (opts.parent.el.offsetWidth - 4)) : Math.max(4, vw - w - 4);
  if (py + hgt > vh - 4) py = Math.max(4, vh - hgt - 4);
  el.style.left = `${px}px`;
  el.style.top = `${py}px`;
  openMenus.push(handle);

  if (!opts.parent) {
    offs.push(
      listen(window, 'pointerdown', (e: PointerEvent) => {
        if (!openMenus.some((m) => m.el.contains(e.target as Node))) closeAllMenus();
      }, { capture: true }),
      listen(window, 'blur', () => closeAllMenus()),
      listen(window, 'keydown', (e: KeyboardEvent) => {
        // keyboard goes to the innermost menu
        const innermost = openMenus[openMenus.length - 1];
        if (innermost !== handle && innermost) return;
        navKey(e);
      }, { capture: true }),
    );
  }
  const navKey = (e: KeyboardEvent): void => {
    const enabled = rows.map((r, i) => (r.item.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    const move = (d: number): void => {
      const cur = enabled.indexOf(hot);
      setHot(enabled[(cur + d + enabled.length) % enabled.length]);
    };
    if (e.key === 'ArrowDown') move(1);
    else if (e.key === 'ArrowUp') move(-1);
    else if (e.key === 'Enter' || e.key === ' ' || (e.key === 'ArrowRight' && rows[hot]?.item.submenu)) {
      if (hot >= 0) activate(rows[hot]);
    } else if (e.key === 'ArrowLeft' && opts.parent) {
      close();
    } else if (e.key === 'Escape') closeAllMenus();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  if (opts.parent) {
    // submenu keyboard handling is routed through the root's listener to the innermost menu
    offs.push(listen(window, 'keydown', (e: KeyboardEvent) => {
      if (openMenus[openMenus.length - 1] === handle) navKey(e);
    }, { capture: true }));
  }
  return handle;
}

/** Context menu at the pointer position. */
export function contextMenu(e: MouseEvent | PointerEvent, items: MenuItem[] | (() => MenuItem[])): MenuHandle {
  e.preventDefault();
  e.stopPropagation();
  closeAllMenus();
  return showMenu(items, e.clientX, e.clientY);
}

/** Anchor a menu under an element (menu bar buttons, dropdown arrows). */
export function menuBelow(anchor: HTMLElement, items: MenuItem[] | (() => MenuItem[]), opts: { onClose?: () => void; minWidth?: number } = {}): MenuHandle {
  closeAllMenus();
  const b = anchor.getBoundingClientRect();
  return showMenu(items, b.left, b.bottom + 2, { ...opts, minWidth: opts.minWidth ?? b.width });
}

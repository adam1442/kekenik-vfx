import type { ToolbarItem } from '../../gizmos/spline-tools';
import { h } from '../core/dom';
import './gizmo-toolbar.css';

/**
 * Overlay mini-toolbar of the viewports (spline tools: Select / Add / Delete, Convert, Close, Flip, Mirror, Snap, Frame all).
 * Shared by the 2D and the 3D viewport. Pure view: `update(items, run)` rebuilds the buttons only when the item signature changed,
 * so hovering / dragging never recreates the DOM. Direction-neutral: it stays LTR (it sits on a spatial content area).
 */
export class GizmoToolbar {
  readonly el: HTMLElement;
  private sig = '';
  /** Latest items / runner: buttons are reused between updates, so clicks always resolve the CURRENT item (fresh closures). */
  private items: readonly ToolbarItem[] = [];
  private runner: (item: ToolbarItem) => void = () => undefined;
  constructor() {
    this.el = h('div', { class: 'k-gz-toolbar', dir: 'ltr', role: 'toolbar' });
    this.el.style.display = 'none';
    // keep the pointer events away from the canvas underneath
    for (const ev of ['pointerdown', 'dblclick', 'contextmenu', 'wheel']) this.el.addEventListener(ev, (e) => e.stopPropagation());
  }

  /** `items` empty = hide. `run` executes one item (the viewport's controller commits the writes). */
  update(items: readonly ToolbarItem[], run: (item: ToolbarItem) => void): void {
    if (!items.length) {
      this.el.style.display = 'none';
      this.sig = '';
      return;
    }
    this.items = items;
    this.runner = run;
    this.el.style.display = '';
    const sig = items.map((i) => `${i.id}|${i.icon}|${i.tip}|${i.active ? 1 : 0}|${i.disabled ? 1 : 0}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    const kids: HTMLElement[] = [];
    for (const it of items) {
      if (it.separator) kids.push(h('span', { class: 'k-gz-sep' }));
      kids.push(
        h(
          'button',
          {
            class: `k-gz-btn${it.active ? ' active' : ''}`,
            tip: it.tip,
            'aria-label': it.tip,
            'aria-pressed': it.active ? 'true' : 'false',
            'data-item': it.id,
            disabled: it.disabled ? 'true' : undefined,
            onclick: () => {
              const cur = this.items.find((x) => x.id === it.id);
              if (cur) this.runner(cur);
            },
          },
          it.icon,
        ),
      );
    }
    this.el.replaceChildren(...kids);
  }
}

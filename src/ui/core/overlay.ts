import { h, listen } from './dom';
import { icon } from '../icons';

import { t as tt } from '../../shared/i18n';
/* ============================================================================================ tooltips
 * Delegated tooltip service: any element with `data-tip="text"` (h(.., {tip:'text'})) gets a tooltip after a short
 * delay. `data-tip-key="Ctrl+S"` appends a shortcut chip. Hidden on pointerdown / scroll / leave.
 */
export function initTooltips(): void {
  let tip: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: HTMLElement | null = null;
  const hide = (): void => {
    clearTimeout(timer);
    tip?.remove();
    tip = null;
    current = null;
  };
  const show = (target: HTMLElement, x: number): void => {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip = h('div', { class: 'k-tooltip' }, ...text.split('\n').flatMap((l, i) => (i ? [h('br'), l] : [l])));
    const key = target.getAttribute('data-tip-key');
    if (key) tip.append(h('kbd', {}, key));
    document.body.append(tip);
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const hh = tip.offsetHeight;
    let left = Math.min(Math.max(4, Math.max(r.left, Math.min(x, r.right - 4)) - 8), window.innerWidth - w - 4);
    let top = r.bottom + 6;
    if (top + hh > window.innerHeight - 4) top = Math.max(4, r.top - hh - 6);
    left = Math.max(4, left);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };
  document.addEventListener('pointerover', (e) => {
    const t = (e.target as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (t === current) return;
    hide();
    if (!t || (e as PointerEvent).pointerType === 'touch') return;
    current = t;
    timer = setTimeout(() => show(t, (e as PointerEvent).clientX), tip ? 0 : 450);
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('wheel', hide, { passive: true, capture: true });
  window.addEventListener('blur', hide);
}

/* ============================================================================================ toasts */
export type ToastType = 'info' | 'ok' | 'warn' | 'error';
let toastHost: HTMLElement | null = null;

export function toast(message: string, opts: { type?: ToastType; title?: string; timeout?: number; action?: { label: string; run: () => void } } = {}): void {
  if (!toastHost) {
    toastHost = h('div', { class: 'k-toasts', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const type = opts.type ?? 'info';
  const ic = type === 'ok' ? 'check' : type === 'warn' ? 'warning' : type === 'error' ? 'error' : 'info';
  const el = h(
    'div',
    { class: `k-toast ${type}`, role: 'status' },
    icon(ic, 14),
    h('div', { class: 'k-toast-body' }, opts.title ? h('div', { class: 'k-toast-title' }, opts.title) : null, message),
    opts.action
      ? h('button', { class: 'k-btn', onclick: () => { opts.action!.run(); dismiss(); } }, opts.action.label)
      : null,
    h('button', { class: 'k-ibtn sm', tip: 'Dismiss', onclick: () => dismiss() }, icon('close', 10)),
  );
  const dismiss = (): void => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  toastHost.append(el);
  while (toastHost.children.length > 5) toastHost.firstElementChild?.remove();
  const ms = opts.timeout ?? (type === 'error' ? 8000 : 3500);
  if (ms > 0) setTimeout(dismiss, ms);
}

/* ============================================================================================ modals */
export interface ModalButton<T> {
  label: string;
  value: T;
  primary?: boolean;
  danger?: boolean;
}

/** Generic modal; resolves with the clicked button's value (or `undefined` on Escape / backdrop click). */
export function showModal<T = string>(opts: { title: string; body: Node | string; buttons?: ModalButton<T>[]; width?: string; dismissable?: boolean; onMount?: (modal: HTMLElement, close: (v?: T) => void) => void }): Promise<T | undefined> {
  return new Promise((resolve) => {
    const body = typeof opts.body === 'string' ? h('div', {}, opts.body) : opts.body;
    const buttons = opts.buttons ?? [{ label: 'OK', value: 'ok' as unknown as T, primary: true }];
    const prevFocus = document.activeElement as HTMLElement | null;
    let done = false;
    const close = (v?: T): void => {
      if (done) return;
      done = true;
      off();
      back.remove();
      prevFocus?.focus?.();
      resolve(v);
    };
    const foot = h('div', { class: 'k-modal-foot' }, ...buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', style: b.danger ? { background: 'var(--bad)', borderColor: 'var(--bad)' } : {}, onclick: () => close(b.value) }, b.label)));
    const modal = h(
      'div',
      { class: 'k-modal', role: 'dialog', 'aria-modal': 'true', style: opts.width ? { width: opts.width } : {} },
      h('div', { class: 'k-modal-head' }, opts.title, h('span', { class: 'k-sp' }), h('button', { class: 'k-ibtn sm', tip: 'Close', onclick: () => close() }, icon('close', 11))),
      h('div', { class: 'k-modal-body' }, body),
      buttons.length ? foot : null,
    );
    const back = h('div', { class: 'k-modal-back' }, modal);
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back && opts.dismissable !== false) close();
    });
    const off = listen(window, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape' && opts.dismissable !== false) {
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLButtonElement)) {
        const p = buttons.find((b) => b.primary);
        if (p) close(p.value);
      }
    }, { capture: true });
    document.body.append(back);
    (modal.querySelector('input,textarea') as HTMLElement | null)?.focus() ?? (foot.querySelector('button.primary') as HTMLElement | null)?.focus();
    opts.onMount?.(modal, close);
  });
}

export async function confirmDialog(title: string, message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  const r = await showModal<boolean>({ title, body: message, buttons: [{ label: 'Cancel', value: false }, { label: opts.ok ?? 'OK', value: true, primary: !opts.danger, danger: opts.danger }] });
  return r === true;
}

/** Three-way unsaved changes dialog. */
export function unsavedDialog(name: string): Promise<'save' | 'discard' | 'cancel'> {
  return showModal<'save' | 'discard' | 'cancel'>({
    title: tt('overlay.unsavedChanges'),
    body: `"${name}" has unsaved changes. Do you want to save them first?`,
    buttons: [
      { label: 'Cancel', value: 'cancel' },
      { label: tt('overlay.donTSave'), value: 'discard', danger: true },
      { label: 'Save', value: 'save', primary: true },
    ],
  }).then((v) => v ?? 'cancel');
}

export async function promptDialog(title: string, label: string, initial = ''): Promise<string | null> {
  const input = h('input', { type: 'text', value: initial, style: { width: '100%', padding: '0.5rem 0.667rem', background: 'var(--bg0)', border: '1px solid var(--line2)', borderRadius: '0.25rem' } });
  const r = await showModal<boolean>({
    title,
    body: h('div', {}, h('div', { class: 'k-dim', style: { marginBottom: '0.5rem' } }, label), input),
    buttons: [{ label: 'Cancel', value: false }, { label: 'OK', value: true, primary: true }],
    onMount: () => {
      input.focus();
      input.select();
    },
  });
  return r ? input.value.trim() : null;
}

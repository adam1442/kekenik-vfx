import type { Unsubscribe } from '../../shared/emitter';

/** Tiny DOM helpers (vanilla TS UI, no framework). */
export type Child = Node | string | number | null | undefined | false;
export type AttrValue = string | number | boolean | null | undefined | ((e: Event) => void) | Partial<CSSStyleDeclaration>;
export type Attrs = Record<string, AttrValue>;

/**
 * h('div', {class:'x', tip:'Tooltip', onclick: fn, style:{width:'0.25rem'}}, child, 'text')
 * - `tip` -> data-tip (tooltip service); `on<event>` functions become listeners; booleans toggle attributes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'tip') e.setAttribute('data-tip', String(v));
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  append(e, children);
  return e;
}

export function append(parent: ParentNode, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(typeof c === 'number' ? String(c) : c);
  }
}

export const clear = (e: Element): void => e.replaceChildren();

export function listen<K extends keyof HTMLElementEventMap>(t: HTMLElement | Window | Document, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions): Unsubscribe {
  t.addEventListener(type, fn as EventListener, opts);
  return () => t.removeEventListener(type, fn as EventListener, opts);
}

/** Collects cleanup functions; `dispose()` runs them once (panels use it for subscriptions). */
export class Disposer {
  private fns: Array<() => void> = [];
  add<T extends (() => void) | undefined | void>(fn: T): T {
    if (typeof fn === 'function') this.fns.push(fn);
    return fn;
  }
  dispose(): void {
    const f = this.fns;
    this.fns = [];
    for (const fn of f.reverse()) {
      try {
        fn();
      } catch (e) {
        console.error('[Disposer]', e);
      }
    }
  }
}

/** Run `fn` at most once per animation frame. */
export function rafThrottle<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
  let queued = false;
  let last: A;
  return (...a: A) => {
    last = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn(...last);
    });
  };
}

export const debounce = <A extends unknown[]>(fn: (...a: A) => void, ms: number): ((...a: A) => void) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

/** Observe the content box of an element (device-pixel aware). Returns an unsubscribe. */
export function observeSize(target: HTMLElement, cb: (w: number, h: number, dpr: number) => void): Unsubscribe {
  const ro = new ResizeObserver((entries) => {
    const r = entries[entries.length - 1].contentRect;
    cb(r.width, r.height, window.devicePixelRatio || 1);
  });
  ro.observe(target);
  return () => ro.disconnect();
}

/**
 * Pointer drag helper with capture. `move(dx, dy, e)` receives the delta from the start; `end(cancelled)` always runs.
 * Works for mouse, pen and touch.
 */
export function dragPointer(
  e: PointerEvent,
  move: (dx: number, dy: number, ev: PointerEvent) => void,
  end?: (cancelled: boolean, ev: PointerEvent) => void,
): void {
  const target = e.currentTarget as HTMLElement | null;
  const id = e.pointerId;
  const sx = e.clientX;
  const sy = e.clientY;
  try {
    target?.setPointerCapture(id);
  } catch {
    /* not capturable: fall back to window listeners below */
  }
  const onMove = (ev: PointerEvent): void => {
    if (ev.pointerId === id) move(ev.clientX - sx, ev.clientY - sy, ev);
  };
  const finish = (cancelled: boolean) => (ev: PointerEvent): void => {
    if (ev.pointerId !== id) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    try {
      target?.releasePointerCapture(id);
    } catch {
      /* ignore */
    }
    end?.(cancelled, ev);
  };
  const onUp = finish(false);
  const onCancel = finish(true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}

export function download(name: string, data: Blob | string, mime = 'application/octet-stream'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function pickFile(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.onchange = () => resolve([...(i.files ?? [])]);
    i.oncancel = () => resolve([]);
    i.click();
  });
}

export const isTextInput = (t: EventTarget | null): boolean => {
  const e = t as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable;
};

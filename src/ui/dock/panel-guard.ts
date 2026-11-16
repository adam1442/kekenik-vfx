import { consoleBus } from '../../shared/log';
import { t } from '../../shared/i18n';
import { h } from '../core/dom';
import type { PanelInstance } from './panel-registry';

/**
 * React-free ERROR BOUNDARIES for panels.
 *
 * 1. `guardInstance` wraps the lifecycle methods (resize / focus / serialize / dispose) of a live panel: an exception is logged
 *    (with the panel name) and swallowed, the panel keeps living.
 * 2. `PanelErrorTracker` receives window-level `error` / `unhandledrejection` events, attributes them to the panel the user last
 *    interacted with (pointer / key target inside a `.k-panel-host`), and after `threshold` errors within `windowMs` calls `onTrip`
 *    so the dock can replace the panel body by the crash overlay (`showCrashOverlay`) with a Reload button.
 * Timers / async work of a panel cannot be attributed with certainty: the attribution is a heuristic and is documented as such.
 */
export function guardInstance(inst: PanelInstance, name: string): PanelInstance {
  const safe =
    <A extends unknown[]>(label: string, fn: ((...a: A) => void) | undefined) =>
    (...a: A): void => {
      if (!fn) return;
      try {
        fn.apply(inst, a);
      } catch (e) {
        consoleBus.error(`Panel "${name}" ${label} failed: ${(e as Error).message}`, { source: 'app', detail: (e as Error).stack });
      }
    };
  const out: PanelInstance = {
    dispose: safe('dispose', inst.dispose),
    resize: inst.resize ? safe('resize', inst.resize) : undefined,
    focus: inst.focus ? safe('focus', inst.focus) : undefined,
    serialize: inst.serialize
      ? () => {
          try {
            return inst.serialize!();
          } catch (e) {
            consoleBus.error(`Panel "${name}" serialize failed: ${(e as Error).message}`, { source: 'app' });
            return undefined;
          }
        }
      : undefined,
  };
  return out;
}

export class PanelErrorTracker {
  private hits = new Map<string, number[]>();
  private lastHost: HTMLElement | null = null;
  private off: Array<() => void> = [];

  constructor(
    private onTrip: (instId: string, error: Error) => void,
    private threshold = 4,
    private windowMs = 10_000,
    private now: () => number = () => performance.now(),
  ) {}

  install(): void {
    const remember = (e: Event): void => {
      const el = e.target instanceof Element ? (e.target.closest('.k-panel-host') as HTMLElement | null) : null;
      if (el) this.lastHost = el;
    };
    window.addEventListener('pointerdown', remember, true);
    window.addEventListener('keydown', remember, true);
    const onErr = (ev: ErrorEvent): void => {
      this.report(ev.error instanceof Error ? ev.error : new Error(ev.message));
    };
    const onRej = (ev: PromiseRejectionEvent): void => {
      this.report(ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason)));
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    this.off = [() => window.removeEventListener('pointerdown', remember, true), () => window.removeEventListener('keydown', remember, true), () => window.removeEventListener('error', onErr), () => window.removeEventListener('unhandledrejection', onRej)];
  }
  uninstall(): void {
    this.off.forEach((f) => f());
    this.off = [];
  }

  /** Public for tests: count an error for the panel instance `instId` (or for the last interacted panel when omitted). */
  report(error: Error, instId?: string): boolean {
    const id = instId ?? this.lastHost?.getAttribute('data-inst') ?? undefined;
    consoleBus.error(`Uncaught error${id ? ` (panel ${id})` : ''}: ${error.message}`, { source: 'app', detail: error.stack });
    if (!id) return false;
    const t0 = this.now();
    const list = (this.hits.get(id) ?? []).filter((x) => t0 - x < this.windowMs);
    list.push(t0);
    this.hits.set(id, list);
    if (list.length >= this.threshold) {
      this.hits.delete(id);
      this.onTrip(id, error);
      return true;
    }
    return false;
  }
}

/** Replace the panel body by the crash overlay. `reload` re-creates the panel from scratch. */
export function showCrashOverlay(host: HTMLElement, title: string, error: Error, reload: () => void): void {
  host.replaceChildren(
    h(
      'div',
      { class: 'k-panel-error', role: 'alert' },
      h('strong', {}, `${title}: ${t('panel.crashed')}`),
      h('pre', {}, error.message),
      h(
        'div',
        { class: 'k-toolrow' },
        h('button', { class: 'primary', onclick: reload }, t('panel.reload')),
        h('button', { onclick: () => void navigator.clipboard?.writeText(`${error.message}\n${error.stack ?? ''}`) }, t('panel.copyError')),
      ),
    ),
  );
}

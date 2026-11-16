import { consoleBus } from '../../shared/log';
import { t } from '../../shared/i18n';
import { h } from '../core/dom';
import { registerPanel, type PanelContext, type PanelDefinition, type PanelInstance } from './panel-registry';

/**
 * LAZY PANELS.
 *
 * A heavy panel is split in two files: `panel.ts` only calls `registerLazyPanel(meta, () => import('./view'))` (menus, the command
 * palette and saved layouts need the metadata immediately), and `view.ts` exports `create(host, ctx)` — the real UI. Rollup turns
 * `view.ts` and everything only it imports into its own chunk, fetched the first time the panel is opened.
 *
 * `create()` stays synchronous for the dock: it returns a proxy instance that shows a loading state, forwards `resize` / `focus` /
 * `serialize` / `dispose` once the real panel exists, and shows an error with a Retry button when the chunk cannot be loaded
 * (offline, deploy mismatch). A panel disposed while its chunk is still loading is never created.
 */
export type PanelCreate = PanelDefinition['create'];
export type LazyPanelMeta = Omit<PanelDefinition, 'create'>;

export function registerLazyPanel(meta: LazyPanelMeta, load: () => Promise<{ create: PanelCreate }>): void {
  registerPanel({
    ...meta,
    create(host: HTMLElement, ctx: PanelContext): PanelInstance {
      let real: PanelInstance | null = null;
      let disposed = false;
      let size: [number, number] | null = null;
      const slot = h('div', { class: 'k-panel-loading', role: 'status' });
      host.append(slot);

      const fail = (err: Error): void => {
        consoleBus.error(`Panel "${meta.title}" failed to load: ${err.message}`, {
          source: 'app',
          detail: err.stack,
        });
        host.replaceChildren(slot);
        slot.replaceChildren(
          h('strong', {}, `${meta.title}: ${t('panel.crashed')}`),
          h('pre', {}, err.message),
          h('button', { class: 'primary', onclick: () => start() }, t('panel.reload')),
        );
      };
      const start = (): void => {
        slot.replaceChildren(
          h('div', { class: 'k-spinner' }),
          h('span', { class: 'k-dim' }, `${meta.title}…`),
        );
        load().then(
          (mod) => {
            if (disposed) return;
            slot.remove();
            try {
              real = mod.create(host, ctx);
              if (size) real.resize?.(size[0], size[1]);
            } catch (e) {
              fail(e as Error);
            }
          },
          (e: unknown) => {
            if (!disposed) fail(e as Error);
          },
        );
      };
      start();

      return {
        dispose: () => {
          disposed = true;
          real?.dispose();
          real = null;
        },
        resize: (w, hh) => {
          size = [w, hh];
          real?.resize?.(w, hh);
        },
        focus: () => real?.focus?.(),
        serialize: () => (real ? real.serialize?.() : ctx.initialState),
      };
    },
  });
}

/** Identity helper that types the `view.ts` half of a lazy panel: `export const { create } = definePanelView({ create(host, ctx) {...} })`. */
export const definePanelView = (v: { create: PanelCreate }): { create: PanelCreate } => v;

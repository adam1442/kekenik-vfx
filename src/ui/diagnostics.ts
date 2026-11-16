import { buildDiagnosticsText, hintKeys } from '../engine/gpu/diagnostics';
import type { CapabilityReport } from '../engine/gpu/caps';
import { GpuUnavailableError } from '../engine/gpu/acquire';
import { t } from '../shared/i18n';
import { versionLabel } from '../shared/version';
import { el, injectStyles } from './styles';

export interface DiagnosticsActions {
  /** Full tiered acquisition again. Resolves with an error message when it failed (screen stays), or null when the app took over. */
  retry: () => Promise<string | null>;
  /** Only the software adapter. */
  software: () => Promise<string | null>;
  /** Bare device on the lowest tier that exists. */
  limited: () => Promise<string | null>;
}

/**
 * GPU Diagnostics screen (replaces the old "unsupported browser" wall). It NEVER blocks needlessly: it shows exactly which step
 * failed, offers a copy-able plain-text report, per-browser instructions and three ways forward.
 * `host` is either the root (startup) or an overlay above the running app (device could not be recreated; project stays in memory).
 */
export function showGpuDiagnostics(host: HTMLElement, error: Error, actions: DiagnosticsActions, caps?: CapabilityReport | null): void {
  injectStyles();
  const gerr = error instanceof GpuUnavailableError ? error : null;
  const text = buildDiagnosticsText({ version: versionLabel(), error, caps });
  const failed = (gerr?.attempts ?? []).filter((a) => !a.ok);
  const status = el('p', { class: 'k-diag-status', role: 'status' });

  const copy = el('button', {}, t('diag.copy'));
  copy.addEventListener('click', () => {
    const done = (): void => void (copy.textContent = t('common.copied'));
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt(t('diag.copy'), text));
    else window.prompt(t('diag.copy'), text);
  });
  const mk = (label: string, run: () => Promise<string | null>, primary = false): HTMLButtonElement => {
    const b = el('button', primary ? { class: 'primary' } : {}, label);
    b.addEventListener('click', () => {
      const all = host.querySelectorAll('button');
      all.forEach((x) => ((x as HTMLButtonElement).disabled = true));
      status.textContent = t('diag.trying');
      void run()
        .then((msg) => {
          if (msg) status.textContent = t('diag.stillFailed', { msg });
        })
        .catch((e: unknown) => void (status.textContent = t('diag.stillFailed', { msg: (e as Error).message })))
        .finally(() => all.forEach((x) => ((x as HTMLButtonElement).disabled = false)));
    });
    return b;
  };

  const warnings: HTMLElement[] = [];
  if (gerr?.env.inIframe) warnings.push(el('p', { class: 'k-diag-warn' }, t('diag.iframe')));
  if (gerr?.env.secureContext === false) warnings.push(el('p', { class: 'k-diag-warn' }, t('diag.insecure')));

  const hints = el('ul', { class: 'k-diag-hints' }, ...hintKeys(navigator.userAgent).map((k) => el('li', {}, t(k))));
  const failList = failed.length
    ? el('ul', { class: 'k-diag-fail' }, ...failed.map((a) => el('li', {}, el('code', {}, `[${a.tier}] ${a.step}`), a.message ? ` — ${a.message}` : '')))
    : el('p', { class: 'k-dim' }, error.message);

  const card = el(
    'div',
    { class: 'k-diag' },
    el('h1', {}, t('diag.title')),
    el('p', {}, t('diag.noGpu')),
    el('p', { class: 'k-diag-msg' }, error.message),
    ...warnings,
    el('h2', {}, t('diag.failedStep')),
    failList,
    el('div', { class: 'k-toolrow' }, mk(t('diag.retry'), actions.retry, true), mk(t('diag.software'), actions.software), mk(t('diag.limited'), actions.limited), copy),
    status,
    el('h2', {}, t('diag.help')),
    hints,
    el('pre', { class: 'k-diag-pre', dir: 'ltr' }, text),
  );
  host.replaceChildren(el('div', { class: 'k-diag-wrap' }, card));
}

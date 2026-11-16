import { availableLocales, getLocale, LANG_NAMES, setLocale, t } from '../shared/i18n';
import { ACCENTS, SCALE_MAX, SCALE_MIN, SCALE_PRESETS } from '../ui/theme/ui-store';
import { h } from '../ui/core/dom';
import { confirmDialog, showModal, toast } from '../ui/core/overlay';
import { TabStrip } from '../ui/widgets/controls';
import type { AppServices } from './app';
import { applySettings } from './perf-wiring';

/**
 * Settings dialog (Ctrl+,). Every control writes through `app.settings` (persisted in localStorage) and `applySettings` makes the
 * change live immediately. Tabs: General, Quality & memory, Project. Keyboard shortcuts live in their own dialog (button).
 */
export function openSettings(app: AppServices): void {
  const s = app.settings;
  const eng = app.engine;
  const body = h('div', { class: 'k-settings' });
  let tab = 'General';

  const row = (label: string, tip: string, control: HTMLElement): HTMLElement => h('label', { class: 'k-set-row', tip }, h('span', { class: 'k-set-label' }, label), control);
  const set = <K extends Parameters<typeof s.set>[0]>(k: K, v: Parameters<typeof s.set<K>>[1]): void => {
    s.set(k, v);
    applySettings(app);
  };
  const range = (min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt: (v: number) => string): HTMLElement => {
    const out = h('span', { class: 'k-set-val' }, fmt(value));
    const i = h('input', { type: 'range', min, max, step, value });
    i.addEventListener('input', () => {
      out.textContent = fmt(+i.value);
      onInput(+i.value);
    });
    return h('span', { class: 'k-set-ctl' }, i, out);
  };
  const check = (value: boolean, onInput: (v: boolean) => void): HTMLElement => {
    const i = h('input', { type: 'checkbox' });
    i.checked = value;
    i.addEventListener('change', () => onInput(i.checked));
    return i;
  };
  const select = (value: string, opts: [string, string][], onInput: (v: string) => void): HTMLElement => {
    const sel = h('select', {}, ...opts.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = value;
    sel.addEventListener('change', () => onInput(sel.value));
    return sel;
  };
  const num = (value: number, min: number, max: number, onInput: (v: number) => void): HTMLElement => {
    const i = h('input', { type: 'number', min, max, value, step: 1 });
    i.addEventListener('change', () => onInput(Math.min(max, Math.max(min, +i.value || min))));
    return i;
  };

  function draw(): void {
    body.replaceChildren();
    if (tab === 'General') {
      const swatches = h('span', { class: 'k-set-ctl' }, ...ACCENTS.map((p) => h('button', { class: 'k-swatch', style: { background: p.hex }, tip: p.name, 'aria-label': p.name, onclick: () => (set('accent', p.hex), draw()) })));
      const color = h('input', { type: 'color', value: s.get('accent') });
      color.addEventListener('input', () => set('accent', color.value));
      body.append(
        row(t('settings.uiScale'), t('settings.uiScale.tip'), h('span', { class: 'k-set-ctl' }, range(SCALE_MIN, SCALE_MAX, 0.05, s.get('uiScale'), (v) => set('uiScale', v), (v) => `${Math.round(v * 100)}%`), ...SCALE_PRESETS.map((p) => h('button', { class: 'k-flat', 'aria-label': `${Math.round(p * 100)}%`, onclick: () => (set('uiScale', p), draw()) }, `${Math.round(p * 100)}`)))),
        row(t('settings.density'), t('settings.density'), select(s.get('density'), [['compact', t('settings.density.compact')], ['comfortable', t('settings.density.comfortable')]], (v) => set('density', v as 'compact' | 'comfortable'))),
        row(t('settings.theme'), t('settings.theme'), select(s.get('theme'), [['dark', t('settings.theme.dark')], ['light', t('settings.theme.light')], ['system', t('settings.theme.system')]], (v) => set('theme', v as 'dark' | 'light' | 'system'))),
        row(t('settings.language'), t('settings.language'), select(getLocale(), availableLocales().map((id): [string, string] => [id, LANG_NAMES[id] ?? id]), (v) => (setLocale(v), set('language', v)))),
        row(t('settings.digits'), t('settings.digits'), select(s.get('digits'), [['latin', t('settings.digits.latin')], ['fa', t('settings.digits.fa')]], (v) => set('digits', v as 'latin' | 'fa'))),
        row(t('settings.accent'), t('settings.accent.tip'), h('span', { class: 'k-set-ctl' }, color, swatches)),
        row(t('settings.reduceMotion'), t('settings.reduceMotion.tip'), check(s.get('reduceMotion'), (v) => set('reduceMotion', v))),
        row(t('settings.units'), t('settings.units.tip'), select(s.get('angleUnit'), [['deg', 'Degrees (°)'], ['rad', 'Radians']], (v) => set('angleUnit', v as 'deg' | 'rad'))),
        row(t('settings.hud'), t('settings.hud.tip'), check(s.get('hud'), (v) => set('hud', v))),
        h('div', { class: 'k-set-row' }, h('button', { onclick: () => app.openKeymapDialog() }, t('settings.keymap.open')), h('button', { onclick: async () => { if (await confirmDialog(t('settings.resetAll'), 'Reset every setting to its default?', { danger: true, ok: t('common.reset') })) { s.reset(); applySettings(app); draw(); toast('Settings reset', { type: 'ok' }); } } }, t('settings.resetAll'))),
      );
    } else if (tab === 'Quality & memory') {
      const budgets: [string, string][] = [['default', t('settings.memory.auto')], ['256', '256 MB'], ['512', '512 MB'], ['1024', '1 GB'], ['2048', '2 GB'], ['4096', '4 GB'], ['8192', '8 GB']];
      body.append(
        row(t('settings.preview'), t('settings.preview.tip'), select(String(s.get('previewQuality')), [['0.125', '12.5%'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']], (v) => set('previewQuality', +v))),
        row(t('settings.adaptive'), t('settings.adaptive.tip'), check(s.get('adaptivePreview'), (v) => set('adaptivePreview', v))),
        row(t('settings.budgetMs'), t('settings.adaptive.tip'), range(2, 33, 1, s.get('budgetMs'), (v) => set('budgetMs', v), (v) => `${v} ms`)),
        row(t('settings.memory'), t('settings.memory.tip'), select(s.get('budgetMB') ? String(s.get('budgetMB')) : 'default', budgets, (v) => set('budgetMB', v === 'default' ? null : +v))),
        row(t('settings.warmup'), 'Builds all shader pipelines in the background after a project is opened (avoids stutter on first use).', check(s.get('warmup'), (v) => set('warmup', v))),
        h('div', { class: 'k-set-note k-dim' }, `GPU: ${eng.gpu.caps.adapter.vendor || '—'} ${eng.gpu.caps.adapter.architecture || ''} · max texture ${eng.gpu.caps.limits.maxTextureDimension2D ?? '?'} px · timestamps ${eng.gpu.caps.has.timestampQuery ? 'yes' : 'no'}`),
      );
    } else {
      body.append(
        row(t('settings.autosave'), 'Writes the project to IndexedDB while you work; used for crash recovery.', check(s.get('autosave'), (v) => set('autosave', v))),
        row(t('settings.autosaveInterval'), 'Seconds of inactivity before the autosave is written.', num(s.get('autosaveSec'), 1, 600, (v) => set('autosaveSec', v))),
      );
    }
  }
  const tabs = new TabStrip(['General', 'Quality & memory', 'Project'], tab, (x) => ((tab = x), draw()));
  draw();
  void showModal({ title: t('settings.title'), body: h('div', {}, tabs.el, body), width: '43.333rem', buttons: [{ label: t('common.close'), value: 'close', primary: true }] });
}

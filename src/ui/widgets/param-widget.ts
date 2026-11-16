import { trTerm } from '../../shared/i18n';
import { openSplineEditor, splineSummary } from './spline-editor';
import { t } from '../../shared/i18n';
import type { SplineValue } from '../../engine/params/schema';
import { tipOf } from './param-tip';
import { prefs } from '../../shared/prefs';
import type { ParamDef, ParamValue } from '../../engine/params/schema';
import type { RGBA } from '../../shared/util';
import { h } from '../core/dom';
import { assetUi } from './asset-hooks';
import { ColorSwatch } from './color';
import { Checkbox, Dropdown, Segmented } from './controls';
import { createCurveWidget } from './curve';
import './curve-editor'; // registers the real curve widget (replaces the read-only preview)
import { GradientEditor } from './gradient';
import { NumberField } from './number-field';
import type { WidgetCallbacks } from './types';
import { SeedField, VecFields } from './vec';

/** Type-erased widget used by the Properties panel (one per ParamDef). */
export interface ParamWidget {
  el: HTMLElement;
  set(v: ParamValue): void;
  setMixed(m: boolean): void;
  setDisabled(d: boolean): void;
  dispose(): void;
  /** the curve editor behind a `curve` param (histogram backdrop via `setHistogram`). */
  curve?: { setHistogram?(bins: ArrayLike<number> | null): void };
}

/** Soft range defaults: explicit soft range > hard range > a heuristic around the default value. */
function softRange(d: { min?: number; max?: number; softMin?: number; softMax?: number; default: number }): { softMin: number; softMax: number } {
  const lo = d.softMin ?? d.min;
  const hi = d.softMax ?? d.max;
  if (lo !== undefined && hi !== undefined) return { softMin: lo, softMax: hi };
  const ref = Math.max(1, Math.abs(d.default) * 2);
  return { softMin: lo ?? (d.min === undefined ? -ref : 0), softMax: hi ?? ref };
}

/** Build the right editor widget for a param definition (the full ParamSchema -> widget mapping). */
export function createParamWidget(def: ParamDef, value: ParamValue, cb: WidgetCallbacks<ParamValue>): ParamWidget {
  const wrap = <W extends { el: HTMLElement; dispose(): void; set(v: never): void; setMixed?(m: boolean): void; setDisabled?(d: boolean): void }>(w: W, conv?: (v: ParamValue) => unknown): ParamWidget => ({
    el: w.el,
    set: (v) => w.set((conv ? conv(v) : v) as never),
    setMixed: (m) => w.setMixed?.(m),
    setDisabled: (d) => w.setDisabled?.(d),
    dispose: () => w.dispose(),
  });
  const base = { onBegin: cb.onBegin, onEnd: cb.onEnd };
  let pw: ParamWidget;
  switch (def.type) {
    case 'float': {
      const rad = def.display === 'angle' && prefs.angleUnit === 'rad';
    const pct = def.display === 'percent';
      const nf = new NumberField(
        { value: value as number, min: def.min, max: def.max, ...softRange(def), step: def.step ?? (pct ? 0.01 : 0.01), precision: def.precision ?? (pct ? 1 : 3), scale: pct ? 100 : rad ? Math.PI / 180 : 1, unit: pct ? '%' : def.display === 'angle' ? (rad ? 'rad' : '°') : def.unit, tip: tipOf(def) },
        { ...base, onInput: (v) => cb.onInput?.(v) },
      );
      pw = wrap(nf);
      break;
    }
    case 'int': {
      const nf = new NumberField({ value: value as number, integer: true, min: def.min, max: def.max, ...softRange(def), step: def.step ?? 1, unit: def.unit, tip: tipOf(def) }, { ...base, onInput: (v) => cb.onInput?.(v) });
      pw = wrap(nf);
      break;
    }
    case 'bool':
      pw = wrap(new Checkbox({ value: value as boolean, tip: tipOf(def) }, { onInput: (v) => cb.onInput?.(v) }));
      break;
    case 'enum': {
      const short = def.options.length <= 3 && def.options.reduce((a, o) => a + o.label.length, 0) <= 22;
      if (short) {
        const sg = new Segmented<string>({ options: def.options.map((o) => ({ value: o.value, label: trTerm(o.label), tip: o.tooltip })), value: value as string }, { onInput: (v) => cb.onInput?.(v) });
        pw = { el: sg.el, set: (v) => sg.set(v as string), setMixed: () => {}, setDisabled: () => {}, dispose: () => sg.dispose() };
      } else pw = wrap(new Dropdown({ options: def.options.map((o) => ({ value: o.value, label: trTerm(o.label) })), value: value as string, tip: tipOf(def) }, { onInput: (v) => cb.onInput?.(v) }));
      break;
    }
    case 'vec2':
    case 'vec3': {
      const n = def.type === 'vec2' ? 2 : 3;
      const vf = new VecFields(n, { integer: def.integer, min: def.min, max: def.max, ...softRange({ ...def, default: def.default[0] }), step: def.step ?? 0.01, labels: def.labels as string[] | undefined, unit: def.unit, linkable: def.type === 'vec2' && def.linkable, precision: def.integer ? 0 : 3 }, { ...base, onInput: (v) => cb.onInput?.(v) });
      vf.set(value as number[]);
      pw = wrap(vf);
      break;
    }
    case 'color': {
      const sw = new ColorSwatch({ value: value as RGBA, hdr: def.hdr }, { ...base, onInput: (v) => cb.onInput?.(v) });
      pw = wrap(sw);
      break;
    }
    case 'seed':
      pw = wrap(new SeedField(value as number, { onInput: (v) => cb.onInput?.(v) }));
      break;
    case 'gradient': {
      const ge = new GradientEditor(value as never, { ...base, onInput: (v) => cb.onInput?.(v as ParamValue) });
      pw = wrap(ge);
      break;
    }
    case 'curve': {
      const cw = createCurveWidget(value as never, { ...base, onInput: (v) => cb.onInput?.(v as ParamValue) });
      pw = { ...wrap(cw), curve: cw };
      break;
    }
    case 'string': {
      const inp = def.multiline ? h('textarea', { rows: '3', style: { width: '100%' } }) : h('input', { type: 'text', style: { width: '100%' } });
      inp.classList.add('k-text');
      (inp as HTMLInputElement).value = value as string;
      inp.addEventListener('change', () => cb.onInput?.((inp as HTMLInputElement).value));
      inp.addEventListener('keydown', (e) => e.stopPropagation());
      pw = { el: inp, set: (v) => ((inp as HTMLInputElement).value = String(v ?? '')), setMixed: (m) => ((inp as HTMLInputElement).placeholder = m ? '—' : ''), setDisabled: () => {}, dispose: () => {} };
      break;
    }
    case 'spline': {
      // Points table + tools + presets in the Spline editor window (Edit...); the 2D / 3D viewport gizmo edits the same value.
      const label = h('span', { class: 'k-dim', style: { flex: '1' } });
      let current = value;
      const show = (v: ParamValue): void => {
        current = v;
        label.textContent = splineSummary(v as { points?: unknown[]; closed?: boolean } | null);
      };
      show(value);
      const isProfile = def.id.includes('profile');
      const btnText = isProfile ? t('spline.profileEditor') : t('spline.edit');
      const btn = h('button', { class: 'k-btn', tip: btnText }, btnText);
      btn.addEventListener('click', () =>
        openSplineEditor({
          title: def.label,
          value: current as unknown as SplineValue,
          minPoints: def.minPoints ?? 2,
          dim3: !!(current as unknown as SplineValue)?.points?.some((q) => q.attrs && 'z' in q.attrs),
          profile: isProfile,
          onBegin: () => cb.onBegin?.(),
          onChange: (v) => (show(v as unknown as ParamValue), cb.onInput?.(v as unknown as ParamValue)),
          onEnd: () => cb.onEnd?.(),
        }),
      );
      pw = { el: h('div', { class: 'k-drop', style: { cursor: 'default', display: 'flex', alignItems: 'center', gap: '0.5rem' } }, label, btn), set: show, setMixed: () => {}, setDisabled: () => {}, dispose: () => {} };
      break;
    }
    case 'asset': {
      const label = h('span', { class: 'k-dim', style: { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } });
      const btn = h('button', { class: 'k-btn', tip: t('paramWidget.importAFileOr'), style: { marginInlineStart: '0.5rem' } }, 'Import…');
      const el = h('div', { class: 'k-drop', style: { cursor: 'default', display: 'flex', alignItems: 'center' } }, label, btn);
      btn.addEventListener('click', () => {
        assetUi.onPicked = (ref) => cb.onInput?.(ref as unknown as ParamValue);
        void assetUi.hooks?.pick(def.type === 'asset' ? def.kind : 'any', btn);
      });
      const show = (v: ParamValue): void => void (label.textContent = (v as { name?: string; assetId?: string } | null)?.name ?? (v as { assetId?: string } | null)?.assetId ?? 'None');
      show(value);
      pw = { el, set: show, setMixed: () => {}, setDisabled: (d) => void ((btn as HTMLButtonElement).disabled = d), dispose: () => {} };
      break;
    }
  }
  pw.set(value);
  return pw;
}

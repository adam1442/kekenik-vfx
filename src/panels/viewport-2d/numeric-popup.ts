import { h } from '../../ui/core/dom';
import type { NumericField } from '../../gizmos';

/**
 * Small popup for numeric gizmo entry (double-click a handle). Each field commits on Enter/blur as ONE undo step;
 * Esc or a click outside closes it. `commit` returns after applying (the caller refreshes its models).
 */
export function showNumericPopup(stage: HTMLElement, at: [number, number], title: string, fields: NumericField[], commit: (fieldId: string, value: number) => void, onClose: () => void): () => void {
  const el = h('div', { class: 'k-gz-num' }, h('div', { class: 'title' }, title));
  const inputs: HTMLInputElement[] = [];
  fields.forEach((f, idx) => {
    const inp = h('input', { type: 'text', value: String(+f.value.toFixed(5)), spellcheck: 'false' }) as HTMLInputElement;
    inputs.push(inp);
    const apply = (): void => {
      const v = Number(inp.value.replace(',', '.'));
      if (Number.isFinite(v) && Math.abs(v - f.value) > 1e-9) {
        commit(f.id, v);
        f.value = v;
      }
    };
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        apply();
        if (idx === fields.length - 1) close();
        else inputs[idx + 1].select();
      } else if (e.key === 'Escape') close();
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const st = (f.step ?? 0.01) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        inp.value = String(+(Number(inp.value) + st).toFixed(5));
        apply();
      }
    });
    inp.addEventListener('blur', apply);
    el.append(h('label', {}, f.label), inp, h('span', { class: 'k-dim' }, f.unit));
  });
  const rect = stage.getBoundingClientRect();
  el.style.left = `${Math.max(4, Math.min(at[0] + 14, rect.width - 220))}px`;
  el.style.top = `${Math.max(4, Math.min(at[1] + 10, rect.height - 40 - fields.length * 28))}px`;
  stage.append(el);
  const away = (e: PointerEvent): void => {
    if (!el.contains(e.target as Node)) close();
  };
  let closed = false;
  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener('pointerdown', away, true);
    el.remove();
    onClose();
  }
  setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
  inputs[0]?.focus();
  inputs[0]?.select();
  return close;
}

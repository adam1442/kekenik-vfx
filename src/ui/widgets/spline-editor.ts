import { cloneValue, type SplineValue } from '../../engine/params/schema';
import { v2, type V2 } from '../../gizmos/geom';
import { sampleSpline, resolveHandles } from '../../gizmos/spline';
import {
  applyAddTool,
  applyDeleteTool,
  convertMode,
  deletePoints,
  flipDirection,
  hitPoint,
  hitTestAdd,
  insertAtParam,
  mirror,
  normalizeProfile,
  presetSpline,
  setClosed,
  SPLINE_PRESETS,
  validateProfile,
  type SplinePreset,
  type TangentMode,
} from '../../engine/spline/ops';
import { t, tr } from '../../shared/i18n';
import { h } from '../core/dom';
import { showMenu as coreMenu, type MenuItem } from '../core/menu';
import { showModal } from '../core/overlay';
import { themeColor } from '../theme/ui-store';

export interface SplineEditorOpts {
  title: string;
  value: SplineValue;
  minPoints: number;
  /** 3D path (z / scale / twist attrs are shown in the table; the canvas edits the XY projection). */
  dim3: boolean;
  /** Show the normalised live profile + validation (Sweep profile). */
  profile: boolean;
  onBegin(): void;
  onChange(v: SplineValue): void;
  onEnd(): void;
}

type Tool = 'select' | 'add' | 'delete';

/** Summary line used by the Properties panel. */
export const splineSummary = (v: { points?: unknown[]; closed?: boolean } | null): string => t('spline.summary', { n: v?.points?.length ?? 0, closed: v?.closed ? t('spline.closedSuffix') : '' });

/**
 * Spline editor: a canvas (tools Select / Add / Delete, box-free multi-select with Ctrl, handles, snap, symmetric edit, context menu)
 * + a Points table (add / remove / reorder rows, numeric fields, tangent mode, width) + presets. Opened as a modal window from the
 * Properties panel ("Edit…") and used as the Sweep Profile Editor. All edits go through onBegin / onChange / onEnd, so the host
 * coalesces them into one undo step per gesture.
 */
export function openSplineEditor(o: SplineEditorOpts): void {
  let value = cloneValue(o.value) as SplineValue;
  let tool: Tool = 'select';
  let sel = new Set<number>();
  let snap = true;
  let symmetric = false;
  // view: world rect centred on the data
  let view = frameOf(value, o.dim3);
  const canvas = h('canvas', { class: 'k-spl-canvas', tabindex: '0', width: 520, height: 380 });
  const preview = h('canvas', { class: 'k-spl-preview', width: 120, height: 120 });
  const msgs = h('div', { class: 'k-spl-msgs k-dim' });
  const tableHost = h('div', { class: 'k-spl-table' });
  const hint = h('div', { class: 'k-dim k-spl-hint' }, t('spline.hint'));
  const minPts = Math.max(0, o.minPoints);

  const commit = (v: SplineValue, gesture = true): void => {
    if (gesture) o.onBegin();
    value = v;
    o.onChange(cloneValue(v) as SplineValue);
    if (gesture) o.onEnd();
    refresh();
  };
  const live = (v: SplineValue): void => {
    value = v;
    o.onChange(cloneValue(v) as SplineValue);
    draw();
  };

  /* ---- coordinate transforms (canvas pixel <-> spline units) */
  const W = (): number => canvas.width;
  const H = (): number => canvas.height;
  const scale = (): number => Math.min(W() / view.w, H() / view.h);
  const toScreen = (p: V2): V2 => [(p[0] - view.x) * scale() + (W() - view.w * scale()) / 2, (p[1] - view.y) * scale() + (H() - view.h * scale()) / 2];
  const toWorld = (s: V2): V2 => [(s[0] - (W() - view.w * scale()) / 2) / scale() + view.x, (s[1] - (H() - view.h * scale()) / 2) / scale() + view.y];
  const gridStep = (): number => niceStep(view.w / 8);
  const snapV = (p: V2): V2 => (snap ? [Math.round(p[0] / gridStep()) * gridStep(), Math.round(p[1] / gridStep()) * gridStep()] : p);
  const tol = (): number => 9 / scale();
  const evPos = (e: PointerEvent | MouseEvent): V2 => {
    const r = canvas.getBoundingClientRect();
    return toWorld([((e.clientX - r.left) / r.width) * W(), ((e.clientY - r.top) / r.height) * H()]);
  };

  /* ---- drawing (colours from theme tokens; redrawn on theme change) */
  function draw(): void {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W(), H());
    ctx.fillStyle = themeColor('bg1', '#17191d');
    ctx.fillRect(0, 0, W(), H());
    // grid
    const gs = gridStep();
    ctx.lineWidth = 1;
    ctx.strokeStyle = themeColor('line', '#2b2f36');
    ctx.beginPath();
    for (let x = Math.floor((view.x - view.w) / gs) * gs; x <= view.x + view.w * 2; x += gs) {
      const a = toScreen([x, 0])[0];
      ctx.moveTo(a, 0);
      ctx.lineTo(a, H());
    }
    for (let y = Math.floor((view.y - view.h) / gs) * gs; y <= view.y + view.h * 2; y += gs) {
      const b = toScreen([0, y])[1];
      ctx.moveTo(0, b);
      ctx.lineTo(W(), b);
    }
    ctx.stroke();
    // curve
    const smp = sampleSpline(value, 24).pts.map(toScreen);
    ctx.strokeStyle = themeColor('accent', '#7c6cf0');
    ctx.lineWidth = 2;
    ctx.beginPath();
    smp.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if (value.closed && smp.length > 2) ctx.closePath();
    ctx.stroke();
    // handles of selected points
    ctx.lineWidth = 1;
    for (const i of sel) {
      const p = value.points[i];
      if (!p || p.mode === 'corner') continue;
      const hh = resolveHandles(value, i);
      const a = toScreen([p.x, p.y]);
      for (const hv of [hh.hin, hh.hout]) {
        const b = toScreen([p.x + hv[0], p.y + hv[1]]);
        ctx.strokeStyle = themeColor('dim', '#7b828d');
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        ctx.fillStyle = themeColor('accent2', '#9a8dff');
        ctx.beginPath();
        ctx.arc(b[0], b[1], 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // anchors
    value.points.forEach((p, i) => {
      const s = toScreen([p.x, p.y]);
      ctx.fillStyle = sel.has(i) ? themeColor('accent', '#7c6cf0') : themeColor('bg3', '#262a30');
      ctx.strokeStyle = themeColor('text', '#d8dbe0');
      ctx.fillRect(s[0] - 4, s[1] - 4, 8, 8);
      ctx.strokeRect(s[0] - 4, s[1] - 4, 8, 8);
      ctx.fillStyle = themeColor('dim', '#7b828d');
      ctx.font = '10px ui-sans-serif, system-ui';
      ctx.fillText(String(i + 1), s[0] + 6, s[1] - 6);
    });
    drawPreview();
  }

  function drawPreview(): void {
    if (!o.profile) return;
    const c = preview.getContext('2d')!;
    c.clearRect(0, 0, preview.width, preview.height);
    c.fillStyle = themeColor('bg2', '#1e2126');
    c.fillRect(0, 0, preview.width, preview.height);
    const n = normalizeProfile(value).value;
    const pts = sampleSpline(n, 16).pts;
    c.strokeStyle = themeColor('accent', '#7c6cf0');
    c.fillStyle = themeColor('accent-bg', '#2c2860');
    c.lineWidth = 2;
    c.beginPath();
    pts.forEach((p, i) => (i ? c.lineTo(10 + p[0] * 100, 10 + p[1] * 100) : c.moveTo(10 + p[0] * 100, 10 + p[1] * 100)));
    if (n.closed) {
      c.closePath();
      c.fill();
    }
    c.stroke();
  }

  /* ---- interactions */
  let drag: { kind: 'point' | 'hin' | 'hout'; index: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.focus();
    const p = evPos(e);
    // handle drag
    for (const i of sel) {
      const pt = value.points[i];
      if (!pt || pt.mode === 'corner') continue;
      const hh = resolveHandles(value, i);
      for (const k of ['hin', 'hout'] as const) {
        const hp: V2 = [pt.x + hh[k][0], pt.y + hh[k][1]];
        if (v2.len(v2.sub(hp, p)) <= tol()) {
          o.onBegin();
          drag = { kind: k, index: i, moved: false };
          canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
    }
    if (tool === 'add') {
      const r = applyAddTool(value, p, tol());
      if (r.value !== value) {
        const snapped = r.value.points[r.index] && hitTestAdd(value, p, tol())?.kind !== 'segment' ? snapPoint(r.value, r.index, snapV(p)) : r.value;
        commit(snapped);
      }
      sel = new Set([r.index]);
      refresh();
      return;
    }
    if (tool === 'delete') {
      const next = applyDeleteTool(value, p, tol(), minPts);
      if (next !== value) {
        sel.clear();
        commit(next);
      }
      return;
    }
    const hit = hitPoint(value, p, tol());
    if (hit >= 0) {
      if (e.ctrlKey || e.metaKey) sel.has(hit) ? sel.delete(hit) : sel.add(hit);
      else if (!sel.has(hit)) sel = new Set([hit]);
      o.onBegin();
      drag = { kind: 'point', index: hit, moved: false };
      canvas.setPointerCapture(e.pointerId);
      refresh();
    } else if (!(e.ctrlKey || e.metaKey)) {
      sel.clear();
      refresh();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = evPos(e);
    const v = cloneValue(value) as SplineValue;
    const pt = v.points[drag.index];
    drag.moved = true;
    if (drag.kind === 'point') {
      const q = snapV(p);
      const dx = q[0] - value.points[drag.index].x;
      const dy = q[1] - value.points[drag.index].y;
      for (const i of sel.size ? sel : new Set([drag.index])) {
        v.points[i].x += dx;
        v.points[i].y += dy;
      }
      if (symmetric) {
        const j = value.closed ? (v.points.length - drag.index) % v.points.length : v.points.length - 1 - drag.index;
        if (j !== drag.index && v.points[j]) {
          v.points[j].x = 1 - v.points[drag.index].x;
          v.points[j].y = v.points[drag.index].y;
        }
      }
    } else {
      const rel: V2 = v2.sub(p, [pt.x, pt.y]);
      const cur = resolveHandles(value, drag.index);
      const other = drag.kind === 'hin' ? cur.hout : cur.hin;
      pt.mode = 'free';
      const len = v2.len(rel) || 1e-9;
      const ol = v2.len(other);
      const mirrored: V2 = e.altKey ? other : v2.mul(rel, -(ol || len) / len);
      pt.hin = drag.kind === 'hin' ? rel : mirrored;
      pt.hout = drag.kind === 'hout' ? rel : mirrored;
    }
    live(v);
  });
  const endDrag = (): void => {
    if (!drag) return;
    drag = null;
    o.onEnd();
    refresh();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('dblclick', (e) => {
    const hit = hitTestAdd(value, evPos(e), tol());
    if (hit?.kind === 'segment') {
      const r = insertAtParam(value, hit.seg, hit.t);
      sel = new Set([r.index]);
      commit(r.value);
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = evPos(e);
    const k = Math.exp(e.deltaY * 0.001);
    view = { x: p[0] - (p[0] - view.x) * k, y: p[1] - (p[1] - view.y) * k, w: view.w * k, h: view.h * k };
    draw();
  }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
      e.preventDefault();
      const next = deletePoints(value, [...sel], minPts);
      sel.clear();
      commit(next);
    } else if (e.key === 'v' || e.key === 'V') setTool('select');
    else if (e.key === 'a' || e.key === 'A') setTool('add');
    else if (e.key === 'x' || e.key === 'X') setTool('delete');
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = evPos(e);
    const hit = hitTestAdd(value, p, tol());
    const items: Array<[string, () => void]> = [];
    if (hit?.kind === 'segment') items.push([t('spline.insert'), () => (sel = new Set([insertAtParam(value, hit.seg, hit.t).index]), commit(insertAtParam(value, hit.seg, hit.t).value))]);
    if (hit?.kind === 'point') {
      const i = hit.index;
      if (!sel.has(i)) sel = new Set([i]);
      items.push([t('spline.delete'), () => commit(deletePoints(value, [...sel], minPts))]);
      for (const m of ['corner', 'auto', 'free'] as const) items.push([t(m === 'corner' ? 'spline.convert.corner' : m === 'auto' ? 'spline.convert.smooth' : 'spline.convert.free'), () => commit(convertMode(value, [...sel], m))]);
    }
    items.push([value.closed ? t('spline.open') : t('spline.close'), () => commit(setClosed(value, !value.closed))]);
    coreMenu(items.map(([label, action]): MenuItem => ({ label, action })), e.clientX, e.clientY);
  });

  /* ---- toolbar + table */
  const toolBtn = (id: Tool, label: string, tip: string): HTMLButtonElement => h('button', { class: 'k-flat k-spl-tool', 'data-tool': id, tip, 'aria-label': tip, onclick: () => setTool(id) }, label);
  const toolbar = h(
    'div',
    { class: 'k-spl-toolbar' },
    toolBtn('select', '⬚ V', t('spline.tool.select')),
    toolBtn('add', '＋ A', t('spline.tool.add')),
    toolBtn('delete', '− X', t('spline.tool.delete')),
    h('button', { class: 'k-flat', tip: t('spline.convert.corner'), onclick: () => commit(convertMode(value, selOrAll(), 'corner')) }, t('spline.convert.corner')),
    h('button', { class: 'k-flat', tip: t('spline.convert.smooth'), onclick: () => commit(convertMode(value, selOrAll(), 'auto')) }, t('spline.convert.smooth')),
    h('button', { class: 'k-flat', tip: t('spline.close'), onclick: () => commit(setClosed(value, !value.closed)) }, `${t('spline.close')} / ${t('spline.open')}`),
    h('button', { class: 'k-flat', tip: t('spline.flip'), onclick: () => commit(flipDirection(value)) }, t('spline.flip')),
    h('button', { class: 'k-flat', tip: t('spline.mirror'), onclick: () => commit(mirror(value, 'x')) }, t('spline.mirror')),
    h('button', { class: 'k-flat', tip: t('spline.frame'), onclick: () => ((view = frameOf(value, o.dim3)), draw()) }, t('spline.frame')),
    checkbox(t('spline.snap'), snap, (v) => (snap = v)),
    ...(o.profile ? [checkbox(t('spline.symmetric'), symmetric, (v) => (symmetric = v))] : []),
  );
  const presetSel = h('select', { class: 'k-flat', 'aria-label': t('spline.preset') }, h('option', { value: '' }, t('spline.preset')), ...SPLINE_PRESETS.map((p) => h('option', { value: p }, tr(`spline.preset.${p}`, p))));
  presetSel.addEventListener('change', () => {
    if (!presetSel.value) return;
    const pv = presetSpline(presetSel.value as SplinePreset, o.dim3 ? 0 : 0.5, o.dim3 ? 0 : 0.5, o.dim3 ? 1 : 0.35);
    if (o.dim3) pv.points.forEach((q) => (q.attrs = { z: 0, scale: 1, twist: 0 }));
    sel.clear();
    commit(pv);
    view = frameOf(value, o.dim3);
    presetSel.value = '';
    draw();
  });

  function selOrAll(): number[] {
    return sel.size ? [...sel] : value.points.map((_, i) => i);
  }
  function setTool(x: Tool): void {
    tool = x;
    toolbar.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === x));
    canvas.style.cursor = x === 'select' ? 'default' : 'crosshair';
  }
  function buildTable(): void {
    const num = (get: () => number, set: (v: number) => void, label: string): HTMLInputElement => {
      const i = h('input', { type: 'number', step: '0.01', value: String(round(get())), 'aria-label': label, dir: 'ltr' });
      i.addEventListener('focus', () => o.onBegin());
      i.addEventListener('change', () => {
        const n = Number(i.value);
        if (Number.isFinite(n)) set(n);
      });
      i.addEventListener('blur', () => o.onEnd());
      i.addEventListener('keydown', (e) => e.stopPropagation());
      return i;
    };
    const edit = (fn: (v: SplineValue) => void): void => {
      const v = cloneValue(value) as SplineValue;
      fn(v);
      value = v;
      o.onChange(cloneValue(v) as SplineValue);
      draw();
    };
    const head = h('tr', {}, h('th', {}, '#'), h('th', {}, 'X'), h('th', {}, 'Y'), ...(o.dim3 ? [h('th', {}, 'Z'), h('th', {}, t('spline.col.scale')), h('th', {}, t('spline.col.twist'))] : [h('th', {}, t('spline.col.width'))]), h('th', {}, t('spline.col.mode')), h('th', {}, ''));
    const rows = value.points.map((p, i) => {
      const modeSel = h('select', { 'aria-label': t('spline.col.mode') }, ...(['auto', 'corner', 'free'] as TangentMode[]).map((m) => h('option', { value: m }, m === 'auto' ? t('spline.convert.smooth') : m === 'corner' ? t('spline.convert.corner') : t('spline.convert.free'))));
      modeSel.value = p.mode ?? 'auto';
      modeSel.addEventListener('change', () => commit(convertMode(value, [i], modeSel.value as TangentMode)));
      const attr = (k: string, d: number) => num(() => p.attrs?.[k] ?? d, (n) => edit((v) => ((v.points[i].attrs ??= {})[k] = n)), k);
      const btn = (label: string, tip: string, fn: () => void): HTMLButtonElement => h('button', { class: 'k-flat', tip, 'aria-label': tip, onclick: fn }, label);
      return h(
        'tr',
        { class: sel.has(i) ? 'sel' : '', onclick: () => ((sel = new Set([i])), draw()) },
        h('td', {}, String(i + 1)),
        h('td', {}, num(() => p.x, (n) => edit((v) => (v.points[i].x = n)), 'x')),
        h('td', {}, num(() => p.y, (n) => edit((v) => (v.points[i].y = n)), 'y')),
        ...(o.dim3 ? [h('td', {}, attr('z', 0)), h('td', {}, attr('scale', 1)), h('td', {}, attr('twist', 0))] : [h('td', {}, num(() => p.w ?? 0, (n) => edit((v) => (v.points[i].w = Math.max(0, n))), 'w'))]),
        h('td', {}, modeSel),
        h('td', { class: 'k-spl-rowbtns' }, btn('↑', t('spline.moveUp'), () => i > 0 && commit(swap(value, i, i - 1))), btn('↓', t('spline.moveDown'), () => i < value.points.length - 1 && commit(swap(value, i, i + 1))), btn('✕', t('spline.delete'), () => commit(deletePoints(value, [i], minPts)))),
      );
    });
    const add = h('button', { onclick: () => commit(addAtEnd(value, o.dim3)) }, t('spline.addPoint'));
    tableHost.replaceChildren(h('table', { class: 'k-table' }, h('thead', {}, head), h('tbody', {}, ...rows)), h('div', { class: 'k-toolrow' }, add, presetSel));
  }
  function refresh(): void {
    buildTable();
    const issues = o.profile ? validateProfile(value) : [];
    msgs.textContent = issues.map((i) => t(`spline.issue.${i}` as 'spline.issue.tooFewPoints')).join('  ');
    draw();
  }
  const offUi = (): void => draw();
  window.addEventListener('kk-ui-change', offUi);

  setTool('select');
  refresh();
  const body = h('div', { class: 'k-spl-editor' }, toolbar, h('div', { class: 'k-spl-main' }, canvas, ...(o.profile ? [h('div', { class: 'k-spl-side' }, h('div', { class: 'k-dim' }, t('spline.preview')), preview)] : [])), msgs, hint, tableHost);
  void showModal({ title: t('spline.editor.title', { name: o.title }), body, width: '60rem', buttons: [{ label: t('common.close'), value: 'close', primary: true }] }).then(() => window.removeEventListener('kk-ui-change', offUi));
}

/* ----------------------------------------------------------------------------------------------- helpers */
function frameOf(v: SplineValue, dim3: boolean): { x: number; y: number; w: number; h: number } {
  if (!dim3 && v.points.length < 1) return { x: -0.1, y: -0.1, w: 1.2, h: 1.2 };
  if (!dim3) return { x: -0.1, y: -0.1, w: 1.2, h: 1.2 };
  const xs = v.points.map((p) => p.x);
  const ys = v.points.map((p) => p.y);
  const minX = Math.min(...xs, -0.5);
  const maxX = Math.max(...xs, 0.5);
  const minY = Math.min(...ys, -0.5);
  const maxY = Math.max(...ys, 0.5);
  const m = Math.max(maxX - minX, maxY - minY) * 0.6;
  return { x: (minX + maxX) / 2 - m, y: (minY + maxY) / 2 - m, w: m * 2, h: m * 2 };
}
const niceStep = (raw: number): number => {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-6)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
};
const round = (n: number): number => Math.round(n * 10000) / 10000;
function swap(v: SplineValue, a: number, b: number): SplineValue {
  const c = cloneValue(v) as SplineValue;
  [c.points[a], c.points[b]] = [c.points[b], c.points[a]];
  return c;
}
function snapPoint(v: SplineValue, i: number, p: V2): SplineValue {
  const c = cloneValue(v) as SplineValue;
  c.points[i].x = p[0];
  c.points[i].y = p[1];
  return c;
}
function addAtEnd(v: SplineValue, dim3: boolean): SplineValue {
  const c = cloneValue(v) as SplineValue;
  const last = c.points[c.points.length - 1];
  const prev = c.points[c.points.length - 2];
  const d: V2 = last && prev ? [last.x - prev.x, last.y - prev.y] : [0.1, 0];
  c.points.push({ x: (last?.x ?? 0.5) + d[0], y: (last?.y ?? 0.5) + d[1], mode: 'auto', ...(dim3 ? { attrs: { z: last?.attrs?.z ?? 0, scale: 1, twist: 0 } } : {}) });
  return c;
}
function checkbox(label: string, value: boolean, on: (v: boolean) => void): HTMLElement {
  const i = h('input', { type: 'checkbox' });
  i.checked = value;
  i.addEventListener('change', () => on(i.checked));
  return h('label', { class: 'k-spl-check' }, i, label);
}

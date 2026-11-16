import { animOf } from '../../app/anim';
import { animatedParams } from '../../engine/anim/animator';
import {
  channelRange, evalChannel, flattenKeys, loopMatch, loopError, mirrorKeys, moveKeys, removeKeys, resolveSlopes, segmentBezier, setInterp, setKey, setTangent, setTangentMode, smoothKeys,
  EXTRAPOLATIONS, type Channel, type Extrapolation, type TangentMode,
} from '../../engine/anim/keyframes';
import { channelLabels, type AnimTrack, type NumTrack } from '../../engine/anim/tracks';
import { Disposer, dragPointer, h, observeSize } from '../../ui/core/dom';
import { contextMenu } from '../../ui/core/menu';
import { definePanelView } from '../../ui/dock/panel-lazy';
import './anim-curves.css';

import { t as tt } from '../../shared/i18n';
interface Curve {
  id: string;
  nodeId: string;
  paramId: string;
  index: number;
  label: string;
  color: string;
  track: NumTrack;
  ch: Channel;
}
const PALETTE = ['#ff6b6b', '#5fd38d', '#6aa9ff', '#f7c948', '#c78bff', '#4fd1c5', '#ff9f5a', '#ee7bb8'];
const CH_COLORS: Record<number, string[]> = { 2: ['#ff6b6b', '#5fd38d'], 3: ['#ff6b6b', '#5fd38d', '#6aa9ff'], 4: ['#ff6b6b', '#5fd38d', '#6aa9ff', '#c9cdd6'] };
const keyId = (curveId: string, t: number): string => `${curveId}\u0000${Math.round(t * 1000)}`;

/**
 * ANIMATION CURVE EDITOR: graph-editor style view of the keyframe channels of the selected nodes. Multi-curve display
 * with per-curve colour / visibility, normalize view, bezier tangent handles (auto / smooth / flat / free, break / unify),
 * key tools (flatten, smooth, mirror, LOOP MATCH first / last), extrapolation per curve, cycle preview, frame all / selected.
 * (The 3B param-curve widget keeps editing static Curve params in the `curve-editor` panel; this panel works on time curves and
 * shares its conventions: bezier / linear / step segments and slope-based tangents.)
 */
export const { create } = definePanelView({
  create(host, ctx) {
    const app = ctx.app;
    const pb = app.engine.playback;
    const dis = new Disposer();
    host.classList.add('k-ac');
    host.tabIndex = 0;
    const graph = (): typeof app.project.graph => app.project.graph;
    const anim = (): ReturnType<typeof animOf> => animOf(app);

    const view = { t0: -4, ppf: 8, v0: -0.2, vpp: 120 };
    let normalize = false;
    let cyclePreview = true;
    let showAll = false;
    const hidden = new Set<string>();
    const sel = new Set<string>();
    let curves: Curve[] = [];
    let w = 400;
    let hh = 200;
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;

    const cv = h('canvas') as HTMLCanvasElement;
    const list = h('div', { class: 'k-ac-list' });
    const info = h('div', { class: 'k-ac-info' });
    const bar = h('div', { class: 'k-ac-bar' });
    const stage = h('div', { class: 'k-ac-stage' }, cv);
    host.append(bar, h('div', { class: 'k-ac-main' }, list, stage), info);

    const btn = (txt: string, tip: string, fn: () => void, cls = ''): HTMLButtonElement => h('button', { class: `k-ac-btn ${cls}`, tip, onclick: fn }, txt);
    const sep = (): HTMLElement => h('span', { class: 'sep' });
    const bNorm = btn('Normalize', tt('animCurves.showEveryCurveScaled'), () => { normalize = !normalize; bNorm.classList.toggle('on', normalize); frame(false); });
    const bCycle = btn(tt('animCurves.cyclePreview'), tt('animCurves.showLoopPeriodsAnd'), () => { cyclePreview = !cyclePreview; bCycle.classList.toggle('on', cyclePreview); draw(); });
    bCycle.classList.add('on');
    const preSel = h('select', { tip: tt('animCurves.extrapolationBeforeTheFirst') }, ...EXTRAPOLATIONS.map((e) => h('option', { value: e }, `← ${e.replace('_', ' ')}`))) as HTMLSelectElement;
    const postSel = h('select', { tip: tt('animCurves.extrapolationAfterTheLast') }, ...EXTRAPOLATIONS.map((e) => h('option', { value: e }, `${e.replace('_', ' ')} →`))) as HTMLSelectElement;
    preSel.addEventListener('change', () => setExtrap('pre', preSel.value as Extrapolation));
    postSel.addEventListener('change', () => setExtrap('post', postSel.value as Extrapolation));
    for (const s of [preSel, postSel]) s.addEventListener('keydown', (e) => e.stopPropagation());
    bar.append(
      btn(tt('animCurves.frameAll'), tt('animCurves.frameAllCurvesA'), () => frame(false)), btn(tt('animCurves.frameSelected'), tt('animCurves.frameTheSelectedKeys'), () => frame(true)), bNorm, bCycle, sep(),
      btn('Bezier', tt('animCurves.smoothSegments'), () => editSel((c, i) => setInterp(c, i, 'bezier'))),
      btn('Linear', tt('animCurves.straightSegments'), () => editSel((c, i) => setInterp(c, i, 'linear'))),
      btn('Step', tt('animCurves.constantSteppedSegments'), () => editSel((c, i) => setInterp(c, i, 'constant'))), sep(),
      btn('Auto', tt('animCurves.autoClampedTangents'), () => tangents('auto')), btn('Smooth', tt('animCurves.catmullRomTangents'), () => tangents('smooth')), btn('Flat', tt('animCurves.flatTangents'), () => editSel((c, i) => flattenKeys(c, i))),
      btn('Free', tt('animCurves.freeTangentsDragThe'), () => tangents('free')), btn('Break', tt('animCurves.editInOut'), () => editSel((c, i) => setTangentMode(c, i, 'free', true))), btn('Unify', tt('animCurves.mirrorInOut'), () => editSel((c, i) => setTangentMode(c, i, 'free', false))), sep(),
      btn(tt('animCurves.smoothKeys'), tt('animCurves.autoTangentsBezier'), () => editSel((c, i) => smoothKeys(c, i))),
      btn(tt('animCurves.mirrorV'), tt('animCurves.mirrorValuesAroundTheir'), () => mirror('value')), btn(tt('animCurves.mirrorT'), tt('animCurves.mirrorTimesAroundThe'), () => mirror('time')), sep(),
      btn(tt('animCurves.loopMatch'), tt('animCurves.makeTheLastKey'), () => loop(false), 'accent'),
      btn(tt('animCurves.loopMatchOffset'), tt('animCurves.matchTangentsOnlyKeep'), () => loop(true)), sep(),
      preSel, postSel, sep(), btn('Delete', tt('animCurves.deleteSelectedKeysDel'), () => deleteSel()),
    );

    /* ------------------------------------------------------------------------ curves */
    function rebuild(): void {
      const g = graph();
      const ids = showAll ? [...g.nodes.keys()] : [...app.selection.get()];
      curves = [];
      let n = 0;
      for (const id of ids) {
        const node = g.nodes.get(id);
        if (!node) continue;
        for (const { def, track } of animatedParams(g, id)) {
          if (track.kind !== 'num') continue;
          const labels = channelLabels(def);
          track.ch.forEach((ch, i) => {
            const cid = `${id}|${def.id}|${i}`;
            curves.push({ id: cid, nodeId: id, paramId: def.id, index: i, label: `${node.name} · ${def.label}${labels[i] ? ` ${labels[i]}` : ''}`, color: (CH_COLORS[track.ch.length] ?? PALETTE)[i] ?? PALETTE[n % PALETTE.length], track, ch });
          });
          n++;
        }
      }
      for (const k of [...sel]) if (!curves.some((c) => k.startsWith(`${c.id}\u0000`))) sel.delete(k);
      list.replaceChildren(
        h('label', { class: 'k-ac-all' }, h('input', { type: 'checkbox', checked: showAll, onchange: (e: Event) => { showAll = (e.target as HTMLInputElement).checked; rebuild(); } }), ' all nodes'),
        ...(curves.length ? [] : [h('div', { class: 'k-dim', style: { padding: '0.667rem' } }, 'No animated numeric parameters on the selected node(s). Key a parameter in Properties, then edit its curves here.')]),
        ...curves.map((c) => {
          const row = h('div', { class: `k-ac-item${hidden.has(c.id) ? ' off' : ''}`, tip: tt('animCurves.clickShowHide') },
            h('span', { class: 'sw', style: { background: c.color } }), h('span', { class: 'nm' }, c.label));
          row.addEventListener('click', () => { if (hidden.has(c.id)) hidden.delete(c.id); else hidden.add(c.id); rebuild(); });
          row.addEventListener('dblclick', () => { hidden.clear(); curves.forEach((o) => o !== c && hidden.add(o.id)); rebuild(); });
          return row;
        }),
      );
      draw();
    }
    const visible = (): Curve[] => curves.filter((c) => !hidden.has(c.id));

    /** Value range of a curve in the (optionally normalized) display. */
    const rangeOf = (c: Curve): [number, number] => {
      const g = graph();
      const f0 = Math.min(c.ch.keys[0]?.t ?? 0, 0);
      const f1 = Math.max(c.ch.keys[c.ch.keys.length - 1]?.t ?? 1, g.settings.loopLength);
      const [lo, hi] = channelRange(c.ch, f0, f1);
      return hi - lo < 1e-6 ? [lo - 0.5, hi + 0.5] : [lo, hi];
    };
    const norm = (c: Curve, v: number): number => {
      if (!normalize) return v;
      const [lo, hi] = rangeOf(c);
      return (v - lo) / (hi - lo);
    };
    const denorm = (c: Curve, y: number): number => {
      if (!normalize) return y;
      const [lo, hi] = rangeOf(c);
      return lo + y * (hi - lo);
    };
    const X = (t: number): number => (t - view.t0) * view.ppf;
    const Y = (c: Curve, v: number): number => hh - (norm(c, v) - view.v0) * view.vpp;
    const tOf = (x: number): number => view.t0 + x / view.ppf;
    const yToVal = (c: Curve, y: number): number => denorm(c, view.v0 + (hh - y) / view.vpp);

    function frame(onlySel: boolean): void {
      const list2 = visible();
      let t0 = Infinity;
      let t1 = -Infinity;
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of list2) {
        c.ch.keys.forEach((k) => {
          if (onlySel && !sel.has(keyId(c.id, k.t))) return;
          t0 = Math.min(t0, k.t);
          t1 = Math.max(t1, k.t);
          const y = norm(c, k.v);
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        });
      }
      if (!Number.isFinite(t0)) {
        const g = graph();
        t0 = 0;
        t1 = g.settings.loopLength;
        lo = 0;
        hi = 1;
      }
      if (t1 - t0 < 1) t1 = t0 + 1;
      if (hi - lo < 1e-6) {
        lo -= 0.5;
        hi += 0.5;
      }
      view.ppf = Math.max(0.3, (w - 80) / (t1 - t0));
      view.t0 = t0 - 40 / view.ppf;
      view.vpp = Math.max(1e-3, (hh - 60) / (hi - lo));
      view.v0 = lo - 30 / view.vpp;
      draw();
    }

    /* ------------------------------------------------------------------------ edits */
    const selIdx = (c: Curve): number[] => c.ch.keys.map((k, i) => (sel.has(keyId(c.id, k.t)) ? i : -1)).filter((i) => i >= 0);
    function commit(c: Curve, ch: Channel, label: string, mergeKey?: string): void {
      const tr: NumTrack = { kind: 'num', ch: c.track.ch.map((x, i) => (i === c.index ? ch : x)) };
      anim().updateTrack(c.nodeId, c.paramId, tr as AnimTrack, label, mergeKey);
    }
    function editSel(fn: (c: Channel, idx: number[]) => Channel): void {
      const targets = visible().filter((c) => selIdx(c).length);
      if (!targets.length) return;
      app.project.editor.stack.transaction('Edit keys', () => targets.forEach((c) => commit(c, fn(c.ch, selIdx(c)), 'Edit keys')));
    }
    const tangents = (mode: TangentMode): void => editSel((c, i) => setInterp(setTangentMode(c, i, mode), i, 'bezier'));
    function mirror(axis: 'value' | 'time'): void {
      editSel((c, i) => {
        const vals = i.map((k) => c.keys[k].v);
        const pivot = axis === 'value' ? vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length) : pb.frame;
        return mirrorKeys(c, i, axis, pivot);
      });
    }
    function loop(offset: boolean): void {
      const targets = selIdx2();
      app.project.editor.stack.transaction('Loop match', () =>
        targets.forEach((c) => {
          const g = graph();
          const end = c.ch.keys[c.ch.keys.length - 1].t;
          commit(c, loopMatch(c.ch, undefined, offset), 'Loop match');
          void g;
          void end;
        }),
      );
    }
    /** Curves to loop-match: those with selected keys, else every visible curve. */
    const selIdx2 = (): Curve[] => {
      const withSel = visible().filter((c) => selIdx(c).length);
      return (withSel.length ? withSel : visible()).filter((c) => c.ch.keys.length >= 2);
    };
    function setExtrap(which: 'pre' | 'post', e: Extrapolation): void {
      const targets = selIdx2();
      app.project.editor.stack.transaction('Extrapolation', () => targets.forEach((c) => commit(c, { ...c.ch, [which]: e }, 'Set extrapolation')));
    }
    function deleteSel(): void {
      const targets = visible().filter((c) => selIdx(c).length);
      if (!targets.length) return;
      app.project.editor.stack.transaction('Delete keys', () => targets.forEach((c) => commit(c, removeKeys(c.ch, selIdx(c)), 'Delete keys')));
      sel.clear();
    }

    /* ------------------------------------------------------------------------ drawing */
    let raf = 0;
    const requestDraw = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };
    // theme / scale / density changes redraw the canvas-drawn UI (colours come from tokens, metrics from the central store)
    const onUi = (): void => (host.isConnected ? requestDraw() : window.removeEventListener('kk-ui-change', onUi));
    window.addEventListener('kk-ui-change', onUi);
    function draw(): void {
      w = Math.max(60, stage.clientWidth || w);
      hh = Math.max(60, stage.clientHeight || hh);
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${hh}px`;
      }
      const c = cv.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#17181c';
      c.fillRect(0, 0, w, hh);
      const g = graph();
      const ac = getComputedStyle(host).getPropertyValue('--accent').trim() || '#7c8cff';
      // grid
      const gridStep = (px: number, minPx: number): number => {
        const s = 1;
        const m = [1, 2, 5];
        for (let e = -6; e < 8; e++) for (const k of m) { const v = k * 10 ** e; if (v * px >= minPx) return v; }
        return s;
      };
      const ts = gridStep(view.ppf, 60);
      const vs = gridStep(view.vpp, 40);
      c.font = '10px sans-serif';
      c.textBaseline = 'top';
      c.lineWidth = 1;
      for (let t = Math.floor(view.t0 / ts) * ts; X(t) < w; t += ts) {
        c.strokeStyle = t === 0 ? '#4b4f5c' : '#262830';
        c.beginPath(); c.moveTo(Math.round(X(t)) + 0.5, 0); c.lineTo(Math.round(X(t)) + 0.5, hh); c.stroke();
        c.fillStyle = '#7d8290'; c.fillText(String(Math.round(t * 100) / 100), X(t) + 3, hh - 13);
      }
      const vTop = view.v0 + hh / view.vpp;
      for (let v = Math.floor(view.v0 / vs) * vs; v < vTop; v += vs) {
        const y = hh - (v - view.v0) * view.vpp;
        c.strokeStyle = Math.abs(v) < 1e-9 ? '#4b4f5c' : '#262830';
        c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); c.stroke();
        c.fillStyle = '#7d8290'; c.fillText(String(Math.round(v * 1000) / 1000), 3, y + 2);
      }
      // loop range
      const L0 = g.timeline.startFrame;
      const L1 = g.timeline.endFrame ?? L0 + g.settings.loopLength;
      c.fillStyle = 'rgba(255,255,255,0.025)';
      c.fillRect(X(L0), 0, X(L1) - X(L0), hh);
      c.strokeStyle = 'rgba(224,82,95,0.7)';
      c.beginPath(); c.moveTo(Math.round(X(L1)) + 0.5, 0); c.lineTo(Math.round(X(L1)) + 0.5, hh); c.stroke();
      // curves
      for (const cu of visible()) {
        const ks = cu.ch.keys;
        if (!ks.length) continue;
        const first = ks[0].t;
        const last = ks[ks.length - 1].t;
        for (const pass of [0, 1]) {
          c.strokeStyle = cu.color;
          c.globalAlpha = pass === 0 ? 1 : 0.4;
          c.setLineDash(pass === 0 ? [] : [4, 4]);
          c.lineWidth = pass === 0 ? 1.6 : 1;
          c.beginPath();
          let started = false;
          for (let x = 0; x <= w; x += 2) {
            const t = tOf(x);
            const inside = t >= first && t <= last;
            if ((pass === 0) !== inside) { started = false; continue; }
            if (pass === 1 && !cyclePreview) continue;
            const y = Y(cu, evalChannel(cu.ch, t));
            if (!started) { c.moveTo(x, y); started = true; } else c.lineTo(x, y);
          }
          c.stroke();
        }
        c.globalAlpha = 1;
        c.setLineDash([]);
        c.lineWidth = 1;
        // cycle period dividers
        if (cyclePreview && (cu.ch.post.startsWith('cycle') || cu.ch.pre.startsWith('cycle') || cu.ch.post === 'pingpong') && last > first) {
          c.strokeStyle = cu.color + '55';
          for (let t = first - Math.ceil((first - view.t0) / (last - first)) * (last - first); X(t) < w; t += last - first) {
            if (X(t) < 0) continue;
            c.beginPath(); c.moveTo(Math.round(X(t)) + 0.5, 0); c.lineTo(Math.round(X(t)) + 0.5, 14); c.stroke();
          }
        }
        // tangent handles of selected bezier keys
        const slopes = resolveSlopes(cu.ch);
        ks.forEach((k, i) => {
          if (!sel.has(keyId(cu.id, k.t))) return;
          for (const side of ['in', 'out'] as const) {
            if (side === 'in' && i === 0) continue;
            if (side === 'out' && i === ks.length - 1) continue;
            if ((side === 'out' ? k.interp : ks[i - 1].interp) !== 'bezier') continue;
            const hp = handlePos(cu, i, side, slopes);
            c.strokeStyle = '#9aa0b4';
            c.beginPath(); c.moveTo(X(k.t), Y(cu, k.v)); c.lineTo(hp[0], hp[1]); c.stroke();
            c.fillStyle = k.mode === 'free' ? '#ffd166' : '#9aa0b4';
            c.beginPath(); c.arc(hp[0], hp[1], 3.2, 0, Math.PI * 2); c.fill();
          }
        });
        // keys
        for (const k of ks) {
          const on = sel.has(keyId(cu.id, k.t));
          const x = X(k.t);
          const y = Y(cu, k.v);
          c.fillStyle = on ? ac : cu.color;
          c.strokeStyle = on ? '#fff' : '#101114';
          c.fillRect(x - 3.5, y - 3.5, 7, 7);
          c.strokeRect(x - 3.5, y - 3.5, 7, 7);
        }
      }
      // playhead
      c.strokeStyle = ac;
      c.beginPath(); c.moveTo(Math.round(X(pb.frame)) + 0.5, 0); c.lineTo(Math.round(X(pb.frame)) + 0.5, hh); c.stroke();
      if (box) {
        c.fillStyle = 'rgba(124,140,255,0.15)';
        c.strokeStyle = ac;
        c.fillRect(Math.min(box.x0, box.x1), Math.min(box.y0, box.y1), Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
        c.strokeRect(Math.min(box.x0, box.x1) + 0.5, Math.min(box.y0, box.y1) + 0.5, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
      }
      // info
      const sc = visible().filter((q) => selIdx(q).length);
      const q = sc[0];
      if (q) {
        const k = q.ch.keys[selIdx(q)[0]];
        preSel.value = q.ch.pre;
        postSel.value = q.ch.post;
        info.textContent = `${q.label}: key @ frame ${Math.round(k.t * 100) / 100}, value ${k.v.toFixed(4)} · ${k.interp}${k.interp === 'bezier' ? ` / ${k.mode}${k.broken ? ' (broken)' : ''}` : ''} · ${sel.size} key(s) selected`;
      } else {
        const lc = visible().filter((cu) => cu.ch.keys.length > 1).map((cu) => ({ cu, e: loopError(cu.ch) }));
        const bad = lc.filter((x) => x.e.value > 1e-4 && !x.cu.ch.post.endsWith('offset'));
        info.textContent = lc.length ? (bad.length ? `Loop check: ${bad.length} curve(s) end at a different value than they start - use Loop match.` : 'Loop check: all curves start and end at the same value.') : 'Select keys to edit them. Double-click a curve to add a key. Wheel = zoom (Shift: value only, Ctrl: time only), middle-drag = pan.';
      }
    }
    function handlePos(cu: Curve, i: number, side: 'in' | 'out', slopes = resolveSlopes(cu.ch)): [number, number] {
      const k = cu.ch.keys[i];
      const seg = side === 'out' ? segmentBezier(cu.ch, i) : segmentBezier(cu.ch, i - 1);
      if (seg) {
        const p = side === 'out' ? seg[1] : seg[2];
        return [X(p[0]), Y(cu, p[1])];
      }
      void slopes;
      return [X(k.t), Y(cu, k.v)];
    }

    /* ------------------------------------------------------------------------ interaction */
    const lx = (e: MouseEvent): number => e.clientX - cv.getBoundingClientRect().left;
    const ly = (e: MouseEvent): number => e.clientY - cv.getBoundingClientRect().top;
    function hit(x: number, y: number): { curve: Curve; i: number } | null {
      let best: { curve: Curve; i: number } | null = null;
      let bd = 8;
      for (const cu of visible()) cu.ch.keys.forEach((k, i) => {
        const d = Math.hypot(X(k.t) - x, Y(cu, k.v) - y);
        if (d <= bd) { bd = d; best = { curve: cu, i }; }
      });
      return best;
    }
    function hitHandle(x: number, y: number): { curve: Curve; i: number; side: 'in' | 'out' } | null {
      for (const cu of visible()) {
        for (let i = 0; i < cu.ch.keys.length; i++) {
          const k = cu.ch.keys[i];
          if (!sel.has(keyId(cu.id, k.t))) continue;
          for (const side of ['in', 'out'] as const) {
            if ((side === 'in' && i === 0) || (side === 'out' && i === cu.ch.keys.length - 1)) continue;
            if ((side === 'out' ? k.interp : cu.ch.keys[i - 1].interp) !== 'bezier') continue;
            const p = handlePos(cu, i, side);
            if (Math.hypot(p[0] - x, p[1] - y) <= 6) return { curve: cu, i, side };
          }
        }
      }
      return null;
    }
    function startPan(e: PointerEvent): void {
      const { t0, v0 } = view;
      dragPointer(e, (dx, dy) => { view.t0 = t0 - dx / view.ppf; view.v0 = v0 + dy / view.vpp; requestDraw(); });
    }
    cv.addEventListener('pointerdown', (e) => {
      host.focus();
      if (e.button === 1) return startPan(e);
      if (e.button !== 0) return;
      const x = lx(e);
      const y = ly(e);
      const hh2 = hitHandle(x, y);
      if (hh2) return dragHandle(e, hh2);
      const k = hit(x, y);
      if (k) {
        const id = keyId(k.curve.id, k.curve.ch.keys[k.i].t);
        if (e.shiftKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); } else if (!sel.has(id)) { sel.clear(); sel.add(id); }
        draw();
        return dragKeys(e, x, y);
      }
      if (!e.shiftKey) sel.clear();
      box = { x0: x, y0: y, x1: x, y1: y };
      dragPointer(e, (dx, dy) => { box = { x0: x, y0: y, x1: x + dx, y1: y + dy }; requestDraw(); }, () => {
        if (box) {
          const [xa, xb, ya, yb] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1), Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
          if (xb - xa < 3 && yb - ya < 3) pb.setFrame(Math.round(tOf(x)));
          for (const cu of visible()) for (const kk of cu.ch.keys) if (X(kk.t) >= xa && X(kk.t) <= xb && Y(cu, kk.v) >= ya && Y(cu, kk.v) <= yb) sel.add(keyId(cu.id, kk.t));
        }
        box = null;
        draw();
      });
    });
    cv.addEventListener('dblclick', (e) => {
      const x = lx(e);
      const y = ly(e);
      let best: Curve | null = null;
      let bd = 10;
      for (const cu of visible()) {
        const d = Math.abs(Y(cu, evalChannel(cu.ch, tOf(x))) - y);
        if (d < bd) { bd = d; best = cu; }
      }
      if (!best) return;
      const t = Math.round(tOf(x));
      commit(best, setKey(best.ch, t, evalChannel(best.ch, t)), 'Add key');
    });

    function dragKeys(e: PointerEvent, x0: number, y0: number): void {
      const targets = visible().filter((cu) => selIdx(cu).length);
      const originals = new Map(targets.map((cu) => [cu.id, { track: cu.track, ch: cu.ch, idx: selIdx(cu) }]));
      let moved = false;
      let ldt = 0;
      app.engine.scheduler.beginInteraction();
      dragPointer(e, (dx, dy, ev) => {
        let dt = Math.round(dx / view.ppf);
        let dyy = dy;
        if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dyy = 0; else dt = 0; }
        ldt = dt;
        moved = true;
        for (const cu of targets) {
          const o = originals.get(cu.id)!;
          const dv = denorm(cu, view.v0 + (hh - (y0 + dyy)) / view.vpp) - denorm(cu, view.v0 + (hh - y0) / view.vpp);
          const next = moveKeys(o.ch, o.idx, dt, dv).channel;
          anim().preview(cu.nodeId, cu.paramId, { kind: 'num', ch: o.track.ch.map((c, i) => (i === cu.index ? next : c)) });
        }
        rebuildLight();
      }, (cancelled) => {
        app.engine.scheduler.endInteraction();
        if (!moved || cancelled) {
          for (const cu of targets) anim().preview(cu.nodeId, cu.paramId, originals.get(cu.id)!.track);
          rebuild();
          return;
        }
        const g = graph();
        app.project.editor.stack.transaction('Move keys', () => {
          for (const cu of targets) {
            const o = originals.get(cu.id)!;
            anim().commitGesture(cu.nodeId, cu.paramId, o.track, g.nodes.get(cu.nodeId)?.anim?.[cu.paramId], 'Move keys');
          }
        });
        const next = new Set<string>();
        for (const cu of targets) for (const i of originals.get(cu.id)!.idx) next.add(keyId(cu.id, originals.get(cu.id)!.ch.keys[i].t + ldt));
        sel.clear();
        next.forEach((s) => sel.add(s));
        void x0;
        rebuild();
      });
    }
    /** Refresh curve data from the live graph while dragging (selection keys follow by time identity, so only redraw). */
    function rebuildLight(): void {
      const g = graph();
      for (const cu of curves) {
        const tr = g.nodes.get(cu.nodeId)?.anim?.[cu.paramId];
        if (tr && tr.kind === 'num') {
          cu.track = tr;
          cu.ch = tr.ch[cu.index] ?? cu.ch;
        }
      }
      requestDraw();
    }

    function dragHandle(e: PointerEvent, hnd: { curve: Curve; i: number; side: 'in' | 'out' }): void {
      const { curve: cu, i, side } = hnd;
      const orig = cu.track;
      const k = cu.ch.keys[i];
      app.engine.scheduler.beginInteraction();
      let moved = false;
      dragPointer(e, (_dx, _dy, ev) => {
        const x = ev.clientX - cv.getBoundingClientRect().left;
        const y = ev.clientY - cv.getBoundingClientRect().top;
        const dt = (tOf(x) - k.t) * (side === 'in' ? -1 : 1);
        if (dt < 0.05) return;
        const dv = (yToVal(cu, y) - k.v) * (side === 'in' ? -1 : 1);
        // handle sits at 1/3 of the segment: slope = dv / (dt) in value per frame (same units as the stored slopes)
        const slope = dv / dt;
        moved = true;
        const ch = setTangent(orig.ch[cu.index], i, side, side === 'in' ? -slope * -1 : slope);
        anim().preview(cu.nodeId, cu.paramId, { kind: 'num', ch: orig.ch.map((c, n) => (n === cu.index ? ch : c)) });
        rebuildLight();
      }, (cancelled) => {
        app.engine.scheduler.endInteraction();
        const g = graph();
        if (!moved || cancelled) anim().preview(cu.nodeId, cu.paramId, orig);
        else anim().commitGesture(cu.nodeId, cu.paramId, orig, g.nodes.get(cu.nodeId)?.anim?.[cu.paramId], 'Edit tangent');
        rebuild();
      });
    }

    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const x = lx(e);
      const y = ly(e);
      const f = Math.exp(-e.deltaY * 0.0015);
      if (!e.shiftKey) {
        const t = tOf(x);
        view.ppf = Math.max(0.2, Math.min(400, view.ppf * f));
        view.t0 = t - x / view.ppf;
      }
      if (!e.ctrlKey && !e.metaKey) {
        const v = view.v0 + (hh - y) / view.vpp;
        view.vpp = Math.max(1e-3, Math.min(1e5, view.vpp * f));
        view.v0 = v - (hh - y) / view.vpp;
      }
      requestDraw();
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => {
      contextMenu(e, [
        { label: tt('common.frameAll'), action: () => frame(false) },
        { label: tt('animCurves.frameSelected'), action: () => frame(true) },
        { separator: true },
        { label: tt('animCurves.loopMatch'), action: () => loop(false) },
        { label: tt('animCurves.loopMatchKeepEnd'), action: () => loop(true) },
        { label: tt('animCurves.deleteSelectedKeys'), disabled: sel.size === 0, action: deleteSel },
      ]);
    });
    host.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) { e.preventDefault(); e.stopPropagation(); deleteSel(); }
      else if (e.key.toLowerCase() === 'a' && !(e.ctrlKey || e.metaKey)) { frame(false); }
      else if (e.key.toLowerCase() === 'f') { frame(true); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); e.stopPropagation(); visible().forEach((cu) => cu.ch.keys.forEach((k) => sel.add(keyId(cu.id, k.t)))); draw(); }
    });

    /* ------------------------------------------------------------------------ wiring */
    let unGraph: (() => void) | null = null;
    const bind = (): void => {
      unGraph?.();
      sel.clear();
      unGraph = graph().events.on((ev) => {
        if (ev.type === 'param' || ev.type === 'structure' || ev.type === 'reset') rebuild();
        else requestDraw();
      });
      rebuild();
      frame(false);
    };
    dis.add(app.project.onChange.on(bind));
    dis.add(app.selection.onChange.on(() => { rebuild(); }));
    dis.add(pb.onChange.on(requestDraw));
    dis.add(observeSize(host, () => requestDraw()));
    bind();
    return { dispose: () => { if (raf) cancelAnimationFrame(raf); unGraph?.(); dis.dispose(); }, focus: () => host.focus() };
  },
});


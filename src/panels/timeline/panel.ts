import { animOf, autoKey, onSeamReport, runSeamVerifier } from '../../app/anim';
import { animatedParams, valueAt } from '../../engine/anim/animator';
import { EPS_T } from '../../engine/anim/keyframes';
import { formatFrame, niceTickStep, parseFrame, animRange, workRange, type TimeDisplay } from '../../engine/anim/timebase';
import { hasKey, mapTrackKeys, rowFrames, selKey, shortValue } from './logic';
import { moveTrackKeys, scaleTrackKeys, trackKeyFrames, type AnimTrack } from '../../engine/anim/tracks';
import type { ParamDef } from '../../engine/params/schema';
import { Disposer, dragPointer, h, observeSize } from '../../ui/core/dom';
import { contextMenu } from '../../ui/core/menu';
import { registerPanel } from '../../ui/dock/panel-registry';
import { Dropdown } from '../../ui/widgets/controls';
import './timeline.css';

import { t } from '../../shared/i18n';
interface Row {
  kind: 'node' | 'param';
  nodeId: string;
  paramId?: string;
  def?: ParamDef;
  track?: AnimTrack;
  label: string;
}
const ROW_H = 22;
const SPEEDS = [-1, 0.25, 0.5, 1, 2, 4];
const LOOP_LABEL = { once: 'Once', loop: 'Loop', pingpong: 'Ping-pong' } as const;

/**
 * TIMELINE: transport, scrubbing, frame / seconds / timecode display, work area, markers, dopesheet rows with
 * keyframe diamonds for the selected nodes' animated params (box select, move, Alt-scale around the playhead, copy / paste,
 * snapping, zoom / pan), loop-region shading, pacing + frame-cache indicator and the loop-seam verifier.
 */
registerPanel({
  id: 'timeline',
  title: 'Timeline',
  icon: 'panel-timeline',
  defaultDock: { zone: 'bottom', size: 0.25 },
  description: t('timeline.playbackTransportKeyframesOf'),
  create(host, ctx) {
    const app = ctx.app;
    const pb = app.engine.playback;
    const dis = new Disposer();
    host.classList.add('k-tl');
    host.tabIndex = 0;
    const graph = (): typeof app.project.graph => app.project.graph;
    const anim = (): ReturnType<typeof animOf> => animOf(app);
    const accent = (): string => getComputedStyle(host).getPropertyValue('--accent').trim() || '#7c8cff';

    /* ----------------------------------------------------------------------------- state */
    const view = { t0: -3, ppf: 8 };
    let rows: Row[] = [];
    const sel = new Set<string>();
    let showAll = false;
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    let display: TimeDisplay = graph().timeline.display;
    let width = 600;
    const frameToX = (f: number): number => (f - view.t0) * view.ppf;
    const xToFrame = (x: number): number => view.t0 + x / view.ppf;

    /* ----------------------------------------------------------------------------- transport bar */
    const mkBtn = (txt: string, tip: string, fn: () => void, cls = ''): HTMLButtonElement => h('button', { class: `k-tl-btn ${cls}`, tip, onclick: fn }, txt);
    const bPlay = mkBtn('▶', 'Play / Pause (Space)', () => pb.toggle());
    const bLoop = mkBtn('Loop', 'Loop mode: once / loop / ping-pong', () => app.commands.execute('anim.loopMode'));
    const timeIn = h('input', { class: 'time', type: 'text', tip: t('timeline.currentTimeTypeA') }) as HTMLInputElement;
    timeIn.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const f = parseFrame(timeIn.value, pb.fps);
        if (f !== null) pb.setFrame(f);
        timeIn.blur();
      }
    });
    const bDisp = mkBtn('f', 'Time display: frames / seconds / timecode', () => {
      display = display === 'frames' ? 'seconds' : display === 'seconds' ? 'timecode' : 'frames';
      anim().setTimeline({ display }, 'Time display');
      refreshBar();
    });
    const numIn = (tip: string, get: () => number, set: (v: number) => void): HTMLInputElement => {
      const i = h('input', { class: 'num', type: 'number', tip }) as HTMLInputElement;
      i.addEventListener('keydown', (e) => e.stopPropagation());
      i.addEventListener('change', () => {
        const v = parseFloat(i.value);
        if (Number.isFinite(v)) set(v);
        i.value = String(get());
      });
      return i;
    };
    const startIn = numIn('First frame of the animation range', () => graph().timeline.startFrame, (v) => anim().setTimeline({ startFrame: Math.round(v) }, 'Start frame'));
    const lenIn = numIn('Loop length in frames (graph setting: also drives Loop phase in nodes)', () => graph().settings.loopLength, (v) => { app.project.editor.setSettings({ loopLength: Math.max(1, Math.round(v)) }); pb.reanchor(); });
    const fpsIn = numIn('Frames per second', () => graph().settings.fps, (v) => { app.project.editor.setSettings({ fps: Math.max(1, Math.min(240, Math.round(v))) }); pb.reanchor(); });
    const speed = new Dropdown({ options: SPEEDS.map((s) => ({ value: String(s), label: s < 0 ? 'Reverse' : `${s}×` })), value: '1', tip: t('timeline.playbackSpeed') }, { onInput: (v) => { pb.speedOverride = parseFloat(v); pb.reanchor(); } });
    const bKey = mkBtn('Auto-key', 'Auto-key (Shift+K): editing an animatable parameter creates a key at the playhead', () => autoKey.set(!autoKey.get()), 'rec');
    const bSnap = mkBtn('Snap', 'Snap to whole frames and markers', () => { anim().setTimeline({ snap: !graph().timeline.snap }, 'Snap'); refreshBar(); });
    const bMark = mkBtn('+ Marker', 'Add a marker at the playhead', () => anim().addMarker(pb.frame));
    const bSeam = mkBtn('Verify loop', 'Renders the loop at low resolution and compares the last frame to the first (selected node)', () => void runSeamVerifier(app));
    const stat = h('span', { class: 'k-tl-stat', tip: t('timeline.playbackPacingFrame') });
    const seam = h('span', { class: 'k-tl-stat', tip: t('timeline.loopSeamVerifierResult') });
    const bar = h('div', { class: 'k-tl-bar' },
      mkBtn('⏮', 'Go to start (Shift+Home)', () => pb.goStart()),
      mkBtn('◀|', 'Step back (Alt+Left)', () => pb.step(-1)),
      bPlay,
      mkBtn('|▶', 'Step forward (Alt+Right)', () => pb.step(1)),
      mkBtn('⏭', 'Go to end (Shift+End)', () => pb.goEnd()),
      mkBtn('◆◀', 'Previous key (Alt+Shift+Left)', () => void pb.jumpToKey(pb.keyFramesOf(nodeIds()), -1)),
      mkBtn('▶◆', 'Next key (Alt+Shift+Right)', () => void pb.jumpToKey(pb.keyFramesOf(nodeIds()), 1)),
      bLoop,
      speed.el,
      h('span', { class: 'sep' }),
      timeIn,
      bDisp,
      h('span', { class: 'sep' }),
      h('label', {}, 'Start', startIn),
      h('label', {}, 'Length', lenIn),
      h('label', {}, 'fps', fpsIn),
      h('span', { class: 'sep' }),
      bKey,
      bSnap,
      bMark,
      h('span', { class: 'sep' }),
      bSeam,
      seam,
      stat,
    );

    /* ----------------------------------------------------------------------------- body */
    const labels = h('div', { class: 'k-tl-labels' });
    const rulerCv = h('canvas') as HTMLCanvasElement;
    const rowsCv = h('canvas') as HTMLCanvasElement;
    const rulerWrap = h('div', { class: 'rulerwrap' }, rulerCv);
    const corner = h('div', { class: 'corner' }, h('label', {}, h('input', { type: 'checkbox', onchange: (e: Event) => { showAll = (e.target as HTMLInputElement).checked; rebuild(); } }), ' all animated nodes'));
    const top = h('div', { class: 'k-tl-top' }, corner, rulerWrap);
    const canvasWrap = h('div', { class: 'k-tl-canvaswrap' }, rowsCv);
    const scroll = h('div', { class: 'k-tl-scroll' }, labels, canvasWrap);
    const empty = h('div', { class: 'k-tl-empty' });
    host.append(bar, h('div', { class: 'k-tl-main' }, top, scroll, empty));

    const nodeIds = (): string[] => (showAll ? [...graph().nodes.keys()].filter((id) => animatedParams(graph(), id).length) : [...app.selection.get()]);

    /* ----------------------------------------------------------------------------- rows */
    function rebuild(): void {
      const g = graph();
      rows = [];
      for (const id of nodeIds()) {
        const n = g.nodes.get(id);
        if (!n) continue;
        const ap = animatedParams(g, id);
        if (!ap.length && showAll) continue;
        rows.push({ kind: 'node', nodeId: id, label: n.name });
        for (const { def, track } of ap) rows.push({ kind: 'param', nodeId: id, paramId: def.id, def, track, label: def.label });
      }
      labels.replaceChildren();
      for (const r of rows) labels.append(rowEl(r));
      const hasAny = rows.some((r) => r.kind === 'param');
      empty.style.display = hasAny ? 'none' : '';
      scroll.style.display = hasAny ? '' : 'none';
      empty.textContent = rows.length ? 'No animated parameters on the selected node(s). Click the ◆ key button next to a parameter in Properties (or enable Auto-key and edit a value) to start animating. Right-click a parameter for more.' : 'Select a node to see its keyframes. Scrubbing, Space (play) and the transport work without a selection.';
      sizeCanvases();
      draw();
    }

    function rowEl(r: Row): HTMLElement {
      if (r.kind === 'node') return h('div', { class: 'k-tl-row node' }, h('span', { class: 'nm' }, r.label));
      const g = graph();
      const val = h('span', { class: 'val' });
      const key = h('button', { tip: t('timeline.addRemoveA'), onclick: () => toggleKey(r) }, '◆');
      const el = h('div', { class: 'k-tl-row param', 'data-pid': `${r.nodeId}|${r.paramId}` },
        h('span', { class: 'nm', tip: r.def?.tooltip ?? r.label }, r.label),
        val,
        h('button', { tip: t('timeline.previousKey'), onclick: () => void pb.jumpToKey(rowFrames(r.track), -1) }, '‹'),
        key,
        h('button', { tip: t('timeline.nextKey'), onclick: () => void pb.jumpToKey(rowFrames(r.track), 1) }, '›'),
      );
      el.addEventListener('contextmenu', (e) => contextMenu(e, [
        { label: t('common.addKeyAtPlayhead'), action: () => anim().setKey(r.nodeId, r.paramId!, Math.round(pb.frame)) },
        { label: t('common.resetAnimationKeepCurrent'), action: () => anim().resetAnimation(r.nodeId, r.paramId!, pb.frame) },
        { label: t('timeline.openInCurveEditor'), action: () => void app.dock.openPanel('anim-curves') },
      ]));
      void g;
      return Object.assign(el, { _val: val, _key: key });
    }

    function toggleKey(r: Row): void {
      const f = Math.round(pb.frame);
      if (hasKey(r.track, f)) anim().removeKey(r.nodeId, r.paramId!, f);
      else anim().setKey(r.nodeId, r.paramId!, f);
    }

    function refreshValues(): void {
      const g = graph();
      const f = pb.frame;
      for (const el of Array.from(labels.children) as (HTMLElement & { _val?: HTMLElement; _key?: HTMLElement })[]) {
        const pid = el.getAttribute('data-pid');
        if (!pid || !el._val) continue;
        const [nodeId, paramId] = pid.split('|');
        const v = valueAt(g, nodeId, paramId, f);
        el._val.textContent = shortValue(v);
        const tr = g.nodes.get(nodeId)?.anim?.[paramId];
        el._key?.classList.toggle('keyed', hasKey(tr, f));
        el._key?.classList.toggle('anim', !!tr && !hasKey(tr, f));
      }
    }

    /* ----------------------------------------------------------------------------- drawing */
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
    const setCv = (cv: HTMLCanvasElement, w: number, hh: number): CanvasRenderingContext2D => {
      const dpr = window.devicePixelRatio || 1;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hh * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${hh}px`;
      }
      const c = cv.getContext('2d')!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      return c;
    };
    function sizeCanvases(): void {
      width = Math.max(50, canvasWrap.clientWidth || rulerWrap.clientWidth || 400);
      canvasWrap.style.height = `${rows.length * ROW_H}px`;
    }

    function draw(): void {
      const g = graph();
      const tl = g.timeline;
      const full = animRange(tl, g.settings.loopLength);
      const work = workRange(tl, g.settings.loopLength);
      const ac = accent();
      width = Math.max(50, rulerWrap.clientWidth || width);
      /* ruler */
      {
        const c = setCv(rulerCv, width, 38);
        c.clearRect(0, 0, width, 38);
        c.fillStyle = '#1d1f24';
        c.fillRect(0, 0, width, 38);
        // work area strip
        c.fillStyle = 'rgba(120,140,255,0.28)';
        c.fillRect(frameToX(work.start), 0, frameToX(work.end) - frameToX(work.start), 7);
        c.fillStyle = ac;
        c.fillRect(frameToX(work.start) - 1, 0, 3, 7);
        c.fillRect(frameToX(work.end) - 2, 0, 3, 7);
        // ticks
        const step = niceTickStep(view.ppf, 54);
        const minor = step >= 5 ? step / 5 : 1;
        c.font = '10px sans-serif';
        c.textBaseline = 'middle';
        for (let f = Math.floor(view.t0 / minor) * minor; frameToX(f) < width; f += minor) {
          const x = Math.round(frameToX(f)) + 0.5;
          const major = Math.abs(f / step - Math.round(f / step)) < 1e-6;
          c.strokeStyle = major ? '#6b7080' : '#3a3d47';
          c.beginPath();
          c.moveTo(x, major ? 17 : 26);
          c.lineTo(x, 38);
          c.stroke();
          if (major) {
            c.fillStyle = '#a5aab8';
            c.fillText(display === 'frames' ? String(f) : display === 'seconds' ? (f / g.settings.fps).toFixed(2) : formatFrame(f, g.settings.fps, 'timecode'), x + 3, 22);
          }
        }
        // markers
        for (const m of tl.markers) {
          const x = frameToX(m.frame);
          c.fillStyle = '#f0b04a';
          c.beginPath();
          c.moveTo(x, 38);
          c.lineTo(x - 4, 30);
          c.lineTo(x + 4, 30);
          c.closePath();
          c.fill();
          c.fillStyle = '#f0b04a';
          c.fillText(m.name, x + 6, 32);
        }
        // loop end
        c.strokeStyle = '#e0525f';
        c.beginPath();
        c.moveTo(Math.round(frameToX(full.end)) + 0.5, 8);
        c.lineTo(Math.round(frameToX(full.end)) + 0.5, 38);
        c.stroke();
        // playhead
        const px = frameToX(pb.frame);
        c.fillStyle = ac;
        c.beginPath();
        c.moveTo(px - 6, 18);
        c.lineTo(px + 6, 18);
        c.lineTo(px, 30);
        c.closePath();
        c.fill();
        c.fillRect(px - 0.5, 18, 1, 20);
      }
      /* rows */
      sizeCanvases();
      const h2 = Math.max(rows.length * ROW_H, 1);
      const c = setCv(rowsCv, width, h2);
      c.clearRect(0, 0, width, h2);
      rows.forEach((r, i) => {
        c.fillStyle = r.kind === 'node' ? '#22242b' : i % 2 ? '#1b1c20' : '#1e2025';
        c.fillRect(0, i * ROW_H, width, ROW_H);
      });
      // grid + out-of-range shading
      const step = niceTickStep(view.ppf, 54);
      c.strokeStyle = 'rgba(255,255,255,0.05)';
      for (let f = Math.floor(view.t0 / step) * step; frameToX(f) < width; f += step) {
        const x = Math.round(frameToX(f)) + 0.5;
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, h2);
        c.stroke();
      }
      c.fillStyle = 'rgba(0,0,0,0.28)';
      c.fillRect(0, 0, Math.max(0, frameToX(work.start)), h2);
      c.fillRect(Math.max(0, frameToX(work.end)), 0, width, h2);
      for (const m of tl.markers) {
        c.strokeStyle = 'rgba(240,176,74,0.35)';
        c.beginPath();
        c.moveTo(Math.round(frameToX(m.frame)) + 0.5, 0);
        c.lineTo(Math.round(frameToX(m.frame)) + 0.5, h2);
        c.stroke();
      }
      // keys
      rows.forEach((r, i) => {
        if (r.kind !== 'param' || !r.track) return;
        const frames = trackKeyFrames(r.track);
        // span bar between first and last key
        if (frames.length > 1) {
          c.fillStyle = 'rgba(120,140,255,0.10)';
          c.fillRect(frameToX(frames[0]), i * ROW_H + 8, frameToX(frames[frames.length - 1]) - frameToX(frames[0]), 6);
        }
        for (const f of frames) {
          const x = frameToX(f);
          if (x < -8 || x > width + 8) continue;
          const y = i * ROW_H + ROW_H / 2;
          const on = sel.has(selKey(r.nodeId, r.paramId!, f));
          c.fillStyle = on ? ac : '#e3e6ee';
          c.strokeStyle = on ? '#fff' : '#12131a';
          c.beginPath();
          c.moveTo(x, y - 6);
          c.lineTo(x + 5, y);
          c.lineTo(x, y + 6);
          c.lineTo(x - 5, y);
          c.closePath();
          c.fill();
          c.stroke();
        }
      });
      if (box) {
        c.fillStyle = 'rgba(124,140,255,0.15)';
        c.strokeStyle = ac;
        const x = Math.min(box.x0, box.x1);
        const y = Math.min(box.y0, box.y1);
        c.fillRect(x, y, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
        c.strokeRect(x + 0.5, y + 0.5, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0));
      }
      const px = Math.round(frameToX(pb.frame)) + 0.5;
      c.strokeStyle = ac;
      c.beginPath();
      c.moveTo(px, 0);
      c.lineTo(px, h2);
      c.stroke();
      refreshBar();
    }

    function refreshBar(): void {
      const g = graph();
      bPlay.textContent = pb.playing ? '⏸' : '▶';
      bPlay.classList.toggle('on', pb.playing);
      bLoop.textContent = LOOP_LABEL[g.timeline.loop];
      bLoop.classList.toggle('on', g.timeline.loop !== 'once');
      bKey.classList.toggle('on', autoKey.get());
      bSnap.classList.toggle('on', g.timeline.snap);
      bDisp.textContent = display === 'frames' ? 'f' : display === 'seconds' ? 's' : 'tc';
      if (document.activeElement !== timeIn) timeIn.value = formatFrame(pb.frame, g.settings.fps, display);
      for (const [i, get] of [[startIn, () => g.timeline.startFrame], [lenIn, () => g.settings.loopLength], [fpsIn, () => g.settings.fps]] as [HTMLInputElement, () => number][]) {
        if (document.activeElement !== i) i.value = String(get());
      }
      const s = pb.stats();
      const cs = app.engine.scheduler.frameCache.stats();
      const cache = cs.maxBytes > 0 ? ` · cache ${cs.entries}f ${(cs.bytes / 1048576).toFixed(0)}/${(cs.maxBytes / 1048576).toFixed(0)} MB` : '';
      if (pb.playing) {
        stat.textContent = `${s.actualFps.toFixed(1)} / ${g.settings.fps} fps · dropped ${s.dropped}${s.behind ? ' · TOO HEAVY FOR REAL TIME' : ''}${cache}`;
        stat.className = `k-tl-stat ${s.behind ? 'warn' : 'ok'}`;
      } else {
        stat.textContent = t('timeline.fps', { fps: g.settings.fps, cache });
        stat.className = 'k-tl-stat';
      }
      refreshValues();
    }

    /* ----------------------------------------------------------------------------- interaction */
    const snapF = (f: number): number => (graph().timeline.snap ? Math.round(f) : f);
    const localX = (e: MouseEvent, el: HTMLElement): number => e.clientX - el.getBoundingClientRect().left;
    const localY = (e: MouseEvent, el: HTMLElement): number => e.clientY - el.getBoundingClientRect().top;

    rulerCv.addEventListener('pointerdown', (e) => {
      if (e.button === 1) return startPan(e);
      if (e.button !== 0) return;
      const x = localX(e, rulerCv);
      const y = localY(e, rulerCv);
      const g = graph();
      const work = workRange(g.timeline, g.settings.loopLength);
      if (y < 8) {
        const which = Math.abs(x - frameToX(work.start)) < 7 ? 'workStart' : Math.abs(x - frameToX(work.end)) < 7 ? 'workEnd' : null;
        if (which) {
          dragPointer(e, (dx) => {
            const f = Math.round(xToFrame(x + dx));
            anim().setTimeline({ [which]: f } as never, 'Work area', 'work');
          }, () => app.project.editor.stack.sealTop());
          return;
        }
      }
      const scrub = (px: number): void => pb.setFrame(snapF(xToFrame(px)), graph().timeline.snap);
      pb.pause();
      scrub(x);
      app.engine.scheduler.beginInteraction();
      dragPointer(e, (dx) => scrub(x + dx), () => app.engine.scheduler.endInteraction());
    });
    rulerCv.addEventListener('contextmenu', (e) => {
      const f = Math.round(xToFrame(localX(e, rulerCv)));
      const g = graph();
      const near = g.timeline.markers.find((m) => Math.abs(m.frame - f) <= Math.max(1, 6 / view.ppf));
      contextMenu(e, [
        { label: t('timeline.setWorkStartAt', { f }), action: () => anim().setTimeline({ workStart: f }, 'Work start') },
        { label: t('timeline.setWorkEndAt', { f }), action: () => anim().setTimeline({ workEnd: f }, 'Work end') },
        { label: t('timeline.resetWorkArea'), action: () => anim().setTimeline({ workStart: null, workEnd: null }, 'Reset work area') },
        { separator: true },
        { label: t('timeline.addMarkerAt', { f }), action: () => anim().addMarker(f) },
        { label: t('timeline.deleteMarker'), disabled: !near, action: () => near && anim().removeMarker(near.frame) },
        { separator: true },
        { label: t('timeline.setLoopLengthTo'), action: () => { const w = workRange(g.timeline, g.settings.loopLength); app.project.editor.stack.transaction('Loop length', () => { anim().setTimeline({ startFrame: w.start }, 'Start'); app.project.editor.setSettings({ loopLength: w.end - w.start }); }); } },
        { label: t('common.frameAll'), action: () => frameAll() },
      ]);
    });

    function startPan(e: PointerEvent): void {
      const t0 = view.t0;
      dragPointer(e, (dx) => { view.t0 = t0 - dx / view.ppf; requestDraw(); });
    }
    function frameAll(): void {
      const g = graph();
      const full = animRange(g.timeline, g.settings.loopLength);
      view.ppf = Math.max(0.5, Math.min(200, (width - 40) / Math.max(1, full.end - full.start)));
      view.t0 = full.start - 20 / view.ppf;
      requestDraw();
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const x = localX(e, rulerWrap);
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        view.t0 += (e.deltaX || e.deltaY) / view.ppf;
      } else {
        const f = xToFrame(x);
        view.ppf = Math.max(0.5, Math.min(200, view.ppf * Math.exp(-e.deltaY * 0.0015)));
        view.t0 = f - x / view.ppf;
      }
      requestDraw();
    };
    top.addEventListener('wheel', onWheel, { passive: false });
    canvasWrap.addEventListener('wheel', onWheel, { passive: false });

    const hitKey = (x: number, y: number): { row: number; frame: number } | null => {
      const i = Math.floor(y / ROW_H);
      const r = rows[i];
      if (!r || r.kind !== 'param' || !r.track) return null;
      let best: { row: number; frame: number } | null = null;
      let bd = 7;
      for (const f of trackKeyFrames(r.track)) {
        const d = Math.abs(frameToX(f) - x);
        if (d <= bd) {
          bd = d;
          best = { row: i, frame: f };
        }
      }
      return best;
    };

    rowsCv.addEventListener('pointerdown', (e) => {
      host.focus();
      if (e.button === 1) return startPan(e);
      if (e.button !== 0) return;
      const x = localX(e, rowsCv);
      const y = localY(e, rowsCv);
      const hit = hitKey(x, y);
      if (hit) {
        const r = rows[hit.row];
        const k = selKey(r.nodeId, r.paramId!, hit.frame);
        if (e.shiftKey) {
          if (sel.has(k)) sel.delete(k);
          else sel.add(k);
        } else if (!sel.has(k)) {
          sel.clear();
          sel.add(k);
        }
        draw();
        beginKeyDrag(e, x, e.altKey);
        return;
      }
      if (!e.shiftKey) sel.clear();
      box = { x0: x, y0: y, x1: x, y1: y };
      dragPointer(e, (dx, dy) => {
        box = { x0: x, y0: y, x1: x + dx, y1: y + dy };
        requestDraw();
      }, () => {
        if (box) {
          const [xa, xb] = [Math.min(box.x0, box.x1), Math.max(box.x0, box.x1)];
          const [ya, yb] = [Math.min(box.y0, box.y1), Math.max(box.y0, box.y1)];
          if (xb - xa < 3 && yb - ya < 3) pb.setFrame(snapF(xToFrame(x)), graph().timeline.snap);
          rows.forEach((r, i) => {
            if (r.kind !== 'param' || !r.track || (i + 1) * ROW_H < ya || i * ROW_H > yb) return;
            for (const f of trackKeyFrames(r.track)) if (frameToX(f) >= xa && frameToX(f) <= xb) sel.add(selKey(r.nodeId, r.paramId!, f));
          });
        }
        box = null;
        draw();
      });
    });
    rowsCv.addEventListener('dblclick', (e) => {
      const y = localY(e, rowsCv);
      const r = rows[Math.floor(y / ROW_H)];
      if (!r || r.kind !== 'param') return;
      anim().setKey(r.nodeId, r.paramId!, Math.round(xToFrame(localX(e, rowsCv))));
    });

    /** Selected frames per row (nodeId|paramId -> frames). */
    function selectedByRow(): Map<string, { row: Row; frames: number[] }> {
      const m = new Map<string, { row: Row; frames: number[] }>();
      for (const r of rows) {
        if (r.kind !== 'param' || !r.track) continue;
        const frames = trackKeyFrames(r.track).filter((f) => sel.has(selKey(r.nodeId, r.paramId!, f)));
        if (frames.length) m.set(`${r.nodeId}|${r.paramId}`, { row: r, frames });
      }
      return m;
    }

    function beginKeyDrag(e: PointerEvent, x0: number, scale: boolean): void {
      const groups = selectedByRow();
      const originals = new Map([...groups].map(([k, v]) => [k, v.row.track!]));
      const pivot = pb.frame;
      let moved = false;
      let lastDt = 0;
      let lastFactor = 1;
      app.engine.scheduler.beginInteraction();
      dragPointer(e, (dx) => {
        let dt = 0;
        let factor = 1;
        if (scale) {
          const den = x0 - frameToX(pivot);
          factor = Math.abs(den) < 4 ? 1 : Math.max(0.05, (x0 + dx - frameToX(pivot)) / den);
        } else dt = graph().timeline.snap ? Math.round(dx / view.ppf) : dx / view.ppf;
        if (dt === lastDt && factor === lastFactor) return;
        lastDt = dt;
        lastFactor = factor;
        moved = true;
        for (const [k, grp] of groups) {
          const orig = originals.get(k)!;
          const next = scale ? scaleTrackKeys(orig, grp.frames, pivot, factor) : moveTrackKeys(orig, grp.frames, dt);
          anim().preview(grp.row.nodeId, grp.row.paramId!, next);
        }
        draw();
      }, (cancelled) => {
        app.engine.scheduler.endInteraction();
        if (!moved || cancelled) {
          for (const [k, grp] of groups) anim().preview(grp.row.nodeId, grp.row.paramId!, originals.get(k));
          rebuild();
          return;
        }
        const g = graph();
        app.project.editor.stack.transaction(scale ? 'Scale keys' : 'Move keys', () => {
          for (const [k, grp] of groups) anim().commitGesture(grp.row.nodeId, grp.row.paramId!, originals.get(k), g.nodes.get(grp.row.nodeId)?.anim?.[grp.row.paramId!], scale ? 'Scale keys' : 'Move keys');
        });
        if (!scale) {
          const next = new Set<string>();
          for (const grp of groups.values()) for (const f of grp.frames) next.add(selKey(grp.row.nodeId, grp.row.paramId!, f + lastDt));
          sel.clear();
          next.forEach((s) => sel.add(s));
        } else sel.clear();
        rebuild();
      });
    }

    function deleteSelected(): void {
      const groups = selectedByRow();
      if (!groups.size) return;
      app.project.editor.stack.transaction('Delete keys', () => {
        for (const grp of groups.values()) {
          let tr: AnimTrack | undefined = grp.row.track;
          for (const f of grp.frames) tr = tr && mapTrackKeys(tr, [f], 'delete');
          anim().updateTrack(grp.row.nodeId, grp.row.paramId!, tr, 'Delete keys');
        }
      });
      sel.clear();
    }
    function setInterpSelected(interp: 'constant' | 'linear' | 'bezier'): void {
      const groups = selectedByRow();
      app.project.editor.stack.transaction('Set interpolation', () => {
        for (const grp of groups.values()) anim().updateTrack(grp.row.nodeId, grp.row.paramId!, mapTrackKeys(grp.row.track!, grp.frames, interp), 'Set interpolation');
      });
    }
    function copySelected(): void {
      const rowsSel = [...selectedByRow().values()].map((g) => ({ nodeId: g.row.nodeId, paramId: g.row.paramId!, frames: g.frames }));
      anim().copyKeys(rowsSel);
    }
    rowsCv.addEventListener('contextmenu', (e) => {
      const hit = hitKey(localX(e, rowsCv), localY(e, rowsCv));
      if (hit) {
        const r = rows[hit.row];
        const k = selKey(r.nodeId, r.paramId!, hit.frame);
        if (!sel.has(k)) {
          sel.clear();
          sel.add(k);
          draw();
        }
      }
      contextMenu(e, [
        { label: t('timeline.deleteKeys'), disabled: sel.size === 0, action: deleteSelected },
        { label: 'Copy', disabled: sel.size === 0, action: copySelected },
        { label: t('timeline.pasteAtPlayhead'), action: () => anim().pasteKeys(Math.round(pb.frame)) },
        { separator: true },
        { label: t('timeline.interpolationBezier'), disabled: sel.size === 0, action: () => setInterpSelected('bezier') },
        { label: t('timeline.interpolationLinear'), disabled: sel.size === 0, action: () => setInterpSelected('linear') },
        { label: t('timeline.interpolationConstantStepped'), disabled: sel.size === 0, action: () => setInterpSelected('constant') },
        { separator: true },
        { label: t('timeline.openCurveEditor'), action: () => void app.dock.openPanel('anim-curves') },
        { label: t('common.frameAll'), action: frameAll },
      ]);
    });

    host.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
        e.preventDefault();
        e.stopPropagation();
        deleteSelected();
      } else if (mod && e.key.toLowerCase() === 'c' && sel.size) {
        e.stopPropagation();
        copySelected();
      } else if (mod && e.key.toLowerCase() === 'v') {
        e.stopPropagation();
        anim().pasteKeys(Math.round(pb.frame));
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        e.stopPropagation();
        for (const r of rows) if (r.kind === 'param' && r.track) for (const f of trackKeyFrames(r.track)) sel.add(selKey(r.nodeId, r.paramId!, f));
        draw();
      } else if (e.key === 'Escape') {
        sel.clear();
        draw();
      } else if (e.key.toLowerCase() === 'f' && !mod) {
        frameAll();
      }
    });

    /* ----------------------------------------------------------------------------- wiring */
    let unGraph: (() => void) | null = null;
    const bindGraph = (): void => {
      unGraph?.();
      sel.clear();
      unGraph = graph().events.on((ev) => {
        if (ev.type === 'param' || ev.type === 'structure' || ev.type === 'reset') {
          // keys of this graph changed (undo / redo / edits elsewhere)
          rebuild();
        } else requestDraw();
      });
      display = graph().timeline.display;
      rebuild();
    };
    dis.add(app.project.onChange.on(bindGraph));
    dis.add(app.selection.onChange.on(() => rebuild()));
    dis.add(pb.onChange.on(requestDraw));
    dis.add(autoKey.subscribe(() => refreshBar()));
    dis.add(onSeamReport.subscribe((v) => {
      const [verdict, ...msg] = v.split('|');
      seam.textContent = verdict ? `loop: ${verdict}` : '';
      seam.title = msg.join('|');
      seam.className = `k-tl-stat ${verdict === 'clean' ? 'ok' : verdict === 'minor' ? 'warn' : verdict === 'visible' ? 'bad' : ''}`;
    }));
    const statTimer = window.setInterval(() => pb.playing && requestDraw(), 250);
    dis.add(() => window.clearInterval(statTimer));
    dis.add(observeSize(host, () => { sizeCanvases(); requestDraw(); }));
    bindGraph();
    frameAll();
    return {
      dispose: () => {
        if (raf) cancelAnimationFrame(raf);
        unGraph?.();
        dis.dispose();
      },
      focus: () => host.focus(),
    };
  },
});

export { EPS_T };

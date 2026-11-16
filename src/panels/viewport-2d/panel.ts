import { targetKey, type EvalTarget } from '../../engine/graph/evaluator';
import type { GizmoDecl } from '../../engine/graph/gizmo-decl';
import { isTexturePin, tilingFlags } from '../../engine/types';
import { GpuTexture } from '../../engine/resources/memory';
import { releaseValue, retainValue, type PinValue } from '../../engine/resources/values';
import { formatBytes } from '../../shared/util';
import { buildNodeGizmos, drawGizmos, fitView, GizmoController, GizmoStateStore, tileRegion, tileRegionUv, ViewTransform, zoomAt, defaultSnap, type Mods, type NumericRequest, type Rect, type V2, type ViewState } from '../../gizmos';
import { Disposer, h, listen, observeSize } from '../../ui/core/dom';
import { contextMenu, menuBelow, type MenuItem } from '../../ui/core/menu';
import { registerPanel } from '../../ui/dock/panel-registry';
import { Dropdown, iconButton, Segmented } from '../../ui/widgets/controls';
import { NumberField } from '../../ui/widgets/number-field';
import { GizmoToolbar } from '../../ui/widgets/gizmo-toolbar';
import { t, t as tt } from '../../shared/i18n';
import './viewport.css';
import { Analyzer, type Region } from './analysis';
import { attachSimHud } from '../properties/sim-panel';
import { DisplayRenderer, KIND_NAMES, type ImageSource, type PixelKind } from './display';
import { HistogramBox } from './histogram';
import { showNumericPopup } from './numeric-popup';
import { distToGuide, drawViewOverlay, RULER } from './overlay';
import { mergeSettings, tileDisplay, TILE_LABELS, type ChannelMode, type TileMode, type VizMode, OVERLAY_PIN } from './settings';

/** An image shown (or held for compare). Holds ONE retained reference to the evaluator's output. */
interface Held {
  value: PinValue;
  src: ImageSource;
  /** Full-resolution reference size (ip). */
  full: V2;
  flip: { cols: number; rows: number; count: number } | null;
  target: EvalTarget;
  label: string;
  scale: number;
}

interface FlipbookLike {
  tex: GpuTexture;
  cols: number;
  rows: number;
  frames?: number;
}
const asFlipbook = (d: unknown): FlipbookLike | null => {
  const f = d as Partial<FlipbookLike> | null;
  return f && f.tex instanceof GpuTexture && typeof f.cols === 'number' && typeof f.rows === 'number' ? (f as FlipbookLike) : null;
};
const kindOfPin = (pin: string): PixelKind => (pin === 'gray' ? 1 : pin === 'uv' ? 2 : pin === 'normal' ? 3 : pin === 'vector' ? 4 : 0);

/**
 * 2D VIEWPORT. Layers: WebGPU canvas (image, one fullscreen pass) + Canvas2D overlay (rulers, guides,
 * compare divider, region, gizmos). Redraws only when something changed (dirty flag + rAF). The shown evaluator
 * output is RETAINED, so pan/zoom/option changes redraw without re-evaluating and analysis/inspector reads are safe.
 * Gizmo logic lives in src/gizmos (this file only hosts it: view, models refresh, undoable gestures, popups).
 */
registerPanel({
  id: 'viewport-2d',
  title: tt('viewport2d.2dView'),
  icon: 'panel-2d',
  multiple: true,
  defaultDock: { zone: 'center' },
  description: tt('viewport2d.imageViewerAnyPin'),
  create(host, ctx) {
    attachSimHud(host, ctx.app.engine);
    const app = ctx.app;
    const dis = new Disposer();
    const s = mergeSettings(ctx.initialState);

    /* ------------------------------------------------------------------------------------------ DOM */
    const gpuCanvas = h('canvas');
    const ov = h('canvas', { class: 'ov', tabindex: '0' });
    const err = h('div', { class: 'k-banner err', style: { display: 'none' } });
    const msg = h('div', { class: 'msg' }, tt('viewport2d.noActiveNode'));
    const hist = new HistogramBox();
    hist.el.style.display = 'none';
    const gzBar = new GizmoToolbar();
    const stage = h('div', { class: 'k-vp2-stage' }, gpuCanvas, ov, msg, err, hist.el, gzBar.el);
    const toolbar = h('div', { class: 'k-toolrow' });
    const barInfo = h('span', { class: 'grow' });
    const barCursor = h('span');
    const barFlip = h('span', { style: { display: 'none' } });
    const bar = h('div', { class: 'k-vp2-bar' }, barInfo, barFlip, barCursor);
    const root = h('div', { class: 'k-vp2' }, toolbar, stage, bar);
    host.append(root);

    const display = new DisplayRenderer(app.engine, gpuCanvas);
    const analyzer = new Analyzer(app.engine);
    const ovCtx = ov.getContext('2d')!;
    const states = new GizmoStateStore();

    /* ------------------------------------------------------------------------------------------ state */
    let vw = 1;
    let vh = 1;
    let dpr = 1;
    let A: Held | null = null;
    let B: Held | null = null;
    /** overlay field of the displayed node (simulation velocity / pressure / ...), see settings.overlay. */
    let O: Held | null = null;
    let snapshot: Held | null = null;
    let curView = new ViewTransform({ zoom: 1, cx: 0, cy: 0, rot: 0, flipX: false, flipY: false, imgW: 1024, imgH: 1024 });
    let region: Rect | null = null;
    let marker: { x: number; y: number; w: number; h: number } | null = null;
    let readout: string | null = null;
    let dirty = false;
    let modelsDirty = true;
    let rebuilding = false;
    let raf = 0;
    let lastScale = 1;
    let lastFinal = true;
    let regionUv: { lo: V2; hi: V2 } = { lo: [0, 0], hi: [1, 1] };
    let closeNumeric: (() => void) | null = null;
    let spaceDown = false;
    const pinChoice = new Map<string, string>();
    let inspectReq: V2 | null = null;
    let inspectRaf = 0;
    let lastInspect: { texel: V2; values: Float32Array | null; uv: V2; px: V2 } | null = null;

    const requestDraw = (): void => {
      dirty = true;
      if (!raf) raf = requestAnimationFrame(frame);
    };

    /* ------------------------------------------------------------------------------------------ targets */
    const graph = () => app.project.graph;
    const target = (): EvalTarget | null => {
      let t: EvalTarget | null;
      if (s.targetMode === 'pinned') t = s.pinned;
      else if (s.targetMode === 'selection') {
        const id = app.selection.primary;
        t = id ? { nodeId: id } : app.active.get();
      } else t = app.active.get();
      if (!t || !graph().nodes.has(t.nodeId)) return null;
      const pin = t.pinId ?? pinChoice.get(t.nodeId);
      return pin ? { nodeId: t.nodeId, pinId: pin } : { nodeId: t.nodeId };
    };
    /** Overlay target: another output of the displayed node (e.g. Fluid 2D velocity over its smoke colour). */
    const overlayTarget = (): EvalTarget | null => {
      const a = target();
      const pin = OVERLAY_PIN[s.overlay];
      if (!a || !pin || a.pinId === pin) return null;
      return textureOutputs(a.nodeId).some((o) => o.id === pin) ? { nodeId: a.nodeId, pinId: pin } : null;
    };
    const compareTarget = (): EvalTarget | null => (s.compare === 'node' && s.compareNode && graph().nodes.has(s.compareNode.nodeId) ? s.compareNode : null);
    const nodeLabel = (id: string): string => graph().nodes.get(id)?.name ?? id;
    const textureOutputs = (nodeId: string): { id: string; name: string }[] => {
      const n = graph().nodes.get(nodeId);
      const def = n ? graph().registry.expanded(n.type) : null;
      return (def?.outputs ?? []).filter((o) => isTexturePin(o.type as never) || o.type === 'flipbook').map((o) => ({ id: o.id, name: o.name }));
    };

    const register = (): void => {
      const a = target();
      const b = compareTarget();
      const list = [a, b, overlayTarget()].filter((x): x is EvalTarget => !!x);
      ctx.scheduler.setTargets(ctx.instanceId, ctx.visible.get() && list.length ? list : null);
      if (a) ctx.title.set(`2D View — ${nodeLabel(a.nodeId)}`);
      else ctx.title.set('2D View');
      if (!a) {
        setHeld('A', null);
        msg.style.display = '';
        err.style.display = 'none';
      }
      modelsDirty = true;
      rebuildToolbarState();
      requestDraw();
    };

    /** Preview resolution follows the zoom: no point rendering more pixels than are shown. */
    const updateOwnerScale = (): void => {
      const apparent = curView.zoom * dpr;
      const sc = apparent >= 1 ? 1 : Math.max(1 / 8, Math.min(1, 2 ** Math.ceil(Math.log2(apparent))));
      if (sc !== lastScale) {
        lastScale = sc;
        ctx.scheduler.setOwnerScale(ctx.instanceId, sc);
      }
    };

    /* ------------------------------------------------------------------------------------------ held values */
    function setHeld(slot: 'A' | 'B' | 'S' | 'O', held: Held | null): void {
      const prev = slot === 'A' ? A : slot === 'B' ? B : slot === 'O' ? O : snapshot;
      if (slot === 'A') A = held;
      else if (slot === 'B') B = held;
      else if (slot === 'O') O = held;
      else snapshot = held;
      if (prev && prev !== held) releaseValue(prev.value);
    }

    function toHeld(v: PinValue | undefined, t: EvalTarget, scale: number, prev: Held | null): Held | null {
      if (!v) return null;
      let src: ImageSource;
      let full: V2;
      let flip: Held['flip'] = null;
      if (v.kind === 'texture') {
        src = { tex: v.tex, kind: kindOfPin(v.pin) };
        const same = prev && prev.target.nodeId === t.nodeId && Math.abs(prev.full[0] * scale - v.width) <= 1.01;
        full = scale >= 0.999 ? [v.width, v.height] : same && prev ? prev.full : [Math.round(v.width / scale), Math.round(v.height / scale)];
      } else {
        const fb = v.pin === 'flipbook' ? asFlipbook(v.data) : null;
        if (!fb) return null;
        const count = Math.max(1, Math.min(fb.frames ?? fb.cols * fb.rows, fb.cols * fb.rows));
        const f = ((s.flipFrame % count) + count) % count;
        flip = { cols: fb.cols, rows: fb.rows, count };
        src = { tex: fb.tex, kind: 0, sub: [(f % fb.cols) / fb.cols, Math.floor(f / fb.cols) / fb.rows, 1 / fb.cols, 1 / fb.rows] };
        full = [Math.round(fb.tex.width / fb.cols), Math.round(fb.tex.height / fb.rows)];
      }
      retainValue(v);
      return { value: v, src, full, flip, target: t, label: nodeLabel(t.nodeId), scale };
    }

    // Theme / scale / density change: redraw overlay + checkerboard + histogram with the new tokens.
    const onUiChanged = (): void => {
      hist.redraw();
      modelsDirty = true; // gizmo hit radii depend on the UI scale
      requestDraw();
    };
    window.addEventListener('kk-ui-change', onUiChanged);
    dis.add(() => window.removeEventListener('kk-ui-change', onUiChanged));

    dis.add(
      ctx.scheduler.onResult.on(({ result, scale, final }) => {
        if (!ctx.visible.get()) return;
        const t = target();
        if (!t) return;
        const e = result.errors.get(t.nodeId);
        err.style.display = e ? '' : 'none';
        err.textContent = e ?? '';
        const held = toHeld(result.values.get(targetKey(t)), t, scale, A);
        if (held) {
          const sizeChanged = !A || A.full[0] !== held.full[0] || A.full[1] !== held.full[1] || A.target.nodeId !== held.target.nodeId;
          setHeld('A', held);
          msg.style.display = 'none';
          if (sizeChanged) modelsDirty = true;
          if (sizeChanged && !s.fit && !prevHadImage) s.fit = true;
          prevHadImage = true;
        } else if (!e) {
          msg.style.display = '';
          msg.textContent = tt('viewport2d.thisOutputHasNo');
        }
        const ct = compareTarget();
        if (s.compare === 'node' && ct) setHeld('B', toHeld(result.values.get(targetKey(ct)), ct, scale, B));
        const ot = overlayTarget();
        setHeld('O', ot ? toHeld(result.values.get(targetKey(ot)), ot, scale, O) : null);
        lastFinal = final;
        if (final) scheduleAnalysis();
        modelsDirty = true;
        requestDraw();
      }),
    );
    let prevHadImage = false;

    /* ------------------------------------------------------------------------------------------ analysis */
    const analysisRegion = (): Region | null => {
      if (!region || !A) return null;
      const k = A.src.tex.width / A.full[0];
      const kx = k;
      const ky = A.src.tex.height / A.full[1];
      const x = Math.max(0, Math.floor(region.x0 * kx));
      const y = Math.max(0, Math.floor(region.y0 * ky));
      return { x, y, w: Math.max(1, Math.min(A.src.tex.width - x, Math.ceil((region.x1 - region.x0) * kx))), h: Math.max(1, Math.min(A.src.tex.height - y, Math.ceil((region.y1 - region.y0) * ky))) };
    };
    let analysisTimer = 0;
    function scheduleAnalysis(): void {
      if (!A || (!s.histogram && !region)) return;
      window.clearTimeout(analysisTimer);
      analysisTimer = window.setTimeout(() => {
        if (!A) return;
        const kind = A.src.kind;
        analyzer.analyze(A.src.tex, kind, analysisRegion(), (r) => {
          hist.setData(r, kind);
        });
      }, 60);
    }

    /* ------------------------------------------------------------------------------------------ gizmos */
    const controller = new GizmoController({
      view: () => curView,
      tiling: () => {
        const td = tileDisplay(s.tile);
        const [tx, ty] = tilingFlags(graph().settings.tiling);
        return { wrapX: tx || td.nx !== 1, wrapY: ty || td.ny !== 1, region: tileRegion(td, curView.size, curView.visibleImageRect(vw, vh)) };
      },
      beginGesture: (label) => {
        ctx.scheduler.beginInteraction();
        return ctx.editor.beginGesture(label, { onEnd: () => ctx.scheduler.endInteraction() });
      },
      invalidate: () => {
        if (rebuilding) return;
        modelsDirty = true;
        requestDraw();
      },
      requestNumeric: (req) => openNumeric(req),
      readout: (t) => {
        readout = t;
        requestDraw();
      },
    });

    function rebuildGizmos(): void {
      modelsDirty = false;
      rebuilding = true;
      try {
        if (!s.gizmos || !A) {
          controller.setModels([]);
          syncGizmoToolbar();
          return;
        }
        const g = graph();
        const nodes: { nodeId: string; decls: readonly GizmoDecl[]; values: Record<string, never> }[] = [];
        for (const id of app.selection.get()) {
          const n = g.nodes.get(id);
          const def = n ? g.registry.get(n.type) : undefined;
          if (n && def?.gizmos?.length) nodes.push({ nodeId: id, decls: def.gizmos, values: n.params as Record<string, never> });
        }
        const [tx, ty] = tilingFlags(g.settings.tiling);
        const snap = defaultSnap();
        snap.gridUv = s.snapGrid;
        snap.angleDeg = s.snapAngle;
        snap.targetsU = [0, 0.5, 1, ...s.guidesU];
        snap.targetsV = [0, 0.5, 1, ...s.guidesV];
        controller.setModels(buildNodeGizmos(nodes, { size: curView.size, tile: [tx, ty], snap, zoom: curView.zoom }, states));
        syncGizmoToolbar();
      } finally {
        rebuilding = false;
      }
    }

    /** Overlay mini-toolbar of the selected spline gizmo (Select / Add / Delete / Convert / Close / Flip / Mirror / Snap / Frame). */
    function syncGizmoToolbar(): void {
      const m = controller.getModels().find((x) => x.toolbar?.length);
      if (!m || !s.gizmos) return gzBar.update([], () => undefined);
      gzBar.update([...m.toolbar!, { id: 'frame', icon: '⛶', tip: `${t('spline.frame')} [F]`, separator: true, run: () => (fit(), null) }], (it) => {
        controller.runToolbar(m, it);
        requestDraw();
      });
    }

    function openNumeric(req: NumericRequest): void {
      closeNumeric?.();
      closeNumeric = showNumericPopup(
        stage,
        req.at,
        `${req.model.label} · ${req.handle.label}`,
        req.fields,
        (fieldId, value) => {
          // rebuild first so consecutive fields start from the CURRENT parameter values
          rebuildGizmos();
          const fresh = controller.getModels().find((m) => m.key === req.model.key) ?? req.model;
          controller.applyNumeric({ ...req, model: fresh }, fieldId, value);
          rebuildGizmos();
          requestDraw();
        },
        () => (closeNumeric = null),
      );
    }

    const graphSub = (): (() => void) =>
      graph().events.on((e) => {
        if (e.type === 'meta') return;
        modelsDirty = true;
        requestDraw();
      });
    let unsubGraph = graphSub();
    dis.add(() => unsubGraph());
    dis.add(
      app.project.onChange.on(() => {
        unsubGraph();
        unsubGraph = graphSub();
        setHeld('S', null);
        if (s.compare === 'snapshot') s.compare = 'off';
        register();
      }),
    );
    dis.add(app.selection.onChange.on(() => (s.targetMode === 'selection' ? register() : ((modelsDirty = true), requestDraw()))));
    dis.add(app.active.onChange.on(() => (s.targetMode === 'selection' && app.selection.primary ? undefined : register())));
    dis.add(ctx.visible.subscribe(() => register()));
    dis.add(
      app.engine.onRestored.on(() => {
        // pooled textures died with the device: forget them, the scheduler re-evaluates
        A = B = O = snapshot = null;
        requestDraw();
      }),
    );
    display.onPending = requestDraw;

    /* ------------------------------------------------------------------------------------------ frame */
    function viewState(): ViewState {
      return { zoom: s.zoom, cx: s.cx, cy: s.cy, rot: s.rot, flipX: s.flipX, flipY: s.flipY, imgW: A ? A.full[0] : 1024, imgH: A ? A.full[1] : 1024 };
    }
    const sphereRect = (): [number, number, number, number] | null => (A && A.src.kind === 3 && s.sphere && vw > 360 && vh > 300 ? [vw - 162, vh - 162, 150, 150] : null);
    const compareActive = (): Held | null => (s.compare === 'node' ? B : s.compare === 'snapshot' ? snapshot : null);

    function frame(): void {
      raf = 0;
      if (!dirty || !ctx.visible.get()) return;
      dirty = false;
      const cw = stage.clientWidth;
      const ch = stage.clientHeight;
      if (cw < 2 || ch < 2) return;
      vw = cw;
      vh = ch;
      dpr = display.resize(vw, vh);
      if (ov.width !== gpuCanvas.width || ov.height !== gpuCanvas.height) {
        ov.width = gpuCanvas.width;
        ov.height = gpuCanvas.height;
      }
      ovCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ovCtx.clearRect(0, 0, vw, vh);
      if (!A) {
        display.clear();
        return;
      }
      let st = viewState();
      if (s.fit) {
        const f = fitView(st, vw, vh, s.rulers ? 44 : 28);
        s.zoom = f.zoom;
        s.cx = f.cx;
        s.cy = f.cy;
        st = f;
      }
      curView = new ViewTransform(st);
      updateOwnerScale();
      if (modelsDirty) rebuildGizmos();
      const td = tileDisplay(s.tile);
      const [tx, ty] = tilingFlags(graph().settings.tiling);
      regionUv = tileRegionUv(td, curView.size, curView.visibleImageRect(vw, vh));
      const cmp = compareActive();
      const cmpPx = cmp ? (s.compareDir === 'v' ? s.comparePos * vw : s.comparePos * vh) : null;
      const sphere = sphereRect();
      display.draw({
        a: A.src,
        b: cmp ? cmp.src : null,
        o: s.overlay !== 'none' && O ? O.src : null,
        view: curView,
        dpr,
        s,
        regionLo: regionUv.lo,
        regionHi: regionUv.hi,
        wrap: A.flip ? [false, false] : [td.nx !== 1 || tx, td.ny !== 1 || ty],
        comparePx: cmpPx ?? 0,
        sphere,
      });
      drawViewOverlay({ ctx: ovCtx, view: curView, vw, vh, s, td, region, marker, comparePx: cmpPx, compareLabels: cmp ? [A.label, cmp.label] : null, sphere });
      if (s.gizmos) {
        drawGizmos(ovCtx, curView, controller.getModels(), (m) => controller.ghostsOf(m), {
          hover: controller.hover,
          active: controller.activeHandle,
          accent: '#9a8dff',
          readout,
          hoverShapes: controller.hoverShapes(lastMods),
        });
      }
      updateBar();
      zoomLabel.textContent = `${Math.round(curView.zoom * dpr * 100)}%`;
    }

    /* ------------------------------------------------------------------------------------------ bar */
    function updateBar(): void {
      if (!A) {
        barInfo.textContent = '';
        return;
      }
      const t = A.src.tex;
      const prev = A.scale < 1 ? ` · preview ${Math.round(A.scale * 100)}%${lastFinal ? '' : ' (refining)'}` : '';
      const tex = A.scale < 1 ? ` (texture ${t.width}×${t.height})` : '';
      barInfo.replaceChildren(h('b', {}, A.label), ` · ${A.full[0]}×${A.full[1]}${tex} · ${t.format} · ${KIND_NAMES[A.src.kind]} · ${formatBytes(t.bytes)}${prev}`);
      barFlip.style.display = A.flip ? '' : 'none';
      if (A.flip && barFlip.childElementCount === 0) {
        const range = h('input', { type: 'range', min: '0', max: String(A.flip.count - 1), value: String(s.flipFrame) }) as HTMLInputElement;
        range.addEventListener('input', () => {
          s.flipFrame = +range.value;
          ctx.scheduler.invalidate();
        });
        barFlip.append(
          iconButton('step-back', tt('viewport2d.previousFrame'), () => stepFrame(-1), { size: 12 }),
          iconButton('play', tt('viewport2d.playTheFlipbookAt'), () => toggleFlipPlay(), { size: 12 }),
          iconButton('step-fwd', tt('viewport2d.nextFrame'), () => stepFrame(1), { size: 12 }),
          range,
          h('span', { class: 'fl' }, ''),
        );
      }
      if (A.flip) {
        const l = barFlip.querySelector('.fl');
        if (l) l.textContent = `frame ${((s.flipFrame % A.flip.count) + A.flip.count) % A.flip.count + 1}/${A.flip.count} · ${A.flip.cols}×${A.flip.rows} grid`;
        (barFlip.querySelector('input') as HTMLInputElement).max = String(A.flip.count - 1);
      }
      renderCursorInfo();
    }
    /* flipbook mode is driven by REAL playback: its own wall-clock player at the graph fps, or the Timeline playhead. */
    let flipRaf = 0;
    function toggleFlipPlay(): void {
      if (flipRaf) {
        cancelAnimationFrame(flipRaf);
        flipRaf = 0;
        return;
      }
      const t0 = performance.now();
      const f0 = s.flipFrame;
      const tick = (): void => {
        if (!A?.flip) {
          flipRaf = 0;
          return;
        }
        const fps = app.project.graph.settings.fps;
        const n = Math.max(1, A.flip.count);
        const f = (((f0 + Math.floor(((performance.now() - t0) / 1000) * fps)) % n) + n) % n;
        if (f !== s.flipFrame) {
          s.flipFrame = f;
          ctx.scheduler.invalidate();
          requestDraw();
        }
        flipRaf = requestAnimationFrame(tick);
      };
      flipRaf = requestAnimationFrame(tick);
    }
    dis.add(() => flipRaf && cancelAnimationFrame(flipRaf));
    dis.add(
      app.engine.playback.onChange.on(() => {
        const pbk = app.engine.playback;
        if (!pbk.playing || !A?.flip || flipRaf) return;
        const f = Math.floor(pbk.frame - pbk.range().start);
        if (f !== s.flipFrame) s.flipFrame = f;
      }),
    );
    function stepFrame(d: number): void {
      s.flipFrame += d;
      ctx.scheduler.invalidate();
      requestDraw();
    }
    function renderCursorInfo(): void {
      const i = lastInspect;
      if (!i || !A) {
        barCursor.textContent = '';
        return;
      }
      const v = i.values;
      const f = (x: number): string => x.toFixed(4);
      let vals = '…';
      let sw = '';
      if (v) {
        switch (A.src.kind) {
          case 1:
            vals = `Gray ${f(v[0])}`;
            break;
          case 2:
            vals = `U ${f(v[0])}  V ${f(v[1])}`;
            break;
          case 4:
            vals = `Vx ${f(v[0])}  Vy ${f(v[1])}  |V| ${f(Math.hypot(v[0], v[1]))}  ∠ ${f((Math.atan2(v[1], v[0]) * 180) / Math.PI)}°`;
            break;
          case 3:
            vals = `N ${f(v[0] * 2 - 1)}, ${f(v[1] * 2 - 1)}, ${f(v[2] * 2 - 1)}`;
            break;
          default:
            vals = `R ${f(v[0])}  G ${f(v[1])}  B ${f(v[2])}  A ${f(v[3])}`;
            sw = `rgb(${[0, 1, 2].map((k) => Math.round(Math.min(1, Math.max(0, srgb(v[k]))) * 255)).join(',')})`;
        }
      }
      barCursor.replaceChildren(sw ? h('span', { class: 'sw', style: { background: sw } }) : '', `px ${i.px[0]}, ${i.px[1]} · uv ${i.uv[0].toFixed(3)}, ${i.uv[1].toFixed(3)} · `, h('b', {}, vals));
    }
    const srgb = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

    /* ------------------------------------------------------------------------------------------ inspector */
    function inspect(sp: V2): void {
      inspectReq = sp;
      if (inspectRaf) return;
      inspectRaf = requestAnimationFrame(() => {
        inspectRaf = 0;
        const p = inspectReq;
        inspectReq = null;
        if (!p || !A || !s.inspector) return;
        const ip = curView.toImage(p);
        const uv: V2 = [ip[0] / A.full[0], ip[1] / A.full[1]];
        const inside = uv[0] >= regionUv.lo[0] && uv[0] < regionUv.hi[0] && uv[1] >= regionUv.lo[1] && uv[1] < regionUv.hi[1];
        if (!inside) {
          lastInspect = null;
          marker = null;
          renderCursorInfo();
          requestDraw();
          return;
        }
        const w: V2 = [uv[0] - Math.floor(uv[0]), uv[1] - Math.floor(uv[1])];
        const sub = A.src.sub ?? [0, 0, 1, 1];
        const t = A.src.tex;
        const tx = Math.min(t.width - 1, Math.max(0, Math.floor((sub[0] + w[0] * sub[2]) * t.width)));
        const ty = Math.min(t.height - 1, Math.max(0, Math.floor((sub[1] + w[1] * sub[3]) * t.height)));
        const px: V2 = [Math.floor(w[0] * A.full[0]), Math.floor(w[1] * A.full[1])];
        lastInspect = { texel: [tx, ty], values: null, uv: w, px };
        marker = { x: Math.floor(ip[0]), y: Math.floor(ip[1]), w: 1, h: 1 };
        renderCursorInfo();
        requestDraw();
        analyzer.readPixel(t, tx, ty, (vals) => {
          if (lastInspect && lastInspect.texel[0] === tx && lastInspect.texel[1] === ty) {
            lastInspect.values = vals;
            renderCursorInfo();
          }
        });
      });
    }

    /* ------------------------------------------------------------------------------------------ input */
    const modsOf = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Mods => ({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
    let lastMods: Mods = { ctrl: false, shift: false, alt: false };
    const posOf = (e: MouseEvent): V2 => {
      const r = ov.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    type Drag =
      | { k: 'pan'; last: V2 }
      | { k: 'guide'; axis: 0 | 1; idx: number }
      | { k: 'cmp' }
      | { k: 'light' }
      | { k: 'region'; start: V2 }
      | { k: 'gizmo' };
    let drag: Drag | null = null;
    const axisX = (): 0 | 1 => (s.rot % 2 === 1 ? 1 : 0);
    const guides = (axis: 0 | 1): number[] => (axis === 0 ? s.guidesU : s.guidesV);

    const userView = (): void => {
      s.fit = false;
      modelsDirty = true;
      requestDraw();
    };
    const setZoomPct = (pct: number, at?: V2): void => {
      const st = viewState();
      const z = pct / 100 / dpr;
      const o = s.fit ? { ...st, zoom: s.zoom, cx: s.cx, cy: s.cy } : st;
      const n = zoomAt(o, at ?? [vw / 2, vh / 2], z / o.zoom);
      s.zoom = n.zoom;
      s.cx = n.cx;
      s.cy = n.cy;
      userView();
    };
    const rotateView = (q: number): void => {
      s.rot = ((s.rot + q) % 4) as 0 | 1 | 2 | 3;
      if (s.fit) fit();
      else userView();
    };
    const fit = (): void => {
      s.fit = true;
      modelsDirty = true;
      requestDraw();
    };
    const lightFrom = (p: V2): void => {
      const r = sphereRect();
      if (!r) return;
      const rx = Math.min(1, Math.max(0, (p[0] - r[0]) / r[2]));
      const ry = Math.min(1, Math.max(0, (p[1] - r[1]) / r[3]));
      s.light = [(rx - 0.5) * 170, 85 - ry * 95];
      requestDraw();
    };

    dis.add(
      listen(ov, 'pointerdown', (e: PointerEvent) => {
        ov.focus();
        closeNumeric?.();
        const sp = posOf(e);
        lastMods = modsOf(e);
        if (e.button === 1 || (e.button === 0 && spaceDown)) {
          drag = { k: 'pan', last: sp };
          ov.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
        }
        if (e.button !== 0 || !A) return;
        // rulers: drag out a guide
        if (s.rulers && (sp[1] < RULER || sp[0] < RULER)) {
          const ga = (sp[1] < RULER ? 1 - axisX() : axisX()) as 0 | 1;
          const uv = curView.toUv(sp);
          guides(ga).push(uv[ga]);
          drag = { k: 'guide', axis: ga, idx: guides(ga).length - 1 };
          ov.setPointerCapture(e.pointerId);
          return;
        }
        const cmp = compareActive();
        if (cmp) {
          const px = s.compareDir === 'v' ? s.comparePos * vw : s.comparePos * vh;
          if (Math.abs((s.compareDir === 'v' ? sp[0] : sp[1]) - px) < 9) {
            drag = { k: 'cmp' };
            ov.setPointerCapture(e.pointerId);
            return;
          }
        }
        const sr = sphereRect();
        if (sr && sp[0] >= sr[0] && sp[0] <= sr[0] + sr[2] && sp[1] >= sr[1] && sp[1] <= sr[1] + sr[3]) {
          drag = { k: 'light' };
          lightFrom(sp);
          ov.setPointerCapture(e.pointerId);
          return;
        }
        if (s.gizmos && controller.pointerDown(sp, lastMods)) {
          drag = { k: 'gizmo' };
          ov.setPointerCapture(e.pointerId);
          return;
        }
        for (const axis of [0, 1] as const) {
          const list = guides(axis);
          for (let i = 0; i < list.length; i++) {
            if (distToGuide(curView, axis, list[i], sp) < 5) {
              drag = { k: 'guide', axis, idx: i };
              ov.setPointerCapture(e.pointerId);
              return;
            }
          }
        }
        if (s.regionTool) {
          drag = { k: 'region', start: curView.toImage(sp) };
          region = null;
        } else drag = { k: 'pan', last: sp };
        ov.setPointerCapture(e.pointerId);
      }),
    );
    dis.add(
      listen(ov, 'pointermove', (e: PointerEvent) => {
        const sp = posOf(e);
        lastMods = modsOf(e);
        if (drag) {
          switch (drag.k) {
            case 'pan':
              s.cx += sp[0] - drag.last[0];
              s.cy += sp[1] - drag.last[1];
              drag.last = sp;
              s.fit = false;
              modelsDirty = true;
              requestDraw();
              break;
            case 'gizmo':
              controller.pointerMove(sp, lastMods);
              ov.style.cursor = controller.cursor;
              break;
            case 'guide': {
              const uv = curView.toUv(sp);
              guides(drag.axis)[drag.idx] = uv[drag.axis];
              modelsDirty = true;
              requestDraw();
              break;
            }
            case 'cmp':
              s.comparePos = Math.min(1, Math.max(0, s.compareDir === 'v' ? sp[0] / vw : sp[1] / vh));
              requestDraw();
              break;
            case 'light':
              lightFrom(sp);
              break;
            case 'region': {
              const ip = curView.toImage(sp);
              const [W, H] = curView.size;
              region = { x0: Math.max(0, Math.min(drag.start[0], ip[0])), y0: Math.max(0, Math.min(drag.start[1], ip[1])), x1: Math.min(W, Math.max(drag.start[0], ip[0])), y1: Math.min(H, Math.max(drag.start[1], ip[1])) };
              requestDraw();
              break;
            }
          }
          return;
        }
        if (s.gizmos) {
          controller.pointerMove(sp, lastMods);
          ov.style.cursor = spaceDown ? 'grab' : controller.cursor;
        }
        if (s.inspector) inspect(sp);
      }),
    );
    const endDrag = (e: PointerEvent): void => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.k === 'gizmo') controller.pointerUp();
      if (d.k === 'guide') {
        const sp = posOf(e);
        if (s.rulers && (sp[1] < RULER || sp[0] < RULER)) guides(d.axis).splice(d.idx, 1); // dragged back into the ruler = delete
        modelsDirty = true;
      }
      if (d.k === 'region') {
        if (region && (region.x1 - region.x0 < 2 || region.y1 - region.y0 < 2)) region = null;
        scheduleAnalysis();
        if (region && !s.histogram) {
          s.histogram = true;
          hist.el.style.display = '';
        }
        if (!region) hist.redraw();
      }
      try {
        ov.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      requestDraw();
    };
    dis.add(listen(ov, 'pointerup', endDrag));
    dis.add(listen(ov, 'pointercancel', endDrag));
    dis.add(
      listen(ov, 'pointerleave', () => {
        if (!drag) {
          controller.pointerLeave();
          lastInspect = null;
          marker = null;
          renderCursorInfo();
          requestDraw();
        }
      }),
    );
    dis.add(
      listen(
        ov,
        'wheel',
        (e: WheelEvent) => {
          e.preventDefault();
          const m = modsOf(e);
          const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
          if (s.gizmos && m.alt && controller.wheel(dy, m)) return;
          if (!A) return;
          const st = { ...viewState(), zoom: s.zoom, cx: s.cx, cy: s.cy };
          const n = zoomAt(st, posOf(e), Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
          s.zoom = n.zoom;
          s.cx = n.cx;
          s.cy = n.cy;
          userView();
        },
        { passive: false },
      ),
    );
    dis.add(
      listen(ov, 'dblclick', (e: MouseEvent) => {
        if (!A) return;
        if (s.gizmos && controller.doubleClick(posOf(e))) return;
        fit();
      }),
    );
    dis.add(
      listen(ov, 'contextmenu', (e: MouseEvent) => {
        e.preventDefault();
        if (!A) return;
        const sp = posOf(e);
        const items: MenuItem[] = [];
        const acts = s.gizmos ? controller.actionsAt(sp) : [];
        for (const { model, action } of acts) items.push({ label: action.label, danger: action.danger, disabled: action.disabled, action: () => (controller.runAction(model, action), requestDraw()) });
        if (items.length) items.push({ separator: true });
        const uv = curView.toUv(sp);
        items.push(
          { label: tt('viewport2d.fitToView'), shortcut: 'F', action: fit },
          { label: tt('viewport2d.zoom100'), shortcut: '1', action: () => setZoomPct(100) },
          { label: tt('viewport2d.addVerticalGuideHere'), action: () => ((s.rulers = true), s.guidesU.push(uv[0]), (modelsDirty = true), requestDraw()) },
          { label: tt('viewport2d.addHorizontalGuideHere'), action: () => ((s.rulers = true), s.guidesV.push(uv[1]), (modelsDirty = true), requestDraw()) },
          { label: tt('viewport2d.clearGuides'), disabled: !s.guidesU.length && !s.guidesV.length, action: () => ((s.guidesU = []), (s.guidesV = []), (modelsDirty = true), requestDraw()) },
          { label: tt('viewport2d.clearRegion'), disabled: !region, action: () => ((region = null), scheduleAnalysis(), requestDraw()) },
          { separator: true },
          ...moreMenu(),
        );
        contextMenu(e, items);
      }),
    );
    dis.add(
      listen(ov, 'keydown', (e: KeyboardEvent) => {
        lastMods = modsOf(e);
        if (e.code === 'Space') {
          spaceDown = true;
          ov.style.cursor = 'grab';
          e.preventDefault();
          return;
        }
        if (s.gizmos && controller.key(e.key, lastMods)) {
          e.preventDefault();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        let used = true;
        if (k === 'f') fit();
        else if (k === '1') setZoomPct(100);
        else if (k === '2') setZoomPct(200);
        else if (k === '+' || k === '=') setZoomPct(curView.zoom * dpr * 100 * 1.25, [vw / 2, vh / 2]);
        else if (k === '-') setZoomPct((curView.zoom * dpr * 100) / 1.25, [vw / 2, vh / 2]);
        else if (k === 'r') rotateView(e.shiftKey ? 3 : 1);
        else if (k === 'g') toggleGizmos();
        else used = false;
        if (used) e.preventDefault();
      }),
    );
    dis.add(
      listen(ov, 'keyup', (e: KeyboardEvent) => {
        lastMods = modsOf(e);
        if (e.code === 'Space') {
          spaceDown = false;
          ov.style.cursor = controller.cursor;
        }
      }),
    );
    dis.add(observeSize(stage, () => requestDraw()));

    /* ------------------------------------------------------------------------------------------ toolbar */
    const zoomLabel = h('span', { class: 'k-dim', style: { minWidth: '2.6rem', textAlign: 'right' } }, '100%');
    const toggleGizmos = (): void => {
      s.gizmos = !s.gizmos;
      modelsDirty = true;
      rebuildToolbarState();
      requestDraw();
    };
    const toggleHist = (): void => {
      s.histogram = !s.histogram;
      hist.el.style.display = s.histogram ? '' : 'none';
      if (s.histogram) scheduleAnalysis();
      rebuildToolbarState();
    };
    const setTile = (v: TileMode): void => {
      s.tile = v;
      modelsDirty = true;
      requestDraw();
    };
    const ck = (label: string, get: () => boolean, set: (v: boolean) => void): MenuItem => ({
      label,
      checked: get(),
      keepOpen: true,
      action: () => {
        set(!get());
        modelsDirty = true;
        rebuildToolbarState();
        requestDraw();
      },
    });
    const radio = <T,>(label: string, get: () => T, val: T, set: (v: T) => void): MenuItem => ({ label, checked: get() === val, action: () => (set(val), requestDraw()) });

    function moreMenu(): MenuItem[] {
      return [
        { header: 'Display' },
        { label: 'Filtering', submenu: () => [radio('Point (nearest)', () => s.filter, 0, (v) => (s.filter = v)), radio('Bilinear', () => s.filter, 1, (v) => (s.filter = v)), radio('Bicubic', () => s.filter, 2, (v) => (s.filter = v)), { separator: true }, ck('Nearest at high zoom', () => s.autoNearest, (v) => (s.autoNearest = v)), ck('Pixel grid', () => s.pixelGrid, (v) => (s.pixelGrid = v))] },
        { label: 'Alpha', submenu: () => [radio('Straight (composite)', () => s.alpha, 'straight', (v) => (s.alpha = v)), radio('Premultiplied', () => s.alpha, 'premult', (v) => (s.alpha = v)), radio('Ignore alpha (opaque)', () => s.alpha, 'opaque', (v) => (s.alpha = v))] },
        { label: 'Background', submenu: () => [radio('Checkerboard', () => s.bg, 'checker', (v) => (s.bg = v)), radio('Black', () => s.bg, 'black', (v) => (s.bg = v)), radio('Mid gray', () => s.bg, 'mid', (v) => (s.bg = v)), radio('White', () => s.bg, 'white', (v) => (s.bg = v)), { label: tt('viewport2d.customColor'), action: pickBg }] },
        { label: tt('viewport2d.grayHeatRamp'), submenu: () => [radio('Turbo', () => s.heatPal, 0, (v) => (s.heatPal = v as 0)), radio('Magma', () => s.heatPal, 1, (v) => (s.heatPal = v as 1)), { label: tt('viewport2d.range01'), action: () => ((s.rangeLo = 0), (s.rangeHi = 1), requestDraw()) }, { label: tt('viewport2d.rangeFromHistogramMinMax'), action: autoRange }] },
        { label: tt('viewport2d.uvVectors'), submenu: () => [radio('Absolute coordinates', () => s.uvMode, 'absolute', (v) => (s.uvMode = v)), radio('Signed offset', () => s.uvMode, 'offset', (v) => (s.uvMode = v)), radio('Flowmap (0..1 → -1..1)', () => s.uvMode, 'flowmap', (v) => (s.uvMode = v)), { separator: true }, { label: tt('viewport2d.denserArrows'), action: () => ((s.arrowCell = Math.max(12, s.arrowCell - 6)), requestDraw()) }, { label: tt('viewport2d.sparserArrows'), action: () => ((s.arrowCell = Math.min(80, s.arrowCell + 6)), requestDraw()) }, { label: tt('viewport2d.longerArrows'), action: () => ((s.arrowGain *= 1.5), requestDraw()) }, { label: tt('viewport2d.shorterArrows'), action: () => ((s.arrowGain /= 1.5), requestDraw()) }, { separator: true }, { label: tt('viewport2d.longerStreamlines'), action: () => ((s.licStep = Math.min(6, s.licStep * 1.5)), requestDraw()) }, { label: tt('viewport2d.shorterStreamlines'), action: () => ((s.licStep = Math.max(0.4, s.licStep / 1.5)), requestDraw()) }, { label: tt('viewport2d.denserSeeds'), action: () => ((s.licGrain = Math.max(0.75, s.licGrain / 1.5)), requestDraw()) }, { label: tt('viewport2d.sparserSeeds'), action: () => ((s.licGrain = Math.min(12, s.licGrain * 1.5)), requestDraw()) }] },
        {
          label: tt('viewport2d.simOverlay'),
          submenu: () => [
            ...(['none', 'arrows', 'lic', 'pressure', 'divergence', 'curl'] as const).map((m) => ({ label: tt(`viewport2d.overlay.${m}` as const), checked: s.overlay === m, action: () => ((s.overlay = m), register()) })),
            { separator: true },
            { label: tt('viewport2d.overlayStronger'), action: () => ((s.overlayGain *= 1.5), requestDraw()) },
            { label: tt('viewport2d.overlayWeaker'), action: () => ((s.overlayGain /= 1.5), requestDraw()) },
          ],
        },
        { label: tt('viewport2d.normalMaps'), submenu: () => [ck('Flip green (DirectX)', () => s.flipG, (v) => (s.flipG = v)), ck('Lit sphere preview', () => s.sphere, (v) => (s.sphere = v))] },
        { separator: true },
        { header: 'View' },
        { label: tt('viewport2d.rotate90Clockwise'), shortcut: 'R', action: () => ((s.rot = ((s.rot + 1) % 4) as 0 | 1 | 2 | 3), s.fit ? fit() : userView()) },
        { label: tt('viewport2d.rotate90CounterClockwise'), shortcut: 'Shift+R', action: () => ((s.rot = ((s.rot + 3) % 4) as 0 | 1 | 2 | 3), s.fit ? fit() : userView()) },
        ck('Flip horizontal', () => s.flipX, (v) => (s.flipX = v)),
        ck('Flip vertical', () => s.flipY, (v) => (s.flipY = v)),
        { label: tt('viewport2d.resetViewOrientation'), action: () => ((s.rot = 0), (s.flipX = false), (s.flipY = false), fit()) },
        { separator: true },
        { header: tt('viewport2d.analysisGuides') },
        ck('Seam highlight', () => s.seam, (v) => (s.seam = v)),
        ck('Pixel inspector', () => s.inspector, (v) => (s.inspector = v)),
        ck('Histogram log scale', () => s.histLog, (v) => ((s.histLog = v), (hist.log = v), hist.redraw())),
        ck('Region tool (drag to measure)', () => s.regionTool, (v) => (s.regionTool = v)),
        ck('Rulers', () => s.rulers, (v) => ((s.rulers = v), s.fit && fit())),
        ck('Rule of thirds', () => s.thirds, (v) => (s.thirds = v)),
        ck('Safe frame', () => s.safe, (v) => (s.safe = v)),
        { separator: true },
        { header: tt('viewport2d.gizmoSnappingHoldCtrl') },
        { label: tt('viewport2d.gridStep'), submenu: () => [1 / 4, 1 / 8, 1 / 16, 1 / 32, 1 / 64].map((g) => radio(`1/${Math.round(1 / g)} of the image`, () => s.snapGrid, g, (v) => ((s.snapGrid = v), (modelsDirty = true)))) },
        { label: tt('viewport2d.angleStep'), submenu: () => [5, 15, 30, 45, 90].map((a) => radio(`${a}°`, () => s.snapAngle, a, (v) => ((s.snapAngle = v), (modelsDirty = true)))) },
      ];
    }
    function pickBg(): void {
      const inp = h('input', { type: 'color', value: s.bgColor }) as HTMLInputElement;
      inp.addEventListener('input', () => {
        s.bgColor = inp.value;
        s.bg = 'custom';
        requestDraw();
      });
      inp.click();
    }
    function autoRange(): void {
      if (!A) return;
      analyzer.analyze(A.src.tex, A.src.kind, null, (r) => {
        s.rangeLo = r.min[0];
        s.rangeHi = Math.max(r.max[0], r.min[0] + 1e-4);
        s.viz = 'heat';
        requestDraw();
      });
    }

    const targetDrop = new Dropdown(
      { options: [{ value: 'selection', label: tt('viewport2d.selectedNode') }, { value: 'active', label: tt('viewport2d.activeTarget') }, { value: 'pinned', label: 'Pinned' }], value: s.targetMode, tip: tt('viewport2d.whichNodeThisViewport') },
      {
        onInput: (v) => {
          s.targetMode = v as typeof s.targetMode;
          if (s.targetMode === 'pinned' && !s.pinned) s.pinned = target();
          register();
        },
      },
    );
    targetDrop.el.style.maxWidth = '8.5rem';
    const pinBtn = iconButton('pin', tt('viewport2d.pinThisViewportTo'), () => {
      const t = target();
      if (!t) return;
      s.pinned = t;
      s.targetMode = s.targetMode === 'pinned' ? 'selection' : 'pinned';
      targetDrop.set(s.targetMode);
      register();
    });
    const pinDrop = new Dropdown({ options: [], value: '', tip: tt('viewport2d.outputPin') }, {
      onInput: (v) => {
        const t = target();
        if (!t) return;
        pinChoice.set(t.nodeId, v);
        if (s.targetMode === 'pinned' && s.pinned) s.pinned = { nodeId: t.nodeId, pinId: v };
        register();
      },
    });
    pinDrop.el.style.display = 'none';
    pinDrop.el.style.maxWidth = '7rem';
    const channelSeg = new Segmented<ChannelMode>(
      { options: [{ value: 'rgb', label: 'RGB', tip: 'Colour' }, { value: 'r', label: 'R' }, { value: 'g', label: 'G' }, { value: 'b', label: 'B' }, { value: 'a', label: 'A' }, { value: 'luma', label: 'L', tip: 'Luminance' }], value: s.channel },
      { onInput: (v) => ((s.channel = v), requestDraw()) },
    );
    const vizDrop = new Dropdown(
      { options: [{ value: 'none', label: tt('viewport2d.normalView') }, { value: 'heat', label: tt('viewport2d.falseColourHeat') }, { value: 'arrows', label: tt('viewport2d.uvArrows') }, { value: 'lic', label: tt('viewport2d.uvStreamlines') }], value: s.viz, tip: 'Visualisation' },
      { onInput: (v) => ((s.viz = v as VizMode), requestDraw()) },
    );
    vizDrop.el.style.maxWidth = '8rem';
    const tileDrop = new Dropdown({ options: (Object.keys(TILE_LABELS) as TileMode[]).map((k) => ({ value: k, label: `Tile ${TILE_LABELS[k]}` })), value: s.tile, tip: tt('viewport2d.tilingPreviewShaderSideRepea') }, { onInput: (v) => setTile(v as TileMode) });
    tileDrop.el.style.maxWidth = '9rem';
    const ev = new NumberField({ value: s.exposure, min: -10, max: 10, step: 0.05, precision: 2, unit: 'EV', tip: tt('viewport2d.exposureStops') }, { onInput: (v) => ((s.exposure = v), requestDraw()) });
    const gam = new NumberField({ value: s.gamma, min: 0.2, max: 5, step: 0.05, precision: 2, unit: 'γ', tip: tt('viewport2d.displayGamma') }, { onInput: (v) => ((s.gamma = v), requestDraw()) });
    const zoomBtn = h('button', { class: 'k-drop', tip: tt('viewport2d.zoomPresets'), onclick: (e: Event) => menuBelow(e.currentTarget as HTMLElement, [{ label: 'Fit', shortcut: 'F', action: fit }, ...[12.5, 25, 50, 100, 200, 400, 800, 1600].map((p) => ({ label: `${p}%`, action: () => setZoomPct(p) }))]) }, zoomLabel);
    const gizBtn = iconButton('transform', tt('viewport2d.gizmosG'), toggleGizmos);
    const histBtn = iconButton('channels', tt('viewport2d.histogramStatistics'), toggleHist);
    const cmpBtn = iconButton('layout', tt('viewport2d.aBCompare'), (e) => menuBelow(e.currentTarget as HTMLElement, compareMenu));
    const moreBtn = iconButton('more', tt('viewport2d.viewOptions'), (e) => menuBelow(e.currentTarget as HTMLElement, moreMenu));
    const rotBtn = iconButton('refresh', tt('viewport2d.rotateView90R'), () => ((s.rot = ((s.rot + 1) % 4) as 0 | 1 | 2 | 3), s.fit ? fit() : userView()));
    const sp1 = h('span', { class: 'k-sp' });

    function compareMenu(): MenuItem[] {
      const nodes = [...graph().nodes.values()].filter((n) => textureOutputs(n.id).length).slice(0, 80);
      return [
        { label: 'Off', checked: s.compare === 'off', action: () => setCompare('off') },
        { label: tt('viewport2d.snapshotOfTheCurrent'), disabled: !A, action: takeSnapshot },
        { label: tt('viewport2d.compareWithNode'), submenu: nodes.map((n) => ({ label: n.name || n.type, checked: s.compareNode?.nodeId === n.id && s.compare === 'node', action: () => ((s.compareNode = { nodeId: n.id }), setCompare('node')) })) },
        { separator: true },
        { label: tt('viewport2d.verticalDivider'), checked: s.compareDir === 'v', action: () => ((s.compareDir = 'v'), requestDraw()) },
        { label: tt('viewport2d.horizontalDivider'), checked: s.compareDir === 'h', action: () => ((s.compareDir = 'h'), requestDraw()) },
        { label: tt('viewport2d.discardSnapshot'), disabled: !snapshot, action: () => (setHeld('S', null), s.compare === 'snapshot' && setCompare('off')) },
      ];
    }
    function setCompare(m: typeof s.compare): void {
      s.compare = m;
      if (m !== 'node') setHeld('B', null);
      register();
    }
    function takeSnapshot(): void {
      if (!A) return;
      retainValue(A.value);
      setHeld('S', { ...A, label: tt('viewport2d.snapshot', { label: A.label }) });
      setCompare('snapshot');
    }

    toolbar.append(targetDrop.el, pinBtn, pinDrop.el, channelSeg.el, vizDrop.el, tileDrop.el, h('span', { class: 'k-dim' }, 'EV'), ev.el, gam.el, sp1, rotBtn, zoomBtn, gizBtn, histBtn, cmpBtn, moreBtn);

    function rebuildToolbarState(): void {
      gizBtn.classList.toggle('active', s.gizmos);
      histBtn.classList.toggle('active', s.histogram);
      cmpBtn.classList.toggle('active', s.compare !== 'off');
      pinBtn.classList.toggle('active', s.targetMode === 'pinned');
      const t = target();
      const outs = t ? textureOutputs(t.nodeId) : [];
      pinDrop.el.style.display = outs.length > 1 ? '' : 'none';
      if (outs.length > 1) {
        pinDrop.setOptions(outs.map((o) => ({ value: o.id, label: o.name })));
        pinDrop.set(t?.pinId ?? outs[0].id);
      }
      hist.el.style.display = s.histogram ? '' : 'none';
      hist.log = s.histLog;
    }

    rebuildToolbarState();
    register();
    requestDraw();

    return {
      dispose: () => {
        window.clearTimeout(analysisTimer);
        if (raf) cancelAnimationFrame(raf);
        if (inspectRaf) cancelAnimationFrame(inspectRaf);
        closeNumeric?.();
        ctx.scheduler.clearOwner(ctx.instanceId);
        setHeld('A', null);
        setHeld('B', null);
        setHeld('S', null);
        dis.dispose();
      },
      resize: () => requestDraw(),
      focus: () => ov.focus(),
      serialize: () => ({ ...s, compare: s.compare === 'snapshot' ? 'off' : s.compare }),
    };
  },
});

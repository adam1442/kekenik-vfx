import type { GizmoDecl } from '../engine/graph/gizmo-decl';
import type { ParamGesture } from '../engine/commands/gesture';
import { cloneValue, valuesEqual, type ParamValue, type ParamValues, type SplineValue } from '../engine/params/schema';
import { h } from '../ui/core/dom';
import { buildNodeGizmos, defaultSnap, drawGizmos, fitView, GizmoController, GizmoStateStore, ghostOffsets, hitDistance, tileRegion, ViewTransform, zoomAt, type Mods, type NumericRequest, type V2, type ViewState } from './index';

/**
 * GIZMO TEST PAGE (#gizmo-test / gizmotest.html). Runs the REAL framework (models, controller, renderer) against a
 * mock parameter store: every gizmo type on one checker image, tiling ghosts, snapping, numeric entry, undo/redo,
 * a live write log and in-page self-checks. No WebGPU needed.
 */
const SIZE: V2 = [512, 512];

const DECLS: GizmoDecl[] = [
  { id: 'point', type: 'point', viewport: '2d', param: 'pt', label: 'Point' },
  { id: 'circle', type: 'circle', viewport: '2d', center: 'cc', radius: 'cr', label: 'Circle' },
  { id: 'rect', type: 'rect', viewport: '2d', center: 'rc', size: 'rs', rotation: 'rr', label: 'Rect' },
  { id: 'line', type: 'line', viewport: '2d', from: 'l0', to: 'l1', label: 'Line' },
  { id: 'ray', type: 'line', viewport: '2d', origin: 'lo', angle: 'la', length: 'll', label: 'Ray' },
  { id: 'angle', type: 'angle', viewport: '2d', center: 'ac', angle: 'aa', label: 'Angle' },
  { id: 'falloff', type: 'falloff', viewport: '2d', center: 'fc', inner: 'fi', outer: 'fo', label: 'Falloff' },
  { id: 'range', type: 'range', viewport: '2d', min: 'rmin', max: 'rmax', label: 'Range' },
  { id: 'grid', type: 'grid', viewport: '2d', cells: 'gc', tilingSafe: true, label: 'Grid' },
  { id: 'xf', type: 'transform', viewport: '2d', position: 'tp', rotation: 'tr', scale: { param: 'ts', map: { reciprocal: true } }, tilingSafe: true, label: 'Transform2D' },
  { id: 'path', type: 'path', viewport: '2d', param: 'sp', label: 'Spline' },
  { id: 'brush', type: 'brush', viewport: '2d', radius: 'br', strokes: 'bs', label: 'Brush' },
];

const INITIAL: ParamValues = {
  pt: [0.12, 0.12],
  cc: [0.8, 0.2],
  cr: 0.1,
  rc: [0.3, 0.72],
  rs: [0.3, 0.16],
  rr: 15,
  l0: [0.55, 0.45],
  l1: [0.9, 0.55],
  lo: [0.1, 0.45],
  la: 20,
  ll: 0.25,
  ac: [0.7, 0.8],
  aa: 40,
  fc: [0.5, 0.5],
  fi: 0.08,
  fo: 0.22,
  rmin: 0.2,
  rmax: 0.7,
  gc: [8, 8],
  tp: [0.5, 0.5],
  tr: 0,
  ts: [4, 4],
  sp: { closed: false, points: [{ x: 0.1, y: 0.9, mode: 'auto', w: 0.04 }, { x: 0.4, y: 0.6, mode: 'auto', w: 0.06 }, { x: 0.7, y: 0.9, mode: 'auto', w: 0.03 }] } satisfies SplineValue,
  br: 0.06,
  bs: '',
};
const DEFAULT_ON = new Set(['point', 'circle', 'rect', 'line', 'xf', 'path']);

export function mountGizmoTest(root: HTMLElement): void {
  const style = h('style', {}, `
    .gt{display:grid;grid-template-columns:1fr 340px;height:100vh;background:#121316;color:#d6d9de;font:12px system-ui,sans-serif}
    .gt canvas{width:100%;height:100%;display:block;touch-action:none;outline:none}
    .gt aside{border-left:1px solid #2a2d33;overflow:auto;padding:10px;display:flex;flex-direction:column;gap:8px}
    .gt h3{margin:6px 0 2px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8d93a0}
    .gt button,.gt select{background:#23262c;color:#d6d9de;border:1px solid #363a42;border-radius:4px;padding:3px 8px;font:inherit;cursor:pointer}
    .gt button:hover{border-color:#7c6cf0}
    .gt label{display:flex;align-items:center;gap:6px}
    .gt pre{margin:0;background:#0b0c0e;border:1px solid #2a2d33;border-radius:4px;padding:6px;max-height:190px;overflow:auto;font:11px ui-monospace,monospace;white-space:pre-wrap}
    .gt .ok{color:#6fdc8c}.gt .bad{color:#ff7b72}
    .gt .row{display:flex;gap:6px;flex-wrap:wrap}
    .gt .num{position:absolute;background:#1b1d22;border:1px solid #9a8dff;border-radius:4px;padding:6px;display:grid;grid-template-columns:auto 90px;gap:4px 6px;z-index:5}
    .gt .num input{background:#0e0f12;color:#fff;border:1px solid #363a42;border-radius:3px;padding:2px 4px;font:inherit}
  `);
  const canvas = h('canvas', { tabindex: '0' });
  const stage = h('div', { style: { position: 'relative', minWidth: '0' } }, canvas);
  const log = h('pre');
  const json = h('pre');
  const checks = h('pre');
  const side = h('aside');
  root.replaceChildren(style, h('div', { class: 'gt' }, stage, side));

  /* ---------- mock parameter store with ParamGesture semantics (same contract as GraphEditor.beginGesture) ---------- */
  const params: ParamValues = cloneValue(INITIAL as never) as ParamValues;
  const undo: { label: string; before: Record<string, ParamValue>; after: Record<string, ParamValue> }[] = [];
  const redo: typeof undo = [];
  const say = (t: string): void => {
    log.textContent = `${t}\n${log.textContent ?? ''}`.split('\n').slice(0, 40).join('\n');
  };
  const apply = (v: Record<string, ParamValue>): void => {
    for (const [k, x] of Object.entries(v)) params[k] = cloneValue(x);
  };
  const beginGesture = (label: string): ParamGesture => {
    const before: Record<string, ParamValue> = {};
    const after: Record<string, ParamValue> = {};
    let n = 0;
    return {
      set(_node, id, value) {
        if (!(id in before)) before[id] = cloneValue(params[id]);
        params[id] = cloneValue(value);
        after[id] = cloneValue(value);
        n++;
        refresh();
      },
      commit() {
        const keys = Object.keys(after).filter((k) => !valuesEqual(before[k], after[k]));
        if (!keys.length) return false;
        undo.push({ label, before, after });
        redo.length = 0;
        say(`✔ "${label}" — ${n} live writes → 1 undo step (${keys.join(', ')})`);
        refresh();
        return true;
      },
      cancel() {
        apply(before);
        say(`✘ "${label}" cancelled`);
        refresh();
      },
      get changed() {
        return n > 0;
      },
    };
  };
  const doUndo = (): void => {
    const e = undo.pop();
    if (!e) return;
    apply(e.before);
    redo.push(e);
    say(`↶ undo "${e.label}"`);
    refresh();
  };
  const doRedo = (): void => {
    const e = redo.pop();
    if (!e) return;
    apply(e.after);
    undo.push(e);
    say(`↷ redo "${e.label}"`);
    refresh();
  };

  /* ---------- view / options ---------- */
  const opt = { tile: false, preview: 1 as 1 | 3, rot: 0 as 0 | 1 | 2 | 3, flipX: false, snapGrid: 1 / 16 };
  const enabled = new Set(DEFAULT_ON);
  let vs: ViewState = { zoom: 1, cx: 0, cy: 0, rot: 0, flipX: false, flipY: false, imgW: SIZE[0], imgH: SIZE[1] };
  let fit = true;
  let vw = 800;
  let vh = 600;
  const states = new GizmoStateStore();
  let view = new ViewTransform(vs);
  let readout: string | null = null;
  const controller: GizmoController = new GizmoController({
    view: () => view,
    tiling: () => ({ wrapX: opt.tile || opt.preview > 1, wrapY: opt.tile || opt.preview > 1, region: tileRegion({ nx: opt.preview, ny: opt.preview }, SIZE, view.visibleImageRect(vw, vh)) }),
    beginGesture,
    invalidate: () => {
      if (!rebuilding) refresh();
    },
    requestNumeric: openNumeric,
    readout: (t) => {
      readout = t;
      draw();
    },
  });
  let rebuilding = false;
  const art = document.createElement('canvas');
  art.width = 256;
  art.height = 256;
  {
    const c = art.getContext('2d')!;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        c.fillStyle = (x + y) % 2 ? '#262a31' : '#30353d';
        c.fillRect(x * 32, y * 32, 32, 32);
      }
    const g = c.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, 'rgba(124,108,240,0.35)');
    g.addColorStop(1, 'rgba(0,214,214,0.15)');
    c.fillStyle = g;
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = '#7c6cf0';
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, 253, 253);
    c.fillStyle = '#9aa1ad';
    c.font = 'bold 22px system-ui';
    c.fillText('tile', 100, 134);
  }

  function rebuild(): void {
    rebuilding = true;
    const decls = DECLS.filter((d) => enabled.has(d.id));
    const models = buildNodeGizmos([{ nodeId: 'demo', decls, values: params }], { size: SIZE, tile: [opt.tile, opt.tile], snap: { ...defaultSnap(), gridUv: opt.snapGrid }, zoom: view.zoom }, states);
    controller.setModels(models);
    rebuilding = false;
    json.textContent = JSON.stringify(params, (_k, v: unknown) => (typeof v === 'number' ? +v.toFixed(4) : v), 1).replace(/\n\s+/g, ' ');
  }
  let queued = false;
  function refresh(): void {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      rebuild();
      draw();
    });
  }

  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    vw = stage.clientWidth;
    vh = stage.clientHeight;
    if (canvas.width !== Math.round(vw * dpr) || canvas.height !== Math.round(vh * dpr)) {
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
    }
    const c = canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#0b0c0e';
    c.fillRect(0, 0, vw, vh);
    vs = { ...vs, rot: opt.rot, flipX: opt.flipX };
    if (fit) vs = fitView(vs, vw, vh, 60);
    view = new ViewTransform(vs);
    // image(s): canonical tile + repeated copies when tile preview is on
    const reg = tileRegion({ nx: opt.preview, ny: opt.preview }, SIZE, view.visibleImageRect(vw, vh));
    for (let j = Math.round(reg.y0 / SIZE[1]); j < Math.round(reg.y1 / SIZE[1]); j++)
      for (let i = Math.round(reg.x0 / SIZE[0]); i < Math.round(reg.x1 / SIZE[0]); i++) {
        const a = view.toScreen([i * SIZE[0], j * SIZE[1]]);
        const b = view.toScreen([(i + 1) * SIZE[0], (j + 1) * SIZE[1]]);
        c.save();
        // draw via the exact view matrix: origin at the tile's top-left, axes along the view's axes
        const o = a;
        const ex = view.toScreen([i * SIZE[0] + 1, j * SIZE[1]]);
        const ey = view.toScreen([i * SIZE[0], j * SIZE[1] + 1]);
        c.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
        c.globalAlpha = i === 0 && j === 0 ? 1 : 0.55;
        c.drawImage(art, 0, 0, SIZE[0], SIZE[1]);
        c.restore();
        void b;
      }
    c.strokeStyle = 'rgba(255,255,255,0.3)';
    c.beginPath();
    [view.toScreen([0, 0]), view.toScreen([SIZE[0], 0]), view.toScreen(SIZE), view.toScreen([0, SIZE[1]])].forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.closePath();
    c.stroke();
    drawGizmos(c, view, controller.getModels(), (m) => controller.ghostsOf(m), { hover: controller.hover, active: controller.activeHandle, accent: '#9a8dff', readout, hoverShapes: controller.hoverShapes(lastMods) });
    canvas.style.cursor = controller.cursor;
  }

  /* ---------- numeric popup ---------- */
  let popup: HTMLElement | null = null;
  function openNumeric(req: NumericRequest): void {
    popup?.remove();
    const el = h('div', { class: 'num' }, h('b', { style: { gridColumn: '1/-1' } }, `${req.model.label} · ${req.handle.label}`));
    for (const f of req.fields) {
      const inp = h('input', { value: String(+f.value.toFixed(4)) }) as HTMLInputElement;
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Escape') el.remove();
        if (e.key === 'Enter') {
          rebuild();
          const fresh = controller.getModels().find((m) => m.key === req.model.key) ?? req.model;
          controller.applyNumeric({ ...req, model: fresh }, f.id, Number(inp.value));
          el.remove();
        }
      });
      el.append(h('label', {}, f.label), inp);
    }
    el.style.left = `${req.at[0] + 12}px`;
    el.style.top = `${req.at[1] + 8}px`;
    stage.append(el);
    popup = el;
    (el.querySelector('input') as HTMLInputElement).select();
  }

  /* ---------- input ---------- */
  let lastMods: Mods = { ctrl: false, shift: false, alt: false };
  const mods = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): Mods => ({ ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
  const pos = (e: MouseEvent): V2 => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  let pan: V2 | null = null;
  let gizmoDrag = false;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus();
    popup?.remove();
    lastMods = mods(e);
    const sp = pos(e);
    if (e.button === 1) {
      pan = sp;
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    if (controller.pointerDown(sp, lastMods)) gizmoDrag = true;
    else pan = sp;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    lastMods = mods(e);
    const sp = pos(e);
    if (pan && !gizmoDrag) {
      vs = { ...vs, cx: vs.cx + sp[0] - pan[0], cy: vs.cy + sp[1] - pan[1] };
      pan = sp;
      fit = false;
      refresh();
      return;
    }
    controller.pointerMove(sp, lastMods);
    draw();
  });
  const up = (): void => {
    if (gizmoDrag) controller.pointerUp();
    gizmoDrag = false;
    pan = null;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('dblclick', (e) => void controller.doubleClick(pos(e)));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.altKey && controller.wheel(e.deltaY, mods(e))) return;
    vs = zoomAt(vs, pos(e), Math.exp(-e.deltaY * 0.0016));
    fit = false;
    refresh();
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const acts = controller.actionsAt(pos(e));
    if (!acts.length) return;
    const el = h('div', { class: 'num', style: { gridTemplateColumns: '1fr', left: `${pos(e)[0]}px`, top: `${pos(e)[1]}px` } }, ...acts.map(({ model, action }) => h('button', { onclick: () => (controller.runAction(model, action), el.remove()) }, action.label)));
    popup?.remove();
    popup = el;
    stage.append(el);
  });
  canvas.addEventListener('keydown', (e) => {
    lastMods = mods(e);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      doRedo();
      return;
    }
    if (controller.key(e.key, lastMods)) e.preventDefault();
  });
  new ResizeObserver(refresh).observe(stage);

  /* ---------- side panel ---------- */
  const tileChk = h('input', { type: 'checkbox', onchange: (e: Event) => ((opt.tile = (e.target as HTMLInputElement).checked), refresh()) });
  const prevSel = h('select', { onchange: (e: Event) => ((opt.preview = (+(e.target as HTMLSelectElement).value === 3 ? 3 : 1)), refresh()) }, h('option', { value: '1' }, 'Preview 1×1'), h('option', { value: '3' }, 'Preview 3×3'));
  const rotBtn = h('button', { onclick: () => ((opt.rot = ((opt.rot + 1) % 4) as 0 | 1 | 2 | 3), refresh()) }, 'Rotate view 90°');
  const flipBtn = h('button', { onclick: () => ((opt.flipX = !opt.flipX), refresh()) }, 'Flip X');
  const fitBtn = h('button', { onclick: () => ((fit = true), refresh()) }, 'Fit');
  const snapSel = h('select', { onchange: (e: Event) => ((opt.snapGrid = 1 / +(e.target as HTMLSelectElement).value), refresh()) }, ...[4, 8, 16, 32].map((n) => h('option', { value: String(n), selected: n === 16 }, `Ctrl grid 1/${n}`)));
  const gizmoBoxes = DECLS.map((d) => h('label', {}, h('input', { type: 'checkbox', checked: enabled.has(d.id), onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? enabled.add(d.id) : enabled.delete(d.id), refresh()) }), `${d.label ?? d.id} (${d.type})`));
  side.append(
    h('b', {}, 'Kekenik · Gizmo test page'),
    h('div', {}, 'Runs the real gizmo framework against a mock parameter store (no GPU).'),
    h('h3', {}, 'View'),
    h('div', { class: 'row' }, prevSel, rotBtn, flipBtn, fitBtn),
    h('div', { class: 'row' }, h('label', {}, tileChk, 'Node tiles (ghost copies at edges)'), snapSel),
    h('h3', {}, 'Gizmos'),
    ...gizmoBoxes,
    h('div', { class: 'row' }, h('button', { onclick: doUndo }, 'Undo (Ctrl+Z)'), h('button', { onclick: doRedo }, 'Redo (Ctrl+Y)'), h('button', { onclick: () => (Object.assign(params, cloneValue(INITIAL as never)), states.clear(), say('reset'), refresh()) }, 'Reset')),
    h('h3', {}, 'Cheat sheet'),
    h('div', { style: { color: '#9aa1ad', lineHeight: '1.5' } }, 'Drag handles · Ctrl = snap grid/angle · Shift = uniform / axis lock · Alt = from centre (rect/transform) / break bezier mirror / no magnet · Esc = cancel drag · double-click = numeric entry · double-click spline segment = insert point · Shift+click empty = append spline point · Delete = remove point · right-click = actions · MMB drag = pan · wheel = zoom · Alt+wheel = brush size · Ctrl+Z / Ctrl+Y'),
    h('h3', {}, 'Write log'),
    log,
    h('h3', {}, 'Parameters'),
    json,
    h('h3', {}, 'Self-checks'),
    h('button', { onclick: () => runChecks() }, 'Run self-checks'),
    checks,
  );

  function runChecks(): void {
    const out: string[] = [];
    const t = (name: string, ok: boolean, extra = ''): void => void out.push(`<span class="${ok ? 'ok' : 'bad'}">${ok ? 'PASS' : 'FAIL'}</span> ${name} ${extra}`);
    const v = new ViewTransform({ zoom: 1.7, cx: 321, cy: 222, rot: 1, flipX: true, flipY: false, imgW: 512, imgH: 512 });
    const rt = v.toImage(v.toScreen([77.5, 301.25]));
    t('view round trip (rotated + flipped)', Math.abs(rt[0] - 77.5) < 1e-9 && Math.abs(rt[1] - 301.25) < 1e-9);
    t('handle hit tolerance is constant in screen px', [0.2, 1, 9].every((z) => {
      const vz = new ViewTransform({ ...v.s, zoom: z });
      const p = vz.toScreen([100, 100]);
      return hitDistance({ t: 'point', p: [100, 100], r: 10 }, [p[0] + 9, p[1]], vz) !== null && hitDistance({ t: 'point', p: [100, 100], r: 10 }, [p[0] + 11, p[1]], vz) === null;
    }));
    const reg = tileRegion({ nx: 1, ny: 1 }, SIZE, { x0: 0, y0: 0, x1: 512, y1: 512 });
    t('edge gizmo gets a ghost in the neighbour tile', JSON.stringify(ghostOffsets({ x0: 480, y0: 200, x1: 540, y1: 260 }, SIZE, reg, true, true)) === '[[-1,0]]');
    const before = undo.length;
    const g = beginGesture('selfcheck');
    for (let i = 0; i < 50; i++) g.set('demo', 'cr', 0.05 + i * 0.001);
    g.commit();
    t('50 live writes = exactly 1 undo step', undo.length === before + 1);
    doUndo();
    t('undo restores the pre-gesture value', params.cr === INITIAL.cr);
    const models = controller.getModels();
    t(`${models.length} gizmo models built from declarations`, models.length === enabled.size);
    checks.innerHTML = out.join('\n');
  }

  refresh();
  say('ready — drag something');
}

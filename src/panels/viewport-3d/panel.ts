import { targetKey, type EvalTarget } from '../../engine/graph/evaluator';
import type { Graph } from '../../engine/graph/graph';
import { asMesh } from '../../engine/mesh/accounting';
import { asCamera, defaultCamera, type CameraData } from '../../engine/mesh/camera';
import { GpuTexture } from '../../engine/resources/memory';
import { releaseValue, retainValue, type PinValue } from '../../engine/resources/values';
import { buildModel3D, CameraView, defaultGizmoSettings3D, drawGizmos3D, Gizmo3DController, type GizmoSettings3D } from '../../gizmos3d';
import { viewHints } from '../../app/view-hints';
import { formatBytes } from '../../shared/util';
import { Disposer, h, listen, observeSize } from '../../ui/core/dom';
import { menuBelow } from '../../ui/core/menu';
import { registerPanel } from '../../ui/dock/panel-registry';
import { Checkbox, Dropdown, iconButton, Segmented } from '../../ui/widgets/controls';
import { GizmoToolbar } from '../../ui/widgets/gizmo-toolbar';
import { t, t as tt } from '../../shared/i18n';
import { TextureBridge, BRIDGE_MODE } from './bridge';
import { axisDots, OrbitCamera, pickAxisDot, type StandardView } from './camera-math';
import { DISPLAY_LABELS, DISPLAY_MODES, ViewportScene, defaultMaterialPreview, defaultSceneOptions, type BlendKind, type DisplayMode, type MaterialPreview, type PreviewShape, type SceneOptions, type VcChannel } from './scene';
import './viewport3d.css';

interface Persist {
  scene: SceneOptions;
  mat: MaterialPreview;
  gizmo: GizmoSettings3D;
  cam: ReturnType<OrbitCamera['serialize']> | undefined;
  /** '' = follow the active node, 'none', or a node id */
  matNode: string;
  /** '' = follow the active node (keeps the last mesh), or a node id */
  meshNode: string;
  previewShape: 'auto' | PreviewShape;
  cameraNode: string;
  pinned: string;
  showStats: boolean;
  play: boolean;
}
const defaults = (): Persist => ({ scene: defaultSceneOptions(), mat: defaultMaterialPreview(), gizmo: defaultGizmoSettings3D(), cam: undefined, matNode: '', meshNode: '', previewShape: 'auto', cameraNode: '', pinned: '', showStats: true, play: false });
const merge = (raw: unknown): Persist => {
  const d = defaults();
  const r = (raw ?? {}) as Partial<Persist>;
  return { ...d, ...r, scene: { ...d.scene, ...(r.scene ?? {}) }, mat: { ...d.mat, ...(r.mat ?? {}) }, gizmo: { ...d.gizmo, ...(r.gizmo ?? {}) } };
};

type Kind = 'mesh' | 'texture' | 'camera' | 'other';
const TEX = new Set(['gray', 'color', 'normal', 'uv']);

/**
 * 3D VIEWPORT. three.js WebGPURenderer on the app's shared GPUDevice (see ViewportScene), orbit / pan / zoom / fly camera
 * with damping, axis gizmo, display modes, VFX material preview, camera nodes, 3D gizmos (src/gizmos3d). The mesh shown is an
 * evaluator output that this panel RETAINS (so it survives cache eviction while visible). Evaluation targets are registered with
 * the scheduler and cleared while the panel is hidden.
 */
registerPanel({
  id: 'viewport-3d',
  title: tt('viewport3d.3dView'),
  icon: 'panel-3d',
  multiple: true,
  defaultDock: { zone: 'center' },
  description: tt('viewport3d.meshViewportOrbit'),
  create(host, ctx) {
    const app = ctx.app;
    const dis = new Disposer();
    const st = merge(ctx.initialState);
    const orbit = new OrbitCamera();
    orbit.restore(st.cam);
    const graph = (): Graph => app.project.graph;
    const registry = ctx.engine.registry;

    /* ------------------------------------------------------------------------------------------ DOM */
    const gpuCanvas = h('canvas');
    const ov = h('canvas', { class: 'ov', tabindex: '0' });
    const err = h('div', { class: 'k-banner err', style: { display: 'none' } });
    const msg = h('div', { class: 'msg' }, tt('viewport3d.selectAGeometryNode'));
    const stats = h('div', { class: 'k-vp3-stats' });
    const readout = h('div', { class: 'k-vp3-readout', style: { display: 'none' } });
    const matBox = h('div', { class: 'k-vp3-mat', style: { display: 'none' } });
    const gzBar = new GizmoToolbar();
    const stage = h('div', { class: 'k-vp3-stage' }, gpuCanvas, ov, msg, err, stats, readout, matBox, gzBar.el);
    const toolbar = h('div', { class: 'k-toolrow' });
    const bar = h('div', { class: 'k-vp2-bar' });
    host.append(h('div', { class: 'k-vp3' }, toolbar, stage, bar));

    /* ------------------------------------------------------------------------------------------ state */
    let scene: ViewportScene | null = null;
    let bridge: TextureBridge | null = null;
    let sceneToken = 0;
    let vw = 1, vh = 1, dpr = 1;
    let heldMesh: PinValue | null = null;
    let lastMeshNode = '';
    let lastFramedNode = '';
    let camKey = '';
    let disposed = false;
    let overlayDirty = true;
    let raf = 0;
    let lastT = performance.now();
    let hoverAxis: string | null = null;
    let flipFrame = 0;
    const curDisplay: { mesh: string; mat: string } = { mesh: '', mat: '' };

    const persist = (): Persist => ({ ...st, cam: orbit.serialize() });
    const classify = (id: string | null | undefined): { kind: Kind; pinId?: string; pinType?: string } => {
      const n = id ? graph().nodes.get(id) : undefined;
      const def = n ? registry.get(n.type) : undefined;
      if (!def) return { kind: 'other' };
      const o = def.outputs.find((p) => p.type === 'mesh' || p.type === 'points');
      if (o) return { kind: 'mesh', pinId: o.id, pinType: o.type };
      const t = def.outputs.find((p) => TEX.has(p.type) || p.type === 'flipbook');
      if (t) return { kind: 'texture', pinId: t.id, pinType: t.type };
      const c = def.outputs.find((p) => p.type === 'camera');
      if (c) return { kind: 'camera', pinId: c.id, pinType: c.type };
      return { kind: 'other' };
    };
    const nodeLabel = (id: string): string => graph().nodes.get(id)?.name ?? id;
    const activeId = (): string | null => (st.pinned && graph().nodes.has(st.pinned) ? st.pinned : (app.active.get()?.nodeId ?? null));

    /** What to evaluate for this viewport. */
    const plan = (): { mesh: string | null; mat: string | null; cam: string | null } => {
      const act = activeId();
      const ca = classify(act);
      let mesh: string | null = null;
      if (ca.kind === 'mesh') {
        mesh = act;
        lastMeshNode = act!;
      } else if (st.meshNode && graph().nodes.has(st.meshNode)) mesh = st.meshNode;
      else if (lastMeshNode && graph().nodes.has(lastMeshNode) && st.previewShape === 'auto') mesh = lastMeshNode;
      let mat: string | null = null;
      if (st.matNode === 'none') mat = null;
      else if (st.matNode && graph().nodes.has(st.matNode)) mat = st.matNode;
      else if (ca.kind === 'texture') mat = act;
      if (mat && classify(mat).kind !== 'texture') mat = null;
      const cam = st.cameraNode && graph().nodes.has(st.cameraNode) && classify(st.cameraNode).kind === 'camera' ? st.cameraNode : null;
      return { mesh, mat, cam };
    };
    const targets = (): EvalTarget[] => {
      const p = plan();
      const out: EvalTarget[] = [];
      for (const id of [p.mesh, p.mat, p.cam]) if (id) out.push({ nodeId: id, pinId: classify(id).pinId });
      return out;
    };
    const register = (): void => {
      const list = targets();
      ctx.scheduler.setTargets(ctx.instanceId, ctx.visible.get() && scene && list.length ? list : null);
      const p = plan();
      ctx.title.set(`3D View${p.mesh || p.mat ? ' — ' + nodeLabel((p.mesh ?? p.mat)!) : ''}`);
      if (!list.length) {
        scene?.setMesh(null, null);
        msg.style.display = '';
        requestDraw();
      }
    };

    /* ------------------------------------------------------------------------------------------ scene lifecycle */
    async function initScene(): Promise<void> {
      const token = ++sceneToken;
      const g = ctx.engine.gpu;
      try {
        const s = await ViewportScene.create(g, ctx.engine.mm, gpuCanvas);
        if (token !== sceneToken || disposed) {
          s.dispose();
          return;
        }
        await s.loadTsl();
        scene = s;
        bridge = new TextureBridge(g, ctx.engine.mm);
        scene.setOptions(st.scene);
        scene.setMaterial(st.mat);
        scene.setSize(vw, vh, dpr);
        err.style.display = 'none';
        register();
        requestDraw();
      } catch (e) {
        err.style.display = '';
        err.textContent = `3D viewport could not start: ${(e as Error).message}`;
      }
    }
    function teardownScene(): void {
      sceneToken++;
      scene?.dispose();
      scene = null;
      bridge?.dispose();
      bridge = null;
    }

    /* ------------------------------------------------------------------------------------------ results */
    const holdMesh = (v: PinValue | undefined): void => {
      if (v) retainValue(v);
      if (heldMesh) releaseValue(heldMesh);
      heldMesh = v ?? null;
    };
    dis.add(() => holdMesh(undefined));

    dis.add(
      ctx.scheduler.onResult.on(({ result }) => {
        if (!ctx.visible.get() || !scene) return;
        const p = plan();
        const errs: string[] = [];
        for (const id of [p.mesh, p.mat, p.cam]) {
          const e = id ? result.errors.get(id) : null;
          if (e) errs.push(`${nodeLabel(id!)}: ${e}`);
        }
        err.style.display = errs.length ? '' : 'none';
        err.textContent = errs.join('\n');
        // --- mesh
        if (p.mesh) {
          const v = result.values.get(targetKey({ nodeId: p.mesh, pinId: classify(p.mesh).pinId }));
          const m = asMesh(v);
          if (m) {
            holdMesh(v);
            const changed = curDisplay.mesh !== `${m.uid}:${m.version}`;
            curDisplay.mesh = `${m.uid}:${m.version}`;
            scene.setMesh(m, null);
            if (lastFramedNode !== p.mesh && !m.bounds().empty) {
              lastFramedNode = p.mesh;
              frame();
            }
            if (changed) overlayDirty = true;
            msg.style.display = 'none';
          }
        } else if (p.mat) {
          holdMesh(undefined);
          curDisplay.mesh = '';
          const shape: PreviewShape = st.previewShape === 'auto' ? 'plane' : st.previewShape;
          scene.setMesh(null, shape);
          if (lastFramedNode !== `tex:${shape}`) {
            lastFramedNode = `tex:${shape}`;
            frame();
          }
          msg.style.display = 'none';
        } else {
          holdMesh(undefined);
          scene.setMesh(null, null);
          msg.style.display = '';
        }
        // --- material texture
        if (p.mat && bridge) {
          const c = classify(p.mat);
          const v = result.values.get(targetKey({ nodeId: p.mat, pinId: c.pinId }));
          if (v?.kind === 'texture') {
            const mode = v.pin === 'gray' ? BRIDGE_MODE.gray : v.pin === 'uv' ? BRIDGE_MODE.uv : v.pin === 'normal' ? BRIDGE_MODE.opaque : BRIDGE_MODE.color;
            const r = bridge.update(v.tex, mode);
            scene.setMaterial({ flipbook: null });
            scene.setTexture(r.texture, true);
            curDisplay.mat = `${p.mat}`;
          } else if (v?.kind === 'data' && v.pin === 'flipbook') {
            const fb = v.data as { tex?: unknown; cols?: number; rows?: number; frames?: number };
            if (fb.tex instanceof GpuTexture && fb.cols && fb.rows) {
              const r = bridge.update(fb.tex, BRIDGE_MODE.color);
              scene.setMaterial({ flipbook: { cols: fb.cols, rows: fb.rows, frame: flipFrame } });
              scene.setTexture(r.texture, true);
              curDisplay.mat = `${p.mat}`;
            }
          }
        } else if (scene.hasTexture) {
          scene.setTexture(null);
          curDisplay.mat = '';
        }
        // --- camera node (look through)
        if (p.cam) {
          const cd = asCamera(result.values.get(targetKey({ nodeId: p.cam, pinId: classify(p.cam).pinId })));
          if (cd) {
            const k = JSON.stringify(cd);
            if (k !== camKey) {
              camKey = k;
              orbit.adopt(cd);
            }
          }
        } else camKey = '';
        updateStats();
        requestDraw();
      }),
    );

    /* ------------------------------------------------------------------------------------------ camera helpers */
    function frame(): void {
      const b = scene?.stats.bounds;
      if (b && !b.empty && b.radius > 0) orbit.frame(b.center, b.radius);
      else orbit.frame([0, 0, 0], 1.5);
      requestDraw();
    }
    const currentCamera = (): CameraData => {
      const r = scene?.stats.bounds.radius ?? 1;
      orbit.fitClip(Math.max(r, 1));
      return orbit.toCamera(vw / Math.max(1, vh));
    };

    /* ------------------------------------------------------------------------------------------ gizmos */
    const settings3 = st.gizmo;
    const gizHost = {
      beginGesture: (label: string) => {
        ctx.scheduler.beginInteraction();
        return ctx.editor.beginGesture(label, { onEnd: () => ctx.scheduler.endInteraction() });
      },
      invalidate: () => requestDraw(true),
      readout: (t: string | null) => {
        readout.style.display = t ? '' : 'none';
        readout.textContent = t ?? '';
      },
    };
    const controller = new Gizmo3DController(gizHost);
    const gizmoNode = (): string | null => app.selection.primary ?? activeId();
    const gizmoStates = new Map<string, Record<string, unknown>>();
    function rebuildModels(view: CameraView): void {
      const id = gizmoNode();
      const n = id ? graph().nodes.get(id) : undefined;
      const def = n ? registry.get(n.type) : undefined;
      if (!n || !def?.gizmos?.length) {
        controller.setModels([]);
        gzBar.update([], () => undefined);
        return;
      }
      const anchor = scene?.stats.bounds.empty ? ([0, 0, 0] as [number, number, number]) : (scene?.stats.bounds.center ?? [0, 0, 0]);
      const models = [];
      for (const d of def.gizmos) {
        const key = `${n.id}/${d.id}`;
        let state = gizmoStates.get(key);
        if (!state) gizmoStates.set(key, (state = {}));
        const m = buildModel3D(d, { nodeId: n.id, values: n.params, view, settings: settings3, anchor, state });
        if (m) models.push(m);
      }
      controller.setModels(models);
      const m = models.find((x) => x.toolbar?.length);
      if (!m) gzBar.update([], () => undefined);
      else
        gzBar.update([...m.toolbar!, { id: 'frame', icon: '⛶', tip: `${t('spline.frame')} [F]`, separator: true, run: () => (frame(), null) }], (it) => {
          controller.runToolbar(m, it);
          requestDraw(true);
        });
    }

    /* ------------------------------------------------------------------------------------------ drawing */
    const ovCtx = (): CanvasRenderingContext2D => ov.getContext('2d')!;
    function drawOverlay(cam: CameraData): void {
      const view = new CameraView(cam, vw, vh);
      rebuildModels(view);
      const g = ovCtx();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, vw, vh);
      drawGizmos3D(g, view, controller);
      // axis gizmo (bottom-left)
      const cx = 58, cy = vh - 58, R = 34;
      const dots = axisDots(cam, R);
      g.font = '600 10px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = 'rgba(20,22,27,0.55)';
      g.beginPath();
      g.arc(cx, cy, R + 16, 0, Math.PI * 2);
      g.fill();
      for (const d of dots) {
        g.strokeStyle = d.color;
        g.globalAlpha = d.positive ? 1 : 0.45;
        if (d.positive) {
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(cx, cy);
          g.lineTo(cx + d.x, cy + d.y);
          g.stroke();
        }
        g.fillStyle = d.color;
        g.beginPath();
        g.arc(cx + d.x, cy + d.y, hoverAxis === d.label ? 9 : d.positive ? 7.5 : 5.5, 0, Math.PI * 2);
        g.fill();
        if (d.positive) {
          g.fillStyle = '#0b0d10';
          g.fillText(d.label, cx + d.x, cy + d.y + 0.5);
        }
        g.globalAlpha = 1;
      }
    }
    function requestDraw(overlayOnly = false): void {
      overlayDirty = true;
      if (!overlayOnly && scene) scene.needsRender = true;
      else if (scene) scene.needsRender = true; // overlay shares the render pass cadence (cheap scenes)
      if (!raf && ctx.visible.get()) raf = requestAnimationFrame(tick);
    }
    // Theme / scale change: clear colour + grid follow the tokens, overlay (gizmos, HUD) repaints.
    const onUiChanged = (): void => {
      scene?.applyTheme();
      requestDraw();
    };
    window.addEventListener('kk-ui-change', onUiChanged);
    dis.add(() => window.removeEventListener('kk-ui-change', onUiChanged));
    const keys = new Set<string>();
    function tick(now: number): void {
      raf = 0;
      if (!ctx.visible.get() || !scene) return;
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      let moved = false;
      if (keys.size && flying) {
        const f = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0), r = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0), u = (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0);
        if (f || r || u) {
          orbit.fly(f, r, u, dt, orbit.goal.dist * (keys.has('shift') ? 3 : 1));
          moved = true;
        }
      }
      if (st.play && st.mat.flipbook === null && scene.hasTexture) {
        /* flipbook play handled below */
      }
      if (st.play) {
        const fb = scene.mat.flipbook;
        if (fb) {
          flipFrame = (now / 1000) * 24;
          scene.setMaterial({ flipbook: { ...fb, frame: flipFrame } });
        }
      }
      if (orbit.update(dt) || moved) scene.needsRender = true;
      if (scene.animated || st.play) scene.needsRender = true;
      if (scene.needsRender || overlayDirty) {
        const cam = currentCamera();
        scene.render(cam, now / 1000);
        drawOverlay(cam);
        overlayDirty = false;
      }
      if (scene.needsRender || orbit.animating || scene.animated || st.play || (keys.size && flying)) raf = requestAnimationFrame(tick);
    }

    /* ------------------------------------------------------------------------------------------ pointer / keys */
    const mods = (e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey?: boolean }) => ({ shift: e.shiftKey, ctrl: e.ctrlKey || !!e.metaKey, alt: e.altKey });
    let drag: { kind: 'orbit' | 'pan' | 'fly' | 'gizmo'; x: number; y: number } | null = null;
    let flying = false;
    const local = (e: PointerEvent): [number, number] => {
      const r = ov.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const axisAt = (x: number, y: number): ReturnType<typeof pickAxisDot> => pickAxisDot(axisDots(orbit.toCamera(1), 34), x - 58, y - (vh - 58), 11);
    dis.add(
      listen(ov, 'pointerdown', (e: PointerEvent) => {
        ov.focus();
        const [x, y] = local(e);
        const view = new CameraView(currentCamera(), vw, vh);
        if (e.button === 0) {
          const ax = axisAt(x, y);
          if (ax) {
            orbit.setFromDirection(ax.dir);
            requestDraw();
            return;
          }
          if (controller.pointerDown(view, x, y, mods(e))) {
            drag = { kind: 'gizmo', x, y };
            ov.setPointerCapture(e.pointerId);
            return;
          }
        }
        const kind = e.button === 2 ? 'fly' : e.button === 1 || (e.button === 0 && e.shiftKey) ? 'pan' : e.button === 0 ? 'orbit' : null;
        if (!kind) return;
        drag = { kind, x: e.clientX, y: e.clientY };
        flying = kind === 'fly';
        ov.setPointerCapture(e.pointerId);
        e.preventDefault();
      }),
    );
    dis.add(
      listen(ov, 'pointermove', (e: PointerEvent) => {
        const [x, y] = local(e);
        if (!drag) {
          const ax = axisAt(x, y);
          const lbl = ax?.label ?? null;
          if (lbl !== hoverAxis) {
            hoverAxis = lbl;
            requestDraw(true);
          }
          const view = new CameraView(currentCamera(), vw, vh);
          const over = controller.pointerMove(view, x, y, mods(e));
          ov.style.cursor = ax ? 'pointer' : over ? 'grab' : 'default';
          return;
        }
        if (drag.kind === 'gizmo') {
          controller.pointerMove(new CameraView(currentCamera(), vw, vh), x, y, mods(e));
          return;
        }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        if (drag.kind === 'orbit') orbit.orbit(dx, dy);
        else if (drag.kind === 'pan') orbit.pan(dx, dy, vh);
        else {
          const eye = orbit.toCamera(1, true).position;
          orbit.orbit(dx * 0.7, dy * 0.7);
          const y2 = (orbit.goal.yaw * Math.PI) / 180, p2 = (orbit.goal.pitch * Math.PI) / 180, d = orbit.goal.dist;
          orbit.goal.target = [eye[0] - d * Math.cos(p2) * Math.sin(y2), eye[1] + d * Math.cos(p2) * Math.cos(y2), eye[2] - d * Math.sin(p2)];
        }
        requestDraw();
      }),
    );
    const endDrag = (): void => {
      if (drag?.kind === 'gizmo') controller.pointerUp();
      drag = null;
      flying = false;
    };
    dis.add(listen(ov, 'pointerup', endDrag));
    dis.add(listen(ov, 'pointercancel', endDrag));
    dis.add(listen(ov, 'contextmenu', (e: Event) => e.preventDefault()));
    dis.add(
      listen(
        ov,
        'wheel',
        (e: WheelEvent) => {
          e.preventDefault();
          orbit.zoom(Math.max(-3, Math.min(3, -e.deltaY / 100)));
          requestDraw();
        },
        { passive: false },
      ),
    );
    dis.add(
      listen(ov, 'dblclick', (e: MouseEvent) => {
        if (e.button === 0 && !controller.pick(new CameraView(currentCamera(), vw, vh), e.offsetX, e.offsetY)) frame();
      }),
    );
    const setViewKey = (v: StandardView): void => {
      orbit.setView(v);
      requestDraw();
    };
    dis.add(
      listen(ov, 'keydown', (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        if (e.key === 'Escape') {
          controller.cancel();
          return;
        }
        if (!e.ctrlKey && !e.metaKey && !flying && controller.key(e.key, mods(e))) {
          e.preventDefault();
          requestDraw(true);
          return;
        }
        if (['w', 'a', 's', 'd', 'q', 'e'].includes(k) && flying) {
          keys.add(k);
          requestDraw();
          e.preventDefault();
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (k === 'f') frame();
        else if (k === 'w') setMode('translate');
        else if (k === 'e') setMode('rotate');
        else if (k === 'r') setMode('scale');
        else if (e.code === 'Numpad1') setViewKey('front');
        else if (e.code === 'Numpad3') setViewKey('right');
        else if (e.code === 'Numpad7') setViewKey('top');
        else if (e.code === 'Numpad5') projToggle();
        else return;
        e.preventDefault();
      }),
    );
    dis.add(listen(ov, 'keyup', (e: KeyboardEvent) => keys.delete(e.key.toLowerCase())));
    dis.add(listen(ov, 'blur', () => keys.clear()));

    /* ------------------------------------------------------------------------------------------ toolbar */
    const setMode = (m: GizmoSettings3D['mode']): void => {
      settings3.mode = m;
      modeSeg.set(m);
      requestDraw(true);
    };
    const projToggle = (): void => {
      orbit.ortho = !orbit.ortho;
      projSeg.set(orbit.ortho ? 'ortho' : 'persp');
      requestDraw();
    };
    const nodeOptions = (pred: (k: Kind) => boolean, extra: { value: string; label: string }[]): { value: string; label: string }[] => {
      const out = [...extra];
      for (const n of graph().nodes.values()) if (pred(classify(n.id).kind)) out.push({ value: n.id, label: n.name });
      return out;
    };
    const dispDrop = new Dropdown({ options: DISPLAY_MODES.map((m) => ({ value: m, label: DISPLAY_LABELS[m] })), value: st.scene.display, tip: tt('viewport3d.displayMode') }, { onInput: (v) => setScene({ display: v as DisplayMode }) });
    const vcDrop = new Dropdown({ options: [{ value: 'rgb', label: 'RGB' }, { value: 'r', label: 'R' }, { value: 'g', label: 'G' }, { value: 'b', label: 'B' }, { value: 'a', label: 'A' }], value: st.scene.vcChannel, tip: tt('viewport3d.vertexColourChannel') }, { onInput: (v) => setScene({ vcChannel: v as VcChannel }) });
    const projSeg = new Segmented({ options: [{ value: 'persp', label: 'Persp' }, { value: 'ortho', label: 'Ortho' }], value: orbit.ortho ? 'ortho' : 'persp' }, { onInput: (v) => { orbit.ortho = v === 'ortho'; requestDraw(); } });
    const viewBtn = h('button', {
      class: 'k-drop',
      tip: tt('viewport3d.standardViews'),
      onclick: (e: Event) => menuBelow(e.currentTarget as HTMLElement, (['front', 'back', 'left', 'right', 'top', 'bottom'] as StandardView[]).map((v) => ({ label: v[0].toUpperCase() + v.slice(1), action: () => setViewKey(v) }))),
    }, 'View');
    const camDrop = new Dropdown({ options: [{ value: '', label: tt('viewport3d.freeCamera') }], value: st.cameraNode, tip: tt('viewport3d.lookThroughACamera') }, { onInput: (v) => { st.cameraNode = v; camKey = ''; register(); } });
    const modeSeg = new Segmented<GizmoSettings3D['mode']>({ options: [{ value: 'translate', label: 'Move', tip: tt('viewport3d.translateW') }, { value: 'rotate', label: 'Rotate', tip: tt('viewport3d.rotateE') }, { value: 'scale', label: 'Scale', tip: tt('viewport3d.scaleR') }], value: settings3.mode }, { onInput: (v) => setMode(v) });
    const spaceSeg = new Segmented<GizmoSettings3D['space']>({ options: [{ value: 'world', label: 'World' }, { value: 'local', label: 'Local' }], value: settings3.space }, { onInput: (v) => { settings3.space = v; requestDraw(true); } });
    const snapChk = new Checkbox({ value: settings3.snap, label: 'Snap', tip: tt('viewport3d.snapGizmoEditsCtrl') }, { onInput: (v) => { settings3.snap = v; } });
    const gridBtn = iconButton('grid', tt('viewport3d.groundGrid'), () => { setScene({ grid: !st.scene.grid }); gridBtn.classList.toggle('active', st.scene.grid); }, { active: st.scene.grid });
    const boundsBtn = iconButton('box', tt('viewport3d.boundingBox'), () => { setScene({ bounds: !st.scene.bounds }); boundsBtn.classList.toggle('active', st.scene.bounds); }, { active: st.scene.bounds });
    const statsBtn = iconButton('info', tt('viewport3d.statsOverlay'), () => { st.showStats = !st.showStats; statsBtn.classList.toggle('active', st.showStats); updateStats(); }, { active: st.showStats });
    const frameBtn = iconButton('fit', tt('viewport3d.frameF'), () => frame());
    const pinBtn = iconButton('pin', tt('viewport3d.pinThisViewportTo'), () => {
      st.pinned = st.pinned ? '' : (app.active.get()?.nodeId ?? '');
      pinBtn.classList.toggle('active', !!st.pinned);
      register();
    }, { active: !!st.pinned });
    const matBtn = h('button', { class: 'k-drop', tip: tt('viewport3d.vfxMaterialPreview'), onclick: () => { matBox.style.display = matBox.style.display === 'none' ? '' : 'none'; if (matBox.style.display !== 'none') buildMatBox(); } }, 'Material');
    toolbar.append(pinBtn, dispDrop.el, vcDrop.el, h('span', { class: 'k-sp' }), projSeg.el, viewBtn, camDrop.el, frameBtn, h('span', { class: 'k-sp' }), modeSeg.el, spaceSeg.el, snapChk.el, h('span', { class: 'k-sp' }), matBtn, gridBtn, boundsBtn, statsBtn);

    function setScene(p: Partial<SceneOptions>): void {
      Object.assign(st.scene, p);
      scene?.setOptions(p);
      vcDrop.el.style.display = st.scene.display === 'vertex_color' ? '' : 'none';
      requestDraw();
    }
    vcDrop.el.style.display = st.scene.display === 'vertex_color' ? '' : 'none';

    /* ------------------------------------------------------------------------------------------ material box */
    function buildMatBox(): void {
      matBox.replaceChildren();
      const row = (label: string, el: HTMLElement): HTMLElement => h('div', { class: 'row' }, h('label', {}, label), el);
      const setMat = (p: Partial<MaterialPreview>): void => {
        Object.assign(st.mat, p);
        scene?.setMaterial(p);
        requestDraw();
      };
      const slider = (min: number, max: number, step: number, v: number, cb: (x: number) => void): HTMLElement => {
        const val = h('span', { class: 'val' }, v.toFixed(2));
        const inp = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(v), oninput: (e: Event) => { const x = Number((e.target as HTMLInputElement).value); val.textContent = x.toFixed(2); cb(x); } });
        return h('span', { class: 'sl' }, inp, val);
      };
      const matSrc = new Dropdown({ options: nodeOptions((k) => k === 'texture', [{ value: '', label: tt('viewport3d.followActiveNode') }, { value: 'none', label: tt('viewport3d.nonePlainShading') }]), value: st.matNode, tip: tt('viewport3d.textureShownOnThe') }, { onInput: (v) => { st.matNode = v; register(); } });
      const meshSrc = new Dropdown({ options: nodeOptions((k) => k === 'mesh', [{ value: '', label: tt('viewport3d.followActiveNode') }]), value: st.meshNode, tip: tt('viewport3d.meshToPreview') }, { onInput: (v) => { st.meshNode = v; register(); } });
      const shape = new Dropdown({ options: (['auto', 'plane', 'billboard', 'sphere', 'cube', 'cylinder'] as const).map((s) => ({ value: s, label: s === 'auto' ? 'Auto (last mesh / plane)' : s[0].toUpperCase() + s.slice(1) })), value: st.previewShape, tip: tt('viewport3d.previewPrimitiveForTextures') }, { onInput: (v) => { st.previewShape = v as Persist['previewShape']; lastFramedNode = ''; register(); requestDraw(); } });
      const blend = new Dropdown({ options: (['opaque', 'alpha', 'additive', 'multiply', 'translucent'] as BlendKind[]).map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) })), value: st.mat.blend, tip: tt('viewport3d.blendMode') }, { onInput: (v) => setMat({ blend: v as BlendKind }) });
      const on = new Checkbox({ value: st.mat.enabled, label: tt('viewport3d.useMaterialPreview') }, { onInput: (v) => setMat({ enabled: v }) });
      const dbl = new Checkbox({ value: st.mat.doubleSided, label: tt('viewport3d.doubleSided') }, { onInput: (v) => setMat({ doubleSided: v }) });
      const dw = new Checkbox({ value: st.mat.depthWrite, label: tt('viewport3d.depthWrite') }, { onInput: (v) => setMat({ depthWrite: v }) });
      const play = new Checkbox({ value: st.play, label: tt('viewport3d.playFlipbook24Fps') }, { onInput: (v) => { st.play = v; requestDraw(); } });
      matBox.append(
        h('div', { class: 'title' }, tt('viewport3d.vfxMaterialPreview')),
        row('Mesh', meshSrc.el), row('Texture', matSrc.el), row('Texture target', shape.el), row('Blend', blend.el),
        h('div', { class: 'row' }, on.el), h('div', { class: 'row' }, dbl.el), h('div', { class: 'row' }, dw.el),
        row('Opacity', slider(0, 1, 0.01, st.mat.opacity, (x) => setMat({ opacity: x }))),
        row('Soft fade', slider(0, 2, 0.01, st.mat.softFade, (x) => setMat({ softFade: x }))),
        row('Scroll U', slider(-2, 2, 0.01, st.mat.scroll[0], (x) => setMat({ scroll: [x, st.mat.scroll[1]] }))),
        row('Scroll V', slider(-2, 2, 0.01, st.mat.scroll[1], (x) => setMat({ scroll: [st.mat.scroll[0], x] }))),
        row('Tile U', slider(0.1, 8, 0.1, st.mat.tile[0], (x) => setMat({ tile: [x, st.mat.tile[1]] }))),
        row('Tile V', slider(0.1, 8, 0.1, st.mat.tile[1], (x) => setMat({ tile: [st.mat.tile[0], x] }))),
        row('Flipbook frame', slider(0, 63, 1, flipFrame, (x) => { flipFrame = x; const fb = scene?.mat.flipbook; if (fb) setMat({ flipbook: { ...fb, frame: x } }); })),
        h('div', { class: 'row' }, play.el),
      );
    }
    const refreshLists = (): void => {
      camDrop.setOptions(nodeOptions((k) => k === 'camera', [{ value: '', label: tt('viewport3d.freeCamera') }]));
    };

    /* ------------------------------------------------------------------------------------------ stats */
    function updateStats(): void {
      stats.style.display = st.showStats ? '' : 'none';
      if (!st.showStats || !scene) return;
      const s = scene.stats;
      const mem = ctx.engine.mm.stats();
      const f = (n: number): string => n.toLocaleString();
      const sz = s.bounds.size.map((x) => x.toFixed(2)).join(' × ');
      const lines: HTMLElement[] = [
        h('div', {}, h('b', {}, f(s.points)), ' pts  ', h('b', {}, f(s.vertices)), ' verts  ', h('b', {}, f(s.prims)), ' prims  ', h('b', {}, f(s.tris)), ' tris'),
        h('div', { class: 'dim' }, s.attrs.length ? s.attrs.join('  ') : 'no geometry'),
        h('div', { class: 'dim' }, `bounds ${s.bounds.empty ? '—' : sz}  ·  mesh ${formatBytes(s.cpuBytes)}  ·  view ${formatBytes(s.viewportBytes)}`),
        h('div', { class: 'dim' }, `mem ${formatBytes(mem.usedBytes)} / ${formatBytes(mem.budgetBytes)}  (meshes ${formatBytes(mem.externalByCategory.mesh ?? 0)})`),
      ];
      if (s.note) lines.push(h('div', { class: 'note' }, s.note));
      stats.replaceChildren(...lines);
      bar.textContent = `${DISPLAY_LABELS[st.scene.display]} · ${orbit.ortho ? 'orthographic' : `perspective ${orbit.fovY.toFixed(0)}°`} · LMB orbit · Shift/MMB pan · wheel zoom · RMB + WASDQE fly · F frame · W/E/R gizmo`;
    }
    dis.add(ctx.engine.mm.onChange.on(() => updateStats()));

    /* ------------------------------------------------------------------------------------------ wiring */
    dis.add(
      observeSize(stage, (w, hh, d) => {
        vw = Math.max(1, Math.floor(w));
        vh = Math.max(1, Math.floor(hh));
        dpr = d;
        ov.width = Math.floor(vw * dpr);
        ov.height = Math.floor(vh * dpr);
        scene?.setSize(vw, vh, dpr);
        requestDraw();
      }),
    );
    dis.add(ctx.visible.subscribe(() => { register(); requestDraw(); }));
    dis.add(app.active.onChange.on(() => register()));
    dis.add(app.selection.onChange.on(() => requestDraw(true)));
    let graphUnsub = (): void => {};
    const bindGraph = (): void => {
      graphUnsub();
      graphUnsub = graph().events.on((e) => {
        if (e.type === 'structure' || e.type === 'reset') {
          refreshLists();
          register();
        }
        requestDraw(true);
      });
      refreshLists();
      register();
    };
    bindGraph();
    dis.add(() => graphUnsub());
    dis.add(app.project.onChange.on(() => { lastMeshNode = ''; lastFramedNode = ''; bindGraph(); }));
    // Sample / template view hints: pre-select the mesh, the material texture and the material look.
    dis.add(
      viewHints.on((hint) => {
        if (hint.mesh !== undefined) st.meshNode = hint.mesh;
        if (hint.material !== undefined) st.matNode = hint.material;
        if (hint.mat) {
          Object.assign(st.mat, hint.mat);
          scene?.setMaterial(hint.mat as Partial<MaterialPreview>);
        }
        if (hint.display && (DISPLAY_MODES as readonly string[]).includes(hint.display)) {
          st.scene.display = hint.display as DisplayMode;
          scene?.setOptions({ display: st.scene.display });
        }
        lastFramedNode = '';
        register();
        if (matBox.style.display !== 'none') buildMatBox();
        requestDraw(true);
      }),
    );
    dis.add(
      ctx.engine.gpu.onRestored.on(() => {
        // textures and device objects died: rebuild the renderer, the evaluator re-runs everything
        teardownScene();
        void initScene();
      }),
    );
    void initScene();
    void defaultCamera;

    return {
      dispose() {
        disposed = true;
        cancelAnimationFrame(raf);
        ctx.scheduler.clearOwner(ctx.instanceId);
        controller.cancel();
        teardownScene();
        dis.dispose();
      },
      resize() {
        requestDraw();
      },
      focus() {
        ov.focus();
      },
      serialize: () => persist(),
    };
  },
});

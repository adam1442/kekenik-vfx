import { GraphEditor } from '../engine/commands/graph-commands';
import { Graph } from '../engine/graph/graph';
import type { NodeRegistry } from '../engine/graph/registry';
import { buildNodeGizmos, defaultSnap, GizmoController, GizmoStateStore, ghostOffsets, hitDistance, tileRegion, ViewTransform, type Mods, type V2 } from './index';

/** GPU-free gizmo checks that also run inside the browser self-test page (`Gizmo · …`). Shared with vitest. */
export interface GizmoCheck {
  name: string;
  run(): string | void;
}
const ok = (c: unknown, m: string): void => {
  if (!c) throw new Error(m);
};
const near = (a: number, b: number, eps: number, m: string): void => ok(Math.abs(a - b) <= eps, `${m}: ${a} vs ${b}`);
const M: Mods = { ctrl: false, shift: false, alt: false };

export function gizmoChecks(getRegistry: () => NodeRegistry): GizmoCheck[] {
  const rig = (tile: boolean) => {
    const ed = new GraphEditor(new Graph(getRegistry(), { width: 512, height: 512 }));
    const id = ed.addNode('grayscale.noise');
    ed.stack.sealTop();
    const view = new ViewTransform({ zoom: 1, cx: 256, cy: 256, rot: 0, flipX: false, flipY: false, imgW: 512, imgH: 512 });
    const states = new GizmoStateStore();
    const def = getRegistry().get('grayscale.noise')!;
    const ctrl = new GizmoController({
      view: () => view,
      tiling: () => ({ wrapX: tile, wrapY: tile, region: tileRegion({ nx: 1, ny: 1 }, [512, 512], { x0: 0, y0: 0, x1: 512, y1: 512 }) }),
      beginGesture: (l) => ed.beginGesture(l),
      invalidate: () => {},
    });
    const rebuild = (): void => ctrl.setModels(buildNodeGizmos([{ nodeId: id, decls: def.gizmos ?? [], values: ed.graph.nodes.get(id)!.params }], { size: [512, 512], tile: [tile, tile], snap: defaultSnap(), zoom: 1 }, states));
    rebuild();
    return { ed, id, ctrl, view, rebuild };
  };
  return [
    {
      name: 'Gizmo · view transform round trip (rotation / flip / zoom) and constant screen-size hit tolerance',
      run() {
        for (const rot of [0, 1, 2, 3] as const) {
          const v = new ViewTransform({ zoom: 3.3, cx: 200, cy: 150, rot, flipX: rot % 2 === 0, flipY: false, imgW: 640, imgH: 360 });
          const p: V2 = [123.25, 77.5];
          const b = v.toImage(v.toScreen(p));
          near(b[0], p[0], 1e-9, 'x');
          near(b[1], p[1], 1e-9, 'y');
        }
        for (const z of [0.1, 1, 10]) {
          const v = new ViewTransform({ zoom: z, cx: 0, cy: 0, rot: 0, flipX: false, flipY: false, imgW: 100, imgH: 100 });
          const p = v.toScreen([50, 50]);
          ok(hitDistance({ t: 'point', p: [50, 50], r: 10 }, [p[0] + 9, p[1]], v) !== null, 'inside tolerance');
          ok(hitDistance({ t: 'point', p: [50, 50], r: 10 }, [p[0] + 11, p[1]], v) === null, 'outside tolerance');
        }
      },
    },
    {
      name: 'Gizmo · tiling ghosts (edge gizmo copies appear in the neighbouring tile)',
      run() {
        const region = tileRegion({ nx: 1, ny: 1 }, [100, 100], { x0: 0, y0: 0, x1: 100, y1: 100 });
        ok(JSON.stringify(ghostOffsets({ x0: 88, y0: 40, x1: 108, y1: 60 }, [100, 100], region, true, true)) === '[[-1,0]]', 'edge ghost');
        ok(ghostOffsets({ x0: 40, y0: 40, x1: 60, y1: 60 }, [100, 100], region, true, true).length === 0, 'no ghost in the middle');
      },
    },
    {
      name: 'Gizmo · Noise Transform2D drag = live writes, ONE undo step, correct parameter mapping',
      run() {
        const r = rig(false);
        const sp = r.view.toScreen([256, 256]);
        ok(r.ctrl.pointerDown(sp, M), 'centre handle must be picked');
        for (let i = 1; i <= 30; i++) r.ctrl.pointerMove([sp[0] + i * 4, sp[1] + i], { ...M, alt: true });
        r.ctrl.pointerUp();
        const off = r.ed.graph.nodes.get(r.id)!.params.offset as number[];
        near(off[0], -120 / 512, 1e-6, 'offset.x = 0.5 - position.x');
        near(off[1], -30 / 512, 1e-6, 'offset.y');
        r.ed.stack.undo();
        ok(JSON.stringify(r.ed.graph.nodes.get(r.id)!.params.offset) === '[0,0]', 'one undo restores everything');
      },
    },
    {
      name: 'Gizmo · tilingSafe rounds noise scale to whole numbers while the graph tiles',
      run() {
        const r = rig(true);
        const br = r.ctrl.getModels()[0].handles.find((h) => h.id === 'br')!.pos!;
        r.ctrl.pointerDown(r.view.toScreen(br), M);
        r.ctrl.pointerMove(r.view.toScreen([256 + 100, 256 + 100]), M);
        r.ctrl.pointerUp();
        ok(JSON.stringify(r.ed.graph.nodes.get(r.id)!.params.scale) === '[3,3]', 'scale must be [3,3]');
      },
    },
  ];
}

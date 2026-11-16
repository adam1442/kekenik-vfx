import type { Controller3DLike } from './draw-types';
import type { Geom, Handle3D, View3D } from './core';

const withAlpha = (c: string, a: number): string => (c.length === 7 ? c + Math.round(a * 255).toString(16).padStart(2, '0') : c);

/** Draws every model of the controller onto a Canvas2D overlay (CSS pixel coordinates; ctx already scaled by DPR). */
export function drawGizmos3D(g: CanvasRenderingContext2D, view: View3D, ctl: Controller3DLike): void {
  const P = (p: [number, number, number]) => view.project(p);
  const path = (geom: Geom, fill = false): void => {
    g.beginPath();
    if (geom.k === 'segment') {
      const a = P(geom.a), b = P(geom.b);
      if (!a || !b) return;
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
    } else if (geom.k === 'poly' || geom.k === 'quad') {
      const pts = geom.k === 'quad' ? geom.pts : geom.pts;
      let started = false;
      for (const p of pts) {
        const q = P(p);
        if (!q) {
          started = false;
          continue;
        }
        if (!started) g.moveTo(q[0], q[1]);
        else g.lineTo(q[0], q[1]);
        started = true;
      }
      if (geom.k === 'quad' || geom.closed) g.closePath();
    }
    if (fill) g.fill();
    else g.stroke();
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';
  for (const m of ctl.getModels()) {
    for (const d of m.decor) {
      g.strokeStyle = d.color;
      g.fillStyle = d.color;
      g.lineWidth = 1.25;
      g.setLineDash(d.dash ? [4, 4] : []);
      if (d.geom.k === 'point') {
        const q = P(d.geom.p);
        if (q) {
          g.beginPath();
          g.arc(q[0], q[1], 3, 0, Math.PI * 2);
          g.fill();
        }
      } else path(d.geom);
    }
    g.setLineDash([]);
    const sorted = [...m.handles].sort((a, b) => b.priority - a.priority); // draw high-priority (low number) last = on top
    for (const h of sorted) drawHandle(g, view, h, ctl.hover?.key === m.key && ctl.hover.id === h.id, ctl.active?.key === m.key && ctl.active.id === h.id, path);
  }
}

function drawHandle(g: CanvasRenderingContext2D, view: View3D, h: Handle3D, hover: boolean, active: boolean, path: (geom: Geom, fill?: boolean) => void): void {
  const col = active ? '#ffffff' : hover ? '#fff3b0' : h.color;
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = active || hover ? 3 : 2;
  for (const geom of h.geom) {
    if (geom.k === 'quad') {
      g.fillStyle = withAlpha(h.color, active || hover ? 0.55 : 0.28);
      g.strokeStyle = col;
      g.lineWidth = 1;
      path(geom, true);
      path(geom);
    } else if (geom.k === 'point') {
      const q = view.project(geom.p);
      if (!q) continue;
      const r = active || hover ? 6.5 : 5;
      g.fillStyle = col;
      g.strokeStyle = '#0b0d10';
      g.lineWidth = 1;
      g.beginPath();
      if (h.shape === 'cube') g.rect(q[0] - r, q[1] - r, r * 2, r * 2);
      else if (h.shape === 'arrow') {
        const seg = h.geom.find((x) => x.k === 'segment');
        let dx = 0, dy = -1;
        if (seg && seg.k === 'segment') {
          const a = view.project(seg.a), b = view.project(seg.b);
          if (a && b) {
            const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            dx = (b[0] - a[0]) / l;
            dy = (b[1] - a[1]) / l;
          }
        }
        g.moveTo(q[0] + dx * 9, q[1] + dy * 9);
        g.lineTo(q[0] - dx * 3 - dy * 5, q[1] - dy * 3 + dx * 5);
        g.lineTo(q[0] - dx * 3 + dy * 5, q[1] - dy * 3 - dx * 5);
        g.closePath();
      } else if (h.shape === 'ring') {
        g.arc(q[0], q[1], r + 1, 0, Math.PI * 2);
        g.fillStyle = withAlpha('#000000', 0.25);
      } else g.arc(q[0], q[1], r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    } else {
      g.strokeStyle = col;
      g.lineWidth = active || hover ? 3 : 2;
      path(geom);
    }
  }
}

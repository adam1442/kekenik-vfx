import { DEG, v2, type V2 } from './geom';

/** Snapping configuration owned by the viewport (user settings + guides). */
export interface SnapSettings {
  /** Grid step in UV (e.g. 1/16). */
  gridUv: number;
  /** Angle step in degrees. */
  angleDeg: number;
  /** Magnetic targets (UV values) e.g. guides, image edges/centre; always active within `magnetPx`. */
  targetsU: number[];
  targetsV: number[];
  magnetPx: number;
}

export const defaultSnap = (): SnapSettings => ({ gridUv: 1 / 16, angleDeg: 15, targetsU: [0, 0.5, 1], targetsV: [0, 0.5, 1], magnetPx: 6 });

export interface Mods {
  /** Ctrl / Cmd: snap to grid / angle step. */
  ctrl: boolean;
  /** Shift: uniform scale / axis lock / keep aspect. */
  shift: boolean;
  /** Alt: from-center (scale gizmos) / break handle symmetry (splines). */
  alt: boolean;
}
export const NO_MODS: Mods = { ctrl: false, shift: false, alt: false };

export const snapScalar = (v: number, step: number): number => (step > 0 ? Math.round(v / step) * step : v);
export const snapAngle = (rad: number, stepDeg: number): number => (stepDeg > 0 ? Math.round(rad / (stepDeg * DEG)) * stepDeg * DEG : rad);

/**
 * Snap an image-pixel point. Ctrl = hard grid snap. Magnetic targets (guides, edges, centre) pull within `magnetPx`
 * screen pixels whenever `magnet` is true (the viewport turns it off while Alt is held).
 */
export function snapPoint(ip: V2, size: V2, s: SnapSettings, mods: Mods, zoom: number, magnet = true): V2 {
  let u = ip[0] / size[0];
  let v = ip[1] / size[1];
  if (mods.ctrl) {
    u = snapScalar(u, s.gridUv);
    v = snapScalar(v, s.gridUv);
  } else if (magnet) {
    const tol = s.magnetPx / zoom;
    const pull = (val: number, targets: number[], sz: number): number => {
      let best = val;
      let bd = tol;
      for (const t of targets) {
        const d = Math.abs(t - val) * sz;
        if (d <= bd) {
          bd = d;
          best = t;
        }
      }
      return best;
    };
    u = pull(u, s.targetsU, size[0]);
    v = pull(v, s.targetsV, size[1]);
  }
  return [u * size[0], v * size[1]];
}

/** Lock a drag to the dominant axis relative to `anchor` (Shift). */
export function axisLock(p: V2, anchor: V2): V2 {
  return Math.abs(p[0] - anchor[0]) >= Math.abs(p[1] - anchor[1]) ? [p[0], anchor[1]] : [anchor[0], p[1]];
}

/** Snap the direction anchor->p to angle steps keeping its length (Shift/Ctrl on line ends). */
export function snapDirection(p: V2, anchor: V2, stepDeg: number): V2 {
  const d = v2.sub(p, anchor);
  const l = v2.len(d);
  if (l < 1e-9) return p;
  const a = snapAngle(Math.atan2(d[1], d[0]), stepDeg);
  return [anchor[0] + Math.cos(a) * l, anchor[1] + Math.sin(a) * l];
}

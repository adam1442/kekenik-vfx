import type { GizmoDecl } from '../../../engine/graph/node';
import type { ParamValue, ParamValues } from '../../../engine/params/schema';

/**
 * Shape gizmos: a Rect (centre / size / rotation) and a Radius circle for the corner rounding.
 * `size` is stored relative to the repeat CELL, so the rect divides it by the repeat count (native = fraction of the
 * whole image); the radius circle converts the 0..1 `rounding` into UV length of the shape's smaller half size.
 */
const rep = (v: ParamValues): number[] => (v.repeat as number[]) ?? [1, 1];
const halfMin = (v: ParamValues): number => {
  const s = v.size as number[];
  const r = rep(v);
  return Math.max(Math.min(s[0] / r[0], s[1] / r[1]) * 0.5, 1e-6);
};
const ROUNDABLE = ['rounded_rect', 'polygon', 'star', 'cross'];

export const gizmos: GizmoDecl[] = [
  {
    id: 'rect',
    label: 'Shape rect',
    type: 'rect',
    viewport: '2d',
    space: 'uv',
    center: 'position',
    size: {
      param: 'size',
      map: {
        to: (raw: ParamValue, v: ParamValues): number[] => {
          const s = raw as number[];
          const r = rep(v);
          return [s[0] / r[0], s[1] / r[1]];
        },
        from: (g: number | number[], v: ParamValues): ParamValue => {
          const r = rep(v);
          const a = g as number[];
          return [a[0] * r[0], a[1] * r[1]];
        },
      },
    },
    rotation: 'rotation',
  },
  {
    id: 'radius',
    label: 'Corner radius',
    type: 'circle',
    viewport: '2d',
    space: 'uv',
    center: 'position',
    radius: {
      param: 'rounding',
      map: {
        to: (raw: ParamValue, v: ParamValues): number => (raw as number) * halfMin(v),
        from: (g: number | number[], v: ParamValues): ParamValue => (g as number) / halfMin(v),
      },
    },
    visibleIf: (v) => ROUNDABLE.includes(v.shape as string),
  },
];

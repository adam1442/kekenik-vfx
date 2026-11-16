import { defineNode } from '../../../engine/graph/node';
import { P, type SplineValue } from '../../../engine/params/schema';
import { setOf, transformSpline } from '../../../engine/spline/ops';
import { splineValue } from '../../../engine/spline/value';

const SHAPES = ['circle', 'rounded_rect', 'star', 'polygon', 'line', 'arc'] as const;
type Shape = (typeof SHAPES)[number];

const corner = (x: number, y: number): SplineValue['points'][number] => ({ x, y, mode: 'corner' });
const auto = (x: number, y: number): SplineValue['points'][number] => ({ x, y, mode: 'auto' });

/** Generate one shape in UV space (pure, unit-tested via the node). */
export function makeShape(shape: Shape, c: [number, number], r: number, n: number, inner: number, rotDeg: number, round: number): SplineValue {
  const rot = (rotDeg * Math.PI) / 180;
  const ang = (i: number, k: number, off = 0): number => (i / k) * Math.PI * 2 + off;
  let sp: SplineValue;
  switch (shape) {
    case 'circle':
      sp = { closed: true, points: Array.from({ length: Math.max(4, n) }, (_, i) => auto(c[0] + Math.cos(ang(i, Math.max(4, n))) * r, c[1] + Math.sin(ang(i, Math.max(4, n))) * r)) };
      break;
    case 'polygon':
      sp = { closed: true, points: Array.from({ length: Math.max(3, n) }, (_, i) => corner(c[0] + Math.cos(ang(i, Math.max(3, n), -Math.PI / 2)) * r, c[1] + Math.sin(ang(i, Math.max(3, n), -Math.PI / 2)) * r)) };
      break;
    case 'star': {
      const k = Math.max(3, n);
      sp = { closed: true, points: Array.from({ length: k * 2 }, (_, i) => corner(c[0] + Math.cos(ang(i, k * 2, -Math.PI / 2)) * r * (i % 2 ? inner : 1), c[1] + Math.sin(ang(i, k * 2, -Math.PI / 2)) * r * (i % 2 ? inner : 1))) };
      break;
    }
    case 'rounded_rect': {
      const w = r;
      const h = r * 0.7;
      const k = Math.min(w, h) * Math.max(0.01, Math.min(1, round));
      sp = { closed: true, points: [corner(c[0] - w + k, c[1] - h), corner(c[0] + w - k, c[1] - h), corner(c[0] + w, c[1] - h + k), corner(c[0] + w, c[1] + h - k), corner(c[0] + w - k, c[1] + h), corner(c[0] - w + k, c[1] + h), corner(c[0] - w, c[1] + h - k), corner(c[0] - w, c[1] - h + k)] };
      break;
    }
    case 'line':
      sp = { closed: false, points: [corner(c[0] - r, c[1]), corner(c[0] + r, c[1])] };
      break;
    case 'arc':
      sp = { closed: false, points: Array.from({ length: Math.max(3, n) }, (_, i) => auto(c[0] + Math.cos(Math.PI * (1.15 + (i / (Math.max(3, n) - 1)) * 0.7)) * r, c[1] + Math.sin(Math.PI * (1.15 + (i / (Math.max(3, n) - 1)) * 0.7)) * r + r * 0.5)) };
      break;
  }
  return rot ? transformSpline(sp, { rot, pivot: c }) : sp;
}

/** geometry.spline_shape — generates a Spline (circle, rounded rectangle, star, polygon, line, arc). */
export default defineNode({
  id: 'geometry.spline_shape',
  version: 1,
  category: 'geometry',
  title: 'Spline Shape',
  description: 'Generates a spline from a parametric shape: circle, rounded rectangle, star, polygon, line or arc. Feed it into Sweep (Profile or Path), Spline Transform / Resample / Combine, or the Spline node.',
  keywords: ['spline', 'shape', 'circle', 'star', 'polygon', 'rectangle', 'profile', 'generator'],
  icon: 'spline',
  inputs: [],
  outputs: [{ id: 'spline', name: 'Spline', type: 'spline' }],
  common: { texture: false },
  params: [
    P.enum('shape', 'circle', SHAPES.map((s) => ({ value: s, label: s.replace(/_/g, ' ').replace(/^\w/, (x) => x.toUpperCase()) })), { group: 'Shape' }),
    P.vec2('center', [0.5, 0.5], { group: 'Shape', step: 0.01, softMin: 0, softMax: 1, animatable: true }),
    P.float('radius', 0.3, { group: 'Shape', min: 0.001, max: 100, softMax: 1, step: 0.005, animatable: true }),
    P.int('points', 8, { group: 'Shape', min: 3, max: 256, softMax: 32, label: 'Points / sides', visibleIf: (v) => ['circle', 'star', 'polygon', 'arc'].includes(String(v.shape)) }),
    P.float('inner', 0.45, { group: 'Shape', min: 0.01, max: 1, step: 0.01, label: 'Star inner radius', visibleIf: (v) => v.shape === 'star' }),
    P.float('round', 0.35, { group: 'Shape', min: 0.01, max: 1, step: 0.01, label: 'Corner cut', visibleIf: (v) => v.shape === 'rounded_rect' }),
    P.float('rotation', 0, { group: 'Shape', min: -3600, max: 3600, softMin: -180, softMax: 180, unit: '°', step: 1, animatable: true }),
  ],
  gizmos: [{ id: 'shape', label: 'Shape centre / radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius' }],
  cost: { gpu: 'trivial', tiling: 'global' },
  gallery: [{ name: 'Star', params: { shape: 'star', points: 5 } }, { name: 'Hexagon', params: { shape: 'polygon', points: 6 } }, { name: 'Rounded rectangle', params: { shape: 'rounded_rect' } }],
  evaluate(ctx) {
    const p = ctx.params;
    const c = p.vec2('center');
    const sp = makeShape(p.str('shape') as Shape, [c[0], c[1]], p.num('radius'), p.int('points'), p.num('inner'), p.num('rotation'), p.num('round'));
    return { spline: splineValue(setOf(sp)) };
  },
});

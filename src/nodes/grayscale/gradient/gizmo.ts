import type { GizmoDecl } from '../../../engine/graph/node';

const LINEAR = ['linear', 'reflected'];
const RADIAL = ['radial', 'diamond', 'square', 'spiral', 'angular'];

/** Gradient gizmos: a Line (start -> end) for linear/reflected, a Circle (centre/radius) + Angle for the radial family. */
export const gizmos: GizmoDecl[] = [
  { id: 'line', label: 'Gradient line', type: 'line', viewport: '2d', space: 'uv', from: 'start', to: 'end', visibleIf: (v) => LINEAR.includes(v.gtype as string) },
  { id: 'circle', label: 'Gradient radius', type: 'circle', viewport: '2d', space: 'uv', center: 'center', radius: 'radius', visibleIf: (v) => RADIAL.includes(v.gtype as string) && v.gtype !== 'angular' },
  { id: 'angle', label: 'Start angle', type: 'angle', viewport: '2d', space: 'uv', center: 'center', angle: 'angle', visibleIf: (v) => v.gtype === 'angular' || v.gtype === 'spiral' },
];

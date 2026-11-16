import type { GizmoDecl } from '../../../engine/graph/node';

/**
 * Polar Scatter gizmos: a Falloff-style pair of circles (inner = first ring radius, outer = last ring radius, shared
 * centre handle) plus an Angle handle for the start angle of the radial array.
 */
export const gizmos: GizmoDecl[] = [
  { id: 'rings', label: 'Ring radii', type: 'falloff', viewport: '2d', space: 'uv', center: 'center', inner: 'radius_min', outer: 'radius_max' },
  { id: 'start', label: 'Start angle', type: 'angle', viewport: '2d', space: 'uv', center: 'center', angle: 'angle_start' },
];

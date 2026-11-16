import type { GizmoDecl } from '../../../engine/graph/node';

/**
 * Fractal gizmos (declarations only; the framework in src/gizmos draws them and writes through the undo system).
 *  - Transform2D: position <- `position` (pattern centre = uv 0.5 + position), rotation <- `rotation`, scale <- `scale`
 *    (cells across; the gizmo frame is ONE first-octave cell => reciprocal map). tilingSafe: integer scale and quarter
 *    turns while the graph tiles, exactly what the shader does.
 *  - Range gizmos for the splat scale range and the intensity range (two scalar params each).
 */
export const gizmos: GizmoDecl[] = [
  {
    id: 'pattern',
    label: 'Fractal transform',
    type: 'transform',
    viewport: '2d',
    space: 'uv',
    position: { param: 'position', map: { offset: 0.5 } },
    rotation: 'rotation',
    scale: { param: 'scale', map: { reciprocal: true } },
    tilingSafe: true,
  },
  { id: 'scale_range', label: 'Scale range', type: 'range', viewport: '2d', space: 'uv', min: 'scale_min', max: 'scale_max', origin: [0.1, 0.93], angle: 0, length: 0.6, visibleIf: (v) => v.shape !== 'pixel' },
  { id: 'intensity_range', label: 'Intensity range', type: 'range', viewport: '2d', space: 'uv', min: 'int_min', max: 'int_max', origin: [0.1, 0.86], angle: 0, length: 0.6 },
];

import type { GizmoDecl } from '../../../engine/graph/node';

/**
 * Noise Transform2D gizmo (reference for every spatial node). The node only declares BINDINGS:
 *  - position <- `offset`: the pattern's lattice origin sits at uv (0.5 - offset), so {scale:-1, offset:0.5}
 *    makes dragging the gizmo move the pattern the way the cursor moves.
 *  - rotation <- `rotation` (degrees, clockwise): the shader rotates about that same origin.
 *  - scale    <- `scale` ("cells across"): the gizmo frame is ONE CELL, so the map is {reciprocal:true}.
 * tilingSafe: while the graph tiles, dragging snaps scale to whole numbers and rotation to 90 degrees, exactly what
 * the shader does, so the gizmo never shows something the image does not do.
 */
export const gizmos: GizmoDecl[] = [
  {
    id: 'pattern',
    label: 'Noise transform',
    type: 'transform',
    viewport: '2d',
    space: 'uv',
    position: { param: 'offset', map: { scale: -1, offset: 0.5 } },
    rotation: 'rotation',
    scale: { param: 'scale', map: { reciprocal: true } },
    tilingSafe: true,
  },
];

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { cameraValue } from '../../../engine/mesh/camera';

/** camera.camera — a camera description (perspective / orthographic) for the 3D viewport, viewport export and turntables. */
export default defineNode({
  id: 'camera.camera',
  version: 1,
  category: 'camera',
  title: 'Camera',
  description: 'Position, target, field of view (or orthographic height), clip planes and roll. Pick it in a 3D viewport (Camera menu) to look through it; Viewport export and turntables (Export) use it. Z up.',
  keywords: ['camera', 'view', 'fov', 'orthographic', 'perspective', 'render'],
  icon: 'cat-camera',
  inputs: [],
  outputs: [{ id: 'camera', name: 'Camera', type: 'camera' }],
  common: { texture: false },
  params: [
    P.vec3('position', [4, -6, 3.2], { tab: 'Camera', step: 0.01, softMin: -20, softMax: 20, animatable: true }),
    P.vec3('target', [0, 0, 0.6], { tab: 'Camera', step: 0.01, softMin: -20, softMax: 20, animatable: true }),
    P.bool('ortho', false, { tab: 'Camera', label: 'Orthographic' }),
    P.float('fov', 40, { tab: 'Camera', label: 'Field of view', min: 1, max: 170, step: 0.5, display: 'angle', animatable: true, visibleIf: (v) => !v.ortho }),
    P.float('ortho_size', 4, { tab: 'Camera', label: 'Ortho height', min: 0.001, max: 10000, softMax: 40, step: 0.05, animatable: true, visibleIf: (v) => !!v.ortho }),
    P.float('roll', 0, { tab: 'Camera', min: -180, max: 180, step: 0.5, display: 'angle', animatable: true }),
    P.float('near', 0.05, { tab: 'Camera', min: 0.0001, max: 1000, softMax: 10, step: 0.01, group: 'Clipping' }),
    P.float('far', 500, { tab: 'Camera', min: 0.01, max: 1e6, softMax: 2000, step: 1, group: 'Clipping' }),
  ],
  gizmos: [
    { id: 'pos', type: 'point3d', viewport: '3d', space: 'world', param: 'position', label: 'Camera' },
    { id: 'tgt', type: 'point3d', viewport: '3d', space: 'world', param: 'target', label: 'Target' },
  ],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const p = ctx.params;
    const position = p.vec3('position');
    const target = p.vec3('target');
    if (Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]) < 1e-6) throw new Error('Camera position and target coincide');
    return { camera: cameraValue({ position, target, up: [0, 0, 1], fovY: p.num('fov'), ortho: p.bool('ortho'), orthoSize: p.num('ortho_size'), near: p.num('near'), far: Math.max(p.num('far'), p.num('near') * 2), roll: p.num('roll') }) };
  },
});

import { defineNode } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { asMesh } from '../../../engine/mesh/accounting';
import { asCamera, cameraValue, defaultCamera, type CameraData } from '../../../engine/mesh/camera';
import { v3 } from '../../../engine/mesh/math3';

/** camera.look_at — aims a camera (or its own position) at a point or at the bounds centre of a mesh. */
export default defineNode({
  id: 'camera.look_at',
  version: 1,
  category: 'camera',
  title: 'Look At',
  description: 'Aims the input camera at a target point, or at the bounds centre of a connected mesh (optionally framing it by distance). Without an input camera it uses its own position. Keeps the camera distance unless "Distance" is set.',
  keywords: ['look at', 'aim', 'target', 'frame', 'camera', 'turntable'],
  icon: 'cat-camera',
  inputs: [
    { id: 'camera', name: 'Camera', type: 'camera', optional: true },
    { id: 'mesh', name: 'Mesh', type: 'mesh', optional: true, tooltip: 'When connected and "Target mesh bounds" is on, the target is the bounds centre.' },
  ],
  outputs: [{ id: 'camera', name: 'Camera', type: 'camera' }],
  common: { texture: false },
  params: [
    P.bool('use_mesh', true, { tab: 'Look At', label: 'Target mesh bounds', tooltip: 'Use the bounds centre of the connected mesh as the target.' }),
    P.vec3('target', [0, 0, 0], { tab: 'Look At', step: 0.01, softMin: -20, softMax: 20, animatable: true, visibleIf: (v) => !v.use_mesh }),
    P.vec3('position', [4, -6, 3.2], { tab: 'Look At', step: 0.01, softMin: -20, softMax: 20, animatable: true, tooltip: 'Used only when no camera is connected.' }),
    P.float('distance', 0, { tab: 'Look At', min: 0, max: 10000, softMax: 40, step: 0.05, animatable: true, tooltip: '0 keeps the current distance; otherwise the camera is placed this far from the target along its current direction.' }),
    P.float('frame_margin', 1, { tab: 'Look At', label: 'Frame mesh (x radius)', min: 0, max: 20, step: 0.05, tooltip: 'With a mesh and Distance = 0: distance = mesh radius x this value / tan(fov/2). 0 disables framing.' }),
  ],
  gizmos: [{ id: 'tgt', type: 'point3d', viewport: '3d', space: 'world', param: 'target', label: 'Target', visibleIf: (v) => !v.use_mesh }],
  cost: { gpu: 'trivial', tiling: 'pixel' },
  evaluate(ctx) {
    const p = ctx.params;
    const base: CameraData = asCamera(ctx.inputs.camera) ?? { ...defaultCamera(), position: p.vec3('position') };
    const mesh = asMesh(ctx.inputs.mesh);
    const b = mesh && p.bool('use_mesh') ? mesh.bounds() : null;
    const target = b && !b.empty ? b.center : p.vec3('target');
    let dir = v3.sub(base.position, target);
    if (v3.len(dir) < 1e-6) dir = [0, -1, 0.5];
    let dist = v3.len(dir);
    const wanted = p.num('distance');
    if (wanted > 0) dist = wanted;
    else if (b && !b.empty && p.num('frame_margin') > 0 && !base.ortho) dist = Math.max(0.01, (b.radius * p.num('frame_margin')) / Math.tan((base.fovY * Math.PI) / 360));
    const position = v3.add(target, v3.scale(v3.norm(dir), dist));
    return { camera: cameraValue({ ...base, position, target, orthoSize: base.ortho && b && !b.empty && wanted <= 0 && p.num('frame_margin') > 0 ? b.radius * 2 * p.num('frame_margin') : base.orthoSize }) };
  },
});

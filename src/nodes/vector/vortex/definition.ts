import type { GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import { FALLOFF_OPTIONS, pointSources } from '../_falloff';
import src from './shader.wgsl?raw';

const gizmos: GizmoDecl[] = [1, 2, 3, 4].map((i) => ({ id: `vortex${i}`, label: `Vortex ${i}`, type: 'circle', viewport: '2d', space: 'uv', center: `w${i}_pos`, radius: `w${i}_radius`, visibleIf: (v) => Number(v[`w${i}_strength`]) !== 0 }) as GizmoDecl);

/** vector.vortex: swirls with a solid-body core and a falloff, up to four, optional mask for the strength. */
export default shaderNode({
  id: 'vector.vortex',
  title: 'Vector Vortex',
  description: 'Swirling vector field: up to four vortices with a solid-rotation core, a falloff ring and signed strength (sign = rotation direction). An optional mask modulates the swirl.',
  keywords: ['vector', 'vortex', 'swirl', 'whirl', 'rotation', 'tornado', 'spin'],
  inputs: [{ id: 'mask', name: 'Mask', type: 'gray', tooltip: 'Optional Gray mask multiplying every vortex.' }],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  params: [
    P.enum('falloff', 'smooth', FALLOFF_OPTIONS, { group: 'Field', label: 'Falloff' }),
    P.float('core', 0.25, { group: 'Field', label: 'Core size', min: 0, max: 1, step: 0.01, display: 'percent', tooltip: 'Fraction of the radius that rotates like a solid body.' }),
    ...pointSources('w', 4, 'Swirl', (i) => ({ pos: [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75]][i - 1] as [number, number], radius: 0.35, strength: i === 1 ? 0.6 : 0 })),
  ],
  gizmos,
  gallery: [
    { name: 'Single vortex', params: { w1_strength: 0.8 } },
    { name: 'Counter-rotating pair', params: { w1_pos: [0.35, 0.5], w1_strength: 0.7, w2_pos: [0.65, 0.5], w2_strength: -0.7, w2_radius: 0.25 } },
    { name: 'Tight core', params: { core: 0.05, w1_strength: 0.8 } },
  ],
  shader: src,
});

import type { GizmoDecl } from '../../../engine/graph/node';
import { P } from '../../../engine/params/schema';
import { shaderNode } from '../../_shared/shadernode';
import { FALLOFF_OPTIONS, pointSources } from '../_falloff';
import src from './shader.wgsl?raw';

const gizmos: GizmoDecl[] = [1, 2, 3, 4].map((i) => ({ id: `src${i}`, label: `Source ${i}`, type: 'circle', viewport: '2d', space: 'uv', center: `r${i}_pos`, radius: `r${i}_radius`, visibleIf: (v) => Number(v[`r${i}_strength`]) !== 0 }) as GizmoDecl);

/** vector.radial: up to four sources (positive strength) / sinks (negative) with falloff. */
export default shaderNode({
  id: 'vector.radial',
  title: 'Vector Radial',
  description: 'Radial vector field: sources push outwards, sinks (negative strength) pull inwards. Four points with radius and falloff; tiling-aware.',
  keywords: ['vector', 'radial', 'source', 'sink', 'explosion', 'attract', 'repel', 'burst'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }],
  vecScale: 1,
  params: [
    P.enum('falloff', 'smooth', FALLOFF_OPTIONS, { group: 'Field', label: 'Falloff' }),
    ...pointSources('r', 4, 'Strength', (i) => ({ pos: [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75]][i - 1] as [number, number], radius: 0.3, strength: i === 1 ? 0.5 : 0 })),
  ],
  gizmos,
  gallery: [
    { name: 'Burst', params: { r1_strength: 0.8, r1_radius: 0.4 } },
    { name: 'Sink', params: { r1_strength: -0.6, r1_radius: 0.4 } },
    { name: 'Source + sink', params: { r1_pos: [0.3, 0.5], r1_strength: 0.6, r2_pos: [0.7, 0.5], r2_strength: -0.6, r2_radius: 0.3 } },
  ],
  shader: src,
});

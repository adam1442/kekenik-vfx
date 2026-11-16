import { P } from '../../../engine/params/schema';
import { shaderNodeVariants } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.advect: moves a Gray / Color texture through a Vector field: displace, integrate (RK1/2/4) or looping flow map. */
export default shaderNodeVariants({
  id: 'vector.advect',
  title: 'Vector Advect',
  description: 'Advects an image through a vector field. Displace = one step; Integrate = several RK2 / RK4 steps along the field; Flow map = two time-offset samples blended with a triangle weight so the animation loops seamlessly (animate Phase 0 to 1).',
  keywords: ['vector', 'advect', 'flow', 'flowmap', 'displace', 'warp', 'advection', 'integrate', 'rk4', 'loop'],
  inputs: [
    { id: 'input', name: 'Input', type: 'gray' },
    { id: 'vector', name: 'Vector', type: 'vector' },
    { id: 'strength_mask', name: 'Strength mask', type: 'gray', tooltip: 'Optional Gray mask multiplying the strength per pixel.' },
  ],
  imagePins: ['input', 'output'],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Output', type: 'gray' }],
  timeDependent: false,
  params: [
    P.enum('mode', 'integrate', [{ value: 'displace', label: 'Single step (displace)' }, { value: 'integrate', label: 'Multi-step integration' }, { value: 'flowmap', label: 'Looping flow map' }], { group: 'Advection', label: 'Mode' }),
    P.float('strength', 0.3, { group: 'Advection', label: 'Strength', min: -100, max: 100, softMin: -2, softMax: 2, step: 0.005, animatable: true, unit: 's', tooltip: 'Time span carried along the field: displacement = vector x strength (vectors are tile fractions per second).' }),
    P.enum('direction', 'backward', [{ value: 'backward', label: 'Backward (semi-Lagrangian)' }, { value: 'forward', label: 'Forward (content flows against)' }], { group: 'Advection', label: 'Direction', tooltip: 'Backward: content moves WITH the vectors (the usual look).' }),
    P.enum('method', 'rk2', [{ value: 'rk1', label: 'Euler' }, { value: 'rk2', label: 'RK2' }, { value: 'rk4', label: 'RK4' }], { group: 'Integration', label: 'Method', visibleIf: (v) => v.mode === 'integrate' }),
    P.int('steps', 8, { group: 'Integration', label: 'Steps', min: 1, max: 64, softMax: 24, visibleIf: (v) => v.mode === 'integrate' }),
    P.float('phase', 0, { group: 'Flow map', label: 'Phase', min: -1000, max: 1000, softMin: 0, softMax: 1, step: 0.005, animatable: true, visibleIf: (v) => v.mode === 'flowmap', tooltip: '0 to 1 is one seamless loop.' }),
    P.float('scatter', 0.3, { group: 'Flow map', label: 'Phase scatter', min: 0, max: 1, step: 0.01, display: 'percent', visibleIf: (v) => v.mode === 'flowmap', tooltip: 'Per-pixel phase offset from tileable noise: hides the pulsing of the two phases.' }),
    P.seed('seed', 5, { group: 'Flow map', label: 'Seed', visibleIf: (v) => v.mode === 'flowmap' }),
  ],
  gallery: [
    { name: 'Smoke trails', params: { mode: 'integrate', steps: 12, strength: 0.5 } },
    { name: 'Flow map loop', params: { mode: 'flowmap', phase: 0.25, strength: 0.4 } },
    { name: 'Single step', params: { mode: 'displace', strength: 0.2 } },
  ],
  shader: src,
});

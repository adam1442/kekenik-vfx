import type { EvalContext, GizmoDecl } from '../../engine/graph/node';
import type { PinDef } from '../../engine/graph/pins';
import type { Params } from '../../engine/params/accessor';
import { P } from '../../engine/params/schema';
import type { CpuTexture } from '../../engine/mesh/texsnap';
import type { Falloff } from '../../engine/mesh/deform';
import type { NoiseSource } from '../../engine/mesh/attrs';
import type { NoiseKind } from '../../engine/mesh/noise3';

/** Shared helpers of the mesh nodes. */

/** CPU snapshot of a texture input (null = unconnected or still being read back; the node is re-run when it arrives). */
export const cpuTexOf = (ctx: EvalContext, pin: string): CpuTexture | null => ctx.cpuTexture?.(pin) ?? null;
/** True while a connected texture input waits for its snapshot (node shows a neutral result meanwhile). */
export const texPending = (ctx: EvalContext, pin: string): boolean => ctx.cpuTexturePending?.(pin) ?? false;

export const meshIn = (pin: 'mesh' | 'points', id = 'input'): PinDef => ({ id, name: pin === 'mesh' ? 'Mesh' : 'Points', type: pin });
export const meshOut = (pin: 'mesh' | 'points', id = 'output'): PinDef => ({ id, name: pin === 'mesh' ? 'Mesh' : 'Points', type: pin });

export const CHANNELS = [
  { value: 'r', label: 'R' },
  { value: 'g', label: 'G' },
  { value: 'b', label: 'B' },
  { value: 'a', label: 'A' },
  { value: 'luma', label: 'Luminance' },
];
export const channelIndex = (c: string): number => ({ r: 0, g: 1, b: 2, a: 3, luma: 4 })[c as 'r'] ?? 4;

/* ------------------------------------------------------------------------------------------- noise params */
export const noiseSourceParams = (tab: string, group: string, vis?: (v: Record<string, unknown>) => boolean) => [
  P.enum('n_kind', 'perlin', [{ value: 'perlin', label: 'Perlin (4D, loops exactly)' }, { value: 'simplex', label: 'Simplex (loop by cross-fade)' }], { tab, group, label: 'Noise type', visibleIf: vis as never }),
  P.float('n_frequency', 2, { tab, group, label: 'Frequency', min: 0.001, max: 200, softMax: 20, step: 0.05, visibleIf: vis as never }),
  P.int('n_octaves', 3, { tab, group, label: 'Octaves', min: 1, max: 8, visibleIf: vis as never }),
  P.seed('n_seed', 1, { tab, group, label: 'Seed', visibleIf: vis as never }),
];
export const noiseSourceOf = (p: Params, t = 0, loopCycles = 0): NoiseSource => ({ kind: p.str('n_kind') as NoiseKind, frequency: p.num('n_frequency'), octaves: p.int('n_octaves'), seed: p.seed('n_seed'), t, loopCycles });

/* ------------------------------------------------------------------------------------------ falloff params */
export const falloffParams = (tab = 'Falloff') => [
  P.bool('falloff_enabled', false, { tab, label: 'Enable falloff region', tooltip: 'Limit the effect to a spherical region (gizmo in the 3D viewport).' }),
  P.vec3('falloff_center', [0, 0, 0], { tab, label: 'Center', step: 0.01, softMin: -10, softMax: 10, animatable: true, visibleIf: (v) => !!v.falloff_enabled }),
  P.float('falloff_inner', 0.5, { tab, label: 'Inner radius', min: 0, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: (v) => !!v.falloff_enabled }),
  P.float('falloff_outer', 1.5, { tab, label: 'Outer radius', min: 0, max: 1000, softMax: 10, step: 0.01, animatable: true, visibleIf: (v) => !!v.falloff_enabled }),
  P.bool('falloff_invert', false, { tab, label: 'Invert', visibleIf: (v) => !!v.falloff_enabled }),
];
export const falloffGizmo = (): GizmoDecl => ({ id: 'falloff', type: 'falloff3d', viewport: '3d', space: 'world', center: 'falloff_center', inner: 'falloff_inner', outer: 'falloff_outer', visibleIf: (v) => !!v.falloff_enabled }) as GizmoDecl;
export const falloffOf = (p: Params): Falloff => ({ enabled: p.bool('falloff_enabled'), center: p.vec3('falloff_center'), inner: p.num('falloff_inner'), outer: p.num('falloff_outer'), invert: p.bool('falloff_invert') });

import type { GizmoDecl } from '../../engine/graph/node';
import type { ParamDef } from '../../engine/params/schema';
import { P } from '../../engine/params/schema';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout } from '../../engine/shaders/uniforms';
import type { Params } from '../../engine/params/accessor';
import { uvModeIndex } from './uvparams';
import polarSrc from './polar.wgsl?raw';

/**
 * Shared kernel of Cartesian <-> Polar (utils.cartesian_to_polar, utils.polar_to_cartesian, uv.cartesian_to_polar).
 * Math is documented in polar.wgsl; `polarC2P` / `polarP2C` below are the CPU mirrors used by tests / self-test.
 */
export const POLAR_SHADER = defineShader('shared_polar.wgsl', polarSrc);
export const POLAR_LAYOUT = makeLayout([
  { name: 'center', type: 'vec2f' },
  { name: 'rotation', type: 'f32' },
  { name: 'scale', type: 'f32' },
  { name: 'spiral', type: 'f32' },
  { name: 'metric', type: 'u32' },
  { name: 'squircle', type: 'f32' },
  { name: 'pinch', type: 'f32' },
  { name: 'persp', type: 'f32' },
  { name: 'ap', type: 'f32' },
  { name: 'rscale', type: 'f32' },
  { name: 'rcenter', type: 'f32' },
  { name: 'oob', type: 'u32' },
  { name: 'ang_tiles', type: 'f32' },
  { name: 'rad_tiles', type: 'f32' },
  { name: 'ov_range', type: 'f32' },
  { name: 'ov_scale', type: 'f32' },
  { name: 'uv_mode', type: 'u32' },
]);

export type PolarKind = 'c2p' | 'p2c' | 'uv';

/** Parameter schema (IlluGen set): Transform / Shape / Aperture / Tiling / Overlap. */
export function polarParams(kind: PolarKind): ParamDef[] {
  const c2p = kind !== 'p2c';
  const out: ParamDef[] = [
    P.vec2('position', [0.5, 0.5], { group: 'Transform', min: -4, max: 5, softMin: 0, softMax: 1, step: 0.005, animatable: true, tooltip: 'Centre of the polar mapping (UV).' }),
    P.float('rotation', 0, { group: 'Transform', min: -3600, max: 3600, softMin: -180, softMax: 180, step: 0.5, display: 'angle', animatable: true }),
    P.float('scale', 1, { group: 'Transform', min: 0.01, max: 32, softMin: 0.25, softMax: 4, step: 0.01, animatable: true, tooltip: '1 = the radius of the inscribed circle (half of the smaller side) maps to the full source height.' }),
    P.float('spiral', 0, { group: 'Transform', min: -16, max: 16, softMin: -2, softMax: 2, step: 0.01, animatable: true, tooltip: 'Offsets the angle by the distance from the centre: turns of twist per unit radius.' }),
    P.enum('metric', 'euclidean', [{ value: 'euclidean', label: 'Euclidean (circular)' }, { value: 'chebyshev', label: 'Chebyshev (square)' }, { value: 'squircle', label: 'Squircle' }], { group: 'Shape', label: 'Distance metric' }),
    P.float('squircle', 4, { group: 'Shape', label: 'Squircle factor', min: 1, max: 16, softMin: 2, softMax: 8, step: 0.1, visibleIf: (v) => v.metric === 'squircle', tooltip: 'p-norm exponent: 2 = circle, large = square.' }),
    P.float('pinch', 0, { group: 'Shape', min: -4, max: 4, softMin: -2, softMax: 2, step: 0.01, animatable: true, tooltip: 'Radial power curve (+ pulls content towards the centre, - pushes it out).' }),
    P.float('perspective', 0, { group: 'Shape', min: 0, max: 0.98, step: 0.01, display: 'percent', animatable: true, tooltip: 'Tunnel look: the radius maps through 1/r so texture compresses towards the centre.' }),
    P.float('angle', 360, { group: 'Aperture', label: 'Angle', min: 1, max: 360, step: 1, display: 'angle', animatable: true, tooltip: 'Angular range covered by the full width of the polar image.' }),
    P.float('radial_scaling', 1, { group: 'Aperture', min: 0.05, max: 16, softMin: 0.25, softMax: 4, step: 0.01, animatable: true }),
    P.float('radial_centering', 0, { group: 'Aperture', min: -2, max: 2, softMin: -1, softMax: 1, step: 0.005, animatable: true, tooltip: 'Shifts the radial axis of the polar image.' }),
    P.enum('out_of_range', 'repeat', [{ value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'transparent', label: 'Transparent' }], { group: 'Aperture', label: 'Out of range', tooltip: 'What happens outside the radial / angular range.' }),
    P.int('angular_tiling', 1, { group: 'Tiling', min: 1, max: 64, softMax: 16 }),
    P.int('radial_tiling', 1, { group: 'Tiling', min: 1, max: 64, softMax: 16 }),
  ];
  if (c2p && kind === 'c2p') {
    out.push(
      P.float('overlap_range', 0, { group: 'Overlap', min: 0, max: 0.5, step: 0.005, display: 'percent', animatable: true, tooltip: 'Cross-fades the angular seam of NON-tiling inputs: this much of the source width is blended over the start.' }),
      P.float('overlap_scale', 1, { group: 'Overlap', min: 0.05, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: 'Width of the cross-fade relative to the overlap range.' }),
    );
  }
  return out;
}

export const polarGizmos: GizmoDecl[] = [
  { id: 'centre', label: 'Polar centre', type: 'circle', viewport: '2d', space: 'uv', center: 'position', radius: { param: 'scale', map: { scale: 2, reciprocal: true } } },
  { id: 'rotation', label: 'Rotation', type: 'angle', viewport: '2d', space: 'uv', center: 'position', angle: 'rotation' },
];

/** Uniform values for POLAR_LAYOUT from a node's params. */
export function polarValues(p: Params, kind: PolarKind): Record<string, number | boolean | number[]> {
  return {
    center: p.vec2('position'),
    rotation: (p.num('rotation') * Math.PI) / 180,
    scale: p.num('scale'),
    spiral: p.num('spiral'),
    metric: p.enumIndex('metric'),
    squircle: p.num('squircle'),
    pinch: p.num('pinch'),
    persp: p.num('perspective'),
    ap: p.num('angle') / 360,
    rscale: p.num('radial_scaling'),
    rcenter: p.num('radial_centering'),
    oob: p.enumIndex('out_of_range'),
    ang_tiles: p.int('angular_tiling'),
    rad_tiles: p.int('radial_tiling'),
    ov_range: kind === 'c2p' ? p.num('overlap_range') : 0,
    ov_scale: kind === 'c2p' ? p.num('overlap_scale') : 1,
    uv_mode: p.has('uv_out') ? uvModeIndex(p.str('uv_out')) : 0,
  };
}

/* ------------------------------------------------------------------------------------------------ CPU mirror */
export interface PolarRef {
  center: [number, number];
  rotation: number; // radians
  scale: number;
  spiral: number;
  metric: 0 | 1 | 2;
  squircle: number;
  pinch: number;
  persp: number;
  ap: number; // turns
  rscale: number;
  rcenter: number;
  oob: 0 | 1 | 2; // clamp, repeat, transparent
  angTiles: number;
  radTiles: number;
}
export const polarDefaults = (): PolarRef => ({ center: [0.5, 0.5], rotation: 0, scale: 1, spiral: 0, metric: 0, squircle: 4, pinch: 0, persp: 0, ap: 1, rscale: 1, rcenter: 0, oob: 1, angTiles: 1, radTiles: 1 });

const TAU = Math.PI * 2;
export function polarMetric(d: [number, number], r: PolarRef): number {
  const ax = Math.abs(d[0]);
  const ay = Math.abs(d[1]);
  if (r.metric === 1) return Math.max(ax, ay);
  if (r.metric === 2) {
    const n = Math.max(r.squircle, 1);
    return Math.pow(Math.pow(ax, n) + Math.pow(ay, n), 1 / n);
  }
  return Math.hypot(d[0], d[1]);
}
const perspE = (a: number): number => {
  const c = Math.min(Math.max(a, 0.02), 0.98);
  return (0.25 * (1 - c)) / c;
};
export function perspFwd(rad: number, a: number): number {
  if (a < 0.02) return rad;
  const e = perspE(a);
  const k = 1 / e - 1 / (1 + e);
  return 1 - (1 / (rad + e) - 1 / (1 + e)) / k;
}
export function perspInv(v: number, a: number): number {
  if (a < 0.02) return v;
  const e = perspE(a);
  const k = 1 / e - 1 / (1 + e);
  const w = Math.max((1 - v) * k + 1 / (1 + e), 0.0001);
  return Math.max(1 / w - e, 0);
}
/** C2P: (u, v, outOfRange) for the output pixel at uv (aspect = width / height; overlap not included). */
export function polarC2P(uv: [number, number], r: PolarRef, aspect = 1): { u: number; v: number; oob: boolean } {
  const asp: [number, number] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect];
  const d: [number, number] = [(uv[0] - r.center[0]) * asp[0], (uv[1] - r.center[1]) * asp[1]];
  const rn = polarMetric(d, r) / (0.5 * Math.max(r.scale, 0.0001));
  const th = Math.atan2(d[1], d[0]) - r.rotation - r.spiral * rn * TAU;
  let a = th / TAU;
  a -= Math.floor(a);
  const rp = perspFwd(Math.pow(rn, Math.pow(2, -r.pinch)), r.persp);
  let v = (rp - 0.5) * r.rscale + 0.5 + r.rcenter;
  let u = a / Math.max(r.ap, 0.0001);
  const oob = u > 1 || v < 0 || v > 1;
  if (r.oob === 1) {
    u -= Math.floor(u);
    v -= Math.floor(v);
  } else {
    u = Math.min(Math.max(u, 0), 1);
    v = Math.min(Math.max(v, 0), 1);
  }
  if (r.angTiles > 1) {
    u *= r.angTiles;
    u -= Math.floor(u);
  }
  if (r.radTiles > 1) {
    v *= r.radTiles;
    v -= Math.floor(v);
  }
  return { u, v, oob };
}
/** P2C: source position (uv space) shown by the output pixel at uv. */
export function polarP2C(uv: [number, number], r: PolarRef, aspect = 1): [number, number] {
  const asp: [number, number] = aspect >= 1 ? [aspect, 1] : [1, 1 / aspect];
  const u0 = uv[0] / Math.max(r.angTiles, 1);
  const v0 = uv[1] / Math.max(r.radTiles, 1);
  const rp = (v0 - 0.5 - r.rcenter) / r.rscale + 0.5;
  const rn = Math.pow(Math.max(perspInv(rp, r.persp), 0), Math.pow(2, r.pinch));
  const th = u0 * r.ap * TAU + r.rotation + r.spiral * rn * TAU;
  const w: [number, number] = [Math.cos(th), Math.sin(th)];
  const k = (rn * 0.5 * Math.max(r.scale, 0.0001)) / Math.max(polarMetric(w, r), 0.0001);
  return [r.center[0] + (w[0] * k) / asp[0], r.center[1] + (w[1] * k) / asp[1]];
}

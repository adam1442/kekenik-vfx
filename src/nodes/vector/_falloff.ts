import { P, type ParamSchema, type ParamValues } from '../../engine/params/schema';

/** Falloff profile options shared by Radial / Vortex / Spline (matches `uvf_falloff` in uvfield.wgsl). */
export const FALLOFF_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'smooth', label: 'Smooth' },
  { value: 'gaussian', label: 'Gaussian' },
  { value: 'constant', label: 'Constant (hard edge)' },
  { value: 'ease', label: 'Ease out' },
];

/** N identical point sources (position / radius / strength), param ids `<prefix><i>_pos|radius|strength`. */
export function pointSources(prefix: string, n: number, strengthLabel: string, def: (i: number) => { pos: [number, number]; radius: number; strength: number }): ParamSchema {
  const out: ParamSchema = [];
  for (let i = 1; i <= n; i++) {
    const d = def(i);
    const g = `Source ${i}`;
    out.push(
      P.vec2(`${prefix}${i}_pos`, d.pos, { group: g, label: 'Position', min: -1, max: 2, step: 0.005, animatable: true, tooltip: 'Centre in tile space (0..1, y down).' }),
      P.float(`${prefix}${i}_radius`, d.radius, { group: g, label: 'Radius', min: 0.005, max: 2, softMax: 0.6, step: 0.005, animatable: true, tooltip: 'Radius as a fraction of the smaller image side.' }),
      P.float(`${prefix}${i}_strength`, d.strength, { group: g, label: strengthLabel, min: -100, max: 100, softMin: -4, softMax: 4, step: 0.01, animatable: true, tooltip: 'Signed: 0 disables the source.' }),
    );
  }
  return out;
}

export const visible = (v: ParamValues, id: string, value: string): boolean => v[id] === value;

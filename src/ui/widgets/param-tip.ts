import type { ParamDef } from '../../engine/params/schema';

/**
 * Tooltip for a parameter. Uses the authored tooltip when there is one; otherwise a generated one (name, kind, range, default,
 * animatable) so that EVERY parameter has a tooltip. Pure, unit-tested.
 */
export function tipOf(def: ParamDef): string {
  if (def.tooltip) return def.tooltip;
  const d = def as ParamDef & { default?: unknown; min?: number; max?: number; softMin?: number; softMax?: number; unit?: string; display?: string };
  const bits: string[] = [];
  const lo = d.min ?? d.softMin;
  const hi = d.max ?? d.softMax;
  const pct = d.display === 'percent';
  const f = (v: number): string => String(pct ? +(v * 100).toFixed(3) + '%' : +v.toFixed(4));
  if (lo !== undefined && hi !== undefined) bits.push(`range ${f(lo)} … ${f(hi)}`);
  if (typeof d.default === 'number') bits.push(`default ${f(d.default)}`);
  else if (typeof d.default === 'boolean') bits.push(`default ${d.default ? 'on' : 'off'}`);
  else if (typeof d.default === 'string') bits.push(`default ${d.default}`);
  if (def.animatable) bits.push('animatable');
  return `${def.label}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
}

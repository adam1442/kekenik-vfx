import type { RGBA, Vec2, Vec3 } from '../../shared/util';
import type { CurveValue, EnumParam, GradientValue, ParamDef, ParamValues } from './schema';

/**
 * Typed, typo-safe read access to resolved parameter values inside `evaluate()`.
 * Every getter throws on an unknown id or wrong type: bugs surface immediately instead of becoming NaNs.
 */
export class Params {
  private byId = new Map<string, ParamDef>();
  constructor(
    defs: ParamDef[],
    readonly values: ParamValues,
  ) {
    for (const d of defs) this.byId.set(d.id, d);
  }

  private def(id: string): ParamDef {
    const d = this.byId.get(id);
    if (!d) throw new Error(`Unknown param "${id}"`);
    return d;
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  private get<T>(id: string, types: ParamDef['type'][]): T {
    const d = this.def(id);
    if (!types.includes(d.type)) throw new Error(`Param "${id}" is ${d.type}, expected ${types.join('|')}`);
    return this.values[id] as T;
  }
  /** float or int */
  num(id: string): number {
    return this.get<number>(id, ['float', 'int', 'seed']);
  }
  int(id: string): number {
    return Math.round(this.num(id));
  }
  bool(id: string): boolean {
    return this.get<boolean>(id, ['bool']);
  }
  /** asset reference (imported file) or null. */
  asset(id: string): { assetId: string; name?: string } | null {
    return this.get<{ assetId: string; name?: string } | null>(id, ['asset']);
  }
  str(id: string): string {
    return this.get<string>(id, ['string', 'enum']);
  }
  vec2(id: string): Vec2 {
    return this.get<number[]>(id, ['vec2']) as Vec2;
  }
  vec3(id: string): Vec3 {
    return this.get<number[]>(id, ['vec3']) as Vec3;
  }
  rgba(id: string): RGBA {
    return this.get<number[]>(id, ['color']) as RGBA;
  }
  seed(id: string): number {
    return this.get<number>(id, ['seed']) >>> 0;
  }
  curve(id: string): CurveValue {
    return this.get<CurveValue>(id, ['curve']);
  }
  gradient(id: string): GradientValue {
    return this.get<GradientValue>(id, ['gradient']);
  }
  /** Index of the selected enum option (order of `options`). This is what shaders receive as u32. */
  enumIndex(id: string): number {
    const d = this.def(id) as EnumParam;
    if (d.type !== 'enum') throw new Error(`Param "${id}" is not an enum`);
    return Math.max(0, d.options.findIndex((o) => o.value === this.values[id]));
  }
  /** Modulation intensity of a modulatable float param (0 when not modulatable). */
  modK(id: string): number {
    return this.byId.has(`${id}_mod_k`) ? this.num(`${id}_mod_k`) : 0;
  }
}

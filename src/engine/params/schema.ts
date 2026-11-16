import type { RGBA, Vec2, Vec3 } from '../../shared/util';
import { clamp } from '../../shared/util';

/**
 * ParamSchema: the declarative description of a node's parameters. The Properties panel, command palette,
 * animation system, presets and serializer are ALL driven by this. Values are plain JSON-able data.
 */
export interface CurveKey {
  x: number;
  y: number;
  /** Interpolation of the segment that STARTS at this key. */
  mode?: 'smooth' | 'linear' | 'step';
  /** Optional explicit slopes (dy/dx) at this key (incoming / outgoing). */
  tin?: number;
  tout?: number;
}
export interface CurveValue {
  keys: CurveKey[];
}
export interface GradientStop {
  pos: number;
  /** Linear RGBA. Alpha is a normal channel. */
  color: RGBA;
}
/** Interpolation between gradient stops (optional; default 'linear'). Added by backward compatible. */
export type GradientInterp = 'linear' | 'smooth' | 'step' | 'oklab';
export interface GradientValue {
  stops: GradientStop[];
  interp?: GradientInterp;
}
export interface AssetRef {
  assetId: string;
  name?: string;
}

/**
 * Spline / path value. Coordinates are UV (0..1, y down). Handles are RELATIVE offsets of the anchor.
 * mode: 'auto' = smooth handles computed from the neighbours (hin/hout ignored), 'corner' = no handles,
 * 'free' = explicit hin/hout (mirrored by the editor unless Alt is held). `w` = width (UV, full width) at the point;
 * `attrs` = free per-point numeric attributes (e.g. opacity, pressure) interpreted by the owning node.
 */
export interface SplinePoint {
  x: number;
  y: number;
  w?: number;
  mode?: 'auto' | 'corner' | 'free';
  hin?: [number, number];
  hout?: [number, number];
  attrs?: Record<string, number>;
}
export interface SplineValue {
  closed: boolean;
  points: SplinePoint[];
}

export type ParamValue = number | boolean | string | number[] | CurveValue | GradientValue | AssetRef | SplineValue | null;
export type ParamValues = Record<string, ParamValue>;

export type ParamType = 'float' | 'int' | 'bool' | 'enum' | 'vec2' | 'vec3' | 'color' | 'seed' | 'curve' | 'gradient' | 'string' | 'asset' | 'spline';

export interface ParamBase {
  /** Unique within the node, stable (stored in project files!). snake_case. */
  id: string;
  label: string;
  /** Collapsible group inside the tab. */
  group?: string;
  /** Tab name. Default "Main". Common tabs are "Texture" and "Blending". */
  tab?: string;
  tooltip?: string;
  /** Can be keyframed on the timeline. */
  animatable?: boolean;
  advanced?: boolean;
  /** Hide the param unless the predicate returns true for the current values. */
  visibleIf?: (values: ParamValues) => boolean;
  /** Show only while the named input pin is connected (e.g. Blending params need the 'background' pin). */
  showWhenConnected?: string;
}

export interface FloatParam extends ParamBase {
  type: 'float';
  default: number;
  /** Hard range: values are clamped to it. */
  min?: number;
  max?: number;
  /** Soft range: the slider range; typing a value may exceed it (up to the hard range). */
  softMin?: number;
  softMax?: number;
  step?: number;
  /** 'percent' = stored as a fraction (1 = 100%), shown x100 with a % sign. 'angle' = degrees. */
  display?: 'number' | 'percent' | 'angle';
  unit?: string;
  precision?: number;
  /**
   * Adds an optional Gray input pin `<id>_mod` and a float param `<id>_mod_k` (modulation intensity, percent,
   * -100%..100%). The shader multiplies the value per pixel with `modulate()` (util.wgsl).
   */
  modulatable?: boolean;
}
export interface IntParam extends ParamBase {
  type: 'int';
  default: number;
  min?: number;
  max?: number;
  softMin?: number;
  softMax?: number;
  step?: number;
  unit?: string;
}
export interface BoolParam extends ParamBase {
  type: 'bool';
  default: boolean;
}
export interface EnumOption {
  value: string;
  label: string;
  tooltip?: string;
}
export interface EnumParam extends ParamBase {
  type: 'enum';
  default: string;
  options: EnumOption[];
}
export interface Vec2Param extends ParamBase {
  type: 'vec2';
  default: Vec2;
  min?: number;
  max?: number;
  softMin?: number;
  softMax?: number;
  step?: number;
  labels?: [string, string];
  unit?: string;
  /** UI may offer a chain/lock toggle (uniform scaling). */
  linkable?: boolean;
  integer?: boolean;
}
export interface Vec3Param extends ParamBase {
  type: 'vec3';
  default: Vec3;
  min?: number;
  max?: number;
  softMin?: number;
  softMax?: number;
  step?: number;
  labels?: [string, string, string];
  unit?: string;
  integer?: boolean;
}
export interface ColorParam extends ParamBase {
  type: 'color';
  default: RGBA;
  /** Allow values above 1. */
  hdr?: boolean;
}
export interface SeedParam extends ParamBase {
  type: 'seed';
  default: number;
}
export interface CurveParam extends ParamBase {
  type: 'curve';
  default: CurveValue;
}
export interface GradientParam extends ParamBase {
  type: 'gradient';
  default: GradientValue;
}
export interface StringParam extends ParamBase {
  type: 'string';
  default: string;
  multiline?: boolean;
}
export interface AssetParam extends ParamBase {
  type: 'asset';
  default: AssetRef | null;
  kind: 'image' | 'model' | 'any';
}

export interface SplineParam extends ParamBase {
  type: 'spline';
  default: SplineValue;
  /** Minimum number of points kept by the editor (default 2). */
  minPoints?: number;
}

export type ParamDef =
  | SplineParam
  | FloatParam
  | IntParam
  | BoolParam
  | EnumParam
  | Vec2Param
  | Vec3Param
  | ColorParam
  | SeedParam
  | CurveParam
  | GradientParam
  | StringParam
  | AssetParam;

export type ParamSchema = ParamDef[];

const titleCase = (id: string): string => id.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

type Opts<T extends ParamDef> = Partial<Omit<T, 'id' | 'type' | 'default' | 'label'>> & { label?: string };
const mk =
  <T extends ParamDef>(type: T['type']) =>
  (id: string, def: T['default'], o: Opts<T> = {}): T =>
    ({ type, id, default: def, ...o, label: o.label ?? titleCase(id) }) as unknown as T;

/** Builders: `P.float('scale', 4, { min: 1, softMax: 32 })`. */
export const P = {
  float: mk<FloatParam>('float'),
  int: mk<IntParam>('int'),
  bool: mk<BoolParam>('bool'),
  vec2: mk<Vec2Param>('vec2'),
  vec3: mk<Vec3Param>('vec3'),
  color: mk<ColorParam>('color'),
  seed: mk<SeedParam>('seed'),
  curve: mk<CurveParam>('curve'),
  gradient: mk<GradientParam>('gradient'),
  spline: mk<SplineParam>('spline'),
  string: mk<StringParam>('string'),
  asset: (id: string, kind: AssetParam['kind'], o: Opts<AssetParam> = {}): AssetParam => ({ type: 'asset', id, default: null, kind, ...o, label: o.label ?? titleCase(id) }),
  enum: (id: string, def: string, options: (string | EnumOption)[], o: Opts<EnumParam> = {}): EnumParam => ({
    type: 'enum',
    id,
    default: def,
    options: options.map((x) => (typeof x === 'string' ? { value: x, label: titleCase(x) } : x)),
    ...o,
    label: o.label ?? titleCase(id),
  }),
};

export const identityCurve = (): CurveValue => ({ keys: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });
export const defaultGradient = (): GradientValue => ({
  stops: [
    { pos: 0, color: [0, 0, 0, 1] },
    { pos: 1, color: [1, 1, 1, 1] },
  ],
});

export const cloneValue = <T extends ParamValue>(v: T): T => (v !== null && typeof v === 'object' ? (JSON.parse(JSON.stringify(v)) as T) : v);

export function defaultValues(schema: ParamSchema): ParamValues {
  const out: ParamValues = {};
  for (const p of schema) out[p.id] = cloneValue(p.default);
  return out;
}

const finite = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function coerceVec(def: Vec2Param | Vec3Param, v: unknown, n: number): number[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from({ length: n }, (_, i) => {
    let x = finite(arr[i], def.default[i]);
    if (def.integer) x = Math.round(x);
    return clamp(x, def.min ?? -Infinity, def.max ?? Infinity);
  });
}

/**
 * Sanitise ANY incoming value (UI, file, preset, undo) against its definition: clamps to the hard range, rounds ints,
 * validates enum membership, fixes array lengths. Never throws; falls back to the default.
 */
export function coerceParam(def: ParamDef, value: unknown): ParamValue {
  switch (def.type) {
    case 'float':
      return clamp(finite(value, def.default), def.min ?? -Infinity, def.max ?? Infinity);
    case 'int':
    case 'seed': {
      const lo = def.type === 'int' ? (def.min ?? -Infinity) : -2147483648;
      const hi = def.type === 'int' ? (def.max ?? Infinity) : 2147483647;
      return clamp(Math.round(finite(value, def.default)), lo, hi);
    }
    case 'bool':
      return typeof value === 'boolean' ? value : def.default;
    case 'enum':
      return typeof value === 'string' && def.options.some((o) => o.value === value) ? value : def.default;
    case 'vec2':
      return coerceVec(def, value, 2);
    case 'vec3':
      return coerceVec(def, value, 3);
    case 'color': {
      const arr = Array.isArray(value) ? value : [];
      return Array.from({ length: 4 }, (_, i) => {
        const x = finite(arr[i], def.default[i]);
        return def.hdr ? Math.max(0, x) : clamp(x, 0, 1);
      });
    }
    case 'curve': {
      const keys = (value as CurveValue | undefined)?.keys;
      if (!Array.isArray(keys) || keys.length < 1) return cloneValue(def.default);
      const clean = keys.map((k) => ({ ...k, x: finite(k.x, 0), y: finite(k.y, 0) })).sort((a, b) => a.x - b.x);
      return { keys: clean };
    }
    case 'gradient': {
      const stops = (value as GradientValue | undefined)?.stops;
      if (!Array.isArray(stops) || stops.length < 1) return cloneValue(def.default);
      const clean = stops
        .map((s) => ({ pos: clamp(finite(s.pos, 0), 0, 1), color: Array.from({ length: 4 }, (_, i) => Math.max(0, finite(s.color?.[i], i === 3 ? 1 : 0))) as RGBA }))
        .sort((a, b) => a.pos - b.pos);
      const interp = (value as GradientValue).interp;
      return interp === 'smooth' || interp === 'step' || interp === 'oklab' ? { stops: clean, interp } : { stops: clean };
    }
    case 'spline': {
      const v = value as SplineValue | undefined;
      if (!v || !Array.isArray(v.points)) return cloneValue(def.default);
      const num = (x: unknown, d: number): number => finite(x, d);
      const pair = (a: unknown): [number, number] | undefined => (Array.isArray(a) ? [num(a[0], 0), num(a[1], 0)] : undefined);
      const points: SplinePoint[] = v.points.map((p) => {
        const o: SplinePoint = { x: num(p.x, 0), y: num(p.y, 0) };
        if (p.w !== undefined) o.w = Math.max(0, num(p.w, 0));
        if (p.mode === 'auto' || p.mode === 'corner' || p.mode === 'free') o.mode = p.mode;
        const hi = pair(p.hin);
        const ho = pair(p.hout);
        if (hi) o.hin = hi;
        if (ho) o.hout = ho;
        if (p.attrs && typeof p.attrs === 'object') o.attrs = Object.fromEntries(Object.entries(p.attrs).map(([k, x]) => [k, num(x, 0)]));
        return o;
      });
      return { closed: !!v.closed, points };
    }
    case 'string':
      return typeof value === 'string' ? value : def.default;
    case 'asset': {
      const a = value as AssetRef | null | undefined;
      return a && typeof a.assetId === 'string' ? { assetId: a.assetId, name: a.name } : null;
    }
  }
}

export function isParamVisible(def: ParamDef, values: ParamValues, connectedPins?: ReadonlySet<string>): boolean {
  if (def.showWhenConnected && !(connectedPins?.has(def.showWhenConnected) ?? false)) return false;
  return def.visibleIf ? def.visibleIf(values) : true;
}

export function valuesEqual(a: ParamValue, b: ParamValue): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

import { refParam, type GizmoUnit, type ParamMap, type ParamRef } from '../engine/graph/gizmo-decl';
import type { ParamValue, ParamValues } from '../engine/params/schema';
import { DEG, type V2 } from './geom';

/** What kind of quantity a binding carries: decides which image axis a 'pixel' unit divides by. */
export type BindKind = 'pos' | 'size' | 'len' | 'angle' | 'scalar';

export interface BindCtx {
  size: V2;
  space?: 'uv' | 'pixel' | 'world';
  lengthRef?: 'width' | 'height' | 'min' | 'max';
  values: ParamValues;
}

const comp = (x: number | [number, number] | undefined, i: number, d: number): number => (x === undefined ? d : typeof x === 'number' ? x : x[i]);

/**
 * Binding: a gizmo's view of ONE parameter. read(): stored param -> native gizmo value (UV / UV length / radians),
 * write(): native -> param value (ready for GraphGesture.set; the graph coerces/clamps it again).
 * Values are number (scalar) or number[] (vec2).
 */
export class Binding {
  readonly param: string;
  private map: ParamMap;
  constructor(
    ref: ParamRef,
    private kind: BindKind,
    private ctx: BindCtx,
  ) {
    this.param = refParam(ref)!;
    this.map = typeof ref === 'string' ? {} : (ref.map ?? {});
  }

  private unit(): GizmoUnit {
    if (this.map.unit) return this.map.unit;
    if (this.kind === 'angle') return 'degrees';
    return this.ctx.space === 'pixel' ? 'pixel' : 'uv';
  }

  /** Divisor that turns the param's unit into native for component i. */
  private axisSize(i: number): number {
    const [w, h] = this.ctx.size;
    if (this.kind === 'pos' || this.kind === 'size') return i === 0 ? w : h;
    const r = this.ctx.lengthRef ?? 'min';
    return r === 'width' ? w : r === 'height' ? h : r === 'max' ? Math.max(w, h) : Math.min(w, h);
  }

  private toNative1(x: number, i: number): number {
    const u = this.unit();
    let n = x;
    switch (u) {
      case 'pixel':
        n = x / this.axisSize(i);
        break;
      case 'percent':
        n = x / 100;
        break;
      case 'degrees':
        n = x * DEG;
        break;
      case 'turns':
        n = x * 2 * Math.PI;
        break;
      default:
        break;
    }
    n = n * comp(this.map.scale, i, 1) + comp(this.map.offset, i, 0);
    if (this.map.reciprocal) n = 1 / (Math.abs(n) < 1e-9 ? 1e-9 : n);
    return n;
  }

  private fromNative1(g: number, i: number): number {
    let n = g;
    if (this.map.reciprocal) n = 1 / (Math.abs(n) < 1e-9 ? 1e-9 : n);
    n = (n - comp(this.map.offset, i, 0)) / (comp(this.map.scale, i, 1) || 1);
    switch (this.unit()) {
      case 'pixel':
        n = n * this.axisSize(i);
        break;
      case 'percent':
        n = n * 100;
        break;
      case 'degrees':
        n = n / DEG;
        break;
      case 'turns':
        n = n / (2 * Math.PI);
        break;
      default:
        break;
    }
    return n;
  }

  /** Number of components of the stored value (1 or 2). */
  arity(): number {
    const raw = this.ctx.values[this.param];
    return Array.isArray(raw) ? raw.length : 1;
  }

  read(values: ParamValues = this.ctx.values): number | number[] {
    const raw = values[this.param] as ParamValue;
    if (this.map.to) return this.map.to(raw, values);
    if (Array.isArray(raw)) return (raw as number[]).map((x, i) => this.toNative1(x, i));
    return this.toNative1(typeof raw === 'number' ? raw : 0, 0);
  }
  read1(): number {
    const v = this.read();
    return typeof v === 'number' ? v : v[0];
  }
  read2(): V2 {
    const v = this.read();
    return typeof v === 'number' ? [v, v] : [v[0], v[1] ?? v[0]];
  }

  write(g: number | number[], opts: { integer?: boolean } = {}): ParamValue {
    if (this.map.from) return this.map.from(g, this.ctx.values);
    const round = (x: number): number => {
      if (opts.integer) x = Math.max(1, Math.round(x));
      if (this.map.round) x = Math.round(x / this.map.round) * this.map.round;
      return x;
    };
    if (Array.isArray(g)) return g.map((x, i) => round(this.fromNative1(x, i)));
    const raw = this.ctx.values[this.param];
    const v = round(this.fromNative1(g, 0));
    // a scalar gizmo value written into a vec2 param sets both components (uniform)
    return Array.isArray(raw) ? raw.map(() => v) : v;
  }

  /** Display unit label + value factor for numeric entry (angles in degrees, positions in UV or px). */
  static fmtUv(v: number, ctxSpace: 'uv' | 'pixel' | 'world' | undefined, axisSize: number): { value: number; unit: string } {
    return ctxSpace === 'pixel' ? { value: v * axisSize, unit: 'px' } : { value: v, unit: '' };
  }
}

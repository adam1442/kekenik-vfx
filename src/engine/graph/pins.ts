import type { PinType } from '../types';

/**
 * Pin type rules: Gray -> Color is the ONLY implicit conversion. Everything else needs an explicit
 * conversion node (RGB to Grayscale, Normal to Color, Color to UV, ...). The evaluator inserts the implicit
 * conversion pass automatically (convert_gray_color.wgsl).
 */
export function canConnect(from: PinType, to: PinType): boolean {
  return from === to || (from === 'gray' && to === 'color');
}

export type ImplicitConversion = 'none' | 'gray_to_color';
export function implicitConversion(from: PinType, to: PinType): ImplicitConversion | null {
  if (from === to) return 'none';
  if (from === 'gray' && to === 'color') return 'gray_to_color';
  return null;
}

export interface PinDef {
  /** Unique within the node's inputs (or outputs), snake_case, stable (stored in project files). */
  id: string;
  name: string;
  type: PinType;
  /** Inputs only. Optional inputs may stay unconnected (the node must handle `undefined`). */
  optional?: boolean;
  /**
   * LAZY input. The evaluator does NOT evaluate the producer for this pin, the hash uses a time-independent signature of
   * the upstream subgraph, and `ctx.inputs[pin]` is undefined. The node reads `ctx.lazyInput(pin)` and pulls what it needs itself
   * (Sheet Encode evaluates the producer at many times through the FlipbookBaker).
   */
  lazy?: boolean;
  /** Semantic role used by the engine/UI. 'background' pins feed the automatic Blending tab. */
  role?: 'background' | 'mask' | 'modulation' | 'generic';
  tooltip?: string;
}

/** Pin colors by type (UI). Kept here so every module uses the same palette. */
export const PIN_COLORS: Record<PinType, string> = {
  gray: '#9aa0a6',
  color: '#e8b04a',
  normal: '#7f8cff',
  uv: '#4ec9b0',
  mesh: '#e06c9f',
  points: '#c586c0',
  /** Spline pin: 2D / 3D splines with handles, per-point attributes, closed flag. Only Spline -> Spline connects. */
  spline: '#4fd1a5',
  scalar: '#6fb1ff',
  vector: '#5ad1d1',
  curve: '#d19a66',
  gradient: '#e5c07b',
  flipbook: '#ff8f5a',
  camera: '#9b8cf0',
};

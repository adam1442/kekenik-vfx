import { channelOf, newKey, type Extrapolation, type Interp } from '../engine/anim/keyframes';
import type { AnimTrack } from '../engine/anim/tracks';
import { Graph, type GraphSettings } from '../engine/graph/graph';
import type { NodeRegistry } from '../engine/graph/registry';
import type { ParamValue, ParamValues } from '../engine/params/schema';
import type { ViewHints } from '../app/view-hints';

/**
 * SAMPLE KIT. Samples are built from REAL nodes through `Graph.addNode / connect` (a wrong node id, param id or pin
 * id throws while building and is caught by tests/import-presets-samples.test.ts). They are fully editable projects, serve as
 * regression fixtures (tests/fixtures/samples.json) and as GPU smoke tests (`probes` are evaluated by the self-test at the
 * listed frames: the result must be finite and its mean inside [minMean, maxMean]).
 */
export interface SampleProbe {
  /** Key of `Builder.mark(...)`: the node (and output pin) whose texture is analysed. */
  mark: string;
  minMean: number;
  maxMean: number;
  /** Timeline frames to evaluate (default [0]). */
  frames?: number[];
}
export interface SampleView {
  /** Mark of the mesh node the 3D viewport should show. */
  mesh?: string;
  /** Mark of the texture node used as the VFX material. */
  material?: string;
  mat?: ViewHints['mat'];
  display?: string;
}
export interface SampleDef {
  id: string;
  name: string;
  description: string;
  kind: 'sample' | 'template';
  tags: string[];
  settings?: Partial<GraphSettings>;
  /** Name of the node shown first in the viewport (`mark`). */
  preview?: string;
  /** Timeline frame used for the start-screen thumbnail (an animated effect is often empty at frame 0). */
  thumbFrame?: number;
  /** Pre-fills the 3D viewport (mesh + material) when the sample is opened from the start screen. */
  view?: SampleView;
  build(b: Builder): void;
  probes?: SampleProbe[];
}

export type Vec = number | number[];
export type Ref = string;
export interface AnimOpts {
  interp?: Interp;
  pre?: Extrapolation;
  post?: Extrapolation;
}

export const COL = 280;
export const ROW = 190;

export class Builder {
  readonly marks = new Map<string, { node: string; pin: string }>();
  constructor(readonly g: Graph) {}

  /** Absolute-coordinate node (legacy form). */
  n(type: string, name: string, x: number, y: number, params: Record<string, unknown> = {}): string {
    return this.g.addNode(type, { x, y, name, params: params as ParamValues }).id;
  }
  /**
   * Node on the grid (col, row) with its inputs wired in one call: `inputs = { pin: 'nodeId' | 'nodeId.pin' }`
   * (the source pin defaults to `output`).
   */
  add(type: string, name: string, col: number, row: number, params: Record<string, unknown> = {}, inputs: Record<string, Ref> = {}): string {
    const id = this.n(type, name, col * COL, row * ROW, params);
    for (const [pin, from] of Object.entries(inputs)) this.l(from, `${id}.${pin}`);
    return id;
  }
  /** Connects `from` (node id, optional `.pin`, default `output`) to `to` (node id + `.pin`). */
  l(from: string, to: string): void {
    const [fn, fp = 'output'] = from.split('.');
    const [tn, tp = 'input'] = to.split('.');
    this.g.connect({ node: fn, pin: fp }, { node: tn, pin: tp });
  }
  /** Chain `a -> b -> c` using default pins (`output` -> `input`). */
  chain(...ids: string[]): void {
    for (let i = 0; i + 1 < ids.length; i++) this.l(ids[i], ids[i + 1]);
  }
  mark(key: string, from: string): void {
    const [node, pin = 'output'] = from.split('.');
    this.marks.set(key, { node, pin });
  }
  /** Gray blend (`foreground` over `background`). */
  blend(name: string, col: number, row: number, fg: Ref, bg: Ref, type = 'multiply', extra: Record<string, unknown> = {}): string {
    return this.add('utils.blend', name, col, row, { blend_type: type, ...extra }, { foreground: fg, background: bg });
  }
  blendC(name: string, col: number, row: number, fg: Ref, bg: Ref, type = 'add', extra: Record<string, unknown> = {}): string {
    return this.add('utils.blend_color', name, col, row, { blend_type: type, ...extra }, { foreground: fg, background: bg });
  }
  /** Folds `refs` with a blend type into one node (left to right). Returns the last blend. */
  fold(name: string, col: number, row: number, refs: Ref[], type = 'max', color = false): string {
    let acc = refs[0];
    refs.slice(1).forEach((r, i) => {
      acc = color ? this.blendC(`${name} ${i + 1}`, col + i, row, r, acc, type) : this.blend(`${name} ${i + 1}`, col + i, row, r, acc, type);
    });
    return acc;
  }
  ramp(name: string, col: number, row: number, input: Ref, gradient: unknown, extra: Record<string, unknown> = {}): string {
    return this.add('color.ramp', name, col, row, { gradient, ...extra }, { input });
  }

  /* ----------------------------------------------------------------------------------------------- animation */
  /**
   * Keyframes `[frame, value][]` on a numeric parameter (float / int / seed / bool / enum index / vec2 / vec3 / colour).
   * Vectors take number arrays. Default interpolation = smooth bezier (auto tangents), constant extrapolation.
   */
  anim(node: string, param: string, keys: [number, Vec][], o: AnimOpts = {}): void {
    const dims = Array.isArray(keys[0][1]) ? (keys[0][1] as number[]).length : 1;
    const ch = Array.from({ length: dims }, (_, c) =>
      channelOf(
        keys.map(([t, v]) => newKey(t, Array.isArray(v) ? v[c] : v, { interp: o.interp ?? 'bezier' })),
        o.pre ?? 'constant',
        o.post ?? o.pre ?? 'constant',
      ),
    );
    this.g.setNodeTrack(node, param, { kind: 'num', ch });
  }
  /** Stepped keys (seed flicker, enum / bool switches). */
  steps(node: string, param: string, keys: [number, number][]): void {
    this.anim(node, param, keys, { interp: 'constant' });
  }
  /** Linear ramp from -> to over `frames`, continuing with the same slope every loop (cycle with offset): seamless pans. */
  ramp01(node: string, param: string, from: Vec, to: Vec, frames: number): void {
    this.anim(node, param, [[0, from], [frames, to]], { interp: 'linear', pre: 'cycle_offset', post: 'cycle_offset' });
  }
  /** `base -> peak -> base` smooth loop (peak at mid), cycling forever. */
  pulse(node: string, param: string, base: Vec, peak: Vec, frames: number): void {
    this.anim(node, param, [[0, base], [frames / 2, peak], [frames, base]], { pre: 'cycle', post: 'cycle' });
  }
  /** Looping linear value 0 -> 1 on a periodic noise axis (evolution): seamless. */
  loopEvolution(node: string, param = 'evolution', frames = 64): void {
    this.ramp01(node, param, 0, 1, frames);
  }
  /** Gradient / curve snapshots over time `[frame, value][]` (linear blend when the structure matches). */
  snap(node: string, param: string, snaps: [number, ParamValue][], interp: 'constant' | 'linear' = 'linear'): void {
    const track: AnimTrack = { kind: 'snap', snaps: snaps.map(([t, v]) => ({ t, v, interp })), pre: 'constant', post: 'constant' };
    this.g.setNodeTrack(node, param, track);
  }
}

export const grad = (stops: [number, number[]][], interp = 'oklab') => ({ interp, stops: stops.map(([pos, color]) => ({ pos, color })) });
export const curve = (...pts: [number, number][]) => ({ keys: pts.map(([x, y]) => ({ x, y })) });

export const FIRE = grad([[0, [0, 0, 0, 1]], [0.25, [0.12, 0.005, 0, 1]], [0.55, [1, 0.16, 0.004, 1]], [0.8, [1, 0.65, 0.05, 1]], [1, [1, 0.95, 0.6, 1]]]);
export const FIRE_A = grad([[0, [0.1, 0.01, 0, 0]], [0.25, [0.5, 0.05, 0.005, 0.5]], [0.55, [1, 0.2, 0.01, 1]], [0.8, [1, 0.65, 0.05, 1]], [1, [1, 0.95, 0.65, 1]]]);
export const ELECTRIC = grad([[0, [0, 0, 0, 1]], [0.3, [0.05, 0.1, 0.6, 1]], [0.65, [0.3, 0.6, 1, 1]], [1, [0.95, 0.98, 1, 1]]]);
export const CYAN = grad([[0, [0, 0, 0, 1]], [0.4, [0.02, 0.25, 0.5, 1]], [0.75, [0.3, 0.9, 1, 1]], [1, [1, 1, 1, 1]]]);
export const VIOLET = grad([[0, [0.02, 0, 0.06, 1]], [0.45, [0.5, 0.05, 0.9, 1]], [0.8, [0.35, 0.8, 1, 1]], [1, [1, 1, 1, 1]]]);
export const SMOKE = grad([[0, [0.1, 0.1, 0.12, 0]], [0.4, [0.25, 0.25, 0.28, 0.6]], [1, [0.85, 0.85, 0.88, 1]]]);
export const HOT = grad([[0, [1, 0.3, 0.02, 0]], [0.5, [1, 0.7, 0.2, 1]], [1, [1, 1, 0.9, 1]]]);
export const EASE_OUT = curve([0, 0], [0.3, 0.9], [1, 1]);
export const BELL = curve([0, 0], [0.5, 1], [1, 0]);

/** Deterministic pseudo random (mulberry32) for generated splines / layouts: samples must be reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sweep control point (x, y, z with per-point scale / twist attributes). */
export const spt = (x: number, y: number, z: number, scale = 1, twist = 0) => ({ x, y, attrs: { z, scale, twist } });
/** Jagged bolt polyline from `a` to `b` (z-up), `n` segments, sideways deviation `amp`. */
export function boltSpline(a: [number, number, number], b: [number, number, number], n: number, amp: number, seed: number) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const env = Math.sin(Math.PI * t) ** 0.7;
    pts.push(spt(a[0] + (b[0] - a[0]) * t + (r() - 0.5) * 2 * amp * env, a[1] + (b[1] - a[1]) * t + (r() - 0.5) * 2 * amp * env, a[2] + (b[2] - a[2]) * t, 1, 0));
  }
  return { closed: false, points: pts };
}

export function buildSampleGraph(registry: NodeRegistry, def: SampleDef): { graph: Graph; marks: Map<string, { node: string; pin: string }> } {
  const graph = new Graph(registry, def.settings);
  const b = new Builder(graph);
  def.build(b);
  return { graph, marks: b.marks };
}

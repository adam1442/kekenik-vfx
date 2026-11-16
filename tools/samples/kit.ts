import type { ViewHints } from '../../src/app/view-hints';
import { Graph, type GraphSettings } from '../../src/engine/graph/graph';
import type { FrameData } from '../../src/engine/graph/annotations';
import type { NodeRegistry } from '../../src/engine/graph/registry';
import { Builder, COL, ROW, grad } from '../../src/samples/kit';

export { COL, ROW, grad };
export const curve = (...pts: [number, number][]) => ({ keys: pts.map(([x, y]) => ({ x, y })) });

/**
 * SAMPLE AUTHORING KIT. Samples are authored in TypeScript with real nodes (this folder is NOT part of the app bundle),
 * then `npm run samples:gen` serialises them into `samples/<id>/graph.kekenik.json` + `sample.json` (i18n metadata) and regenerates
 * `samples/index.json`. The app and the tests only ever read the JSON files.
 *
 * `S.node` is strict: node ids are the keys you give (stable, readable), an unknown param id throws (Graph.addNode), and a value that
 * would be silently clamped / rounded / replaced by the schema (out of range, bad enum) throws here, so the committed JSON is always
 * inside every parameter range.
 */
export interface Tx {
  en: string;
  fa: string;
}
export type Cat = 'fire' | 'magic' | 'energy' | 'weapons' | 'water' | 'lightning' | 'environment' | 'tiling' | 'flipbooks' | 'meshes' | 'simulation' | 'beginner';
export type Role = 'inputs' | 'shape' | 'motion' | 'color' | 'output' | 'sim' | 'mesh';

/** Colour + title of the standard groups (Inputs / Shape / Motion / Color / Output ...). */
export const ROLES: Record<Role, { color: string; title: Tx }> = {
  inputs: { color: '#5aa7e0', title: { en: 'Inputs', fa: 'ورودی‌ها' } },
  shape: { color: '#6cc080', title: { en: 'Shape', fa: 'شکل' } },
  motion: { color: '#e0a45a', title: { en: 'Motion', fa: 'حرکت' } },
  color: { color: '#c070d0', title: { en: 'Color', fa: 'رنگ' } },
  output: { color: '#e06c6c', title: { en: 'Output', fa: 'خروجی' } },
  sim: { color: '#e0c35a', title: { en: 'Simulation', fa: 'شبیه‌سازی' } },
  mesh: { color: '#4ec9b0', title: { en: 'Mesh', fa: 'مش' } },
};

export const TAGS: Record<string, Tx> = {
  fire: { en: 'fire', fa: 'آتش' }, smoke: { en: 'smoke', fa: 'دود' }, loop: { en: 'loop', fa: 'لوپ' }, flipbook: { en: 'flipbook', fa: 'فلیپ‌بوک' },
  fluid: { en: 'fluid', fa: 'سیال' }, explosion: { en: 'explosion', fa: 'انفجار' }, ink: { en: 'ink', fa: 'جوهر' }, tileable: { en: 'tileable', fa: 'کاشی‌پذیر' },
  wind: { en: 'wind', fa: 'باد' }, vector: { en: 'vector field', fa: 'میدان برداری' }, portal: { en: 'portal', fa: 'پورتال' }, magic: { en: 'magic', fa: 'جادو' },
  water: { en: 'water', fa: 'آب' }, ripple: { en: 'ripples', fa: 'موج' }, normal: { en: 'normal map', fa: 'نرمال مپ' }, skin: { en: 'skin', fa: 'پوست' },
  organic: { en: 'organic', fa: 'ارگانیک' }, dissolve: { en: 'dissolve', fa: 'حل‌شدن' }, burn: { en: 'burn', fa: 'سوختن' }, distortion: { en: 'distortion', fa: 'اعوجاج' },
  warp: { en: 'warp', fa: 'وارپ' }, motion: { en: 'motion vectors', fa: 'بردار حرکت' }, lightning: { en: 'lightning', fa: 'رعد و برق' }, spline: { en: 'spline', fa: 'اسپلاین' },
  mesh: { en: 'mesh', fa: 'مش' }, sweep: { en: 'sweep', fa: 'سوئیپ' }, beam: { en: 'beam', fa: 'پرتو' }, energy: { en: 'energy', fa: 'انرژی' },
  slash: { en: 'slash', fa: 'ضربه شمشیر' }, sword: { en: 'sword', fa: 'شمشیر' }, shockwave: { en: 'shockwave', fa: 'موج شوک' }, shield: { en: 'shield', fa: 'سپر' },
  rune: { en: 'rune', fa: 'رون' }, lava: { en: 'lava', fa: 'گدازه' }, sprites: { en: 'sprites', fa: 'اسپرایت' }, atlas: { en: 'atlas', fa: 'اطلس' },
  impact: { en: 'impact', fa: 'برخورد' }, decal: { en: 'decal', fa: 'دکال' }, tutorial: { en: 'tutorial', fa: 'آموزش' }, tiling: { en: 'tiling', fa: 'کاشی‌کاری' },
  simulation: { en: 'simulation', fa: 'شبیه‌سازی' }, packed: { en: 'channel packed', fa: 'کانال‌پک' }, game: { en: 'game-ready', fa: 'آماده بازی' },
};

export interface SampleSpec {
  id: string;
  name: Tx;
  description: Tx;
  /** How to adapt the sample to your own effect. */
  adapt: Tx;
  category: Cat[];
  tags: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  /** The timeline loops seamlessly. */
  loops?: boolean;
  settings: Partial<GraphSettings>;
  /** Node key shown first in the viewport. */
  preview: string;
  /** Node (+ pin) and timeline frame rendered for the Home thumbnail. */
  thumb: { node: string; pin?: string; frame?: number };
  /** Pre-fills the 3D viewport targets (node keys; they are the node ids). */
  view?: { mesh?: string; material?: string; mat?: ViewHints['mat']; display?: string };
  /** Guided-tour steps: the node (key) explained by each step. */
  tour?: { node: string; text: Tx }[];
  /** false = no automatic Inputs / Shape / Motion / Color / Output frames (tutorials use their own numbered frames). */
  roleFrames?: boolean;
  /** Titles of custom (non-role) comment frames, keyed by frame key. */
  frames?: Record<string, Tx>;
  build(s: S): void;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const SKIP_CHECK = new Set(['gradient', 'curve', 'spline', 'string', 'asset']);

export class S extends Builder {
  readonly roleKeys = new Map<Role, string[]>();
  readonly customFrames: { key: string; keys: string[]; color: string }[] = [];
  private readonly at = new Map<string, { x: number; y: number }>();
  private readonly nodeColor = new Map<string, string>();

  constructor(registry: NodeRegistry, readonly spec: SampleSpec) {
    super(new Graph(registry, spec.settings));
  }

  /** Strict node: id = key, grid position (col,row), role colour; inputs `{ pin: 'key' | 'key.pin' }`. */
  node(role: Role, key: string, type: string, name: string, col: number, row: number, params: Record<string, unknown> = {}, inputs: Record<string, string> = {}): string {
    const n = this.g.addNode(type, { id: key, x: col * COL, y: row * ROW, name, params: params as never });
    const ex = this.g.registry.expanded(type)!;
    for (const [k, v] of Object.entries(params)) {
      const def = ex.params.find((p) => p.id === k)!;
      if (SKIP_CHECK.has(def.type)) continue;
      if (!same(n.params[k], v)) throw new Error(`[${this.spec.id}] ${key}.${k}: ${JSON.stringify(v)} is outside the schema (stored ${JSON.stringify(n.params[k])})`);
    }
    for (const [pin, from] of Object.entries(inputs)) {
      const [fn, fp = 'output'] = from.split('.');
      const [tn] = [key];
      if (!this.g.nodes.has(fn)) throw new Error(`[${this.spec.id}] ${key}.${pin}: unknown source "${fn}" (create sources first)`);
      this.g.connect({ node: fn, pin: fp }, { node: tn, pin }, `l_${fn}_${fp}__${tn}_${pin}`);
    }
    this.at.set(key, { x: col * COL, y: row * ROW });
    const list = this.roleKeys.get(role) ?? [];
    list.push(key);
    this.roleKeys.set(role, list);
    this.nodeColor.set(key, ROLES[role].color);
    return key;
  }
  /** Connects after creation (for feedback-free late wiring). */
  link(from: string, to: string): void {
    const [fn, fp = 'output'] = from.split('.');
    const [tn, tp = 'input'] = to.split('.');
    this.g.connect({ node: fn, pin: fp }, { node: tn, pin: tp }, `l_${fn}_${fp}__${tn}_${tp}`);
  }
  /** Extra comment frame (tutorial steps, key areas) around `keys`. */
  frame(key: string, color: string, ...keys: string[]): void {
    this.customFrames.push({ key, keys, color });
  }
  /** Animated exports etc. all use these helpers so the numbers stay in one place. */
  flipExport(role: Role, key: string, type: 'export.color' | 'export.mask' | 'export.multimask' | 'export.normal' | 'export.warp', name: string, col: number, row: number, frames: number, cols: number, rows: number, params: Record<string, unknown>, inputs: Record<string, string>): string {
    return this.node(role, key, type, name, col, row, { frame_mode: 'flipbook', frame_count: frames, fb_cols: cols, fb_rows: rows, ...params }, inputs);
  }

  private box(keys: string[], pad: number): { x: number; y: number; w: number; h: number } {
    const pts = keys.map((k) => this.at.get(k)!).filter(Boolean);
    const x0 = Math.min(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y1 = Math.max(...pts.map((p) => p.y));
    return { x: x0 - pad, y: y0 - pad - 34, w: x1 - x0 + 230 + pad * 2, h: y1 - y0 + 190 + pad * 2 + 34 };
  }

  /** Writes node colours + comment frames (one per used role, then the custom ones) into the graph annotations. */
  finish(): FrameData[] {
    const frames: FrameData[] = [];
    const ann = this.g.annotations;
    for (const [k, c] of this.nodeColor) ann.nodeUi[k] = { color: c };
    for (const [role, keys] of this.roleKeys) {
      if (this.spec.roleFrames === false || keys.length === 0) continue;
      const b = this.box(keys, 20);
      frames.push({ id: `f_${role}`, ...b, title: ROLES[role].title.en, color: ROLES[role].color, members: undefined });
    }
    for (const f of this.customFrames) {
      const b = this.box(f.keys, 10);
      frames.push({ id: `f_${f.key}`, ...b, title: this.spec.frames?.[f.key]?.en ?? f.key, color: f.color });
    }
    ann.frames = frames.map((f) => ({ ...f }));
    return frames;
  }
}

/** Sweep control point (x, y, + z / scale / twist attributes), world units. */
export const spt = (x: number, y: number, z: number, scale = 1, twist = 0) => ({ x, y, attrs: { z, scale, twist } });
export const line3 = (pts: [number, number, number][]) => ({ closed: false, points: pts.map(([x, y, z]) => spt(x, y, z)) });

/* shared gradients */
export const BLACKBODY = grad([[0, [0, 0, 0, 0]], [0.2, [0.25, 0.02, 0, 0.6]], [0.45, [0.9, 0.12, 0.01, 1]], [0.7, [1, 0.5, 0.06, 1]], [0.9, [1, 0.85, 0.35, 1]], [1, [1, 0.97, 0.8, 1]]]);
export const SMOKE_G = grad([[0, [0.08, 0.08, 0.09, 0]], [0.35, [0.22, 0.22, 0.25, 0.55]], [1, [0.8, 0.8, 0.84, 1]]]);
export const CYAN_G = grad([[0, [0, 0.02, 0.06, 0]], [0.35, [0.02, 0.3, 0.6, 0.6]], [0.75, [0.3, 0.9, 1, 1]], [1, [1, 1, 1, 1]]]);
export const VIOLET_G = grad([[0, [0.02, 0, 0.06, 0]], [0.4, [0.45, 0.05, 0.9, 0.7]], [0.8, [0.4, 0.8, 1, 1]], [1, [1, 1, 1, 1]]]);
export const LAVA_G = grad([[0, [0.02, 0.005, 0.005, 1]], [0.35, [0.25, 0.02, 0.0, 1]], [0.6, [0.95, 0.15, 0.01, 1]], [0.85, [1, 0.6, 0.05, 1]], [1, [1, 0.95, 0.5, 1]]]);
export const WATER_G = grad([[0, [0.01, 0.07, 0.14, 1]], [0.5, [0.05, 0.35, 0.5, 1]], [1, [0.7, 0.95, 1, 1]]]);
export const ELECTRIC_G = grad([[0, [0, 0, 0.05, 0]], [0.3, [0.05, 0.1, 0.6, 0.6]], [0.65, [0.3, 0.6, 1, 1]], [1, [0.95, 0.98, 1, 1]]]);

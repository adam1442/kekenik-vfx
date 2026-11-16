import { consoleBus } from '../../shared/log';
import { Emitter } from '../../shared/emitter';
import { Params } from '../params/accessor';
import { defineShader, type ShaderSource } from '../shaders/library';
import { ShaderCompileError } from '../shaders/pipelines';
import type { ExpandedNode } from '../graph/expand';
import type { FuseIO } from '../graph/node';
import type { PlanNode } from '../graph/plan';
import { DEFAULT_FUSION_LIMITS, type FuseNodeView, type FusionLimits, type FusionPlan, type Segment } from './planner';
import { attributeLine, generateFusedModule, segmentSignature, type FuseNodeSpec, type FusedModule } from './wgsl-gen';

/**
 * fusion runtime: settings (global toggle, `?nofusion`), the bounded LRU of generated modules (keyed by SIGNATURE, never by
 * parameter values), broken-signature memory (compile failure -> automatic unfused fallback), diagnostics counters and the adapters
 * between the evaluator's PlanNodes and the pure planner / generator.
 */

const STORE_KEY = 'kk.fusion';
const urlDisabled = (): boolean => typeof location !== 'undefined' && /[?&]nofusion\b/.test(location.search);
const loadEnabled = (): boolean => {
  if (urlDisabled()) return false;
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(STORE_KEY) !== '0';
  } catch {
    return true;
  }
};

export interface FusionSummary {
  /** Nodes that ran (pass granularity) without / with fusion. */
  before: number;
  after: number;
  segments: { ids: string[]; names: string[]; types: string[] }[];
  time: number;
}

interface ModuleEntry {
  mod: FusedModule;
  shader: ShaderSource;
}

export class FusionRuntime {
  /** Global switch ("Disable pass fusion" = false). Default ON. */
  enabled = loadEnabled();
  readonly onChange = new Emitter<boolean>();
  limits: FusionLimits = { ...DEFAULT_FUSION_LIMITS };
  /** Bound of the generated-module / pipeline LRU. */
  static MAX_MODULES = 48;
  private modules = new Map<string, ModuleEntry>();
  /** Signatures whose compilation failed: never tried again (until `resetBroken`). */
  readonly broken = new Set<string>();
  /** Called with the shader id of an evicted module so the pipeline cache can drop its pipelines. */
  onEvict?: (shaderId: string) => void;
  fallbacks = 0;
  fusedPasses = 0;
  passesSaved = 0;
  private ring: FusionSummary[] = [];

  setEnabled(v: boolean): void {
    if (this.enabled === v) return;
    this.enabled = v && !urlDisabled();
    try {
      localStorage.setItem(STORE_KEY, this.enabled ? '1' : '0');
    } catch {
      /* private mode */
    }
    this.onChange.emit(this.enabled);
  }

  get limitModules(): number {
    return FusionRuntime.MAX_MODULES;
  }

  get moduleCount(): number {
    return this.modules.size;
  }

  /** Cached module + ShaderSource of a segment signature (LRU, bounded). */
  moduleFor(specs: FuseNodeSpec[]): ModuleEntry {
    const sig = segmentSignature(specs, false);
    const hit = this.modules.get(sig);
    if (hit) {
      this.modules.delete(sig);
      this.modules.set(sig, hit); // LRU touch
      return hit;
    }
    const mod = generateFusedModule(specs, false);
    const entry: ModuleEntry = { mod, shader: defineShader(mod.name, mod.code) };
    this.modules.set(mod.signature, entry);
    while (this.modules.size > FusionRuntime.MAX_MODULES) {
      const [k, v] = this.modules.entries().next().value as [string, ModuleEntry];
      this.modules.delete(k);
      this.onEvict?.(v.shader.id);
    }
    return entry;
  }

  /** Compile failure of a fused module: remember it, log which NODE broke it, count the fallback. */
  reportBroken(signature: string, err: unknown, mod: FusedModule, nodes: { id: string; name: string }[]): void {
    this.broken.add(signature);
    this.fallbacks++;
    const diags = err instanceof ShaderCompileError ? err.diagnostics.filter((d) => d.severity === 'error') : [];
    const names = new Set<string>();
    for (const d of diags) {
      const at = attributeLine(mod.lineMap, d.line);
      if (!at) continue;
      const n = nodes[at.node];
      names.add(n?.name ?? at.type);
      consoleBus.error(`Fused shader failed in node "${n?.name ?? at.type}" (${at.type}, ${at.fileName}:${at.line}): ${d.message}. Falling back to unfused evaluation.`, {
        source: 'fusion',
        nodeId: n?.id,
        nodeName: n?.name,
        file: at.fileName,
        line: at.line,
      });
    }
    if (names.size === 0) consoleBus.warn(`Fused segment failed to build (${(err as Error)?.message ?? err}). Falling back to unfused evaluation.`, { source: 'fusion' });
  }

  resetBroken(): void {
    this.broken.clear();
  }

  record(plan: FusionPlan, names: (id: string) => string, types: (id: string) => string): void {
    this.passesSaved += plan.before - plan.after;
    this.ring.push({ before: plan.before, after: plan.after, segments: plan.segments.map((s) => ({ ids: s.ids, names: s.ids.map(names), types: s.ids.map(types) })), time: Date.now() });
    if (this.ring.length > 8) this.ring.shift();
  }

  /** The summary of the largest of the last evaluations (= "the visible graph", not a thumbnail). */
  get summary(): FusionSummary | null {
    let best: FusionSummary | null = null;
    for (const s of this.ring) if (!best || s.before >= best.before) best = s;
    return best;
  }

  clear(): void {
    this.modules.clear();
    this.ring = [];
  }
}

/* ---------------------------------------------------------------------------------------------------------- adapters */

export const frameSignature = (f: PlanNode['frame']): string =>
  `${f.width}x${f.height}|${f.fullWidth}x${f.fullHeight}@${f.originX},${f.originY}|${+f.tileX}${+f.tileY}|${f.filter}|${+f.hq}|${f.time}|${f.loopPhase}|${f.seed}`;

const linkOf = (pn: PlanNode, pinId: string): { node: string; pin: string } | null => {
  const l = pn.inputs.find((i) => i.pin.id === pinId)?.link;
  return l ? { node: l.from.node, pin: l.from.pin } : null;
};

/** FuseIO of a PlanNode (modulation only counts when its pin is connected, exactly like `ctx.mod`). */
export function fuseIO(pn: PlanNode, p: Params): FuseIO {
  return {
    has: (pin) => !!linkOf(pn, pin),
    modK: (id) => (linkOf(pn, `${id}_mod`) ? p.num(`${id}_mod_k`) : 0),
  };
}

/** Planner view of a PlanNode that is about to run (see planner.ts). */
export function fuseView(plan: { nodes: Map<string, PlanNode> }, id: string, consumers: number): FuseNodeView | undefined {
  const pn = plan.nodes.get(id);
  const ex: ExpandedNode | undefined = pn?.expanded;
  if (!pn || !ex || pn.error) return undefined;
  const def = ex.def;
  const decl = def.fusable;
  const outType = ex.outputs[0]?.type ?? '';
  const bypass = !!pn.node.bypass || !!def.passthrough;
  const bgLinked = pn.inputs.some((i) => i.link && i.pin.role === 'background');
  const mainPin = decl ? (decl.main === undefined ? 'input' : decl.main) : null;
  const main = mainPin ? linkOf(pn, mainPin) : null;
  const head = !!decl && decl.main === null;
  let fusable = !!decl && !bypass && !bgLinked && ex.outputs.length === 1 && (head || !!main);
  if (decl && fusable) {
    try {
      if (decl.canFuse && !decl.canFuse(pn.params)) fusable = false;
    } catch {
      fusable = false;
    }
  }
  // Identity (7B short-cut): same rules as the evaluator's canSkipIdentity, evaluated on the plan.
  let identity = false;
  let idMain: { node: string; pin: string } | null = null;
  if (def.identity && !bypass && ex.outputs.length === 1) {
    try {
      identity = !!def.identity(pn.params);
    } catch {
      identity = false;
    }
    if (identity) {
      if (pn.inputs.some((i) => i.link && (i.pin.role === 'modulation' || i.pin.role === 'background'))) identity = false;
      const srcPin = ex.inputs.find((p) => p.type === ex.outputs[0].type && p.role !== 'modulation' && p.role !== 'background' && linkOf(pn, p.id));
      idMain = srcPin ? linkOf(pn, srcPin.id) : null;
      const prod = idMain ? plan.nodes.get(idMain.node) : undefined;
      const prodOut = prod?.expanded?.outputs.find((o) => o.id === idMain!.pin);
      if (!idMain || !prod || !prodOut || prodOut.type !== ex.outputs[0].type || prod.frame.width !== pn.frame.width || prod.frame.height !== pn.frame.height) identity = false;
    }
  }
  const extras = decl?.extras ?? [];
  const extraConnected = extras.filter((e) => linkOf(pn, e)).length;
  const prodNode = main ? plan.nodes.get(main.node) : undefined;
  const mainFromType = prodNode?.expanded?.outputs.find((o) => o.id === main!.pin)?.type;
  return {
    id,
    fusable,
    head,
    main: identity && !fusable ? idMain : main,
    mainFromType,
    mainPinType: mainPin ? ex.inputs.find((p) => p.id === mainPin)?.type : undefined,
    outType,
    extraConnected,
    extraUnconnected: extraConnected < extras.length,
    consumers,
    frameSig: frameSignature(pn.frame),
    identity,
    uniformBytes: decl?.uniforms.size ?? 0,
  };
}

/** Build the generator specs of the executed nodes of a segment. */
export function specsFor(seg: Segment, plan: { nodes: Map<string, PlanNode> }): FuseNodeSpec[] {
  return seg.ids.map((id, i) => {
    const pn = plan.nodes.get(id)!;
    const ex = pn.expanded!;
    const decl = ex.def.fusable!;
    const mainPin = decl.main === undefined ? 'input' : decl.main;
    const pinType = mainPin ? ex.inputs.find((p) => p.id === mainPin)?.type : undefined;
    const prevOut = i > 0 ? plan.nodes.get(seg.ids[i - 1])!.expanded!.outputs[0]?.type : undefined;
    return {
      type: ex.def.id,
      sourceId: decl.source.id,
      code: decl.source.code,
      fileName: decl.source.name,
      layout: decl.uniforms,
      defines: decl.defines,
      extras: (decl.extras ?? []).map((e) => !!linkOf(pn, e)),
      head: decl.main === null,
      grayToColor: i > 0 && prevOut === 'gray' && pinType === 'color',
    };
  });
}

export { Params };

/**
 * pixel pass FUSION PLANNER (pure TypeScript, no GPU, no registry: unit tested in tests/fusion.test.ts).
 *
 * Input: the nodes the evaluator is about to RUN (topological order) described as `FuseNodeView`s.
 * Output: SEGMENTS — linear chains of per-pixel nodes that are rendered by ONE fullscreen pass.
 *
 * Rules (a node N joins the open segment S whose LAST node is M = N's main producer):
 *   1. N is fusable (declares `fusable`, no Background pin connected, not bypassed, params allow it).
 *   2. M has exactly ONE consumer in the whole graph (N, possibly through transparent identity nodes), is not an evaluation
 *      target (viewport / thumbnail / export / pinned preview materialise their own texture) and is the last node of S.
 *   3. identical frame signature (size, tiling, filtering, HQ, time, seed, region) -> the fused chain gives the same pixels.
 *   4. link types are compatible (same type, or the implicit Gray -> Color conversion that the shader performs inline).
 *   5. device limits: bound textures, uniform bytes and node count of the segment stay under the limits (the chain is split).
 * Generator heads (`head: true`) always start a new segment. Identity-parameter nodes with one consumer are TRANSPARENT: they are
 * dropped from the chain (listed in `Segment.skipped`) before fusion (this generalises the 7B identity short-cut).
 * Deterministic: the result depends only on the inputs (order + views), never on hash-map iteration order.
 */

export interface FuseNodeView {
  id: string;
  /** Declares `fusable`, allowed for these params, not bypassed, no Background pin connected, single output. */
  fusable: boolean;
  /** Generator head: no main input (uv-only generator). */
  head: boolean;
  /** Producer of the main (chain) input; null when unconnected / head. */
  main: { node: string; pin: string } | null;
  /** Pin type of the producer's output feeding the main input, and the type of the consumer pin ('gray' | 'color' | ...). */
  mainFromType?: string;
  mainPinType?: string;
  /** Output pin type of this node. */
  outType: string;
  /** Number of connected extra (same-uv) textures; they become extra bindings. */
  extraConnected: number;
  /** True when some extra pin is unconnected (shares ONE dummy binding per segment). */
  extraUnconnected: boolean;
  /** Links leaving the node in the WHOLE graph (not only the planned part). */
  consumers: number;
  /** All fields that must be equal inside one segment (size, tiling, filter, hq, time, seed, region). */
  frameSig: string;
  /** For the current params the node returns its main input unchanged (see NodeDefinition.identity) and could be dropped. */
  identity: boolean;
  /** Uniform block size in bytes. */
  uniformBytes: number;
}

export interface FusionLimits {
  /** Max sampled textures in the fused pass (device limit minus a safety margin). */
  maxTextures: number;
  /** Max bytes of the flattened uniform block (device maxUniformBufferBindingSize is >= 64 KB; we stay far below). */
  maxUniformBytes: number;
  /** Max nodes per segment (keeps generated WGSL compile times sane). */
  maxNodes: number;
}
export const DEFAULT_FUSION_LIMITS: FusionLimits = { maxTextures: 14, maxUniformBytes: 16384, maxNodes: 24 };

export interface Segment {
  /** Executed nodes in chain order (length >= 2 for a fused segment). */
  ids: string[];
  /** Transparent identity nodes removed from the chain (they stay between the executed nodes, in topological order). */
  skipped: string[];
  /** The node whose output the segment materialises (also the cache owner). */
  last: string;
  /** External main input of the first node (null for generator heads). */
  seed: { node: string; pin: string } | null;
  /** Number of texture bindings (seed + connected extras + dummy). */
  textures: number;
  uniformBytes: number;
}

export interface FusionPlan {
  segments: Segment[];
  /** node id -> segment, for EXECUTED and SKIPPED nodes of fused segments. */
  byNode: Map<string, Segment>;
  /** Nodes the evaluator would run without fusion / pass count after fusion (node granularity). */
  before: number;
  after: number;
}

const typesCompatible = (from?: string, to?: string): boolean => from === undefined || to === undefined || from === to || (from === 'gray' && to === 'color');

interface Builder {
  seg: Segment;
  sig: string;
  dummy: boolean;
}

export function planFusion(
  order: string[],
  view: (id: string) => FuseNodeView | undefined,
  isTarget: ReadonlySet<string>,
  limits: FusionLimits = DEFAULT_FUSION_LIMITS,
  enabled = true,
): FusionPlan {
  const ran = order.filter((id) => view(id) !== undefined);
  if (!enabled) return { segments: [], byNode: new Map(), before: ran.length, after: ran.length };

  const open = new Map<string, Builder>(); // last node id -> builder
  const builders: Builder[] = [];
  const inSeg = new Set<string>();

  /** Walk back from `n`'s main producer through transparent identity nodes. */
  const resolveMain = (n: FuseNodeView): { prod: { node: string; pin: string }; through: string[] } | null => {
    if (!n.main) return null;
    const through: string[] = [];
    let cur = n.main;
    for (let guard = 0; guard < 4096; guard++) {
      const v = view(cur.node);
      if (!v || !v.identity || v.consumers !== 1 || isTarget.has(cur.node) || !v.main || inSeg.has(cur.node)) break;
      // `v` is a transparent identity node: it is dropped from the chain (listed in Segment.skipped).
      through.push(cur.node);
      cur = v.main;
    }
    return { prod: cur, through: through.reverse() };
  };

  const start = (n: FuseNodeView, seed: { node: string; pin: string } | null, skipped: string[]): void => {
    const b: Builder = {
      seg: { ids: [n.id], skipped: [...skipped], last: n.id, seed, textures: (seed ? 1 : 0) + n.extraConnected + (n.extraUnconnected ? 1 : 0), uniformBytes: n.uniformBytes },
      sig: n.frameSig,
      dummy: n.extraUnconnected,
    };
    builders.push(b);
    open.set(n.id, b);
    inSeg.add(n.id);
  };

  for (const id of order) {
    const n = view(id);
    if (!n) continue;
    // A5: identity-parameter node with a single consumer is transparent. If the consumer fuses it is dropped, else it runs normally.
    if (n.identity && n.consumers === 1 && !isTarget.has(id) && n.main) continue;
    if (!n.fusable) continue;
    if (n.head || !n.main) {
      start(n, null, []);
      continue;
    }
    const rm = resolveMain(n);
    const prodView = rm ? view(rm.prod.node) : undefined;
    const b = rm && prodView ? open.get(rm.prod.node) : undefined;
    // Every node on the way (the producer and the identity nodes) must have a single consumer.
    const ok =
      !!rm &&
      !!prodView &&
      !!b &&
      prodView.consumers === 1 &&
      !isTarget.has(rm.prod.node) &&
      b.sig === n.frameSig &&
      typesCompatible(n.mainFromType, n.mainPinType) &&
      typesCompatible(prodView.outType, n.mainPinType) &&
      b.seg.ids.length < limits.maxNodes &&
      b.seg.uniformBytes + n.uniformBytes <= limits.maxUniformBytes &&
      b.seg.textures + n.extraConnected + (n.extraUnconnected && !b.dummy ? 1 : 0) <= limits.maxTextures;
    if (ok && b && rm) {
      open.delete(rm.prod.node);
      b.seg.ids.push(n.id);
      b.seg.skipped.push(...rm.through);
      b.seg.last = n.id;
      b.seg.textures += n.extraConnected + (n.extraUnconnected && !b.dummy ? 1 : 0);
      b.seg.uniformBytes += n.uniformBytes;
      b.dummy = b.dummy || n.extraUnconnected;
      open.set(n.id, b);
      inSeg.add(n.id);
    } else {
      // A new segment seeded by the (resolved) external producer. Identity nodes in between stay ordinary nodes here.
      start(n, n.main, []);
      if (rm && prodView && prodView.consumers === 1 && !isTarget.has(rm.prod.node) && rm.through.length > 0) {
        // The identity nodes between the producer and N are dropped: N reads the real producer directly.
        const bb = open.get(n.id)!;
        const through = rm.through;
        bb.seg.seed = rm.prod;
        bb.seg.skipped.push(...through);
      } else if (rm && rm.through.length > 0) {
        // The producer of the identity chain is shared / a target: we may still skip the identity nodes (they only forward it).
        const bb = open.get(n.id)!;
        bb.seg.seed = rm.prod;
        bb.seg.skipped.push(...rm.through);
      }
    }
  }

  const segments: Segment[] = [];
  const byNode = new Map<string, Segment>();
  let removed = 0;
  for (const b of builders) {
    if (b.seg.ids.length < 2) continue; // a single node gains nothing: it runs through its normal evaluate()
    segments.push(b.seg);
    for (const id of b.seg.ids) byNode.set(id, b.seg);
    for (const id of b.seg.skipped) byNode.set(id, b.seg);
    removed += b.seg.ids.length - 1 + b.seg.skipped.length;
  }
  // Skipped identity nodes of discarded single-node builders stay ordinary nodes (their segment was dropped).
  return { segments, byNode, before: ran.length, after: ran.length - removed };
}

/** Human readable one-liner of a plan for the Diagnostics panel / tests. */
export const describeSegment = (s: Segment, name: (id: string) => string): string => s.ids.map(name).join(' → ');

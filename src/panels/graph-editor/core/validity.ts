import type { ExpandedNode } from '../../../engine/graph/expand';
import type { Graph } from '../../../engine/graph/graph';
import type { NodeDefinition } from '../../../engine/graph/node';
import { canConnect, type PinDef } from '../../../engine/graph/pins';
import type { NodeRegistry } from '../../../engine/graph/registry';
import type { PinRef, PinType } from '../../../engine/types';
import { isModPin } from './geometry';

/** Link validity for the editor (pure). The engine's Graph.checkConnection stays the single source of truth. */
export type LinkReason = 'ok' | 'type' | 'cycle' | 'missing';
export interface LinkCheck {
  ok: boolean;
  reason: LinkReason;
  message: string | null;
}

export function checkLink(graph: Graph, from: PinRef, to: PinRef): LinkCheck {
  const err = graph.checkConnection(from, to);
  if (!err) return { ok: true, reason: 'ok', message: null };
  const reason: LinkReason = /cycle/i.test(err) ? 'cycle' : /Cannot connect/i.test(err) ? 'type' : 'missing';
  return { ok: false, reason, message: err };
}

/**
 * Best pin of `ex` to connect a dragged link to.
 *   side 'in'  -> we hold an OUTPUT of type `type`; pick an input that accepts it
 *   side 'out' -> we hold an INPUT of type `type`;  pick an output that can feed it
 * Preference: exact type, then unconnected, then non-modulation, then declaration order.
 */
export function pickPin(ex: ExpandedNode, side: 'in' | 'out', type: PinType, connected: ReadonlySet<string> = new Set()): PinDef | undefined {
  const pins = side === 'in' ? ex.inputs : ex.outputs;
  const ok = pins.filter((p) => (side === 'in' ? canConnect(type, p.type) : canConnect(p.type, type)));
  if (!ok.length) return undefined;
  const score = (p: PinDef): number => (p.type === type ? 0 : 4) + (connected.has(p.id) ? 2 : 0) + (isModPin(p) ? 8 : 0) + (p.role === 'background' ? 1 : 0);
  return [...ok].sort((a, b) => score(a) - score(b))[0];
}

/** Node definitions that can be connected to a dragged pin. `dragSide` = the side of the pin the user holds. */
export function compatibleDefs(registry: NodeRegistry, dragSide: 'in' | 'out', type: PinType): NodeDefinition[] {
  return registry.list().filter((d) => {
    const ex = registry.expanded(d.id);
    return !!ex && !!pickPin(ex, dragSide === 'out' ? 'in' : 'out', type);
  });
}

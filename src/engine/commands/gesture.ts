import type { Graph } from '../graph/graph';
import { cloneValue, valuesEqual, type ParamValue } from '../params/schema';
import type { Command, CommandStack } from './command';

/**
 * ParamGesture: one continuous interaction (gizmo drag, numeric entry) that edits many params, possibly on many
 * nodes, MANY times, and must end up as exactly ONE undo step.
 *  - `set()` writes the value to the graph immediately (live re-evaluation) but records nothing yet.
 *  - `commit()` pushes ONE sealed SetParamsCommand (before -> after) on the stack. `cancel()` restores the start.
 * This is independent of the 600 ms time-based coalescing of SetParamCommand (a slow drag with pauses still = 1 step).
 */
export interface ParamGesture {
  set(nodeId: string, paramId: string, value: ParamValue): void;
  /** Returns true when something changed and an undo entry was recorded. */
  commit(): boolean;
  cancel(): void;
  readonly changed: boolean;
}

interface Entry {
  nodeId: string;
  paramId: string;
  before: ParamValue;
  after: ParamValue;
}

export class SetParamsCommand implements Command {
  constructor(
    private g: Graph,
    readonly label: string,
    private entries: Entry[],
  ) {}
  do(): void {
    for (const e of this.entries) if (this.g.nodes.has(e.nodeId)) this.g.setParam(e.nodeId, e.paramId, cloneValue(e.after));
  }
  undo(): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (this.g.nodes.has(e.nodeId)) this.g.setParam(e.nodeId, e.paramId, cloneValue(e.before));
    }
  }
}

export class GraphGesture implements ParamGesture {
  private entries = new Map<string, Entry>();
  private done = false;
  constructor(
    private g: Graph,
    private stack: CommandStack,
    private label: string,
    private hooks: { onEnd?: () => void } = {},
  ) {}

  get changed(): boolean {
    for (const e of this.entries.values()) if (!valuesEqual(e.before, e.after)) return true;
    return false;
  }

  set(nodeId: string, paramId: string, value: ParamValue): void {
    if (this.done) return;
    const node = this.g.nodes.get(nodeId);
    if (!node) return;
    const key = `${nodeId}\u0000${paramId}`;
    let e = this.entries.get(key);
    if (!e) {
      e = { nodeId, paramId, before: cloneValue(node.params[paramId] as ParamValue), after: value };
      this.entries.set(key, e);
    }
    if (valuesEqual(node.params[paramId] as ParamValue, value)) return; // nothing to do (avoids useless re-evaluation)
    e.after = cloneValue(this.g.setParam(nodeId, paramId, value));
  }

  commit(): boolean {
    if (this.done) return false;
    this.done = true;
    const list = [...this.entries.values()].filter((e) => !valuesEqual(e.before, e.after));
    this.hooks.onEnd?.();
    if (!list.length) return false;
    this.stack.execute(new SetParamsCommand(this.g, this.label, list));
    this.stack.sealTop();
    return true;
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    for (const e of this.entries.values()) if (this.g.nodes.has(e.nodeId)) this.g.setParam(e.nodeId, e.paramId, cloneValue(e.before));
    this.hooks.onEnd?.();
  }
}

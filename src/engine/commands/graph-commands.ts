import { GraphGesture, type ParamGesture } from './gesture';
import { deepClone, uid } from '../../shared/util';
import type { GraphAnnotations } from '../graph/annotations';
import type { Graph, GraphSettings, LinkData, NodeData } from '../graph/graph';
import { cloneValue, valuesEqual, type ParamValue, type ParamValues } from '../params/schema';
import type { PinRef } from '../types';
import { CommandStack, type Command } from './command';

/** Concrete graph commands. UI code should use GraphEditor (below), not construct these by hand. */

export class AddNodeCommand implements Command {
  readonly label: string;
  readonly nodeId: string;
  constructor(
    private g: Graph,
    private type: string,
    private opts: { x?: number; y?: number; name?: string; params?: ParamValues } = {},
    id?: string,
  ) {
    this.nodeId = id ?? uid('n');
    this.label = `Add ${g.registry.get(type)?.title ?? type}`;
  }
  do(): void {
    this.g.addNode(this.type, { ...this.opts, id: this.nodeId });
  }
  undo(): void {
    this.g.removeNode(this.nodeId);
  }
}

export class RemoveNodesCommand implements Command {
  readonly label: string;
  private removed: { node: NodeData; links: LinkData[] }[] = [];
  constructor(
    private g: Graph,
    private ids: string[],
  ) {
    this.label = ids.length === 1 ? `Delete ${g.nodes.get(ids[0])?.name ?? 'node'}` : `Delete ${ids.length} nodes`;
  }
  do(): void {
    this.removed = [];
    for (const id of this.ids) {
      if (!this.g.nodes.has(id)) continue;
      this.removed.push(this.g.removeNode(id));
    }
  }
  undo(): void {
    for (let i = this.removed.length - 1; i >= 0; i--) this.g.restoreNode(this.removed[i].node, this.removed[i].links);
  }
}

export class ConnectCommand implements Command {
  readonly label = 'Connect';
  private linkId = uid('l');
  private replaced?: LinkData;
  constructor(
    private g: Graph,
    private from: PinRef,
    private to: PinRef,
  ) {}
  do(): void {
    this.replaced = this.g.connect(this.from, this.to, this.linkId).replaced;
  }
  undo(): void {
    this.g.disconnect(this.linkId);
    if (this.replaced) this.g.restoreLink(this.replaced);
  }
}

export class DisconnectCommand implements Command {
  readonly label = 'Disconnect';
  private link?: LinkData;
  constructor(
    private g: Graph,
    private linkId: string,
  ) {}
  do(): void {
    this.link = this.g.disconnect(this.linkId);
  }
  undo(): void {
    if (this.link) this.g.restoreLink(this.link);
  }
}

export class SetParamCommand implements Command {
  readonly label: string;
  readonly mergeKey: string;
  private before!: ParamValue;
  private after: ParamValue;
  private first = true;
  constructor(
    private g: Graph,
    private nodeId: string,
    private paramId: string,
    value: ParamValue,
  ) {
    this.after = cloneValue(value);
    this.mergeKey = `param:${nodeId}:${paramId}`;
    this.label = `Set ${paramId.replace(/_/g, ' ')}`;
  }
  do(): void {
    if (this.first) {
      this.before = cloneValue(this.g.nodes.get(this.nodeId)!.params[this.paramId]);
      this.first = false;
    }
    this.after = this.g.setParam(this.nodeId, this.paramId, this.after);
  }
  undo(): void {
    this.g.setParam(this.nodeId, this.paramId, this.before);
  }
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetParamCommand) || next.mergeKey !== this.mergeKey) return false;
    this.after = next.after;
    return true;
  }
  /** True if the command changes nothing (UI can skip recording it). */
  get isNoop(): boolean {
    return valuesEqual(this.before, this.after);
  }
}

export class MoveNodesCommand implements Command {
  readonly label = 'Move';
  readonly mergeKey: string;
  private before = new Map<string, [number, number]>();
  constructor(
    private g: Graph,
    private moves: Map<string, [number, number]>,
  ) {
    this.mergeKey = `move:${[...moves.keys()].sort().join(',')}`;
  }
  do(): void {
    for (const [id, [x, y]] of this.moves) {
      const n = this.g.nodes.get(id);
      if (!n) continue;
      if (!this.before.has(id)) this.before.set(id, [n.x, n.y]);
      this.g.moveNode(id, x, y);
    }
  }
  undo(): void {
    for (const [id, [x, y]] of this.before) if (this.g.nodes.has(id)) this.g.moveNode(id, x, y);
  }
  mergeWith(next: Command): boolean {
    if (!(next instanceof MoveNodesCommand) || next.mergeKey !== this.mergeKey) return false;
    this.moves = next.moves;
    return true;
  }
}

export class SetSettingsCommand implements Command {
  readonly label = 'Change graph settings';
  readonly mergeKey: string;
  private before?: GraphSettings;
  constructor(
    private g: Graph,
    private patch: Partial<GraphSettings>,
  ) {
    this.mergeKey = `settings:${Object.keys(patch).sort().join(',')}`;
  }
  do(): void {
    const prev = this.g.setSettings(this.patch);
    this.before ??= prev;
  }
  undo(): void {
    if (this.before) this.g.setSettings(this.before);
  }
  mergeWith(next: Command): boolean {
    if (!(next instanceof SetSettingsCommand) || next.mergeKey !== this.mergeKey) return false;
    this.patch = next.patch;
    return true;
  }
}

export class SetNodeFieldCommand<K extends 'name' | 'bypass' | 'comment'> implements Command {
  readonly label: string;
  private before!: NodeData[K];
  constructor(
    private g: Graph,
    private nodeId: string,
    private field: K,
    private value: NodeData[K],
  ) {
    this.label = `Set ${field}`;
  }
  do(): void {
    this.before = this.g.nodes.get(this.nodeId)![this.field];
    this.g.setNodeField(this.nodeId, this.field, this.value);
  }
  undo(): void {
    this.g.setNodeField(this.nodeId, this.field, this.before);
  }
}

/**
 * Snapshot-based command for editor annotations (frames, notes, reroutes, node UI...). `mutate` edits the live
 * annotations object; before/after snapshots make undo/redo trivial and robust. Coalesces by `mergeKey`.
 */
export class AnnotationsCommand implements Command {
  private before?: GraphAnnotations;
  private after?: GraphAnnotations;
  constructor(
    private g: Graph,
    readonly label: string,
    private mutate: (a: GraphAnnotations) => void,
    readonly mergeKey?: string,
  ) {}
  do(): void {
    if (!this.before) {
      this.before = deepClone(this.g.annotations);
      this.mutate(this.g.annotations);
      this.after = deepClone(this.g.annotations);
      this.g.setAnnotations(this.g.annotations);
    } else this.g.setAnnotations(this.after!);
  }
  undo(): void {
    if (this.before) this.g.setAnnotations(this.before);
  }
  mergeWith(next: Command): boolean {
    if (!(next instanceof AnnotationsCommand) || next.mergeKey !== this.mergeKey || !next.after) return false;
    this.after = next.after;
    return true;
  }
}

/**
 * GraphEditor: THE API UI/gizmos/shortcuts use to change a graph. Every method goes through the CommandStack, so
 * everything is undoable; gizmo drags call setParam repeatedly and coalesce into one step automatically.
 */
export class GraphEditor {
  constructor(
    readonly graph: Graph,
    readonly stack: CommandStack = new CommandStack(),
  ) {}

  addNode(type: string, opts: { x?: number; y?: number; name?: string; params?: ParamValues } = {}): string {
    const c = new AddNodeCommand(this.graph, type, opts);
    this.stack.execute(c);
    return c.nodeId;
  }
  removeNodes(ids: string[]): void {
    this.stack.execute(new RemoveNodesCommand(this.graph, ids));
  }
  connect(from: PinRef, to: PinRef): void {
    this.stack.execute(new ConnectCommand(this.graph, from, to));
  }
  disconnect(linkId: string): void {
    this.stack.execute(new DisconnectCommand(this.graph, linkId));
  }
  setParam(nodeId: string, paramId: string, value: ParamValue): void {
    this.stack.execute(new SetParamCommand(this.graph, nodeId, paramId, value));
  }
  /**
   * Start a gizmo/numeric gesture: live writes, ONE undo step on commit (see gesture.ts). Pass `onEnd` to run
   * cleanup (e.g. scheduler.endInteraction) when the gesture is committed or cancelled.
   */
  beginGesture(label: string, hooks: { onEnd?: () => void } = {}): ParamGesture {
    return new GraphGesture(this.graph, this.stack, label, hooks);
  }
  moveNodes(moves: Map<string, [number, number]>): void {
    this.stack.execute(new MoveNodesCommand(this.graph, moves));
  }
  setSettings(patch: Partial<GraphSettings>): void {
    this.stack.execute(new SetSettingsCommand(this.graph, patch));
  }
  setNodeField<K extends 'name' | 'bypass' | 'comment'>(nodeId: string, field: K, value: NodeData[K]): void {
    this.stack.execute(new SetNodeFieldCommand(this.graph, nodeId, field, value));
  }
  /** Undoable edit of the editor annotations (frames, notes, reroutes, node UI state, bookmarks). */
  annotate(label: string, mutate: (a: GraphAnnotations) => void, mergeKey?: string): void {
    this.stack.execute(new AnnotationsCommand(this.graph, label, mutate, mergeKey));
  }
  /** Duplicate nodes (and links between them) as one undo step. Returns the new ids in input order. */
  duplicate(ids: string[], offset: [number, number] = [40, 40]): string[] {
    return this.stack.transaction('Duplicate', () => {
      const map = new Map<string, string>();
      for (const id of ids) {
        const n = this.graph.nodes.get(id);
        if (!n) continue;
        map.set(id, this.addNode(n.type, { x: n.x + offset[0], y: n.y + offset[1], name: n.name, params: deepClone(n.params) }));
      }
      for (const l of [...this.graph.links.values()]) {
        const a = map.get(l.from.node);
        const b = map.get(l.to.node);
        if (a && b) this.connect({ node: a, pin: l.from.pin }, { node: b, pin: l.to.pin });
      }
      return ids.map((i) => map.get(i)!).filter(Boolean);
    });
  }
}

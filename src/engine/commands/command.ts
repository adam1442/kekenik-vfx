import { Emitter } from '../../shared/emitter';

/**
 * Command pattern with transactions and coalescing.
 *  - A Command knows how to do() and undo() itself; do() must be repeatable (redo).
 *  - Coalescing: consecutive commands with the same `mergeKey` within `coalesceMs` merge into ONE undo step
 *    (dragging a slider = one entry). The command being merged INTO decides via mergeWith(next).
 *  - Transactions: begin(label) ... commit() groups several commands into one undo step (nestable).
 */
export interface Command {
  readonly label: string;
  do(): void;
  undo(): void;
  /** Commands with equal keys may be merged. */
  readonly mergeKey?: string;
  /** Absorb `next` (already executed). Return true when merged. */
  mergeWith?(next: Command): boolean;
}

export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    readonly commands: Command[],
  ) {}
  do(): void {
    for (const c of this.commands) c.do();
  }
  undo(): void {
    for (let i = this.commands.length - 1; i >= 0; i--) this.commands[i].undo();
  }
}

interface Entry {
  cmd: Command;
  time: number;
  sealed: boolean;
}

export class CommandStack {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private txn: { label: string; cmds: Command[] }[] = [];
  private cleanMarker: Entry | null = null;
  readonly onChange = new Emitter<void>();
  limit = 500;
  coalesceMs = 600;
  /** Injected clock for tests. */
  now: () => number = () => performance.now();

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.cmd.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.cmd.label;
  }
  get inTransaction(): boolean {
    return this.txn.length > 0;
  }
  get isDirty(): boolean {
    return (this.undoStack[this.undoStack.length - 1] ?? null) !== this.cleanMarker;
  }

  /** Execute a command (do it now) and record it. */
  execute(cmd: Command): void {
    cmd.do();
    if (this.txn.length) {
      this.txn[this.txn.length - 1].cmds.push(cmd);
      return;
    }
    this.redoStack = [];
    const top = this.undoStack[this.undoStack.length - 1];
    const t = this.now();
    if (top && !top.sealed && cmd.mergeKey !== undefined && top.cmd.mergeKey === cmd.mergeKey && t - top.time < this.coalesceMs && top.cmd.mergeWith?.(cmd)) {
      top.time = t;
    } else {
      this.undoStack.push({ cmd, time: t, sealed: false });
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.onChange.emit();
  }

  /** Stop merging into the latest entry (call on pointer-up / commit of an interaction). */
  sealTop(): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top) top.sealed = true;
  }

  begin(label: string): void {
    this.txn.push({ label, cmds: [] });
  }
  commit(): void {
    const t = this.txn.pop();
    if (!t) throw new Error('commit() without begin()');
    if (this.txn.length) {
      this.txn[this.txn.length - 1].cmds.push(new CompositeCommand(t.label, t.cmds));
      return;
    }
    if (t.cmds.length === 0) return;
    this.redoStack = [];
    this.undoStack.push({ cmd: t.cmds.length === 1 ? t.cmds[0] : new CompositeCommand(t.label, t.cmds), time: this.now(), sealed: true });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.onChange.emit();
  }
  /** Undo everything done in the open transaction and discard it. */
  abort(): void {
    const t = this.txn.pop();
    if (!t) return;
    for (let i = t.cmds.length - 1; i >= 0; i--) t.cmds[i].undo();
  }
  /** Run `fn` as one undo step; aborts (rolls back) when it throws. */
  transaction<T>(label: string, fn: () => T): T {
    this.begin(label);
    try {
      const r = fn();
      this.commit();
      return r;
    } catch (e) {
      this.abort();
      throw e;
    }
  }

  undo(): boolean {
    if (this.txn.length) throw new Error('undo() during an open transaction');
    const e = this.undoStack.pop();
    if (!e) return false;
    e.cmd.undo();
    e.sealed = true;
    this.redoStack.push(e);
    this.onChange.emit();
    return true;
  }
  redo(): boolean {
    if (this.txn.length) throw new Error('redo() during an open transaction');
    const e = this.redoStack.pop();
    if (!e) return false;
    e.cmd.do();
    this.undoStack.push(e);
    this.onChange.emit();
    return true;
  }
  markSaved(): void {
    this.sealTop();
    this.cleanMarker = this.undoStack[this.undoStack.length - 1] ?? null;
    this.onChange.emit();
  }
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.txn = [];
    this.cleanMarker = null;
    this.onChange.emit();
  }
}

import { Emitter } from '../shared/emitter';
import { consoleBus } from '../shared/log';
import { isTextInput } from '../ui/core/dom';
import { Keymap, formatChord } from './keymap';

export interface Command {
  id: string;
  title: string;
  category: string;
  icon?: string;
  /** Default chords (see keymap.ts); users can rebind them. */
  keys?: string[];
  run(arg?: unknown): void | Promise<void>;
  enabled?(): boolean;
  /** Hide from the command palette / keymap dialog (internal). */
  hidden?: boolean;
  /** Fire even while a text field has focus (e.g. Escape-like or Ctrl combos that are not text edits). */
  allowInInput?: boolean;
  description?: string;
}

/** Command registry + keyboard dispatcher. Menus, toolbar, palette and shortcuts all call `execute(id)`. */
export class CommandRegistry {
  readonly onChange = new Emitter<void>();
  readonly keymap = new Keymap();
  private cmds = new Map<string, Command>();
  private storageKey = 'kk-keymap';

  constructor() {
    try {
      this.keymap.load(JSON.parse(localStorage.getItem(this.storageKey) ?? 'null'));
    } catch {
      /* ignore */
    }
  }
  register(c: Command): () => void {
    this.cmds.set(c.id, c);
    this.keymap.setDefault(c.id, c.keys ?? []);
    this.onChange.emit();
    return () => {
      this.cmds.delete(c.id);
      this.onChange.emit();
    };
  }
  get(id: string): Command | undefined {
    return this.cmds.get(id);
  }
  list(): Command[] {
    return [...this.cmds.values()];
  }
  isEnabled(id: string): boolean {
    const c = this.cmds.get(id);
    return !!c && (c.enabled?.() ?? true);
  }
  async execute(id: string, arg?: unknown): Promise<void> {
    const c = this.cmds.get(id);
    if (!c || !this.isEnabled(id)) return;
    try {
      await c.run(arg);
    } catch (e) {
      consoleBus.error(`Command "${id}" failed: ${(e as Error).message}`, { source: 'app', detail: (e as Error).stack });
    }
  }
  /** Display text of the first chord of a command ("Ctrl+S"), '' when unbound. */
  shortcutOf(id: string): string {
    return formatChord(this.keymap.chordsOf(id)[0] ?? '');
  }
  rebind(id: string, chords: string[]): void {
    this.keymap.setChords(id, chords);
    this.persistKeymap();
    this.onChange.emit();
  }
  resetBinding(id: string): void {
    this.keymap.reset(id);
    this.persistKeymap();
    this.onChange.emit();
  }
  resetAllBindings(): void {
    this.keymap.resetAll();
    this.persistKeymap();
    this.onChange.emit();
  }
  private persistKeymap(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.keymap.toJSON()));
    } catch {
      /* ignore */
    }
  }
  /** Install the global keydown dispatcher. `suspended()` lets modal key-capture UIs pause it. */
  installKeyboard(suspended: () => boolean = () => false): void {
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.repeat && false || suspended()) return;
      const ids = this.keymap.resolve(e);
      if (!ids.length) return;
      const typing = isTextInput(e.target);
      for (const id of ids) {
        const c = this.cmds.get(id);
        if (!c || !this.isEnabled(id)) continue;
        // plain-key shortcuts must never steal typing; Ctrl/Meta combos for undo etc. only when marked
        if (typing && !c.allowInInput) continue;
        e.preventDefault();
        void this.execute(id);
        return;
      }
    });
  }
}

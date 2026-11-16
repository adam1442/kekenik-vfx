/**
 * Keymap: PURE logic (no DOM types needed except a structural KeyEventLike) so conflicts / normalisation are unit-testable.
 * A chord is a normalised string: modifiers in fixed order "Ctrl+Alt+Shift+Meta+Key", key names capitalised ("Z", "F5",
 * "Space", "Delete", "ArrowLeft", "/"). "Mod" means Ctrl on Windows/Linux and Cmd on macOS (resolved on input).
 */
export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MOD_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space', spacebar: 'Space', esc: 'Escape', del: 'Delete', return: 'Enter', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  plus: '+', control: 'Ctrl', cmd: 'Meta', command: 'Meta', option: 'Alt', win: 'Meta',
};

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

function keyName(k: string): string {
  const lower = k.toLowerCase();
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (k.length === 1) return k.toUpperCase();
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/** "ctrl+shift+z", "Mod+Z" -> "Ctrl+Shift+Z". Returns '' for an invalid chord (no key). */
export function normalizeChord(chord: string, mac = isMac()): string {
  const parts = chord.split(/\+(?=.)/).map((s) => s.trim()).filter(Boolean);
  const mods = new Set<string>();
  let key = '';
  for (const raw of parts) {
    const n = raw.toLowerCase() === 'mod' ? (mac ? 'Meta' : 'Ctrl') : keyName(raw);
    if ((MOD_ORDER as readonly string[]).includes(n)) mods.add(n);
    else key = n;
  }
  if (!key) return '';
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join('+');
}

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);
export const isModifierOnly = (e: KeyEventLike): boolean => MODIFIER_KEYS.has(e.key);

export function eventToChord(e: KeyEventLike): string {
  if (isModifierOnly(e)) return '';
  let key = e.key;
  // Shift+digit etc. produce symbols; prefer the physical key for letters/digits so "Ctrl+Shift+Z" stays stable.
  if (e.code) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
    else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  }
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  return [...mods, keyName(key)].join('+');
}

/** Human readable chord ("Ctrl+Shift+Z" -> "Ctrl+Shift+Z", mac -> symbols). */
export function formatChord(chord: string, mac = isMac()): string {
  if (!chord) return '';
  if (!mac) return chord;
  return chord.replace('Ctrl+', '⌃').replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Meta+', '⌘');
}

export interface KeyConflict {
  chord: string;
  commands: string[];
}

export class Keymap {
  /** commandId -> chords (effective). */
  private bindings = new Map<string, string[]>();
  private defaults = new Map<string, string[]>();
  private overrides = new Map<string, string[]>();

  constructor(private mac = isMac()) {}

  /** Register a command's default chords. */
  setDefault(commandId: string, chords: string[]): void {
    const n = chords.map((c) => normalizeChord(c, this.mac)).filter(Boolean);
    this.defaults.set(commandId, n);
    this.refresh(commandId);
  }
  private refresh(commandId: string): void {
    this.bindings.set(commandId, this.overrides.get(commandId) ?? this.defaults.get(commandId) ?? []);
  }
  chordsOf(commandId: string): string[] {
    return this.bindings.get(commandId) ?? [];
  }
  isCustomized(commandId: string): boolean {
    return this.overrides.has(commandId);
  }
  /** Replace the chords of a command (user rebinding). */
  setChords(commandId: string, chords: string[]): void {
    const n = chords.map((c) => normalizeChord(c, this.mac)).filter(Boolean);
    this.overrides.set(commandId, n);
    this.refresh(commandId);
  }
  reset(commandId: string): void {
    this.overrides.delete(commandId);
    this.refresh(commandId);
  }
  resetAll(): void {
    this.overrides.clear();
    for (const k of this.defaults.keys()) this.refresh(k);
  }
  /** Commands bound to a chord. */
  commandsFor(chord: string): string[] {
    const out: string[] = [];
    for (const [id, cs] of this.bindings) if (cs.includes(chord)) out.push(id);
    return out;
  }
  /** Other commands that already use `chord` (for the rebinding dialog). */
  conflictsWith(commandId: string, chord: string): string[] {
    return this.commandsFor(chord).filter((c) => c !== commandId);
  }
  /** Every chord bound to more than one command. */
  conflicts(): KeyConflict[] {
    const byChord = new Map<string, string[]>();
    for (const [id, cs] of this.bindings) for (const c of new Set(cs)) byChord.set(c, [...(byChord.get(c) ?? []), id]);
    return [...byChord].filter(([, ids]) => ids.length > 1).map(([chord, commands]) => ({ chord, commands }));
  }
  /** Chord that triggers this event, resolved to a command id (first match; conflicts are reported elsewhere). */
  resolve(e: KeyEventLike): string[] {
    const chord = eventToChord(e);
    return chord ? this.commandsFor(chord) : [];
  }
  toJSON(): Record<string, string[]> {
    return Object.fromEntries(this.overrides);
  }
  load(data: unknown): void {
    this.overrides.clear();
    if (data && typeof data === 'object') {
      for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        if (Array.isArray(v) && v.every((x) => typeof x === 'string')) this.overrides.set(k, v.map((c) => normalizeChord(c, this.mac)).filter(Boolean));
      }
    }
    for (const k of new Set([...this.defaults.keys(), ...this.overrides.keys()])) this.refresh(k);
  }
}

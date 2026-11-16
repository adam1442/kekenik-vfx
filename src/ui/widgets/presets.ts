import type { CurveValue, GradientValue } from '../../engine/params/schema';
import { Emitter } from '../../shared/emitter';

/**
 * Preset libraries with FOLDERS for curves and gradients. Shareable as JSON files
 * ({format:'kekenik-presets', kind, version:1, folders:[{name, items:[{name, value}]}]}), persisted in localStorage
 * (`kk-presets-curve`, `kk-presets-gradient`). A read-only "Factory" set is built in. Pure logic: the storage object is
 * injected so it can be unit-tested.
 */
export interface PresetItem<T> {
  id: string;
  name: string;
  value: T;
}
export interface PresetFolder<T> {
  id: string;
  name: string;
  items: PresetItem<T>[];
  /** Built-in folders cannot be edited. */
  readonly?: boolean;
}
export type PresetKind = 'curve' | 'gradient';
export interface PresetFile<T> {
  format: 'kekenik-presets';
  version: 1;
  kind: PresetKind;
  folders: { name: string; items: { name: string; value: T }[] }[];
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

let counter = 0;
const uid = (): string => `p${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;

export class PresetLibrary<T> {
  readonly onChange = new Emitter<void>();
  private user: PresetFolder<T>[] = [];

  constructor(
    readonly kind: PresetKind,
    private builtin: PresetFolder<T>[],
    private storage: StorageLike | null,
    private key: string,
    private validate: (v: unknown) => T | null,
  ) {
    this.load();
  }

  /** Factory folders first, then the user's. */
  folders(): PresetFolder<T>[] {
    return [...this.builtin, ...this.user];
  }
  private load(): void {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      this.user = this.parseFile(raw, false).folders;
    } catch {
      this.user = [];
    }
  }
  private save(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.toFile(this.user)));
    } catch {
      /* quota / private mode: presets stay in memory */
    }
    this.onChange.emit();
  }
  private toFile(folders: PresetFolder<T>[]): PresetFile<T> {
    return { format: 'kekenik-presets', version: 1, kind: this.kind, folders: folders.map((f) => ({ name: f.name, items: f.items.map((i) => ({ name: i.name, value: i.value })) })) };
  }
  private parseFile(text: string, markReadonly: boolean): { folders: PresetFolder<T>[]; count: number } {
    const o = JSON.parse(text) as Partial<PresetFile<unknown>>;
    if (o.format !== 'kekenik-presets' || o.kind !== this.kind || !Array.isArray(o.folders)) throw new Error(`Not a ${this.kind} preset file`);
    let count = 0;
    const folders: PresetFolder<T>[] = [];
    for (const f of o.folders) {
      const items: PresetItem<T>[] = [];
      for (const it of f.items ?? []) {
        const v = this.validate(it.value);
        if (v && typeof it.name === 'string') {
          items.push({ id: uid(), name: it.name, value: v });
          count++;
        }
      }
      folders.push({ id: uid(), name: String(f.name ?? 'Imported'), items, readonly: markReadonly || undefined });
    }
    return { folders, count };
  }

  private userFolder(id: string): PresetFolder<T> | undefined {
    return this.user.find((f) => f.id === id);
  }
  addFolder(name: string): PresetFolder<T> {
    const f: PresetFolder<T> = { id: uid(), name: name.trim() || 'New folder', items: [] };
    this.user.push(f);
    this.save();
    return f;
  }
  renameFolder(id: string, name: string): void {
    const f = this.userFolder(id);
    if (f && name.trim()) {
      f.name = name.trim();
      this.save();
    }
  }
  deleteFolder(id: string): void {
    const n = this.user.length;
    this.user = this.user.filter((f) => f.id !== id);
    if (n !== this.user.length) this.save();
  }
  /** Adds a preset (deep-copied) to a user folder; falls back to the first user folder (created when missing). */
  addPreset(folderId: string | null, name: string, value: T): PresetItem<T> {
    let f = folderId ? this.userFolder(folderId) : undefined;
    if (!f) f = this.user[0] ?? this.addFolder('My presets');
    const item: PresetItem<T> = { id: uid(), name: name.trim() || 'Preset', value: JSON.parse(JSON.stringify(value)) as T };
    f.items.push(item);
    this.save();
    return item;
  }
  renamePreset(id: string, name: string): void {
    for (const f of this.user) {
      const it = f.items.find((i) => i.id === id);
      if (it && name.trim()) {
        it.name = name.trim();
        this.save();
      }
    }
  }
  deletePreset(id: string): void {
    for (const f of this.user) {
      const n = f.items.length;
      f.items = f.items.filter((i) => i.id !== id);
      if (n !== f.items.length) this.save();
    }
  }
  movePreset(id: string, toFolderId: string): void {
    const to = this.userFolder(toFolderId);
    if (!to) return;
    for (const f of this.user) {
      const it = f.items.find((i) => i.id === id);
      if (it && f !== to) {
        f.items = f.items.filter((i) => i !== it);
        to.items.push(it);
        this.save();
        return;
      }
    }
  }
  /** JSON text of one folder (or all user folders). */
  exportJson(folderId?: string): string {
    const all = this.folders();
    return JSON.stringify(this.toFile(folderId ? all.filter((f) => f.id === folderId) : this.user), null, 1);
  }
  /** Imports a preset file as new user folders; returns the number of presets read. Throws on a wrong file. */
  importJson(text: string): number {
    const { folders, count } = this.parseFile(text, false);
    this.user.push(...folders);
    this.save();
    return count;
  }
}

/* ------------------------------------------------------------------------------------------------ factory content */
const fid = (s: string): string => `factory:${s}`;
const item = <T>(name: string, value: T): PresetItem<T> => ({ id: fid(name), name, value });
const k = (x: number, y: number, mode?: 'smooth' | 'linear' | 'step', t?: number): CurveValue['keys'][number] => ({ x, y, ...(mode ? { mode } : {}), ...(t !== undefined ? { tin: t, tout: t } : {}) });

export const FACTORY_CURVES: PresetFolder<CurveValue>[] = [
  {
    id: fid('basic'),
    name: 'Factory / Basic',
    readonly: true,
    items: [
      item('Linear', { keys: [k(0, 0), k(1, 1)] }),
      item('Invert', { keys: [k(0, 1, 'linear'), k(1, 0)] }),
      item('Smooth step', { keys: [k(0, 0, 'smooth', 0), k(1, 1, 'smooth', 0)] }),
      item('Ease in', { keys: [k(0, 0, 'smooth', 0), k(1, 1, 'smooth', 2)] }),
      item('Ease out', { keys: [k(0, 0, 'smooth', 2), k(1, 1, 'smooth', 0)] }),
    ],
  },
  {
    id: fid('contrast'),
    name: 'Factory / Contrast',
    readonly: true,
    items: [
      item('Soft S', { keys: [k(0, 0), k(0.25, 0.14), k(0.75, 0.86), k(1, 1)] }),
      item('Strong S', { keys: [k(0, 0), k(0.35, 0.06), k(0.65, 0.94), k(1, 1)] }),
      item('Lift shadows', { keys: [k(0, 0), k(0.2, 0.5), k(1, 1)] }),
      item('Crush shadows', { keys: [k(0, 0), k(0.5, 0.15), k(1, 1)] }),
      item('Cut dark', { keys: [k(0, 0, 'linear'), k(0.4, 0, 'linear'), k(1, 1)] }),
    ],
  },
  {
    id: fid('shapes'),
    name: 'Factory / Shaping',
    readonly: true,
    items: [
      item('Hump', { keys: [k(0, 0), k(0.5, 1), k(1, 0)] }),
      item('Ridge (V)', { keys: [k(0, 0, 'linear'), k(0.5, 1, 'linear'), k(1, 0)] }),
      item('Valley', { keys: [k(0, 1, 'linear'), k(0.5, 0, 'linear'), k(1, 1)] }),
      item('Fade out tail', { keys: [k(0, 1), k(0.4, 0.55), k(1, 0)] }),
      item('Pulse', { keys: [k(0, 0, 'linear'), k(0.1, 1, 'linear'), k(0.3, 0.2), k(1, 0)] }),
    ],
  },
  {
    id: fid('steps'),
    name: 'Factory / Steps',
    readonly: true,
    items: [
      item('Posterize 3', { keys: [k(0, 0, 'step'), k(0.34, 0.5, 'step'), k(0.67, 1, 'step'), k(1, 1)] }),
      item('Posterize 5', { keys: [k(0, 0, 'step'), k(0.2, 0.25, 'step'), k(0.4, 0.5, 'step'), k(0.6, 0.75, 'step'), k(0.8, 1, 'step'), k(1, 1)] }),
      item('Threshold 50%', { keys: [k(0, 0, 'step'), k(0.5, 1, 'step'), k(1, 1)] }),
    ],
  },
];

const gs = (interp: GradientValue['interp'], ...stops: [number, number, number, number, number][]): GradientValue => ({ interp, stops: stops.map(([pos, r, g, b, a]) => ({ pos, color: [r, g, b, a] })) });
export const FACTORY_GRADIENTS: PresetFolder<GradientValue>[] = [
  {
    id: fid('g-vfx'),
    name: 'Factory / VFX',
    readonly: true,
    items: [
      item('Fire', gs('oklab', [0, 0, 0, 0, 1], [0.25, 0.12, 0.005, 0, 1], [0.55, 1, 0.16, 0.004, 1], [0.8, 1, 0.65, 0.05, 1], [1, 1, 0.95, 0.6, 1])),
      item('Magma', gs('oklab', [0, 0, 0, 0.01, 1], [0.35, 0.3, 0.02, 0.12, 1], [0.7, 1, 0.2, 0.03, 1], [1, 1, 0.85, 0.4, 1])),
      item('Energy', gs('oklab', [0, 0, 0.02, 0.2, 1], [0.5, 0.1, 0.5, 1, 1], [1, 0.9, 1, 1, 1])),
      item('Toxic', gs('oklab', [0, 0.02, 0, 0.05, 1], [0.5, 0.05, 0.7, 0.05, 1], [1, 0.9, 1, 0.2, 1])),
      item('Ice', gs('oklab', [0, 0, 0.01, 0.06, 1], [0.5, 0.02, 0.3, 0.9, 1], [1, 0.8, 0.95, 1, 1])),
    ],
  },
  {
    id: fid('g-alpha'),
    name: 'Factory / Alpha',
    readonly: true,
    items: [
      item('Smoke alpha', gs('smooth', [0, 0.02, 0.02, 0.025, 0], [0.35, 0.1, 0.1, 0.11, 0.7], [1, 0.6, 0.6, 0.62, 1])),
      item('Fade out', gs('linear', [0, 1, 1, 1, 1], [1, 1, 1, 1, 0])),
      item('Soft pulse', gs('smooth', [0, 1, 1, 1, 0], [0.5, 1, 1, 1, 1], [1, 1, 1, 1, 0])),
    ],
  },
  {
    id: fid('g-basic'),
    name: 'Factory / Basic',
    readonly: true,
    items: [
      item('Black to white', gs('linear', [0, 0, 0, 0, 1], [1, 1, 1, 1, 1])),
      item('Rainbow', gs('oklab', [0, 1, 0, 0, 1], [0.2, 1, 0.6, 0, 1], [0.4, 0.1, 1, 0.05, 1], [0.6, 0, 0.7, 1, 1], [0.8, 0.2, 0.05, 1, 1], [1, 1, 0, 0.5, 1])),
      item('Sunset', gs('oklab', [0, 0.02, 0.02, 0.12, 1], [0.4, 0.5, 0.05, 0.25, 1], [0.7, 1, 0.3, 0.05, 1], [1, 1, 0.8, 0.3, 1])),
    ],
  },
];

export function validateCurve(v: unknown): CurveValue | null {
  const keys = (v as CurveValue | null)?.keys;
  if (!Array.isArray(keys) || keys.length < 1 || !keys.every((q) => Number.isFinite(q?.x) && Number.isFinite(q?.y))) return null;
  return { keys: [...keys].sort((a, b) => a.x - b.x) };
}
export function validateGradient(v: unknown): GradientValue | null {
  const g = v as GradientValue | null;
  if (!Array.isArray(g?.stops) || g.stops.length < 1 || !g.stops.every((s) => Number.isFinite(s?.pos) && Array.isArray(s.color) && s.color.length === 4)) return null;
  return g;
}

const ls = (): StorageLike | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
let curveLib: PresetLibrary<CurveValue> | null = null;
let gradLib: PresetLibrary<GradientValue> | null = null;
export const curvePresets = (): PresetLibrary<CurveValue> => (curveLib ??= new PresetLibrary('curve', FACTORY_CURVES, ls(), 'kk-presets-curve', validateCurve));
export const gradientPresets = (): PresetLibrary<GradientValue> => (gradLib ??= new PresetLibrary('gradient', FACTORY_GRADIENTS, ls(), 'kk-presets-gradient', validateGradient));

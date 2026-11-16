import { consoleBus } from '../../shared/log';
import { unwrapIntegrity } from './integrity';

/** Autosave interface + implementations. The engine only needs `AutosaveBackend`; tests use MemoryAutosave. */
export interface AutosaveBackend {
  save(slot: string, json: string): Promise<void>;
  load(slot: string): Promise<string | null>;
  remove(slot: string): Promise<void>;
  list(): Promise<{ slot: string; modified: number; size: number }[]>;
}

export class MemoryAutosave implements AutosaveBackend {
  readonly data = new Map<string, { json: string; modified: number }>();
  async save(slot: string, json: string): Promise<void> {
    this.data.set(slot, { json, modified: Date.now() });
  }
  async load(slot: string): Promise<string | null> {
    return this.data.get(slot)?.json ?? null;
  }
  async remove(slot: string): Promise<void> {
    this.data.delete(slot);
  }
  async list(): Promise<{ slot: string; modified: number; size: number }[]> {
    return [...this.data].map(([slot, v]) => ({ slot, modified: v.modified, size: v.json.length }));
  }
}

const DB_NAME = 'kekenik-vfx';
const STORE_AUTOSAVE = 'autosave';
const STORE_ASSETS = 'assets';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) db.createObjectStore(STORE_AUTOSAVE);
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}

export class IndexedDbAutosave implements AutosaveBackend {
  private dbp: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    return (this.dbp ??= openDb());
  }
  async save(slot: string, json: string): Promise<void> {
    await tx(await this.db(), STORE_AUTOSAVE, 'readwrite', (s) => s.put({ json, modified: Date.now() }, slot));
  }
  async load(slot: string): Promise<string | null> {
    const r = (await tx(await this.db(), STORE_AUTOSAVE, 'readonly', (s) => s.get(slot))) as { json: string } | undefined;
    return r?.json ?? null;
  }
  async remove(slot: string): Promise<void> {
    await tx(await this.db(), STORE_AUTOSAVE, 'readwrite', (s) => s.delete(slot));
  }
  async list(): Promise<{ slot: string; modified: number; size: number }[]> {
    const db = await this.db();
    const keys = (await tx(db, STORE_AUTOSAVE, 'readonly', (s) => s.getAllKeys())) as string[];
    const out: { slot: string; modified: number; size: number }[] = [];
    for (const k of keys) {
      const r = (await tx(db, STORE_AUTOSAVE, 'readonly', (s) => s.get(k))) as { json: string; modified: number };
      out.push({ slot: k, modified: r.modified, size: r.json.length });
    }
    return out;
  }
}

/** Binary asset blobs (imported textures / models) referenced from the project JSON by id. */
export interface AssetStore {
  put(id: string, blob: Blob): Promise<void>;
  get(id: string): Promise<Blob | null>;
  delete(id: string): Promise<void>;
}
export class MemoryAssetStore implements AssetStore {
  private m = new Map<string, Blob>();
  async put(id: string, blob: Blob): Promise<void> {
    this.m.set(id, blob);
  }
  async get(id: string): Promise<Blob | null> {
    return this.m.get(id) ?? null;
  }
  async delete(id: string): Promise<void> {
    this.m.delete(id);
  }
}
export class IndexedDbAssetStore implements AssetStore {
  private dbp: Promise<IDBDatabase> | null = null;
  private db(): Promise<IDBDatabase> {
    return (this.dbp ??= openDb());
  }
  async put(id: string, blob: Blob): Promise<void> {
    await tx(await this.db(), STORE_ASSETS, 'readwrite', (s) => s.put(blob, id));
  }
  async get(id: string): Promise<Blob | null> {
    return ((await tx(await this.db(), STORE_ASSETS, 'readonly', (s) => s.get(id))) as Blob | undefined) ?? null;
  }
  async delete(id: string): Promise<void> {
    await tx(await this.db(), STORE_ASSETS, 'readwrite', (s) => s.delete(id));
  }
}

/** Debounced autosaver: call notifyChanged() after every edit; it writes at most once per `debounceMs`. */
export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  lastSaved = 0;
  /** the previous good payload is kept in slot `<slot>.prev` so a write killed half way never destroys the only copy. */
  private lastJson: string | null = null;
  constructor(
    private backend: AutosaveBackend,
    private getJson: () => string,
    readonly slot = 'autosave',
    private debounceMs = 2000,
  ) {}
  setDelay(ms: number): void {
    this.debounceMs = ms;
  }
  notifyChanged(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.debounceMs);
  }
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.saving = this.saving.then(async () => {
      try {
        const json = this.getJson();
        if (this.lastJson) await this.backend.save(`${this.slot}.prev`, this.lastJson);
        await this.backend.save(this.slot, json);
        this.lastJson = json;
        this.lastSaved = Date.now();
      } catch (e) {
        consoleBus.error(`Autosave failed: ${(e as Error).message}`, { source: 'io' });
      }
    });
    return this.saving;
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/**
 * load an autosave slot with an integrity check; when the newest copy is damaged (killed while writing, quota) fall back to
 * the previous one. Returns null when neither exists / is readable. `source` tells which one was used.
 */
export async function loadAutosaveSafe(backend: AutosaveBackend, slot: string): Promise<{ json: string; source: 'primary' | 'backup' } | null> {
  for (const [name, source] of [[slot, 'primary'], [`${slot}.prev`, 'backup']] as const) {
    const raw = await backend.load(name).catch(() => null);
    if (!raw) continue;
    const un = unwrapIntegrity(raw);
    // legacy plain JSON has no checksum: at least make sure it parses (recovery path only, so the extra parse is fine)
    if (un.ok && !un.wrapped) {
      try {
        JSON.parse(raw);
      } catch {
        consoleBus.warn(`Autosave "${name}" is not valid JSON.`, { source: 'io' });
        continue;
      }
    }
    if (un.ok) return { json: raw, source };
    consoleBus.warn(`Autosave "${name}" is damaged (${un.reason}).`, { source: 'io' });
  }
  return null;
}

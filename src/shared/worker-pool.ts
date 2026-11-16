/**
 * LEGACY inline worker. Tiny inline worker for pure, self-contained CPU tasks (no dependencies, no module imports).
 *
 * Task functions are serialised with `Function.prototype.toString`, so they MUST NOT reference anything outside their own body.
 * When Workers are unavailable (tests, locked-down browsers) or the worker fails, the same function runs on the calling thread.
 *
 * Currently offloaded: big OBJ model imports (`parseObjOffThread` in engine/io/model.ts, same `objParseCore` code as the sync path) and
 * `parseJsonOffThread` (helper for big JSON payloads). CPU mesh *node* evaluation is NOT in a worker yet (mesh nodes depend on the
 * whole node registry).
 */
export type TaskFn<A, R> = (arg: A) => R;

/** Self-contained: JSON.parse wrapper returning a tagged result so errors survive the structured clone. */
export function jsonParseTask(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export class TaskWorker<A, R> {
  private worker: Worker | null = null;
  private url: string | null = null;
  private pending = new Map<number, { res: (r: R) => void; rej: (e: Error) => void }>();
  private seq = 0;
  private broken = false;

  constructor(private fn: TaskFn<A, R>) {}

  private ensure(): Worker | null {
    if (this.broken || typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    if (this.worker) return this.worker;
    try {
      const src = `const fn = (${this.fn.toString()});\nself.onmessage = (e) => { const { id, arg } = e.data; try { self.postMessage({ id, ok: true, value: fn(arg) }); } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); } };`;
      this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const w = new Worker(this.url);
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: R; error?: string }>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        if (e.data.ok) p.res(e.data.value as R);
        else p.rej(new Error(e.data.error));
      };
      w.onerror = () => this.fail();
      this.worker = w;
      return w;
    } catch {
      this.broken = true;
      return null;
    }
  }

  private fail(): void {
    this.broken = true;
    const pend = [...this.pending.values()];
    this.pending.clear();
    this.dispose();
    for (const p of pend) p.rej(new Error('worker failed'));
  }

  /** Run on the worker; falls back to the calling thread when no worker is available or it fails. */
  async run(arg: A): Promise<R> {
    const w = this.ensure();
    if (!w) return this.fn(arg);
    try {
      return await new Promise<R>((res, rej) => {
        const id = ++this.seq;
        this.pending.set(id, { res, rej });
        w.postMessage({ id, arg });
      });
    } catch {
      return this.fn(arg);
    }
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
  }
}


/** Parse JSON; texts above `thresholdChars` go to a worker so a 50 MB project does not freeze the UI. Throws on invalid JSON. */
export async function parseJsonOffThread(text: string, thresholdChars = 2_000_000): Promise<unknown> {
  const r = text.length < thresholdChars ? jsonParseTask(text) : ((await (await import('../workers')).getPool().submit('json.parse', text, [], { key: 'json-parse' })) as ReturnType<typeof jsonParseTask>);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

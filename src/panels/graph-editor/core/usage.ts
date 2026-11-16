/**
 * Node usage statistics: persisted counters that power the "Suggested" section of the node search popup, especially
 * when a link is dragged off a pin ("what do I usually put after a Gray output?").
 * Context keys: 'any' | 'out:<pinType>' (dragged from an output) | 'in:<pinType>' (dragged from an input).
 */
export interface UsageData {
  global: Record<string, number>;
  ctx: Record<string, Record<string, number>>;
  last: Record<string, number>;
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'kk-node-usage';

export class UsageStats {
  data: UsageData = { global: {}, ctx: {}, last: {} };
  private clock = 0;
  constructor(private storage: StorageLike | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    try {
      const raw = storage?.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw) as Partial<UsageData>;
        this.data = { global: d.global ?? {}, ctx: d.ctx ?? {}, last: d.last ?? {} };
        this.clock = Math.max(0, ...Object.values(this.data.last));
      }
    } catch {
      /* corrupt stats are not worth failing for */
    }
  }
  record(type: string, ctx = 'any'): void {
    const d = this.data;
    d.global[type] = (d.global[type] ?? 0) + 1;
    if (ctx !== 'any') {
      (d.ctx[ctx] ??= {})[type] = (d.ctx[ctx][type] ?? 0) + 1;
    }
    d.last[type] = ++this.clock;
    // Keep the table bounded: halve everything when it grows large (old habits fade).
    const total = Object.values(d.global).reduce((a, b) => a + b, 0);
    if (total > 2000) {
      for (const k of Object.keys(d.global)) d.global[k] = Math.floor(d.global[k] / 2);
      for (const c of Object.values(d.ctx)) for (const k of Object.keys(c)) c[k] = Math.floor(c[k] / 2);
    }
    try {
      this.storage?.setItem(KEY, JSON.stringify(d));
    } catch {
      /* quota */
    }
  }
  score(type: string, ctx = 'any'): number {
    const d = this.data;
    const recency = d.last[type] ? 1 + (d.last[type] - (this.clock - 20)) / 20 : 0; // last 20 uses weigh in
    return (ctx !== 'any' ? (d.ctx[ctx]?.[type] ?? 0) * 4 : 0) + (d.global[type] ?? 0) + Math.max(0, recency);
  }
  /** Candidates ordered by usefulness; only those with a positive score are "suggestions". */
  suggest(candidates: string[], ctx = 'any', limit = 6): string[] {
    return candidates
      .map((c) => [c, this.score(c, ctx)] as const)
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([c]) => c);
  }
}

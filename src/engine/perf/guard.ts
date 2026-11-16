import type { Engine } from '../engine';
import { consoleBus } from '../../shared/log';
import { t } from '../../shared/i18n';

/**
 * MemoryGuard: graceful recovery from memory pressure.
 *
 * Triggered by `MemoryManager.onPressure` (budget exceeded after eviction, or the device reported an out-of-memory error scope).
 * Escalation (rate limited, at most one step per `cooldownMs`):
 *   level 1  drop the playback frame cache + the output cache + idle pools, re-render
 *   level 2+ additionally halve the preview resolution (floor 12.5%) and tell the user
 * The level decays back to 0 after `calmMs` without pressure. The user can always raise the quality again in Settings.
 */
export interface GuardHooks {
  getPreview(): number;
  setPreview(v: number): void;
  notify(message: string, level: 'info' | 'warn'): void;
}

export class MemoryGuard {
  level = 0;
  lastAction = Number.NEGATIVE_INFINITY;
  actions = 0;
  cooldownMs = 4000;
  calmMs = 60_000;
  private unsub: (() => void) | null = null;

  constructor(
    private engine: Engine,
    private hooks: GuardHooks,
    private now: () => number = () => performance.now(),
  ) {}

  attach(): void {
    this.unsub?.();
    this.unsub = this.engine.mm.onPressure.on((p) => this.handle(p.kind));
  }
  detach(): void {
    this.unsub?.();
    this.unsub = null;
  }

  /** Public for tests. Returns the action taken ('none' while cooling down). */
  handle(kind: 'budget' | 'device-oom'): 'none' | 'drop-caches' | 'reduce-preview' {
    const now = this.now();
    if (now - this.lastAction > this.calmMs) this.level = 0;
    if (now - this.lastAction < this.cooldownMs) return 'none';
    this.lastAction = now;
    this.level++;
    this.actions++;
    const e = this.engine;
    e.scheduler.dropFrameCache();
    e.evaluator.cache.clear();
    e.mm.reclaim(Math.max(e.mm.usedBytes * 0.5, 64 * 1024 ** 2));
    consoleBus.warn(`Memory pressure (${kind}): recovery level ${this.level}.`, { source: 'gpu' });
    let result: 'drop-caches' | 'reduce-preview' = 'drop-caches';
    if (this.level >= 2 || kind === 'device-oom') {
      const next = Math.max(0.125, this.hooks.getPreview() * 0.5);
      this.hooks.setPreview(next);
      e.scheduler.interactionScale = Math.min(e.scheduler.interactionScale, next);
      this.hooks.notify(t('oom.reduced', { pct: Math.round(next * 100) }), 'warn');
      result = 'reduce-preview';
    } else this.hooks.notify(t('oom.dropped'), 'info');
    e.scheduler.invalidate();
    return result;
  }
}

/**
 * Adaptive preview-resolution controller.
 *
 * While the user drags a parameter the scheduler renders at a reduced resolution. This controller picks that resolution so the
 * evaluation stays inside a time budget (default 8 ms) on THIS machine and THIS graph.
 *
 * Model: cost(scale) ~= c * scale^2 (fill-rate bound). `c` is tracked with an exponential moving average of ms / scale^2.
 * Choose the largest step with predicted cost <= budget * headroom. Going DOWN is immediate (a janky drag is worse than a blurry
 * one), going UP needs `upConfirm` consecutive cheap samples (hysteresis, no flip-flopping).
 * GPU timestamps are preferred; once one GPU sample arrived, CPU samples are ignored (CPU time includes pipeline compiles / awaits).
 */
export const SCALE_STEPS = [1, 0.75, 0.5, 0.375, 0.25, 0.125] as const;

export interface AdaptiveOptions {
  budgetMs: number;
  /** Fraction of the budget the prediction must fit into. */
  headroom: number;
  minScale: number;
  maxScale: number;
  /** EMA weight of a new sample. */
  alpha: number;
  upConfirm: number;
}

export const DEFAULT_ADAPTIVE: AdaptiveOptions = { budgetMs: 8, headroom: 0.85, minScale: 0.125, maxScale: 1, alpha: 0.35, upConfirm: 6 };

export class AdaptiveResolution {
  readonly opts: AdaptiveOptions;
  enabled = true;
  /** Current recommended scale (0..1). */
  scale: number;
  /** EMA of ms per unit of scale^2, or null before the first sample. */
  costPerArea: number | null = null;
  private haveGpu = false;
  private upVotes = 0;
  samples = 0;

  constructor(opts: Partial<AdaptiveOptions> = {}) {
    this.opts = { ...DEFAULT_ADAPTIVE, ...opts };
    this.scale = this.opts.maxScale;
  }

  setBudget(ms: number): void {
    this.opts.budgetMs = Math.max(1, ms);
  }

  reset(): void {
    this.costPerArea = null;
    this.haveGpu = false;
    this.upVotes = 0;
    this.samples = 0;
    this.scale = this.opts.maxScale;
  }

  /** Largest allowed step whose predicted cost fits `budget * headroom`. */
  pick(costPerArea: number): number {
    const limit = this.opts.budgetMs * this.opts.headroom;
    let best = this.opts.minScale;
    for (const s of SCALE_STEPS) {
      if (s > this.opts.maxScale || s < this.opts.minScale) continue;
      if (costPerArea * s * s <= limit) {
        best = s;
        break; // steps are sorted descending: the first that fits is the largest
      }
    }
    return Math.max(this.opts.minScale, Math.min(this.opts.maxScale, best));
  }

  /**
   * Feed one measurement of an evaluation that really ran nodes at `scaleUsed`.
   * Returns the (possibly new) recommended scale.
   */
  observe(ms: number, scaleUsed: number, kind: 'cpu' | 'gpu'): number {
    if (!this.enabled || !(ms >= 0) || !(scaleUsed > 0)) return this.scale;
    if (kind === 'gpu') {
      if (!this.haveGpu) {
        this.haveGpu = true;
        this.costPerArea = null; // forget CPU-derived numbers
      }
    } else if (this.haveGpu) return this.scale;
    const c = ms / (scaleUsed * scaleUsed);
    this.costPerArea = this.costPerArea === null ? c : this.costPerArea + (c - this.costPerArea) * this.opts.alpha;
    this.samples++;
    const target = this.pick(this.costPerArea);
    if (target < this.scale) {
      this.scale = target;
      this.upVotes = 0;
    } else if (target > this.scale) {
      if (++this.upVotes >= this.opts.upConfirm) {
        // climb one step at a time
        const idx = SCALE_STEPS.findIndex((s) => s <= this.scale);
        const up = SCALE_STEPS[Math.max(0, idx - 1)];
        this.scale = Math.min(target, up);
        this.upVotes = 0;
      }
    } else this.upVotes = 0;
    return this.scale;
  }
}

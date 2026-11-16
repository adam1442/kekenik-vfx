import { Emitter } from '../../shared/emitter';
import { consoleBus } from '../../shared/log';
import { delay } from '../../shared/util';
import { acquireGpuDevice, GpuUnavailableError, readEnv, describeEnv, type AcquireOptions, type AcquireResult } from './acquire';
import { buildCapabilityReport, type CapabilityReport } from './caps';

export { GpuUnavailableError };

export interface DeviceLostInfo {
  reason: string;
  message: string;
  willRecover: boolean;
}

/**
 * The ONE GPUDevice of the app. Everything (engine, viewport presenters, three.js) must read
 * `gpu.device` fresh (never cache it across awaits) because device-lost recovery replaces it.
 *
 * Recovery protocol: on a non-'destroyed' loss we request a new adapter/device, bump `generation`
 * and emit `onRestored`. Subscribers (MemoryManager, PipelineCache, PassRunner, Evaluator, caches)
 * drop every GPU object they own and rebuild lazily. CPU-side state (graph, params) is never lost.
 */
export class GpuContext {
  adapter!: GPUAdapter;
  caps!: CapabilityReport;
  /** Incremented on every (re)creation of the device. GPU resources remember the generation they belong to. */
  generation = 0;
  readonly onLost = new Emitter<DeviceLostInfo>();
  readonly onRestored = new Emitter<GpuContext>();
  readonly onUncapturedError = new Emitter<GPUError>();
  private _device!: GPUDevice;
  private recovering = false;
  private destroyedByUs = false;
  private simulating = false;

  get device(): GPUDevice {
    return this._device;
  }

  /** Result of the last acquisition (tier, attempts, adapter info) for the Diagnostics screen. */
  acquired!: AcquireResult;
  /** Options used for the acquisition: reused by recovery so a software/compat device is never "upgraded" mid-session. */
  private acquireOpts: AcquireOptions = {};
  /** Fired when recovery after a device loss failed for good (the app shows the Diagnostics screen, project stays in memory). */
  readonly onRecoveryFailed = new Emitter<GpuUnavailableError>();
  /** Fired for out-of-memory errors (captured or uncaptured). */
  readonly onOutOfMemory = new Emitter<string>();

  static async create(opts: AcquireOptions = {}): Promise<GpuContext> {
    const ctx = new GpuContext();
    await ctx.init(opts);
    return ctx;
  }

  /** Collect environment diagnostics for the Diagnostics screen (never throws). */
  static async diagnose(): Promise<string[]> {
    return describeEnv(readEnv(), []);
  }

  private async init(opts: AcquireOptions): Promise<void> {
    this.acquireOpts = { ...opts, onAttempt: undefined };
    const acq = await acquireGpuDevice(opts);
    this.adopt(acq);
  }

  private adopt(acq: AcquireResult): void {
    this.acquired = acq;
    this.adapter = acq.adapter;
    const device = acq.device;
    this._device = device;
    this.generation++;
    this.caps = buildCapabilityReport(acq.adapter, device, { tier: acq.tier, compat: acq.compat, software: acq.software, rungLabel: acq.rungLabel, attempts: acq.attempts });
    if (acq.tier !== 'A') consoleBus.warn(`GPU tier ${acq.tier}${acq.compat ? ' (compatibility mode)' : ''}${acq.software ? ' (software rendering)' : ''}: ${acq.rungLabel}`, { source: 'gpu' });
    device.addEventListener('uncapturederror', (ev) => {
      const err = (ev as GPUUncapturedErrorEvent).error;
      this.reportError(err, 'uncaptured');
    });
    void device.lost.then((info) => void this.handleLost(device, info));
  }

  /** Central error sink: logs to the Console (NEVER flips a global state) and classifies the error. */
  reportError(err: GPUError, where: string): void {
    const kind = typeof GPUOutOfMemoryError !== 'undefined' && err instanceof GPUOutOfMemoryError ? 'out-of-memory' : err.constructor?.name === 'GPUOutOfMemoryError' ? 'out-of-memory' : /Internal/i.test(err.constructor?.name ?? '') ? 'internal' : 'validation';
    consoleBus.error(`GPU ${kind} error (${where}): ${err.message}`, { source: 'gpu' });
    this.onUncapturedError.emit(err);
    if (kind === 'out-of-memory') this.onOutOfMemory.emit(err.message);
  }

  private async handleLost(lostDevice: GPUDevice, info: GPUDeviceLostInfo): Promise<void> {
    if (lostDevice !== this._device) return; // stale
    const willRecover = info.reason !== 'destroyed' || !this.destroyedByUs;
    consoleBus.error(`GPU device lost (${info.reason}): ${info.message}`, { source: 'gpu' });
    this.onLost.emit({ reason: info.reason, message: info.message, willRecover: info.reason !== 'destroyed' && willRecover });
    const simulated = this.simulating;
    this.simulating = false;
    if ((info.reason === 'destroyed' && !simulated) || this.recovering) return;
    this.recovering = true;
    try {
      for (let attempt = 1; attempt <= 3; attempt++) {
        await delay(150 * attempt);
        try {
          const acq = await acquireGpuDevice(this.acquireOpts);
          this.adopt(acq);
          consoleBus.info(`GPU device recovered (attempt ${attempt}, generation ${this.generation}).`, { source: 'gpu' });
          this.onRestored.emit(this);
          return;
        } catch (e) {
          consoleBus.warn(`Device recovery attempt ${attempt} failed: ${(e as Error).message}`, { source: 'gpu' });
        }
      }
      consoleBus.error('GPU device could not be recovered.', { source: 'gpu' });
      this.onRecoveryFailed.emit(new GpuUnavailableError('The GPU device was lost and could not be recreated.', describeEnv(readEnv(), this.acquired?.attempts ?? []), this.acquired?.attempts ?? []));
    } finally {
      this.recovering = false;
    }
  }

  /**
   * test hook: destroy the device and run the REAL recovery path (new adapter + device, generation++, onRestored).
   * Resolves when the app state was rebuilt (or rejects after `timeoutMs`). Used by the self-test "device-lost recovery".
   */
  simulateLoss(timeoutMs = 15000): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => (off(), reject(new Error(`device was not restored within ${timeoutMs} ms`))), timeoutMs);
      const off = this.onRestored.on(() => (clearTimeout(timer), off(), resolve()));
      this.simulating = true;
      this._device.destroy();
    });
  }

  /** Create a new device right now (used by the Diagnostics overlay after a failed recovery). Throws GpuUnavailableError. */
  async recoverNow(over: AcquireOptions = {}): Promise<void> {
    const acq = await acquireGpuDevice({ ...this.acquireOpts, ...over });
    this.acquireOpts = { ...this.acquireOpts, ...over, onAttempt: undefined };
    this.adopt(acq);
    this.onRestored.emit(this);
  }

  /** Status bar "Reset GPU": destroy the device and run the real recovery path (new device, pools / pipelines rebuilt, graph re-evaluated). */
  resetDevice(timeoutMs = 20000): Promise<void> {
    return this.simulateLoss(timeoutMs);
  }

  /** Test hook / shutdown: destroys the device WITHOUT triggering recovery. */
  destroy(): void {
    this.destroyedByUs = true;
    this._device.destroy();
  }

  /**
   * Run `fn` inside an error scope. Returns the captured error (or null). Use around anything that
   * can fail validation when you want to attribute the failure (compile, bind group creation, a node's passes).
   */
  async scope<T>(filter: GPUErrorFilter, fn: () => T | Promise<T>): Promise<{ result: T | undefined; error: GPUError | null; thrown?: unknown }> {
    const dev = this._device;
    dev.pushErrorScope(filter);
    let result: T | undefined;
    let thrown: unknown;
    try {
      result = await fn();
    } catch (e) {
      thrown = e;
    }
    const error = await dev.popErrorScope();
    return { result, error, thrown };
  }
}

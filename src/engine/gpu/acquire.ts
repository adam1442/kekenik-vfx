/**
 * Tiered WebGPU device acquisition. PURE: takes a `GPU`-like object, so it is unit-tested with a mocked
 * `navigator.gpu` (tests/gpu-acquire.test.ts). It NEVER throws for an unknown option and never reports "no GPU" because
 * of an over-ambitious `requestDevice` descriptor.
 *
 *  Tier A  standard adapters: requestAdapter({high-performance}) -> ({low-power}) -> ()      (device request = full ladder)
 *  Tier B  same adapters, but the device had to be requested with FEWER features / default limits (ladder rung > 0)
 *  Tier C  requestAdapter({ featureLevel: 'compatibility' })   (old / blocklisted GPUs, D3D11 / GLES back-ends)
 *  Tier D  requestAdapter({ forceFallbackAdapter: true })       (software adapter: slow but works)
 *
 * The reported `tier` is the tier at which the device was finally created ('A' when the very first attempt worked).
 * Device request ladder (per adapter): optional features + curated limits -> reduced features -> no features ->
 * default limits -> `requestDevice()` without descriptor. Because a failed `requestDevice` can consume the adapter
 * (spec: state "consumed"), a fresh adapter is requested with the same options before every further rung.
 */

export type GpuTier = 'A' | 'B' | 'C' | 'D';

/** Optional features: asked for only when the adapter reports them. Nothing else is ever required. */
export const OPTIONAL_FEATURES = [
  'shader-f16',
  'float32-filterable',
  'float32-blendable',
  'timestamp-query',
  'texture-compression-bc',
  'texture-compression-etc2',
  'texture-compression-astc',
  'rg11b10ufloat-renderable',
  'bgra8unorm-storage',
  'texture-formats-tier1',
  'core-features-and-limits',
] as const;

/** Features that are cheap and harmless: second rung of the ladder. */
export const REDUCED_FEATURES = ['float32-filterable', 'float32-blendable', 'rg11b10ufloat-renderable'] as const;

/**
 * Limits we actually benefit from. Each is requested as `min(adapter value, wanted cap)` — the adapter value is the only
 * thing guaranteed to be accepted, so we never ask for more than `adapter.limits` reports and never ask for limits
 * the adapter does not know (compat adapters / older browsers lack several names).
 */
export const WANTED_LIMITS: Record<string, number> = {
  maxTextureDimension2D: 16384,
  maxBufferSize: 2 ** 31,
  maxStorageBufferBindingSize: 2 ** 30,
  maxUniformBufferBindingSize: 65536,
  maxSampledTexturesPerShaderStage: 16,
  maxColorAttachmentBytesPerSample: 64,
  maxComputeInvocationsPerWorkgroup: 256,
  maxComputeWorkgroupSizeX: 256,
  maxComputeWorkgroupSizeY: 256,
  maxComputeWorkgroupStorageSize: 32768,
  maxComputeWorkgroupsPerDimension: 65535,
  maxStorageBuffersPerShaderStage: 8,
  maxBindGroups: 4,
};

export interface GpuAttempt {
  tier: GpuTier;
  /** e.g. `adapter(high-performance)`, `device(rung 2: no features)` */
  step: string;
  ok: boolean;
  message?: string;
}

export interface AdapterInfoLite {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  isFallback: boolean;
}

export interface AcquireResult {
  adapter: GPUAdapter;
  device: GPUDevice;
  tier: GpuTier;
  /** Rung of the device request ladder that worked (0 = everything we wanted). */
  rung: number;
  rungLabel: string;
  requestedFeatures: string[];
  requestedLimits: Record<string, number>;
  attempts: GpuAttempt[];
  /** The adapter options that produced this adapter (used again for device-lost recovery). */
  adapterOptions: Record<string, unknown> | undefined;
  adapterInfo: AdapterInfoLite;
  software: boolean;
  compat: boolean;
}

export class GpuUnavailableError extends Error {
  constructor(
    message: string,
    readonly diagnostics: string[],
    readonly attempts: GpuAttempt[] = [],
    readonly env: GpuEnvInfo = readEnv(),
  ) {
    super(message);
    this.name = 'GpuUnavailableError';
  }
}

export interface GpuEnvInfo {
  gpuApi: boolean;
  secureContext: boolean | null;
  inIframe: boolean;
  userAgent: string;
}

type GpuLike = Pick<GPU, 'requestAdapter'>;

export interface AcquireOptions {
  /** Override `navigator.gpu` (tests). */
  gpu?: GpuLike | null;
  /** Which tiers may be tried, in order. Default: A, C, D. */
  order?: Array<'A' | 'C' | 'D'>;
  /** Safe mode / "limited": skip the optimistic rungs and request a bare device. */
  bare?: boolean;
  /** Called after every attempt (Diagnostics screen shows progress). */
  onAttempt?: (a: GpuAttempt) => void;
}

export function readEnv(): GpuEnvInfo {
  let inIframe: boolean;
  try {
    inIframe = typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    inIframe = true; // cross-origin access throws: we are definitely framed
  }
  return {
    gpuApi: typeof navigator !== 'undefined' && !!(navigator as Navigator & { gpu?: unknown }).gpu,
    secureContext: typeof isSecureContext !== 'undefined' ? isSecureContext : null,
    inIframe,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a',
  };
}

const errMsg = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Limits clamped to what the adapter reports. Unknown names are skipped. */
export function clampLimits(adapterLimits: unknown, wanted: Record<string, number> = WANTED_LIMITS): Record<string, number> {
  const out: Record<string, number> = {};
  const src = (adapterLimits ?? {}) as Record<string, unknown>;
  for (const [name, want] of Object.entries(wanted)) {
    const have = src[name];
    if (typeof have !== 'number' || !Number.isFinite(have)) continue;
    out[name] = Math.min(have, want);
  }
  return out;
}

/** Only the features the adapter really offers. */
export function supportedFeatures(adapterFeatures: ReadonlySet<string> | undefined, wanted: readonly string[] = OPTIONAL_FEATURES): string[] {
  if (!adapterFeatures) return [];
  return wanted.filter((f) => adapterFeatures.has(f));
}

export function adapterInfoOf(adapter: GPUAdapter): AdapterInfoLite {
  const a = adapter as unknown as { info?: Partial<GPUAdapterInfo> & { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean };
  return {
    vendor: a.info?.vendor ?? '',
    architecture: a.info?.architecture ?? '',
    device: a.info?.device ?? '',
    description: a.info?.description ?? '',
    isFallback: Boolean(a.info?.isFallbackAdapter ?? a.isFallbackAdapter),
  };
}

interface Rung {
  label: string;
  features: string[];
  limits: Record<string, number>;
  descriptor: boolean;
}

function buildLadder(adapter: GPUAdapter, bare: boolean): Rung[] {
  const feats = supportedFeatures(adapter.features as unknown as ReadonlySet<string>);
  const reduced = supportedFeatures(adapter.features as unknown as ReadonlySet<string>, REDUCED_FEATURES);
  const limits = clampLimits(adapter.limits);
  const all: Rung[] = [
    { label: 'optional features + clamped limits', features: feats, limits, descriptor: true },
    { label: 'reduced features + clamped limits', features: reduced, limits, descriptor: true },
    { label: 'no features + clamped limits', features: [], limits, descriptor: true },
    { label: 'no features + default limits', features: [], limits: {}, descriptor: true },
    { label: 'no descriptor', features: [], limits: {}, descriptor: false },
  ];
  // drop rungs identical to the previous one (nothing to reduce)
  const out: Rung[] = [];
  for (const r of all) {
    const prev = out[out.length - 1];
    if (prev && prev.descriptor === r.descriptor && prev.features.join() === r.features.join() && JSON.stringify(prev.limits) === JSON.stringify(r.limits)) continue;
    out.push(r);
  }
  return bare ? out.slice(-2) : out;
}

async function safeRequestAdapter(gpu: GpuLike, options: Record<string, unknown> | undefined): Promise<{ adapter: GPUAdapter | null; error?: string }> {
  try {
    const adapter = await gpu.requestAdapter(options as GPURequestAdapterOptions | undefined);
    return { adapter };
  } catch (e) {
    // unknown options / dictionary members must never escape from here
    return { adapter: null, error: errMsg(e) };
  }
}

/** Acquire a device. Resolves with the best tier that works; rejects with GpuUnavailableError (with full attempt log) otherwise. */
export async function acquireGpuDevice(opts: AcquireOptions = {}): Promise<AcquireResult> {
  const attempts: GpuAttempt[] = [];
  const log = (a: GpuAttempt): void => {
    attempts.push(a);
    try {
      opts.onAttempt?.(a);
    } catch {
      /* UI callback must not break acquisition */
    }
  };
  const env = readEnv();
  const gpu: GpuLike | null = opts.gpu !== undefined ? opts.gpu : typeof navigator !== 'undefined' ? ((navigator as Navigator & { gpu?: GpuLike }).gpu ?? null) : null;
  if (!gpu) {
    log({ tier: 'A', step: 'navigator.gpu', ok: false, message: 'navigator.gpu is undefined' });
    throw new GpuUnavailableError('WebGPU is not available in this browser or context.', describeEnv(env, attempts), attempts, env);
  }
  log({ tier: 'A', step: 'navigator.gpu', ok: true });

  const order = opts.order ?? ['A', 'C', 'D'];
  const plans: Array<{ tier: 'A' | 'C' | 'D'; label: string; options: Record<string, unknown> | undefined }> = [];
  for (const tier of order) {
    if (tier === 'A') {
      plans.push({ tier, label: 'adapter(high-performance)', options: { powerPreference: 'high-performance' } });
      plans.push({ tier, label: 'adapter(low-power)', options: { powerPreference: 'low-power' } });
      plans.push({ tier, label: 'adapter(default)', options: undefined });
    } else if (tier === 'C') plans.push({ tier, label: 'adapter(compatibility)', options: { featureLevel: 'compatibility' } });
    else plans.push({ tier, label: 'adapter(software fallback)', options: { forceFallbackAdapter: true } });
  }

  const seenAdapters = new Set<string>();
  for (const plan of plans) {
    const first = await safeRequestAdapter(gpu, plan.options);
    if (!first.adapter) {
      log({ tier: plan.tier, step: plan.label, ok: false, message: first.error ?? 'requestAdapter() returned null' });
      continue;
    }
    log({ tier: plan.tier, step: plan.label, ok: true, message: describeAdapter(adapterInfoOf(first.adapter)) });
    // the same physical adapter often comes back for several option sets: do not re-run an identical failing ladder
    const sig = `${plan.tier === 'D' ? 'D' : plan.tier === 'C' ? 'C' : 'A'}|${describeAdapter(adapterInfoOf(first.adapter))}|${[...(first.adapter.features as unknown as Set<string>)].sort().join()}`;
    if (seenAdapters.has(sig)) {
      log({ tier: plan.tier, step: `${plan.label} duplicate`, ok: false, message: 'same adapter as an earlier attempt, skipped' });
      continue;
    }
    seenAdapters.add(sig);

    const ladder = buildLadder(first.adapter, !!opts.bare);
    let adapter = first.adapter;
    for (let i = 0; i < ladder.length; i++) {
      const rung = ladder[i];
      if (i > 0) {
        const fresh = await safeRequestAdapter(gpu, plan.options);
        if (fresh.adapter) adapter = fresh.adapter;
      }
      const desc: GPUDeviceDescriptor | undefined = rung.descriptor
        ? { label: 'kekenik-device', requiredFeatures: rung.features as GPUFeatureName[], requiredLimits: rung.limits }
        : undefined;
      try {
        const device = await adapter.requestDevice(desc);
        log({ tier: plan.tier, step: `device(rung ${i}: ${rung.label})`, ok: true });
        const info = adapterInfoOf(adapter);
        const compat = plan.tier === 'C' && !device.features.has('core-features-and-limits');
        const tier: GpuTier = plan.tier === 'A' && i > 0 ? 'B' : plan.tier;
        return {
          adapter,
          device,
          tier,
          rung: i,
          rungLabel: rung.label,
          requestedFeatures: rung.features,
          requestedLimits: rung.limits,
          attempts,
          adapterOptions: plan.options,
          adapterInfo: info,
          software: plan.tier === 'D' || info.isFallback,
          compat,
        };
      } catch (e) {
        log({ tier: plan.tier === 'A' && i > 0 ? 'B' : plan.tier, step: `device(rung ${i}: ${rung.label})`, ok: false, message: errMsg(e) });
      }
    }
  }
  const lastDevice = [...attempts].reverse().find((a) => a.step.startsWith('device') && !a.ok);
  const anyAdapter = attempts.some((a) => a.step.startsWith('adapter') && a.ok);
  const msg = anyAdapter
    ? `A GPU adapter was found but a device could not be created${lastDevice?.message ? ` (${lastDevice.message})` : ''}.`
    : 'No WebGPU adapter was found (requestAdapter returned null for every option).';
  throw new GpuUnavailableError(msg, describeEnv(env, attempts), attempts, env);
}

export function describeAdapter(i: AdapterInfoLite): string {
  return [i.vendor, i.architecture, i.device, i.description].filter(Boolean).join(' / ') || 'unknown adapter';
}

export function describeEnv(env: GpuEnvInfo, attempts: GpuAttempt[]): string[] {
  const d: string[] = [];
  d.push(`navigator.gpu: ${env.gpuApi ? 'present' : 'MISSING'}`);
  d.push(`isSecureContext: ${env.secureContext === null ? 'unknown' : String(env.secureContext)}`);
  d.push(`inside iframe: ${env.inIframe ? 'YES (open the app in its own top-level tab)' : 'no'}`);
  d.push(`User agent: ${env.userAgent}`);
  for (const a of attempts) d.push(`[tier ${a.tier}] ${a.step}: ${a.ok ? 'ok' : 'FAILED'}${a.message ? ` — ${a.message}` : ''}`);
  return d;
}

import { formatBytes } from '../../shared/util';

import { OPTIONAL_FEATURES, type GpuAttempt, type GpuTier } from './acquire';

export { OPTIONAL_FEATURES };

/** Every limit name in the WebGPU spec that is a "maximum" (we request the adapter's max for each). */
export const MAX_LIMIT_NAMES = [
  'maxTextureDimension1D',
  'maxTextureDimension2D',
  'maxTextureDimension3D',
  'maxTextureArrayLayers',
  'maxBindGroups',
  'maxBindGroupsPlusVertexBuffers',
  'maxBindingsPerBindGroup',
  'maxDynamicUniformBuffersPerPipelineLayout',
  'maxDynamicStorageBuffersPerPipelineLayout',
  'maxSampledTexturesPerShaderStage',
  'maxSamplersPerShaderStage',
  'maxStorageBuffersPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxUniformBuffersPerShaderStage',
  'maxUniformBufferBindingSize',
  'maxStorageBufferBindingSize',
  'maxVertexBuffers',
  'maxBufferSize',
  'maxVertexAttributes',
  'maxVertexBufferArrayStride',
  'maxInterStageShaderVariables',
  'maxColorAttachments',
  'maxColorAttachmentBytesPerSample',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxComputeWorkgroupSizeZ',
  'maxComputeWorkgroupsPerDimension',
] as const;

export interface CapabilityReport {
  supported: boolean;
  adapter: { vendor: string; architecture: string; device: string; description: string; isFallback: boolean };
  features: string[];
  /** Convenience booleans for the optional features that matter to the engine. */
  has: {
    shaderF16: boolean;
    float32Filterable: boolean;
    float32Blendable: boolean;
    timestampQuery: boolean;
    textureFormatsTier1: boolean;
    bgra8Storage: boolean;
    bcCompression: boolean;
    etc2Compression: boolean;
    astcCompression: boolean;
  };
  limits: Record<string, number>;
  preferredCanvasFormat: string;
  /** Rough VRAM guess in bytes (WebGPU does not expose it). Used for the default memory budget. */
  memoryEstimateBytes: number;
  /** Default budget = 60% of the estimate. */
  defaultBudgetBytes: number;
  diagnostics: string[];
  /** Tier at which the device was created (see acquire.ts): A full, B reduced device request, C compatibility, D software. */
  tier: GpuTier;
  /** Compatibility-mode device (no `core-features-and-limits`): storage buffers/textures are not usable in vertex stages etc. */
  compat: boolean;
  /** Software (fallback) adapter: preview resolution and memory budget are lowered automatically. */
  software: boolean;
  /** Which rung of the device-request ladder worked. */
  rungLabel: string;
  attempts: GpuAttempt[];
}

/** Everything the engine sizes from the ACTUAL device limits (never from constants). */
export interface DerivedLimits {
  maxTextureDim: number;
  maxBufferBytes: number;
  maxStorageBindingBytes: number;
  maxSampledTextures: number;
  maxStorageBuffers: number;
  /** Storage buffers may be bound in the vertex stage (false in compat mode). */
  storageInVertex: boolean;
  maxWorkgroupInvocations: number;
  /** Largest square workgroup edge that respects maxComputeInvocationsPerWorkgroup and the per-axis sizes. */
  workgroupEdge: number;
  maxColorAttachmentBytes: number;
  maxBindGroups: number;
}

/** Derive engine sizes from the capability report. Missing limits fall back to the WebGPU DEFAULT limits. */
export function deriveLimits(caps: Pick<CapabilityReport, 'limits' | 'compat'>): DerivedLimits {
  const L = caps.limits;
  const num = (n: string, def: number): number => (typeof L[n] === 'number' && L[n] > 0 ? L[n] : def);
  const inv = num('maxComputeInvocationsPerWorkgroup', 256);
  let edge = 16;
  while (edge > 1 && (edge * edge > inv || edge > num('maxComputeWorkgroupSizeX', 256) || edge > num('maxComputeWorkgroupSizeY', 256))) edge >>= 1;
  const vertexStorage = L.maxStorageBuffersInVertexStage;
  return {
    maxTextureDim: num('maxTextureDimension2D', 8192),
    maxBufferBytes: num('maxBufferSize', 256 * 1024 * 1024),
    maxStorageBindingBytes: num('maxStorageBufferBindingSize', 128 * 1024 * 1024),
    maxSampledTextures: num('maxSampledTexturesPerShaderStage', 16),
    maxStorageBuffers: num('maxStorageBuffersPerShaderStage', 4),
    storageInVertex: !caps.compat && (typeof vertexStorage !== 'number' || vertexStorage > 0),
    maxWorkgroupInvocations: inv,
    workgroupEdge: edge,
    maxColorAttachmentBytes: num('maxColorAttachmentBytesPerSample', 32),
    maxBindGroups: num('maxBindGroups', 4),
  };
}

/** Core WebGPU write-only storage-texture formats (no extra feature needed). */
const CORE_STORAGE_FORMATS = new Set([
  'rgba8unorm',
  'rgba8snorm',
  'rgba8uint',
  'rgba8sint',
  'rgba16uint',
  'rgba16sint',
  'rgba16float',
  'r32uint',
  'r32sint',
  'r32float',
  'rg32uint',
  'rg32sint',
  'rg32float',
  'rgba32uint',
  'rgba32sint',
  'rgba32float',
]);

/** Extra storage formats unlocked by 'texture-formats-tier1' (r16float, rg16float, ...). */
const TIER1_STORAGE_FORMATS = new Set([
  'r8unorm',
  'r8snorm',
  'r8uint',
  'r8sint',
  'rg8unorm',
  'rg8snorm',
  'rg8uint',
  'rg8sint',
  'r16uint',
  'r16sint',
  'r16float',
  'rg16uint',
  'rg16sint',
  'rg16float',
  'rgb10a2uint',
  'rgb10a2unorm',
  'rg11b10ufloat',
]);

/** Can this format be bound as a (write) storage texture? NEVER assume r16float/rg16float: check this. */
export function supportsStorage(caps: CapabilityReport, format: string): boolean {
  if (CORE_STORAGE_FORMATS.has(format)) return true;
  if (TIER1_STORAGE_FORMATS.has(format)) return caps.has.textureFormatsTier1;
  if (format === 'bgra8unorm') return caps.has.bgra8Storage;
  return false;
}

/** Can this float format be linearly filtered by hardware samplers? (We use textureLoad by default.) */
export function supportsFiltering(caps: CapabilityReport, format: string): boolean {
  if (format.endsWith('32float')) return caps.has.float32Filterable;
  return true;
}

export function estimateGpuMemory(): number {
  const dm = typeof navigator !== 'undefined' ? (navigator as unknown as { deviceMemory?: number }).deviceMemory : undefined;
  // deviceMemory is capped at 8 (GB) and describes system RAM; assume a discrete/integrated mix.
  const gb = dm ? Math.min(dm, 8) * 0.5 : 2;
  return Math.max(512 * 1024 ** 2, Math.round(gb * 1024 ** 3));
}

export interface AcquireMeta {
  tier: GpuTier;
  compat: boolean;
  software: boolean;
  rungLabel: string;
  attempts: GpuAttempt[];
}

export function buildCapabilityReport(adapter: GPUAdapter, device: GPUDevice, meta?: AcquireMeta): CapabilityReport {
  const info = (adapter as unknown as { info?: GPUAdapterInfo }).info;
  const f = device.features;
  const limits: Record<string, number> = {};
  for (const name of MAX_LIMIT_NAMES) {
    const v = (device.limits as unknown as Record<string, number | undefined>)[name];
    if (typeof v === 'number') limits[name] = v;
  }
  for (const extra of ['maxStorageBuffersInVertexStage', 'maxStorageBuffersInFragmentStage', 'maxStorageTexturesInVertexStage', 'maxStorageTexturesInFragmentStage']) {
    const v = (device.limits as unknown as Record<string, number | undefined>)[extra];
    if (typeof v === 'number') limits[extra] = v;
  }
  limits.minUniformBufferOffsetAlignment = device.limits.minUniformBufferOffsetAlignment;
  limits.minStorageBufferOffsetAlignment = device.limits.minStorageBufferOffsetAlignment;
  const est = meta?.software ? Math.min(estimateGpuMemory(), 1024 ** 3) : estimateGpuMemory();
  const diagnostics: string[] = [];
  if (meta?.compat) diagnostics.push('Compatibility mode: reduced limits (no storage buffers in vertex stage, fewer bindings).');
  if (meta?.software) diagnostics.push('Software rendering - performance will be limited.');
  if (!f.has('float32-filterable')) diagnostics.push('float32-filterable missing: HQ (32-bit) textures use textureLoad filtering only.');
  if (!f.has('timestamp-query')) diagnostics.push('timestamp-query missing: per-node GPU timings unavailable (CPU timings only).');
  if (!f.has('texture-formats-tier1')) diagnostics.push('texture-formats-tier1 missing: r16float/rg16float cannot be storage textures (fragment passes unaffected).');
  return {
    supported: true,
    adapter: {
      vendor: info?.vendor ?? '',
      architecture: info?.architecture ?? '',
      device: info?.device ?? '',
      description: info?.description ?? '',
      isFallback: (info as unknown as { isFallbackAdapter?: boolean })?.isFallbackAdapter ?? meta?.software ?? false,
    },
    features: [...f].sort(),
    has: {
      shaderF16: f.has('shader-f16'),
      float32Filterable: f.has('float32-filterable'),
      float32Blendable: f.has('float32-blendable'),
      timestampQuery: f.has('timestamp-query'),
      textureFormatsTier1: f.has('texture-formats-tier1'),
      bgra8Storage: f.has('bgra8unorm-storage'),
      bcCompression: f.has('texture-compression-bc'),
      etc2Compression: f.has('texture-compression-etc2'),
      astcCompression: f.has('texture-compression-astc'),
    },
    limits,
    preferredCanvasFormat: (typeof navigator !== 'undefined' ? navigator.gpu?.getPreferredCanvasFormat?.() : undefined) ?? 'bgra8unorm',
    memoryEstimateBytes: est,
    defaultBudgetBytes: Math.round(est * (meta?.software ? 0.25 : 0.6) * (meta?.software ? 0.5 : 1)),
    diagnostics,
    tier: meta?.tier ?? 'A',
    compat: meta?.compat ?? false,
    software: meta?.software ?? false,
    rungLabel: meta?.rungLabel ?? '',
    attempts: meta?.attempts ?? [],
  };
}

export function formatCapabilityReport(r: CapabilityReport): string {
  const L: string[] = [];
  L.push(`Adapter: ${[r.adapter.vendor, r.adapter.architecture, r.adapter.device, r.adapter.description].filter(Boolean).join(' / ') || 'unknown'}${r.adapter.isFallback ? ' (FALLBACK/software)' : ''}`);
  L.push(`Tier ${r.tier}${r.compat ? ' (compatibility)' : ''}${r.software ? ' (software)' : ''}${r.rungLabel ? `; device request: ${r.rungLabel}` : ''}`);
  L.push(`Features: ${r.features.join(', ') || 'none'}`);
  L.push(`maxTextureDimension2D=${r.limits.maxTextureDimension2D} maxBufferSize=${formatBytes(r.limits.maxBufferSize ?? 0)} maxStorageBufferBindingSize=${formatBytes(r.limits.maxStorageBufferBindingSize ?? 0)}`);
  L.push(`maxComputeInvocationsPerWorkgroup=${r.limits.maxComputeInvocationsPerWorkgroup} maxStorageTexturesPerShaderStage=${r.limits.maxStorageTexturesPerShaderStage}`);
  L.push(`Canvas format: ${r.preferredCanvasFormat}; VRAM estimate: ${formatBytes(r.memoryEstimateBytes)}; default budget: ${formatBytes(r.defaultBudgetBytes)}`);
  for (const d of r.diagnostics) L.push(`Note: ${d}`);
  return L.join('\n');
}

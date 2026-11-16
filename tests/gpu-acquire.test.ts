import { describe, expect, it } from 'vitest';
import { acquireGpuDevice, clampLimits, GpuUnavailableError, supportedFeatures, WANTED_LIMITS } from '../src/engine/gpu/acquire';
import { buildDiagnosticsText, detectBrowser, hintKeys } from '../src/engine/gpu/diagnostics';
import { deriveLimits, type CapabilityReport } from '../src/engine/gpu/caps';

interface MockAdapterSpec {
  features?: string[];
  limits?: Record<string, number>;
  /** requestDevice behaviour: given the descriptor, return a device or throw */
  deviceRule?: (desc: GPUDeviceDescriptor | undefined, call: number) => void;
  info?: Record<string, unknown>;
}

function mockDevice(desc: GPUDeviceDescriptor | undefined): GPUDevice {
  return { features: new Set(desc?.requiredFeatures ?? []), limits: desc?.requiredLimits ?? {}, lost: new Promise(() => undefined), desc } as unknown as GPUDevice;
}

function mockAdapter(spec: MockAdapterSpec): GPUAdapter {
  let calls = 0;
  return {
    features: new Set(spec.features ?? []),
    limits: spec.limits ?? { maxTextureDimension2D: 8192, maxBufferSize: 268435456 },
    info: spec.info ?? { vendor: 'mock', architecture: 'm1', device: '', description: 'Mock GPU' },
    requestDevice: async (desc?: GPUDeviceDescriptor) => {
      spec.deviceRule?.(desc, calls++);
      return mockDevice(desc);
    },
  } as unknown as GPUAdapter;
}

const failure = async (opts: Parameters<typeof acquireGpuDevice>[0]): Promise<GpuUnavailableError> => {
  try {
    await acquireGpuDevice(opts);
  } catch (e) {
    return e as GpuUnavailableError;
  }
  throw new Error('expected acquisition to fail');
};
const feats = (d: GPUDeviceDescriptor | undefined): string[] => [...((d?.requiredFeatures ?? []) as Iterable<string>)];

const gpuOf = (fn: (opts?: Record<string, unknown>) => GPUAdapter | null | Promise<GPUAdapter | null>) => ({ requestAdapter: async (o?: GPURequestAdapterOptions) => fn(o as Record<string, unknown> | undefined) });

describe('tiered device acquisition', () => {
  it('Tier A: high-performance adapter, only supported optional features, clamped limits', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    const gpu = gpuOf((o) => (seen.push(o), mockAdapter({ features: ['float32-filterable', 'shader-f16'], limits: { maxTextureDimension2D: 4096, maxBufferSize: 1e9, maxBindGroups: 4 } })));
    const r = await acquireGpuDevice({ gpu: gpu as never });
    expect(r.tier).toBe('A');
    expect(seen[0]).toEqual({ powerPreference: 'high-performance' });
    expect(r.requestedFeatures.sort()).toEqual(['float32-filterable', 'shader-f16']);
    expect(r.requestedLimits.maxTextureDimension2D).toBe(4096); // clamped to the adapter, not 16384
    expect(r.requestedLimits.maxStorageBufferBindingSize).toBeUndefined(); // adapter does not report it -> never requested
    expect(r.software).toBe(false);
  });

  it('never requires features / limits the adapter does not offer', () => {
    expect(supportedFeatures(new Set(['timestamp-query']))).toEqual(['timestamp-query']);
    expect(supportedFeatures(undefined)).toEqual([]);
    const lim = clampLimits({ maxTextureDimension2D: 2048, maxBufferSize: 5, bogus: 7 });
    expect(lim).toEqual({ maxTextureDimension2D: 2048, maxBufferSize: 5 });
    for (const [k, v] of Object.entries(clampLimits({ maxTextureDimension2D: 99999 }, WANTED_LIMITS))) expect(v).toBeLessThanOrEqual(WANTED_LIMITS[k]);
  });

  it('falls through the adapter options when requestAdapter returns null', async () => {
    const seen: string[] = [];
    const gpu = gpuOf((o) => {
      seen.push(JSON.stringify(o ?? null));
      return o?.powerPreference ? null : mockAdapter({});
    });
    const r = await acquireGpuDevice({ gpu: gpu as never });
    expect(seen).toEqual([JSON.stringify({ powerPreference: 'high-performance' }), JSON.stringify({ powerPreference: 'low-power' }), 'null']);
    expect(r.tier).toBe('A');
    expect(r.attempts.filter((a) => !a.ok && a.step.startsWith('adapter')).length).toBe(2);
  });

  it('Tier B: requestDevice rejecting for unsupported features/limits is retried with fewer, then default limits', async () => {
    const descs: Array<GPUDeviceDescriptor | undefined> = [];
    const adapter = mockAdapter({
      features: ['shader-f16', 'float32-filterable'],
      limits: { maxTextureDimension2D: 8192, maxBufferSize: 1e9 },
      deviceRule: (d) => {
        descs.push(d);
        if (d && (feats(d).length || Object.keys(d.requiredLimits ?? {}).length)) throw new TypeError('limit not supported');
      },
    });
    const r = await acquireGpuDevice({ gpu: gpuOf(() => adapter) as never });
    expect(r.tier).toBe('B');
    expect(r.rung).toBeGreaterThan(0);
    const last = descs[descs.length - 1];
    expect(feats(last)).toEqual([]);
    expect(Object.keys(last?.requiredLimits ?? {})).toEqual([]);
    expect(r.attempts.some((a) => !a.ok && a.message?.includes('limit not supported'))).toBe(true);
  });

  it('last resort: requestDevice() without descriptor', async () => {
    const adapter = mockAdapter({ features: ['float32-filterable'], deviceRule: (d) => { if (d) throw new Error('OperationError: nope'); } });
    const r = await acquireGpuDevice({ gpu: gpuOf(() => adapter) as never });
    expect(r.rungLabel).toBe('no descriptor');
  });

  it('Tier C: compatibility adapter is used when standard adapters are null; unknown options never throw out', async () => {
    const gpu = gpuOf((o) => {
      if (o?.featureLevel === 'compatibility') return mockAdapter({ info: { vendor: 'old', architecture: '', device: '', description: 'GLES' } });
      return null;
    });
    const r = await acquireGpuDevice({ gpu: gpu as never });
    expect(r.tier).toBe('C');
    expect(r.compat).toBe(true);
    const throwing = gpuOf((o) => {
      if (o?.featureLevel) throw new TypeError('unknown option featureLevel');
      return null;
    });
    await expect(acquireGpuDevice({ gpu: throwing as never, order: ['C'] })).rejects.toBeInstanceOf(GpuUnavailableError);
  });

  it('Tier D: software adapter flags software mode', async () => {
    const gpu = gpuOf((o) => (o?.forceFallbackAdapter ? mockAdapter({ info: { vendor: 'google', architecture: 'swiftshader', device: '', description: 'SwiftShader', isFallbackAdapter: true } }) : null));
    const r = await acquireGpuDevice({ gpu: gpu as never });
    expect(r.tier).toBe('D');
    expect(r.software).toBe(true);
  });

  it('safe mode (bare) starts at the compatibility tier and requests a bare device', async () => {
    const order: string[] = [];
    const descs: Array<GPUDeviceDescriptor | undefined> = [];
    const adapter = mockAdapter({ features: ['shader-f16'], deviceRule: (d) => descs.push(d) });
    const gpu = gpuOf((o) => (order.push(o?.featureLevel ? 'C' : 'A'), adapter));
    const r = await acquireGpuDevice({ gpu: gpu as never, bare: true, order: ['C', 'A', 'D'] });
    expect(order[0]).toBe('C');
    expect(r.requestedFeatures).toEqual([]);
  });

  it('reports a precise error when navigator.gpu is missing, and when nothing works', async () => {
    const e1 = await failure({ gpu: null });
    expect(e1).toBeInstanceOf(GpuUnavailableError);
    expect(e1.diagnostics.join('\n')).toMatch(/navigator\.gpu: MISSING/);
    const e2 = await failure({ gpu: gpuOf(() => null) as never });
    expect(e2.message).toMatch(/requestAdapter returned null/);
    expect(e2.attempts.some((a) => a.tier === 'D' && !a.ok)).toBe(true);
    const e3 = await failure({ gpu: gpuOf(() => mockAdapter({ deviceRule: () => { throw new Error('boom'); } })) as never });
    expect(e3.message).toMatch(/device could not be created/);
    expect(e3.message).toMatch(/boom/);
  });

  it('a consumed adapter is re-requested before the next ladder rung', async () => {
    let requested = 0;
    const gpu = gpuOf(() => {
      requested++;
      const first = requested === 1;
      return mockAdapter({ features: ['float32-filterable'], deviceRule: (d) => { if (first && feats(d).length) throw new Error('OperationError'); } });
    });
    const r = await acquireGpuDevice({ gpu: gpu as never });
    expect(requested).toBeGreaterThan(1);
    expect(r.rung).toBeGreaterThan(0);
  });
});

describe('limit-aware engine sizes', () => {
  const caps = (limits: Record<string, number>, compat = false): Pick<CapabilityReport, 'limits' | 'compat'> => ({ limits, compat });
  it('uses WebGPU default limits when nothing is reported', () => {
    const d = deriveLimits(caps({}));
    expect(d.maxTextureDim).toBe(8192);
    expect(d.maxWorkgroupInvocations).toBe(256);
    expect(d.workgroupEdge).toBe(16);
  });
  it('shrinks the workgroup edge and disables vertex storage in compat mode', () => {
    const d = deriveLimits(caps({ maxComputeInvocationsPerWorkgroup: 128, maxComputeWorkgroupSizeX: 128, maxComputeWorkgroupSizeY: 128, maxStorageBuffersInVertexStage: 0 }, true));
    expect(d.workgroupEdge * d.workgroupEdge).toBeLessThanOrEqual(128);
    expect(d.storageInVertex).toBe(false);
  });
});

describe('diagnostics text', () => {
  it('contains env, attempts and per-browser hints', async () => {
    const err = await failure({ gpu: gpuOf(() => null) as never });
    const text = buildDiagnosticsText({ error: err, version: 'test' });
    expect(text).toMatch(/Acquisition attempts/);
    expect(text).toMatch(/adapter\(compatibility\)/);
    expect(detectBrowser('Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537').browser).toBe('chromium');
    expect(hintKeys('Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537')).toContain('diag.hint.vulkan');
    expect(hintKeys('Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0')).toContain('diag.hint.firefox');
  });
});

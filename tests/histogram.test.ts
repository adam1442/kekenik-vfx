import { describe, expect, it } from 'vitest';
import { assembleFullscreenShader } from '../src/engine/shaders/assemble';
import { autoRange, BINS, binOf, cpuHistogram, gammaFromHandle, gammaHandle, luma, normalizeBins, strideFor, MAX_SAMPLES } from '../src/engine/analysis/histogram-core';

describe('histogram core (CPU reference)', () => {
  it('maps values to bins with clamping into the edge bins', () => {
    const r = { min: 0, max: 1 };
    expect(binOf(0, r)).toBe(0);
    expect(binOf(0.5, r)).toBe(128);
    expect(binOf(1, r)).toBe(255); // 1.0 -> bin 256 clamped to 255
    expect(binOf(-3, r)).toBe(0);
    expect(binOf(7, r)).toBe(255);
    expect(binOf(2, { min: 0, max: 4 })).toBe(128); // HDR range
  });

  it('uniform gray image: all counts in one bin of every channel', () => {
    const w = 32;
    const h = 16;
    const px = new Float32Array(w * h).fill(0.25);
    const r = cpuHistogram(px, w, h, 1);
    expect(r.samples).toBe(w * h);
    expect(r.bins[binOf(0.25, r.range)]).toBe(w * h); // R
    expect(r.bins[4 * BINS + binOf(0.25, r.range)]).toBe(w * h); // luma of (v,v,v)
    expect(r.bins[3 * BINS + 255]).toBe(w * h); // alpha 1
  });

  it('linear ramp: flat histogram (+-1 per bin), color checker: two spikes', () => {
    const w = 256;
    const ramp = new Float32Array(w);
    for (let x = 0; x < w; x++) ramp[x] = (x + 0.5) / w;
    const r = cpuHistogram(ramp, w, 1, 1);
    for (let i = 0; i < BINS; i++) expect(r.bins[i]).toBe(1);
    const n = 8;
    const px = new Float32Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px.set((x + y) % 2 ? [1, 0, 0, 1] : [0, 0, 1, 1], (y * n + x) * 4);
    const c = cpuHistogram(px, n, n, 4);
    expect(c.bins[0]).toBe(32); // R = 0
    expect(c.bins[255]).toBe(32); // R = 1
    expect(c.bins[2 * BINS + 0]).toBe(32);
    expect(c.bins[2 * BINS + 255]).toBe(32);
    expect(c.bins[4 * BINS + binOf(luma(1, 0, 0), c.range)]).toBe(32);
  });

  it('counts overflow, ignores NaN / Inf and reports the maximum for the auto range', () => {
    const px = new Float32Array([0.5, 4, -1, NaN, Infinity, 2]);
    const r = cpuHistogram(px, 6, 1, 1);
    expect(r.samples).toBe(6);
    expect(r.overHi[0]).toBe(2); // 4 and 2 (Infinity skipped)
    expect(r.overLo[0]).toBe(1);
    expect(r.bins[255]).toBe(2);
    expect(r.max[0]).toBe(4);
    expect(autoRange(4)).toEqual({ min: 0, max: 4 });
    expect(autoRange(0.3)).toEqual({ min: 0, max: 1 });
    expect(autoRange(1e9)).toEqual({ min: 0, max: 64 });
    expect(autoRange(NaN)).toEqual({ min: 0, max: 1 });
    const r2 = cpuHistogram(px, 6, 1, 1, autoRange(4));
    expect(r2.overHi[0]).toBe(0);
  });

  it('strided sampling is deterministic, bounded and accurate on a large texture', () => {
    expect(strideFor(1024, 1024)).toBe(1);
    const s = strideFor(8192, 8192);
    expect(Math.ceil(8192 / s) ** 2).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(Math.ceil(8192 / (s - 1)) ** 2).toBeGreaterThan(MAX_SAMPLES);
    expect(strideFor(8192, 8192)).toBe(s);
    // gradient texture 2048^2, stride 3: histogram fractions within 1 % of the exact one
    const w = 2048;
    const px = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) px[y * w + x] = x / (w - 1);
    const a = cpuHistogram(px, w, w, 1, { min: 0, max: 1 }, 1);
    const b = cpuHistogram(px, w, w, 1, { min: 0, max: 1 }, 3);
    let worst = 0;
    for (let i = 0; i < BINS; i++) worst = Math.max(worst, Math.abs(a.bins[i] / a.samples - b.bins[i] / b.samples));
    expect(worst).toBeLessThan(0.01);
  });

  it('normalises bin heights (linear / log), ignoring edge spikes for the scale', () => {
    const bins = new Float32Array(5 * BINS);
    bins[0] = 1000; // black spike
    bins[100] = 10;
    bins[101] = 5;
    const lin = normalizeBins(bins, 0, false);
    expect(lin[100]).toBe(1);
    expect(lin[101]).toBeCloseTo(0.5);
    expect(lin[0]).toBe(1); // clamped
    const log = normalizeBins(bins, 0, true);
    expect(log[101]).toBeCloseTo(Math.log1p(5) / Math.log1p(10));
    expect(normalizeBins(new Float32Array(5 * BINS), 0, false).every((v) => v === 0)).toBe(true);
  });

  it('levels gamma handle geometry round-trips', () => {
    for (const g of [0.2, 0.5, 1, 2.2, 5]) expect(gammaFromHandle(gammaHandle(g))).toBeCloseTo(g, 6);
    expect(gammaHandle(1)).toBe(0.5);
  });
});

describe.skipIf(!process.env.DAWN)('histogram.wgsl compiles in Tint', () => {
  it('compiles', async () => {
    const mod = (await import(/* @vite-ignore */ process.env.DAWN_PATH ?? 'webgpu')) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const dev = await (await mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']).requestAdapter())!.requestDevice();
    const { readFileSync } = await import('node:fs');
    const code = readFileSync('src/engine/analysis/histogram.wgsl', 'utf8');
    const m = dev.createShaderModule({ code });
    const info = await m.getCompilationInfo();
    expect(info.messages.filter((x) => x.type === 'error')).toEqual([]);
    void assembleFullscreenShader;
  });
});

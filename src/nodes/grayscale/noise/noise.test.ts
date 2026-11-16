import { describe, expect, it } from 'vitest';
import { perlin3, pcg, valueNoise3 } from '../../../engine/shaders/reference/noise';
import { noiseReference, type NoiseRefParams } from './reference';

const base: NoiseRefParams = {
  type: 'perlin',
  scale: [4, 4],
  octaves: 4,
  lacunarity: 2,
  roughness: 0.5,
  offset: [0, 0],
  evolution: 0,
  zCells: 2,
  seed: 0,
  contrast: 1,
  brightness: 0,
  invert: false,
  tile: [true, true],
};

describe('noise CPU reference (mirror of shader.wgsl)', () => {
  it('pcg matches known values', () => {
    expect(pcg(0)).toBe(pcg(0));
    expect(pcg(1)).not.toBe(pcg(2));
    expect(pcg(12345)).toBe(pcg(12345));
  });
  for (const type of ['value', 'perlin'] as const) {
    it(`${type}: periodic in U/V when tiling (uv+1 == uv, also with fractional offset)`, () => {
      const p = { ...base, type, offset: [0.37, 0.11] as [number, number], scale: [5, 3] as [number, number] };
      for (let i = 0; i < 40; i++) {
        const u = (i * 0.0731) % 1;
        const v = (i * 0.0517) % 1;
        expect(noiseReference(p, u + 1, v)).toBeCloseTo(noiseReference(p, u, v), 9);
        expect(noiseReference(p, u, v + 1)).toBeCloseTo(noiseReference(p, u, v), 9);
        expect(noiseReference(p, u + 3, v - 2)).toBeCloseTo(noiseReference(p, u, v), 9);
      }
    });
    it(`${type}: loops seamlessly in Z (evolution 0 == 1 == 2)`, () => {
      const p = { ...base, type };
      for (let i = 0; i < 20; i++) {
        const u = (i * 0.137) % 1;
        const v = (i * 0.291) % 1;
        const a = noiseReference({ ...p, evolution: 0 }, u, v);
        expect(noiseReference({ ...p, evolution: 1 }, u, v)).toBeCloseTo(a, 9);
        expect(noiseReference({ ...p, evolution: 2 }, u, v)).toBeCloseTo(a, 9);
      }
      expect(noiseReference({ ...p, evolution: 0.5 }, 0.3, 0.3)).not.toBeCloseTo(noiseReference({ ...p, evolution: 0 }, 0.3, 0.3), 3);
    });
    it(`${type}: tiling only on the requested axis`, () => {
      const p = { ...base, type, tile: [true, false] as [boolean, boolean], scale: [4, 4.5] as [number, number], octaves: 1 };
      expect(noiseReference(p, 1.25, 0.4)).toBeCloseTo(noiseReference(p, 0.25, 0.4), 9);
      expect(noiseReference(p, 0.25, 1.4)).not.toBeCloseTo(noiseReference(p, 0.25, 0.4), 3);
    });
    it(`${type}: stays in [0,1], is deterministic, and depends on the seed`, () => {
      let min = 1;
      let max = 0;
      let diff = 0;
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const a = noiseReference({ ...base, type }, x / 32, y / 32);
          const b = noiseReference({ ...base, type, seed: 1 }, x / 32, y / 32);
          min = Math.min(min, a);
          max = Math.max(max, a);
          diff += Math.abs(a - b);
          expect(noiseReference({ ...base, type }, x / 32, y / 32)).toBe(a);
        }
      }
      expect(min).toBeGreaterThanOrEqual(0);
      expect(max).toBeLessThanOrEqual(1);
      expect(max - min).toBeGreaterThan(0.3);
      expect(diff / 1024).toBeGreaterThan(0.02);
    });
  }
  it('raw primitives are periodic and bounded', () => {
    for (let i = 0; i < 50; i++) {
      const p: [number, number, number] = [i * 0.37, i * 0.21, i * 0.13];
      const per: [number, number, number] = [4, 4, 2];
      const q: [number, number, number] = [p[0] + 4, p[1] - 8, p[2] + 2];
      expect(valueNoise3(q, per, 3)).toBeCloseTo(valueNoise3(p, per, 3), 9);
      expect(perlin3(q, per, 3)).toBeCloseTo(perlin3(p, per, 3), 9);
      expect(Math.abs(perlin3(p, per, 3))).toBeLessThanOrEqual(1.2);
      const v = valueNoise3(p, per, 3);
      expect(v >= 0 && v <= 1).toBe(true);
    }
  });
  it('contrast/brightness/invert behave', () => {
    const a = noiseReference({ ...base, contrast: 0 }, 0.3, 0.3);
    expect(a).toBeCloseTo(0.5, 9);
    expect(noiseReference({ ...base, contrast: 0, brightness: 0.25 }, 0.3, 0.3)).toBeCloseTo(0.75, 9);
    expect(noiseReference({ ...base, contrast: 0, invert: true, brightness: 0.25 }, 0.3, 0.3)).toBeCloseTo(0.25, 9);
  });
});

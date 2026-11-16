import { describe, expect, it } from 'vitest';
import { STD } from '../mesh/mesh';
import { ballistic, defaultEmitterParams, emitParticles, particleAge, type EmitterParams } from './emitter';

const P = (o: Partial<EmitterParams> = {}): EmitterParams => ({ ...defaultEmitterParams(), ...o });
const pos = (m: ReturnType<typeof emitParticles>): number[] => Array.from(m.attr('point', STD.P)!.data);

describe('particle emitter (closed form)', () => {
  it('ballistic motion matches free flight, drag limit and numeric integration', () => {
    expect(ballistic(2, -1, 0, 0.5)).toBeCloseTo(2 * 0.5 - 0.5 * 0.25, 9);
    // numeric integration of x'' = g - k x'
    let x = 0, v = 2;
    const g = -1, k = 3, dt = 1e-5;
    for (let t = 0; t < 0.5; t += dt) { v += (g - k * v) * dt; x += v * dt; }
    expect(ballistic(2, g, k, 0.5)).toBeCloseTo(x, 3);
    // terminal drift for large k stays finite
    expect(Number.isFinite(ballistic(5, -2, 50, 1))).toBe(true);
  });
  it('is deterministic and seed dependent', () => {
    const a = pos(emitParticles(null, P({ phase: 0.3 })));
    expect(pos(emitParticles(null, P({ phase: 0.3 })))).toEqual(a);
    expect(pos(emitParticles(null, P({ phase: 0.3, seed: 2 })))).not.toEqual(a);
  });
  it('one-shot: nothing alive at phase 1 - epsilon, burst at phase 0, ages in [0,1]', () => {
    const p = P({ spawnWindow: 0, lifetime: 0.5, count: 50 });
    const first = emitParticles(null, { ...p, phase: 0 });
    expect(first.pointCount).toBe(50);
    expect(Array.from(first.attr('point', STD.age)!.data).every((x) => x >= 0 && x <= 1)).toBe(true);
    expect(emitParticles(null, { ...p, phase: 0.99 }).pointCount).toBe(0);
    expect(emitParticles(null, P({ spawnWindow: 0.4, lifetime: 0.3, phase: 0.999 })).pointCount).toBe(0);
  });
  it('loop mode is exactly periodic: phase 0 equals phase 1 and count is constant', () => {
    for (const lifetime of [1, 0.5, 0.25, 0.4]) {
      const base = P({ mode: 'loop', lifetime, count: 40, turbulence: 0.05 });
      const a = emitParticles(null, { ...base, phase: 0 });
      const b = emitParticles(null, { ...base, phase: 1 });
      expect(a.pointCount).toBe(40);
      const pa = pos(a);
      const pb = pos(b);
      pa.forEach((v, i) => expect(pb[i]).toBeCloseTo(v, 4));
    }
  });
  it('loop age cycles C = round(1/lifetime) times per loop', () => {
    const ages = [0, 0.1, 0.2, 0.3, 0.45, 0.5, 0.75].map((ph) => particleAge({ mode: 'loop', phase: ph, lifetime: 0.25, spawnWindow: 0 }, 0)!.age);
    expect(ages[0]).toBeCloseTo(0, 6);
    expect(ages[5]).toBeCloseTo(0.0, 6); // 4 * 0.5 = 2 -> fract 0
    expect(particleAge({ mode: 'loop', phase: 0.125, lifetime: 0.25, spawnWindow: 0 }, 0)!.age).toBeCloseTo(0.5, 6);
  });
  it('gravity pulls down and velocity attribute follows the motion', () => {
    const m = emitParticles(null, P({ count: 20, speed: 0, gravity: [0, -1, 0], drag: 0, spawnWindow: 0, lifetime: 1, phase: 0.5, speedRandom: 0 }));
    const y = Array.from(m.attr('point', STD.P)!.data).filter((_, i) => i % 3 === 1);
    y.forEach((v) => expect(v).toBeLessThan(0));
    const vy = Array.from(m.attr('point', 'v')!.data).filter((_, i) => i % 3 === 1);
    vy.forEach((v) => expect(v).toBeCloseTo(-0.5, 2));
  });
  it('respects the hard cap', () => {
    expect(emitParticles(null, P({ count: 1000, maxPoints: 10, spawnWindow: 0, lifetime: 1 })).pointCount).toBe(10);
  });
});

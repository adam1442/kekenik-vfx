import { describe, expect, it } from 'vitest';
import { GridBackend } from '../src/nodes/_shared/simgrid';
import { makeLayout, packUniforms, zeroUniforms } from '../src/engine/shaders/uniforms';
import { PipelinePending } from '../src/engine/shaders/pipelines';

/** Regression: GridBackend.prewarm used to pass `{}` as uniform values, so packUniforms threw `Missing uniform "seed_b"` for every grid simulation. */
describe('zeroUniforms / GridBackend.prewarm', () => {
  const layout = makeLayout([
    { name: 'seed_b', type: 'u32' }, { name: 'dt', type: 'f32' }, { name: 'sim_res', type: 'vec2f' }, { name: 'tint', type: 'vec4f' }, { name: 'p', type: 'vec3f' },
    { name: 'lut', type: 'vec4f', count: 3 },
  ]);
  it('zeroUniforms provides every field with the right component count', () => {
    const z = zeroUniforms(layout);
    expect(Object.keys(z)).toEqual(layout.fields.map((f) => f.name));
    expect(() => packUniforms(layout, z)).not.toThrow();
    expect(() => packUniforms(layout, {})).toThrow(/Missing uniform "seed_b"/);
  });

  it('prewarm records every pass with a complete uniform block (no throw) and waits for pending pipelines', async () => {
    const packed: number[] = [];
    let pendingLeft = 2;
    const runner = {
      arena: { endBatch: () => undefined },
      fullscreen: (_enc: unknown, _t: unknown, _f: unknown, pass: { uniforms?: { layout: typeof layout; values: Record<string, number | number[]> } }) => {
        if (pass.uniforms && pass.uniforms.layout === layout) packed.push(packUniforms(pass.uniforms.layout, pass.uniforms.values).byteLength);
        if (pendingLeft > 0) {
          pendingLeft--;
          throw new PipelinePending(Promise.resolve());
        }
      },
    };
    const tex = { view: {}, format: 'rgba16float', width: 4, height: 4 };
    const mm = { textures: { acquire: () => ({ ...tex, texture: {}, release: () => undefined }) } };
    const gpu = { device: { createCommandEncoder: () => ({}) } };
    const setup = { w: 16, h: 16, precision: 'half' } as never;
    const be = new GridBackend({ gpu, mm, runner } as never, setup, { nodeName: 'test' } as never, { shader: {} as never, layout, texCount: 2, passes: [0, 1], init: () => undefined, step: () => undefined });
    await be.prewarm();
    expect(packed.length).toBeGreaterThanOrEqual(2);
    expect(new Set(packed).size).toBe(1);
  });
});

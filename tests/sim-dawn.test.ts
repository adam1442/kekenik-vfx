import { describe, expect, it } from 'vitest';
import { assembleFullscreenShader } from '../src/engine/shaders/assemble';
import { FLUID_LAYOUT, FLUID_SHADER, PASS_DEFS } from '../src/nodes/simulation/fluid2d/solver';
import { OUT_LAYOUT, OUT_SHADER, SIM_OUTPUTS } from '../src/nodes/simulation/fluid2d/definition';

/**
 * Opt-in (DAWN=1, needs `npm i --no-save webgpu`): every Fluid 2D pass is compiled by Tint AND built as a render pipeline with the
 * render-target format it really uses at run time (rgba16float / rgba32float state, r32float scalar fields) under DEFAULT limits.
 */
const enabled = !!process.env.DAWN;
describe.skipIf(!enabled)('Fluid 2D passes build pipelines with their real target formats (Dawn null backend)', () => {
  it('every pass x format validates', async () => {
    const dir = process.env.DAWN_PATH ?? 'webgpu';
    const mod = (await import(/* @vite-ignore */ dir)) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const gpu = mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']);
    const dev = await (await gpu.requestAdapter())!.requestDevice(); // default limits: no requiredLimits
    const failures: string[] = [];
    let n = 0;
    const build = async (label: string, code: string, fmt: GPUTextureFormat): Promise<void> => {
      const m = dev.createShaderModule({ code });
      const info = await m.getCompilationInfo();
      const errs = info.messages.filter((x) => x.type === 'error');
      if (errs.length) failures.push(`${label}: ${errs[0].message}`);
      dev.pushErrorScope('validation');
      dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs_main' }, fragment: { module: m, entryPoint: 'fs_main', targets: [{ format: fmt }] } });
      const err = await dev.popErrorScope();
      if (err) failures.push(`${label} [${fmt}]: ${err.message.split('\n')[0]}`);
      n++;
    };
    for (const [name, d] of Object.entries(PASS_DEFS)) {
      const a = assembleFullscreenShader({ shader: FLUID_SHADER, uniforms: FLUID_LAYOUT, textures: d.t, storage: 0, mode: 'raw', defines: { PASS: d.id } });
      const fmts: GPUTextureFormat[] = d.fmt === 'state' ? ['rgba16float', 'rgba32float'] : d.fmt === 'r32' ? ['r32float'] : ['rgba16float', 'rgba32float', 'r32float'];
      for (const f of fmts) await build(`fluid:${name}`, a.code, f);
    }
    for (const o of SIM_OUTPUTS) {
      const a = assembleFullscreenShader({ shader: OUT_SHADER, uniforms: OUT_LAYOUT, textures: 2, storage: 0, defines: { OUT: o.code } });
      await build(`out:${o.id}`, a.code, 'rgba16float');
    }
    expect(n).toBeGreaterThan(40);
    expect(failures.join('\n')).toBe('');
  });
});

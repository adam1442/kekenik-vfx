import { describe, expect, it } from 'vitest';
import { BLIT_LAYOUT, BLIT_SHADER } from '../src/engine/anim/flipbook-bake';
import { assembleFullscreenShader } from '../src/engine/shaders/assemble';

/** Opt-in real WGSL compilation of the Sheet Encode blit (engine shader, not a node declaration): `DAWN=1 npx vitest run tests/anim-dawn.test.ts`. */
describe.skipIf(!process.env.DAWN)('WGSL (Tint)', () => {
  it('flipbook blit compiles and builds a pipeline', async () => {
    const mod = (await import(/* @vite-ignore */ process.env.DAWN_PATH ?? 'webgpu')) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const dev = await (await mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']).requestAdapter())!.requestDevice();
    const a = assembleFullscreenShader({ shader: BLIT_SHADER, uniforms: BLIT_LAYOUT, textures: 2 });
    const m = dev.createShaderModule({ code: a.code });
    const errs = (await m.getCompilationInfo()).messages.filter((x) => x.type === 'error').map((x) => x.message);
    expect(errs).toEqual([]);
    dev.pushErrorScope('validation');
    dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs_main' }, fragment: { module: m, entryPoint: 'fs_main', targets: [{ format: 'rgba16float' }] } });
    expect(await dev.popErrorScope()).toBeNull();
  });
});

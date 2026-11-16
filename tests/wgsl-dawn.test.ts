import { describe, expect, it } from 'vitest';
import { assembleFullscreenShader } from '../src/engine/shaders/assemble';
import { wgslLibrary } from '../src/engine/shaders/library';
import { preprocess } from '../src/engine/shaders/preprocess';
import { REDUCE_SHADER } from '../src/nodes/_shared/reduce';
import { CCL_SHADER, STATS_SHADER } from '../src/nodes/_shared/islands';
import { DISPLAY, DISPLAY_LAYOUT } from '../src/panels/viewport-2d/display';
import { makeRegistry } from './helpers';

/**
 * Opt-in, REAL WGSL compilation (Tint) without a GPU: Dawn's `null` backend validates createShaderModule.
 *   npm i --no-save webgpu && DAWN=1 npx vitest run tests/wgsl-dawn.test.ts
 * (the `webgpu` package = Dawn bindings for node; it is NOT a project dependency.)
 */
const enabled = !!process.env.DAWN;
describe.skipIf(!enabled)('WGSL compiles in Tint (Dawn null backend)', () => {
  it('every node shader compiles without errors', async () => {
    const dir = process.env.DAWN_PATH ?? 'webgpu';
    const mod = (await import(/* @vite-ignore */ dir)) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const gpu = mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']);
    const adapter = await gpu.requestAdapter();
    expect(adapter).toBeTruthy();
    const dev = await adapter!.requestDevice();
    const reg = makeRegistry();
    const failures: string[] = [];
    let n = 0;
    for (const def of reg.list()) {
      for (const d of def.shaders ?? []) {
        const a = assembleFullscreenShader({ shader: d.source, uniforms: d.uniforms, textures: d.textures ?? 0, storage: d.storage ?? 0, mode: d.mode, defines: d.defines });
        const m = dev.createShaderModule({ code: a.code });
        const info = await m.getCompilationInfo();
        n++;
        // Also build a real render pipeline (layout 'auto'): validates bindings, texture counts per stage, uniform sizes.
        if (!info.messages.some((x) => x.type === 'error')) {
          dev.pushErrorScope('validation');
          dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: d.vertexEntry ?? 'vs_main' }, fragment: { module: m, entryPoint: 'fs_main', targets: [{ format: 'r16float' }] } });
          const err = await dev.popErrorScope();
          if (err) failures.push(`${def.id}/${d.source.name} pipeline: ${err.message.split('\n')[0]}`);
        }
        for (const msg of info.messages) {
          if (msg.type !== 'error') continue;
          const line = a.map[msg.lineNum - 1];
          failures.push(`${def.id}/${d.source.name} ${line ? `${line.file}:${line.line}` : `L${msg.lineNum}`}: ${msg.message}`);
        }
      }
    }
    expect(n).toBeGreaterThan(3);
    expect(failures.join('\n')).toBe('');
  });

  it('compute shaders compile and validate (reduction: init / main / finalize)', async () => {
    const dir = process.env.DAWN_PATH ?? 'webgpu';
    const mod = (await import(/* @vite-ignore */ dir)) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const gpu = mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']);
    const dev = await (await gpu.requestAdapter())!.requestDevice();
    const files = { ...wgslLibrary, 'node:reduce': REDUCE_SHADER.code, __root__: '#include "node:reduce"' };
    const code = preprocess('__root__', files, {}).code;
    const m = dev.createShaderModule({ code });
    const info = await m.getCompilationInfo();
    expect(info.messages.filter((x) => x.type === 'error').map((x) => `${x.lineNum}: ${x.message}`).join('\n')).toBe('');
    for (const entry of ['init', 'main', 'finalize']) {
      dev.pushErrorScope('validation');
      dev.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: entry } });
      const err = await dev.popErrorScope();
      expect(err?.message ?? '', entry).toBe('');
    }
  });

  it('Islands compute shaders compile and validate (union-find: init / hook / compress, stats: init / accumulate / finalize)', async () => {
    const dir = process.env.DAWN_PATH ?? 'webgpu';
    const mod = (await import(/* @vite-ignore */ dir)) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const gpu = mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']);
    const dev = await (await gpu.requestAdapter())!.requestDevice();
    for (const [shader, entries] of [
      [CCL_SHADER, ['init', 'hook', 'compress']],
      [STATS_SHADER, ['init', 'accumulate', 'finalize']],
    ] as const) {
      const files = { ...wgslLibrary, 'node:x': shader.code, __root__: '#include "node:x"' };
      const m = dev.createShaderModule({ code: preprocess('__root__', files, {}).code });
      const info = await m.getCompilationInfo();
      expect(info.messages.filter((x) => x.type === 'error').map((x) => `${shader.name} ${x.lineNum}: ${x.message}`).join('\n')).toBe('');
      for (const entry of entries) {
        dev.pushErrorScope('validation');
        dev.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: entry } });
        const err = await dev.popErrorScope();
        expect(err?.message ?? '', `${shader.name}/${entry}`).toBe('');
      }
    }
  });
  it('2D viewport display shader (A / B / simulation overlay textures) compiles and builds a pipeline', async () => {
    const dir = process.env.DAWN_PATH ?? 'webgpu';
    const mod = (await import(/* @vite-ignore */ dir)) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const gpu = mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']);
    const dev = await (await gpu.requestAdapter())!.requestDevice();
    const a = assembleFullscreenShader({ shader: DISPLAY, uniforms: DISPLAY_LAYOUT, textures: 3, storage: 0, mode: 'raw' });
    const m = dev.createShaderModule({ code: a.code });
    const info = await m.getCompilationInfo();
    expect(info.messages.filter((x) => x.type === 'error').map((x) => `${x.lineNum}: ${x.message}`).join('\n')).toBe('');
    dev.pushErrorScope('validation');
    dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs_main' }, fragment: { module: m, entryPoint: 'fs_main', targets: [{ format: 'bgra8unorm' }] } });
    const err = await dev.popErrorScope();
    expect(err?.message ?? '').toBe('');
  });
});

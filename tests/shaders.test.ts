import { describe, expect, it } from 'vitest';
import { preprocess } from '../src/engine/shaders/preprocess';
import { assembleFullscreenShader } from '../src/engine/shaders/assemble';
import { BACKGROUND_BLEND, BACKGROUND_BLEND_LAYOUT, CONVERT_GRAY_COLOR, PRESENT, PRESENT_LAYOUT } from '../src/engine/shaders/builtin';
import { BINDING_DEPENDENT_MODULES, defineShader, wgslLibrary } from '../src/engine/shaders/library';
import { makeLayout, packUniforms } from '../src/engine/shaders/uniforms';
import { makeRegistry } from './helpers';

describe('preprocessor', () => {
  it('handles include (once), define substitution and conditionals', () => {
    const files = {
      a: '#include "b"\n#include "b"\nfn a() -> f32 { return N; }',
      b: 'fn b() {}\n#ifdef FAST\nfast\n#else\nslow\n#endif',
    };
    const r = preprocess('a', files, { N: 3 });
    expect(r.code.split('\n').filter((l) => l === 'fn b() {}')).toHaveLength(1);
    expect(r.code).toContain('return 3;');
    expect(r.code).toContain('slow');
    expect(r.code).not.toContain('fast');
    expect(preprocess('a', files, { N: 3, FAST: true }).code).toContain('fast');
  });
  it('maps output lines back to file:line', () => {
    const r = preprocess('root', { root: 'x\n#include "inc"\ny', inc: 'p\nq' });
    expect(r.map).toEqual([
      { file: 'root', line: 1 },
      { file: 'inc', line: 1 },
      { file: 'inc', line: 2 },
      { file: 'root', line: 3 },
    ]);
  });
  it('evaluates #if expressions and #elif', () => {
    const src = '#if A > 1 && !defined(B)\none\n#elif A == 1\nuno\n#else\nzero\n#endif';
    expect(preprocess('r', { r: src }, { A: 2 }).code).toBe('one');
    expect(preprocess('r', { r: src }, { A: 1 }).code).toBe('uno');
    expect(preprocess('r', { r: src }, { A: 2, B: 1 }).code).toBe('zero');
  });
  it('reports errors with file and line', () => {
    expect(() => preprocess('r', { r: 'a\n#include "nope"' })).toThrow(/r:2/);
    expect(() => preprocess('r', { r: '#if 1\nx' })).toThrow(/unterminated/);
  });
});

describe('uniform layout', () => {
  it('follows WGSL alignment rules', () => {
    const l = makeLayout([
      { name: 'a', type: 'f32' },
      { name: 'b', type: 'vec2f' },
      { name: 'c', type: 'vec3f' },
      { name: 'd', type: 'f32' },
      { name: 'e', type: 'vec4f' },
    ]);
    expect(l.offsets).toEqual([0, 8, 16, 28, 32]);
    expect(l.size).toBe(48);
  });
  it('packs mixed types and rejects typos', () => {
    const l = makeLayout([
      { name: 'x', type: 'f32' },
      { name: 'n', type: 'i32' },
      { name: 'u', type: 'u32' },
      { name: 'v', type: 'vec2f' },
    ]);
    const buf = packUniforms(l, { x: 1.5, n: -3, u: true, v: [2, 3] });
    expect(new Float32Array(buf)[0]).toBe(1.5);
    expect(new Int32Array(buf)[1]).toBe(-3);
    expect(new Uint32Array(buf)[2]).toBe(1);
    expect(Array.from(new Float32Array(buf, 16, 2))).toEqual([2, 3]);
    expect(() => packUniforms(l, { x: 1, n: 1, u: 1, v: [1, 2], oops: 1 })).toThrow(/Unknown uniform/);
    expect(() => packUniforms(l, { x: 1, n: 1, u: 1 })).toThrow(/Missing uniform/);
  });
});

/** Optional: validate WGSL syntax with wgsl_reflect (dev-only tool, not a dependency): WGSL_REFLECT=/path/to/wgsl_reflect.module.js */
async function maybeParser(): Promise<((code: string) => void) | null> {
  const path = process.env.WGSL_REFLECT;
  if (!path) return null;
  const mod = (await import(/* @vite-ignore */ path)) as { WgslParser: new () => { parse(c: string): unknown } };
  return (code) => void new mod.WgslParser().parse(code);
}

describe('WGSL assembly (all shaders)', () => {
  const reg = makeRegistry();
  const jobs: { name: string; code: string }[] = [];
  for (const def of reg.list()) {
    for (const d of def.shaders ?? []) {
      jobs.push({ name: `${def.id}/${d.source.name}`, code: assembleFullscreenShader({ shader: d.source, uniforms: d.uniforms, textures: d.textures ?? 0, storage: d.storage ?? 0, mode: d.mode, defines: d.defines }).code });
    }
  }
  jobs.push({ name: 'builtin/convert', code: assembleFullscreenShader({ shader: CONVERT_GRAY_COLOR, textures: 1 }).code });
  jobs.push({ name: 'builtin/blend', code: assembleFullscreenShader({ shader: BACKGROUND_BLEND, uniforms: BACKGROUND_BLEND_LAYOUT, textures: 2 }).code });
  jobs.push({ name: 'builtin/present', code: assembleFullscreenShader({ shader: PRESENT, uniforms: PRESENT_LAYOUT, textures: 1, mode: 'raw' }).code });
  for (const [mod, code] of Object.entries(wgslLibrary)) {
    if (BINDING_DEPENDENT_MODULES.has(mod)) continue;
    const dummy = defineShader(`lib_${mod}.wgsl`, `#include "${mod}"\n@fragment fn fs_main(in: VsOut) -> @location(0) vec4f { return vec4f(0.0); }`);
    jobs.push({ name: `library/${mod}`, code: assembleFullscreenShader({ shader: dummy, textures: 0, mode: 'raw' }).code });
    void code;
  }

  it('every shader assembles (includes resolve, no leftover directives)', () => {
    expect(jobs.length).toBeGreaterThan(8);
    for (const j of jobs) {
      expect(j.code, j.name).not.toMatch(/^\s*#/m);
      expect(j.code, j.name).toContain('fn fs_main');
    }
  });
  it('every shader parses as WGSL (when WGSL_REFLECT is set)', async () => {
    const parse = await maybeParser();
    if (!parse) return;
    for (const j of jobs) {
      try {
        parse(j.code);
      } catch (e) {
        throw new Error(`WGSL syntax error in ${j.name}: ${(e as Error).message}`, { cause: e });
      }
    }
  });
});

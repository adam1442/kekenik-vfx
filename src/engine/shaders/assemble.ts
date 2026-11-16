import type { ShaderSource } from './library';
import { wgslLibrary } from './library';
import { preprocess, type Defines } from './preprocess';
import type { AssembledShader } from './pipelines';
import { makeLayout, type UniformLayout } from './uniforms';

/**
 * Pure (GPU-free) shader assembly shared by PassRunner and by the unit tests / offline WGSL validation.
 * See passes.ts for the documented bind group layout.
 */
export const FRAME_LAYOUT = makeLayout([
  { name: 'res', type: 'vec2f' },
  { name: 'region_origin', type: 'vec2f' },
  { name: 'full_res', type: 'vec2f' },
  { name: 'time', type: 'f32' },
  { name: 'loop_phase', type: 'f32' },
  { name: 'tile', type: 'vec2u' },
  { name: 'seed', type: 'u32' },
  { name: 'ss', type: 'u32' },
  { name: 'filter_mode', type: 'u32' },
  { name: 'hq', type: 'u32' },
]);

/** Generated binding prelude: Frame struct + F, optional Params + P, textures t0.., storage buffers s0.. */
export function generatePrelude(params: UniformLayout | undefined, nTex: number, nStorage: number): string {
  const L: string[] = [FRAME_LAYOUT.wgsl('Frame'), '@group(0) @binding(0) var<uniform> F: Frame;'];
  if (params) L.push(params.wgsl('Params'), '@group(0) @binding(1) var<uniform> P: Params;');
  for (let i = 0; i < nTex; i++) L.push(`@group(0) @binding(${2 + i}) var t${i}: texture_2d<f32>;`);
  for (let i = 0; i < nStorage; i++) L.push(`@group(0) @binding(${2 + nTex + i}) var<storage, read> s${i}: array<f32>;`);
  L.push('#include "frame"');
  return L.join('\n');
}

export interface FullscreenAssembly {
  shader: ShaderSource;
  defines?: Defines;
  uniforms?: UniformLayout;
  textures: number;
  storage?: number;
  mode?: 'shade' | 'raw';
  label?: string;
}

export function assembleFullscreenShader(a: FullscreenAssembly): AssembledShader {
  const mode = a.mode ?? 'shade';
  const userName = `node:${a.shader.name}`;
  const files: Record<string, string> = {
    ...wgslLibrary,
    prelude: generatePrelude(a.uniforms, a.textures, a.storage ?? 0),
    [userName]: a.shader.code,
    __root__: `#include "common"\n#include "prelude"\n#include "${userName}"\n${mode === 'shade' ? '#include "ss_main"' : ''}`,
  };
  const r = preprocess('__root__', files, a.defines);
  return { code: r.code, map: r.map, label: a.label ?? a.shader.name };
}

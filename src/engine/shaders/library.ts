import { hashString } from '../../shared/util';

/**
 * WGSL library: every file in ./wgsl/*.wgsl is a module that can be pulled with `#include "name"` (file name
 * without extension). Library modules must be PURE (functions/consts/structs only, no global bindings), except
 * `frame` and `ss_main`, which are included by the pass helper AFTER the generated bindings exist.
 */
const raw = import.meta.glob('./wgsl/*.wgsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const wgslLibrary: Record<string, string> = {};
for (const [path, code] of Object.entries(raw)) {
  wgslLibrary[path.split('/').pop()!.replace(/\.wgsl$/, '')] = code;
}

/** Library modules that may only be compiled inside a pass (they reference generated bindings). */
export const BINDING_DEPENDENT_MODULES = new Set(['frame', 'ss_main', 'fractal_core', 'lut_curve', 'lut_gradient']);

/** A shader source with a stable content-derived id (used in pipeline cache keys). Create once at module load. */
export interface ShaderSource {
  name: string;
  code: string;
  id: string;
}

export function defineShader(name: string, code: string): ShaderSource {
  return { name, code, id: `${name}#${hashString(code).toString(36)}` };
}

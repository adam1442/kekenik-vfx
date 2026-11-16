/**
 * Uniform block layout + packing following WGSL `uniform` address-space rules (std140-like):
 *   f32/i32/u32: size 4, align 4 | vec2: 8/8 | vec3: 12/16 | vec4: 16/16. Struct size rounded up to 16.
 * A vec3 may be followed by a scalar in the same 16-byte slot (WGSL behaves that way) and this code does too.
 * `layout.wgsl('Params')` generates the matching WGSL struct, so shaders never hand-write offsets.
 */
export type UType = 'f32' | 'i32' | 'u32' | 'vec2f' | 'vec3f' | 'vec4f' | 'vec2i' | 'vec3i' | 'vec4i' | 'vec2u' | 'vec3u' | 'vec4u';
export interface UField {
  name: string;
  type: UType;
  /**
   * Array length. Only `vec4f` arrays are supported: stride 16 satisfies the WGSL
   * uniform rule. Pack with a flat array of 4*count floats. Used for baked curve LUTs (see shaders/lut.ts).
   */
  count?: number;
}
export interface UniformLayout {
  fields: UField[];
  offsets: number[];
  /** Total byte size, multiple of 16. */
  size: number;
  /** Stable key, used for caching bind group layouts. */
  key: string;
  wgsl(structName: string): string;
}
export type UniformValue = number | boolean | ArrayLike<number>;

const INFO: Record<UType, { size: number; align: number; comps: number; kind: 'f' | 'i' | 'u' }> = {
  f32: { size: 4, align: 4, comps: 1, kind: 'f' },
  i32: { size: 4, align: 4, comps: 1, kind: 'i' },
  u32: { size: 4, align: 4, comps: 1, kind: 'u' },
  vec2f: { size: 8, align: 8, comps: 2, kind: 'f' },
  vec3f: { size: 12, align: 16, comps: 3, kind: 'f' },
  vec4f: { size: 16, align: 16, comps: 4, kind: 'f' },
  vec2i: { size: 8, align: 8, comps: 2, kind: 'i' },
  vec3i: { size: 12, align: 16, comps: 3, kind: 'i' },
  vec4i: { size: 16, align: 16, comps: 4, kind: 'i' },
  vec2u: { size: 8, align: 8, comps: 2, kind: 'u' },
  vec3u: { size: 12, align: 16, comps: 3, kind: 'u' },
  vec4u: { size: 16, align: 16, comps: 4, kind: 'u' },
};

export function makeLayout(fields: UField[]): UniformLayout {
  const offsets: number[] = [];
  let off = 0;
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.name)) throw new Error(`Duplicate uniform field "${f.name}"`);
    seen.add(f.name);
    const i = INFO[f.type];
    if (f.count !== undefined && (f.type !== 'vec4f' || !Number.isInteger(f.count) || f.count < 1)) throw new Error(`Uniform "${f.name}": arrays must be vec4f with an integer count >= 1`);
    off = Math.ceil(off / i.align) * i.align;
    offsets.push(off);
    off += i.size * (f.count ?? 1);
  }
  const size = Math.max(16, Math.ceil(off / 16) * 16);
  const key = fields.map((f) => `${f.name}:${f.type}${f.count ? `[${f.count}]` : ''}`).join(',');
  return {
    fields,
    offsets,
    size,
    key,
    wgsl: (name) => `struct ${name} {\n${fields.map((f) => `  ${f.name}: ${f.count ? `array<vec4f, ${f.count}>` : f.type},`).join('\n')}\n};`,
  };
}

/** A value for every field of `layout` (all zero). Used where a pass is only recorded to compile its pipeline (prewarm). */
export function zeroUniforms(layout: UniformLayout): Record<string, UniformValue> {
  const out: Record<string, UniformValue> = {};
  for (const f of layout.fields) {
    const comps = INFO[f.type].comps * (f.count ?? 1);
    out[f.name] = comps === 1 ? 0 : new Array<number>(comps).fill(0);
  }
  return out;
}

/** Pack values into an ArrayBuffer. Missing and unknown fields throw (catches typos early). */
export function packUniforms(layout: UniformLayout, values: Record<string, UniformValue>, target?: ArrayBuffer): ArrayBuffer {
  const buf = target ?? new ArrayBuffer(layout.size);
  const f32 = new Float32Array(buf);
  const i32 = new Int32Array(buf);
  const u32 = new Uint32Array(buf);
  const names = new Set(layout.fields.map((f) => f.name));
  for (const k of Object.keys(values)) if (!names.has(k)) throw new Error(`Unknown uniform "${k}" (layout: ${layout.key})`);
  layout.fields.forEach((f, idx) => {
    const v = values[f.name];
    if (v === undefined) throw new Error(`Missing uniform "${f.name}"`);
    const info = INFO[f.type];
    const base = layout.offsets[idx] / 4;
    const arr: ArrayLike<number> = typeof v === 'number' ? [v] : typeof v === 'boolean' ? [v ? 1 : 0] : v;
    const comps = info.comps * (f.count ?? 1);
    if (arr.length !== comps) throw new Error(`Uniform "${f.name}" expects ${comps} components, got ${arr.length}`);
    for (let c = 0; c < comps; c++) {
      const x = arr[c];
      if (info.kind === 'f') f32[base + c] = x;
      else if (info.kind === 'i') i32[base + c] = Math.trunc(x);
      else u32[base + c] = Math.max(0, Math.floor(x)) >>> 0;
    }
  });
  return buf;
}

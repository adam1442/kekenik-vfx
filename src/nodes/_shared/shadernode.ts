/**
 * shaderNode: data-driven wrapper around `defineNode` for the Vector / simulation-helper nodes.
 * One fragment shader, uniforms generated from the ParamSchema (float f32, int i32, bool / enum / seed u32, vec2 vec2f, vec3 vec3f,
 * color vec4f), `has_<pin>` flags for optional inputs, textures bound in the order of the texture input pins, and
 * `#define OUT n` selecting the output (`code` of each output pin). Everything else (gizmos, gallery, i18n terms, tiling) is plain
 * `defineNode`. Nodes needing several passes use `shaderPasses()` inside their own `evaluate`.
 */
import { defineNode, type EvalContext } from '../../engine/graph/node';
import type { PinDef } from '../../engine/graph/pins';
import { defineShader } from '../../engine/shaders/library';
import { makeLayout, type UField, type UniformLayout, type UniformValue } from '../../engine/shaders/uniforms';
import type { TextureValue } from '../../engine/resources/values';
import type { GpuTexture } from '../../engine/resources/memory';
import type { ParamSchema } from '../../engine/params/schema';
import type { PinType, TexturePin } from '../../engine/types';

type NodeSpec = Parameters<typeof defineNode>[0];
const TEXTURE_PINS = new Set<string>(['gray', 'color', 'normal', 'uv', 'vector']);
export const isTexturePin = (t: PinType): boolean => TEXTURE_PINS.has(t);

export interface ShaderOut {
  id: string;
  name: string;
  type: PinType;
  /** `#define OUT` value of the shader (default: index). */
  code?: number;
  tooltip?: string;
}

export interface ShaderNodeSpec {
  id: string;
  title: string;
  category?: 'vector' | 'simulation' | 'utils';
  description: string;
  keywords: string[];
  icon?: string;
  inputs?: PinDef[];
  outputs: ShaderOut[];
  params: ParamSchema;
  shader: string;
  /** Vector outputs: carry the `vecScale` of the first Vector input (default) or this constant. */
  vecScale?: number;
  gizmos?: NodeSpec['gizmos'];
  gallery?: NodeSpec['gallery'];
  timeDependent?: NodeSpec['timeDependent'];
  cost?: NodeSpec['cost'];
  blending?: boolean;
  extraFields?: UField[];
  /** Additional uniform values computed from the context (spline tables, frame count ...). */
  extra?: (ctx: EvalContext) => Record<string, UniformValue>;
  /** Pins that must be connected (Error badge otherwise). */
  required?: string[];
  /** Extra defines for every pass. */
  defines?: Record<string, number>;
  /** Gray / Color variants: ids of the input / output pins that become the image kind (the shader gets `COLOR` 0 / 1). */
  imagePins?: string[];
  /** Multi-pass nodes: replaces the default single pass evaluation (use `shaderPass`). */
  evaluate?: (ctx: EvalContext, rt: ShaderRuntime) => ReturnType<NodeSpec['evaluate']>;
  /** Extra declarations for `shaders` (one per define variant) when `evaluate` is custom; the special key `TEX` = bound texture count of that variant. */
  variantDefines?: Record<string, number>[];
}

export interface ShaderRuntime {
  layout: UniformLayout;
  shader: ReturnType<typeof defineShader>;
  texPins: PinDef[];
  values(ctx: EvalContext): Record<string, UniformValue>;
}

export function buildRuntime(spec: ShaderNodeSpec): ShaderRuntime {
  const shader = defineShader(`${spec.id.replace(/\./g, '_')}.wgsl`, spec.shader);
  const texPins = (spec.inputs ?? []).filter((i) => isTexturePin(i.type));
  const fields: UField[] = [];
  for (const d of spec.params) {
    switch (d.type) {
      case 'float': fields.push({ name: d.id, type: 'f32' }); break;
      case 'int': fields.push({ name: d.id, type: 'i32' }); break;
      case 'bool': case 'enum': case 'seed': fields.push({ name: d.id, type: 'u32' }); break;
      case 'vec2': fields.push({ name: d.id, type: 'vec2f' }); break;
      case 'vec3': fields.push({ name: d.id, type: 'vec3f' }); break;
      case 'color': fields.push({ name: d.id, type: 'vec4f' }); break;
      default: break;
    }
  }
  for (const i of texPins) fields.push({ name: `has_${i.id}`, type: 'u32' });
  fields.push(...(spec.extraFields ?? []));
  const layout = makeLayout(fields);
  const values = (ctx: EvalContext): Record<string, UniformValue> => {
    const p = ctx.params;
    const v: Record<string, UniformValue> = {};
    for (const d of spec.params) {
      switch (d.type) {
        case 'float': v[d.id] = p.num(d.id); break;
        case 'int': v[d.id] = p.int(d.id); break;
        case 'bool': v[d.id] = p.bool(d.id) ? 1 : 0; break;
        case 'enum': v[d.id] = p.enumIndex(d.id); break;
        case 'seed': v[d.id] = p.seed(d.id) >>> 0; break;
        case 'vec2': v[d.id] = p.vec2(d.id); break;
        case 'vec3': v[d.id] = p.vec3(d.id); break;
        case 'color': v[d.id] = p.rgba(d.id); break;
        default: break;
      }
    }
    for (const i of texPins) v[`has_${i.id}`] = ctx.texInput(i.id) ? 1 : 0;
    if (spec.extra) Object.assign(v, spec.extra(ctx));
    return v;
  };
  return { layout, shader, texPins, values };
}

/** Run the node shader once into `target` (for multi-pass nodes; `over` overrides uniform values, `defines` selects the variant). */
export function shaderPass(ctx: EvalContext, rt: ShaderRuntime, label: string, target: GpuTexture, textures: (GpuTexture | null)[], vals: Record<string, UniformValue>, defines: Record<string, number>): void {
  ctx.pass({ label, target, shader: rt.shader, uniforms: { layout: rt.layout, values: vals }, textures, defines, ss: 1 });
}

/** Gray + Color definitions of one spec (the pins listed in `imagePins` change type, `COLOR` define, `_color` id suffix). */
export function shaderNodeVariants(spec: ShaderNodeSpec): ReturnType<typeof defineNode>[] {
  return (['gray', 'color'] as const).map((k) =>
    shaderNode({
      ...spec,
      id: k === 'color' ? `${spec.id}_color` : spec.id,
      title: k === 'color' ? `${spec.title} (Color)` : spec.title,
      inputs: spec.inputs?.map((i) => (spec.imagePins?.includes(i.id) ? { ...i, type: k } : i)),
      outputs: spec.outputs.map((o) => (spec.imagePins?.includes(o.id) ? { ...o, type: k } : o)),
      defines: { ...(spec.defines ?? {}), COLOR: k === 'color' ? 1 : 0 },
      imagePins: undefined,
    }),
  );
}

export function shaderNode(spec: ShaderNodeSpec): ReturnType<typeof defineNode> {
  const rt = buildRuntime(spec);
  const outs = spec.outputs.map((o, i) => ({ ...o, code: o.code ?? i }));
  const inputs = (spec.inputs ?? []).map((i) => ({ optional: true, ...i }));
  const vectorOut = outs[0]?.type === 'vector';
  return defineNode({
    id: spec.id,
    version: 1,
    category: spec.category ?? 'vector',
    title: spec.title,
    description: spec.description,
    keywords: spec.keywords,
    icon: spec.icon ?? 'warp',
    inputs,
    outputs: outs.map((o) => ({ id: o.id, name: o.name, type: o.type, tooltip: o.tooltip })),
    params: spec.params,
    common: { texture: true, blending: spec.blending ?? (!vectorOut && inputs.some((i) => i.id === 'input')) },
    timeDependent: spec.timeDependent,
    cost: spec.cost ?? { gpu: 'low', tiling: 'halo', halo: () => 8 },
    gizmos: spec.gizmos,
    gallery: spec.gallery,
    shaders: ((spec.variantDefines ?? outs.map((o) => ({ OUT: o.code }))) as Record<string, number>[]).map((d) => {
      const { TEX, ...rest } = d;
      return { source: rt.shader, uniforms: rt.layout, textures: TEX ?? rt.texPins.length, defines: { ...(spec.defines ?? {}), ...rest } };
    }),
    evaluate(ctx) {
      if (spec.evaluate) return spec.evaluate(ctx, rt);
      for (const r of spec.required ?? []) if (!ctx.texInput(r)) throw new Error(`${spec.title} needs the "${inputs.find((i) => i.id === r)?.name ?? r}" input.`);
      const vals = rt.values(ctx);
      const texs = rt.texPins.map((i) => ctx.texInput(i.id) as TextureValue | undefined);
      const firstVec = rt.texPins.findIndex((i) => i.type === 'vector' && texs[rt.texPins.indexOf(i)]);
      const result: Record<string, TextureValue> = {};
      for (const o of outs) {
        if (!ctx.wants(o.id)) continue;
        const target = ctx.tex(o.type as TexturePin);
        ctx.pass({ label: spec.id, target, shader: rt.shader, uniforms: { layout: rt.layout, values: vals }, textures: texs.map((t) => t?.tex ?? null), defines: { ...(spec.defines ?? {}), OUT: o.code }, ss: 1 });
        const r = ctx.result(target, o.type as TexturePin);
        if (o.type === 'vector') r.vecScale = spec.vecScale ?? (firstVec >= 0 ? texs[firstVec]?.vecScale : undefined) ?? 1;
        result[o.id] = r;
      }
      return result;
    },
  });
}

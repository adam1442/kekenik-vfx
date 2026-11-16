import type { EvalContext, FusableDecl } from '../graph/node';
import type { PinValue } from '../resources/values';
import type { TexturePin } from '../types';

/**
 * the STANDALONE (unfused) evaluation of a node that declares `fusable`. It is generated from the very same declaration the
 * fused path uses (shader source, uniform layout, `uniformValues`), so the two paths cannot drift apart.
 * Texture binding order of the standalone pass: [main input (unless generator head), ...extras]  = t0, t1, ...
 */
export function runFusable(ctx: EvalContext, decl: FusableDecl, outPin: TexturePin, label: string): Record<string, PinValue> {
  const mainPin = decl.main === undefined ? 'input' : decl.main;
  const textures: (ReturnType<EvalContext['texInput']> | null)[] = [];
  if (mainPin) {
    const src = ctx.texInput(mainPin);
    if (!src) throw new Error(`Required input "${mainPin}" is not connected`);
    textures.push(src);
  }
  for (const e of decl.extras ?? []) textures.push(ctx.texInput(e) ?? null);
  const out = ctx.tex(outPin);
  ctx.pass({
    label,
    target: out,
    shader: decl.source,
    defines: decl.defines,
    uniforms: { layout: decl.uniforms, values: decl.uniformValues(ctx.params, { has: (p) => !!ctx.texInput(p), modK: (id) => ctx.mod(id).k }) },
    textures: textures.map((t) => t?.tex ?? null),
    ss: 1,
  });
  return { [decl.output ?? 'output']: ctx.result(out, outPin) };
}

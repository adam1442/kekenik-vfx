import { P } from '../../../engine/params/schema';
import { shaderNode, shaderPass } from '../../_shared/shadernode';
import src from './shader.wgsl?raw';

/** vector.project: Helmholtz (Hodge) projection: removes the divergence of a field with Jacobi pressure iterations. */
export default shaderNode({
  id: 'vector.project',
  title: 'Vector Divergence-Free Project',
  description: 'Makes a vector field divergence-free (incompressible) by solving a pressure Poisson equation with Jacobi iterations and subtracting its gradient. Local: for global accuracy use more iterations or the Fluid 2D solver.',
  keywords: ['vector', 'divergence', 'free', 'project', 'helmholtz', 'incompressible', 'pressure', 'jacobi'],
  inputs: [{ id: 'input', name: 'Vector', type: 'vector' }],
  required: ['input'],
  outputs: [{ id: 'output', name: 'Vector', type: 'vector' }, { id: 'pressure', name: 'Pressure', type: 'gray' }],
  cost: { gpu: 'medium', tiling: 'global' },
  variantDefines: [{ MODE: 0, TEX: 1 }, { MODE: 1, TEX: 2 }, { MODE: 2, TEX: 2 }],
  params: [
    P.int('iterations', 48, { group: 'Solver', label: 'Iterations', min: 1, max: 400, softMax: 160, tooltip: 'Jacobi iterations (even numbers only are used).' }),
    P.float('amount', 1, { group: 'Solver', label: 'Amount', min: 0, max: 1, step: 0.01, display: 'percent', animatable: true, tooltip: '0 = original field, 100% = fully projected.' }),
  ],
  gallery: [{ name: 'Fast (24)', params: { iterations: 24 } }, { name: 'Accurate (160)', params: { iterations: 160 } }],
  shader: src,
  evaluate(ctx, rt) {
    const input = ctx.texInput('input');
    if (!input) throw new Error('Vector Divergence-Free Project needs a Vector input.');
    const vals = rt.values(ctx);
    const iters = Math.max(2, Math.min(400, ctx.params.int('iterations'))) & ~1;
    let a = ctx.tex('gray');
    let b = ctx.tex('gray');
    const div = ctx.tex('gray');
    shaderPass(ctx, rt, 'project divergence', div, [input.tex], vals, { MODE: 0 });
    // p starts at 0: first Jacobi sweep reads a zeroed texture, so run a divergence-only sweep into `a`
    shaderPass(ctx, rt, 'project init', a, [div, div], { ...vals, iterations: 0 }, { MODE: 1 });
    for (let i = 0; i < iters; i++) {
      shaderPass(ctx, rt, 'project jacobi', b, [a, div], vals, { MODE: 1 });
      [a, b] = [b, a];
    }
    const out = ctx.tex('vector');
    shaderPass(ctx, rt, 'project subtract', out, [input.tex, a], vals, { MODE: 2 });
    const r = ctx.result(out, 'vector');
    r.vecScale = input.vecScale ?? 1;
    const res: Record<string, ReturnType<typeof ctx.result>> = { output: r };
    if (ctx.wants('pressure')) res.pressure = ctx.result(a, 'gray');
    return res;
  },
});

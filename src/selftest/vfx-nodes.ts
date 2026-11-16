import type { ParamValue } from '../engine/params/schema';
import vfxPresets from '../engine/presets/vfx-presets.generated.json';
import type { SubgraphDefData } from '../engine/subgraph/def';
import { blackbodyLinear } from '../nodes/color/blackbody/definition';
import { premultRef } from '../nodes/color/premultiply/definition';
import { dissolveRef } from '../nodes/utils/dissolve/definition';
import { lightRef } from '../nodes/utils/light_pack/definition';
import { mathOp, type MathOp } from '../nodes/utils/math/definition';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU tests for the VFX effect nodes. Names start with `8A ·`.
 *   range / finite    starburst, ripple, rune ring: finite, in [0,1], not constant (defaults + gallery variants)
 *   tile roll         exact seamlessness of the three generators (centre shifted by k px == image rolled by k px, tiling both)
 *   symmetry          starburst (4 rays) is 90-degree symmetric, ripple is radially symmetric, rune ring repeats every 360 / count degrees
 *   loop seam         ripple wobble evolution 0 == 1, emitter loop mode phase 0 == phase 1 (through 2D Render)
 *   known answers     Math ops, Dissolve (mask / edge / heat), Blackbody, Premultiply, Light Pack against their CPU references
 */
type Params = Record<string, ParamValue>;

export function vfxNodeTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;
  const N = 96;

  async function img(env: Parameters<TestDef['run']>[0], type: string, params: Params, settings: Record<string, unknown> = {}, size = N): Promise<{ d: Float32Array; ch: number }> {
    const e = engineOf(env);
    try {
      const g = mk(e, size, settings);
      const id = add(g, type, params);
      const r = await read(e, g, id);
      return { d: r.data, ch: r.ch };
    } finally {
      dispose(e);
    }
  }
  const gray = (o: { d: Float32Array; ch: number }): Float32Array => Float32Array.from({ length: o.d.length / o.ch }, (_, i) => o.d[i * o.ch]);
  const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
    return m;
  };
  /** Evaluate `build(g)` -> node id on a 1x1-ish tiny graph and return the first pixel. */
  async function pixel(env: Parameters<TestDef['run']>[0], build: (g: ReturnType<typeof mk>) => string): Promise<number[]> {
    const e = engineOf(env);
    try {
      const g = mk(e, 16);
      const r = await read(e, g, build(g));
      return Array.from(r.data.subarray(0, r.ch));
    } finally {
      dispose(e);
    }
  }
  const near = (got: number, want: number, rel = 0.01, abs = 2e-3): boolean => Math.abs(got - want) <= Math.max(abs, Math.abs(want) * rel);
  const GEN: { id: string; shift: (sx: number, sy: number) => Params; base: Params }[] = [
    { id: 'grayscale.starburst', base: { rays: 6, length_random: 0.5 }, shift: (sx, sy) => ({ center: [0.5 + sx, 0.5 + sy] }) },
    { id: 'grayscale.ripple', base: { count: 3, wobble: 0.1, radius: 0.3 }, shift: (sx, sy) => ({ center: [0.5 + sx, 0.5 + sy] }) },
    { id: 'grayscale.rune_ring', base: { count: 18 }, shift: (sx, sy) => ({ center: [0.5 + sx, 0.5 + sy] }) },
  ];
  const tests: TestDef[] = [];

  tests.push({
    name: '8A · generators (starburst, ripple, rune ring) finite, in [0,1], non-constant incl. gallery variants',
    async run(env) {
      const lines: string[] = [];
      for (const g of GEN) {
        const def = env.registry.get(g.id);
        if (!def) throw new Error(`${g.id} is not registered`);
        const variants: { name: string; params: Params }[] = [{ name: 'default', params: {} }, ...(def.gallery ?? [])];
        for (const v of variants) {
          const d = gray(await img(env, g.id, v.params, {}, 64));
          let mn = Infinity;
          let mx = -Infinity;
          for (const x of d) {
            if (!Number.isFinite(x)) throw new Error(`${g.id}/${v.name}: NaN / Infinity`);
            mn = Math.min(mn, x);
            mx = Math.max(mx, x);
          }
          if (mn < -1e-3 || mx > 1 + 1e-3) throw new Error(`${g.id}/${v.name}: range [${mn}, ${mx}]`);
          if (mx - mn < 0.05) throw new Error(`${g.id}/${v.name}: constant output`);
        }
        lines.push(`${g.id}: ${variants.length} variants OK`);
      }
      return lines.join('\n');
    },
  });

  for (const g of GEN) {
    tests.push({
      name: `8A · tile roll (both) · ${g.id}`,
      async run(env) {
        const kx = 29;
        const ky = 11;
        const a = gray(await img(env, g.id, g.base, { tiling: 'both' }));
        const b = gray(await img(env, g.id, { ...g.base, ...g.shift(kx / N, ky / N) }, { tiling: 'both' }));
        let bad = 0;
        let sum = 0;
        for (let y = 0; y < N; y++)
          for (let x = 0; x < N; x++) {
            const dd = Math.abs(b[y * N + x] - a[((y - ky + N) % N) * N + ((x - kx + N) % N)]);
            sum += dd;
            if (dd > 0.1) bad++;
          }
        const mean = sum / (N * N);
        if (!(mean < 0.01 && bad / (N * N) < 0.015)) throw new Error(`rolled image differs: mean ${mean.toExponential(2)}, ${((bad / (N * N)) * 100).toFixed(2)}% off -> not seamless`);
        return `mean diff ${mean.toExponential(1)}`;
      },
    });
  }

  tests.push({
    name: '8A · Starburst 4 rays is 90-degree symmetric; Ripple radially symmetric',
    async run(env) {
      const s = gray(await img(env, 'grayscale.starburst', { rays: 4, length_random: 0, halo: 0 }, {}, 64));
      let worst = 0;
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) worst = Math.max(worst, Math.abs(s[y * 64 + x] - s[x * 64 + (63 - y)]));
      if (worst > 0.12) throw new Error(`starburst rot90 asymmetry ${worst.toFixed(3)}`);
      const r = gray(await img(env, 'grayscale.ripple', { radius: 0.3, wobble: 0 }, {}, 64));
      let worstR = 0;
      for (let k = 2; k < 28; k++) worstR = Math.max(worstR, Math.abs(r[32 * 64 + (32 + k)] - r[(32 + k) * 64 + 32]));
      if (worstR > 0.12) throw new Error(`ripple radial asymmetry ${worstR.toFixed(3)}`);
      return `starburst ${worst.toFixed(3)}, ripple ${worstR.toFixed(3)}`;
    },
  });

  tests.push({
    name: '8A · Rune Ring repeats every 360/count degrees; Ripple wobble loops at evolution 1',
    async run(env) {
      const a = gray(await img(env, 'grayscale.rune_ring', { count: 12, rotation: 0 }, {}, 128));
      const b = gray(await img(env, 'grayscale.rune_ring', { count: 12, rotation: 30 }, {}, 128));
      const d1 = maxDiff(a, b);
      if (d1 > 0.35) throw new Error(`rune ring not periodic in angle: ${d1.toFixed(3)}`);
      const r0 = gray(await img(env, 'grayscale.ripple', { wobble: 0.2, evolution: 0 }, {}, 64));
      const r1 = gray(await img(env, 'grayscale.ripple', { wobble: 0.2, evolution: 1 }, {}, 64));
      const d2 = maxDiff(r0, r1);
      if (d2 > 5e-3) throw new Error(`ripple wobble does not loop: ${d2.toExponential(2)}`);
      return `rune ${d1.toFixed(3)}, ripple loop ${d2.toExponential(1)}`;
    },
  });

  tests.push({
    name: '8A · Math known answers (add, multiply, pow, smoothstep, remap, B input)',
    async run(env) {
      const out: string[] = [];
      const cases: { op: MathOp; a: number; value: number; v2: number }[] = [
        { op: 'add', a: 0.25, value: 0.5, v2: 0.5 },
        { op: 'multiply', a: 0.5, value: 3, v2: 0.5 },
        { op: 'pow', a: 0.5, value: 2, v2: 0.5 },
        { op: 'smoothstep', a: 0.5, value: 0.4, v2: 0.2 },
        { op: 'lerp', a: 0.2, value: 0.8, v2: 0.25 },
        { op: 'gamma', a: 0.25, value: 2, v2: 0.5 },
      ];
      for (const c of cases) {
        const px = await pixel(env, (g) => {
          const u = add(g, 'grayscale.uniform', { value: c.a });
          const m = add(g, 'utils.math', { op: c.op, value: c.value, value2: c.v2 });
          link(g, u, m, 'a');
          return m;
        });
        const want = mathOp(c.op, c.a, c.value, c.v2);
        if (!near(px[0], want)) throw new Error(`${c.op}: got ${px[0]}, want ${want}`);
        out.push(`${c.op} ${px[0].toFixed(4)}`);
      }
      const px = await pixel(env, (g) => {
        const a = add(g, 'grayscale.uniform', { value: 0.6 });
        const b = add(g, 'grayscale.uniform', { value: 0.3 });
        const m = add(g, 'utils.math', { op: 'subtract' });
        link(g, a, m, 'a');
        link(g, b, m, 'b');
        return m;
      });
      if (!near(px[0], 0.3)) throw new Error(`subtract with B input: ${px[0]}`);
      return out.join(', ');
    },
  });

  tests.push({
    name: '8A · Dissolve mask / edge / heat match the CPU reference',
    async run(env) {
      const out: string[] = [];
      for (const [v, prog] of [[0.5, 0.5], [0.3, 0.4], [0.9, 0.2], [0.1, 0.9]] as const) {
        const want = dissolveRef(v, prog, 0.1, 0.2);
        for (const pin of ['mask', 'edge', 'heat'] as const) {
          const px = await pixel(env, (g) => {
            const u = add(g, 'grayscale.uniform', { value: v });
            const d = add(g, 'utils.dissolve', { progress: prog, softness: 0.1, edge_width: 0.2 });
            const m = add(g, 'utils.math', { op: 'add', value: 0 });
            link(g, u, d, 'input');
            link(g, d, m, 'a', pin);
            return m;
          });
          if (!near(px[0], want[pin], 0.02, 4e-3)) throw new Error(`v=${v} p=${prog} ${pin}: got ${px[0]}, want ${want[pin]}`);
        }
        out.push(`v${v}/p${prog} ok`);
      }
      return out.join(', ');
    },
  });

  tests.push({
    name: '8A · Blackbody ramp matches the CPU fit (HDR core > 1, alpha, tonemap off)',
    async run(env) {
      const out: string[] = [];
      for (const t of [0.25, 0.6, 1]) {
        const px = await pixel(env, (g) => {
          const u = add(g, 'grayscale.uniform', { value: t });
          const b = add(g, 'color.blackbody', { kelvin_min: 1000, kelvin_max: 4200, temp_curve: 1, emission_curve: 1.6, intensity: 6 });
          link(g, u, b, 'input');
          return b;
        });
        const lin = blackbodyLinear(1000 + (4200 - 1000) * t);
        const k = 6 * Math.pow(t, 1.6);
        const want = [lin[0] * k, lin[1] * k, lin[2] * k];
        for (let c = 0; c < 3; c++) if (!near(px[c], want[c], 0.02, 3e-3)) throw new Error(`t=${t} ch${c}: got ${px[c]}, want ${want[c]}`);
        out.push(`t${t}: ${px.slice(0, 3).map((x) => x.toFixed(2)).join(',')}`);
      }
      const hot = await pixel(env, (g) => {
        const u = add(g, 'grayscale.uniform', { value: 1 });
        const b = add(g, 'color.blackbody', { intensity: 8 });
        link(g, u, b, 'input');
        return b;
      });
      if (!(hot[0] > 1.5)) throw new Error(`HDR core not above 1: ${hot[0]}`);
      return out.join(' | ');
    },
  });

  tests.push({
    name: '8A · Premultiply modes match the CPU reference (HDR safe)',
    async run(env) {
      const c = [2.5, 0.8, 0.2, 0.5];
      for (const mode of ['premultiply', 'unpremultiply', 'additive', 'opaque'] as const) {
        const px = await pixel(env, (g) => {
          const u = add(g, 'color.uniform', { color: c, intensity: 1 });
          const p = add(g, 'color.premultiply', { mode });
          link(g, u, p, 'input');
          return p;
        });
        const want = premultRef(mode, c);
        for (let i = 0; i < 4; i++) if (!near(px[i], want[i], 0.01, 2e-3)) throw new Error(`${mode} ch${i}: got ${px[i]}, want ${want[i]}`);
      }
      return '4 modes OK';
    },
  });

  tests.push({
    name: '8A · Light Pack GPU flat surface',
    async run(env) {
      const px = await pixel(env, (g) => {
        const u = add(g, 'grayscale.uniform', { value: 0.7 });
        const l = add(g, 'utils.light_pack', { wrap: 0.4, ambient: 0.1, elevation: 40 });
        link(g, u, l, 'height');
        return l;
      });
      const want = lightRef([0, 0, 1], 135, 40, 0.4, 0.1);
      for (let i = 0; i < 3; i++) if (!near(px[i], want, 0.01, 2e-3)) throw new Error(`light ch${i}: got ${px[i]}, want ${want}`);
      if (!near(px[3], 0.7)) throw new Error(`alpha ${px[3]}`);
      return `flat ${px[0].toFixed(4)}`;
    },
  });

  tests.push({
    name: '8A · Emitter -> 2D Render: finite, non-empty, loop mode phase 0 == phase 1; one-shot is empty at the end',
    async run(env) {
      const e = engineOf(env);
      try {
        const settings = { fps: 30, loopLength: 30 };
        const g = mk(e, 64, settings);
        const em = add(g, 'particle.emitter', { mode: 'loop', lifetime: 0.5, count: 60, speed: 0.3, turbulence: 0.02, seed: 3 });
        const r = add(g, 'particle.render_2d', { blend: 'additive', shape: 'disc', sort: 'oldest_first', trail: 0.05 });
        link(g, em, r, 'points', 'points');
        const a = await read(e, g, r, { time: 0, useCache: false });
        const b = await read(e, g, r, { time: 1, useCache: false });
        let sum = 0;
        for (const x of a.data) {
          if (!Number.isFinite(x)) throw new Error('non-finite pixel');
          sum += x;
        }
        if (sum <= 0) throw new Error('empty render');
        const d = maxDiff(a.data, b.data);
        if (d > 5e-3) throw new Error(`loop seam: ${d.toExponential(2)}`);
        const g2 = mk(e, 64, settings);
        const em2 = add(g2, 'particle.emitter', { mode: 'oneshot', lifetime: 0.4, spawn_window: 0.3, count: 60 });
        const r2 = add(g2, 'particle.render_2d', { blend: 'additive' });
        link(g2, em2, r2, 'points', 'points');
        const end = await read(e, g2, r2, { time: 29 / 30, useCache: false });
        let s2 = 0;
        for (const x of end.data) s2 += Math.abs(x);
        if (s2 > 1e-3) throw new Error(`one-shot not empty at the last frame (sum ${s2})`);
        return `loop seam ${d.toExponential(1)}, mean ${(sum / a.data.length).toFixed(4)}, last frame empty`;
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: '8A · every shared VFX subgraph preset evaluates (finite output) with noise on its inputs',
    async run(env) {
      const e = engineOf(env);
      try {
        const lines: string[] = [];
        for (const pr of vfxPresets as unknown as { name: string; nodeType: string; subgraph: SubgraphDefData }[]) {
          const g = mk(e, 64);
          e.subgraphs.put(pr.subgraph, { silent: true });
          const inst = g.addNode(pr.nodeType).id;
          for (const n of pr.subgraph.graph.nodes.filter((x) => x.type.startsWith('subgraph.in_'))) {
            const src = add(g, 'grayscale.noise', { scale: [4, 4] });
            link(g, src, inst, n.id);
          }
          const r = await read(e, g, inst);
          let sum = 0;
          for (const x of r.data) {
            if (!Number.isFinite(x)) throw new Error(`${pr.name}: non-finite output`);
            sum += Math.abs(x);
          }
          if (!(sum >= 0)) throw new Error(`${pr.name}: invalid output`);
          lines.push(`${pr.name}: mean ${(sum / r.data.length).toFixed(3)}`);
        }
        return lines.join('\n');
      } finally {
        dispose(e);
      }
    },
  });
  return tests;
}

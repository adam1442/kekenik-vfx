import { targetKey } from '../engine/graph/evaluator';
import type { Engine } from '../engine/engine';
import type { Graph, GraphSettings } from '../engine/graph/graph';
import type { ParamValue } from '../engine/params/schema';
import { readTextureFloat32 } from '../engine/resources/readback';
import type { TextureValue } from '../engine/resources/values';
import { blurReference } from '../nodes/_shared/blur2';
import { blendReference, crossReference } from '../nodes/utils/blend/definition';
import { softblendWeight } from '../nodes/utils/softblend/definition';
import type { Helpers } from './generators';
import type { Env, TestDef } from './tests';

/**
 * GPU tests for filters and utility nodes. Names start with `4A ·`. Families:
 *   - every node x gallery variant renders finite AND the texture / buffer pools return to their baseline (no leaks),
 *   - CPU references: blur (gaussian, box, per-axis, pyramid, modulated), blend modes, levels auto, switch, softblend,
 *     transform (exact 90 degree rotation), tile, distance (brute force, wrap), auto crop, channel round trips,
 *   - ROLL tests: shifting the input by whole pixels shifts the output (wrap-correctness for every tiling filter),
 *   - Timing at 2048^2.
 */
type Params = Record<string, ParamValue>;
const N = 64;
const BASES = ['blur', 'directional_blur', 'bilateral', 'kuwahara', 'denoise', 'glow', 'fxaa', 'edge_detect', 'distance', 'levels', 'blend', 'multi_blend', 'softblend', 'multi_switch', 'transform', 'tile', 'grid', 'lattice', 'copy_transform', 'auto_crop', 'alpha_merge', 'alpha_split', 'rgba_merge', 'rgba_split', 'hsva_to_rgba', 'rgba_to_hsva', 'rgb_to_grayscale'];

export function filterTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link } = h;
  const tests: TestDef[] = [];

  async function readPin(e: Engine, g: Graph, nodeId: string, pinId = 'output', opts: Record<string, unknown> = {}): Promise<{ data: Float32Array; ch: number; w: number; h: number }> {
    const res = await e.evaluator.evaluate(g, [{ nodeId, pinId }], opts);
    try {
      const err = res.errors.get(nodeId);
      if (err) throw new Error(`node failed: ${err}`);
      const v = res.values.get(targetKey({ nodeId, pinId })) as TextureValue | undefined;
      if (!v || v.kind !== 'texture') throw new Error('no texture produced');
      const data = await readTextureFloat32(e.gpu, e.mm, v.tex.texture, v.tex.format, v.width, v.height);
      return { data, ch: data.length / (v.width * v.height), w: v.width, h: v.height };
    } finally {
      res.release();
    }
  }
  async function chain(env: Env, size: number, build: (g: Graph) => { id: string; pin?: string }, settings: Partial<GraphSettings> = { tiling: 'both' }) {
    const e = engineOf(env);
    try {
      const g = mk(e, size, settings);
      const t = build(g);
      return await readPin(e, g, t.id, t.pin ?? 'output');
    } finally {
      dispose(e);
    }
  }
  const chan = (r: { data: Float32Array; ch: number }, c = 0): Float32Array => {
    const n = r.data.length / r.ch;
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = r.data[i * r.ch + c];
    return o;
  };
  const noiseP = (extra: Params = {}): Params => ({ noise_type: 'perlin', scale: [5, 5], octaves: 3, seed: 3, ...extra });
  const smoothP = (extra: Params = {}): Params => ({ noise_type: 'perlin', scale: [3, 3], octaves: 1, seed: 8, ...extra });
  const noiseOnly = (env: Env, size = N, extra: Params = {}): Promise<Float32Array> => chain(env, size, (g) => ({ id: add(g, 'grayscale.noise', noiseP(extra)) })).then((r) => chan(r));
  const via = (env: Env, type: string, params: Params, o: { size?: number; noise?: Params; settings?: Partial<GraphSettings>; pin?: string; c?: number; inPin?: string } = {}): Promise<Float32Array> =>
    chain(env, o.size ?? N, (g) => {
      const n = add(g, 'grayscale.noise', noiseP(o.noise));
      const f = add(g, type, params);
      link(g, n, f, o.inPin ?? 'input');
      return { id: f, pin: o.pin };
    }, o.settings ?? { tiling: 'both' }).then((r) => chan(r, o.c ?? 0));
  const maxDiff = (a: Float32Array, b: Float32Array): number => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
  const must = (what: string, d: number, tol: number): void => {
    if (!(d <= tol)) throw new Error(`${what}: error ${d.toExponential(2)} (tolerance ${tol})`);
  };
  const uni = (g: Graph, v: number): string => add(g, 'grayscale.uniform', { value: v });
  const cuni = (g: Graph, c: number[]): string => add(g, 'color.uniform', { color: c, intensity: 1 });
  const pix = (r: { data: Float32Array; ch: number }, c = 0): number => r.data[c]; // first pixel

  /* ---------------------------------------------------------------- all nodes: finite + no pool leaks */
  tests.push({
    name: '4A · every node x gallery variant: finite output on every pin, pools return to baseline (no leaks)',
    async run(env) {
      const ids = env.registry.list().filter((d) => BASES.some((b) => d.id === `utils.${b}` || d.id === `utils.${b}_color`));
      if (ids.length < BASES.length + 12) throw new Error(`expected Gray + Color variants, found only ${ids.length} 4A definitions`);
      const lines: string[] = [];
      for (const d of ids) {
        const e = engineOf(env);
        try {
          const base = { tex: e.mm.textures.liveBytes, buf: e.mm.buffers.liveBytes - e.arena.heldBytes };
          const variants: { name: string; params: Params }[] = [{ name: 'default', params: {} }, ...(d.gallery ?? [])];
          for (const v of variants) {
            const g = mk(e, 64, { tiling: 'both' });
            const node = g.addNode(d.id, { params: v.params }).id;
            let k = 0;
            for (const pin of d.inputs) {
              if (pin.role === 'modulation' || (pin.type !== 'gray' && pin.type !== 'color') || k >= 3) continue;
              const f = g.addNode('grayscale.noise', { params: noiseP({ seed: 5 + k * 3 }) }).id;
              g.connect({ node: f, pin: 'output' }, { node, pin: pin.id });
              k++;
            }
            const targets = d.outputs.filter((o) => ['gray', 'color', 'uv', 'normal'].includes(o.type)).map((o) => ({ nodeId: node, pinId: o.id }));
            const res = await e.evaluator.evaluate(g, targets, { useCache: false });
            try {
              const err = res.errors.get(node);
              if (err) throw new Error(`${d.id}/${v.name}: ${err}`);
              for (const t of targets) {
                const val = res.values.get(targetKey(t)) as TextureValue | undefined;
                if (!val) throw new Error(`${d.id}/${v.name}: pin ${t.pinId} missing`);
                const data = await readTextureFloat32(e.gpu, e.mm, val.tex.texture, val.tex.format, val.width, val.height);
                for (const x of data) if (!Number.isFinite(x)) throw new Error(`${d.id}/${v.name}: NaN / Infinity on pin ${t.pinId}`);
              }
            } finally {
              res.release();
            }
          }
          e.evaluator.cache.clear();
          // the uniform arena keeps a few chunks on purpose (bounded cache): not a leak
          const after = { tex: e.mm.textures.liveBytes, buf: e.mm.buffers.liveBytes - e.arena.heldBytes };
          if (after.tex !== base.tex || after.buf !== base.buf) throw new Error(`${d.id}: LEAK, live texture bytes ${base.tex} -> ${after.tex}, buffer bytes ${base.buf} -> ${after.buf}`);
          lines.push(`${d.id}: ${variants.length} variants OK`);
        } finally {
          dispose(e);
        }
      }
      return lines.join('\n');
    },
  });

  /* ---------------------------------------------------------------- blur vs CPU */
  const blurCase = (name: string, params: Params, sx: number, sy: number, kind: 'gaussian' | 'box', tol: number, noise: Params = {}): TestDef => ({
    name: `4A · Blur ${name} equals the CPU reference (wrap)`,
    async run(env) {
      const src = await noiseOnly(env, N, noise);
      const out = await via(env, 'utils.blur', params, { noise });
      const d = maxDiff(out, blurReference(src, N, N, sx, sy, true, true, kind));
      must(name, d, tol);
      return `max error ${d.toExponential(1)}`;
    },
  });
  tests.push(blurCase('gaussian sigma 3.2 px', { radius: 0.05 }, 3.2, 3.2, 'gaussian', 6e-3));
  tests.push(blurCase('box radius 3', { mode: 'box', radius: 0.05 }, 3, 3, 'box', 6e-3));
  tests.push(blurCase('per-axis (X only)', { radius: 0.05, stretch: [1, 0] }, 3.2, 0, 'gaussian', 6e-3));
  tests.push(blurCase('per-axis box (X 3 px, Y 1 px)', { mode: 'box', radius: 0.05, stretch: [1, 0.3] }, 3, 1, 'box', 6e-3));
  tests.push({
    name: '4A · Blur pyramid hybrid (sigma 16 px at 64²) stays close to the exact gaussian on smooth input',
    async run(env) {
      const src = await noiseOnly(env, N, smoothP());
      const out = await via(env, 'utils.blur', { radius: 0.25 }, { noise: smoothP() });
      const d = maxDiff(out, blurReference(src, N, N, 16, 16, true, true));
      must('pyramid', d, 0.03);
      return `max error ${d.toExponential(1)}`;
    },
  });
  tests.push({
    name: '4A · Blur Kawase: mean preserved, variance reduced, correlates with the gaussian',
    async run(env) {
      const src = await noiseOnly(env, N, smoothP({ octaves: 3 }));
      const out = await via(env, 'utils.blur', { mode: 'kawase', radius: 0.08 }, { noise: smoothP({ octaves: 3 }) });
      const ref = blurReference(src, N, N, 5.12, 5.12, true, true);
      const mean = (a: Float32Array): number => a.reduce((s, v) => s + v, 0) / a.length;
      const vr = (a: Float32Array): number => a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / a.length;
      must('mean', Math.abs(mean(out) - mean(src)), 0.01);
      if (!(vr(out) < vr(src))) throw new Error('variance not reduced');
      const mo = mean(out), mr = mean(ref);
      let c = 0, a = 0, b = 0;
      for (let i = 0; i < out.length; i++) { c += (out[i] - mo) * (ref[i] - mr); a += (out[i] - mo) ** 2; b += (ref[i] - mr) ** 2; }
      const corr = c / Math.sqrt(a * b);
      if (corr < 0.95) throw new Error(`correlation with gaussian only ${corr.toFixed(3)}`);
      return `correlation ${corr.toFixed(3)}`;
    },
  });
  tests.push({
    name: '4A · Blur radius modulation: mod = 0 keeps the input, mod = 1 equals the unmodulated blur',
    async run(env) {
      const e = engineOf(env);
      try {
        const run = async (modValue: number | null): Promise<Float32Array> => {
          const g = mk(e, N, { tiling: 'both' });
          const n = add(g, 'grayscale.noise', noiseP());
          const b = add(g, 'utils.blur', { radius: 0.06 });
          link(g, n, b);
          if (modValue !== null) link(g, uni(g, modValue), b, 'radius_mod');
          return chan(await readPin(e, g, b));
        };
        const src = await noiseOnly(env);
        const m0 = await run(0);
        const m1 = await run(1);
        const plain = await run(null);
        must('mod 0 vs input', maxDiff(m0, src), 4e-3);
        must('mod 1 vs plain blur', maxDiff(m1, plain), 6e-3);
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });

  /* ---------------------------------------------------------------- roll (wrap) tests */
  const roll = (name: string, type: string, params: Params, o: { color?: boolean; tolMean?: number; tolFrac?: number; settings?: Partial<GraphSettings> } = {}): TestDef => ({
    name: `4A · Roll (tiling) · ${name}`,
    async run(env) {
      const kx = 21;
      const ky = 9;
      const a = await via(env, type, params, { settings: o.settings });
      const b = await via(env, type, params, { noise: { offset: [-kx / N, -ky / N] }, settings: o.settings });
      let sum = 0;
      let bad = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const ref = a[((y - ky + N) % N) * N + ((x - kx + N) % N)];
          const d = Math.abs(b[y * N + x] - ref);
          sum += d;
          if (d > 0.08) bad++;
        }
      const mean = sum / (N * N);
      const frac = bad / (N * N);
      if (!(mean <= (o.tolMean ?? 0.006) && frac <= (o.tolFrac ?? 0.01))) throw new Error(`rolled output differs: mean ${mean.toExponential(2)}, ${(frac * 100).toFixed(2)}% off by > 0.08 -> wrap bug`);
      return `mean ${mean.toExponential(1)}, off ${(frac * 100).toFixed(2)}%`;
    },
  });
  tests.push(roll('Blur gaussian', 'utils.blur', { radius: 0.06 }));
  tests.push(roll('Blur pyramid (large)', 'utils.blur', { radius: 0.3 }, { tolMean: 0.012, tolFrac: 0.02 }));
  tests.push(roll('Blur box', 'utils.blur', { mode: 'box', radius: 0.06 }));
  tests.push(roll('Blur kawase', 'utils.blur', { mode: 'kawase', radius: 0.06 }));
  tests.push(roll('Blur Color variant', 'utils.blur_color', { radius: 0.05 }));
  tests.push(roll('Directional blur (jitter off)', 'utils.directional_blur', { angle: 30, length: 0.15, jitter: false }));
  tests.push(roll('Bilateral (exact)', 'utils.bilateral', { radius: 0.06, range: 0.2 }));
  tests.push(roll('Bilateral (separable)', 'utils.bilateral', { radius: 0.06, quality: 'separable' }));
  tests.push(roll('Denoise', 'utils.denoise', {}));
  tests.push(roll('Anisotropic Kuwahara', 'utils.kuwahara', { radius: 0.08 }, { tolMean: 0.01 }));
  tests.push(roll('Edge detect', 'utils.edge_detect', {}));
  tests.push(roll('Edge detect (Color variant)', 'utils.edge_detect_color', { kind: 'laplacian' }));
  tests.push(roll('FXAA', 'utils.fxaa', { threshold: 0.02, min_threshold: 0.001 }));
  tests.push(roll('Glow', 'utils.glow', { threshold: 0.3, radius: 0.15 }, { tolMean: 0.008 }));
  tests.push(roll('Transform (translate)', 'utils.transform', { translate: [0.13, -0.07] }));
  tests.push(roll('Levels', 'utils.levels', { gamma: 2 }));
  tests.push(roll('Distance (mask)', 'utils.distance', { signed: true, max_distance: 0.3 }, { tolMean: 0.01, tolFrac: 0.02 }));

  tests.push({
    name: '4A · Roll (tiling) · Copy and Transform: shifting the scatter offset by whole pixels rolls the image',
    async run(env) {
      const kx = 21;
      const ky = 9;
      const base: Params = { count: 40, size: 0.2, seed: 4 };
      const a = await via(env, 'utils.copy_transform', base);
      const b = await via(env, 'utils.copy_transform', { ...base, offset: [kx / N, ky / N] });
      let bad = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.abs(b[y * N + x] - a[((y - ky + N) % N) * N + ((x - kx + N) % N)]) > 0.08) bad++;
      const frac = bad / (N * N);
      if (frac > 0.02) throw new Error(`${(frac * 100).toFixed(2)}% of pixels differ after the roll`);
      return `off ${(frac * 100).toFixed(2)}%`;
    },
  });
  tests.push({
    name: '4A · Roll (tiling) · Grid: offset by whole pixels rolls every pattern',
    async run(env) {
      const kx = 16;
      const ky = 8;
      const out: string[] = [];
      for (const p of [{ pattern: 'square' }, { pattern: 'bricks', cells: [8, 8] }, { pattern: 'hex', cells: [8, 5], output_kind: 'cells', random_amount: 1 }] as Params[]) {
        const a = await chain(env, N, (g) => ({ id: add(g, 'utils.grid', p) })).then((r) => chan(r));
        const b = await chain(env, N, (g) => ({ id: add(g, 'utils.grid', { ...p, offset: [kx / N, ky / N] }) })).then((r) => chan(r));
        let bad = 0;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.abs(b[y * N + x] - a[((y - ky + N) % N) * N + ((x - kx + N) % N)]) > 0.05) bad++;
        if (bad / (N * N) > 0.01) throw new Error(`${p.pattern}: ${((bad / (N * N)) * 100).toFixed(2)}% differ after the roll`);
        out.push(`${p.pattern}: ok`);
      }
      return out.join(', ');
    },
  });
  tests.push({
    name: '4A · Lattice: zero displacement is identity; periodic jittered warp has no seam',
    async run(env) {
      const src = await noiseOnly(env);
      const id = await via(env, 'utils.lattice', {});
      must('identity', maxDiff(src, id), 2e-3);
      const w = await via(env, 'utils.lattice', { jitter: 0.1, jitter_seed: 5 });
      let seamX = 0, innerX = 0, seamY = 0, innerY = 0;
      for (let y = 0; y < N; y++) {
        seamX += Math.abs(w[y * N + N - 1] - w[y * N]);
        for (let x = 0; x < N - 1; x++) innerX += Math.abs(w[y * N + x + 1] - w[y * N + x]);
      }
      for (let x = 0; x < N; x++) {
        seamY += Math.abs(w[(N - 1) * N + x] - w[x]);
        for (let y = 0; y < N - 1; y++) innerY += Math.abs(w[(y + 1) * N + x] - w[y * N + x]);
      }
      const rx = seamX / N / (innerX / (N * (N - 1)));
      const ry = seamY / N / (innerY / (N * (N - 1)));
      if (rx > 1.6 || ry > 1.6) throw new Error(`seam ratio ${rx.toFixed(2)} / ${ry.toFixed(2)}`);
      return `seam ratio ${rx.toFixed(2)} / ${ry.toFixed(2)}`;
    },
  });

  /* ---------------------------------------------------------------- levels / blend / switch / softblend */
  tests.push({
    name: '4A · Levels auto: GPU reduction stretches min..max to 0..1 (Gray and Color), no CPU readback',
    async run(env) {
      const g1 = await via(env, 'utils.levels', { auto: true }, { noise: { scale: [3, 3], octaves: 1 } });
      let mn = Infinity, mx = -Infinity;
      for (const v of g1) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
      must('gray min', Math.abs(mn), 0.01);
      must('gray max', Math.abs(mx - 1), 0.01);
      const c1 = await chain(env, N, (g) => {
        const n = add(g, 'grayscale.noise', noiseP({ scale: [3, 3], octaves: 1 }));
        const r = add(g, 'color.ramp', {});
        link(g, n, r);
        const l = add(g, 'utils.levels_color', { auto: true });
        link(g, r, l);
        return { id: l };
      });
      let cmn = Infinity, cmx = -Infinity;
      for (let i = 0; i < c1.data.length; i++) if (i % c1.ch < 3) { cmn = Math.min(cmn, c1.data[i]); cmx = Math.max(cmx, c1.data[i]); }
      must('color min', Math.abs(cmn), 0.02);
      must('color max', Math.abs(cmx - 1), 0.02);
      return `gray [${mn.toFixed(3)}, ${mx.toFixed(3)}], color [${cmn.toFixed(3)}, ${cmx.toFixed(3)}]`;
    },
  });
  const SEP = ['copy', 'add', 'subtract', 'multiply', 'max', 'min', 'smooth_min', 'smooth_max', 'screen', 'overlay', 'difference', 'divide', 'exclusion', 'soft_light', 'hard_light', 'color_dodge', 'color_burn', 'linear_light'];
  tests.push({
    name: '4A · Blend: every separable mode equals the CPU formula (fg 0.7 over bg 0.3), cross mix 0 / 100% give bg / fg',
    async run(env) {
      const e = engineOf(env);
      try {
        const lines: string[] = [];
        for (const mode of SEP) {
          const g = mk(e, 4, { tiling: 'both' });
          const b = add(g, 'utils.blend', { blend_type: mode, cross_mix: 0.5, smoothness: 0.1 });
          link(g, uni(g, 0.7), b, 'foreground');
          link(g, uni(g, 0.3), b, 'background');
          const got = pix(await readPin(e, g, b));
          const want = blendReference(mode, 0.3, 0.7, 0.1);
          must(mode, Math.abs(got - want), 3e-3 * Math.max(1, Math.abs(want)));
          lines.push(`${mode}: ${got.toFixed(3)}`);
        }
        for (const [cm, want] of [[0, 0.3], [1, 0.7], [0.25, crossReference(0.3, 0.7, 1.0, 0.25)]]) {
          const g = mk(e, 4);
          const b = add(g, 'utils.blend', { blend_type: 'add', cross_mix: cm });
          link(g, uni(g, 0.7), b, 'foreground');
          link(g, uni(g, 0.3), b, 'background');
          must(`cross ${cm}`, Math.abs(pix(await readPin(e, g, b)) - want), 2e-3);
        }
        // Color luminosity: keeps the background chroma, takes the foreground luminance.
        const g = mk(e, 4);
        const b = add(g, 'utils.blend_color', { blend_type: 'luminosity', cross_mix: 0.5 });
        link(g, cuni(g, [0.5, 0.5, 0.5, 1]), b, 'foreground');
        link(g, cuni(g, [0.4, 0.3, 0.2, 1]), b, 'background');
        const c = await readPin(e, g, b);
        must('luminosity r', Math.abs(c.data[0] - 0.581), 4e-3);
        must('luminosity b', Math.abs(c.data[2] - 0.381), 4e-3);
        return lines.join('  ');
      } finally {
        dispose(e);
      }
    },
  });
  tests.push({
    name: '4A · Blend mask / opacity, Multi Blend (per-layer mode + opacity), Softblend, Multi Switch known answers',
    async run(env) {
      const e = engineOf(env);
      try {
        let g = mk(e, 4);
        let b = add(g, 'utils.blend', { blend_type: 'copy', opacity: 0.5 });
        link(g, uni(g, 1), b, 'foreground');
        link(g, uni(g, 0), b, 'background');
        must('opacity', Math.abs(pix(await readPin(e, g, b)) - 0.5), 2e-3);
        g = mk(e, 4);
        b = add(g, 'utils.blend', { blend_type: 'copy' });
        link(g, uni(g, 1), b, 'foreground');
        link(g, uni(g, 0.2), b, 'background');
        link(g, uni(g, 0.25), b, 'mask');
        must('mask', Math.abs(pix(await readPin(e, g, b)) - (0.2 + 0.8 * 0.25)), 2e-3);
        // multi blend: base 0.2, layer1 copy 0.3, layer2 add 0.25 at 50% => 0.3 + 0.125
        g = mk(e, 4);
        const m = add(g, 'utils.multi_blend', { layers: 2, mode_1: 'copy', mode_2: 'add', opacity_2: 0.5 });
        link(g, uni(g, 0.2), m, 'base');
        link(g, uni(g, 0.3), m, 'layer_1');
        link(g, uni(g, 0.25), m, 'layer_2');
        link(g, uni(g, 0.9), m, 'layer_3'); // beyond `layers`: must be ignored
        must('multi blend', Math.abs(pix(await readPin(e, g, m)) - 0.425), 3e-3);
        // softblend
        for (const [fh, bh, softness] of [[0.7, 0.3, 0.1], [0.3, 0.7, 0.1], [0.5, 0.5, 0.2], [0.55, 0.5, 0.2]]) {
          g = mk(e, 4);
          const s = add(g, 'utils.softblend', { softness });
          link(g, uni(g, 1), s, 'foreground');
          link(g, uni(g, 0), s, 'background');
          link(g, uni(g, fh), s, 'foreground_height');
          link(g, uni(g, bh), s, 'background_height');
          const w = softblendWeight(fh, bh, softness);
          must(`softblend ${fh}/${bh}`, Math.abs(pix(await readPin(e, g, s)) - w), 3e-3);
          must('softblend height', Math.abs(pix(await readPin(e, g, s, 'height')) - (bh + (fh - bh) * w)), 3e-3);
        }
        // switch
        const sw = async (p: Params): Promise<number> => {
          const gg = mk(e, 4);
          const s = add(gg, 'utils.multi_switch', p);
          [0.1, 0.5, 0.9].forEach((v, i) => link(gg, uni(gg, v), s, `input_${i + 1}`));
          return pix(await readPin(e, gg, s));
        };
        must('switch step', Math.abs((await sw({ count: 3, index: 1 })) - 0.5), 2e-3);
        must('switch wrap', Math.abs((await sw({ count: 3, index: 3 })) - 0.1), 2e-3);
        must('switch crossfade', Math.abs((await sw({ count: 3, index: 1.5, mode: 'crossfade' })) - 0.7), 3e-3);
        must('switch crossfade loop', Math.abs((await sw({ count: 3, index: 2.5, mode: 'crossfade' })) - 0.5), 3e-3);
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });

  /* ---------------------------------------------------------------- transform / tile */
  tests.push({
    name: '4A · Transform: 90° rotation is an exact pixel permutation (point filtering); identity is identity',
    async run(env) {
      const st = { tiling: 'both', filtering: 'point' } as Partial<GraphSettings>;
      const src = await noiseOnly(env);
      const rot = await via(env, 'utils.transform', { rotation: 90, edge: 'wrap' }, { settings: st });
      let bad = 0;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (Math.abs(rot[y * N + x] - src[(N - 1 - x) * N + y]) > 2e-3) bad++;
      if (bad) throw new Error(`${bad} pixels differ from the exact rotation`);
      must('identity', maxDiff(await via(env, 'utils.transform', {}, { settings: st }), src), 2e-3);
      return 'ok';
    },
  });
  tests.push({
    name: '4A · Tile: 2x2 repeat (point filtering) equals the CPU mapping; tile id output has 4 distinct values',
    async run(env) {
      const st = { tiling: 'both', filtering: 'point' } as Partial<GraphSettings>;
      const src = await noiseOnly(env);
      const t = await via(env, 'utils.tile', { tiles: [2, 2] }, { settings: st });
      // The sample position falls exactly on a texel boundary ((2x+1)/N * N), so float rounding may pick either neighbour: accept both.
      let bad = 0;
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          let best = Infinity;
          for (const dy of [0, 1]) for (const dx of [0, 1]) best = Math.min(best, Math.abs(t[y * N + x] - src[((2 * y + dy) % N) * N + ((2 * x + dx) % N)]));
          if (best > 2e-3) bad++;
        }
      if (bad) throw new Error(`${bad} pixels differ from the 2x2 repeat`);
      const id = await via(env, 'utils.tile', { tiles: [2, 2] }, { settings: st, pin: 'tile_id' });
      const vals = new Set(Array.from(id, (v) => v.toFixed(3)));
      if (vals.size !== 4) throw new Error(`tile id has ${vals.size} distinct values, expected 4`);
      return 'ok';
    },
  });

  /* ---------------------------------------------------------------- distance vs brute force */
  tests.push({
    name: '4A · Distance (jump flooding): unsigned / signed / points equal the brute-force CPU result with wrap',
    async run(env) {
      const n = 48;
      const mask = await chain(env, n, (g) => ({ id: add(g, 'grayscale.noise', noiseP({ scale: [3, 3], octaves: 2 })) })).then((r) => chan(r));
      const inside = mask.map((v) => (v >= 0.55 ? 1 : 0));
      const wrapD = (a: number, b: number): number => { const d = Math.abs(a - b); return Math.min(d, n - d); };
      const brute = (seed: (i: number) => boolean): Float32Array => {
        const pts: number[] = [];
        inside.forEach((_, i) => { if (seed(i)) pts.push(i); });
        const o = new Float32Array(n * n);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
          let best = Infinity;
          for (const p of pts) best = Math.min(best, Math.hypot(wrapD(x, p % n), wrapD(y, Math.floor(p / n))));
          o[y * n + x] = best;
        }
        return o;
      };
      const dOut = brute((i) => inside[i] === 1);
      const dIn = brute((i) => inside[i] === 0);
      const expectUnsigned = dOut.map((d) => (d > 0 ? d - 0.5 : 0) / n);
      const expectSigned = dOut.map((d, i) => ((d > 0 ? d - 0.5 : 0) - (dIn[i] > 0 ? dIn[i] - 0.5 : 0)) / n);
      const run = async (p: Params, pin = 'output') => chan(await chain(env, n, (g) => {
        const nz = add(g, 'grayscale.noise', noiseP({ scale: [3, 3], octaves: 2 }));
        const d = add(g, 'utils.distance', { threshold: 0.55, normalize: false, ...p });
        link(g, nz, d);
        return { id: d, pin };
      }));
      const check = (what: string, got: Float32Array, want: Float32Array): string => {
        let bad = 0, worst = 0;
        for (let i = 0; i < got.length; i++) { const e = Math.abs(got[i] - want[i]) * n; worst = Math.max(worst, e); if (e > 1.2) bad++; }
        if (bad / got.length > 0.01 || worst > 3) throw new Error(`${what}: ${bad} px off by > 1.2 px, worst ${worst.toFixed(2)} px`);
        return `${what} worst ${worst.toFixed(2)} px`;
      };
      const a = check('unsigned', await run({ signed: false }), expectUnsigned);
      const b = check('signed', await run({ signed: true }), expectSigned);
      // points mode: only the brightest pixels are seeds
      const thr = 0.7;
      const seeds = mask.map((v) => (v >= thr ? 1 : 0));
      if (seeds.reduce((s, v) => s + v, 0) < 3) throw new Error('test noise has too few seeds');
      const pts = seeds.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
      const wantP = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let best = Infinity;
        for (const p of pts) best = Math.min(best, Math.hypot(wrapD(x, p % n), wrapD(y, Math.floor(p / n))));
        wantP[y * n + x] = (best > 0 ? best - 0.5 : 0) / n;
      }
      const c = check('points', await run({ mode: 'points', threshold: thr }), wantP);
      // nearest UV must point at a seed pixel
      const uvRes = await chain(env, n, (g) => {
        const nz = add(g, 'grayscale.noise', noiseP({ scale: [3, 3], octaves: 2 }));
        const d = add(g, 'utils.distance', { threshold: thr, mode: 'points' });
        link(g, nz, d);
        return { id: d, pin: 'nearest_uv' };
      });
      let miss = 0;
      for (let i = 0; i < n * n; i++) {
        const sx = Math.floor(uvRes.data[i * uvRes.ch] * n);
        const sy = Math.floor(uvRes.data[i * uvRes.ch + 1] * n);
        if (seeds[(Math.min(sy, n - 1)) * n + Math.min(sx, n - 1)] !== 1) miss++;
      }
      if (miss / (n * n) > 0.02) throw new Error(`nearest UV does not hit a seed for ${miss} px`);
      return `${a}; ${b}; ${c}; uv misses ${miss}`;
    },
  });

  /* ---------------------------------------------------------------- auto crop */
  tests.push({
    name: '4A · Auto Crop: content bounds (GPU reduction) are stretched to touch all four borders',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, N, { tiling: 'none' });
        const s = add(g, 'grayscale.shape', { size: [0.4, 0.3], position: [0.45, 0.55] });
        const before = chan(await readPin(e, g, s));
        const edge = (img: Float32Array, side: 'l' | 'r' | 't' | 'b'): number => {
          let m = 0;
          for (let i = 0; i < N; i++) m = Math.max(m, side === 'l' ? img[i * N] : side === 'r' ? img[i * N + N - 1] : side === 't' ? img[i] : img[(N - 1) * N + i]);
          return m;
        };
        if (edge(before, 'l') > 0.5 || edge(before, 't') > 0.5) throw new Error('test shape touches the border already (default Shape changed?)');
        const c = add(g, 'utils.auto_crop', { threshold: 0.5, fit: 'stretch' });
        link(g, s, c);
        const after = chan(await readPin(e, g, c));
        for (const side of ['l', 'r', 't', 'b'] as const) if (edge(after, side) < 0.5) throw new Error(`content does not reach the ${side} border after the crop`);
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });

  /* ---------------------------------------------------------------- channels */
  tests.push({
    name: '4A · Channels: RGBA merge / split, Alpha merge / split, HSVA and RGB to Gray round trips',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 16, { tiling: 'both' });
        const n1 = add(g, 'grayscale.noise', noiseP({ seed: 1 }));
        const n2 = add(g, 'grayscale.noise', noiseP({ seed: 2 }));
        const n3 = add(g, 'grayscale.noise', noiseP({ seed: 3 }));
        const m = add(g, 'utils.rgba_merge', { default_a: 0.25 });
        link(g, n1, m, 'r'); link(g, n2, m, 'g'); link(g, n3, m, 'b');
        const sp = add(g, 'utils.rgba_split', {});
        link(g, m, sp);
        for (const [pin, src] of [['r', n1], ['g', n2], ['b', n3]] as const) must(`split ${pin}`, maxDiff(chan(await readPin(e, g, sp, pin)), chan(await readPin(e, g, src))), 2e-3);
        must('default alpha', Math.abs(pix(await readPin(e, g, sp, 'a')) - 0.25), 2e-3);
        const am = add(g, 'utils.alpha_merge', {});
        link(g, m, am, 'color'); link(g, n1, am, 'alpha');
        const as = add(g, 'utils.alpha_split', {});
        link(g, am, as);
        must('alpha split', maxDiff(chan(await readPin(e, g, as, 'alpha')), chan(await readPin(e, g, n1))), 2e-3);
        const g2 = mk(e, 4);
        const cu = cuni(g2, [0.8, 0.35, 0.08, 0.6]);
        const hs = add(g2, 'utils.rgba_to_hsva', {});
        link(g2, cu, hs);
        const back = add(g2, 'utils.hsva_to_rgba', {});
        link(g2, hs, back);
        const r = await readPin(e, g2, back);
        [0.8, 0.35, 0.08, 0.6].forEach((v, i) => must(`hsva round trip ch ${i}`, Math.abs(r.data[i] - v), 4e-3));
        const gr = add(g2, 'utils.rgb_to_grayscale', {});
        link(g2, cu, gr);
        must('luminance', Math.abs(pix(await readPin(e, g2, gr)) - (0.2126 * 0.8 + 0.7152 * 0.35 + 0.0722 * 0.08)), 2e-3);
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  });

  /* ---------------------------------------------------------------- timing */
  tests.push({
    name: '4A · Timing · 2048x2048 GPU wall time of one evaluation (informational; budget ~8 ms per node on mid-range GPUs)',
    async run(env) {
      const e = engineOf(env);
      const out: string[] = [];
      try {
        const g = mk(e, 2048, { tiling: 'both' });
        const src = add(g, 'grayscale.noise', { scale: [8, 8], octaves: 4 });
        const time = async (target: string): Promise<number> => {
          const run = async (): Promise<number> => {
            const t0 = performance.now();
            const res = await e.evaluator.evaluate(g, [{ nodeId: target }], { useCache: false });
            await e.gpu.device.queue.onSubmittedWorkDone();
            const dt = performance.now() - t0;
            res.release();
            return dt;
          };
          await run();
          return Math.min(await run(), await run());
        };
        const base = await time(src);
        out.push(`noise source alone: ${base.toFixed(1)} ms`);
        const cases: [string, Params][] = [
          ['utils.blur', { radius: 0.01 }],
          ['utils.blur', { radius: 0.2 }],
          ['utils.blur', { mode: 'box', radius: 0.05 }],
          ['utils.blur', { mode: 'kawase', radius: 0.05 }],
          ['utils.directional_blur', { length: 0.1, samples: 64 }],
          ['utils.bilateral', { radius: 0.004 }],
          ['utils.bilateral', { radius: 0.012, quality: 'separable' }],
          ['utils.kuwahara', { radius: 0.006 }],
          ['utils.denoise', {}],
          ['utils.glow', {}],
          ['utils.fxaa', {}],
          ['utils.edge_detect', {}],
          ['utils.distance', {}],
          ['utils.levels', { auto: true }],
          ['utils.transform', { rotation: 20 }],
          ['utils.tile', { tiles: [4, 4], rand_rot: 90 }],
          ['utils.lattice', { jitter: 0.1 }],
          ['utils.copy_transform', { count: 1024, size: 0.05 }],
          ['utils.auto_crop', {}],
        ];
        for (const [type, p] of cases) {
          const n = add(g, type, p);
          link(g, src, n, type === 'utils.copy_transform' ? 'input' : 'input');
          const t = await time(n);
          out.push(`${type} ${JSON.stringify(p)}: ${t.toFixed(1)} ms total, ~${Math.max(t - base, 0).toFixed(1)} ms for the node${t - base > 8 ? '  (> 8 ms budget on this GPU)' : ''}`);
        }
        const gr = add(g, 'utils.grid', { pattern: 'hex', cells: [32, 18] });
        out.push(`utils.grid hex: ${(await time(gr)).toFixed(1)} ms`);
      } finally {
        dispose(e);
      }
      return out.join('\n');
    },
  });
  return tests;
}

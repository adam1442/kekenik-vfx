import { GraphEditor } from '../engine/commands/graph-commands';
import { Engine } from '../engine/engine';
import type { GpuContext } from '../engine/gpu/device';
import { formatCapabilityReport } from '../engine/gpu/caps';
import { runThreeSharedDeviceCheck } from './three-shared-device';
import { discoverNodes } from '../engine/graph/discover';
import { targetKey, type EvalOptions, type EvalResult, type EvalTarget } from '../engine/graph/evaluator';
import type { Graph, GraphSettings } from '../engine/graph/graph';
import { defineNode } from '../engine/graph/node';
import { NodeRegistry, nodeRegistry } from '../engine/graph/registry';
import { renderTiled } from '../engine/graph/tiled';
import type { ParamValue } from '../engine/params/schema';
import { floatToHalf, halfToFloat } from '../engine/resources/half';
import { OutOfBudgetError, AllocationTooLargeError } from '../engine/resources/memory';
import { readTextureFloat32, readTextureStrips } from '../engine/resources/readback';
import type { TextureValue } from '../engine/resources/values';
import { BACKGROUND_BLEND, BACKGROUND_BLEND_LAYOUT, CONVERT_GRAY_COLOR, PRESENT, PRESENT_LAYOUT } from '../engine/shaders/builtin';
import { BINDING_DEPENDENT_MODULES, defineShader, wgslLibrary } from '../engine/shaders/library';
import { PipelinePending, ShaderCompileError } from '../engine/shaders/pipelines';
import { makeLayout } from '../engine/shaders/uniforms';
import { noiseReference, type NoiseRefParams } from '../nodes/grayscale/noise/reference';
import { levelsReference } from '../nodes/utils/levels/definition';
import { consoleBus } from '../shared/log';
import { uiLogicChecks } from './ui-logic';
import { delay } from '../shared/util';
import { graphEditorChecks } from '../panels/graph-editor/selftest-checks';
import { ThumbnailLayer } from '../panels/graph-editor/thumbnails';
import { fuzzy } from '../app/dialogs';
import { evalGradient } from '../engine/params/curve';
import { parseExpr } from '../ui/widgets/number-field';
import { getPanel } from '../ui/dock/panel-registry';
import { discoverPanels } from '../ui/dock/panel-discovery';
import { formatBytes } from '../shared/util';
import { TexturePresenter, defaultPresentOptions } from '../viewports/presenter';
import { gizmoChecks } from '../gizmos/selftest-checks';
import { generatorTests } from './generators';
import { processingTests } from './processing';
import { filterTests } from './filters';
import { uvNormalIslandTests } from './uvnormal';
import { animTests } from './anim';
import { exportTests } from './export';
import { meshTests } from './mesh';
import { meshNodeTests } from './meshnodes';
import { libraryTests } from './library';
import { sampleTests } from './samples';
import { vfxNodeTests } from './vfx-nodes';
import { simFrameworkTests } from './sim-framework';
import { simVectorTests } from './sim-vector';
import { editorChecks } from './editor-checks';
import { perfTests } from './perf';
import { fusionTests } from './fusion';
import { histogramTests } from './histogram';
import { workerTests } from './workers';
import { i18nTests } from './i18n';
import { Analyzer } from '../panels/viewport-2d/analysis';
import { DisplayRenderer } from '../panels/viewport-2d/display';
import { defaultSettings } from '../panels/viewport-2d/settings';
import { ViewTransform } from '../gizmos/geom';

/* ------------------------------------------------------------------------------------------------
 * GPU known-answer tests. Each test throws on failure, returns a detail string on success, or throws Skip.
 * To add tests for a new node: add a test here that builds a tiny graph, evaluates, reads back, compares to a
 * CPU reference (see noise/levels below). Tolerances: r16float output => ~5e-4 absolute.
 * ---------------------------------------------------------------------------------------------- */

export class Skip extends Error {}
export interface Env {
  gpu: GpuContext;
  registry: NodeRegistry;
}
export interface TestDef {
  name: string;
  run(env: Env): Promise<string | void>;
}

const HALF_TOL = 1.5e-3;

function engineOf(env: Env, budget?: number, registry?: NodeRegistry): Engine {
  return new Engine(env.gpu, registry ?? env.registry, budget);
}
function dispose(e: Engine): void {
  e.scheduler.dispose();
  e.evaluator.cache.clear();
  e.mm.textures.trim();
  e.mm.buffers.trim();
}
const mk = (e: Engine, size = 64, s: Partial<GraphSettings> = {}): Graph => e.newGraph({ width: size, height: size, ...s });
const add = (g: Graph, type: string, params: Record<string, ParamValue> = {}): string => g.addNode(type, { params }).id;
const link = (g: Graph, from: string, to: string, pin = 'input', outPin = 'output'): void => void g.connect({ node: from, pin: outPin }, { node: to, pin });

async function withRetry<T>(fn: () => T): Promise<T> {
  for (let i = 0; i < 12; i++) {
    try {
      return fn();
    } catch (e) {
      if (e instanceof PipelinePending) {
        await e.promise;
        continue;
      }
      throw e;
    }
  }
  throw new Error('pipeline never became ready');
}

interface Read {
  data: Float32Array;
  w: number;
  h: number;
  ch: number;
  format: string;
  stats: EvalResult['stats'];
  errors: Map<string, string>;
}
/** Evaluate one node and read its first output back as Float32. Throws if the node failed. */
async function read(e: Engine, g: Graph, nodeId: string, opts: EvalOptions = {}): Promise<Read> {
  const res = await e.evaluator.evaluate(g, [{ nodeId }], opts);
  try {
    const err = res.errors.get(nodeId);
    if (err) throw new Error(`node failed: ${err}`);
    const v = res.values.get(targetKey({ nodeId })) as TextureValue | undefined;
    if (!v || v.kind !== 'texture') throw new Error('no texture produced');
    const data = await readTextureFloat32(e.gpu, e.mm, v.tex.texture, v.tex.format, v.width, v.height);
    return { data, w: v.width, h: v.height, ch: data.length / (v.width * v.height), format: v.tex.format, stats: res.stats, errors: res.errors };
  } finally {
    res.release();
  }
}
function expectAll(r: Read, expected: number, tol: number, what: string, channel = 0): void {
  let worst = 0;
  for (let i = channel; i < r.data.length; i += r.ch) worst = Math.max(worst, Math.abs(r.data[i] - expected));
  if (!(worst <= tol)) throw new Error(`${what}: expected ${expected}, worst error ${worst.toExponential(2)} (tol ${tol})`);
}
const maxErr = (a: Float32Array, b: (i: number) => number): number => {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b(i)));
  return m;
};

/* ---- noise reference mapping ---- */
const NOISE_DEFAULTS: NoiseRefParams = { type: 'perlin', scale: [4, 4], octaves: 4, lacunarity: 2, roughness: 0.5, offset: [0, 0], evolution: 0, zCells: 2, seed: 0, contrast: 1, brightness: 0, invert: false, tile: [true, true] };
function noiseCase(name: string, params: Record<string, ParamValue>, ref: Partial<NoiseRefParams>, settings: Partial<GraphSettings> = {}, tol = HALF_TOL): TestDef {
  return {
    name,
    async run(env) {
      const e = engineOf(env);
      try {
        const size = 64;
        const g = mk(e, size, settings);
        const id = add(g, 'grayscale.noise', params);
        const r = await read(e, g, id);
        const p = { ...NOISE_DEFAULTS, ...ref };
        const err = maxErr(r.data, (i) => noiseReference(p, ((i % size) + 0.5) / size, (Math.floor(i / size) + 0.5) / size));
        if (!(err <= tol)) throw new Error(`GPU vs CPU max error ${err.toExponential(2)} > ${tol}`);
        return `max |GPU-CPU| = ${err.toExponential(2)} (${r.format})`;
      } finally {
        dispose(e);
      }
    },
  };
}

/* ---- custom nodes used to test error isolation (registered in private registries only) ---- */
const BROKEN = defineShader('broken.wgsl', 'fn shade(uv: vec2f) -> vec4f {\n  let x: u32 = 1.5;\n  return vec4f(f32(x));\n}');
const SELFREF = defineShader('selfref.wgsl', 'fn shade(uv: vec2f) -> vec4f {\n  return textureLoad(t0, vec2i(0, 0), 0);\n}');
const PROBE = defineShader('probe.wgsl', '#include "sampling"\nfn shade(uv: vec2f) -> vec4f {\n  return tex_point(t0, uv, F.tile);\n}');
const grayOut = [{ id: 'output', name: 'Output', type: 'gray' as const }];
const testNodes = [
  defineNode({
    id: 'utils.broken', version: 1, category: 'utils', title: 'Broken', description: 'test', icon: '', inputs: [{ id: 'input', name: 'In', type: 'gray', optional: true }], outputs: grayOut, params: [],
    evaluate(ctx) {
      const out = ctx.tex('gray');
      ctx.pass({ target: out, shader: BROKEN, ss: 1 });
      return { output: ctx.result(out, 'gray') };
    },
  }),
  defineNode({
    id: 'utils.selfref', version: 1, category: 'utils', title: 'SelfRef', description: 'test: GPU validation error', icon: '', inputs: [], outputs: grayOut, params: [],
    evaluate(ctx) {
      const out = ctx.tex('gray');
      ctx.pass({ target: out, shader: SELFREF, textures: [out], ss: 1 });
      return { output: ctx.result(out, 'gray') };
    },
  }),
  defineNode({
    id: 'utils.colorprobe', version: 1, category: 'utils', title: 'ColorProbe', description: 'test: color in -> color out', icon: '',
    inputs: [{ id: 'input', name: 'In', type: 'color' }], outputs: [{ id: 'output', name: 'Out', type: 'color' }], params: [],
    evaluate(ctx) {
      const out = ctx.tex('color');
      ctx.pass({ target: out, shader: PROBE, textures: [ctx.texInput('input')!.tex], ss: 1 });
      return { output: ctx.result(out, 'color') };
    },
  }),
];
function testRegistry(env: Env): NodeRegistry {
  const r = new NodeRegistry();
  discoverNodes(r);
  for (const n of testNodes) r.register(n);
  void env;
  return r;
}

export const tests: TestDef[] = [
  {
    name: 'Capability report',
    async run(env) {
      const c = env.gpu.caps;
      if ((c.limits.maxTextureDimension2D ?? 0) < 4096) throw new Error('maxTextureDimension2D < 4096');
      return formatCapabilityReport(c);
    },
  },
  {
    name: 'Compile every WGSL library module',
    async run(env) {
      const e = engineOf(env);
      const bad: string[] = [];
      const t = e.mm.textures.acquire({ width: 4, height: 4, format: 'rgba16float' });
      let n = 0;
      for (const mod of Object.keys(wgslLibrary)) {
        if (BINDING_DEPENDENT_MODULES.has(mod)) continue;
        const src = defineShader(`lib_${mod}.wgsl`, `#include "${mod}"\n@fragment fn fs_main(in: VsOut) -> @location(0) vec4f { return vec4f(0.0); }`);
        try {
          await withRetry(() => {
            const enc = env.gpu.device.createCommandEncoder();
            e.runner.fullscreen(enc, { view: t.view, format: t.format, width: 4, height: 4 }, { width: 4, height: 4, time: 0, loopPhase: 0, tile: [true, true], seed: 0, ss: 1, filter: 1, hq: false }, { shader: src, mode: 'raw' }, { label: `lib ${mod}` });
            e.runner.submit([enc.finish()]);
          });
          n++;
        } catch (err) {
          bad.push(`${mod}: ${(err as Error).message}`);
        }
      }
      t.release();
      dispose(e);
      if (bad.length) throw new Error(bad.join('\n'));
      return `${n} modules compiled`;
    },
  },
  {
    name: 'Compile built-in passes (convert, background blend, present)',
    async run(env) {
      const e = engineOf(env);
      const dev = env.gpu.device;
      const src = e.mm.textures.acquire({ width: 8, height: 8, format: 'rgba16float' });
      const dst = e.mm.textures.acquire({ width: 8, height: 8, format: 'rgba16float' });
      const canvasFmt = navigator.gpu.getPreferredCanvasFormat();
      const ct = dev.createTexture({ size: [8, 8], format: canvasFmt, usage: GPUTextureUsage.RENDER_ATTACHMENT });
      const fp = { width: 8, height: 8, time: 0, loopPhase: 0, tile: [true, true] as [boolean, boolean], seed: 0, ss: 1, filter: 1, hq: false };
      await withRetry(() => {
        const enc = dev.createCommandEncoder();
        const t = { view: dst.view, format: dst.format, width: 8, height: 8 };
        e.runner.fullscreen(enc, t, fp, { shader: CONVERT_GRAY_COLOR, textures: [src] }, {});
        e.runner.fullscreen(enc, t, fp, { shader: BACKGROUND_BLEND, uniforms: { layout: BACKGROUND_BLEND_LAYOUT, values: { blend_mode: 1, cross_mix: 0.5, smoothness: 0.1 } }, textures: [src, src] }, {});
        e.runner.fullscreen(enc, { view: ct.createView(), format: canvasFmt, width: 8, height: 8 }, fp, { shader: PRESENT, mode: 'raw', textures: [src], uniforms: { layout: PRESENT_LAYOUT, values: { tiles: 1, wrap: 0, channel: 0, exposure: 0, srgb: 1, is_gray: 0, is_uv: 0, filter_mode: 1 } } }, {});
        e.runner.submit([enc.finish()]);
      });
      src.release();
      dst.release();
      ct.destroy();
      dispose(e);
      return `present target format ${canvasFmt}`;
    },
  },
  {
    name: 'Every registered node compiles and evaluates with default params',
    async run(env) {
      const e = engineOf(env);
      const fails: string[] = [];
      const notes: string[] = [];
      for (const def of env.registry.list()) {
        const g = mk(e, 32);
        const id = g.addNode(def.id).id;
        let skipped = false;
        // mesh / camera nodes have no texture output; they are covered by the `5A ·` tests
        if (!def.outputs.some((o) => o.type === 'gray' || o.type === 'color' || o.type === 'normal' || o.type === 'uv')) {
          notes.push(`${def.id}: skipped (no texture output; see 5A tests)`);
          continue;
        }
        for (const pin of def.inputs) {
          if (pin.optional) continue;
          if (pin.type === 'gray' || pin.type === 'color') link(g, add(g, 'grayscale.uniform', { value: 0.5 }), id, pin.id);
          else skipped = true;
        }
        if (skipped) {
          notes.push(`${def.id}: skipped (needs ${def.inputs.filter((p) => !p.optional).map((p) => p.type).join('/')} input)`);
          continue;
        }
        try {
          let r: Read;
          try {
            r = await read(e, g, id);
          } catch (err) {
            // Merge / switch nodes legitimately report "needs at least one connected input": feed their first
            // optional gray / color input and evaluate again (the error itself is the intended behaviour).
            const first = def.inputs.find((p) => p.type === 'gray' || p.type === 'color');
            if (!/at least one connected/i.test((err as Error).message) || !first) throw err;
            link(g, add(g, 'grayscale.uniform', { value: 0.5 }), id, first.id);
            r = await read(e, g, id);
          }
          if (!r.data.every(Number.isFinite)) throw new Error('output contains NaN/Inf');
          notes.push(`${def.id}: ok ${r.w}x${r.h} ${r.format}`);
        } catch (err) {
          fails.push(`${def.id}: ${(err as Error).message}`);
        }
      }
      dispose(e);
      if (fails.length) throw new Error(fails.join('\n'));
      return notes.join('\n');
    },
  },
  {
    name: 'Uniform: known answer + modulation (0%, +100%, -100%) + Background blend',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 16);
        const u = add(g, 'grayscale.uniform', { value: 0.25 });
        expectAll(await read(e, g, u), 0.25, 1e-3, 'uniform 0.25');
        const m = add(g, 'grayscale.uniform', { value: 0.25 });
        const v = add(g, 'grayscale.uniform', { value: 0.8 });
        link(g, m, v, 'value_mod');
        g.setParam(v, 'value_mod_k', 1);
        expectAll(await read(e, g, v), 0.2, 1e-3, 'modulation +100% (0.8 * 0.25)');
        g.setParam(v, 'value_mod_k', -1);
        expectAll(await read(e, g, v), 0.6, 1e-3, 'modulation -100% (0.8 * (1-0.25))');
        g.setParam(v, 'value_mod_k', 0);
        expectAll(await read(e, g, v), 0.8, 1e-3, 'modulation 0%');
        // Background semantics: fg 0.5, bg 0.25
        const fg = add(g, 'grayscale.uniform', { value: 0.5, blend_mode: 'add', blend_cross: 0.5 });
        link(g, add(g, 'grayscale.uniform', { value: 0.25 }), fg, 'background');
        expectAll(await read(e, g, fg), 0.75, 1e-3, 'add @50%');
        g.setParam(fg, 'blend_cross', 0);
        expectAll(await read(e, g, fg), 0.25, 1e-3, 'cross 0% = background only');
        g.setParam(fg, 'blend_cross', 1);
        expectAll(await read(e, g, fg), 0.5, 1e-3, 'cross 100% = foreground only');
        g.setParam(fg, 'blend_mode', 'multiply');
        g.setParam(fg, 'blend_cross', 0.5);
        expectAll(await read(e, g, fg), 0.125, 1e-3, 'multiply @50%');
        return 'all answers within 1e-3';
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Levels: known answers vs CPU reference (+ bypass)',
    async run(env) {
      const e = engineOf(env);
      try {
        const cases = [
          { inLow: 0.25, inHigh: 0.75, gamma: 1, outLow: 0, outHigh: 1, clamp: true, v: 0.6 },
          { inLow: 0, inHigh: 1, gamma: 2.2, outLow: 0.1, outHigh: 0.9, clamp: true, v: 0.3 },
          { inLow: 0, inHigh: 0.5, gamma: 1, outLow: 0, outHigh: 1, clamp: false, v: 0.9 },
          { inLow: 1, inHigh: 0, gamma: 0.5, outLow: 1, outHigh: 0, clamp: true, v: 0.2 },
        ];
        for (const c of cases) {
          const g = mk(e, 16);
          const lv = add(g, 'utils.levels', { in_low: c.inLow, in_high: c.inHigh, gamma: c.gamma, out_low: c.outLow, out_high: c.outHigh, clamp_output: c.clamp });
          link(g, add(g, 'grayscale.uniform', { value: c.v }), lv);
          expectAll(await read(e, g, lv), levelsReference(c.v, c), 2e-3, `levels ${JSON.stringify(c)}`);
        }
        const g = mk(e, 16);
        const lv = add(g, 'utils.levels', { out_high: 0.1 });
        link(g, add(g, 'grayscale.uniform', { value: 0.5 }), lv);
        g.setNodeField(lv, 'bypass', true);
        expectAll(await read(e, g, lv), 0.5, 1e-3, 'bypass passes input through');
        return `${cases.length} cases + bypass`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Blend: modes, cross mix and mask',
    async run(env) {
      const e = engineOf(env);
      try {
        const fgv = 0.75;
        const bgv = 0.25;
        const modes: [string, number][] = [['add', 1], ['subtract', -0.5], ['multiply', 0.1875], ['max', 0.75], ['min', 0.25], ['screen', 1 - 0.75 * 0.25], ['difference', 0.5], ['copy', 0.75], ['overlay', 2 * 0.25 * 0.75], ['divide', 0.25 / 0.75]];
        for (const [mode, expected] of modes) {
          const g = mk(e, 8);
          const b = add(g, 'utils.blend', { blend_type: mode, cross_mix: 0.5 });
          link(g, add(g, 'grayscale.uniform', { value: fgv }), b, 'foreground');
          link(g, add(g, 'grayscale.uniform', { value: bgv }), b, 'background');
          expectAll(await read(e, g, b), expected, 2e-3, `blend ${mode}`);
        }
        const g = mk(e, 8);
        const b = add(g, 'utils.blend', { blend_type: 'add', cross_mix: 0.5 });
        link(g, add(g, 'grayscale.uniform', { value: fgv }), b, 'foreground');
        link(g, add(g, 'grayscale.uniform', { value: bgv }), b, 'background');
        const mask = add(g, 'grayscale.uniform', { value: 0.5 });
        link(g, mask, b, 'mask');
        expectAll(await read(e, g, b), 0.625, 2e-3, 'mask 0.5 halves the effect');
        g.setParam(b, 'cross_mix', 0);
        expectAll(await read(e, g, b), 0.25, 2e-3, 'cross 0 = bg');
        g.setParam(b, 'cross_mix', 1);
        g.setParam(mask, 'value', 1);
        expectAll(await read(e, g, b), 0.75, 2e-3, 'cross 1 = fg');
        return `${modes.length} modes + mask/cross`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Implicit Gray -> Color conversion',
    async run(env) {
      const e = engineOf(env, undefined, testRegistry(env));
      try {
        const g = mk(e, 8);
        const p = add(g, 'utils.colorprobe');
        link(g, add(g, 'grayscale.uniform', { value: 0.5 }), p);
        const r = await read(e, g, p);
        if (r.ch !== 4) throw new Error(`expected rgba, got ${r.ch} channels`);
        for (let i = 0; i < r.data.length; i += 4) {
          if (Math.abs(r.data[i] - 0.5) > 1e-3 || Math.abs(r.data[i + 1] - 0.5) > 1e-3 || Math.abs(r.data[i + 2] - 0.5) > 1e-3 || Math.abs(r.data[i + 3] - 1) > 1e-3) throw new Error(`pixel ${i / 4}: ${Array.from(r.data.slice(i, i + 4))}`);
        }
        return 'gray 0.5 -> (0.5,0.5,0.5,1)';
      } finally {
        dispose(e);
      }
    },
  },
  noiseCase('Noise GPU == CPU: perlin, tiling both, 4 octaves', { noise_type: 'perlin', scale: [4, 4] }, {}),
  noiseCase('Noise GPU == CPU: value, offset, scale 5x3, 3 octaves, lacunarity 3', { noise_type: 'value', scale: [5, 3], octaves: 3, lacunarity: 3, offset: [0.31, 0.77], seed: 9 }, { type: 'value', scale: [5, 3], octaves: 3, lacunarity: 3, offset: [0.31, 0.77], seed: 9 }),
  noiseCase('Noise GPU == CPU: perlin, NO tiling, fractional scale', { noise_type: 'perlin', scale: [3.5, 2.25], octaves: 2 }, { scale: [3.5, 2.25], octaves: 2, tile: [false, false] }, { tiling: 'none' }),
  noiseCase('Noise GPU == CPU: contrast/brightness/invert/evolution', { evolution: 0.37, contrast: 1.6, brightness: 0.1, invert: true, z_cells: 3 }, { evolution: 0.37, contrast: 1.6, brightness: 0.1, invert: true, zCells: 3 }),
  noiseCase('Noise 32-bit HQ path (r32float) matches CPU tightly', { noise_type: 'perlin', scale: [6, 6], octaves: 5 }, { scale: [6, 6], octaves: 5 }, { bitDepth: 32 }, 5e-4),
  {
    name: 'Noise tileability: seam continuity, integer UV offset, Z loop',
    async run(env) {
      const e = engineOf(env);
      try {
        const size = 128;
        const out: string[] = [];
        for (const type of ['value', 'perlin']) {
          const g = mk(e, size);
          const n = add(g, 'grayscale.noise', { noise_type: type, scale: [4, 4], octaves: 4 });
          const a = await read(e, g, n);
          let seamX = 0, innerX = 0, seamY = 0, innerY = 0;
          for (let y = 0; y < size; y++) {
            seamX += Math.abs(a.data[y * size + size - 1] - a.data[y * size]);
            for (let x = 0; x < size - 1; x++) innerX += Math.abs(a.data[y * size + x + 1] - a.data[y * size + x]);
          }
          for (let x = 0; x < size; x++) {
            seamY += Math.abs(a.data[(size - 1) * size + x] - a.data[x]);
            for (let y = 0; y < size - 1; y++) innerY += Math.abs(a.data[(y + 1) * size + x] - a.data[y * size + x]);
          }
          const rx = seamX / size / (innerX / (size * (size - 1)));
          const ry = seamY / size / (innerY / (size * (size - 1)));
          if (rx > 1.5 || ry > 1.5) throw new Error(`${type}: seam is ${rx.toFixed(2)}x / ${ry.toFixed(2)}x a normal neighbour step (must be ~1)`);
          g.setParam(n, 'offset', [1, -2]);
          const b = await read(e, g, n);
          const dOff = maxErr(a.data, (i) => b.data[i]);
          if (dOff > 2e-3) throw new Error(`${type}: integer offset changes the image (${dOff})`);
          g.setParam(n, 'offset', [0, 0]);
          g.setParam(n, 'evolution', 1);
          const c = await read(e, g, n);
          const dZ = maxErr(a.data, (i) => c.data[i]);
          if (dZ > 2e-3) throw new Error(`${type}: evolution 1 != evolution 0 (${dZ}) -> loop is not seamless`);
          g.setParam(n, 'evolution', 0.5);
          const d = await read(e, g, n);
          if (maxErr(a.data, (i) => d.data[i]) < 0.02) throw new Error(`${type}: evolution 0.5 should differ from 0`);
          out.push(`${type}: seam ratio x=${rx.toFixed(2)} y=${ry.toFixed(2)}, offset diff ${dOff.toExponential(1)}, loop diff ${dZ.toExponential(1)}`);
        }
        return out.join('\n');
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'HQ supersampling is consistent with 1x (antialiasing only)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const n = add(g, 'grayscale.noise', { noise_type: 'value', scale: [16, 16], octaves: 1, contrast: 4 });
        const a = await read(e, g, n);
        g.setParam(n, 'tex_ss', 3);
        const b = await read(e, g, n);
        let mean = 0;
        for (let i = 0; i < a.data.length; i++) mean += Math.abs(a.data[i] - b.data[i]);
        mean /= a.data.length;
        if (mean > 0.05 || mean < 1e-6) throw new Error(`mean diff ${mean} (expected small but non-zero)`);
        return `mean |1x - 3x| = ${mean.toFixed(4)}`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Texture pool: exact accounting, reuse, budget enforcement',
    async run(env) {
      const e = engineOf(env, 5 * 1024 * 1024);
      const mm = e.mm;
      // The pool destroys idle textures above `idleFraction` of the budget (default 25 %): with a 5 MiB budget a released
      // 2 MiB texture would be trimmed at once. This test checks REUSE, so allow the whole budget as idle memory here.
      mm.textures.idleFraction = 1;
      const a = mm.textures.acquire({ width: 1024, height: 1024, format: 'r16float' }); // 2 MiB
      const b = mm.textures.acquire({ width: 1024, height: 1024, format: 'r16float' });
      if (mm.usedBytes !== 4 * 1024 * 1024) throw new Error(`used ${mm.usedBytes}`);
      let threw = false;
      try {
        mm.textures.acquire({ width: 1024, height: 1024, format: 'r16float' });
      } catch (err) {
        threw = err instanceof OutOfBudgetError;
      }
      if (!threw) throw new Error('third allocation should exceed the budget');
      a.release();
      const c = mm.textures.acquire({ width: 1024, height: 1024, format: 'r16float' });
      if (mm.textures.hits !== 1) throw new Error('released texture was not reused');
      let tooBig = false;
      try {
        mm.textures.acquire({ width: 100000, height: 4, format: 'r16float' });
      } catch (err) {
        tooBig = err instanceof AllocationTooLargeError;
      }
      if (!tooBig) throw new Error('expected AllocationTooLargeError for dimension cap');
      b.release();
      c.release();
      mm.textures.trim();
      if (mm.usedBytes !== 0) throw new Error(`leak: ${mm.usedBytes} bytes after trim`);
      return `max texture dim ${env.gpu.caps.limits.maxTextureDimension2D}, accounting exact`;
    },
  },
  {
    name: 'Graph invalidation: cache hits, partial re-evaluation, no leaks',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const noise = add(g, 'grayscale.noise');
        const lv = add(g, 'utils.levels');
        const uni = add(g, 'grayscale.uniform', { value: 0.3 });
        const bl = add(g, 'utils.blend', { blend_type: 'add' });
        link(g, noise, lv);
        link(g, lv, bl, 'foreground');
        link(g, uni, bl, 'background');
        const r1 = await read(e, g, bl);
        if (r1.stats.nodesEvaluated !== 4) throw new Error(`first pass evaluated ${r1.stats.nodesEvaluated}, expected 4`);
        const r2 = await read(e, g, bl);
        if (r2.stats.nodesEvaluated !== 0 || r2.stats.cacheHits !== 1) throw new Error(`second pass: evaluated ${r2.stats.nodesEvaluated}, hits ${r2.stats.cacheHits} (expected 0 / 1: target-driven partial evaluation)`);
        g.setParam(lv, 'gamma', 2);
        const r3 = await read(e, g, bl);
        if (r3.stats.nodesEvaluated !== 2) throw new Error(`after editing Levels evaluated ${r3.stats.nodesEvaluated}, expected 2 (levels+blend; noise & uniform cached)`);
        g.setParam(uni, 'value', 0.9);
        const r4 = await read(e, g, bl);
        if (r4.stats.nodesEvaluated !== 2) throw new Error(`after editing Uniform evaluated ${r4.stats.nodesEvaluated}, expected 2`);
        const r5 = await read(e, g, bl, { scale: 0.5 });
        if (r5.w !== 32 || r5.stats.nodesEvaluated !== 4) throw new Error(`preview scale: ${r5.w}px, evaluated ${r5.stats.nodesEvaluated}`);
        e.evaluator.cache.clear();
        if (e.mm.textures.liveBytes !== 0) throw new Error(`LEAK: ${formatBytes(e.mm.textures.liveBytes)} still live after releasing everything`);
        return 'evaluated 4 -> 0 -> 2 -> 2 -> 4(half res); live bytes 0 after release';
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Memory pressure: long chain under a tiny budget evicts instead of failing',
    async run(env) {
      const budget = 1.5 * 1024 * 1024;
      const e = engineOf(env, budget);
      try {
        const g = mk(e, 256);
        let prev = add(g, 'grayscale.noise');
        for (let i = 0; i < 30; i++) {
          const l = add(g, 'utils.levels', { gamma: 1 + i * 0.01 });
          link(g, prev, l);
          prev = l;
        }
        const r = await read(e, g, prev);
        if (e.mm.peakBytes > budget) throw new Error(`peak ${formatBytes(e.mm.peakBytes)} exceeded budget ${formatBytes(budget)}`);
        return `31 nodes x 128 KiB under ${formatBytes(budget)}; peak ${formatBytes(e.mm.peakBytes)}, ran ${r.stats.nodesEvaluated}`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Out-of-budget degrades gracefully (node error, no exception)',
    async run(env) {
      const e = engineOf(env, 100 * 1024);
      try {
        const g = mk(e, 256);
        const n = add(g, 'grayscale.noise');
        const res = await e.evaluator.evaluate(g, [{ nodeId: n }]);
        const msg = res.errors.get(n);
        res.release();
        if (!msg) throw new Error('expected a per-node memory error');
        return `reported: ${msg}`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Tiled rendering == full rendering (tile + halo, tiled readback)',
    async run(env) {
      const e = engineOf(env);
      try {
        const size = 128;
        const g = mk(e, size);
        const n = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4], octaves: 3, evolution: 0.2 });
        const full = await read(e, g, n);
        const out: string[] = [];
        for (const halo of [0, 5]) {
          const tiled = new Float32Array(size * size);
          const info = await renderTiled(env.gpu, e.mm, e.evaluator, g, { nodeId: n }, {
            tileSize: 48,
            halo,
            onTile: (t, data) => {
              for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) tiled[(t.y + y) * size + t.x + x] = data[y * t.w + x];
            },
          });
          const err = maxErr(full.data, (i) => tiled[i]);
          if (err > 2e-3) throw new Error(`halo ${halo}: tiled differs from full by ${err}`);
          out.push(`halo ${halo}: ${info.tiles} tiles of ${info.tileSize}px, max diff ${err.toExponential(1)}`);
        }
        return out.join('\n');
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Async strip-wise readback (many strips, non-aligned width)',
    async run(env) {
      const e = engineOf(env);
      try {
        const w = 100;
        const h = 37;
        const t = e.mm.textures.acquire({ width: w, height: h, format: 'r16float' });
        const src = new Uint16Array(w * h);
        for (let i = 0; i < src.length; i++) src[i] = floatToHalf((i % 251) / 251);
        env.gpu.device.queue.writeTexture({ texture: t.texture }, src, { bytesPerRow: w * 2 }, { width: w, height: h });
        let strips = 0;
        const got = new Uint16Array(w * h);
        await readTextureStrips(env.gpu, e.mm, t.texture, 'r16float', w, h, (s) => {
          strips++;
          got.set(new Uint16Array(s.data.buffer, s.data.byteOffset, s.data.byteLength / 2), s.y0 * w);
        }, { maxStripBytes: 1024 });
        t.release();
        if (strips < 5) throw new Error(`expected several strips, got ${strips}`);
        for (let i = 0; i < src.length; i++) if (got[i] !== src[i]) throw new Error(`texel ${i}: ${halfToFloat(got[i])} != ${halfToFloat(src[i])}`);
        return `${strips} strips, ${w * h} texels exact`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Compute helper (uniform + storage buffer, mapAsync readback)',
    async run(env) {
      const e = engineOf(env);
      const dev = env.gpu.device;
      const code = defineShader('compute_test.wgsl', 'struct Cfg { n: u32 };\n@group(0) @binding(0) var<uniform> cfg: Cfg;\n@group(0) @binding(1) var<storage, read_write> out: array<u32>;\n@compute @workgroup_size(64)\nfn main(@builtin(global_invocation_id) id: vec3u) {\n  if (id.x < cfg.n) { out[id.x] = id.x * 2u + 1u; }\n}');
      const buf = dev.createBuffer({ size: 256 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      const stage = dev.createBuffer({ size: 256 * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      await withRetry(() => {
        const enc = dev.createCommandEncoder();
        e.runner.compute(enc, { shader: code, bindings: [e.runner.uniform(makeLayout([{ name: 'n', type: 'u32' }]), { n: 200 }), { kind: 'storage', buffer: buf }], workgroups: [4] }, {});
        enc.copyBufferToBuffer(buf, 0, stage, 0, 1024);
        e.runner.submit([enc.finish()]);
      });
      await stage.mapAsync(GPUMapMode.READ);
      const r = new Uint32Array(stage.getMappedRange().slice(0));
      stage.unmap();
      buf.destroy();
      stage.destroy();
      dispose(e);
      for (let i = 0; i < 200; i++) if (r[i] !== i * 2 + 1) throw new Error(`out[${i}] = ${r[i]}`);
      if (r[200] !== 0) throw new Error('wrote past n');
      return '200 values correct';
    },
  },
  {
    name: 'Shader error -> Console (node id, name, WGSL line); rest of graph unaffected',
    async run(env) {
      const reg = testRegistry(env);
      const e = engineOf(env, undefined, reg);
      try {
        const g = mk(e, 16);
        const bad = g.addNode('utils.broken', { name: 'My Broken Node' }).id;
        const down = add(g, 'utils.levels');
        link(g, bad, down);
        const good = add(g, 'grayscale.uniform', { value: 0.4 });
        const mark = consoleBus.entries.length;
        const res = await e.evaluator.evaluate(g, [{ nodeId: bad }, { nodeId: down }, { nodeId: good }]);
        const errs = new Map(res.errors);
        const goodV = res.values.get(targetKey({ nodeId: good }));
        res.release();
        if (!errs.has(bad)) throw new Error('broken node has no error badge');
        if (!errs.has(down)) throw new Error('downstream of a failed node should be blocked');
        if (errs.has(good) || !goodV) throw new Error('healthy node was affected by the broken one');
        const entry = consoleBus.entries.slice(mark).find((x) => x.source === 'shader' && x.level === 'error');
        if (!entry) throw new Error('no shader error in the Console');
        if (entry.nodeId !== bad || entry.nodeName !== 'My Broken Node') throw new Error(`console entry lacks node identity: ${JSON.stringify(entry)}`);
        if (entry.file !== 'node:broken.wgsl' || entry.line !== 2) throw new Error(`expected node:broken.wgsl:2, got ${entry.file}:${entry.line}`);
        return consoleBus.format(entry) + `\nblocked downstream: "${errs.get(down)}"`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'GPU validation error is isolated to its node (batched submit falls back to isolated mode)',
    async run(env) {
      const reg = testRegistry(env);
      const e = engineOf(env, undefined, reg);
      try {
        const g = mk(e, 16);
        const bad = add(g, 'utils.selfref');
        const good = add(g, 'grayscale.uniform', { value: 0.6 });
        const res = await e.evaluator.evaluate(g, [{ nodeId: bad }, { nodeId: good }]);
        const msg = res.errors.get(bad);
        const okValue = res.values.get(targetKey({ nodeId: good }));
        const isolated = res.stats.isolated;
        res.release();
        if (!msg) throw new Error('validation error was not attributed to the node');
        if (!okValue || res.errors.has(good)) throw new Error('healthy node was poisoned');
        if (!isolated) throw new Error('expected isolated re-run');
        const check = await read(e, g, good);
        expectAll(check, 0.6, 1e-3, 'healthy node output');
        return `attributed: ${msg.slice(0, 160)}`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Scheduler coalesces many invalidations into few evaluations',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const n = add(g, 'grayscale.noise');
        e.scheduler.attach(g);
        e.scheduler.setTargets('t', [{ nodeId: n }]);
        let count = 0;
        e.scheduler.onResult.on(() => count++);
        e.scheduler.start();
        for (let i = 0; i < 25; i++) g.setParam(n, 'seed', i);
        const t0 = performance.now();
        while (count < 1 && performance.now() - t0 < 4000) await new Promise((r) => setTimeout(r, 20));
        await new Promise((r) => setTimeout(r, 150));
        e.scheduler.stop();
        if (count < 1) throw new Error('no result delivered (is the tab visible? rAF is paused in background tabs)');
        if (count > 3) throw new Error(`${count} evaluations for one burst of invalidations`);
        return `${count} evaluation(s) for 25 param changes`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Viewport presenter draws without GPU errors (3x3 tiling, channels)',
    async run(env) {
      const e = engineOf(env);
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;left:-9999px;top:0;width:96px;height:96px';
      document.body.appendChild(canvas);
      try {
        let uncaptured = 0;
        const off = env.gpu.onUncapturedError.on(() => uncaptured++);
        const g = mk(e, 64);
        const n = add(g, 'grayscale.noise');
        const res = await e.evaluator.evaluate(g, [{ nodeId: n }]);
        const v = res.values.get(targetKey({ nodeId: n })) as TextureValue;
        const p = new TexturePresenter(e, canvas);
        const o = defaultPresentOptions();
        for (const tiles of [1, 3] as const) for (const channel of ['rgb', 'r', 'luma'] as const) p.draw(v, { ...o, tiles, channel });
        await new Promise((r) => setTimeout(r, 250));
        p.draw(v, { ...o, tiles: 3 });
        await env.gpu.device.queue.onSubmittedWorkDone();
        res.release();
        off();
        if (uncaptured) throw new Error(`${uncaptured} uncaptured GPU errors`);
        return 'ok';
      } finally {
        canvas.remove();
        dispose(e);
      }
    },
  },
  {
    name: 'Undo/redo through GraphEditor drives re-evaluation to the same pixels',
    async run(env) {
      const e = engineOf(env);
      try {
        const ed = new GraphEditor(mk(e, 32));
        const n = ed.addNode('grayscale.uniform', { params: { value: 0.2 } });
        ed.setParam(n, 'value', 0.9);
        expectAll(await read(e, ed.graph, n), 0.9, 1e-3, 'after edit');
        ed.stack.undo();
        expectAll(await read(e, ed.graph, n), 0.2, 1e-3, 'after undo');
        ed.stack.redo();
        expectAll(await read(e, ed.graph, n), 0.9, 1e-3, 'after redo');
        return 'ok';
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'three.js shares our GPUDevice (shared device check)',
    async run(env) {
      const r = await runThreeSharedDeviceCheck(env.gpu);
      if (!r.ok) throw new Error(`shared device check failed: ${JSON.stringify(r)}`);
      return `sharedDevice=${r.sharedDevice} compatibilityMode=${r.compatibilityMode} ExternalTexture=${r.externalTexture}\n${r.notes.join('\n')}`;
    },
  },
  {
    name: 'Timestamp queries (per-node GPU timing)',
    async run(env) {
      const e = engineOf(env);
      try {
        if (!e.profiler.enabled) throw new Skip('timestamp-query not supported on this adapter (CPU timings only)');
        const g = mk(e, 512);
        const n = add(g, 'grayscale.noise', { octaves: 8 });
        let ms: number | undefined;
        e.evaluator.onTiming.on((s) => (ms = s.gpuMs));
        const res = await e.evaluator.evaluate(g, [{ nodeId: n }]);
        const t0 = performance.now();
        while (ms === undefined && performance.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
        res.release();
        if (ms === undefined) throw new Error('no GPU timing arrived');
        return `noise 512x512 x8 octaves: ${ms.toFixed(3)} ms GPU`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Device-lost recovery',
    async run() {
      throw new Skip('cannot be triggered safely from a page (device.destroy() is a deliberate, non-recoverable loss). Logic: GpuContext.handleLost -> Engine.handleRestored; covered by code review + mock unit tests.');
    },
  },

  /* ------------------------------------------------------------------ UI logic (no GPU needed) */
  ...uiLogicChecks.map((c) => ({ name: `UI · ${c.name}`, run: async () => c.run() })),
  {
    name: 'UI · every required panel is registered (shell contract)',
    async run() {
      discoverPanels();
      const need = ['graph-editor', 'viewport-2d', 'viewport-3d', 'properties', 'node-library', 'timeline', 'curve-editor', 'export', 'assets', 'console', 'node-gallery'];
      const missing = need.filter((id) => !getPanel(id));
      if (missing.length) throw new Error(`missing panels: ${missing.join(', ')}`);
      return `${need.length} panels`;
    },
  },
  {
    name: 'UI · number expression parser + fuzzy search + gradient interpolation modes',
    async run() {
      const eq = (a: number, b: number, m: string): void => {
        if (Math.abs(a - b) > 1e-9) throw new Error(`${m}: ${a} != ${b}`);
      };
      eq(parseExpr('50%'), 50, 'percent');
      eq(parseExpr('1/4 + 2*(3-1)'), 4.25, 'expr');
      eq(parseExpr('-3.5'), -3.5, 'neg');
      if (!Number.isNaN(parseExpr('abc')) || !Number.isNaN(parseExpr('1+'))) throw new Error('garbage must be NaN');
      if (!(fuzzy('nse', 'Noise') > 0) || fuzzy('zzz', 'Noise') !== 0) throw new Error('fuzzy');
      const g = { stops: [{ pos: 0, color: [0, 0, 0, 1] as [number, number, number, number] }, { pos: 1, color: [1, 1, 1, 1] as [number, number, number, number] }] };
      eq(evalGradient(g, 0.5)[0], 0.5, 'linear mid');
      eq(evalGradient({ ...g, interp: 'step' }, 0.9)[0], 0, 'step');
      eq(evalGradient({ ...g, interp: 'smooth' }, 0.25)[0], 0.15625, 'smooth');
      const ok = evalGradient({ ...g, interp: 'oklab' }, 0.5)[0];
      if (!(ok > 0.1 && ok < 0.5)) throw new Error(`oklab mid ${ok}`);
    },
  },
  /* ------------------------------------------------------------------ graph editor */
  ...graphEditorChecks(() => (discoverNodes(nodeRegistry), nodeRegistry)).map((c) => ({ name: c.name.replace('Graph editor:', 'Graph ·'), run: async () => c.run() })),
  /* ------------------------------------------------------------------ 2D viewport + gizmos */
  ...gizmoChecks(() => (discoverNodes(nodeRegistry), nodeRegistry)).map((c) => ({ name: c.name, run: async () => c.run() })),
  noiseCase('Noise rotation 30 deg (no tiling, free rotation) · GPU vs CPU', { rotation: 30, scale: [5, 3] }, { rotation: 30, scale: [5, 3], tile: [false, false], res: [64, 64] }, { tiling: 'none' }, 4e-3),
  noiseCase('Noise rotation 90 deg + offset (tiling: quarter turn swaps the lattice axes) · GPU vs CPU', { rotation: 90, scale: [4, 6], offset: [0.13, -0.2] }, { rotation: 90, scale: [4, 6], offset: [0.13, -0.2] }),
  noiseCase('Noise rotation 270 deg, tile X only · GPU vs CPU', { rotation: 270, scale: [3, 5] }, { rotation: 270, scale: [3, 5], tile: [true, false] }, { tiling: 'x' }),
  {
    name: '2D viewport · histogram + stats known answer (uniform 0.5 -> bin 128 holds every pixel; min=max=mean=0.5)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const id = add(g, 'grayscale.uniform', { value: 0.5 });
        const res = await e.evaluator.evaluate(g, [{ nodeId: id }], {});
        const v = res.values.get(targetKey({ nodeId: id })) as TextureValue;
        const an = new Analyzer(e);
        const r = await new Promise<import('../panels/viewport-2d/analysis').AnalysisResult>((ok, bad) => {
          an.analyze(v.tex, 1, null, ok);
          setTimeout(() => bad(new Error('analysis timed out (6 s): see Console for shader errors')), 6000);
        });
        res.release();
        if (r.hist[128] !== 4096) throw new Error(`hist[R][128] = ${r.hist[128]} expected 4096`);
        if (r.hist[1024 + 128] !== 4096) throw new Error(`hist[L][128] = ${r.hist[1024 + 128]} expected 4096`);
        for (const [n, x] of [['min', r.min[0]], ['max', r.max[0]], ['mean', r.mean[0]]] as [string, number][]) if (Math.abs(x - 0.5) > 1e-3) throw new Error(`${n} = ${x}`);
        if (r.count !== 4096) throw new Error(`count ${r.count}`);
        return 'hist, min, max, mean, count exact';
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: '2D viewport · region min/max/mean of noise (GPU compute vs CPU reference)',
    async run(env) {
      const e = engineOf(env);
      try {
        const size = 64;
        const g = mk(e, size);
        const id = add(g, 'grayscale.noise', {});
        const res = await e.evaluator.evaluate(g, [{ nodeId: id }], {});
        const v = res.values.get(targetKey({ nodeId: id })) as TextureValue;
        const region = { x: 10, y: 20, w: 30, h: 17 };
        const an = new Analyzer(e);
        const r = await new Promise<import('../panels/viewport-2d/analysis').AnalysisResult>((ok, bad) => {
          an.analyze(v.tex, 1, region, ok);
          setTimeout(() => bad(new Error('analysis timed out')), 6000);
        });
        res.release();
        let mn = Infinity;
        let mx = -Infinity;
        let sum = 0;
        for (let y = region.y; y < region.y + region.h; y++)
          for (let x = region.x; x < region.x + region.w; x++) {
            const val = noiseReference(NOISE_DEFAULTS, (x + 0.5) / size, (y + 0.5) / size);
            mn = Math.min(mn, val);
            mx = Math.max(mx, val);
            sum += val;
          }
        const mean = sum / (region.w * region.h);
        const worst = Math.max(Math.abs(r.min[0] - mn), Math.abs(r.max[0] - mx), Math.abs(r.mean[0] - mean));
        if (!(worst < 3e-3)) throw new Error(`GPU min/max/mean ${r.min[0]}/${r.max[0]}/${r.mean[0]} vs CPU ${mn}/${mx}/${mean}`);
        if (r.count !== region.w * region.h) throw new Error(`count ${r.count}`);
        return `worst error ${worst.toExponential(2)} over ${r.count} px`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: '2D viewport · async pixel inspector read (uniform 0.25)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 32);
        const id = add(g, 'grayscale.uniform', { value: 0.25 });
        const res = await e.evaluator.evaluate(g, [{ nodeId: id }], {});
        const v = res.values.get(targetKey({ nodeId: id })) as TextureValue;
        const px = await new Promise<Float32Array | null>((ok) => new Analyzer(e).readPixel(v.tex, 5, 7, ok));
        res.release();
        if (!px || Math.abs(px[0] - 0.25) > 1e-3) throw new Error(`pixel ${px ? Array.from(px).join(',') : 'null'}`);
        return `value ${px[0]}`;
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: '2D viewport · display shader compiles and every mode draws without GPU validation errors',
    async run(env) {
      const e = engineOf(env);
      const dev = env.gpu.device;
      try {
        const g = mk(e, 64);
        const id = add(g, 'grayscale.noise', {});
        const res = await e.evaluator.evaluate(g, [{ nodeId: id }], {});
        const v = res.values.get(targetKey({ nodeId: id })) as TextureValue;
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const disp = new DisplayRenderer(e, canvas);
        const s = defaultSettings();
        const view = new ViewTransform({ zoom: 2, cx: 160, cy: 120, rot: 0, flipX: false, flipY: false, imgW: 64, imgH: 64 });
        let pending = false;
        disp.onPending = () => (pending = true);
        const frame = (mut: (x: typeof s) => void, kind: 0 | 1 | 2 | 3 = 1): void => {
          const st = { ...s };
          mut(st);
          disp.draw({ a: { tex: v.tex, kind }, b: { tex: v.tex, kind: 1 }, view, dpr: 1, s: st, regionLo: [-1, -1], regionHi: [2, 2], wrap: [true, true], comparePx: 150, sphere: kind === 3 ? [160, 80, 120, 120] : null });
        };
        for (let i = 0; i < 40; i++) {
          pending = false;
          frame(() => {});
          if (!pending) break;
          await delay(50);
        }
        if (pending) throw new Error('display shader never finished compiling (see Console)');
        dev.pushErrorScope('validation');
        frame(() => {});
        frame((x) => ((x.viz = 'heat'), (x.channel = 'r'), (x.heatPal = 1)));
        frame((x) => ((x.seam = true), (x.pixelGrid = true), (x.tile = '3x3')), 0);
        frame((x) => ((x.viz = 'arrows'), (x.uvMode = 'flowmap')), 2);
        frame((x) => ((x.viz = 'lic'), (x.uvMode = 'absolute')), 2);
        frame((x) => ((x.flipG = true), (x.sphere = true)), 3);
        frame((x) => ((x.compare = 'node'), (x.compareDir = 'h'), (x.alpha = 'premult'), (x.bg = 'white')), 0);
        const err = await dev.popErrorScope();
        res.release();
        if (err) throw new Error(`GPU validation error: ${err.message}`);
        return '7 display variants drawn';
      } finally {
        dispose(e);
      }
    },
  },
  {
    name: 'Graph · thumbnail atlas: shaders compile, evaluated node is blitted (known answer: uniform 0.5 -> ~128)',
    async run(env) {
      const e = engineOf(env);
      try {
        const g = mk(e, 64);
        const id = add(g, 'grayscale.uniform', { value: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const layer = new ThumbnailLayer(e, canvas);
        if (!layer.ready) throw new Error('ThumbnailLayer failed to initialise (see Console)');
        layer.attach(g);
        layer.setWanted([id]);
        const t0 = performance.now();
        while (!layer.hasThumb(id) && performance.now() - t0 < 6000) await delay(60);
        if (!layer.hasThumb(id)) throw new Error('thumbnail was not produced within 6 s (scheduler busy or evaluation error)');
        const px = await layer.readCentrePixel(id);
        layer.draw([{ nodeId: id, x: 0, y: 0, w: 64, h: 64, dim: 1 }], 64, 64);
        layer.dispose();
        if (!px || Math.abs(px[0] - 128) > 3 || Math.abs(px[1] - 128) > 3 || Math.abs(px[2] - 128) > 3) throw new Error(`atlas pixel ${JSON.stringify(px)} expected ~[128,128,128,255]`);
        return `atlas pixel ${px.join(',')} in ${(performance.now() - t0).toFixed(0)} ms`;
      } finally {
        dispose(e);
      }
    },
  },
  ...generatorTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...vfxNodeTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...simFrameworkTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...simVectorTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...editorChecks({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...processingTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...filterTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...uvNormalIslandTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...animTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...meshTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...meshNodeTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...libraryTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...sampleTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...exportTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  // pixel pass fusion (group "Fusion").
  ...fusionTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...histogramTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...workerTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  ...i18nTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
  // perf / stress / hardening. The device-lost test recreates the shared device and therefore MUST stay last.
  ...perfTests({ engineOf, dispose, mk, add, link, read, maxErr, halfTol: HALF_TOL }),
];

export type { EvalTarget };
export { ShaderCompileError };

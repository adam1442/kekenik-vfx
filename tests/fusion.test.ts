import { describe, expect, it } from 'vitest';
import { Graph } from '../src/engine/graph/graph';
import { buildPlan } from '../src/engine/graph/plan';
import { planFusion, DEFAULT_FUSION_LIMITS, type FuseNodeView } from '../src/engine/fusion/planner';
import { FusionRuntime, fuseView, specsFor } from '../src/engine/fusion/runtime';
import { attributeLine, extractFuseRegion, generateFusedModule, namespaceWgsl, segmentSignature, topLevelNames, type FuseNodeSpec } from '../src/engine/fusion/wgsl-gen';
import { assembleFullscreenShader } from '../src/engine/shaders/assemble';
import { defineShader } from '../src/engine/shaders/library';
import { makeLayout } from '../src/engine/shaders/uniforms';
import { makeRegistry } from './helpers';

/* ------------------------------------------------------------------------------------------------ planner (pure) */

const v = (id: string, o: Partial<FuseNodeView> & { from?: string } = {}): FuseNodeView => ({
  id,
  fusable: true,
  head: false,
  main: o.from ? { node: o.from, pin: 'output' } : null,
  mainFromType: 'gray',
  mainPinType: 'gray',
  outType: 'gray',
  extraConnected: 0,
  extraUnconnected: false,
  consumers: 1,
  frameSig: 'A',
  identity: false,
  uniformBytes: 32,
  ...o,
});
const run = (views: FuseNodeView[], targets: string[] = [], limits = DEFAULT_FUSION_LIMITS, enabled = true) => {
  const m = new Map(views.map((x) => [x.id, x]));
  return planFusion(
    views.map((x) => x.id),
    (id) => m.get(id),
    new Set(targets),
    limits,
    enabled,
  );
};

describe('fusion planner', () => {
  it('fuses a linear chain (generator head -> 3 per-pixel nodes) into ONE segment and counts the saved passes', () => {
    const p = run([v('g', { head: true }), v('a', { from: 'g' }), v('b', { from: 'a' }), v('c', { from: 'b', consumers: 0 })], ['c']);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].ids).toEqual(['g', 'a', 'b', 'c']);
    expect(p.segments[0].last).toBe('c');
    expect(p.before).toBe(4);
    expect(p.after).toBe(1);
  });

  it('a node consumed by two nodes ends the segment (it must materialise)', () => {
    const p = run([v('g', { head: true }), v('a', { from: 'g', consumers: 2 }), v('b', { from: 'a' }), v('c', { from: 'a' })], ['b', 'c']);
    // g+a fuse; b and c are single nodes -> no further segment
    expect(p.segments.map((s) => s.ids)).toEqual([['g', 'a']]);
  });

  it('an evaluation target (viewport / thumbnail / export) in the middle ends the segment', () => {
    const p = run([v('g', { head: true }), v('a', { from: 'g' }), v('b', { from: 'a' }), v('c', { from: 'b' })], ['a', 'c']);
    expect(p.segments.map((s) => s.ids)).toEqual([['g', 'a'], ['b', 'c']].filter((x) => x.length > 1));
    expect(p.segments[0].last).toBe('a');
  });

  it('mismatched size / tiling / format breaks the chain', () => {
    const p = run([v('g', { head: true }), v('a', { from: 'g' }), v('b', { from: 'a', frameSig: 'B' }), v('c', { from: 'b', frameSig: 'B' })]);
    expect(p.segments.map((s) => s.ids)).toEqual([['g', 'a'], ['b', 'c']]);
    const q = run([v('g', { head: true }), v('a', { from: 'g', outType: 'uv', mainPinType: 'gray', mainFromType: 'uv' })]);
    expect(q.segments).toHaveLength(0);
  });

  it('implicit Gray -> Color links are fused; other conversions are not', () => {
    const ok = run([v('g', { head: true }), v('a', { from: 'g', mainPinType: 'color', mainFromType: 'gray', outType: 'color' })]);
    expect(ok.segments).toHaveLength(1);
    const bad = run([v('g', { head: true, outType: 'color' }), v('a', { from: 'g', mainPinType: 'gray', mainFromType: 'color' })]);
    expect(bad.segments).toHaveLength(0);
  });

  it('non-fusable nodes (neighbourhood / bypass / background connected) are chain boundaries', () => {
    const p = run([v('g', { head: true }), v('blur', { from: 'g', fusable: false }), v('a', { from: 'blur' }), v('b', { from: 'a' })]);
    expect(p.segments.map((s) => s.ids)).toEqual([['a', 'b']]);
    expect(p.segments[0].seed).toEqual({ node: 'blur', pin: 'output' });
  });

  it('splits when the texture / uniform / node limits would be exceeded', () => {
    const views = [v('g', { head: true, extraConnected: 1 })];
    for (let i = 0; i < 6; i++) views.push(v(`n${i}`, { from: i === 0 ? 'g' : `n${i - 1}`, extraConnected: 1 }));
    const p = run(views, [], { maxTextures: 4, maxUniformBytes: 1e6, maxNodes: 99 });
    expect(p.segments.length).toBeGreaterThan(1);
    for (const s of p.segments) expect(s.textures).toBeLessThanOrEqual(4);
    const q = run(views, [], { maxTextures: 99, maxUniformBytes: 64, maxNodes: 99 }); // 2 nodes x 32 bytes per segment
    for (const s of q.segments) expect(s.ids.length).toBeLessThanOrEqual(2);
    const r = run(views, [], { maxTextures: 99, maxUniformBytes: 1e6, maxNodes: 3 });
    for (const s of r.segments) expect(s.ids.length).toBeLessThanOrEqual(3);
  });

  it('shares ONE dummy texture binding for all unconnected extras of a segment', () => {
    const p = run([v('g', { head: true, extraUnconnected: true }), v('a', { from: 'g', extraUnconnected: true }), v('b', { from: 'a', extraUnconnected: true })]);
    expect(p.segments[0].textures).toBe(1);
  });

  it('identity-parameter nodes with one consumer are removed from the chain before fusion', () => {
    const p = run([v('g', { head: true }), v('id', { from: 'g', identity: true, fusable: false }), v('a', { from: 'id' })]);
    expect(p.segments).toHaveLength(1);
    expect(p.segments[0].ids).toEqual(['g', 'a']);
    expect(p.segments[0].skipped).toEqual(['id']);
    expect(p.after).toBe(1);
    // a target identity node must materialise: no removal
    const q = run([v('g', { head: true }), v('id', { from: 'g', identity: true, fusable: false }), v('a', { from: 'id' })], ['id']);
    expect(q.segments.every((s) => !s.skipped.includes('id'))).toBe(true);
  });

  it('a fusable identity node is dropped from the chain too', () => {
    const p = run([v('g', { head: true }), v('id', { from: 'g', identity: true }), v('a', { from: 'id' }), v('b', { from: 'a' })]);
    expect(p.segments[0].ids).toEqual(['g', 'a', 'b']);
    expect(p.segments[0].skipped).toEqual(['id']);
  });

  it('is deterministic and can be disabled', () => {
    const views = [v('g', { head: true }), v('a', { from: 'g' }), v('b', { from: 'a' })];
    expect(JSON.stringify(run(views).segments)).toBe(JSON.stringify(run(views).segments));
    const off = run(views, [], DEFAULT_FUSION_LIMITS, false);
    expect(off.segments).toHaveLength(0);
    expect(off.before).toBe(off.after);
  });
});

/* -------------------------------------------------------------------------------------------- generator (pure) */

const LAYOUT = makeLayout([
  { name: 'k', type: 'f32' },
  { name: 'tint', type: 'vec4f' },
]);
const SRC = `#include "sampling"
const GAIN: f32 = 2.0;
// @fuse-begin
fn helper(P: Params, x: f32) -> f32 {
  return x * P.k * GAIN;
}
fn fuse(uv: vec2f, src: vec4f, P: Params, x0: texture_2d<f32>) -> vec4f {
  return vec4f(helper(P, src.r) + tex_sample(x0, uv, F.tile, F.filter_mode).r, 0.0, 0.0, 1.0) * P.tint;
}
// @fuse-end
fn shade(uv: vec2f) -> vec4f { return fuse(uv, tex_sample(t0, uv, F.tile, F.filter_mode), P, t1); }
`;
const spec = (over: Partial<FuseNodeSpec> = {}): FuseNodeSpec => ({
  type: 'test.node',
  sourceId: 'test#1',
  code: SRC,
  fileName: 'test.wgsl',
  layout: LAYOUT,
  extras: [true],
  head: false,
  grayToColor: false,
  ...over,
});

describe('fused WGSL generator', () => {
  it('extracts the fuse region and every #include', () => {
    const r = extractFuseRegion(SRC, 'test.wgsl');
    expect(r.includes).toEqual(['sampling']);
    expect(r.body).toContain('fn fuse(');
    expect(r.body).not.toContain('fn shade');
    expect(r.startLine).toBe(4);
    expect(() => extractFuseRegion('fn x() {}', 'bad.wgsl')).toThrow(/markers/);
  });

  it('finds module-scope names only and namespaces declarations + uses (not members, not locals)', () => {
    const body = 'fn helper(P: Params, x: f32) -> f32 {\n  let helper_x = x;\n  return helper_x * P.k;\n}\nfn fuse(uv: vec2f, P: Params) -> f32 { return helper(P, 1.0) + P.helper; }';
    expect(topLevelNames(body).sort()).toEqual(['fuse', 'helper']);
    const out = namespaceWgsl(body, 'n3');
    expect(out).toContain('fn n3_helper(P: Params_n3');
    expect(out).toContain('n3_helper(P, 1.0)');
    expect(out).toContain('P.helper'); // member access untouched
    expect(out).toContain('helper_x'); // longer identifier untouched
    expect(out.split('\n').length).toBe(body.split('\n').length); // line numbers preserved
  });

  it('two instances of the same node never collide and the order of nodes is preserved', () => {
    const m = generateFusedModule([spec(), spec({ extras: [false] }), spec({ head: true })], false);
    expect(m.code.match(/fn n0_fuse\(/g)).toHaveLength(1);
    expect(m.code.match(/fn n1_fuse\(/g)).toHaveLength(1);
    expect(m.code.match(/fn n2_fuse\(/g)).toHaveLength(1);
    expect(m.code.match(/#include "sampling"/g)).toHaveLength(1); // hoisted once
    const iFuse0 = m.code.indexOf('c = n0_fuse');
    const iFuse1 = m.code.indexOf('c = n1_fuse');
    const iFuse2 = m.code.indexOf('c = n2_fuse');
    expect(iFuse0).toBeGreaterThan(0);
    expect(iFuse1).toBeGreaterThan(iFuse0);
    expect(iFuse2).toBeGreaterThan(iFuse1);
    // bindings: seed t0, connected extras t1 + t2 (nodes 0 and 2), ONE shared dummy t3 (node 1)
    expect(m.slots.map((s) => s.kind)).toEqual(['seed', 'extra', 'extra', 'dummy']);
    expect(m.layout.fields.map((f) => f.name)).toContain('n2_tint');
    expect(m.code).toContain('Params_n1(P.n1_k, P.n1_tint)');
  });

  it('maps generated lines back to the originating node and its own source line', () => {
    const m = generateFusedModule([spec(), spec()], false);
    const lines = m.code.split('\n');
    const gen = lines.findIndex((l) => l.includes('fn n1_helper')) + 1;
    const at = attributeLine(m.lineMap, gen);
    expect(at).toMatchObject({ node: 1, fileName: 'test.wgsl', line: 4 }); // `fn helper` is line 4 of SRC
    expect(attributeLine(m.lineMap, 1)).toBeNull();
  });

  it('signature depends on node order / type / layout / extras but NEVER on parameter values', () => {
    const a = spec();
    const b = spec({ type: 'test.other', sourceId: 'test#2' });
    const s1 = segmentSignature([a, b], false);
    expect(segmentSignature([a, b], false)).toBe(s1);
    expect(segmentSignature([b, a], false)).not.toBe(s1);
    expect(segmentSignature([a, a], false)).not.toBe(s1);
    expect(segmentSignature([a, spec({ extras: [false] })], false)).not.toBe(segmentSignature([a, a], false));
    // the generator has no access to parameter values at all: identical specs give identical code
    expect(generateFusedModule([a, b], false).code).toBe(generateFusedModule([a, b], false).code);
  });

  it('the LRU of generated modules is bounded', () => {
    const rt = new FusionRuntime();
    const evicted: string[] = [];
    rt.onEvict = (id) => evicted.push(id);
    for (let i = 0; i < FusionRuntime.MAX_MODULES + 10; i++) rt.moduleFor([spec({ type: `t${i}`, sourceId: `s${i}` })]);
    expect(rt.moduleCount).toBe(FusionRuntime.MAX_MODULES);
    expect(evicted).toHaveLength(10);
  });
});

/* -------------------------------------------------------------------------- real graph: planner + generator + Dawn */

function chain(): { g: Graph; ids: string[] } {
  const reg = makeRegistry();
  const g = new Graph(reg, { width: 64, height: 64 });
  const u = g.addNode('grayscale.uniform', { params: { value: 0.4 } }).id;
  const c = g.addNode('grayscale.curve').id;
  const l = g.addNode('utils.levels', { params: { gamma: 1.3 } }).id;
  const r = g.addNode('color.ramp').id;
  const a = g.addNode('color.adjust', { params: { hue: 30 } }).id;
  const pairs: [string, string][] = [[u, c], [c, l], [l, r], [r, a]];
  for (const [f, t] of pairs) g.connect({ node: f, pin: 'output' }, { node: t, pin: 'input' });
  return { g, ids: [u, c, l, r, a] };
}

describe('fusion on real node definitions', () => {
  it('Uniform -> Curve -> Levels -> Ramp -> Adjust is ONE segment; branching / a viewport on the middle node splits it', () => {
    const { g, ids } = chain();
    const plan = buildPlan(g, [ids[4]], { time: 0, scale: 1, maxDim: 4096 });
    const consumers = new Map<string, number>();
    for (const l of g.links.values()) consumers.set(l.from.node, (consumers.get(l.from.node) ?? 0) + 1);
    const views = new Map(plan.order.map((id) => [id, fuseView(plan, id, consumers.get(id) ?? 0)!]));
    for (const id of ids) expect(views.get(id)?.fusable, id).toBe(true);
    const p = planFusion(plan.order, (id) => views.get(id), new Set([ids[4]]));
    expect(p.segments.map((s) => s.ids)).toEqual([ids]);
    expect(p.after).toBe(1);
    const p2 = planFusion(plan.order, (id) => views.get(id), new Set([ids[4], ids[2]]));
    expect(p2.segments.map((s) => s.ids.length)).toEqual([3, 2]);
    // a different time-independent param does not change the signature
    const sig1 = segmentSignature(specsFor(p.segments[0], plan), false);
    g.setParam(ids[4], 'hue', 90);
    const plan2 = buildPlan(g, [ids[4]], { time: 0, scale: 1, maxDim: 4096 });
    expect(segmentSignature(specsFor(p.segments[0], plan2), false)).toBe(sig1);
  });

  it('Levels with Auto uses a reduction buffer and is not fusable; Adjust identity is dropped from the chain', () => {
    const { g, ids } = chain();
    g.setParam(ids[2], 'auto', true);
    const plan = buildPlan(g, [ids[4]], { time: 0, scale: 1, maxDim: 4096 });
    expect(fuseView(plan, ids[2], 1)?.fusable).toBe(false);
    g.setParam(ids[2], 'auto', false);
    g.setParam(ids[4], 'hue', 0);
    const plan2 = buildPlan(g, [ids[4]], { time: 0, scale: 1, maxDim: 4096 });
    expect(fuseView(plan2, ids[4], 0)?.identity).toBe(true);
  });

  it('every fusable definition has valid markers and generates a module whose uniform layout matches its declaration', () => {
    const reg = makeRegistry();
    let n = 0;
    for (const def of reg.list()) {
      const d = def.fusable;
      if (!d) continue;
      n++;
      const m = generateFusedModule(
        [{ type: def.id, sourceId: d.source.id, code: d.source.code, fileName: d.source.name, layout: d.uniforms, defines: d.defines, extras: (d.extras ?? []).map(() => true), head: d.main === null, grayToColor: false }],
        false,
      );
      expect(m.layout.fields.length, def.id).toBe(d.uniforms.fields.length);
      expect(m.code, def.id).toContain('n0_fuse');
    }
    expect(n).toBeGreaterThanOrEqual(7);
  });
});

/** Opt-in: real Tint compilation of fused modules. `npm i --no-save webgpu && DAWN=1 npx vitest run tests/fusion.test.ts` */
describe.skipIf(!process.env.DAWN)('fused WGSL compiles in Tint (Dawn null backend)', () => {
  it('every fusable node alone, the 5-node chain and a deliberately broken node (error attributed to the right node)', async () => {
    const mod = (await import(/* @vite-ignore */ process.env.DAWN_PATH ?? 'webgpu')) as { create(flags: string[]): GPU; globals: object };
    Object.assign(globalThis, mod.globals);
    const gpu = mod.create(['backend=null', 'enable-dawn-features=allow_unsafe_apis']);
    const dev = await (await gpu.requestAdapter())!.requestDevice();
    const reg = makeRegistry();
    const specOf = (id: string, extrasConnected: boolean): FuseNodeSpec => {
      const d = reg.get(id)!.fusable!;
      return { type: id, sourceId: d.source.id, code: d.source.code, fileName: d.source.name, layout: d.uniforms, defines: d.defines, extras: (d.extras ?? []).map(() => extrasConnected), head: d.main === null, grayToColor: false };
    };
    const compile = async (specs: FuseNodeSpec[]) => {
      const m = generateFusedModule(specs, false);
      const a = assembleFullscreenShader({ shader: defineShader(m.name, m.code), uniforms: m.layout, textures: m.slots.length, mode: 'shade' });
      const sm = dev.createShaderModule({ code: a.code });
      const info = await sm.getCompilationInfo();
      return { m, a, errors: info.messages.filter((x) => x.type === 'error') };
    };
    const failures: string[] = [];
    for (const def of reg.list()) {
      if (!def.fusable) continue;
      for (const conn of [true, false]) {
        const r = await compile([specOf(def.id, conn)]);
        for (const e of r.errors) failures.push(`${def.id}(${conn}): ${e.lineNum} ${e.message}`);
      }
    }
    expect(failures).toEqual([]);
    const five = await compile([specOf('grayscale.uniform', false), specOf('grayscale.curve', false), specOf('utils.levels', false), { ...specOf('color.ramp', false), grayToColor: false }, { ...specOf('color.adjust', false), grayToColor: false }]);
    expect(five.errors).toEqual([]);
    // broken node
    const good = specOf('grayscale.curve', false);
    const bad: FuseNodeSpec = { ...good, type: 'test.broken', sourceId: 'broken#1', code: good.code.replace('let v = src.r;', 'let v = src.r +;') };
    const r = await compile([specOf('grayscale.uniform', false), bad, specOf('utils.levels', false)]);
    expect(r.errors.length).toBeGreaterThan(0);
    // map the Tint line (in the assembled output) back to the generated line through the preprocessor map
    const outLine = r.errors[0].lineNum;
    const loc = r.a.map[outLine - 1];
    const at = attributeLine(r.m.lineMap, loc.line);
    expect(at?.node).toBe(1);
    expect(at?.type).toBe('test.broken');
  });
});

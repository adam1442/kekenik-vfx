import { describe, expect, it } from 'vitest';
import { AnimationEditor } from '../src/engine/anim/anim-editor';
import { makeAnimator } from '../src/engine/anim/animator';
import { FrameCache, autoCacheBytes, cacheCapacityFrames } from '../src/engine/anim/frame-cache';
import { autoGrid, cellRect, cellSize, crossfadeWeights, decodeFrame, frameUvRect, sampleFrame, validateSheet, type SheetSpec } from '../src/engine/anim/flipbook-layout';
import { channelOf, evalChannel, loopError, loopMatch, mirrorKeys, moveKeys, newKey, resolveSlopes, setKey, setTangent, flattenKeys, removeKeys, hermite, type Channel } from '../src/engine/anim/keyframes';
import { PacingMonitor, advanceFrame, displayFrame } from '../src/engine/anim/pacing';
import { analyzeSeam } from '../src/engine/anim/seam';
import { animRange, defaultTimeline, formatFrame, parseFrame, sanitizeTimeline, workRange } from '../src/engine/anim/timebase';
import { blendSnapshots, evalTrack, fromChannelValues, moveTrackKeys, removeTrackKey, sanitizeNodeAnim, setTrackKey, toChannelValues, trackKeyFrames, scaleTrackKeys } from '../src/engine/anim/tracks';
import { CommandStack } from '../src/engine/commands/command';
import { GraphEditor } from '../src/engine/commands/graph-commands';
import { Graph } from '../src/engine/graph/graph';
import { buildPlan, lazySignature } from '../src/engine/graph/plan';
import { MeshData } from '../src/engine/mesh/mesh';
import { defaultPointAttrParams, packParticles, pointAttributes, snapTravelAxis, wrapAxis, PARTICLE_STRIDE } from '../src/engine/particles/attributes';
import { hasKey, mapTrackKeys, selKey, shortValue } from '../src/panels/timeline/logic';
import { decodePlan, } from '../src/nodes/utils/sheet_decode/definition';
import { resolveSheet } from '../src/nodes/utils/sheet_encode/definition';
import { makeRegistry } from './helpers';

const reg = makeRegistry();
const lin = (...kv: [number, number][]): Channel => channelOf(kv.map(([t, v]) => newKey(t, v, { interp: 'linear' })));
const bez = (...kv: [number, number][]): Channel => channelOf(kv.map(([t, v]) => newKey(t, v)));
const near = (a: number, b: number, e = 1e-6): void => expect(Math.abs(a - b)).toBeLessThan(e);

describe('keyframe interpolation', () => {
  it('constant holds, linear lerps, keys hit exactly', () => {
    const c = channelOf([newKey(0, 1, { interp: 'constant' }), newKey(10, 3, { interp: 'linear' }), newKey(20, 7)]);
    expect(evalChannel(c, 5)).toBe(1);
    near(evalChannel(c, 10), 3);
    near(evalChannel(c, 15), 5);
    near(evalChannel(c, 20), 7);
  });
  it('bezier / hermite passes through the keys and matches the slope formula', () => {
    const c = channelOf([newKey(0, 0, { mode: 'free', broken: true, tin: 0, tout: 2 }), newKey(10, 10, { mode: 'free', broken: true, tin: 0, tout: 0 })]);
    near(evalChannel(c, 0), 0);
    near(evalChannel(c, 10), 10);
    near(evalChannel(c, 4), hermite(0, 0, 2, 10, 10, 0, 4));
    const mid = evalChannel(c, 0.5);
    expect(mid).toBeGreaterThan(0.5); // starts steeper than linear (slope 2 > 1)
  });
  it('auto tangents never overshoot, smooth may; flat is flat', () => {
    const pts: [number, number][] = [[0, 0], [10, 10], [20, 10.5], [30, 0]];
    const auto = bez(...pts);
    for (let t = 0; t <= 30; t += 0.25) expect(evalChannel(auto, t)).toBeLessThanOrEqual(10.5 + 1e-6);
    const s = resolveSlopes(auto);
    expect(Math.abs(s.tout[1])).toBeLessThanOrEqual(3 * 0.05 + 1e-9); // clamped (3x the shallower secant)
    const flat = flattenKeys(auto, [0, 1, 2, 3]);
    const fs = resolveSlopes(flat);
    for (const v of fs.tout) near(v, 0);
    const smooth = channelOf(pts.map(([t, v]) => newKey(t, v, { mode: 'smooth' })));
    let over = 0;
    for (let t = 0; t <= 30; t += 0.25) over = Math.max(over, evalChannel(smooth, t));
    expect(over).toBeGreaterThan(10.5);
  });
  it('free tangents: unified mirror and broken stay independent', () => {
    let c = bez([0, 0], [10, 0], [20, 0]);
    c = setTangent(c, 1, 'out', 0.5);
    let s = resolveSlopes(c);
    near(s.tin[1], 0.5);
    near(s.tout[1], 0.5);
    c = { ...c, keys: c.keys.map((k, i) => (i === 1 ? { ...k, broken: true } : k)) };
    c = setTangent(c, 1, 'in', -0.25);
    s = resolveSlopes(c);
    near(s.tin[1], -0.25);
    near(s.tout[1], 0.5);
  });
  it('empty / single-key channels', () => {
    expect(evalChannel(channelOf([]), 3, 9)).toBe(9);
    expect(evalChannel(channelOf([newKey(5, 2)]), -100)).toBe(2);
  });
});

describe('extrapolation modes', () => {
  const base = lin([0, 0], [10, 10]);
  it('constant', () => {
    expect(evalChannel(base, -5)).toBe(0);
    expect(evalChannel(base, 99)).toBe(10);
  });
  it('linear continues the end slope', () => {
    const c = { ...base, pre: 'linear' as const, post: 'linear' as const };
    near(evalChannel(c, 15), 15);
    near(evalChannel(c, -5), -5);
  });
  it('cycle repeats, cycle_offset accumulates, pingpong mirrors', () => {
    near(evalChannel({ ...base, pre: 'cycle', post: 'cycle' }, 13), 3);
    near(evalChannel({ ...base, pre: 'cycle', post: 'cycle' }, -3), 7);
    near(evalChannel({ ...base, pre: 'cycle_offset', post: 'cycle_offset' }, 13), 13);
    near(evalChannel({ ...base, pre: 'cycle_offset', post: 'cycle_offset' }, -3), -3);
    near(evalChannel({ ...base, pre: 'pingpong', post: 'pingpong' }, 13), 7);
    near(evalChannel({ ...base, pre: 'pingpong', post: 'pingpong' }, 23), 3);
  });
  it('bezier cycle wraps neighbours so the loop has no kink', () => {
    const c = { ...bez([0, 0], [5, 5], [10, 0]), pre: 'cycle' as const, post: 'cycle' as const };
    const e = loopError(c);
    near(e.value, 0);
    near(e.slope, 0, 1e-9); // auto tangents wrapped across the seam are continuous
    near(evalChannel(c, 10 + 0.001), evalChannel(c, 0.001), 1e-2);
  });
});

describe('loop matching and editing', () => {
  it('loopMatch equalises value + slope and sets cycle', () => {
    const c0 = bez([0, 0], [8, 4], [16, 9]);
    expect(loopError(c0).value).toBeGreaterThan(1);
    const c = loopMatch(c0);
    const e = loopError(c);
    near(e.value, 0);
    near(e.slope, 0);
    expect(c.pre).toBe('cycle');
    near(evalChannel(c, 16 + 3), evalChannel(c, 3), 1e-9);
  });
  it('loopMatch with offset keeps the end value', () => {
    const c = loopMatch(lin([0, 0], [16, 1]), undefined, true);
    expect(c.post).toBe('cycle_offset');
    near(evalChannel(c, 32), 2, 1e-9);
  });
  it('move / mirror / remove / setKey', () => {
    const c = bez([0, 0], [5, 1], [10, 0]);
    const m = moveKeys(c, [1], 2, 0.5);
    near(m.channel.keys[1].t, 7);
    near(m.channel.keys[1].v, 1.5);
    const mv = mirrorKeys(c, [1], 'value', 0.5);
    near(mv.keys[1].v, 0);
    expect(removeKeys(c, [0]).keys.length).toBe(2);
    expect(setKey(c, 5, 9).keys[1].v).toBe(9);
    expect(setKey(c, 7, 2).keys.length).toBe(4);
  });
});

describe('tracks (value <-> channels, snapshots, persistence)', () => {
  const noise = reg.expanded('grayscale.noise')!;
  const def = (id: string) => noise.params.find((p) => p.id === id)!;
  it('float / int / bool / enum / vec round trips', () => {
    expect(fromChannelValues(def('invert'), toChannelValues(def('invert'), true))).toBe(true);
    expect(fromChannelValues(def('noise_type'), toChannelValues(def('noise_type'), 'simplex'))).toBe('simplex');
    expect(fromChannelValues(def('octaves'), [3.6])).toBe(4);
  });
  it('setTrackKey creates, overwrites and removes', () => {
    const d = def('evolution');
    let t = setTrackKey(undefined, d, 0, 0);
    t = setTrackKey(t, d, 10, 1);
    t = setTrackKey(t, d, 10, 2);
    expect(trackKeyFrames(t)).toEqual([0, 10]);
    near(evalTrack(t, d, 10) as number, 2);
    const t2 = removeTrackKey(t, 0)!;
    expect(trackKeyFrames(t2)).toEqual([10]);
    expect(removeTrackKey(t2, 10)).toBeUndefined();
    const moved = moveTrackKeys(t, [10], 5);
    expect(trackKeyFrames(moved)).toEqual([0, 15]);
    expect(trackKeyFrames(scaleTrackKeys(t, [0, 10], 0, 2))).toEqual([0, 20]);
  });
  it('stepped enum track holds until the next key', () => {
    const d = def('noise_type');
    let t = setTrackKey(undefined, d, 0, 'perlin');
    t = setTrackKey(t, d, 10, 'simplex');
    expect(evalTrack(t, d, 9.9)).toBe('perlin');
    expect(evalTrack(t, d, 10)).toBe('simplex');
  });
  it('gradient snapshots blend when compatible and hold otherwise', () => {
    const a = { stops: [{ pos: 0, color: [0, 0, 0, 1] as [number, number, number, number] }, { pos: 1, color: [1, 1, 1, 1] as [number, number, number, number] }] };
    const b = { stops: [{ pos: 0, color: [1, 0, 0, 1] as [number, number, number, number] }, { pos: 1, color: [1, 1, 0, 1] as [number, number, number, number] }] };
    const m = blendSnapshots(a, b, 0.5) as typeof a;
    near(m.stops[0].color[0], 0.5);
    expect(blendSnapshots(a, { stops: [a.stops[0]] }, 0.5)).toBeNull();
    const ramp = reg.expanded('color.ramp')!;
    const gd = ramp.params.find((p) => p.type === 'gradient');
    if (gd) {
      let t = setTrackKey(undefined, gd, 0, a);
      t = setTrackKey(t, gd, 10, b);
      near(((evalTrack(t, gd, 5) as typeof a).stops[0].color[0]), 0.5);
    }
  });
  it('sanitizeNodeAnim drops garbage', () => {
    const r = sanitizeNodeAnim({ evolution: { kind: 'num', ch: [{ keys: [{ t: 0, v: 1 }, { t: 'x', v: 2 }], pre: 'cycle', post: 'cycle' }] }, nope: {} }, noise.params);
    expect(Object.keys(r.anim ?? {})).toEqual(['evolution']);
    expect(r.anim!.evolution.kind === 'num' && r.anim!.evolution.ch[0].keys.length).toBe(1);
    expect(r.warnings.length).toBe(1);
  });
});

describe('graph integration: animator, hashing, undo, persistence', () => {
  function build() {
    const g = new Graph(reg, { width: 64, height: 64, fps: 30, loopLength: 30 });
    const ed = new GraphEditor(g, new CommandStack());
    const n = ed.addNode('grayscale.noise', { params: { noise_type: 'perlin' } });
    const stat = ed.addNode('grayscale.noise', { params: { seed: 5 } });
    return { g, ed, n, stat, an: new AnimationEditor(ed) };
  }
  it('animated param changes the hash over time; static nodes never do; animation is undoable', () => {
    const { g, ed, n, stat, an } = build();
    const animator = makeAnimator(reg);
    const opts = (time: number) => ({ time, scale: 1, maxDim: 4096, animator });
    an.setKey(n, 'evolution', 0, 0);
    an.setKey(n, 'evolution', 30, 1);
    const h0 = buildPlan(g, [n, stat], opts(0));
    const h1 = buildPlan(g, [n, stat], opts(0.5));
    expect(h0.nodes.get(n)!.hash).not.toBe(h1.nodes.get(n)!.hash);
    expect(h0.nodes.get(stat)!.hash).toBe(h1.nodes.get(stat)!.hash);
    near(buildPlan(g, [n], opts(0.5)).nodes.get(n)!.params.evolution as number, 0.5, 1e-9);
    ed.stack.undo();
    ed.stack.undo();
    expect(g.nodes.get(n)!.anim).toBeUndefined();
    ed.stack.redo();
    expect(g.nodes.get(n)!.anim?.evolution).toBeTruthy();
  });
  it('editValue keys animated params and writes static values otherwise; resetAnimation keeps the value', () => {
    const { g, n, an } = build();
    expect(an.editValue(n, 'contrast', 5, 2, false)).toBe(false);
    expect(g.nodes.get(n)!.params.contrast).toBe(2);
    expect(an.editValue(n, 'contrast', 5, 3, true)).toBe(true);
    expect(an.editValue(n, 'contrast', 8, 4, false)).toBe(true); // animated => always keys
    an.resetAnimation(n, 'contrast', 8);
    expect(g.nodes.get(n)!.anim).toBeUndefined();
    expect(g.nodes.get(n)!.params.contrast).toBe(4);
  });
  it('gesture preview + single commit', () => {
    const { g, ed, n, an } = build();
    an.setKey(n, 'evolution', 0, 0);
    an.setKey(n, 'evolution', 10, 1);
    const before = g.nodes.get(n)!.anim!.evolution;
    const depth = () => (ed.stack.canUndo ? ed.stack.undoLabel : '');
    const moved = moveTrackKeys(before, [10], 5);
    an.preview(n, 'evolution', moved);
    an.commitGesture(n, 'evolution', before, moved, 'Move keys');
    expect(depth()).toBe('Move keys');
    ed.stack.undo();
    expect(trackKeyFrames(g.nodes.get(n)!.anim!.evolution)).toEqual([0, 10]);
  });
  it('timeline + animation survive toData / fromData', () => {
    const { g, n, an } = build();
    an.setKey(n, 'evolution', 0, 0);
    an.setKey(n, 'evolution', 30, 1);
    an.setTimeline({ startFrame: 4, markers: [{ frame: 9, name: 'hit' }], loop: 'pingpong' });
    const back = Graph.fromData(reg, JSON.parse(JSON.stringify(g.toData()))).graph;
    expect(back.timeline.startFrame).toBe(4);
    expect(back.timeline.loop).toBe('pingpong');
    expect(back.timeline.markers[0].name).toBe('hit');
    expect(trackKeyFrames(back.nodes.get(n)!.anim!.evolution)).toEqual([0, 30]);
  });
  it('LAZY pins: Sheet Encode hash ignores time but follows real edits upstream', () => {
    const { g, ed, n, an } = build();
    const sheet = ed.addNode('utils.sheet_encode', {});
    ed.connect({ node: n, pin: 'output' }, { node: sheet, pin: 'input' });
    an.setKey(n, 'evolution', 0, 0);
    an.setKey(n, 'evolution', 30, 1);
    const animator = makeAnimator(reg);
    const h = (t: number) => buildPlan(g, [sheet], { time: t, scale: 1, maxDim: 4096, animator }).nodes.get(sheet)!;
    expect(h(0).hash).toBe(h(0.7).hash);
    expect(h(0).lazy!.input.nodeId).toBe(n);
    const sig = lazySignature(g, n);
    ed.setParam(n, 'seed', 77);
    expect(lazySignature(g, n)).not.toBe(sig);
    expect(h(0).timeDep).toBe(false);
  });
});

describe('timeline settings and formatting', () => {
  it('range / work area / sanitize', () => {
    const tl = { ...defaultTimeline(), startFrame: 10 };
    expect(animRange(tl, 64)).toEqual({ start: 10, end: 74 });
    expect(workRange({ ...tl, workStart: 20, workEnd: 30 }, 64)).toEqual({ start: 20, end: 30 });
    expect(workRange({ ...tl, workStart: 500 }, 64).start).toBe(73);
    expect(sanitizeTimeline({ speed: 'x', loop: 'bogus', markers: [{ frame: 'a' }, { frame: 2.4, name: 'm' }] })).toMatchObject({ speed: 1, loop: 'loop', markers: [{ frame: 2, name: 'm' }] });
  });
  it('format / parse', () => {
    expect(formatFrame(45, 30, 'seconds')).toBe('1.500 s');
    expect(formatFrame(75, 30, 'timecode')).toBe('00:02:15');
    expect(parseFrame('12', 30)).toBe(12);
    expect(parseFrame('0.5s', 30)).toBe(15);
    expect(parseFrame('00:01:05', 30)).toBe(35);
    expect(parseFrame('bogus', 30)).toBeNull();
  });
  it('dopesheet helpers', () => {
    const d = reg.expanded('grayscale.noise')!.params.find((p) => p.id === 'evolution')!;
    let t = setTrackKey(undefined, d, 2, 1);
    t = setTrackKey(t, d, 6, 2);
    expect(hasKey(t, 6)).toBe(true);
    expect(selKey('a', 'b', 2.5)).toContain('2500');
    expect(trackKeyFrames(mapTrackKeys(t, [2], 'delete')!)).toEqual([6]);
    const stepped = mapTrackKeys(t, [2], 'constant')!;
    expect(stepped.kind === 'num' && stepped.ch[0].keys[0].interp).toBe('constant');
    expect(shortValue(0.5)).toBe('0.500');
    expect(shortValue([1, 0.25])).toBe('1, 0.25');
  });
});

describe('playback pacing', () => {
  const range = { start: 0, end: 10 };
  it('loop / once / ping-pong from wall time', () => {
    const o = { frame0: 0, fps: 10, speed: 1, range };
    near(advanceFrame({ ...o, elapsedMs: 500, mode: 'loop' }).frame, 5);
    near(advanceFrame({ ...o, elapsedMs: 1300, mode: 'loop' }).frame, 3);
    const once = advanceFrame({ ...o, elapsedMs: 5000, mode: 'once' });
    expect(once.ended).toBe(true);
    expect(once.frame).toBe(9);
    near(advanceFrame({ ...o, elapsedMs: 1200, mode: 'pingpong' }).frame, 6, 1e-9); // 12 frames: 9 up, 3 down -> 6
    near(advanceFrame({ ...o, speed: -1, elapsedMs: 300, mode: 'loop' }).frame, 7);
    expect(displayFrame(4.9999999)).toBe(5);
  });
  it('slow evaluation drops frames and is reported', () => {
    const m = new PacingMonitor(2000, 0.1);
    let t = 0;
    for (const f of [0, 1, 2, 3]) m.onDelivered(f, (t += 33), 10);
    expect(m.dropped).toBe(0);
    expect(m.stats(t).behind).toBe(false);
    m.onDelivered(7, (t += 33), 10); // skipped 4..6
    expect(m.dropped).toBe(3);
    m.onDelivered(0, (t += 33), 10); // wrapped 7 -> 0 over 10 frames: 7->8,9,0 => 2 dropped
    expect(m.dropped).toBe(5);
    expect(m.stats(t).behind).toBe(true);
  });
});

describe('frame cache budget behaviour', () => {
  it('never exceeds bytes / entries, keeps the loop prefix, evicts furthest first, signature clears', () => {
    const freed: string[] = [];
    const c = new FrameCache<string>(() => 100, 5, (v) => freed.push(v));
    expect(c.put('a', 0, 'a', 40)).toBe(true);
    expect(c.put('b', 1, 'b', 40)).toBe(true);
    expect(c.put('c', 2, 'c', 40)).toBe(false); // would exceed 100 bytes: rejected, caller keeps ownership
    expect(c.bytes).toBe(80);
    c.maxBytesFn = () => 50; // budget shrinks
    c.enforce(0);
    expect(c.bytes).toBe(40);
    expect(freed).toEqual(['b']); // furthest from the playhead (frame 0) goes first
    c.setSignature('x');
    expect(c.size).toBe(0);
    expect(freed.length).toBe(2);
    c.maxBytesFn = () => 1e9;
    for (let i = 0; i < 9; i++) c.put(`k${i}`, i, `k${i}`, 1);
    expect(c.size).toBe(5);
  });
  it('auto sizing is bounded by fraction of the budget and half of the free memory', () => {
    expect(autoCacheBytes(1000, 0, 0.25)).toBe(250);
    expect(autoCacheBytes(1000, 900, 0.25)).toBe(50);
    expect(autoCacheBytes(1000, 2000, 0.25)).toBe(0);
    expect(cacheCapacityFrames(250, 100, 64)).toBe(2);
    expect(cacheCapacityFrames(1e9, 100, 64)).toBe(64);
  });
});

describe('flipbook sheet layout', () => {
  const spec: SheetSpec = { sheetW: 1000, sheetH: 500, cols: 4, rows: 2, count: 7, padding: 2, rowOrder: 'top_down' };
  it('non-square, non-POT cells', () => {
    expect(cellSize(spec)).toEqual({ w: 250, h: 250 });
    const c = cellRect(spec, 5);
    expect([c.col, c.row, c.x, c.y]).toEqual([1, 1, 250, 250]);
    expect([c.ix, c.iy, c.iw, c.ih]).toEqual([252, 252, 246, 246]);
    expect(cellRect({ ...spec, rowOrder: 'bottom_up' }, 0).row).toBe(1);
    expect(cellSize({ sheetW: 1001, sheetH: 333, cols: 3, rows: 3 })).toEqual({ w: 333, h: 111 });
    const uv = frameUvRect(spec, 1);
    near(uv[0], 252 / 1000);
  });
  it('validation, auto grid, sample times, crossfade, decode', () => {
    expect(validateSheet(spec, 4096)).toBeNull();
    expect(validateSheet({ ...spec, count: 9 }, 4096)).toMatch(/do not fit/);
    expect(validateSheet({ ...spec, sheetW: 9000 }, 4096)).toMatch(/exceeds/);
    expect(autoGrid(16)).toEqual({ cols: 4, rows: 4 });
    const g = autoGrid(12, 1);
    expect(g.cols * g.rows).toBeGreaterThanOrEqual(12);
    expect(sampleFrame(0, 16, 0, 64)).toBe(0);
    expect(sampleFrame(15, 16, 0, 64)).toBe(60);
    expect(sampleFrame(0, 16, 0, 64, 2, true)).toBe(62);
    const w = crossfadeWeights(8, 3);
    expect(w.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(w[7]).toBeGreaterThan(w[5]);
    expect(decodeFrame(3.5, 8, 'loop', true)).toEqual({ a: 3, b: 4, mix: 0.5 });
    expect(decodeFrame(7.5, 8, 'loop', true).b).toBe(0);
    expect(decodeFrame(7.5, 8, 'once', true).a).toBe(7);
    expect(decodeFrame(9, 8, 'pingpong', false).a).toBe(5);
    expect(decodePlan({ time: 1, mode: 'time', manual: 0, rate: 8, offset: 0, loop: 'loop', blend: false, count: 16 }).a).toBe(8);
    const r = resolveSheet({ sheetW: 1024, sheetH: 512, frames: 16, autoGridOn: true, cols: 1, rows: 1, padding: 0, rowOrder: 'top_down' });
    expect(r.cols * r.rows).toBeGreaterThanOrEqual(16);
  });
});

describe('loop seam analysis', () => {
  const sine = (n: number, periodic: boolean): Float32Array[] =>
    Array.from({ length: n }, (_, i) => {
      const t = i / (periodic ? n : n - 1);
      return new Float32Array([Math.sin(t * Math.PI * 2) * 0.5 + 0.5, Math.cos(t * Math.PI * 2) * 0.5 + 0.5]);
    });
  it('a periodic loop is clean (incl. wrap frame), a ramp has a visible seam', () => {
    const n = 32;
    const f = sine(n, true);
    const wrap = new Float32Array([Math.sin(2 * Math.PI) * 0.5 + 0.5, 1]);
    const r = analyzeSeam(f, wrap);
    expect(r.verdict).toBe('clean');
    expect(r.ratio).toBeLessThan(1.5);
    const ramp = Array.from({ length: n }, (_, i) => new Float32Array([i / n]));
    const bad = analyzeSeam(ramp, new Float32Array([1]));
    expect(bad.verdict).toBe('visible');
    expect(analyzeSeam(Array.from({ length: 4 }, () => new Float32Array([0.3]))).verdict).toBe('static');
    expect(analyzeSeam(sine(n, false)).verdict).toBe('minor'); // last frame duplicates the first (held frame)
  });
});

describe('particles', () => {
  it('wrap / snap helpers', () => {
    near(wrapAxis(0.6, 0, 1), -0.4);
    near(wrapAxis(-0.6, 0, 1), 0.4);
    expect(snapTravelAxis(0.4, 1)).toBe(1);
    expect(snapTravelAxis(-1.7, 1)).toBe(-2);
    expect(snapTravelAxis(0.3, 0)).toBe(0.3);
  });
  it('Point Attributes loops exactly (phase 0 == phase 1) and is deterministic', () => {
    const p = { ...defaultPointAttrParams(), count: 50, travel: [0.3, 0.7, 0] as [number, number, number], lifeCycles: 2, spinTurns: 1, driftAmount: 0.1, driftCycles: 2 };
    const a = pointAttributes(null, { ...p, phase: 0 });
    const b = pointAttributes(null, { ...p, phase: 1 });
    const c = pointAttributes(null, { ...p, phase: 0.5 });
    const pa = a.positions;
    const pb = b.positions;
    let d = 0;
    for (let i = 0; i < pa.length; i++) d = Math.max(d, Math.abs(pa[i] - pb[i]));
    expect(d).toBeLessThan(1e-4);
    expect(c.positions).not.toEqual(pa);
    const ageA = a.attr('point', 'age')!.data;
    const ageB = b.attr('point', 'age')!.data;
    for (let i = 0; i < ageA.length; i++) expect(Math.abs(ageA[i] - ageB[i]) < 1e-5 || Math.abs(Math.abs(ageA[i] - ageB[i]) - 1) < 1e-5).toBe(true);
    expect(a.pointCount).toBe(50);
    expect(Math.max(...Array.from(pa))).toBeLessThanOrEqual(0.5 + 1e-6); // wrapped inside the box
  });
  it('modifies incoming points and packs GPU records', () => {
    const src = new MeshData(3);
    src.setAttr({ name: 'P', element: 'point', size: 3, kind: 'f32', data: new Float32Array([0, 0, 0, 0.25, 0.25, 0, -0.5, 0.5, 0]) });
    const out = pointAttributes(src, { ...defaultPointAttrParams(), phase: 0.25, wrap: false, travel: [0, 1, 0], driftAmount: 0 });
    near(out.positions[1], 0.25);
    expect(out.attr('point', 'v')!.data[1]).toBeCloseTo(1, 2);
    const packed = packParticles(out, { plane: 'xy', center: [0, 0], extent: 1, aspect: 1, sizeScale: 1, maxCount: 2 });
    expect(packed.count).toBe(2);
    expect(packed.truncated).toBe(true);
    expect(packed.data.length).toBe(2 * PARTICLE_STRIDE);
    near(packed.data[0], 0.5);
    near(packed.data[1], 0.5 - 0.25); // y up -> v down
  });
});

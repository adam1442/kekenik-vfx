import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, SCALE_STEPS } from '../src/engine/perf/adaptive';
import { MemoryGuard } from '../src/engine/perf/guard';
import { PerfStats, Ring, rate } from '../src/engine/perf/stats';
import { Emitter } from '../src/shared/emitter';
import { EN, registerLocale, setLocale, t } from '../src/shared/i18n';
import { isPanelBlocked, isSafeMode, allowPanel } from '../src/app/safe-mode';
import { PanelErrorTracker } from '../src/ui/dock/panel-guard';
import { contrastRatio, deriveAccent, parseHex } from '../src/ui/theme/accent';
import { jsonParseTask, parseJsonOffThread, TaskWorker } from '../src/shared/worker-pool';
import { ModelError, OBJ_WORKER_THRESHOLD_CHARS, objParseCore, parseModelAsync, parseObj, parseObjOffThread } from '../src/engine/io/model';

describe('Ring buffer', () => {
  it('keeps the newest N samples in order', () => {
    const r = new Ring<number>(3);
    [1, 2, 3, 4, 5].forEach((v) => r.push(v));
    expect(r.toArray()).toEqual([3, 4, 5]);
    expect(r.last()).toBe(5);
    r.clear();
    expect(r.length).toBe(0);
    expect(r.last()).toBeUndefined();
  });
  it('rate() handles empty windows', () => {
    expect(rate(0, 0)).toBeNull();
    expect(rate(3, 1)).toBe(0.75);
  });
});

describe('AdaptiveResolution', () => {
  it('drops the scale immediately when the budget is exceeded and respects the minimum', () => {
    const a = new AdaptiveResolution({ budgetMs: 8 });
    expect(a.scale).toBe(1);
    a.observe(40, 1, 'gpu'); // 40 ms @100% -> needs (8*0.85/40)^0.5 ~ 0.41 -> step 0.375
    expect(a.scale).toBe(0.375);
    for (let i = 0; i < 20; i++) a.observe(400, a.scale, 'gpu');
    expect(a.scale).toBe(0.125);
  });
  it('model is area based: cost scales with scale^2', () => {
    const a = new AdaptiveResolution({ budgetMs: 8 });
    expect(a.pick(8)).toBe(0.75); // 8*0.5625 = 4.5 <= 6.8, 1.0 would be 8 > 6.8
    expect(a.pick(1)).toBe(1);
    expect(a.pick(100)).toBe(0.25); // 100*0.0625 = 6.25 <= 6.8
  });
  it('climbs back only after enough cheap samples (hysteresis), one step at a time', () => {
    const a = new AdaptiveResolution({ budgetMs: 8, upConfirm: 3 });
    a.observe(40, 1, 'gpu');
    const low = a.scale;
    for (let i = 0; i < 2; i++) a.observe(0.5 * low * low, low, 'gpu');
    expect(a.scale).toBe(low);
    for (let i = 0; i < 40; i++) a.observe(0.5 * a.scale * a.scale, a.scale, 'gpu');
    expect(a.scale).toBe(1);
    expect(SCALE_STEPS).toContain(a.scale);
  });
  it('prefers GPU samples once seen and can be disabled', () => {
    const a = new AdaptiveResolution({ budgetMs: 8 });
    a.observe(1, 1, 'gpu');
    a.observe(500, 1, 'cpu'); // ignored
    expect(a.scale).toBe(1);
    a.enabled = false;
    a.observe(500, 1, 'gpu');
    expect(a.scale).toBe(1);
  });
});

describe('MemoryGuard', () => {
  function fake() {
    const calls: string[] = [];
    const engine = {
      mm: { onPressure: new Emitter<{ kind: 'budget' | 'device-oom'; bytes: number }>(), usedBytes: 500e6, reclaim: () => calls.push('reclaim') },
      scheduler: { dropFrameCache: () => calls.push('frames'), invalidate: () => calls.push('invalidate'), interactionScale: 0.5 },
      evaluator: { cache: { clear: () => calls.push('cache') } },
    };
    return { engine, calls };
  }
  it('escalates: first drop caches, then reduce the preview resolution, rate limited', () => {
    const { engine, calls } = fake();
    let preview = 0.5;
    const notes: string[] = [];
    let now = 0;
    const g = new MemoryGuard(engine as never, { getPreview: () => preview, setPreview: (v) => (preview = v), notify: (m) => notes.push(m) }, () => now);
    expect(g.handle('budget')).toBe('drop-caches');
    expect(calls).toContain('cache');
    expect(preview).toBe(0.5);
    now = 100;
    expect(g.handle('budget')).toBe('none'); // cooling down
    now = 5000;
    expect(g.handle('budget')).toBe('reduce-preview');
    expect(preview).toBe(0.25);
    expect(engine.scheduler.interactionScale).toBe(0.25);
    expect(notes.length).toBe(2);
  });
  it('a device OOM reduces the preview immediately, never below 12.5%', () => {
    const { engine } = fake();
    let preview = 0.125;
    const g = new MemoryGuard(engine as never, { getPreview: () => preview, setPreview: (v) => (preview = v), notify: () => undefined }, () => 1e9);
    expect(g.handle('device-oom')).toBe('reduce-preview');
    expect(preview).toBe(0.125);
  });
  it('reacts to MemoryManager.onPressure', () => {
    const { engine } = fake();
    const g = new MemoryGuard(engine as never, { getPreview: () => 1, setPreview: () => undefined, notify: () => undefined }, () => 1e9);
    g.attach();
    engine.mm.onPressure.emit({ kind: 'budget', bytes: 1 });
    expect(g.actions).toBe(1);
    g.detach();
  });
});

describe('PerfStats', () => {
  it('rejects nothing and counts references (acquire/release)', () => {
    const noop = new Emitter<never>();
    const engine = { mm: { stats: () => ({ usedBytes: 1, textureLiveBytes: 1, bufferLiveBytes: 0, textureIdleBytes: 0, bufferIdleBytes: 0, budgetBytes: 10, externalBytes: 0, textureHits: 3, textureMisses: 1 }) }, evaluator: { cache: { hits: 1, misses: 1 }, onTiming: noop }, scheduler: { onResult: noop }, pipelines: { onCompiled: noop }, runner: {} };
    const p = new PerfStats(engine as never);
    const a = p.acquire();
    const b = p.acquire();
    expect(p.enabled).toBe(true);
    a();
    a(); // idempotent
    expect(p.enabled).toBe(true);
    b();
    expect(p.enabled).toBe(false);
    expect(p.lifetimeRates().pool).toBe(0.75);
  });
});

describe('i18n', () => {
  it('interpolates, falls back to English and returns unknown keys verbatim', () => {
    expect(t('perf.fps', { n: 60 } as never)).toBe(EN['perf.fps'].replace('{n}', '60'));
    registerLocale('xx', { 'settings.title': 'XX' });
    expect(setLocale('xx')).toBe(true);
    expect(t('settings.title')).toBe('XX');
    expect(t('common.close')).toBe('Close'); // fallback
    expect(t('nope.key' as never)).toBe('nope.key');
    setLocale('en');
    expect(setLocale('zz')).toBe(false);
  });
});

describe('safe mode', () => {
  it('parses the flag and blocks only heavy panels until allowed', () => {
    expect(isSafeMode('?safe')).toBe(true);
    expect(isSafeMode('?a=1&safe')).toBe(true);
    expect(isSafeMode('?safely')).toBe(false);
    expect(isSafeMode('')).toBe(false);
    expect(isPanelBlocked('viewport-3d', true)).toBe(true);
    expect(isPanelBlocked('console', true)).toBe(false);
    expect(isPanelBlocked('viewport-3d', false)).toBe(false);
    allowPanel('node-gallery');
    expect(isPanelBlocked('node-gallery', true)).toBe(false);
  });
});

describe('PanelErrorTracker (error boundary)', () => {
  it('trips after N errors inside the window, per panel', () => {
    let now = 0;
    const tripped: string[] = [];
    const tr = new PanelErrorTracker((id) => tripped.push(id), 3, 1000, () => now);
    expect(tr.report(new Error('a'), 'p1')).toBe(false);
    now = 100;
    expect(tr.report(new Error('b'), 'p1')).toBe(false);
    expect(tr.report(new Error('x'), 'p2')).toBe(false);
    now = 200;
    expect(tr.report(new Error('c'), 'p1')).toBe(true);
    expect(tripped).toEqual(['p1']);
    now = 5000; // old hits expire
    expect(tr.report(new Error('d'), 'p2')).toBe(false);
  });
});

describe('accent colours', () => {
  it('derives the four variables and keeps contrast', () => {
    expect(parseHex('#7c6cf0')).toEqual([124, 108, 240]);
    expect(parseHex('nope')).toBeNull();
    expect(deriveAccent('zzz')).toBeNull();
    const v = deriveAccent('#202020')!; // far too dark: must be lightened
    const c = parseHex(v['--accent'])!;
    expect(contrastRatio(c, [0x17, 0x19, 0x1d])).toBeGreaterThanOrEqual(3);
    expect(Object.keys(v)).toHaveLength(4);
  });
  it('default accent has accessible contrast on the panel background', () => {
    expect(contrastRatio(parseHex('#7c6cf0')!, [0x17, 0x19, 0x1d])).toBeGreaterThan(3);
    // body text vs panel background (WCAG AA 4.5:1) and dim text (>= 3:1 for secondary UI text)
    expect(contrastRatio(parseHex('#d8dbe0')!, [0x17, 0x19, 0x1d])).toBeGreaterThan(7);
    expect(contrastRatio(parseHex('#7b828d')!, [0x17, 0x19, 0x1d])).toBeGreaterThan(3.9);
  });
});

describe('worker pool fallback', () => {
  it('parses JSON on the calling thread when Worker is missing', async () => {
    expect(await parseJsonOffThread('{"a":[1,2]}')).toEqual({ a: [1, 2] });
    expect(await parseJsonOffThread('{"a":[1,2]}', 1)).toEqual({ a: [1, 2] }); // forced through TaskWorker -> fallback
    await expect(parseJsonOffThread('{oops')).rejects.toThrow();
    expect(jsonParseTask('1')).toEqual({ ok: true, value: 1 });
    expect(await new TaskWorker((x: number) => x * 2).run(21)).toBe(42);
  });
});

describe('OBJ import off the main thread', () => {
  const quad = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  it('objParseCore is self-contained (serialisable) and parseObj wraps the very same code', () => {
    const src = objParseCore.toString();
    // a worker only sees the function text: it must not reference module-level helpers
    expect(src).not.toMatch(/\b(ModelError|MODEL_LIMITS|finish)\b/);
    const m = parseObj(quad);
    expect(m.triangleCount).toBe(2);
    expect(m.vertexCount).toBe(4);
    const direct = objParseCore({ text: quad, maxTriangles: 10 });
    expect(direct.ok).toBe(true);
  });
  it('errors travel as data and become ModelError', () => {
    expect(objParseCore({ text: 'v 0 0 0\nf 1 2 3\n', maxTriangles: 10 })).toEqual({ ok: false, error: 'OBJ: face references vertex 2 which does not exist.' });
    expect(() => parseObj('v 0 0 0\n')).toThrow(ModelError);
  });
  it('big files go through the worker path (falls back to the main thread without Worker) with identical output', async () => {
    const padding = `# ${'x'.repeat(OBJ_WORKER_THRESHOLD_CHARS)}\n`;
    const text = padding + quad;
    const viaPool = await parseObjOffThread(text);
    const sync = parseObj(text);
    expect(Array.from(viaPool.prims[0].positions)).toEqual(Array.from(sync.prims[0].positions));
    expect(Array.from(viaPool.prims[0].indices)).toEqual(Array.from(sync.prims[0].indices));
    const bytes = new TextEncoder().encode(text);
    expect((await parseModelAsync(bytes, 'big.obj')).triangleCount).toBe(2);
    await expect(parseModelAsync(new TextEncoder().encode('v 0 0 0\n'.repeat(3) + padding), 'bad.obj')).rejects.toThrow(/no faces/);
  });
});

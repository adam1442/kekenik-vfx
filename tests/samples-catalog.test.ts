import { describe, expect, it } from 'vitest';
import { SAMPLE_INDEX, indexEntry, loadMeta, prepareSample } from '../src/samples/catalog';
import { loadProjectRobust } from '../src/engine/io/robust-load';
import { makeRegistry } from './helpers';

describe('sample catalog (runtime loader)', () => {
  it('lists all samples and lazily loads metadata + graph', async () => {
    expect(SAMPLE_INDEX.samples.length).toBe(22);
    for (const e of SAMPLE_INDEX.samples) expect((await loadMeta(e.id)).id).toBe(e.id);
    expect(indexEntry('hello_nodes')?.features.exportReady).toBe(true);
  });
  it('prepareSample localizes frames, optionally adds numbered tour frames, and the result loads', async () => {
    const reg = makeRegistry();
    const fa = await prepareSample('campfire_loop', { lang: 'fa', name: 'x', tour: true, digits: String, tourColor: '#fff' });
    const proj = JSON.parse(fa.text) as { name: string; graph: { annotations: { frames: { id: string; title: string }[] } } };
    expect(proj.name).toBe('x');
    const titles = proj.graph.annotations.frames.map((f) => f.title);
    expect(titles.some((x) => /[\u0600-\u06FF]/.test(x))).toBe(true);
    expect(proj.graph.annotations.frames.filter((f) => f.id.startsWith('tour_')).length).toBe(3);
    expect(loadProjectRobust(reg, fa.text).warnings).toEqual([]);
    const en = await prepareSample('campfire_loop', { lang: 'en', name: 'y', tour: false, digits: String, tourColor: '#fff' });
    expect((JSON.parse(en.text) as typeof proj).graph.annotations.frames.some((f) => f.id.startsWith('tour_'))).toBe(false);
  });
});

import { loopMatch } from '../engine/anim/keyframes';
import { setTrackExtrapolation, setTrackKey } from '../engine/anim/tracks';
import { verifyLoopSeam } from '../engine/anim/seam-gpu';
import type { Engine } from '../engine/engine';
import type { Graph } from '../engine/graph/graph';
import type { Helpers } from './generators';
import type { TestDef } from './tests';

/**
 * GPU tests for animation, flipbooks and particles. Names start with `6A ·`.
 *   - animated Noise evolution loops (frame N == frame 0, mid-loop differs),
 *   - Sheet Encode bakes N distinct frames through the baker; cell 0 equals a direct evaluation,
 *   - Sheet Decode picks different frames, finite output,
 *   - the loop-seam verifier reports a clean loop for the acceptance recipe and a visible seam for a broken one,
 *   - Point Attributes -> 2D Render draws something and loops exactly (phase 0 == phase 1).
 */
const L = 8;
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  let m = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
};

export function animTests(h: Helpers): TestDef[] {
  const { engineOf, dispose, mk, add, link, read } = h;

  /** Noise with Evolution keyed 0 -> `end` over the loop (linear, cycle with offset). */
  function animatedNoise(e: Engine, g: Graph, end = 1): string {
    const id = add(g, 'grayscale.noise', { noise_type: 'perlin', scale: [4, 4], octaves: 2, z_cells: 2, seed: 3 });
    const def = e.registry.expanded('grayscale.noise')!.params.find((p) => p.id === 'evolution')!;
    let tr = setTrackKey(undefined, def, 0, 0);
    tr = setTrackKey(tr, def, L, end);
    if (tr.kind === 'num') {
      const ch = tr.ch.map((c) => loopMatch({ ...c, keys: c.keys.map((k) => ({ ...k, interp: 'linear' as const })) }, undefined, true));
      tr = setTrackExtrapolation({ kind: 'num', ch }, 'cycle_offset');
    }
    g.setNodeTrack(id, 'evolution', tr);
    return id;
  }
  const settings = { tiling: 'both' as const, fps: 30, loopLength: L };
  const waitBaker = async (e: Engine): Promise<void> => {
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 30));
    while (e.flipbooks.isBusy() && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 50));
  };

  return [
    {
      name: '6A · animated Noise Evolution loops: frame N == frame 0, mid-loop differs',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 64, settings);
          const n = animatedNoise(e, g);
          const f = async (frame: number): Promise<Float32Array> => (await read(e, g, n, { time: frame / 30, useCache: false })).data;
          const a = await f(0);
          const mid = await f(L / 2);
          const wrap = await f(L);
          const dWrap = maxDiff(a, wrap);
          const dMid = maxDiff(a, mid);
          if (dWrap > 3e-3) throw new Error(`frame N differs from frame 0 by ${dWrap}`);
          if (dMid < 0.02) throw new Error(`mid-loop frame hardly differs (${dMid})`);
          return `wrap diff ${dWrap.toExponential(2)}, mid diff ${dMid.toFixed(3)}`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6A · Sheet Encode bakes distinct frames (lazy input + baker) and cell 0 matches a direct render',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 64, settings);
          const n = animatedNoise(e, g);
          const s = add(g, 'utils.sheet_encode', { frames: 4, auto_grid: false, cols: 2, rows: 2 });
          link(g, n, s, 'input', 'output');
          await read(e, g, s, { useCache: false, outPin: 'sheet' } as never).catch(() => undefined); // first pass requests the bake
          await waitBaker(e);
          const sheet = await read(e, g, s, { useCache: false, outPin: 'sheet' } as never);
          if (sheet.w !== 64) throw new Error(`sheet is ${sheet.w}×${sheet.h}`);
          const cell = (i: number): Float32Array => {
            const c = new Float32Array(32 * 32);
            const ox = (i % 2) * 32;
            const oy = Math.floor(i / 2) * 32;
            for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) c[y * 32 + x] = sheet.data[((oy + y) * 64 + ox + x) * sheet.ch];
            return c;
          };
          const direct = (await read(e, g, n, { time: 0, scale: 0.5, useCache: false })).data;
          const d0 = maxDiff(cell(0), direct);
          if (d0 > 4e-3) throw new Error(`cell 0 differs from a direct render by ${d0}`);
          for (let i = 1; i < 4; i++) if (maxDiff(cell(0), cell(i)) < 0.02) throw new Error(`cell ${i} equals cell 0 (baker did not sample over time)`);
          return `cell0 vs direct ${d0.toExponential(2)}; all 4 cells distinct`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6A · Sheet Decode shows different frames over time, finite',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 64, settings);
          const n = animatedNoise(e, g);
          const s = add(g, 'utils.sheet_encode', { frames: 4, auto_grid: false, cols: 2, rows: 2 });
          link(g, n, s, 'input', 'output');
          const d = add(g, 'utils.sheet_decode', { mode: 'manual', frame: 0, blend: false, cols: 2, rows: 2, frames: 4 });
          link(g, s, d, 'sheet', 'sheet');
          await read(e, g, d, { useCache: false }).catch(() => undefined);
          await waitBaker(e);
          const f0 = await read(e, g, d, { useCache: false });
          g.setParam(d, 'frame', 2);
          const f2 = await read(e, g, d, { useCache: false });
          if (!f0.data.every(Number.isFinite)) throw new Error('non finite output');
          const dd = maxDiff(f0.data, f2.data);
          if (dd < 0.02) throw new Error(`frames 0 and 2 look identical (${dd})`);
          return `frame 0 vs 2 differ by ${dd.toFixed(3)}`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6A · loop-seam verifier: clean for the acceptance recipe, visible for a half cycle',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 64, settings);
          const good = animatedNoise(e, g, 1);
          const bad = animatedNoise(e, g, 0.5);
          const rg = await verifyLoopSeam(e, g, { nodeId: good, pinId: 'output' });
          if (rg.verdict !== 'clean') throw new Error(`expected clean, got ${rg.verdict}: ${rg.message}`);
          const rb = await verifyLoopSeam(e, g, { nodeId: bad, pinId: 'output' });
          if (rb.verdict === 'clean') throw new Error(`a half-cycle loop must not be clean: ${rb.message}`);
          return `good: ${rg.message} | bad: ${rb.verdict} (ratio ${rb.ratio.toFixed(1)})`;
        } finally {
          dispose(e);
        }
      },
    },
    {
      name: '6A · Point Attributes -> 2D Render: draws, finite, loops (time 0 == time N)',
      async run(env) {
        const e = engineOf(env);
        try {
          const g = mk(e, 64, settings);
          const pa = add(g, 'particle.point_attributes', { count: 40, seed: 5, life_cycles: 1, travel: [0, 0.5, 0], drift_amount: 0.03 });
          const r = add(g, 'particle.render_2d', { size_scale: 2, intensity: 2 });
          link(g, pa, r, 'points', 'points');
          const a = await read(e, g, r, { time: 0, useCache: false });
          const b = await read(e, g, r, { time: L / 30, useCache: false });
          const c = await read(e, g, r, { time: (L / 2) / 30, useCache: false });
          let sum = 0;
          for (const v of a.data) {
            if (!Number.isFinite(v)) throw new Error('non finite pixel');
            sum += v;
          }
          if (sum < 1) throw new Error('nothing was drawn');
          const dl = maxDiff(a.data, b.data);
          const dm = maxDiff(a.data, c.data);
          if (dl > 8e-3) throw new Error(`loop mismatch ${dl}`);
          if (dm < 0.02) throw new Error('particles do not move');
          return `sum ${sum.toFixed(1)}, loop diff ${dl.toExponential(2)}, mid diff ${dm.toFixed(3)}`;
        } finally {
          dispose(e);
        }
      },
    },
  ];
}

import type { GpuContext } from '../gpu/device';
import { bytesPerPixel, channelCount, formatForPin } from '../resources/format';
import type { MemoryManager } from '../resources/memory';
import { decodeTexels, readTextureStrips } from '../resources/readback';
import { pickTileSize, planTiles, type Tile } from '../resources/tiles';
import type { CancelToken, EvalTarget, Evaluator } from './evaluator';
import type { Graph } from './graph';

export interface TiledRenderOptions {
  tileSize?: number;
  /** Halo in pixels around every tile (use the max `cost.halo` of the nodes involved). */
  halo?: number;
  time?: number;
  token?: CancelToken;
  /** Called per tile with the CORE region as Float32 (interleaved channels). Tiles arrive in row-major order. */
  onTile: (tile: Tile, data: Float32Array, channels: number) => void | Promise<void>;
}

/**
 * TILED rendering + TILED readback for very large resolutions (8K+). The graph is evaluated once per tile with
 * tile-sized intermediates (so peak GPU memory is independent of the final resolution) and only the tile core is
 * read back, strip by strip. Requires nodes with cost.tiling 'pixel' (or 'halo' with enough halo) and graph-sized
 * nodes; otherwise the evaluator reports a per-node error explaining why.
 */
export async function renderTiled(
  gpu: GpuContext,
  mm: MemoryManager,
  evaluator: Evaluator,
  graph: Graph,
  target: EvalTarget,
  opts: TiledRenderOptions,
): Promise<{ tiles: number; tileSize: number }> {
  const { width, height } = graph.settings;
  const halo = opts.halo ?? 0;
  const maxDim = gpu.caps.limits.maxTextureDimension2D ?? 8192;
  const tileSize = opts.tileSize ?? pickTileSize(width, height, mm.budgetBytes * 0.4, bytesPerPixel(formatForPin('color', graph.settings.bitDepth === 32)), 6, maxDim, halo);
  const tiles = planTiles(width, height, tileSize, halo);
  for (const tile of tiles) {
    if (opts.token?.cancelled) break;
    const res = await evaluator.evaluate(graph, [target], {
      time: opts.time,
      region: { px: tile.px, py: tile.py, pw: tile.pw, ph: tile.ph },
      token: opts.token,
    });
    try {
      const err = [...res.errors.values()][0];
      if (err) throw new Error(`Tile ${tile.index} failed: ${err}`);
      const v = [...res.values.values()][0];
      if (!v || v.kind !== 'texture') throw new Error('Target did not produce a texture');
      const ch = channelCount(v.tex.format);
      const out = new Float32Array(tile.w * tile.h * ch);
      await readTextureStrips(
        gpu,
        mm,
        v.tex.texture,
        v.tex.format,
        v.tex.width,
        v.tex.height,
        (s) => void out.set(decodeTexels(v.tex.format, s.data), s.y0 * tile.w * ch),
        { region: { x: halo, y: halo, w: tile.w, h: tile.h }, signal: opts.token },
      );
      await opts.onTile(tile, out, ch);
    } finally {
      res.release();
    }
  }
  return { tiles: tiles.length, tileSize };
}

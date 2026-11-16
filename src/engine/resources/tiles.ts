/**
 * TileScheduler: splits a very large image (8K+) into tiles with a halo so the graph can be evaluated per tile
 * with tile-sized intermediates (memory stays bounded). Pure logic, unit-tested.
 *
 * Coordinates are image pixels, y down. The padded rectangle (px,py,pw,ph) is NOT clamped to the image:
 * it may extend outside (negative origin / beyond the edge). Generators are procedural so that is fine, and for
 * tiling graphs the periodic lattices make the outside region wrap correctly.
 */
export interface Tile {
  index: number;
  col: number;
  row: number;
  /** Core region (what the tile contributes to the final image). */
  x: number;
  y: number;
  w: number;
  h: number;
  halo: number;
  /** Padded region that is actually rendered (core + halo on all sides). */
  px: number;
  py: number;
  pw: number;
  ph: number;
}

export function planTiles(width: number, height: number, tileSize: number, halo = 0): Tile[] {
  if (width < 1 || height < 1) throw new Error('planTiles: empty image');
  const ts = Math.max(1, Math.floor(tileSize));
  const cols = Math.ceil(width / ts);
  const rows = Math.ceil(height / ts);
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * ts;
      const y = row * ts;
      const w = Math.min(ts, width - x);
      const h = Math.min(ts, height - y);
      tiles.push({ index: tiles.length, col, row, x, y, w, h, halo, px: x - halo, py: y - halo, pw: w + 2 * halo, ph: h + 2 * halo });
    }
  }
  return tiles;
}

/**
 * Pick the largest power-of-two tile size such that `liveTextures` tiles of `bytesPerPixel` fit in `budgetBytes`
 * (clamped to maxDim and to the image size). Never returns less than 64.
 */
export function pickTileSize(width: number, height: number, budgetBytes: number, bytesPerPixel: number, liveTextures: number, maxDim: number, halo = 0): number {
  const limit = Math.min(maxDim, Math.max(width, height) + 2 * halo);
  let size = 64;
  while (size * 2 <= limit) {
    const s = size * 2 + 2 * halo;
    if (s * s * bytesPerPixel * liveTextures > budgetBytes) break;
    size *= 2;
  }
  return size;
}

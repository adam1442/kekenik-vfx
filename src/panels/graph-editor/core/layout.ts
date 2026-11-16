/**
 * Layered DAG auto-layout (Sugiyama-lite): longest-path layering from the sources, barycentre ordering sweeps to reduce
 * crossings, columns left -> right. Pure and deterministic. The result is translated so the top-left of the laid out
 * bounding box stays where the nodes were (laying out a selection does not teleport it).
 */
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LayoutOptions {
  gapX?: number;
  gapY?: number;
  /** Keep the top-left of the original bounding box (default true). */
  anchor?: boolean;
}

export function layeredLayout(nodes: LayoutNode[], links: { from: string; to: string }[], opts: LayoutOptions = {}): Map<string, [number, number]> {
  const gapX = opts.gapX ?? 80,
    gapY = opts.gapY ?? 36;
  const out = new Map<string, [number, number]>();
  if (!nodes.length) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const n of nodes) {
    preds.set(n.id, []);
    succs.set(n.id, []);
  }
  const seen = new Set<string>();
  for (const l of links) {
    if (l.from === l.to || !byId.has(l.from) || !byId.has(l.to)) continue;
    const k = `${l.from}>${l.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    preds.get(l.to)!.push(l.from);
    succs.get(l.from)!.push(l.to);
  }
  // Layering (Kahn + longest path). Cycles cannot exist in valid graphs; leftovers are appended defensively.
  const layer = new Map<string, number>();
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, preds.get(n.id)!.length);
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  for (const id of queue) layer.set(id, 0);
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    for (const s of succs.get(id)!) {
      layer.set(s, Math.max(layer.get(s) ?? 0, layer.get(id)! + 1));
      indeg.set(s, indeg.get(s)! - 1);
      if (indeg.get(s) === 0) queue.push(s);
    }
  }
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, Math.max(0, ...preds.get(n.id)!.map((p) => layer.get(p) ?? 0)) + 1);

  // Pull sources right next to their first consumer (avoids long dangling links from layer 0).
  for (const n of nodes) {
    if (preds.get(n.id)!.length === 0 && succs.get(n.id)!.length) layer.set(n.id, Math.min(...succs.get(n.id)!.map((s) => layer.get(s)!)) - 1);
  }
  const minLayer = Math.min(...layer.values());
  for (const [k, v] of layer) layer.set(k, v - minLayer);

  const nLayers = Math.max(...layer.values()) + 1;
  const cols: string[][] = Array.from({ length: nLayers }, () => []);
  for (const n of [...nodes].sort((a, b) => a.y - b.y || a.x - b.x)) cols[layer.get(n.id)!].push(n.id);

  // Barycentre sweeps.
  const pos = new Map<string, number>();
  const reindex = (): void => cols.forEach((c) => c.forEach((id, i) => pos.set(id, i)));
  reindex();
  const bary = (id: string, nb: string[]): number => (nb.length ? nb.reduce((s, x) => s + (pos.get(x) ?? 0), 0) / nb.length : pos.get(id)!);
  for (let it = 0; it < 6; it++) {
    const down = it % 2 === 0;
    const order = down ? cols.map((_, i) => i) : cols.map((_, i) => nLayers - 1 - i);
    for (const ci of order) {
      const c = cols[ci];
      const keyed = c.map((id, i) => ({ id, k: bary(id, down ? preds.get(id)! : succs.get(id)!), i }));
      keyed.sort((a, b) => a.k - b.k || a.i - b.i);
      cols[ci] = keyed.map((x) => x.id);
      cols[ci].forEach((id, i) => pos.set(id, i));
    }
  }

  // Coordinates.
  const colW = cols.map((c) => Math.max(0, ...c.map((id) => byId.get(id)!.w)));
  const colH = cols.map((c) => c.reduce((s, id) => s + byId.get(id)!.h, 0) + Math.max(0, c.length - 1) * gapY);
  const maxH = Math.max(...colH);
  let x = 0;
  const raw = new Map<string, [number, number]>();
  cols.forEach((c, ci) => {
    let y = (maxH - colH[ci]) / 2;
    for (const id of c) {
      const n = byId.get(id)!;
      raw.set(id, [x + (colW[ci] - n.w) / 2, y]);
      y += n.h + gapY;
    }
    x += colW[ci] + gapX;
  });
  let ox = 0,
    oy = 0;
  if (opts.anchor !== false) {
    const minX = Math.min(...nodes.map((n) => n.x)),
      minY = Math.min(...nodes.map((n) => n.y));
    ox = minX;
    oy = minY;
  }
  for (const [id, [px, py]] of raw) out.set(id, [Math.round(px + ox), Math.round(py + oy)]);
  return out;
}

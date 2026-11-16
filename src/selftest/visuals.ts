import { el } from '../ui/styles';

/**
 * Visual known-answer grids for the self-test page. A test calls `pushVisual({title, cells})` with float readbacks;
 * the page shows every group under the test list as a row of labelled canvases, so a human can check "does this look right"
 * next to the numeric asserts (e.g. the polar grid must show rings / rays, the island map must show flat coloured regions).
 */
export interface VisualCell {
  label: string;
  w: number;
  h: number;
  /** 1 = gray, 2 = UV (rg), 3 / 4 = rgb(a). */
  ch: number;
  data: Float32Array;
  /** 'signed': map -1..1 to 0..1 (offsets). Default clamps 0..1. */
  mode?: 'clamp' | 'signed';
}
export interface VisualGroup {
  title: string;
  note?: string;
  cells: VisualCell[];
}
export const visualGroups: VisualGroup[] = [];
let version = 0;

export function pushVisual(g: VisualGroup): void {
  const i = visualGroups.findIndex((x) => x.title === g.title);
  if (i >= 0) visualGroups[i] = g;
  else visualGroups.push(g);
  version++;
}

function toCanvas(c: VisualCell, scale: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = c.w;
  cv.height = c.h;
  cv.style.cssText = `width:${c.w * scale}px;height:${c.h * scale}px;image-rendering:pixelated;border:1px solid #333;background:#000`;
  const ctx = cv.getContext('2d');
  if (!ctx) return cv;
  const img = ctx.createImageData(c.w, c.h);
  const f = (v: number): number => {
    const x = c.mode === 'signed' ? v * 0.5 + 0.5 : v;
    return Math.round(Math.min(Math.max(Number.isFinite(x) ? x : 1, 0), 1) * 255);
  };
  for (let i = 0; i < c.w * c.h; i++) {
    const o = i * 4;
    const d = c.data;
    if (c.ch === 1) img.data.set([f(d[i]), f(d[i]), f(d[i]), 255], o);
    else if (c.ch === 2) img.data.set([f(d[i * 2]), f(d[i * 2 + 1]), 0, 255], o);
    else img.data.set([f(d[i * c.ch]), f(d[i * c.ch + 1]), f(d[i * c.ch + 2]), 255], o);
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

let shown = -1;
/** (Re)build the visual section when something new was pushed. */
export function renderVisuals(host: HTMLElement): void {
  if (shown === version) return;
  shown = version;
  host.replaceChildren(
    ...(visualGroups.length ? [el('h2', {}, 'Visual known-answer grids')] : []),
    ...visualGroups.map((g) =>
      el(
        'div',
        { style: 'margin:12px 0' },
        el('div', { style: 'font-weight:600;margin-bottom:4px' }, g.title),
        ...(g.note ? [el('div', { class: 'dim', style: 'margin-bottom:6px' }, g.note)] : []),
        el(
          'div',
          { style: 'display:flex;flex-wrap:wrap;gap:8px' },
          ...g.cells.map((c) => el('div', { style: 'text-align:center;font-size:11px;max-width:200px' }, toCanvas(c, Math.max(1, Math.floor(128 / c.w))), el('div', {}, c.label))),
        ),
      ),
    ),
  );
}

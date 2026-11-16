/**
 * Custom inline SVG icon set (no external assets). All icons live on a 16x16 grid and are drawn with
 * `currentColor` strokes (class `k-icon`); `<circle class="fill">`-style filled parts use the `fill` class.
 * Groups: tools/actions, transport, node categories, pin types, panels, node glyphs (referenced by NodeDefinition.icon).
 */
const f = (d: string): string => `<path class="fill" d="${d}"/>`;
const p = (d: string): string => `<path d="${d}"/>`;
const c = (cx: number, cy: number, r: number, fill = false): string => `<circle ${fill ? 'class="fill" ' : ''}cx="${cx}" cy="${cy}" r="${r}"/>`;
const r = (x: number, y: number, w: number, h: number, rx = 1.5, fill = false): string => `<rect ${fill ? 'class="fill" ' : ''}x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

export const ICONS: Record<string, string> = {
  /* ---------------- tools / actions ---------------- */
  new: p('M4 1.5h5.5L13 5v9.5H4z') + p('M9.5 1.5V5H13'),
  open: p('M1.5 4.5h4.2l1.4 1.5h7.4v7.5h-13z') + p('M1.5 4.5v-1.5h4l1.4 1.5'),
  save: p('M2.5 2.5h9l2 2v9h-11z') + p('M5 2.5v3.5h5V2.5') + p('M5 13.5v-4h6v4'),
  'save-as': p('M2.5 2.5h8l2 2v3') + p('M2.5 2.5v11h5') + p('M5 2.5v3.5h4.5') + p('M10 14l4-4 1.2 1.2-4 4H10z'),
  undo: p('M5.5 3.5L2.5 6.5l3 3') + p('M2.5 6.5h6.5a4 4 0 010 8H6'),
  redo: p('M10.5 3.5l3 3-3 3') + p('M13.5 6.5H7a4 4 0 000 8h3'),
  cut: c(4.5, 12, 2) + c(11.5, 12, 2) + p('M5.5 10.3L11 2.5M10.5 10.3L5 2.5'),
  copy: r(5.5, 5.5, 8, 8) + p('M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2'),
  paste: r(3, 3, 10, 11.5) + r(6, 1.5, 4, 3, 1) + p('M5.5 8h5M5.5 10.5h5'),
  delete: p('M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.8 6.5v5M9.2 6.5v5'),
  duplicate: r(2.5, 2.5, 8, 8) + r(5.5, 5.5, 8, 8),
  search: c(7, 7, 4.3) + p('M10.2 10.2L14 14'),
  star: p('M8 1.8l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.3l-3.9 2.2.9-4.3L1.8 6.3l4.3-.5z'),
  'star-fill': f('M8 1.8l1.9 4 4.3.5-3.2 2.9.9 4.3L8 11.3l-3.9 2.2.9-4.3L1.8 6.3l4.3-.5z'),
  settings: c(8, 8, 2.2) + p('M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4'),
  close: p('M3.5 3.5l9 9M12.5 3.5l-9 9'),
  minimize: p('M3 12h10'),
  maximize: r(3, 3, 10, 10, 1),
  restore: r(2.5, 5.5, 8, 8, 1) + p('M5.5 5.5v-3h8v8h-3'),
  float: r(2, 4.5, 9, 8.5, 1) + p('M5 2.5h8.5V11') ,
  dock: r(2, 2.5, 12, 11, 1) + p('M2 6h12M6 6v7.5'),
  pin: p('M9.5 2l4.5 4.5-2 .5-2.5 2.5.3 3-1 1L4.7 8.2l1-1 3 .3L11.2 5z M5.5 10.5L2 14'),
  plus: p('M8 3v10M3 8h10'),
  minus: p('M3 8h10'),
  check: p('M3 8.5l3.2 3.2L13 4.8'),
  'chevron-right': p('M6 3.5L10.5 8 6 12.5'),
  'chevron-down': p('M3.5 6L8 10.5 12.5 6'),
  'chevron-up': p('M3.5 10L8 5.5 12.5 10'),
  'chevron-left': p('M10 3.5L5.5 8 10 12.5'),
  more: c(3.5, 8, 1.1, true) + c(8, 8, 1.1, true) + c(12.5, 8, 1.1, true),
  'more-v': c(8, 3.5, 1.1, true) + c(8, 8, 1.1, true) + c(8, 12.5, 1.1, true),
  reset: p('M3 8a5 5 0 105-5H5.5') + p('M7.5 1l-2.2 2.2L7.5 5.4'),
  refresh: p('M13 8a5 5 0 01-9 3M3 8a5 5 0 019-3') + p('M12.5 2v3h-3M3.5 14v-3h3'),
  eye: p('M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z') + c(8, 8, 2),
  'eye-off': p('M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z') + p('M2.5 13.5l11-11'),
  lock: r(3.5, 7, 9, 6.5, 1.2) + p('M5.5 7V5a2.5 2.5 0 015 0v2'),
  unlock: r(3.5, 7, 9, 6.5, 1.2) + p('M5.5 7V5a2.5 2.5 0 014.8-1'),
  link: p('M6.8 9.2a2.7 2.7 0 003.8 0l2-2a2.7 2.7 0 00-3.8-3.8l-.8.8') + p('M9.2 6.8a2.7 2.7 0 00-3.8 0l-2 2a2.7 2.7 0 003.8 3.8l.8-.8'),
  unlink: p('M6.8 9.2a2.7 2.7 0 003.8 0l2-2a2.7 2.7 0 00-3.8-3.8') + p('M9.2 6.8a2.7 2.7 0 00-3.8 0l-2 2a2.7 2.7 0 003.8 3.8') + p('M3 3l1.5 1.5M13 13l-1.5-1.5'),
  dice: r(2.5, 2.5, 11, 11, 2.2) + c(5.6, 5.6, 0.9, true) + c(10.4, 5.6, 0.9, true) + c(8, 8, 0.9, true) + c(5.6, 10.4, 0.9, true) + c(10.4, 10.4, 0.9, true),
  eyedropper: p('M13.5 2.5a1.8 1.8 0 00-2.6 0L9 4.4 7.7 3.1 6.6 4.2l1.1 1.1L2.5 10.5V13.5h3l5.2-5.2 1.1 1.1 1.1-1.1-1.3-1.3 1.9-1.9a1.8 1.8 0 000-2.6z'),
  grid: p('M2.5 2.5h11v11h-11zM2.5 6.2h11M2.5 9.8h11M6.2 2.5v11M9.8 2.5v11'),
  fit: p('M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10') + r(5.5, 5.5, 5, 5, 0.5),
  'zoom-in': c(7, 7, 4.3) + p('M10.2 10.2L14 14M7 5v4M5 7h4'),
  'zoom-out': c(7, 7, 4.3) + p('M10.2 10.2L14 14M5 7h4'),
  fullscreen: p('M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10'),
  folder: p('M1.5 3.5h4.5l1.5 1.8h7v7.7h-13z'),
  file: p('M3.5 1.5h6l3 3v10h-9z') + p('M9.5 1.5v3h3'),
  download: p('M8 2v8.5M4.5 7.5L8 11l3.5-3.5M2.5 13.5h11'),
  upload: p('M8 11V2.5M4.5 6L8 2.5 11.5 6M2.5 13.5h11'),
  camera: r(1.5, 4.5, 13, 9, 1.5) + c(8, 9, 2.6) + p('M5.5 4.5l1-2h3l1 2'),
  warning: p('M8 2L1.5 13.5h13z') + p('M8 6.5v3.2') + c(8, 11.6, 0.4, true),
  error: c(8, 8, 6.2) + p('M5.5 5.5l5 5M10.5 5.5l-5 5'),
  info: c(8, 8, 6.2) + p('M8 7.2v4') + c(8, 4.9, 0.5, true),
  help: c(8, 8, 6.2) + p('M6.2 6.2a1.9 1.9 0 113 1.5C8.4 8.3 8 8.6 8 9.6') + c(8, 11.6, 0.5, true),
  keyboard: r(1.5, 3.5, 13, 9, 1.5) + p('M4 6.5h1M7.5 6.5h1M11 6.5h1M4 9.5h8'),
  command: p('M5.5 5.5v5a1.8 1.8 0 11-1.8-1.8h8.6a1.8 1.8 0 11-1.8 1.8v-5a1.8 1.8 0 111.8 1.8H3.7a1.8 1.8 0 111.8-1.8z'),
  layout: r(1.5, 2.5, 13, 11, 1.2) + p('M6 2.5v11M6 8h8.5'),
  list: p('M5.5 4h8M5.5 8h8M5.5 12h8') + c(2.8, 4, 0.7, true) + c(2.8, 8, 0.7, true) + c(2.8, 12, 0.7, true),
  tree: p('M2.5 3h3M4 3v9.5h2M4 8h2') + r(7, 1.8, 6.5, 2.4, 0.6) + r(7, 6.8, 6.5, 2.4, 0.6) + r(7, 11.3, 6.5, 2.4, 0.6),
  tile3: p('M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11'),
  channels: c(6, 6, 3.5) + c(10, 6, 3.5) + c(8, 10, 3.5),
  sun: c(8, 8, 2.8) + p('M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2'),
  cube: p('M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7z M2.5 4.5L8 7.5l5.5-3M8 7.5v7'),
  image: r(1.5, 2.5, 13, 11, 1.5) + c(5.3, 6, 1.3) + p('M2 12l3.8-3.5 2.7 2.5 2.2-2 3.8 3.5'),
  tag: p('M2 2h6l6 6-6 6-6-6z') + c(5, 5, 0.9, true),
  user: c(8, 5.5, 2.8) + p('M2.5 14c.5-3 2.8-4.5 5.5-4.5s5 1.5 5.5 4.5'),
  bug: r(5, 5, 6, 8, 3) + p('M5 8H2.5M11 8h2.5M5 11l-2 1.5M11 11l2 1.5M5.3 5.5L3.5 3.5M10.7 5.5l1.8-2M6.5 5V4a1.5 1.5 0 013 0v1'),
  memory: r(1.5, 4.5, 13, 7, 1) + p('M4.5 4.5v-2M7 4.5v-2M9.5 4.5v-2M12 4.5v-2M4.5 11.5v2M7 11.5v2M9.5 11.5v2M12 11.5v2'),
  clock: c(8, 8, 6) + p('M8 4.5V8l2.5 1.5'),
  'drag-handle': c(5.5, 4, 0.9, true) + c(10.5, 4, 0.9, true) + c(5.5, 8, 0.9, true) + c(10.5, 8, 0.9, true) + c(5.5, 12, 0.9, true) + c(10.5, 12, 0.9, true),
  rename: p('M2.5 13.5h3L13 6l-3-3-7.5 7.5z M9 4l3 3'),
  bypass: p('M2 8h3.5M10.5 8H14') + p('M5.5 8c0-3 5-3 5 0s-5 3-5 0') ,

  /* ---------------- transport ---------------- */
  play: f('M4.5 2.5l9 5.5-9 5.5z'),
  pause: f('M4 2.5h2.7v11H4zM9.3 2.5H12v11H9.3z'),
  stop: f('M3.5 3.5h9v9h-9z'),
  'step-fwd': f('M3 3l7 5-7 5z') + f('M11.5 3H13.5v10H11.5z'),
  'step-back': f('M13 3L6 8l7 5z') + f('M2.5 3H4.5v10H2.5z'),
  loop: p('M3 7V6a2.5 2.5 0 012.5-2.5H12L10.2 1.7M13 9v1a2.5 2.5 0 01-2.5 2.5H4l1.8 1.8'),
  record: c(8, 8, 4.5, true),
  key: f('M8 2l5 6-5 6-5-6z'),

  /* ---------------- node categories ---------------- */
  'cat-grayscale': r(2, 2, 12, 12, 2) + `<path class="fill" d="M8 2a6 6 0 010 12z" stroke="none"/>`,
  'cat-color': c(5.8, 6, 3.6) + c(10.2, 6, 3.6) + c(8, 10, 3.6),
  'cat-normal': c(8, 8, 6) + p('M8 8l3-3.5M8 8L5 5M8 8v4'),
  'cat-uv': p('M2.5 13.5V2.5M2.5 13.5h11M5 11l2-2 2 .5 3-4') + p('M10.5 5.5h2v2'),
  'cat-subgraph': r(2, 2, 12, 12, 2) + r(5, 5, 6, 6, 1) + p('M8 2v3M8 11v3M2 8h3M11 8h3'),
  'cat-utils': p('M9.8 2.5a3.2 3.2 0 00-3 4.4L2.5 11.2l2.3 2.3 4.3-4.3a3.2 3.2 0 004.4-3L11.7 8 9.5 7.3 8.8 5.1z'),
  'cat-islands': p('M3 6.5c0-2.2 2-3.5 4-3 2.2.4 2.5 2.2 4 2.6 1.6.4 2.5 1.6 2 3.4-.5 2.2-3 2.5-5 2-2.5-.7-5 .2-5-2.2 0-.8 0-1.8 0-2.8z'),
  'cat-particle': c(4, 5, 1.4, true) + c(10, 3.5, 1, true) + c(12, 9, 1.6, true) + c(6.5, 11, 1.2, true) + c(3, 12.5, 0.8, true) + c(8.5, 7, 0.8, true),
  'cat-geometry': p('M8 1.8l5.7 3.2v6L8 14.2 2.3 11V5z M2.3 5L8 8.2 13.7 5M8 8.2v6'),
  'cat-camera': r(1.5, 4.5, 8.5, 7, 1.2) + p('M10 7l4.5-2.2v6.4L10 9'),
  'cat-import': p('M8 1.8v8M4.8 7L8 10.3 11.2 7M2.5 13h11'),
  'cat-export': p('M8 10.5v-8.5M4.8 5L8 1.8 11.2 5M2.5 13h11'),

  /* ---------------- pin types ---------------- */
  'pin-gray': c(8, 8, 5) + `<path class="fill" d="M8 3a5 5 0 010 10z" stroke="none"/>`,
  'pin-color': c(8, 8, 5, false) + c(8, 8, 2, true),
  'pin-normal': c(8, 8, 5) + p('M8 8l2.2-2.5'),
  'pin-uv': r(3, 3, 10, 10, 1) + p('M3 13L13 3'),
  'pin-mesh': p('M8 2l5.5 3v6L8 14l-5.5-3V5z'),
  'pin-points': c(4, 4, 1.3, true) + c(11, 5, 1.3, true) + c(6, 11, 1.3, true) + c(12, 12, 1.3, true),
  'pin-scalar': p('M3 8h10M8 3v10'),
  'pin-vector': p('M3 13L12 4M7 4h5v5'),
  'pin-curve': p('M2.5 13.5C5 13.5 5.5 2.5 8 2.5S11 13.5 13.5 13.5'),
  'pin-gradient': r(2, 4, 12, 8, 1.5) + p('M6 4v8M10 4v8'),
  'pin-flipbook': r(2, 2.5, 5, 5, 0.8) + r(9, 2.5, 5, 5, 0.8) + r(2, 9, 5, 5, 0.8) + r(9, 9, 5, 5, 0.8),

  /* ---------------- panels ---------------- */
  'panel-graph': r(1.5, 2.5, 4.5, 3.5, 1) + r(10, 2, 4.5, 3.5, 1) + r(5.5, 10, 5, 3.5, 1) + p('M6 4.2h4M12 5.5V8H8v2'),
  'panel-2d': r(2, 2, 12, 12, 1) + p('M2 11l3.5-3.5 3 3 2-2L14 12'),
  'panel-3d': p('M8 1.8l5.7 3.2v6L8 14.2 2.3 11V5z M2.3 5L8 8.2 13.7 5M8 8.2v6'),
  'panel-properties': p('M2.5 4h6M11.5 4h2M2.5 8h2M7.5 8h6M2.5 12h8M13 12h.5') + c(10, 4, 1.5) + c(5.5, 8, 1.5) + c(12, 12, 1.5),
  'panel-library': p('M2.5 2.5h3.5v11H2.5zM7 2.5h3.5v11H7z') + p('M11.4 3.4l2.1-.5 1.6 9.2-2.1.5z'),
  'panel-timeline': p('M2 3.5h12M2 8h12M2 12.5h12') + f('M5 6.3l1.2 1.7L5 9.7 3.8 8z') + f('M10 10.8l1.2 1.7-1.2 1.7-1.2-1.7z'),
  'panel-curve': p('M2.5 2.5v11h11') + p('M4 11.5C6 11.5 6.5 4 9 4s2.5 5 4 5'),
  'panel-export': r(2, 5, 12, 8.5, 1) + p('M8 9V1.8M5.5 4.2L8 1.8l2.5 2.4'),
  'panel-assets': p('M1.5 4h5l1.3 1.5H14.5V13h-13z') + r(4, 8, 3, 2.5, 0.5) + r(8.2, 8, 3, 2.5, 0.5),
  'panel-console': r(1.5, 2.5, 13, 11, 1.5) + p('M4.5 6l2.2 2-2.2 2M8.5 10.5h3'),
  'panel-gallery': r(1.5, 1.5, 5.5, 5.5, 1) + r(9, 1.5, 5.5, 5.5, 1) + r(1.5, 9, 5.5, 5.5, 1) + r(9, 9, 5.5, 5.5, 1),

  /* ---------------- node glyphs ---------------- */
  noise: p('M2 9c1.5-5 2.5 3 4 0s2.5-6 4-2 2.5 4 4 1') + p('M2 12.5h12'),
  uniform: r(2.5, 2.5, 11, 11, 1.5, true),
  blend: r(2, 2, 8, 8, 1.2) + r(6, 6, 8, 8, 1.2),
  levels: p('M2.5 13.5h11') + f('M3 13V10h2v3zM6 13V5h2v8zM9 13V7h2v6zM12 13V9h1.5v4z'),
  gradient: r(2, 2, 12, 12, 1.5) + p('M5 2v12M8 2v12M11 2v12'),
  shape: c(6, 6.5, 3.5) + r(7.5, 7.5, 6, 6, 1),
  curve: p('M2.5 13.5c4 0 3-11 11-11'),
  threshold: p('M2 12h5V4h7'),
  slice: p('M2 12c2-6 4-6 6-3s4 3 6-3M2 8.5h12'),
  blur: c(8, 8, 2, true) + c(8, 8, 4.2) + p('M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1'),
  transform: r(3.5, 3.5, 9, 9, 0.5) + r(2, 2, 3, 3, 0.4, true) + r(11, 2, 3, 3, 0.4, true) + r(2, 11, 3, 3, 0.4, true) + r(11, 11, 3, 3, 0.4, true),
  ramp: r(2, 4.5, 12, 7, 1.5) + p('M2 8h12') + c(5, 8, 1.2, true) + c(11, 8, 1.2, true),
  adjust: c(8, 8, 6) + `<path class="fill" d="M8 2a6 6 0 000 12z" stroke="none"/>`,
  filter: p('M2 3h12L9.5 8.5V13l-3-1.5V8.5z'),
  fractal: c(8, 8, 1.2, true) + c(8, 3, 1, true) + c(13, 8, 1, true) + c(8, 13, 1, true) + c(3, 8, 1, true) + p('M8 4v3M12 8H9M8 12V9M4 8h3'),
  spline: p('M2.5 12.5C5 2.5 9 14 13.5 3.5') + c(2.5, 12.5, 1.2, true) + c(13.5, 3.5, 1.2, true),
  distance: c(8, 8, 2, true) + c(8, 8, 4.5) + c(8, 8, 7),
  tile: p('M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z'),
  glow: c(8, 8, 2.5, true) + p('M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4'),
  edge: p('M2.5 13.5V6.5h4v-4h7') + p('M6.5 13.5h7v-7'),
  warp: p('M2 5c2-2 3 2 6 0s4 2 6 0M2 8.5c2-2 3 2 6 0s4 2 6 0M2 12c2-2 3 2 6 0s4 2 6 0'),
  'normal-map': c(8, 8, 6) + p('M8 8l3-3M8 8l-3-3M8 8v4'),
  polar: c(8, 8, 6) + p('M8 8V2M8 8l4.5 3M8 8l-4.5 3'),
  scatter: c(4, 4, 1.4, true) + c(10, 3.5, 1.1, true) + c(12, 9, 1.4, true) + c(6, 11, 1.4, true) + c(3, 8.5, 0.9, true),
  islands: p('M3 6.5c0-2.2 2-3.5 4-3 2.2.4 2.5 2.2 4 2.6 1.6.4 2.5 1.6 2 3.4-.5 2.2-3 2.5-5 2-2.5-.7-5 .2-5-2.2z'),
  texture: r(2, 2, 12, 12, 1) + p('M2 6h12M2 10h12M6 2v12M10 2v12'),
  model: p('M8 1.8l5.7 3.2v6L8 14.2 2.3 11V5z M2.3 5L8 8.2 13.7 5'),
  mask: c(8, 8, 6) + `<path class="fill" d="M8 2a6 6 0 000 12z" stroke="none"/>`,
  merge: p('M2.5 3.5h3.5l4 4.5H13.5M2.5 12.5h3.5L8.5 10') + p('M12 6l2 2-2 2'),
  split: p('M2.5 8H6l4-4.5h3.5M6 8l4 4.5h3.5') + p('M12 1.5l2 2-2 2M12 10.5l2 2-2 2'),
  switch: p('M2.5 4h4l3 8h4') + p('M2.5 12h4l1-2.7M9 6.5l.5-2.5h4') + p('M12 2l2 2-2 2M12 10l2 2-2 2'),
  sheet: r(2, 2, 12, 12, 1) + r(2, 2, 6, 6, 0.5) + r(8, 8, 6, 6, 0.5),
  'points-shape': c(4, 4, 1.3, true) + c(8, 8, 1.3, true) + c(12, 12, 1.3, true) + c(12, 4, 1.3, true) + c(4, 12, 1.3, true),
  sweep: p('M2.5 12c3 0 3-8 6-8h5') + c(2.5, 12, 1.4) + r(11, 2.5, 3.5, 3, 0.5),
  bake: p('M3 11.5h10M4.5 11.5V8a3.5 3.5 0 017 0v3.5') + p('M8 2.5v2'),
  accumulate: p('M3 13.5h10M3 10.5h10M3 7.5h10M3 4.5h10'),
  render: r(2, 3, 12, 8.5, 1) + p('M5.5 14h5M8 11.5V14') + f('M7 5.5l3 1.8-3 1.8z'),
};

/** Aliases: other names that may be used in NodeDefinition.icon. */
const ALIASES: Record<string, string> = {
  gray: 'cat-grayscale', grayscale: 'cat-grayscale', color: 'cat-color', normal: 'normal-map', uv: 'cat-uv', utils: 'cat-utils',
  particle: 'cat-particle', geometry: 'cat-geometry', camera: 'cat-camera', import: 'cat-import', export: 'cat-export',
  graph: 'panel-graph', viewport2d: 'panel-2d', viewport3d: 'panel-3d', properties: 'panel-properties', library: 'panel-library',
  timeline: 'panel-timeline', console: 'panel-console', gallery: 'panel-gallery', assets: 'panel-assets', mesh: 'pin-mesh',
  hue: 'cat-color', colorramp: 'ramp', dilate: 'blur', polar_scatter: 'scatter', xdog: 'edge', ao: 'blur', caustics: 'warp',
  lattice: 'warp', copy: 'copy', multiswitch: 'switch', sim: 'warp', vector: 'warp',
};

export const iconNames = (): string[] => Object.keys(ICONS);
export const hasIcon = (name: string): boolean => name in ICONS || name in ALIASES;

/** Inner SVG markup for an icon id (falls back to a neutral glyph). */
export function iconMarkup(name: string): string {
  return ICONS[name] ?? ICONS[ALIASES[name] ?? ''] ?? ICONS['cube'];
}

/** Standalone SVG string (for innerHTML in templates). */
export function iconSvg(name: string, size = 14): string {
  return `<svg class="k-icon" width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true">${iconMarkup(name)}</svg>`;
}

/** SVG element. `size` in CSS px-equivalents of the 12px base (em-based so UI scale applies). */
export function icon(name: string, size = 14): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, size).replace(`width="${size}" height="${size}"`, `style="width:${size / 12}rem;height:${size / 12}rem"`);
  return t.content.firstElementChild as SVGSVGElement;
}

import type { EvalTarget } from '../../engine/graph/evaluator';
import type { TileDisplay } from '../../gizmos/geom';

export type TargetMode = 'selection' | 'active' | 'pinned';
export type ChannelMode = 'rgb' | 'r' | 'g' | 'b' | 'a' | 'luma';
export type VizMode = 'none' | 'heat' | 'arrows' | 'lic';
/** overlay of another output of the displayed node (simulation velocity arrows / streamlines, pressure / divergence / curl heat). */
export type SimOverlay = 'none' | 'arrows' | 'lic' | 'pressure' | 'divergence' | 'curl';
/** Output pin id each overlay reads. */
export const OVERLAY_PIN: Record<SimOverlay, string | null> = { none: null, arrows: 'velocity', lic: 'velocity', pressure: 'pressure', divergence: 'divergence', curl: 'curl' };
export type TileMode = '1x1' | '2x2' | '3x3' | 'inf' | 'h3' | 'v3' | 'hinf' | 'vinf';
export type BgMode = 'checker' | 'black' | 'mid' | 'white' | 'custom';
export type AlphaMode = 'straight' | 'premult' | 'opaque';
export type UvMode = 'absolute' | 'offset' | 'flowmap';
export type CompareMode = 'off' | 'node' | 'snapshot';

/** Everything a 2D viewport remembers (persisted in the workspace via PanelContext.state / serialize()). */
export interface ViewportSettings {
  targetMode: TargetMode;
  pinned: EvalTarget | null;
  channel: ChannelMode;
  viz: VizMode;
  heatPal: 0 | 1;
  rangeLo: number;
  rangeHi: number;
  exposure: number;
  gamma: number;
  bg: BgMode;
  bgColor: string;
  alpha: AlphaMode;
  filter: 0 | 1 | 2;
  autoNearest: boolean;
  pixelGrid: boolean;
  tile: TileMode;
  seam: boolean;
  rot: 0 | 1 | 2 | 3;
  flipX: boolean;
  flipY: boolean;
  fit: boolean;
  zoom: number;
  cx: number;
  cy: number;
  gizmos: boolean;
  histogram: boolean;
  histLog: boolean;
  inspector: boolean;
  rulers: boolean;
  guidesU: number[];
  guidesV: number[];
  thirds: boolean;
  safe: boolean;
  compare: CompareMode;
  compareNode: EvalTarget | null;
  compareDir: 'v' | 'h';
  comparePos: number;
  uvMode: UvMode;
  arrowCell: number;
  arrowGain: number;
  /** Streamline overlay: step length in px (longer streaks) and noise grain in px (smaller grain = denser seeds). */
  licStep: number;
  licGrain: number;
  flipG: boolean;
  sphere: boolean;
  light: [number, number];
  snapGrid: number;
  snapAngle: number;
  regionTool: boolean;
  flipFrame: number;
  overlay: SimOverlay;
  overlayGain: number;
}

export const defaultSettings = (): ViewportSettings => ({
  targetMode: 'selection',
  pinned: null,
  channel: 'rgb',
  viz: 'none',
  heatPal: 0,
  rangeLo: 0,
  rangeHi: 1,
  exposure: 0,
  gamma: 1,
  bg: 'checker',
  bgColor: '#202225',
  alpha: 'straight',
  filter: 1,
  autoNearest: true,
  pixelGrid: true,
  tile: '1x1',
  seam: false,
  rot: 0,
  flipX: false,
  flipY: false,
  fit: true,
  zoom: 1,
  cx: 0,
  cy: 0,
  gizmos: true,
  histogram: false,
  histLog: false,
  inspector: true,
  rulers: false,
  guidesU: [],
  guidesV: [],
  thirds: false,
  safe: false,
  compare: 'off',
  compareNode: null,
  compareDir: 'v',
  comparePos: 0.5,
  uvMode: 'absolute',
  arrowCell: 28,
  arrowGain: 1.5,
  licStep: 1.25,
  licGrain: 1.5,
  flipG: false,
  sphere: true,
  light: [-35, 50],
  snapGrid: 1 / 16,
  snapAngle: 15,
  regionTool: false,
  flipFrame: 0,
  overlay: 'none',
  overlayGain: 1,
});

/** Merge untrusted saved state over the defaults (unknown / mistyped keys are ignored). */
export function mergeSettings(saved: unknown): ViewportSettings {
  const d = defaultSettings();
  if (!saved || typeof saved !== 'object') return d;
  const s = saved as Record<string, unknown>;
  const out = d as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) if (k in s && typeof s[k] === typeof out[k] && (out[k] === null) === (s[k] === null)) out[k] = s[k];
  if ('pinned' in s && s.pinned && typeof (s.pinned as EvalTarget).nodeId === 'string') d.pinned = s.pinned as EvalTarget;
  if ('compareNode' in s && s.compareNode && typeof (s.compareNode as EvalTarget).nodeId === 'string') d.compareNode = s.compareNode as EvalTarget;
  d.guidesU = Array.isArray(s.guidesU) ? (s.guidesU as unknown[]).filter((x): x is number => typeof x === 'number').slice(0, 64) : [];
  d.guidesV = Array.isArray(s.guidesV) ? (s.guidesV as unknown[]).filter((x): x is number => typeof x === 'number').slice(0, 64) : [];
  d.zoom = Math.min(256, Math.max(0.02, d.zoom));
  if (d.compare === 'snapshot') d.compare = 'off'; // snapshots are not persisted
  return d;
}

/** Tile preview mode -> copies per axis (0 = infinite) and whether the DISPLAY repeats on each axis. */
export function tileDisplay(m: TileMode): TileDisplay {
  switch (m) {
    case '2x2':
      return { nx: 2, ny: 2 };
    case '3x3':
      return { nx: 3, ny: 3 };
    case 'inf':
      return { nx: 0, ny: 0 };
    case 'h3':
      return { nx: 3, ny: 1 };
    case 'v3':
      return { nx: 1, ny: 3 };
    case 'hinf':
      return { nx: 0, ny: 1 };
    case 'vinf':
      return { nx: 1, ny: 0 };
    default:
      return { nx: 1, ny: 1 };
  }
}
export const TILE_LABELS: Record<TileMode, string> = { '1x1': '1×1', '2x2': '2×2', '3x3': '3×3', inf: '∞ Repeat', h3: '3× Horizontal', v3: '3× Vertical', hinf: '∞ Horizontal', vinf: '∞ Vertical' };

export const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [0.125, 0.13, 0.14];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

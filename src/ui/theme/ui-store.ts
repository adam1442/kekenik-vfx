/**
 * Central UI state: scale, density, theme (dark / light / system), accent.
 * Flow: Settings -> `setUi()` -> CSS variables / data attributes on <html> -> `onUiChange` listeners (canvas-drawn UI re-layouts and redraws).
 * Canvas painters never hard-code colors or sizes: they read `themeColor()` / `px()` / `uiState().scale` and subscribe with `onUiChange`.
 * `devicePixelRatio` is handled separately (canvas backing store size) and is NOT part of the UI scale.
 */
import { deriveAccent } from './accent';

export type ThemeMode = 'dark' | 'light' | 'system';
export type Density = 'compact' | 'comfortable';

export interface UiState {
  scale: number;
  density: Density;
  theme: ThemeMode;
  /** The theme actually applied ('system' resolved through prefers-color-scheme). */
  resolved: 'dark' | 'light';
  accent: string;
}

export const SCALE_MIN = 0.75;
export const SCALE_MAX = 2;
export const SCALE_STEP = 0.05;
export const SCALE_PRESETS = [0.9, 1, 1.1, 1.25, 1.5] as const;
export const clampScale = (v: number): number => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round((Number.isFinite(v) ? v : 1) / SCALE_STEP) * SCALE_STEP));

/** 8 accent presets (the picker also accepts any colour). */
export const ACCENTS: { name: string; hex: string }[] = [
  { name: 'Violet', hex: '#7c6cf0' },
  { name: 'Azure', hex: '#3b8eea' },
  { name: 'Teal', hex: '#1fa592' },
  { name: 'Green', hex: '#3fae6a' },
  { name: 'Amber', hex: '#d99a2b' },
  { name: 'Coral', hex: '#e8665a' },
  { name: 'Magenta', hex: '#d05fc0' },
  { name: 'Slate', hex: '#6f86a8' },
];

let state: UiState = { scale: 1, density: 'compact', theme: 'dark', resolved: 'dark', accent: '#7c6cf0' };
const listeners = new Set<(s: UiState, changed: ReadonlyArray<keyof UiState>) => void>();
const colorCache = new Map<string, string>();

export const uiState = (): Readonly<UiState> => state;
/** Scale a CSS-pixel metric of canvas-drawn UI by the UI scale. */
export const px = (n: number): number => n * state.scale;
export const onUiChange = (fn: (s: UiState, changed: ReadonlyArray<keyof UiState>) => void): (() => void) => (listeners.add(fn), () => listeners.delete(fn));

export function resolveTheme(mode: ThemeMode, prefersLight: boolean): 'dark' | 'light' {
  return mode === 'system' ? (prefersLight ? 'light' : 'dark') : mode;
}
const systemPrefersLight = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: light)').matches;

function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(state.scale));
  root.dataset.theme = state.resolved;
  root.dataset.density = state.density;
  root.style.colorScheme = state.resolved;
  const vars = deriveAccent(state.accent, state.resolved);
  if (vars) for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  colorCache.clear();
}

/** Update any subset of the UI state. Applies CSS variables synchronously, then notifies listeners (only when something changed). */
export function setUi(patch: Partial<Pick<UiState, 'scale' | 'density' | 'theme' | 'accent'>>): void {
  const next: UiState = { ...state };
  if (patch.scale !== undefined) next.scale = clampScale(patch.scale);
  if (patch.density) next.density = patch.density;
  if (patch.theme) next.theme = patch.theme;
  if (patch.accent) next.accent = patch.accent;
  next.resolved = resolveTheme(next.theme, systemPrefersLight());
  const changed = (Object.keys(next) as Array<keyof UiState>).filter((k) => next[k] !== state[k]);
  const first = typeof document !== 'undefined' && !document.documentElement.dataset.theme;
  state = next;
  if (!changed.length && !first) return;
  applyToDocument();
  for (const fn of [...listeners]) {
    try {
      fn(state, changed);
    } catch (e) {
      console.error('[ui-store] listener threw', e);
    }
  }
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') window.dispatchEvent(new CustomEvent('kk-ui-change', { detail: { changed } }));
}

/** Follow `prefers-color-scheme` while the theme mode is 'system'. Call once at startup. */
export function watchSystemTheme(): void {
  if (typeof matchMedia === 'undefined') return;
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    if (state.theme === 'system') {
      const was = state.resolved;
      state = { ...state, resolved: resolveTheme('system', systemPrefersLight()) };
      if (was !== state.resolved) {
        applyToDocument();
        for (const fn of [...listeners]) fn(state, ['resolved']);
      }
    }
  });
}

/** Read a design token (`bg1`, `line`, `text`, `accent`, ...) for canvas drawing. Cached per theme / accent. */
export function themeColor(name: string, fallback = '#888888'): string {
  const hit = colorCache.get(name);
  if (hit) return hit;
  let v = '';
  if (typeof document !== 'undefined' && typeof getComputedStyle !== 'undefined') v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  v = v || fallback;
  colorCache.set(name, v);
  return v;
}

/* ------------------------------------------------------------------------------------------------------------
 * Canvas colour remapping. Canvas painters written for the dark palette use literal colours; in the light theme every literal is
 * mapped to its designed light counterpart through this TOKEN TABLE (surfaces, text, borders, overlays, accent). Unknown colours
 * (node category colours, pin colours) pass through `lightVariant()` that darkens very light / saturates for contrast.
 * ---------------------------------------------------------------------------------------------------------- */
const DARK_TO_LIGHT: Record<string, string> = {
  // surfaces
  '#0b0c0e': '#e4e8ee', '#0b0c0f': '#e4e8ee', '#101114': '#eceff4', '#121418': '#f2f4f8', '#14161a': '#f2f4f8', '#17191d': '#f6f8fb', '#1a1d22': '#e9edf3', '#1b1d21': '#f6f8fb',
  '#1c1f25': '#ffffff', '#1d2026': '#fbfcfe', '#1f2329': '#f4f6fa', '#23272e': '#ffffff', '#2c1a1d': '#fdecec', '#3a1f22': '#fde4e4',
  // borders
  '#2b2f36': '#d5dae3', '#2e3138': '#d5dae3', '#323740': '#c3cad6', '#3a3f48': '#c3cad6', '#444a53': '#b5bdca', '#4a505b': '#a9b2c1', '#3c424b': '#b8c0cd',
  // text
  '#e8eaee': '#1c2230', '#e6e8ec': '#1c2230', '#eceef2': '#1c2230', '#d8dbe0': '#232a3a', '#cfd3da': '#2c3446', '#aeb4be': '#4a5568', '#a2a8b2': '#566176', '#8c939e': '#667187', '#7b828d': '#6b768b', '#5d636d': '#8b95a7', '#e6e2c8': '#4a4020',
  // accent tints used by the dark graph
  '#b2a8ff': '#5646d8', '#a79bff': '#5646d8', '#9a8dff': '#5646d8', '#ffffff': '#1c2230', '#fff': '#1c2230',
  '#f2c94c': '#b8860b',
};
const remapCache = new Map<string, string>();

/** Pure: map a dark-palette canvas colour string to the light palette. */
export function toLightColor(c: string): string {
  const key = c.trim().toLowerCase();
  const direct = DARK_TO_LIGHT[key];
  if (direct) return direct;
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/.exec(key);
  if (m) {
    const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]];
    if (r > 235 && g > 235 && b > 235) return `rgba(28,34,48,${Math.min(1, a * 1.15).toFixed(3)})`; // white overlay on dark -> ink overlay on light
    if (r < 12 && g < 12 && b < 12) return `rgba(28,34,48,${(a * 0.55).toFixed(3)})`; // black shadow -> softer ink shadow
    if (r > 140 && g > 90 && b > 200 && r < 200) return `rgba(86,70,216,${a})`; // light violet accent tints -> accent
  }
  return c;
}

/** Remap through a bounded cache. Dark theme is the identity. */
export function themedCanvasColor(c: string): string {
  if (state.resolved !== 'light') return c;
  let v = remapCache.get(c);
  if (v === undefined) {
    if (remapCache.size > 4000) remapCache.clear();
    v = toLightColor(c);
    remapCache.set(c, v);
  }
  return v;
}

let installed = false;
/**
 * Patch `HTMLCanvasElement.getContext('2d')` once so every Canvas2D painter (graph editor, minimap, timeline, curve editors, 2D overlays,
 * gizmos, histograms) gets theme-aware fill / stroke styles with NO per-call edits. A canvas with `data-no-theme` is left alone.
 */
export function installCanvasTheming(): void {
  if (installed || typeof HTMLCanvasElement === 'undefined') return;
  installed = true;
  const orig = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, id: string, o?: unknown) => unknown;
  (HTMLCanvasElement.prototype as unknown as { getContext: unknown }).getContext = function (this: HTMLCanvasElement, id: string, o?: unknown): unknown {
    const ctx = orig.call(this, id, o);
    if (id === '2d' && ctx && !this.hasAttribute('data-no-theme')) patchContext(ctx as CanvasRenderingContext2D);
    return ctx;
  };
}

function patchContext(ctx: CanvasRenderingContext2D): void {
  if ((ctx as unknown as { __themed?: boolean }).__themed) return;
  for (const prop of ['fillStyle', 'strokeStyle'] as const) {
    const proto = Object.getPrototypeOf(ctx) as object;
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d?.get || !d.set) continue;
    const { get, set } = d;
    Object.defineProperty(ctx, prop, {
      configurable: true,
      get() {
        return get.call(ctx);
      },
      set(v: unknown) {
        set.call(ctx, typeof v === 'string' ? themedCanvasColor(v) : v);
      },
    });
  }
  (ctx as unknown as { __themed: boolean }).__themed = true;
}

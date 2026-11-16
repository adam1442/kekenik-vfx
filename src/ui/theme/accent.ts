/** Derive the four accent CSS variables from ONE user colour (the UI has a single accent). Pure: unit-tested. */
export interface AccentVars {
  '--accent': string;
  '--accent2': string;
  '--accent-bg': string;
  '--accent-bg2': string;
}

export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Violet', hex: '#7c6cf0' },
  { name: 'Azure', hex: '#3b8eea' },
  { name: 'Teal', hex: '#27b5a0' },
  { name: 'Amber', hex: '#e0a23c' },
  { name: 'Coral', hex: '#e8665a' },
  { name: 'Magenta', hex: '#d05fc0' },
];

export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (c: [number, number, number]): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Relative luminance (WCAG). */
export function luminance(c: [number, number, number]): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}
export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Returns null for an invalid colour. The accent keeps >= 3:1 contrast on the panel background (lightened on dark, darkened on light). */
export function deriveAccent(hex: string, mode: 'dark' | 'light' = 'dark'): AccentVars | null {
  let c = parseHex(hex);
  if (!c) return null;
  if (mode === 'light') {
    const bg: [number, number, number] = [0xf6, 0xf8, 0xfb];
    for (let i = 0; i < 10 && contrastRatio(c, bg) < 3; i++) c = mix(c, [0, 0, 0], 0.1);
    return { '--accent': toHex(c), '--accent2': toHex(mix(c, [0, 0, 0], 0.18)), '--accent-bg': toHex(mix([255, 255, 255], c, 0.13)), '--accent-bg2': toHex(mix([255, 255, 255], c, 0.24)) };
  }
  const bg: [number, number, number] = [0x17, 0x19, 0x1d];
  for (let i = 0; i < 8 && contrastRatio(c, bg) < 3; i++) c = mix(c, [255, 255, 255], 0.12);
  const dark: [number, number, number] = [0x10, 0x11, 0x14];
  return { '--accent': toHex(c), '--accent2': toHex(mix(c, [255, 255, 255], 0.28)), '--accent-bg': toHex(mix(dark, c, 0.28)), '--accent-bg2': toHex(mix(dark, c, 0.42)) };
}

import { beforeEach, describe, expect, it } from 'vitest';
import { ACCENTS, clampScale, onUiChange, px, resolveTheme, setUi, themedCanvasColor, toLightColor, uiState } from '../src/ui/theme/ui-store';
import { contrastRatio, deriveAccent, parseHex } from '../src/ui/theme/accent';
import { displayNumber, setDigitsMode, toPersianDigits, detectLocale, pseudoize, missingKeys } from '../src/shared/i18n';

interface FakeRoot {
  style: { props: Record<string, string>; setProperty(k: string, v: string): void; colorScheme: string };
  dataset: Record<string, string>;
}
beforeEach(() => {
  const root: FakeRoot = { style: { props: {}, setProperty(k, v) { this.props[k] = v; }, colorScheme: '' }, dataset: {} };
  (globalThis as unknown as { document: unknown }).document = { documentElement: root };
});
const rootOf = (): FakeRoot => (globalThis as unknown as { document: { documentElement: FakeRoot } }).document.documentElement;

describe('UI store: scale propagates store -> CSS variable -> canvas metrics callback', () => {
  it('clamps to 75%..200% in 5% steps', () => {
    expect(clampScale(0.3)).toBe(0.75);
    expect(clampScale(9)).toBe(2);
    expect(clampScale(1.12)).toBeCloseTo(1.1, 5);
    expect(clampScale(NaN)).toBe(1);
  });
  it('setUi writes --ui-scale and notifies listeners with the changed keys; px() follows', () => {
    setUi({ scale: 1 });
    const seen: Array<{ scale: number; changed: string[]; metric: number }> = [];
    const off = onUiChange((s, changed) => seen.push({ scale: s.scale, changed: [...changed], metric: px(10) }));
    setUi({ scale: 1.5 });
    expect(rootOf().style.props['--ui-scale']).toBe('1.5');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ scale: 1.5, changed: ['scale'], metric: 15 });
    setUi({ scale: 1.5 }); // no change -> no notification
    expect(seen).toHaveLength(1);
    off();
    setUi({ scale: 1 });
    expect(seen).toHaveLength(1);
  });
  it('density and theme set data attributes; system follows prefers-color-scheme', () => {
    setUi({ density: 'comfortable', theme: 'light' });
    expect(rootOf().dataset.density).toBe('comfortable');
    expect(rootOf().dataset.theme).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    setUi({ density: 'compact', theme: 'dark' });
    expect(uiState().resolved).toBe('dark');
  });
});

describe('theme tokens', () => {
  it('accent keeps >= 3:1 contrast on dark and light surfaces for every preset', () => {
    for (const a of ACCENTS) {
      const d = deriveAccent(a.hex, 'dark')!;
      const l = deriveAccent(a.hex, 'light')!;
      expect(contrastRatio(parseHex(d['--accent'])!, [0x17, 0x19, 0x1d])).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(parseHex(l['--accent'])!, [0xf6, 0xf8, 0xfb])).toBeGreaterThanOrEqual(3);
    }
    expect(ACCENTS.length).toBeGreaterThanOrEqual(6);
  });
  it('light palette: text on surfaces meets WCAG AA (4.5:1)', () => {
    const pairs: Array<[string, string]> = [['#1c2230', '#f6f8fb'], ['#455166', '#f6f8fb'], ['#5f6b82', '#f6f8fb'], ['#1c2230', '#e6eaf1']];
    for (const [fg, bg] of pairs) expect(contrastRatio(parseHex(fg)!, parseHex(bg)!)).toBeGreaterThanOrEqual(4.5);
  });
  it('canvas colour remap: dark identity, light maps surfaces / text / overlays', () => {
    setUi({ theme: 'dark' });
    expect(themedCanvasColor('#17191d')).toBe('#17191d');
    setUi({ theme: 'light' });
    expect(themedCanvasColor('#17191d')).not.toBe('#17191d');
    expect(toLightColor('rgba(255,255,255,0.06)')).toMatch(/^rgba\(28,34,48,/);
    expect(toLightColor('#ff00aa')).toBe('#ff00aa'); // category / pin colours pass through
    setUi({ theme: 'dark' });
  });
});

describe('Persian digits, pseudo-locale, detection', () => {
  it('digits setting changes display only', () => {
    expect(toPersianDigits('1280×720')).toBe('۱۲۸۰×۷۲۰');
    setDigitsMode('fa');
    expect(displayNumber(42)).toBe('۴۲');
    setDigitsMode('latin');
    expect(displayNumber(42)).toBe('42');
  });
  it('pseudo-locale lengthens strings and keeps placeholders', () => {
    const p = pseudoize('Open {n} files');
    expect(p.length).toBeGreaterThan('Open {n} files'.length);
    expect(p).toContain('{n}');
  });
  it('detects fa from navigator.language, falls back to en', () => {
    expect(detectLocale('fa-IR')).toBe('fa');
    expect(detectLocale('de-DE')).toBe('en');
    expect(missingKeys('fa')).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

/** product decisions that must not regress. */
describe('default language', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is English on first run even when the browser prefers Persian', async () => {
    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'fa-IR' });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
    const i18n = await import('../src/shared/i18n');
    expect(i18n.getLocale()).toBe('en');
    expect(i18n.isRtl()).toBe(false);
    // detection is still available for an optional suggestion
    expect(i18n.detectLocale('fa-IR')).toBe('fa');
  });

  it('a saved choice wins over the default', async () => {
    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.stubGlobal('localStorage', { getItem: () => 'fa', setItem: () => undefined });
    const i18n = await import('../src/shared/i18n');
    expect(i18n.getLocale()).toBe('fa');
  });
});

describe('gizmo metrics follow the UI scale', () => {
  it('hit tolerances are live bindings updated by the UI store', async () => {
    vi.resetModules();
    const root = { style: { setProperty: () => undefined, colorScheme: '' }, dataset: {} as Record<string, string> };
    vi.stubGlobal('document', { documentElement: root });
    const store = await import('../src/ui/theme/ui-store');
    const kit = await import('../src/gizmos/kit');
    store.setUi({ scale: 1 });
    expect(kit.HIT_POINT_PX).toBe(10);
    store.setUi({ scale: 1.5 });
    expect(kit.HIT_POINT_PX).toBeCloseTo(15);
    expect(kit.HIT_LINE_PX).toBeCloseTo(9);
    vi.unstubAllGlobals();
  });
});

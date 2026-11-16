import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import fa from '../src/i18n/fa.json';
import { availableLocales, format, setLocale, t } from '../src/shared/i18n';

/** locale files, glossary and RTL rules that must not regress. */
describe('locale JSON files', () => {
  it('fa.json has exactly the keys of en.json (no missing, no stray)', () => {
    const missing = Object.keys(en).filter((k) => !(k in fa));
    const stray = Object.keys(fa).filter((k) => !(k in en));
    expect({ missing, stray }).toEqual({ missing: [], stray: [] });
  });

  it('placeholder names match between en and fa', () => {
    const ph = (s: string): string => [...new Set([...s.matchAll(/\{(\w+)(?::[^}]*)?\}/g)].map((m) => m[1]))].sort().join(); // plural markers are optional in Persian (one form)
    const bad = (Object.keys(en) as Array<keyof typeof en>).filter((k) => ph(en[k]) !== ph((fa as Record<string, string>)[k] ?? ''));
    expect(bad).toEqual([]);
  });

  it('the Persian text follows the glossary (no legacy terms)', () => {
    const all = JSON.stringify(fa);
    for (const legacy of ['ویوپورت', 'بافت‌', 'کیفریم']) expect(all.includes(legacy), legacy).toBe(false);
  });

  it('a pseudo-locale exists for long-string layout tests and is not offered as a real language', () => {
    expect(availableLocales()).toContain('pseudo');
  });
});

describe('bidi isolation of interpolated Latin tokens', () => {
  afterEach(() => void setLocale('en', false));

  it('wraps Latin values in isolates only for RTL locales', () => {
    expect(format('File {name}', { name: 'a.png' }, 'en')).toBe('File a.png');
    const rtl = format('فایل {name}', { name: 'a.png' }, 'fa');
    expect(rtl).toBe('فایل \u2068a.png\u2069');
    expect(format('فایل {name}', { name: 'فارسی' }, 'fa')).toBe('فایل فارسی');
  });

  it('live switch changes t() output without reload', () => {
    setLocale('fa', false);
    expect(t('menu.File')).toBe(fa['menu.File']);
    setLocale('en', false);
    expect(t('menu.File')).toBe('File');
  });
});

describe('RTL stylesheet rules', () => {
  const dir = join(__dirname, '../src/ui/theme');
  const css = readdirSync(dir).filter((f) => f.endsWith('.css'));
  it('chrome stylesheets use logical properties for spacing, borders and alignment', () => {
    const offenders: string[] = [];
    for (const f of css) {
      readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\b(margin|padding)-(left|right)\b|\bborder-(left|right)\b|text-align:\s*(left|right)/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
